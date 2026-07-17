'use strict';
// Load .env file if present (local dev)
const fs0 = require('fs'), path0 = require('path');
const envPath = path0.join(__dirname, '.env');
if(fs0.existsSync(envPath)){
  fs0.readFileSync(envPath,'utf8').split('\n').forEach(line=>{
    const [k,...v]=line.trim().split('=');
    if(k && !k.startsWith('#') && !process.env[k]) process.env[k]=v.join('=');
  });
}
const express   = require('express');
const http      = require('http');
const https     = require('https');
const { Server } = require('socket.io');
const session   = require('express-session');
const bcrypt    = require('bcryptjs');
const Datastore = require('@seald-io/nedb');
const path      = require('path');
const fs        = require('fs');
const { generatePlan: generateMealPlan } = require('./mealplan');

// ─── PayPal Config ────────────────────────────────────────────────────────────
const PAYPAL_CLIENT_ID     = process.env.PAYPAL_CLIENT_ID     || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const PAYPAL_ENV           = process.env.PAYPAL_ENV           || 'sandbox';
const PAYPAL_BASE          = PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Middleware ───────────────────────────────────────────────────────────────
// Capture raw body so webhook signatures (Stripe) can be verified against exact bytes
app.use(express.json({ limit:'10mb', verify:(req,res,buf)=>{ req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit:'10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Trust Railway / reverse-proxy HTTPS headers
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Persistent session store backed by NeDB on the Railway volume.
// Without this, express-session defaults to in-memory storage, so every
// container restart/redeploy logs everyone out. This keeps clients signed in.
const sessionsDb = new Datastore({ filename: path.join(DATA_DIR, 'sessions.db'), autoload: true });
sessionsDb.ensureIndex({ fieldName: 'sid', unique: true }, ()=>{});
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
class NedbSessionStore extends session.Store {
  _expiry(sess){ const e = sess?.cookie?.expires; return e ? new Date(e).getTime() : Date.now() + SESSION_TTL; }
  get(sid, cb){
    sessionsDb.findOne({ sid }, (err, doc)=>{
      if(err) return cb(err);
      if(!doc) return cb();
      if(doc.expire && Date.now() > doc.expire){ return sessionsDb.remove({ sid }, {}, ()=>cb()); }
      try { cb(null, JSON.parse(doc.data)); } catch(e){ cb(e); }
    });
  }
  set(sid, sess, cb){
    const doc = { sid, data: JSON.stringify(sess), expire: this._expiry(sess) };
    sessionsDb.update({ sid }, doc, { upsert: true }, err=>cb && cb(err));
  }
  destroy(sid, cb){ sessionsDb.remove({ sid }, {}, err=>cb && cb(err)); }
  touch(sid, sess, cb){ sessionsDb.update({ sid }, { $set: { expire: this._expiry(sess) } }, {}, err=>cb && cb(err)); }
}
// Sweep expired sessions hourly
setInterval(()=>sessionsDb.remove({ expire: { $lt: Date.now() } }, { multi: true }, ()=>{}), 60*60*1000).unref?.();

const sessionMiddleware = session({
  store: new NedbSessionStore(),
  secret: process.env.SESSION_SECRET || 'fusion-dev-secret-change-in-production-2026',
  resave: false,
  saveUninitialized: false,
  rolling: true,   // refresh the 30-day window on every request → active clients stay logged in
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL  // 30 days, renewed on activity
  }
});
app.use(sessionMiddleware);
// Share session with Socket.io
io.engine.use(sessionMiddleware);

// ─── Databases ────────────────────────────────────────────────────────────────
const db = {
  users:        new Datastore({ filename: path.join(DATA_DIR, 'users.db'),        autoload: true }),
  products:     new Datastore({ filename: path.join(DATA_DIR, 'products.db'),     autoload: true }),
  transactions: new Datastore({ filename: path.join(DATA_DIR, 'transactions.db'), autoload: true }),
  commissions:  new Datastore({ filename: path.join(DATA_DIR, 'commissions.db'),  autoload: true }),
  orders:       new Datastore({ filename: path.join(DATA_DIR, 'orders.db'),       autoload: true }),
  classes:      new Datastore({ filename: path.join(DATA_DIR, 'classes.db'),      autoload: true }),
  bookings:     new Datastore({ filename: path.join(DATA_DIR, 'bookings.db'),     autoload: true }),
  messages:     new Datastore({ filename: path.join(DATA_DIR, 'messages.db'),     autoload: true }),
  memberships:  new Datastore({ filename: path.join(DATA_DIR, 'memberships.db'),  autoload: true }),
  rentals:      new Datastore({ filename: path.join(DATA_DIR, 'rentals.db'),      autoload: true }),
  notifications:new Datastore({ filename: path.join(DATA_DIR, 'notifications.db'),autoload: true }),
  payments:     new Datastore({ filename: path.join(DATA_DIR, 'payments.db'),     autoload: true }),
  email_steps:  new Datastore({ filename: path.join(DATA_DIR, 'email_steps.db'), autoload: true }),
  email_queue:  new Datastore({ filename: path.join(DATA_DIR, 'email_queue.db'), autoload: true }),
  adspend:      new Datastore({ filename: path.join(DATA_DIR, 'adspend.db'),     autoload: true }),
  invoices:     new Datastore({ filename: path.join(DATA_DIR, 'invoices.db'),    autoload: true }),
  audit:        new Datastore({ filename: path.join(DATA_DIR, 'audit.db'),       autoload: true }),
  campaigns:    new Datastore({ filename: path.join(DATA_DIR, 'campaigns.db'),   autoload: true }),
  payout_rules: new Datastore({ filename: path.join(DATA_DIR, 'payout_rules.db'),autoload: true }),
  payouts:      new Datastore({ filename: path.join(DATA_DIR, 'payouts.db'),     autoload: true }),
  refunds:      new Datastore({ filename: path.join(DATA_DIR, 'refunds.db'),     autoload: true }),
  promo_codes:  new Datastore({ filename: path.join(DATA_DIR, 'promo_codes.db'), autoload: true }),
  crm_tasks:    new Datastore({ filename: path.join(DATA_DIR, 'crm_tasks.db'),    autoload: true }),
  outreach:     new Datastore({ filename: path.join(DATA_DIR, 'outreach.db'),     autoload: true }),
  promo_redemptions:new Datastore({ filename: path.join(DATA_DIR, 'promo_redemptions.db'),autoload: true }),
  feed:         new Datastore({ filename: path.join(DATA_DIR, 'feed.db'),        autoload: true }),
  friends:      new Datastore({ filename: path.join(DATA_DIR, 'friends.db'),      autoload: true }),
  profile_likes:new Datastore({ filename: path.join(DATA_DIR, 'profile_likes.db'),autoload: true }),
  profile_comments:new Datastore({ filename: path.join(DATA_DIR, 'profile_comments.db'),autoload: true }),
  tickets:      new Datastore({ filename: path.join(DATA_DIR, 'tickets.db'),      autoload: true }),
  ticket_msgs:  new Datastore({ filename: path.join(DATA_DIR, 'ticket_msgs.db'),  autoload: true }),
  meal_plans:   new Datastore({ filename: path.join(DATA_DIR, 'meal_plans.db'),   autoload: true }),
  class_cancellations: new Datastore({ filename: path.join(DATA_DIR, 'class_cancellations.db'), autoload: true }),
  settings:     new Datastore({ filename: path.join(DATA_DIR, 'settings.db'),     autoload: true }),
};
db.users.ensureIndex({ fieldName: 'email',         unique: true });
db.users.ensureIndex({ fieldName: 'referral_code', unique: true, sparse: true });
db.bookings.ensureIndex({ fieldName: 'created_at' });
db.messages.ensureIndex({ fieldName: 'created_at' });
db.invoices.ensureIndex({ fieldName: 'number', unique: true });

// ─── DB helpers ───────────────────────────────────────────────────────────────
const q = {
  find:   (d, query, sort)   => new Promise((r, j) => {
    const cursor = d.find(query);
    if (sort) cursor.sort(sort);
    cursor.exec((e, v) => e ? j(e) : r(v));
  }),
  one:    (d, query)         => new Promise((r, j) => d.findOne(query,    (e, v) => e ? j(e) : r(v))),
  insert: (d, doc)           => new Promise((r, j) => d.insert(doc,       (e, v) => e ? j(e) : r(v))),
  update: (d, query, u, o={}) => new Promise((r, j) => d.update(query, u, o, (e, n) => e ? j(e) : r(n))),
  remove: (d, query, o={})   => new Promise((r, j) => d.remove(query, o, (e, n) => e ? j(e) : r(n))),
  count:  (d, query)         => new Promise((r, j) => d.count(query,      (e, n) => e ? j(e) : r(n))),
};

// ─── MLM Constants ────────────────────────────────────────────────────────────
const RANKS = [
  { id:1, name:'Starter',         personalMin:0,    teamMin:0,      directRate:0.08, levels:1, badge:'🌱' },
  { id:2, name:'Partner',         personalMin:300,  teamMin:500,    directRate:0.10, levels:2, badge:'🤝' },
  { id:3, name:'Senior Partner',  personalMin:500,  teamMin:1500,   directRate:0.12, levels:3, badge:'⭐' },
  { id:4, name:'Leader',          personalMin:750,  teamMin:5000,   directRate:0.14, levels:4, badge:'🏅' },
  { id:5, name:'Team Leader',     personalMin:1000, teamMin:15000,  directRate:0.16, levels:5, badge:'🥇' },
  { id:6, name:'Regional Leader', personalMin:1000, teamMin:40000,  directRate:0.18, levels:6, badge:'💎' },
  { id:7, name:'Director',        personalMin:1500, teamMin:100000, directRate:0.20, levels:7, badge:'👑' },
  { id:8, name:'Elite Director',  personalMin:1500, teamMin:250000, directRate:0.22, levels:7, badge:'🏆' },
];
const LEVEL_RATES = [0.08, 0.05, 0.04, 0.03, 0.02, 0.015, 0.01];
// Referral commission — everyone earns from 5 lines (line 1 = direct referrals … line 5)
const LINE_RATES = [0.10, 0.05, 0.03, 0.02, 0.01];
const LOCATIONS   = ['Detva', 'Zvolen', 'Banská Bystrica', 'Brezno', 'Online'];

// ─── User Role Hierarchy ──────────────────────────────────────────────────────
// lead → client → (trainer | partner | manager) → admin
const USER_ROLES = {
  lead:    { label:'Lead',          icon:'🔵', access:'public',  dashUrl:'/client-dashboard' },
  client:  { label:'Klient',        icon:'🟢', access:'client',  dashUrl:'/client-dashboard' },
  trainer: { label:'Tréner',        icon:'🟡', access:'trainer', dashUrl:'/trainer'          },
  partner: { label:'Partner',       icon:'🟠', access:'partner', dashUrl:'/dashboard'        },
  manager: { label:'Manager',       icon:'🔴', access:'manager', dashUrl:'/dashboard'        },
  admin:   { label:'Admin',         icon:'⚫', access:'admin',   dashUrl:'/admin'            },
};

// ─── Loyalty Milestones ───────────────────────────────────────────────────────
const LOYALTY_MILESTONES = [
  { visits:5,    badge:'👟', label:'Prvé kroky', color:'#8bc34a', reward:null },
  { visits:25,   badge:'💃', label:'Tanečník',   color:'#ffc107', reward:'Zľava 10 % na ďalší nákup' },
  { visits:75,   badge:'⭐', label:'Stálica',     color:'#ff9800', reward:'Fusion fľaša zadarmo' },
  { visits:150,  badge:'🔥', label:'Vášeň',       color:'#e91e63', reward:'Zľava 15 % na mesačné členstvo' },
  { visits:350,  badge:'🏆', label:'Šampión',     color:'#9c27b0', reward:'Fusion tričko zadarmo' },
  { visits:600,  badge:'🦋', label:'Ikona',       color:'#2196f3', reward:'Mesiac zdarma' },
  { visits:1000, badge:'🌟', label:'Legenda',     color:'#C9A84C', reward:'VIP odmena – zistíš pri odovzdaní 😊' },
];

function getLoyaltyStatus(visitCount) {
  const count = visitCount || 0;
  // Find current badge (highest milestone reached)
  let current = null;
  for (const m of LOYALTY_MILESTONES) {
    if (count >= m.visits) current = m;
    else break;
  }
  // Find next milestone
  const next = LOYALTY_MILESTONES.find(m => count < m.visits) || null;
  const progressPct = next ? Math.min(100, Math.round(
    ((count - (current?.visits || 0)) / (next.visits - (current?.visits || 0))) * 100
  )) : 100;
  return { count, current, next, progressPct };
}
const DAYS_SK     = ['Nedeľa','Pondelok','Utorok','Streda','Štvrtok','Piatok','Sobota'];
const CHANNELS    = [
  { id:'general', name:'Všeobecné',   emoji:'💬' },
  { id:'blog',    name:'Blog & Novinky', emoji:'📰' },
  { id:'tanec',   name:'Tanec',       emoji:'💃' },
  { id:'vyziva',  name:'Výživa',      emoji:'🥗' },
  { id:'fitness', name:'Fitness',     emoji:'💪' },
  { id:'eventy',  name:'Eventy',      emoji:'🎉' },
  // Mestské miestnosti – informácie k hodinám pre dané mesto
  { id:'mesto_detva',  name:'Detva',           emoji:'📍', city:true },
  { id:'mesto_zvolen', name:'Zvolen',          emoji:'📍', city:true },
  { id:'mesto_bb',     name:'Banská Bystrica', emoji:'📍', city:true },
  { id:'mesto_brezno', name:'Brezno',          emoji:'📍', city:true },
];

// ─── Member Badge (Twitch-style) ──────────────────────────────────────────────
function getMemberBadge(createdAt) {
  if (!createdAt) return { emoji:'🌱', label:'Nováčik', months:0, color:'#8bc34a' };
  const ms   = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const months = Math.floor(days / 30);
  if (months < 1)  return { emoji:'🌱', label:'Nováčik',    months:0,      color:'#8bc34a' };
  if (months < 3)  return { emoji:'1️⃣', label:'1 mesiac',   months:1,      color:'#ffc107' };
  if (months < 6)  return { emoji:'3️⃣', label:'3 mesiace',  months:3,      color:'#ff9800' };
  if (months < 12) return { emoji:'6️⃣', label:'6 mesiacov', months:6,      color:'#ff5722' };
  if (months < 24) return { emoji:'🏅', label:'1 rok',       months:12,     color:'#9c27b0' };
  if (months < 36) return { emoji:'💎', label:'2 roky',      months:24,     color:'#2196f3' };
  return               { emoji:'👑', label:'Legenda',     months:months, color:'#ffd700' };
}

function userPublic(u) {
  if (!u) return null;
  const badge = getMemberBadge(u.created_at);
  const loyalty = getLoyaltyStatus(u.visit_count || 0);
  const role = USER_ROLES[u.user_type] || USER_ROLES.client;
  return {
    id: u._id, name: u.name, email: u.email, phone: u.phone||'',
    referral_code: u.referral_code, rank: u.rank||1,
    rankName: RANKS[(u.rank||1)-1].name, rankBadge: RANKS[(u.rank||1)-1].badge,
    is_admin: !!u.is_admin, user_type: u.user_type||'partner',
    bank_account: u.bank_account||'', created_at: u.created_at,
    memberBadge: badge, loyalty,
    role_label: role.label, role_icon: role.icon, dash_url: role.dashUrl,
    visit_count: u.visit_count || 0,
    notes: u.notes || '',
    sponsor_id: u.sponsor_id || null,
  };
}

// Resolve dash URL from user object — one portal for everyone except trainer/admin
function dashUrlFor(u) {
  if (!u) return '/';
  if (u.is_admin || u.user_type === 'admin') return '/admin';
  if (u.user_type === 'trainer') return '/trainer';
  return '/client-dashboard'; // client, lead, partner, manager → all get unified portal
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function today()        { return new Date().toISOString().slice(0,10); }
function nowISO()       { return new Date().toISOString(); }
function currentMonth() { return new Date().toISOString().slice(0,7); }
function dateAgo30()    { const d=new Date(); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10); }
function oid()          { return Math.random().toString(36).slice(2,9).toUpperCase(); }

// Next date for a given day-of-week (0=Sun … 6=Sat), from today or future
function nextDateForDay(dow) {
  const d = new Date();
  const diff = (dow - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + (diff === 0 ? 7 : diff));
  return d.toISOString().slice(0,10);
}

// ─── MLM helpers ─────────────────────────────────────────────────────────────
async function getAllDescendants(pid) {
  const seen=new Set([pid]); const queue=[pid]; const res=[];
  while(queue.length){
    const cur=queue.shift();
    const kids=await q.find(db.users,{sponsor_id:cur,is_admin:{$ne:true}});
    for(const k of kids) if(!seen.has(k._id)){seen.add(k._id);res.push(k._id);queue.push(k._id);}
  }
  return res;
}
async function getPersonal30(uid){
  const txs=await q.find(db.transactions,{partner_id:uid,date:{$gte:dateAgo30()}});
  return txs.reduce((s,t)=>s+t.amount,0);
}
async function getTeam30(uid){
  const desc=await getAllDescendants(uid);
  if(!desc.length) return 0;
  const txs=await q.find(db.transactions,{partner_id:{$in:desc},date:{$gte:dateAgo30()}});
  return txs.reduce((s,t)=>s+t.amount,0);
}
async function calcRank(uid){
  const p=await getPersonal30(uid), t=await getTeam30(uid);
  let rank=1;
  for(let i=RANKS.length-1;i>=0;i--) if(p>=RANKS[i].personalMin&&t>=RANKS[i].teamMin){rank=RANKS[i].id;break;}
  await q.update(db.users,{_id:uid},{$set:{rank}});
  return rank;
}
async function saveCommissions(txId,partnerId,amount){
  const month=currentMonth();
  const awarded=[]; // {user_id, amount, level}
  // Distribute up to 5 lines: partnerId = line 1 (direct), then each sponsor above.
  let curId=partnerId;
  for(let line=0; line<LINE_RATES.length; line++){
    const cur=await q.one(db.users,{_id:curId});
    if(!cur) break;
    const rate=LINE_RATES[line];
    const amt=+(amount*rate).toFixed(2);
    if(amt>0){
      await q.insert(db.commissions,{transaction_id:txId,partner_id:cur._id,source_partner_id:partnerId,level:line,percentage:rate,amount:amt,status:'pending',month,created_at:nowISO()});
      awarded.push({user_id:cur._id, amount:amt, level:line});
    }
    if(!cur.sponsor_id) break;
    curId=cur.sponsor_id;
  }
  // Notify every commission recipient (in-app + email)
  notifyCommissionRecipients(txId, awarded).catch(e=>console.error('Commission notify:',e.message));
}

// In-app + email notification to each person who earned a commission from a sale
async function notifyCommissionRecipients(txId, awarded){
  const tx = await q.one(db.transactions,{_id:txId});
  const client = tx?.client_name || '';
  const product = tx?.product_name || 'predaj';
  for(const a of awarded){
    if(!(a.amount>0)) continue;
    const u = await q.one(db.users,{_id:a.user_id});
    if(!u) continue;
    const kind = a.level===0 ? 'Priama provízia (línia 1)' : `Provízia z línie ${a.level+1}`;
    await q.insert(db.notifications,{user_id:u._id, type:'commission',
      title:`💰 Nová provízia +${a.amount.toFixed(2)} €`,
      body:`${kind} z predaja „${product}"${client?` – ${client}`:''}.`,
      read:false, created_at:nowISO()});
    if(u.email && !u.email.includes('@internal.local')){
      sendMail(u.email, `💰 Nová provízia +${a.amount.toFixed(2)} € — Fusion Academy`,
        emailTemplate('Máš novú províziu! 🎉',
          `<p>Ahoj <b>${u.name}</b>,</p><p>Práve ti pribudla <b>${kind.toLowerCase()}</b> <b style="color:#C9A84C">+${a.amount.toFixed(2)} €</b> z predaja <b>${product}</b>${client?` (klient ${client})`:''}.</p><p>Zostatok a výplatu si pozri vo svojom profile.</p>`,
          '📊 Moje provízie', `${APP_URL}/dashboard`)).catch(()=>{});
    }
  }
}

// Auto-award MLM commission for an automatic purchase (Stripe/PayPal/cash membership).
// Recipient = the buyer's sponsor (who referred them). No-op if the buyer has no sponsor.
async function awardPurchaseCommission({buyer_id, amount, product_name}){
  try {
    if(!buyer_id || !(amount>0)) return;
    const buyer = await q.one(db.users,{_id:buyer_id});
    if(!buyer) return;
    // First paid purchase promotes a lead → client
    if(buyer.user_type==='lead'){
      await q.update(db.users,{_id:buyer._id},{$set:{user_type:'client'}});
      await q.insert(db.notifications,{user_id:buyer._id,type:'role_change',title:'Vitaj medzi klientmi! 🎉',body:'Tvoja prvá platba prebehla – si náš klient.',read:false,created_at:nowISO()}).catch(()=>{});
    }
    if(!buyer.sponsor_id) return;
    const amt = +(+amount).toFixed(2);
    const tx = await q.insert(db.transactions,{
      partner_id: buyer.sponsor_id, client_id: buyer._id, client_name: buyer.name,
      product_id:null, product_name: product_name||'Členstvo', amount: amt,
      date: today(), notes:'Automatická provízia z online predaja', auto:true,
      commission_only:true, // excluded from revenue totals (revenue counted via payment/membership record)
      created_at:nowISO()
    });
    await saveCommissions(tx._id, buyer.sponsor_id, amt);
    await calcRank(buyer.sponsor_id);
  } catch(e){ console.error('awardPurchaseCommission:', e.message); }
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
const auth      = async(req,res,next) => {
  if(!req.session.uid) return res.status(401).json({error:'Nie ste prihlásený'});
  // Vynútené odhlásenie po admin resete hesla: session verzia < aktuálna user verzia
  if(req.session.sv !== undefined){
    const u = await q.one(db.users,{_id:req.session.uid});
    if(u && (u.sess_ver||0) > req.session.sv){
      req.session.destroy(()=>{});
      return res.status(401).json({error:'Boli ste odhlásený. Vytvorte si nové heslo.', pw_reset:true});
    }
  }
  next();
};
const adminAuth = async(req,res,next) => {
  if(!req.session.uid) return res.status(401).json({error:'Nie ste prihlásený'});
  const u=await q.one(db.users,{_id:req.session.uid});
  if(!u?.is_admin) return res.status(403).json({error:'Nemáte oprávnenie'});
  req.user=u; req._auditActor=u.name; next();
};

// ─── Seed ─────────────────────────────────────────────────────────────────────
async function seedData() {
  // Generic admin (fallback)
  if(await q.count(db.users,{is_admin:true})===0){
    const hash=await bcrypt.hash('admin123',10);
    await q.insert(db.users,{name:'Admin',email:'admin@fusionacademy.sk',password:hash,referral_code:'ADMIN',is_admin:true,rank:1,active:true,user_type:'admin',phone:'',bank_account:'',sponsor_id:null,notes:'',created_at:today()});
    console.log('✅  Admin: admin@fusionacademy.sk / admin123');
  }

  // Marek Gruber – hlavný admin
  const marekEmail = 'gruber.marek@gmail.com';
  const existingMarek = await q.one(db.users, {email: marekEmail});
  if (!existingMarek) {
    const hash = await bcrypt.hash('FusionAdmin2026!', 10);
    let code = 'MAREK' + Math.floor(10+Math.random()*90);
    while(await q.one(db.users,{referral_code:code})) code='MAREK'+Math.floor(100+Math.random()*900);
    await q.insert(db.users, {
      name:'Marek Gruber', email:marekEmail, password:hash,
      referral_code:code, is_admin:true, rank:8, active:true,
      user_type:'admin', phone:'+421 904 315 151',
      bank_account:'', sponsor_id:null, notes:'Zakladateľ Fusion Academy',
      created_at:'2024-01-01'
    });
    console.log('✅  Admin Marek: gruber.marek@gmail.com / FusionAdmin2026!');
  } else if (!existingMarek.is_admin) {
    // Upgrade to admin if exists as regular user
    await q.update(db.users, {email:marekEmail}, {$set:{is_admin:true, rank:8, user_type:'admin'}});
    console.log('✅  Marek Gruber povýšený na admina');
  }

  // Beáta Gruber Buňová – admin
  const beataEmail = 'beatabunova22@gmail.com';
  const existingBeata = await q.one(db.users, {email: beataEmail});
  if (!existingBeata) {
    const hash = await bcrypt.hash('T15935750', 10);
    let code = 'BEATA' + Math.floor(10+Math.random()*90);
    while(await q.one(db.users,{referral_code:code})) code='BEATA'+Math.floor(100+Math.random()*900);
    await q.insert(db.users, {
      name:'Beáta Gruber Buňová', email:beataEmail, password:hash,
      referral_code:code, is_admin:true, rank:8, active:true,
      user_type:'admin', phone:'',
      bank_account:'', sponsor_id:null, notes:'Spoluzakladateľka Fusion Academy',
      created_at:today()
    });
    console.log('✅  Admin Beáta: beatabunova22@gmail.com');
  } else if (!existingBeata.is_admin) {
    await q.update(db.users, {email:beataEmail}, {$set:{is_admin:true, rank:8, user_type:'admin'}});
    console.log('✅  Beáta Gruber Buňová povýšená na admina');
  }
  // Zakladatelia — is_founder flag (idempotentne)
  for(const fe of [marekEmail, beataEmail]){
    const f=await q.one(db.users,{email:fe});
    if(f && !f.is_founder){ await q.update(db.users,{email:fe},{$set:{is_founder:true}}); }
  }

  // Products
  if(await q.count(db.products,{})===0){
    const prods=[
      {cat:'Členstvá',  name:'Jednorazový vstup',             emoji:'🎫', desc:'Vstup na akúkoľvek lekciu v ktoromkoľvek meste.',                         price:10,    commission_rate:0.10, type:'single',       active:true},
      {cat:'Členstvá',  name:'10-vstupová permanentka',       emoji:'🎟️', desc:'10 vstupov, platnosť 3 mesiace. Úspora 20 %.',                            price:80,    commission_rate:0.12, type:'bundle',       active:true},
      {cat:'Členstvá',  name:'Členstvo BRONZE',               emoji:'🥉', desc:'Neobmedzené Zumba lekcie vo všetkých 4 mestách. Mesačne.',                 price:50,    commission_rate:0.15, type:'subscription', active:true},
      {cat:'Členstvá',  name:'Členstvo SILVER',               emoji:'🥈', desc:'Bronze + metabolická analýza mesačne + online prístup.',                   price:75,    commission_rate:0.15, type:'subscription', active:true},
      {cat:'Členstvá',  name:'Členstvo GOLD',                 emoji:'🥇', desc:'Silver + jedálniček na mieru na celý týždeň + individuálny plán.',            price:125,   commission_rate:0.18, type:'subscription', active:true},
      {cat:'Členstvá',  name:'Online Zumba (mesačne)',        emoji:'🌐', desc:'Živé online hodiny Zumby odkiaľkoľvek.',                                   price:12.90, commission_rate:0.25, type:'subscription', active:true},
      {cat:'Kurzy',     name:'Svadobný tanec',                emoji:'💍', desc:'Prvý tanec na svadbu. 5 lekcií pre pár.',                                  price:149,   commission_rate:0.12, type:'course',       active:true},
      {cat:'Kurzy',     name:'Súkromná lekcia (60 min)',      emoji:'👤', desc:'Individuálna lekcia s inštruktorom.',                                      price:45,    commission_rate:0.12, type:'single',       active:true},
      {cat:'Kurzy',     name:'Kurz pre deti (10 lekcií)',     emoji:'🧒', desc:'Spoločenské tance pre deti 5–17 rokov.',                                   price:90,    commission_rate:0.12, type:'course',       active:true},
      {cat:'Kurzy',     name:'Kurz pre dospelých (12 týž)',  emoji:'💃', desc:'Latino, Hip-Hop, Choreo. Začiatočníci vítaní!',                            price:150,   commission_rate:0.12, type:'course',       active:true},
      {cat:'Kurzy',     name:'Maturantský ples – Last Dance', emoji:'🎓', desc:'Špeciálny program pre maturantov.',                                        price:120,   commission_rate:0.12, type:'course',       active:true},
      {cat:'Analýzy',   name:'Metabolická analýza (InBody)', emoji:'📊', desc:'Profesionálna analýza telesnej kompozície.',                               price:35,    commission_rate:0.15, type:'service',      active:true},
      {cat:'Analýzy',   name:'Fit Premena – základný',       emoji:'🔬', desc:'Analýza + cvičebný plán + výživové odporúčania.',                          price:65,    commission_rate:0.15, type:'service',      active:true},
      {cat:'Analýzy',   name:'Fit Premena – premium',        emoji:'📈', desc:'4x analýza + tréning + jedálniček + koučing.',                             price:199,   commission_rate:0.15, type:'service',      active:true},
      {cat:'Analýzy',   name:'Nutričné poradenstvo (60 min)',emoji:'🥗', desc:'Individuálna konzultácia s výživovým poradcom.',                           price:45,    commission_rate:0.15, type:'service',      active:true},
      // Herbalife — náhrada jedla
      {cat:'Herbalife', name:'Formula 1 – Vanilka-smotana (500g)',   emoji:'🥤', desc:'Náhrada jedla. 220 kcal, 18g bielkovín, 25 vitamínov a minerálov. Príchuť vanilka-smotana.',                    price:38.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Formula 1 – Jemná čokoláda (500g)',    emoji:'🍫', desc:'Náhrada jedla. 220 kcal, 18g bielkovín, 25 vitamínov a minerálov. Príchuť čokoláda.',                           price:38.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Formula 1 – Jahoda & Malina (500g)',   emoji:'🍓', desc:'Náhrada jedla. 220 kcal, 18g bielkovín. Osviežujúca letná príchuť.',                                            price:38.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Formula 1 – Café Latte (500g)',        emoji:'☕', desc:'Náhrada jedla s príchuťou kávy. Ideálne pre ranný štart dňa.',                                                   price:38.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Formula 1 – Vanilka-smotana XXL (780g)',emoji:'🥤',desc:'Veľké balenie Formula 1 vanilka. Šetrnejšia možnosť na mesiac. Úspora cca 18 %.',                               price:55.50, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Formula 1 – balíček 3 príchute',       emoji:'🎁', desc:'Tri kusy Formula 1 podľa vlastného výberu príchutí. Ideálny štartovací set.',                                   price:114.70,commission_rate:0.25, type:'product', active:true},
      // Herbalife — nápoje
      {cat:'Herbalife', name:'Instantný bylinný čaj – Broskyňa (50g)',emoji:'🍑',desc:'Bylinný čaj s prírodnou príchuťou. Podporuje metabolizmus. 50 dávok.',                                          price:26.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Instantný bylinný čaj – XXL (100g)',   emoji:'🍵', desc:'Dvojbalenie obľúbeného bylinného čaju. Výhodná cena na deň.',                                                    price:45.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Bylinný nápoj z Aloe Vera – Originál', emoji:'🌿', desc:'Nápoj z aloe vera pre správne trávenie a hydratáciu. Originálna príchuť. 473 ml.',                              price:34.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Bylinný nápoj z Aloe Vera – Mango XXL',emoji:'🥭', desc:'Veľké balenie aloe vera mangová príchuť. Pre každodennú hydratáciu.',                                           price:119.90,commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Multivlákninový nápoj (Fiber)',        emoji:'🌾', desc:'Vláknina pre zdravé trávenie. Prirodzene sladká príchuť. Jednoduché miešanie.',                                  price:29.90, commission_rate:0.25, type:'product', active:true},
      // Herbalife — šport H24
      {cat:'Herbalife', name:'H24 Rebuild Strength – proteín (1 kg)',emoji:'💪', desc:'Proteínový prášok po tréningu. 24g bielkovín na dávku. Podpora budovania svalov.',                              price:63.40, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'H24 Hydrate – elektrolyty (20 sáčkov)',emoji:'⚡', desc:'Rýchla hydratácia počas tréningu. Elektrolyty a B-vitamíny. 20 dávok.',                                         price:35.50, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'H24 CR7 Drive Acai – energetický nápoj',emoji:'⚽',desc:'Šport. nápoj Cristiana Ronalda. Acai + elektrolyty + sacharidy. 10 sáčkov.',                                   price:17.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Creatine+ Herbalife24',                emoji:'🏋️', desc:'Kreatín monohydrát pre silu a výkon. Bez zbytočných prísad.',                                                    price:29.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'H24 Proteínové tyčinky – Brusnica (6ks)',emoji:'🍫',desc:'Proteínové tyčinky s príchuťou brusnice a bielej čokolády. 12g bielkovín na kus.',                             price:20.50, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Proteínové chipsy – Kyslá smotana (6ks)',emoji:'🥔',desc:'Chrumkavý proteínový snack s nízkym obsahom tuku. 15g bielkovín.',                                             price:24.90, commission_rate:0.25, type:'product', active:true},
      // Herbalife — cielená výživa
      {cat:'Herbalife', name:'Phyto Complete – 60 kapsúl',           emoji:'🌱', desc:'Rastlinný komplex antioxidantov. Podpora bunkovej ochrany a energie.',                                           price:57.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Night Mode – spánok & regenerácia',    emoji:'🌙', desc:'Harmanček a broskyňa. Prirodzená podpora spánku a nočnej regenerácie.',                                         price:45.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Immune Booster – imunita',             emoji:'🛡️', desc:'Vitamín C, D, zinok a echinacea. Komplexná podpora imunitného systému.',                                        price:44.00, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Active Mind Complex – 60 kapsúl',      emoji:'🧠', desc:'Koncentrácia a pamäť. Ginko, ginseng, vitamíny B. Pre aktívnych ľudí.',                                         price:46.50, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Collagen Skin Booster – 171g',         emoji:'✨', desc:'Hydrolyzovaný morský kolagén + vitamín C + biotin. Krásna pokožka zvnútra.',                                     price:65.00, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Protein Bake Mix – pečenie',           emoji:'🧁', desc:'Proteínový základ pre muffiny, palacinky, tyčinky. 14g bielkovín na dávku.',                                    price:45.90, commission_rate:0.25, type:'product', active:true},
      // Herbalife — sety & programy
      {cat:'Herbalife', name:'Štartovací set: F1 + Čaj',             emoji:'🎯', desc:'Formula 1 (500g) + Bylinný čaj (50g). Ideálny štart pre Fit Premena program.',                                  price:64.80, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Štartovací set: F1 + Aloe',            emoji:'🌿', desc:'Formula 1 (500g) + Aloe vera nápoj. Výživa + hydratácia + trávenie.',                                           price:72.30, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Program chudnutia – Štandard',         emoji:'📦', desc:'F1 shake + Čaj + Aloe + Vláknina. Komplexný program na 1 mesiac.',                                              price:162.00,commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Program chudnutia – Štandard Plus',    emoji:'🏆', desc:'Rozšírený program + proteínové tyčinky + vitamínový komplex. Pre lepšie výsledky.',                             price:250.00,commission_rate:0.25, type:'product', active:true},
      {cat:'Oblečenie', name:'Fusion tričko (dámske)',       emoji:'👕', desc:'Priedušné športové tričko. Veľkosti XS–XL.',                               price:25,    commission_rate:0.08, type:'product',      active:true},
      {cat:'Oblečenie', name:'Fusion leggings',              emoji:'🩱', desc:'Vysokopasové leggings so vzorom. XS–XL.',                                  price:45,    commission_rate:0.08, type:'product',      active:true},
      {cat:'Oblečenie', name:'Fusion mikina (unisex)',       emoji:'🧥', desc:'Pohodlná mikina s kapucňou. S–XXL.',                                       price:55,    commission_rate:0.08, type:'product',      active:true},
      {cat:'Oblečenie', name:'Fľaša Fusion Academy 0,7 l',  emoji:'🍶', desc:'Nerezová termoska s logom. Teplo 12 h, chlad 24 h.',                       price:19,    commission_rate:0.08, type:'product',      active:true},
      {cat:'Eventy',    name:'Masterclass / Workshop',       emoji:'🎭', desc:'Špeciálny workshop s hosťujúcim inštruktorom.',                            price:35,    commission_rate:0.15, type:'event',        active:true},
      {cat:'Eventy',    name:'Víkendový retreat (SK)',       emoji:'🏔️', desc:'Tanečno-wellness pobyt. Ubytovanie + strava + tréningy.',                  price:280,   commission_rate:0.10, type:'event',        active:true},
    ];
    for(const p of prods) await q.insert(db.products,p);
    console.log('✅  Produkty naplnené');
  }

  // Classes (weekly schedule) — real schedule from latindancefusion.art
  if(await q.count(db.classes,{})===0){
    const classes=[
      // Nedeľa (0)
      {name:'Zumba',               emoji:'🎵', category:'Zumba',    instructor:'Marek Gruber',              location:'Detva',                       address:'Fusion Academy, Záhradná 7, Detva',                   day_of_week:0, time_start:'19:00', time_end:'20:00', capacity:20,  level:'Všetky úrovne',  description:'Zumba v Detve! Latino rytmy, energia a komunita. Spáliš 400–600 kcal. Prvá hodina ZADARMO!',                         price:10, color:'#C9A84C', active:true},
      // Pondelok (1)
      {name:'Zumba',               emoji:'🎵', category:'Zumba',    instructor:'Beáta Gruber Buňová',       location:'Zvolen',                      address:'Fitko Gymkova, M.R. Štefánika 805, Zvolen',            day_of_week:1, time_start:'19:00', time_end:'20:00', capacity:25,  level:'Všetky úrovne',  description:'Zumba vo Zvolene! Energetická hodina latinského fitnes tanca. Spáliš 400–600 kcal. Prvá hodina ZADARMO!',           price:10, color:'#C9A84C', active:true},
      {name:'Zumba',               emoji:'🎵', category:'Zumba',    instructor:'Fusion Team',               location:'Banská Bystrica',             address:'R2N Business centrum, Sládkovičova 29, Banská Bystrica',day_of_week:1, time_start:'17:00', time_end:'18:00', capacity:25,  level:'Všetky úrovne',  description:'Zumba v Banskej Bystrici! Latínske rytmy, energia a komunita. Prvá hodina ZADARMO!',                                 price:10, color:'#C9A84C', active:true},
      // Utorok (2)
      {name:'Zumba',               emoji:'🎵', category:'Zumba',    instructor:'Fusion Team',               location:'Brezno',                      address:'Fitko LÉGIA, Fraňa Kráľa 1/A, Brezno',                day_of_week:2, time_start:'19:00', time_end:'20:00', capacity:20,  level:'Všetky úrovne',  description:'Zumba v Brezne! Latino fitness pre každého. Spáliš 400–600 kcal za hodinu.',                                         price:10, color:'#C9A84C', active:true},
      {name:'Zumba ONLINE – LIVE',         emoji:'🌐', category:'Online',   instructor:'Beáta Gruber Buňová',       location:'Online',                      address:'Živé vysielanie zo Zvolena – link po registrácii',     day_of_week:2, time_start:'19:00', time_end:'20:00', capacity:100, level:'Všetky úrovne',  description:'Živé online Zumba hodiny z pohodlia domova. Odkiaľkoľvek na Slovensku aj v zahraničí. Online členstvo od 12.90 €/mes.', price:6, color:'#2196f3', active:true},
      // Streda (3)
      {name:'Zumba',               emoji:'🎵', category:'Zumba',    instructor:'Beáta Gruber Buňová',       location:'Zvolen',                      address:'Fitko Gymkova, M.R. Štefánika 805, Zvolen',            day_of_week:3, time_start:'17:00', time_end:'18:00', capacity:25,  level:'Všetky úrovne',  description:'Stredajšia Zumba vo Zvolene! Skvelý stred týždňa s latinskými rytmami.',                                            price:10, color:'#C9A84C', active:true},
      {name:'Zumba',               emoji:'🎵', category:'Zumba',    instructor:'Fusion Team',               location:'Banská Bystrica',             address:'R2N Business centrum, Sládkovičova 29, Banská Bystrica',day_of_week:3, time_start:'19:00', time_end:'20:00', capacity:25,  level:'Všetky úrovne',  description:'Streda patrí Zumbe v Banskej Bystrici! Energetická hodina latinského tanca.',                                                      price:10, color:'#C9A84C', active:true},
      // Štvrtok (4)
      {name:'Zumba',               emoji:'🎵', category:'Zumba',    instructor:'Fusion Team',               location:'Brezno',                      address:'Fitko LÉGIA, Fraňa Kráľa 1/A, Brezno',                day_of_week:4, time_start:'19:00', time_end:'20:00', capacity:20,  level:'Všetky úrovne',  description:'Štvrtok = Zumba v Brezne! Latínsky rytmus a dobrá nálada.',                                                          price:10, color:'#C9A84C', active:true},
      // Piatok (5)
      {name:'Zumba',               emoji:'🎵', category:'Zumba',    instructor:'Marek Gruber',              location:'Detva',                       address:'Fusion Academy, Záhradná 7, Detva',                   day_of_week:5, time_start:'19:00', time_end:'20:00', capacity:20,  level:'Všetky úrovne',  description:'Piatok patrí Zumbe v Detve! Latino rytmy a komunita. Prvá hodina ZADARMO!',                                          price:10, color:'#C9A84C', active:true},
    ];
    for(const c of classes) await q.insert(db.classes, c);
    console.log('✅  Rozvrh naplnený');
  }

  // Ensure the Friday Detva Zumba 19:00 exists (added to schedule after some DBs were seeded).
  // Idempotent: only inserts if missing, so it self-heals on production without duplicating.
  if(!(await q.one(db.classes,{day_of_week:5, location:'Detva', category:'Zumba', time_start:'19:00'}))){
    await q.insert(db.classes,{name:'Zumba', emoji:'🎵', category:'Zumba', instructor:'Marek Gruber', location:'Detva', address:'Fusion Academy, Záhradná 7, Detva', day_of_week:5, time_start:'19:00', time_end:'20:00', capacity:20, level:'Všetky úrovne', description:'Piatok patrí Zumbe v Detve! Latino rytmy a komunita. Prvá hodina ZADARMO!', price:10, color:'#C9A84C', active:true});
    console.log('✅  Doplnená piatková Zumba v Detve 19:00');
  }

  // Migration: rename "Zumba Fitness" → "Zumba" on existing DBs (idempotent)
  { const renamed = await q.update(db.classes,{name:'Zumba Fitness'},{$set:{name:'Zumba'}},{multi:true});
    if(renamed) console.log(`✅  Premenovaných ${renamed} hodín „Zumba Fitness" → „Zumba"`); }
  // Migration: Silver membership product price 65 → 75 (idempotent)
  await q.update(db.products,{name:'Členstvo SILVER',price:65},{$set:{price:75}},{multi:true});
  // Migration: jednotná kapacita 30 pre všetky hodiny v mestách (online necháme na 100)
  { const capUp = await q.update(db.classes,{category:{$ne:'Online'},capacity:{$ne:30}},{$set:{capacity:30}},{multi:true});
    if(capUp) console.log(`✅  Kapacita nastavená na 30 pre ${capUp} hodín`); }
  // Migration: úplné odstránenie Herbalife + F1 z ponuky (deaktivácia produktov + zmazanie blogov)
  { const herbOff = await q.update(db.products,{cat:'Herbalife',active:true},{$set:{active:false}},{multi:true});
    if(herbOff) console.log(`✅  Deaktivovaných ${herbOff} Herbalife produktov`);
    const arts = await q.find(db.messages,{channel:'blog'});
    for(const a of arts){ if(/herbalife|formula 1|f1 kokte/i.test((a.title||''))) await q.remove(db.messages,{_id:a._id},{}); } }

  // Herbalife products (add even if other products already exist)
  if(await q.count(db.products,{cat:'Herbalife'})===0){
    const herba=[
      {cat:'Herbalife', name:'Formula 1 – Vanilka-smotana (500g)',    emoji:'🥤', desc:'Náhrada jedla. 220 kcal, 18g bielkovín, 25 vitamínov. Príchuť vanilka-smotana.',              price:38.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Formula 1 – Jemná čokoláda (500g)',     emoji:'🍫', desc:'Náhrada jedla. 220 kcal, 18g bielkovín. Príchuť čokoláda.',                                    price:38.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Formula 1 – Jahoda & Malina (500g)',    emoji:'🍓', desc:'Náhrada jedla. 220 kcal, 18g bielkovín. Osviežujúca letná príchuť.',                            price:38.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Formula 1 – Café Latte (500g)',         emoji:'☕', desc:'Náhrada jedla s príchuťou kávy. Ideálne pre ranný štart dňa.',                                  price:38.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Formula 1 – Vanilka XXL (780g)',        emoji:'🥤', desc:'Veľké balenie Formula 1 vanilka. Úspora cca 18 %. Cca 26 dávok.',                              price:55.50, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Formula 1 – balíček 3 príchute',        emoji:'🎁', desc:'3× Formula 1 podľa vlastného výberu. Ideálny štartovací set.',                                 price:114.70,commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Bylinný čaj – Broskyňa (50g)',          emoji:'🍑', desc:'Bylinný čaj, podporuje metabolizmus. 50 dávok.',                                               price:26.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Bylinný čaj – XXL (100g)',              emoji:'🍵', desc:'Dvojbalenie bylinného čaju. Výhodná cena na deň.',                                             price:45.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Aloe Vera nápoj – Originál',            emoji:'🌿', desc:'Nápoj z aloe vera pre trávenie a hydratáciu. Originálna príchuť. 473 ml.',                    price:34.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Aloe Vera nápoj – Mango XXL',           emoji:'🥭', desc:'Veľké balenie aloe vera, mangová príchuť.',                                                    price:119.90,commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Multivlákninový nápoj (Fiber)',         emoji:'🌾', desc:'Vláknina pre zdravé trávenie. Prirodzene sladká príchuť.',                                     price:29.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'H24 Rebuild Strength proteín (1 kg)',   emoji:'💪', desc:'Proteínový prášok po tréningu. 24g bielkovín na dávku.',                                       price:63.40, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'H24 Hydrate – elektrolyty (20 sáčkov)', emoji:'⚡', desc:'Rýchla hydratácia počas tréningu. Elektrolyty a B-vitamíny.',                                 price:35.50, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'H24 CR7 Drive Acai (10 sáčkov)',        emoji:'⚽', desc:'Šport. nápoj Cristiana Ronalda. Acai + elektrolyty + sacharidy.',                             price:17.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Creatine+ Herbalife24',                 emoji:'🏋️', desc:'Kreatín monohydrát pre silu a výkon.',                                                         price:29.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'H24 Proteínové tyčinky Brusnica (6ks)', emoji:'🍫', desc:'Proteínové tyčinky, brusnica & biela čokoláda. 12g bielkovín/kus.',                           price:20.50, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Proteínové chipsy Kyslá smotana (6ks)', emoji:'🥔', desc:'Chrumkavý proteínový snack. 15g bielkovín.',                                                   price:24.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Phyto Complete – 60 kapsúl',            emoji:'🌱', desc:'Rastlinný komplex antioxidantov. Podpora bunkovej ochrany.',                                   price:57.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Night Mode – spánok & regenerácia',     emoji:'🌙', desc:'Harmanček a broskyňa. Prirodzená podpora spánku.',                                            price:45.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Immune Booster – imunita',              emoji:'🛡️', desc:'Vitamín C, D, zinok, echinacea. Komplexná podpora imunity.',                                  price:44.00, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Active Mind Complex – 60 kapsúl',       emoji:'🧠', desc:'Koncentrácia a pamäť. Ginko, ginseng, vitamíny B.',                                           price:46.50, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Collagen Skin Booster – 171g',          emoji:'✨', desc:'Morský kolagén + vitamín C + biotin. Krásna pokožka zvnútra.',                                 price:65.00, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Protein Bake Mix',                      emoji:'🧁', desc:'Proteínový základ pre muffiny, palacinky, tyčinky. 14g bielkovín/dávku.',                    price:45.90, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Štartovací set: F1 + Čaj',              emoji:'🎯', desc:'Formula 1 (500g) + Bylinný čaj (50g). Ideálny štart pre Fit Premena program.',               price:64.80, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Štartovací set: F1 + Aloe',             emoji:'🌿', desc:'Formula 1 (500g) + Aloe vera nápoj. Výživa + hydratácia + trávenie.',                        price:72.30, commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Program chudnutia – Štandard',          emoji:'📦', desc:'F1 shake + Čaj + Aloe + Vláknina. Komplexný 1-mesačný program chudnutia.',                   price:162.00,commission_rate:0.25, type:'product', active:true},
      {cat:'Herbalife', name:'Program chudnutia – Štandard Plus',     emoji:'🏆', desc:'Rozšírený program + proteínové tyčinky + vitamíny. Pre lepšie výsledky.',                    price:250.00,commission_rate:0.25, type:'product', active:true},
    ];
    for(const p of herba) await q.insert(db.products,p);
    console.log('✅  Herbalife produkty naplnené');
  }

  // Blog articles as community posts (seed once)
  if(await q.count(db.messages,{channel:'blog'})===0){
    const admin=await q.one(db.users,{email:'gruber.marek@gmail.com'});
    const uid=admin?admin._id:'system';
    const adminName='Marek Gruber | Fusion Academy';
    const badge={emoji:'👑',label:'Legenda',months:99,color:'#C9A84C'};
    const rankBadge='🏆';
    const now=Date.now();
    const articles=[
      {title:'Pro-Am — tancuj s profesionálom ako v šou Let\'s Dance', cat:'Novinka', date:'25.4.2026',
       text:`🎭 Pro-Am program — Professional-Amateur tanec\n\nNový program, kde tancuješ s profesionálnym partnerom, ktorý ti vytvorí choreografiu na mieru a sprevádza ťa na súťaže.\n\nKaždá lekcia (60 min) obsahuje:\n• Rozcvičenie a technika (5–15 min)\n• Intenzívny tréning (15–50 min)\n• Spätná väzba a cool-down (50–60 min)\n\n💃 Štýly: Latin, Standard, Contemporary\n💰 Cena od 70 €/hod | Silver členovia: 63 € | Gold: 56 €\n📍 Detva, Banská Bystrica, Brezno\n\n➡️ Žiadna predchádzajúca skúsenosť nie je potrebná!`},
      {title:'Ambasádorský program — priveď kamaráta a získaj mesiac zadarmo', cat:'Novinka', date:'24.4.2026',
       text:`🤝 Ambasádorský program Fusion Academy\n\nZa každého nového člena, ktorého privedieš, dostaneš MESIAC ZADARMO.\n\nAko to funguje:\n1. Odporúčaš Fusion Academy kamarátovi\n2. Kamarát sa zaregistruje a zaplatí aspoň 2 mesiace\n3. Ty dostaneš 1 mesiac členstva úplne zadarmo\n\nBez limitu — môžeš zarobiť koľko mesiacov chceš!\n\n📋 Podmienky: Musíš byť členom aspoň 2 mesiace a skutočne odporúčaš z vlastnej skúsenosti.\n\nKontakt: +421 904 315 151`},
      {title:'Prečo začať tancovať v každom veku — 5 dôvodov', cat:'Motivácia', date:'16.4.2026',
       text:`💃 Tanec je najlacnejšia terapia na svete.\n\n5 dôvodov, prečo začať tancovať — v AKOMKOĽVEK veku:\n\n1️⃣ Spáliš 500–700 kcal za hodinu bez pocitu, že cvičíš\n2️⃣ Zlepsíš koordináciu, rovnováhu a držanie tela\n3️⃣ Nájdeš komunitu ľudí, ktorí ťa podporia\n4️⃣ Tanec lieči depresiu a úzkosť — vedecky dokázané\n5️⃣ Prvá hodina je u nás ZADARMO — nič neriskuješ\n\nVítame všetkých od 5 do 70+ rokov, bez ohľadu na kondíciu a skúsenosť.\n\n📍 Detva · Zvolen · Banská Bystrica · Brezno\n📞 +421 904 315 151`},
      {title:'Metabolická analýza — čo o tebe prezradí', cat:'Zdravie', date:'16.4.2026',
       text:`📊 Metabolická analýza (InBody)\n\nVieš koľko svalov, tuku a vody má tvoje telo? Bez tejto informácie je akékoľvek chudnutie len hádanie.\n\nAká merania získaš:\n• Bazálny metabolizmus (koľko kcal spáliš v pokoji)\n• Rozloženie svalovej hmoty\n• % telesného tuku a viscerálneho tuku\n• Biologický vek\n• Odporúčanie makronutrientov na mieru\n\n💡 Príklad: 33-ročný muž, 83.4 kg, 22.9% tuk — analýza ukáže presne kde sú rezervy.\n\n💰 Cena: 35 € | ZADARMO v Silver a Gold členstve\n📍 Dostupné vo všetkých 4 mestách\n🎁 Prvá analýza na vyskúšanie ZDARMA`},
      {title:'Zumba v Detve, Zvolene, Banskej Bystrici a Brezne', cat:'Zumba', date:'16.4.2026',
       text:`🗺️ Kompletný sprievodca Zumby vo Fusion Academy\n\nRozvrh hodín:\n📍 Detva (Záhradná 7): Piatok 19:00, Nedeľa 19:00\n📍 Zvolen (Fitko Gymkova): Pondelok 19:00, Streda 17:00\n📍 Banská Bystrica (R2N Biz centrum): Pondelok 17:00, Streda 19:00\n📍 Brezno (Fitko LÉGIA): Utorok 19:00, Štvrtok 19:00\n🌐 Online LIVE: Utorok 19:00 | 12.90 €/mes\n\n💰 Ceny:\n• Jednorazovo: 10 €\n• 10-vstupová permanentka: 80 €\n• Bronze členstvo: 50 €/mes (neobmedzene)\n\n🎁 Prvá hodina ZADARMO!\n\n"Nikto sa na teba nepozerá — každý rieši samého seba" 😊`},
      {title:'Spoločenské tance pre dospelých — začať môžeš aj bez partnera', cat:'Tanec', date:'16.4.2026',
       text:`👫 Spoločenské tance pre dospelých\n\nNemáš partnera? Nevadí! Na naše hodiny chodia aj jednotlivci.\n\nČo sa naučíš:\n🕺 Štandardné tance: valčík, tango, slowfox\n💃 Latinsko-americké: cha-cha, samba, rumba, jive\n\nPre koho:\n• Páry pripravujúce svadobný tanec\n• Rodičia chcú zatancovať na plese s deťmi\n• Každý, kto hľadá elegantný pohyb\n\n"80 % ľudí, čo prídu, tancuje zhrbených — to je prvá vec, ktorú opravíme"\n\n📍 Pravidelné skupiny: Detva\n📍 Súkromné hodiny: Zvolen, BB, Brezno\n💰 Od 45 €/hodina súkromne | Skupiny od 10 €/vstup\n🎁 Prvá hodina ZADARMO — volaj 0904 31 51 51`},
      {title:'Príbeh Beátky — −17 kg za rok vďaka Zumbe a výžive', cat:'Príbeh', date:'16.4.2026',
       text:`⭐ Príbeh Beátky: −17 kg za rok\n\nBeátka prišla do Fusion Academy pred rokom s miernymi očakávaniami. Dnes je o 17 kg ľahšia.\n\nJej cesta:\n✅ 3–4× týždenne Zumba (vo všetkých 4 mestách)\n✅ Eliminácia cukru a zvýšenie bielkovín\n✅ proteínový shake na rýchle dni\n✅ Priorita spánku a pitného režimu\n\nVýsledky po 12 mesiacoch:\n• −17 kg\n• Lepšie trávenie\n• Viac energie celý deň\n• Lepší spánok a nálada\n\n💬 "Prišla som schudnúť. Odchádzam so svojou rodinou a sama so sebou tak, ako som sa nevidela 15 rokov."\n\n👉 Tvoja premena môže začať dnes. Prvá hodina zadarmo!`},
      {title:'Príbeh Nelky zo Zvolena — z klientky trénerkou', cat:'Príbeh', date:'16.4.2026',
       text:`🌟 Príbeh Nelky: z klientky trénerkou\n\nNelka (14 rokov, Zvolen) prišla pred 2 rokmi s tráviacimi problémami a únavou. Dnes vedie detské tanečné hodiny sama.\n\nProgram:\n• 2–3× týždenne tanec\n• Výživové úpravy pre tínedžerov\n• výživové doplnky\n• Komunita a podpora\n\nVýsledky:\n✅ Tráviace problémy zmizli do niekoľkých mesiacov\n✅ Výrazne viac energie\n✅ Zlepšili sa školské výsledky\n✅ Objavila talent na pedagogiku — teraz vyučuje deti\n\n💡 Vek 12–16 je kľúčový pre celoživotný vzťah k pohybu. Keď sa pohyb stane zábavou — nie povinnosťou — mladí ľudia si ho udržia navždy.\n\n📞 Prvá hodina ZADARMO: +421 904 315 151`},
      {title:'Príbeh Mišky — −5 kg za 2 mesiace a zmena celej rodiny', cat:'Príbeh', date:'16.4.2026',
       text:`💪 Príbeh Mišky zo Zvolena: −5 kg za 2 mesiace\n\nMiška sa prihlásila do Fit Premena programu s jediným cieľom: opäť sa zmestiť do svojich obľúbených šiat.\n\nProgram (Fit Premena):\n📊 Metabolická analýza → personalizovaný plán\n🥗 Jedálniček na mieru s reálnymi porciami\n🥗 jedálniček na mieru s reálnymi porciami\n💃 2× týžd. Zumba v Zvolene\n📋 Týždenné check-iny\n\nVýsledky za 2 mesiace:\n• −5 kg, −4 cm v páse\n• Opäť sa zmestila do svojich šiat ✅\n• Celá rodina začala jesť zdravšie\n\n💬 "Začala som so sebou. Skončilo to tým, že sa zmenila celá naša kuchyňa. Najlepšia investícia za roky."\n\n👉 Fit Premena program od 65 €/mes`},
      {title:'Boli sme LIVE na Markíze v Teleráne 📺', cat:'Médiá', date:'16.4.2026',
       text:`📺 Fusion Academy LIVE na Markíze — Teleráno\n\nBola to jedna z najväčších chvíľ v histórii Fusion Academy — živé vysielanie na Markíze pred celým Slovenskom.\n\nCo sme predviedli:\n🎭 Živé tanečné vystúpenie (Posledný tanec)\n🏃 Fit Premena wellness program\n🎉 FitDays životný štýl\n\nVýsledok: Stovky dopytov z celého Slovenska — svadby, školské plesy, firemné akcie, fitness programy.\n\nDnes vieme obsloužiť aj vzdialených klientov cez online program.\n\n🙏 Ďakujeme každému, kto nás sledoval a napísal. Toto všetko vzniklo z jednej vášne pre tanec.\n\n— Marek & Beáta Gruber, Fusion Academy`},
      {title:'Príbeh Fusion Academy — z jedného tanečníka štyri mestá', cat:'O nás', date:'16.4.2026',
       text:`🏫 Ako vznikla Fusion Academy?\n\nMarek Gruber — 18 rokov profesionálny tanečník, majster Slovenska v tanečnej choreografii — si uvedomil, že samotné tanečné súťaže rodinu neuživia.\n\nMiesto odchodu vytvoril Fusion Academy.\n\nDnes:\n📍 4 mestá: Detva, Zvolen, Banská Bystrica, Brezno\n👥 Stovky spokojných klientov\n⭐ 36+ Google recenzií\n💃 Zumba · Spoločenské tance · Fit Premena · Výživa · Komunita\n\nTím:\n👤 Marek Gruber — zakladateľ, choreograf\n👤 Beáta Gruber Buňová — Zumba inštruktorka & komunita\n\n💡 Fusion = tanec + fitness + výživa + komunita\n\n"Tanec nie je o výsledku. Je o ceste." — Marek Gruber\n\n🎁 Prvá hodina ZADARMO vo všetkých mestách\n📞 +421 904 315 151`},
    ];
    for(let i=0;i<articles.length;i++){
      const a=articles[i];
      await q.insert(db.messages,{
        channel:'blog',
        user_id:uid,
        user_name:adminName,
        memberBadge:badge,
        rankBadge,
        text:`📰 *${a.title}*\n\n${a.text}`,
        is_article:true,
        article_cat:a.cat,
        article_date:a.date,
        created_at: now - (articles.length-i)*3600000*24
      });
    }
    console.log('✅  Blog články naplnené v komunite');
  }

  // ── Seed email sequences ─────────────────────────────────────────────────────
  if(await q.count(db.email_steps,{})===0){
    const APP = APP_URL;
    const steps = [
      // ── WELCOME (po registrácii) ─────────────────────────────────────────────
      { sequence:'welcome', day:0, label:'Uvítací email', active:true,
        subject:'Vitaj vo Fusion Academy! 🎉',
        body:`<p>Sme nadšení, že si tu!</p><p>Vo Fusion Academy ťa čaká:</p><ul><li>💃 Zumba, spoločenské tance, súkromné hodiny</li><li>📍 4 mestá: Detva, Zvolen, Banská Bystrica, Brezno</li><li>👥 Komunita stoviek spokojných klientok</li></ul><p>Ako začať? <b>Prvá hodina je ZADARMO</b> — bez záväzku, bez platby.</p>`,
        cta:'🗓️ Rezervovať prvú hodinu zadarmo', cta_url:`${APP}/schedule` },
      { sequence:'welcome', day:3, label:'Tip po 3 dňoch', active:true,
        subject:'Tip pre teba: ako vybrať správnu hodinu 💃',
        body:`<p>Nevieš, čia hodina je pre teba? Poradíme!</p><ul><li><b>Zumba</b> – chudnutie, energia, zábava. Ideálne pre začiatočníkov.</li><li><b>Spoločenské tance</b> – elegancia, plesová príprava, páry aj jednotlivci.</li><li><b>Súkromná hodina</b> – individuálny tréning jeden na jedného, tempo aj zameranie podľa teba.</li></ul><p>Zapíš sa na tú, čo ťa zaujíma – <b>prvá je zadarmo</b>.</p>`,
        cta:'📋 Pozrieť rozvrh', cta_url:`${APP}/schedule` },
      { sequence:'welcome', day:7, label:'Inšpirácia po týždni', active:true,
        subject:'Beátka schudla 17 kg. Ako? 💪',
        body:`<p>Beátka prišla do Fusion Academy pred rokom. Dnes je o <b>17 kg ľahšia</b>.</p><p>"Prišla som schudnúť. Odchádzam so svojou rodinou a sama so sebou tak, ako som sa nevidela 15 rokov."</p><p>Jej recept? 3× týždenne Zumba + výživa. Nič viac.</p><p>Tvoja premena môže začať <b>tento týždeň</b>.</p>`,
        cta:'💃 Začať teraz', cta_url:`${APP}/schedule` },

      // ── LEAD NURTURE (registrovaný, bez členstva) ────────────────────────────
      { sequence:'lead_nurture', day:3, label:'Lead – 3 dni bez nákupu', active:true,
        subject:'Ešte si neprišla? Tvoja hodina ťa čaká 🎯',
        body:`<p>Zaregistrovala si sa, ale zatiaľ sme ťa nevideli.</p><p>Vieme, že prvý krok je najtažší. Preto je prvá hodina <b>ZADARMO</b> – bez rizika, bez záväzku.</p><p>Jednoducho príď, vyskúšaj a uvidíš sama.</p>`,
        cta:'🎁 Rezervovať zadarmo', cta_url:`${APP}/schedule` },
      { sequence:'lead_nurture', day:7, label:'Lead – 7 dní bez nákupu', active:true,
        subject:'Čo hovorí naša komunita? 👥',
        body:`<p>36+ hodnotení ⭐⭐⭐⭐⭐ na Google. Tu je jeden z nich:</p><p><i>"Prišla som na jednu hodinu. Zostala som rok. Najlepšie rozhodnutie za dlho."</i></p><p>Zapoj sa aj ty. Prvá hodina je vždy zadarmo.</p>`,
        cta:'📍 Nájsť hodinu blízko mňa', cta_url:`${APP}/schedule` },
      { sequence:'lead_nurture', day:14, label:'Lead – 14 dní bez nákupu', active:true,
        subject:'Posledná šanca: 10% zľava na prvé členstvo 🎟️',
        body:`<p>Ako špeciálne poďakovanie za registráciu, ponúkame ti <b>10% zľavu na Bronze členstvo</b> (neobmedzene hodín).</p><p>Platí do konca týždňa. Stačí sa prihlásiť a vybrať plán.</p>`,
        cta:'💳 Aktivovať zľavu', cta_url:`${APP}/pricing` },
      { sequence:'lead_nurture', day:30, label:'Lead – 30 dní bez nákupu', active:true,
        subject:'Zdravíme sa! Stále tu sme 💛',
        body:`<p>Uplynul mesiac od registrácie. Ak sa okolnosti zmenili a chceš začať tancovať – sme stále tu.</p><p>Kedykoľvek prídeš, prvá hodina je zadarmo.</p>`,
        cta:'🗓️ Pozrieť rozvrh', cta_url:`${APP}/schedule` },

      // ── MEMBERSHIP WELCOME (po kúpe členstva) ────────────────────────────────
      { sequence:'membership_welcome', day:0, label:'Členstvo aktivované', active:true,
        subject:'Členstvo aktivované – vitaj v klube! 🏆',
        body:`<p>Tvoje členstvo je aktívne. Od teraz môžeš chodiť na <b>neobmedzene hodín</b> vo všetkých mestách.</p><p><b>Čo ďalej?</b></p><ul><li>📱 Prihlás sa do klient dashboardu a rezervuj si hodinu</li><li>💬 Zapoj sa do komunity – chat, novinky, výzvy</li><li>🎟️ Ukáž svoj QR kód trénerovi pri vstupe</li></ul>`,
        cta:'📱 Otvoriť môj profil', cta_url:`${APP}/client-dashboard` },
      { sequence:'membership_welcome', day:1, label:'Tipy pre nových členov', active:true,
        subject:'5 tipov pre nových členov Fusion Academy 💡',
        body:`<p>Vitaj v klube! Tu je 5 vecí, ktoré by si mala vedieť:</p><ol><li>Rezervuj hodinu vopred – miesta sú limitované</li><li>Ukáž QR kód na telefóne pri vstupe</li><li>Vyskúšaj aspoň 3 rôzne typy hodín</li><li>Zapoj sa do komunity – chat je plný inšpirácie</li><li>Ak niečo nevieš, napíš trénerovi priamo</li></ol>`,
        cta:'🗓️ Rezervovať hodinu', cta_url:`${APP}/schedule` },
      { sequence:'membership_welcome', day:7, label:'Check-in po týždni', active:true,
        subject:'Ako ti ide prvý týždeň? 🌟',
        body:`<p>Uplynul týždeň od aktivácie tvojho členstva. Ako sa ti darí?</p><p>Ak si ešte nebola na hodine, nevadí – teraz je správny čas. Máš neobmedzene vstupov celý mesiac.</p><p>Ak máš akékoľvek otázky, odpíš na tento email – radi pomôžeme.</p>`,
        cta:'💃 Rezervovať hodinu', cta_url:`${APP}/schedule` },

      // ── EXPIRY WARNING ───────────────────────────────────────────────────────
      { sequence:'expiry_warning', day:-7, label:'Upozornenie 7 dní', active:true,
        subject:'⚠️ Tvoje členstvo vyprší o 7 dní',
        body:`<p>Tvoje členstvo vyprší o <b>7 dní</b>.</p><p>Obnov si ho teraz a neprerušuj svoju tanečnú cestu. Ak obnovíš pred expiráciou, členstvo sa predĺži – nestratíš ani deň.</p>`,
        cta:'🔄 Obnoviť členstvo', cta_url:`${APP}/pricing` },
      { sequence:'expiry_warning', day:-3, label:'Upozornenie 3 dni', active:true,
        subject:'⚠️ Tvoje členstvo vyprší o 3 dni – konaj teraz',
        body:`<p>Zostávajú <b>3 dni</b> platnosti tvojho členstva.</p><p>Po expirácii stratíš prístup na hodiny. Obnov si ho jedným kliknutím.</p>`,
        cta:'⚡ Obnoviť teraz', cta_url:`${APP}/pricing` },
      { sequence:'expiry_warning', day:-1, label:'Upozornenie posledný deň', active:true,
        subject:'🚨 Tvoje členstvo vyprší ZAJTRA',
        body:`<p>Toto je posledné upozornenie – tvoje členstvo vyprší <b>zajtra</b>.</p><p>Ak nechceš prísť o prístup na hodiny, obnov si ho ešte dnes.</p>`,
        cta:'🔐 Obnoviť ihneď', cta_url:`${APP}/pricing` },

      // ── POST FIRST CLASS ─────────────────────────────────────────────────────
      { sequence:'post_first_class', day:0, label:'Follow-up po prvej hodine', active:true,
        subject:'Ako sa ti páčila prvá hodina? 🥰',
        body:`<p>Bola si u nás prvýkrát – ďakujeme!</p><p>Ako to šlo? Dúfame, že sa ti páčilo.</p><p>Ak máš otázky alebo chceš vedieť viac o členstvách, jednoducho odpíš na tento email.</p><p>Budeme radi, ak prídeš aj nabudúce 💃</p>`,
        cta:'🗓️ Rezervovať ďalšiu hodinu', cta_url:`${APP}/schedule` },
      { sequence:'post_first_class', day:3, label:'Ponuka po prvej hodine', active:true,
        subject:'Špeciálna ponuka len pre teba 🎁',
        body:`<p>Videli sme ťa na hodine – a vieme, že to mal byť len začiatok!</p><p>Pre nových klientov ponúkame Bronze členstvo (neobmedzene hodín) za <b>50 €/mesiac</b>.</p><p>To vychádza na <b>menej ako 2 € za hodinu</b> – pri 3 hodinách týždenne.</p>`,
        cta:'💳 Aktivovať členstvo', cta_url:`${APP}/pricing` },

      // ── RE-ENGAGEMENT (neaktívni 14+ dní) ───────────────────────────────────
      { sequence:'reengagement', day:0, label:'Chýbaš nám – 14 dní', active:true,
        subject:'Chýbaš nám! 🥺 Vráť sa na hodiny',
        body:`<p>Všimli sme si, že si u nás dlhší čas nebola.</p><p>Vráť sa – tvoje miesto na parkete stále čaká. A ak máš aktívne členstvo, využi ho!</p>`,
        cta:'🗓️ Pozrieť rozvrh', cta_url:`${APP}/schedule` },
      { sequence:'reengagement', day:7, label:'Re-engagement – 2. pokus', active:true,
        subject:'Špeciálna ponuka pre teba 💛',
        body:`<p>Vieme, že život je niekedy hektický. Preto chceme uľahčiť návrat.</p><p>Ak chceš obnoviť alebo kúpiť členstvo, napíš nám a dohodneme sa na podmienkach.</p>`,
        cta:'💌 Kontaktovať nás', cta_url:`${APP}/contact` },
    ];
    for(const s of steps) await q.insert(db.email_steps, {...s, created_at:nowISO()});
    console.log('✅  Email sekvencie naplnené ('+steps.length+' krokov)');
  }
  // Idempotentne zabezpeč „app_launch" krok (oznam o novej appke + hodina zdarma navyše)
  const APP2 = APP_URL;
  if(await q.count(db.email_steps,{sequence:'app_launch'})===0){
    await q.insert(db.email_steps, { sequence:'app_launch', day:0, label:'Nová appka – hodina zdarma navyše', active:true,
      subject:'🎉 Máme novú aplikáciu – a pre teba hodina zdarma navyše!',
      body:`<p>Ahoj,</p>
        <p>vo Fusion Academy sme spustili <b>úplne novú aplikáciu</b> 💃 – rezervácie hodín, členstvá, komunita aj tvoj osobný profil, všetko na jednom mieste.</p>
        <p>A pretože ťa máme radi: keď si <b>vytvoríš vlastný účet</b>, dostaneš <b>ďalšiu hodinu úplne ZADARMO</b> 🎁 (navyše k tvojej prvej hodine zdarma).</p>
        <p>Stačí sa zaregistrovať e-mailom, ktorý už poznáme – a hneď môžeš rezervovať.</p>
        <p>Tešíme sa na teba na parkete! 💛<br><i>Tím Fusion Academy</i></p>`,
      cta:'✨ Vytvoriť účet a získať hodinu zdarma', cta_url:`${APP2}/`, created_at:nowISO() });
    console.log('✅  app_launch email krok pridaný');
  }

  // Idempotentne: WINBACK sekvencia pre odídených klientov (nurture na návrat + zľavy)
  if(await q.count(db.email_steps,{sequence:'winback'})===0){
    const BLOGW='https://latindancefusion.art/blog';
    await q.insert(db.email_steps,[
      { sequence:'winback', day:0, label:'Chýbaš nám', active:true,
        subject:'{meno}, chýbaš nám na parkete 🥺',
        body:`<p>Ahoj <b>{meno}</b>,</p><p>všimli sme si, že sme ťa už nejaký čas nevideli — a úprimne, <b>chýbaš nám</b>. 💛</p><p>Parket, hudba, partia báb, ktoré ťa vždy privítajú… to všetko na teba čaká presne tak, ako si to nechala.</p><p>Nič nemusíš doháňať. Stačí prísť a roztancovať sa. Kedy sa uvidíme?</p>`,
        cta:'🗓️ Pozrieť rozvrh', cta_url:`${APP2}/schedule`, created_at:nowISO() },
      { sequence:'winback', day:4, label:'Hodina zadarmo na návrat', active:true,
        subject:'🎁 Pripravili sme pre teba hodinu ZADARMO',
        body:`<p>Ahoj <b>{meno}</b>,</p><p>aby bol ten prvý krok späť čo najľahší, dávame ti <b>jednu hodinu úplne zadarmo</b> — bez záväzku. 🎶</p><p>Príď si len tak zatancovať, pripomenúť si ten pocit. Zvyšok už príde sám.</p><p>Vidíme sa? 💃</p>`,
        cta:'🎁 Rezervovať hodinu zdarma', cta_url:`${APP2}/schedule`, created_at:nowISO() },
      { sequence:'winback', day:11, label:'Zľava 30% na návrat', active:true,
        subject:'{meno}, vitaj späť — 30% zľava na prvý mesiac 💛',
        body:`<p>Ahoj <b>{meno}</b>,</p><p>ak sa chceš vrátiť naplno, máme pre teba darček: <b>30% zľavu na prvý mesiac členstva</b> pri návrate.</p><div style="text-align:center;margin:14px 0"><div style="display:inline-block;font-family:monospace;font-weight:800;letter-spacing:1px;background:#0d0d0d;border:1px dashed #C9A84C;color:#E7C878;border-radius:10px;padding:12px 22px;font-size:1.2rem">VITAJSPAT</div></div><p>Zadáš ho pri kúpe členstva. Beátka sa tiež raz vrátila — a dnes je o 17 kg ľahšia. Všetko sa začína jedným krokom späť.</p><p><a href="${BLOGW}/metabolicka-analyza-fit-premena">📖 Ako vyzerá skutočná premena →</a></p>`,
        cta:'💳 Vrátiť sa so zľavou', cta_url:`${APP2}/pricing`, created_at:nowISO() },
      { sequence:'winback', day:25, label:'Posledná pripomienka', active:true,
        subject:'Posledná pripomienka: tvoje miesto na parkete stále čaká 💃',
        body:`<p>Ahoj <b>{meno}</b>,</p><p>nechceme byť dotieraví — len ti chceme povedať, že <b>dvere sú stále otvorené</b> a tvoja komunita ťa privíta s otvorenou náručou.</p><p>Zľava <b>VITAJSPAT (30%)</b> na prvý mesiac stále platí. Keď budeš pripravená, sme tu. 💛</p>`,
        cta:'🗓️ Vrátiť sa', cta_url:`${APP2}/schedule`, created_at:nowISO() },
    ]);
    console.log('✅  winback sekvencia pridaná (4 kroky)');
  }
  // Promo kód pre návrat odídených klientov (30% na prvý mesiac)
  if(!await q.one(db.promo_codes,{code:'VITAJSPAT'})){
    await q.insert(db.promo_codes,{ code:'VITAJSPAT', type:'percent', value:30, applies_to:'membership',
      max_uses:0, once_per_user:true, min_amount:0, active:true, used_count:0,
      note:'Návrat odídeného klienta – 30% na prvý mesiac', created_at:nowISO() });
  }
  // Idempotentne: predvolené ceny za klientku mesiaca/roka
  if(!await q.one(db.settings,{key:'rewards'})){
    await q.insert(db.settings,{ key:'rewards', value:{
      year_end:'31.12.2026',
      disclaimer:'Odmeny sa môžu v priebehu roka meniť.',
      month_prizes:[
        '🎓 Súkromná hodina s Marekom Gruberom zdarma',
        '🥈 Mesiac členstva Silver zdarma',
        '🏆 Zvýraznenie na nástenke a Instagrame Fusion Academy',
        '🎁 Zľava 20% na ďalší nákup v e-shope',
      ],
      year_prizes:[
        '👑 Titul „Ambasádorka 2026" s diplomom a pohárom',
        '👕 Tričko Ambasádorky 2026',
        '🥇 Ročné členstvo Gold zdarma',
        '🎓 Súkromná hodina s Marekom Gruberom',
        '🌟 Trvalé miesto v Sieni slávy Fusion Academy',
      ],
    }, created_at:nowISO() });
    console.log('✅  Predvolené ceny (klientka mesiaca/roka) nastavené');
  }

  // Idempotentne: upsell sekvencia Bronze → Silver (metabolická analýza tela)
  if(await q.count(db.email_steps,{sequence:'bronze_upsell'})===0){
    const bu = (day,label,subject,body,cta)=>({sequence:'bronze_upsell',day,label,active:true,subject,body,cta:cta||null,cta_url:`${APP_URL}/pricing`,created_at:nowISO()});
    const steps = [
      bu(0,'Váha klame','Tvoja váha ti klame (a je to dokázateľné)',
        `<p>Ahoj {meno},</p><p>povieme ti tajomstvo, ktoré ti žiadna váha v kúpeľni nepovie:</p><p><b>Číslo na váhe je jedno z najhorších meradiel toho, ako ti to ide.</b></p><p>Môžeš schudnúť 3 kilá a vyzerať <i>horšie</i> — stačí stratiť sval a vodu. A môžeš mať rovnakú váhu tri mesiace a pritom sa úplne zmeniť.</p><p>Váha nevie rozlíšiť tuk od svalu. Ty áno. A <b>my ti to vieme ukázať čierne na bielom.</b></p><p>Zajtra ti napíšeme príbeh baby, ktorá „neschudla ani deko" — a aj tak vyhrala. 💃</p>`),
      bu(3,'Príbeh','Schudla 0 kg. A predsa to bola výhra.',
        `<p>{meno}, sľúbili sme príbeh — tu je.</p><p>Baba chodila 8 týždňov na Zumbu. Postavila sa na váhu: <b>rovnaké číslo ako na začiatku.</b> Sklamanie, však?</p><p>Lenže <b>analýza zloženia tela</b> ukázala toto:</p><ul><li>🔥 <b>−4 kg tuku</b></li><li>💪 <b>+4 kg svalu</b></li></ul><p>Rovnaká váha. Úplne iné telo — pevnejšie, silnejšie, s rýchlejším metabolizmom, čo páli kalórie aj na gauči.</p><p>Keby verila len váhe, možno to vzdá. <b>Namiesto toho videla pravdu — a pokračovala.</b></p>`),
      bu(7,'Čo ukáže analýza','Čo ti povie analýza, čo zrkadlo zatají',
        `<p>{meno}, zrkadlo ti ukáže <i>ako vyzeráš</i>. Analýza tela ti ukáže <b>prečo</b> — a čo s tým.</p><p>Za pár sekúnd zistíš:</p><ul><li>📉 <b>% telesného tuku</b> — koľko ho reálne páliš</li><li>💪 <b>svalovú hmotu</b> — či cvičíš správne</li><li>⚡ <b>metabolizmus</b> — koľko kalórií spáliš aj v pokoji</li><li>💧 <b>hydratáciu</b> a <b>viscerálny tuk</b> (ten najnebezpečnejší, okolo orgánov)</li></ul><p>A najlepšie? <b>Máš to celé v mobile.</b> Týždeň po týždni vidíš, ako sa krivka hýbe — žiadne hádanie „funguje to alebo nie".</p>`),
      bu(12,'Prestaň hádať','Prestaň hádať. Začni vidieť.',
        `<p>{meno}, otázka na telo:</p><p>Cvičíš, snažíš sa… ale <b>vieš, či ideš správnym smerom?</b> Alebo len dúfaš?</p><p>Rozdiel medzi tými, ktorým to vyjde, a tými, čo to po dvoch mesiacoch vzdajú, nie sú gény. Je to <b>spätná väzba.</b></p><p>Keď vidíš, že tuk týždeň po týždni klesá a sval rastie, <b>chce sa ti pokračovať.</b></p><p>Členstvo <b>Silver</b> ti dáva presne toto — <b>pravidelnú metabolickú analýzu tela, ktorú sleduješ v telefóne.</b> Je to rozdiel medzi cvičením naslepo a cvičením s mapou. 🗺️</p>`),
      bu(18,'Pozvánka','Tvoja prvá analýza čaká 💛',
        `<p>{meno}, nebudeme ťa presviedčať. Len ťa pozveme.</p><p>Ak ťa už niekedy napadlo <i>„robím to vôbec správne?"</i> — <b>Silver je odpoveď.</b> Zumba, ktorú miluješ, <b>plus</b> pravidelná analýza tela, vďaka ktorej presne vidíš, ako sa meníš.</p><p>Predstav si ten pocit o mesiac: otvoríš appku a vidíš svoju krivku ísť správnym smerom. <b>To je motivácia, ktorá vydrží.</b></p><p>Prejdi na Silver a <b>tvoja prvá metabolická analýza je pripravená.</b> Uvidíme sa na parkete — aj v grafoch. 💃📈</p>`,
        'Prejsť na Silver 📈'),
    ];
    for(const s of steps) await q.insert(db.email_steps, s);
    console.log('✅  bronze_upsell sekvencia pridaná');
  }

  // Migrácia bronze_upsell: meno „Miška zo Zvolena" v príbehu + emaily o online hodinách
  await q.update(db.email_steps,{sequence:'bronze_upsell',day:3},{$set:{body:
    `<p>{meno}, sľúbili sme príbeh — tu je.</p><p><b>Miška zo Zvolena</b> chodila 8 týždňov na Zumbu. Postavila sa na váhu: <b>rovnaké číslo ako na začiatku.</b> Sklamanie, však?</p><p>Lenže <b>analýza zloženia tela</b> ukázala toto:</p><ul><li>🔥 <b>−4 kg tuku</b></li><li>💪 <b>+4 kg svalu</b></li></ul><p>Rovnaká váha. Úplne iné telo — pevnejšie, silnejšie, s rýchlejším metabolizmom, čo páli kalórie aj na gauči.</p><p>Keby Miška verila len váhe, možno to vzdá. <b>Namiesto toho videla pravdu — a pokračovala.</b></p>`}},{multi:true});
  const buOnline=(day,label,subject,body,cta)=>({sequence:'bronze_upsell',day,label,active:true,subject,body,cta:cta||null,cta_url:`${APP_URL}/pricing`,created_at:nowISO()});
  if(!(await q.one(db.email_steps,{sequence:'bronze_upsell',day:9}))) await q.insert(db.email_steps, buOnline(9,'Online hodiny','Aj v pyžame. Aj o 22:00. Zumba, keď sa ti hodí. 🛋️',
    `<p>{meno}, ešte jedna vec, ktorú Bronze nemá a Silver áno:</p><p><b>Online hodiny.</b> 💻</p><p>Dážď? Choré dieťa? Dlho v práci? Namiesto vynechanej hodiny <b>zapneš appku a tancuješ z obývačky</b> — kedy sa ti hodí, aj o desiatej večer v pyžame.</p><p>Žiadna vynechaná hodina = žiadny výpadok v progrese. Cvičíš vtedy, keď <i>ty</i> môžeš, nie keď „to vyšlo".</p>`));
  if(!(await q.one(db.email_steps,{sequence:'bronze_upsell',day:15}))) await q.insert(db.email_steps, buOnline(15,'Konzistencia','Tajomstvo tých, čo to nevzdajú? Nevynechávajú.',
    `<p>{meno}, najväčší zabijak výsledkov nie je zlý tréning. Je to <b>vynechaný tréning.</b></p><p>So <b>Silver</b> máš online hodiny stále po ruke — aj na dovolenke, aj keď je vonku −10 °C a nechce sa ti nikam.</p><p>Štúdio, keď môžeš prísť. Online, keď nie. Výsledok? <b>Konzistencia</b> — presne tá, čo robí skutočné premeny.</p><p>Plus tá metabolická analýza tela, o ktorej sme písali. Silver = vidíš pokrok <i>a</i> nikdy nevypadneš z rytmu.</p>`));

  // Idempotentne: upsell sekvencia Silver → Gold (Herbalife F1 raňajková zložka)
  if(await q.count(db.email_steps,{sequence:'gold_upsell'})===0){
    const gu=(day,label,subject,body,cta)=>({sequence:'gold_upsell',day,label,active:true,subject,body,cta:cta||null,cta_url:`${APP_URL}/pricing`,created_at:nowISO()});
    const gsteps=[
      gu(0,'Slabý článok','Cvičíš 3× do týždňa. A raňajkuješ rožok s párkom? 🌭',
        `<p>Ahoj {meno},</p><p>otázka na rovinu: dávaš do tréningu všetko — a potom raňajkuješ <b>rožok, párok a kávu s cukrom?</b></p><p>Vieš, čo hovoria tréneri? <b>„Brušáky sa robia v kuchyni."</b> Až 80 % výsledku je o tom, čím telo kŕmiš — nie o tom, koľko drepov spravíš.</p><p>Najslabší článok väčšiny ľudí nie je tréning. Sú to <b>raňajky.</b> A práve tie vieme spraviť tvojou najsilnejšou zbraňou.</p><p>Zajtra ti ukážeme, že zdravé ráno je aj <i>lacnejšie</i> ako to párkové. 👀</p>`),
      gu(4,'Cena','Koľko stojí tvoje zdravé ráno? Menej ako párky.',
        `<p>{meno}, poďme počítať.</p><p>Bežné „rýchle" raňajky — rožky, párky, nátierka, sladká káva — ťa vyjdú na pár eur denne. A čo za to telo dostane? Prázdne kalórie, cukor, soľ. Za hodinu si zas hladná.</p><p>Porcia <b>Herbalife Formula 1</b> — kompletnej náhrady stravy — ťa denne stojí <b>menej</b>, a telo dostane úplne iný svet:</p><ul><li>✅ nízke kalórie</li><li>✅ vyvážené makrá (bielkoviny, sacharidy, tuky v správnom pomere)</li><li>✅ <b>23 vitamínov a minerálov</b></li></ul><p>Lacnejšie ako párky. A neporovnateľne výživnejšie. 🥤</p>`),
      gu(9,'Prečo Herbalife','Prečo Herbalife? Lebo čísla nepustia.',
        `<p>{meno}, <b>Herbalife</b> nie je náhoda — je to <b>svetová jednotka v nutričných doplnkoch</b>, s desiatkami rokov výskumu za sebou.</p><p><b>Formula 1</b> je náhrada jedla navrhnutá tak, aby ti dala kompletnú výživu v jednej porcii — bez zbytočných kalórií. Presne to, čo tvoje telo potrebuje, keď na sebe pracuješ na parkete.</p><p>Tréning telo <b>rozhýbe.</b> Správna výživa ho <b>postaví.</b> Bez druhého to prvé nikdy nedotiahne naplno.</p>`),
      gu(14,'Kompletný systém','Gold = tvoj kompletný systém premeny 🏆',
        `<p>{meno}, poskladajme to dokopy.</p><p>Predstav si to ako stavbu tela:</p><ul><li>💃 <b>Zumba + online hodiny</b> — spaľuješ, budeš silnejšia</li><li>📈 <b>Metabolická analýza</b> — vidíš, čo sa reálne deje</li><li>🥤 <b>Herbalife F1 raňajky</b> — palivo, ktoré to celé posúva</li></ul><p>To všetko je <b>Gold.</b> Kompletný systém, kde jedno ťahá druhé. Nie hádanie — jasný plán od tréningu cez meranie až po výživu.</p>`),
      gu(20,'Pozvánka','Postav si telo od základov 💛',
        `<p>{meno}, cvičíš. Vidíš svoj pokrok v analýze. Ostáva posledný kúsok skladačky — <b>výživa, ktorá to celé drží pohromade.</b></p><p>S <b>Gold</b> máš všetko na jednom mieste: hodiny, online, analýzu tela aj <b>Herbalife F1 raňajky</b> — kompletnú výživu za menej, než stojí to párkové ráno.</p><p>Doprej svojmu telu palivo, aké si zaslúži. Uvidíme sa na parkete — a tvoje výsledky ťa prekvapia. 💪</p>`,
        'Prejsť na Gold 🏆'),
    ];
    for(const s of gsteps) await q.insert(db.email_steps, s);
    console.log('✅  gold_upsell sekvencia pridaná');
  }

  // Idempotentne: promo kód „prvý mesiac Silver za cenu Bronzu" (25 € zľava, 1×/klient)
  if(!(await q.one(db.promo_codes,{code:'PRVYMESIAC'}))){
    await q.insert(db.promo_codes,{ code:'PRVYMESIAC', type:'fixed', value:25, applies_to:'membership',
      max_uses:0, once_per_user:true, min_amount:0, expires_at:null, active:true, used_count:0,
      note:'Prvý mesiac Silver za cenu Bronzu', created_at:nowISO() });
    console.log('✅  promo PRVYMESIAC pridané');
  }

  // ── Zosúladenie obsahu upsell sekvencií s blogom (reálne čísla, citáty, odkazy) ──
  const BLOG='https://latindancefusion.art/blog';
  const up=(seq,day,fields)=>q.update(db.email_steps,{sequence:seq,day},{$set:fields},{multi:true});
  // welcome — už nemáme „Fit Premena" (nahradené súkromnou hodinou), BB → Banská Bystrica
  await up('welcome',0,{ body:`<p>Sme nadšení, že si tu!</p><p>Vo Fusion Academy ťa čaká:</p><ul><li>💃 Zumba, spoločenské tance, súkromné hodiny</li><li>📍 4 mestá: Detva, Zvolen, Banská Bystrica, Brezno</li><li>👥 Komunita stoviek spokojných klientok</li></ul><p>Ako začať? <b>Prvá hodina je ZADARMO</b> — bez záväzku, bez platby.</p>` });
  await up('welcome',3,{ body:`<p>Nevieš, čia hodina je pre teba? Poradíme!</p><ul><li><b>Zumba</b> – chudnutie, energia, zábava. Ideálne pre začiatočníkov.</li><li><b>Spoločenské tance</b> – elegancia, plesová príprava, páry aj jednotlivci.</li><li><b>Súkromná hodina</b> – individuálny tréning jeden na jedného, tempo aj zameranie podľa teba.</li></ul><p>Zapíš sa na tú, čo ťa zaujíma – <b>prvá je zadarmo</b>.</p>` });
  // bronze day3 — bez konfliktu s reálnou Miškou (tá je F1 príbeh), + odkaz na článok
  await up('bronze_upsell',3,{ body:`<p>{meno}, sľúbili sme príbeh — tu je.</p><p>Jedna z našich báb chodila 8 týždňov na Zumbu. Postavila sa na váhu: <b>rovnaké číslo ako na začiatku.</b> Sklamanie, však?</p><p>Lenže <b>analýza zloženia tela</b> ukázala pravdu: <b>tuku ubudlo, svalu pribudlo.</b> Rovnaká váha — úplne iné telo. Pevnejšie, silnejšie, s rýchlejším metabolizmom, čo páli kalórie aj na gauči.</p><p>Keby verila len váhe, možno to vzdá. <b>Namiesto toho videla pravdu — a pokračovala.</b></p><p><a href="${BLOG}/metabolicka-analyza-fit-premena">📖 Čo všetko ti analýza prezradí →</a></p>` });
  await up('bronze_upsell',7,{ body:`<p>{meno}, zrkadlo ti ukáže <i>ako vyzeráš</i>. Analýza tela ti ukáže <b>prečo</b> — a čo s tým.</p><p>Za pár sekúnd zistíš:</p><ul><li>📉 <b>% telesného tuku</b> a <b>bazálny metabolizmus</b> — koľko kalórií reálne potrebuješ</li><li>💪 <b>svalovú hmotu</b> — či cvičíš správne</li><li>💧 <b>hydratáciu</b> a <b>viscerálny tuk</b> (ten najnebezpečnejší, okolo orgánov)</li></ul><p>A najlepšie? <b>Máš to celé v mobile</b>, týždeň po týždni. Žiadne hádanie „funguje to alebo nie".</p><p><a href="${BLOG}/metabolicka-analyza-fit-premena">📖 Metabolická analýza — čo o tebe prezradí →</a></p>` });
  // gold — reálne fakty a citát z blogu
  await up('gold_upsell',4,{ subject:'Cvičíš naplno — a jedlo necháš na náhodu?', body:`<p>{meno}, otázka na rovinu: dávaš do tréningu všetko — a potom <b>hádaš, čo a koľko jesť?</b></p><p>Tréneri to hovoria jasne: <b>„Brušáky sa robia v kuchyni."</b> Až 80 % výsledku je o strave, nie o počte drepov.</p><p>V <b>Gold</b> to už nemusíš riešiť. Máš <b>jedálniček na mieru na celý týždeň</b> — podľa tvojich údajov, chutí, alergénov a cieľa. Žiadne hádanie, len sa najesť a tancovať.</p><p><a href="${BLOG}/jedalnicek-na-mieru-zadarmo">📖 Ako funguje jedálniček na mieru →</a></p>` });
  await up('gold_upsell',9,{ subject:'Vidíš, čo sa v tvojom tele reálne deje?', body:`<p>{meno}, zrkadlo ti ukáže <i>ako vyzeráš</i>. <b>Metabolická analýza</b> ti ukáže <b>prečo</b> — a čo s tým.</p><p>Za pár sekúnd zistíš % telesného tuku, svalovú hmotu, bazálny metabolizmus aj viscerálny tuk. A jedálniček sa tomu prispôsobí.</p><p>V <b>Gold</b> máš analýzu aj jedálniček pod jednou strechou — vidíš pokrok a presne vieš, čo ďalej.</p><p><a href="${BLOG}/metabolicka-analyza-fit-premena">📖 Čo všetko ti analýza prezradí →</a></p>` });
  await up('gold_upsell',14,{ subject:'Gold = tvoj kompletný systém premeny 🏆', body:`<p>{meno}, poskladajme to dokopy. Predstav si to ako stavbu tela:</p><ul><li>💃 <b>Neobmedzené tréningy + online hodiny</b> — spaľuješ, silnieš</li><li>📈 <b>Metabolická analýza</b> — vidíš, čo sa reálne deje</li><li>🍽️ <b>Jedálniček na mieru na celý týždeň</b> — presné porcie podľa tvojho metabolizmu</li></ul><p>To všetko je <b>Gold</b> (125 €/mes). Kompletný systém, kde jedno ťahá druhé — nie hádanie, ale jasný plán.</p><p><a href="${BLOG}/jedalnicek-na-mieru-zadarmo">📖 Vyskúšaj si 7-dňový jedálniček zadarmo →</a></p>` });
  await up('gold_upsell',20,{ subject:'Postav si telo od základov 💛', body:`<p>{meno}, cvičíš. Ostáva posledný kúsok skladačky — <b>strava, ktorá to celé drží pohromade.</b></p><p>S <b>Gold</b> máš všetko na jednom mieste: neobmedzené hodiny, online, metabolickú analýzu aj <b>jedálniček na mieru na celý týždeň</b>. Nič nemusíš vymýšľať — len sa najesť a tancovať.</p><p>Doprej svojmu telu jasný plán. Uvidíme sa na parkete — a tvoje výsledky ťa prekvapia. 💪</p>` });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/login', async(req,res)=>{
  try {
    const {email,password}=req.body;
    const u=await q.one(db.users,{email:(email||'').toLowerCase().trim()});
    if(u && !u.password && u.pw_reset) return res.status(401).json({error:'Vaše heslo bolo resetované správcom. Vytvorte si nové heslo nižšie.', pw_reset:true});
    if(!u||!u.password||!(await bcrypt.compare(password,u.password))) return res.status(401).json({error:'Nesprávny email alebo heslo'});
    if(u.active===false) return res.status(403).json({error:'Váš účet je zablokovaný. Kontaktujte správcu.'});
    req.session.uid=u._id;
    req.session.sv=u.sess_ver||0;
    const redirect_to = dashUrlFor(u);
    res.json({ok:true, isAdmin:!!u.is_admin, userType:u.user_type||'partner', redirect_to});
  } catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/logout',(req,res)=>{ req.session.destroy(); res.json({ok:true}); });

// Klient si po admin resete vytvorí nové heslo (bez starého). Funguje len ak má nastavený pw_reset.
app.post('/api/set-new-password', async(req,res)=>{
  try {
    const {email,password}=req.body;
    if(!password || password.length<6) return res.status(400).json({error:'Heslo musí mať aspoň 6 znakov'});
    const u=await q.one(db.users,{email:(email||'').toLowerCase().trim()});
    if(!u || !u.pw_reset) return res.status(400).json({error:'Pre tento email nie je vyžiadaný reset hesla. Skús sa prihlásiť alebo zaregistrovať.'});
    if(u.active===false) return res.status(403).json({error:'Váš účet je zablokovaný. Kontaktujte správcu.'});
    await q.update(db.users,{_id:u._id},{$set:{password:await bcrypt.hash(password,10), pw_reset:false}});
    req.session.uid=u._id;
    req.session.sv=(u.sess_ver||0);
    res.json({ok:true, redirect_to:dashUrlFor(u)});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Pri registrácii: zisti, či daný email už evidujeme (importovaný z Glofoxu, ešte bez hesla),
// aby sme jej ukázali „už ťa máme, stačí nastaviť heslo" + čo na ňu čaká (vstupy / členstvo).
app.get('/api/check-registration', async(req,res)=>{
  try {
    const email=(req.query.email||'').toLowerCase().trim();
    if(!email || !/@/.test(email)) return res.json({pending:false});
    const u=await q.one(db.users,{email});
    // Účet, ktorý si ešte nenastavil heslo (importovaný lead/člen alebo po admin resete)
    const pending = u && !u.password && (u.imported || u.pw_reset);
    if(!pending) return res.json({pending:false});
    const m = await checkMembership(u._id);
    res.json({
      pending:true,
      name:u.name||'',
      entries: u.single_entries||0,
      membership: m ? {plan_name:m.plan_name||'Členstvo', expires_at:m.expires_at} : null,
      reset: !!u.pw_reset && !u.imported
    });
  } catch(e){ res.json({pending:false}); }
});

app.post('/api/register', async(req,res)=>{
  try {
    const {name,email,password,phone,sponsorCode,user_type}=req.body;
    if(!name||!email||!password) return res.status(400).json({error:'Meno, email a heslo sú povinné'});
    const emailNorm=(email||'').toLowerCase().trim();
    // ── Existujúci e-mail? Ak je to importovaný lead bez účtu, „claimni" ho ───────
    const existing=await q.one(db.users,{email:emailNorm});
    if(existing){
      if(!existing.password && ((existing.imported && !existing.claimed) || existing.pw_reset)){
        const set={ password:await bcrypt.hash(password,10), claimed:true, pw_reset:false,
          name: (name||existing.name), phone: (phone||existing.phone||''),
          consent_at: req.body.consent ? nowISO() : existing.consent_at,
          free_credits: (existing.free_credits||0)+1 }; // hodina zdarma navyše za vytvorenie účtu
        await q.update(db.users,{_id:existing._id},{$set:set});
        req.session.uid=existing._id;
        req.session.sv=existing.sess_ver||0;
        cancelSequence(existing._id,'app_launch').catch(()=>{});
        // upozorni adminov o novej registrácii
        try { const admins=await q.find(db.users,{is_admin:true});
          for(const a of admins) await q.insert(db.notifications,{user_id:a._id,type:'new_lead',
            title:'🆕 Importovaný lead si vytvoril účet',
            body:`${set.name} · ${emailNorm}`, read:false, created_at:nowISO()}); } catch(e){}
        return res.json({ ok:true, id:existing._id, claimed:true, free_bonus:true, redirect_to:'/client-dashboard' });
      }
      return res.status(400).json({error:'Tento e-mail je už zaregistrovaný. Skús sa prihlásiť.'});
    }
    let sponsor_id=null;
    if(sponsorCode&&sponsorCode.toUpperCase()!=='ADMIN'){
      const sp=await q.one(db.users,{referral_code:new RegExp('^'+sponsorCode+'$','i')});
      if(!sp) return res.status(400).json({error:'Referral kód neexistuje'});
      sponsor_id=sp._id;
    }
    // No sponsor → assign the founder (Marek Gruber) as default sponsor,
    // so every member always sits under someone in the structure.
    if(!sponsor_id){
      const founder=await q.one(db.users,{email:'gruber.marek@gmail.com'});
      if(founder && founder.email!==email.toLowerCase().trim()) sponsor_id=founder._id;
    }
    const base=name.split(' ')[0].toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
    let code=base+Math.floor(10+Math.random()*90);
    while(await q.one(db.users,{referral_code:code})) code=base+Math.floor(100+Math.random()*900);
    // New self-registrations start as a LEAD (admins call/nurture them) and are
    // auto-promoted to 'client' on their first paid purchase. Explicit staff
    // roles (trainer/partner/manager/admin) passed via API are kept as given.
    const utype = (user_type && !['client','lead'].includes(user_type)) ? user_type : 'lead';
    // ── Marketing attribution (first-touch, captured client-side) ─────────────
    const attr = req.body.attribution||{};
    const clean = v => String(v||'').slice(0,200);
    const utm_source=clean(attr.utm_source), utm_medium=clean(attr.utm_medium), utm_campaign=clean(attr.utm_campaign);
    const fbclid=clean(attr.fbclid), gclid=clean(attr.gclid);
    let lead_source = req.body.lead_source||'';
    if(!lead_source){
      if(gclid) lead_source='google';
      else if(fbclid) lead_source='meta';
      else if(utm_source) lead_source=utm_source.toLowerCase();
      else if(sponsor_id) lead_source='referral';
    }
    const u=await q.insert(db.users,{name,email:email.toLowerCase().trim(),password:await bcrypt.hash(password,10),phone:phone||'',referral_code:code,sponsor_id,rank:1,is_admin:false,active:true,user_type:utype,bank_account:'',notes:'',visit_count:0,referral_credit:0,lead_source,utm_source,utm_medium,utm_campaign,fbclid,gclid,landing_page:clean(attr.landing),referrer:clean(attr.referrer),consent_at: req.body.consent ? nowISO() : null,created_at:today()});
    req.session.uid=u._id;
    req.session.sv=0;
    // ── Give sponzor referral credit (5€ za každého nového člena) ─────────────
    if(sponsor_id){
      const REFERRAL_SIGNUP_CREDIT = 5; // € za registráciu
      const sp = await q.one(db.users,{_id:sponsor_id});
      if(sp){
        const newCredit = +((sp.referral_credit||0) + REFERRAL_SIGNUP_CREDIT).toFixed(2);
        await q.update(db.users,{_id:sponsor_id},{$set:{referral_credit: newCredit}});
        await q.insert(db.notifications,{user_id:sponsor_id,type:'referral_credit',title:`+${REFERRAL_SIGNUP_CREDIT} € referral kredit! 🎉`,body:`${name} sa zaregistroval/a cez tvoj link. Zostatok: ${newCredit} €`,read:false,created_at:nowISO()});
      }
      // Structure-growth notification for everyone higher up the chain (beyond the direct sponsor)
      const ancestors = await getAllAncestors(sponsor_id); // sponsor's own upline
      for(const aid of ancestors){
        const total = await downlineCountOf(aid);
        await q.insert(db.notifications,{user_id:aid, type:'structure_growth',
          title:'📈 Tvoja štruktúra narástla!',
          body:`${name} sa pridal/a do tvojej štruktúry. Spolu máš už ${total} ľudí pod sebou.`,
          read:false, created_at:nowISO()}).catch(()=>{});
      }
    }
    // Notify all admins about the new lead (in-app + email) so they can call/nurture
    if(utype==='lead'){
      const sponsorName = sponsor_id ? (await q.one(db.users,{_id:sponsor_id}))?.name : null;
      const src = lead_source ? ` · zdroj: ${lead_source}` : '';
      const admins = await q.find(db.users,{is_admin:true});
      for(const a of admins){
        await q.insert(db.notifications,{user_id:a._id, type:'new_lead',
          title:'🆕 Nová registrácia – lead',
          body:`${name} · ${email}${phone?' · '+phone:''}${sponsorName?' · sponzor: '+sponsorName:''}${src}`,
          read:false, created_at:nowISO()});
        if(a.email && !a.email.includes('@internal.local'))
          sendMail(a.email, `🆕 Nový lead: ${name}`,
            emailTemplate('Nová registrácia – lead 📞',
              `<p>Práve sa zaregistroval nový lead:</p>
               <ul style="color:#ccc">
                 <li><b>${name}</b></li>
                 <li>✉️ ${email}</li>
                 ${phone?`<li>📞 ${phone}</li>`:''}
                 ${sponsorName?`<li>👤 Sponzor: ${sponsorName}</li>`:''}
                 ${lead_source?`<li>📍 Zdroj: ${lead_source}</li>`:''}
               </ul>
               <p>Ozvi sa mu čo najskôr a zapíš si poznámky v CRM. 💪</p>`,
              '📋 Otvoriť CRM', `${APP_URL}/admin`)).catch(()=>{});
      }
    }
    // Email automation: enqueue welcome + lead_nurture sequences
    enqueueSequence(u._id, 'welcome').then(()=>processEmailQueue()).catch(()=>{});
    enqueueSequence(u._id, 'lead_nurture').catch(()=>{});
    // Server-side conversion tracking
    metaCapi('CompleteRegistration',{email:u.email, fbclid, fbp:clean(attr.fbp)}).catch(()=>{});
    res.json({ok:true, userType:utype, redirect_to: dashUrlFor(u)});
  } catch(e){
    if(e.message?.includes('unique')) return res.status(400).json({error:'Email je už zaregistrovaný'});
    res.status(500).json({error:e.message});
  }
});

// Public config (safe to expose)
app.get('/api/config', async(req,res)=>{
  const founder = await q.one(db.users,{email:'gruber.marek@gmail.com'});
  res.json({
    paypal_client_id: PAYPAL_CLIENT_ID||'sb', paypal_env: PAYPAL_ENV,
    stripe_enabled: !!process.env.STRIPE_SECRET_KEY,
    meta_pixel_id: process.env.META_PIXEL_ID||'',
    google_ads_id: process.env.GOOGLE_ADS_ID||'',
    default_sponsor_code: founder?.referral_code || ''
  });
});

// ─── Meta Conversions API (server-side events; needs META_PIXEL_ID + META_CAPI_TOKEN) ───
async function metaCapi(eventName, {email, value, currency='EUR', fbclid, fbp}={}){
  const pixel=process.env.META_PIXEL_ID, token=process.env.META_CAPI_TOKEN;
  if(!pixel||!token) return;
  try {
    const crypto=require('crypto');
    const h=s=>crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');
    const user_data={};
    if(email) user_data.em=[h(email)];
    if(fbclid) user_data.fbc=`fb.1.${Date.now()}.${fbclid}`;
    if(fbp) user_data.fbp=fbp;
    const r=await fetch(`https://graph.facebook.com/v21.0/${pixel}/events?access_token=${token}`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({data:[{
        event_name:eventName, event_time:Math.floor(Date.now()/1000),
        action_source:'website', user_data,
        ...(value?{custom_data:{value:+value, currency}}:{})
      }]})
    });
    if(!r.ok) console.error('Meta CAPI error:', (await r.text()).slice(0,300));
  } catch(e){ console.error('Meta CAPI error:', e.message); }
}
async function trackPurchase(userId, amount){
  try {
    const u = userId ? await q.one(db.users,{_id:userId}) : null;
    await metaCapi('Purchase',{email:u?.email, value:amount, fbclid:u?.fbclid, currency:'EUR'});
  } catch(e){}
}

// /api/me — full version with membership + notif_count is defined later in the file (line ~1501)

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC SHOP
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/shop/products', async(req,res)=>{
  const prods=await q.find(db.products,{active:true});
  prods.sort((a,b)=>a.cat?.localeCompare(b.cat)||a.name.localeCompare(b.name));
  res.json(prods);
});

app.post('/api/shop/order', async(req,res)=>{
  try {
    const {client_name,client_email,client_phone,referral_code,city,items,notes,payment_method,use_referral_credit}=req.body;
    if(!client_name||!client_email||!items?.length) return res.status(400).json({error:'Meno, email a košík sú povinné'});
    let partner_id=null, partner_name=null;
    if(referral_code?.trim()){
      const sp=await q.one(db.users,{referral_code:new RegExp('^'+referral_code.trim()+'$','i')});
      if(sp){partner_id=sp._id;partner_name=sp.name;}
    }
    const enriched=[]; let total=0;
    for(const item of items){
      const prod=await q.one(db.products,{_id:item.product_id});
      if(!prod) continue;
      const subtotal=+(prod.price*item.qty).toFixed(2);
      total+=subtotal;
      enriched.push({product_id:prod._id,product_name:prod.name,price:prod.price,qty:item.qty,subtotal,commission_rate:prod.commission_rate});
    }
    total=+total.toFixed(2);
    // ── Apply referral credit ─────────────────────────────────────────────────
    let creditUsed = 0;
    let finalTotal = total;
    if(use_referral_credit && req.session?.uid){
      const buyer = await q.one(db.users,{_id:req.session.uid});
      if(buyer && (buyer.referral_credit||0) > 0){
        creditUsed = Math.min(buyer.referral_credit, total);
        finalTotal = Math.max(0, +(total - creditUsed).toFixed(2));
        await q.update(db.users,{_id:buyer._id},{$set:{referral_credit:+((buyer.referral_credit)-creditUsed).toFixed(2)}});
        await q.insert(db.notifications,{user_id:buyer._id,type:'credit',title:`Referral kredit použitý v e-shope 🛍`,body:`Zľava ${creditUsed.toFixed(2)} € na objednávku. Nový zostatok: ${((buyer.referral_credit)-creditUsed).toFixed(2)} €`,read:false,created_at:nowISO()});
      }
    }
    const order_number='FA-'+new Date().getFullYear()+'-'+oid();
    const order=await q.insert(db.orders,{order_number,client_name,client_email:client_email.toLowerCase().trim(),client_phone:client_phone||'',referral_code:referral_code?.trim()||'',partner_id,partner_name,city:city||'',items:enriched,total:finalTotal,original_total:total,credit_used:creditUsed,notes:notes||'',payment_method:payment_method||'cash',status:'pending',created_at:nowISO(),paid_at:null});
    res.json({ok:true,order_number,id:order._id,total:finalTotal,original_total:total,credit_used:creditUsed});
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/shop/order/:num', async(req,res)=>{
  const order=await q.one(db.orders,{order_number:req.params.num});
  if(!order) return res.status(404).json({error:'Objednávka nenájdená'});
  res.json({order_number:order.order_number,client_name:order.client_name,items:order.items,total:order.total,status:order.status,created_at:order.created_at,city:order.city,payment_method:order.payment_method});
});

app.get('/api/shop/locations', (req,res)=>res.json(LOCATIONS));

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULE – PUBLIC
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/classes', async(req,res)=>{
  const classes=await q.find(db.classes,{active:true});
  // Attach booked count for each class
  const result=[];
  for(const c of classes){
    const booked=await q.count(db.bookings,{class_id:c._id,status:{$ne:'cancelled'}});
    result.push({...c, booked, spotsLeft:Math.max(0,c.capacity-booked), dayName:DAYS_SK[c.day_of_week]});
  }
  result.sort((a,b)=>a.day_of_week-b.day_of_week||a.time_start.localeCompare(b.time_start));
  res.json(result);
});

app.get('/api/classes/:id', async(req,res)=>{
  const c=await q.one(db.classes,{_id:req.params.id});
  if(!c) return res.status(404).json({error:'Hodina nenájdená'});
  const booked=await q.count(db.bookings,{class_id:c._id,status:{$ne:'cancelled'}});
  res.json({...c, booked, spotsLeft:Math.max(0,c.capacity-booked), dayName:DAYS_SK[c.day_of_week]});
});

// ─── Bookings ─────────────────────────────────────────────────────────────────
// (Full booking route with email confirmation is below in EMAIL NOTIFICATIONS section)

app.get('/api/my-bookings', auth, async(req,res)=>{
  // Own bookings + bookings for my children
  const children = await q.find(db.users,{parent_id:req.session.uid});
  const ids = [req.session.uid, ...children.map(c=>c._id)];
  const bookings=await q.find(db.bookings,{user_id:{$in:ids}},{booking_date:-1});
  res.json(bookings.slice(0,80));
});

// (booking cancel with waitlist promotion is handled below in WAITLIST section)

// ═══════════════════════════════════════════════════════════════════════════════
// COMMUNITY – REST (Socket.io handles realtime)
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/community/channels', (req,res)=>res.json(CHANNELS));

app.get('/api/community/messages/:channel', auth, async(req,res)=>{
  const {channel}=req.params;
  const msgs=await q.find(db.messages,{channel},{created_at:1});
  const last100=msgs.slice(-100);
  res.json(last100);
});

app.get('/api/community/members', auth, async(req,res)=>{
  const users=await q.find(db.users,{is_admin:{$ne:true},active:true,is_child:{$ne:true},$or:[{imported:{$ne:true}},{claimed:true}]});
  const result=users.map(u=>({
    id:u._id, name:u.name,
    user_type:u.user_type||'partner',
    rankBadge: RANKS[(u.rank||1)-1].badge,
    memberBadge: getMemberBadge(u.created_at),
    created_at: u.created_at,
  })).sort((a,b)=>a.name.localeCompare(b.name));
  res.json(result);
});

// Search people by name to add as friends (anonymous users are hidden)
app.get('/api/community/search', auth, async(req,res)=>{
  try {
    const me=req.session.uid;
    const s=(req.query.q||'').trim().toLowerCase();
    if(s.length<2) return res.json({people:[]});
    let users=await q.find(db.users,{is_admin:{$ne:true},active:true,is_child:{$ne:true},anonymous:{$ne:true},$or:[{imported:{$ne:true}},{claimed:true}]});
    users=users.filter(u=>u._id!==me && ((u.nickname||'').toLowerCase().includes(s) || (u.name||'').toLowerCase().includes(s)));
    users=users.slice(0,20);
    const people=await Promise.all(users.map(async u=>{
      const refCount=await downlineCountOf(u._id);
      const nb=referralBadge(refCount, u.gender==='male'?'male':'female');
      return { id:u._id, name:u.name, nickname:u.nickname||'', avatar:u.avatar||null,
        name_badge: nb?`${nb.emoji} ${nb.title}`:'',
        friend_state: await friendState(me, u._id) };
    }));
    res.json({people});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Private messages (1-on-1 DMs between members) ─────────────────────────────
const dmKey = (a,b) => 'dm_' + [String(a),String(b)].sort().join('_');

// List my conversations (other participant, last message, unread count)
app.get('/api/dm/conversations', auth, async(req,res)=>{
  const me = req.session.uid;
  const msgs = await q.find(db.messages, {is_dm:true, participants:me});
  const convs = {};
  for(const m of msgs){
    const other = m.from_id===me ? m.to_id : m.from_id;
    const c = convs[other] = convs[other] || {other_id:other, last_text:'', last_at:'', last_from:'', unread:0};
    if(!c.last_at || m.created_at>c.last_at){ c.last_at=m.created_at; c.last_text=m.text; c.last_from=m.from_id; }
    if(m.to_id===me && !m.read) c.unread++;
  }
  const users = Object.fromEntries((await q.find(db.users,{})).map(u=>[u._id,u]));
  const list = Object.values(convs).map(c=>({
    ...c, other_name: users[c.other_id]?.name||'Neznámy užívateľ',
    other_badge: getMemberBadge(users[c.other_id]?.created_at)
  })).sort((a,b)=>(b.last_at||'').localeCompare(a.last_at||''));
  res.json({conversations:list, unread_total:list.reduce((s,c)=>s+c.unread,0)});
});

// Message history with one user (marks incoming as read)
app.get('/api/dm/history/:userId', auth, async(req,res)=>{
  const me = req.session.uid, other = req.params.userId;
  if(other===me) return res.status(400).json({error:'Nemôžeš písať sám sebe'});
  const other_u = await q.one(db.users,{_id:other});
  if(!other_u) return res.status(404).json({error:'Užívateľ nenájdený'});
  const key = dmKey(me,other);
  const msgs = await q.find(db.messages,{is_dm:true, dm_key:key},{created_at:1});
  await q.update(db.messages,{is_dm:true,dm_key:key,to_id:me,read:{$ne:true}},{$set:{read:true}},{multi:true});
  res.json({ messages: msgs.slice(-100),
    other:{ id:other, name:other_u.name, badge:getMemberBadge(other_u.created_at) } });
});

// ── Community feed (nástenka): posts + reactions + comments ───────────────────
const FEED_EMOJIS = ['❤️','👏','🔥','💪','🎉'];
function feedView(p, meId, nameMap){
  const nm = id => (nameMap && nameMap[id]) || 'Člen';
  const reactions = p.reactions||{};
  const summary = FEED_EMOJIS.map(e=>{ const ids=reactions[e]||[];
    return { emoji:e, count:ids.length, mine:ids.includes(meId), likers: ids.map(id=>({id,name:nm(id)})) }; });
  const comments = (p.comments||[]).slice(-20).map(c=>({
    id:c.id||null, user_id:c.user_id, name:c.name, text:c.text, at:c.at,
    likes:(c.likes||[]).length, liked:(c.likes||[]).includes(meId),
    likers:(c.likes||[]).map(id=>({id,name:nm(id)}))
  }));
  return {
    id:p._id, author_id:p.author_id, author_name:p.author_name, author_badge:p.author_badge||null,
    text:p.text||'', image:p.image||null, created_at:p.created_at,
    reactions:summary,
    comments,
    comment_count:(p.comments||[]).length,
    can_delete: p.author_id===meId
  };
}
// Postaví mapu id→meno pre všetkých, čo reagovali/komentovali na dané príspevky
async function feedNameMap(posts){
  const ids=new Set();
  posts.forEach(p=>{ Object.values(p.reactions||{}).forEach(arr=>arr.forEach(id=>ids.add(id)));
    (p.comments||[]).forEach(c=>{ if(c.user_id) ids.add(c.user_id); (c.likes||[]).forEach(id=>ids.add(id)); }); });
  const map={};
  if(ids.size){ const us=await q.find(db.users,{_id:{$in:[...ids]}}); us.forEach(u=>map[u._id]=u.nickname||u.name); }
  return map;
}
app.get('/api/feed', auth, async(req,res)=>{
  const posts = (await q.find(db.feed,{})).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')).slice(0,50);
  const nameMap = await feedNameMap(posts);
  res.json(posts.map(p=>feedView(p, req.session.uid, nameMap)));
});
app.post('/api/feed', auth, async(req,res)=>{
  try {
    const text=(req.body.text||'').trim();
    let image=req.body.image||null;
    if(image){
      if(typeof image!=='string' || !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(image) || image.length>900000)
        return res.status(400).json({error:'Neplatný alebo príliš veľký obrázok'});
    }
    if(!text && !image) return res.status(400).json({error:'Prázdny príspevok'});
    if(text.length>2000) return res.status(400).json({error:'Text je príliš dlhý'});
    const u=await q.one(db.users,{_id:req.session.uid});
    const post=await q.insert(db.feed,{
      author_id:u._id, author_name:u.name, author_badge:getMemberBadge(u.created_at),
      text:text.slice(0,2000), image:image||null, reactions:{}, comments:[], created_at:nowISO()
    });
    const view=feedView(post, req.session.uid);
    io.emit('feed_new', view);
    res.json({ok:true, post:view});
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/feed/:id/react', auth, async(req,res)=>{
  try {
    const emoji=req.body.emoji;
    if(!FEED_EMOJIS.includes(emoji)) return res.status(400).json({error:'Neplatná reakcia'});
    const post=await q.one(db.feed,{_id:req.params.id});
    if(!post) return res.status(404).json({error:'Príspevok nenájdený'});
    const reactions=post.reactions||{};
    const arr=reactions[emoji]||[];
    const uid=req.session.uid;
    reactions[emoji] = arr.includes(uid) ? arr.filter(x=>x!==uid) : [...arr, uid];
    await q.update(db.feed,{_id:post._id},{$set:{reactions}});
    const updated=await q.one(db.feed,{_id:post._id});
    io.emit('feed_update', {id:post._id});
    res.json({ok:true, post:feedView(updated, uid, await feedNameMap([updated]))});
  } catch(e){ res.status(500).json({error:e.message}); }
});
// Lajk na komentár (+ kto lajkol)
app.post('/api/feed/:id/comments/:cid/like', auth, async(req,res)=>{
  try {
    const post=await q.one(db.feed,{_id:req.params.id});
    if(!post) return res.status(404).json({error:'Nenájdené'});
    const uid=req.session.uid;
    const comments=(post.comments||[]).map(c=>{
      if(c.id===req.params.cid){ const likes=c.likes||[]; c.likes = likes.includes(uid)?likes.filter(x=>x!==uid):[...likes,uid]; }
      return c;
    });
    await q.update(db.feed,{_id:post._id},{$set:{comments}});
    const updated=await q.one(db.feed,{_id:post._id});
    io.emit('feed_update', {id:post._id});
    res.json({ok:true, post:feedView(updated, uid, await feedNameMap([updated]))});
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/feed/:id/comment', auth, async(req,res)=>{
  try {
    const text=(req.body.text||'').trim();
    if(!text || text.length>500) return res.status(400).json({error:'Komentár je prázdny alebo pridlhý'});
    const post=await q.one(db.feed,{_id:req.params.id});
    if(!post) return res.status(404).json({error:'Príspevok nenájdený'});
    const u=await q.one(db.users,{_id:req.session.uid});
    const comment={id:'c'+Date.now().toString(36)+Math.floor(Math.random()*1000), user_id:u._id, name:u.name, text:text.slice(0,500), at:nowISO(), likes:[]};
    await q.update(db.feed,{_id:post._id},{$push:{comments:comment}});
    // notify post author about the comment (if someone else commented)
    if(post.author_id!==u._id){
      await q.insert(db.notifications,{user_id:post.author_id, type:'feed_comment',
        title:`💬 ${u.name} komentoval tvoj príspevok`, body:text.slice(0,80), read:false, created_at:nowISO()});
    }
    const updated=await q.one(db.feed,{_id:post._id});
    io.emit('feed_update', {id:post._id});
    res.json({ok:true, post:feedView(updated, u._id, await feedNameMap([updated]))});
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/feed/:id', auth, async(req,res)=>{
  const post=await q.one(db.feed,{_id:req.params.id});
  if(!post) return res.status(404).json({error:'Nenájdené'});
  const me=await q.one(db.users,{_id:req.session.uid});
  if(post.author_id!==req.session.uid && !me?.is_admin) return res.status(403).json({error:'Nemáš oprávnenie'});
  await q.remove(db.feed,{_id:post._id});
  io.emit('feed_delete', {id:post._id});
  res.json({ok:true});
});

// ── Achievements + public profiles + friends ──────────────────────────────────
// Achievement definitions: unlocked by visits, referrals or membership tenure.
const ACHIEVEMENTS = [
  // Návštevy
  {id:'v1',   cat:'visits', need:1,    icon:'✨', name:'Prvý tanec',    desc:'Prvá odchodená hodina'},
  {id:'v5',   cat:'visits', need:5,    icon:'👟', name:'Prvé kroky',    desc:'5 odchodených hodín'},
  {id:'v25',  cat:'visits', need:25,   icon:'💃', name:'Tanečnica',     name_m:'Tanečník', desc:'25 hodín'},
  {id:'v50',  cat:'visits', need:50,   icon:'🌟', name:'Vytrvalkyňa',   name_m:'Vytrvalec', desc:'50 hodín'},
  {id:'v75',  cat:'visits', need:75,   icon:'⭐', name:'Stálica',       desc:'75 hodín'},
  {id:'v150', cat:'visits', need:150,  icon:'🔥', name:'Vášeň',         desc:'150 hodín'},
  {id:'v350', cat:'visits', need:350,  icon:'🏆', name:'Šampiónka',     name_m:'Šampión', desc:'350 hodín'},
  {id:'v600', cat:'visits', need:600,  icon:'🦋', name:'Ikona',         desc:'600 hodín'},
  {id:'v1000',cat:'visits', need:1000, icon:'🌟', name:'Legenda',       desc:'1000 hodín'},
  // Mestá — prvá odchodená hodina v danom meste (zberateľské odznaky)
  {id:'city_detva',  cat:'city', city:'Detva',            icon:'🌲', name:'Detva',            desc:'Prvá hodina v Detve'},
  {id:'city_zvolen', cat:'city', city:'Zvolen',           icon:'🏰', name:'Zvolen',           desc:'Prvá hodina vo Zvolene'},
  {id:'city_bb',     cat:'city', city:'Banská Bystrica',  icon:'⛰️', name:'Banská Bystrica',  desc:'Prvá hodina v Banskej Bystrici'},
  {id:'city_brezno', cat:'city', city:'Brezno',           icon:'🏔️', name:'Brezno',           desc:'Prvá hodina v Brezne'},
  {id:'city_all',    cat:'city_all', icon:'🗺️', name:'Cestovateľka', name_m:'Cestovateľ', desc:'Odchodená hodina vo všetkých mestách'},
  // Privedení noví ľudia (referral)
  {id:'r1',   cat:'refs', need:1,   icon:'🤝', name:'Ambasádorka',         name_m:'Ambasádor', desc:'1 privedený člen'},
  {id:'r3',   cat:'refs', need:3,   icon:'🌱', name:'Rozsievačka radosti', name_m:'Rozsievač radosti', desc:'3 privedení členovia'},
  {id:'r5',   cat:'refs', need:5,   icon:'🌸', name:'Inšpirácia',          desc:'5 privedených členov'},
  {id:'r10',  cat:'refs', need:10,  icon:'💫', name:'Duša komunity',       desc:'10 privedených členov'},
  {id:'r20',  cat:'refs', need:20,  icon:'👑', name:'Srdce komunity',      desc:'20 privedených členov'},
  {id:'r30',  cat:'refs', need:30,  icon:'🌟', name:'Žiarivá hviezda',     desc:'30 privedených členov'},
  {id:'r50',  cat:'refs', need:50,  icon:'💎', name:'Klenot komunity',     desc:'50 privedených členov'},
  {id:'r75',  cat:'refs', need:75,  icon:'🕊️', name:'Anjel komunity',      desc:'75 ľudí v štruktúre'},
  {id:'r100', cat:'refs', need:100, icon:'👸', name:'Kráľovná Fusion',     name_m:'Kráľ Fusion', desc:'100 ľudí v štruktúre'},
  {id:'r250', cat:'refs', need:250, icon:'🦋', name:'Motýľ premeny',       desc:'250 ľudí v štruktúre'},
  {id:'r500', cat:'refs', need:500, icon:'🌟', name:'Superhviezda',        desc:'500 ľudí v štruktúre'},
  {id:'r1000',cat:'refs', need:1000, icon:'💠', name:'Diamantová kráľovná', name_m:'Diamantový kráľ', desc:'1000 ľudí v štruktúre'},
  {id:'r2500',cat:'refs', need:2500, icon:'🏆', name:'Šampiónka sŕdc',      name_m:'Šampión sŕdc', desc:'2500 ľudí v štruktúre'},
  {id:'r5000',cat:'refs', need:5000, icon:'🌈', name:'Živel radosti',       desc:'5000 ľudí v štruktúre'},
  {id:'r10000',cat:'refs',need:10000,icon:'🚀', name:'SKY IS THE LIMIT',    desc:'10 000+ ľudí v štruktúre'},
  // Vernosť — počíta sa len z mesiacov, v ktorých mala platné členstvo (až po 99 rokov)
  {id:'m3',    cat:'tenure', need:3,    icon:'📅', name:'Verná',           name_m:'Verný', desc:'3 mesiace s členstvom'},
  {id:'m6',    cat:'tenure', need:6,    icon:'💛', name:'Srdcom Fusion',   desc:'6 mesiacov s členstvom'},
  {id:'m12',   cat:'tenure', need:12,   icon:'🎖️', name:'Rok na parkete',  desc:'1 rok s členstvom'},
  {id:'m24',   cat:'tenure', need:24,   icon:'💎', name:'Diamantová éra',  desc:'2 roky s členstvom'},
  {id:'m36',   cat:'tenure', need:36,   icon:'🌟', name:'Verná duša',      desc:'3 roky s členstvom'},
  {id:'m60',   cat:'tenure', need:60,   icon:'🏛️', name:'Pilier komunity', desc:'5 rokov s členstvom'},
  {id:'m120',  cat:'tenure', need:120,  icon:'👑', name:'Legenda desaťročia', desc:'10 rokov s členstvom'},
  {id:'m180',  cat:'tenure', need:180,  icon:'💠', name:'Vzácny klenot',   desc:'15 rokov s členstvom'},
  {id:'m240',  cat:'tenure', need:240,  icon:'🕊️', name:'Nesmrteľná',      name_m:'Nesmrteľný', desc:'20 rokov s členstvom'},
  {id:'m360',  cat:'tenure', need:360,  icon:'📜', name:'Živá história',   desc:'30 rokov s členstvom'},
  {id:'m600',  cat:'tenure', need:600,  icon:'🏅', name:'Zlatá legenda',   desc:'50 rokov s členstvom'},
  {id:'m1188', cat:'tenure', need:1188, icon:'♾️', name:'Večná ikona',     desc:'99 rokov s členstvom'},
  // Súkromné hodiny (private lessons) — počíta sa private_hours
  {id:'p1',    cat:'private', need:1,    icon:'🔑', name:'Prvá súkromná',    desc:'1 súkromná hodina'},
  {id:'p5',    cat:'private', need:5,    icon:'🎯', name:'Osobný prístup',   desc:'5 súkromných hodín'},
  {id:'p10',   cat:'private', need:10,   icon:'💪', name:'Vlastný tréner',   desc:'10 súkromných hodín'},
  {id:'p25',   cat:'private', need:25,   icon:'⚜️', name:'VIP tanečnica',    name_m:'VIP tanečník', desc:'25 súkromných hodín'},
  {id:'p50',   cat:'private', need:50,   icon:'👑', name:'Majsterka pohybu', name_m:'Majster pohybu', desc:'50 súkromných hodín'},
  {id:'p100',  cat:'private', need:100,  icon:'💎', name:'Diamantová práca', desc:'100 súkromných hodín'},
  {id:'p250',  cat:'private', need:250,  icon:'🏆', name:'Elitná trénovaná', name_m:'Elitne trénovaný', desc:'250 súkromných hodín'},
  {id:'p500',  cat:'private', need:500,  icon:'🌟', name:'Legenda parketu',  desc:'500 súkromných hodín'},
  {id:'p1000', cat:'private', need:1000, icon:'♾️', name:'Nekonečná oddanosť', desc:'1000 súkromných hodín'},
  // Špeciálne roly
  {id:'founder',   cat:'special', flag:'is_founder', icon:'👑', name:'Zakladateľ', desc:'Zakladateľ Fusion Academy'},
  {id:'admin_role',cat:'special', flag:'is_admin', icon:'🛡️', name:'Admin Fusion Academy', desc:'Správca aplikácie'},
  {id:'assistant', cat:'special', flag:'is_assistant', icon:'🤝', name:'Asistent trénera', desc:'Pomáha trénerovi ako asistent'},
  {id:'trainer',   cat:'special', role:'trainer', icon:'🎓', name:'Tréner Fusion Academy', desc:'Akreditovaný tréner FA'},
  // Odučené SKUPINOVÉ hodiny (len tréneri) — prvých 100 hodín je zácvik
  {id:'tg10',   cat:'tgroup', need:10,   icon:'🌱', name:'Prvé kroky v zácviku', desc:'10 odučených hodín (zácvik)'},
  {id:'tg50',   cat:'tgroup', need:50,   icon:'📚', name:'Polovica zácviku',     desc:'50 odučených hodín (zácvik)'},
  {id:'tg100',  cat:'tgroup', need:100,  icon:'🎓', name:'Vyškolený tréner',     desc:'Dokončil zácvik — 100 odučených hodín'},
  {id:'tg150',  cat:'tgroup', need:150,  icon:'🔥', name:'Majster parketu',      desc:'150 odučených skupinových hodín'},
  {id:'tg500',  cat:'tgroup', need:500,  icon:'🏆', name:'Legenda tréningov',    desc:'500 odučených skupinových hodín'},
  {id:'tg1000', cat:'tgroup', need:1000, icon:'🌟', name:'Ikona tréningov',      desc:'1000 odučených skupinových hodín'},
  // Odučené SÚKROMNÉ hodiny (len tréneri)
  {id:'tp5',    cat:'tprivate', need:5,    icon:'🔑', name:'Osobný tréner',      desc:'5 odučených súkromných hodín'},
  {id:'tp25',   cat:'tprivate', need:25,   icon:'⚜️', name:'VIP tréner',         desc:'25 odučených súkromných hodín'},
  {id:'tp100',  cat:'tprivate', need:100,  icon:'💎', name:'Elitný tréner',      desc:'100 odučených súkromných hodín'},
  {id:'tp500',  cat:'tprivate', need:500,  icon:'♾️', name:'Nesmrteľný mentor',  desc:'500 odučených súkromných hodín'},
  // Merch — odomkne sa pri kúpe daného kúsku
  {id:'merch_tielko', cat:'merch', item:'tielko', icon:'🎽', name:'Tielko FA', desc:'Kúpené tielko Fusion Academy'},
  {id:'merch_tricko', cat:'merch', item:'tricko', icon:'👕', name:'Tričko FA', desc:'Kúpené tričko Fusion Academy'},
  {id:'merch_taska',  cat:'merch', item:'taska',  icon:'👜', name:'Taška FA',  desc:'Kúpená taška Fusion Academy'},
  {id:'merch_mikina', cat:'merch', item:'mikina', icon:'🧥', name:'Mikina FA', desc:'Kúpená mikina Fusion Academy'},
];
const MERCH_KEYWORDS={tielko:/tielk/i, tricko:/tri[čc]k/i, taska:/ta[šs]k/i, mikina:/mikin/i};
const CITY_BADGES = ['Detva','Zvolen','Banská Bystrica','Brezno'];
// Mestá, v ktorých má klient aspoň 1 odchodenú hodinu (podľa lokácie hodiny)
async function citiesVisitedOf(userId){
  const bks = await q.find(db.bookings,{user_id:userId, status:'attended'});
  const set = new Set();
  for(const b of bks){ const loc=(b.class_location||'').trim(); if(loc) set.add(loc); }
  return [...set];
}
async function referralCountOf(uid){ return q.count(db.users,{sponsor_id:uid,is_admin:{$ne:true}}); }
// Total people anywhere in the downline (all lines) — drives referral rewards/achievements
async function downlineCountOf(uid){ return (await getAllDescendants(uid)).length; }
// Walk up the sponsor chain: everyone above `uid` whose structure just grew
async function getAllAncestors(uid){
  const out=[]; let curId=uid; const seen=new Set();
  while(curId){
    const cur=await q.one(db.users,{_id:curId});
    if(!cur || !cur.sponsor_id || seen.has(cur.sponsor_id)) break;
    seen.add(cur.sponsor_id);
    out.push(cur.sponsor_id);
    curId=cur.sponsor_id;
  }
  return out;
}
// Visual reward for bringing new people: an emoji title shown before the name
const REFERRAL_BADGES = [
  {need:10000,emoji:'🚀', title:'SKY IS THE LIMIT'},
  {need:5000, emoji:'🌈', title:'Živel radosti'},
  {need:2500, emoji:'🏆', title:'Šampiónka sŕdc', title_m:'Šampión sŕdc'},
  {need:1000, emoji:'💠', title:'Diamantová kráľovná', title_m:'Diamantový kráľ'},
  {need:500,  emoji:'🌟', title:'Superhviezda'},
  {need:250,  emoji:'🦋', title:'Motýľ premeny'},
  {need:100, emoji:'👸', title:'Kráľovná Fusion', title_m:'Kráľ Fusion'},
  {need:75,  emoji:'🕊️', title:'Anjel komunity'},
  {need:50,  emoji:'💎', title:'Klenot komunity'},
  {need:30,  emoji:'🌟', title:'Žiarivá hviezda'},
  {need:20,  emoji:'👑', title:'Srdce komunity'},
  {need:10,  emoji:'💫', title:'Duša komunity'},
  {need:5,   emoji:'🌸', title:'Inšpirácia'},
  {need:3,   emoji:'🌱', title:'Rozsievačka radosti', title_m:'Rozsievač radosti'},
  {need:1,   emoji:'🤝', title:'Ambasádorka', title_m:'Ambasádor'},
];
function referralBadge(refCount, gender){
  const b=REFERRAL_BADGES.find(b=>refCount>=b.need);
  if(!b) return null;
  return { ...b, title: (gender==='male' && b.title_m) ? b.title_m : b.title };
}
// Referral count also unlocks fancier profile backgrounds (harder than visits)
// Pozadie CELÉHO profilu — odmena za počet privedených ľudí do štruktúry (1 → 10000)
const PROFILE_BG_TIERS = [
  {need:0,     key:'basic',    name:'Základné'},
  {need:1,     key:'spark',    name:'Iskra'},
  {need:3,     key:'dawn',     name:'Úsvit'},
  {need:5,     key:'bloom',    name:'Rozkvet'},
  {need:10,    key:'sunset',   name:'Západ slnka'},
  {need:20,    key:'ocean',    name:'Oceán'},
  {need:50,    key:'emerald',  name:'Smaragd'},
  {need:100,   key:'royal',    name:'Kráľovská'},
  {need:250,   key:'nebula',   name:'Hmlovina'},
  {need:500,   key:'aurora',   name:'Polárna žiara'},
  {need:1000,  key:'galaxy',   name:'Galaxia'},
  {need:2500,  key:'cosmos',   name:'Kozmos'},
  {need:5000,  key:'nova',     name:'Supernova'},
  {need:10000, key:'infinity', name:'Nekonečno'},
];
function refBgTier(refCount){ let t='basic'; for(const x of PROFILE_BG_TIERS){ if(refCount>=x.need) t=x.key; } return t; }
function nextBgTier(refCount){ return PROFILE_BG_TIERS.find(x=>refCount<x.need)||null; }
function monthsSince(iso){ if(!iso) return 0; return Math.max(0, Math.floor((Date.now()-new Date(iso).getTime())/(30*86400000))); }
// Count distinct calendar months in which the user held an active membership
async function activeMembershipMonths(userId){
  const membs=(await q.find(db.memberships,{user_id:userId})).filter(m=>!m._type);
  const months=new Set(); const now=new Date();
  for(const m of membs){
    const start=new Date(m.started_at||m.start_date||m.created_at||0);
    const end=new Date(m.expires_at||m.started_at||m.created_at||0);
    if(isNaN(start.getTime())||isNaN(end.getTime())) continue;
    let cur=new Date(start.getFullYear(),start.getMonth(),1);
    const last=(end>now?now:end); let guard=0;
    while(cur<=last && guard++<2000){
      months.add(cur.getFullYear()+'-'+String(cur.getMonth()+1).padStart(2,'0'));
      cur.setMonth(cur.getMonth()+1);
    }
  }
  return months.size;
}
function computeAchievements(u, refCount, tenureMonths, gender){
  const visits=u.visit_count||0;
  const g = gender || u.gender || 'female';
  const months = (tenureMonths!==undefined) ? tenureMonths : monthsSince(u.created_at);
  const isTrainer = (u.user_type==='trainer') || !!u.is_admin;
  const val={visits, refs:refCount, tenure:months, private:u.private_hours||0,
    tgroup:u.taught_group_hours||0, tprivate:u.taught_private_hours||0};
  const merch=u.merch_owned||[]; const manual=u.manual_achievements||[];
  return ACHIEVEMENTS
    // Trénerske odznaky (rola + odučené hodiny) len na profile trénera/admina
    .filter(a=> (a.cat==='tgroup'||a.cat==='tprivate'||(a.cat==='special'&&a.role==='trainer')) ? isTrainer : true)
    // Zakladateľ / Admin odznak sa ukáže len tomu, kto ním je (nie zamknutý u všetkých)
    .filter(a=> a.id==='founder' ? !!u.is_founder : (a.id==='admin_role' ? !!u.is_admin : true))
    .map(a=>{
    let earned, progress;
    const cities = u.cities_visited||[];
    if(a.cat==='merch'){ earned = merch.includes(a.item); progress = earned?100:0; }
    else if(a.cat==='city'){ earned = cities.includes(a.city); progress = earned?100:0; }
    else if(a.cat==='city_all'){ const done=CITY_BADGES.filter(c=>cities.includes(c)).length; earned = done>=CITY_BADGES.length; progress = Math.round(done/CITY_BADGES.length*100); }
    else if(a.cat==='special'){ earned = a.flag ? !!u[a.flag] : (a.role ? (u.user_type===a.role || (a.role==='trainer'&&u.is_admin)) : false); progress = earned?100:0; }
    else { earned = (val[a.cat]||0) >= a.need; progress = Math.min(100, Math.round((val[a.cat]||0)/a.need*100)); }
    if(manual.includes(a.id)) { earned = true; if(progress<100) progress=100; }
    const name = (g==='male' && a.name_m) ? a.name_m : a.name;
    return {...a, name, earned, progress};
  });
}

// Priatelia (obojsmerné, prijaté) daného používateľa → zoznam ich id
async function friendsOf(userId){
  const rows = await q.find(db.friends,{users:userId, status:'accepted'});
  return rows.map(f=>(f.users||[]).find(x=>x!==userId)).filter(Boolean);
}
// Zisti novozískané odznaky, pošli notifikáciu majiteľovi aj jeho priateľom.
// Prvé spustenie len „naseeduje" existujúce odznaky (nespamuje za historické).
async function checkNewAchievements(userId){
  try {
    const u = await q.one(db.users,{_id:userId});
    if(!u || u.active===false || u.anonymous) return;
    const refCount = await downlineCountOf(u._id);
    const memberMonths = await activeMembershipMonths(u._id);
    u.cities_visited = await citiesVisitedOf(u._id);
    const ach = computeAchievements(u, refCount, memberMonths, u.gender);
    const earnedIds = ach.filter(a=>a.earned && a.cat!=='special').map(a=>a.id); // roly (founder/admin…) neoznamujeme
    if(u.notified_achievements === undefined){ // baseline bez notifikácií
      await q.update(db.users,{_id:u._id},{$set:{notified_achievements:earnedIds}});
      return;
    }
    const notified = u.notified_achievements || [];
    const newly = earnedIds.filter(id=>!notified.includes(id));
    if(!newly.length) return;
    const map = Object.fromEntries(ach.map(a=>[a.id,a]));
    const friends = await friendsOf(u._id);
    for(const id of newly){
      const a = map[id]; if(!a) continue;
      await q.insert(db.notifications,{user_id:u._id, type:'achievement',
        title:`🏅 Nový odznak: ${a.icon} ${a.name}`, body:a.desc||'Získal/a si nový odznak!', read:false, created_at:nowISO()}).catch(()=>{});
      for(const fid of friends){
        await q.insert(db.notifications,{user_id:fid, type:'friend_achievement',
          title:`${a.icon} ${u.name} získal/a odznak`, body:`${u.name} práve získal/a odznak „${a.name}". Poblahoželaj! 🎉`, read:false, created_at:nowISO()}).catch(()=>{});
      }
    }
    await q.update(db.users,{_id:u._id},{$set:{notified_achievements:earnedIds}});
  } catch(e){ console.error('checkNewAchievements:', e.message); }
}

// Grant merch achievements to the buyer of an order (matched by product name)
async function grantMerchFromOrder(order){
  try {
    if(!order?.client_email) return;
    const buyer=await q.one(db.users,{email:(order.client_email||'').toLowerCase().trim()});
    if(!buyer) return;
    const owned=new Set(buyer.merch_owned||[]);
    let added=false;
    for(const item of (order.items||[])){
      const nm=item.product_name||item.name||'';
      for(const [key,rx] of Object.entries(MERCH_KEYWORDS)){
        if(rx.test(nm) && !owned.has(key)){ owned.add(key); added=true; }
      }
    }
    if(added){
      await q.update(db.users,{_id:buyer._id},{$set:{merch_owned:[...owned]}});
      await q.insert(db.notifications,{user_id:buyer._id,type:'achievement',title:'🏅 Nový odznak za merch!',body:'Odomkla si nový odznak vo svojom profile. Pozri sa! ✨',read:false,created_at:nowISO()}).catch(()=>{});
    }
  } catch(e){ console.error('grantMerchFromOrder:',e.message); }
}

// Friend relationship helpers (single row per pair, sorted key)
const pairKey=(a,b)=>[String(a),String(b)].sort().join('_');
async function friendState(meId, otherId){
  const f=await q.one(db.friends,{pair:pairKey(meId,otherId)});
  if(!f) return 'none';
  if(f.status==='accepted') return 'friends';
  return f.requested_by===meId ? 'requested' : 'incoming'; // pending
}

// Public profile (respects anonymity: anonymous users show a minimal card)
app.get('/api/profile/:id', auth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.params.id});
    if(!u) return res.status(404).json({error:'Profil nenájdený'});
    const me=req.session.uid;
    const isSelf = u._id===me;
    const directRefs=await referralCountOf(u._id);
    const refCount=await downlineCountOf(u._id); // whole structure drives rewards
    const memberMonths=await activeMembershipMonths(u._id);
    const gender = u.gender==='male' ? 'male' : 'female';
    u.cities_visited = await citiesVisitedOf(u._id);
    const ach=computeAchievements(u, refCount, memberMonths, gender);
    const earned=ach.filter(a=>a.earned);
    // „Členkou od" = najskorší začiatok členstva (napr. z Glofoxu), nie dátum
    // vzniku appka účtu — aby to sedelo s počtom odčlenených mesiacov.
    const _membStarts=(await q.find(db.memberships,{user_id:u._id})).filter(m=>!m._type)
      .map(m=>(m.started_at||m.start_date||m.created_at||'')).filter(Boolean).map(s=>s.slice(0,10)).sort();
    const joinedDate = (_membStarts[0] && _membStarts[0] < (u.created_at||'9999').slice(0,10))
      ? _membStarts[0] : (u.created_at||'').slice(0,10);
    const badge=getMemberBadge(joinedDate);
    const loyalty=getLoyaltyStatus(u.visit_count||0);
    // Pozadie celého profilu = odmena za počet privedených ľudí do štruktúry (1→10000).
    // Admin/zakladateľ si môže nastaviť vlastné (custom_bg), inak zakladateľ = founder.
    const canCustomBg = !!(u.is_admin || u.is_founder);
    const bgTier = (canCustomBg && u.custom_bg) ? u.custom_bg : (u.is_founder ? 'founder' : refBgTier(refCount));
    const nextBg = u.is_founder ? null : nextBgTier(refCount);
    const nameBadge=referralBadge(refCount, gender);
    // Membership-level glow — visible to everyone on the public profile
    const mem=await checkMembership(u._id);
    const memTier=(mem && ['bronze','silver','gold'].includes(mem.plan_id)) ? mem.plan_id : null;
    const memName=mem ? (MEMBERSHIP_PLANS[mem.plan_id]?.name||mem.plan_name||null) : null;
    const likeCount=await q.count(db.profile_likes,{profile_id:u._id});
    const likedByMe=isSelf?false:!!(await q.one(db.profile_likes,{profile_id:u._id,liker_id:me}));
    const meUser = isSelf ? u : await q.one(db.users,{_id:me});
    const viewerLang = meUser?.lang||'';
    const viewerIsAdmin = !!(meUser && meUser.is_admin);
    let monthPoints; try { monthPoints = await monthlyPointsFor(u._id); } catch(e){ monthPoints = {month:today().slice(0,7),total:0,items:[]}; }
    res.json({
      id:u._id, name: u.anonymous&&!isSelf ? 'Anonymný člen' : u.name,
      nickname: u.anonymous&&!isSelf ? '' : (u.nickname||''),
      status: u.anonymous&&!isSelf ? '' : (u.status||''),
      birthday: isSelf ? (u.birthday||'') : undefined,
      gender, viewer_lang: viewerLang, viewer_is_admin: viewerIsAdmin, viewer_logged_in: !!req.session?.uid,
      points: monthPoints,
      membership_tier: memTier, membership_name: memName,
      likes: likeCount, liked_by_me: likedByMe,
      anonymous: !!u.anonymous, is_self:isSelf,
      avatar: u.anonymous&&!isSelf ? null : (u.avatar||null),
      member_badge:badge, loyalty_label: loyalty.current?.label||'Nováčik',
      visits: u.visit_count||0, referrals: refCount, direct_refs: directRefs,
      is_trainer: (u.user_type==='trainer')||!!u.is_admin,
      is_founder: !!u.is_founder, is_admin_profile: !!u.is_admin,
      taught_group_hours: u.taught_group_hours||0, taught_private_hours: u.taught_private_hours||0,
      months_member: memberMonths, joined: joinedDate,
      achievements: ach, earned_count: earned.length, total_count: ach.length,
      bg_tier: bgTier, next_bg: nextBg, name_badge: nameBadge,
      can_custom_bg: canCustomBg, custom_bg: u.custom_bg||'',
      bg_tiers: (canCustomBg ? [...PROFILE_BG_TIERS, {need:0,key:'founder',name:'👑 Zakladateľ'}] : PROFILE_BG_TIERS)
        .map(t=>({need:t.need,key:t.key,name:t.name,unlocked: canCustomBg?true:(refCount>=t.need), current: t.key===bgTier})),
      friend_state: isSelf ? 'self' : await friendState(me, u._id)
    });
  } catch(e){ console.error('profile GET error:', e.message, e.stack); res.status(500).json({error:e.message}); }
});

// Like / unlike a profile (toggle) — works for any member, trainer or admin
app.post('/api/profile/:id/like', auth, async(req,res)=>{
  try {
    const target=await q.one(db.users,{_id:req.params.id});
    if(!target) return res.status(404).json({error:'Profil nenájdený'});
    const me=req.session.uid;
    if(target._id===me) return res.status(400).json({error:'Vlastný profil nemôžeš lajknúť'});
    const existing=await q.one(db.profile_likes,{profile_id:target._id,liker_id:me});
    let liked;
    if(existing){ await q.remove(db.profile_likes,{_id:existing._id}); liked=false; }
    else {
      await q.insert(db.profile_likes,{profile_id:target._id,liker_id:me,created_at:nowISO()});
      liked=true;
      const meU=await q.one(db.users,{_id:me});
      await q.insert(db.notifications,{user_id:target._id,type:'profile_like',from_id:me,
        title:'❤️ Niekomu sa páči tvoj profil!',
        body:`${meU?.name||'Niekto'} dal/a like tvojmu profilu.`,
        read:false,created_at:nowISO()}).catch(()=>{});
    }
    const likes=await q.count(db.profile_likes,{profile_id:target._id});
    res.json({ liked, likes });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// List comments on a profile
app.get('/api/profile/:id/comments', auth, async(req,res)=>{
  try {
    const rows=await q.find(db.profile_comments,{profile_id:req.params.id});
    rows.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    const me=req.session.uid;
    const meU=await q.one(db.users,{_id:me});
    const isAdmin=!!(meU&&meU.is_admin);
    const out=[];
    for(const c of rows){
      const author=await q.one(db.users,{_id:c.author_id});
      out.push({ id:c._id, text:c.text, created_at:c.created_at,
        author_id:c.author_id, author_name:author?.name||'Člen',
        author_avatar:author?.avatar||null,
        can_delete: isAdmin || c.author_id===me || req.params.id===me });
    }
    res.json({ comments:out });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Post a comment on someone's profile (any member/trainer/admin profile)
app.post('/api/profile/:id/comments', auth, async(req,res)=>{
  try {
    const target=await q.one(db.users,{_id:req.params.id});
    if(!target) return res.status(404).json({error:'Profil nenájdený'});
    const text=(req.body.text||'').trim();
    if(!text) return res.status(400).json({error:'Prázdny komentár'});
    if(text.length>500) return res.status(400).json({error:'Komentár je príliš dlhý (max 500)'});
    const me=req.session.uid;
    const meU=await q.one(db.users,{_id:me});
    const c=await q.insert(db.profile_comments,{profile_id:target._id,author_id:me,text,created_at:nowISO()});
    if(target._id!==me){
      await q.insert(db.notifications,{user_id:target._id,type:'profile_comment',from_id:me,
        title:'💬 Nový komentár na tvojom profile',
        body:`${meU?.name||'Niekto'}: ${text.slice(0,80)}`,
        read:false,created_at:nowISO()}).catch(()=>{});
    }
    res.json({ ok:true, id:c._id, author_name:meU?.name||'Člen', author_avatar:meU?.avatar||null, text, created_at:c.created_at });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Delete a profile comment (author, profile owner, or admin)
app.delete('/api/profile/:id/comments/:cid', auth, async(req,res)=>{
  try {
    const c=await q.one(db.profile_comments,{_id:req.params.cid});
    if(!c) return res.status(404).json({error:'Nenájdené'});
    const me=req.session.uid;
    const meU=await q.one(db.users,{_id:me});
    const allowed=(meU&&meU.is_admin)||c.author_id===me||c.profile_id===me;
    if(!allowed) return res.status(403).json({error:'Nemáš oprávnenie'});
    await q.remove(db.profile_comments,{_id:c._id});
    res.json({ ok:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Admin: view/grant a user's achievements, merch and attended hours (for showcase profiles)
app.get('/api/admin/users/:id/awards', adminAuth, async(req,res)=>{
  const u=await q.one(db.users,{_id:req.params.id}); if(!u) return res.status(404).json({error:'Nenájdený'});
  const refCount=await referralCountOf(u._id);
  const memberMonths=await activeMembershipMonths(u._id);
  u.cities_visited = await citiesVisitedOf(u._id);
  const sponsor = u.sponsor_id ? await q.one(db.users,{_id:u.sponsor_id}) : null;
  res.json({ name:u.name, visit_count:u.visit_count||0, private_hours:u.private_hours||0,
    referral_credit:+(u.referral_credit||0), referral_credit_pending:+(u.referral_credit_pending||0),
    single_entries:+(u.single_entries||0), free_credits:+(u.free_credits||0),
    is_trainer:(u.user_type==='trainer')||!!u.is_admin, taught_group_hours:u.taught_group_hours||0, taught_private_hours:u.taught_private_hours||0,
    referrals:refCount, joined:(u.created_at||'').slice(0,10),
    achievements: computeAchievements(u, refCount, memberMonths),
    merch_owned: u.merch_owned||[], manual_achievements: u.manual_achievements||[],
    merch_list: Object.keys(MERCH_KEYWORDS),
    sponsor_id: u.sponsor_id||null, sponsor_name: sponsor?.name||null, sponsor_code: sponsor?.referral_code||null });
});

// Admin: vyhľadať používateľa ako potenciálneho sponzora (meno/email/kód)
app.get('/api/admin/user-search', adminAuth, async(req,res)=>{
  const s=(req.query.q||'').trim().toLowerCase();
  if(s.length<2) return res.json({people:[]});
  let users=await q.find(db.users,{is_child:{$ne:true}});
  users=users.filter(u=>!u.imported||u.claimed).filter(u=>(u.name||'').toLowerCase().includes(s)||(u.email||'').toLowerCase().includes(s)||(u.referral_code||'').toLowerCase().includes(s)).slice(0,12);
  res.json({people:users.map(u=>({id:u._id,name:u.name,email:u.email,code:u.referral_code||'',type:u.user_type||''}))});
});

// Admin: priradiť/zmeniť sponzora klienta (napr. keď sa zaregistroval bez kódu)
app.put('/api/admin/users/:id/sponsor', adminAuth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.params.id}); if(!u) return res.status(404).json({error:'Nenájdený'});
    const sponsorId=req.body.sponsor_id||null;
    if(sponsorId){
      if(sponsorId===u._id) return res.status(400).json({error:'Nemôže byť sám sebe sponzorom'});
      const sp=await q.one(db.users,{_id:sponsorId}); if(!sp) return res.status(404).json({error:'Sponzor nenájdený'});
      // zabráň cyklu (nový sponzor nesmie byť pod týmto používateľom)
      const desc=await getAllDescendants(u._id);
      if(desc.includes(sponsorId)) return res.status(400).json({error:'Tento človek je v tvojej štruktúre – vznikol by cyklus'});
    }
    await q.update(db.users,{_id:u._id},{$set:{sponsor_id:sponsorId}});
    await auditLog(req,'set_sponsor',u._id,{old:u.sponsor_id},{new:sponsorId},'');
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/admin/users/:id/awards', adminAuth, async(req,res)=>{
  const u=await q.one(db.users,{_id:req.params.id}); if(!u) return res.status(404).json({error:'Nenájdený'});
  const set={};
  if(req.body.visit_count!==undefined) set.visit_count=Math.max(0,parseInt(req.body.visit_count)||0);
  if(req.body.private_hours!==undefined) set.private_hours=Math.max(0,parseInt(req.body.private_hours)||0);
  if(req.body.taught_group_hours!==undefined) set.taught_group_hours=Math.max(0,parseInt(req.body.taught_group_hours)||0);
  if(req.body.taught_private_hours!==undefined) set.taught_private_hours=Math.max(0,parseInt(req.body.taught_private_hours)||0);
  if(req.body.referral_credit!==undefined) set.referral_credit=Math.max(0,+parseFloat(req.body.referral_credit).toFixed(2)||0);
  if(Array.isArray(req.body.merch_owned)) set.merch_owned=req.body.merch_owned.filter(x=>MERCH_KEYWORDS[x]);
  if(Array.isArray(req.body.manual_achievements)) set.manual_achievements=req.body.manual_achievements.filter(id=>ACHIEVEMENTS.some(a=>a.id===id));
  if(Object.keys(set).length) await q.update(db.users,{_id:u._id},{$set:set});
  await auditLog(req,'user_awards_update',u._id,{visit_count:u.visit_count,merch:u.merch_owned,manual:u.manual_achievements},set,'');
  res.json({ok:true});
});

// Admin: úprava kreditu klienta — pridať/odobrať/nastaviť
app.post('/api/admin/users/:id/credit', adminAuth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.params.id}); if(!u) return res.status(404).json({error:'Nenájdený'});
    const op=req.body.op; const val=+parseFloat(req.body.amount);
    if(isNaN(val)) return res.status(400).json({error:'Neplatná suma'});
    let cur=+(u.referral_credit||0);
    let nc = op==='set' ? val : op==='add' ? cur+val : op==='sub' ? cur-val : cur;
    nc=+Math.max(0,nc).toFixed(2);
    await q.update(db.users,{_id:u._id},{$set:{referral_credit:nc}});
    await q.insert(db.notifications,{user_id:u._id,type:'credit',title:'💳 Úprava kreditu adminom',body:`Nový zostatok kreditu: ${nc.toFixed(2)} €`,read:false,created_at:nowISO()}).catch(()=>{});
    await auditLog(req,'credit_adjust',u._id,{old:cur},{op,val,new:nc},'');
    res.json({ ok:true, referral_credit:nc });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Admin: úprava jednorázových vstupov (permanentky) — nastaviť/pridať/odobrať (aj oprava chýb z importu)
app.post('/api/admin/users/:id/entries', adminAuth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.params.id}); if(!u) return res.status(404).json({error:'Nenájdený'});
    const op=req.body.op; const val=parseInt(req.body.amount);
    if(isNaN(val)) return res.status(400).json({error:'Neplatný počet'});
    let cur=parseInt(u.single_entries||0);
    let ne = op==='set' ? val : op==='add' ? cur+val : op==='sub' ? cur-val : cur;
    ne=Math.max(0,ne);
    await q.update(db.users,{_id:u._id},{$set:{single_entries:ne}});
    await q.insert(db.notifications,{user_id:u._id,type:'entries',title:'🎟️ Úprava vstupov',body:`Aktuálny počet jednorázových vstupov: ${ne}`,read:false,created_at:nowISO()}).catch(()=>{});
    await auditLog(req,'entries_adjust',u._id,{old:cur},{op,val,new:ne},'');
    res.json({ ok:true, single_entries:ne });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Admin: darovať / nastaviť členstvo s vlastnou platnosťou + prípadne vstupy (migrácia z Glofoxu)
app.post('/api/admin/users/:id/grant-membership', adminAuth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.params.id}); if(!u) return res.status(404).json({error:'Nenájdený'});
    const plan_id=req.body.plan_id; const plan=MEMBERSHIP_PLANS[plan_id];
    const gift = req.body.gift!==false; // default darček (bez platby) — migrácia
    const entries = Math.max(0, parseInt(req.body.entries)||0);
    let expiresISO=null;
    if(req.body.expires_at && /^\d{4}-\d{2}-\d{2}/.test(req.body.expires_at)){
      expiresISO = new Date(req.body.expires_at+'T23:59:59').toISOString();
    } else if(plan){
      expiresISO = new Date(Date.now()+(plan.duration_days||30)*86400000).toISOString();
    }
    // Členstvo (ak vybraný plán a nie je to len permanentka)
    if(plan && plan.type!=='bundle'){
      const existing=await q.one(db.memberships,{user_id:u._id,status:'active'});
      const rec={user_id:u._id,user_name:u.name,plan_id,plan_name:plan.name,price:gift?0:(req.body.amount||plan.price),
        status:'active',started_at:nowISO(),expires_at:expiresISO,
        gift:!!gift,migrated:!!gift,granted_by:req.session.uid,updated_at:nowISO()};
      if(existing){ await q.update(db.memberships,{_id:existing._id},{$set:{plan_id,plan_name:plan.name,expires_at:expiresISO,gift:!!gift,migrated:!!gift}}); }
      else { await q.insert(db.memberships,{...rec,created_at:nowISO()}); }
      await q.update(db.users,{_id:u._id},{$set:{membership_plan:plan_id,membership_expires:expiresISO}});
      if(!gift){ // reálna platba na mieste → tržba + provízia
        await q.insert(db.transactions,{type:'membership',user_id:u._id,user_name:u.name,amount:+(req.body.amount||plan.price),
          payment_method:req.body.payment_method||'cash',note:`Členstvo ${plan.name} (admin)`,plan_id,recorded_by:req.session.uid,created_at:nowISO(),month:today().slice(0,7)});
        awardPurchaseCommission({buyer_id:u._id, amount:+(req.body.amount||plan.price), product_name:`Členstvo ${plan.name}`});
      } else if(u.user_type==='lead'){ await q.update(db.users,{_id:u._id},{$set:{user_type:'client'}}); }
    }
    // Permanentka / vstupy na hodiny
    if(entries>0){ await q.update(db.users,{_id:u._id},{$set:{single_entries:(u.single_entries||0)+entries}}); }
    await q.insert(db.notifications,{user_id:u._id,type:'membership',title: gift?'🎁 Členstvo pridelené':'✅ Členstvo aktivované',
      body:`${plan?plan.name:''}${expiresISO?` platné do ${expiresISO.slice(0,10)}`:''}${entries?` · +${entries} vstupov`:''}`,read:false,created_at:nowISO()}).catch(()=>{});
    await auditLog(req, gift?'membership_gift':'membership_sell', u._id, {}, {plan_id,expires_at:expiresISO,entries,gift,amount:gift?0:(req.body.amount||plan?.price)}, gift?'Migrácia/darček':'Platba na mieste');
    res.json({ ok:true, plan_name:plan?.name||'—', expires_at:expiresISO?expiresISO.slice(0,10):null, entries });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Admin: označiť čakajúcu výplatu ako vyplatenú (peniaze fyzicky poslané)
app.post('/api/admin/users/:id/mark-payout-paid', adminAuth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.params.id}); if(!u) return res.status(404).json({error:'Nenájdený'});
    const pend=+(u.referral_credit_pending||0);
    if(pend<=0) return res.status(400).json({error:'Žiadna čakajúca výplata'});
    await q.update(db.transactions,{user_id:u._id,type:'referral_payout_request',status:'pending'},{$set:{status:'paid',paid_at:nowISO()}},{multi:true});
    await q.update(db.users,{_id:u._id},{$set:{referral_credit_pending:0}});
    await q.insert(db.notifications,{user_id:u._id,type:'payout',title:'✅ Výplata vyplatená',body:`${pend.toFixed(2)} € bolo prevedených na tvoj účet.`,read:false,created_at:nowISO()}).catch(()=>{});
    await auditLog(req,'payout_mark_paid',u._id,{pending:pend},{paid:pend},'');
    res.json({ ok:true, paid:pend });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Admin: reset klientovho hesla — odhlási ho a pri ďalšom prihlásení si musí vytvoriť nové heslo
app.post('/api/admin/users/:id/reset-password', adminAuth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.params.id}); if(!u) return res.status(404).json({error:'Nenájdený'});
    if(u.is_admin) return res.status(400).json({error:'Heslo admina nemožno takto resetovať'});
    await q.update(db.users,{_id:u._id},{$set:{password:null, pw_reset:true}, $inc:{sess_ver:1}});
    await q.insert(db.notifications,{user_id:u._id,type:'account',title:'🔑 Heslo bolo resetované',body:'Správca resetoval tvoje heslo. Pri prihlásení si vytvor nové.',read:false,created_at:nowISO()}).catch(()=>{});
    await auditLog(req,'password_reset',u._id,{email:u.email},{pw_reset:true},'');
    res.json({ ok:true, name:u.name, email:u.email });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Friends: send request
app.post('/api/friends/request', auth, async(req,res)=>{
  const to=String(req.body.to||''); const me=req.session.uid;
  if(!to||to===me) return res.status(400).json({error:'Neplatný používateľ'});
  const other=await q.one(db.users,{_id:to});
  if(!other) return res.status(404).json({error:'Používateľ nenájdený'});
  const key=pairKey(me,to);
  const existing=await q.one(db.friends,{pair:key});
  if(existing){
    // If the other person already requested me, accept it
    if(existing.status==='pending' && existing.requested_by===to){
      await q.update(db.friends,{pair:key},{$set:{status:'accepted',accepted_at:nowISO()}});
      return res.json({ok:true, state:'friends'});
    }
    return res.json({ok:true, state: existing.status==='accepted'?'friends':'requested'});
  }
  await q.insert(db.friends,{pair:key, users:[me,to], requested_by:me, status:'pending', created_at:nowISO()});
  await q.insert(db.notifications,{user_id:to, type:'friend_request', from_id:me,
    title:'👋 Nová žiadosť o priateľstvo', body:`${(await q.one(db.users,{_id:me}))?.name||'Niekto'} ti chce byť priateľom.`, read:false, created_at:nowISO()});
  res.json({ok:true, state:'requested'});
});
// Accept a request
app.post('/api/friends/accept', auth, async(req,res)=>{
  const from=String(req.body.from||''); const me=req.session.uid;
  const key=pairKey(me,from);
  const f=await q.one(db.friends,{pair:key, status:'pending'});
  if(!f || f.requested_by!==from) return res.status(400).json({error:'Žiadna čakajúca žiadosť'});
  await q.update(db.friends,{pair:key},{$set:{status:'accepted',accepted_at:nowISO()}});
  await q.insert(db.notifications,{user_id:from, type:'friend_accepted', from_id:me,
    title:'🎉 Žiadosť prijatá', body:`${(await q.one(db.users,{_id:me}))?.name||'Niekto'} prijal/a tvoju žiadosť o priateľstvo.`, read:false, created_at:nowISO()});
  res.json({ok:true, state:'friends'});
});
// Remove friend / cancel request / decline
app.post('/api/friends/remove', auth, async(req,res)=>{
  const other=String(req.body.user||''); const me=req.session.uid;
  await q.remove(db.friends,{pair:pairKey(me,other)},{multi:true});
  res.json({ok:true, state:'none'});
});
// My friends + incoming requests
app.get('/api/friends', auth, async(req,res)=>{
  const me=req.session.uid;
  const rows=await q.find(db.friends,{users:me});
  const uMap=Object.fromEntries((await q.find(db.users,{})).map(u=>[u._id,u]));
  const mkCard=oid=>{ const u=uMap[oid]; if(!u) return null; return {id:oid, name:u.anonymous?'Anonymný člen':u.name, avatar:u.anonymous?null:(u.avatar||null), badge:getMemberBadge(u.created_at), visits:u.visit_count||0}; };
  const friends=[], incoming=[], outgoing=[];
  for(const f of rows){
    const other=f.users.find(x=>x!==me);
    const card=mkCard(other); if(!card) continue;
    if(f.status==='accepted') friends.push(card);
    else if(f.requested_by===me) outgoing.push(card);
    else incoming.push(card);
  }
  res.json({friends, incoming, outgoing});
});

// ═══════════════════════════════════════════════════════════════════════════════
// PARTNER DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/dashboard', auth, async(req,res)=>{
  try {
    const uid=req.session.uid;
    const rank=await calcRank(uid);
    const u=await q.one(db.users,{_id:uid});
    const rankInfo=RANKS[rank-1], nextRank=RANKS[rank]||null;
    const personal=await getPersonal30(uid), team=await getTeam30(uid);
    const month=currentMonth();
    const allComm=await q.find(db.commissions,{partner_id:uid});
    const pendingE=allComm.filter(c=>c.status==='pending').reduce((s,c)=>s+c.amount,0);
    const paidE=allComm.filter(c=>c.status==='paid').reduce((s,c)=>s+c.amount,0);
    const monthE=allComm.filter(c=>c.month===month).reduce((s,c)=>s+c.amount,0);
    const directTeam=await q.find(db.users,{sponsor_id:uid});
    const allDesc=await getAllDescendants(uid);
    const allTx=await q.find(db.transactions,{partner_id:uid});
    allTx.sort((a,b)=>b.date.localeCompare(a.date));
    const sixAgo=new Date(); sixAgo.setMonth(sixAgo.getMonth()-6);
    const chartMap={};
    for(const t of allTx){const m=t.date.slice(0,7);if(m>=sixAgo.toISOString().slice(0,7)){if(!chartMap[m])chartMap[m]=0;chartMap[m]+=t.amount;}}
    const chartData=Object.entries(chartMap).sort().map(([m,total])=>({m,total:+total.toFixed(2)}));
    const myOrders=await q.find(db.orders,{partner_id:uid,status:'paid'});
    res.json({
      user: userPublic(u),
      stats:{personal30:+personal.toFixed(2),team30:+team.toFixed(2),thisMonthEarnings:+monthE.toFixed(2),pendingEarnings:+pendingE.toFixed(2),paidEarnings:+paidE.toFixed(2),directCount:directTeam.length,totalTeam:allDesc.length,myOrdersCount:myOrders.length},
      rank:{current:rankInfo,next:nextRank,progressPersonal:nextRank&&nextRank.personalMin>0?Math.min(100,(personal/nextRank.personalMin)*100):100,progressTeam:nextRank&&nextRank.teamMin>0?Math.min(100,(team/nextRank.teamMin)*100):100},
      recentTx:allTx.slice(0,8), chartData
    });
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/transactions', auth, async(req,res)=>{
  const uid=req.session.uid;
  const u=await q.one(db.users,{_id:uid});
  let txs=u.is_admin?await q.find(db.transactions,{}):await q.find(db.transactions,{partner_id:uid});
  if(u.is_admin){const allU=await q.find(db.users,{});const uMap=Object.fromEntries(allU.map(u=>[u._id,u.name]));txs=txs.map(t=>({...t,partner_name:uMap[t.partner_id]||'—'}));}
  txs.sort((a,b)=>b.date.localeCompare(a.date));
  res.json(txs.slice(0,200));
});

app.get('/api/commissions', auth, async(req,res)=>{
  const uid=req.session.uid;
  const comms=await q.find(db.commissions,{partner_id:uid});
  const allTx=await q.find(db.transactions,{}), allU=await q.find(db.users,{});
  const txMap=Object.fromEntries(allTx.map(t=>[t._id,t]));
  const uMap=Object.fromEntries(allU.map(u=>[u._id,u.name]));
  const result=comms.map(c=>({...c,client_name:txMap[c.transaction_id]?.client_name||'—',product_name:txMap[c.transaction_id]?.product_name||'—',tx_amount:txMap[c.transaction_id]?.amount||0,source_name:uMap[c.source_partner_id]||'—'}));
  result.sort((a,b)=>b.created_at.localeCompare(a.created_at));
  res.json(result.slice(0,200));
});

app.get('/api/downline', auth, async(req,res)=>{
  const uid=req.session.uid;
  async function tree(pid,depth){
    if(depth>7) return [];
    const kids=await q.find(db.users,{sponsor_id:pid,is_admin:{$ne:true}});
    const result=[];
    for(const c of kids){
      const p30=await getPersonal30(c._id);
      result.push({id:c._id,name:c.name,email:c.email,referral_code:c.referral_code,rank:c.rank,rankName:RANKS[(c.rank||1)-1].name,rankBadge:RANKS[(c.rank||1)-1].badge,active:c.active,created_at:c.created_at,personal30:+p30.toFixed(2),children:await tree(c._id,depth+1)});
    }
    return result;
  }
  res.json(await tree(uid,0));
});

app.get('/api/partner/leaderboard', auth, async(req,res)=>{
  const month=currentMonth();
  const allU=await q.find(db.users,{is_admin:{$ne:true},active:true});
  const allC=await q.find(db.commissions,{month});
  const result=allU.map(u=>{
    const uc=allC.filter(c=>c.partner_id===u._id);
    return{id:u._id,name:u.name,rank:u.rank||1,rankName:RANKS[(u.rank||1)-1].name,rankBadge:RANKS[(u.rank||1)-1].badge,earnings:+uc.reduce((s,c)=>s+c.amount,0).toFixed(2),sales_count:uc.filter(c=>c.level===0).length};
  });
  result.sort((a,b)=>b.earnings-a.earnings);
  res.json(result.slice(0,20).map((r,i)=>({...r,position:i+1})));
});

app.get('/api/products', auth, async(req,res)=>{
  const prods=await q.find(db.products,{active:true});
  prods.sort((a,b)=>a.cat?.localeCompare(b.cat)||a.name.localeCompare(b.name));
  res.json(prods);
});

app.put('/api/profile', auth, async(req,res)=>{
  const{phone,bank_account,birthday,anonymous,nickname}=req.body;
  const set={};
  if(phone!==undefined) set.phone = phone||'';
  if(bank_account!==undefined) set.bank_account = bank_account||'';
  if(birthday!==undefined) set.birthday = /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : '';
  if(anonymous!==undefined) set.anonymous = !!anonymous;
  if(nickname!==undefined) set.nickname = String(nickname||'').trim().slice(0,30);
  if(req.body.gender!==undefined) set.gender = req.body.gender==='male' ? 'male' : 'female';
  if(req.body.lang!==undefined){ const L=String(req.body.lang||'').slice(0,2).toLowerCase(); if(['sk','cs','en','uk','hu','de'].includes(L)) set.lang = L; }
  if(req.body.status!==undefined) set.status = String(req.body.status||'').trim().slice(0,120);
  // Admin/zakladateľ si môže nastaviť ľubovoľné pozadie profilu
  if(req.body.custom_bg!==undefined){
    const meU=await q.one(db.users,{_id:req.session.uid});
    if(meU && (meU.is_admin || meU.is_founder)){
      const bg=String(req.body.custom_bg||'');
      const valid = bg==='' || bg==='founder' || PROFILE_BG_TIERS.some(t=>t.key===bg);
      if(valid) set.custom_bg = bg;
    }
  }
  if(Object.keys(set).length) await q.update(db.users,{_id:req.session.uid},{$set:set});
  res.json({ok:true});
});

app.post('/api/profile/password', auth, async(req,res)=>{
  const{current,newPass}=req.body;
  const u=await q.one(db.users,{_id:req.session.uid});
  if(!(await bcrypt.compare(current,u.password))) return res.status(400).json({error:'Nesprávne aktuálne heslo'});
  await q.update(db.users,{_id:req.session.uid},{$set:{password:await bcrypt.hash(newPass,10)}});
  res.json({ok:true});
});

// Zapnutie/vypnutie zľavových ponúk (lead sa môže odhlásiť vo svojom profile)
app.post('/api/me/offers-optout', auth, async(req,res)=>{
  try {
    const optout = !!req.body.optout;
    await q.update(db.users,{_id:req.session.uid},{$set:{offers_optout:optout}});
    res.json({ok:true, offers_optout:optout});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/admin/stats', adminAuth, async(req,res)=>{
  const month=currentMonth();
  const allU=await q.find(db.users,{is_admin:{$ne:true}});
  const allTx=(await q.find(db.transactions,{})).filter(t=>!t.commission_only); // exclude commission-anchor rows from revenue
  const allC=await q.find(db.commissions,{});
  const allO=await q.find(db.orders,{});
  const allB=await q.find(db.bookings,{});
  const sixAgo=new Date(); sixAgo.setMonth(sixAgo.getMonth()-6);
  // Transactions may carry `date` (legacy MLM sales) or only `created_at` (attendance/membership)
  const txDate = t => t.date || (t.created_at||'').slice(0,10) || (t.month? t.month+'-01' : '');
  const monthMap={};
  for(const t of allTx){const m=txDate(t).slice(0,7);if(m && m>=sixAgo.toISOString().slice(0,7)){if(!monthMap[m])monthMap[m]={total:0,cnt:0};monthMap[m].total+=(+t.amount||0);monthMap[m].cnt++;}}
  const prodMap={};
  for(const t of allTx){const key=t.product_name||t.note||t.type||'—';if(!prodMap[key])prodMap[key]={cnt:0,total:0};prodMap[key].cnt++;prodMap[key].total+=(+t.amount||0);}
  const rankMap={};
  for(const u of allU){const r=u.rank||1;rankMap[r]=(rankMap[r]||0)+1;}
  res.json({
    totalPartners:allU.length, activePartners:allU.filter(u=>u.active).length,
    monthRevenue:+allTx.filter(t=>txDate(t).startsWith(month)).reduce((s,t)=>s+(+t.amount||0),0).toFixed(2),
    totalRevenue:+allTx.reduce((s,t)=>s+(+t.amount||0),0).toFixed(2),
    pendingComm:+allC.filter(c=>c.status==='pending'&&c.month===month).reduce((s,c)=>s+c.amount,0).toFixed(2),
    pendingOrders:allO.filter(o=>o.status==='pending').length,
    paidOrders:allO.filter(o=>o.status==='paid').length,
    totalBookings:allB.length,
    todayBookings:allB.filter(b=>b.created_at?.startsWith(today())).length,
    monthlyRevenue:Object.entries(monthMap).sort().map(([m,v])=>({m,total:+v.total.toFixed(2),cnt:v.cnt})),
    topProducts:Object.entries(prodMap).map(([k,v])=>({product_name:k,cnt:v.cnt,total:+v.total.toFixed(2)})).sort((a,b)=>b.total-a.total).slice(0,8),
    rankDist:Object.entries(rankMap).map(([r,cnt])=>({rank:+r,cnt,rankName:RANKS[r-1]?.name||'?'}))
  });
});

app.get('/api/admin/partners', adminAuth, async(req,res)=>{
  const allU=await q.find(db.users,{is_admin:{$ne:true}});
  const uMap=Object.fromEntries(allU.map(u=>[u._id,u.name]));
  const result=[];
  for(const p of allU){
    const p30=await getPersonal30(p._id);
    const desc=await getAllDescendants(p._id);
    result.push({id:p._id,name:p.name,email:p.email,phone:p.phone||'',referral_code:p.referral_code,rank:p.rank||1,active:p.active,bank_account:p.bank_account||'',notes:p.notes||'',sponsor_id:p.sponsor_id,sponsor_name:uMap[p.sponsor_id]||'—',rankName:RANKS[(p.rank||1)-1].name,rankBadge:RANKS[(p.rank||1)-1].badge,personal30:+p30.toFixed(2),teamSize:desc.length,created_at:p.created_at,user_type:p.user_type||'partner',memberBadge:getMemberBadge(p.created_at)});
  }
  result.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
  res.json(result);
});

// Detail štruktúry partnera pre adminov — 5 línií, koľko ľudí a s akým obratom
app.get('/api/admin/partner-network/:id', adminAuth, async(req,res)=>{
  try {
    const target=await q.one(db.users,{_id:req.params.id});
    if(!target) return res.status(404).json({error:'Nenájdený'});
    const allU=await q.find(db.users,{});
    const uMap=Object.fromEntries(allU.map(u=>[u._id,u]));
    const membs=(await q.find(db.memberships,{})).filter(m=>!m._type);
    const now=new Date().toISOString();
    const activeMemb={}; membs.forEach(m=>{ if((m.expires_at||'')>now) activeMemb[m.user_id]=m.plan_name||m.plan_id; });
    // obrat na osobu (all-time zaplatené)
    const turnover={};
    (await q.find(db.transactions,{})).forEach(t=>{ if(t.user_id&&+t.amount>0) turnover[t.user_id]=(turnover[t.user_id]||0)+ +t.amount; });
    (await q.find(db.payments,{})).filter(p=>['completed','active'].includes(p.status)).forEach(p=>{ if(p.user_id&&+p.amount>0) turnover[p.user_id]=(turnover[p.user_id]||0)+ +p.amount; });
    const lines=[[],[],[],[],[]]; let frontier=[target._id]; const seen=new Set([target._id]);
    for(let line=0;line<5;line++){ const next=[];
      for(const pid of frontier){ for(const k of allU.filter(u=>u.sponsor_id===pid && !u.is_admin && !u.is_child)){
        if(seen.has(k._id)) continue; seen.add(k._id);
        lines[line].push({ id:k._id, name:k.name, email:k.email||'', membership:activeMemb[k._id]||null,
          joined:(k.created_at||'').slice(0,10), turnover:+(+(turnover[k._id]||0)).toFixed(2), user_type:k.user_type||'client' });
        next.push(k._id);
      } } frontier=next;
    }
    const linesOut=lines.map((members,i)=>({ line:i+1, rate:(LINE_RATES&&LINE_RATES[i])||0, count:members.length,
      turnover:+members.reduce((s,m)=>s+m.turnover,0).toFixed(2), members }));
    res.json({ ok:true,
      profile:{ id:target._id, name:target.name, email:target.email, referral_code:target.referral_code||'',
        rank:target.rank||1, rankName:RANKS[(target.rank||1)-1]?.name||'', rankBadge:RANKS[(target.rank||1)-1]?.badge||'',
        sponsor_id:target.sponsor_id||null, sponsor_name:(uMap[target.sponsor_id]?.name)||'—',
        personal_turnover:+(+(turnover[target._id]||0)).toFixed(2) },
      lines:linesOut, direct_refs:lines[0].length, team_size:lines.reduce((s,l)=>s+l.length,0),
      team_turnover:+linesOut.reduce((s,l)=>s+l.turnover,0).toFixed(2) });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/admin/partners', adminAuth, async(req,res)=>{
  const{name,email,password,phone,sponsor_id,bank_account,user_type}=req.body;
  if(!name||!email||!password) return res.status(400).json({error:'Meno, email a heslo sú povinné'});
  const base=name.split(' ')[0].toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
  let code=base+Math.floor(10+Math.random()*90);
  while(await q.one(db.users,{referral_code:code})) code=base+Math.floor(100+Math.random()*900);
  // Bez sponzora → pod zakladateľa (konzistentné so samo-registráciou)
  let sid = sponsor_id||null;
  if(!sid){ const founder=await q.one(db.users,{email:'gruber.marek@gmail.com'}); if(founder && founder.email!==email.toLowerCase().trim()) sid=founder._id; }
  try {
    const u=await q.insert(db.users,{name,email:email.toLowerCase().trim(),password:await bcrypt.hash(password,10),phone:phone||'',referral_code:code,sponsor_id:sid,bank_account:bank_account||'',rank:1,is_admin:false,active:true,user_type:user_type||'partner',notes:'',created_at:today()});
    res.json({ok:true,id:u._id,referral_code:code});
  } catch(e){
    if(e.message?.includes('unique')) return res.status(400).json({error:'Email je už zaregistrovaný'});
    res.status(500).json({error:e.message});
  }
});

app.put('/api/admin/partners/:id', adminAuth, async(req,res)=>{
  const{name,phone,bank_account,active,sponsor_id,notes}=req.body;
  await q.update(db.users,{_id:req.params.id},{$set:{name,phone:phone||'',bank_account:bank_account||'',active:!!active,sponsor_id:sponsor_id||null,notes:notes||''}});
  res.json({ok:true});
});

// ── List all users (CRM) ──────────────────────────────────────────────────────
app.get('/api/admin/users', adminAuth, async(req,res)=>{
  try {
    const {role, search, page=1, limit=50} = req.query;
    let query = {};
    if (role && role !== 'all') {
      if (role === 'admin') query = {is_admin:true};
      else query = {user_type:role, is_admin:{$ne:true}};
    }
    let users = await q.find(db.users, query, {created_at:-1});
    if (search) {
      const s = search.toLowerCase();
      users = users.filter(u => u.name?.toLowerCase().includes(s) || u.email?.toLowerCase().includes(s) || u.phone?.includes(s));
    }
    const total = users.length;
    const offset = (parseInt(page)-1)*parseInt(limit);
    const paged = users.slice(offset, offset+parseInt(limit));
    // Attach membership status for each user
    const result = await Promise.all(paged.map(async u => {
      const m = await checkMembership(u._id);
      const loyalty = getLoyaltyStatus(u.visit_count||0);
      return {
        id:u._id, name:u.name, email:u.email, phone:u.phone||'',
        user_type:u.user_type||'lead', is_admin:!!u.is_admin,
        active:u.active!==false, created_at:u.created_at,
        visit_count:u.visit_count||0, loyalty_badge:loyalty.current?.badge||'🔵',
        loyalty_label:loyalty.current?.label||'Nováčik',
        membership: m ? {plan_name:m.plan_name,expires_at:m.expires_at,status:m.status||'active'} : null,
        sponsor_id:u.sponsor_id||null, rank:u.rank||1,
        last_booking: null,
      };
    }));
    res.json({users:result, total, page:parseInt(page), limit:parseInt(limit)});
  } catch(e){res.status(500).json({error:e.message});}
});

// ── Detailed LEADS list (Glofox-style) — only not-yet-paying users ────────────
// A lead becomes a client automatically on first paid purchase (see line ~340),
// so filtering user_type==='lead' naturally moves payers into the clients list.
// Samoopravné: Glofox člen s aktívnym členstvom / vstupmi / glofox_synced patrí medzi
// klientov, nie leady. Spustí sa pri načítaní oboch zoznamov, idempotentne.
// ── Lead pipeline: stavy starostlivosti o leada ───────────────────────────────
const LEAD_STATUSES = {
  new:            { label:'Nový',                 icon:'🆕', color:'#6c757d' },
  called_no:      { label:'Volané – nezdvihol',   icon:'📵', color:'#e0a656' },
  called_yes:     { label:'Volané – zdvihol',     icon:'📞', color:'#0d6efd' },
  sms:            { label:'SMS / správa',         icon:'💬', color:'#0dcaf0' },
  mail:           { label:'E-mail',               icon:'✉️', color:'#6f42c1' },
  interested:     { label:'Má záujem',            icon:'🔥', color:'#fd7e14' },
  not_interested: { label:'Nemá záujem',          icon:'❄️', color:'#495057' },
  trial:          { label:'Bola na hodine',       icon:'💃', color:'#20c997' },
  // spätná kompatibilita so starým stavom
  contacted:      { label:'Kontaktovaný',         icon:'📞', color:'#0d6efd' },
};
// Pri účasti na hodine automaticky posuň leada do stavu „Bola na hodine".
function applyLeadTrial(upd, u){
  if(u.user_type!=='lead') return;
  if(!u.attended_trial_at) upd.attended_trial_at = nowISO();
  if(!u.lead_status || u.lead_status==='new' || u.lead_status==='contacted') upd.lead_status = 'trial';
}

async function autoPromoteMembers(){
  const activeMemUserIds = new Set((await q.find(db.memberships,{status:'active'})).map(m=>m.user_id));
  const leads = await q.find(db.users,{user_type:'lead', is_admin:{$ne:true}});
  let n=0;
  for(const u of leads){
    if(u.glofox_synced || (u.single_entries||0)>0 || activeMemUserIds.has(u._id)){
      await q.update(db.users,{_id:u._id},{$set:{user_type:'client'}});
      n++;
    }
  }
  return n;
}

app.get('/api/admin/leads', adminAuth, async(req,res)=>{
  try {
    await autoPromoteMembers();
    const {search} = req.query;
    let leads = await q.find(db.users, {user_type:'lead', is_admin:{$ne:true}}, {created_at:-1});
    // Skry leady, ktorých email je už medzi klientmi (duplicitné záznamy)
    const clientEmails = new Set((await q.find(db.users,{user_type:'client'})).map(c=>(c.email||'').toLowerCase()).filter(Boolean));
    leads = leads.filter(u=>!(u.email && clientEmails.has(u.email.toLowerCase())));
    if(search){ const s=search.toLowerCase(); leads = leads.filter(u=>u.name?.toLowerCase().includes(s)||u.email?.toLowerCase().includes(s)||(u.phone||'').includes(s)); }
    const daysAgo = iso => { if(!iso) return null; return Math.max(0, Math.floor((Date.now()-new Date(iso).getTime())/86400000)); };
    const result = await Promise.all(leads.map(async u => {
      const bks = await q.find(db.bookings, {user_id:u._id});
      const active = bks.filter(b=>b.status!=='cancelled');
      const lastB = active.map(b=>b.booking_date||b.created_at).filter(Boolean).sort().pop() || null;
      const regPoint = (u.gclid||u.fbclid||u.utm_source || (u.referrer||'').startsWith('http')) ? 'web' : 'app';
      const attendances = u.visit_count||0;
      // "Trial" = already engaged (booked or attended) but not yet paying; else plain Lead
      const status = (attendances>0 || active.length>0) ? 'trial' : 'lead';
      const sponsor = u.sponsor_id ? (await q.one(db.users,{_id:u.sponsor_id}))?.name || null : null;
      return {
        id:u._id, name:u.name, email:u.email, phone:u.phone||'',
        created_at:u.created_at, added_days: daysAgo(u.created_at),
        reg_point: regPoint, lead_source: u.lead_source||'',
        last_contacted_at: u.last_contacted_at||null, last_contacted_days: daysAgo(u.last_contacted_at),
        bookings: active.length, last_booking: lastB, last_booking_days: daysAgo(lastB),
        status, attendances, sponsor,
        lead_status: u.lead_status || 'new',
        attended_trial_at: u.attended_trial_at || null,
        notes: u.notes || '',
        consent: !!u.consent_at,
        imported: !!u.imported, claimed: !!u.claimed,
      };
    }));
    // Konverzia lead → klient + rozklad podľa stavu
    const clientsCount = await q.count(db.users,{user_type:'client', is_admin:{$ne:true}});
    const leadsCount = result.length;
    const byStatus = {};
    for(const l of result){ byStatus[l.lead_status] = (byStatus[l.lead_status]||0)+1; }
    const denom = clientsCount + leadsCount;
    const stats = {
      leads: leadsCount, clients: clientsCount,
      conversion: denom>0 ? +(clientsCount/denom*100).toFixed(1) : 0,
      interested: (byStatus.interested||0),
      trial: (byStatus.trial||0),
      by_status: byStatus,
    };
    res.json({ leads: result, total: result.length, stats });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Vymaž duplicitné leady — lead záznamy, ktorých email už patrí klientovi
app.post('/api/admin/leads/purge-duplicates', adminAuth, async(req,res)=>{
  try {
    const clientEmails = new Set((await q.find(db.users,{user_type:'client'})).map(c=>(c.email||'').toLowerCase()).filter(Boolean));
    const leads = await q.find(db.users,{user_type:'lead', is_admin:{$ne:true}});
    const dups = leads.filter(u=>u.email && clientEmails.has(u.email.toLowerCase()));
    for(const d of dups){ await q.remove(db.users,{_id:d._id}); }
    await auditLog(req,'leads_purge_duplicates',null,{},{removed:dups.length, emails:dups.map(d=>d.email)},'');
    res.json({ ok:true, removed:dups.length, names:dups.slice(0,50).map(d=>d.name) });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Oprava už naimportovaných Glofox dát: premapuj členstvá (na správny plán) a presuň
// Glofox členov, ktorí ostali ako leady, medzi klientov.
app.post('/api/admin/glofox-repair', adminAuth, async(req,res)=>{
  try {
    let remappedMemberships=0, promoted=0;
    // 1. Premapuj plan_id Glofox členstiev podľa uloženého názvu (napr. Zumba → bronze)
    const gmembs = await q.find(db.memberships,{glofox:true});
    for(const m of gmembs){
      const newPlan = mapGlofoxPlan(m.plan_name,'');
      if(newPlan!==m.plan_id){
        await q.update(db.memberships,{_id:m._id},{$set:{plan_id:newPlan}});
        if(m.status==='active') await q.update(db.users,{_id:m.user_id},{$set:{membership_plan:newPlan}});
        remappedMemberships++;
      }
    }
    // 2. Glofox členovia (v members.csv → glofox_synced) alebo s aktívnym členstvom/vstupmi,
    //    ktorí ostali ako lead → presuň medzi klientov
    const leads = await q.find(db.users,{user_type:'lead', is_admin:{$ne:true}});
    for(const u of leads){
      const hasMem = await q.one(db.memberships,{user_id:u._id,status:'active'});
      if(u.glofox_synced || hasMem || (u.single_entries||0)>0){
        await q.update(db.users,{_id:u._id},{$set:{user_type:'client'}});
        promoted++;
      }
    }
    await auditLog(req,'glofox_repair',null,{},{remappedMemberships,promoted},'');
    res.json({ ok:true, remappedMemberships, promoted });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Mark a lead as contacted now (CRM follow-up tracking)
app.post('/api/admin/leads/:id/contacted', adminAuth, async(req,res)=>{
  try {
    const u = await q.one(db.users,{_id:req.params.id});
    if(!u) return res.status(404).json({error:'Nenájdený'});
    const set = {last_contacted_at:nowISO()};
    if(!u.lead_status || u.lead_status==='new') set.lead_status='contacted';
    await q.update(db.users,{_id:u._id},{$set:set});
    res.json({ ok:true, last_contacted_at:set.last_contacted_at, lead_status:set.lead_status||u.lead_status });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Zmena stavu leada v pipeline starostlivosti (Nový/Kontaktovaný/Má záujem/…)
app.put('/api/admin/leads/:id/status', adminAuth, async(req,res)=>{
  try {
    const {status} = req.body;
    if(!LEAD_STATUSES[status]) return res.status(400).json({error:'Neplatný stav'});
    const u = await q.one(db.users,{_id:req.params.id});
    if(!u) return res.status(404).json({error:'Nenájdený'});
    const set = {lead_status:status};
    if(status==='contacted' && !u.last_contacted_at) set.last_contacted_at=nowISO();
    await q.update(db.users,{_id:u._id},{$set:set});
    await auditLog(req,'lead_status',u._id,{old:u.lead_status||'new'},{new:status},'');
    res.json({ ok:true, lead_status:status });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Mailová sekvencia daného leada — čo mu bolo naplánované/odoslané a kedy.
app.get('/api/admin/leads/:id/emails', adminAuth, async(req,res)=>{
  try {
    const u = await q.one(db.users,{_id:req.params.id});
    if(!u) return res.status(404).json({error:'Nenájdený'});
    const items = await q.find(db.email_queue,{user_id:u._id});
    const stepIds = [...new Set(items.map(i=>i.step_id))];
    const steps = {};
    for(const sid of stepIds){ const s=await q.one(db.email_steps,{_id:sid}); if(s) steps[sid]=s; }
    const SEQ_LABELS = {
      lead_nurture:'Starostlivosť o leada', welcome:'Uvítacia sekvencia', app_launch:'Nová appka',
      membership_welcome:'Vitajte v členstve', expiry_warning:'Blíži sa koniec členstva',
      bronze_upsell:'Bronze → Silver', gold_upsell:'Silver → Gold', winback:'Winback (návrat)',
    };
    const meno = firstName(u.name)||'';
    const rows = items.map(i=>{
      const s = steps[i.step_id] || {};
      const subjP = (s.subject||'').replace(/\{meno\}/g, meno);
      const bodyP = (s.body||'').replace(/\{meno\}/g, meno);
      // Presne to isté HTML, aké dostane klientka do schránky
      const html = s.body ? emailTemplate(subjP.replace(/^[^\w]*/,''), bodyP, s.cta||null, s.cta_url||APP_URL) : '';
      return {
        sequence: i.sequence, sequence_label: SEQ_LABELS[i.sequence] || i.sequence,
        label: s.label || s.subject || '(krok)', subject: subjP,
        day: s.day, scheduled_for: i.scheduled_for, status: i.status,
        sent_at: i.sent_at || null, reason: i.reason || null,
        html,
      };
    }).sort((a,b)=> (a.scheduled_for||'').localeCompare(b.scheduled_for||'') || (a.day||0)-(b.day||0));
    // Aktívne sekvencie (majú aspoň jeden čakajúci krok)
    const activeSeqs = [...new Set(rows.filter(r=>r.status==='pending').map(r=>r.sequence_label))];
    res.json({ ok:true, name:u.name, email:u.email, lead_status:u.lead_status||'new', rows, active_sequences:activeSeqs });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Odídení klienti (winback) — kto prestal chodiť + nurture sekvencia ─────────
async function churnedClients(minDays){
  minDays = +minDays || 30;
  const clients = await q.find(db.users,{user_type:'client', is_admin:{$ne:true}, is_child:{$ne:true}, active:{$ne:false}});
  const bookings = await q.find(db.bookings,{status:'attended'});
  const lastAtt={}; for(const b of bookings){ if(!b.user_id) continue; const d=b.booking_date||(b.created_at||'').slice(0,10); if(!lastAtt[b.user_id]||d>lastAtt[b.user_id]) lastAtt[b.user_id]=d; }
  const now=Date.now(); const out=[];
  for(const u of clients){
    const last=lastAtt[u._id];
    if(!last) continue; // nikdy nebola na hodine → nie „odídená"
    const days=Math.floor((now-new Date(last).getTime())/864e5);
    if(days < minDays) continue;
    const mem=await q.one(db.memberships,{user_id:u._id, status:'active'});
    const memActive = mem && (mem.expires_at||'')>new Date().toISOString();
    const pending = await q.count(db.email_queue,{user_id:u._id, sequence:'winback', status:'pending'});
    out.push({ id:u._id, name:u.name, email:u.email, phone:u.phone||'',
      last_visit:last, days_since:days, visit_count:u.visit_count||0,
      membership: memActive?(MEMBERSHIP_PLANS[mem.plan_id]?.name||mem.plan_name||'Členstvo'):null,
      in_winback: pending>0, offers_optout: !!u.offers_optout });
  }
  out.sort((a,b)=>b.days_since-a.days_since);
  return out;
}
app.get('/api/admin/winback', adminAuth, async(req,res)=>{
  try {
    const list = await churnedClients(req.query.min_days);
    const buckets = { d30:0, d60:0, d90:0, d180:0, d365:0 };
    for(const c of list){ if(c.days_since>=365)buckets.d365++; else if(c.days_since>=180)buckets.d180++; else if(c.days_since>=90)buckets.d90++; else if(c.days_since>=60)buckets.d60++; else buckets.d30++; }
    res.json({ ok:true, clients:list, total:list.length, buckets, in_winback:list.filter(c=>c.in_winback).length });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/admin/winback/:id/enroll', adminAuth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.params.id}); if(!u) return res.status(404).json({error:'Nenájdený'});
    if(u.offers_optout) return res.status(400).json({error:'Klient sa odhlásil z ponúk'});
    await cancelSequence(u._id,'winback');
    await enqueueSequence(u._id,'winback');
    res.json({ ok:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/admin/winback/enroll-all', adminAuth, async(req,res)=>{
  try {
    const list = await churnedClients(req.body.min_days);
    let n=0;
    for(const c of list){ if(c.in_winback || c.offers_optout) continue; await enqueueSequence(c.id,'winback'); n++; }
    res.json({ ok:true, enrolled:n });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Import starých leadov (napr. z Glofox CSV) — len admin ────────────────────
// Naparsuje CSV, vloží ako skryté leady (imported:true, claimed:false, bez hesla),
// spustí im app_launch + lead_nurture sekvenciu. Ľudia si stále vytvoria účet sami
// (register „claimne" existujúci lead záznam).
function parseCsv(text){
  const rows=[]; let i=0, field='', row=[], inQ=false;
  const pushF=()=>{ row.push(field); field=''; };
  const pushR=()=>{ pushF(); rows.push(row); row=[]; };
  text=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  while(i<text.length){
    const c=text[i];
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){ field+='"'; i++; } else inQ=false; }
      else field+=c;
    } else {
      if(c==='"') inQ=true;
      else if(c===',') pushF();
      else if(c==='\n'){ pushR(); }
      else field+=c;
    }
    i++;
  }
  if(field.length||row.length) pushR();
  return rows.filter(r=>r.length>1);
}
app.post('/api/admin/import-leads', adminAuth, async(req,res)=>{
  try {
    const csv = req.body.csv||'';
    if(!csv || csv.length<10) return res.status(400).json({error:'Prázdny CSV'});
    const rows = parseCsv(csv);
    if(rows.length<2) return res.status(400).json({error:'CSV nemá dáta'});
    const head = rows[0].map(h=>h.trim().toLowerCase());
    const col = name => head.indexOf(name);
    const iFirst=col('first name'), iLast=col('last name'), iEmail=col('email'), iPhone=col('phone'),
      iGender=col('gender'), iDob=col('date of birth'), iAdded=col('added'), iSource=col('source'),
      iConsent=col('email consent'), iLastC=col('last contacted');
    if(iEmail<0) return res.status(400).json({error:'CSV nemá stĺpec Email'});
    let inserted=0, skipped=0, enrolled=0;
    for(let r=1;r<rows.length;r++){
      const row=rows[r];
      const email=(row[iEmail]||'').toLowerCase().trim();
      if(!email || !/@/.test(email)){ skipped++; continue; }
      if(await q.one(db.users,{email})){ skipped++; continue; }
      const name=[(iFirst>=0?row[iFirst]:''),(iLast>=0?row[iLast]:'')].map(x=>(x||'').trim()).filter(Boolean).join(' ')||email.split('@')[0];
      const g=(iGender>=0?row[iGender]:'').toUpperCase();
      const gender = g==='MALE'?'male':'female';
      const dobRaw=iDob>=0?(row[iDob]||''):''; const birthday=/^\d{4}-\d{2}-\d{2}/.test(dobRaw)?dobRaw.slice(0,10):'';
      const addedRaw=iAdded>=0?(row[iAdded]||''):''; const created_at=/^\d{4}-\d{2}-\d{2}/.test(addedRaw)?addedRaw.slice(0,10):today();
      const consent=iConsent>=0 && String(row[iConsent]).trim().toLowerCase()==='true';
      const src=(iSource>=0?row[iSource]:'').trim();
      let code=(name.replace(/[^a-zA-Z]/g,'').toUpperCase().slice(0,5)||'LEAD')+Math.floor(100+Math.random()*900);
      while(await q.one(db.users,{referral_code:code})) code='LEAD'+Math.floor(1000+Math.random()*9000);
      const u=await q.insert(db.users,{
        name, email, phone:(iPhone>=0?row[iPhone]:'')||'', referral_code:code,
        sponsor_id:null, rank:1, is_admin:false, active:true, user_type:'lead',
        password:null, imported:true, claimed:false, glofox_source:src,
        lead_source:'glofox', gender, birthday,
        last_contacted_at: (iLastC>=0 && /^\d{4}-\d{2}-\d{2}/.test(row[iLastC]||'')) ? row[iLastC] : null,
        consent_at: consent?nowISO():null, email_consent:consent,
        visit_count:0, referral_credit:0, notes:'Importované z Glofox',
        created_at
      });
      inserted++;
      if(consent){ // maily len ak dal súhlas
        try { await enqueueSequence(u._id,'app_launch'); await enqueueSequence(u._id,'lead_nurture'); enrolled++; } catch(e){}
      }
    }
    await auditLog(req,'import_leads',null,{},{inserted,skipped,enrolled},'');
    res.json({ ok:true, inserted, skipped, enrolled, total: rows.length-1 });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Import CLIENTOV/členov z Glofoxu — ako leady (skrytí, imported, bez hesla, claim pri registrácii),
// ale s aktívnym členstvom (Membership Expiry Date), permanentkou (Credits Remaining) a históriou návštev.
function parseFlexDate(s){
  s=(s||'').trim(); if(!s) return null;
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);          // ISO 2026-08-12...
  const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);              // DD/MM/YYYY 12/08/2026
  if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}
function mapGlofoxPlan(name,plan){
  const n=((name||'')+' '+(plan||'')).toLowerCase();
  if(n.includes('online')) return 'online_basic';
  if(n.includes('premium')) return 'gold';
  if(n.includes('permanentka')) return 'permanentka10';
  if(n.includes('jednor')) return 'vstup1';
  return 'bronze'; // generické opakované in-studio členstvo (Zumba, Basic, Fit Premena, Spoločenské tance…)
}
app.post('/api/admin/import-members', adminAuth, async(req,res)=>{
  try {
    const csv = req.body.csv||'';
    if(!csv || csv.length<10) return res.status(400).json({error:'Prázdny CSV'});
    const rows = parseCsv(csv);
    if(rows.length<2) return res.status(400).json({error:'CSV nemá dáta'});
    const head = rows[0].map(h=>h.trim().toLowerCase());
    const col = name => head.indexOf(name);
    // Nájdi stĺpec podľa zoznamu možných názvov: najprv presná zhoda, potom „obsahuje".
    const colAny = (...names) => {
      for(const n of names){ const i=head.indexOf(n); if(i>=0) return i; }
      for(const n of names){ const i=head.findIndex(h=>h.includes(n)); if(i>=0) return i; }
      return -1;
    };
    const iFirst=col('first name'), iLast=col('last name'), iEmail=col('email'), iPhone=col('phone'),
      iGender=col('gender'), iDob=col('date of birth'), iAdded=col('added'), iSource=col('source'),
      iConsent=col('email consent'), iLastC=col('last contacted'),
      // Návštevy/odtancované hodiny — Glofox používa rôzne názvy hlavičky.
      // Berieme VYŠŠIU z „Total Bookings" a „Total Attendances", lebo tréneri
      // často nepotvrdia všetky hodiny → attendances podhodnocuje skutočný počet.
      iAtt=colAny('total attendances','attendances','total classes attended','classes attended','attended classes','total classes','visits'),
      iBook=colAny('total bookings','bookings','booked classes'),
      iMemName=col('membership name'), iMemPlan=col('membership plan'),
      iMemExp=col('membership expiry date'), iCredits=col('credits remaining');
    if(iEmail<0) return res.status(400).json({error:'CSV nemá stĺpec Email'});
    const todayStr = today();
    // Vytvor Glofox členstvo pre daného usera (ak má platnosť do budúcna a ešte nemá aktívne)
    async function applyGlofoxMembership(userId, memName, memPlan, memExp, started){
      if(!(memExp && memExp>=todayStr)) return false;
      const hasActive = await q.one(db.memberships,{user_id:userId,status:'active'});
      if(hasActive) return false;
      const planId=mapGlofoxPlan(memName,memPlan);
      const expiresISO=memExp+'T23:59:59.000Z';
      await q.insert(db.memberships,{user_id:userId, plan_id:planId, plan_name:(memName||memPlan||'Členstvo'),
        status:'active', started_at:started||todayStr, expires_at:expiresISO, migrated:true, glofox:true, created_at:nowISO()});
      await q.update(db.users,{_id:userId},{$set:{membership_plan:planId, membership_expires:expiresISO}});
      return true;
    }
    let inserted=0, merged=0, skipped=0, withMembership=0, withEntries=0, enrolled=0;
    for(let r=1;r<rows.length;r++){
      const row=rows[r];
      const email=(row[iEmail]||'').toLowerCase().trim();
      if(!email || !/@/.test(email)){ skipped++; continue; }
      const name=[(iFirst>=0?row[iFirst]:''),(iLast>=0?row[iLast]:'')].map(x=>(x||'').trim()).filter(Boolean).join(' ')||email.split('@')[0];
      const g=(iGender>=0?row[iGender]:'').toUpperCase();
      const gender = g==='MALE'?'male':'female';
      const birthday=parseFlexDate(iDob>=0?row[iDob]:'')||'';
      const created_at=parseFlexDate(iAdded>=0?row[iAdded]:'')||todayStr;
      const consent=iConsent>=0 && String(row[iConsent]).trim().toLowerCase()==='true';
      const src=(iSource>=0?row[iSource]:'').trim();
      const attVal=Math.max(0, parseInt(iAtt>=0?row[iAtt]:'0',10)||0);
      const bookVal=Math.max(0, parseInt(iBook>=0?row[iBook]:'0',10)||0);
      const attendances=Math.max(attVal, bookVal); // vyššia z potvrdených a rezervovaných hodín
      const credits=Math.max(0, parseInt(iCredits>=0?row[iCredits]:'0',10)||0);
      const memName=(iMemName>=0?row[iMemName]:'').trim();
      const memPlan=(iMemPlan>=0?row[iMemPlan]:'').trim();
      const memExp=parseFlexDate(iMemExp>=0?row[iMemExp]:'');

      // ── Účet už existuje → doplň mu vstupy/členstvo (idempotentne cez glofox_synced) ──
      const existing=await q.one(db.users,{email});
      if(existing){
        const upd={};
        // Návštevy vždy dorovnaj podľa Glofox záznamov (opraví aj skôr naimportované)
        if(attendances > (existing.visit_count||0)) upd.visit_count = attendances;
        if(attendances) upd.glofox_attendances = attendances;
        if(existing.glofox_synced){
          // Už zosynchronizované — aktualizuj len návštevy, nič sa nezdvojí
          if(Object.keys(upd).length){ await q.update(db.users,{_id:existing._id},{$set:upd}); merged++; }
          else skipped++;
          continue;
        }
        upd.glofox_synced=true;
        // Glofox člen → patrí medzi klientov (nie leady), aj keď sa už registroval
        if(existing.user_type==='lead') upd.user_type='client';
        if(credits>0){ upd.single_entries=(existing.single_entries||0)+credits; withEntries++; }
        if(!existing.glofox_membership) upd.glofox_membership=memName||memPlan||'';
        await q.update(db.users,{_id:existing._id},{$set:upd});
        if(await applyGlofoxMembership(existing._id, memName, memPlan, memExp, created_at)) withMembership++;
        merged++;
        continue;
      }

      let code=(name.replace(/[^a-zA-Z]/g,'').toUpperCase().slice(0,5)||'CLNT')+Math.floor(100+Math.random()*900);
      while(await q.one(db.users,{referral_code:code})) code='CLNT'+Math.floor(1000+Math.random()*9000);
      const u=await q.insert(db.users,{
        name, email, phone:(iPhone>=0?row[iPhone]:'')||'', referral_code:code,
        sponsor_id:null, rank:1, is_admin:false, active:true, user_type:'client',
        password:null, imported:true, claimed:false, glofox_source:src, glofox_synced:true,
        lead_source:'glofox', gender, birthday,
        last_contacted_at: (iLastC>=0 && parseFlexDate(row[iLastC])) ? row[iLastC] : null,
        consent_at: consent?nowISO():null, email_consent:consent,
        visit_count:attendances, glofox_attendances:attendances, single_entries:credits, referral_credit:0,
        // Prvú hodinu zdarma už mali v Glofoxe → tá jedna zdarma sa im pridá až pri
        // registrácii do novej appky (+1 free_credit v claime), nedvojí sa.
        free_class_used:true,
        notes:'Importované z Glofox (člen)', glofox_membership:memName||memPlan||'',
        created_at
      });
      inserted++;
      if(credits>0) withEntries++;
      if(await applyGlofoxMembership(u._id, memName, memPlan, memExp, created_at)) withMembership++;
      if(consent){ try { await enqueueSequence(u._id,'app_launch'); enrolled++; } catch(e){} }
    }
    await auditLog(req,'import_members',null,{},{inserted,merged,skipped,withMembership,withEntries,enrolled},'');
    res.json({ ok:true, inserted, merged, skipped, withMembership, withEntries, enrolled, total: rows.length-1 });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Import histórie príjmov z Glofox (Reports → Transactions → Download full report CSV).
// Vloží PAID platby (>0 €) ako záznamy do db.payments (status completed) → účtovníctvo ich započíta.
// Idempotentné cez glofox_key (Transaction ID alebo dátum+čas+email+suma).
app.post('/api/admin/import-income', adminAuth, async(req,res)=>{
  try {
    const csv = req.body.csv||'';
    if(!csv || csv.length<10) return res.status(400).json({error:'Prázdny CSV'});
    const rows = parseCsv(csv);
    if(rows.length<2) return res.status(400).json({error:'CSV nemá dáta'});
    const head = rows[0].map(h=>h.trim().toLowerCase());
    const col = n => head.indexOf(n);
    const iDate=col('date'), iTime=col('time'), iMember=col('member'), iEmail=col('email address'),
      iSoldBy=col('sold by'), iCharge=col('charge'), iPlan=col('plan'), iMethod=col('method'),
      iAmount=head.findIndex(h=>h.startsWith('amount')), iStatus=col('status'), iTxid=col('transaction id');
    if(iAmount<0||iStatus<0||iDate<0) return res.status(400).json({error:'CSV nemá stĺpce Date/Amount/Status (Glofox Transactions export)'});
    const mapMethod=m=>{ m=(m||'').toLowerCase(); if(m.includes('card'))return 'card'; if(m.includes('cash'))return 'cash'; if(m.includes('bank'))return 'bank'; if(m.includes('complimentary'))return 'complimentary'; return m||'other'; };
    const toISO=(d,t)=>{ const [dd,mm,yy]=(d||'').split('/'); if(!yy) return null; return `${yy}-${mm}-${dd}T${(t||'00:00')}:00.000Z`; };
    let imported=0, skipped=0, dupes=0; let totalEur=0;
    const seenComposite={}; // pre stabilné odlíšenie identických riadkov v rámci súboru
    for(let r=1;r<rows.length;r++){
      const row=rows[r];
      const status=(row[iStatus]||'').toUpperCase();
      const amount=Math.round((parseFloat(row[iAmount])||0)*100)/100;
      if(status!=='PAID' || amount<=0){ skipped++; continue; }
      const email=(iEmail>=0?row[iEmail]:'').toLowerCase().trim();
      const iso=toISO(row[iDate], iTime>=0?row[iTime]:'');
      if(!iso){ skipped++; continue; }
      const txid=(iTxid>=0?(row[iTxid]||'').trim():'');
      let key;
      if(txid && txid!=='-'){ key='gf:'+txid; }
      else {
        const comp=[row[iDate],iTime>=0?row[iTime]:'',email,amount,(iCharge>=0?row[iCharge]:'')].join('|');
        const n=(seenComposite[comp]=(seenComposite[comp]||0)+1); // 1,2,3… pre identické riadky
        key='gf:'+comp+'#'+n;
      }
      if(await q.one(db.payments,{glofox_key:key})){ dupes++; continue; }
      const user = email ? await q.one(db.users,{email}) : null;
      const plan = (iPlan>=0&&row[iPlan]&&row[iPlan]!=='-') ? row[iPlan] : (iCharge>=0?(row[iCharge]||'Platba'):'Platba');
      await q.insert(db.payments,{
        glofox_import:true, glofox_key:key,
        status:'completed', amount, currency:'EUR',
        plan_name: plan, method: mapMethod(iMethod>=0?row[iMethod]:''),
        provider: mapMethod(iMethod>=0?row[iMethod]:''),
        user_id: user?user._id:null, member_name: iMember>=0?row[iMember]:'', member_email: email,
        sold_by: iSoldBy>=0?row[iSoldBy]:'', charge: iCharge>=0?row[iCharge]:'',
        created_at: iso, captured_at: iso,
      });
      imported++; totalEur+=amount;
    }
    await auditLog(req,'import_income',null,{},{imported,dupes,skipped,totalEur:+totalEur.toFixed(2)},'');
    res.json({ ok:true, imported, dupes, skipped, total:rows.length-1, totalEur:+totalEur.toFixed(2) });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Chase neúspešných platieb (dunning) ───────────────────────────────────────
const DUNNING_DAYS = [0, 3, 7]; // upomienka pri zlyhaní, potom +3 a +7 dní
function dunningEmail(u, payment, stage){
  const amt = (+payment.amount||0).toFixed(2);
  const what = payment.description || payment.plan_name || 'členstvo';
  const bodies = [
    `<p>Ahoj <b>${u.name}</b>,</p><p>Automatická platba za tvoje <b>${what}</b> (${amt} €) bohužiaľ neprešla 😟. Zvyčajne stačí skontrolovať platnosť karty alebo zostatok.</p><p>Aktualizuj si platobné údaje, aby ti členstvo nevypršalo.</p>`,
    `<p>Ahoj <b>${u.name}</b>,</p><p>Pripomíname, že platba za <b>${what}</b> (${amt} €) stále neprešla. Nech ti neprepadne členstvo, prosím aktualizuj si platbu.</p><p>Ak máš otázku, stačí odpovedať na tento email. 💛</p>`,
    `<p>Ahoj <b>${u.name}</b>,</p><p>Toto je posledná pripomienka — platba za <b>${what}</b> (${amt} €) sa nepodarila. Ak ju nevyriešiš, členstvo sa môže pozastaviť.</p><p>Vyrieš to jedným klikom nižšie. Radi ťa uvidíme na parkete! 💃</p>`,
  ];
  const titles = ['Platba sa nepodarila', 'Pripomienka platby', 'Posledná pripomienka platby'];
  return { subject: `⚠️ ${titles[stage]||titles[0]} (${amt} €)`,
    html: emailTemplate(titles[stage]||titles[0], bodies[stage]||bodies[0], '💳 Aktualizovať platbu', `${APP_URL}/pricing`) };
}
async function sendDunning(payment, stage){
  const u = await q.one(db.users,{_id:payment.user_id});
  if(!u?.email) return false;
  const e = dunningEmail(u, payment, stage);
  await sendMail(u.email, e.subject, e.html).catch(()=>{});
  await q.insert(db.notifications,{user_id:u._id,type:'payment_failed',title:'⚠️ Platba zlyhala',body:`${(+payment.amount||0).toFixed(2)} € – skontroluj platobné údaje.`,read:false,created_at:nowISO()}).catch(()=>{});
  await q.update(db.payments,{_id:payment._id},{$set:{reminders_sent:(payment.reminders_sent||0)+1, last_reminder_at:nowISO(), dunning_stage:stage}});
  return true;
}
// Zaznamenaj zlyhanú platbu (idempotentne cez stripe_invoice_id) a pošli 1. upomienku
async function recordFailedPayment({user_id, amount, description, plan_name, provider, invoice_id}){
  if(invoice_id){ const ex=await q.one(db.payments,{stripe_invoice_id:invoice_id}); if(ex) return ex; }
  const p = await q.insert(db.payments,{ status:'failed', user_id, amount:+amount||0, currency:'EUR',
    description:description||'', plan_name:plan_name||'', provider:provider||'stripe',
    stripe_invoice_id:invoice_id||null, failed_at:nowISO(), reminders_sent:0, dunning_stage:-1, resolved:false, created_at:nowISO() });
  await sendDunning(p, 0);
  return p;
}
// Po úspešnej platbe klienta vybav jeho zlyhané platby
async function resolveFailedPayments(userId){
  if(!userId) return 0;
  const n = await q.update(db.payments,{user_id:userId, status:'failed', resolved:{$ne:true}},{$set:{resolved:true, resolved_at:nowISO(), resolved_reason:'payment_succeeded'}},{multi:true});
  return n;
}
app.get('/api/admin/failed-payments', adminAuth, async(req,res)=>{
  try {
    const all = (await q.find(db.payments,{status:'failed'})).filter(p=>!p.resolved);
    const rows = await Promise.all(all.map(async p=>{
      const u = p.user_id ? await q.one(db.users,{_id:p.user_id}) : null;
      const days = Math.floor((Date.now()-new Date(p.failed_at||p.created_at).getTime())/86400000);
      return { id:p._id, name:u?.name||p.member_name||'—', email:u?.email||p.member_email||'', amount:+p.amount||0,
        description:p.description||p.plan_name||'Členstvo', failed_at:(p.failed_at||p.created_at||'').slice(0,10),
        days, reminders_sent:p.reminders_sent||0, last_reminder_at:(p.last_reminder_at||'').slice(0,10) };
    }));
    rows.sort((a,b)=>b.days-a.days);
    res.json({ count:rows.length, owed:+rows.reduce((s,r)=>s+r.amount,0).toFixed(2), rows });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/admin/failed-payments/:id/remind', adminAuth, async(req,res)=>{
  try {
    const p = await q.one(db.payments,{_id:req.params.id, status:'failed'}); if(!p) return res.status(404).json({error:'Nenájdené'});
    const ok = await sendDunning(p, Math.min(p.reminders_sent||0, DUNNING_DAYS.length-1));
    await auditLog(req,'dunning_manual',p._id,{},{reminders_sent:(p.reminders_sent||0)+1},'');
    res.json({ ok });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/admin/failed-payments/:id/resolve', adminAuth, async(req,res)=>{
  try {
    const p = await q.one(db.payments,{_id:req.params.id}); if(!p) return res.status(404).json({error:'Nenájdené'});
    await q.update(db.payments,{_id:p._id},{$set:{resolved:true, resolved_at:nowISO(), resolved_reason:req.body.reason||'manual'}});
    await auditLog(req,'dunning_resolve',p._id,{},{reason:req.body.reason||'manual'},'');
    res.json({ ok:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Detailed CLIENTS list (paying members only — leads have their own tab) ────
// ── Testovacie účty: detekcia + kaskádové zmazanie (pred ostrým spustením) ────
function isTestAccount(u){
  if(!u) return false;
  if(u.is_admin || u.is_founder || u.user_type==='trainer' || u.user_type==='manager') return false;
  if(u.imported) return false; // importované Glofox leady sú reálne
  const email=(u.email||'').toLowerCase();
  const name=(u.name||'').toLowerCase();
  if(/@ex\.com$|@example\.com$|@example\.org$|@test\.|@mailinator\./.test(email)) return true;
  if(/\d{10,}@/.test(email)) return true; // timestamp e-maily z testov
  if(/test|webhook|stripe|resend|demo|porttest/.test(email)) return true; // testovacie e-maily
  if(/test|bot|webhook|stripe|payout|demo/i.test(name)) return true; // aj „test2", „Test Email"…
  if(/^novy \d/.test(name) || /mesacna sponzorka|bea mid|sp test|cierny test|alica dm|cyntia/.test(name)) return true;
  return false;
}
async function detectTestUsers(){ return (await q.find(db.users,{})).filter(isTestAccount); }
app.get('/api/admin/test-accounts', adminAuth, async(req,res)=>{
  const list=await detectTestUsers();
  res.json({ total:list.length, accounts:list.map(u=>({id:u._id,name:u.name,email:u.email,user_type:u.user_type||'lead',created_at:u.created_at})) });
});
app.post('/api/admin/test-accounts/purge', adminAuth, async(req,res)=>{
  try {
    const list = await detectTestUsers();
    const ids = list.map(u=>u._id);
    const emails = list.map(u=>(u.email||'').toLowerCase()).filter(Boolean);
    let removed = { users:0, bookings:0, memberships:0, commissions:0, transactions:0, notifications:0, feed:0, friends:0, likes:0, comments:0, orders:0, payments:0 };
    for(const id of ids){
      removed.bookings     += await q.remove(db.bookings,{user_id:id},{multi:true});
      removed.memberships  += await q.remove(db.memberships,{user_id:id},{multi:true});
      removed.commissions  += await q.remove(db.commissions,{$or:[{partner_id:id},{source_partner_id:id}]},{multi:true});
      removed.transactions += await q.remove(db.transactions,{$or:[{user_id:id},{partner_id:id},{client_id:id}]},{multi:true});
      removed.notifications+= await q.remove(db.notifications,{$or:[{user_id:id},{from_id:id}]},{multi:true});
      removed.feed         += await q.remove(db.feed,{author_id:id},{multi:true});
      removed.friends      += await q.remove(db.friends,{pair:new RegExp(id)},{multi:true});
      removed.likes        += await q.remove(db.profile_likes,{$or:[{profile_id:id},{liker_id:id}]},{multi:true});
      removed.comments     += await q.remove(db.profile_comments,{$or:[{profile_id:id},{author_id:id}]},{multi:true});
      removed.payments     += await q.remove(db.payments,{user_id:id},{multi:true});
      // odpoj referencie u ostatných reálnych používateľov
      await q.update(db.users,{sponsor_id:id},{$set:{sponsor_id:null}},{multi:true});
      await q.update(db.users,{assistant_of:id},{$set:{assistant_of:null,is_assistant:false}},{multi:true});
    }
    for(const em of emails){ removed.orders += await q.remove(db.orders,{client_email:em},{multi:true}); }
    removed.users += await q.remove(db.users,{_id:{$in:ids}},{multi:true});
    await auditLog(req,'purge_test_accounts',null,{},{count:ids.length,removed},'');
    res.json({ ok:true, removed });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/admin/clients', adminAuth, async(req,res)=>{
  try {
    await autoPromoteMembers();
    const {search} = req.query;
    let clients = await q.find(db.users, {user_type:'client', is_admin:{$ne:true}}, {created_at:-1});
    if(search){ const s=search.toLowerCase(); clients = clients.filter(u=>u.name?.toLowerCase().includes(s)||u.email?.toLowerCase().includes(s)||(u.phone||'').includes(s)); }
    // Load all bookings once and group (avoid N queries)
    const allB = await q.find(db.bookings, {});
    const byUser = {};
    for(const b of allB){ if(!b.user_id) continue; (byUser[b.user_id]=byUser[b.user_id]||[]).push(b); }
    const result = await Promise.all(clients.map(async u => {
      const m = await checkMembership(u._id);
      const bks = (byUser[u._id]||[]).filter(b=>b.status!=='cancelled');
      return {
        id:u._id, name:u.name, email:u.email, phone:u.phone||'', avatar:u.avatar||null,
        membership: m ? (MEMBERSHIP_PLANS[m.plan_id]?.name||m.plan_name||null) : null,
        expires_at: m ? (m.expires_at||'').slice(0,10) : null,
        credits: u.referral_credit||0,
        entries: u.single_entries||0,
        free_credits: u.free_credits||0,
        bookings: bks.length,
        attendances: u.visit_count||0,
        active: u.active!==false,
      };
    }));
    res.json({ clients: result, total: result.length });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Set user role ─────────────────────────────────────────────────────────────
app.put('/api/admin/users/:id/role', adminAuth, async(req,res)=>{
  const {user_type} = req.body;
  const validRoles = Object.keys(USER_ROLES);
  if (!validRoles.includes(user_type)) return res.status(400).json({error:'Neplatná rola'});
  const u = await q.one(db.users,{_id:req.params.id});
  if (!u) return res.status(404).json({error:'Nenájdený'});
  const isAdmin = user_type === 'admin';
  await q.update(db.users,{_id:req.params.id},{$set:{user_type, is_admin:isAdmin}});
  // Notify user about role change
  await q.insert(db.notifications,{user_id:req.params.id,type:'role_change',title:`Vaša rola bola zmenená`,body:`Nová rola: ${USER_ROLES[user_type]?.label||user_type}`,read:false,created_at:nowISO()});
  res.json({ok:true, user_type});
});

// ── Update user profile (admin) ───────────────────────────────────────────────
app.put('/api/admin/users/:id', adminAuth, async(req,res)=>{
  try {
    const {name, email, phone, notes, bank_account, sponsor_id, visit_count} = req.body;
    const upd = {};
    if(name !== undefined) upd.name = name.trim();
    if(email !== undefined){
      const newEmail = email.toLowerCase().trim();
      // Check email not taken by another user
      const existing = await q.one(db.users,{email:newEmail});
      if(existing && existing._id !== req.params.id) return res.status(400).json({error:'Tento email už používa iný účet'});
      upd.email = newEmail;
    }
    if(phone !== undefined) upd.phone = phone;
    if(notes !== undefined) upd.notes = notes;
    if(bank_account !== undefined) upd.bank_account = bank_account;
    if(sponsor_id !== undefined) upd.sponsor_id = sponsor_id || null;
    if(visit_count !== undefined) upd.visit_count = Math.max(0,parseInt(visit_count)||0);
    await q.update(db.users,{_id:req.params.id},{$set:upd});
    res.json({ok:true});
  } catch(e){res.status(500).json({error:e.message});}
});

// ── Lite user list for pickers (client & sponsor selectors) ───────────────────
app.get('/api/admin/users-lite', adminAuth, async(req,res)=>{
  const all = await q.find(db.users,{});
  const nameMap = Object.fromEntries(all.map(u=>[u._id,u.name])); // resolve sponsor names incl. admins (Marek)
  res.json(all.filter(u=>!u.is_child).map(u=>({
    id:u._id, name:u.name, email:u.email, referral_code:u.referral_code||'',
    user_type:u.is_admin?'admin':(u.user_type||'client'),
    sponsor_id:u.sponsor_id||null, sponsor_name:u.sponsor_id?(nameMap[u.sponsor_id]||'—'):null
  })).sort((a,b)=>a.name.localeCompare(b.name)));
});

// ── CRM stats ─────────────────────────────────────────────────────────────────
app.get('/api/admin/crm/stats', adminAuth, async(req,res)=>{
  try {
    const allUsers = await q.find(db.users,{is_admin:{$ne:true}});
    const stats = {
      total: allUsers.length,
      leads: allUsers.filter(u=>u.user_type==='lead'||!u.user_type).length,
      clients: allUsers.filter(u=>u.user_type==='client').length,
      trainers: allUsers.filter(u=>u.user_type==='trainer').length,
      partners: allUsers.filter(u=>u.user_type==='partner'||u.user_type==='manager').length,
      active: allUsers.filter(u=>u.active!==false).length,
      blocked: allUsers.filter(u=>u.active===false).length,
    };
    // New registrations this month
    const monthStart = currentMonth()+'-01';
    stats.new_this_month = allUsers.filter(u=>u.created_at>=monthStart).length;
    // Lead → client conversion: how many of all (leads+clients) became paying clients
    const funnel = stats.leads + stats.clients;
    stats.conversion_rate = funnel ? +((stats.clients/funnel)*100).toFixed(1) : 0;
    res.json(stats);
  } catch(e){res.status(500).json({error:e.message});}
});

// ── CRM automation – send email to a category ─────────────────────────────────
app.post('/api/admin/crm/email', adminAuth, async(req,res)=>{
  try {
    const {category, subject, html_body} = req.body;
    if(!category||!subject||!html_body) return res.status(400).json({error:'Kategória, predmet a text sú povinné'});
    let query = {};
    if(category==='leads')           query={user_type:'lead',active:{$ne:false}};
    else if(category==='clients')    query={user_type:'client',active:{$ne:false}};
    else if(category==='partners')   query={user_type:{$in:['partner','manager']},active:{$ne:false}};
    else if(category==='trainers')   query={user_type:'trainer',active:{$ne:false}};
    else if(category==='all')        query={is_admin:{$ne:true},active:{$ne:false}};
    else return res.status(400).json({error:'Neznáma kategória'});
    const users = await q.find(db.users,query);
    let sent = 0;
    for(const u of users){
      if(u.email){
        await sendMail(u.email, subject, html_body).catch(()=>{});
        sent++;
      }
    }
    res.json({ok:true, sent});
  } catch(e){res.status(500).json({error:e.message});}
});

// ── Test email ────────────────────────────────────────────────────────────────
app.post('/api/admin/crm/test-email', adminAuth, async(req,res)=>{
  try {
    const recipient = req.body.to || process.env.SMTP_USER;
    if(!recipient) return res.status(400).json({error:'SMTP_USER nie je nastavený'});
    await sendMail(recipient, '✅ Testovací email – Fusion Academy',
      emailTemplate('Email funguje! ✅',
        `<p>Tento email potvrdzuje, že emailové notifikácie sú správne nakonfigurované.</p><p>Odosielateľ: <b>${process.env.SMTP_USER}</b></p><p>Automatické emaily (expiry warning, reminder pred hodinou, follow-up) budú chodiť odteraz automaticky každý deň o 8:00.</p>`,
        '💃 Otvoriť aplikáciu', process.env.APP_URL||'http://localhost:3000'));
    res.json({ok:true, sent_to: recipient});
  } catch(e){ res.status(500).json({error: e.message}); }
});

// ── CRM automation – expiry warnings (call manually or via cron) ───────────────
app.post('/api/admin/crm/send-expiry-warnings', adminAuth, async(req,res)=>{
  try {
    const in7days = new Date(); in7days.setDate(in7days.getDate()+7);
    const d7 = in7days.toISOString().slice(0,10);
    const expiring = await q.find(db.memberships,{expires_at:{$lte:d7},expires_at:{$gte:today()},status:'active'});
    let sent = 0;
    for(const m of expiring){
      const u = await q.one(db.users,{_id:m.user_id});
      if(u?.email){
        await sendMail(u.email,'⚠️ Tvoje členstvo čoskoro vyprší',`<h2>Ahoj ${u.name}!</h2><p>Tvoje členstvo <b>${m.plan_name}</b> vyprší <b>${m.expires_at}</b>.</p><p>👉 <a href="${APP_URL}/pricing">Obnov si členstvo</a> a neprerušuj svoju cestu!</p><p><i>Fusion Academy tím 💃</i></p>`).catch(()=>{});
        await q.insert(db.notifications,{user_id:u._id,type:'expiry_warning',title:'⚠️ Členstvo čoskoro vyprší',body:`${m.plan_name} vyprší ${m.expires_at}`,read:false,created_at:nowISO()});
        sent++;
      }
    }
    res.json({ok:true, sent});
  } catch(e){res.status(500).json({error:e.message});}
});

// ── Admin manual visit count adjust ──────────────────────────────────────────
app.put('/api/admin/users/:id/visits', adminAuth, async(req,res)=>{
  const {visit_count} = req.body;
  if(typeof visit_count !== 'number') return res.status(400).json({error:'Neplatné číslo'});
  await q.update(db.users,{_id:req.params.id},{$set:{visit_count}});
  res.json({ok:true, visit_count});
});

// ── Block / Unblock user
app.post('/api/admin/users/:id/block', adminAuth, async(req,res)=>{
  const u=await q.one(db.users,{_id:req.params.id});
  if(!u) return res.status(404).json({error:'Nenájdený'});
  if(u.is_admin) return res.status(400).json({error:'Admin účet nemožno blokovať'});
  await q.update(db.users,{_id:req.params.id},{$set:{active:false,blocked_at:nowISO(),blocked_reason:req.body.reason||''}});
  res.json({ok:true});
});
app.post('/api/admin/users/:id/unblock', adminAuth, async(req,res)=>{
  await q.update(db.users,{_id:req.params.id},{$set:{active:true,blocked_at:null,blocked_reason:''}});
  res.json({ok:true});
});

// ── Delete user account (+ all their data)
app.delete('/api/admin/users/:id', adminAuth, async(req,res)=>{
  const u=await q.one(db.users,{_id:req.params.id});
  if(!u) return res.status(404).json({error:'Nenájdený'});
  if(u.is_admin) return res.status(400).json({error:'Admin účet nemožno zmazať'});
  // Remove all related data
  await q.remove(db.users,      {_id:req.params.id});
  await q.remove(db.transactions,{partner_id:req.params.id},{multi:true});
  await q.remove(db.commissions, {partner_id:req.params.id},{multi:true});
  await q.remove(db.bookings,    {user_id:req.params.id},   {multi:true});
  // Re-assign their downline to their own sponsor
  const sponsorId = u.sponsor_id || null;
  await q.update(db.users,{sponsor_id:req.params.id},{$set:{sponsor_id:sponsorId}},{multi:true});
  res.json({ok:true});
});

app.post('/api/admin/transactions', adminAuth, async(req,res)=>{
  try {
    const{client_id,product_id,amount,notes,date}=req.body;
    let {partner_id,client_name}=req.body;
    // If a real client account is chosen, use its name and auto-derive the sponsor
    // (the person who registered them) as the commission recipient — unless an
    // explicit partner_id override was provided.
    let client=null;
    if(client_id){
      client=await q.one(db.users,{_id:client_id});
      if(client){
        client_name = client_name || client.name;
        if(!partner_id) partner_id = client.sponsor_id || null;
      }
    }
    if(!client_name||!amount) return res.status(400).json({error:'Klient a suma sú povinné'});
    const prod=product_id?await q.one(db.products,{_id:product_id}):null;
    const product_name=prod?prod.name:(req.body.product_name||'Iný predaj');
    const finalAmt=+parseFloat(amount).toFixed(2);
    const tx=await q.insert(db.transactions,{partner_id:partner_id||null,client_id:client_id||null,client_name,product_id:product_id||null,product_name,amount:finalAmt,date:date||today(),notes:notes||''});
    // Commission only when we have a recipient (sponsor or explicit partner)
    if(partner_id){ await saveCommissions(tx._id,partner_id,finalAmt); await calcRank(partner_id); }
    res.json({ok:true,id:tx._id,commission:!!partner_id,partner_id:partner_id||null});
  } catch(e){res.status(500).json({error:e.message});}
});

app.delete('/api/admin/transactions/:id', adminAuth, async(req,res)=>{
  await q.remove(db.commissions,{transaction_id:req.params.id},{multi:true});
  await q.remove(db.transactions,{_id:req.params.id});
  res.json({ok:true});
});

app.get('/api/admin/orders', adminAuth, async(req,res)=>{
  const{status}=req.query;
  const filter=status?{status}:{};
  const orders=await q.find(db.orders,filter);
  orders.sort((a,b)=>b.created_at.localeCompare(a.created_at));
  res.json(orders);
});

app.put('/api/admin/orders/:id', adminAuth, async(req,res)=>{
  try {
    const{status, take}=req.body;
    const order=await q.one(db.orders,{_id:req.params.id});
    if(!order) return res.status(404).json({error:'Nenájdená'});
    // „Prevziať" — priradí objednávku aktuálnemu adminovi (kto to vybavuje)
    if(take){
      const me=await q.one(db.users,{_id:req.session.uid});
      await q.update(db.orders,{_id:req.params.id},{$set:{handled_by:req.session.uid, handled_by_name:me?.name||'', handled_at:nowISO()}});
      await auditLog(req,'order_take',order.order_number,{},{by:me?.name},'');
      if(!status) return res.json({ok:true, handled_by_name:me?.name||''});
    }
    if(!status) return res.json({ok:true});
    await q.update(db.orders,{_id:req.params.id},{$set:{status,updated_at:nowISO(),...(status==='paid'?{paid_at:nowISO()}:{})}});
    if(status==='paid' && order.status!=='paid'){
      // Kto objednávku kúpil (ak je to náš člen) — pre províziu po jeho sponzorskej línii
      const esc=s=>String(s||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const buyer = order.client_email
        ? await q.one(db.users,{email:new RegExp('^'+esc(order.client_email.trim())+'$','i')})
        : null;
      if(buyer && buyer.sponsor_id){
        // Provízia hore po genealógii kupujúceho (rovnako ako pri členstve).
        // Sponzor tak dostane affiliate kredit aj za merch kúpený niekým v jeho línii.
        for(const item of order.items){
          await awardPurchaseCommission({ buyer_id: buyer._id, amount:item.subtotal, product_name: item.product_name });
        }
      } else if(order.partner_id){
        // Predaj cez referral kód (kupujúci nie je náš člen) — provízia referrerovi.
        for(const item of order.items){
          const tx=await q.insert(db.transactions,{partner_id:order.partner_id,client_name:order.client_name,product_id:item.product_id||null,product_name:item.product_name,amount:item.subtotal,date:today(),notes:'E-shop objednávka '+order.order_number,order_id:order._id});
          await saveCommissions(tx._id,order.partner_id,item.subtotal);
        }
        await calcRank(order.partner_id);
      }
      grantMerchFromOrder(order);
    }
    res.json({ok:true});
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/admin/commissions/summary', adminAuth, async(req,res)=>{
  const month=req.query.month||currentMonth();
  const allU=await q.find(db.users,{is_admin:{$ne:true}});
  const allC=await q.find(db.commissions,{month});
  const result=allU.map(u=>{
    const uc=allC.filter(c=>c.partner_id===u._id);
    const pending=uc.filter(c=>c.status==='pending').reduce((s,c)=>s+c.amount,0);
    const paid=uc.filter(c=>c.status==='paid').reduce((s,c)=>s+c.amount,0);
    return{id:u._id,name:u.name,email:u.email,bank_account:u.bank_account||'',rank:u.rank||1,rankName:RANKS[(u.rank||1)-1].name,pending:+pending.toFixed(2),paid:+paid.toFixed(2)};
  }).filter(r=>r.pending>0||r.paid>0);
  result.sort((a,b)=>b.pending-a.pending);
  res.json(result);
});

app.post('/api/admin/commissions/pay', adminAuth, async(req,res)=>{
  const{partner_id,month}=req.body;
  await q.update(db.commissions,{partner_id,month:month||currentMonth(),status:'pending'},{$set:{status:'paid',paid_at:nowISO()}},{multi:true});
  res.json({ok:true});
});

app.get('/api/admin/commissions/detail', adminAuth, async(req,res)=>{
  const{partner_id,month}=req.query;
  const comms=await q.find(db.commissions,{partner_id,month:month||currentMonth()});
  const allTx=await q.find(db.transactions,{}), allU=await q.find(db.users,{});
  const txMap=Object.fromEntries(allTx.map(t=>[t._id,t]));
  const uMap=Object.fromEntries(allU.map(u=>[u._id,u.name]));
  res.json(comms.map(c=>({...c,client_name:txMap[c.transaction_id]?.client_name||'—',product_name:txMap[c.transaction_id]?.product_name||'—',tx_amount:txMap[c.transaction_id]?.amount||0,source_name:uMap[c.source_partner_id]||'—'})).sort((a,b)=>b.created_at.localeCompare(a.created_at)));
});

app.post('/api/admin/products', adminAuth, async(req,res)=>{
  const{name,cat,desc,emoji,price,commission_rate,type}=req.body;
  if(!name||!price) return res.status(400).json({error:'Vyplňte name a cenu'});
  const p=await q.insert(db.products,{name,cat:cat||'Iné',desc:desc||'',emoji:emoji||'📦',price:+price,commission_rate:+commission_rate||0.10,type:type||'product',active:true});
  res.json({ok:true,id:p._id});
});

app.put('/api/admin/products/:id', adminAuth, async(req,res)=>{
  const{name,cat,desc,emoji,price,commission_rate,active}=req.body;
  await q.update(db.products,{_id:req.params.id},{$set:{name,cat,desc:desc||'',emoji:emoji||'📦',price:+price,commission_rate:+commission_rate,active:!!active}});
  res.json({ok:true});
});

// Admin: Classes management
app.get('/api/admin/classes', adminAuth, async(req,res)=>{
  const classes=await q.find(db.classes,{});
  const result=[];
  for(const c of classes){
    const booked=await q.count(db.bookings,{class_id:c._id,status:{$ne:'cancelled'}});
    result.push({...c,booked,spotsLeft:Math.max(0,c.capacity-booked),dayName:DAYS_SK[c.day_of_week]});
  }
  result.sort((a,b)=>a.day_of_week-b.day_of_week||a.time_start.localeCompare(b.time_start));
  res.json(result);
});

// Resolve an instructor_id → {id, name}. Falls back to given name if no id.
async function resolveInstructor(instructor_id, fallbackName){
  if(instructor_id){
    const u=await q.one(db.users,{_id:instructor_id});
    if(u) return {instructor_id:u._id, instructor:u.name};
  }
  return {instructor_id:'', instructor:fallbackName||'Marek Gruber'};
}

app.post('/api/admin/classes', adminAuth, async(req,res)=>{
  const{name,emoji,category,instructor,instructor_id,location,day_of_week,time_start,time_end,capacity,level,description,price,color}=req.body;
  if(!name||day_of_week===undefined||!time_start) return res.status(400).json({error:'Vyplňte povinné polia'});
  const ins=await resolveInstructor(instructor_id,instructor);
  const c=await q.insert(db.classes,{name,emoji:emoji||'💃',category:category||'Tanec',instructor:ins.instructor,instructor_id:ins.instructor_id,location:location||'Banská Bystrica',day_of_week:+day_of_week,time_start,time_end:time_end||'',capacity:+capacity||30,level:level||'Všetky úrovne',description:description||'',price:+price||10,color:color||'#e94560',active:true});
  res.json({ok:true,id:c._id});
});

app.put('/api/admin/classes/:id', adminAuth, async(req,res)=>{
  const{name,emoji,category,instructor,instructor_id,location,day_of_week,time_start,time_end,capacity,level,description,price,color,active}=req.body;
  const ins=await resolveInstructor(instructor_id,instructor);
  await q.update(db.classes,{_id:req.params.id},{$set:{name,emoji:emoji||'💃',category,instructor:ins.instructor,instructor_id:ins.instructor_id,location,day_of_week:+day_of_week,time_start,time_end,capacity:+capacity,level,description,price:+price,color,active:!!active}});
  res.json({ok:true});
});


app.delete('/api/admin/classes/:id', adminAuth, async(req,res)=>{
  await q.update(db.classes,{_id:req.params.id},{$set:{active:false}});
  res.json({ok:true});
});

// Keep only Zumba / Zumba ONLINE classes — deactivates everything else. Audited & reversible.
app.post('/api/admin/classes/keep-zumba-only', adminAuth, async(req,res)=>{
  try {
    const isZumba = c => /zumba/i.test(c.name||'') || /zumba|online/i.test(c.category||'');
    const active = (await q.find(db.classes,{active:true}));
    const toRemove = active.filter(c=>!isZumba(c));
    for(const c of toRemove) await q.update(db.classes,{_id:c._id},{$set:{active:false}});
    await auditLog(req,'classes_keep_zumba_only','classes',{removed_count:toRemove.length},
      {removed:toRemove.map(c=>c.name)}, req.body.reason||'');
    res.json({ ok:true, removed:toRemove.length, kept:active.length-toRemove.length,
      removedNames:[...new Set(toRemove.map(c=>c.name))] });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Admin: Bookings
app.get('/api/admin/bookings', adminAuth, async(req,res)=>{
  const bookings=await q.find(db.bookings,{});
  bookings.sort((a,b)=>b.created_at.localeCompare(a.created_at));
  res.json(bookings.slice(0,200));
});

app.put('/api/admin/bookings/:id', adminAuth, async(req,res)=>{
  const{status}=req.body;
  await q.update(db.bookings,{_id:req.params.id},{$set:{status}});
  res.json({ok:true});
});

// ═══════════════════════════════════════════════════════════════════════════════
// PAYPAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
function ppRequest(method, endpoint, body){
  return new Promise((resolve, reject)=>{
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
    const url  = new URL(PAYPAL_BASE + endpoint);
    const postData = body ? JSON.stringify(body) : '';
    const options = {
      hostname: url.hostname, path: url.pathname + url.search,
      method, headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      }
    };
    const req = https.request(options, res=>{
      let data='';
      res.on('data', d=>data+=d);
      res.on('end', ()=>{ try{ resolve({status:res.statusCode, body: data?JSON.parse(data):{}}); }catch(e){ resolve({status:res.statusCode, body:data}); }});
    });
    req.on('error', reject);
    if(postData) req.write(postData);
    req.end();
  });
}
// ── PayPal helper: generic API call ───────────────────────────────────────────
async function ppApi(method, path, body){
  const token = await ppGetToken();
  const url = new URL(PAYPAL_BASE + path);
  const postData = body ? JSON.stringify(body) : null;
  return new Promise((resolve,reject)=>{
    const headers = {'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Accept':'application/json'};
    if(postData) headers['Content-Length'] = Buffer.byteLength(postData);
    const req = https.request({hostname:url.hostname,path:url.pathname+url.search,method,headers},res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{ resolve({status:res.statusCode,body:d?JSON.parse(d):null}); }catch(e){ resolve({status:res.statusCode,body:d}); }});
    });
    req.on('error',reject);
    if(postData) req.write(postData);
    req.end();
  });
}

// ── PayPal Subscriptions: create or fetch product & plan IDs ─────────────────
async function ppEnsureSubscriptionPlan(planKey){
  const plan = MEMBERSHIP_PLANS[planKey];
  if(!plan || plan.type==='bundle') return null;
  if(!PAYPAL_CLIENT_ID) return null;

  // Check if we already have a stored plan_id
  const stored = await q.one(db.email_steps, {_type:'paypal_plan', plan_key:planKey}).catch(()=>null);
  if(stored?.paypal_plan_id) return stored.paypal_plan_id;

  // 1. Create product
  const prodRes = await ppApi('POST','/v1/catalogs/products',{
    name:`Fusion Academy – ${plan.name}`,
    description:`Mesačné tančné členstvo ${plan.name}`,
    type:'SERVICE', category:'EDUCATIONAL_AND_TEXTBOOKS'
  });
  if(prodRes.status!==201) throw new Error('PayPal product error: '+JSON.stringify(prodRes.body));
  const productId = prodRes.body.id;

  // 2. Create billing plan
  const planRes = await ppApi('POST','/v1/billing/plans',{
    product_id: productId,
    name: `Fusion Academy ${plan.name} – mesačné`,
    description: `Neobmedzené hodiny ${plan.name}`,
    status:'ACTIVE',
    billing_cycles:[{
      frequency:{ interval_unit:'MONTH', interval_count:1 },
      tenure_type:'REGULAR', sequence:1,
      total_cycles:0, // 0 = infinite
      pricing_scheme:{ fixed_price:{ value: plan.price.toFixed(2), currency_code:'EUR' } }
    }],
    payment_preferences:{
      auto_bill_outstanding:true,
      setup_fee:{ value:'0', currency_code:'EUR' },
      setup_fee_failure_action:'CONTINUE',
      payment_failure_threshold:3
    }
  });
  if(planRes.status!==201) throw new Error('PayPal plan error: '+JSON.stringify(planRes.body));
  const paypalPlanId = planRes.body.id;

  // Store for reuse (using email_steps table as a kv store hack)
  await q.insert(db.email_steps,{_type:'paypal_plan', plan_key:planKey, paypal_plan_id:paypalPlanId, created_at:nowISO()});
  return paypalPlanId;
}

async function ppGetToken(){
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const postData = 'grant_type=client_credentials';
  return new Promise((resolve, reject)=>{
    const url = new URL(PAYPAL_BASE + '/v1/oauth2/token');
    const req = https.request({ hostname:url.hostname, path:url.pathname, method:'POST', headers:{'Authorization':`Basic ${auth}`,'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(postData)} }, res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{ resolve(JSON.parse(d).access_token); }catch(e){ reject(e); }});
    });
    req.on('error', reject); req.write(postData); req.end();
  });
}
async function ppCreateOrder(amount, currency='EUR', description='Fusion Academy'){
  if(!PAYPAL_CLIENT_ID) throw new Error('PayPal nie je nakonfigurovaný');
  const token = await ppGetToken();
  const url = new URL(PAYPAL_BASE+'/v2/checkout/orders');
  const body = JSON.stringify({ intent:'CAPTURE', purchase_units:[{ amount:{ currency_code:currency, value:parseFloat(amount).toFixed(2) }, description }] });
  return new Promise((resolve,reject)=>{
    const req = https.request({ hostname:url.hostname, path:url.pathname, method:'POST', headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} }, res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{ resolve({status:res.statusCode,body:JSON.parse(d)}); }catch(e){ resolve({status:res.statusCode,body:d}); }});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}
async function ppCaptureOrder(orderId){
  if(!PAYPAL_CLIENT_ID) throw new Error('PayPal nie je nakonfigurovaný');
  const token = await ppGetToken();
  const url = new URL(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`);
  const body = '{}';
  return new Promise((resolve,reject)=>{
    const req = https.request({ hostname:url.hostname, path:url.pathname, method:'POST', headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Content-Length':2} }, res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{ resolve({status:res.statusCode,body:JSON.parse(d)}); }catch(e){ resolve({status:res.statusCode,body:d}); }});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

// ─── PayPal Routes ────────────────────────────────────────────────────────────
app.post('/api/paypal/create-order', async(req,res)=>{
  try {
    const { amount, description, ref_id, ref_type } = req.body;
    if(!amount) return res.status(400).json({error:'Chýba suma'});
    if(!PAYPAL_CLIENT_ID) return res.json({ ok:false, demo:true, message:'PayPal sandbox nie je nakonfigurovaný – objednávka je evidovaná bez platby' });
    const result = await ppCreateOrder(amount, 'EUR', description||'Fusion Academy');
    if(result.status!==201) return res.status(400).json({error:'PayPal chyba', detail: result.body});
    // Save pending payment record
    const payment = await q.insert(db.payments,{
      paypal_order_id: result.body.id,
      user_id: req.session?.uid||null,
      amount:+parseFloat(amount).toFixed(2),
      currency:'EUR', description:description||'Fusion Academy',
      ref_id:ref_id||null, ref_type:ref_type||null,
      status:'pending', created_at:nowISO()
    });
    res.json({ ok:true, paypalOrderId: result.body.id, paymentId: payment._id });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/paypal/capture-order', async(req,res)=>{
  try {
    const { paypalOrderId, paymentId } = req.body;
    if(!paypalOrderId) return res.status(400).json({error:'Chýba paypalOrderId'});
    const result = await ppCaptureOrder(paypalOrderId);
    const captured = result.status===201 || result.status===200;
    const payment = paymentId ? await q.one(db.payments,{_id:paymentId}) : null;
    if(captured && payment){
      await q.update(db.payments,{_id:paymentId},{$set:{status:'completed',captured_at:nowISO(),paypal_capture_id:result.body?.purchase_units?.[0]?.payments?.captures?.[0]?.id||''}});
      trackPurchase(payment.user_id, payment.amount);
      { const pu = payment.user_id ? await q.one(db.users,{_id:payment.user_id}) : null;
        createInvoice({user_id:payment.user_id, client_name:pu?.name, client_email:pu?.email,
          items:[{desc:payment.description||'Platba Fusion Academy', qty:1, total:payment.amount}],
          total:payment.amount, method:'PayPal'}); }
      if(payment.status!=='completed') awardPurchaseCommission({buyer_id:payment.user_id, amount:payment.amount, product_name:payment.description||'Členstvo'});
      // If it's a membership payment, activate membership (member_id = child if family purchase)
      if(payment.ref_type==='membership' && payment.user_id){
        await activateMembership(payment.member_id || payment.user_id, payment.ref_id, 30);
      }
      // If it's a booking payment, confirm booking
      if(payment.ref_type==='booking' && payment.ref_id){
        await q.update(db.bookings,{_id:payment.ref_id},{$set:{status:'confirmed',paid:true,paid_at:nowISO()}});
      }
      // Notify user
      if(payment.user_id){
        await q.insert(db.notifications,{user_id:payment.user_id,type:'payment',title:'Platba prijatá ✅',body:`Platba ${payment.amount}€ bola úspešne spracovaná.`,read:false,created_at:nowISO()});
      }
    }
    res.json({ ok:captured, status: result.body?.status||'UNKNOWN', detail: captured?undefined:result.body });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/paypal/webhook', express.json({type:'*/*'}), async(req,res)=>{
  // Basic webhook handler – extend with signature verification for production
  const event = req.body;
  if(event?.event_type==='PAYMENT.CAPTURE.COMPLETED'){
    const orderId = event?.resource?.supplementary_data?.related_ids?.order_id;
    if(orderId){
      const payment = await q.one(db.payments,{paypal_order_id:orderId});
      if(payment && payment.status!=='completed'){
        await q.update(db.payments,{_id:payment._id},{$set:{status:'completed',captured_at:nowISO()}});
      }
    }
  }
  res.status(200).json({ok:true});
});

app.get('/api/payments', adminAuth, async(req,res)=>{
  const payments = await q.find(db.payments,{});
  payments.sort((a,b)=>b.created_at.localeCompare(a.created_at));
  res.json(payments.slice(0,200));
});

app.get('/api/payments/:id', auth, async(req,res)=>{
  const p = await q.one(db.payments,{_id:req.params.id});
  if(!p) return res.status(404).json({error:'Nenájdená'});
  if(p.user_id!==req.session.uid && !(await q.one(db.users,{_id:req.session.uid,is_admin:true})))
    return res.status(403).json({error:'Prístup zamietnutý'});
  res.json(p);
});

// ═══════════════════════════════════════════════════════════════════════════════
// MEMBERSHIP SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
const MEMBERSHIP_PLANS = {
  'bronze':         { name:'Bronze',         price:50,   duration_days:30,  online:false, color:'#cd7f32' },
  'silver':         { name:'Silver',         price:75,   duration_days:30,  online:true,  color:'#a8a9ad' },
  'gold':           { name:'Gold',           price:125,  duration_days:30,  online:true,  color:'#C9A84C', meal:true },
  'kids':           { name:'Zumba Kids',     price:49.9, duration_days:30,  online:false, color:'#FF6B9D', kids:true },
  'online_basic':   { name:'Online Basic',   price:12.9, duration_days:30,  online:true,  color:'#4CAF50' },
  'online_premium': { name:'Online Premium', price:67.9, duration_days:30,  online:true,  color:'#9C27B0', meal:true },
  'vstup1':         { name:'Jednorazový vstup', price:10, duration_days:30, online:false, color:'#4CAF50', type:'bundle', entries:1 },
  'permanentka10':  { name:'10-vstupová permanentka', price:80, duration_days:90, online:false, color:'#FF9800', type:'bundle', entries:10 },
};

async function activateMembership(userId, planId, durationDays){
  const plan = MEMBERSHIP_PLANS[planId];
  if(!plan) return;
  const now = new Date();
  // Upgrade z Bronze na vyššie → zastav upsell sekvenciu (netreba už otravovať)
  if(planId && planId!=='bronze' && plan.type!=='bundle') cancelSequence(userId,'bronze_upsell').catch(()=>{});
  if(planId==='gold') cancelSequence(userId,'gold_upsell').catch(()=>{});

  // ── Bundle type: add single_entries instead of membership subscription ───────
  if(plan.type === 'bundle'){
    const entries = plan.entries || 10;
    const u0 = await q.one(db.users,{_id:userId});
    const newEntries = (u0.single_entries||0) + entries;
    const expiresAt = new Date(now.getTime() + (plan.duration_days||90)*24*60*60*1000);
    await q.update(db.users,{_id:userId},{$set:{single_entries:newEntries}});
    await q.insert(db.memberships,{user_id:userId,plan_id:planId,plan_name:plan.name,price:plan.price,status:'bundle',started_at:now.toISOString(),expires_at:expiresAt.toISOString(),created_at:nowISO()});
    await q.insert(db.notifications,{user_id:userId,type:'membership',title:'Permanentka aktivovaná 🎟️',body:`Máš ${newEntries} vstupov na 90 dní.`,read:false,created_at:nowISO()});
    const u0b = await q.one(db.users,{_id:userId});
    if(u0b?.sponsor_id){
      const bonus = +(plan.price * 0.10).toFixed(2);
      const sponsor = await q.one(db.users,{_id:u0b.sponsor_id});
      if(sponsor){
        const newCredit = +((sponsor.referral_credit||0)+bonus).toFixed(2);
        await q.update(db.users,{_id:u0b.sponsor_id},{$set:{referral_credit:newCredit}});
        await q.insert(db.notifications,{user_id:u0b.sponsor_id,type:'referral_credit',title:`+${bonus} € referral kredit! 💰`,body:`${u0b.name} kúpil/a permanentku. Zostatok: ${newCredit} €`,read:false,created_at:nowISO()});
      }
    }
    return;
  }

  // Check existing active membership
  const existing = await q.one(db.memberships,{user_id:userId,status:'active'});
  const startDate = existing && new Date(existing.expires_at) > now
    ? new Date(existing.expires_at)  // extend from current expiry
    : now;
  const expiresAt = new Date(startDate.getTime() + (durationDays||plan.duration_days)*24*60*60*1000);
  if(existing){
    await q.update(db.memberships,{_id:existing._id},{$set:{plan_id:planId,plan_name:plan.name,expires_at:expiresAt.toISOString(),updated_at:nowISO()}});
  } else {
    await q.insert(db.memberships,{user_id:userId,plan_id:planId,plan_name:plan.name,price:plan.price,status:'active',started_at:now.toISOString(),expires_at:expiresAt.toISOString(),created_at:nowISO()});
  }
  // Update user's membership_plan field (+ lead → klient automaticky)
  const promoU = await q.one(db.users,{_id:userId});
  const memberSet = {membership_plan:planId, membership_expires:expiresAt.toISOString()};
  if(promoU && promoU.user_type==='lead') memberSet.user_type='client';
  await q.update(db.users,{_id:userId},{$set:memberSet});
  // Notification
  await q.insert(db.notifications,{user_id:userId,type:'membership',title:'Členstvo aktivované 🎉',body:`Váš plán ${plan.name} je aktívny do ${expiresAt.toLocaleDateString('sk-SK')}.`,read:false,created_at:nowISO()});
  // ── Email automation: cancel lead_nurture, enqueue membership_welcome ────────
  cancelSequence(userId,'lead_nurture').catch(()=>{});
  enqueueSequence(userId,'membership_welcome').catch(()=>{});
  // ── Expiry warning sequence anchored from expiry date ───────────────────────
  enqueueSequence(userId,'expiry_warning', expiresAt).catch(()=>{});
  // ── Give sponsor 10% referral credit on membership purchase ─────────────────
  const u = await q.one(db.users,{_id:userId});
  if(u?.sponsor_id){
    const bonus = +(plan.price * 0.10).toFixed(2);
    const sponsor = await q.one(db.users,{_id:u.sponsor_id});
    if(sponsor){
      const newCredit = +((sponsor.referral_credit||0) + bonus).toFixed(2);
      await q.update(db.users,{_id:u.sponsor_id},{$set:{referral_credit:newCredit}});
      await q.insert(db.notifications,{user_id:u.sponsor_id,type:'referral_credit',title:`+${bonus} € referral kredit! 💰`,body:`${u.name} zakúpil/a ${plan.name}. Zostatok: ${newCredit} €`,read:false,created_at:nowISO()});
    }
  }

  // ── Bronze upsell: ak si zvolila „prvý mesiac Silver za cenu Bronze" ─────────
  if(planId==='bronze'){
    const bu = await q.one(db.users,{_id:userId});
    if(bu && bu.pending_silver_upsell && !bu.silver_trial_used){
      const m2 = await q.one(db.memberships,{user_id:userId,status:'active'});
      if(m2 && m2.plan_id==='bronze'){
        await q.update(db.memberships,{_id:m2._id},{$set:{plan_id:'silver',plan_name:'Silver',trial:true,trial_from:'bronze',renew_to:'silver',trial_started:nowISO()}});
        await q.update(db.users,{_id:userId},{$set:{membership_plan:'silver',silver_trial_used:true,pending_silver_upsell:false}});
        cancelSequence(userId,'bronze_upsell').catch(()=>{});
        const until=(m2.expires_at||'').slice(0,10);
        await q.insert(db.notifications,{user_id:userId,type:'membership',title:'✨ Máš Silver za cenu Bronze!',body:`Prvý mesiac máš Silver — odomknuté online hodiny LIVE aj metabolická analýza tela. Silver sa začne účtovať až od ďalšieho obnovenia.`,read:false,created_at:nowISO()}).catch(()=>{});
        if(bu.email) sendMail(bu.email,'✨ Máš Silver za cenu Bronze!',
          emailTemplate('Prvý mesiac Silver – za cenu Bronze 🎁',
            `<p>Ahoj <b>${bu.name}</b>,</p><p>Rozhodla si sa dobre! 💛 Zaplatila si cenu Bronze, ale <b>prvý mesiac máš členstvo Silver</b> — s odomknutou <b>metabolickou analýzou tela</b> aj <b>online hodinami LIVE</b> (do <b>${until}</b>).</p><p>Silver sa ti začne účtovať až od <b>najbližšieho obnovenia</b> — dovtedy nič nedoplácaš. Užívaj si to naplno! 💃</p>`,
            '📱 Objednať analýzu', `${APP_URL}/client-dashboard`)).catch(()=>{});
      }
    } else if(bu && bu.pending_silver_upsell){
      await q.update(db.users,{_id:userId},{$set:{pending_silver_upsell:false}}); // vyčisti nevyužitý flag
    }
  }
}

async function checkMembership(userId){
  if(!userId) return null;
  const m = await q.one(db.memberships,{user_id:userId,status:'active'});
  if(!m) return null;
  if(new Date(m.expires_at) < new Date()){
    await q.update(db.memberships,{_id:m._id},{$set:{status:'expired'}});
    await q.update(db.users,{_id:userId},{$set:{membership_plan:null,membership_expires:null}});
    return null;
  }
  return m;
}

app.get('/api/membership', auth, async(req,res)=>{
  const m = await checkMembership(req.session.uid);
  const plan = m ? MEMBERSHIP_PLANS[m.plan_id]||null : null;
  res.json({ membership:m, plan, has_online: plan?.online||false });
});

app.get('/api/membership/plans', (req,res)=>res.json(MEMBERSHIP_PLANS));

// ── Create PayPal Subscription ─────────────────────────────────────────────────
app.post('/api/membership/subscribe', auth, async(req,res)=>{
  try {
    const {plan_id} = req.body;
    const plan = MEMBERSHIP_PLANS[plan_id];
    if(!plan || plan.type==='bundle') return res.status(400).json({error:'Neplatný plán pre subscription'});
    if(!PAYPAL_CLIENT_ID) {
      // Demo mode – activate immediately
      await activateMembership(req.session.uid, plan_id);
      return res.json({ok:true, demo:true, message:'Demo: subscription aktivovaná'});
    }
    const u = await q.one(db.users,{_id:req.session.uid});
    const paypalPlanId = await ppEnsureSubscriptionPlan(plan_id);
    const subRes = await ppApi('POST','/v1/billing/subscriptions',{
      plan_id: paypalPlanId,
      subscriber: { name:{ given_name: u.name.split(' ')[0], surname: u.name.split(' ').slice(1).join(' ')||'-' }, email_address: u.email },
      application_context: {
        brand_name:'Fusion Academy',
        locale:'sk-SK',
        shipping_preference:'NO_SHIPPING',
        user_action:'SUBSCRIBE_NOW',
        return_url:`${APP_URL}/client-dashboard?sub=success&plan=${plan_id}`,
        cancel_url:`${APP_URL}/pricing?sub=cancel`
      }
    });
    if(subRes.status!==201) return res.status(400).json({error:'PayPal subscription chyba', detail: subRes.body});
    const approveLink = subRes.body.links?.find(l=>l.rel==='approve')?.href;
    // Store pending subscription
    await q.insert(db.payments,{
      paypal_subscription_id: subRes.body.id, user_id:u._id, amount:plan.price,
      currency:'EUR', description:`Subscription ${plan.name}`, ref_id:plan_id,
      ref_type:'subscription', status:'pending', created_at:nowISO()
    });
    res.json({ok:true, subscription_id: subRes.body.id, approve_url: approveLink});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Activate subscription after PayPal approval ────────────────────────────────
app.post('/api/membership/subscribe/activate', auth, async(req,res)=>{
  try {
    const {subscription_id, plan_id} = req.body;
    if(!subscription_id || !plan_id) return res.status(400).json({error:'Chýba subscription_id alebo plan_id'});
    // Verify with PayPal
    const subRes = await ppApi('GET',`/v1/billing/subscriptions/${subscription_id}`);
    if(subRes.status!==200) return res.status(400).json({error:'Subscription nenájdená'});
    const sub = subRes.body;
    if(!['ACTIVE','APPROVED'].includes(sub.status)) return res.status(400).json({error:'Subscription nie je aktívna: '+sub.status});
    // Activate membership
    await activateMembership(req.session.uid, plan_id);
    // Save subscription_id on user
    await q.update(db.users,{_id:req.session.uid},{$set:{paypal_subscription_id: subscription_id, subscription_plan: plan_id}});
    await q.update(db.payments,{paypal_subscription_id:subscription_id},{$set:{status:'active', activated_at:nowISO()}});
    trackPurchase(req.session.uid, MEMBERSHIP_PLANS[plan_id]?.price);
    { const pu = await q.one(db.users,{_id:req.session.uid});
      createInvoice({user_id:req.session.uid, client_name:pu?.name, client_email:pu?.email,
        items:[{desc:`Členstvo ${MEMBERSHIP_PLANS[plan_id]?.name} (mesačný odber)`, qty:1, total:MEMBERSHIP_PLANS[plan_id]?.price||0}],
        total:MEMBERSHIP_PLANS[plan_id]?.price||0, method:'PayPal (automatický odber)'}); }
    awardPurchaseCommission({buyer_id:req.session.uid, amount:MEMBERSHIP_PLANS[plan_id]?.price, product_name:`Členstvo ${MEMBERSHIP_PLANS[plan_id]?.name}`});
    res.json({ok:true, plan_name: MEMBERSHIP_PLANS[plan_id]?.name});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Cancel subscription ────────────────────────────────────────────────────────
app.post('/api/membership/subscribe/cancel', auth, async(req,res)=>{
  try {
    const u = await q.one(db.users,{_id:req.session.uid});
    if(!u.paypal_subscription_id) return res.status(400).json({error:'Nemáš aktívnu subscription'});
    const cancelRes = await ppApi('POST',`/v1/billing/subscriptions/${u.paypal_subscription_id}/cancel`,{reason:'Zrušenie na žiadosť klienta'});
    if(cancelRes.status!==204) return res.status(400).json({error:'Chyba zrušenia PayPal'});
    await q.update(db.users,{_id:u._id},{$set:{paypal_subscription_id:null, subscription_plan:null}});
    await q.insert(db.notifications,{user_id:u._id,type:'membership',title:'Subscription zrušená',body:'Automatické obnovenie bolo zrušené. Členstvo zostáva aktívne do konca obdobia.',read:false,created_at:nowISO()});
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Admin: cancel subscription for user ───────────────────────────────────────
app.post('/api/admin/membership/cancel-subscription', adminAuth, async(req,res)=>{
  try {
    const u = await q.one(db.users,{_id:req.body.user_id});
    if(!u?.paypal_subscription_id) return res.status(400).json({error:'Užívateľ nemá subscription'});
    await ppApi('POST',`/v1/billing/subscriptions/${u.paypal_subscription_id}/cancel`,{reason:'Admin zrušenie'});
    await q.update(db.users,{_id:u._id},{$set:{paypal_subscription_id:null,subscription_plan:null}});
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── PayPal Webhook: subscription events ───────────────────────────────────────
// Raw body needed for webhook signature verification
app.post('/api/paypal/webhook', express.raw({type:'application/json'}), async(req,res)=>{
  try {
    const event = JSON.parse(req.body.toString());
    const {event_type, resource} = event;
    console.log('📦 PayPal webhook:', event_type);

    if(event_type === 'BILLING.SUBSCRIPTION.RENEWED' || event_type === 'PAYMENT.SALE.COMPLETED'){
      // Find user by subscription_id
      const subId = resource.billing_agreement_id || resource.id;
      if(!subId) return res.sendStatus(200);
      const u = await q.one(db.users,{paypal_subscription_id:subId});
      if(!u) return res.sendStatus(200);
      const planId = u.subscription_plan;
      const plan = MEMBERSHIP_PLANS[planId];
      if(!plan) return res.sendStatus(200);

      // Extend membership by 30 days from current expiry
      const existing = await q.one(db.memberships,{user_id:u._id,status:'active'});
      const now = new Date();
      const base = existing && new Date(existing.expires_at) > now ? new Date(existing.expires_at) : now;
      const newExpiry = new Date(base.getTime() + 30*86400000);
      if(existing){
        await q.update(db.memberships,{_id:existing._id},{$set:{expires_at:newExpiry.toISOString(),updated_at:nowISO()}});
      } else {
        await q.insert(db.memberships,{user_id:u._id,plan_id:planId,plan_name:plan.name,price:plan.price,status:'active',started_at:now.toISOString(),expires_at:newExpiry.toISOString(),created_at:nowISO()});
      }
      await q.update(db.users,{_id:u._id},{$set:{membership_plan:planId,membership_expires:newExpiry.toISOString()}});
      const amount = resource.amount?.total || plan.price;
      await q.insert(db.transactions,{type:'subscription_renewal',user_id:u._id,user_name:u.name,amount:parseFloat(amount),payment_method:'paypal_subscription',note:`Auto-renewal ${plan.name}`,plan_id:planId,created_at:nowISO(),month:today().slice(0,7)});
      createInvoice({user_id:u._id, client_name:u.name, client_email:u.email,
        items:[{desc:`Členstvo ${plan.name} — mesačná obnova`, qty:1, total:parseFloat(amount)}],
        total:parseFloat(amount), method:'PayPal (automatický odber)'});
      awardPurchaseCommission({buyer_id:u._id, amount:parseFloat(amount), product_name:`Členstvo ${plan.name} (obnova)`});
      await q.insert(db.notifications,{user_id:u._id,type:'membership',title:'Členstvo obnovené 🔄',body:`${plan.name} automaticky obnovené do ${newExpiry.toLocaleDateString('sk-SK')}.`,read:false,created_at:nowISO()});
      if(u.email) sendMail(u.email,`🔄 Členstvo obnovené – ${plan.name}`,
        emailTemplate('Členstvo automaticky obnovené 🔄',
          `<p>Ahoj <b>${u.name}</b>,</p><p>Tvoje členstvo <b>${plan.name}</b> bolo automaticky obnovené a platí do <b>${newExpiry.toLocaleDateString('sk-SK')}</b>.</p><p>Ďakujeme, že si s nami! 💃</p>`,
          '📱 Môj profil',`${APP_URL}/client-dashboard`)).catch(()=>{});
    }

    if(event_type === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED'){
      const subId = resource.id;
      const u = await q.one(db.users,{paypal_subscription_id:subId});
      if(!u?.email) return res.sendStatus(200);
      await q.insert(db.notifications,{user_id:u._id,type:'payment',title:'⚠️ Platba zlyhala',body:'Automatické obnovenie členstva sa nepodarilo. Skontroluj platobnú metódu.',read:false,created_at:nowISO()});
      sendMail(u.email,'⚠️ Platba za členstvo zlyhala',
        emailTemplate('Platba zlyhala ⚠️',
          `<p>Ahoj <b>${u.name}</b>,</p><p>Automatická platba za tvoje členstvo <b>zlyhala</b>.</p><p>PayPal sa pokúsi o platbu znova. Ak problém pretrváva, skontroluj svoju platobnú metódu v PayPal účte.</p>`,
          '💳 Spravovať platbu',`https://www.paypal.com/myaccount/autopay/`)).catch(()=>{});
    }

    if(event_type === 'BILLING.SUBSCRIPTION.CANCELLED'){
      const subId = resource.id;
      const u = await q.one(db.users,{paypal_subscription_id:subId});
      if(u){
        await q.update(db.users,{_id:u._id},{$set:{paypal_subscription_id:null,subscription_plan:null}});
        await q.insert(db.notifications,{user_id:u._id,type:'membership',title:'Subscription zrušená',body:'Automatické obnovenie členstva bolo zrušené.',read:false,created_at:nowISO()});
      }
    }

    res.sendStatus(200);
  } catch(e){
    console.error('Webhook error:', e.message);
    res.sendStatus(200); // always 200 to prevent PayPal retries
  }
});

// ── Promo / zľavové kódy ──────────────────────────────────────────────────────
async function validatePromo(code, price, userId){
  code=(code||'').toUpperCase().trim();
  if(!code) return {ok:false, reason:'Zadaj kód'};
  const p=await q.one(db.promo_codes,{code});
  if(!p || p.active===false) return {ok:false, reason:'Kód neexistuje alebo je neaktívny'};
  if(p.expires_at && new Date(p.expires_at) < new Date()) return {ok:false, reason:'Platnosť kódu vypršala'};
  if(p.min_amount && price < p.min_amount) return {ok:false, reason:`Kód platí od ${p.min_amount} €`};
  if(p.max_uses && (p.used_count||0) >= p.max_uses) return {ok:false, reason:'Kód už bol vyčerpaný'};
  if(p.once_per_user && userId){ const used=await q.one(db.promo_redemptions,{code, user_id:userId}); if(used) return {ok:false, reason:'Kód si už použil/a'}; }
  if(p.target_user_id && p.target_user_id!==userId) return {ok:false, reason:'Tento kód je viazaný na iný účet'};
  let discount = p.type==='percent' ? +(price * (+p.value)/100).toFixed(2) : Math.min(+p.value, price);
  discount = Math.max(0, Math.min(discount, price));
  return {ok:true, discount, final:+(price-discount).toFixed(2), promo:p,
    label: p.type==='percent' ? `${p.value}%` : `${(+p.value).toFixed(2)} €` };
}
async function recordPromoRedemption(promo, userId, discount){
  await q.update(db.promo_codes,{_id:promo._id},{$inc:{used_count:1}});
  await q.insert(db.promo_redemptions,{code:promo.code, user_id:userId||null, discount:+discount||0, at:nowISO()});
}
// Vytvor osobný časovo-limitovaný ponukový kód (napr. 20 % na 24 h) pre konkrétneho leada
async function createOfferCode(userId, percent, hours){
  let code; do { code='ZL'+percent+Math.random().toString(36).slice(2,6).toUpperCase(); } while(await q.one(db.promo_codes,{code}));
  const expires_at = new Date(Date.now()+hours*3600000).toISOString();
  await q.insert(db.promo_codes,{ code, type:'percent', value:percent, applies_to:'membership',
    max_uses:1, once_per_user:true, min_amount:0, expires_at, target_user_id:userId,
    active:true, used_count:0, note:`Ponuka ${percent}% (${hours} h) pre leada`, created_at:nowISO() });
  return { code, expires_at };
}
// Klient overí promo kód pred platbou (náhľad zľavy)
app.post('/api/promo/validate', auth, async(req,res)=>{
  try {
    const plan = MEMBERSHIP_PLANS[req.body.plan_id];
    const price = plan ? plan.price : (+req.body.amount||0);
    if(price<=0) return res.json({ok:false, reason:'Neplatná suma'});
    const v = await validatePromo(req.body.code, price, req.session.uid);
    res.json(v.ok ? {ok:true, discount:v.discount, final:v.final, label:v.label, code:v.promo.code} : {ok:false, reason:v.reason});
  } catch(e){ res.status(500).json({error:e.message}); }
});
// Admin: správa promo kódov
app.get('/api/admin/promos', adminAuth, async(req,res)=>{
  const list=await q.find(db.promo_codes,{});
  res.json(list.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')));
});
app.post('/api/admin/promos', adminAuth, async(req,res)=>{
  try {
    const code=(req.body.code||'').toUpperCase().trim().replace(/\s+/g,'');
    if(!code) return res.status(400).json({error:'Zadaj kód'});
    if(await q.one(db.promo_codes,{code})) return res.status(400).json({error:'Kód už existuje'});
    const type = req.body.type==='fixed' ? 'fixed' : 'percent';
    const value = Math.max(0, +req.body.value||0);
    if(value<=0) return res.status(400).json({error:'Zadaj hodnotu zľavy'});
    const doc = { code, type, value,
      applies_to: req.body.applies_to||'membership',
      max_uses: Math.max(0, parseInt(req.body.max_uses)||0),
      once_per_user: !!req.body.once_per_user,
      min_amount: Math.max(0, +req.body.min_amount||0),
      expires_at: req.body.expires_at ? new Date(req.body.expires_at+'T23:59:59').toISOString() : null,
      active:true, used_count:0, created_at:nowISO() };
    const p=await q.insert(db.promo_codes, doc);
    await auditLog(req,'promo_create',code,{},doc,'');
    res.json({ok:true, id:p._id});
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/admin/promos/:id', adminAuth, async(req,res)=>{
  const set={}; if(req.body.active!==undefined) set.active=!!req.body.active;
  await q.update(db.promo_codes,{_id:req.params.id},{$set:set});
  await auditLog(req,'promo_update',req.params.id,{},set,'');
  res.json({ok:true});
});
app.delete('/api/admin/promos/:id', adminAuth, async(req,res)=>{
  await q.remove(db.promo_codes,{_id:req.params.id});
  await auditLog(req,'promo_delete',req.params.id,{},{},'');
  res.json({ok:true});
});

// Skúšobná aktivácia Silveru zadarmo: Bronze člen dostane Silver do konca aktuálneho
// obdobia bez platby; Silver sa začne účtovať až od najbližšieho obnovenia. 1×/klient.
app.post('/api/membership/try-silver', auth, async(req,res)=>{
  try {
    const u = await q.one(db.users,{_id:req.session.uid});
    if(u.silver_trial_used) return res.status(400).json({error:'Skúšku Silver si už využil/a. 🙂'});
    const m = await q.one(db.memberships,{user_id:u._id, status:'active'});
    if(!m) return res.status(400).json({error:'no_membership'});
    if(m.plan_id!=='bronze') return res.status(400).json({error:'not_bronze'});
    await q.update(db.memberships,{_id:m._id},{$set:{plan_id:'silver', plan_name:'Silver', trial:true, trial_from:'bronze', renew_to:'silver', trial_started:nowISO()}});
    await q.update(db.users,{_id:u._id},{$set:{membership_plan:'silver', silver_trial_used:true}});
    cancelSequence(u._id,'bronze_upsell').catch(()=>{});
    const until = (m.expires_at||'').slice(0,10);
    await q.insert(db.notifications,{user_id:u._id,type:'membership',title:'✨ Silver aktivovaný na skúšku!',
      body:`Máš Silver zadarmo do ${until} — užívaj analýzu tela aj online hodiny! Silver sa začne účtovať až od ďalšieho obnovenia.`,read:false,created_at:nowISO()}).catch(()=>{});
    if(u.email) sendMail(u.email,'✨ Aktivovali sme ti Silver na skúšku!',
      emailTemplate('Silver na skúšku – zdarma 🎁',
        `<p>Ahoj <b>${u.name}</b>,</p><p>Práve sme ti <b>aktivovali členstvo Silver</b> — a to <b>úplne zadarmo</b> do konca tvojho aktuálneho obdobia (<b>${until}</b>).</p><p>Odteraz máš odomknutú <b>metabolickú analýzu tela</b> aj <b>online hodiny LIVE</b>. Vyskúšaj si to naplno! 💪</p><p>Silver sa ti začne účtovať až od <b>najbližšieho obnovenia</b> členstva — dovtedy nič nedoplácaš.</p>`,
        '📱 Objednať analýzu', `${APP_URL}/client-dashboard`)).catch(()=>{});
    res.json({ ok:true, until });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Zvolenie „prvý mesiac Silver za cenu Bronze" pred kúpou Bronzu.
// Nastaví príznak; po aktivácii Bronzu ho activateMembership premení na Silver-skúšku.
app.post('/api/membership/upsell-intent', auth, async(req,res)=>{
  try {
    const want = !!req.body.want;
    const u = await q.one(db.users,{_id:req.session.uid});
    if(want && u.silver_trial_used) return res.json({ok:false, error:'trial_used'});
    await q.update(db.users,{_id:req.session.uid},{$set:{pending_silver_upsell:want}});
    res.json({ok:true, pending:want});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Jedálniček na mieru (Gold benefit) ──────────────────────────────────────
// Vráti uložený profil + posledný vygenerovaný plán klientky.
app.get('/api/meal-plan', auth, async(req,res)=>{
  try {
    const rec = await q.one(db.meal_plans,{user_id:req.session.uid});
    const m = await checkMembership(req.session.uid);
    const u = await q.one(db.users,{_id:req.session.uid});
    const privileged = !!(u && (u.is_admin || u.user_type==='trainer' || u.user_type==='manager'));
    const hasMeal = !!(m && m.status==='active' && MEMBERSHIP_PLANS[m.plan_id]?.meal);
    const isGold = hasMeal || privileged;
    res.json({ ok:true, gold:!!isGold, staff:privileged, profile: rec?.profile||null, plan: rec?.plan||null });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Uloží profil a vygeneruje nový 7-dňový jedálniček. Len pre Gold členky.
app.post('/api/meal-plan/generate', auth, async(req,res)=>{
  try {
    const m = await checkMembership(req.session.uid);
    const u = await q.one(db.users,{_id:req.session.uid});
    const privileged = !!(u && (u.is_admin || u.user_type==='trainer' || u.user_type==='manager'));
    const hasMeal = !!(m && m.status==='active' && MEMBERSHIP_PLANS[m.plan_id]?.meal);
    if(!privileged && !hasMeal)
      return res.status(403).json({error:'not_gold'});
    const b = req.body||{};
    const profile = {
      gender: b.gender||'zena',
      age: Math.max(14, Math.min(90, +b.age||30)),
      height_cm: Math.max(130, Math.min(210, +b.height_cm||165)),
      weight_kg: Math.max(35, Math.min(200, +b.weight_kg||65)),
      goal: b.goal||'chudnutie',
      activity: b.activity||'stredna',
      meals_per_day: [3,4,5].includes(+b.meals_per_day) ? +b.meals_per_day : 4,
      diet: b.diet||'bezna',
      allergens: Array.isArray(b.allergens) ? b.allergens.slice(0,20).map(x=>String(x).slice(0,30)) : [],
      likes: String(b.likes||'').slice(0,500),
      dislikes: String(b.dislikes||'').slice(0,500),
      include_f1: !!b.include_f1,
      updated_at: nowISO()
    };
    const plan = generateMealPlan(profile);
    const existing = await q.one(db.meal_plans,{user_id:req.session.uid});
    if(existing) await q.update(db.meal_plans,{_id:existing._id},{$set:{profile, plan, updated_at:nowISO()}});
    else await q.insert(db.meal_plans,{user_id:req.session.uid, profile, plan, created_at:nowISO(), updated_at:nowISO()});
    res.json({ ok:true, profile, plan });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/membership/buy', auth, async(req,res)=>{
  try {
    const {plan_id, payment_method, use_referral_credit, for_child_id, promo_code} = req.body;
    const plan = MEMBERSHIP_PLANS[plan_id];
    if(!plan) return res.status(400).json({error:'Neplatný plán'});
    const u = await q.one(db.users,{_id:req.session.uid}); // parent = payer
    // ── Membership for a child? ────────────────────────────────────────────────
    let memberId = req.session.uid;
    let childName = null;
    if(for_child_id){
      const child = await q.one(db.users,{_id:for_child_id});
      if(!child || child.parent_id !== req.session.uid || child.active===false)
        return res.status(403).json({error:'Neplatný detský profil'});
      memberId = child._id; childName = child.name;
    }
    const forWhom = childName ? ` (${childName})` : '';

    // ── Promo / zľavový kód (aplikuje sa na cenu plánu, pred kreditom) ─────────
    let promoDiscount = 0, promoCode = null, promoObj = null;
    let basePrice = plan.price;
    if(promo_code){
      const v = await validatePromo(promo_code, plan.price, req.session.uid);
      if(!v.ok) return res.status(400).json({error:'Promo kód: '+v.reason});
      promoDiscount = v.discount; basePrice = v.final; promoCode = v.promo.code; promoObj = v.promo;
    }

    // ── Referral credit discount (always from parent's balance) ────────────────
    let creditUsed = 0;
    let finalPrice = basePrice;
    if(use_referral_credit && (u.referral_credit||0) > 0){
      creditUsed = Math.min(u.referral_credit, basePrice);
      finalPrice = Math.max(0, +(basePrice - creditUsed).toFixed(2));
      await q.update(db.users,{_id:u._id},{$set:{referral_credit: +(u.referral_credit - creditUsed).toFixed(2)}});
      await q.insert(db.notifications,{user_id:u._id,type:'credit',title:`Referral kredit použitý 💳`,body:`${creditUsed.toFixed(2)} € zľava na ${plan.name}${forWhom}. Nový zostatok: ${(u.referral_credit-creditUsed).toFixed(2)} €`,read:false,created_at:nowISO()});
    }

    // Zaznamenaj použitie promo kódu (raz na nákup)
    if(promoObj){ await recordPromoRedemption(promoObj, req.session.uid, promoDiscount);
      await q.insert(db.notifications,{user_id:u._id,type:'credit',title:`Promo kód ${promoCode} 🎟️`,body:`Zľava ${promoDiscount.toFixed(2)} € na ${plan.name}${forWhom}.`,read:false,created_at:nowISO()}).catch(()=>{}); }
    const promoNote = promoCode ? ` [promo ${promoCode} -${promoDiscount.toFixed(2)}€]` : '';

    if(finalPrice === 0){
      // Fully covered by credit/promo – activate immediately
      await activateMembership(memberId, plan_id, plan.duration_days||30);
      await q.insert(db.transactions,{type:'membership',user_id:memberId,user_name:childName||u.name,amount:0,payment_method:'referral_credit',note:`${plan.name}${forWhom} – 100% hradené kreditom${promoNote}`,plan_id,promo_code:promoCode,created_at:nowISO(),month:today().slice(0,7)});
      return res.json({ok:true, credit_used:creditUsed, promo_discount:promoDiscount, final_price:0, message:`Členstvo ${plan.name}${forWhom} aktivované${promoCode?' (promo '+promoCode+')':' pomocou referral kreditu'}!`});
    }

    if(payment_method==='paypal'){
      if(!PAYPAL_CLIENT_ID) {
        // Demo mode – activate immediately
        await activateMembership(memberId, plan_id, plan.duration_days||30);
        return res.json({ok:true, demo:true, credit_used:creditUsed, final_price:finalPrice, message:'Demo: členstvo aktivované bez PayPal'});
      }
      const result = await ppCreateOrder(finalPrice,'EUR',`Fusion Academy – ${plan.name}${forWhom}`);
      if(result.status!==201) return res.status(400).json({error:'PayPal chyba'});
      const payment = await q.insert(db.payments,{paypal_order_id:result.body.id,user_id:req.session.uid,member_id:memberId,amount:finalPrice,currency:'EUR',description:`Členstvo ${plan.name}${forWhom}${promoNote}`,ref_id:plan_id,ref_type:'membership',status:'pending',created_at:nowISO(),credit_used:creditUsed,promo_code:promoCode});
      return res.json({ok:true, paypalOrderId:result.body.id, paymentId:payment._id, credit_used:creditUsed, promo_discount:promoDiscount, final_price:finalPrice});
    }
    // Bank transfer / cash – admin will confirm
    await q.insert(db.payments,{user_id:req.session.uid,member_id:memberId,amount:finalPrice,currency:'EUR',description:`Členstvo ${plan.name}${forWhom}${creditUsed?` (kredit: -${creditUsed}€)`:''}${promoNote}`,ref_id:plan_id,ref_type:'membership',status:'pending_manual',payment_method:'manual',created_at:nowISO(),credit_used:creditUsed,promo_code:promoCode});
    res.json({ok:true, credit_used:creditUsed, promo_discount:promoDiscount, final_price:finalPrice, message:'Žiadosť o členstvo bola odoslaná. Admin ju potvrdí po prijatí platby.'});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// INVOICING — SK-compliant invoices, auto-issued on every successful payment
// Supplier data from env (fill on Railway): COMPANY_NAME, COMPANY_ADDRESS,
// COMPANY_ICO, COMPANY_DIC, COMPANY_ICDPH (empty = neplatiteľ DPH), COMPANY_IBAN
// ═══════════════════════════════════════════════════════════════════════════════
function invoiceSupplier(){
  return {
    name:    process.env.COMPANY_NAME    || 'Fusion Academy s.r.o.',
    address: process.env.COMPANY_ADDRESS || 'Záhradná 7, 962 12 Detva',
    ico:     process.env.COMPANY_ICO     || '00000000',
    dic:     process.env.COMPANY_DIC     || '0000000000',
    icdph:   process.env.COMPANY_ICDPH   || '',       // empty ⇒ not a VAT payer
    iban:    process.env.COMPANY_IBAN    || ''
  };
}

// Immutable audit trail for financial actions (insert-only, never edited)
async function auditLog(req, action, target, before, after, reason){
  try {
    await q.insert(db.audit, {
      action, target: target||null,
      before: before===undefined?null:before,
      after:  after===undefined?null:after,
      reason: reason||'',
      actor_id: req?.session?.uid||null,
      actor_name: req?._auditActor||null,
      ip: (req?.headers?.['x-forwarded-for']||'').split(',')[0] || req?.socket?.remoteAddress || null,
      created_at: nowISO()
    });
  } catch(e){ console.error('Audit error:', e.message); }
}

// Sequential yearly numbering: 2026 0001 … (number doubles as variabilný symbol)
async function nextInvoiceNumber(){
  const year = String(new Date().getFullYear());
  const existing = await q.find(db.invoices, {});
  const inYear = existing.filter(i=>String(i.number).startsWith(year));
  let seq = inYear.length + 1;
  for(let attempt=0; attempt<20; attempt++, seq++){
    const num = year + String(seq).padStart(4,'0');
    if(!inYear.some(i=>String(i.number)===num)) return num;
  }
  return year + String(Date.now()).slice(-4);
}

// Create + archive an invoice, then email the payment confirmation. Never throws.
async function createInvoice({user_id, client_name, client_email, items, total, method, type, related_invoice, paid_at}){
  try {
    const number = await nextInvoiceNumber();
    const inv = await q.insert(db.invoices, {
      number, vs: number,
      type: type||'invoice',                       // 'invoice' | 'credit_note'
      related_invoice: related_invoice||null,
      user_id: user_id||null,
      client_name: client_name||'—', client_email: client_email||'',
      items: items||[], total: +(+total).toFixed(2), currency:'EUR',
      payment_method: method||'—',
      issued_at: today(), paid_at: paid_at||today(),
      status: type==='credit_note' ? 'credited' : 'paid',
      supplier: invoiceSupplier(),
      created_at: nowISO()
    });
    if(inv.type==='invoice' && inv.client_email && !inv.client_email.includes('@internal.local')){
      const rows = (inv.items||[]).map(it=>`<tr><td style="padding:6px 0;color:#ccc">${it.desc}</td><td style="padding:6px 0;text-align:right;color:#fff;white-space:nowrap">${(+it.total).toFixed(2)} €</td></tr>`).join('');
      sendMail(inv.client_email, `Ďakujeme za platbu · faktúra ${inv.number} — Fusion Academy`,
        emailTemplate('Platba prijatá ✅',
          `<p>Ahoj <b>${inv.client_name}</b>,</p>
           <p>ďakujeme! Tvoju platbu sme v poriadku prijali${(inv.items||[]).some(i=>/Členstvo|Odber/i.test(i.desc))?' a <b>členstvo je aktívne</b>':''}.</p>
           <div style="background:#1c1c1c;border-radius:12px;padding:16px 18px;margin:14px 0">
             <table width="100%" style="border-collapse:collapse;font-size:14px">${rows}
               <tr><td style="padding:10px 0 0;border-top:1px solid #333;color:#C9A84C;font-weight:800">Spolu</td>
                   <td style="padding:10px 0 0;border-top:1px solid #333;text-align:right;color:#C9A84C;font-weight:800">${inv.total.toFixed(2)} €</td></tr>
             </table>
             <div style="color:#888;font-size:12px;margin-top:10px">Faktúra č. <b style="color:#ccc">${inv.number}</b> · VS ${inv.vs} · ${inv.paid_at} · ${inv.payment_method}</div>
           </div>
           <p style="color:#999;font-size:13px">Faktúru si môžeš kedykoľvek zobraziť a stiahnuť (tlač → PDF) vo svojom profile.</p>`,
          '🧾 Zobraziť faktúru', `${APP_URL}/invoice/${inv.number}`)).catch(()=>{});
    }
    return inv;
  } catch(e){ console.error('Invoice error:', e.message); return null; }
}

// ── Invoice API ────────────────────────────────────────────────────────────────
// Owner or admin can read a single invoice
app.get('/api/invoice/:number', auth, async(req,res)=>{
  const inv = await q.one(db.invoices,{number:req.params.number});
  if(!inv) return res.status(404).json({error:'Faktúra nenájdená'});
  const me = await q.one(db.users,{_id:req.session.uid});
  if(inv.user_id!==req.session.uid && !me?.is_admin) return res.status(403).json({error:'Prístup zamietnutý'});
  res.json(inv);
});

// My invoices (client)
app.get('/api/my-invoices', auth, async(req,res)=>{
  const list = await q.find(db.invoices,{user_id:req.session.uid});
  res.json(list.sort((a,b)=>b.number.localeCompare(a.number)).slice(0,100));
});

// Admin list with filters: ?year=&month=&q=&status=
app.get('/api/admin/invoices', adminAuth, async(req,res)=>{
  let list = await q.find(db.invoices,{});
  const {year, month, q:term, status} = req.query;
  if(year)  list = list.filter(i=>String(i.number).startsWith(String(year)));
  if(month) list = list.filter(i=>(i.issued_at||'').slice(5,7)===String(month).padStart(2,'0'));
  if(status)list = list.filter(i=>i.status===status);
  if(term){ const rx=new RegExp(term,'i'); list=list.filter(i=>rx.test(i.client_name)||rx.test(i.client_email||'')||rx.test(i.number)); }
  res.json(list.sort((a,b)=>b.number.localeCompare(a.number)).slice(0,500));
});

// CSV export (accounting-friendly)
app.get('/api/admin/invoices/export.csv', adminAuth, async(req,res)=>{
  const list = (await q.find(db.invoices,{})).sort((a,b)=>a.number.localeCompare(b.number));
  const esc = v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const rows = [['Cislo','VS','Typ','Stav','Vystavena','Uhradena','Klient','Email','Popis','Suma EUR','Sposob platby'].join(';')];
  for(const i of list) rows.push([i.number,i.vs,i.type,i.status,i.issued_at,i.paid_at,i.client_name,i.client_email,(i.items||[]).map(x=>x.desc).join(' | '),i.total.toFixed(2).replace('.',','),i.payment_method].map(esc).join(';'));
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename=faktury.csv');
  res.send('﻿'+rows.join('\r\n'));
});

// Storno (invoice stays archived, status changes; audited)
app.post('/api/admin/invoices/:number/cancel', adminAuth, async(req,res)=>{
  const inv = await q.one(db.invoices,{number:req.params.number});
  if(!inv) return res.status(404).json({error:'Faktúra nenájdená'});
  if(inv.status==='cancelled') return res.status(400).json({error:'Už stornovaná'});
  await q.update(db.invoices,{_id:inv._id},{$set:{status:'cancelled',cancelled_at:nowISO()}});
  await auditLog(req,'invoice_cancel',inv.number,{status:inv.status},{status:'cancelled'},req.body.reason||'');
  res.json({ok:true});
});

// Dobropis (credit note referencing the original invoice; audited)
app.post('/api/admin/invoices/:number/credit-note', adminAuth, async(req,res)=>{
  const inv = await q.one(db.invoices,{number:req.params.number});
  if(!inv) return res.status(404).json({error:'Faktúra nenájdená'});
  const amount = +(req.body.amount ?? inv.total);
  if(!(amount>0) || amount>inv.total) return res.status(400).json({error:'Neplatná suma dobropisu'});
  const cn = await createInvoice({
    user_id:inv.user_id, client_name:inv.client_name, client_email:inv.client_email,
    items:[{desc:`Dobropis k faktúre ${inv.number}${req.body.reason?` — ${req.body.reason}`:''}`, qty:1, total:-amount}],
    total:-amount, method:inv.payment_method, type:'credit_note', related_invoice:inv.number
  });
  await q.update(db.invoices,{_id:inv._id},{$set:{status:'credited',credit_note:cn?.number||null}});
  await auditLog(req,'invoice_credit_note',inv.number,{status:inv.status},{status:'credited',credit_note:cn?.number,amount},req.body.reason||'');
  // Notify client about the credit note / refund
  if(inv.client_email && !inv.client_email.includes('@internal.local') && cn){
    sendMail(inv.client_email, `Dobropis ${cn.number} k faktúre ${inv.number} — Fusion Academy`,
      emailTemplate('Vystavili sme dobropis',
        `<p>Ahoj <b>${inv.client_name}</b>,</p>
         <p>K faktúre <b>${inv.number}</b> sme vystavili dobropis na sumu <b>${amount.toFixed(2)} €</b>${req.body.reason?` (${req.body.reason})`:''}.</p>
         <p>Vrátenú sumu ti pošleme rovnakým spôsobom, akým prebehla pôvodná platba. Ak máš otázky, stačí odpovedať na tento email.</p>`,
        '🧾 Zobraziť dobropis', `${APP_URL}/invoice/${cn.number}`)).catch(()=>{});
  }
  res.json({ok:true, credit_note:cn?.number});
});

// Audit log (main admin only, read-only)
app.get('/api/admin/audit', adminAuth, async(req,res)=>{
  let list = await q.find(db.audit,{});
  list = list.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')).slice(0,400);
  // doplň meno aktéra ak chýba
  const cache={};
  for(const e of list){
    if(!e.actor_name && e.actor_id){
      if(!(e.actor_id in cache)){ const u=await q.one(db.users,{_id:e.actor_id}); cache[e.actor_id]=u?u.name:'—'; }
      e.actor_name=cache[e.actor_id];
    }
  }
  res.json(list);
});

// ── Finance stats with period filter ──────────────────────────────────────────
// Prehľad aktívnych členstiev (po úrovniach) a aktívnych permanentiek — kto ich má.
app.get('/api/admin/memberships-overview', adminAuth, async(req,res)=>{
  try {
    const nowISOv = new Date().toISOString();
    const users = await q.find(db.users,{});
    const uMap = Object.fromEntries(users.map(u=>[u._id,u]));
    // Aktívne členstvá: status active a platnosť do budúcna; jeden (najneskôr expirujúci) na usera
    const membs = (await q.find(db.memberships,{status:'active'}))
      .filter(m=> (m.expires_at||'') > nowISOv && MEMBERSHIP_PLANS[m.plan_id] && MEMBERSHIP_PLANS[m.plan_id].type!=='bundle');
    const bestByUser = {};
    for(const m of membs){
      const cur = bestByUser[m.user_id];
      if(!cur || (m.expires_at||'') > (cur.expires_at||'')) bestByUser[m.user_id]=m;
    }
    const members = Object.values(bestByUser).map(m=>{
      const u = uMap[m.user_id] || {};
      const plan = MEMBERSHIP_PLANS[m.plan_id] || {};
      return {
        id: m.user_id, name: u.name||'—', email: u.email||'', phone: u.phone||'',
        plan_id: m.plan_id, plan_name: plan.name||m.plan_name||m.plan_id,
        price: +plan.price||+m.price||0, expires_at: (m.expires_at||'').slice(0,10),
        trial: !!m.trial, method: m.payment_method||m.method||'',
        active: u.active!==false,
      };
    });
    // Aktívne permanentky: používatelia s nevyčerpanými vstupmi
    const passes = users.filter(u=>(u.single_entries||0)>0 && u.is_admin!==true).map(u=>({
      id:u._id, name:u.name||'—', email:u.email||'', phone:u.phone||'', entries:u.single_entries||0,
      active:u.active!==false,
    }));
    // Súhrn po úrovniach
    const byPlan = {};
    for(const m of members){ byPlan[m.plan_id]=(byPlan[m.plan_id]||0)+1; }
    const planOrder = ['bronze','silver','gold','online_basic','online_premium','kids'];
    const summary = planOrder.filter(p=>byPlan[p]).map(p=>({plan_id:p, name:MEMBERSHIP_PLANS[p]?.name||p, count:byPlan[p]}))
      .concat(Object.keys(byPlan).filter(p=>!planOrder.includes(p)).map(p=>({plan_id:p, name:MEMBERSHIP_PLANS[p]?.name||p, count:byPlan[p]})));
    const mrr = members.reduce((s,m)=>s+(m.trial?0:m.price),0);
    res.json({
      ok:true,
      summary, total_members: members.length,
      passes_count: passes.length, passes_entries: passes.reduce((s,p)=>s+p.entries,0),
      mrr:+mrr.toFixed(2),
      members, passes
    });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/admin/finance/stats', adminAuth, async(req,res)=>{
  try {
    const {from, to} = req.query; // YYYY-MM-DD inclusive
    const fromISO = from ? from+'T00:00:00' : '0000';
    const toISO   = to   ? to+'T23:59:59'   : '9999';
    const payments=(await q.find(db.payments,{})).filter(p=>['completed','active'].includes(p.status));
    const membs=(await q.find(db.memberships,{})).filter(m=>!m._type);
    const cashMembs=membs.filter(m=>m.payment_method);
    const orders=(await q.find(db.orders,{})).filter(o=>o.status==='paid');
    const users=(await q.find(db.users,{is_admin:{$ne:true}})).filter(u=>u.user_type!=='trainer' && !u.is_child);

    const payDate = p=>p.captured_at||p.activated_at||p.created_at||'';
    const rev = list => +list.reduce((s,x)=>s+(+x.amount||+x.total||+x.price||0),0).toFixed(2);
    const inRange = (d)=> d>=fromISO && d<=toISO;
    const singleEntries = (await q.find(db.transactions,{type:'single_entry'}));
    const allEvents = [
      ...payments.map(p=>({d:payDate(p), a:+p.amount||0})),
      ...cashMembs.map(m=>({d:m.created_at||'', a:+m.price||0})),
      ...orders.map(o=>({d:o.paid_at||o.created_at||'', a:+o.total||0})),
      ...singleEntries.map(t=>({d:t.created_at||'', a:+t.amount||0}))
    ];
    const period = allEvents.filter(e=>inRange(e.d));
    const revenuePeriod = +period.reduce((s,e)=>s+e.a,0).toFixed(2);

    const now = new Date();
    const dayStr = today();
    const monthStr = dayStr.slice(0,7);
    const yearStr  = dayStr.slice(0,4);
    const revToday = +allEvents.filter(e=>e.d.startsWith(dayStr)).reduce((s,e)=>s+e.a,0).toFixed(2);
    const revMonth = +allEvents.filter(e=>e.d.startsWith(monthStr)).reduce((s,e)=>s+e.a,0).toFixed(2);
    const revYear  = +allEvents.filter(e=>e.d.startsWith(yearStr)).reduce((s,e)=>s+e.a,0).toFixed(2);
    const revTotal = +allEvents.reduce((s,e)=>s+e.a,0).toFixed(2);

    // MRR = recurring subscriptions only (Stripe + PayPal)
    let mrr = 0;
    for(const u of users){
      if(u.stripe_subscription_id){ mrr += MEMBERSHIP_PLANS[u.stripe_sub_plan]?.price||0; }
      if(u.paypal_subscription_id){ mrr += MEMBERSHIP_PLANS[u.subscription_plan]?.price||0; }
    }
    mrr = +mrr.toFixed(2);

    const nowISOs = now.toISOString();
    const activeMemberIds = new Set(membs.filter(m=>(m.expires_at||'')>nowISOs).map(m=>m.user_id));
    const newMembers = users.filter(u=>(u.created_at||'')>=String(from||'0000') && (u.created_at||'')<=String(to||'9999')).length;
    const newMemberships = membs.filter(m=>inRange(m.created_at||'')).length;
    const expiredNotRenewed = membs.filter(m=>{
      const exp=m.expires_at||''; if(!(exp>=fromISO && exp<=toISO && exp<nowISOs)) return false;
      return !membs.some(m2=>m2.user_id===m.user_id && (m2.started_at||'')>exp);
    }).length;

    const payingByUser = {};
    allEvents.length; // noop
    for(const p of payments){ if(p.user_id) payingByUser[p.user_id]=(payingByUser[p.user_id]||0)+(+p.amount||0); }
    for(const m of cashMembs){ payingByUser[m.user_id]=(payingByUser[m.user_id]||0)+(+m.price||0); }
    const payers = Object.keys(payingByUser).length;
    const avgClientValue = payers? +(Object.values(payingByUser).reduce((s,v)=>s+v,0)/payers).toFixed(2) : 0;
    const aov = period.length ? +(revenuePeriod/period.length).toFixed(2) : 0;

    // daily series for the chart
    const series = {};
    period.forEach(e=>{ const d=e.d.slice(0,10); series[d]=+( (series[d]||0)+e.a ).toFixed(2); });

    res.json({
      revenue:{ today:revToday, month:revMonth, year:revYear, total:revTotal, period:revenuePeriod },
      mrr, arr:+(mrr*12).toFixed(2),
      avgMonthly:+(revYear/Math.max(1,now.getMonth()+1)).toFixed(2),
      aov, avgClientValue,
      activeMembers:activeMemberIds.size, newMembers, newMemberships, expiredNotRenewed,
      txCount:period.length,
      series:Object.entries(series).sort((a,b)=>a[0].localeCompare(b[0])).map(([d,v])=>({d,v}))
    });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── PHASE E: Retention / Churn / Payback / LTV kohorty ─────────────────────────
app.get('/api/admin/analytics/retention', adminAuth, async(req,res)=>{
  try {
    const users=(await q.find(db.users,{is_admin:{$ne:true}})).filter(u=>u.user_type!=='trainer' && !u.is_child);
    const membs=(await q.find(db.memberships,{})).filter(m=>!m._type);
    const bookings=await q.find(db.bookings,{});
    const payments=(await q.find(db.payments,{})).filter(p=>['completed','active'].includes(p.status));

    // paid total per user (payments + cash memberships)
    const paidByUser={};
    for(const p of payments){ if(p.user_id) paidByUser[p.user_id]=(paidByUser[p.user_id]||0)+(+p.amount||0); }
    for(const m of membs){ if(m.payment_method) paidByUser[m.user_id]=(paidByUser[m.user_id]||0)+(+m.price||0); }

    // bookings grouped per user (with dates + primary city)
    const bookByUser={};
    for(const b of bookings){
      if(!b.user_id) continue;
      (bookByUser[b.user_id]=bookByUser[b.user_id]||[]).push(b);
    }
    const primaryCity=uid=>{
      const bs=bookByUser[uid]||[]; if(!bs.length) return '—';
      const c={}; bs.forEach(b=>{ const l=b.class_location||'—'; c[l]=(c[l]||0)+1; });
      return Object.entries(c).sort((a,b)=>b[1]-a[1])[0][0];
    };
    // primary plan per user = latest membership plan
    const primaryPlan=uid=>{
      const ms=membs.filter(m=>m.user_id===uid).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
      return ms.length? (ms[0].plan_name||ms[0].plan_id||'—') : '—';
    };

    const nowMs=Date.now();
    // ── CHURN: members whose latest membership expired & not renewed vs all who ever had a membership
    const memberIds=[...new Set(membs.map(m=>m.user_id))];
    let churned=0, activeNow=0;
    for(const uid of memberIds){
      const ms=membs.filter(m=>m.user_id===uid);
      const latestExp=ms.reduce((mx,m)=>{ const e=m.expires_at||''; return e>mx?e:mx; },'');
      if(latestExp && new Date(latestExp).getTime()>=nowMs) activeNow++; else churned++;
    }
    const churnRate = memberIds.length? +(churned/memberIds.length*100).toFixed(1) : 0;
    const retentionRate = memberIds.length? +(activeNow/memberIds.length*100).toFixed(1) : 0;

    // ── RETENTION cohorts by signup month: % who booked within N days of signup
    const windows=[30,60,90,180,365];
    const cohortMap={};
    for(const u of users){
      const signup=u.created_at||''; if(!signup) continue;
      const month=signup.slice(0,7);
      const signupMs=new Date(signup).getTime();
      const co=cohortMap[month]=cohortMap[month]||{month, size:0, ret:Object.fromEntries(windows.map(w=>[w,0]))};
      co.size++;
      const bs=bookByUser[u._id]||[];
      for(const w of windows){
        const cutoff=signupMs + w*86400000;
        if(bs.some(b=>{ const t=new Date(b.booking_date||b.created_at||0).getTime(); return t>=signupMs && t<=cutoff; })) co.ret[w]++;
      }
    }
    const cohorts=Object.values(cohortMap).sort((a,b)=>a.month.localeCompare(b.month)).map(c=>({
      month:c.month, size:c.size,
      retention:Object.fromEntries(windows.map(w=>[w, c.size? +(c.ret[w]/c.size*100).toFixed(0):0]))
    }));

    // ── LTV by plan / by city
    const agg=(keyFn)=>{
      const m={};
      for(const u of users){
        const paid=paidByUser[u._id]||0; if(paid<=0) continue;
        const k=keyFn(u._id)||'—';
        const e=m[k]=m[k]||{key:k, payers:0, revenue:0};
        e.payers++; e.revenue+=paid;
      }
      return Object.values(m).map(e=>({...e, revenue:+e.revenue.toFixed(2), ltv:+(e.revenue/e.payers).toFixed(2)}))
        .sort((a,b)=>b.ltv-a.ltv);
    };
    const ltvByPlan=agg(primaryPlan);
    const ltvByCity=agg(primaryCity);

    // ── PAYBACK: avg CAC / avg monthly revenue per paying customer
    const campaigns=await q.find(db.campaigns,{});
    const totalSpend=campaigns.reduce((s,c)=>s+(+c.spend||0),0);
    const totalPayers=Object.keys(paidByUser).filter(uid=>paidByUser[uid]>0).length;
    const cac= totalPayers && totalSpend ? +(totalSpend/totalPayers).toFixed(2) : 0;
    // avg monthly spend per paying customer = avg(paid / months active), months from first->last activity min 1
    let mspendSum=0, mspendN=0;
    for(const uid of Object.keys(paidByUser)){
      const paid=paidByUser[uid]; if(paid<=0) continue;
      const ms=membs.filter(m=>m.user_id===uid);
      let months=1;
      if(ms.length){
        const starts=ms.map(m=>new Date(m.started_at||m.created_at||0).getTime()).filter(Boolean);
        const first=Math.min(...starts);
        months=Math.max(1, Math.round((nowMs-first)/(30*86400000)));
      }
      mspendSum+=paid/months; mspendN++;
    }
    const avgMonthlySpend= mspendN? +(mspendSum/mspendN).toFixed(2) : 0;
    const paybackMonths= avgMonthlySpend>0 && cac>0 ? +(cac/avgMonthlySpend).toFixed(1) : null;

    res.json({
      churn:{ churnRate, retentionRate, everMembers:memberIds.length, activeNow, churned },
      cohorts, windows,
      ltvByPlan, ltvByCity,
      payback:{ cac, avgMonthlySpend, paybackMonths, totalSpend:+totalSpend.toFixed(2), totalPayers }
    });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── PHASE F: CRM detail klienta (360° pohľad) ──────────────────────────────────
app.get('/api/admin/crm/client/:id', adminAuth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.params.id});
    if(!u) return res.status(404).json({error:'Klient nenájdený'});
    const payments=(await q.find(db.payments,{user_id:u._id})).filter(p=>['completed','active'].includes(p.status));
    const membs=(await q.find(db.memberships,{user_id:u._id})).filter(m=>!m._type);
    const bookings=(await q.find(db.bookings,{user_id:u._id}));
    const invoices=(await q.find(db.invoices,{user_id:u._id})).filter(i=>i.type!=='credit_note');

    const totalPaid = +([
      ...payments.map(p=>+p.amount||0),
      ...membs.filter(m=>m.payment_method).map(m=>+m.price||0)
    ].reduce((s,x)=>s+x,0)).toFixed(2);

    // visit stats
    const attended = bookings.filter(b=>b.status!=='cancelled');
    const visitDates = attended.map(b=>b.booking_date||b.created_at).filter(Boolean).sort();
    const lastVisit = visitDates.length? visitDates[visitDates.length-1] : null;
    const firstVisit = visitDates.length? visitDates[0] : null;
    let avgPerMonth=0;
    if(firstVisit){
      const months=Math.max(1, Math.round((Date.now()-new Date(firstVisit).getTime())/(30*86400000)));
      avgPerMonth=+(attended.length/months).toFixed(1);
    }
    const topBy=(field)=>{
      const c={}; attended.forEach(b=>{ const k=b[field]||'—'; c[k]=(c[k]||0)+1; });
      const e=Object.entries(c).sort((a,b)=>b[1]-a[1]); return e.length?e[0][0]:'—';
    };
    const activeMemb = membs.find(m=>(m.expires_at||'')> new Date().toISOString());

    // Refundácie k platbám tohto klienta (na zobrazenie stavu + zákaz dvojitého refundu)
    const refundsForUser = await q.find(db.refunds,{user_id:u._id});
    const refundByPay = {};
    for(const r of refundsForUser){ if(r.payment_id) refundByPay[r.payment_id]=r; }

    res.json({
      profile:{ id:u._id, name:u.name, email:u.email, phone:u.phone||'', created_at:u.created_at,
        user_type:u.user_type||'client', active:u.active!==false,
        acq:{ utm_source:u.utm_source||'', utm_campaign:u.utm_campaign||'', lead_source:u.lead_source||'' },
        referral_credit:+u.referral_credit||0, notes:u.notes||'' },
      kpis:{ totalPaid, ltv:totalPaid, visits:attended.length, avgPerMonth,
        firstVisit, lastVisit, topStudio:topBy('class_location'), topInstructor:topBy('instructor'),
        activeMembership: activeMemb? {plan_name:activeMemb.plan_name, expires_at:activeMemb.expires_at} : null },
      payments: payments.map(p=>{
        const r = refundByPay[p._id];
        return {id:p._id, date:p.captured_at||p.activated_at||p.created_at, amount:+p.amount||0,
          method:p.provider||p.method||'—', note:p.note||p.plan_name||'', status:p.status,
          gateway: p.stripe_payment_intent ? 'stripe' : (p.paypal_capture_id ? 'paypal' : 'manual'),
          refundable: !r && (+p.amount||0)>0,
          refunded: r ? {amount:+r.amount||0, type:r.type, date:(r.created_at||'').slice(0,10), credit_note:r.credit_note||null} : null };
      }).sort((a,b)=>(b.date||'').localeCompare(a.date||'')),
      memberships: membs.map(m=>({plan_name:m.plan_name, price:+m.price||0, status:m.status, started_at:m.started_at, expires_at:m.expires_at, method:m.payment_method||'—'}))
        .sort((a,b)=>(b.started_at||'').localeCompare(a.started_at||'')),
      bookings: attended.map(b=>({date:b.booking_date||b.created_at, class_name:b.class_name, location:b.class_location, status:b.status}))
        .sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,50),
      invoices: invoices.map(i=>({number:i.number, total:+i.total||0, status:i.status, issued_at:i.issued_at}))
        .sort((a,b)=>(b.issued_at||'').localeCompare(a.issued_at||''))
    });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── PHASE G: Účtovníctvo — uzávierky, príjmy podľa rozmerov, exporty ───────────
async function accountingData(from, to){
  const fromISO=from?from+'T00:00:00':'0000';
  const toISO=to?to+'T23:59:59':'9999';
  const inRange=d=>d>=fromISO && d<=toISO;
  const payments=(await q.find(db.payments,{})).filter(p=>['completed','active'].includes(p.status));
  const membs=(await q.find(db.memberships,{})).filter(m=>!m._type);
  const orders=(await q.find(db.orders,{})).filter(o=>o.status==='paid');
  const singleEntries=await q.find(db.transactions,{type:'single_entry'});
  const bookings=await q.find(db.bookings,{});
  const invoices=(await q.find(db.invoices,{}));

  // per-user primary studio/instructor from bookings
  const uBook={};
  for(const b of bookings){ if(b.user_id) (uBook[b.user_id]=uBook[b.user_id]||[]).push(b); }
  const topOf=(uid,field)=>{ const bs=uBook[uid]||[]; if(!bs.length) return '—'; const c={}; bs.forEach(b=>{const k=b[field]||'—';c[k]=(c[k]||0)+1;}); return Object.entries(c).sort((a,b)=>b[1]-a[1])[0][0]; };

  const events=[
    ...payments.map(p=>({date:(p.captured_at||p.activated_at||p.created_at||''),amount:+p.amount||0,plan:p.plan_name||MEMBERSHIP_PLANS[p.stripe_sub_plan]?.name||MEMBERSHIP_PLANS[p.subscription_plan]?.name||'Platba',user_id:p.user_id,method:p.provider||p.method||'card'})),
    ...membs.filter(m=>m.payment_method).map(m=>({date:m.created_at||'',amount:+m.price||0,plan:m.plan_name||'Členstvo',user_id:m.user_id,method:m.payment_method})),
    ...orders.map(o=>({date:o.paid_at||o.created_at||'',amount:+o.total||0,plan:'E-shop',user_id:o.partner_id,method:o.payment_method||'cash'})),
    ...singleEntries.map(t=>({date:t.created_at||'',amount:+t.amount||0,plan:'Jednorazový vstup',user_id:t.user_id,method:t.method||'cash'}))
  ].filter(e=>inRange(e.date));

  const bucket=(keyFn)=>{ const m={}; for(const e of events){ const k=keyFn(e)||'—'; m[k]=(m[k]||0)+e.amount; } return Object.entries(m).map(([key,v])=>({key,revenue:+v.toFixed(2)})).sort((a,b)=>b.revenue-a.revenue); };

  const total=+events.reduce((s,e)=>s+e.amount,0).toFixed(2);
  const invPeriod=invoices.filter(i=>inRange(i.issued_at||'') && i.type!=='credit_note' && i.status!=='cancelled');
  const supplier=invoiceSupplier();
  const vatPayer=!!supplier.icdph;

  return {
    events,
    byPlan: bucket(e=>e.plan),
    byCity: bucket(e=>topOf(e.user_id,'class_location')),
    byInstructor: bucket(e=>topOf(e.user_id,'instructor')),
    byMethod: bucket(e=>e.method),
    byMonth: bucket(e=>(e.date||'').slice(0,7)).sort((a,b)=>a.key.localeCompare(b.key)),
    totals:{ revenue:total, txCount:events.length, invoiceCount:invPeriod.length,
      vatPayer, vatBase: vatPayer?+(total/1.2).toFixed(2):total, vat: vatPayer?+(total-total/1.2).toFixed(2):0 },
    supplier
  };
}

app.get('/api/admin/accounting/summary', adminAuth, async(req,res)=>{
  try { const d=await accountingData(req.query.from, req.query.to); delete d.events; res.json(d); }
  catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/admin/accounting/export.csv', adminAuth, async(req,res)=>{
  const d=await accountingData(req.query.from, req.query.to);
  const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const num=n=>n.toFixed(2).replace('.',',');
  const rows=[['Dátum','Popis','Spôsob','Suma EUR'].join(';')];
  d.events.sort((a,b)=>(a.date||'').localeCompare(b.date||''))
    .forEach(e=>rows.push([(e.date||'').slice(0,10),e.plan,e.method,num(e.amount)].map(esc).join(';')));
  rows.push('');
  rows.push([esc('SPOLU'),'','',esc(num(d.totals.revenue))].join(';'));
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename=uctovnictvo_${req.query.from||'vse'}_${req.query.to||''}.csv`);
  res.send('﻿'+rows.join('\r\n'));
});

// ISDOC 6.0.1 minimálny doklad pre jednu faktúru (SK/CZ e-faktúra XML schéma)
app.get('/api/admin/invoices/:number/isdoc', adminAuth, async(req,res)=>{
  const inv=await q.one(db.invoices,{number:req.params.number});
  if(!inv) return res.status(404).send('Faktúra nenájdená');
  const s=invoiceSupplier();
  const x=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const total=(+inv.total).toFixed(2);
  const lines=(inv.items||[]).map((it,i)=>`    <InvoiceLine>
      <ID>${i+1}</ID>
      <InvoicedQuantity unitCode="ks">1</InvoicedQuantity>
      <LineExtensionAmount currencyID="EUR">${(+it.total).toFixed(2)}</LineExtensionAmount>
      <Item><Description>${x(it.desc)}</Description></Item>
    </InvoiceLine>`).join('\n');
  const xml=`<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.1">
  <DocumentType>1</DocumentType>
  <ID>${x(inv.number)}</ID>
  <UUID>${x(inv._id)}</UUID>
  <IssueDate>${x((inv.issued_at||'').slice(0,10))}</IssueDate>
  <VATApplicable>${s.icdph?'true':'false'}</VATApplicable>
  <LocalCurrencyCode>EUR</LocalCurrencyCode>
  <AccountingSupplierParty><Party>
    <PartyName><Name>${x(s.name)}</Name></PartyName>
    <PostalAddress><StreetName>${x(s.address)}</StreetName></PostalAddress>
    <PartyIdentification><ID>${x(s.ico)}</ID></PartyIdentification>
    <PartyTaxScheme><CompanyID>${x(s.dic)}</CompanyID></PartyTaxScheme>
  </Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party>
    <PartyName><Name>${x(inv.client_name)}</Name></PartyName>
  </Party></AccountingCustomerParty>
  <InvoiceLines>
${lines}
  </InvoiceLines>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount currencyID="EUR">${total}</TaxExclusiveAmount>
    <PayableAmount currencyID="EUR">${total}</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;
  res.setHeader('Content-Type','application/xml; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename=${inv.number}.isdoc`);
  res.send(xml);
});

// ─── PHASE I: Reporty výkonu trénerov ───────────────────────────────────────────
app.get('/api/admin/trainers/performance', adminAuth, async(req,res)=>{
  try {
    const {from, to, city, trainer} = req.query;
    const fromISO=from?from+'T00:00:00':'0000';
    const toISO=to?to+'T23:59:59':'9999';
    // previous period of equal length for comparison
    let prevFromISO=null, prevToISO=null;
    if(from && to){
      const span=new Date(to).getTime()-new Date(from).getTime();
      prevToISO=new Date(new Date(from).getTime()-86400000).toISOString();
      prevFromISO=new Date(new Date(from).getTime()-86400000-span).toISOString();
    }
    const classes=await q.find(db.classes,{});
    const clsMap=Object.fromEntries(classes.map(c=>[c._id,c]));
    const bookings=await q.find(db.bookings,{});

    const bDate=b=>b.booking_date||(b.created_at||'').slice(0,10)||'';
    const instructorOf=b=>clsMap[b.class_id]?.instructor||'—';
    const cityOf=b=>b.class_location||clsMap[b.class_id]?.location||'—';

    const compute=(f,t)=>{
      const stats={}; // instructor → metrics
      for(const b of bookings){
        const d=bDate(b); if(!(d>=f.slice(0,10) && d<=t.slice(0,10))) continue;
        const ins=instructorOf(b);
        if(trainer && ins!==trainer) continue;
        if(city && cityOf(b)!==city) continue;
        const s=stats[ins]=stats[ins]||{instructor:ins, sessions:new Set(), attendances:0, noShows:0, cancels:0, clients:new Set(), revenue:0, capSum:0};
        const cls=clsMap[b.class_id];
        const sessKey=b.class_id+'|'+d;
        if(b.status==='cancelled'){ s.cancels++; continue; }
        if(b.status==='no_show'){ s.noShows++; }
        // attended or confirmed count as a held-seat
        if(['attended','confirmed','no_show'].includes(b.status)){
          if(!s.sessions.has(sessKey)){ s.sessions.add(sessKey); s.capSum+=(cls?.capacity||20); }
          if(b.status!=='no_show'){ s.attendances++; s.revenue+=(+cls?.price||10); }
          if(b.user_id) s.clients.add(b.user_id);
        }
      }
      return stats;
    };

    const cur=compute(fromISO,toISO);
    const prev=(prevFromISO)?compute(prevFromISO,prevToISO):{};

    // new vs returning: client's first-ever booking date
    const firstBookingOf={};
    for(const b of bookings){ if(!b.user_id||b.status==='cancelled') continue; const d=bDate(b); if(!firstBookingOf[b.user_id]||d<firstBookingOf[b.user_id]) firstBookingOf[b.user_id]=d; }

    const rows=Object.values(cur).map(s=>{
      const sessions=s.sessions.size;
      const occupancy = s.capSum? +(s.attendances/s.capSum*100).toFixed(1) : 0;
      const revPerSession = sessions? +(s.revenue/sessions).toFixed(2) : 0;
      let newC=0, retC=0;
      for(const uid of s.clients){ (firstBookingOf[uid]>=fromISO.slice(0,10)?newC++:retC++); }
      const prevRev = prev[s.instructor]?.revenue||0;
      const trend = prevRev>0 ? +(((s.revenue-prevRev)/prevRev)*100).toFixed(0) : null;
      return { instructor:s.instructor, sessions, attendances:s.attendances, occupancy,
        clients:s.clients.size, newClients:newC, returningClients:retC,
        noShows:s.noShows, cancels:s.cancels, revenue:+s.revenue.toFixed(2), revPerSession, trend };
    }).sort((a,b)=>b.revenue-a.revenue);

    // recommendations
    const recs=[];
    if(rows.length){
      const top=rows[0], flop=[...rows].sort((a,b)=>a.occupancy-b.occupancy)[0];
      if(top) recs.push(`🏆 Najvýkonnejší: ${top.instructor} — ${top.revenue.toFixed(2)} € z ${top.sessions} hodín.`);
      if(flop && flop.occupancy<40) recs.push(`⚠️ Nízka obsadenosť: ${flop.instructor} (${flop.occupancy}%) — zváž zmenu času/marketing.`);
      const bigNoShow=rows.find(r=>r.attendances>0 && r.noShows/(r.attendances+r.noShows)>0.2);
      if(bigNoShow) recs.push(`🔔 Vysoká absencia u ${bigNoShow.instructor} (${bigNoShow.noShows} no-show) — zapni pripomienky/potvrdenia.`);
    }

    const cities=[...new Set(classes.map(c=>c.location).filter(Boolean))].sort();
    const trainers=[...new Set(classes.map(c=>c.instructor).filter(Boolean))].sort();
    res.json({ rows, recommendations:recs, filters:{cities, trainers},
      totals:{ sessions:rows.reduce((s,r)=>s+r.sessions,0), attendances:rows.reduce((s,r)=>s+r.attendances,0),
        revenue:+rows.reduce((s,r)=>s+r.revenue,0).toFixed(2), avgOccupancy: rows.length?+(rows.reduce((s,r)=>s+r.occupancy,0)/rows.length).toFixed(1):0 } });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── PHASE J: Výplaty trénerov ──────────────────────────────────────────────────
// Per-trainer stats for a month (YYYY-MM): sessions, attendances, revenue, new clients, full classes
async function trainerMonthStats(month){
  const classes=await q.find(db.classes,{});
  const clsMap=Object.fromEntries(classes.map(c=>[c._id,c]));
  const bookings=await q.find(db.bookings,{});
  const bDate=b=>b.booking_date||(b.created_at||'').slice(0,10)||'';
  const firstBookingOf={};
  for(const b of bookings){ if(!b.user_id||b.status==='cancelled') continue; const d=bDate(b); if(!firstBookingOf[b.user_id]||d<firstBookingOf[b.user_id]) firstBookingOf[b.user_id]=d; }
  const stats={};
  const sessionAtt={}; // instructor|sessKey → attendance count
  for(const b of bookings){
    const d=bDate(b); if(!d.startsWith(month)) continue;
    const cls=clsMap[b.class_id]; const ins=cls?.instructor||'—';
    const s=stats[ins]=stats[ins]||{instructor:ins, sessions:new Set(), attendances:0, revenue:0, newClients:new Set(), fullClasses:0};
    if(b.status==='cancelled'||b.status==='no_show') continue;
    if(['attended','confirmed'].includes(b.status)){
      const sk=ins+'|'+b.class_id+'|'+d; s.sessions.add(sk.split('|').slice(1).join('|'));
      sessionAtt[sk]=(sessionAtt[sk]||0)+1;
      s.attendances++; s.revenue+=(+cls?.price||10);
      if(b.user_id){ if(firstBookingOf[b.user_id]===d) s.newClients.add(b.user_id); }
    }
  }
  // full classes + zoznam účastí na hodinu (pre výpočet €/klient nad prahom)
  for(const s of Object.values(stats)) s.session_atts=[];
  for(const [sk,att] of Object.entries(sessionAtt)){
    const [ins,cid]=sk.split('|'); const cap=clsMap[cid]?.capacity||20;
    if(stats[ins]){ stats[ins].session_atts.push(att); if(att>=cap) stats[ins].fullClasses++; }
  }
  return Object.values(stats).map(s=>({instructor:s.instructor, sessions:s.sessions.size, attendances:s.attendances, revenue:+s.revenue.toFixed(2), newClients:s.newClients.size, fullClasses:s.fullClasses, session_atts:s.session_atts}));
}

// Nový štandardný model: 10 € základ za hodinu + 1 € za každého klienta NAD 10 na hodine.
const DEFAULT_PAYOUT_RULE={fixed_per_class:10, pct_of_revenue:0, per_client:1, per_client_threshold:10, bonus_full_class:0, bonus_new_member:0};
// Počet "platených" účastníkov = súčet klientov nad prah na každej hodine
function billableAttendances(st, threshold){
  const thr=threshold||0;
  if(Array.isArray(st.session_atts)) return st.session_atts.reduce((s,a)=>s+Math.max(0,a-thr),0);
  return Math.max(0,(st.attendances||0)-thr); // fallback (staré dáta bez rozpisu hodín)
}
function computePayout(rule, st){
  const r={...DEFAULT_PAYOUT_RULE, ...(rule||{})};
  const billable=billableAttendances(st, r.per_client_threshold||0);
  const base=+(r.fixed_per_class*st.sessions + r.pct_of_revenue/100*st.revenue + r.per_client*billable).toFixed(2);
  const bonuses=+(r.bonus_full_class*st.fullClasses + r.bonus_new_member*st.newClients).toFixed(2);
  return {base, bonuses, billable};
}

// História hodín + zárobkov: jednotlivé odučené hodiny (session = hodina + dátum),
// kto učil, kto bol na hodine, tržba a zárobok trénera za tú hodinu. Filtre: mesiac/mesto/tréner.
app.get('/api/admin/class-history', adminAuth, async(req,res)=>{
  try {
    const month = (req.query.month||today().slice(0,7)).slice(0,7);
    const classes = await q.find(db.classes,{});
    const clsMap = Object.fromEntries(classes.map(c=>[c._id,c]));
    const users = await q.find(db.users,{});
    const uMap = Object.fromEntries(users.map(u=>[u._id,u]));
    const bookings = await q.find(db.bookings,{});
    const bDate=b=>b.booking_date||(b.created_at||'').slice(0,10)||'';
    const firstBookingOf={};
    for(const b of bookings){ if(!b.user_id||b.status==='cancelled') continue; const d=bDate(b); if(!firstBookingOf[b.user_id]||d<firstBookingOf[b.user_id]) firstBookingOf[b.user_id]=d; }
    const rules = Object.fromEntries((await q.find(db.payout_rules,{})).map(r=>[r.trainer,r]));
    const ruleFor = ins => {
      if(rules[ins]) return {...DEFAULT_PAYOUT_RULE,...rules[ins]};
      const key=Object.keys(rules).find(k=>ins&&k&&(k.includes(ins.split(' ')[0])||ins.includes(k.split(' ')[0])));
      return {...DEFAULT_PAYOUT_RULE,...(key?rules[key]:{})};
    };
    const sessions={};
    for(const b of bookings){
      const d=bDate(b); if(!d.startsWith(month)) continue;
      if(!['attended','confirmed'].includes(b.status)) continue;
      const cls=clsMap[b.class_id];
      const key=b.class_id+'|'+d;
      const s=sessions[key]=sessions[key]||{ date:d, class_id:b.class_id, class_name:cls?.name||b.class_name||'—',
        city:cls?.location||b.class_location||'—', trainer:cls?.instructor||'—', time_start:cls?.time_start||'',
        capacity:cls?.capacity||30, price:+cls?.price||10, attendees:[], newClients:0 };
      const u=uMap[b.user_id];
      s.attendees.push({ user_id:b.user_id, name:b.user_name||u?.name||b.child_name||'—', is_child:!!b.is_child_booking, status:b.status });
      if(b.user_id && firstBookingOf[b.user_id]===d) s.newClients++;
    }
    let list=Object.values(sessions).map(s=>{
      const count=s.attendees.length;
      const revenue=+(count*s.price).toFixed(2);
      const rule=ruleFor(s.trainer);
      const thr=rule.per_client_threshold||0;
      const over=Math.max(0,count-thr);
      const full=count>=s.capacity;
      const parts=[
        {label:'Základ za hodinu', amount:+(rule.fixed_per_class||0).toFixed(2)},
        {label:(thr>0?`Klienti nad ${thr}`:'Za účastníka')+` (${over}×${rule.per_client||0} €)`, amount:+((rule.per_client||0)*over).toFixed(2)},
        {label:`% z tržby (${rule.pct_of_revenue||0} %)`, amount:+((rule.pct_of_revenue||0)/100*revenue).toFixed(2)},
        {label:'Bonus plná hodina', amount:+(full?(rule.bonus_full_class||0):0).toFixed(2)},
        {label:`Bonus noví klienti (${s.newClients}×${rule.bonus_new_member||0} €)`, amount:+((rule.bonus_new_member||0)*s.newClients).toFixed(2)},
      ].filter(p=>p.amount);
      const earning=+parts.reduce((a,p)=>a+p.amount,0).toFixed(2);
      return { ...s, count, revenue, earning, earn_parts:parts };
    });
    if(req.query.city)    list=list.filter(s=>s.city===req.query.city);
    if(req.query.trainer) list=list.filter(s=>s.trainer===req.query.trainer);
    list.sort((a,b)=>b.date.localeCompare(a.date)||(a.time_start||'').localeCompare(b.time_start||''));
    const byTrainer={}, byCity={};
    for(const s of list){
      const t=byTrainer[s.trainer]=byTrainer[s.trainer]||{trainer:s.trainer,sessions:0,attendances:0,revenue:0,earning:0};
      t.sessions++; t.attendances+=s.count; t.revenue+=s.revenue; t.earning+=s.earning;
      const c=byCity[s.city]=byCity[s.city]||{city:s.city,sessions:0,attendances:0,revenue:0,earning:0};
      c.sessions++; c.attendances+=s.count; c.revenue+=s.revenue; c.earning+=s.earning;
    }
    const fix=o=>Object.values(o).map(x=>({...x,revenue:+x.revenue.toFixed(2),earning:+x.earning.toFixed(2)}));
    // trainer_id doplň k byTrainer (pre preklik na zárobky)
    const tidByName={}; users.forEach(u=>{ if(u.is_admin||u.user_type==='trainer'||u.user_type==='manager') tidByName[u.name]=u._id; });
    const byTrainerArr=fix(byTrainer).map(t=>({...t, trainer_id: tidByName[t.trainer] || (Object.entries(tidByName).find(([n])=>n.includes((t.trainer||'').split(' ')[0]))||[])[1] || null})).sort((a,b)=>b.earning-a.earning);
    const totals={ sessions:list.length, attendances:list.reduce((s,x)=>s+x.count,0),
      revenue:+list.reduce((s,x)=>s+x.revenue,0).toFixed(2), earning:+list.reduce((s,x)=>s+x.earning,0).toFixed(2) };
    res.json({ month, sessions:list, byTrainer:byTrainerArr, byCity:fix(byCity).sort((a,b)=>b.revenue-a.revenue), totals,
      cities:[...new Set(classes.map(c=>c.location).filter(Boolean))].sort(),
      trainers:[...new Set(classes.map(c=>c.instructor).filter(Boolean))].sort() });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/admin/payout-rules', adminAuth, async(req,res)=>{
  res.json(await q.find(db.payout_rules,{}));
});
app.put('/api/admin/payout-rules/:trainer', adminAuth, async(req,res)=>{
  const trainer=req.params.trainer;
  const fields={};
  for(const k of Object.keys(DEFAULT_PAYOUT_RULE)) fields[k]=+req.body[k]||0;
  const existing=await q.one(db.payout_rules,{trainer});
  if(existing){ await q.update(db.payout_rules,{_id:existing._id},{$set:{...fields,updated_at:nowISO()}}); }
  else { await q.insert(db.payout_rules,{trainer,...fields,created_at:nowISO()}); }
  await auditLog(req,'payout_rule_update',trainer,existing||null,fields,'');
  res.json({ok:true});
});

// Nastav štandardný model odmien (10 € + 1 €/klient nad 10) všetkým trénerom naraz
app.post('/api/admin/payout-rules/apply-standard', adminAuth, async(req,res)=>{
  try {
    const model = { fixed_per_class:10, pct_of_revenue:0, per_client:1, per_client_threshold:10, bonus_full_class:0, bonus_new_member:0 };
    const trainers = await q.find(db.users,{$or:[{user_type:'trainer'},{user_type:'manager'},{is_admin:true}]});
    let n=0;
    for(const t of trainers){
      const ex=await q.one(db.payout_rules,{trainer:t.name});
      if(ex){ await q.update(db.payout_rules,{_id:ex._id},{$set:{...model,updated_at:nowISO()}}); }
      else { await q.insert(db.payout_rules,{trainer:t.name,...model,created_at:nowISO()}); }
      n++;
    }
    await auditLog(req,'payout_rules_apply_standard',null,{},{trainers:n,model},'');
    res.json({ ok:true, trainers:n });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Výplatné pásky (e-mail trénerom aj adminom) ───────────────────────────────
function prevMonthStr(){ const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7); }
function fmtMonthSk(m){ const MN=['','január','február','marec','apríl','máj','jún','júl','august','september','október','november','december']; const [y,mo]=m.split('-'); return MN[+mo]+' '+y; }
async function trainerMonthPayslip(trainerUser, month){
  const tName=trainerUser.name;
  const rule = await q.one(db.payout_rules,{trainer:tName}) || {...DEFAULT_PAYOUT_RULE};
  const thr = rule.per_client_threshold||0;
  const st=(await trainerMonthStats(month)).find(s=>s.instructor===tName || (tName&&s.instructor&&s.instructor.includes(tName.split(' ')[0]))) || {sessions:0,attendances:0,revenue:0,newClients:0,fullClasses:0,session_atts:[]};
  const {base,bonuses,billable}=computePayout(rule,st);
  const affiliate=await affiliateCommissionFor(trainerUser._id, month);
  const rec=await q.one(db.payouts,{trainer:tName,month});
  const ded=rec?.deductions||0;
  const total=+(base+bonuses+affiliate-ded).toFixed(2);
  const lines=[
    ['Základ za hodinu', `${st.sessions}× ${rule.fixed_per_class||0} €`, +((rule.fixed_per_class||0)*st.sessions).toFixed(2)],
    [thr>0?`Klienti nad ${thr} na hodine`:'Odmena za účastníka', `${billable}× ${rule.per_client||0} €`, +((rule.per_client||0)*billable).toFixed(2)],
    ['% z tržby hodín', `${rule.pct_of_revenue||0} %`, +((rule.pct_of_revenue||0)/100*st.revenue).toFixed(2)],
    ['Bonus za plnú hodinu', `${st.fullClasses}×`, +((rule.bonus_full_class||0)*st.fullClasses).toFixed(2)],
    ['Bonus za nového klienta', `${st.newClients}×`, +((rule.bonus_new_member||0)*st.newClients).toFixed(2)],
    ['Affiliate provízie (moja línia)', '', affiliate],
  ].filter(l=>l[2]>0);
  if(ded>0) lines.push(['Zrážky', '', -ded]);
  return {tName, email:trainerUser.email, month, st, base, bonuses, billable, affiliate, ded, total, lines};
}
function payslipHtml(ps){
  const rows=ps.lines.map(l=>`<tr><td style="padding:7px 0;border-bottom:1px solid #333">${l[0]}${l[1]?` <span style="color:#888;font-size:.85em">· ${l[1]}</span>`:''}</td><td style="padding:7px 0;border-bottom:1px solid #333;text-align:right;color:#C9A84C;font-weight:700">${l[2].toFixed(2)} €</td></tr>`).join('');
  const body=`<p>Ahoj <b>${ps.tName}</b>,</p>
    <p>tvoja výplatná páska za <b>${fmtMonthSk(ps.month)}</b>:</p>
    <p style="color:#999;font-size:.85em">${ps.st.sessions} odučených hodín · ${ps.st.attendances} účastí · tržba hodín ${ps.st.revenue.toFixed(2)} €</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px">${rows}
      <tr><td style="padding:12px 0 0;font-weight:800;font-size:1.05em">SPOLU</td><td style="padding:12px 0 0;text-align:right;font-weight:800;font-size:1.15em;color:#81c784">${ps.total.toFixed(2)} €</td></tr>
    </table>`;
  return emailTemplate(`Výplatná páska – ${fmtMonthSk(ps.month)}`, body, 'Pozrieť v appke', `${APP_URL}/trainer`);
}
async function sendAllPayslips(month){
  const trainers = await q.find(db.users,{$or:[{user_type:'trainer'},{user_type:'manager'}]});
  const summary=[]; let sent=0;
  for(const t of trainers){
    const ps=await trainerMonthPayslip(t, month);
    if(ps.st.sessions===0 && ps.total===0) continue; // bez aktivity preskoč
    if(t.email){ const ok=await sendMail(t.email, `Výplatná páska – ${fmtMonthSk(month)}`, payslipHtml(ps)); if(ok) sent++; }
    await q.insert(db.notifications,{user_id:t._id,type:'payslip',title:'💶 Výplatná páska',body:`${fmtMonthSk(month)}: ${ps.total.toFixed(2)} €`,read:false,created_at:nowISO()}).catch(()=>{});
    summary.push({trainer:t.name, sessions:ps.st.sessions, base:ps.base, bonuses:ps.bonuses, affiliate:ps.affiliate, total:ps.total});
  }
  // Adminom súhrn všetkých pások
  summary.sort((a,b)=>b.total-a.total);
  const grand=+summary.reduce((s,r)=>s+r.total,0).toFixed(2);
  const rows=summary.map(r=>`<tr><td style="padding:6px 0;border-bottom:1px solid #333">${r.trainer} <span style="color:#888;font-size:.85em">· ${r.sessions} hod.${r.affiliate>0?` · aff ${r.affiliate.toFixed(2)} €`:''}</span></td><td style="padding:6px 0;border-bottom:1px solid #333;text-align:right;color:#C9A84C;font-weight:700">${r.total.toFixed(2)} €</td></tr>`).join('');
  const adminBody=`<p>Prehľad výplat trénerov za <b>${fmtMonthSk(month)}</b>:</p><table width="100%" style="border-collapse:collapse">${rows||'<tr><td>Žiadna aktivita</td></tr>'}<tr><td style="padding:10px 0 0;font-weight:800">SPOLU výplaty</td><td style="padding:10px 0 0;text-align:right;font-weight:800;color:#81c784">${grand.toFixed(2)} €</td></tr></table>`;
  const admins=await q.find(db.users,{is_admin:true});
  for(const a of admins){ if(a.email) await sendMail(a.email, `Prehľad výplat trénerov – ${fmtMonthSk(month)}`, emailTemplate(`Výplaty trénerov – ${fmtMonthSk(month)}`, adminBody, 'Otvoriť výplaty', `${APP_URL}/admin`)).catch(()=>{}); }
  return {sent, trainers:summary.length, grand, summary};
}
app.post('/api/admin/send-payslips', adminAuth, async(req,res)=>{
  try {
    const month = req.body.month || req.query.month || prevMonthStr();
    const r = await sendAllPayslips(month);
    await auditLog(req,'send_payslips',month,{},{sent:r.sent,trainers:r.trainers,grand:r.grand},'');
    res.json({ ok:true, month, ...r });
  } catch(e){ res.status(500).json({error:e.message}); }
});
// Stiahni výplatné pásky za mesiac ako CSV (kedykoľvek)
app.get('/api/admin/payslips.csv', adminAuth, async(req,res)=>{
  try {
    const month = req.query.month || prevMonthStr();
    const trainers = await q.find(db.users,{$or:[{user_type:'trainer'},{user_type:'manager'}]});
    const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const num=n=>(+n).toFixed(2).replace('.',',');
    const rows=[['Tréner','Mesiac','Hodiny','Účasti','Základ EUR','Bonusy EUR','Affiliate EUR','Zrážky EUR','Spolu EUR'].join(';')];
    let grand=0;
    for(const t of trainers){
      const ps=await trainerMonthPayslip(t, month);
      if(ps.st.sessions===0 && ps.total===0) continue;
      grand+=ps.total;
      rows.push([t.name,month,ps.st.sessions,ps.st.attendances,num(ps.base),num(ps.bonuses),num(ps.affiliate),num(ps.ded),num(ps.total)].map(esc).join(';'));
    }
    rows.push(''); rows.push([esc('SPOLU'),'','','','','','','',esc(num(grand))].join(';'));
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename=vyplatne_pasky_${month}.csv`);
    res.send('﻿'+rows.join('\r\n'));
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Súhrn bodov klientov za obdobie (kto, koľko a za čo) ───────────────────────
async function pointsSummaryData(from, to){
  {
    const fromD=(from||'0000').slice(0,10), toD=(to||'9999').slice(0,10);
    const inRange=d=>{ d=(d||'').slice(0,10); return d>=fromD && d<=toD; };
    const users=(await q.find(db.users,{is_admin:{$ne:true}, is_child:{$ne:true}})).filter(u=>!(u.imported&&!u.claimed)&&!u.anonymous);
    const bookings=await q.find(db.bookings,{});
    const isOnline=b=>/online/i.test(b.class_name||'')||/online/i.test(b.class_location||'')||b.online===true;
    const byUser={};
    for(const b of bookings){ if(b.user_id && ['attended','confirmed'].includes(b.status) && inRange(b.booking_date||b.created_at)) (byUser[b.user_id]=byUser[b.user_id]||[]).push(b); }
    const allU=await q.find(db.users,{});
    const refByUser={};
    for(const u of users){ if(u.sponsor_id && inRange(u.created_at)) refByUser[u.sponsor_id]=(refByUser[u.sponsor_id]||0)+1; }
    // noví platiaci členovia (po líniách) + merch v rozsahu
    const adjacency={}; allU.forEach(u=>{ if(u.sponsor_id) (adjacency[u.sponsor_id]=adjacency[u.sponsor_id]||[]).push(u._id); });
    const buyerSet=new Set();
    (await q.find(db.memberships,{})).forEach(m=>{ const plan=MEMBERSHIP_PLANS[m.plan_id]; if(plan&&plan.type==='bundle') return;
      const d=(m.started_at||m.start_date||m.created_at||'').slice(0,10); if(inRange(d) && (+m.price>0||m.payment_method||m.status)) buyerSet.add(m.user_id); });
    const emailToId={}; allU.forEach(u=>{ if(u.email) emailToId[u.email.toLowerCase()]=u._id; });
    const merchMap={};
    (await q.find(db.orders,{})).filter(o=>o.status==='paid').forEach(o=>{ if(!inRange(o.paid_at||o.created_at)) return;
      const uid=emailToId[(o.client_email||'').toLowerCase()]; if(!uid) return;
      (o.items||[]).forEach(it=>{ if(isMerchItem(it)) merchMap[uid]=(merchMap[uid]||0)+(+it.qty||1); }); });
    const rows=[]; const catTotals={hours:0, online:0, refs:0, membership:0, newmem:0, merch:0, merchline:0};
    for(const u of users){
      const bks=byUser[u._id]||[];
      const online=bks.filter(isOnline).length;
      const hours=bks.length-online;
      const refs=refByUser[u._id]||0;
      const m=await checkMembership(u._id);
      const hasMem=!!m;
      const nm=newMemberPointsFor(u._id, adjacency, buyerSet);
      const md=merchDownlinePointsFor(u._id, adjacency, merchMap);
      const merchCount=merchMap[u._id]||0;
      const pi=buildPointItems({hours, online, refs, hasMem, memName:hasMem?(MEMBERSHIP_PLANS[m.plan_id]?.name||m.plan_name||'Členstvo'):null, newMemberCount:nm.count, newMemberPoints:nm.points, merchCount, merchLineCount:md.count, merchLinePoints:md.points});
      if(pi.total<=0) continue;
      catTotals.hours+=hours*MP_WEIGHTS.hour; catTotals.online+=online*MP_WEIGHTS.hour;
      catTotals.refs+=refs*MP_WEIGHTS.referral; catTotals.membership+=hasMem?MP_WEIGHTS.membership:0;
      catTotals.newmem+=nm.points; catTotals.merch+=merchCount*MP_WEIGHTS.merch; catTotals.merchline+=md.points;
      rows.push({ id:u._id, name:u.name, total:pi.total, hours, online, refs, hasMem,
        items:pi.items.filter(i=>i.points>0).map(i=>({label:i.label, count:i.count, points:i.points})) });
    }
    rows.sort((a,b)=>b.total-a.total);
    return { from:fromD, to:toD, count:rows.length, rows, catTotals,
      grandPoints: rows.reduce((s,r)=>s+r.total,0) };
  }
}
app.get('/api/admin/points-summary', adminAuth, async(req,res)=>{
  try { res.json(await pointsSummaryData(req.query.from, req.query.to)); }
  catch(e){ res.status(500).json({error:e.message}); }
});

// Export bodov klientov za obdobie ako CSV
app.get('/api/admin/points-summary.csv', adminAuth, async(req,res)=>{
  try {
    const from=req.query.from||'', to=req.query.to||'';
    const d=await pointsSummaryData(from, to);
    const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const rows=[['Klient','Hodiny','Online','Odporúčania','Členstvo','Spolu body','Za čo'].join(';')];
    for(const u of (d.rows||[])){
      const za=u.items.map(i=>`${i.label} ${i.points}b`).join(' | ');
      rows.push([u.name,u.hours,u.online,u.refs,u.hasMem?'áno':'nie',u.total,za].map(esc).join(';'));
    }
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename=body_klientov_${from||'vse'}_${to||''}.csv`);
    res.send('﻿'+rows.join('\r\n'));
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Draft payouts for a month = computed stats × rules, merged with any saved payout records
app.get('/api/admin/payouts', adminAuth, async(req,res)=>{
  try {
    const month=req.query.month||today().slice(0,7);
    const stats=await trainerMonthStats(month);
    const rules=Object.fromEntries((await q.find(db.payout_rules,{})).map(r=>[r.trainer,r]));
    const saved=Object.fromEntries((await q.find(db.payouts,{month})).map(p=>[p.trainer,p]));
    const nameToId=Object.fromEntries((await q.find(db.users,{})).map(u=>[u.name,u._id]));
    const rows=await Promise.all(stats.map(async st=>{
      const {base,bonuses}=computePayout(rules[st.instructor],st);
      const sv=saved[st.instructor];
      const deductions=sv?.deductions||0;
      const affiliate = nameToId[st.instructor] ? await affiliateCommissionFor(nameToId[st.instructor], month) : 0;
      const b=sv?sv.base:base, bo=sv?sv.bonuses:bonuses;
      return { trainer:st.instructor, month, ...st, affiliate,
        base:b, bonuses:bo, deductions,
        total:+((b+bo+affiliate-deductions)).toFixed(2),
        status:sv?.status||'draft', saved:!!sv, id:sv?._id||null, note:sv?.note||'', history:sv?.history||[] };
    }));
    res.json({month, rows, rules});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Save/generate a payout record (locks the computed numbers)
app.post('/api/admin/payouts', adminAuth, async(req,res)=>{
  try {
    const {trainer, month}=req.body;
    if(!trainer||!month) return res.status(400).json({error:'Chýba trainer/month'});
    const stats=(await trainerMonthStats(month)).find(s=>s.instructor===trainer)||{sessions:0,attendances:0,revenue:0,newClients:0,fullClasses:0};
    const rule=await q.one(db.payout_rules,{trainer});
    const {base,bonuses}=computePayout(rule,stats);
    const existing=await q.one(db.payouts,{trainer,month});
    const rec={trainer,month,base,bonuses,deductions:existing?.deductions||0,
      total:+(base+bonuses-(existing?.deductions||0)).toFixed(2),
      stats,status:existing?.status||'draft',note:existing?.note||'',updated_at:nowISO()};
    let saved;
    if(existing){ await q.update(db.payouts,{_id:existing._id},{$set:rec}); saved={...existing,...rec}; }
    else { saved=await q.insert(db.payouts,{...rec,history:[],created_at:nowISO()}); }
    await auditLog(req,'payout_generate',`${trainer} ${month}`,existing||null,rec,'');
    res.json({ok:true, id:saved._id});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Update status / deductions / note (append to history + audit)
const PAYOUT_STATUSES=['draft','approved','paid','held','cancelled'];
app.put('/api/admin/payouts/:id', adminAuth, async(req,res)=>{
  try {
    const p=await q.one(db.payouts,{_id:req.params.id});
    if(!p) return res.status(404).json({error:'Výplata nenájdená'});
    const patch={};
    if(req.body.status!==undefined){ if(!PAYOUT_STATUSES.includes(req.body.status)) return res.status(400).json({error:'Neplatný stav'}); patch.status=req.body.status; }
    if(req.body.deductions!==undefined) patch.deductions=+req.body.deductions||0;
    if(req.body.note!==undefined) patch.note=String(req.body.note);
    const deductions=patch.deductions!==undefined?patch.deductions:p.deductions;
    patch.total=+(p.base+p.bonuses-deductions).toFixed(2);
    patch.updated_at=nowISO();
    const histEntry={at:nowISO(), actor:req._auditActor||null, change:{...patch}, reason:req.body.reason||''};
    await q.update(db.payouts,{_id:p._id},{$set:patch, $push:{history:histEntry}});
    await auditLog(req,'payout_update',`${p.trainer} ${p.month}`,{status:p.status,deductions:p.deductions,total:p.total},patch,req.body.reason||'');
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/admin/payouts/export.csv', adminAuth, async(req,res)=>{
  const month=req.query.month||today().slice(0,7);
  const stats=await trainerMonthStats(month);
  const rules=Object.fromEntries((await q.find(db.payout_rules,{})).map(r=>[r.trainer,r]));
  const saved=Object.fromEntries((await q.find(db.payouts,{month})).map(p=>[p.trainer,p]));
  const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`; const num=n=>(+n).toFixed(2).replace('.',',');
  const rows=[['Tréner','Mesiac','Hodiny','Účasti','Tržby','Základ','Bonusy','Zrážky','Spolu','Stav'].join(';')];
  for(const st of stats){
    const {base,bonuses}=computePayout(rules[st.instructor],st); const sv=saved[st.instructor];
    const b=sv?sv.base:base, bo=sv?sv.bonuses:bonuses, ded=sv?.deductions||0;
    rows.push([st.instructor,month,st.sessions,st.attendances,num(st.revenue),num(b),num(bo),num(ded),num(b+bo-ded),sv?.status||'draft'].map(esc).join(';'));
  }
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename=vyplaty_${month}.csv`);
  res.send('﻿'+rows.join('\r\n'));
});

// ─── PHASE K: Refundácie ────────────────────────────────────────────────────────
const REFUND_REASONS={ requested:'Na žiadosť klienta', duplicate:'Duplicitná platba', service_issue:'Problém so službou', cancelled_class:'Zrušená hodina', goodwill:'Ústretovosť', error:'Chyba účtovania', other:'Iné' };
const REFUND_TYPES=['full','partial','storno','credit_note','app_credit','transfer'];

async function ppRefundCapture(captureId, amount){
  const token=await ppGetToken();
  const r=await fetch(`${PAYPAL_BASE}/v2/payments/captures/${captureId}/refund`,{
    method:'POST', headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
    body: JSON.stringify(amount?{amount:{value:(+amount).toFixed(2),currency_code:'EUR'}}:{})
  });
  return { status:r.status, body: await r.json().catch(()=>({})) };
}

app.get('/api/admin/refund-reasons', adminAuth, (req,res)=>res.json({reasons:REFUND_REASONS,types:REFUND_TYPES}));

// ─── PHASE M: Exporty jedným klikom ─────────────────────────────────────────────
function toCsv(header, rows){
  const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const out=[header.join(';')];
  for(const r of rows) out.push(r.map(esc).join(';'));
  return '﻿'+out.join('\r\n');
}
async function exportDataset(name){
  const num=n=>(+n||0).toFixed(2).replace('.',',');
  if(name==='members'){
    const users=(await q.find(db.users,{is_admin:{$ne:true}})).filter(u=>!u.is_child);
    const membs=await q.find(db.memberships,{});
    const active=Object.fromEntries(membs.filter(m=>(m.expires_at||'')>new Date().toISOString()).map(m=>[m.user_id,m]));
    return {file:'clenovia.csv', csv:toCsv(['Meno','Email','Telefon','Rola','Aktivne clenstvo','Expirace','Navstevy','Registracia'],
      users.map(u=>[u.name,u.email,u.phone||'',u.user_type||'client',active[u._id]?.plan_name||'—',(active[u._id]?.expires_at||'').slice(0,10),u.visit_count||0,(u.created_at||'').slice(0,10)]))};
  }
  if(name==='campaigns'){
    const list=await q.find(db.campaigns,{}); const revMap=await campaignRevenueMap();
    return {file:'kampane.csv', csv:toCsv(['Nazov','Platforma','Od','Do','Rozpocet','Naklad','Imprese','Kliky','Registracie','Clenstva','Trzby','ROAS'],
      list.map(c=>{ const rev=revMap[(c.name||'').toLowerCase().trim()]?.revenue||0; return [c.name,c.platform,c.date_from||'',c.date_to||'',num(c.budget),num(c.spend),c.impressions||0,c.clicks||0,c.registrations||0,c.memberships||0,num(rev),(rev/Math.max(+c.spend||1,1)).toFixed(2)];}))};
  }
  if(name==='payments'){
    const users=Object.fromEntries((await q.find(db.users,{})).map(u=>[u._id,u.name]));
    const list=(await q.find(db.payments,{})).filter(p=>['completed','active'].includes(p.status));
    return {file:'platby.csv', csv:toCsv(['Datum','Klient','Popis','Suma','Brana','Stav'],
      list.map(p=>[(p.captured_at||p.created_at||'').slice(0,10),users[p.user_id]||'—',p.description||'',num(p.amount),p.provider||p.payment_method||'—',p.status]))};
  }
  if(name==='refunds'){
    const list=await q.find(db.refunds,{});
    return {file:'refundacie.csv', csv:toCsv(['Datum','Klient','Typ','Suma','Dovod','Brana','Dobropis'],
      list.map(r=>[(r.created_at||'').slice(0,10),r.client_name||'—',r.type,num(r.amount),REFUND_REASONS[r.reason]||r.reason,r.gateway||'—',r.credit_note||'']))};
  }
  if(name==='crm'){
    const users=(await q.find(db.users,{is_admin:{$ne:true}})).filter(u=>!u.is_child);
    const payments=(await q.find(db.payments,{})).filter(p=>['completed','active'].includes(p.status));
    const membs=(await q.find(db.memberships,{})).filter(m=>m.payment_method);
    const paid={}; payments.forEach(p=>paid[p.user_id]=(paid[p.user_id]||0)+(+p.amount||0)); membs.forEach(m=>paid[m.user_id]=(paid[m.user_id]||0)+(+m.price||0));
    return {file:'crm.csv', csv:toCsv(['Meno','Email','Telefon','LTV','Navstevy','Zdroj','Kampan','Registracia'],
      users.map(u=>[u.name,u.email,u.phone||'',num(paid[u._id]||0),u.visit_count||0,u.utm_source||u.lead_source||'',u.utm_campaign||'',(u.created_at||'').slice(0,10)]))};
  }
  return null;
}
app.get('/api/admin/export/:dataset.csv', adminAuth, async(req,res)=>{
  try {
    const d=await exportDataset(req.params.dataset);
    if(!d) return res.status(404).send('Neznámy export');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename=${d.file}`);
    res.send(d.csv);
  } catch(e){ res.status(500).send(e.message); }
});

// ─── PHASE L: Admin alerty ──────────────────────────────────────────────────────
app.get('/api/admin/alerts', adminAuth, async(req,res)=>{
  const list=(await q.find(db.notifications,{type:'admin_alert',user_id:req.session.uid}))
    .sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')).slice(0,100);
  const unread=list.filter(a=>!a.read).length;
  res.json({alerts:list, unread});
});
app.post('/api/admin/alerts/run', adminAuth, async(req,res)=>{
  try { const raised=await runAdminAlerts(); res.json({ok:true, raised:raised.length}); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/admin/alerts/read', adminAuth, async(req,res)=>{
  await q.update(db.notifications,{type:'admin_alert',user_id:req.session.uid,read:{$ne:true}},{$set:{read:true}},{multi:true});
  res.json({ok:true});
});

// ─── DATA RESET (clean slate for testing / before go-live) ──────────────────────
// Wipes ALL transactional + client data. PRESERVES: admin & trainer accounts,
// the class schedule, email sequences and payout rules (configuration).
const RESET_CONFIRM_PHRASE = 'VYMAZAT VSETKO';
// Preview counts of what a reset would delete (no changes made)
app.get('/api/admin/reset-data/preview', adminAuth, async(req,res)=>{
  try {
    const users=await q.find(db.users,{});
    const clientUsers=users.filter(u=>!u.is_admin && u.user_type!=='trainer');
    res.json({
      willDelete:{
        klienti_a_clenovia: clientUsers.length,
        rezervacie: await q.count(db.bookings,{}),
        clenstva: await q.count(db.memberships,{}),
        platby: await q.count(db.payments,{}),
        objednavky: await q.count(db.orders,{}),
        faktury: await q.count(db.invoices,{}),
        predaje_transakcie: await q.count(db.transactions,{}),
        provizie: await q.count(db.commissions,{}),
        refundacie: await q.count(db.refunds,{}),
        vyplaty: await q.count(db.payouts,{}),
        kampane: await q.count(db.campaigns,{}),
        notifikacie: await q.count(db.notifications,{}),
        audit_zaznamy: await q.count(db.audit,{}),
        spravy_chat: await q.count(db.messages,{}),
        prenajmy: await q.count(db.rentals,{})
      },
      willKeep:{
        admin_ucty: users.filter(u=>u.is_admin).length,
        trener_ucty: users.filter(u=>u.user_type==='trainer').length,
        rozvrh_hodin: await q.count(db.classes,{}),
        email_sekvencie: await q.count(db.email_steps,{}),
        pravidla_odmien: await q.count(db.payout_rules,{})
      },
      confirmPhrase: RESET_CONFIRM_PHRASE
    });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/admin/reset-data', adminAuth, async(req,res)=>{
  try {
    if(req.body.confirm !== RESET_CONFIRM_PHRASE)
      return res.status(400).json({error:`Na potvrdenie zadaj presne: ${RESET_CONFIRM_PHRASE}`});

    const me = await q.one(db.users,{_id:req.session.uid});
    // Delete client/member accounts (keep admins + trainers)
    const delUsers = await q.remove(db.users,{ is_admin:{$ne:true}, user_type:{$ne:'trainer'} }, {multi:true});
    // Wipe all transactional stores
    const wipe = async d => q.remove(d,{},{multi:true});
    const [bk,mb,pm,or,iv,tx,cm,rf,po,cp,nt,au,ms,rn,eq,ad] = await Promise.all([
      wipe(db.bookings), wipe(db.memberships), wipe(db.payments), wipe(db.orders),
      wipe(db.invoices), wipe(db.transactions), wipe(db.commissions), wipe(db.refunds),
      wipe(db.payouts), wipe(db.campaigns), wipe(db.notifications), wipe(db.audit),
      wipe(db.messages), wipe(db.rentals), wipe(db.email_queue), wipe(db.adspend)
    ]);
    // Reset per-user counters on the kept staff accounts (fresh test stats)
    await q.update(db.users,{},{$set:{visit_count:0, no_show_count:0, referral_credit:0,
      first_class_email_sent:false, winback_sent:false, review_asked:false, free_credits:0,
      single_entries:0, stripe_subscription_id:null, paypal_subscription_id:null,
      membership_plan:null, membership_expires:null}},{multi:true});

    // Fresh audit entry documenting the reset (audit was just wiped)
    await auditLog(req,'data_reset','ALL', null,
      {deleted_users:delUsers, bookings:bk, memberships:mb, payments:pm, orders:or, invoices:iv,
       transactions:tx, commissions:cm, refunds:rf, payouts:po, campaigns:cp, notifications:nt,
       messages:ms, rentals:rn}, req.body.reason||'Clean slate reset');

    console.log(`🧹 DATA RESET by ${me?.email}: deleted ${delUsers} users + all transactional data`);
    res.json({ ok:true, deleted:{ users:delUsers, bookings:bk, memberships:mb, payments:pm, orders:or,
      invoices:iv, transactions:tx, commissions:cm, refunds:rf, payouts:po, campaigns:cp,
      notifications:nt, messages:ms, rentals:rn } });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/admin/refunds', adminAuth, async(req,res)=>{
  try {
    const {payment_id, type, amount, reason, note}=req.body;
    if(!REFUND_TYPES.includes(type)) return res.status(400).json({error:'Neplatný typ refundu'});
    const pay = payment_id ? await q.one(db.payments,{_id:payment_id}) : null;
    const user = pay?.user_id ? await q.one(db.users,{_id:pay.user_id}) : null;
    const amt = +amount || (pay? +pay.amount : 0);
    if(!(amt>0)) return res.status(400).json({error:'Neplatná suma'});
    if(pay && amt> (+pay.amount||0)+0.001) return res.status(400).json({error:'Suma prevyšuje platbu'});

    let gateway={method:'manual', ref:null, ok:true};
    // Actual gateway refund (skip for app_credit / manual transfer)
    if(type!=='app_credit' && type!=='transfer' && pay){
      if(pay.stripe_payment_intent && STRIPE_SECRET){
        const r=await stripeApi('refunds',{payment_intent:pay.stripe_payment_intent, amount:Math.round(amt*100)});
        gateway={method:'stripe', ref:r.body?.id||null, ok:r.status<300};
        if(!gateway.ok) return res.status(400).json({error:'Stripe refund zlyhal: '+(r.body?.error?.message||r.status)});
      } else if(pay.paypal_capture_id && PAYPAL_CLIENT_ID){
        const r=await ppRefundCapture(pay.paypal_capture_id, type==='partial'?amt:null);
        gateway={method:'paypal', ref:r.body?.id||null, ok:r.status<300};
        if(!gateway.ok) return res.status(400).json({error:'PayPal refund zlyhal: '+(r.body?.message||r.status)});
      }
    }
    // App credit → bump referral_credit
    if(type==='app_credit' && user){
      await q.update(db.users,{_id:user._id},{$set:{referral_credit:+((+user.referral_credit||0)+amt).toFixed(2)}});
    }
    // Credit note for the original invoice, if we can find it
    let creditNote=null;
    if(pay && user){
      const inv=(await q.find(db.invoices,{user_id:user._id})).filter(i=>i.type!=='credit_note' && i.status==='paid')
        .sort((a,b)=>(b.issued_at||'').localeCompare(a.issued_at||''))[0];
      if(inv){
        const cn=await createInvoice({user_id:user._id, client_name:inv.client_name, client_email:inv.client_email,
          items:[{desc:`Refundácia k faktúre ${inv.number}${reason?` — ${REFUND_REASONS[reason]||reason}`:''}`, qty:1, total:-amt}],
          total:-amt, method:inv.payment_method, type:'credit_note', related_invoice:inv.number});
        if(cn){ creditNote=cn.number; await q.update(db.invoices,{_id:inv._id},{$set:{status:'credited',credit_note:cn.number}}); }
      }
    }
    const refund=await q.insert(db.refunds,{
      payment_id:payment_id||null, user_id:user?._id||null, client_name:user?.name||pay?.description||'—',
      type, amount:amt, reason:reason||'other', note:note||'',
      gateway:gateway.method, gateway_ref:gateway.ref, credit_note:creditNote,
      created_by:req.session?.uid||null, created_at:nowISO(), month:today().slice(0,7)
    });
    await auditLog(req,'refund_create',payment_id||'—',{amount:pay?.amount},{type,amount:amt,gateway:gateway.method,credit_note:creditNote},reason||'');
    if(user?.email){
      await sendMail(user.email,`Refundácia ${amt.toFixed(2)} € — Fusion Academy`,
        emailTemplate('Spracovali sme refundáciu',
          `<p>Ahoj <b>${user.name}</b>,</p><p>Vrátili sme ti <b>${amt.toFixed(2)} €</b>${reason?` (${REFUND_REASONS[reason]||reason})`:''}${type==='app_credit'?' vo forme kreditu do aplikácie':''}.</p>${gateway.method!=='manual'?`<p>Suma sa zvyčajne pripíše do 5–10 dní podľa banky.</p>`:''}<p>Ak máš otázky, stačí odpovedať na tento email.</p>`,
          creditNote?'🧾 Zobraziť dobropis':null, creditNote?`${APP_URL}/invoice/${creditNote}`:null)).catch(()=>{});
      await q.insert(db.notifications,{user_id:user._id,type:'refund',title:`Refundácia ${amt.toFixed(2)} €`,body:REFUND_REASONS[reason]||'Refundácia spracovaná',read:false,created_at:nowISO()});
    }
    res.json({ok:true, id:refund._id, credit_note:creditNote, gateway:gateway.method});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/admin/refundable-payments', adminAuth, async(req,res)=>{
  const term=(req.query.q||'').toLowerCase();
  const users=Object.fromEntries((await q.find(db.users,{})).map(u=>[u._id,u]));
  const refunded=new Set((await q.find(db.refunds,{})).map(r=>r.payment_id).filter(Boolean));
  let list=(await q.find(db.payments,{})).filter(p=>['completed','active'].includes(p.status) && !refunded.has(p._id) && (+p.amount||0)>0);
  list=list.map(p=>({ id:p._id, amount:+p.amount||0, description:p.description||p.ref_type||'Platba',
    client:users[p.user_id]?.name||'—', email:users[p.user_id]?.email||'',
    date:(p.captured_at||p.activated_at||p.created_at||'').slice(0,10),
    gateway: p.stripe_payment_intent?'stripe': p.paypal_capture_id?'paypal':(p.provider||p.payment_method||'manual') }));
  if(term) list=list.filter(p=>p.client.toLowerCase().includes(term)||p.email.toLowerCase().includes(term)||p.description.toLowerCase().includes(term));
  res.json(list.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,100));
});

app.get('/api/admin/refunds', adminAuth, async(req,res)=>{
  try {
    const {from,to}=req.query;
    let list=await q.find(db.refunds,{});
    if(from) list=list.filter(r=>(r.created_at||'')>=from);
    if(to) list=list.filter(r=>(r.created_at||'')<=to+'T23:59:59');
    list.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    const total=+list.reduce((s,r)=>s+(+r.amount||0),0).toFixed(2);
    const payments=(await q.find(db.payments,{})).filter(p=>['completed','active'].includes(p.status));
    const revenue=payments.reduce((s,p)=>s+(+p.amount||0),0);
    const byReason={}, byType={};
    for(const r of list){ byReason[r.reason]=(byReason[r.reason]||0)+(+r.amount||0); byType[r.type]=(byType[r.type]||0)+1; }
    res.json({ refunds:list.slice(0,300), total, count:list.length,
      refundRate: revenue>0? +(total/revenue*100).toFixed(1):0,
      byReason:Object.entries(byReason).map(([k,v])=>({reason:REFUND_REASONS[k]||k,amount:+v.toFixed(2)})).sort((a,b)=>b.amount-a.amount),
      byType, reasons:REFUND_REASONS });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STRIPE — Apple Pay / Google Pay / card via Stripe Checkout (no card data on our server)
// ═══════════════════════════════════════════════════════════════════════════════
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
async function stripeApi(path, params, method='POST'){
  const opts = { method, headers:{ 'Authorization':`Bearer ${STRIPE_SECRET}` } };
  if(method==='POST'){
    const body = new URLSearchParams();
    Object.entries(params||{}).forEach(([k,v])=>{ if(v!==undefined && v!==null) body.append(k, String(v)); });
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = body;
  }
  const r = await fetch('https://api.stripe.com/v1/'+path, opts);
  return { status:r.status, body: await r.json().catch(()=>({})) };
}

// Create a Checkout Session (one-time membership) → returns hosted URL with Apple/Google Pay + card
app.post('/api/stripe/checkout', auth, async(req,res)=>{
  try {
    if(!STRIPE_SECRET) return res.status(400).json({error:'Stripe nie je nakonfigurovaný'});
    const { plan_id, for_child_id, promo_code } = req.body;
    const plan = MEMBERSHIP_PLANS[plan_id];
    if(!plan) return res.status(400).json({error:'Neplatný plán'});
    const u = await q.one(db.users,{_id:req.session.uid});
    let memberId = req.session.uid, childName = null;
    if(for_child_id){
      const child = await q.one(db.users,{_id:for_child_id});
      if(!child || child.parent_id !== req.session.uid || child.active===false) return res.status(403).json({error:'Neplatný detský profil'});
      memberId = child._id; childName = child.name;
    }
    // Promo kód → zľava z ceny plánu
    let price = plan.price, promoCode = null, promoDiscount = 0;
    if(promo_code){
      const v = await validatePromo(promo_code, plan.price, req.session.uid);
      if(!v.ok) return res.status(400).json({error:'Promo kód: '+v.reason});
      price = v.final; promoCode = v.promo.code; promoDiscount = v.discount;
    }
    if(price <= 0) return res.status(400).json({error:'Cena po zľave je 0 € — použi tlačidlo „Aktivovať zľavou" bez karty'});
    const base = APP_URL;
    const params = {
      'mode':'payment',
      'line_items[0][quantity]':1,
      'line_items[0][price_data][currency]':'eur',
      'line_items[0][price_data][unit_amount]':Math.round(price*100),
      'line_items[0][price_data][product_data][name]':`Členstvo ${plan.name}${childName?' – '+childName:''}${promoCode?` (promo ${promoCode})`:''}`,
      'success_url':`${base}/client-dashboard?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url':`${base}/pricing?stripe=cancel`,
      'customer_email':u.email,
      'metadata[user_id]':req.session.uid,
      'metadata[member_id]':memberId,
      'metadata[plan_id]':plan_id,
      'metadata[type]':'membership'
    };
    if(promoCode){ params['metadata[promo_code]']=promoCode; params['metadata[promo_discount]']=promoDiscount; }
    const r = await stripeApi('checkout/sessions', params, 'POST');
    if(r.status>=400 || !r.body?.url) return res.status(400).json({error:r.body?.error?.message||'Stripe chyba pri vytváraní platby'});
    await q.insert(db.payments,{stripe_session_id:r.body.id, user_id:req.session.uid, member_id:memberId, amount:price, currency:'EUR', description:`Členstvo ${plan.name}${childName?' – '+childName:''}${promoCode?` [promo ${promoCode} -${promoDiscount.toFixed(2)}€]`:''}`, ref_id:plan_id, ref_type:'membership', provider:'stripe', status:'pending', promo_code:promoCode, created_at:nowISO()});
    res.json({ok:true, url:r.body.url});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Verify a returned Checkout Session and activate membership (idempotent)
// Fulfill a paid Stripe Checkout session (membership/subscription): activate membership,
// link subscription, invoice, commission. Idempotent + atomic via the payment record lock,
// so it's safe to call from BOTH /verify (browser redirect) and the webhook (reliable).
async function fulfillStripeCheckout(s){
  if(!s || s.payment_status!=='paid') return {ok:false, error:'Platba nebola dokončená'};
  const meta = s.metadata || {};
  if(meta.type==='order') return {ok:false, skip:true}; // e-shop handled separately
  if(meta.type==='gift_credit') return await fulfillGiftCredit(s);
  const plan = MEMBERSHIP_PLANS[meta.plan_id];
  if(!plan) return {ok:false, error:'Neznámy plán'};
  // Atomic claim: only the first caller flips pending→completed and proceeds
  const claimed = await q.update(db.payments,
    {stripe_session_id:s.id, status:{$ne:'completed'}},
    {$set:{status:'completed', captured_at:nowISO(), stripe_payment_intent:s.payment_intent||'', stripe_subscription_id:s.subscription||null}});
  if(!claimed) return {ok:true, already:true, plan_name:plan.name}; // someone already fulfilled it
  const memberId = meta.member_id || meta.user_id;
  await activateMembership(memberId, meta.plan_id, plan.duration_days||30);
  if(meta.type==='subscription' && s.subscription){
    await q.update(db.users,{_id:meta.user_id},{$set:{stripe_subscription_id:s.subscription, stripe_sub_plan:meta.plan_id, stripe_sub_member:memberId}});
  }
  const buyer = await q.one(db.users,{_id:meta.user_id});
  const via = meta.type==='subscription' ? 'Stripe mesačný odber' : 'Stripe · karta/Apple/Google Pay';
  await q.insert(db.transactions,{type:meta.type==='subscription'?'subscription':'membership',user_id:memberId,user_name:buyer?.name||'—',amount:plan.price,payment_method:'stripe',note:`${plan.name} (${via})`,plan_id:meta.plan_id,created_at:nowISO(),month:today().slice(0,7)});
  trackPurchase(meta.user_id, plan.price);
  createInvoice({user_id:meta.user_id, client_name:buyer?.name, client_email:buyer?.email,
    items:[{desc:`Členstvo ${plan.name}${meta.type==='subscription'?' (mesačný odber)':''}`, qty:1, total:plan.price}],
    total:plan.price, method:'Stripe (karta / Apple Pay / Google Pay)'});
  awardPurchaseCommission({buyer_id:meta.user_id, amount:plan.price, product_name:`Členstvo ${plan.name}`});
  if(meta.promo_code){ const pr=await q.one(db.promo_codes,{code:(meta.promo_code||'').toUpperCase()}); if(pr) await recordPromoRedemption(pr, meta.user_id, +meta.promo_discount||0); }
  return {ok:true, plan_name:plan.name, subscription:meta.type==='subscription'};
}

// ── Darček kreditu: klient kúpi kredit inému klientovi ────────────────────────
async function creditRecipient(recipientId, amount, gifterName){
  const rcpt = await q.one(db.users,{_id:recipientId});
  if(!rcpt) return false;
  const amt=(+amount).toFixed(2);
  const newBal = +((rcpt.referral_credit||0) + (+amount||0)).toFixed(2);
  await q.update(db.users,{_id:recipientId},{$set:{referral_credit:newBal}});
  // Notifikácia príjemcovi (in-app)
  await q.insert(db.notifications,{user_id:recipientId,type:'credit',title:`🎁 Dostal/a si darček – ${amt} € kredit`,
    body:`${gifterName||'Niekto'} ti kúpil ${amt} € kredit do appky. Nový zostatok: ${newBal.toFixed(2)} €. Použi ho na hodiny alebo členstvo! 💃`,read:false,created_at:nowISO()}).catch(()=>{});
  // E-mail príjemcovi
  if(rcpt.email) sendMail(rcpt.email, `🎁 Dostal/a si darček – ${amt} € kredit`,
    emailTemplate('Máš darček! 🎁',
      `<p>Ahoj <b>${rcpt.name}</b>,</p><p><b>${gifterName||'Niekto'}</b> ti kúpil/a <b>${amt} € kredit</b> do Fusion Academy! 💛</p><p>Tvoj nový zostatok je <b>${newBal.toFixed(2)} €</b>. Použi ho na hodiny alebo členstvo — stačí pri kúpe zaškrtnúť „Referral kredit".</p>`,
      '📱 Použiť kredit', `${APP_URL}/pricing`)).catch(()=>{});
  return true;
}
// Notifikácia + e-mail darcovi (že darček prebehol)
async function notifyGifter(gifter, recipientName, amount){
  if(!gifter) return;
  const amt=(+amount).toFixed(2);
  await q.insert(db.notifications,{user_id:gifter._id,type:'credit',title:`🎁 Darček odoslaný – ${amt} €`,
    body:`Kúpil/a si ${amt} € kredit pre ${recipientName||'klienta'}. Ďakujeme, že šíriš dobrú náladu! 💛`,read:false,created_at:nowISO()}).catch(()=>{});
  if(gifter.email) sendMail(gifter.email, `🎁 Darček kreditu odoslaný – ${amt} €`,
    emailTemplate('Darček odoslaný 🎁',
      `<p>Ahoj <b>${gifter.name}</b>,</p><p>Tvoj darček <b>${amt} € kredit</b> pre <b>${recipientName||'klienta'}</b> bol úspešne pripísaný. Ďakujeme! 💛</p>`,
      '📱 Môj profil', `${APP_URL}/client-dashboard`)).catch(()=>{});
}
async function fulfillGiftCredit(s){
  const meta = s.metadata || {};
  const claimed = await q.update(db.payments,{stripe_session_id:s.id, status:{$ne:'completed'}},{$set:{status:'completed', captured_at:nowISO(), stripe_payment_intent:s.payment_intent||''}});
  if(!claimed) return {ok:true, already:true};
  const amount = +meta.amount||0;
  const gifter = await q.one(db.users,{_id:meta.gifter_id});
  await creditRecipient(meta.recipient_id, amount, gifter?.name);
  const rcpt = await q.one(db.users,{_id:meta.recipient_id});
  await q.insert(db.transactions,{type:'gift_credit',user_id:meta.gifter_id,user_name:gifter?.name||'—',amount,payment_method:'stripe',note:`Darček kreditu pre ${rcpt?.name||'klienta'}`,created_at:nowISO(),month:today().slice(0,7)});
  createInvoice({user_id:meta.gifter_id, client_name:gifter?.name, client_email:gifter?.email,
    items:[{desc:`Darčekový kredit pre ${rcpt?.name||'klienta'}`, qty:1, total:amount}], total:amount, method:'Stripe (karta / Apple Pay / Google Pay)'});
  await notifyGifter(gifter, rcpt?.name, amount);
  return {ok:true, gift:true, amount};
}
// Klient iniciuje darček kreditu (Stripe / demo)
app.post('/api/gift-credit/checkout', auth, async(req,res)=>{
  try {
    const recipient_id = String(req.body.recipient_id||'');
    const amount = Math.round((+req.body.amount||0)*100)/100;
    if(amount < 5 || amount > 500) return res.status(400).json({error:'Suma musí byť 5–500 €'});
    const rcpt = await q.one(db.users,{_id:recipient_id});
    if(!rcpt || rcpt.active===false) return res.status(404).json({error:'Príjemca nenájdený'});
    if(recipient_id===req.session.uid) return res.status(400).json({error:'Kredit si nemôžeš darovať sám sebe 🙂'});
    const gifter = await q.one(db.users,{_id:req.session.uid});
    // Demo (bez Stripe): pripíš hneď – nech sa dá otestovať
    if(!STRIPE_SECRET){
      await creditRecipient(recipient_id, amount, gifter?.name);
      await notifyGifter(gifter, rcpt.name, amount);
      await q.insert(db.transactions,{type:'gift_credit',user_id:req.session.uid,user_name:gifter?.name||'—',amount,payment_method:'demo',note:`Darček kreditu pre ${rcpt.name}`,created_at:nowISO(),month:today().slice(0,7)});
      return res.json({ok:true, demo:true, message:`(Demo) Darček ${amount.toFixed(2)} € kredit pre ${rcpt.name} pripísaný.`});
    }
    const base = APP_URL;
    const params = {
      'mode':'payment',
      'line_items[0][quantity]':1,
      'line_items[0][price_data][currency]':'eur',
      'line_items[0][price_data][unit_amount]':Math.round(amount*100),
      'line_items[0][price_data][product_data][name]':`Darčekový kredit pre ${rcpt.name} (${amount.toFixed(2)} €)`,
      'success_url':`${base}/client-dashboard?gift=success`,
      'cancel_url':`${base}/u/${recipient_id}?gift=cancel`,
      'customer_email':gifter?.email,
      'metadata[type]':'gift_credit',
      'metadata[gifter_id]':req.session.uid,
      'metadata[recipient_id]':recipient_id,
      'metadata[amount]':amount
    };
    const r = await stripeApi('checkout/sessions', params, 'POST');
    if(r.status>=400 || !r.body?.url) return res.status(400).json({error:r.body?.error?.message||'Stripe chyba'});
    await q.insert(db.payments,{stripe_session_id:r.body.id, user_id:req.session.uid, amount, currency:'EUR', plan_name:'Darčekový kredit', description:`Darčekový kredit pre ${rcpt.name}`, ref_type:'gift_credit', gift_recipient:recipient_id, provider:'stripe', method:'card', status:'pending', created_at:nowISO()});
    res.json({ok:true, url:r.body.url});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/stripe/verify', auth, async(req,res)=>{
  try {
    if(!STRIPE_SECRET) return res.status(400).json({error:'Stripe nie je nakonfigurovaný'});
    const { session_id } = req.body;
    if(!session_id) return res.status(400).json({error:'Chýba session_id'});
    const r = await stripeApi('checkout/sessions/'+encodeURIComponent(session_id), null, 'GET');
    const out = await fulfillStripeCheckout(r.body);
    if(!out.ok) return res.status(400).json({error:out.error||'Platbu sa nepodarilo overiť'});
    res.json(out);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Create a recurring monthly subscription Checkout Session (Apple/Google Pay/card)
app.post('/api/stripe/subscribe', auth, async(req,res)=>{
  try {
    if(!STRIPE_SECRET) return res.status(400).json({error:'Stripe nie je nakonfigurovaný'});
    const { plan_id, for_child_id } = req.body;
    const plan = MEMBERSHIP_PLANS[plan_id];
    if(!plan) return res.status(400).json({error:'Neplatný plán'});
    if(plan.type==='bundle') return res.status(400).json({error:'Permanentku nemožno kúpiť ako odber'});
    const u = await q.one(db.users,{_id:req.session.uid});
    let memberId = req.session.uid, childName = null;
    if(for_child_id){
      const child = await q.one(db.users,{_id:for_child_id});
      if(!child || child.parent_id !== req.session.uid || child.active===false) return res.status(403).json({error:'Neplatný detský profil'});
      memberId = child._id; childName = child.name;
    }
    const base = APP_URL;
    const params = {
      'mode':'subscription',
      'line_items[0][quantity]':1,
      'line_items[0][price_data][currency]':'eur',
      'line_items[0][price_data][unit_amount]':Math.round(plan.price*100),
      'line_items[0][price_data][recurring][interval]':'month',
      'line_items[0][price_data][product_data][name]':`Členstvo ${plan.name}${childName?' – '+childName:''} (mesačne)`,
      'success_url':`${base}/client-dashboard?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url':`${base}/pricing?stripe=cancel`,
      'customer_email':u.email,
      'metadata[user_id]':req.session.uid,
      'metadata[member_id]':memberId,
      'metadata[plan_id]':plan_id,
      'metadata[type]':'subscription',
      'subscription_data[metadata][user_id]':req.session.uid,
      'subscription_data[metadata][member_id]':memberId,
      'subscription_data[metadata][plan_id]':plan_id
    };
    const r = await stripeApi('checkout/sessions', params, 'POST');
    if(r.status>=400 || !r.body?.url) return res.status(400).json({error:r.body?.error?.message||'Stripe chyba pri vytváraní odberu'});
    await q.insert(db.payments,{stripe_session_id:r.body.id, user_id:req.session.uid, member_id:memberId, amount:plan.price, currency:'EUR', description:`Odber ${plan.name}`, ref_id:plan_id, ref_type:'subscription', provider:'stripe', status:'pending', created_at:nowISO()});
    res.json({ok:true, url:r.body.url});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Cancel the client's active Stripe subscription (membership stays until period end)
app.post('/api/stripe/subscribe/cancel', auth, async(req,res)=>{
  try {
    if(!STRIPE_SECRET) return res.status(400).json({error:'Stripe nie je nakonfigurovaný'});
    const u = await q.one(db.users,{_id:req.session.uid});
    if(!u.stripe_subscription_id) return res.status(400).json({error:'Nemáš aktívny mesačný odber'});
    await stripeApi('subscriptions/'+encodeURIComponent(u.stripe_subscription_id), null, 'DELETE');
    await q.update(db.users,{_id:u._id},{$set:{stripe_subscription_id:null}});
    await q.insert(db.notifications,{user_id:u._id,type:'membership',title:'Odber zrušený',body:'Automatické obnovenie bolo zrušené. Členstvo platí do konca obdobia.',read:false,created_at:nowISO()});
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Stripe webhook — subscription renewals + cancellations (raw body for signature verify)
app.post('/api/stripe/webhook', async(req,res)=>{
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if(secret){
      const crypto = require('crypto');
      const sig = req.headers['stripe-signature']||'';
      const parts = Object.fromEntries(sig.split(',').map(p=>p.split('=')));
      const raw = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
      if(!parts.v1 || expected !== parts.v1){ console.error('Stripe webhook: bad signature'); return res.status(400).send('bad signature'); }
    }
    const event = req.body;
    if(event.type==='invoice.paid'){
      const inv = event.data.object;
      // Only extend on real renewals; first payment is handled by /verify
      if(inv.billing_reason==='subscription_cycle' && inv.subscription){
        const u = await q.one(db.users,{stripe_subscription_id:inv.subscription});
        if(u){
          const planId = u.stripe_sub_plan; const plan = MEMBERSHIP_PLANS[planId];
          if(plan){
            await activateMembership(u.stripe_sub_member||u._id, planId, plan.duration_days||30);
            await q.insert(db.transactions,{type:'subscription_renewal',user_id:u.stripe_sub_member||u._id,user_name:u.name,amount:plan.price,payment_method:'stripe',note:`Auto-obnova ${plan.name} (Stripe)`,plan_id:planId,created_at:nowISO(),month:today().slice(0,7)});
            createInvoice({user_id:u._id, client_name:u.name, client_email:u.email,
              items:[{desc:`Členstvo ${plan.name} — mesačná obnova`, qty:1, total:plan.price}],
              total:plan.price, method:'Stripe (automatický odber)'});
            awardPurchaseCommission({buyer_id:u._id, amount:plan.price, product_name:`Členstvo ${plan.name} (obnova)`});
          }
        }
      }
    } else if(event.type==='invoice.payment_failed'){
      const inv = event.data.object;
      if(inv.subscription){
        const u = await q.one(db.users,{stripe_subscription_id:inv.subscription});
        if(u){
          const amt = (inv.amount_due||inv.total||0)/100;
          await recordFailedPayment({ user_id:u._id, amount:amt, description:'Členstvo (automatická obnova)',
            plan_name:'Členstvo', provider:'stripe', invoice_id:inv.id });
        }
      }
    } else if(event.type==='invoice.payment_succeeded'){
      const inv = event.data.object;
      if(inv.subscription){ const u = await q.one(db.users,{stripe_subscription_id:inv.subscription}); if(u) await resolveFailedPayments(u._id); }
    } else if(event.type==='customer.subscription.deleted'){
      const sub = event.data.object;
      const u = await q.one(db.users,{stripe_subscription_id:sub.id});
      if(u) await q.update(db.users,{_id:u._id},{$set:{stripe_subscription_id:null}});
    } else if(event.type==='checkout.session.completed'){
      const s = event.data.object;
      if(s.metadata?.type==='order' && s.metadata.order_number && s.payment_status==='paid'){
        await q.update(db.orders,{order_number:s.metadata.order_number,status:{$ne:'paid'}},{$set:{status:'paid',paid_at:nowISO(),payment_method:'stripe'}});
        const ord=await q.one(db.orders,{order_number:s.metadata.order_number}); if(ord) grantMerchFromOrder(ord);
      } else {
        // Membership / subscription first payment — reliable fulfilment via webhook
        // (idempotent with the browser /verify path)
        await fulfillStripeCheckout(s).catch(e=>console.error('Fulfil error:',e.message));
      }
    }
    res.json({received:true});
  } catch(e){ console.error('Stripe webhook error:', e.message); res.status(200).json({received:true}); }
});

// ── Stripe for shop orders (public: shop checkout has no login) ──────────────────
app.post('/api/stripe/checkout-order', async(req,res)=>{
  try {
    if(!STRIPE_SECRET) return res.status(400).json({error:'Stripe nie je nakonfigurovaný'});
    const { order_number } = req.body;
    const order = await q.one(db.orders,{order_number});
    if(!order) return res.status(404).json({error:'Objednávka nenájdená'});
    if(order.status==='paid') return res.json({ok:true, already:true});
    if(!(order.total>0)) return res.status(400).json({error:'Nulová suma'});
    const base = APP_URL;
    const params = {
      'mode':'payment',
      'line_items[0][quantity]':1,
      'line_items[0][price_data][currency]':'eur',
      'line_items[0][price_data][unit_amount]':Math.round(order.total*100),
      'line_items[0][price_data][product_data][name]':`Objednávka ${order.order_number} · Fusion Academy`,
      'success_url':`${base}/shop?stripe=order_success&session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url':`${base}/shop?stripe=cancel`,
      'customer_email':order.client_email||'',
      'metadata[type]':'order',
      'metadata[order_number]':order.order_number
    };
    const r = await stripeApi('checkout/sessions', params, 'POST');
    if(r.status>=400 || !r.body?.url) return res.status(400).json({error:r.body?.error?.message||'Stripe chyba'});
    await q.update(db.orders,{_id:order._id},{$set:{stripe_session_id:r.body.id}});
    res.json({ok:true, url:r.body.url});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Verify a shop order payment on return (retrieves from Stripe → cannot be faked)
app.post('/api/stripe/verify-order', async(req,res)=>{
  try {
    if(!STRIPE_SECRET) return res.status(400).json({error:'Stripe nie je nakonfigurovaný'});
    const { session_id } = req.body;
    if(!session_id) return res.status(400).json({error:'Chýba session_id'});
    const r = await stripeApi('checkout/sessions/'+encodeURIComponent(session_id), null, 'GET');
    const s = r.body;
    if(s?.payment_status !== 'paid' || s?.metadata?.type!=='order') return res.status(400).json({error:'Platba nebola dokončená'});
    const order = await q.one(db.orders,{order_number:s.metadata.order_number});
    if(order && order.status!=='paid'){
      await q.update(db.orders,{_id:order._id},{$set:{status:'paid',paid_at:nowISO(),payment_method:'stripe'}});
      grantMerchFromOrder(order);
      createInvoice({user_id:null, client_name:order.client_name, client_email:order.client_email,
        items:(order.items||[]).map(it=>({desc:`${it.name||it.product_name||'Položka'} ×${it.qty||1}`, qty:it.qty||1, total:+((it.price||0)*(it.qty||1)).toFixed(2)})),
        total:order.total, method:'Stripe (karta / Apple Pay / Google Pay)'});
    }
    res.json({ok:true, order_number:s.metadata.order_number});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/admin/membership/activate', adminAuth, async(req,res)=>{
  try {
    const {user_id, plan_id, duration_days} = req.body;
    if(!user_id||!plan_id) return res.status(400).json({error:'Chýba user_id alebo plan_id'});
    await activateMembership(user_id, plan_id, duration_days||30);
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/admin/memberships', adminAuth, async(req,res)=>{
  const memberships = await q.find(db.memberships,{});
  const allU = await q.find(db.users,{});
  const uMap = Object.fromEntries(allU.map(u=>[u._id,{name:u.name,email:u.email}]));
  const result = memberships.map(m=>({...m, user_name:uMap[m.user_id]?.name||'—', user_email:uMap[m.user_id]?.email||'—'}));
  result.sort((a,b)=>b.created_at.localeCompare(a.created_at));
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════════════════
// WAITLIST (extends bookings)
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/waitlist', auth, async(req,res)=>{
  try {
    const {class_id, booking_date} = req.body;
    if(!class_id) return res.status(400).json({error:'Chýba trieda'});
    const cls = await q.one(db.classes,{_id:class_id});
    if(!cls||!cls.active) return res.status(404).json({error:'Hodina nenájdená'});
    const u = await q.one(db.users,{_id:req.session.uid});
    const bdate = booking_date||nextDateForDay(cls.day_of_week);
    if(await q.one(db.class_cancellations,{class_id, date:bdate})) return res.status(400).json({error:'Táto hodina je zrušená.'});
    const alreadyBooked = await q.one(db.bookings,{class_id,user_id:u._id,booking_date:bdate,status:{$ne:'cancelled'}});
    if(alreadyBooked) return res.status(400).json({error:'Ste už prihlásení (alebo na čakacom liste)'});
    const pos = await q.count(db.bookings,{class_id,booking_date:bdate,status:'waitlist'})+1;
    await q.insert(db.bookings,{
      class_id, class_name:cls.name, class_emoji:cls.emoji||'💃',
      class_location:cls.location, class_time_start:cls.time_start, class_time_end:cls.time_end,
      day_of_week:cls.day_of_week, day_name:DAYS_SK[cls.day_of_week],
      user_id:u._id, user_name:u.name, user_email:u.email, user_phone:u.phone||'',
      booking_date:bdate, status:'waitlist', waitlist_pos:pos, notes:'', created_at:nowISO()
    });
    await q.insert(db.notifications,{user_id:u._id,type:'waitlist',title:'Pridaný na čakací zoznam',body:`Ste na pozícii ${pos} na hodine ${cls.name}.`,read:false,created_at:nowISO()});
    res.json({ok:true, waitlist_pos:pos});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/my-waitlist', auth, async(req,res)=>{
  const items = await q.find(db.bookings,{user_id:req.session.uid,status:'waitlist'});
  res.json(items);
});

// Promote first waitlist person when booking is cancelled
async function promoteWaitlist(class_id, booking_date){
  const next = await q.find(db.bookings,{class_id,booking_date,status:'waitlist'},{waitlist_pos:1});
  if(!next.length) return;
  const first = next[0];
  await q.update(db.bookings,{_id:first._id},{$set:{status:'confirmed',promoted_at:nowISO(),waitlist_pos:null}});
  await q.insert(db.notifications,{user_id:first.user_id,type:'booking',title:'Miesto uvoľnené! 🎉',body:`Vaše miesto na ${first.class_name} (${first.booking_date}) bolo potvrdené!`,read:false,created_at:nowISO()});
}

// Override the delete booking to trigger waitlist promotion
// Storno policy (Glofox-style): cancellation only up to N hours before class start
const CANCEL_DEADLINE_HOURS = +process.env.CANCEL_DEADLINE_HOURS || 3;
app.delete('/api/bookings/:id', auth, async(req,res)=>{
  const b = await q.one(db.bookings,{_id:req.params.id,user_id:req.session.uid});
  if(!b) return res.status(404).json({error:'Rezervácia nenájdená'});
  if(b.status==='confirmed' && b.booking_date){
    const cls = await q.one(db.classes,{_id:b.class_id});
    const start = new Date(`${b.booking_date}T${cls?.time_start||'00:00'}:00`);
    const hoursLeft = (start - Date.now())/3600000;
    if(hoursLeft > 0 && hoursLeft < CANCEL_DEADLINE_HOURS){
      return res.status(400).json({error:`Storno je možné najneskôr ${CANCEL_DEADLINE_HOURS} hod. pred začiatkom hodiny. Ak nemôžeš prísť, kontaktuj nás.`});
    }
  }
  await q.update(db.bookings,{_id:req.params.id},{$set:{status:'cancelled',cancelled_at:nowISO()}});
  if(b.status==='confirmed') await promoteWaitlist(b.class_id, b.booking_date);
  sendBookingCancelEmail(b).catch(()=>{});
  res.json({ok:true});
});

// ═══════════════════════════════════════════════════════════════════════════════
// ONLINE CLASS ACCESS
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/online/classes', auth, async(req,res)=>{
  const m = await checkMembership(req.session.uid);
  const plan = m ? MEMBERSHIP_PLANS[m.plan_id]||null : null;
  const hasAccess = plan?.online || false;
  const classes = await q.find(db.classes,{category:'Online',active:true});
  const result = classes.map(c=>({
    ...c,
    stream_url: hasAccess ? (c.stream_url||null) : null,
    stream_key: hasAccess ? (c.stream_key||null) : null,
    has_access: hasAccess,
    locked: !hasAccess,
  }));
  res.json({classes:result, has_access:hasAccess, media_base:(process.env.MEDIA_BASE||'').replace(/\/$/,''), membership:m?{plan_id:m.plan_id,plan_name:m.plan_name,expires_at:m.expires_at}:null});
});

// ═══════════════════════════════════════════════════════════════════════════════
// RENTAL MODULE
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/rental', async(req,res)=>{
  try {
    const {name,email,phone,company,city,date_from,date_to,event_type,attendees,message} = req.body;
    if(!name||!email||!phone) return res.status(400).json({error:'Meno, email a telefón sú povinné'});
    const rental = await q.insert(db.rentals,{
      name,email,phone,company:company||'',city:city||'',
      date_from:date_from||'',date_to:date_to||'',
      event_type:event_type||'',attendees:+attendees||0,
      message:message||'',status:'new',
      created_at:nowISO()
    });
    // Notify admin
    const admin = await q.one(db.users,{is_admin:true});
    if(admin) await q.insert(db.notifications,{user_id:admin._id,type:'rental',title:'Nová žiadosť o prenájom',body:`${name} (${phone}) – ${event_type||'—'}, ${city||'—'}`,read:false,created_at:nowISO()});
    res.json({ok:true, id:rental._id});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/admin/rentals', adminAuth, async(req,res)=>{
  const rentals = await q.find(db.rentals,{});
  rentals.sort((a,b)=>b.created_at.localeCompare(a.created_at));
  res.json(rentals);
});

app.put('/api/admin/rentals/:id', adminAuth, async(req,res)=>{
  const {status,notes} = req.body;
  await q.update(db.rentals,{_id:req.params.id},{$set:{status:status||'new',notes:notes||'',updated_at:nowISO()}});
  res.json({ok:true});
});

// ═══════════════════════════════════════════════════════════════════════════════
// BLOG / ARTICLES (Admin CRUD — stored in messages with is_article:true)
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/admin/articles', adminAuth, async(req,res)=>{
  try {
    const {title,body,article_cat,channel,perex,image_url} = req.body;
    if(!title||!body) return res.status(400).json({error:'Titul a obsah sú povinné'});
    const u = await q.one(db.users,{_id:req.session.uid});
    const msg = await q.insert(db.messages,{
      channel:channel||'blog', text:`${title}\n\n${body}`,
      user_id:u._id, user_name:u.name,
      memberBadge:getMemberBadge(u.created_at),
      rankBadge:RANKS[(u.rank||1)-1].badge,
      is_article:true, article_cat:article_cat||'Blog',
      article_date:today(), perex:perex||'',
      image_url:image_url||'', created_at:nowISO()
    });
    res.json({ok:true, id:msg._id});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.put('/api/admin/articles/:id', adminAuth, async(req,res)=>{
  const {title,body,article_cat,channel,perex,image_url} = req.body;
  if(!title||!body) return res.status(400).json({error:'Titul a obsah sú povinné'});
  await q.update(db.messages,{_id:req.params.id},{$set:{
    text:`${title}\n\n${body}`,
    article_cat:article_cat||'Blog',
    channel:channel||'blog',
    perex:perex||'',
    image_url:image_url||'',
    updated_at:nowISO()
  }});
  res.json({ok:true});
});

app.delete('/api/admin/articles/:id', adminAuth, async(req,res)=>{
  await q.remove(db.messages,{_id:req.params.id,is_article:true});
  res.json({ok:true});
});

app.get('/api/admin/articles', adminAuth, async(req,res)=>{
  const articles = await q.find(db.messages,{is_article:true});
  articles.sort((a,b)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime());
  res.json(articles);
});

// Public articles list
app.get('/api/articles', async(req,res)=>{
  try {
    const {channel,cat,limit:lim} = req.query;
    const filter = {is_article:true};
    if(channel) filter.channel = channel;
    if(cat) filter.article_cat = cat;
    const articles = await q.find(db.messages,filter);
    articles.sort((a,b)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime());
    res.json(articles.slice(0, +lim||20));
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/notifications', auth, async(req,res)=>{
  const notifs = await q.find(db.notifications,{user_id:req.session.uid},{created_at:-1});
  res.json(notifs.slice(0,50));
});

app.post('/api/notifications/read', auth, async(req,res)=>{
  const {ids} = req.body;
  const filter = ids?.length ? {_id:{$in:ids},user_id:req.session.uid} : {user_id:req.session.uid,read:false};
  await q.update(db.notifications,filter,{$set:{read:true}},{multi:true});
  res.json({ok:true});
});

app.post('/api/notifications/read-all', auth, async(req,res)=>{
  await q.update(db.notifications,{user_id:req.session.uid,read:false},{$set:{read:true}},{multi:true});
  res.json({ok:true});
});

app.get('/api/notifications/count', auth, async(req,res)=>{
  const count = await q.count(db.notifications,{user_id:req.session.uid,read:false});
  res.json({count});
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONTACT FORM
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/contact', async(req,res)=>{
  try {
    const {name,email,phone,subject,message,city} = req.body;
    if(!name||!email||!message) return res.status(400).json({error:'Meno, email a správa sú povinné'});
    await q.insert(db.rentals,{_type:'contact',name,email,phone:phone||'',subject:subject||'',message,city:city||'',status:'new',created_at:nowISO()});
    const admin = await q.one(db.users,{is_admin:true});
    if(admin) await q.insert(db.notifications,{user_id:admin._id,type:'contact',title:'Nová správa z kontaktného formulára',body:`${name} (${email}): ${subject||message.slice(0,60)}`,read:false,created_at:nowISO()});
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BODY ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/body-analysis', auth, async(req,res)=>{
  try {
    const {weight,body_fat,muscle_mass,bmi,waist,hips,notes,measured_by} = req.body;
    if(!weight) return res.status(400).json({error:'Váha je povinná'});
    const entry = await q.insert(db.memberships,{
      _type:'body_analysis',
      user_id: req.session.uid,
      weight:+weight, body_fat:+body_fat||null, muscle_mass:+muscle_mass||null,
      bmi:+bmi||null, waist:+waist||null, hips:+hips||null,
      notes:notes||'', measured_by:measured_by||'self',
      date:today(), created_at:nowISO()
    });
    await q.insert(db.notifications,{user_id:req.session.uid,type:'body',title:'Analýza tela uložená',body:`Váha: ${weight}kg · ${today()}`,read:false,created_at:nowISO()});
    res.json({ok:true, id:entry._id});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/body-analysis', auth, async(req,res)=>{
  try {
    const entries = await q.find(db.memberships,{_type:'body_analysis',user_id:req.session.uid});
    entries.sort((a,b)=>a.date.localeCompare(b.date));
    res.json(entries);
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/admin/body-analysis/:userId', adminAuth, async(req,res)=>{
  const entries = await q.find(db.memberships,{_type:'body_analysis',user_id:req.params.userId});
  entries.sort((a,b)=>a.date.localeCompare(b.date));
  res.json(entries);
});

app.post('/api/admin/body-analysis', adminAuth, async(req,res)=>{
  try {
    const {user_id,weight,body_fat,muscle_mass,bmi,waist,hips,notes} = req.body;
    if(!user_id||!weight) return res.status(400).json({error:'Chýba user_id alebo váha'});
    const entry = await q.insert(db.memberships,{
      _type:'body_analysis',user_id,
      weight:+weight,body_fat:+body_fat||null,muscle_mass:+muscle_mass||null,
      bmi:+bmi||null,waist:+waist||null,hips:+hips||null,
      notes:notes||'',measured_by:'trainer',date:today(),created_at:nowISO()
    });
    await q.insert(db.notifications,{user_id,type:'body',title:'Nové meranie od trénera',body:`Váha: ${weight}kg · ${today()}`,read:false,created_at:nowISO()});
    res.json({ok:true,id:entry._id});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIT PREMENA TRACKING
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/fit-premena/checkin', auth, async(req,res)=>{
  try {
    const {week,weight,energy,mood,workouts_done,notes,photo_url} = req.body;
    if(!week) return res.status(400).json({error:'Chýba číslo týždňa'});
    const existing = await q.one(db.memberships,{_type:'fit_premena',user_id:req.session.uid,week:+week});
    let entry;
    if(existing){
      await q.update(db.memberships,{_id:existing._id},{$set:{weight:+weight||null,energy:+energy||null,mood:+mood||null,workouts_done:+workouts_done||0,notes:notes||'',photo_url:photo_url||'',updated_at:nowISO()}});
      entry={_id:existing._id};
    } else {
      entry = await q.insert(db.memberships,{
        _type:'fit_premena',user_id:req.session.uid,
        week:+week,weight:+weight||null,energy:+energy||null,mood:+mood||null,
        workouts_done:+workouts_done||0,notes:notes||'',photo_url:photo_url||'',
        date:today(),created_at:nowISO()
      });
    }
    res.json({ok:true,id:entry._id});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/fit-premena', auth, async(req,res)=>{
  const entries = await q.find(db.memberships,{_type:'fit_premena',user_id:req.session.uid});
  entries.sort((a,b)=>a.week-b.week);
  res.json(entries);
});

app.get('/api/admin/fit-premena/:userId', adminAuth, async(req,res)=>{
  const entries = await q.find(db.memberships,{_type:'fit_premena',user_id:req.params.userId});
  entries.sort((a,b)=>a.week-b.week);
  res.json(entries);
});

// ═══════════════════════════════════════════════════════════════════════════════
// TRAINER DASHBOARD API
// ═══════════════════════════════════════════════════════════════════════════════
const trainerAuth = async(req,res,next)=>{
  if(!req.session?.uid) return res.status(401).json({error:'Nie ste prihlásený'});
  const u = await q.one(db.users,{_id:req.session.uid});
  const allowed = u && (u.is_admin || u.user_type==='trainer' || u.user_type==='manager' || u.is_assistant);
  if(!allowed) return res.status(403).json({error:'Prístup len pre trénerov'});
  req.trainerUser = u;
  // Asistent koná za svojho trénera (filtrovanie hodín podľa trénera)
  req.effectiveTrainer = (u.is_assistant && u.assistant_of) ? (await q.one(db.users,{_id:u.assistant_of})||u) : u;
  next();
};

app.get('/api/trainer/my-classes', trainerAuth, async(req,res)=>{
  const u = req.effectiveTrainer||req.trainerUser;
  const filter = u.is_admin ? {} : {instructor:{$regex:new RegExp(u.name.split(' ')[0],'i')}};
  const classes = await q.find(db.classes,{...filter,active:true});
  const result = [];
  for(const c of classes){
    const booked = await q.count(db.bookings,{class_id:c._id,status:'confirmed'});
    const waitlist = await q.count(db.bookings,{class_id:c._id,status:'waitlist'});
    result.push({...c,booked,waitlist,spotsLeft:Math.max(0,c.capacity-booked),dayName:DAYS_SK[c.day_of_week]});
  }
  result.sort((a,b)=>a.day_of_week-b.day_of_week||a.time_start.localeCompare(b.time_start));
  res.json(result);
});

app.get('/api/trainer/class-attendees/:classId', trainerAuth, async(req,res)=>{
  const bookings = await q.find(db.bookings,{class_id:req.params.classId,status:'confirmed'});
  res.json(bookings);
});

app.post('/api/trainer/class-notes', trainerAuth, async(req,res)=>{
  const {class_id,notes,date} = req.body;
  await q.update(db.classes,{_id:class_id},{$set:{trainer_notes:notes||'',notes_date:date||today()}});
  res.json({ok:true});
});

// List of people who can be assigned to teach a class (trainers, managers, admins, assistants)
app.get('/api/instructors', trainerAuth, async(req,res)=>{
  const users=await q.find(db.users,{active:{$ne:false},$or:[{is_admin:true},{user_type:'trainer'},{user_type:'manager'},{is_assistant:true}]});
  const out=users.map(u=>({id:u._id,name:u.name,is_admin:!!u.is_admin,is_trainer:u.user_type==='trainer'}))
    .sort((a,b)=>a.name.localeCompare(b.name));
  res.json(out);
});

// Assign / change who teaches a class — allowed for admins AND trainers/managers/assistants
app.post('/api/classes/:id/instructor', trainerAuth, async(req,res)=>{
  try {
    const cls=await q.one(db.classes,{_id:req.params.id});
    if(!cls) return res.status(404).json({error:'Hodina nenájdená'});
    const {instructor_id}=req.body;
    let ins;
    if(instructor_id){
      const u=await q.one(db.users,{_id:instructor_id});
      if(!u) return res.status(400).json({error:'Tréner nenájdený'});
      ins={instructor_id:u._id, instructor:u.name};
    } else {
      const founder=await q.one(db.users,{email:'gruber.marek@gmail.com'});
      ins={instructor_id:founder?._id||'', instructor:founder?.name||'Marek Gruber'};
    }
    await q.update(db.classes,{_id:cls._id},{$set:ins});
    await auditLog(req,'class_instructor_set','class:'+cls._id,{instructor:cls.instructor,instructor_id:cls.instructor_id||''},ins,'');
    res.json({ok:true, instructor:ins.instructor, instructor_id:ins.instructor_id});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── CRM úlohy (follow-upy na leadov/klientov) ─────────────────────────────────
function taskView(t, uMap){
  const days = t.due_date ? Math.floor((new Date(t.due_date+'T00:00:00')-new Date(today()+'T00:00:00'))/86400000) : null;
  return { id:t._id, title:t.title, note:t.note||'', client_id:t.client_id||null,
    client_name:t.client_id?(uMap[t.client_id]?.name||t.client_name||'—'):(t.client_name||''),
    assigned_to:t.assigned_to||null, assigned_name:t.assigned_to?(uMap[t.assigned_to]?.name||'—'):'—',
    due_date:t.due_date||null, days, status:t.status||'open', created_at:t.created_at, done_at:t.done_at,
    created_by_name:t.created_by?(uMap[t.created_by]?.name||''):'' };
}
app.get('/api/crm/tasks', trainerAuth, async(req,res)=>{
  try {
    const me = req.trainerUser;
    const q0 = {};
    if(!me.is_admin) q0.assigned_to = me._id;            // tréner vidí len svoje
    else if(req.query.assigned) q0.assigned_to = req.query.assigned;
    let tasks = await q.find(db.crm_tasks, q0);
    const uMap = Object.fromEntries((await q.find(db.users,{})).map(u=>[u._id,u]));
    const td = today();
    const in7 = new Date(Date.now()+7*864e5).toISOString().slice(0,10);
    const rows = tasks.map(t=>taskView(t,uMap));
    const open = rows.filter(t=>t.status!=='done');
    const groups = {
      overdue: open.filter(t=>t.due_date && t.due_date < td).sort((a,b)=>(a.due_date||'').localeCompare(b.due_date)),
      today:   open.filter(t=>t.due_date===td),
      next7:   open.filter(t=>t.due_date && t.due_date>td && t.due_date<=in7).sort((a,b)=>(a.due_date||'').localeCompare(b.due_date)),
      later:   open.filter(t=>!t.due_date || t.due_date>in7),
      done:    rows.filter(t=>t.status==='done').sort((a,b)=>(b.done_at||b.created_at||'').localeCompare(a.done_at||a.created_at||'')).slice(0,50),
    };
    res.json({ ...groups, counts:{ overdue:groups.overdue.length, today:groups.today.length, open:open.length } });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/crm/tasks', trainerAuth, async(req,res)=>{
  try {
    const {title, client_id, assigned_to, due_date, note} = req.body;
    if(!title || !title.trim()) return res.status(400).json({error:'Zadaj názov úlohy'});
    const client = client_id ? await q.one(db.users,{_id:client_id}) : null;
    const t = await q.insert(db.crm_tasks,{ title:title.trim(), note:(note||'').slice(0,1000),
      client_id:client?client._id:null, client_name:client?client.name:'',
      assigned_to:assigned_to||req.trainerUser._id, due_date:/^\d{4}-\d{2}-\d{2}$/.test(due_date||'')?due_date:null,
      status:'open', created_by:req.trainerUser._id, created_at:nowISO() });
    if(t.assigned_to && t.assigned_to!==req.trainerUser._id)
      await q.insert(db.notifications,{user_id:t.assigned_to,type:'task',title:'🗒️ Nová úloha',body:`${t.title}${client?' · '+client.name:''}${t.due_date?' · do '+t.due_date:''}`,read:false,created_at:nowISO()}).catch(()=>{});
    res.json({ ok:true, id:t._id });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/crm/tasks/:id', trainerAuth, async(req,res)=>{
  try {
    const t = await q.one(db.crm_tasks,{_id:req.params.id}); if(!t) return res.status(404).json({error:'Nenájdené'});
    const set={};
    if(req.body.status==='done'){ set.status='done'; set.done_at=nowISO(); }
    if(req.body.status==='open'){ set.status='open'; set.done_at=null; }
    for(const k of ['title','note','due_date']) if(req.body[k]!==undefined) set[k]=req.body[k];
    if(req.body.assigned_to!==undefined) set.assigned_to=req.body.assigned_to;
    await q.update(db.crm_tasks,{_id:t._id},{$set:set});
    res.json({ ok:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/crm/tasks/:id', trainerAuth, async(req,res)=>{
  await q.remove(db.crm_tasks,{_id:req.params.id});
  res.json({ ok:true });
});

// ── Hromadné správy / kampane na segment (email + notifikácia) ────────────────
const OUTREACH_SEGMENTS = {
  clients:  'Všetci klienti',
  leads:    'Všetci leady',
  everyone: 'Klienti + leady',
  expiring: 'Členstvo vyprší do 14 dní',
  inactive: 'Neaktívni klienti (30+ dní bez hodiny)',
  entries:  'Majú permanentkové vstupy',
  trainers: 'Tréneri (tím)',
  admins:   'Admini',
};
async function outreachContext(){
  // vrátane trénerov a adminov (na interné správy tímu)
  const users = (await q.find(db.users,{active:{$ne:false}, is_child:{$ne:true}, anonymous:{$ne:true}}))
    .filter(u=>['client','lead','trainer','manager','partner'].includes(u.user_type||'') || u.is_admin);
  const membs = await q.find(db.memberships,{status:'active'});
  const td0=today();
  const memExp={}, memPlan={};
  for(const m of membs){ const e=(m.expires_at||'').slice(0,10); if(e && e<td0) continue; // len platné
    if(!memExp[m.user_id]||e>memExp[m.user_id]){ memExp[m.user_id]=e; memPlan[m.user_id]=m.plan_id||''; } }
  const bookings = await q.find(db.bookings,{status:'attended'});
  const lastAtt={}, cityCount={};
  for(const b of bookings){ if(!b.user_id) continue; const d=b.booking_date||(b.created_at||'').slice(0,10); if(!lastAtt[b.user_id]||d>lastAtt[b.user_id]) lastAtt[b.user_id]=d;
    const loc=(b.class_location||'').trim(); if(loc){ (cityCount[b.user_id]=cityCount[b.user_id]||{})[loc]=(cityCount[b.user_id]?.[loc]||0)+1; } }
  const cityOf={}; for(const uid in cityCount){ cityOf[uid]=Object.entries(cityCount[uid]).sort((a,b)=>b[1]-a[1])[0][0]; }
  return {users, memExp, memPlan, lastAtt, cityOf};
}
function inSegment(u, seg, ctx, opts={}){
  const td=today(); const in14=new Date(Date.now()+14*864e5).toISOString().slice(0,10); const ago30=new Date(Date.now()-30*864e5).toISOString().slice(0,10);
  if(seg==='clients') return u.user_type==='client' && !u.is_admin;
  if(seg==='leads') return u.user_type==='lead' && !u.is_admin;
  if(seg==='everyone') return ['client','lead'].includes(u.user_type) && !u.is_admin;
  if(seg==='trainers') return !u.is_admin && ['trainer','manager'].includes(u.user_type);
  if(seg==='admins') return !!u.is_admin;
  if(seg==='expiring') return ctx.memExp[u._id] && ctx.memExp[u._id]>=td && ctx.memExp[u._id]<=in14;
  if(seg==='inactive') return u.user_type==='client' && (!ctx.lastAtt[u._id] || ctx.lastAtt[u._id]<ago30);
  if(seg==='entries') return (u.single_entries||0)>0;
  if(seg==='city') return ctx.cityOf[u._id]===opts.city;
  if(seg==='membership') return ctx.memPlan[u._id]===opts.plan;
  return false;
}
app.get('/api/admin/outreach/segments', adminAuth, async(req,res)=>{
  try {
    const ctx=await outreachContext();
    const segs=Object.entries(OUTREACH_SEGMENTS).map(([key,label])=>({key,label,count:ctx.users.filter(u=>inSegment(u,key,ctx)).length}));
    const cities=[...new Set(Object.values(ctx.cityOf))].sort().map(c=>({key:c, count:ctx.users.filter(u=>ctx.cityOf[u._id]===c).length}));
    // Úrovne členstva (pre upsell kampane) — len plány, ktoré má aspoň 1 aktívny člen
    const planIds=[...new Set(Object.values(ctx.memPlan).filter(Boolean))];
    const memberships=planIds.map(pid=>({ key:pid, label:(MEMBERSHIP_PLANS[pid]?.name||pid),
      count:ctx.users.filter(u=>ctx.memPlan[u._id]===pid).length }))
      .filter(x=>x.count>0).sort((a,b)=>b.count-a.count);
    res.json({ segments:segs, cities, memberships, total:ctx.users.length });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/admin/outreach/send', adminAuth, async(req,res)=>{
  try {
    const {segment, city, plan, subject, message, channel} = req.body;
    if(!subject||!subject.trim()) return res.status(400).json({error:'Zadaj predmet/nadpis'});
    if(!message||!message.trim()) return res.status(400).json({error:'Zadaj text správy'});
    const ch = ['email','notification','both'].includes(channel)?channel:'both';
    const ctx=await outreachContext();
    const recipients=ctx.users.filter(u=>inSegment(u,segment,ctx,{city,plan}));
    const html = emailTemplate(subject.trim(), message.trim().replace(/\n/g,'<br>'), 'Otvoriť Fusion Academy', `${APP_URL}/client-dashboard`);
    let emailed=0, notified=0;
    for(const u of recipients){
      if((ch==='notification'||ch==='both'))
        { await q.insert(db.notifications,{user_id:u._id,type:'campaign',title:subject.trim().slice(0,120),body:message.trim().slice(0,500),read:false,created_at:nowISO()}).catch(()=>{}); notified++; }
      if((ch==='email'||ch==='both') && u.email && (u.email_consent || u.consent_at))
        { await sendMail(u.email, subject.trim(), html).catch(()=>{}); emailed++; }
    }
    const rec=await q.insert(db.outreach,{ subject:subject.trim(), message:message.trim(), segment, city:city||null, plan:plan||null, channel:ch,
      recipients:recipients.length, emailed, notified, sent_by:req._auditActor||'', created_at:nowISO() });
    await auditLog(req,'outreach_send',segment,{},{recipients:recipients.length, emailed, notified, subject:subject.trim()},'');
    res.json({ ok:true, recipients:recipients.length, emailed, notified, id:rec._id });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/admin/outreach/history', adminAuth, async(req,res)=>{
  const list=await q.find(db.outreach,{});
  res.json(list.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')).slice(0,50));
});

// Prehľad zárobkov trénera (vlastných) — s filtrom obdobia + rozpis za čo koľko
// Súčet affiliate provízií (z MLM línie) trénera za daný mesiac
async function affiliateCommissionFor(userId, month){
  const coms = await q.find(db.commissions,{partner_id:userId, month});
  return +coms.reduce((s,c)=>s+(+c.amount||0),0).toFixed(2);
}
app.get('/api/trainer/earnings', trainerAuth, async(req,res)=>{
  try {
    // Admin si vie pozrieť konkrétneho trénera cez ?trainer_id=
    let t = req.effectiveTrainer||req.trainerUser;
    if(req.query.trainer_id && req.trainerUser?.is_admin){
      const tu = await q.one(db.users,{_id:req.query.trainer_id});
      if(tu) t = tu;
    }
    const tName = t.name;
    const rule = await q.one(db.payout_rules,{trainer:tName}) || {...DEFAULT_PAYOUT_RULE};
    const thr = rule.per_client_threshold||0;
    // Posledných 12 mesiacov
    const months=[]; const now=new Date();
    for(let i=0;i<12;i++){ const d=new Date(now.getFullYear(),now.getMonth()-i,1); months.push(d.toISOString().slice(0,7)); }
    const rows=[];
    for(const m of months){
      const st=(await trainerMonthStats(m)).find(s=>s.instructor===tName || (tName&&s.instructor&&s.instructor.includes(tName.split(' ')[0]))) || {sessions:0,attendances:0,revenue:0,newClients:0,fullClasses:0,session_atts:[]};
      const {base,bonuses,billable}=computePayout(rule,st);
      const affiliate = await affiliateCommissionFor(t._id, m);
      const rec=await q.one(db.payouts,{trainer:tName,month:m});
      const ded=rec?.deductions||0;
      const total=+(base+bonuses+affiliate-ded).toFixed(2);
      const items=[
        {label:'Základ za hodinu', count:st.sessions, per:rule.fixed_per_class||0, amount:+((rule.fixed_per_class||0)*st.sessions).toFixed(2)},
        {label:(thr>0?`Klienti nad ${thr} na hodine`:'Odmena za účastníka'), count:billable, per:rule.per_client||0, amount:+((rule.per_client||0)*billable).toFixed(2)},
        {label:'% z tržby hodín', count:st.revenue, per:(rule.pct_of_revenue||0)+' %', amount:+((rule.pct_of_revenue||0)/100*st.revenue).toFixed(2)},
        {label:'Bonus za plnú hodinu', count:st.fullClasses, per:rule.bonus_full_class||0, amount:+((rule.bonus_full_class||0)*st.fullClasses).toFixed(2)},
        {label:'Bonus za nového klienta', count:st.newClients, per:rule.bonus_new_member||0, amount:+((rule.bonus_new_member||0)*st.newClients).toFixed(2)},
        {label:'Affiliate provízie (moja línia)', count:'', per:'', amount:affiliate},
      ].filter(x=>x.per||x.amount);
      rows.push({month:m, sessions:st.sessions, attendances:st.attendances, revenue:+st.revenue.toFixed(2),
        base:+base.toFixed(2), bonuses:+bonuses.toFixed(2), affiliate, deductions:ded, total,
        status: rec?.status||'draft', paid: rec?.status==='paid', items});
    }
    const grand=rows.reduce((s,r)=>s+r.total,0);
    const grandAffiliate=rows.reduce((s,r)=>s+r.affiliate,0);
    res.json({ trainer:tName, trainer_id:t._id, months:rows, grand_total:+grand.toFixed(2), grand_affiliate:+grandAffiliate.toFixed(2) });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Asistent trénera ──────────────────────────────────────────────────────────
function canManageAssistant(u){ return u && (u.is_admin || u.user_type==='trainer' || u.user_type==='manager'); }
app.get('/api/trainer/assistant', trainerAuth, async(req,res)=>{
  const t=req.trainerUser;
  const list = await q.find(db.users,{assistant_of:t._id, is_assistant:true});
  const assistants = list.map(a=>({id:a._id,name:a.name,email:a.email,avatar:a.avatar||null}));
  res.json({ assistants, assistant: assistants[0]||null, can_manage: canManageAssistant(t) });
});
app.post('/api/trainer/assistant', trainerAuth, async(req,res)=>{
  try {
    const t=req.trainerUser;
    if(!canManageAssistant(t)) return res.status(403).json({error:'Len tréner môže priradiť asistenta'});
    const uid=String(req.body.user_id||''); if(!uid) return res.status(400).json({error:'Chýba user_id'});
    const target=await q.one(db.users,{_id:uid}); if(!target) return res.status(404).json({error:'Používateľ nenájdený'});
    if(target._id===t._id) return res.status(400).json({error:'Nemôžeš byť svoj asistent'});
    // viacero asistentov je povolených — len pridaj tohto
    await q.update(db.users,{_id:uid},{$set:{is_assistant:true, assistant_of:t._id}});
    await q.insert(db.notifications,{user_id:uid,type:'assistant',title:'🤝 Stal si sa asistentom!',
      body:`${t.name} ťa určil za svojho asistenta. V appke máš teraz prístup do trénerského panela (bookovanie, QR) a nový odznak. 💛`,read:false,created_at:nowISO()}).catch(()=>{});
    await auditLog(req,'set_assistant',uid,{},{trainer:t._id},'');
    res.json({ ok:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/trainer/assistant/:id', trainerAuth, async(req,res)=>{
  try {
    const t=req.trainerUser;
    if(!canManageAssistant(t)) return res.status(403).json({error:'Nemáš oprávnenie'});
    const target=await q.one(db.users,{_id:req.params.id});
    if(target && target.assistant_of===t._id){ await q.update(db.users,{_id:target._id},{$set:{is_assistant:false,assistant_of:null}}); }
    res.json({ ok:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/trainer/students', trainerAuth, async(req,res)=>{
  const bookings = await q.find(db.bookings,{status:'confirmed'});
  const userIds = [...new Set(bookings.map(b=>b.user_id))];
  const users = await q.find(db.users,{active:true,is_admin:{$ne:true}});
  const result = users.filter(u=>userIds.includes(u._id)).map(u=>({
    id:u._id, name:u.name, email:u.email, phone:u.phone||'',
    created_at:u.created_at, membership_plan:u.membership_plan||null
  }));
  res.json(result);
});

// Update class stream URL (trainer/admin)
app.put('/api/admin/classes/:id/stream', adminAuth, async(req,res)=>{
  const {stream_url,stream_platform,stream_notes,stream_key} = req.body;
  const $set = {stream_url:stream_url||'',stream_platform:stream_platform||'',stream_notes:stream_notes||''};
  if(stream_key!==undefined) $set.stream_key = String(stream_key||'').replace(/[^a-zA-Z0-9_-]/g,'');
  await q.update(db.classes,{_id:req.params.id},{$set});
  res.json({ok:true, stream_key:$set.stream_key});
});

// ═══════════════════════════════════════════════════════════════════════════════
// ATTENDANCE DASHBOARD – Admin + Trainer
// ═══════════════════════════════════════════════════════════════════════════════

// Full schedule with booking counts (admin sees all; trainer sees their own)
app.get('/api/attendance/schedule', trainerAuth, async(req,res)=>{
  try {
    const u = req.trainerUser;
    const filter = u.is_admin ? {active:true} : {active:true, instructor:{$regex:new RegExp(u.name.split(' ')[0],'i')}};
    const classes = await q.find(db.classes, filter);
    const result = [];
    for(const c of classes){
      const confirmed = await q.count(db.bookings,{class_id:c._id, status:'confirmed'});
      const waitlist  = await q.count(db.bookings,{class_id:c._id, status:'waitlist'});
      result.push({...c, confirmed, waitlist, spotsLeft:Math.max(0,c.capacity-confirmed), dayName:DAYS_SK[c.day_of_week]});
    }
    result.sort((a,b)=>a.day_of_week-b.day_of_week||a.time_start.localeCompare(b.time_start));
    res.json(result);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Zruš konkrétnu hodinu (dátum) — upozorni booknutých, vráť kredit z permanentky,
// daj oznam na nástenku, znemožni booknutie, pozvi na najbližšiu hodinu v tom meste.
app.post('/api/attendance/cancel-session', trainerAuth, async(req,res)=>{
  try {
    const { class_id } = req.body;
    let { date, reason } = req.body;
    const cls = await q.one(db.classes,{_id:class_id});
    if(!cls) return res.status(404).json({error:'Hodina nenájdená'});
    date = date || nextDateForDay(cls.day_of_week);
    reason = (reason||'').slice(0,300);
    // Idempotencia
    if(await q.one(db.class_cancellations,{class_id, date}))
      return res.json({ ok:true, already:true });
    await q.insert(db.class_cancellations,{ class_id, date, class_name:cls.name, location:cls.location,
      reason, cancelled_by: req.trainerUser?._id||null, cancelled_by_name: req.trainerUser?.name||'', created_at:nowISO() });

    // Najbližšia iná hodina v tom istom meste (na pozvánku)
    const cityClasses = (await q.find(db.classes,{location:cls.location, active:true})).filter(c=>c._id!==class_id);
    let nextInfo=null, nextBest=null;
    for(const c of cityClasses){
      const d = nextDateForDay(c.day_of_week);
      if(await q.one(db.class_cancellations,{class_id:c._id, date:d})) continue; // aj tá zrušená
      if(!nextBest || d < nextBest.date) nextBest = {date:d, c};
    }
    if(nextBest){ nextInfo = { name:nextBest.c.name, date:nextBest.date, time:nextBest.c.time_start, location:nextBest.c.location }; }
    const inviteTxt = nextInfo ? ` Pozývame ťa na najbližšiu hodinu v ${cls.location}: <b>${nextInfo.name}</b> ${nextInfo.date} o ${nextInfo.time}.` : '';

    // Zruš rezervácie + vráť permanentkový vstup + notifikuj
    const bookings = await q.find(db.bookings,{class_id, booking_date:date, status:{$nin:['cancelled','cancelled_studio']}});
    let refunded=0;
    for(const b of bookings){
      if(b.access_method==='single_entry'){
        const u = await q.one(db.users,{_id:b.user_id});
        if(u){ await q.update(db.users,{_id:u._id},{$set:{single_entries:(u.single_entries||0)+1}}); refunded++; }
      }
      await q.update(db.bookings,{_id:b._id},{$set:{status:'cancelled_studio', cancelled_reason:reason||'Zrušené štúdiom', cancelled_at:nowISO()}});
      const refundNote = b.access_method==='single_entry' ? ' Tvoj vstup z permanentky sme ti vrátili.' : '';
      await q.insert(db.notifications,{user_id:b.user_id, type:'class_cancelled',
        title:`❌ Hodina zrušená: ${cls.name}`,
        body:`${cls.name} dňa ${date}${cls.time_start?' o '+cls.time_start:''} v ${cls.location} sa NEKONÁ${reason?' ('+reason+')':''}.${refundNote}${inviteTxt}`,
        read:false, created_at:nowISO() }).catch(()=>{});
      const u = await q.one(db.users,{_id:b.user_id});
      if(u?.email) sendMail(u.email, `Hodina zrušená: ${cls.name} (${date})`,
        emailTemplate('Hodina sa nekoná 😔',
          `<p>Ahoj <b>${u.name}</b>,</p><p>Mrzí nás to — hodina <b>${cls.name}</b> dňa <b>${date}</b>${cls.time_start?' o '+cls.time_start:''} v <b>${cls.location}</b> sa <b>nekoná</b>${reason?` (${reason})`:''}.</p>${b.access_method==='single_entry'?'<p>Tvoj vstup z permanentky sme ti <b>vrátili</b> späť.</p>':''}${nextInfo?`<p>Pozývame ťa na najbližšiu hodinu v ${cls.location}: <b>${nextInfo.name}</b> ${nextInfo.date} o ${nextInfo.time}. 💃</p>`:''}`,
          '🗓️ Pozrieť rozvrh', `${APP_URL}/schedule`)).catch(()=>{});
    }

    // Oznam na nástenku (feed) — vidia všetci členovia
    await q.insert(db.feed,{ author_id:'studio', author_name:'Fusion Academy', author_badge:{emoji:'📢',label:'Oznam'},
      studio_announcement:true, city:cls.location,
      text:`📢 Zrušená hodina — ${cls.location}\n\nHodina „${cls.name}" dňa ${date}${cls.time_start?' o '+cls.time_start:''} sa NEKONÁ${reason?` (${reason})`:''}.${nextInfo?`\n\nNajbližšia hodina v ${cls.location}: ${nextInfo.name} ${nextInfo.date} o ${nextInfo.time}. Tešíme sa na teba! 💃`:''}`,
      image:null, reactions:{}, comments:[], created_at:nowISO() }).catch(()=>{});

    await auditLog(req,'class_cancel',class_id,{},{date, reason, notified:bookings.length, refunded},reason||'');
    res.json({ ok:true, notified:bookings.length, refunded, date, next:nextInfo });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/attendance/cancellations', trainerAuth, async(req,res)=>{
  const list = await q.find(db.class_cancellations,{ date:{$gte:today()} });
  res.json(list);
});

// Attendees for a specific class (optionally filtered to ?date=YYYY-MM-DD)
app.get('/api/attendance/class/:classId', trainerAuth, async(req,res)=>{
  try {
    const query = {class_id:req.params.classId, status:{$in:['confirmed','attended']}};
    if(req.query.date) query.booking_date = req.query.date;
    const bookings = await q.find(db.bookings, query, {booking_date:-1});
    const result = [];
    for(const b of bookings){
      const u = await q.one(db.users,{_id:b.user_id});
      const m = u ? await checkMembership(u._id) : null;
      result.push({
        booking_id: b._id,
        booking_date: b.booking_date,
        status: b.status,
        is_child_booking: !!b.is_child_booking,
        child_name: b.child_name||null,
        user_id: b.user_id,
        name: b.user_name||u?.name||'—',
        email: b.user_email||u?.email||'—',
        phone: b.user_phone||u?.phone||'—',
        visit_count: u?.visit_count||0,
        membership: m ? m.plan_name : null,
        free_class_used: u?.free_class_used||false,
        single_entries: u?.single_entries||0,
        notes: b.notes||'',
        created_at: b.created_at
      });
    }
    res.json(result);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Manual booking by admin/trainer.
// method: 'membership' (covered by active membership) | 'single_entry' (deduct 1 pass) |
//         'free' (comp / first-free) | undefined (backward-compat, uses is_free)
app.post('/api/attendance/manual-booking', trainerAuth, async(req,res)=>{
  try {
    const {user_id, class_id, booking_date, is_free, note} = req.body;
    let method = req.body.method;
    if(!method) method = is_free ? 'free' : 'membership';
    if(!user_id||!class_id) return res.status(400).json({error:'Chýba user_id alebo class_id'});
    const cls = await q.one(db.classes,{_id:class_id});
    if(!cls) return res.status(404).json({error:'Hodina nenájdená'});
    const u = await q.one(db.users,{_id:user_id});
    if(!u) return res.status(404).json({error:'Používateľ nenájdený'});
    const bdate = booking_date || nextDateForDay(cls.day_of_week);
    const exists = await q.one(db.bookings,{class_id,user_id,booking_date:bdate,status:{$ne:'cancelled'}});
    if(exists) return res.status(400).json({error:'Tento klient je už prihlásený na túto hodinu'});

    // ── Apply the chosen booking method ─────────────────────────────────────────
    const upd = {};
    let methodNote = '';
    if(method==='single_entry'){
      if((u.single_entries||0) <= 0) return res.status(400).json({error:`${u.name} nemá žiadny jednorazový vstup ani permanentku.`});
      upd.single_entries = (u.single_entries||0) - 1;
      methodNote = '🎟️ Jednorazový vstup';
    } else if(method==='free'){
      if((u.free_credits||0) > 0){ upd.free_credits = (u.free_credits||0) - 1; methodNote='🎁 Hodina zadarmo (kredit)'; }
      else { if(!u.free_class_used) upd.free_class_used = true; methodNote = u.free_class_used ? '🎁 Hodina zadarmo (tréner)' : '🎁 Prvá hodina zdarma'; }
    } else { // membership
      methodNote = '🏅 Členstvo';
    }
    upd.visit_count = (u.visit_count||0) + 1;
    if(u.winback_sent) upd.winback_sent = false;
    applyLeadTrial(upd, u); // lead → automaticky „Bola na hodine"

    await q.insert(db.bookings,{
      class_id, class_name:cls.name, class_emoji:cls.emoji||'💃',
      class_location:cls.location, class_time_start:cls.time_start, class_time_end:cls.time_end,
      day_of_week:cls.day_of_week, day_name:DAYS_SK[cls.day_of_week],
      user_id:u._id, user_name:u.name, user_email:u.email, user_phone:u.phone||'',
      booking_date:bdate, status:'confirmed', access_method:method,
      notes: note || methodNote,
      manual: true, manual_by: req.trainerUser._id, created_at:nowISO()
    });
    await q.update(db.users,{_id:u._id},{$set:upd});
    await q.insert(db.notifications,{user_id:u._id,type:'booking',title:'Rezervácia potvrdená ✅',body:`${cls.name} – ${bdate} o ${cls.time_start} · ${methodNote}`,read:false,created_at:nowISO()});
    res.json({ok:true, booking_date:bdate, visit_count:upd.visit_count, method, method_note:methodNote, single_entries:upd.single_entries!==undefined?upd.single_entries:(u.single_entries||0)});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Rich client list for the trainer booking picker: name, city, membership/pass status.
// Filters: ?q= (name/email), ?city=, ?filter=membership|pass|free|none
app.get('/api/attendance/clients', trainerAuth, async(req,res)=>{
  try {
    const { q:query, city, filter } = req.query;
    let users = await q.find(db.users,{active:{$ne:false}, is_admin:{$ne:true}, is_child:{$ne:true}});
    users = users.filter(u=>(u.user_type||'client')!=='trainer');
    if(query && query.trim().length>=1){ const rx=new RegExp(query.trim(),'i'); users = users.filter(u=>rx.test(u.name)||rx.test(u.email||'')); }
    const out = [];
    for(const u of users.slice(0,250)){
      const m = await checkMembership(u._id);
      const active = m && (m.status==='active');
      let uCity = u.city || null;
      if(!uCity){
        const last = (await q.find(db.bookings,{user_id:u._id},{booking_date:-1}))[0];
        uCity = last?.class_location || null;
      }
      out.push({
        id:u._id, name:u.name, phone:u.phone||'', city:uCity||null,
        visit_count:u.visit_count||0,
        membership: active ? m.plan_name : null,
        single_entries: u.single_entries||0,
        free_credits: u.free_credits||0,
        free_class_used: !!u.free_class_used
      });
    }
    let list = out;
    if(filter==='membership') list = list.filter(u=>u.membership);
    else if(filter==='pass') list = list.filter(u=>u.single_entries>0);
    else if(filter==='free') list = list.filter(u=>u.free_credits>0 || !u.free_class_used);
    else if(filter==='none') list = list.filter(u=>!u.membership && u.single_entries<=0 && u.free_credits<=0 && u.free_class_used);
    if(city && city!=='all') list = list.filter(u=>(u.city||'').toLowerCase()===city.toLowerCase());
    list.sort((a,b)=>a.name.localeCompare(b.name));
    res.json(list.slice(0,80));
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Record single-entry (10€) sale for a user
app.post('/api/attendance/single-entry', trainerAuth, async(req,res)=>{
  try {
    const {user_id, amount, payment_method, note} = req.body;
    if(!user_id) return res.status(400).json({error:'Chýba user_id'});
    const u = await q.one(db.users,{_id:user_id});
    if(!u) return res.status(404).json({error:'Používateľ nenájdený'});
    const entries = (u.single_entries||0) + 1;
    await q.update(db.users,{_id:user_id},{$set:{single_entries:entries}});
    // Record in transactions
    await q.insert(db.transactions,{
      type:'single_entry', user_id, user_name:u.name, amount:amount||10,
      payment_method:payment_method||'cash', note:note||'Jednorazový vstup 10€',
      recorded_by:req.trainerUser._id, created_at:nowISO(), month:today().slice(0,7)
    });
    await q.insert(db.notifications,{user_id,type:'payment',title:'Jednorazový vstup zakúpený ✅',body:`Zostatok: ${entries} vstup(ov)`,read:false,created_at:nowISO()});
    createInvoice({user_id, client_name:u.name, client_email:u.email,
      items:[{desc:'Jednorazový vstup', qty:1, total:+(amount||10)}], total:+(amount||10),
      method:payment_method==='card'?'Karta na mieste':(payment_method||'Hotovosť')});
    awardPurchaseCommission({buyer_id:user_id, amount:+(amount||10), product_name:'Jednorazový vstup'});
    res.json({ok:true, single_entries:entries});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Give a free class to a user (reset free_class_used flag)
app.post('/api/attendance/give-free', trainerAuth, async(req,res)=>{
  try {
    const {user_id, note} = req.body;
    if(!user_id) return res.status(400).json({error:'Chýba user_id'});
    const u = await q.one(db.users,{_id:user_id});
    if(!u) return res.status(404).json({error:'Používateľ nenájdený'});
    // Give one free entry credit (separate from single_entries so it's visible)
    const freeCredits = (u.free_credits||0) + 1;
    await q.update(db.users,{_id:user_id},{$set:{free_credits:freeCredits}});
    await q.insert(db.notifications,{user_id,type:'gift',title:'🎁 Dostali ste hodinu zadarmo!',body:note||'Admin vám pridal bezplatnú hodinu.',read:false,created_at:nowISO()});
    res.json({ok:true, free_credits:freeCredits});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Record membership sale
app.post('/api/attendance/record-membership', trainerAuth, async(req,res)=>{
  try {
    const {user_id, plan_id, amount, payment_method, note} = req.body;
    if(!user_id||!plan_id) return res.status(400).json({error:'Chýba user_id alebo plan_id'});
    const u = await q.one(db.users,{_id:user_id});
    if(!u) return res.status(404).json({error:'Používateľ nenájdený'});
    const plan = MEMBERSHIP_PLANS[plan_id];
    if(!plan) return res.status(400).json({error:'Neznámy plán'});
    // Create/renew membership
    const startDate = today();
    const expires = new Date(); expires.setDate(expires.getDate()+30);
    const expiresDate = expires.toISOString().slice(0,10);
    await q.insert(db.memberships,{
      user_id, user_name:u.name, plan_id, plan_name:plan.name,
      price:amount||plan.price, payment_method:payment_method||'cash',
      start_date:startDate, expires_at:expiresDate, status:'active',
      recorded_by:req.trainerUser._id, note:note||'', created_at:nowISO()
    });
    await q.insert(db.transactions,{
      type:'membership', user_id, user_name:u.name, amount:amount||plan.price,
      payment_method:payment_method||'cash', note:note||`Členstvo ${plan.name}`,
      plan_id, recorded_by:req.trainerUser._id, created_at:nowISO(), month:today().slice(0,7)
    });
    if(u.user_type==='lead') await q.update(db.users,{_id:user_id},{$set:{user_type:'client'}}); // lead → klient
    await q.insert(db.notifications,{user_id,type:'membership',title:`Členstvo ${plan.name} aktivované ✅`,body:`Platné do ${expiresDate}`,read:false,created_at:nowISO()});
    createInvoice({user_id, client_name:u.name, client_email:u.email,
      items:[{desc:`Členstvo ${plan.name}`, qty:1, total:+(amount||plan.price)}], total:+(amount||plan.price),
      method:payment_method==='card'?'Karta na mieste':(payment_method||'Hotovosť')});
    awardPurchaseCommission({buyer_id:user_id, amount:+(amount||plan.price), product_name:`Členstvo ${plan.name}`});
    res.json({ok:true, plan_name:plan.name, expires_at:expiresDate});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Search users (for manual booking autocomplete)
app.get('/api/attendance/search-users', trainerAuth, async(req,res)=>{
  try {
    const {q:query} = req.query;
    if(!query||query.length<2) return res.json([]);
    const regex = new RegExp(query,'i');
    const users = await q.find(db.users,{active:{$ne:false},$or:[{name:regex},{email:regex}]});
    const parentNames = {};
    const out = [];
    for(const u of users.slice(0,10)){
      let parentName = null;
      if(u.is_child && u.parent_id){
        if(!(u.parent_id in parentNames)){ const p=await q.one(db.users,{_id:u.parent_id}); parentNames[u.parent_id]=p?p.name:null; }
        parentName = parentNames[u.parent_id];
      }
      out.push({id:u._id,name:u.name,email:u.is_child?'(dieťa)':u.email,phone:u.phone||'',visit_count:u.visit_count||0,single_entries:u.single_entries||0,free_credits:u.free_credits||0,is_child:!!u.is_child,parent_name:parentName});
    }
    res.json(out);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Admin: cancel a booking on behalf of user
app.delete('/api/attendance/booking/:id', trainerAuth, async(req,res)=>{
  try {
    const b = await q.one(db.bookings,{_id:req.params.id});
    if(!b) return res.status(404).json({error:'Rezervácia nenájdená'});
    await q.update(db.bookings,{_id:req.params.id},{$set:{status:'cancelled',cancelled_at:nowISO(),cancelled_by:req.trainerUser._id}});
    if(b.status==='confirmed') await promoteWaitlist(b.class_id, b.booking_date);
    sendBookingCancelEmail(b, true).catch(()=>{});
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── QR CHECK-IN ─────────────────────────────────────────────────────────────
// POST /api/attendance/qr-checkin  { qr_data: "FA:userId", class_id }
// Returns member info + books them into the class
app.post('/api/attendance/qr-checkin', trainerAuth, async(req,res)=>{
  try {
    const {qr_data, class_id} = req.body;
    if(!qr_data) return res.status(400).json({error:'Chýba QR kód'});
    // Parse userId from "FA:userId" format
    const userId = qr_data.startsWith('FA:') ? qr_data.slice(3) : qr_data;
    const u = await q.one(db.users,{_id:userId});
    if(!u) return res.status(404).json({error:'Člen nenájdený – neplatný QR kód'});
    const mem = u ? await checkMembership(u._id) : null;
    const userData = {
      id: u._id, name: u.name, email: u.email, phone: u.phone||'',
      visit_count: u.visit_count||0, free_class_used: u.free_class_used||false,
      single_entries: u.single_entries||0, free_credits: u.free_credits||0,
      membership: mem ? {plan:mem.plan_name, expires:mem.expires_at} : null,
    };
    // If class_id provided, book them in
    if(class_id){
      const cls = await q.one(db.classes,{_id:class_id});
      if(!cls) return res.json({ok:true, user:userData, booking:null, note:'Hodina nenájdená'});
      const bdate = nextDateForDay(cls.day_of_week);
      const exists = await q.one(db.bookings,{class_id,user_id:u._id,booking_date:bdate,status:{$ne:'cancelled'}});
      if(exists){
        // Mark physical attendance on the pre-existing booking
        await q.update(db.bookings,{_id:exists._id},{$set:{status:'attended',attended_at:nowISO(),attended_by:req.trainerUser._id}});
        if(!u.is_child) sendFirstClassEmail(u._id).catch(()=>{});
        return res.json({ok:true, user:userData, booking:{existing:true, attended:true, booking_date:bdate, class_name:cls.name}});
      }
      // Determine access type (first free class governed by free_class_used only)
      const hasMem = mem && mem.status === 'active';
      const hasFree = !u.free_class_used;
      const hasSingle = (u.single_entries||0) > 0;
      const hasCredit = (u.free_credits||0) > 0;
      if(!hasMem && !hasFree && !hasSingle && !hasCredit){
        return res.json({ok:false, user:userData, error:'membership_required', note:'Žiadne platné členstvo ani vstup'});
      }
      await q.insert(db.bookings,{
        class_id, class_name:cls.name, class_emoji:cls.emoji||'💃',
        class_location:cls.location, class_time_start:cls.time_start,
        day_of_week:cls.day_of_week, day_name:DAYS_SK[cls.day_of_week],
        user_id:u._id, user_name:u.name, user_email:u.email, user_phone:u.phone||'',
        booking_date:bdate, status:'attended', attended_at:nowISO(), attended_by:req.trainerUser._id,
        notes:'📱 QR check-in', manual:true, manual_by:req.trainerUser._id, created_at:nowISO()
      });
      const upd = {visit_count:(u.visit_count||0)+1};
      if(hasFree && !u.free_class_used) upd.free_class_used = true;
      else if(hasCredit && !hasMem) upd.free_credits = (u.free_credits||0) - 1;
      else if(hasSingle && !hasMem && !hasFree) upd.single_entries = (u.single_entries||0) - 1;
      applyLeadTrial(upd, u); // lead → automaticky „Bola na hodine"
      await q.update(db.users,{_id:u._id},{$set:upd});
      if(!u.is_child) sendFirstClassEmail(u._id).catch(()=>{});
      await q.insert(db.notifications,{user_id:u._id,type:'checkin',title:'✅ Check-in potvrdený',
        body:`${cls.name} – ${bdate} o ${cls.time_start}`,read:false,created_at:nowISO()});
      checkNewAchievements(u._id).catch(()=>{}); // nové odznaky (návštevy, mestá) + notif priateľom
      return res.json({ok:true, user:{...userData, visit_count:upd.visit_count},
        booking:{booking_date:bdate, class_name:cls.name, access_type: hasMem?'membership':hasFree?'free':hasCredit?'credit':'single'}});
    }
    // No class_id – just member lookup
    res.json({ok:true, user:userData});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// GET /api/me/qr – return QR payload for the logged-in user (or ?child_id= for a child)
app.get('/api/me/qr', auth, async(req,res)=>{
  try {
    if(req.query.child_id){
      const child = await q.one(db.users,{_id:req.query.child_id});
      if(!child || child.parent_id !== req.session.uid) return res.status(403).json({error:'Neplatný detský profil'});
      return res.json({qr_data:'FA:'+child._id, name:child.name});
    }
    const u = await q.one(db.users,{_id:req.session.uid});
    if(!u) return res.status(401).json({error:'Not logged in'});
    res.json({qr_data:'FA:'+u._id, name:u.name});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FAMILY ACCOUNTS – parent manages child profiles (no own login)
// ═══════════════════════════════════════════════════════════════════════════════
const MAX_CHILDREN = 6;

app.get('/api/family/children', auth, async(req,res)=>{
  try {
    const children = await q.find(db.users,{parent_id:req.session.uid, active:{$ne:false}},{created_at:1});
    const out = [];
    for(const c of children){
      const m = await checkMembership(c._id);
      const upcoming = await q.find(db.bookings,{user_id:c._id,status:'confirmed',booking_date:{$gte:today()}},{booking_date:1});
      out.push({
        id:c._id, name:c.name, birth_date:c.birth_date||null, birth_year:c.birth_year||null,
        visit_count:c.visit_count||0, single_entries:c.single_entries||0, free_credits:c.free_credits||0,
        free_class_used:c.free_class_used||false,
        membership: m ? {plan_name:m.plan_name, expires_at:m.expires_at, status:m.status||'active'} : null,
        upcoming: upcoming.slice(0,3),
      });
    }
    res.json(out);
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/family/children', auth, async(req,res)=>{
  try {
    const name = (req.body.name||'').trim();
    if(!name) return res.status(400).json({error:'Chýba meno dieťaťa'});
    // Full date of birth (YYYY-MM-DD); birth_year derived for display
    let birth_date = null, birth_year = null;
    if(req.body.birth_date){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(req.body.birth_date)) return res.status(400).json({error:'Neplatný dátum narodenia'});
      const dt = new Date(req.body.birth_date);
      const y = dt.getFullYear();
      if(isNaN(dt.getTime()) || y < 1990 || dt > new Date()) return res.status(400).json({error:'Neplatný dátum narodenia'});
      birth_date = req.body.birth_date; birth_year = y;
    } else if(req.body.birth_year){
      const y = +req.body.birth_year;
      if(y < 1990 || y > new Date().getFullYear()) return res.status(400).json({error:'Neplatný rok narodenia'});
      birth_year = y;
    }
    const count = await q.count(db.users,{parent_id:req.session.uid, active:{$ne:false}});
    if(count >= MAX_CHILDREN) return res.status(400).json({error:`Maximálne ${MAX_CHILDREN} detí na účet`});
    const token = Math.random().toString(36).slice(2,10);
    const internalEmail = 'child-'+token+'@internal.local';
    // Children get a unique (unused) referral_code to satisfy the unique index
    let childCode = 'CHILD-'+token.toUpperCase();
    while(await q.one(db.users,{referral_code:childCode})) childCode = 'CHILD-'+Math.random().toString(36).slice(2,10).toUpperCase();
    const child = await q.insert(db.users,{
      name, email:internalEmail, referral_code:childCode, parent_id:req.session.uid, is_child:true, birth_date, birth_year,
      user_type:'client', is_admin:false, active:true,
      visit_count:0, free_class_used:false, single_entries:0, free_credits:0, referral_credit:0,
      created_at:today()
    });
    res.json({ok:true, id:child._id, name:child.name});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.put('/api/family/children/:id', auth, async(req,res)=>{
  try {
    const child = await q.one(db.users,{_id:req.params.id});
    if(!child || child.parent_id !== req.session.uid) return res.status(403).json({error:'Neplatný detský profil'});
    const upd = {};
    if(req.body.name!==undefined){ const n=(req.body.name||'').trim(); if(!n) return res.status(400).json({error:'Chýba meno'}); upd.name=n; }
    if(req.body.birth_date!==undefined){
      if(req.body.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(req.body.birth_date)) return res.status(400).json({error:'Neplatný dátum narodenia'});
      upd.birth_date = req.body.birth_date || null;
      upd.birth_year = req.body.birth_date ? new Date(req.body.birth_date).getFullYear() : null;
    } else if(req.body.birth_year!==undefined) upd.birth_year = +req.body.birth_year || null;
    await q.update(db.users,{_id:child._id},{$set:upd});
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.delete('/api/family/children/:id', auth, async(req,res)=>{
  try {
    const child = await q.one(db.users,{_id:req.params.id});
    if(!child || child.parent_id !== req.session.uid) return res.status(403).json({error:'Neplatný detský profil'});
    // Soft-delete + cancel future bookings
    await q.update(db.users,{_id:child._id},{$set:{active:false}});
    const future = await q.find(db.bookings,{user_id:child._id,status:'confirmed',booking_date:{$gte:today()}});
    for(const b of future) await q.update(db.bookings,{_id:b._id},{$set:{status:'cancelled',cancelled_at:nowISO()}});
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL NOTIFICATIONS (Nodemailer – optional, falls back gracefully)
// ═══════════════════════════════════════════════════════════════════════════════
let mailer = null;
let resendApiKey = null;
let brevoApiKey = null;
(async()=>{
  try {
    // Prefer Brevo HTTP API if BREVO_API_KEY is set (works on Railway – HTTPS, no SMTP)
    if(process.env.BREVO_API_KEY){
      brevoApiKey = process.env.BREVO_API_KEY;
      console.log('✉️  Brevo API nakonfigurovaný');
      return;
    }
    // Resend HTTP API if RESEND_API_KEY is set
    if(process.env.RESEND_API_KEY){
      resendApiKey = process.env.RESEND_API_KEY;
      console.log('✉️  Resend API nakonfigurovaný');
      return;
    }
    const nodemailer = require('nodemailer');
    if(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS){
      mailer = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: +process.env.SMTP_PORT||587,
        secure: process.env.SMTP_SECURE==='true',
        auth: { user:process.env.SMTP_USER, pass:process.env.SMTP_PASS }
      });
      console.log('✉️  SMTP mailer nakonfigurovaný');
    }
  } catch(e){ /* nodemailer not installed – silent fallback */ }
})();

async function sendMail(to, subject, html){
  // Brevo HTTP API (preferred on Railway – HTTPS, no blocked SMTP ports)
  if(brevoApiKey){
    try {
      const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER || 'gruber.marek@gmail.com';
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method:'POST',
        headers:{'api-key':brevoApiKey,'Content-Type':'application/json'},
        body: JSON.stringify({
          sender:{ name:'Fusion Academy', email:fromAddr },
          to:[{ email:to }],
          subject, htmlContent:html
        })
      });
      const j = await r.json().catch(()=>({}));
      if(r.ok){ return true; }
      console.error('Brevo error:', JSON.stringify(j));
      return false;
    } catch(e){ console.error('Brevo error:', e.message); return false; }
  }
  // Resend HTTP API (preferred on Railway)
  if(resendApiKey){
    try {
      const fromAddr = process.env.SMTP_FROM || 'noreply@latindancefusion.art';
      const r = await fetch('https://api.resend.com/emails', {
        method:'POST',
        headers:{'Authorization':`Bearer ${resendApiKey}`,'Content-Type':'application/json'},
        body: JSON.stringify({ from:`Fusion Academy <${fromAddr}>`, to:[to], subject, html })
      });
      const j = await r.json();
      if(j.id){ return true; }
      console.error('Resend error:', JSON.stringify(j));
      return false;
    } catch(e){ console.error('Resend error:', e.message); return false; }
  }
  if(!mailer) return false;
  try {
    const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER;
    await mailer.sendMail({ from:`"Fusion Academy" <${fromAddr}>`, to, subject, html });
    return true;
  } catch(e){ console.error('Mail error:', e.message); return false; }
}

// Send booking confirmation email
app.post('/api/bookings', auth, async(req,res)=>{
  try {
    const {class_id, booking_date, notes, override_free, for_child_id}=req.body;
    if(!class_id) return res.status(400).json({error:'Chýba trieda'});
    const cls=await q.one(db.classes,{_id:class_id});
    if(!cls||!cls.active) return res.status(404).json({error:'Hodina nenájdená'});
    const parent=await q.one(db.users,{_id:req.session.uid});
    // ── Booking for a child profile? ────────────────────────────────────────────
    let target = parent;
    if(for_child_id){
      const child = await q.one(db.users,{_id:for_child_id});
      if(!child || child.parent_id !== req.session.uid || child.active===false)
        return res.status(403).json({error:'Neplatný detský profil'});
      target = child;
    }
    const isChild = target !== parent;
    const u = target; // gate + visit-count apply to the target (self or child)

    // ── Free-class / membership gate ───────────────────────────────────────────
    // Private lessons are never free (category check)
    const isPrivate = /súkromn/i.test(cls.name) || /súkromn/i.test(cls.category||'');
    const visitCount = u.visit_count || 0;
    // "First class free" is governed solely by free_class_used — the same flag the
    // client profile shows. Do NOT also gate on visit_count, or a client whose free
    // class is still available (flag false) but has visits from other paths gets
    // wrongly redirected to buy membership.
    if(!u.is_admin && u.user_type !== 'trainer'){
      if(u.free_class_used){
        // Not first visit – need membership or single entry credit
        const m = await checkMembership(u._id);
        const hasMembership = m && (m.status==='active') && (!m.expires_at || m.expires_at >= today());
        const singleEntries = u.single_entries || 0;
        const freeCredits = u.free_credits || 0;
        if(!hasMembership && singleEntries <= 0 && freeCredits <= 0){
          return res.status(402).json({
            error:'membership_required',
            message: isChild
              ? `Prvá hodina zadarmo pre ${u.name} bola využitá. Na ďalšiu potrebuje členstvo alebo jednorazový vstup (10 €).`
              : 'Prvá hodina zadarmo bola využitá. Na ďalšiu hodinu potrebuješ členstvo alebo jednorazový vstup (10 €).',
            visit_count: visitCount,
            free_class_used: !!u.free_class_used
          });
        }
        // Use free credit first, then single entry, then membership
        if(!hasMembership){
          if(freeCredits > 0){
            await q.update(db.users,{_id:u._id},{$set:{free_credits: freeCredits - 1}});
          } else if(singleEntries > 0){
            await q.update(db.users,{_id:u._id},{$set:{single_entries: singleEntries - 1}});
          }
        }
      }
    }

    const booked=await q.count(db.bookings,{class_id,status:{$ne:'cancelled'}});
    if(booked>=cls.capacity) return res.status(400).json({error:'Hodina je plne obsadená – skúste čakací zoznam'});
    const bdate=booking_date||nextDateForDay(cls.day_of_week);
    if(await q.one(db.class_cancellations,{class_id, date:bdate})) return res.status(400).json({error:'Táto hodina je zrušená a nedá sa rezervovať.'});
    const exists=await q.one(db.bookings,{class_id,user_id:u._id,booking_date:bdate,status:{$ne:'cancelled'}});
    if(exists) return res.status(400).json({error:isChild?`${u.name} je už na túto hodinu prihlásené`:'Na túto hodinu ste sa už prihlásili'});
    const booking=await q.insert(db.bookings,{
      class_id, class_name:cls.name, class_emoji:cls.emoji||'💃',
      class_location:cls.location, class_time_start:cls.time_start, class_time_end:cls.time_end,
      day_of_week:cls.day_of_week, day_name:DAYS_SK[cls.day_of_week],
      user_id:u._id, user_name:u.name, user_email:isChild?parent.email:u.email, user_phone:u.phone||parent.phone||'',
      booked_by:parent._id, booked_by_name:parent.name, is_child_booking:isChild, child_name:isChild?u.name:null,
      booking_date:bdate, status:'confirmed', notes:notes||'', created_at:nowISO()
    });
    // Increment visit count, mark free class used after first booking
    const newCount = (u.visit_count || 0) + 1;
    const userUpd = {visit_count: newCount};
    if(!u.free_class_used) userUpd.free_class_used = true;
    if(u.winback_sent) userUpd.winback_sent = false; // came back → allow a future win-back
    await q.update(db.users,{_id:u._id},{$set: userUpd});
    // Notifications + emails go to the parent (child has no login of its own)
    const notifUid = parent._id;
    const who = isChild ? `${u.name}: ` : '';
    await q.insert(db.notifications,{user_id:notifUid,type:'booking',title:`Rezervácia potvrdená ✅`,body:`${who}${cls.name} – ${bdate} o ${cls.time_start}`,read:false,created_at:nowISO()});
    // Check if a loyalty milestone was just crossed
    const milestone = LOYALTY_MILESTONES.find(m => m.visits === newCount);
    if (milestone) {
      await q.insert(db.notifications,{user_id:notifUid,type:'loyalty',title:`🏆 Nový odznak: ${milestone.label}`,body:`${who}Gratulujeme! ${newCount} návštev. ${milestone.reward ? 'Odmena: '+milestone.reward : ''}`,read:false,created_at:nowISO()});
      if(parent.email) sendMail(parent.email,`🏆 Nový odznak: ${milestone.label}`,`<h2>${milestone.badge} Gratulujeme, ${u.name}!</h2><p>Práve ${isChild?'dosiahlo dieťa':'si dosiahol'} míľnik: <b>${newCount} návštev</b> – ${milestone.label}!</p>${milestone.reward?`<p>🎁 Odmena: <b>${milestone.reward}</b></p>`:''}<p>Ďakujeme, že ste súčasťou Fusion Academy!</p><p><i>Fusion Academy tím 💃</i></p>`).catch(()=>{});
    }
    // NOTE: the thank-you + membership offer email is sent AFTER the client actually
    // attends their first class (see runDailyJobs → "Post-first-class follow-up"),
    // not here at booking time, so we don't thank them before they've been.
    // Send confirmation email
    if(parent.email) sendMail(parent.email,`Rezervácia potvrdená – ${cls.name}`,`<h2>Rezervácia potvrdená ✅</h2><p>Ahoj <b>${parent.name}</b>,</p><p>Rezervácia ${isChild?`pre <b>${u.name}</b> `:''}na hodinu <b>${cls.name}</b> bola úspešne zaznamenaná.</p><ul><li>Dátum: <b>${bdate}</b></li><li>Čas: <b>${cls.time_start}–${cls.time_end||''}</b></li><li>Miesto: <b>${cls.location}</b></li></ul><p>Tešíme sa na vás!</p><p><i>Fusion Academy</i></p>`).catch(()=>{});
    res.json({ok:true, id:booking._id, class_name:cls.name, booking_date:bdate, visit_count:newCount, for_child:isChild?u.name:null});
  } catch(e){res.status(500).json({error:e.message});}
});

// ═══════════════════════════════════════════════════════════════════════════════
// USER PROFILE — extended (membership status, notifications count)
// ═══════════════════════════════════════════════════════════════════════════════
// Slovenský kalendár menín (MM-DD → meno). Zdroj: štandardný SK kalendár.
const SK_NAMEDAYS = {
'01-01':'','01-02':'Alexandra','01-03':'Daniela','01-04':'Drahoslav','01-05':'Andrea','01-06':'Antónia','01-07':'Bohuslava','01-08':'Severín','01-09':'Alexej','01-10':'Dáša','01-11':'Malvína','01-12':'Ernest','01-13':'Rastislav','01-14':'Radovan','01-15':'Dobroslav','01-16':'Kristína','01-17':'Nataša','01-18':'Bohdana','01-19':'Drahomíra','01-20':'Dalibor','01-21':'Vincent','01-22':'Zora','01-23':'Miloš','01-24':'Timotej','01-25':'Gejza','01-26':'Tamara','01-27':'Bohuš','01-28':'Alfonz','01-29':'Gašpar','01-30':'Ema','01-31':'Emil',
'02-01':'Tatiana','02-02':'Erik','02-03':'Blažej','02-04':'Veronika','02-05':'Agáta','02-06':'Dorota','02-07':'Vanda','02-08':'Zoja','02-09':'Zdenko','02-10':'Gabriela','02-11':'Dezider','02-12':'Perla','02-13':'Arpád','02-14':'Valentín','02-15':'Pravoslav','02-16':'Ida','02-17':'Miloslava','02-18':'Jaromír','02-19':'Vlasta','02-20':'Lívia','02-21':'Eleonóra','02-22':'Etela','02-23':'Roman','02-24':'Matej','02-25':'Frederik','02-26':'Viktor','02-27':'Alexander','02-28':'Zlatica','02-29':'',
'03-01':'Albín','03-02':'Anežka','03-03':'Bohumil','03-04':'Kazimír','03-05':'Fridrich','03-06':'Radoslav','03-07':'Tomáš','03-08':'Alan','03-09':'Františka','03-10':'Branislav','03-11':'Angela','03-12':'Gregor','03-13':'Vlastimil','03-14':'Matilda','03-15':'Svetlana','03-16':'Boleslav','03-17':'Ľubica','03-18':'Eduard','03-19':'Jozef','03-20':'Víťazoslav','03-21':'Blahoslav','03-22':'Beňadik','03-23':'Adrián','03-24':'Gabriel','03-25':'Marián','03-26':'Emanuel','03-27':'Alena','03-28':'Soňa','03-29':'Miroslav','03-30':'Vieroslava','03-31':'Benjamín',
'04-01':'Hugo','04-02':'Zita','04-03':'Richard','04-04':'Izidor','04-05':'Miroslava','04-06':'Irena','04-07':'Zoltán','04-08':'Albert','04-09':'Milena','04-10':'Igor','04-11':'Július','04-12':'Estera','04-13':'Aleš','04-14':'Justína','04-15':'Fedor','04-16':'Dana','04-17':'Rudolf','04-18':'Valér','04-19':'Jela','04-20':'Marcel','04-21':'Ervín','04-22':'Slavomír','04-23':'Vojtech','04-24':'Juraj','04-25':'Marek','04-26':'Jaroslava','04-27':'Jaroslav','04-28':'Jarmila','04-29':'Lea','04-30':'Anastázia',
'05-01':'','05-02':'Žigmund','05-03':'Galina','05-04':'Florián','05-05':'Lesana','05-06':'Hermína','05-07':'Monika','05-08':'Ingrida','05-09':'Roland','05-10':'Viktória','05-11':'Blažena','05-12':'Pankrác','05-13':'Servác','05-14':'Bonifác','05-15':'Žofia','05-16':'Svetozár','05-17':'Gizela','05-18':'Viola','05-19':'Gertrúda','05-20':'Bernard','05-21':'Zina','05-22':'Júlia','05-23':'Želmíra','05-24':'Ela','05-25':'Urban','05-26':'Dušan','05-27':'Iveta','05-28':'Viliam','05-29':'Vilma','05-30':'Ferdinand','05-31':'Petronela',
'06-01':'Žaneta','06-02':'Xénia','06-03':'Karolína','06-04':'Lenka','06-05':'Laura','06-06':'Norbert','06-07':'Róbert','06-08':'Medard','06-09':'Stanislava','06-10':'Margaréta','06-11':'Dobroslava','06-12':'Zlatko','06-13':'Anton','06-14':'Vasil','06-15':'Vít','06-16':'Blanka','06-17':'Adolf','06-18':'Vratislav','06-19':'Alfréd','06-20':'Valéria','06-21':'Alojz','06-22':'Paulína','06-23':'Sidónia','06-24':'Ján','06-25':'Tadeáš','06-26':'Adriána','06-27':'Ladislav','06-28':'Beáta','06-29':'Peter a Pavol','06-30':'Melánia',
'07-01':'Diana','07-02':'Berta','07-03':'Miloslav','07-04':'Prokop','07-05':'Cyril a Metod','07-06':'Patrik','07-07':'Oliver','07-08':'Ivan','07-09':'Lujza','07-10':'Amália','07-11':'Milota','07-12':'Nina','07-13':'Margita','07-14':'Kamil','07-15':'Henrich','07-16':'Drahomír','07-17':'Bohuslav','07-18':'Kamila','07-19':'Dušana','07-20':'Iľja','07-21':'Daniel','07-22':'Magdaléna','07-23':'Oľga','07-24':'Vladimír','07-25':'Jakub','07-26':'Anna','07-27':'Božena','07-28':'Krištof','07-29':'Marta','07-30':'Libuša','07-31':'Ignác',
'08-01':'Božidara','08-02':'Gustáv','08-03':'Jerguš','08-04':'Dominik','08-05':'Hortenzia','08-06':'Jozefína','08-07':'Štefánia','08-08':'Oskar','08-09':'Ľubomíra','08-10':'Vavrinec','08-11':'Zuzana','08-12':'Darina','08-13':'Ľubomír','08-14':'Mojmír','08-15':'Marcela','08-16':'Leonard','08-17':'Milica','08-18':'Elena','08-19':'Lýdia','08-20':'Anabela','08-21':'Jana','08-22':'Tichomír','08-23':'Filip','08-24':'Bartolomej','08-25':'Ľudovít','08-26':'Samuel','08-27':'Silvia','08-28':'Augustín','08-29':'Nikola','08-30':'Ružena','08-31':'Nora',
'09-01':'Drahoslava','09-02':'Linda','09-03':'Belo','09-04':'Rozália','09-05':'Regina','09-06':'Alica','09-07':'Marianna','09-08':'Miriam','09-09':'Martina','09-10':'Oleg','09-11':'Bystrík','09-12':'Mária','09-13':'Ctibor','09-14':'Ľudomil','09-15':'Jolana','09-16':'Ľudmila','09-17':'Olympia','09-18':'Eugénia','09-19':'Konštantín','09-20':'Ľuboslav','09-21':'Matúš','09-22':'Móric','09-23':'Zdenka','09-24':'Ľuboš','09-25':'Vladislav','09-26':'Edita','09-27':'Cyprián','09-28':'Václav','09-29':'Michal','09-30':'Jarolím',
'10-01':'Arnold','10-02':'Levoslav','10-03':'Stela','10-04':'František','10-05':'Viera','10-06':'Natália','10-07':'Eliška','10-08':'Brigita','10-09':'Dionýz','10-10':'Slavomíra','10-11':'Valentína','10-12':'Maximilián','10-13':'Koloman','10-14':'Boris','10-15':'Terézia','10-16':'Vladimíra','10-17':'Hedviga','10-18':'Lukáš','10-19':'Kristián','10-20':'Vendelín','10-21':'Uršuľa','10-22':'Sergej','10-23':'Alojzia','10-24':'Kvetoslava','10-25':'Aurel','10-26':'Demeter','10-27':'Sabína','10-28':'Dobromila','10-29':'Klára','10-30':'Šimon','10-31':'Aurélia',
'11-01':'Denisa','11-02':'','11-03':'Hubert','11-04':'Karol','11-05':'Imrich','11-06':'Renáta','11-07':'René','11-08':'Bohumír','11-09':'Teodor','11-10':'Tibor','11-11':'Martin','11-12':'Svätopluk','11-13':'Stanislav','11-14':'Irma','11-15':'Leopold','11-16':'Agnesa','11-17':'Klaudia','11-18':'Eugen','11-19':'Alžbeta','11-20':'Félix','11-21':'Elvíra','11-22':'Cecília','11-23':'Klement','11-24':'Emília','11-25':'Katarína','11-26':'Kornel','11-27':'Milan','11-28':'Henrieta','11-29':'Vratko','11-30':'Ondrej',
'12-01':'Edmund','12-02':'Bibiána','12-03':'Oldrich','12-04':'Barbora','12-05':'Oto','12-06':'Mikuláš','12-07':'Ambróz','12-08':'Marína','12-09':'Izabela','12-10':'Radúz','12-11':'Hilda','12-12':'Otília','12-13':'Lucia','12-14':'Branislava','12-15':'Ivica','12-16':'Albína','12-17':'Kornélia','12-18':'Sláva','12-19':'Judita','12-20':'Dagmara','12-21':'Bohdan','12-22':'Adela','12-23':'Nadežda','12-24':'Adam a Eva','12-25':'','12-26':'Štefan','12-27':'Filoména','12-28':'Ivana','12-29':'Milada','12-30':'Dávid','12-31':'Silvester'
};
const firstName = full => (full||'').trim().split(/\s+/)[0];
const stripDia = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();

// ── Bodový systém „Klient mesiaca" ────────────────────────────────────────────
// 5 b za odchodenú hodinu (aj online), 5 b za privedeného člena, 10 b za aktívne
// členstvo. Za príspevky/správy v komunite ZÁMERNE žiadne body (dá sa zneužiť).
// 5 b hodina, 5 b privedený člen (registrácia), 10 b aktívne členstvo,
// 30/15/10/5/5 b za nového PLATIACEHO člena v 1.–5. línii, 15 b za kus merchu.
const MP_WEIGHTS = { hour:5, referral:5, membership:10, newMemberLine:[30,15,10,5,5], merch:15, merchLine:[10,5,3,2,1] };
// Body za merch, ktorý si kúpil niekto v mojej štruktúre (po líniách 1..5).
// merchMap: user_id → počet kusov merchu v období. Vlastné kusy sa nerátajú (tie má buyer sám).
function merchDownlinePointsFor(userId, adjacency, merchMap){
  let points=0, count=0;
  let frontier=[userId]; const seen=new Set([userId]);
  for(let line=0; line<MP_WEIGHTS.merchLine.length; line++){
    const next=[];
    for(const pid of frontier){ for(const cid of (adjacency[pid]||[])){ if(seen.has(cid)) continue; seen.add(cid); next.push(cid);
      const kusy=merchMap[cid]||0; if(kusy>0){ count+=kusy; points+=kusy*MP_WEIGHTS.merchLine[line]; } } }
    frontier=next;
  }
  return { count, points };
}
// Členovia v štruktúre, ktorí si kúpili členstvo v danom období — body po líniách
function newMemberPointsFor(userId, adjacency, buyerSet){
  let points=0, count=0;
  let frontier=[userId]; const seen=new Set([userId]);
  for(let line=0; line<MP_WEIGHTS.newMemberLine.length; line++){
    const next=[];
    for(const pid of frontier){ for(const cid of (adjacency[pid]||[])){ if(seen.has(cid)) continue; seen.add(cid); next.push(cid);
      if(buyerSet.has(cid)){ count++; points+=MP_WEIGHTS.newMemberLine[line]; } } }
    frontier=next;
  }
  return { count, points };
}
// Set: kto si kúpil (platené) členstvo v danom období (prefix YYYY-MM alebo YYYY)
async function membershipBuyersInPeriod(prefix){
  const set=new Set();
  (await q.find(db.memberships,{})).forEach(m=>{
    const plan=MEMBERSHIP_PLANS[m.plan_id]; if(plan && plan.type==='bundle') return;
    const d=(m.started_at||m.start_date||m.created_at||'').slice(0,10);
    if((d||'').startsWith(prefix) && (+m.price>0 || m.payment_method || m.status)) set.add(m.user_id);
  });
  return set;
}
// Merch = oblečenie/doplnky (podľa názvu produktu, kategórie sa líšia)
const MERCH_RE = /trič|tielk|mikin|legg|taš|fľaš|flaš|merch|oblečen|obleč|doplnk|čiapk|šatk|ponožk|termosk|nákrčn/i;
const isMerchItem = it => MERCH_RE.test(it.product_name||'') || /obleč|merch/i.test(it.cat||'');
// Mapa user_id → počet kusov zakúpeného merchu v období
async function merchCountMapInPeriod(prefix){
  const emailToId={}; (await q.find(db.users,{})).forEach(u=>{ if(u.email) emailToId[u.email.toLowerCase()]=u._id; });
  const map={};
  (await q.find(db.orders,{})).filter(o=>o.status==='paid').forEach(o=>{
    const d=(o.paid_at||o.created_at||'').slice(0,10); if(!(d||'').startsWith(prefix)) return;
    const uid=emailToId[(o.client_email||'').toLowerCase()]; if(!uid) return;
    (o.items||[]).forEach(it=>{ if(isMerchItem(it)) map[uid]=(map[uid]||0)+(+it.qty||1); });
  });
  return map;
}
// Rozpis bodov jedného používateľa za daný mesiac (YYYY-MM)
async function monthlyPointsFor(userId, month){
  month = month || today().slice(0,7);
  const bks = await q.find(db.bookings,{user_id:userId});
  const inMonth = b => { const d=b.booking_date||(b.created_at||'').slice(0,10); return (d||'').startsWith(month) && ['attended','confirmed'].includes(b.status); };
  const attended = bks.filter(inMonth);
  const isOnline = b => /online/i.test(b.class_name||'') || /online/i.test(b.class_location||'') || b.online===true;
  const online = attended.filter(isOnline).length;
  const hours = attended.length - online;
  const refs = (await q.find(db.users,{sponsor_id:userId})).filter(u=>(u.created_at||'').startsWith(month)).length;
  const m = await checkMembership(userId);
  const hasMem = !!(m && (m.status==='active') && (!m.expires_at || m.expires_at>=today()));
  // noví platiaci členovia (po líniách) + merch
  const adjacency={}; (await q.find(db.users,{})).forEach(u=>{ if(u.sponsor_id) (adjacency[u.sponsor_id]=adjacency[u.sponsor_id]||[]).push(u._id); });
  const nm = newMemberPointsFor(userId, adjacency, await membershipBuyersInPeriod(month));
  const merchMap = await merchCountMapInPeriod(month);
  const merchCount = merchMap[userId]||0;
  const md = merchDownlinePointsFor(userId, adjacency, merchMap);
  return buildPointItems({hours, online, refs, hasMem, memName:hasMem?(MEMBERSHIP_PLANS[m.plan_id]?.name||m.plan_name||'Členstvo'):null, newMemberCount:nm.count, newMemberPoints:nm.points, merchCount, merchLineCount:md.count, merchLinePoints:md.points}, month);
}
function buildPointItems({hours, online, refs, hasMem, memName, newMemberCount, newMemberPoints, merchCount, merchLineCount, merchLinePoints}, month){
  online = online||0; newMemberCount=newMemberCount||0; newMemberPoints=newMemberPoints||0; merchCount=merchCount||0;
  merchLineCount=merchLineCount||0; merchLinePoints=merchLinePoints||0;
  const plur=(n,a,b,c)=> n===1?a : (n>=2&&n<=4?b:c);
  const items = [
    { icon:'🔥', label:'Odchodené hodiny',        count:hours,  per:MP_WEIGHTS.hour,     points:hours*MP_WEIGHTS.hour,     sub:`${hours} ${plur(hours,'hodina','hodiny','hodín')}` },
    { icon:'💻', label:'Online hodiny',            count:online, per:MP_WEIGHTS.hour,     points:online*MP_WEIGHTS.hour,    sub:`${online} ${plur(online,'hodina','hodiny','hodín')}` },
    { icon:'🤝', label:'Privedení noví členovia',  count:refs,   per:MP_WEIGHTS.referral, points:refs*MP_WEIGHTS.referral,   sub:`${refs} ${plur(refs,'člen','členovia','členov')}` },
    { icon:'🏅', label:'Noví platiaci členovia (aj v hĺbke)', count:newMemberCount, points:newMemberPoints, sub:`${newMemberCount} ${plur(newMemberCount,'člen','členovia','členov')}` },
    { icon:'🛍️', label:'Zakúpený merch',          count:merchCount, per:MP_WEIGHTS.merch, points:merchCount*MP_WEIGHTS.merch, sub:`${merchCount} ${plur(merchCount,'kus','kusy','kusov')}` },
    { icon:'🛒', label:'Merch v mojom tíme (aj v hĺbke)', count:merchLineCount, points:merchLinePoints, sub:`${merchLineCount} ${plur(merchLineCount,'kus','kusy','kusov')}` },
    { icon:'💛', label: hasMem?('Aktívne členstvo'+(memName?' ('+memName+')':'')):'Aktívne členstvo', count: hasMem?1:0, per:MP_WEIGHTS.membership, points: hasMem?MP_WEIGHTS.membership:0, sub: hasMem?'aktívne':'—' },
  ];
  const total = items.reduce((s,i)=>s+i.points,0);
  return { month, total, items };
}

// Spotlight for the client dashboard: klient mesiaca + narodeniny + meniny (bez anonymných)
app.get('/api/client/spotlight', auth, async(req,res)=>{
  try {
    const now = new Date();
    const monthStr = today().slice(0,7);
    const mmdd = today().slice(5); // MM-DD
    const users = (await q.find(db.users,{is_admin:{$ne:true}}))
      .filter(u=>u.user_type!=='trainer' && !u.is_child && !u.anonymous && !(u.imported && !u.claimed));
    const uName = Object.fromEntries(users.map(u=>[u._id,u]));

    const yearStr = today().slice(0,4);
    const allUsers = await q.find(db.users,{});
    const bookings = await q.find(db.bookings,{});
    const activeMems = await q.find(db.memberships,{status:'active'});
    const memActive = {}, memName = {};
    activeMems.forEach(m=>{ if(!m.expires_at || m.expires_at>=today()){ memActive[m.user_id]=true; memName[m.user_id]=MEMBERSHIP_PLANS[m.plan_id]?.name||m.plan_name||'Členstvo'; } });

    const adjacency={}; allUsers.forEach(u=>{ if(u.sponsor_id) (adjacency[u.sponsor_id]=adjacency[u.sponsor_id]||[]).push(u._id); });
    // Víťaz za dané obdobie (prefix YYYY-MM alebo YYYY)
    const winnerFor = async (prefix)=>{
      const refCount={}; allUsers.forEach(u=>{ if((u.created_at||'').startsWith(prefix) && u.sponsor_id) refCount[u.sponsor_id]=(refCount[u.sponsor_id]||0)+1; });
      const attCount={}, onlineCount={};
      bookings.forEach(b=>{ const d=b.booking_date||(b.created_at||'').slice(0,10);
        if((d||'').startsWith(prefix) && ['attended','confirmed'].includes(b.status) && b.user_id){
          const on=/online/i.test(b.class_name||'')||/online/i.test(b.class_location||'')||b.online===true;
          if(on) onlineCount[b.user_id]=(onlineCount[b.user_id]||0)+1; else attCount[b.user_id]=(attCount[b.user_id]||0)+1;
        } });
      const buyerSet=await membershipBuyersInPeriod(prefix);
      const merchMap=await merchCountMapInPeriod(prefix);
      const ranked=[];
      for(const u of users){
        const nm=newMemberPointsFor(u._id, adjacency, buyerSet);
        const md=merchDownlinePointsFor(u._id, adjacency, merchMap);
        const bd=buildPointItems({ hours:attCount[u._id]||0, online:onlineCount[u._id]||0, refs:refCount[u._id]||0, hasMem:!!memActive[u._id], memName:memName[u._id]||null, newMemberCount:nm.count, newMemberPoints:nm.points, merchCount:merchMap[u._id]||0, merchLineCount:md.count, merchLinePoints:md.points }, prefix);
        if(bd.total>0) ranked.push({ id:u._id, name:u.name, avatar:u.avatar||null, refs:refCount[u._id]||0, hours:attCount[u._id]||0, score:bd.total, points:bd.total, breakdown:bd.items, badge:getMemberBadge(u.created_at) });
      }
      ranked.sort((a,b)=>b.points-a.points);
      return ranked;
    };
    const rankedMonth = await winnerFor(monthStr);
    const rankedYear  = await winnerFor(yearStr);
    const winner = rankedMonth[0]||null;
    const winnerYear = rankedYear[0]||null;
    const rewardsCfg = (await q.one(db.settings,{key:'rewards'}))?.value || {};

    // birthdays & namedays today (non-anonymous)
    const todayName = SK_NAMEDAYS[mmdd] || '';
    const nameTargets = todayName ? todayName.split(/\s+a\s+|,\s*/).map(stripDia).filter(Boolean) : [];
    const birthdays=[], namedays=[];
    for(const u of users){
      if(u.birthday && u.birthday.slice(5)===mmdd) birthdays.push({name:u.name, avatar:u.avatar||null});
      const fn = stripDia(firstName(u.name));
      if(fn && nameTargets.includes(fn)) namedays.push({name:u.name, avatar:u.avatar||null});
    }
    const slim = w => ({ id:w.id, name:w.name, avatar:w.avatar, points:w.points, breakdown:w.breakdown, badge:w.badge });
    res.json({ month: monthStr, year: yearStr, today_nameday: todayName,
      clientOfMonth: winner, clientOfYear: winnerYear,
      topMonth: rankedMonth.slice(0,5).map(slim), topYear: rankedYear.slice(0,5).map(slim),
      rewards: { year_end: rewardsCfg.year_end||'', disclaimer: rewardsCfg.disclaimer||'',
        month_prizes: rewardsCfg.month_prizes||[], year_prizes: rewardsCfg.year_prizes||[] },
      birthdays, namedays,
      me_anonymous: !!(await q.one(db.users,{_id:req.session.uid}))?.anonymous });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Ceny za klientku mesiaca/roka — admin nastaví, klientky vidia
app.get('/api/admin/rewards', adminAuth, async(req,res)=>{
  const cfg=(await q.one(db.settings,{key:'rewards'}))?.value || {};
  res.json({ ok:true, year_end:cfg.year_end||'', disclaimer:cfg.disclaimer||'',
    month_prizes:cfg.month_prizes||[], year_prizes:cfg.year_prizes||[] });
});
app.put('/api/admin/rewards', adminAuth, async(req,res)=>{
  try {
    const toList=v=>Array.isArray(v)?v.map(x=>String(x).slice(0,200)).filter(Boolean):String(v||'').split('\n').map(s=>s.trim()).filter(Boolean).slice(0,20);
    const value={ year_end:String(req.body.year_end||'').slice(0,40), disclaimer:String(req.body.disclaimer||'').slice(0,300),
      month_prizes:toList(req.body.month_prizes), year_prizes:toList(req.body.year_prizes) };
    const ex=await q.one(db.settings,{key:'rewards'});
    if(ex) await q.update(db.settings,{key:'rewards'},{$set:{value, updated_at:nowISO()}});
    else await q.insert(db.settings,{key:'rewards', value, created_at:nowISO()});
    res.json({ ok:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// História víťaziek — klientka mesiaca (posl. 12 mes.) a klientka roka (posl. roky)
app.get('/api/client/winners-history', auth, async(req,res)=>{
  try {
    const users = (await q.find(db.users,{is_admin:{$ne:true}}))
      .filter(u=>u.user_type!=='trainer' && !u.is_child && !u.anonymous && !(u.imported && !u.claimed));
    const allUsers = await q.find(db.users,{});
    const bookings = await q.find(db.bookings,{});
    const activeMems = await q.find(db.memberships,{status:'active'});
    const memActive={}, memName={};
    activeMems.forEach(m=>{ if(!m.expires_at||m.expires_at>=today()){ memActive[m.user_id]=true; memName[m.user_id]=MEMBERSHIP_PLANS[m.plan_id]?.name||m.plan_name||'Členstvo'; } });
    const adjacency={}; allUsers.forEach(u=>{ if(u.sponsor_id) (adjacency[u.sponsor_id]=adjacency[u.sponsor_id]||[]).push(u._id); });
    const winnerFor=async (prefix)=>{
      const refCount={}; allUsers.forEach(u=>{ if((u.created_at||'').startsWith(prefix) && u.sponsor_id) refCount[u.sponsor_id]=(refCount[u.sponsor_id]||0)+1; });
      const attCount={}, onlineCount={};
      bookings.forEach(b=>{ const d=b.booking_date||(b.created_at||'').slice(0,10);
        if((d||'').startsWith(prefix) && ['attended','confirmed'].includes(b.status) && b.user_id){
          const on=/online/i.test(b.class_name||'')||/online/i.test(b.class_location||'')||b.online===true;
          if(on) onlineCount[b.user_id]=(onlineCount[b.user_id]||0)+1; else attCount[b.user_id]=(attCount[b.user_id]||0)+1;
        } });
      const buyerSet=await membershipBuyersInPeriod(prefix); const merchMap=await merchCountMapInPeriod(prefix);
      let w=null, best=-1;
      for(const u of users){ const nm=newMemberPointsFor(u._id, adjacency, buyerSet);
        const md=merchDownlinePointsFor(u._id, adjacency, merchMap);
        const bd=buildPointItems({ hours:attCount[u._id]||0, online:onlineCount[u._id]||0, refs:refCount[u._id]||0, hasMem:!!memActive[u._id], memName:memName[u._id]||null, newMemberCount:nm.count, newMemberPoints:nm.points, merchCount:merchMap[u._id]||0, merchLineCount:md.count, merchLinePoints:md.points }, prefix);
        if(bd.total>0 && bd.total>best){ best=bd.total; w={ id:u._id, name:u.name, avatar:u.avatar||null, points:bd.total }; } }
      return w;
    };
    const SKM=['január','február','marec','apríl','máj','jún','júl','august','september','október','november','december'];
    // Súťaž štartuje júl 2026 — víťazka mesiaca sa vyhlási 1. deň nasledujúceho
    // mesiaca, víťazka roka 1. januára. História = len UKONČENÉ (vyhlásené) obdobia.
    const COMP_START='2026-07'; const COMP_START_Y=2026;
    const now=new Date(); const curMonth=today().slice(0,7); const curYear=now.getFullYear();
    const months=[], years=[];
    // ukončené mesiace: od COMP_START po predošlý mesiac (vrátane)
    for(let i=1;i<=12;i++){ const d=new Date(now.getFullYear(),now.getMonth()-i,1); const p=d.toISOString().slice(0,7);
      if(p<COMP_START || p>=curMonth) continue; const w=await winnerFor(p); if(w) months.push({period:p, label:SKM[d.getMonth()]+' '+d.getFullYear(), name:w.name, id:w.id, avatar:w.avatar, points:w.points}); }
    // ukončené roky: od COMP_START_Y po predošlý rok (vyhlásenie 1.1.)
    for(let y=curYear-1; y>=COMP_START_Y; y--){ const w=await winnerFor(String(y)); if(w) years.push({period:String(y), label:String(y), name:w.name, id:w.id, avatar:w.avatar, points:w.points}); }
    const SKMG=['januára','februára','marca','apríla','mája','júna','júla','augusta','septembra','októbra','novembra','decembra'];
    res.json({ ok:true, months, years,
      next_month_announce:'1. '+(SKMG[now.getMonth()===11?0:now.getMonth()+1])+' '+(now.getMonth()===11?curYear+1:curYear),
      next_year_announce:'1. januára '+(curYear+1) });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/me', async(req,res)=>{
  if(!req.session?.uid) return res.json({});
  const u = await q.one(db.users,{_id:req.session.uid});
  if(!u) return res.json({});
  const m = await checkMembership(req.session.uid);
  const notifCount = await q.count(db.notifications,{user_id:req.session.uid,read:false});
  const loyalty = getLoyaltyStatus(u.visit_count || 0);
  const role = USER_ROLES[u.user_type] || USER_ROLES.client;
  res.json({
    id:u._id, name:u.name, email:u.email, phone:u.phone||'', is_admin:u.is_admin,
    user_type:u.user_type||'partner', referral_code:u.referral_code,
    is_assistant: !!u.is_assistant, assistant_of: u.assistant_of||null,
    membership: m ? {plan_id:m.plan_id,plan_name:m.plan_name,expires_at:m.expires_at,status:m.status||'active'} : null,
    notif_count: notifCount, loyalty, visit_count: u.visit_count||0,
    free_class_used: u.free_class_used||false,
    single_entries: u.single_entries||0,
    free_credits: u.free_credits||0,
    referral_credit: u.referral_credit||0,
    offers_optout: !!u.offers_optout,
    role_label: role.label, role_icon: role.icon, dash_url: role.dashUrl,
    created_at: u.created_at, avatar: u.avatar||null,
    birthday: u.birthday||'', anonymous: !!u.anonymous,
    stripe_subscription: !!u.stripe_subscription_id, paypal_subscription: !!u.paypal_subscription_id,
  });
});

// Upload / update profile photo (client-resized JPEG data URL, ~256px)
app.post('/api/client/avatar', auth, async(req,res)=>{
  try {
    const { avatar } = req.body;
    if(!avatar || typeof avatar!=='string' || !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(avatar))
      return res.status(400).json({error:'Neplatný obrázok'});
    if(avatar.length > 600000) return res.status(400).json({error:'Obrázok je príliš veľký'});
    await q.update(db.users,{_id:req.session.uid},{$set:{avatar}});
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── Referral reward tiers (configurable) ────────────────────────────────────
const REFERRAL_REWARDS = [
  { referrals:1,   reward:'Titul „Ambasádorka" pri mene',                    badge:'🤝' },
  { referrals:3,   reward:'Titul „Rozsievačka radosti" + bronzové pozadie',  badge:'🌱' },
  { referrals:5,   reward:'Titul „Inšpirácia" + strieborné pozadie profilu', badge:'🌸' },
  { referrals:10,  reward:'Titul „Duša komunity" + zlaté pozadie profilu',   badge:'💫' },
  { referrals:20,  reward:'Titul „Srdce komunity" + legendárne pozadie',     badge:'👑' },
  { referrals:30,  reward:'Titul „Žiarivá hviezda" + žiariace meno',         badge:'🌟' },
  { referrals:50,  reward:'Titul „Klenot komunity" + exkluzívny odznak',     badge:'💎' },
  { referrals:75,   reward:'Titul „Anjel komunity"',                          badge:'🕊️' },
  { referrals:100,  reward:'Titul „Kráľovná Fusion"',                          badge:'👸' },
  { referrals:250,  reward:'Titul „Motýľ premeny"',                            badge:'🦋' },
  { referrals:500,  reward:'Titul „Superhviezda"',                             badge:'🌟' },
  { referrals:1000, reward:'Titul „Diamantová kráľovná"',                      badge:'💠' },
  { referrals:2500, reward:'Titul „Šampiónka sŕdc"',                           badge:'🏆' },
  { referrals:5000, reward:'Titul „Živel radosti"',                           badge:'🌈' },
  { referrals:10000,reward:'Titul „SKY IS THE LIMIT" — absolútna méta',        badge:'🚀' },
];

// ─── Client profile (detailed) ────────────────────────────────────────────────
app.get('/api/client/profile', auth, async(req,res)=>{
  try {
    const u = await q.one(db.users,{_id:req.session.uid});
    if(!u) return res.status(404).json({error:'Nenájdený'});
    const m = await checkMembership(req.session.uid);
    const loyalty = getLoyaltyStatus(u.visit_count || 0);
    const upcoming = await q.find(db.bookings,{user_id:u._id,status:'confirmed',booking_date:{$gte:today()}},{booking_date:1});
    const notifCount = await q.count(db.notifications,{user_id:u._id,read:false});
    res.json({
      id:u._id, name:u.name, email:u.email, phone:u.phone||'',
      user_type:u.user_type||'lead', created_at:u.created_at,
      membership: m ? {plan_id:m.plan_id,plan_name:m.plan_name,expires_at:m.expires_at,status:m.status||'active'} : null,
      loyalty, visit_count: u.visit_count||0,
      upcoming_bookings: upcoming.slice(0,5),
      notif_count: notifCount,
      milestones: LOYALTY_MILESTONES,
    });
  } catch(e){res.status(500).json({error:e.message});}
});

// ─── Referral stats ───────────────────────────────────────────────────────────
// Client's downline network: 5 lines with each member's membership + earnings & rate per line
app.get('/api/client/network', auth, async(req,res)=>{
  try {
    const me=req.session.uid;
    const allU=await q.find(db.users,{});
    const membs=(await q.find(db.memberships,{})).filter(m=>!m._type);
    const now=new Date().toISOString();
    const activeMemb={};
    membs.forEach(m=>{ if((m.expires_at||'')>now) activeMemb[m.user_id]=m.plan_name; });
    const lines=[[],[],[],[],[]];
    let frontier=[me]; const seen=new Set([me]);
    for(let line=0; line<5; line++){
      const next=[];
      for(const pid of frontier){
        for(const k of allU.filter(u=>u.sponsor_id===pid && !u.is_admin && u.user_type!=='trainer' && !u.is_child)){
          if(seen.has(k._id)) continue; seen.add(k._id);
          lines[line].push({ id:k._id, name:k.anonymous?'Člen (skrytý)':k.name, anonymous:!!k.anonymous,
            joined:(k.created_at||'').slice(0,10), membership:activeMemb[k._id]||null });
          next.push(k._id);
        }
      }
      frontier=next;
    }
    const myComms=await q.find(db.commissions,{partner_id:me});
    const earned=[0,0,0,0,0], pending=[0,0,0,0,0];
    myComms.forEach(c=>{ const l=c.level||0; if(l<5){ if(c.status==='paid') earned[l]+=(+c.amount||0); else pending[l]+=(+c.amount||0); } });
    res.json({
      lines: lines.map((members,i)=>({ line:i+1, rate:LINE_RATES[i], count:members.length,
        earned:+earned[i].toFixed(2), pending:+pending[i].toFixed(2), members })),
      total_people: lines.reduce((s,l)=>s+l.length,0)
    });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/client/referral', auth, async(req,res)=>{
  try {
    const u = await q.one(db.users,{_id:req.session.uid});
    if(!u) return res.status(404).json({error:'Nenájdený'});
    // Direct invites + total structure (rewards count everyone in the downline)
    const directCount = await referralCountOf(u._id);
    const refCount = await downlineCountOf(u._id);
    // How much earned from referral commissions
    const comms = await q.find(db.commissions,{partner_id:u._id});
    const earned = comms.reduce((s,c)=>s+(c.amount||0),0);
    const pendingEarned = comms.filter(c=>c.status==='pending').reduce((s,c)=>s+(c.amount||0),0);
    const paidEarned = comms.filter(c=>c.status==='paid').reduce((s,c)=>s+(c.amount||0),0);
    // Find current + next referral reward tier
    let currentTier = null, nextTier = null;
    for(const t of REFERRAL_REWARDS) {
      if(refCount >= t.referrals) currentTier = t;
      else { nextTier = t; break; }
    }
    const refLink = APP_URL + '/r/' + (u.referral_code||'');
    res.json({
      referral_code: u.referral_code,
      ref_link: refLink,
      ref_count: refCount,
      direct_count: directCount,
      earned_total: +earned.toFixed(2),
      earned_pending: +pendingEarned.toFixed(2),
      earned_paid: +paidEarned.toFixed(2),
      referral_credit: u.referral_credit||0,
      // Jeden spoločný „dostupný kredit" = referral kredit + čakajúce provízie
      available_credit: +((u.referral_credit||0) + pendingEarned).toFixed(2),
      current_tier: currentTier,
      next_tier: nextTier,
      all_tiers: REFERRAL_REWARDS,
    });
  } catch(e){res.status(500).json({error:e.message});}
});

// ─── Income history from the whole structure — zoskupenie deň/mesiac/rok/celkovo ─
app.get('/api/client/earnings-history', auth, async(req,res)=>{
  try {
    const group = ['day','month','year','all'].includes(req.query.group) ? req.query.group : 'month';
    const comms = await q.find(db.commissions,{partner_id:req.session.uid});
    const keyOf = c => {
      const iso = c.created_at || (c.month?c.month+'-01':'');
      const d = (iso||'').slice(0,10);
      if(group==='day') return d;                       // YYYY-MM-DD
      if(group==='year') return d.slice(0,4);           // YYYY
      if(group==='all') return 'all';
      return c.month || d.slice(0,7);                    // YYYY-MM
    };
    const buckets = {};
    for(const c of comms){
      const k = keyOf(c); if(!k) continue;
      if(!buckets[k]) buckets[k] = { period:k, total:0, paid:0, pending:0, lines:[0,0,0,0,0], count:0 };
      const b = buckets[k]; const amt = c.amount||0;
      b.total += amt; b.count++;
      if(c.status==='paid') b.paid += amt; else b.pending += amt;
      const lv = (typeof c.level==='number' && c.level>=0 && c.level<5) ? c.level : 0;
      b.lines[lv] += amt;
    }
    const rows = Object.values(buckets)
      .map(b=>({ ...b, month:b.period, total:+b.total.toFixed(2), paid:+b.paid.toFixed(2), pending:+b.pending.toFixed(2), lines:b.lines.map(x=>+x.toFixed(2)) }))
      .sort((a,b)=>String(b.period).localeCompare(String(a.period))); // newest first
    const grand = rows.reduce((s,r)=>s+r.total,0);
    res.json({ group, months: rows, rows, grand_total:+grand.toFixed(2), line_rates: LINE_RATES });
  } catch(e){res.status(500).json({error:e.message});}
});

// ─── Referral credit: request payout ─────────────────────────────────────────
app.post('/api/client/referral-credit/payout', auth, async(req,res)=>{
  try {
    const u = await q.one(db.users,{_id:req.session.uid});
    if(!u) return res.status(404).json({error:'Nenájdený'});
    // Dostupný kredit = referral kredit + čakajúce provízie (jeden pohár)
    const pendComms = await q.find(db.commissions,{partner_id:u._id,status:'pending'});
    const pendSum = +pendComms.reduce((s,c)=>s+(c.amount||0),0).toFixed(2);
    const credit = +((u.referral_credit||0) + pendSum).toFixed(2);
    if(credit < 100) return res.status(400).json({error:`Minimálna výplata je 100 €. Aktuálny dostupný kredit: ${credit.toFixed(2)} €. Kredit môžeš použiť aj na členstvá, merch, vstupenky na eventy či súkromné hodiny.`});
    // Create payout request record
    await q.insert(db.transactions,{
      type:'referral_payout_request', user_id:u._id, user_name:u.name,
      amount:credit, payment_method:'payout', note:`Žiadosť o výplatu kreditu: ${credit.toFixed(2)} € (kredit ${(u.referral_credit||0).toFixed(2)} + provízie ${pendSum.toFixed(2)})`,
      status:'pending', bank_account:u.bank_account||'', created_at:nowISO(), month:today().slice(0,7)
    });
    // Reserve: čakajúce provízie označ ako vyplatené a vynuluj referral kredit
    await q.update(db.commissions,{partner_id:u._id,status:'pending'},{$set:{status:'paid',paid_at:nowISO()}},{multi:true});
    await q.update(db.users,{_id:u._id},{$set:{referral_credit_pending:(u.referral_credit_pending||0)+credit, referral_credit:0}});
    await q.insert(db.notifications,{user_id:u._id,type:'payout',title:'Žiadosť o výplatu odoslaná 💸',body:`${credit.toFixed(2)} € bude prevedených na váš účet po potvrdení adminom.`,read:false,created_at:nowISO()});
    // Notify admin
    const admins = await q.find(db.users,{is_admin:true});
    for(const a of admins) await q.insert(db.notifications,{user_id:a._id,type:'payout_request',title:`💸 Žiadosť o výplatu: ${u.name}`,body:`${credit.toFixed(2)} € referral kredit. Bankový účet: ${u.bank_account||'—'}`,read:false,created_at:nowISO()});
    res.json({ok:true, requested:credit, message:`Žiadosť o výplatu ${credit.toFixed(2)} € bola odoslaná.`});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── Referral credit: use in shop order ──────────────────────────────────────
// (handled inside /api/shop/order – see shop section)
// This endpoint returns current credit balance
app.get('/api/client/referral-credit', auth, async(req,res)=>{
  const u = await q.one(db.users,{_id:req.session.uid});
  if(!u) return res.status(404).json({error:'Nenájdený'});
  res.json({
    referral_credit: u.referral_credit||0,
    referral_credit_pending: u.referral_credit_pending||0
  });
});

// ─── Otázka / nahlásenie chyby adminom ────────────────────────────────────────
app.post('/api/report', auth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.session.uid});
    const type=(req.body.type==='bug')?'bug':'question';
    const text=String(req.body.text||'').trim().slice(0,1000);
    if(!text) return res.status(400).json({error:'Prázdna správa'});
    const title=type==='bug'?'🐞 Nahlásená chyba':'❓ Otázka od člena';
    const admins=await q.find(db.users,{is_admin:true});
    for(const a of admins){
      await q.insert(db.notifications,{user_id:a._id, type:'report', from_id:u._id,
        title:`${title} – ${u.name}`, body:text, read:false, created_at:nowISO()});
    }
    // Zároveň otvor DM konverzáciu s prvým adminom, nech vie klient dostať odpoveď
    res.json({ ok:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPORT TICKETY — klient opíše problém, admin/tréner prevezme, rieši, zavrie
// ═══════════════════════════════════════════════════════════════════════════════
const isStaff = u => !!(u && (u.is_admin || u.user_type==='trainer' || u.user_type==='manager'));
function ticketView(t){ return { id:t._id, subject:t.subject, category:t.category, status:t.status,
  user_id:t.user_id, user_name:t.user_name, user_phone:t.user_phone||'', assigned_to:t.assigned_to||null,
  assigned_name:t.assigned_name||null, created_at:t.created_at, updated_at:t.updated_at, closed_at:t.closed_at||null }; }

// Klient vytvorí ticket (opíše problém)
app.post('/api/support/tickets', auth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.session.uid});
    const subject=String(req.body.subject||'').trim().slice(0,120);
    const description=String(req.body.description||'').trim().slice(0,3000);
    const category=['problem','question','bug','billing','other'].includes(req.body.category)?req.body.category:'question';
    if(!subject||!description) return res.status(400).json({error:'Vyplň predmet aj popis problému'});
    const t=await q.insert(db.tickets,{ user_id:u._id, user_name:u.name, user_phone:u.phone||'',
      subject, category, status:'open', assigned_to:null, assigned_name:null,
      created_at:nowISO(), updated_at:nowISO() });
    await q.insert(db.ticket_msgs,{ ticket_id:t._id, from_id:u._id, from_name:u.name, is_staff:false, text:description, created_at:nowISO() });
    // Upozorni všetkých adminov
    const admins=await q.find(db.users,{is_admin:true});
    for(const a of admins) await q.insert(db.notifications,{user_id:a._id, type:'support', ticket_id:t._id,
      title:`🎫 Nový support ticket – ${u.name}`, body:subject, read:false, created_at:nowISO()});
    res.json({ ok:true, ticket:ticketView(t) });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Moje tickety (klient)
app.get('/api/support/my-tickets', auth, async(req,res)=>{
  const list=await q.find(db.tickets,{user_id:req.session.uid});
  list.sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||''));
  res.json({ tickets:list.map(ticketView) });
});

// Detail ticketu + správy (vlastník alebo staff)
app.get('/api/support/tickets/:id', auth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.session.uid});
    const t=await q.one(db.tickets,{_id:req.params.id});
    if(!t) return res.status(404).json({error:'Ticket nenájdený'});
    if(t.user_id!==u._id && !isStaff(u)) return res.status(403).json({error:'Nemáš prístup'});
    const msgs=(await q.find(db.ticket_msgs,{ticket_id:t._id})).sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''));
    res.json({ ticket:ticketView(t), is_staff:isStaff(u), me:u._id,
      messages:msgs.map(m=>({ id:m._id, from_id:m.from_id, from_name:m.from_name, is_staff:!!m.is_staff, text:m.text, created_at:m.created_at })) });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Pridať správu do ticketu (obojsmerná komunikácia)
app.post('/api/support/tickets/:id/messages', auth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.session.uid});
    const t=await q.one(db.tickets,{_id:req.params.id});
    if(!t) return res.status(404).json({error:'Ticket nenájdený'});
    const staff=isStaff(u);
    if(t.user_id!==u._id && !staff) return res.status(403).json({error:'Nemáš prístup'});
    if(t.status==='closed') return res.status(400).json({error:'Ticket je uzavretý'});
    const text=String(req.body.text||'').trim().slice(0,3000);
    if(!text) return res.status(400).json({error:'Prázdna správa'});
    await q.insert(db.ticket_msgs,{ ticket_id:t._id, from_id:u._id, from_name:u.name, is_staff:staff, text, created_at:nowISO() });
    await q.update(db.tickets,{_id:t._id},{$set:{updated_at:nowISO()}});
    // Notifikuj druhú stranu
    const notifyId = staff ? t.user_id : (t.assigned_to||null);
    if(notifyId) await q.insert(db.notifications,{user_id:notifyId, type:'support', ticket_id:t._id,
      title:`💬 Odpoveď na ticket: ${t.subject}`, body:text.slice(0,80), read:false, created_at:nowISO()});
    res.json({ ok:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Staff prevezme ticket
app.post('/api/support/tickets/:id/claim', auth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.session.uid});
    if(!isStaff(u)) return res.status(403).json({error:'Len pre admina/trénera'});
    const t=await q.one(db.tickets,{_id:req.params.id});
    if(!t) return res.status(404).json({error:'Ticket nenájdený'});
    await q.update(db.tickets,{_id:t._id},{$set:{status:'in_progress', assigned_to:u._id, assigned_name:u.name, updated_at:nowISO()}});
    await q.insert(db.ticket_msgs,{ ticket_id:t._id, from_id:u._id, from_name:u.name, is_staff:true, system:true, text:`${u.name} prevzal/a tvoj ticket a rieši ho. 💛`, created_at:nowISO() });
    await q.insert(db.notifications,{user_id:t.user_id, type:'support', ticket_id:t._id, title:`🙋 Tvoj ticket rieši ${u.name}`, body:t.subject, read:false, created_at:nowISO()});
    res.json({ ok:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Zavrieť ticket (staff alebo vlastník)
app.post('/api/support/tickets/:id/close', auth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.session.uid});
    const t=await q.one(db.tickets,{_id:req.params.id});
    if(!t) return res.status(404).json({error:'Ticket nenájdený'});
    if(t.user_id!==u._id && !isStaff(u)) return res.status(403).json({error:'Nemáš prístup'});
    await q.update(db.tickets,{_id:t._id},{$set:{status:'closed', closed_at:nowISO(), updated_at:nowISO()}});
    const other = (u._id===t.user_id) ? t.assigned_to : t.user_id;
    if(other) await q.insert(db.notifications,{user_id:other, type:'support', ticket_id:t._id, title:`✅ Ticket uzavretý: ${t.subject}`, body:'Ticket bol označený ako vyriešený.', read:false, created_at:nowISO()});
    res.json({ ok:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Staff: zoznam ticketov (+ počet otvorených)
app.get('/api/admin/support/tickets', auth, async(req,res)=>{
  try {
    const u=await q.one(db.users,{_id:req.session.uid});
    if(!isStaff(u)) return res.status(403).json({error:'Len pre admina/trénera'});
    const status=req.query.status;
    let list=await q.find(db.tickets,{});
    if(status && status!=='all') list=list.filter(t=>status==='open'?(t.status!=='closed'):t.status===status);
    list.sort((a,b)=>{ const order={open:0,in_progress:1,closed:2}; const d=(order[a.status]||0)-(order[b.status]||0); return d!==0?d:(b.updated_at||'').localeCompare(a.updated_at||''); });
    const open=(await q.find(db.tickets,{})).filter(t=>t.status!=='closed').length;
    res.json({ tickets:list.map(ticketView), open_count:open });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── Client notifications ─────────────────────────────────────────────────────
app.get('/api/client/notifications', auth, async(req,res)=>{
  const notifs = await q.find(db.notifications,{user_id:req.session.uid},{created_at:-1});
  res.json(notifs.slice(0,30));
});
app.post('/api/client/notifications/read-all', auth, async(req,res)=>{
  await q.update(db.notifications,{user_id:req.session.uid,read:false},{$set:{read:true}},{multi:true});
  res.json({ok:true});
});

// ═══════════════════════════════════════════════════════════════════════════════
// MARKETING ANALYTICS (CAC, LTV, funnel — admin)
// ═══════════════════════════════════════════════════════════════════════════════
function acqSourceOf(u){
  if(u.gclid) return 'google';
  if(u.fbclid) return 'meta';
  const s=(u.utm_source||u.lead_source||'').toLowerCase();
  if(/face|insta|meta|^fb$|^ig$/.test(s)) return 'meta';
  if(/google|adwords|youtube/.test(s)) return 'google';
  if(/tik/.test(s)) return 'tiktok';
  if(s==='referral'||(!s&&u.sponsor_id)) return 'referral';
  return s||'organic';
}

app.get('/api/admin/marketing/stats', adminAuth, async(req,res)=>{
  try {
    const users=(await q.find(db.users,{is_admin:{$ne:true}})).filter(u=>u.user_type!=='trainer' && !u.is_child);
    const payments=(await q.find(db.payments,{})).filter(p=>['completed','active'].includes(p.status)&&p.user_id);
    const orders=(await q.find(db.orders,{})).filter(o=>o.status==='paid');
    const bookings=await q.find(db.bookings,{});
    const membs=(await q.find(db.memberships,{})).filter(m=>!m._type);
    const spend=await q.find(db.adspend,{});

    // ── Revenue per client ──────────────────────────────────────────────────
    const rev={};
    payments.forEach(p=>{ rev[p.user_id]=(rev[p.user_id]||0)+(+p.amount||0); });
    // cash memberships recorded by trainer/admin (have payment_method)
    membs.filter(m=>m.payment_method).forEach(m=>{ rev[m.user_id]=(rev[m.user_id]||0)+(+m.price||0); });
    const emailToUid={}; users.forEach(u=>{ emailToUid[u.email]=u._id; });
    orders.forEach(o=>{ const uid=emailToUid[(o.client_email||'').toLowerCase()]; if(uid) rev[uid]=(rev[uid]||0)+(+o.total||0); });

    const bookedUids=new Set(bookings.map(b=>b.user_id));
    const memberUids=new Set(membs.map(m=>m.user_id));

    // ── Per-source aggregates ───────────────────────────────────────────────
    const bySource={};
    users.forEach(u=>{
      const s=acqSourceOf(u);
      if(!bySource[s]) bySource[s]={source:s,clients:0,revenue:0,paying:0,withBooking:0,withMembership:0};
      const b=bySource[s]; b.clients++;
      const r=rev[u._id]||0; b.revenue+=r; if(r>0) b.paying++;
      if(bookedUids.has(u._id)) b.withBooking++;
      if(memberUids.has(u._id)) b.withMembership++;
    });
    const spendBySource={};
    spend.forEach(s=>{ spendBySource[s.source]=(spendBySource[s.source]||0)+(+s.amount||0); });
    const sources=Object.values(bySource).map(b=>{
      const sp=spendBySource[b.source]||0;
      const ltv=b.clients? b.revenue/b.clients : 0;
      const cac=sp>0&&b.clients? sp/b.clients : null;
      return {...b, revenue:+b.revenue.toFixed(2), ltv:+ltv.toFixed(2), spend:+sp.toFixed(2),
        cac:cac!==null?+cac.toFixed(2):null,
        ltv_cac:cac?+(ltv/cac).toFixed(2):null,
        conv_booking:b.clients?+(100*b.withBooking/b.clients).toFixed(1):0,
        conv_membership:b.clients?+(100*b.withMembership/b.clients).toFixed(1):0};
    }).sort((a,b)=>b.revenue-a.revenue);

    // ── Totals + retention ──────────────────────────────────────────────────
    const totalRevenue=Object.values(rev).reduce((s,v)=>s+v,0);
    const totalSpend=spend.reduce((s,v)=>s+(+v.amount||0),0);
    const membCountByUser={};
    membs.forEach(m=>{ membCountByUser[m.user_id]=(membCountByUser[m.user_id]||0)+1; });
    const everMembers=Object.keys(membCountByUser).length;
    const renewed=Object.values(membCountByUser).filter(c=>c>1).length;
    const now=new Date().toISOString();
    const activeMembers=membs.filter(m=>(m.expires_at||'')>now).length;

    // ── Monthly series (12 months): new clients by source + revenue ────────
    const months=[]; const d=new Date();
    for(let i=11;i>=0;i--){ const m=new Date(d.getFullYear(),d.getMonth()-i,1); months.push(m.getFullYear()+'-'+String(m.getMonth()+1).padStart(2,'0')); }
    const monthly=months.map(m=>{
      const news=users.filter(u=>(u.created_at||'').startsWith(m));
      const perSrc={};
      news.forEach(u=>{ const s=acqSourceOf(u); perSrc[s]=(perSrc[s]||0)+1; });
      const mRev=payments.filter(p=>(p.captured_at||p.activated_at||p.created_at||'').startsWith(m)).reduce((s,p)=>s+(+p.amount||0),0)
        + orders.filter(o=>(o.paid_at||o.created_at||'').startsWith(m)).reduce((s,o)=>s+(+o.total||0),0)
        + membs.filter(mm=>mm.payment_method&&(mm.created_at||'').startsWith(m)).reduce((s,mm)=>s+(+mm.price||0),0);
      const mSpend=spend.filter(s=>s.month===m).reduce((s2,v)=>s2+(+v.amount||0),0);
      return {month:m, newClients:news.length, bySource:perSrc, revenue:+mRev.toFixed(2), spend:+mSpend.toFixed(2)};
    });

    res.json({
      sources, monthly,
      totals:{
        clients:users.length,
        payingClients:Object.values(rev).filter(v=>v>0).length,
        revenue:+totalRevenue.toFixed(2),
        spend:+totalSpend.toFixed(2),
        avgLtv:users.length?+(totalRevenue/users.length).toFixed(2):0,
        avgLtvPaying:0,
        cac:totalSpend>0&&users.length?+(totalSpend/users.length).toFixed(2):null,
        activeMembers, everMembers,
        renewalRate:everMembers?+(100*renewed/everMembers).toFixed(1):0
      },
      funnel:{
        registered:users.length,
        firstBooking:users.filter(u=>bookedUids.has(u._id)).length,
        membership:users.filter(u=>memberUids.has(u._id)).length
      }
    });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Class occupancy report (fill-rate, last 4 weeks) ──────────────────────────
app.get('/api/admin/marketing/occupancy', adminAuth, async(req,res)=>{
  try {
    const cutoff = new Date(Date.now()-28*86400000).toISOString().slice(0,10);
    const classes = (await q.find(db.classes,{active:true})).filter(c=>c.category!=='Online');
    const bookings = await q.find(db.bookings,{booking_date:{$gte:cutoff}});
    const rows = classes.map(c=>{
      const bks = bookings.filter(b=>b.class_id===c._id && !['cancelled','waitlist'].includes(b.status));
      const dates = [...new Set(bks.map(b=>b.booking_date))];
      const sessions = Math.max(dates.length, 1);
      const attended = bks.filter(b=>b.status==='attended').length;
      const noShows = bks.filter(b=>b.status==='no_show').length;
      const avgPerSession = bks.length/sessions;
      return {
        class_id:c._id, name:c.name, instructor:c.instructor, location:c.location,
        day_of_week:c.day_of_week, time_start:c.time_start, capacity:c.capacity||0,
        bookings4w:bks.length, sessions, attended, noShows,
        avgPerSession:+avgPerSession.toFixed(1),
        fillRate:c.capacity?+(100*avgPerSession/c.capacity).toFixed(0):null
      };
    }).sort((a,b)=>(a.fillRate??-1)-(b.fillRate??-1));
    res.json(rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── Ad spend CRUD (month + source + amount) ───────────────────────────────────
app.get('/api/admin/adspend', adminAuth, async(req,res)=>{
  const rows=await q.find(db.adspend,{});
  res.json(rows.sort((a,b)=>(b.month||'').localeCompare(a.month||'')));
});
app.post('/api/admin/adspend', adminAuth, async(req,res)=>{
  try {
    const {month, source, amount, note} = req.body;
    if(!/^\d{4}-\d{2}$/.test(month||'')) return res.status(400).json({error:'Mesiac vo formáte RRRR-MM'});
    if(!source) return res.status(400).json({error:'Chýba zdroj (meta/google/...)'});
    if(!(+amount>0)) return res.status(400).json({error:'Suma musí byť > 0'});
    const existing=await q.one(db.adspend,{month,source:source.toLowerCase()});
    if(existing){
      await q.update(db.adspend,{_id:existing._id},{$set:{amount:+amount,note:note||'',updated_at:nowISO()}});
      await auditLog(req,'adspend_update',`${month}/${source}`,{amount:existing.amount},{amount:+amount},note||'');
      return res.json({ok:true,updated:true});
    }
    await q.insert(db.adspend,{month,source:source.toLowerCase(),amount:+amount,note:note||'',created_at:nowISO()});
    await auditLog(req,'adspend_create',`${month}/${source}`,null,{amount:+amount},note||'');
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/admin/adspend/:id', adminAuth, async(req,res)=>{
  await q.remove(db.adspend,{_id:req.params.id});
  res.json({ok:true});
});

// ── Marketing campaigns (with auto-computed metrics + real revenue attribution) ──
const CAMPAIGN_PLATFORMS = ['facebook','instagram','google','tiktok','email','sms','referral','organic','other'];
function campaignMetrics(c, revenue, payingCustomers){
  const num = (a,b)=> b>0 ? a/b : 0;
  const spend = +c.spend||0, clicks=+c.clicks||0, regs=+c.registrations||0,
        visits=+c.first_visits||0, mems=+c.memberships||0, impr=+c.impressions||0;
  const rev = +revenue||0, pay=+payingCustomers||0;
  return {
    ctr:            impr? +(num(clicks,impr)*100).toFixed(2) : null,   // needs impressions
    conversionRate: +(num(mems,clicks)*100).toFixed(2),
    registrationRate:+(num(regs,clicks)*100).toFixed(2),
    visitRate:      +(num(visits,regs)*100).toFixed(2),
    membershipConv: +(num(mems,visits)*100).toFixed(2),
    cpc:            +num(spend,clicks).toFixed(2),
    cpr:            +num(spend,regs).toFixed(2),
    cpv:            +num(spend,visits).toFixed(2),
    cpm:            +num(spend,mems).toFixed(2),   // cost per membership
    roas:           spend? +num(rev,spend).toFixed(2) : null,
    roi:            spend? +(((rev-spend)/spend)*100).toFixed(1) : null,
    cac:            pay? +num(spend,pay).toFixed(2) : null,
    revenue:        +rev.toFixed(2)
  };
}
// Revenue attributed to a campaign = total spend of clients whose utm_campaign matches
async function campaignRevenueMap(){
  const users=await q.find(db.users,{is_admin:{$ne:true}});
  const payments=(await q.find(db.payments,{})).filter(p=>['completed','active'].includes(p.status)&&p.user_id);
  const membs=(await q.find(db.memberships,{})).filter(m=>!m._type && m.payment_method);
  const rev={}; payments.forEach(p=>{ rev[p.user_id]=(rev[p.user_id]||0)+(+p.amount||0); });
  membs.forEach(m=>{ rev[m.user_id]=(rev[m.user_id]||0)+(+m.price||0); });
  const byCampaign={}; // campaignName(lower) -> {revenue, payers}
  users.forEach(u=>{
    const key=(u.utm_campaign||'').toLowerCase().trim(); if(!key) return;
    if(!byCampaign[key]) byCampaign[key]={revenue:0, payers:0};
    const r=rev[u._id]||0; byCampaign[key].revenue+=r; if(r>0) byCampaign[key].payers++;
  });
  return byCampaign;
}

app.get('/api/admin/campaigns', adminAuth, async(req,res)=>{
  try {
    const list=await q.find(db.campaigns,{});
    const revMap=await campaignRevenueMap();
    const out=list.map(c=>{
      const key=(c.name||'').toLowerCase().trim();
      const attr=revMap[key]||{revenue:0,payers:0};
      return {...c, metrics:campaignMetrics(c, attr.revenue, attr.payers), attributed_revenue:+attr.revenue.toFixed(2), attributed_payers:attr.payers};
    }).sort((a,b)=>(b.date_from||'').localeCompare(a.date_from||''));
    res.json(out);
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/admin/campaigns', adminAuth, async(req,res)=>{
  try {
    const b=req.body;
    if(!(b.name||'').trim()) return res.status(400).json({error:'Chýba názov kampane'});
    const platform=(b.platform||'other').toLowerCase();
    const doc={
      name:b.name.trim(), platform:CAMPAIGN_PLATFORMS.includes(platform)?platform:'other',
      date_from:b.date_from||today(), date_to:b.date_to||'', budget:+b.budget||0,
      goal:b.goal||'', note:b.note||'',
      spend:+b.spend||0, impressions:+b.impressions||0, clicks:+b.clicks||0,
      registrations:+b.registrations||0, first_visits:+b.first_visits||0, memberships:+b.memberships||0,
      created_at:nowISO()
    };
    const c=await q.insert(db.campaigns, doc);
    await auditLog(req,'campaign_create',c.name,null,{budget:doc.budget,spend:doc.spend},'');
    res.json({ok:true, id:c._id});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.put('/api/admin/campaigns/:id', adminAuth, async(req,res)=>{
  try {
    const c=await q.one(db.campaigns,{_id:req.params.id});
    if(!c) return res.status(404).json({error:'Kampaň nenájdená'});
    const b=req.body; const upd={};
    ['name','goal','note','date_from','date_to'].forEach(k=>{ if(b[k]!==undefined) upd[k]=b[k]; });
    ['budget','spend','impressions','clicks','registrations','first_visits','memberships'].forEach(k=>{ if(b[k]!==undefined) upd[k]=+b[k]||0; });
    if(b.platform!==undefined){ const p=(b.platform||'other').toLowerCase(); upd.platform=CAMPAIGN_PLATFORMS.includes(p)?p:'other'; }
    await q.update(db.campaigns,{_id:c._id},{$set:upd});
    await auditLog(req,'campaign_update',c.name,{spend:c.spend},{spend:upd.spend??c.spend},'');
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.delete('/api/admin/campaigns/:id', adminAuth, async(req,res)=>{
  const c=await q.one(db.campaigns,{_id:req.params.id});
  await q.remove(db.campaigns,{_id:req.params.id});
  if(c) await auditLog(req,'campaign_delete',c.name,{budget:c.budget},null,'');
  res.json({ok:true});
});

// ═══════════════════════════════════════════════════════════════════════════════
// PAGES
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/',           (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/shop',       (req,res)=>res.sendFile(path.join(__dirname,'public','shop.html')));
app.get('/schedule',   (req,res)=>res.sendFile(path.join(__dirname,'public','schedule.html')));
app.get('/community',  (req,res)=>res.sendFile(path.join(__dirname,'public','community.html')));
app.get('/support',    (req,res)=>res.sendFile(path.join(__dirname,'public','support.html')));
app.get('/cennik',     (req,res)=>res.redirect(301,'/pricing'));
app.get('/pricing',    (req,res)=>res.sendFile(path.join(__dirname,'public','pricing.html')));
app.get('/u/:id',      (req,res)=>res.sendFile(path.join(__dirname,'public','profile.html')));
app.get('/terms',      (req,res)=>res.sendFile(path.join(__dirname,'public','terms.html')));
app.get('/dashboard',  (req,res)=>res.sendFile(path.join(__dirname,'public','dashboard.html')));
app.get('/admin',      (req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('/online',     (req,res)=>res.sendFile(path.join(__dirname,'public','online.html')));
app.get('/body-analysis',(req,res)=>res.sendFile(path.join(__dirname,'public','body-analysis.html')));
app.get('/fit-premena',(req,res)=>res.sendFile(path.join(__dirname,'public','fit-premena.html')));
app.get('/trainer',    (req,res)=>res.sendFile(path.join(__dirname,'public','trainer.html')));
app.get('/booking-calendar',(req,res)=>res.sendFile(path.join(__dirname,'public','booking-calendar.html')));
app.get('/invoice/:number',(req,res)=>res.sendFile(path.join(__dirname,'public','invoice.html')));
// ── Marketing pages moved to the public website ───────────────────────────────
const WEB_URL = 'https://latindancefusion.art';
['/programs','/about','/trainers','/cities','/rental','/contact','/meal-plan','/fitdays','/blog','/gallery','/podcast','/collaborate'].forEach(p=>{
  app.get(p,(req,res)=>res.redirect(301, WEB_URL));
});
app.get('/client-dashboard',(req,res)=>res.sendFile(path.join(__dirname,'public','client-dashboard.html')));
app.get('/jedalnicek',(req,res)=>res.sendFile(path.join(__dirname,'public','jedalnicek.html')));
// ── Referral redirect ─────────────────────────────────────────────────────────
app.get('/r/:code', async(req,res)=>{
  const code = req.params.code?.toUpperCase();
  if(code){
    const ref = await q.one(db.users,{referral_code:code});
    if(ref){
      // Store in session so registration flow can pick it up
      req.session.ref_code = code;
    }
  }
  res.redirect('/?ref='+encodeURIComponent(code||''));
});

// ── Robots.txt ────────────────────────────────────────────────────────────────
app.get('/robots.txt',(req,res)=>{
  res.type('text/plain').send(
`User-agent: *
Allow: /
Disallow: /admin
Disallow: /dashboard
Disallow: /trainer
Disallow: /api/

Sitemap: https://latindancefusion.art/sitemap.xml`
  );
});

// ── Sitemap ───────────────────────────────────────────────────────────────────
app.get('/sitemap.xml',(req,res)=>{
  const pages = ['','programs','schedule','pricing','online','shop','blog','community','about','fitdays','trainers','cities','contact','rental','meal-plan','gallery','podcast','collaborate','body-analysis','fit-premena'];
  const base = 'https://latindancefusion.art';
  const today = new Date().toISOString().slice(0,10);
  const urls = pages.map(p=>`  <url><loc>${base}/${p}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>${p===''?'1.0':'0.8'}</priority></url>`).join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SOCKET.IO – Real-time community chat
// ═══════════════════════════════════════════════════════════════════════════════
const onlineUsers = new Map(); // socketId → { id, name, memberBadge, rankBadge, user_type, channel }

io.on('connection', async(socket)=>{
  const session = socket.request.session;
  if(!session?.uid){
    socket.emit('auth_required');
    return;
  }
  const u = await q.one(db.users, {_id: session.uid});
  if(!u){ socket.disconnect(); return; }

  const userInfo = {
    id: u._id, name: u.name, nickname: u.nickname||'',
    memberBadge: getMemberBadge(u.created_at),
    rankBadge: RANKS[(u.rank||1)-1].badge,
    user_type: u.user_type||'partner',
    socketId: socket.id,
    channel: 'general',
  };
  onlineUsers.set(socket.id, userInfo);

  // Personal room for private messages (reaches the user on any open view)
  socket.join('user:'+u._id);

  // Send user their info + channels
  socket.emit('welcome', { user: userInfo, channels: CHANNELS });

  // Broadcast updated online list
  io.emit('online_users', Array.from(onlineUsers.values()));

  // Join a channel
  socket.on('join_channel', async(channelId)=>{
    // Leave old rooms
    socket.rooms.forEach(room=>{ if(room!==socket.id) socket.leave(room); });
    socket.join(channelId);
    const info = onlineUsers.get(socket.id);
    if(info) info.channel = channelId;
    io.emit('online_users', Array.from(onlineUsers.values()));

    // Send last 80 messages
    const msgs = await q.find(db.messages, {channel:channelId}, {created_at:1});
    socket.emit('message_history', msgs.slice(-80));
  });

  // New message
  socket.on('send_message', async(data)=>{
    const {channel, text} = data;
    if(!text?.trim()||text.trim().length>500) return;
    const info = onlineUsers.get(socket.id);
    const msg = await q.insert(db.messages, {
      channel: channel||'general',
      user_id: u._id, user_name: u.name, nickname: u.nickname||'',
      memberBadge: getMemberBadge(u.created_at),
      rankBadge: RANKS[(u.rank||1)-1].badge,
      text: text.trim().slice(0,500),
      created_at: nowISO(),
    });
    io.to(channel||'general').emit('new_message', msg);
  });

  // Private message (1-on-1)
  socket.on('send_dm', async(data)=>{
    try {
      const to = String(data?.to||''); const text = (data?.text||'').trim();
      if(!to || to===u._id || !text || text.length>1000) return;
      const recipient = await q.one(db.users,{_id:to});
      if(!recipient) return;
      const msg = await q.insert(db.messages, {
        is_dm:true, dm_key: dmKey(u._id,to), participants:[u._id,to],
        from_id:u._id, from_name:u.name, to_id:to,
        memberBadge:getMemberBadge(u.created_at),
        text: text.slice(0,1000), read:false, created_at: nowISO(),
      });
      // Deliver live to both participants (any open view)
      io.to('user:'+to).emit('new_dm', msg);
      io.to('user:'+u._id).emit('new_dm', msg);
      // Persistent notification for the recipient (shows in bell / dashboard)
      await q.insert(db.notifications,{user_id:to, type:'dm', from_id:u._id,
        title:`💬 Nová správa od ${u.name}`,
        body: text.length>80 ? text.slice(0,80)+'…' : text,
        read:false, created_at:nowISO()});
    } catch(e){ console.error('send_dm:', e.message); }
  });

  // Disconnect
  socket.on('disconnect', ()=>{
    onlineUsers.delete(socket.id);
    io.emit('online_users', Array.from(onlineUsers.values()));
  });
});

// ── Manual re-engagement email ────────────────────────────────────────────────
app.post('/api/admin/crm/send-reengagement', adminAuth, async(req,res)=>{
  try {
    const u = await q.one(db.users,{_id:req.body.user_id});
    if(!u) return res.status(404).json({error:'Používateľ nenájdený'});
    await sendMail(u.email,'Chýbaš nám! 🥺',
      emailTemplate('Chýbaš nám!',
        `<p>Ahoj <b>${u.name}</b>,</p><p>Chceli sme sa opýtať, ako sa máš. Dlho sme ťa nevideli na hodine a chýbaš nám! 💃</p><p>Vráť sa – tvoje miesto na parkete stále čaká.</p>`,
        '🗓️ Pozrieť rozvrh',`${APP_URL}/schedule`));
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MEMBERSHIP FREEZE
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/membership/freeze', auth, async(req,res)=>{
  try {
    const m = await q.one(db.memberships,{user_id:req.session.uid,status:'active'});
    if(!m) return res.status(400).json({error:'Žiadne aktívne členstvo'});
    const freeze_start = today();
    await q.update(db.memberships,{_id:m._id},{$set:{status:'frozen',freeze_start,frozen_by:'user'}});
    await q.update(db.users,{_id:req.session.uid},{$set:{membership_plan:null}});
    await q.insert(db.notifications,{user_id:req.session.uid,type:'membership',title:'Členstvo pozastavené ❄️',body:`Tvoje členstvo ${m.plan_name} bolo zmrazené od ${freeze_start}.`,read:false,created_at:nowISO()});
    res.json({ok:true, message:'Členstvo pozastavené.'});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/membership/unfreeze', auth, async(req,res)=>{
  try {
    const m = await q.one(db.memberships,{user_id:req.session.uid,status:'frozen'});
    if(!m) return res.status(400).json({error:'Žiadne zmrazené členstvo'});
    // Extend expiry by frozen days
    const frozenDays = Math.round((Date.now() - new Date(m.freeze_start).getTime())/(86400000));
    const newExpiry = new Date(new Date(m.expires_at).getTime() + frozenDays*86400000);
    await q.update(db.memberships,{_id:m._id},{$set:{status:'active',freeze_start:null,frozen_by:null,expires_at:newExpiry.toISOString()}});
    await q.update(db.users,{_id:req.session.uid},{$set:{membership_plan:m.plan_id,membership_expires:newExpiry.toISOString()}});
    await q.insert(db.notifications,{user_id:req.session.uid,type:'membership',title:'Členstvo obnovené ✅',body:`Platnosť predĺžená o ${frozenDays} dní. Nová expirácia: ${newExpiry.toLocaleDateString('sk-SK')}.`,read:false,created_at:nowISO()});
    res.json({ok:true, new_expires:newExpiry.toISOString()});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/admin/membership/freeze', adminAuth, async(req,res)=>{
  try {
    const {user_id, action} = req.body;
    if(action==='freeze'){
      const m = await q.one(db.memberships,{user_id,status:'active'});
      if(!m) return res.status(400).json({error:'Žiadne aktívne členstvo'});
      await q.update(db.memberships,{_id:m._id},{$set:{status:'frozen',freeze_start:today(),frozen_by:'admin'}});
      await q.update(db.users,{_id:user_id},{$set:{membership_plan:null}});
      res.json({ok:true});
    } else {
      const m = await q.one(db.memberships,{user_id,status:'frozen'});
      if(!m) return res.status(400).json({error:'Žiadne zmrazené členstvo'});
      const frozenDays = Math.round((Date.now()-new Date(m.freeze_start).getTime())/86400000);
      const newExpiry = new Date(new Date(m.expires_at).getTime()+frozenDays*86400000);
      await q.update(db.memberships,{_id:m._id},{$set:{status:'active',freeze_start:null,frozen_by:null,expires_at:newExpiry.toISOString()}});
      await q.update(db.users,{_id:user_id},{$set:{membership_plan:m.plan_id,membership_expires:newExpiry.toISOString()}});
      res.json({ok:true, new_expires:newExpiry.toISOString()});
    }
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/leaderboard', async(req,res)=>{
  const period = req.query.period||'alltime'; // alltime | month
  let users;
  if(period==='month'){
    const monthStart = today().slice(0,7)+'-01';
    const bkgs = await q.find(db.bookings,{created_at:{$gte:monthStart}});
    const counts = {};
    bkgs.forEach(b=>{ counts[b.user_id]=(counts[b.user_id]||0)+1; });
    const allU = await q.find(db.users,{active:true});
    users = allU
      .filter(u=>counts[u._id] && !u.is_admin && u.user_type!=='trainer' && !u.is_child && !u.anonymous)
      .map(u=>({id:u._id,name:u.name,visits:counts[u._id]||0,total:u.visit_count||0}))
      .sort((a,b)=>b.visits-a.visits).slice(0,20);
  } else {
    const allU = await q.find(db.users,{active:true});
    users = allU.filter(u=>(u.visit_count||0)>0 && !u.is_admin && u.user_type!=='trainer' && !u.is_child && !u.anonymous)
      .sort((a,b)=>(b.visit_count||0)-(a.visit_count||0)).slice(0,20)
      .map(u=>({id:u._id,name:u.name,visits:u.visit_count||0}));
  }
  res.json(users);
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHURN RISK
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/admin/churn-risk', adminAuth, async(req,res)=>{
  const days = parseInt(req.query.days||'14');
  const cutoff = new Date(Date.now()-days*86400000).toISOString().slice(0,10);
  const allU = await q.find(db.users,{active:true});
  const risk = [];
  for(const u of allU){
    if((u.visit_count||0)===0) continue;
    const lastBk = await q.find(db.bookings,{user_id:u._id});
    if(!lastBk.length) continue;
    lastBk.sort((a,b)=>b.created_at.localeCompare(a.created_at));
    const lastDate = lastBk[0].created_at.slice(0,10);
    if(lastDate < cutoff){
      const daysSince = Math.round((Date.now()-new Date(lastDate).getTime())/86400000);
      const mem = await q.one(db.memberships,{user_id:u._id,status:'active'});
      risk.push({id:u._id,name:u.name,email:u.email,phone:u.phone||'',visits:u.visit_count||0,last_visit:lastDate,days_since:daysSince,has_membership:!!mem,membership:mem?.plan_name||null});
    }
  }
  risk.sort((a,b)=>b.days_since-a.days_since);
  res.json(risk);
});

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL AUTOMATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
let APP_URL = process.env.APP_URL || 'https://app.latindancefusion.art';
// Appka žije na app. subdoméne (Railway); apex latindancefusion.art je Netlify web (404 na /admin, /trainer…).
// Ak je APP_URL omylom nastavená na apex, oprav ju na app. subdoménu, nech maily nevedú na 404.
if(/^https?:\/\/(www\.)?latindancefusion\.art/i.test(APP_URL)) APP_URL = 'https://app.latindancefusion.art';

// Enqueue all steps of a sequence for a user, starting from today + step.day
async function enqueueSequence(userId, sequenceName, anchorDate){
  const anchor = anchorDate ? new Date(anchorDate) : new Date();
  const steps = await q.find(db.email_steps, {sequence: sequenceName, active: true});
  for(const step of steps){
    const sendDate = new Date(anchor.getTime() + step.day * 86400000);
    const scheduled_for = sendDate.toISOString().slice(0,10);
    // Don't duplicate
    const exists = await q.one(db.email_queue, {user_id: userId, step_id: step._id, status:'pending'});
    if(!exists){
      await q.insert(db.email_queue, {
        user_id: userId, sequence: sequenceName, step_id: step._id,
        scheduled_for, status:'pending', created_at: nowISO()
      });
    }
  }
}

// Cancel all pending steps of a sequence for a user (e.g. lead_nurture when user buys)
async function cancelSequence(userId, sequenceName){
  await q.remove(db.email_queue, {user_id: userId, sequence: sequenceName, status:'pending'}, {multi:true});
}

// Process queue: send all emails due today or earlier
async function processEmailQueue(){
  const todayStr = today();
  const due = await q.find(db.email_queue, {scheduled_for: {$lte: todayStr}, status:'pending'});
  let sent = 0;
  for(const item of due){
    try {
      const step = await q.one(db.email_steps, {_id: item.step_id});
      if(!step || !step.active){ await q.update(db.email_queue,{_id:item._id},{$set:{status:'skipped'}}); continue; }
      const u = await q.one(db.users, {_id: item.user_id});
      if(!u?.email){ await q.update(db.email_queue,{_id:item._id},{$set:{status:'skipped'}}); continue; }

      // Conditional checks per sequence
      if(step.sequence === 'lead_nurture'){
        const mem = await q.one(db.memberships,{user_id:u._id, status:'active'});
        if(mem){ await q.update(db.email_queue,{_id:item._id},{$set:{status:'skipped',reason:'has_membership'}}); continue; }
      }
      // Winback: prestaň, ak sa klient vrátil (nedávna účasť) alebo si kúpil členstvo
      if(step.sequence === 'winback'){
        const mem = await q.one(db.memberships,{user_id:u._id, status:'active'});
        if(mem){ await cancelSequence(u._id,'winback'); await q.update(db.email_queue,{_id:item._id},{$set:{status:'skipped',reason:'returned_membership'}}); continue; }
        const recent = await q.find(db.bookings,{user_id:u._id, status:'attended', booking_date:{$gte:new Date(Date.now()-14*864e5).toISOString().slice(0,10)}});
        if(recent.length){ await cancelSequence(u._id,'winback'); await q.update(db.email_queue,{_id:item._id},{$set:{status:'skipped',reason:'returned_visit'}}); continue; }
      }
      if(step.sequence === 'expiry_warning'){
        const mem = await q.one(db.memberships,{user_id:u._id, status:'active'});
        if(!mem){ await q.update(db.email_queue,{_id:item._id},{$set:{status:'skipped',reason:'no_membership'}}); continue; }
      }
      if(step.sequence === 'reengagement'){
        // Skip if visited recently (last 7 days)
        const recent = await q.find(db.bookings,{user_id:u._id,created_at:{$gte:new Date(Date.now()-7*86400000).toISOString().slice(0,10)}});
        if(recent.length){ await q.update(db.email_queue,{_id:item._id},{$set:{status:'skipped',reason:'active_user'}}); continue; }
      }
      if(step.sequence === 'bronze_upsell'){
        // Zastav, ak už prešiel na vyššie členstvo (nie Bronze) — netreba upsell
        const mem = await q.one(db.memberships,{user_id:u._id, status:'active'});
        if(!mem || mem.plan_id!=='bronze'){ await q.update(db.email_queue,{_id:item._id},{$set:{status:'skipped',reason:'upgraded_or_no_bronze'}}); continue; }
      }
      if(step.sequence === 'gold_upsell'){
        // Posielaj len kým je Silver (prešiel na Gold alebo stratil členstvo → stop)
        const mem = await q.one(db.memberships,{user_id:u._id, status:'active'});
        if(!mem || mem.plan_id!=='silver'){ await q.update(db.email_queue,{_id:item._id},{$set:{status:'skipped',reason:'not_silver'}}); continue; }
      }

      const meno = firstName(u.name)||'';
      const subj = (step.subject||'').replace(/\{meno\}/g, meno);
      const bodyP = (step.body||'').replace(/\{meno\}/g, meno);
      await sendMail(u.email, subj,
        emailTemplate(subj.replace(/^[^\w]*/,''), bodyP, step.cta||null, step.cta_url||APP_URL));
      await q.update(db.email_queue,{_id:item._id},{$set:{status:'sent', sent_at: nowISO()}});
      sent++;
    } catch(e){
      await q.update(db.email_queue,{_id:item._id},{$set:{status:'error', error: e.message}});
    }
  }
  if(sent) console.log(`📧 Email queue: odoslaných ${sent} emailov`);
}

// ── Email automation API ──────────────────────────────────────────────────────
// GET all sequences with their steps
app.get('/api/admin/email-sequences', adminAuth, async(req,res)=>{
  const steps = await q.find(db.email_steps, {});
  steps.sort((a,b)=>a.sequence.localeCompare(b.sequence)||(a.day-b.day));
  res.json(steps);
});

// Update a step (subject, body, cta, active, day)
app.put('/api/admin/email-sequences/:id', adminAuth, async(req,res)=>{
  try {
    const {subject, body, cta, cta_url, active, day} = req.body;
    const upd = {};
    if(subject!==undefined) upd.subject = subject;
    if(body!==undefined) upd.body = body;
    if(cta!==undefined) upd.cta = cta;
    if(cta_url!==undefined) upd.cta_url = cta_url;
    if(active!==undefined) upd.active = active;
    if(day!==undefined) upd.day = parseInt(day);
    await q.update(db.email_steps, {_id:req.params.id}, {$set: upd});
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Toggle active
app.post('/api/admin/email-sequences/:id/toggle', adminAuth, async(req,res)=>{
  const step = await q.one(db.email_steps, {_id:req.params.id});
  if(!step) return res.status(404).json({error:'Nenájdený'});
  await q.update(db.email_steps, {_id:step._id}, {$set:{active:!step.active}});
  res.json({ok:true, active:!step.active});
});

// Preview email step (send test to admin)
app.post('/api/admin/email-sequences/:id/test', adminAuth, async(req,res)=>{
  try {
    const step = await q.one(db.email_steps, {_id:req.params.id});
    if(!step) return res.status(404).json({error:'Nenájdený'});
    const to = req.body.to || process.env.SMTP_USER;
    await sendMail(to, '[TEST] '+step.subject,
      emailTemplate(step.subject.replace(/^[^\w]*/,''), step.body, step.cta||null, step.cta_url||APP_URL));
    res.json({ok:true, sent_to:to});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Queue stats
app.get('/api/admin/email-queue/stats', adminAuth, async(req,res)=>{
  const all = await q.find(db.email_queue,{});
  const today_due = all.filter(i=>i.scheduled_for<=today()&&i.status==='pending').length;
  const sent = all.filter(i=>i.status==='sent').length;
  const pending = all.filter(i=>i.status==='pending').length;
  const errors = all.filter(i=>i.status==='error').length;
  res.json({total:all.length, pending, sent, errors, today_due});
});

// Queue list
app.get('/api/admin/email-queue', adminAuth, async(req,res)=>{
  const items = await q.find(db.email_queue, {});
  items.sort((a,b)=>a.scheduled_for.localeCompare(b.scheduled_for));
  const allU = await q.find(db.users,{});
  const uMap = Object.fromEntries(allU.map(u=>[u._id,{name:u.name,email:u.email}]));
  const allS = await q.find(db.email_steps,{});
  const sMap = Object.fromEntries(allS.map(s=>[s._id,{label:s.label,subject:s.subject}]));
  const result = items.map(i=>({
    ...i,
    user_name: uMap[i.user_id]?.name||'—',
    user_email: uMap[i.user_id]?.email||'—',
    step_label: sMap[i.step_id]?.label||'—',
    step_subject: sMap[i.step_id]?.subject||'—',
  }));
  res.json(result.slice(0,200));
});

// Manual run queue now
app.post('/api/admin/email-queue/run', adminAuth, async(req,res)=>{
  try { await processEmailQueue(); res.json({ok:true}); }
  catch(e){ res.status(500).json({error:e.message}); }
});

// Generate the weekly admin report on demand (also runs automatically on Mondays)
app.post('/api/admin/weekly-report/run', adminAuth, async(req,res)=>{
  try { await sendWeeklyAdminReport(); res.json({ok:true}); }
  catch(e){ res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTOMATED CRON JOBS (run on server, no external cron needed)
// ═══════════════════════════════════════════════════════════════════════════════

function emailTemplate(title, body, ctaText, ctaUrl){
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#1a1a1a;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:30px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#242424;border-radius:16px;overflow:hidden;max-width:600px">
<tr><td style="background:linear-gradient(135deg,#C9A84C,#a07030);padding:28px 32px;text-align:center">
  <h1 style="color:#fff;margin:0;font-size:1.6rem">💃 Fusion Academy</h1></td></tr>
<tr><td style="padding:32px">
  <h2 style="color:#C9A84C;margin:0 0 16px">${title}</h2>
  <div style="color:#ccc;font-size:0.95rem;line-height:1.7">${body}</div>
  ${ctaText?`<div style="text-align:center;margin:28px 0"><a href="${ctaUrl}" style="background:#C9A84C;color:#111;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:800;font-size:1rem">${ctaText}</a></div>`:''}
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #333;text-align:center">
  <p style="color:#666;font-size:.8rem;margin:0">Fusion Academy · info@fusionacademy.sk · <a href="${APP_URL}/unsubscribe" style="color:#888">Odhlásiť</a></p>
</td></tr></table></td></tr></table></body></html>`;
}

// Thank-you + membership/permanentka offer, sent once after the client's first class.
// Idempotent: guarded by user.first_class_email_sent. Call from QR check-in and daily job.
async function sendFirstClassEmail(userId){
  const u = await q.one(db.users,{_id:userId});
  if(!u || !u.email || u.is_child || u.first_class_email_sent) return;
  // mark as handled so it never fires again for this user
  await q.update(db.users,{_id:u._id},{$set:{first_class_email_sent:true}});
  // don't pitch membership to someone who already has an active one
  const mem = await checkMembership(u._id);
  if(mem && mem.status==='active') return;
  const body =
    `<p>Ahoj <b>${u.name}</b>,</p>
     <p>Máme z teba obrovskú radosť – zvládol/zvládla si <b>prvú hodinu zadarmo</b> a to je ten najťažší krok! 🎉 Dúfame, že si sa cítil/a skvele a odchádzal/a s úsmevom.</p>
     <p>Ak chceš pokračovať a naplno si tanec užiť, tu je naša <b>najvýhodnejšia</b> možnosť:</p>
     <div style="background:linear-gradient(135deg,#C9A84C,#a07030);border-radius:16px;padding:2px;margin:18px 0">
       <div style="background:#1c1c1c;border-radius:14px;padding:20px 22px;text-align:center">
         <div style="display:inline-block;background:#C9A84C;color:#111;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:4px 12px;border-radius:20px;margin-bottom:10px">⭐ Najvýhodnejšie</div>
         <div style="font-size:20px;font-weight:800;color:#C9A84C;margin-bottom:4px">Mesačné členstvo</div>
         <div style="color:#ccc;font-size:14px;margin-bottom:14px">Choď na <b style="color:#fff">neobmedzený počet hodín</b> každý mesiac, vo všetkých mestách. Najlepšia hodnota pre pravidelný tanec.</div>
         <div style="font-size:26px;font-weight:900;color:#fff;margin-bottom:2px">už od 50 € / mesiac</div>
         <a href="${APP_URL}/pricing" style="display:inline-block;margin-top:14px;background:#C9A84C;color:#111;font-weight:800;text-decoration:none;padding:13px 30px;border-radius:10px;font-size:15px">Chcem členstvo 💃</a>
       </div>
     </div>
     <div style="border:1px solid #333;border-radius:12px;padding:16px 18px;margin:10px 0;text-align:center">
       <div style="color:#aaa;font-size:13px;margin-bottom:6px">Nechceš záväzok každý mesiac?</div>
       <div style="font-size:15px;font-weight:700;color:#ddd">🎟️ Permanentka na 10 vstupov – <b>80 €</b></div>
       <div style="color:#888;font-size:12px;margin-top:4px">Platná 90 dní · vhodná, ak chodíš občas · <a href="${APP_URL}/pricing" style="color:#C9A84C;text-decoration:none">viac info</a></div>
     </div>
     <p style="color:#999;font-size:13px;margin-top:16px">Ak máš akékoľvek otázky, stačí odpovedať na tento email. Tešíme sa na teba na ďalšej hodine! 🌟</p>`;
  await sendMail(u.email,'Ďakujeme za tvoju prvú hodinu! 🥰 A čo ďalej?',
    emailTemplate('Ďakujeme, že si prišiel/prišla! 💛', body, '💃 Vybrať si členstvo', `${APP_URL}/pricing`)).catch(()=>{});
  await q.insert(db.notifications,{user_id:u._id,type:'first_class_followup',title:'Ďakujeme za prvú hodinu! 🥰',body:'Pozri si možnosti členstva a permanentky.',read:false,created_at:nowISO()});
  processEmailQueue().catch(()=>{});
}

// Booking cancellation confirmation email
async function sendBookingCancelEmail(b, byStaff){
  if(!b?.user_id) return;
  const u = await q.one(db.users,{_id:b.user_id});
  if(!u?.email) return;
  await sendMail(u.email,`Rezervácia zrušená – ${b.class_name||'hodina'}`,
    emailTemplate('Rezervácia zrušená',
      `<p>Ahoj <b>${u.name}</b>,</p><p>Tvoja rezervácia bola zrušená${byStaff?' zo strany štúdia':''}:</p>
       <ul style="color:#ccc"><li><b>${b.class_name||''}</b> ${b.class_emoji||''}</li><li>🗓️ ${b.booking_date||''}</li>${b.class_location?`<li>📍 ${b.class_location}</li>`:''}</ul>
       <p>${byStaff?'Ospravedlňujeme sa za komplikáciu. ':''}Kedykoľvek si môžeš rezervovať novú hodinu v rozvrhu. 💃</p>`,
      '🗓️ Rezervovať novú hodinu',`${APP_URL}/schedule`)).catch(()=>{});
  await q.insert(db.notifications,{user_id:u._id,type:'booking_cancelled',title:'Rezervácia zrušená',body:`${b.class_name||''} – ${b.booking_date||''}`,read:false,created_at:nowISO()}).catch(()=>{});
}

// Dávková kontrola odznakov pre všetkých klientov (+ notif priateľom)
async function runAchievementsDaily(){
  const clients = await q.find(db.users,{is_admin:{$ne:true}, active:{$ne:false}, anonymous:{$ne:true}});
  for(const c of clients){ await checkNewAchievements(c._id); }
}
// Notifikácie o blížiacich sa meninách/narodeninách priateľov (7 dní a 1 deň dopredu)
// Eskalujúce ponuky pre leadov bez členstva (48 h → 20 %/24 h, +týždeň → 50 %,
// potom stále ďalej), kým si ich klient nevypne na profile (offers_optout).
async function sendLeadOffer(u, percent, stage){
  const { code } = await createOfferCode(u._id, percent, 24);
  const beata = stage===1 ? `<div style="background:#141414;border-left:3px solid #C9A84C;padding:12px 14px;margin:14px 0;border-radius:8px;color:#ddd"><p style="margin:0 0 6px"><b>Beátka</b> prišla pred rokom schudnúť. Dnes je o <b>17 kg ľahšia</b>.</p><p style="margin:0;font-style:italic;color:#bbb">„Odchádzam so svojou rodinou a sama so sebou tak, ako som sa nevidela 15 rokov."</p><p style="margin:6px 0 0;font-size:.85em;color:#999">Jej recept? 3× týždenne Zumba + výživa. Nič viac.</p></div>` : '';
  const body = `<p>Ahoj <b>${u.name}</b>,</p>
    ${stage===1 ? `<p>vieme, že prvý krok je najťažší. Tak ti dáme dôvod. 💛</p>${beata}` : `<p>ešte stále váhaš? Tak pridávame. 🔥</p>`}
    <p>Tu je <b>${percent}% zľava na tvoj prvý mesiac členstva</b> — ale pozor, <b>platí len 24 hodín</b>:</p>
    <div style="text-align:center;margin:16px 0"><div style="display:inline-block;font-family:monospace;font-weight:800;letter-spacing:1px;background:#0d0d0d;border:1px dashed #C9A84C;color:#E7C878;border-radius:10px;padding:12px 22px;font-size:1.3rem">${code}</div><div style="color:#e0a060;font-size:.82rem;margin-top:6px">⏳ platí len do zajtra — potom prepadá</div></div>
    <p>Zadaj ho pri kúpe členstva a ušetríš na prvom mesiaci. Tvoja premena môže začať dnes. 💃</p>
    <p style="font-size:.78rem;color:#888;margin-top:18px">Nechceš dostávať ponuky? Vypni si ich vo svojom profile v aplikácii.</p>`;
  const subj = stage===1 ? `Beátka schudla 17 kg 💪 Tvoja zľava ${percent}% platí len 24 h ⏳` : `Posledná šanca: ${percent}% na prvý mesiac (len 24 h) 🔥`;
  if(u.email) await sendMail(u.email, subj, emailTemplate(subj.replace(/^[^\w]*/,''), body, 'Uplatniť zľavu', `${APP_URL}/pricing`)).catch(()=>{});
  await q.insert(db.notifications,{user_id:u._id,type:'offer',title:`🎁 ${percent}% zľava — len 24 h!`,body:`Kód ${code} na prvý mesiac členstva. Platí len do zajtra!`,read:false,created_at:nowISO()}).catch(()=>{});
}
// Motivačná sekvencia PRED absolvovaním hodiny zdarma — pozýva leada prísť
// na svoju prvú (bezplatnú) hodinu. Bez zľavových kódov, len povzbudenie.
async function sendFreeClassNudge(u, stage){
  const bookedBefore = !!u.lead_fc_at;
  let subj, body;
  if(!bookedBefore){
    subj = `${u.name}, tvoja prvá hodina je zadarmo 💃 Kedy prídeš?`;
    body = `<p>Ahoj <b>${u.name}</b>,</p>
      <p>tešíme sa, že si tu! Máš u nás <b>prvú hodinu úplne zadarmo</b> — bez záväzkov, len ty a hudba. 🎶</p>
      <p>Nemusíš nič vedieť dopredu, nemusíš mať „postavu na tanec". Príď v čomkoľvek pohodlnom a zvyšok necháme na parket. 💛</p>
      <p>Vyber si termín, ktorý ti sadne — a uvidíme sa!</p>`;
  } else if(stage<=2){
    subj = `Ešte si neprišla na hodinu zdarma? Držíme ti miesto 🙌`;
    body = `<p>Ahoj <b>${u.name}</b>,</p>
      <p>tvoja <b>hodina zdarma stále čaká</b> — a s ňou aj partia žien, ktoré presne ako ty raz spravili ten prvý krok.</p>
      <div style="background:#141414;border-left:3px solid #C9A84C;padding:12px 14px;margin:14px 0;border-radius:8px;color:#ddd"><p style="margin:0 0 6px"><b>Beátka</b> tiež váhala. Dnes je o <b>17 kg ľahšia</b> a hovorí:</p><p style="margin:0;font-style:italic;color:#bbb">„Odchádzam sama so sebou tak, ako som sa nevidela 15 rokov."</p><p style="margin:6px 0 0;font-size:.85em;color:#999">Všetko sa to začalo jednou hodinou.</p></div>
      <p>Ten najťažší krok je prísť prvýkrát. My sa postaráme o zvyšok.</p>`;
  } else {
    subj = `${u.name}, prvý tanec je stále na nás 💃`;
    body = `<p>Ahoj <b>${u.name}</b>,</p>
      <p>nechceme na teba tlačiť — len ti chceme pripomenúť, že <b>tvoja hodina zdarma nikam neutečie</b>. Kedykoľvek budeš pripravená, miesto na parkete ti držíme.</p>
      <p>Stačí si vybrať termín. 🎶</p>`;
  }
  body += `<p style="font-size:.78rem;color:#888;margin-top:18px">Nechceš dostávať tieto e-maily? Vypni si ich vo svojom profile v aplikácii.</p>`;
  if(u.email) await sendMail(u.email, subj, emailTemplate(subj.replace(/^[^\w]*/,''), body, '🗓️ Vybrať termín hodiny zdarma', `${APP_URL}/schedule`)).catch(()=>{});
  await q.insert(db.notifications,{user_id:u._id,type:'freeclass_nudge',title:'💃 Tvoja hodina zdarma čaká',body:'Vyber si termín a príď — prvá hodina je na nás.',read:false,created_at:nowISO()}).catch(()=>{});
}

async function runLeadOffers(){
  const todayStr2 = today();
  const daysAgo = n => new Date(Date.now()-n*864e5).toISOString().slice(0,10);
  const leads = await q.find(db.users,{user_type:'lead', is_admin:{$ne:true}, active:{$ne:false}});
  for(const u of leads){
    if(!u.email || u.offers_optout) continue;
    if(await q.one(db.memberships,{user_id:u._id, status:'active'})) continue; // už kúpil členstvo

    // ── FÁZA A: ešte nebola na hodine zdarma → motivuj ju prísť ──────────────
    if(!u.free_class_used){
      const fcStage = u.lead_fc_stage||0;
      const last = (u.lead_fc_at||u.created_at||'').slice(0,10);
      let sendFc=false, nextFc=fcStage;
      if(fcStage===0){ if((u.created_at||'').slice(0,10) <= daysAgo(1)){ sendFc=true; nextFc=1; } }   // +1 deň
      else if(fcStage===1){ if(last <= daysAgo(3)){ sendFc=true; nextFc=2; } }                          // +3 dni
      else if(fcStage===2){ if(last <= daysAgo(7)){ sendFc=true; nextFc=3; } }                          // +týždeň
      else { if(last <= daysAgo(14)){ sendFc=true; nextFc=fcStage+1; } }                                // potom každé 2 týždne
      if(sendFc){
        try { await sendFreeClassNudge(u, fcStage); await q.update(db.users,{_id:u._id},{$set:{lead_fc_stage:nextFc, lead_fc_at:todayStr2}}); }
        catch(e){ console.error('Free-class nudge error:', e.message); }
      }
      continue; // kým nepríde na hodinu zdarma, žiadne zľavy
    }

    // ── FÁZA B: hodinu zdarma už absolvovala → eskalujúce zľavové ponuky ──────
    if(!u.lead_offer_anchor){ // začni 48 h odpočet od momentu, keď zistíme absolvovanú hodinu
      await q.update(db.users,{_id:u._id},{$set:{lead_offer_anchor:todayStr2}}); continue;
    }
    const stage = u.lead_offer_stage||0;
    const anchor = u.lead_offer_anchor.slice(0,10);
    const last = (u.lead_offer_at||anchor).slice(0,10);
    let send=null, nextStage=stage;
    if(stage===0){ if(anchor <= daysAgo(2)){ send=20; nextStage=1; } }        // 48 h po hodine zdarma
    else if(stage===1){ if(last <= daysAgo(7)){ send=50; nextStage=2; } }      // +1 týždeň
    else { if(last <= daysAgo(14)){ send=50; nextStage=stage+1; } }            // potom každé 2 týždne
    if(send!=null){
      try { await sendLeadOffer(u, send, nextStage); await q.update(db.users,{_id:u._id},{$set:{lead_offer_stage:nextStage, lead_offer_at:todayStr2}}); }
      catch(e){ console.error('Lead offer error:', e.message); }
    }
  }
}
async function runFriendEventsDaily(){
  const todayStr2 = today();
  const now2 = new Date();
  const mdOff = off => { const x=new Date(now2.getTime()+off*86400000); return String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };
  const namesFor = mmdd => { const t=SK_NAMEDAYS[mmdd]||''; return t? t.split(/\s+a\s+|,\s*/).map(stripDia).filter(Boolean):[]; };
  const targets = { 7:{mmdd:mdOff(7), names:namesFor(mdOff(7))}, 1:{mmdd:mdOff(1), names:namesFor(mdOff(1))} };
  const usersById = Object.fromEntries((await q.find(db.users,{})).map(u=>[u._id,u]));
  const friendships = await q.find(db.friends,{status:'accepted'});
  for(const f of friendships){
    const [a,b] = f.users||[];
    for(const [meId2,frId] of [[a,b],[b,a]]){
      const meU=usersById[meId2], frU=usersById[frId];
      if(!meU||!frU||meU.active===false||frU.active===false||meU.anonymous) continue;
      for(const when of [7,1]){
        const t=targets[when];
        if(frU.birthday && frU.birthday.slice(5)===t.mmdd){
          const ref='bd'+when+':'+frId;
          if(!(await q.one(db.notifications,{user_id:meId2, ref_id:ref, created_at:{$gte:todayStr2}})))
            await q.insert(db.notifications,{user_id:meId2, type:'friend_event', ref_id:ref,
              title: when===1?`🎂 Zajtra má ${frU.name} narodeniny`:`🎂 ${frU.name} má o týždeň narodeniny`,
              body:'Priprav sa poblahoželať svojmu priateľovi! 🎉', read:false, created_at:nowISO()});
        }
        const fn=stripDia(firstName(frU.name));
        if(fn && t.names.includes(fn)){
          const ref='nd'+when+':'+frId;
          if(!(await q.one(db.notifications,{user_id:meId2, ref_id:ref, created_at:{$gte:todayStr2}})))
            await q.insert(db.notifications,{user_id:meId2, type:'friend_event', ref_id:ref,
              title: when===1?`💐 Zajtra má ${frU.name} meniny`:`💐 ${frU.name} má o týždeň meniny`,
              body:'Priprav sa poblahoželať svojmu priateľovi! 🎉', read:false, created_at:nowISO()});
        }
      }
    }
  }
}
async function runDailyJobs(){
  const d3 = new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  const d7 = new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  const todayStr = today();

  // ── 1. Expiry warnings ─────────────────────────────────────────────────────
  const expiring = await q.find(db.memberships,{status:'active',expires_at:{$lte:d7+'T23:59:59',$gte:todayStr+'T00:00:00'}});
  for(const m of expiring){
    const u = await q.one(db.users,{_id:m.user_id});
    if(!u?.email) continue;
    const alreadySent = await q.one(db.notifications,{user_id:u._id,type:'expiry_warning',created_at:{$gte:todayStr}});
    if(alreadySent) continue;
    const daysLeft = Math.ceil((new Date(m.expires_at)-Date.now())/86400000);
    await sendMail(u.email,`⚠️ Členstvo vyprší o ${daysLeft} ${daysLeft===1?'deň':'dní'}`,
      emailTemplate(`Členstvo vyprší o ${daysLeft} ${daysLeft===1?'deň':'dní'}`,
        `<p>Ahoj <b>${u.name}</b>,</p><p>Tvoje členstvo <b>${m.plan_name}</b> vyprší <b>${m.expires_at.slice(0,10)}</b>.</p><p>Obnov si ho teraz a neprerušuj svoju tanečnú cestu! 💃</p>`,
        '🔄 Obnoviť členstvo',`${APP_URL}/pricing`)).catch(()=>{});
    await q.insert(db.notifications,{user_id:u._id,type:'expiry_warning',title:`⚠️ Členstvo vyprší o ${daysLeft} dní`,body:`${m.plan_name} – expirácia ${m.expires_at.slice(0,10)}`,read:false,created_at:nowISO()});
  }

  // ── 1b. Membership just ended (yesterday), not renewed → win-back email ────
  const yStart = new Date(Date.now()-86400000).toISOString().slice(0,10);
  const endedYesterday = await q.find(db.memberships,{status:'active',expires_at:{$gte:yStart+'T00:00:00',$lt:todayStr+'T00:00:00'}});
  for(const m of endedYesterday){
    const u = await q.one(db.users,{_id:m.user_id});
    if(!u?.email) continue;
    // skip if a newer active membership exists (renewed)
    const renewed = await q.one(db.memberships,{user_id:m.user_id,expires_at:{$gt:todayStr+'T00:00:00'}});
    if(renewed) continue;
    await q.update(db.memberships,{_id:m._id},{$set:{status:'expired'}});
    const already = await q.one(db.notifications,{user_id:u._id,type:'membership_ended',created_at:{$gte:yStart}});
    if(already) continue;
    await sendMail(u.email,'Tvoje členstvo skončilo – vráť sa na parket 💃',
      emailTemplate('Členstvo skončilo',
        `<p>Ahoj <b>${u.name}</b>,</p><p>Tvoje členstvo <b>${m.plan_name}</b> práve skončilo. Dúfame, že si si tanec užil/a naplno! 🌟</p><p>Obnov si ho jedným klikom a pokračuj tam, kde si prestal/a – tvoje miesto na parkete čaká.</p>`,
        '🔄 Obnoviť členstvo',`${APP_URL}/pricing`)).catch(()=>{});
    await q.insert(db.notifications,{user_id:u._id,type:'membership_ended',title:'Členstvo skončilo',body:`${m.plan_name} vypršalo ${m.expires_at.slice(0,10)}`,read:false,created_at:nowISO()});
  }

  // ── 2. Day-before class reminders ─────────────────────────────────────────
  const tomorrow = new Date(Date.now()+86400000);
  const tomorrowDow = tomorrow.getDay();
  const allClasses = await q.find(db.classes,{day_of_week:tomorrowDow,active:true});
  for(const cls of allClasses){
    const bookings = await q.find(db.bookings,{class_id:cls._id,status:{$ne:'cancelled'}});
    for(const bk of bookings){
      const u = await q.one(db.users,{_id:bk.user_id});
      if(!u?.email) continue;
      const alreadySent = await q.one(db.notifications,{user_id:u._id,type:'class_reminder',ref_id:cls._id,created_at:{$gte:todayStr}});
      if(alreadySent) continue;
      await sendMail(u.email,`🗓️ Zajtra máš hodinu – ${cls.name}`,
        emailTemplate(`Zajtra: ${cls.name}`,
          `<p>Ahoj <b>${u.name}</b>,</p><p>Pripomíname, že zajtra máš hodinu:</p><ul style="color:#ccc"><li><b>${cls.name}</b></li><li>🕐 ${cls.time_start||''}–${cls.time_end||''}</li><li>📍 ${cls.location||''}</li></ul><p>Tešíme sa na teba! 💃</p>`,
          '📍 Zobraziť rozvrh',`${APP_URL}/schedule`)).catch(()=>{});
      await q.insert(db.notifications,{user_id:u._id,type:'class_reminder',ref_id:cls._id,title:`🗓️ Zajtra: ${cls.name}`,body:`${cls.time_start} · ${cls.location}`,read:false,created_at:nowISO()});
    }
  }

  // ── 3. Post-first-class follow-up (fallback for anyone marked attended) ────
  const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
  const firstTimers = await q.find(db.bookings,{status:'attended',attended_at:{$gte:yesterday+'T00:00:00'}});
  for(const bk of firstTimers){
    if(bk.is_child_booking) continue;
    await sendFirstClassEmail(bk.user_id);
  }

  // ── 3b. No-show detection: confirmed bookings whose date passed, never attended ──
  const pastConfirmed = await q.find(db.bookings,{status:'confirmed',booking_date:{$lt:todayStr}});
  for(const bk of pastConfirmed){
    await q.update(db.bookings,{_id:bk._id},{$set:{status:'no_show',no_show_at:nowISO()}});
    const u = await q.one(db.users,{_id:bk.user_id});
    if(u) await q.update(db.users,{_id:u._id},{$set:{no_show_count:(u.no_show_count||0)+1}});
  }

  // ── 3c. Review ask: after 5th visit, once ─────────────────────────────────
  const reviewUrl = process.env.GOOGLE_REVIEW_URL || '';
  if(reviewUrl){
    const loyal = await q.find(db.users,{visit_count:{$gte:5},is_admin:{$ne:true}});
    for(const u of loyal){
      if(u.review_asked || !u.email) continue;
      await q.update(db.users,{_id:u._id},{$set:{review_asked:true}});
      await sendMail(u.email,'Pomôž nám rásť – ohodnoť nás ⭐',
        emailTemplate('Páči sa ti u nás?',
          `<p>Ahoj <b>${u.name}</b>,</p><p>Už si u nás absolvoval/a <b>${u.visit_count} hodín</b> – ďakujeme! 🙏</p><p>Ak sa ti u nás páči, veľmi nám pomôže krátka recenzia na Google. Zaberie to minútu a pomôže ďalším tanečníkom nás nájsť.</p>`,
          '⭐ Napísať recenziu', reviewUrl)).catch(()=>{});
      await q.insert(db.notifications,{user_id:u._id,type:'review_ask',title:'Ohodnoť nás ⭐',body:'Pomôž nám recenziou na Google.',read:false,created_at:nowISO()});
    }
  }

  // ── 4. Churn re-engagement (14 days no visit) ────────────────────────────
  const cutoff14 = new Date(Date.now()-14*86400000).toISOString().slice(0,10);
  const cutoff15 = new Date(Date.now()-15*86400000).toISOString().slice(0,10);
  const allBkYesterday = await q.find(db.bookings,{created_at:{$gte:cutoff15+'T00:00:00',$lte:cutoff14+'T23:59:59'}});
  const checkedUsers = new Set();
  for(const bk of allBkYesterday){
    if(checkedUsers.has(bk.user_id)) continue;
    checkedUsers.add(bk.user_id);
    const laterBk = await q.find(db.bookings,{user_id:bk.user_id,created_at:{$gte:cutoff14+'T00:00:00'}});
    if(laterBk.length > 0) continue; // visited recently
    const alreadySent = await q.one(db.notifications,{user_id:bk.user_id,type:'churn_reengagement',created_at:{$gte:cutoff14}});
    if(alreadySent) continue;
    const u = await q.one(db.users,{_id:bk.user_id});
    if(!u?.email) continue;
    await sendMail(u.email,'Chýbaš nám! 🥺 Vráť sa na hodiny',
      emailTemplate('Chýbaš nám!',
        `<p>Ahoj <b>${u.name}</b>,</p><p>Všimli sme si, že si bol/a naposledy u nás pred 2 týždňami.</p><p>Vráť sa – tvoje miesto na parkete čaká! 💃</p>`,
        '🗓️ Pozrieť rozvrh',`${APP_URL}/schedule`)).catch(()=>{});
    await q.insert(db.notifications,{user_id:bk.user_id,type:'churn_reengagement',title:'Chýbaš nám! 🥺',body:'Vráť sa na hodiny.',read:false,created_at:nowISO()});
  }

  // ── 5. Win-back coupon (30 days no visit) – 1 free class credit, once ──────
  const cutoff30 = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const cutoff31 = new Date(Date.now()-31*86400000).toISOString().slice(0,10);
  const wbCand = await q.find(db.bookings,{created_at:{$gte:cutoff31+'T00:00:00',$lte:cutoff30+'T23:59:59'}});
  const wbSeen = new Set();
  for(const bk of wbCand){
    if(wbSeen.has(bk.user_id)) continue; wbSeen.add(bk.user_id);
    const laterBk = await q.find(db.bookings,{user_id:bk.user_id,created_at:{$gte:cutoff30+'T00:00:00'}});
    if(laterBk.length>0) continue; // came back
    const u = await q.one(db.users,{_id:bk.user_id});
    if(!u || u.is_admin || u.user_type==='trainer' || u.is_child || u.winback_sent) continue;
    const m = await checkMembership(u._id);
    if(m && m.status==='active') continue; // still has access
    await q.update(db.users,{_id:u._id},{$set:{winback_sent:true, free_credits:(u.free_credits||0)+1}});
    if(u.email) await sendMail(u.email,'Darček pre teba: 1 hodina zadarmo 🎁',
      emailTemplate('Vráť sa – hodina je na nás! 🎁',
        `<p>Ahoj <b>${u.name}</b>,</p><p>Už mesiac sme ťa nevideli a na parkete nám chýbaš!</p><p>Pripravili sme pre teba <b>1 hodinu úplne zadarmo</b> – kredit už máš pripísaný v účte. Stačí prísť. 💃</p>`,
        '🗓️ Rezervovať hodinu zdarma',`${APP_URL}/schedule`)).catch(()=>{});
    await q.insert(db.notifications,{user_id:u._id,type:'winback',title:'🎁 Máš hodinu zadarmo!',body:'Vráť sa na parket – 1 hodina je na nás.',read:false,created_at:nowISO()});
  }

  // ── 6. Weekly admin report (Mondays) ──────────────────────────────────────
  if(new Date().getDay() === 1){
    try { await sendWeeklyAdminReport(); } catch(e){ console.error('Weekly report error:', e.message); }
  }

  // ── 6b. Mesačné výplatné pásky (1. deň v mesiaci, za predošlý mesiac, raz) ──
  if(new Date().getDate() === 1){
    const pm = prevMonthStr();
    const already = await q.one(db.audit,{action:'send_payslips_auto', target:pm});
    if(!already){
      try { const r=await sendAllPayslips(pm); await q.insert(db.audit,{action:'send_payslips_auto',target:pm,after:{sent:r.sent,grand:r.grand},created_at:nowISO()}); }
      catch(e){ console.error('Payslip auto error:', e.message); }
    }
  }

  // ── 6c. Dunning: upomienky na zlyhané platby (deň 3, deň 7) ────────────────
  const failedOpen = (await q.find(db.payments,{status:'failed'})).filter(p=>!p.resolved);
  for(const p of failedOpen){
    const daysSince = Math.floor((Date.now()-new Date(p.failed_at||p.created_at).getTime())/86400000);
    const sent = p.reminders_sent||0;
    if(sent >= DUNNING_DAYS.length) continue; // vyčerpané upomienky
    // ďalšiu upomienku pošli, keď uplynul jej deň a dnes sme ešte neposielali
    if(daysSince >= DUNNING_DAYS[sent] && (p.last_reminder_at||'').slice(0,10) !== todayStr){
      try { await sendDunning(p, sent); } catch(e){ console.error('Dunning error:', e.message); }
    }
  }

  // ── 6d. Odznaky – dávková kontrola + notif priateľom ──────────────────────
  try { await runAchievementsDaily(); } catch(e){ console.error('Achievements daily error:', e.message); }
  // ── 6e. Meniny/narodeniny priateľov (týždeň dopredu + deň pred) ────────────
  try { await runFriendEventsDaily(); } catch(e){ console.error('Friend events error:', e.message); }
  // ── 6e2. Eskalujúce zľavové ponuky pre leadov bez členstva ─────────────────
  try { await runLeadOffers(); } catch(e){ console.error('Lead offers error:', e.message); }
  // ── 6e3. Auto-zaradenie odídených klientov (30+ dní) do winback sekvencie ───
  try {
    const churned = await churnedClients(30);
    for(const c of churned){
      if(c.in_winback || c.offers_optout) continue;
      const u = await q.one(db.users,{_id:c.id});
      if(u?.winback_seq_enrolled) continue; // raz
      await enqueueSequence(c.id,'winback');
      await q.update(db.users,{_id:c.id},{$set:{winback_seq_enrolled:true}});
    }
  } catch(e){ console.error('Winback enroll error:', e.message); }

  // ── 6f. Pripomienky CRM úloh so splatnosťou dnes (priradenému) ─────────────
  try {
    const dueToday = (await q.find(db.crm_tasks,{status:{$ne:'done'}})).filter(t=>t.due_date===todayStr);
    for(const t of dueToday){
      if(!t.assigned_to) continue;
      const already = await q.one(db.notifications,{user_id:t.assigned_to, type:'task_due', ref_id:t._id, created_at:{$gte:todayStr}});
      if(already) continue;
      await q.insert(db.notifications,{user_id:t.assigned_to, type:'task_due', ref_id:t._id,
        title:'⏰ Úloha na dnes', body:`${t.title}${t.client_name?' · '+t.client_name:''}`, read:false, created_at:nowISO()});
    }
  } catch(e){ console.error('Task reminders error:', e.message); }

  // ── 6g. Upsell Bronze → Silver: zaradenie po 14 dňoch na Bronze ────────────
  try {
    const cutoff14 = new Date(Date.now()-14*864e5).toISOString().slice(0,10);
    const bronze = await q.find(db.memberships,{status:'active', plan_id:'bronze'});
    for(const m of bronze){
      const start=(m.started_at||m.created_at||'').slice(0,10);
      if(!start || start>cutoff14) continue;                 // ešte nie 14 dní
      const u = await q.one(db.users,{_id:m.user_id});
      if(!u || !u.email || u.bronze_upsell_enrolled) continue;
      await enqueueSequence(u._id,'bronze_upsell');
      await q.update(db.users,{_id:u._id},{$set:{bronze_upsell_enrolled:true}});
    }
  } catch(e){ console.error('Bronze upsell enrol error:', e.message); }

  // ── 6h. Upsell Silver → Gold: zaradenie po 14 dňoch na Silver ──────────────
  try {
    const cutoff14 = new Date(Date.now()-14*864e5).toISOString().slice(0,10);
    const silver = await q.find(db.memberships,{status:'active', plan_id:'silver'});
    for(const m of silver){
      const start=(m.started_at||m.created_at||'').slice(0,10);
      if(!start || start>cutoff14) continue;
      const u = await q.one(db.users,{_id:m.user_id});
      if(!u || !u.email || u.gold_upsell_enrolled) continue;
      await enqueueSequence(u._id,'gold_upsell');
      await q.update(db.users,{_id:u._id},{$set:{gold_upsell_enrolled:true}});
    }
  } catch(e){ console.error('Gold upsell enrol error:', e.message); }

  // ── 7. Admin alerts (anomaly detection) ───────────────────────────────────
  try { await runAdminAlerts(); } catch(e){ console.error('Admin alerts error:', e.message); }
}

// Detect operational/financial anomalies → post admin_alert notifications (deduped per day)
async function runAdminAlerts(){
  const admins = await q.find(db.users,{is_admin:true});
  if(!admins.length) return [];
  const todayStr = today();
  const raised=[];
  const raise = async(key, severity, title, body)=>{
    // dedupe: same key already raised today?
    const existing = await q.one(db.notifications,{type:'admin_alert', alert_key:key, created_at:{$gte:todayStr+'T00:00:00'}});
    if(existing) return;
    for(const a of admins){
      await q.insert(db.notifications,{user_id:a._id, type:'admin_alert', alert_key:key, severity, title, body, read:false, created_at:nowISO()});
    }
    raised.push({key,severity,title,body});
  };

  // a) Campaigns over budget or poor ROAS
  const campaigns = await q.find(db.campaigns,{});
  const revMap = await campaignRevenueMap();
  for(const c of campaigns){
    const spend=+c.spend||0, budget=+c.budget||0;
    if(budget>0 && spend>budget) await raise('camp_budget_'+c._id,'warning',`💸 Prekročený rozpočet kampane`,`„${c.name}" — minuté ${spend.toFixed(2)} € z ${budget.toFixed(2)} €.`);
    const rev=revMap[(c.name||'').toLowerCase().trim()]?.revenue||0;
    if(spend>=50 && rev/Math.max(spend,1) < 1) await raise('camp_roas_'+c._id,'warning',`📉 Nízke ROAS kampane`,`„${c.name}" — ROAS ${(rev/Math.max(spend,1)).toFixed(2)}× (tržby ${rev.toFixed(2)} €, náklad ${spend.toFixed(2)} €).`);
  }

  // b) Refund rate spike (>5% of revenue this month)
  const monthStr=todayStr.slice(0,7);
  const refundsM=(await q.find(db.refunds,{month:monthStr}));
  const refTotal=refundsM.reduce((s,r)=>s+(+r.amount||0),0);
  const paymentsM=(await q.find(db.payments,{})).filter(p=>['completed','active'].includes(p.status) && (p.captured_at||p.created_at||'').startsWith(monthStr));
  const revM=paymentsM.reduce((s,p)=>s+(+p.amount||0),0);
  if(revM>0 && refTotal/revM>0.05) await raise('refund_spike_'+monthStr,'warning',`↩️ Vysoká miera refundácií`,`Tento mesiac ${((refTotal/revM)*100).toFixed(1)} % tržieb (${refTotal.toFixed(2)} €) refundované.`);

  // c) Failed payments today
  const failsToday=await q.count(db.notifications,{type:'payment_failed',created_at:{$gte:todayStr+'T00:00:00'}});
  if(failsToday>=1) await raise('fails_'+todayStr,'info',`💳 Zlyhané platby dnes`,`${failsToday} neúspešná/é platba/y členstva dnes — skontroluj klientov.`);

  // d) Memberships ending in next 3 days
  const d3=new Date(Date.now()+3*86400000).toISOString();
  const ending=await q.count(db.memberships,{status:'active',expires_at:{$lte:d3,$gte:todayStr+'T00:00:00'}});
  if(ending>=3) await raise('ending_'+todayStr,'info',`⏳ Končiace členstvá`,`${ending} členstiev vyprší do 3 dní — vhodný čas na pripomienku.`);

  return raised;
}

// Weekly summary for admins: revenue, new clients, attendance, class fill, expiries.
// Emailed to each admin + posted as an in-app notification (works without email too).
async function sendWeeklyAdminReport(){
  const now = new Date();
  const wa = new Date(now.getTime()-7*86400000).toISOString();
  const waDate = wa.slice(0,10);
  const users = (await q.find(db.users,{is_admin:{$ne:true}})).filter(u=>u.user_type!=='trainer' && !u.is_child);
  const newClients = users.filter(u=>(u.created_at||'')>=waDate).length;
  const payments = (await q.find(db.payments,{})).filter(p=>['completed','active'].includes(p.status) && (p.captured_at||p.activated_at||p.created_at||'')>=wa);
  const membsCash = (await q.find(db.memberships,{})).filter(m=>!m._type && m.payment_method && (m.created_at||'')>=wa);
  const ordersPaid = (await q.find(db.orders,{})).filter(o=>o.status==='paid' && (o.paid_at||o.created_at||'')>=wa);
  const revenue = payments.reduce((s,p)=>s+(+p.amount||0),0) + membsCash.reduce((s,m)=>s+(+m.price||0),0) + ordersPaid.reduce((s,o)=>s+(+o.total||0),0);
  const attended = (await q.find(db.bookings,{status:'attended',attended_at:{$gte:wa}})).length;
  const noShows = (await q.find(db.bookings,{no_show_at:{$gte:wa}})).length;
  const classes = (await q.find(db.classes,{active:true})).filter(c=>c.category!=='Online' && (c.location||'').toLowerCase()!=='online');
  const recentBk = await q.find(db.bookings,{booking_date:{$gte:waDate}});
  const perClass = classes.map(c=>{
    const bks = recentBk.filter(b=>b.class_id===c._id && b.status!=='cancelled');
    return {name:c.name, location:c.location, day:c.day_of_week, count:bks.length, cap:c.capacity||0};
  }).sort((a,b)=>b.count-a.count);
  const top = perClass.slice(0,3);
  const flop = perClass.filter(c=>c.cap? c.count < c.cap*0.4 : c.count<4).slice(-3).reverse();
  const in7 = new Date(now.getTime()+7*86400000).toISOString();
  const expiring = (await q.find(db.memberships,{status:'active'})).filter(m=>!m._type && m.expires_at && m.expires_at>=now.toISOString() && m.expires_at<=in7).length;
  const dayN=['Ne','Po','Ut','St','Št','Pi','So'];
  const rows = arr => arr.length ? arr.map(c=>`<li>${c.name} — ${dayN[c.day]} · ${c.location||''}: <b>${c.count}</b> rezervácií${c.cap?` / ${c.cap}`:''}</li>`).join('') : '<li>—</li>';
  const body = `
    <p>Prehľad za posledných 7 dní:</p>
    <div style="background:#1c1c1c;border-radius:12px;padding:16px 18px;margin:12px 0">
      <div style="font-size:15px;margin-bottom:6px">💶 Tržby: <b style="color:#C9A84C">${revenue.toFixed(2)} €</b></div>
      <div style="font-size:15px;margin-bottom:6px">🆕 Noví klienti: <b>${newClients}</b></div>
      <div style="font-size:15px;margin-bottom:6px">✅ Absolvované: <b>${attended}</b> · ❌ No-shows: <b>${noShows}</b></div>
      <div style="font-size:15px">⏳ Členstvá expirujúce do 7 dní: <b>${expiring}</b></div>
    </div>
    <p style="margin:14px 0 4px"><b>🔥 Najvyťaženejšie hodiny</b></p><ul style="color:#ccc;line-height:1.7">${rows(top)}</ul>
    <p style="margin:14px 0 4px"><b>🧊 Najslabšie hodiny</b> (treba doplniť)</p><ul style="color:#ccc;line-height:1.7">${rows(flop)}</ul>`;
  const admins = await q.find(db.users,{is_admin:true});
  for(const a of admins){
    if(a.email) await sendMail(a.email,'📊 Týždenný prehľad Fusion Academy', emailTemplate('Týždenný prehľad 📊', body, '🔎 Otvoriť admin panel', `${APP_URL}/admin`)).catch(()=>{});
    await q.insert(db.notifications,{user_id:a._id,type:'weekly_report',title:'📊 Týždenný prehľad',body:`Tržby ${revenue.toFixed(2)} €, ${newClients} nových, ${attended} hodín, ${noShows} no-shows.`,read:false,created_at:nowISO()});
  }
}

// Run daily at ~08:00 server time (check every hour)
setInterval(async()=>{
  const h = new Date().getHours();
  if(h === 8){
    try{ await runDailyJobs(); }catch(e){ console.error('Cron error:',e); }
    try{ await processEmailQueue(); }catch(e){ console.error('Email queue error:',e); }
  }
}, 3600000);

// ─── Start ────────────────────────────────────────────────────────────────────
// Jednorazová migrácia: každého existujúceho člena bez sponzora priraď pod
// zakladateľa (Marek Gruber). Beží raz (guard cez audit), takže neskoršie
// manuálne „bez sponzora" na profile ostane rešpektované.
async function backfillDefaultSponsor(){
  try {
    const founder = await q.one(db.users,{email:'gruber.marek@gmail.com'});
    if(!founder) return;
    if(await q.one(db.audit,{action:'migrate_default_sponsor_v1'})) return;
    const orphans = await q.find(db.users,{ $or:[{sponsor_id:null},{sponsor_id:{$exists:false}}] });
    let n=0;
    for(const u of orphans){
      if(u._id===founder._id) continue; // zakladateľ je koreň
      await q.update(db.users,{_id:u._id},{$set:{sponsor_id:founder._id}});
      n++;
    }
    await q.insert(db.audit,{action:'migrate_default_sponsor_v1',target:'users',after:{assigned:n,founder:founder._id},created_at:nowISO()});
    console.log(`✅  Default sponzor: ${n} používateľov priradených pod zakladateľa`);
  } catch(e){ console.error('backfillDefaultSponsor error:', e.message); }
}

// Bezpečné dorovnanie návštev: ak má člen uložený Glofox počet (glofox_attendances)
// vyšší než visit_count, zdvihni visit_count naň. Nikdy neznižuje → nič nerozbije.
// Rieši prípad, keď sa importovaný počet odtancovaných hodín nedostal do visit_count.
async function reconcileGlofoxVisits(){
  try {
    const rows = await q.find(db.users,{glofox_attendances:{$exists:true}});
    let fixed=0;
    for(const u of rows){
      const ga=+u.glofox_attendances||0;
      if(ga > (u.visit_count||0)){ await q.update(db.users,{_id:u._id},{$set:{visit_count:ga}}); fixed++; }
    }
    if(fixed) console.log(`✅  Návštevy dorovnané podľa Glofox záznamov: ${fixed} členov`);
  } catch(e){ console.error('reconcileGlofoxVisits error:', e.message); }
}

// Hodiny bez prideleného trénera (alebo „Fusion Team") → prideľ zakladateľovi.
// Metabolická analýza / InBody nie je hodina (bonus pred/po hodine) → skry z rozvrhu.
async function fixClassesInstructors(){
  try {
    const founder = await q.one(db.users,{email:'gruber.marek@gmail.com'});
    const fname = founder?.name || 'Marek Gruber';
    const classes = await q.find(db.classes,{});
    let reassigned=0, hidden=0;
    for(const c of classes){
      const nm = (c.name||'').toLowerCase();
      if(nm.includes('metabolick') || nm.includes('inbody')){
        if(c.active!==false){ await q.update(db.classes,{_id:c._id},{$set:{active:false}}); hidden++; }
        continue;
      }
      // Len „Fusion Team" / prázdny tréner → zakladateľ. Menovaných trénerov
      // (napr. Beáta) nechávame, aj keď nemajú instructor_id.
      const noTrainer = !((c.instructor||'').trim()) || c.instructor==='Fusion Team';
      if(noTrainer){
        await q.update(db.classes,{_id:c._id},{$set:{instructor:fname, instructor_id:founder?._id||''}});
        reassigned++;
      }
    }
    if(reassigned||hidden) console.log(`✅  Hodiny: ${reassigned} pridelených zakladateľovi, ${hidden} skrytých (metabolická analýza)`);
  } catch(e){ console.error('fixClassesInstructors error:', e.message); }
}

seedData().then(backfillDefaultSponsor).then(reconcileGlofoxVisits).then(fixClassesInstructors).then(()=>{
  server.listen(PORT, ()=>{
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  🎵  Fusion Academy – Systém v2.0 spustený             ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log(`\n🛍️  E-shop:      http://localhost:${PORT}/shop`);
    console.log(`🗓️  Rozvrh:      http://localhost:${PORT}/schedule`);
    console.log(`💬  Komunita:    http://localhost:${PORT}/community`);
    console.log(`🌐  Hlavná:      http://localhost:${PORT}`);
    console.log(`⚙️   Admin:       http://localhost:${PORT}/admin`);
    console.log('👤  Admin login: admin@fusionacademy.sk / admin123\n');
  });
}).catch(e=>{console.error('Chyba pri spustení:', e); process.exit(1);});

// ── 404 page ──────────────────────────────────────────────────────────────────
app.use((req,res,next)=>{
  if(req.path.startsWith('/api')) return next();
  res.status(404).sendFile(path.join(__dirname,'public','404.html'));
});
// ── API 404 ───────────────────────────────────────────────────────────────────
app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint nenájdený'}));
