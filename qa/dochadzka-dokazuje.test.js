/**
 * Účasť sa dokazuje, nepredpokladá (Marek 1. 9.).
 *
 * Doteraz platilo: tréner potvrdí hodinu → všetci prihlásení dostanú návštevu
 * aj body, aj keď na hodine nikto nebol. Marek to chce naopak — kto sa nezapíše
 * QR kódom a koho tréner ručne neoznačí, má NEPRIŠLA. „Smola."
 *
 * Test stráži hlavne to, čím sa dá rozdať účasť zadarmo alebo ju naopak zobrať:
 *   · potvrdenie hodiny bez označenia → nikto nedostane návštevu
 *   · kto sa zapísal QR kódom, návštevu si ponechá a nepripíše sa mu druhýkrát
 *   · koho tréner označí, dostane návštevu aj body
 *   · druhé kliknutie na „potvrdiť" nezvýši no_show_count znova
 *   · no_show sa neráta do bodov ani do odchodených hodín
 *
 * Spustenie:  node qa/dochadzka-dokazuje.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4568;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-doch-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const DOW = new Date(DNES + 'T12:00:00').getDay();

  let kod = 0;
  const K = (id, meno, extra = {}) => JSON.stringify({ _id: id, name: meno, email: id.toLowerCase() + '@qa-biz.local',
    password: hash, user_type: 'client', active: true, referral_code: 'QADCH' + String(++kod).padStart(2, '0'),
    visit_count: 5, created_at: '2026-06-01', city: 'Detva', no_show_count: 0, single_entries: 3, ...extra });

  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaDchTrener0001', name: 'Tina Trenerka', email: 'qa.dch.trener@qa-biz.local',
      password: hash, user_type: 'trainer', active: true, created_at: '2026-01-01' }),
    JSON.stringify({ _id: 'qaDchAdmin00001', name: 'Adam Admin', email: 'qa.dch.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }),
    K('qaDchQr00000001', 'Qveta Qerkova'),      // zapísala sa QR kódom
    K('qaDchRucne00001', 'Rena Rucna'),         // tréner ju označí ručne
    K('qaDchNepri00001', 'Nina Neprisla'),      // neprišla
    K('qaDchNepri00002', 'Dana Neprisla'),      // tiež neprišla
  ].join('\n') + '\n');

  fs.writeFileSync(path.join(DATA, 'classes.db'),
    JSON.stringify({ _id: 'qaDchTrieda0001', name: 'Zumba QA', emoji: '💃', day_of_week: DOW,
      time_start: '18:00', time_end: '19:00', location: 'Detva', address: 'Nám. 1', capacity: 20,
      instructor: 'Tina Trenerka', category: 'Zumba', active: true }) + '\n');

  const bk = (id, uid, meno, extra = {}) => JSON.stringify({ _id: id, class_id: 'qaDchTrieda0001',
    class_name: 'Zumba QA', class_location: 'Detva', class_time_start: '18:00', day_of_week: DOW,
    user_id: uid, user_name: meno, user_email: uid.toLowerCase() + '@qa-biz.local',
    booking_date: DNES, status: 'confirmed', attendance_status: 'pending',
    access_method: 'single_entry', created_at: DNES + 'T10:00:00.000Z', ...extra });

  fs.writeFileSync(path.join(DATA, 'bookings.db'), [
    // QR check-in už prebehol — status attended, návštevu má
    bk('qaDchB000000001', 'qaDchQr00000001', 'Qveta Qerkova',
      { status: 'attended', attendance_status: 'attended', attendance_source: 'qr', attended_at: DNES + 'T18:05:00.000Z' }),
    bk('qaDchB000000002', 'qaDchRucne00001', 'Rena Rucna'),
    bk('qaDchB000000003', 'qaDchNepri00001', 'Nina Neprisla'),
    bk('qaDchB000000004', 'qaDchNepri00002', 'Dana Neprisla'),
  ].join('\n') + '\n');

  console.log('DOCHÁDZKA SA DOKAZUJE — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  const bkg = id => rd('bookings.db').find(b => b._id === id) || {};
  const usr = id => rd('users.db').find(u => u._id === id) || {};

  try {
    const tr = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.dch.trener@qa-biz.local', password: 'Heslo123!' } }, tr);
    ok('trénerka prihlásená', lg.status === 200, JSON.stringify(lg.d));

    const vcPred = { qr: usr('qaDchQr00000001').visit_count, rucne: usr('qaDchRucne00001').visit_count,
      nepri: usr('qaDchNepri00001').visit_count };

    console.log('\nTréner potvrdí hodinu a NIKOHO neoznačí:');
    const r1 = await j('/api/attendance/confirm-session', { method: 'POST',
      body: { class_id: 'qaDchTrieda0001', date: DNES, present_ids: [] } }, tr);
    ok('hodina sa potvrdí', r1.status === 200 && r1.d && r1.d.ok, JSON.stringify(r1.d).slice(0, 120));
    await new Promise(r => setTimeout(r, 700));

    ok('nikto nedostal návštevu navyše', r1.d && r1.d.credited === 0, 'credited=' + (r1.d && r1.d.credited));
    ok('a traja dostali NEPRIŠLA', r1.d && r1.d.no_shows === 3, 'no_shows=' + (r1.d && r1.d.no_shows));
    ok('Rena, ktorú nikto neoznačil, má neprišla', bkg('qaDchB000000002').attendance_status === 'no_show',
      String(bkg('qaDchB000000002').attendance_status));
    ok('a nepribudla jej návšteva', usr('qaDchRucne00001').visit_count === vcPred.rucne,
      vcPred.rucne + ' → ' + usr('qaDchRucne00001').visit_count);
    ok('Nina má neprišla', bkg('qaDchB000000003').attendance_status === 'no_show');
    ok('a zvýšil sa jej počet neúčastí', usr('qaDchNepri00001').no_show_count === 1,
      String(usr('qaDchNepri00001').no_show_count));

    console.log('\nKto sa zapísal QR kódom:');
    ok('ostáva zapísaná ako prítomná', bkg('qaDchB000000001').attendance_status === 'attended',
      String(bkg('qaDchB000000001').attendance_status));
    ok('zdroj ostal QR, neprepísal ho tréner', bkg('qaDchB000000001').attendance_source === 'qr',
      String(bkg('qaDchB000000001').attendance_source));
    ok('a návšteva sa jej nepripísala druhýkrát', usr('qaDchQr00000001').visit_count === vcPred.qr,
      vcPred.qr + ' → ' + usr('qaDchQr00000001').visit_count);

    console.log('\nDruhé kliknutie na „potvrdiť" (tréner sa preklikne):');
    const r2 = await j('/api/attendance/confirm-session', { method: 'POST',
      body: { class_id: 'qaDchTrieda0001', date: DNES, present_ids: [] } }, tr);
    await new Promise(r => setTimeout(r, 700));
    ok('neúčasť sa nezapočíta druhýkrát', usr('qaDchNepri00001').no_show_count === 1,
      'no_show_count=' + usr('qaDchNepri00001').no_show_count);
    ok('a hodina hlási, že sa nič nezmenilo', r2.d && r2.d.already === true, JSON.stringify(r2.d).slice(0, 100));
    const notif = rd('notifications.db').filter(n => n.type === 'no_show' && n.user_id === 'qaDchNepri00001');
    ok('klientka nedostane druhú notifikáciu', notif.length === 1, notif.length + '×');

    console.log('\nTréner dodatočne označí Renu, že tu predsa bola:');
    const r3 = await j('/api/attendance/confirm-session', { method: 'POST',
      body: { class_id: 'qaDchTrieda0001', date: DNES, present_ids: ['qaDchB000000002'] } }, tr);
    await new Promise(r => setTimeout(r, 700));
    ok('oprava prejde', r3.status === 200 && r3.d && r3.d.credited === 1, JSON.stringify(r3.d).slice(0, 110));
    ok('Rena má zapísanú účasť', bkg('qaDchB000000002').attendance_status === 'attended',
      String(bkg('qaDchB000000002').attendance_status));
    ok('pribudla jej návšteva', usr('qaDchRucne00001').visit_count === vcPred.rucne + 1,
      vcPred.rucne + ' → ' + usr('qaDchRucne00001').visit_count);
    ok('a neúčasť sa jej odpočítala', (usr('qaDchRucne00001').no_show_count || 0) === 0,
      String(usr('qaDchRucne00001').no_show_count));

    console.log('\nBody do súťaže:');
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.dch.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    const body = (await j('/api/points/summary', {}, adm)).d;
    const riadok = n => (body && Array.isArray(body.list) ? body.list : Array.isArray(body) ? body : [])
      .find(x => String(x.name || '').includes(n));
    const nina = riadok('Nina');
    ok('kto neprišiel, nemá za hodinu body', !nina || !(nina.points > 0) || nina.hours === 0,
      nina ? JSON.stringify(nina).slice(0, 110) : 'v rebríčku nie je — správne');

    console.log('\nStaršia otvorená karta (posiela zoznam neprítomných):');
    const r4 = await j('/api/attendance/confirm-session', { method: 'POST',
      body: { class_id: 'qaDchTrieda0001', date: DNES, absent_ids: ['qaDchB000000003'] } }, tr);
    ok('server ju stále obslúži', r4.status === 200 && r4.d && r4.d.ok, JSON.stringify(r4.d).slice(0, 110));
    await new Promise(r => setTimeout(r, 700));
    ok('Dana, ktorá v zozname neprítomných nebola, dostane účasť',
      bkg('qaDchB000000004').attendance_status === 'attended', String(bkg('qaDchB000000004').attendance_status));

    console.log('\nRequest bez oboch zoznamov (stará verzia stránky):');
    const r5 = await j('/api/attendance/confirm-session', { method: 'POST',
      body: { class_id: 'qaDchTrieda0001', date: DNES } }, tr);
    ok('server ho odmietne, nech nikoho omylom neoznačí', r5.status === 400,
      'HTTP ' + r5.status + ' ' + JSON.stringify(r5.d).slice(0, 90));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nDOCHÁDZKA: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
