/**
 * Mesačná súťaž: rátajú sa len hodiny, ktoré sa naozaj konali (Marek 1. 9.).
 *
 * 1. septembra o polnoci appka písala klientkam „odchodené dve hodiny" za hodiny,
 * na ktoré sa len prihlásili — rezervácia na budúcu hodinu má rovnaký status
 * 'confirmed' ako odchodená. Test stráži, aby sa to nevrátilo, a to na oboch
 * miestach, kde sa hodiny rátajú: v rebríčku aj v detaile klientky.
 *
 * Spustenie:  node qa/sutaz-buduce-hodiny.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4543;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-hod-'));

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
const MESIAC = DNES.slice(0, 7);
const posun = n => new Date(Date.parse(DNES + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const VCERA = posun(-1), ZAJTRA = posun(1), OZAJTRA = posun(2);

let poc = 0;
const U = (id, meno) => JSON.stringify({ _id: id, name: meno, email: id.toLowerCase() + '@qa-biz.local',
  password: '', user_type: 'client', active: true, rank: 1, referral_code: 'QAH' + String(++poc).padStart(3, '0'),
  visit_count: 2, created_at: '2026-06-01', city: 'Detva' });

let bkPoc = 0;
const B = (uid, datum, extra = {}) => JSON.stringify({
  _id: 'qaHodBk' + String(++bkPoc).padStart(8, '0'), user_id: uid, class_id: 'qaHodCls000001',
  class_name: 'Zumba Detva', class_location: 'Detva', booking_date: datum, status: 'confirmed',
  created_at: '2026-08-20T10:00:00.000Z', ...extra,
});

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaHodAdmin00001', name: 'Adam Admin', email: 'qa.hod.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-06-01' }),
    U('qaHodBuduce001', 'Barbora Buduca'),     // len rezervácie na budúce hodiny
    U('qaHodMinule001', 'Milada Minula'),      // hodiny, ktoré už boli
    U('qaHodDnesna001', 'Dana Dnesna'),        // dnešná hodina, tréner ju potvrdil
    U('qaHodZrusena001', 'Zuzana Zrusena'),    // zrušená rezervácia
  ].join('\n') + '\n');

  fs.writeFileSync(path.join(DATA, 'bookings.db'), [
    // Barbora sa prihlásila na dve budúce hodiny — do súťaže sa jej rátať nesmú
    B('qaHodBuduce001', ZAJTRA), B('qaHodBuduce001', OZAJTRA),
    // Milade hodina už prebehla, hoci ju tréner nepotvrdil
    B('qaHodMinule001', VCERA),
    // Dana má dnešnú hodinu a tréner ju odklikol → ráta sa hneď
    B('qaHodDnesna001', DNES, { attendance_status: 'attended' }),
    // Zuzana rezerváciu zrušila
    B('qaHodZrusena001', VCERA, { status: 'cancelled' }),
  ].join('\n') + '\n');

  console.log('SÚŤAŽ — BUDÚCE HODINY QA — štart servera…');
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
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.hod.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    console.log('\nRebríček súťaže:');
    // Rozsah berieme od včera po pozajtra, nie kalendárny mesiac — inak by test
    // 1. dňa v mesiaci nezachytil včerajšiu hodinu a tváril sa, že chýba.
    const OD = VCERA, DO = posun(3);
    const lb = await j('/api/admin/points-summary?from=' + OD + '&to=' + DO, {}, adm);
    const rows = (lb.d && (lb.d.rows || lb.d.items || lb.d.list)) || [];
    ok('rebríček odpovedá', lb.status === 200 && Array.isArray(rows), JSON.stringify(lb.d).slice(0, 120));

    const najdi = meno => rows.find(r => new RegExp(meno, 'i').test(r.name || r.user_name || ''));
    const bar = najdi('Barbora'), mil = najdi('Milada'), dan = najdi('Dana'), zuz = najdi('Zuzana');
    ok('kto má len budúce rezervácie, má 0 hodín',
      !bar || (bar.hours || 0) === 0, bar ? JSON.stringify({ h: bar.hours, b: bar.points }) : 'nie je v rebríčku');
    ok('odchodená hodina sa ráta', mil && (mil.hours || 0) === 1, mil ? String(mil.hours) : 'chýba');
    ok('dnešná potvrdená hodina sa ráta hneď', dan && (dan.hours || 0) === 1, dan ? String(dan.hours) : 'chýba');
    ok('zrušená sa neráta', !zuz || (zuz.hours || 0) === 0, zuz ? String(zuz.hours) : 'nie je v rebríčku');

    console.log('\nČo z toho vyplýva:');
    ok('kto sa len prihlásil, nemá ani body',
      !bar || ((bar.hours || 0) === 0 && (bar.total || 0) === 0),
      bar ? JSON.stringify({ hodiny: bar.hours, body: bar.total }) : 'nie je v rebríčku');
    ok('kto naozaj bol, body má', mil && (mil.total || 0) > 0, mil ? String(mil.total) : 'chýba');

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nBUDÚCE HODINY: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
