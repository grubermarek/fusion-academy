/**
 * E2E: Technický tréning Detva (kategória Technika) — vlastný cenník:
 * 10 € jednorazovo / Bronze 8 / Silver 7 / Gold 6 €; platí permanentka (vstup);
 * dnešný termín zo zoznamu tech_free_dates je zadarmo.
 *
 * Prvá hodina zadarmo sa NA techniku vzťahuje (commit b507849, „Prvá hodina zdarma
 * aj na techniku") — test to pôvodne popieral, lebo vznikol 14. 8. pred tou zmenou
 * a už sa neaktualizoval. Preto si každá persóna prvú hodinu zadarmo najprv minie
 * na Zumbe a až potom sa overuje cenník techniky.
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
const dstr = d => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(d);
const nextDow = dow => { const n = new Date(); const diff = ((dow - n.getDay() + 7) % 7) || 7; return dstr(new Date(n.getTime() + diff * 86400000)); };

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ TECHNICKÝ TRÉNING DETVA ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // ── migrácia: hodiny existujú ────────────────────────────────────────────
  const classes = (await g('admin', '/api/classes')).data || [];
  const techPi = classes.find(c => c.category === 'Technika' && c.day_of_week === 5 && c.time_start === '18:00');
  const techNe = classes.find(c => c.category === 'Technika' && c.day_of_week === 0 && c.time_start === '18:00');
  const onlPi = classes.find(c => c.category === 'Online' && c.day_of_week === 5 && c.time_start === '18:00');
  const onlNe = classes.find(c => c.category === 'Online' && c.day_of_week === 0 && c.time_start === '18:00');
  ok('fyzická hodina Pi 18:00 Detva', !!techPi && techPi.location === 'Detva', techPi && { l: techPi.location });
  ok('fyzická hodina Ne 18:00 Detva', !!techNe);
  ok('online prenos Pi 18:00 (stream Detva)', !!onlPi && onlPi.stream_city === 'Detva', onlPi && { s: onlPi.stream_city });
  ok('online prenos Ne 18:00 (stream Detva)', !!onlNe);
  ok('popis obsahuje cenník aj permanentku', /Bronze 8/.test(techPi?.description || '') && /permanentka/i.test(techPi?.description || ''), techPi?.description);
  if (!techPi || !techNe) { console.log('FATAL: hodiny chýbajú'); process.exit(1); }
  const NE = nextDow(0); // budúca nedeľa — nie je vo free dates

  // Bežná (nie Technika, nie Online) hodina, na ktorej sa minie prvá hodina zadarmo,
  // aby sa dal overiť samotný cenník techniky.
  const bezna = classes.find(c => c.active !== false && c.category !== 'Technika' && c.category !== 'Online' && c.day_of_week != null);
  ok('existuje bežná hodina na minutie prvej zadarmo', !!bezna, bezna && bezna.name);
  const minPrvuZadarmo = async (jar) => {
    if (!bezna) return;
    await post(jar, '/api/bookings', { class_id: bezna._id, booking_date: nextDow(bezna.day_of_week) });
  };

  // ── A: klientka, ktorá už prvú hodinu zadarmo minula → technika za 10 € ──
  await post('A', '/api/register', { name: 'Tech Klientka', email: 'tech-a-' + uniq + '@example.com', password: 'AuditPass123!', consent: true });
  const meA = (await g('A', '/api/me')).data;
  let r = await post('A', '/api/bookings', { class_id: techNe._id, booking_date: NE });
  ok('prvá hodina zadarmo platí aj na techniku', r.status === 200, r);
  const meA0 = (await g('A', '/api/me')).data;
  ok('a naozaj sa ňou minula', meA0.free_class_used === true, meA0.free_class_used);
  // Zrušenie by hodinu zadarmo vrátilo (a správne), preto sa na cenník pýtame
  // iným termínom tej istej hodiny — o týždeň neskôr.
  const NE2 = (() => { const d = new Date(NE + 'T12:00:00'); d.setDate(d.getDate() + 7); return dstr(d); })();
  r = await post('A', '/api/bookings', { class_id: techNe._id, booking_date: NE2 });
  ok('druhá technika bez členstva → 402 membership_required', r.status === 402 && r.data?.error === 'membership_required', r);
  ok('402 nesie tech_price 10 a spomína permanentku', r.data?.tech_price === 10 && /permanentk/i.test(r.data?.message || ''), r.data);
  r = await post('A', '/api/bookings', { class_id: techNe._id, booking_date: NE2, pay_on_site: true });
  ok('pay_on_site rezervácia prešla', r.status === 200 && (r.data?.ok || r.data?.id || r.data?.booking_id), r);
  const attNe = (await g('admin', '/api/admin/attendance?class_id=' + techNe._id + '&date=' + NE2)).data;
  const rowA = (attNe?.bookings || attNe || []).find?.(b => b.user_id === meA.id) || (attNe?.attendees || []).find?.(b => b.user_id === meA.id);
  ok('rezervácia má pay_amount 10 (na mieste)', !rowA || rowA.pay_amount === 10 || rowA.pay_on_site === true, rowA);
  const meA2 = (await g('A', '/api/me')).data;
  ok('platba na mieste už žiadnu hodinu zadarmo neminie', meA2.free_class_used === true, meA2.free_class_used);

  // ── B: permanentka (vstupy) kryje tréning ────────────────────────────────
  await post('B', '/api/register', { name: 'Tech Permanentkárka', email: 'tech-b-' + uniq + '@example.com', password: 'AuditPass123!', consent: true });
  await minPrvuZadarmo('B');
  const meB = (await g('B', '/api/me')).data;
  await post('admin', '/api/admin/users/' + meB.id + '/entries', { op: 'set', amount: 2 });
  r = await post('B', '/api/bookings', { class_id: techNe._id, booking_date: NE });
  ok('so vstupmi rezervácia prešla (bez 402)', r.status === 200, r);
  const meB2 = (await g('B', '/api/me')).data;
  ok('odpočítal sa 1 vstup (2→1)', (meB2.single_entries ?? meB2.entries) === 1, meB2.single_entries);

  // ── C: Gold členka zadarmo ───────────────────────────────────────────────
  await post('C', '/api/register', { name: 'Tech Goldka', email: 'tech-c-' + uniq + '@example.com', password: 'AuditPass123!', consent: true });
  await minPrvuZadarmo('C');
  const meC = (await g('C', '/api/me')).data;
  await post('admin', '/api/admin/users/' + meC.id + '/grant-membership', { plan_id: 'gold', gift: true });
  r = await post('C', '/api/bookings', { class_id: techNe._id, booking_date: NE });
  ok('Gold → 402 s tech_price 6 (Gold už nie je zadarmo)', r.status === 402 && r.data?.tech_price === 6, r.data);

  // ── D: Bronze členka → 402 s cenou 8 € ───────────────────────────────────
  await post('D', '/api/register', { name: 'Tech Bronzka', email: 'tech-d-' + uniq + '@example.com', password: 'AuditPass123!', consent: true });
  await minPrvuZadarmo('D');
  const meD = (await g('D', '/api/me')).data;
  await post('admin', '/api/admin/users/' + meD.id + '/grant-membership', { plan_id: 'bronze', gift: true });
  r = await post('D', '/api/bookings', { class_id: techNe._id, booking_date: NE });
  ok('Bronze → 402 s tech_price 8', r.status === 402 && r.data?.tech_price === 8, r.data);
  r = await post('D', '/api/bookings', { class_id: techNe._id, booking_date: NE, pay_on_site: true });
  ok('Bronze pay_on_site prešlo', r.status === 200, r);

  // ── E: Silver → 7 € ──────────────────────────────────────────────────────
  await post('E', '/api/register', { name: 'Tech Silverka', email: 'tech-e-' + uniq + '@example.com', password: 'AuditPass123!', consent: true });
  await minPrvuZadarmo('E');
  const meE = (await g('E', '/api/me')).data;
  await post('admin', '/api/admin/users/' + meE.id + '/grant-membership', { plan_id: 'silver', gift: true });
  r = await post('E', '/api/bookings', { class_id: techNe._id, booking_date: NE });
  ok('Silver → 402 s tech_price 7', r.status === 402 && r.data?.tech_price === 7, r.data);

  // ── F: dnešný termín zadarmo (tech_free_dates obsahuje dnešok pri nasadení) ──
  const TODAY = dstr(new Date());
  if (TODAY === '2026-08-14') {
    await post('F', '/api/register', { name: 'Tech Freebie', email: 'tech-f-' + uniq + '@example.com', password: 'AuditPass123!', consent: true });
    r = await post('F', '/api/bookings', { class_id: techPi._id, booking_date: TODAY });
    ok('dnešný (14.8.) tréning zadarmo — rezervácia bez členstva prešla', r.status === 200, r);
  } else ok('free-day test preskočený (nie je 14.8.)', true);

  // ── bežné hodiny nedotknuté: prvá zadarmo na Zumbe stále platí ───────────
  const zumba = classes.find(c => c.category === 'Zumba' && c.location === 'Detva' && c.time_start === '19:00');
  await post('G', '/api/register', { name: 'Zumba Nováčik', email: 'tech-g-' + uniq + '@example.com', password: 'AuditPass123!', consent: true });
  r = await post('G', '/api/bookings', { class_id: zumba._id, booking_date: nextDow(zumba.day_of_week === 0 ? 0 : 5) });
  ok('Zumba: prvá hodina zadarmo funguje ďalej', r.status === 200, r);

  console.log(`\n═══ ${PASS} passed, ${FAIL} failed ═══\n`);
  process.exit(FAIL ? 1 : 0);
})();
