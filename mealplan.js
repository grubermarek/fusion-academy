// ── Generátor jedálnička na mieru (pravidlový, bez externých služieb) ──────────
// Vstup: profil klientky (ciele, miery, preferencie, alergény). Výstup: 7-dňový
// jedálniček prispôsobený jej kalorickému cieľu a obmedzeniam.

// Odstráni diakritiku a znormalizuje text na porovnávanie kľúčových slov.
function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); }

// Databáza jedál. tags: alergény/atribúty. veg=vegetariánske, vegan=vegánske.
// kcal a protein sú približné hodnoty na porciu.
const FOODS = [
  // ─── RAŇAJKY ───────────────────────────────────────────────────────────────
  {slot:'ranajky', name:'Ovsená kaša s ovocím a orechami', kcal:380, protein:12, veg:true, vegan:true, tags:['lepok','orechy'], desc:'Ovsené vločky, banán, čučoriedky, vlašské orechy, škorica'},
  {slot:'ranajky', name:'Grécky jogurt s granolou a medom', kcal:340, protein:20, veg:true, vegan:false, tags:['laktoza','lepok','orechy'], desc:'Biely grécky jogurt, domáca granola, med, čerstvé ovocie'},
  {slot:'ranajky', name:'Praženica z 3 vajec so zeleninou', kcal:320, protein:22, veg:true, vegan:false, tags:['vajcia'], desc:'Vajcia, paprika, špenát, cherry paradajky, trocha olivového oleja'},
  {slot:'ranajky', name:'Celozrnný toast s avokádom a vajcom', kcal:400, protein:18, veg:true, vegan:false, tags:['lepok','vajcia'], desc:'Celozrnné pečivo, avokádo, pošírované vajce, reďkovka'},
  {slot:'ranajky', name:'Tvarohová pomazánka s ražným chlebom', kcal:330, protein:24, veg:true, vegan:false, tags:['laktoza','lepok'], desc:'Nízkotučný tvaroh, pažítka, reďkovka, ražný chlieb'},
  {slot:'ranajky', name:'Proteínové lievance s ovocím', kcal:390, protein:26, veg:true, vegan:false, tags:['lepok','vajcia','laktoza'], desc:'Ovsená múka, tvaroh, vajce, banán, javorový sirup'},
  {slot:'ranajky', name:'Chia puding s kokosovým mliekom', kcal:300, protein:9, veg:true, vegan:true, tags:['orechy'], desc:'Chia semienka, kokosové mlieko, mango, kokosové lupienky'},
  {slot:'ranajky', name:'Vločky s rastlinným mliekom a arašidmi', kcal:360, protein:14, veg:true, vegan:true, tags:['lepok','orechy'], desc:'Ovsené vločky, sójové/mandľové mlieko, arašidové maslo, jablko'},
  {slot:'ranajky', name:'Šunkovo-syrový omeleta wrap', kcal:410, protein:28, veg:false, vegan:false, tags:['vajcia','laktoza','lepok'], desc:'Vajcia, chudá šunka, syr, celozrnná tortilla, rukola'},

  // ─── DESIATA ───────────────────────────────────────────────────────────────
  {slot:'desiata', name:'Jablko a hrsť mandlí', kcal:180, protein:6, veg:true, vegan:true, tags:['orechy'], desc:'Stredné jablko + 20 g mandlí'},
  {slot:'desiata', name:'Grécky jogurt s čučoriedkami', kcal:150, protein:15, veg:true, vegan:false, tags:['laktoza'], desc:'Biely jogurt + hrsť čučoriedok'},
  {slot:'desiata', name:'Proteínová tyčinka', kcal:200, protein:20, veg:true, vegan:false, tags:['laktoza','orechy'], desc:'Domáca alebo kupovaná proteínová tyčinka'},
  {slot:'desiata', name:'Zeleninové tyčinky s hummusom', kcal:170, protein:7, veg:true, vegan:true, tags:['soja'], desc:'Mrkva, uhorka, paprika + hummus'},
  {slot:'desiata', name:'Banán s arašidovým maslom', kcal:210, protein:8, veg:true, vegan:true, tags:['orechy'], desc:'Banán + lyžica arašidového masla'},
  {slot:'desiata', name:'Cottage syr s paradajkami', kcal:140, protein:16, veg:true, vegan:false, tags:['laktoza'], desc:'Cottage cheese, cherry paradajky, čierne korenie'},
  {slot:'desiata', name:'Ryžové chlebíčky s tvarohom', kcal:160, protein:12, veg:true, vegan:false, tags:['laktoza'], desc:'Ryžové chlebíčky, tvaroh, pažítka'},

  // ─── OBED ──────────────────────────────────────────────────────────────────
  {slot:'obed', name:'Grilované kuracie prsia s batátmi', kcal:520, protein:42, veg:false, vegan:false, tags:[], desc:'Kuracie prsia, pečené batáty, brokolica'},
  {slot:'obed', name:'Losos s quinoou a špenátom', kcal:540, protein:38, veg:false, vegan:false, tags:['ryby'], desc:'Pečený losos, quinoa, dusený špenát, citrón'},
  {slot:'obed', name:'Hovädzí steak so zeleninou a zemiakmi', kcal:560, protein:44, veg:false, vegan:false, tags:[], desc:'Chudý hovädzí steak, grilovaná zelenina, varené zemiaky'},
  {slot:'obed', name:'Cestoviny s morčacím mäsom a paradajkami', kcal:530, protein:36, veg:false, vegan:false, tags:['lepok'], desc:'Celozrnné cestoviny, morčacie, paradajková omáčka, bazalka'},
  {slot:'obed', name:'Šošovicový dhal s ryžou', kcal:480, protein:22, veg:true, vegan:true, tags:[], desc:'Červená šošovica, kokosové mlieko, kari korenie, basmati ryža'},
  {slot:'obed', name:'Cícerový falafel s bulgurom', kcal:500, protein:20, veg:true, vegan:true, tags:['lepok'], desc:'Pečený falafel, bulgur, uhorkovo-paradajkový šalát, tahini'},
  {slot:'obed', name:'Kuracie stir-fry s ryžou', kcal:510, protein:38, veg:false, vegan:false, tags:['soja'], desc:'Kuracie, mix zeleniny, sójová omáčka, jazmínová ryža'},
  {slot:'obed', name:'Tofu s hnedou ryžou a zeleninou', kcal:470, protein:24, veg:true, vegan:true, tags:['soja'], desc:'Marinované tofu, hnedá ryža, dusená zelenina'},
  {slot:'obed', name:'Zeleninové rizoto s parmezánom', kcal:490, protein:16, veg:true, vegan:false, tags:['laktoza'], desc:'Arborio ryža, hríby, cuketa, parmezán'},
  {slot:'obed', name:'Bravčová panenka s pečenou zeleninou', kcal:540, protein:40, veg:false, vegan:false, tags:[], desc:'Bravčová panenka, pečená koreňová zelenina, zemiaky'},

  // ─── OLOVRANT ──────────────────────────────────────────────────────────────
  {slot:'olovrant', name:'Tvaroh s ovocím', kcal:180, protein:20, veg:true, vegan:false, tags:['laktoza'], desc:'Nízkotučný tvaroh, jahody, škorica'},
  {slot:'olovrant', name:'Hrsť orieškov a sušené marhule', kcal:210, protein:6, veg:true, vegan:true, tags:['orechy'], desc:'Mix orechov + sušené ovocie'},
  {slot:'olovrant', name:'Proteínový smoothie', kcal:220, protein:25, veg:true, vegan:false, tags:['laktoza'], desc:'Srvátkový proteín, banán, mlieko, škorica'},
  {slot:'olovrant', name:'Celozrnný krekr s avokádom', kcal:190, protein:6, veg:true, vegan:true, tags:['lepok'], desc:'Celozrnné krekry, avokádo, cherry paradajky'},
  {slot:'olovrant', name:'Grécky jogurt s medom a orechami', kcal:200, protein:16, veg:true, vegan:false, tags:['laktoza','orechy'], desc:'Grécky jogurt, med, vlašské orechy'},
  {slot:'olovrant', name:'Ovocný šalát', kcal:150, protein:3, veg:true, vegan:true, tags:[], desc:'Mix sezónneho ovocia, mäta, limetka'},
  {slot:'olovrant', name:'Varené vajce a zeleninové tyčinky', kcal:160, protein:12, veg:true, vegan:false, tags:['vajcia'], desc:'2 varené vajcia, mrkva, uhorka'},

  // ─── VEČERA ────────────────────────────────────────────────────────────────
  {slot:'vecera', name:'Pečená treska so šalátom', kcal:380, protein:34, veg:false, vegan:false, tags:['ryby'], desc:'Treska, zmiešaný listový šalát, olivový olej, citrón'},
  {slot:'vecera', name:'Kuracie prsia s grilovanou zeleninou', kcal:400, protein:40, veg:false, vegan:false, tags:[], desc:'Kuracie prsia, cuketa, baklažán, paprika'},
  {slot:'vecera', name:'Omeleta so špenátom a syrom', kcal:360, protein:26, veg:true, vegan:false, tags:['vajcia','laktoza'], desc:'3 vajcia, špenát, feta, cherry paradajky'},
  {slot:'vecera', name:'Cottage syr so zeleninovým šalátom', kcal:300, protein:24, veg:true, vegan:false, tags:['laktoza'], desc:'Cottage cheese, uhorka, paradajky, ražný chlieb'},
  {slot:'vecera', name:'Zeleninový guláš s cícerom', kcal:350, protein:16, veg:true, vegan:true, tags:[], desc:'Cícer, paradajky, paprika, zemiaky, paprika koreninová'},
  {slot:'vecera', name:'Krémová zeleninová polievka a chlieb', kcal:320, protein:10, veg:true, vegan:true, tags:['lepok'], desc:'Brokolicovo-zemiaková polievka, celozrnný chlieb'},
  {slot:'vecera', name:'Tuniakový šalát', kcal:340, protein:32, veg:false, vegan:false, tags:['ryby','vajcia'], desc:'Tuniak, fazuľa, vajce, listový šalát, olivový olej'},
  {slot:'vecera', name:'Morčacie medailónky s brokolicou', kcal:390, protein:38, veg:false, vegan:false, tags:[], desc:'Morčacie, dusená brokolica, batáty'},
  {slot:'vecera', name:'Tofu wok so zeleninou', kcal:340, protein:22, veg:true, vegan:true, tags:['soja'], desc:'Tofu, brokolica, mrkva, sézam, sójová omáčka'},
];

