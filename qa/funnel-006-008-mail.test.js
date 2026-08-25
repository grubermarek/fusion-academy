/**
 * FUNNEL-006: mail priority budžet — matica stropov podľa priority (simulovaný počet odoslaných).
 * FUNNEL-008: abandoned checkout mail — výber pending Stripe checkoutu, revalidácia po zaplatení.
 * Pending platba sa PRED štartom servera zapíše priamo do NeDB súborov (payments.db, users.db)
 * — server ich pri boote načíta; nič sa neposiela (maily sú lokálne vypnuté).
 *
 * Spustenie:  node qa/funnel-006-008-mail.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4494;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-f006-'));

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
const iso = h => new Date(Date.now() - h * 3600e3).toISOString();

(async () => {
  // Pre-seed: klientka + jej pending Stripe checkout (4 h starý) + druhý čerstvý (1 h)
  const mkid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  const uid = mkid(), payOld = mkid(), payNew = mkid();
  fs.writeFileSync(path.join(DATA, 'users.db'), JSON.stringify({
    _id: uid, name: 'Qa Kosikova', email: 'qa.kosik@qa-biz.local', phone: '', password: null,
    referral_code: 'QAKOS1', sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: 'lead',
    visit_count: 0, referral_credit: 0, lead_source: 'qa', created_at: '2026-08-20',
    account_creation_type: 'self_registration', registration_at: iso(100), registration_at_source: 'actual',
  }) + '\n');
  fs.writeFileSync(path.join(DATA, 'payments.db'),
    JSON.stringify({ _id: payOld, stripe_session_id: 'cs_qa_old', user_id: uid, amount: 49.9, currency: 'EUR', description: 'Členstvo Bronze', ref_id: 'bronze', ref_type: 'membership', provider: 'stripe', status: 'pending', created_at: iso(4) }) + '\n'
    + JSON.stringify({ _id: payNew, stripe_session_id: 'cs_qa_new', user_id: uid, amount: 49.9, currency: 'EUR', description: 'Členstvo Bronze', ref_id: 'bronze', ref_type: 'membership', provider: 'stripe', status: 'pending', created_at: iso(1) }) + '\n');

  console.log('FUNNEL-006/008 QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } }, adm);

    // ── FUNNEL-006: matica budžetu ──
    const at = async n => (await j('/api/admin/qa/mail-budget?sent=' + n, {}, adm)).d.allowed;
    const b0 = await at(0), b205 = await at(205), b230 = await at(230), b260 = await at(260), b290 = await at(290), b296 = await at(296);
    ok('pri 0 odoslaných ide všetko', Object.values(b0).every(v => v === true));
    ok('pri 205: marketing (p10) STOP, ostatné idú', b205.p10 === false && b205.p8 === true && b205.p1 === true);
    ok('pri 230: nurture (p8) STOP, konverzné (p5) idú', b230.p8 === false && b230.p5 === true);
    ok('pri 260: konverzné (p5) STOP, remindery (p3) idú', b260.p5 === false && b260.p3 === true);
    ok('pri 290: remindery STOP, transakčné (p1–2) idú', b290.p3 === false && b290.p2 === true);
    ok('pri 296: stop aj transakčné (tvrdý strop)', b296.p1 === false && b296.p2 === false);

    // ── FUNNEL-008: abandoned checkout ──
    const a1 = await j('/api/admin/qa/run-abandoned-checkout', { method: 'POST' }, adm);
    ok('4 h pending checkout vybraný', (a1.d.selected || []).includes('qa.kosik@qa-biz.local'), JSON.stringify(a1.d));
    ok('1 h pending checkout NEvybraný (príliš čerstvý)', (a1.d.selected || []).length === 1);
    ok('mail sa lokálne neodoslal (gate)', (a1.d.sent || 0) === 0);

    // revalidácia: klientka medzitým zaplatila → checkout sa označí a mail už nikdy nejde
    // (dokončenú platbu zapíšeme cez grant-membership, ktorý vytvorí aktívne členstvo)
    const gift = await j('/api/admin/users/' + uid + '/grant-membership', { method: 'POST', body: { plan_id: 'bronze', gift: false, payment_method: 'cash', amount: 49.9 } }, adm);
    ok('členstvo aktivované (simulácia zaplatenia)', gift.status < 300);
    const a2 = await j('/api/admin/qa/run-abandoned-checkout', { method: 'POST' }, adm);
    ok('po zaplatení sa abandoned mail neposiela', !(a2.d.selected || []).includes('qa.kosik@qa-biz.local'), JSON.stringify(a2.d));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nFUNNEL-006/008: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
