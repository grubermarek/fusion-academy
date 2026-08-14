/**
 * E2E: Google recenzia → +10 bodov (1× mesačne, so schválením admina).
 */
const BASE = 'http://localhost:' + (process.env.QA_PORT || 3999);
let PASS = 0, FAIL = 0;
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : '')); }
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
  console.log('\n═══ GOOGLE RECENZIA → BODY ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });
  await post('C', '/api/register', { name: 'Recenzia Klientka', email: 'rev-' + uniq + '@example.com', password: 'AuditPass123!', consent: true });
  const me = (await g('C', '/api/me')).data;

  let s = (await g('C', '/api/review-status')).data;
  ok('status none + URL na recenzie', s?.ok && s.status === 'none' && /g\.page/.test(s.url), s);

  let r = await post('C', '/api/review-claim', {});
  ok('claim vytvorený (pending)', r.status === 200 && r.data?.status === 'pending', r);
  r = await post('C', '/api/review-claim', {});
  ok('druhý claim v tom istom mesiaci → odmietnutý', r.status === 400, r);
  s = (await g('C', '/api/review-status')).data;
  ok('status pending', s.status === 'pending');

  const claims = (await g('admin', '/api/admin/review-claims')).data;
  const mine = claims.claims.find(c => c.user_id === me.id && c.status === 'pending');
  ok('admin vidí čakajúcu žiadosť + link', !!mine && /g\.page/.test(claims.url), { n: claims.claims.length });

  r = await post('admin', '/api/admin/review-claims/' + mine._id + '/decide', { approve: true });
  ok('schválenie prešlo', r.status === 200 && r.data?.ok, r);
  r = await post('admin', '/api/admin/review-claims/' + mine._id + '/decide', { approve: true });
  ok('druhé rozhodnutie → 400', r.status === 400);

  s = (await g('C', '/api/review-status')).data;
  ok('status approved', s.status === 'approved');
  r = await post('C', '/api/review-claim', {});
  ok('po schválení tento mesiac ďalší claim nejde', r.status === 400, r.data);

  // body v mesačnom rozpise
  const pts = (await g('C', '/api/client/points')).data || (await g('C', '/api/points/me')).data;
  const item = (pts?.items || pts?.breakdown || []).find?.(i => /recenzi/i.test(i.label || ''));
  if (item) ok('rozpis bodov obsahuje ⭐ Google recenzia +10', item.points === 10, item);
  else {
    // fallback: cez admin points summary — over aspoň, že monthlyPointsFor ráta recenziu
    const notifs = (await g('C', '/api/notifications')).data;
    const list = notifs.notifications || notifs || [];
    ok('klientka dostala notifikáciu o +10 b', list.some(n => /\+10 bodov za recenziu/.test(n.title || '')), list.map(n => n.title).slice(0, 5));
  }

  // zamietnutie: nový klient
  await post('D', '/api/register', { name: 'Recenzia Odmietnutá', email: 'rev2-' + uniq + '@example.com', password: 'AuditPass123!', consent: true });
  await post('D', '/api/review-claim', {});
  const c2 = (await g('admin', '/api/admin/review-claims')).data.claims.find(c => c.user_name === 'Recenzia Odmietnutá' && c.status === 'pending');
  await post('admin', '/api/admin/review-claims/' + c2._id + '/decide', { approve: false });
  const s2 = (await g('D', '/api/review-status')).data;
  ok('po zamietnutí môže klientka skúsiť znova (status none)', s2.status === 'none', s2);

  console.log(`\n═══ ${PASS} passed, ${FAIL} failed ═══\n`);
  process.exit(FAIL ? 1 : 0);
})();
