/**
 * Venčeky — audit 6. 10. 2026, balík D: čo chýbalo deťom a rodičom.
 *
 * Audit našiel: nikde nebol čas začiatku večera, dieťa nevedelo, kto je jeho pár,
 * chýbal kontakt na lektora, nedalo sa dať vopred vedieť „nebudem“, chat upozorňoval
 * pri každej správe, učiteľovi appka tvrdila „bol si na 0 z 10 lekcií“, zrušená lekcia
 * neukázala dôvod a registračná stránka tykala aj riaditeľovi.
 *
 * Spustenie:  node qa/vencek-audit-deti.test.js      (QA_SHOTS=priečinok uloží screenshoty)
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4637;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-vdeti-'));
const SHOTS = process.env.QA_SHOTS || '';

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function j(url, opts, jar) {
  opts = opts || {};
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

const TRIEDA = 'qaVdTrieda00001', SKOLA = 'qaVdSkola000001', VECER = 'qaVdVecer000001';
const ZIAK = 'qaVdZiak0000001', PARTNER = 'qaVdZiak0000002', MAMA = 'qaVdMama0000001', UCIT = 'qaVdUcitel00001';

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zakl = { password: hash, user_type: 'client', active: true, created_at: '2026-09-01' };
  const vT = { venceky_class_id: TRIEDA, venceky_school_id: SKOLA };
  // zajtrajšia lekcia pre test pripomienky
  const zajtra = new Date(Date.now() + 86400000);
  const start = new Date(zajtra); start.setUTCHours(14, 0, 0, 0);
  w('users.db', [
    { _id: 'qaVdAdmin000001', name: 'Marek Gruber', email: 'qa.vd.admin@qa-biz.local', ...zakl, is_admin: true, user_type: 'admin', phone: '0904 31 51 51' },
    { _id: ZIAK, name: 'Ema Prvá', email: 'qa.vd.z1@qa-biz.local', ...zakl, ...vT, venceky_role: 'student', vencek_rodicia: [MAMA] },
    { _id: PARTNER, name: 'Jakub Druhý', email: 'qa.vd.z2@qa-biz.local', ...zakl, ...vT, venceky_role: 'student' },
    { _id: MAMA, name: 'Mama Prvá', email: 'qa.vd.mama@qa-biz.local', ...zakl, ...vT, venceky_role: 'parent' },
    { _id: UCIT, name: 'Učiteľka Triedna', email: 'qa.vd.ucitel@qa-biz.local', ...zakl, ...vT, venceky_role: 'teacher' },
  ]);
  w('venceky_schools.db', [{ _id: SKOLA, name: 'Halíč QA', city: 'Halíč', year: '2026/27', created_at: '2026-09-01' }]);
  w('venceky_classes.db', [{ _id: TRIEDA, school_id: SKOLA, name: 'Venčeková skupina', year: '2026/27', code: 'VEN-QAVD',
    price: 49.9, lessons_total: 12, lessons_before: 10, lessons_done: 1, lecturer: 'Marek Gruber', lecturer_id: 'qaVdAdmin000001',
    event_date: '2026-12-12', event_venue: 'Dom kultúry Halíč', schedule: 'Telocvičňa školy · štvrtok 14:00',
    roles: ['student', 'parent', 'teacher'], start_at: start.toISOString(),
    lesson_changes: [{ week: 1, cancelled: true, reason: 'Jesenné prázdniny' }],
    dances: [{ name: 'Waltz', level: 4 }, { name: 'Polka', level: 0 }], created_at: '2026-09-01' }]);
  w('vencek_vecery.db', [{ _id: VECER, class_id: TRIEDA, title: 'Venčekový večer — Halíč QA', start_time: '18:30', warn_min: 2,
    team: [], items: [], program: [], pary: [{ id: 'p1', a: { uid: ZIAK, name: 'Ema Prvá' }, b: { uid: PARTNER, name: 'Jakub Druhý' } }],
    view_token: 'qaVdView0000000000', live: { status: 'pred', idx: -1, log: [] }, rev: 1, created_at: '2026-09-01' }]);

  console.log('VENČEKY — ČO CHÝBALO DEŤOM A RODIČOM\n');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TZ: 'UTC', PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_FAKE: '1', NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await sleep(15000);

  const jar = {};
  let browser;
  try {
    for (const [k, e] of [['adm', 'qa.vd.admin'], ['ziak', 'qa.vd.z1'], ['partner', 'qa.vd.z2'], ['mama', 'qa.vd.mama'], ['ucitel', 'qa.vd.ucitel']]) {
      jar[k] = {}; await j('/api/login', { method: 'POST', body: { email: e + '@qa-biz.local', password: 'Heslo123!' } }, jar[k]);
    }

    console.log('1) Čo žiak a rodič konečne vidia:');
    const mZ = (await j('/api/vencek/mine', {}, jar.ziak)).d;
    ok('čas začiatku venčekového večera', mZ.class.event_start === '18:30', JSON.stringify(mZ.class.event_start));
    ok('svoj pár na nástup', mZ.moj_par && mZ.moj_par.name === 'Jakub Druhý', JSON.stringify(mZ.moj_par));
    ok('kontakt na lektora (meno, telefón, mail)', mZ.class.lektor && mZ.class.lektor.name === 'Marek Gruber' && /0904/.test(mZ.class.lektor.phone || '') && /@/.test(mZ.class.lektor.email || ''), JSON.stringify(mZ.class.lektor));
    ok('dôvod zrušenej lekcie je v rozvrhu', (mZ.class.terminy || []).some(t => t.cancelled && /prázdniny/i.test(t.reason || '')), JSON.stringify((mZ.class.terminy || []).filter(t => t.cancelled)));
    const mP = (await j('/api/vencek/mine', {}, jar.partner)).d;
    ok('partner vidí opačné meno', mP.moj_par && mP.moj_par.name === 'Ema Prvá');
    const mU = (await j('/api/vencek/mine', {}, jar.ucitel)).d;
    ok('učiteľ už nedostáva cudziu „nulovú dochádzku"', mU.my_attendance === null, JSON.stringify(mU.my_attendance));

    console.log('\n2) Kalendár:');
    const ics = await fetch(BASE + '/api/vencek/kalendar.ics', { headers: { Cookie: jar.ziak.cookie } });
    const txt = await ics.text();
    ok('stiahne sa .ics s lekciami aj večerom', ics.status === 200 && /BEGIN:VCALENDAR/.test(txt) && /Venčekový večer/.test(txt) && /lekcia/i.test(txt), txt.slice(0, 80));
    ok('večer má čas 18:30', /DTSTART:2026121[12]T1[6-7]3000Z/.test(txt), (txt.match(/DTSTART:2026121.T\d+Z/) || ['?'])[0]);
    ok('zrušená lekcia v kalendári nie je', (txt.match(/SUMMARY:Venček — lekcia/g) || []).length === (mZ.class.terminy || []).filter(t => !t.cancelled).length);

    console.log('\n3) „Nebudem na lekcii":');
    let r = await j('/api/vencek/absencia', { method: 'POST', body: { reason: 'chrípka' } }, jar.ziak);
    ok('žiak sa ospravedlní', r.status === 200 && r.d.ok, JSON.stringify(r.d));
    ok('lektor dostal správu s dôvodom', rd('notifications.db').some(n => /nepríde na lekciu/.test(n.title || '') && /chrípka/.test(n.body || '') && n.user_id === 'qaVdAdmin000001'));
    ok('žiak má potvrdenie', rd('notifications.db').some(n => n.user_id === ZIAK && /Ospravedlnenie odoslané/.test(n.title || '')));
    ok('druhýkrát sa to nepošle znova', (await j('/api/vencek/absencia', { method: 'POST', body: {} }, jar.ziak)).d.uz === true);
    r = await j('/api/vencek/absencia', { method: 'POST', body: { reason: 'lyžovačka' } }, jar.mama);
    ok('rodič to vie poslať za dieťa', r.status === 200 && r.d.ok, JSON.stringify(r.d));

    console.log('\n4) Chat neupozorňuje pri každej správe:');
    for (let i = 1; i <= 4; i++) await j('/api/vencek/chat', { method: 'POST', body: { text: 'správa ' + i } }, jar.ziak);
    const chatN = rd('notifications.db').filter(n => String(n.key || '').startsWith('vencek_chat:'));
    ok('štyri správy = jedno upozornenie na človeka', chatN.filter(n => n.user_id === MAMA).length === 1, JSON.stringify(chatN.map(n => n.user_id)));
    ok('upozornenie ukazuje počet', chatN.some(n => /4 nové správy/.test(n.title || '')), JSON.stringify(chatN.map(n => n.title)));

    console.log('\n5) Pripomienka deň pred lekciou a zápis dochádzky:');
    await j('/api/admin/qa/run-daily-tick?hour=9', { method: 'POST' }, jar.adm);
    await sleep(2500);
    const zajtraN = rd('notifications.db').filter(n => String(n.key || '').startsWith('vencek_zajtra:'));
    ok('žiak aj rodič dostali „zajtra máš venček"', zajtraN.some(n => n.user_id === ZIAK) && zajtraN.some(n => n.user_id === MAMA), JSON.stringify(zajtraN.map(n => n.title)));
    ok('v texte je čas lekcie', zajtraN.some(n => /\d{1,2}:\d{2}/.test(n.title || '')), JSON.stringify(zajtraN.map(n => n.title)));

    console.log('\n6) Obrazovky:');
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const stranka = async (k, cesta) => {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
      if (k) { const [meno, hodnota] = jar[k].cookie.split('='); await ctx.addCookies([{ name: meno, value: hodnota, domain: 'localhost', path: '/' }]); }
      const p2 = await ctx.newPage(); p2._chyby = []; p2.on('pageerror', e => p2._chyby.push(e.message));
      await p2.goto(BASE + cesta, { waitUntil: 'domcontentloaded' });
      return p2;
    };
    const pZ = await stranka('ziak', '/vencek');
    await pZ.waitForSelector('.hero', { timeout: 20000 });
    await sleep(600);
    const tZ = await pZ.evaluate(() => document.body.innerText);
    ok('žiak: pár, čas večera, kalendár aj „nebudem"', /Tvoj pár na venček: Jakub Druhý/.test(tZ) && /18:30/.test(tZ) && /Pridať termíny do kalendára/.test(tZ) && /Nebudem na lekcii/.test(tZ), tZ.slice(0, 300));
    ok('žiak: kontakt na lektora', /Marek Gruber/.test(tZ) && /0904/.test(tZ));
    ok('žiak: dôvod zrušenej lekcie', /Jesenné prázdniny/.test(tZ));
    ok('žiak: stránka bez chýb v JS', pZ._chyby.length === 0, pZ._chyby.join(' | '));
    ok('375 px bez vodorovného posúvania', await pZ.evaluate(() => document.documentElement.scrollWidth <= 375), String(await pZ.evaluate(() => document.documentElement.scrollWidth)));
    if (SHOTS) await pZ.screenshot({ path: path.join(SHOTS, 'vencek-ziak-po-audite.png'), fullPage: true });

    const pR = await stranka('mama', '/vencek');
    await pR.waitForSelector('.hero, .card', { timeout: 20000 });
    await sleep(500);
    const tR = await pR.evaluate(() => document.body.innerText);
    ok('rodičovi sa netyká pri košeliach', !/tancuješ venček/.test(tR), (tR.match(/.{0,40}tancuješ.{0,30}/) || [''])[0]);
    ok('rodič: bez chýb v JS', pR._chyby.length === 0, pR._chyby.join(' | '));

    const pReg = await stranka(null, '/v/VEN-QAVD');
    await pReg.waitForSelector('#f', { timeout: 20000 });
    const tReg1 = await pReg.evaluate(() => document.body.innerText);
    ok('registrácia žiakovi tyká a ukazuje cenu', /Čo ťa čaká/.test(tReg1) && /Cena kurzu/.test(tReg1));
    await pReg.selectOption('#rola', 'teacher');
    await sleep(400);
    const tReg2 = await pReg.evaluate(() => document.body.innerText);
    ok('učiteľke už netyká', /Čo čaká vašu triedu/.test(tReg2) && !/Naučíme ťa tancovať/.test(tReg2), tReg2.slice(0, 200));
    ok('učiteľke nesľubuje, že platí kurz', /Škola neplatí nič/.test(tReg2));
    ok('tlačidlo je bez tancovania', /Vytvoriť účet(?! a pridať)/.test(tReg2));
    ok('súhlas odkazuje na podmienky', await pReg.evaluate(() => !!document.querySelector('.suhlas a[href="/terms"]')));
    ok('registrácia bez chýb v JS', pReg._chyby.length === 0, pReg._chyby.join(' | '));
    if (SHOTS) await pReg.screenshot({ path: path.join(SHOTS, 'vencek-registracia-skola.png'), fullPage: true });
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    await sleep(600);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nVENČEKY — DETI A RODIČIA: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-1500));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
