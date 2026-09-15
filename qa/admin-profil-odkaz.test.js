/**
 * Otvorenie profilu klientky z admina (Marek 13. 9. a znova 15. 9. 2026: „keď kliknem na meno, iba sa načítava").
 *
 * Overuje v prehliadači:
 *  - klik na meno (odkaz /u/… s vlastným onclick+stopPropagation) ide cez otvorProfil: bežne nová karta
 *  - v nainštalovanej appke (display-mode standalone) sa profil otvorí v tej istej karte
 *  - keď prehliadač novú kartu zablokuje (window.open → null), otvorí sa v tej istej karte
 *  - Ctrl+klik necháva prehliadaču (vlastná nová karta)
 *  - profil sa načíta aj keď jazyk účtu ≠ jazyk prehliadača a localStorage je zablokovaný (žiadna slučka obnovovania)
 * Spustenie:  node qa/admin-profil-odkaz.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4611, BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-profodkaz-'));
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaPoAdmin000001', name: 'Adam Admin', email: 'qa.po.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01', referral_code: 'QAPOAD', lang: 'de' },
    { _id: 'qaPoKlara000001', name: 'Klára Profilová', email: 'qa.po.klara@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-06-01', referral_code: 'QAPOKL', city: 'Detva', onboarding_done: true },
  ]));
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const pm = new Date(+DNES.slice(0, 4), +DNES.slice(5, 7) - 2, 1);
  fs.writeFileSync(path.join(DATA, 'monthly_winners.db'), riadky([{ _id: 'qaPoMW01', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'x', created_at: '2026-01-01' }]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1']
    .map((k, i) => ({ _id: 'qaPoSet' + i, key: k, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('PROFIL Z ADMINA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); process.exit(1); }
  await sleep(3000);

  let browser = null;
  try {
    const lg = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'qa.po.admin@qa-biz.local', password: 'Heslo123!' }) });
    const [meno, hodnota] = String(lg.headers.get('set-cookie') || '').split(';')[0].split('=');
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    // Odkaz ako v zozname klientov: vlastný onclick so stopPropagation, target=_blank, v riadku s onclick
    const vlozOdkaz = p => p.evaluate(() => {
      const tr = document.createElement('div'); tr.id = 'qaRiadok'; tr.setAttribute('onclick', "window.__riadok=1");
      tr.innerHTML = '<a id="qaMeno" href="/u/qaPoKlaraAAA" target="_blank" onclick="event.stopPropagation()" style="position:fixed;left:10px;top:10px;z-index:99999;background:#fff;color:#000;padding:8px">Klára</a>';
      document.body.appendChild(tr);
    });
    const kontext = async (init) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
      await ctx.addCookies([{ name: meno, value: hodnota, domain: 'localhost', path: '/' }]);
      if (init) await ctx.addInitScript(init);
      const p = await ctx.newPage(); const chyby = []; p.on('pageerror', e => chyby.push(e.message));
      await p.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => typeof otvorProfil === 'function', null, { timeout: 20000 });
      await vlozOdkaz(p);
      return { ctx, p, chyby };
    };

    console.log('\nAdmin — klik na meno:');
    let k = await kontext();
    const [popup] = await Promise.all([k.ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), k.p.click('#qaMeno')]);
    ok('bežný prehliadač: profil v novej karte', popup && /\/u\/qaPoKlaraAAA$/.test(popup.url() || (await popup.waitForURL(/\/u\//).then(() => popup.url()).catch(() => ''))), popup ? popup.url() : 'žiadna nová karta');
    ok('admin karta ostala na admine a riadok sa neklikol dvakrát', /\/admin/.test(k.p.url()) && !(await k.p.evaluate(() => window.__riadok)), k.p.url());
    ok('admin bez chýb v JS', k.chyby.length === 0, k.chyby.join(' | '));
    await k.ctx.close();

    k = await kontext(() => { const pov = window.matchMedia.bind(window); window.matchMedia = q => (/standalone/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : pov(q)); });
    await Promise.all([k.p.waitForURL(/\/u\/qaPoKlaraAAA/, { timeout: 8000 }).catch(() => {}), k.p.click('#qaMeno')]);
    ok('nainštalovaná appka: profil v tej istej karte', /\/u\/qaPoKlaraAAA$/.test(k.p.url()), k.p.url());
    await k.ctx.close();

    k = await kontext(() => { window.open = () => null; });
    await Promise.all([k.p.waitForURL(/\/u\/qaPoKlaraAAA/, { timeout: 8000 }).catch(() => {}), k.p.click('#qaMeno')]);
    ok('zablokovaná nová karta: profil v tej istej karte', /\/u\/qaPoKlaraAAA$/.test(k.p.url()), k.p.url());
    await k.ctx.close();

    k = await kontext(() => { window.__otvor = 0; const o = window.open; window.open = (...a) => { window.__otvor++; return o.apply(window, a); }; });
    await k.p.click('#qaMeno', { modifiers: ['Control'] }).catch(() => {});
    await sleep(800);
    ok('Ctrl+klik necháva prehliadaču (otvorProfil sa nevolá)', (await k.p.evaluate(() => window.__otvor)) === 0 && /\/admin/.test(k.p.url()));
    await k.ctx.close();

    console.log('\nProfil — jazyk účtu (de) a zablokovaný localStorage:');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'sk-SK' });
    await ctx.addCookies([{ name: meno, value: hodnota, domain: 'localhost', path: '/' }]);
    await ctx.addInitScript(() => { try { Storage.prototype.setItem = function () { throw new Error('blokovane'); }; } catch (e) {} });
    const p = await ctx.newPage(); let nacitania = 0; const chyby = [];
    p.on('framenavigated', f => { if (f === p.mainFrame()) nacitania++; });
    p.on('pageerror', e => chyby.push(e.message));
    await p.goto(BASE + '/u/qaPoKlara000001', { waitUntil: 'domcontentloaded' });
    await sleep(7000);
    const text = await p.evaluate(() => document.body.innerText);
    ok('profil sa zobrazí (meno klientky), nie len „načítavam"', /Klára Profilová/.test(text), text.slice(0, 200));
    ok('stránka sa neobnovuje dookola', nacitania <= 2, 'načítaní: ' + nacitania);
    await ctx.close();

    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'sk-SK' });
    await ctx2.addCookies([{ name: meno, value: hodnota, domain: 'localhost', path: '/' }]);
    const p2 = await ctx2.newPage(); let n2 = 0;
    p2.on('framenavigated', f => { if (f === p2.mainFrame()) n2++; });
    await p2.goto(BASE + '/u/qaPoKlara000001', { waitUntil: 'domcontentloaded' });
    await sleep(6000);
    ok('bežne sa jazyk účtu použije (jedno obnovenie) a profil sa zobrazí', n2 === 2 && /Klára Profilová/.test(await p2.evaluate(() => document.body.innerText)) && (await p2.evaluate(() => localStorage.getItem('fa_lang'))) === 'de', 'načítaní: ' + n2);
    await ctx2.close();
  } catch (e) { failed++; console.log('  ❌ výnimka: ' + e.stack); }
  finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill(); await sleep(500);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nPROFIL Z ADMINA: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
  }
})();
