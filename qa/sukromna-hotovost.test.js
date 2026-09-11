/**
 * Súkromné hodiny: platba po hodine (11. 9. 2026).
 *
 * Marek: „Nelka má dnes súkromnú hodinu a brala si od klientky cash — nech sa jej
 * to odráta z výplaty. Po súkromke zadá, že hodina je hotová, že platba bola cash
 * a koľko. A ak je platba cez aplikáciu na účet, tak jej to k výplate dávame my."
 *
 * Stráži, že:
 *   · hotovosť so zadanou sumou → podiel trénera sa ráta zo sumy, hotovosť ide
 *     do zrážky z výplaty (v mesiaci hodiny), tržba je hotovosť
 *   · zaplatené v appke (kredit) → žiadna hotovosť, podiel sa vyplatí
 *   · na účet → čaká na prevod, admin potvrdí „prevod prijatý"
 *   · tréner vidí hodiny, ktoré zabudol potvrdiť (včera, predvčerom)
 *   · cudzí tréner hodinu nepotvrdí, nezmyselná suma neprejde, dvakrát nejde
 *   · admin môže hodinu potvrdiť za trénera — hotovosť sa pripíše trénerovi
 *   · výplaty ukážu aj trénerku, ktorá mala len súkromné hodiny
 *
 * Spustenie:  node qa/sukromna-hotovost.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4597;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-privcash-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
async function j(url, opts, jar) {
  opts = opts || {};
  const headers = { 'Content-Type': 'application/json' };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const spi = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const dnes = new Date().toISOString().slice(0, 10);          // server ráta today() v UTC
  const dni = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const M = dnes.slice(0, 7);
  const U = (_id, name, email, extra) => ({ _id, name, email, password: hash, active: true, created_at: '2026-01-01', ...extra });
  w('users.db', [
    U('qaPhAdmin00001', 'Marek Gruber', 'qa.ph.admin@qa-biz.local', { is_admin: true, user_type: 'admin' }),
    U('qaPhNelka00001', 'Nelka Súkromná', 'qa.ph.nelka@qa-biz.local', { user_type: 'trainer', private_enabled: true, private_rate: 70, private_split: 70 }),
    U('qaPhTomas00001', 'Tomáš Iný', 'qa.ph.tomas@qa-biz.local', { user_type: 'trainer', private_enabled: true }),
    U('qaPhKlient0001', 'Klientka Súkromná', 'qa.ph.klient@qa-biz.local', { user_type: 'client', phone: '0900123456' }),
  ]);
  const S = (_id, date, time_start) => ({ _id, trainer_id: 'qaPhNelka00001', trainer_name: 'Nelka Súkromná', date, time_start, duration_min: 60, city: 'Zvolen', price: 70, status: 'booked', created_at: dni(5) + 'T10:00:00.000Z' });
  const B = (_id, slot_id, date, time_start, extra) => ({ _id, slot_id, trainer_id: 'qaPhNelka00001', trainer_name: 'Nelka Súkromná',
    client_id: 'qaPhKlient0001', client_name: 'Klientka Súkromná', client_phone: '0900123456', date, time_start, duration_min: 60, city: 'Zvolen',
    price: 70, base_price: 70, split: 70, pay_method: 'onsite', paid: false, status: 'booked', created_at: dni(5) + 'T10:00:00.000Z', ...extra });
  w('private_slots.db', [S('qaPhSlot000001', dnes, '10:00'), S('qaPhSlot000002', dnes, '12:00'), S('qaPhSlot000003', dni(1), '17:00'), S('qaPhSlot000004', dni(2), '17:00')]);
  w('private_bookings.db', [
    B('qaPhBk00000001', 'qaPhSlot000001', dnes, '10:00'),                                            // dnes, platí na mieste
    B('qaPhBk00000002', 'qaPhSlot000002', dnes, '12:00', { price: 56, pay_method: 'credit', paid: true }), // zaplatené kreditom (so zľavou)
    B('qaPhBk00000003', 'qaPhSlot000003', dni(1), '17:00'),                                          // včera, zabudnutá
    B('qaPhBk00000004', 'qaPhSlot000004', dni(2), '17:00'),                                          // predvčerom, zabudnutá
  ]);

  console.log('SÚKROMNÉ HODINY — PLATBA PO HODINE\n');
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' } });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await spi(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await spi(12000);

  const nel = {}, tom = {}, adm = {};
  const bk = id => rd('private_bookings.db').find(x => x._id === id) || {};
  const hot = id => rd('payouts.db').filter(p => p._type === 'cash_collected' && p.private_booking_id === id);
  const trz = id => rd('transactions.db').filter(t => t.type === 'private_lesson' && t.private_booking_id === id);
  try {
    await j('/api/login', { method: 'POST', body: { email: 'qa.ph.nelka@qa-biz.local', password: 'Heslo123!' } }, nel);
    await j('/api/login', { method: 'POST', body: { email: 'qa.ph.tomas@qa-biz.local', password: 'Heslo123!' } }, tom);
    await j('/api/login', { method: 'POST', body: { email: 'qa.ph.admin@qa-biz.local', password: 'Heslo123!' } }, adm);

    console.log('1) Trénerkin zoznam:');
    let p = (await j('/api/trainer/private', {}, nel)).d || {};
    const dnesna = (p.slots || []).find(s => s.booking && s.booking.id === 'qaPhBk00000001');
    ok('dnešná hodina je v zozname s cenou a podielom', dnesna && dnesna.booking.price === 70 && dnesna.booking.split === 70, JSON.stringify(dnesna && dnesna.booking));
    const kredit = (p.slots || []).find(s => s.booking && s.booking.id === 'qaPhBk00000002');
    ok('pri zaplatenej kreditom vidí cenu po zľave', kredit && kredit.booking.price === 56 && kredit.booking.paid === true);
    const zab = (p.pending || []).map(x => x.id);
    ok('vidí aj včerajšiu a predvčerajšiu nepotvrdenú hodinu', zab.includes('qaPhBk00000003') && zab.includes('qaPhBk00000004') && !zab.includes('qaPhBk00000001'), JSON.stringify(zab));

    console.log('\n2) Hotovosť — klientka dala 60 € namiesto 70 €:');
    let r = await j('/api/private/complete', { method: 'POST', body: { booking_id: 'qaPhBk00000001', pay: 'cash', amount: 60 } }, nel);
    ok('potvrdené', r.status === 200 && r.d && r.d.ok, JSON.stringify(r.d));
    ok('podiel 70 % zo skutočnej sumy = 42 €', r.d && r.d.trainer_cut === 42, r.d && r.d.trainer_cut);
    ok('odpoveď hlási hotovosť 60 €', r.d && r.d.cash_recorded === true && r.d.cash_amount === 60);
    await spi(500);
    const b1 = bk('qaPhBk00000001');
    ok('hodina je absolvovaná, zaplatená v hotovosti', b1.status === 'completed' && b1.paid === true && b1.pay_method === 'cash' && b1.cash_amount === 60, JSON.stringify({ s: b1.status, p: b1.paid, m: b1.pay_method, c: b1.cash_amount }));
    ok('cena sa zmenila na 60 €, pôvodných 70 € ostalo zapísaných', b1.price === 60 && b1.price_booked === 70);
    const h1 = hot('qaPhBk00000001');
    ok('hotovosť 60 € je u trénerky (zrážka)', h1.length === 1 && h1[0].amount === 60 && h1[0].status === 'held' && h1[0].trainer_name === 'Nelka Súkromná', JSON.stringify(h1));
    ok('zrážka je v mesiaci hodiny', h1[0] && h1[0].month === M);
    const t1 = trz('qaPhBk00000001');
    ok('tržba 60 € v hotovosti', t1.length === 1 && t1[0].amount === 60 && t1[0].method === 'cash', JSON.stringify(t1));
    ok('admin dostal oznam o hotovosti', rd('notifications.db').some(n => n.user_id === 'qaPhAdmin00001' && n.type === 'cash_collected' && /60\.00 €/.test(n.title)));
    ok('trénerka dostala oznam, že sa jej to odráta', rd('notifications.db').some(n => n.user_id === 'qaPhNelka00001' && n.type === 'private_done' && /odráta sa ti z výplaty/.test(n.body)));

    console.log('\n3) Zaplatené v appke (kredit):');
    r = await j('/api/private/complete', { method: 'POST', body: { booking_id: 'qaPhBk00000002', pay: 'cash', amount: 999 } }, nel);
    ok('potvrdené, voľba hotovosti sa ignoruje', r.status === 200 && r.d && r.d.pay === 'app' && r.d.cash_recorded === false, JSON.stringify(r.d));
    ok('podiel 70 % z 56 € = 39,20 €', r.d && r.d.trainer_cut === 39.2, r.d && r.d.trainer_cut);
    await spi(400);
    ok('žiadna hotovosť u trénerky', hot('qaPhBk00000002').length === 0);
    ok('cena ostala 56 €', bk('qaPhBk00000002').price === 56);

    console.log('\n4) Na účet (prevodom):');
    r = await j('/api/private/complete', { method: 'POST', body: { booking_id: 'qaPhBk00000003', pay: 'transfer', amount: 70 } }, nel);
    ok('potvrdené', r.status === 200 && r.d && r.d.ok && r.d.pay === 'transfer', JSON.stringify(r.d));
    await spi(400);
    const b3 = bk('qaPhBk00000003');
    ok('čaká na prevod, nezaplatené', b3.status === 'completed' && b3.pay_method === 'transfer' && b3.transfer_pending === true && !b3.paid);
    ok('žiadna hotovosť u trénerky', hot('qaPhBk00000003').length === 0);
    ok('tržba zapísaná ako prevod', trz('qaPhBk00000003').some(t => t.method === 'transfer' && t.amount === 70));
    const admL = (await j('/api/admin/private', {}, adm)).d || {};
    const a3 = (admL.bookings || []).find(x => x.id === 'qaPhBk00000003');
    const a1 = (admL.bookings || []).find(x => x.id === 'qaPhBk00000001');
    ok('admin vidí „čaká na prevod"', a3 && a3.transfer_pending === true);
    ok('admin vidí hotovosť u trénera', a1 && a1.cash_amount === 60);
    ok('tréner nemôže potvrdiť prevod', [401, 403].includes((await j('/api/admin/private/qaPhBk00000003/paid', { method: 'POST' }, nel)).status));
    r = await j('/api/admin/private/qaPhBk00000003/paid', { method: 'POST' }, adm);
    ok('admin potvrdí prevod', r.status === 200 && r.d && r.d.ok);
    await spi(300);
    ok('hodina je zaplatená', bk('qaPhBk00000003').paid === true && bk('qaPhBk00000003').transfer_pending === false);

    console.log('\n5) Ochrana:');
    ok('cudzí tréner nepotvrdí', (await j('/api/private/complete', { method: 'POST', body: { booking_id: 'qaPhBk00000004', pay: 'cash', amount: 70 } }, tom)).status === 403);
    ok('suma 0 neprejde', (await j('/api/private/complete', { method: 'POST', body: { booking_id: 'qaPhBk00000004', pay: 'cash', amount: 0 } }, nel)).status === 400);
    ok('suma 5000 neprejde', (await j('/api/private/complete', { method: 'POST', body: { booking_id: 'qaPhBk00000004', pay: 'cash', amount: 5000 } }, nel)).status === 400);
    ok('druhé potvrdenie tej istej hodiny neprejde', (await j('/api/private/complete', { method: 'POST', body: { booking_id: 'qaPhBk00000001', pay: 'cash', amount: 60 } }, nel)).status === 400);
    ok('po chybných pokusoch nevznikla hotovosť', hot('qaPhBk00000004').length === 0);

    console.log('\n6) Admin potvrdí za trénerku:');
    r = await j('/api/private/complete', { method: 'POST', body: { booking_id: 'qaPhBk00000004', pay: 'cash', amount: 50 } }, adm);
    ok('potvrdené adminom', r.status === 200 && r.d && r.d.cash_amount === 50, JSON.stringify(r.d));
    await spi(400);
    const h4 = hot('qaPhBk00000004');
    ok('hotovosť sa pripísala trénerke, nie adminovi', h4.length === 1 && h4[0].trainer_name === 'Nelka Súkromná' && h4[0].trainer_id === 'qaPhNelka00001');

    console.log('\n7) Výplata:');
    // očakávané za mesiac M: podiel z hodín s dátumom v M, hotovosť zo zrážok v M
    const bks = rd('private_bookings.db').filter(b => String(b.date).startsWith(M) && b.status === 'completed');
    const podiel = +bks.reduce((s, b) => s + b.price * b.split / 100, 0).toFixed(2);
    const zrazka = +rd('payouts.db').filter(p => p._type === 'cash_collected' && p.month === M).reduce((s, p) => s + p.amount, 0).toFixed(2);
    const vyp = (await j('/api/admin/payouts?month=' + M, {}, adm)).d || {};
    const row = (vyp.rows || []).find(x => x.trainer === 'Nelka Súkromná');
    ok('trénerka bez skupinových hodín je vo výplatách', !!row, JSON.stringify((vyp.rows || []).map(x => x.trainer)));
    ok('podiel zo súkromných hodín sedí (' + podiel + ' €)', row && row.private === podiel, row && row.private);
    ok('zrážka za hotovosť sedí (' + zrazka + ' €)', row && row.cash_deduct === zrazka, row && row.cash_deduct);
    ok('spolu = podiel − hotovosť', row && Math.abs(row.total - +(podiel - zrazka).toFixed(2)) < 0.01, row && row.total);
    const moje = (await j('/api/trainer/earnings', {}, nel)).d || {};
    const mes = (moje.months || []).find(x => x.month === M) || {};
    ok('trénerka to isté vidí vo svojich zárobkoch', mes.private === podiel && mes.cash_deduct === zrazka, JSON.stringify({ p: mes.private, c: mes.cash_deduct }));
    p = (await j('/api/trainer/private', {}, nel)).d || {};
    const hotTento = +rd('payouts.db').filter(x => x._type === 'cash_collected' && x.month === M && x.trainer_id === 'qaPhNelka00001').reduce((s, x) => s + x.amount, 0).toFixed(2);
    ok('v súkromných hodinách vidí „hotovosť u teba" ' + hotTento + ' €', p.month_cash === hotTento, p.month_cash);
    ok('zabudnuté hodiny po potvrdení zmizli', !(p.pending || []).length, JSON.stringify(p.pending));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    setTimeout(() => {
      fs.rmSync(DATA, { recursive: true, force: true });
      console.log('\nSÚKROMNÉ HODINY — PLATBA: ' + passed + ' OK / ' + failed + ' chýb');
      if (failed && chyba) console.log(chyba.slice(-900));
      process.exit(failed ? 1 : 0);
    }, 500);
  }
})();
