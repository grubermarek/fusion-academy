/**
 * Poskladaj slovo — štvrtý typ denného hlavolamu (Marek 31. 8.).
 * Päť rozhádzaných výrazov, kto ich má prvý, berie pódiový bonus 5 / 3 / 1.
 *
 * Test stráži hlavne to, čím sa dá hra pokaziť:
 *   · riešenie sa NESMIE dostať klientovi v odpovedi servera
 *   · rozhádzané písmená nesmú náhodou tvoriť to isté slovo
 *   · dve slová rovnakej dĺžky nesmú byť navzájom anagramy (dve správne odpovede)
 *   · čiastočné riešenie sa neuznáva, opakované odovzdanie nepridáva body
 *   · pódium dostanú prví traja podľa času
 *
 * Spustenie:  node qa/puzzle-anagram.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4541;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-ana-'));
const AG = require(path.join(__dirname, '..', 'puzzle-anagram.js'));

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

// rovnaký seedovaný generátor ako v puzzle.js — nech test vie predpovedať hru
function seedFromString(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hraPre = d => AG.build(mulberry32(seedFromString('fusion-anagram-' + d)));

const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());

(async () => {
  console.log('POSKLADAJ SLOVO QA\n');

  // ── 1. samotná hra, bez servera ───────────────────────────────────────────
  console.log('Zadanie hry:');
  const h = hraPre(DNES);
  ok('má päť slov', h.slova.length === 5 && h._answers.length === 5, 'slov=' + h.slova.length);
  ok('idú od najkratšieho po najdlhšie',
    h._answers.every((s, i) => i === 0 || s.length > h._answers[i - 1].length), h._answers.join(' '));
  ok('písmená sedia s riešením',
    h.slova.every((s, i) => s.pismena.slice().sort().join('') === h._answers[i].split('').sort().join('')));
  ok('žiadne slovo nie je poskladané rovno správne',
    h.slova.every((s, i) => s.pismena.join('') !== h._answers[i]),
    h.slova.map((s, i) => s.pismena.join('') + '/' + h._answers[i]).join(' '));

  // cez rok dopredu: nikdy nesmie vyjsť čitateľné zadanie ani duplicita v hre
  let zleDni = 0, duplDni = 0;
  for (let k = 0; k < 400; k++) {
    const d = new Date(Date.parse(DNES + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10);
    const g = hraPre(d);
    if (g.slova.some((s, i) => s.pismena.join('') === g._answers[i])) zleDni++;
    if (new Set(g._answers).size !== g._answers.length) duplDni++;
  }
  ok('ani raz za 400 dní nie je hotové slovo v zadaní', zleDni === 0, zleDni + ' dní');
  ok('a v jednej hre sa slovo neopakuje', duplDni === 0, duplDni + ' dní');

  // nejednoznačnosť: v rámci dĺžky nesmú byť dve slová z rovnakých písmen
  const kluc = s => s.split('').sort().join('');
  let kolizie = [];
  for (const d of AG.DLZKY) {
    const m = {};
    for (const s of AG.SLOVA[d]) { const k = kluc(s); if (m[k]) kolizie.push(m[k] + '↔' + s); m[k] = s; }
  }
  ok('žiadne dve slová nemajú dve správne odpovede', kolizie.length === 0, kolizie.join(', '));
  ok('slovník je dosť veľký na striedanie',
    AG.DLZKY.every(d => AG.SLOVA[d].length >= 4), AG.DLZKY.map(d => d + ':' + AG.SLOVA[d].length).join(' '));

  console.log('\nOverovanie odpovedí:');
  ok('správne riešenie prejde', AG.validate(h, h._answers) === null, String(AG.validate(h, h._answers)));
  ok('malé písmená a medzery sa odpustia',
    AG.validate(h, h._answers.map(s => ' ' + s.toLowerCase() + ' ')) === null);
  ok('diakritika sa odpustí', AG.norm('rozcvička') === 'ROZCVICKA');
  const skoro = h._answers.slice(); skoro[4] = 'NIECOINE';
  ok('štyri z piatich neprejdú', typeof AG.validate(h, skoro) === 'string', String(AG.validate(h, skoro)));
  ok('krátky zoznam neprejde', typeof AG.validate(h, h._answers.slice(0, 3)) === 'string');
  ok('nezmysly neprejdú', typeof AG.validate(h, [1, 2, 3, 4, 5]) === 'string');
  const s5 = AG.score(h, h._answers); const s3 = AG.score(h, [h._answers[0], 'X', h._answers[2], 'Y', 'Z']);
  ok('skóre ráta správne', s5.spravne === 5 && s5.perfect === true && s3.spravne === 2, s3.spravne + '/5');

  // ── 2. cez server ─────────────────────────────────────────────────────────
  const hash = bcrypt.hashSync('Heslo123!', 10);
  let poc = 0;
  const U = (id, meno) => JSON.stringify({ _id: id, name: meno, email: id.toLowerCase() + '@qa-biz.local',
    password: hash, user_type: 'client', active: true, rank: 1, referral_code: 'QAAG' + String(++poc).padStart(2, '0'),
    visit_count: 3, created_at: '2026-06-01', city: 'Detva' });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaAgAdmin000001', name: 'Adam Admin', email: 'qa.ag.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-06-01' }),
    U('qaAgPrva000001', 'Prva Rychla'), U('qaAgDruha00001', 'Druha Rychla'),
    U('qaAgTretia0001', 'Tretia Rychla'), U('qaAgStvrta0001', 'Stvrta Pomala'),
  ].join('\n') + '\n');
  // dnešok musí byť typ anagram, nech test nezávisí od toho, čo padne v rotácii
  fs.writeFileSync(path.join(DATA, 'settings.db'), JSON.stringify({
    _id: 'qaAgCfg00000001', key: 'puzzle_config',
    value: { overrides: { [DNES]: 'anagram' }, day_win_min_players: 2 },
  }) + '\n');

  console.log('\nServer:');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' },
    stdio: ['ignore','ignore','pipe'],
  });
  let chyba=''; srv.stderr.on('data',d=>{chyba+=d});
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0,1500)); process.exit(1); }

  try {
    const jar1 = {};
    await j('/api/login', { method: 'POST', body: { email: 'qaagprva000001@qa-biz.local', password: 'Heslo123!' } }, jar1);
    const dnes = (await j('/api/puzzle/today', {}, jar1)).d;
    ok('hádanka je typu anagram', dnes && dnes.type === 'anagram', JSON.stringify(dnes && (dnes.type || dnes.error)));
    ok('klient dostane rozhádzané písmená', Array.isArray(dnes.slova) && dnes.slova.length === 5);
    const cely = JSON.stringify(dnes);
    ok('RIEŠENIE SA NEPOSIELA', !/_answers/.test(cely) && !h._answers.some(s => cely.includes('"' + s + '"')),
      h._answers.filter(s => cely.includes('"' + s + '"')).join(','));
    ok('pódiový bonus je 5 / 3 / 1', JSON.stringify(dnes.podium_bonus) === '[5,3,1]', JSON.stringify(dnes.podium_bonus));

    await j('/api/puzzle/start', { method: 'POST' }, jar1);
    const zle = await j('/api/puzzle/solve', { method: 'POST', body: { answers: h._answers.map((s, i) => i ? s : 'ZLE'), date: DNES } }, jar1);
    ok('nesprávne slovo server odmietne', zle.status === 400, JSON.stringify(zle.d));
    const dobre = await j('/api/puzzle/solve', { method: 'POST', body: { answers: h._answers, date: DNES } }, jar1);
    ok('správne riešenie prejde', dobre.status === 200 && dobre.d.ok, JSON.stringify(dobre.d));
    ok('a dá body', dobre.d.points > 0, 'points=' + dobre.d.points);
    const znova = await j('/api/puzzle/solve', { method: 'POST', body: { answers: h._answers, date: DNES } }, jar1);
    ok('druhé odovzdanie už body nepridá', znova.d && znova.d.already === true && znova.d.points === 0, JSON.stringify(znova.d));

    // ďalšie hráčky, nech je koho zoradiť na pódium
    for (const [mail, ms] of [['qaagdruha00001@qa-biz.local', 30], ['qaagtretia0001@qa-biz.local', 60], ['qaagstvrta0001@qa-biz.local', 90]]) {
      const jr = {};
      await j('/api/login', { method: 'POST', body: { email: mail, password: 'Heslo123!' } }, jr);
      await j('/api/puzzle/start', { method: 'POST' }, jr);
      await new Promise(r => setTimeout(r, ms));
      await j('/api/puzzle/solve', { method: 'POST', body: { answers: h._answers, date: DNES } }, jr);
    }
    const po = (await j('/api/puzzle/today', {}, jar1)).d;
    ok('vyriešené vidí ako hotové', po.solved === true);
    ok('a dostane zoznam slov', Array.isArray(po.reveal) && po.reveal.length === 5 && po.reveal[0].slovo,
      JSON.stringify(po.reveal && po.reveal[0]));

    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.ag.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    const aw = await j('/api/admin/qa/puzzle-award/' + DNES, { method: 'POST' }, adm);
    const poradie = (aw.d && aw.d.vysledok) || [];
    ok('pódium sa vyhodnotí', aw.status === 200, JSON.stringify(aw.d).slice(0, 120));
    ok('bonus dostanú prví traja', Array.isArray(poradie) && poradie.length === 3, JSON.stringify(poradie));
    if (Array.isArray(poradie) && poradie.length === 3)
      ok('a to 5 / 3 / 1', poradie.map(x => x.bonus).join(',') === '5,3,1', poradie.map(x => x.bonus).join(','));
    else ok('a to 5 / 3 / 1', false, 'pódium sa nevrátilo');

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nPOSKLADAJ SLOVO: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
