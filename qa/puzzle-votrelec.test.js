/**
 * „Nájdi votrelca“ — šiesty typ denného hlavolamu (Marek 20. 9. 2026).
 * Overuje, že klient nedostane správnu odpoveď, že sa boduje ako rytmus a kvíz,
 * že sa témy neopakujú a že banka tém je zdravá.
 *
 * Spustenie:  node qa/puzzle-votrelec.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4517;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-vt-'));

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

(async () => {
  // ── 1. banka tém (bez servera) ──
  console.log('BANKA TÉM');
  const V = require('../puzzle-votrelec');
  const BANKA = require('../puzzle-votrelec.json');
  const temy = BANKA.temy || [];
  ok('banka má aspoň 50 tém', temy.length >= 50, String(temy.length));
  ok('všetky témy sú použiteľné', V.TEMY.length === temy.length, V.TEMY.length + ' z ' + temy.length);
  const ids = temy.map(t => t.id);
  ok('id sú jedinečné', new Set(ids).size === ids.length);
  ok('id majú tvar tNNN', ids.every(x => /^t\d{3}$/.test(x)), ids.filter(x => !/^t\d{3}$/.test(x)).join(','));
  const maloClenov = temy.filter(t => (t.s || []).length < 3);
  ok('každá téma má aspoň 3 členov', !maloClenov.length, maloClenov.map(t => t.id).join(','));
  const bezVotrelca = temy.filter(t => !(t.v || []).length || (t.v || []).some(v => !v.s || !v.p));
  ok('každý votrelec má slovo aj vysvetlenie', !bezVotrelca.length, bezVotrelca.map(t => t.id).join(','));
  const kolizia = temy.filter(t => (t.v || []).some(v => (t.s || []).includes(v.s)));
  ok('votrelec nie je zároveň členom kategórie', !kolizia.length, kolizia.map(t => t.id).join(','));
  const duplicitneSlova = temy.filter(t => new Set(t.s).size !== t.s.length);
  ok('členovia sa v téme neopakujú', !duplicitneSlova.length, duplicitneSlova.map(t => t.id).join(','));
  ok('kategórie sú vyplnené', temy.every(t => t.k && t.k.length > 2));

  // stavba hry mimo servera
  const mul = a => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hra = V.build(mul(2026));
  ok('hra má 5 kôl', hra.kola.length === 5 && hra.pocet === 5);
  ok('každé kolo má 4 slová', hra.kola.every(k => k.slova.length === 4 && new Set(k.slova).size === 4));
  ok('odpoveď je index 0–3', hra._answers.every(a => Number.isInteger(a) && a >= 0 && a < 4), JSON.stringify(hra._answers));
  ok('votrelec sedí s odpoveďou', hra._answers.every((a, i) => hra.kola[i].slova[a] === hra._meta[i].votrelec));
  ok('rovnaký seed dá rovnakú hru', JSON.stringify(V.build(mul(2026))) === JSON.stringify(hra));
  ok('votrelec nie je stále na tom istom mieste', new Set(hra._answers).size > 1, JSON.stringify(hra._answers));
  ok('score spočíta trafené', V.score(hra, hra._answers).spravne === 5 && V.score(hra, hra._answers).perfect === true);
  const zleOdpovede = hra._answers.map(a => (a + 1) % 4);
  ok('score pri samých chybách je 0', V.score(hra, zleOdpovede).spravne === 0 && V.score(hra, zleOdpovede).perfect === false);
  ok('validate pustí správny formát', V.validate(hra, [0, 1, 2, 3, 0]) === null);
  ok('validate odmietne krátky zoznam', !!V.validate(hra, [0, 1]));
  ok('validate odmietne index mimo rozsahu', !!V.validate(hra, [0, 1, 2, 3, 9]));
  ok('validate odmietne nečíslo', !!V.validate(hra, [0, 1, 2, 3, 'a']));
  // nová hra nemá opakovať témy z predošlých dní
  const prve = V.vyberTemy(mul(1), new Map());
  const pouzite = new Map(prve.map(id => [id, '2026-09-21']));
  const druhe = V.vyberTemy(mul(2), pouzite);
  ok('druhý deň berie iné témy', !druhe.some(id => prve.includes(id)), prve + ' | ' + druhe);
  ok('výber dáva 5 rôznych tém', new Set(druhe).size === 5);

  // ── 1b. prechod na šesť hier (20. 9. 2026) ──
  // Šesťdňové poradie sa nesmie spätne vzťahovať na staršie dni — kto hru v ten
  // deň už hral, nesmie po obnovení dostať inú. Modul zostavíme so zástupným app/db.
  const noop = () => {};
  const PUZZLE = require('../puzzle')({
    app: { get: noop, post: noop, put: noop, delete: noop }, db: {},
    q: { find: async () => [], one: async () => null, insert: async () => {}, update: async () => {}, count: async () => 0, remove: async () => {} },
    auth: noop, adminAuth: noop, nowISO: () => '', today: () => '2026-09-20', fakty: async () => ({}), servisToken: () => false,
  });
  // prod má v nastaveniach vlastné výnimky — nesmú s prechodom nič spraviť
  const CFG = { schedule: ['rhythm', 'anagram', 'zip', 'quiz', 'words', 'votrelec'], overrides: { '2026-09-01': 'anagram' } };
  const den = d => PUZZLE.typeForSync(d, CFG);
  ok('17.–19. 9. ostávajú pri pôvodnom poradí',
    den('2026-09-17') === 'quiz' && den('2026-09-18') === 'words' && den('2026-09-19') === 'rhythm',
    [den('2026-09-17'), den('2026-09-18'), den('2026-09-19')].join(','));
  ok('20. 9. ostáva „Poskladaj slovo" aj po pridaní šiestej hry', den('2026-09-20') === 'anagram', den('2026-09-20'));
  ok('21. 9. je prvý „Nájdi votrelca"', den('2026-09-21') === 'votrelec', den('2026-09-21'));
  ok('od 21. 9. sa poradie opakuje po šiestich dňoch',
    den('2026-09-27') === 'votrelec' && den('2026-10-03') === 'votrelec' && den('2026-09-22') === 'rhythm',
    [den('2026-09-27'), den('2026-10-03'), den('2026-09-22')].join(','));
  ok('výnimka v nastaveniach stále funguje', den('2026-09-01') === 'anagram', den('2026-09-01'));

  // ── 2. cez server ──
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaVtHracka000001', name: 'Vika Testova', email: 'qa.vt@qa-biz.local', phone: '', password: hash,
      referral_code: 'QAVT01', sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: 'client',
      visit_count: 3, created_at: '2026-07-01', city: 'Detva', account_creation_type: 'self_registration' }),
    JSON.stringify({ _id: 'qaVtDruha0000001', name: 'Dana Testova', email: 'qa.vt2@qa-biz.local', phone: '', password: hash,
      referral_code: 'QAVT02', sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: 'client',
      visit_count: 3, created_at: '2026-07-01', city: 'Detva', account_creation_type: 'self_registration' }),
  ].join('\n') + '\n');
  // dnešok nastavíme na „Nájdi votrelca", nech test nezávisí od poradia dní
  fs.writeFileSync(path.join(DATA, 'settings.db'),
    JSON.stringify({ _id: 'qaVtCfg', key: 'puzzle_config', value: { overrides: { [DNES]: 'votrelec' } }, at: DNES }) + '\n');

  console.log('\nNÁJDI VOTRELCA QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol do 180 s'); process.exit(1); }

  try {
    const jar = {}, jar2 = {};
    ok('prihlásenie', (await j('/api/login', { method: 'POST', body: { email: 'qa.vt@qa-biz.local', password: 'Heslo123!' } }, jar)).status === 200);
    ok('prihlásenie druhej hráčky', (await j('/api/login', { method: 'POST', body: { email: 'qa.vt2@qa-biz.local', password: 'Heslo123!' } }, jar2)).status === 200);

    const t = await j('/api/puzzle/today', {}, jar);
    ok('dnešok je „Nájdi votrelca"', t.status === 200 && t.d.type === 'votrelec', JSON.stringify(t.d && t.d.type));
    ok('príde 5 kôl po 4 slová', t.d.pocet === 5 && (t.d.kola || []).length === 5
      && t.d.kola.every(k => Array.isArray(k.slova) && k.slova.length === 4), JSON.stringify(t.d.kola || []).slice(0, 120));
    const surovo = JSON.stringify(t.d);
    ok('klient nedostane správnu odpoveď', !/_answers|_meta|votrelec":|kategoria|preco/.test(surovo));
    ok('klient nedostane kategórie', !temy.some(x => surovo.includes('"' + x.k + '"')));
    ok('sadzby bodov prídu klientovi', t.d.votrelec_per_answer === 1 && t.d.votrelec_perfect_bonus === 5,
      t.d.votrelec_per_answer + '/' + t.d.votrelec_perfect_bonus);

    await j('/api/puzzle/start', { method: 'POST' }, jar);

    // správne odpovede vieme len zo servera — vyrátame si ich z banky podľa slov v kolách
    const spravne = t.d.kola.map(k => {
      const tema = temy.find(x => (x.v || []).some(v => k.slova.includes(v.s)) && k.slova.filter(s => (x.s || []).includes(s)).length === 3);
      const v = tema && tema.v.find(v => k.slova.includes(v.s));
      return v ? k.slova.indexOf(v.s) : -1;
    });
    ok('votrelca sa dá z banky jednoznačne určiť', spravne.every(x => x >= 0), JSON.stringify(spravne));

    ok('zlý formát odpovede = 400', (await j('/api/puzzle/solve', { method: 'POST', body: { answers: [0, 1], date: DNES } }, jar)).status === 400);
    ok('index mimo rozsahu = 400', (await j('/api/puzzle/solve', { method: 'POST', body: { answers: [0, 1, 2, 3, 7], date: DNES } }, jar)).status === 400);

    const r = await j('/api/puzzle/solve', { method: 'POST', body: { answers: spravne, seconds: 40, date: DNES } }, jar);
    ok('odovzdanie prejde', r.status === 200 && r.d.ok, JSON.stringify(r.d).slice(0, 160));
    ok('päť z piatich a 5 bodov', r.d.correct === 5 && r.d.total === 5 && r.d.perfect === true && r.d.points === 5, JSON.stringify(r.d).slice(0, 200));
    ok('bonus za bezchybné sa ohlási', r.d.perfect_bonus === 5, String(r.d.perfect_bonus));
    ok('reveal vysvetlí kategóriu aj dôvod', (r.d.reveal || []).length === 5
      && r.d.reveal.every(x => x.kategoria && x.preco && x.votrelec && x.trafene === true), JSON.stringify(r.d.reveal || []).slice(0, 200));

    ok('druhé odovzdanie už body nedá', (await j('/api/puzzle/solve', { method: 'POST', body: { answers: spravne, date: DNES } }, jar)).d.already === true);

    const po = await j('/api/puzzle/today', {}, jar);
    ok('po odovzdaní vidí riešenie', po.d.solved === true && (po.d.reveal || []).length === 5 && po.d.my_correct === 5);

    // druhá hráčka s chybami
    await j('/api/puzzle/start', { method: 'POST' }, jar2);
    const zle = spravne.map((a, i) => i < 2 ? (a + 1) % 4 : a);
    const r2 = await j('/api/puzzle/solve', { method: 'POST', body: { answers: zle, seconds: 30, date: DNES } }, jar2);
    ok('s dvoma chybami sú 3 body', r2.d.correct === 3 && r2.d.points === 3 && r2.d.perfect === false, JSON.stringify(r2.d).slice(0, 160));
    ok('reveal ukáže môj zlý tip', r2.d.reveal[0].trafene === false && r2.d.reveal[0].moj_tip
      && r2.d.reveal[0].moj_tip !== r2.d.reveal[0].votrelec, JSON.stringify(r2.d.reveal[0]));

    // rebríček a história berú novú hru ako bodovanú (radí podľa správnych, potom času)
    const lb = await j('/api/puzzle/leaderboard', {}, jar);
    ok('rebríček radí podľa správnych, nie len času', lb.d.rows[0] && lb.d.rows[0].correct === 5 && lb.d.scored === true,
      JSON.stringify(lb.d.rows));
    const hi = await j('/api/puzzle/history?days=5', {}, jar);
    const dnes = (hi.d.days || []).find(x => x.date === DNES);
    ok('história pozná typ hry', dnes && dnes.type === 'votrelec' && dnes.players === 2, JSON.stringify(dnes && { t: dnes.type, p: dnes.players }));
    ok('víťazkou dňa je bezchybná, nie najrýchlejšia', dnes && dnes.winner && dnes.winner.name === 'Vika Testova', JSON.stringify(dnes && dnes.winner));

    // bonus po polnoci
    const aw = await j('/api/admin/qa/puzzle-award/' + DNES, { method: 'POST' });
    ok('vyhodnotenie bonusu je len pre admina', aw.status === 401 || aw.status === 403, String(aw.status));

    // výber tém sa uložil, aby sa zajtra neopakovali
    const set = fs.readFileSync(path.join(DATA, 'settings.db'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const pick = set.filter(x => x.key === 'puzzle_pick_votrelec_' + DNES).pop();
    ok('výber tém dňa je uložený', pick && Array.isArray(pick.value.ids) && pick.value.ids.length === 5, JSON.stringify(pick && pick.value));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\n' + passed + ' ✅  ' + failed + ' ❌');
  process.exit(failed ? 1 : 0);
})();
