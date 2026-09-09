/**
 * Prehľad celého reklamného účtu (9. 9. 2026).
 *
 * Marek: „stiahni mi štatistiky všetkých kampaní do appky a ukáž presné
 * výsledky… sprav v nich prehľad a nájdi, či nie sú niekde chyby alebo
 * možnosti zlepšenia."
 *
 * Appka dovtedy poznala len kampane, ku ktorým si niekto založil kartu —
 * 7 zo 130 v Meta účte. Zvyšok minutých peňazí nebol nikde vidieť.
 *
 * Stráži, že:
 *   · prehľad sčíta VŠETKY kampane z registra, nie len tie s kartou
 *   · prepínanie mesiacov ráta len riadky daného mesiaca
 *   · kampaň bez výdaja v danom mesiaci sa v ňom nezobrazí
 *   · CPC, CTR, CPM a cena za lead sedia na cent
 *   · mesačný rad páruje reklamu s tržbou appky a ROAS-om
 *   · diery sa pomenujú: koľko kampaní beží bez utm a koľko bez karty
 *   · servisná cesta je bez tokenu neviditeľná
 *
 * Spustenie:  node qa/reklama-prehlad.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4594;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-ads-'));
const TOKEN = 'qa-ads-token-123';

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts) {
  const headers = { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) };
  const r = await fetch(BASE + url, { method: (opts && opts.method) || 'GET', headers, body: opts && opts.body ? JSON.stringify(opts.body) : undefined });
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);

  w('users.db', [
    { _id: 'qaAdsAdmin00001', name: 'Marek Gruber', email: 'qa.ads.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    { _id: 'qaAdsKlient0001', name: 'Klientka z reklamy', email: 'qa.ads.klient@qa-biz.local',
      user_type: 'client', active: true, created_at: '2026-08-01', utm_campaign: 'fa-qa-web' },
  ]);
  // tržba appky za august — proti nej sa v prehľade porovnáva reklama
  w('payments.db', [
    { _id: 'qaAdsPlatba0001', user_id: 'qaAdsKlient0001', amount: 100, status: 'completed',
      method: 'card', created_at: '2026-08-15T10:00:00.000Z' },
  ]);

  // register kampaní: dve s kartou, jedna doboostovaná bez karty a bez utm
  w('ad_campaigns.db', [
    { _id: 'qaAdsC1', platform: 'meta', campaign_id: '111', name: 'FA — Zumba Web',
      status: 'PAUSED', objective: 'OUTCOME_TRAFFIC', created: '2026-07-27',
      first_month: '2026-07', last_month: '2026-08', ma_utm: true },
    { _id: 'qaAdsC2', platform: 'meta', campaign_id: '222', name: 'FA — Zumba Leady',
      status: 'ACTIVE', objective: 'OUTCOME_LEADS', created: '2026-06-14',
      first_month: '2026-08', last_month: '2026-08', ma_utm: true },
    { _id: 'qaAdsC3', platform: 'meta', campaign_id: '333', name: 'Príspevok: „Tancuj s nami"',
      status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT', created: '2026-07-01',
      first_month: '2026-07', last_month: '2026-07', ma_utm: false },
  ]);
  // mesačné čísla
  w('ad_stats.db', [
    { _id: 'qaAdsS1', platform: 'meta', campaign_id: '111', campaign_name: 'FA — Zumba Web',
      month: '2026-07', spend: 100, impressions: 50000, clicks: 1000, reach: 20000, leads: 0 },
    { _id: 'qaAdsS2', platform: 'meta', campaign_id: '111', campaign_name: 'FA — Zumba Web',
      month: '2026-08', spend: 50, impressions: 20000, clicks: 500, reach: 9000, leads: 0 },
    { _id: 'qaAdsS3', platform: 'meta', campaign_id: '222', campaign_name: 'FA — Zumba Leady',
      month: '2026-08', spend: 150, impressions: 30000, clicks: 750, reach: 12000, leads: 30 },
    { _id: 'qaAdsS4', platform: 'meta', campaign_id: '333', campaign_name: 'Príspevok: „Tancuj s nami"',
      month: '2026-07', spend: 80, impressions: 40000, clicks: 400, reach: 15000, leads: 0 },
    // kampaň, ktorá už bola v Mete zmazaná — v registri nie je, peniaze minula
    { _id: 'qaAdsS5', platform: 'meta', campaign_id: '444', campaign_name: 'Zmazaná kampaň',
      month: '2026-07', spend: 20, impressions: 5000, clicks: 100, reach: 3000, leads: 0 },
  ]);
  // karty existujú len pre prvé dve kampane
  w('campaigns.db', [
    { _id: 'qaAdsK1', name: 'QA — karta Web', platform: 'facebook',
      meta_campaign_id: '111', date_from: '2026-07-27', spend: 150, created_at: '2026-07-27' },
    { _id: 'qaAdsK2', name: 'QA — karta Leady', platform: 'facebook',
      meta_campaign_id: '222', date_from: '2026-06-14', spend: 150, created_at: '2026-06-14' },
  ]);

  console.log('PREHĽAD REKLAMY\n');

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
    console.log('1) Servisná cesta:');
    ok('bez tokenu 404', (await j('/api/service/ads-overview')).status === 404);
    ok('so zlým tokenom 404', (await j('/api/service/ads-overview', { headers: { 'x-import-token': 'zle' } })).status === 404);

    console.log('\n2) Celá história:');
    const all = (await j('/api/service/ads-overview?month=all', { headers: T })).d;
    ok('prehľad prišiel', all && all.ok, JSON.stringify(all).slice(0, 200));
    ok('sčítalo všetky štyri kampane, aj tú bez karty a zmazanú', all.rows.length === 4, 'rows=' + all.rows.length);
    ok('minuté = 400 € (vrátane zmazanej kampane)', all.totals.spend === 400, String(all.totals.spend));
    ok('kliky = 2 750', all.totals.clicks === 2750, String(all.totals.clicks));
    ok('CPC sedí (400/2750)', all.totals.cpc === 0.15, String(all.totals.cpc));
    ok('CTR sedí (2750/145000)', all.totals.ctr === 1.9, String(all.totals.ctr));
    ok('CPM sedí', all.totals.cpm === 2.76, String(all.totals.cpm));
    ok('cena za lead sa ráta len z leadovej kampane (150/30)', all.totals.cpl === 5, String(all.totals.cpl));
    ok('zoradené od najdrahšej', all.rows[0].spend >= all.rows[1].spend && all.rows[1].spend >= all.rows[2].spend,
      all.rows.map(r=>r.spend).join(' > '));

    console.log('\n3) Diery, ktoré treba dolepiť:');
    ok('kampaň bez utm je pomenovaná', all.diery.bez_utm === 1, String(all.diery.bez_utm));
    ok('a s ňou aj suma, ktorú prehltla', all.diery.bez_utm_spend === 80, String(all.diery.bez_utm_spend));
    ok('kampane bez karty sú pomenované', all.diery.bez_karty === 2, String(all.diery.bez_karty));
    ok('zmazaná kampaň sa v prehľade nestratila',
      (all.rows.find(r => r.campaign_id === '444') || {}).status === 'DELETED');
    ok('karta sa priradila správne',
      (all.rows.find(r => r.campaign_id === '111') || {}).karta === 'QA — karta Web');
    ok('doboostovaný príspevok kartu nemá', (all.rows.find(r => r.campaign_id === '333') || {}).karta === null);

    console.log('\n4) Mesačný rad:');
    const jul = all.rad.find(r => r.month === '2026-07');
    const aug = all.rad.find(r => r.month === '2026-08');
    ok('júl: 200 € reklamy', jul && jul.spend === 200, jul && String(jul.spend));
    ok('august: 200 € reklamy', aug && aug.spend === 200, aug && String(aug.spend));
    ok('august pozná tržbu appky 100 €', aug && aug.revenue === 100, aug && String(aug.revenue));
    ok('a ROAS 0,5× (prerobené)', aug && aug.roas === 0.5, aug && String(aug.roas));
    ok('júl bez tržby má ROAS 0', jul && jul.roas === 0, jul && String(jul.roas));

    console.log('\n5) Prepnutie na mesiac:');
    const m8 = (await j('/api/service/ads-overview?month=2026-08', { headers: T })).d;
    ok('august má len 2 kampane', m8.rows.length === 2, 'rows=' + m8.rows.length);
    ok('minuté v auguste = 200 €', m8.totals.spend === 200, String(m8.totals.spend));
    ok('doboostovaný príspevok z júla tam nie je', !m8.rows.some(r => r.campaign_id === '333'));
    ok('v auguste už žiadna kampaň bez utm nebeží', m8.diery.bez_utm === 0, String(m8.diery.bez_utm));
    ok('tržba za august je 100 €', m8.totals.revenue === 100, String(m8.totals.revenue));
    ok('ROAS augusta 0,5×', m8.totals.roas === 0.5, String(m8.totals.roas));
    ok('ponuka mesiacov obsahuje júl aj august',
      m8.mesiace_k_dispozicii.includes('2026-07') && m8.mesiace_k_dispozicii.includes('2026-08'),
      JSON.stringify(m8.mesiace_k_dispozicii));

    console.log('\n6) Mesiac bez výdaja:');
    const m9 = (await j('/api/service/ads-overview?month=2026-01', { headers: T })).d;
    ok('prázdny mesiac nespadne', m9 && m9.ok);
    ok('a nemá žiadne kampane', m9.rows.length === 0);
    ok('ani minuté peniaze', m9.totals.spend === 0);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nPREHĽAD REKLAMY: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-700));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
