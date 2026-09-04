/**
 * Okrajové prípady PROMO KÓDOV / KUPÓNOV — audit (3. 9. 2026).
 *
 * Preveruje validatePromo() a všetky cesty, kde sa kupón reálne použije:
 *   · /api/promo/validate      (náhľad zľavy pre klientku)
 *   · /api/membership/buy      (hotovosť/prevod, 0 € vetva, PayPal demo)
 *   · /api/stripe/checkout     (STRIPE_FAKE=1 — žiadna sieť, falošná session)
 *   · /api/shop/order          (e-shop, aj bez prihlásenia)
 *
 * Scenáre: neplatný / expirovaný / neaktívny kód, veľkosť písmen a medzery,
 * 100 % kupón (0 €), obmedzenie na plány, súbeh pri max_uses:1, dvojité použitie
 * tou istou klientkou, záporná a nezmyselná cena + pár vedľajších nálezov
 * (kód spotrebovaný pred platbou, hosť v e-shope, individuálna cena vs. kód).
 *
 * Test NIČ v appke nemení — len spustí server nad dočasnou DB a číta výsledky.
 * Spustenie:  node qa/edge-kupony.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4582;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-kupony-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function j(url, opts, jar) {
  const headers = { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: (opts && opts.method) || 'GET', headers, body: opts && opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const redemptions = code => rd('promo_redemptions.db').filter(r => r.code === code);
const promo = code => rd('promo_codes.db').find(p => p.code === code);
const aktivne = (uid, plan) => rd('memberships.db').filter(m => m.user_id === uid && m.status === 'active' && (!plan || m.plan_id === plan));

const validate = (jar, body) => j('/api/promo/validate', { method: 'POST', body }, jar);
const buy = (jar, body) => j('/api/membership/buy', { method: 'POST', body: { payment_method: 'manual', ...body } }, jar);
const checkout = (jar, body) => j('/api/stripe/checkout', { method: 'POST', body }, jar);
const objednavka = body => j('/api/shop/order', { method: 'POST', body: { payment_method: 'cash', ...body } });
async function login(email) { const jar = {}; const r = await j('/api/login', { method: 'POST', body: { email, password: 'Heslo123!' } }, jar); if (r.status !== 200) throw new Error('login ' + email + ' HTTP ' + r.status); return jar; }

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const vcera = new Date(Date.now() - 86400000).toISOString();
  const U = (id, name, email, extra) => JSON.stringify({ _id: id, name, email, password: hash, user_type: 'client', active: true, created_at: '2026-05-01', ...(extra || {}) });
  const ANNA = 'qaKupAnna000001', BEATA = 'qaKupBeata00001', CILKA = 'qaKupCilka00001', DANA = 'qaKupDana000001',
    EMA = 'qaKupEma0000001', FRIDA = 'qaKupFrida00001', GITA = 'qaKupGita000001', HANA = 'qaKupHana000001', IDA = 'qaKupIda0000001';
  const PAR = [1, 2, 3, 4, 5, 6].map(i => ({ id: 'qaKupPar000000' + i, email: 'qa.kup.par' + i + '@qa-biz.local', name: 'Paralelná ' + i }));
  // Druhá šestica má referral kredit → pri nákupe „použiť kredit" sa medzi kontrolu kódu a jeho zápis dostane súborový zápis
  const PAR2 = [1, 2, 3, 4, 5, 6].map(i => ({ id: 'qaKupKre000000' + i, email: 'qa.kup.kre' + i + '@qa-biz.local', name: 'Kreditová ' + i }));
  const BEATA2 = 'qaKupBeata20001';
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    U('qaKupAdmin00001', 'Adam Admin', 'qa.kup.admin@qa-biz.local', { is_admin: true, user_type: 'admin' }),
    U(ANNA, 'Anna Overujúca', 'qa.kup.anna@qa-biz.local'),
    U(BEATA, 'Beata Dvakrát', 'qa.kup.beata@qa-biz.local'),
    U(CILKA, 'Cilka Online', 'qa.kup.cilka@qa-biz.local'),
    U(DANA, 'Dana Zadarmo', 'qa.kup.dana@qa-biz.local'),
    U(EMA, 'Ema Prevodom', 'qa.kup.ema@qa-biz.local'),
    U(FRIDA, 'Frida Druhá', 'qa.kup.frida@qa-biz.local'),
    U(GITA, 'Gita Kartou', 'qa.kup.gita@qa-biz.local'),
    U(HANA, 'Hana Individuálna', 'qa.kup.hana@qa-biz.local', { custom_prices: { silver: 40 } }),
    U(IDA, 'Ida Paypalová', 'qa.kup.ida@qa-biz.local'),
    ...PAR.map(u => U(u.id, u.name, u.email)),
    ...PAR2.map(u => U(u.id, u.name, u.email, { referral_credit: 5 })),
    U(BEATA2, 'Beata S Kreditom', 'qa.kup.beata2@qa-biz.local', { referral_credit: 5 }),
  ].join('\n') + '\n');
  // Štruktúra záznamu presne podľa /api/admin/promos (server.js ~10773) a seedov (VITAJSPAT, VENCEKRODIC)
  const P = (id, code, extra) => JSON.stringify({ _id: id, code, type: 'percent', value: 10, applies_to: 'membership', max_uses: 0, once_per_user: false,
    min_amount: 0, expires_at: null, active: true, used_count: 0, note: 'QA kupóny', created_at: '2026-09-01T08:00:00.000Z', ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'promo_codes.db'), [
    P('qaKupPromo00001', 'LETO10'),
    P('qaKupPromo00002', 'EXPIROVANY', { expires_at: vcera }),
    P('qaKupPromo00003', 'NEAKTIVNY', { active: false }),
    P('qaKupPromo00004', 'LENSILVER', { value: 20, plan_ids: ['silver'] }),
    P('qaKupPromo00005', 'STOPERCENT', { value: 100, plan_ids: ['silver'], once_per_user: true }),
    P('qaKupPromo00006', 'JEDENKRAT', { value: 100, plan_ids: ['silver'], max_uses: 1 }),
    P('qaKupPromo00007', 'RAZNAOSOBU', { value: 20, once_per_user: true }),
    P('qaKupPromo00008', 'MERCHRAZ', { value: 20, applies_to: 'merch', once_per_user: true }),
    P('qaKupPromo00009', 'MERCH10', { applies_to: 'merch' }),
    P('qaKupPromo00010', 'MANUALKOD', { value: 20, max_uses: 1 }),
    P('qaKupPromo00011', 'MERCHJEDEN', { value: 20, applies_to: 'merch', max_uses: 1 }),
    P('qaKupPromo00012', 'JEDENKRAT2', { value: 100, plan_ids: ['silver'], max_uses: 1 }),
    P('qaKupPromo00013', 'RAZNAOSOBU2', { value: 20, once_per_user: true }),
  ].join('\n') + '\n');

  console.log('KUPÓNY — okrajové prípady QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1',
      // Stripe: falošný kľúč + STRIPE_FAKE=1 (QA konvencia v stripeApi) → checkout prejde validáciou, ale na sieť nejde
      STRIPE_SECRET_KEY: 'sk_test_qa_falosny_kluc', STRIPE_FAKE: '1',
      // PayPal nenakonfigurovaný (ako na prode, kde sa platí Stripe-om) → vetva „demo" v /api/membership/buy
      PAYPAL_CLIENT_ID: '',
      // Meta CAPI do súboru, nie na sieť
      CAPI_DEBUG_FILE: path.join(DATA, 'capi.log') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  try {
    const anna = await login('qa.kup.anna@qa-biz.local');
    ok('klientka prihlásená', !!anna.cookie);

    console.log('\n1) Neplatný kód:');
    const v1 = await validate(anna, { code: 'NEEXISTUJE', plan_id: 'silver' });
    ok('neznámy kód pri validácii: HTTP 200, ok:false s dôvodom', v1.status === 200 && v1.d && v1.d.ok === false && typeof v1.d.reason === 'string' && v1.d.reason.length > 0, 'HTTP ' + v1.status + ' ' + JSON.stringify(v1.d));
    const b1 = await buy(anna, { plan_id: 'silver', promo_code: 'NEEXISTUJE' });
    ok('neznámy kód pri nákupe: 400 s jasnou chybou, nie 500', b1.status === 400 && b1.d && /Promo kód/.test(b1.d.error || ''), 'HTTP ' + b1.status + ' ' + JSON.stringify(b1.d));
    ok('odmietnutý nákup nezanechal platbu ani redemption', !rd('payments.db').some(p => p.user_id === ANNA) && rd('promo_redemptions.db').length === 0);
    const v1e = await validate(anna, { code: '', plan_id: 'silver' });
    ok('prázdny kód: ok:false („Zadaj kód")', v1e.status === 200 && v1e.d && v1e.d.ok === false, JSON.stringify(v1e.d));
    const v1n = await validate(anna, { code: 12345, plan_id: 'silver' });
    ok('kód poslaný ako číslo (12345): jasná chyba, nie 500', v1n.status !== 500 && v1n.d && (v1n.d.ok === false || v1n.status === 400), 'HTTP ' + v1n.status + ' ' + JSON.stringify(v1n.d));

    console.log('\n2) Expirovaný kód (expires_at včera):');
    const v2 = await validate(anna, { code: 'EXPIROVANY', plan_id: 'silver' });
    ok('validácia: odmietnutý „vypršala"', v2.status === 200 && v2.d && v2.d.ok === false && /vypr/i.test(v2.d.reason || ''), JSON.stringify(v2.d));
    const b2 = await buy(anna, { plan_id: 'silver', promo_code: 'EXPIROVANY' });
    ok('nákup: odmietnutý 400', b2.status === 400 && /vypr/i.test((b2.d || {}).error || ''), 'HTTP ' + b2.status + ' ' + JSON.stringify(b2.d));

    console.log('\n3) Neaktívny kód (active:false):');
    const v3 = await validate(anna, { code: 'NEAKTIVNY', plan_id: 'silver' });
    ok('validácia: odmietnutý', v3.status === 200 && v3.d && v3.d.ok === false, JSON.stringify(v3.d));
    const b3 = await buy(anna, { plan_id: 'silver', promo_code: 'NEAKTIVNY' });
    ok('nákup: odmietnutý 400', b3.status === 400 && /neakt/i.test((b3.d || {}).error || ''), 'HTTP ' + b3.status + ' ' + JSON.stringify(b3.d));

    console.log('\n4) Veľkosť písmen a medzery (uložené LETO10, 10 % na Silver 75 €):');
    const v4a = await validate(anna, { code: 'leto10', plan_id: 'silver' });
    ok('validácia: „leto10" prejde ako LETO10, 75 → 67,50', v4a.d && v4a.d.ok === true && v4a.d.code === 'LETO10' && v4a.d.final === 67.5, JSON.stringify(v4a.d));
    const v4b = await validate(anna, { code: '  LETO10  ', plan_id: 'silver' });
    ok('validácia: „  LETO10  " prejde', v4b.d && v4b.d.ok === true && v4b.d.final === 67.5, JSON.stringify(v4b.d));
    const b4a = await buy(anna, { plan_id: 'silver', promo_code: 'leto10' });
    ok('nákup: „leto10" prejde s tou istou zľavou (7,50 €)', b4a.status === 200 && b4a.d && b4a.d.ok && b4a.d.promo_discount === 7.5 && b4a.d.final_price === 67.5, 'HTTP ' + b4a.status + ' ' + JSON.stringify(b4a.d));
    const b4b = await buy(anna, { plan_id: 'silver', promo_code: '  LETO10  ' });
    ok('nákup: „  LETO10  " prejde', b4b.status === 200 && b4b.d && b4b.d.ok && b4b.d.final_price === 67.5, 'HTTP ' + b4b.status + ' ' + JSON.stringify(b4b.d));
    await sleep(300);
    const red4 = redemptions('LETO10');
    ok('obe použitia zapísané pod kanonickým kódom LETO10 (validácia = použitie)', red4.length === 2 && red4.every(r => r.user_id === ANNA), 'n=' + red4.length);
    ok('platby nesú kanonický kód LETO10', rd('payments.db').filter(p => p.user_id === ANNA).every(p => p.promo_code === 'LETO10'));
    // buy() posiela payment_method:'manual' → platba je pending_manual, takže použitie
    // je zatiaľ len rezervované (status pending) a used_count sa odpočíta až po potvrdení
    // platby adminom. Pôvodné očakávanie used_count===2 popisovalo starú chybu (kód sa
    // spálil hneď pri žiadosti) a odporovalo kontrole „kód sa nespotrebuje pred úhradou".
    ok('obe použitia sú zatiaľ len rezervované, kód ešte nie je odpočítaný',
      red4.every(r => r.status === 'pending') && ((promo('LETO10') || {}).used_count || 0) === 0,
      'stavy=' + red4.map(r => r.status).join(',') + ' used_count=' + (promo('LETO10') || {}).used_count);
    // Admin pri tvorbe kódu odstraňuje VŠETKY medzery (replace(/\s+/g,'')), validácia len trimuje okraje
    const v4c = await validate(anna, { code: 'LETO 10', plan_id: 'silver' });
    ok('„LETO 10" (medzera vnútri) sa normalizuje rovnako ako pri tvorbe kódu v admine', v4c.d && v4c.d.ok === true, JSON.stringify(v4c.d));

    console.log('\n5) 100 % kupón — cena po zľave 0 €:');
    const dana = await login('qa.kup.dana@qa-biz.local');
    const b5 = await buy(dana, { plan_id: 'silver', promo_code: 'STOPERCENT' });
    ok('/api/membership/buy so 100 % kupónom: ok, final_price 0, zľava 75', b5.status === 200 && b5.d && b5.d.ok && b5.d.final_price === 0 && b5.d.promo_discount === 75, 'HTTP ' + b5.status + ' ' + JSON.stringify(b5.d));
    await sleep(300);
    ok('členstvo Silver aktivované', aktivne(DANA, 'silver').length === 1, 'aktívnych=' + aktivne(DANA, 'silver').length);
    const tx5 = rd('transactions.db').filter(t => t.user_id === DANA);
    ok('existuje transakčný záznam 0 € s promo kódom', tx5.length === 1 && tx5[0].amount === 0 && tx5[0].promo_code === 'STOPERCENT', JSON.stringify(tx5).slice(0, 200));
    ok('záznam 0 € je označený ako promo, nie „referral_credit / hradené kreditom" (kredit sa nepoužil)', tx5.length === 1 && tx5[0].payment_method !== 'referral_credit' && !/hradené kreditom/.test(tx5[0].note || ''), tx5[0] && (tx5[0].payment_method + ' | ' + tx5[0].note));
    ok('redemption STOPERCENT zapísaná s discount 75', redemptions('STOPERCENT').length === 1 && redemptions('STOPERCENT')[0].discount === 75, JSON.stringify(redemptions('STOPERCENT')));
    const b5b = await buy(dana, { plan_id: 'silver', promo_code: 'STOPERCENT' });
    ok('tá istá klientka druhýkrát (sekvenčne, once_per_user): odmietnuté', b5b.status === 400 && /použil/.test((b5b.d || {}).error || ''), 'HTTP ' + b5b.status + ' ' + JSON.stringify(b5b.d));
    const gita = await login('qa.kup.gita@qa-biz.local');
    const c5 = await checkout(gita, { plan_id: 'silver', promo_code: 'STOPERCENT' });
    ok('Stripe checkout so 100 % kupónom: 400 „cena po zľave je 0 €", session nevzniká', c5.status === 400 && /0 €/.test((c5.d || {}).error || ''), 'HTTP ' + c5.status + ' ' + JSON.stringify(c5.d));
    ok('žiadna pending Stripe platba ani redemption pre Gitu', !rd('payments.db').some(p => p.user_id === GITA) && !redemptions('STOPERCENT').some(r => r.user_id === GITA));
    // Seedovaný PRVYMESIAC (fixed 25 €, „prvý mesiac Silver za cenu Bronzu") — server ho vkladá pri štarte
    const cilka = await login('qa.kup.cilka@qa-biz.local');
    let v5p = null;
    for (let i = 0; i < 20; i++) { v5p = await validate(cilka, { code: 'PRVYMESIAC', plan_id: 'online_basic' }); if (v5p.d && (v5p.d.ok || !/neexistuje/.test(v5p.d.reason || ''))) break; await sleep(500); }
    // Chránené dvojmo: kód je viazaný na Silver (plan_ids) a pevná zľava sa navyše
    // odmietne, keď je drahšia než tovar. Stačí, že Online Basic nevyjde na 0 € —
    // pôvodné znenie trvalo na jednej konkrétnej ceste (ok:true s final > 0).
    ok('PRVYMESIAC (fixed 25 €) nedá Online Basic za 12,90 € úplne zadarmo',
      v5p && v5p.d && (v5p.d.ok === false ? /Silver|drahšie/.test(v5p.d.reason || '') : v5p.d.final > 0),
      JSON.stringify(v5p && v5p.d));
    const b5p = await buy(cilka, { plan_id: 'online_basic', promo_code: 'PRVYMESIAC' });
    await sleep(300);
    ok('nákup Online Basic s PRVYMESIAC nie je 0 € aktivácia bez platby', !(b5p.status === 200 && b5p.d && b5p.d.final_price === 0 && aktivne(CILKA, 'online_basic').length > 0), 'HTTP ' + b5p.status + ' final_price=' + (b5p.d && b5p.d.final_price) + ' aktívne=' + aktivne(CILKA, 'online_basic').length);

    console.log('\n6) Obmedzenie na plány (LENSILVER: plan_ids [silver], 20 %):');
    const v6g = await validate(anna, { code: 'LENSILVER', plan_id: 'gold' });
    ok('validácia na Gold: odmietnutý s menom plánu', v6g.d && v6g.d.ok === false && /Silver/.test(v6g.d.reason || ''), JSON.stringify(v6g.d));
    const v6s = await validate(anna, { code: 'LENSILVER', plan_id: 'silver' });
    ok('validácia na Silver: prejde, 75 → 60', v6s.d && v6s.d.ok === true && v6s.d.final === 60, JSON.stringify(v6s.d));
    const b6g = await buy(anna, { plan_id: 'gold', promo_code: 'LENSILVER' });
    ok('nákup Gold s kódom pre Silver: 400', b6g.status === 400 && /Silver/.test((b6g.d || {}).error || ''), 'HTTP ' + b6g.status + ' ' + JSON.stringify(b6g.d));
    const c6g = await checkout(gita, { plan_id: 'gold', promo_code: 'LENSILVER' });
    ok('Stripe checkout Gold s kódom pre Silver: 400', c6g.status === 400 && /Silver/.test((c6g.d || {}).error || ''), 'HTTP ' + c6g.status + ' ' + JSON.stringify(c6g.d));
    const c6s = await checkout(gita, { plan_id: 'silver', promo_code: 'LENSILVER' });
    ok('Stripe checkout Silver s kódom pre Silver: promo prejde (padne až falošný Stripe, nie kód)', c6s.status === 400 && !/Promo kód/.test((c6s.d || {}).error || '') && !/0 €/.test((c6s.d || {}).error || ''), 'HTTP ' + c6s.status + ' ' + JSON.stringify(c6s.d));
    const v6n = await validate(anna, { code: 'LENSILVER', amount: 125, context: 'membership' });
    ok('náhľad bez plan_id (amount:125, context membership) neobíde obmedzenie na plány', v6n.d && v6n.d.ok === false, JSON.stringify(v6n.d));

    console.log('\n7) Súbeh pri max_uses:1 (JEDENKRAT, 100 % Silver, 6 klientok naraz):');
    const jars7 = await Promise.all(PAR.map(u => login(u.email)));
    const res7 = await Promise.all(jars7.map(jar => buy(jar, { plan_id: 'silver', promo_code: 'JEDENKRAT' })));
    const uspesne7 = res7.filter(r => r.status === 200 && r.d && r.d.ok).length;
    await sleep(500);
    const red7 = redemptions('JEDENKRAT');
    const mem7 = PAR.filter(u => aktivne(u.id, 'silver').length > 0).length;
    const uc7 = (promo('JEDENKRAT') || {}).used_count;
    ok('zo 6 paralelných požiadaviek prešla najviac 1 (HTTP 200)', uspesne7 <= 1, 'prešlo ' + uspesne7 + '/6');
    ok('najviac 1 redemption', red7.length <= 1, 'redemptions=' + red7.length + ', used_count=' + uc7);
    ok('najviac 1 členstvo aktivované zadarmo', mem7 <= 1, 'aktivovaných členstiev=' + mem7);
    const b7 = await buy(anna, { plan_id: 'silver', promo_code: 'JEDENKRAT' });
    ok('po súbehu: sekvenčný pokus odmietnutý „vyčerpaný"', b7.status === 400 && /vyčerpan/.test((b7.d || {}).error || ''), 'HTTP ' + b7.status + ' ' + JSON.stringify(b7.d));
    // 7b) to isté v e-shope: medzi kontrolou kódu (validatePromo) a jeho zápisom je zápis objednávky do súboru
    const prods7 = await j('/api/shop/products'); const prod7 = (prods7.d || [])[0];
    if (prod7) {
      const res7b = await Promise.all([1, 2, 3, 4, 5, 6].map(i => objednavka({ client_name: 'Hosť ' + i, client_email: 'qa.kup.eshop' + i + '@qa-biz.local', items: [{ product_id: prod7._id, qty: 1 }], promo_code: 'MERCHJEDEN' })));
      const soZlavou = res7b.filter(r => r.status === 200 && r.d && r.d.ok && r.d.promo_discount > 0).length;
      await sleep(500);
      ok('e-shop, max_uses:1 — zo 6 paralelných objednávok dostala zľavu najviac 1', soZlavou <= 1 && redemptions('MERCHJEDEN').length <= 1, 'so zľavou ' + soZlavou + '/6, redemptions=' + redemptions('MERCHJEDEN').length + ', used_count=' + (promo('MERCHJEDEN') || {}).used_count);
    }
    // 7c) členstvo + „použiť kredit": medzi kontrolou kódu a jeho zápisom sú zápisy kreditu (users, notifications)
    const jars7c = await Promise.all(PAR2.map(u => login(u.email)));
    const res7c = await Promise.all(jars7c.map(jar => buy(jar, { plan_id: 'silver', promo_code: 'JEDENKRAT2', use_referral_credit: true })));
    const uspesne7c = res7c.filter(r => r.status === 200 && r.d && r.d.ok).length;
    await sleep(500);
    const mem7c = PAR2.filter(u => aktivne(u.id, 'silver').length > 0).length;
    ok('členstvo + kredit, max_uses:1 — zo 6 paralelných klientok prešla najviac 1', uspesne7c <= 1 && redemptions('JEDENKRAT2').length <= 1 && mem7c <= 1, 'prešlo ' + uspesne7c + '/6, redemptions=' + redemptions('JEDENKRAT2').length + ', used_count=' + (promo('JEDENKRAT2') || {}).used_count + ', aktivovaných členstiev=' + mem7c);

    console.log('\n8) Tá istá klientka 2× paralelne (RAZNAOSOBU, once_per_user):');
    const beata = await login('qa.kup.beata@qa-biz.local');
    const res8 = await Promise.all([0, 1].map(() => buy(beata, { plan_id: 'silver', promo_code: 'RAZNAOSOBU' })));
    const uspesne8 = res8.filter(r => r.status === 200 && r.d && r.d.ok).length;
    await sleep(400);
    const red8 = redemptions('RAZNAOSOBU');
    ok('z 2 paralelných požiadaviek prešla najviac 1', uspesne8 <= 1, 'prešlo ' + uspesne8 + '/2');
    ok('najviac 1 redemption pre Beatu', red8.length <= 1, 'redemptions=' + red8.length + ', used_count=' + (promo('RAZNAOSOBU') || {}).used_count);
    const b8 = await buy(beata, { plan_id: 'silver', promo_code: 'RAZNAOSOBU' });
    ok('tretí, sekvenčný pokus odmietnutý „už použil/a"', b8.status === 400 && /použil/.test((b8.d || {}).error || ''), 'HTTP ' + b8.status + ' ' + JSON.stringify(b8.d));
    // 8b) tá istá klientka 2× paralelne s „použiť kredit" (súborové zápisy medzi kontrolou a zápisom kódu)
    const beata2 = await login('qa.kup.beata2@qa-biz.local');
    const res8b = await Promise.all([0, 1].map(() => buy(beata2, { plan_id: 'silver', promo_code: 'RAZNAOSOBU2', use_referral_credit: true })));
    const uspesne8b = res8b.filter(r => r.status === 200 && r.d && r.d.ok).length;
    await sleep(400);
    ok('once_per_user + kredit — z 2 paralelných požiadaviek tej istej klientky prešla najviac 1', uspesne8b <= 1 && redemptions('RAZNAOSOBU2').length <= 1, 'prešlo ' + uspesne8b + '/2, redemptions=' + redemptions('RAZNAOSOBU2').length);

    console.log('\n9) Záporná / nezmyselná cena:');
    const v9a = await validate(anna, { code: 'MERCH10', amount: -10, context: 'merch' });
    ok('amount:-10 → nie 500, žiadna záporná výsledná cena', v9a.status !== 500 && v9a.d && (v9a.d.ok === false || v9a.d.final >= 0), 'HTTP ' + v9a.status + ' ' + JSON.stringify(v9a.d));
    const v9b = await validate(anna, { code: 'MERCH10', amount: 'abc', context: 'merch' });
    ok('amount:"abc" → nie 500, žiadna záporná/NaN cena', v9b.status !== 500 && v9b.d && (v9b.d.ok === false || (typeof v9b.d.final === 'number' && v9b.d.final >= 0)), 'HTTP ' + v9b.status + ' ' + JSON.stringify(v9b.d));
    const v9c = await validate(anna, { code: 'MERCH10', amount: '1e999', context: 'merch' });
    ok('amount:"1e999" (Infinity) → nevráti ok:true s nečíselnou cenou', v9c.status !== 500 && v9c.d && !(v9c.d.ok === true && !(typeof v9c.d.final === 'number' && isFinite(v9c.d.final))), 'HTTP ' + v9c.status + ' ' + JSON.stringify(v9c.d));
    const prods = await j('/api/shop/products');
    const prod = (prods.d || [])[0];
    ok('e-shop má produkt na test zápornej sumy', !!prod, 'HTTP ' + prods.status);
    if (prod) {
      const o9 = await objednavka({ client_name: 'QA Záporná', client_email: 'qa.kup.zaporna@qa-biz.local', items: [{ product_id: prod._id, qty: -1 }], promo_code: 'MERCH10' });
      ok('objednávka s qty:-1 + kód: nevznikne objednávka so zápornou sumou', !(o9.status === 200 && o9.d && o9.d.ok && o9.d.total < 0), 'HTTP ' + o9.status + ' total=' + (o9.d && o9.d.total) + ' promo_discount=' + (o9.d && o9.d.promo_discount) + ' (produkt ' + prod.name + ' ' + prod.price + ' €)');
    }

    console.log('\n10) Vedľajšie nálezy:');
    // a) e-shop bez prihlásenia: once_per_user kód nemá koho kontrolovať
    if (prod) {
      const host = { client_name: 'Hosť Jeden', client_email: 'qa.kup.host@qa-biz.local', items: [{ product_id: prod._id, qty: 1 }], promo_code: 'MERCHRAZ' };
      const g1 = await objednavka(host); const g2 = await objednavka(host);
      await sleep(300);
      ok('once_per_user kód v e-shope bez prihlásenia (ten istý e-mail 2×): druhá objednávka bez zľavy', g1.d && g1.d.promo_discount > 0 && !(g2.d && g2.d.promo_discount > 0), 'zľava 1.=' + (g1.d && g1.d.promo_discount) + ' 2.=' + (g2.d && g2.d.promo_discount) + ', redemptions=' + redemptions('MERCHRAZ').length);
    }
    // b) hotovosť/prevod: kód sa spotrebuje hneď pri žiadosti, nie až po prijatí platby
    const ema = await login('qa.kup.ema@qa-biz.local');
    const bE = await buy(ema, { plan_id: 'silver', promo_code: 'MANUALKOD' });
    ok('žiadosť o platbu prevodom s kódom MANUALKOD (max_uses:1): prijatá, 60 €', bE.status === 200 && bE.d && bE.d.ok && bE.d.final_price === 60, 'HTTP ' + bE.status + ' ' + JSON.stringify(bE.d));
    await sleep(300);
    const payE = rd('payments.db').find(p => p.user_id === EMA);
    ok('platba je len pending_manual, členstvo neaktívne', !!payE && payE.status === 'pending_manual' && aktivne(EMA).length === 0, JSON.stringify(payE || null).slice(0, 160));
    // Žiadosť si drží len rezerváciu (pending). Použitie sa odpočíta až po prijatí
    // peňazí, takže nezaplatená žiadosť kód nespáli. Pôvodné znenie čakalo nula
    // riadkov — zámok proti tomu, aby si tá istá klientka podala žiadosť dvakrát,
    // je ale správny; podstatné je, že used_count ostáva 0.
    ok('kód sa nespotrebuje skôr, než je platba prijatá (odpočet až po úhrade)',
      ((promo('MANUALKOD') || {}).used_count || 0) === 0
      && redemptions('MANUALKOD').every(r => r.status === 'pending'),
      'stavy=' + redemptions('MANUALKOD').map(r => r.status).join(',') + ', used_count=' + (promo('MANUALKOD') || {}).used_count);
    const frida = await login('qa.kup.frida@qa-biz.local');
    const bF = await buy(frida, { plan_id: 'silver', promo_code: 'MANUALKOD' });
    ok('kým Ema nezaplatila, kód (max_uses:1) môže použiť aj ďalšia klientka',
      bF.status === 200 && bF.d && bF.d.ok && bF.d.final_price === 60, 'HTTP ' + bF.status + ' ' + JSON.stringify(bF.d));

    // Potvrdenie a zamietnutie žiadosti adminom — tu sa použitie odpočíta, resp. uvoľní
    const adm = await login('qa.kup.admin@qa-biz.local');
    const payEma = rd('payments.db').find(p => p.user_id === EMA && p.status === 'pending_manual');
    const conf = await j('/api/admin/manual-payments/' + (payEma || {})._id + '/confirm', { method: 'POST', body: { method: 'transfer' } }, adm);
    await sleep(400);
    ok('admin potvrdí Eminu platbu → kód sa odpočíta a členstvo je aktívne',
      conf.status === 200 && ((promo('MANUALKOD') || {}).used_count || 0) === 1
      && redemptions('MANUALKOD').some(r => r.user_id === EMA && r.status === 'used') && aktivne(EMA).length === 1,
      'HTTP ' + conf.status + ' used_count=' + (promo('MANUALKOD') || {}).used_count
      + ' stavy=' + redemptions('MANUALKOD').map(r => r.user_id === EMA ? 'ema:' + r.status : 'ina:' + r.status).join(','));
    const payFrida = rd('payments.db').find(p => p.user_id === FRIDA && p.status === 'pending_manual');
    const canc = await j('/api/admin/manual-payments/' + (payFrida || {})._id + '/cancel', { method: 'POST', body: {} }, adm);
    await sleep(400);
    ok('zamietnutá žiadosť Fridy kód nespáli (uvoľní rezerváciu, používateľ ho môže použiť znova)',
      canc.status === 200 && ((promo('MANUALKOD') || {}).used_count || 0) === 1
      && !redemptions('MANUALKOD').some(r => r.user_id === FRIDA) && aktivne(FRIDA).length === 0,
      'HTTP ' + canc.status + ' used_count=' + (promo('MANUALKOD') || {}).used_count
      + ' riadkov=' + redemptions('MANUALKOD').length);
    const bF2 = await buy(frida, { plan_id: 'silver', promo_code: 'MANUALKOD' });
    ok('ale vyčerpaný kód (max_uses:1 už použitý) ďalšia žiadosť nedostane',
      bF2.status === 400 && /vyčerpan/i.test((bF2.d || {}).error || ''), 'HTTP ' + bF2.status + ' ' + JSON.stringify(bF2.d));
    // c) payment_method:"paypal" bez PAYPAL_CLIENT_ID → „demo" aktivácia
    const ida = await login('qa.kup.ida@qa-biz.local');
    const bP = await buy(ida, { plan_id: 'gold', payment_method: 'paypal', promo_code: 'LETO10' });
    await sleep(300);
    const memP = aktivne(IDA, 'gold').length;
    const zaznamyP = rd('transactions.db').filter(t => t.user_id === IDA).length + rd('payments.db').filter(p => p.user_id === IDA).length;
    ok('payment_method:"paypal" bez PAYPAL_CLIENT_ID: členstvo sa NEaktivuje bez platby a bez záznamu', !(bP.status === 200 && bP.d && bP.d.demo && memP > 0 && zaznamyP === 0), 'HTTP ' + bP.status + ' demo=' + (bP.d && bP.d.demo) + ' aktívne Gold=' + memP + ' záznamov(platby+transakcie)=' + zaznamyP + ' redemption LETO10 pre Idu=' + redemptions('LETO10').filter(r => r.user_id === IDA).length);
    // d) individuálna cena (custom_prices) vs. kód — zľava sa počíta z cenníkovej ceny
    const hana = await login('qa.kup.hana@qa-biz.local');
    const vH = await validate(hana, { code: 'LETO10', plan_id: 'silver' });
    ok('klientka s individuálnou cenou Silver 40 €: 10 % kód nevráti vyššiu cenu než jej cena bez kódu', vH.d && vH.d.ok === true && vH.d.final <= 40, JSON.stringify(vH.d));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nKUPÓNY: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-800));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
