/**
 * Kompenzácia za zrušenú hodinu — predĺženie mesačných členstiev (3. 9. 2026).
 *
 * Brezno sa rušilo tretíkrát; predtým to šlo dvakrát ako jednorazová migrácia.
 * Teraz je to nástroj: POST /api/attendance/cancel-compensate (tréner/admin)
 * a /api/service/cancel-compensate (IMPORT_TOKEN, z terminálu).
 *
 * Stráži, že:
 *   · okruh „city" predĺži všetkým, čo do mesta chodia; „booked" len booknutým
 *   · online členstvo, expirované členstvo, lead bez členstva a admin: nič
 *   · expirácia sa posunie presne o N dní a formát dátumu ostane, aký bol
 *   · to isté zrušenie nepredĺži členstvo druhýkrát; iný dátum áno
 *   · klientka dostane notifikáciu s vypočítaným dňom v týždni
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
  ].join('\n') + '\n');
  const C = (id, name, loc, dow, extra) => JSON.stringify({ _id: id, name, emoji: '🎵', category: 'Zumba', instructor: 'Marek Gruber', location: loc, address: loc, day_of_week: dow, time_start: '19:00', time_end: '20:00', capacity: 20, price: 10, active: true, ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'classes.db'), [
    C('qaKompClsBrUt01', 'Zumba', 'Brezno', 2),
    C('qaKompClsBrSt01', 'Zumba', 'Brezno', 4),
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
  ].join('\n') + '\n');

  console.log('KOMPENZÁCIA ZA ZRUŠENÚ HODINU QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', IMPORT_TOKEN: TOKEN },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.komp.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, 'HTTP ' + lg.status);

    console.log('\n1) Zrušenie hodiny cez appku (ako Marek):');
    const zr = await j('/api/attendance/cancel-session', { method: 'POST', body: { class_id: 'qaKompClsBrSt01', date: '2026-09-03', reason: 'nízka účasť' } }, adm);
    ok('hodina zrušená', zr.status === 200 && zr.d && zr.d.ok, JSON.stringify(zr.d).slice(0, 120));
    ok('appka sama vrátila hodinu zdarma leadke', zr.d && zr.d.refunded === 1 && zr.d.notified === 3, JSON.stringify(zr.d).slice(0, 120));

    console.log('\n2) Ochrana a vstupy:');
    ok('bez prihlásenia trénerská cesta nejde', [401, 403].includes((await j('/api/attendance/cancel-compensate', { method: 'POST', body: { class_id: 'qaKompClsBrSt01', date: '2026-09-03', days: 4 } })).status));
    const svc = (body, tok) => j('/api/service/cancel-compensate', { method: 'POST', body, headers: tok ? { 'x-import-token': tok } : {} });
    ok('bez tokenu servisná cesta „neexistuje"', (await svc({ class_id: 'qaKompClsBrSt01', date: '2026-09-03', days: 4 })).status === 404);
    ok('so zlým tokenom tiež', (await svc({ class_id: 'qaKompClsBrSt01', date: '2026-09-03', days: 4 }, 'zly')).status === 404);
    ok('0 dní sa odmietne', (await svc({ class_id: 'qaKompClsBrSt01', date: '2026-09-03', days: 0 }, TOKEN)).status === 400);
    ok('99 dní sa odmietne', (await svc({ class_id: 'qaKompClsBrSt01', date: '2026-09-03', days: 99 }, TOKEN)).status === 400);
    ok('zlý dátum sa odmietne', (await svc({ class_id: 'qaKompClsBrSt01', date: 'včera', days: 4 }, TOKEN)).status === 400);
    ok('neznáma hodina sa odmietne', (await svc({ class_id: 'nieje', date: '2026-09-03', days: 4 }, TOKEN)).status === 400);

    console.log('\n3) Okruh „city" — všetky, čo do Brezna chodia:');
    const k1 = await j('/api/attendance/cancel-compensate', { method: 'POST', body: { class_id: 'qaKompClsBrSt01', date: '2026-09-03', days: 4, scope: 'city' } }, adm);
    ok('kompenzácia prebehla', k1.status === 200 && k1.d && k1.d.ok, JSON.stringify(k1.d).slice(0, 200));
    const mena = (k1.d && k1.d.extended || []).map(x => x.name).sort();
    ok('predĺžené presne dvom: booknutej Eve a chodiacej Tímei', JSON.stringify(mena) === JSON.stringify(['Eva Booknutá', 'Tímea Chodiaca']), JSON.stringify(mena));
    await new Promise(r => setTimeout(r, 400));
    const eva = memb('qaKompMemEva001'), tim = memb('qaKompMemTim001');
    ok('Eva: +4 dni, formát dátumu bez času ostal', eva && eva.expires_at === plusDni(EXP, 4), eva && eva.expires_at);
    ok('Tímea: +4 dni, formát s časom ostal', tim && tim.expires_at === plusDni(EXP, 4) + 'T21:59:59.000Z', tim && tim.expires_at);
    ok('na členstve je záznam o kompenzácii', eva && Array.isArray(eva.kompenzacie) && eva.kompenzacie.length === 1 && eva.kompenzacie[0].key === 'qaKompClsBrSt01@2026-09-03' && eva.kompenzacie[0].days === 4);
    ok('online členstvo sa nepredĺžilo', memb('qaKompMemOnl001').expires_at === EXP);
    ok('expirované členstvo sa nepredĺžilo', memb('qaKompMemExp001').expires_at === vcera.toISOString().slice(0, 10));
    ok('členka zo Zvolena sa nepredĺžila', memb('qaKompMemZvo001').expires_at === EXP);
    const notif = rd('notifications.db').filter(n => n.title === '💛 Predĺžili sme ti členstvo');
    ok('dve klientky dostali notifikáciu', notif.length === 2, 'n=' + notif.length);
    ok('s vypočítaným dňom: „štvrtok 3. 9. 2026" a „o 4 dni"', notif.every(n => /štvrtok 3\. 9\. 2026/.test(n.body) && /o 4 dni/.test(n.body)), notif[0] && notif[0].body);
    ok('audit má záznam class_compensate', rd('audit.db').some(a => a.action === 'class_compensate'));

    console.log('\n4) Idempotencia a ďalšie zrušenie:');
    const k2 = await svc({ class_id: 'qaKompClsBrSt01', date: '2026-09-03', days: 4, scope: 'city' }, TOKEN);
    ok('to isté zrušenie druhýkrát nikoho nepredĺži', k2.status === 200 && k2.d && k2.d.extended.length === 0, JSON.stringify(k2.d).slice(0, 120));
    await new Promise(r => setTimeout(r, 300));
    ok('Eva má stále len +4', memb('qaKompMemEva001').expires_at === plusDni(EXP, 4));
    const k3 = await svc({ class_id: 'qaKompClsBrSt01', date: '2026-09-10', days: 4, scope: 'booked' }, TOKEN);
    ok('iný dátum, okruh „booked": len Eva (booknutá na 10. 9.)', k3.status === 200 && k3.d && JSON.stringify(k3.d.extended.map(x => x.name)) === JSON.stringify(['Eva Booknutá']), JSON.stringify(k3.d && k3.d.extended));
    await new Promise(r => setTimeout(r, 300));
    ok('Eva má teraz +8 a dva záznamy', memb('qaKompMemEva001').expires_at === plusDni(EXP, 8) && memb('qaKompMemEva001').kompenzacie.length === 2);
    ok('Tímea ostala na +4', memb('qaKompMemTim001').expires_at === plusDni(EXP, 4) + 'T21:59:59.000Z');
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nKOMPENZÁCIA: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-800));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
