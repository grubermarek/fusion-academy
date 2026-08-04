/**
 * E2E: Hromadné správy „Podľa mesta" — mestá sa berú aj z registrácie (leady/noví bez dochádzky),
 * odoslanie na mesto zasiahne správnych príjemcov. Izolovaná inštancia.
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

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ OUTREACH CITY AUDIT ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });
  // 2× Zvolen, 1× Brezno — čerstvé registrácie BEZ dochádzky
  await post('A', '/api/register', { name: 'AUDIT City A', email: 'audit-city-a-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
  await post('B', '/api/register', { name: 'AUDIT City B', email: 'audit-city-b-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
  await post('C', '/api/register', { name: 'AUDIT City C', email: 'audit-city-c-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', city: 'Brezno', consent: true });

  const seg = (await g('admin', '/api/admin/outreach/segments')).data || {};
  ok('segments ok', Array.isArray(seg.segments) && seg.segments.length > 0, seg);
  const zv = (seg.cities || []).find(c => c.key === 'Zvolen');
  const br = (seg.cities || []).find(c => c.key === 'Brezno');
  ok('Zvolen v mestách (count >= 2)', zv && zv.count >= 2, seg.cities);
  ok('Brezno v mestách (count >= 1)', br && br.count >= 1, seg.cities);

  // Odoslanie len na Brezno (notifikácia) — zasiahne C, nie A/B
  const send = await post('admin', '/api/admin/outreach/send', { segment: 'city', city: 'Brezno', channel: 'notification', subject: 'AUDIT test Brezno', message: 'Testovacia správa pre Brezno.' });
  ok('send ok', send.status === 200 && send.data.ok, send.data);
  ok('príjemcovia = počet Brezna', send.data.recipients === br.count, send.data);
  const notifC = ((await g('C', '/api/notifications')).data || []);
  const listC = Array.isArray(notifC) ? notifC : (notifC.notifications || []);
  ok('C (Brezno) dostal notifikáciu', listC.some(n => /AUDIT test Brezno/.test(n.title || '')), listC.slice(0, 3));
  const notifA = ((await g('A', '/api/notifications')).data || []);
  const listA = Array.isArray(notifA) ? notifA : (notifA.notifications || []);
  ok('A (Zvolen) NEdostal notifikáciu', !listA.some(n => /AUDIT test Brezno/.test(n.title || '')), listA.slice(0, 3));

  console.log('\n═══ VÝSLEDOK: ' + PASS + ' PASS, ' + FAIL + ' FAIL ═══');
  if (FAIL) { FAILS.forEach(f => console.log('  FAIL: ' + f.name)); process.exit(1); }
})().catch(e => { console.error('CHYBA:', e); process.exit(1); });
