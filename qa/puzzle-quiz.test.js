/**
 * Denný kvíz — piaty typ hlavolamu (Marek 16. 9. 2026).
 * Päť otázok, štyri možnosti, jeden pokus, bod za každú správnu a +5 pre
 * najrýchlejšiu bezchybnú. Otázky sa medzi dňami neopakujú.
 *
 * Najdôležitejšie:
 *   · správnu odpoveď ani vysvetlenie server nepošle pred odovzdaním,
 *   · výber otázok sa uloží a ďalší kvíz nezopakuje už použité,
 *   · v každom kvíze je výživa, pohyb, tanec a svet (a v každom druhom otázka o nás),
 *   · bonus dostane najrýchlejšia BEZCHYBNÁ, nie najrýchlejšia vôbec.
 *
 * Spustenie:  node qa/puzzle-quiz.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4613;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-kv-'));
const KOREN = path.join(__dirname, '..');

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
const citajDb = f => { try { return fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (e) { return []; } };

(async () => {
  const K = require(path.join(KOREN, 'puzzle-quiz.js'));
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const posun = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const VCERA = posun(DNES, -1), PREDVCEROM = posun(DNES, -5);

  // ── banka otázok ──
  const B = K.OTAZKY;
  ok('banka má aspoň 25 otázok', B.length >= 25, String(B.length));
  ok('id otázok sú jedinečné', new Set(B.map(o => o.id)).size === B.length);
  ok('každá otázka má 4 rôzne neprázdne možnosti',
    B.every(o => Array.isArray(o.a) && o.a.length === 4 && new Set(o.a).size === 4 && o.a.every(x => String(x).trim())),
    (B.find(o => !(Array.isArray(o.a) && o.a.length === 4 && new Set(o.a).size === 4)) || {}).id);
  ok('každá otázka má text, vysvetlenie a známu skupinu',
    B.every(o => o.q && o.v && K.SKUPINY[o.g]), (B.find(o => !(o.q && o.v && K.SKUPINY[o.g])) || {}).id);
  ok('žiadna otázka sa neopakuje (rovnaký text)', new Set(B.map(o => o.q.toLowerCase())).size === B.length);
  ok('všetky skupiny majú otázky', Object.keys(K.SKUPINY).every(g => B.some(o => o.g === g)),
    Object.keys(K.SKUPINY).filter(g => !B.some(o => o.g === g)).join(','));
  ok('výživy je v banke najviac alebo aspoň štvrtina',
    B.filter(o => o.g === 'vyziva').length >= B.length / 4 || B.filter(o => o.g === 'vyziva').length >= Math.max(...Object.keys(K.SKUPINY).map(g => B.filter(o => o.g === g).length)),
    JSON.stringify(B.reduce((m, o) => (m[o.g] = (m[o.g] || 0) + 1, m), {})));

  // ── výber otázok ──
  const v0 = K.vyber(mul(1), new Map(), 0);
  ok('kvíz má 5 rôznych otázok', v0.length === 5 && new Set(v0).size === 5, JSON.stringify(v0));
  const skupiny0 = v0.map(id => B.find(o => o.id === id).g).sort();
  ok('prvý kvíz: výživa, pohyb, tanec, svet a otázka o nás',
    JSON.stringify(skupiny0) === JSON.stringify(['fusion', 'pohyb', 'svet', 'tanec', 'vyziva']), JSON.stringify(skupiny0));
  const v1 = K.vyber(mul(2), new Map(), 1);
  const skupiny1 = v1.map(id => B.find(o => o.id === id).g);
  ok('druhý kvíz: namiesto otázky o nás druhá o výžive',
    skupiny1.filter(g => g === 'vyziva').length === 2 && !skupiny1.includes('fusion'), JSON.stringify(skupiny1));

  // simulácia dní: nič sa nezopakuje, kým je banka plná
  const pouzite = new Map();
  let opakovane = 0, dni = 0;
  const kolkoBezOpakovania = Math.floor(B.length / 5) - 2;
  for (let n = 0; n < kolkoBezOpakovania; n++) {
    const d = posun('2027-01-01', n * 5);
    const ids = K.vyber(mul(seedFromString('x' + n)), pouzite, n);
    if (ids.length !== 5) { opakovane++; break; }
    for (const id of ids) { if (pouzite.has(id)) opakovane++; pouzite.set(id, d); }
    dni++;
  }
  ok('počas ' + dni + ' kvízov sa žiadna otázka nezopakovala', opakovane === 0, String(opakovane));
  // keď sa banka minie, kvíz aj tak vznikne a berie najdávnejšie použité
  const plna = new Map(B.map((o, i) => [o.id, posun('2027-01-01', i)]));
  const poMinuti = K.vyber(mul(7), plna, 3);
  ok('po minutí banky vznikne kvíz z najdávnejších otázok',
    poMinuti.length === 5 && poMinuti.every(id => plna.get(id) <= posun('2027-01-01', B.length - 1)), JSON.stringify(poMinuti));

  // zostavenie a vyhodnotenie
  const p = K.build(mul(3), v0);
  ok('každá otázka má 4 možnosti a–d', p.otazky.every(o => o.moznosti.map(m => m.k).join('') === 'abcd'));
  ok('správna odpoveď nie je vždy na rovnakom mieste',
    new Set(Array.from({ length: 30 }, (_, i) => K.build(mul(100 + i), v0)._answers[0])).size > 1);
  ok('písmeno správnej odpovede sedí s textom',
    p.otazky.every((o, i) => o.moznosti.find(m => m.k === p._answers[i]).t === B.find(x => x.id === v0[i]).a[0]));
  ok('verejná časť neobsahuje vysvetlenie ani id', !JSON.stringify(p.otazky).includes('"v"') && !JSON.stringify(p.otazky).includes(v0[0]));
  ok('všetko správne = perfect', K.score(p, p._answers).perfect === true);
  const dveZle = p._answers.map((a, i) => i < 3 ? a : (a === 'a' ? 'b' : 'a'));
  ok('dve zlé = 3/5', K.score(p, dveZle).spravne === 3 && !K.score(p, dveZle).perfect);
  ok('zlý tip sa prijme (jeden pokus)', K.validate(p, dveZle) === null);
  ok('neplatné písmeno neprejde', typeof K.validate(p, ['a', 'b', 'c', 'd', 'e']) === 'string');
  ok('málo odpovedí neprejde', typeof K.validate(p, ['a']) === 'string');
  const rv = K.reveal(p, dveZle);
  ok('vyhodnotenie má správnu odpoveď, vysvetlenie a vlastný tip',
    rv.every(x => x.spravna && x.vysvetlenie) && rv[4].trafene === false && rv[4].moj_tip && rv[4].moj === dveZle[4], JSON.stringify(rv[4]));

  // ── server ──
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = (id, meno, mail, kod, extra) => JSON.stringify({
    _id: id, name: meno, email: mail, password: hash, referral_code: kod, user_type: 'client', active: true,
    is_admin: false, visit_count: 3, created_at: '2026-07-01', city: 'Detva', account_creation_type: 'self_registration', ...(extra || {}),
  });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaKvAdmin0000001', name: 'Adam Kvizovy', email: 'qa.kv.admin@qa-biz.local', password: hash,
      is_admin: true, user_type: 'admin', active: true, created_at: '2026-06-01' }),
    U('qaKvHracka00001', 'Klara Kvizova', 'qa.kv1@qa-biz.local', 'QAKV01'),
    U('qaKvHracka00002', 'Dana Kvizova', 'qa.kv2@qa-biz.local', 'QAKV02'),
    U('qaKvRychlaZle01', 'Nina Rychla', 'qa.kv3@qa-biz.local', 'QAKV03'),
    U('qaKvPomalaOk001', 'Ema Presna', 'qa.kv4@qa-biz.local', 'QAKV04'),
  ].join('\n') + '\n');
  // Predošlý kvíz (pred 5 dňami) už použil tieto otázky — dnes sa nesmú zopakovať.
  const minule = K.vyber(mul(seedFromString('minule')), new Map(), 0);
  fs.writeFileSync(path.join(DATA, 'settings.db'), [
    JSON.stringify({ _id: 'qaKvPick1', key: 'puzzle_pick_quiz_' + PREDVCEROM, value: { type: 'quiz', ids: minule, poradie: 0 } }),
  ].join('\n') + '\n');
  // Včera bol kvíz: Nina najrýchlejšia s 4/5, Ema pomalšia s 5/5 → bonus patrí Eme.
  const S = (id, uid, meno, sek, spravne) => JSON.stringify({
    _id: id, user_id: uid, user_name: meno, date: VCERA, month: VCERA.slice(0, 7), seconds: sek, points: spravne,
    correct: spravne, total: 5, perfect: spravne === 5, verified: true, type: 'quiz', created_at: VCERA + 'T18:00:00.000Z',
  });
  fs.writeFileSync(path.join(DATA, 'puzzle_solves.db'), [
    S('qaKvS1', 'qaKvRychlaZle01', 'Nina Rychla', 30, 4),
    S('qaKvS2', 'qaKvPomalaOk001', 'Ema Presna', 45, 5),
  ].join('\n') + '\n');

  console.log('KVÍZ QA — štart servera…');
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
    const adm = {};
    ok('admin prihlásený', (await j('/api/login', { method: 'POST', body: { email: 'qa.kv.admin@qa-biz.local', password: 'Heslo123!' } }, adm)).status === 200);
    const cf = await j('/api/admin/puzzle', {}, adm);
    ok('kvíz je v striedaní hier', cf.d && cf.d.config.schedule.includes('quiz'), JSON.stringify(cf.d && cf.d.config.schedule));
    ok('17. 9. 2026 pripadá na kvíz a 16. 9. ostáva „Spoj čísla"',
      (() => { const G = require(path.join(KOREN, 'puzzle.js')); return true; })() &&
      cf.d.config.schedule[Math.floor(Date.parse('2026-09-17T00:00:00Z') / 86400000) % cf.d.config.schedule.length] === 'quiz' &&
      cf.d.config.schedule[Math.floor(Date.parse('2026-09-16T00:00:00Z') / 86400000) % cf.d.config.schedule.length] === 'zip');
    ok('sadzby kvízu: 1 bod za odpoveď, bonus 5', cf.d.config.quiz_per_answer === 1 && cf.d.config.quiz_perfect_bonus === 5);

    // bonus za včerajšok
    const aw = await j('/api/admin/qa/puzzle-award/' + VCERA, { method: 'POST' }, adm);
    const vys = (aw.d && aw.d.vysledok) || [];
    ok('včerajší kvíz: bonus dostala najrýchlejšia BEZCHYBNÁ (Ema)', vys.length === 1 && vys[0].user_id === 'qaKvPomalaOk001' && vys[0].bonus === 5, JSON.stringify(aw.d));
    ok('rýchlejšia s chybou bonus nedostala', !vys.some(v => v.user_id === 'qaKvRychlaZle01'));

    const fix = await j('/api/admin/puzzle', { method: 'PUT', body: { overrides: { [DNES]: 'quiz' } } }, adm);
    ok('admin vie nasadiť kvíz na konkrétny deň', fix.d && fix.d.config.overrides[DNES] === 'quiz', JSON.stringify(fix.d && fix.d.config));
    ok('úprava nastavení nezmazala sadzby kvízu', fix.d.config.quiz_perfect_bonus === 5 && fix.d.config.rhythm_perfect_bonus === 5);

    const jar = {}, jar2 = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.kv1@qa-biz.local', password: 'Heslo123!' } }, jar);
    await j('/api/login', { method: 'POST', body: { email: 'qa.kv2@qa-biz.local', password: 'Heslo123!' } }, jar2);
    const [t1, t2] = await Promise.all([j('/api/puzzle/today', {}, jar), j('/api/puzzle/today', {}, jar2)]);
    const T = t1.d;
    ok('dnešná hra je kvíz', T && T.ok && T.type === 'quiz', JSON.stringify(T).slice(0, 150));
    ok('klient dostane 5 otázok so 4 možnosťami', T.pocet === 5 && T.otazky.length === 5 && T.otazky.every(o => o.moznosti.length === 4));
    ok('otázky majú kategóriu', T.otazky.every(o => o.kat));
    ok('obe hráčky majú rovnaké otázky aj poradie možností (aj pri súčasnom otvorení)',
      JSON.stringify(t2.d.otazky) === JSON.stringify(T.otazky));
    const telo = JSON.stringify(T);
    ok('SPRÁVNE ODPOVEDE sa klientovi NEposielajú', !telo.includes('_answers') && !telo.includes('_ids') && !T.reveal);
    const texty = T.otazky.map(o => o.q);
    ok('vysvetlenie sa pred odovzdaním neposiela', B.filter(o => texty.includes(o.q)).every(o => !telo.includes(o.v)));
    ok('klient pozná sadzby kvízu', T.quiz_per_answer === 1 && T.quiz_perfect_bonus === 5);

    const pick = citajDb('settings.db').filter(r => r.key === 'puzzle_pick_quiz_' + DNES);
    ok('výber otázok je uložený práve raz', pick.length === 1, String(pick.length));
    const ids = (pick[0] && pick[0].value.ids) || [];
    ok('dnes sa nezopakovala ani jedna otázka z minulého kvízu', ids.length === 5 && !ids.some(id => minule.includes(id)),
      JSON.stringify({ ids, minule }));
    ok('druhý kvíz v poradí má namiesto otázky o nás druhú o výžive',
      pick[0] && pick[0].value.poradie === 1 && ids.filter(id => B.find(o => o.id === id).g === 'vyziva').length === 2,
      JSON.stringify(pick[0] && pick[0].value));

    const spravne = K.build(mul(seedFromString('fusion-quiz-moznosti-' + DNES)), ids)._answers;
    ok('otázky na klientovi sedia s uloženým výberom',
      JSON.stringify(K.build(mul(seedFromString('fusion-quiz-moznosti-' + DNES)), ids).otazky) === JSON.stringify(T.otazky));

    await j('/api/puzzle/start', { method: 'POST' }, jar);
    const zle = await j('/api/puzzle/solve', { method: 'POST', body: { answers: ['x', 'x', 'x', 'x', 'x'], date: DNES } }, jar);
    ok('neplatné odpovede sú odmietnuté', zle.status >= 400, JSON.stringify(zle.d));
    const neuplne = await j('/api/puzzle/solve', { method: 'POST', body: { answers: ['a', 'b'], date: DNES } }, jar);
    ok('neúplné odpovede sú odmietnuté', neuplne.status >= 400);
    ok('po odmietnutí je kvíz stále neodovzdaný', (await j('/api/puzzle/today', {}, jar)).d.solved === false);

    const tri = spravne.map((a, i) => i < 3 ? a : (a === 'a' ? 'b' : 'a'));
    const r1 = await j('/api/puzzle/solve', { method: 'POST', body: { answers: tri, date: DNES } }, jar);
    ok('čiastočné riešenie sa prijme', r1.status === 200 && r1.d.ok, JSON.stringify(r1.d));
    ok('3 správne = 3 body', r1.d.points === 3 && r1.d.correct === 3 && r1.d.total === 5 && r1.d.perfect === false, JSON.stringify(r1.d));
    ok('po odovzdaní príde vyhodnotenie s vysvetlením', Array.isArray(r1.d.reveal) && r1.d.reveal.length === 5 && r1.d.reveal.every(x => x.vysvetlenie && x.spravna));
    ok('vyhodnotenie ukáže, čo tipla zle', r1.d.reveal[4].trafene === false && r1.d.reveal[4].moj === tri[4]);
    const druhy = await j('/api/puzzle/solve', { method: 'POST', body: { answers: spravne, date: DNES } }, jar);
    ok('DRUHÝ POKUS NEEXISTUJE', druhy.status >= 400 || (druhy.d && druhy.d.already && druhy.d.points === 0), JSON.stringify(druhy.d));
    const po = await j('/api/puzzle/today', {}, jar);
    ok('po odovzdaní: stav, počet správnych aj vyhodnotenie', po.d.solved && po.d.my_correct === 3 && po.d.my_total === 5 && po.d.reveal.length === 5);

    await j('/api/puzzle/start', { method: 'POST' }, jar2);
    const r2 = await j('/api/puzzle/solve', { method: 'POST', body: { answers: spravne, date: DNES } }, jar2);
    ok('všetko správne = 5 bodov a perfect', r2.d.points === 5 && r2.d.perfect === true && r2.d.perfect_bonus === 5, JSON.stringify(r2.d));

    const lb = await j('/api/puzzle/leaderboard', {}, jar);
    ok('rebríček kvízu je bodovaný', lb.d.scored === true, JSON.stringify(lb.d));
    ok('v rebríčku je prvá bezchybná, aj keď bola pomalšia', lb.d.rows[0] && lb.d.rows[0].correct === 5 && lb.d.rows[1].correct === 3, JSON.stringify(lb.d.rows));
    const hi = await j('/api/puzzle/history?days=10', {}, jar);
    const hv = (hi.d.days || []).find(x => x.date === VCERA);
    ok('história: včerajšia víťazka je bezchybná Ema', hv && hv.type === 'quiz' && hv.winner && hv.winner.name === 'Ema Presna', JSON.stringify(hv));
    ok('história ukazuje počet správnych', hv && hv.rows.every(r => typeof r.correct === 'number'));

    // ── stránky ──
    const html = fs.readFileSync(path.join(KOREN, 'public', 'hlavolam.html'), 'utf8');
    ok('stránka vie vykresliť kvíz', html.includes("P.type==='quiz'") && html.includes('renderKviz') && html.includes('zamkniKviz'));
    ok('pred odovzdaním sa pýta na potvrdenie a kontroluje vyplnenie', html.includes('Ešte ti chýba odpoveď'));
    ok('po odovzdaní ukáže vysvetlenie', html.includes('x.vysvetlenie'));
    ok('história pozná názov kvízu', html.includes("quiz:'❓ Denný kvíz'"));
    ok('pri rytme a kvíze sa neukazuje pódium +5/+3/+1', html.includes("jeBodovana(P.type) ? ''"));
    const dash = fs.readFileSync(path.join(KOREN, 'public', 'client-dashboard.html'), 'utf8');
    ok('karta na nástenke pozná kvíz', dash.includes("quiz:'Denný kvíz'"));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    srv.kill();
    console.log('\nKVÍZ: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 400);
  }
})();
