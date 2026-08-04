/**
 * E2E: referral cieľ (1=taška, 2=zľava event, 3=masterclass) — progress, odomykanie
 * odmien, notifikácie sponzorke aj adminom, žiadne duplicitné odomknutie.
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
  console.log('\n═══ REFERRAL GOAL AUDIT ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });
  await post('S', '/api/register', { name: 'AUDIT Sponzorka', email: 'audit-spon-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
  const ref = (await g('S', '/api/client/referral')).data || {};
  const code = ref.referral_code || (String(ref.ref_link || '').split('ref=')[1] || '');
  ok('mám referral kód', !!code, ref);

  const goal0 = (await g('S', '/api/client/referral-goal')).data || {};
  ok('goal 0/3, žiadny tier', goal0.ok && goal0.count === 0 && goal0.tiers.every(t => !t.reached), goal0);
  ok('deadline 31.8. + days_left + ended flag', goal0.to === '2026-08-31' && typeof goal0.days_left === 'number' && goal0.ended === (new Date().toISOString().slice(0, 10) > '2026-08-31'), { to: goal0.to, days_left: goal0.days_left, ended: goal0.ended });

  const reg = async (jar, n) => post(jar, '/api/register', { name: 'AUDIT Ref ' + n, email: 'audit-ref' + n + '-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', city: 'Zvolen', consent: true, sponsorCode: code });
  await reg('R1', 1);
  const goal1 = (await g('S', '/api/client/referral-goal')).data || {};
  ok('1 registrácia → taška odomknutá', goal1.count === 1 && goal1.tiers[0].reached && !goal1.tiers[1].reached, goal1);
  const notif1 = ((await g('S', '/api/notifications')).data);
  const list1 = Array.isArray(notif1) ? notif1 : (notif1.notifications || []);
  ok('sponzorka dostala notifikáciu o taške', list1.some(n => /taška/i.test((n.title || '') + (n.body || ''))), list1.slice(0, 3).map(n => n.title));

  await reg('R2', 2); await reg('R3', 3);
  const goal3 = (await g('S', '/api/client/referral-goal')).data || {};
  ok('3 registrácie → všetky odmeny', goal3.count === 3 && goal3.tiers.every(t => t.reached), goal3);
  const notif3 = ((await g('S', '/api/notifications')).data);
  const list3 = Array.isArray(notif3) ? notif3 : (notif3.notifications || []);
  const goalNotifs = list3.filter(n => n.type === 'referral_goal');
  ok('presne 3 tier notifikácie (žiadne duplicity)', goalNotifs.length === 3, goalNotifs.map(n => n.title));
  const notifAdm = ((await g('admin', '/api/notifications')).data);
  const listAdm = Array.isArray(notifAdm) ? notifAdm : (notifAdm.notifications || []);
  ok('admin dostal info o odovzdaní odmeny', listAdm.some(n => n.type === 'referral_goal' && /Masterclass/i.test(n.body || '')), listAdm.filter(n => n.type === 'referral_goal').map(n => n.body));

  console.log('\n═══ VÝSLEDOK: ' + PASS + ' PASS, ' + FAIL + ' FAIL ═══');
  if (FAIL) { FAILS.forEach(f => console.log('  FAIL: ' + f.name)); process.exit(1); }
})().catch(e => { console.error('CHYBA:', e); process.exit(1); });
