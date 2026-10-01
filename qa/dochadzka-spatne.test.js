/**
 * Dochádzka spätne (Marek 1. 10. 2026: „v trénerskom bookingu sa neviem vrátiť k včerajšiemu dňu,
 * aby som potvrdil hodinu a že som vybral hotovosť").
 *
 * Overuje v prehliadači: panel otvorí najbližší termín, šípkou sa dá prejsť na termín spred
 * týždňa, zoznam ukáže klientky z toho dňa, potvrdenie hodiny zapíše dochádzku NA TEN DEŇ
 * (nie na najbližší) a hotovosť sa dá vybrať aj spätne.
 *
 * Spustenie:  node qa/dochadzka-spatne.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4625, BASE = 'http://localhost:' + PORT;
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-spatne-'));
let ok = 0, zle = 0;
const t = (n, c, d) => { if (c) { ok++; console.log('  ✅ ' + n); } else { zle++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const sk = ms => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date(ms));
const DNES = sk(Date.now());
const DOW = new Date(DNES + 'T12:00:00Z').getUTCDay();
const PRED_TYZDNOM = sk(Date.now() - 7 * 864e5);

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaSpTrener00001', name: 'Tina Trénerka', email: 'qa.sp.trener@qa-biz.local', password: hash, user_type: 'trainer', active: true, created_at: '2026-01-01', referral_code: 'QASP01', onboarding_done: true },
    { _id: 'qaSpStara000001', name: 'Stará Klientka', email: 'qa.sp.stara@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QASP02', single_entries: 0 },
    { _id: 'qaSpHotovost001', name: 'Hotovostná Klientka', email: 'qa.sp.hotovost@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QASP03' },
    { _id: 'qaSpDnesna00001', name: 'Dnešná Klientka', email: 'qa.sp.dnesna@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QASP04' },
  ]));
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    { _id: 'qaSpHodina00001', name: 'Zumba', category: 'Zumba', location: 'Detva', day_of_week: DOW, time_start: '19:00', time_end: '20:00', capacity: 30, price: 10,
      emoji: '💃', active: true, instructor: 'Tina Trénerka', instructor_id: 'qaSpTrener00001', created_at: '2026-01-01' },
  ]));
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky([
    { _id: 'qaSpBkStara0001', user_id: 'qaSpStara000001', user_name: 'Stará Klientka', class_id: 'qaSpHodina00001', class_name: 'Zumba', booking_date: PRED_TYZDNOM, status: 'confirmed', access_method: 'membership', created_at: '2026-09-01T10:00:00.000Z' },
    { _id: 'qaSpBkHotov0001', user_id: 'qaSpHotovost001', user_name: 'Hotovostná Klientka', class_id: 'qaSpHodina00001', class_name: 'Zumba', booking_date: PRED_TYZDNOM, status: 'confirmed', access_method: 'pay_on_site', pay_on_site: true, pay_amount: 10, created_at: '2026-09-01T10:00:00.000Z' },
    { _id: 'qaSpBkDnes00001', user_id: 'qaSpDnesna00001', user_name: 'Dnešná Klientka', class_id: 'qaSpHodina00001', class_name: 'Zumba', booking_date: DNES, status: 'confirmed', access_method: 'membership', created_at: '2026-09-28T10:00:00.000Z' },
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1']
    .map((x, i) => ({ _id: 'qaSpSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('DOCHÁDZKA SPÄTNE — štart servera (dnes ' + DNES + ', pred týždňom ' + PRED_TYZDNOM + ')…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
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
    await ctx.addInitScript(() => { try { localStorage.setItem('fa_welcome_seen', '1'); } catch (e) {} });
    await ctx.request.post(BASE + '/api/login', { data: { email: 'qa.sp.trener@qa-biz.local', password: 'Heslo123!' } });
    const p = await ctx.newPage(); const js = []; p.on('pageerror', e => js.push(e.message));
    await p.goto(BASE + '/trainer', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof openAttendance === 'function' && typeof loadSchedule === 'function', null, { timeout: 25000 });
    await p.evaluate(async () => { try { await loadSchedule(); } catch (e) {} });
    await p.evaluate(() => openAttendance('qaSpHodina00001'));
    await p.waitForSelector('.attendee-item', { timeout: 15000 });
    await p.waitForTimeout(700);

    const dnes = await p.evaluate(() => ({ den: document.getElementById('attDenRow')?.innerText.replace(/\s+/g, ' ').trim(),
      mena: [...document.querySelectorAll('.attendee-item')].map(e => (e.querySelector('.att-name')?.innerText || e.innerText).trim()).slice(0, 5) }));
    t('panel otvorí najbližší termín s dnešnou klientkou', /dnes/i.test(dnes.den || '') && dnes.mena.some(m => /Dnešná/.test(m)), JSON.stringify(dnes));

    await p.evaluate(() => attZmenDen(-7));
    await p.waitForTimeout(1200);
    const minuly = await p.evaluate(() => ({ den: document.getElementById('attDenRow')?.innerText.replace(/\s+/g, ' ').trim(),
      mena: [...document.querySelectorAll('.attendee-item')].map(e => (e.querySelector('.att-name')?.innerText || e.innerText).trim()),
      vyberTlacidlo: [...document.querySelectorAll('.att-badge')].filter(e => /VYBER/i.test(e.innerText)).length }));
    t('šípka späť ukáže termín spred týždňa', /pred 7 dňami/.test(minuly.den || ''), minuly.den);
    t('v zozname sú klientky z toho dňa, nie z dnešného', minuly.mena.some(m => /Stará/.test(m)) && minuly.mena.some(m => /Hotovostná/.test(m)) && !minuly.mena.some(m => /Dnešná/.test(m)), JSON.stringify(minuly.mena));
    t('upozornenie, že ide o staršiu hodinu', /staršiu hodinu/i.test(minuly.den || ''), minuly.den);
    t('hotovosť sa dá vybrať aj spätne', minuly.vyberTlacidlo === 1, String(minuly.vyberTlacidlo));

    // potvrdenie hodiny za starý deň
    p.on('dialog', d => d.accept());
    for (const cb of await p.locator('.att-present').all()) await cb.check();
    await p.evaluate(() => confirmTrainerSession());
    await p.waitForTimeout(2500);
    const bk = fs.readFileSync(path.join(DATA, 'bookings.db'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));
    const posledny = id => bk.filter(x => x._id === id).pop();
    const stara = posledny('qaSpBkStara0001'), hotov = posledny('qaSpBkHotov0001'), dnesna = posledny('qaSpBkDnes00001');
    t('dochádzka sa zapísala na starý deň obom klientkam', stara.status === 'attended' && hotov.status === 'attended' && stara.booking_date === PRED_TYZDNOM,
      JSON.stringify({ stara: stara.status, hotovostna: hotov.status, den: stara.booking_date }));
    t('dnešná rezervácia ostala nedotknutá', dnesna.status === 'confirmed', dnesna.status);

    // výber hotovosti spätne (rovnaká cesta ako tlačidlo v paneli)
    const r = await ctx.request.post(BASE + '/api/admin/bookings/qaSpBkHotov0001/collect', { data: { amount: 10, method: 'cash' } });
    t('hotovosť za starý deň sa zapísala', r.ok(), 'stav ' + r.status());
    const bk2 = fs.readFileSync(path.join(DATA, 'bookings.db'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));
    const hot = bk2.filter(x => x._id === 'qaSpBkHotov0001').pop();
    t('vybratá suma sedí a je pri starom dni', !!hot.entry_collected && hot.entry_collected.amount === 10 && hot.booking_date === PRED_TYZDNOM, JSON.stringify(hot.entry_collected || {}));

    await p.evaluate(() => attNaNajblizsi());
    await p.waitForTimeout(1200);
    const spat = await p.evaluate(() => ({ den: document.getElementById('attDenRow')?.innerText.replace(/\s+/g, ' ').trim(),
      mena: [...document.querySelectorAll('.attendee-item')].map(e => (e.querySelector('.att-name')?.innerText || e.innerText).trim()) }));
    t('tlačidlo vráti na najbližší termín', /dnes/i.test(spat.den || '') && spat.mena.some(m => /Dnešná/.test(m)), JSON.stringify(spat));
    t('bez chýb v JS', js.length === 0, js.join(' | '));
  } catch (e) {
    zle++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    if (b) await b.close().catch(() => {});
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nDOCHÁDZKA SPÄTNE: ' + ok + ' OK / ' + zle + ' chýb');
    process.exit(zle ? 1 : 0);
  }
})();
