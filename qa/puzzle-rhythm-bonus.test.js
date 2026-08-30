/**
 * Bonus +5 v deň rytmu (Marek 30. 8. 2026).
 * Pravidlo: body si každá odniesla už pri odovzdaní (bod za správnu ukážku),
 * bonus +5 patrí JEDNEJ — najrýchlejšej z tých, čo mali všetkých päť.
 *
 * Čo sa tu dá najľahšie pokaziť: dať bonus rýchlejšej, ktorá sa pomýlila.
 * Vtedy by sa oplatilo klikať naslepo a hra by stratila zmysel.
 *
 * Spustenie:  node qa/puzzle-rhythm-bonus.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4517;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-rb-'));

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
  const VCERA = (() => { const d = new Date(DNES + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();

  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = (id, meno, kod) => JSON.stringify({
    _id: id, name: meno, email: id.toLowerCase() + '@qa-biz.local', password: hash, referral_code: kod,
    user_type: 'client', active: true, is_admin: false, visit_count: 3, created_at: '2026-07-01',
    city: 'Detva', account_creation_type: 'self_registration',
  });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaRbAdmin0000001', name: 'Adam Bonusovy', email: 'qa.rb.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-06-01' }),
    U('qaRbRychlaZle01', 'Nina Rychla', 'QARB01'),      // najrýchlejšia, ale 4/5
    U('qaRbPomalaOk001', 'Ema Presna', 'QARB02'),       // pomalšia, ale 5/5  ← bonus patrí jej
    U('qaRbEsteHorsia1', 'Sara Pomala', 'QARB03'),      // najpomalšia, tiež 5/5
  ].join('\n') + '\n');

  // Včerajší deň bol rytmus. Poradie časov: Nina 30 s (4/5), Ema 45 s (5/5), Sara 70 s (5/5).
  const S = (id, uid, meno, sek, spravne, perfect) => JSON.stringify({
    _id: id, user_id: uid, user_name: meno, date: VCERA, month: VCERA.slice(0, 7),
    seconds: sek, points: spravne, correct: spravne, total: 5, perfect, verified: true,
    type: 'rhythm', created_at: VCERA + 'T18:00:00.000Z',
  });
  fs.writeFileSync(path.join(DATA, 'puzzle_solves.db'), [
    S('qaRbS1', 'qaRbRychlaZle01', 'Nina Rychla', 30, 4, false),
    S('qaRbS2', 'qaRbPomalaOk001', 'Ema Presna', 45, 5, true),
    S('qaRbS3', 'qaRbEsteHorsia1', 'Sara Pomala', 70, 5, true),
  ].join('\n') + '\n');

  console.log('BONUS RYTMU QA — štart servera…');
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
    const adm = {};
    ok('admin prihlásený', (await j('/api/login', { method: 'POST', body: { email: 'qa.rb.admin@qa-biz.local', password: 'Heslo123!' } }, adm)).status === 200);

    const r = await j('/api/admin/qa/puzzle-award/' + VCERA, { method: 'POST' }, adm);
    ok('vyhodnotenie zbehlo', r.status === 200 && r.d && r.d.ok, JSON.stringify(r.d));
    const v = (r.d && r.d.vysledok) || [];
    ok('bonus dostala práve jedna hráčka', v.length === 1, JSON.stringify(v));
    ok('bonus NEdostala najrýchlejšia s chybou', !v.some(x => x.name === 'Nina Rychla'), JSON.stringify(v));
    ok('bonus dostala najrýchlejšia z bezchybných (Ema)', v[0] && v[0].name === 'Ema Presna', JSON.stringify(v[0]));
    ok('bonus je +5', v[0] && v[0].bonus === 5, String(v[0] && v[0].bonus));

    // Stav čítame cez API, nie zo súboru: NeDB je append-only, takže update
    // pridá do .db ďalší riadok a pôvodný tam zostane — priame čítanie by
    // vracalo staré hodnoty a test by klamal.
    const rd = f => fs.readFileSync(path.join(DATA, f), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    const histRiadky = async () => {
      const h = await j('/api/puzzle/history?days=3', {}, adm);
      const den = ((h.d && h.d.days) || []).find(x => x.date === VCERA) || { rows: [] };
      return den.rows || [];
    };
    const rows1 = await histRiadky();
    const najdi = (zoz, m) => zoz.find(x => x.name === m) || {};
    const nina = najdi(rows1, 'Nina Rychla');
    const ema = najdi(rows1, 'Ema Presna');
    const sara = najdi(rows1, 'Sara Pomala');
    ok('história včerajška má všetky tri hráčky', rows1.length === 3, JSON.stringify(rows1.map(x => x.name)));
    ok('Nina má stále svoje 4 body (nič sa jej neubralo)', nina.points === 4, String(nina.points));
    ok('Ema má 5 + 5 = 10 bodov', ema.points === 10, String(ema.points));
    ok('Sara má 5 bodov, bonus nedostala', sara.points === 5, String(sara.points));
    ok('Ema je v histórii označená medailou', ema.podium === 1, JSON.stringify(rows1.map(x => x.name + ':' + x.points + '/' + (x.podium || '-'))));
    ok('Nina medailu nemá', !nina.podium);

    const notif = fs.existsSync(path.join(DATA, 'notifications.db')) ? rd('notifications.db') : [];
    const jej = notif.filter(n => n.user_id === 'qaRbPomalaOk001' && n.type === 'puzzle_win');
    ok('Eme prišla notifikácia o bonuse', jej.length === 1, String(jej.length));
    ok('notifikácia spomína plný počet', jej[0] && /plným počtom|všetky správne/i.test(jej[0].title + ' ' + jej[0].body), jej[0] && jej[0].title);
    ok('ostatným notifikácia neprišla', notif.filter(n => n.type === 'puzzle_win').length === 1);

    // druhé spustenie nesmie pridať bonus znova
    await j('/api/admin/qa/puzzle-award/' + VCERA, { method: 'POST' }, adm);
    const ema2 = najdi(await histRiadky(), 'Ema Presna');
    ok('opakované vyhodnotenie bonus nezdvojí', ema2.points === 10, String(ema2.points));
    ok('a nepošle druhú notifikáciu', rd('notifications.db').filter(n => n.type === 'puzzle_win').length === 1);

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    console.log('\nBONUS RYTMU: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
