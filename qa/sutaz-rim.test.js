/**
 * Súťaž o Rím: raz splnená méta ostáva splnená (Marek 1. 9.).
 *
 * Bez zápisu by stačilo storno alebo zmena obdobia a víťazka by cenu
 * „stratila" — appka by jej znova písala, koľko jej chýba. Test stráži, že sa
 * výhra zapíše, oznámi klientke aj adminom, a že sa oznámenia neopakujú.
 *
 * Spustenie:  node qa/sutaz-rim.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4548;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-rim-'));

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
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const A = (id, meno, kod) => JSON.stringify({ _id: id, name: meno, email: id.toLowerCase() + '@qa-biz.local',
    password: hash, user_type: 'ambassador', active: true, rank: 1, referral_code: kod,
    ambassador_since: '2026-02-01', created_at: '2026-01-15', amb_rank: 1 });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaRimAdmin00001', name: 'Adam Admin', email: 'qa.rim.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }),
    A('qaRimVitazka001', 'Viera Vitazna', 'QARIM1'),
    A('qaRimTesna00001', 'Tereza Tesna', 'QARIM2'),
  ].join('\n') + '\n');

  // Viera má 1 050 OB v období súťaže, Tereza 945 — teda tesne pod métou
  const TX = (id, uid, amt, den) => JSON.stringify({ _id: id, user_id: uid, type: 'membership',
    amount: amt, payment_method: 'card', date: den, created_at: den + 'T10:00:00.000Z' });
  fs.writeFileSync(path.join(DATA, 'transactions.db'), [
    TX('qaRimTx00000001', 'qaRimVitazka001', 600, '2026-08-25'),
    TX('qaRimTx00000002', 'qaRimVitazka001', 450, '2026-08-28'),
    TX('qaRimTx00000003', 'qaRimTesna00001', 945, '2026-08-25'),
    // pred štartom súťaže (20. 8.) — do méty sa rátať nesmie
    TX('qaRimTx00000004', 'qaRimTesna00001', 800, '2026-08-10'),
  ].join('\n') + '\n');

  console.log('SÚŤAŽ O RÍM QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  try {
    console.log('\nKto métu nesplnil:');
    const t = {};
    await j('/api/login', { method: 'POST', body: { email: 'qarimtesna00001@qa-biz.local', password: 'Heslo123!' } }, t);
    const mt = (await j('/api/ambassador/me', {}, t)).d;
    ok('panel odpovedá', mt && mt.ok, JSON.stringify(mt && mt.error));
    ok('body pred štartom súťaže sa nerátajú', mt.contest && mt.contest.done === 945, 'done=' + (mt.contest && mt.contest.done));
    ok('méta nie je splnená', mt.contest && mt.contest.won === false, JSON.stringify(mt.contest && mt.contest.won));
    ok('a vie, koľko chýba', mt.contest && mt.contest.missing === 55, 'missing=' + (mt.contest && mt.contest.missing));

    console.log('\nKto métu splnil:');
    const v = {};
    await j('/api/login', { method: 'POST', body: { email: 'qarimvitazka001@qa-biz.local', password: 'Heslo123!' } }, v);
    const mv = (await j('/api/ambassador/me', {}, v)).d;
    ok('má 1 050 bodov', mv.contest && mv.contest.done === 1050, 'done=' + (mv.contest && mv.contest.done));
    ok('méta je splnená', mv.contest && mv.contest.won === true);
    ok('nechýba už nič', mv.contest && mv.contest.missing === 0);
    ok('a progres je plný', mv.contest && mv.contest.progress === 100);
    ok('výhra má dátum', !!(mv.contest && mv.contest.won_at), String(mv.contest && mv.contest.won_at));

    await new Promise(r => setTimeout(r, 900));
    const notif = rd('notifications.db').filter(n => n.type === 'contest');
    ok('víťazka dostala notifikáciu',
      notif.some(n => n.user_id === 'qaRimVitazka001' && /Vyhrala si Rím/i.test(n.title)),
      JSON.stringify(notif.map(n => n.title)));
    ok('admin dostal notifikáciu',
      notif.some(n => n.user_id === 'qaRimAdmin00001' && /splnila métu/i.test(n.title)),
      JSON.stringify(notif.map(n => n.title)));

    const maily = rd('mail_log.db');
    ok('víťazke odišiel mail', maily.some(m => /contest_win$/.test(m.template || '')), JSON.stringify(maily.map(m => m.template)));
    ok('adminovi tiež', maily.some(m => /contest_win_admin/.test(m.template || '')), JSON.stringify(maily.map(m => m.template)));

    console.log('\nOpakovanie:');
    const znova = (await j('/api/ambassador/me', {}, v)).d;
    ok('druhé načítanie panela je stále výhra', znova.contest && znova.contest.won === true);
    await new Promise(r => setTimeout(r, 600));
    const notif2 = rd('notifications.db').filter(n => n.type === 'contest');
    ok('a neoznámi to druhýkrát', notif2.length === notif.length, notif.length + ' → ' + notif2.length);

    console.log('\nKeď body neskôr klesnú:');
    // simulujeme storno: transakciu odstránime a pozrieme, či výhra ostáva
    fs.appendFileSync(path.join(DATA, 'transactions.db'),
      JSON.stringify({ _id: 'qaRimTx00000002', $$deleted: true }) + '\n');
    const po = (await j('/api/ambassador/me', {}, v)).d;
    ok('raz splnená méta ostáva splnená', po.contest && po.contest.won === true,
      JSON.stringify(po.contest && { d: po.contest.done, w: po.contest.won }));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nSÚŤAŽ O RÍM: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
