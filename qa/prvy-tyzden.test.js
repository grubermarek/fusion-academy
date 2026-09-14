/**
 * Prvý týždeň zadarmo (Marek 14. 9. 2026): namiesto „prvá hodina zadarmo" skúšobný týždeň Bronze
 * s kartou (Stripe odber, 7 dní zadarmo, potom 49,90 €/mes., zrušiť kedykoľvek). Kto nechce,
 * kúpi si vstup alebo členstvo sám.
 *
 * Overuje (PRVY_TYZDEN=1, STRIPE_FAKE=1):
 *  - /api/me nesie stav skúšky (nárok / beží / využitá), /api/config prepínač
 *  - samoobslužná rezervácia bez krytia → 402 membership_required + trial_available, žiadna prvá hodina zadarmo
 *  - kiosk check-in bez krytia → otázka na hotovosť (prvá zdarma sa nedáva), krytie prva_zdarma=false
 *  - pozvánka pre hostí a landing bez účtu → 410 s odkazom na registráciu; /prva-hodina presmeruje
 *  - /api/stripe/trial: nárok (nie admin/tréner/dieťa, nie po členstve, nie dvakrát), záznam platby 0 €
 *  - webhook checkout.session.completed (no_payment_required, trial) → Bronze na 7 dní, trial_used,
 *    odber na zázname, oznam + mail, nič v tržbách; opakovaný webhook nezdvojí
 *  - so skúškou sa dá rezervovať (kryté členstvom) a kiosk pustí
 *  - pripomienka 2–3 dni pred koncom (denný tick aj Stripe trial_will_end) — raz
 *  - prvá platba po skúške (invoice.paid subscription_cycle) predĺži o 30 dní, označí konverziu, zapíše tržbu
 *  - zrušenie odberu počas skúšky: členstvo do konca skúšky ostáva, nič sa nestrhne
 *  - režim vypnutý (bez env) → stará prvá hodina zadarmo funguje ďalej
 * Spustenie:  node qa/prvy-tyzden.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
function mkJ(BASE) {
  return async function j(url, opts = {}, jar) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
    const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined, redirect: 'manual' });
    if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
    let d = null; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d, loc: r.headers.get('location') };
  };
}
const mkRd = DATA => f => { const p = path.join(DATA, f); if (!fs.existsSync(p)) return []; const m = new Map();
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l.trim()) continue; let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o.$$indexCreated) continue; if (o.$$deleted) { m.delete(o._id); continue; } m.set(o._id, o); } return [...m.values()]; };

function fixtures(DATA, DOW, nowMin) {
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zak = { rank: 1, is_admin: false, active: true, visit_count: 0, referral_credit: 0, city: 'Detva', created_at: '2026-09-01', onboarding_done: true, free_credits: 0, single_entries: 0 };
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaPtAdmin000001', name: 'Admin Skuska', email: 'qa.pt.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01', referral_code: 'QAPTAD' },
    { _id: 'qaPtTrener00001', name: 'Tina Trenerka', email: 'qa.pt.trener@qa-biz.local', password: hash, user_type: 'trainer', active: true, created_at: '2026-01-01', referral_code: 'QAPTTR' },
    { _id: 'qaPtNova0000001', name: 'Nora Nová', email: 'qa.pt.nora@qa-biz.local', password: hash, referral_code: 'QAPTNO', user_type: 'lead', free_class_used: false, ...zak },
    { _id: 'qaPtBola0000001', name: 'Bea Bývalá', email: 'qa.pt.bea@qa-biz.local', password: hash, referral_code: 'QAPTBE', user_type: 'client', free_class_used: true, ...zak, visit_count: 6 },
    { _id: 'qaPtStara000001', name: 'Sára Stará', email: 'qa.pt.sara@qa-biz.local', password: hash, referral_code: 'QAPTSA', user_type: 'client', free_class_used: true, ...zak, visit_count: 3 },
    { _id: 'qaPtSponzor0001', name: 'Sandra Sponzorka', email: 'qa.pt.sandra@qa-biz.local', password: hash, referral_code: 'QAPTSP', user_type: 'client', free_class_used: true, ...zak, visit_count: 9 },
  ]));
  fs.writeFileSync(path.join(DATA, 'memberships.db'), riadky([
    { _id: 'qaPtMemBea', user_id: 'qaPtBola0000001', plan_id: 'bronze', plan_name: 'Bronze', status: 'expired', started_at: '2026-06-01T00:00:00.000Z', expires_at: '2026-07-01T00:00:00.000Z', price: 50, payment_method: 'cash', created_at: '2026-06-01T00:00:00.000Z' },
  ]));
  const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const t1 = Math.max(0, nowMin - 10);
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    { _id: 'qaPtZumbaBud', name: 'Zumba', emoji: '💃', category: 'Zumba', instructor: 'Tina Trenerka', instructor_id: 'qaPtTrener00001', location: 'Detva', day_of_week: (DOW + 2) % 7, time_start: '19:00', time_end: '20:00', capacity: 30, price: 10, active: true, created_at: '2026-01-01' },
    { _id: 'qaPtZumbaNow', name: 'Zumba večer', emoji: '💃', category: 'Zumba', instructor: 'Tina Trenerka', instructor_id: 'qaPtTrener00001', location: 'Detva', day_of_week: DOW, time_start: hhmm(t1), time_end: hhmm(t1 + 55), capacity: 30, price: 10, active: true, created_at: '2026-01-01' },
  ]));
  const pm = new Date(+DNES.slice(0, 4), +DNES.slice(5, 7) - 2, 1);
  fs.writeFileSync(path.join(DATA, 'monthly_winners.db'), riadky([{ _id: 'qaPtMW01', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'x', created_at: '2026-01-01' }]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['retro_confirm_v1', 'noshow_revert_v1', 'zumba_kids_hodiny_20260909', 'zumba_kids_casy_20260909b', 'zumba_kids_prehodenie_20260909c', 'zumba_kids_casy_20260913', 'alena_tx_karta_v1', 'deti_storno_noshow_20260913']
    .map((k, i) => ({ _id: 'qaPtSet' + i, key: k, value: true, at: '2026-01-01T00:00:00.000Z' })).concat([{ _id: 'qaPtSetNS', key: 'no_show_from', value: '2026-01-01', at: '2026-01-01T00:00:00.000Z' }])));
  return DNES;
}
async function start(PORT, DATA, env) {
  const BASE = 'http://localhost:' + PORT;
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_FAKE: '1', STRIPE_SECRET_KEY: 'sk_test_qa_fake', ...env }, stdio: 'ignore' });
  const t0 = Date.now(); while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await sleep(1000); } }
  await sleep(4000);
  return { proc, BASE };
}

(async () => {
  const DOW = new Date().getDay(); const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  // ═══ A) režim ZAPNUTÝ ═══
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-pt-'));
  const DNES = fixtures(DATA, DOW, nowMin);
  console.log('PRVÝ TÝŽDEŇ — štart servera (zapnuté)…');
  let { proc, BASE } = await start(4538, DATA, { PRVY_TYZDEN: '1' });
  let j = mkJ(BASE), rd = mkRd(DATA);
  try {
    const cfg = await j('/api/config');
    ok('config: prepínač zapnutý, 7 dní, 49,90 €', cfg.d.prvy_tyzden === true && cfg.d.trial_days === 7 && cfg.d.trial_price === 50, JSON.stringify({ p: cfg.d.prvy_tyzden, d: cfg.d.trial_days, c: cfg.d.trial_price }));
    const nora = {}, bea = {}, sara = {}, adm = {}, tren = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.pt.nora@qa-biz.local', password: 'Heslo123!' } }, nora);
    await j('/api/login', { method: 'POST', body: { email: 'qa.pt.bea@qa-biz.local', password: 'Heslo123!' } }, bea);
    await j('/api/login', { method: 'POST', body: { email: 'qa.pt.sara@qa-biz.local', password: 'Heslo123!' } }, sara);
    await j('/api/login', { method: 'POST', body: { email: 'qa.pt.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    await j('/api/login', { method: 'POST', body: { email: 'qa.pt.trener@qa-biz.local', password: 'Heslo123!' } }, tren);
    const meN = await j('/api/me', {}, nora);
    ok('/api/me: nová klientka má nárok na skúšku', meN.d.trial && meN.d.trial.on === true && meN.d.trial.eligible === true && meN.d.trial.active === false && meN.d.trial.days === 7, JSON.stringify(meN.d.trial));
    ok('/api/me: kto už mal členstvo, nárok nemá', (await j('/api/me', {}, bea)).d.trial.eligible === false && (await j('/api/me', {}, bea)).d.trial.reason === 'mala_clenstvo');
    ok('/api/me: admin nárok nemá', (await j('/api/me', {}, adm)).d.trial.eligible === false);
    // prvá hodina zadarmo sa už nedáva
    const bk1 = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaPtZumbaBud' } }, nora);
    ok('rezervácia bez krytia → 402 + trial_available (žiadna prvá hodina zadarmo)', bk1.status === 402 && bk1.d.error === 'membership_required' && bk1.d.trial_available === true && bk1.d.can_pay_on_site === true && /prvý týždeň/.test(bk1.d.message || ''), JSON.stringify(bk1.d));
    ok('nič sa nezapísalo, prvá zdarma sa nespotrebovala', !rd('bookings.db').some(b => b.user_id === 'qaPtNova0000001') && rd('users.db').find(u => u._id === 'qaPtNova0000001').free_class_used === false);
    const bkS = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaPtZumbaBud' } }, bea);
    ok('kto nárok nemá (členstvo už mala): 402 bez trial_available', bkS.status === 402 && bkS.d.trial_available === false && !/prvý týždeň/.test(bkS.d.message || ''), JSON.stringify(bkS.d));
    const bkSa = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaPtZumbaBud' } }, sara);
    ok('kto mal len prvú hodinu zadarmo, skúšku ešte dostane (402 + trial_available)', bkSa.status === 402 && bkSa.d.trial_available === true, JSON.stringify(bkSa.d));
    ok('hero „vyber si prvú hodinu" sa nezobrazí', (await j('/api/first-class/suggestions', {}, nora)).d.eligible === false);
    // pozvánka + landing bez účtu
    const inv = await j('/api/invite/QAPTSP/book', { method: 'POST', body: { name: 'Hana Hosť', contact: 'hana.host@qa-biz.local', class_id: 'qaPtZumbaBud' } });
    ok('pozvánka pre hostí → 410 + registrácia s kódom', inv.status === 410 && inv.d.trial === true && /ref=QAPTSP/.test(inv.d.register_url || '') && /QAPTSP/.test(inv.d.error), JSON.stringify(inv.d));
    ok('hosť sa nevytvoril', !rd('users.db').some(u => u.email === 'hana.host@qa-biz.local'));
    const land = await j('/api/first-class/book', { method: 'POST', body: { name: 'Lea Landing', email: 'lea.landing@qa-biz.local', class_id: 'qaPtZumbaBud' } });
    ok('landing bez účtu → 410 + registrácia', land.status === 410 && land.d.trial === true, JSON.stringify(land.d));
    const ph = await fetch(BASE + '/prva-hodina', { redirect: 'manual' });
    ok('/prva-hodina presmeruje na registráciu', ph.status === 302 && /^\/\?src=prva-hodina/.test(ph.headers.get('location') || ''), ph.status + ' ' + ph.headers.get('location'));
    // kiosk
    const kcfg = await j('/api/admin/kiosk', {}, adm); const detva = (kcfg.d.studios || []).find(x => /detva/i.test(x.slug + ' ' + x.city));
    await j('/api/admin/kiosk/' + detva.slug, { method: 'PUT', body: { enabled: true } }, adm);
    const K = detva.token, ST = detva.slug;
    const kc = await j('/api/kiosk/checkin', { method: 'POST', body: { studio: ST, k: K, qr_data: 'FA:qaPtNova0000001', class_id: 'qaPtZumbaNow' } });
    ok('kiosk bez krytia: otázka na hotovosť 10 € (prvá zdarma sa nedáva)', kc.status === 402 && kc.d.ask_cash === true && kc.d.price === 10, JSON.stringify(kc.d));
    const kd = await j('/api/kiosk/day-classes', { method: 'POST', body: { studio: ST, k: K, qr_data: 'FA:qaPtNova0000001' } });
    ok('kiosk krytie: prva_zdarma=false', kd.d.krytie && kd.d.krytie.prva_zdarma === false, JSON.stringify(kd.d.krytie));
    // nárok na skúšku
    ok('skúška pre admina → 400', (await j('/api/stripe/trial', { method: 'POST' }, adm)).status === 400);
    ok('skúška pre trénerku → 400', (await j('/api/stripe/trial', { method: 'POST' }, tren)).status === 400);
    const tb = await j('/api/stripe/trial', { method: 'POST' }, bea);
    ok('skúška po bývalom členstve → 400 s dôvodom', tb.status === 400 && tb.d.reason === 'mala_clenstvo', JSON.stringify(tb.d));
    const tr = await j('/api/stripe/trial', { method: 'POST' }, nora);
    ok('nová klientka dostane Stripe odkaz', tr.status === 200 && tr.d.ok && /stripe=trial/.test(tr.d.url || ''), JSON.stringify(tr.d));
    const pay = rd('payments.db').find(p => p.user_id === 'qaPtNova0000001');
    ok('záznam platby 0 € typ trial, mimo účtovníctva', pay && pay.ref_type === 'trial' && pay.amount === 0 && pay.status === 'pending' && pay.accounting_skip === true, JSON.stringify(pay && { t: pay.ref_type, a: pay.amount, s: pay.status }));
    // webhook: Checkout so skúškou hotový (nič sa nestrhlo)
    const sess = { id: 'fake_trial_qaPtNova0000001', object: 'checkout.session', mode: 'subscription', status: 'complete', payment_status: 'no_payment_required', subscription: 'sub_fake_trial_1',
      metadata: { user_id: 'qaPtNova0000001', member_id: 'qaPtNova0000001', plan_id: 'bronze', type: 'subscription', trial: '1' } };
    const wh = await j('/api/stripe/webhook', { method: 'POST', body: { id: 'evt_trial_1', type: 'checkout.session.completed', data: { object: sess } } });
    await sleep(600);
    ok('webhook prijatý', wh.status === 200, JSON.stringify(wh.d));
    const uN = rd('users.db').find(u => u._id === 'qaPtNova0000001');
    const memN = rd('memberships.db').find(m => m.user_id === 'qaPtNova0000001');
    const exp7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    ok('Bronze aktívne na 7 dní, označené ako skúška, cena 0', memN && memN.status === 'active' && memN.plan_id === 'bronze' && memN.trial === true && memN.price === 0 && memN.expires_at.slice(0, 10) === exp7, JSON.stringify(memN && { e: memN.expires_at, t: memN.trial, p: memN.price }));
    ok('klientka: trial_used, odber na zázname, konci o 7 dní, prvá zdarma spotrebovaná', uN.trial_used === true && uN.stripe_subscription_id === 'sub_fake_trial_1' && uN.stripe_sub_plan === 'bronze' && String(uN.trial_ends_at).slice(0, 10) === exp7 && uN.free_class_used === true && uN.user_type === 'client', JSON.stringify({ tu: uN.trial_used, s: uN.stripe_subscription_id, e: uN.trial_ends_at, ut: uN.user_type }));
    ok('nič v tržbách (žiadna transakcia ani faktúra)', !rd('transactions.db').some(t => t.user_id === 'qaPtNova0000001') && !rd('invoices.db').some(i => i.user_id === 'qaPtNova0000001'));
    ok('oznam + mail o skúške', rd('notifications.db').some(n => n.user_id === 'qaPtNova0000001' && /Prvý týždeň zadarmo beží/.test(n.title)) && rd('mail_log.db').some(m => /prvý týždeň zadarmo beží/i.test(m.subject || '')), JSON.stringify(rd('mail_log.db').map(m => m.subject)));
    const meN2 = await j('/api/me', {}, nora);
    ok('/api/me: skúška beží, nárok už nie', meN2.d.trial.active === true && meN2.d.trial.eligible === false && meN2.d.membership && meN2.d.membership.plan_id === 'bronze' && meN2.d.stripe_subscription === true, JSON.stringify(meN2.d.trial));
    const wh2 = await j('/api/stripe/webhook', { method: 'POST', body: { id: 'evt_trial_1b', type: 'checkout.session.completed', data: { object: sess } } });
    await sleep(300);
    ok('opakovaný webhook (iné event id) nezdvojí členstvo', wh2.status === 200 && rd('memberships.db').filter(m => m.user_id === 'qaPtNova0000001').length === 1);
    ok('druhá skúška → 400', (await j('/api/stripe/trial', { method: 'POST' }, nora)).status === 400);
    // so skúškou sa dá rezervovať a kiosk pustí
    const bk2 = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaPtZumbaBud' } }, nora);
    ok('so skúškou rezervácia prejde (kryté členstvom)', bk2.status === 200 && (bk2.d.ok || bk2.d.id), JSON.stringify(bk2.d).slice(0, 120));
    const bkRec = rd('bookings.db').find(b => b.user_id === 'qaPtNova0000001' && b.class_id === 'qaPtZumbaBud');
    ok('rezervácia krytá členstvom, nie prvou zdarma', bkRec && bkRec.access_method === 'membership' && !bkRec.free_class, JSON.stringify(bkRec && { am: bkRec.access_method, f: bkRec.free_class }));
    const kc2 = await j('/api/kiosk/checkin', { method: 'POST', body: { studio: ST, k: K, qr_data: 'FA:qaPtNova0000001', class_id: 'qaPtZumbaNow' } });
    ok('kiosk so skúškou pustí (členstvo)', kc2.status === 200 && kc2.d.ok, JSON.stringify(kc2.d).slice(0, 100));
    // pripomienka 2–3 dni pred koncom: posuň koniec skúšky
    await j('/api/admin/qa/set-user', { method: 'POST', body: { user_id: 'qaPtNova0000001', set: { trial_ends_at: new Date(Date.now() + 2 * 864e5).toISOString() } } }, adm);
    const tick = await j('/api/admin/qa/run-trial-reminders', { method: 'POST' }, adm);
    await sleep(800);
    const uN3 = rd('users.db').find(u => u._id === 'qaPtNova0000001');
    ok('denný tick poslal pripomienku pred koncom skúšky (raz)', !!uN3.trial_reminder_sent && rd('notifications.db').filter(n => n.user_id === 'qaPtNova0000001' && /Skúšobný týždeň končí/.test(n.title)).length === 1 && rd('mail_log.db').some(m => /skúšobný týždeň končí/i.test(m.subject || '')), JSON.stringify({ tick: tick.status, r: uN3.trial_reminder_sent }));
    await j('/api/stripe/webhook', { method: 'POST', body: { id: 'evt_twe_1', type: 'customer.subscription.trial_will_end', data: { object: { id: 'sub_fake_trial_1', trial_end: Math.floor((Date.now() + 2 * 864e5) / 1000) } } } });
    await sleep(300);
    ok('Stripe trial_will_end nezdvojí pripomienku', rd('notifications.db').filter(n => n.user_id === 'qaPtNova0000001' && /Skúšobný týždeň končí/.test(n.title)).length === 1);
    // prvá platba po skúške
    const expPred = rd('memberships.db').find(m => m.user_id === 'qaPtNova0000001').expires_at;
    const inv1 = await j('/api/stripe/webhook', { method: 'POST', body: { id: 'evt_inv_1', type: 'invoice.paid', data: { object: { id: 'in_fake_1', subscription: 'sub_fake_trial_1', billing_reason: 'subscription_cycle', amount_paid: 5000 } } } });
    await sleep(600);
    const memN2 = rd('memberships.db').find(m => m.user_id === 'qaPtNova0000001');
    const uN4 = rd('users.db').find(u => u._id === 'qaPtNova0000001');
    ok('prvá platba po skúške: +30 dní od konca skúšky, konverzia, cena 50', inv1.status === 200 && memN2.trial === false && memN2.price === 50 && !!uN4.trial_converted_at && Math.round((Date.parse(memN2.expires_at) - Date.parse(expPred)) / 864e5) === 30, JSON.stringify({ t: memN2.trial, p: memN2.price, e: memN2.expires_at, pred: expPred }));
    ok('platba po skúške je v tržbách (obnova 50 €) + faktúra', rd('transactions.db').some(t => t.user_id === 'qaPtNova0000001' && t.type === 'subscription_renewal' && t.amount === 50) && rd('invoices.db').some(i => i.user_id === 'qaPtNova0000001' && i.total === 50));
    // zrušenie počas skúšky (iná klientka)
    // Zoja: nová klientka založená cez registráciu (NeDB drží dáta v pamäti — do súboru sa dopisovať nedá)
    const zoja = {};
    const reg = await j('/api/register', { method: 'POST', body: { name: 'Zoja Zrušená', email: 'qa.pt.zoja@qa-biz.local', password: 'Heslo123!', phone: '0900999888', user_type: 'client', consent: true } }, zoja);
    ok('Zoja sa zaregistrovala', reg.status === 200 || reg.status === 201, JSON.stringify(reg.d).slice(0, 100));
    await j('/api/login', { method: 'POST', body: { email: 'qa.pt.zoja@qa-biz.local', password: 'Heslo123!' } }, zoja);
    const zojaId = (await j('/api/me', {}, zoja)).d.id;
    const tz = await j('/api/stripe/trial', { method: 'POST' }, zoja);
    ok('Zoja dostane skúšku', tz.status === 200, JSON.stringify(tz.d));
    await j('/api/stripe/webhook', { method: 'POST', body: { id: 'evt_trial_z', type: 'checkout.session.completed', data: { object: { id: 'fake_trial_'+zojaId, mode: 'subscription', status: 'complete', payment_status: 'no_payment_required', subscription: 'sub_fake_trial_z', metadata: { user_id: zojaId, member_id: zojaId, plan_id: 'bronze', type: 'subscription', trial: '1' } } } } });
    await sleep(500);
    const cz = await j('/api/stripe/subscribe/cancel', { method: 'POST', body: { reason: 'cas' } }, zoja);
    await sleep(300);
    const uZ = rd('users.db').find(u => u._id === zojaId); const mZ = rd('memberships.db').find(m => m.user_id === zojaId);
    ok('zrušenie počas skúšky: odber preč, členstvo do konca skúšky ostáva', cz.status === 200 && cz.d.ok && !uZ.stripe_subscription_id && mZ && mZ.status === 'active' && mZ.expires_at.slice(0, 10) === exp7, JSON.stringify({ c: cz.d, s: uZ.stripe_subscription_id, e: mZ && mZ.expires_at }));
    await j('/api/stripe/webhook', { method: 'POST', body: { id: 'evt_del_z', type: 'customer.subscription.deleted', data: { object: { id: 'sub_fake_trial_z' } } } });
    await sleep(300);
    ok('po zrušení príde oznam „nič sa nestrhne"', rd('notifications.db').some(n => n.user_id === zojaId && /Skúšobný týždeň zrušený/.test(n.title)));
    ok('bez skúšky ide stále kúpiť vstup/členstvo (Sára: 402 s can_pay_on_site)', bkS.d.can_pay_on_site === true);
    // statika
    const dash = fs.readFileSync(path.join(ROOT, 'public', 'client-dashboard.html'), 'utf8');
    ok('nástenka má celú obrazovku skúšky a otvára ju pri vstupe', /id="skuskaWall"/.test(dash) && /skuskaUkaz\(me\)/.test(dash) && /Vyskúšať za 0,00 €/.test(dash) && /Nie, ďakujem/.test(dash) && /stripe'\)==='trial'/.test(dash));
    const idx = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    ok('landing appky: prvý týždeň zadarmo, stena so skúškou', /Prvý týždeň zadarmo/.test(idx) && /startTrialFromLanding/.test(idx) && !/<title>Fusion Academy – Prvá hodina zadarmo/.test(idx));
    const sch = fs.readFileSync(path.join(ROOT, 'public', 'schedule.html'), 'utf8');
    ok('rozvrh: skúška ako prvá voľba pri hodine bez krytia', /skuskaZRozvrhu/.test(sch) && /trial_available/.test(sch));
  } catch (e) { failed++; console.log('  ❌ výnimka: ' + e.stack); }
  finally { proc.kill(); await sleep(500); try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} }

  // ═══ B) režim VYPNUTÝ (bez env) — stará prvá hodina zadarmo funguje ═══
  const DATA2 = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-pt2-'));
  fixtures(DATA2, DOW, nowMin);
  console.log('PRVÝ TÝŽDEŇ — štart servera (vypnuté)…');
  ({ proc, BASE } = await start(4539, DATA2, { PRVY_TYZDEN: '' }));
  j = mkJ(BASE); rd = mkRd(DATA2);
  try {
    ok('config: prepínač vypnutý', (await j('/api/config')).d.prvy_tyzden === false);
    const nora = {}; await j('/api/login', { method: 'POST', body: { email: 'qa.pt.nora@qa-biz.local', password: 'Heslo123!' } }, nora);
    ok('/api/me: bez režimu nie je nárok', (await j('/api/me', {}, nora)).d.trial.on === false);
    const bk = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaPtZumbaBud' } }, nora);
    ok('prvá hodina zadarmo ako doteraz', bk.status === 200 && rd('bookings.db').some(b => b.user_id === 'qaPtNova0000001' && b.access_method === 'free_class'), JSON.stringify(bk.d).slice(0, 100));
    ok('skúška vypnutá → 400', (await j('/api/stripe/trial', { method: 'POST' }, nora)).status === 400);
  } catch (e) { failed++; console.log('  ❌ výnimka: ' + e.stack); }
  finally { proc.kill(); console.log('\nPRVÝ TÝŽDEŇ: ' + passed + ' OK / ' + failed + ' chýb'); setTimeout(() => { try { fs.rmSync(DATA2, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 600); }
})();
