/**
 * Technický tréning zaplatený kreditom z appky (11. 9. 2026).
 *
 * Marek: „Daj možnosť dievčatám použiť na technický tréning ich kredit z appky
 * pri bookovaní."
 *
 * Stráži, že:
 *   · appka ponúkne kredit (vráti zostatok) a cena ide podľa členstva
 *   · rezervácia kreditom strhne presne cenu techniky, zapíše ledger aj 0 € transakciu
 *   · pri nedostatku kreditu sa nič nestrhne ani nerezervuje
 *   · dve súbežné rezervácie nesmú minúť ten istý kredit dvakrát
 *   · permanentka má prednosť — kredit sa neminie, keď je vstup
 *   · storno vráti kredit (raz, aj pri dvojkliku) a zmaže transakciu
 *   · platba na mieste funguje ďalej
 *
 * Spustenie:  node qa/technika-kredit.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4598;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-techkr-'));

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
  const buduci = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
  const U = (_id, name, extra) => ({ _id, name, email: _id.toLowerCase() + '@qa-biz.local', password: hash, active: true,
    user_type: 'client', created_at: '2026-01-01', visit_count: 5, free_class_used: true, single_entries: 0, free_credits: 0, referral_credit: 0, ...extra });
  w('users.db', [
    U('qaTkAdmin00001', 'Marek Gruber', { is_admin: true, user_type: 'admin' }),
    U('qaTkSilver0001', 'Silver Kreditová', { referral_credit: 20 }),   // Silver → technika 7 €
    U('qaTkMalo000001', 'Málo Kreditu', { referral_credit: 3 }),        // bez členstva → 10 €
    U('qaTkSubeh00001', 'Súbežná Klientka', { referral_credit: 10 }),   // bez členstva → 10 €, stačí na jednu
    U('qaTkPerm000001', 'Permanentková', { referral_credit: 20, single_entries: 1 }),
  ]);
  w('memberships.db', [{ _id: 'qaTkMemSilver1', user_id: 'qaTkSilver0001', user_name: 'Silver Kreditová', plan_id: 'silver', plan_name: 'Silver',
    price: 75, status: 'active', start_date: '2026-09-01', expires_at: buduci, created_at: '2026-09-01T10:00:00.000Z' }]);
  // Víťazka minulého mesiaca je už vyhlásená — inak by server pri štarte korunoval
  // niektorú z testovacích klientok, dal jej Gold a zvyšok Silver prepočítal na kredit.
  const sk = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const pm = new Date(+sk.slice(0, 4), +sk.slice(5, 7) - 2, 1);
  w('monthly_winners.db', [{ _id: 'qaTkWinner0001', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'qaTkAdmin00001', created_at: '2026-01-01' }]);
  // dve techniky o 3 a 4 dni — dosť ďaleko, aby sa dali stornovať
  const dow = n => new Date(Date.now() + n * 864e5).getDay();
  const T = (_id, n) => ({ _id, name: 'Technický tréning', emoji: '🎯', category: 'Technika', location: 'Detva', instructor: 'Marek Gruber',
    day_of_week: dow(n), time_start: '18:00', time_end: '19:00', capacity: 30, active: true, price: 10 });
  w('classes.db', [T('qaTkTech000001', 3), T('qaTkTech000002', 4)]);

  console.log('TECHNIKA ZA KREDIT\n');
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' } });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await spi(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await spi(12000);

  const us = id => rd('users.db').find(x => x._id === id) || {};
  const rez = (uid, cid) => rd('bookings.db').filter(b => b.user_id === uid && (!cid || b.class_id === cid) && b.status !== 'cancelled');
  const login = async id => { const jar = {}; await j('/api/login', { method: 'POST', body: { email: id.toLowerCase() + '@qa-biz.local', password: 'Heslo123!' } }, jar); return jar; };
  try {
    const sil = await login('qaTkSilver0001'), malo = await login('qaTkMalo000001'), sub = await login('qaTkSubeh00001'), perm = await login('qaTkPerm000001');

    console.log('1) Appka ponúkne kredit:');
    let r = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaTkTech000001' } }, sil);
    ok('bez voľby platby vráti ponuku (402)', r.status === 402 && r.d && r.d.can_pay_on_site, JSON.stringify(r.d));
    ok('cena podľa Silver = 7 €', r.d && r.d.tech_price === 7, r.d && r.d.tech_price);
    ok('a zostatok kreditu 20 €', r.d && r.d.credit_balance === 20, r.d && r.d.credit_balance);

    console.log('\n2) Rezervácia kreditom:');
    r = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaTkTech000001', pay_credit: true } }, sil);
    ok('prejde', r.status === 200, JSON.stringify(r.d).slice(0, 160));
    await spi(500);
    const b1 = rez('qaTkSilver0001', 'qaTkTech000001')[0] || {};
    ok('rezervácia je zaplatená kreditom 7 €', b1.access_method === 'credit' && b1.credit_paid === 7 && !b1.pay_on_site, JSON.stringify({ a: b1.access_method, c: b1.credit_paid, p: b1.pay_on_site }));
    ok('kredit klesol na 13 € (bez desatinného šumu)', us('qaTkSilver0001').referral_credit === 13, us('qaTkSilver0001').referral_credit);
    ok('ledger má −7 €', rd('credit_ledger.db').some(l => l.user_id === 'qaTkSilver0001' && l.delta === -7 && /Technický tréning/.test(l.reason)));
    const tx = rd('transactions.db').filter(t => t.booking_id === b1._id);
    ok('transakcia 0 € hradená kreditom (nie hotovostná tržba)', tx.length === 1 && tx[0].amount === 0 && tx[0].payment_method === 'referral_credit' && tx[0].credit_used === 7, JSON.stringify(tx));
    r = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaTkTech000001', pay_credit: true } }, sil);
    ok('druhá rezervácia na tú istú hodinu neprejde', r.status === 400);
    ok('a kredit sa druhýkrát nestrhol', us('qaTkSilver0001').referral_credit === 13);

    console.log('\n3) Málo kreditu:');
    r = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaTkTech000001', pay_credit: true } }, malo);
    ok('neprejde s vysvetlením', r.status === 400 && /3\.00 €/.test(r.d && r.d.error || ''), JSON.stringify(r.d));
    ok('nič sa nestrhlo ani nerezervovalo', us('qaTkMalo000001').referral_credit === 3 && rez('qaTkMalo000001').length === 0);
    r = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaTkTech000001', pay_on_site: true } }, malo);
    ok('platba na mieste ide ďalej (10 €)', r.status === 200 && (rez('qaTkMalo000001')[0] || {}).pay_amount === 10, JSON.stringify(r.d).slice(0, 120));

    console.log('\n4) Súbeh — kredit 10 €, dve techniky po 10 € naraz:');
    const [x1, x2] = await Promise.all([
      j('/api/bookings', { method: 'POST', body: { class_id: 'qaTkTech000001', pay_credit: true } }, sub),
      j('/api/bookings', { method: 'POST', body: { class_id: 'qaTkTech000002', pay_credit: true } }, sub),
    ]);
    await spi(500);
    ok('prejde práve jedna', [x1.status, x2.status].filter(s => s === 200).length === 1, x1.status + ' / ' + x2.status);
    ok('kredit je 0, nie mínus', us('qaTkSubeh00001').referral_credit === 0, us('qaTkSubeh00001').referral_credit);
    ok('a má len jednu rezerváciu', rez('qaTkSubeh00001').length === 1);

    console.log('\n5) Permanentka má prednosť:');
    r = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaTkTech000001', pay_credit: true } }, perm);
    await spi(400);
    const bp = rez('qaTkPerm000001')[0] || {};
    ok('použil sa vstup, nie kredit', r.status === 200 && bp.access_method === 'single_entry' && us('qaTkPerm000001').referral_credit === 20 && us('qaTkPerm000001').single_entries === 0,
      JSON.stringify({ a: bp.access_method, k: us('qaTkPerm000001').referral_credit }));

    console.log('\n6) Storno vráti kredit:');
    r = await j('/api/bookings/' + b1._id, { method: 'DELETE' }, sil);
    ok('storno prejde a hlási vrátenie', r.status === 200 && r.d && r.d.refunded === true, JSON.stringify(r.d));
    await spi(400);
    ok('kredit je späť na 20 €', us('qaTkSilver0001').referral_credit === 20, us('qaTkSilver0001').referral_credit);
    ok('ledger má +7 €', rd('credit_ledger.db').some(l => l.user_id === 'qaTkSilver0001' && l.delta === 7));
    ok('transakcia za kredit zmizla', rd('transactions.db').filter(t => t.booking_id === b1._id).length === 0);
    ok('klientka dostala oznam o vrátení', rd('notifications.db').some(n => n.user_id === 'qaTkSilver0001' && /Kredit 7\.00 € sme ti vrátili/.test(n.body || '')));
    r = await j('/api/bookings/' + b1._id, { method: 'DELETE' }, sil);
    await spi(300);
    ok('druhé storno nevráti kredit druhýkrát', us('qaTkSilver0001').referral_credit === 20 && r.d && !r.d.refunded,
      JSON.stringify({ kredit: us('qaTkSilver0001').referral_credit, status: r.status, d: r.d }));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    setTimeout(() => {
      fs.rmSync(DATA, { recursive: true, force: true });
      console.log('\nTECHNIKA ZA KREDIT: ' + passed + ' OK / ' + failed + ' chýb');
      if (failed && chyba) console.log(chyba.slice(-900));
      process.exit(failed ? 1 : 0);
    }, 500);
  }
})();
