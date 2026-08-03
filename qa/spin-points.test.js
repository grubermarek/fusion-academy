/**
 * E2E test: body z kolesa šťastia sa počítajú vo VŠETKÝCH pohľadoch —
 * /api/spin výsledok → „Tvoje body" (spotlight myMonth), rebríček (topMonth),
 * rozpis bodov (monthlyPointsFor cez dashboard) aj admin points-summary.
 * Beží proti izolovanej inštancii (čerstvá DATA_DIR).
 */
const BASE = 'http://localhost:' + (process.env.QA_PORT || 3999);
let PASS = 0, FAIL = 0; const FAILS = [];
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; FAILS.push({ name, detail }); console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail) : '')); }
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
  console.log('\n═══ SPIN POINTS AUDIT ═══');
  const al = await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });
  ok('admin login', al.status === 200);
  const uniq = Date.now().toString(36);
  const rA = await post('A', '/api/register', { name: 'AUDIT Spin A', email: 'audit-spin-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
  ok('register klientka', rA.status === 200);

  // status pred točením
  const st0 = (await g('A', '/api/spin/status')).data;
  ok('can_spin pred točením', st0 && st0.ok && st0.can_spin === true, st0);

  // točenie (reálne, nie test režim)
  const sp = await post('A', '/api/spin', {});
  ok('spin OK', sp.status === 200 && sp.data.ok, sp.data);
  const prize = sp.data.prize || {};
  const wonPts = +prize.points || 0;
  console.log('    → výhra: ' + prize.label + ' (' + wonPts + ' b), streak ' + sp.data.streak);

  // druhé točenie v ten istý deň musí byť zamietnuté
  const sp2 = await post('A', '/api/spin', {});
  ok('druhé točenie v ten istý deň zamietnuté', sp2.status === 400, sp2.data);

  // 1) „Tvoje body" + rebríček v spotlight
  const spot = (await g('A', '/api/client/spotlight')).data || {};
  const my = spot.myMonth || {};
  const spinItem = (my.breakdown || []).find(i => /Denné odmeny/.test(i.label || ''));
  if (wonPts > 0) {
    ok('spotlight myMonth.points obsahuje výhru', my.points >= wonPts, my);
    ok('breakdown má riadok 🎡 Denné odmeny = výhra', spinItem && spinItem.points === wonPts, spinItem);
    const inTop = (spot.topMonth || []).find(w => w.name === 'AUDIT Spin A');
    ok('klientka je v topMonth rebríčku s bodmi', inTop && inTop.points >= wonPts, spot.topMonth);
  } else {
    // vyhrala online hodinu / tanitu — bodový riadok má 0, ale spin sa počíta ako 1 denná odmena
    ok('breakdown má riadok Denné odmeny (count 1, 0 b)', spinItem && spinItem.count === 1 && spinItem.points === 0, spinItem);
    if (prize.key === 'online1') {
      const me = (await g('A', '/api/me')).data || {};
      ok('online pass pripísaný', (me.online_passes || me.user && me.user.online_passes || 0) >= 1, me);
    }
  }

  // 2) rozpis bodov na profile (monthlyPointsFor cez /api/profile/:id)
  const meA = (await g('A', '/api/me')).data || {};
  const myId = meA.id || meA._id || (meA.user && (meA.user.id || meA.user._id));
  const prof = (await g('A', '/api/profile/' + myId)).data || {};
  const mp = prof.points || null; // profil vracia monthlyPointsFor ako `points`
  ok('profil vracia monthPoints', !!mp, Object.keys(prof));
  if (mp) {
    const it = (mp.items || []).find(i => /Denné odmeny/.test(i.label || ''));
    ok('profil monthPoints má Denné odmeny = výhra', it && it.points === wonPts, it);
    ok('spotlight a profil sa zhodujú', my.points === mp.total, { spotlight: my.points, profil: mp.total });
  }

  // 3) admin points-summary
  const month = new Date().toISOString().slice(0, 7);
  const sum = (await g('admin', '/api/admin/points-summary?from=' + month + '-01&to=' + month + '-31')).data || {};
  const row = (sum.rows || []).find(r => r.name === 'AUDIT Spin A');
  if (wonPts > 0) ok('admin points-summary obsahuje výhru', row && row.total >= wonPts, row);
  else ok('admin points-summary konzistentný (0 b výhra)', !row || row.total >= 0, row);

  // 4) Body za aktívne členstvo podľa úrovne: Bronze 10 / Silver 20 / Gold 40
  console.log('\n[členstvá]');
  const mkUser = async (jar, name) => {
    await post(jar, '/api/register', { name, email: jar.toLowerCase() + '-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
    return ((await g(jar, '/api/me')).data || {}).id;
  };
  const expect = { B: ['bronze', 10], S: ['silver', 20], G: ['gold', 40] };
  for (const [jar, [plan, pts]] of Object.entries(expect)) {
    const uid = await mkUser(jar, 'AUDIT Mem ' + plan);
    const gr = await post('admin', '/api/admin/users/' + uid + '/grant-membership', { plan_id: plan, gift: true });
    ok('grant ' + plan, gr.status === 200, gr.data);
    const spotX = (await g(jar, '/api/client/spotlight')).data || {};
    const memItem = ((spotX.myMonth || {}).breakdown || []).find(i => /Aktívne členstvo/.test(i.label || ''));
    ok(plan + ' = ' + pts + ' b v rebríčku', memItem && memItem.points === pts, memItem);
    const profX = (await g(jar, '/api/profile/' + uid)).data || {};
    const memItem2 = ((profX.points || {}).items || []).find(i => /Aktívne členstvo/.test(i.label || ''));
    ok(plan + ' = ' + pts + ' b na profile', memItem2 && memItem2.points === pts, memItem2);
  }
  // admin points-summary konzistentný s tiermi
  const sum2 = (await g('admin', '/api/admin/points-summary?from=' + month + '-01&to=' + month + '-31')).data || {};
  for (const [, [plan, pts]] of Object.entries(expect)) {
    const r = (sum2.rows || []).find(x => x.name === 'AUDIT Mem ' + plan);
    const it = r && (r.items || []).find(i => /Aktívne členstvo/.test(i.label || ''));
    ok('admin summary: ' + plan + ' = ' + pts + ' b', it && it.points === pts, it || r);
  }

  // Cleanup: zmaž testovací účet + záznamy (izolovaný sandbox, ale pre poriadok)
  console.log('\n═══ VÝSLEDOK: ' + PASS + ' PASS, ' + FAIL + ' FAIL ═══');
  if (FAIL) { FAILS.forEach(f => console.log('  FAIL: ' + f.name)); process.exit(1); }
})().catch(e => { console.error('CHYBA:', e); process.exit(1); });
