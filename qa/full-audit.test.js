/**
 * KOMPLETNÝ E2E AUDIT — predaje, členstvá, rezervácie, účtovníctvo, gamifikácia,
 * bezpečnosť a integrita dát. Beží VÝHRADNE proti izolovanej lokálnej inštancii
 * (čerstvá DATA_DIR), takže produkčné dáta, štatistiky ani maily nie sú dotknuté.
 *
 * Spustenie:
 *   RATE_LIMIT_OFF=1 DATA_DIR=<tmp> PORT=3999 SMTP_HOST=127.0.0.1 SMTP_PORT=9 node server.js &
 *   node qa/full-audit.test.js
 */
const BASE = 'http://localhost:' + (process.env.QA_PORT || 3999);
let PASS = 0, FAIL = 0; const FAILS = [];
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; FAILS.push({ name, detail }); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
const jars = {};
async function call(jar, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (jars[jar]) headers['Cookie'] = jars[jar];
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jars[jar] = sc.split(';')[0];
  let data = null; try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}
const g = (jar, p) => call(jar, 'GET', p);
const post = (jar, p, b) => call(jar, 'POST', p, b);
const put = (jar, p, b) => call(jar, 'PUT', p, b);
const del = (jar, p) => call(jar, 'DELETE', p);

(async () => {
  console.log('\n═══ FULL AUDIT — izolovaná inštancia ═══');

  // ── 0. Prihlásenia a testovacie účty ──────────────────────────────────────
  console.log('\n[0] Setup');
  const al = await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });
  ok('admin login', al.status === 200 && al.data.ok);
  const mk = (jar, name, email, extra = {}) => post(jar, '/api/register', { name, email, password: 'AuditPass123!', city: 'Zvolen', consent: true, ...extra });
  const rA = await mk('A', 'AUDIT Klientka A', 'audit-a@test-fa-qa.local');
  ok('register klientka A', rA.status === 200);
  const meA0 = (await g('A', '/api/me')).data;
  // B registrovaná so sponzorským kódom A (referral test)
  const refA = (await g('A', '/api/client/referral')).data || {};
  const codeA = refA.referral_code || (String(refA.ref_link || '').split('ref=')[1] || '');
  const rB = await mk('B', 'AUDIT Klientka B', 'audit-b@test-fa-qa.local', { sponsorCode: codeA });
  ok('register klientka B (referral A)', rB.status === 200);
  const rC = await mk('C', 'AUDIT Klientka C', 'audit-c@test-fa-qa.local');
  ok('register klientka C', rC.status === 200);
  const meB0 = (await g('B', '/api/me')).data;
  const meC0 = (await g('C', '/api/me')).data;

  // Nájdeme si triedu (Zumba Zvolen) na rezervácie
  const classes = (await g('A', '/api/classes')).data || [];
  const cls = classes.find(c => c.category === 'Zumba' && c.location === 'Zvolen');
  const clsOnline = classes.find(c => c.category === 'Online');
  ok('existuje Zumba trieda aj Online trieda', !!cls && !!clsOnline);
  const nextDate = (dow => { const d = new Date(); while (d.getDay() !== dow) d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })(cls.day_of_week);

  // ── 1. PREDAJ Z ADMIN PANELU ─────────────────────────────────────────────
  console.log('\n[1] Admin predaje');
  // 1a. Jednorazový vstup (platený cash)
  let r = await post('admin', `/api/admin/users/${meA0.id}/grant-membership`, { plan_id: 'vstup1', gift: false, payment_method: 'cash', amount: 10 });
  ok('predaj: jednorazový vstup (cash 10€)', r.status === 200 && r.data.ok);
  let meA = (await g('A', '/api/me')).data;
  ok('vstup pripísaný klientke A (single_entries=1)', meA.single_entries === 1);
  // 1b. Permanentka 10 vstupov (platená 80€)
  r = await post('admin', `/api/admin/users/${meB0.id}/grant-membership`, { plan_id: 'permanentka10', gift: false, payment_method: 'cash', amount: 80 });
  ok('predaj: permanentka 10 vstupov (80€)', r.status === 200 && r.data.ok);
  let meB = (await g('B', '/api/me')).data;
  ok('permanentka pripísaná B (single_entries=10)', meB.single_entries === 10);
  // 1c. Mesačné členstvo Bronze (kartou na mieste)
  r = await post('admin', `/api/admin/users/${meC0.id}/grant-membership`, { plan_id: 'bronze', gift: false, payment_method: 'card', amount: 50 });
  ok('predaj: Bronze členstvo (card 50€)', r.status === 200 && r.data.ok);
  let meC = (await g('C', '/api/me')).data;
  ok('Bronze aktívne u C', meC.membership && meC.membership.plan_id === 'bronze');
  // 1d. GOLD ako DARČEK (gift) — nesmie ísť do tržieb, musí byť viditeľný 0€
  r = await post('admin', `/api/admin/users/${meA0.id}/grant-membership`, { plan_id: 'gold', gift: true });
  ok('darček: Gold členstvo (gift)', r.status === 200 && r.data.ok);
  meA = (await g('A', '/api/me')).data;
  ok('Gold aktívne u A (darček funguje)', meA.membership && meA.membership.plan_id === 'gold');
  // 1e. Predĺženie/zmena: Silver predaj C (upgrade z Bronze)
  r = await post('admin', `/api/admin/users/${meC0.id}/grant-membership`, { plan_id: 'silver', gift: false, payment_method: 'cash', amount: 75 });
  ok('zmena členstva: C Bronze→Silver (75€)', r.status === 200 && r.data.ok);
  meC = (await g('C', '/api/me')).data;
  ok('Silver aktívne u C po zmene', meC.membership && meC.membership.plan_id === 'silver');

  // Účtovná kontrola po admin predajoch: 10+80+50+75 = 215 €, darček 0 €
  const acc1 = (await g('admin', '/api/admin/accounting/summary')).data;
  ok('účtovníctvo: tržby presne 215 € (darček sa nepočíta)', Math.abs(acc1.totals.revenue - 215) < 0.01, `revenue=${acc1?.totals?.revenue}`);
  // Transakcie: darček viditeľný ako 0 € free záznam
  const txs1 = (await g('admin', '/api/transactions')).data || [];
  const freeTx = txs1.find(t => t.payment_method === 'free' && t.user_id === meA0.id);
  ok('darček viditeľný v predajoch ako 0 € (free)', !!freeTx && +freeTx.amount === 0);
  // Faktúry: platené majú faktúru, darček nie
  const invs1 = (await g('admin', '/api/admin/invoices?year=' + new Date().getFullYear())).data;
  const invList = Array.isArray(invs1) ? invs1 : (invs1?.invoices || invs1?.rows || []);
  const invTotal = invList.reduce((s, i) => s + (+i.total || 0), 0);
  ok('faktúry vystavené pre platené predaje (súčet 215 €)', Math.abs(invTotal - 215) < 0.01, `faktúry=${invTotal}`);
  ok('darček NEMÁ faktúru', !invList.some(i => +i.total === 0));
  // Audit log
  const audit1 = (await g('admin', '/api/admin/audit?limit=50')).data;
  const auditRows = Array.isArray(audit1) ? audit1 : (audit1?.rows || []);
  ok('audit log obsahuje membership_sell aj membership_gift', auditRows.some(a => a.action === 'membership_sell') && auditRows.some(a => a.action === 'membership_gift'));

  // ── 2. REZERVÁCIE, KAPACITA, NÁVŠTEVY ────────────────────────────────────
  console.log('\n[2] Rezervácie a návštevy');
  // 2a. B booking (prvá hodina zadarmo)
  r = await post('B', '/api/bookings', { class_id: cls._id, booking_date: nextDate });
  ok('B: rezervácia prvej hodiny (zdarma)', r.status === 200 && r.data.ok);
  // 2b. Duplicitná rezervácia zamietnutá
  r = await post('B', '/api/bookings', { class_id: cls._id, booking_date: nextDate });
  ok('duplicitná rezervácia zamietnutá', r.status !== 200);
  // 2c. Kapacita: nastav kapacitu 1 a skús C
  await put('admin', `/api/admin/classes/${cls._id}`, { capacity: 1 });
  r = await post('C', '/api/bookings', { class_id: cls._id, booking_date: nextDate });
  ok('kapacita: druhá klientka nad kapacitu zamietnutá', r.status !== 200, `status=${r.status}`);
  await put('admin', `/api/admin/classes/${cls._id}`, { capacity: 25 });
  r = await post('C', '/api/bookings', { class_id: cls._id, booking_date: nextDate });
  ok('po zvýšení kapacity C rezervuje', r.status === 200);
  // 2d. Potvrdenie účasti (check-in) → návšteva + body
  r = await post('admin', '/api/attendance/confirm-session', { class_id: cls._id, date: nextDate });
  ok('check-in: potvrdenie hodiny trénerom', r.status === 200);
  meB = (await g('B', '/api/me')).data;
  ok('B: visit_count=1 po check-ine', meB.visit_count === 1, `visits=${meB.visit_count}`);
  ok('B: free_class_used po prvej hodine', meB.free_class_used === true);
  // 2e. Booking bez členstva po vyčerpaní free hodiny → membership_required alebo pay_on_site
  const rD = await mk('D', 'AUDIT Klientka D', 'audit-d@test-fa-qa.local');
  const meD0 = (await g('D', '/api/me')).data;
  await post('D', '/api/bookings', { class_id: cls._id, booking_date: nextDate }); // free hodina
  const nextDate2 = new Date(new Date(nextDate).getTime() + 7 * 864e5).toISOString().slice(0, 10);
  r = await post('D', '/api/bookings', { class_id: cls._id, booking_date: nextDate2 });
  ok('bez členstva: druhá rezervácia vyžaduje členstvo (402)', r.status === 402 && r.data.error === 'membership_required');
  r = await post('D', '/api/bookings', { class_id: cls._id, booking_date: nextDate2, pay_on_site: true });
  ok('pay_on_site: rezervácia so sľubom platby na mieste prejde', r.status === 200);
  // 2f. Zrušenie vráti vstup: B má permanentku — book cez vstup a zruš
  r = await post('B', '/api/bookings', { class_id: cls._id, booking_date: nextDate2 });
  ok('B: rezervácia cez permanentku', r.status === 200);
  const meB2 = (await g('B', '/api/me')).data;
  ok('B: vstup odčítaný pri rezervácii (10→9)', meB2.single_entries === 9, `entries=${meB2.single_entries}`);
  const myBkResp=(await g('B','/api/my-bookings')).data;
  const myBkList=Array.isArray(myBkResp)?myBkResp:(myBkResp?.bookings||[]);
  const myBk=myBkList.find(b=>b.booking_date===nextDate2);
  if (myBk) {
    r = await del('B', '/api/bookings/' + (myBk.id || myBk._id));
    const meB3 = (await g('B', '/api/me')).data;
    ok('zrušenie vráti vstup (9→10)', r.status === 200 && meB3.single_entries === 10, `entries=${meB3.single_entries}`);
  } else ok('zrušenie vráti vstup', false, 'booking sa nenašiel v /api/bookings/my');

  // ── 3. ONLINE ZA VSTUP (permanentka) ─────────────────────────────────────
  console.log('\n[3] Online hodiny za vstup');
  await put('admin', `/api/admin/classes/${clsOnline._id}/stream`, { stream_url: 'https://www.youtube.com/watch?v=AUDITTEST123' });
  let oc = (await g('B', '/api/online/classes')).data;
  ok('B (permanentka, bez online plánu): access_mode=entry', oc.access_mode === 'entry', `mode=${oc.access_mode}`);
  ok('entry režim NEprezrádza stream_url vopred', !(oc.classes || []).some(c => c.stream_url));
  r = await post('B', '/api/online/enter', { class_id: clsOnline._id });
  ok('online enter: odčíta 1 vstup a vydá stream', r.status === 200 && r.data.charged === true && r.data.stream.stream_url?.includes('AUDITTEST'), JSON.stringify(r.data));
  const meB4 = (await g('B', '/api/me')).data;
  ok('B: vstupy po online 10→9', meB4.single_entries === 9);
  r = await post('B', '/api/online/enter', { class_id: clsOnline._id });
  ok('online enter: druhý raz v ten istý deň NEodčíta', r.status === 200 && r.data.charged === false);
  const meB5 = (await g('B', '/api/me')).data;
  ok('B: vstupy stále 9 (žiadny dvojitý odpočet)', meB5.single_entries === 9);
  // C má Silver → full access bez odpočtu
  oc = (await g('C', '/api/online/classes')).data;
  ok('C (Silver): access_mode=full + stream viditeľný', oc.access_mode === 'full' && (oc.classes || []).some(c => c.stream_url));
  // D bez vstupov aj bez plánu → žiadny prístup, enter 402
  const od = (await g('D', '/api/online/classes')).data;
  ok('D (bez vstupov/plánu): has_access=false', od.has_access === false);
  r = await post('D', '/api/online/enter', { class_id: clsOnline._id });
  ok('D: online enter zamietnutý (402)', r.status === 402);

  // ── 4. PROMO KÓDY A ZNEUŽITIE ────────────────────────────────────────────
  console.log('\n[4] Promo kódy');
  r = await post('admin', '/api/admin/promos', { code: 'AUDITZLAVA', type: 'percent', value: 50, applies_to: 'merch', max_uses: 1, once_per_user: true });
  ok('vytvorenie promo kódu (50% merch, max 1×)', r.status === 200);
  const prods = (await g('A', '/api/shop/products')).data;
  const prod = (prods.products || prods || [])[0];
  r = await post('A', '/api/shop/order', { client_name: 'AUDIT Klientka A', client_email: 'audit-a@test-fa-qa.local', city: 'Zvolen', items: [{ product_id: prod._id, qty: 1 }], payment_method: 'onsite', promo_code: 'AUDITZLAVA' });
  ok('e-shop objednávka s promo (50% zľava aplikovaná)', r.status === 200 && r.data.promo_discount > 0, JSON.stringify(r.data));
  const promoTotal1 = r.data.total;
  r = await post('A', '/api/shop/order', { client_name: 'AUDIT Klientka A', client_email: 'audit-a@test-fa-qa.local', city: 'Zvolen', items: [{ product_id: prod._id, qty: 1 }], payment_method: 'onsite', promo_code: 'AUDITZLAVA' });
  ok('promo zneužitie: druhé použitie NEdá zľavu', r.status === 200 && (!r.data.promo_discount || r.data.promo_discount === 0));
  r = await post('A', '/api/promo/validate', { code: 'AUDITZLAVA', amount: 50, context: 'membership' });
  ok('promo applies_to: merch kód neplatí na členstvo', r.data.ok === false);

  // ── 5. GAMIFIKÁCIA: body, rebríček, referral ─────────────────────────────
  console.log('\n[5] Body a gamifikácia');
  const spotA = (await g('A', '/api/client/spotlight')).data;
  ok('spotlight: A má body (aktívne členstvo=10 b.)', (spotA.myMonth?.points || 0) >= 10, `points=${spotA.myMonth?.points}`);
  const spotB = (await g('B', '/api/client/spotlight')).data;
  ok('spotlight: B má body za hodinu + členstvo? (≥5 b.)', (spotB.myMonth?.points || 0) >= 5, `points=${spotB.myMonth?.points}`);
  ok('rebríček obsahuje audit klientky', (spotA.topMonth || []).some(x => String(x.name).startsWith('AUDIT')));
  const profA = (await g('admin', '/api/profile/' + meA0.id)).data;
  ok('profil A: winner_titles pole existuje', profA.winner_titles && typeof profA.winner_titles.month_wins === 'number');
  ok('profil A: achievements vypočítané', Array.isArray(profA.achievements) && profA.achievements.length > 0);
  const profSponzor = (await g('admin', '/api/profile/' + meA0.id)).data;
  ok('referral: A má direct_refs ≥ 1 (priviedla B)', (profSponzor.direct_refs || 0) >= 1, `refs=${profSponzor.direct_refs}`);

  // ── 6. REFUND ────────────────────────────────────────────────────────────
  console.log('\n[6] Refundy');
  r = await post('admin', '/api/admin/refunds', { type: 'transfer', amount: 25, reason: 'AUDIT test refund', note: 'AUDIT' });
  ok('refund vytvorený (25€)', r.status === 200, JSON.stringify(r.data));
  const acc2 = (await g('admin', '/api/admin/accounting/summary')).data;
  // e-shop objednávky onsite nie sú status paid → nerátajú sa; tržby stále 215
  ok('účtovníctvo po refunde konzistentné (tržby ≥ 190)', acc2.totals.revenue >= 190, `revenue=${acc2.totals.revenue}`);

  // ── 7. KONZISTENCIA REPORTOV ─────────────────────────────────────────────
  console.log('\n[7] Konzistencia reportov');
  const fin = (await g('admin', '/api/admin/finance/stats')).data;
  ok('finance/stats odpovedá', !!fin && !fin.error);
  const accM = (await g('admin', '/api/admin/accounting/summary')).data;
  const byMethodSum = (accM.byMethod || []).reduce((s, x) => s + x.revenue, 0);
  ok('účtovníctvo: súčet podľa metód = celkové tržby', Math.abs(byMethodSum - accM.totals.revenue) < 0.05, `${byMethodSum} vs ${accM.totals.revenue}`);
  const byPlanSum = (accM.byPlan || []).reduce((s, x) => s + x.revenue, 0);
  ok('účtovníctvo: súčet podľa plánov = celkové tržby', Math.abs(byPlanSum - accM.totals.revenue) < 0.05);

  // ── 8. BEZPEČNOSŤ ────────────────────────────────────────────────────────
  console.log('\n[8] Bezpečnosť');
  r = await post('D', `/api/admin/users/${meD0.id}/grant-membership`, { plan_id: 'gold', gift: true });
  ok('klient si NEMÔŽE prideliť členstvo (admin endpoint chránený)', r.status === 401 || r.status === 403, `status=${r.status}`);
  r = await g('D', '/api/admin/accounting/summary');
  ok('klient nevidí účtovníctvo', r.status === 401 || r.status === 403);
  r = await post('nikto', '/api/import-meta-leads', { people: [] });
  ok('import endpoint bez tokenu = 404', r.status === 404);
  const meDafter = (await g('D', '/api/me')).data;
  ok('D stále bez členstva (bez platby nič nezískala)', !meDafter.membership);

  // ── 9. INTEGRITA DÁT ─────────────────────────────────────────────────────
  console.log('\n[9] Integrita databázy (cez API)');
  const allTx = (await g('admin', '/api/transactions')).data || [];
  ok('transakcie: žiadna nemá undefined sumu', allTx.every(t => Number.isFinite(+t.amount)));
  const membsA = (await g('admin', '/api/profile/' + meA0.id)).data;
  ok('profil A konzistentný (membership_tier=gold)', membsA.membership_tier === 'gold');
  const dupCheck = allTx.filter(t => t.user_id === meA0.id && t.type === 'membership' && +t.amount === 0);
  ok('žiadne duplicitné 0€ záznamy pre A', dupCheck.length <= 1, `count=${dupCheck.length}`);

  // ── VÝSLEDOK ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log(`TESTOV: ${PASS + FAIL} · ÚSPEŠNÝCH: ${PASS} · NEÚSPEŠNÝCH: ${FAIL}`);
  if (FAILS.length) { console.log('\nZLYHANIA:'); FAILS.forEach(f => console.log(' ✗ ' + f.name + (f.detail ? ' — ' + f.detail : ''))); }
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('AUDIT CRASH:', e); process.exit(2); });
