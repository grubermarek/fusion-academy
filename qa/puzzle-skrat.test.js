/**
 * Skrátenie bodov hlavolamu za podvádzanie (Marek 18. 9. 2026).
 * Hráčka s podozrivo rýchlymi, vždy správnymi riešeniami príde o body nad strop
 * za daný mesiac; dostane oznam; prehľad mesiaca ukáže priemer ostatných.
 *
 * Spustenie:  node qa/puzzle-skrat.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4516;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-ps-'));
const TOKEN = 'qa-import-token-ps';

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
const zoznam = d => Array.isArray(d) ? d : (d && (d.items || d.notifications || d.rows)) || [];

(async () => {
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const M = DNES.slice(0, 7);
  const MINULY = (() => { const d = new Date(M + '-01T12:00:00Z'); d.setUTCDate(0); return d.toISOString().slice(0, 10); })();

  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = (id, meno, mail, kod, extra = {}) => JSON.stringify({
    _id: id, name: meno, email: mail, phone: '', password: hash, referral_code: kod,
    sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: 'client',
    visit_count: 3, created_at: '2026-07-01', city: 'Detva', account_creation_type: 'self_registration', ...extra,
  });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    U('qaPsAdmin0000001', 'Admin Testova', 'qa.ps.admin@qa-biz.local', 'QAPS00', { is_admin: true }),
    U('qaPsPodvod000001', 'Sona Rychla', 'qa.ps.podvod@qa-biz.local', 'QAPS01'),
    U('qaPsFer000000001', 'Nina Ferova', 'qa.ps.fer@qa-biz.local', 'QAPS02'),
    U('qaPsFer200000001', 'Sara Ferova', 'qa.ps.fer2@qa-biz.local', 'QAPS03'),
  ].join('\n') + '\n');

  // Podvodníčka: 4 záznamy dnes (poradie podľa created_at) = 12 + 30 + 40 + 30 = 112 b,
  // + 1 v minulom mesiaci (nesmie sa dotknúť). Férové: 40 a 40 b. Neoverený pokus sa neráta.
  const S = (id, uid, meno, dat, sek, body, h, extra = {}) => JSON.stringify({
    _id: id, user_id: uid, user_name: meno, date: dat, month: dat.slice(0, 7),
    seconds: sek, points: body, verified: true, created_at: dat + 'T' + h + ':00:00.000Z', type: 'quiz', ...extra,
  });
  fs.writeFileSync(path.join(DATA, 'puzzle_solves.db'), [
    S('qaPsS01', 'qaPsPodvod000001', 'Sona Rychla', DNES, 8, 12, '08', { perfect: true }),
    S('qaPsS02', 'qaPsPodvod000001', 'Sona Rychla', DNES, 7, 30, '09', { perfect: true, day_win: true, day_win_bonus: 5 }),
    S('qaPsS03', 'qaPsPodvod000001', 'Sona Rychla', DNES, 6, 40, '10', { perfect: true }),
    S('qaPsS04', 'qaPsPodvod000001', 'Sona Rychla', DNES, 9, 30, '11', { perfect: true }),
    S('qaPsS05', 'qaPsPodvod000001', 'Sona Rychla', MINULY, 9, 20, '10', { perfect: true }),
    S('qaPsS06', 'qaPsFer000000001', 'Nina Ferova', DNES, 60, 40, '10'),
    S('qaPsS07', 'qaPsFer200000001', 'Sara Ferova', DNES, 70, 40, '10'),
    S('qaPsS08', 'qaPsFer200000001', 'Sara Ferova', DNES, 70, 9, '11', { verified: false }),
  ].join('\n') + '\n');

  console.log('SKRÁTENIE BODOV HLAVOLAMU QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', IMPORT_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol do 180 s'); process.exit(1); }

  try {
    const klientka = {}, admin = {};
    ok('prihlásenie klientky', (await j('/api/login', { method: 'POST', body: { email: 'qa.ps.podvod@qa-biz.local', password: 'Heslo123!' } }, klientka)).status === 200);
    ok('prihlásenie admina', (await j('/api/login', { method: 'POST', body: { email: 'qa.ps.admin@qa-biz.local', password: 'Heslo123!' } }, admin)).status === 200);

    ok('prehľad mesiaca: bez prihlásenia 401', (await j('/api/admin/puzzle/mesiac')).status === 401);
    ok('prehľad mesiaca: klientka 403', (await j('/api/admin/puzzle/mesiac', {}, klientka)).status === 403);
    ok('skrátenie: zlý servisný token = 401', (await j('/api/admin/puzzle/skrat', { method: 'POST', headers: { 'x-import-token': 'zly' }, body: { user_id: 'qaPsPodvod000001', cap: 40 } })).status === 401);

    const pre = await j('/api/admin/puzzle/mesiac?month=' + M, {}, admin);
    ok('prehľad mesiaca odpovedá', pre.status === 200 && pre.d && pre.d.ok, JSON.stringify(pre.d).slice(0, 200));
    const sona = pre.d.rows.find(r => r.user_id === 'qaPsPodvod000001');
    ok('podvodníčka má 112 b za mesiac (minulý mesiac sa neráta)', sona && sona.points === 112, JSON.stringify(sona));
    ok('neoverený záznam sa neráta', pre.d.rows.find(r => r.user_id === 'qaPsFer200000001').points === 40);
    ok('priemer je zo všetkých hráčok', pre.d.avg === Math.round((112 + 40 + 40) / 3), String(pre.d.avg));
    ok('poradie podľa bodov, podvodníčka prvá', pre.d.rows[0].user_id === 'qaPsPodvod000001');

    // Skrátenie cez servisný token (bez prihlásenia) — ako z konzoly.
    const sk = await j('/api/admin/puzzle/skrat', { method: 'POST', headers: { 'x-import-token': TOKEN },
      body: { user_id: 'qaPsPodvod000001', cap: 40, month: M, dovod: 'podozrivo rýchle časy' } });
    ok('skrátenie prebehlo', sk.status === 200 && sk.d && sk.d.zmena === true, JSON.stringify(sk.d));
    ok('pred 112 → po 40', sk.d.pred === 112 && sk.d.po === 40, JSON.stringify(sk.d));
    ok('upravené 3 záznamy (prvý ostal celý)', sk.d.upravene === 3, String(sk.d.upravene));

    const po = await j('/api/admin/puzzle/mesiac?month=' + M, {}, admin);
    const sona2 = po.d.rows.find(r => r.user_id === 'qaPsPodvod000001');
    ok('po skrátení má 40 b', sona2 && sona2.points === 40, JSON.stringify(sona2));
    ok('priemer je teraz 40', po.d.avg === 40, String(po.d.avg));

    // Rozloženie: 12 (celé) + 28 (z 30) + 0 + 0; minulý mesiac 20 nedotknutý.
    const solves = fs.readFileSync(path.join(DATA, 'puzzle_solves.db'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const last = {}; for (const r of solves) last[r._id] = r;   // NeDB append-only: posledný zápis platí
    ok('1. záznam celý (12)', last.qaPsS01.points === 12 && last.qaPsS01.points_povodne === undefined);
    ok('2. záznam skrátený na 28, pôvodných 30 uložených', last.qaPsS02.points === 28 && last.qaPsS02.points_povodne === 30 && last.qaPsS02.korekcia && last.qaPsS02.korekcia.cap === 40, JSON.stringify(last.qaPsS02));
    ok('3. a 4. záznam na nule', last.qaPsS03.points === 0 && last.qaPsS04.points === 0);
    ok('minulý mesiac nedotknutý', last.qaPsS05.points === 20 && !last.qaPsS05.korekcia);
    ok('férové hráčky nedotknuté', last.qaPsS06.points === 40 && last.qaPsS07.points === 40);

    const st = await j('/api/puzzle/today', {}, klientka);
    ok('hlavolam ukazuje 40 b v mesiaci', st.status === 200 && st.d.month_points === 40, JSON.stringify(st.d && st.d.month_points));

    const n = await j('/api/notifications', {}, klientka);
    const ozn = zoznam(n.d).find(x => x.type === 'puzzle_podvod');
    ok('klientka dostala oznam', !!ozn, JSON.stringify(n.d).slice(0, 200));
    ok('oznam hovorí o 40 bodoch a zákaze', ozn && /40 bodov/.test(ozn.body) && /zakážeme/.test(ozn.body), ozn && ozn.body);

    // Opakované volanie nič nemení (už je pod stropom) a oznam nepribudne.
    const sk2 = await j('/api/admin/puzzle/skrat', { method: 'POST', body: { user_id: 'qaPsPodvod000001', cap: 40, month: M } }, admin);
    ok('druhé skrátenie: bez zmeny', sk2.status === 200 && sk2.d.zmena === false && sk2.d.pred === 40, JSON.stringify(sk2.d));
    const n2 = await j('/api/notifications', {}, klientka);
    const pocet = zoznam(n2.d).filter(x => x.type === 'puzzle_podvod').length;
    ok('oznam je len jeden', pocet === 1, String(pocet));

    ok('neznáma klientka = 404', (await j('/api/admin/puzzle/skrat', { method: 'POST', body: { user_id: 'nikto', cap: 40 } }, admin)).status === 404);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\n' + passed + ' ✅  ' + failed + ' ❌');
  process.exit(failed ? 1 : 0);
})();
