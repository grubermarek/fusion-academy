/**
 * AUDIT E2 — reconciliation. Prepočíta tržby z RAW dát a porovná ich s tým,
 * čo počítajú tri rôzne miesta v server.js. Číta len snapshot.
 *
 * Spustenie: node qa/audit-reconciliation.js <snapshot.json.gz> [YYYY-MM]
 *
 * Vzorce sú prepísané zo server.js:
 *   A = /api/admin/finance/stats  (r. 10907)
 *   B = /api/admin/stats          (r. 7905)
 *   C = brRevenueEvents()         (r. 19924)
 * Ak sa niektorý v kóde zmení, musí sa zmeniť aj tu — inak audit klame.
 */
const fs = require('fs');
const zlib = require('zlib');

const CESTA = process.argv[2];
const MESIAC = process.argv[3] || null;
if (!CESTA || !fs.existsSync(CESTA)) {
  console.error('Použitie: node qa/audit-reconciliation.js <snapshot.json.gz> [YYYY-MM]');
  process.exit(1);
}
const D = JSON.parse(zlib.gunzipSync(fs.readFileSync(CESTA)).toString());
const T = n => Array.isArray(D[n]) ? D[n] : [];
const eur = n => (Math.round(n * 100) / 100).toFixed(2).padStart(10) + ' €';

const users = T('users');
const uById = Object.fromEntries(users.map(u => [u._id, u]));
const adminIds = new Set(users.filter(u => u.is_admin).map(u => u._id));
const jeTest = u => !u ? false : (/test/i.test(u.name || '') || /@test-fa-qa\.local$|@qa-biz\.local$/i.test(u.email || '') || u.is_test);
const testIds = new Set(users.filter(jeTest).map(u => u._id));

const payDate = p => String(p.captured_at || p.created_at || p.date || '');
const vObdobi = d => !MESIAC || String(d || '').startsWith(MESIAC);

// ── RAW súčty ──────────────────────────────────────────────────────────────
const R = {};
R.payments = T('payments').filter(p => ['completed', 'active'].includes(p.status)
  && !p.accounting_skip && vObdobi(payDate(p)));
R.orders = T('orders').filter(o => o.status === 'paid' && vObdobi(o.paid_at || o.created_at));
R.invoices = T('invoices').filter(i => vObdobi(i.issued_at || i.created_at));
R.cashMembs = T('memberships').filter(m => !m._type && m.payment_method && vObdobi(m.created_at));
const txTyp = t => t.type || '—';
R.tx = T('transactions').filter(t => vObdobi(t.date || t.created_at));

const sucet = (list, pole) => +list.reduce((s, x) => s + (+x[pole] || 0), 0).toFixed(2);

console.log('SNAPSHOT z ' + (D._at || '?') + (MESIAC ? '   ·   obdobie: ' + MESIAC : '   ·   CELÁ HISTÓRIA'));

console.log('\n══ RAW SÚČTY (priamo z kolekcií) ' + '═'.repeat(38));
console.log('  payments (completed|active, !accounting_skip)  ' + eur(sucet(R.payments, 'amount')) + '   (' + R.payments.length + ' ks)');
console.log('  orders (paid) · total                          ' + eur(sucet(R.orders, 'total')) + '   (' + R.orders.length + ' ks)');
console.log('  invoices · total                               ' + eur(sucet(R.invoices, 'total')) + '   (' + R.invoices.length + ' ks)');
console.log('  memberships s payment_method · price           ' + eur(sucet(R.cashMembs, 'price')) + '   (' + R.cashMembs.length + ' ks)');
console.log('  transactions · amount                          ' + eur(sucet(R.tx, 'amount')) + '   (' + R.tx.length + ' ks)');

console.log('\n  transactions podľa typu:');
const podlaTypu = {};
for (const t of R.tx) { const k = txTyp(t); podlaTypu[k] = podlaTypu[k] || { n: 0, s: 0 }; podlaTypu[k].n++; podlaTypu[k].s += (+t.amount || 0); }
for (const [k, v] of Object.entries(podlaTypu).sort((a, b) => b[1].s - a[1].s))
  console.log('    ' + String(k).padEnd(24) + eur(v.s) + '   (' + v.n + ' ks)');

// ── A: /api/admin/finance/stats ────────────────────────────────────────────
const notAdmin = x => !adminIds.has(x.user_id);
const A_payments = T('payments').filter(p => ['completed', 'active'].includes(p.status) && !p.accounting_skip && notAdmin(p));
const A_orders = T('orders').filter(o => o.status === 'paid');
const A_single = T('transactions').filter(t => t.type === 'single_entry');
const A_priv = T('transactions').filter(t => t.type === 'private_lesson');
const A_event = T('transactions').filter(t => t.type === 'event_ticket' && +t.amount > 0);
const A_udalosti = [
  ...A_payments.map(p => ({ d: payDate(p), a: +p.amount || 0, z: 'payment' })),
  ...A_orders.map(o => ({ d: o.paid_at || o.created_at || '', a: +o.total || 0, z: 'order' })),
  ...A_single.map(t => ({ d: t.created_at || '', a: +t.amount || 0, z: 'single_entry' })),
  ...A_priv.map(t => ({ d: t.created_at || '', a: +t.amount || 0, z: 'private_lesson' })),
  ...A_event.map(t => ({ d: t.created_at || '', a: +t.amount || 0, z: 'event_ticket' })),
].filter(e => vObdobi(e.d));
const A = +A_udalosti.reduce((s, e) => s + e.a, 0).toFixed(2);

