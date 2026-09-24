/**
 * Fusion Academy — INFLUENCERI (affiliate program)
 *
 * Influencerka si sama založí účet na /influencer, dostane vlastný odkaz /i/<KÓD>
 * a zarába z predajov ľudí, ktorých privedie. Nič vlastné sa tu nepočíta:
 *   - účet = ambasádorský účet (user_type 'ambassador'), sponzorská väzba sponsor_id,
 *   - provízie, 14-dňová lehota, kredit aj výplata = ten istý motor ako ambasádorky
 *     (saveCommissions / approveMaturedCommissions / referral-credit/payout v server.js).
 * Tento modul pridáva len to, čo ambasádorkám chýba: profil sietí (platforma, handle,
 * sledovatelia), počítanie klikov na odkaz, influencerský dashboard a admin prehľad
 * na výber, filtrovanie a kontaktovanie.
 *
 * Kliky: /i/<KÓD> zapíše klik (unikátny návštevník = cookie fa_ic, max. 1 za deň)
 * a presmeruje na /invite/<KÓD> — existujúcu pozvánku, ktorá väzbu na sponzorku
 * zapíše pri rezervácii aj registrácii.
 */
'use strict';
const path = require('path');
const crypto = require('crypto');

module.exports = function initInfluencer(ctx){
  const { app, db, q, Datastore, DATA_DIR, auth, adminAuth, nowISO, today, APP_URL, isTestContact } = ctx;

  db.influencer_clicks = new Datastore({ filename: path.join(DATA_DIR, 'influencer_clicks.db'), autoload: true });
  db.influencer_clicks.ensureIndex({ fieldName: 'user_id' });

  const PLATFORMY = ['instagram','tiktok','facebook','youtube','iny'];
  const STAVY = { novy:'Nový', kontaktovany:'Kontaktovaný', spolupracuje:'Spolupracuje', pozastaveny:'Pozastavený' };
  const STRATA_DNI = 14;   // registrácia bez nákupu po 14 dňoch = strata
  const APP = String(APP_URL||'').replace(/\/$/,'');

  const cisloOr0 = v => { const n = Math.round(+String(v||'').replace(/[^\d]/g,'')); return Number.isFinite(n) ? Math.min(n, 1e9) : 0; };
  const txt = (v, n) => String(v||'').trim().slice(0, n);
  const handle = v => txt(v, 80).replace(/^https?:\/\/(www\.)?/i,'');
  const cookie = (req, meno) => {
    const m = String(req.headers.cookie||'').match(new RegExp('(?:^|;\\s*)'+meno+'=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : '';
  };
  const dniOd = s => s ? Math.floor((Date.now() - new Date(String(s).length<=10 ? s+'T12:00:00' : s)) / 86400000) : 0;

  function profilZBody(b, stary){
    const p = { ...(stary||{}) };
    const siete = {};
    for(const k of PLATFORMY){ const h = handle(b?.siete?.[k] ?? b?.[k]); if(h) siete[k] = h; }
    p.siete = siete;
    p.hlavna = PLATFORMY.includes(b?.hlavna) ? b.hlavna : (Object.keys(siete)[0] || 'instagram');
    p.sledovatelia = cisloOr0(b?.sledovatelia);
    p.tema = txt(b?.tema, 80);
    p.mesto = txt(b?.mesto, 60);
    p.poznamka = txt(b?.poznamka, 500);
    return p;
  }
  const jeInfluencer = u => !!(u && u.influencer && u.influencer.at);

  // ── Kliky ──────────────────────────────────────────────────────────────────
  app.get('/i/:code', async(req,res)=>{
    const code = String(req.params.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,20);
    const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    try{
      const u = code && await q.one(db.users,{referral_code:code});
      if(u && jeInfluencer(u)){
        let vid = cookie(req,'fa_ic');
        if(!/^[a-f0-9]{16}$/.test(vid)){
          vid = crypto.randomBytes(8).toString('hex');
          res.cookie('fa_ic', vid, { maxAge: 365*86400000, httpOnly:true, sameSite:'lax' });
        }
        const den = today();
        const bot = /bot|crawl|spider|preview|facebookexternalhit|slurp|whatsapp|telegram/i.test(String(req.headers['user-agent']||''));
        if(!bot && !(await q.one(db.influencer_clicks,{user_id:u._id, vid, day:den}))){
          let zdroj = '';
          try{ zdroj = new URL(String(req.headers.referer||'')).hostname.replace(/^www\./,''); }catch(e){}
          await q.insert(db.influencer_clicks,{ user_id:u._id, code, vid, day:den,
            zdroj: zdroj.slice(0,60), utm_source: txt(req.query.utm_source,60), at: nowISO() });
        }
        if(req.session) req.session.ref_code = code;
      }
    }catch(e){ console.error('influencer klik:', e.message); }
    res.redirect(302, '/invite/'+encodeURIComponent(code||'FUSION')+qs);
  });

  // ── Čísla jednej influencerky ──────────────────────────────────────────────
  async function cisla(u, detail){
    const kliky = await q.find(db.influencer_clicks,{user_id:u._id});
    const od30 = new Date(Date.now()-29*86400000).toISOString().slice(0,10);
    const ludia = (await q.find(db.users,{sponsor_id:u._id})).filter(x=>!isTestContact(x.email));
    const vsetkyComms = await q.find(db.commissions,{partner_id:u._id});
    const comms = vsetkyComms.filter(c=>c.status!=='reversed');
    // Vrátená platba (refundácia) = provízia 'reversed' → predaj sa nepočíta.
    const platne = new Set(comms.map(c=>c.transaction_id));
    const vratene = new Set(vsetkyComms.filter(c=>c.status==='reversed' && !platne.has(c.transaction_id)).map(c=>c.transaction_id));
    const txs = (await q.find(db.transactions,{partner_id:u._id})).filter(t=>t.client_id && !vratene.has(t._id));
    const kupili = new Set(txs.map(t=>t.client_id));
    const suma = arr => +arr.reduce((s,c)=>s+(+c.amount||0),0).toFixed(2);
    const naHodine = x => (x.visit_count||0) > 0;
    // Platí = bežiace členstvo (db.memberships — hotovosť ho do users nezapisuje) alebo zostatok vstupov.
    const dnes = today();
    const clenstva = ludia.length ? (await q.find(db.memberships,{user_id:{$in:ludia.map(x=>x._id)}}))
      .filter(m=>!m._type && m.status==='active' && String(m.expires_at||'').slice(0,10) >= dnes) : [];
    const sClenstvom = new Set(clenstva.map(m=>m.user_id));
    const aktivne = x => sClenstvom.has(x._id) || (+x.single_entries||0) > 0
      || !!(x.membership_expires && new Date(x.membership_expires) > new Date());
    const stav = x => {
      if(aktivne(x)) return 'platí';
      if(kupili.has(x._id)) return 'odišla';
      const reg = x.registration_at || x.claimed_at || x.created_at;
      if(dniOd(reg) >= STRATA_DNI) return 'bez nákupu';
      return naHodine(x) ? 'skúša' : 'nová';
    };
    const zoznam = ludia.map(x=>({ id:x._id, meno:x.name||'', stav:stav(x),
      od:String(x.registration_at||x.claimed_at||x.created_at||'').slice(0,10),
      nakupy:+txs.filter(t=>t.client_id===x._id).reduce((s,t)=>s+(+t.amount||0),0).toFixed(2) }));
    const pocet = s => zoznam.filter(z=>z.stav===s).length;
    const reg = zoznam.length;
    const r = {
      kliky: kliky.length,
      kliky_unikatne: new Set(kliky.map(k=>k.vid)).size,
      kliky_30d: kliky.filter(k=>k.day>=od30).length,
      registracie: reg,
      registracie_30d: zoznam.filter(z=>z.od>=od30).length,
      na_hodine: ludia.filter(naHodine).length,
      zakaznicky: kupili.size,
      platiace: pocet('platí'),
      straty: pocet('bez nákupu') + pocet('odišla'),
      straty_bez_nakupu: pocet('bez nákupu'),
      straty_odisli: pocet('odišla'),
      predaje: txs.length,
      obrat: +txs.reduce((s,t)=>s+(+t.amount||0),0).toFixed(2),
      provizie: suma(comms),
      caka: suma(comms.filter(c=>c.status==='pending')),
      kredit: +(u.referral_credit||0).toFixed(2),
      konverzia_klik_reg: kliky.length ? Math.round(reg/kliky.length*1000)/10 : 0,
      konverzia_reg_nakup: reg ? Math.round(kupili.size/reg*1000)/10 : 0,
    };
    if(detail){
      const dni = [];
      for(let i=29;i>=0;i--){
        const d = new Date(Date.now()-i*86400000).toISOString().slice(0,10);
        dni.push({ den:d, kliky:kliky.filter(k=>k.day===d).length, registracie:zoznam.filter(z=>z.od===d).length });
      }
      const zdroje = {};
      for(const k of kliky){ const z = k.utm_source || k.zdroj || 'priamo'; zdroje[z] = (zdroje[z]||0)+1; }
      const mesiace = {};
      for(const c of comms){
        const m = c.month || String(c.created_at||'').slice(0,7); if(!m) continue;
        mesiace[m] = mesiace[m] || { mesiac:m, provizie:0, caka:0 };
        mesiace[m].provizie += +c.amount||0; if(c.status==='pending') mesiace[m].caka += +c.amount||0;
      }
      const vyplaty = (await q.find(db.transactions,{user_id:u._id, type:'referral_payout_request'}))
        .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))
        .slice(0,12).map(v=>({ datum:String(v.created_at||'').slice(0,10), suma:+v.amount||0, stav:v.status||'pending' }));
      Object.assign(r, { dni,
        zdroje: Object.entries(zdroje).map(([zdroj,pocet])=>({zdroj,pocet})).sort((a,b)=>b.pocet-a.pocet).slice(0,8),
        mesiace: Object.values(mesiace).map(m=>({mesiac:m.mesiac, provizie:+m.provizie.toFixed(2), caka:+m.caka.toFixed(2)}))
          .sort((a,b)=>b.mesiac.localeCompare(a.mesiac)).slice(0,12),
        vyplaty,
        ludia: zoznam.sort((a,b)=>b.od.localeCompare(a.od)) });
    }
    return r;
  }

  // Sadzbu berie provízny motor z hodnosti ambasádorky — tu ju len čítame, nič vlastné.
  const sadzba = u => ctx.ambRate ? Math.round(ctx.ambRate(u.amb_rank||1)*100) : null;

  // ── Influencerka ───────────────────────────────────────────────────────────
  // Stav pre stránku /influencer: neprihlásená / prihlásená bez profilu / influencerka.
  app.get('/api/influencer/stav', async(req,res)=>{
    try{
      const zaklad = { ok:true, sadzba: sadzba({}), lehota_dni: ctx.COMMISSION_HOLD_DAYS||14 };
      if(!req.session?.uid) return res.json({ ...zaklad, prihlasena:false });
      const u = await q.one(db.users,{_id:req.session.uid});
      res.json({ ...zaklad, prihlasena:!!u, influencer:jeInfluencer(u), meno:u?.name||'', email:u?.email||'' });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // Založenie profilu. Účet si vytvorí cez /api/register (rovnaká validácia,
  // atribúcia a upozornenia ako pri každej registrácii), potom zavolá toto.
  app.post('/api/influencer/prihlaska', auth, async(req,res)=>{
    try{
      const u = await q.one(db.users,{_id:req.session.uid});
      if(!u) return res.status(404).json({error:'Účet sa nenašiel'});
      const p = profilZBody(req.body, u.influencer);
      if(!Object.keys(p.siete).length) return res.status(400).json({error:'Doplň aspoň jednu sociálnu sieť (napr. Instagram @meno).'});
      const novy = !jeInfluencer(u);
      if(novy){ p.at = nowISO(); p.stav = 'novy'; }
      const set = { influencer: p };
      // Rola ambasádorky = provízie, kredit a výplata z toho istého motora.
      // Trénerku/admina neznižujeme — sekciu aj provízie majú aj tak.
      if(!u.is_admin && ['client','lead','',undefined,null].includes(u.user_type)){
        set.user_type = 'ambassador'; set.ambassador_since = u.ambassador_since || nowISO();
      }
      await q.update(db.users,{_id:u._id},{$set:set});
      if(novy){
        await q.insert(db.notifications,{user_id:u._id, type:'ambassador',
          title:'📣 Vitaj v influencer programe Fusion Academy!',
          body:'Tvoj odkaz nájdeš v sekcii Influencer — každý klik, registráciu aj predaj tam uvidíš hneď.',
          read:false, created_at:nowISO()}).catch(()=>{});
        if(!isTestContact(u.email)){
          const siete = Object.entries(p.siete).map(([k,v])=>k+': '+v).join(', ');
          for(const a of await q.find(db.users,{is_admin:true}))
            await q.insert(db.notifications,{user_id:a._id, type:'new_lead',
              title:'📣 Nová influencerka: '+(u.name||''),
              body:`${siete} · ${p.sledovatelia ? p.sledovatelia.toLocaleString('sk-SK')+' sledovateľov' : 'počet sledovateľov neuvedený'}${p.mesto?' · '+p.mesto:''}`,
              read:false, created_at:nowISO()}).catch(()=>{});
        }
      }
      res.json({ ok:true, novy });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  app.get('/api/influencer/me', auth, async(req,res)=>{
    try{
      const u = await q.one(db.users,{_id:req.session.uid});
      if(!jeInfluencer(u)) return res.status(403).json({error:'Nie si v influencer programe', prihlaska:true});
      res.json({ ok:true, meno:u.name, kod:u.referral_code,
        odkaz: APP+'/i/'+u.referral_code,
        profil: u.influencer, sadzba: sadzba(u), lehota_dni: ctx.COMMISSION_HOLD_DAYS||14,
        iban: u.bank_account||'',
        cisla: await cisla(u, true) });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // ── Admin ──────────────────────────────────────────────────────────────────
  app.get('/api/admin/influencers', adminAuth, async(req,res)=>{
    try{
      const vsetky = (await q.find(db.users,{})).filter(jeInfluencer);
      const rows = [];
      for(const u of vsetky){
        rows.push({ id:u._id, meno:u.name||'', email:u.email||'', telefon:u.phone||'', kod:u.referral_code,
          odkaz: APP+'/i/'+u.referral_code, test: isTestContact(u.email),
          profil: u.influencer, stav: u.influencer.stav||'novy',
          od: String(u.influencer.at||'').slice(0,10), sadzba: sadzba(u),
          cisla: await cisla(u, false) });
      }
      res.json({ ok:true, stavy:STAVY, platformy:PLATFORMY, influenceri: rows });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  app.get('/api/admin/influencers/:id', adminAuth, async(req,res)=>{
    try{
      const u = await q.one(db.users,{_id:req.params.id});
      if(!jeInfluencer(u)) return res.status(404).json({error:'Influencerka sa nenašla'});
      res.json({ ok:true, id:u._id, meno:u.name, email:u.email, telefon:u.phone||'', kod:u.referral_code,
        odkaz: APP+'/i/'+u.referral_code, profil:u.influencer, sadzba:sadzba(u), cisla: await cisla(u, true) });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // Admin: stav spolupráce, poznámka, oprava profilu (sledovatelia sa menia).
  app.put('/api/admin/influencers/:id', adminAuth, async(req,res)=>{
    try{
      const u = await q.one(db.users,{_id:req.params.id});
      if(!jeInfluencer(u)) return res.status(404).json({error:'Influencerka sa nenašla'});
      const p = req.body.profil ? profilZBody(req.body.profil, u.influencer) : { ...u.influencer };
      if(req.body.stav !== undefined){
        if(!STAVY[req.body.stav]) return res.status(400).json({error:'Neznámy stav'});
        p.stav = req.body.stav;
      }
      if(req.body.admin_poznamka !== undefined) p.admin_poznamka = txt(req.body.admin_poznamka, 2000);
      if(req.body.kontaktovana) p.kontaktovana_at = nowISO();
      p.upravene_at = nowISO();
      await q.update(db.users,{_id:u._id},{$set:{influencer:p}});
      res.json({ ok:true, profil:p });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  app.get('/influencer', (req,res)=>res.sendFile(path.join(__dirname,'public','influencer.html')));

  return { cisla, jeInfluencer };
};
