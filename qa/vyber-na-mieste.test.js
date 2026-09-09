/**
 * Výber platby na hodine — permanentka sa musí aj vytvoriť (9. 9. 2026).
 *
 * Marek: „Michaela Skuban si kúpila permanentku… nejde profil a kúpiť
 * permanentku." A Darina Miková to isté.
 *
 * Príčina: /api/admin/bookings/:id/collect zapisoval KAŽDÚ vybratú sumu ako
 * „jednorazový vstup" a ignoroval pay_plan, ktorý si klientka pri rezervácii
 * vybrala. Tréner vybral 80 €, peniaze sedeli — a permanentka nikdy nevznikla.
 *
 * Stráži, že:
 *   · pri pay_plan=permanentka10 sa vstupy naozaj pripíšu
 *   · hodina, na ktorej sa permanentka kúpila, si jeden vstup zoberie
 *   · transakcia je typu 'membership', nie 'single_entry'
 *   · bežný vstup bez plánu sa naďalej zapíše ako single_entry a nič nepripíše
 *   · hotovosť sa eviduje u toho, kto ju vybral
 *   · druhý výber k tej istej rezervácii neprejde
 *
 * Spustenie:  node qa/vyber-na-mieste.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4597;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-vyber-'));
const TOKEN = 'qa-vyber-token-123';

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts) {
  const headers = { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) };
  const r = await fetch(BASE + url, { method: (opts && opts.method) || 'GET', headers, body: opts && opts.body ? JSON.stringify(opts.body) : undefined });
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const dnes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());

  w('users.db', [
    { _id: 'qaVybMarek00001', name: 'Marek Gruber', email: 'gruber.marek@gmail.com',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    // kúpila si na hodine permanentku
    { _id: 'qaVybPerma00001', name: 'Permanentková klientka', email: 'qa.vyb.perma@qa-biz.local',
      user_type: 'client', active: true, created_at: '2026-08-01',
      free_class_used: true, single_entries: 0, visit_count: 5 },
    // prišla na jednorazový vstup
    { _id: 'qaVybVstup00001', name: 'Vstupová klientka', email: 'qa.vyb.vstup@qa-biz.local',
      user_type: 'client', active: true, created_at: '2026-08-01',
      free_class_used: true, single_entries: 0, visit_count: 3 },
  ]);

  w('classes.db', [{ _id: 'qaVybTrieda0001', name: 'Zumba', emoji: '🎵', category: 'Zumba',
    location: 'Zvolen', address: 'Zvolen', day_of_week: new Date(dnes + 'T12:00:00Z').getUTCDay(),
    time_start: '17:00', time_end: '18:00', capacity: 30, price: 10, active: true,
    instructor: 'Marek Gruber', instructor_id: 'qaVybMarek00001' }]);

  w('bookings.db', [
    // rezervácia s vybraným plánom — permanentka za 80 €
    { _id: 'qaVybRez000001', class_id: 'qaVybTrieda0001', class_name: 'Zumba', class_location: 'Zvolen',
      user_id: 'qaVybPerma00001', user_name: 'Permanentková klientka', user_email: 'qa.vyb.perma@qa-biz.local',
      booking_date: dnes, status: 'attended', attendance_status: 'attended',
      pay_on_site: true, pay_amount: 80, pay_plan: 'permanentka10',
      pay_plan_name: '10-vstupová permanentka', access_method: 'pay_on_site',
      created_at: dnes + 'T08:00:00.000Z' },
    // rezervácia bez plánu — obyčajný vstup
    { _id: 'qaVybRez000002', class_id: 'qaVybTrieda0001', class_name: 'Zumba', class_location: 'Zvolen',
      user_id: 'qaVybVstup00001', user_name: 'Vstupová klientka', user_email: 'qa.vyb.vstup@qa-biz.local',
      booking_date: dnes, status: 'attended', attendance_status: 'attended',
      pay_on_site: true, pay_amount: 10, access_method: 'pay_on_site',
      created_at: dnes + 'T08:05:00.000Z' },
  ]);

  console.log('VÝBER PLATBY NA HODINE\n');

  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', IMPORT_TOKEN: TOKEN },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 9000));

  const T = { 'x-import-token': TOKEN };

  try {
    console.log('1) Servisná cesta je bez tokenu neviditeľná:');
    ok('bez tokenu 404', (await j('/api/service/collect', { method: 'POST', body: { booking_id: 'qaVybRez000001' } })).status === 404);

    console.log('\n2) Permanentka kúpená na hodine:');
    const r = await j('/api/service/collect', { method: 'POST', headers: T,
      body: { booking_id: 'qaVybRez000001', amount: 80, method: 'cash' } });
    ok('výber prešiel', r.status === 200 && r.d && r.d.ok, JSON.stringify(r.d).slice(0, 160));
    ok('rozpoznal plán', r.d && r.d.plan === '10-vstupová permanentka', r.d && String(r.d.plan));

    await new Promise(res => setTimeout(res, 900));
    const u1 = rd('users.db').find(x => x._id === 'qaVybPerma00001');
    ok('vstupy sa pripísali a jeden si vzala táto hodina (9)', u1.single_entries === 9,
      'má ' + u1.single_entries);

    const mem = rd('memberships.db').filter(m => m.user_id === 'qaVybPerma00001');
    ok('vznikol záznam permanentky', mem.length === 1 && mem[0].plan_id === 'permanentka10',
      JSON.stringify(mem.map(m => m.plan_id)));

    const tx = rd('transactions.db').filter(t => t.user_id === 'qaVybPerma00001');
    ok('transakcia je typu membership, nie single_entry',
      tx.length === 1 && tx[0].type === 'membership', JSON.stringify(tx.map(t => t.type)));
    ok('suma 80 €', tx[0] && Math.abs(tx[0].amount - 80) < 0.01, tx[0] && String(tx[0].amount));

    const b1 = rd('bookings.db').find(x => x._id === 'qaVybRez000001');
    ok('rezervácia má zapísaný výber', !!(b1.entry_collected && b1.entry_collected.amount === 80));
    ok('a už nepýta platbu na mieste', b1.pay_on_site === false);
    ok('krytie prepísané na vstup', b1.access_method === 'single_entry', b1.access_method);

    const fak = rd('invoices.db').filter(i => i.user_id === 'qaVybPerma00001');
    ok('vystavila sa faktúra na permanentku',
      fak.length === 1 && /permanentka/i.test((fak[0].items || []).map(i => i.desc).join(' ')),
      JSON.stringify(fak.map(i => i.total)));

    console.log('\n3) Obyčajný vstup ostáva vstupom:');
    const r2 = await j('/api/service/collect', { method: 'POST', headers: T,
      body: { booking_id: 'qaVybRez000002', amount: 10, method: 'cash' } });
    ok('výber prešiel', r2.status === 200 && r2.d && r2.d.ok);
    ok('žiadny plán sa nepriradil', r2.d && r2.d.plan === null, String(r2.d && r2.d.plan));
    await new Promise(res => setTimeout(res, 700));
    const u2 = rd('users.db').find(x => x._id === 'qaVybVstup00001');
    ok('nepribudli jej žiadne vstupy', (u2.single_entries || 0) === 0, String(u2.single_entries));
    const tx2 = rd('transactions.db').filter(t => t.user_id === 'qaVybVstup00001');
    ok('transakcia je single_entry', tx2.length === 1 && tx2[0].type === 'single_entry',
      JSON.stringify(tx2.map(t => t.type)));

    console.log('\n4) Hotovosť sa eviduje u toho, kto ju vybral:');
    const po = rd('payouts.db').filter(p => p._type === 'cash_collected');
    ok('dva záznamy hotovosti', po.length === 2, 'záznamov: ' + po.length);
    ok('spolu 90 €', Math.abs(po.reduce((s, p) => s + p.amount, 0) - 90) < 0.01,
      String(po.reduce((s, p) => s + p.amount, 0)));

    console.log('\n5) Dvakrát to vybrať nejde:');
    ok('druhý pokus odmietnutý',
      (await j('/api/service/collect', { method: 'POST', headers: T,
        body: { booking_id: 'qaVybRez000001', amount: 80, method: 'cash' } })).status === 400);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nVÝBER NA HODINE: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-800));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
