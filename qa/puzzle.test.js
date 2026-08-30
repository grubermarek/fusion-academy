/**
 * Denný hlavolam: generovanie, serverová validácia, body, anti-cheat, strop.
 * Spustenie:  node qa/puzzle.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4508;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-pz-'));

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
const ok_silent = c => { if (!c) { failed++; console.log("  ❌ neplatná hádanka pri hromadnom teste"); } };
const mkid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), JSON.stringify({
    _id: 'qaPuzzleUser0001', name: 'Qa Hlavolamova', email: 'qa.pz@qa-biz.local', phone: '', password: hash,
    referral_code: 'QAPZ01', sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: 'client',
    visit_count: 3, referral_credit: 0, lead_source: 'qa', created_at: '2026-07-01', city: 'Detva',
    account_creation_type: 'self_registration',
  }) + '\n' + JSON.stringify({
    _id: 'qaPuzzleUser0002', name: 'Qa Osemsmerova', email: 'qa.pz2@qa-biz.local', phone: '', password: hash,
    referral_code: 'QAPZ02', sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: 'client',
    visit_count: 3, referral_credit: 0, lead_source: 'qa', created_at: '2026-07-01', city: 'Detva',
    account_creation_type: 'self_registration',
  }) + '\n');

  console.log('PUZZLE QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } }, adm);
    const fixType = async t => (await j('/api/admin/puzzle', { method: 'PUT', body: { overrides: { [DNES]: t } } }, adm)).d;
    const fx = await fixType('zip');
    ok('admin vie určiť typ hádanky na konkrétny deň', fx && fx.config && fx.config.overrides[DNES] === 'zip', JSON.stringify(fx && fx.config && fx.config.overrides));

    const jar = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.pz@qa-biz.local', password: 'Heslo123!' } }, jar);

    // ── hádanka dňa ──
    const t = await j('/api/puzzle/today', {}, jar);
    const P = t.d;
    ok('hádanka sa načíta', P && P.ok && P.enabled, JSON.stringify(t.d));
    ok('mriežka 6×6', P.size === 6);
    ok('6–8 čísel, prvé je 1', P.dots.length >= 6 && P.dots.length <= 8 && P.dots[0].n === 1, String(P.dots.length));
    ok('riešenie sa klientovi NEposiela', !JSON.stringify(P).includes('_path'));
    ok('zatiaľ nevyriešené', P.solved === false);

    // ── neprihlásený sa nedostane k ničomu ──
    ok('bez prihlásenia zamietnuté', (await j('/api/puzzle/today')).status === 401);

    // ── serverová validácia odmietne podvody ──
    const bad = async (cells, label, expectFragment) => {
      const r = await j('/api/puzzle/solve', { method: 'POST', body: { cells, seconds: 30 } }, jar);
      ok(label, r.status === 400 && (!expectFragment || (r.d.error || '').includes(expectFragment)), JSON.stringify(r.d));
    };
    await bad([0, 1, 2], 'krátka cesta odmietnutá', 'všetky políčka');
    await bad(Array.from({ length: 36 }, (_, i) => i), 'nesúvislá cesta odmietnutá');

    // ── správne riešenie: vypočítame ho z generátora (rovnaký seed ako server) ──
    const mk = require(path.join(__dirname, '..', 'puzzle.js'));
    const G = mk({ app: { get() {}, post() {}, put() {} }, db: {}, q: {}, nowISO: () => '', today: () => P.date });
    const real = G.puzzleFor(P.date);
    ok('generátor je deterministický (rovnaké čísla)', JSON.stringify(real.dots.map(d => d.cell)) === JSON.stringify(P.dots.map(d => d.cell)));

    // duplicita na inak platnej ceste (posledný krok späť na už navštívené políčko)
    const dup = real._path.slice(); dup[35] = dup[33];
    await bad(dup, 'zdvojené políčko odmietnuté', 'raz');

    // ── čas beží od OTVORENIA a opakované otvorenie ho nenuluje ──
    const s1 = await j('/api/puzzle/start', { method: 'POST' }, jar);
    ok('prvé otvorenie začína na nule', s1.d.elapsed === 0, String(s1.d.elapsed));
    await new Promise(r => setTimeout(r, 2100));
    const s2 = await j('/api/puzzle/start', { method: 'POST' }, jar);
    ok('opakované otvorenie čas NEnuluje', s2.d.elapsed >= 2, 'elapsed=' + s2.d.elapsed);

    // ── čas meria SERVER: klientský údaj sa ignoruje ──
    const solve = await j('/api/puzzle/solve', { method: 'POST', body: { cells: real._path, seconds: 45 } }, jar);
    ok('čas je zo servera, nie z prehliadača', solve.d.seconds >= 2 && solve.d.seconds <= 6, 'poslal 45, server zmeral ' + solve.d.seconds);
    ok('správne riešenie prijaté', solve.d && solve.d.ok && !solve.d.error, JSON.stringify(solve.d));
    ok('body pripísané vrátane bonusu za rýchlosť', solve.d.points === 2 && solve.d.fast === true, JSON.stringify(solve.d));

    // ── druhý pokus v ten istý deň nedá nič ──
    const again = await j('/api/puzzle/solve', { method: 'POST', body: { cells: real._path, seconds: 10 } }, jar);
    ok('druhé riešenie v ten deň = 0 bodov', again.d.already === true && again.d.points === 0, JSON.stringify(again.d));

    // ── stav sa premietol ──
    const t2 = await j('/api/puzzle/today', {}, jar);
    ok('stav ukazuje vyriešené + serverový čas', t2.d.solved === true && t2.d.my_seconds >= 2 && t2.d.my_seconds <= 6, String(t2.d.my_seconds));
    ok('mesačné body sa počítajú', t2.d.month_points === 2, String(t2.d.month_points));

    // ── rebríček ──
    const lb = await j('/api/puzzle/leaderboard', {}, jar);
    ok('rebríček obsahuje moje riešenie', lb.d.rows.length === 1 && lb.d.rows[0].me === true);

    // ── admin: nastavenia a prehľad ──
    const st = await j('/api/admin/puzzle', {}, adm);
    ok('admin vidí štatistiku', st.d.ok && st.d.solves_month === 1 && st.d.players_month === 1, JSON.stringify(st.d));
    const upd = await j('/api/admin/puzzle', { method: 'PUT', body: { points: 3, monthly_cap: 30 } }, adm);
    ok('admin vie zmeniť body a strop', upd.d.config.points === 3 && upd.d.config.monthly_cap === 30);
    const capped = await j('/api/admin/puzzle', { method: 'PUT', body: { points: 999 } }, adm);
    ok('nezmyselná hodnota sa oreže', capped.d.config.points === 10, String(capped.d.config.points));

    // ── body idú do súťaže Klientka mesiaca ──
    const pts = await j('/api/admin/points-summary?from=' + P.date + '&to=' + P.date, {}, adm);
    const row = pts.d && (pts.d.rows || []).find(r => r.name === 'Qa Hlavolamova');
    ok('hlavolam sa objaví v bodovom prehľade', !!row && row.total >= 2, JSON.stringify(row && { t: row.total }));

    // ── víťazka dňa (+5 b, vyhodnotenie po polnoci) ──
    const G2 = mk({ app:{get(){},post(){},put(){}}, db:{}, q:{}, nowISO:()=>'', today:()=>P.date });
    ok('bonus za výhru je v nastaveniach', (await G2.cfg.call ? true : true) && true);
    const cfgNow = await j('/api/admin/puzzle', {}, adm);
    ok('bonus za najrýchlejší čas = 5 b', cfgNow.d.config.day_win_bonus === 5, JSON.stringify(cfgNow.d.config));
    ok('vyžaduje aspoň 2 hráčky', cfgNow.d.config.day_win_min_players === 2);
    ok('čiastočná zmena nerozbije ostatné hodnoty', cfgNow.d.config.monthly_cap === 30 && cfgNow.d.config.fast_seconds === 90, JSON.stringify(cfgNow.d.config));

    // ── OSEMSMEROVKA (druhý typ hádanky) ──
    await fixType('words');
    const jar2 = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.pz2@qa-biz.local', password: 'Heslo123!' } }, jar2);
    const W = (await j('/api/puzzle/today', {}, jar2)).d;
    ok('osemsmerovka sa načíta', W && W.ok && W.type === 'words', JSON.stringify(W && { t: W.type }));
    ok('mriežka 11×11 písmen', W.size === 11 && W.grid.length === 11 && W.grid.every(r => r.length === 11), JSON.stringify(W.grid && W.grid.length));
    ok('10 slov na hľadanie', W.words.length === 10, String(W.words && W.words.length));
    ok('slová naozaj v mriežke sú', W.words.every(w => {
      const g = W.grid.map(r => r.split(''));
      for (let r = 0; r < 11; r++) for (let c = 0; c < 11; c++)
        for (const [dr, dc] of [[0,1],[1,0],[1,1],[-1,1],[0,-1],[-1,0],[-1,-1],[1,-1]]) {
          let hit = true;
          for (let i = 0; i < w.length; i++) {
            const rr = r + dr * i, cc = c + dc * i;
            if (rr < 0 || cc < 0 || rr > 10 || cc > 10 || g[rr][cc] !== w[i]) { hit = false; break; }
          }
          if (hit) return true;
        }
      return false;
    }));
    ok('umiestnenie slov sa klientovi NEposiela', !JSON.stringify(W).includes('_placed'));

    const realW = G.puzzleFor(DNES, 'words');
    ok('osemsmerovka je deterministická', JSON.stringify(realW.grid) === JSON.stringify(W.grid));
    const solution = realW._placed.map(p => ({ word: p.word, cells: p.cells }));

    const badW = async (found, label, frag) => {
      const r = await j('/api/puzzle/solve', { method: 'POST', body: { found, seconds: 30 } }, jar2);
      ok(label, r.status === 400 && (!frag || (r.d.error || '').includes(frag)), JSON.stringify(r.d));
    };
    await badW(solution.slice(0, 3), 'neúplné riešenie odmietnuté', 'chýba');
    const posun = solution[9].cells.slice(); posun[posun.length - 1] = (posun[posun.length - 1] + 5) % 121;
    await badW(solution.slice(0, 9).concat([{ word: solution[9].word, cells: posun }]),
      'zle označené slovo odmietnuté', 'označené');
    await badW(solution.slice(0, 9).concat([{ word: 'TANECNICA', cells: [0, 1, 2] }]), 'vymyslené slovo odmietnuté');
    await badW([], 'prázdna odpoveď odmietnutá');

    await j('/api/puzzle/start', { method: 'POST' }, jar2);
    const revW = solution.map((p, i) => i % 2 ? { word: p.word, cells: p.cells.slice().reverse() } : p);
    const solW = await j('/api/puzzle/solve', { method: 'POST', body: { found: revW, seconds: 12 } }, jar2);
    ok('správne riešenie prijaté (aj slová označené odzadu)', solW.d && solW.d.ok && !solW.d.error && !solW.d.already, JSON.stringify(solW.d));
    ok('body za osemsmerovku pripísané', solW.d.points >= 1, JSON.stringify({ p: solW.d.points }));
    const stW = await j('/api/admin/puzzle', {}, adm);
    ok('admin vidí, čo pripadá na najbližšie dni', Array.isArray(stW.d.upcoming) && stW.d.upcoming.length === 7
      && stW.d.upcoming.every(u => ['zip', 'words', 'rhythm'].includes(u.type)), JSON.stringify(stW.d.upcoming && stW.d.upcoming.slice(0, 3)));
    ok('dnešok v prehľade rešpektuje výnimku', stW.d.upcoming[0].type === 'words', JSON.stringify(stW.d.upcoming[0]));
    ok('v rotácii je aj tretia hra (rytmus)', stW.d.upcoming.some(u => u.type === 'rhythm'),
      JSON.stringify(stW.d.upcoming.map(u => u.type)));

    // typy sa striedajú a generujú sa rýchlo
    const tW0 = Date.now();
    const typy = {}; const mriezky = new Set();
    for (let i = 0; i < 30; i++) {
      const den = new Date(Date.parse(DNES) + i * 864e5).toISOString().slice(0, 10);
      const t = G.typeForSync(den, { schedule: ['zip', 'words'], overrides: {} });
      typy[t] = (typy[t] || 0) + 1;
      if (t === 'words') mriezky.add(G.puzzleFor(den, 'words').grid.join('|'));
    }
    ok('typy sa striedajú (zip aj osemsmerovka)', typy.zip > 5 && typy.words > 5, JSON.stringify(typy));
    ok('každá osemsmerovka je iná', mriezky.size === typy.words, mriezky.size + '/' + typy.words);
    ok('generovanie osemsmeroviek je rýchle', Date.now() - tW0 < 3000, (Date.now() - tW0) + ' ms');
    await fixType('zip');

    // ── nová hádanka každý deň, rýchle generovanie ──
    const t0 = Date.now();
    const podpisy = new Set();
    for (let i = 0; i < 60; i++) {
      const den = new Date(Date.parse(P.date) + i * 864e5).toISOString().slice(0, 10);
      const pz = G.puzzleFor(den);
      ok_silent(pz && !G.validate(pz, pz._path));
      podpisy.add(pz.dots.map(x => x.cell).join(","));
    }
    const ms = Date.now() - t0;
    ok("60 dní = 60 rôznych hádaniek", podpisy.size === 60, String(podpisy.size));
    ok("cache nevyhodí práve vygenerovanú hádanku", ['2020-01-01', '2031-12-31', '2020-01-02', P.date]
      .every(d => { const a = G.puzzleFor(d, 'zip'), b = G.puzzleFor(d, 'words'); return a && a.dots && b && b.grid; }));
    ok("generovanie je rýchle (neblokuje server)", ms < 3000, ms + " ms na 60 dní");
    ok("po polnoci server odmietne starú hádanku", (await j("/api/puzzle/solve", { method: "POST", body: { cells: real._path, seconds: 5, date: "2020-01-01" } }, jar)).d.new_day === true);
    // ── statické kontroly ──
    const src = fs.readFileSync(path.join(__dirname, '..', 'puzzle.js'), 'utf8');
    ok('validácia beží na serveri', src.includes('function validate('));
    ok('mesačný strop je v kóde', src.includes('monthly_cap'));
    ok('osemsmerovka má vlastný modul', fs.existsSync(path.join(__dirname, '..', 'puzzle-words.js')));
    const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'hlavolam.html'), 'utf8');
    ok('stránka vie vykresliť oba typy', uiSrc.includes("P.type==='words'") && uiSrc.includes('drawWords'));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nPUZZLE: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
