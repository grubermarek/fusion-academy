/**
 * Venček: trieda platí hromadne cez triedneho učiteľa (Marek 24. 9. 2026, Podbrezová).
 *
 * „Podbrezovčania si už vyzbierali peniaze a majú ich triedni učitelia, takže vlastne
 * im už len potom pošleme mailom potvrdenie o zaplatení (ešte som nedostal peniaze)."
 *
 * Test stráži:
 *   · príznak na skupine sa dá zapnúť a vidno ho na registrácii aj u žiaka
 *   · v appke sa taký kurz nedá zaplatiť kartou (žiak ani rodič)
 *   · žiakom nechodia týždenné pripomienky nezaplateného kurzu
 *   · hromadný zápis platieb: všetkým naraz, potvrdenie e-mailom žiakovi aj rodičovi,
 *     doklad, druhý beh už nič nezapíše, cudzia skupina sa nedotkne
 *   · bežná skupina (bez príznaku) ostáva ako doteraz — platí sa kartou a pripomienky chodia
 *
 * Spustenie:  node qa/vencek-hromadna-platba.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4621;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-hromadna-'));
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

const PODB = 'qaHpPodbrezova1', HALIC = 'qaHpHalic000001', SKOLA = 'qaHpSkola000001', SKOLA2 = 'qaHpSkola000002';
const ZIAK1 = 'qaHpZiak0000001', ZIAK2 = 'qaHpZiak0000002', ZIAK3 = 'qaHpZiak0000003', MAMA = 'qaHpMama0000001', HZIAK = 'qaHpHalicZiak01';

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zakl = { password: hash, user_type: 'client', active: true, created_at: '2026-09-01' };
  const vP = { venceky_class_id: PODB, venceky_school_id: SKOLA };
  w('users.db', [
    { _id: 'qaHpAdmin000001', name: 'Marek Gruber', email: 'qa.hp.admin@qa-biz.local', ...zakl, is_admin: true, user_type: 'admin' },
    { _id: ZIAK1, name: 'Jakub Prvý', email: 'qa.hp.z1@qa-biz.local', ...zakl, ...vP, venceky_role: 'student', vencek_rodicia: [MAMA] },
    { _id: ZIAK2, name: 'Nina Druhá', email: 'qa.hp.z2@qa-biz.local', ...zakl, ...vP, venceky_role: 'student' },
    { _id: ZIAK3, name: 'Samo Tretí', email: 'qa.hp.z3@qa-biz.local', ...zakl, ...vP, venceky_role: 'student' },
    { _id: MAMA, name: 'Mama Prvá', email: 'qa.hp.mama@qa-biz.local', ...zakl, ...vP, venceky_role: 'parent' },
    { _id: HZIAK, name: 'Hanka Halíčska', email: 'qa.hp.h1@qa-biz.local', ...zakl, venceky_class_id: HALIC, venceky_school_id: SKOLA2, venceky_role: 'student' },
  ]);
  w('venceky_schools.db', [
    { _id: SKOLA, name: 'Podbrezová QA', city: 'Podbrezová', year: '2026/27', created_at: '2026-09-01' },
    { _id: SKOLA2, name: 'Halíč QA', city: 'Halíč', year: '2026/27', created_at: '2026-09-01' },
  ]);
  const trieda = (id, sid, code, cena) => ({ _id: id, school_id: sid, name: 'Venčeková skupina', year: '2026/27', code, price: cena,
    lessons_total: 10, lessons_before: 10, lessons_done: 2, lecturer: 'Marek Gruber', event_date: '2027-02-05',
    event_venue: 'Dom kultúry', roles: ['student', 'parent', 'teacher'], start_at: '2026-11-05T12:45:00.000Z',
    dances: [{ name: 'Waltz', level: 0 }], created_at: '2026-09-01' });
  w('venceky_classes.db', [trieda(PODB, SKOLA, 'VEN-QAPODB', 60), trieda(HALIC, SKOLA2, 'VEN-QAHALIC', 49.9)]);

  console.log('VENČEK — HROMADNÁ PLATBA CEZ TRIEDNEHO UČITEĽA\n');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TZ: 'UTC', PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_SECRET_KEY: 'sk_test_qa_fake', STRIPE_FAKE: '1', NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await sleep(15000); // migrácie po štarte

  const jar = { adm: {}, z1: {}, mama: {}, h1: {} };
  let browser;
  try {
    const prihlas = (k, e) => j('/api/login', { method: 'POST', body: { email: e, password: 'Heslo123!' } }, jar[k]);
    await prihlas('adm', 'qa.hp.admin@qa-biz.local'); await prihlas('z1', 'qa.hp.z1@qa-biz.local');
    await prihlas('mama', 'qa.hp.mama@qa-biz.local'); await prihlas('h1', 'qa.hp.h1@qa-biz.local');

    console.log('1) Zapnutie „peniaze vyberá trieda":');
    let r = await j('/api/admin/venceky/progress', { method: 'POST', body: { class_id: PODB, platba_hromadne: true, platba_hromadne_kto: 'triedna učiteľka' } }, jar.adm);
    ok('admin zapne príznak na skupine', r.status === 200 && rd('venceky_classes.db').find(c => c._id === PODB).platba_hromadne === true);
    let info = (await j('/api/vencek/info?code=VEN-QAPODB')).d;
    ok('registrácia vie, že platí trieda', info.platba_hromadne === true && info.platba_hromadne_kto === 'triedna učiteľka');
    ok('druhá skupina ostala bežná', (await j('/api/vencek/info?code=VEN-QAHALIC')).d.platba_hromadne === false);

    console.log('\n2) V appke sa neplatí:');
    r = await j('/api/vencek/checkout', { method: 'POST', body: {} }, jar.z1);
    ok('žiak: platba kartou odmietnutá s vysvetlením', r.status === 400 && /triedna učiteľka/.test(r.d.error || '') && /neplat/i.test(r.d.error || ''), JSON.stringify(r.d));
    r = await j('/api/vencek/checkout', { method: 'POST', body: { dieta_id: ZIAK1 } }, jar.mama);
    ok('rodič: to isté', r.status === 400 && /triedna učiteľka/.test(r.d.error || ''), JSON.stringify(r.d));
    ok('žiadna platba nevznikla', !rd('venceky_payments.db').length);
    const mojeP = (await j('/api/vencek/mine', {}, jar.z1)).d;
    ok('stránka žiaka pozná príznak', mojeP.class.platba_hromadne === true && mojeP.class.platba_hromadne_kto === 'triedna učiteľka', JSON.stringify(mojeP.class && mojeP.class.platba_hromadne));
    const mojeH = (await j('/api/vencek/mine', {}, jar.h1)).d;
    ok('bežná skupina platí kartou ďalej', mojeH.class.platba_hromadne === false);

    console.log('\n3) Pripomienky nezaplateného kurzu:');
    await j('/api/admin/qa/run-daily-tick?hour=9', { method: 'POST' }, jar.adm);
    await sleep(1500);
    const prip = rd('notifications.db').filter(n => /^vencek_platba:/.test(n.key || ''));
    ok('Podbrezovčanom nechodia', !prip.some(n => String(n.key).includes(PODB)), JSON.stringify(prip.map(n => n.key)));
    ok('bežnej skupine chodia ďalej', prip.some(n => String(n.key).includes(HALIC)), JSON.stringify(prip.map(n => n.key)));

    console.log('\n4) Hromadný zápis platieb (peniaze prišli):');
    r = await j('/api/admin/venceky/payment-bulk', { method: 'POST', body: { class_id: PODB, method: 'cash', amount: 60 } }, jar.adm);
    ok('zapísané všetkým trom žiakom', r.status === 200 && r.d.count === 3 && r.d.total === 180, JSON.stringify(r.d));
    const platby = rd('venceky_payments.db').filter(p => p.class_id === PODB);
    ok('platba má sumu, spôsob, hromadný príznak a kto zapísal', platby.length === 3
      && platby.every(p => p.amount === 60 && p.method === 'cash' && p.hromadne === true && p.recorded_by === 'qaHpAdmin000001'), JSON.stringify(platby[0]));
    ok('rodič nie je vedený ako platca', platby.every(p => !p.payer_id));
    const maily = rd('mail_log.db').filter(m => /Potvrdenie o platbe/.test(m.subject || ''));
    ok('potvrdenie mailom každému žiakovi', ['qa.hp.z1@qa-biz.local', 'qa.hp.z2@qa-biz.local', 'qa.hp.z3@qa-biz.local'].every(e => maily.some(m => m.to === e)), JSON.stringify(maily.map(m => m.to)));
    ok('potvrdenie aj rodičovi pripojeného dieťaťa', maily.some(m => m.to === 'qa.hp.mama@qa-biz.local'));
    ok('notifikácia v appke', rd('notifications.db').filter(n => /Potvrdenie o platbe/.test(n.title || '')).length >= 3);
    ok('doklad (faktúra) na každého', rd('invoices.db').filter(i => /Venčekový kurz/.test(JSON.stringify(i.items || []))).length === 3);
    ok('halíčska skupina sa toho nedotkla', !rd('venceky_payments.db').some(p => p.class_id === HALIC));
    r = await j('/api/admin/venceky/payment-bulk', { method: 'POST', body: { class_id: PODB, method: 'cash', amount: 60 } }, jar.adm);
    ok('druhý beh už nič nezapíše', r.d.count === 0 && r.d.uz === 3 && rd('venceky_payments.db').filter(p => p.class_id === PODB).length === 3, JSON.stringify(r.d));
    ok('žiak cudzej skupiny to nespustí', (await j('/api/admin/venceky/payment-bulk', { method: 'POST', body: { class_id: PODB } }, jar.z1)).status === 403);
    ok('žiak vidí zaplatené', (await j('/api/vencek/mine', {}, jar.z1)).d.my_payment.amount === 60);

    console.log('\n5) Obrazovky:');
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const stranka = async (k, cesta) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      if (k) { const [meno, hodnota] = jar[k].cookie.split('='); await ctx.addCookies([{ name: meno, value: hodnota, domain: 'localhost', path: '/' }]); }
      const p = await ctx.newPage(); p._chyby = []; p.on('pageerror', e => p._chyby.push(e.message));
      await p.goto(BASE + cesta, { waitUntil: 'domcontentloaded' });
      return p;
    };
    const pReg = await stranka(null, '/v/VEN-QAPODB');
    await pReg.waitForSelector('#f', { timeout: 20000 });
    const tReg = await pReg.evaluate(() => document.body.innerText);
    ok('registrácia: platí sa cez triedu, nie v appke', /cez triedu \(triedna učiteľka\)/.test(tReg) && /v appke nič neplatíš/i.test(tReg), tReg.slice(tReg.indexOf('Cena kurzu'), tReg.indexOf('Cena kurzu') + 220));
    if (SHOTS) await pReg.screenshot({ path: path.join(SHOTS, 'hromadna-registracia.png'), fullPage: true });

    // účet žiaka: platba je už zapísaná, tak sa pozrieme na skupinu bez platby
    await j('/api/admin/venceky/payment-delete', { method: 'POST', body: { class_id: PODB, user_id: ZIAK2 } }, jar.adm);
    await j('/api/login', { method: 'POST', body: { email: 'qa.hp.z2@qa-biz.local', password: 'Heslo123!' } }, (jar.z2 = {}));
    const pZ = await stranka('z2', '/vencek');
    await pZ.waitForSelector('.pay-no', { timeout: 20000 });
    const tZ = await pZ.evaluate(() => document.querySelector('.pay-no').innerText);
    ok('žiak: bez tlačidla na platbu, s vysvetlením', /triedna učiteľka/.test(tZ) && !(await pZ.evaluate(() => !!document.querySelector('.pay-no button'))), tZ);
    ok('bez chýb v JS', pZ._chyby.length === 0 && pReg._chyby.length === 0, [...pZ._chyby, ...pReg._chyby].join(' | '));
    if (SHOTS) await pZ.screenshot({ path: path.join(SHOTS, 'hromadna-ziak.png'), fullPage: true });

    const pA = await stranka('adm', '/admin');
    await pA.waitForFunction(() => typeof show === 'function', null, { timeout: 20000 });
    await pA.evaluate(id => vClassDetail(id, 'ostatne'), PODB);
    await pA.waitForSelector('#vHromadne', { timeout: 15000 });
    ok('admin: prepínač je zapnutý a vie, kto vyberá', await pA.evaluate(() => document.getElementById('vHromadne').checked && document.getElementById('vHromadneKto').value === 'triedna učiteľka'));
    await pA.evaluate(() => vTab('ziaci'));
    ok('admin: tlačidlo na hromadnú platbu pre nezaplateného', await pA.evaluate(() => /Zapísať platbu celej triede \(1\)/.test(document.querySelector('#vClassModal').innerText)));
    ok('admin: bez chýb v JS', pA._chyby.length === 0, pA._chyby.join(' | '));
    if (SHOTS) await pA.screenshot({ path: path.join(SHOTS, 'hromadna-admin.png'), fullPage: false });
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    await sleep(600);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nVENČEK — HROMADNÁ PLATBA: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-1500));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
