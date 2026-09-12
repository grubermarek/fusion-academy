/**
 * Admin „Peniaze" + PayPal preč + MLM provízie (Marek 12. 9.: „prejdi financie, účtovníctvo…
 * navrhni zjednodušenie a priprav to; MLM budeme používať a bude fungovať").
 *
 * Overuje:
 *  - admin má jednu sekciu Peniaze (Prehľad · Účtovníctvo a uzávierky · Faktúry a doklady)
 *    a v menu Výplaty trénerov; tréneri majú jednu lištu (Výplaty · Výkon · História · Úlohy),
 *  - mŕtve sekcie (Platby kartou/PayPal, Objednávky, Rezervácie) a loadOverview sú preč,
 *    deleteUser je definované raz, partner sa maže cez deletePartner,
 *  - exporty pre účtovníčku: Príjmy · Faktúry · Dobropisy a refundy · Výplaty,
 *  - PayPal: žiadne /api/paypal cesty, /api/config a /api/me bez PayPal, nákup s payment_method
 *    paypal odmietnutý, žiadne PayPal texty v appke ani na stránkach,
 *  - ručný predaj ukladá spôsob platby a v Predajoch je „karta",
 *  - MLM: predaj klientke so sponzorkou vytvorí províziu, je v súhrne provízií, dá sa vyplatiť.
 * Spustenie:  node qa/admin-peniaze.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4533;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-pen-'));
const ROOT = path.join(__dirname, '..');
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
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const rd = f => { const p = path.join(DATA, f); if (!fs.existsSync(p)) return []; const m = new Map();
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l.trim()) continue; let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o.$$indexCreated) continue; if (o.$$deleted) { m.delete(o._id); continue; } m.set(o._id, o); } return [...m.values()]; };

(async () => {
  // ── 1) statické kontroly ──
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const adm = fs.readFileSync(path.join(ROOT, 'public', 'admin.html'), 'utf8');
  const pub = ['client-dashboard.html', 'profile.html', 'pricing.html', 'index.html', 'obchod.html', 'shop.html']
    .map(f => ({ f, t: fs.readFileSync(path.join(ROOT, 'public', f), 'utf8') }));
  console.log('STATICKÉ KONTROLY');
  ok('server: žiadne /api/paypal cesty', !/app\.post\('\/api\/paypal/.test(srv));
  ok('server: žiadny PAYPAL_CLIENT_ID / PAYPAL_BASE', !/PAYPAL_CLIENT_ID|PAYPAL_BASE|ppApi\(|ppCreateOrder|ppRefundCapture/.test(srv));
  // ostáva: odmietnutie nákupu s payment_method paypal (komentár + hláška) a 2 regexy spôsobu platby
  const ppRiadky = srv.split('\n').filter(l => /paypal/i.test(l));
  ok('server: PayPal ostal len v odmietnutí nákupu a regexoch spôsobu platby', ppRiadky.length <= 4 && ppRiadky.every(l => /payment_method==='paypal'|PayPal už|\/stripe\|/.test(l)), ppRiadky.map(l => l.trim().slice(0, 60)).join(' | '));
  ok('server: ručný predaj ukladá payment_method', /payment_method:String\(req\.body\.payment_method\|\|'cash'\)/.test(srv));
  ok('server: migrácia Aleninho záznamu', /alena_tx_karta_v1/.test(srv));
  ok('admin: Peniaze v menu + Výplaty trénerov v menu', /Peniaze<\/span>/.test(adm) && /onclick="show\('payouts'\)"><i class="bi bi-wallet2 me-2"><\/i>Výplaty trénerov/.test(adm));
  ok('admin: staré položky Financie/Účtovníctvo/Predaje&faktúry/Platby v menu preč', !/<i class="bi bi-graph-up me-2"><\/i><span style="color:#C9A24C;font-weight:700">Financie<\/span>/.test(adm) && !/onclick="show\('payments'\)"/.test(adm) && !/show\('predaje'\)"><i class="bi bi-cash-stack/.test(adm));
  const listy = (adm.match(/class="adm-tabs pen-tabs"/g) || []).length;
  ok('admin: lišta Peniaze v 7 sekciách (prehľad, účtovníctvo, predaje, faktúry, predaj, refundy, neúspešné)', listy === 7, String(listy));
  ok('admin: lišta obsahuje tri záložky', /💶 Prehľad<\/button>.*🧮 Účtovníctvo a uzávierky<\/button>.*🧾 Faktúry a doklady<\/button>/.test(adm));
  ok('admin: druhá lišta Faktúry a doklady 5×', (adm.match(/class="adm-tabs pen-sub"/g) || []).length === 5);
  ok('admin: mŕtve sekcie preč (payments, orders, bookings)', !/id="s-payments"/.test(adm) && !/id="s-orders"/.test(adm) && !/id="s-bookings"/.test(adm) && !/loadAdminBookings|function loadPayments/.test(adm));
  ok('admin: loadOverview preč', !/loadOverview/.test(adm));
  ok('admin: deleteUser raz, deletePartner pre partnerov', (adm.match(/async function deleteUser\(/g) || []).length === 1 && /async function deletePartner\(/.test(adm) && /onclick='deletePartner\(/.test(adm));
  ok('admin: druhý zoznam predajov vo Faktúrach preč', !/invTabSales|function loadAllTx|function invTab\(/.test(adm));
  ok('admin: alias transactions → predaje', /if\(sec==='transactions'\)\{ show\('predaje'\); return; \}/.test(adm));
  const trenListy = (adm.match(/💵 Výplaty<\/button><button class="adm-tab[^"]*" onclick="show\('trainers'\)">🏅 Výkon<\/button><button class="adm-tab[^"]*" onclick="show\('classhistory'\)">🕘 História hodín<\/button><button class="adm-tab[^"]*" onclick="show\('tasktracker'\)">✅ Úlohy trénerov<\/button>/g) || []).length;
  ok('admin: tréneri majú jednu lištu vo 4 sekciách', trenListy === 4, String(trenListy));
  ok('admin: duplicitné tlačidlá Výkon/Výplaty preč', !/btn btn-sm btn-warning" onclick="show\('payouts'\)">💵 Výplaty<\/button>/.test(adm));
  ok('admin: exporty pre účtovníčku', /title:'Príjmy'/.test(adm) && /title:'Faktúry'/.test(adm) && /title:'Dobropisy a refundy'/.test(adm) && /title:'Výplaty'/.test(adm) && /Pre účtovníčku/.test(adm));
  ok('admin: bez PayPal textov', !/PayPal/.test(adm));
  for (const { f, t } of pub) ok('stránka bez PayPal: ' + f, !/paypal/i.test(t));

  // ── 2) fixtúry ──
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zak = { rank: 1, is_admin: false, active: true, visit_count: 0, referral_credit: 0, lead_source: 'qa', city: 'Detva', created_at: '2026-06-01' };
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaPenAdmin0001', name: 'Admin Peniaze', email: 'qa.pen.admin@qa-biz.local', password: hash, referral_code: 'QAPADM', ...zak, is_admin: true, user_type: 'admin' },
    { _id: 'qaPenPartner01', name: 'Petra Partnerka', email: 'qa.pen.partner@qa-biz.local', password: hash, referral_code: 'QAPPAR', ...zak, user_type: 'client', amb_rank: 2, sponsor_id: 'qaPenAdmin0001' },
    { _id: 'qaPenKlient001', name: 'Klara Klientka', email: 'qa.pen.klient@qa-biz.local', password: hash, referral_code: 'QAPKLI', ...zak, user_type: 'client', sponsor_id: 'qaPenPartner01' },
  ]));
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const pm = new Date(+DNES.slice(0, 4), +DNES.slice(5, 7) - 2, 1);
  fs.writeFileSync(path.join(DATA, 'monthly_winners.db'), riadky([{ _id: 'qaPenMW01', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'x', user_name: 'x', points: 1, type: 'month', created_at: '2026-01-01' }]));

  console.log('\nSERVER — štart…');
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', STRIPE_FAKE: '1' }, stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  await new Promise(r => setTimeout(r, 4000));
  try {
    // ── 3) PayPal je preč aj na API ──
    for (const cesta of ['/api/paypal/webhook', '/api/paypal/create-order', '/api/paypal/capture-order', '/api/membership/subscribe/activate']) {
      const r = await j(cesta, { method: 'POST', body: { event_type: 'PAYMENT.CAPTURE.COMPLETED' } }, {});
      ok('API: ' + cesta + ' neexistuje (404)', r.status === 404, 'HTTP ' + r.status);
    }
    const cfg = await j('/api/config', {}, {});
    ok('API: /api/config bez PayPal', cfg.status === 200 && cfg.d && !('paypal_client_id' in cfg.d) && !('paypal_env' in cfg.d), JSON.stringify(cfg.d));
    const kj = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.pen.klient@qa-biz.local', password: 'Heslo123!' } }, kj);
    const me = await j('/api/me', {}, kj);
    ok('API: /api/me bez paypal_subscription', me.status === 200 && me.d && !('paypal_subscription' in me.d) && ('stripe_subscription' in me.d), JSON.stringify(Object.keys(me.d || {})));
    const buy = await j('/api/membership/buy', { method: 'POST', body: { plan_id: 'bronze', payment_method: 'paypal' } }, kj);
    ok('API: nákup s payment_method paypal → 400', buy.status === 400 && /PayPal/.test((buy.d || {}).error || ''), 'HTTP ' + buy.status + ' ' + JSON.stringify(buy.d));

    // ── 4) ručný predaj kartou + MLM provízia ──
    const aj = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.pen.admin@qa-biz.local', password: 'Heslo123!' } }, aj);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));
    const tx = await j('/api/admin/transactions', { method: 'POST', body: { client_id: 'qaPenKlient001', product_name: 'Členstvo Bronze', amount: 50, payment_method: 'card', notes: 'QA' } }, aj);
    ok('ručný predaj zapísaný s províziou sponzorke', tx.status === 200 && tx.d && tx.d.ok && tx.d.commission && tx.d.partner_id === 'qaPenPartner01', JSON.stringify(tx.d));
    await new Promise(r => setTimeout(r, 600));
    const ulozene = rd('transactions.db').find(t => t._id === (tx.d || {}).id);
    ok('transakcia má payment_method card', ulozene && ulozene.payment_method === 'card', JSON.stringify(ulozene && { pm: ulozene.payment_method, type: ulozene.type }));
    const pred = await j('/api/admin/predaje?from=' + DNES.slice(0, 7) + '-01&to=' + DNES.slice(0, 7) + '-31', {}, aj);
    const riadok = (pred.d && pred.d.rows || []).find(r => r.who && r.who.name === 'Klara Klientka');
    ok('v Predajoch je „karta" a faktúra', riadok && riadok.method === 'karta' && riadok.invoice && riadok.invoice.number, JSON.stringify(riadok && { m: riadok.method, f: riadok.invoice }));
    const mesiac = DNES.slice(0, 7);
    const sum = await j('/api/admin/commissions/summary?month=' + mesiac, {}, aj);
    const petra = (sum.d || []).find(r => r.id === 'qaPenPartner01');
    ok('MLM: provízia sponzorke je v súhrne (pending > 0)', petra && petra.pending > 0, JSON.stringify(sum.d));
    const komis = rd('commissions.db').filter(c => c.partner_id === 'qaPenPartner01');
    ok('MLM: provízia = % z 50 € podľa hodnosti (rules v2)', komis.length === 1 && komis[0].amount > 0 && komis[0].amount <= 10 && komis[0].rules_version === 2, JSON.stringify(komis));
    const det = await j('/api/admin/commissions/detail?partner_id=qaPenPartner01&month=' + mesiac, {}, aj);
    ok('MLM: detail provízie nesie klientku a produkt', det.status === 200 && (det.d || []).some(c => c.client_name === 'Klara Klientka' && /Bronze/.test(c.product_name)), JSON.stringify(det.d));
    const pay = await j('/api/admin/commissions/pay', { method: 'POST', body: { partner_id: 'qaPenPartner01', month: mesiac } }, aj);
    const sum2 = await j('/api/admin/commissions/summary?month=' + mesiac, {}, aj);
    const petra2 = (sum2.d || []).find(r => r.id === 'qaPenPartner01');
    ok('MLM: vyplatenie preklopí pending → paid', pay.status === 200 && petra2 && petra2.pending === 0 && petra2.paid > 0, JSON.stringify(petra2));
    ok('MLM: admin (majiteľ) v súhrne provízií nie je', !(sum2.d || []).some(r => r.id === 'qaPenAdmin0001'));
    const partneri = await j('/api/admin/partners', {}, aj);
    ok('MLM: zoznam partnerov funguje', partneri.status === 200 && Array.isArray(partneri.d) && partneri.d.some(p => (p._id || p.id) === 'qaPenPartner01'), 'HTTP ' + partneri.status);

    // ── 5) stránky sa servírujú a majú nové časti ──
    const html = await (await fetch(BASE + '/admin.html')).text();
    ok('admin.html sa servíruje s lištou Peniaze', /pen-tabs/.test(html));
    const fin = await j('/api/admin/finance/stats?from=' + mesiac + '-01&to=' + mesiac + '-31', {}, aj);
    ok('Financie (Prehľad) odpovedajú aj bez Stripe (STRIPE_FAKE)', fin.status === 200 && fin.d && fin.d.revenue && fin.d.naklady && fin.d.banka === null, JSON.stringify(fin.d && { r: fin.d.revenue.period, b: fin.d.banka }));
  } catch (e) { failed++; console.log('  ❌ výnimka: ' + e.stack); }
  finally {
    proc.kill();
    console.log('\nADMIN PENIAZE: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 600);
  }
})();
