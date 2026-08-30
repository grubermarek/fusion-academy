/**
 * Tretia hra: „Poznáš rytmus?" (Marek 30. 8. 2026).
 * Zaznie minútová ukážka skladby, hráčka háda, na ktorý tanec je. Päť kôl.
 *
 * Prvá verzia skladala rytmus syntetickými údermi — Marek ako lektor povedal,
 * že to nesedí, a mal pravdu. Teraz sa púšťajú skutočné nahrávky z Pixabay.
 *
 * Najdôležitejšie je, aby sa hra nedala obísť:
 *   · správne odpovede server nesmie poslať skôr, než ich hráčka odovzdá,
 *   · názov súboru nesmie prezradiť tanec (preto r01.mp3, nie salsa-1.mp3),
 *   · čas musí merať server.
 *
 * Spustenie:  node qa/puzzle-rhythm.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4516;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-rt-'));

let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };

async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const mul = a => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const seedFromString = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

(async () => {
  const R = require(path.join(__dirname, '..', 'puzzle-rhythm.js'));
  const KOREN = path.join(__dirname, '..');
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaRtAdmin0000001', name: 'Adam Rytmicky', email: 'qa.rt.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-06-01' }),
    JSON.stringify({ _id: 'qaRtHracka000001', name: 'Klara Rytmicka', email: 'qa.rt@qa-biz.local',
      password: hash, referral_code: 'QART01', user_type: 'client', active: true, is_admin: false,
      visit_count: 3, created_at: '2026-07-01', city: 'Detva', account_creation_type: 'self_registration' }),
  ].join('\n') + '\n');

  console.log('RYTMUS QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol do 180 s'); process.exit(1); }

  try {
    // ── hudobné podklady ──
    const kat = R.KATALOG;
    ok('katalóg skladieb existuje', Array.isArray(kat) && kat.length >= 8, String(kat && kat.length));
    ok('každý tanec má aspoň dve skladby',
      ['salsa', 'bachata', 'merengue', 'chacha'].every(t => kat.filter(x => x.tanec === t).length >= 2),
      JSON.stringify(kat.reduce((a, x) => { a[x.tanec] = (a[x.tanec] || 0) + 1; return a; }, {})));
    ok('všetky súbory naozaj existujú na disku',
      kat.every(s => fs.existsSync(path.join(KOREN, 'public', s.subor.replace(/^\//, '')))),
      kat.map(s => s.subor).filter(p => !fs.existsSync(path.join(KOREN, 'public', p.replace(/^\//, '')))).join(','));
    ok('názov súboru NEprezrádza tanec (inak by stačil Network panel)',
      kat.every(s => !/salsa|bachata|merengue|chacha|cha-cha/i.test(s.subor)),
      kat.map(s => s.subor).filter(p => /salsa|bachata|merengue|chacha/i.test(p)).join(','));
    ok('katalóg s mapovaním nie je v public/',
      !fs.existsSync(path.join(KOREN, 'public', 'audio', 'rytmus', 'katalog.json')));
    ok('každá skladba má autora aj odkaz na zdroj',
      kat.every(s => s.nazov && s.autor && /^https?:\/\//.test(s.odkaz || '')), JSON.stringify(kat[0]));

    // ── zostavenie hádanky ──
    const p = R.build(mul(2026));
    ok('hádanka má 5 kôl', p.rounds.length === 5, String(p.rounds.length));
    ok('každé kolo má cestu k ukážke', p.rounds.every(r => /^\/audio\/rytmus\/r\d+\.mp3$/.test(r.src)), JSON.stringify(p.rounds));
    ok('ponúka 4 tance', p.options.length === 4, JSON.stringify(p.options.map(o => o.name)));
    ok('rovnaký seed dá rovnakú hádanku', JSON.stringify(R.build(mul(2026))._ids) === JSON.stringify(p._ids));
    ok('iný seed dá inú hádanku', JSON.stringify(R.build(mul(9999))._ids) !== JSON.stringify(p._ids));

    // to, čo hru najľahšie pokazí: nuda a opakovanie
    let malotancov = 0, opakovana = 0;
    for (let s2 = 1; s2 <= 300; s2++) {
      const x = R.build(mul(s2));
      if (new Set(x._answers).size < 4) malotancov++;
      if (new Set(x._ids).size !== x._ids.length) opakovana++;
    }
    ok('cez 300 dní vždy aspoň 4 rôzne tance', malotancov === 0, String(malotancov));
    ok('cez 300 dní sa nikdy neopakuje tá istá skladba', opakovana === 0, String(opakovana));

    // ── validácia ──
    ok('správne riešenie prejde', R.validate(p, p._answers) === null);
    ok('jedna zlá odpoveď neprejde', typeof R.validate(p, p._answers.map((a, i) => i ? a : (a === 'salsa' ? 'bachata' : 'salsa'))) === 'string');
    ok('málo odpovedí neprejde', typeof R.validate(p, ['salsa']) === 'string');
    ok('vymyslený tanec neprejde', R.validate(p, p._answers.map(() => 'polka')) === 'Neplatná odpoveď.');
    ok('nie-pole neprejde', typeof R.validate(p, 'salsa') === 'string');

    // ── cez API ──
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.rt.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
    const fix = await j('/api/admin/puzzle', { method: 'PUT', body: { overrides: { [DNES]: 'rhythm' } } }, adm);
    ok('admin vie nasadiť rytmus na konkrétny deň',
      fix.d && fix.d.config && fix.d.config.overrides[DNES] === 'rhythm', JSON.stringify(fix.d && fix.d.config && fix.d.config.overrides));

    const jar = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.rt@qa-biz.local', password: 'Heslo123!' } }, jar);
    const t = await j('/api/puzzle/today', {}, jar);
    const T = t.d;
    ok('hádanka dňa je rytmus', T && T.ok && T.type === 'rhythm', JSON.stringify(t.d).slice(0, 120));
    ok('klient dostane 5 ukážok', Array.isArray(T.rounds) && T.rounds.length === 5, String(T.rounds && T.rounds.length));
    ok('klient dostane možnosti', Array.isArray(T.options) && T.options.length === 4);
    ok('SPRÁVNE ODPOVEDE sa klientovi NEposielajú', !JSON.stringify(T).includes('_answers'));
    ok('ani id skladieb sa neposielajú', !JSON.stringify(T).includes('_ids'));
    ok('v odpovedi nefiguruje názov tanca pri ukážke',
      !/salsa|bachata|merengue|chacha/i.test(JSON.stringify(T.rounds)), JSON.stringify(T.rounds));
    ok('reveal sa pred vyriešením neposiela', !T.reveal);

    // ukážka sa dá naozaj stiahnuť zo servera
    const zvuk = await fetch(BASE + T.rounds[0].src);
    ok('ukážku server naozaj servíruje', zvuk.status === 200 && /audio/.test(zvuk.headers.get('content-type') || ''),
      zvuk.status + ' ' + zvuk.headers.get('content-type'));

    await j('/api/puzzle/start', { method: 'POST' }, jar);
    const zle = await j('/api/puzzle/solve', { method: 'POST', body: { answers: ['polka', 'polka', 'polka', 'polka', 'polka'], date: DNES } }, jar);
    ok('vymyslená odpoveď je odmietnutá', zle.status >= 400, JSON.stringify(zle.d));
    ok('po zlom tipe je hádanka stále neriešená', (await j('/api/puzzle/today', {}, jar)).d.solved === false);

    const spravne = R.build(mul(seedFromString('fusion-rhythm-' + DNES)))._answers;
    const dobre = await j('/api/puzzle/solve', { method: 'POST', body: { answers: spravne, date: DNES } }, jar);
    ok('správne riešenie prejde cez API', dobre.status === 200 && dobre.d && dobre.d.ok, JSON.stringify(dobre.d));
    ok('pripísali sa body', dobre.d && dobre.d.points > 0, String(dobre.d && dobre.d.points));
    ok('čas meral server', dobre.d && typeof dobre.d.seconds === 'number' && dobre.d.seconds >= 0, String(dobre.d && dobre.d.seconds));

    const po = await j('/api/puzzle/today', {}, jar);
    ok('po vyriešení je označená ako vyriešená', po.d.solved === true);
    ok('až teraz sa ukáže, čo bolo čo', Array.isArray(po.d.reveal) && po.d.reveal.length === 5);
    ok('reveal má názov tanca, tip aj skladbu s autorom',
      po.d.reveal.every(x => x.name && x.tip && x.skladba && x.autor), JSON.stringify(po.d.reveal && po.d.reveal[0]));

    const znova = await j('/api/puzzle/solve', { method: 'POST', body: { answers: spravne, date: DNES } }, jar);
    ok('druhé odovzdanie v ten istý deň neprejde', znova.status >= 400 || (znova.d && znova.d.already), JSON.stringify(znova.d));

    // ── stránka ──
    const html = fs.readFileSync(path.join(KOREN, 'public', 'hlavolam.html'), 'utf8');
    ok('stránka vie vykresliť rytmus', html.includes("P.type==='rhythm'") && html.includes('renderRytmus'));
    ok('prehráva súbor, nie syntetický tón', html.includes('new Audio(r.src)') && !html.includes('createOscillator'));
    ok('naraz hrá len jedna ukážka', html.includes('hraIndex'));
    ok('ukážky sa načítavajú až na klik', html.includes("preload='none'"));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    console.log('\nRYTMUS: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
