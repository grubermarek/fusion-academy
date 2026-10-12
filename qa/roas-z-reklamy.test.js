/**
 * ROAS z reklamy — čisté čísla (Marek 12. 10. 2026).
 *
 * Marek: „ten ROAS nemôže byť 16× z reklamy… chcem čisté dáta vidieť, čo mi
 * prináša reklama, nie že sa ROAS tvorí aj z iných zdrojov príjmov."
 *
 * Mesačný prehľad dovtedy pároval útratu s tržbou CELEJ appky — v ROAS-e teda
 * boli aj členstvá stálych klientok, importovaných ľudí z Glofoxu a nákupy
 * z mailov. Teraz sa k útrate ráta len tržba od ľudí, ktorí v tom mesiaci
 * prišli Z REKLAMY (utm_campaign, fbclid, gclid alebo platený lead_source).
 *
 * Stráži, že do kohorty sa dostane len reklama a nič iné:
 *   · klientka s utm_campaign ÁNO · s fbclid ÁNO · s gclid ÁNO
 *   · organická registrácia NIE · import z Glofoxu NIE · klik z mailu NIE
 *   · test účet NIE · tréner/admin NIE
 *   · tržba spred príchodu sa neráta, tržba po ňom áno
 *   · ROAS = tržba kohorty ÷ útrata (nie tržba appky ÷ útrata)
 *
 * Spustenie:  node qa/roas-z-reklamy.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4607;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-roas-'));
const TOKEN = 'qa-roas-token-123';

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
async function j(url, opts) {
  const r = await fetch(BASE + url, { method: (opts && opts.method) || 'GET',
    headers: { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) } });
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}

// Mesiac kohorty musí byť relatívny k dnešku, inak test o pár mesiacov zhnije.
const d0 = new Date(); d0.setUTCDate(1); d0.setUTCMonth(d0.getUTCMonth() - 4);
const M = d0.toISOString().slice(0, 7);          // mesiac, v ktorom prišli z reklamy
const D = M + '-10';                              // deň registrácie
const PRED = M + '-02';                           // deň pred príchodom
const PO = (() => { const x = new Date(Date.parse(D) + 20 * 864e5); return x.toISOString().slice(0, 10); })();

(async () => {
  const klient = (id, meno, extra) => ({ _id: id, name: meno, email: id + '@qa-biz.local',
    user_type: 'client', active: true, created_at: D, registration_at: D + 'T10:00:00.000Z',
    account_creation_type: 'self_registration', ...extra });

  w('users.db', [
    { _id: 'qaRoasAdmin', name: 'QA Admin', email: 'qa.roas.admin@qa-biz.local', is_admin: true,
      user_type: 'admin', active: true, created_at: '2026-01-01' },
    // ── patria do kohorty ──
    klient('qaRoasUtm', 'Utmova Jana', { utm_campaign: 'fa-video-hej-baby', utm_source: 'fb', utm_medium: 'cpc' }),
    klient('qaRoasFb', 'Fbclid Eva', { fbclid: 'IwAR_qa_1' }),
    klient('qaRoasGc', 'Gclid Lucia', { gclid: 'Cj0KCQ_qa' }),
    klient('qaRoasLead', 'Leadform Petra', { lead_source: 'meta_leadform', account_creation_type: 'meta_leadform', lead_at: D + 'T09:00:00.000Z' }),
    // ── NEpatria ──
    klient('qaRoasOrg', 'Organicka Zuzka', {}),                                     // bez značiek
    klient('qaRoasMail', 'Mailova Katka', { utm_campaign: 'newsletter-okt', utm_source: 'brevo', utm_medium: 'email' }),
    klient('qaRoasImport', 'Importovana Maria', { utm_campaign: 'fa-video-hej-baby', account_creation_type: 'import', lead_source: 'glofox', imported: true }),
    klient('qaRoasTest', 'Testovaci Ucet', { utm_campaign: 'fa-video-hej-baby', lead_source: 'test' }),
    klient('qaRoasTrener', 'Trenerka Nela', { utm_campaign: 'fa-video-hej-baby', user_type: 'trainer' }),
  ]);

  // Tržby: kohorta zaplatí 150 €, ostatní 1 000 € (tí v ROAS-e nemajú čo robiť)
  w('payments.db', [
    { _id: 'qaRoasP1', user_id: 'qaRoasUtm', amount: 100, status: 'completed', method: 'card',
      description: 'Členstvo Bronze', captured_at: PO + 'T10:00:00.000Z', created_at: PO + 'T10:00:00.000Z' },
    { _id: 'qaRoasP2', user_id: 'qaRoasFb', amount: 50, status: 'completed', method: 'card',
      description: 'Vstup', captured_at: PO + 'T11:00:00.000Z', created_at: PO + 'T11:00:00.000Z' },
    // zaplatila EŠTE PRED tým, než prišla z reklamy — do kohorty nepatrí
    { _id: 'qaRoasP3', user_id: 'qaRoasGc', amount: 777, status: 'completed', method: 'card',
      description: 'Stará platba', captured_at: PRED + 'T10:00:00.000Z', created_at: PRED + 'T10:00:00.000Z' },
    // ostatní — tvorili ten falošný ROAS 16×
    { _id: 'qaRoasP4', user_id: 'qaRoasOrg', amount: 400, status: 'completed', method: 'card',
      description: 'Členstvo Gold', captured_at: PO + 'T10:00:00.000Z', created_at: PO + 'T10:00:00.000Z' },
    { _id: 'qaRoasP5', user_id: 'qaRoasMail', amount: 300, status: 'completed', method: 'card',
      description: 'Členstvo Silver', captured_at: PO + 'T10:00:00.000Z', created_at: PO + 'T10:00:00.000Z' },
    { _id: 'qaRoasP6', user_id: 'qaRoasImport', amount: 300, status: 'completed', method: 'card',
      description: 'Členstvo Bronze', captured_at: PO + 'T10:00:00.000Z', created_at: PO + 'T10:00:00.000Z' },
  ]);

  w('ad_campaigns.db', [
    { _id: 'qaRoasC1', platform: 'meta', campaign_id: '901', name: 'QA — Video HEJ BABY',
      status: 'PAUSED', objective: 'OUTCOME_TRAFFIC', created: D,
      first_month: M, last_month: M, ma_utm: true },
  ]);
  w('ad_stats.db', [
    { _id: 'qaRoasS1', platform: 'meta', campaign_id: '901', campaign_name: 'QA — Video HEJ BABY',
      month: M, spend: 100, impressions: 10000, clicks: 500, reach: 4000, leads: 0 },
  ]);
  w('campaigns.db', [
    { _id: 'qaRoasK1', name: 'QA — karta', platform: 'facebook', meta_campaign_id: '901',
      utm_key: 'fa-video-hej-baby', date_from: D, spend: 100, created_at: D },
  ]);

  console.log('ROAS Z REKLAMY\n');
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

  try {
    const d = (await j('/api/service/ads-overview?month=all', { headers: { 'x-import-token': TOKEN } })).d;
    ok('prehľad prišiel', d && d.ok, JSON.stringify(d).slice(0, 200));
    const r = (d.rad || []).find(x => x.month === M);
    ok('mesiac kohorty je v rade', !!r, (d.rad || []).map(x => x.month).join(','));

    ok('do kohorty idú len 4 z reklamy (utm, fbclid, gclid, leadform)', r.acquired === 4, 'acquired=' + r.acquired);
    ok('platiace z kohorty sú 2 (tretia zaplatila pred príchodom)', r.payers === 2, 'payers=' + r.payers);
    ok('tržba kohorty = 150 € (100 + 50), nie 1 927 €', r.cohort_revenue === 150, 'cohort_revenue=' + r.cohort_revenue);
    ok('ROAS z reklamy = 1,5× (150 ÷ 100)', r.cohort_roas === 1.5, 'cohort_roas=' + r.cohort_roas);
    ok('cena za klientku = 25 € (100 ÷ 4)', r.cohort_cac === 25, 'cohort_cac=' + r.cohort_cac);
    ok('tržba do 90 dní sedí s celkovou (kohorta je mladá)', r.cohort_rev90 === 150, 'rev90=' + r.cohort_rev90);
    ok('kohorta staršia ako 90 dní nie je označená ako mladá', r.mlada === false, 'mlada=' + r.mlada);

    // to, čo Mareka zarazilo: stará tržba appky je rádovo inde
    ok('tržba celej appky je oveľa vyššia (preto ROAS 16×)', r.revenue > 1000, 'revenue=' + r.revenue);
    ok('starý ROAS z tržby appky je nafúknutý', r.roas > 10 && r.cohort_roas < r.roas, 'roas=' + r.roas + ' vs ' + r.cohort_roas);

    // mesiac bez reklamy nesmie vyrobiť kohortu z ničoho
    const iny = (d.rad || []).filter(x => x.month !== M);
    ok('ostatné mesiace majú kohortu prázdnu', iny.every(x => !x.acquired && !x.cohort_revenue), JSON.stringify(iny.map(x => [x.month, x.acquired])));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill(); await new Promise(r => setTimeout(r, 500));
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nROAS Z REKLAMY: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
  }
})();
