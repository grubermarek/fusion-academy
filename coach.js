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
  db.coach_cases    = new Datastore({ filename: path.join(DATA_DIR,'coach_cases.db'),    autoload:true });
  db.coach_batches  = new Datastore({ filename: path.join(DATA_DIR,'coach_batches.db'),  autoload:true });
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
      contact_each: 2,        // kazdy dnesny kontakt
      case_closed: 5,         // uzavrety case
      case_converted: 10,     // uzavrety s uznanou konverziou
    },
    // rotácia podľa dňa v týždni (0=Ne … 6=So)
    rotation: {
      1:[{key:'video_motiv',label:'Natoč krátke motivačné video',icon:'🎥',cat:'content'},{key:'plan_week',label:'Pozri si týždenný plán a leady',icon:'🗓️',cat:'education'}],
      2:[{key:'video_dance',label:'Natoč 15–30 s tanečné video',icon:'💃',cat:'content'},{key:'bts_story',label:'Zverejni zákulisnú story (príprava, playlist, outfit)',icon:'🎬',cat:'content'}],
      3:[{key:'story_class',label:'Zverejni story z hodiny',icon:'📸',cat:'content'},{key:'react_dm',label:'Odpovedz na komentáre a správy na sociálnych sieťach',icon:'💬',cat:'community'}],
      4:[{key:'edu_content',label:'Vytvor edukatívny obsah (benefit tanca / námietka „neviem tancovať")',icon:'🎓',cat:'content'},{key:'tip_read',label:'Prečítaj si marketingový tip',icon:'📖',cat:'education'}],
      5:[{key:'ask_referral',label:'Požiadaj spokojnú klientku o odporúčanie',icon:'⭐',cat:'community'},{key:'video_vibe',label:'Natoč video z atmosféry hodiny',icon:'🎬',cat:'content'}],
      6:[{key:'react_comments',label:'Reaguj na komentáre a správy',icon:'💬',cat:'community'}],
      0:[{key:'week_review',label:'Zhodnoť týždeň a naplánuj ďalší',icon:'📝',cat:'education'}],
    },
    weekly: { contacts: 21, content: 3, community: 3, referral_shares: 1, cases: 10 },
    own_auto_points: 5,          // vlastné aktivity do tejto hodnoty sa schvaľujú automaticky
    rank_weights: { consistency: 40, activity: 30, results: 20, learning: 10 },
    rank_target_points: 400,     // 30-dňový bodový cieľ pre plné aktivity skóre
    alert_overdue_followups: 5,  // admin alert od tohto počtu zameškaných follow-upov
    templates: {
      after_first: 'Ahojky {meno} ❤️ ako sa ti u nás páčilo? Teším sa, že si prišla. Ak by si chcela prísť znova, kľudne mi napíš a pošlem ti termíny 😊 - {trener}',
      no_show: 'Ahojky {meno} 😊 dnes sme ťa čakali na hodine — nič sa nedeje, každému niekedy nevyjde. Ak chceš, pošlem ti ďalší termín, nech ti to vyjde ❤️ - {trener}',
      winback: 'Ahojky {meno} ❤️ už sme sa dlhšie nevideli na hodine a chýbaš nám. Ako sa máš? Ak máš chuť prísť, napíš mi a pošlem ti termíny 😊 - {trener}',
      new_lead: 'Ahojky {meno} ❤️ vidím, že si registrovaná na Zumbu, ale ešte si nebola na hodine. Chcem sa opýtať, či ti viem s niečím pomôcť 😊 Kľudne mi napíš - {trener} :) Tu si vieš rezervovať prvú hodinu (je zdarma): {link}',
      expired: 'Ahojky {meno} 😊 všimla som si, že ti skončilo členstvo. Ak chceš pokračovať, kľudne mi napíš, poradím ti s výberom ❤️ - {trener}',
      followup: 'Ahojky {meno} 😊 ozývam sa, ako sme sa dohodli. Ako sa máš? - {trener}',
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
      weekly:{...DEFAULT_CONFIG.weekly, ...(c.weekly||{})}, templates:{...DEFAULT_CONFIG.templates, ...(c.templates||{})},
      rank_weights:{...DEFAULT_CONFIG.rank_weights, ...(c.rank_weights||{})} };
  }

  // Coach koná vždy sám za seba (asistentský redirect len pre čistých asistentov)
  const coachUser = req => req.trainerUser; // coach je vždy osobný — aj asistent (ambasádor) koná sám za seba
  const isAmbassador = u => u.is_assistant && !u.is_admin && u.user_type!=='trainer' && u.user_type!=='manager';

  const OUTCOMES = ['contacted','replied','interested','not_interested','will_come','later','no_reply'];
  const OUTCOME_TO_LEAD_STATUS = { interested:'interested', not_interested:'not_interested', will_come:'interested' };

  // ── generovanie denných úloh (lazy + idempotentné) ──────────────────────────
  async function ensureDay(trainer, date){
    const cfg = await getConfig();
    await q.remove(db.coach_tasks,{trainer_id:trainer._id, date, key:{$in:['followup','referral_share','winback','comm3']}, done:false},{multi:true});
    const existing = await q.find(db.coach_tasks,{trainer_id:trainer._id, date});
    if(existing.length) return existing;
    const dow = dayOfWeek(date);
    const defs = [
      {key:'contact3', label:`Kontaktuj minimálne ${cfg.min_contacts} ľudí — follow-upy, pozvánky s linkom aj klientky, čo dlhšie neboli, všetko sa počíta`, icon:'📞', cat:'mandatory', points:cfg.points.contact3, auto:'contacts'},
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
    for(const t of tasks) if(t.done && !(t.cat==='own' && t.approved===false)) pts += t.points||0;
    pts += contacts.length * (cfg.points.contact_each||0);
    const casesToday = await q.find(db.coach_cases,{trainer_id:trainerId, date});
    for(const c of casesToday) pts += c.converted ? (cfg.points.case_converted||0) : (cfg.points.case_closed||0);
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
    const sentMails = (await q.find(db.email_queue,{status:'sent'}));
    const lastMail = {};
    for(const m of sentMails){ if(!lastMail[m.user_id] || (m.sent_at||'')>(lastMail[m.user_id].sent_at||'')) lastMail[m.user_id]=m; }
    const allNotes = await q.find(db.lead_notes,{});
    const lastNote = {};
    for(const n of allNotes){ if(!lastNote[n.client_id] || (n.created_at||'')>(lastNote[n.client_id].created_at||'')) lastNote[n.client_id]=n; }
    const now = Date.now();
    const lastContact = {}; // lead_id -> ts (ktorýkoľvek tréner)
    for(const c of contacts){ const t=new Date(c.created_at).getTime(); if(!lastContact[c.lead_id]||t>lastContact[c.lead_id]) lastContact[c.lead_id]=t; }
    const byUserBk = {};
    for(const b of bookings){ (byUserBk[b.user_id]=byUserBk[b.user_id]||[]).push(b); }
    const activeMem = new Set(memberships.filter(m=>m.status==='active' && (!m.expires_at || new Date(m.expires_at)>new Date())).map(m=>m.user_id));
    const expiredMem = {};
    for(const m of memberships){ if(m.status!=='active' && m.expires_at){ const t=new Date(m.expires_at).getTime(); if(!expiredMem[m.user_id]||t>expiredMem[m.user_id]) expiredMem[m.user_id]=t; } }
    const followupToday = new Set(myFollowups.filter(t=>t.due_date && t.due_date<=date).map(t=>t.client_id));
    // nedávno uzavreté case-y (kohokoľvek) → 14 dní pokoj, nech sa lead hneď nevracia do zoznamu
    const recentCases = (await q.find(db.coach_cases,{})).filter(c=>(Date.now()-new Date(c.created_at).getTime()) < 14*86400000);
    const caseCooldown = new Set(recentCases.map(c=>c.lead_id));

    const rows=[];
    for(const u of users){
      if(u.is_admin || ['trainer','manager','admin'].includes(u.user_type)) continue;
      const claimedMine = u.coach_claimed_by === trainer._id;
      if(u.coach_claimed_by && !claimedMine) continue; // prevzatý iným trénerom
      if(u.hidden_lead || (isTest(u) && !isTest(trainer)) || u.lead_status==='do_not_contact' || u.sms_only===false&&false) continue;
      if(!u.phone && !u.email) continue;
      const lc = lastContact[u._id] || (u.last_contacted_at ? new Date(u.last_contacted_at).getTime() : 0);
      if(!claimedMine && lc && (now-lc) < 3*86400000 && !followupToday.has(u._id)) continue; // kontaktovaný za posledné 3 dni
      if(!claimedMine && caseCooldown.has(u._id) && !followupToday.has(u._id)) continue; // case nedávno uzavretý → do histórie, nie späť do zoznamu
      if(!claimedMine && u.coach_snooze_until && u.coach_snooze_until > date && !followupToday.has(u._id)) continue; // odložená (dovolenka/chorá/neodpovedá)
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
      else if(claimedMine){ score=40;
        if(u.user_type==='client' && daysSinceVisit>=30){ reason='Klientka — nebola '+daysSinceVisit+' dní'; action='Pozná hodiny — osobný winback tón, žiadny predajný text.'; tpl='winback'; }
        else { reason='Rozpracovaný lead'; action='Pokračuj v komunikácii a doveď ju na hodinu.'; tpl='followup'; }
      }
      else continue;
      rows.push({ id:u._id, name:u.name, phone:u.phone||'', email:u.email&&!/@import\.local|@test/.test(u.email)?u.email:'',
        city:u.city||'', lead_source:u.lead_source||'', lead_status:u.lead_status||'', score, reason, action, tpl,
        visits: attended.length + (u.glofox_attendances||0), last_visit_days: daysSinceVisit,
        no_shows: u.no_show_count||bks.filter(b=>b.status==='no_show').length||0, created: (u.created_at||'').slice(0,10),
        last_email: lastMail[u._id] ? {date:(lastMail[u._id].sent_at||'').slice(0,10), seq:lastMail[u._id].sequence} : null,
        last_note: lastNote[u._id] ? {date:(lastNote[u._id].created_at||'').slice(0,10), author:lastNote[u._id].author_name, text:String(lastNote[u._id].text||'').slice(0,120)} : null,
        has_membership: activeMem.has(u._id), entries_left: u.single_entries||0,
        last_contact_days: lc?Math.floor((now-lc)/86400000):null, priority: score>=80?'hot':score>=50?'warm':'cold',
        is_client: u.user_type==='client',
        claimed: claimedMine, claimed_at: claimedMine?(u.coach_claimed_at||'').slice(0,10):null });
    }
    rows.sort((a,b)=>b.score-a.score || (b.last_contact_days||999)-(a.last_contact_days||999));
    return { list: rows.filter(r=>!r.claimed).slice(0,limit), mine: rows.filter(r=>r.claimed) };
  }

  function smartMotivation(cfg, state){
    if(state.streak>=7) return `🔥 ${state.streak} dní konzistentnej práce. Presne toto vytvára výsledky.`;
    if(state.remaining===1) return 'Zostáva ti posledná úloha. Dokonči deň a získaš completion bonus.';
    if(state.remaining>1 && state.doneCount>0) return `Dnes ti zostávajú ešte ${state.remaining} úlohy. Najdôležitejší je outreach.`;
    if(state.streak===0 && state.doneCount===0) return 'Začni dnes minimom: kontaktuj 3 leady a dokonči follow-up. ' + cfg.motivation[new Date().getDate()%cfg.motivation.length];
    return cfg.motivation[new Date().getDate()%cfg.motivation.length];
  }

  // ── ambasádorske dávky leadov (ochrana pred exportom celého poolu) ──────────
  const BATCH_SIZE = 10;
  async function allocateBatch(user, source){
    const users = await q.find(db.users,{});
    const contacts = await q.find(db.coach_contacts,{});
    const lastContact = {};
    for(const c of contacts){ const t=new Date(c.created_at).getTime(); if(!lastContact[c.lead_id]||t>lastContact[c.lead_id]) lastContact[c.lead_id]=t; }
    const now = Date.now();
    const needsContact = u => { const lc = lastContact[u._id] || (u.last_contacted_at ? new Date(u.last_contacted_at).getTime() : 0);
      return !lc || (now-lc) > 3*86400000; };
    const recentCaseIds = new Set((await q.find(db.coach_cases,{})).filter(c=>(now-new Date(c.created_at).getTime()) < 14*86400000).map(c=>c.lead_id));
    const base = u => !u.coach_claimed_by && !recentCaseIds.has(u._id) && !(u.coach_snooze_until && u.coach_snooze_until > todayStr()) && !u.hidden_lead && !u.guest && (!isTest(u) || isTest(user))
      && u.lead_status!=='do_not_contact' && u.lead_status!=='not_interested' && (u.phone || u.email) && needsContact(u);
    const freshLeads = users.filter(u=>u.user_type==='lead' && base(u))
      .sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    // klientky, čo neboli 30+ dní — poznajú hodiny, iný (winback) tón komunikácie
    const bkAll = await q.find(db.bookings,{});
    const lastVisit = {};
    for(const b of bkAll){ if(b.status!=='attended') continue; const t=new Date(b.booking_date+'T12:00:00').getTime();
      if(!lastVisit[b.user_id]||t>lastVisit[b.user_id]) lastVisit[b.user_id]=t; }
    const winback = users.filter(u=>u.user_type==='client' && !u.is_admin && base(u)
        && lastVisit[u._id] && (now-lastVisit[u._id]) > 30*86400000 && (now-lastVisit[u._id]) < 365*86400000)
      .sort((a,b)=>(lastVisit[a._id]||0)-(lastVisit[b._id]||0)===0?0:(lastVisit[b._id]-lastVisit[a._id])); // najskôr čerstvo stratené
    const fresh = [...freshLeads.slice(0,6), ...winback];
    while(fresh.length < Math.min(BATCH_SIZE, freshLeads.length+winback.length)){
      const nxt = freshLeads.find(u=>!fresh.includes(u)); if(!nxt) break; fresh.push(nxt);
    }
    fresh.splice(BATCH_SIZE);
    if(!fresh.length) return { count:0 };
    for(const u of fresh) await q.update(db.users,{_id:u._id},{$set:{coach_claimed_by:user._id, coach_claimed_at:nowISO()}});
    const prev = await q.count(db.coach_batches,{user_id:user._id, status:'granted'});
    await q.insert(db.coach_batches,{user_id:user._id, user_name:user.name, no:prev+1, size:fresh.length,
      lead_ids:fresh.map(u=>u._id), status:'granted', source, created_at:nowISO()});
    return { count:fresh.length, no:prev+1 };
  }
  async function batchState(user){
    const batches = (await q.find(db.coach_batches,{user_id:user._id, status:'granted'})).sort((a,b)=>b.no-a.no);
    const open = (await q.find(db.users,{coach_claimed_by:user._id})).length;
    const closed = (await q.count(db.coach_cases,{trainer_id:user._id}));
    const pending = await q.one(db.coach_batches,{user_id:user._id, status:'requested'});
    return { batch_no: batches[0]?batches[0].no:0, open, closed, requested: !!pending };
  }

  // ambasádor si vyžiada ďalšiu dávku (admin schvaľuje)
  app.post('/api/coach/request-batch', trainerAuth, async (req,res)=>{
    const me = coachUser(req);
    const dup = await q.one(db.coach_batches,{user_id:me._id, status:'requested'});
    if(dup) return res.json({ok:true, already:true});
    await q.insert(db.coach_batches,{user_id:me._id, user_name:me.name, status:'requested', created_at:nowISO()});
    const admins = (await q.find(db.users,{is_admin:true})).filter(a=>!isTest(a));
    for(const a of admins) await q.insert(db.notifications,{user_id:a._id, type:'coach_batch',
      title:'Žiadosť o ďalšie leady 📥', body:`${me.name} si žiada ďalších ${BATCH_SIZE} leadov. Schváliš v admin → Úlohy trénerov.`,
      read:false, created_at:nowISO()}).catch(()=>{});
    res.json({ok:true});
  });
  app.get('/api/admin/coach/batch-requests', adminAuth, async (req,res)=>{
    const rows = (await q.find(db.coach_batches,{status:'requested'})).sort((a,b)=>a.created_at<b.created_at?1:-1);
    res.json({ok:true, rows});
  });
  app.post('/api/admin/coach/batch-requests/:id', adminAuth, async (req,res)=>{
    const r = await q.one(db.coach_batches,{_id:req.params.id, status:'requested'});
    if(!r) return res.status(404).json({error:'Žiadosť nenájdená'});
    const approve = (req.body||{}).approve !== false;
    if(!approve){ await q.update(db.coach_batches,{_id:r._id},{$set:{status:'denied'}});
      await q.insert(db.notifications,{user_id:r.user_id, type:'coach_batch', title:'Žiadosť o leady zamietnutá', body:'Ozvi sa adminovi.', read:false, created_at:nowISO()}).catch(()=>{});
      return res.json({ok:true}); }
    const user = await q.one(db.users,{_id:r.user_id});
    const got = await allocateBatch(user, 'admin_approved');
    await q.update(db.coach_batches,{_id:r._id},{$set:{status:'approved', approved_at:nowISO()}});
    await q.insert(db.notifications,{user_id:r.user_id, type:'coach_batch',
      title:'Nové leady pridelené 🎉', body:`Máš ďalších ${got.count} leadov v Moje leady. Poď na to!`, read:false, created_at:nowISO()}).catch(()=>{});
    res.json({ok:true, granted:got.count});
  });

  // ════════ TRÉNERSKÉ API ════════
  app.get('/api/coach/today', trainerAuth, async (req,res)=>{
    try{
      const me = coachUser(req);
      const cfg = await getConfig();
      const date = todayStr();
      let tasks = await ensureDay(me, date);
      const { contacts_today, due_followups } = await refreshAutoTasks(me, date, tasks);
      tasks = await q.find(db.coach_tasks,{trainer_id:me._id, date});
      const { pts, allMand } = await pointsForDay(me._id, date, cfg);
      const streak = await streakOf(me._id, cfg);
      const doneCount = tasks.filter(t=>t.done).length;
      let { list: leads, mine: my_leads } = await smartLeads(me, date);
      let batch = null;
      if(isAmbassador(me)){
        let st = await batchState(me);
        // prvá dávka automaticky; ďalšia automaticky po uzavretí celej dávky
        if(st.batch_no===0 || (st.open===0 && !st.requested)){
          const got = await allocateBatch(me, st.batch_no===0?'initial':'auto_completed');
          if(got.count){ ({ list:leads, mine:my_leads } = await smartLeads(me, date)); st = await batchState(me); }
        }
        leads = []; // ambasádor vidí len svoju pridelenú dávku (ochrana lead poolu)
        batch = st;
      }
      const code = me.referral_code||'';
      const link = APP_URL + '/invite/' + code;
      const fn = (me.name||'').split(' ')[0];
      const custom = me.coach_invite_text || `Ahojky ❤️ ak máš chuť skúsiť Zumbu, prvá hodina je úplne zdarma. Keby si mala akékoľvek otázky, kľudne mi napíš, veľmi rada ti pomôžem 😊 - ${fn} :) Termín si vieš vybrať tu:`;
      // link vždy pripájame server-side — attribution sa nedá omylom zmazať
      const message = custom.replace(/https?:\/\/\S+/g,'').trim() + ' ' + link;
      res.json({ ok:true, date, tasks:tasks.sort((a,b)=>(b.mandatory?1:0)-(a.mandatory?1:0)),
        contacts_today, min_contacts: cfg.min_contacts,
        cases_today: await q.count(db.coach_cases,{trainer_id:me._id, date}),
        pts_cfg: { contact_each: cfg.points.contact_each||0, case_closed: cfg.points.case_closed||0, case_converted: cfg.points.case_converted||0 },
        due_followups: due_followups.map(f=>({id:f._id, client_id:f.client_id, name:f.client_name, title:f.title, due:f.due_date})),
        points_today: pts, day_complete: allMand,
        progress: tasks.length ? Math.round(doneCount/tasks.length*100) : 0,
        streak, leads, my_leads, batch, ambassador: isAmbassador(me), outcomes: OUTCOMES,
        templates: Object.fromEntries(Object.entries(cfg.templates).map(([k,v])=>[k, String(v).replace(/{trener}/g, fn)])),
        referral: { code, link, message, custom_text: custom },
        motivation: smartMotivation(cfg, {streak, remaining: tasks.length-doneCount, doneCount}) });
    }catch(e){ console.error('coach/today',e); res.status(500).json({error:'Chyba'}); }
  });

  // kontakt leadu s výsledkom (anti-gaming: 1 lead = 1 kontakt/deň)
  app.post('/api/coach/contact', trainerAuth, async (req,res)=>{
    try{
      const me = coachUser(req);
      const { lead_id, outcome, note, followup_date } = req.body||{};
      const isAuto = (req.body||{}).auto === true; // klik na Zavolat/SMS/WhatsApp
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
        if(!isAuto) await q.update(db.coach_contacts,{_id:dup._id},{$set:{outcome, note:note||dup.note}}); // auto klik neprepisuje rucny vysledok
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
      const me = coachUser(req);
      const { id, proof, undo } = req.body||{};
      const t = await q.one(db.coach_tasks,{_id:id, trainer_id:me._id});
      if(!t) return res.status(404).json({error:'Úloha nenájdená'});
      if(t.auto) return res.status(400).json({error:'Táto úloha sa plní automaticky podľa reálnej aktivity'});
      await q.update(db.coach_tasks,{_id:t._id},{$set:{done:!undo, done_at:undo?null:nowISO(), proof:proof||t.proof||null}});
      res.json({ok:true});
    }catch(e){ res.status(500).json({error:'Chyba'}); }
  });

  // kopírovanie pozvánky = splnenie referral úlohy
  app.post('/api/coach/copied', trainerAuth, async (req,res)=>{ res.json({ok:true}); });

  // vlastný text pozvánky (link sa pripája vždy server-side)
  app.post('/api/coach/invite-text', trainerAuth, async (req,res)=>{
    const me = coachUser(req);
    const text = String((req.body||{}).text||'').slice(0,500);
    await q.update(db.users,{_id:me._id},{$set:{coach_invite_text:text}});
    res.json({ok:true});
  });

  // poznámka k leadu (jednotná vrstva — vidí aj admin)
  app.post('/api/coach/lead/:id/note', trainerAuth, async (req,res)=>{
    const me = coachUser(req);
    const text = String((req.body||{}).text||'').trim().slice(0,1000);
    if(!text) return res.status(400).json({error:'Prázdna poznámka'});
    const lead = await q.one(db.users,{_id:req.params.id});
    if(!lead) return res.status(404).json({error:'Nenájdený'});
    const n = await q.insert(db.lead_notes,{client_id:lead._id, client_name:lead.name, author_id:me._id,
      author_name:me.name, text, source:'manual', created_at:nowISO()});
    res.json({ok:true, note:n});
  });

  // prevzatie leadu — ostáva v „Moje leady", kým tréner case neuzavrie
  app.post('/api/coach/lead/:id/claim', trainerAuth, async (req,res)=>{
    const me = coachUser(req);
    const lead = await q.one(db.users,{_id:req.params.id});
    if(!lead) return res.status(404).json({error:'Nenájdený'});
    if(lead.coach_claimed_by && lead.coach_claimed_by!==me._id){
      const other = await q.one(db.users,{_id:lead.coach_claimed_by});
      return res.status(409).json({error:'Lead už prevzal '+(other?other.name:'iný tréner')});
    }
    await q.update(db.users,{_id:lead._id},{$set:{coach_claimed_by:me._id, coach_claimed_at:nowISO()}});
    res.json({ok:true});
  });
  const RELEASE_STATUSES = ['trial','interested','not_interested','contacted','new'];
  app.post('/api/coach/lead/:id/release', trainerAuth, async (req,res)=>{
    const me = coachUser(req);
    const lead = await q.one(db.users,{_id:req.params.id});
    if(!lead) return res.status(404).json({error:'Nenájdený'});
    if(lead.coach_claimed_by !== me._id && !me.is_admin) return res.status(403).json({error:'Lead nemáš prevzatý'});
    const claimedAt = lead.coach_claimed_at || null;
    const durationH = claimedAt ? Math.round((Date.now()-new Date(claimedAt).getTime())/3600000*10)/10 : null;
    const myContacts = await q.find(db.coach_contacts,{trainer_id:me._id, lead_id:lead._id});
    const myNotes = await q.find(db.lead_notes,{client_id:lead._id, author_id:me._id});
    const st = (req.body||{}).lead_status;
    const wantConvert = (req.body||{}).convert === true;

    // konverzia na svojho klienta (sponzorstvo + affiliate) — len pri reálnom výsledku
    let converted = false, prevSponsor = lead.sponsor_id || null, convertError = null;
    if(wantConvert){
      const claimedTs = claimedAt ? new Date(claimedAt).getTime() : 0;
      const bks = await q.find(db.bookings,{user_id:lead._id});
      const attendedAfter = bks.some(b=>b.status==='attended' && claimedTs && new Date(b.booking_date+'T23:59:00').getTime()>=claimedTs);
      const pays = await q.find(db.payments,{user_id:lead._id});
      const paidAfter = pays.some(p=>claimedTs && new Date(p.created_at||0).getTime()>=claimedTs && p.status!=='pending_manual');
      if(!myContacts.length) convertError = 'Bez jediného zapísaného kontaktu sa konverzia nedá uznať.';
      else if(!claimedTs || durationH < 1) convertError = 'Case bol otvorený príliš krátko — konverzia sa neuznáva.';
      else if(!attendedAfter && !paidAfter) convertError = 'Konverzia sa uzná, až keď človek reálne príde na hodinu alebo zaplatí (po prevzatí case-u).';
      else {
        // sponzora nesmieš nikomu ukradnúť — len ak ho nemá, alebo je to admin/default
        const curSponsor = prevSponsor ? await q.one(db.users,{_id:prevSponsor}) : null;
        if(curSponsor && !curSponsor.is_admin && curSponsor._id!==me._id) convertError = 'Tento človek už má sponzora ('+curSponsor.name+') — konverzia nie je možná.';
        else { converted = true; }
      }
    }
    const set = { coach_claimed_by:null, coach_claimed_at:null };
    if(st && RELEASE_STATUSES.includes(st) && lead.user_type==='lead') set.lead_status = st;
    if(converted) set.sponsor_id = me._id;
    await q.update(db.users,{_id:lead._id},{$set:set});
    await q.insert(db.coach_cases,{trainer_id:me._id, trainer_name:me.name, lead_id:lead._id, lead_name:lead.name,
      resolution: st||'released', converted, prev_sponsor: converted?prevSponsor:undefined,
      claimed_at: claimedAt, duration_h: durationH, contacts_count: myContacts.length, notes_count: myNotes.length,
      date: todayStr(), created_at: nowISO()});
    // uzavretie case-u je práca s leadom → počíta sa ako dnešný kontakt (max 1/lead/deň)
    const todayContact = await q.one(db.coach_contacts,{trainer_id:me._id, lead_id:lead._id, date:todayStr()});
    if(!todayContact){
      const outcomeMap = { trial:'will_come', interested:'interested', not_interested:'not_interested' };
      await q.insert(db.coach_contacts,{trainer_id:me._id, trainer_name:me.name, lead_id:lead._id,
        lead_name:lead.name, outcome: outcomeMap[st]||'contacted', note:'(z uzavretia case-u)', date:todayStr(),
        followup_hit:false, created_at:nowISO()});
      await q.update(db.users,{_id:lead._id},{$set:{last_contacted_at:nowISO()}});
    }
    const note = (req.body||{}).note;
    if(note) await q.insert(db.lead_notes,{client_id:lead._id, client_name:lead.name, author_id:me._id,
      author_name:me.name, text:'Case uzavretý: '+String(note).slice(0,300), source:'coach_release', created_at:nowISO()});
    if(converted){
      const admins = (await q.find(db.users,{is_admin:true})).filter(a=>!isTest(a));
      for(const a of admins) await q.insert(db.notifications,{user_id:a._id, type:'coach_convert',
        title:'Konverzia leadu 🤝', body:`${me.name} konvertoval(a) ${lead.name} a stal(a) sa sponzorom (case ${durationH} h, ${myContacts.length} kontaktov). Skontroluj v admin → Úlohy trénerov.`,
        read:false, created_at:nowISO()}).catch(()=>{});
    }
    res.json({ok:true, converted, convert_error: convertError});
  });

  // história mojich uzavretých case-ov
  app.get('/api/coach/cases', trainerAuth, async (req,res)=>{
    const me = coachUser(req);
    const rows = (await q.find(db.coach_cases,{trainer_id:me._id})).sort((a,b)=>a.created_at<b.created_at?1:-1).slice(0,100);
    res.json({ok:true, rows});
  });
  // admin: všetky case-y s antifraud príznakom
  app.get('/api/admin/coach/cases', adminAuth, async (req,res)=>{
    const rows = (await q.find(db.coach_cases,{})).sort((a,b)=>a.created_at<b.created_at?1:-1).slice(0, +req.query.limit||60)
      .map(c=>({...c, suspicious: !!c.converted && ((c.duration_h!=null && c.duration_h<24) || !(c.contacts_count>0))}));
    res.json({ok:true, rows});
  });
  app.post('/api/admin/coach/cases/:id/revoke-conversion', adminAuth, async (req,res)=>{
    const c = await q.one(db.coach_cases,{_id:req.params.id});
    if(!c || !c.converted) return res.status(404).json({error:'Case nenájdený alebo bez konverzie'});
    await q.update(db.users,{_id:c.lead_id},{$set:{sponsor_id: c.prev_sponsor||null}});
    await q.update(db.coach_cases,{_id:c._id},{$set:{converted:false, conversion_revoked_at:nowISO()}});
    await q.insert(db.notifications,{user_id:c.trainer_id, type:'coach_convert', title:'Konverzia zrušená',
      body:`Admin zrušil tvoju konverziu leadu ${c.lead_name}.`, read:false, created_at:nowISO()}).catch(()=>{});
    res.json({ok:true});
  });
  // odloženie leadu (neodpovedá / chorá / dovolenka) — vráti sa do poolu po termíne
  app.post('/api/coach/lead/:id/snooze', trainerAuth, async (req,res)=>{
    const me = coachUser(req);
    const lead = await q.one(db.users,{_id:req.params.id});
    if(!lead) return res.status(404).json({error:'Nenájdený'});
    if(lead.coach_claimed_by && lead.coach_claimed_by!==me._id && !me.is_admin) return res.status(403).json({error:'Lead má prevzatý niekto iný'});
    const days = Math.max(1, Math.min(90, +(req.body||{}).days || 7));
    const until = new Date(Date.now()+days*86400000).toISOString().slice(0,10);
    const reason = String((req.body||{}).reason||'').slice(0,120);
    await q.update(db.users,{_id:lead._id},{$set:{coach_claimed_by:null, coach_claimed_at:null, coach_snooze_until:until}});
    await q.insert(db.lead_notes,{client_id:lead._id, client_name:lead.name, author_id:me._id, author_name:me.name,
      text:`Odložená do ${until}${reason?' — '+reason:''}`, source:'coach_snooze', created_at:nowISO()});
    res.json({ok:true, until});
  });

  // zmena statusu leadu priamo z Mojich leadov
  app.put('/api/coach/lead/:id/status', trainerAuth, async (req,res)=>{
    const st = (req.body||{}).lead_status;
    if(!RELEASE_STATUSES.includes(st)) return res.status(400).json({error:'Neplatný status'});
    const lead = await q.one(db.users,{_id:req.params.id});
    if(!lead) return res.status(404).json({error:'Nenájdený'});
    if(lead.user_type!=='lead') return res.status(400).json({error:'Nie je lead'});
    await q.update(db.users,{_id:lead._id},{$set:{lead_status:st}});
    res.json({ok:true});
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
        bookings: bks.map(b=>({date:b.booking_date, name:b.class_name, loc:b.class_location, status:b.status, access:b.access_method||(b.free_class?'free_class':null), attended_by:b.attended_by||null})),
        notes, contacts: contacts.map(c=>({date:c.date, trainer:c.trainer_name, outcome:c.outcome, note:c.note})),
        emails: mailQ.map(m=>({sent_at:m.sent_at, sequence:m.sequence})) });
    }catch(e){ console.error('coach/lead',e); res.status(500).json({error:'Chyba'}); }
  });

  // kalendár disciplíny (heatmapa)
  app.get('/api/coach/calendar', trainerAuth, async (req,res)=>{
    try{
      const me = coachUser(req);
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
      for(const c of contacts){ const p=P(c.trainer_id); p.name=c.trainer_name||p.name; p.contacts++; p.points+=(cfg.points.contact_each||0); if(c.followup_hit) p.points+=cfg.points.followup_ontime; }
      const casesB=(await q.find(db.coach_cases,{})).filter(c=>c.date>=since);
      for(const c of casesB){ const p=P(c.trainer_id); p.name=c.trainer_name||p.name; p.points+= c.converted?(cfg.points.case_converted||0):(cfg.points.case_closed||0); }
      const rows = Object.entries(per).map(([id,p])=>({trainer_id:id, name:p.name, points:p.points,
        completion: p.total?Math.round(p.done/p.total*100):0, contacts:p.contacts}))
        .sort((a,b)=>b.points-a.points);
      res.json({ok:true, range, rows});
    }catch(e){ res.status(500).json({error:'Chyba'}); }
  });

  // týždenný prehľad + weekly score
  app.get('/api/coach/week', trainerAuth, async (req,res)=>{
    try{
      const me = coachUser(req);
      const cfg = await getConfig();
      const since = new Date(Date.now()-6*86400000).toISOString().slice(0,10);
      const tasks = (await q.find(db.coach_tasks,{trainer_id:me._id})).filter(t=>t.date>=since);
      const contacts = (await q.find(db.coach_contacts,{trainer_id:me._id})).filter(c=>c.date>=since);
      const doneCat = cat => tasks.filter(t=>t.cat===cat && t.done).length;
      const goals = [
        { key:'contacts', label:'Kontaktovaní ľudia', actual:contacts.length, goal:cfg.weekly.contacts },
        { key:'content', label:'Obsah (videá / story)', actual:doneCat('content'), goal:cfg.weekly.content },
        { key:'community', label:'Community aktivity', actual:doneCat('community'), goal:cfg.weekly.community },
        { key:'cases', label:'Prevzaté a doriešené leady', actual:(await q.find(db.coach_cases,{trainer_id:me._id})).filter(c=>c.date>=since).length, goal:cfg.weekly.cases },
      ];
      const score = Math.round(goals.reduce((s,g)=>s+Math.min(1, g.goal? g.actual/g.goal : 1),0)/goals.length*100);
      const replied = contacts.filter(c=>['replied','interested','will_come'].includes(c.outcome)).length;
      res.json({ok:true, since, goals, score,
        quality:{ contacted:contacts.length, replied, interested:contacts.filter(c=>c.outcome==='interested'||c.outcome==='will_come').length }});
    }catch(e){ res.status(500).json({error:'Chyba'}); }
  });

  // ── ranky (STARTER → ELITE): konzistentnosť + aktivita + výsledky + učenie ──
  const RANK_NAMES = ['STARTER','ACTIVE','GROWTH','PRO','ELITE'];
  async function computeRank(trainerId, cfg){
    const since = new Date(Date.now()-29*86400000).toISOString().slice(0,10);
    const tasks = (await q.find(db.coach_tasks,{trainer_id:trainerId})).filter(t=>t.date>=since);
    const days = {};
    for(const t of tasks){ if(t.mandatory) (days[t.date]=days[t.date]||[]).push(t); }
    const dKeys = Object.keys(days);
    const consistency = dKeys.length ? dKeys.filter(d=>days[d].every(t=>t.done)).length / dKeys.length : 0;
    let pts=0; for(let i=0;i<30;i++){ const d=new Date(Date.now()-i*86400000).toISOString().slice(0,10); pts+=(await pointsForDay(trainerId,d,cfg)).pts; }
    const activity = Math.min(1, pts / (cfg.rank_target_points||400));
    const refBookings = (await q.find(db.referral_events,{sponsor_id:trainerId, type:'booked'})).filter(e=>!e.test && (e.created_at||'')>=since).length;
    const results = Math.min(1, refBookings / 2);
    const learning = Math.min(1, tasks.filter(t=>t.cat==='education' && t.done).length / 4);
    const w = cfg.rank_weights;
    const total = Math.round(consistency*w.consistency + activity*w.activity + results*w.results + learning*w.learning);
    const rank = RANK_NAMES[ total>=80?4 : total>=60?3 : total>=40?2 : total>=20?1 : 0 ];
    return { total, rank, breakdown:{ consistency:Math.round(consistency*100), activity:Math.round(activity*100), results:Math.round(results*100), learning:Math.round(learning*100) } };
  }

  // vlastná iniciatíva (+ PRIDAŤ VLASTNÚ AKTIVITU)
  app.post('/api/coach/activity', trainerAuth, async (req,res)=>{
    try{
      const me = coachUser(req);
      const cfg = await getConfig();
      const { label, desc, minutes, link, points } = req.body||{};
      if(!label || !String(label).trim()) return res.status(400).json({error:'Napíš, čo si spravil/a'});
      const wanted = Math.max(1, Math.min(50, +points||cfg.own_auto_points));
      const autoOk = wanted <= cfg.own_auto_points;
      const t = await q.insert(db.coach_tasks,{trainer_id:me._id, trainer_name:me.name, date:todayStr(),
        key:'own_'+Date.now(), label:String(label).slice(0,200), icon:'💡', cat:'own', points:wanted,
        mandatory:false, auto:null, done:true, done_at:nowISO(),
        proof:[desc,link].filter(Boolean).join(' · ').slice(0,500)||null, minutes:+minutes||null,
        approved: autoOk ? true : false, source:'own', created_at:nowISO()});
      if(!autoOk){
        const admins = (await q.find(db.users,{is_admin:true})).filter(a=>!isTest(a));
        for(const a of admins) await q.insert(db.notifications,{user_id:a._id, type:'coach_activity',
          title:'Vlastná aktivita na schválenie 💡', body:`${me.name}: ${String(label).slice(0,120)} (+${wanted} b.)`,
          read:false, created_at:nowISO()}).catch(()=>{});
      }
      res.json({ok:true, pending: !autoOk, activity:t});
    }catch(e){ res.status(500).json({error:'Chyba'}); }
  });
  app.get('/api/admin/coach/activities', adminAuth, async (req,res)=>{
    const rows = (await q.find(db.coach_tasks,{cat:'own', approved:false})).sort((a,b)=>a.created_at<b.created_at?1:-1);
    res.json({ok:true, rows});
  });
  app.post('/api/admin/coach/activities/:id', adminAuth, async (req,res)=>{
    const approve = (req.body||{}).approve !== false;
    const t = await q.one(db.coach_tasks,{_id:req.params.id, cat:'own'});
    if(!t) return res.status(404).json({error:'Nenájdená'});
    if(approve) await q.update(db.coach_tasks,{_id:t._id},{$set:{approved:true}});
    else await q.remove(db.coach_tasks,{_id:t._id});
    await q.insert(db.notifications,{user_id:t.trainer_id, type:'coach_activity',
      title: approve?'Aktivita schválená ✅':'Aktivita neschválená',
      body:`${t.label} ${approve?`(+${t.points} b.)`:''}`, read:false, created_at:nowISO()}).catch(()=>{});
    res.json({ok:true});
  });

  // môj rank
  app.get('/api/coach/rank', trainerAuth, async (req,res)=>{
    const me = coachUser(req);
    res.json({ok:true, ...(await computeRank(me._id, await getConfig()))});
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
          streak: await streakOf(t._id, cfg), overdue_followups: overdue.length,
          rank: (await computeRank(t._id, cfg)).rank });
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
      rank_weights:{...cur.rank_weights, ...(b.rank_weights||{})},
      ...(b.own_auto_points!=null?{own_auto_points:+b.own_auto_points}:{}),
      ...(b.rank_target_points!=null?{rank_target_points:+b.rank_target_points}:{}),
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

  // ── denné joby: admin alerty + pondelkový weekly report trénerom ────────────
  async function coachDailyJobs(){
    try{
      const date = todayStr();
      const guard = await q.one(db.settings,{key:'coach_jobs_last'});
      if(guard && guard.value === date) return;
      await q.update(db.settings,{key:'coach_jobs_last'},{$set:{key:'coach_jobs_last', value:date}},{upsert:true});
      const cfg = await getConfig();
      const trainers = (await q.find(db.users,{})).filter(u=>(u.user_type==='trainer'||u.user_type==='manager') && u.active!==false && !isTest(u));
      const admins = (await q.find(db.users,{is_admin:true})).filter(a=>!isTest(a));
      const alerts = [];
      const isMonday = new Date().getDay()===1;
      for(const t of trainers){
        // outreach 3 dni po sebe nesplnený (dni s vygenerovanými úlohami, ale bez kontaktov)
        let misses=0;
        for(let i=1;i<=3;i++){
          const d=new Date(Date.now()-i*86400000).toISOString().slice(0,10);
          const gen = await q.count(db.coach_tasks,{trainer_id:t._id, date:d, key:'contact3'});
          if(!gen) { misses=0; break; } // neotvoril appku → nealertuj (rieši completion nižšie)
          const c = await q.count(db.coach_contacts,{trainer_id:t._id, date:d});
          if(c===0) misses++; else { misses=0; break; }
        }
        if(misses===3) alerts.push(`${t.name}: 3 dni po sebe žiadny outreach`);
        const overdue = (await q.find(db.crm_tasks,{assigned_to:t._id, status:'open'})).filter(x=>x.due_date && x.due_date<date).length;
        if(overdue >= (cfg.alert_overdue_followups||5)) alerts.push(`${t.name}: ${overdue} zameškaných follow-upov`);
        // pondelok: weekly report trénerovi + completion alert adminovi
        if(isMonday){
          const since = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
          const tasks = (await q.find(db.coach_tasks,{trainer_id:t._id})).filter(x=>x.date>=since && x.date<date);
          const contacts = (await q.find(db.coach_contacts,{trainer_id:t._id})).filter(x=>x.date>=since && x.date<date);
          if(tasks.length){
            const completion = Math.round(tasks.filter(x=>x.done).length/tasks.length*100);
            let pts=0; for(let i=1;i<=7;i++){ const d=new Date(Date.now()-i*86400000).toISOString().slice(0,10); pts+=(await pointsForDay(t._id,d,cfg)).pts; }
            const replied = contacts.filter(c=>['replied','interested','will_come'].includes(c.outcome)).length;
            const tip = contacts.length < cfg.weekly.contacts/2 ? 'Budúci týždeň prioritizuj outreach — kontakty sú základ plných hodín.'
              : replied/Math.max(1,contacts.length) < 0.3 ? 'Skús osobnejšie správy — odpovedá ti málo ľudí. Použi šablóny a doplň niečo osobné.'
              : 'Drž konzistentnosť — presne takto sa plnia hodiny. 💪';
            await q.insert(db.notifications,{user_id:t._id, type:'coach_week',
              title:'Tvoj týždeň 📊', body:`Completion ${completion} % · ${pts} b. · kontaktovaných ${contacts.length}, odpovedalo ${replied}. ${tip}`,
              read:false, created_at:nowISO()}).catch(()=>{});
            if(completion < 60) alerts.push(`${t.name}: completion za týždeň len ${completion} %`);
          }
        }
      }
      if(alerts.length){
        for(const a of admins) await q.insert(db.notifications,{user_id:a._id, type:'coach_alert',
          title:'Coach Growth — na pozretie ⚠️', body:alerts.slice(0,6).join(' · '), read:false, created_at:nowISO()}).catch(()=>{});
      }
    }catch(e){ console.error('coachDailyJobs', e.message); }
  }
  setInterval(()=>{ if(new Date().getHours()===9) coachDailyJobs(); }, 3600000);
  app.post('/api/admin/coach/run-jobs', adminAuth, async (req,res)=>{
    await q.remove(db.settings,{key:'coach_jobs_last'});
    await coachDailyJobs(); res.json({ok:true});
  });

  console.log('🎯  Coach Growth System načítaný');
};
