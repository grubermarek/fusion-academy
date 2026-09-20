/**
 * Rodič + dieťa (Marek 13. 9.): „over, že detskému účtu sa dá kúpiť Zumba a zároveň
 * aj rodič si vie pre seba a bookovať sa; dieťa sa nemusí bookovať, berie sa
 * automaticky, že chodí; over, že aj platby idú."
 *
 * Overuje:
 *  - zrušený plán 'kids' sa nedá kúpiť (cenník, API, tréner), rodič kupuje Bronze pre dieťa,
 *  - odber pre dieťa je na detskom profile: rodičov vlastný odber ho neblokuje ani neprepíše,
 *    obnova z webhooku predĺži DIEŤA a faktúru dostane RODIČ, rodič vie odber dieťaťa vypnúť,
 *  - pošta a doklady za dieťa idú rodičovi, rodič vidí upozornenia detí,
 *  - dieťa dostane návštevu pri potvrdení hodiny trénerom (predtým nikdy),
 *  - detská hodina je pre deti (dospelý → 400), rodič ju rezervuje pre dieťa,
 *  - automatická dochádzka: rodič vyberie hodiny, appka dieťa prihlási, po hodine sa ráta ako odchodené,
 *  - rozvrh: Kids 2 (7–14) o 15:00, Kids 1 (4–6) o 16:00 (migrácia 13. 9.).
 * Spustenie:  node qa/rodina-dieta.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4534;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-rodina-'));
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };
async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const rd = f => { const p = path.join(DATA, f); if (!fs.existsSync(p)) return []; const m = new Map();
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l.trim()) continue; let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o.$$indexCreated) continue; if (o.$$deleted) { m.delete(o._id); continue; } m.set(o._id, o); } return [...m.values()]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ── statické kontroly ──
  const pricing = fs.readFileSync(path.join(ROOT, 'public', 'pricing.html'), 'utf8');
  const obchod = fs.readFileSync(path.join(ROOT, 'public', 'obchod.html'), 'utf8');
  const dash = fs.readFileSync(path.join(ROOT, 'public', 'client-dashboard.html'), 'utf8');
  console.log('STATICKÉ');
  const shop = fs.readFileSync(path.join(ROOT, 'public', 'shop.html'), 'utf8');
  ok('cenník je len presmerovanie do Obchodu (jeden obchod)', /location\.replace\('\/obchod'/.test(pricing) && !/Zumba Kids/.test(pricing) && pricing.length < 400);
  ok('starý e-shop je len presmerovanie do Obchodu (merch)', /location\.replace\('\/obchod\?tab=merch'/.test(shop) && shop.length < 400);
  ok('obchod: buy=kids = Bronze pre dieťa, bez detí založí profil', /buyRaw==='kids'\?'bronze'/.test(obchod) && /PRE_KOHO=CHILDREN\.length\?CHILDREN\[0\]\.id:'new'/.test(obchod) && /ulozNoveDieta/.test(obchod) && /Pridať dieťa \(Zumba Kids\)/.test(obchod));
  const nav = fs.readFileSync(path.join(ROOT, 'public', 'nav-bar.js'), 'utf8');
  ok('menu: jedna položka Obchod (/obchod), žiadne Členstvo (/pricing)', !/href:'\/pricing'/.test(nav) && !/href:'\/shop'/.test(nav) && /label:'Obchod', href:'\/obchod'/.test(nav));
  ok('appka neodkazuje na /pricing ani /shop', ['client-dashboard.html','schedule.html','index.html','unlock.html','jedalnicek.html','404.html','admin.html'].every(f => { const t = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8'); return !/\/pricing/.test(t) && !/href="\/shop"/.test(t); }));
  // 20. 9.: automatické hodiny, skupina aj vypnutie odberu sa presunuli do profilu dieťaťa (/dieta/:id)
  const dieta = fs.readFileSync(path.join(ROOT, 'public', 'dieta.html'), 'utf8');
  ok('dashboard: rodičovská karta odkazuje do profilu dieťaťa a ponúka zaplatenie Zumba Kids', /\/api\/family\/overview/.test(dash) && /\/dieta\/\$\{c\.id\}/.test(dash) && /Zaplatiť Zumba Kids/.test(dash) && !/toggleAutoClass\(/.test(dash));
  ok('profil dieťaťa: výber skupiny, automatická platba, vypnutie odberu s upozornením', /kids_group/.test(dieta) && /vypniOdber\(/.test(dieta) && /Automatická platba/.test(dieta) && /price_manual/.test(dieta));

  // ── fixtúry ──
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const MES = DNES.slice(0, 7);
  const pm = new Date(+MES.slice(0, 4), +MES.slice(5, 7) - 2, 1);
  const den = n => { const d = new Date(DNES + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const VCERA = den(-1), ZAJTRA = den(1), O3 = den(3), O30 = den(30);
  const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zak = { rank: 1, is_admin: false, active: true, visit_count: 0, referral_credit: 0, lead_source: 'qa', city: 'Detva' };
  const ADM = 'qaRodAdmin0001', MAMA = 'qaRodMama00001', DIETA = 'qaRodDieta0001', TETA = 'qaRodTeta00001';
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: ADM, name: 'Admin Rodina', email: 'qa.rod.admin@qa-biz.local', password: hash, referral_code: 'QARADM', ...zak, is_admin: true, user_type: 'admin', created_at: '2026-01-01' },
    // mama: členstvo Bronze bez vlastného odberu — odber si má vedieť zapnúť popri odbere dieťaťa
    { _id: MAMA, name: 'Mária Mamová', email: 'qa.rod.mama@qa-biz.local', phone: '0900111555', password: hash, referral_code: 'QARMAM', sponsor_id: ADM, ...zak, user_type: 'client', created_at: '2026-06-01', free_class_used: true, onboarding_done: true },
    // dieťa: vlastný Stripe odber (platí mama), aktívne Bronze do +30 dní
    { _id: DIETA, name: 'Dorotka Mamová', email: 'child-qarod1@internal.local', referral_code: 'CHILD-QAROD1', parent_id: MAMA, is_child: true, birth_date: '2018-05-05', birth_year: 2018,
      account_creation_type: 'child', user_type: 'client', is_admin: false, active: true, visit_count: 0, free_class_used: true, single_entries: 0, free_credits: 0, referral_credit: 0, created_at: '2026-09-01',
      stripe_subscription_id: 'sub_qa_dieta', stripe_sub_plan: 'bronze', stripe_sub_member: DIETA, stripe_sub_payer_id: MAMA },
    { _id: TETA, name: 'Tereza Tetová', email: 'qa.rod.teta@qa-biz.local', password: hash, referral_code: 'QARTET', sponsor_id: ADM, ...zak, user_type: 'client', created_at: '2026-06-01', free_class_used: true },
  ]));
  const kidsBase = { emoji: '🧒', category: 'Deti', instructor: 'Admin Rodina', instructor_id: ADM, location: 'Detva', capacity: 30, price: 9, active: true, created_at: '2026-09-09' };
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    // staré časy → migrácia 13. 9. ich má prehodiť (Kids 2 → 15:00, Kids 1 → 16:00)
    { _id: 'qaKids2Pi', name: 'Zumba Kids 2 (7–14)', level: 'Deti 7–14 rokov', day_of_week: dow(ZAJTRA), time_start: '14:00', time_end: '15:00', ...kidsBase },
    { _id: 'qaKids1Pi', name: 'Zumba Kids 1 (4–6)', level: 'Deti 4–6 rokov', day_of_week: dow(ZAJTRA), time_start: '15:00', time_end: '16:00', ...kidsBase },
    { _id: 'qaZumbaD', name: 'Zumba Detva', emoji: '💃', category: 'Zumba', instructor: 'Admin Rodina', instructor_id: ADM, location: 'Detva', day_of_week: dow(ZAJTRA), time_start: '18:00', time_end: '19:00', capacity: 30, price: 10, active: true, created_at: '2026-01-01' },
  ]));
  fs.writeFileSync(path.join(DATA, 'memberships.db'), riadky([
    { _id: 'qaRodMem1', user_id: DIETA, user_name: 'Dorotka Mamová', plan_id: 'bronze', plan_name: 'Bronze', price: 50, status: 'active', started_at: DNES + 'T08:00:00.000Z', expires_at: O30 + 'T08:00:00.000Z', created_at: DNES + 'T08:00:00.000Z' },
  ]));
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky([
    // včerajšia automatická detská rezervácia bez potvrdenia → job ju má zarátať ako odchodenú
    { _id: 'qaRodAuto0', class_id: 'qaKids2Pi', class_name: 'Zumba Kids 2 (7–14)', class_location: 'Detva', class_time_start: '14:00', class_time_end: '15:00', user_id: DIETA, user_name: 'Dorotka Mamová', booking_date: VCERA, status: 'confirmed', attendance_status: 'pending', is_child_booking: true, child_name: 'Dorotka Mamová', booked_by: MAMA, auto_kids: true, created_at: VCERA + 'T08:00:00.000Z' },
    // včerajšia bežná rezervácia dospelej bez potvrdenia → no-show ako doteraz
    { _id: 'qaRodTeta0', class_id: 'qaZumbaD', class_name: 'Zumba Detva', class_location: 'Detva', class_time_start: '18:00', class_time_end: '19:00', user_id: TETA, user_name: 'Tereza Tetová', booking_date: VCERA, status: 'confirmed', attendance_status: 'pending', access_method: 'single_entry', created_at: VCERA + 'T08:00:00.000Z' },
    // budúca detská rezervácia so starým časom (o 8 dní — mimo 7-dňového okna automatiky) — migrácia rozvrhu ju má prepísať
    { _id: 'qaRodBud0', class_id: 'qaKids1Pi', class_name: 'Zumba Kids 1 (4–6)', class_location: 'Detva', class_time_start: '15:00', class_time_end: '16:00', user_id: DIETA, user_name: 'Dorotka Mamová', booking_date: den(8), status: 'confirmed', attendance_status: 'pending', is_child_booking: true, child_name: 'Dorotka Mamová', booked_by: MAMA, created_at: DNES + 'T08:00:00.000Z' },
  ]));
  // spätná migrácia „potvrď minulé rezervácie" by včerajšie fixtúry označila ako odchodené skôr než job
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky([
    { _id: 'qaRodSet1', key: 'retro_confirm_v1', value: true, at: '2026-01-01T00:00:00.000Z' },
    { _id: 'qaRodSet2', key: 'noshow_revert_v1', value: true, at: '2026-01-01T00:00:00.000Z' },
    // no-show job by v čistej DB začínal až dnešným dňom — včerajšie fixtúry by ignoroval
    { _id: 'qaRodSet3', key: 'no_show_from', value: '2026-01-01', at: '2026-01-01T00:00:00.000Z' },
    // migrácie z 9. 9. by založili vlastné Kids hodiny — tu stačia fixtúry
    { _id: 'qaRodSet4', key: 'zumba_kids_hodiny_20260909', value: true, at: '2026-01-01T00:00:00.000Z' },
    { _id: 'qaRodSet5', key: 'zumba_kids_casy_20260909b', value: true, at: '2026-01-01T00:00:00.000Z' },
    { _id: 'qaRodSet6', key: 'zumba_kids_prehodenie_20260909c', value: true, at: '2026-01-01T00:00:00.000Z' },
  ]));
  fs.writeFileSync(path.join(DATA, 'monthly_winners.db'), riadky([{ _id: 'qaRodMW01', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'x', user_name: 'x', points: 1, type: 'month', created_at: '2026-01-01' }]));

  console.log('\nSERVER — štart…');
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_FAKE: '1', STRIPE_SECRET_KEY: 'sk_test_qa_fake' }, stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await sleep(1000); } }
  await sleep(5000);
  try {
    // ── 1) rozvrh po migrácii ──
    const cls = rd('classes.db');
    const k2 = cls.find(c => c._id === 'qaKids2Pi'), k1 = cls.find(c => c._id === 'qaKids1Pi');
    ok('rozvrh: Zumba Kids 2 (7–14) o 15:00–16:00', k2 && k2.time_start === '15:00' && k2.time_end === '16:00', JSON.stringify(k2 && [k2.time_start, k2.time_end]));
    ok('rozvrh: Zumba Kids 1 (4–6) o 16:00–17:00', k1 && k1.time_start === '16:00' && k1.time_end === '17:00', JSON.stringify(k1 && [k1.time_start, k1.time_end]));
    const bud = rd('bookings.db').find(b => b._id === 'qaRodBud0');
    ok('rozvrh: budúca detská rezervácia má nový čas', bud && bud.class_time_start === '16:00', JSON.stringify(bud && bud.class_time_start));

    // ── 2) plán kids sa nedá kúpiť ──
    const plans = await j('/api/membership/plans', {}, {});
    ok('plány na predaj bez kids', plans.status === 200 && plans.d && !('kids' in plans.d) && ('bronze' in plans.d), JSON.stringify(Object.keys(plans.d || {})));
    const mj = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.rod.mama@qa-biz.local', password: 'Heslo123!' } }, mj);
    ok('mama prihlásená', lg.status === 200, JSON.stringify(lg.d));
    const buyKids = await j('/api/membership/buy', { method: 'POST', body: { plan_id: 'kids', payment_method: 'manual', for_child_id: DIETA } }, mj);
    ok('nákup plánu kids → 400 Neplatný plán', buyKids.status === 400, 'HTTP ' + buyKids.status + ' ' + JSON.stringify(buyKids.d));
    const aj = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.rod.admin@qa-biz.local', password: 'Heslo123!' } }, aj);
    const so = await j('/api/trainer/sell-options', {}, aj);
    ok('tréner: predaj neponúka kids', so.status === 200 && so.d && !(so.d.plans || []).some(p => p.id === 'kids') && (so.d.plans || []).some(p => p.id === 'bronze'), JSON.stringify((so.d && so.d.plans || []).map(p => p.id)));

    // ── 3) odber: dieťa má vlastný, mama tiež; navzájom sa neblokujú ──
    const fam = await j('/api/family/children', {}, mj);
    const d0 = (fam.d || [])[0];
    ok('rodina: dieťa má členstvo Bronze a odber', d0 && d0.membership && d0.membership.plan_id === 'bronze' && d0.auto_renew === true, JSON.stringify(d0));
    const subSelf = await j('/api/stripe/subscribe', { method: 'POST', body: { plan_id: 'silver' } }, mj);
    ok('mama: vlastný odber Silver popri odbere dieťaťa NIE JE blokovaný (nie 409)', subSelf.status !== 409, 'HTTP ' + subSelf.status + ' ' + JSON.stringify(subSelf.d));
    const subKid = await j('/api/stripe/subscribe', { method: 'POST', body: { plan_id: 'bronze', for_child_id: DIETA } }, mj);
    ok('dieťa: druhý odber pre dieťa → 409 subscription_exists', subKid.status === 409 && (subKid.d || {}).code === 'subscription_exists', 'HTTP ' + subKid.status + ' ' + JSON.stringify(subKid.d));
    // obnova z webhooku (invoice.paid) pre odber dieťaťa → predĺži DIEŤA, faktúra RODIČOVI
    const pred = rd('memberships.db').find(m => m.user_id === DIETA).expires_at;
    const wh = await fetch(BASE + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'evt_qa_rod_1', type: 'invoice.paid', data: { object: { billing_reason: 'subscription_cycle', subscription: 'sub_qa_dieta', amount_paid: 5000 } } }) });
    await sleep(800);
    const po = rd('memberships.db').find(m => m.user_id === DIETA).expires_at;
    ok('obnova odberu dieťaťa predĺži DIEŤA', wh.status === 200 && po > pred, pred + ' → ' + po);
    const txObn = rd('transactions.db').find(t => t.type === 'subscription_renewal');
    ok('transakcia obnovy je na dieťati', txObn && txObn.user_id === DIETA, JSON.stringify(txObn && { u: txObn.user_id, a: txObn.amount }));
    const invObn = rd('invoices.db').find(i => /obnova/.test(JSON.stringify(i.items || [])));
    ok('faktúra za obnovu ide RODIČOVI (nie na interný e-mail dieťaťa)', invObn && invObn.user_id === MAMA && invObn.client_email === 'qa.rod.mama@qa-biz.local' && /Dorotka/.test(JSON.stringify(invObn.items)), JSON.stringify(invObn && { u: invObn.user_id, e: invObn.client_email }));
    const mamaSub = rd('users.db').find(u => u._id === MAMA).stripe_subscription_id;
    ok('odber dieťaťa sa obnovou nepreniesol na mamu (jej slot ostal prázdny)', !mamaSub && rd('users.db').find(u => u._id === DIETA).stripe_subscription_id === 'sub_qa_dieta', String(mamaSub));
    // rodič vypne odber dieťaťa
    const canc = await j('/api/stripe/subscribe/cancel', { method: 'POST', body: { member_id: DIETA, reason: 'other', note: 'qa' } }, mj);
    const uPo = rd('users.db');
    ok('rodič vypol odber dieťaťa — dieťa bez odberu, mamin účet nedotknutý', canc.status === 200 && !uPo.find(u => u._id === DIETA).stripe_subscription_id && !uPo.find(u => u._id === MAMA).stripe_subscription_id, 'HTTP ' + canc.status + ' ' + JSON.stringify(canc.d));
    const nic = await j('/api/stripe/subscribe/cancel', { method: 'POST', body: { member_id: DIETA } }, mj);
    ok('druhé vypnutie: „nemá aktívny odber" (400)', nic.status === 400 && /Dorotka/.test((nic.d || {}).error || ''), 'HTTP ' + nic.status + ' ' + JSON.stringify(nic.d));
    const cudzie = await j('/api/stripe/subscribe/cancel', { method: 'POST', body: { member_id: TETA } }, mj);
    ok('cudzí účet ako member_id → 403', cudzie.status === 403, 'HTTP ' + cudzie.status);

    // ── 4) nákup pre dieťa, doklady a upozornenia rodičovi ──
    const gr = await j('/api/admin/users/' + DIETA + '/grant-membership', { method: 'POST', body: { plan_id: 'bronze', gift: false, payment_method: 'cash', amount: 50 } }, aj);
    await sleep(600);
    ok('admin: predaj Bronze pre dieťa (hotovosť)', gr.status === 200 && gr.d && gr.d.ok, JSON.stringify(gr.d));
    const invGr = rd('invoices.db').filter(i => i.client_email === 'qa.rod.mama@qa-biz.local');
    ok('faktúra za dieťa ide rodičovi (za Dorotku)', invGr.some(i => /za Dorotka/.test(i.client_name || '')), JSON.stringify(invGr.map(i => i.client_name)));
    ok('žiadna faktúra na interný e-mail dieťaťa', !rd('invoices.db').some(i => /internal\.local/.test(i.client_email || '')));
    const ts = await j('/api/trainer/sell', { method: 'POST', body: { user_id: DIETA, kind: 'plan', plan_id: 'permanentka10', amount: 80 } }, aj);
    await sleep(500);
    ok('tréner: predaj permanentky dieťaťu na hodine', ts.status === 200 && ts.d && ts.d.ok, JSON.stringify(ts.d));
    ok('… aj tá faktúra ide rodičovi', rd('invoices.db').filter(i => /Permanentka/.test(JSON.stringify(i.items))).every(i => i.client_email === 'qa.rod.mama@qa-biz.local'));
    const notifs = await j('/api/client/notifications', {}, mj);
    const detske = (notifs.d || []).filter(n => /^👧 Dorotka/.test(n.title || ''));
    ok('rodič vidí upozornenia dieťaťa (👧 Dorotka: …)', detske.length >= 2 && detske.some(n => /Členstvo aktivované|Permanentka/.test(n.title)), JSON.stringify(detske.map(n => n.title)));
    const me = await j('/api/me', {}, mj);
    ok('/api/me počíta aj neprečítané upozornenia dieťaťa', me.d && me.d.notif_count >= detske.length, String(me.d && me.d.notif_count));
    const ra = await j('/api/client/notifications/read-all', { method: 'POST' }, mj);
    const me2 = await j('/api/me', {}, mj);
    ok('prečítať všetko zahŕňa aj detské', ra.status === 200 && me2.d && me2.d.notif_count === 0, String(me2.d && me2.d.notif_count));
    // pošta: expiračné upozornenie pre dieťa → mail rodičovi s 👧
    await new Promise(r => { const p = path.join(DATA, 'memberships.db'); fs.appendFileSync(p, JSON.stringify({ _id: 'qaRodMem1', user_id: DIETA, user_name: 'Dorotka Mamová', plan_id: 'bronze', plan_name: 'Bronze', price: 50, status: 'active', started_at: DNES, expires_at: O3, created_at: DNES }) + '\n'); r(); });
    const ew = await j('/api/admin/crm/send-expiry-warnings', { method: 'POST' }, aj);
    await sleep(800);
    const maily = rd('mail_log.db').filter(m => /vypr/i.test(m.subject || ''));
    ok('mail o expirácii členstva dieťaťa ide rodičovi s 👧 (nie na internal.local)', ew.status === 200 && maily.some(m => m.to === 'qa.rod.mama@qa-biz.local' && /^👧 Dorotka/.test(m.subject)) && !maily.some(m => /internal\.local/.test(m.to)), JSON.stringify(maily.map(m => m.to + ' | ' + m.subject)));

    // ── 5) hodiny: dospelý na detskej nie, rodič pre dieťa áno, dieťa dostane návštevu ──
    const tj = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.rod.teta@qa-biz.local', password: 'Heslo123!' } }, tj);
    const bAd = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaKids2Pi', booking_date: ZAJTRA } }, tj);
    ok('dospelá na Zumba Kids → 400 kids_class', bAd.status === 400 && (bAd.d || {}).kids_class === true, 'HTTP ' + bAd.status + ' ' + JSON.stringify(bAd.d));
    const grM = await j('/api/admin/users/' + MAMA + '/grant-membership', { method: 'POST', body: { plan_id: 'bronze', gift: false, payment_method: 'cash', amount: 50 } }, aj);
    ok('admin: Bronze pre mamu (hotovosť)', grM.status === 200 && grM.d && grM.d.ok, JSON.stringify(grM.d));
    const bMama = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaZumbaD', booking_date: ZAJTRA } }, mj);
    ok('mama si rezervuje Zumbu pre seba (vlastné členstvo)', bMama.status === 200 && bMama.d && bMama.d.ok, 'HTTP ' + bMama.status + ' ' + JSON.stringify(bMama.d));
    // dieťa (8 r.) bolo po obnove členstva zaradené podľa veku do Kids 2 a na zajtra už automaticky prihlásené
    const bKid = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaKids2Pi', booking_date: ZAJTRA, for_child_id: DIETA } }, mj);
    ok('dieťa je na Zumba Kids 2 prihlásené automaticky (mamin zápis: už prihlásené)', bKid.status === 400 && /už na túto hodinu/.test((bKid.d || {}).error || '') && rd('bookings.db').some(b => b.user_id === DIETA && b.class_id === 'qaKids2Pi' && b.booking_date === ZAJTRA && b.auto_kids), 'HTTP ' + bKid.status + ' ' + JSON.stringify(bKid.d));
    const bk = rd('bookings.db').find(b => b.user_id === DIETA && b.class_id === 'qaKids2Pi' && b.booking_date === ZAJTRA);
    const cs = await j('/api/attendance/confirm-session', { method: 'POST', body: { class_id: 'qaKids2Pi', date: ZAJTRA, present_ids: [bk && bk._id] } }, aj);
    await sleep(400);
    const dietaPo = rd('users.db').find(u => u._id === DIETA);
    ok('tréner potvrdí hodinu → dieťa dostane návštevu (visit_count 1)', cs.status === 200 && dietaPo.visit_count === 1, 'HTTP ' + cs.status + ' visit=' + dietaPo.visit_count + ' ' + JSON.stringify(cs.d));

    // ── 6) automatická dochádzka ──
    const putA = await j('/api/family/children/' + DIETA, { method: 'PUT', body: { auto_classes: ['qaKids2Pi', 'qaKids1Pi', 'qaZumbaD'] } }, mj);
    ok('rodič zapne automatické hodiny (len detské sa uložia)', putA.status === 200 && putA.d && JSON.stringify(putA.d.auto_classes) === JSON.stringify(['qaKids2Pi', 'qaKids1Pi']), JSON.stringify(putA.d));
    const autoBk = rd('bookings.db').filter(b => b.auto_kids && b.user_id === DIETA && b.booking_date >= DNES);
    ok('appka dieťa prihlásila aj na Kids 1 (Kids 2 už mala z automatiky)', putA.d && putA.d.auto_bookings === 1 && autoBk.length === 2 && autoBk.some(b => b.class_id === 'qaKids1Pi' && b.booking_date === ZAJTRA && b.class_time_start === '16:00') && autoBk.every(b => b.is_child_booking), JSON.stringify(autoBk.map(b => b.class_id + ' ' + b.booking_date + ' ' + b.class_time_start)));
    const fam2 = await j('/api/family/children', {}, mj);
    ok('rodina: auto_classes v zozname', fam2.d && fam2.d[0] && fam2.d[0].auto_classes.length === 2);
    const ns = await j('/api/admin/attendance/run-noshow', { method: 'POST' }, aj);
    await sleep(500);
    const auto0 = rd('bookings.db').find(b => b._id === 'qaRodAuto0'), teta0 = rd('bookings.db').find(b => b._id === 'qaRodTeta0');
    ok('včerajšia automatická detská hodina bez potvrdenia = odchodená', ns.status === 200 && auto0.status === 'attended' && auto0.attendance_source === 'auto_kids', JSON.stringify(auto0 && [auto0.status, auto0.attendance_source]));
    ok('… a dieťaťu pribudla návšteva (2)', rd('users.db').find(u => u._id === DIETA).visit_count === 2, String(rd('users.db').find(u => u._id === DIETA).visit_count));
    ok('bežná rezervácia dospelej bez potvrdenia ostáva no-show', teta0.attendance_status === 'no_show', JSON.stringify(teta0 && teta0.attendance_status));
    const idem = await j('/api/family/children/' + DIETA, { method: 'PUT', body: { auto_classes: ['qaKids2Pi', 'qaKids1Pi'] } }, mj);
    ok('opakované uloženie nevytvorí duplicitné rezervácie', idem.d && idem.d.auto_bookings === 0 && rd('bookings.db').filter(b => b.user_id === DIETA && b.booking_date === ZAJTRA && b.status !== 'cancelled').length === 2);

    // ── 7) jeden obchod, dátum narodenia, zaradenie podľa veku ──
    const rp = await fetch(BASE + '/pricing?buy=bronze', { redirect: 'manual' }), rs = await fetch(BASE + '/shop', { redirect: 'manual' });
    ok('/pricing a /shop presmerujú do /obchod', rp.status === 302 && /\/obchod\?buy=bronze/.test(rp.headers.get('location') || '') && rs.status === 302 && /\/obchod\?tab=merch/.test(rs.headers.get('location') || ''), rp.status + ' ' + rp.headers.get('location') + ' | ' + rs.status + ' ' + rs.headers.get('location'));
    const bezD = await j('/api/family/children', { method: 'POST', body: { name: 'Bez Datumu' } }, mj);
    ok('dieťa bez dátumu narodenia → 400', bezD.status === 400 && /narodenia/.test((bezD.d || {}).error || ''), 'HTTP ' + bezD.status + ' ' + JSON.stringify(bezD.d));
    const nove = await j('/api/family/children', { method: 'POST', body: { name: 'Samko Mamov', birth_date: '2018-05-05' } }, mj);
    ok('nové dieťa (8 r.) založené', nove.status === 200 && nove.d && nove.d.id, JSON.stringify(nove.d));
    const grS = await j('/api/admin/users/' + nove.d.id + '/grant-membership', { method: 'POST', body: { plan_id: 'bronze', gift: false, payment_method: 'cash', amount: 50 } }, aj);
    await sleep(800);
    const fam3 = await j('/api/family/children', {}, mj);
    const samko = (fam3.d || []).find(c => c.id === nove.d.id);
    ok('po kúpe členstva je 8-ročné dieťa zaradené do Zumba Kids 2 (podľa veku)', grS.status === 200 && samko && samko.age === 8 && samko.age_group === 'Kids 2' && JSON.stringify(samko.auto_classes) === JSON.stringify(['qaKids2Pi']), JSON.stringify(samko && { age: samko.age, g: samko.age_group, a: samko.auto_classes }));
    ok('… a má automatickú rezerváciu na najbližší termín', rd('bookings.db').some(b => b.user_id === nove.d.id && b.auto_kids && b.class_id === 'qaKids2Pi'));
    ok('rodič dostal upozornenie o zaradení', (await j('/api/client/notifications', {}, mj)).d.some(n => /Samko.*zaradené do Zumba Kids 2/.test(n.title || '')));
  } catch (e) { failed++; console.log('  ❌ výnimka: ' + e.stack); }
  finally {
    proc.kill();
    console.log('\nRODINA: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 600);
  }
})();
