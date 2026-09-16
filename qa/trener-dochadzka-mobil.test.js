/**
 * Trénerský panel — dochádzka hodiny na mobile a profil klientky (Marek 16. 9. 2026:
 * „v dochádzke nevidím celú tabuľku" a „keď kliknem na meno klienta, nenačíta sa").
 * Overí, že nič nepreteká za okraj zoznamu, stav je na celú šírku, štítky sú celé, počítač ostáva
 * v stĺpcoch, profil sa otvorí (nová karta / v nainštalovanej appke tá istá) a vráti do panela.
 *
 * Spustenie:  node qa/trener-dochadzka-mobil.test.js   (QA_SHOTS=priečinok uloží snímky)
 */
process.env.NODE_PATH = 'C:/Fusion Academy/automatizacie/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const bcrypt = require('bcryptjs');
const APP = path.join(__dirname, '..'), OUT = process.env.QA_SHOTS || '';
const PORT = 4612, BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-e2e-doch-'));
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const spi = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const dnes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const dow = new Date(dnes + 'T12:00:00Z').getUTCDay();
  const U = (id, name, extra) => ({ _id: id, name, email: id.toLowerCase() + '.velmi.dlhy.email@gmail.com', phone: '+421948031200', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QD' + id.slice(4, 10).toUpperCase(), free_class_used: true, visit_count: 12, ...extra });
  w('users.db', [
    { _id: 'qaDoTrener00001', name: 'Tréner Test', email: 'qa.do.trener@qa-biz.local', password: hash, user_type: 'trainer', active: true, created_at: '2026-01-01', referral_code: 'QDTREN' },
    U('qaDoLubica0001', 'Ľubica Bírešová', { visit_count: 27 }),
    U('qaDoMichaela01', 'michaela kanatova', { visit_count: 3, phone: '' }),
    U('qaDoJana000001', 'Jana Crmanova', { visit_count: 47, single_entries: 3 }),
    U('qaDoNova000001', 'Nová Klientka S Dlhým Menom', { visit_count: 0, free_class_used: false }),
    U('qaDoPlati00001', 'Platí Na Mieste', { visit_count: 5 }),
    U('qaDoMama000001', 'Mama Rodičovská', { visit_count: 8 }),
  ]);
  w('memberships.db', [{ _id: 'qaDoMem000001', user_id: 'qaDoLubica0001', plan_id: 'silver', plan_name: 'Silver', status: 'active', price: 74.9, expires_at: '2027-01-01', created_at: '2026-09-01' }]);
  const CID = 'qaDoZumbaDnes01';
  w('classes.db', [{ _id: CID, name: 'Zumba', emoji: '💃', category: 'Zumba', location: 'Detva', address: 'Záhradná 7', day_of_week: dow, time_start: '23:50', time_end: '23:59', capacity: 30, price: 10, instructor: 'Tréner Test', instructor_id: 'qaDoTrener00001', active: true, created_at: '2026-01-01' }]);
  const B = (id, uid, name, extra) => ({ _id: id, class_id: CID, class_name: 'Zumba', class_location: 'Detva', class_time_start: '23:50', class_time_end: '23:59', day_of_week: dow, user_id: uid, user_name: name, booking_date: dnes, status: 'confirmed', access_method: 'membership', created_at: dnes + 'T08:00:00.000Z', ...extra });
  w('bookings.db', [
    B('qaDoB1', 'qaDoLubica0001', 'Ľubica Bírešová', { attendance_status: 'no_show' }),
    B('qaDoB2', 'qaDoMichaela01', 'michaela kanatova', { attendance_status: 'no_show', access_method: 'single_entry' }),
    B('qaDoB3', 'qaDoJana000001', 'Jana Crmanova', { status: 'attended', attendance_status: 'attended', attendance_source: 'qr', access_method: 'single_entry' }),
    B('qaDoB4', 'qaDoNova000001', 'Nová Klientka S Dlhým Menom', { access_method: 'free_class', free_class: true }),
    B('qaDoB5', 'qaDoPlati00001', 'Platí Na Mieste', { access_method: 'pay_on_site', pay_on_site: true, pay_amount: 10, pay_plan_name: 'Jednorazový vstup' }),
    B('qaDoB6', 'qaDoMama000001', 'Dieťa Mamy', { is_child_booking: true, child_name: 'Dieťa Mamy', booked_by_name: 'Mama Rodičovská', access_method: 'parent_membership' }),
  ]);
  const sk = dnes; const pm = new Date(+sk.slice(0, 4), +sk.slice(5, 7) - 2, 1);
  w('monthly_winners.db', [{ _id: 'qaDoWinner0001', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'x', created_at: '2026-01-01' }]);
  w('settings.db', ['retro_confirm_v1', 'noshow_revert_v1', 'zumba_kids_hodiny_20260909', 'zumba_kids_casy_20260909b', 'zumba_kids_prehodenie_20260909c', 'zumba_kids_casy_20260913', 'alena_tx_karta_v1', 'deti_storno_noshow_20260913', 'ceny_4990_20260914']
    .map((k, i) => ({ _id: 'qaDoSet' + i, key: k, value: true, at: '2026-01-01T00:00:00.000Z' })));
  const srv = spawn(process.execPath, ['server.js'], { cwd: APP, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' } });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); while (Date.now() - t0 < 120000) { try { await fetch(BASE + '/api/config'); break; } catch (e) { await spi(1000); } }
  await spi(6000);
  const b = await chromium.launch();
  try {
    for (const [nazov, vp] of [['mobil', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['mobil-mini', { width: 360, height: 780, isMobile: true, hasTouch: true }], ['pocitac', { width: 1280, height: 900 }]]) {
      console.log('\n' + nazov + ' ' + vp.width + ' px:');
      const c = await b.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, deviceScaleFactor: 2, locale: 'sk-SK', serviceWorkers: 'block' });
      await c.addInitScript(() => { try { localStorage.setItem('fa_welcome_seen', '1'); } catch (e) {} });
      await c.request.post(BASE + '/api/login', { data: { email: 'qa.do.trener@qa-biz.local', password: 'Heslo123!' } });
      const p = await c.newPage(); const ch = []; p.on('pageerror', e => ch.push(e.message));
      await p.goto(BASE + '/trainer', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => typeof openAttendance === 'function' && typeof loadSchedule === 'function', null, { timeout: 20000 });
      await p.evaluate(async () => { try { await loadSchedule(); } catch (e) {} });
      await p.evaluate(id => openAttendance(id), CID);
      await p.waitForSelector('.attendee-item', { timeout: 15000 });
      await p.waitForTimeout(1200);
      const m = await p.evaluate(() => {
        const list = document.querySelector('.attendee-list').getBoundingClientRect();
        const rows = [...document.querySelectorAll('.attendee-item')];
        const pretec = [];
        for (const r of rows) for (const e of r.querySelectorAll('*')) {
          const x = e.getBoundingClientRect(); if (!x.width) continue;
          if (x.right > list.right + 1 || x.left < list.left - 1) pretec.push((r.querySelector('.att-name') || {}).innerText + ': ' + (e.className || e.tagName) + ' ' + Math.round(x.left) + '–' + Math.round(x.right));
        }
        const stav = rows.map(r => { const s = r.querySelector('.att-status .att-badge'); const rr = r.getBoundingClientRect(); return s ? Math.round(s.getBoundingClientRect().width / (rr.width - 28) * 100) : 0; });
        const vysky = rows.map(r => Math.round(r.getBoundingClientRect().height));
        const stavVyska = rows.map(r => { const s = r.querySelector('.att-status .att-badge'); return s ? Math.round(s.getBoundingClientRect().height) : 0; });
        const scrollX = document.documentElement.scrollWidth > innerWidth + 1;
        const texty = rows.map(r => r.innerText.replace(/\s+/g, ' ').slice(0, 400));
        return { pretec, stav, vysky, stavVyska, scrollX, texty, n: rows.length, head: getComputedStyle(document.querySelector('.att-head')).display };
      });
      ok('6 klientok v zozname', m.n === 6, String(m.n));
      ok('nič nepreteká za okraj zoznamu', m.pretec.length === 0, m.pretec.slice(0, 6).join(' | '));
      ok('stránka sa neposúva do strany', !m.scrollX);
      if (vp.width < 900) {
        ok('stav (bola tu / neprišla) je na celú šírku karty', m.stav.every(x => x >= 95), JSON.stringify(m.stav));
        ok('stav „neprišla — opraviť" má najviac 2 riadky', m.stavVyska.every(x => x <= 60), JSON.stringify(m.stavVyska));
        ok('texty štítkov sú celé (permanentka, členstvo, výber hotovosti, dieťa)', m.texty.some(t => /Permanentka \(−1 vstup\)/.test(t)) && m.texty.some(t => /Silver/.test(t)) && m.texty.some(t => /VYBER 10 € — Jednorazový vstup/.test(t)) && m.texty.some(t => /booknuté z rodičovského účtu/.test(t)), JSON.stringify(m.texty));
        ok('hlavička tabuľky na mobile skrytá', m.head === 'none');
      } else {
        ok('na počítači stĺpce s hlavičkou ako doteraz', m.head === 'grid' && m.vysky.every(v => v < 140), JSON.stringify({ h: m.head, v: m.vysky }));
      }
      // zaškrtnutie „bola tu" na mobile
      const cb = p.locator('.att-status input.att-present').first();
      await cb.click(); ok('checkbox „bola tu" sa dá zaškrtnúť', await cb.isChecked());
      ok('bez chýb v JS', ch.length === 0, ch.join(' | '));
      if (OUT) await p.locator('#attendeeItems').screenshot({ path: path.join(OUT, 'dochadzka-' + nazov + '.png') });
      // klik na meno klientky → profil sa načíta (nová karta)
      const nova = c.waitForEvent('page', { timeout: 10000 }).catch(() => null);
      await p.locator('.attendee-item a.att-name', { hasText: 'Jana Crmanova' }).click();
      const pp = await nova;
      if (pp) {
        await pp.waitForLoadState('domcontentloaded');
        const nacital = await pp.waitForFunction(() => /Jana Crmanova/.test(document.body.innerText), null, { timeout: 15000 }).then(() => true).catch(() => false);
        ok('klik na meno otvorí profil v novej karte a načíta sa', nacital && /\/u\/qaDoJana000001/.test(pp.url()), pp.url());
        await pp.close();
      } else ok('klik na meno otvorí profil v novej karte a načíta sa', /\/u\/qaDoJana000001/.test(p.url()), 'nová karta sa neotvorila, URL ' + p.url());
      await c.close();
      if (vp.width < 900) {
        // nainštalovaná appka (standalone): profil v tej istej karte
        const c2 = await b.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'sk-SK', serviceWorkers: 'block' });
        await c2.addInitScript(() => { try { localStorage.setItem('fa_welcome_seen', '1'); } catch (e) {}
          const mm = window.matchMedia.bind(window); window.matchMedia = q => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : mm(q); });
        await c2.request.post(BASE + '/api/login', { data: { email: 'qa.do.trener@qa-biz.local', password: 'Heslo123!' } });
        const q2 = await c2.newPage(); const ch2 = []; q2.on('pageerror', e => ch2.push(e.message));
        await q2.goto(BASE + '/trainer', { waitUntil: 'commit', timeout: 30000 }); await q2.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(e => console.log('     dcl timeout', q2.url()));
        await q2.waitForFunction(() => typeof openAttendance === 'function', null, { timeout: 20000 });
        await q2.evaluate(async () => { try { await loadSchedule(); } catch (e) {} });
        await q2.evaluate(id => openAttendance(id), CID);
        await q2.waitForSelector('.attendee-item a.att-name', { timeout: 15000 });
        let novaK = false; c2.on('page', () => { novaK = true; });
        await q2.locator('.attendee-item a.att-name', { hasText: 'Jana Crmanova' }).click();
        await q2.waitForURL(/\/u\/qaDoJana000001/, { timeout: 10000 }).catch(() => {});
        const nac2 = await q2.waitForFunction(() => /Jana Crmanova/.test(document.body.innerText), null, { timeout: 15000 }).then(() => true).catch(() => false);
        ok('nainštalovaná appka: profil v tej istej karte a načíta sa', !novaK && nac2 && /\/u\/qaDoJana000001/.test(q2.url()), q2.url() + ' nová karta: ' + novaK);
        if (OUT) await q2.screenshot({ path: path.join(OUT, 'dochadzka-profil-appka.png') });
        const spat = await q2.locator('#backLink').innerText().catch(() => '');
        ok('profil ponúkne „Späť do trénerského panela"', /Späť do trénerského panela/.test(spat), spat);
        await q2.click('#backLink');
        await q2.waitForURL(/\/trainer/, { timeout: 10000 }).catch(() => {});
        ok('tlačidlo vráti do trénerského panela', /\/trainer/.test(q2.url()), q2.url());
        ok('nainštalovaná appka: bez chýb v JS', ch2.length === 0, ch2.join(' | '));
        await c2.close();
      }
    }
  } catch (e) { failed++; console.log('  ❌ výnimka: ' + e.stack); }
  finally { await b.close(); srv.kill(); if (failed && chyba.trim()) console.log('stderr:', chyba.slice(-500)); console.log('\nTRÉNER — DOCHÁDZKA NA MOBILE: ' + passed + ' OK / ' + failed + ' chýb'); setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 500); }
})();
