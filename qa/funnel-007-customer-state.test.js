/**
 * FUNNEL-007: customer state engine (/api/my-state)
 * Prechádza jednu klientku stavmi: REGISTERED_NO_BOOKING → FIRST_BOOKED →
 * FIRST_ATTENDED_NO_PURCHASE → NEW_CUSTOMER → ACTIVE → AT_RISK.
 * (FIRST_NO_SHOW a CHURNED vyžadujú časové posuny no-show jobu / expiráciu —
 *  logika je pokrytá vetvami rovnakej funkcie, tu netestované E2E.)
 *
 * Spustenie:  node qa/funnel-007-customer-state.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4496;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-f007-'));

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
const state = async (jar) => (await j('/api/my-state', {}, jar)).d || {};
const past = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

(async () => {
  console.log('FUNNEL-007 QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    const jar = {}, adm = {};
    await j('/api/register', { method: 'POST', body: { name: 'Qa Stavova', email: 'qa.stav@qa-biz.local', password: 'Heslo123!', consent: true, city: 'Detva' } }, jar);
    await j('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } }, adm);
    const _l1=((await j('/api/admin/leads?search=qa.stav', {}, adm)).d.leads||[])[0]||{}; const uid=_l1._id||_l1.id;

    // 1) čerstvá registrácia
    let st = await state(jar);
    ok('REGISTERED_NO_BOOKING', st.state === 'REGISTERED_NO_BOOKING', st.state);

    // 2) rezervácia budúcej hodiny
    const sug = (await j('/api/first-class/suggestions', {}, jar)).d;
    await j('/api/bookings', { method: 'POST', body: { class_id: sug.items[0].class_id } }, jar);
    st = await state(jar);
    ok('FIRST_BOOKED + detail rezervácie', st.state === 'FIRST_BOOKED' && !!st.next_booking && !!st.next_booking.time_start, st.state);

    // 3) admin zapíše ODCHODENÚ hodinu v minulosti (manual-booking so starým dátumom)
    //    → attended=1, budúca rezervácia stále existuje → ACTIVE má prednosť? Nie:
    //    attended=1 & bez platby & bez členstiev → FIRST_ATTENDED_NO_PURCHASE
    //    (budúci booking na stave nič nemení — konverzia je dôležitejšia).
    const mb1 = await j('/api/attendance/manual-booking', { method: 'POST', body: { user_id: uid, class_id: sug.items[0].class_id, booking_date: past(2), is_free: true } }, adm);
    ok('manual-booking 1 ok', mb1.d && mb1.d.ok, JSON.stringify(mb1.d));
    st = await state(jar);
    ok('FIRST_ATTENDED_NO_PURCHASE', st.state === 'FIRST_ATTENDED_NO_PURCHASE', st.state);

    // 4) členstvo (platené) + stále len 1 účasť → NEW_CUSTOMER
    await j('/api/admin/users/' + uid + '/grant-membership', { method: 'POST', body: { plan_id: 'bronze', gift: false, payment_method: 'cash', amount: 50 } }, adm);
    st = await state(jar);
    ok('NEW_CUSTOMER (1 účasť + platí)', st.state === 'NEW_CUSTOMER', st.state);

    // 5) druhá odchodená hodina (nedávno) + budúca rezervácia z kroku 2 → ACTIVE
    await j('/api/attendance/manual-booking', { method: 'POST', body: { user_id: uid, class_id: (sug.items[1] || sug.items[0]).class_id, booking_date: past(1), is_free: true } }, adm);
    st = await state(jar);
    ok('ACTIVE (2 účasti + budúca rezervácia)', st.state === 'ACTIVE' && !!st.next_booking, st.state);

    // 6) AT_RISK: zruš budúcu rezerváciu a posuň účasti do minulosti nevieme — miesto toho
    //    nová klientka: 2 staré účasti (20+ dní), členstvo, žiadna budúca rezervácia
    const jar2 = {};
    await j('/api/register', { method: 'POST', body: { name: 'Qa Riskova', email: 'qa.risk@qa-biz.local', password: 'Heslo123!', consent: true, city: 'Zvolen' } }, jar2);
    const _l2=((await j('/api/admin/leads?search=qa.risk', {}, adm)).d.leads||[])[0]||{}; const uid2=_l2._id||_l2.id;
    await j('/api/attendance/manual-booking', { method: 'POST', body: { user_id: uid2, class_id: sug.items[0].class_id, booking_date: past(30), is_free: true } }, adm);
    await j('/api/attendance/manual-booking', { method: 'POST', body: { user_id: uid2, class_id: (sug.items[1] || sug.items[0]).class_id, booking_date: past(23), is_free: true } }, adm);
    await j('/api/admin/users/' + uid2 + '/grant-membership', { method: 'POST', body: { plan_id: 'bronze', gift: false, payment_method: 'cash', amount: 50 } }, adm);
    const st2 = await state(jar2);
    ok('AT_RISK (členka, 23 dní bez hodiny, bez rezervácie)', st2.state === 'AT_RISK' && Array.isArray(st2.items) && st2.items.length > 0, st2.state);
    ok('AT_RISK nesie days_since', st2.days_since >= 20, String(st2.days_since));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nFUNNEL-007: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
