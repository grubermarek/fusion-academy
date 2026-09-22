/**
 * Fusion Academy — DENNÝ PLÁNOVAČ AKCIÍ A KAMPANÍ
 *
 * Načo to je: marketing tanečnej školy je sezónny. Novoročná vlna, Deň matiek,
 * Black Friday, september, venčeková sezóna — každé okno sa dá pripraviť dopredu
 * alebo prešvihnúť. Tento modul drží kalendár príležitostí, ku každej má playbook
 * (čo spustiť, komu, kadiaľ) a hlavne VOPRED upozorní, čo treba začať robiť dnes.
 *
 * Ako to funguje: kalendár je DETERMINISTICKÝ — sviatky a pohyblivé dni sa počítajú
 * zo vzorcov, školské prázdniny sú v nastaveniach (menia sa každý rok, nedajú sa
 * odvodiť), interné akcie (eventy, venčekové večery, uzávierky) sa čítajú z DB.
 * Žiadne LLM, žiadne vymýšľanie — každá položka sa dá spätne vysvetliť.
 *
 * Denne o 8:00 (konfigurovateľné) pošle adminom jedno upozornenie so všetkým,
 * čo má na dnešok termín prípravy. V pondelok pridá výhľad na 14 dní.
 *
 * Zdroj dátumov sviatkov: Úrad vlády SR — https://www.vlada.gov.sk/slovensko/statne-sviatky/
 * (1. 9., 28. 10. a 17. 11. sú štátne sviatky, ale PRACOVNÉ dni.)
 */
'use strict';
const path = require('path');

