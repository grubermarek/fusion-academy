/**
 * E2E: druhá návšteva vo funneli, horúce leady pre trénerku (vrátane no-show
 * pravidla, ktoré bolo dovtedy mŕtve) a zrušená zľava na deň 9.
 */
const BASE = 'http://localhost:' + (process.env.QA_PORT || 3991);
let PASS = 0, FAIL = 0;
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 350) : '')); }
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
  console.log('\n═══ KONVERZIA: DRUHÁ NÁVŠTEVA + HORÚCE LEADY ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // ── zľava na deň 9 už nesmie existovať ────────────────────────────────────
  const steps = (await g('admin', '/api/admin/email-sequences')).data;
  const list = steps?.steps || steps || [];
  const day9 = (Array.isArray(list) ? list : []).find(s => s.sequence === 'trial_followup' && s.day === 9);
  ok('deň 9 v trial_followup existuje', !!day9, list?.length);
  if (day9) {
    ok('deň 9 už neponúka zľavu', !/zľav|zlav|%/i.test((day9.subject || '') + (day9.body || '')), { subject: day9.subject });
    ok('deň 9 tlačí druhú hodinu', /druh/i.test((day9.subject || '') + (day9.label || '')), { subject: day9.subject, label: day9.label });
  }

  // ── trénerka + hodina, ktorá už skončila ──────────────────────────────────
  await post('T', '/api/register', { name: 'Trenerka Konverzna', email: `qa.tk.${uniq}@test-fa-qa.local`, password: 'AuditPass123!', consent: true });
  const trId = (await g('T', '/api/me')).data.id;
  await put('admin', `/api/admin/users/${trId}/role`, { user_type: 'trainer' });
  await post('T', '/api/login', { email: `qa.tk.${uniq}@test-fa-qa.local`, password: 'AuditPass123!' });

  const now = new Date();
  const hh = String(new Date(now.getTime() - 3 * 3600e3).getHours()).padStart(2, '0');
  const c1 = await post('admin', '/api/admin/classes', { name: 'QA Konverzia A', emoji: '💃', day_of_week: now.getDay(), time_start: `${hh}:00`, time_end: `${hh}:50`, location: 'Brezno', capacity: 20, instructor: 'Trenerka Konverzna', active: true, category: 'Zumba' });
  const clsA = c1.data?.id || c1.data?._id;

  // Ema príde dvakrát, Sara raz, Nina neprišla vôbec
  const mk = async (tag, name) => { await post(tag, '/api/register', { name, email: `qa.${tag}${uniq}@test-fa-qa.local`, password: 'AuditPass123!', consent: true }); return (await g(tag, '/api/me')).data.id; };
  const idE = await mk('E', 'Ema Vracia');
  const idS = await mk('S', 'Sara Raz');
  const idN = await mk('N', 'Nina Neprisla');

  for (const t of ['E', 'S', 'N']) await post(t, '/api/bookings', { class_id: clsA, booking_date: today() });
  let att = (await g('T', '/api/attendance/class/' + clsA)).data;
  const ninaBk = att.find(x => /Nina/.test(x.name));
  let r = await post('T', '/api/attendance/confirm-session', { class_id: clsA, date: today(), absent_ids: [ninaBk.booking_id] });
  ok('hodina potvrdená, Nina označená ako neprišla', r.data?.ok && r.data?.no_shows === 1, r.data);

  // Ema príde druhýkrát — druhá hodina dnes v inom čase (rezervovať do minulosti sa nedá)
  const hh2 = String(new Date(now.getTime() - 2 * 3600e3).getHours()).padStart(2, '0');
  const c2 = await post('admin', '/api/admin/classes', { name: 'QA Konverzia B', emoji: '💃', day_of_week: now.getDay(), time_start: `${hh2}:05`, time_end: `${hh2}:55`, location: 'Brezno', capacity: 20, instructor: 'Trenerka Konverzna', active: true, category: 'Zumba' });
  const clsB = c2.data?.id || c2.data?._id;
  // cez trénerku (klientka sa do už prebehnutej hodiny sama zapísať nevie)
  await post('T', '/api/attendance/manual-booking', { user_id: idE, class_id: clsB, booking_date: today(), is_free: true });
  r = await post('T', '/api/attendance/confirm-session', { class_id: clsB, date: today(), absent_ids: [] });
  // manuálny zápis trénerkou už účasť zapíše, takže potvrdenie nemá čo pripísať
  ok('druhá hodina Emy je zapísaná ako absolvovaná', r.data?.ok && r.data?.attended === 1, r.data);

  // ── funnel: druhá návšteva ────────────────────────────────────────────────
  const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const f = (await g('admin', `/api/admin/funnel?from=${from}&to=${today()}&city=Brezno`)).data;
  ok('funnel má krok „prišli aj druhýkrát"', f?.steps?.returned >= 1, f?.steps);
  ok('kto bol raz, sa do druhej návštevy neráta', f.steps.returned < f.steps.attended, f?.steps);
  ok('konverzia na druhú návštevu je vyrátaná', typeof f.rates.to_returned === 'number' && f.rates.to_returned <= 100, f?.rates);
  ok('medián dní do druhej návštevy', f.median_days.to_back !== undefined, f?.median_days);
  ok('Sara je v zozname „bola raz, nevrátila sa"', (f.stuck.attended_not_returned || []).some(x => x.id === idS), f?.stuck?.attended_not_returned);
  ok('Ema tam nie je (vrátila sa)', !(f.stuck.attended_not_returned || []).some(x => x.id === idE), f?.stuck?.attended_not_returned);

  // ── horúce leady pre trénerku ─────────────────────────────────────────────
  const coach = (await g('T', '/api/coach/today')).data;
  ok('coach vracia leady', Array.isArray(coach?.leads), coach?.error);
  const sara = (coach.leads || []).find(x => x.id === idS);
  ok('Sara (bola na hodine, nič nekúpila) je horúci lead', !!sara && sara.priority === 'hot', sara);
  const nina = (coach.leads || []).find(x => x.id === idN);
  ok('Nina (no-show) je v zozname s dôvodom no-show', !!nina && /no-show/i.test(nina.reason || ''), nina);
  ok('no-show sa počíta správne (pravidlo bolo dovtedy mŕtve)', nina?.no_shows === 1, { no_shows: nina?.no_shows });

  const leadN = (await g('T', '/api/coach/lead/' + idN)).data;
  ok('no_show_count na klientke sedí', (leadN?.lead?.no_shows || 0) === 1, leadN?.lead);

  // oprava: Nina predsa len bola → počítadlo musí klesnúť
  r = await post('T', '/api/attendance/confirm-session', { class_id: clsA, date: today(), absent_ids: [] });
  const leadN2 = (await g('T', '/api/coach/lead/' + idN)).data;
  const meN2 = (await g('N', '/api/me')).data;
  ok('po oprave no_show_count klesol', (leadN2?.lead?.no_shows || 0) === 0, leadN2?.lead);
  ok('a návšteva sa jej pripísala', (meN2.visit_count || 0) === 1, { visits: meN2.visit_count });

  console.log(`\n─────────── ${PASS} OK · ${FAIL} FAIL ───────────\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