const SLOT_LABEL = {ranajky:'Raňajky', desiata:'Desiata', obed:'Obed', olovrant:'Olovrant', vecera:'Večera'};
const SLOTS_BY_MEALS = {
  3: ['ranajky','obed','vecera'],
  4: ['ranajky','obed','olovrant','vecera'],
  5: ['ranajky','desiata','obed','olovrant','vecera'],
};
const DAYS = ['Pondelok','Utorok','Streda','Štvrtok','Piatok','Sobota','Nedeľa'];

// Herbalife F1 kokteil ako raňajková voľba (Gold benefit).
const F1_MEAL = {slot:'ranajky', name:'Herbalife F1 kokteil', kcal:220, protein:18, veg:true, vegan:false, tags:['laktoza','soja'], desc:'Formula 1 kokteil (~220 kcal, 18 g bielkovín, 23 vitamínov a minerálov) + ovocie'};

// Kalorický cieľ podľa Mifflin-St Jeor.
function calcTargets(p){
  const w=+p.weight_kg||65, h=+p.height_cm||165, a=+p.age||30;
  const male = norm(p.gender)==='muz' || norm(p.gender)==='muž' || norm(p.gender)==='male';
  let bmr = 10*w + 6.25*h - 5*a + (male?5:-161);
  const act = {nizka:1.35, stredna:1.55, vysoka:1.75}[norm(p.activity)] || 1.5;
  let tdee = bmr*act;
  const goal = norm(p.goal);
  let target = tdee;
  if(goal.includes('chudn')) target = tdee - 450;
  else if(goal.includes('naber')) target = tdee + 300;
  target = Math.max(1300, Math.round(target/10)*10);
  const protein = Math.round(w*1.8);
  return { bmr:Math.round(bmr), tdee:Math.round(tdee), kcal:target, protein };
}

