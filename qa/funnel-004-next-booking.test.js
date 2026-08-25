/**
 * FUNNEL-004: po aktivácii členstva → ďalšia rezervácia
 * Testuje: /api/next-class/suggestions eligibilitu (platiaca bez budúcej rezervácie),
 * zhasnutie po rezervácii, nextBookingNudgeTick výber + stop podmienku.
 * FUNNEL-003 sanity: day-before reminder cieli len zajtrajšie rezervácie (kontrola kódu v teste nižšie).
 *
 * Spustenie:  node qa/funnel-004-next-booking.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4497;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-f004-'));

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name); } };

async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}

(async () => {
  console.log('FUNNEL-004 QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, NEXT_NUDGE_MIN_MIN: '0', RATE_LIMIT_OFF: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    // 0) statická kontrola: day-before reminder má dátumový filter (FUNNEL-003 fix)
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    ok('day-before reminder filtruje booking_date', src.includes("booking_date:tomorrowStr"));
    ok('day-of notifikácia class_today existuje', src.includes("type:'class_today'"));

    // 1) klientka + admin
    const jar = {};
    await j('/api/register', { method: 'POST', body: { name: 'Qa Clenka', email: 'qa.clenka@qa-biz.local', password: 'Heslo123!', consent: true, city: 'Detva' } }, jar);
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } }, adm);

    // 2) bez členstva → karta sa nezobrazuje
    const s0 = await j('/api/next-class/suggestions', {}, jar);
    ok('bez členstva eligible=false', s0.d && s0.d.eligible === false);

    // 3) admin jej daruje/zapíše platené členstvo (bez platby v teste — priamy zápis do DB by
    //    obišiel server, preto použijeme admin endpoint na členstvo s cenou)
    const uu = await j('/api/admin/leads?search=qa.clenka', {}, adm);
    const uid = (uu.d.leads || [])[0] && ((uu.d.leads)[0]._id || (uu.d.leads)[0].id);
    ok('klientka nájdená v admin zozname', !!uid);
    const gift = await j('/api/admin/users/' + uid + '/grant-membership', { method: 'POST', body: { plan_id: 'bronze', gift: false, payment_method: 'cash', amount: 50 } }, adm);
    const giftOk = gift.status < 300;
    ok('členstvo zapísané (admin, cash 50 €)', giftOk);

    if (giftOk) {
      // 4) teraz eligible=true + termíny
      const s1 = await j('/api/next-class/suggestions', {}, jar);
      ok('po aktivácii eligible=true', s1.d && s1.d.eligible === true && s1.d.items.length > 0);

      // 5) nudge tick ju vyberie (MIN=0), mail lokálne nejde von
      const n1 = await j('/api/admin/qa/run-next-booking-nudge', { method: 'POST' }, adm);
      ok('nudge vyberá členku bez rezervácie', (n1.d.selected || []).includes('qa.clenka@qa-biz.local'));
      ok('mail sa lokálne neodoslal (gate)', (n1.d.sent || 0) === 0);

      // 6) rezervácia → karta zmizne aj nudge prestane
      const bk = await j('/api/bookings', { method: 'POST', body: { class_id: s1.d.items[0].class_id } }, jar);
      ok('rezervácia ok', bk.d && (bk.d.ok || bk.d.id));
      const s2 = await j('/api/next-class/suggestions', {}, jar);
      ok('po rezervácii eligible=false', s2.d && s2.d.eligible === false);
      const n2 = await j('/api/admin/qa/run-next-booking-nudge', { method: 'POST' }, adm);
      ok('nudge po rezervácii nevyberá', !(n2.d.selected || []).includes('qa.clenka@qa-biz.local'));
    }
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nFUNNEL-004: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
