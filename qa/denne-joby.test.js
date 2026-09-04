/**
 * Denný tick so samoliečbou (audit E10, 4. 9. 2026).
 *
 * Predtým: hodinový tick viazaný na getHours()===8 / ===20 bez guardu — deploy
 * medzi 20:00 a časom ticku znamenal, že kupón po prvej hodine sa v ten deň
 * neposlal a už nedobehol. Teraz: tick každých 10 minút; denné joby po 8:00 SK
 * a večerný follow-up po 20:00 SK bežia práve raz za deň (guard
 * daily_jobs_<deň> / first_class_followup_<deň> v settings). QA endpoint
 * POST /api/admin/qa/run-daily-tick?hour=NN tick spustí s podstrčenou hodinou.
 *
 * Stráži, že:
 *   · o 7:00 nič nebeží (ani denné joby, ani follow-up)
 *   · o 9:00 denné joby prebehnú (klientka s končiacim členstvom dostane
 *     upozornenie) a zapíše sa guard; druhé volanie o 9:00 už nič nespustí
 *   · o 21:00 klientka s dnešnou prvou absolvovanou hodinou dostane mail
 *     s kupónom (MAIL_CAPTURE=1 → mail_log.db) presne raz; druhé volanie nič
 *   · endpoint je len pre admina, zlá hodina vráti 400, bez ?hour berie SK čas
 *
 * Spustenie:  node qa/denne-joby.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4584;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-dj-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const pockaj = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const KLARA = 'qa.dj.klara@qa-biz.local', EVA = 'qa.dj.eva@qa-biz.local';
  const U = (id, name, email, extra) => JSON.stringify({ _id: id, name, email, password: hash, user_type: 'client', active: true, created_at: '2026-06-01', city: 'Detva', ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    U('qaDjAdmin000001', 'Adam Admin', 'qa.dj.admin@qa-biz.local', { is_admin: true, user_type: 'admin' }),
    U('qaDjKlara000001', 'Klára Prvá', KLARA, { visit_count: 1 }),
    U('qaDjEva00000001', 'Eva Končiaca', EVA, { visit_count: 12 }),
  ].join('\n') + '\n');
  // Eva: členstvo končí o 3 dni → denné joby jej pošlú upozornenie (dôkaz, že bežali)
  fs.writeFileSync(path.join(DATA, 'memberships.db'),
    JSON.stringify({ _id: 'qaDjMemEva00001', user_id: 'qaDjEva00000001', plan_id: 'bronze', plan_name: 'Bronze', status: 'active',
      started_at: new Date(Date.now() - 27 * 86400000).toISOString(), expires_at: new Date(Date.now() + 3 * 86400000).toISOString(),
      price: 50, payment_method: 'card' }) + '\n');
  // Klára: dnes absolvovala svoju úplne prvú hodinu, členstvo nemá → večer kupón
  fs.writeFileSync(path.join(DATA, 'bookings.db'),
    JSON.stringify({ _id: 'qaDjBk000000001', user_id: 'qaDjKlara000001', class_id: 'qaDjCls00000001', class_name: 'Zumba Detva',
      booking_date: DNES, status: 'attended', attended_at: DNES + 'T10:00:00.000Z', attended_by: 'trainer',
      attendance_status: 'attended', attendance_source: 'trainer', access_method: 'free_class', created_at: DNES + 'T08:00:00.000Z' }) + '\n');

  console.log('DENNÉ JOBY QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await pockaj(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  const guardy = prefix => rd('settings.db').filter(s => String(s.key || '').startsWith(prefix));
  const mailyKlare = () => rd('mail_log.db').filter(m => m.to === KLARA && m.template === 'first_class_followup');
  const mailyEve = () => rd('mail_log.db').filter(m => m.to === EVA && /vyprší/.test(String(m.subject || '')));
  const tick = (adm, hour) => j('/api/admin/qa/run-daily-tick' + (hour === undefined ? '' : '?hour=' + hour), { method: 'POST' }, adm);

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.dj.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    console.log('\nOchrana endpointu:');
    ok('bez prihlásenia sa tick nespustí', [401, 403].includes((await tick(null, 9)).status));
    ok('nezmyselná hodina vráti 400', (await tick(adm, 'abc')).status === 400);
    ok('hodina 24 vráti 400', (await tick(adm, 24)).status === 400);

    console.log('\nHodina 7 — ešte nič:');
    const t7 = await tick(adm, 7);
    ok('tick prebehol', t7.status === 200 && t7.d && t7.d.ok && t7.d.hour === 7, JSON.stringify(t7.d));
    ok('denné joby ani follow-up nebežali', t7.d && t7.d.daily === false && t7.d.followup === false, JSON.stringify(t7.d));
    await pockaj(500);
    ok('žiadny guard v settings', guardy('daily_jobs_').length === 0 && guardy('first_class_followup_').length === 0);
    ok('žiadny mail neodišiel', mailyKlare().length === 0 && mailyEve().length === 0);

    console.log('\nHodina 9 — denné joby raz:');
    const t9 = await tick(adm, 9);
    ok('denné joby prebehli', t9.status === 200 && t9.d && t9.d.daily === true, JSON.stringify(t9.d));
    ok('follow-up ešte nie (je pred 20:00)', t9.d && t9.d.followup === false);
    await pockaj(800);
    ok('guard daily_jobs_' + DNES + ' existuje presne raz', guardy('daily_jobs_' + DNES).length === 1, JSON.stringify(guardy('daily_jobs_')));
    ok('Eva dostala upozornenie na končiace členstvo (joby naozaj bežali)', mailyEve().length === 1,
      JSON.stringify(rd('mail_log.db').map(m => m.to + ' · ' + m.subject)).slice(0, 200));
    ok('a má aj notifikáciu v appke', rd('notifications.db').some(n => n.user_id === 'qaDjEva00000001' && n.type === 'expiry_warning'));
    const t9b = await tick(adm, 9);
    ok('druhé volanie o 9 už joby nespustí', t9b.status === 200 && t9b.d && t9b.d.daily === false, JSON.stringify(t9b.d));
    await pockaj(500);
    ok('guard je stále len jeden', guardy('daily_jobs_' + DNES).length === 1);
    ok('Eva nedostala upozornenie druhýkrát', mailyEve().length === 1);
    ok('Kláre zatiaľ nič neprišlo', mailyKlare().length === 0);

    console.log('\nHodina 21 — follow-up po prvej hodine raz:');
    const t21 = await tick(adm, 21);
    ok('follow-up prebehol a poslal 1 mail', t21.status === 200 && t21.d && t21.d.followup === true && t21.d.followup_sent === 1, JSON.stringify(t21.d));
    ok('denné joby sa nezopakovali', t21.d && t21.d.daily === false);
    await pockaj(800);
    const mk = mailyKlare();
    ok('Klára má v mail_logu presne jeden follow-up mail', mk.length === 1, JSON.stringify(mk.map(m => m.subject)));
    ok('mail je „ako sa ti páčila prvá hodina" s darčekom', mk[0] && /prvá hodina/i.test(mk[0].subject) && /darček/i.test(mk[0].subject), mk[0] && mk[0].subject);
    const kupon = rd('promo_codes.db').find(p => /^PRVA-/.test(String(p.code || '')) && /Klára/.test(String(p.note || '')));
    ok('vznikol jej osobný kupón PRVA-* (20 %, jednorazový)', !!kupon && kupon.value === 20 && kupon.max_uses === 1, JSON.stringify(kupon));
    ok('kupón je v tele mailu', !!kupon && mk[0] && String(mk[0].html || '').includes(kupon.code));
    ok('Klára je označená first_class_followup_sent', (rd('users.db').find(u => u._id === 'qaDjKlara000001') || {}).first_class_followup_sent === true);
    ok('guard first_class_followup_' + DNES + ' existuje presne raz', guardy('first_class_followup_' + DNES).length === 1);
    const t21b = await tick(adm, 21);
    ok('druhé volanie o 21 už follow-up nespustí', t21b.status === 200 && t21b.d && t21b.d.followup === false && t21b.d.followup_sent === 0, JSON.stringify(t21b.d));
    await pockaj(500);
    ok('Klára nedostala druhý mail', mailyKlare().length === 1);
    ok('Eva stále len jedno upozornenie', mailyEve().length === 1);

    console.log('\nBez ?hour — skutočný SK čas, guardy držia:');
    const tr = await tick(adm);
    ok('tick berie skutočnú SK hodinu (0–23)', tr.status === 200 && tr.d && Number.isInteger(tr.d.hour) && tr.d.hour >= 0 && tr.d.hour <= 23, JSON.stringify(tr.d));
    ok('a dnes už nič nespúšťa druhýkrát', tr.d && tr.d.daily === false && tr.d.followup === false, JSON.stringify(tr.d));
    ok('žiadny iný guard nepribudol', guardy('daily_jobs_').length === 1 && guardy('first_class_followup_').length === 1);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nDENNÉ JOBY: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-800));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
