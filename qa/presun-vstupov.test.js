/**
 * Presun vstupov z permanentky medzi účtami — /api/service/entries-move
 * (Marek 27. 9. 2026: „Zemanová Anna má dva vstupy, tie presuň na účet Antalková Michaela").
 *
 * Overuje: presun sedí na oboch účtoch, bez tokenu je nástroj neviditeľný (404),
 * viac vstupov než má klientka sa nepresunie, presun na ten istý účet neprejde,
 * a v audite ostane stopa so stavom pred aj po.
 *
 * Spustenie:  node qa/presun-vstupov.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');

const PORT = 4624, BASE = 'http://localhost:' + PORT;
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-vstupy-'));
const TOKEN = 'qa-servis-token-' + Date.now();
let ok = 0, zle = 0;
const t = (n, c, d) => { if (c) { ok++; console.log('  ✅ ' + n); } else { zle++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';

(async () => {
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaPvAnna00000001', name: 'Anna Vstupová', email: 'qa.pv.anna@qa-biz.local', user_type: 'client', active: true, single_entries: 2, created_at: '2026-01-01', referral_code: 'QAPV01' },
    { _id: 'qaPvMisa00000001', name: 'Miša Vstupová', email: 'qa.pv.misa@qa-biz.local', user_type: 'client', active: true, single_entries: 1, created_at: '2026-01-01', referral_code: 'QAPV02' },
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1']
    .map((x, i) => ({ _id: 'qaPvSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('PRESUN VSTUPOV — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', IMPORT_TOKEN: TOKEN }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; srv.stderr.on('data', d => { err += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + err.slice(-500)); process.exit(1); }
  await sleep(2500);

  const vol = async (telo, token = TOKEN) => {
    const r = await fetch(BASE + '/api/service/entries-move', { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-import-token': token } : {}) }, body: JSON.stringify(telo) });
    let d = null; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };

  try {
    const bez = await vol({ from: 'qaPvAnna00000001', to: 'qaPvMisa00000001', count: 1 }, '');
    t('bez tokenu nástroj neexistuje (404)', bez.status === 404, String(bez.status));

    const vela = await vol({ from: 'qaPvAnna00000001', to: 'qaPvMisa00000001', count: 5 });
    t('viac vstupov, než klientka má, sa nepresunie', vela.status === 400 && /len 2/.test(vela.d?.error || ''), JSON.stringify(vela));

    const sam = await vol({ from: 'qaPvAnna00000001', to: 'qaPvAnna00000001', count: 1 });
    t('presun na ten istý účet neprejde', sam.status === 400, JSON.stringify(sam));

    const r = await vol({ from: 'qaPvAnna00000001', to: 'qaPvMisa00000001', count: 2, reason: 'QA test' });
    t('presun prejde a vráti stav oboch účtov', r.status === 200 && r.d.od.vstupy_po === 0 && r.d.komu.vstupy_po === 3, JSON.stringify(r.d));

    const stav = JSON.parse(fs.readFileSync(path.join(DATA, 'users.db'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x))
      .reduce((a, u) => { a[u._id] = u.single_entries; return a; }, {}) && JSON.stringify(
        fs.readFileSync(path.join(DATA, 'users.db'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x))
          .reduce((a, u) => { a[u.name] = u.single_entries; return a; }, {})));
    t('v databáze sedia obe strany', stav['Anna Vstupová'] === 0 && stav['Miša Vstupová'] === 3, JSON.stringify(stav));

    const audit = fs.readFileSync(path.join(DATA, 'audit.db'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x))
      .filter(a => a.action === 'entries_move');
    t('audit má záznam so stavom pred aj po', audit.length === 1 && audit[0].before?.od?.vstupy === 2 && audit[0].after?.komu_po === 3 && audit[0].reason === 'QA test', JSON.stringify(audit[0] || {}).slice(0, 220));
  } catch (e) {
    zle++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nPRESUN VSTUPOV: ' + ok + ' OK / ' + zle + ' chýb');
    process.exit(zle ? 1 : 0);
  }
})();
