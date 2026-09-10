/**
 * Online hodina sa musí zapísať tomu, kto sa na ňu pripojí (10. 9. 2026).
 *
 * Soňa Moskálová: „Ani za online hodinu, čo som si vytočila." Vyhrala v kolese
 * online hodinu, pripojila sa na ňu 6. aj 7. 9. — pass sa jej minul, prístup
 * dostala, ale nezarátalo sa nič. Body aj návštevy sa totiž rátajú výhradne
 * z rezervácií a pripojenie žiadnu nevytváralo. Kto si hodinu vopred
 * nerezervoval, akoby tam nebol.
 *
 * Stráži, že:
 *   · pripojenie cez výherný pass vytvorí odchodenú rezerváciu a návštevu
 *   · druhé pripojenie v ten istý deň nezaráta nič navyše
 *   · komu hodina už rezervovaná bola, tomu sa len označí za odchodenú
 *   · pripojenie s plným online členstvom sa zapíše tiež
 *   · zrušený termín nezapíše nič
 *   · hodina sa započíta do mesačných bodov ako online
 *
 * Spustenie:  node qa/online-ucast.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4594;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-online-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts, jar) {
  opts = opts || {};
  const headers = { 'Content-Type': 'application/json' };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const dnes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const den = new Date(dnes + 'T12:00:00Z').getUTCDay();

  w('users.db', [
    { _id: 'qaOnAdmin000001', name: 'Marek Gruber', email: 'qa.on.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    // vyhrala online hodinu v kolese, členstvo nemá
    { _id: 'qaOnPass0000001', name: 'Soňa Passová', email: 'qa.on.pass@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-07-01',
      free_class_used: true, visit_count: 10, online_passes: 1, single_entries: 0 },
    // má hodinu rezervovanú vopred
    { _id: 'qaOnRezerv00001', name: 'Rezervovaná Klientka', email: 'qa.on.rez@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-07-01',
      free_class_used: true, visit_count: 5, online_passes: 1 },
    // plné online členstvo
    { _id: 'qaOnClen0000001', name: 'Silverová Klientka', email: 'qa.on.clen@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-07-01',
      free_class_used: true, visit_count: 3 },
  ]);
  w('memberships.db', [{ _id: 'qaOnMem00000001', user_id: 'qaOnClen0000001', plan_id: 'silver',
    plan_name: 'Silver', status: 'active', price: 75, payment_method: 'cash',
    starts_at: '2026-09-01', expires_at: '2026-12-31T23:59:59.000Z', created_at: '2026-09-01' }]);
  w('classes.db', [
    { _id: 'qaOnTrieda00001', name: 'Zumba ONLINE – LIVE', emoji: '💻', category: 'Online',
      location: 'Online', day_of_week: den, time_start: '19:00', time_end: '20:00',
      capacity: 200, price: 0, active: true, instructor: 'Marek Gruber',
      stream_url: 'https://youtu.be/qa-test', stream_url_at: dnes },
    { _id: 'qaOnZrusena0001', name: 'Zumba ONLINE – LIVE', emoji: '💻', category: 'Online',
      location: 'Online', day_of_week: den, time_start: '20:30', time_end: '21:30',
      capacity: 200, price: 0, active: true, instructor: 'Marek Gruber',
      stream_url: 'https://youtu.be/qa-test2', stream_url_at: dnes },
  ]);
  w('class_cancellations.db', [{ _id: 'qaOnStorno00001', class_id: 'qaOnZrusena0001',
    date: dnes, reason: 'QA', created_at: '2026-09-10' }]);
  w('bookings.db', [{ _id: 'qaOnRez00000001', class_id: 'qaOnTrieda00001',
    class_name: 'Zumba ONLINE – LIVE', class_location: 'Online',
    user_id: 'qaOnRezerv00001', user_name: 'Rezervovaná Klientka', user_email: 'qa.on.rez@qa-biz.local',
    booking_date: dnes, status: 'confirmed', online: true, access_method: 'membership',
    created_at: dnes + 'T06:00:00.000Z' }]);

  console.log('ONLINE ÚČASŤ\n');

  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 9000));

  const pas = {}, rez = {}, clen = {}, adm = {};
  const rezOf = uid => rd('bookings.db').filter(b => b.user_id === uid && b.class_id === 'qaOnTrieda00001' && b.booking_date === dnes);
  const usr = uid => rd('users.db').find(u => u._id === uid);

  try {
    await j('/api/login', { method: 'POST', body: { email: 'qa.on.pass@qa-biz.local', password: 'Heslo123!' } }, pas);
    await j('/api/login', { method: 'POST', body: { email: 'qa.on.rez@qa-biz.local', password: 'Heslo123!' } }, rez);
    await j('/api/login', { method: 'POST', body: { email: 'qa.on.clen@qa-biz.local', password: 'Heslo123!' } }, clen);
    await j('/api/login', { method: 'POST', body: { email: 'qa.on.admin@qa-biz.local', password: 'Heslo123!' } }, adm);

    console.log('1) Pripojenie cez výhernú online hodinu:');
    const navstevPred = usr('qaOnPass0000001').visit_count;
    const r1 = await j('/api/online/enter', { method: 'POST', body: { class_id: 'qaOnTrieda00001' } }, pas);
    ok('pustí ju dnu a minie pass', r1.status === 200 && r1.d && r1.d.mode === 'pass', JSON.stringify(r1.d).slice(0, 140));
    await new Promise(r => setTimeout(r, 1200));
    const b1 = rezOf('qaOnPass0000001');
    ok('vznikla rezervácia', b1.length === 1, 'rezervácií: ' + b1.length);
    ok('a je označená za odchodenú', b1[0] && b1[0].attendance_status === 'attended' && b1[0].status === 'attended',
      b1[0] ? b1[0].status + '/' + b1[0].attendance_status : '—');
    ok('s krytím „výherná online hodina"', b1[0] && b1[0].access_method === 'online_pass', b1[0] && b1[0].access_method);
    ok('návšteva sa pripísala', usr('qaOnPass0000001').visit_count === navstevPred + 1,
      navstevPred + ' → ' + usr('qaOnPass0000001').visit_count);

    console.log('\n2) Druhé pripojenie v ten istý deň nič nezdvojí:');
    await j('/api/online/enter', { method: 'POST', body: { class_id: 'qaOnTrieda00001' } }, pas);
    await new Promise(r => setTimeout(r, 900));
    ok('stále jedna rezervácia', rezOf('qaOnPass0000001').length === 1, 'rezervácií: ' + rezOf('qaOnPass0000001').length);
    ok('a jedna návšteva', usr('qaOnPass0000001').visit_count === navstevPred + 1,
      String(usr('qaOnPass0000001').visit_count));

    console.log('\n3) Hodina sa počíta do mesačných bodov ako online:');
    const prof = await j('/api/profile/qaOnPass0000001', {}, pas);
    const polozky = ((prof.d && prof.d.points && prof.d.points.items) || []);
    const onlinePol = polozky.find(p => /online/i.test(String(p.label || p.key || '')));
    ok('v mesačných bodoch je online hodina', !!onlinePol && (+onlinePol.count || 0) >= 1,
      JSON.stringify(polozky.map(p => (p.label || p.key) + ':' + p.count)).slice(0, 220));

    console.log('\n4) Kto mal rezervované, dostane len označenie:');
    const navPred = usr('qaOnRezerv00001').visit_count;
    await j('/api/online/enter', { method: 'POST', body: { class_id: 'qaOnTrieda00001' } }, rez);
    await new Promise(r => setTimeout(r, 900));
    const b2 = rezOf('qaOnRezerv00001');
    ok('žiadna druhá rezervácia', b2.length === 1, 'rezervácií: ' + b2.length);
    ok('pôvodná je odchodená', b2[0] && b2[0].attendance_status === 'attended', b2[0] && b2[0].attendance_status);
    ok('návšteva pribudla raz', usr('qaOnRezerv00001').visit_count === navPred + 1,
      navPred + ' → ' + usr('qaOnRezerv00001').visit_count);

    console.log('\n5) Plné online členstvo sa zapíše tiež:');
    const navC = usr('qaOnClen0000001').visit_count;
    const r5 = await j('/api/online/enter', { method: 'POST', body: { class_id: 'qaOnTrieda00001' } }, clen);
    ok('prejde bez odpočtu', r5.status === 200 && r5.d && r5.d.mode === 'full' && r5.d.charged === false, JSON.stringify(r5.d).slice(0, 120));
    await new Promise(r => setTimeout(r, 900));
    ok('a hodina jej je zapísaná', rezOf('qaOnClen0000001').length === 1, 'rezervácií: ' + rezOf('qaOnClen0000001').length);
    ok('s krytím členstvom', (rezOf('qaOnClen0000001')[0] || {}).access_method === 'membership',
      (rezOf('qaOnClen0000001')[0] || {}).access_method);
    ok('návšteva pribudla', usr('qaOnClen0000001').visit_count === navC + 1,
      navC + ' → ' + usr('qaOnClen0000001').visit_count);

    console.log('\n6) Zrušený termín nezapíše nič:');
    const r6 = await j('/api/online/enter', { method: 'POST', body: { class_id: 'qaOnZrusena0001' } }, clen);
    ok('appka povie, že sa hodina nekoná', r6.status === 410, 'HTTP ' + r6.status + ' ' + JSON.stringify(r6.d).slice(0, 90));
    await new Promise(r => setTimeout(r, 700));
    ok('a nevznikla žiadna rezervácia',
      rd('bookings.db').filter(b => b.class_id === 'qaOnZrusena0001').length === 0,
      'rezervácií: ' + rd('bookings.db').filter(b => b.class_id === 'qaOnZrusena0001').length);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nONLINE ÚČASŤ: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-900));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
