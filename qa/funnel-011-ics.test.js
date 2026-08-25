/**
 * FUNNEL-011: „Pridať do kalendára" — .ics v potvrdzovacích mailoch rezervácie
 * Overuje: /cal/booking/:id.ics obsah (SUMMARY, DTSTART, LOCATION, VALARM),
 * 404 pre zrušenú/neexistujúcu rezerváciu, linky vo všetkých 4 mailoch (statické).
 *
 * Spustenie:  node qa/funnel-011-ics.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4502;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-f011-'));

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
const ics = async id => { const r = await fetch(BASE + '/cal/booking/' + id + '.ics'); return { status: r.status, ct: r.headers.get('content-type') || '', body: await r.text() }; };

(async () => {
  console.log('FUNNEL-011 QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    // ── 1) authed rezervácia (prvá hodina zdarma) → .ics ──
    const jar = {};
    await j('/api/register', { method: 'POST', body: { name: 'Qa Kalendarova', email: 'qa.ics@qa-biz.local', password: 'Heslo123!', consent: true, city: 'Detva' } }, jar);
    const sug = (await j('/api/first-class/suggestions', {}, jar)).d;
    const bk = await j('/api/bookings', { method: 'POST', body: { class_id: sug.items[0].class_id } }, jar);
    ok('rezervácia vytvorená', bk.d && (bk.d.ok || bk.d.id), JSON.stringify(bk.d));
    const bid = bk.d.id;
    const f1 = await ics(bid);
    ok('.ics 200 + text/calendar', f1.status === 200 && f1.ct.includes('text/calendar'), f1.status + ' ' + f1.ct);
    ok('.ics nesie SUMMARY s hodinou', f1.body.includes('SUMMARY:') && f1.body.includes('Fusion Academy'));
    ok('.ics DTSTART = dátum rezervácie', f1.body.includes('DTSTART:' + String(bk.d.booking_date).replace(/-/g, '') + 'T'));
    ok('.ics má DTEND', /DTEND:\d{8}T\d{6}/.test(f1.body));
    ok('.ics má pripomienku 2 h vopred (VALARM)', f1.body.includes('BEGIN:VALARM') && f1.body.includes('TRIGGER:-PT2H'));
    ok('.ics má LOCATION', /LOCATION:.+/.test(f1.body));

    // ── 2) zrušená rezervácia → 404 ──
    const del = await j('/api/bookings/' + bid, { method: 'DELETE' }, jar);
    ok('zrušenie rezervácie prešlo', del.status < 300, JSON.stringify(del.d));
    const f2 = await ics(bid);
    ok('.ics zrušenej rezervácie → 404', f2.status === 404);
    ok('.ics neexistujúceho id → 404', (await ics('neexistuje123456')).status === 404);

    // ── 3) landing rezervácia → .ics tiež funguje ──
    const sched = await j('/api/first-class/schedule?city=detva');
    const slot = (sched.d.items || [])[0];
    const lb = await j('/api/first-class/book', { method: 'POST', body: {
      name: 'Qa Landicova', email: 'qa.ics2@qa-biz.local', phone: '', class_id: slot.class_id, booking_date: slot.date, attribution: {} } });
    ok('landing booking prešiel', lb.d && lb.d.ok, JSON.stringify(lb.d));
    const f3 = await ics(lb.d.booking_id);
    ok('.ics landing rezervácie 200', f3.status === 200 && f3.body.includes('BEGIN:VEVENT'));

    // ── 4) statické kontroly: linky v mailoch ──
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const sites = (src.match(/\/cal\/booking\//g) || []).length;
    ok('link v 5 mailoch + endpoint (6 výskytov)', sites === 6, String(sites));
    ok('first-booking welcome mail má kalendárny link', /sendFirstBookingWelcome[\s\S]{0,3000}\/cal\/booking\//.test(src));
    ok('reminder mail má kalendárny link', /Zajtra máš hodinu[\s\S]{0,900}\/cal\/booking\//.test(src));
    ok('landing confirm mail má kalendárny link', /Prvá hodina zdarma je rezervovaná[\s\S]{0,1400}\/cal\/booking\//.test(src));
    ok('in-app booking mail má kalendárny link', /Rezervácia potvrdená – \$\{cls\.name\}[\s\S]{0,900}\/cal\/booking\//.test(src));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nFUNNEL-011: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
