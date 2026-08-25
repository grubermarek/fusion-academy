/**
 * FUNNEL-002: acquisition landing /prva-hodina
 * Testuje: verejný rozvrh podľa mesta, rezerváciu z landingu (konto na pozadí,
 * self_registration + atribúcia, free_class), dedupe existujúceho kontaktu,
 * dvojitú rezerváciu, kapacitné a zrušené hodiny nechávame na guest testoch.
 *
 * Spustenie:  node qa/funnel-002-landing.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4498;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-f002-'));

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name); } };
const j = async (url, opts = {}) => {
  const r = await fetch(BASE + url, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
};

(async () => {
  console.log('FUNNEL-002 QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    // 1) stránka + rozvrh
    const page = await fetch(BASE + '/prva-hodina?city=zvolen');
    ok('stránka /prva-hodina je 200', page.status === 200);
    const sc = await j('/api/first-class/schedule?city=zvolen');
    ok('rozvrh ok', sc.d && sc.d.ok);
    ok('rozvrh vracia len Zvolen', sc.d.items.length > 0 && sc.d.items.every(i => i.city === 'Zvolen'));
    ok('rozvrh pozná všetky mestá', (sc.d.cities || []).length >= 3);
    const sess = sc.d.items[0];

    // 2) rezervácia z landingu — nové konto na pozadí
    const bk = await j('/api/first-class/book', { method: 'POST', body: {
      name: 'Qa Landingova', email: 'qa.landing@qa-biz.local', phone: '0900 111 222',
      class_id: sess.class_id, booking_date: sess.date,
      attribution: { utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'zumba_zvolen_first_class', fbclid: 'fb.test.1', landing: '/prva-hodina?city=zvolen' } } });
    ok('rezervácia ok + is_new', bk.d && bk.d.ok && bk.d.is_new === true);
    ok('detail v odpovedi', bk.d.detail && bk.d.detail.city === 'Zvolen' && !!bk.d.detail.time_start);

    // 3) používateľka v DB: self_registration + atribúcia + free_class booking
    const udb = fs.readFileSync(path.join(DATA, 'users.db'), 'utf8').split('\n').filter(l => l.includes('qa.landing@qa-biz.local')).pop();
    const u = JSON.parse(udb);
    ok('account_creation_type=self_registration', u.account_creation_type === 'self_registration');
    ok('registration_at actual', !!u.registration_at && u.registration_at_source === 'actual');
    ok('utm_campaign uložená', u.utm_campaign === 'zumba_zvolen_first_class');
    ok('fbclid uložený + lead_source=meta', u.fbclid === 'fb.test.1' && u.lead_source === 'meta');
    ok('mesto z hodiny', u.city === 'Zvolen');
    ok('free_class_used po rezervácii', u.free_class_used === true);
    const bdb = fs.readFileSync(path.join(DATA, 'bookings.db'), 'utf8').split('\n').filter(l => l.includes(u._id)).pop();
    const b = JSON.parse(bdb);
    ok('booking confirmed + free_class + source', b.status === 'confirmed' && b.free_class === true && b.source === 'prva-hodina');

    // 4) duplicitná rezervácia toho istého termínu → 409
    const dup = await j('/api/first-class/book', { method: 'POST', body: { name: 'Qa Landingova', email: 'qa.landing@qa-biz.local', class_id: sess.class_id, booking_date: sess.date } });
    ok('duplicitný termín odmietnutý', dup.status === 409);

    // 5) druhá „prvá zdarma" na iný termín → 409 (free_class_used)
    const other = sc.d.items.find(i => i.class_id !== sess.class_id) || sess;
    const dup2 = await j('/api/first-class/book', { method: 'POST', body: { name: 'Qa Landingova', email: 'qa.landing@qa-biz.local', class_id: other.class_id, booking_date: other.date } });
    ok('druhá prvá-zadarmo odmietnutá (existing)', dup2.status === 409 && dup2.d && dup2.d.existing === true);

    // 6) validácie
    const bad = await j('/api/first-class/book', { method: 'POST', body: { name: 'X', email: 'zly-mail', class_id: sess.class_id } });
    ok('validácia mena/e-mailu', bad.status === 400);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nFUNNEL-002: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
