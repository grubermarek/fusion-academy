/**
 * Okrajové prípady e-shop objednávok — AUDIT (3. 9. 2026).
 *
 * Test NIČ neopravuje, len ukazuje, čo server s podivnými vstupmi do
 * POST /api/shop/order, PUT /api/admin/orders/:id a Stripe ciest urobí.
 * Každý assert vie zlyhať; ❌ = nález na nahlásenie, nie chyba testu.
 *
 * Sleduje:
 *   1. dvojitý submit (5× ten istý payload paralelne) — koľko objednávok vznikne
 *   2. cena z klienta (price/total v tele) — server musí rátať z DB
 *   3. neexistujúci / neaktívny produkt — odmietnuť, nie 500, žiadna objednávka
 *   4. množstvo 0, -3, 'abc', 9999, 1.5, chýba — žiadna nulová/záporná/NaN suma
 *   5. potvrdenie viackrát paralelne (admin → paid pre hosťa s referral kódom aj
 *      pre registrovanú členku; simulovaný Stripe webhook) — paid_at raz, žiadne
 *      duplicitné transakcie/provízie/notifikácie/faktúry;
 *      Stripe checkout/verify bez kľúča → 400, nie 500, nič sa nezaplatí
 *   6. chýbajúci / nevalidný e-mail — 400, žiadna objednávka
 *   7. 200 položiek, položka bez product_id, items:null, [null], 'abc',
 *      NoSQL operátor v product_id, regex v referral_code, pošta bez adresy
 *
 * Stripe sa NIKDY nevolá naživo: STRIPE_SECRET_KEY je prázdny (checkout/verify
 * končia na kontrole kľúča) a webhook sa simuluje len lokálnym POSTom.
 *
 * Spustenie:  node qa/edge-objednavky.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4583;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-edge-obj-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts, jar) {
  const headers = { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: (opts && opts.method) || 'GET', headers, body: opts && opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
// Posledná verzia každého dokumentu (NeDB žurnál: nové verzie sa pripájajú na koniec)
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
// Všetky zapísané verzie — koľkokrát sa dokument reálne prepísal
const vsetkyVerzie = f => { const out = []; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (o._id && !o.$$deleted) out.push(o); } catch (e) {} }); } catch (e) {} return out; };
const objednavky = () => rd('orders.db');
const objPodlaMailu = em => objednavky().filter(o => o.client_email === em);
const objId = id => objednavky().find(o => o._id === id);
const cakaj = ms => new Promise(r => setTimeout(r, ms));
const kratko = v => JSON.stringify(v === undefined ? null : v).slice(0, 140);

const TRICKO = 'qaEdgeProdTricko', FLASA = 'qaEdgeProdFlasa0', NEAKT = 'qaEdgeProdNeakt0';
const ADMIN_ID = 'qaEdgeAdmin00001', ADMIN_EMAIL = 'qa.edge.admin@qa-biz.local';
const PARTNER_ID = 'qaEdgePartner001', PARTNER_EMAIL = 'qa.edge.partner@qa-biz.local';
const KUP1_ID = 'qaEdgeKupujuca01', KUP1_EMAIL = 'qa.edge.kupujuca1@qa-biz.local', KUP1_MENO = 'Kamila Kupujúca';
const KUP2_ID = 'qaEdgeKupujuca02', KUP2_EMAIL = 'qa.edge.kupujuca2@qa-biz.local', KUP2_MENO = 'Wanda Webhooková';
const HOST_EMAIL = 'qa.edge.host@qa-biz.local', HOST_MENO = 'Hana Hosťka'; // nemá účet

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = (id, name, email, extra) => JSON.stringify({ _id: id, name, email, password: hash, user_type: 'client', active: true, created_at: '2026-05-01', ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    U(ADMIN_ID, 'Adam Admin', ADMIN_EMAIL, { is_admin: true, user_type: 'admin' }),
    U(PARTNER_ID, 'Petra Partnerka', PARTNER_EMAIL, { user_type: 'partner', referral_code: 'QAEDGE', amb_rank: 1 }),
    U(KUP1_ID, KUP1_MENO, KUP1_EMAIL),
    U(KUP2_ID, KUP2_MENO, KUP2_EMAIL),
  ].join('\n') + '\n');
  const P = (id, name, price, extra) => JSON.stringify({ _id: id, cat: 'Oblečenie', name, emoji: '👕', desc: 'QA produkt', price, commission_rate: 0.08, type: 'product', active: true, ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'products.db'), [
    P(TRICKO, 'Fusion tričko (dámske)', 25),
    P(FLASA, 'Fľaša Fusion Academy 0,7 l', 19, { emoji: '🍶' }),
    P(NEAKT, 'Fusion mikina (unisex)', 55, { emoji: '🧥', active: false }),
  ].join('\n') + '\n');

  console.log('OKRAJOVÉ PRÍPADY OBJEDNÁVOK QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1',
      // Poistky: Stripe sa nesmie zavolať naživo; webhook bez podpisu je povolený
      // len mimo produkcie, čo umožňuje simulovať Stripe potvrdenie bez siete.
      STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', STRIPE_FAKE: '', NODE_ENV: 'development' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, 'HTTP ' + lg.status);

    const obj = body => j('/api/shop/order', { method: 'POST', body });
    const payload = (email, items, extra) => ({ client_name: 'Edge Testová', client_email: email, client_phone: '0900 000 000', city: 'Zvolen', items, payment_method: 'cash', ...(extra || {}) });
    const potvrd = id => j('/api/admin/orders/' + id, { method: 'PUT', body: { status: 'paid' } }, adm);
    const verziePaid = id => vsetkyVerzie('orders.db').filter(o => o._id === id && o.paid_at);

    console.log('\n0) Základ — ponuka a bežná objednávka:');
    const pr = await j('/api/shop/products');
    ok('verejná ponuka obsahuje aktívne tričko', pr.status === 200 && Array.isArray(pr.d) && pr.d.some(p => p._id === TRICKO), 'HTTP ' + pr.status);
    ok('verejná ponuka NEobsahuje neaktívnu mikinu', Array.isArray(pr.d) && !pr.d.some(p => p._id === NEAKT));
    const ZAK = 'qa.edge.zaklad@qa-biz.local';
    const z = await obj(payload(ZAK, [{ product_id: TRICKO, qty: 1, size: 'M', color: 'Čierna' }]));
    ok('bežná objednávka prijatá (200, ok, číslo FA-…)', z.status === 200 && z.d && z.d.ok && /^FA-\d{4}-/.test(z.d.order_number || ''), 'HTTP ' + z.status + ' ' + kratko(z.d));
    const zo = objPodlaMailu(ZAK)[0];
    ok('v DB: 1 položka, cena 25 z DB, veľkosť M, status pending, paid_at null', !!zo && zo.items.length === 1 && zo.items[0].price === 25 && zo.items[0].subtotal === 25 && zo.items[0].size === 'M' && zo.status === 'pending' && zo.paid_at === null && zo.total === 25, kratko(zo));

    console.log('\n1) Dvojitý submit — 5× ten istý payload paralelne (dva taby / dvojklik):');
    const DV = 'qa.edge.dvojita@qa-biz.local';
    const tela = payload(DV, [{ product_id: TRICKO, qty: 1, size: 'M' }]);
    const p5 = await Promise.all([1, 2, 3, 4, 5].map(() => obj(tela)));
    const st5 = p5.map(r => r.status);
    ok('žiadna z 5 požiadaviek neskončila 500', st5.every(s => s !== 500), 'HTTP ' + st5.join(','));
    await cakaj(300);
    const dvoj = objPodlaMailu(DV);
    const cisla = dvoj.map(o => o.order_number);
    ok('vznikla len 1 objednávka (dedup rovnakého payloadu)', dvoj.length === 1, 'vzniklo ' + dvoj.length + ' objednávok: ' + cisla.join(', '));
    ok('čísla objednávok sú navzájom rôzne', new Set(cisla).size === cisla.length, cisla.join(', '));

    console.log('\n2) Cena z klienta — položka s price:1, total:1, produkt má v DB 25 €:');
    const CE = 'qa.edge.cena@qa-biz.local';
    const ce = await obj(payload(CE, [{ product_id: TRICKO, qty: 2, price: 1, subtotal: 1 }], { total: 1 }));
    ok('objednávka prijatá', ce.status === 200 && ce.d && ce.d.ok, 'HTTP ' + ce.status + ' ' + kratko(ce.d));
    const ceo = objPodlaMailu(CE)[0];
    ok('cena položky sa berie z DB (25 €), nie z klienta (1 €)', !!ceo && ceo.items[0].price === 25 && ceo.items[0].subtotal === 50, kratko(ceo && ceo.items));
    ok('suma objednávky 50 € (2×25) v DB aj v odpovedi, nie klientska 1 €', !!ceo && ceo.total === 50 && ce.d && ce.d.total === 50, 'DB ' + (ceo && ceo.total) + ', odpoveď ' + (ce.d && ce.d.total));

    console.log('\n3) Neexistujúci / neaktívny produkt:');
    const NE1 = 'qa.edge.nieje@qa-biz.local';
    const ne1 = await obj(payload(NE1, [{ product_id: 'nieje', qty: 1 }]));
    ok('product_id „nieje": odmietnuté (400), nie 500', ne1.status === 400, 'HTTP ' + ne1.status + ' ' + kratko(ne1.d));
    const ne1o = objPodlaMailu(NE1);
    ok('product_id „nieje": žiadna objednávka', ne1o.length === 0, 'vznikla objednávka: položky=' + (ne1o[0] && ne1o[0].items.length) + ', total=' + (ne1o[0] && ne1o[0].total) + ', status=' + (ne1o[0] && ne1o[0].status));
    const NE2 = 'qa.edge.mix@qa-biz.local';
    const ne2 = await obj(payload(NE2, [{ product_id: 'nieje', qty: 1 }, { product_id: TRICKO, qty: 1 }]));
    const ne2o = objPodlaMailu(NE2)[0];
    ok('mix neexistujúci + tričko: nie 500', ne2.status !== 500, 'HTTP ' + ne2.status);
    ok('mix: buď odmietnuté, alebo objednávka len za tričko (25 €, 1 položka)', ne2.status === 400 || (!!ne2o && ne2o.items.length === 1 && ne2o.total === 25), 'HTTP ' + ne2.status + ' ' + kratko(ne2o));
    const NE3 = 'qa.edge.neaktivny@qa-biz.local';
    const ne3 = await obj(payload(NE3, [{ product_id: NEAKT, qty: 1 }]));
    ok('neaktívny produkt (active:false): odmietnuté (400), nie 500', ne3.status === 400, 'HTTP ' + ne3.status + ' ' + kratko(ne3.d));
    const ne3o = objPodlaMailu(NE3);
    ok('neaktívny produkt: žiadna objednávka', ne3o.length === 0, 'vznikla objednávka za ' + (ne3o[0] && ne3o[0].total) + ' € (' + (ne3o[0] && ne3o[0].items[0] && ne3o[0].items[0].product_name) + ')');

    console.log('\n4) Množstvo — 0, -3, \'abc\', 1.5, chýba, 9999:');
    const pripady = [
      { qty: 0, popis: 'qty 0' },
      { qty: -3, popis: 'qty -3' },
      { qty: 'abc', popis: "qty 'abc'" },
      { qty: 1.5, popis: 'qty 1.5' },
      { qty: undefined, popis: 'qty chýba' },
    ];
    for (let i = 0; i < pripady.length; i++) {
      const { qty, popis } = pripady[i];
      const em = 'qa.edge.qty' + i + '@qa-biz.local';
      const item = { product_id: TRICKO }; if (qty !== undefined) item.qty = qty;
      const r = await obj(payload(em, [item]));
      const os = objPodlaMailu(em);
      const o = os[0];
      const detail = 'HTTP ' + r.status + (o ? ', objednávka total=' + kratko(o.total) + ', qty=' + kratko(o.items[0] && o.items[0].qty) + ', subtotal=' + kratko(o.items[0] && o.items[0].subtotal) : ', bez objednávky');
      ok(popis + ': nie 500', r.status !== 500, detail);
      ok(popis + ': odmietnuté (400) a žiadna objednávka s nulovou/zápornou/nečíselnou sumou', r.status === 400 && os.length === 0, detail);
    }
    {
      const em = 'qa.edge.qty9999@qa-biz.local';
      const r = await obj(payload(em, [{ product_id: TRICKO, qty: 9999 }]));
      const o = objPodlaMailu(em)[0];
      ok('qty 9999: nie 500', r.status !== 500, 'HTTP ' + r.status);
      ok('qty 9999: odmietnuté alebo obmedzené (qty ≤ 100)', r.status === 400 || (!!o && +o.items[0].qty <= 100), 'HTTP ' + r.status + (o ? ', vznikla objednávka qty=' + o.items[0].qty + ', total=' + o.total + ' €' : ''));
    }

    console.log('\n5) Potvrdenie dvakrát:');
    console.log('   a) Stripe bez STRIPE_SECRET_KEY (nikdy sa nevolá naživo):');
    // Hosťka bez účtu + referral kód partnerky → pri potvrdení ide provízia partnerke (vetva partner_id)
    const st = await obj(payload(HOST_EMAIL, [{ product_id: TRICKO, qty: 1, size: 'L' }], { client_name: HOST_MENO, referral_code: 'QAEDGE', payment_method: 'stripe' }));
    ok('objednávka na kartu prijatá (hosťka bez účtu, referral kód partnerky)', st.status === 200 && st.d && st.d.ok, 'HTTP ' + st.status + ' ' + kratko(st.d));
    const stId = st.d && st.d.id, stNum = st.d && st.d.order_number;
    ok('partnerka priradená podľa referral kódu', !!objId(stId) && objId(stId).partner_id === PARTNER_ID, kratko(objId(stId) && objId(stId).partner_id));
    const co = await j('/api/stripe/checkout-order', { method: 'POST', body: { order_number: stNum } });
    ok('checkout-order bez kľúča: 400, nie 500', co.status === 400, 'HTTP ' + co.status + ' ' + kratko(co.d));
    const vo = await j('/api/stripe/verify-order', { method: 'POST', body: { session_id: 'cs_test_falosna_qa_123' } });
    ok('verify-order s falošným session id: 400, nie 500 a nie 200', vo.status === 400, 'HTTP ' + vo.status + ' ' + kratko(vo.d));
    const vo0 = await j('/api/stripe/verify-order', { method: 'POST', body: {} });
    ok('verify-order bez session id: 400', vo0.status === 400, 'HTTP ' + vo0.status);
    ok('po falošnom verify ostáva objednávka pending bez paid_at', objId(stId).status === 'pending' && !objId(stId).paid_at, kratko(objId(stId).status));

    console.log('   b) Admin PUT status=paid 5× paralelne — hosťka + referral kód (vetva partner_id):');
    // Zahriatie keep-alive spojení, aby dávka dorazila na server čo najtesnejšie za sebou
    const zahrej = () => Promise.all([1, 2, 3, 4, 5].map(() => j('/api/admin/orders?status=pending', {}, adm)));
    await zahrej();
    // Výplň: paralelné zápisy (súborové I/O vo fronte NeDB) otvárajú okno medzi
    // „prečítaj status" a „zapíš paid" — bez nich NeDB vybaví jedno potvrdenie
    // skôr, než server naparsuje ďalšie, a preteky sa netrafia.
    const vypln = () => obj(payload('qa.edge.vypln@qa-biz.local', [{ product_id: FLASA, qty: 1 }]));
    const davka = id => Promise.all([vypln(), potvrd(id), vypln(), potvrd(id), vypln(), potvrd(id), vypln(), potvrd(id), vypln(), potvrd(id), vypln()]).then(r => r.filter((x, i) => i % 2 === 1));
    const kb = await davka(stId);
    ok('všetky potvrdenia vrátili 200', kb.every(r => r.status === 200), 'HTTP ' + kb.map(r => r.status).join('/'));
    await cakaj(800);
    const sto = objId(stId);
    ok('objednávka je paid a má paid_at', !!sto && sto.status === 'paid' && !!sto.paid_at, kratko(sto && { status: sto.status, paid_at: sto.paid_at }));
    ok('paid_at zapísané len raz (1 verzia dokumentu s paid_at)', verziePaid(stId).length === 1, 'zapísané ' + verziePaid(stId).length + '×: ' + verziePaid(stId).map(v => v.paid_at).join(' | '));
    const txHost = rd('transactions.db').filter(t => t.order_id === stId);
    ok('1 provízna transakcia s order_id (nie duplicitná)', txHost.length === 1, 'n=' + txHost.length + ' ' + kratko(txHost.map(t => ({ amount: t.amount, partner: t.partner_id }))));
    const txIds = new Set(txHost.map(t => t._id));
    const com = rd('commissions.db').filter(c => txIds.has(c.transaction_id));
    ok('provízie patria len jednej transakcii', com.length > 0 && new Set(com.map(c => c.transaction_id)).size === 1, 'provízií=' + com.length + ', transakcií=' + new Set(com.map(c => c.transaction_id)).size + ' ' + kratko(com.map(c => ({ partner: c.partner_id, amount: c.amount, level: c.level }))));
    const provNotif = rd('notifications.db').filter(n => n.user_id === PARTNER_ID && n.type === 'commission');
    ok('partnerka dostala 1 notifikáciu o provízii', provNotif.length === 1, 'n=' + provNotif.length);
    const provMail = rd('mail_log.db').filter(m => m.to === PARTNER_EMAIL && /provízi/i.test(m.subject || ''));
    ok('partnerke odišiel 1 mail o provízii (MAIL_CAPTURE)', provMail.length === 1, 'n=' + provMail.length);
    const invHost = rd('invoices.db').filter(i => i.client_email === HOST_EMAIL);
    ok('faktúra: najviac 1', invHost.length <= 1, 'n=' + invHost.length);
    console.log('      (faktúr pri admin potvrdení: ' + invHost.length + ' — admin cesta faktúru nevystavuje, verify-order áno)');

    console.log('   c) Opakované potvrdenie už zaplatenej (sekvenčne):');
    const paidPred = sto && sto.paid_at;
    await cakaj(60);
    const k3 = await potvrd(stId);
    await cakaj(300);
    const sto2 = objId(stId);
    ok('opakované potvrdenie prešlo bez 500', k3.status !== 500, 'HTTP ' + k3.status);
    ok('opakované potvrdenie NEmení paid_at', !!sto2 && sto2.paid_at === paidPred, paidPred + ' → ' + (sto2 && sto2.paid_at));
    ok('opakované potvrdenie nepridá ďalšiu transakciu', rd('transactions.db').filter(t => t.order_id === stId).length === txHost.length, 'n=' + rd('transactions.db').filter(t => t.order_id === stId).length);

    console.log('   d) Admin PUT status=paid 5× paralelne — registrovaná členka (vetva sponzor / awardPurchaseCommission):');
    const cl = await obj(payload(KUP1_EMAIL, [{ product_id: TRICKO, qty: 1, size: 'M' }], { client_name: KUP1_MENO, referral_code: 'QAEDGE' }));
    const clId = cl.d && cl.d.id;
    ok('objednávka členky vytvorená', cl.status === 200 && !!clId, 'HTTP ' + cl.status);
    await zahrej();
    const kd = await davka(clId);
    ok('všetky potvrdenia vrátili 200', kd.every(r => r.status === 200), 'HTTP ' + kd.map(r => r.status).join('/'));
    await cakaj(800);
    ok('členka: paid_at zapísané len raz', verziePaid(clId).length === 1, 'zapísané ' + verziePaid(clId).length + '×');
    const txCl = rd('transactions.db').filter(t => t.client_name === KUP1_MENO || t.order_id === clId);
    ok('členka: 1 provízna transakcia (nie duplicitná)', txCl.length === 1, 'n=' + txCl.length + ' ' + kratko(txCl.map(t => ({ amount: t.amount, partner: t.partner_id, notes: t.notes }))));
    // „Predaj" ide každému adminovi (seed má aj Mareka a Beátu) — rátame len QA admina
    const predaj = rd('notifications.db').filter(n => n.type === 'sale' && n.user_id === ADMIN_ID && String(n.body || '').includes(KUP1_MENO));
    ok('členka: QA adminovi prišla 1 notifikácia „Predaj" (nie viac)', predaj.length === 1, 'n=' + predaj.length);
    const odz = rd('notifications.db').filter(n => n.user_id === KUP1_ID && /odznak/i.test(n.title || ''));
    ok('členka: odznak za merch pripísaný raz (max 1 notifikácia)', odz.length <= 1, 'n=' + odz.length);
    const kup1 = rd('users.db').find(u => u._id === KUP1_ID);
    console.log('      (sponsor_id členky po štarte: ' + kratko(kup1 && kup1.sponsor_id) + ', merch_owned: ' + kratko(kup1 && kup1.merch_owned) + ')');

    console.log('   e) Neznámy status v admin PUT:');
    const zlyStatus = await j('/api/admin/orders/' + zo._id, { method: 'PUT', body: { status: 'hocico' } }, adm);
    await cakaj(200);
    ok('status „hocico" odmietnutý (400) a neuložený', zlyStatus.status === 400 && objId(zo._id).status !== 'hocico', 'HTTP ' + zlyStatus.status + ', v DB status=' + objId(zo._id).status);

    console.log('   f) Simulovaný Stripe webhook (dev bez STRIPE_WEBHOOK_SECRET — bez siete):');
    const wb = await obj(payload(KUP2_EMAIL, [{ product_id: TRICKO, qty: 1, size: 'S' }], { client_name: KUP2_MENO, referral_code: 'QAEDGE', payment_method: 'stripe' }));
    const wbId = wb.d && wb.d.id, wbNum = wb.d && wb.d.order_number;
    ok('objednávka pre webhook vytvorená', wb.status === 200 && !!wbId, 'HTTP ' + wb.status);
    const udalost = id => ({ id, type: 'checkout.session.completed', data: { object: { id: 'cs_qa_' + id, payment_status: 'paid', metadata: { type: 'order', order_number: wbNum } } } });
    const hook = ev => j('/api/stripe/webhook', { method: 'POST', body: ev });
    const [w1, w2] = await Promise.all([hook(udalost('evt_qa_edge_A')), hook(udalost('evt_qa_edge_B'))]);
    if (w1.status !== 200 || w2.status !== 200) {
      console.log('      ↩ webhook nedostupný (HTTP ' + w1.status + '/' + w2.status + ') — simulácia preskočená');
    } else {
      await cakaj(800);
      const wbo = objId(wbId);
      ok('2 rôzne eventy tej istej platby: objednávka paid', !!wbo && wbo.status === 'paid' && !!wbo.paid_at, kratko(wbo && wbo.status));
      ok('webhook: paid_at zapísané len raz (update filtrovaný status≠paid)', verziePaid(wbId).length === 1, 'zapísané ' + verziePaid(wbId).length + '×');
      const odz2 = rd('notifications.db').filter(n => n.user_id === KUP2_ID && /odznak/i.test(n.title || ''));
      ok('webhook: odznak za merch pripísaný raz', odz2.length <= 1, 'n=' + odz2.length);
      const txWb = rd('transactions.db').filter(t => t.client_name === KUP2_MENO || t.order_id === wbId);
      ok('webhook: provízia zapísaná ako pri admin potvrdení', txWb.length >= 1, 'n=' + txWb.length + ' — Stripe cesta províziu nezapisuje');
      const invWb = rd('invoices.db').filter(i => i.client_email === KUP2_EMAIL);
      ok('webhook: faktúra vystavená (ako pri verify-order)', invWb.length === 1, 'n=' + invWb.length);
      const [w3, w4] = await Promise.all([hook(udalost('evt_qa_edge_C')), hook(udalost('evt_qa_edge_C'))]);
      ok('ten istý event id 2× paralelne: jeden označený ako duplicitný', [w3, w4].filter(r => r.d && r.d.duplicate).length === 1, kratko([w3.d, w4.d]));
    }

    console.log('\n6) Chýbajúci / nevalidný e-mail:');
    const e1 = await obj(payload('', [{ product_id: TRICKO, qty: 1 }]));
    ok("client_email '' → 400", e1.status === 400, 'HTTP ' + e1.status);
    ok("client_email '' → žiadna objednávka", objPodlaMailu('').length === 0, 'n=' + objPodlaMailu('').length);
    const e2 = await obj(payload('nie-email', [{ product_id: TRICKO, qty: 1 }]));
    ok("client_email 'nie-email' → 400", e2.status === 400, 'HTTP ' + e2.status + ' ' + kratko(e2.d));
    ok("client_email 'nie-email' → žiadna objednávka", objPodlaMailu('nie-email').length === 0, 'vzniklo ' + objPodlaMailu('nie-email').length);
    const e3 = await obj(payload('   ', [{ product_id: TRICKO, qty: 1 }]));
    ok("client_email '   ' (medzery) → 400", e3.status === 400, 'HTTP ' + e3.status);
    ok("client_email '   ' → žiadna objednávka s prázdnym e-mailom", objPodlaMailu('').length === 0, 'vzniklo ' + objPodlaMailu('').length + ' s client_email=""');
    const e4 = await obj(payload(12345, [{ product_id: TRICKO, qty: 1 }]));
    ok('client_email ako číslo → 400, nie 500', e4.status === 400, 'HTTP ' + e4.status + ' ' + kratko(e4.d));
    const e5 = await obj(payload('qa.edge.bezmena@qa-biz.local', [{ product_id: TRICKO, qty: 1 }], { client_name: '' }));
    ok("client_name '' → 400", e5.status === 400, 'HTTP ' + e5.status);

    console.log('\n7) Príliš veľký košík / zvláštne vstupy:');
    const VEL = 'qa.edge.velky@qa-biz.local';
    const velke = []; for (let i = 0; i < 200; i++) velke.push({ product_id: i % 2 ? TRICKO : FLASA, qty: 1 });
    const tv = Date.now();
    const v = await obj(payload(VEL, velke));
    const velo = objPodlaMailu(VEL)[0];
    ok('200 položiek: nie 500', v.status !== 500, 'HTTP ' + v.status + ' ' + kratko(v.d));
    console.log('      (200 položiek: HTTP ' + v.status + ', ' + (Date.now() - tv) + ' ms, položiek v DB=' + (velo && velo.items.length) + ', total=' + (velo && velo.total) + ' € — bez limitu na veľkosť košíka)');
    const BEZ = 'qa.edge.bezid@qa-biz.local';
    const bez = await obj(payload(BEZ, [{ qty: 1 }]));
    ok('položka bez product_id: nie 500', bez.status !== 500, 'HTTP ' + bez.status);
    ok('položka bez product_id: odmietnuté, žiadna objednávka', bez.status === 400 && objPodlaMailu(BEZ).length === 0, 'HTTP ' + bez.status + ', objednávok=' + objPodlaMailu(BEZ).length + ' ' + kratko(objPodlaMailu(BEZ)[0] && { items: objPodlaMailu(BEZ)[0].items, total: objPodlaMailu(BEZ)[0].total }));
    const nul = await obj(payload('qa.edge.itemsnull@qa-biz.local', null));
    ok('items:null → 400, nie 500', nul.status === 400, 'HTTP ' + nul.status + ' ' + kratko(nul.d));
    const nulItem = await obj(payload('qa.edge.itemnull@qa-biz.local', [null]));
    ok('items:[null] → 400, nie 500', nulItem.status === 400, 'HTTP ' + nulItem.status + ' ' + kratko(nulItem.d));
    const STR = 'qa.edge.itemsstr@qa-biz.local';
    const str = await obj(payload(STR, 'abc'));
    ok("items:'abc' (reťazec) → 400, žiadna objednávka", str.status === 400 && objPodlaMailu(STR).length === 0, 'HTTP ' + str.status + ', objednávok=' + objPodlaMailu(STR).length + ' ' + kratko(objPodlaMailu(STR)[0] && { items: objPodlaMailu(STR)[0].items, total: objPodlaMailu(STR)[0].total }));
    const OPR = 'qa.edge.operator@qa-biz.local';
    const opr = await obj(payload(OPR, [{ product_id: { $ne: null }, qty: 1 }]));
    ok('product_id ako NoSQL operátor {$ne:null} → 400, žiadna objednávka', opr.status === 400 && objPodlaMailu(OPR).length === 0, 'HTTP ' + opr.status + ', objednávok=' + objPodlaMailu(OPR).length + ' ' + kratko(objPodlaMailu(OPR)[0] && objPodlaMailu(OPR)[0].items.map(i => i.product_name)));
    const rgx = await obj(payload('qa.edge.regex@qa-biz.local', [{ product_id: { $regex: 'a' }, qty: 1 }]));
    ok('product_id {$regex} → 400, nie 500', rgx.status === 400, 'HTTP ' + rgx.status + ' ' + kratko(rgx.d));
    const rf1 = await obj(payload('qa.edge.ref1@qa-biz.local', [{ product_id: TRICKO, qty: 1 }], { referral_code: '(' }));
    ok("referral_code '(' → nie 500", rf1.status !== 500, 'HTTP ' + rf1.status + ' ' + kratko(rf1.d));
    const RF2 = 'qa.edge.ref2@qa-biz.local';
    const rf2 = await obj(payload(RF2, [{ product_id: TRICKO, qty: 1 }], { referral_code: '.*' }));
    const rf2o = objPodlaMailu(RF2)[0];
    ok("referral_code '.*' nepriradí cudziu partnerku (partner_id null)", rf2.status === 200 && !!rf2o && !rf2o.partner_id, 'HTTP ' + rf2.status + ', partner_id=' + kratko(rf2o && rf2o.partner_id) + ' (' + kratko(rf2o && rf2o.partner_name) + ')');
    const rf3 = await obj(payload('qa.edge.ref3@qa-biz.local', [{ product_id: TRICKO, qty: 1 }], { referral_code: 123 }));
    ok('referral_code ako číslo → nie 500', rf3.status !== 500, 'HTTP ' + rf3.status + ' ' + kratko(rf3.d));
    const POS = 'qa.edge.posta@qa-biz.local';
    const pos = await obj(payload(POS, [{ product_id: TRICKO, qty: 1 }], { delivery: 'post' }));
    const poso = objPodlaMailu(POS)[0];
    ok('doručenie poštou BEZ adresy → 400', pos.status === 400 && !poso, 'HTTP ' + pos.status + ', v DB delivery=' + kratko(poso && poso.delivery) + ', shipping=' + kratko(poso && poso.shipping));
    const pos2 = await obj(payload('qa.edge.posta2@qa-biz.local', [{ product_id: TRICKO, qty: 1 }], { delivery: 'post', shipping: { name: 'X', street: '', zip: '96001', city: 'Zvolen' } }));
    ok('doručenie poštou s neúplnou adresou → 400', pos2.status === 400, 'HTTP ' + pos2.status);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nOKRAJOVÉ PRÍPADY OBJEDNÁVOK: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-800));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
