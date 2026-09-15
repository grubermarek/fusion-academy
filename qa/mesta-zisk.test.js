/**
 * Mestá — náklady a zisk (Marek 15. 9. 2026): pre každé mesto koľko stojí a koľko zarába.
 *
 * Overuje na pevnom týždni 7.–13. 9. 2026:
 *  - konané a zrušené hodiny, dochádzka, priemer ľudí
 *  - cesta: Brezno tam a späť 2 × 48,9 km × 13 l/100 km × 0,80 €; BB (17:00) a Zvolen (19:00) v pondelok
 *    = jedna okružná cesta 39,8 + 21,1 + 26,4 km rozdelená podľa vzdialenosti; Detva bez cesty
 *  - nájom Brezno 20 €/hod, Zvolen 15 €/hod; zástup trénerky = 10 € + 1 € za klientku nad 10
 *  - tržby: vstup mestu hodiny (cez rezerváciu), súkromná hodina mestu súkromnej, členstvo mestu,
 *    kde klientka chodila najčastejšie; merch mimo miest
 *  - zisk, zisk na hodinu, hranica (koľko ľudí po 10 € zaplatí hodinu)
 *  - uloženie nákladov v admine sa prejaví vo výpočte; klientka endpoint nevidí
 *  - karta v admine sa vykreslí (prehliadač)
 * Spustenie:  node qa/mesta-zisk.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4597, BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-mesta-'));
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const blizko = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json' };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, redirect: 'manual' });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const kl = (id, name, extra) => ({ _id: id, name, email: id.toLowerCase() + '@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', onboarding_done: true, referral_code: 'QAMZ' + id.slice(4, 9).toUpperCase(), ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaMzAdmin000001', name: 'Adam Admin', email: 'qa.mz.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01', referral_code: 'QAMZAD' },
    { _id: 'qaMzNelka000001', name: 'Nela Trénerka', email: 'qa.mz.nela@qa-biz.local', password: hash, user_type: 'trainer', active: true, created_at: '2026-01-01', referral_code: 'QAMZNE' },
    kl('qaMzZuzka000001', 'Zuzana Zvolenská', { city: 'Detva' }),
    kl('qaMzBea00000001', 'Beáta Breznianska'),
    kl('qaMzDana0000001', 'Dana Detvianska', { city: 'Detva' }),
    kl('qaMzKlient00001', 'Klára Klientka'),
    kl('qaMzStary000001', 'Zuzana Zvolenská (zlúčený účet)'),
    { ...kl('qaMzZuzkaNov001', 'Zuzana Nová'), referral_code: 'QAMZNOVA', merged_accounts: ['qaMzStary000001'] },
  ]));
  const cls = (id, loc, dow, od, doo, extra) => ({ _id: id, name: 'Zumba', category: 'Zumba', instructor: 'Adam Admin', instructor_id: 'qaMzAdmin000001', location: loc, day_of_week: dow, time_start: od, time_end: doo, capacity: 30, price: 10, active: true, created_at: '2026-01-01', ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    cls('qaMzClsBB', 'Banská Bystrica', 1, '17:00', '18:00'),
    cls('qaMzClsZV', 'Zvolen', 1, '19:00', '20:00'),
    cls('qaMzClsBRut', 'Brezno', 2, '19:00', '20:00'),
    cls('qaMzClsBRst', 'Brezno', 4, '19:00', '20:00'),
    cls('qaMzClsDT', 'Detva', 5, '19:00', '20:00'),
    cls('qaMzClsKids', 'Detva', 3, '15:00', '16:00', { category: 'Deti', name: 'Zumba Kids 2', active: true }),
    cls('qaMzClsOnl', 'Online', 3, '19:00', '20:00', { category: 'Online' }),
    cls('qaMzClsSuk', 'Detva / Zvolen / BB / Brezno', 6, '09:00', '18:00', { category: 'Súkromné', name: 'Súkromná lekcia – rezervácia' }),
  ]));
  const bk = (id, cid, den, uid) => ({ _id: id, class_id: cid, booking_date: den, user_id: uid, status: 'attended', attendance_status: 'attended', created_at: den + 'T10:00:00.000Z' });
  const zv = Array.from({ length: 12 }, (_, i) => bk('qaMzBkZv' + i, 'qaMzClsZV', '2026-09-07', i === 0 ? 'qaMzZuzka000001' : i === 1 ? 'qaMzZuzkaNov001' : 'qaMzAnon' + i));
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky([
    ...zv,
    bk('qaMzBkBB1', 'qaMzClsBB', '2026-09-07', 'qaMzAnonB1'), bk('qaMzBkBB2', 'qaMzClsBB', '2026-09-07', 'qaMzAnonB2'),
    bk('qaMzBkBR1', 'qaMzClsBRut', '2026-09-08', 'qaMzBea00000001'),
    bk('qaMzBkDT1', 'qaMzClsDT', '2026-09-11', 'qaMzDana0000001'),
  ]));
  fs.writeFileSync(path.join(DATA, 'class_cancellations.db'), riadky([{ _id: 'qaMzZrus1', class_id: 'qaMzClsBRst', date: '2026-09-10', reason: 'málo ľudí', created_at: '2026-09-09T10:00:00.000Z' }]));
  fs.writeFileSync(path.join(DATA, 'session_instructors.db'), riadky([{ _id: 'qaMzZast1', class_id: 'qaMzClsZV', date: '2026-09-07', instructor_id: 'qaMzNelka000001', instructor_name: 'Nela Trénerka' }]));
  fs.writeFileSync(path.join(DATA, 'private_bookings.db'), riadky([{ _id: 'qaMzPb1', trainer_id: 'qaMzAdmin000001', client_id: 'qaMzDana0000001', client_name: 'Dana Detvianska', date: '2026-09-11', time_start: '17:00', city: 'Detva', price: 25, status: 'completed', created_at: '2026-09-01T10:00:00.000Z' }]));
  fs.writeFileSync(path.join(DATA, 'transactions.db'), riadky([
    { _id: 'qaMzTxVstup', type: 'single_entry', amount: 10, user_id: 'qaMzBea00000001', date: '2026-09-08', payment_method: 'cash', booking_id: 'qaMzBkBR1', note: 'Jednorazový vstup', created_at: '2026-09-08T18:00:00.000Z' },
    { _id: 'qaMzTxClen', type: 'membership', amount: 49.9, user_id: 'qaMzZuzka000001', date: '2026-09-08', payment_method: 'cash', plan_id: 'bronze', created_at: '2026-09-08T18:00:00.000Z' },
    { _id: 'qaMzTxSuk', type: 'private_lesson', amount: 25, user_id: 'qaMzDana0000001', date: '2026-09-11', method: 'cash', private_booking_id: 'qaMzPb1', created_at: '2026-09-11T18:00:00.000Z' },
    { _id: 'qaMzTxStary', type: 'membership', amount: 40, user_id: 'qaMzStary000001', date: '2026-09-09', payment_method: 'cash', plan_id: 'bronze', created_at: '2026-09-09T18:00:00.000Z' },
    { _id: 'qaMzTxKids', type: 'membership', amount: 50, user_name: 'Timka (Zumba Kids)', date: '2026-09-10', payment_method: 'cash', plan_id: 'bronze', created_at: '2026-09-10T18:00:00.000Z' },
    { _id: 'qaMzTxMerch', type: 'product', amount: 30, user_id: 'qaMzDana0000001', date: '2026-09-11', payment_method: 'cash', product_name: 'Taška', created_at: '2026-09-11T18:00:00.000Z' },
  ]));
  const pm = new Date(2026, 7, 1);
  fs.writeFileSync(path.join(DATA, 'monthly_winners.db'), riadky([{ _id: 'qaMzMW01', month: '2026-08', user_id: 'x', created_at: '2026-01-01' }]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'stripe_obnovy_doplnenie_20260915', 'hotovost_dodatocne_20260914', 'hotovost_dodatocne2_20260914']
    .map((k, i) => ({ _id: 'qaMzSet' + i, key: k, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('MESTÁ — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', STRIPE_FAKE: '1', STRIPE_SECRET_KEY: 'sk_test_qa_fake' },
    stdio: ['ignore', 'ignore', 'pipe'] });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1500)); process.exit(1); }
  await sleep(3000);

  let browser = null;
  try {
    const adm = {}, cl = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.mz.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    await j('/api/login', { method: 'POST', body: { email: 'qakmzklient00001@qa-biz.local'.replace('qakmz', 'qamz'), password: 'Heslo123!' } }, cl);
    const r = await j('/api/admin/mesta-zisk?from=2026-09-07&to=2026-09-13', {}, adm);
    ok('endpoint odpovedá', r.status === 200 && r.d && r.d.ok, JSON.stringify(r.d).slice(0, 300));
    const M = Object.fromEntries((r.d.mesta || []).map(x => [x.mesto, x]));
    const lpg = 13 / 100 * 0.80;

    console.log('\nHodiny a dochádzka:');
    ok('Brezno: 1 konaná, 1 zrušená, 1 človek', M.Brezno && M.Brezno.konane === 1 && M.Brezno.zrusene === 1 && M.Brezno.dochadzka === 1, JSON.stringify(M.Brezno));
    ok('Zvolen: 1 hodina, 12 ľudí, priemer 12', M.Zvolen && M.Zvolen.konane === 1 && M.Zvolen.dochadzka === 12 && M.Zvolen.priemer_ludi === 12);
    ok('online a súkromná rezervácia sa ako mesto nerátajú', !M.Online && !Object.keys(M).some(k => k.includes('/')), Object.keys(M).join(','));

    console.log('\nNáklady:');
    ok('Brezno cesta: 97,8 km × 13 l × 0,80 € = 10,17 €', blizko(M.Brezno.naklady.cestovne, 97.8 * lpg) && blizko(M.Brezno.naklady.km, 97.8, 0.11), JSON.stringify(M.Brezno.naklady));
    ok('Brezno nájom 20 € (1 hodina; zrušená sa neráta)', M.Brezno.naklady.najom === 20);
    const okruh = 39.8 + 21.1 + 26.4, vaha = 2 * 39.8 + 2 * 26.4;
    ok('BB + Zvolen v pondelok = jedna okružná cesta 87,3 km rozdelená podľa vzdialenosti',
      blizko(M['Banská Bystrica'].naklady.km, okruh * 79.6 / vaha, 0.11) && blizko(M.Zvolen.naklady.km, okruh * 52.8 / vaha, 0.11)
      && blizko(M['Banská Bystrica'].naklady.cestovne + M.Zvolen.naklady.cestovne, okruh * lpg), JSON.stringify({ bb: M['Banská Bystrica'].naklady, zv: M.Zvolen.naklady }));
    ok('Zvolen nájom 15 €', M.Zvolen.naklady.najom === 15);
    ok('Zvolen zástup trénerky: 10 € + 2 × 1 € (12 ľudí, prah 10)', M.Zvolen.naklady.treneri === 12 && M.Zvolen.zastupy === 1, JSON.stringify(M.Zvolen.naklady));
    ok('Detva bez nákladov', M.Detva && M.Detva.naklady.spolu === 0, JSON.stringify(M.Detva && M.Detva.naklady));

    console.log('\nTržby:');
    ok('vstup 10 € patrí Breznu (podľa rezervácie)', M.Brezno.trzby.vstupy === 10 && M.Brezno.trzby.spolu === 10, JSON.stringify(M.Brezno.trzby));
    ok('členstvo 49,90 € patrí Zvolenu (tam chodí), aj 40 € zo zlúčeného účtu podľa nového účtu', M.Zvolen.trzby.clenstva === 89.9, JSON.stringify(M.Zvolen.trzby));
    ok('Zumba Kids bez účtu (50 €) patrí mestu detských hodín', M.Detva.trzby.clenstva === 50, JSON.stringify(M.Detva.trzby));
    ok('nič nepriradené', r.d.nepriradene === 0, JSON.stringify(r.d.nepriradene_polozky));
    ok('súkromná hodina 25 € patrí Detve', M.Detva.trzby.sukromne === 25, JSON.stringify(M.Detva.trzby));
    ok('merch je mimo miest', r.d.mimo_miest && r.d.mimo_miest.merch === 30, JSON.stringify(r.d.mimo_miest));

    console.log('\nZisk:');
    const brNaklad = 97.8 * lpg + 20;
    ok('Brezno zisk = 10 − 30,17 = −20,17 €', blizko(M.Brezno.zisk, 10 - brNaklad), String(M.Brezno.zisk));
    ok('Brezno hranica: 4 ľudia po 10 € na hodinu', M.Brezno.hranica_ludi === 4, String(M.Brezno.hranica_ludi));
    ok('spolu = súčet miest', blizko(r.d.spolu.zisk, r.d.mesta.reduce((s, x) => s + x.zisk, 0)), JSON.stringify(r.d.spolu));

    console.log('\nNastavenie a prístup:');
    const put = await j('/api/admin/mesta-naklady', { method: 'PUT', body: { lpg_cena: '0,90', mesta: { Brezno: { najom_hod: '0' } } } }, adm);
    ok('uloženie nákladov (čiarka v čísle, nájom 0)', put.status === 200 && put.d.nastavenie.lpg_cena === 0.9 && put.d.nastavenie.mesta.Brezno.najom_hod === 0 && put.d.nastavenie.mesta.Zvolen.najom_hod === 15, JSON.stringify(put.d));
    const r2 = await j('/api/admin/mesta-zisk?from=2026-09-07&to=2026-09-13', {}, adm);
    const B2 = r2.d.mesta.find(x => x.mesto === 'Brezno');
    ok('nové náklady sa prejavia: Brezno len cesta pri 0,90 €/l', B2 && B2.naklady.najom === 0 && blizko(B2.naklady.cestovne, 97.8 * 0.13 * 0.9), JSON.stringify(B2 && B2.naklady));
    ok('zlé obdobie → 400', (await j('/api/admin/mesta-zisk?from=2026-09-13&to=2026-09-01', {}, adm)).status === 400);
    const kc = await j('/api/admin/mesta-zisk?from=2026-09-07&to=2026-09-13', {}, cl);
    ok('klientka tabuľku nevidí', [401, 403].includes(kc.status) || (kc.status === 302), 'HTTP ' + kc.status);

    console.log('\nAdmin (prehliadač):');
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const [meno, hodnota] = adm.cookie.split('=');
    await ctx.addCookies([{ name: meno, value: hodnota, domain: 'localhost', path: '/' }]);
    const p = await ctx.newPage(); const chyby = []; p.on('pageerror', e => chyby.push(e.message));
    await p.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof loadMestaZisk === 'function', null, { timeout: 20000 });
    await p.evaluate(() => loadMestaZisk('2026-09-07', '2026-09-13'));
    await p.waitForFunction(() => /Mestá — náklady a zisk/.test((document.getElementById('finMesta') || {}).innerText || ''), null, { timeout: 15000 }).catch(() => {});
    const txt = await p.evaluate(() => (document.getElementById('finMesta') || {}).innerText || '');
    ok('karta sa vykreslí s mestami a ziskom Brezna', /Brezno/.test(txt) && /Zvolen/.test(txt) && /−\d+,\d\d €/.test(txt) && /Hranica/.test(txt), txt.slice(0, 300));
    ok('karta má nastavenie nákladov', await p.evaluate(() => !!document.getElementById('mzLpg') && !!document.getElementById('mzNajom0')));
    ok('admin bez chýb v JS', chyby.length === 0, chyby.join(' | '));
    if (process.env.QA_SHOTS) {   // karta je v skrytej záložke — na snímku ju skopírujeme do viditeľnej vrstvy
      await p.evaluate(() => { const o = document.createElement('div'); o.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#111;padding:16px;width:1100px;height:900px;overflow:auto';
        o.innerHTML = document.getElementById('finMesta').innerHTML; document.body.appendChild(o); const det = o.querySelector('details'); if (det) det.open = true; });
      await p.screenshot({ path: path.join(process.env.QA_SHOTS, 'mesta-admin.png') }).catch(() => {});
    }
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill(); await sleep(500);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nMESTÁ: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
  }
})();
