/**
 * E2E: referral výzva — jeden stupeň: 1 platiaca kamoška = súkromná hodina s Marekom.
 * Od septembra 2026 je odmena jediná a pripisuje sa ako kredit na súkromnú hodinu,
 * takže sa dá sledovať aj to, či si ju klientka naozaj vybrala.
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
  ok('obdobie výzvy a odpočet dní chodia zo servera',
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(goal0.to || '') && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(goal0.from || '')
    && typeof goal0.days_left === 'number' && goal0.ended === (new Date().toISOString().slice(0, 10) > goal0.to),
    { from: goal0.from, to: goal0.to, days_left: goal0.days_left, ended: goal0.ended });
  ok('odmena je súkromná hodina', (goal0.tiers || []).length === 1 && /súkromn/i.test(goal0.tiers[0].label), goal0.tiers);

  const reg = async (jar, n) => { await post(jar, '/api/register', { name: 'AUDIT Ref ' + n, email: 'audit-ref' + n + '-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', city: 'Zvolen', consent: true, sponsorCode: code }); return ((await g(jar, '/api/me')).data || {}).id; };
  const id1 = await reg('R1', 1);
  const goalReg = (await g('S', '/api/client/referral-goal')).data || {};
  ok('samotná registrácia sa NEráta (0/3)', goalReg.count === 0 && !goalReg.tiers[0].reached, goalReg);
  // darované členstvo sa NEráta
  await post('admin', '/api/admin/users/' + id1 + '/grant-membership', { plan_id: 'bronze', gift: true });
  const goalGift = (await g('S', '/api/client/referral-goal')).data || {};
  ok('darované členstvo sa NEráta', goalGift.count === 0, goalGift);
  // zaplatené členstvo → ráta sa
  await post('admin', '/api/admin/users/' + id1 + '/grant-membership', { plan_id: 'bronze', gift: false, payment_method: 'cash' });
  const goal1 = (await g('S', '/api/client/referral-goal')).data || {};
  ok('1 PLATIACA → súkromná hodina odomknutá', goal1.count === 1 && goal1.tiers[0].reached, goal1);
  const notif1 = ((await g('S', '/api/notifications')).data);
  const list1 = Array.isArray(notif1) ? notif1 : (notif1.notifications || []);
  ok('sponzorka dostala notifikáciu o hodine', list1.some(n => /súkromn/i.test((n.title || '') + (n.body || ''))), list1.slice(0, 3).map(n => n.title));
  const meS = (await g('S', '/api/me')).data || {};
  ok('hodina sa jej rovno PRIPÍSALA ako kredit', (meS.free_private_lesson_credits || 0) === 1, 'kredit=' + meS.free_private_lesson_credits);

  const id2 = await reg('R2', 2); const id3 = await reg('R3', 3);
  // R2 platí permanentku (vstupy), R3 členstvo cez trénerský zápis
  await post('admin', '/api/admin/users/' + id2 + '/grant-membership', { plan_id: 'permanentka10', gift: false, payment_method: 'cash' });
  await post('admin', '/api/attendance/record-membership', { user_id: id3, plan_id: 'silver', amount: 49, payment_method: 'card' });
  const goal3 = (await g('S', '/api/client/referral-goal')).data || {};
  ok('3 platiace (členstvo+permanentka+tréner zápis) sa všetky rátajú', goal3.count === 3 && goal3.tiers.every(t => t.reached), goal3);
  const meS3 = (await g('S', '/api/me')).data || {};
  ok('kredit sa nezdvojí — odmena je jedna', (meS3.free_private_lesson_credits || 0) === 1, 'kredit=' + meS3.free_private_lesson_credits);
  const notif3 = ((await g('S', '/api/notifications')).data);
  const list3 = Array.isArray(notif3) ? notif3 : (notif3.notifications || []);
  const goalNotifs = list3.filter(n => n.type === 'referral_goal');
  ok('práve jedna notifikácia o odmene (žiadne duplicity)', goalNotifs.length === 1, goalNotifs.map(n => n.title));
  const notifAdm = ((await g('admin', '/api/notifications')).data);
  const listAdm = Array.isArray(notifAdm) ? notifAdm : (notifAdm.notifications || []);
  ok('admin dostal info, komu odovzdať odmenu', listAdm.some(n => n.type === 'referral_goal' && /súkromn/i.test(n.body || '')), listAdm.filter(n => n.type === 'referral_goal').map(n => n.body));
  const rep = (await g('admin', '/api/admin/referral-goal-report')).data || {};
  const riadok = (rep.rows || []).find(r => /Sponzork|S /i.test(r.sponsor) || r.paying > 0);
  ok('report v admine pozná stav odmeny', !!(riadok && riadok.prize), JSON.stringify(riadok && riadok.prize));
  ok('a hlási ju ako pripísanú, čakajúcu na rezerváciu', riadok && riadok.prize.credited && riadok.prize.used === 0, JSON.stringify(riadok && riadok.prize));
  ok('súčty rozlišujú zaslúžené, čakajúce a vyčerpané', rep.totals && rep.totals.caka >= 1 && rep.totals.vycerpane === 0, JSON.stringify(rep.totals));

  console.log('\n═══ VÝSLEDOK: ' + PASS + ' PASS, ' + FAIL + ' FAIL ═══');
  if (FAIL) { FAILS.forEach(f => console.log('  FAIL: ' + f.name)); process.exit(1); }
})().catch(e => { console.error('CHYBA:', e); process.exit(1); });
