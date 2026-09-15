/**
 * Automatická obnova v profile (Marek 15. 9. 2026): klientky sa sťažovali, že im platba odišla
 * nečakane. Profil musí výrazne ukázať, že obnova beží, kedy a koľko sa strhne a ako ju vypnúť,
 * a namiesto „členstvo vyprší, obnov si ho" im 3 dni vopred príde, kedy sa strhne platba.
 *
 * Overuje (STRIPE_FAKE=1 → dátum a suma z appky):
 *  - /api/me a /api/shop/overview nesú odber (suma, dátum ďalšej platby); bez odberu null
 *  - profil: blok „Automatická obnova je zapnutá" so sumou, dátumom a tlačidlom vypnutia (otvorí dialóg)
 *  - odber beží, ale členstvo v appke vypršalo → blok ostane, tlačidlo nákupu sa neukáže
 *  - bez odberu: „automatická obnova je vypnutá, nič sa nestrhne"
 *  - denný tick: klientke s odberom príde raz „obnoví sa" (notifikácia + mail), nie „vyprší";
 *    ďalekej obnove nič; klientke bez odberu „vyprší" ostáva
 * Spustenie:  node qa/odber-profil.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4593, BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-odber-'));
const SHOTS = process.env.QA_SHOTS || os.tmpdir();
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const rd = f => { const p = path.join(DATA, f); if (!fs.existsSync(p)) return []; const m = new Map();
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l.trim()) continue; let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o.$$indexCreated) continue; if (o.$$deleted) { m.delete(o._id); continue; } m.set(o._id, o); } return [...m.values()]; };
async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json' };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const dni = n => new Date(Date.now() + n * 86400000).toISOString();
  const zak = { user_type: 'client', active: true, password: hash, created_at: '2026-06-01', city: 'Detva', onboarding_done: true, free_class_used: true, visit_count: 20, first_paid_at: '2026-06-02' };
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaOdAdmin000001', name: 'Adam Admin', email: 'qa.od.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01', referral_code: 'QAODAD' },
    { _id: 'qaOdAnna0000001', name: 'Anna Odberová', email: 'qa.od.anna@qa-biz.local', referral_code: 'QAODAN', stripe_subscription_id: 'sub_qa_anna', stripe_sub_plan: 'bronze', ...zak },
    { _id: 'qaOdBibi0000001', name: 'Bibiána Vypršaná', email: 'qa.od.bibi@qa-biz.local', referral_code: 'QAODBI', stripe_subscription_id: 'sub_qa_bibi', stripe_sub_plan: 'bronze', ...zak },
    { _id: 'qaOdCila0000001', name: 'Cecília Hotovostná', email: 'qa.od.cila@qa-biz.local', referral_code: 'QAODCI', ...zak },
    { _id: 'qaOdDana0000001', name: 'Dana Ďaleká', email: 'qa.od.dana@qa-biz.local', referral_code: 'QAODDA', stripe_subscription_id: 'sub_qa_dana', stripe_sub_plan: 'silver', ...zak },
  ]));
  fs.writeFileSync(path.join(DATA, 'memberships.db'), riadky([
    { _id: 'qaOdMemAnna', user_id: 'qaOdAnna0000001', plan_id: 'bronze', plan_name: 'Bronze', status: 'active', started_at: dni(-28), expires_at: dni(2.2), price: 49.9, created_at: dni(-28) },
    { _id: 'qaOdMemBibi', user_id: 'qaOdBibi0000001', plan_id: 'bronze', plan_name: 'Bronze', status: 'expired', started_at: dni(-31), expires_at: dni(-1), price: 49.9, created_at: dni(-31) },
    { _id: 'qaOdMemCila', user_id: 'qaOdCila0000001', plan_id: 'bronze', plan_name: 'Bronze', status: 'active', started_at: dni(-25), expires_at: dni(5), price: 49.9, payment_method: 'cash', created_at: dni(-25) },
    { _id: 'qaOdMemDana', user_id: 'qaOdDana0000001', plan_id: 'silver', plan_name: 'Silver', status: 'active', started_at: dni(-10), expires_at: dni(20), price: 74.9, created_at: dni(-10) },
  ]));
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const pm = new Date(+DNES.slice(0, 4), +DNES.slice(5, 7) - 2, 1);
  fs.writeFileSync(path.join(DATA, 'monthly_winners.db'), riadky([{ _id: 'qaOdMW01', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'x', created_at: '2026-01-01' }]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'stripe_obnovy_doplnenie_20260915']
    .map((k, i) => ({ _id: 'qaOdSet' + i, key: k, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('ODBER V PROFILE — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_FAKE: '1', STRIPE_SECRET_KEY: 'sk_test_qa_fake' },
    stdio: ['ignore', 'ignore', 'pipe'] });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1500)); process.exit(1); }
  await sleep(3000);

  let browser = null;
  try {
    const jar = {};
    for (const k of ['admin', 'anna', 'bibi', 'cila', 'dana']) {
      jar[k] = {};
      const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.od.' + k + '@qa-biz.local', password: 'Heslo123!' } }, jar[k]);
      if (lg.status !== 200) ok('prihlásenie ' + k, false, JSON.stringify(lg.d));
    }

    console.log('\nAPI:');
    const meA = (await j('/api/me', {}, jar.anna)).d;
    ok('/api/me: odber so sumou 49,90 € a dátumom ďalšej platby', meA.odber && meA.odber.suma === 49.9 && !meA.odber.vypnuty
      && Math.abs(Date.parse(meA.odber.dalsia_platba) - Date.parse(dni(2.2))) < 5 * 60000, JSON.stringify(meA.odber));
    ok('/api/me: bez odberu je odber null', (await j('/api/me', {}, jar.cila)).d.odber === null);
    const ov = (await j('/api/shop/overview', {}, jar.anna)).d;
    ok('/api/shop/overview nesie odber (Obchod ukáže dátum platby)', ov && ov.odber && ov.odber.suma === 49.9, JSON.stringify(ov && ov.odber));

    console.log('\nProfil (prehliadač):');
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const profil = async (k, subor) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
      const [meno, hodnota] = jar[k].cookie.split('=');
      await ctx.addCookies([{ name: meno, value: hodnota, domain: 'localhost', path: '/' }]);
      await ctx.addInitScript(() => { try { localStorage.setItem('fa_welcome_seen', '1'); } catch (e) {} });   // uvítacie okno by prekrylo kartu
      const p = await ctx.newPage(); const chyby = []; p.on('pageerror', e => chyby.push(e.message));
      await p.goto(BASE + '/client-dashboard', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => { const b = document.getElementById('mcPlan'); return b && b.textContent.trim() && b.textContent.trim() !== '—'; }, null, { timeout: 20000 }).catch(() => {});
      await sleep(1200);
      const stav = await p.evaluate(() => { const b = document.getElementById('mcOdber'); const buy = document.getElementById('mcBuyBtn');
        return { vidno: !!b && b.style.display === 'block', text: b ? b.innerText.replace(/\s+/g, ' ') : '', kupit: buy ? getComputedStyle(buy).display !== 'none' : null,
          plan: (document.getElementById('mcPlan') || {}).textContent, auto: (document.getElementById('mcAutoRenew') || {}).textContent }; });
      await p.evaluate(() => { const w = document.getElementById('welcomeGuide'); if (w) w.style.display = 'none'; });
      const karta = await p.$('#membershipCard'); if (karta) await karta.screenshot({ path: path.join(SHOTS, subor) }).catch(() => {});
      return { p, ctx, stav, chyby };
    };

    const a = await profil('anna', 'odber-anna.png');
    ok('Anna: blok „Automatická obnova je zapnutá" je viditeľný', a.stav.vidno && /Automatická obnova je zapnutá/.test(a.stav.text), JSON.stringify(a.stav));
    ok('Anna: ukazuje sumu 49,90 € a dátum s odpočtom dní', /49,90 €/.test(a.stav.text) && /\d{1,2}\. \d{1,2}\. 20\d\d/.test(a.stav.text) && /\(o \d+ dni\)|\(zajtra\)|\(dnes\)/.test(a.stav.text), a.stav.text);
    ok('Anna: je tam tlačidlo „Vypnúť automatickú obnovu"', /Vypnúť automatickú obnovu/.test(a.stav.text));
    ok('Anna: riadok Automatický odber = Zapnutý', /Zapnutý/.test(a.stav.auto || ''), a.stav.auto);
    await a.p.evaluate(() => document.getElementById('mcOdberVypnut').click());
    await sleep(500);
    ok('klik na vypnutie otvorí dialóg so zrušením odberu', await a.p.evaluate(() => !!document.getElementById('cancelModal') && /ZRUŠIŤ ODBER/.test(document.getElementById('cancelModal').innerText)));
    ok('Anna: bez chýb v JS', a.chyby.length === 0, a.chyby.join(' | '));
    await a.ctx.close();

    const b = await profil('bibi', 'odber-bibi.png');
    ok('Bibiána (odber beží, členstvo v appke vypršalo): blok obnovy ostane viditeľný', b.stav.vidno && /Automatická obnova je zapnutá/.test(b.stav.text), JSON.stringify(b.stav));
    ok('Bibiána: neponúka sa druhý nákup členstva', b.stav.kupit === false, JSON.stringify(b.stav));
    ok('Bibiána: bez chýb v JS', b.chyby.length === 0, b.chyby.join(' | '));
    await b.ctx.close();

    const c = await profil('cila', 'odber-cila.png');
    ok('Cecília (bez odberu): „automatická obnova je vypnutá — nič sa nestrhne"', c.stav.vidno && /vypnutá/.test(c.stav.text) && /nič nestrhne/.test(c.stav.text) && /\d{1,2}\. \d{1,2}\. 20\d\d/.test(c.stav.text) && !/Vypnúť automatickú obnovu/.test(c.stav.text), JSON.stringify(c.stav));
    ok('Cecília: riadok Automatický odber = Vypnutý', /Vypnutý/.test(c.stav.auto || ''), c.stav.auto);
    await c.ctx.close();

    console.log('\nDenný tick:');
    const tk = await j('/api/admin/qa/run-daily-tick?hour=9', { method: 'POST' }, jar.admin);
    ok('tick prebehol', tk.status === 200, JSON.stringify(tk.d));
    await sleep(2500);
    const notif = (uid, typ) => rd('notifications.db').filter(n => n.user_id === uid && n.type === typ);
    ok('Anna (platba o 2 dni): 1 upozornenie „obnoví sa" so sumou', notif('qaOdAnna0000001', 'renewal_notice').length === 1 && /49,90 €/.test(notif('qaOdAnna0000001', 'renewal_notice')[0].body), JSON.stringify(notif('qaOdAnna0000001', 'renewal_notice')));
    ok('Anna: žiadne „členstvo vyprší"', notif('qaOdAnna0000001', 'expiry_warning').length === 0, JSON.stringify(notif('qaOdAnna0000001', 'expiry_warning')));
    const maily = rd('mail_log.db');
    ok('Anna: mail o obnove odišiel raz', maily.filter(m => m.to === 'qa.od.anna@qa-biz.local' && m.template === 'renewal_notice').length === 1, JSON.stringify(maily.filter(m => m.to === 'qa.od.anna@qa-biz.local').map(m => m.subject)));
    ok('Dana (platba o 20 dní): nič', notif('qaOdDana0000001', 'renewal_notice').length === 0 && notif('qaOdDana0000001', 'expiry_warning').length === 0);
    ok('Cecília (bez odberu, končí o 5 dní): „vyprší" ostáva', notif('qaOdCila0000001', 'expiry_warning').length === 1, JSON.stringify(notif('qaOdCila0000001', 'expiry_warning')));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    await sleep(500);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nODBER V PROFILE: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
  }
})();
