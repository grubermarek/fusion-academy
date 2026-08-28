/**
 * ⏱ Časovač práce trénera: server meria čas, stop zapíše úlohu + bonusové body.
 * QA_TIMER_FAST=1 → každá sekunda sa ráta ako 15 minút (testy nečakajú pol hodiny).
 * Spustenie:  node qa/coach-timer.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4523;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-timer-'));

let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };

async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = JSON.parse(await r.text()); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), JSON.stringify({
    _id: 'trenerkaTimer001', name: 'Beata Trenerka', email: 'beata.qa@qa-biz.local', password: hash,
    user_type: 'trainer', active: true, rank: 1, referral_code: 'TT1', created_at: '2026-01-01' }) + '\n');

  console.log('TIMER QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
           RATE_LIMIT_OFF: '1', MAIL_OFF: '1', QA_TIMER_FAST: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    const trn = {};
    await j('/api/login', { method: 'POST', body: { email: 'beata.qa@qa-biz.local', password: 'Heslo123!' } }, trn);

    // ── stav pred štartom ──
    const d0 = (await j('/api/coach/today', {}, trn)).d;
    ok('dashboard nesie stav časovača', d0.timer && d0.timer.running === false && d0.timer.today_min === 0, JSON.stringify(d0.timer));
    ok('stop bez štartu = zrozumiteľná chyba', (await j('/api/coach/timer/stop', { method: 'POST' }, trn)).status === 400);

    // ── štart ──
    const st = (await j('/api/coach/timer/start', { method: 'POST' }, trn)).d;
    ok('časovač sa spustí', st && st.ok && st.running === true && !!st.started_at, JSON.stringify(st));
    const st2 = (await j('/api/coach/timer/start', { method: 'POST' }, trn)).d;
    ok('druhý štart nezaloží novú session', st2.already === true);
    ok('štart je uložený na serveri (prežije refresh)', !!(rd('users.db').find(u => u._id === 'trenerkaTimer001') || {}).coach_timer_start);

    // ── beh ~4 s = 60 „minút" (QA_TIMER_FAST) ──
    await new Promise(r => setTimeout(r, 4200));
    const d1 = (await j('/api/coach/today', {}, trn)).d;
    ok('dashboard ukazuje bežiaci čas', d1.timer.running === true && d1.timer.elapsed_min >= 45, JSON.stringify(d1.timer.elapsed_min));

    // ── stop → zápis úlohy + body ──
    const sp = (await j('/api/coach/timer/stop', { method: 'POST' }, trn)).d;
    ok('stop zapíše odmeraný čas', sp && sp.ok && sp.minutes >= 60 && sp.minutes <= 90, JSON.stringify(sp));
    ok('bonusové body: 1 b./30 min', sp.points === Math.floor(sp.minutes / 30), JSON.stringify({ min: sp.minutes, pts: sp.points }));
    const task = rd('coach_tasks.db').find(t => t.source === 'timer' && t.trainer_id === 'trenerkaTimer001');
    ok('v úlohách je zapísaný odpracovaný čas', task && task.done && /Odpracovaný čas/.test(task.label)
      && task.minutes === sp.minutes && task.points === sp.points, JSON.stringify(task && { l: task.label, m: task.minutes, p: task.points }));
    ok('úloha je auto-schválená (čas meral server)', task.approved === true);
    ok('časovač po stope nebeží', (await j('/api/coach/today', {}, trn)).d.timer.running === false);

    // ── body sa premietli do dňa ──
    const d2 = (await j('/api/coach/today', {}, trn)).d;
    ok('denný súčet obsahuje odpracované minúty aj body', d2.timer.today_min === sp.minutes && d2.timer.today_points === sp.points, JSON.stringify(d2.timer));
    ok('úloha s bodmi je v zozname dňa', d2.tasks.some(t => /Odpracovaný čas/.test(t.label) && t.points === sp.points));

    // ── denný bodový strop (240 min): druhá dlhá session doplní len zvyšok ──
    await j('/api/coach/timer/start', { method: 'POST' }, trn);
    await new Promise(r => setTimeout(r, 14000));   // ~14 s = 210 min → spolu cez strop
    const sp2 = (await j('/api/coach/timer/stop', { method: 'POST' }, trn)).d;
    const spoluMin = sp.minutes + sp2.minutes;
    const cakaneBody2 = Math.floor(Math.max(0, Math.min(sp2.minutes, 240 - sp.minutes)) / 30);
    ok('čas nad denný strop sa zapíše, ale ďalej sa neboduje',
      sp2.points === cakaneBody2 && (spoluMin > 240 ? sp2.capped === true : true),
      JSON.stringify({ min2: sp2.minutes, pts2: sp2.points, cakane: cakaneBody2, spolu: spoluMin }));

    // ── bezpečnosť ──
    ok('časovač len pre trénera', (await j('/api/coach/timer/start', { method: 'POST' })).status === 401);
    const src = fs.readFileSync(path.join(__dirname, '..', 'coach.js'), 'utf8');
    ok('session strop 8 h existuje (zabudnutý časovač)', src.includes('timer_session_cap_min'));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message + '\n' + e.stack);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nTIMER: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
