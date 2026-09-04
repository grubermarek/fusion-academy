/**
 * Okrajové prípady REZERVÁCIÍ — audit súbehov a validácií (3. 9. 2026).
 *
 * NeDB nemá transakcie ani atomické „skontroluj a zapíš", takže každá kontrola
 * v POST /api/bookings (duplicita, kapacita, vstup z permanentky, prvá hodina
 * zdarma) je „prečítaj → over → zapíš" a medzi čítaním a zápisom sa môže
 * vkliniť paralelná požiadavka (dvojklik, dva taby, dve klientky naraz).
 * Tento test NIČ neopravuje — len nahlási, čo padá.
 *
 * Stráži, že:
 *   0. seed prežije štart servera (kapacita hodiny, vstupy, prvá hodina zdarma)
 *   1. dvojklik / 8 paralelných rezervácií tej istej hodiny → práve 1 rezervácia
 *   2. hodina s kapacitou 2 a 6 klientok naraz → najviac 2 potvrdené
 *   3. permanentka s 1 vstupom a 5 hodín naraz → vstupy nikdy < 0
 *      a rezervácií len toľko, koľko vstupov ubudlo
 *   4. prvá hodina zdarma 5× naraz → len 1 rezervácia zdarma
 *   5. dvojité storno vráti vstup len raz; cudziu rezerváciu zrušiť nejde
 *   6. zrušená hodina, minulý dátum a dátum mimo dňa hodiny sa odmietnu
 *   7. neexistujúce / nezmyselné class_id → 400/404, nie 500, a žiadny zápis
 *
 * Paralelné dávky idú cez vopred otvorené keep-alive spojenia (zahrej), aby
 * požiadavky naozaj dorazili naraz — tak ako z dvoch tabov prehliadača.
 * Server beží s MAIL_CAPTURE=1 → maily sa len logujú, nič neodíde.
 * Volá sa výhradne localhost.
 *
 * Spustenie:  node qa/edge-rezervacie.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4581;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-edge-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const info = s => console.log('     · ' + s);

async function j(url, opts, jar) {
  const headers = { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: (opts && opts.method) || 'GET', headers, body: opts && opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const user = id => rd('users.db').find(u => u._id === id) || {};
const trieda = id => rd('classes.db').find(c => c._id === id) || {};
const aktivne = (uid, cls, date) => rd('bookings.db').filter(b => b.user_id === uid && (!cls || b.class_id === cls) && (!date || b.booking_date === date) && b.status !== 'cancelled');
const maily = (to, re) => rd('mail_log.db').filter(m => m.to === to && (!re || re.test(m.subject || '')));
const cakaj = ms => new Promise(r => setTimeout(r, ms));
const stavy = rs => 'HTTP ' + rs.map(r => r.status).join(',');
const kratko = d => JSON.stringify(d || null).slice(0, 110);
// Otvorí n keep-alive spojení pre daný účet, aby nasledujúca paralelná dávka
// odišla naraz (fetch inak pre 2.–n. požiadavku nadväzuje nové TCP spojenie).
const zahrej = (jar, n) => Promise.all(Array.from({ length: n }, () => j('/api/membership', {}, jar)));
// Paralelná dávka s časom dokončenia každej odpovede (ms od štartu dávky) — dôkaz,
// že požiadavky bežali naraz a nie za sebou.
async function davka(volania) { const t = Date.now(); return Promise.all(volania.map(f => f().then(r => ({ ...r, ms: Date.now() - t })))); }
const casy = rs => 'dokončené po ms: ' + rs.map(r => r.ms).join(',');

// Dátumy: všetky testovacie hodiny majú day_of_week = dnešný deň. Najbližší
// BUDÚCI výskyt toho dňa je o týždeň (dnešok by mohol byť v 3h storno okne
// alebo už po hodine). Rovnako ako displayNextDateForDay() sa počíta lokálny čas.
const isoLocal = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const plusDni = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoLocal(d); };
const DOW = new Date().getDay();
const TERMIN = plusDni(7);    // najbližší budúci výskyt dňa hodiny
const TERMIN2 = plusDni(14);  // ďalší výskyt (pre injekčný test bez zrušenej hodiny)
const MINULY = plusDni(-7);   // ten istý deň v týždni, pred týždňom
const INY_DEN = plusDni(8);   // dátum, ktorý na deň hodiny nesedí

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zaMesiac = new Date(); zaMesiac.setDate(zaMesiac.getDate() + 30);
  const EXP = zaMesiac.toISOString().slice(0, 10);

  // Klientky majú prvú hodinu zdarma už využitú (free_class_used:true) — gate
  // členstvo/vstupy tak platí. Lead ju využitú nemá.
  const U = (id, name, email, extra) => JSON.stringify({ _id: id, name, email, password: hash, user_type: 'client', active: true, free_class_used: true, created_at: '2026-05-01', ...(extra || {}) });
  const KAP = [1, 2, 3, 4, 5, 6].map(n => ({ id: 'qaEdgeKap0000' + n, email: 'qa.edge.kap' + n + '@qa-biz.local' }));
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    U('qaEdgeAdmin0001', 'Adam Admin', 'qa.edge.admin@qa-biz.local', { is_admin: true, user_type: 'admin' }),
    U('qaEdgeAnna00001', 'Anna Dvojklik', 'qa.edge.anna@qa-biz.local'),
    ...KAP.map((k, i) => U(k.id, 'Klientka K' + (i + 1), k.email)),
    U('qaEdgePerm00001', 'Petra Permanentka', 'qa.edge.perm@qa-biz.local', { single_entries: 1 }),
    U('qaEdgePerm00002', 'Paula Permanentka', 'qa.edge.perm2@qa-biz.local', { single_entries: 1 }),
    U('qaEdgeLead00001', 'Lenka Lead', 'qa.edge.lead@qa-biz.local', { user_type: 'lead', free_class_used: false }),
    U('qaEdgeStoA00001', 'Soňa Storno', 'qa.edge.stoa@qa-biz.local', { single_entries: 0 }),
    U('qaEdgeStoB00001', 'Beáta Cudzia', 'qa.edge.stob@qa-biz.local'),
    U('qaEdgeZita00001', 'Zita Zrušená', 'qa.edge.zita@qa-biz.local'),
  ].join('\n') + '\n');

  const C = (id, name, extra) => JSON.stringify({ _id: id, name, emoji: '🎵', category: 'Zumba', instructor: 'Marek Gruber', location: 'Zvolen', address: 'Zvolen', day_of_week: DOW, time_start: '19:00', time_end: '20:00', capacity: 20, price: 10, active: true, ...(extra || {}) });
  const P = [1, 2, 3, 4, 5].map(n => 'qaEdgeClsP0000' + n);
  fs.writeFileSync(path.join(DATA, 'classes.db'), [
    C('qaEdgeClsDvoj01', 'Zumba dvojklik'),
    C('qaEdgeClsKap001', 'Zumba kapacita', { capacity: 2 }),
    ...P.map((id, i) => C(id, 'Zumba P' + (i + 1), { time_start: String(15 + i).padStart(2, '0') + ':00', time_end: String(16 + i).padStart(2, '0') + ':00' })),
    C('qaEdgeClsZrus01', 'Zumba zrušená'),
    C('qaEdgeClsSto001', 'Zumba storno'),
  ].join('\n') + '\n');

  const M = (id, uid) => JSON.stringify({ _id: id, user_id: uid, plan_id: 'bronze', plan_name: 'Bronze', status: 'active', expires_at: EXP, price: 50, created_at: '2026-08-10' });
  fs.writeFileSync(path.join(DATA, 'memberships.db'), [
    M('qaEdgeMemAnna01', 'qaEdgeAnna00001'),
    ...KAP.map((k, i) => M('qaEdgeMemKap00' + (i + 1), k.id)),
    M('qaEdgeMemZita01', 'qaEdgeZita00001'),
  ].join('\n') + '\n');

  // Soňa má 2 rezervácie: jednu skúsi zrušiť Beáta (cudzia), druhú (zaplatenú
  // vstupom z permanentky, vstup už odpočítaný → single_entries:0) zruší Soňa 2× naraz.
  const B = (id, uid, cls, date, extra) => JSON.stringify({ _id: id, user_id: uid, class_id: cls, class_name: 'Zumba', booking_date: date, status: 'confirmed', access_method: 'membership', created_at: '2026-09-01T08:00:00.000Z', ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'bookings.db'), [
    B('qaEdgeBkCudz001', 'qaEdgeStoA00001', 'qaEdgeClsP00001', TERMIN),
    B('qaEdgeBkDvoj001', 'qaEdgeStoA00001', 'qaEdgeClsSto001', TERMIN, { access_method: 'single_entry' }),
  ].join('\n') + '\n');

  fs.writeFileSync(path.join(DATA, 'class_cancellations.db'), JSON.stringify({ _id: 'qaEdgeCanc00001', class_id: 'qaEdgeClsZrus01', date: TERMIN, class_name: 'Zumba zrušená', location: 'Zvolen', reason: 'QA', created_at: '2026-09-01T08:00:00.000Z' }) + '\n');

  console.log('OKRAJOVÉ PRÍPADY REZERVÁCIÍ QA — štart servera… (termín ' + TERMIN + ', deň ' + DOW + ')');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await cakaj(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  try {
    console.log('\n0) Prihlásenie a stav seedu po štarte:');
    const login = async (email) => { const jar = {}; const r = await j('/api/login', { method: 'POST', body: { email, password: 'Heslo123!' } }, jar); if (r.status !== 200) throw new Error('login ' + email + ' HTTP ' + r.status + ' ' + kratko(r.d)); return jar; };
    const adm = await login('qa.edge.admin@qa-biz.local');
    const anna = await login('qa.edge.anna@qa-biz.local');
    const kap = []; for (const k of KAP) kap.push(await login(k.email));
    const perm = await login('qa.edge.perm@qa-biz.local');
    const perm2 = await login('qa.edge.perm2@qa-biz.local');
    const lead = await login('qa.edge.lead@qa-biz.local');
    const stoA = await login('qa.edge.stoa@qa-biz.local');
    const stoB = await login('qa.edge.stob@qa-biz.local');
    const zita = await login('qa.edge.zita@qa-biz.local');
    ok('13 účtov prihlásených', !!(adm.cookie && anna.cookie && perm.cookie && perm2.cookie && lead.cookie && stoA.cookie && stoB.cookie && zita.cookie && kap.every(x => x.cookie)));
    ok('seed po štarte nedotknutý (Petra 1 vstup, Lenka bez využitej prvej hodiny)', user('qaEdgePerm00001').single_entries === 1 && user('qaEdgeLead00001').free_class_used === false,
      'single_entries=' + user('qaEdgePerm00001').single_entries + ', free_class_used=' + user('qaEdgeLead00001').free_class_used);
    ok('seedovaná kapacita 2 hodiny „Zumba kapacita" prežila štart servera', trieda('qaEdgeClsKap001').capacity === 2, 'po štarte je capacity=' + trieda('qaEdgeClsKap001').capacity + ' (štartová migrácia prepisuje kapacitu neonline hodín)');

    console.log('\n1) Dvojklik / dva taby — 8× paralelne tá istá hodina, klientka s členstvom:');
    await zahrej(anna, 8);
    const r1 = await davka(Array.from({ length: 8 }, () => () => j('/api/bookings', { method: 'POST', body: { class_id: 'qaEdgeClsDvoj01', booking_date: TERMIN } }, anna)));
    await cakaj(600);
    const bk1 = aktivne('qaEdgeAnna00001', 'qaEdgeClsDvoj01', TERMIN);
    const ok1 = r1.filter(r => r.status === 200).length;
    info(stavy(r1) + ' · ' + casy(r1) + ' · v DB aktívnych ' + bk1.length + ' · mailov pre Annu ' + maily('qa.edge.anna@qa-biz.local').length);
    ok('v bookings.db je pre ňu práve 1 aktívna rezervácia', bk1.length === 1, 'v DB je ' + bk1.length + ' aktívnych rezervácií tej istej hodiny');
    ok('server potvrdil (HTTP 200) práve jednu, ostatné odmietol 400 „už prihlásená"', ok1 === 1, 'HTTP 200 × ' + ok1 + ' z 8');
    ok('žiadna odpoveď nebola 500', r1.every(r => r.status !== 500), stavy(r1));
    ok('odišiel by len 1 potvrdzovací mail', maily('qa.edge.anna@qa-biz.local').length === 1, 'v mail_log je ' + maily('qa.edge.anna@qa-biz.local').length + ' mailov pre Annu (zachytené, neodoslané)');

    console.log('\n2) Plná kapacita pri súbehu — admin nastaví capacity:2, 6 klientok s členstvom naraz:');
    const kapSet = await j('/api/admin/classes/qaEdgeClsKap001', { method: 'PUT', body: { capacity: 2 } }, adm);
    await cakaj(300);
    ok('admin nastavil kapacitu 2 (PUT /api/admin/classes/:id)', kapSet.status === 200 && trieda('qaEdgeClsKap001').capacity === 2, 'HTTP ' + kapSet.status + ', capacity=' + trieda('qaEdgeClsKap001').capacity);
    await Promise.all(kap.map(jar => zahrej(jar, 1)));
    const r2 = await davka(kap.map(jar => () => j('/api/bookings', { method: 'POST', body: { class_id: 'qaEdgeClsKap001', booking_date: TERMIN } }, jar)));
    await cakaj(600);
    const bk2 = rd('bookings.db').filter(b => b.class_id === 'qaEdgeClsKap001' && b.booking_date === TERMIN && b.status !== 'cancelled');
    const ok2 = r2.filter(r => r.status === 200).length;
    info(stavy(r2) + ' · ' + casy(r2) + ' · v DB aktívnych ' + bk2.length + ' na kapacite ' + trieda('qaEdgeClsKap001').capacity);
    ok('najviac 2 aktívne rezervácie (kapacita 2)', bk2.length <= 2, 'v DB je ' + bk2.length + ' aktívnych rezervácií na hodine s kapacitou 2');
    ok('server potvrdil najviac 2 klientky', ok2 <= 2, 'HTTP 200 × ' + ok2 + ' zo 6');
    ok('každá odpoveď je 200 alebo 400 „plne obsadená" (nie 500)', r2.every(r => r.status === 200 || (r.status === 400 && /obsaden/i.test((r.d && r.d.error) || ''))), stavy(r2));
    // Waitlist: kód neradí automaticky, klientka dostane 400 a musí zavolať POST /api/waitlist sama.
    const plna = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaEdgeClsKap001', booking_date: TERMIN } }, zita);
    ok('ďalšia klientka po súbehu (sekvenčne) dostane 400 „plne obsadená"', plna.status === 400 && /obsaden/i.test((plna.d && plna.d.error) || ''), 'HTTP ' + plna.status + ' ' + kratko(plna.d));
    const wl = await j('/api/waitlist', { method: 'POST', body: { class_id: 'qaEdgeClsKap001', booking_date: TERMIN } }, zita);
    ok('čakací zoznam existuje zvlášť (POST /api/waitlist → pozícia 1)', wl.status === 200 && wl.d && wl.d.waitlist_pos === 1, 'HTTP ' + wl.status + ' ' + kratko(wl.d));

    console.log('\n3) Permanentka do mínusu — 1 vstup, bez členstva, 5 rôznych hodín naraz:');
    await zahrej(perm, 5);
    const r3 = await davka(P.map(c => () => j('/api/bookings', { method: 'POST', body: { class_id: c, booking_date: TERMIN } }, perm)));
    await cakaj(600);
    const petra = user('qaEdgePerm00001');
    const bk3 = aktivne('qaEdgePerm00001', null, TERMIN);
    const ok3 = r3.filter(r => r.status === 200).length;
    info(stavy(r3) + ' · ' + casy(r3) + ' · single_entries=' + petra.single_entries + ' · v DB aktívnych ' + bk3.length + ' (single_entry × ' + bk3.filter(b => b.access_method === 'single_entry').length + ')');
    ok('single_entries nikdy nie je < 0', (petra.single_entries || 0) >= 0, 'single_entries=' + petra.single_entries);
    ok('počet aktívnych rezervácií = počet odpočítaných vstupov', bk3.length === 1 - (petra.single_entries || 0), 'rezervácií ' + bk3.length + ', single_entries ' + petra.single_entries + ' → odpočítaný ' + (1 - (petra.single_entries || 0)) + ' vstup');
    ok('práve 1 rezervácia je zaplatená vstupom (access_method single_entry)', bk3.filter(b => b.access_method === 'single_entry').length === 1, 'single_entry × ' + bk3.filter(b => b.access_method === 'single_entry').length);
    ok('server potvrdil 1 rezerváciu, ostatné 4 odmietol 402 membership_required', ok3 === 1 && r3.filter(r => r.status === 402).length === 4, stavy(r3));

    console.log('\n4) Prvá hodina zdarma dvakrát — lead, 5 rôznych hodín naraz:');
    await zahrej(lead, 5);
    const r4 = await davka(P.map(c => () => j('/api/bookings', { method: 'POST', body: { class_id: c, booking_date: TERMIN } }, lead)));
    await cakaj(600);
    const lenka = user('qaEdgeLead00001');
    const bk4 = aktivne('qaEdgeLead00001', null, TERMIN);
    const zdarma4 = bk4.filter(b => b.free_class === true || b.access_method === 'free_class');
    info(stavy(r4) + ' · ' + casy(r4) + ' · free_class_used=' + lenka.free_class_used + ' · v DB aktívnych ' + bk4.length + ' (zdarma ' + zdarma4.length + ')');
    ok('len 1 rezervácia zdarma (free_class)', zdarma4.length === 1, 'v DB je ' + zdarma4.length + ' rezervácií zdarma (spolu aktívnych ' + bk4.length + ')');
    ok('free_class_used je po rezervácii true', lenka.free_class_used === true, 'free_class_used=' + lenka.free_class_used);
    ok('server potvrdil 1, ostatné 4 odmietol 402', r4.filter(r => r.status === 200).length === 1 && r4.filter(r => r.status === 402).length === 4, stavy(r4));

    console.log('\n5) Storno — cudzia rezervácia a dvojité storno naraz:');
    const c1 = await j('/api/bookings/qaEdgeBkCudz001', { method: 'DELETE' }, stoB);
    ok('klientka B nemôže zrušiť rezerváciu klientky A (403/404)', [403, 404].includes(c1.status), 'HTTP ' + c1.status + ' ' + kratko(c1.d));
    await cakaj(300);
    const bkA = rd('bookings.db').find(b => b._id === 'qaEdgeBkCudz001');
    ok('rezervácia A ostala potvrdená', !!bkA && bkA.status === 'confirmed', 'status=' + (bkA && bkA.status));
    const pred5 = user('qaEdgeStoA00001').single_entries || 0;
    await zahrej(stoA, 2);
    const r5 = await davka([0, 1].map(() => () => j('/api/bookings/qaEdgeBkDvoj001', { method: 'DELETE' }, stoA)));
    await cakaj(600);
    const po5 = user('qaEdgeStoA00001').single_entries || 0;
    const refundNotif = () => rd('notifications.db').filter(n => n.user_id === 'qaEdgeStoA00001' && /Vstup z permanentky sme ti vrátili/.test(n.body || ''));
    const cancelMaily = () => maily('qa.edge.stoa@qa-biz.local', /^Rezervácia zrušená/);
    info(stavy(r5) + ' · ' + casy(r5) + ' · refunded: ' + r5.map(r => r.d && r.d.refunded).join(',') + ' · single_entries ' + pred5 + ' → ' + po5 + ' · notifikácií o vrátení ' + refundNotif().length + ' · mailov o zrušení ' + cancelMaily().length);
    ok('dvojité storno naraz vráti vstup z permanentky len raz (0 → 1)', po5 === pred5 + 1, 'single_entries pred=' + pred5 + ' po=' + po5);
    ok('len jedna z dvoch odpovedí hlási refunded:true', r5.filter(r => r.d && r.d.refunded === true).length === 1, 'refunded: ' + r5.map(r => r.d && r.d.refunded).join(','));
    const bkD = rd('bookings.db').find(b => b._id === 'qaEdgeBkDvoj001');
    ok('rezervácia je zrušená', !!bkD && bkD.status === 'cancelled', 'status=' + (bkD && bkD.status));
    ok('notifikácia „vstup sme ti vrátili" prišla len raz', refundNotif().length === 1, 'n=' + refundNotif().length);
    ok('mail „Rezervácia zrušená" by odišiel len raz', cancelMaily().length === 1, 'v mail_log ' + cancelMaily().length + ' (zachytené, neodoslané)');
    const mailyPred3 = cancelMaily().length;
    const c3 = await j('/api/bookings/qaEdgeBkDvoj001', { method: 'DELETE' }, stoA);
    await cakaj(300);
    ok('tretie storno (sekvenčne, už zrušená) vstup znova nevráti', (user('qaEdgeStoA00001').single_entries || 0) === po5, 'HTTP ' + c3.status + ', single_entries=' + user('qaEdgeStoA00001').single_entries);
    ok('storno už zrušenej rezervácie nepošle ďalší mail „Rezervácia zrušená"', cancelMaily().length === mailyPred3, 'HTTP ' + c3.status + ' ' + kratko(c3.d) + ', mailov ' + mailyPred3 + ' → ' + cancelMaily().length);

    console.log('\n6) Zrušená hodina / minulý dátum / dátum mimo dňa hodiny:');
    const z1 = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaEdgeClsZrus01', booking_date: TERMIN } }, zita);
    ok('hodina v class_cancellations na daný dátum → 400', z1.status === 400 && /zrušen/i.test((z1.d && z1.d.error) || ''), 'HTTP ' + z1.status + ' ' + kratko(z1.d));
    const z2 = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaEdgeClsDvoj01', booking_date: MINULY } }, zita);
    ok('booking_date v minulosti (' + MINULY + ') → odmietnuté 4xx', z2.status >= 400 && z2.status < 500, 'HTTP ' + z2.status + ' ' + kratko(z2.d));
    const z3 = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaEdgeClsDvoj01', booking_date: INY_DEN } }, zita);
    ok('booking_date, ktorý nesedí na day_of_week hodiny (' + INY_DEN + ') → odmietnuté 4xx', z3.status >= 400 && z3.status < 500, 'HTTP ' + z3.status + ' ' + kratko(z3.d));
    const z4 = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaEdgeClsDvoj01', booking_date: 'včera' } }, zita);
    ok('nezmyselný booking_date „včera" → odmietnuté 4xx', z4.status >= 400 && z4.status < 500, 'HTTP ' + z4.status + ' ' + kratko(z4.d));
    await cakaj(300);
    const zle = aktivne('qaEdgeZita00001').filter(b => b.status !== 'waitlist' && (b.class_id === 'qaEdgeClsZrus01' || [MINULY, INY_DEN, 'včera'].includes(b.booking_date)));
    ok('v DB nevznikla Zite žiadna z týchto rezervácií (zrušená hodina, minulosť, iný deň, „včera")', zle.length === 0, 'vzniklo ' + zle.length + ': ' + zle.map(b => b.class_id + '@' + b.booking_date).join(', '));

    console.log('\n7) Neexistujúca hodina / cudzie class_id:');
    const n1 = await j('/api/bookings', { method: 'POST', body: { class_id: 'nieje', booking_date: TERMIN } }, zita);
    ok('class_id „nieje" → 404 (nie 500)', n1.status === 404, 'HTTP ' + n1.status + ' ' + kratko(n1.d));
    const n2 = await j('/api/bookings', { method: 'POST', body: { booking_date: TERMIN } }, zita);
    ok('chýbajúce class_id → 400', n2.status === 400, 'HTTP ' + n2.status + ' ' + kratko(n2.d));
    // Objekt namiesto reťazca (NoSQL injekcia). {$in:[…]} je deterministický — {$ne:''} by
    // vybral „prvú" hodinu podľa náhodného _id (štartové migrácie vkladajú Online/Technika hodiny),
    // takže by výsledok (402 vs. 500, stratený vstup) závisel od náhody.
    const n3 = await j('/api/bookings', { method: 'POST', body: { class_id: { $in: ['qaEdgeClsDvoj01'] }, booking_date: TERMIN2 } }, zita);
    ok('class_id ako objekt {$in:[…]} (NoSQL injekcia) → 400/404, nie 500', n3.status >= 400 && n3.status < 500, 'HTTP ' + n3.status + ' ' + kratko(n3.d));
    const n4 = await j('/api/bookings', { method: 'POST', body: { class_id: { $in: ['qaEdgeClsDvoj01'] }, booking_date: TERMIN2 } }, perm2);
    await cakaj(300);
    const paula = user('qaEdgePerm00002');
    info('Paula: HTTP ' + n4.status + ' ' + kratko(n4.d) + ' · single_entries=' + paula.single_entries + ' · rezervácií na ' + TERMIN2 + ': ' + aktivne('qaEdgePerm00002', null, TERMIN2).length);
    ok('permanentkárka pri tom istom nezmyselnom class_id nepríde o vstup', (paula.single_entries || 0) === 1 || aktivne('qaEdgePerm00002', null, TERMIN2).length === 1, 'single_entries=' + paula.single_entries + ', rezervácií=' + aktivne('qaEdgePerm00002', null, TERMIN2).length);
    ok('v DB nie je rezervácia s neexistujúcim alebo objektovým class_id', !rd('bookings.db').some(b => typeof b.class_id !== 'string' || b.class_id === 'nieje'));
    ok('server po celom teste stále žije', (await j('/api/membership', {}, zita)).status === 200);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nOKRAJOVÉ PRÍPADY REZERVÁCIÍ: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-800));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
