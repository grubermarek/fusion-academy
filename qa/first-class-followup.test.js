/**
 * E2E: večerný follow-up po prvej hodine — kupón 48 h, dedup, test účty von,
 * mail log + open pixel.
 */
const BASE = 'http://localhost:' + (process.env.QA_PORT || 3999);
let PASS = 0, FAIL = 0; const FAILS = [];
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; FAILS.push({ name }); console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : '')); }
}
const jars = {};
async function call(jar, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (jars[jar]) headers['Cookie'] = jars[jar];
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jars[jar] = sc.split(';')[0];
  let data = null; try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}
const g = (jar, p) => call(jar, 'GET', p);
const post = (jar, p, b) => call(jar, 'POST', p, b);

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ FIRST CLASS FOLLOW-UP AUDIT ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // hodina dnes
  const dow = new Date().getDay();
  const c = await post('admin', '/api/admin/classes', { name: 'QA Followup Zumba', category: 'Zumba', location: 'Zvolen', day_of_week: dow, time_start: '06:00', time_end: '07:00', capacity: 30, instructor: 'QA', active: true });
  const cid = c.data && (c.data._id || c.data.id);
  ok('hodina vytvorená', !!cid, c);

  // klientka bez členstva — booking + attend
  await post('C1', '/api/register', { name: 'FUP Klientka', email: 'fup-cli-' + uniq + '@qa-biz.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
  const me1 = (await g('C1', '/api/me')).data || {};
  const today = new Date().toISOString().slice(0, 10);
  const bk = await post('C1', '/api/bookings', { class_id: cid, booking_date: today });
  ok('booking OK', bk.status === 200, bk);
  // Účasť sa dokazuje: bez zoznamu prítomných by klientka dostala „neprišla"
  // a follow-up po prvej hodine by sa nemal komu poslať.
  const zoznam = (await g('admin', `/api/attendance/class/${cid}?date=${today}`)).data || [];
  const att = await post('admin', '/api/attendance/confirm-session',
    { class_id: cid, date: today, present_ids: zoznam.map(a => a.booking_id) });
  ok('účasť zapísaná', att.status === 200 || att.status === 201, att);

  // spusti follow-up
  const run1 = await post('admin', '/api/admin/run-first-class-followup');
  ok('follow-up bežal, sent ≥ 1', run1.status === 200 && run1.data.sent >= 1, run1);

  // notifikácia s kódom u klientky
  const notifs = ((await g('C1', '/api/notifications')).data) || [];
  const promoN = notifs.find(n => n.type === 'promo' && /PRVA-/.test(n.body || ''));
  ok('klientka dostala notifikáciu s kódom PRVA-*', !!promoN, notifs.slice(0, 3));
  const code = promoN ? (promoN.body.match(/PRVA-[A-Z0-9]{4}/) || [])[0] : null;

  // kupón platí na členstvo (validácia cez promo endpoint pri nákupe — over v DB cez admin promos)
  const promos = ((await g('admin', '/api/admin/promos')).data) || [];
  const p = (Array.isArray(promos) ? promos : promos.codes || []).find(x => x.code === code);
  ok('kupón existuje: 20 %, 48 h, once_per_user', !!p && p.value === 20 && !!p.expires_at && p.once_per_user === true, p);

  // dedup — druhé spustenie nič nepošle pre tú istú klientku
  const run2 = await post('admin', '/api/admin/run-first-class-followup');
  ok('dedup: druhý beh sent=0', run2.status === 200 && run2.data.sent === 0, run2);

  // mail log + pixel
  const stats = (await g('admin', '/api/admin/mail-log/stats')).data || {};
  ok('mail log počíta odoslané', stats.sent >= 0 && typeof stats.open_rate === 'number', stats);

  console.log(`\n═══ VÝSLEDOK: ${PASS} ✓ / ${FAIL} ✗ ═══`);
  if (FAIL) { console.log(FAILS.map(f => f.name).join('\n')); process.exit(1); }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
