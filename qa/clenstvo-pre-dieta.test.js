/**
 * Členstvo kúpené pre dieťa (9. 9. 2026).
 *
 * Marek: „zrušme balík Zumba Kids a dajme ich normálne používať bronze/silver/
 * gold — veď teraz pre deti máme Tanitu aj online hodiny aj jedálničky."
 *
 * Detský balík teda odchádza a rodič kupuje bežné členstvo priamo na profil
 * dieťaťa. Server to vedel vždy (for_child_id), v obchode k tomu chýbala voľba
 * „pre koho je členstvo".
 *
 * Stráži, že:
 *   · rodič si vie založiť detský profil
 *   · Bronze kúpený s for_child_id je vedený na DIEŤA, nie na rodiča
 *   · funguje to aj pre Silver (Tanita, online) a Gold (jedálniček)
 *   · bez for_child_id ostane členstvo rodičovi
 *   · cudzie dieťa sa podstrčiť nedá
 *   · obchod ponúka výber „pre koho" a nemá už detský balík
 *
 * Spustenie:  node qa/clenstvo-pre-dieta.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4596;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-dieta-'));

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
    { _id: 'qaDieAdmin00001', name: 'Marek Gruber', email: 'qa.die.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    { _id: 'qaDieRodic00001', name: 'Mama z reklamy', email: 'qa.die.rodic@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-09-09' },
    { _id: 'qaDieCudzi00001', name: 'Iný rodič', email: 'qa.die.cudzi@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-09-01' },
    { _id: 'qaDieCudzieDie', name: 'Cudzie dieťa', email: 'child-cudzie@internal.local',
      parent_id: 'qaDieCudzi00001', is_child: true, user_type: 'client', active: true,
      referral_code: 'CHILD-CUDZIE', created_at: '2026-09-01' },
  ]);

  console.log('ČLENSTVO PRE DIEŤA\n');

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
    console.log('1) Cenník pre deti = bežné balíky:');
    const plans = (await j('/api/membership/plans')).d || {};
    ok('Bronze 50 €', plans.bronze && plans.bronze.price === 50, plans.bronze && String(plans.bronze.price));
    ok('Silver 75 € a je v ňom online', plans.silver && plans.silver.price === 75 && plans.silver.online === true,
      JSON.stringify(plans.silver));
    ok('Gold 125 € a je v ňom jedálniček', plans.gold && plans.gold.price === 125 && plans.gold.meal === true,
      JSON.stringify(plans.gold));

    console.log('\n2) Rodič a detský profil:');
    const rodic = {};
    ok('rodič prihlásený',
      (await j('/api/login', { method: 'POST', body: { email: 'qa.die.rodic@qa-biz.local', password: 'Heslo123!' } }, rodic)).status === 200);
    ok('detský profil sa založil',
      (await j('/api/family/children', { method: 'POST', body: { name: 'Ninka', birth_year: 2018 } }, rodic)).status === 200);
    const deti = (await j('/api/family/children', {}, rodic)).d || [];
    ok('dieťa je v zozname', deti.length === 1 && deti[0].name === 'Ninka');
    const dieta = deti[0].id;

    console.log('\n3) Bronze pre dieťa:');
    const kup = await j('/api/membership/buy', { method: 'POST', body: {
      plan_id: 'bronze', payment_method: 'manual', for_child_id: dieta } }, rodic);
    ok('nákup prešiel', kup.status === 200 && kup.d && kup.d.ok, JSON.stringify(kup.d).slice(0, 160));
    ok('pýta si 50 €', kup.d && Math.abs(kup.d.final_price - 50) < 0.01, kup.d && String(kup.d.final_price));

    await new Promise(r => setTimeout(r, 700));
    const pl = rd('payments.db').find(x => x._id === (kup.d && kup.d.payment_id));
    ok('platba je vedená na DIEŤA', pl && pl.member_id === dieta, pl && pl.member_id);
    ok('platí ju rodič', pl && pl.user_id === 'qaDieRodic00001', pl && pl.user_id);
    ok('za plán bronze', pl && pl.ref_id === 'bronze', pl && pl.ref_id);

    console.log('\n4) Vyššie balíky pre dieťa tiež:');
    for (const [plan, cena] of [['silver', 75], ['gold', 125]]) {
      const r2 = await j('/api/membership/buy', { method: 'POST', body: {
        plan_id: plan, payment_method: 'manual', for_child_id: dieta } }, rodic);
      await new Promise(r => setTimeout(r, 400));
      const p2 = rd('payments.db').find(x => x._id === (r2.d && r2.d.payment_id));
      ok(plan + ' pre dieťa za ' + cena + ' €',
        r2.status === 200 && p2 && p2.member_id === dieta && Math.abs(p2.amount - cena) < 0.01,
        JSON.stringify(r2.d).slice(0, 120));
    }

    console.log('\n5) Bez voľby dieťaťa ostáva členstvo rodičovi:');
    const preMna = await j('/api/membership/buy', { method: 'POST', body: {
      plan_id: 'permanentka10', payment_method: 'manual' } }, rodic);
    await new Promise(r => setTimeout(r, 400));
    const p3 = rd('payments.db').find(x => x._id === (preMna.d && preMna.d.payment_id));
    ok('platba je na rodiča', p3 && p3.member_id === 'qaDieRodic00001', p3 && p3.member_id);

    console.log('\n6) Cudzie dieťa sa podstrčiť nedá:');
    const podvod = await j('/api/membership/buy', { method: 'POST', body: {
      plan_id: 'bronze', payment_method: 'manual', for_child_id: 'qaDieCudzieDie' } }, rodic);
    ok('odmietnuté (403)', podvod.status === 403, String(podvod.status));
    await new Promise(r => setTimeout(r, 400));
    ok('a žiadna platba nevznikla', !rd('payments.db').some(x => x.member_id === 'qaDieCudzieDie'));

    console.log('\n7) Obchod:');
    const html = await (await fetch(BASE + '/obchod', { headers: { Cookie: rodic.cookie } })).text();
    ok('ponúka výber „pre koho"', html.includes('preKohoBlok') && html.includes('Pre koho je členstvo'));
    ok('detský balík už neponúka', !/openKids|kidsCard/.test(html));
    ok('priamy odkaz ?buy= funguje', html.includes("get('buy')"));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nČLENSTVO PRE DIEŤA: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-700));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
