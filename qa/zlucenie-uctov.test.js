/**
 * Zlúčenie dvoch účtov jednej klientky (9. 9. 2026).
 *
 * Marek: „Danielka Kováčiková má dva účty, tak jej ich zlúč do jedného
 * s tým, že jej nechaj ten od gmailu."
 *
 * Zlučovanie bolo doteraz len pod adminAuth a vynechávalo kolekcie, ktoré
 * medzitým pribudli (koleso, hlavolamy, fronta mailov, kredit, vstupenky,
 * objednávky viazané e-mailom). Test stráži, že sa po zlúčení nestratí nič
 * z histórie ani z peňazí.
 *
 * Stráži, že:
 *   · servisná cesta bez tokenu je neviditeľná (404)
 *   · peniaze (platby, transakcie, faktúry) prejdú na cieľový účet
 *   · dochádzka, koleso, hlavolamy, kredit a vstupenky prejdú tiež
 *   · objednávky viazané e-mailom sa neodpoja
 *   · čakajúce maily sa zrušia (klientke nesmie odísť sekvencia druhýkrát)
 *   · odoslané maily ostanú ako história
 *   · downline (kto mal duplicitu za sponzora) sa prepojí na cieľ
 *   · heslo z duplicitného účtu sa nestratí, keď cieľ žiadne nemá
 *   · stará adresa ostane dohľadateľná v merged_emails
 *   · „členom od" je skorší z oboch dátumov
 *   · zdrojový účet zmizne a klientka je v systéme raz
 *   · admin účet ani zlúčenie so sebou samým neprejde
 *
 * Spustenie:  node qa/zlucenie-uctov.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4593;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-zluc-'));
const TOKEN = 'qa-zluc-token-123';

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
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const CIEL = 'qaZlucCiel00001';   // účet „od gmailu" — ostáva
  const DUPL = 'qaZlucDupl00001';   // duplicita — zaniká
  const DIETA = 'qaZlucDieta0001';  // má duplicitu za sponzora

  w('users.db', [
    { _id: 'qaZlucAdmin0001', name: 'Marek Gruber', email: 'qa.zluc.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    // cieľ: reálny gmail, ale bez hesla a bez telefónu — obe si nastavila na duplicite
    { _id: CIEL, name: 'Daniela Kováčiková', email: 'qa.daniela@qa-biz.local',
      user_type: 'client', active: true, created_at: '2026-04-21',
      visit_count: 1, single_entries: 0, free_credits: 0, referral_credit: 0 },
    // duplicita: staršia, s heslom, telefónom, kreditom a vstupmi
    { _id: DUPL, name: 'Daniela Kováčikova', email: 'qa.daniela.dupl@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2025-06-24',
      phone: '0911579597', city: 'Brezno', birthday: '2008-06-13',
      visit_count: 4, single_entries: 2, free_credits: 1, referral_credit: 7.5,
      manual_achievements: ['prva_hodina'], free_class_used: true },
    { _id: DIETA, name: 'Kamarátka z odporúčania', email: 'qa.kamaratka@qa-biz.local',
      user_type: 'client', active: true, created_at: '2026-05-01', sponsor_id: DUPL },
  ]);

  w('classes.db', [{ _id: 'qaZlucTrieda001', name: 'Zumba', location: 'Brezno',
    day_of_week: 2, time: '18:00', active: true, price: 5, capacity: 20 }]);

  w('bookings.db', [
    { _id: 'qaZlucRez000001', user_id: CIEL, class_id: 'qaZlucTrieda001', booking_date: '2026-09-08',
      status: 'attended', attendance_status: 'attended', created_at: '2026-09-08T16:00:00.000Z' },
    { _id: 'qaZlucRez000002', user_id: DUPL, class_id: 'qaZlucTrieda001', booking_date: '2026-08-04',
      status: 'attended', attendance_status: 'attended', created_at: '2026-08-04T16:00:00.000Z' },
    { _id: 'qaZlucRez000003', user_id: DUPL, class_id: 'qaZlucTrieda001', booking_date: '2026-07-28',
      status: 'attended', attendance_status: 'attended', created_at: '2026-07-28T16:00:00.000Z' },
  ]);

  w('payments.db', [
    { _id: 'qaZlucPlat00001', user_id: DUPL, amount: 49.9, status: 'completed', method: 'cash',
      created_at: '2025-10-21T10:00:00.000Z' },
    { _id: 'qaZlucPlat00002', user_id: DUPL, amount: 49.9, status: 'completed', method: 'card',
      created_at: '2025-11-27T10:00:00.000Z' },
  ]);

  w('transactions.db', [
    { _id: 'qaZlucTrx000001', user_id: DUPL, client_id: DUPL, amount: 10, type: 'single_entry',
      date: '2026-08-04', month: '2026-08', created_at: '2026-08-04T16:05:00.000Z' },
  ]);

  w('invoices.db', [
    { _id: 'qaZlucFakt00001', number: '20260099', user_id: DUPL, total: 10,
      issue_date: '2026-08-04', created_at: '2026-08-04T16:05:00.000Z' },
  ]);

  // objednávka z e-shopu — viaže sa e-mailom, nie user_id
  w('orders.db', [
    { _id: 'qaZlucObj000001', client_email: 'qa.daniela.dupl@qa-biz.local', client_name: 'Daniela Kováčikova',
      total: 25, status: 'paid', paid_at: '2026-06-10T10:00:00.000Z', created_at: '2026-06-10T09:00:00.000Z' },
  ]);

  w('spins.db', [{ _id: 'qaZlucSpin00001', user_id: DUPL, date: '2026-08-04', month: '2026-08',
    prize: 'p10', points: 10, created_at: '2026-08-04T08:31:00.000Z' }]);

  w('puzzle_solves.db', [{ _id: 'qaZlucPuz000001', user_id: DUPL, date: '2026-08-05',
    type: 'words', solved: true, created_at: '2026-08-05T07:00:00.000Z' }]);

  w('credit_ledger.db', [{ _id: 'qaZlucKred00001', user_id: DUPL, delta: 7.5, balance: 7.5,
    reason: 'Odporúčanie', created_at: '2026-07-01T10:00:00.000Z' }]);

  w('ev_tickets.db', [{ _id: 'qaZlucVstup0001', user_id: DUPL, event_slug: 'latin-tropic',
    type: 'full', status: 'paid', price: 5, created_at: '2026-09-01T10:00:00.000Z' }]);

  w('notifications.db', [
    { _id: 'qaZlucNoti00001', user_id: DUPL, text: 'Vitaj v appke', created_at: '2026-07-01T10:00:00.000Z' },
    { _id: 'qaZlucNoti00002', user_id: CIEL, text: 'Zapísali sme ti hodinu', created_at: '2026-09-08T18:00:00.000Z' },
  ]);

  w('email_queue.db', [
    { _id: 'qaZlucMail00001', user_id: DUPL, sequence: 'winback', step_id: 'stepA',
      scheduled_for: '2026-07-26', status: 'sent', sent_at: '2026-07-26T09:48:00.000Z', created_at: '2026-07-22T16:55:00.000Z' },
    { _id: 'qaZlucMail00002', user_id: DUPL, sequence: 'winback', step_id: 'stepB',
      scheduled_for: '2026-09-20', status: 'pending', created_at: '2026-07-22T16:55:00.000Z' },
    { _id: 'qaZlucMail00003', user_id: DUPL, sequence: 'winback', step_id: 'stepC',
      scheduled_for: '2026-09-27', status: 'pending', created_at: '2026-07-22T16:55:00.000Z' },
  ]);

  console.log('ZLÚČENIE ÚČTOV\n');

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
    ok('bez tokenu 404', (await j('/api/service/merge-users', { method: 'POST', body: { source_id: DUPL, target_id: CIEL } })).status === 404);
    ok('so zlým tokenom 404', (await j('/api/service/merge-users', { method: 'POST', headers: { 'x-import-token': 'zle' }, body: { source_id: DUPL, target_id: CIEL } })).status === 404);

    console.log('\n2) Poistky:');
    ok('účet sám so sebou neprejde',
      (await j('/api/service/merge-users', { method: 'POST', headers: T, body: { source_id: CIEL, target_id: CIEL } })).status === 400);
    ok('admin účet sa zlúčiť nedá',
      (await j('/api/service/merge-users', { method: 'POST', headers: T, body: { source_id: 'qaZlucAdmin0001', target_id: CIEL } })).status === 400);
    ok('neznámy účet je 404',
      (await j('/api/service/merge-users', { method: 'POST', headers: T, body: { source_id: 'nieje', target_id: CIEL } })).status === 404);

    console.log('\n3) Zlúčenie:');
    const r = await j('/api/service/merge-users', { method: 'POST', headers: T, body: { source_id: DUPL, target_id: CIEL } });
    ok('prešlo', r.status === 200 && r.d && r.d.ok, JSON.stringify(r.d));
    ok('vrátilo, čo sa prenieslo', r.d && r.d.prenesene && Object.keys(r.d.prenesene).length > 5,
      JSON.stringify(r.d && r.d.prenesene));

    await new Promise(res => setTimeout(res, 800));
    const users = rd('users.db');
    const ciel = users.find(u => u._id === CIEL);

    console.log('\n4) Klientka je v systéme raz:');
    ok('duplicita zmizla', !users.find(u => u._id === DUPL));
    ok('cieľový účet ostal', !!ciel);
    ok('a je to ten od gmailu', ciel && ciel.email === 'qa.daniela@qa-biz.local', ciel && ciel.email);

    console.log('\n5) Peniaze prešli:');
    const pl = rd('payments.db').filter(p => p.user_id === CIEL);
    ok('obe platby (99,80 €) sú na cieli', pl.length === 2 && Math.abs(pl.reduce((s, p) => s + p.amount, 0) - 99.8) < 0.01,
      pl.length + ' platieb');
    ok('transakcia prešla vrátane client_id',
      rd('transactions.db').every(t => t.user_id === CIEL && t.client_id === CIEL));
    ok('faktúra prešla', rd('invoices.db')[0].user_id === CIEL);
    const obj = rd('orders.db')[0];
    ok('objednávka viazaná e-mailom sa neodpojila',
      obj.client_email === 'qa.daniela@qa-biz.local' && obj.user_id === CIEL,
      obj.client_email + ' / ' + obj.user_id);

    console.log('\n6) História a body prešli:');
    ok('všetky 3 rezervácie sú na cieli', rd('bookings.db').filter(b => b.user_id === CIEL).length === 3);
    ok('koleso prešlo', rd('spins.db')[0].user_id === CIEL);
    ok('hlavolam prešiel', rd('puzzle_solves.db')[0].user_id === CIEL);
    ok('kredit prešiel', rd('credit_ledger.db')[0].user_id === CIEL);
    ok('vstupenka prešla', rd('ev_tickets.db')[0].user_id === CIEL);
    const noti = rd('notifications.db');
    ok('upozornenia prešli', ['qaZlucNoti00001', 'qaZlucNoti00002']
      .every(id => (noti.find(n => n._id === id) || {}).user_id === CIEL));

    console.log('\n7) Maily klientke neodídu druhýkrát:');
    // Server si počas behu doplní ďalšie kroky sekvencií, preto sa kontrolujú
    // konkrétne nasadené riadky, nie počty.
    const eq = rd('email_queue.db');
    const mq = id => eq.find(x => x._id === id) || {};
    ok('čakajúce sú zrušené', mq('qaZlucMail00002').status === 'cancelled' && mq('qaZlucMail00003').status === 'cancelled',
      mq('qaZlucMail00002').status + ' / ' + mq('qaZlucMail00003').status);
    ok('dôvod je zapísaný', mq('qaZlucMail00002').cancel_reason === 'zlúčenie účtov');
    ok('odoslaný ostal ako história', mq('qaZlucMail00001').status === 'sent');
    ok('žiadny mail neostal pod zmazaným účtom', !eq.some(x => x.user_id === DUPL));
    ok('a celá fronta je pod cieľovým účtom', eq.every(x => x.user_id === CIEL));

    console.log('\n8) Súčty na cieľovom účte:');
    ok('návštevy sa spočítali (1 + 4)', ciel.visit_count === 5, 'visit_count=' + ciel.visit_count);
    ok('vstupy sa spočítali', ciel.single_entries === 2, String(ciel.single_entries));
    ok('kredit zdarma sa preniesol', ciel.free_credits === 1, String(ciel.free_credits));
    ok('referral kredit sa preniesol', Math.abs(ciel.referral_credit - 7.5) < 0.01, String(ciel.referral_credit));
    ok('odznaky sa preniesli', (ciel.manual_achievements || []).includes('prva_hodina'));
    ok('telefón sa doplnil z duplicity', ciel.phone === '0911579597', ciel.phone);
    ok('narodeniny sa doplnili', ciel.birthday === '2008-06-13', ciel.birthday);
    ok('„členom od" je skorší dátum', ciel.created_at === '2025-06-24', ciel.created_at);
    ok('prvá hodina zdarma ostáva použitá', ciel.free_class_used === true);

    console.log('\n9) Prihlásenie a dohľadanie:');
    ok('heslo z duplicity sa nestratilo', !!ciel.password);
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.daniela@qa-biz.local', password: 'Heslo123!' } }, {});
    ok('klientka sa prihlási pod gmailom', lg.status === 200, JSON.stringify(lg.d));
    ok('stará adresa je dohľadateľná', (ciel.merged_emails || []).includes('qa.daniela.dupl@qa-biz.local'),
      JSON.stringify(ciel.merged_emails));
    ok('zlúčený účet je zaznamenaný', (ciel.merged_accounts || []).includes(DUPL));

    console.log('\n10) Sieť odporúčaní:');
    ok('kamarátka má za sponzora cieľ', (users.find(u => u._id === DIETA) || {}).sponsor_id === CIEL);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nZLÚČENIE ÚČTOV: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-700));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
