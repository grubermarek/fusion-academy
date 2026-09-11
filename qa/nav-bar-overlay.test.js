/**
 * Zdieľané menu (nav-bar.js) v skutočnom prehliadači (11. 9. 2026).
 *
 * Prečo existuje: na /client-dashboard (<body data-fa-nav="overlay-only">)
 * nav-bar.js nestavia hornú lištu, takže #fa-nb-menu-btn neexistuje — a
 * wireEvents() naň volal addEventListener bez kontroly. Výnimka zastavila zvyšok
 * wireEvents (✕, klik mimo, Esc, dlaždice) aj zvyšok init(): loadAuthState()
 * ani window.faNavOpen/faNavClose sa nikdy nenastavili.
 *
 * Stráži, že:
 *   · index, /client-dashboard, /schedule, /community, /trainer, /admin
 *     (a ďalšie stránky s nav-bar.js) nabehnú bez pageerror
 *   · kde je nav-bar.js, existuje window.faNavOpen / faNavClose / faNavToggle
 *   · menu sa dá otvoriť (hamburger alebo faNavOpen) a zavrieť Esc, klikom
 *     mimo dlaždíc aj tlačidlom ✕
 *   · init doběhne až do konca — prihlásenej klientke overlay pozdraví menom
 *
 * Spustenie:  node qa/nav-bar-overlay.test.js
 */
process.env.NODE_PATH = 'C:/Fusion Academy/automatizacie/node_modules';
require('module').Module._initPaths();

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');
const { chromium } = require('playwright');

const PORT = 4589;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-navbar-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

