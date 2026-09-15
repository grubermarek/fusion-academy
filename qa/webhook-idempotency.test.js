/**
 * AUDIT E3 — webhooky (Marek 1. 9.).
 *
 * Stripe pri nepotvrdení doručuje ten istý event opakovane. Bez zápisu event.id
 * by sa členstvo predĺžilo viackrát za jednu platbu — pri ôsmich aktívnych
 * predplatných to je reálne riziko, nie teória.
 *
 * PayPal sa nepoužíva (v dátach nula platieb, kľúče nenastavené) a jeho webhook
 * neoveroval podpis, pritom vedel označiť platbu ako zaplatenú. Musí byť zavretý.
 *
 * Spustenie:  node qa/webhook-idempotency.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const PORT = 4556;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-wh-'));
const SECRET = 'whsec_qa_test_secret';

let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };

const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };

// Podpis presne tak, ako ho očakáva server: HMAC nad "t.telo".
function posli(telo, { podpis = true, t = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(telo);
  const headers = { 'Content-Type': 'application/json' };
  if (podpis) {
    const v1 = crypto.createHmac('sha256', SECRET).update(t + '.' + raw).digest('hex');
    headers['stripe-signature'] = 't=' + t + ',v1=' + v1;
  }
  return fetch(BASE + '/api/stripe/webhook', { method: 'POST', headers, body: raw })
    .then(async r => ({ status: r.status, text: (await r.text()).slice(0, 120) }));
}

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const O_MESIAC = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaWhKlientka001', name: 'Klara Predplatna', email: 'qa.wh@qa-biz.local',
      password: hash, user_type: 'client', active: true, referral_code: 'QAWH1', created_at: '2026-06-01',
      stripe_subscription_id: 'sub_qa_test_1', stripe_sub_plan: 'bronze' }),
    JSON.stringify({ _id: 'qaWhNeskora0001', name: 'Nora Neskora', email: 'qa.wh2@qa-biz.local',
      password: hash, user_type: 'client', active: true, referral_code: 'QAWH2', created_at: '2026-06-01',
      stripe_subscription_id: 'sub_qa_neskoro', stripe_sub_plan: 'bronze' }),
    JSON.stringify({ _id: 'qaWhDruha000001', name: 'Dvojita Odberatelka', email: 'qa.wh3@qa-biz.local',
      password: hash, user_type: 'client', active: true, referral_code: 'QAWH3', created_at: '2026-06-01',
      stripe_subscription_id: 'sub_qa_znamy', stripe_sub_plan: 'silver' }),
    JSON.stringify({ _id: 'qaWhAdmin000001', name: 'Admin QA', email: 'qa.wh.admin@qa-biz.local',
      password: hash, user_type: 'admin', is_admin: true, active: true, referral_code: 'QAWH9', created_at: '2026-06-01' }),
  ].join('\n') + '\n');
  const VCERA = new Date(Date.now() - 86400000).toISOString();
  fs.writeFileSync(path.join(DATA, 'memberships.db'), [
    JSON.stringify({ _id: 'qaWhMem00000001', user_id: 'qaWhKlientka001', plan_id: 'bronze', plan_name: 'Bronze',
      status: 'active', started_at: '2026-08-01', expires_at: O_MESIAC, price: 50, payment_method: 'card' }),
    JSON.stringify({ _id: 'qaWhMem00000002', user_id: 'qaWhNeskora0001', plan_id: 'bronze', plan_name: 'Bronze',
      status: 'expired', started_at: '2026-08-01', expires_at: VCERA, price: 50 }),
    JSON.stringify({ _id: 'qaWhMem00000003', user_id: 'qaWhDruha000001', plan_id: 'silver', plan_name: 'Silver',
      status: 'active', started_at: '2026-08-01', expires_at: O_MESIAC, price: 74.9 }),
  ].join('\n') + '\n');

  console.log('WEBHOOK IDEMPOTENCIA QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1',
           MAIL_OFF: '1', STRIPE_WEBHOOK_SECRET: SECRET },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  // activateMembership zakladá nový záznam, nemení pôvodný — pozeráme sa preto
  // na najneskoršiu platnosť zo všetkých členstiev klientky.
  const platnost = () => rd('memberships.db').filter(m => m.user_id === 'qaWhKlientka001')
    .map(m => String(m.expires_at||'')).sort().pop() || null;

  try {
    console.log('\nPodpis:');
    const bezPodpisu = await posli({ id: 'evt_qa_nopodpis', type: 'invoice.paid',
      data: { object: { billing_reason: 'subscription_cycle', subscription: 'sub_qa_test_1' } } }, { podpis: false });
    ok('bez podpisu sa odmietne', bezPodpisu.status === 400, JSON.stringify(bezPodpisu));

    const zlyPodpis = await fetch(BASE + '/api/stripe/webhook', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=' + 'a'.repeat(64) },
      body: JSON.stringify({ id: 'evt_qa_zly', type: 'invoice.paid' }) });
    ok('falošný podpis sa odmietne', zlyPodpis.status === 400, String(zlyPodpis.status));

    console.log('\nOpakované doručenie:');
    const pred = platnost();
    const EV = { id: 'evt_qa_obnova_1', type: 'invoice.paid',
      data: { object: { billing_reason: 'subscription_cycle', subscription: 'sub_qa_test_1' } } };

    const prvy = await posli(EV);
    ok('prvé doručenie prejde', prvy.status === 200, JSON.stringify(prvy));
    await new Promise(r => setTimeout(r, 500));
    const poPrvom = platnost();
    ok('a členstvo sa predĺži', poPrvom !== pred, pred + ' → ' + poPrvom);

    const druhy = await posli(EV);
    ok('druhé doručenie sa označí ako duplicita', druhy.status === 200 && /duplicate/.test(druhy.text), JSON.stringify(druhy));
    await new Promise(r => setTimeout(r, 500));
    ok('a platnosť sa NEZMENÍ', platnost() === poPrvom, poPrvom + ' → ' + platnost());

    // desaťkrát naraz — presne to, čo Stripe robí pri nepotvrdení
    const desat = await Promise.all(Array.from({ length: 10 }, () => posli({ ...EV, id: 'evt_qa_burst' })));
    await new Promise(r => setTimeout(r, 800));
    const poBurste = platnost();
    ok('desať súbežných doručení predĺži nanajvýš raz',
      new Set(rd('webhook_events.db').filter(e => e.event_id === 'evt_qa_burst').map(e => e._id)).size === 1,
      'zapísaných: ' + rd('webhook_events.db').filter(e => e.event_id === 'evt_qa_burst').length);
    ok('a všetky odpovede sú 200 (Stripe nesmie skúšať donekonečna)',
      desat.every(d => d.status === 200), JSON.stringify(desat.map(d => d.status)));

    console.log('\nRôzne eventy sa nezablokujú navzájom:');
    const iny = await posli({ id: 'evt_qa_iny', type: 'invoice.paid',
      data: { object: { billing_reason: 'subscription_cycle', subscription: 'sub_qa_test_1' } } });
    await new Promise(r => setTimeout(r, 500));
    ok('nový event prejde', iny.status === 200 && !/duplicate/.test(iny.text), JSON.stringify(iny));
    ok('a predĺži členstvo znova', platnost() !== poBurste, poBurste + ' → ' + platnost());

    // 15. 9. 2026: skutočné obnovy nechodili ako invoice.paid, ale ako invoice.payment_succeeded
    // a bez invoice.subscription (Stripe API 2025-03-31) — appka ich celé mesiace ticho zahodila.
    console.log('\nNová verzia Stripe API — obnova bez invoice.subscription:');
    const koniecObdobia = Math.floor(Date.now() / 1000) + 30 * 86400;
    const basil = (evId, typ, invId, sub, member) => ({ id: evId, type: typ, data: { object: { id: invId, billing_reason: 'subscription_cycle', amount_paid: 4990,
      parent: { type: 'subscription_details', subscription_details: { subscription: sub, metadata: { member_id: member, plan_id: 'bronze' } } },
      lines: { data: [{ amount: 4990, period: { start: koniecObdobia - 30 * 86400, end: koniecObdobia } }] } } } });
    const predBasil = platnost();
    const b1 = await posli(basil('evt_qa_basil_1', 'invoice.payment_succeeded', 'in_qa_basil_1', 'sub_qa_test_1', 'qaWhKlientka001'));
    await new Promise(r => setTimeout(r, 700));
    const poBasil = platnost();
    ok('invoice.payment_succeeded s odberom v parent.subscription_details predĺži členstvo', b1.status === 200 && poBasil !== predBasil, predBasil + ' → ' + poBasil);
    const trzby = () => rd('transactions.db').filter(t => t.type === 'subscription_renewal' && t.stripe_invoice_id === 'in_qa_basil_1' && t.amount === 49.9);
    ok('a zapíše tržbu 49,90 €', trzby().length === 1, JSON.stringify(trzby()));
    const b2 = await posli(basil('evt_qa_basil_1b', 'invoice.paid', 'in_qa_basil_1', 'sub_qa_test_1', 'qaWhKlientka001'));
    await new Promise(r => setTimeout(r, 700));
    ok('tá istá faktúra ešte raz ako invoice.paid už nepredĺži', b2.status === 200 && platnost() === poBasil, poBasil + ' → ' + platnost());
    ok('a tržba ostane zapísaná len raz', trzby().length === 1, String(trzby().length));

    const b3 = await posli(basil('evt_qa_basil_2', 'invoice.payment_succeeded', 'in_qa_basil_2', 'sub_qa_neskoro', 'qaWhNeskora0001'));
    await new Promise(r => setTimeout(r, 700));
    const nesk = rd('memberships.db').filter(m => m.user_id === 'qaWhNeskora0001').sort((a, b) => String(a.expires_at).localeCompare(String(b.expires_at))).pop();
    ok('obnova, keď členstvo medzitým vypršalo: platí do konca zaplateného obdobia v Stripe',
      b3.status === 200 && nesk && nesk.status === 'active' && Math.abs(Date.parse(nesk.expires_at) - koniecObdobia * 1000) < 120000,
      JSON.stringify(nesk && { s: nesk.status, e: nesk.expires_at, stripe: new Date(koniecObdobia * 1000).toISOString() }));

    const clenstvoDruhej = () => rd('memberships.db').filter(m => m.user_id === 'qaWhDruha000001').map(m => m.status + ' ' + m.expires_at).sort().join('|');
    const predDruhy = clenstvoDruhej();
    const b4 = await posli(basil('evt_qa_basil_3', 'invoice.payment_succeeded', 'in_qa_basil_3', 'sub_qa_druhy', 'qaWhDruha000001'));
    await new Promise(r => setTimeout(r, 700));
    ok('platba za druhý odber, ktorý appka nepozná, členstvo nezmení', b4.status === 200 && clenstvoDruhej() === predDruhy, predDruhy + ' → ' + clenstvoDruhej());
    const upoz = rd('notifications.db').filter(n => n.user_id === 'qaWhAdmin000001' && n.type === 'stripe_odber_neznamy');
    ok('adminovi príde upozornenie s menom klientky a sumou', upoz.length === 1 && /Dvojita Odberatelka/.test(upoz[0].title + upoz[0].body) && /49,90/.test(upoz[0].body), JSON.stringify(upoz));

    console.log('\nPayPal (nepoužívame):');
    for (const cesta of ['/api/paypal/webhook', '/api/paypal/create-order', '/api/paypal/capture-order']) {
      const r = await fetch(BASE + cesta, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED' }) });
      ok(cesta + ' je zavretý', r.status === 404, 'HTTP ' + r.status);
    }

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nWEBHOOK IDEMPOTENCIA: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
