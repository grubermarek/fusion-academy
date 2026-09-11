/**
 * Odmeny za kamošky (Marek 11. 9.): „za novú kamošku na hodine 20 bodov" a hneď
 * oprava „nie keď sa zaregistruje 100 b, ale keď si kúpi členstvo". Registrácia
 * ostáva po 5 b. Zreteľný oznam na hlavnom dashboarde.
 *
 * Overuje:
 *  - 100 b za PRVÉ naozaj zaplatené členstvo kamošky (karta, hotovosť, kredit z appky),
 *    nie za 100 % kupón, permanentku, refundované ani predĺženie staršieho členstva,
 *  - za tú istú kamošku sa v 1. línii nedáva ešte aj 30 b „nový platiaci člen";
 *    predĺženie inej klientky ostáva po 30 b,
 *  - 20 b za jej úplne PRVÚ odchodenú hodinu — aj keď ju pozvala na hodinu cez /invite
 *    klientka, ktorá nie je jej sponzorkou,
 *  - nič za importované, deaktivované, testovacie účty, neúčasť ani starú klientku,
 *  - registrácia 5 b (ako doteraz), profil, rebríček aj admin sumár dávajú to isté,
 *  - sponzorka dostane upozornenie, za čo prídu body (registrácia, claim, pozvánka),
 *  - dashboard má oznam a nové texty, žiadne „100 b za registráciu".
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

  const hash = bcrypt.hashSync('Heslo123!', 10);
  const S = 'qaKamSponzor01', ADM = 'qaKamAdmin0001';
  const zak = { rank: 1, is_admin: false, active: true, user_type: 'client', visit_count: 0, referral_credit: 0, lead_source: 'qa', city: 'Detva' };
  const kam = (id, extra) => ({ _id: id, name: 'Kamoška ' + id.slice(-2).toUpperCase() + 'ová', email: id.toLowerCase() + '@qa-biz.local', phone: '',
    password: hash, referral_code: id.toUpperCase().slice(-6), sponsor_id: S, created_at: DNES, ...zak, ...extra });
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: ADM, name: 'Admin Kamoskovy', email: 'qa.kam.admin@qa-biz.local', password: hash, referral_code: 'QAKADM', ...zak, is_admin: true, user_type: 'admin', created_at: '2026-01-01' },
    { _id: S, name: 'Sabina Sponzorova', email: 'qa.kam.sponzor@qa-biz.local', phone: '', password: hash, referral_code: 'QAKAM1', sponsor_id: ADM, created_at: '2026-07-01', ...zak },
    kam('qaKamR1'),                                                    // prišla na hodinu + zaplatila kartou → 20 + 100
    kam('qaKamR2', { password: null, google_id: 'g-qa-r2' }),          // členstvo cez 100 % kupón → nič
    kam('qaKamG1', { password: null, guest: true }),                   // hosť z pozvánky na hodine → 20
    kam('qaKamG2', { password: null, guest: true, email: 'qa.kam.g2@qa-biz.local' }), // hosť, registráciu dokončí v teste
    kam('qaKamP1', { created_at: '2026-09-05' }),                      // zaregistrovaná pred 11. 9., prvé členstvo dnes → 100
    kam('qaKamA1', { created_at: '2026-08-01' }),                      // stará klientka: prvé členstvo v auguste, dnes predĺženie → 30 (nie 100)
    kam('qaKamI1', { imported: true, claimed: true }),                 // import z Glofoxu → nič
    kam('qaKamD1', { active: false }),                                 // deaktivovaná → nič
    kam('qaKamN1', { password: null, guest: true }),                   // neprišla (no_show) → nič
    kam('qaKamT1', { email: 'kam.t1@test-fa-qa.local' }),              // test → nič
    kam('qaKamX1', { sponsor_id: ADM, created_at: '2026-06-01' }),     // iný sponzor, ale na 1. hodinu ju pozvala S → 20 pre S
    kam('qaKamF1'),                                                    // zaplatila, ale peniaze vrátené → nič
    kam('qaKamF2'),                                                    // členstvo celé z kreditu v appke → 100
    kam('qaKamF3'),                                                    // kúpila len permanentku → nič
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
  const tx = (id, uid, amount, pm, extra) => ({ _id: id, type: 'membership', user_id: uid, user_name: uid, amount, payment_method: pm,
    plan_id: 'bronze', note: 'QA', created_at: DNES + 'T09:00:00.000Z', month: MES, ...extra });
  fs.writeFileSync(path.join(DATA, 'transactions.db'), riadky([
    tx('qaKamT01', 'qaKamR1', 50, 'stripe'),
    tx('qaKamT02', 'qaKamR2', 0, 'promo', { promo_code: 'VENCEKRODIC', plan_id: 'silver' }),
    tx('qaKamT03', 'qaKamP1', 50, 'cash'),
    tx('qaKamT04', 'qaKamA1', 50, 'cash', { date: '2026-08-10', created_at: '2026-08-10T09:00:00.000Z', month: '2026-08' }),
    tx('qaKamT05', 'qaKamA1', 50, 'stripe'),
    tx('qaKamT06', 'qaKamI1', 50, 'cash'), tx('qaKamT07', 'qaKamD1', 50, 'cash'), tx('qaKamT08', 'qaKamT1', 50, 'cash'),
    tx('qaKamT09', 'qaKamX1', 50, 'cash'),
    tx('qaKamT10', 'qaKamF1', 50, 'stripe'),
    tx('qaKamT11', 'qaKamF2', 0, 'referral_credit', { credit_used: 50 }),
    tx('qaKamT12', 'qaKamF3', 80, 'cash', { plan_id: 'permanentka10' }),
  ]));
  fs.writeFileSync(path.join(DATA, 'refunds.db'), riadky([
    { _id: 'qaKamRf01', payment_id: null, user_id: 'qaKamF1', client_name: 'F1', type: 'full', amount: 50, reason: 'other', created_at: DNES + 'T12:00:00.000Z', month: MES }]));
  // členstvá v období (z nich sa ráta „nový platiaci člen" po líniách): R1 (kamoška → len 100 b) a A1 (predĺženie → 30 b)
  const mem = (id, uid) => ({ _id: id, user_id: uid, user_name: uid, plan_id: 'bronze', plan_name: 'Bronze', price: 50, status: 'active',
    start_date: DNES, started_at: DNES, expires_at: '2099-01-01', payment_method: 'cash', created_at: DNES + 'T09:00:00.000Z' });
  fs.writeFileSync(path.join(DATA, 'memberships.db'), riadky([mem('qaKamM01', 'qaKamR1'), mem('qaKamM02', 'qaKamA1')]));
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
    const nReg = notif.find(n => /Renata/.test(n.title));
    ok('upozornenie pri registrácii: +20 za hodinu a +100 za členstvo', nReg && /\+20 bodov/.test(nReg.body) && /kúpi členstvo, \+100 bodov/.test(nReg.body), nReg && nReg.body);
    ok('upozornenie pri registrácii nesľubuje 100 b za registráciu', nReg && !/\+100/.test(nReg.title), nReg && nReg.title);
    const nCl = notif.find(n => /Gabriela/.test(n.title));
    ok('upozornenie pri dokončení registrácie hosťa: +100 za členstvo', nCl && /vytvoril\/a účet/.test(nCl.title) && /kúpi členstvo, máš \+100 bodov/.test(nCl.body), nCl && (nCl.title + ' | ' + nCl.body));
    const nInv = notif.find(n => /Iveta/.test(n.body || ''));
    ok('upozornenie pri pozvánke: +20 za hodinu a +100 za členstvo', nInv && /\+20 bodov/.test(nInv.body) && /kúpi členstvo, ďalších \+100/.test(nInv.body), nInv && nInv.body);

    // očakávané body sponzorky
    const vsetci = rd('users.db');
    const REG_N = vsetci.filter(u => u.sponsor_id === S && String(u.created_at || '').startsWith(MES)).length;
    const REG_NY = vsetci.filter(u => u.sponsor_id === S && String(u.created_at || '').startsWith(ROK)).length;
    const CLEN_N = 3, CLEN_P = 300;            // R1 (karta), P1 (hotovosť, zaregistrovaná pred 11. 9.), F2 (kredit)
    const HOD_N = 3, HOD_P = 60;               // R1, G1, X1
    const NM_P = 30;                           // A1 predĺženie v 1. línii; R1 už je v 100 b za kamošku
    const SPOLU = REG_N * 5 + CLEN_P + HOD_P + NM_P;

    // ── 2) profil (monthlyPointsFor) ──
    const jar = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.kam.sponzor@qa-biz.local', password: 'Heslo123!' } }, jar);
    ok('prihlásenie sponzorky', lg.status === 200, JSON.stringify(lg.d));
    const pr = await j('/api/profile/' + S, {}, jar);
    const pItems = pr.d && pr.d.points && pr.d.points.items;
    const pClen = polozka(pItems, 'kúpili členstvo'), pHod = polozka(pItems, 'prvej hodine'), pReg = polozka(pItems, 'zaregistrovali'), pNm = polozka(pItems, 'noví platiaci');
    ok('profil: členstvo ' + CLEN_N + ' kamošiek = ' + CLEN_P + ' b (kupón, permanentka, refund, predĺženie, test, import a deaktivovaná nie)', pClen && pClen.count === CLEN_N && pClen.points === CLEN_P, JSON.stringify(pClen));
    ok('profil: prvá hodina ' + HOD_N + ' kamošky = ' + HOD_P + ' b', pHod && pHod.count === HOD_N && pHod.points === HOD_P, JSON.stringify(pHod));
    ok('profil: registrácie po 5 b (' + REG_N + ' = ' + REG_N * 5 + ' b)', pReg && pReg.count === REG_N && pReg.points === REG_N * 5, JSON.stringify(pReg));
    ok('profil: „noví platiaci členovia" = len predĺženie A1 (30 b), R1 sa neráta dvakrát', pNm && pNm.count === 1 && pNm.points === NM_P, JSON.stringify(pNm));
    ok('profil: súčet = ' + SPOLU, pr.d.points.total === SPOLU, String(pr.d.points.total));

    // ── 3) rebríček (spotlight) — mesiac aj rok ──
    const sp = await j('/api/client/spotlight', {}, jar);
    const my = sp.d && sp.d.myMonth;
    const nesedi = (pItems || []).filter(i => { const s = polozka(my && my.breakdown, i.label); return !s || s.count !== i.count || s.points !== i.points; }).map(i => i.label);
    ok('rebríček: všetky položky sedia s profilom 1:1', nesedi.length === 0, nesedi.join(', '));
    ok('rebríček: súčet sedí s profilom', my && my.points === pr.d.points.total, my && (my.points + ' vs ' + pr.d.points.total));
    const top = (sp.d.topMonth || []).find(x => x.id === S);
    ok('top rebríček: sponzorka je v ňom s rovnakým skóre', top && top.points === my.points, JSON.stringify(top && top.points));
    const myY = sp.d && sp.d.myYear;
    const yClen = polozka(myY && myY.breakdown, 'kúpili členstvo'), yReg = polozka(myY && myY.breakdown, 'zaregistrovali'), yNm = polozka(myY && myY.breakdown, 'noví platiaci');
    ok('ročný rebríček: členstvo ' + CLEN_P + ' b', yClen && yClen.points === CLEN_P, JSON.stringify(yClen));
    ok('ročný rebríček: registrácie po 5 b (' + REG_NY + ')', yReg && yReg.count === REG_NY && yReg.points === REG_NY * 5, JSON.stringify(yReg));
    ok('ročný rebríček: R1 ani tu nie je dvakrát (30 b len za A1)', yNm && yNm.points === NM_P, JSON.stringify(yNm));

    // ── 4) admin sumár (z neho sa korunuje klientka mesiaca) ──
    const ajar = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.kam.admin@qa-biz.local', password: 'Heslo123!' } }, ajar);
    const sum = await j('/api/admin/points-summary?from=' + MES + '-01&to=' + MES + '-31', {}, ajar);
    const row = sum.d && (sum.d.rows || []).find(r => r.id === S);
    ok('admin sumár: rovnaký súčet ako profil', row && row.total === pr.d.points.total, JSON.stringify(row && { t: row.total, p: pr.d.points.total }));
    ok('admin sumár: odporúčania = ' + (REG_N * 5 + CLEN_P + HOD_P) + ' b', sum.d && sum.d.catTotals && sum.d.catTotals.refs === REG_N * 5 + CLEN_P + HOD_P, JSON.stringify(sum.d && sum.d.catTotals));
    ok('admin sumár: počty registrácií, členstiev a kamošiek na hodine', row && row.refs === REG_N && row.kamosky_clenstvo === CLEN_N && row.kamosky_hodina === HOD_N,
      JSON.stringify(row && { r: row.refs, c: row.kamosky_clenstvo, h: row.kamosky_hodina }));

    // ── 5) dashboard: zreteľný oznam + nové texty ──
    const html = await (await fetch(BASE + '/client-dashboard.html')).text();
    ok('dashboard: blok oznamu je v stránke', /id="kamoskaBanner"/.test(html) && /loadKamoskaBanner\(me\)/.test(html));
    ok('dashboard: oznam hovorí +20 za hodinu a +100 za členstvo', /\+20<small>b<\/small><\/b><span>keď kamoška príde na hodinu/.test(html) && /\+100<small>b<\/small><\/b><span>keď si kúpi členstvo/.test(html));
    ok('dashboard: tlačidlo pozvať kamošku v ozname', /class="km-go" onclick="inviteFriend\(\)"/.test(html));
    ok('dashboard: pravidlá súťaže majú nové body', /kamoška na prvej hodine \(20 b\)/.test(html) && /kamoška, ktorá si kúpi členstvo \(100 b\)/.test(html) && /zaregistrovaná kamoška \(5 b\)/.test(html));
    ok('dashboard: riadok v rebríčku má nové body', /\+20 b\., keď príde na hodinu, a \+100 b\., keď si kúpi členstvo!/.test(html));
    ok('dashboard: nikde „100 b za registráciu"', !/zaregistruje v appke/.test(html) && !/zaregistruje \(100 b\)/.test(html) && !/\+5 b\. za privedenie/.test(html));
    // Marek 11. 9.: riadok o 5 b za registráciu v ozname preč — kamoška sa registruje vždy, aj keď príde zadarmo
    ok('dashboard: oznam už nemá riadok o 5 b za registráciu', !/class="km-note"/.test(html) && !/ktorá sa zaregistruje, máš \+5 b/.test(html));
    const swDisk = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8').match(/fa-v\d+/)[0];
    const swWeb = ((await (await fetch(BASE + '/sw.js')).text()).match(/fa-v\d+/) || [])[0];
    ok('service worker má aktuálnu verziu (' + swDisk + ')', swWeb === swDisk, swWeb);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    srv.kill();
    console.log('\nKAMOŠKY: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 600);
  }
})();