// [cesta, kto] — či stránka nav-bar.js má a či je overlay-only, sa zistí z DOM
// (prihlásenú klientku index presmeruje ďalej, preto aj neprihlásený index)
const STRANKY = [
  ['/',                 'anonym'],
  ['/',                 'klient'],
  ['/client-dashboard', 'klient'],
  ['/schedule',         'klient'],
  ['/community',        'klient'],
  ['/obchod',           'klient'],
  ['/pricing',          'klient'],
  ['/shop',             'klient'],
  ['/trainer',          'trener'],
  ['/admin',            'admin' ],
];
// stránky, ktoré nav-bar.js načítať musia — aby test nezačal potichu nič netestovať
const MUSIA_MAT_MENU = ['/client-dashboard', '/schedule', '/obchod', '/pricing', '/shop'];

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  w('users.db', [
    { _id: 'qaNavAdmin00001', name: 'Marek Gruber', email: 'qa.nav.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    { _id: 'qaNavTrener0001', name: 'Navová Trénerka', email: 'qa.nav.trener@qa-biz.local',
      password: hash, user_type: 'trainer', active: true, created_at: '2026-01-01', referral_code: 'QANAVT1' },
    { _id: 'qaNavKlient0001', name: 'Navová Klientka', email: 'qa.nav@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-08-01',
      referral_code: 'QANAV1', visit_count: 3, single_entries: 0, referral_credit: 0 },
  ]);
  const EMAIL = { admin: 'qa.nav.admin@qa-biz.local', trener: 'qa.nav.trener@qa-biz.local', klient: 'qa.nav@qa-biz.local' };

  console.log('ZDIEĽANÉ MENU V PREHLIADAČI\n');

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

  let browser = null;
  try {
    browser = await chromium.launch();
    // jeden kontext na rolu — cookie prihlásenia zdieľa celý kontext
    const ctxs = { anonym: await browser.newContext({ viewport: { width: 390, height: 844 } }) };
    for (const kto of Object.keys(EMAIL)) {
      ctxs[kto] = await browser.newContext({ viewport: { width: 390, height: 844 } });
      // vracajúca sa klientka — uvítací sprievodca (#welcomeGuide, z-index 2000) by inak ležal nad menu
      await ctxs[kto].addInitScript(() => { try { localStorage.setItem('fa_welcome_seen', '1'); } catch (e) {} });
      const r = await ctxs[kto].request.post(BASE + '/api/login', { data: { email: EMAIL[kto], password: 'Heslo123!' } });
      ok('prihlásenie: ' + kto, r.ok(), 'HTTP ' + r.status());
    }

    const jeOtvorene = page => page.$eval('#fa-menu-overlay', el => el.classList.contains('fa-open'));

    for (const [cesta, kto] of STRANKY) {
      const page = await ctxs[kto].newPage();
      const pageErr = [], konzola = [], zlyhane = [];
      page.on('pageerror', e => pageErr.push(String(e.message)));
      page.on('console', m => { if (m.type() === 'error') konzola.push(m.text()); });
      page.on('response', r => { if (r.status() >= 400) zlyhane.push(r.status() + ' ' + r.url().replace(BASE, '')); });
      try {
      await page.goto(BASE + cesta, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3500);
      const kde = new URL(page.url()).pathname;
      const navBar = await page.evaluate(() => !!document.querySelector('script[src*="nav-bar.js"]'));
      const overlayOnly = await page.evaluate(() => document.body.getAttribute('data-fa-nav') === 'overlay-only');
      console.log('\n' + cesta + ' (' + kto + ')' + (kde !== cesta ? ' → ' + kde : '') + ' · nav-bar.js: '
        + (navBar ? (overlayOnly ? 'áno, overlay-only' : 'áno') : 'nie'));
      ok('žiadny pageerror', pageErr.length === 0, pageErr.slice(0, 3).join(' | '));
      if (konzola.length) console.log('     (info: console.error ' + konzola.length + '× — ' + konzola.slice(0, 2).join(' | ').slice(0, 200) + ')');
      if (zlyhane.length) console.log('     (info: odpovede ≥400 — ' + zlyhane.slice(0, 4).join(', ') + ')');
      if (MUSIA_MAT_MENU.includes(kde)) ok('stránka načítava nav-bar.js', navBar);

      if (!navBar) {
        ok('bez nav-bar.js nie je ani overlay', !(await page.$('#fa-menu-overlay')));
        continue;
      }

      const api = await page.evaluate(() => [typeof window.faNavOpen, typeof window.faNavClose, typeof window.faNavToggle].join(','));
      ok('window.faNavOpen / faNavClose / faNavToggle existujú', api === 'function,function,function', api);
      ok(overlayOnly ? 'overlay-only: horná lišta sa nestavia' : 'horná lišta je na mieste',
        !!(await page.$('#fa-nav-bar')) === !overlayOnly);
      ok('overlay je v stránke a zatvorený', !!(await page.$('#fa-menu-overlay')) && !(await jeOtvorene(page)));

      const otvor = async () => {
        if (overlayOnly) await page.evaluate(() => window.faNavOpen());
        else await page.click('#fa-nb-menu-btn');
        await page.waitForTimeout(350);
      };

      await otvor();
      ok('menu sa otvorí (' + (overlayOnly ? 'faNavOpen' : 'hamburger') + ')', await jeOtvorene(page));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      ok('Esc ho zavrie', !(await jeOtvorene(page)));

      await otvor();
      // ľavý okraj overlaya — mimo mriežky dlaždíc, overlay (z-index 600) prekrýva lištu aj stránku
      const naBode = await page.evaluate(() => (document.elementFromPoint(8, 120) || {}).id);
      await page.mouse.click(8, 120);
      await page.waitForTimeout(300);
      ok('klik mimo dlaždíc ho zavrie', !(await jeOtvorene(page)), 'kliknuté na #' + naBode);

      await otvor();
      await page.click('#fa-mo-close-btn');
      await page.waitForTimeout(300);
      ok('tlačidlo ✕ ho zavrie', !(await jeOtvorene(page)));
      ok('scroll stránky je po zavretí odomknutý', (await page.evaluate(() => document.body.style.overflow)) === '');

      // loadAuthState beží až po wireEvents — ak init spadne, pozdrav sa nikdy nevypíše
      if (kto !== 'anonym') {
        const pozdrav = await page.$eval('#fa-mo-user-info', el => el.textContent.trim());
        ok('init doběhol: overlay pozdraví prihlásenú', /Ahoj,\s*Navová/.test(pozdrav), pozdrav.slice(0, 60));
      }

      ok('počas klikania žiadny pageerror', pageErr.length === 0, pageErr.slice(0, 3).join(' | '));
      } catch (e) {
        failed++; console.log('  ❌ výnimka na ' + cesta + ': ' + e.message.split('\n')[0]);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nZDIEĽANÉ MENU V PREHLIADAČI: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-800));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
