/**
 * E2E: 1) história víťaziek z db.monthly_winners, 2) rodičovské bookovanie dieťaťa
 * (kryté členstvom/vstupmi mamy + info pre trénera + vrátenie pri storne),
 * 3) admin „online dnes ZDARMA" deň.
 *
 * Samostatná inštancia: vlastný DATA_DIR, RATE_LIMIT_OFF=1, MAIL_CAPTURE=1 (nič
 * neodíde mailom), účty, hodina aj víťazky zapísané priamo do .db súborov.
 *
 * Nezávislé od dátumu (11. 9. 2026): test predtým čakal natvrdo „júl 2026" zo
 * zdieľaného sandboxu, ale appka pri štarte korunuje víťazku za PREDOŠLÝ mesiac
 * (crownMonthlyWinner). Víťazky sa preto seedujú relatívne k dnešku — a keďže
 * minulý mesiac je už vyhlásený, server pri štarte nikoho nekoruje.
 *
 * Spustenie:  node qa/family-freeday.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4527;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-family-'));

let PASS = 0, FAIL = 0; const FAILS = [];
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; FAILS.push({ name }); console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail) : '')); }
}
const jars = {};
async function call(jar, method, p, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (jars[jar]) headers['Cookie'] = jars[jar];
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jars[jar] = sc.split(';')[0];
  let data = null; try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}
const g = (jar, p) => call(jar, 'GET', p);
const post = (jar, p, b) => call(jar, 'POST', p, b);
const del = (jar, p) => call(jar, 'DELETE', p);
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const spi = ms => new Promise(r => setTimeout(r, ms));
// Miestny dátum RRRR-MM-DD — toISOString() by medzi polnocou a 2:00 vrátil včerajšok (UTC)
const den = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// Mesiace rátané rovnako ako v crownMonthlyWinner — podľa slovenského času
const sk = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
const mesiac = k => { const d = new Date(+sk.slice(0, 4), +sk.slice(5, 7) - 1 - k, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const MINULY = mesiac(1), PREDMINULY = mesiac(2), MINULY_ROK = String(+sk.slice(0, 4) - 1);
const SKM = ['január', 'február', 'marec', 'apríl', 'máj', 'jún', 'júl', 'august', 'september', 'október', 'november', 'december'];
const nazov = p => SKM[+p.slice(5, 7) - 1] + ' ' + p.slice(0, 4);

(async () => {
  const hash = bcrypt.hashSync('AuditPass123!', 10);
  // @qa-biz.local, nie @test-fa-qa.local: migrácia cleanup_qa_online_test_v1 na
  // čistej DB pri štarte zmaže všetky @test-fa-qa.local účty aj s ich záznamami.
  const U = (_id, name, extra) => ({ _id, name, email: _id.toLowerCase() + '@qa-biz.local', password: hash, active: true,
    user_type: 'client', city: 'Zvolen', created_at: '2026-01-01', visit_count: 0, single_entries: 0, free_credits: 0, referral_credit: 0, ...extra });
  w('users.db', [
    U('qaFfAdmin00001', 'QA Admin Rodina', { is_admin: true, user_type: 'admin' }),
    U('qaFfMichaela01', 'Michaela Testová', { visit_count: 12, free_class_used: true }),
    U('qaFfJana000001', 'Jana Staršia', { visit_count: 9, free_class_used: true }),
    U('qaFfMama000001', 'AUDIT Mama'),     // bez členstva a bez vstupov
    U('qaFfMama000002', 'AUDIT Mamula'),   // dostane len permanentku
  ]);
  // Minulý mesiac je už vyhlásený → server pri štarte nikoho nekoruje (nedá Gold).
  // Ročný titul za minulý rok tiež, inak by ho v januári vyhlásil pri štarte.
  w('monthly_winners.db', [
    { _id: 'qaFfWinMin0001', month: MINULY, user_id: 'qaFfMichaela01', user_name: 'Michaela Testová', points: 75, prizes: [], value: 225, seen: true, created_at: '2026-01-01T08:00:00.000Z' },
    { _id: 'qaFfWinPred001', month: PREDMINULY, user_id: 'qaFfJana000001', user_name: 'Jana Staršia', points: 60, prizes: [], value: 225, seen: true, created_at: '2026-01-01T08:00:00.000Z' },
    { _id: 'qaFfWinRok0001', month: MINULY_ROK, type: 'year', user_id: 'qaFfMichaela01', user_name: 'Michaela Testová', points: 900, seen: true, created_at: '2026-01-01T08:00:00.000Z' },
  ]);
  // Zumba Zvolen o 2 dni — najbližší termín aj termín o týždeň neskôr sa dajú stornovať
  const dow = new Date(Date.now() + 2 * 864e5).getDay();
  w('classes.db', [{ _id: 'qaFfZumba00001', name: 'Zumba', emoji: '🎵', category: 'Zumba', location: 'Zvolen', instructor: 'QA Tréner',
    day_of_week: dow, time_start: '19:00', time_end: '20:00', capacity: 25, active: true, price: 10 }]);

  console.log('\n═══ FAMILY + FREE DAY AUDIT ═══');
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' } });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await spi(1000); } }
  if (!zije) { console.log('  ✗ server nenabehol'); console.log(chyba.slice(0, 1200)); srv.kill(); process.exit(1); }
  await spi(15000); // migrácie a štartovacie joby (korunovanie víťazky)

  try {
    await post('admin', '/api/login', { email: 'qaffadmin00001@qa-biz.local', password: 'AuditPass123!' });
    const lm = await post('M', '/api/login', { email: 'qaffmama000001@qa-biz.local', password: 'AuditPass123!' });
    ok('mama sa prihlási', lm.status === 200, lm.data);

    // [1] História víťaziek
    console.log('\n[1] História víťaziek');
    ok('pri štarte sa nikto nekorunoval navyše', rd('monthly_winners.db').length === 3, rd('monthly_winners.db').map(x => x.month));
    const wh = (await g('M', '/api/client/winners-history')).data || {};
    ok('winners-history ok', wh.ok === true, wh);
    const months = wh.months || [];
    const min = months.find(m => m.period === MINULY);
    ok(nazov(MINULY) + ' v histórii (Michaela Testová, 75 b)', min && /Michaela/.test(min.name) && min.points === 75 && min.label === nazov(MINULY), min || months);
    ok('najnovší mesiac je prvý', months[0] && months[0].period === MINULY, months.map(m => m.period));
    ok(nazov(PREDMINULY) + ' tiež v histórii (Jana Staršia, 60 b)', months.some(m => m.period === PREDMINULY && /Jana/.test(m.name) && m.points === 60), months);
    ok('klientka roka ' + MINULY_ROK + ' je v rokoch, nie v mesiacoch', (wh.years || []).some(y => y.period === MINULY_ROK && y.label === MINULY_ROK) && !months.some(m => m.period === MINULY_ROK), wh.years);

    // [2] Rodičovské bookovanie
    console.log('\n[2] Rodič bookuje dieťa');
    const momId = 'qaFfMama000001';
    const ch = await post('M', '/api/family/children', { name: 'AUDIT Dcérka', birth_date: '2015-05-05' });
    ok('vytvorené dieťa', ch.status === 200, ch.data);
    const kids = (await g('M', '/api/family/children')).data || [];
    const kid = kids.find(k => k.name === 'AUDIT Dcérka');
    ok('dieťa v zozname', !!kid, kids);
    const classes = (await g('M', '/api/classes')).data || [];
    const cls = classes.find(c => c.category === 'Zumba' && c.location === 'Zvolen');
    ok('Zumba Zvolen existuje', !!cls);
    if (!kid || !cls) throw new Error('chýba dieťa alebo hodina — ďalej nemá zmysel pokračovať');
    const nextDate = (d => { do { d.setDate(d.getDate() + 1); } while (d.getDay() !== cls.day_of_week); return den(d); })(new Date());
    const d2 = new Date(nextDate + 'T12:00:00'); d2.setDate(d2.getDate() + 7); const nextDate2 = den(d2);

    // 2a: dieťa má 1. hodinu zdarma → booknuteľné hneď
    const b1 = await post('M', '/api/bookings', { class_id: cls._id, booking_date: nextDate, for_child_id: kid.id });
    ok('1. detská rezervácia (prvá zadarmo)', b1.status === 200, b1.data);
    // tréner vidí, že je to dieťa z rodičovského účtu
    const att = (await g('admin', '/api/attendance/class/' + cls._id + '?date=' + nextDate)).data || [];
    const childRow = att.find(a => a.is_child_booking && a.child_name === 'AUDIT Dcérka');
    ok('tréner vidí dieťa + meno rodiča', childRow && childRow.booked_by_name === 'AUDIT Mama', childRow || att);

    // 2b: druhá rezervácia — dieťa nemá nič, mama BEZ členstva a bez vstupov → 402
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
    await post('M2', '/api/login', { email: 'qaffmama000002@qa-biz.local', password: 'AuditPass123!' });
    await post('admin', '/api/admin/users/qaFfMama000002/grant-membership', { entries: 3, gift: false, payment_method: 'cash' });
    await post('M2', '/api/family/children', { name: 'AUDIT Dcérka2', birth_date: '2016-06-06' });
    const kid2 = ((await g('M2', '/api/family/children')).data || []).find(k => k.name === 'AUDIT Dcérka2');
    ok('druhé dieťa vytvorené', !!kid2);
    if (!kid2) throw new Error('chýba druhé dieťa');
    // minúť prvú hodinu zdarma dieťaťa
    await post('M2', '/api/bookings', { class_id: cls._id, booking_date: nextDate, for_child_id: kid2.id });
    const before = ((await g('M2', '/api/me')).data || {}).single_entries;
    ok('mama má 3 vstupy', before === 3, before);
    const b4 = await post('M2', '/api/bookings', { class_id: cls._id, booking_date: nextDate2, for_child_id: kid2.id });
    ok('rezervácia cez vstup mamy OK', b4.status === 200, b4.data);
    const after = ((await g('M2', '/api/me')).data || {}).single_entries;
    ok('vstup odpočítaný MAME (' + before + '→' + after + ')', after === before - 1, { before, after });
    await spi(300);
    const bk4 = rd('bookings.db').find(b => b.user_id === kid2.id && b.booking_date === nextDate2 && b.status !== 'cancelled');
    ok('rezervácia je krytá vstupom mamy', bk4 && bk4.access_method === 'parent_single_entry', bk4);
    const cancel = await del('M2', '/api/bookings/' + (bk4 && bk4._id));
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
    const tOff = await post('admin', '/api/admin/online-free-day', { on: false });
    ok('vypnutie free dňa', tOff.status === 200 && tOff.data.active === false, tOff.data);
    const oc2 = (await g('M', '/api/online/classes')).data || {};
    ok('po vypnutí opäť bez full prístupu', oc2.access_mode !== 'full', oc2.access_mode);
  } catch (e) {
    FAIL++; FAILS.push({ name: 'výnimka: ' + e.message }); console.log('  ✗ výnimka: ' + e.message);
  } finally {
    srv.kill();
    setTimeout(() => {
      fs.rmSync(DATA, { recursive: true, force: true });
      console.log('\n═══ VÝSLEDOK: ' + PASS + ' PASS, ' + FAIL + ' FAIL ═══');
      if (FAIL) { FAILS.forEach(f => console.log('  FAIL: ' + f.name)); if (chyba) console.log(chyba.slice(-900)); }
      process.exit(FAIL ? 1 : 0);
    }, 500);
  }
})();
