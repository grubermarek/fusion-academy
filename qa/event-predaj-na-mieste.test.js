/**
 * Predaj vstupeniek na mieste (5. 9. 2026, večer párty).
 *
 * Marek potrebuje pri dverách predať lístok za pár sekúnd: bez mena, bez e-mailu,
 * len počet. Cena sa musí meniť podľa toho, či je to členka (5 €) alebo cudzí (10 €),
 * a to aj po 21:00, keď predpredaj skončil. Rozdané lístky musia byť v prehľade
 * oddelené od predaných. Kto si KÚPI masterclass, dostane odznak a 50 bodov.
 *
 * Stráži, že:
 *   · predaj bez mena a e-mailu prejde a nikomu nič neodíde
 *   · členka 5 € / cudzí 10 € — aj po konci predpredaja
 *   · masterclass (full) ostáva 65 € — jeho členská cena skončila 31. 8.
 *   · darovaný lístok je 0 €, bez faktúry, v štatistike oddelený
 *   · štatistika ukáže predané, rozdané, tržbu a počet ľudí
 *   · odznak Masterclass #1 + 50 bodov dostane len ten, kto si kúpil
 *
 * Spustenie:  node qa/event-predaj-na-mieste.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4585;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-evsale-'));
const SLUG = 'latin-tropical-2026';

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
const tickets = () => rd('ev_tickets.db').filter(t => t.event_slug === SLUG);

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = (id, name, email, extra) => JSON.stringify({ _id: id, name, email, password: hash, user_type: 'client', active: true, created_at: '2026-01-01', ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    U('qaEvAdmin000001', 'Adam Admin', 'qa.ev.admin@qa-biz.local', { is_admin: true, user_type: 'admin' }),
    U('qaEvClenka00001', 'Clara Členka', 'qa.ev.clenka@qa-biz.local'),
    U('qaEvMaster00001', 'Magda Masterclass', 'qa.ev.master@qa-biz.local'),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(DATA, 'memberships.db'),
    JSON.stringify({ _id: 'qaEvMem00000001', user_id: 'qaEvClenka00001', plan_id: 'silver', plan_name: 'Silver',
      status: 'active', expires_at: '2027-01-01', price: 75, created_at: '2026-08-01' }) + '\n');

  console.log('PREDAJ NA MIESTE QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 12000));   // nech dobehne seed eventu

  try {
    const adm = {};
    ok('admin prihlásený', (await j('/api/login', { method: 'POST', body: { email: 'qa.ev.admin@qa-biz.local', password: 'Heslo123!' } }, adm)).status === 200);
    const predaj = (body, jar) => j('/api/admin/events/' + SLUG + '/onsite', { method: 'POST', body }, jar || adm);
    const stat = async () => (await j('/api/admin/events/' + SLUG + '/stats', {}, adm)).d;

    console.log('\n1) Ceny párty — členka vs cudzí (predpredaj už skončil):');
    const ev = rd('ev_events.db').find(e => e.slug === SLUG);
    const party = (ev.types || []).find(t => t.key === 'party');
    ok('párty má členskú cenu 5 €', party && party.member === 5, JSON.stringify(party && { m: party.member, p: party.presale, d: party.door }));
    ok('a platí aj po konci predpredaja', party && party.member_after_presale === true);
    ok('cudzí pri dverách platí 10 €', party && party.door === 10);
    const full = (ev.types || []).find(t => t.key === 'full');
    ok('masterclass ostáva 65 € a členskú cenu po predpredaji NEMÁ',
      full && full.door === 65 && !full.member_after_presale, JSON.stringify(full && { m: full.member, d: full.door, a: full.member_after_presale }));

    console.log('\n2) Rýchly predaj bez mena a e-mailu:');
    const p1 = await predaj({ items: [{ type: 'party', qty: 2 }], member: false, method: 'cash' });
    ok('cudzí, 2 lístky → prejde bez mena aj e-mailu', p1.status === 200 && p1.d && p1.d.ok, JSON.stringify(p1.d).slice(0, 140));
    ok('a stojí 20 € (2× 10 €)', p1.d && p1.d.total === 20, 'total=' + (p1.d && p1.d.total));
    const p2 = await predaj({ items: [{ type: 'party', qty: 1 }], member: true, method: 'cash' });
    ok('členka, 1 lístok → 5 €', p2.status === 200 && p2.d && p2.d.total === 5, 'total=' + (p2.d && p2.d.total));
    await new Promise(r => setTimeout(r, 500));
    ok('žiadny mail neodišiel (nikto nezadal adresu)',
      rd('mail_log.db').filter(m => /vstupenk/i.test(m.subject || '')).length === 0);
    const tk = tickets().filter(t => t.source === 'admin');
    ok('vzniklo 3 platných lístkov s QR kódom', tk.length === 3 && tk.every(x => x.code && x.status === 'valid'), 'n=' + tk.length);
    ok('lístky nesú, či to bola členka alebo cudzí', tk.filter(x => x.tier === 'member').length === 1 && tk.filter(x => x.tier === 'door').length === 2,
      JSON.stringify(tk.map(x => x.tier)));

    console.log('\n3) Rozdaný lístok (zadarmo):');
    const g1 = await predaj({ items: [{ type: 'party', qty: 2 }], gift: true });
    ok('darček prejde a je za 0 €', g1.status === 200 && g1.d && g1.d.ok && g1.d.total === 0 && g1.d.gift === true, JSON.stringify(g1.d).slice(0, 120));
    await new Promise(r => setTimeout(r, 400));
    ok('darované lístky sú označené ako gift', tickets().filter(t => t.tier === 'gift').length === 2);
    ok('za darček sa nevystaví faktúra', rd('invoices.db').every(i => (+i.total || 0) > 0));

    console.log('\n4) Prehľad pre Mareka:');
    const s = await stat();
    ok('predané a rozdané sú oddelené', s.total_paid === 3 && s.total_gifts === 2, 'predané=' + s.total_paid + ' rozdané=' + s.total_gifts);
    ok('tržba je len z predaných (25 €)', s.total_revenue === 25, 'tržba=' + s.total_revenue);
    ok('párty riadok ukáže obe čísla', s.per_type.party && s.per_type.party.paid === 3 && s.per_type.party.gifts === 2,
      JSON.stringify(s.per_type.party));
    ok('prehľad hovorí aj o počte ľudí', typeof s.people === 'number', 'people=' + s.people);

    console.log('\n5) Masterclass — odznak a body:');
    const m1 = await predaj({ items: [{ type: 'full', qty: 1 }], email: 'qa.ev.master@qa-biz.local', member: false, method: 'cash' });
    ok('predaj masterclassu prejde za 65 €', m1.status === 200 && m1.d && m1.d.total === 65, 'total=' + (m1.d && m1.d.total));
    await new Promise(r => setTimeout(r, 900));
    const magda = rd('users.db').find(u => u._id === 'qaEvMaster00001');
    ok('kupujúca dostala odznak Masterclass #1', magda && magda.masterclass_1 === true, JSON.stringify(magda && magda.masterclass_1));
    ok('a notifikáciu o ňom', rd('notifications.db').some(n => n.user_id === 'qaEvMaster00001' && /Masterclass #1/.test(n.title || '')));
    const g2 = await predaj({ items: [{ type: 'full', qty: 1 }], email: 'qa.ev.clenka@qa-biz.local', gift: true });
    ok('darovaný masterclass prejde', g2.status === 200 && g2.d && g2.d.ok);
    await new Promise(r => setTimeout(r, 900));
    const clara = rd('users.db').find(u => u._id === 'qaEvClenka00001');
    ok('ale odznak za darovaný lístok NEDOSTANE (odmena je za kúpu)', !clara.masterclass_1, JSON.stringify(clara.masterclass_1));

    console.log('\n6) Body v rebríčku (rozpis na profile):');
    const prof = (await j('/api/profile/qaEvMaster00001', {}, adm)).d || {};
    const mp = prof.points || prof.month_points || {};
    const riadok = (mp.items || []).find(i => /Masterclass/.test(i.label || ''));
    ok('rozpis bodov má riadok Masterclass', !!riadok, JSON.stringify(Object.keys(prof)).slice(0, 220));
    ok('a je za 50 bodov', riadok && riadok.points === 50, JSON.stringify(riadok));
    const profC = (await j('/api/profile/qaEvClenka00001', {}, adm)).d || {};
    const riadokC = ((profC.points || profC.month_points || {}).items || []).find(i => /Masterclass/.test(i.label || ''));
    ok('darovaný masterclass body nedáva', !riadokC || riadokC.points === 0, JSON.stringify(riadokC));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message + '\n' + (e.stack || '').split('\n')[1]);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nPREDAJ NA MIESTE: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-700));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
