/**
 * E2E: 1) klientka vidí svoju súkromnú rezerváciu a vie ju zrušiť/presunúť
 *      2) admin predá vstupenku (masterclass + párty) priamo z profilu klientky
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

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ SÚKROMNÉ REZERVÁCIE KLIENTKY + PREDAJ VSTUPENKY Z PROFILU ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  await post('T', '/api/register', { name: 'Nela Trenerova', email: `qa.nela.${uniq}@test-fa-qa.local`, password: 'AuditPass123!', consent: true });
  const trId = (await g('T', '/api/me')).data.id;
  await put('admin', `/api/admin/users/${trId}/role`, { user_type: 'trainer' });
  await put('admin', `/api/admin/private/trainer/${trId}`, { enabled: true, rate: 50, split: 70 });
  await post('T', '/api/login', { email: `qa.nela.${uniq}@test-fa-qa.local`, password: 'AuditPass123!' });

  const clEmail = `qa.michaela.${uniq}@test-fa-qa.local`;
  await post('C', '/api/register', { name: 'Michaela Duricova', email: clEmail, password: 'AuditPass123!', consent: true });
  const clId = (await g('C', '/api/me')).data.id;

  // ── 1) Rezervácia → klientka ju vidí → presunie na iný termín ──────────────
  const d3 = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const d5 = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  await post('T', '/api/trainer/private-slots', { date: d3, time_start: '17:00', duration_min: 60, city: 'Detva', repeat_weeks: 1 });
  await post('T', '/api/trainer/private-slots', { date: d5, time_start: '18:00', duration_min: 60, city: 'Detva', repeat_weeks: 1 });
  const slots = (await g('C', `/api/private/slots?trainer_id=${trId}`)).data.slots;
  ok('klientka vidí 2 voľné termíny', slots.length === 2, slots);

  let r = await post('C', '/api/private/book', { slot_id: slots[0].id, pay: 'onsite' });
  ok('rezervácia prešla', r.status === 200 && r.data?.ok, r.data);

  let my = (await g('C', '/api/private/my')).data;
  const mine = (my?.bookings || []).filter(b => b.status === 'booked');
  ok('klientka vidí svoju rezerváciu v /api/private/my', mine.length === 1, my?.bookings);
  ok('rezervácia nesie všetko na vykreslenie', !!(mine[0].date && mine[0].time_start && mine[0].trainer_name && mine[0].trainer_id && mine[0].price != null), mine[0]);

  // presun = zrušenie (>24 h vopred, bezplatne) + nová rezervácia
  r = await post('C', '/api/private/cancel', { booking_id: mine[0].id });
  ok('zrušenie >24 h vopred prešlo a nie je spoplatnené', r.status === 200 && r.data?.ok && !r.data?.late, r.data);

  const free = (await g('C', `/api/private/slots?trainer_id=${trId}`)).data.slots;
  ok('uvoľnený termín sa vrátil medzi voľné', free.length === 2, free.map(s => s.date + ' ' + s.time_start));

  const newSlot = free.find(s => s.date === d5);
  r = await post('C', '/api/private/book', { slot_id: newSlot.id, pay: 'onsite' });
  ok('klientka si rezervovala nový termín', r.status === 200 && r.data?.ok, r.data);
  my = (await g('C', '/api/private/my')).data;
  const act = (my?.bookings || []).filter(b => b.status === 'booked');
  ok('má práve jednu aktívnu rezerváciu (nie dve)', act.length === 1 && act[0].date === d5, my?.bookings);

  // cudzí človek nesmie zrušiť moju rezerváciu
  await post('X', '/api/register', { name: 'Cudzia Osoba', email: `qa.x.${uniq}@test-fa-qa.local`, password: 'AuditPass123!', consent: true });
  r = await post('X', '/api/private/cancel', { booking_id: act[0].id });
  ok('cudzí účet nezruší moju hodinu', r.status >= 400, r.data);

  // ── 2) Predaj vstupenky z profilu klientky ─────────────────────────────────
  const evs = (await g('admin', '/api/admin/events')).data;
  const latin = (evs?.events || []).find(e => /latin/i.test(e.slug));
  ok('event Latin Tropical existuje a je aktívny', !!latin && latin.active, evs?.events);

  const ev = (await g('admin', '/api/events/' + latin.slug)).data;
  const full = (ev?.types || []).find(t => t.key === 'full');
  const party = (ev?.types || []).find(t => t.key === 'party');
  ok('event má masterclass aj párty vstupenku', !!full && !!party, ev?.types?.map(t => t.key));

  const countTickets = d => (d?.events || []).reduce((s, e) => s + (e.tickets || []).length, 0);
  const beforeN = countTickets((await g('C', '/api/my/tickets')).data);

  r = await post('admin', `/api/admin/events/${latin.slug}/onsite`, {
    items: [{ type: 'full', qty: 1, price: full.presale }, { type: 'party', qty: 1, price: party.presale }],
    member: false, method: 'cash', name: 'Michaela Duricova', email: clEmail, phone: ''
  });
  ok('predaj masterclass + párty naraz prešiel', r.status === 200 && r.data?.ok, r.data);
  ok('vznikli 2 vstupenky', (r.data?.tickets || []).length === 2, r.data?.tickets);
  ok('suma = súčet oboch lístkov', r.data?.total === +(full.presale + party.presale).toFixed(2), { total: r.data?.total, full: full.presale, party: party.presale });
  ok('vstupenka je napárovaná na jej účet', r.data?.linked === true, r.data);

  const after = (await g('C', '/api/my/tickets')).data;
  ok('klientka vidí vstupenky v appke', countTickets(after) === beforeN + 2, { pred: beforeN, po: countTickets(after) });

  // to isté, čo uvidí admin na profile klientky (odtiaľ sa predávalo)
  const crm = (await g('admin', '/api/admin/crm/client/' + clId)).data;
  const evPay = (crm?.payments || []).find(t => /event_ticket/.test(t.type || '') || /LATIN/i.test(t.note || ''));
  ok('predaj je vidieť v platbách na profile klientky', !!evPay, (crm?.payments || []).slice(0, 3));
  if (evPay) ok('platba má správnu sumu aj hotovosť', +evPay.amount === r.data.total && /hotovos/i.test(evPay.payment_method || evPay.method || ''), evPay);

  console.log(`\n─────────── ${PASS} OK · ${FAIL} FAIL ───────────\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
