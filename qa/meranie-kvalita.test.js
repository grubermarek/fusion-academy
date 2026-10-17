/**
 * Kvalita merania kampaní (17. 10. 2026).
 *
 * Marek: „staré kampane, pri ktorých sa nemerali metriky, nech nejdú do metrík,
 * lebo nepoznáme ich výsledky. Do metrík ako ROAS, CPC a všetky tieto veci nech
 * idú iba kampane, ktoré mali úplné, úspešné a kvalitné meranie."
 *
 * kvalitaMerania() delí kampane na:
 *   plne       — utm + karta v appke + prvá útrata po MERANIE_OD (2026-09)
 *   ciastocne  — niečo z toho chýba, alebo časť peňazí padla pred zavedením merania
 *   ziadne     — ani utm, ani karta (zostávajú mimo zoznamu, v „Minuté" áno)
 *
 * Stráži, že:
 *   · útrata sa nestratí — totals.spend obsahuje aj nemerané kampane
 *   · kliky, CPC, CTR a CPM vychádzajú LEN z plne meraných kampaní
 *   · čiastočne meraná kampaň je v zozname, ale bez odvodených čísel
 *   · kampaň spred zavedenia merania sa do výkonu nedostane ani s utm a kartou
 *
 * Spustenie:  node qa/meranie-kvalita.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4597;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-mkv-'));

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

const kamp = (id, name, extra) => ({ _id: 'qaMkC' + id, platform: 'meta', campaign_id: id, name, status: 'PAUSED',
  objective: 'OUTCOME_SALES', created: '2026-09-01', stop: null, reach: 0, synced_at: '2026-10-17T08:00:00.000Z', ...extra });
const stat = (id, name, month, spend, clicks) => ({ _id: 'qaMkS' + id + month.replace('-', ''), platform: 'meta', campaign_id: id, campaign_name: name,
  month, spend, impressions: clicks * 10, clicks, reach: clicks * 8, leads: 0, synced_at: '2026-10-17T08:00:00.000Z' });

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);

  w('users.db', [
    { _id: 'qaMkAdmin000001', name: 'Marek Gruber', email: 'qa.mk.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
  ]);

  // 1) plne meraná — utm, karta, celé obdobie po zavedení merania
  // 2) bez karty — registrácie nemajú kam spadnúť
  // 3) utm aj karta, ale míňala ešte v júli, keď sa konverzie nepriraďovali
  // 4) ani utm, ani karta a dávno dobehla — mimo zoznamu, peniaze ostávajú
  w('ad_campaigns.db', [
    kamp('900000000001', 'QA — plne meraná', { spend: 100, impressions: 2000, clicks: 200, leads: 0, first_month: '2026-10', last_month: '2026-10', ma_utm: true }),
    kamp('900000000002', 'QA — bez karty', { spend: 50, impressions: 5000, clicks: 500, leads: 0, first_month: '2026-10', last_month: '2026-10', ma_utm: true }),
    kamp('900000000003', 'QA — spred merania', { spend: 40, impressions: 4000, clicks: 400, leads: 0, first_month: '2026-07', last_month: '2026-10', ma_utm: true }),
    kamp('900000000004', 'QA — bez utm aj karty', { spend: 30, impressions: 3000, clicks: 300, leads: 0, first_month: '2026-05', last_month: '2026-05', ma_utm: false }),
  ]);

  w('ad_stats.db', [
    stat('900000000001', 'QA — plne meraná', '2026-10', 100, 200),
    stat('900000000002', 'QA — bez karty', '2026-10', 50, 500),
    stat('900000000003', 'QA — spred merania', '2026-07', 20, 200),
    stat('900000000003', 'QA — spred merania', '2026-10', 20, 200),
    stat('900000000004', 'QA — bez utm aj karty', '2026-05', 30, 300),
  ]);

  // karty v appke: len pre #1 a #3
  w('campaigns.db', [
    { _id: 'qaMkKarta000001', name: 'QA — plne meraná', platform: 'facebook', utm_key: 'qa-plne*',
      meta_campaign_id: '900000000001', date_from: '2026-10-01', created_at: '2026-10-01' },
    { _id: 'qaMkKarta000003', name: 'QA — spred merania', platform: 'facebook', utm_key: 'qa-stara*',
      meta_campaign_id: '900000000003', date_from: '2026-07-01', created_at: '2026-07-01' },
  ]);

  console.log('KVALITA MERANIA KAMPANÍ\n');

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
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.mk.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    const a = (await j('/api/admin/ads/overview?month=all', {}, adm)).d || {};
    const t = a.totals || {};
    const r = id => (a.rows || []).find(x => x.campaign_id === id) || {};

    console.log('\n1) Peniaze sa nestratia:');
    ok('minuté = 220 € (aj nemerané)', Math.abs((t.spend || 0) - 220) < 0.01, String(t.spend));
    ok('nemeraná kampaň je mimo zoznamu', !(a.rows || []).some(x => x.campaign_id === '900000000004'));
    ok('ale nájde sa medzi nemeranými', (a.skryte_riadky || []).some(x => x.campaign_id === '900000000004'));
    ok('jej útrata je vykázaná zvlášť (30 €)', Math.abs(((t.nemerane || {}).spend || 0) - 30) < 0.01,
      JSON.stringify(t.nemerane));

    console.log('\n2) Do metrík ide len plné meranie:');
    ok('kliky = 200 (len plne meraná)', t.clicks === 200, String(t.clicks));
    ok('útrata v metrikách = 100 €', Math.abs((t.spend_merany || 0) - 100) < 0.01, String(t.spend_merany));
    ok('CPC = 0,50 € (100 / 200)', t.cpc === 0.5, String(t.cpc));
    ok('CTR = 10 % (200 / 2000)', t.ctr === 10, String(t.ctr));
    ok('počet meraných kampaní = 1', t.kampani_merane === 1, String(t.kampani_merane));

    console.log('\n3) Čiastočné meranie: v zozname, ale bez čísel:');
    ok('kampaň bez karty je čiastočná', r('900000000002').meranie === 'ciastocne', r('900000000002').meranie);
    ok('a nemá CPC', r('900000000002').cpc === null, String(r('900000000002').cpc));
    ok('kampaň spred merania je čiastočná aj s utm a kartou',
      r('900000000003').meranie === 'ciastocne', r('900000000003').meranie);
    ok('a nemá CTR', r('900000000003').ctr === null, String(r('900000000003').ctr));
    ok('plne meraná má meranie „plne"', r('900000000001').meranie === 'plne', r('900000000001').meranie);
    ok('a CPC si drží', r('900000000001').cpc === 0.5, String(r('900000000001').cpc));
    ok('čiastočné sú spočítané zvlášť (2 za 90 €)',
      (t.nemerane || {}).ciastocne_kampani === 2 && Math.abs(((t.nemerane || {}).ciastocne_spend || 0) - 90) < 0.01,
      JSON.stringify(t.nemerane));

    console.log('\n4) ROAS nevychádza z tržby celej appky:');
    ok('základ ROAS je kohorta reklamy', t.roas_zaklad === 'kohorta_reklamy', String(t.roas_zaklad));
    ok('bez klientok z reklamy je ROAS 0 alebo prázdny', t.roas === null || t.roas === 0, String(t.roas));

    console.log('\n5) Mesačný rad:');
    const okt = (a.rad || []).find(x => x.month === '2026-10') || {};
    ok('október: minuté 170 €', Math.abs((okt.spend || 0) - 170) < 0.01, String(okt.spend));
    ok('október: v metrikách len 100 €', Math.abs((okt.spend_merany || 0) - 100) < 0.01, String(okt.spend_merany));
    ok('október: kliky len 200', okt.clicks === 200, String(okt.clicks));
    const maj = (a.rad || []).find(x => x.month === '2026-05') || {};
    ok('máj: 30 € je celé v nemeraných', Math.abs((maj.nemerane || 0) - 30) < 0.01, String(maj.nemerane));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nKVALITA MERANIA: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-700));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
