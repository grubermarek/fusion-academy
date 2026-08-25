/**
 * FUNNEL-012: mail click-tracking + výkonnosť mailov (revenue per šablóna)
 * Server beží s MAIL_CAPTURE=1 → maily sa logujú a linky prepisujú, nič sa neposiela.
 * Overuje: prepis linkov na /api/mail/click/<log>/<idx>, redirect + zápis kliknutia,
 * click_count, last-click atribúciu nákupu v /api/admin/mail-performance,
 * šablóny first_booking_welcome (s .ics linkom) aj booking_confirm.
 *
 * Spustenie:  node qa/funnel-012-mail-clicks.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4503;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-f012-'));

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
// NeDB súbor: posledný riadok pre dané _id vyhráva
function mailLogs() {
  try {
    const rows = {};
    for (const line of fs.readFileSync(path.join(DATA, 'mail_log.db'), 'utf8').trim().split('\n')) {
      try { const d = JSON.parse(line); if (d._id) rows[d._id] = { ...rows[d._id], ...d }; } catch (e) {}
    }
    return Object.values(rows);
  } catch (e) { return []; }
}

(async () => {
  console.log('FUNNEL-012 QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } }, adm);

    // ── 1) prvá rezervácia → first_booking_welcome s prepísanými linkami + .ics ──
    const jar = {};
    await j('/api/register', { method: 'POST', body: { name: 'Qa Klikova', email: 'qa.click@qa-biz.local', password: 'Heslo123!', consent: true, city: 'Detva' } }, jar);
    const sug = (await j('/api/first-class/suggestions', {}, jar)).d;
    const bk = await j('/api/bookings', { method: 'POST', body: { class_id: sug.items[0].class_id } }, jar);
    ok('prvá rezervácia ok', bk.d && (bk.d.ok || bk.d.id));
    await new Promise(r => setTimeout(r, 700));
    const log = mailLogs().find(l => l.template === 'first_booking_welcome' && l.to === 'qa.click@qa-biz.local');
    ok('welcome mail so šablónou first_booking_welcome', !!log, JSON.stringify(mailLogs().map(l => l.template)));
    ok('linky uložené v mail_logu', log && Array.isArray(log.links) && log.links.length >= 1, log && JSON.stringify(log.links));
    const calIdx = log ? log.links.findIndex(u => u.includes('/cal/booking/')) : -1;
    ok('kalendárny .ics link medzi cieľmi (011 medzera doplnená)', calIdx >= 0, log && JSON.stringify(log.links));

    // ── 2) klik → 302 na pôvodný cieľ + zápis clicked_at ──
    const r1 = await fetch(BASE + '/api/mail/click/' + log._id + '/' + calIdx, { redirect: 'manual' });
    ok('klik → 302', r1.status >= 300 && r1.status < 400, String(r1.status));
    ok('redirect na pôvodný cieľ', String(r1.headers.get('location') || '').includes('/cal/booking/'), r1.headers.get('location'));
    await new Promise(r => setTimeout(r, 400));
    let l2 = mailLogs().find(l => l._id === log._id);
    ok('clicked_at zapísané', !!(l2 && l2.clicked_at));
    ok('klik počíta aj ako otvorenie', !!(l2 && l2.opened_at));
    const firstClickAt = l2 && l2.clicked_at;
    await fetch(BASE + '/api/mail/click/' + log._id + '/' + calIdx, { redirect: 'manual' });
    await new Promise(r => setTimeout(r, 400));
    l2 = mailLogs().find(l => l._id === log._id);
    ok('click_count=2, clicked_at nezmenené', l2 && l2.click_count === 2 && l2.clicked_at === firstClickAt, JSON.stringify(l2 && { c: l2.click_count, at: l2.clicked_at }));
    ok('neznámy id → redirect (nie pád)', (await fetch(BASE + '/api/mail/click/nezname/0', { redirect: 'manual' })).status >= 300);

    // ── 3) nákup PO kliku → last-click atribúcia ──
    const _u = ((await j('/api/admin/leads?search=qa.click', {}, adm)).d.leads || [])[0] || {};
    const uid = _u._id || _u.id;
    await j('/api/admin/users/' + uid + '/grant-membership', { method: 'POST', body: { plan_id: 'bronze', gift: false, payment_method: 'cash', amount: 50 } }, adm);

    // ── 4) druhá rezervácia (už s členstvom) → booking_confirm ──
    const b2 = await j('/api/bookings', { method: 'POST', body: { class_id: (sug.items[1] || sug.items[0]).class_id } }, jar);
    ok('druhá rezervácia ok', b2.d && (b2.d.ok || b2.d.id), JSON.stringify(b2.d));
    await new Promise(r => setTimeout(r, 700));
    ok('booking_confirm mail zalogovaný', mailLogs().some(l => l.template === 'booking_confirm' && l.to === 'qa.click@qa-biz.local'));

    // ── 5) mail-performance ──
    const perf = (await j('/api/admin/mail-performance?days=7', {}, adm)).d;
    ok('mail-performance ok + last_click_7d', perf && perf.ok && perf.attribution === 'last_click_7d');
    const row = (perf.rows || []).find(r => r.template === 'first_booking_welcome');
    ok('riadok first_booking_welcome', !!row, JSON.stringify(perf.rows));
    ok('sent=1, clicked=1, clicks=2', row && row.sent === 1 && row.clicked === 1 && row.clicks === 2, JSON.stringify(row));
    ok('buyers=1, revenue=50 (last click)', row && row.buyers === 1 && row.revenue === 50, JSON.stringify(row));
    const rowBc = (perf.rows || []).find(r => r.template === 'booking_confirm');
    ok('booking_confirm bez kliknutí → bez revenue', rowBc && rowBc.sent === 1 && rowBc.revenue === 0, JSON.stringify(rowBc));

    // ── 6) statické kontroly ──
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const nTemplates = (src.match(/template:'/g) || []).length;
    ok('šablóny otagované na 14+ mailoch', nTemplates >= 14, String(nTemplates));
    ok('sekvencie majú šablónu sequence#dX', src.includes("template:step.sequence+'#d'"));
    ok('prepis linkov bez open-redirectu (index, nie URL v query)', src.includes("'/api/mail/click/'+log._id+'/'+idx"));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nFUNNEL-012: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
