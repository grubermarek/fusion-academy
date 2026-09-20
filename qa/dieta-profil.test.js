/**
 * Profil dieťaťa + skupiny Zumba Kids (Marek 20. 9. 2026): „rodič musí jednoducho zaplatiť
 * za Zumba Kids 1 alebo Zumba Kids 2 a prihlásiť tam svoje dieťa; prehľad o hodinách detí,
 * aj keď má viac detí; automatická platba predvolene, vypnutie upozorní, že ručne je to
 * o 10 % drahšie (49,90 → 54,90 €)."
 *
 * Overuje:
 *  - /api/family/overview: všetky deti, skupiny s hodinami, spoločný týždeň, cena 49,90 / ručne 54,90,
 *  - /api/family/children/:id: detail len pre vlastného rodiča (cudzí → 403), skupina, hodiny, dochádzka,
 *  - PUT kids_group: dieťa s členstvom dostane hodiny skupiny + rezervácie; zmena skupiny zruší staré automatické,
 *  - nákup v hotovosti pre dieťa so skupinou: cena 54,90 (bez odberu) a dieťa je hneď zaradené,
 *  - odber pre dieťa: Stripe názov „Zumba Kids – meno (mesačne, automatická platba)", návrat do /dieta/:id,
 *  - vypnutie odberu dieťaťa: oznam rodičovi spomína 54,90 €,
 *  - stránka /dieta/:id sa servíruje.
 * Spustenie:  node qa/dieta-profil.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4541;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-dieta-'));
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
  console.log('STATICKÉ');
  const dieta = fs.readFileSync(path.join(ROOT, 'public', 'dieta.html'), 'utf8');
  const obchod = fs.readFileSync(path.join(ROOT, 'public', 'obchod.html'), 'utf8');
  const dash = fs.readFileSync(path.join(ROOT, 'public', 'client-dashboard.html'), 'utf8');
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  ok('profil dieťaťa: skupiny, platba rovno do odberu (predvolene automatická obnova), upozornenie pri vypnutí', /\/api\/stripe\/subscribe/.test(dieta) && /inePlatby\(/.test(dieta) && /kids_group/.test(dieta) && /o \'\+pr\+\' % viac/.test(dieta) && /price_manual/.test(dieta) && /Automatická platba/.test(dieta));
  ok('obchod: dieťa + skupina z adresy, kids_group ide do platby, ručná cena vyššia', /qsB\.get\('child'\)/.test(obchod) && /kids_group:CUR\.child_id\?SKUPINA/.test(obchod) && /KIDSP\.prirazka/.test(obchod) && /\/api\/family\/overview/.test(obchod));
  ok('nástenka: riadok dieťaťa vedie do /dieta/:id a nové dieťa ide rovno tam', /\/dieta\/\$\{c\.id\}/.test(dash) && /location\.href='\/dieta\/'\+d\.id/.test(dash) && /Tento týždeň/.test(dash));
  ok('server: routa /dieta/:id, návrat zo Stripe do profilu dieťaťa, prirážka 10 %', /app\.get\('\/dieta\/:id'/.test(srv) && /'\/dieta\/'\+memberId/.test(srv) && /KIDS_MANUAL_PRIRAZKA = 0\.10/.test(srv));

  // ── fixtúry ──
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const den = n => { const d = new Date(DNES + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const ZAJTRA = den(1), POZAJTRA = den(2), O30 = den(30);
  const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zak = { rank: 1, is_admin: false, active: true, visit_count: 0, referral_credit: 0, lead_source: 'qa', city: 'Detva' };
  const ADM = 'qaDpAdmin00001', MAMA = 'qaDpMama000001', CUDZIA = 'qaDpCudzia0001', D1 = 'qaDpDieta10001', D2 = 'qaDpDieta20001';
  const dietaBase = { account_creation_type: 'child', user_type: 'client', is_admin: false, active: true, visit_count: 0, free_class_used: true, single_entries: 0, free_credits: 0, referral_credit: 0, created_at: '2026-09-01' };
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: ADM, name: 'Admin Deti', email: 'qa.dp.admin@qa-biz.local', password: hash, referral_code: 'QADPADM', ...zak, is_admin: true, user_type: 'admin', created_at: '2026-01-01' },
    { _id: MAMA, name: 'Mária Dvojmama', email: 'qa.dp.mama@qa-biz.local', phone: '0900111777', password: hash, referral_code: 'QADPMAM', sponsor_id: ADM, ...zak, user_type: 'client', created_at: '2026-06-01' },
    { _id: CUDZIA, name: 'Cudzia Rodička', email: 'qa.dp.cudzia@qa-biz.local', password: hash, referral_code: 'QADPCUD', sponsor_id: ADM, ...zak, user_type: 'client', created_at: '2026-06-01' },
    // Dieťa 1: 9 rokov, členstvo + odber (platí mama), ešte bez skupiny
    { _id: D1, name: 'Dorotka Dvojmama', email: 'child-qadp1@internal.local', referral_code: 'CHILD-QADP1', parent_id: MAMA, is_child: true, birth_date: '2017-03-03', birth_year: 2017, ...dietaBase,
      stripe_subscription_id: 'sub_qa_d1', stripe_sub_plan: 'bronze', stripe_sub_member: D1, stripe_sub_payer_id: MAMA },
    // Dieťa 2: 5 rokov, bez členstva
    { _id: D2, name: 'Emka Dvojmama', email: 'child-qadp2@internal.local', referral_code: 'CHILD-QADP2', parent_id: MAMA, is_child: true, birth_date: '2021-06-06', birth_year: 2021, ...dietaBase },
  ]));
  const kidsBase = { emoji: '🧒', category: 'Deti', instructor: 'Admin Deti', instructor_id: ADM, location: 'Detva', capacity: 30, price: 9, active: true, created_at: '2026-09-09' };
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    { _id: 'qaK2a', name: 'Zumba Kids 2 (7–14)', level: 'Deti 7–14 rokov', day_of_week: dow(ZAJTRA), time_start: '15:00', time_end: '16:00', ...kidsBase },
    { _id: 'qaK2b', name: 'Zumba Kids 2 (7–14)', level: 'Deti 7–14 rokov', day_of_week: dow(POZAJTRA), time_start: '15:00', time_end: '16:00', ...kidsBase },
    { _id: 'qaK1a', name: 'Zumba Kids 1 (4–6)', level: 'Deti 4–6 rokov', day_of_week: dow(ZAJTRA), time_start: '16:00', time_end: '17:00', ...kidsBase },
    { _id: 'qaK1b', name: 'Zumba Kids 1 (4–6)', level: 'Deti 4–6 rokov', day_of_week: dow(POZAJTRA), time_start: '16:00', time_end: '17:00', ...kidsBase },
  ]));
  fs.writeFileSync(path.join(DATA, 'memberships.db'), riadky([
    { _id: 'qaDpMem1', user_id: D1, user_name: 'Dorotka Dvojmama', plan_id: 'bronze', plan_name: 'Bronze', price: 49.9, status: 'active', started_at: DNES + 'T08:00:00.000Z', expires_at: O30 + 'T08:00:00.000Z', payment_method: 'stripe', created_at: DNES + 'T08:00:00.000Z' },
  ]));
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky([
    { _id: 'qaDpAtt1', class_id: 'qaK2a', class_name: 'Zumba Kids 2 (7–14)', class_location: 'Detva', class_time_start: '15:00', user_id: D1, user_name: 'Dorotka Dvojmama', booking_date: den(-6), status: 'attended', attendance_status: 'attended', is_child_booking: true, child_name: 'Dorotka Dvojmama', booked_by: MAMA, auto_kids: true, created_at: den(-7) + 'T10:00:00.000Z' },
  ]));
  // predbežný zoznam: Lesanka zaplatila 35 € pred 40 dňami (členstvo zo zoznamu už skončilo), Ninka bez platby
  fs.writeFileSync(path.join(DATA, 'kids_roster.db'), riadky([
    { _id: 'qaRosLes', name: 'Lesanka', group: 'Kids 2', note: '', attendance: {}, paid: { amount: 35, method: 'cash', date: den(-40), plan_id: 'bronze', tx_id: null }, linked_user_id: null, created_by: ADM, created_at: '2026-09-13T14:58:00.000Z' },
    { _id: 'qaRosNin', name: 'Ninka', group: 'Kids 2', note: '', attendance: {}, paid: null, linked_user_id: null, created_by: ADM, created_at: '2026-09-13T14:58:00.000Z' },
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky([
    { _id: 'qaDpSet1', key: 'retro_confirm_v1', value: true, at: '2026-01-01T00:00:00.000Z' },
    { _id: 'qaDpSet2', key: 'noshow_revert_v1', value: true, at: '2026-01-01T00:00:00.000Z' },
    { _id: 'qaDpSet4', key: 'zumba_kids_hodiny_20260909', value: true, at: '2026-01-01T00:00:00.000Z' },
    { _id: 'qaDpSet5', key: 'zumba_kids_casy_20260909b', value: true, at: '2026-01-01T00:00:00.000Z' },
    { _id: 'qaDpSet6', key: 'zumba_kids_prehodenie_20260909c', value: true, at: '2026-01-01T00:00:00.000Z' },
    { _id: 'qaDpSet7', key: 'zumba_kids_casy_20260913', value: true, at: '2026-01-01T00:00:00.000Z' },
  ]));

  console.log('\nSERVER — štart…');
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_FAKE: '1', STRIPE_SECRET_KEY: 'sk_test_qa', MAIL_OFF: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await sleep(1000); } }
  await sleep(4000);
  try {
    const mj = {}, cj = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.dp.mama@qa-biz.local', password: 'Heslo123!' } }, mj);
    ok('mama prihlásená', lg.status === 200, JSON.stringify(lg.d));
    await j('/api/login', { method: 'POST', body: { email: 'qa.dp.cudzia@qa-biz.local', password: 'Heslo123!' } }, cj);

    // ── 1) prehľad rodiča ──
    const ov = await j('/api/family/overview', {}, mj);
    ok('prehľad: obe deti', ov.status === 200 && (ov.d.children || []).length === 2, JSON.stringify(ov.d && ov.d.children && ov.d.children.map(c => c.name)));
    ok('prehľad: skupiny Kids 1 a Kids 2 s dvoma hodinami', ov.d && ov.d.skupiny && ov.d.skupiny.map(s => s.key).join(',') === 'Kids 1,Kids 2' && ov.d.skupiny.every(s => s.classes.length === 2), JSON.stringify(ov.d && ov.d.skupiny && ov.d.skupiny.map(s => [s.key, s.class_ids.length])));
    ok('prehľad: cena 49,90 s odberom, 54,90 ručne', ov.d && ov.d.plan && ov.d.plan.price === 49.9 && ov.d.plan.price_manual === 54.9, JSON.stringify(ov.d && ov.d.plan));
    const d1 = ov.d.children.find(c => c.id === D1), d2 = ov.d.children.find(c => c.id === D2);
    ok('dieťa 1: členstvo aktívne, odber, odporúčané Kids 2, ešte bez skupiny, 1 odchodená', d1 && d1.membership && d1.membership.active && d1.auto_renew && d1.age_group === 'Kids 2' && !d1.skupina && d1.attended === 1, JSON.stringify(d1 && { m: d1.membership, ar: d1.auto_renew, ag: d1.age_group, sk: d1.skupina, att: d1.attended }));
    ok('dieťa 2: bez členstva, odporúčané Kids 1', d2 && !d2.membership && d2.age_group === 'Kids 1', JSON.stringify(d2 && { m: d2.membership, ag: d2.age_group }));

    // ── 2) detail dieťaťa ──
    const det = await j('/api/family/children/' + D1, {}, mj);
    ok('detail: skupiny, plán, história, prázdne najbližšie', det.status === 200 && det.d.skupiny.length === 2 && det.d.plan.price_manual === 54.9 && det.d.history.length === 1 && det.d.upcoming.length === 0, JSON.stringify(det.d && { s: det.d.skupiny && det.d.skupiny.length, h: det.d.history && det.d.history.length, u: det.d.upcoming && det.d.upcoming.length }));
    const cudzi = await j('/api/family/children/' + D1, {}, cj);
    ok('detail cudzieho dieťaťa → 403', cudzi.status === 403, 'HTTP ' + cudzi.status);
    const page = await fetch(BASE + '/dieta/' + D1);
    ok('stránka /dieta/:id sa servíruje', page.status === 200 && /Profil dieťaťa/.test(await page.text()), 'HTTP ' + page.status);

    // ── 3) výber skupiny pre dieťa s členstvom → hodiny + rezervácie ──
    const put = await j('/api/family/children/' + D1, { method: 'PUT', body: { kids_group: 'Kids 2' } }, mj);
    ok('PUT kids_group Kids 2 → 2 hodiny, rezervácie na najbližšie termíny', put.status === 200 && put.d.kids_group === 'Kids 2' && put.d.auto_classes.length === 2 && put.d.auto_bookings === 2, JSON.stringify(put.d));
    let bks = rd('bookings.db').filter(b => b.user_id === D1 && b.status === 'confirmed');
    ok('rezervácie sú automatické (auto_kids) na Kids 2', bks.length === 2 && bks.every(b => b.auto_kids && /Kids 2/.test(b.class_name)), JSON.stringify(bks.map(b => [b.class_name, b.booking_date])));
    const ov2 = await j('/api/family/overview', {}, mj);
    ok('prehľad: spoločný týždeň má 2 hodiny Dorotky, dieťa má skupinu Kids 2', ov2.d.tyzden.length === 2 && ov2.d.tyzden.every(t => t.child_id === D1) && ov2.d.children.find(c => c.id === D1).skupina === 'Kids 2', JSON.stringify(ov2.d.tyzden));
    // zmena skupiny → staré automatické rezervácie preč, nové na Kids 1
    const put2 = await j('/api/family/children/' + D1, { method: 'PUT', body: { kids_group: 'Kids 1' } }, mj);
    bks = rd('bookings.db').filter(b => b.user_id === D1 && b.status === 'confirmed');
    ok('zmena skupiny na Kids 1: staré rezervácie zrušené, nové 2 na Kids 1', put2.status === 200 && bks.length === 2 && bks.every(b => /Kids 1/.test(b.class_name)) && rd('bookings.db').filter(b => b.user_id === D1 && b.status === 'cancelled').length === 2, JSON.stringify(bks.map(b => b.class_name)));
    const zla = await j('/api/family/children/' + D1, { method: 'PUT', body: { kids_group: 'Kids 9' } }, mj);
    ok('neznáma skupina → 400', zla.status === 400, 'HTTP ' + zla.status);
    // skupina bez členstva: uloží sa, rezervácie žiadne
    const put3 = await j('/api/family/children/' + D2, { method: 'PUT', body: { kids_group: 'Kids 1' } }, mj);
    ok('dieťa bez členstva: skupina sa uloží, rezervácie 0 (až po zaplatení)', put3.status === 200 && put3.d.auto_bookings === 0 && rd('bookings.db').filter(b => b.user_id === D2).length === 0, JSON.stringify(put3.d));

    // ── 4) nákup v hotovosti pre dieťa 2 so skupinou → 54,90 a hneď zaradené ──
    const buy = await j('/api/membership/buy', { method: 'POST', body: { plan_id: 'bronze', payment_method: 'manual', for_child_id: D2, kids_group: 'Kids 1' } }, mj);
    ok('hotovosť pre dieťa: cena bez odberu 54,90 €', buy.status === 200 && buy.d.ok && Math.abs(buy.d.final_price - 54.9) < 0.001, 'HTTP ' + buy.status + ' ' + JSON.stringify(buy.d));
    const u2 = rd('users.db').find(u => u._id === D2);
    ok('dieťa 2 má po nákupe skupinu Kids 1 (auto_classes)', u2 && u2.kids_group === 'Kids 1' && (u2.auto_classes || []).length === 2, JSON.stringify(u2 && [u2.kids_group, u2.auto_classes]));
    // mama pre seba: cena bez prirážky
    const buyMama = await j('/api/membership/buy', { method: 'POST', body: { plan_id: 'bronze', payment_method: 'manual' } }, mj);
    ok('mama pre seba: Bronze v hotovosti stále 49,90 €', buyMama.status === 200 && Math.abs(buyMama.d.final_price - 49.9) < 0.001, JSON.stringify(buyMama.d));
    // promo náhľad pre dieťa bez odberu ráta z 54,90
    const pv = await j('/api/promo/validate', { method: 'POST', body: { code: 'NEEXISTUJE', plan_id: 'bronze', for_child_id: D2, renew: false } }, mj);
    ok('promo náhľad pre dieťa bez odberu: vychádza z 54,90 (kód neplatný, ale cena správna)', pv.status === 200 && pv.d && pv.d.ok === false, JSON.stringify(pv.d));

    // ── 5) odber pre dieťa (STRIPE_FAKE): názov produktu + návrat do profilu dieťaťa ──
    // (hotovostný nákup čaká na potvrdenie, takže odber nie je blokovaný; STRIPE_FAKE nevracia url → 400 zo Stripe, nie 403/500)
    const sub = await j('/api/stripe/subscribe', { method: 'POST', body: { plan_id: 'bronze', for_child_id: D2, kids_group: 'Kids 1' } }, mj);
    ok('odber pre vlastné dieťa prejde kontrolou rodiča (nie 403/500)', sub.status !== 403 && sub.status !== 500, 'HTTP ' + sub.status + ' ' + JSON.stringify(sub.d));
    const subCudzi = await j('/api/stripe/subscribe', { method: 'POST', body: { plan_id: 'bronze', for_child_id: D2, kids_group: 'Kids 1' } }, cj);
    ok('odber pre cudzie dieťa → 403', subCudzi.status === 403, 'HTTP ' + subCudzi.status);
    // vypnutie odberu dieťaťa 1 → oznam rodičovi s 54,90
    const canc = await j('/api/stripe/subscribe/cancel', { method: 'POST', body: { member_id: D1, reason: 'other', note: 'qa' } }, mj);
    const ozn = rd('notifications.db').filter(n => n.user_id === MAMA && n.title === 'Odber zrušený');
    ok('vypnutie automatickej platby dieťaťa: oznam rodičovi spomína 54,90 € a ručnú platbu', canc.status === 200 && ozn.length === 1 && /54,90/.test(ozn[0].body) && /Dorotka/.test(ozn[0].body), JSON.stringify(ozn.map(n => n.body)));
    const ov3 = await j('/api/family/overview', {}, mj);
    ok('prehľad po vypnutí: dieťa 1 bez odberu, členstvo beží ďalej', !ov3.d.children.find(c => c.id === D1).auto_renew && ov3.d.children.find(c => c.id === D1).membership.active, JSON.stringify(ov3.d.children.find(c => c.id === D1).membership));

    // ── 6) výnimka (Marek 20. 9.: „Lesanka a Jasnička majú jedinú výnimku 35 €, inak všetci 49,90") ──
    const aj = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.dp.admin@qa-biz.local', password: 'Heslo123!' } }, aj);
    const ros = await j('/api/kids/roster', {}, aj);
    const les = (ros.d.rows || []).find(r => r.name === 'Lesanka');
    ok('migrácia: Lesanka v zozname má výnimku 35 €, Ninka nie', les && les.custom_price === 35 && !(ros.d.rows.find(r => r.name === 'Ninka') || {}).custom_price, JSON.stringify(ros.d.rows && ros.d.rows.map(r => [r.name, r.custom_price])));
    // rodič založí profil Lesanky, admin ju prepojí → dohodnutá cena prejde na dieťa
    const nova = await j('/api/family/children', { method: 'POST', body: { name: 'Lesanka Dvojmama', birth_date: '2016-02-02' } }, mj);
    const link = await j('/api/admin/kids/roster/' + les._id + '/link', { method: 'POST', body: { user_id: nova.d.id } }, aj);
    const uLes = rd('users.db').find(u => u._id === nova.d.id);
    ok('prepojenie: dieťa má custom_prices.bronze 35 a skupinu zo zoznamu', link.status === 200 && uLes && uLes.custom_prices && uLes.custom_prices.bronze === 35 && uLes.kids_group === 'Kids 2', JSON.stringify(link.d) + ' ' + JSON.stringify(uLes && [uLes.custom_prices, uLes.kids_group]));
    const detLes = await j('/api/family/children/' + nova.d.id, {}, mj);
    ok('profil Lesanky: cena 35 s odberom aj bez (dohodnutá, bez prirážky)', detLes.d.plan.price === 35 && detLes.d.plan.price_manual === 35 && detLes.d.plan.dohodnuta === true, JSON.stringify(detLes.d.plan));
    // hotovosť pre Lesanku = 35 (nie 38,50); členstvo zo zoznamu je 35 € od 1. 9. → skončilo, nákup prejde
    const buyLes = await j('/api/membership/buy', { method: 'POST', body: { plan_id: 'bronze', payment_method: 'manual', for_child_id: nova.d.id } }, mj);
    ok('hotovosť pre Lesanku: 35 € (dohodnutá cena, žiadna prirážka)', buyLes.status === 200 && Math.abs(buyLes.d.final_price - 35) < 0.001, 'HTTP ' + buyLes.status + ' ' + JSON.stringify(buyLes.d));
    const ovL = await j('/api/family/overview', {}, mj);
    ok('prehľad: Lesanka má dohodnuta_cena 35, ostatné deti nie', ovL.d.children.find(c => c.id === nova.d.id).dohodnuta_cena === 35 && ovL.d.children.filter(c => c.id !== nova.d.id).every(c => !c.dohodnuta_cena), JSON.stringify(ovL.d.children.map(c => [c.name, c.dohodnuta_cena])));
  } catch (e) { failed++; console.log('  ❌ výnimka: ' + (e.stack || e.message)); }
  finally {
    proc.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log(`\n${passed} ✅  ${failed} ❌`);
    if (failed) console.log(log.split('\n').filter(l => /error|chyba/i.test(l)).slice(-15).join('\n'));
    process.exit(failed ? 1 : 0);
  }
})();
