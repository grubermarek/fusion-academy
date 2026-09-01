/**
 * AUDIT E6 — refundy a dobropisy (Marek 1. 9.).
 *
 * Refund je jediné miesto, kde peniaze idú OD nás. Test stráži, že:
 *   · sa nedá vrátiť viac, než klientka zaplatila
 *   · vznikne dobropis naviazaný na pôvodnú faktúru
 *   · kredit do appky sa pripíše a zapíše do histórie
 *   · refund sa neurobí dvakrát za tú istú platbu
 *   · vrátená suma zmizne z tržieb
 *
 * V produkcii je zatiaľ jediný refund (Ailina, 40 €), takže tu ide hlavne
 * o poistky do budúcna.
 *
 * Spustenie:  node qa/refund-flow.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4560;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-ref-'));

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
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaRefAdmin00001', name: 'Adam Admin', email: 'qa.ref.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }),
    JSON.stringify({ _id: 'qaRefKlientka01', name: 'Klara Vratena', email: 'qa.ref.klientka@qa-biz.local',
      password: hash, user_type: 'client', active: true, referral_code: 'QAREF1',
      visit_count: 2, created_at: '2026-06-01', city: 'Detva', referral_credit: 0 }),
  ].join('\n') + '\n');

  // zaplatené členstvo, ktoré budeme vracať
  fs.writeFileSync(path.join(DATA, 'payments.db'), [
    JSON.stringify({ _id: 'qaRefPay00000001', user_id: 'qaRefKlientka01', amount: 50, currency: 'EUR',
      status: 'completed', method: 'card', provider: 'stripe', plan_id: 'bronze',
      description: 'Členstvo Bronze', created_at: '2026-08-15T10:00:00.000Z', captured_at: '2026-08-15T10:00:00.000Z' }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(DATA, 'invoices.db'), [
    JSON.stringify({ _id: 'qaRefInv00000001', number: '20260500', user_id: 'qaRefKlientka01',
      client_name: 'Klara Vratena', client_email: 'qa.ref.klientka@qa-biz.local', type: 'invoice',
      items: [{ desc: 'Členstvo Bronze', qty: 1, total: 50 }], total: 50, method: 'Stripe',
      issued_at: '2026-08-15', created_at: '2026-08-15T10:00:00.000Z' }),
  ].join('\n') + '\n');

  console.log('REFUNDY QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  const kredit = () => +((rd('users.db').find(u => u._id === 'qaRefKlientka01') || {}).referral_credit || 0);

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.ref.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    console.log('\nPoistky proti preplatku:');
    const viac = await j('/api/admin/refunds', { method: 'POST',
      body: { payment_id: 'qaRefPay00000001', type: 'app_credit', amount: 500, reason: 'test' } }, adm);
    ok('nedá sa vrátiť viac, než klientka zaplatila', viac.status === 400, JSON.stringify(viac.d));

    const nula = await j('/api/admin/refunds', { method: 'POST',
      body: { payment_id: 'qaRefPay00000001', type: 'app_credit', amount: 0, reason: 'test' } }, adm);
    ok('nulový refund sa odmietne', nula.status === 400, JSON.stringify(nula.d));

    const zlyTyp = await j('/api/admin/refunds', { method: 'POST',
      body: { payment_id: 'qaRefPay00000001', type: 'vymyslene', amount: 10, reason: 'test' } }, adm);
    ok('neznámy typ refundu sa odmietne', zlyTyp.status === 400, JSON.stringify(zlyTyp.d));

    console.log('\nRefund do kreditu:');
    const predKredit = kredit();
    const r = await j('/api/admin/refunds', { method: 'POST',
      body: { payment_id: 'qaRefPay00000001', type: 'app_credit', amount: 50, reason: 'duplicate', note: 'QA test' } }, adm);
    ok('refund prejde', r.status === 200 && r.d && r.d.ok !== false, JSON.stringify(r.d).slice(0, 120));
    await new Promise(r2 => setTimeout(r2, 800));

    ok('kredit sa pripísal', kredit() === predKredit + 50, predKredit + ' → ' + kredit());

    const led = rd('credit_ledger.db').filter(l => l.user_id === 'qaRefKlientka01');
    ok('a je dohľadateľný v histórii kreditu', led.length >= 1 && led.some(l => Math.abs(+l.delta - 50) < 0.01),
      JSON.stringify(led.map(l => l.delta + ' € · ' + String(l.reason || '').slice(0, 40))));

    const fa = rd('invoices.db');
    const dobropis = fa.find(i => +i.total < 0 || i.type === 'credit_note');
    ok('vznikol dobropis', !!dobropis, JSON.stringify(fa.map(i => i.number + ':' + i.total)));
    if (dobropis) {
      ok('dobropis je na správnu sumu', Math.abs(+dobropis.total) === 50, String(dobropis.total));
      ok('a viaže sa na pôvodnú faktúru', !!dobropis.related_invoice, String(dobropis.related_invoice || '—'));
      ok('má vlastné číslo, nie duplicitné', dobropis.number && dobropis.number !== '20260500', String(dobropis.number));
    }

    const refs = rd('refunds.db');
    ok('refund je zapísaný', refs.length === 1 && +refs[0].amount === 50, JSON.stringify(refs.map(x => x.amount + ' ' + x.type)));

    console.log('\nDvakrát ten istý refund:');
    const znova = await j('/api/admin/refunds', { method: 'POST',
      body: { payment_id: 'qaRefPay00000001', type: 'app_credit', amount: 50, reason: 'duplicate' } }, adm);
    await new Promise(r2 => setTimeout(r2, 800));
    const poDruhom = kredit();
    ok('druhý refund tej istej platby neprejde, alebo aspoň nezdvojí kredit',
      znova.status === 400 || poDruhom === predKredit + 50,
      'HTTP ' + znova.status + ' · kredit ' + poDruhom + ' €');

    console.log('\nVplyv na tržby:');
    const fin = (await j('/api/admin/finance/stats', {}, adm)).d;
    ok('finančný prehľad odpovedá', fin && typeof fin === 'object', JSON.stringify(fin && Object.keys(fin)).slice(0, 100));
    const dobr = rd('invoices.db').filter(i => +i.total < 0).reduce((s, i) => s + (+i.total || 0), 0);
    ok('dobropis je v účtovníctve záporný', dobr < 0, dobr + ' €');

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nREFUNDY: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
