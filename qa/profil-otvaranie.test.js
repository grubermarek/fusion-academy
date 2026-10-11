/**
 * Profil sa musí vždy načítať — alebo povedať prečo nie (Marek 11. 10. 2026: „neslo nam
 * otvorit profil, oprav otvaranie profilu je to dlhodoby problem"; to isté 13. 9., 15. 9.,
 * 16. 9. a 21. 9.). Doteraz `load()` nemal časový limit ani zachytenú chybu, takže keď
 * request zamrzol alebo padol, zostal navždy spinner „Načítavam profil…".
 *
 * Overuje v prehliadači (mobil + nainštalovaná appka):
 *  - profil sa normálne načíta a ukáže meno
 *  - padnutý request (sieť) → hláška s tlačidlom „Skúsiť znova", klik profil dotiahne
 *  - chyba servera (500) → tá istá hláška s tlačidlom, nie večný spinner
 *  - zamrznutý request → po limite 12 s hláška, nie večný spinner
 *  - service worker má pri zamrznutej sieti timeout a verziu cache bumpnutú
 *
 * Spustenie:  node qa/profil-otvaranie.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4628, BASE = 'http://localhost:' + PORT;
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-profil-'));
let ok = 0, zle = 0;
const t = (n, c, d) => { if (c) { ok++; console.log('  ✅ ' + n); } else { zle++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaPrAdmin000001', name: 'Adam Admin', email: 'qa.pr.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01', referral_code: 'QAPR01' },
    { _id: 'qaPrKlient00001', name: 'Michaela Testová', email: 'qa.pr.klient@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-06-01', referral_code: 'QAPR02', city: 'Detva', onboarding_done: true },
  ]));
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const pm = new Date(+DNES.slice(0, 4), +DNES.slice(5, 7) - 2, 1);
  fs.writeFileSync(path.join(DATA, 'monthly_winners.db'), riadky([{ _id: 'qaPrMW01', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'x', created_at: '2026-01-01' }]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1']
    .map((k, i) => ({ _id: 'qaPrSet' + i, key: k, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('OTVÁRANIE PROFILU — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; srv.stderr.on('data', d => { err += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + err.slice(-500)); process.exit(1); }
  await sleep(3000);

  const URL_PROFIL = BASE + '/u/qaPrKlient00001';
  let b = null;
  try {
    const { chromium } = require('playwright');
    b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'sk-SK', serviceWorkers: 'block' });
    // nainštalovaná appka — presne prostredie, v ktorom to Marekovi padalo
    await ctx.addInitScript(() => {
      const orig = window.matchMedia;
      window.matchMedia = q => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : orig.call(window, q));
      try { localStorage.setItem('fa_welcome_seen', '1'); } catch (e) {}
    });
    await ctx.request.post(BASE + '/api/login', { data: { email: 'qa.pr.admin@qa-biz.local', password: 'Heslo123!' } });

    // ── 1. normálne načítanie
    let p = await ctx.newPage(); const js = []; p.on('pageerror', e => js.push(e.message));
    await p.goto(URL_PROFIL, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !/Načítavam profil/.test(document.getElementById('host')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
    const text1 = await p.locator('#host').textContent();
    t('profil sa načíta a ukáže meno', /Michaela Testová/.test(text1 || ''), (text1 || '').slice(0, 80));
    t('žiadna chyba v JS', js.length === 0, js.join(' | '));
    await p.close();

    // ── 2. padnutý request → hláška + tlačidlo, po kliknutí sa profil dotiahne
    p = await ctx.newPage();
    let padaj = true;
    await p.route('**/api/profile/qaPrKlient00001', r => { if (padaj) r.abort('failed'); else r.continue(); });
    await p.goto(URL_PROFIL, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#profRetry', { timeout: 20000 });
    const text2 = await p.locator('#host').textContent();
    t('padnutý request: hláška namiesto večného spinnera', /nepodarilo/i.test(text2 || ''), (text2 || '').slice(0, 90));
    t('padnutý request: je tam tlačidlo „Skúsiť znova"', /Skúsiť znova/.test(text2 || ''), (text2 || '').slice(0, 90));
    padaj = false;
    await p.click('#profRetry');
    await p.waitForFunction(() => /Michaela Testová/.test(document.getElementById('host')?.textContent || ''), null, { timeout: 20000 });
    t('„Skúsiť znova" profil naozaj dotiahne', /Michaela Testová/.test(await p.locator('#host').textContent() || ''));
    await p.close();

    // ── 3. chyba servera (500)
    p = await ctx.newPage();
    await p.route('**/api/profile/qaPrKlient00001', r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Vnútorná chyba' }) }));
    await p.goto(URL_PROFIL, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#profRetry', { timeout: 20000 });
    const text3 = await p.locator('#host').textContent();
    t('chyba servera: hláška s dôvodom a stavom', /nepodarilo/i.test(text3 || '') && /500/.test(text3 || ''), (text3 || '').slice(0, 120));
    await p.close();

    // ── 4. zamrznutý request → po limite 12 s hláška (nie večný spinner)
    p = await ctx.newPage();
    await p.route('**/api/profile/qaPrKlient00001', async () => { await sleep(60000); });
    await p.goto(URL_PROFIL, { waitUntil: 'domcontentloaded' });
    const zacatok = Date.now();
    const doslo = await p.waitForSelector('#profRetry', { timeout: 40000 }).then(() => true).catch(() => false);
    t('zamrznutý request: hláška príde po limite (nie nikdy)', doslo, 'čakané ' + Math.round((Date.now() - zacatok) / 1000) + ' s');
    t('limit je rozumný (do 30 s)', doslo && (Date.now() - zacatok) < 30000, Math.round((Date.now() - zacatok) / 1000) + ' s');
    await p.close();

    // ── 5. kód: service worker a zapojenie
    const sw = fs.readFileSync(path.join(KOREN, 'public', 'sw.js'), 'utf8');
    t('service worker nečaká na zamrznutú sieť navždy', /Promise\.race\(\[siet/.test(sw) && /__cakanie__/.test(sw), 'timeout v sw.js');
    t('verzia cache je bumpnutá nad fa-v730', (+(sw.match(/fa-v(\d+)/) || [])[1] || 0) > 730, (sw.match(/fa-v\d+/) || [])[0]);
    const prof = fs.readFileSync(path.join(KOREN, 'public', 'profile.html'), 'utf8');
    t('načítanie profilu beží cez spustiLoad (so zachytenou chybou)', /\nspustiLoad\(\);/.test(prof) && !/\nload\(\);/.test(prof), 'volanie na konci');
    t('profil má časový limit cez AbortController', /new AbortController\(\)/.test(prof) && /PROFIL_LIMIT/.test(prof));
    t('po vykreslení už nič profil nezhodí', /try\{ FA_I18N\.mount\('langMount'\); \}catch/.test(prof), 'FA_I18N.mount');
    t('kľúč „Skúsiť znova" je vo všetkých 6 jazykoch',
      (fs.readFileSync(path.join(KOREN, 'public', 'i18n.js'), 'utf8').match(/'profile\.retry'/g) || []).length === 6);
  } catch (e) {
    zle++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    if (b) await b.close().catch(() => {});
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nOTVÁRANIE PROFILU: ' + ok + ' OK / ' + zle + ' chýb');
    process.exit(zle ? 1 : 0);
  }
})();
