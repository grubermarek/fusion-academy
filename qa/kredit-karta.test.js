/**
 * Fusion kredit pri platbe kartou (Marek 13. 11. 2026): Peťa zo Zvolena chcela kreditom zlacniť
 * permanentku, ale karta pýtala plnú sumu — /api/stripe/checkout kredit vôbec nepoznal.
 *
 * Overuje: karta zaplatí len rozdiel, kredit sa odpíše až po zaplatení (raz, aj pri opakovanom
 * webhooku), tržba / faktúra / provízia idú zo zaplatenej sumy, kredit pokrývajúci všetko kartu
 * odmietne, minimum 0,50 € pre Stripe, a bez zaškrtnutia kreditu sa nič nemení.
 *
 * Spustenie:  node qa/kredit-karta.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const PORT = 4571;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-kk-'));
const SECRET = 'whsec_qa_kredit_karta';

let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const user = id => rd('users.db').find(u => u._id === id) || {};

function webhook(session) {
  const raw = JSON.stringify({ id: 'evt_' + session.id + '_' + Math.random().toString(36).slice(2, 7), type: 'checkout.session.completed', data: { object: session } });
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', SECRET).update(t + '.' + raw).digest('hex');
  return fetch(BASE + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=' + t + ',v1=' + v1 }, body: raw });
}
async function login(email) {
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Heslo123!' }) });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
async function post(p, body, cookie) {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch (e) {} return { status: r.status, d: j };
}

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = (id, name, email, credit) => JSON.stringify({ _id: id, name, email, password: hash, user_type: 'client', active: true,
    referral_code: 'QAKK'+id.slice(4,8).toUpperCase(), referral_credit: credit, created_at: '2026-06-01', trial_used: true, trial_declined_at: '2026-06-01' });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    U('qaKkPeta0000001', 'Peta Zvolenska', 'qa.kk.peta@qa-biz.local', 20),
    U('qaKkVsetko00001', 'Vera Velkokreditna', 'qa.kk.vela@qa-biz.local', 200),
    U('qaKkMalo0000001', 'Mila Takmer', 'qa.kk.malo@qa-biz.local', 79.8),
    U('qaKkBez00000001', 'Bea Bezkreditu', 'qa.kk.bez@qa-biz.local', 15),
  ].join('\n') + '\n');

  console.log('KREDIT PRI PLATBE KARTOU — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1',
           STRIPE_FAKE: '1', STRIPE_SECRET_KEY: 'sk_test_qa_fake', STRIPE_WEBHOOK_SECRET: SECRET },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  try {
    const cena = 80; // 10-vstupová permanentka bez zlavy

    console.log('\nPeťa: permanentka 80 €, kredit 20 € → kartou 60 €');
    const cP = await login('qa.kk.peta@qa-biz.local');
    const r = await post('/api/stripe/checkout', { plan_id: 'permanentka10', use_referral_credit: true }, cP);
    ok('checkout prešiel', r.status === 200 && r.d.ok, JSON.stringify(r.d));
    ok('karta zaplatí 60 € a kredit 20 €', r.d.charge === 60 && r.d.credit_used === 20, JSON.stringify(r.d));
    const pay = rd('payments.db').find(p => p.user_id === 'qaKkPeta0000001' && p.status === 'pending');
    ok('platba čaká na 60 € (tržba z brány bude 60 €)', pay && pay.amount === 60 && pay.credit_used === 20, JSON.stringify(pay));
    ok('kredit sa pred zaplatením NEodpísal (zrušená platba ho nespáli)', user('qaKkPeta0000001').referral_credit === 20, String(user('qaKkPeta0000001').referral_credit));

    const sess = { id: pay.stripe_session_id, payment_status: 'paid', status: 'complete', amount_total: 6000, payment_intent: 'pi_qa_kk',
      metadata: { user_id: 'qaKkPeta0000001', member_id: 'qaKkPeta0000001', plan_id: 'permanentka10', type: 'membership', credit_used: '20.00', price_before_credit: '80.00' } };
    const w1 = await webhook(sess); const w2 = await webhook(sess);
    await new Promise(x => setTimeout(x, 1500));
    ok('webhook prijatý', w1.status === 200 && w2.status === 200);
    const p2 = user('qaKkPeta0000001');
    ok('po zaplatení kredit 0 € (odpísané raz, aj pri druhom webhooku)', Math.abs(+p2.referral_credit) < 0.001, String(p2.referral_credit));
    ok('pripísaných 10 vstupov', p2.single_entries === 10, String(p2.single_entries));
    const led = rd('credit_ledger.db').filter(l => l.user_id === 'qaKkPeta0000001');
    ok('história kreditu má riadok −20 €', led.length === 1 && led[0].delta === -20, JSON.stringify(led.map(l => [l.delta, l.reason])));
    const inv = rd('invoices.db').filter(i => i.user_id === 'qaKkPeta0000001');
    ok('faktúra na zaplatených 60 € s poznámkou o kredite', inv.length === 1 && +inv[0].total === 60 && /kredit/i.test(JSON.stringify(inv[0].items)), JSON.stringify(inv.map(i => [i.total, i.items])));
    const pz = rd('payments.db').find(p => p.stripe_session_id === pay.stripe_session_id);
    ok('platba dokončená na 60 €', pz.status === 'completed' && pz.amount === 60, JSON.stringify(pz));
    ok('notifikácia o použitom kredite', rd('notifications.db').some(n => n.user_id === 'qaKkPeta0000001' && /kredit/i.test(n.title || '')));

    console.log('\nKredit pokryje všetko → karta netreba');
    const cV = await login('qa.kk.vela@qa-biz.local');
    const rv = await post('/api/stripe/checkout', { plan_id: 'permanentka10', use_referral_credit: true }, cV);
    ok('checkout odmietnutý s pokynom aktivovať kreditom', rv.status === 400 && rv.d.credit_covers === true, JSON.stringify(rv.d));
    ok('kredit nedotknutý', user('qaKkVsetko00001').referral_credit === 200);

    console.log('\nZvyšok pod 0,50 € → Stripe minimum');
    const cM = await login('qa.kk.malo@qa-biz.local');
    const rm = await post('/api/stripe/checkout', { plan_id: 'permanentka10', use_referral_credit: true }, cM);
    ok('kartou 0,50 €, kredit 79,50 €', rm.status === 200 && rm.d.charge === 0.5 && rm.d.credit_used === 79.5, JSON.stringify(rm.d));

    console.log('\nBez zaškrtnutého kreditu');
    const cB = await login('qa.kk.bez@qa-biz.local');
    const rb = await post('/api/stripe/checkout', { plan_id: 'permanentka10' }, cB);
    ok('plná suma 80 €, kredit nepoužitý', rb.status === 200 && rb.d.charge === cena && rb.d.credit_used === 0, JSON.stringify(rb.d));
    ok('kredit ostáva 15 €', user('qaKkBez00000001').referral_credit === 15);

    console.log('\nStatické: obchod posiela kredit pri jednorazovej platbe kartou');
    const ob = fs.readFileSync(path.join(__dirname, '..', 'public', 'obchod.html'), 'utf8');
    ok('payStripe posiela use_referral_credit (len bez obnovy)', /use_referral_credit:\s*!renew\s*&&\s*!!useCr/.test(ob));
    ok('text „karta zaplatí plnú cenu" pri jednorazovej platbe zmizol', !/kredit sa uplatní pri voľbe „Zaplatiť v hotovosti"/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n-pages.js'), 'utf8')));
  } catch (e) { failed++; console.log('  ❌ výnimka: ' + e.message); }
  finally { srv.kill(); }
  console.log(`\nKREDIT PRI KARTE: ${passed} OK / ${failed} chýb`);
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  process.exit(failed ? 1 : 0);
})();
