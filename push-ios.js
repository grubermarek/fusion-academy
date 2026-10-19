// ═══════════════════════════════════════════════════════════════════════════════
// NATÍVNE PUSH NOTIFIKÁCIE PRE iOS (APNs)
//
// Marek 19. 10. 2026: appku od Glofoxu v App Store nahrádzame našou (rovnaké bundle
// ID `ie.zappy.latindancefusion`). Apple appku, ktorá je len „web v obale", zamieta —
// natívne push sú hlavný dôvod, prečo obal existuje, a klientkam konečne prídu
// upozornenia o zrušenej hodine aj bez otvorenej appky.
//
// Ako to funguje:
//  1. obal (Capacitor) si vypýta povolenie a pošle device token na POST /api/push/device
//  2. token si uložíme k účtu (db.push_devices)
//  3. každú minútu pozrieme, aké nové oznámenia v appke pribudli (db.notifications),
//     a tie isté pošleme na telefón cez APNs
//
// Žiadna nová závislosť: JWT pre APNs si podpíšeme cez vstavané `crypto`, spojenie
// ide cez vstavané `http2`. Bez kľúča (.p8) modul potichu spí.
//
// Premenné na Railway: APNS_KEY_P8 (obsah .p8 aj s hlavičkami), APNS_KEY_ID,
// APNS_TEAM_ID, voliteľne APNS_TOPIC (default ie.zappy.latindancefusion)
// a APNS_PROD=1 pre ostrý server (inak sandbox pre TestFlight/debug buildy).
// ═══════════════════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const http2  = require('http2');

