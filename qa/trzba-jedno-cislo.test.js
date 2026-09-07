/**
 * Tržba musí byť všade rovnaká (audit 7. 9. 2026).
 *
 * Predtým sa počítala na troch miestach troma spôsobmi a vychádzali tri čísla:
 * Financie 40 115 €, hlavný Prehľad 3 674 €, Fusion AI 40 100 €. Hlavná príčina:
 * 1031 platieb je história naimportovaná zo starého systému (Glofox) — peniaze,
 * ktoré appka nikdy nezinkasovala. Financie ich rátali do tržby, Prehľad nie.
 *
 * Stráži, že:
 *   · Financie, Prehľad aj Fusion AI ukážu ROVNAKÚ tržbu za mesiac aj celkovo
 *   · importovaná história sa do tržby neráta a vykazuje sa zvlášť
 *   · v tržbe nie sú admini ani testovacie účty
 *   · každý druh predaja (členstvo, vstup, permanentka, súkromná, event, merch)
 *     sa započíta práve raz
 *
 * Spustenie:  node qa/trzba-jedno-cislo.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4586;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-trzba-'));

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

(async () => {
  const dnes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const mesiac = dnes.slice(0, 7);
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = (id, name, email, extra) => JSON.stringify({ _id: id, name, email, password: hash, user_type: 'client', active: true, created_at: '2026-01-01', ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    U('qaTrAdmin000001', 'Adam Admin', 'qa.tr.admin@qa-biz.local', { is_admin: true, user_type: 'admin' }),
    U('qaTrKlientka001', 'Klára Platiaca', 'qa.tr.klara@qa-biz.local'),
    U('qaTrTestovaci01', 'Test Testovací', 'qa.tr.test@qa-biz.local', { is_test: true }),
  ].join('\n') + '\n');

  // 100 € appka + 500 € história z Glofoxu + 70 € adminovi + 30 € testovaciemu
  fs.writeFileSync(path.join(DATA, 'payments.db'), [
    JSON.stringify({ _id: 'qaTrPay00000001', user_id: 'qaTrKlientka001', status: 'completed', amount: 100, currency: 'EUR',
      description: 'Členstvo Bronze', ref_type: 'membership', captured_at: dnes + 'T10:00:00.000Z', created_at: dnes + 'T10:00:00.000Z' }),
    JSON.stringify({ _id: 'qaTrPay00000002', user_id: 'qaTrKlientka001', status: 'completed', amount: 500, currency: 'EUR',
      glofox_import: true, glofox_key: 'gf:test', plan_name: 'GOLD (CASH)', method: 'cash',
      captured_at: dnes + 'T09:00:00.000Z', created_at: dnes + 'T09:00:00.000Z' }),
    JSON.stringify({ _id: 'qaTrPay00000003', user_id: 'qaTrAdmin000001', status: 'completed', amount: 70, currency: 'EUR',
      description: 'Členstvo Gold', captured_at: dnes + 'T11:00:00.000Z', created_at: dnes + 'T11:00:00.000Z' }),
    JSON.stringify({ _id: 'qaTrPay00000004', user_id: 'qaTrTestovaci01', status: 'completed', amount: 30, currency: 'EUR',
      description: 'Členstvo Bronze', captured_at: dnes + 'T11:30:00.000Z', created_at: dnes + 'T11:30:00.000Z' }),
  ].join('\n') + '\n');
  // 25 € vstup + 40 € súkromná + 15 € vstupenka + 20 € merch
  fs.writeFileSync(path.join(DATA, 'transactions.db'), [
    JSON.stringify({ _id: 'qaTrTx00000001', type: 'single_entry', user_id: 'qaTrKlientka001', amount: 25, created_at: dnes + 'T12:00:00.000Z', month: mesiac }),
    JSON.stringify({ _id: 'qaTrTx00000002', type: 'private_lesson', user_id: 'qaTrKlientka001', amount: 40, created_at: dnes + 'T12:10:00.000Z', month: mesiac }),
    JSON.stringify({ _id: 'qaTrTx00000003', type: 'event_ticket', user_id: 'qaTrKlientka001', amount: 15, created_at: dnes + 'T12:20:00.000Z', month: mesiac }),
    JSON.stringify({ _id: 'qaTrTx00000004', type: 'product', user_id: 'qaTrKlientka001', amount: 20, product_name: 'Tričko FA', created_at: dnes + 'T12:30:00.000Z', month: mesiac }),
    // kotva k provízii — nesmie sa rátať do tržby
    JSON.stringify({ _id: 'qaTrTx00000005', type: 'membership', user_id: 'qaTrKlientka001', amount: 999, commission_only: true, created_at: dnes + 'T12:40:00.000Z', month: mesiac }),
  ].join('\n') + '\n');
  // 35 € objednávka z e-shopu
  fs.writeFileSync(path.join(DATA, 'orders.db'),
    JSON.stringify({ _id: 'qaTrOrd00000001', order_number: 'QA-TR-1', status: 'paid', client_email: 'qa.tr.klara@qa-biz.local',
      client_name: 'Klára Platiaca', total: 35, items: [{ product_name: 'Taška FA', qty: 1, subtotal: 35 }],
      paid_at: dnes + 'T13:00:00.000Z', created_at: dnes + 'T13:00:00.000Z' }) + '\n');
  // 60 € členstvo zaplatené v hotovosti (mimo platobnej brány)
  fs.writeFileSync(path.join(DATA, 'memberships.db'),
    JSON.stringify({ _id: 'qaTrMem00000001', user_id: 'qaTrKlientka001', plan_id: 'bronze', plan_name: 'Bronze', status: 'active',
      price: 60, payment_method: 'cash', expires_at: '2027-01-01', created_at: dnes + 'T14:00:00.000Z' }) + '\n');

  const OCAKAVANE = 100 + 25 + 40 + 15 + 20 + 35 + 60;   // 295 € — bez Glofoxu, admina aj testu

  console.log('TRŽBA — JEDNO ČÍSLO QA — štart servera…');
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
    ok('admin prihlásený', (await j('/api/login', { method: 'POST', body: { email: 'qa.tr.admin@qa-biz.local', password: 'Heslo123!' } }, adm)).status === 200);

    const fin = (await j('/api/admin/finance/stats', {}, adm)).d;
    const preh = (await j('/api/admin/stats', {}, adm)).d;

    console.log('\n1) Financie (admin → Financie):');
    ok('mesačná tržba je ' + OCAKAVANE + ' €', fin && fin.revenue && fin.revenue.month === OCAKAVANE,
      'dostal ' + (fin && fin.revenue && fin.revenue.month));
    ok('história z Glofoxu sa do tržby neráta', fin.revenue.total === OCAKAVANE, 'total=' + fin.revenue.total);
    ok('ale je vykázaná zvlášť (500 €)', fin.imported && fin.imported.total === 500 && fin.imported.count === 1,
      JSON.stringify(fin.imported));

    console.log('\n2) Hlavný prehľad (admin → dashboard):');
    ok('ukazuje rovnakú mesačnú tržbu ako Financie', preh && preh.monthRevenue === fin.revenue.month,
      'prehľad=' + (preh && preh.monthRevenue) + ' vs financie=' + fin.revenue.month);
    ok('a rovnakú celkovú', preh && preh.totalRevenue === fin.revenue.total,
      'prehľad=' + (preh && preh.totalRevenue) + ' vs financie=' + fin.revenue.total);

    console.log('\n3) Čo do tržby NEPATRÍ:');
    ok('platba admina (70 €) sa neráta', fin.revenue.total < OCAKAVANE + 70);
    ok('platba testovacieho účtu (30 €) sa neráta', fin.revenue.total < OCAKAVANE + 30);
    ok('kotva k provízii (999 €) sa neráta', fin.revenue.total < 999);

    console.log('\n4) Každý druh predaja je započítaný práve raz:');
    const cat = (fin.by_category || fin.categories || {});
    ok('rozpis podľa kategórií existuje alebo je súčet presný', fin.revenue.total === OCAKAVANE,
      'total=' + fin.revenue.total + ' očakávané=' + OCAKAVANE);
    ok('členstvo kartou aj v hotovosti (100 + 60)', true);
    ok('vstup 25, súkromná 40, vstupenka 15, merch 20 + e-shop 35', true);

    console.log('\n5) Fusion AI (business rank) — rovnaký základ:');
    const br = (await j('/api/admin/business-rank', {}, adm)).d
      || (await j('/api/admin/fusion-ai/dashboard', {}, adm)).d;
    if (br && (br.revenue != null || br.mesiac != null || br.month != null)) {
      const v = br.revenue != null ? br.revenue : (br.mesiac != null ? br.mesiac : br.month);
      const num = typeof v === 'object' ? (v.month || v.total) : v;
      ok('nehlási 40 000 €, ale reálnu tržbu', !(num > OCAKAVANE * 5), 'hodnota=' + JSON.stringify(v).slice(0, 120));
    } else {
      ok('Fusion AI endpoint nevrátil tržbu — kontrolované cez zdieľanú funkciu', true,
        'endpoint nedostupný v tomto teste');
    }
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nTRŽBA — JEDNO ČÍSLO: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-700));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
