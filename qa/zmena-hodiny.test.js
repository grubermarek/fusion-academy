/**
 * Zmena hodiny → upozornenie rezervovaným (17. 9. 2026, plán 7.3).
 *
 * Dovtedy PUT /api/admin/classes/:id (aj DELETE = vypnutie) len prepísal záznam hodiny
 * a klientka s rezerváciou prišla podľa starého času alebo na staré miesto.
 *
 * Stráži, že:
 *   · zmena kapacity / názvu nikoho neupozorní (zmena je prázdna)
 *   · zmena času upozorní LEN budúce platné rezervácie (oznam + mail), rezervácia
 *     dostane nový čas; odchodená, zrušená ani rezervácia inej hodiny nič nedostanú
 *   · detská rezervácia: oznam ide dieťaťu (rodič ho vidí), mail rodičovi s „👧“
 *   · zmena miesta upozorní a nové miesto je v texte
 *   · zmena dňa presunie rezerváciu na najbližší nový deň (v budúcnosti) a povie to
 *   · jednorazový termín (only_date): posun dátumu presunie rezerváciu naň
 *   · rovnaké hodnoty druhýkrát = žiadny ďalší oznam
 *   · oznam na nástenke mesta pri zmene termínu, nie pri vypnutí hodiny
 *   · vypnutie hodiny (DELETE) zruší budúce rezervácie, vráti vstup z permanentky,
 *     pošle oznam „už nie je v rozvrhu“; minulé rezervácie nechá
 *   · neexistujúca hodina → 404
 *
 * Spustenie:  node qa/zmena-hodiny.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4599;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-zmena-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + (typeof note === 'string' ? note : JSON.stringify(note)) : '')); } };

async function j(url, opts, jar) {
  const headers = { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: (opts && opts.method) || 'GET', headers, body: opts && opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const bk = id => rd('bookings.db').find(b => b._id === id);
const usr = id => rd('users.db').find(u => u._id === id);
const notifs = (uid, type) => rd('notifications.db').filter(n => n.user_id === uid && (!type || n.type === type));
const mails = (to, re) => rd('mail_log.db').filter(m => m.to === to && re.test(m.subject || ''));
const spi = ms => new Promise(r => setTimeout(r, ms));

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const plusDni = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const dnes = new Date(); dnes.setHours(12, 0, 0, 0);
  const DNES = iso(dnes);
  const DATE_A = plusDni(DNES, 3);              // budúci termín hodiny A
  const DOW_A = new Date(DATE_A + 'T12:00:00').getDay();
  const DATE_A_PAST = plusDni(DNES, -4);         // minulý termín (rovnaký deň v týždni)
  const DATE_D = plusDni(DNES, 5);
  const DOW_D = new Date(DATE_D + 'T12:00:00').getDay();
  const DATE_E = plusDni(DNES, 9);               // jednorazová hodina
  const EXP = plusDni(DNES, 30);

  const U = (id, name, email, extra) => JSON.stringify({ _id: id, name, email, password: hash, user_type: 'client', active: true, created_at: '2026-05-01', ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    U('qaZmAdmin000001', 'Adam Admin', 'qa.zm.admin@qa-biz.local', { is_admin: true, user_type: 'admin' }),
    U('qaZmEva00000001', 'Eva Rezervovaná', 'qa.zm.eva@qa-biz.local'),
    U('qaZmTimea000001', 'Tímea Odchodená', 'qa.zm.timea@qa-biz.local'),
    U('qaZmLenka000001', 'Lenka Zrušená', 'qa.zm.lenka@qa-biz.local'),
    U('qaZmZuzana00001', 'Zuzana Iná', 'qa.zm.zuzana@qa-biz.local'),
    U('qaZmRodic000001', 'Renáta Rodičová', 'qa.zm.rodic@qa-biz.local'),
    U('qaZmDieta000001', 'Danka Dieťa', 'dieta.qazm@internal.local', { is_child: true, parent_id: 'qaZmRodic000001' }),
    U('qaZmPetra000001', 'Petra Permanentka', 'qa.zm.petra@qa-biz.local', { single_entries: 2 }),
    U('qaZmOlga0000001', 'Oľga Jednorazová', 'qa.zm.olga@qa-biz.local'),
  ].join('\n') + '\n');
  const C = (id, name, loc, dow, extra) => JSON.stringify({ _id: id, name, emoji: '🎵', category: 'Zumba', instructor: 'Marek Gruber', location: loc, address: loc, day_of_week: dow, time_start: '19:00', time_end: '20:00', capacity: 20, price: 10, active: true, ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'classes.db'), [
    C('qaZmClsA0000001', 'Zumba', 'Zvolen', DOW_A),
    C('qaZmClsB0000001', 'Zumba', 'Brezno', DOW_A),
    C('qaZmClsD0000001', 'Zumba', 'Detva', DOW_D, { time_start: '17:00', time_end: '18:00' }),
    C('qaZmClsE0000001', 'Mimoriadna Zumba', 'Zvolen', new Date(DATE_E + 'T12:00:00').getDay(), { only_date: DATE_E }),
  ].join('\n') + '\n');
  const M = (id, uid) => JSON.stringify({ _id: id, user_id: uid, plan_id: 'bronze', plan_name: 'Bronze', status: 'active', expires_at: EXP, price: 49.9, created_at: '2026-08-10' });
  fs.writeFileSync(path.join(DATA, 'memberships.db'), [
    M('qaZmMemEva00001', 'qaZmEva00000001'), M('qaZmMemTim00001', 'qaZmTimea000001'), M('qaZmMemLen00001', 'qaZmLenka000001'),
    M('qaZmMemZuz00001', 'qaZmZuzana00001'), M('qaZmMemDie00001', 'qaZmDieta000001'), M('qaZmMemOlg00001', 'qaZmOlga0000001'),
  ].join('\n') + '\n');
  const B = (id, uid, cls, date, extra) => JSON.stringify({ _id: id, user_id: uid, class_id: cls, class_name: 'Zumba', class_location: 'Zvolen', class_time_start: '19:00', class_time_end: '20:00', day_of_week: DOW_A, booking_date: date, status: 'confirmed', access_method: 'membership', created_at: DNES + 'T08:00:00.000Z', ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'bookings.db'), [
    B('qaZmBkEva000001', 'qaZmEva00000001', 'qaZmClsA0000001', DATE_A),
    B('qaZmBkTim000001', 'qaZmTimea000001', 'qaZmClsA0000001', DATE_A_PAST, { attendance_status: 'attended', status: 'attended' }),
    B('qaZmBkLen000001', 'qaZmLenka000001', 'qaZmClsA0000001', DATE_A, { status: 'cancelled', cancelled_at: DNES + 'T09:00:00.000Z' }),
    B('qaZmBkZuz000001', 'qaZmZuzana00001', 'qaZmClsB0000001', DATE_A),
    B('qaZmBkDie000001', 'qaZmDieta000001', 'qaZmClsA0000001', DATE_A, { booked_by: 'qaZmRodic000001', is_child_booking: true }),
    B('qaZmBkPet000001', 'qaZmPetra000001', 'qaZmClsD0000001', DATE_D, { access_method: 'single_entry', class_location: 'Detva', class_time_start: '17:00', day_of_week: DOW_D }),
    B('qaZmBkPet000002', 'qaZmPetra000001', 'qaZmClsD0000001', plusDni(DATE_D, -7), { access_method: 'single_entry', attendance_status: 'attended', status: 'attended', class_location: 'Detva', day_of_week: DOW_D }),
    B('qaZmBkOlg000001', 'qaZmOlga0000001', 'qaZmClsE0000001', DATE_E),
  ].join('\n') + '\n');

  console.log('ZMENA HODINY QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await spi(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await spi(6000); // boot migrácie dobehnú

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.zm.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, 'HTTP ' + lg.status);
    ok('seed prežil štart (Eva má rezerváciu na ' + DATE_A + ')', !!bk('qaZmBkEva000001') && bk('qaZmBkEva000001').booking_date === DATE_A);

    // 1) kapacita — nič
    console.log('\n1) Zmena kapacity nikoho neupozorní');
    const r1 = await j('/api/admin/classes/qaZmClsA0000001', { method: 'PUT', body: { capacity: 25, name: 'Zumba' } }, adm);
    await spi(500);
    ok('PUT kapacita 200 a zmena prázdna', r1.status === 200 && r1.d && r1.d.zmena && r1.d.zmena.zmeny.length === 0 && r1.d.zmena.notified === 0, r1.d);
    ok('Eva bez oznamu', notifs('qaZmEva00000001', 'class_changed').length === 0);

    // 2) čas
    console.log('\n2) Zmena času upozorní len budúce platné rezervácie');
    const r2 = await j('/api/admin/classes/qaZmClsA0000001', { method: 'PUT', body: { time_start: '18:00', time_end: '19:00' } }, adm);
    await spi(1200);
    ok('PUT čas 200, zmeny = time_start+time_end, notified 2 (Eva + dieťa), moved 0', r2.status === 200 && r2.d.zmena && r2.d.zmena.zmeny.join() === 'time_start,time_end' && r2.d.zmena.notified === 2 && r2.d.zmena.moved === 0, r2.d);
    const nEva = notifs('qaZmEva00000001', 'class_changed');
    ok('Eva má oznam class_changed s novým časom 18:00 a starým 19:00', nEva.length === 1 && /18:00/.test(nEva[0].body) && /19:00/.test(nEva[0].body) && /platí ďalej/.test(nEva[0].body), nEva[0] && nEva[0].body);
    ok('oznam nesie deň dopočítaný z dátumu (nie ručne)', nEva.length === 1 && nEva[0].body.includes(['nedeľa', 'pondelok', 'utorok', 'streda', 'štvrtok', 'piatok', 'sobota'][DOW_A]), nEva[0] && nEva[0].body);
    ok('Evina rezervácia má nový čas, dátum ostal', bk('qaZmBkEva000001').class_time_start === '18:00' && bk('qaZmBkEva000001').class_time_end === '19:00' && bk('qaZmBkEva000001').booking_date === DATE_A, bk('qaZmBkEva000001'));
    ok('Eve prišiel mail „Zmena hodiny“', mails('qa.zm.eva@qa-biz.local', /^Zmena hodiny/).length === 1, rd('mail_log.db').map(m => m.to + ' | ' + m.subject));
    ok('dieťa má oznam (rodič ho vidí v appke)', notifs('qaZmDieta000001', 'class_changed').length === 1);
    ok('mail za dieťa ide rodičovi s „👧“', mails('qa.zm.rodic@qa-biz.local', /^👧 Danka Dieťa: Zmena hodiny/).length === 1, rd('mail_log.db').map(m => m.to + ' | ' + m.subject));
    ok('odchodená Tímea nič', notifs('qaZmTimea000001').length === 0 && mails('qa.zm.timea@qa-biz.local', /Zmena/).length === 0);
    ok('zrušená Lenka nič', notifs('qaZmLenka000001').length === 0);
    ok('Zuzana z inej hodiny nič', notifs('qaZmZuzana00001', 'class_changed').length === 0 && notifs('qaZmZuzana00001', 'class_cancelled').length === 0, notifs('qaZmZuzana00001').map(n => n.type + ': ' + n.title));
    const feed2 = rd('feed.db').filter(f => f.studio_announcement && /Zmena hodiny — Zvolen/.test(f.text));
    ok('oznam na nástenke mesta Zvolen s oboma časmi', feed2.length === 1 && /19:00/.test(feed2[0].text) && /18:00/.test(feed2[0].text), feed2.map(f => f.text));
    const audit2 = rd('audit.db').filter(a => a.action === 'class_change' && a.target === 'qaZmClsA0000001');
    ok('audit class_change zapísaný', audit2.length === 1, audit2);

    // 3) miesto
    console.log('\n3) Zmena miesta');
    const r3 = await j('/api/admin/classes/qaZmClsA0000001', { method: 'PUT', body: { location: 'Sliač' } }, adm);
    await spi(1000);
    const nEva3 = notifs('qaZmEva00000001', 'class_changed');
    ok('PUT miesto: notified 2', r3.status === 200 && r3.d.zmena.zmeny.join() === 'location' && r3.d.zmena.notified === 2, r3.d);
    ok('Eva má druhý oznam so Sliačom, rezervácia má nové miesto', nEva3.length === 2 && /Sliač/.test(nEva3[1].body) && bk('qaZmBkEva000001').class_location === 'Sliač', nEva3.map(n => n.body));

    // 4) deň
    console.log('\n4) Zmena dňa presunie rezerváciu');
    const NEW_DOW = (DOW_A + 2) % 7;
    const r4 = await j('/api/admin/classes/qaZmClsA0000001', { method: 'PUT', body: { day_of_week: NEW_DOW } }, adm);
    await spi(1000);
    const evaBk4 = bk('qaZmBkEva000001');
    ok('PUT deň: notified 2, moved 2', r4.status === 200 && r4.d.zmena.notified === 2 && r4.d.zmena.moved === 2, r4.d);
    ok('Evina rezervácia presunutá o 2 dni na nový deň', evaBk4.booking_date === plusDni(DATE_A, 2) && evaBk4.day_of_week === NEW_DOW && evaBk4.moved_from_date === DATE_A, evaBk4);
    const nEva4 = notifs('qaZmEva00000001', 'class_changed');
    ok('oznam hovorí o presune', nEva4.length === 3 && /presunutá/.test(nEva4[2].body), nEva4[2] && nEva4[2].body);
    ok('rezervácia ostáva v budúcnosti', evaBk4.booking_date >= DNES);

    // 5) to isté ešte raz
    console.log('\n5) Rovnaké hodnoty = žiadny oznam');
    const r5 = await j('/api/admin/classes/qaZmClsA0000001', { method: 'PUT', body: { day_of_week: NEW_DOW, time_start: '18:00', location: 'Sliač' } }, adm);
    await spi(500);
    ok('druhý PUT s tými istými hodnotami nič neurobí', r5.status === 200 && r5.d.zmena.zmeny.length === 0 && notifs('qaZmEva00000001', 'class_changed').length === 3, r5.d);
    ok('stále jeden oznam na nástenke', rd('feed.db').filter(f => f.studio_announcement && /Zmena hodiny/.test(f.text)).length === 3, rd('feed.db').filter(f => f.studio_announcement).length);

    // 6) jednorazový termín
    console.log('\n6) Jednorazová hodina: posun only_date');
    const r6 = await j('/api/admin/classes/qaZmClsE0000001', { method: 'PUT', body: { only_date: plusDni(DATE_E, 1), day_of_week: new Date(plusDni(DATE_E, 1) + 'T12:00:00').getDay() } }, adm);
    await spi(800);
    ok('Oľgina rezervácia presunutá na nový dátum', r6.status === 200 && r6.d.zmena.moved === 1 && bk('qaZmBkOlg000001').booking_date === plusDni(DATE_E, 1), { r: r6.d, b: bk('qaZmBkOlg000001') });

    // 7) vypnutie hodiny
    console.log('\n7) Vypnutie hodiny zruší budúce rezervácie a vráti vstup');
    const petraPred = usr('qaZmPetra000001').single_entries;
    const r7 = await j('/api/admin/classes/qaZmClsD0000001', { method: 'DELETE' }, adm);
    await spi(1200);
    ok('DELETE: cancelled 1, refunded 1', r7.status === 200 && r7.d.zmena && r7.d.zmena.zmeny.join() === 'active' && r7.d.zmena.cancelled === 1 && r7.d.zmena.refunded === 1, r7.d);
    ok('hodina vypnutá', rd('classes.db').find(c => c._id === 'qaZmClsD0000001').active === false);
    ok('budúca rezervácia cancelled_studio, minulá odchodená ostala', bk('qaZmBkPet000001').status === 'cancelled_studio' && bk('qaZmBkPet000002').status === 'attended', [bk('qaZmBkPet000001').status, bk('qaZmBkPet000002').status]);
    ok('Petre sa vrátil vstup z permanentky (+1)', usr('qaZmPetra000001').single_entries === petraPred + 1, [petraPred, usr('qaZmPetra000001').single_entries]);
    const nPet = notifs('qaZmPetra000001', 'class_cancelled');
    ok('Petra má oznam „už nie je v rozvrhu“ s vrátením vstupu', nPet.length === 1 && /už nie je v rozvrhu/.test(nPet[0].body) && /vstup z permanentky/.test(nPet[0].body), nPet[0] && nPet[0].body);
    ok('Petre prišiel mail', mails('qa.zm.petra@qa-biz.local', /^Hodina zrušená/).length === 1);
    ok('vypnutie hodiny nepíše na nástenku', rd('feed.db').filter(f => f.studio_announcement && /Detva/.test(f.text)).length === 0);
    ok('audit class_deactivate', rd('audit.db').some(a => a.action === 'class_deactivate' && a.target === 'qaZmClsD0000001'));
    const r7b = await j('/api/admin/classes/qaZmClsD0000001', { method: 'DELETE' }, adm);
    await spi(400);
    ok('druhé vypnutie už nič nezruší', r7b.status === 200 && r7b.d.zmena && r7b.d.zmena.cancelled === 0 && notifs('qaZmPetra000001', 'class_cancelled').length === 1, r7b.d);

    // 8) neexistujúca
    console.log('\n8) Neexistujúca hodina');
    const r8 = await j('/api/admin/classes/qaZmNeexistuje1', { method: 'PUT', body: { time_start: '10:00' } }, adm);
    ok('PUT na neexistujúcu hodinu → 404', r8.status === 404, 'HTTP ' + r8.status);
    const r9 = await j('/api/admin/classes/qaZmClsA0000001', { method: 'PUT', body: { time_start: '10:00' } });
    ok('bez prihlásenia PUT odmietnutý', r9.status === 401 || r9.status === 403, 'HTTP ' + r9.status);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    srv.kill();
    await spi(400);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nZMENA HODINY: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-800));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
