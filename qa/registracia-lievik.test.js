/**
 * Registračný lievik po audite (Marek 27. 9. 2026): príchod → registrácia → mesto → termín.
 * Stráži štyri opravy, ktoré si Marek vypýtal:
 *   1. chyba sa zobrazí PRI POLI a kurzor doň skočí (predtým bola mimo obrazovky),
 *   2. polia majú 16 px písmo a aspoň 44 px (iPhone inak stránku priblíži),
 *   3. prvý krok má len meno, e-mail, heslo a súhlas; telefón, kód a „odkiaľ vieš" sú pod odkazom,
 *   4. texty: pozvánka sa nepýta na kód, odznak hovorí o týždni zadarmo, dátum je po slovensky.
 * Navyše: neplatný kód z pozvánkového odkazu nesmie zastaviť registráciu.
 *
 * Spustenie:  node qa/registracia-lievik.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4623, BASE = 'http://localhost:' + PORT;
const KOREN = path.join(__dirname, '..');
const OUT = process.env.LIEVIK_OUT || os.tmpdir();
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-lievik-'));
let ok = 0, zle = 0;
const t = (n, c, d) => { if (c) { ok++; console.log('  ✅ ' + n); } else { zle++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dow = new Date().getDay();
  const C = (id, loc, dw, cas) => ({ _id: id, name: 'Zumba', category: 'Zumba', location: loc, day_of_week: dw, time_start: cas, time_end: '20:00',
    capacity: 30, price: 10, emoji: '💃', level: 'Všetky úrovne', active: true, address: 'Štúdio ' + loc, created_at: '2026-01-01' });
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([C('qaLiDetva00001', 'Detva', (dow + 1) % 7, '19:00'), C('qaLiZvolen0001', 'Zvolen', (dow + 2) % 7, '18:00')]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1']
    .map((x, i) => ({ _id: 'qaLiSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('REGISTRAČNÝ LIEVIK — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', PRVY_TYZDEN: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; srv.stderr.on('data', d => { err += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + err.slice(-500)); process.exit(1); }
  await sleep(3000);
  let b = null;
  try {
    const { chromium } = require('playwright');
    b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'sk-SK', serviceWorkers: 'block' });
    const p = await ctx.newPage(); const js = []; p.on('pageerror', e => js.push(e.message));

    // 1) chyby pri poliach
    await p.goto(BASE + '/?ref=MAREK21', { waitUntil: 'domcontentloaded' });
    await p.locator('button, a').filter({ hasText: /Začať prvý týždeň zadarmo/i }).first().click();
    await p.waitForTimeout(800);
    const pozv = await p.evaluate(() => { const i = document.getElementById('pozvankaInfo'); const k = document.getElementById('rCode');
      return { vidno: !!(i && i.offsetParent), text: i ? i.innerText.trim() : '', kodSkryty: !!(k && !k.offsetParent), kodHodnota: k ? k.value : '' }; });
    t('pozvánka z odkazu sa potvrdí textom', pozv.vidno && /MAREK21/.test(pozv.text), JSON.stringify(pozv));
    t('políčko na kód ostáva schované, ale kód je vyplnený', pozv.kodSkryty && pozv.kodHodnota === 'MAREK21', JSON.stringify(pozv));

    const skus = async (co) => {
      await p.locator('#regBtn').click(); await p.waitForTimeout(700);
      return p.evaluate(() => { const e = document.querySelector('.pole-chyba');
        if (!e) return { text: '', vidno: false, fokus: document.activeElement?.id || '' };
        const r = e.getBoundingClientRect();
        return { text: e.innerText.trim(), vidno: r.top >= 0 && r.bottom <= innerHeight, pole: e.closest('.form-group')?.querySelector('input,select')?.id, fokus: document.activeElement?.id || '' }; });
    };
    let v = await skus();
    t('prázdny formulár: chyba pri mene a je vidieť', v.pole === 'rName' && v.vidno && /meno/i.test(v.text), JSON.stringify(v));
    t('kurzor skočí do poľa s chybou', v.fokus === 'rName', v.fokus);
    await p.fill('#rName', 'Jana Testovacia'); v = await skus();
    t('chýbajúci e-mail: chyba pri e-maile', v.pole === 'rEmail' && v.vidno, JSON.stringify(v));
    await p.fill('#rEmail', 'jana@email'); await p.fill('#rPass', '123'); v = await skus();
    t('krátke heslo: chyba pri hesle', v.pole === 'rPass' && v.vidno && /6 znakov/.test(v.text), JSON.stringify(v));
    await p.fill('#rPass', 'Heslo123!'); v = await skus();
    t('zlý e-mail: zrozumiteľná chyba pri e-maile', v.pole === 'rEmail' && /zavináč/i.test(v.text), JSON.stringify(v));
    await p.fill('#rEmail', 'qa.fix' + Date.now() + '@test-fa-qa.local'); v = await skus();
    t('nezaškrtnutý súhlas: chyba pri súhlase', /súhlas/i.test(v.text) && v.vidno, JSON.stringify(v));
    await p.screenshot({ path: path.join(OUT, 'chyba-pri-poli.png') });

    // 2) nepovinné polia
    const pred = await p.evaluate(() => ({ viac: !!document.getElementById('viacBtn')?.offsetParent, telefon: !!document.getElementById('rPhone')?.offsetParent }));
    await p.locator('#viacBtn').click(); await p.waitForTimeout(400);
    const po = await p.evaluate(() => ({ telefon: !!document.getElementById('rPhone')?.offsetParent, zdroj: !!document.getElementById('rLeadSource')?.offsetParent,
      vyskaZdroja: Math.round(document.getElementById('rLeadSource').getBoundingClientRect().height), pismoZdroja: parseFloat(getComputedStyle(document.getElementById('rLeadSource')).fontSize) }));
    t('nepovinné polia sú skryté a odkaz ich otvorí', pred.viac && !pred.telefon && po.telefon && po.zdroj, JSON.stringify({ pred, po }));
    t('výber zdroja má 16 px a aspoň 44 px', po.pismoZdroja >= 16 && po.vyskaZdroja >= 44, JSON.stringify(po));

    // 3) registrácia a texty
    const s = await p.$('#rConsent'); await s.check();
    await p.locator('#regBtn').click(); await p.waitForTimeout(3500);
    await p.locator('.pick-card').first().click(); await p.waitForTimeout(1000);
    await p.locator('.cal-day.cal-cell[onclick]').first().click(); await p.waitForTimeout(1000);
    const modal = await p.evaluate(() => { const m = document.getElementById('bookConfirmModal');
      return { vidno: getComputedStyle(m).display !== 'none', badge: document.getElementById('bcFreeBadge')?.innerText.trim(), text: m.innerText.replace(/\s+/g, ' ').slice(0, 200) }; });
    t('odznak hovorí o týždni zadarmo, nie o prvej hodine', /prvom týždni zadarmo/i.test(modal.badge || '') && !/ako prvá/i.test(modal.badge || ''), JSON.stringify(modal.badge));
    await p.screenshot({ path: path.join(OUT, 'potvrdenie-hodiny.png') });
    await p.locator('#bcConfirmBtn').click(); await p.waitForTimeout(3500);
    const hotovo = await p.evaluate(() => document.querySelector('.screen.active')?.innerText.replace(/\s+/g, ' ').slice(0, 180));
    t('dátum v potvrdení je po slovensky', /\d{1,2}\. \d{1,2}\. \d{4}/.test(hotovo || '') && !/\d{2}-\d{2}-\d{4}/.test(hotovo || ''), hotovo);
    await p.screenshot({ path: path.join(OUT, 'rezervacia-hotova.png') });
    t('bez chýb v JS', js.length === 0, js.join(' | '));

  } catch (e) {
    zle++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    if (b) await b.close().catch(() => {});
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nREGISTRAČNÝ LIEVIK: ' + ok + ' OK / ' + zle + ' chýb');
    process.exit(zle ? 1 : 0);
  }
})();
