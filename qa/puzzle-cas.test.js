/**
 * Meranie času v dennom hlavolame (Marek 25. 10. 2026).
 * Do 25. 10. bežali hodiny od prvého otvorenia a nezastavili sa ani vtedy, keď
 * hráčka appku zavrela — Nelke Kyseľovej tak napočítalo hodinu (strop) za kvíz,
 * v ktorom mala 5/5. Odteraz sa počíta len čas s otvorenou hádankou: stránka
 * posiela pingy a server pripočíta len krátke medzery.
 *
 * Spustenie:  node qa/puzzle-cas.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4518;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-cas-'));
const MEDZERA = 1000;                       // v teste stačí sekunda, v prevádzke je 25 s
const POKUTA = 2;                           // sekundy za každý odchod z hádanky (v prevádzke 30 s)

let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };
const spi = ms => new Promise(r => setTimeout(r, ms));

async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}

(async () => {
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = (id, meno, mail, kod) => JSON.stringify({
    _id: id, name: meno, email: mail, phone: '', password: hash, referral_code: kod,
    sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: 'client',
    visit_count: 3, created_at: '2026-07-01', city: 'Detva', account_creation_type: 'self_registration',
  });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    U('qaCasPinguje001', 'Nela Pingujuca', 'qa.cas1@qa-biz.local', 'QACAS1'),
    U('qaCasStaraStr01', 'Stara Stranka', 'qa.cas2@qa-biz.local', 'QACAS2'),
  ].join('\n') + '\n');
  // „Nájdi votrelca" prijme akúkoľvek päticu indexov, takže sa dá odovzdať bez znalosti riešenia
  fs.writeFileSync(path.join(DATA, 'settings.db'),
    JSON.stringify({ _id: 'qaCasCfg', key: 'puzzle_config', value: { overrides: { [DNES]: 'votrelec' }, prestavka_pokuta: POKUTA }, at: DNES }) + '\n');

  console.log('MERANIE ČASU V HLAVOLAME QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1',
           PUZZLE_MAX_GAP_MS: String(MEDZERA) },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await spi(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol do 180 s'); process.exit(1); }

  try {
    const jar = {};
    ok('prihlásenie', (await j('/api/login', { method: 'POST', body: { email: 'qa.cas1@qa-biz.local', password: 'Heslo123!' } }, jar)).status === 200);
    ok('ping bez prihlásenia neprejde', (await j('/api/puzzle/ping', { method: 'POST' })).status === 401);

    const s1 = await j('/api/puzzle/start', { method: 'POST' }, jar);
    ok('štart začína na nule', s1.status === 200 && s1.d.elapsed === 0, JSON.stringify(s1.d));

    // hádanka otvorená ~1,2 s: tri pingy po 400 ms
    for (let i = 0; i < 3; i++) { await spi(400); await j('/api/puzzle/ping', { method: 'POST' }, jar); }
    const poHrani = (await j('/api/puzzle/ping', { method: 'POST' }, jar)).d.elapsed;
    ok('čas s otvorenou hádankou sa počíta', poHrani >= 1 && poHrani <= 3, String(poHrani));

    // appku zavrela / vyhodilo ju na úvod — pauza dlhšia ako povolená medzera.
    // Nepočíta sa celá (inak by mala hodinu), ale ani nie je zadarmo: za návrat
    // je pevná pokuta, nech sa neoplatí odísť si vygoogliť odpovede (Marek 25. 10.).
    await spi(MEDZERA + 900);
    const po = (await j('/api/puzzle/ping', { method: 'POST' }, jar)).d;
    ok('prestávka sa nepočíta celá', po.elapsed < poHrani + POKUTA + 2, poHrani + ' → ' + po.elapsed);
    ok('za odchod sa pripočíta pokuta', po.elapsed >= poHrani + POKUTA, poHrani + ' → ' + po.elapsed);
    ok('odchod je zarátaný ako prestávka', po.prestavky === 1, JSON.stringify(po.prestavky));
    const poPauze = po.elapsed;

    // obnovenie stránky po prestávke nesmie byť spôsob, ako sa pokute vyhnúť
    await spi(MEDZERA + 900);
    const poStarte = (await j('/api/puzzle/start', { method: 'POST' }, jar)).d;
    ok('druhý odchod stojí ďalšiu pokutu aj pri obnovení stránky',
      poStarte.prestavky === 2 && poStarte.elapsed >= poPauze + POKUTA, JSON.stringify(poStarte));
    ok('stránka vie, koľko pokuta je', poStarte.prestavka_pokuta === POKUTA, String(poStarte.prestavka_pokuta));

    // vrátila sa a ešte chvíľu hrá
    for (let i = 0; i < 2; i++) { await spi(400); await j('/api/puzzle/ping', { method: 'POST' }, jar); }
    const pred = (await j('/api/puzzle/ping', { method: 'POST' }, jar)).d.elapsed;
    ok('po návrate čas pokračuje, nezačína odznova', pred > poPauze, poPauze + ' → ' + pred);

    const r = await j('/api/puzzle/solve', { method: 'POST', body: { answers: [0, 0, 0, 0, 0], seconds: 9999, date: DNES } }, jar);
    ok('odovzdanie prejde', r.status === 200 && r.d.ok, JSON.stringify(r.d).slice(0, 140));
    ok('zapísaný čas je ten s otvorenou hádankou', r.d.seconds <= pred + 2 && r.d.seconds >= 1, 'seconds=' + r.d.seconds + ', merané=' + pred);
    ok('čas z prehliadača sa ignoruje', r.d.seconds < 100, String(r.d.seconds));

    const den = await j('/api/admin/puzzle/den?date=' + DNES, { headers: { 'x-import-token': 'nic' } });
    ok('prehľad dňa je chránený', den.status === 401 || den.status === 403, String(den.status));

    const zaznam = fs.readFileSync(path.join(DATA, 'puzzle_solves.db'), 'utf8').split('\n').filter(Boolean)
      .map(l => JSON.parse(l)).filter(x => x.user_id === 'qaCasPinguje001').pop();
    ok('čas meral server', zaznam.verified === true);
    ok('celkový čas od otvorenia ostal zapísaný na dohľadanie',
      zaznam.cas_otvorene >= zaznam.seconds, JSON.stringify({ s: zaznam.seconds, otvorene: zaznam.cas_otvorene }));

    // Stará stránka z cache pingy nepozná — tej meriame po starom, nech z chýbajúcich
    // pingov nevznikne nezaslúžená „1 s" a prvé miesto.
    const jar2 = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.cas2@qa-biz.local', password: 'Heslo123!' } }, jar2);
    await j('/api/puzzle/start', { method: 'POST' }, jar2);
    await spi(2200);
    const r2 = await j('/api/puzzle/solve', { method: 'POST', body: { answers: [1, 1, 1, 1, 1], seconds: 1, date: DNES } }, jar2);
    ok('bez pingov sa meria po starom (od otvorenia)', r2.d.seconds >= 2, String(r2.d.seconds));
    ok('ani tu sa neverí času z prehliadača', r2.d.seconds !== 1, String(r2.d.seconds));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\n' + passed + ' ✅  ' + failed + ' ❌');
  process.exit(failed ? 1 : 0);
})();
