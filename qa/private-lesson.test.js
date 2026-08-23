/**
 * E2E: súkromné hodiny — 20 bodov do súťaže Klientka mesiaca, história,
 * a ručný zápis odučenej hodiny s neregistrovaným človekom (svadobný tanec).
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
const del = (jar, p) => call(jar, 'DELETE', p);
const today = () => new Date().toISOString().slice(0, 10);

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ SÚKROMNÉ HODINY: BODY, HISTÓRIA, RUČNÝ ZÁPIS ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // tréner + klientka
  const trReg = await post('T', '/api/register', { name: 'Kristina Trenerova', email: `qa.tr.${uniq}@test-fa-qa.local`, password: 'AuditPass123!', consent: true });
  const trId = (await g('T', '/api/me')).data.id;
  await put('admin', `/api/admin/users/${trId}/role`, { user_type: 'trainer' });
  await put('admin', `/api/admin/private/trainer/${trId}`, { enabled: true, rate: 50, split: 70 });
  await post('T', '/api/login', { email: `qa.tr.${uniq}@test-fa-qa.local`, password: 'AuditPass123!' });

  await post('C', '/api/register', { name: 'Zuzana Testovacia', email: `qa.cl.${uniq}@test-fa-qa.local`, password: 'AuditPass123!', consent: true });
  const clId = (await g('C', '/api/me')).data.id;

  // ── 1) Rezervovaná + absolvovaná súkromná hodina ────────────────────────────
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  let r = await post('T', '/api/trainer/private-slots', { date: tomorrow, time_start: '17:00', duration_min: 60, city: 'Detva', repeat_weeks: 1 });
  ok('tréner vytvoril voľný termín', r.status === 200 && r.data?.created >= 1, r.data);
  const slots = (await g('C', `/api/private/slots?trainer_id=${trId}`)).data;
  const slot = (slots?.slots || [])[0];
  ok('klientka vidí voľný termín', !!slot, slots);

  r = await post('C', '/api/private/book', { slot_id: slot.id, pay: 'onsite' });
  ok('klientka zarezervovala hodinu', r.status === 200 && r.data?.ok, r.data);
  const bookingId = r.data?.booking_id || r.data?.id;

  const beforeVisits = (await g('C', '/api/me')).data.visit_count || 0;
  const privList = (await g('T', '/api/trainer/private')).data;
  const booked = (privList.slots || []).find(s => s.booking && s.booking.status === 'booked');
  r = await post('T', '/api/private/complete', { booking_id: booked.booking.id });
  ok('tréner potvrdil absolvovanie', r.status === 200 && r.data?.ok, r.data);
  ok('tréner dostal podiel 70 % z 50 €', r.data?.trainer_cut === 35, r.data);

  const meAfter = (await g('C', '/api/me')).data;
  ok('klientke pribudla návšteva', (meAfter.visit_count || 0) === beforeVisits + 1, { before: beforeVisits, after: meAfter.visit_count });

  // ── 2) História obsahuje súkromnú hodinu ────────────────────────────────────
  const hist = (await g('C', '/api/me/history')).data;
  const hp = (hist?.visits || []).find(v => v.private);
  ok('súkromná hodina je v Mojej histórii', !!hp && hp.name === 'Súkromná hodina', hist?.visits);
  ok('história sedí s počtom návštev', hist?.in_app === (meAfter.visit_count || 0), { in_app: hist?.in_app, visits: meAfter.visit_count });

  // ── 3) 20 bodov do súťaže Klientka mesiaca ──────────────────────────────────
  const m = today().slice(0, 7);
  const sum = (await g('admin', `/api/admin/points-summary?from=${m}-01&to=${m}-31`)).data;
  const row = (sum?.rows || []).find(x => x.id === clId);
  const privItem = (row?.items || []).find(i => /súkromn/i.test(i.label || ''));
  ok('rozpis víťazky obsahuje súkromné hodiny', !!privItem, row);
  ok('súkromná hodina = 20 bodov', privItem?.points === 20 && privItem?.count === 1, privItem);
  const privSum = (sum?.rows || []).reduce((s, x) => s + (x.private_hours || 0), 0);
  ok('catTotals.private = 20 × počet súkromných hodín', (sum?.catTotals || {}).private === privSum * 20, { cat: sum?.catTotals?.private, hodin: privSum });
  ok('row.private_hours = 1', row?.private_hours === 1, row);

  // klientský rozpis („Tvoje body") musí sedieť s admin súhrnom
  const prof = (await g('C', '/api/profile/' + clId)).data;
  const mineItem = ((prof?.points?.items) || []).find(i => /súkromn/i.test(i.label || ''));
  ok('klientka vidí na profile rovnakých 20 bodov', mineItem?.points === 20 && mineItem?.count === 1, prof?.points);
  ok('súčet bodov na profile = súčet v admin súhrne', prof?.points?.total === row?.total, { profil: prof?.points?.total, admin: row?.total });

  // ── 4) Ručný zápis — neregistrovaný (svadobný tanec) ────────────────────────
  r = await post('T', '/api/trainer/private-manual', { name: '', price: 60 });
  ok('bez mena → 400', r.status === 400, r.data);
  r = await post('T', '/api/trainer/private-manual', { name: 'Jana a Peter', date: tomorrow, price: 60 });
  ok('budúci dátum → 400', r.status === 400, r.data);
  r = await post('T', '/api/trainer/private-manual', { name: 'Jana a Peter', price: 5000 });
  ok('nezmyselná cena → 400', r.status === 400, r.data);

  r = await post('T', '/api/trainer/private-manual', { name: 'Jana a Peter (svadba)', phone: '0904315151', date: today(), time_start: '18:00', duration_min: 60, price: 60, pay_method: 'cash', city: 'Zvolen', note: '1. tréning na svadbu' });
  ok('ručný zápis prešiel', r.status === 200 && r.data?.ok, r.data);
  ok('podiel trénera 70 % zo 60 € = 42 €', r.data?.trainer_cut === 42, r.data);
  const manualId = r.data?.id;

  const priv2 = (await g('T', '/api/trainer/private')).data;
  const guest = (priv2.guests || []).find(x => x.id === manualId);
  ok('zápis je v zozname hostí', !!guest && guest.name === 'Jana a Peter (svadba)', priv2.guests);
  ok('zárobok za mesiac zahŕňa ručný zápis', (priv2.month_earn || 0) >= 42, { earn: priv2.month_earn });

  const cash = (await g('T', '/api/trainer/cash')).data;
  ok('hotovosť 60 € je v evidencii trénera', (cash?.rows || []).some(x => +x.amount === 60 && /Jana a Peter/.test(x.note || '')), cash?.rows);

  const adminPriv = (await g('admin', '/api/admin/private')).data;
  const abk = (adminPriv?.bookings || []).find(b => b.id === manualId);
  ok('admin vidí zápis ako hosťa (bez účtu)', !!abk && abk.manual === true && abk.client_id === null, abk);

  // ručný zápis NESMIE ovplyvniť body/štatistiky klientok
  const sum2 = (await g('admin', `/api/admin/points-summary?from=${m}-01&to=${m}-31`)).data;
  ok('hosť bez účtu nezískal body', (sum2?.rows || []).every(x => x.name !== 'Jana a Peter (svadba)'), sum2?.rows?.map(x => x.name));
  ok('ručný zápis nezmenil body v súťaži', (sum2?.catTotals || {}).private === (sum?.catTotals || {}).private, { pred: sum?.catTotals?.private, po: sum2?.catTotals?.private });

  // zmazanie dnešného zápisu (preklep)
  r = await del('T', '/api/trainer/private-manual/' + manualId);
  ok('dnešný zápis sa dá zmazať', r.status === 200 && r.data?.ok, r.data);
  const priv3 = (await g('T', '/api/trainer/private')).data;
  ok('po zmazaní zmizol zo zoznamu', !(priv3.guests || []).some(x => x.id === manualId), priv3.guests);
  const cash2 = (await g('T', '/api/trainer/cash')).data;
  ok('po zmazaní zmizla aj hotovosť', !(cash2?.rows || []).some(x => +x.amount === 60 && /Jana a Peter/.test(x.note || '')), cash2?.rows);

  // cudzí tréner nesmie mazať/zapisovať cez klienta
  r = await post('C', '/api/trainer/private-manual', { name: 'Hack Test', price: 10 });
  ok('klientka nemôže zapisovať hodiny (403)', r.status === 403, r.data);

  console.log(`\n─────────── ${PASS} OK · ${FAIL} FAIL ───────────\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
