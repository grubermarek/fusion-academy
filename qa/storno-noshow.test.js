/**
 * Storno rezervácie, ktorá medzitým dostala automatické „neprišla" (13. 9. 2026):
 * Alena N. sa omylom zapísala na detskú hodinu namiesto Zumby pre dospelých, job ju označil
 * ako no-show. Storno adminom musí značku zrušiť a počítadlo no_show_count vrátiť.
 * Migrácia deti_storno_noshow_20260913 opraví už stornované dospelé rezervácie na detských hodinách.
 * Spustenie:  node qa/storno-noshow.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
const PORT = 4536, BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-storno-'));
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
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
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const pm = new Date(+DNES.slice(0, 4), +DNES.slice(5, 7) - 2, 1);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaStAdmin00001', name: 'Admin', email: 'qa.st.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01', referral_code: 'QASTAD' },
    { _id: 'qaStAlena00001', name: 'Alena Testová', email: 'qa.st.alena@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-06-01', referral_code: 'QASTAL', no_show_count: 2, visit_count: 5, membership_plan: 'bronze', membership_expires: '2026-12-31T00:00:00.000Z' },
    { _id: 'qaStBea000001', name: 'Bea Testová', email: 'qa.st.bea@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-06-01', referral_code: 'QASTBE', no_show_count: 1, visit_count: 2 },
  ]));
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    { _id: 'qaStKids2', name: 'Zumba Kids 2 (7–14)', emoji: '🧒', category: 'Deti', day_of_week: 5, time_start: '15:00', time_end: '16:00', location: 'Detva', capacity: 30, active: true, created_at: '2026-09-09' },
    { _id: 'qaStZumba', name: 'Zumba', emoji: '💃', category: 'Zumba', day_of_week: 5, time_start: '19:00', time_end: '20:00', location: 'Detva', capacity: 30, active: true, created_at: '2026-01-01' },
  ]));
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky([
    // Alena: omyl na detskej hodine, už označená no_show (ešte confirmed) + skutočná Zumba
    { _id: 'qaStBkKids', class_id: 'qaStKids2', class_name: 'Zumba Kids 2 (7–14)', user_id: 'qaStAlena00001', user_name: 'Alena Testová', booking_date: '2026-09-11', status: 'confirmed', attendance_status: 'no_show', attendance_source: 'auto', no_show_at: '2026-09-11T14:30:00.000Z', access_method: 'membership', created_at: '2026-09-11T12:00:00.000Z' },
    { _id: 'qaStBkZumba', class_id: 'qaStZumba', class_name: 'Zumba', user_id: 'qaStAlena00001', user_name: 'Alena Testová', booking_date: '2026-09-11', status: 'attended', attendance_status: 'attended', access_method: 'membership', created_at: '2026-09-11T12:01:00.000Z' },
    // Bea: dospelá na detskej hodine, už stornovaná, no_show ostalo → rieši migrácia
    { _id: 'qaStBkBea', class_id: 'qaStKids2', class_name: 'Zumba Kids 2 (7–14)', user_id: 'qaStBea000001', user_name: 'Bea Testová', booking_date: '2026-09-11', status: 'cancelled', cancelled_at: '2026-09-13T10:00:00.000Z', attendance_status: 'no_show', attendance_source: 'auto', no_show_at: '2026-09-11T14:30:00.000Z', access_method: 'membership', created_at: '2026-09-11T12:00:00.000Z' },
    // „platí na mieste" 10 € — admin opraví sumu na 8 € (technika s členstvom), bez zmeny stavu
    { _id: 'qaStBkTech', class_id: 'qaStZumba', class_name: 'Technický tréning', user_id: 'qaStAlena00001', user_name: 'Alena Testová', booking_date: '2026-09-13', status: 'attended', attendance_status: 'attended', access_method: 'pay_on_site', pay_on_site: true, pay_amount: 10, created_at: '2026-09-13T16:00:00.000Z' },
    // skutočný no-show na dospelej hodine — migrácia sa ho nesmie dotknúť
    { _id: 'qaStBkBea2', class_id: 'qaStZumba', class_name: 'Zumba', user_id: 'qaStBea000001', user_name: 'Bea Testová', booking_date: '2026-09-10', status: 'cancelled', attendance_status: 'no_show', attendance_source: 'auto', no_show_at: '2026-09-10T20:30:00.000Z', access_method: 'membership', created_at: '2026-09-10T12:00:00.000Z' },
  ]));
  fs.writeFileSync(path.join(DATA, 'monthly_winners.db'), riadky([{ _id: 'qaStMW01', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'x', created_at: '2026-01-01' }]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['retro_confirm_v1', 'noshow_revert_v1', 'zumba_kids_hodiny_20260909', 'zumba_kids_casy_20260909b', 'zumba_kids_prehodenie_20260909c', 'zumba_kids_casy_20260913', 'alena_tx_karta_v1']
    .map((k, i) => ({ _id: 'qaStSet' + i, key: k, value: true, at: '2026-01-01T00:00:00.000Z' })).concat([{ _id: 'qaStSetNS', key: 'no_show_from', value: '2026-01-01', at: '2026-01-01T00:00:00.000Z' }])));
  console.log('SERVER — štart…');
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', STRIPE_FAKE: '1' }, stdio: 'ignore' });
  const t0 = Date.now(); while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await sleep(1000); } }
  await sleep(4000);
  try {
    // migrácia pri štarte
    const bea = rd('users.db').find(u => u._id === 'qaStBea000001');
    const bkBea = rd('bookings.db').find(b => b._id === 'qaStBkBea'), bkBea2 = rd('bookings.db').find(b => b._id === 'qaStBkBea2');
    ok('migrácia: stornovaná dospelá rezervácia na detskej hodine už nemá no_show', bkBea && !bkBea.attendance_status && !bkBea.no_show_at && bkBea.no_show_corrected_by === 'migracia_20260913', JSON.stringify(bkBea));
    ok('migrácia: skutočný no-show na dospelej hodine ostal', bkBea2 && bkBea2.attendance_status === 'no_show');
    ok('migrácia: Bea no_show_count 1 → 0', bea && bea.no_show_count === 0, JSON.stringify(bea && bea.no_show_count));
    ok('migrácia sa zapísala do settings', rd('settings.db').some(s => s.key === 'deti_storno_noshow_20260913'));
    // admin storno
    const aj = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.st.admin@qa-biz.local', password: 'Heslo123!' } }, aj);
    const c = await j('/api/admin/bookings/qaStBkKids', { method: 'PUT', body: { status: 'cancelled' } }, aj);
    await sleep(400);
    const bk = rd('bookings.db').find(b => b._id === 'qaStBkKids');
    const alena = rd('users.db').find(u => u._id === 'qaStAlena00001');
    ok('admin storno prešlo', c.status === 200 && c.d.ok, JSON.stringify(c.d));
    ok('rezervácia je stornovaná bez no_show značky', bk.status === 'cancelled' && !bk.attendance_status && !bk.no_show_at && bk.no_show_corrected_by === 'admin_cancel', JSON.stringify(bk));
    ok('Alena no_show_count 2 → 1', alena.no_show_count === 1, JSON.stringify(alena.no_show_count));
    ok('skutočná Zumba ostala odchodená, návštevy nezmenené', rd('bookings.db').find(b => b._id === 'qaStBkZumba').status === 'attended' && alena.visit_count === 5);
    // oprava sumy „platí na mieste" (Marek 13. 9.: Stanka technika 10 → 8 € s členstvom)
    const pa = await j('/api/admin/bookings/qaStBkTech', { method: 'PUT', body: { pay_amount: 8 } }, aj);
    await sleep(300);
    const bkT = rd('bookings.db').find(b => b._id === 'qaStBkTech');
    ok('admin opraví sumu platby na mieste 10 → 8 € bez zmeny stavu', pa.status === 200 && pa.d.pay_amount === 8 && bkT.pay_amount === 8 && bkT.status === 'attended' && bkT.pay_amount_edited_by === 'qaStAdmin00001', JSON.stringify({ r: pa.d, pa: bkT.pay_amount, s: bkT.status }));
    ok('neplatná suma → 400', (await j('/api/admin/bookings/qaStBkTech', { method: 'PUT', body: { pay_amount: -1 } }, aj)).status === 400);
    ok('suma sa nedá nastaviť rezervácii, ktorá nie je „platí na mieste"', (await j('/api/admin/bookings/qaStBkZumba', { method: 'PUT', body: { pay_amount: 8 } }, aj)).status === 400);
    ok('PUT bez stavu aj bez sumy → 400', (await j('/api/admin/bookings/qaStBkTech', { method: 'PUT', body: {} }, aj)).status === 400);
    // druhé storno tej istej rezervácie nič neodpočíta
    const c2 = await j('/api/admin/bookings/qaStBkKids', { method: 'PUT', body: { status: 'cancelled' } }, aj);
    await sleep(300);
    ok('opakované storno nič neodpočíta', c2.status === 200 && rd('users.db').find(u => u._id === 'qaStAlena00001').no_show_count === 1);
  } catch (e) { failed++; console.log('  ❌ výnimka: ' + e.stack); }
  finally { proc.kill(); console.log('\nSTORNO NO-SHOW: ' + passed + ' OK / ' + failed + ' chýb'); setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 600); }
})();
