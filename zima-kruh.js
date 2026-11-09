// ═══════════════════════════════════════════════════════════════════════════════
// ZIMA V KRUHU NAJBLIŽŠÍCH — akcia na vrátenie klientok (november 2026)
//
// Kto si v novembri vezme alebo obnoví mesačné členstvo a privedie kamošku,
// dostane december zadarmo. Platí pre tie, ktoré u nás ešte neboli, alebo neboli
// na hodine posledné tri mesiace — vrátane Zumba Kids krúžkov, kde rozhoduje
// dochádzka dieťaťa a mail ide rodičovi.
//
// Dve veci sú tu zámerne „ručné":
//  · mail neodíde bez ZIMA_GO=1 v env A bez kliknutia v admine po náhľade
//    (nasadenie nie je schválenie — tú lekciu máme z augusta 2026),
//  · december sa nikomu nepripíše sám. Appka len spočíta, kto si ho zaslúžil;
//    mesiac členstva sú peniaze a automat by sa raz pomýlil. Darovanie ide cez
//    existujúci odauditovaný endpoint grant-membership, nie cez novú cestu.
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = function mountZimaKruh(ctx){
  const { app, db, q, adminAuth, nowISO, APP_URL, sendMail, emailTemplate,
          mailBudgetOk, mailBudgetStav, kampanovyMailZakazany, MEMBERSHIP_PLANS,
          prveZaplateneClenstva, kamoskaPlatna } = ctx;

  const ZIMA = {
    od: '2026-11-09',
    do: '2026-11-30',
    dni_darcek: 30,
    dni_bez_hodiny: 90,        // „neboli na hodine posledné 3 mesiace"
    // Marek 9. 11.: december dostanú OBE — tá, čo kamošku priviedla, aj kamoška.
    // Prepínač riadi aj text mailu a postov, nech sa sľub nerozíde s tým, čo sa dáva.
    aj_kamoska: true,
  };
  const ZIMA_SUBJ = '❄️ Zima v kruhu najbližších — december u nás zadarmo';
  const ZIMA_URL  = APP_URL.replace(/\/$/,'') + '/obchod';
  // Dve desatinné miesta zámerne: 49.9 sa inak vypíše ako „49,9 €", čo vedľa
  // „124,90 €" vyzerá ako iná cena než tá, ktorú klientka pozná z cenníka.
  const CENY = ['bronze','silver','gold']
    .map(k => MEMBERSHIP_PLANS[k].name + ' ' + (+MEMBERSHIP_PLANS[k].price).toFixed(2).replace('.',',') + ' €')
    .join(' · ');

  const den = v => String(v||'').slice(0,10);
  const vOkne = d => !!d && d >= ZIMA.od && d <= ZIMA.do;
  const krstne = u => (String((u&&u.name)||'').trim().split(/\s+/)[0] || 'tanečníčka');
  const datumSk = d => { const [r,m,x] = String(d).split('-'); return +x + '. ' + +m + '. ' + r; };

  // ── Kto kedy naposledy tancoval ────────────────────────────────────────────
  // Z rezervácií so stavom `attended`, nie z `visit_count` — ten sa pri zlučovaní
  // účtov a opravách prepisoval, takže nie je dôkazom o dochádzke.
  async function poslednaHodina(users){
    const zlucenyDo = {};
    for(const x of users) for(const idz of (x.merged_accounts||[])) zlucenyDo[idz] = x._id;
    const posledna = {};
    for(const b of await q.find(db.bookings,{})){
      if(!b.user_id || b.status !== 'attended') continue;
      const d = den(b.booking_date || b.created_at); if(!d) continue;
      const uid = zlucenyDo[b.user_id] || b.user_id;
      if(!posledna[uid] || d > posledna[uid]) posledna[uid] = d;
    }
    return posledna;
  }

  // ── Komu mail patrí ────────────────────────────────────────────────────────
  // Jeden mail na jednu adresátku, aj keď má v appke seba aj dve deti. Dieťa samo
  // kampaňový mail nedostane nikdy (stráži to kampanovyMailZakazany), preto sa
  // detská časť akcie pripisuje rodičovi.
  async function zimaAudience(){
    const users = await q.find(db.users,{});
    const uMap = Object.fromEntries(users.map(u => [u._id, u]));
    const posledna = await poslednaHodina(users);
    const hranica = new Date(Date.now() - ZIMA.dni_bez_hodiny*864e5).toISOString().slice(0,10);
    const uzDostali = new Set((await q.find(db.mail_log,{}))
      .filter(m => m.subject === ZIMA_SUBJ).map(m => String(m.to||'').toLowerCase()));
    const testMail = String(process.env.TEST_ACC_EMAIL||'').toLowerCase();
    const vynechani = {}; const preco = d => { vynechani[d] = (vynechani[d]||0) + 1; };

    const personal = u => u.is_admin || u.is_assistant || ['trainer','manager'].includes(u.user_type);
    // Oprávnená = ešte netancovala, alebo naposledy pred viac než 3 mesiacmi.
    const opravnena = id => !posledna[id] || posledna[id] < hranica;

    const podla = {};   // adresát _id → záznam
    const pridaj = (adresat) => {
      if(podla[adresat._id]) return podla[adresat._id];
      podla[adresat._id] = { user_id:adresat._id, email:String(adresat.email||'').trim().toLowerCase(),
        meno:krstne(adresat), kod:adresat.referral_code || null, pre_seba:false, deti:[],
        posledna:null, typ:adresat.user_type || 'client' };
      return podla[adresat._id];
    };

    for(const u of users){
      if(personal(u)) continue;                       // tréneri a admini nie sú publikum
      if(u.is_child){
        const rodic = u.parent_id ? uMap[u.parent_id] : null;
        if(!rodic){ preco('dieťa bez rodičovského účtu'); continue; }
        if(!opravnena(u._id)) { preco('dieťa chodilo za posledné 3 mesiace'); continue; }
        const z = pridaj(rodic);
        z.deti.push({ id:u._id, meno:krstne(u), skupina:u.kids_group || null,
                      posledna:posledna[u._id] || null });
        continue;
      }
      if(!opravnena(u._id)) { preco('chodila za posledné 3 mesiace'); continue; }
      const z = pridaj(u);
      z.pre_seba = true;
      z.posledna = posledna[u._id] || null;
    }

    const prijemcovia = [];
    for(const id in podla){
      const z = podla[id], adresat = uMap[id];
      const zakaz = kampanovyMailZakazany(adresat, testMail);
      if(zakaz){ preco(zakaz); continue; }
      if(uzDostali.has(z.email)){ preco('mail z tejto vlny už dostala'); continue; }
      prijemcovia.push(z);
    }
    return { prijemcovia, vynechani };
  }

  // ── Mail ───────────────────────────────────────────────────────────────────
  // Prvý odsek sa líši podľa toho, prečo je v zozname: kto u nás ešte nebol,
  // nemá čo „obnovovať", a kto odišiel pred pol rokom, nechce čítať, že nechodí.
  function zimaUvod(p){
    if(p.pre_seba && p.posledna)
      return '<p>Naposledy si u nás tancovala <b>' + datumSk(p.posledna) + '</b>. '
        + 'Odvtedy sa toho veľa zmenilo a stále pri tom chýbaš.</p>';
    if(p.pre_seba)
      return '<p>Účet u nás máš, ale na hodine sme ťa ešte nestihli privítať. '
        + 'Teraz je na to asi najlepší čas v roku.</p>';
    return '<p>Vonku sa zvečerieva o pol piatej a deti majú energie stále rovnako. '
      + 'V sále sa dá vybiť aj v januári.</p>';
  }

  function zimaDetiOdsek(p){
    if(!p.deti.length) return '';
    const mena = p.deti.map(d => d.meno);
    const kto = mena.length === 1 ? mena[0]
      : mena.slice(0,-1).join(', ') + ' a ' + mena[mena.length-1];
    return '<p><b>Platí to aj pre Zumba Kids.</b> Keď ' + kto
      + (mena.length === 1 ? ' nastúpi' : ' nastúpia')
      + ' do krúžku v novembri a ' + (mena.length === 1 ? 'privedie' : 'privedú')
      + ' so sebou kamarátku, december '
      + (ZIMA.aj_kamoska
          ? 'majú zadarmo obe — aj tá kamarátka.'
          : (mena.length === 1 ? 'má' : 'majú') + ' zadarmo rovnako ako ty.') + '</p>';
  }

  function zimaHtml(p){
    const odkazKamoska = p.kod ? (APP_URL.replace(/\/$/,'') + '/invite/' + p.kod) : ZIMA_URL;
    return emailTemplate('Zima v kruhu najbližších',
      '<p>Ahoj ' + p.meno + ',</p>'
      + zimaUvod(p)
      + '<p>Chceme byť opäť spolu a užiť si krásnu zimu a sviatky v kruhu priateľov, '
      + 'a preto sme pripravili akciu, <b>akú sme tu ešte nikdy nemali</b>: keď si '
      + 'do <b>30. novembra</b> vezmeš alebo obnovíš mesačné členstvo a privedieš so '
      + 'sebou kamošku, ' + (ZIMA.aj_kamoska
          ? '<b style="color:#C9A84C">december máte u nás zadarmo obe</b> — tebe aj jej '
            + 'pripíšeme ' + ZIMA.dni_darcek + ' dní navyše, bez platenia.'
          : '<b style="color:#C9A84C">december máš u nás zadarmo</b> — pripíšeme ti '
            + ZIMA.dni_darcek + ' dní navyše, bez platenia.') + '</p>'
      + zimaDetiOdsek(p)
      + '<p>Členstvo si vyberieš v appke: ' + CENY + ' na mesiac.</p>'
      + '<p>Kamoške pošli svoj vlastný odkaz <a href="' + odkazKamoska + '">' + odkazKamoska
      + '</a>. Keď si cez neho vezme členstvo, december je '
      + (ZIMA.aj_kamoska ? 'váš — tvoj aj jej.' : 'tvoj.') + '</p>'
      + '<p>Sviatky sú o ľuďoch. Nech ich máme s kým tancovať. 💛</p>',
      '❄️ VYBRAŤ SI ČLENSTVO', ZIMA_URL);
  }

  // ── Náhľad vlny ────────────────────────────────────────────────────────────
  app.get('/api/admin/zima/nahlad', adminAuth, async(req,res)=>{
    try{
      const { prijemcovia, vynechani } = await zimaAudience();
      const podlaTypu = {}, zapis = (o,k) => { o[k] = (o[k]||0) + 1; };
      let sDetmi = 0, lenDeti = 0, nikdyNebola = 0;
      for(const p of prijemcovia){
        zapis(podlaTypu, p.typ === 'lead' ? 'registrovaná, nebola na hodine (lead)' : 'klientka');
        if(p.deti.length) sDetmi++;
        if(!p.pre_seba) lenDeti++;
        if(p.pre_seba && !p.posledna) nikdyNebola++;
      }
      const vzorka = k => { const p = prijemcovia.find(k); return p ? zimaHtml(p) : null; };
      res.json({ ok:true, pocet:prijemcovia.length, vynechani, podla_typu:podlaTypu,
        s_detmi:sDetmi, len_kvoli_dietatu:lenDeti, nikdy_nebola:nikdyNebola,
        okno:{ od:ZIMA.od, do:ZIMA.do }, dni_darcek:ZIMA.dni_darcek,
        aj_kamoska:ZIMA.aj_kamoska, predmet:ZIMA_SUBJ, odkaz:ZIMA_URL,
        rozpocet: await mailBudgetStav(4),
        go_flag: process.env.ZIMA_GO === '1',
        ukazka_odisla: vzorka(p => p.pre_seba && p.posledna && !p.deti.length),
        ukazka_nikdy: vzorka(p => p.pre_seba && !p.posledna && !p.deti.length),
        ukazka_deti:  vzorka(p => p.deti.length > 0) });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  app.post('/api/admin/zima/odoslat', adminAuth, async(req,res)=>{
    try{
      if(process.env.ZIMA_GO !== '1')
        return res.status(409).json({error:'Vlna je zamknutá. Nastav ZIMA_GO=1 v Railway env a skús znova — nasadenie samo o sebe nie je schválenie.'});
      const { prijemcovia } = await zimaAudience();
      if(!(req.body && req.body.potvrdit === true))
        return res.json({ ok:true, dry_run:true, pocet:prijemcovia.length });
      if(!prijemcovia.length) return res.json({ ok:true, poslane:0, poznamka:'Nikto nespĺňa podmienky.' });
      let poslane = 0, zlyhalo = 0, stoplo = null;
      for(const p of prijemcovia){
        if(!(await mailBudgetOk(4))){ stoplo = 'denný strop mailov'; break; }
        const ok = await sendMail(p.email, ZIMA_SUBJ, zimaHtml(p),
          { priority:4, template:'zima_v_kruhu_2026' }).catch(()=>false);
        ok ? poslane++ : zlyhalo++;
      }
      res.json({ ok:true, poslane, zlyhalo, stoplo, zo:prijemcovia.length });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // ── Kto si zaslúžil december ───────────────────────────────────────────────
  async function uzDarovane(){
    const s = await q.one(db.settings,{key:'zima_darceky'}).catch(()=>null);
    return Array.isArray(s && s.value) ? s.value : [];
  }

  /** Komu pripísať mesiac: tej, ktorá si členstvo v okne zaplatila sama, inak
      jej dieťaťu, ktorému ho zaplatila. Rodič bez vlastného členstva by inak
      nedostal nič, hoci kamošku privedie práve on. */
  function prijemcaDarceka(inviter, zaplatila, deti){
    if(zaplatila[inviter._id]) return { id:inviter._id, kto:'ona', plan:zaplatila[inviter._id].plan_id };
    const moje = (deti[inviter._id]||[])
      .filter(d => zaplatila[d._id])
      .sort((a,b) => zaplatila[b._id].d.localeCompare(zaplatila[a._id].d));
    if(moje.length) return { id:moje[0]._id, kto:'dieťa', meno:moje[0].name,
                             plan:zaplatila[moje[0]._id].plan_id };
    return null;
  }

  async function zimaNaroky(){
    const users = await q.find(db.users,{});
    const uMap = Object.fromEntries(users.map(u => [u._id, u]));
    const deti = {};
    for(const u of users) if(u.is_child && u.parent_id) (deti[u.parent_id] = deti[u.parent_id] || []).push(u);

    // Kto si v okne akcie členstvo naozaj zaplatil (nie darček, nie permanentka).
    const zaplatila = {};
    for(const t of await q.find(db.transactions,{type:{$in:['membership','subscription','subscription_renewal']}})){
      if(!t.user_id || !(+t.amount > 0)) continue;
      if(['free','promo'].includes(t.payment_method)) continue;
      if((MEMBERSHIP_PLANS[t.plan_id]||{}).type === 'bundle') continue;
      const d = den(t.date || t.created_at); if(!vOkne(d)) continue;
      if(!zaplatila[t.user_id] || d >= zaplatila[t.user_id].d) zaplatila[t.user_id] = { d, plan_id:t.plan_id };
    }

    const prve = await prveZaplateneClenstva();
    // Darček sa eviduje podľa PRÍJEMCU, nie podľa toho, kto kamošku priviedol: odkedy
    // december dostávajú obe, môže byť tá istá žena v zozname dvakrát (raz ako
    // hostiteľka, raz ako privedená) a kľúč podľa hostiteľky by tie dva riadky zlial.
    const dane = new Set((await uzDarovane()).map(x => x.prijemca_id));
    const podla = {};
    for(const f of users){
      if(!f.sponsor_id || !kamoskaPlatna(f)) continue;
      if(!vOkne(prve[f._id])) continue;                 // kamoška musí byť NOVÁ platiaca v okne
      const inviter = uMap[f.sponsor_id]; if(!inviter) continue;
      const prijemca = prijemcaDarceka(inviter, zaplatila, deti);
      if(!prijemca) continue;                           // sama si členstvo v okne nevzala
      const z = podla[inviter._id] = podla[inviter._id] || {
        inviter_id:inviter._id, inviter:inviter.name || '—',
        prijemca_id:prijemca.id, prijemca:prijemca.kto === 'ona' ? (inviter.name||'—') : prijemca.meno,
        komu:prijemca.kto, plan_id:prijemca.plan, plan:(MEMBERSHIP_PLANS[prijemca.plan]||{}).name || prijemca.plan,
        clenstvo_do: (uMap[prijemca.id]||{}).membership_expires || null,
        uz_darovane: dane.has(prijemca.id), kamosky:[] };
      z.kamosky.push({ id:f._id, meno:f.name || '—', prve_clenstvo:prve[f._id] });
    }
    const naroky = Object.values(podla);
    // Privedená kamoška dostane december tiež — svoje členstvo si práve zaplatila, takže
    // mesiac ide na ten istý plán. Zbierame bokom a spájame až potom, nech sa zoznam
    // nemení uprostred vlastného prechádzania.
    if(ZIMA.aj_kamoska){
      const uzVZozname = new Set(naroky.map(z => z.prijemca_id));
      const navyse = [];
      for(const z of naroky) for(const k of z.kamosky){
        if(uzVZozname.has(k.id)) continue;
        uzVZozname.add(k.id);
        const plan = (zaplatila[k.id] || {}).plan_id || null;
        navyse.push({ inviter_id:z.inviter_id, inviter:z.inviter, prijemca_id:k.id,
          prijemca:k.meno, komu:'kamoška', plan_id:plan,
          plan:(MEMBERSHIP_PLANS[plan]||{}).name || '—',
          clenstvo_do:(uMap[k.id]||{}).membership_expires || null,
          uz_darovane: dane.has(k.id), kamosky:[] });
      }
      naroky.push(...navyse);
    }
    return naroky;
  }

  app.get('/api/admin/zima/naroky', adminAuth, async(req,res)=>{
    try{
      const naroky = await zimaNaroky();
      res.json({ ok:true, pocet:naroky.length, okno:{ od:ZIMA.od, do:ZIMA.do },
        dni_darcek:ZIMA.dni_darcek, naroky, darovane: await uzDarovane() });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // Zápis, že mesiac už bol darovaný. Volá sa až po tom, čo grant-membership prešlo —
  // samotné darovanie zostáva na jedinej, odauditovanej ceste.
  app.post('/api/admin/zima/darcek-zapisat', adminAuth, async(req,res)=>{
    try{
      const inviter_id = String((req.body && req.body.inviter_id) || '');
      const prijemca_id = String((req.body && req.body.prijemca_id) || '');
      if(!inviter_id || !prijemca_id) return res.status(400).json({error:'Chýba inviter_id alebo prijemca_id'});
      const zoznam = await uzDarovane();
      // Kľúčom je príjemca — tá istá hostiteľka môže mať v zozname aj svoju kamošku.
      if(zoznam.some(x => x.prijemca_id === prijemca_id))
        return res.json({ ok:true, uz_zapisane:true, pocet:zoznam.length });
      zoznam.push({ inviter_id, prijemca_id, dni:ZIMA.dni_darcek,
        plan_id:(req.body && req.body.plan_id) || null, kym:req.session.uid || null, at:nowISO() });
      const ex = await q.one(db.settings,{key:'zima_darceky'});
      if(ex) await q.update(db.settings,{_id:ex._id},{$set:{value:zoznam, at:nowISO()}});
      else await q.insert(db.settings,{key:'zima_darceky', value:zoznam, at:nowISO()});
      await q.insert(db.notifications,{ user_id:prijemca_id, type:'zima_darcek',
        title:'🎁 December máš zadarmo', read:false, created_at:nowISO(),
        body:'Priviedla si kamošku, tak sme ti pripísali 30 dní členstva navyše. Vďaka, že si nás niekomu odporučila. 💛' }).catch(()=>{});
      res.json({ ok:true, pocet:zoznam.length });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  return { ZIMA, ZIMA_SUBJ, zimaAudience, zimaHtml, zimaNaroky };
};
