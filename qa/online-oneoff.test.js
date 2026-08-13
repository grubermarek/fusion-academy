/**
 * E2E: Jednorazové termíny hodín (only_date) — mimoriadna online hodina z Brezna.
 * Overuje, že hodina s only_date je viditeľná len vo svoj deň (klient, verejný
 * rozvrh, online zoznam, rezervácia) a že admin ju vidí stále.
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
const del = (jar, p) => call(jar, 'DELETE', p);

const dstr = d => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(d);
const TODAY = dstr(new Date());
const TODAY_DOW = new Date().getDay();
// deň v týždni, ktorý bol naposledy pred týždňom → dátum v minulosti so zhodným dow
const LAST_WEEK = dstr(new Date(Date.now() - 7 * 86400000));

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ ONE-OFF CLASSES (only_date) ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // klientka s plným online prístupom nie je nutná — /api/classes a rozvrh sú verejné
  await post('C', '/api/register', { name: 'Oneoff Klientka', email: 'oneoff-c-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });

  // ── 1) Migrácia: mimoriadna online hodina z Brezna 13.8.2026 ────────────────
  const adminCls = (await g('admin', '/api/classes')).data || [];
  const brezno = adminCls.find(c => c.category === 'Online' && c.stream_city === 'Brezno' && c.only_date === '2026-08-13');
  ok('Brezno: online hodina existuje (only_date 2026-08-13)', !!brezno, adminCls.filter(c => c.category === 'Online').map(c => c.stream_city + '/' + c.time_start));
  if (brezno) {
    ok('Brezno: štvrtok 19:00–20:00', brezno.day_of_week === 4 && brezno.time_start === '19:00' && brezno.time_end === '20:00', brezno);
    ok('Brezno: adresa označuje živé vysielanie', /Brezno/.test(brezno.address || ''), brezno.address);
    ok('Brezno: má trénera', !!brezno.instructor, brezno.instructor);
  }

  // ── 2) Jednorazová hodina DNES je pre klientku viditeľná ────────────────────
  const mkClass = (only_date, extra = {}) => post('admin', '/api/admin/classes', {
    name: 'QA Oneoff ' + uniq + (extra.tag || ''), category: extra.category || 'Tanec',
    location: extra.location || 'Zvolen', day_of_week: TODAY_DOW, time_start: '06:15', time_end: '07:00',
    capacity: 10, price: 5, only_date, ...(extra.stream_city ? { stream_city: extra.stream_city } : {}),
  });

  const todayCls = (await mkClass(TODAY)).data;
  ok('admin vie vytvoriť jednorazovú hodinu', !!todayCls?.id, todayCls);
  let cList = (await g('C', '/api/classes')).data || [];
  ok('klientka vidí jednorazovú hodinu v jej deň', cList.some(c => c._id === todayCls.id), cList.length);

  // ── 3) Jednorazová hodina z MINULÉHO týždňa je skrytá ───────────────────────
  const oldCls = (await mkClass(LAST_WEEK, { tag: '-old' })).data;
  cList = (await g('C', '/api/classes')).data || [];
  ok('klientka NEvidí jednorazovú hodinu po jej dni', !cList.some(c => c._id === oldCls.id));
  const adminList2 = (await g('admin', '/api/classes')).data || [];
  ok('admin ju vidí ďalej (vie ju dočistiť)', adminList2.some(c => c._id === oldCls.id));

  const pub = (await g('X', '/api/public/schedule')).data || {};
  ok('verejný rozvrh: expirovaná hodina nie je v zozname', !(pub.classes || []).some(c => c.name === 'QA Oneoff ' + uniq + '-old'), (pub.classes || []).length);

  // ── 4) Rezervácia expirovanej hodiny sa odmietne ────────────────────────────
  const bk = await post('C', '/api/bookings', { class_id: oldCls.id, booking_date: TODAY });
  ok('rezervácia expirovanej hodiny → 404 stale', bk.status === 404 && bk.data?.stale === true, bk);

  // ── 5) Online zoznam rešpektuje only_date ──────────────────────────────────
  const oldOnline = (await mkClass(LAST_WEEK, { tag: '-onl', category: 'Online', location: 'Online', stream_city: 'Brezno' })).data;
  const onl = (await g('C', '/api/online/classes')).data || {};
  ok('online zoznam: expirovaná online hodina skrytá', !(onl.classes || []).some(c => c._id === oldOnline.id), (onl.classes || []).map(c => c.stream_city));
  const enter = await post('C', '/api/online/enter', { class_id: oldOnline.id });
  ok('vstup do expirovaného prenosu → 404', enter.status === 404, enter);

  // ── 6) Bežné (opakované) hodiny sa filtrom nedotkli ────────────────────────
  ok('opakované hodiny zostávajú viditeľné', cList.some(c => !c.only_date), cList.length);

  // upratanie testovacích hodín
  for (const id of [todayCls?.id, oldCls?.id, oldOnline?.id].filter(Boolean)) await del('admin', '/api/admin/classes/' + id);
  const after = (await g('admin', '/api/classes')).data || [];
  ok('testovacie hodiny upratané', !after.some(c => String(c.name || '').includes('QA Oneoff ' + uniq)));

  console.log(`\n═══ ${PASS} passed, ${FAIL} failed ═══\n`);
  process.exit(FAIL ? 1 : 0);
})();
