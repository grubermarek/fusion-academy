/**
 * E2E: 1) história víťaziek z db.monthly_winners, 2) rodičovské bookovanie dieťaťa
 * (kryté členstvom/vstupmi mamy + info pre trénera + vrátenie pri storne),
 * 3) admin „online dnes ZDARMA" deň. Izolovaná inštancia.
 */
const BASE = 'http://localhost:' + (process.env.QA_PORT || 3999);
let PASS = 0, FAIL = 0; const FAILS = [];
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; FAILS.push({ name }); console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail) : '')); }
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

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ FAMILY + FREE DAY AUDIT ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // [1] História víťaziek (sandbox má seednutý monthly_winners záznam 2026-07)
  console.log('\n[1] História víťaziek');
  await post('M', '/api/register', { name: 'AUDIT Mama', email: 'audit-mama-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
  const wh = (await g('M', '/api/client/winners-history')).data || {};
  ok('winners-history ok', wh.ok === true, wh);
  const jul = (wh.months || []).find(m => m.period === '2026-07');
  ok('júl 2026 v histórii (Michaela Testová, 75 b)', jul && /Michaela/.test(jul.name) && jul.points === 75 && /júl/.test(jul.label), jul || wh.months);

  // [2] Rodičovské bookovanie
  console.log('\n[2] Rodič bookuje dieťa');
  const meM = (await g('M', '/api/me')).data; const momId = meM.id;
  const ch = await post('M', '/api/family/children', { name: 'AUDIT Dcérka', birth_date: '2015-05-05' });
  ok('vytvorené dieťa', ch.status === 200, ch.data);
  const kids = (await g('M', '/api/family/children')).data || [];
  const kid = kids.find(k => k.name === 'AUDIT Dcérka');
  ok('dieťa v zozname', !!kid, kids);
  const classes = (await g('M', '/api/classes')).data || [];
  const cls = classes.find(c => c.category === 'Zumba' && c.location === 'Zvolen');
  ok('Zumba Zvolen existuje', !!cls);
  const nextDate = (dow => { const d = new Date(); do { d.setDate(d.getDate() + 1); } while (d.getDay() !== dow); return d.toISOString().slice(0, 10); })(cls.day_of_week);

  // 2a: dieťa má 1. hodinu zdarma → booknuteľné hneď
  const b1 = await post('M', '/api/bookings', { class_id: cls._id, booking_date: nextDate, for_child_id: kid.id });
  ok('1. detská rezervácia (prvá zadarmo)', b1.status === 200, b1.data);
  // tréner vidí, že je to dieťa z rodičovského účtu
  const att = (await g('admin', '/api/attendance/class/' + cls._id + '?date=' + nextDate)).data || [];
  const childRow = att.find(a => a.is_child_booking && a.child_name === 'AUDIT Dcérka');
  ok('tréner vidí dieťa + meno rodiča', childRow && childRow.booked_by_name === 'AUDIT Mama', childRow || att);

  // 2b: druhá rezervácia — dieťa nemá nič, mama BEZ členstva a bez vstupov → 402
  const d2 = new Date(nextDate); d2.setDate(d2.getDate() + 7); const nextDate2 = d2.toISOString().slice(0, 10);
  const b2 = await post('M', '/api/bookings', { class_id: cls._id, booking_date: nextDate2, for_child_id: kid.id });
  ok('bez členstva mamy → membership_required', b2.status === 402, { s: b2.status, d: b2.data });

  // 2c: mama dostane ČLENSTVO (platené) → detská rezervácia prejde cez parent_membership
  await post('admin', '/api/admin/users/' + momId + '/grant-membership', { plan_id: 'bronze', gift: false, payment_method: 'cash' });
  const b3 = await post('M', '/api/bookings', { class_id: cls._id, booking_date: nextDate2, for_child_id: kid.id });
  ok('s členstvom mamy → rezervácia OK', b3.status === 200, b3.data);
  const att2 = (await g('admin', '/api/attendance/class/' + cls._id + '?date=' + nextDate2)).data || [];
  const row2 = att2.find(a => a.is_child_booking);
  ok('access_method = parent_membership', row2 && row2.access_method === 'parent_membership', row2);

  // 2d: druhá mama len s permanentkou → odpočet vstupu mame + vrátenie pri storne
  await post('M2', '/api/register', { name: 'AUDIT Mamula', email: 'audit-mama2-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
  const mom2 = (await g('M2', '/api/me')).data;
  await post('admin', '/api/admin/users/' + mom2.id + '/grant-membership', { entries: 3, gift: false, payment_method: 'cash' });
  const ch2 = await post('M2', '/api/family/children', { name: 'AUDIT Dcérka2', birth_date: '2016-06-06' });
  const kid2 = ((await g('M2', '/api/family/children')).data || []).find(k => k.name === 'AUDIT Dcérka2');
  // minúť prvú hodinu zdarma dieťaťa
  await post('M2', '/api/bookings', { class_id: cls._id, booking_date: nextDate, for_child_id: kid2.id });
  const before = ((await g('M2', '/api/me')).data || {}).single_entries;
  const b4 = await post('M2', '/api/bookings', { class_id: cls._id, booking_date: nextDate2, for_child_id: kid2.id });
  ok('rezervácia cez vstup mamy OK', b4.status === 200, b4.data);
  const after = ((await g('M2', '/api/me')).data || {}).single_entries;
  ok('vstup odpočítaný MAME (' + before + '→' + after + ')', after === before - 1, { before, after });
  const bid = b4.data && (b4.data.id || b4.data._id || (b4.data.booking && b4.data.booking._id));
  const cancel = await del('M2', '/api/bookings/' + bid);
  ok('storno detskej rezervácie', cancel.status === 200, cancel.data);
  const after2 = ((await g('M2', '/api/me')).data || {}).single_entries;
  ok('vstup vrátený mame (' + after + '→' + after2 + ')', after2 === before, { after, after2 });

  // [3] Online free day
  console.log('\n[3] Online dnes zdarma');
  const st0 = (await g('admin', '/api/admin/online-free-day')).data || {};
  ok('free day default vypnutý', st0.active === false, st0);
  // bronze mama nemá online prístup
  const oc0 = (await g('M', '/api/online/classes')).data || {};
  ok('bronze bez free dňa: bez plného prístupu', oc0.access_mode !== 'full', oc0.access_mode);
  const t1 = await post('admin', '/api/admin/online-free-day', { on: true });
  ok('zapnutie free dňa', t1.status === 200 && t1.data.active === true, t1.data);
  const oc1 = (await g('M', '/api/online/classes')).data || {};
  ok('free deň: každý má full prístup', oc1.access_mode === 'full' && oc1.online_free_today === true, { m: oc1.access_mode, f: oc1.online_free_today });
  const t0 = await post('admin', '/api/admin/online-free-day', { on: false });
  ok('vypnutie free dňa', t0.status === 200 && t0.data.active === false, t0.data);
  const oc2 = (await g('M', '/api/online/classes')).data || {};
  ok('po vypnutí opäť bez full prístupu', oc2.access_mode !== 'full', oc2.access_mode);

  console.log('\n═══ VÝSLEDOK: ' + PASS + ' PASS, ' + FAIL + ' FAIL ═══');
  if (FAIL) { FAILS.forEach(f => console.log('  FAIL: ' + f.name)); process.exit(1); }
})().catch(e => { console.error('CHYBA:', e); process.exit(1); });
