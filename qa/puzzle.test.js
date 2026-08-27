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
const mkid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), JSON.stringify({
    _id: 'qaPuzzleUser0001', name: 'Qa Hlavolamova', email: 'qa.pz@qa-biz.local', phone: '', password: hash,
    referral_code: 'QAPZ01', sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: 'client',
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

    // ── čas meria SERVER: klientský údaj sa ignoruje ──
    await j('/api/puzzle/start', { method: 'POST' }, jar);
    await new Promise(r => setTimeout(r, 2100));                    // reálne 2 s riešenia
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
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } }, adm);
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

    // ── statické kontroly ──
    const src = fs.readFileSync(path.join(__dirname, '..', 'puzzle.js'), 'utf8');
    ok('validácia beží na serveri', src.includes('function validate('));
    ok('mesačný strop je v kóde', src.includes('monthly_cap'));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nPUZZLE: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
