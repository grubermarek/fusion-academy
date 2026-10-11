/**
 * Dátumy platieb, ktoré sa zapíšu neskôr (Marek 11. 10. 2026: „Michaela Nosalová —
 * členstvo bronze 49,90, nahoď to od minulého utorka"; platila v utorok, zapísalo sa to
 * až v nedeľu na hodine, lebo sa im nedal otvoriť profil).
 *
 * Overuje dva servisné nástroje:
 *  - POST /api/service/clenstvo-zapisat — členstvo od dňa platby + tržba a doklad k tomu dňu;
 *    keď členstvo beží, dátum sa nepretláča (klientke sa nesmie skrátiť)
 *  - POST /api/service/platba-prelozit — už zapísanú platbu preloží na deň platby
 *    (tržba, začiatok členstva, hotovosť u trénera), koniec členstva nechá na pokoji
 * Oba majú suchý náhľad, bez tokenu neexistujú a mesiac tržby prenesú len vedome.
 *
 * Spustenie:  node qa/platba-datumy.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4629, BASE = 'http://localhost:' + PORT, TOKEN = 'qa-servis-token';
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-datumy-'));
let ok = 0, zle = 0;
const t = (n, c, d) => { if (c) { ok++; console.log('  ✅ ' + n); } else { zle++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const iso = p => new Date(Date.now() + p * 864e5).toISOString();
const den = p => iso(p).slice(0, 10);
const poslednyStav = f => fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x))
  .reduce((a, r) => (r.$$deleted ? delete a[r._id] : a[r._id] = { ...(a[r._id] || {}), ...r }, a), {});

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaPdNova0000001', name: 'Nová Klientka', email: 'qa.pd.nova@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAPD01' },
    { _id: 'qaPdBezi0000001', name: 'Bežiaca Klientka', email: 'qa.pd.bezi@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAPD02', membership_plan: 'bronze', membership_expires: iso(10) },
    { _id: 'qaPdPosun000001', name: 'Michaela Posunová', email: 'qa.pd.posun@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAPD03', membership_plan: 'bronze', membership_expires: iso(34) },
    { _id: 'qaPdIna00000001', name: 'Iná Klientka', email: 'qa.pd.ina@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAPD04' },
  ]));
  fs.writeFileSync(path.join(DATA, 'memberships.db'), riadky([
    { _id: 'qaPdMem00000001', user_id: 'qaPdBezi0000001', plan_id: 'bronze', plan_name: 'Bronze', price: 49.9, status: 'active', started_at: iso(-20), expires_at: iso(10), created_at: den(-20) },
    // členstvo zapísané dnes (ako Michaele) — koniec 34 dní (30 + 4 dni kompenzácie)
    { _id: 'qaPdMem00000002', user_id: 'qaPdPosun000001', plan_id: 'bronze', plan_name: 'Bronze', price: 49.9, status: 'active', started_at: iso(0), expires_at: iso(34), created_at: iso(0) },
  ]));
  fs.writeFileSync(path.join(DATA, 'transactions.db'), riadky([
    { _id: 'qaPdTx000000001', type: 'membership', user_id: 'qaPdPosun000001', user_name: 'Michaela Posunová', date: den(0), amount: 49.9, payment_method: 'cash', method: 'cash', note: 'Bronze — predané na hodine Zumba (hotovosť)', plan_id: 'bronze', created_at: iso(0), month: den(0).slice(0, 7) },
    { _id: 'qaPdTx000000002', type: 'membership', user_id: 'qaPdIna00000001', user_name: 'Iná Klientka', date: den(0), amount: 49.9, payment_method: 'cash', method: 'cash', note: 'Bronze', plan_id: 'bronze', created_at: iso(0), month: den(0).slice(0, 7) },
  ]));
  fs.writeFileSync(path.join(DATA, 'payouts.db'), riadky([
    { _id: 'qaPdPay00000001', _type: 'cash_collected', trainer_id: 'qaPdTrener00001', trainer_name: 'Tina Trénerka', amount: 49.9, note: 'Bronze — Michaela Posunová · Zumba', month: den(0).slice(0, 7), date: den(0), status: 'held', created_at: iso(0) },
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1', 'clenstvo_na_ucte_zarovnanie_20261009']
    .map((x, i) => ({ _id: 'qaPdSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('DÁTUMY PLATIEB — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', IMPORT_TOKEN: TOKEN }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; srv.stderr.on('data', d => { err += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + err.slice(-600)); process.exit(1); }
  await sleep(2000);

  const post = async (cesta, telo, token = TOKEN) => {
    const r = await fetch(BASE + cesta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-import-token': token } : {}) }, body: JSON.stringify(telo) });
    let d = null; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };

  try {
    // ── clenstvo-zapisat: bez tokenu neexistuje
    const bez = await post('/api/service/clenstvo-zapisat', { email: 'qa.pd.nova@qa-biz.local', plan_id: 'bronze' }, null);
    t('bez tokenu endpoint neexistuje (404)', bez.status === 404, String(bez.status));

    // ── suchý náhľad nič nezapíše
    const nahlad = await post('/api/service/clenstvo-zapisat', { email: 'qa.pd.nova@qa-biz.local', plan_id: 'bronze', od: den(-5), suma: 49.9 });
    t('náhľad ukáže od/do a sumu', nahlad.status === 200 && nahlad.d.apply === false && nahlad.d.nahlad.od === den(-5) && nahlad.d.nahlad.clenstvo_do === den(25), JSON.stringify(nahlad.d).slice(0, 180));
    t('náhľad nič nezapísal', !Object.values(poslednyStav('memberships.db')).some(m => m.user_id === 'qaPdNova0000001'), 'členstvo vzniklo');

    // ── zápis od dňa platby
    const zap = await post('/api/service/clenstvo-zapisat', { email: 'qa.pd.nova@qa-biz.local', plan_id: 'bronze', od: den(-5), suma: 49.9, metoda: 'cash', apply: true, reason: 'QA' });
    t('členstvo sa zapísalo od dňa platby', zap.status === 200 && zap.d.clenstvo_do === den(25), JSON.stringify(zap.d).slice(0, 160));
    const mNova = Object.values(poslednyStav('memberships.db')).find(m => m.user_id === 'qaPdNova0000001');
    t('začiatok členstva je deň platby', mNova && String(mNova.started_at).slice(0, 10) === den(-5), JSON.stringify(mNova && mNova.started_at));
    t('cena a spôsob platby sú na členstve', mNova && mNova.price === 49.9 && mNova.payment_method === 'cash', JSON.stringify(mNova && { p: mNova.price, m: mNova.payment_method }));
    const txNova = Object.values(poslednyStav('transactions.db')).find(x => x.user_id === 'qaPdNova0000001');
    t('tržba je k dňu platby', txNova && txNova.date === den(-5) && txNova.amount === 49.9 && txNova.payment_method === 'cash', JSON.stringify(txNova && { d: txNova.date, a: txNova.amount }));
    t('mesiac tržby sedí s dátumom', txNova && txNova.month === den(-5).slice(0, 7), JSON.stringify(txNova && txNova.month));

    // ── bežiace členstvo sa nesmie skrátiť
    const bezi = await post('/api/service/clenstvo-zapisat', { email: 'qa.pd.bezi@qa-biz.local', plan_id: 'bronze', od: den(-3), suma: 49.9, apply: true });
    t('bežiacemu členstvu sa dátum nepretláča', bezi.status === 200 && bezi.d.clenstvo_do > den(10), JSON.stringify(bezi.d).slice(0, 140));

    // ── ochrany
    const bud = await post('/api/service/clenstvo-zapisat', { email: 'qa.pd.nova@qa-biz.local', plan_id: 'bronze', od: den(3), apply: true });
    t('dátum v budúcnosti odmietne', bud.status === 400 && /budúcnosti/.test(bud.d.error || ''), JSON.stringify(bud.d));
    const bundle = await post('/api/service/clenstvo-zapisat', { email: 'qa.pd.nova@qa-biz.local', plan_id: 'permanentka10', od: den(-2), apply: true });
    t('permanentku týmto zapísať nedá', bundle.status === 400 && /Permanentky/.test(bundle.d.error || ''), JSON.stringify(bundle.d));

    // ── platba-prelozit: náhľad
    const pN = await post('/api/service/platba-prelozit', { email: 'qa.pd.posun@qa-biz.local', transaction_id: 'qaPdTx000000001', na: den(-5) });
    t('náhľad preloženia ukáže z/na aj členstvo a hotovosť', pN.status === 200 && pN.d.apply === false && pN.d.nahlad.na === den(-5)
      && /nemenim/.test(String(pN.d.nahlad.clenstvo.do || '')) && /Tina/.test(String(pN.d.nahlad.hotovost)), JSON.stringify(pN.d).slice(0, 240));
    t('náhľad preloženia nič nezmenil', poslednyStav('transactions.db')['qaPdTx000000001'].date === den(0), poslednyStav('transactions.db')['qaPdTx000000001'].date);

    // ── preloženie
    const pA = await post('/api/service/platba-prelozit', { email: 'qa.pd.posun@qa-biz.local', transaction_id: 'qaPdTx000000001', na: den(-5), apply: true, reason: 'platila v utorok' });
    t('preloženie prešlo', pA.status === 200 && pA.d.na === den(-5) && pA.d.hotovost === true, JSON.stringify(pA.d).slice(0, 160));
    const tx1 = poslednyStav('transactions.db')['qaPdTx000000001'];
    t('tržba má nový dátum aj mesiac', tx1.date === den(-5) && tx1.month === den(-5).slice(0, 7), JSON.stringify({ d: tx1.date, m: tx1.month }));
    t('v poznámke je deň platby', /platené/.test(tx1.note || ''), tx1.note);
    const mem2 = poslednyStav('memberships.db')['qaPdMem00000002'];
    t('začiatok členstva sa posunul', String(mem2.started_at).slice(0, 10) === den(-5), String(mem2.started_at).slice(0, 10));
    t('koniec členstva ostal nedotknutý', String(mem2.expires_at).slice(0, 10) === den(34), String(mem2.expires_at).slice(0, 10));
    const pay = poslednyStav('payouts.db')['qaPdPay00000001'];
    t('hotovosť u trénera má nový dátum', pay.date === den(-5), pay.date);

    // ── ochrany preloženia
    const iny = await post('/api/service/platba-prelozit', { email: 'qa.pd.posun@qa-biz.local', transaction_id: 'qaPdTx000000002', na: den(-2), apply: true });
    t('platbu inej klientky odmietne', iny.status === 400 && /inej klientke/.test(iny.d.error || ''), JSON.stringify(iny.d));
    const mesiac = await post('/api/service/platba-prelozit', { email: 'qa.pd.posun@qa-biz.local', transaction_id: 'qaPdTx000000001', na: den(-45), apply: true });
    t('iný mesiac bez aj_mesiac odmietne', mesiac.status === 400 && /mesiac/.test(mesiac.d.error || ''), JSON.stringify(mesiac.d));
    const bezTok = await post('/api/service/platba-prelozit', { email: 'qa.pd.posun@qa-biz.local', transaction_id: 'qaPdTx000000001', na: den(-2) }, null);
    t('preloženie bez tokenu neexistuje (404)', bezTok.status === 404, String(bezTok.status));
  } catch (e) {
    zle++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nDÁTUMY PLATIEB: ' + ok + ' OK / ' + zle + ' chýb');
    process.exit(zle ? 1 : 0);
  }
})();
