/**
 * Platobný link od trénera (deal link) + admin sekcia Ambasádori.
 * E2E: tréner vytvorí link → verejná stránka → checkout (STRIPE_FAKE) →
 * webhook → aktivácia na profile klientky + konverzia pod trénera + provízia.
 * Spustenie:  node qa/deal-link.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4521;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-deal-'));

let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };

async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, redirect: 'manual',
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  const txt = await r.text();
  let d = null; try { d = JSON.parse(txt); } catch (e) {}
  return { status: r.status, d, txt, loc: r.headers.get('location') };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const W = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  W('users.db', [
    { _id: 'trenerkaDeal0001', name: 'Beata Trenerka', email: 'beata.qa@qa-biz.local', password: hash,
      user_type: 'trainer', active: true, rank: 1, referral_code: 'TD1', created_at: '2026-01-01' },
    { _id: 'klientkaDeal0001', name: 'Mia Dealova', email: 'mia.qa@qa-real.sk', phone: '0905 777 777',
      user_type: 'lead', lead_source: 'web', active: true, rank: 1, referral_code: 'MD1', created_at: '2026-08-01' },
    // klientka s CUDZÍM reálnym sponzorom — konverzia sa nesmie udiať
    { _id: 'sponzorkaReal001', name: 'Sona Sponzorka', email: 'sona.qa@qa-real.sk', password: hash,
      user_type: 'ambassador', active: true, rank: 1, referral_code: 'SS1', created_at: '2026-01-01' },
    { _id: 'klientkaCudzia01', name: 'Cilka Cudzia', email: 'cilka.qa@qa-real.sk', phone: '0905 888 888',
      user_type: 'client', sponsor_id: 'sponzorkaReal001', active: true, rank: 1, referral_code: 'CC1', created_at: '2026-07-01' },
  ]);

  console.log('DEAL LINK QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
           RATE_LIMIT_OFF: '1', MAIL_OFF: '1', STRIPE_FAKE: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    const trn = {}, adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'beata.qa@qa-biz.local', password: 'Heslo123!' } }, trn);
    await j('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } }, adm);

    // ── 1. Zoznam produktov pre trénera ──
    const pl = (await j('/api/trainer/deal-plans', {}, trn)).d;
    ok('produkty sa načítajú', pl && pl.ok && pl.plans.length === 8, JSON.stringify(pl && pl.plans && pl.plans.length));
    ok('sú tam členstvá aj permanentky s cenami', pl.plans.some(p => p.id === 'silver' && p.price === 75)
      && pl.plans.some(p => p.id === 'permanentka10' && p.price === 80 && p.entries === 10), JSON.stringify(pl.plans));

    // ── 2. Vytvorenie linku ──
    const dl = (await j('/api/trainer/deal-link', { method: 'POST', body: { user_id: 'klientkaDeal0001', plan_id: 'silver' } }, trn)).d;
    ok('link sa vytvorí', dl && dl.ok && /\/kupa\//.test(dl.url), JSON.stringify(dl));
    ok('hotová správa na poslanie obsahuje meno, produkt aj link', /Mia/.test(dl.message) && /Silver/.test(dl.message) && dl.message.includes(dl.url));
    const token = dl.url.split('/kupa/')[1];
    const zaznam = rd('deal_links.db').find(x => x._id === token);
    ok('záznam má klientku, produkt, cenu, trénera aj expiráciu', zaznam && zaznam.user_id === 'klientkaDeal0001'
      && zaznam.plan_id === 'silver' && zaznam.price === 75 && zaznam.trainer_id === 'trenerkaDeal0001' && !!zaznam.expires_at, JSON.stringify(zaznam));
    ok('vytvorenie linku je v poznámkach (timeline)', rd('lead_notes.db')
      .some(n => n.client_id === 'klientkaDeal0001' && /platobný link/i.test(n.text) && /Silver/.test(n.text)));
    ok('nezmyselný produkt sa odmietne', (await j('/api/trainer/deal-link', { method: 'POST', body: { user_id: 'klientkaDeal0001', plan_id: 'zlato' } }, trn)).status === 400);
    ok('len pre trénera/admina', (await j('/api/trainer/deal-link', { method: 'POST', body: { user_id: 'klientkaDeal0001', plan_id: 'silver' } })).status === 401);

    // ── 3. Verejná stránka (bez prihlásenia) ──
    const pg = await j('/kupa/' + token);
    ok('stránka sa otvorí bez prihlásenia', pg.status === 200 && /Ahoj Mia/.test(pg.txt) && /Silver/.test(pg.txt) && /75,00/.test(pg.txt), pg.status + '');
    ok('neplatný token = slušná 404', (await j('/kupa/neexistujuci123')).status === 404);

    // ── 4. Checkout (STRIPE_FAKE) → pending platba ──
    const ck = await j('/api/kupa/' + token + '/checkout', { method: 'POST' });
    ok('checkout presmeruje', [302, 303].includes(ck.status), ck.status + '');
    const pending = rd('payments.db').find(p => p.deal_token === token);
    ok('pending platba so session id vznikla', pending && pending.status === 'pending' && pending.stripe_session_id === 'fake_deal_' + token, JSON.stringify(pending));

    // ── 5. Webhook → aktivácia + konverzia + odmeny ──
    const wh = await j('/api/stripe/webhook', { method: 'POST', body: { type: 'checkout.session.completed',
      data: { object: { id: 'fake_deal_' + token, payment_status: 'paid',
        metadata: { type: 'membership', user_id: 'klientkaDeal0001', member_id: 'klientkaDeal0001',
          plan_id: 'silver', deal_token: token } } } } });
    ok('webhook prejde', wh.status === 200, wh.status + '');
    await new Promise(r => setTimeout(r, 800));

    const mia = rd('users.db').find(u => u._id === 'klientkaDeal0001');
    ok('Silver je aktivované na JEJ profile', rd('memberships.db')
      .some(m => m.user_id === 'klientkaDeal0001' && m.status === 'active' && /silver/i.test(m.plan_id || m.plan_name || '')), '');
    ok('KONVERZIA: trénerka sa stala sponzorkou', mia.sponsor_id === 'trenerkaDeal0001', JSON.stringify(mia.sponsor_id));
    ok('konverzný case so zdôvodnením', rd('coach_cases.db')
      .some(c => c.lead_id === 'klientkaDeal0001' && c.converted && /platobný link/i.test(c.conversion_note || '')));
    ok('kontakt „zaplatila cez link" v zdieľanej vrstve', rd('coach_contacts.db')
      .some(c => c.lead_id === 'klientkaDeal0001' && c.outcome === 'booked' && /platobný link/i.test(c.note || '')));
    ok('AMBASÁDOR: provízia trénerke z nákupu', rd('transactions.db')
      .some(t => t.partner_id === 'trenerkaDeal0001' && t.commission_only && +t.amount === 75), '');
    ok('nákup je v tržbách (membership transakcia)', rd('transactions.db')
      .some(t => t.user_id === 'klientkaDeal0001' && t.type === 'membership' && +t.amount === 75));
    ok('trénerke prišla notifikácia 💳', rd('notifications.db')
      .some(n => n.user_id === 'trenerkaDeal0001' && n.type === 'deal_paid'));
    ok('link je jednorazový — označený ako zaplatený', (rd('deal_links.db').find(x => x._id === token) || {}).status === 'paid');

    // druhý webhook = idempotentné (žiadna druhá aktivácia)
    await j('/api/stripe/webhook', { method: 'POST', body: { type: 'checkout.session.completed',
      data: { object: { id: 'fake_deal_' + token, payment_status: 'paid',
        metadata: { type: 'membership', user_id: 'klientkaDeal0001', member_id: 'klientkaDeal0001', plan_id: 'silver', deal_token: token } } } } });
    await new Promise(r => setTimeout(r, 400));
    ok('opakovaný webhook nič nezdvojí', rd('memberships.db')
      .filter(m => m.user_id === 'klientkaDeal0001' && m.status === 'active').length === 1);
    const pg2 = await j('/kupa/' + token);
    ok('zaplatený link ukazuje „Ďakujeme"', /Zaplatené — ďakujeme/.test(pg2.txt));
    ok('checkout na zaplatenom linku presmeruje späť (nedá sa platiť 2×)', [302, 303].includes((await j('/api/kupa/' + token + '/checkout', { method: 'POST' })).status));

    // ── 6. Cudzí sponzor sa NEkradne ──
    const dl2 = (await j('/api/trainer/deal-link', { method: 'POST', body: { user_id: 'klientkaCudzia01', plan_id: 'vstup1' } }, trn)).d;
    const tok2 = dl2.url.split('/kupa/')[1];
    await j('/api/kupa/' + tok2 + '/checkout', { method: 'POST' });
    await j('/api/stripe/webhook', { method: 'POST', body: { type: 'checkout.session.completed',
      data: { object: { id: 'fake_deal_' + tok2, payment_status: 'paid',
        metadata: { type: 'membership', user_id: 'klientkaCudzia01', member_id: 'klientkaCudzia01', plan_id: 'vstup1', deal_token: tok2 } } } } });
    await new Promise(r => setTimeout(r, 600));
    const cilka = rd('users.db').find(u => u._id === 'klientkaCudzia01');
    ok('vstup sa aktivoval (single_entries +1)', cilka.single_entries === 1, JSON.stringify(cilka.single_entries));
    ok('cudzí sponzor OSTAL (žiadne kradnutie)', cilka.sponsor_id === 'sponzorkaReal001', JSON.stringify(cilka.sponsor_id));

    // ── 7. Admin sekcia Ambasádori ──
    const amb = (await j('/api/admin/ambassadors', {}, adm)).d;
    ok('zoznam tímu sa načíta', amb && amb.ok && amb.members.length >= 2, JSON.stringify(amb && amb.members && amb.members.map(m => m.name)));
    const beataRow = amb.members.find(m => m.id === 'trenerkaDeal0001');
    ok('trénerka je v zozname ako trénerka', beataRow && beataRow.rola === 'trénerka');
    ok('VÝKONY: konverzia aj línia sa premietli', beataRow.konverzie === 1 && beataRow.linia === 1, JSON.stringify(beataRow));
    ok('VÝKONY: objem línie ráta Miin nákup', beataRow.objem_30d === 75, JSON.stringify(beataRow.objem_30d));
    ok('ambasádorka Soňa je v zozname', amb.members.some(m => m.id === 'sponzorkaReal001' && m.rola === 'ambasádorka'));
    // grant podľa mena
    const gr = (await j('/api/admin/ambassadors/grant', { method: 'POST', body: { query: 'mia.qa@qa-real.sk' } }, adm)).d;
    ok('udelenie podľa e-mailu funguje', gr && gr.ok && gr.granted === 'Mia Dealova', JSON.stringify(gr));
    ok('Mia má ambasádorský user_type', (rd('users.db').find(u => u._id === 'klientkaDeal0001') || {}).user_type === 'ambassador');
    ok('trénerke grant vráti vysvetlenie (má automaticky)', /automaticky/.test(((await j('/api/admin/ambassadors/grant', { method: 'POST', body: { query: 'beata.qa@qa-biz.local' } }, adm)).d || {}).note || ''));
    ok('sekcia len pre admina', (await j('/api/admin/ambassadors', {}, trn)).status === 403);

    // ── 8. Zjednotený prístup: ambasádorka sa dostane do /api/ambassador/me ──
    const mia2 = {};
    await j('/api/login', { method: 'POST', body: { email: 'mia.qa@qa-real.sk', password: 'Heslo123!' } }, mia2); // nemá heslo → zlyhá, preskoč
    const son = {};
    await j('/api/login', { method: 'POST', body: { email: 'sona.qa@qa-real.sk', password: 'Heslo123!' } }, son);
    ok('ambasádorka má prístup do /api/ambassador/me', ((await j('/api/ambassador/me', {}, son)).status) === 200);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message + '\n' + e.stack);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nDEAL LINK: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
