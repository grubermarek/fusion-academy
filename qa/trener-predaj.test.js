/**
 * Trénerský predaj na mieste (Nelka 23. 10. 2026: „klikla som na Predaj a nič sa nestalo").
 *
 * Príčina: `sellConfirm` posielal telo cez JSON.stringify, hoci `api()` si ho zabaľuje samo —
 * server dostal dvojito zabalený JSON, vrátil 400 ako HTML stránku, `res.json()` v prehliadači
 * spadol a tlačidlo nepovedalo ani slovo. Žiadny predaj sa tak nikdy nezapísal.
 *
 * Overuje celý tok pre permanentku aj mesačné členstvo:
 *  - vstupy/členstvo klientke, história, záznam v db.memberships (kto predal)
 *  - tržba (transakcia + admin „Predaje" + Financie), faktúra, hotovosť u trénera
 *  - provízia sponzorovi, oznámenia klientke aj adminovi, audit
 *  - cena bez automatickej obnovy (+10 %) a dohodnutá cena klientky
 *  - práva: klientka predávať nesmie
 *
 * Spustenie:  node qa/trener-predaj.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4553;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-sell-'));
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };
async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body !== undefined ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  const text = await r.text();
  let d = null; try { d = JSON.parse(text); } catch (e) { d = { _raw: text.slice(0, 120) }; }
  return { status: r.status, d };
}
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const rd = f => { const p = path.join(DATA, f); if (!fs.existsSync(p)) return []; const m = new Map();
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l.trim()) continue; let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o.$$indexCreated) continue; if (o.$$deleted) { m.delete(o._id); continue; } m.set(o._id, o); } return [...m.values()]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const user = id => rd('users.db').find(u => u._id === id) || {};

(async () => {
  console.log('STATICKÉ (chyba, pre ktorú tlačidlo mlčalo)');
  const tr = fs.readFileSync(path.join(ROOT, 'public', 'trainer.html'), 'utf8');
  ok('predaj neposiela dvojito zabalené telo', !/\/api\/trainer\/sell',\{method:'POST',body:JSON\.stringify/.test(tr));
  ok('api() nespadne na odpovedi, ktorá nie je JSON (inak tlačidlo mlčí)', /JSON\.parse\(text\)/.test(tr) && /Chyba servera/.test(tr));
  ok('v trénerskom paneli už nikde nie je body:JSON.stringify', !/body:JSON\.stringify/.test(tr));

  // ── fixtúry ──
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zak = { rank: 1, is_admin: false, active: true, visit_count: 0, referral_credit: 0, city: 'Zvolen' };
  const ADM = 'qaSpAdmin00001', TRE = 'qaSpTrener0001', KL1 = 'qaSpKlient0001', KL2 = 'qaSpKlient0002', KL3 = 'qaSpKlient0003', SPZ = 'qaSpSponzor001';
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: ADM, name: 'Admin Predaj', email: 'qa.sp.admin@qa-biz.local', password: hash, referral_code: 'QASPADM', ...zak, is_admin: true, user_type: 'admin', created_at: '2026-01-01' },
    { _id: TRE, name: 'Nela Predajná', email: 'qa.sp.trener@qa-biz.local', password: hash, referral_code: 'QASPTRE', ...zak, user_type: 'trainer', created_at: '2026-02-01' },
    { _id: SPZ, name: 'Sponzorka Klientkina', email: 'qa.sp.sponzor@qa-biz.local', password: hash, referral_code: 'QASPSPZ', ...zak, user_type: 'client', created_at: '2026-02-01' },
    // KL1 kupuje permanentku, sponzorkou je klientka (kredit), KL2 členstvo (sponzor tréner → provízia)
    { _id: KL1, name: 'Permanentková Klientka', email: 'qa.sp.kl1@qa-biz.local', password: hash, referral_code: 'QASPK1', sponsor_id: SPZ, ...zak, user_type: 'client', single_entries: 2, created_at: '2026-03-01' },
    { _id: KL2, name: 'Členská Klientka', email: 'qa.sp.kl2@qa-biz.local', password: hash, referral_code: 'QASPK2', sponsor_id: TRE, ...zak, user_type: 'client', created_at: '2026-03-01' },
    // KL3 má dohodnutú cenu — prirážka za platbu bez obnovy sa na ňu nevzťahuje
    { _id: KL3, name: 'Dohodnutá Klientka', email: 'qa.sp.kl3@qa-biz.local', password: hash, referral_code: 'QASPK3', ...zak, user_type: 'client', custom_prices: { bronze: 30 }, created_at: '2026-03-01' },
  ]));
  fs.writeFileSync(path.join(DATA, 'products.db'), riadky([
    { _id: 'qaSpProd1', name: 'Tielko Fusion', price: 25, active: true, cat: 'merch', stock: 10, created_at: '2026-03-01' },
  ]));

  console.log('\nSERVER');
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_FAKE: '1', MAIL_OFF: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await sleep(1000); } }
  await sleep(4000);
  try {
    const tj = {}, aj = {}, kj = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.sp.trener@qa-biz.local', password: 'Heslo123!' } }, tj);
    ok('trénerka prihlásená', lg.status === 200, JSON.stringify(lg.d));
    await j('/api/login', { method: 'POST', body: { email: 'qa.sp.admin@qa-biz.local', password: 'Heslo123!' } }, aj);
    await j('/api/login', { method: 'POST', body: { email: 'qa.sp.kl1@qa-biz.local', password: 'Heslo123!' } }, kj);

    // ── 1) katalóg a hľadanie klientky ──
    const opts = await j('/api/trainer/sell-options', {}, tj);
    const perm = (opts.d.plans || []).find(p => p.id === 'permanentka10');
    const bronze = (opts.d.plans || []).find(p => p.id === 'bronze');
    ok('katalóg sa načíta a obsahuje permanentky aj členstvá', opts.status === 200 && perm && bronze, JSON.stringify(opts.d).slice(0, 200));
    ok('permanentka 10 vstupov za 80 € bez prirážky (nie je to mesačné členstvo)', perm && perm.price === 80 && perm.bundle === true, JSON.stringify(perm));
    ok('mesačné členstvo na mieste je o 10 % drahšie (bez automatickej obnovy)', bronze && bronze.price === 54.9 && bronze.price_auto === 49.9, JSON.stringify(bronze));
    const hl = await j('/api/attendance/search-users?q=Permanentkov', {}, tj);
    ok('trénerka nájde klientku a dostane jej id', Array.isArray(hl.d) && hl.d[0] && hl.d[0].id === KL1, JSON.stringify(hl.d).slice(0, 150));

    // ── 2) ako to posiela prehliadač po oprave: objekt, nie string ──
    // presne to, čo posielal prehliadač: telo zabalené dvakrát
    const zle = await j('/api/trainer/sell', { method: 'POST', body: JSON.stringify(JSON.stringify({ user_id: KL1, kind: 'plan', plan_id: 'permanentka10', amount: 80 })) }, tj);
    ok('dvojito zabalené telo server odmietne (presne toto mlčalo v UI)', zle.status >= 400, 'HTTP ' + zle.status);

    const predaj = await j('/api/trainer/sell', { method: 'POST', body: { user_id: KL1, kind: 'plan', plan_id: 'permanentka10', amount: 80 } }, tj);
    ok('predaj permanentky prejde', predaj.status === 200 && predaj.d.ok && predaj.d.amount === 80, JSON.stringify(predaj.d));

    // ── 3) čo z toho dostala klientka ──
    const k1 = user(KL1);
    ok('klientke pribudlo 10 vstupov (2 → 12)', k1.single_entries === 12, 'vstupy: ' + k1.single_entries);
    const bundle = rd('memberships.db').find(m => m.user_id === KL1 && m.status === 'bundle');
    ok('má záznam permanentky s cenou a menom trénerky', bundle && bundle.price === 80 && bundle.sold_by === 'Nela Predajná', JSON.stringify(bundle && [bundle.plan_id, bundle.price, bundle.sold_by]));
    const hist = rd('konto_historia.db').filter(h => h.user_id === KL1 && h.typ === 'vstupy');
    ok('zmena vstupov je v histórii konta klientky (+10, zostatok 12)', hist.length === 1 && hist[0].zmena === 10 && hist[0].zostatok === 12, JSON.stringify(hist.map(h => [h.zmena, h.zostatok, h.dovod])));
    const notifK = rd('notifications.db').filter(n => n.user_id === KL1);
    ok('klientke prišlo oznámenie o permanentke aj o nákupe', notifK.some(n => /Permanentka aktivovaná/i.test(n.title || '')) && notifK.some(n => n.type === 'purchase'),
      JSON.stringify(notifK.map(n => n.title)));

    // ── 4) peniaze: tržba, faktúra, hotovosť u trénerky ──
    const tx = rd('transactions.db').filter(t => t.user_id === KL1 && t.type === 'single_entry');
    ok('tržba je zapísaná ako jednorazový vstup v hotovosti', tx.length === 1 && tx[0].amount === 80 && tx[0].payment_method === 'cash' && tx[0].recorded_by === TRE,
      JSON.stringify(tx.map(t => [t.type, t.amount, t.payment_method, t.note])));
    ok('permanentka tržbu nezdvojí (záznam členstva je bez spôsobu platby)', !bundle.payment_method, JSON.stringify(bundle && bundle.payment_method));
    const inv = rd('invoices.db').filter(i => i.user_id === KL1);
    ok('vystavila sa faktúra na 80 € v hotovosti', inv.length === 1 && +inv[0].total === 80, JSON.stringify(inv.map(i => [i.number || i.invoice_number, i.total, i.method])));
    const hot = rd('payouts.db').filter(r => r._type === 'cash_collected' && r.trainer_id === TRE);
    ok('hotovosť 80 € drží trénerka (zrážka z výplaty, kým neodovzdá)', hot.length === 1 && hot[0].amount === 80 && hot[0].status === 'held', JSON.stringify(hot.map(r => [r.amount, r.status, r.note])));

    // ── 5) odmena za privedenie klientky ──
    const sponz = user(SPZ);
    // 23. 10.: odmena za privedenú klientku je JEDNA — 10 % ako ambasádorská provízia (po 14 dňoch do kreditu).
    // Okamžitý 10 % kredit navyše (spolu 20 %) je preč.
    ok('sponzorka klientky nedostala okamžitý kredit navyše (odmena ide raz, cez províziu)', Math.abs(+sponz.referral_credit || 0) < 0.01, 'kredit: ' + sponz.referral_credit);
    const kom = rd('commissions.db').filter(c => c.partner_id === SPZ);
    ok('provízia 10 % (8 €) je zapísaná a čaká na 14-dňovú lehotu', kom.length === 1 && Math.abs(kom[0].amount - 8) < 0.01 && kom[0].status === 'pending', JSON.stringify(kom.map(c => [c.amount, c.status])));
    ok('oznámenie o odmene prišlo sponzorke', rd('notifications.db').some(n => n.user_id === SPZ && /kredit|provízia/i.test(n.title || '')),
      JSON.stringify(rd('notifications.db').filter(n => n.user_id === SPZ).map(n => n.title)));

    // ── 6) admin to vidí ──
    const notifA = rd('notifications.db').filter(n => n.user_id === ADM);
    ok('adminovi prišlo oznámenie o predaji a hotovosti u trénerky', notifA.some(n => /predal\/a/i.test(n.title || '') && /80/.test(n.title || '')), JSON.stringify(notifA.map(n => n.title)));
    const mes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date()).slice(0, 7);
    const pred = await j('/api/admin/predaje?month=' + mes, {}, aj);
    const riadokPredaja = ((pred.d && (pred.d.rows || pred.d.predaje || pred.d)) || []).find(r => JSON.stringify(r).includes('Permanentk'));
    ok('predaj je v admin sekcii Predaje', !!riadokPredaja, JSON.stringify(pred.d).slice(0, 250));
    const fin = await j('/api/admin/finance/stats?month=' + mes, {}, aj);
    ok('tržba 80 € sa objaví vo Financiách', JSON.stringify(fin.d).includes('80'), JSON.stringify(fin.d).slice(0, 200));
    const vyp = await j('/api/admin/payouts?month=' + mes, {}, aj);
    const vypR = ((vyp.d && (vyp.d.rows || vyp.d)) || []).find(r => r.trainer === 'Nela Predajná');
    ok('vo výplatách trénerky je zrážka 80 € za drženú hotovosť', vypR && Math.abs((+vypR.cash_deduct || 0) - 80) < 0.01, JSON.stringify(vypR && [vypR.trainer, vypR.cash_deduct]));
    ok('predaj je v audite', rd('audit.db').some(a => a.action === 'trainer_sell'), JSON.stringify(rd('audit.db').map(a => a.action)));

    // ── 7) mesačné členstvo a dohodnutá cena ──
    const predaj2 = await j('/api/trainer/sell', { method: 'POST', body: { user_id: KL2, kind: 'plan', plan_id: 'bronze', amount: 54.9 } }, tj);
    const mem2 = rd('memberships.db').find(m => m.user_id === KL2 && m.status === 'active');
    const k2 = user(KL2);
    ok('členstvo je hneď aktívne a klientka je klient', predaj2.status === 200 && mem2 && mem2.plan_id === 'bronze' && k2.membership_plan === 'bronze', JSON.stringify([predaj2.d, mem2 && mem2.plan_id]));
    ok('pri členstve nesie tržbu záznam členstva (hotovosť, 54,90 €, kto predal)', mem2 && mem2.payment_method === 'cash' && mem2.price === 54.9 && mem2.sold_by === 'Nela Predajná', JSON.stringify(mem2 && [mem2.payment_method, mem2.price, mem2.sold_by]));
    ok('sponzorka-trénerka dostane províziu do výplaty, nie kredit', (+user(TRE).referral_credit || 0) === 0 && rd('commissions.db').some(c => c.partner_id === TRE), 'kredit trénerky: ' + user(TRE).referral_credit);
    const opts3 = await j('/api/trainer/sell-options?user_id=' + KL3, {}, tj);
    const b3 = (opts3.d.plans || []).find(p => p.id === 'bronze');
    ok('klientke s dohodnutou cenou sa prirážka nepripočíta (30 €)', b3 && b3.price === 30, JSON.stringify(b3));

    // ── 8) merch a práva ──
    const merch = await j('/api/trainer/sell', { method: 'POST', body: { user_id: KL1, kind: 'merch', product_id: 'qaSpProd1', qty: 2 } }, tj);
    const ord = rd('orders.db').filter(o => o.partner_id === KL1);
    ok('merch sa predá ako zaplatená objednávka (2 × 25 €)', merch.status === 200 && ord.length === 1 && ord[0].total === 50 && ord[0].status === 'paid' && ord[0].sold_by === 'Nela Predajná',
      JSON.stringify(ord.map(o => [o.total, o.status, o.sold_by])));
    const zlyPlan = await j('/api/trainer/sell', { method: 'POST', body: { user_id: KL1, kind: 'plan', plan_id: 'kids' } }, tj);
    ok('zrušený plán sa predať nedá (400)', zlyPlan.status === 400, 'HTTP ' + zlyPlan.status);
    const cudzi = await j('/api/trainer/sell', { method: 'POST', body: { user_id: KL2, kind: 'plan', plan_id: 'bronze' } }, kj);
    ok('klientka predávať nemôže (403)', cudzi.status === 403, 'HTTP ' + cudzi.status);
    const nikto = await j('/api/trainer/sell', { method: 'POST', body: { user_id: 'neexistuje', kind: 'plan', plan_id: 'bronze' } }, tj);
    ok('neexistujúci klient → 404 so zrozumiteľnou chybou', nikto.status === 404 && /nenájden/i.test(nikto.d.error || ''), JSON.stringify(nikto.d));
  } catch (e) { failed++; console.log('  ❌ výnimka: ' + (e.stack || e.message)); }
  finally {
    proc.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log(`\n${passed} ✅  ${failed} ❌`);
    if (failed) console.log(log.split('\n').filter(l => /error|chyba/i.test(l)).slice(-15).join('\n'));
    process.exit(failed ? 1 : 0);
  }
})();