// ── B: /api/admin/stats ────────────────────────────────────────────────────
const txDate = t => String(t.date || t.created_at || '');
const B_tx = T('transactions').filter(t => !t.commission_only && vObdobi(txDate(t)));
const B = +B_tx.reduce((s, t) => s + (+t.amount || 0), 0).toFixed(2);

// ── C: brRevenueEvents() ───────────────────────────────────────────────────
const C_payments = T('payments').filter(p => ['completed', 'active'].includes(p.status) && !testIds.has(p.user_id));
const C_cash = T('memberships').filter(m => !m._type && m.payment_method && !testIds.has(m.user_id));
const C_orders = T('orders').filter(o => o.status === 'paid' && !testIds.has(o.user_id));
const C_udalosti = [
  ...C_payments.map(p => ({ d: payDate(p), a: +p.amount || 0 })),
  ...C_cash.map(m => ({ d: m.created_at || '', a: +m.price || 0 })),
  ...C_orders.map(o => ({ d: o.paid_at || o.created_at || '', a: +o.total || 0 })),
  ...T('transactions').filter(t => ['single_entry', 'private_lesson'].includes(t.type)).map(t => ({ d: t.created_at || '', a: +t.amount || 0 })),
  ...T('transactions').filter(t => t.type === 'event_ticket' && +t.amount > 0).map(t => ({ d: t.created_at || '', a: +t.amount || 0 })),
].filter(e => vObdobi(e.d));
const C = +C_udalosti.reduce((s, e) => s + e.a, 0).toFixed(2);

console.log('\n══ TRI DEFINÍCIE TRŽIEB ' + '═'.repeat(47));
console.log('  A  finance/stats  (payments+orders+3×tx)       ' + eur(A) + '   (' + A_udalosti.length + ' udalostí)');
console.log('  B  admin/stats    (len transactions)           ' + eur(B) + '   (' + B_tx.length + ' udalostí)');
console.log('  C  brRevenueEvents (A + členstvá v hotovosti)  ' + eur(C) + '   (' + C_udalosti.length + ' udalostí)');
console.log('  ' + '─'.repeat(62));
console.log('  rozdiel A − B                                 ' + eur(A - B));
console.log('  rozdiel C − A                                 ' + eur(C - A));

// ── kde presne sa A a B rozchádzajú ────────────────────────────────────────
console.log('\n══ ČÍM SA LÍŠIA ' + '═'.repeat(55));
const A_podla = {};
for (const e of A_udalosti) { A_podla[e.z] = A_podla[e.z] || { n: 0, s: 0 }; A_podla[e.z].n++; A_podla[e.z].s += e.a; }
console.log('  A obsahuje:');
for (const [k, v] of Object.entries(A_podla).sort((a, b) => b[1].s - a[1].s))
  console.log('    ' + k.padEnd(24) + eur(v.s) + '   (' + v.n + ')');
console.log('  B obsahuje len transactions — teda NEOBSAHUJE payments ani orders:');
console.log('    payments mimo B         ' + eur(sucet(A_payments.filter(p => vObdobi(payDate(p))), 'amount')));
console.log('    orders mimo B           ' + eur(sucet(A_orders.filter(o => vObdobi(o.paid_at || o.created_at)), 'total')));
console.log('  C navyše oproti A:');
console.log('    členstvá v hotovosti    ' + eur(sucet(C_cash.filter(m => vObdobi(m.created_at)), 'price')));

// ── dvojité započítanie ────────────────────────────────────────────────────
console.log('\n══ RIZIKO DVOJITÉHO ZAPOČÍTANIA ' + '═'.repeat(39));
const txSObj = T('transactions').filter(t => t.order_id || t.order_number);
console.log('  transakcií naviazaných na objednávku: ' + txSObj.length
  + (txSObj.length ? '  ⚠ v A sa objednávka aj transakcia rátajú zvlášť' : '  ✅'));
const payKMembs = T('payments').filter(p => p.plan_id || /membership/i.test(p.type || ''));
const membsSPlatbou = T('memberships').filter(m => m.payment_method);
console.log('  platieb za členstvo:      ' + payKMembs.length);
console.log('  členstiev s payment_method: ' + membsSPlatbou.length
  + '  ⚠ C ráta oboje — ak k členstvu existuje aj payment, je dvakrát');
const membsSPlatbouAjPay = membsSPlatbou.filter(m =>
  T('payments').some(p => p.user_id === m.user_id && Math.abs(+p.amount - (+m.price || 0)) < 0.01
    && Math.abs(new Date(p.created_at || 0) - new Date(m.created_at || 0)) < 86400000));
console.log('  z toho má aj zodpovedajúcu platbu do 24 h: ' + membsSPlatbouAjPay.length
  + (membsSPlatbouAjPay.length ? '  🔴 tieto sú v C dvakrát' : '  ✅'));

// ── faktúry vs platby ──────────────────────────────────────────────────────
console.log('\n══ FAKTÚRY vs PLATBY ' + '═'.repeat(50));
const faSuma = sucet(R.invoices.filter(i => +i.total > 0), 'total');
console.log('  faktúry (kladné)      ' + eur(faSuma) + '   (' + R.invoices.filter(i => +i.total > 0).length + ' ks)');
console.log('  dobropisy             ' + eur(sucet(R.invoices.filter(i => +i.total < 0), 'total')) + '   (' + R.invoices.filter(i => +i.total < 0).length + ' ks)');
console.log('  A − faktúry           ' + eur(A - faSuma) + '  ⚠ toľko tržby nemá faktúru');