// Skontroluje, či jedlo prejde diétnymi a alergénovými filtrami.
function passes(food, p){
  const diet = norm(p.diet);
  if(diet.includes('vegan') && !food.vegan) return false;
  if((diet.includes('vegetar')) && !food.veg) return false;
  if(diet.includes('pescet') && food.tags.includes('maso')) return false; // (info tag; mäso značíme neprítomnosťou veg)
  if(diet.includes('pescet') && !food.veg && !food.tags.includes('ryby')) return false; // mäso von, ryby ok
  // Alergény / intolerancie
  const al = (p.allergens||[]).map(norm);
  for(const tag of food.tags){ if(al.includes(norm(tag))) return false; }
  if(al.includes('bezlepku')||al.includes('lepok')){ if(food.tags.includes('lepok')) return false; }
  if(al.includes('laktoza')||al.includes('bezlaktozy')){ if(food.tags.includes('laktoza')) return false; }
  // Neobľúbené jedlá (voľný text, oddelené čiarkou)
  const dis = norm(p.dislikes).split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);
  const hay = norm(food.name+' '+food.desc);
  if(dis.some(d=>d.length>=3 && hay.includes(d))) return false;
  return true;
}

function shuffle(arr, seed){
  let s = seed||Date.now();
  const rnd = () => { s=(s*9301+49297)%233280; return s/233280; };
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

// Zostaví 7-dňový plán.
function generatePlan(profile){
  const p = profile||{};
  const targets = calcTargets(p);
  const meals = SLOTS_BY_MEALS[+p.meals_per_day] || SLOTS_BY_MEALS[4];
  const likes = norm(p.likes).split(/[,;\n]+/).map(s=>s.trim()).filter(s=>s.length>=3);
  const wantsF1 = !!p.include_f1;

  // Pool jedál pre každý slot po filtrovaní, zoradený tak, aby obľúbené boli vpredu.
  const poolBySlot = {};
  for(const slot of new Set(meals)){
    let pool = FOODS.filter(f=>f.slot===slot && passes(f,p));
    if(slot==='ranajky' && wantsF1 && passes(F1_MEAL,p)) pool = [F1_MEAL, ...pool];
    // preferencie: jedlá obsahujúce obľúbené kľúčové slová dopredu
    pool.sort((a,b)=>{
      const la = likes.some(k=>norm(a.name+' '+a.desc).includes(k))?0:1;
      const lb = likes.some(k=>norm(b.name+' '+b.desc).includes(k))?0:1;
      return la-lb;
    });
    poolBySlot[slot] = pool;
  }

  const seed = Math.floor(Math.random()*1e6);
  // Rotujúci index pre každý slot, aby sa jedlá striedali cez týždeň.
  const rot = {}; const shuffled = {};
  for(const slot of Object.keys(poolBySlot)){
    // ponechaj obľúbené vpredu, zvyšok zamiešaj pre pestrosť
    const pool = poolBySlot[slot];
    const liked = pool.filter(f=>likes.some(k=>norm(f.name+' '+f.desc).includes(k)));
    const rest = shuffle(pool.filter(f=>!liked.includes(f)), seed+slot.length);
    shuffled[slot] = [...liked, ...rest];
    rot[slot]=0;
  }

  const week = DAYS.map(day=>{
    let dayKcal=0, dayProt=0;
    const items = meals.map(slot=>{
      const pool = shuffled[slot];
      let food;
      if(!pool || !pool.length){
        food = {name:'(žiadna vhodná voľba – uprav filtre)', kcal:0, protein:0, desc:''};
      } else {
        food = pool[rot[slot] % pool.length]; rot[slot]++;
      }
      dayKcal += food.kcal||0; dayProt += food.protein||0;
      return { slot, slot_label:SLOT_LABEL[slot]||slot, name:food.name, kcal:food.kcal||0, protein:food.protein||0, desc:food.desc||'' };
    });
    return { day, items, total_kcal:dayKcal, total_protein:dayProt };
  });

  return {
    targets, meals_per_day: meals.length,
    week,
    generated_at: new Date().toISOString(),
    note: 'Orientačný plán. Porcie prispôsob svojej chuti a hladu. Pri zdravotných ťažkostiach sa poraď s lekárom/odborníkom na výživu.'
  };
}

module.exports = { generatePlan, calcTargets };
