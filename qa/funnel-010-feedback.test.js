/**
 * FUNNEL-010: hviezdičky po 1. hodine (1 otázka, vetvenie low/high)
 * Overuje: eligibilitu (bez účasti nie / po 1. účasti áno / po odpovedi nie),
 * validáciu ratingu, dedupe, admin notifikácie (🌟 high / ⚠️ low s komentárom),
 * summary endpoint + statické kontroly (21-dňové okno, import guard, UI).
 *
 * Spustenie:  node qa/funnel-010-feedback.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4501;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-f010-'));

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
const past = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

(async () => {
  console.log('FUNNEL-010 QA — štart servera…');
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
    const cls = ((await j('/api/first-class/schedule?city=detva')).d.items || [])[0];
    ok('rozvrh má termín (fixture)', !!cls);

    // ── 1) bez účasti → neeligible ──
    const jar = {};
    await j('/api/register', { method: 'POST', body: { name: 'Qa Hviezdna', email: 'qa.stars@qa-biz.local', password: 'Heslo123!', consent: true, city: 'Detva' } }, jar);
    let e = await j('/api/feedback/first-class', {}, jar);
    ok('pred 1. hodinou eligible=false', e.d && e.d.eligible === false, JSON.stringify(e.d));

    // ── 2) po 1. odchodenej hodine → eligible ──
    const _u = ((await j('/api/admin/leads?search=qa.stars', {}, adm)).d.leads || [])[0] || {};
    const uid = _u._id || _u.id;
    await j('/api/attendance/manual-booking', { method: 'POST', body: { user_id: uid, class_id: cls.class_id, booking_date: past(1), is_free: true } }, adm);
    e = await j('/api/feedback/first-class', {}, jar);
    ok('po 1. hodine eligible=true', e.d && e.d.eligible === true, JSON.stringify(e.d));

    // ── 3) validácia + high rating (5★) ──
    const bad = await j('/api/feedback/first-class', { method: 'POST', body: { rating: 0 } }, jar);
    ok('rating 0 → 400', bad.status === 400);
    const hi = await j('/api/feedback/first-class', { method: 'POST', body: { rating: 5 } }, jar);
    ok('rating 5 uložený', hi.d && hi.d.ok && hi.d.rating === 5, JSON.stringify(hi.d));
    e = await j('/api/feedback/first-class', {}, jar);
    ok('po odpovedi eligible=false', e.d && e.d.eligible === false);
    const dup = await j('/api/feedback/first-class', { method: 'POST', body: { rating: 1 } }, jar);
    ok('druhý pokus → already (dedupe)', dup.d && dup.d.already === true, JSON.stringify(dup.d));

    // ── 4) low rating (2★ + komentár) → admin notifikácia s textom ──
    const jar2 = {};
    await j('/api/register', { method: 'POST', body: { name: 'Qa Smutna', email: 'qa.sad@qa-biz.local', password: 'Heslo123!', consent: true, city: 'Zvolen' } }, jar2);
    const _u2 = ((await j('/api/admin/leads?search=qa.sad', {}, adm)).d.leads || [])[0] || {};
    const uid2 = _u2._id || _u2.id;
    await j('/api/attendance/manual-booking', { method: 'POST', body: { user_id: uid2, class_id: cls.class_id, booking_date: past(1), is_free: true } }, adm);
    const lo = await j('/api/feedback/first-class', { method: 'POST', body: { rating: 2, comment: 'Hudba bola príliš nahlas' } }, jar2);
    ok('rating 2 s komentárom uložený', lo.d && lo.d.ok, JSON.stringify(lo.d));
    const notifs = (await j('/api/notifications', {}, adm)).d || [];
    const nLow = notifs.find(n => n.type === 'feedback_low');
    const nHigh = notifs.find(n => n.type === 'feedback');
    ok('admin dostal ⚠️ feedback_low notifikáciu', !!nLow, JSON.stringify(notifs.slice(0, 3)));
    ok('low notifikácia nesie komentár', nLow && (nLow.body || '').includes('príliš nahlas'));
    ok('admin dostal 🌟 feedback notifikáciu (5★)', !!nHigh);

    // ── 5) summary ──
    const sum = (await j('/api/admin/feedback/summary?days=30', {}, adm)).d;
    ok('summary: 2 odpovede', sum && sum.responses === 2, JSON.stringify(sum));
    ok('summary: dist 2★=1, 5★=1', sum && sum.dist['2'] === 1 && sum.dist['5'] === 1);
    ok('summary: avg 3.5 + low 1', sum && sum.avg === 3.5 && sum.low === 1);
    ok('summary: eligible_base + response_rate', sum && sum.eligible_base >= 2 && sum.response_rate != null);
    ok('summary: latest nesie mená a komentáre', Array.isArray(sum.latest) && sum.latest.some(r => (r.comment || '').includes('nahlas')));

    // ── 6) statické kontroly ──
    const srvSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const cd = fs.readFileSync(path.join(__dirname, '..', 'public', 'client-dashboard.html'), 'utf8');
    ok('21-dňové okno v eligibilite', srvSrc.includes('ageD>=0 && ageD<=21'));
    ok('import účty vylúčené', srvSrc.includes("account_creation_type==='import'"));
    ok('UI: fbCard + hviezdičky + low vetva', cd.includes("id=\"fbCard\"") && cd.includes('fbRate(') && cd.includes('fbSubmitLow'));
    ok('UI: loadFeedbackCard v inite', cd.includes('loadFeedbackCard(me);'));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nFUNNEL-010: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
