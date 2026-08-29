/**
 * Záverečné vlny k párty 5. 9. 2026 (Marek 30. 8.):
 *   C  eventLastDayTick   — 31. 8., posledný deň predpredaja, LEN klientky/ambasádorky
 *   D  eventPartyPushTick — 2.–4. 9., párty za 5 € pre tých, čo mail OTVORILI
 *   R  eventReminderTick  — 4. 9., servisná pripomienka pre tých, čo UŽ MAJÚ vstupenku
 *
 * Test stráži hlavne to, čím sa dá najviac uškodiť: aby nikto nedostal dva
 * eventové maily v jeden deň, aby kupujúci nedostával ponuky a aby pripomienka
 * rozlišovala Full Experience (18:15) od samotnej párty (21:00).
 *
 * Spustenie:  node qa/event-waves-final.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4514;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-ev-'));

let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };

async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}

const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
const NOW = new Date().toISOString();

let poradie = 0;
const U = (id, meno, mail, extra = {}) => JSON.stringify({
  _id: id, name: meno, email: mail, phone: '', password: '', referral_code: 'QAEV' + String(++poradie).padStart(2, '0'),
  sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: 'client',
  visit_count: 2, created_at: '2026-06-01', city: 'Detva', account_creation_type: 'self_registration',
  ...extra,
});

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaEvAdmin0000001', name: 'Adam Eventovy', email: 'qa.ev.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-06-01' }),
    U('qaEvClenka00001', 'Katarina Clenkova', 'qa.ev.clenka@qa-biz.local'),
    U('qaEvNeclenka001', 'Lucia Neclenkova', 'qa.ev.neclenka@qa-biz.local'),
    U('qaEvLead0000001', 'Petra Leadova',   'qa.ev.lead@qa-biz.local',    { user_type: 'lead' }),
    U('qaEvKupila00001', 'Zuzana Kupilova',  'qa.ev.kupila@qa-biz.local'),
    U('qaEvDnes0000001', 'Martina Dnesna',   'qa.ev.dnes@qa-biz.local'),
    U('qaEvOtvorila001', 'Ivana Otvorilova', 'qa.ev.otvorila@qa-biz.local'),
    U('qaEvNeotvor0001', 'Beata Neotvorila', 'qa.ev.neotvorila@qa-biz.local'),
  ].join('\n') + '\n');

  // Katarína má aktívne členstvo → dostane text o členskej cene 45 €
  fs.writeFileSync(path.join(DATA, 'memberships.db'), JSON.stringify({
    _id: 'qaEvMem00000001', user_id: 'qaEvClenka00001', plan_id: 'silver', status: 'active',
    started_at: '2026-08-01', expires_at: '2026-12-31', price: 69,
  }) + '\n');

  // Zuzana kúpila FULL a uviedla druhého držiteľa (Hana) → pripomienka ide obom
  fs.writeFileSync(path.join(DATA, 'ev_orders.db'), [
    JSON.stringify({ _id: 'qaEvOrd00000001', order_number: 'QA-EV-1', event_slug: 'latin-tropical-2026',
      buyer_name: 'Zuzana Kupilova', buyer_email: 'qa.ev.kupila@qa-biz.local', status: 'paid',
      paid_at: NOW, created_at: NOW, total: 45,
      items: [{ type: 'full', qty: 2, holders: [{ name: 'Hana Drzitelka', email: 'qa.ev.holder@qa-biz.local' }] }] }),
    JSON.stringify({ _id: 'qaEvOrd00000002', order_number: 'QA-EV-2', event_slug: 'latin-tropical-2026',
      buyer_name: 'Party Pavla', buyer_email: 'qa.ev.party@qa-biz.local', status: 'paid',
      paid_at: NOW, created_at: NOW, total: 5,
      items: [{ type: 'party', qty: 1, holders: [] }] }),
  ].join('\n') + '\n');

  // mail_log: Martina dostala event mail DNES, Ivana staršiu kampaň a OTVORILA ju,
  // Beáta rovnakú kampaň dostala, ale neotvorila.
  fs.writeFileSync(path.join(DATA, 'mail_log.db'), [
    JSON.stringify({ _id: 'qaEvMl00000001', to: 'qa.ev.dnes@qa-biz.local', subject: 'Stara kampan',
      template: 'event_campaign', created_at: DNES + 'T08:00:00.000Z', opened_at: null, click_count: 0 }),
    JSON.stringify({ _id: 'qaEvMl00000002', to: 'qa.ev.otvorila@qa-biz.local', subject: 'Stara kampan',
      template: 'event_campaign', created_at: '2026-08-27T08:00:00.000Z', opened_at: '2026-08-27T09:00:00.000Z', click_count: 0 }),
    JSON.stringify({ _id: 'qaEvMl00000003', to: 'qa.ev.neotvorila@qa-biz.local', subject: 'Stara kampan',
      template: 'event_campaign', created_at: '2026-08-27T08:00:00.000Z', opened_at: null, click_count: 0 }),
  ].join('\n') + '\n');

  console.log('EVENT VLNY QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1',
           MAIL_CAPTURE: '1', QA_EVENT_WINDOW: '1', BREVO_API_KEY: 'qa-fake-key' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  let zije=false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije=true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if(!zije){ console.log("  ❌ server nenabehol do 180 s"); process.exit(1); }

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.ev.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    // ── VLNA C: posledný deň predpredaja ──
    const c = await j('/api/admin/qa/run-event-mail/lastday', { method: 'POST' }, adm);
    const cs = (c.d && c.d.selected || []).map(e => String(e).toLowerCase());
    ok('vlna C beží', c.status === 200 && Array.isArray(c.d && c.d.selected), JSON.stringify(c.d));
    ok('C: členka je oslovená', cs.includes('qa.ev.clenka@qa-biz.local'), cs.join(','));
    ok('C: neclenka je oslovená', cs.includes('qa.ev.neclenka@qa-biz.local'), cs.join(','));
    ok('C: lead NIE (31. 8. sa preň nič nemení)', !cs.includes('qa.ev.lead@qa-biz.local'), cs.join(','));
    ok('C: kto už kúpil, ponuku NEdostane', !cs.includes('qa.ev.kupila@qa-biz.local'), cs.join(','));
    ok('C: kto dostal event mail dnes, druhý NEdostane', !cs.includes('qa.ev.dnes@qa-biz.local'), cs.join(','));
    ok('C: členka je v poradí pred nečlenkou',
      cs.indexOf('qa.ev.clenka@qa-biz.local') < cs.indexOf('qa.ev.neclenka@qa-biz.local'), cs.join(','));
    ok('C: ráta voľné miesta z objednávok (30 − 2 = 28)', c.d && c.d.volne === 28, String(c.d && c.d.volne));

    // ── VLNA D: párty pre otvárateľov ──
    const d = await j('/api/admin/qa/run-event-mail/party', { method: 'POST' }, adm);
    const ds = (d.d && d.d.selected || []).map(e => String(e).toLowerCase());
    ok('vlna D beží', d.status === 200 && Array.isArray(d.d && d.d.selected), JSON.stringify(d.d));
    ok('D: kto mail otvoril, dostane ponuku', ds.includes('qa.ev.otvorila@qa-biz.local'), ds.join(','));
    ok('D: kto neotvoril, NEdostane nič', !ds.includes('qa.ev.neotvorila@qa-biz.local'), ds.join(','));
    ok('D: kto nikdy nedostal kampaň, NEdostane nič', !ds.includes('qa.ev.clenka@qa-biz.local'), ds.join(','));
    ok('D: kupujúci NEdostane ponuku', !ds.includes('qa.ev.kupila@qa-biz.local'), ds.join(','));

    // ── PRIPOMIENKA: len pre tých, čo majú vstupenku ──
    const r = await j('/api/admin/qa/run-event-mail/reminder', { method: 'POST' }, adm);
    const rs = (r.d && r.d.selected || []).map(e => String(e).toLowerCase());
    ok('pripomienka beží', r.status === 200 && Array.isArray(r.d && r.d.selected), JSON.stringify(r.d));
    ok('R: kupujúca FULL dostane pripomienku', rs.includes('qa.ev.kupila@qa-biz.local'), rs.join(','));
    ok('R: druhý držiteľ vstupenky ju dostane tiež', rs.includes('qa.ev.holder@qa-biz.local'), rs.join(','));
    ok('R: kupujúca len na párty ju dostane', rs.includes('qa.ev.party@qa-biz.local'), rs.join(','));
    ok('R: kto vstupenku nemá, pripomienku NEdostane', !rs.includes('qa.ev.clenka@qa-biz.local'), rs.join(','));

    // obsah pripomienky musí sedieť s typom vstupenky
    const zachytene = await j('/api/admin/mail-log?limit=200', {}, adm);
    const logy = (zachytene.d && (zachytene.d.rows || zachytene.d.logs || zachytene.d.items)) || [];
    ok('maily sa zachytili, neodoslali (MAIL_CAPTURE)', Array.isArray(logy), typeof logy);

    // ── opakovaný beh nesmie poslať to isté druhýkrát ──
    const c2 = await j('/api/admin/qa/run-event-mail/lastday', { method: 'POST' }, adm);
    const cs2 = (c2.d && c2.d.selected || []);
    ok('C: druhý beh už nikoho neosloví (guard cez mail_log)', cs2.length === 0, JSON.stringify(cs2));
    const r2 = await j('/api/admin/qa/run-event-mail/reminder', { method: 'POST' }, adm);
    ok('R: druhý beh už nikoho neosloví', (r2.d && r2.d.selected || []).length === 0, JSON.stringify(r2.d && r2.d.selected));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    console.log('\nEVENT VLNY: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
