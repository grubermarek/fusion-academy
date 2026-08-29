/**
 * Zlúčenie dvoch účtov Ailiny Hankovej + refund Bronze.
 * Beží na KÓPII produkčného stavu (diagnostika 29. 8.) — overuje, že sa
 * nestratí história, peniaze sedia a Silver zostane nedotknutý.
 * Spustenie:  node qa/merge-hankova.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4525;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-merge-'));

let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };

const GM = '65t017uJMBdHRMFA';   // ailin.hankova@gmail.com — ostáva
const LO = 'jqIlQnhbzVy8LiCt';   // hankova@logro.sk — duplicitný

(async () => {
  const W = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  W('users.db', [
    { _id: GM, name: 'Ailina Hanková', email: 'ailin.hankova@gmail.com', phone: '+421907357418',
      user_type: 'client', active: true, rank: 1, referral_code: 'AH1', avatar: '/x.jpg', visit_count: 4,
      stripe_subscription_id: 'sub_1U8iQcD7ePYNrtvfBZZvd3Pq', stripe_sub_plan: 'silver',
      sponsor_id: 'y72YL9QS4LVl8f9c', created_at: '2026-02-07' },
    { _id: LO, name: 'Ailina Hanková', email: 'hankova@logro.sk', phone: '+421907357418',
      user_type: 'client', active: true, rank: 1, referral_code: 'AH2', visit_count: 2,
      sponsor_id: 'y72YL9QS4LVl8f9c', created_at: '2026-07-21' },
  ]);
  W('memberships.db', [
    { _id: 'mSilver', user_id: GM, plan_id: 'silver', plan_name: 'Silver', status: 'active', price: 75,
      started_at: '2026-08-26T00:00:00.000Z', expires_at: '2026-09-25T00:00:00.000Z' },
    { _id: 'mBronze', user_id: LO, plan_id: 'bronze', plan_name: 'Bronze', status: 'active', price: 50,
      started_at: '2026-08-18T00:00:00.000Z', expires_at: '2026-09-17T00:00:00.000Z' },
  ]);
  W('payments.db', [
    { _id: 'pSilver', user_id: GM, amount: 75, status: 'completed', provider: 'stripe', ref_id: 'silver', created_at: '2026-08-26T10:00:00.000Z' },
    { _id: 'pBronze40', user_id: LO, amount: 40, status: 'completed', ref_id: 'bronze', created_at: '2026-07-24T10:00:00.000Z' },
    { _id: 'pPending', user_id: LO, amount: 50, status: 'pending', provider: 'stripe', ref_id: 'bronze', created_at: '2026-07-24T09:00:00.000Z' },
  ]);
  W('invoices.db', [
    { _id: 'i49', number: '20260049', user_id: LO, client_name: 'Ailina Hanková', client_email: 'hankova@logro.sk',
      total: 40, status: 'paid', issued_at: '2026-08-18', payment_method: 'prevod', items: [{ desc: 'Bronze', qty: 1, total: 40 }] },
    { _id: 'i12', number: '20260012', user_id: LO, client_name: 'Ailina Hanková', total: 10, status: 'paid', issued_at: '2026-07-26' },
  ]);
  W('bookings.db', [
    { _id: 'b1', user_id: LO, user_name: 'Ailina Hanková', booking_date: '2026-07-24', status: 'cancelled' },
    { _id: 'b2', user_id: LO, user_name: 'Ailina Hanková', booking_date: '2026-07-26', status: 'cancelled' },
    { _id: 'b3', user_id: LO, user_name: 'Ailina Hanková', booking_date: '2026-07-26', status: 'attended', attendance_status: 'attended' },
    { _id: 'b4', user_id: GM, user_name: 'Ailina Hanková', booking_date: '2026-08-28', status: 'attended', attendance_status: 'attended' },
  ]);
  W('transactions.db', [
    { _id: 't40', user_id: LO, amount: 40, type: 'membership', payment_method: 'transfer', date: '2026-08-18', note: 'Bronze (prevod na účet) [promo ZL20QMII]' },
    { _id: 't10', user_id: LO, amount: 10, type: 'single_entry', payment_method: 'cash', date: '2026-07-26', note: 'Jednorazový vstup (1×)' },
    { _id: 't75', user_id: GM, amount: 75, type: 'subscription', payment_method: 'stripe', date: '2026-08-26', note: 'Silver' },
  ]);
  W('email_queue.db', [{ _id: 'eq1', user_id: LO, sequence: 'winback', step_id: 's1', scheduled_for: '2099-01-01', status: 'pending', created_at: '2026-08-01' }]);

  console.log('MERGE QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  await new Promise(r => setTimeout(r, 4000));

  try {
    const users = rd('users.db');
    const gm = users.find(u => u._id === GM), lo = users.find(u => u._id === LO);

    // ── refund ──
    const ref = rd('refunds.db');
    ok('refund je zapísaný', ref.length === 1, JSON.stringify(ref.map(r => ({ a: r.amount, t: r.type }))));
    ok('refunduje sa 40 € (skutočne zaplatené, nie cenníkových 50)', ref[0] && ref[0].amount === 40, JSON.stringify(ref[0] && ref[0].amount));
    ok('typ refundu = prevod (platila prevodom)', ref[0] && ref[0].type === 'transfer' && ref[0].gateway === 'manual');
    ok('dôvod je duplicita', ref[0] && ref[0].reason === 'duplicate');
    ok('pôvodná platba je označená ako refundovaná', (rd('payments.db').find(p => p._id === 'pBronze40') || {}).status === 'refunded');
    const cn = rd('invoices.db').find(i => i.type === 'credit_note');
    ok('vystavený dobropis na −40 €', cn && +cn.total === -40, JSON.stringify(cn && cn.total));
    ok('pôvodná faktúra je označená ako dobropisovaná', (rd('invoices.db').find(i => i.number === '20260049') || {}).status === 'credited');
    ok('klientke prišlo oznámenie o refunde', rd('notifications.db').some(n => n.user_id === GM && n.type === 'refund'));

    // ── Silver sa nesmie dotknúť ──
    const silver = rd('memberships.db').find(m => m._id === 'mSilver');
    ok('SILVER zostáva aktívny a nedotknutý', silver.status === 'active' && +silver.price === 75
      && silver.expires_at === '2026-09-25T00:00:00.000Z', JSON.stringify(silver.status));
    ok('Stripe odber na hlavnom účte ostal', gm.stripe_subscription_id === 'sub_1U8iQcD7ePYNrtvfBZZvd3Pq');
    ok('Bronze členstvo ukončené', (rd('memberships.db').find(m => m._id === 'mBronze') || {}).status === 'cancelled');

    // ── zlúčenie histórie ──
    const bks = rd('bookings.db');
    ok('všetky rezervácie sú na hlavnom účte', bks.every(b => b.user_id === GM) && bks.length === 4, JSON.stringify(bks.map(b => b.user_id)));
    ok('presunuté rezervácie nesú stopu pôvodu', bks.filter(b => b.merged_from === LO).length === 3);
    ok('návštevy sa spočítali (4 + 2)', gm.visit_count === 6, String(gm.visit_count));
    ok('mail hankova@logro.sk je zachovaný ako druhá adresa', (gm.alt_emails || []).includes('hankova@logro.sk'), JSON.stringify(gm.alt_emails));
    ok('hlavný účet si pamätá, s čím bol zlúčený', (gm.merged_accounts || []).includes(LO));
    ok('poznámka o zlúčení je v histórii klientky', rd('lead_notes.db').some(n => n.client_id === GM && /Zlúčené/.test(n.text)));

    // ── duplicitný účet ──
    ok('duplicitný účet je deaktivovaný', lo.active === false && lo.merged_into === GM);
    ok('duplicitný účet je označený v mene', /zlúčený účet/.test(lo.name), lo.name);
    ok('duplicitnému už nechodia maily ani SMS', lo.do_not_contact === true && lo.offers_optout === true && lo.sms_opt_out === true);
    ok('nedokončená platba zrušená', (rd('payments.db').find(p => p._id === 'pPending') || {}).status === 'cancelled');
    ok('čakajúce automatické maily zrušené', !rd('email_queue.db').some(m => m.user_id === LO && m.status === 'pending'));

    // ── účtovníctvo ostáva dohľadateľné ──
    const txLo = rd('transactions.db').filter(t => t.user_id === LO);
    ok('účtovné transakcie zostali na pôvodnom účte (audit)', txLo.length === 2, JSON.stringify(txLo.length));
    ok('10 € vstup sa NErefunduje (reálne odchodená hodina)', !ref.some(r => +r.amount === 10));
    ok('faktúry zostali na pôvodnom účte', rd('invoices.db').filter(i => i.user_id === LO && i.type !== 'credit_note').length === 2);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message + '\n' + e.stack);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nMERGE HANKOVÁ: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
