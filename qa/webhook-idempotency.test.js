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
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(DATA, 'memberships.db'), [
    JSON.stringify({ _id: 'qaWhMem00000001', user_id: 'qaWhKlientka001', plan_id: 'bronze', plan_name: 'Bronze',
      status: 'active', started_at: '2026-08-01', expires_at: O_MESIAC, price: 50, payment_method: 'card' }),
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
