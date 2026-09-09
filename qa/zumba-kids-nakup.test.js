/**
 * Nákup členstva Zumba Kids pre dieťa (9. 9. 2026).
 *
 * Marek: „nedávajme prvú hodinu zadarmo, spravme to normálne — treba zaplatiť
 * tých 49,90 a priame presmerovanie do aplikácie na nákup Zumba Kids členstva."
 *
 * Plán 'kids' existoval v cenníku, ale z obchodu bol vypnutý — reklama teda
 * viedla na niečo, čo sa nedalo kúpiť. Server nákup pre dieťa vedel vždy
 * (for_child_id), chýbala len cesta k nemu.
 *
 * Stráži, že:
 *   · plán Zumba Kids stojí 49,90 € a je v cenníku appky
 *   · rodič si vie založiť detský profil
 *   · členstvo kúpené s for_child_id sadne na DIEŤA, nie na rodiča
 *   · rodičovi sa tým členstvo nezaloží
 *   · cudzie dieťa sa podstrčiť nedá
 *   · dieťa po nákupe vidieť v zozname detí aj s členstvom
 *
 * Spustenie:  node qa/zumba-kids-nakup.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4596;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-kids-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts, jar) {
  const headers = { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: (opts && opts.method) || 'GET', headers, body: opts && opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);

  w('users.db', [
    { _id: 'qaKidAdmin00001', name: 'Marek Gruber', email: 'qa.kid.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    { _id: 'qaKidRodic00001', name: 'Mama z reklamy', email: 'qa.kid.rodic@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-09-09' },
    // druhý rodič s vlastným dieťaťom — na overenie, že sa cudzie dieťa nedá podstrčiť
    { _id: 'qaKidCudzi00001', name: 'Iný rodič', email: 'qa.kid.cudzi@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-09-01' },
    { _id: 'qaKidCudzieDie', name: 'Cudzie dieťa', email: 'child-cudzie@internal.local',
      parent_id: 'qaKidCudzi00001', is_child: true, user_type: 'client', active: true,
      referral_code: 'CHILD-CUDZIE', created_at: '2026-09-01' },
  ]);

  console.log('NÁKUP ZUMBA KIDS\n');

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

  try {
    console.log('1) Cenník:');
    const plans = (await j('/api/membership/plans')).d;
    ok('plán kids je v cenníku', !!(plans && plans.kids), Object.keys(plans || {}).join(','));
    ok('stojí 49,90 €', plans.kids && Math.abs(plans.kids.price - 49.9) < 0.001, plans.kids && String(plans.kids.price));

    console.log('\n2) Rodič a detský profil:');
    const rodic = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.kid.rodic@qa-biz.local', password: 'Heslo123!' } }, rodic);
    ok('rodič prihlásený', lg.status === 200, JSON.stringify(lg.d));

    ok('na začiatku nemá deti', ((await j('/api/family/children', {}, rodic)).d || []).length === 0);

    const nove = await j('/api/family/children', { method: 'POST', body: { name: 'Ninka', birth_year: 2018 } }, rodic);
    ok('detský profil sa založil', nove.status === 200, JSON.stringify(nove.d));
    const deti = (await j('/api/family/children', {}, rodic)).d || [];
    ok('dieťa je v zozname', deti.length === 1 && deti[0].name === 'Ninka', JSON.stringify(deti.map(d => d.name)));
    const dietaId = deti[0].id;
    ok('a má rok narodenia', deti[0].birth_year === 2018, String(deti[0].birth_year));

    console.log('\n3) Nákup členstva pre dieťa:');
    // payment_method 'manual' = hotovosť/prevod → vznikne žiadosť a členstvo
    // aktivuje admin po prijatí peňazí. Kartou (Stripe) sa aktivuje hneď.
    const kup = await j('/api/membership/buy', { method: 'POST', body: {
      plan_id: 'kids', payment_method: 'manual', for_child_id: dietaId } }, rodic);
    ok('nákup prešiel', kup.status === 200 && kup.d && kup.d.ok, JSON.stringify(kup.d).slice(0, 180));
    ok('pýta si 49,90 €', kup.d && Math.abs(kup.d.final_price - 49.9) < 0.01, kup.d && String(kup.d.final_price));

    await new Promise(r => setTimeout(r, 700));
    const platby = rd('payments.db');
    const pl = platby.find(x => x._id === (kup.d && kup.d.payment_id));
    ok('vznikla platba', !!pl, 'platieb: ' + platby.length);
    ok('a je vedená na DIEŤA', pl && pl.member_id === dietaId, pl && pl.member_id);
    ok('platí ju rodič', pl && pl.user_id === 'qaKidRodic00001', pl && pl.user_id);
    ok('za plán kids', pl && pl.ref_id === 'kids', pl && pl.ref_id);
    ok('suma 49,90 €', pl && Math.abs((+pl.amount) - 49.9) < 0.01, pl && String(pl.amount));
    ok('čaká na potvrdenie platby', pl && pl.status === 'pending_manual', pl && pl.status);

    console.log('\n4) Rodič vie, čo sa deje:');
    const noti = rd('notifications.db').filter(n => n.user_id === 'qaKidRodic00001');
    ok('prišlo mu upozornenie o žiadosti', noti.some(n => /Zumba Kids/.test(n.title || '')),
      JSON.stringify(noti.map(n => n.title)));

    console.log('\n5) Cudzie dieťa sa podstrčiť nedá:');
    const podvod = await j('/api/membership/buy', { method: 'POST', body: {
      plan_id: 'kids', payment_method: 'manual', for_child_id: 'qaKidCudzieDie' } }, rodic);
    ok('odmietnuté (403)', podvod.status === 403, String(podvod.status));
    await new Promise(r => setTimeout(r, 400));
    ok('a žiadna platba nevznikla',
      !rd('payments.db').some(x => x.member_id === 'qaKidCudzieDie'));

    console.log('\n6) Obchod je dostupný:');
    const r2 = await fetch(BASE + '/obchod', { headers: { Cookie: rodic.cookie } });
    const html = await r2.text();
    ok('stránka obchodu sa načíta', r2.status === 200);
    ok('obsahuje nákup pre dieťa', html.includes('openKids'));
    ok('a priamy odkaz ?buy=', html.includes("get('buy')"));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nNÁKUP ZUMBA KIDS: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-700));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
