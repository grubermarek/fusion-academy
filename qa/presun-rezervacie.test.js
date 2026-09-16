/**
 * Presun rezervácie a zápis darovanej hodiny zo štúdia (Marek 16. 9. 2026:
 * „Klincovú a Rigovú preložiť z nedele na piatok (Detva)").
 *
 * Spustenie:  node qa/presun-rezervacie.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');

const PORT = 4608;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-presun-'));
const TOKEN = 'qa-presun-token';
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const sluzba = (cesta, body) => fetch(BASE + '/api/service/' + cesta, { method: 'POST', headers: { 'x-import-token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, d: await r.json().catch(() => null) }));
// najbližší deň v týždni (0 = nedeľa) od zajtra
const najblizsi = dow => { const d = new Date(); d.setUTCHours(12, 0, 0, 0); do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== dow); return d.toISOString().slice(0, 10); };

(async () => {
  const NED = najblizsi(0), PIA = najblizsi(5), SOB = najblizsi(6);
  const trieda = (id, dow, meno) => ({ _id: id, name: meno, emoji: '🔥', category: 'Technika', location: 'Detva', address: 'Detva', day_of_week: dow, time_start: '18:00', time_end: '19:00', capacity: 2, active: true, price: 10 });
  w('classes.db', [trieda('qaPrNedela00001', 0, 'Technický tréning'), trieda('qaPrPiatok00001', 5, 'Technický tréning')]);
  const U = (id, meno) => ({ _id: id, name: meno, email: id.toLowerCase() + '@qa-biz.local', user_type: 'client', active: true, created_at: '2026-09-01', referral_code: 'QPR' + id.slice(4, 9).toUpperCase() + id.slice(-1), free_class_used: true });
  w('users.db', [U('qaPrRadka000001', 'Radka Presunová'), U('qaPrSofia000001', 'Sofia Darovaná'), U('qaPrIna00000001', 'Iná Klientka'), U('qaPrIna00000002', 'Druhá Klientka')]);
  const B = (id, uid, meno, cls, datum, extra) => ({ _id: id, class_id: cls, class_name: 'Technický tréning', class_emoji: '🔥', class_location: 'Detva', class_time_start: '18:00', class_time_end: '19:00',
    day_of_week: cls === 'qaPrNedela00001' ? 0 : 5, day_name: cls === 'qaPrNedela00001' ? 'Nedeľa' : 'Piatok', user_id: uid, user_name: meno, booking_date: datum,
    status: 'confirmed', access_method: 'free_class', free_class: true, created_at: '2026-09-14T06:18:00.000Z', ...(extra || {}) });
  w('bookings.db', [
    B('qaPrBookRadka01', 'qaPrRadka000001', 'Radka Presunová', 'qaPrNedela00001', NED),
    B('qaPrBookBola001', 'qaPrSofia000001', 'Sofia Darovaná', 'qaPrNedela00001', '2026-09-13', { status: 'attended', attendance_status: 'attended' }),
    B('qaPrBookIna0001', 'qaPrIna00000001', 'Iná Klientka', 'qaPrPiatok00001', PIA),
  ]);

  console.log('PRESUN REZERVÁCIE\n');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TZ: 'UTC', PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', IMPORT_TOKEN: TOKEN },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/api/config'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 800)); process.exit(1); }
  await sleep(1500);
  try {
    const bk = id => rd('bookings.db').find(b => b._id === id);
    ok('bez tokenu 404', (await fetch(BASE + '/api/service/booking-move', { method: 'POST' })).status === 404);
    const zlyDen = await sluzba('booking-move', { booking_id: 'qaPrBookRadka01', class_id: 'qaPrPiatok00001', date: SOB });
    ok('piatková hodina na sobotu → 400 s vysvetlením', zlyDen.status === 400 && /Piatok/.test(zlyDen.d.error), JSON.stringify(zlyDen.d));
    const minulost = await sluzba('booking-move', { booking_id: 'qaPrBookRadka01', class_id: 'qaPrPiatok00001', date: '2026-01-02' });
    ok('dátum v minulosti → 400', minulost.status === 400);
    const bola = await sluzba('booking-move', { booking_id: 'qaPrBookBola001', class_id: 'qaPrPiatok00001', date: PIA });
    ok('hodinu, na ktorej už bola, nepresunie', bola.status === 400 && /už bola/.test(bola.d.error));
    const p = await sluzba('booking-move', { booking_id: 'qaPrBookRadka01', class_id: 'qaPrPiatok00001', date: PIA });
    ok('presun prešiel', p.status === 200 && p.d.ok, JSON.stringify(p.d));
    await sleep(500);
    const r = bk('qaPrBookRadka01');
    ok('rezervácia je na piatok, iná hodina, deň aj názov dňa', r.class_id === 'qaPrPiatok00001' && r.booking_date === PIA && r.day_of_week === 5 && r.day_name === 'Piatok', JSON.stringify(r));
    ok('prvá hodina zadarmo ostáva', r.access_method === 'free_class' && r.free_class === true && r.status === 'confirmed');
    ok('pamätá si, odkiaľ sa presúvala', r.moved_from && r.moved_from.booking_date === NED && r.moved_from.class_id === 'qaPrNedela00001');
    const n = rd('notifications.db').find(x => x.user_id === 'qaPrRadka000001' && /presunutá/.test(x.title));
    ok('klientka dostala oznam v appke', n && /piatok/.test(n.body) && /namiesto nedeľa/.test(n.body), n && n.body);
    ok('žiadny mail', !rd('mail_log.db').length);
    const dup = await sluzba('booking-move', { booking_id: 'qaPrBookIna0001', class_id: 'qaPrPiatok00001', date: PIA });
    ok('presun na tú istú hodinu → zrozumiteľná chyba', dup.status === 400 && /už je na tejto hodine/.test(dup.d.error), JSON.stringify(dup.d));

    const s = await sluzba('book-attend', { user_id: 'qaPrSofia000001', class_id: 'qaPrPiatok00001', date: PIA, attended: false, access_method: 'free', pay_on_site: false, notes: '🎁 Hodina zadarmo (Marek)' });
    ok('zápis zadarmo prešiel', s.status === 200, JSON.stringify(s.d));
    await sleep(500);
    const sb = rd('bookings.db').find(b => b.user_id === 'qaPrSofia000001' && b.booking_date === PIA);
    ok('rezervácia zadarmo: potvrdená, bez platby na mieste, darovaná', sb && sb.status === 'confirmed' && sb.access_method === 'free' && sb.free_class === true && !sb.pay_on_site && sb.notes === '🎁 Hodina zadarmo (Marek)', JSON.stringify(sb));
    const sn = rd('notifications.db').find(x => x.user_id === 'qaPrSofia000001');
    ok('Sofia dostala potvrdenie v appke', sn && /zadarmo/.test(sn.body) && /piatok/.test(sn.body), sn && sn.body);
    const plna = await sluzba('book-attend', { user_id: 'qaPrIna00000002', class_id: 'qaPrPiatok00001', date: PIA, attended: false, access_method: 'free' });
    ok('zápis zo štúdia kapacitu nekontroluje (ako doteraz) — len informácia', plna.status === 200);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    srv.kill(); await sleep(500);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nPRESUN REZERVÁCIE: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-800));
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
  }
})();
