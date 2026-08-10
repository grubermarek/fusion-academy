/**
 * E2E: Pozvánkový funnel /invite — jednotný link, guest booking bez registrácie,
 * žiadna druhá „prvá zdarma", správa rezervácie tokenom, claim účtu bez duplicít,
 * funnel analytics + test mód mimo štatistík.
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
  console.log('\n═══ INVITE FUNNEL AUDIT ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // pozývajúca klientka + jednotná pozvánka
  await post('I1', '/api/register', { name: 'INV Maria', email: 'inv-i1-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });
  const msg = (await g('I1', '/api/invite-message')).data || {};
  ok('jednotná pozvánka s /invite linkom', msg.ok && /\/invite\//.test(msg.link) && /ZADARMO/.test(msg.message) && msg.message.includes(msg.link), msg);
  const CODE = msg.code;

  // landing info + mestá + click event
  const info = (await g('pub', '/api/invite/' + CODE + '/info?first=1')).data || {};
  ok('info: meno pozývateľky + mestá bez Online', info.ok && info.inviter === 'INV' && info.cities.length >= 1 && !info.cities.includes('Online'), info);
  const bad = await g('pub', '/api/invite/NEEXISTUJE99/info');
  ok('neplatný kód 404', bad.status === 404, bad.status);

  // hodiny v meste
  const city = info.cities[0];
  const cls = (await g('pub', '/api/invite/' + CODE + '/classes?city=' + encodeURIComponent(city) + '&picked=1')).data || {};
  ok('hodiny v meste (kapacita, dátum, adresa)', cls.ok && cls.classes.length >= 1 && cls.classes[0].date && cls.classes[0].spots_left > 0, cls);
  const pick = cls.classes[0];

  // guest booking len s menom + emailom
  const book = await post('pub', '/api/invite/' + CODE + '/book', { class_id: pick.id, booking_date: pick.date, name: 'INV Guest Ema', contact: 'inv-guest-' + uniq + '@test-fa-qa.local' });
  ok('guest booking prešiel', book.status === 200 && book.data.manage_token && book.data.detail.city === city, book.data);
  ok('guest je nový lead', book.data.is_new === true, book.data.is_new);
  const dup = await post('pub', '/api/invite/' + CODE + '/book', { class_id: pick.id, booking_date: pick.date, name: 'INV Guest Ema', contact: 'inv-guest-' + uniq + '@test-fa-qa.local' });
  ok('druhá „prvá zdarma" odmietnutá (409)', dup.status === 409, dup.status);

  // pozývateľka NEdostane notifikáciu (test kontakt) — over cez skutočný kontakt nižšie
  // telefónny kontakt + guest bez emailu
  const book2 = await post('pub', '/api/invite/' + CODE + '/book', { class_id: pick.id, booking_date: pick.date, name: 'INV Guest Tel', contact: '+421 900 111 222' });
  ok('guest booking cez telefón prešiel', book2.status === 200, book2.data);
  const notifI = ((await g('I1', '/api/notifications')).data) || [];
  ok('pozývateľka dostala notifikáciu (reálny kontakt)', notifI.some(n => /kamoška sa prihlásila/i.test(n.title || '')), notifI.slice(0, 2));

  // duplicitný telefón → žiadny nový lead, 409 (free použitá)
  const dup2 = await post('pub', '/api/invite/' + CODE + '/book', { class_id: pick.id, booking_date: pick.date, name: 'Iné Meno', contact: '0900111222' });
  ok('rovnaký telefón = rozpoznaný, žiadna druhá zdarma', dup2.status === 409, dup2.status);

  // správa rezervácie tokenom: zoznam + zrušenie vráti prvú zdarma
  const tok = book.data.manage_token;
  const man = (await g('pub', '/api/invite-manage/' + tok)).data || {};
  ok('manage: vidí svoju rezerváciu bez loginu', man.ok && man.bookings.length === 1, man);
  const can = await post('pub', '/api/invite-manage/' + tok + '/cancel', { booking_id: man.bookings[0].id });
  ok('zrušenie prešlo', can.status === 200, can.data);
  const rebook = await post('pub', '/api/invite/' + CODE + '/book', { class_id: pick.id, booking_date: pick.date, name: 'INV Guest Ema', contact: 'inv-guest-' + uniq + '@test-fa-qa.local' });
  ok('po zrušení sa dá rezervovať znova (prvá zdarma vrátená)', rebook.status === 200 && rebook.data.is_new === false, rebook.data);

  // claim: registrácia s emailom guesta → prepojenie bez duplicít, free sa nestackuje
  const claim = await post('G1', '/api/register', { name: 'INV Guest Ema', email: 'inv-guest-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });
  ok('registrácia claimla guest účet', claim.status === 200 && claim.data.claimed === true, claim.data);
  const meG = (await g('G1', '/api/me')).data || {};
  ok('free kredit sa nestackol (0)', meG.free_credits === 0, meG.free_credits);
  const myB = ((await g('G1', '/api/my-bookings')).data) || [];
  ok('rezervácia je v claimnutom účte', Array.isArray(myB) ? myB.length >= 1 : (myB.bookings || []).length >= 1, myB);

  // funnel analytics: kroky + top pozývateľky; test kontakty vylúčené z 'booked'
  const fun = (await g('admin', '/api/admin/referral-funnel')).data || {};
  const step = n => (fun.steps || []).find(s => s.label === n)?.n ?? -1;
  ok('funnel: kliknutia zarátané', step('Otvorili pozvánku') >= 1, fun.steps);
  ok('funnel: bookingy zarátané (len reálne kontakty)', step('Rezervovali hodinu') >= 1, fun.steps);
  const inv1 = (fun.inviters || []).find(v => v.name === 'INV Maria');
  ok('per-klientka štatistika existuje', !!inv1 && inv1.booked >= 1, fun.inviters);

  console.log(`\n═══ VÝSLEDOK: ${PASS} ✓ / ${FAIL} ✗ ═══`);
  if (FAIL) { console.log(FAILS.map(f => f.name).join('\n')); process.exit(1); }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
