/**
 * FUNNEL-013: dôvody rušenia členstva
 * Fixture: klientky so stripe_subscription_id sa pre-seednu priamo do users.db
 * (bcrypt hash hesla), server beží so STRIPE_FAKE=1 → žiadna sieť na Stripe.
 * Overuje: zrušenie s dôvodom+poznámkou, whitelist (neznámy kód → ine),
 * admin notifikáciu, /api/admin/churn-reasons rozpad, 400 bez odberu, UI modal.
 *
 * Spustenie:  node qa/funnel-013-cancel-reasons.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4504;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-f013-'));

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
  // Pre-seed: 2 klientky s aktívnym Stripe odberom + 1 bez odberu
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const mkUser = (name, email, extra) => JSON.stringify({
    _id: mkid(), name, email, phone: '+421900111222', password: hash, referral_code: mkid().slice(0, 6).toUpperCase(),
    sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: 'client', visit_count: 5,
    referral_credit: 0, lead_source: 'qa', created_at: '2026-08-01', city: 'Detva',
    account_creation_type: 'self_registration', ...extra,
  }) + '\n';
  fs.writeFileSync(path.join(DATA, 'users.db'),
    mkUser('Qa Odberova', 'qa.sub1@qa-biz.local', { stripe_subscription_id: 'sub_qa_1', stripe_sub_plan: 'bronze' })
    + mkUser('Qa Odberova Druha', 'qa.sub2@qa-biz.local', { stripe_subscription_id: 'sub_qa_2', stripe_sub_plan: 'silver' })
    + mkUser('Qa Bezodberu', 'qa.nosub@qa-biz.local', {}));

  console.log('FUNNEL-013 QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1',
      STRIPE_FAKE: '1', STRIPE_SECRET_KEY: 'sk_test_qa_dummy' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } }, adm);

    // ── 1) zrušenie s platným dôvodom + poznámkou ──
    const jar = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.sub1@qa-biz.local', password: 'Heslo123!' } }, jar);
    ok('login pre-seednutej klientky', lg.status === 200, JSON.stringify(lg.d));
    const c1 = await j('/api/stripe/subscribe/cancel', { method: 'POST', body: { reason: 'cas', note: 'Zmenili mi zmeny v praci' } }, jar);
    ok('zrušenie s dôvodom prešlo', c1.d && c1.d.ok, JSON.stringify(c1.d));
    const c1b = await j('/api/stripe/subscribe/cancel', { method: 'POST', body: { reason: 'cas' } }, jar);
    ok('druhé zrušenie → 400 (odber už nie je)', c1b.status === 400);

    // ── 2) neznámy kód dôvodu → uloží sa ako "ine" ──
    const jar2 = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.sub2@qa-biz.local', password: 'Heslo123!' } }, jar2);
    const c2 = await j('/api/stripe/subscribe/cancel', { method: 'POST', body: { reason: 'blabla-hack', note: '' } }, jar2);
    ok('zrušenie s neznámym kódom prešlo', c2.d && c2.d.ok);

    // ── 3) bez odberu → 400 ──
    const jar3 = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.nosub@qa-biz.local', password: 'Heslo123!' } }, jar3);
    ok('bez odberu → 400', (await j('/api/stripe/subscribe/cancel', { method: 'POST', body: { reason: 'cas' } }, jar3)).status === 400);

    // ── 4) admin notifikácia s dôvodom a kontaktom ──
    const notifs = (await j('/api/notifications', {}, adm)).d || [];
    const nc = notifs.filter(n => n.type === 'membership_cancel');
    ok('admin dostal 💔 notifikácie (2)', nc.length === 2, JSON.stringify(nc.map(n => n.title)));
    ok('notifikácia nesie dôvod aj telefón', nc.some(n => (n.body || '').includes('Nestíham časovo') && (n.body || '').includes('+421900111222')));

    // ── 5) churn-reasons rozpad ──
    const cr = (await j('/api/admin/churn-reasons?days=30', {}, adm)).d;
    ok('churn-reasons ok, total 2', cr && cr.ok && cr.total === 2, JSON.stringify(cr));
    const rCas = (cr.by_reason || []).find(x => x.code === 'cas');
    const rIne = (cr.by_reason || []).find(x => x.code === 'ine');
    ok('rozpad: cas=1, ine=1 (whitelist)', rCas && rCas.count === 1 && rIne && rIne.count === 1, JSON.stringify(cr.by_reason));
    ok('latest nesie poznámku aj plán', (cr.latest || []).some(x => (x.note || '').includes('praci') && x.plan === 'bronze'), JSON.stringify(cr.latest));

    // ── 6) statické kontroly ──
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const cd = fs.readFileSync(path.join(__dirname, '..', 'public', 'client-dashboard.html'), 'utf8');
    ok('PayPal self-cancel tiež ukladá dôvod', /paypal_subscription_id:null, subscription_plan:null\}\}\);\s*\n\s*await recordMembershipCancel/.test(src));
    ok('UI: modal s dôvodmi + OSTÁVAM tlačidlo', cd.includes('CANCEL_REASONS_UI') && cd.includes('cnSubmit') && cd.includes('OSTÁVAM'));
    ok('UI: dôvod povinný (tlačidlo disabled do výberu)', cd.includes("onclick=\"cnSubmit()\" disabled"));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nFUNNEL-013: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
