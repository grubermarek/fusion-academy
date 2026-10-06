/**
 * Venčeky — audit 6. 10. 2026, balík A: súkromie detí a prístup.
 *
 * Marek: „prejdi celé venčekové menu … navrhni zmeny" → „všetko sprav".
 * Audit našiel, že všetkých 54 venčekových detí bolo vo verejnom zozname členov
 * komunity medzi 255 dospelými klientkami a ich profil (fotka, lajky, komentáre)
 * vedel otvoriť ktokoľvek prihlásený.
 *
 * Test stráži:
 *   · dieťa z venčeka nie je vo verejnom zozname členov ani vo vyhľadávaní
 *   · jeho profil, lajky a komentáre sú pre cudzieho zakázané (403)
 *   · spolužiak, pripojený rodič, učiteľ skupiny, tréner a admin ho vidia
 *   · venčekár, ktorý si kúpil členstvo (klientka), je v komunite normálne
 *   · riaditeľ aj učiteľ si otvoria vlastnú skupinu očami žiaka (predtým nekonečné presmerovanie)
 *   · cudziu skupinu si neotvoria
 *   · registračná stránka nenačítava reklamné skripty (deti, bez cookie lišty)
 *   · čítanie údajov skupiny znesie celú triedu z jednej IP (kiosk + 25 žiakov)
 *
 * Spustenie:  node qa/vencek-audit-sukromie.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4631;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-vsukr-'));

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
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

const TRIEDA = 'qaVsTrieda00001', TRIEDA2 = 'qaVsTrieda00002', SKOLA = 'qaVsSkola000001', SKOLA2 = 'qaVsSkola000002';
const ZIAK = 'qaVsZiak0000001', SPOLU = 'qaVsSpoluziak01', CUDZI = 'qaVsCudziZiak01', MAMA = 'qaVsMama0000001';
const UCIT = 'qaVsUcitel00001', RIAD = 'qaVsRiaditel001', KLIENTKA = 'qaVsKlientka001', ABSOLVENT = 'qaVsAbsolvent01';

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zakl = { password: hash, user_type: 'client', active: true, created_at: '2026-09-01' };
  const vT = { venceky_class_id: TRIEDA, venceky_school_id: SKOLA };
  w('users.db', [
    { _id: 'qaVsAdmin000001', name: 'Marek Gruber', email: 'qa.vs.admin@qa-biz.local', ...zakl, is_admin: true, user_type: 'admin' },
    { _id: 'qaVsTrener00001', name: 'Iveta Trénerka', email: 'qa.vs.trener@qa-biz.local', ...zakl, user_type: 'trainer' },
    { _id: ZIAK, name: 'Ema Deviatacka', email: 'qa.vs.ziak@qa-biz.local', ...zakl, ...vT, venceky_role: 'student', user_type: 'partner', vencek_rodicia: [MAMA] },
    { _id: SPOLU, name: 'Jakub Spolužiak', email: 'qa.vs.spolu@qa-biz.local', ...zakl, ...vT, venceky_role: 'student', user_type: 'partner' },
    { _id: CUDZI, name: 'Lea Zinej Skupiny', email: 'qa.vs.cudzi@qa-biz.local', ...zakl, venceky_class_id: TRIEDA2, venceky_school_id: SKOLA2, venceky_role: 'student', user_type: 'partner' },
    { _id: MAMA, name: 'Mama Deviatacka', email: 'qa.vs.mama@qa-biz.local', ...zakl, ...vT, venceky_role: 'parent' },
    { _id: UCIT, name: 'Učiteľka Triedna', email: 'qa.vs.ucitel@qa-biz.local', ...zakl, ...vT, venceky_role: 'teacher' },
    { _id: RIAD, name: 'Riaditeľ Školy', email: 'qa.vs.riaditel@qa-biz.local', ...zakl, venceky_school_id: SKOLA, venceky_role: 'director' },
    { _id: KLIENTKA, name: 'Dospelá Klientka', email: 'qa.vs.klientka@qa-biz.local', ...zakl },
    // venčekár, ktorý si kúpil členstvo — je to klientka, do komunity patrí
    { _id: ABSOLVENT, name: 'Nina Absolventka', email: 'qa.vs.abs@qa-biz.local', ...zakl, ...vT, venceky_role: 'student', user_type: 'client' },
  ]);
  w('venceky_schools.db', [
    { _id: SKOLA, name: 'Halíč QA', city: 'Halíč', year: '2026/27', created_at: '2026-09-01' },
    { _id: SKOLA2, name: 'Klenovec QA', city: 'Klenovec', year: '2026/27', created_at: '2026-09-01' },
  ]);
  const trieda = (id, sid, code) => ({ _id: id, school_id: sid, name: 'Venčeková skupina', year: '2026/27', code, price: 49.9,
    lessons_total: 10, lessons_before: 10, lessons_done: 1, lecturer: 'Marek Gruber', event_date: '2026-12-12',
    roles: ['student', 'parent', 'teacher', 'director'], start_at: '2026-09-10T11:00:00.000Z',
    dances: [{ name: 'Waltz', level: 0 }], created_at: '2026-09-01' });
  w('venceky_classes.db', [trieda(TRIEDA, SKOLA, 'VEN-QAVS'), trieda(TRIEDA2, SKOLA2, 'VEN-QAVS2')]);

  console.log('VENČEKY — SÚKROMIE DETÍ A PRÍSTUP\n');
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
  try {
    const prihlas = async (k, e) => { jar[k] = {}; await j('/api/login', { method: 'POST', body: { email: e, password: 'Heslo123!' } }, jar[k]); };
    for (const [k, e] of [['adm', 'qa.vs.admin'], ['trener', 'qa.vs.trener'], ['ziak', 'qa.vs.ziak'], ['spolu', 'qa.vs.spolu'],
      ['cudzi', 'qa.vs.cudzi'], ['mama', 'qa.vs.mama'], ['ucitel', 'qa.vs.ucitel'], ['riaditel', 'qa.vs.riaditel'],
      ['klientka', 'qa.vs.klientka'], ['abs', 'qa.vs.abs']]) await prihlas(k, e + '@qa-biz.local');

    console.log('1) Verejný zoznam komunity:');
    const clenovia = (await j('/api/community/members', {}, jar.klientka)).d || [];
    const mena = clenovia.map(x => x.name);
    ok('deti z venčeka v zozname nie sú', !mena.includes('Ema Deviatacka') && !mena.includes('Jakub Spolužiak') && !mena.includes('Lea Zinej Skupiny'), mena.join(', '));
    ok('venčekár s členstvom tam je', mena.includes('Nina Absolventka'));
    ok('dospelá klientka tam je', mena.includes('Dospelá Klientka'));
    ok('rodič a učiteľ zo skupiny tam sú', mena.includes('Mama Deviatacka') && mena.includes('Učiteľka Triedna'));
    const hladaj = (k, q2) => j('/api/community/search?q=' + encodeURIComponent(q2), {}, jar[k]).then(r => ((r.d || {}).people || []).map(p => p.name));
    ok('cudzia klientka dieťa nenájde ani hľadaním', !(await hladaj('klientka', 'Ema')).includes('Ema Deviatacka'));
    ok('spolužiak ho nájde', (await hladaj('spolu', 'Ema')).includes('Ema Deviatacka'));
    ok('tréner ho nájde', (await hladaj('trener', 'Ema')).includes('Ema Deviatacka'));

    console.log('\n2) Profil dieťaťa:');
    const profil = k => j('/api/profile/' + ZIAK, {}, jar[k]);
    ok('cudzia klientka: 403 so zrozumiteľnou hláškou', (await profil('klientka')).status === 403 && /súkromný/.test(((await profil('klientka')).d || {}).error || ''));
    ok('dieťa z inej skupiny: 403', (await profil('cudzi')).status === 403);
    ok('spolužiak: vidí', (await profil('spolu')).status === 200);
    ok('pripojená mama: vidí', (await profil('mama')).status === 200);
    ok('učiteľka skupiny: vidí', (await profil('ucitel')).status === 200);
    ok('tréner: vidí', (await profil('trener')).status === 200);
    ok('admin: vidí', (await profil('adm')).status === 200);
    ok('dieťa samo: vidí', (await profil('ziak')).status === 200);
    ok('profil klientky ostáva verejný', (await j('/api/profile/' + KLIENTKA, {}, jar.spolu)).status === 200);
    ok('venčekár s členstvom má profil verejný', (await j('/api/profile/' + ABSOLVENT, {}, jar.klientka)).status === 200);

    console.log('\n3) Lajky a komentáre k profilu dieťaťa:');
    ok('cudzia klientka nelajkne', (await j('/api/profile/' + ZIAK + '/like', { method: 'POST' }, jar.klientka)).status === 403);
    ok('cudzia klientka nekomentuje', (await j('/api/profile/' + ZIAK + '/comments', { method: 'POST', body: { text: 'ahoj' } }, jar.klientka)).status === 403);
    ok('cudzia klientka nečíta komentáre', (await j('/api/profile/' + ZIAK + '/comments', {}, jar.klientka)).status === 403);
    ok('spolužiak komentovať môže', (await j('/api/profile/' + ZIAK + '/comments', { method: 'POST', body: { text: 'super tanec' } }, jar.spolu)).status === 200);

    console.log('\n4) Riaditeľ a učiteľ si otvoria svoju skupinu:');
    let r = await j('/api/vencek/mine?ako=student&class_id=' + TRIEDA, {}, jar.riaditel);
    ok('riaditeľ: dostane pohľad žiaka (žiadne zacyklenie)', r.status === 200 && r.d.role === 'student' && r.d.preview === true, JSON.stringify(r.d && r.d.error));
    ok('učiteľ: to isté', (await j('/api/vencek/mine?ako=student&class_id=' + TRIEDA, {}, jar.ucitel)).status === 200);
    ok('riaditeľ cudziu školu neotvorí', (await j('/api/vencek/mine?ako=student&class_id=' + TRIEDA2, {}, jar.riaditel)).status === 403);
    const klRes = await j('/api/vencek/mine?ako=student&class_id=' + TRIEDA, {}, jar.klientka);
    ok('klientka mimo venčekov neotvorí nič', klRes.status === 403 || (klRes.d && klRes.d.role === null), JSON.stringify(klRes.d).slice(0, 80));
    ok('admin ďalej vidí hociktorú skupinu', (await j('/api/vencek/mine?ako=student&class_id=' + TRIEDA2, {}, jar.adm)).status === 200);

    console.log('\n5) Registračná stránka a limity:');
    const reg = await (await fetch(BASE + '/v/VEN-QAVS')).text();
    ok('registrácia detí nenačítava reklamné skripty', !/<script[^>]+fa-track\.js/.test(reg) && !/fbevents|gtag\(/.test(reg));
    ok('kiosk sa neobnovuje každých 20 s', !/setInterval\(vykresli, 20000\)/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'vencek-kiosk.html'), 'utf8')));
    let stat = 200;
    for (let i = 0; i < 60 && stat === 200; i++) stat = (await fetch(BASE + '/api/vencek/info?code=VEN-QAVS')).status;
    ok('60 otvorení plagátu z jednej IP prejde (trieda + kiosk)', stat === 200, 'posledný stav ' + stat);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    srv.kill();
    await sleep(600);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nSÚKROMIE DETÍ: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-1500));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
