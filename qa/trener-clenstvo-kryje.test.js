/**
 * Trénerský zápis „kryté členstvom" musí členstvo naozaj overiť (Marek 1. 9.).
 *
 * Soňa a Radka mali Online Basic a v zozname im pribúdali FYZICKÉ hodiny ako
 * kryté členstvom — online plán pritom živé hodiny nekryje. Samoobslužná
 * rezervácia to kontroluje roky, trénerský zápis nie: stačilo kliknúť.
 *
 * Spustenie:  node qa/trener-clenstvo-kryje.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4551;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-kry-'));

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

const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
const DOW = new Date().getDay();

let poc = 0;
const U = (id, meno, extra = {}) => JSON.stringify({ _id: id, name: meno, email: id.toLowerCase() + '@qa-biz.local',
  password: '', user_type: 'client', active: true, rank: 1, referral_code: 'QAK' + String(++poc).padStart(3, '0'),
  visit_count: 5, created_at: '2026-06-01', city: 'Detva', free_class_used: true,
  free_credits: 0, single_entries: 0, ...extra });

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaKryTrener0001', name: 'Tana Trenerka', email: 'qa.kry.trener@qa-biz.local',
      password: hash, user_type: 'trainer', active: true, rank: 1, referral_code: 'QAKTR', created_at: '2026-01-01' }),
    U('qaKryOnline0001', 'Olga Onlinova'),      // len Online Basic
    U('qaKryBronz00001', 'Blanka Bronzova'),    // Bronze — živé hodiny kryje
    U('qaKryBezNic0001', 'Bara Bezniceho'),     // žiadne členstvo
    U('qaKryVstupy0001', 'Vlasta Vstupova', { single_entries: 3 }),
  ].join('\n') + '\n');

  fs.writeFileSync(path.join(DATA, 'memberships.db'), [
    JSON.stringify({ _id: 'qaKryMem00000001', user_id: 'qaKryOnline0001', plan_id: 'online_basic',
      plan_name: 'Online Basic', status: 'active', started_at: '2026-08-01', expires_at: '2026-12-31', price: 12.9 }),
    JSON.stringify({ _id: 'qaKryMem00000002', user_id: 'qaKryBronz00001', plan_id: 'bronze',
      plan_name: 'Bronze', status: 'active', started_at: '2026-08-01', expires_at: '2026-12-31', price: 50 }),
  ].join('\n') + '\n');

  const C = (id, meno, extra = {}) => JSON.stringify({ _id: id, name: meno, emoji: '🎵', category: 'Zumba',
    instructor: 'Tana Trenerka', location: 'Detva', address: 'Záhradná 7', day_of_week: DOW,
    time_start: '18:00', time_end: '19:00', capacity: 30, level: 'Všetky úrovne', price: 10, active: true, ...extra });
  fs.writeFileSync(path.join(DATA, 'classes.db'), [
    C('qaKryClsZiva001', 'Zumba Detva'),
    C('qaKryClsOnline1', 'Zumba ONLINE', { category: 'Online', location: 'Online' }),
  ].join('\n') + '\n');

  console.log('KRYTIE ČLENSTVOM QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  try {
    const tr = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.kry.trener@qa-biz.local', password: 'Heslo123!' } }, tr);
    ok('tréner prihlásený', lg.status === 200, JSON.stringify(lg.d));

    const zapis = (uid, cid, method) => j('/api/attendance/manual-booking',
      { method: 'POST', body: { user_id: uid, class_id: cid, booking_date: DNES, ...(method ? { method } : {}) } }, tr);

    console.log('\nŽivá hodina:');
    const a = await zapis('qaKryOnline0001', 'qaKryClsZiva001', 'membership');
    ok('Online Basic ŽIVÚ hodinu nekryje', a.status === 400 && a.d.error === 'online_nekryje_zivu_hodinu', JSON.stringify(a.d));
    ok('a hláška povie, čo spraviť', /platí na mieste/i.test((a.d && a.d.message) || ''), (a.d && a.d.message) || '');

    const b = await zapis('qaKryBezNic0001', 'qaKryClsZiva001', 'membership');
    ok('bez členstva to neprejde vôbec', b.status === 400 && b.d.error === 'bez_clenstva', JSON.stringify(b.d));

    const c = await zapis('qaKryBronz00001', 'qaKryClsZiva001', 'membership');
    ok('Bronze živú hodinu kryje', c.status === 200 && c.d.ok, JSON.stringify(c.d));

    console.log('\nOnline hodina:');
    const d = await zapis('qaKryOnline0001', 'qaKryClsOnline1', 'membership');
    ok('Online Basic ONLINE hodinu kryje', d.status === 200 && d.d.ok, JSON.stringify(d.d));

    console.log('\nOstatné spôsoby ostávajú:');
    const e = await zapis('qaKryOnline0001', 'qaKryClsZiva001', 'pay_on_site');
    ok('platba na mieste prejde', e.status === 200 && e.d.ok, JSON.stringify(e.d));
    const f = await zapis('qaKryVstupy0001', 'qaKryClsZiva001', 'single_entry');
    ok('vstup z permanentky prejde', f.status === 200 && f.d.ok, JSON.stringify(f.d));
    const g = await zapis('qaKryBezNic0001', 'qaKryClsZiva001', 'free');
    ok('darovanie hodiny prejde', g.status === 200 && g.d.ok, JSON.stringify(g.d));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nKRYTIE ČLENSTVOM: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
