/**
 * Karta partnera TopKošele.sk vo venčekoch (Marek 25. 9. 2026).
 * Overuje v prehliadači, že kartu vidí žiak aj rodič, že odkaz vedie na topkosele.sk
 * a že hovorí o zľave 10 %. Beží nad dočasnou databázou, maily vypnuté.
 *
 * Spustenie:  node qa/vencek-partner.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4621, BASE = 'http://localhost:' + PORT;
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-vpartner-'));
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaVpZiak00000001', name: 'Jakub Žiak', email: 'qa.vp.ziak@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAVP01', onboarding_done: true,
      venceky_role: 'student', venceky_class_id: 'qaVpTrieda000001', vencek_rodicia: ['qaVpRodic0000001'] },
    { _id: 'qaVpRodic0000001', name: 'Rodič Žiakov', email: 'qa.vp.rodic@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAVP02', onboarding_done: true,
      venceky_role: 'parent' },
  ]));
  fs.writeFileSync(path.join(DATA, 'venceky_schools.db'), riadky([
    { _id: 'qaVpSkola000001', name: 'ZŠ Testovacia', year: '2026/27', city: 'Detva', created_at: '2026-09-01' },
  ]));
  fs.writeFileSync(path.join(DATA, 'venceky_classes.db'), riadky([
    { _id: 'qaVpTrieda000001', school_id: 'qaVpSkola000001', name: '9.A', year: '2026/27', price: 60, lessons_total: 10, lessons_before: 10, lessons_done: 3,
      schedule: 'štvrtok 15:00', dances: [{ name: 'Valčík', level: 4 }, { name: 'Polka', level: 0 }], created_at: '2026-09-01' },
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1']
    .map((x, i) => ({ _id: 'qaVpSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('PARTNER VO VENČEKOCH — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; srv.stderr.on('data', d => { stderr += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + stderr.slice(-600)); process.exit(1); }
  await sleep(3000);

  let browser = null;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    for (const [kto, email] of [['žiak', 'qa.vp.ziak@qa-biz.local'], ['rodič', 'qa.vp.rodic@qa-biz.local']]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'sk-SK', serviceWorkers: 'block' });
      await ctx.addInitScript(() => { try { localStorage.setItem('fa_welcome_seen', '1'); } catch (e) {} });
      await ctx.request.post(BASE + '/api/login', { data: { email, password: 'Heslo123!' } });
      const p = await ctx.newPage(); const ch = []; p.on('pageerror', e => ch.push(e.message));
      await p.goto(BASE + '/vencek', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => document.querySelectorAll('#host .card').length > 0, null, { timeout: 25000 }).catch(() => {});
      await p.waitForTimeout(800);
      const m = await p.evaluate(() => {
        const k = [...document.querySelectorAll('.card')].find(c => /TopKošele/i.test(c.innerText));
        if (!k) return { je: false, karty: [...document.querySelectorAll('.card h3')].map(h => h.innerText.trim()).slice(0, 8) };
        const a = k.querySelector('a[href*="topkosele"]'); const r = k.getBoundingClientRect();
        return { je: true, text: k.innerText.replace(/\s+/g, ' ').trim(), href: a && a.getAttribute('href'), preteka: r.right > innerWidth + 1, scrollX: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      ok(kto + ': karta partnera je na stránke', m.je, JSON.stringify(m.karty || {}));
      if (m.je) {
        ok(kto + ': odkaz vedie na topkosele.sk', m.href === 'https://www.topkosele.sk', m.href);
        ok(kto + ': píše o zľave 10 %', /zľavu 10 %/.test(m.text), m.text);
        ok(kto + ': spomína predajňu v Detve a skúšanie', /Detve/.test(m.text) && /rezervovať termín skúšania/.test(m.text), m.text);
        ok(kto + ': netvrdí obleky ani šitie na mieru', !/oblek|na mieru/i.test(m.text), m.text);
        ok(kto + ': nič nepreteká', !m.preteka && !m.scrollX, JSON.stringify(m));
      }
      ok(kto + ': bez chýb v JS', ch.length === 0, ch.join(' | '));
      await ctx.close();
    }
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nPARTNER VO VENČEKOCH: ' + passed + ' OK / ' + failed + ' chýb');
    process.exit(failed ? 1 : 0);
  }
})();
