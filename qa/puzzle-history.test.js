/**
 * História víťazov denného hlavolamu (Marek 30. 8. 2026).
 * Rebríček ukazoval len dnešok — teraz sa dá pozrieť dozadu: ktorý deň,
 * kto sa zapojil, aký mal čas a koľko bodov.
 *
 * Spustenie:  node qa/puzzle-history.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4515;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-ph-'));

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
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const den = n => { const d = new Date(DNES + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const VCERA = den(1), PREDVCEROM = den(2), ZAJTRA = (() => {
    const d = new Date(DNES + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10);
  })();

  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = (id, meno, mail, kod) => JSON.stringify({
    _id: id, name: meno, email: mail, phone: '', password: hash, referral_code: kod,
    sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: 'client',
    visit_count: 3, created_at: '2026-07-01', city: 'Detva', account_creation_type: 'self_registration',
  });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    U('qaPhJa0000000001', 'Ema Historikova', 'qa.ph.ja@qa-biz.local', 'QAPH01'),
    U('qaPhIna000000001', 'Nina Sokolova', 'qa.ph.ina@qa-biz.local', 'QAPH02'),
    U('qaPhTreti0000001', 'Sara Kovacova', 'qa.ph.treti@qa-biz.local', 'QAPH03'),
  ].join('\n') + '\n');

  // Predvčerom osemsmerovka (3 hráčky), včera spoj-čísla (2), dnes zatiaľ nikto.
  // Navyše jeden neplatný záznam (verified:false) a jeden s budúcim dátumom —
  // ani jeden sa nesmie objaviť v histórii.
  const S = (id, uid, meno, dat, sek, body, extra = {}) => JSON.stringify({
    _id: id, user_id: uid, user_name: meno, date: dat, month: dat.slice(0, 7),
    seconds: sek, points: body, verified: true, created_at: dat + 'T10:00:00.000Z', ...extra,
  });
  fs.writeFileSync(path.join(DATA, 'puzzle_solves.db'), [
    S('qaPhS01', 'qaPhIna000000001', 'Nina Sokolova',   PREDVCEROM, 41, 7, { type: 'words', podium: 1, day_win: true, day_win_bonus: 5 }),
    S('qaPhS02', 'qaPhJa0000000001', 'Ema Historikova', PREDVCEROM, 55, 5, { type: 'words', podium: 2, day_win_bonus: 3 }),
    S('qaPhS03', 'qaPhTreti0000001', 'Sara Kovacova',   PREDVCEROM, 78, 3, { type: 'words', podium: 3, day_win_bonus: 1 }),
    S('qaPhS04', 'qaPhJa0000000001', 'Ema Historikova', VCERA,      33, 7, { type: 'zip', podium: 1, day_win: true, day_win_bonus: 5 }),
    S('qaPhS05', 'qaPhIna000000001', 'Nina Sokolova',   VCERA,      64, 5, { type: 'zip', podium: 2, day_win_bonus: 3 }),
    S('qaPhS06', 'qaPhTreti0000001', 'Sara Kovacova',   VCERA,       9, 2, { type: 'zip', verified: false }),
    S('qaPhS07', 'qaPhTreti0000001', 'Sara Kovacova',   ZAJTRA,     20, 2, { type: 'zip' }),
  ].join('\n') + '\n');

  console.log('HISTÓRIA HLAVOLAMOV QA — štart servera…');
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
    const jar = {};
    ok('prihlásenie', (await j('/api/login', { method: 'POST', body: { email: 'qa.ph.ja@qa-biz.local', password: 'Heslo123!' } }, jar)).status === 200);

    ok('bez prihlásenia história nejde', (await j('/api/puzzle/history')).status === 401);

    const h = await j('/api/puzzle/history', {}, jar);
    ok('história odpovedá', h.status === 200 && h.d && h.d.ok, JSON.stringify(h.d).slice(0, 160));
    const dni = (h.d && h.d.days) || [];
    ok('vráti 2 odohrané dni', dni.length === 2, JSON.stringify(dni.map(x => x.date)));
    ok('najnovší deň je prvý', dni[0] && dni[0].date === VCERA, dni[0] && dni[0].date);
    ok('budúci dátum sa nezobrazí', !dni.some(x => x.date === ZAJTRA), JSON.stringify(dni.map(x => x.date)));

    const vcera = dni[0], predv = dni[1];
    ok('včera: 2 hráčky (neoverený pokus sa neráta)', vcera.players === 2, String(vcera.players));
    ok('včera: víťazka je najrýchlejšia', vcera.winner && vcera.winner.name === 'Ema Historikova' && vcera.winner.seconds === 33, JSON.stringify(vcera.winner));
    ok('včera: typ hádanky sa pamätá', vcera.type === 'zip', String(vcera.type));
    ok('včera: body spolu = 12', vcera.points === 12, String(vcera.points));

    ok('predvčerom: 3 hráčky', predv.players === 3, String(predv.players));
    ok('predvčerom: osemsmerovka', predv.type === 'words', String(predv.type));
    ok('predvčerom: víťazka Nina za 41 s', predv.winner && predv.winner.name === 'Nina Sokolova' && predv.winner.seconds === 41, JSON.stringify(predv.winner));

    const r = predv.rows || [];
    ok('poradie je podľa času vzostupne', r.map(x => x.seconds).join(',') === '41,55,78', r.map(x => x.seconds).join(','));
    ok('každý riadok má čas aj body', r.every(x => typeof x.seconds === 'number' && typeof x.points === 'number'), JSON.stringify(r[0]));
    ok('pódiové miesta sú označené', r[0].podium === 1 && r[1].podium === 2 && r[2].podium === 3, JSON.stringify(r.map(x => x.podium)));
    ok('vlastný riadok je označený "me"', r.some(x => x.me) && r.find(x => x.name === 'Ema Historikova').me === true, JSON.stringify(r.map(x => x.me)));
    ok('cudzí riadok označený nie je', r.find(x => x.name === 'Nina Sokolova').me === false);
    ok('neoverený pokus nie je ani v riadkoch', !(vcera.rows || []).some(x => x.name === 'Sara Kovacova'), JSON.stringify((vcera.rows || []).map(x => x.name)));

    // parameter days
    const h1 = await j('/api/puzzle/history?days=1', {}, jar);
    ok('days=1 vráti len posledný deň', (h1.d.days || []).length === 1, String((h1.d.days || []).length));
    const hMax = await j('/api/puzzle/history?days=999', {}, jar);
    ok('days sa zhora orezáva (nespadne)', hMax.status === 200 && (hMax.d.days || []).length === 2, String((hMax.d.days || []).length));
    const hZle = await j('/api/puzzle/history?days=abc', {}, jar);
    ok('nezmyselné days nezhodí endpoint', hZle.status === 200 && (hZle.d.days || []).length === 2, JSON.stringify(hZle.d).slice(0, 100));

    // druhá hráčka vidí "me" pri sebe, nie pri cudzej
    const jar2 = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.ph.ina@qa-biz.local', password: 'Heslo123!' } }, jar2);
    const h2 = await j('/api/puzzle/history', {}, jar2);
    const r2 = h2.d.days[1].rows;
    ok('iná hráčka má "me" pri svojom riadku', r2.find(x => x.name === 'Nina Sokolova').me === true
      && r2.find(x => x.name === 'Ema Historikova').me === false, JSON.stringify(r2.map(x => x.name + ':' + x.me)));

    // stránka má históriu vykreslenú
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hlavolam.html'), 'utf8');
    ok('stránka má kontajner histórie', html.includes('class="hist" id="hist"'));
    ok('história sa načítava až po kliknutí', html.includes('prepniHistoriu') && html.includes("api('/api/puzzle/history"));
    ok('deň sa dá rozkliknúť na detail', html.includes('prepniDen'));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    console.log('\nHISTÓRIA HLAVOLAMOV: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
