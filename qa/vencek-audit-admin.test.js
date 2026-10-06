/**
 * Venčeky — audit 6. 10. 2026, balík C: admin bez terminálu.
 *
 * Audit našiel, že cenu skupiny, počet lekcií ani lektora sa z admina zmeniť nedalo
 * (len cez servisný token z terminálu, takže každá nová škola ostala na 49,90 €),
 * škola ani skupina sa nedali premenovať či zmazať, omylom ukončený venček sa nedal
 * vrátiť, presun žiaka nechal platbu v starej skupine, náklad sa nedal zmazať
 * a tichá chyba pri načítaní dochádzky vedela prepísať zapísané absencie.
 *
 * Spustenie:  node qa/vencek-audit-admin.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4635;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-vadm-'));
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

const A = 'qaVaTriedaA0001', B = 'qaVaTriedaB0001', SKOLA = 'qaVaSkola000001';
const ZIAK = 'qaVaZiak0000001', RODIC_UCET = 'qaVaRodicUcet01';

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zakl = { password: hash, user_type: 'client', active: true, created_at: '2026-09-01' };
  const vA = { venceky_class_id: A, venceky_school_id: SKOLA };
  w('users.db', [
    { _id: 'qaVaAdmin000001', name: 'Marek Gruber', email: 'qa.va.admin@qa-biz.local', ...zakl, is_admin: true, user_type: 'admin' },
    { _id: 'qaVaTrener00001', name: 'Iveta Lektorová', email: 'qa.va.trener@qa-biz.local', ...zakl, user_type: 'trainer' },
    { _id: ZIAK, name: 'Adela Káková', email: 'qa.va.dieta@qa-biz.local', ...zakl, ...vA, venceky_role: 'student' },
    // rodič, ktorý sa omylom zaregistroval ako žiak s menom dieťaťa a zaplatil
    { _id: RODIC_UCET, name: 'Adela  Káková', email: 'qa.va.rodic@qa-biz.local', ...zakl, ...vA, venceky_role: 'student' },
  ]);
  w('venceky_schools.db', [{ _id: SKOLA, name: 'Haliič QA', city: 'Halíč', year: '2026/27', created_at: '2026-09-01' }]);
  const trieda = (id, name) => ({ _id: id, school_id: SKOLA, name, year: '2026/27', code: 'VEN-QAVA' + (id === B ? '2' : ''),
    price: 49.9, lessons_total: 13, lessons_before: 10, lessons_done: 0, lecturer: 'Marek Gruber', event_date: '2026-12-12',
    roles: ['student', 'parent', 'teacher'], start_at: '2026-09-10T11:00:00.000Z', dances: [{ name: 'Waltz', level: 0 }], created_at: '2026-09-01' });
  w('venceky_classes.db', [trieda(A, 'Venčeková skupina'), trieda(B, '9.B')]);

  console.log('VENČEKY — ADMIN BEZ TERMINÁLU\n');
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

  const jar = { adm: {}, tren: {} };
  let browser;
  try {
    await j('/api/login', { method: 'POST', body: { email: 'qa.va.admin@qa-biz.local', password: 'Heslo123!' } }, jar.adm);
    await j('/api/login', { method: 'POST', body: { email: 'qa.va.trener@qa-biz.local', password: 'Heslo123!' } }, jar.tren);
    const trieda1 = () => rd('venceky_classes.db').find(c => c._id === A);

    console.log('1) Nastavenia skupiny:');
    let r = await j('/api/admin/venceky/class-update', { method: 'POST', body: { class_id: A, price: '60,50', lessons_total: 10, lessons_before: 10, name: '8. a 9. ročník', lecturer: 'Iveta Lektorová' } }, jar.adm);
    ok('cena, lekcie, názov aj lektor sa uložia', r.status === 200 && trieda1().price === 60.5 && trieda1().lessons_total === 10 && trieda1().name === '8. a 9. ročník', JSON.stringify(r.d));
    ok('lektor sa naviaže na účet trénera (nie len meno)', trieda1().lecturer_id === 'qaVaTrener00001', String(trieda1().lecturer_id));
    ok('cena s čiarkou prejde', trieda1().price === 60.5);
    ok('nezmyselná cena neprejde', (await j('/api/admin/venceky/class-update', { method: 'POST', body: { class_id: A, price: '-5' } }, jar.adm)).status === 400);
    ok('viac lekcií do venčeka než spolu neprejde', (await j('/api/admin/venceky/class-update', { method: 'POST', body: { class_id: A, lessons_total: 5, lessons_before: 9 } }, jar.adm)).status === 400);
    ok('prázdny názov neprejde', (await j('/api/admin/venceky/class-update', { method: 'POST', body: { class_id: A, name: '  ' } }, jar.adm)).status === 400);
    ok('zmena je v audite', rd('audit.db').some(a => a.action === 'vencek_skupina_upravena'));
    ok('tréner nastavenia meniť nemôže', (await j('/api/admin/venceky/class-update', { method: 'POST', body: { class_id: A, price: '1' } }, jar.tren)).status === 403);
    ok('nový lektor už smie zapísať dochádzku', (await j('/api/admin/venceky/attendance', { method: 'POST', body: { class_id: A, lesson_no: 1, absent: [] } }, jar.tren)).status === 200);

    console.log('\n2) Škola:');
    r = await j('/api/admin/venceky/school-update', { method: 'POST', body: { school_id: SKOLA, name: 'Halíč QA', year: '2027/28' } }, jar.adm);
    ok('preklep v názve školy sa dá opraviť', r.status === 200 && rd('venceky_schools.db')[0].name === 'Halíč QA');
    ok('nový školský rok sa prepíše aj do skupín', trieda1().year === '2027/28');

    console.log('\n3) Ukončenie venčeka sa dá vrátiť:');
    await j('/api/admin/venceky/complete', { method: 'POST', body: { class_id: B } }, jar.adm);
    ok('venček ukončený', rd('venceky_classes.db').find(c => c._id === B).completed === true);
    r = await j('/api/admin/venceky/uncomplete', { method: 'POST', body: { class_id: B, reason: 'omyl' } }, jar.adm);
    ok('a dá sa vrátiť', r.status === 200 && rd('venceky_classes.db').find(c => c._id === B).completed === false);
    ok('druhýkrát to už nejde', (await j('/api/admin/venceky/uncomplete', { method: 'POST', body: { class_id: B } }, jar.adm)).status === 400);

    console.log('\n4) Presun žiaka aj s platbou:');
    await j('/api/admin/venceky/payment', { method: 'POST', body: { class_id: A, user_id: ZIAK, method: 'cash' } }, jar.adm);
    r = await j('/api/admin/venceky/presun-ziaka', { method: 'POST', body: { user_id: ZIAK, class_id: B } }, jar.adm);
    const pl = rd('venceky_payments.db').find(p => p.user_id === ZIAK);
    ok('žiak je v novej skupine aj s platbou', r.status === 200 && rd('users.db').find(u => u._id === ZIAK).venceky_class_id === B && pl.class_id === B, JSON.stringify(r.d));
    ok('v novej skupine nie je vedený ako neplatič', (await j('/api/admin/venceky/class/' + B, {}, jar.adm)).d.members.find(m => m.id === ZIAK).paid === true);
    ok('presun je v audite', rd('audit.db').some(a => a.action === 'vencek_ziak_presunuty'));
    ok('do tej istej skupiny to nejde', (await j('/api/admin/venceky/presun-ziaka', { method: 'POST', body: { user_id: ZIAK, class_id: B } }, jar.adm)).status === 400);
    await j('/api/admin/venceky/presun-ziaka', { method: 'POST', body: { user_id: ZIAK, class_id: A } }, jar.adm);

    console.log('\n5) Náklady:');
    r = await j('/api/admin/venceky/cost', { method: 'POST', body: { class_id: A, label: 'Kvety', amount: '12,50' } }, jar.adm);
    ok('suma s čiarkou sa uloží', r.status === 200 && rd('venceky_costs.db').some(k => k.amount === 12.5), JSON.stringify(r.d));
    ok('záporná suma neprejde', (await j('/api/admin/venceky/cost', { method: 'POST', body: { class_id: A, label: 'X', amount: -5 } }, jar.adm)).status === 400);
    ok('nula neprejde', (await j('/api/admin/venceky/cost', { method: 'POST', body: { class_id: A, label: 'X', amount: 0 } }, jar.adm)).status === 400);
    const kid = rd('venceky_costs.db').find(k => k.amount === 12.5)._id;
    ok('náklad sa dá zmazať', (await j('/api/admin/venceky/cost-delete', { method: 'POST', body: { cost_id: kid, reason: 'preklep' } }, jar.adm)).status === 200 && !rd('venceky_costs.db').length);

    console.log('\n6) Dvojitý účet dieťaťa:');
    // Reálny stav z Halíča: zaplatil rodičov účet, účet dieťaťa je vedený ako neplatič.
    await j('/api/admin/venceky/payment-delete', { method: 'POST', body: { class_id: A, user_id: ZIAK, reason: 'rozmotanie dvojitého účtu' } }, jar.adm);
    await j('/api/admin/venceky/payment', { method: 'POST', body: { class_id: A, user_id: RODIC_UCET, method: 'cash' } }, jar.adm);
    ok('zaplatený je len rodičov účet', rd('venceky_payments.db').filter(p => p.class_id === A).length === 1);
    r = await j('/api/admin/venceky/rodic-z-uctu', { method: 'POST', body: { rodic_id: RODIC_UCET, dieta_id: ZIAK } }, jar.adm);
    const rodic = rd('users.db').find(u => u._id === RODIC_UCET), dieta = rd('users.db').find(u => u._id === ZIAK);
    ok('z druhého účtu je rodič pripojený k dieťaťu', r.status === 200 && rodic.venceky_role === 'parent' && (dieta.vencek_rodicia || []).includes(RODIC_UCET), JSON.stringify(r.d));
    ok('platba prešla na dieťa', rd('venceky_payments.db').some(p => p.user_id === ZIAK && p.class_id === A));

    console.log('\n7) Admin obrazovka:');
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const [meno, hodnota] = jar.adm.cookie.split('=');
    await ctx.addCookies([{ name: meno, value: hodnota, domain: 'localhost', path: '/' }]);
    const pA = await ctx.newPage(); pA._chyby = []; pA.on('pageerror', e => pA._chyby.push(e.message));
    await pA.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await pA.waitForFunction(() => typeof show === 'function', null, { timeout: 20000 });
    await pA.evaluate(() => show('venceky'));
    await pA.waitForSelector('#vencekyList .vv-karta, #vencekyList table', { timeout: 15000 }).catch(() => {});
    await pA.evaluate(id => vClassDetail(id, 'ostatne'), A);
    await pA.waitForSelector('#vsPrice', { timeout: 15000 });
    const nast = await pA.evaluate(() => ({ cena: document.getElementById('vsPrice').value, lekcie: document.getElementById('vsTotal').value, lektor: document.getElementById('vsLektor').value }));
    ok('v Ostatné sú polia cena, lekcie, lektor', nast.cena === '60,5' && nast.lekcie === '10' && /Iveta/.test(nast.lektor), JSON.stringify(nast));
    await pA.evaluate(() => vTab('ziaci'));
    const tZ = await pA.evaluate(() => document.querySelector('#vClassModal .vdet-panel[data-tab="ziaci"]').innerText);
    ok('pri žiakovi je presun a upozornenie na dvojitý účet nezmizlo zbytočne', /presunúť/.test(tZ), tZ.slice(0, 160));
    ok('v karte školy je úprava aj mazanie', await pA.evaluate(() => /vUpravSkolu|vZmazSkolu/.test(document.getElementById('vencekyList').innerHTML)));
    ok('admin bez chýb v JS', pA._chyby.length === 0, pA._chyby.join(' | '));
    if (SHOTS) await pA.screenshot({ path: path.join(SHOTS, 'vencek-admin-nastavenia.png'), fullPage: false });
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    await sleep(600);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nVENČEKY — ADMIN: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-1500));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
