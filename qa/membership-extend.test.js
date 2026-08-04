/**
 * E2E: obnova mesačného členstva NADVÄZUJE na koniec predchádzajúceho —
 * admin grant-membership aj trénerské record-membership. Izolovaná inštancia.
 */
const BASE = 'http://localhost:' + (process.env.QA_PORT || 3999);
let PASS = 0, FAIL = 0; const FAILS = [];
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; FAILS.push({ name }); console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail) : '')); }
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
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ MEMBERSHIP EXTEND AUDIT ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });
  const mk = async (jar, name) => { await post(jar, '/api/register', { name, email: jar.toLowerCase() + '-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', city: 'Zvolen', consent: true }); return ((await g(jar, '/api/me')).data || {}).id; };
  const expOf = async jar => ((((await g(jar, '/api/me')).data || {}).membership) || {}).expires_at || null;

  // [1] Admin grant-membership: 2× platba silver po sebe → ~60 dní
  const idA = await mk('A', 'AUDIT Ext A');
  await post('admin', '/api/admin/users/' + idA + '/grant-membership', { plan_id: 'silver', gift: false, payment_method: 'cash' });
  const e1 = await expOf('A');
  ok('1. platba → ~30 dní', e1 && Math.abs(days(new Date().toISOString(), e1) - 30) <= 1, e1);
  await post('admin', '/api/admin/users/' + idA + '/grant-membership', { plan_id: 'silver', gift: false, payment_method: 'cash' });
  const e2 = await expOf('A');
  ok('2. platba NADVÄZUJE → ~60 dní', e2 && Math.abs(days(new Date().toISOString(), e2) - 60) <= 1, { e1, e2 });
  ok('rozdiel presne ~30 dní', Math.abs(days(e1, e2) - 30) <= 1, { e1, e2 });

  // [2] Trénerské record-membership: to isté
  const idB = await mk('B', 'AUDIT Ext B');
  await post('admin', '/api/attendance/record-membership', { user_id: idB, plan_id: 'bronze', amount: 39, payment_method: 'cash' });
  const b1 = await expOf('B');
  ok('record 1. platba → ~30 dní', b1 && Math.abs(days(new Date().toISOString(), b1) - 30) <= 1, b1);
  await post('admin', '/api/attendance/record-membership', { user_id: idB, plan_id: 'bronze', amount: 39, payment_method: 'cash' });
  const b2 = await expOf('B');
  ok('record 2. platba NADVÄZUJE → ~60 dní', b2 && Math.abs(days(new Date().toISOString(), b2) - 60) <= 1, { b1, b2 });

  // [3] Explicitný expires_at v grant-membership stále funguje (má prednosť)
  const idC = await mk('C', 'AUDIT Ext C');
  await post('admin', '/api/admin/users/' + idC + '/grant-membership', { plan_id: 'bronze', gift: false, payment_method: 'cash', expires_at: '2026-12-24' });
  const c1 = await expOf('C');
  ok('explicitný dátum rešpektovaný', (c1 || '').slice(0, 10) === '2026-12-24', c1);

  console.log('\n═══ VÝSLEDOK: ' + PASS + ' PASS, ' + FAIL + ' FAIL ═══');
  if (FAIL) { FAILS.forEach(f => console.log('  FAIL: ' + f.name)); process.exit(1); }
})().catch(e => { console.error('CHYBA:', e); process.exit(1); });
