/**
 * Profil zo súkromnej správy (Marek 21. 9. 2026: „keď mám súkromnú správu a kliknem na meno
 * človeka, zase mi neotvorí jeho profil, len načítava").
 *
 * V prehliadači (mobil aj nainštalovaná appka) otvorí súkromnú konverzáciu v komunite
 * a skúsi každé miesto, kde je meno či fotka druhej osoby:
 *  - meno v hlavičke konverzácie
 *  - fotka v hlavičke
 *  - fotka pri správe
 *  - meno pri správe → menu → „Zobraziť profil"
 * Po každom kliku musí byť profil načítaný (meno na stránke, žiadne „Načítavam") a bez chýb v JS.
 *
 * Spustenie:  node qa/komunita-dm-profil.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4618, BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-dmprof-'));
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const ADMIN = 'qaDmAdmin000001', KLARA = 'qaDmKlara000001';
const KEY = 'dm_' + [ADMIN, KLARA].sort().join('_');

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: ADMIN, name: 'Adam Admin', email: 'qa.dm.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01', referral_code: 'QADMAD', onboarding_done: true },
    { _id: KLARA, name: 'Klára Správová', email: 'qa.dm.klara@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-06-01', referral_code: 'QADMKL', city: 'Detva', onboarding_done: true },
  ]));
  fs.writeFileSync(path.join(DATA, 'messages.db'), riadky([
    { _id: 'qaDmMsg0000001', is_dm: true, dm_key: KEY, participants: [KLARA, ADMIN], from_id: KLARA, from_name: 'Klára Správová', to_id: ADMIN, text: 'Ahoj, prídem v piatok?', read: false, created_at: '2026-09-21T10:00:00.000Z' },
    { _id: 'qaDmMsg0000002', is_dm: true, dm_key: KEY, participants: [ADMIN, KLARA], from_id: ADMIN, from_name: 'Adam Admin', to_id: KLARA, text: 'Jasné, tešíme sa.', read: true, created_at: '2026-09-21T10:05:00.000Z' },
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1']
    .map((k, i) => ({ _id: 'qaDmSet' + i, key: k, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('PROFIL ZO SÚKROMNEJ SPRÁVY — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); process.exit(1); }
  await sleep(3000);

  let browser = null;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    for (const [nazov, standalone] of [['mobil v prehliadači', false], ['nainštalovaná appka', true]]) {
      console.log('\n' + nazov + ':');
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'sk-SK', serviceWorkers: 'block' });
      await ctx.addInitScript(sa => {
        try { localStorage.setItem('fa_welcome_seen', '1'); } catch (e) {}
        if (sa) { const mm = window.matchMedia.bind(window); window.matchMedia = q => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); }
      }, standalone);
      await ctx.request.post(BASE + '/api/login', { data: { email: 'qa.dm.admin@qa-biz.local', password: 'Heslo123!' } });

      const miesta = [
        ['meno v hlavičke konverzácie', async p => p.locator('#hdrTitle').tap()],
        ['fotka v hlavičke', async p => p.locator('#hdrChanIc').tap()],
        ['fotka pri správe', async p => p.locator('#messages .msg:not(.own) .msg-avatar').first().tap()],
        ['meno pri správe → „Zobraziť profil"', async p => { await p.locator('#messages .msg:not(.own) .who').first().tap(); await p.locator('#userMenu .um-item', { hasText: 'Zobraziť profil' }).tap(); }],
      ];
      for (const [co, klik] of miesta) {
        const p = await ctx.newPage(); const ch = []; p.on('pageerror', e => ch.push(e.message));
        await p.goto(BASE + '/community?dm=' + KLARA, { waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => document.querySelector('#hdrTitle') && /Klára/.test(document.querySelector('#hdrTitle').textContent), null, { timeout: 20000 }).catch(() => {});
        await p.waitForSelector('#messages .msg', { timeout: 15000 }).catch(() => {});
        const pred = p.url();
        let chyba = '';
        try { await klik(p); } catch (e) { chyba = e.message.split('\n')[0]; }
        await p.waitForURL(/\/u\//, { timeout: 8000 }).catch(() => {});
        let nacital = false;
        if (/\/u\//.test(p.url())) nacital = await p.waitForFunction(() => /Klára Správová/.test(document.body.innerText) && !/Načítavam/.test((document.getElementById('host') || document.body).innerText.slice(0, 400)), null, { timeout: 15000 }).then(() => true).catch(() => false);
        ok(co + ': otvorí profil a načíta sa', /\/u\/qaDmKlara000001/.test(p.url()) && nacital, chyba || ('URL ' + p.url() + (pred === p.url() ? ' (klik nič neurobil)' : '') + ' · načítané ' + nacital));
        ok(co + ': bez chýb v JS', ch.length === 0, ch.join(' | '));
        await p.close();
      }
      // Mimo súkromnej konverzácie (hlavná komunita, zoznam správ) nadpis nikam neodvedie
      const p2 = await ctx.newPage();
      await p2.goto(BASE + '/community?dm=' + KLARA, { waitUntil: 'domcontentloaded' });
      await p2.waitForSelector('#messages .msg', { timeout: 15000 }).catch(() => {});
      await p2.evaluate(() => hdrBackClick());
      await sleep(800);
      const u2 = p2.url();
      await p2.locator('#hdrTitle').tap().catch(() => {});
      await sleep(1200);
      ok('v zozname správ nadpis neotvára žiadny profil', p2.url() === u2 && !/\/u\//.test(p2.url()), p2.url());
      await p2.close();
      await ctx.close();
    }
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nPROFIL ZO SÚKROMNEJ SPRÁVY: ' + passed + ' OK / ' + failed + ' chýb');
    process.exit(failed ? 1 : 0);
  }
})();
