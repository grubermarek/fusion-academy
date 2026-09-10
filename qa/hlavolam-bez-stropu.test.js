/**
 * Hlavolam bez mesačného stropu (10. 9. 2026).
 *
 * Soňa Moskálová napísala, že jej appka nepripísala body za hlavolam. Nebola
 * to chyba — vyčerpala mesačný strop 40 bodov už 7. 9. a zvyšok mesiaca hrala
 * za nulu. Marek strop zrušil: „strop zrus."
 *
 * Stráži, že:
 *   · strop 0 znamená BEZ stropu, nie „žiadne body" (to by bola opačná chyba)
 *   · hráčka s dávno prekročenými 40 bodmi dostane za ďalšie riešenie plný počet
 *   · migrácia vráti body, ktoré strop v tomto mesiaci zobral
 *   · a nedotkne sa riešení, ktoré 0 bodov dostali právom (rytmus bez zásahu)
 *   · keď si niekto strop znovu nastaví, funguje ako predtým
 *
 * Spustenie:  node qa/hlavolam-bez-stropu.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4593;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-strop-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts, jar) {
  opts = opts || {};
  const headers = { 'Content-Type': 'application/json' };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const dnes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const mesiac = dnes.slice(0, 7);
  const denPred = n => { const d = new Date(dnes + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

  w('users.db', [
    { _id: 'qaStAdmin000001', name: 'Marek Gruber', email: 'qa.st.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    { _id: 'qaStSona0000001', name: 'Soňa Hráčka', email: 'qa.st.sona@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-07-01', visit_count: 40 },
  ]);
  // história: strop 40 vyčerpaný, potom dve riešenia za nulu + jedno pódiové bez bonusu
  w('puzzle_solves.db', [
    { _id: 'qaStSolve00001', user_id: 'qaStSona0000001', user_name: 'Soňa Hráčka',
      date: denPred(5), month: mesiac, seconds: 30, points: 40, fast: true, verified: true, type: 'words', created_at: denPred(5) + 'T10:00:00.000Z' },
    { _id: 'qaStSolve00002', user_id: 'qaStSona0000001', user_name: 'Soňa Hráčka',
      date: denPred(2), month: mesiac, seconds: 37, points: 0, fast: true, verified: true, type: 'zip', created_at: denPred(2) + 'T10:00:00.000Z' },
    { _id: 'qaStSolve00003', user_id: 'qaStSona0000001', user_name: 'Soňa Hráčka',
      date: denPred(1), month: mesiac, seconds: 21, points: 0, fast: true, verified: true, type: 'words',
      day_win: true, podium: 1, day_win_bonus: 0, created_at: denPred(1) + 'T10:00:00.000Z' },
    // rytmus s nula správnymi — nula je tu správna odpoveď, migrácia sa jej nesmie dotknúť
    { _id: 'qaStSolve00004', user_id: 'qaStSona0000001', user_name: 'Soňa Hráčka',
      date: denPred(3), month: mesiac, seconds: 46, points: 0, fast: true, verified: true, type: 'rhythm',
      correct: 0, total: 5, perfect: false, created_at: denPred(3) + 'T10:00:00.000Z' },
  ]);

  console.log('HLAVOLAM BEZ STROPU\n');

  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  // migrácie bežia 10–11 s po štarte
  await new Promise(r => setTimeout(r, 15000));

  const sona = {}, adm = {};
  const solve = id => rd('puzzle_solves.db').find(x => x._id === id);

  try {
    await j('/api/login', { method: 'POST', body: { email: 'qa.st.sona@qa-biz.local', password: 'Heslo123!' } }, sona);
    await j('/api/login', { method: 'POST', body: { email: 'qa.st.admin@qa-biz.local', password: 'Heslo123!' } }, adm);

    console.log('1) Strop je zrušený:');
    const cfg = await j('/api/puzzle/today', {}, sona);
    ok('appka hlási strop 0 (bez stropu)', cfg.d && +cfg.d.monthly_cap === 0, 'monthly_cap=' + (cfg.d && cfg.d.monthly_cap));

    console.log('\n2) Body, ktoré strop zobral, sa vrátili:');
    ok('rýchle riešenie dostalo svoje 2 body', solve('qaStSolve00002').points === 2, String(solve('qaStSolve00002').points));
    ok('víťazný deň dostal 2 + 5 bonus', solve('qaStSolve00003').points === 7, String(solve('qaStSolve00003').points));
    ok('a bonus je zapísaný správne', solve('qaStSolve00003').day_win_bonus === 5, String(solve('qaStSolve00003').day_win_bonus));
    ok('pôvodné riešenie sa nezmenilo', solve('qaStSolve00001').points === 40, String(solve('qaStSolve00001').points));

    console.log('\n3) Nula, ktorá bola zaslúžená, ostáva nulou:');
    ok('rytmus s 0 správnymi má stále 0', solve('qaStSolve00004').points === 0, String(solve('qaStSolve00004').points));
    ok('a nie je označený ako vrátený', !solve('qaStSolve00004').cap_restored);

    console.log('\n4) Hráčka o tom vie:');
    const n = rd('notifications.db').filter(x => x.user_id === 'qaStSona0000001' && /strop/i.test(String(x.title || '')));
    ok('dostala notifikáciu', n.length === 1, 'notifikácií: ' + n.length);

    console.log('\n5) Mesačné body ju už neobmedzujú:');
    const prof = await j('/api/profile/qaStSona0000001', {}, sona);
    const puz = (((prof.d || {}).points || {}).items || []).find(i => /hlavolam/i.test(String(i.label || '')));
    ok('v rozpise má 49 bodov z hlavolamu', puz && puz.points === 49,
      puz ? String(puz.points) : JSON.stringify((((prof.d || {}).points || {}).items || []).map(i => i.label)));

    console.log('\n6) Strop sa dá kedykoľvek vrátiť:');
    const set = await j('/api/admin/puzzle', { method: 'PUT', body: { monthly_cap: 40 } }, adm);
    ok('admin ho vie nastaviť späť', set.status === 200, 'HTTP ' + set.status + ' ' + JSON.stringify(set.d).slice(0, 120));
    await new Promise(r => setTimeout(r, 700));
    const cfg2 = await j('/api/puzzle/today', {}, sona);
    ok('a appka ho hlási', cfg2.d && +cfg2.d.monthly_cap === 40, 'monthly_cap=' + (cfg2.d && cfg2.d.monthly_cap));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nHLAVOLAM BEZ STROPU: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-900));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
