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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
// Trust Railway / reverse-proxy HTTPS headers
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'fusion-dev-secret-change-in-production-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000  // 30 days – stays logged in until browser closed/explicit logout
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
};
db.users.ensureIndex({ fieldName: 'email',         unique: true });
db.users.ensureIndex({ fieldName: 'referral_code', unique: true, sparse: true });
db.bookings.ensureIndex({ fieldName: 'created_at' });
db.messages.ensureIndex({ fieldName: 'created_at' });

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
  { visits:5,   badge:'🌟', label:'Prvých 5 hodín',  color:'#8bc34a', reward:null },
  { visits:10,  badge:'⭐', label:'Pravidelný člen',  color:'#ffc107', reward:'Zľava 10 % na ďalší nákup' },
  { visits:20,  badge:'🥉', label:'Bronzový člen',   color:'#cd7f32', reward:'Fusion fľaša zadarmo' },
  { visits:30,  badge:'🥈', label:'Strieborný člen', color:'#9e9e9e', reward:'Zľava 15 % na mesačné členstvo' },
  { visits:50,  badge:'🥇', label:'Zlatý člen',      color:'#C9A84C', reward:'Fusion tričko zadarmo' },
  { visits:75,  badge:'💎', label:'Diamantový člen', color:'#2196f3', reward:'Mesiac zdarma' },
  { visits:100, badge:'👑', label:'Legenda',          color:'#C9A84C', reward:'VIP odmena – zistíš pri odovzdaní 😊' },
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
  const partner=await q.one(db.users,{_id:partnerId});
  const rank=RANKS[(partner?.rank||1)-1];
  const month=currentMonth();
  await q.insert(db.commissions,{transaction_id:txId,partner_id:partnerId,source_partner_id:partnerId,level:0,percentage:rank.directRate,amount:+(amount*rank.directRate).toFixed(2),status:'pending',month,created_at:nowISO()});
  let curId=partnerId;
  for(let lvl=1;lvl<=7;lvl++){
    const cur=await q.one(db.users,{_id:curId});
    if(!cur?.sponsor_id) break;
    const up=await q.one(db.users,{_id:cur.sponsor_id});
    if(!up) break;
    const upRank=RANKS[(up.rank||1)-1];
    if(lvl<=upRank.levels && await getPersonal30(up._id)>=100){
      const rate=LEVEL_RATES[lvl-1];
      await q.insert(db.commissions,{transaction_id:txId,partner_id:up._id,source_partner_id:partnerId,level:lvl,percentage:rate,amount:+(amount*rate).toFixed(2),status:'pending',month,created_at:nowISO()});
    }
    curId=up._id;
  }
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
const auth      = (req,res,next) => req.session.uid ? next() : res.status(401).json({error:'Nie ste prihlásený'});
const adminAuth = async(req,res,next) => {
  if(!req.session.uid) return res.status(401).json({error:'Nie ste prihlásený'});
  const u=await q.one(db.users,{_id:req.session.uid});
  if(!u?.is_admin) return res.status(403).json({error:'Nemáte oprávnenie'});
  req.user=u; next();
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

  // Products
  if(await q.count(db.products,{})===0){
    const prods=[
      {cat:'Členstvá',  name:'Jednorazový vstup',             emoji:'🎫', desc:'Vstup na akúkoľvek lekciu v ktoromkoľvek meste.',                         price:10,    commission_rate:0.10, type:'single',       active:true},
      {cat:'Členstvá',  name:'10-vstupová permanentka',       emoji:'🎟️', desc:'10 vstupov, platnosť 3 mesiace. Úspora 20 %.',                            price:80,    commission_rate:0.12, type:'bundle',       active:true},
      {cat:'Členstvá',  name:'Členstvo BRONZE',               emoji:'🥉', desc:'Neobmedzené Zumba lekcie vo všetkých 4 mestách. Mesačne.',                 price:50,    commission_rate:0.15, type:'subscription', active:true},
      {cat:'Členstvá',  name:'Členstvo SILVER',               emoji:'🥈', desc:'Bronze + metabolická analýza mesačne + online prístup.',                   price:65,    commission_rate:0.15, type:'subscription', active:true},
      {cat:'Členstvá',  name:'Členstvo GOLD',                 emoji:'🥇', desc:'Silver + Fusion kokteil + individuálny jedálny plán.',                     price:125,   commission_rate:0.18, type:'subscription', active:true},
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
      {name:'Zumba Fitness',               emoji:'🎵', category:'Zumba',    instructor:'Marek Gruber',              location:'Detva',                       address:'Fusion Academy, Záhradná 7, Detva',                   day_of_week:0, time_start:'19:00', time_end:'20:00', capacity:20,  level:'Všetky úrovne',  description:'Zumba v Detve! Latino rytmy, energia a komunita. Spáliš 400–600 kcal. Prvá hodina ZADARMO!',                         price:10, color:'#C9A84C', active:true},
      {name:'Detské spoločenské tance',     emoji:'🧒', category:'Deti',     instructor:'Marek Gruber',              location:'Detva',                       address:'Fusion Academy, Záhradná 7, Detva',                   day_of_week:0, time_start:'15:00', time_end:'16:00', capacity:12,  level:'Deti 5–17 rokov', description:'Spoločenské tance pre deti. Držanie tela, rytmus, sebavedomý pohyb. Vhodné pre vek 5–17 rokov.',                   price:9,  color:'#F0C060', active:true},
      // Pondelok (1)
      {name:'Zumba Fitness',               emoji:'🎵', category:'Zumba',    instructor:'Beáta Gruber Buňová',       location:'Zvolen',                      address:'Fitko Gymkova, M.R. Štefánika 805, Zvolen',            day_of_week:1, time_start:'19:00', time_end:'20:00', capacity:25,  level:'Všetky úrovne',  description:'Zumba vo Zvolene! Energetická hodina latinského fitnes tanca. Spáliš 400–600 kcal. Prvá hodina ZADARMO!',           price:10, color:'#C9A84C', active:true},
      {name:'Zumba Fitness',               emoji:'🎵', category:'Zumba',    instructor:'Fusion Team',               location:'Banská Bystrica',             address:'R2N Business centrum, Sládkovičova 29, Banská Bystrica',day_of_week:1, time_start:'17:00', time_end:'18:00', capacity:25,  level:'Všetky úrovne',  description:'Zumba v Banskej Bystrici! Latínske rytmy, energia a komunita. Prvá hodina ZADARMO!',                                 price:10, color:'#C9A84C', active:true},
      // Utorok (2)
      {name:'Zumba Fitness',               emoji:'🎵', category:'Zumba',    instructor:'Fusion Team',               location:'Brezno',                      address:'Fitko LÉGIA, Fraňa Kráľa 1/A, Brezno',                day_of_week:2, time_start:'19:00', time_end:'20:00', capacity:20,  level:'Všetky úrovne',  description:'Zumba v Brezne! Latino fitness pre každého. Spáliš 400–600 kcal za hodinu.',                                         price:10, color:'#C9A84C', active:true},
      {name:'Zumba ONLINE – LIVE',         emoji:'🌐', category:'Online',   instructor:'Beáta Gruber Buňová',       location:'Online',                      address:'Živé vysielanie zo Zvolena – link po registrácii',     day_of_week:2, time_start:'19:00', time_end:'20:00', capacity:100, level:'Všetky úrovne',  description:'Živé online Zumba hodiny z pohodlia domova. Odkiaľkoľvek na Slovensku aj v zahraničí. Online členstvo od 12.90 €/mes.', price:6, color:'#2196f3', active:true},
      // Streda (3)
      {name:'Zumba Fitness',               emoji:'🎵', category:'Zumba',    instructor:'Beáta Gruber Buňová',       location:'Zvolen',                      address:'Fitko Gymkova, M.R. Štefánika 805, Zvolen',            day_of_week:3, time_start:'17:00', time_end:'18:00', capacity:25,  level:'Všetky úrovne',  description:'Stredajšia Zumba vo Zvolene! Skvelý stred týždňa s latinskými rytmami.',                                            price:10, color:'#C9A84C', active:true},
      {name:'Zumba Fitness',               emoji:'🎵', category:'Zumba',    instructor:'Fusion Team',               location:'Banská Bystrica',             address:'R2N Business centrum, Sládkovičova 29, Banská Bystrica',day_of_week:3, time_start:'19:00', time_end:'20:00', capacity:25,  level:'Všetky úrovne',  description:'Streda patrí Zumbe v BB! Energetická hodina latinského tanca.',                                                      price:10, color:'#C9A84C', active:true},
      // Štvrtok (4)
      {name:'Zumba Fitness',               emoji:'🎵', category:'Zumba',    instructor:'Fusion Team',               location:'Brezno',                      address:'Fitko LÉGIA, Fraňa Kráľa 1/A, Brezno',                day_of_week:4, time_start:'19:00', time_end:'20:00', capacity:20,  level:'Všetky úrovne',  description:'Štvrtok = Zumba v Brezne! Latínsky rytmus a dobrá nálada.',                                                          price:10, color:'#C9A84C', active:true},
      // Piatok (5)
      {name:'Zumba Fitness',               emoji:'🎵', category:'Zumba',    instructor:'Marek Gruber',              location:'Detva',                       address:'Fusion Academy, Záhradná 7, Detva',                   day_of_week:5, time_start:'19:00', time_end:'20:00', capacity:20,  level:'Všetky úrovne',  description:'Piatok patrí Zumbe v Detve! Latino rytmy a komunita. Prvá hodina ZADARMO!',                                          price:10, color:'#C9A84C', active:true},
      {name:'Detské spoločenské tance',     emoji:'🧒', category:'Deti',     instructor:'Marek Gruber',              location:'Detva',                       address:'Fusion Academy, Záhradná 7, Detva',                   day_of_week:5, time_start:'15:00', time_end:'16:00', capacity:12,  level:'Deti 5–17 rokov', description:'Spoločenské tance pre deti. Držanie tela, rytmus, sebavedomý pohyb. Vhodné pre vek 5–17 rokov.',                   price:9,  color:'#F0C060', active:true},
      // Sobota (6)
      {name:'FitDays Workshop',            emoji:'🏆', category:'FitDays',  instructor:'Marek Gruber & Beáta Gruber Buňová', location:'Detva',              address:'Fusion Academy, Záhradná 7, Detva',                   day_of_week:6, time_start:'10:00', time_end:'16:00', capacity:30,  level:'Všetky úrovne',  description:'FitDays – celodenný workshop každé 2 týždne. Program: výživa, motivácia, kariérny rozvoj, osobný rast, Zumba párty, refreshments a afterparty. Hostia: Zuzana Duong Záp., Daniel Duong, Beáta & Marek Gruber. Cena: 25 €.', price:25, color:'#C9A84C', active:true},
      {name:'Súkromná lekcia – rezervácia',emoji:'👤', category:'Súkromné', instructor:'Marek Gruber',              location:'Detva / Zvolen / BB / Brezno', address:'Podľa dohody – všetky mestá',                        day_of_week:6, time_start:'09:00', time_end:'18:00', capacity:1,   level:'Individuálne',   description:'Súkromná 60-min. lekcia s Marekom Gruberom. Choreografia na mieru, spoločenské tance, Pro-Am, svadobný tanec. Rezervácia: +421 904 315 151.',                                                                           price:70, color:'#9c27b0', active:true},
      {name:'Metabolická analýza (InBody)', emoji:'📊', category:'Wellness', instructor:'Marek Gruber',             location:'Detva',                       address:'Fusion Academy, Záhradná 7, Detva',                   day_of_week:6, time_start:'09:00', time_end:'17:00', capacity:15,  level:'Všetky úrovne',  description:'Rezervujte si termín InBody analýzy. Bazálny metabolizmus, % tuku, svalová hmota, biologický vek. Zahrnuté v Silver a Gold členstve.',                                                                                  price:35, color:'#00bcd4', active:true},
    ];
    for(const c of classes) await q.insert(db.classes, c);
    console.log('✅  Rozvrh naplnený');
  }

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
      {title:'Herbalife — prečo je jednotka v kvalite doplnkov výživy', cat:'Výživa', date:'16.4.2026',
       text:`🌿 Prečo odporúčame Herbalife vo Fusion Academy?\n\nTrh s doplnkami výživy je plný nekvalitných produktov. Tu je prečo sme si vybrali Herbalife:\n\n✅ Na trhu od roku 1980 — 90+ krajín\n✅ Vedecká rada vrátane Nobelovho laureáta Lou Ignarroa\n✅ Vlastné farmy — kontrola od semena po produkt\n✅ Certifikácie: Informed-Sport, NSF\n✅ Používajú ich FC Barcelona, Cristiano Ronaldo\n\n🥤 Formula 1 shake:\n• 220 kcal, 18g bielkovín, 23 vitamínov a minerálov\n• Príprava za 30 sekúnd, cca 1.50 €/dávka\n• Flavors: vanilka, čokoláda, jahoda, café latte\n\n📱 Chceš vedieť viac? Napíš nám alebo pozri e-shop!`},
      {title:'F1 kokteil — raňajky, ktoré ti zmenia deň', cat:'Výživa', date:'19.4.2026',
       text:`☀️ Raňajky za 30 sekúnd — Formula 1 kokteil\n\nVäčšina ľudí raňajkuje zle. Biely chlieb, sladké cereálie, káva. Energetický krach o 10:00.\n\nAlternatíva:\n• Formula 1 shake = 220 kcal, 18g bielkovín\n• Príprava: 30 sekúnd, rozmixuj s mliekom\n• Cena: cca 1.50 €/dávka\n\nPorovnanie bežných raňajok:\n❌ Bežné raňajky: 400–550 kcal, minimum bielkovín\n✅ F1 shake: 220 kcal, 18g bielkovín, 23 vitamínov\n\n🥇 Gold členstvo zahŕňa F1 shake na celý mesiac + neobmedzené tréningy + metabolická analýza za 125 €/mes\n\n👉 Vyskúšaj 30 dní a uvidíš rozdiel. Kontakt: +421 904 315 151`},
      {title:'Zumba v Detve, Zvolene, Banskej Bystrici a Brezne', cat:'Zumba', date:'16.4.2026',
       text:`🗺️ Kompletný sprievodca Zumby vo Fusion Academy\n\nRozvrh hodín:\n📍 Detva (Záhradná 7): Piatok 19:00, Nedeľa 19:00\n📍 Zvolen (Fitko Gymkova): Pondelok 19:00, Streda 17:00\n📍 Banská Bystrica (R2N Biz centrum): Pondelok 17:00, Streda 19:00\n📍 Brezno (Fitko LÉGIA): Utorok 19:00, Štvrtok 19:00\n🌐 Online LIVE: Utorok 19:00 | 12.90 €/mes\n\n💰 Ceny:\n• Jednorazovo: 10 €\n• 10-vstupová permanentka: 80 €\n• Bronze členstvo: 50 €/mes (neobmedzene)\n\n🎁 Prvá hodina ZADARMO!\n\n"Nikto sa na teba nepozerá — každý rieši samého seba" 😊`},
      {title:'Spoločenské tance pre dospelých — začať môžeš aj bez partnera', cat:'Tanec', date:'16.4.2026',
       text:`👫 Spoločenské tance pre dospelých\n\nNemáš partnera? Nevadí! Na naše hodiny chodia aj jednotlivci.\n\nČo sa naučíš:\n🕺 Štandardné tance: valčík, tango, slowfox\n💃 Latinsko-americké: cha-cha, samba, rumba, jive\n\nPre koho:\n• Páry pripravujúce svadobný tanec\n• Rodičia chcú zatancovať na plese s deťmi\n• Každý, kto hľadá elegantný pohyb\n\n"80 % ľudí, čo prídu, tancuje zhrbených — to je prvá vec, ktorú opravíme"\n\n📍 Pravidelné skupiny: Detva\n📍 Súkromné hodiny: Zvolen, BB, Brezno\n💰 Od 45 €/hodina súkromne | Skupiny od 10 €/vstup\n🎁 Prvá hodina ZADARMO — volaj 0904 31 51 51`},
      {title:'Príbeh Beátky — −17 kg za rok vďaka Zumbe a výžive', cat:'Príbeh', date:'16.4.2026',
       text:`⭐ Príbeh Beátky: −17 kg za rok\n\nBeátka prišla do Fusion Academy pred rokom s miernymi očakávaniami. Dnes je o 17 kg ľahšia.\n\nJej cesta:\n✅ 3–4× týždenne Zumba (vo všetkých 4 mestách)\n✅ Eliminácia cukru a zvýšenie bielkovín\n✅ Herbalife shake na rýchle dni\n✅ Priorita spánku a pitného režimu\n\nVýsledky po 12 mesiacoch:\n• −17 kg\n• Lepšie trávenie\n• Viac energie celý deň\n• Lepší spánok a nálada\n\n💬 "Prišla som schudnúť. Odchádzam so svojou rodinou a sama so sebou tak, ako som sa nevidela 15 rokov."\n\n👉 Tvoja premena môže začať dnes. Prvá hodina zadarmo!`},
      {title:'Príbeh Nelky zo Zvolena — z klientky trénerkou', cat:'Príbeh', date:'16.4.2026',
       text:`🌟 Príbeh Nelky: z klientky trénerkou\n\nNelka (14 rokov, Zvolen) prišla pred 2 rokmi s tráviacimi problémami a únavou. Dnes vedie detské tanečné hodiny sama.\n\nProgram:\n• 2–3× týždenne tanec\n• Výživové úpravy pre tínedžerov\n• Herbalife doplnky\n• Komunita a podpora\n\nVýsledky:\n✅ Tráviace problémy zmizli do niekoľkých mesiacov\n✅ Výrazne viac energie\n✅ Zlepšili sa školské výsledky\n✅ Objavila talent na pedagogiku — teraz vyučuje deti\n\n💡 Vek 12–16 je kľúčový pre celoživotný vzťah k pohybu. Keď sa pohyb stane zábavou — nie povinnosťou — mladí ľudia si ho udržia navždy.\n\n📞 Prvá hodina ZADARMO: +421 904 315 151`},
      {title:'Príbeh Mišky — −5 kg za 2 mesiace a zmena celej rodiny', cat:'Príbeh', date:'16.4.2026',
       text:`💪 Príbeh Mišky zo Zvolena: −5 kg za 2 mesiace\n\nMiška sa prihlásila do Fit Premena programu s jediným cieľom: opäť sa zmestiť do svojich obľúbených šiat.\n\nProgram (Fit Premena):\n📊 Metabolická analýza → personalizovaný plán\n🥗 Jedálniček na mieru s reálnymi porciami\n🥤 Herbalife shake ako náhrada 1 jedla\n💃 2× týžd. Zumba v Zvolene\n📋 Týždenné check-iny\n\nVýsledky za 2 mesiace:\n• −5 kg, −4 cm v páse\n• Opäť sa zmestila do svojich šiat ✅\n• Celá rodina začala jesť zdravšie\n\n💬 "Začala som so sebou. Skončilo to tým, že sa zmenila celá naša kuchyňa. Najlepšia investícia za roky."\n\n👉 Fit Premena program od 65 €/mes`},
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
    const APP = process.env.APP_URL||'https://latindancefusion.art';
    const steps = [
      // ── WELCOME (po registrácii) ─────────────────────────────────────────────
      { sequence:'welcome', day:0, label:'Uvítací email', active:true,
        subject:'Vitaj vo Fusion Academy! 🎉',
        body:`<p>Sme nadšení, že si tu!</p><p>Vo Fusion Academy ťa čaká:</p><ul><li>💃 Zumba, spoločenské tance, Fit Premena</li><li>📍 4 mestá: Detva, Zvolen, BB, Brezno</li><li>👥 Komunita stoviek spokojných klientok</li></ul><p>Ako začať? <b>Prvá hodina je ZADARMO</b> — bez záväzku, bez platby.</p>`,
        cta:'🗓️ Rezervovať prvú hodinu zadarmo', cta_url:`${APP}/schedule` },
      { sequence:'welcome', day:3, label:'Tip po 3 dňoch', active:true,
        subject:'Tip pre teba: ako vybrať správnu hodinu 💃',
        body:`<p>Nevieš, čia hodina je pre teba? Poradíme!</p><ul><li><b>Zumba</b> – chudnutie, energia, zábava. Ideálne pre začiatočníkov.</li><li><b>Spoločenské tance</b> – elegancia, plesová príprava, páry aj jednotlivci.</li><li><b>Fit Premena</b> – komplexný program s výživou a coachingom.</li></ul><p>Zapíš sa na tú, čo ťa zaujíma – <b>prvá je zadarmo</b>.</p>`,
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/login', async(req,res)=>{
  try {
    const {email,password}=req.body;
    const u=await q.one(db.users,{email:(email||'').toLowerCase().trim()});
    if(!u||!(await bcrypt.compare(password,u.password))) return res.status(401).json({error:'Nesprávny email alebo heslo'});
    if(u.active===false) return res.status(403).json({error:'Váš účet je zablokovaný. Kontaktujte správcu.'});
    req.session.uid=u._id;
    const redirect_to = dashUrlFor(u);
    res.json({ok:true, isAdmin:!!u.is_admin, userType:u.user_type||'partner', redirect_to});
  } catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/logout',(req,res)=>{ req.session.destroy(); res.json({ok:true}); });

app.post('/api/register', async(req,res)=>{
  try {
    const {name,email,password,phone,sponsorCode,user_type}=req.body;
    if(!name||!email||!password) return res.status(400).json({error:'Meno, email a heslo sú povinné'});
    let sponsor_id=null;
    if(sponsorCode&&sponsorCode.toUpperCase()!=='ADMIN'){
      const sp=await q.one(db.users,{referral_code:new RegExp('^'+sponsorCode+'$','i')});
      if(!sp) return res.status(400).json({error:'Referral kód neexistuje'});
      sponsor_id=sp._id;
    }
    const base=name.split(' ')[0].toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
    let code=base+Math.floor(10+Math.random()*90);
    while(await q.one(db.users,{referral_code:code})) code=base+Math.floor(100+Math.random()*900);
    // All new users are 'client' — they can earn referral rewards right away
    const utype = user_type || 'client';
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
    const u=await q.insert(db.users,{name,email:email.toLowerCase().trim(),password:await bcrypt.hash(password,10),phone:phone||'',referral_code:code,sponsor_id,rank:1,is_admin:false,active:true,user_type:utype,bank_account:'',notes:'',visit_count:0,referral_credit:0,lead_source,utm_source,utm_medium,utm_campaign,fbclid,gclid,landing_page:clean(attr.landing),referrer:clean(attr.referrer),created_at:today()});
    req.session.uid=u._id;
    // ── Give sponzor referral credit (5€ za každého nového člena) ─────────────
    if(sponsor_id){
      const REFERRAL_SIGNUP_CREDIT = 5; // € za registráciu
      const sp = await q.one(db.users,{_id:sponsor_id});
      if(sp){
        const newCredit = +((sp.referral_credit||0) + REFERRAL_SIGNUP_CREDIT).toFixed(2);
        await q.update(db.users,{_id:sponsor_id},{$set:{referral_credit: newCredit}});
        await q.insert(db.notifications,{user_id:sponsor_id,type:'referral_credit',title:`+${REFERRAL_SIGNUP_CREDIT} € referral kredit! 🎉`,body:`${name} sa zaregistroval/a cez tvoj link. Zostatok: ${newCredit} €`,read:false,created_at:nowISO()});
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
app.get('/api/config', (req,res)=>{
  res.json({
    paypal_client_id: PAYPAL_CLIENT_ID||'sb', paypal_env: PAYPAL_ENV,
    meta_pixel_id: process.env.META_PIXEL_ID||'',
    google_ads_id: process.env.GOOGLE_ADS_ID||''
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
  const users=await q.find(db.users,{is_admin:{$ne:true},active:true,is_child:{$ne:true}});
  const result=users.map(u=>({
    id:u._id, name:u.name,
    user_type:u.user_type||'partner',
    rankBadge: RANKS[(u.rank||1)-1].badge,
    memberBadge: getMemberBadge(u.created_at),
    created_at: u.created_at,
  })).sort((a,b)=>a.name.localeCompare(b.name));
  res.json(result);
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
  const{phone,bank_account}=req.body;
  await q.update(db.users,{_id:req.session.uid},{$set:{phone:phone||'',bank_account:bank_account||''}});
  res.json({ok:true});
});

app.post('/api/profile/password', auth, async(req,res)=>{
  const{current,newPass}=req.body;
  const u=await q.one(db.users,{_id:req.session.uid});
  if(!(await bcrypt.compare(current,u.password))) return res.status(400).json({error:'Nesprávne aktuálne heslo'});
  await q.update(db.users,{_id:req.session.uid},{$set:{password:await bcrypt.hash(newPass,10)}});
  res.json({ok:true});
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/admin/stats', adminAuth, async(req,res)=>{
  const month=currentMonth();
  const allU=await q.find(db.users,{is_admin:{$ne:true}});
  const allTx=await q.find(db.transactions,{});
  const allC=await q.find(db.commissions,{});
  const allO=await q.find(db.orders,{});
  const allB=await q.find(db.bookings,{});
  const sixAgo=new Date(); sixAgo.setMonth(sixAgo.getMonth()-6);
  const monthMap={};
  for(const t of allTx){const m=t.date.slice(0,7);if(m>=sixAgo.toISOString().slice(0,7)){if(!monthMap[m])monthMap[m]={total:0,cnt:0};monthMap[m].total+=t.amount;monthMap[m].cnt++;}}
  const prodMap={};
  for(const t of allTx){if(!prodMap[t.product_name])prodMap[t.product_name]={cnt:0,total:0};prodMap[t.product_name].cnt++;prodMap[t.product_name].total+=t.amount;}
  const rankMap={};
  for(const u of allU){const r=u.rank||1;rankMap[r]=(rankMap[r]||0)+1;}
  res.json({
    totalPartners:allU.length, activePartners:allU.filter(u=>u.active).length,
    monthRevenue:+allTx.filter(t=>t.date.startsWith(month)).reduce((s,t)=>s+t.amount,0).toFixed(2),
    totalRevenue:+allTx.reduce((s,t)=>s+t.amount,0).toFixed(2),
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

app.post('/api/admin/partners', adminAuth, async(req,res)=>{
  const{name,email,password,phone,sponsor_id,bank_account,user_type}=req.body;
  if(!name||!email||!password) return res.status(400).json({error:'Meno, email a heslo sú povinné'});
  const base=name.split(' ')[0].toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
  let code=base+Math.floor(10+Math.random()*90);
  while(await q.one(db.users,{referral_code:code})) code=base+Math.floor(100+Math.random()*900);
  try {
    const u=await q.insert(db.users,{name,email:email.toLowerCase().trim(),password:await bcrypt.hash(password,10),phone:phone||'',referral_code:code,sponsor_id:sponsor_id||null,bank_account:bank_account||'',rank:1,is_admin:false,active:true,user_type:user_type||'partner',notes:'',created_at:today()});
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
        await sendMail(u.email,'⚠️ Tvoje členstvo čoskoro vyprší',`<h2>Ahoj ${u.name}!</h2><p>Tvoje členstvo <b>${m.plan_name}</b> vyprší <b>${m.expires_at}</b>.</p><p>👉 <a href="https://latindancefusion.art/pricing">Obnov si členstvo</a> a neprerušuj svoju cestu!</p><p><i>Fusion Academy tím 💃</i></p>`).catch(()=>{});
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
    const{partner_id,client_name,product_id,amount,notes,date}=req.body;
    if(!partner_id||!client_name||!amount) return res.status(400).json({error:'Partner, klient a suma sú povinné'});
    const prod=product_id?await q.one(db.products,{_id:product_id}):null;
    const product_name=prod?prod.name:(req.body.product_name||'Iný predaj');
    const finalAmt=+parseFloat(amount).toFixed(2);
    const tx=await q.insert(db.transactions,{partner_id,client_name,product_id:product_id||null,product_name,amount:finalAmt,date:date||today(),notes:notes||''});
    await saveCommissions(tx._id,partner_id,finalAmt);
    await calcRank(partner_id);
    res.json({ok:true,id:tx._id});
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
    const{status}=req.body;
    const order=await q.one(db.orders,{_id:req.params.id});
    if(!order) return res.status(404).json({error:'Nenájdená'});
    await q.update(db.orders,{_id:req.params.id},{$set:{status,updated_at:nowISO(),...(status==='paid'?{paid_at:nowISO()}:{})}});
    if(status==='paid'&&order.partner_id&&order.status!=='paid'){
      for(const item of order.items){
        const tx=await q.insert(db.transactions,{partner_id:order.partner_id,client_name:order.client_name,product_id:item.product_id||null,product_name:item.product_name,amount:item.subtotal,date:today(),notes:'E-shop objednávka '+order.order_number,order_id:order._id});
        await saveCommissions(tx._id,order.partner_id,item.subtotal);
      }
      await calcRank(order.partner_id);
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

app.post('/api/admin/classes', adminAuth, async(req,res)=>{
  const{name,emoji,category,instructor,location,day_of_week,time_start,time_end,capacity,level,description,price,color}=req.body;
  if(!name||day_of_week===undefined||!time_start) return res.status(400).json({error:'Vyplňte povinné polia'});
  const c=await q.insert(db.classes,{name,emoji:emoji||'💃',category:category||'Tanec',instructor:instructor||'Fusion Team',location:location||'Banská Bystrica',day_of_week:+day_of_week,time_start,time_end:time_end||'',capacity:+capacity||20,level:level||'Všetky úrovne',description:description||'',price:+price||10,color:color||'#e94560',active:true});
  res.json({ok:true,id:c._id});
});

app.put('/api/admin/classes/:id', adminAuth, async(req,res)=>{
  const{name,emoji,category,instructor,location,day_of_week,time_start,time_end,capacity,level,description,price,color,active}=req.body;
  await q.update(db.classes,{_id:req.params.id},{$set:{name,emoji:emoji||'💃',category,instructor,location,day_of_week:+day_of_week,time_start,time_end,capacity:+capacity,level,description,price:+price,color,active:!!active}});
  res.json({ok:true});
});

app.delete('/api/admin/classes/:id', adminAuth, async(req,res)=>{
  await q.update(db.classes,{_id:req.params.id},{$set:{active:false}});
  res.json({ok:true});
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
  'silver':         { name:'Silver',         price:65,   duration_days:30,  online:true,  color:'#a8a9ad' },
  'gold':           { name:'Gold',           price:125,  duration_days:30,  online:true,  color:'#C9A84C' },
  'kids':           { name:'Zumba Kids',     price:49.9, duration_days:30,  online:false, color:'#FF6B9D', kids:true },
  'online_basic':   { name:'Online Basic',   price:12.9, duration_days:30,  online:true,  color:'#4CAF50' },
  'online_premium': { name:'Online Premium', price:67.9, duration_days:30,  online:true,  color:'#9C27B0' },
  'permanentka10':  { name:'10-vstupová permanentka', price:80, duration_days:90, online:false, color:'#FF9800', type:'bundle', entries:10 },
};

async function activateMembership(userId, planId, durationDays){
  const plan = MEMBERSHIP_PLANS[planId];
  if(!plan) return;
  const now = new Date();

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
  // Update user's membership_plan field
  await q.update(db.users,{_id:userId},{$set:{membership_plan:planId,membership_expires:expiresAt.toISOString()}});
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

app.post('/api/membership/buy', auth, async(req,res)=>{
  try {
    const {plan_id, payment_method, use_referral_credit, for_child_id} = req.body;
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

    // ── Referral credit discount (always from parent's balance) ────────────────
    let creditUsed = 0;
    let finalPrice = plan.price;
    if(use_referral_credit && (u.referral_credit||0) > 0){
      creditUsed = Math.min(u.referral_credit, plan.price);
      finalPrice = Math.max(0, +(plan.price - creditUsed).toFixed(2));
      await q.update(db.users,{_id:u._id},{$set:{referral_credit: +(u.referral_credit - creditUsed).toFixed(2)}});
      await q.insert(db.notifications,{user_id:u._id,type:'credit',title:`Referral kredit použitý 💳`,body:`${creditUsed.toFixed(2)} € zľava na ${plan.name}${forWhom}. Nový zostatok: ${(u.referral_credit-creditUsed).toFixed(2)} €`,read:false,created_at:nowISO()});
    }

    if(finalPrice === 0){
      // Fully covered by credit – activate immediately
      await activateMembership(memberId, plan_id, plan.duration_days||30);
      await q.insert(db.transactions,{type:'membership',user_id:memberId,user_name:childName||u.name,amount:0,payment_method:'referral_credit',note:`${plan.name}${forWhom} – 100% hradené kreditom`,plan_id,created_at:nowISO(),month:today().slice(0,7)});
      return res.json({ok:true, credit_used:creditUsed, final_price:0, message:`Členstvo ${plan.name}${forWhom} aktivované pomocou referral kreditu!`});
    }

    if(payment_method==='paypal'){
      if(!PAYPAL_CLIENT_ID) {
        // Demo mode – activate immediately
        await activateMembership(memberId, plan_id, plan.duration_days||30);
        return res.json({ok:true, demo:true, credit_used:creditUsed, final_price:finalPrice, message:'Demo: členstvo aktivované bez PayPal'});
      }
      const result = await ppCreateOrder(finalPrice,'EUR',`Fusion Academy – ${plan.name}${forWhom}`);
      if(result.status!==201) return res.status(400).json({error:'PayPal chyba'});
      const payment = await q.insert(db.payments,{paypal_order_id:result.body.id,user_id:req.session.uid,member_id:memberId,amount:finalPrice,currency:'EUR',description:`Členstvo ${plan.name}${forWhom}`,ref_id:plan_id,ref_type:'membership',status:'pending',created_at:nowISO(),credit_used:creditUsed});
      return res.json({ok:true, paypalOrderId:result.body.id, paymentId:payment._id, credit_used:creditUsed, final_price:finalPrice});
    }
    // Bank transfer / cash – admin will confirm
    await q.insert(db.payments,{user_id:req.session.uid,member_id:memberId,amount:finalPrice,currency:'EUR',description:`Členstvo ${plan.name}${forWhom}${creditUsed?` (kredit: -${creditUsed}€)`:''}`,ref_id:plan_id,ref_type:'membership',status:'pending_manual',payment_method:'manual',created_at:nowISO(),credit_used:creditUsed});
    res.json({ok:true, credit_used:creditUsed, final_price:finalPrice, message:'Žiadosť o členstvo bola odoslaná. Admin ju potvrdí po prijatí platby.'});
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
    has_access: hasAccess,
    locked: !hasAccess,
  }));
  res.json({classes:result, has_access:hasAccess, membership:m?{plan_id:m.plan_id,plan_name:m.plan_name,expires_at:m.expires_at}:null});
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
  if(!u||(!u.is_admin && u.user_type!=='trainer')) return res.status(403).json({error:'Prístup len pre trénerov'});
  req.trainerUser = u;
  next();
};

app.get('/api/trainer/my-classes', trainerAuth, async(req,res)=>{
  const u = req.trainerUser;
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
  const {stream_url,stream_platform,stream_notes} = req.body;
  await q.update(db.classes,{_id:req.params.id},{$set:{stream_url:stream_url||'',stream_platform:stream_platform||'',stream_notes:stream_notes||''}});
  res.json({ok:true});
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

// Manual booking by admin/trainer
app.post('/api/attendance/manual-booking', trainerAuth, async(req,res)=>{
  try {
    const {user_id, class_id, booking_date, is_free, note} = req.body;
    if(!user_id||!class_id) return res.status(400).json({error:'Chýba user_id alebo class_id'});
    const cls = await q.one(db.classes,{_id:class_id});
    if(!cls) return res.status(404).json({error:'Hodina nenájdená'});
    const u = await q.one(db.users,{_id:user_id});
    if(!u) return res.status(404).json({error:'Používateľ nenájdený'});
    const bdate = booking_date || nextDateForDay(cls.day_of_week);
    const exists = await q.one(db.bookings,{class_id,user_id,booking_date:bdate,status:{$ne:'cancelled'}});
    if(exists) return res.status(400).json({error:'Tento klient je už prihlásený na túto hodinu'});
    await q.insert(db.bookings,{
      class_id, class_name:cls.name, class_emoji:cls.emoji||'💃',
      class_location:cls.location, class_time_start:cls.time_start, class_time_end:cls.time_end,
      day_of_week:cls.day_of_week, day_name:DAYS_SK[cls.day_of_week],
      user_id:u._id, user_name:u.name, user_email:u.email, user_phone:u.phone||'',
      booking_date:bdate, status:'confirmed',
      notes: note || (is_free ? '🎁 Zadarmo (admin)' : ''),
      manual: true, manual_by: req.trainerUser._id, created_at:nowISO()
    });
    const newCount = (u.visit_count||0) + 1;
    const upd = {visit_count: newCount};
    if(is_free && !u.free_class_used) upd.free_class_used = true;
    await q.update(db.users,{_id:u._id},{$set:upd});
    await q.insert(db.notifications,{user_id:u._id,type:'booking',title:'Rezervácia potvrdená ✅',body:`${cls.name} – ${bdate} o ${cls.time_start}${is_free?' (zadarmo)':''}`,read:false,created_at:nowISO()});
    res.json({ok:true, booking_date:bdate, visit_count:newCount});
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
    await q.insert(db.notifications,{user_id,type:'membership',title:`Členstvo ${plan.name} aktivované ✅`,body:`Platné do ${expiresDate}`,read:false,created_at:nowISO()});
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
      // Determine access type
      const hasMem = mem && mem.status === 'active';
      const hasFree = !u.free_class_used && (u.visit_count||0) === 0;
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
      await q.update(db.users,{_id:u._id},{$set:upd});
      if(!u.is_child) sendFirstClassEmail(u._id).catch(()=>{});
      await q.insert(db.notifications,{user_id:u._id,type:'checkin',title:'✅ Check-in potvrdený',
        body:`${cls.name} – ${bdate} o ${cls.time_start}`,read:false,created_at:nowISO()});
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
        id:c._id, name:c.name, birth_year:c.birth_year||null,
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
    const birth_year = +req.body.birth_year || null;
    if(!name) return res.status(400).json({error:'Chýba meno dieťaťa'});
    if(birth_year && (birth_year < 1990 || birth_year > new Date().getFullYear()))
      return res.status(400).json({error:'Neplatný rok narodenia'});
    const count = await q.count(db.users,{parent_id:req.session.uid, active:{$ne:false}});
    if(count >= MAX_CHILDREN) return res.status(400).json({error:`Maximálne ${MAX_CHILDREN} detí na účet`});
    const token = Math.random().toString(36).slice(2,10);
    const internalEmail = 'child-'+token+'@internal.local';
    // Children get a unique (unused) referral_code to satisfy the unique index
    let childCode = 'CHILD-'+token.toUpperCase();
    while(await q.one(db.users,{referral_code:childCode})) childCode = 'CHILD-'+Math.random().toString(36).slice(2,10).toUpperCase();
    const child = await q.insert(db.users,{
      name, email:internalEmail, referral_code:childCode, parent_id:req.session.uid, is_child:true, birth_year,
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
    if(req.body.birth_year!==undefined) upd.birth_year = +req.body.birth_year || null;
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
    if(!u.is_admin && u.user_type !== 'trainer'){
      if(visitCount > 0 || u.free_class_used){
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
    membership: m ? {plan_id:m.plan_id,plan_name:m.plan_name,expires_at:m.expires_at,status:m.status||'active'} : null,
    notif_count: notifCount, loyalty, visit_count: u.visit_count||0,
    free_class_used: u.free_class_used||false,
    single_entries: u.single_entries||0,
    free_credits: u.free_credits||0,
    referral_credit: u.referral_credit||0,
    role_label: role.label, role_icon: role.icon, dash_url: role.dashUrl,
    created_at: u.created_at,
  });
});

// ─── Referral reward tiers (configurable) ────────────────────────────────────
const REFERRAL_REWARDS = [
  { referrals:1,  reward:'Zľava 10 % na ďalší nákup',       badge:'🌱' },
  { referrals:3,  reward:'Mesiac Bronze zadarmo',             badge:'🥉' },
  { referrals:5,  reward:'Fusion tričko + 15 % zľava',       badge:'🥈' },
  { referrals:10, reward:'2 mesiace Silver zadarmo',          badge:'🥇' },
  { referrals:20, reward:'Ročné Gold členstvo zadarmo',       badge:'💎' },
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
app.get('/api/client/referral', auth, async(req,res)=>{
  try {
    const u = await q.one(db.users,{_id:req.session.uid});
    if(!u) return res.status(404).json({error:'Nenájdený'});
    // How many people registered using my code
    const referrals = await q.find(db.users,{sponsor_id:u._id});
    const refCount = referrals.length;
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
    const refLink = 'https://latindancefusion.art/r/' + (u.referral_code||'');
    res.json({
      referral_code: u.referral_code,
      ref_link: refLink,
      ref_count: refCount,
      earned_total: +earned.toFixed(2),
      earned_pending: +pendingEarned.toFixed(2),
      earned_paid: +paidEarned.toFixed(2),
      referral_credit: u.referral_credit||0,
      current_tier: currentTier,
      next_tier: nextTier,
      all_tiers: REFERRAL_REWARDS,
    });
  } catch(e){res.status(500).json({error:e.message});}
});

// ─── Referral credit: request payout ─────────────────────────────────────────
app.post('/api/client/referral-credit/payout', auth, async(req,res)=>{
  try {
    const u = await q.one(db.users,{_id:req.session.uid});
    if(!u) return res.status(404).json({error:'Nenájdený'});
    const credit = u.referral_credit||0;
    if(credit < 5) return res.status(400).json({error:`Minimálna výplata je 5 €. Aktuálny zostatok: ${credit.toFixed(2)} €`});
    // Create payout request record
    await q.insert(db.transactions,{
      type:'referral_payout_request', user_id:u._id, user_name:u.name,
      amount:credit, payment_method:'payout', note:`Žiadosť o výplatu referral kreditu: ${credit.toFixed(2)} €`,
      status:'pending', bank_account:u.bank_account||'', created_at:nowISO(), month:today().slice(0,7)
    });
    // Reserve the credit (don't deduct yet – admin confirms)
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
      return res.json({ok:true,updated:true});
    }
    await q.insert(db.adspend,{month,source:source.toLowerCase(),amount:+amount,note:note||'',created_at:nowISO()});
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/admin/adspend/:id', adminAuth, async(req,res)=>{
  await q.remove(db.adspend,{_id:req.params.id});
  res.json({ok:true});
});

// ═══════════════════════════════════════════════════════════════════════════════
// PAGES
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/',           (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/shop',       (req,res)=>res.sendFile(path.join(__dirname,'public','shop.html')));
app.get('/schedule',   (req,res)=>res.sendFile(path.join(__dirname,'public','schedule.html')));
app.get('/community',  (req,res)=>res.sendFile(path.join(__dirname,'public','community.html')));
app.get('/cennik',     (req,res)=>res.redirect(301,'/pricing'));
app.get('/pricing',    (req,res)=>res.sendFile(path.join(__dirname,'public','pricing.html')));
app.get('/dashboard',  (req,res)=>res.sendFile(path.join(__dirname,'public','dashboard.html')));
app.get('/admin',      (req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('/online',     (req,res)=>res.sendFile(path.join(__dirname,'public','online.html')));
app.get('/body-analysis',(req,res)=>res.sendFile(path.join(__dirname,'public','body-analysis.html')));
app.get('/fit-premena',(req,res)=>res.sendFile(path.join(__dirname,'public','fit-premena.html')));
app.get('/trainer',    (req,res)=>res.sendFile(path.join(__dirname,'public','trainer.html')));
app.get('/booking-calendar',(req,res)=>res.sendFile(path.join(__dirname,'public','booking-calendar.html')));
// ── Marketing pages moved to the public website ───────────────────────────────
const WEB_URL = 'https://latindancefusion.art';
['/programs','/about','/trainers','/cities','/rental','/contact','/meal-plan','/fitdays','/blog','/gallery','/podcast','/collaborate'].forEach(p=>{
  app.get(p,(req,res)=>res.redirect(301, WEB_URL));
});
app.get('/client-dashboard',(req,res)=>res.sendFile(path.join(__dirname,'public','client-dashboard.html')));
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
    id: u._id, name: u.name,
    memberBadge: getMemberBadge(u.created_at),
    rankBadge: RANKS[(u.rank||1)-1].badge,
    user_type: u.user_type||'partner',
    socketId: socket.id,
    channel: 'general',
  };
  onlineUsers.set(socket.id, userInfo);

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
      user_id: u._id, user_name: u.name,
      memberBadge: getMemberBadge(u.created_at),
      rankBadge: RANKS[(u.rank||1)-1].badge,
      text: text.trim().slice(0,500),
      created_at: nowISO(),
    });
    io.to(channel||'general').emit('new_message', msg);
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
      .filter(u=>counts[u._id])
      .map(u=>({id:u._id,name:u.name,visits:counts[u._id]||0,total:u.visit_count||0}))
      .sort((a,b)=>b.visits-a.visits).slice(0,20);
  } else {
    const allU = await q.find(db.users,{active:true});
    users = allU.filter(u=>(u.visit_count||0)>0)
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
const APP_URL = process.env.APP_URL || 'https://latindancefusion.art';

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
      if(step.sequence === 'expiry_warning'){
        const mem = await q.one(db.memberships,{user_id:u._id, status:'active'});
        if(!mem){ await q.update(db.email_queue,{_id:item._id},{$set:{status:'skipped',reason:'no_membership'}}); continue; }
      }
      if(step.sequence === 'reengagement'){
        // Skip if visited recently (last 7 days)
        const recent = await q.find(db.bookings,{user_id:u._id,created_at:{$gte:new Date(Date.now()-7*86400000).toISOString().slice(0,10)}});
        if(recent.length){ await q.update(db.email_queue,{_id:item._id},{$set:{status:'skipped',reason:'active_user'}}); continue; }
      }

      await sendMail(u.email, step.subject,
        emailTemplate(step.subject.replace(/^[^\w]*/,''), step.body, step.cta||null, step.cta_url||APP_URL));
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
seedData().then(()=>{
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
