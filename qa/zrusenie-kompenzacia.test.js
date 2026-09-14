/**
 * Kompenzácia za zrušenú hodinu — predĺženie mesačných členstiev.
 *
 * 3. 9. 2026: nástroj POST /api/attendance/cancel-compensate (tréner/admin)
 * a /api/service/cancel-compensate (IMPORT_TOKEN, z terminálu).
 * 14. 9. 2026 (Marek: „sprav to automaticky pri každom zrušení"): zrušenie hodiny
 * cez appku (cancel-session) predĺži členstvá samo — 1 hodina = 4 dni, okruh mesto.
 *
 * Stráži, že:
 *   · zrušenie Zumby samo predĺži všetkým členkám, čo do mesta chodia (aj z techniky)
 *   · prihlásená členka má predĺženie priamo v oznámení a v maile o zrušení,
 *     ostatné dostanú samostatné oznámenie (nikto dve o tom istom)
 *   · online členstvo, expirované, lead, iné mesto a deti pri dospelej hodine: nič
 *   · zrušenie techniky, online hodiny ani s skip_compensation nepredlžuje
 *   · zrušenie detskej hodiny predĺži len deťom
 *   · opakované zrušenie ani ručný nástroj na to isté zrušenie nepredĺži druhýkrát
 *   · Stripe obnova po predĺžení nadväzuje na predĺžený dátum (predĺženie sa nestratí)
 *   · bez tokenu servisná cesta „neexistuje", zlé vstupy vrátia 400
 *
 * Spustenie:  node qa/zrusenie-kompenzacia.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4579;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-komp-'));
const TOKEN = 'qa-komp-token';

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
const memb = id => rd('memberships.db').find(m => m._id === id);
const plusDni = (iso, n) => { const d = new Date(iso.slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const spi = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const dnes = new Date(); const zaMesiac = new Date(dnes); zaMesiac.setDate(zaMesiac.getDate() + 30);
  const EXP = zaMesiac.toISOString().slice(0, 10);
  const vcera = new Date(dnes); vcera.setDate(vcera.getDate() - 1);
  const U = (id, name, email, extra) => JSON.stringify({ _id: id, name, email, password: hash, user_type: 'client', active: true, created_at: '2026-05-01', ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    U('qaKompAdmin0001', 'Adam Admin', 'qa.komp.admin@qa-biz.local', { is_admin: true, user_type: 'admin' }),
    U('qaKompEva000001', 'Eva Booknutá', 'qa.komp.eva@qa-biz.local'),
    U('qaKompTimea0001', 'Tímea Chodiaca', 'qa.komp.timea@qa-biz.local'),
    U('qaKompOnline001', 'Oľga Online', 'qa.komp.online@qa-biz.local'),
    U('qaKompExpir0001', 'Erika Expirovaná', 'qa.komp.expir@qa-biz.local'),
    U('qaKompLead00001', 'Lenka Lead', 'qa.komp.lead@qa-biz.local', { user_type: 'lead' }),
    U('qaKompZvolen001', 'Zuzana Zvolenská', 'qa.komp.zvolen@qa-biz.local'),
    U('qaKompTech00001', 'Terézia Technika', 'qa.komp.tech@qa-biz.local'),
    U('qaKompStripe001', 'Soňa Stripe', 'qa.komp.stripe@qa-biz.local', { stripe_subscription_id: 'sub_qa_komp_1', stripe_sub_plan: 'bronze' }),
    U('qaKompRodic0001', 'Renáta Rodičová', 'qa.komp.rodic@qa-biz.local'),
    U('qaKompDieta0001', 'Danka Dieťa', 'dieta.qakomp@internal.local', { is_child: true, parent_id: 'qaKompRodic0001' }),
  ].join('\n') + '\n');
  const C = (id, name, loc, dow, extra) => JSON.stringify({ _id: id, name, emoji: '🎵', category: 'Zumba', instructor: 'Marek Gruber', location: loc, address: loc, day_of_week: dow, time_start: '19:00', time_end: '20:00', capacity: 20, price: 10, active: true, ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'classes.db'), [
    C('qaKompClsBrUt01', 'Zumba', 'Brezno', 2),
    C('qaKompClsBrSt01', 'Zumba', 'Brezno', 4),
    C('qaKompClsBrTe01', 'Technický tréning', 'Brezno', 4, { category: 'Technika', time_start: '18:00', time_end: '19:00' }),
    C('qaKompClsBrDe01', 'Zumba Kids', 'Brezno', 2, { category: 'Deti', time_start: '16:00', time_end: '17:00' }),
    C('qaKompClsZv0001', 'Zumba', 'Zvolen', 1),
    C('qaKompClsOnl001', 'Online LIVE', 'Online', 4, { category: 'Online' }),
  ].join('\n') + '\n');
  const M = (id, uid, plan, exp, extra) => JSON.stringify({ _id: id, user_id: uid, plan_id: plan, plan_name: plan[0].toUpperCase() + plan.slice(1), status: 'active', expires_at: exp, price: 50, created_at: '2026-08-10', ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'memberships.db'), [
    M('qaKompMemEva001', 'qaKompEva000001', 'bronze', EXP),
    M('qaKompMemTim001', 'qaKompTimea0001', 'silver', EXP + 'T21:59:59.000Z'),
    M('qaKompMemOnl001', 'qaKompOnline001', 'online', EXP),
    M('qaKompMemExp001', 'qaKompExpir0001', 'bronze', vcera.toISOString().slice(0, 10)),
    M('qaKompMemZvo001', 'qaKompZvolen001', 'bronze', EXP),
    M('qaKompMemTec001', 'qaKompTech00001', 'bronze', EXP),
    M('qaKompMemStr001', 'qaKompStripe001', 'bronze', EXP),
    M('qaKompMemDie001', 'qaKompDieta0001', 'bronze', EXP),
  ].join('\n') + '\n');
  const B = (id, uid, cls, date, extra) => JSON.stringify({ _id: id, user_id: uid, class_id: cls, booking_date: date, status: 'confirmed', access_method: 'membership', created_at: date + 'T08:00:00.000Z', ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'bookings.db'), [
    B('qaKompBk0000001', 'qaKompEva000001', 'qaKompClsBrSt01', '2026-09-03'),
    B('qaKompBk0000002', 'qaKompOnline001', 'qaKompClsBrSt01', '2026-09-03'),
    B('qaKompBk0000003', 'qaKompLead00001', 'qaKompClsBrSt01', '2026-09-03', { access_method: 'free_class', free_class: true }),
    B('qaKompBk0000004', 'qaKompTimea0001', 'qaKompClsBrUt01', '2026-08-25', { attendance_status: 'attended' }),
    B('qaKompBk0000005', 'qaKompExpir0001', 'qaKompClsBrUt01', '2026-08-25'),
    B('qaKompBk0000006', 'qaKompZvolen001', 'qaKompClsZv0001', '2026-08-31'),
    B('qaKompBk0000007', 'qaKompEva000001', 'qaKompClsBrSt01', '2026-09-10'),
    B('qaKompBk0000008', 'qaKompTech00001', 'qaKompClsBrTe01', '2026-09-03', { access_method: 'pay_on_site', pay_on_site: true }),
    B('qaKompBk0000009', 'qaKompStripe001', 'qaKompClsBrUt01', '2026-08-25'),
    B('qaKompBk0000010', 'qaKompDieta0001', 'qaKompClsBrDe01', '2026-09-08', { booked_by: 'qaKompRodic0001' }),
  ].join('\n') + '\n');

  // staré jednorazové predĺženia pre Brezno (20. 8., 13. 8., 1. 9.) by pri štarte predĺžili testovacie členstvá
  fs.writeFileSync(path.join(DATA, 'settings.db'), ['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926']
    .map((k, i) => JSON.stringify({ _id: 'qaKompSet' + i, key: k, value: true, at: '2026-09-01T00:00:00.000Z' })).join('\n') + '\n');

  console.log('KOMPENZÁCIA ZA ZRUŠENÚ HODINU QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', IMPORT_TOKEN: TOKEN, STRIPE_FAKE: '1', STRIPE_SECRET_KEY: 'sk_test_qa_fake' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await spi(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await spi(6000); // boot migrácie dobehnú

  const KLUC = 'qaKompClsBrSt01@2026-09-03';
  const samostatne = () => rd('notifications.db').filter(n => n.title === '💛 Predĺžili sme ti členstvo');
  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.komp.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, 'HTTP ' + lg.status);

    console.log('\n1) Zrušenie Zumby cez appku — predĺženie samo:');
    const zr = await j('/api/attendance/cancel-session', { method: 'POST', body: { class_id: 'qaKompClsBrSt01', date: '2026-09-03', reason: 'nízka účasť' } }, adm);
    ok('hodina zrušená', zr.status === 200 && zr.d && zr.d.ok, JSON.stringify(zr.d).slice(0, 160));
    ok('appka sama vrátila hodinu zdarma leadke, upozornila 3', zr.d && zr.d.refunded === 1 && zr.d.notified === 3, JSON.stringify(zr.d).slice(0, 160));
    const mena = ((zr.d && zr.d.compensation && zr.d.compensation.names) || []).slice().sort();
    ok('predĺžené samo štyrom členkám z Brezna (aj z techniky a so Stripe odberom)', zr.d.compensation && zr.d.compensation.days === 4 && JSON.stringify(mena) === JSON.stringify(['Eva Booknutá', 'Soňa Stripe', 'Terézia Technika', 'Tímea Chodiaca']), JSON.stringify(zr.d.compensation));
    await spi(500);
    ok('Eva: +4 dni, formát dátumu bez času ostal', memb('qaKompMemEva001').expires_at === plusDni(EXP, 4), memb('qaKompMemEva001').expires_at);
    ok('Tímea: +4 dni, formát s časom ostal', memb('qaKompMemTim001').expires_at === plusDni(EXP, 4) + 'T21:59:59.000Z', memb('qaKompMemTim001').expires_at);
    const eva = memb('qaKompMemEva001');
    ok('na členstve je jeden záznam o kompenzácii', Array.isArray(eva.kompenzacie) && eva.kompenzacie.length === 1 && eva.kompenzacie[0].key === KLUC && eva.kompenzacie[0].days === 4);
    ok('online členstvo sa nepredĺžilo', memb('qaKompMemOnl001').expires_at === EXP);
    ok('expirované členstvo sa nepredĺžilo', memb('qaKompMemExp001').expires_at === vcera.toISOString().slice(0, 10));
    ok('členka zo Zvolena sa nepredĺžila', memb('qaKompMemZvo001').expires_at === EXP);
    ok('dieťa z detskej hodiny sa pri dospelej hodine nepredĺžilo', memb('qaKompMemDie001').expires_at === EXP);
    const oznEva = rd('notifications.db').filter(n => n.user_id === 'qaKompEva000001' && n.type === 'class_cancelled');
    ok('prihlásená Eva má predĺženie priamo v oznámení o zrušení', oznEva.length === 1 && /predlžujeme o 4 dni — platí do/.test(oznEva[0].body), oznEva[0] && oznEva[0].body);
    ok('Eva nedostala druhé samostatné oznámenie', !samostatne().some(n => n.user_id === 'qaKompEva000001'));
    ok('neprihlásené členky dostali samostatné oznámenie (Tímea, Terézia, Soňa)', JSON.stringify(samostatne().map(n => n.user_id).sort()) === JSON.stringify(['qaKompStripe001', 'qaKompTech00001', 'qaKompTimea0001']), JSON.stringify(samostatne().map(n => n.user_id)));
    ok('samostatné oznámenie má deň v týždni a „o 4 dni"', samostatne().every(n => /štvrtok 3\. 9\. 2026/.test(n.body) && /o 4 dni/.test(n.body)), samostatne()[0] && samostatne()[0].body);
    const oznOlga = rd('notifications.db').find(n => n.user_id === 'qaKompOnline001' && n.type === 'class_cancelled');
    ok('online členka má oznámenie o zrušení bez predĺženia', oznOlga && !/predlžujeme/.test(oznOlga.body));
    const mailEva = rd('mail_log.db').find(m => m.to === 'qa.komp.eva@qa-biz.local' && /^Hodina zrušená/.test(m.subject));
    const mailLenka = rd('mail_log.db').find(m => m.to === 'qa.komp.lead@qa-biz.local' && /^Hodina zrušená/.test(m.subject));
    ok('mail Eve o zrušení spomína predĺženie', mailEva && /predlžujeme o 4 dni/.test(mailEva.html || ''), mailEva && (mailEva.html || '').slice(0, 80));
    ok('mail leadke predĺženie nespomína', mailLenka && !/predlžujeme/.test(mailLenka.html || ''));
    const aud = rd('audit.db');
    ok('audit: class_cancel s počtom predĺžených a class_compensate auto', aud.some(a => a.action === 'class_cancel' && a.after && a.after.compensated === 4) && aud.some(a => a.action === 'class_compensate' && a.after && a.after.auto === true));

    console.log('\n2) Opakovanie nič nezdvojí:');
    const zr2 = await j('/api/attendance/cancel-session', { method: 'POST', body: { class_id: 'qaKompClsBrSt01', date: '2026-09-03' } }, adm);
    ok('druhé zrušenie toho istého termínu → already', zr2.status === 200 && zr2.d.already === true);
    const k1 = await j('/api/attendance/cancel-compensate', { method: 'POST', body: { class_id: 'qaKompClsBrSt01', date: '2026-09-03', days: 4, scope: 'city' } }, adm);
    ok('ručný nástroj na to isté zrušenie už nikoho nepredĺži', k1.status === 200 && k1.d.extended.length === 0, JSON.stringify(k1.d).slice(0, 160));
    await spi(300);
    ok('Eva má stále len +4 a jeden záznam', memb('qaKompMemEva001').expires_at === plusDni(EXP, 4) && memb('qaKompMemEva001').kompenzacie.length === 1);
    ok('žiadne ďalšie samostatné oznámenia', samostatne().length === 3, 'n=' + samostatne().length);

    console.log('\n3) Čo sa nekompenzuje:');
    const te = await j('/api/attendance/cancel-session', { method: 'POST', body: { class_id: 'qaKompClsBrTe01', date: '2026-09-03' } }, adm);
    ok('zrušenie techniky: bez predĺženia (členstvo techniku nekryje)', te.status === 200 && te.d.ok && te.d.compensation === null, JSON.stringify(te.d).slice(0, 160));
    const on = await j('/api/attendance/cancel-session', { method: 'POST', body: { class_id: 'qaKompClsOnl001', date: '2026-09-17' } }, adm);
    ok('zrušenie online hodiny: bez predĺženia', on.status === 200 && on.d.ok && on.d.compensation === null, JSON.stringify(on.d).slice(0, 160));
    const sk = await j('/api/attendance/cancel-session', { method: 'POST', body: { class_id: 'qaKompClsBrUt01', date: '2026-09-15', skip_compensation: true } }, adm);
    ok('skip_compensation: bez predĺženia', sk.status === 200 && sk.d.ok && sk.d.compensation === null, JSON.stringify(sk.d).slice(0, 160));
    await spi(300);
    ok('Terézia a Tímea ostali na +4', memb('qaKompMemTec001').expires_at === plusDni(EXP, 4) && memb('qaKompMemTim001').expires_at === plusDni(EXP, 4) + 'T21:59:59.000Z');

    console.log('\n4) Detská hodina:');
    const de = await j('/api/attendance/cancel-session', { method: 'POST', body: { class_id: 'qaKompClsBrDe01', date: '2026-09-08' } }, adm);
    ok('zrušenie detskej hodiny predĺži len dieťaťu', de.status === 200 && de.d.compensation && JSON.stringify(de.d.compensation.names) === JSON.stringify(['Danka Dieťa']), JSON.stringify(de.d.compensation));
    await spi(300);
    ok('dieťa +4, dospelé bez zmeny', memb('qaKompMemDie001').expires_at === plusDni(EXP, 4) && memb('qaKompMemEva001').expires_at === plusDni(EXP, 4));

    console.log('\n5) Ochrana a vstupy ručného nástroja:');
    ok('bez prihlásenia trénerská cesta nejde', [401, 403].includes((await j('/api/attendance/cancel-compensate', { method: 'POST', body: { class_id: 'qaKompClsBrSt01', date: '2026-09-03', days: 4 } })).status));
    const svc = (body, tok) => j('/api/service/cancel-compensate', { method: 'POST', body, headers: tok ? { 'x-import-token': tok } : {} });
    ok('bez tokenu servisná cesta „neexistuje"', (await svc({ class_id: 'qaKompClsBrSt01', date: '2026-09-03', days: 4 })).status === 404);
    ok('so zlým tokenom tiež', (await svc({ class_id: 'qaKompClsBrSt01', date: '2026-09-03', days: 4 }, 'zly')).status === 404);
    ok('0 dní sa odmietne', (await svc({ class_id: 'qaKompClsBrSt01', date: '2026-09-03', days: 0 }, TOKEN)).status === 400);
    ok('99 dní sa odmietne', (await svc({ class_id: 'qaKompClsBrSt01', date: '2026-09-03', days: 99 }, TOKEN)).status === 400);
    ok('zlý dátum sa odmietne', (await svc({ class_id: 'qaKompClsBrSt01', date: 'včera', days: 4 }, TOKEN)).status === 400);
    ok('neznáma hodina sa odmietne', (await svc({ class_id: 'nieje', date: '2026-09-03', days: 4 }, TOKEN)).status === 400);
    const k3 = await svc({ class_id: 'qaKompClsBrSt01', date: '2026-09-10', days: 4, scope: 'booked' }, TOKEN);
    ok('ručne iný dátum, okruh „booked": len Eva (booknutá na 10. 9.)', k3.status === 200 && JSON.stringify(k3.d.extended.map(x => x.name)) === JSON.stringify(['Eva Booknutá']), JSON.stringify(k3.d && k3.d.extended));
    await spi(300);
    ok('Eva má teraz +8 a dva záznamy', memb('qaKompMemEva001').expires_at === plusDni(EXP, 8) && memb('qaKompMemEva001').kompenzacie.length === 2);

    console.log('\n6) Stripe obnova po predĺžení:');
    const pred = memb('qaKompMemStr001').expires_at;
    ok('Soňa má pred obnovou +4', String(pred).slice(0, 10) === plusDni(EXP, 4), pred);
    const wh = await j('/api/stripe/webhook', { method: 'POST', body: { id: 'evt_qa_komp_renew', type: 'invoice.paid', data: { object: { id: 'in_qa_komp_1', subscription: 'sub_qa_komp_1', billing_reason: 'subscription_cycle', amount_paid: 4990 } } } });
    await spi(800);
    const po = memb('qaKompMemStr001');
    ok('obnova nadviaže na predĺžený dátum: +4 +30 dní', wh.status === 200 && String(po.expires_at).slice(0, 10) === plusDni(EXP, 34), JSON.stringify({ wh: wh.status, pred, po: po.expires_at }));
    ok('záznam o kompenzácii na členstve ostal', Array.isArray(po.kompenzacie) && po.kompenzacie.some(k => k.key === KLUC));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    srv.kill();
    await spi(400);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nKOMPENZÁCIA: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-800));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
