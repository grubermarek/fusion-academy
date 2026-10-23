/**
 * Kiosk + deti (Marek 23. 10. 2026): „keď si rodič chce dať kódom booking na dieťa na Zumbu,
 * kiosk nereaguje" — rodič mal po ruke len svoj QR a kiosk mu pri detskej hodine ukázal
 * len dospelácke hodiny (žiadne), takže vyzeral mŕtvy.
 *
 * Overuje:
 *  - rodičov QR → day-classes vráti aj riadky detí (id „hodina~dieťa", meno dieťaťa, krytie dieťaťa),
 *  - signup s riadkom dieťaťa zapíše účasť DIEŤAŤU (nie rodičovi), návšteva ide dieťaťu,
 *  - dieťa bez členstva: 402 ask_cash s menom dieťaťa, s pay_on_site sa zapíše hotovosť,
 *  - cudzie dieťa v id → 400, bežný dospelý bez detí nemá riadky detí,
 *  - detský QR funguje ako doteraz (riadok bez „~").
 * Spustenie:  node qa/kiosk-deti.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4543;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-kiosk-deti-'));
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
  const kiosk = fs.readFileSync(path.join(ROOT, 'public', 'kiosk.html'), 'utf8');
  const dash = fs.readFileSync(path.join(ROOT, 'public', 'client-dashboard.html'), 'utf8');
  ok('kiosk: riadok dieťaťa má vlastné krytie a vysvetlenie', /plati_hotovost/.test(kiosk) && /lenDeti/.test(kiosk));
  ok('nástenka: QR dieťaťa je späť v riadku dieťaťa', /showChildQR\('\$\{c\.id\}'/.test(dash));

  const now = new Date();
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(now);
  const dow = now.getDay();
  const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const zac = new Date(now.getTime() - 5 * 60000), kon = new Date(now.getTime() + 55 * 60000);   // hodina práve beží
  const O30 = new Date(now.getTime() + 30 * 86400000).toISOString();
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zak = { rank: 1, is_admin: false, active: true, visit_count: 0, referral_credit: 0, city: 'Detva' };
  const ADM = 'qaKdAdmin00001', MAMA = 'qaKdMama000001', INA = 'qaKdIna0000001', D1 = 'qaKdDieta10001', D2 = 'qaKdDieta20001';
  const db = { account_creation_type: 'child', user_type: 'client', is_admin: false, active: true, visit_count: 0, free_class_used: true, single_entries: 0, free_credits: 0, referral_credit: 0, created_at: '2026-09-01' };
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: ADM, name: 'Admin Kiosk', email: 'qa.kd.admin@qa-biz.local', password: hash, referral_code: 'QAKDADM', ...zak, is_admin: true, user_type: 'admin', created_at: '2026-01-01' },
    { _id: MAMA, name: 'Katarína Mamová', email: 'qa.kd.mama@qa-biz.local', password: hash, referral_code: 'QAKDMAM', ...zak, user_type: 'client', free_class_used: true, created_at: '2026-06-01' },
    { _id: INA, name: 'Iná Bezdetná', email: 'qa.kd.ina@qa-biz.local', password: hash, referral_code: 'QAKDINA', ...zak, user_type: 'client', free_class_used: true, created_at: '2026-06-01' },
    { _id: D1, name: 'Sabinka Mamová', email: 'child-qakd1@internal.local', referral_code: 'CHILD-QAKD1', parent_id: MAMA, is_child: true, birth_date: '2018-04-04', birth_year: 2018, ...db, kids_group: 'Kids', auto_classes: ['qaKdKids'] },
    { _id: D2, name: 'Tobiáš Mamov', email: 'child-qakd2@internal.local', referral_code: 'CHILD-QAKD2', parent_id: MAMA, is_child: true, birth_date: '2020-05-05', birth_year: 2020, ...db },
  ]));
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    { _id: 'qaKdKids', name: 'Zumba Kids (4–14)', emoji: '🧒', category: 'Deti', level: 'Deti', instructor: 'Admin Kiosk', instructor_id: ADM, location: 'Detva', capacity: 30, price: 9, active: true, day_of_week: dow, time_start: hhmm(zac), time_end: hhmm(kon), created_at: '2026-10-01' },
  ]));
  fs.writeFileSync(path.join(DATA, 'memberships.db'), riadky([
    { _id: 'qaKdMem1', user_id: D1, user_name: 'Sabinka Mamová', plan_id: 'bronze', plan_name: 'Bronze', price: 49.9, status: 'active', started_at: now.toISOString(), expires_at: O30, payment_method: 'stripe', created_at: now.toISOString() },
  ]));
  // Sabinka má automatickú rezerváciu na dnešnú detskú hodinu (ako ju robí denný tick)
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky([
    { _id: 'qaKdAuto1', class_id: 'qaKdKids', class_name: 'Zumba Kids (4–14)', class_emoji: '🧒', class_location: 'Detva', class_time_start: hhmm(zac), class_time_end: hhmm(kon), day_of_week: dow, user_id: D1, user_name: 'Sabinka Mamová', user_email: '', booking_date: DNES, status: 'confirmed', attendance_status: 'pending', access_method: 'membership', is_child_booking: true, child_name: 'Sabinka Mamová', booked_by: MAMA, auto_kids: true, created_at: now.toISOString() },
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['retro_confirm_v1', 'noshow_revert_v1', 'zumba_kids_hodiny_20260909', 'zumba_kids_casy_20260909b', 'zumba_kids_prehodenie_20260909c', 'zumba_kids_casy_20260913', 'kids_roster_vynimky_20260920']
    .map((k, i) => ({ _id: 'qaKdSet' + i, key: k, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('\nSERVER — štart…');
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_FAKE: '1', MAIL_OFF: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await sleep(1000); } }
  await sleep(4000);
  try {
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.kd.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    const kcfg = await j('/api/admin/kiosk', {}, adm);
    const detva = (kcfg.d && kcfg.d.studios || []).find(x => x.slug === 'detva');
    ok('kiosk Detva existuje', !!detva);
    if (!detva) throw new Error('bez kiosku sa ďalej nedá');
    await j('/api/admin/kiosk/detva', { method: 'PUT', body: { enabled: true } }, adm);
    const K = detva.token, ST = 'detva';
    const zoznam = qr => j('/api/kiosk/day-classes', { method: 'POST', body: { studio: ST, k: K, qr_data: qr } });
    const prihlas = (qr, ids, extra = {}) => j('/api/kiosk/signup', { method: 'POST', body: { studio: ST, k: K, qr_data: qr, class_ids: ids, ...extra } });

    // 1) rodičov QR → riadky detí
    const dc = await zoznam('FA:' + MAMA);
    // (boot migrácie založia v Detve aj dospelácke hodiny — tie nás tu nezaujímajú)
    const rows = ((dc.d && dc.d.classes) || []).filter(r => r.child_id);
    const r1 = rows.find(r => r.child_id === D1), r2 = rows.find(r => r.child_id === D2);
    ok('rodičov QR: kiosk ponúkne detskú hodinu pre obe deti', dc.status === 200 && rows.length === 2 && r1 && r2 && dc.d.deti === true, JSON.stringify(rows.map(r => [r.id, r.name])));
    ok('riadok dieťaťa: id „hodina~dieťa", meno dieťaťa v názve, hodina práve beží', r1 && r1.id === 'qaKdKids~' + D1 && /Sabinka/.test(r1.name) && r1.teraz === true && r1.ucast === true, JSON.stringify(r1));
    ok('Sabinka má členstvo → bez hotovosti; Tobiáš bez členstva → platí v hotovosti', r1 && r1.plati_hotovost === false && r2 && r2.plati_hotovost === true && r2.cena_hotovost > 0, JSON.stringify([r1 && r1.plati_hotovost, r2 && r2.plati_hotovost, r2 && r2.cena_hotovost]));
    ok('Sabinka má automatickú rezerváciu → riadok je predznačený', r1 && r1.moja === 'booked' && r1.predznacit === true, JSON.stringify(r1 && [r1.moja, r1.predznacit]));
    const ina = await zoznam('FA:' + INA);
    ok('dospelá bez detí: žiadne riadky detí (detská hodina sa jej neponúka)', ina.status === 200 && !(ina.d.classes || []).some(r => r.child_id || /Kids/.test(r.name)) && !ina.d.deti, JSON.stringify((ina.d.classes || []).map(r => r.name)));

    // 2) zápis Sabinky cez rodičov QR
    const z1 = await prihlas('FA:' + MAMA, ['qaKdKids~' + D1]);
    const bk1 = rd('bookings.db').find(b => b.user_id === D1 && b.class_id === 'qaKdKids');
    ok('signup s riadkom dieťaťa: účasť zapísaná DIEŤAŤU (attended, kiosk)', z1.status === 200 && z1.d.ok && bk1 && bk1.status === 'attended' && /kiosk/.test(bk1.attended_by || ''), 'HTTP ' + z1.status + ' ' + JSON.stringify(z1.d) + ' ' + JSON.stringify(bk1 && [bk1.status, bk1.attended_by]));
    const us = rd('users.db');
    ok('návšteva ide dieťaťu, nie rodičovi', us.find(u => u._id === D1).visit_count === 1 && (us.find(u => u._id === MAMA).visit_count || 0) === 0 && !rd('bookings.db').some(b => b.user_id === MAMA), JSON.stringify([us.find(u => u._id === D1).visit_count, us.find(u => u._id === MAMA).visit_count]));
    ok('odpoveď: zapísané má meno dieťaťa, user je rodič', (z1.d.zapisane || []).length === 1 && /Sabinka/.test(z1.d.zapisane[0].name) && z1.d.user && z1.d.user.id === MAMA && (z1.d.deti || []).length === 1, JSON.stringify(z1.d.zapisane) + ' ' + JSON.stringify(z1.d.user));

    // 3) Tobiáš bez členstva: otázka na hotovosť s jeho menom, potom zápis
    const z2 = await prihlas('FA:' + MAMA, ['qaKdKids~' + D2]);
    ok('dieťa bez členstva: 402 ask_cash s menom dieťaťa a sumou', z2.status === 402 && z2.d.ask_cash && /Tobiáš/.test(z2.d.error) && z2.d.spolu > 0 && z2.d.hotovost[0].child_id === D2, 'HTTP ' + z2.status + ' ' + JSON.stringify(z2.d));
    ok('pred potvrdením hotovosti nič nezapísané', !rd('bookings.db').some(b => b.user_id === D2));
    const z3 = await prihlas('FA:' + MAMA, ['qaKdKids~' + D2], { pay_on_site: true });
    const bk2 = rd('bookings.db').find(b => b.user_id === D2);
    ok('s pay_on_site: zapísané dieťaťu s hotovosťou', z3.status === 200 && bk2 && bk2.pay_on_site === true && bk2.status === 'attended' && z3.d.hotovost_spolu > 0, JSON.stringify(z3.d) + ' ' + JSON.stringify(bk2 && [bk2.pay_on_site, bk2.pay_amount, bk2.status]));

    // 4) cudzie dieťa + detský QR ako doteraz
    const cudzie = await prihlas('FA:' + INA, ['qaKdKids~' + D1]);
    ok('cudzie dieťa v id → 400', cudzie.status === 400, 'HTTP ' + cudzie.status + ' ' + JSON.stringify(cudzie.d));
    const dd = await zoznam('FA:' + D1);
    ok('detský QR: riadok bez „~", už odchodená', dd.status === 200 && dd.d.classes.length === 1 && dd.d.classes[0].id === 'qaKdKids' && dd.d.classes[0].moja === 'attended', JSON.stringify(dd.d.classes));
    const opak = await prihlas('FA:' + MAMA, ['qaKdKids~' + D1]);
    ok('opakovaný sken: nič sa nezdvojí (uz_mala 1, 0 nových)', opak.status === 200 && (opak.d.zapisane || []).length === 0 && opak.d.uz_mala === 1 && rd('bookings.db').filter(b => b.user_id === D1).length === 1, JSON.stringify(opak.d));
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
