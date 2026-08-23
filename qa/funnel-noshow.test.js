/**
 * E2E: dochádzková pravda (attendance_status + no-show) a funnel dashboard.
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
const today = () => new Date().toISOString().slice(0, 10);

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ DOCHÁDZKA (no-show) + FUNNEL ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // trénerka
  await post('T', '/api/register', { name: 'Trenerka Funnelova', email: `qa.tf.${uniq}@test-fa-qa.local`, password: 'AuditPass123!', consent: true });
  const trId = (await g('T', '/api/me')).data.id;
  await put('admin', `/api/admin/users/${trId}/role`, { user_type: 'trainer' });
  await post('T', '/api/login', { email: `qa.tf.${uniq}@test-fa-qa.local`, password: 'AuditPass123!' });

  // hodina dnes, ktorá už skončila (aby sa dala testovať no-show detekcia)
  const now = new Date();
  const past = new Date(now.getTime() - 3 * 3600e3);
  const hh = String(past.getHours()).padStart(2, '0');
  const cls = await post('admin', '/api/admin/classes', {
    name: 'QA Funnel Zumba', emoji: '💃', day_of_week: now.getDay(), time_start: `${hh}:00`, time_end: `${hh}:50`,
    location: 'Detva', capacity: 20, instructor: 'Trenerka Funnelova', active: true, category: 'Zumba'
  });
  const clsId = cls.data?.id || cls.data?._id;
  ok('testovacia hodina vytvorená', !!clsId, cls.data);

  // tri klientky: A príde (QR/tréner), B neprišla (odškrtne ju trénerka), C neprišla (odhalí job)
  const mk = async (tag, name) => {
    await post(tag, '/api/register', { name, email: `qa.${tag}.${uniq}@test-fa-qa.local`, password: 'AuditPass123!', consent: true });
    return (await g(tag, '/api/me')).data.id;
  };
  const idA = await mk('A', 'Anna Prisla');
  const idB = await mk('B', 'Bea Neprisla');
  const idC = await mk('C', 'Cilka Zabudla');

  for (const t of ['A', 'B', 'C']) {
    const r = await post(t, '/api/bookings', { class_id: clsId, booking_date: today() });
    if (t === 'A') ok('rezervácia prešla', r.status === 200 && (r.data?.ok || r.data?.id || r.data?._id), r.data);
  }

  // nová rezervácia musí byť pending, nie rovno prítomná
  await post('admin', '/api/admin/funnel/rebuild', {});
  let att = (await g('T', '/api/attendance/class/' + clsId)).data;
  ok('3 prihlásené klientky', Array.isArray(att) && att.length === 3, att?.length);
  ok('nová rezervácia je pending, nie attended', att.every(x => x.attendance_status === 'pending'), att.map(x => x.attendance_status));

  // trénerka potvrdí hodinu a Beu označí ako neprítomnú
  const beaBk = att.find(x => /Bea/.test(x.name));
  let r = await post('T', '/api/attendance/confirm-session', { class_id: clsId, date: today(), absent_ids: [beaBk.booking_id] });
  ok('potvrdenie hodiny prešlo', r.status === 200 && r.data?.ok, r.data);
  ok('1× označená ako neprišla', r.data?.no_shows === 1, r.data);
  ok('ostatné dostali návštevu', r.data?.credited === 2, r.data);

  att = (await g('T', '/api/attendance/class/' + clsId)).data;
  const bea = att.find(x => /Bea/.test(x.name));
  const anna = att.find(x => /Anna/.test(x.name));
  ok('Bea je no_show', bea?.attendance_status === 'no_show' && bea?.status !== 'attended', bea);
  ok('Anna je attended', anna?.attendance_status === 'attended' && anna?.status === 'attended', anna);

  const meB = (await g('B', '/api/me')).data;
  ok('neprítomnej sa NEpripísala návšteva', (meB.visit_count || 0) === 0, { visits: meB.visit_count });
  const meA = (await g('A', '/api/me')).data;
  ok('prítomnej sa návšteva pripísala', (meA.visit_count || 0) === 1, { visits: meA.visit_count });

  const notifB = (await g('B', '/api/notifications')).data;
  const nlist = notifB?.notifications || notifB || [];
  ok('neprítomná dostala notifikáciu v appke (nie mail)', (Array.isArray(nlist) ? nlist : []).some(n => n.type === 'no_show'), nlist?.length);

  // funnel
  const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const f = (await g('admin', `/api/admin/funnel?from=${from}&to=${today()}`)).data;
  ok('funnel vracia kroky', !!f?.ok && f.steps.registered >= 3, f?.steps);
  ok('účasť sa počíta len prítomným', f.steps.attended >= 1 && f.steps.attended < f.steps.registered, f?.steps);
  ok('no-show sa objaví v prehľade', f.no_show.no_show >= 1 && f.no_show.attended >= 1, f?.no_show);
  ok('rozpad podľa mesta funguje', (f.by_city || []).some(c => c.key === 'Detva'), f?.by_city);
  ok('zoznam „rezervovala, neprišla" obsahuje Beu', (f.stuck.booked_not_attended || []).some(x => /Bea/.test(x.name)), f?.stuck?.booked_not_attended);

  // timestampy
  const crm = (await g('admin', '/api/admin/crm/client/' + idA)).data;
  ok('CRM profil sa načíta', !!crm?.profile, crm?.error);
  const f2 = (await g('admin', `/api/admin/funnel?from=${from}&to=${today()}&city=Detva`)).data;
  ok('filter podľa mesta funguje', f2.steps.registered >= 3, f2?.steps);

  console.log(`\n─────────── ${PASS} OK · ${FAIL} FAIL ───────────\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
