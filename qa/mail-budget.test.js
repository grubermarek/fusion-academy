/**
 * Mailový budžet po prechode na Brevo Starter (10 000/mesiac, denný strop zrušený).
 * Marek 29. 8. 2026: plán upgradnutý, takže sa už nestrážia dni ale mesiac.
 * Test drží dve veci, na ktorých závisí, či klientke príde potvrdenie rezervácie:
 *   1. keď sa minie mesačný balík, marketing sa zastaví SKÔR ako transakčné
 *   2. denný strop ostáva ako poistka proti runaway cyklu
 * Spustenie:  node qa/mail-budget.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4513;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-mb-'));

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
  const KVOTA = 1000;   // malá kvóta, nech sa test nemusí prehrýzť desiatimi tisícmi záznamov

  // mail_log naplnený tak, že mesiac je z 82 % minutý, ale dnešok je čistý
  const MINUTE = 820;
  const zaciatokMesiaca = DNES.slice(0, 8) + '01';
  const riadky = [];
  for (let i = 0; i < MINUTE; i++) {
    riadky.push(JSON.stringify({
      _id: 'qaMail' + String(i).padStart(6, '0'), to: 'qa' + i + '@qa-biz.local', subject: 'QA',
      created_at: zaciatokMesiaca + 'T08:00:00.000Z', priority: 8, opened: false,
    }));
  }
  fs.writeFileSync(path.join(DATA, 'mail_log.db'), riadky.join('\n') + '\n');

  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), JSON.stringify({
    _id: 'qaMailAdmin00001', name: 'Adam Rozpoctovy', email: 'qa.mb@qa-biz.local', phone: '', password: hash,
    referral_code: 'QAMB01', sponsor_id: null, rank: 1, is_admin: true, active: true, user_type: 'admin',
    created_at: '2026-07-01', city: 'Detva',
  }) + '\n');

  console.log('MAILOVÝ BUDŽET QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1',
           MAIL_OFF: '1', MAIL_MONTHLY_QUOTA: String(KVOTA) },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.mb@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    const b = await j('/api/admin/qa/mail-budget', {}, adm);
    ok('diagnostika budžetu odpovedá', b.status === 200 && b.d && b.d.ok, JSON.stringify(b.d));
    const sk = b.d && b.d.skutocne;
    ok('mesačná spotreba sa ráta (' + MINUTE + ')', sk && sk.mesiac === MINUTE, JSON.stringify(sk));
    ok('dnešná spotreba je 0', sk && sk.den === 0, JSON.stringify(sk));
    ok('kvóta sa berie z env', sk && sk.mesacna_kvota === KVOTA, JSON.stringify(sk));

    // pri 82 % minutého mesiaca: marketing (p10 = 75 % kvóty = 750) už NESMIE,
    // transakčné (p1 = 100 % = 1000) ešte áno — to je celý zmysel stropov
    const a = b.d && b.d.allowed;
    ok('marketing p10 je zastavený (minuté > 75 % kvóty)', a && a.p10 === false, JSON.stringify(a));
    ok('kampane p8 sú zastavené (minuté > 80 % kvóty)', a && a.p8 === false, JSON.stringify(a));
    ok('transakčné p1 stále prejdú', a && a.p1 === true, JSON.stringify(a));
    ok('potvrdenia p2 stále prejdú', a && a.p2 === true, JSON.stringify(a));
    ok('p3 (pripomienky) prejdú — 97 % kvóty', a && a.p3 === true, JSON.stringify(a));

    // denný strop ako poistka: simulovaný počet nad denný cap zastaví aj transakčné
    const den = await j('/api/admin/qa/mail-budget?sent=1500', {}, adm);
    const ad = den.d && den.d.allowed;
    ok('denná poistka zastaví aj p1 pri 1500 za deň', ad && ad.p1 === false, JSON.stringify(ad));
    const den2 = await j('/api/admin/qa/mail-budget?sent=550', {}, adm);
    const ad2 = den2.d && den2.d.allowed;
    ok('pri 550 za deň marketing p10 stopne, transakčné p1 nie',
      ad2 && ad2.p10 === false && ad2.p1 === true, JSON.stringify(ad2));

    ok('denné stropy sú vyššie než starých 295 (limit 300/deň padol)',
      b.d.stropy && b.d.stropy.den && b.d.stropy.den['1'] > 295, JSON.stringify(b.d.stropy && b.d.stropy.den));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    console.log('\nMAILOVÝ BUDŽET: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
