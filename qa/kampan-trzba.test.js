/**
 * Tržba priradená kampani (9. 9. 2026).
 *
 * Marek: „takže čo treba spraviť, aby sme mali presné merania?"
 *
 * campaignRevenueMap() rátal len platby cez bránu a hotovostné členstvá.
 * Klientka z reklamy, ktorá chodila na jednorazové vstupy, na súkromnú hodinu
 * alebo si kúpila merch, tak pre kampaň znamenala 0 € — kampaň vyzerala ako
 * neúspech, hoci zarobila. Teraz je zdroj revenueEvents, to isté číslo ako
 * vo Financiách.
 *
 * Stráži, že:
 *   · kampaň vidí vstupy, súkromné hodiny aj merch, nie len členstvá
 *   · vstupenka kúpená BEZ účtu sa priradí cez utm z objednávky
 *   · vstupenka kupujúcej, ktorá účet má, sa neráta dvakrát
 *   · leadová kampaň si tržbu berie cez lead_source
 *   · platiace klientky sa počítajú, nie len suma
 *
 * Spustenie:  node qa/kampan-trzba.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4595;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-ktrz-'));

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
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const UTM = 'qa-kampan-web';

  w('users.db', [
    { _id: 'qaKtAdmin000001', name: 'Marek Gruber', email: 'qa.kt.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    // prišla z reklamy a chodí na jednorazové vstupy — doteraz pre kampaň 0 €
    { _id: 'qaKtVstupy00001', name: 'Vstupová klientka', email: 'qa.kt.vstupy@qa-biz.local',
      user_type: 'client', active: true, created_at: '2026-08-01', utm_campaign: UTM },
    // prišla z reklamy a kúpila si členstvo v hotovosti
    { _id: 'qaKtClenstvo001', name: 'Členská klientka', email: 'qa.kt.clenstvo@qa-biz.local',
      user_type: 'client', active: true, created_at: '2026-08-02', utm_campaign: UTM },
    // kúpila vstupenku a účet má — nesmie sa započítať dvakrát
    { _id: 'qaKtVstupenka01', name: 'Vstupenková klientka', email: 'qa.kt.vstupenka@qa-biz.local',
      user_type: 'client', active: true, created_at: '2026-08-03', utm_campaign: UTM },
    // leadová kampaň meria cez lead_source, nie cez utm
    { _id: 'qaKtLead000001', name: 'Leadová klientka', email: 'qa.kt.lead@qa-biz.local',
      user_type: 'client', active: true, created_at: '2026-08-04', lead_source: 'qa_leadform' },
  ]);

  w('transactions.db', [
    // 3× jednorazový vstup po 6 € = 18 €
    { _id: 'qaKtTx00000001', user_id: 'qaKtVstupy00001', type: 'single_entry', amount: 6,
      date: '2026-08-10', month: '2026-08', created_at: '2026-08-10T17:00:00.000Z' },
    { _id: 'qaKtTx00000002', user_id: 'qaKtVstupy00001', type: 'single_entry', amount: 6,
      date: '2026-08-17', month: '2026-08', created_at: '2026-08-17T17:00:00.000Z' },
    { _id: 'qaKtTx00000003', user_id: 'qaKtVstupy00001', type: 'single_entry', amount: 6,
      date: '2026-08-24', month: '2026-08', created_at: '2026-08-24T17:00:00.000Z' },
    // súkromná hodina 30 €
    { _id: 'qaKtTx00000004', user_id: 'qaKtVstupy00001', type: 'private_lesson', amount: 30,
      date: '2026-08-26', month: '2026-08', created_at: '2026-08-26T17:00:00.000Z' },
    // vstupenka kupujúcej, ktorá účet má — 10 €
    { _id: 'qaKtTx00000005', user_id: 'qaKtVstupenka01', type: 'event_ticket', amount: 10,
      date: '2026-08-30', month: '2026-08', created_at: '2026-08-30T17:00:00.000Z' },
    // vstupenka kupujúcej BEZ účtu — v transakcii nemá koho, priradí ju objednávka
    { _id: 'qaKtTx00000006', user_id: null, type: 'event_ticket', amount: 25,
      date: '2026-08-31', month: '2026-08', created_at: '2026-08-31T17:00:00.000Z' },
    // leadová klientka kúpila vstup za 8 €
    { _id: 'qaKtTx00000007', user_id: 'qaKtLead000001', type: 'single_entry', amount: 8,
      date: '2026-08-12', month: '2026-08', created_at: '2026-08-12T17:00:00.000Z' },
  ]);

  // členstvo v hotovosti 49,90 €
  w('memberships.db', [
    { _id: 'qaKtMem00000001', user_id: 'qaKtClenstvo001', plan_id: 'bronze', plan_name: 'Bronze',
      status: 'active', price: 49.9, payment_method: 'hotovosť', expires_at: '2026-09-02',
      created_at: '2026-08-02T10:00:00.000Z' },
  ]);

  w('ev_orders.db', [
    // bez účtu → tržbu si vezme kampaň z utm objednávky
    { _id: 'qaKtObj00000001', status: 'paid', total: 25, buyer_name: 'Cudzia návštevníčka',
      buyer_email: 'qa.kt.cudzia@qa-biz.local', user_id: null,
      attr: { utm_campaign: UTM, utm_source: 'fb' },
      paid_at: '2026-08-31T18:00:00.000Z', created_at: '2026-08-31T17:55:00.000Z' },
    // kupujúca s účtom → už je započítaná cez transakciu, tu sa preskočí
    { _id: 'qaKtObj00000002', status: 'paid', total: 10, buyer_name: 'Vstupenková klientka',
      buyer_email: 'qa.kt.vstupenka@qa-biz.local', user_id: 'qaKtVstupenka01',
      attr: { utm_campaign: UTM },
      paid_at: '2026-08-30T18:00:00.000Z', created_at: '2026-08-30T17:55:00.000Z' },
  ]);

  w('campaigns.db', [
    { _id: 'qaKtKampan00001', name: 'QA — kampaň cez utm', platform: 'facebook',
      utm_key: UTM, date_from: '2026-07-01', spend: 100, created_at: '2026-07-01' },
    { _id: 'qaKtKampan00002', name: 'QA — leadová kampaň', platform: 'facebook',
      lead_source_key: 'qa_leadform', date_from: '2026-07-01', spend: 50, created_at: '2026-07-01' },
  ]);

  console.log('TRŽBA PRIRADENÁ KAMPANI\n');

  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 9000));

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.kt.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    const list = (await j('/api/admin/campaigns', {}, adm)).d;
    // server si pri štarte doplní vlastné produkčné karty — kontrolujeme tie naše
    ok('kampane sa načítali', Array.isArray(list) && list.some(c => c._id === 'qaKtKampan00001')
      && list.some(c => c._id === 'qaKtKampan00002'), 'kariet: ' + (list||[]).length);
    const utmK = list.find(c => c._id === 'qaKtKampan00001') || {};
    const leadK = list.find(c => c._id === 'qaKtKampan00002') || {};

    console.log('\n1) Kampaň cez utm vidí všetky druhy tržby:');
    // 18 vstupy + 30 súkromná + 10 vstupenka s účtom + 49,90 členstvo + 25 vstupenka bez účtu
    ok('tržba = 132,90 €', Math.abs((utmK.attributed_revenue || 0) - 132.9) < 0.01,
      String(utmK.attributed_revenue));
    ok('vstupy a súkromná hodina sú v tom', (utmK.attributed_revenue || 0) > 49.9,
      'iba členstvo by bolo 49,90 €');
    ok('platiace sa počítajú (3 účty + 1 bez účtu)', utmK.attributed_payers === 4,
      String(utmK.attributed_payers));

    console.log('\n2) Vstupenka bez účtu:');
    ok('25 € z objednávky sa priradilo kampani', Math.abs((utmK.attributed_revenue || 0) - 132.9) < 0.01);

    console.log('\n3) Žiadne dvojité rátanie:');
    // keby sa objednávka kupujúcej s účtom rátala druhýkrát, vyšlo by 142,90 €
    ok('vstupenka kupujúcej s účtom sa nezapočítala dvakrát',
      Math.abs((utmK.attributed_revenue || 0) - 142.9) > 0.01, String(utmK.attributed_revenue));

    console.log('\n4) Leadová kampaň:');
    ok('tržba cez lead_source = 8 €', Math.abs((leadK.attributed_revenue || 0) - 8) < 0.01,
      String(leadK.attributed_revenue));
    ok('jedna platiaca', leadK.attributed_payers === 1, String(leadK.attributed_payers));

    console.log('\n5) Metriky z toho vychádzajú:');
    ok('ROAS kampane = 1,33× (132,90 / 100)', utmK.metrics && utmK.metrics.roas === 1.33,
      utmK.metrics && String(utmK.metrics.roas));
    ok('CAC = 25 € (100 / 4 platiace)', utmK.metrics && utmK.metrics.cac === 25,
      utmK.metrics && String(utmK.metrics.cac));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nTRŽBA KAMPANE: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-700));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
