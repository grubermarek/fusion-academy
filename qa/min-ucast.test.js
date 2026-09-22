/**
 * Minimálny počet prihlásených (Marek 22. 9. 2026): v Brezne, vo Zvolene a v Banskej Bystrici
 * sa hodina koná od 8 prihlásených. Ak 3 hodiny pred začiatkom nie je dosť rezervácií, hodina sa
 * ruší — vstupy sa vracajú, členstvo sa predlžuje. Klientka to vidí pri hodine s otáznikom.
 *
 * Overuje:
 *  - API rozvrhu posiela min_ucast len pre Brezno/Zvolen/BB (nie Detva, nie Online) s počtom prihlásených
 *  - moje rezervácie majú min_ucast pri hodine v Brezne
 *  - text pravidla sedí so serverom (8 ľudí, 3 hodiny, predĺženie = KOMPENZACIA_DNI)
 *  - v prehliadači na mobile: riadok v rozvrhu (/schedule), na nástenke (karta hodiny aj moja
 *    rezervácia) a v potvrdení rezervácie; otáznik rozbalí a zbalí vysvetlenie; Detva riadok nemá;
 *    nič nepreteká, bez chýb v JS
 *
 * Spustenie:  node qa/min-ucast.test.js     (MIN_UCAST_OUT=<priečinok> uloží snímky)
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4619, BASE = 'http://localhost:' + PORT;
const KOREN = path.join(__dirname, '..');
const OUT = process.env.MIN_UCAST_OUT || '';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-minucast-'));
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';

// termín o dva dni (rovnaký výpočet ako displayNextDateForDay na serveri — beží na tom istom stroji)
const d2 = new Date(); d2.setDate(d2.getDate() + 2);
const DOW = d2.getDay();
const DATUM = d2.getFullYear() + '-' + String(d2.getMonth() + 1).padStart(2, '0') + '-' + String(d2.getDate()).padStart(2, '0');

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const users = [{ _id: 'qaMuKlara000001', name: 'Klára Brezňanská', email: 'qa.mu.klara@qa-biz.local', password: hash, user_type: 'client', active: true,
    created_at: '2026-06-01', referral_code: 'QAMUKL', city: 'Brezno', onboarding_done: true, free_class_used: true, visit_count: 5 }];
  for (let i = 1; i <= 4; i++) users.push({ _id: 'qaMuIna00000' + i, name: 'Iná Klientka ' + i, email: 'qa.mu.ina' + i + '@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-06-01', referral_code: 'QAMUI' + i, onboarding_done: true });
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky(users));
  const C = (id, name, loc, cat, time) => ({ _id: id, name, category: cat, location: loc, day_of_week: DOW, time_start: time, time_end: '20:00', capacity: 30, price: 10, emoji: '💃', level: 'Všetky úrovne', active: true, created_at: '2026-01-01' });
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    C('qaMuBrezno00001', 'Zumba', 'Brezno', 'Zumba', '18:00'),
    C('qaMuZvolen00001', 'Zumba', 'Zvolen', 'Zumba', '17:00'),
    C('qaMuDetva000001', 'Zumba', 'Detva', 'Zumba', '19:00'),
    C('qaMuOnline00001', 'Online Zumba', 'Brezno', 'Online', '18:30'),
  ]));
  // Brezno: 5 prihlásených (Klára + 4), jedna zrušená sa neráta
  const bk = [];
  ['qaMuKlara000001', 'qaMuIna000001', 'qaMuIna000002', 'qaMuIna000003', 'qaMuIna000004'].forEach((u, i) => bk.push({ _id: 'qaMuBk00000' + i, user_id: u, user_name: u === 'qaMuKlara000001' ? 'Klára Brezňanská' : 'Iná Klientka ' + i,
    class_id: 'qaMuBrezno00001', class_name: 'Zumba', class_location: 'Brezno', class_time_start: '18:00', booking_date: DATUM, status: 'confirmed', access_method: 'single_entry', created_at: '2026-09-20T10:00:00.000Z' }));
  bk.push({ _id: 'qaMuBkZrus0001', user_id: 'qaMuIna000001', user_name: 'Iná', class_id: 'qaMuBrezno00001', booking_date: DATUM, status: 'cancelled', created_at: '2026-09-20T10:00:00.000Z' });
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky(bk));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1']
    .map((k, i) => ({ _id: 'qaMuSet' + i, key: k, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('MINIMUM PRIHLÁSENÝCH — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; srv.stderr.on('data', d => { stderr += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + stderr.slice(-800)); process.exit(1); }
  await sleep(3000);

  let browser = null;
  try {
    const src = fs.readFileSync(path.join(KOREN, 'server.js'), 'utf8');
    const dni = +(src.match(/const KOMPENZACIA_DNI = (\d+);/) || [])[1];

    console.log('\nAPI:');
    const cls = await fetch(BASE + '/api/classes').then(r => r.json());
    const byId = id => cls.find(c => c._id === id) || {};
    const mb = byId('qaMuBrezno00001').min_ucast;
    ok('Brezno má minimum 8 a 3 hodiny', mb && mb.pocet === 8 && mb.hodin === 3 && mb.kde === 'v Brezne', JSON.stringify(mb));
    ok('Brezno ráta 5 prihlásených (zrušená sa neráta)', mb && mb.prihlasenych === 5, JSON.stringify(mb));
    ok('predĺženie členstva = KOMPENZACIA_DNI zo servera (' + dni + ')', mb && mb.predlzenie === dni && dni > 0, JSON.stringify(mb));
    ok('Zvolen má minimum „vo Zvolene" s 0 prihlásenými', byId('qaMuZvolen00001').min_ucast?.kde === 'vo Zvolene' && byId('qaMuZvolen00001').min_ucast?.prihlasenych === 0, JSON.stringify(byId('qaMuZvolen00001').min_ucast));
    ok('Detva minimum nemá', !byId('qaMuDetva000001').min_ucast);
    ok('online hodina z Brezna minimum nemá', !byId('qaMuOnline00001').min_ucast);
    ok('Banská Bystrica je v nastavení', /'banská bystrica':'v Banskej Bystrici'/.test(src));

    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'sk-SK', serviceWorkers: 'block' });
    await ctx.addInitScript(() => { try { localStorage.setItem('fa_welcome_seen', '1'); } catch (e) {} });
    await ctx.request.post(BASE + '/api/login', { data: { email: 'qa.mu.klara@qa-biz.local', password: 'Heslo123!' } });
    const my = await (await ctx.request.get(BASE + '/api/my-bookings')).json();
    const mojaB = (Array.isArray(my) ? my : []).find(b => b.class_id === 'qaMuBrezno00001');
    ok('moja rezervácia v Brezne má minimum s 5 prihlásenými', mojaB && mojaB.min_ucast && mojaB.min_ucast.prihlasenych === 5, JSON.stringify(mojaB && mojaB.min_ucast));

    const skontroluj = async (p, nazov, karty) => {
      const m = await p.evaluate(sel => {
        const rows = [...document.querySelectorAll(sel + ' .fa-min')];
        const pretec = rows.filter(r => { const x = r.getBoundingClientRect(); return x.right > innerWidth + 1 || x.left < -1; }).length;
        return { n: rows.length, texty: rows.map(r => r.querySelector('.fa-min-row').innerText.replace(/\s+/g, ' ').trim()), pretec, scrollX: document.documentElement.scrollWidth > innerWidth + 1 };
      }, karty);
      return m;
    };

    // ── rozvrh /schedule
    console.log('\nRozvrh /schedule (mobil):');
    let p = await ctx.newPage(); let ch = []; p.on('pageerror', e => ch.push(e.message));
    await p.goto(BASE + '/schedule', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof showDay === 'function', null, { timeout: 20000 });
    await p.evaluate(d => { try { showDay(d); } catch (e) {} }, DOW);
    await p.waitForSelector('.class-card', { timeout: 15000 });
    await p.waitForTimeout(600);
    let m = await skontroluj(p, 'rozvrh', '#classGrid, body');
    const karty = await p.evaluate(() => [...document.querySelectorAll('.class-card')].map(c => ({ t: c.innerText.replace(/\s+/g, ' '), min: !!c.querySelector('.fa-min') })));
    ok('riadok s minimom pri Brezne a Zvolene (2), Detva bez', m.n === 2 && karty.filter(k => /Detva/.test(k.t)).every(k => !k.min), JSON.stringify(karty.map(k => [k.t.slice(0, 40), k.min])));
    ok('Brezno: „Prihlásených 5 z 8 potrebných · chýba 3"', m.texty.some(t => /Prihlásených 5 z 8 potrebných · chýba 3/.test(t)), JSON.stringify(m.texty));
    ok('Zvolen: „Prihlásených 0 z 8"', m.texty.some(t => /Prihlásených 0 z 8/.test(t)), JSON.stringify(m.texty));
    const r0 = p.locator('.class-card .fa-min-row').first();
    ok('vysvetlenie je na začiatku skryté', await p.locator('.fa-min-info').first().isHidden());
    await r0.tap();
    const info = p.locator('.fa-min-info').first();
    ok('otáznik rozbalí vysvetlenie', await info.isVisible() && (await r0.getAttribute('aria-expanded')) === 'true');
    const it = (await info.innerText()).replace(/\s+/g, ' ');
    ok('text: koná sa od 8 ľudí', /sa koná, keď je prihlásených aspoň 8 ľudí/.test(it), it);
    ok('text: rezervuj skôr, 3 hodiny pred začiatkom sa ruší', /Rezervuj si miesto čím skôr/.test(it) && /Ak 3 hodiny pred začiatkom nebude prihlásených aspoň 8, hodinu zrušíme/.test(it), it);
    ok('text: vrátime vstup, predĺžime členstvo o ' + dni + ' dni, dáme vedieť', /hodinu zdarma, ktorými si hodinu platila, ti vrátime/.test(it) && new RegExp('predĺžime o ' + dni + ' dni').test(it) && /v appke aj e-mailom/.test(it), it);
    if (OUT) await p.locator('.class-card', { has: p.locator('.fa-min-info:visible') }).first().screenshot({ path: path.join(OUT, 'rozvrh-otaznik.png') });
    await r0.tap();
    ok('druhé ťuknutie vysvetlenie zbalí', await info.isHidden());
    ok('nič nepreteká, strana sa neposúva do boku', m.pretec === 0 && !m.scrollX, JSON.stringify(m));
    ok('rozvrh bez chýb v JS', ch.length === 0, ch.join(' | '));
    await p.close();

    // ── nástenka klientky
    console.log('\nNástenka (mobil):');
    p = await ctx.newPage(); ch = []; p.on('pageerror', e => ch.push(e.message));
    await p.goto(BASE + '/client-dashboard', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelectorAll('#classGrid .class-card').length >= 3, null, { timeout: 25000 }).catch(() => {});
    await p.waitForFunction(() => document.querySelector('#bookingsList .booking-item'), null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(800);
    m = await skontroluj(p, 'nástenka', '#classGrid');
    ok('karty rozvrhu na nástenke: minimum pri Brezne a Zvolene', m.n === 2, JSON.stringify(m.texty));
    const mb2 = await skontroluj(p, 'rezervácie', '#bookingsList');
    ok('moja rezervácia v Brezne ukazuje 5 z 8', mb2.n === 1 && /5 z 8/.test(mb2.texty[0] || ''), JSON.stringify(mb2.texty));
    const rb = p.locator('#bookingsList .fa-min-row').first();
    if (await rb.count()) { await rb.tap(); ok('pri rezervácii sa vysvetlenie rozbalí', await p.locator('#bookingsList .fa-min-info').first().isVisible()); }
    await p.waitForTimeout(700);
    if (OUT) await p.locator('#bookingsList').screenshot({ path: path.join(OUT, 'nastenka-rezervacia.png') });
    ok('nástenka: nič nepreteká', m.pretec === 0 && mb2.pretec === 0 && !m.scrollX, JSON.stringify([m, mb2]));
    ok('nástenka bez chýb v JS', ch.length === 0, ch.join(' | '));
    await p.close();

    // ── potvrdenie rezervácie (výber termínu na úvodnej stránke)
    console.log('\nPotvrdenie rezervácie (bez prihlásenia — úvodná stránka prihlásenú presmeruje):');
    const ctxH = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'sk-SK', serviceWorkers: 'block' });
    p = await ctxH.newPage(); ch = []; p.on('pageerror', e => ch.push(e.message));
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof openBookConfirm === 'function' && window.FA_MIN, null, { timeout: 20000 });
    const potv = await p.evaluate(async d => {
      const cl = await fetch('/api/classes').then(r => r.json());
      const b = cl.find(c => c._id === 'qaMuBrezno00001'), dt = cl.find(c => c._id === 'qaMuDetva000001');
      openBookConfirm(b, d); const t1 = document.getElementById('bcMinUcast').innerText.replace(/\s+/g, ' ');
      const iny = new Date(d + 'T12:00:00'); iny.setDate(iny.getDate() + 7);
      openBookConfirm(b, iny.toISOString().slice(0, 10)); const t2 = document.getElementById('bcMinUcast').innerText.replace(/\s+/g, ' ');
      openBookConfirm(dt, d); const t3 = document.getElementById('bcMinUcast').innerText.trim();
      return { t1, t2, t3 };
    }, DATUM);
    ok('najbližší termín v Brezne: 5 z 8', /Prihlásených 5 z 8/.test(potv.t1), potv.t1);
    ok('iný dátum: len pravidlo „Koná sa od 8 prihlásených"', /Koná sa od 8 prihlásených/.test(potv.t2), potv.t2);
    ok('Detva: v potvrdení nič', potv.t3 === '', potv.t3);
    ok('úvodná stránka bez chýb v JS', ch.length === 0, ch.join(' | '));
    await p.close(); await ctxH.close();
    await ctx.close();
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nMINIMUM PRIHLÁSENÝCH: ' + passed + ' OK / ' + failed + ' chýb');
    process.exit(failed ? 1 : 0);
  }
})();