module.exports = function initPlanovac(ctx){
  const { app, db, q, Datastore, DATA_DIR, adminAuth, nowISO, APP_URL, sendMail, emailTemplate } = ctx;

  db.planovac = new Datastore({ filename: path.join(DATA_DIR, 'planovac.db'), autoload: true });
  db.planovac.ensureIndex({ fieldName: 'key' });

  // ── dátumová aritmetika (všetko na poludnie UTC, aby nepretekal deň) ────────
  const TZ = 'Europe/Bratislava';
  const T = () => new Intl.DateTimeFormat('sv-SE',{timeZone:TZ}).format(new Date());
  const hodinaTeraz = () => +new Intl.DateTimeFormat('sv-SE',{timeZone:TZ,hour:'2-digit',hour12:false}).format(new Date());
  const iso  = dt => dt.toISOString().slice(0,10);
  const U    = (y,m,d) => new Date(Date.UTC(y, m-1, d, 12));
  const YMD  = (y,m,d) => iso(U(y,m,d));
  const addD = (s,n) => iso(new Date(Date.parse(s+'T12:00:00Z') + n*86400000));
  const dowOf= s => new Date(s+'T12:00:00Z').getUTCDay();            // 0 = nedeľa
  const diff = (a,b) => Math.round((Date.parse(b+'T12:00:00Z') - Date.parse(a+'T12:00:00Z'))/86400000);
  const DNI  = ['nedeľa','pondelok','utorok','streda','štvrtok','piatok','sobota'];
  const MES  = ['január','február','marec','apríl','máj','jún','júl','august','september','október','november','december'];
  const sk   = s => { const [y,m,d]=s.split('-'); return (+d)+'. '+(+m)+'. '+y; };
  // slovenské skloňovanie po číslovke: 1 hodina / 2–4 hodiny / 5+ hodín
  const pocet = (n, jedna, dve, pat) => n===1 ? jedna : (n>=2 && n<=4 ? dve : pat);
  const skKratko = s => { const p=s.split('-'); return (+p[2])+'. '+(+p[1])+'.'; };
  const esc  = v => String(v==null?'':v).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  // Veľkonočná nedeľa — anonymný gregoriánsky algoritmus.
  function velkaNoc(y){
    const a=y%19, b=Math.floor(y/100), c=y%100, d=Math.floor(b/4), e=b%4,
          f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3), h=(19*a+b-d-g+15)%30,
          i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7, m=Math.floor((a+11*h+22*l)/451),
          mo=Math.floor((h+l-7*m+114)/31), da=((h+l-7*m+114)%31)+1;
    return YMD(y, mo, da);
  }
  // n-tý deň v týždni v mesiaci; n = -1 znamená posledný
  function nDen(y,m,wd,n){
    if(n>0){ const prvy=U(y,m,1); const posun=(wd-prvy.getUTCDay()+7)%7; return iso(U(y,m,1+posun+(n-1)*7)); }
    const posledny=new Date(Date.UTC(y,m,0,12)); const spat=(posledny.getUTCDay()-wd+7)%7;
    return iso(new Date(posledny.getTime()-spat*86400000));
  }
  const poslednyDenMesiaca = (y,m) => iso(new Date(Date.UTC(y,m,0,12)));

  // ═══════════════════════════════════════════════════════════════════════════
  // 1) SVIATKY A DNI PRACOVNÉHO POKOJA (SR)
  //    volno=true → hodiny sa v ten deň typicky nekonajú, treba ich zrušiť v rozvrhu
  // ═══════════════════════════════════════════════════════════════════════════
  const SVIATKY = [
    { key:'novy-rok',      nazov:'Nový rok / Deň vzniku SR',          volno:true,  kedy:y=>YMD(y,1,1) },
    { key:'traja-krali',   nazov:'Zjavenie Pána (Traja králi)',       volno:true,  kedy:y=>YMD(y,1,6) },
    { key:'velky-piatok',  nazov:'Veľký piatok',                      volno:true,  kedy:y=>addD(velkaNoc(y),-2) },
    { key:'velka-noc',     nazov:'Veľkonočná nedeľa',                 volno:true,  kedy:y=>velkaNoc(y) },
    { key:'velkonocny-po', nazov:'Veľkonočný pondelok',               volno:true,  kedy:y=>addD(velkaNoc(y),1) },
    { key:'prvy-maj',      nazov:'Sviatok práce',                     volno:true,  kedy:y=>YMD(y,5,1) },
    { key:'osmy-maj',      nazov:'Deň víťazstva nad fašizmom',        volno:true,  kedy:y=>YMD(y,5,8) },
    { key:'cyril-metod',   nazov:'Sviatok sv. Cyrila a Metoda',       volno:true,  kedy:y=>YMD(y,7,5) },
    { key:'snp',           nazov:'Výročie SNP',                       volno:true,  kedy:y=>YMD(y,8,29) },
    { key:'ustava',        nazov:'Deň Ústavy SR (pracovný deň)',      volno:false, kedy:y=>YMD(y,9,1) },
    { key:'sedembolestna', nazov:'Sedembolestná Panna Mária',         volno:true,  kedy:y=>YMD(y,9,15) },
    { key:'vznik-csr',     nazov:'Deň vzniku ČSR (pracovný deň)',     volno:false, kedy:y=>YMD(y,10,28) },
    { key:'vsetkych-sv',   nazov:'Sviatok všetkých svätých',          volno:true,  kedy:y=>YMD(y,11,1) },
    { key:'dusicky',       nazov:'Pamiatka zosnulých (pracovný deň)', volno:false, kedy:y=>YMD(y,11,2) },
    { key:'17-november',   nazov:'Deň boja za slobodu (pracovný deň)',volno:false, kedy:y=>YMD(y,11,17) },
    { key:'stedry-den',    nazov:'Štedrý deň',                        volno:true,  kedy:y=>YMD(y,12,24) },
    { key:'1-vianocny',    nazov:'Prvý sviatok vianočný',             volno:true,  kedy:y=>YMD(y,12,25) },
    { key:'2-vianocny',    nazov:'Druhý sviatok vianočný',            volno:true,  kedy:y=>YMD(y,12,26) },
    { key:'silvester',     nazov:'Silvester (pracovný deň)',          volno:false, kedy:y=>YMD(y,12,31) },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // 2) PRÍLEŽITOSTI S KAMPAŇOU — jednodňové
  //    kroky: d = koľko dní PRED dátumom sa má krok spraviť
  // ═══════════════════════════════════════════════════════════════════════════
  const PRILEZITOSTI = [
    {
      key:'valentin', emoji:'💘', nazov:'Valentín', dopad:'stredny', kedy:y=>YMD(y,2,14),
      preco:'Ľudia hľadajú zážitkový darček. Tanečná hodina je darček, ktorý sa nedá zjesť ani zabudnúť v šuplíku.',
      kampan:{
        nazov:'Valentín — daruj tanec',
        ponuka:'Darčekový promo kód na mesačné členstvo (49,90 €) alebo na balík vstupov. Kód vytvor v admin → Promo kódy.',
        publikum:'Meta: ženy 25–50, okolie Zvolen / B. Bystrica / Brezno / Detva + retargeting návštevníkov. E-mail: odídené klientky.',
        kanaly:['Meta reklama','Storky (3× počas týždňa)','E-mail členkám aj leadom','Oznam v appke'],
      },
      kroky:[
        {d:14, text:'Rozhodni ponuku a vytvor promo kód (admin → Promo kódy). Skontroluj, či nekoliduje s „prvým týždňom zadarmo“.'},
        {d:10, text:'Priprav kreatívy generátorom storiek — reálne fotky zo zložky „Storky na siete“, žiadne AI.'},
        {d:7,  text:'Spusti Meta kampaň s malým rozpočtom (3–5 €/deň), cieľ = registrácia. Over meranie (fa_zdroj, CAPI).'},
        {d:3,  text:'Hromadná správa členkám + leadom (admin → Hromadné správy). Storka s odpočtom.'},
        {d:1,  text:'Posledná výzva — storka „zajtra končí“ + oznam v appke.'},
      ],
    },
    {
      key:'mdz', emoji:'🌷', nazov:'MDŽ — Medzinárodný deň žien', dopad:'stredny', kedy:y=>YMD(y,3,8),
      preco:'Naše publikum sú ženy. MDŽ je prirodzený dôvod dať existujúcim klientkam niečo navyše — udržanie je lacnejšie ako nábor.',
      kampan:{
        nazov:'MDŽ — darček pre naše tanečnice',
        ponuka:'Bonusové body do hlavolamu alebo žrebovanie o mesiac členstva + „prines kamošku“ na hodiny toho týždňa.',
        publikum:'Aktívne členky (udržanie) + ich kamošky (100 bodov za prvé zaplatené členstvo kamošky).',
        kanaly:['Oznam v appke','E-mail členkám','Storky','Na hodine osobne'],
      },
      kroky:[
        {d:10, text:'Vyber odmenu — žrebovanie alebo „kamoška zadarmo“. Over kapacity hodín, aby sa hostky zmestili.'},
        {d:5,  text:'Oznam v appke + e-mail členkám. Tréneri to spomenú na hodinách.'},
        {d:2,  text:'Storky s pozvánkou pre kamošky, odkaz na /invite.'},
        {d:0,  text:'Na hodinách odovzdať alebo vyžrebovať. Odfotiť na storky (so súhlasom).'},
      ],
    },
    {
      key:'den-tanca', emoji:'💃', nazov:'Medzinárodný deň tanca', dopad:'stredny', kedy:y=>YMD(y,4,29),
      preco:'Jediný deň v roku, keď má „tanec“ mediálny priestor zadarmo. Ideálne na obsah a otvorenú hodinu.',
      kampan:{
        nazov:'Deň tanca — otvorená hodina',
        ponuka:'Hodiny v ten deň otvorené aj pre neregistrované, potom ponuka prvého týždňa zadarmo.',
        publikum:'Studené publikum v okolí miest + leady, ktoré sa nikdy nedostavili.',
        kanaly:['Meta reklama','Storky a reels','E-mail leadom','Facebook event'],
      },
      kroky:[
        {d:21, text:'Rozhodni, v ktorých mestách bude otvorená hodina (pozor na kapacitu sál).'},
        {d:14, text:'Založ Facebook event, priprav landing /prva-hodina.'},
        {d:10, text:'Spusti Meta reklamu na event, retarget na návštevníkov webu.'},
        {d:5,  text:'E-mail nedostaveným leadom — „príď bez záväzku“.'},
        {d:1,  text:'Pripomienka prihláseným + storka.'},
        {d:0,  text:'Foto/video z hodiny na storky, na mieste zbieraj kontakty cez kiosk QR.'},
      ],
    },
    {
      key:'den-matiek', emoji:'💐', nazov:'Deň matiek', dopad:'vysoky', kedy:y=>nDen(y,5,0,2),
      preco:'Najsilnejší darčekový deň pre naše publikum — dcéry a manželia hľadajú darček pre mamu. Darček je členstvo, nie kvety.',
      kampan:{
        nazov:'Deň matiek — daruj mame tanec',
        ponuka:'Darčekový promo kód na mesačné členstvo (49,90 €) alebo Kids + mama spolu. Doručenie e-mailom do posledného dňa.',
        publikum:'Meta: široké okolie miest, dôraz na „kúp darček“ (aj muži 30–60). Plus vlastné členky — darček pre ich mamu.',
        kanaly:['Meta reklama','Storky','E-mail celej databáze','Oznam v appke'],
      },
      kroky:[
        {d:21, text:'Priprav darčekový promo kód a jednoduchý text, ako sa uplatní.'},
        {d:14, text:'Kreatívy — reálne fotky mama + dcéra z hodín (so súhlasom).'},
        {d:10, text:'Spusti Meta kampaň. Rozpočet vyšší než bežne — toto je nákupné okno.'},
        {d:5,  text:'E-mail celej databáze + storky.'},
        {d:2,  text:'„Stihneš ešte“ — posledná výzva, zdôrazni okamžité doručenie e-mailom.'},
        {d:0,  text:'Na hodinách gratulácia mamám, foto na storky.'},
      ],
    },
    {
      key:'mdd', emoji:'🎈', nazov:'MDD — Deň detí', dopad:'stredny', kedy:y=>YMD(y,6,1),
      preco:'Nábor do Zumba Kids 1 (4–6) a Kids 2 (7–14) pred letom aj na september.',
      kampan:{
        nazov:'MDD — Zumba Kids otvorená hodina',
        ponuka:'Detská hodina zadarmo pre nové deti + zápis na september.',
        publikum:'Rodičia detí 4–14 v okolí Detvy (Kids beží v piatok a v nedeľu).',
        kanaly:['Meta reklama (rodičia)','Storky','E-mail rodičom v databáze','Letáky do škôl'],
      },
      kroky:[
        {d:21, text:'Termín a kapacita detskej otvorenej hodiny, súhlas trénera.'},
        {d:14, text:'Kreatívy + text pre rodičov (čo si vziať, koľko to stojí potom).'},
        {d:10, text:'Meta kampaň na rodičov. POZOR: rodičia venčekárov nie sú cieľ predaja — len informácia, žiadny predajný tlak.'},
        {d:3,  text:'Pripomienka prihláseným rodičom.'},
        {d:0,  text:'Na hodine zber kontaktov, ponuka zápisu na september.'},
      ],
    },
    {
      key:'halloween', emoji:'🎃', nazov:'Halloween', dopad:'nizky', kedy:y=>YMD(y,10,31),
      preco:'Lacný obsahový ťahák — tematická hodina v kostýmoch spraví viac storiek než mesiac bežných.',
      kampan:{
        nazov:'Halloween Zumba párty',
        ponuka:'Tematická hodina v kostýmoch, hostky vítané. Zľava netreba — ide o zážitok a obsah.',
        publikum:'Členky a ich kamošky.',
        kanaly:['Oznam v appke','Storky','Na hodine'],
      },
      kroky:[
        {d:14, text:'Vyber hodiny, ktoré budú tematické, a povedz to trénerom.'},
        {d:7,  text:'Oznam v appke + storka „vezmi si kostým“.'},
        {d:1,  text:'Pripomienka + playlist.'},
        {d:0,  text:'Veľa fotiek a videí — vydrží to na obsah na týždne.'},
      ],
    },
    {
      key:'black-friday', emoji:'🖤', nazov:'Black Friday', dopad:'vysoky', kedy:y=>addD(nDen(y,11,4,4),1),
      preco:'Jediný deň v roku, keď ľudia sami hľadajú zľavy. Najlepšie okno na predaj dlhších záväzkov, nie jednorazových vstupov.',
      kampan:{
        nazov:'Black Friday — najlepšia cena roka',
        ponuka:'Dlhší záväzok za lepšiu cenu (napr. 3 mesiace vopred). NEZľavuj bežný mesačný odber — znížil by si cenu aj bežiacim členkám.',
        publikum:'1) Klientky na jednorazových vstupoch (upsell). 2) Odídené klientky. 3) Leady, čo nikdy nezaplatili. 4) Studené publikum cez Meta.',
        kanaly:['Meta reklama','E-mail celej databáze (3 maily)','Storky denne','Oznam v appke','Ambasádorky'],
      },
      kroky:[
        {d:21, text:'Rozhodni presnú ponuku a dokedy platí. Prepočítaj dopad na cash flow (Peniaze → Prehľad).'},
        {d:14, text:'Priprav promo kód, texty mailov a kreatívy. Over, že Stripe ponuku zvládne.'},
        {d:10, text:'Zahrej publikum — obsah bez predaja (storky, príbehy klientok), aby reklama nebola studená.'},
        {d:7,  text:'Teaser: „o týždeň najlepšia cena roka“ — e-mail + storky + oznam v appke.'},
        {d:3,  text:'Spusti Meta kampaň naplno. Informuj ambasádorky, nech to posunú kamoškám.'},
        {d:0,  text:'Deň D: ranný e-mail, storka každé 3 hodiny, večer „posledné hodiny“.'},
      ],
    },
    {
      key:'cyber-monday', emoji:'💻', nazov:'Cyber Monday', dopad:'stredny', kedy:y=>addD(nDen(y,11,4,4),4),
      preco:'Dobeh Black Friday — chytí tie, čo v piatok váhali.',
      kampan:{
        nazov:'Posledná šanca — predĺženie Black Friday',
        ponuka:'Tá istá ponuka, posledný deň. Nič nové nevymýšľaj.',
        publikum:'Retargeting tých, čo klikli a nekúpili, + neotvorené maily z piatka.',
        kanaly:['Meta retargeting','E-mail (len tým, čo nekúpili)','Storky'],
      },
      kroky:[
        {d:2, text:'Priprav retargeting publikum z Black Friday kampane.'},
        {d:0, text:'Ranný e-mail „dnes o polnoci končí“, storka, večerná pripomienka.'},
      ],
    },
    {
      key:'mikulas', emoji:'🎅', nazov:'Mikuláš', dopad:'nizky', kedy:y=>YMD(y,12,6),
      preco:'Detské hodiny — mikulášska nádielka je dôvod, prečo rodič deti prinesie a odfotí.',
      kampan:{
        nazov:'Mikuláš na Zumba Kids',
        ponuka:'Mikulášska hodina s balíčkom pre deti, rodičia vítaní.',
        publikum:'Rodičia detí v Kids skupinách + venčekové skupiny (bez predajného tlaku).',
        kanaly:['Oznam rodičom','Storky','E-mail rodičom'],
      },
      kroky:[
        {d:14, text:'Nakúp balíčky, dohodni, kto robí Mikuláša.'},
        {d:7,  text:'Oznam rodičom — nech prídu skôr a s foťákom.'},
        {d:1,  text:'Pripomienka.'},
      ],
    },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // 3) SEZÓNNE OKNÁ — viacdňové obdobia, kde sa mení správanie ľudí
  // ═══════════════════════════════════════════════════════════════════════════
  const OKNA = [
    {
      key:'novorocna-vlna', emoji:'🎯', nazov:'Novoročná vlna — predsavzatia', dopad:'vysoky',
      od:y=>YMD(y,1,1), do:y=>YMD(y,1,20), start:y=>YMD(y,1,2),
      preco:'Najsilnejšie nákupné okno roka pre pohyb. Ľudia sami hľadajú, kam sa prihlásiť — stačí byť viditeľný a mať hladký zápis.',
      kampan:{
        nazov:'Nový rok — začni tancovať',
        ponuka:'Prvý týždeň zadarmo (7-dňová skúška) a potom mesačné členstvo 49,90 €. Rozhodnutie musí trvať minútu.',
        publikum:'Studené publikum v okolí všetkých miest + všetky staré leady + odídené klientky.',
        kanaly:['Meta reklama (najvyšší rozpočet roka)','Google Ads (ak bude účet overený)','E-mail celej databáze','Storky denne','Ambasádorky'],
      },
      kroky:[
        {d:21, text:'Priprav kampaň EŠTE PRED Vianocami — po 1. 1. je neskoro stavať kreatívy.'},
        {d:14, text:'Skontroluj rozvrh na január (zrušené sviatočné hodiny, nové termíny) — reklama nesmie viesť na hodinu, čo nebude.'},
        {d:10, text:'Over celý lievik: /prva-hodina → registrácia → Stripe skúška → meranie (fa_zdroj, CAPI). Otestuj naostro.'},
        {d:7,  text:'Nastav rozpočty v Meta. Priprav 3 varianty kreatív na test.'},
        {d:3,  text:'Teaser storky — „od 2. januára“.'},
        {d:0,  text:'ŠTART: spusti kampaň, e-mail celej databáze, denné storky. Každý deň sleduj CAC v admin → Marketing.'},
      ],
    },
    {
      key:'jarna-vlna', emoji:'🌸', nazov:'Jarná vlna — pred letom', dopad:'vysoky',
      od:y=>YMD(y,4,15), do:y=>YMD(y,6,15), start:y=>YMD(y,4,15),
      preco:'Druhé najsilnejšie okno. Motivácia „chcem sa cítiť dobre v lete“ funguje 6–8 týždňov pred prázdninami.',
      kampan:{
        nazov:'Do leta v pohybe',
        ponuka:'Prvý týždeň zadarmo + mesačné členstvo. Fit premena a analýza tela ako dôvod začať práve teraz.',
        publikum:'Studené publikum + leady z jari + neaktívne členky.',
        kanaly:['Meta reklama','Storky s príbehmi klientok (so súhlasom)','E-mail databáze','Fit premena ako hák'],
      },
      kroky:[
        {d:14, text:'Vyzbieraj príbehy a fotky klientok, ktoré chodia dlhšie — to je najlepšia kreatíva, akú máme.'},
        {d:7,  text:'Priprav kampaň a texty. Over kapacitu hodín — jar býva plná, nekupuj kliky na plné hodiny.'},
        {d:0,  text:'Štart kampane. Sleduj obsadenosť (Fusion AI) a priškrcuj mestá, kde je plno.'},
      ],
    },
    {
      key:'septembrovy-nabor', emoji:'📚', nazov:'Septembrový nábor — návrat do rutiny', dopad:'vysoky',
      od:y=>YMD(y,8,20), do:y=>YMD(y,9,20), start:y=>YMD(y,8,20),
      preco:'Deti idú do školy, mamy majú zase svoj čas a hľadajú si aktivitu. Zároveň sa napĺňajú detské skupiny na celý školský rok.',
      kampan:{
        nazov:'September — nový rozvrh, nový začiatok',
        ponuka:'Dospelí: prvý týždeň zadarmo. Deti: zápis do Zumba Kids 1 (4–6) / Kids 2 (7–14) na školský rok.',
        publikum:'Mamy 25–45 v okolí miest, rodičia detí, leady z leta, odídené klientky.',
        kanaly:['Meta reklama (dve kampane — dospelí a deti)','Storky','E-mail databáze','Letáky do škôl a škôlok'],
      },
      kroky:[
        {d:21, text:'Doladiť rozvrh na školský rok — mestá, časy, tréneri. Reklama musí viesť na hotový rozvrh.'},
        {d:14, text:'Dve oddelené kampane: dospelí a Kids. Nemiešaj ich — iné publikum aj iný text.'},
        {d:10, text:'Spusti Kids kampaň skôr než dospelácku — rodičia plánujú krúžky už v auguste.'},
        {d:7,  text:'E-mail celej databáze s novým rozvrhom + oznam v appke.'},
        {d:0,  text:'Štart naplno. Sleduj obsadenosť Kids skupín, pri záujme otvor druhú skupinu.'},
      ],
    },
    {
      key:'vianocne-poukazy', emoji:'🎁', nazov:'Vianočné darčeky', dopad:'vysoky',
      od:y=>YMD(y,11,25), do:y=>YMD(y,12,23), start:y=>YMD(y,11,25),
      preco:'Ľudia hľadajú darček, ktorý nie je ďalšia vec do skrine. Členstvo ako darček zároveň privedie človeka, ktorý by sám neprišiel.',
      kampan:{
        nazov:'Darček, ktorý sa hýbe',
        ponuka:'Darčekový promo kód na mesačné členstvo alebo balík vstupov, doručený e-mailom (funguje aj na poslednú chvíľu).',
        publikum:'Meta: široké okolie, aj muži 30–60 („darček pre ňu“). Vlastné členky — darček pre kamošku, mamu, sestru.',
        kanaly:['Meta reklama','E-mail databáze (2–3×)','Storky','Oznam v appke','Na hodinách'],
      },
      kroky:[
        {d:14, text:'Priprav darčekové promo kódy a návod, ako sa uplatnia. Otestuj uplatnenie naostro.'},
        {d:7,  text:'Kreatívy s darčekovým vizuálom (reálne fotky, nie AI). Spusti kampaň.'},
        {d:3,  text:'E-mail databáze + storky. Zdôrazni okamžité doručenie e-mailom.'},
        {d:0,  text:'Posledné dni: „stihneš to ešte dnes“ — najsilnejšia výzva je 22.–23. 12.'},
      ],
    },
    {
      key:'letny-utlm', emoji:'🏖️', nazov:'Letný útlm — prázdniny', dopad:'stredny',
      od:y=>YMD(y,7,1), do:y=>YMD(y,8,19), start:y=>YMD(y,6,20),
      preco:'Ľudia sú preč, účasť klesá. Nemá zmysel pumpovať rozpočet do náboru — má zmysel udržať členky a pripraviť september.',
      kampan:{
        nazov:'Leto — udrž, nenaháňaj',
        ponuka:'Online hodiny a záznamy pre tie, čo cestujú. Žiadna veľká akvizičná kampaň.',
        publikum:'Existujúce členky — udržanie, aby v septembri neodišli.',
        kanaly:['Oznam v appke','E-mail členkám','Storky z dovoleniek klientok'],
      },
      kroky:[
        {d:14, text:'Zníž rozpočet akvizičných kampaní. Peniaze si nechaj na september.'},
        {d:7,  text:'Oznám letný rozvrh a online alternatívu — členky musia vedieť, že sa nemusia odhlásiť.'},
        {d:0,  text:'Sleduj odhlásenia odberov. Komu končí členstvo v lete, ponúkni pauzu namiesto zrušenia.'},
      ],
    },
    {
      key:'vencek-sezona', emoji:'🎓', nazov:'Venčeková sezóna — oslovovanie škôl', dopad:'vysoky',
      od:y=>YMD(y,9,1), do:y=>YMD(y,11,30), start:y=>YMD(y,9,1),
      preco:'O venčeku rozhoduje vedenie školy na jeseň. Kto osloví v septembri až novembri, má skupinu; v januári je neskoro.',
      kampan:{
        nazov:'Posledný tanec — oslovenie základných škôl',
        ponuka:'Venčekový kurz pre deviatakov, škola nič neorganizuje. Cena individuálne podľa počtu žiakov a oblasti.',
        publikum:'Riaditelia a triedni učitelia 8. a 9. ročníkov v okolí (admin → Venčeky).',
        kanaly:['E-mailový drip na školy (25/deň od 9:00)','Telefonát po otvorení mailu','Landing /programy/posledny-tanec.html'],
      },
      kroky:[
        {d:14, text:'Aktualizuj zoznam škôl a kontaktov (admin → Venčeky → Školy a skupiny).'},
        {d:7,  text:'Over, že landing a dopytový formulár fungujú a že drip má správne texty.'},
        {d:0,  text:'Spusti drip. Každý týždeň prejdi, ktoré školy mail otvorili alebo klikli — tým zavolaj.'},
      ],
    },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // 4) PRAVIDELNÉ INTERNÉ TERMÍNY
  // ═══════════════════════════════════════════════════════════════════════════
  const INTERNE = [
    {
      key:'koniec-mesiaca', emoji:'📊', nazov:'Koniec mesiaca — uzávierka', dopad:'stredny',
      kedyVMesiaci:(y,m)=>poslednyDenMesiaca(y,m),
      preco:'Uzávierka ambasádorských objemov, vyhlásenie Klientky mesiaca, podklady pre účtovníčku a výplaty trénerov.',
      kampan:null,
      kroky:[
        {d:7, text:'Pozri, komu končí členstvo v novom mesiaci (Fusion AI → príležitosti), a ozvi sa im ešte pred koncom.'},
        {d:3, text:'Skontroluj neúspešné platby (Peniaze → Neúspešné) — ideálne ich vyriešiť pred uzávierkou.'},
        {d:1, text:'Priprav vyhlásenie Klientky mesiaca a súhrn pre trénerov.'},
        {d:0, text:'Uzávierka: ambasádorské objemy, podklady pre účtovníčku, výplaty trénerov.'},
      ],
    },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // 5) ŠKOLSKÉ PRÁZDNINY — v nastaveniach, lebo sa každý rok menia
  //    Predvyplnené pre šk. rok 2026/2027, Banskobystrický kraj. Termíny si
  //    pred novým školským rokom over na minedu.sk a prepíš v Nastaveniach.
  // ═══════════════════════════════════════════════════════════════════════════
  const PRAZDNINY_DEFAULT = {
    rok: '2026/2027',
    kraj: 'Banskobystrický',
    polozky: [
      { nazov:'Jesenné prázdniny',    od:'2026-10-29', do:'2026-10-30' },
      { nazov:'Vianočné prázdniny',   od:'2026-12-23', do:'2027-01-07' },
      { nazov:'Jarné prázdniny',      od:'2027-02-15', do:'2027-02-19' },
      { nazov:'Veľkonočné prázdniny', od:'2027-03-25', do:'2027-03-30' },
      { nazov:'Letné prázdniny',      od:'2027-07-01', do:'2027-08-31' },
    ],
  };

  async function config(){
    const s = await q.one(db.settings,{key:'planovac_config'}).catch(()=>null);
    const v = (s && s.value) || {};
    return {
      hodina: Number.isFinite(+v.hodina) ? +v.hodina : 8,
      dni_dopredu: Number.isFinite(+v.dni_dopredu) ? +v.dni_dopredu : 120,
      mail: v.mail !== false,
      prazdniny: (v.prazdniny && Array.isArray(v.prazdniny.polozky)) ? v.prazdniny : PRAZDNINY_DEFAULT,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GENEROVANIE KALENDÁRA
  // ═══════════════════════════════════════════════════════════════════════════

  // Ktoré prezenčné hodiny padnú na daný dátum (online idú aj cez sviatok).
  // Pozor: časť online hodín má kategóriu „Zumba“ a rozlíši ich len location='Online'.
  function hodinyNaDatum(classes, cancels, datum){
    const wd = dowOf(datum);
    return classes.filter(c => c.active && c.day_of_week===wd
        && c.category!=='Online' && c.location!=='Online'
        && (!c.only_date || c.only_date===datum))
      .map(c => ({
        id:c._id, nazov:c.name, mesto:c.location||'?', cas:c.time_start||'',
        zrusena: cancels.some(x => x.class_id===c._id && x.date===datum),
      }))
      .sort((a,b)=> (a.mesto+a.cas).localeCompare(b.mesto+b.cas,'sk'));
  }

  async function kalendar(odISO, doISO){
    const [classes, cancels, evs, vecery] = await Promise.all([
      q.find(db.classes,{}),
      q.find(db.class_cancellations,{ date:{ $gte:odISO, $lte:doISO } }).catch(()=>[]),
      db.ev_events ? q.find(db.ev_events,{}).catch(()=>[]) : Promise.resolve([]),
      db.vencek_vecery ? q.find(db.vencek_vecery,{}).catch(()=>[]) : Promise.resolve([]),
    ]);
    const cfg = await config();
    const rokOd=+odISO.slice(0,4), rokDo=+doISO.slice(0,4);
    const out=[];
    // Viacdňové položky (okná, prázdniny, predĺžené víkendy) pustíme dnu aj vtedy,
    // keď sa už rozbehli — inak by práve prebiehajúca vlna z prehľadu zmizla.
    const push = o => {
      const vnutri = o.obdobie
        ? (o.obdobie.od <= doISO && o.obdobie.do >= odISO)
        : (o.datum >= odISO && o.datum <= doISO);
      if(vnutri) out.push(o);
    };

    for(let y=rokOd; y<=rokDo; y++){
      // ── sviatky ──
      for(const s of SVIATKY){
        const datum=s.kedy(y);
        const hod = s.volno ? hodinyNaDatum(classes, cancels, datum) : [];
        const nezrusene = hod.filter(h=>!h.zrusena);
        push({
          kluc:'sviatok:'+s.key+':'+datum, typ:'sviatok', emoji: s.volno?'🎌':'📌',
          datum, nazov:s.nazov, dopad: (s.volno && nezrusene.length) ? 'vysoky' : 'nizky',
          preco: s.volno
            ? 'Deň pracovného pokoja — ľudia sú s rodinou, účasť býva minimálna.'
            : 'Štátny sviatok, ale pracovný deň — prevádzka beží normálne.',
          prevadzka: s.volno
            ? (hod.length
                ? ('V tento deň máš v rozvrhu '+hod.length+' '+pocet(hod.length,'hodinu','hodiny','hodín')+': '
                    +hod.map(h=>h.mesto+' '+h.cas).join(', ')+'. '
                    +(nezrusene.length
                        ? (hod.length===1
                            ? 'Zatiaľ nie je zrušená.'
                            : (nezrusene.length===1
                                ? 'Jedna z nich zatiaľ nie je zrušená.'
                                : nezrusene.length+' z nich zatiaľ '+pocet(nezrusene.length,'nie je zrušená','nie sú zrušené','nie je zrušených')+'.'))
                        : (hod.length===1 ? 'Je už zrušená. ✅' : 'Všetky sú už zrušené. ✅')))
                : 'V tento deň nemáme v rozvrhu žiadnu prezenčnú hodinu.')
            : null,
          hodiny: hod, kampan:null,
          kroky: (s.volno && hod.length)
            ? [{d:14, text:'Rozhodni, či hodiny v tento deň budú. Ak nie, zruš ich v rozvrhu — appka sama pošle oznam a predĺži členstvá prihláseným.'},
               {d:3,  text:'Pripomeň členkám, či hodina je alebo nie je — ušetríš si telefonáty.'}]
            : [],
        });
      }
      // ── jednodňové príležitosti ──
      for(const p of PRILEZITOSTI){
        const datum=p.kedy(y);
        push({ kluc:'prilezitost:'+p.key+':'+datum, typ:'prilezitost', emoji:p.emoji, datum,
          nazov:p.nazov, dopad:p.dopad, preco:p.preco, kampan:p.kampan, kroky:p.kroky, hodiny:[] });
      }
      // ── sezónne okná (udalosť = štart okna) ──
      for(const o of OKNA){
        const start=o.start(y);
        push({ kluc:'okno:'+o.key+':'+start, typ:'okno', emoji:o.emoji, datum:start,
          nazov:o.nazov, dopad:o.dopad, preco:o.preco, kampan:o.kampan, kroky:o.kroky,
          obdobie:{od:o.od(y), do:o.do(y)}, hodiny:[] });
      }
      // ── interné mesačné ──
      for(let m=1;m<=12;m++){
        for(const i of INTERNE){
          const datum=i.kedyVMesiaci(y,m);
          push({ kluc:'interne:'+i.key+':'+datum, typ:'interne', emoji:i.emoji, datum,
            nazov:i.nazov+' — '+MES[m-1], dopad:i.dopad, preco:i.preco, kampan:i.kampan,
            kroky:i.kroky, hodiny:[] });
        }
      }
    }

    // ── školské prázdniny z nastavení ──
    for(const p of (cfg.prazdniny.polozky||[])){
      if(!p.od) continue;
      push({ kluc:'prazdniny:'+p.od, typ:'prazdniny', emoji:'🏫', datum:p.od,
        nazov:p.nazov+' ('+cfg.prazdniny.kraj+' kraj)', dopad:/letné/i.test(p.nazov)?'vysoky':'stredny',
        preco:'Deti sú doma, rodiny cestujú. Detské hodiny a venčeky treba vyriešiť dopredu, dospelácka účasť klesá.',
        obdobie:{od:p.od, do:p.do||p.od}, kampan:null, hodiny:[],
        kroky:[
          {d:14, text:'Rozhodni, či Zumba Kids a venčekové skupiny počas prázdnin bežia. Ak nie, zruš hodiny v rozvrhu.'},
          {d:7,  text:'Oznám rodičom, ako to bude — inak budú volať.'},
          {d:0,  text:'Počas prázdnin netlač akvizičnú reklamu na detské hodiny.'},
        ]});
    }

    // ── interné z DB: eventy ──
    for(const e of (evs||[])){
      const datum=String(e.date||e.datum||'').slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(datum)) continue;
      push({ kluc:'event:'+(e.slug||e._id)+':'+datum, typ:'event', emoji:'🎟️', datum,
        nazov:e.name||'Event', dopad:'vysoky',
        preco:'Vlastný event — predaj vstupeniek beží cez appku, propagácia je celá na nás.',
        kampan:{ nazov:'Propagácia eventu: '+(e.name||''), ponuka:'Vstupenky cez appku a web.',
          publikum:'Členky, ich kamošky, leady v okolí, minuloroční účastníci.',
          kanaly:['Facebook event','Meta reklama','Storky','E-mail databáze','Ambasádorky','Na hodinách'] },
        hodiny:[],
        kroky:[
          {d:30, text:'Založ Facebook event, spusti predaj vstupeniek, priprav vizuál.'},
          {d:21, text:'Prvá vlna: e-mail databáze + storky + oznam v appke.'},
          {d:14, text:'Spusti Meta reklamu na event. Zapoj ambasádorky.'},
          {d:7,  text:'Druhá vlna e-mailu tým, čo nekúpili. Skontroluj stav predaja a prípadne prilož rozpočet.'},
          {d:3,  text:'Posledná výzva + organizačné info prihláseným (čas, miesto, parkovanie).'},
          {d:1,  text:'Pripomienka s QR vstupenkou. Priprav check-in na mieste.'},
        ]});
    }
    // ── interné z DB: venčekové večery ──
    for(const v of (vecery||[])){
      const datum=String(v.datum||v.date||'').slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(datum)) continue;
      push({ kluc:'vecer:'+v._id+':'+datum, typ:'vecer', emoji:'🎓', datum,
        nazov:'Venčekový večer — '+(v.nazov||v.skupina||''), dopad:'vysoky',
        preco:'Najväčší deň pre venčekovú skupinu. Rodičia v sále sú zároveň najlepšie publikum, aké budeme mať pokope.',
        kampan:null, hodiny:[],
        kroky:[
          {d:21, text:'Prejdi prípravu v admin → Venčeky → Venčekový večer: páry, program, diplomy.'},
          {d:14, text:'Potvrď tím a techniku. Pošli rodičom organizačné info.'},
          {d:7,  text:'Skúška programu, tlač diplomov a scenára.'},
          {d:1,  text:'Pripomienky cez push, finálna kontrola techniky.'},
          {d:0,  text:'Foto a video (so súhlasom rodičov) — najlepší materiál na nábor ďalších škôl.'},
        ]});
    }

    // ── predĺžené víkendy ──
    // Zlepíme susediace voľné dni (víkend + sviatky s pracovným pokojom) do blokov.
    // Udalosť vznikne, len keď je blok aspoň trojdňový — bežná sobota s nedeľou nie je správa.
    const volna=new Set();
    for(let y=rokOd-1; y<=rokDo+1; y++) for(const s of SVIATKY) if(s.volno) volna.add(s.kedy(y));
    const bloky=[]; let blok=null;
    for(let d=addD(odISO,-5); d<=addD(doISO,5); d=addD(d,1)){
      const w=dowOf(d);
      if(volna.has(d) || w===0 || w===6){ if(blok) blok.do=d; else blok={od:d, do:d}; }
      else if(blok){ bloky.push(blok); blok=null; }
    }
    if(blok) bloky.push(blok);
    for(const b of bloky){
      const dlzka=diff(b.od,b.do)+1;
      if(dlzka<3) continue;
      push({ kluc:'vikend:'+b.od, typ:'vikend', emoji:'🧳', datum:b.od,
        nazov:'Predĺžený víkend — '+dlzka+' '+pocet(dlzka,'deň','dni','dní')+' voľna ('+skKratko(b.od)+'–'+skKratko(b.do)+')',
        dopad:'stredny',
        preco:'Ľudia cestujú. Účasť na hodinách klesá a reklama v tieto dni horšie konvertuje.',
        obdobie:{od:b.od, do:b.do},
        kampan:{ nazov:'Prispôsob sa víkendu', ponuka:'Žiadna nová ponuka — radšej zníž rozpočet a pusti online hodinu.',
          publikum:'Členky, ktoré ostávajú doma.', kanaly:['Online hodina / záznam','Oznam v appke'] },
        hodiny:[],
        kroky:[
          {d:10, text:'Rozhodni, ktoré hodiny cez predĺžený víkend budú a ktoré zrušíš.'},
          {d:5,  text:'Zníž rozpočet reklamy na tieto dni, presuň ho na nasledujúci týždeň.'},
          {d:2,  text:'Oznám členkám, čo beží, a ponúkni online alternatívu.'},
        ]});
    }

    out.sort((a,b)=> a.datum<b.datum?-1 : a.datum>b.datum?1 : 0);
    return out;
  }

  // ── stav (odškrtnuté kroky, skryté položky, poznámky) ──────────────────────
  async function stavy(){
    const rows = await q.find(db.planovac,{ _k:'stav' });
    const map={}; for(const r of rows) map[r.key]=r;
    return map;
  }
  async function vlastne(odISO, doISO){
    const rows = await q.find(db.planovac,{ _k:'akcia' });
    return rows.filter(r=>r.datum>=odISO && r.datum<=doISO).map(r=>({
      kluc:'vlastna:'+r._id, id:r._id, typ:'vlastna', emoji:r.emoji||'⭐', datum:r.datum,
      nazov:r.nazov, dopad:r.dopad||'stredny', preco:r.popis||'', kampan:r.kampan||null, hodiny:[],
      kroky: (Array.isArray(r.kroky)&&r.kroky.length) ? r.kroky
           : [{d:7,text:'Priprav akciu.'},{d:1,text:'Posledná kontrola.'}],
    }));
  }

  // Celý pohľad: udalosti + stav krokov + čo treba spraviť dnes.
  async function pohlad(dni){
    const dnes=T();
    const odD=addD(dnes,-3), doD=addD(dnes, dni||120);
    const [zoznam, st, vl] = await Promise.all([ kalendar(odD, doD), stavy(), vlastne(odD, doD) ]);
    const vsetko=[...zoznam, ...vl].sort((a,b)=> a.datum<b.datum?-1:1);
    const dnesKroky=[], najblizsie=[], prebiehajuce=[], polozky=[];
    for(const u of vsetko){
      const s=st[u.kluc]||{};
      if(s.stav==='skryte') continue;
      if(u.obdobie && u.obdobie.do < dnes) continue;   // okno, ktoré už skončilo, netreba
      const doUdalosti=diff(dnes,u.datum);
      const kroky=(u.kroky||[]).map(k=>{
        const termin=addD(u.datum, -k.d);
        const hotovo=!!(s.kroky && s.kroky[String(k.d)]);
        return { d:k.d, text:k.text, termin, hotovo,
          meska: (termin<dnes && !hotovo && u.datum>=dnes), dnes: termin===dnes };
      });
      const prebieha = !!(u.obdobie && u.obdobie.od<=dnes && u.obdobie.do>=dnes);
      const p={ ...u, do_udalosti:doUdalosti, prebieha, stav:s.stav||'planuje', poznamka:s.poznamka||'',
        kroky, hotovych:kroky.filter(k=>k.hotovo).length, spolu:kroky.length };
      polozky.push(p);
      if(prebieha) prebiehajuce.push(p);
      for(const k of kroky){
        if(k.hotovo) continue;
        if(k.termin===dnes) dnesKroky.push({ kluc:u.kluc, nazov:u.nazov, emoji:u.emoji, datum:u.datum, d:k.d, text:k.text, meska:false });
        else if(k.meska && k.termin>=addD(dnes,-14)) dnesKroky.push({ kluc:u.kluc, nazov:u.nazov, emoji:u.emoji, datum:u.datum, d:k.d, text:k.text, meska:true });
      }
      if(doUdalosti>=0 && doUdalosti<=14) najblizsie.push(p);
    }
    dnesKroky.sort((a,b)=> (a.meska===b.meska) ? (a.datum<b.datum?-1:1) : (a.meska?-1:1));
    return { dnes, polozky, dnes_kroky:dnesKroky, najblizsich_14:najblizsie, prebiehajuce };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ENDPOINTY (len admin)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/api/admin/planovac', adminAuth, async(req,res)=>{
    try{
      const cfg=await config();
      const p=await pohlad(Math.min(400, +req.query.dni || cfg.dni_dopredu));
      res.json({ ok:true, ...p, config:cfg });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // Odškrtnutie kroku / zmena stavu / poznámka
  app.post('/api/admin/planovac/stav', adminAuth, async(req,res)=>{
    try{
      const key=String(req.body.key||'').slice(0,160);
      if(!key) return res.status(400).json({error:'Chýba key'});
      const cur=await q.one(db.planovac,{_k:'stav', key}) || { _k:'stav', key, kroky:{}, stav:'planuje' };
      if(req.body.krok!=null){ cur.kroky=cur.kroky||{}; cur.kroky[String(req.body.krok)] = !!req.body.hotovo; }
      if(req.body.stav) cur.stav=String(req.body.stav).slice(0,20);
      if(req.body.poznamka!=null) cur.poznamka=String(req.body.poznamka).slice(0,1000);
      cur.updated_at=nowISO();
      if(cur._id) await q.update(db.planovac,{_id:cur._id},{$set:cur});
      else await q.insert(db.planovac, cur);
      res.json({ok:true});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // Vlastná akcia
  app.post('/api/admin/planovac/akcia', adminAuth, async(req,res)=>{
    try{
      const datum=String(req.body.datum||'').slice(0,10);
      const nazov=String(req.body.nazov||'').slice(0,120).trim();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !nazov) return res.status(400).json({error:'Zadaj dátum a názov.'});
      const kroky=Array.isArray(req.body.kroky) ? req.body.kroky.filter(k=>k&&k.text).slice(0,12)
        .map(k=>({ d:Math.max(0,Math.min(180,+k.d||0)), text:String(k.text).slice(0,300) })) : [];
      const r=await q.insert(db.planovac,{ _k:'akcia', datum, nazov,
        popis:String(req.body.popis||'').slice(0,1000), emoji:String(req.body.emoji||'⭐').slice(0,4),
        dopad:['vysoky','stredny','nizky'].includes(req.body.dopad)?req.body.dopad:'stredny',
        kroky, created_at:nowISO() });
      res.json({ok:true, id:r._id});
    }catch(e){ res.status(500).json({error:e.message}); }
  });
  app.delete('/api/admin/planovac/akcia/:id', adminAuth, async(req,res)=>{
    try{ await q.remove(db.planovac,{_k:'akcia', _id:req.params.id},{}); res.json({ok:true}); }
    catch(e){ res.status(500).json({error:e.message}); }
  });

  // Nastavenia (hodina upozornenia, prázdniny)
  app.post('/api/admin/planovac/config', adminAuth, async(req,res)=>{
    try{
      const v={ ...(await config()) };
      if(req.body.hodina!=null) v.hodina=Math.max(0,Math.min(23,+req.body.hodina||0));
      if(req.body.dni_dopredu!=null) v.dni_dopredu=Math.max(30,Math.min(400,+req.body.dni_dopredu||120));
      if(req.body.mail!=null) v.mail=!!req.body.mail;
      if(req.body.prazdniny && Array.isArray(req.body.prazdniny.polozky)){
        v.prazdniny={ rok:String(req.body.prazdniny.rok||'').slice(0,20),
          kraj:String(req.body.prazdniny.kraj||'Banskobystrický').slice(0,30),
          polozky:req.body.prazdniny.polozky
            .filter(p=>p && /^\d{4}-\d{2}-\d{2}$/.test(String(p.od||'')))
            .slice(0,12)
            .map(p=>({ nazov:String(p.nazov||'Prázdniny').slice(0,60), od:String(p.od).slice(0,10), do:String(p.do||p.od).slice(0,10) })) };
      }
      const s=await q.one(db.settings,{key:'planovac_config'});
      if(s) await q.update(db.settings,{key:'planovac_config'},{$set:{value:v, at:nowISO()}});
      else await q.insert(db.settings,{key:'planovac_config', value:v, at:nowISO()});
      res.json({ok:true, config:v});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  app.post('/api/admin/planovac/run-daily', adminAuth, async(req,res)=>{
    try{ res.json({ok:true, ...(await dennyJob(true))}); }
    catch(e){ res.status(500).json({error:e.message}); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DENNÉ UPOZORNENIE
  // ═══════════════════════════════════════════════════════════════════════════
  function textUpozornenia(p, vyhlad){
    const dnes=p.dnes, L=[];
    L.push('PLÁNOVAČ · '+DNI[dowOf(dnes)]+' '+sk(dnes));
    L.push('');
    if(p.dnes_kroky.length){
      L.push('NA DNES:');
      for(const k of p.dnes_kroky)
        L.push('· '+(k.meska?'[MEŠKÁ] ':'')+k.emoji+' '+k.nazov+' ('+skKratko(k.datum)+', o '
          +diff(dnes,k.datum)+' '+pocet(diff(dnes,k.datum),'deň','dni','dní')+') — '+k.text);
    } else L.push('Na dnes nič nehorí. 👌');
    if(p.prebiehajuce && p.prebiehajuce.length){
      L.push(''); L.push('PRÁVE PREBIEHA:');
      for(const u of p.prebiehajuce) L.push('· '+u.emoji+' '+u.nazov+' (do '+skKratko(u.obdobie.do)+')'
        +(u.kampan?' — '+u.kampan.nazov:''));
    }
    if(vyhlad && vyhlad.length){
      L.push(''); L.push('NAJBLIŽŠIE:');
      for(const u of vyhlad) L.push('· '+skKratko(u.datum)+' '+u.emoji+' '+u.nazov
        +(u.kampan?' — kampaň: '+u.kampan.nazov:'')
        +(u.spolu?' ('+u.hotovych+'/'+u.spolu+' krokov hotových)':''));
    }
    return L.join('\n');
  }

  async function dennyJob(nasilu){
    const cfg=await config();
    const dnes=T();
    if(!nasilu){
      if(hodinaTeraz() < cfg.hodina) return { preskocene:'skoro' };
      const guard='planovac_sent_'+dnes;
      if(await q.one(db.settings,{key:guard})) return { preskocene:'uz_islo' };
      await q.insert(db.settings,{key:guard, value:true, at:nowISO()});
    }
    const p=await pohlad(cfg.dni_dopredu);
    const jePondelok = dowOf(dnes)===1;
    const vyhlad = jePondelok ? p.najblizsich_14 : p.najblizsich_14.filter(u=>u.do_udalosti<=3);
    if(!p.dnes_kroky.length && !vyhlad.length) return { poslane:0, dovod:'nič na dnes' };

    const text=textUpozornenia(p, vyhlad);
    const admins=(await q.find(db.users,{is_admin:true})).filter(a=>!/@(test-fa-qa|qa-biz)\.local$/i.test(a.email||''));
    const kratko = p.dnes_kroky.length
      ? p.dnes_kroky.length+' '+(p.dnes_kroky.length===1?'krok':'krokov')+' na dnes · najbližšie: '
        +(p.najblizsich_14[0] ? p.najblizsich_14[0].nazov+' ('+skKratko(p.najblizsich_14[0].datum)+')' : '—')
      : 'Výhľad na najbližšie dni — otvor Plánovač v admine.';
    for(const a of admins)
      await q.insert(db.notifications,{ user_id:a._id, type:'planovac',
        title:'🗓️ Plánovač — na čo sa pripraviť', body:kratko, read:false, created_at:nowISO() }).catch(()=>{});

    if(cfg.mail && typeof sendMail==='function'){
      const html=emailTemplate('🗓️ Plánovač akcií a kampaní',
        '<pre style="white-space:pre-wrap;font-family:inherit;margin:0">'+esc(text)+'</pre>',
        'Otvoriť plánovač', APP_URL+'/admin');
      for(const a of admins)
        if(a.email && !/@(test-fa-qa|qa-biz)\.local$/i.test(a.email))
          await sendMail(a.email, '🗓️ Plánovač — '+sk(dnes), html).catch(()=>{});
    }
    return { poslane:admins.length, krokov:p.dnes_kroky.length, text };
  }

  setInterval(()=>dennyJob(false).catch(e=>console.error('planovac:', e.message)), 10*60*1000);
  setTimeout(()=>dennyJob(false).catch(()=>{}), 35*1000);

  console.log('🗓️  Plánovač akcií a kampaní načítaný');
  return { kalendar, pohlad, dennyJob };
};
