/**
 * E2E: Shop & platby — online booking neodpočítava vstupy, manuálne platby
 * (hotovosť/prevod) idú do admin fronty a potvrdením sa aktivujú, výber
 * vstupného na mieste k rezervácii, storno žiadosti vracia kredit.
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
const put = (jar, p, b) => call(jar, 'PUT', p, b);

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ SHOP & PLATBY AUDIT ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });
  const classes = (await g('admin', '/api/classes')).data || [];
  const onlineCls = classes.find(c => c.category === 'Online');
  const normalCls = classes.find(c => c.category !== 'Online' && c.active !== false);
  ok('nájdené hodiny (online + bežná)', !!onlineCls && !!normalCls, { o: !!onlineCls, n: !!normalCls });

  // ── A: online rezervácia nesmie zožrať vstup z permanentky ──
  await post('A', '/api/register', { name: 'SHOP Monika', email: 'shop-a-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });
  const meA = (await g('A', '/api/me')).data;
  await put('admin', '/api/admin/users/' + meA.id + '/awards', { single_entries: 3, free_credits: 0 });
  // spotrebuj 1. hodinu zdarma na bežnej hodine
  await post('A', '/api/bookings', { class_id: normalCls._id });
  const bOnline = await post('A', '/api/bookings', { class_id: onlineCls._id });
  ok('online rezervácia prešla', bOnline.status === 200, bOnline);
  const meA2 = (await g('A', '/api/me')).data;
  ok('vstupy z permanentky NEubudli (3)', meA2.single_entries === 3, meA2.single_entries);

  // ── B: manuálny nákup permanentky (vstup1) → admin fronta → potvrdenie hotovosť ──
  await post('B', '/api/register', { name: 'SHOP Lenka', email: 'shop-b-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });
  const buy1 = await post('B', '/api/membership/buy', { plan_id: 'vstup1', payment_method: 'manual' });
  ok('žiadosť o vstup odoslaná', buy1.status === 200 && buy1.data.payment_id, buy1.data);
  const notifB1 = ((await g('B', '/api/notifications')).data) || [];
  ok('klient dostal info čo ďalej', notifB1.some(n => /Žiadosť prijatá/.test(n.title || '')), notifB1.slice(0, 2));
  const notifAdm = ((await g('admin', '/api/notifications')).data) || [];
  ok('admin dostal notifikáciu o čakajúcej platbe', notifAdm.some(n => /Čaká platba/.test(n.title || '')), notifAdm.slice(0, 2));
  const q1 = (await g('admin', '/api/admin/manual-payments')).data || {};
  const payB = (q1.payments || []).find(p => p.user === 'SHOP Lenka');
  ok('platba je v admin fronte', !!payB && payB.amount === 10, q1.payments);
  const conf = await post('admin', '/api/admin/manual-payments/' + payB.id + '/confirm', { method: 'cash' });
  ok('potvrdenie prešlo', conf.status === 200, conf);
  const confDup = await post('admin', '/api/admin/manual-payments/' + payB.id + '/confirm', { method: 'cash' });
  ok('dvojité potvrdenie odmietnuté', confDup.status === 400, confDup.status);
  const meB = (await g('B', '/api/me')).data;
  ok('vstup pripísaný (1)', meB.single_entries === 1, meB.single_entries);
  const notifB2 = ((await g('B', '/api/notifications')).data) || [];
  ok('klient dostal potvrdenie aktivácie', notifB2.some(n => /Permanentka aktivovaná/.test(n.title || '')), notifB2.slice(0, 3));

  // ── C: manuálny nákup členstva Bronze → potvrdenie prevodom → aktívne členstvo ──
  await post('C', '/api/register', { name: 'SHOP Bronze', email: 'shop-c-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });
  await post('C', '/api/membership/buy', { plan_id: 'bronze', payment_method: 'manual' });
  const q2 = (await g('admin', '/api/admin/manual-payments')).data || {};
  const payC = (q2.payments || []).find(p => p.user === 'SHOP Bronze');
  await post('admin', '/api/admin/manual-payments/' + payC.id + '/confirm', { method: 'transfer' });
  const memC = ((await g('C', '/api/membership')).data || {}).membership;
  ok('členstvo Bronze aktívne po potvrdení', memC && memC.plan_id === 'bronze' && memC.status === 'active', memC);

  // ── D: storno žiadosti vracia referral kredit ──
  await post('D', '/api/register', { name: 'SHOP Storno', email: 'shop-d-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });
  const meD = (await g('D', '/api/me')).data;
  await put('admin', '/api/admin/users/' + meD.id + '/awards', { referral_credit: 20 });
  await post('D', '/api/membership/buy', { plan_id: 'bronze', payment_method: 'manual', use_referral_credit: true });
  const meD2 = (await g('D', '/api/me')).data;
  ok('kredit strhnutý pri žiadosti (0)', meD2.referral_credit === 0, meD2.referral_credit);
  const q3 = (await g('admin', '/api/admin/manual-payments')).data || {};
  const payD = (q3.payments || []).find(p => p.user === 'SHOP Storno');
  await post('admin', '/api/admin/manual-payments/' + payD.id + '/cancel');
  const meD3 = (await g('D', '/api/me')).data;
  ok('kredit vrátený po storne (20)', meD3.referral_credit === 20, meD3.referral_credit);

  // ── E: pay_on_site rezervácia → admin vyberie 10 € na mieste ──
  await post('E', '/api/register', { name: 'SHOP Ivka', email: 'shop-e-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });
  await post('E', '/api/bookings', { class_id: normalCls._id }); // 1. zdarma
  const gate = await post('E', '/api/bookings', { class_id: normalCls._id, booking_date: '2030-01-07' });
  ok('bez členstva pýta platbu (402 + can_pay_on_site)', gate.status === 402 && gate.data.can_pay_on_site, gate);
  const bPos = await post('E', '/api/bookings', { class_id: normalCls._id, booking_date: '2030-01-07', pay_on_site: true });
  ok('rezervácia s platbou na mieste prešla', bPos.status === 200, bPos);
  const col = await post('admin', '/api/admin/bookings/' + bPos.data.id + '/collect', { method: 'cash', amount: 10 });
  ok('vstupné vybrané a zapísané', col.status === 200, col);
  const colDup = await post('admin', '/api/admin/bookings/' + bPos.data.id + '/collect', { method: 'cash' });
  ok('dvojitý výber odmietnutý', colDup.status === 400, colDup.status);
  const notifE = ((await g('E', '/api/notifications')).data) || [];
  ok('klient dostal potvrdenie o platbe vstupu', notifE.some(n => /Potvrdenie o platbe — vstup/.test(n.title || '')), notifE.slice(0, 3));
  const tx = (await g('admin', '/api/transactions')).data || [];
  ok('predaj vstupu v evidencii transakcií', tx.some(t => t.client_name === 'SHOP Ivka' && t.amount === 10) || tx.some(t => (t.user_name || '') === 'SHOP Ivka' && t.amount === 10), tx.slice(0, 3));

  console.log(`\n═══ VÝSLEDOK: ${PASS} ✓ / ${FAIL} ✗ ═══`);
  if (FAIL) { console.log(FAILS.map(f => f.name).join('\n')); process.exit(1); }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
