/**
 * Dátová integrita kľúčových obchodných tokov (T1–T10): prvá hodina zdarma,
 * odpočet a vrátenie vstupu z permanentky, aktivácia a predaj členstva,
 * online hodina mimo výplaty, tréner-sponzor bez referral kreditu,
 * samoodporúčanie, nevalidné vstupy od admina, dvojitý kiosk sken.
 *
 * Samostatná inštancia: vlastný DATA_DIR, RATE_LIMIT_OFF=1, MAIL_CAPTURE=1 (nič
 * neodíde mailom), účty a hodiny zapísané priamo do .db súborov.
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
    U('qaDiFree000001', 'Klára Prvá'),                 // T1 — nová, prvá hodina zdarma
    U('qaDiPerm000001', 'Petra Permanentková'),        // T2/T3/T9 — permanentka
    U('qaDiClen000001', 'Mária Členka'),               // T4/T5 — členstvo Silver
    U('qaDiTrener0001', 'Tamara Trénerka'),            // T7 — rolu trénera dostane cez API
    U('qaDiRef0000001', 'Renáta Odporúčaná'),          // T7/T8 — privedie ju trénerka
    U('qaDiSponz00001', 'Soňa Sponzorka'),             // T7 kontrola — klientka ako sponzorka
    U('qaDiKamos00001', 'Olga Kamošová', { sponsor_id: 'qaDiSponz00001' }),
    U('qaDiKiosk00001', 'Kamila Kiosková'),            // T10
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

  console.log('=== DATA INTEGRITY ===\n');
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: B, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' } });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(B + '/'); zije = true; break; } catch (e) { await spi(1000); } }
  if (!zije) { console.log('❌ server nenabehol'); console.log(chyba.slice(0, 1200)); srv.kill(); process.exit(1); }
  await spi(15000); // migrácie a štartovacie joby

  try {
    const A = await login('qaDiAdmin00001');
    const c1 = 'qaDiZumba00001', c2 = 'qaDiZumba00002';

    // ── T1: prvá hodina zdarma, druhá vyžaduje členstvo ──
    const u1 = await login('qaDiFree000001');
    const b1 = await book(u1, c1);
    if (b1.status !== 200) find('T1a', 'P1', 'rezervácie', 'Prvá hodina zdarma nefunguje', `→ ${b1.status} ${JSON.stringify(b1.body)}`);
    else pass('T1: prvá hodina zdarma prešla');
    const b2 = await book(u1, c2);
    if (b2.status === 200) find('T1b', 'P1', 'monetizácia', 'Druhá hodina bez členstva prešla ZADARMO', '→ 200 (očakávané 402 membership_required)');
    else if (b2.status === 402 && b2.body?.error === 'membership_required') pass('T1: druhá hodina správne vyžaduje členstvo');
    else find('T1b', 'P2', 'rezervácie', 'Druhá hodina zablokovaná z nečakaného dôvodu', `→ ${b2.status} ${JSON.stringify(b2.body)}`);

    // ── T2: permanentka — presne 1 vstup za rezerváciu ──
    const u2 = await login('qaDiPerm000001');
    const add = await req('/api/admin/users/qaDiPerm000001/entries', { method: 'POST', cookie: A, body: { op: 'add', amount: 10 } });
    const f2 = await book(u2, c1); // 1. = zdarma
    const before = (await me(u2)).single_entries;
    const p2 = await book(u2, c2); // 2. = z permanentky
    const after = (await me(u2)).single_entries;
    const used = before - after;
    if (add.body?.single_entries !== 10 || f2.status !== 200 || p2.status !== 200 || before !== 10 || used !== 1)
      find('T2', 'P0', 'kredity', 'Nesprávny odpočet vstupov z permanentky', `pridané ${add.status}/${add.body?.single_entries}, rezervácie ${f2.status}/${p2.status}, pred=${before} po=${after} odpočítané=${used} (očakávané 10→9)`);
    else pass(`T2: permanentka odpočítala presne 1 vstup (${before}→${after})`);

    // ── T3: zrušenie rezervácie — vráti sa vstup? ──
    await spi(300);
    const last = rd('bookings.db').find(b => b.user_id === 'qaDiPerm000001' && b.class_id === c2 && b.status !== 'cancelled');
    if (!last) find('T3', 'P1', 'kredity', 'Rezervácia z permanentky sa nezapísala', 'v bookings.db nie je');
    else {
      const d3 = await req('/api/bookings/' + last._id, { method: 'DELETE', cookie: u2 });
      const afterCancel = (await me(u2)).single_entries;
      if (d3.status !== 200) find('T3', 'P1', 'rezervácie', 'Storno 3 dni vopred neprešlo', `→ ${d3.status} ${JSON.stringify(d3.body)}`);
      else if (afterCancel !== before) find('T3', 'P1', 'kredity', 'Po zrušení rezervácie sa vstup NEVRÁTI', `zostatok ${after}→${afterCancel} (očakávané ${before})`);
      else pass(`T3: zrušenie vrátilo vstup (${after}→${afterCancel})`);
    }

    // ── T4: členstvo — aktivácia a dátum expirácie ──
    const u3 = await login('qaDiClen000001');
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
    // sponzorke pripisuje 10 % kredit. Kontrola: klientka-sponzorka ho dostať MÁ.
    const role = await req('/api/admin/users/qaDiTrener0001/role', { method: 'PUT', cookie: A, body: { user_type: 'trainer' } });
    const sp = await req('/api/admin/users/qaDiRef0000001/sponsor', { method: 'PUT', cookie: A, body: { sponsor_id: 'qaDiTrener0001' } });
    const s7 = await req('/api/trainer/sell', { method: 'POST', cookie: A, body: { user_id: 'qaDiRef0000001', kind: 'plan', plan_id: 'silver' } });
    const s7k = await req('/api/trainer/sell', { method: 'POST', cookie: A, body: { user_id: 'qaDiKamos00001', kind: 'plan', plan_id: 'silver' } });
    await spi(500);
    const tr = user('qaDiTrener0001'), sona = user('qaDiSponz00001');
    if (role.status !== 200 || sp.status !== 200 || s7.status !== 200 || s7k.status !== 200)
      find('T7', 'P1', 'financie', 'Príprava T7 zlyhala', `rola ${role.status}, sponzor ${sp.status}, predaj ${s7.status}/${s7k.status} ${JSON.stringify(s7.body)}`);
    else if (sona.referral_credit !== 7.5) find('T7', 'P2', 'financie', 'Kontrola: klientka-sponzorka nedostala 10 % kredit', `kredit=${sona.referral_credit} (očakávané 7.5) — bez toho T7 nič neoverí`);
    else if ((tr.referral_credit || 0) > 0) find('T7', 'P1', 'financie', 'Tréner dostal referral kredit AJ do dashboardu (dvojitá affiliate)', `kredit=${tr.referral_credit}`);
    else if (!rd('transactions.db').some(t => t.partner_id === 'qaDiTrener0001' && t.commission_only && t.amount === 75))
      find('T7', 'P2', 'výplaty', 'Trénerovi sa nezapísala affiliate provízia', 'chýba transakcia commission_only 75 €');
    else pass('T7: tréner nedostáva kredit (affiliate ide do výplaty), klientka-sponzorka 10 % áno');

    // ── T8: samoodporúčanie ──
    const self = await req('/api/admin/users/qaDiRef0000001/sponsor', { method: 'PUT', cookie: A, body: { sponsor_id: 'qaDiRef0000001' } });
    await spi(200);
    const sp8 = user('qaDiRef0000001').sponsor_id;
    if (self.status === 200 || sp8 === 'qaDiRef0000001') find('T8', 'P2', 'referral', 'Povolené samoodporúčanie (sponzor = ten istý človek)', `→ ${self.status}, sponsor_id=${sp8}`);
    else if (sp8 !== 'qaDiTrener0001') find('T8', 'P2', 'referral', 'Zamietnuté samoodporúčanie zmenilo pôvodného sponzora', `sponsor_id=${sp8}`);
    else pass('T8: samoodporúčanie zamietnuté, sponzor ostal');

    // ── T9: nesprávne dátové typy / záporné hodnoty ──
    const e0 = (await me(u2)).single_entries; // po T3 znova 10
    const neg = await req('/api/admin/users/qaDiPerm000001/entries', { method: 'POST', cookie: A, body: { op: 'add', amount: -5 } });
    await req('/api/admin/users/qaDiPerm000001/entries', { method: 'POST', cookie: A, body: { op: 'sub', amount: 999 } });
    const bad = await req('/api/admin/users/qaDiPerm000001/credit', { method: 'POST', cookie: A, body: { amount: 'abc' } });
    const m9 = await me(u2);
    await spi(200);
    const k9 = user('qaDiPerm000001').referral_credit;
    if (bad.status !== 400 || typeof m9.referral_credit !== 'number' || isNaN(m9.referral_credit) || k9 !== 0)
      find('T9', 'P1', 'validácie', 'Kredit sa poškodil nevalidným vstupom', `→ ${bad.status}, /api/me=${JSON.stringify(m9.referral_credit)}, db=${JSON.stringify(k9)}`);
    else pass('T9: nevalidná suma kreditu odmietnutá, kredit ostal platné číslo');
    if (neg.body?.single_entries !== Math.max(0, e0 - 5) || m9.single_entries !== 0)
      find('T9b', 'P1', 'validácie', 'Odobratie vstupov nesedí alebo ide pod nulu', `${e0} −5 → ${neg.body?.single_entries}, −999 → ${m9.single_entries}`);
    else pass(`T9: odobratie vstupov nejde pod nulu (${e0}→${neg.body.single_entries}→${m9.single_entries})`);

    // ── T10: kiosk check-in — dvojitý sken nepridá 2× ──
    await req('/api/admin/kiosk', { cookie: A }); // založí kiosk config
    const en = await req('/api/admin/kiosk/detva', { method: 'PUT', cookie: A, body: { enabled: true } });
    const tok = ((await req('/api/admin/kiosk', { cookie: A })).body?.studios || []).find(s => s.slug === 'detva')?.token;
    // Štartovacie migrácie pridávajú do rozvrhu aj reálne hodiny — keď v Detve práve
    // beží ďalšia, kiosk sa pýta, na ktorú ide (choose). Hodinu preto volíme rovno,
    // tak ako to klientka spraví na obrazovke kiosku.
    const scan = () => req('/api/kiosk/checkin', { method: 'POST', body: { qr_data: 'FA:qaDiKiosk00001', k: tok, studio: 'detva', class_id: 'qaDiKioskHod01' } });
    const s1 = await scan(); await spi(300);
    const v1 = user('qaDiKiosk00001').visit_count || 0;
    const s2 = await scan(); await spi(300);
    const v2 = user('qaDiKiosk00001').visit_count || 0;
    const zapisy = rd('bookings.db').filter(b => b.user_id === 'qaDiKiosk00001' && b.class_id === 'qaDiKioskHod01' && b.status !== 'cancelled').length;
    if (en.status !== 200 || !tok || s1.status !== 200 || !s1.body?.class_name)
      find('T10', 'P1', 'dochádzka', 'Prvý kiosk sken nezapísal účasť', `kiosk ${en.status}, token ${!!tok}, sken → ${s1.status} ${JSON.stringify(s1.body)}`);
    else if (v1 < 1) find('T10', 'P1', 'dochádzka', 'Kiosk sken nepripísal návštevu', `visit_count=${v1}`);
    else if (v2 > v1 || zapisy !== 1) find('T10', 'P0', 'dochádzka', 'Dvojitý kiosk sken pripísal návštevu 2×', `${v1}→${v2}, záznamov ${zapisy}`);
    else if (s2.body?.already !== true) find('T10', 'P2', 'dochádzka', 'Druhý sken nehlási, že už je zapísaná', `→ ${s2.status} ${JSON.stringify(s2.body)}`);
    else pass(`T10: dvojitý sken nepridal duplicitnú návštevu (${v1}→${v2}, 2. sken: already)`);
    await req('/api/admin/kiosk/detva', { method: 'PUT', cookie: A, body: { enabled: false } });
  } catch (e) {
    find('FATAL', 'P0', 'test', 'Výnimka v teste', e.message);
  } finally {
    srv.kill();
    setTimeout(() => {
      try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
      console.log('\n=== VÝSLEDOK ===');
      console.log('PASS:', OK.length, '| NÁLEZY:', F.length);
      if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ findings: F, passed: OK.length }, null, 1));
      if (F.length && chyba) console.log(chyba.slice(-900));
      process.exit(F.length ? 1 : 0);
    }, 500);
  }
})();
