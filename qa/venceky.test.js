/**
 * E2E: Venčeky — škola/trieda, QR registrácia žiaka, platby + potvrdenie,
 * náklady a zisk, progress tancov s notifikáciou, roly učiteľ/riaditeľ,
 * permission (žiak nevidí cudziu triedu, učiteľ len súhrn platieb).
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
  console.log('\n═══ VENČEKY AUDIT ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // škola + trieda
  const sch = await post('admin', '/api/admin/venceky/schools', { name: 'ZŠ QA Testová', city: 'Zvolen', year: '2026/27' });
  ok('škola vytvorená', sch.status === 200 && sch.data.school?._id, sch);
  const cls = await post('admin', '/api/admin/venceky/classes', { school_id: sch.data.school._id, name: '9.A', price: 49.9, lecturer: 'Marek' });
  ok('trieda 9.A + kód + join link', cls.status === 200 && /^VEN-/.test(cls.data.class?.code) && cls.data.join_link.includes('?vencek='), cls.data);
  const code = cls.data.class.code, cid = cls.data.class._id;

  // registrácia žiaka cez venčekový kód
  await post('Z1', '/api/register', { name: 'VEN Ziacka', email: 'ven-z1-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', city: 'Zvolen', consent: true, vencek_code: code });
  const mine1 = (await g('Z1', '/api/vencek/mine')).data || {};
  ok('žiačka priradená k triede', mine1.ok && mine1.role === 'student' && mine1.class?.name === '9.A' && mine1.school === 'ZŠ QA Testová', mine1);
  ok('žiačka vidí 7 tancov + cenu', mine1.class?.dances?.length === 7 && mine1.price === 49.9, mine1.class?.dances?.length);
  ok('platba zatiaľ žiadna', mine1.my_payment === null, mine1.my_payment);

  // zlý kód
  const bad = await post('ZX', '/api/register', { name: 'VEN Bad', email: 'ven-bad-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true, vencek_code: 'VEN-XXXXX' });
  ok('neplatný kód odmietnutý', bad.status === 400, bad);

  // platba + potvrdenie
  const z1 = (await g('Z1', '/api/me')).data || {};
  const pay = await post('admin', '/api/admin/venceky/payment', { class_id: cid, user_id: z1.id, method: 'cash' });
  ok('platba zaznamenaná', pay.status === 200, pay);
  const dup = await post('admin', '/api/admin/venceky/payment', { class_id: cid, user_id: z1.id, method: 'cash' });
  ok('duplicitná platba odmietnutá', dup.status === 400, dup);
  const mine2 = (await g('Z1', '/api/vencek/mine')).data || {};
  ok('žiačka vidí zaplatené 49,90 €', mine2.my_payment && Math.abs(mine2.my_payment.amount - 49.9) < 0.01, mine2.my_payment);
  const notifsZ = ((await g('Z1', '/api/notifications')).data) || [];
  ok('potvrdenie o platbe v notifikáciách', notifsZ.some(n => /Potvrdenie o platbe/.test(n.title || '')), notifsZ.slice(0, 2));

  // náklady + overview zisk
  await post('admin', '/api/admin/venceky/cost', { class_id: cid, label: 'Prenájom sály', amount: 10 });
  const ov = (await g('admin', '/api/admin/venceky/overview')).data || {};
  const oc = ov.schools?.[0]?.classes?.[0];
  ok('overview: 1 žiak, 1 zaplatil, príjem 49,90, náklad 10, zisk 39,90',
    oc && oc.members === 1 && oc.paid === 1 && Math.abs(oc.income - 49.9) < 0.01 && Math.abs(oc.costs - 10) < 0.01 && Math.abs(oc.profit - 39.9) < 0.01, oc);

  // progress: cha-cha na zvládnuté → notifikácia triede
  const det = (await g('admin', '/api/admin/venceky/class/' + cid)).data;
  const dances = det.class.dances.map(d => ({ name: d.name, level: d.name === 'Cha-cha' ? 4 : d.level }));
  await post('admin', '/api/admin/venceky/progress', { class_id: cid, dances, lessons_done: 3, note: 'dokončíme tango' });
  const mine3 = (await g('Z1', '/api/vencek/mine')).data || {};
  ok('progress sa prejavil (lekcia 3, cha-cha 100 %)', mine3.class.lessons_done === 3 && mine3.class.dances.find(d => d.name === 'Cha-cha')?.pct === 100, mine3.class);
  const notifs2 = ((await g('Z1', '/api/notifications')).data) || [];
  ok('trieda dostala notifikáciu o zvládnutom tanci', notifs2.some(n => /Cha-cha zvládnut/.test(n.title || '')), notifs2.slice(0, 2));

  // roly: učiteľ + riaditeľ
  await post('U1', '/api/register', { name: 'VEN Ucitelka', email: 'ven-u1-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });
  await post('R1', '/api/register', { name: 'VEN Riaditel', email: 'ven-r1-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });
  const ar1 = await post('admin', '/api/admin/venceky/assign-role', { email: 'ven-u1-' + uniq + '@test-fa-qa.local', role: 'teacher', school_id: sch.data.school._id, class_id: cid });
  const ar2 = await post('admin', '/api/admin/venceky/assign-role', { email: 'ven-r1-' + uniq + '@test-fa-qa.local', role: 'director', school_id: sch.data.school._id });
  ok('roly pridelené', ar1.status === 200 && ar2.status === 200, { ar1: ar1.data, ar2: ar2.data });
  const mineU = (await g('U1', '/api/vencek/mine')).data || {};
  ok('učiteľka vidí triedu + súhrn platieb (1/1), bez mien', mineU.role === 'teacher' && mineU.class?.paid_count === 1 && !JSON.stringify(mineU).includes('ven-z1'), mineU);
  const mineR = (await g('R1', '/api/vencek/mine')).data || {};
  ok('riaditeľ vidí školu a všetky triedy', mineR.role === 'director' && mineR.schools?.[0]?.classes?.length === 1, mineR);

  // permission: bežný klient nemá venčekový prehľad, admin API len pre admina
  await post('C0', '/api/register', { name: 'VEN Bezna', email: 'ven-c0-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });
  const mineC = (await g('C0', '/api/vencek/mine')).data || {};
  ok('bežný klient: role null', mineC.ok && mineC.role === null, mineC);
  const guard = await g('C0', '/api/admin/venceky/overview');
  ok('admin API chránené (403)', guard.status === 403, guard.status);

  // ── FÁZA 2 ──
  // uvítacie benefity žiaka: 1 free kredit + notifikácia s kupónom
  const me1 = (await g('Z1', '/api/me')).data || {};
  ok('žiačka má 1× vstup zdarma', me1.free_credits === 1, me1.free_credits);
  const notifsW = ((await g('Z1', '/api/notifications')).data) || [];
  ok('uvítacia notifikácia s kupónom VENCEKRODIC', notifsW.some(n => /VENCEKRODIC/.test(n.body || '')), notifsW.length);

  // VIP kanál: venčekárka ho vidí, bežný klient nie
  const chV = (await g('Z1', '/api/community/channels')).data || [];
  const chC = (await g('C0', '/api/community/channels')).data || [];
  ok('venčekárka vidí Venčeky VIP kanál', chV.some(c => c.id === 'venceky_vip'), chV.map(c => c.id));
  ok('bežný klient VIP kanál nevidí', !chC.some(c => c.id === 'venceky_vip'), chC.map(c => c.id));
  const msgGuard = await g('C0', '/api/community/messages/venceky_vip');
  ok('VIP správy chránené (403 pre bežného klienta)', msgGuard.status === 403, msgGuard.status);
  const msgOk = await g('Z1', '/api/community/messages/venceky_vip');
  ok('venčekárka VIP správy načíta', msgOk.status === 200, msgOk.status);

  // dochádzka
  const att = await post('admin', '/api/admin/venceky/attendance', { class_id: cid, lesson_no: 3, present: [z1.id] });
  ok('dochádzka zapísaná', att.status === 200 && att.data.present === 1, att);
  await post('admin', '/api/admin/venceky/attendance', { class_id: cid, lesson_no: 4, present: [] });
  const mineA = (await g('Z1', '/api/vencek/mine')).data || {};
  ok('žiačka vidí dochádzku 1/2', mineA.my_attendance?.attended === 1 && mineA.my_attendance?.recorded === 2, mineA.my_attendance);
  const mineRA = (await g('R1', '/api/vencek/mine')).data || {};
  ok('riaditeľ vidí priemernú účasť 50 %', mineRA.schools?.[0]?.classes?.[0]?.attendance?.avg_pct === 50, mineRA.schools?.[0]?.classes?.[0]?.attendance);

  // ukončenie venčeka → odznak absolventa + kupón
  const comp = await post('admin', '/api/admin/venceky/complete', { class_id: cid });
  ok('venček ukončený (1 žiak)', comp.status === 200 && comp.data.students === 1, comp);
  const compDup = await post('admin', '/api/admin/venceky/complete', { class_id: cid });
  ok('opakované ukončenie odmietnuté', compDup.status === 400, compDup.status);
  const prof = (await g('Z1', '/api/profile/' + z1.id)).data || {};
  ok('profil má odznak absolventa', prof.vencek_alumni === '2026/27', prof.vencek_alumni);
  const notifsF = ((await g('Z1', '/api/notifications')).data) || [];
  ok('absolventská notifikácia s kupónom VENCEKABS', notifsF.some(n => /VENCEKABS/.test(n.body || '')), notifsF.length);

  // ── FÁZA 3: samoobslužný booking pre školy ──
  const sl1 = await post('admin', '/api/admin/venceky/slot', { kind: 'lesson', label: 'Utorok 14:00 – 15:00', city: 'Zvolen' });
  const sl2 = await post('admin', '/api/admin/venceky/slot', { kind: 'evening', label: 'Sobota 13.6.2027', date: '2027-06-13', venue: 'KD Zvolen' });
  ok('sloty vytvorené', sl1.status === 200 && sl2.status === 200, { sl1: sl1.data, sl2: sl2.data });
  const bl = await post('admin', '/api/admin/venceky/booking-link', { school_id: sch.data.school._id });
  ok('booking link vygenerovaný', bl.status === 200 && /vencek-booking\?t=VB/.test(bl.data.link), bl.data);
  const token = bl.data.link.split('t=')[1];
  const pubGet = await g('pub', '/api/vencek-booking/' + token);
  ok('škola vidí voľné sloty (bez účtu)', pubGet.data?.ok && pubGet.data.lesson_slots.length === 1 && pubGet.data.evening_slots.length === 1, pubGet.data);
  const badTok = await g('pub', '/api/vencek-booking/VBNEEXISTUJE');
  ok('neplatný token 404', badTok.status === 404, badTok.status);
  const book1 = await post('pub', '/api/vencek-booking/' + token, { slot_id: sl1.data.slot._id, contact: 'riaditel@test-fa-qa.local' });
  const book2 = await post('pub', '/api/vencek-booking/' + token, { slot_id: sl2.data.slot._id, contact: 'riaditel@test-fa-qa.local' });
  ok('booking lekcií + večera prešiel', book1.status === 200 && book2.status === 200, { book1: book1.data, book2: book2.data });
  const bookDup = await post('pub', '/api/vencek-booking/' + token, { slot_id: sl1.data.slot._id, contact: 'x@test-fa-qa.local' });
  ok('kolízia/duplicita odmietnutá', bookDup.status === 409 || bookDup.status === 400, bookDup.status);
  const pubGet2 = await g('pub', '/api/vencek-booking/' + token);
  ok('škola vidí svoje potvrdené termíny', pubGet2.data?.my_lesson && pubGet2.data?.my_evening, pubGet2.data);
  const detE = (await g('admin', '/api/admin/venceky/class/' + cid)).data;
  ok('event_date sa zapísal do triedy', detE.class.event_date === '2027-06-13', detE.class.event_date);
  const slots = (await g('admin', '/api/admin/venceky/slots')).data || {};
  ok('admin vidí sloty so školou', slots.slots?.every(x => x.school_name === 'ZŠ QA Testová'), slots.slots);
  const notifsAdm = ((await g('admin', '/api/notifications')).data) || [];
  ok('admin notifikácia o bookingu', notifsAdm.some(n => /zabookovala termín/.test(n.title || '')), notifsAdm.slice(0, 2));

  // ── ROLY PRI REGISTRÁCII CEZ KÓD ──
  // rodič: priradený, nepočíta sa medzi žiakov, vidí triedu
  await post('P1', '/api/register', { name: 'VEN Mama', email: 'ven-p1-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true, vencek_code: code, vencek_role: 'parent', vencek_child_name: 'VEN Ziacka' });
  const mineP = (await g('P1', '/api/vencek/mine')).data || {};
  ok('rodič vidí triedu ako parent', mineP.role === 'parent' && mineP.is_parent === true && mineP.child_name === 'VEN Ziacka', mineP);
  const ovP = (await g('admin', '/api/admin/venceky/overview')).data || {};
  const ocP = ovP.schools?.[0]?.classes?.[0];
  ok('rodič sa nepočíta medzi žiakov (stále 1 žiak, 1 rodič)', ocP?.members === 1 && ocP?.parents === 1, ocP);
  const chP = (await g('P1', '/api/community/channels')).data || [];
  ok('rodič vidí VIP kanál', chP.some(c => c.id === 'venceky_vip'), chP.length);
  const meP = (await g('P1', '/api/me')).data || {};
  ok('rodič dostal 1× vstup zdarma', meP.free_credits === 1, meP.free_credits);

  // učiteľ cez kód: pending, bez prístupu, potom schválenie
  await post('T2', '/api/register', { name: 'VEN Ucitel QR', email: 'ven-t2-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true, vencek_code: code, vencek_role: 'teacher' });
  const mineT2 = (await g('T2', '/api/vencek/mine')).data || {};
  ok('učiteľ cez QR nemá prístup pred schválením', mineT2.role === null, mineT2);
  const chT2 = (await g('T2', '/api/community/channels')).data || [];
  ok('pending učiteľ nevidí VIP kanál', !chT2.some(c => c.id === 'venceky_vip'), chT2.length);
  const ovT = (await g('admin', '/api/admin/venceky/overview')).data || {};
  const pend = (ovT.pending || []).find(p => p.name === 'VEN Ucitel QR');
  ok('admin vidí čakajúceho učiteľa', !!pend && pend.role === 'teacher' && pend.school === 'ZŠ QA Testová', ovT.pending);
  const apr = await post('admin', '/api/admin/venceky/approve', { user_id: pend.id, approve: true });
  ok('schválenie prešlo', apr.status === 200, apr);
  const mineT3 = (await g('T2', '/api/vencek/mine')).data || {};
  ok('po schválení má učiteľ prístup k triede', mineT3.role === 'teacher' && mineT3.class?.name === '9.A', mineT3);
  const notifsT2 = ((await g('T2', '/api/notifications')).data) || [];
  ok('učiteľ dostal notifikáciu o schválení + kupón', notifsT2.some(n => /Prístup schválený/.test(n.title || '') && /VENCEKRODIC/.test(n.body || '')), notifsT2.slice(0, 3));

  // riaditeľ cez kód: pending + zamietnutie
  await post('R2', '/api/register', { name: 'VEN Riaditel QR', email: 'ven-r2-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true, vencek_code: code, vencek_role: 'director' });
  const ovR = (await g('admin', '/api/admin/venceky/overview')).data || {};
  const pendR = (ovR.pending || []).find(p => p.name === 'VEN Riaditel QR');
  const rej = await post('admin', '/api/admin/venceky/approve', { user_id: pendR.id, approve: false });
  const mineR2 = (await g('R2', '/api/vencek/mine')).data || {};
  ok('zamietnutý riaditeľ nemá prístup', rej.status === 200 && mineR2.role === null, mineR2);

  console.log(`\n═══ VÝSLEDOK: ${PASS} ✓ / ${FAIL} ✗ ═══`);
  if (FAIL) { console.log(FAILS.map(f => f.name).join('\n')); process.exit(1); }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
