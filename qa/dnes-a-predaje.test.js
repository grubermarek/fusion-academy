/**
 * Ranná obrazovka „Dnes" + jeden zoznam „Predaje" (7. 9. 2026).
 *
 * Marek: „chcem jednu stránku so štyrmi vecami — koľko prišlo peňazí, kto prestal
 * chodiť, kto bol na hodine a čo treba dnes" a „jeden zoznam predajov, kde má
 * každý riadok sumu, dátum, kto, za čo a odkaz na faktúru, aby som to vedel dať
 * účtovníčke bez vysvetľovania."
 *
 * Stráži, že:
 *   · zoznam predajov ukáže rovnaké číslo ako Financie aj hlavný Prehľad
 *   · každý riadok nesie kto, za čo, ako platil a odkiaľ predaj prišiel
 *   · faktúra sa k predaju naozaj spáruje; čo doklad nemá, je označené
 *   · filtre (obdobie, kategória, hľadanie) aj CSV export fungujú
 *   · história z Glofoxu je mimo, kým sa výslovne nezapne
 *   · kto chodil a prestal (končiace členstvá netreba, tie sa obnovujú samy)
 *   · dochádzka za včera a dnes sedí s tým, čo je v DB
 *
 * Spustenie:  node qa/dnes-a-predaje.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4587;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-dnes-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts, jar) {
  const headers = { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: (opts && opts.method) || 'GET', headers, body: opts && opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
async function text(url, jar) {
  const r = await fetch(BASE + url, { headers: jar && jar.cookie ? { Cookie: jar.cookie } : {} });
  return { status: r.status, body: await r.text(), ct: r.headers.get('content-type') || '' };
}

(async () => {
  const dnes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const vcera = new Date(Date.parse(dnes + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  const o5 = new Date(Date.parse(dnes + 'T12:00:00Z') + 5 * 86400000).toISOString().slice(0, 10);
  const o40 = new Date(Date.parse(dnes + 'T12:00:00Z') + 40 * 86400000).toISOString().slice(0, 10);
  const pred45 = new Date(Date.parse(dnes + 'T12:00:00Z') - 45 * 86400000).toISOString().slice(0, 10);
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = (id, name, email, extra) => JSON.stringify({ _id: id, name, email, password: hash, user_type: 'client', active: true, created_at: '2026-01-01', ...(extra || {}) });

  fs.writeFileSync(path.join(DATA, 'users.db'), [
    U('qaDnAdmin000001', 'Adam Admin', 'qa.dn.admin@qa-biz.local', { is_admin: true, user_type: 'admin' }),
    U('qaDnKlara000001', 'Klára Kupujúca', 'qa.dn.klara@qa-biz.local'),
    U('qaDnEva00000001', 'Eva Končiaca', 'qa.dn.eva@qa-biz.local'),
    U('qaDnZita00000001', 'Zita Dlhá', 'qa.dn.zita@qa-biz.local'),
    U('qaDnDana00000001', 'Dana Odišla', 'qa.dn.dana@qa-biz.local', { phone: '0900111222', visit_count: 12 }),
  ].join('\n') + '\n');

  // 100 € kartou (má faktúru) + 500 € história z Glofoxu + 25 € vstup bez faktúry
  fs.writeFileSync(path.join(DATA, 'payments.db'), [
    JSON.stringify({ _id: 'qaDnPay00000001', user_id: 'qaDnKlara000001', status: 'completed', amount: 100, currency: 'EUR',
      description: 'Členstvo Silver', ref_type: 'membership', provider: 'stripe',
      captured_at: dnes + 'T10:00:00.000Z', created_at: dnes + 'T10:00:00.000Z' }),
    JSON.stringify({ _id: 'qaDnPay00000002', user_id: 'qaDnKlara000001', status: 'completed', amount: 500, currency: 'EUR',
      glofox_import: true, glofox_key: 'gf:x', plan_name: 'GOLD (CASH)', method: 'cash',
      captured_at: vcera + 'T09:00:00.000Z', created_at: vcera + 'T09:00:00.000Z' }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(DATA, 'transactions.db'),
    JSON.stringify({ _id: 'qaDnTx00000001', type: 'single_entry', user_id: 'qaDnZita00000001', amount: 25,
      payment_method: 'hotovosť', note: 'Jednorazový vstup', created_at: dnes + 'T18:00:00.000Z', month: dnes.slice(0, 7) }) + '\n');
  fs.writeFileSync(path.join(DATA, 'invoices.db'),
    JSON.stringify({ _id: 'qaDnInv00000001', number: '20260500', vs: '20260500', type: 'invoice', user_id: 'qaDnKlara000001',
      client_name: 'Klára Kupujúca', client_email: 'qa.dn.klara@qa-biz.local',
      items: [{ desc: 'Členstvo Silver', qty: 1, total: 100 }], total: 100, currency: 'EUR',
      payment_method: 'Stripe', issued_at: dnes, paid_at: dnes, status: 'paid', created_at: dnes + 'T10:01:00.000Z' }) + '\n');

  // Eve končí členstvo o 5 dní, Zite až o 40 (nemá sa zobraziť)
  fs.writeFileSync(path.join(DATA, 'memberships.db'), [
    JSON.stringify({ _id: 'qaDnMem00000001', user_id: 'qaDnEva00000001', plan_id: 'bronze', plan_name: 'Bronze',
      status: 'active', price: 50, expires_at: o5, created_at: '2026-08-01' }),
    JSON.stringify({ _id: 'qaDnMem00000002', user_id: 'qaDnZita00000001', plan_id: 'silver', plan_name: 'Silver',
      status: 'active', price: 75, expires_at: o40, created_at: '2026-08-01' }),
    JSON.stringify({ _id: 'qaDnMem00000003', user_id: 'qaDnDana00000001', plan_id: 'bronze', plan_name: 'Bronze',
      status: 'active', price: 50, expires_at: o40, created_at: '2026-06-01' }),
  ].join('\n') + '\n');

  // dochádzka: včerajšia hodina — 2 prišli, 1 neprišla
  fs.writeFileSync(path.join(DATA, 'classes.db'),
    JSON.stringify({ _id: 'qaDnCls00000001', name: 'Zumba', category: 'Zumba', location: 'Detva', day_of_week: 1,
      time_start: '19:00', time_end: '20:00', capacity: 20, price: 10, active: true }) + '\n');
  fs.writeFileSync(path.join(DATA, 'bookings.db'), [
    JSON.stringify({ _id: 'qaDnBk00000001', user_id: 'qaDnKlara000001', class_id: 'qaDnCls00000001', booking_date: vcera, status: 'attended', attendance_status: 'attended', created_at: vcera }),
    JSON.stringify({ _id: 'qaDnBk00000002', user_id: 'qaDnEva00000001', class_id: 'qaDnCls00000001', booking_date: vcera, status: 'attended', attendance_status: 'attended', created_at: vcera }),
    JSON.stringify({ _id: 'qaDnBk00000003', user_id: 'qaDnZita00000001', class_id: 'qaDnCls00000001', booking_date: vcera, status: 'confirmed', attendance_status: 'no_show', created_at: vcera }),
    // Dana chodila, naposledy pred 45 dňami — a členstvo jej beží ďalej
    JSON.stringify({ _id: 'qaDnBk00000004', user_id: 'qaDnDana00000001', class_id: 'qaDnCls00000001', booking_date: pred45, status: 'attended', attendance_status: 'attended', created_at: pred45 }),
  ].join('\n') + '\n');

  console.log('DNES A PREDAJE QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 10000));

  try {
    const adm = {};
    ok('admin prihlásený', (await j('/api/login', { method: 'POST', body: { email: 'qa.dn.admin@qa-biz.local', password: 'Heslo123!' } }, adm)).status === 200);
    ok('bez admina sa predaje nezobrazia', [401, 403].includes((await j('/api/admin/predaje')).status));

    console.log('\n1) Jeden zoznam predajov:');
    const p = (await j('/api/admin/predaje', {}, adm)).d;
    ok('zoznam sa načíta', p && p.ok, JSON.stringify(p).slice(0, 120));
    ok('je v ňom 100 € členstvo aj 25 € vstup (125 €)', p.suma === 125 && p.pocet === 2, 'suma=' + p.suma + ' pocet=' + p.pocet);
    ok('história z Glofoxu tam NIE JE', !p.rows.some(r => r.src === 'glofox'), p.rows.map(r => r.src).join(','));

    const fin = (await j('/api/admin/finance/stats', {}, adm)).d;
    const preh = (await j('/api/admin/stats', {}, adm)).d;
    ok('rovnaké číslo ako vo Financiách', fin.revenue.total === p.suma, 'financie=' + fin.revenue.total + ' predaje=' + p.suma);
    ok('rovnaké číslo ako v hlavnom Prehľade', preh.totalRevenue === p.suma, 'prehľad=' + preh.totalRevenue);

    console.log('\n2) Čo je na riadku:');
    const clen = p.rows.find(r => r.a === 100) || {};
    ok('kto — meno aj e-mail', clen.who && clen.who.name === 'Klára Kupujúca' && clen.who.email === 'qa.dn.klara@qa-biz.local', JSON.stringify(clen.who));
    ok('za čo', /Silver/.test(clen.what || ''), clen.what);
    ok('ako zaplatil', !!clen.method, clen.method);
    ok('odkiaľ predaj prišiel', !!clen.kanal, clen.kanal);
    ok('a odkaz na faktúru 20260500', clen.invoice && clen.invoice.number === '20260500', JSON.stringify(clen.invoice));
    const vstup = p.rows.find(r => r.a === 25) || {};
    ok('vstup bez dokladu je označený ako bez faktúry', vstup.invoice === null, JSON.stringify(vstup.invoice));
    ok('a súhrn to počíta', p.bez_faktury === 1, 'bez_faktury=' + p.bez_faktury);

    console.log('\n3) Filtre a export:');
    const jenClen = (await j('/api/admin/predaje?cat=memberships', {}, adm)).d;
    ok('filter podľa kategórie', jenClen.pocet === 1 && jenClen.suma === 100, 'pocet=' + jenClen.pocet + ' suma=' + jenClen.suma);
    const hladanie = (await j('/api/admin/predaje?q=zita', {}, adm)).d;
    ok('hľadanie podľa mena', hladanie.pocet === 1 && hladanie.rows[0].who.name === 'Zita Dlhá', JSON.stringify(hladanie.rows.map(r => r.who.name)));
    const obdobie = (await j('/api/admin/predaje?from=' + dnes + '&to=' + dnes, {}, adm)).d;
    ok('filter podľa obdobia', obdobie.pocet === 2, 'pocet=' + obdobie.pocet);
    const sHist = (await j('/api/admin/predaje?history=1', {}, adm)).d;
    ok('história sa dá zapnúť (500 € navyše)', sHist.suma === 625 && sHist.rows.some(r => r.src === 'glofox'), 'suma=' + sHist.suma);
    const csv = await text('/api/admin/predaje/export.csv', adm);
    ok('CSV sa stiahne', csv.status === 200 && /text\/csv/.test(csv.ct), 'HTTP ' + csv.status + ' ' + csv.ct);
    ok('má hlavičku po slovensky', /Dátum";"Klient/.test(csv.body), csv.body.slice(0, 90));
    ok('obsahuje predaj aj s faktúrou', /Klára Kupujúca/.test(csv.body) && /20260500/.test(csv.body));
    ok('a riadok SPOLU so sumou', /SPOLU/.test(csv.body) && /125,00/.test(csv.body), csv.body.split('\r\n').slice(-1)[0]);

    console.log('\n4) Ranná obrazovka — podklady:');
    // Marek 7. 9.: končiace členstvá netreba — ženy si ich obnovujú samy.
    // Podstatné je, kto chodil a prestal.
    const nech = (await j('/api/admin/dnes/nechodia?days=30', {}, adm)).d;
    ok('kto chodil a mesiac neprišiel', nech.ok && nech.count === 1 && nech.rows[0].name === 'Dana Odišla',
      JSON.stringify((nech.rows || []).map(r => r.name + ':' + r.days_since)));
    ok('a povie, koľko dní už nebola', nech.rows[0].days_since >= 40, 'days_since=' + nech.rows[0].days_since);
    ok('nesie telefón, nech sa dá hneď volať', nech.rows[0].phone === '0900111222', nech.rows[0].phone);
    ok('kto bol na hodine včera, v zozname NIE JE', !(nech.rows || []).some(r => r.name === 'Klára Kupujúca'));
    ok('a zvlášť hlási, koľko z nich platí a nechodí', nech.paying === 1, 'paying=' + nech.paying);
    const doch = (await j('/api/admin/dnes/dochadzka', {}, adm)).d;
    ok('dochádzka za včera a dnes', doch.ok && doch.hodiny.length === 1, JSON.stringify(doch.hodiny).slice(0, 120));
    ok('2 prišli, 1 neprišla z 3 prihlásených',
      doch.hodiny[0].prisli === 2 && doch.hodiny[0].nedosli === 1 && doch.hodiny[0].prihlaseni === 3,
      JSON.stringify(doch.hodiny[0]));
    ok('a hovorí, koľko ľudí prišlo spolu', doch.spolu_prislo === 2, 'spolu=' + doch.spolu_prislo);
    const ul = (await j('/api/admin/urgent-tasks', {}, adm)).d;
    ok('úlohy na dnes sa načítajú', ul && ul.ok && Array.isArray(ul.tasks), JSON.stringify(ul).slice(0, 100));

    console.log('\n5) Účtovníctvo ide z rovnakého zdroja:');
    const uct = (await j('/api/admin/accounting/summary', {}, adm)).d;
    ok('účtovníctvo hlási rovnakú tržbu ako predaje', uct && uct.totals && uct.totals.revenue === p.suma,
      'účtovníctvo=' + (uct && uct.totals && uct.totals.revenue) + ' predaje=' + p.suma);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nDNES A PREDAJE: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-700));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
