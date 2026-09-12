/**
 * Financie — poriadok (Marek 12. 9.: „prejdi financie, účtovníctvo, navrhni zjednodušenie").
 *  - jeden názov pre jeden spôsob platby (karta / hotovosť / prevod / kredit / zadarmo),
 *  - refundy: hrubá vs čistá tržba vo Financiách aj v účtovníctve,
 *  - náklady a výsledok obdobia (refundy + poplatky Stripe + výplaty + reklama),
 *  - Banka (Stripe) je voliteľná — bez Stripe (STRIPE_FAKE) Financie fungujú ďalej,
 *  - hotovosť u majiteľa = pokladňa, nie zrážka; výplata trénera nikdy pod nulu,
 *  - 20 faktúr naraz → 20 rôznych čísel.
 * Spustenie:  node qa/financie-poriadok.test.js
 */
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs'); const os = require('os');
const bcrypt = require('bcryptjs');
const PORT = 4533, BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-fin-'));
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const riadky = a => a.map(o => JSON.stringify(o)).join('\n') + '\n';
(async () => {
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const MES = DNES.slice(0, 7), T = DNES + 'T10:00:00.000Z';
  const pm = new Date(+MES.slice(0, 4), +MES.slice(5, 7) - 2, 1);
  const PRED_MES = pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0');
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const ADM = 'qaFinAdmin00001', TR = 'qaFinTrener0001', KL = 'qaFinKlient0001';
  const zak = { rank: 1, active: true, visit_count: 0, referral_credit: 0, lead_source: 'qa', city: 'Detva', created_at: '2026-01-01', phone: '' };
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: ADM, name: 'Marek QA Majitel', email: 'qa.fin.admin@qa-biz.local', password: hash, referral_code: 'QAFADM', is_admin: true, user_type: 'admin', ...zak },
    { _id: TR, name: 'Tina QA Trenerka', email: 'qa.fin.trener@qa-biz.local', password: hash, referral_code: 'QAFTRE', is_admin: false, user_type: 'trainer', ...zak },
    { _id: KL, name: 'Klára QA Klientka', email: 'qa.fin.klient@qa-biz.local', password: hash, referral_code: 'QAFKLI', is_admin: false, user_type: 'client', ...zak },
  ]));
  // predaje: vstup v hotovosti (transakcia) + členstvo kartou cez bránu (payment)
  fs.writeFileSync(path.join(DATA, 'transactions.db'), riadky([
    { _id: 'qaFinTx000001', type: 'single_entry', user_id: KL, user_name: 'Klára', amount: 10, payment_method: 'cash', note: 'Jednorazový vstup', created_at: T, month: MES },
  ]));
  fs.writeFileSync(path.join(DATA, 'payments.db'), riadky([
    { _id: 'qaFinPay00001', user_id: KL, amount: 50, status: 'completed', provider: 'stripe', description: 'Členstvo Bronze', plan_name: 'Bronze', captured_at: T, created_at: T },
  ]));
  fs.writeFileSync(path.join(DATA, 'refunds.db'), riadky([
    { _id: 'qaFinRef00001', payment_id: 'qaFinPay00001', user_id: KL, client_name: 'Klára', type: 'partial', amount: 20, reason: 'other', gateway: 'manual', created_at: T, month: MES },
  ]));
  fs.writeFileSync(path.join(DATA, 'adspend.db'), riadky([{ _id: 'qaFinAds00001', month: MES, amount: 100, source: 'meta', note: 'QA', created_at: T }]));
  // hotovosť u trénerov: majiteľ 300 € (pokladňa), trénerka 60 € bez odučených hodín (zárobok 0)
  fs.writeFileSync(path.join(DATA, 'payouts.db'), riadky([
    { _id: 'qaFinCash0001', _type: 'cash_collected', trainer_id: ADM, trainer_name: 'Marek QA Majitel', amount: 300, note: 'QA', booking_id: 'x', month: MES, date: DNES, status: 'held', created_at: T },
    { _id: 'qaFinCash0002', _type: 'cash_collected', trainer_id: TR, trainer_name: 'Tina QA Trenerka', amount: 60, note: 'QA', booking_id: 'y', month: MES, date: DNES, status: 'held', created_at: T },
  ]));
  fs.writeFileSync(path.join(DATA, 'monthly_winners.db'), riadky([{ _id: 'qaFinMW00001', month: PRED_MES, user_id: 'nikto', user_name: 'Nikto', points: 1, type: 'month', created_at: PRED_MES + '-28T10:00:00.000Z' }]));

  console.log('FINANCIE QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', STRIPE_FAKE: '1' } });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  await new Promise(r => setTimeout(r, 4000));
  try {
    const jar = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.fin.admin@qa-biz.local', password: 'Heslo123!' } }, jar);
    ok('prihlásenie admina', lg.status === 200, JSON.stringify(lg.d));
    const F = MES + '-01', TO = MES + '-31';

    // ── 1) spôsoby platby ──
    const pr = await j('/api/admin/predaje?from=' + F + '&to=' + TO, {}, jar);
    const met = {}; (pr.d && pr.d.rows || []).forEach(r => { met[r.method] = (met[r.method] || 0) + r.a; });
    ok('predaje: 2 riadky za 60 €', pr.d && pr.d.pocet === 2 && pr.d.suma === 60, JSON.stringify(pr.d && { p: pr.d.pocet, s: pr.d.suma }));
    ok('spôsoby platby sú „karta" a „hotovosť" (nie stripe/cash)', met['karta'] === 50 && met['hotovosť'] === 10 && Object.keys(met).length === 2, JSON.stringify(met));
    const raw = (pr.d && pr.d.rows || []).map(r => r.method_raw).sort();
    ok('pôvodná hodnota ostáva v method_raw', raw.join(',') === 'cash,stripe', raw.join(','));

    // ── 2) financie: refundy, čistá tržba, náklady, výsledok, banka ──
    const fin = await j('/api/admin/finance/stats?from=' + F + '&to=' + TO, {}, jar);
    const d = fin.d || {};
    ok('financie: hrubá tržba 60 €', d.revenue && d.revenue.period === 60, JSON.stringify(d.revenue));
    ok('financie: refundy 20 € (1×)', d.refunds && d.refunds.period === 20 && d.refunds.count === 1, JSON.stringify(d.refunds));
    ok('financie: čistá tržba 40 €', d.net && d.net.period === 40, JSON.stringify(d.net));
    ok('financie: náklady = refundy 20 + reklama 100 + výplaty 0 + poplatky 0', d.naklady && d.naklady.refundy === 20 && d.naklady.reklama === 100 && d.naklady.vyplaty === 0 && d.naklady.stripe_poplatky === 0 && d.naklady.spolu === 120, JSON.stringify(d.naklady));
    ok('financie: výsledok obdobia −60 €', d.vysledok && d.vysledok.trzba === 60 && d.vysledok.cisty === -60, JSON.stringify(d.vysledok));
    ok('financie: bez Stripe je banka null a nič nespadne', fin.status === 200 && d.banka === null && d.naklady.stripe_dostupne === false);
    const finAll = await j('/api/admin/finance/stats', {}, jar);
    ok('financie bez rozsahu (celkovo) fungujú a výsledok je číslo', finAll.status === 200 && finAll.d && typeof finAll.d.vysledok.cisty === 'number' && (finAll.d.naklady.mesiace || []).length >= 1 && finAll.d.naklady.mesiace.length <= 36, JSON.stringify(finAll.d && finAll.d.naklady && finAll.d.naklady.mesiace));
    const bk = await j('/api/admin/finance/banka?from=' + F + '&to=' + TO, {}, jar);
    ok('endpoint banka: bez Stripe vráti null', bk.status === 200 && bk.d && bk.d.ok && bk.d.banka === null);

    // ── 3) účtovníctvo ──
    const acc = await j('/api/admin/accounting/summary?from=' + F + '&to=' + TO, {}, jar);
    ok('účtovníctvo: hrubo 60, refundy 20, čisté 40', acc.d && acc.d.totals && acc.d.totals.revenue === 60 && acc.d.totals.refunds === 20 && acc.d.totals.net === 40, JSON.stringify(acc.d && acc.d.totals));
    const bm = Object.fromEntries((acc.d && acc.d.byMethod || []).map(x => [x.key, x.revenue]));
    ok('účtovníctvo podľa spôsobu: karta 50 · hotovosť 10', bm['karta'] === 50 && bm['hotovosť'] === 10, JSON.stringify(bm));
    const csv = await (await fetch(BASE + '/api/admin/accounting/export.csv?from=' + F + '&to=' + TO, { headers: { Cookie: jar.cookie } })).text();
    ok('CSV export má riadky REFUNDY a ČISTÉ', /REFUNDY/.test(csv) && /ČISTÉ/.test(csv) && /40,00/.test(csv), csv.split('\n').slice(-4).join(' | '));

    // ── 4) výplaty: pokladňa majiteľa, výplata nie pod nulu ──
    const po = await j('/api/admin/payouts?month=' + MES, {}, jar);
    const rows = (po.d && po.d.rows) || [];
    const m = rows.find(r => r.trainer === 'Marek QA Majitel'), t = rows.find(r => r.trainer === 'Tina QA Trenerka');
    ok('majiteľ: hotovosť 300 € je pokladňa, nie zrážka, výplata nie je záporná', m && m.majitel && m.cash_firma === 300 && m.cash_deduct === 0 && m.total >= 0, JSON.stringify(m && { f: m.cash_firma, d: m.cash_deduct, t: m.total }));
    ok('trénerka: zrážka 60 €, výplata 0 (nie −60), odovzdať 60 €', t && !t.majitel && t.cash_deduct === 60 && t.total === 0 && t.cash_odovzdat === 60, JSON.stringify(t && { d: t.cash_deduct, t: t.total, o: t.cash_odovzdat }));

    // ── 5) číslovanie faktúr pod tlakom ──
    const body = { client: { name: 'Odberateľ QA' }, items: [{ desc: 'Vstup', qty: 1, unit_price: 10 }], status: 'paid' };
    const vys = await Promise.all(Array.from({ length: 20 }, () => j('/api/admin/invoices', { method: 'POST', body }, jar)));
    const inv = await j('/api/admin/invoices', {}, jar);
    const vsetky = Array.isArray(inv.d) ? inv.d : (inv.d && (inv.d.invoices || inv.d.rows) || []);
    const qaInv = vsetky.filter(i => i.client_name === 'Odberateľ QA').map(i => i.number);
    ok('20 faktúr naraz → 20 vystavených', vys.every(v => v.status === 200) && qaInv.length === 20, vys.map(v => v.status).join(',') + ' / ' + qaInv.length);
    ok('20 faktúr naraz → 20 rôznych čísel', new Set(qaInv).size === 20, JSON.stringify(qaInv.sort()));
  } catch (e) { failed++; console.log('  ❌ výnimka: ' + e.stack); }
  finally {
    srv.kill(); console.log('\nFINANCIE: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 600);
  }
})();
