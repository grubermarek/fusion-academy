/**
 * E2E: admin notifikácia o každom predaji — platený predaj notifikuje,
 * darček a test účet nie.
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
const wait = ms => new Promise(r => setTimeout(r, ms));
const saleNotifs = async () => (((await g('admin', '/api/notifications')).data) || []).filter(n => n.type === 'sale');

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ SALE NOTIFY AUDIT ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });
  const base = (await saleNotifs()).length;

  // platený predaj → notifikácia
  await post('C1', '/api/register', { name: 'SALE Klientka', email: 'sale-cli-' + uniq + '@qa-biz.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
  const c1 = (await g('C1', '/api/me')).data || {};
  await post('admin', '/api/admin/users/' + c1.id + '/grant-membership', { plan_id: 'bronze', gift: false, payment_method: 'cash', amount: 50 });
  await wait(800);
  let list = await saleNotifs();
  ok('platený predaj → sale notifikácia', list.length === base + 1, { pred: base, po: list.length });
  ok('notifikácia má sumu + meno + produkt', list.length && /50\.00/.test(list[0].title) && /SALE Klientka/.test(list[0].body), list[0]);

  // darček → žiadna notifikácia
  await post('C2', '/api/register', { name: 'SALE Darcek', email: 'sale-gift-' + uniq + '@qa-biz.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
  const c2 = (await g('C2', '/api/me')).data || {};
  await post('admin', '/api/admin/users/' + c2.id + '/grant-membership', { plan_id: 'gold', gift: true });
  await wait(800);
  ok('darček → bez notifikácie', (await saleNotifs()).length === base + 1, null);

  // test účet → žiadna notifikácia
  await post('C3', '/api/register', { name: 'SALE Test', email: 'sale-test-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
  const c3 = (await g('C3', '/api/me')).data || {};
  await post('admin', '/api/admin/users/' + c3.id + '/grant-membership', { plan_id: 'silver', gift: false, payment_method: 'cash', amount: 75 });
  await wait(800);
  ok('test účet → bez notifikácie', (await saleNotifs()).length === base + 1, null);

  // permanentka → notifikácia
  await post('admin', '/api/admin/users/' + c2.id + '/grant-membership', { plan_id: 'permanentka10', gift: false, payment_method: 'cash', amount: 80 });
  await wait(800);
  list = await saleNotifs();
  ok('permanentka → sale notifikácia', list.length === base + 2 && /80\.00/.test(list[0].title), list[0]);

  console.log(`\n═══ VÝSLEDOK: ${PASS} ✓ / ${FAIL} ✗ ═══`);
  if (FAIL) { console.log(FAILS.map(f => f.name).join('\n')); process.exit(1); }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
