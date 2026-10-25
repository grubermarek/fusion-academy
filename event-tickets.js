// ═══════════════════════════════════════════════════════════════════════════════
// EVENT TICKETS — predaj vstupeniek na eventy (web aj appka), QR check-in
//
// Jeden spoločný sklad vstupeniek pre všetky kanály (WEB / APP / ADMIN). Ceny sa
// počítajú VŽDY na serveri — klient posiela len typ a počet, nikdy sumu.
// ═══════════════════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const QR     = require('qrcode');

module.exports = function mountEventTickets(ctx){
  const { app, db, q, auth, adminAuth, rlPublic, nowISO, today, APP_URL,
          sendMail, createInvoice, stripeApi, STRIPE_SECRET, isMemberActive, metaCapi,
          emailTemplate, mailBudgetOk, mailBudgetStav, vencekMimoKonverzie } = ctx;

  // ── Pomocné ────────────────────────────────────────────────────────────────
  const cors = res => {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  };
  const esc = (s,n=200) => String(s==null?'':s).slice(0,n).replace(/[<>]/g,'');
  const eur = n => (Math.round(n*100)/100).toFixed(2);
  // Bratislavský čas: porovnanie deadlinov robíme na ISO reťazcoch s posunom.
  const skNow = () => new Date().toISOString();

  const newCode = () => crypto.randomBytes(9).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);

  // Komu chodia upozornenia o predaji.
  const OWNER_MAILS = ['gruber.marek@gmail.com','beatabunova22@gmail.com'];
  async function notifyOwners(title, body, html){
    for(const a of await q.find(db.users,{is_admin:true})){
      await q.insert(db.notifications,{user_id:a._id, type:'event_sale', title, body,
        read:false, created_at:nowISO()}).catch(()=>{});
    }
    for(const to of OWNER_MAILS){ try{ await sendMail(to, title, html); }catch(e){} }
  }

  // ── Seed eventu ────────────────────────────────────────────────────────────
  const LATIN = {
    slug: 'latin-tropical-2026',
    name: 'LATIN TROPICAL PARTY & MASTERCLASS',
    subtitle: '1. výročie tanečnej školy v Detve',
    date: '2026-09-05',
    date_label: '5. september 2026',
    venue: 'Fusion Club Detva',
    address: 'Záhradná 7, Detva',
    poster: '/img/events/latin-tropical.jpg',
    active: true,
    // Kapacita 30 sa vzťahuje na FULL EXPERIENCE (masterclass v sále).
    // Párty má vlastnú kapacitu — null = bez limitu, dá sa nastaviť v admine.
    tables_public_max: 4,
    tables_persons_max: 8,
    // Affiliate partneri — vlastný odkaz ?a=KÓD, provízia z predanej sumy.
    affiliates: [
      // prices: vlastná cena pre jeho klientky (nie je to členská zľava Fusion Academy)
      { code:'IVAN', name:'Ivan Ligárt', rate:0.30, prices:{ full:45 } }
    ],
    program: [
      {time:'18:15 – 19:00', what:'Masterclass — Marek Gruber',                   ticket:'full'},
      {time:'19:00 – 19:15', what:'Prestávka',                                    ticket:'full'},
      {time:'19:15 – 20:00', what:'Masterclass — Ivan Ligárt',                    ticket:'full'},
      {time:'20:00 – 20:15', what:'Prestávka',                                    ticket:'full'},
      {time:'20:15 – 20:45', what:'Zumba + CIRCL Mobility',                       ticket:'full'},
      {time:'21:00',         what:'Otvorenie Latin Tropical Party pre verejnosť',  ticket:'both'}
    ],
    types: [
      { key:'full', name:'FULL EXPERIENCE — MASTERCLASS',
        includes:['Masterclass Marek Gruber','Masterclass Ivan Ligárt','Zumba','CIRCL Mobility','Jedlo','Welcome drink','Vstup na Latin Tropical Party'],
        member: 45, presale: 55, door: 65,
        presale_until: '2026-08-31T23:59:59+02:00',
        capacity: 30 },
      { key:'party', name:'LATIN TROPICAL PARTY',
        includes:['Vstup od 21:00','Welcome drink'],
        // Členka platí 5 € aj pri dverách po 21:00 (Marek 5. 9.) — cudzí 10 €.
        member: 5, member_after_presale: true, presale: 5, door: 10,
        presale_until: '2026-09-05T20:59:59+02:00',
        capacity: null,
        tables: true }
    ]
  };

  const SKOLENIE = {
    slug: 'skolenie-ambasador-2026',
    name: 'AMBASÁDORSKÉ ŠKOLENIE',
    subtitle: 'Vstup do ambasádorského programu',
    date: '2026-08-28',
    date_label: '28. august 2026 · 16:00',
    venue: 'Fusion Academy Detva',
    address: 'Záhradná 7, Detva',
    poster: null,
    active: true,
    tables_public_max: 0,
    tables_persons_max: 0,
    affiliates: [],
    program: [
      {time:'16:00', what:'Začiatok — ambasádorský program a ako funguje odmena', ticket:'full'},
      {time:'—',     what:'Práca s vlastným odkazom, QR kódom a aplikáciou',      ticket:'full'},
      {time:'—',     what:'Ako hovoriť o Fusion Academy bez tlaku',               ticket:'full'},
      {time:'—',     what:'Spoločný tréning',                                      ticket:'full'},
      {time:'—',     what:'Občerstvenie a nápoje',                                 ticket:'full'}
    ],
    types: [
      { key:'full', name:'AMBASÁDORSKÉ ŠKOLENIE',
        includes:['Školenie s Marekom a Beátkou','Spoločný tréning','Občerstvenie','Nápoje',
                  'Odomknutie ambasádorskej sekcie v aplikácii'],
        member: null, presale: 15, door: 15,
        presale_until: '2026-08-28T15:59:59+02:00',
        capacity: null }
    ]
  };

  // Druhé vstupné školenie (Marek 19. 9.): piatok 25. 9. 2026 o 20:00.
  const SKOLENIE2 = {
    ...SKOLENIE,
    slug: 'skolenie-ambasador-2026-09',
    date: '2026-09-25',
    date_label: '25. september 2026 · 20:00',
    program: [
      {time:'20:00', what:'Začiatok — ambasádorský program a ako funguje odmena', ticket:'full'},
      {time:'—',     what:'Práca s vlastným odkazom, QR kódom a aplikáciou',      ticket:'full'},
      {time:'—',     what:'Ako hovoriť o Fusion Academy bez tlaku',               ticket:'full'},
      {time:'—',     what:'Spoločný tréning',                                      ticket:'full'},
      {time:'—',     what:'Občerstvenie a nápoje',                                 ticket:'full'}
    ],
    types: SKOLENIE.types.map(t => ({ ...t, presale_until: '2026-09-25T19:59:59+02:00' }))
  };

  // Halloweenska Zumba Party (Marek 25. 10. 2026, „daj ako je to napísané na plagáte"):
  // cena podľa úrovne členstva — Silver 5 €, Bronze 10 €, permanentka 15 €. Gold na plagáte
  // nie je, zaradený na najnižšiu členskú cenu (platí mesačne viac než Silver). Bez členstva
  // pôvodne cena nebola (nonmember:null = len členky); 25. 10. večer Marek otvoril párty pre
  // každého za 15 € — cena je na JEDNOM mieste: nonmember (null by znova zavrel predaj nečlenkám).
  const HALLOWEEN = {
    slug: 'halloween-zumba-2026',
    name: 'HALLOWEENSKA ZUMBA PARTY',
    subtitle: 'Vstup povolený len v maske',
    date: '2026-10-30',
    date_label: 'piatok 30. október 2026 · od 18:00',
    venue: 'Fusion Academy',
    address: 'Záhradná 7, Detva',
    poster: '/img/events/halloween-zumba-2026.webp',
    active: true,
    tables_public_max: 0,
    tables_persons_max: 0,
    affiliates: [],
    program: [
      {time:'18:00',         what:'Technický tréning',                 ticket:'full'},
      {time:'19:00 – 21:00', what:'Zumba — dve hodiny tanca',          ticket:'full'},
      {time:'celý večer',    what:'Welcome drink, občerstvenie, otvorený bar', ticket:'full'}
    ],
    types: [
      { key:'full', name:'HALLOWEENSKA ZUMBA PARTY',
        includes:['Technický tréning o 18:00','Zumba 19:00 – 21:00 — dve hodiny tanca','Welcome drink pre každého','Občerstvenie','Otvorený bar','Vstup povolený len v maske'],
        member: null, presale: null, door: null,
        presale_until: '2026-10-30T20:59:59+01:00',
        capacity: null,
        // Marek 25. 10. večer: „tak pre nečlenov 15 eur" — párty otvorená pre každého, nečlenka platí ako permanentka.
        plan_prices: { silver:5, gold:5, bronze:10, bundle:15, nonmember:15 },
        members_only: false }
    ]
  };

  const ALL_EVENTS = [LATIN, SKOLENIE, SKOLENIE2, HALLOWEEN];

  async function ensureEvent(){
    for(const EV of ALL_EVENTS) await ensureOne(EV);
    await patchPartyMemberPrice();
    await patchPlanPrices();
    // Odznak dostanú aj tie, čo si masterclass kúpili predtým, než odznak existoval.
    try{ await grantMasterclassBadge(await q.find(db.ev_tickets,{type:'full'})); }
    catch(e){ console.error('masterclass backfill:', e.message); }
    return await q.one(db.ev_events,{slug:LATIN.slug});
  }

  // 5. 9.: ceny typov sa zo seedu zámerne neprepisujú (kapacity si admin mení sám),
  // preto členskú cenu párty doplníme cielene. Členka 5 € aj pri dverách, cudzí 10 €.
  async function patchPartyMemberPrice(){
    try{
      const ev = await q.one(db.ev_events,{slug:'latin-tropical-2026'});
      if(!ev || !Array.isArray(ev.types)) return;
      const t = ev.types.find(x=>x.key==='party');
      if(!t || (t.member===5 && t.member_after_presale===true)) return;
      const types = ev.types.map(x=>x.key==='party' ? {...x, member:5, member_after_presale:true} : x);
      await q.update(db.ev_events,{_id:ev._id},{$set:{types}});
      console.log('🎟️  Párty: členská cena 5 € platí aj pri dverách');
    }catch(e){ console.error('patchPartyMemberPrice:', e.message); }
  }

  // Cenník podľa úrovne členstva sa drží podľa seedu (kapacity ostávajú z admina) — keď Marek
  // dopíše cenu bez členstva alebo zmení sadzbu, prejaví sa to po nasadení bez ručného zásahu v DB.
  async function patchPlanPrices(){
    try{
      for(const EV of ALL_EVENTS){
        if(!EV.types.some(t=>t.plan_prices)) continue;
        const ev = await q.one(db.ev_events,{slug:EV.slug});
        if(!ev || !Array.isArray(ev.types)) continue;
        let zmena=false;
        const types = ev.types.map(x=>{ const seed=EV.types.find(t=>t.key===x.key); if(!seed||!seed.plan_prices) return x;
          const n={...x, plan_prices:seed.plan_prices, members_only:!!seed.members_only, includes:seed.includes, presale_until:seed.presale_until};
          if(JSON.stringify(n)!==JSON.stringify(x)) zmena=true; return n; });
        if(zmena){ await q.update(db.ev_events,{_id:ev._id},{$set:{types}}); console.log('🎟️  '+EV.slug+': cenník podľa úrovne členstva zosúladený so seedom'); }
      }
    }catch(e){ console.error('patchPlanPrices:', e.message); }
  }

  async function ensureOne(LATIN){
    const found = await q.one(db.ev_events,{slug:LATIN.slug});
    if(!found){ await q.insert(db.ev_events,{...LATIN, created_at:nowISO()}); }
    else {
      // Konfiguráciu (nie predaje) držíme podľa seedu — kapacity sa dajú prepísať v admine.
      const patch = {};
      ['name','subtitle','date','date_label','venue','address','poster','program',
       'tables_persons_max','affiliates'].forEach(k=>{
        if(JSON.stringify(found[k]) !== JSON.stringify(LATIN[k])) patch[k] = LATIN[k];
      });
      if(Object.keys(patch).length) await q.update(db.ev_events,{_id:found._id},{$set:patch});
    }
  }

  // Akcia je za nami, ak jej dátum už prešiel (v SK čase). Podľa toho sa
  // zastaví predaj a z appky aj webu zmizne ponuka.
  function evSkoncil(ev){
    const d = String((ev && ev.date) || '').slice(0,10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d < today() : false;
  }

  // ── Odznak Masterclass #1 ──────────────────────────────────────────────────
  // Kto si KÚPI vstupenku na masterclass, dostane odznak do profilu a 50 bodov
  // do mesačného rebríčka (Marek 5. 9.). Darovaná vstupenka odznak nedáva —
  // odmena je za to, že si to zaplatila. Body sa počítajú z lístkov
  // (masterclassMapInPeriod v server.js), tu sa nastavuje len odznak.
  async function grantMasterclassBadge(tickets){
    try{
      const komu = new Map();
      for(const t of (tickets||[])){
        if(!t || t.type!=='full' || t.status==='void') continue;
        if(t.tier==='gift' || !(+t.price>0)) continue;
        const u = t.user_id ? await q.one(db.users,{_id:t.user_id})
                : (t.holder_email ? await q.one(db.users,{email:String(t.holder_email).toLowerCase()}) : null);
        if(u && !u.masterclass_1) komu.set(u._id, u);
      }
      for(const u of komu.values()){
        await q.update(db.users,{_id:u._id},{$set:{masterclass_1:true, masterclass_1_at:nowISO()}});
        await q.insert(db.notifications,{ user_id:u._id, type:'achievement',
          title:'🏆 Odznak Masterclass #1',
          body:'Máš vstupenku na prvý masterclass Fusion Academy — odznak je v tvojom profile a v rebríčku ti pribudlo 50 bodov. 💛',
          read:false, created_at:nowISO() }).catch(()=>{});
        console.log('🏆 Masterclass #1 → '+(u.name||u.email));
      }
      return komu.size;
    }catch(e){ console.error('grantMasterclassBadge:', e.message); return 0; }
  }

  // ── Ceny a dostupnosť ──────────────────────────────────────────────────────
  // isMember: členská cena je len pre prihlásených členov s aktívnym členstvom.
  // member_after_presale: členská cena platí aj po konci predpredaja. Pri párty to
  // Marek chce (členka 5 €, cudzí 10 €, aj o polnoci pri dverách), pri masterclasse
  // nie — tam sa 45 € viazalo na predpredaj a v mailoch sme napísali, že skončil.
  // ── Ceny podľa úrovne členstva ─────────────────────────────────────────────
  // type.plan_prices = { silver, gold, bronze, bundle, nonmember }: bundle = permanentka (nevyčerpané
  // vstupy, status 'bundle' — nie mesačné členstvo), nonmember = cena bez členstva (null = nedá sa kúpiť).
  // SKÚŠOBNÝ TÝŽDEŇ ZADARMO je tiež membership (trial:true, 0 €) a od 27. 9. ho má každá nová
  // registrácia — plagát hovorí „s mesačným členstvom", preto sa skúška do členskej ceny NERÁTA.
  // Jedno miesto na prepnutie, keby Marek rozhodol inak:
  const SKUSKA_MA_CLENSKU_CENU = false;
  const PLAN_LABEL = { silver:'Silver', gold:'Gold', bronze:'Bronze', bundle:'Permanentka', nonmember:'Bez členstva' };
  async function memberCtx(u){
    if(!u) return { member:false, plan:null, bundle:false, trial:false };
    const now=new Date();
    const aktivne = isMemberActive(u);
    let trial = !!(u.trial_ends_at && !u.trial_converted_at && new Date(u.trial_ends_at) > now);
    if(aktivne && !trial){ const m = await q.one(db.memberships,{user_id:u._id, status:'active'}); if(m && m.trial && !(+m.price>0)) trial = true; }
    const member = aktivne && (!trial || SKUSKA_MA_CLENSKU_CENU);
    return { member, plan: member ? String(u.membership_plan||'').toLowerCase() : null, bundle:(+u.single_entries||0)>0, trial };
  }
  function planPrice(type, ctx){
    const pp = type.plan_prices; if(!pp) return null;
    ctx = ctx || {};
    if(ctx.member && ctx.plan && pp[ctx.plan]!=null) return { price:+pp[ctx.plan], tier:'plan:'+ctx.plan, label:PLAN_LABEL[ctx.plan]||ctx.plan };
    if(ctx.bundle && pp.bundle!=null) return { price:+pp.bundle, tier:'bundle', label:PLAN_LABEL.bundle };
    if(pp.nonmember!=null) return { price:+pp.nonmember, tier:'door', label:PLAN_LABEL.nonmember };
    return { price:null, tier:'none', label:null };
  }
  function priceFor(type, isMember, ctx){
    if(type.plan_prices) return planPrice(type, ctx || { member:!!isMember, plan:null, bundle:false });
    const now = skNow();
    const presaleOpen = now <= new Date(type.presale_until).toISOString();
    if(isMember && type.member != null && (presaleOpen || type.member_after_presale))
      return { price:type.member, tier:'member' };
    if(presaleOpen) return { price:type.presale, tier:'presale' };
    return { price:type.door, tier:'door' };
  }

  // Cena pre klientky partnera. Berieme ju len vtedy, keď je nižšia než tá,
  // ktorú by človek dostal aj tak — nikdy nikomu nezdražie.
  function applyAffPrice(p, type, aff){
    const v = aff && aff.prices && aff.prices[type.key];
    if(v==null || p.price==null || !(v < p.price)) return p;
    return { price:v, tier:'aff' };
  }

  async function soldCount(slug, typeKey){
    const t = await q.find(db.ev_tickets,{event_slug:slug, type:typeKey});
    return t.filter(x=>x.status!=='void').length;
  }

  async function availability(ev){
    const out = {};
    for(const t of ev.types){
      const sold = await soldCount(ev.slug, t.key);
      out[t.key] = { sold, capacity:t.capacity, left: t.capacity==null ? null : Math.max(0, t.capacity - sold) };
    }
    return out;
  }

  // Affiliate kód z odkazu → partner, ak existuje a je aktívny.
  function affFor(ev, code){
    if(!code) return null;
    const c = String(code).toUpperCase().slice(0,20);
    return (ev.affiliates||[]).find(a=>a.code===c) || null;
  }

  async function tablesLeft(ev){
    const res = await q.find(db.ev_tables,{event_slug:ev.slug, status:{$ne:'cancelled'}});
    return { taken:res.length, left:Math.max(0,(ev.tables_public_max||0)-res.length) };
  }

  // Najbližšia aktívna verejná akcia (ambasádorské školenia sa nepropagujú na nástenke).
  async function nextEvent(){
    const evs = (await q.find(db.ev_events,{})).filter(e=>e.active!==false && !evSkoncil(e) && !/^skolenie-/.test(e.slug||''));
    evs.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
    return evs[0] || null;
  }

  // ── Verejný detail eventu ──────────────────────────────────────────────────
  app.options('/api/events/:slug',(req,res)=>{ cors(res); res.sendStatus(204); });
  app.get('/api/events/:slug', async(req,res)=>{
    cors(res);
    try{
      // „next" = najbližšia aktívna akcia (nástenka v appke nemusí poznať slug)
      const ev = req.params.slug==='next' ? await nextEvent() : await q.one(db.ev_events,{slug:req.params.slug});
      if(!ev) return res.status(404).json({error:'Event nenájdený'});
      let isMember = false, me = null;
      if(req.session?.uid){
        me = await q.one(db.users,{_id:req.session.uid});
        isMember = !!(me && isMemberActive(me));
      }
      const affLink = affFor(ev, req.query.a);
      // Členská cena patrí len overenému členovi — buď je prihlásený,
      // alebo zadá e-mail, pod ktorým má v appke aktívne členstvo.
      let memberPrice = isMember;
      let ctx = await memberCtx(me);
      if(!memberPrice && req.query.email){
        const u = await q.one(db.users,{email:String(req.query.email).toLowerCase().trim()});
        memberPrice = !!(u && isMemberActive(u));
        if(u) ctx = await memberCtx(u);
      }
      const avail = await availability(ev);
      const tables = await tablesLeft(ev);
      res.json({
        ok:true,
        event:{ slug:ev.slug, name:ev.name, subtitle:ev.subtitle, date:ev.date, date_label:ev.date_label,
                venue:ev.venue, address:ev.address, poster:ev.poster, program:ev.program,
                tables_public_max:ev.tables_public_max, tables_persons_max:ev.tables_persons_max },
        is_member: isMember,
        ended: evSkoncil(ev),          // appka aj web podľa toho skryjú ponuku
        member_price: memberPrice,
        viewer: { member:ctx.member, plan:ctx.plan, plan_label: ctx.plan ? (PLAN_LABEL[ctx.plan]||ctx.plan) : null, bundle:ctx.bundle, trial:ctx.trial },
        plan_labels: PLAN_LABEL,
        affiliate: affLink ? {code:affLink.code, name:affLink.name} : null,
        types: ev.types.map(t=>{
          const p = applyAffPrice(priceFor(t, memberPrice, ctx), t, affLink);
          const a = avail[t.key];
          return { key:t.key, name:t.name, includes:t.includes, tables:!!t.tables,
                   price:p.price, tier:p.tier, tier_label:p.label||null, eligible:p.price!=null,
                   plan_prices:t.plan_prices||null, members_only:!!t.members_only,
                   member_price:t.member, presale:t.presale, door:t.door,
                   member_after_presale: !!t.member_after_presale,
                   presale_until:t.presale_until,
                   sold:a.sold, left:a.left, sold_out: a.left!=null && a.left<=0 };
        }),
        tables
      });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // Overenie členstva podľa e-mailu — vracia len áno/nie, žiadne osobné údaje.
  app.options('/api/events/:slug/check-member',(req,res)=>{ cors(res); res.sendStatus(204); });
  app.post('/api/events/:slug/check-member', rlPublic, async(req,res)=>{
    cors(res);
    try{
      const email = String(req.body.email||'').toLowerCase().trim();
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.json({ok:true, member:false});
      const u = await q.one(db.users,{email});
      const ctx = await memberCtx(u);
      res.json({ok:true, member: ctx.member, plan: ctx.plan, plan_label: ctx.plan ? (PLAN_LABEL[ctx.plan]||ctx.plan) : null, bundle: ctx.bundle, trial: ctx.trial});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // ── Objednávka + Stripe checkout (funguje aj bez účtu) ─────────────────────
  app.options('/api/events/:slug/order',(req,res)=>{ cors(res); res.sendStatus(204); });
  app.post('/api/events/:slug/order', rlPublic, async(req,res)=>{
    cors(res);
    try{
      const ev = await q.one(db.ev_events,{slug:req.params.slug});
      if(!ev || ev.active===false) return res.status(404).json({error:'Event nie je dostupný'});
      // Po akcii sa vstupenky už nepredávajú. Bez tejto poistky sa dal lístok
      // kúpiť aj týždeň po párty (starý odkaz z mailu, záložka v prehliadači).
      if(evSkoncil(ev)) return res.status(400).json({error:'Táto akcia už prebehla — vstupenky sa nepredávajú.'});

      const buyer_name  = esc(req.body.buyer_name,120);
      const buyer_email = esc(req.body.buyer_email,120).toLowerCase().trim();
      const buyer_phone = esc(req.body.buyer_phone,40);
      if(!buyer_name || !buyer_email) return res.status(400).json({error:'Meno a e-mail sú povinné.'});
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer_email)) return res.status(400).json({error:'Neplatný e-mail.'});

      let me=null, isMember=false;
      if(req.session?.uid){ me = await q.one(db.users,{_id:req.session.uid}); isMember = !!(me && isMemberActive(me)); }

      const aff = affFor(ev, req.body.aff);
      let memberPrice = isMember;
      let ctx = await memberCtx(me);
      if(!memberPrice){
        const u = await q.one(db.users,{email:buyer_email});
        memberPrice = !!(u && isMemberActive(u));
        if(u) ctx = await memberCtx(u);
      }

      // Položky: [{type:'full', qty:2, holders:[{name,email,phone}, …]}]
      const wanted = Array.isArray(req.body.items) ? req.body.items : [];
      const avail = await availability(ev);
      const items = []; let total = 0;
      for(const w of wanted){
        const t = ev.types.find(x=>x.key===w.type);
        if(!t) continue;
        const qty = Math.max(0, Math.min(20, parseInt(w.qty,10)||0));
        if(!qty) continue;
        const a = avail[t.key];
        if(a.left!=null && qty > a.left)
          return res.status(400).json({error:`Pri „${t.name}" ostáva už len ${a.left} ${a.left===1?'miesto':'miest'}.`});
        const p = applyAffPrice(priceFor(t, memberPrice, ctx), t, aff);
        if(p.price==null) return res.status(400).json({error: t.members_only
          ? 'Vstup na túto akciu je pre členky s mesačným členstvom a držiteľky permanentky. Zadaj e-mail, pod ktorým máš členstvo v appke'+(ctx.trial?' (skúšobný týždeň zadarmo sa neráta)':'')+', alebo napíš Beáte na 0904 31 51 51.'
          : 'Pre túto vstupenku nie je určená cena.'});
        const subtotal = +(p.price*qty).toFixed(2);
        total += subtotal;
        const holders = (Array.isArray(w.holders)?w.holders:[]).slice(0,qty).map(h=>({
          name:esc(h?.name,120), email:esc(h?.email,120).toLowerCase(), phone:esc(h?.phone,40)
        }));
        items.push({ type:t.key, type_name:t.name, qty, unit:p.price, tier:p.tier, subtotal, holders });
      }
      if(!items.length) return res.status(400).json({error:'Vyberte aspoň jednu vstupenku.'});
      total = +total.toFixed(2);

      // Rezervácia stola (nepovinná, len k párty a len pre nečlenov — členovia majú VIP stoly)
      let table = null;
      if(req.body.table && !isMember){
        const persons = Math.max(1, Math.min(ev.tables_persons_max||12, parseInt(req.body.table.persons,10)||0));
        const tl = await tablesLeft(ev);
        if(tl.left <= 0) return res.status(400).json({error:'Všetky stoly pre verejnosť sú už rezervované.'});
        table = { persons, note:esc(req.body.table.note,300) };
      }

      if(!STRIPE_SECRET) return res.status(400).json({error:'Platby nie sú nakonfigurované'});
      const order_number = 'EV'+Date.now().toString(36).toUpperCase()+crypto.randomBytes(2).toString('hex').toUpperCase();
      const source = req.body.source==='app' ? 'app' : 'web';
      // UTM snapshot v momente objednávky — spätne sa nedá dorobiť (audit merania 23.8.).
      const rawAttr=req.body.attribution||{}; const cl=v=>String(v||'').slice(0,300);
      const attr={};
      ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid','landing','referrer'].forEach(k=>{ if(rawAttr[k]) attr[k]=cl(rawAttr[k]); });
      if(rawAttr.first&&typeof rawAttr.first==='object'){ const f={};
        ['utm_source','utm_medium','utm_campaign','fbclid','gclid','landing','referrer','captured_at'].forEach(k=>{ if(rawAttr.first[k]) f[k]=cl(rawAttr.first[k]); });
        if(Object.keys(f).length) attr.first=f; }
      const order = await q.insert(db.ev_orders,{
        order_number, event_slug:ev.slug, buyer_name, buyer_email, buyer_phone,
        user_id: me?._id || null, items, total, table, source, attr: Object.keys(attr).length?attr:null,
        aff_code: aff?.code || null, aff_name: aff?.name || null, aff_rate: aff?.rate || null,
        status:'pending', created_at:nowISO(), paid_at:null
      });

      const base = APP_URL.replace(/\/$/,'');
      const params = {
        mode:'payment',
        'payment_method_types[0]':'card',
        'line_items[0][price_data][currency]':'eur',
        'line_items[0][price_data][unit_amount]':Math.round(total*100),
        'line_items[0][price_data][product_data][name]':`${ev.name} — ${items.map(i=>i.qty+'× '+i.type_name).join(', ')}`,
        'line_items[0][quantity]':1,
        'customer_email':buyer_email,
        'metadata[type]':'event_order',
        'metadata[order_number]':order_number,
        'success_url':`${base}/event/${ev.slug}/hotovo?order=${order_number}`,
        'cancel_url':`${base}/event/${ev.slug}?zrusene=1`
      };
      const r = await stripeApi('checkout/sessions', params, 'POST');
      if(r.status>=400) return res.status(400).json({error:r.body?.error?.message||'Platbu sa nepodarilo založiť'});
      await q.update(db.ev_orders,{_id:order._id},{$set:{stripe_session_id:r.body.id}});
      // CAPI InitiateCheckout — event_id z čísla objednávky (Purchase pri fulfille má vlastné pur_…)
      try{ if(metaCapi) metaCapi('InitiateCheckout',{email:buyer_email, value:+total||0,
        fbclid:attr.fbclid||attr.first?.fbclid, event_id:'ic_'+order_number, source_url:attr.landing}).catch(()=>{}); }catch(e){}
      res.json({ok:true, url:r.body.url, order_number});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // ── Fulfilment: vytvoriť vstupenky, poslať mail, faktúru ───────────────────
  // Idempotentné — webhook aj návrat z prehliadača volajú to isté.
  async function fulfillEventOrder(order_number){
    const claimed = await q.update(db.ev_orders,{order_number, status:{$ne:'paid'}},{$set:{status:'paid', paid_at:nowISO()}});
    const order = await q.one(db.ev_orders,{order_number});
    if(!order) return {ok:false, error:'Objednávka nenájdená'};
    if(!claimed) return {ok:true, already:true, order};   // už spracované

    const ev = await q.one(db.ev_events,{slug:order.event_slug});
    // Ak kupujúci má účet s rovnakým e-mailom, vstupenky rovno priradíme
    const acct = order.user_id ? await q.one(db.users,{_id:order.user_id})
                               : await q.one(db.users,{email:order.buyer_email});
    const tickets = [];
    for(const it of order.items){
      for(let i=0;i<it.qty;i++){
        const h = it.holders?.[i] || {};
        tickets.push(await q.insert(db.ev_tickets,{
          code: newCode(),
          event_slug: order.event_slug, type: it.type, type_name: it.type_name,
          order_id: order._id, order_number, price: it.unit, tier: it.tier,
          holder_name: h.name || order.buyer_name,
          holder_email: h.email || order.buyer_email,
          holder_phone: h.phone || order.buyer_phone,
          user_id: acct?._id || null,
          aff_code: order.aff_code || null,
          aff_commission: order.aff_rate ? +(it.unit*order.aff_rate).toFixed(2) : 0,
          aff_paid_out: false, aff_paid_at: null,
          source: order.source, status:'valid',
          checked_in_at:null, checked_in_by:null, checkin_place:null,
          created_at: nowISO()
        }));
      }
    }
    if(order.table){
      await q.insert(db.ev_tables,{
        event_slug:order.event_slug, order_id:order._id, order_number,
        name:order.buyer_name, email:order.buyer_email, phone:order.buyer_phone,
        persons:order.table.persons, note:order.table.note,
        tickets: tickets.length, source:order.source, status:'active', created_at:nowISO()
      });
    }
    await grantMasterclassBadge(tickets);

    // Meta CAPI Purchase — event_id = order_number, takže opakovaný fulfil (webhook +
    // return page) Meta zdeduplikuje a konverzia sa nezaráta dvakrát.
    try{ if(metaCapi) metaCapi('Purchase',{email:order.buyer_email, value:+order.total||0,
      fbclid:order.attr?.fbclid||order.attr?.first?.fbclid, event_id:'pur_'+order.order_number}).catch(()=>{}); }catch(e){}
    // Účtovníctvo + faktúra
    try{
      await q.insert(db.transactions,{ type:'event_ticket', user_id:acct?._id||null,
        user_name:order.buyer_name, amount:order.total, payment_method:'stripe',
        note:`${ev?.name||order.event_slug} — ${order.items.map(i=>i.qty+'× '+i.type_name).join(', ')}`,
        created_at:nowISO(), month:today().slice(0,7) });
    }catch(e){ console.error('event tx:', e.message); }
    try{
      await createInvoice({ user_id:acct?._id||null, client_name:order.buyer_name, client_email:order.buyer_email,
        items: order.items.map(i=>({desc:`${ev?.name||''} — ${i.type_name}`, qty:i.qty, total:i.subtotal})),
        total: order.total, method:'Stripe (karta)',
        order_id:order._id, order_number:order.order_number });
    }catch(e){ console.error('event invoice:', e.message); }

    if(acct){
      await q.insert(db.notifications,{ user_id:acct._id, type:'ticket',
        title:'🎟️ Vstupenky sú tvoje!',
        body:`${ev?.name||''} · ${tickets.length}× vstupenka. Nájdeš ich na dashboarde v sekcii Moje vstupenky.`,
        read:false, created_at:nowISO() }).catch(()=>{});
    }
    // Kupujúci dostane všetky QR kódy — jeho sken potvrdí celý nákup.
    await sendTicketMail(order, tickets, ev).catch(e=>console.error('ticket mail:', e.message));

    // Ak niekto vyplnil vlastný e-mail držiteľa, pošleme mu jeho vstupenku zvlášť.
    for(const tk of tickets){
      const to = String(tk.holder_email||'').toLowerCase();
      if(!to || to === String(order.buyer_email||'').toLowerCase()) continue;
      await sendTicketMail({...order, buyer_email:to, buyer_name:tk.holder_name}, [tk], ev)
        .catch(e=>console.error('holder mail:', e.message));
    }

    // Upozornenie pre nás — čo sa predalo, komu a cez koho.
    try{
      const what = order.items.map(i=>i.qty+'× '+i.type_name).join(', ');
      const affLine = order.aff_name ? ' · cez '+order.aff_name : '';
      const tblLine = order.table ? '<br>Rezervoval si aj stôl pre '+order.table.persons+' osôb.' : '';
      await notifyOwners(
        '🎟️ Predaná vstupenka — '+eur(order.total)+' €',
        what+' · '+order.buyer_name+affLine,
        `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#0a0a0a;color:#eee;padding:20px">
          <h2 style="color:#C9A84C;margin:0 0 10px">🎟️ Nový predaj vstupeniek</h2>
          <p style="font-size:1.1rem;margin:0 0 12px"><b>${what}</b> — <b>${eur(order.total)} €</b></p>
          <p style="margin:0 0 6px">Kupujúci: <b>${order.buyer_name}</b><br>
          E-mail: ${order.buyer_email}<br>Telefón: ${order.buyer_phone||'—'}</p>
          <p style="margin:0 0 6px">Kanál: ${String(order.source||'').toUpperCase()}${order.aff_name?' · partner <b>'+order.aff_name+'</b>':''}${tblLine}</p>
          <p style="color:#888;font-size:12px">Objednávka ${order.order_number} · ${ev?.name||''}</p>
          </body></html>`);
    }catch(e){ console.error('owner notify:', e.message); }

    return {ok:true, order, tickets};
  }

  async function sendTicketMail(order, tickets, ev, opts){
    const base = APP_URL.replace(/\/$/,'');
    const gift = !!(opts && opts.gift);
    const note = (opts && opts.note) ? String(opts.note).trim() : '';
    const subject = (opts && opts.subject) ? String(opts.subject).trim() : '';
    const rows = tickets.map((t,i)=>`
      <tr><td style="padding:18px 0;border-top:1px solid #2a2a2a">
        <div style="color:#C9A84C;font-weight:700;font-size:15px">${t.type_name}</div>
        <div style="color:#fff;font-size:14px;margin:2px 0">Držiteľ: ${t.holder_name}</div>
        <div style="color:#888;font-size:12px">Vstupenka č. ${i+1} z ${tickets.length} · kód ${t.code}</div>
        <img src="${base}/api/tickets/${t.code}/qr.png" width="220" height="220"
             alt="QR kód vstupenky ${t.code}" style="display:block;margin:12px 0 0;background:#fff;padding:8px;border-radius:8px">
      </td></tr>`).join('');
    const html = `<!doctype html><html><body style="margin:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif">
      <div style="max-width:600px;margin:0 auto;background:#111;padding:28px">
        <div style="font-size:22px;color:#fff;font-weight:700;letter-spacing:.5px">FUSION <span style="color:#C9A84C">ACADEMY</span></div>
        <div style="margin:22px 0 8px;color:#C9A84C;font-size:13px;letter-spacing:.12em">${gift?'DARČEK PRE TEBA':'POTVRDENIE — ZAPLATENÉ'}</div>
        <h1 style="color:#fff;font-size:24px;margin:0 0 6px">${ev?.name||'Event'}</h1>
        <p style="color:#c8c8c8;margin:0 0 4px">${ev?.date_label||''} · ${ev?.venue||''}, ${ev?.address||''}</p>
        <p style="color:#888;margin:0 0 18px;font-size:13px">Objednávka ${order.order_number}${gift?' · vstupenka ako darček od Fusion Academy 🎁':' · zaplatené '+eur(order.total)+' €'}</p>
        ${note?`<div style="background:#191510;border-left:3px solid #C9A84C;padding:14px 16px;margin:0 0 18px;color:#e8e2d4;font-size:14px;line-height:1.6;white-space:pre-wrap">${note}</div>`:''}
        <table width="100%" cellspacing="0" cellpadding="0">${rows}</table>
        <p style="color:#c8c8c8;font-size:13px;line-height:1.7;margin-top:22px">
          QR kód ukáž pri vstupe priamo z telefónu — každá vstupenka má vlastný a platí len raz.
        </p>
        <p style="margin-top:20px"><a href="${base}/event/${order.event_slug}"
           style="background:#C9A84C;color:#000;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Detail eventu a program →</a></p>
        <p style="color:#666;font-size:12px;margin-top:26px">Otázky? Zavolaj na 0904 31 51 51.</p>
      </div></body></html>`;
    await sendMail(order.buyer_email, subject || (gift ? `🎁 Darček pre teba — ${ev?.name||'Fusion Academy'}` : `🎟️ Vstupenky — ${ev?.name||'Fusion Academy'}`), html);
  }

  // Stav objednávky po návrate z platby (bez prihlásenia)
  app.options('/api/events/order/:num',(req,res)=>{ cors(res); res.sendStatus(204); });
  app.get('/api/events/order/:num', async(req,res)=>{
    cors(res);
    try{
      let order = await q.one(db.ev_orders,{order_number:req.params.num});
      if(!order) return res.status(404).json({error:'Objednávka nenájdená'});
      // Poistka, keby webhook meškal: over stav priamo v Stripe.
      if(order.status!=='paid' && order.stripe_session_id && STRIPE_SECRET){
        const r = await stripeApi('checkout/sessions/'+encodeURIComponent(order.stripe_session_id), null, 'GET');
        if(r.body?.payment_status==='paid'){ await fulfillEventOrder(order.order_number); order = await q.one(db.ev_orders,{order_number:req.params.num}); }
      }
      const tickets = await q.find(db.ev_tickets,{order_number:order.order_number});
      res.json({ok:true, status:order.status, order_number:order.order_number, total:order.total,
        buyer_email:order.buyer_email,
        tickets: tickets.map(t=>({code:t.code, type_name:t.type_name, holder_name:t.holder_name, status:t.status}))});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // ── QR obrázok vstupenky (kód je tajomstvo, preto stačí poznať kód) ────────
  app.get('/api/tickets/:code/qr.png', async(req,res)=>{
    try{
      const code = String(req.params.code).replace(/\.png$/,'').toUpperCase();
      const t = await q.one(db.ev_tickets,{code});
      if(!t) return res.status(404).end();
      const png = await QR.toBuffer(`${APP_URL.replace(/\/$/,'')}/t/${code}`, {width:600, margin:1,
        color:{dark:'#000000', light:'#FFFFFF'}, errorCorrectionLevel:'M'});
      res.setHeader('Content-Type','image/png');
      res.setHeader('Cache-Control','public, max-age=86400');
      res.end(png);
    }catch(e){ res.status(500).end(); }
  });

  // ── Moje vstupenky (appka) ────────────────────────────────────────────────
  app.get('/api/my/tickets', auth, async(req,res)=>{
    try{
      const u = await q.one(db.users,{_id:req.session.uid});
      // Vstupenky kúpené pred registráciou spárujeme podľa e-mailu.
      if(u?.email){
        for(const t of await q.find(db.ev_tickets,{holder_email:u.email, user_id:null}))
          await q.update(db.ev_tickets,{_id:t._id},{$set:{user_id:u._id}});
      }
      const mine = await q.find(db.ev_tickets,{user_id:req.session.uid});
      const bySlug = {};
      for(const t of mine){ (bySlug[t.event_slug] = bySlug[t.event_slug] || []).push(t); }
      const out = [];
      for(const slug of Object.keys(bySlug)){
        const ev = await q.one(db.ev_events,{slug});
        out.push({ event:{slug, name:ev?.name, date:ev?.date, date_label:ev?.date_label,
                          venue:ev?.venue, address:ev?.address, program:ev?.program, poster:ev?.poster},
                   tickets: bySlug[slug].map(t=>({code:t.code, type:t.type, type_name:t.type_name,
                     holder_name:t.holder_name, status:t.status, checked_in_at:t.checked_in_at,
                     price:t.price, created_at:t.created_at})) });
      }
      out.sort((a,b)=>String(a.event.date||'').localeCompare(String(b.event.date||'')));
      res.json({ok:true, events:out});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // ── Overenie a check-in ───────────────────────────────────────────────────
  // Kiosk beží na tokene, admin na session — obe cesty vedú sem.
  async function kioskOk(req){
    const k = req.query.k || req.body?.k;
    if(!k) return false;
    const s = await q.one(db.settings,{key:'kiosk_config'});
    const cfg = s?.value || {};
    return Object.values(cfg).some(v=>v && v.token && v.token===k && v.enabled!==false);
  }
  async function staffOk(req){
    if(await kioskOk(req)) return true;
    if(!req.session?.uid) return false;
    const u = await q.one(db.users,{_id:req.session.uid});
    return !!(u && (u.is_admin || u.is_trainer));
  }

  app.get('/api/tickets/:code', async(req,res)=>{
    try{
      if(!(await staffOk(req))) return res.status(403).json({error:'Bez oprávnenia'});
      const t = await q.one(db.ev_tickets,{code:String(req.params.code).toUpperCase()});
      if(!t) return res.json({ok:false, state:'invalid', message:'NEPLATNÝ QR KÓD'});
      const ev = await q.one(db.ev_events,{slug:t.event_slug});
      const order = await q.one(db.ev_orders,{_id:t.order_id});
      const paid = !order || order.status==='paid';
      res.json({ok:true, state: t.status==='used' ? 'used' : (paid ? 'valid' : 'unpaid'),
        ticket:{ code:t.code, type_name:t.type_name, holder_name:t.holder_name,
                 event_name:ev?.name, event_slug:t.event_slug, price:t.price,
                 created_at:t.created_at, checked_in_at:t.checked_in_at, checkin_place:t.checkin_place }});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // Hromadné označenie prítomnosti — keď sa QR pri dverách nestíha skenovať
  // (5. 9.: prišli všetci, nikto nič nenačítal). Zapíše sa rovnako ako sken,
  // len s poznámkou, že to bolo dodatočne a kým. Už použité lístky nechá tak.
  app.post('/api/admin/events/:slug/checkin-all', adminAuth, async(req,res)=>{
    try{
      const ev = await q.one(db.ev_events,{slug:req.params.slug});
      if(!ev) return res.status(404).json({error:'Event nenájdený'});
      const kody = Array.isArray(req.body.codes) ? req.body.codes.map(c=>String(c).toUpperCase()) : null;
      const at = nowISO(), by = req.session?.uid || null;
      const lístky = (await q.find(db.ev_tickets,{event_slug:ev.slug, status:'valid'}))
        .filter(t => !kody || kody.includes(String(t.code).toUpperCase()));
      let n = 0;
      for(const t of lístky){
        const claimed = await q.update(db.ev_tickets,{_id:t._id, status:'valid'},
          {$set:{status:'used', checked_in_at:at, checked_in_by:by,
                 checkin_place: ev.venue||'', checkin_manual:true}});
        if(claimed) n++;
      }
      const vsetky = (await q.find(db.ev_tickets,{event_slug:ev.slug})).filter(t=>t.status!=='void');
      console.log('✅ '+ev.name+': dodatočne označených prítomných '+n);
      res.json({ok:true, marked:n, total:vsetky.length,
        checked_in: vsetky.filter(t=>t.status==='used').length});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  app.post('/api/tickets/:code/checkin', async(req,res)=>{
    try{
      if(!(await staffOk(req))) return res.status(403).json({error:'Bez oprávnenia'});
      const code = String(req.params.code).toUpperCase();
      const t = await q.one(db.ev_tickets,{code});
      if(!t) return res.json({ok:false, state:'invalid', message:'NEPLATNÝ QR KÓD'});
      const ev = await q.one(db.ev_events,{slug:t.event_slug});
      const order = await q.one(db.ev_orders,{_id:t.order_id});
      if(order && order.status!=='paid')
        return res.json({ok:false, state:'unpaid', message:'PLATBA NEBOLA POTVRDENÁ', ticket:{holder_name:t.holder_name, type_name:t.type_name}});
      if(t.status==='used')
        return res.json({ok:false, state:'used', message:'VSTUPENKA UŽ BOLA POUŽITÁ',
          ticket:{holder_name:t.holder_name, type_name:t.type_name, checked_in_at:t.checked_in_at, checkin_place:t.checkin_place}});
      const at = nowISO();
      const by = req.session?.uid || 'kiosk';
      const place = esc(req.body?.place || req.query.place || (ev?.venue||''),80);
      // Atomicky: druhý sken v tej istej sekunde už neprejde.
      const claimed = await q.update(db.ev_tickets,{_id:t._id, status:'valid'},
        {$set:{status:'used', checked_in_at:at, checked_in_by:by, checkin_place:place}});
      if(!claimed) return res.json({ok:false, state:'used', message:'VSTUPENKA UŽ BOLA POUŽITÁ'});

      // Jedna objednávka = jedna partia. Sken jedného kódu pustí dnu všetky
      // jej vstupenky, aby ich nemusel skenovať po jednej.
      let group = 1; const alsoIn = [];
      if(t.order_number){
        for(const o of await q.find(db.ev_tickets,{order_number:t.order_number, status:'valid'})){
          const ok = await q.update(db.ev_tickets,{_id:o._id, status:'valid'},
            {$set:{status:'used', checked_in_at:at, checked_in_by:by, checkin_place:place,
                   checkin_group_of: t.code}});
          if(ok){ group++; alsoIn.push(o.type_name); }
        }
      }
      const msg = group>1 ? ('VSTUP POVOLENÝ — '+group+' OSOBY/OSÔB') : 'VSTUP POVOLENÝ — ZAPLATENÉ';
      res.json({ok:true, state:'ok', message:msg, group,
        ticket:{ code:t.code, holder_name:t.holder_name, type_name:t.type_name, event_name:ev?.name,
                 group_tickets: group>1 ? [t.type_name].concat(alsoIn) : null }});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // ── Admin ─────────────────────────────────────────────────────────────────
  // Zoznam eventov — admin si medzi nimi prepína.
  app.get('/api/admin/events', adminAuth, async(req,res)=>{
    try{
      const list = await q.find(db.ev_events,{});
      list.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
      res.json({ok:true, events:list.map(e=>({slug:e.slug, name:e.name, date:e.date,
        date_label:e.date_label, active:e.active!==false}))});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  app.get('/api/admin/events/:slug/stats', adminAuth, async(req,res)=>{
    try{
      const ev = await q.one(db.ev_events,{slug:req.params.slug});
      if(!ev) return res.status(404).json({error:'Event nenájdený'});
      const tickets = (await q.find(db.ev_tickets,{event_slug:ev.slug})).filter(t=>t.status!=='void');
      // Rozdaný lístok nie je predaj — Marek chce vidieť oddelene, koľko sa predalo
      // a koľko rozdalo (5. 9.). Darček spoznáme podľa tier 'gift' alebo nulovej ceny.
      const jeDar = x => x.tier==='gift' || !(+x.price>0);
      const perType = {};
      for(const t of ev.types){
        const mine = tickets.filter(x=>x.type===t.key);
        const dary = mine.filter(jeDar), predane = mine.filter(x=>!jeDar(x));
        perType[t.key] = { name:t.name, sold:mine.length,
          paid: predane.length, gifts: dary.length,
          revenue:+predane.reduce((s,x)=>s+(+x.price||0),0).toFixed(2),
          checked_in: mine.filter(x=>x.status==='used').length,
          capacity: t.capacity, left: t.capacity==null?null:Math.max(0,t.capacity-mine.length) };
      }
      const daryAll = tickets.filter(jeDar), predaneAll = tickets.filter(x=>!jeDar(x));
      const bySource = {};
      for(const t of tickets) bySource[t.source||'web'] = (bySource[t.source||'web']||0)+1;
      const affiliates = (ev.affiliates||[]).map(a=>{
        const mine = tickets.filter(x=>x.aff_code===a.code);
        const unpaid = mine.filter(x=>!x.aff_paid_out);
        return { code:a.code, name:a.name, rate:a.rate,
          link: APP_URL.replace(/\/$/,'')+'/event/'+ev.slug+'?a='+a.code,
          sold: mine.length,
          revenue: +mine.reduce((s,x)=>s+(+x.price||0),0).toFixed(2),
          commission: +mine.reduce((s,x)=>s+(+x.aff_commission||0),0).toFixed(2),
          to_pay: +unpaid.reduce((s,x)=>s+(+x.aff_commission||0),0).toFixed(2),
          paid_out: +mine.filter(x=>x.aff_paid_out).reduce((s,x)=>s+(+x.aff_commission||0),0).toFixed(2),
          unpaid_tickets: unpaid.length };
      });
      const tbl = await q.find(db.ev_tables,{event_slug:ev.slug, status:{$ne:'cancelled'}});
      res.json({ ok:true, event:{name:ev.name, date_label:ev.date_label, venue:ev.venue},
        per_type: perType,
        total_sold: tickets.length,
        total_paid: predaneAll.length,
        total_gifts: daryAll.length,
        total_revenue: +predaneAll.reduce((s,x)=>s+(+x.price||0),0).toFixed(2),
        // Koľko ľudí naozaj prišlo — jeden človek môže mať aj dva typy vstupeniek
        people: new Set(tickets.filter(t=>t.status==='used')
          .map(t=>String(t.holder_email||'').toLowerCase() || t.code)).size,
        checked_in: tickets.filter(t=>t.status==='used').length,
        by_source: bySource,
        affiliates,
        tables: { reserved:tbl.length, free:Math.max(0,(ev.tables_public_max||0)-tbl.length),
                  persons: tbl.reduce((s,t)=>s+(+t.persons||0),0),
                  list: tbl.map(t=>({id:t._id, name:t.name, email:t.email, phone:t.phone, persons:t.persons,
                                     tickets:t.tickets, note:t.note, source:t.source, created_at:t.created_at})) } });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  app.get('/api/admin/events/:slug/attendees', adminAuth, async(req,res)=>{
    try{
      let list = await q.find(db.ev_tickets,{event_slug:req.params.slug});
      const f = req.query.filter||'';
      if(f==='full'||f==='party') list = list.filter(t=>t.type===f);
      if(f.startsWith('aff:')) list = list.filter(t=>t.aff_code===f.slice(4));
      if(f==='in')   list = list.filter(t=>t.status==='used');
      if(f==='out')  list = list.filter(t=>t.status==='valid');
      const orders = await q.find(db.ev_orders,{event_slug:req.params.slug});
      const paidMap = Object.fromEntries(orders.map(o=>[String(o._id), o.status==='paid']));
      list.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
      res.json({ok:true, attendees:list.map(t=>({
        code:t.code, name:t.holder_name, email:t.holder_email, phone:t.holder_phone,
        type:t.type, type_name:t.type_name, price:t.price, tier:t.tier, source:t.source,
        aff_code:t.aff_code||null, aff_commission:t.aff_commission||0, aff_paid_out:!!t.aff_paid_out,
        paid: t.source==='admin' ? true : (paidMap[String(t.order_id)] !== false),
        status:t.status, checked_in_at:t.checked_in_at, created_at:t.created_at }))});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  app.get('/api/admin/events/:slug/export.csv', adminAuth, async(req,res)=>{
    try{
      const list = await q.find(db.ev_tickets,{event_slug:req.params.slug});
      list.sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')));
      const cell = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
      const rows = [['Meno','Priezvisko','Email','Telefon','Typ vstupenky','Cena','Datum nakupu','Stav check-inu','Cas prichodu','Kod','Zdroj','Partner','Provizia','Provizia vyplatena'].join(';')];
      for(const t of list){
        const parts = String(t.holder_name||'').trim().split(/\s+/);
        const first = parts.slice(0,-1).join(' ') || parts[0] || '';
        const last  = parts.length>1 ? parts[parts.length-1] : '';
        rows.push([first,last,t.holder_email,t.holder_phone,t.type_name,eur(t.price),
          String(t.created_at||'').slice(0,16).replace('T',' '),
          t.status==='used'?'Prisiel':'Neprisiel',
          String(t.checked_in_at||'').slice(0,16).replace('T',' '), t.code, (t.source||'').toUpperCase(),
          t.aff_code||'', t.aff_commission?eur(t.aff_commission):'', t.aff_code?(t.aff_paid_out?'ano':'nie'):''].map(cell).join(';'));
      }
      res.setHeader('Content-Type','text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',`attachment; filename="${req.params.slug}-ucastnici.csv"`);
      res.end('﻿'+rows.join('\r\n'));   // BOM → Excel otvorí diakritiku správne
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // Predaj na mieste (hotovosť) — vstupenka vznikne hneď, bez Stripe.
  app.post('/api/admin/events/:slug/onsite', adminAuth, async(req,res)=>{
    try{
      const ev = await q.one(db.ev_events,{slug:req.params.slug});
      if(!ev) return res.status(404).json({error:'Event nenájdený'});
      const isMemberSale = !!req.body.member;
      // Dar: vstupenka zadarmo — 0 €, bez faktúry, mail znie ako darček.
      const isGift = !!req.body.gift;
      const mailNote = esc(req.body.note, 600);
      const mailSubject = esc(req.body.subject, 160);
      // Prijmeme buď jeden typ (staršia forma), alebo rovno viac typov naraz.
      const wanted = Array.isArray(req.body.items) && req.body.items.length
        ? req.body.items
        : [{ type:req.body.type, qty:req.body.qty, price:req.body.price }];
      const avail = await availability(ev);
      // Cenník podľa úrovne: admin pošle plan (silver/gold/bronze/bundle/nonmember), inak sa úroveň
      // zistí z účtu podľa e-mailu; bez toho a bez ručnej ceny sa predaj odmietne.
      const planSel = String(req.body.plan||'').toLowerCase();
      const emailEarly = esc(req.body.email,120).toLowerCase();
      const acctEarly = emailEarly ? await q.one(db.users,{email:emailEarly}) : null;
      const ctxEarly = await memberCtx(acctEarly);
      const lines = [];
      for(const w of wanted){
        const t = ev.types.find(x=>x.key===w.type);
        if(!t) continue;
        const qty = Math.max(0, Math.min(20, parseInt(w.qty,10)||0));
        if(!qty) continue;
        const left = avail[t.key].left;
        if(left!=null && qty>left) return res.status(400).json({error:`Pri „${t.name}" ostáva len ${left} miest.`});
        // Cena pri dverách: predpredaj je výhoda za nákup online, nie za to, že
        // človek príde na miesto. Preto tu platí jednoduché pravidlo (Marek 5. 9.):
        // členka členskú cenu, cudzí cenu na mieste. Ručne zadaná cena má prednosť.
        let tierSel = null;
        let price;
        if(isGift) price = 0;
        else if(w.price!=null && w.price!=='') price = Math.max(0,+w.price);
        else if(t.plan_prices){
          const pp=t.plan_prices;
          const pr = (planSel && pp[planSel]!=null) ? { price:+pp[planSel], tier: planSel==='bundle'?'bundle':(planSel==='nonmember'?'door':'plan:'+planSel) } : planPrice(t, ctxEarly);
          if(pr.price==null) return res.status(400).json({error:`Pri „${t.name}" vyber úroveň členstva (Silver/Gold, Bronze, permanentka) alebo zadaj cenu.`});
          price = pr.price; tierSel = pr.tier;
        }
        else price = (isMemberSale && t.member!=null) ? t.member : (t.door!=null ? t.door : priceFor(t, isMemberSale).price);
        // Mená ďalších osôb — vstupenka môže znieť na kamarátku, nielen na kupujúcu.
        const holders=(Array.isArray(w.holders)?w.holders:[]).slice(0,qty).map(h=>({
          name:esc(h&&h.name,120), email:esc(h&&h.email,120).toLowerCase(), phone:esc(h&&h.phone,40) }));
        lines.push({ t, qty, price, holders, tier:tierSel });
      }
      if(!lines.length) return res.status(400).json({error:'Vyber aspoň jednu vstupenku.'});
      const total = +lines.reduce((s,l)=>s+l.price*l.qty,0).toFixed(2);
      const name = esc(req.body.name,120) || 'Predaj na mieste';
      const email = esc(req.body.email,120).toLowerCase();
      // Ak je pod týmto e-mailom registrovaná, vstupenka jej padne rovno do appky.
      const acct = email ? await q.one(db.users,{email}) : null;
      const method = isGift ? 'dar' : (req.body.method==='transfer' ? 'prevod' : 'hotovosť');
      const affO = affFor(ev, req.body.aff);
      const order = await q.insert(db.ev_orders,{
        order_number:'EVX'+Date.now().toString(36).toUpperCase(), event_slug:ev.slug,
        aff_code: affO?.code||null, aff_name: affO?.name||null, aff_rate: affO?.rate||null,
        buyer_name:name, buyer_email:email, buyer_phone:esc(req.body.phone,40),
        user_id:acct?._id||null,
        items: lines.map(l=>({type:l.t.key, type_name:l.t.name, qty:l.qty, unit:l.price,
          tier: isGift?'gift':(l.tier||(isMemberSale?'member':'door')), subtotal:+(l.price*l.qty).toFixed(2), holders:l.holders||[]})),
        total, table:null, source:'admin', status:'paid', gift:isGift, admin_note:mailNote||null,
        created_at:nowISO(), paid_at:nowISO(), payment_method:method
      });
      const made=[];
      for(const l of lines){
        for(let i=0;i<l.qty;i++){ const h=(l.holders||[])[i]||{}; made.push(await q.insert(db.ev_tickets,{
          code:newCode(), event_slug:ev.slug, type:l.t.key, type_name:l.t.name,
          order_id:order._id, order_number:order.order_number, price:l.price,
          tier: isGift?'gift':(l.tier||(isMemberSale?'member':'door')),
          holder_name: h.name||name, holder_email: h.email||order.buyer_email, holder_phone: h.phone||order.buyer_phone,
          user_id:acct?._id||null, source:'admin', status:'valid',
          aff_code: affO?.code||null, aff_commission: affO? +(l.price*affO.rate).toFixed(2) : 0,
          aff_paid_out:false, aff_paid_at:null,
          checked_in_at:null, checked_in_by:null, checkin_place:null, created_at:nowISO()})); }
      }
      await grantMasterclassBadge(made);
      const summary = lines.map(l=>l.qty+'× '+l.t.name).join(', ');
      await q.insert(db.transactions,{type:'event_ticket', user_id:acct?._id||null, user_name:name, channel:'onsite',
        amount:total, payment_method:method,
        note: isGift ? `${ev.name} — ${summary} (darček, 0 €)` : `${ev.name} — ${summary} (ručný predaj, ${method})`, created_at:nowISO(), month:today().slice(0,7)});
      try{
        if(!isGift) await createInvoice({ user_id:acct?._id||null, client_name:name, client_email:email,
          items: lines.map(l=>({desc:`${ev.name} — ${l.t.name}`, qty:l.qty, total:+(l.price*l.qty).toFixed(2)})),
          total, method, order_id:order._id, order_number:order.order_number });
      }catch(e){ console.error('onsite invoice:', e.message); }
      if(acct){
        await q.insert(db.notifications,{ user_id:acct._id, type:'ticket',
          title: isGift ? '🎁 Darček — vstupenky sú tvoje!' : '🎟️ Vstupenky sú tvoje!',
          body:`${ev.name} · ${summary}. Nájdeš ich na dashboarde v sekcii Moje vstupenky.`,
          read:false, created_at:nowISO() }).catch(()=>{});
      }
      // Mail s QR ide vždy, aj keď má appku — nech to má po ruke.
      if(email) await sendTicketMail(order, made, ev, {gift:isGift, note:mailNote, subject:mailSubject}).catch(()=>{});
      res.json({ok:true, tickets:made.map(x=>x.code), total, summary, gift:isGift,
        linked: !!acct, emailed: !!email});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // Telefonická rezervácia stola — Beátka ju zapíše ručne.
  app.post('/api/admin/events/:slug/table', adminAuth, async(req,res)=>{
    try{
      const ev = await q.one(db.ev_events,{slug:req.params.slug});
      if(!ev) return res.status(404).json({error:'Event nenájdený'});
      const name = esc(req.body.name,120);
      if(!name) return res.status(400).json({error:'Meno je povinné.'});
      const persons = Math.max(1, Math.min(ev.tables_persons_max||8, parseInt(req.body.persons,10)||0));
      const tl = await tablesLeft(ev);
      if(tl.left<=0) return res.status(400).json({error:'Všetky stoly sú už rezervované.'});
      await q.insert(db.ev_tables,{ event_slug:ev.slug, order_id:null, order_number:null,
        name, email:esc(req.body.email,120).toLowerCase(), phone:esc(req.body.phone,40),
        persons, note:esc(req.body.note,300), tickets:0, source:'admin', status:'active', created_at:nowISO() });
      const left = (await tablesLeft(ev)).left;
      await notifyOwners('🍾 Rezervovaný stôl — '+name,
        persons+' osôb · voľné stoly: '+left,
        `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#0a0a0a;color:#eee;padding:20px">
          <h2 style="color:#C9A84C;margin:0 0 10px">🍾 Rezervácia stola (zapísaná ručne)</h2>
          <p><b>${name}</b> — ${persons} osôb<br>Telefón: ${esc(req.body.phone,40)||'—'}</p>
          <p style="color:#888">Voľné stoly pre verejnosť: <b>${left}</b> zo ${ev.tables_public_max}</p>
          </body></html>`).catch(()=>{});
      res.json({ok:true});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  app.post('/api/admin/events/:slug/table/cancel', adminAuth, async(req,res)=>{
    try{
      const r = await q.update(db.ev_tables,{_id:req.body.id},{$set:{status:'cancelled', cancelled_at:nowISO()}});
      res.json({ok:!!r});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // Označiť províziu partnera za vyplatenú — zapíše sa aj do účtovníctva.
  app.post('/api/admin/events/:slug/affiliate/payout', adminAuth, async(req,res)=>{
    try{
      const ev = await q.one(db.ev_events,{slug:req.params.slug});
      if(!ev) return res.status(404).json({error:'Event nenájdený'});
      const a = affFor(ev, req.body.code);
      if(!a) return res.status(400).json({error:'Neznámy partner'});
      const open = (await q.find(db.ev_tickets,{event_slug:ev.slug, aff_code:a.code}))
        .filter(t=>!t.aff_paid_out && t.status!=='void');
      if(!open.length) return res.status(400).json({error:'Niet čo vyplácať.'});
      const amount = +open.reduce((s,t)=>s+(+t.aff_commission||0),0).toFixed(2);
      const at = nowISO();
      for(const t of open) await q.update(db.ev_tickets,{_id:t._id},{$set:{aff_paid_out:true, aff_paid_at:at}});
      await q.insert(db.transactions,{ type:'event_affiliate_payout', user_id:null, user_name:a.name,
        amount:-amount, payment_method: esc(req.body.method,40) || 'hotovosť',
        note:`Provízia ${a.name} — ${open.length}× vstupenka (${Math.round(a.rate*100)} %) · ${ev.name}`,
        created_at:at, month:today().slice(0,7) });
      res.json({ok:true, amount, tickets:open.length});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // Zmena kapacity / vypnutie predaja
  app.post('/api/admin/events/:slug/settings', adminAuth, async(req,res)=>{
    try{
      const ev = await q.one(db.ev_events,{slug:req.params.slug});
      if(!ev) return res.status(404).json({error:'Event nenájdený'});
      const set = {};
      if(req.body.active!=null) set.active = !!req.body.active;
      if(req.body.tables_public_max!=null) set.tables_public_max = Math.max(0,parseInt(req.body.tables_public_max,10)||0);
      if(req.body.capacities){
        set.types = ev.types.map(t=>{
          const c = req.body.capacities[t.key];
          if(c===undefined) return t;
          return {...t, capacity: (c===null||c==='') ? null : Math.max(0,parseInt(c,10)||0)};
        });
      }
      await q.update(db.ev_events,{_id:ev._id},{$set:set});
      res.json({ok:true});
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // ── Mailová pozvánka na Halloweensku Zumba Party (25. 10. 2026) ────────────
  // Komu: LEN tomu, kto si vstup reálne vie kúpiť. To nie je to isté ako „má
  // členstvo": skúšobný týždeň zadarmo je tiež membership, ale členskú cenu
  // nedáva (SKUSKA_MA_CLENSKU_CENU=false), takže žena na skúške by dostala
  // pozvánku na niečo, čo si kúpiť nevie. memberCtx + planPrice to rozhodnú
  // na jednom mieste, takže sa to nemôže rozísť s tým, čo ukazuje stránka eventu.
  // Poistka ako pri EV_DOPREDAJ: deploy NIE JE schválenie — bez HALLOWEEN_GO=1
  // v Railway env sa neodošle nič, aj keď je kód na produkcii.
  const HALLOWEEN_SUBJ = '🎃 Halloweenska Zumba Party — tento piatok, vstup len v maske';
  const HALLOWEEN_URL  = APP_URL.replace(/\/$/,'') + '/event/' + HALLOWEEN.slug;

  async function halloweenAudience(){
    const ev = await q.one(db.ev_events,{slug:HALLOWEEN.slug});
    const type = ev && (ev.types||[]).find(t=>t.key==='full');
    const vynechani = {}; const preco = d => { vynechani[d]=(vynechani[d]||0)+1; };
    if(!type) return { prijemcovia:[], vynechani:{'event sa nenašiel':1} };
    const users = await q.find(db.users,{});
    const uzDostali = new Set((await q.find(db.mail_log,{}))
      .filter(m=>m.subject===HALLOWEEN_SUBJ).map(m=>String(m.to||'').toLowerCase()));
    const testMail = String(process.env.TEST_ACC_EMAIL||'').toLowerCase();
    const prijemcovia = [];
    for(const u of users){
      const email = String(u.email||'').trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { preco('bez platného e-mailu'); continue; }
      // @import.local sú syntetické adresy zo starého zoznamu — sendMail ich aj tak odmietne
      if(/@import\.local$/i.test(email)) { preco('importovaná adresa bez mailu'); continue; }
      if(/@test-fa-qa\.local$/i.test(email) || u.is_test || u.lead_source==='test'
         || (testMail && email===testMail)) { preco('testovací účet'); continue; }
      if(u.active===false) { preco('deaktivovaný účet'); continue; }
      if(u.is_child) { preco('detský účet'); continue; }
      if(vencekMimoKonverzie(u)) { preco('venčekár (nie je klientka)'); continue; }
      if(u.offers_optout || u.do_not_contact) { preco('odhlásená z mailov'); continue; }
      if(!(u.email_consent || u.consent_at)) { preco('bez súhlasu na e-mail'); continue; }
      const mctx = await memberCtx(u);
      const p = planPrice(type, mctx);
      if(!p || p.price == null) { preco(mctx.trial ? 'má len týždeň zadarmo' : 'bez členstva aj permanentky'); continue; }
      if(uzDostali.has(email)) { preco('pozvánku už dostala'); continue; }
      prijemcovia.push({ user_id:u._id, email, cena:p.price, uroven:p.label,
        meno:(String(u.name||'').trim().split(/\s+/)[0] || 'tanečníčka') });
    }
    return { prijemcovia, vynechani };
  }

  function halloweenHtml(p){
    const cena = String(p.cena).replace('.',',');
    return emailTemplate('Halloweenska Zumba Party — tento piatok 🎃',
      '<p>Ahoj ' + p.meno + ',</p>'
      + '<p>v piatok <b>30. októbra</b> u nás tancujeme v maskách. O 18:00 začíname technickým tréningom, '
      + 'o 19:00 nastupuje Zumba a tancuje sa dve hodiny v kuse.</p>'
      + '<p>Celý večer máš <b>welcome drink</b>, občerstvenie a otvorený bar.</p>'
      + '<p><b>Vstup je povolený len v maske.</b> Bez nej ťa dnu nepustíme, tak si ju priprav.</p>'
      // Nečlenke nemá zmysel písať „15 € (Bez členstva)" — to znie ako prirážka za to,
      // že niekam nepatrí. Dostane rovnakú cenu a navyše vidí, čo by jej členstvo ušetrilo.
      + (p.uroven === 'Bez členstva'
          ? '<p>Vstupné je <b style="color:#C9A84C">' + cena + ' €</b>. S mesačným členstvom by si platila menej — '
            + 'Bronze 10 €, Silver a Gold 5 €.</p>'
          : '<p>Tvoje vstupné ako ' + p.uroven + ': <b style="color:#C9A84C">' + cena + ' €</b>.</p>')
      + '<p>Fusion Academy — Záhradná 7, Detva.</p>',
      '🎟️ KÚPIŤ LÍSTOK', HALLOWEEN_URL);
  }

  // Náhľad: nič neodosiela, vráti počty, dôvody vynechania a ukážku mailu.
  app.get('/api/admin/event/halloween/nahlad', adminAuth, async(req,res)=>{
    try{
      const { prijemcovia, vynechani } = await halloweenAudience();
      const rozpocet = await mailBudgetStav(4);
      const podlaUrovne = {};
      for(const p of prijemcovia){
        const k = p.uroven + ' · ' + String(p.cena).replace('.',',') + ' €';
        podlaUrovne[k] = (podlaUrovne[k]||0) + 1;
      }
      res.json({ ok:true,
        pocet: prijemcovia.length,
        podla_urovne: podlaUrovne,
        vynechani,
        // Denný strop 300 padol 1. 9. 2026 — Brevo má 10 000/mesiac a naše stropy sú
        // od vtedy len poistka proti runaway. Náhľad preto ukazuje skutočný stav,
        // nie číslo z hlavy; inak by sa kampaň delila na dávky zbytočne.
        rozpocet,
        prejde_naraz: rozpocet.zostava_dnes >= prijemcovia.length
                   && rozpocet.zostava_tento_mesiac >= prijemcovia.length,
        go_flag: process.env.HALLOWEEN_GO === '1',
        predmet: HALLOWEEN_SUBJ,
        odkaz: HALLOWEEN_URL,
        ukazka_html: prijemcovia.length ? halloweenHtml(prijemcovia[0]) : null,
        prvi: prijemcovia.slice(0,10).map(p=>({ meno:p.meno, uroven:p.uroven, cena:p.cena })) });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  // Odoslanie: aj s admin právami to vyžaduje HALLOWEEN_GO=1 v Railway env.
  app.post('/api/admin/event/halloween/odoslat', adminAuth, async(req,res)=>{
    try{
      if(process.env.HALLOWEEN_GO !== '1')
        return res.status(409).json({error:'Vlna je zamknutá. Nastav HALLOWEEN_GO=1 v Railway env a skús znova — deploy sám o sebe nie je schválenie.'});
      if(req.body && req.body.potvrdit !== true){
        const { prijemcovia } = await halloweenAudience();
        return res.json({ ok:true, dry_run:true, pocet:prijemcovia.length });
      }
      const { prijemcovia } = await halloweenAudience();
      if(!prijemcovia.length) return res.json({ ok:true, poslane:0, poznamka:'Nikto nespĺňa podmienky.' });
      let poslane=0, zlyhalo=0, stoplo=null;
      for(const p of prijemcovia){
        if(!(await mailBudgetOk(4))) { stoplo='denný strop mailov'; break; }
        const ok = await sendMail(p.email, HALLOWEEN_SUBJ, halloweenHtml(p),
          {priority:4, template:'event_halloween_2026'}).catch(()=>false);
        ok ? poslane++ : zlyhalo++;
      }
      res.json({ ok:true, poslane, zlyhalo, stoplo, zo:prijemcovia.length });
    }catch(e){ res.status(500).json({error:e.message}); }
  });

  return { ensureEvent, fulfillEventOrder, LATIN, halloweenAudience, halloweenHtml, HALLOWEEN_SUBJ };
};
