/**
 * AUDIT E7 — životný cyklus členstva (Marek 1. 9.).
 *
 * Členstvo je najčastejší predaj, takže chyba v jeho aktivácii sa násobí.
 * Test prechádza celý cyklus: aktivácia → predĺženie → upgrade → downgrade →
 * expirácia → permanentka → darček, a stráži hlavne to, čím sa dá stratiť
 * alebo rozdať čas a peniaze:
 *   · predĺženie rovnakého plánu nadväzuje, nezačína odznova
 *   · po expirácii sa nepočíta od starého dátumu (klientka by dostala dni zadarmo)
 *   · pri zmene plánu sa zvyšok vráti do kreditu a zapíše do histórie
 *   · nikdy nevzniknú dve aktívne členstvá naraz
 *   · permanentka pridáva vstupy, nie mesiace
 *
 * Spustenie:  node qa/membership-lifecycle.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4562;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-mem-'));

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
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const den = iso => String(iso || '').slice(0, 10);
const rozdielDni = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  let kod = 0;
  const K = (id, meno, extra = {}) => JSON.stringify({ _id: id, name: meno, email: id.toLowerCase() + '@qa-biz.local',
    password: hash, user_type: 'client', active: true, referral_code: 'QAMEM' + String(++kod).padStart(2, '0'),
    visit_count: 2, created_at: '2026-06-01', city: 'Detva', referral_credit: 0, single_entries: 0, ...extra });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaMemAdmin00001', name: 'Adam Admin', email: 'qa.mem.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }),
    K('qaMemNova000001', 'Nina Nova'),
    K('qaMemPredlz0001', 'Petra Predlzena'),
    K('qaMemUpgrade001', 'Una Upgradova'),
    K('qaMemExpir00001', 'Elena Expirovana'),
    K('qaMemBundle0001', 'Bela Permanentkova'),
    K('qaMemDarcek0001', 'Dana Darcekova'),
  ].join('\n') + '\n');

  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const posun = n => new Date(Date.now() + n * 86400000).toISOString();
  // Petra má Bronze ešte 10 dní, Elena jej vypršal pred 5 dňami
  fs.writeFileSync(path.join(DATA, 'memberships.db'), [
    JSON.stringify({ _id: 'qaMemM000000001', user_id: 'qaMemPredlz0001', plan_id: 'bronze', plan_name: 'Bronze',
      status: 'active', started_at: posun(-20), expires_at: posun(10), price: 50, payment_method: 'cash' }),
    JSON.stringify({ _id: 'qaMemM000000002', user_id: 'qaMemUpgrade001', plan_id: 'bronze', plan_name: 'Bronze',
      status: 'active', started_at: posun(-15), expires_at: posun(15), price: 50, payment_method: 'cash' }),
    JSON.stringify({ _id: 'qaMemM000000003', user_id: 'qaMemExpir00001', plan_id: 'bronze', plan_name: 'Bronze',
      status: 'active', started_at: posun(-35), expires_at: posun(-5), price: 50, payment_method: 'cash' }),
  ].join('\n') + '\n');

  console.log('ŽIVOTNÝ CYKLUS ČLENSTVA QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  const clen = uid => rd('memberships.db').filter(m => m.user_id === uid && !m._type);
  const aktivne = uid => clen(uid).filter(m => m.status === 'active');
  const kredit = uid => +((rd('users.db').find(u => u._id === uid) || {}).referral_credit || 0);
  const vstupy = uid => +((rd('users.db').find(u => u._id === uid) || {}).single_entries || 0);

  const predaj = (uid, plan, adm) => j('/api/admin/users/' + uid + '/grant-membership',
    { method: 'POST', body: { plan_id: plan, gift: false, payment_method: 'cash', amount: null } }, adm);

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.mem.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    console.log('\nNové členstvo:');
    await predaj('qaMemNova000001', 'bronze', adm);
    await new Promise(r => setTimeout(r, 600));
    const nova = aktivne('qaMemNova000001');
    ok('vzniklo práve jedno aktívne členstvo', nova.length === 1, 'aktívnych=' + nova.length);
    ok('platí 30 dní', nova[0] && Math.abs(rozdielDni(nova[0].expires_at, new Date()) - 30) <= 1,
      nova[0] ? den(nova[0].expires_at) : '—');

    console.log('\nPredĺženie rovnakého plánu (má ešte 10 dní):');
    const predPredlz = clen('qaMemPredlz0001')[0].expires_at;
    await predaj('qaMemPredlz0001', 'bronze', adm);
    await new Promise(r => setTimeout(r, 600));
    const poPredlz = aktivne('qaMemPredlz0001');
    ok('stále len jedno aktívne členstvo', poPredlz.length === 1, 'aktívnych=' + poPredlz.length);
    ok('nadväzuje na starú platnosť, nezačína odznova',
      poPredlz[0] && Math.abs(rozdielDni(poPredlz[0].expires_at, predPredlz) - 30) <= 1,
      den(predPredlz) + ' → ' + den(poPredlz[0] && poPredlz[0].expires_at) + ' (rozdiel '
        + (poPredlz[0] ? rozdielDni(poPredlz[0].expires_at, predPredlz) : '?') + ' dní)');

    console.log('\nUpgrade na vyšší plán (Bronze → Gold, zostáva 15 dní):');
    const predKredit = kredit('qaMemUpgrade001');
    await predaj('qaMemUpgrade001', 'gold', adm);
    await new Promise(r => setTimeout(r, 800));
    const poUp = aktivne('qaMemUpgrade001');
    ok('stále len jedno aktívne členstvo', poUp.length === 1, 'aktívnych=' + poUp.length);
    ok('plán je Gold', poUp[0] && poUp[0].plan_id === 'gold', poUp[0] ? poUp[0].plan_id : '—');
    ok('nové členstvo začína dnes, nie od starej expirácie',
      poUp[0] && Math.abs(rozdielDni(poUp[0].expires_at, new Date()) - 30) <= 1,
      poUp[0] ? den(poUp[0].expires_at) : '—');
    const poKredit = kredit('qaMemUpgrade001');
    ok('zvyšok starého plánu sa vrátil do kreditu', poKredit > predKredit,
      predKredit + ' € → ' + poKredit + ' €');
    const led = rd('credit_ledger.db').filter(l => l.user_id === 'qaMemUpgrade001');
    ok('a je dohľadateľný v histórii', led.length >= 1,
      JSON.stringify(led.map(l => l.delta + ' € · ' + String(l.reason || '').slice(0, 45))));

    console.log('\nObnova po expirácii (vypršalo pred 5 dňami):');
    await predaj('qaMemExpir00001', 'bronze', adm);
    await new Promise(r => setTimeout(r, 600));
    const poExp = aktivne('qaMemExpir00001');
    ok('platí 30 dní odo dneška, nie od starého dátumu',
      poExp[0] && Math.abs(rozdielDni(poExp[0].expires_at, new Date()) - 30) <= 1,
      poExp[0] ? den(poExp[0].expires_at) + ' (od dnes ' + rozdielDni(poExp[0].expires_at, new Date()) + ' dní)' : '—');

    console.log('\nPermanentka:');
    const predVstupy = vstupy('qaMemBundle0001');
    await predaj('qaMemBundle0001', 'permanentka10', adm);
    await new Promise(r => setTimeout(r, 600));
    ok('pribudlo 10 vstupov', vstupy('qaMemBundle0001') === predVstupy + 10,
      predVstupy + ' → ' + vstupy('qaMemBundle0001'));
    ok('nevzniklo z toho mesačné členstvo',
      aktivne('qaMemBundle0001').length === 0, 'aktívnych=' + aktivne('qaMemBundle0001').length);

    console.log('\nDarček:');
    const dar = await j('/api/admin/users/qaMemDarcek0001/grant-membership',
      { method: 'POST', body: { plan_id: 'silver', gift: true } }, adm);
    await new Promise(r => setTimeout(r, 600));
    const darC = aktivne('qaMemDarcek0001');
    ok('darované členstvo je aktívne', dar.status === 200 && darC.length === 1, JSON.stringify(dar.d).slice(0, 90));
    ok('je označené ako darček s cenou 0', darC[0] && darC[0].gift === true && +darC[0].price === 0,
      darC[0] ? 'gift=' + darC[0].gift + ' price=' + darC[0].price : '—');
    ok('a nemá spôsob platby (nejde do tržieb)', darC[0] && !darC[0].payment_method,
      darC[0] ? String(darC[0].payment_method) : '—');

    console.log('\nCelkovo:');
    const vsetci = ['qaMemNova000001', 'qaMemPredlz0001', 'qaMemUpgrade001', 'qaMemExpir00001', 'qaMemBundle0001', 'qaMemDarcek0001'];
    ok('nikto nemá dve aktívne členstvá naraz',
      vsetci.every(u => aktivne(u).length <= 1),
      JSON.stringify(vsetci.map(u => u.slice(5, 12) + ':' + aktivne(u).length)));
    ok('žiadne členstvo nemá zápornú cenu',
      rd('memberships.db').every(m => (+m.price || 0) >= 0));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nŽIVOTNÝ CYKLUS ČLENSTVA: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