module.exports = function mountPushIos(ctx){
  const { app, db, q, Datastore, DATA_DIR, auth, adminAuth, nowISO } = ctx;

  db.push_devices = db.push_devices || new Datastore({ filename: require('path').join(DATA_DIR, 'push_devices.db'), autoload: true });

  const KEY   = (process.env.APNS_KEY_P8 || '').replace(/\\n/g, '\n').trim();
  const KEYID = process.env.APNS_KEY_ID || '';
  const TEAM  = process.env.APNS_TEAM_ID || '';
  const TOPIC = process.env.APNS_TOPIC || 'ie.zappy.latindancefusion';
  const HOST  = process.env.APNS_PROD ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
  const ZAPNUTE = !!(KEY && KEYID && TEAM);
  if(!ZAPNUTE) console.log('📱 iOS push: bez APNS kľúča — notifikácie na telefón zatiaľ nechodia');

  // ── Token pre APNs (platí hodinu, Apple odmieta častejšie obnovovanie) ──────
  let tokenCache = { token:null, at:0 };
  function apnsToken(){
    if(tokenCache.token && Date.now()-tokenCache.at < 50*60*1000) return tokenCache.token;
    const hlavicka = Buffer.from(JSON.stringify({ alg:'ES256', kid:KEYID })).toString('base64url');
    const telo     = Buffer.from(JSON.stringify({ iss:TEAM, iat:Math.floor(Date.now()/1000) })).toString('base64url');
    const podpis   = crypto.createSign('SHA256').update(hlavicka+'.'+telo).sign({ key:KEY, dsaEncoding:'ieee-p1363' }).toString('base64url');
    tokenCache = { token:`${hlavicka}.${telo}.${podpis}`, at:Date.now() };
    return tokenCache.token;
  }

  // ── Odoslanie jednej notifikácie na jeden telefón ───────────────────────────
  // Vracia {ok} alebo {ok:false, zmazat:true} pri tokene, ktorý už neplatí.
  function posliNaToken(deviceToken, sprava){
    return new Promise(resolve=>{
      let client;
      try{ client = http2.connect('https://'+HOST); }
      catch(e){ return resolve({ok:false, chyba:e.message}); }
      const telo = Buffer.from(JSON.stringify(sprava));
      const req = client.request({
        ':method':'POST', ':path':'/3/device/'+deviceToken,
        'authorization':'bearer '+apnsToken(),
        'apns-topic':TOPIC, 'apns-push-type':'alert', 'apns-priority':'10',
        'content-type':'application/json', 'content-length':telo.length });
      let stav=0, odpoved='';
      req.on('response', h => { stav = +h[':status']||0; });
      req.on('data', d => { odpoved += d; });
      req.on('error', e => { try{client.close()}catch(x){}; resolve({ok:false, chyba:e.message}); });
      req.on('end', ()=>{
        try{ client.close(); }catch(e){}
        // 410 = token už neplatí (appka odinštalovaná), 400 BadDeviceToken tiež
        const zmazat = stav===410 || /BadDeviceToken|Unregistered/.test(odpoved);
        resolve({ ok:stav===200, stav, zmazat, odpoved:odpoved.slice(0,200) });
      });
      req.end(telo);
      setTimeout(()=>{ try{ req.close(); client.close(); }catch(e){} }, 10000);
    });
  }

  // ── Pošli oznam klientke na všetky jej telefóny ─────────────────────────────
  async function posliKlientke(user_id, { title, body, data }){
    if(!ZAPNUTE || !user_id) return 0;
    const zariadenia = await q.find(db.push_devices, { user_id, platform:'ios' });
    if(!zariadenia.length) return 0;
    const neprecitane = (await q.find(db.notifications, { user_id, read:false })).length;
    let poslane = 0;
    for(const z of zariadenia){
      const r = await posliNaToken(z.token, {
        aps:{ alert:{ title:String(title||'Fusion Academy').slice(0,120), body:String(body||'').slice(0,400) },
              sound:'default', badge:neprecitane, 'thread-id':'fusion' },
        ...(data||{}) });
      if(r.ok){ poslane++; await q.update(db.push_devices,{_id:z._id},{$set:{last_ok:nowISO()}}); }
      else if(r.zmazat){ await q.remove(db.push_devices,{_id:z._id},{}); }
      else await q.update(db.push_devices,{_id:z._id},{$set:{last_error:String(r.odpoved||r.chyba||'').slice(0,120), last_error_at:nowISO()}});
    }
    return poslane;
  }

  // ── Registrácia telefónu z obalu ────────────────────────────────────────────
  app.post('/api/push/device', auth, async(req,res)=>{
    try{
      const token = String(req.body.token||'').replace(/[^a-fA-F0-9]/g,'');
      if(token.length < 32) return res.status(400).json({error:'Neplatný token'});
      const platform = req.body.platform==='android' ? 'android' : 'ios';
      const existuje = await q.one(db.push_devices,{ token });
      if(existuje) await q.update(db.push_devices,{_id:existuje._id},{$set:{ user_id:req.session.uid, platform,
        app_version:String(req.body.app_version||'').slice(0,20), last_seen:nowISO() }});
      else await q.insert(db.push_devices,{ user_id:req.session.uid, token, platform,
        app_version:String(req.body.app_version||'').slice(0,20), created_at:nowISO(), last_seen:nowISO() });
      res.json({ ok:true });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // Odhlásenie telefónu (odhlásenie z účtu v appke)
  app.post('/api/push/device/odhlasit', auth, async(req,res)=>{
    try{
      const token = String(req.body.token||'').replace(/[^a-fA-F0-9]/g,'');
      if(token) await q.remove(db.push_devices,{ token },{});
      res.json({ ok:true });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // Skúšobný push (admin) — nech sa dá overiť, že reťaz funguje
  app.post('/api/admin/push/test', adminAuth, async(req,res)=>{
    try{
      const uid = String(req.body.user_id || req.session.uid);
      const poslane = await posliKlientke(uid, { title:'🔔 Skúška', body:String(req.body.text||'Push z Fusion Academy funguje.') });
      res.json({ ok:true, zapnute:ZAPNUTE, poslane });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // ── Každú minútu: nové oznámenia v appke pošli aj na telefón ────────────────
  // Jedno miesto pre všetky typy — netreba zasahovať do stoviek miest, kde sa
  // oznámenia vytvárajú. Posielame len čerstvé (do 15 minút), nech sa po výpadku
  // klientke nevysype história.
  const TICHO = ['no_show'];   // typy, ktoré na telefón nemajú chodiť
  async function tick(){
    if(!ZAPNUTE) return 0;
    try{
      const s = await q.one(db.settings,{key:'apns_watermark'});
      const od = (s && s.value) || new Date(Date.now()-5*60000).toISOString();
      const hranica = new Date(Date.now()-15*60000).toISOString();
      const nove = (await q.find(db.notifications,{}))
        .filter(n => String(n.created_at||'') > od && String(n.created_at||'') > hranica && !TICHO.includes(n.type))
        .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
      let poslane = 0;
      for(const n of nove.slice(0, 200))
        poslane += await posliKlientke(n.user_id, { title:n.title, body:n.body, data:{ typ:n.type||'' } });
      const noveOd = nove.length ? nove[nove.length-1].created_at : nowISO();
      if(s) await q.update(db.settings,{key:'apns_watermark'},{$set:{value:noveOd, at:nowISO()}});
      else await q.insert(db.settings,{key:'apns_watermark', value:noveOd, at:nowISO()});
      if(poslane) console.log('📱 iOS push: odoslaných '+poslane);
      return poslane;
    }catch(e){ console.error('iOS push tick:', e.message); return 0; }
  }
  if(ZAPNUTE) setInterval(()=>tick().catch(()=>{}), 60*1000);

  return { posliKlientke, tick, zapnute:ZAPNUTE };
};
