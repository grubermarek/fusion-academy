/**
 * Zlúčenie účtov s mesačným odberom (11. 9. 2026).
 *
 * Michaela N. zaplatila 30. 8. Bronze cez Stripe (mesačný odber) v starom účte,
 * o 40 minút si cez Google založila nový a prihlasuje sa doň — appka jej hlási,
 * že nemá členstvo. Oprava je zlúčiť starý účet do nového. Zlúčenie však
 * neprenášalo id odberu, podľa ktorého Stripe páruje obnovu: 29. 9. by Stripe
 * strhol 50 € a členstvo by sa nikomu nepredĺžilo.
 *
 * Stráži, že po zlúčení:
 *   · členstvo, platby, odber (id, plán, komu sa aktivuje) patria cieľovému účtu
 *   · klientka sa prihlási Googlom aj starým e-mailom s heslom a rezervuje si Zumbu
 *   · obnova zo Stripe predĺži členstvo cieľovému účtu
 *   · dva rôzne odbery sa nezlúčia (jeden by strhával peniaze bez účtu)
 *   · rodičov odber, ktorý aktivuje zlúčené dieťa, ukazuje na cieľ
 *
 * Spustenie:  node qa/zlucenie-odber.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4600;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-zlodber-'));
const TOKEN = 'qa-import-token-zlucenie';

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
async function j(url, opts, jar) {
  opts = opts || {};
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const spi = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const hash = bcrypt.hashSync('StareHeslo1!', 10);
  const za = n => new Date(Date.now() + n * 864e5).toISOString();
  const U = (_id, name, email, extra) => ({ _id, name, email, active: true, user_type: 'client', created_at: '2026-06-14', ...extra });
  w('users.db', [
    U('qaZoAdmin00001', 'Marek Gruber', 'qa.zo.admin@qa-biz.local', { is_admin: true, user_type: 'admin', password: hash }),
    // starý účet so zaplateným odberom Bronze
    U('qaZoStary00001', 'Michaela Stará', 'qa.zo.michaela@qa-biz.local', { password: hash, phone: '+421907000111', visit_count: 4, free_class_used: true,
      stripe_subscription_id: 'sub_QA_michaela', stripe_sub_plan: 'bronze', stripe_sub_member: 'qaZoStary00001',
      membership_plan: 'bronze', membership_expires: za(18), first_membership_at: za(-12) }),
    // nový účet cez Google, bez hesla — do tohto sa klientka prihlasuje
    U('qaZoNovy000001', 'Michela Nová', 'qa.zo.michela@qa-biz.local', { password: null, google_id: 'g-qa-michela', visit_count: 1, free_class_used: true, created_at: '2026-08-30' }),
    // dva účty, každý s vlastným odberom
    U('qaZoOdberA0001', 'Odber A', 'qa.zo.a@qa-biz.local', { password: hash, stripe_subscription_id: 'sub_QA_A', stripe_sub_plan: 'bronze', stripe_sub_member: 'qaZoOdberA0001' }),
    U('qaZoOdberB0001', 'Odber B', 'qa.zo.b@qa-biz.local', { password: hash, stripe_subscription_id: 'sub_QA_B', stripe_sub_plan: 'silver', stripe_sub_member: 'qaZoOdberB0001' }),
    // mama platí odber za dieťa; dieťa má duplicitný účet
    U('qaZoMama000001', 'Mama Odberová', 'qa.zo.mama@qa-biz.local', { password: hash, stripe_subscription_id: 'sub_QA_mama', stripe_sub_plan: 'bronze', stripe_sub_member: 'qaZoDieta00001' }),
    U('qaZoDieta00001', 'Dieťa Staré', 'qa.zo.dieta1@qa-biz.local', { password: hash, is_child: true, parent_id: 'qaZoMama000001' }),
    U('qaZoDieta00002', 'Dieťa Nové', 'qa.zo.dieta2@qa-biz.local', { password: hash, is_child: true, parent_id: 'qaZoMama000001' }),
  ]);
  w('memberships.db', [{ _id: 'qaZoClenstvo01', user_id: 'qaZoStary00001', plan_id: 'bronze', plan_name: 'Bronze', price: 50, status: 'active',
    started_at: za(-12), expires_at: za(18), created_at: za(-12) }]);
  w('payments.db', [{ _id: 'qaZoPlatba0001', user_id: 'qaZoStary00001', member_id: 'qaZoStary00001', amount: 50, description: 'Odber Bronze',
    ref_type: 'subscription', ref_id: 'bronze', provider: 'stripe', status: 'completed', stripe_subscription_id: 'sub_QA_michaela', created_at: za(-12) }]);
  const sk = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const pm = new Date(+sk.slice(0, 4), +sk.slice(5, 7) - 2, 1);
  w('monthly_winners.db', [{ _id: 'qaZoWinner0001', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'qaZoAdmin00001' }]);
  w('classes.db', [{ _id: 'qaZoZumba00001', name: 'Zumba', emoji: '💃', category: 'Zumba', location: 'Detva', instructor: 'Marek Gruber',
    day_of_week: new Date(Date.now() + 3 * 864e5).getDay(), time_start: '19:00', time_end: '20:00', capacity: 30, active: true, price: 10 }]);

  console.log('ZLÚČENIE ÚČTOV S ODBEROM\n');
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', IMPORT_TOKEN: TOKEN,
      STRIPE_WEBHOOK_SECRET: '', NODE_ENV: 'test' } });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await spi(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await spi(12000);

  const us = id => rd('users.db').find(x => x._id === id);
  const zluc = (src, tgt) => j('/api/service/merge-users', { method: 'POST', headers: { 'x-import-token': TOKEN }, body: { source_id: src, target_id: tgt } });
  try {
    console.log('1) Zlúčenie starého účtu do nového:');
    let r = await zluc('qaZoStary00001', 'qaZoNovy000001');
    ok('prejde', r.status === 200 && r.d && r.d.ok, JSON.stringify(r.d));
    await spi(600);
    const t = us('qaZoNovy000001') || {};
    ok('starý účet je zmazaný', !us('qaZoStary00001'));
    ok('odber prešiel na nový účet', t.stripe_subscription_id === 'sub_QA_michaela' && t.stripe_sub_plan === 'bronze', JSON.stringify({ s: t.stripe_subscription_id, p: t.stripe_sub_plan }));
    ok('obnova aktivuje nový účet, nie zmazaný', t.stripe_sub_member === 'qaZoNovy000001', t.stripe_sub_member);
    ok('členstvo aj platba patria novému účtu', rd('memberships.db').some(m => m._id === 'qaZoClenstvo01' && m.user_id === 'qaZoNovy000001')
      && rd('payments.db').some(p => p._id === 'qaZoPlatba0001' && p.user_id === 'qaZoNovy000001'));
    ok('Google prihlásenie ostalo, heslo zo starého účtu pribudlo', t.google_id === 'g-qa-michela' && !!t.password);
    ok('starý e-mail je záložný', (t.merged_emails || []).includes('qa.zo.michaela@qa-biz.local'));
    ok('návštevy sa sčítali (4 + 1) a telefón sa preniesol', t.visit_count === 5 && t.phone === '+421907000111', JSON.stringify({ v: t.visit_count, p: t.phone }));

    console.log('\n2) Klientka sa prihlási a rezervuje si Zumbu:');
    const kl = {};
    r = await j('/api/login', { method: 'POST', body: { email: 'qa.zo.michaela@qa-biz.local', password: 'StareHeslo1!' } }, kl);
    ok('prihlásenie starým e-mailom a heslom prejde', r.status === 200, JSON.stringify(r.d).slice(0, 120));
    const ja = (await j('/api/me', {}, kl)).d || {};
    ok('a je to nový (zlúčený) účet', (ja.id || ja._id) === 'qaZoNovy000001', JSON.stringify({ id: ja.id || ja._id }));
    r = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaZoZumba00001' } }, kl);
    await spi(400);
    const rz = rd('bookings.db').find(b => b.user_id === 'qaZoNovy000001' && b.class_id === 'qaZoZumba00001') || {};
    ok('Zumba sa zarezervuje členstvom', r.status === 200 && rz.access_method === 'membership', r.status + ' ' + JSON.stringify(r.d).slice(0, 140));

    console.log('\n3) Obnova odberu zo Stripe po zlúčení:');
    const pred = rd('memberships.db').filter(m => m.user_id === 'qaZoNovy000001' && m.status === 'active').map(m => m.expires_at).sort().pop();
    r = await j('/api/stripe/webhook', { method: 'POST', body: { id: 'evt_qa_obnova_1', type: 'invoice.paid',
      data: { object: { id: 'in_qa_1', billing_reason: 'subscription_cycle', subscription: 'sub_QA_michaela', amount_paid: 5000 } } } });
    ok('webhook prijatý', r.status === 200, r.status + ' ' + JSON.stringify(r.d));
    await spi(800);
    const po = rd('memberships.db').filter(m => m.user_id === 'qaZoNovy000001' && m.status === 'active').map(m => m.expires_at).sort().pop();
    ok('členstvo sa predĺžilo novému účtu', po && pred && new Date(po) - new Date(pred) > 25 * 864e5, pred + ' → ' + po);
    ok('obnova je zapísaná na nový účet', rd('transactions.db').some(x => x.type === 'subscription_renewal' && x.user_id === 'qaZoNovy000001'));

    console.log('\n4) Dva rôzne odbery sa nezlúčia:');
    r = await zluc('qaZoOdberA0001', 'qaZoOdberB0001');
    ok('zlúčenie odmietnuté (409)', r.status === 409 && /mesačný odber/.test(r.d && r.d.error || ''), JSON.stringify(r.d));
    ok('oba účty ostali s vlastným odberom', (us('qaZoOdberA0001') || {}).stripe_subscription_id === 'sub_QA_A' && (us('qaZoOdberB0001') || {}).stripe_subscription_id === 'sub_QA_B');

    console.log('\n5) Mamin odber za zlúčené dieťa:');
    r = await zluc('qaZoDieta00001', 'qaZoDieta00002');
    ok('zlúčenie detí prejde', r.status === 200, JSON.stringify(r.d));
    await spi(500);
    ok('mamin odber aktivuje nový účet dieťaťa', (us('qaZoMama000001') || {}).stripe_sub_member === 'qaZoDieta00002', (us('qaZoMama000001') || {}).stripe_sub_member);
    ok('a mama si odber nechala', (us('qaZoMama000001') || {}).stripe_subscription_id === 'sub_QA_mama');
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    setTimeout(() => {
      fs.rmSync(DATA, { recursive: true, force: true });
      console.log('\nZLÚČENIE S ODBEROM: ' + passed + ' OK / ' + failed + ' chýb');
      if (failed && chyba) console.log(chyba.slice(-900));
      process.exit(failed ? 1 : 0);
    }, 500);
  }
})();
