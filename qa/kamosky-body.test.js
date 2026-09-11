/**
 * Nové odmeny za kamošky (Marek 11. 9.): „za novú kamošku na hodine 20 bodov,
 * keď sa zaregistruje, tak 100 bodov" — a zreteľný oznam na hlavnom dashboarde.
 *
 * Overuje:
 *  - 100 b za kamošku, ktorá si vytvorí účet (heslo aj Google), aj za hosťa z pozvánky,
 *    ktorý registráciu dokončí neskôr (claimed_at),
 *  - 20 b za jej úplne PRVÚ odchodenú hodinu — aj keď ju pozvala na hodinu cez /invite
 *    klientka, ktorá nie je jej sponzorkou,
 *  - nič za importované, deaktivované, testovacie účty, neúčasť ani starú klientku,
 *  - registrácie pred 11. 9. ostávajú po 5 b (spätne sa nič neprepočítava),
 *  - profil, rebríček aj admin sumár dávajú to isté,
 *  - sponzorka dostane upozornenie s bodmi (registrácia, claim, pozvánka),
 *  - dashboard má oznam a nové texty, stará „5 b za privedenie" zmizla.
 * Spustenie:  node qa/kamosky-body.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4531;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-kam-'));

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
const rd = f => {
  const p = path.join(DATA, f); if (!fs.existsSync(p)) return [];
  const m = new Map();
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!l.trim()) continue; let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o.$$indexCreated) continue; if (o.$$deleted) { m.delete(o._id); continue; } m.set(o._id, o);
  }
  return [...m.values()];
};
const polozka = (items, kus) => (items || []).find(i => String(i.label || '').toLowerCase().includes(kus.toLowerCase())) || null;
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';

(async () => {
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const MES = DNES.slice(0, 7), ROK = DNES.slice(0, 4);
  const pm = new Date(+MES.slice(0, 4), +MES.slice(5, 7) - 2, 1);
  const PRED_MES = pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0');
  // registrácie pred 11. 9. (po 5 b): P1 5. 9. je v tomto mesiaci len v septembri, A1 1. 8. len v ročnom
  const L_MES = MES === '2026-09' ? 1 : 0, L_ROK = ROK === '2026' ? 2 : 0;

  const hash = bcrypt.hashSync('Heslo123!', 10);
  const S = 'qaKamSponzor01', ADM = 'qaKamAdmin0001';
  const zak = { rank: 1, is_admin: false, active: true, user_type: 'client', visit_count: 0, referral_credit: 0, lead_source: 'qa', city: 'Detva' };
  const kam = (id, extra) => ({ _id: id, name: 'Kamoška ' + id.slice(-2).toUpperCase() + 'ová', email: id.toLowerCase() + '@qa-biz.local', phone: '',
    password: hash, referral_code: id.toUpperCase().slice(-6), sponsor_id: S, created_at: DNES, ...zak, ...extra });
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: ADM, name: 'Admin Kamoskovy', email: 'qa.kam.admin@qa-biz.local', password: hash, referral_code: 'QAKADM', ...zak, is_admin: true, user_type: 'admin', created_at: '2026-01-01' },
    { _id: S, name: 'Sabina Sponzorova', email: 'qa.kam.sponzor@qa-biz.local', phone: '', password: hash, referral_code: 'QAKAM1', sponsor_id: ADM, created_at: '2026-07-01', ...zak },
    kam('qaKamR1'),                                                    // registrovaná + prišla na hodinu → 100 + 20
    kam('qaKamR2', { password: null, google_id: 'g-qa-r2' }),          // len Google účet → 100
    kam('qaKamG1', { password: null, guest: true }),                   // hosť z pozvánky na hodine → 20
    kam('qaKamG2', { password: null, guest: true, email: 'qa.kam.g2@qa-biz.local' }), // hosť, registráciu dokončí v teste → 100
    kam('qaKamP1', { created_at: '2026-09-05' }),                      // pred 11. 9. → 5 b
    kam('qaKamA1', { created_at: '2026-08-01' }),                      // stará klientka, prvá hodina v auguste → 5 b v roku, žiadnych 20
    kam('qaKamI1', { imported: true, claimed: true }),                 // import z Glofoxu → nič
    kam('qaKamD1', { active: false }),                                 // deaktivovaná → nič
    kam('qaKamN1', { password: null, guest: true }),                   // neprišla (no_show) → nič
    kam('qaKamT1', { email: 'kam.t1@test-fa-qa.local' }),              // test → nič
    kam('qaKamX1', { sponsor_id: ADM, created_at: '2026-06-01' }),     // iný sponzor, ale na 1. hodinu ju pozvala S → 20 pre S
  ]));
  const cls = { _id: 'qaKamClass1', name: 'Zumba QA', emoji: '💃', active: true, category: 'Zumba', location: 'Detva',
    day_of_week: 3, time_start: '18:00', time_end: '19:00', capacity: 30, created_at: '2026-01-01' };
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([cls]));
  const bk = (id, uid, date, extra) => ({ _id: id, class_id: cls._id, class_name: cls.name, class_location: 'Detva', user_id: uid,
    booking_date: date, status: 'confirmed', attendance_status: 'attended', created_at: date + 'T08:00:00.000Z', ...extra });
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky([
    bk('qaKamB01', 'qaKamR1', DNES),
    bk('qaKamB02', 'qaKamG1', DNES, { source: 'invite', invited_by: S, access_method: 'free_class' }),
    bk('qaKamB03', 'qaKamA1', '2026-08-05'), bk('qaKamB04', 'qaKamA1', DNES),
    bk('qaKamB05', 'qaKamI1', DNES),
    bk('qaKamB06', 'qaKamN1', DNES, { attendance_status: 'no_show' }),
    bk('qaKamB07', 'qaKamX1', DNES, { source: 'invite', invited_by: S, access_method: 'free_class' }),
  ]));
  // bez víťazky za minulý mesiac by boot korunoval niekoho z fixtúr a zmenil mu body
  fs.writeFileSync(path.join(DATA, 'monthly_winners.db'), riadky([
    { _id: 'qaKamMW01', month: PRED_MES, user_id: 'qaKamNikto', user_name: 'Nikto', points: 1, type: 'month', created_at: PRED_MES + '-28T10:00:00.000Z' }]));

  console.log('KAMOŠKY QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  await new Promise(r => setTimeout(r, 4000));

  try {
    // ── 1) toky cez API: claim hosťa, nová registrácia cez link, pozvánka ──
    const cl = await j('/api/register', { method: 'POST', body: { name: 'Gabriela Kamoskova', email: 'qa.kam.g2@qa-biz.local', password: 'Heslo123!', consent: true } }, {});
    ok('hosť dokončil registráciu (claim)', cl.status === 200 && cl.d && cl.d.claimed, JSON.stringify(cl.d));
    const g2 = rd('users.db').find(u => u._id === 'qaKamG2');
    ok('claim: claimed_at je dnes, už nie je hosť', g2 && String(g2.claimed_at || '').slice(0, 10) === new Date().toISOString().slice(0, 10) && g2.guest === false,
      JSON.stringify(g2 && { c: g2.claimed_at, g: g2.guest }));
    const rg = await j('/api/register', { method: 'POST', body: { name: 'Renata Novakova', email: 'qa.kam.r3@qa-biz.local', password: 'Heslo123!', sponsorCode: 'QAKAM1', consent: true } }, {});
    ok('nová registrácia cez link sponzorky', rg.status === 200, JSON.stringify(rg.d));
    const inv = await j('/api/invite/QAKAM1/book', { method: 'POST', body: { name: 'Iveta Hostova', contact: 'qa.kam.inv@qa-biz.local', class_id: cls._id } }, {});
    ok('pozvánka na hodinu cez /invite', inv.status === 200, JSON.stringify(inv.d));
    await new Promise(r => setTimeout(r, 800));

    const notif = rd('notifications.db').filter(n => n.user_id === S);
    ok('upozornenie: registrácia cez link = +100 bodov', notif.some(n => /\+100 bodov/.test(n.title) && /Renata/.test(n.title)), JSON.stringify(notif.map(n => n.title)));
    ok('upozornenie: dokončená registrácia hosťa = +100 bodov', notif.some(n => /\+100 bodov/.test(n.title) && /Gabriela/.test(n.title)), JSON.stringify(notif.map(n => n.title)));
    const nInv = notif.find(n => /Iveta/.test(n.body || ''));
    ok('upozornenie: pozvánka sľubuje +20 a +100', nInv && /\+20 bodov/.test(nInv.body) && /\+100/.test(nInv.body), nInv && nInv.body);

    // očakávané body sponzorky
    const REG_N = 4 + L_MES, REG_P = 400 + 5 * L_MES;         // R1, R2, G2, R3 (+ P1 v septembri po 5 b)
    const HOD_N = 3, HOD_P = 60;                               // R1, G1, X1
    const REG_NY = 4 + L_ROK, REG_PY = 400 + 5 * L_ROK;

    // ── 2) profil (monthlyPointsFor) ──
    const jar = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.kam.sponzor@qa-biz.local', password: 'Heslo123!' } }, jar);
    ok('prihlásenie sponzorky', lg.status === 200, JSON.stringify(lg.d));
    const pr = await j('/api/profile/' + S, {}, jar);
    const pItems = pr.d && pr.d.points && pr.d.points.items;
    const pReg = polozka(pItems, 'zaregistrovali'), pHod = polozka(pItems, 'prvej hodine');
    ok('profil: registrácie ' + REG_N + ' kamošiek = ' + REG_P + ' b', pReg && pReg.count === REG_N && pReg.points === REG_P, JSON.stringify(pReg));
    ok('profil: prvá hodina ' + HOD_N + ' kamošky = ' + HOD_P + ' b', pHod && pHod.count === HOD_N && pHod.points === HOD_P, JSON.stringify(pHod));
    ok('profil: stará položka „Privedení noví členovia" je preč', !polozka(pItems, 'privedení'), JSON.stringify(pItems && pItems.map(i => i.label)));
    ok('profil: súčet = ' + (REG_P + HOD_P), pr.d.points.total === REG_P + HOD_P, String(pr.d.points.total));

    // ── 3) rebríček (spotlight) — mesiac aj rok ──
    const sp = await j('/api/client/spotlight', {}, jar);
    const my = sp.d && sp.d.myMonth;
    const sReg = polozka(my && my.breakdown, 'zaregistrovali'), sHod = polozka(my && my.breakdown, 'prvej hodine');
    ok('rebríček: registrácie sedia s profilom', sReg && pReg && sReg.count === pReg.count && sReg.points === pReg.points, JSON.stringify(sReg));
    ok('rebríček: prvá hodina sedí s profilom', sHod && pHod && sHod.count === pHod.count && sHod.points === pHod.points, JSON.stringify(sHod));
    ok('rebríček: súčet sedí s profilom', my && my.points === pr.d.points.total, my && (my.points + ' vs ' + pr.d.points.total));
    const top = (sp.d.topMonth || []).find(x => x.id === S);
    ok('top rebríček: sponzorka je v ňom s rovnakým skóre', top && top.points === my.points, JSON.stringify(top && top.points));
    const myY = sp.d && sp.d.myYear;
    const yReg = polozka(myY && myY.breakdown, 'zaregistrovali'), yHod = polozka(myY && myY.breakdown, 'prvej hodine');
    ok('ročný rebríček: staré registrácie ostali po 5 b (' + REG_NY + ' = ' + REG_PY + ' b)', yReg && yReg.count === REG_NY && yReg.points === REG_PY, JSON.stringify(yReg));
    ok('ročný rebríček: prvá hodina ' + HOD_P + ' b', yHod && yHod.points === HOD_P, JSON.stringify(yHod));

    // ── 4) admin sumár (z neho sa korunuje klientka mesiaca) ──
    const ajar = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.kam.admin@qa-biz.local', password: 'Heslo123!' } }, ajar);
    const sum = await j('/api/admin/points-summary?from=' + MES + '-01&to=' + MES + '-31', {}, ajar);
    const row = sum.d && (sum.d.rows || []).find(r => r.id === S);
    ok('admin sumár: rovnaký súčet ako profil', row && row.total === pr.d.points.total, JSON.stringify(row && { t: row.total, p: pr.d.points.total }));
    ok('admin sumár: odporúčania = ' + (REG_P + HOD_P) + ' b', sum.d && sum.d.catTotals && sum.d.catTotals.refs === REG_P + HOD_P, JSON.stringify(sum.d && sum.d.catTotals));
    ok('admin sumár: počet registrácií a kamošiek na hodine', row && row.refs === REG_N && row.kamosky_hodina === HOD_N, JSON.stringify(row && { r: row.refs, h: row.kamosky_hodina }));

    // ── 5) dashboard: zreteľný oznam + nové texty ──
    const html = await (await fetch(BASE + '/client-dashboard.html')).text();
    ok('dashboard: blok oznamu je v stránke', /id="kamoskaBanner"/.test(html) && /loadKamoskaBanner\(me\)/.test(html));
    ok('dashboard: oznam hovorí +20 a +100', /\+20<small>b<\/small>/.test(html) && /\+100<small>b<\/small>/.test(html) && /keď kamoška príde na hodinu/.test(html) && /keď sa zaregistruje v appke/.test(html));
    ok('dashboard: tlačidlo pozvať kamošku v ozname', /class="km-go" onclick="inviteFriend\(\)"/.test(html));
    ok('dashboard: pravidlá súťaže majú nové body', /kamoška na prvej hodine \(20 b\)/.test(html) && /kamoška, ktorá sa zaregistruje \(100 b\)/.test(html));
    ok('dashboard: riadok v rebríčku má nové body', /\+20 b\., keď príde na hodinu, a \+100 b\., keď sa zaregistruje!/.test(html));
    ok('dashboard: stará „5 b za privedenie" zmizla', !/\+5 b\. za privedenie/.test(html) && !/privedený člen \(5 b\)/.test(html));
    const swDisk = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8').match(/fa-v\d+/)[0];
    const swWeb = ((await (await fetch(BASE + '/sw.js')).text()).match(/fa-v\d+/) || [])[0];
    ok('service worker má novú verziu (' + swDisk + ')', swWeb === swDisk && swDisk !== 'fa-v631', swWeb);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    srv.kill();
    console.log('\nKAMOŠKY: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 600);
  }
})();
