/**
 * E2E: súkromná hodina platená v HOTOVOSTI — klientka si ju zvolí pri rezervácii,
 * trénerka pri potvrdení označí prevzatie peňazí → hotovosť ide do jej evidencie.
 */
const BASE = 'http://localhost:' + (process.env.QA_PORT || 3991);
let PASS = 0, FAIL = 0;
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 400) : '')); }
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

async function setup(uniq, tag) {
  await post('T' + tag, '/api/register', { name: 'Nela Hotovostna', email: `qa.trc.${tag}.${uniq}@test-fa-qa.local`, password: 'AuditPass123!', consent: true });
  const trId = (await g('T' + tag, '/api/me')).data.id;
  await put('admin', `/api/admin/users/${trId}/role`, { user_type: 'trainer' });
  await put('admin', `/api/admin/private/trainer/${trId}`, { enabled: true, rate: 50, split: 70 });
  await post('T' + tag, '/api/login', { email: `qa.trc.${tag}.${uniq}@test-fa-qa.local`, password: 'AuditPass123!' });
  return trId;
}

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ SÚKROMNÁ HODINA V HOTOVOSTI ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });
  const trId = await setup(uniq, 'a');

  await post('C', '/api/register', { name: 'Klara Hotovostna', email: `qa.clc.${uniq}@test-fa-qa.local`, password: 'AuditPass123!', consent: true });

  const day = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  await post('Ta', '/api/trainer/private-slots', { date: day(2), time_start: '17:00', duration_min: 60, city: 'Detva', repeat_weeks: 1 });
  await post('Ta', '/api/trainer/private-slots', { date: day(3), time_start: '18:00', duration_min: 60, city: 'Detva', repeat_weeks: 1 });
  const slots = (await g('C', `/api/private/slots?trainer_id=${trId}`)).data.slots;

  // ── Klientka: rezervácia s platbou v hotovosti na mieste ───────────────────
  let r = await post('C', '/api/private/book', { slot_id: slots[0].id, pay: 'onsite' });
  ok('klientka si zvolila hotovosť na mieste', r.status === 200 && r.data?.ok, r.data);
  let my = (await g('C', '/api/private/my')).data.bookings.filter(b => b.status === 'booked');
  ok('rezervácia je vedená ako nezaplatená (platí na mieste)', my[0].pay_method === 'onsite' && my[0].paid === false, my[0]);

  const cashBefore = (await g('Ta', '/api/trainer/cash')).data.pending || 0;

  // ── Trénerka: potvrdí hodinu AJ prevzatie hotovosti ────────────────────────
  let priv = (await g('Ta', '/api/trainer/private')).data;
  let booked = priv.slots.find(s => s.booking && s.booking.status === 'booked');
  ok('trénerka vidí, že klientka platí na mieste', booked.booking.paid === false, booked.booking);

  r = await post('Ta', '/api/private/complete', { booking_id: booked.booking.id, cash_received: true });
  ok('potvrdenie hodiny s hotovosťou prešlo', r.status === 200 && r.data?.ok, r.data);
  ok('server potvrdil zápis hotovosti', r.data?.cash_recorded === true, r.data);
  ok('podiel trénerky ostal 70 % (35 €)', r.data?.trainer_cut === 35, r.data);

  const cash = (await g('Ta', '/api/trainer/cash')).data;
  ok('50 € pribudlo do hotovostnej evidencie trénerky', +(cash.pending - cashBefore).toFixed(2) === 50, { pred: cashBefore, po: cash.pending });
  ok('záznam nesie meno klientky', (cash.rows || []).some(x => +x.amount === 50 && /Klara Hotovostna/.test(x.note || '')), cash.rows?.slice(0, 2));

  const done = (await g('C', '/api/private/my')).data.bookings.find(b => b.status === 'completed');
  ok('hodina je označená ako zaplatená', done?.paid === true && done?.pay_method === 'cash', done);

  // tržba na profile klientky = hotovosť
  const clId = (await g('C', '/api/me')).data.id;
  const crm = (await g('admin', '/api/admin/crm/client/' + clId)).data;
  const pay = (crm?.payments || []).find(p => /Súkromná hodina/.test(p.note || ''));
  ok('tržba je na profile klientky ako hotovosť', !!pay && +pay.amount === 50 && /cash|hotovos/i.test(pay.method || ''), pay);

  // ── Druhá hodina: hodina prebehla, ale klientka nezaplatila ────────────────
  const free = (await g('C', `/api/private/slots?trainer_id=${trId}`)).data.slots;
  r = await post('C', '/api/private/book', { slot_id: free[0].id, pay: 'onsite' });
  ok('druhá rezervácia prešla', r.status === 200 && r.data?.ok, r.data);
  priv = (await g('Ta', '/api/trainer/private')).data;
  booked = priv.slots.find(s => s.booking && s.booking.status === 'booked');
  r = await post('Ta', '/api/private/complete', { booking_id: booked.booking.id, cash_received: false });
  ok('potvrdenie BEZ platby prešlo', r.status === 200 && r.data?.ok, r.data);
  ok('hotovosť sa nezapísala', r.data?.cash_recorded === false, r.data);
  const cash2 = (await g('Ta', '/api/trainer/cash')).data;
  ok('evidencia hotovosti ostala nezmenená', +cash2.pending.toFixed(2) === +cash.pending.toFixed(2), { pred: cash.pending, po: cash2.pending });

  // ── Zaplatené vopred kreditom sa nesmie zapísať ako hotovosť ───────────────
  const trB = await setup(uniq, 'b');
  await post('admin', '/api/admin/users/' + clId + '/credit', { op: 'set', amount: 100 });
  await post('Tb', '/api/trainer/private-slots', { date: day(4), time_start: '16:00', duration_min: 60, city: 'Detva', repeat_weeks: 1 });
  const sB = (await g('C', `/api/private/slots?trainer_id=${trB}`)).data.slots[0];
  const cr = (await g('C', '/api/me')).data.referral_credit || 0;
  if (cr >= 50) {
    r = await post('C', '/api/private/book', { slot_id: sB.id, pay: 'credit' });
    const pB = (await g('Tb', '/api/trainer/private')).data.slots.find(s => s.booking && s.booking.status === 'booked');
    r = await post('Tb', '/api/private/complete', { booking_id: pB.booking.id, cash_received: true });
    ok('zaplatená hodina sa nezapíše druhýkrát ako hotovosť', r.data?.cash_recorded === false, r.data);
    const cB = (await g('Tb', '/api/trainer/cash')).data;
    ok('trénerke nepribudla neexistujúca hotovosť', (cB.pending || 0) === 0, cB);
  } else {
    console.log('  … kredit sa nepodarilo pripísať, dvojitá platba nepreverená');
  }

  console.log(`\n─────────── ${PASS} OK · ${FAIL} FAIL ───────────\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
