/**
 * FUNNEL-014: CAC dashboard v2 — payback, retention D30/60/90, FREE|PAID dimenzia,
 * korelácia hodnotenia 1. hodiny s konverziou.
 * Fixture: kampaň + 4 klientky s presnými dátumami akvizície, účastí a platieb
 * pre-seednuté do NeDB pred štartom servera → deterministické metriky.
 *
 * Spustenie:  node qa/funnel-014-cac-v2.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4505;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-f014-'));

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
const iso = n => new Date(Date.now() - n * 864e5).toISOString();
const d10 = n => iso(n).slice(0, 10);
const mkid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
const W = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

(async () => {
  // ── Fixture ──
  const U1 = mkid(), U2 = mkid(), U3 = mkid(), U4 = mkid();
  const baseU = (id, name, email, acqDaysAgo, extra) => ({
    _id: id, name, email, phone: '', password: null, referral_code: id.slice(0, 6).toUpperCase(),
    sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: 'client', visit_count: 1,
    referral_credit: 0, lead_source: 'meta', created_at: d10(acqDaysAgo),
    account_creation_type: 'self_registration', registration_at: iso(acqDaysAgo), registration_at_source: 'actual',
    utm_campaign: 'qa_camp_zumba', city: 'Detva', ...extra,
  });
  W('users.db', [
    baseU(U1, 'Qa Kohortna Adela', 'qa.k.a@qa-biz.local', 100, { visit_count: 4 }),
    baseU(U2, 'Qa Kohortna Beata', 'qa.k.b@qa-biz.local', 100, {}),
    baseU(U3, 'Qa Kohortna Cilka', 'qa.k.c@qa-biz.local', 10, {}),
    baseU(U4, 'Qa Kohortna Dana', 'qa.k.d@qa-biz.local', 100, { acquisition_offer: 'paid_first_class' }),
  ]);
  W('campaigns.db', [{ _id: 'qacamp001', name: 'QA Zumba kampan', utm_key: 'qa_camp', platform: 'meta',
    spend: 100, spend_updated_at: iso(1), created_at: iso(100) }]);
  const bk = (uid, daysAgo) => ({ _id: mkid(), class_id: 'qacls1', class_name: 'Zumba QA', user_id: uid,
    user_name: 'QA', booking_date: d10(daysAgo), status: 'attended', attended_at: iso(daysAgo), created_at: iso(daysAgo) });
  W('bookings.db', [
    bk(U1, 98), bk(U1, 75), bk(U1, 45), bk(U1, 15), // deň 2, 25, 55, 85 od akvizície
    bk(U2, 98),                                      // len deň 2
    bk(U3, 9),                                       // mladá kohorta
    bk(U4, 97),                                      // deň 3
  ]);
  const tx = (uid, daysAgo, amount) => ({ _id: mkid(), type: 'membership', user_id: uid, user_name: 'QA',
    amount, payment_method: 'cash', note: 'QA fixture', created_at: iso(daysAgo), month: d10(daysAgo).slice(0, 7) });
  W('transactions.db', [tx(U1, 80, 50), tx(U1, 50, 50), tx(U4, 60, 30)]); // deň 20, 50 (U1) · deň 40 (U4)
  W('memberships.db', [{ _id: mkid(), user_id: U1, plan_id: 'bronze', plan_name: 'Bronze', price: 50,
    payment_method: 'cash', status: 'active', started_at: d10(80), expires_at: d10(-30), created_at: iso(80) }]);
  W('feedback.db', [
    { _id: mkid(), user_id: U1, user_name: 'Qa Kohortna Adela', type: 'first_class', rating: 5, created_at: iso(97) },
    { _id: mkid(), user_id: U2, user_name: 'Qa Kohortna Beata', type: 'first_class', rating: 2, created_at: iso(97) },
  ]);

  console.log('FUNNEL-014 QA — štart servera…');
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
    const d = (await j('/api/admin/cac-ltv', {}, adm)).d;
    ok('endpoint ok', d && d.ok);
    const r = (d.rows || []).find(x => x.name === 'QA Zumba kampan');
    ok('kampaň v rows', !!r, JSON.stringify((d.rows || []).map(x => x.name)));

    // základná kohorta
    ok('acquired=4, attended=4, payers=2, members=1', r && r.acquired === 4 && r.attended === 4 && r.payers === 2 && r.members === 1, JSON.stringify(r));
    ok('rev30=50, rev90=130', r && r.revenue30 === 50 && r.revenue90 === 130, r && `${r.revenue30}/${r.revenue90}`);

    // v2: payback
    ok('payback_days=60 (kumulatívne 130 € ≥ 100 € spend)', r && r.payback_days === 60, r && String(r.payback_days));

    // v2: retention
    ok('retention D30=100 % (3/3 zrelé, všetky prišli v okne 0–30)', r && r.retention_d30 === 100, r && String(r.retention_d30));
    ok('retention D60=33.3 % (len Adela v okne 30–60)', r && r.retention_d60 === 33.3, r && String(r.retention_d60));
    ok('retention D90=33.3 % (len Adela v okne 60–90)', r && r.retention_d90 === 33.3, r && String(r.retention_d90));
    ok('retention_base D30=3 (Cilka je mladá kohorta)', r && r.retention_base && r.retention_base.d30 === 3, r && JSON.stringify(r.retention_base));

    // v2: offer dimenzia
    ok('offers.free.acquired=3, offers.paid.acquired=1', r && r.offers && r.offers.free && r.offers.free.acquired === 3 && r.offers.paid && r.offers.paid.acquired === 1, r && JSON.stringify(r.offers));
    ok('offers.paid: payer 1, rev90 30', r && r.offers.paid.payers === 1 && r.offers.paid.rev90 === 30);
    ok('totals_by_offer.paid existuje', d.totals_by_offer && d.totals_by_offer.paid && d.totals_by_offer.paid.acquired === 1, JSON.stringify(d.totals_by_offer));

    // v2: korelácia hodnotení
    const c = d.rating_correlation;
    ok('korelácia: 4–5★ n=1, platí 100 %', c && c.high.n === 1 && c.high.payer_pct === 100, JSON.stringify(c));
    ok('korelácia: 1–3★ n=1, platí 0 %', c && c.low.n === 1 && c.low.payer_pct === 0, JSON.stringify(c));

    // stav kohorty
    ok('status INCOMPLETE (Cilka má len 10 dní)', r && r.status === 'INCOMPLETE');

    // statické kontroly UI
    const ah = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
    ok('UI: stĺpce Payback + D30/D60/D90', ah.includes('>Payback</th>') && ah.includes('>D30</th>') && ah.includes('retention_d90'));
    ok('UI: korelačný riadok hodnotení', ah.includes('rating_correlation'));
    ok('UI: FREE vs PAID blok', ah.includes('totals_by_offer'));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nFUNNEL-014: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
