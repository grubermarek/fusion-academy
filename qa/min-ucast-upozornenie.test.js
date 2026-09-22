/**
 * Upozornenie trénerovi 3 hodiny pred hodinou, keď je málo prihlásených (Marek 22. 9. 2026).
 * Brezno, Zvolen, BB (MIN_UCAST): v okne 3 h pred začiatkom, ak je prihlásených menej ako 8,
 * dostane tréner termínu oznam v appke (+ mail, v teste vypnutý). Bez trénera dostanú oznam admini.
 * Každý termín len raz. Appka hodinu sama nezruší.
 *
 * Overuje:
 *  - Brezno o 30 min, 3 prihlásené → upozornený tréner termínu (nie admin), text s počtom 3 z 8
 *  - Zvolen o 30 min, 8 prihlásených → nikto
 *  - Detva o 30 min, 1 prihlásená → nikto (nemá minimum)
 *  - zrušený termín → nikto
 *  - BB o 5 h → mimo okna, nikto (len keď je v SK ešte pred 18:00)
 *  - Brezno s deaktivovanou trénerkou → upozornení admini
 *  - druhá kontrola nič nezopakuje; hodina ostáva nezrušená
 *  - trénerský panel ukazuje štítok „⚠️ 3/8 — do minima chýba 5"
 *
 * Spustenie:  node qa/min-ucast-upozornenie.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4620, BASE = 'http://localhost:' + PORT;
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-minupoz-'));
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';

// slovenský čas (server ho ráta rovnako, bez ohľadu na zónu stroja)
const skCast = ms => { const p = {}; for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bratislava', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date(ms))) p[x.type] = x.value; return p; };
const teraz = skCast(Date.now());
const DNES = teraz.year + '-' + teraz.month + '-' + teraz.day;
const DOW = new Date(DNES + 'T12:00:00Z').getUTCDay();
const hhmm = ms => { const p = skCast(ms); return (p.hour === '24' ? '00' : p.hour) + ':' + p.minute; };
const O30 = hhmm(Date.now() + 30 * 60000);
const O5H = hhmm(Date.now() + 5 * 3600000);
const skHod = +teraz.hour;
const oknoOK = skCast(Date.now() + 30 * 60000).day === teraz.day;   // o 30 min je ešte dnes
const mimoOK = skHod < 18;                                           // o 5 h je ešte dnes

(async () => {
  if (!oknoOK) { console.log('  ⏭️ tesne pred polnocou sa test nedá spustiť (hodina o 30 min by bola zajtra)'); process.exit(0); }
  const hash = bcrypt.hashSync('Heslo123!', 10);
  let rc = 0;
  const U = (id, name, extra) => ({ _id: id, name, email: id.toLowerCase() + '@qa-biz.local', password: hash, active: true, created_at: '2026-01-01', referral_code: 'QAMP' + String(++rc).padStart(3, '0'), onboarding_done: true, ...extra });
  const users = [
    U('qaMpAdmin000001', 'Adam Admin', { is_admin: true, user_type: 'admin' }),
    U('qaMpTrener00001', 'Tina Trénerka', { user_type: 'trainer' }),
    U('qaMpNeaktiv0001', 'Nora Neaktívna', { user_type: 'trainer', active: false }),
  ];
  for (let i = 1; i <= 8; i++) users.push(U('qaMpKli0000' + String(i).padStart(3, '0'), 'Klientka ' + i, { user_type: 'client' }));
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky(users));
  const C = (id, loc, time, ins, insName) => ({ _id: id, name: 'Zumba', category: 'Zumba', location: loc, day_of_week: DOW, time_start: time, time_end: '23:59', capacity: 30, price: 10, emoji: '💃',
    active: true, created_at: '2026-01-01', ...(ins ? { instructor_id: ins, instructor: insName || 'Tina Trénerka' } : {}) });
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    C('qaMpBrezno00001', 'Brezno', O30, 'qaMpTrener00001'),
    C('qaMpZvolen00001', 'Zvolen', O30, 'qaMpTrener00001'),
    C('qaMpDetva000001', 'Detva', O30, 'qaMpTrener00001'),
    C('qaMpZrusena0001', 'Brezno', O30, 'qaMpTrener00001'),
    C('qaMpBystrica001', 'Banská Bystrica', O5H, 'qaMpTrener00001'),
    C('qaMpBezTrenera1', 'Brezno', O30, 'qaMpNeaktiv0001', 'Nora Neaktívna'),
  ]));
  const bk = []; let k = 0;
  const B = (cls, n) => { for (let i = 1; i <= n; i++) bk.push({ _id: 'qaMpBk' + String(++k).padStart(8, '0'), user_id: 'qaMpKli0000' + String(i).padStart(3, '0'), user_name: 'Klientka ' + i, class_id: cls, class_name: 'Zumba', booking_date: DNES, status: 'confirmed', access_method: 'membership', created_at: '2026-09-20T10:00:00.000Z' }); };
  B('qaMpBrezno00001', 3); B('qaMpZvolen00001', 8); B('qaMpDetva000001', 1); B('qaMpZrusena0001', 2); B('qaMpBystrica001', 1); B('qaMpBezTrenera1', 2);
  // odhlásená sa neráta
  bk.push({ _id: 'qaMpBkOdhlas01', user_id: 'qaMpKli0000004', user_name: 'Klientka 4', class_id: 'qaMpBrezno00001', booking_date: DNES, status: 'cancelled', created_at: '2026-09-20T10:00:00.000Z' });
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky(bk));
  fs.writeFileSync(path.join(DATA, 'class_cancellations.db'), riadky([{ _id: 'qaMpCx00000001', class_id: 'qaMpZrusena0001', date: DNES, class_name: 'Zumba', location: 'Brezno', reason: 'test', created_at: '2026-09-20T10:00:00.000Z' }]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1']
    .map((x, i) => ({ _id: 'qaMpSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('UPOZORNENIE TRÉNEROVI — štart servera (hodiny o ' + O30 + ', BB o ' + O5H + ')…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; srv.stderr.on('data', d => { stderr += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + stderr.slice(-800)); process.exit(1); }
  await sleep(3000);

  let browser = null;
  const prihlas = async email => { const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Heslo123!' }) }); return String(r.headers.get('set-cookie') || '').split(';')[0]; };
  try {
    const cA = await prihlas('qampadmin000001@qa-biz.local');
    const cT = await prihlas('qamptrener00001@qa-biz.local');
    ok('prihlásenie admina aj trénerky', !!cA && !!cT);
    const kontrola = async () => (await fetch(BASE + '/api/admin/min-ucast/kontrola', { method: 'POST', headers: { Cookie: cA } })).json();
    const notif = async c => { const r = await (await fetch(BASE + '/api/notifications', { headers: { Cookie: c } })).json(); return (Array.isArray(r) ? r : (r.notifications || r.items || [])).filter(n => n.type === 'min_ucast'); };

    const r1 = await kontrola();
    const v = id => (r1.vysledok || []).find(x => x.class_id === id);
    ok('kontrola beží (admin)', r1.ok === true, JSON.stringify(r1).slice(0, 300));
    ok('Brezno 3/8 → upozornená trénerka termínu', v('qaMpBrezno00001')?.prihlasenych === 3 && JSON.stringify(v('qaMpBrezno00001')?.upozornene) === '["Tina Trénerka"]', JSON.stringify(v('qaMpBrezno00001')));
    ok('Zvolen 8/8 → vyhodnotený, nikto neupozornený', v('qaMpZvolen00001') && v('qaMpZvolen00001').upozornene.length === 0, JSON.stringify(v('qaMpZvolen00001')));
    ok('Detva sa nekontroluje (nemá minimum)', !v('qaMpDetva000001'));
    ok('zrušený termín sa nekontroluje', !v('qaMpZrusena0001'));
    if (mimoOK) ok('BB o 5 h je mimo okna 3 h', !v('qaMpBystrica001'));
    else console.log('  ⏭️ BB o 5 h — neskoro večer sa nedá overiť');
    ok('Brezno s deaktivovanou trénerkou → upozornení admini, nie ona', (v('qaMpBezTrenera1')?.upozornene || []).includes('Adam Admin') && !(v('qaMpBezTrenera1')?.upozornene || []).includes('Nora Neaktívna'), JSON.stringify(v('qaMpBezTrenera1')));

    const nT = await notif(cT), nA = await notif(cA);
    ok('trénerka má presne 1 upozornenie', nT.length === 1, JSON.stringify(nT.map(n => n.title)));
    const tx = nT[0] ? nT[0].title + ' ' + nT[0].body : '';
    ok('text: počet 3 z 8, chýba 5, v Brezne, čas', /prihlásených 3 z 8 \(chýba 5\)/.test(tx) && /v Brezne o /.test(tx) && tx.includes(O30), tx);
    ok('text: ako zrušiť + čo dostanú klientky', /ťukni na „Zrušiť"/.test(tx) && /vráti vstup, členstvo sa predĺži o 4 dni/.test(tx), tx);
    ok('admin má 1 upozornenie (hodina s deaktivovanou trénerkou), nie za hodinu Tiny', nA.length === 1 && nA.every(n => n.class_id === 'qaMpBezTrenera1'), JSON.stringify(nA.map(n => n.class_id)));

    const r2 = await kontrola();
    ok('druhá kontrola nič nezopakuje', (r2.vysledok || []).length === 0 && (await notif(cT)).length === 1, JSON.stringify(r2));
    const cls = await (await fetch(BASE + '/api/classes')).json();
    ok('appka hodinu sama nezrušila', cls.find(c => c._id === 'qaMpBrezno00001')?.cancelled === false);
    const src = fs.readFileSync(path.join(KOREN, 'server.js'), 'utf8');
    ok('kontrola beží sama každých 5 minút', /setInterval\(\(\)=>\{ minUcastKontrola\(\)[^\n]*5\*60\*1000\)/.test(src));

    // trénerský panel — štítok pri dnešnej hodine
    console.log('\nTrénerský panel:');
    const sch = await (await fetch(BASE + '/api/attendance/schedule', { headers: { Cookie: cT } })).json();
    const sb = (Array.isArray(sch) ? sch : []).find(c => c._id === 'qaMpBrezno00001');
    ok('rozvrh trénera posiela minimum s 3 prihlásenými', sb && sb.min_ucast && sb.min_ucast.prihlasenych === 3, JSON.stringify(sb && sb.min_ucast));
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'sk-SK', serviceWorkers: 'block' });
    const [meno, hodnota] = cT.split('=');
    await ctx.addCookies([{ name: meno, value: hodnota, domain: 'localhost', path: '/' }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('fa_welcome_seen', '1'); } catch (e) {} });
    const p = await ctx.newPage(); const ch = []; p.on('pageerror', e => ch.push(e.message));
    await p.goto(BASE + '/trainer', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelectorAll('#todayClasses .today-class-item').length > 0, null, { timeout: 25000 }).catch(() => {});
    const st = await p.evaluate(() => ({
      dnes: [...document.querySelectorAll('#todayClasses .today-class-item')].map(e => e.innerText.replace(/\s+/g, ' ')),
      grid: [...document.querySelectorAll('#classGrid .min-ucast-badge')].map(e => e.innerText.trim()),
    }));
    ok('dnešné hodiny: Brezno so štítkom „3/8 — do minima chýba 5"', st.dnes.some(t => /3\/8 — do minima chýba 5/.test(t)), JSON.stringify(st.dnes));
    ok('dnešné hodiny: Zvolen „Minimum 8 splnené"', st.dnes.some(t => /Minimum 8 splnené \(8\)/.test(t)), JSON.stringify(st.dnes));
    ok('dnešné hodiny: Detva ani zrušená hodina štítok nemajú', st.dnes.filter(t => /Detva/.test(t)).every(t => !/minim/i.test(t)) && st.grid.length === 4, JSON.stringify(st));
    ok('trénerský panel bez chýb v JS', ch.length === 0, ch.join(' | '));
    await ctx.close();
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nUPOZORNENIE TRÉNEROVI: ' + passed + ' OK / ' + failed + ' chýb');
    process.exit(failed ? 1 : 0);
  }
})();
