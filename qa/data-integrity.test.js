/**
 * Dátová integrita kľúčových obchodných tokov (T1–T10): hodina bez krytia,
 * odpočet a vrátenie vstupu z permanentky, aktivácia a predaj členstva,
 * online hodina mimo výplaty, tréner-sponzor bez referral kreditu,
 * samoodporúčanie, nevalidné vstupy od admina, dvojitý kiosk sken.
 *
 * Samostatná inštancia: vlastný DATA_DIR, RATE_LIMIT_OFF=1, MAIL_CAPTURE=1 (nič
 * neodíde mailom), účty a hodiny zapísané priamo do .db súborov. Port je pevný,
 * nie QA_PORT — ten ukazuje na ručne spustený server s inou DB.
 *
 * Režim ako na produkcii (17. 9. 2026): „prvý týždeň zadarmo" je zapnutý
 * v settings.db, takže samoobslužná prvá hodina zadarmo neexistuje a z permanentky
 * sa platí hneď prvá rezervácia. Predtým režim závisel od env shellu (lokálne
 * vypnutý) a T1/T2 overovali cestu, ktorá na prode nebeží. Starú prvú hodinu
 * zadarmo pokrýva qa/prvy-tyzden.test.js (časť B). Ceny sa berú z
 * /api/membership/plans — po zmene cenníka 14. 9. (Silver 74,90 €) T7 padal na
 * natvrdo zapísaných 75 € / 7,50 €.
 *
 * Prečo prepis (11. 9. 2026): test sa pripájal na ručne spustený server na :3991
 * a účty registroval s menami „QA Free QAD_1789…". Od 12. 8. registrácia
 * vyžaduje celé meno bez číslic a podčiarkovníkov (validFullName), takže
 * registrácia padla, prihlásenie tiež a T1a/T2/T4a/T4c/T9 hlásili „Nie ste
 * prihlásený", hoci appka fungovala. T5 a T8 volali neexistujúce route
 * (/api/admin/finance, /api/admin/client/:id) a T7 šiel cez admin predaj, ktorý
 * referral kredit nerieši vôbec — tieto kontroly prešli vždy. Stav sa teraz
 * číta priamo z .db súborov a T7 ide cez /api/trainer/sell (activateMembership)
 * aj s kontrolnou klientkou, ktorej sponzorka kredit dostať MÁ.
 *
 * Spustenie:  node qa/data-integrity.test.js     (OUT=subor.json zapíše nálezy)
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4526;
const B = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-integrita-'));
const F = []; const OK = [];
function find(id, sev, mod, title, detail) { F.push({ id, sev, mod, title, detail }); console.log(`❌ [${sev}] ${id} — ${title}: ${detail}`); }
function pass(t) { OK.push(t); console.log(`✅ ${t}`); }

async function req(p, { method = 'GET', cookie = '', body } = {}) {
  const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch (e) { j = txt.slice(0, 150); }
  return { status: r.status, body: j, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const spi = ms => new Promise(r => setTimeout(r, ms));
// @qa-biz.local, nie @test-fa-qa.local: migrácia cleanup_qa_online_test_v1 na
// čistej DB pri štarte zmaže všetky @test-fa-qa.local účty aj s ich záznamami.
const mail = id => id.toLowerCase() + '@qa-biz.local';
const user = id => rd('users.db').find(x => x._id === id) || {};
// Neúspešné prihlásenie test zastaví — inak by každá ďalšia kontrola hlásila
// „Nie ste prihlásený" ako chybu appky (presne to sa stalo pred prepisom).
async function login(id) {
  const l = await req('/api/login', { method: 'POST', body: { email: mail(id), password: 'Heslo123!' } });
  if (l.status !== 200 || !l.cookie) throw new Error('prihlásenie ' + id + ' zlyhalo: ' + l.status + ' ' + JSON.stringify(l.body));
  return l.cookie;
}
const me = async c => (await req('/api/me', { cookie: c })).body || {};
const book = (cookie, class_id) => req('/api/bookings', { method: 'POST', cookie, body: { class_id } });

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = (_id, name, extra) => ({ _id, name, email: mail(_id), password: hash, active: true, user_type: 'client',
    created_at: '2026-01-01', visit_count: 0, free_class_used: false, single_entries: 0, free_credits: 0, referral_credit: 0, sponsor_id: null, ...extra });
  w('users.db', [
    U('qaDiAdmin00001', 'QA Admin Integrita', { is_admin: true, user_type: 'admin' }),
    U('qaDiFree000001', 'Klára Prvá'),                 // T1 — nová, bez krytia
    U('qaDiPerm000001', 'Petra Permanentková'),        // T2/T3/T9 — permanentka
    U('qaDiClen000001', 'Mária Členka'),               // T4/T5 — členstvo Silver
    U('qaDiTrener0001', 'Tamara Trénerka'),            // T7 — rolu trénera dostane cez API
    U('qaDiRef0000001', 'Renáta Odporúčaná'),          // T7/T8 — privedie ju trénerka
    U('qaDiSponz00001', 'Soňa Sponzorka'),             // T7 kontrola — klientka ako sponzorka
    U('qaDiKamos00001', 'Olga Kamošová', { sponsor_id: 'qaDiSponz00001' }),
    U('qaDiKiosk00001', 'Kamila Kiosková', { single_entries: 2 }), // T10 — permanentka
  ]);
  // Minulý mesiac aj minulý rok sú už vyhlásené — inak by server pri štarte
  // korunoval niektorú z testovacích klientok a dal jej Gold (T4 by nesedel).
  const sk = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const pm = new Date(+sk.slice(0, 4), +sk.slice(5, 7) - 2, 1);
  w('monthly_winners.db', [
    { _id: 'qaDiWinner0001', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'qaDiAdmin00001', created_at: '2026-01-01' },
    { _id: 'qaDiWinRok0001', month: String(+sk.slice(0, 4) - 1), type: 'year', user_id: 'qaDiAdmin00001', created_at: '2026-01-01' },
  ]);
  // Zumby o 2 a 3 dni (dá sa ich stornovať), online hodina a hodina v Detve,
  // ktorá práve beží — kiosk zapíše účasť len na hodinu „teraz".
  const dow = n => new Date(Date.now() + n * 864e5).getDay();
  const teraz = new Date(); const m0 = Math.max(0, teraz.getHours() * 60 + teraz.getMinutes() - 5);
  const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const Z = (_id, extra) => ({ _id, name: 'Zumba', emoji: '🎵', category: 'Zumba', location: 'Detva', instructor: 'QA Tréner',
    time_start: '19:00', time_end: '20:00', capacity: 20, active: true, price: 10, ...extra });
  w('classes.db', [
    Z('qaDiZumba00001', { day_of_week: dow(2) }),
    Z('qaDiZumba00002', { day_of_week: dow(3) }),
    Z('qaDiOnline0001', { name: 'Zumba ONLINE – LIVE', category: 'Online', location: 'Online', day_of_week: dow(2), capacity: 100 }),
    Z('qaDiKioskHod01', { day_of_week: teraz.getDay(), time_start: hhmm(m0), time_end: hhmm(Math.min(m0 + 60, 23 * 60 + 59)) }),
  ]);
  // Prvý týždeň zadarmo zapnutý ako na produkcii — nastavenie má prednosť pred env
  // (PRVY_TYZDEN, NODE_ENV), výsledok teda nezávisí od shellu, z ktorého test beží.
  w('settings.db', [{ _id: 'qaDiSetSkuska1', key: 'prvy_tyzden', value: true, at: '2026-01-01T00:00:00.000Z' }]);

  console.log('=== DATA INTEGRITY ===\n');
  // Ak na porte už niečo beží, test by sa pripojil tam a čítal by inú DB ako svoju.
  const upratDb = () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} };
  if (await fetch(B + '/').then(() => true, () => false)) { console.log(`❌ port ${PORT} je obsadený — zastav tamojší server`); upratDb(); process.exit(1); }
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: B, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' } });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000 && srv.exitCode === null) { try { await fetch(B + '/'); zije = true; break; } catch (e) { await spi(1000); } }
  if (!zije) { console.log('❌ server nenabehol'); console.log(chyba.slice(0, 1200)); srv.kill(); upratDb(); process.exit(1); }
  await spi(15000); // migrácie a štartovacie joby

  try {
    const A = await login('qaDiAdmin00001');
    const c1 = 'qaDiZumba00001', c2 = 'qaDiZumba00002';
    const cennik = (await req('/api/membership/plans')).body || {};
    const silver = +cennik.silver?.price;
    if (!(silver > 0)) throw new Error('cenník bez Silver: ' + JSON.stringify(cennik).slice(0, 150));

    // ── T1: nová klientka bez krytia — hodinu nedostane zadarmo a nič sa nespotrebuje ──
    const u1 = await login('qaDiFree000001');
    const b1 = await book(u1, c1);
    await spi(200);
    const k1 = user('qaDiFree000001');
    const z1 = rd('bookings.db').filter(b => b.user_id === 'qaDiFree000001').length;
    if (b1.status === 200) find('T1', 'P1', 'monetizácia', 'Hodina bez členstva prešla ZADARMO', `→ 200 ${JSON.stringify(b1.body)} (očakávané 402 membership_required)`);
    else if (b1.status !== 402 || b1.body?.error !== 'membership_required' || b1.body?.trial_available !== true)
      find('T1', 'P2', 'rezervácie', 'Hodina bez krytia zamietnutá z nečakaného dôvodu', `→ ${b1.status} ${JSON.stringify(b1.body)} (očakávané 402 + ponuka skúšky)`);
    else if (z1 !== 0 || k1.free_class_used !== false || k1.single_entries !== 0)
      find('T1', 'P1', 'rezervácie', 'Zamietnutá rezervácia aj tak niečo zapísala alebo spotrebovala', `záznamov ${z1}, free_class_used=${k1.free_class_used}, vstupy=${k1.single_entries}`);
    else pass('T1: bez krytia 402 s ponukou skúšky, nič sa nezapísalo ani nespotrebovalo');

    // ── T2: permanentka — presne 1 vstup za KAŽDÚ rezerváciu, aj za prvú ──
    const u2 = await login('qaDiPerm000001');
    const add = await req('/api/admin/users/qaDiPerm000001/entries', { method: 'POST', cookie: A, body: { op: 'add', amount: 10 } });
    const before = (await me(u2)).single_entries;
    const p1 = await book(u2, c1);
    const mid = (await me(u2)).single_entries;
    const p2 = await book(u2, c2);
    const after = (await me(u2)).single_entries;
    await spi(200);
    const zap2 = rd('bookings.db').filter(b => b.user_id === 'qaDiPerm000001' && b.status !== 'cancelled');
    const k2 = user('qaDiPerm000001');
    if (add.body?.single_entries !== 10 || before !== 10 || p1.status !== 200 || p2.status !== 200 || mid !== 9 || after !== 8)
      find('T2', 'P0', 'kredity', 'Nesprávny odpočet vstupov z permanentky', `pridané ${add.status}/${add.body?.single_entries}, rezervácie ${p1.status}/${p2.status}, zostatok ${before}→${mid}→${after} (očakávané 10→9→8) ${JSON.stringify(p1.body).slice(0, 120)}`);
    else if (k2.single_entries !== 8 || k2.free_class_used !== false || zap2.length !== 2 || !zap2.every(b => b.access_method === 'single_entry'))
      find('T2', 'P1', 'kredity', 'Rezervácie z permanentky nie sú zapísané ako platené vstupom', `db vstupy=${k2.single_entries}, free_class_used=${k2.free_class_used}, rezervácie ${JSON.stringify(zap2.map(b => b.access_method))}`);
    else pass(`T2: každá rezervácia odpočítala presne 1 vstup (${before}→${mid}→${after}), prvá zdarma sa nespotrebovala`);

    // ── T3: zrušenie rezervácie vráti vstup práve raz ──
    const last = zap2.find(b => b.class_id === c2);
    if (!last) find('T3', 'P1', 'kredity', 'Rezervácia z permanentky sa nezapísala', 'v bookings.db nie je');
    else {
      const d3 = await req('/api/bookings/' + last._id, { method: 'DELETE', cookie: u2 });
      const afterCancel = (await me(u2)).single_entries;
      const d3b = await req('/api/bookings/' + last._id, { method: 'DELETE', cookie: u2 }); // druhý klik / druhý tab
      const afterTwice = (await me(u2)).single_entries;
      await spi(200);
      const stav3 = rd('bookings.db').find(b => b._id === last._id)?.status;
      if (d3.status !== 200 || d3.body?.refunded !== true) find('T3', 'P1', 'rezervácie', 'Storno 3 dni vopred neprešlo alebo nehlási vrátenie', `→ ${d3.status} ${JSON.stringify(d3.body)}`);
      else if (afterCancel !== after + 1 || stav3 !== 'cancelled') find('T3', 'P1', 'kredity', 'Po zrušení rezervácie sa vstup NEVRÁTI', `zostatok ${after}→${afterCancel} (očakávané ${after + 1}), stav ${stav3}`);
      else if (d3b.body?.already !== true || afterTwice !== afterCancel) find('T3', 'P0', 'kredity', 'Opakované storno vrátilo vstup druhýkrát', `→ ${d3b.status} ${JSON.stringify(d3b.body)}, zostatok ${afterCancel}→${afterTwice}`);
      else pass(`T3: zrušenie vrátilo vstup práve raz (${after}→${afterCancel}, 2. storno: already)`);
    }

    // ── T4: členstvo — aktivácia a dátum expirácie ──
    const u3 = await login('qaDiClen000001');
    // 75 € zámerne nesedí s cenníkom (74,90) — T5 overí, že sa zapíše zadaná suma
    const g4 = await req('/api/admin/users/qaDiClen000001/grant-membership', { method: 'POST', cookie: A, body: { plan_id: 'silver', gift: false, amount: 75, payment_method: 'cash' } });
    const mem = (await me(u3)).membership;
    if (g4.status !== 200 || !mem || !mem.expires_at) find('T4a', 'P1', 'členstvá', 'Členstvo sa neaktivovalo', `→ ${g4.status} ${JSON.stringify(mem)}`);
    else {
      const days = Math.round((new Date(mem.expires_at) - Date.now()) / 86400000);
      if (mem.plan_id !== 'silver' || days < 27 || days > 32) find('T4b', 'P2', 'členstvá', 'Nesprávne členstvo', `${mem.plan_id}, expiruje o ${days} dní (očakávané Silver ~30)`);
      else pass(`T4: členstvo Silver aktívne, expiruje o ${days} dní`);
    }
    // člen s členstvom môže neobmedzene rezervovať
    const mb1 = await book(u3, c1), mb2 = await book(u3, c2);
    if (mb1.status === 200 && mb2.status === 200) pass('T4: člen rezervuje neobmedzene');
    else find('T4c', 'P1', 'členstvá', 'Člen nemôže rezervovať', `${mb1.status}/${mb2.status}`);
    const entriesAfterMem = (await me(u3)).single_entries;
    if (entriesAfterMem !== 0) find('T4d', 'P1', 'kredity', 'Členovi sa hýbu vstupy', `zostatok ${entriesAfterMem}`);

    // ── T5: predaj členstva v hotovosti je zapísaný práve raz ──
    await spi(300);
    const tx5 = rd('transactions.db').filter(t => t.user_id === 'qaDiClen000001' && t.type === 'membership');
    const mem5 = rd('memberships.db').filter(m => m.user_id === 'qaDiClen000001' && m.status === 'active');
    if (tx5.length !== 1 || tx5[0].amount !== 75 || tx5[0].payment_method !== 'cash' || mem5.length !== 1 || mem5[0].payment_method !== 'cash' || mem5[0].price !== 75)
      find('T5', 'P1', 'tržby', 'Predaj členstva v hotovosti nie je zapísaný práve raz za 75 €',
        JSON.stringify({ tx: tx5.map(t => [t.amount, t.payment_method]), clenstva: mem5.map(m => [m.price, m.payment_method]) }));
    else pass('T5: predaj Silver v hotovosti — 1 transakcia 75 € + členstvo s platbou');

    // ── T6: online hodina nesmie tvoriť výplatu ani odučenú hodinu ──
    const conf = await req('/api/attendance/confirm-session', { method: 'POST', cookie: A, body: { class_id: 'qaDiOnline0001', present_ids: [] } });
    if (conf.status === 200) find('T6', 'P1', 'výplaty', 'Online hodinu možno potvrdiť ako odučenú (ide do výplaty)', '→ 200');
    else if (conf.status === 400) pass('T6: online hodina sa nedá potvrdiť do výplaty');
    else find('T6', 'P2', 'výplaty', 'Potvrdenie online hodiny vrátilo nečakaný stav', `→ ${conf.status} ${JSON.stringify(conf.body)}`);

    // ── T7: tréner ako sponzor nedostáva kredit (dvojitá affiliate) ──
    // Predaj na mieste (/api/trainer/sell) ide cez activateMembership, kde sa
    // sponzorke pripisuje 10 % z cenníkovej ceny. Kontrola: klientka-sponzorka ho dostať MÁ.
    const kredit7 = +(silver * 0.10).toFixed(2);
    const role = await req('/api/admin/users/qaDiTrener0001/role', { method: 'PUT', cookie: A, body: { user_type: 'trainer' } });
    const sp = await req('/api/admin/users/qaDiRef0000001/sponsor', { method: 'PUT', cookie: A, body: { sponsor_id: 'qaDiTrener0001' } });
    const s7 = await req('/api/trainer/sell', { method: 'POST', cookie: A, body: { user_id: 'qaDiRef0000001', kind: 'plan', plan_id: 'silver' } });
    const s7k = await req('/api/trainer/sell', { method: 'POST', cookie: A, body: { user_id: 'qaDiKamos00001', kind: 'plan', plan_id: 'silver' } });
    await spi(500);
    const tr = user('qaDiTrener0001'), sona = user('qaDiSponz00001');
    if (role.status !== 200 || sp.status !== 200 || s7.status !== 200 || s7k.status !== 200)
      find('T7', 'P1', 'financie', 'Príprava T7 zlyhala', `rola ${role.status}, sponzor ${sp.status}, predaj ${s7.status}/${s7k.status} ${JSON.stringify(s7.body)}`);
    else if (s7.body?.amount !== silver) find('T7', 'P2', 'tržby', 'Predaj Silver na mieste nie je za cenníkovú cenu', `predané za ${s7.body?.amount} € (cenník ${silver} €)`);
    else if (sona.referral_credit !== kredit7) find('T7', 'P2', 'financie', 'Kontrola: klientka-sponzorka nedostala 10 % kredit', `kredit=${sona.referral_credit} (očakávané ${kredit7}) — bez toho T7 nič neoverí`);
    else if ((tr.referral_credit || 0) > 0) find('T7', 'P1', 'financie', 'Tréner dostal referral kredit AJ do dashboardu (dvojitá affiliate)', `kredit=${tr.referral_credit}`);
    else if (!rd('transactions.db').some(t => t.partner_id === 'qaDiTrener0001' && t.client_id === 'qaDiRef0000001' && t.commission_only && t.amount === silver))
      find('T7', 'P2', 'výplaty', 'Trénerovi sa nezapísala affiliate provízia', `chýba transakcia commission_only ${silver} €`);
    else pass(`T7: tréner nedostáva kredit (affiliate ${silver} € ide do výplaty), klientka-sponzorka ${kredit7} € áno`);

    // ── T8: samoodporúčanie ──
    const self = await req('/api/admin/users/qaDiRef0000001/sponsor', { method: 'PUT', cookie: A, body: { sponsor_id: 'qaDiRef0000001' } });
    await spi(200);
    const sp8 = user('qaDiRef0000001').sponsor_id;
    if (self.status === 200 || sp8 === 'qaDiRef0000001') find('T8', 'P2', 'referral', 'Povolené samoodporúčanie (sponzor = ten istý človek)', `→ ${self.status}, sponsor_id=${sp8}`);
    else if (sp8 !== 'qaDiTrener0001') find('T8', 'P2', 'referral', 'Zamietnuté samoodporúčanie zmenilo pôvodného sponzora', `sponsor_id=${sp8}`);
    else pass('T8: samoodporúčanie zamietnuté, sponzor ostal');

    // ── T9: nesprávne dátové typy / záporné hodnoty ──
    const e0 = (await me(u2)).single_entries; // po T3: 9
    const neg = await req('/api/admin/users/qaDiPerm000001/entries', { method: 'POST', cookie: A, body: { op: 'add', amount: -5 } });
    await req('/api/admin/users/qaDiPerm000001/entries', { method: 'POST', cookie: A, body: { op: 'sub', amount: 999 } });
    // Najprv platná úprava — inak by „kredit ostal 0" prešlo, aj keby endpoint nerobil nič.
    const credit = body => req('/api/admin/users/qaDiPerm000001/credit', { method: 'POST', cookie: A, body });
    const ok9 = await credit({ op: 'add', amount: 5 });
    const bad = await credit({ op: 'add', amount: 'abc' });
    const inf = await credit({ op: 'add', amount: 'Infinity' }); // aj „1e400" z číselného poľa
    const m9 = await me(u2);
    await spi(200);
    const k9 = user('qaDiPerm000001').referral_credit;
    if (ok9.status !== 200 || ok9.body?.referral_credit !== 5) find('T9', 'P1', 'validácie', 'Platná úprava kreditu nezbehla — kontrola nevalidných vstupov nič neoverí', `→ ${ok9.status} ${JSON.stringify(ok9.body)}`);
    else if (bad.status !== 400 || inf.status !== 400 || m9.referral_credit !== 5 || k9 !== 5)
      find('T9', 'P1', 'validácie', 'Kredit sa poškodil nevalidným vstupom', `„abc" → ${bad.status}, „Infinity" → ${inf.status} ${JSON.stringify(inf.body)}, /api/me=${JSON.stringify(m9.referral_credit)}, db=${JSON.stringify(k9)} (očakávané 400/400, 5 €)`);
    else {
      const sub9 = await credit({ op: 'sub', amount: 999 });
      await spi(200);
      const k9b = user('qaDiPerm000001').referral_credit;
      if (sub9.body?.referral_credit !== 0 || k9b !== 0) find('T9', 'P1', 'validácie', 'Kredit ide pod nulu', `5 − 999 → ${JSON.stringify(sub9.body)}, db=${k9b}`);
      else pass('T9: nevalidná suma kreditu odmietnutá, kredit ostal 5 € a nejde pod nulu');
    }
    if (neg.body?.single_entries !== Math.max(0, e0 - 5) || m9.single_entries !== 0)
      find('T9b', 'P1', 'validácie', 'Odobratie vstupov nesedí alebo ide pod nulu', `${e0} −5 → ${neg.body?.single_entries}, −999 → ${m9.single_entries}`);
    else pass(`T9: odobratie vstupov nejde pod nulu (${e0}→${neg.body.single_entries}→${m9.single_entries})`);

    // ── T10: kiosk — dvojitý sken nepridá návštevu ani neodpočíta vstup 2× ──
    // Kiosk od 14. 9. volá /api/kiosk/day-classes (po skene) a /api/kiosk/signup
    // (potvrdenie výberu). Starý /api/kiosk/checkin už nevolá, preto ide len ako
    // tretí sken — ani ten nesmie nič pridať.
    await req('/api/admin/kiosk', { cookie: A }); // založí kiosk config
    const en = await req('/api/admin/kiosk/detva', { method: 'PUT', cookie: A, body: { enabled: true } });
    const tok = ((await req('/api/admin/kiosk', { cookie: A })).body?.studios || []).find(s => s.slug === 'detva')?.token;
    const kiosk = (p, body) => req('/api/kiosk/' + p, { method: 'POST', body: { studio: 'detva', k: tok, qr_data: 'FA:qaDiKiosk00001', ...body } });
    const stav10 = () => { const k = user('qaDiKiosk00001'); return { v: k.visit_count || 0, e: k.single_entries,
      z: rd('bookings.db').filter(b => b.user_id === 'qaDiKiosk00001' && b.class_id === 'qaDiKioskHod01' && b.status !== 'cancelled') }; };
    const dc = await kiosk('day-classes');
    const hod = (dc.body?.classes || []).find(c => c.id === 'qaDiKioskHod01');
    // Štartovacie migrácie pridávajú do rozvrhu aj reálne hodiny — klientka si na
    // obrazovke odklikne tú svoju, preto ju posielame menovite.
    const s1 = await kiosk('signup', { class_ids: ['qaDiKioskHod01'] }); await spi(300);
    const t1 = stav10();
    const s2 = await kiosk('signup', { class_ids: ['qaDiKioskHod01'] }); await spi(300);
    const t2 = stav10();
    const s3 = await kiosk('checkin', { class_id: 'qaDiKioskHod01' }); await spi(300);
    const t3 = stav10();
    if (en.status !== 200 || !tok || dc.status !== 200 || !hod?.ucast || dc.body?.krytie?.vstupy !== 2)
      find('T10', 'P1', 'dochádzka', 'Kiosk po skene neponúkol bežiacu hodinu so vstupmi', `kiosk ${en.status}, token ${!!tok}, day-classes → ${dc.status} ${JSON.stringify(hod || dc.body).slice(0, 200)}, krytie ${JSON.stringify(dc.body?.krytie)}`);
    else if (s1.status !== 200 || s1.body?.zapisane?.length !== 1 || s1.body.zapisane[0].teraz !== true)
      find('T10', 'P1', 'dochádzka', 'Prvý kiosk sken nezapísal účasť', `→ ${s1.status} ${JSON.stringify(s1.body).slice(0, 200)}`);
    else if (t1.v !== 1 || t1.e !== 1 || t1.z.length !== 1 || t1.z[0].status !== 'attended' || t1.z[0].access_method !== 'single_entry')
      find('T10', 'P1', 'dochádzka', 'Kiosk sken nezapísal účasť zo vstupu', `návštevy ${t1.v}, vstupy 2→${t1.e}, záznamy ${JSON.stringify(t1.z.map(b => [b.status, b.access_method]))}`);
    else if (t2.v !== t1.v || t2.e !== t1.e || t2.z.length !== 1 || t3.v !== t1.v || t3.e !== t1.e || t3.z.length !== 1)
      find('T10', 'P0', 'dochádzka', 'Dvojitý kiosk sken pripísal návštevu alebo vstup 2×', `návštevy ${t1.v}→${t2.v}→${t3.v}, vstupy ${t1.e}→${t2.e}→${t3.e}, záznamov ${t1.z.length}→${t2.z.length}→${t3.z.length}`);
    else if (s2.status !== 200 || s2.body?.zapisane?.length !== 0 || s2.body?.uz_mala !== 1 || s3.body?.already !== true)
      find('T10', 'P2', 'dochádzka', 'Opakovaný sken nehlási, že už je zapísaná', `signup → ${s2.status} ${JSON.stringify(s2.body).slice(0, 150)}, checkin → ${s3.status} ${JSON.stringify(s3.body).slice(0, 150)}`);
    else pass(`T10: dvojitý sken nepridal návštevu ani vstup (návštevy ${t1.v}→${t3.v}, vstupy 2→${t1.e}→${t3.e}, opakovanie: už_mala / already)`);
    await req('/api/admin/kiosk/detva', { method: 'PUT', cookie: A, body: { enabled: false } });
  } catch (e) {
    find('FATAL', 'P0', 'test', 'Výnimka v teste', e.message);
  } finally {
    srv.kill();
    setTimeout(() => {
      upratDb();
      console.log('\n=== VÝSLEDOK ===');
      console.log('PASS:', OK.length, '| NÁLEZY:', F.length);
      if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ findings: F, passed: OK.length }, null, 1));
      if (F.length && chyba) console.log(chyba.slice(-900));
      process.exit(F.length ? 1 : 0);
    }, 500);
  }
})();
