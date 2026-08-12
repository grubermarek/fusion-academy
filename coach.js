/**
 * Fusion Academy – Coach Growth System („Úlohy pre trénerov")
 * Denný pracovný dashboard trénera: povinné + rotujúce úlohy, smart lead list,
 * kontakty s výsledkom, poznámky, follow-up, body, streak, kalendár, leaderboard.
 * Jedna dátová vrstva: leady = db.users (user_type 'lead'/'client'), follow-upy = db.crm_tasks.
 */
'use strict';
const path = require('path');

module.exports = function initCoach(ctx){
  const { app, db, q, Datastore, DATA_DIR, trainerAuth, adminAuth, APP_URL, isTestContact } = ctx;

  // ── kolekcie ────────────────────────────────────────────────────────────────
  db.coach_tasks    = new Datastore({ filename: path.join(DATA_DIR,'coach_tasks.db'),    autoload:true });
  db.coach_contacts = new Datastore({ filename: path.join(DATA_DIR,'coach_contacts.db'), autoload:true });
  db.lead_notes     = new Datastore({ filename: path.join(DATA_DIR,'lead_notes.db'),     autoload:true });
  db.coach_tasks.ensureIndex({ fieldName:'date' });
  db.coach_contacts.ensureIndex({ fieldName:'date' });

  const todayStr = () => { const d=new Date(); return d.toISOString().slice(0,10); };
  const nowISO = () => new Date().toISOString();
  const dayOfWeek = ds => new Date(ds+'T12:00:00').getDay(); // 0=Ne
  const isTest = u => isTestContact(u && u.email);

  // ── konfigurácia (admin editovateľná, settings key coach_config) ────────────
  const DEFAULT_CONFIG = {
    min_contacts: 3,
    points: {
      mandatory_all: 20,      // completion bonus za všetky povinné
      contact3: 10,           // splnenie min. kontaktov
      extra_contact: 2,       // každý ďalší kontakt
      followup_ontime: 3,     // follow-up spravený v deň, na ktorý bol naplánovaný
      content: 8, community: 5, motivation: 6, education: 4,
      referral_share: 3,
    },
    // rotácia podľa dňa v týždni (0=Ne … 6=So)
    rotation: {
      1:[{key:'video_motiv',label:'Natoč krátke motivačné video',icon:'🎥',cat:'content'},{key:'plan_week',label:'Pozri si týždenný plán a leady',icon:'🗓️',cat:'education'}],
      2:[{key:'video_dance',label:'Natoč 15–30 s tanečné video',icon:'💃',cat:'content'},{key:'comm3',label:'Napíš 3 existujúcim klientkam',icon:'💬',cat:'community'}],
      3:[{key:'winback',label:'Ozvi sa klientke, ktorá dlhšie nebola',icon:'🤗',cat:'community'},{key:'story_class',label:'Zverejni story z hodiny',icon:'📸',cat:'content'}],
      4:[{key:'edu_content',label:'Vytvor edukatívny obsah (benefit tanca / námietka „neviem tancovať")',icon:'🎓',cat:'content'},{key:'tip_read',label:'Prečítaj si marketingový tip',icon:'📖',cat:'education'}],
      5:[{key:'ask_referral',label:'Požiadaj spokojnú klientku o odporúčanie',icon:'⭐',cat:'community'},{key:'video_vibe',label:'Natoč video z atmosféry hodiny',icon:'🎬',cat:'content'}],
      6:[{key:'react_comments',label:'Reaguj na komentáre a správy',icon:'💬',cat:'community'}],
      0:[{key:'week_review',label:'Zhodnoť týždeň a naplánuj ďalší',icon:'📝',cat:'education'}],
    },
    weekly: { contacts: 21, content: 3, community: 3, referral_shares: 1 },
    templates: {
      after_first: 'Ahoj {meno}, ako sa ti včera páčilo? ❤️ Budeme radi, ak prídeš znova. Ak chceš, pošlem ti najbližšie termíny.',
      no_show: 'Ahoj {meno}, dnes sme ťa čakali 😊 Ak ti termín nevyšiel, nič sa nedeje. Môžem ti poslať ďalší?',
      winback: 'Ahoj {meno}, už sme ťa chvíľu nevideli na hodine ❤️ Ako sa máš? Ak máš chuť, pošlem ti termíny na tento týždeň.',
      new_lead: 'Ahoj {meno} ❤️ Ak máš chuť skúsiť Zumbu, prvú hodinu máš zdarma. Vyber si miesto a termín tu: {link}',
      expired: 'Ahoj {meno}, členstvo ti skončilo — ak chceš pokračovať, rada ti ho obnovím alebo poradím s výberom 😊',
      followup: 'Ahoj {meno}, ozývam sa, ako sme sa dohodli 😊',
    },
    motivation: [
      'Prázdna hodina sa nenaplní sama. Každá správa, story a follow-up zvyšujú šancu, že na ďalšej hodine bude o jedného človeka viac.',
      'Tvojou prácou nie je iba viesť hodinu. Tvojou prácou je vytvoriť dôvod, aby na ňu ľudia vôbec prišli.',
      'Marketing sa nedá dohnať za jeden deň. Konzistentnosť poráža nárazovú aktivitu.',
      'Nie všetky časti práce sú zábavné. Aj tanečný biznis je biznis.',
      'Ak chceš mať z tanca stabilnú prácu, pracuj denne aj na komunikácii a získavaní klientov.',
    ],
  };
  async function getConfig(){
    const row = await q.one(db.settings,{key:'coach_config'});
    if(!row || !row.value) return DEFAULT_CONFIG;
    const c = row.value;
    return { ...DEFAULT_CONFIG, ...c, points:{...DEFAULT_CONFIG.points, ...(c.points||{})},
      weekly:{...DEFAULT_CONFIG.weekly, ...(c.weekly||{})}, templates:{...DEFAULT_CONFIG.templates, ...(c.templates||{})} };
  }

  const OUTCOMES = ['contacted','replied','interested','not_interested','will_come','later','no_reply'];
  const OUTCOME_TO_LEAD_STATUS = { interested:'interested', not_interested:'not_interested', will_come:'interested' };

  // ── generovanie denných úloh (lazy + idempotentné) ──────────────────────────
  async function ensureDay(trainer, date){
    const cfg = await getConfig();
    const existing = await q.find(db.coach_tasks,{trainer_id:trainer._id, date});
    if(existing.length) return existing;
    const dow = dayOfWeek(date);
    const defs = [
      {key:'contact3', label:`Kontaktuj minimálne ${cfg.min_contacts} ľudí (leady / bývalé klientky)`, icon:'📞', cat:'mandatory', points:cfg.points.contact3, auto:'contacts'},
      {key:'followup', label:'Sprav follow-up leadov na dnes', icon:'🔁', cat:'mandatory', points:cfg.points.followup_ontime, auto:'followups'},
      {key:'referral_share', label:'Pošli aspoň 1 pozvánku so svojím linkom', icon:'🔗', cat:'mandatory', points:cfg.points.referral_share, auto:'copy'},
      ...(cfg.rotation[dow]||[]).map(t=>({...t, points:cfg.points[t.cat]||5})),
    ];
    const out=[];
    for(const d of defs){
      out.push(await q.insert(db.coach_tasks,{trainer_id:trainer._id, trainer_name:trainer.name, date,
        key:d.key, label:d.label, icon:d.icon||'✅', cat:d.cat, points:d.points||5,
        mandatory: d.cat==='mandatory', auto:d.auto||null, done:false, done_at:null, proof:null,
        source:'auto', created_at:nowISO()}));
    }
    // admin jednorazové úlohy na tento deň
    const adminTasks = await q.find(db.coach_tasks,{date, source:'admin', trainer_id:'__template__'});
    for(const t of adminTasks){
      if(t.only_trainer && t.only_trainer!==trainer._id) continue;
      out.push(await q.insert(db.coach_tasks,{trainer_id:trainer._id, trainer_name:trainer.name, date,
        key:'custom_'+t._id, label:t.label, icon:t.icon||'📌', cat:'custom', points:t.points||5,
        mandatory: !!t.mandatory, auto:null, done:false, done_at:null, proof:null, source:'admin', created_at:nowISO()}));
    }
    return out;
  }

  // auto-stavy povinných úloh podľa reálnych dát (anti-gaming: nedajú sa odkliknúť ručne)
  async function refreshAutoTasks(trainer, date, tasks){
    const contacts = await q.find(db.coach_contacts,{trainer_id:trainer._id, date});
    const cfg = await getConfig();
    const due = await q.find(db.crm_tasks,{assigned_to:trainer._id, status:'open', due_date:date});
    for(const t of tasks){
      let done = t.done;
      if(t.auto==='contacts') done = contacts.length >= cfg.min_contacts;
      if(t.auto==='followups') done = due.length===0; // žiadny nevybavený follow-up na dnes
      if(done !== t.done){
        await q.update(db.coach_tasks,{_id:t._id},{$set:{done, done_at: done?nowISO():null}});
        t.done = done; t.done_at = done?nowISO():null;
      }
    }
    return { tasks, contacts_today: contacts.length, due_followups: due };
  }

  // ── body / streak ───────────────────────────────────────────────────────────
  async function pointsForDay(trainerId, date, cfg){
    const tasks = await q.find(db.coach_tasks,{trainer_id:trainerId, date});
    const contacts = await q.find(db.coach_contacts,{trainer_id:trainerId, date});
    let pts = 0;
    for(const t of tasks) if(t.done) pts += t.points||0;
    pts += Math.max(0, contacts.length - cfg.min_contacts) * cfg.points.extra_contact;
    pts += contacts.filter(c=>c.followup_hit).length * cfg.points.followup_ontime;
    const mand = tasks.filter(t=>t.mandatory);
    const allMand = mand.length>0 && mand.every(t=>t.done);
    if(allMand) pts += cfg.points.mandatory_all;
    return { pts, allMand, tasks, contacts };
  }
  async function streakOf(trainerId, cfg){
    let streak=0;
    for(let i=0;i<120;i++){
      const d=new Date(Date.now()-i*86400000).toISOString().slice(0,10);
      const tasks = await q.find(db.coach_tasks,{trainer_id:trainerId, date:d, mandatory:true});
      if(!tasks.length){ if(i===0) continue; break; }
      if(tasks.every(t=>t.done)) streak++;
      else { if(i===0) continue; break; } // dnešok ešte môže dobehnúť
    }
    return streak;
  }

  // ── smart lead list ─────────────────────────────────────────────────────────
  async function smartLeads(trainer, date, limit=10){
    const users = await q.find(db.users,{});
    const bookings = await q.find(db.bookings,{});
    const memberships = await q.find(db.memberships,{});
    const contacts = await q.find(db.coach_contacts,{}); // malý objem
    const myFollowups = await q.find(db.crm_tasks,{assigned_to:trainer._id, status:'open'});
    const now = Date.now();
    const lastContact = {}; // lead_id -> ts (ktorýkoľvek tréner)
    for(const c of contacts){ const t=new Date(c.created_at).getTime(); if(!lastContact[c.lead_id]||t>lastContact[c.lead_id]) lastContact[c.lead_id]=t; }
    const byUserBk = {};
    for(const b of bookings){ (byUserBk[b.user_id]=byUserBk[b.user_id]||[]).push(b); }
    const activeMem = new Set(memberships.filter(m=>m.status==='active' && (!m.expires_at || new Date(m.expires_at)>new Date())).map(m=>m.user_id));
    const expiredMem = {};
    for(const m of memberships){ if(m.status!=='active' && m.expires_at){ const t=new Date(m.expires_at).getTime(); if(!expiredMem[m.user_id]||t>expiredMem[m.user_id]) expiredMem[m.user_id]=t; } }
    const followupToday = new Set(myFollowups.filter(t=>t.due_date && t.due_date<=date).map(t=>t.client_id));

    const rows=[];
    for(const u of users){
      if(u.is_admin || ['trainer','manager','admin'].includes(u.user_type)) continue;
      if(u.hidden_lead || isTest(u) || u.lead_status==='do_not_contact' || u.sms_only===false&&false) continue;
      if(!u.phone && !u.email) continue;
      const lc = lastContact[u._id] || (u.last_contacted_at ? new Date(u.last_contacted_at).getTime() : 0);
      if(lc && (now-lc) < 3*86400000 && !followupToday.has(u._id)) continue; // kontaktovaný za posledné 3 dni
      const bks = (byUserBk[u._id]||[]).filter(b=>!['cancelled','waitlist'].includes(b.status));
      const attended = bks.filter(b=>b.status==='attended').sort((a,b)=>(a.booking_date<b.booking_date?1:-1));
      const lastVisit = attended[0] ? new Date(attended[0].booking_date+'T12:00:00').getTime() : 0;
      const daysSinceVisit = lastVisit ? Math.floor((now-lastVisit)/86400000) : null;
      const recentNoShow = bks.find(b=>b.status==='no_show' && (now-new Date(b.booking_date+'T12:00:00').getTime())<7*86400000);
      let score=0, reason='', action='', tpl='';
      if(followupToday.has(u._id)){ score=100; reason='Naplánovaný follow-up'; action='Ozvi sa dnes — máš to v pláne.'; tpl='followup'; }
      else if(attended.length && daysSinceVisit<=2 && !activeMem.has(u._id) && !(u.single_entries>0)){ score=90; reason='Bola na hodine pred '+daysSinceVisit+' d, nič nekúpila'; action='Napíš jej dnes — spýtaj sa, ako sa jej páčilo a pošli termíny.'; tpl='after_first'; }
      else if(recentNoShow){ score=80; reason='No-show '+recentNoShow.booking_date; action='Ponúkni jej nový termín.'; tpl='no_show'; }
      else if(u.user_type==='lead' && !bks.length){ const age=Math.floor((now-new Date(u.created_at).getTime())/86400000); if(age>180) { score=20; reason='Starý lead ('+age+' d)'; action='Win-back kontakt.'; tpl='winback'; } else { score=70; reason='Nový lead bez rezervácie'; action='Pozvi ju na prvú hodinu zadarmo.'; tpl='new_lead'; } }
      else if(expiredMem[u._id] && !activeMem.has(u._id) && (now-expiredMem[u._id])<60*86400000){ score=60; reason='Členstvo expirovalo'; action='Spýtaj sa, či chce pokračovať — ponúkni obnovenie.'; tpl='expired'; }
      else if(attended.length && daysSinceVisit>=21 && daysSinceVisit<=120 && !activeMem.has(u._id)){ score=50; reason='Nebola '+daysSinceVisit+' dní'; action='Win-back kontakt.'; tpl='winback'; }
      else continue;
      rows.push({ id:u._id, name:u.name, phone:u.phone||'', email:u.email&&!/@import\.local|@test/.test(u.email)?u.email:'',
        city:u.city||'', lead_source:u.lead_source||'', lead_status:u.lead_status||'', score, reason, action, tpl,
        visits: attended.length + (u.glofox_attendances||0), last_visit_days: daysSinceVisit,
        has_membership: activeMem.has(u._id), entries_left: u.single_entries||0,
        last_contact_days: lc?Math.floor((now-lc)/86400000):null, priority: score>=80?'hot':score>=50?'warm':'cold' });
    }
    rows.sort((a,b)=>b.score-a.score || (b.last_contact_days||999)-(a.last_contact_days||999));
    return rows.slice(0,limit);
  }

  function smartMotivation(cfg, state){
    if(state.streak>=7) return `🔥 ${state.streak} dní konzistentnej práce. Presne toto vytvára výsledky.`;
    if(state.remaining===1) return 'Zostáva ti posledná úloha. Dokonči deň a získaš completion bonus.';
    if(state.remaining>1 && state.doneCount>0) return `Dnes ti zostávajú ešte ${state.remaining} úlohy. Najdôležitejší je outreach.`;
    if(state.streak===0 && state.doneCount===0) return 'Začni dnes minimom: kontaktuj 3 leady a dokonči follow-up. ' + cfg.motivation[new Date().getDate()%cfg.motivation.length];
    return cfg.motivation[new Date().getDate()%cfg.motivation.length];
  }

  // ════════ TRÉNERSKÉ API ════════
  app.get('/api/coach/today', trainerAuth, async (req,res)=>{
    try{
      const me = req.effectiveTrainer || req.trainerUser;
      const cfg = await getConfig();
      const date = todayStr();
      let tasks = await ensureDay(me, date);
      const { contacts_today, due_followups } = await refreshAutoTasks(me, date, tasks);
      tasks = await q.find(db.coach_tasks,{trainer_id:me._id, date});
      const { pts, allMand } = await pointsForDay(me._id, date, cfg);
      const streak = await streakOf(me._id, cfg);
      const doneCount = tasks.filter(t=>t.done).length;
      const leads = await smartLeads(me, date);
      const code = me.referral_code||'';
      const link = APP_URL + '/invite/' + code;
      const custom = me.coach_invite_text || `Ahoj ❤️ Ak máš chuť skúsiť Zumbu, prvú hodinu máš zdarma. Vyber si miesto a termín tu:`;
      // link vždy pripájame server-side — attribution sa nedá omylom zmazať
      const message = custom.replace(/https?:\/\/\S+/g,'').trim() + ' ' + link;
      res.json({ ok:true, date, tasks:tasks.sort((a,b)=>(b.mandatory?1:0)-(a.mandatory?1:0)),
        contacts_today, min_contacts: cfg.min_contacts,
        due_followups: due_followups.map(f=>({id:f._id, client_id:f.client_id, name:f.client_name, title:f.title, due:f.due_date})),
        points_today: pts, day_complete: allMand,
        progress: tasks.length ? Math.round(doneCount/tasks.length*100) : 0,
        streak, leads, outcomes: OUTCOMES, templates: cfg.templates,
        referral: { code, link, message, custom_text: me.coach_invite_text||'' },
        motivation: smartMotivation(cfg, {streak, remaining: tasks.length-doneCount, doneCount}) });
    }catch(e){ console.error('coach/today',e); res.status(500).json({error:'Chyba'}); }
  });

  // kontakt leadu s výsledkom (anti-gaming: 1 lead = 1 kontakt/deň)
  app.post('/api/coach/contact', trainerAuth, async (req,res)=>{
    try{
      const me = req.effectiveTrainer || req.trainerUser;
      const { lead_id, outcome, note, followup_date } = req.body||{};
      if(!lead_id || !OUTCOMES.includes(outcome)) return res.status(400).json({error:'Neplatný výsledok'});
      const lead = await q.one(db.users,{_id:lead_id});
      if(!lead) return res.status(404).json({error:'Lead nenájdený'});
      const date = todayStr();
      const dup = await q.one(db.coach_contacts,{trainer_id:me._id, lead_id, date});
      // follow-up hit? (mal naplánovanú crm úlohu na dnes/skôr)
      const openFu = await q.find(db.crm_tasks,{assigned_to:me._id, status:'open', client_id:lead_id});
      const dueFu = openFu.filter(t=>t.due_date && t.due_date<=date);
      let doc;
      if(dup){
        await q.update(db.coach_contacts,{_id:dup._id},{$set:{outcome, note:note||dup.note}});
        doc = {...dup, outcome, duplicate:true};
      } else {
        doc = await q.insert(db.coach_contacts,{trainer_id:me._id, trainer_name:me.name, lead_id,
          lead_name:lead.name, outcome, note:note||'', date, followup_hit: dueFu.length>0, created_at:nowISO()});
      }
      // sync do CRM: last_contacted_at + prípadný status
      const set = { last_contacted_at: nowISO() };
      if(OUTCOME_TO_LEAD_STATUS[outcome] && lead.user_type==='lead') set.lead_status = OUTCOME_TO_LEAD_STATUS[outcome];
      await q.update(db.users,{_id:lead_id},{$set:set});
      // poznámka do jednotnej vrstvy
      if(note && !dup) await q.insert(db.lead_notes,{client_id:lead_id, client_name:lead.name, author_id:me._id,
        author_name:me.name, text:note, source:'coach_contact', created_at:nowISO()});
      // splnené follow-upy odškrtni
      for(const f of dueFu) await q.update(db.crm_tasks,{_id:f._id},{$set:{status:'done', done_at:nowISO()}});
      // nový follow-up na dátum
      if(followup_date && /^\d{4}-\d{2}-\d{2}$/.test(followup_date)){
        await q.insert(db.crm_tasks,{title:'Ozvať sa: '+lead.name, note:note||'', client_id:lead_id, client_name:lead.name,
          assigned_to:me._id, due_date:followup_date, status:'open', created_by:me._id, created_at:nowISO()});
      }
      res.json({ok:true, duplicate: !!dup});
    }catch(e){ console.error('coach/contact',e); res.status(500).json({error:'Chyba'}); }
  });

  // odkliknutie neautomatickej úlohy
  app.post('/api/coach/task-done', trainerAuth, async (req,res)=>{
    try{
      const me = req.effectiveTrainer || req.trainerUser;
      const { id, proof, undo } = req.body||{};
      const t = await q.one(db.coach_tasks,{_id:id, trainer_id:me._id});
      if(!t) return res.status(404).json({error:'Úloha nenájdená'});
      if(t.auto) return res.status(400).json({error:'Táto úloha sa plní automaticky podľa reálnej aktivity'});
      await q.update(db.coach_tasks,{_id:t._id},{$set:{done:!undo, done_at:undo?null:nowISO(), proof:proof||t.proof||null}});
      res.json({ok:true});
    }catch(e){ res.status(500).json({error:'Chyba'}); }
  });

  // kopírovanie pozvánky = splnenie referral úlohy
  app.post('/api/coach/copied', trainerAuth, async (req,res)=>{
    const me = req.effectiveTrainer || req.trainerUser;
    await q.update(db.coach_tasks,{trainer_id:me._id, date:todayStr(), key:'referral_share'},{$set:{done:true, done_at:nowISO()}});
    res.json({ok:true});
  });

  // vlastný text pozvánky (link sa pripája vždy server-side)
  app.post('/api/coach/invite-text', trainerAuth, async (req,res)=>{
    const me = req.effectiveTrainer || req.trainerUser;
    const text = String((req.body||{}).text||'').slice(0,500);
    await q.update(db.users,{_id:me._id},{$set:{coach_invite_text:text}});
    res.json({ok:true});
  });

  // poznámka k leadu (jednotná vrstva — vidí aj admin)
  app.post('/api/coach/lead/:id/note', trainerAuth, async (req,res)=>{
    const me = req.effectiveTrainer || req.trainerUser;
    const text = String((req.body||{}).text||'').trim().slice(0,1000);
    if(!text) return res.status(400).json({error:'Prázdna poznámka'});
    const lead = await q.one(db.users,{_id:req.params.id});
    if(!lead) return res.status(404).json({error:'Nenájdený'});
    const n = await q.insert(db.lead_notes,{client_id:lead._id, client_name:lead.name, author_id:me._id,
      author_name:me.name, text, source:'manual', created_at:nowISO()});
    res.json({ok:true, note:n});
  });

  // detail leadu pre trénera (história, produkty, poznámky, kontakty)
  app.get('/api/coach/lead/:id', trainerAuth, async (req,res)=>{
    try{
      const u = await q.one(db.users,{_id:req.params.id});
      if(!u) return res.status(404).json({error:'Nenájdený'});
      const bks = (await q.find(db.bookings,{user_id:u._id})).filter(b=>!['waitlist'].includes(b.status))
        .sort((a,b)=>a.booking_date<b.booking_date?1:-1).slice(0,30);
      const mems = (await q.find(db.memberships,{user_id:u._id})).sort((a,b)=>(a.started_at<b.started_at?1:-1));
      const active = mems.find(m=>m.status==='active' && (!m.expires_at || new Date(m.expires_at)>new Date()));
      const notes = (await q.find(db.lead_notes,{client_id:u._id})).sort((a,b)=>a.created_at<b.created_at?1:-1);
      const contacts = (await q.find(db.coach_contacts,{lead_id:u._id})).sort((a,b)=>a.created_at<b.created_at?1:-1).slice(0,20);
      const attended = bks.filter(b=>b.status==='attended');
      const mailQ = (await q.find(db.email_queue,{user_id:u._id})).filter(m=>m.status==='sent').sort((a,b)=>a.sent_at<b.sent_at?1:-1).slice(0,15);
      res.json({ ok:true, lead:{ id:u._id, name:u.name, phone:u.phone||'', email:u.email||'', city:u.city||'',
        lead_source:u.lead_source||'', lead_status:u.lead_status||'', created_at:u.created_at,
        sponsor_id:u.sponsor_id||null, free_class_used:!!u.free_class_used, visits:attended.length+(u.glofox_attendances||0),
        no_shows:u.no_show_count||0, entries_left:u.single_entries||0,
        membership: active?{plan:active.plan_name||active.plan_id, expires:active.expires_at}:null,
        had_membership: mems.length>0, last_contacted_at:u.last_contacted_at||null },
        bookings: bks.map(b=>({date:b.booking_date, name:b.class_name, loc:b.class_location, status:b.status})),
        notes, contacts: contacts.map(c=>({date:c.date, trainer:c.trainer_name, outcome:c.outcome, note:c.note})),
        emails: mailQ.map(m=>({sent_at:m.sent_at, sequence:m.sequence})) });
    }catch(e){ console.error('coach/lead',e); res.status(500).json({error:'Chyba'}); }
  });

  // kalendár disciplíny (heatmapa)
  app.get('/api/coach/calendar', trainerAuth, async (req,res)=>{
    try{
      const me = req.effectiveTrainer || req.trainerUser;
      const month = /^\d{4}-\d{2}$/.test(req.query.month||'') ? req.query.month : todayStr().slice(0,7);
      const all = await q.find(db.coach_tasks,{trainer_id:me._id});
      const cfg = await getConfig();
      const days={};
      for(const t of all){ if(!t.date.startsWith(month)) continue; (days[t.date]=days[t.date]||[]).push(t); }
      const out={};
      for(const [d,ts] of Object.entries(days)){
        const mand = ts.filter(t=>t.mandatory);
        const doneM = mand.filter(t=>t.done).length;
        out[d] = { color: mand.length&&doneM===mand.length?'green':doneM>0?'orange':'red',
          done: ts.filter(t=>t.done).length, total: ts.length,
          points: (await pointsForDay(me._id, d, cfg)).pts };
      }
      res.json({ok:true, month, days:out});
    }catch(e){ res.status(500).json({error:'Chyba'}); }
  });

  // leaderboard (aktivita + výsledky, nielen tržby)
  app.get('/api/coach/board', trainerAuth, async (req,res)=>{
    try{
      const range = ['week','month','all'].includes(req.query.range) ? req.query.range : 'week';
      const cfg = await getConfig();
      const since = range==='all' ? '2000-01-01'
        : range==='month' ? todayStr().slice(0,8)+'01'
        : new Date(Date.now()-6*86400000).toISOString().slice(0,10);
      const tasks = (await q.find(db.coach_tasks,{})).filter(t=>t.date>=since && t.trainer_id!=='__template__');
      const contacts = (await q.find(db.coach_contacts,{})).filter(c=>c.date>=since);
      const per={};
      const P = id => per[id]=per[id]||{points:0,done:0,total:0,contacts:0,name:''};
      for(const t of tasks){ const p=P(t.trainer_id); p.name=t.trainer_name||p.name; p.total++; if(t.done){p.done++; p.points+=t.points||0;} }
      // completion bonusy po dňoch
      const byDay={};
      for(const t of tasks){ if(!t.mandatory) continue; const k=t.trainer_id+'|'+t.date; (byDay[k]=byDay[k]||[]).push(t); }
      for(const [k,ts] of Object.entries(byDay)){ if(ts.every(t=>t.done)) P(k.split('|')[0]).points += cfg.points.mandatory_all; }
      for(const c of contacts){ const p=P(c.trainer_id); p.name=c.trainer_name||p.name; p.contacts++; if(c.followup_hit) p.points+=cfg.points.followup_ontime; }
      const rows = Object.entries(per).map(([id,p])=>({trainer_id:id, name:p.name, points:p.points,
        completion: p.total?Math.round(p.done/p.total*100):0, contacts:p.contacts}))
        .sort((a,b)=>b.points-a.points);
      res.json({ok:true, range, rows});
    }catch(e){ res.status(500).json({error:'Chyba'}); }
  });

  // týždenný prehľad + weekly score
  app.get('/api/coach/week', trainerAuth, async (req,res)=>{
    try{
      const me = req.effectiveTrainer || req.trainerUser;
      const cfg = await getConfig();
      const since = new Date(Date.now()-6*86400000).toISOString().slice(0,10);
      const tasks = (await q.find(db.coach_tasks,{trainer_id:me._id})).filter(t=>t.date>=since);
      const contacts = (await q.find(db.coach_contacts,{trainer_id:me._id})).filter(c=>c.date>=since);
      const doneCat = cat => tasks.filter(t=>t.cat===cat && t.done).length;
      const refShares = tasks.filter(t=>t.key==='referral_share' && t.done).length;
      const goals = [
        { key:'contacts', label:'Kontaktovaní ľudia', actual:contacts.length, goal:cfg.weekly.contacts },
        { key:'content', label:'Obsah (videá / story)', actual:doneCat('content'), goal:cfg.weekly.content },
        { key:'community', label:'Community aktivity', actual:doneCat('community'), goal:cfg.weekly.community },
        { key:'referral', label:'Poslané pozvánky (dni)', actual:refShares, goal:cfg.weekly.referral_shares },
      ];
      const score = Math.round(goals.reduce((s,g)=>s+Math.min(1, g.goal? g.actual/g.goal : 1),0)/goals.length*100);
      const replied = contacts.filter(c=>['replied','interested','will_come'].includes(c.outcome)).length;
      res.json({ok:true, since, goals, score,
        quality:{ contacted:contacts.length, replied, interested:contacts.filter(c=>c.outcome==='interested'||c.outcome==='will_come').length }});
    }catch(e){ res.status(500).json({error:'Chyba'}); }
  });

  // ════════ ADMIN API ════════
  app.get('/api/admin/coach/overview', adminAuth, async (req,res)=>{
    try{
      const cfg = await getConfig();
      const trainers = (await q.find(db.users,{})).filter(u=>(u.user_type==='trainer'||u.user_type==='manager') && u.active!==false && !isTest(u));
      const date = todayStr();
      const weekStart = new Date(Date.now()-6*86400000).toISOString().slice(0,10);
      const rows=[];
      for(const t of trainers){
        const todayTasks = await q.find(db.coach_tasks,{trainer_id:t._id, date});
        const weekTasks = (await q.find(db.coach_tasks,{trainer_id:t._id})).filter(x=>x.date>=weekStart);
        const weekContacts = (await q.find(db.coach_contacts,{trainer_id:t._id})).filter(x=>x.date>=weekStart);
        const overdue = (await q.find(db.crm_tasks,{assigned_to:t._id, status:'open'})).filter(x=>x.due_date && x.due_date<date);
        rows.push({ id:t._id, name:t.name,
          today_done: todayTasks.filter(x=>x.done).length, today_total: todayTasks.length,
          week_completion: weekTasks.length?Math.round(weekTasks.filter(x=>x.done).length/weekTasks.length*100):null,
          week_contacts: weekContacts.length, week_points: (await (async()=>{let s=0;for(let i=0;i<7;i++){const d=new Date(Date.now()-i*86400000).toISOString().slice(0,10); s+=(await pointsForDay(t._id,d,cfg)).pts;} return s;})()),
          streak: await streakOf(t._id, cfg), overdue_followups: overdue.length });
      }
      res.json({ok:true, rows, config:cfg});
    }catch(e){ console.error('coach/overview',e); res.status(500).json({error:'Chyba'}); }
  });

  app.put('/api/admin/coach/config', adminAuth, async (req,res)=>{
    const cur = await getConfig();
    const b = req.body||{};
    const next = { ...cur, ...(b.min_contacts?{min_contacts:+b.min_contacts}:{}) ,
      points:{...cur.points, ...(b.points||{})}, weekly:{...cur.weekly, ...(b.weekly||{})},
      templates:{...cur.templates, ...(b.templates||{})},
      rotation: b.rotation||cur.rotation, motivation: b.motivation||cur.motivation };
    await q.update(db.settings,{key:'coach_config'},{$set:{key:'coach_config', value:next}},{upsert:true});
    res.json({ok:true, config:next});
  });

  // admin jednorazová úloha (šablóna, materializuje sa pri otvorení dňa trénerom)
  app.post('/api/admin/coach/task', adminAuth, async (req,res)=>{
    const { label, points, date, mandatory, only_trainer, icon } = req.body||{};
    if(!label) return res.status(400).json({error:'Chýba názov'});
    const d = /^\d{4}-\d{2}-\d{2}$/.test(date||'') ? date : todayStr();
    const t = await q.insert(db.coach_tasks,{trainer_id:'__template__', date:d, label:String(label).slice(0,200),
      icon:icon||'📌', points:+points||5, mandatory:!!mandatory, only_trainer:only_trainer||null, source:'admin', created_at:nowISO()});
    // dogeneruj trénerom, ktorí už dnes deň otvorený majú
    const opened = await q.find(db.coach_tasks,{date:d, key:'contact3'});
    for(const o of opened){
      if(only_trainer && o.trainer_id!==only_trainer) continue;
      await q.insert(db.coach_tasks,{trainer_id:o.trainer_id, trainer_name:o.trainer_name, date:d,
        key:'custom_'+t._id, label:t.label, icon:t.icon, cat:'custom', points:t.points, mandatory:t.mandatory,
        auto:null, done:false, done_at:null, proof:null, source:'admin', created_at:nowISO()});
    }
    res.json({ok:true, task:t});
  });

  // poznámky leadov pre admin CRM (jednotná vrstva)
  app.get('/api/admin/lead-notes/:id', adminAuth, async (req,res)=>{
    const notes = (await q.find(db.lead_notes,{client_id:req.params.id})).sort((a,b)=>a.created_at<b.created_at?1:-1);
    res.json({ok:true, notes});
  });

  console.log('🎯  Coach Growth System načítaný');
};
