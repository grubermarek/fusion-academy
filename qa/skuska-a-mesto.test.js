/**
 * Dva servisné nástroje z 14. 10. 2026:
 *  1. `skuska-dat` — prvý týždeň zadarmo ručne (Marek: „Zdenka dnes začala týždeň zadarmo",
 *     „Katka má dnes ešte prvý týždeň zadarmo"). Klientka si ho v appke preklikne zle
 *     (Zdenka ponuku omylom odmietla), tréner jej ho na hodine sľúbi.
 *  2. `mesto-len-vstup` — prepnutie mesta medzi „len za vstup" a bežným režimom
 *     (Marek: „Breznu opäť spustíme predaj permanentiek aj mesačných členstiev").
 *
 * Overuje náhľad bez zápisu, zapnutie skúšky aj po odmietnutí, odpustenie vstupného na
 * mieste, že permanentka klientke ostane nedotknutá, ochrany (už mala / beží členstvo /
 * bez tokenu) a že po prepnutí Brezna členstvo hodinu zase kryje.
 *
 * Spustenie:  node qa/skuska-a-mesto.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4632, BASE = 'http://localhost:' + PORT, TOKEN = 'qa-servis-token';
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-skuska-'));
let ok = 0, zle = 0;
const t = (n, c, d) => { if (c) { ok++; console.log('  ✅ ' + n); } else { zle++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const iso = p => new Date(Date.now() + p * 864e5).toISOString();
const sk = ms => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date(ms));
const DNES = sk(Date.now());
// NeDB pri úprave dopíše CELÝ dokument, takže platí posledný riadok s daným _id
// (nie zlúčenie — inak by zmazané pole ostalo viditeľné)
const poslednyStav = f => fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x))
  .reduce((a, r) => (r.$$deleted ? delete a[r._id] : a[r._id] = r, a), {});

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaSkLead00000001', name: 'Zdenka Leadová', email: 'qa.sk.lead@qa-biz.local', password: hash, user_type: 'lead', active: true, created_at: '2026-09-16', referral_code: 'QASK01', trial_declined_at: iso(0) },
    { _id: 'qaSkPerm00000001', name: 'Katka Permanentková', email: 'qa.sk.perm@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QASK02', single_entries: 10, visit_count: 2 },
    { _id: 'qaSkMala00000001', name: 'Už Mala', email: 'qa.sk.mala@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QASK03', trial_used: true },
    { _id: 'qaSkClen00000001', name: 'Členka Breznianska', email: 'qa.sk.clen@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QASK04', membership_plan: 'bronze', membership_expires: iso(20), city: 'Brezno' },
  ]));
  fs.writeFileSync(path.join(DATA, 'memberships.db'), riadky([
    // permanentka má status 'bundle' — skúška ju nesmie prerátať na kredit
    { _id: 'qaSkMem00000001', user_id: 'qaSkPerm00000001', plan_id: 'permanentka10', plan_name: 'Permanentka 10', price: 80, status: 'bundle', started_at: iso(0), expires_at: iso(90), created_at: iso(0) },
    { _id: 'qaSkMem00000002', user_id: 'qaSkClen00000001', plan_id: 'bronze', plan_name: 'Bronze', price: 49.9, status: 'active', started_at: iso(-10), expires_at: iso(20), created_at: iso(-10) },
  ]));
  const DOW = new Date(DNES + 'T12:00:00Z').getUTCDay();
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    { _id: 'qaSkHodBrezno1', name: 'Zumba', category: 'Zumba', location: 'Brezno', day_of_week: DOW, time_start: '19:00', time_end: '20:00', capacity: 30, price: 10,
      emoji: '💃', active: true, instructor: 'Marek Gruber', created_at: '2026-01-01' },
  ]));
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky([
    { _id: 'qaSkBk000000001', class_id: 'qaSkHodBrezno1', class_name: 'Zumba', user_id: 'qaSkPerm00000001', user_name: 'Katka Permanentková',
      booking_date: DNES, status: 'attended', attendance_status: 'attended', access_method: 'pay_on_site', pay_on_site: true, pay_amount: 10, created_at: iso(0) },
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky([
    { _id: 'qaSkSetLV', key: 'mesta_len_vstup', value: { Brezno: { aktivne: true, cena: 10, od: '2026-09-15', dobiehaju: {} } }, at: '2026-09-15T00:00:00.000Z' },
    { _id: 'qaSkSetPT', key: 'prvy_tyzden', value: true, at: '2026-09-27T00:00:00.000Z' },
    ...['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1', 'clenstvo_na_ucte_zarovnanie_20261009', 'mesta_len_vstup_brezno_20260915']
      .map((x, i) => ({ _id: 'qaSkSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' })),
  ]));

  console.log('SKÚŠKA RUČNE + MESTO — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', IMPORT_TOKEN: TOKEN }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; srv.stderr.on('data', d => { err += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + err.slice(-600)); process.exit(1); }
  await sleep(3000);

  const post = async (cesta, telo, token = TOKEN) => {
    const r = await fetch(BASE + cesta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-import-token': token } : {}) }, body: JSON.stringify(telo) });
    let d = null; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };
  const prihlas = async email => { const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Heslo123!' }) }); return String(r.headers.get('set-cookie') || '').split(';')[0]; };

  try {
    // ── skuska-dat
    t('skúška bez tokenu neexistuje (404)', (await post('/api/service/skuska-dat', { email: 'qa.sk.lead@qa-biz.local' }, null)).status === 404);
    const n1 = await post('/api/service/skuska-dat', { email: 'qa.sk.lead@qa-biz.local' });
    t('náhľad ukáže, že ponuku odmietla', n1.status === 200 && n1.d.apply === false && !!n1.d.nahlad.odmietla, JSON.stringify(n1.d).slice(0, 160));
    t('náhľad nič nezapísal', !poslednyStav('users.db')['qaSkLead00000001'].trial_used);

    const a1 = await post('/api/service/skuska-dat', { email: 'qa.sk.lead@qa-biz.local', apply: true, reason: 'QA' });
    t('skúška sa zapla aj po odmietnutí', a1.status === 200 && !!a1.d.skuska_do, JSON.stringify(a1.d).slice(0, 140));
    const u1 = poslednyStav('users.db')['qaSkLead00000001'];
    t('klientka má trial_used a koniec o 7 dní', u1.trial_used === true && String(u1.trial_ends_at).slice(0, 10) === sk(Date.now() + 7 * 864e5),
      JSON.stringify({ t: u1.trial_used, do: u1.trial_ends_at }));
    t('odmietnutie sa zahodilo', !u1.trial_declined_at, JSON.stringify(u1.trial_declined_at));
    t('z leadu je klientka', u1.user_type === 'client', u1.user_type);
    const m1 = Object.values(poslednyStav('memberships.db')).find(m => m.user_id === 'qaSkLead00000001');
    t('členstvo je skúšobné a za 0 €', m1 && m1.trial === true && m1.price === 0, JSON.stringify(m1 && { t: m1.trial, p: m1.price }));

    // ── permanentkárka: skúška + odpustené vstupné, vstupy ostanú
    const a2 = await post('/api/service/skuska-dat', { email: 'qa.sk.perm@qa-biz.local', pokry_dni: [DNES], apply: true, reason: 'QA' });
    t('vstupné na mieste sa odpustilo', a2.status === 200 && (a2.d.odpustene_vstupne || []).length === 1, JSON.stringify(a2.d).slice(0, 160));
    const b1 = poslednyStav('bookings.db')['qaSkBk000000001'];
    t('rezervácia už nie je „platí na mieste"', b1.pay_on_site === false && b1.access_method === 'trial' && !b1.pay_amount, JSON.stringify({ p: b1.pay_on_site, a: b1.access_method }));
    t('zostal dôvod odpustenia', /prvý týždeň/.test(b1.pay_waived_reason || ''), b1.pay_waived_reason);
    const u2 = poslednyStav('users.db')['qaSkPerm00000001'];
    t('permanentka ostala nedotknutá (10 vstupov)', (u2.single_entries || 0) === 10, String(u2.single_entries));
    t('permanentka sa neprerátala na kredit', !(u2.referral_credit > 0), String(u2.referral_credit || 0));
    t('permanentkové členstvo ostalo', poslednyStav('memberships.db')['qaSkMem00000001'].status === 'bundle');

    // ── ochrany
    const o1 = await post('/api/service/skuska-dat', { email: 'qa.sk.mala@qa-biz.local', apply: true });
    t('tej, čo skúšku mala, ju druhýkrát nedá', o1.status === 400 && /už mala/.test(o1.d.error || ''), JSON.stringify(o1.d));
    const o2 = await post('/api/service/skuska-dat', { email: 'qa.sk.clen@qa-biz.local', apply: true });
    t('klientke s bežiacim členstvom ju nedá', o2.status === 400 && /bežiace členstvo/.test(o2.d.error || ''), JSON.stringify(o2.d));

    // ── mesto-len-vstup: Brezno späť na bežný režim
    t('prepnutie mesta bez tokenu neexistuje (404)', (await post('/api/service/mesto-len-vstup', { mesto: 'Brezno', aktivne: false }, null)).status === 404);
    const nezname = await post('/api/service/mesto-len-vstup', { mesto: 'Pezinok', aktivne: false, apply: true });
    t('neznáme mesto odmietne', nezname.status === 404, JSON.stringify(nezname.d));
    const n2 = await post('/api/service/mesto-len-vstup', { mesto: 'Brezno', aktivne: false });
    t('náhľad ukáže stav pred aj po', n2.status === 200 && /len vstup/.test(n2.d.nahlad.teraz) && /bežný režim/.test(n2.d.nahlad.po_zmene), JSON.stringify(n2.d));

    const cookie = await prihlas('qa.sk.clen@qa-biz.local');
    const rezervuj = async () => {
      const r = await fetch(BASE + '/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ class_id: 'qaSkHodBrezno1', booking_date: DNES }) });
      let d = null; try { d = await r.json(); } catch (e) {}
      return { status: r.status, d };
    };
    const pred = await rezervuj();
    t('pred prepnutím členstvo Brezno nekryje', pred.status >= 400 || (pred.d && pred.d.ok === false) || (pred.d && pred.d.access_method && pred.d.access_method !== 'membership'),
      JSON.stringify(pred.d).slice(0, 160));

    const a3 = await post('/api/service/mesto-len-vstup', { mesto: 'Brezno', aktivne: false, apply: true, reason: 'Marek: Breznu opäť spustíme predaj' });
    t('prepnutie prešlo', a3.status === 200 && a3.d.aktivne === false, JSON.stringify(a3.d));
    const nast = Object.values(poslednyStav('settings.db')).find(s => s.key === 'mesta_len_vstup');
    t('v nastavení je Brezno vypnuté', nast && nast.value.Brezno.aktivne === false, JSON.stringify(nast && nast.value));
    t('cena a dobiehajúci ostali v zázname', nast && nast.value.Brezno.cena === 10 && !!nast.value.Brezno.od, JSON.stringify(nast && nast.value.Brezno));

    const po = await rezervuj();
    t('po prepnutí členstvo Brezno kryje', po.status === 200 && po.d && po.d.ok !== false, JSON.stringify(po.d).slice(0, 200));
    const rezervacie = Object.values(poslednyStav('bookings.db')).filter(b => b.user_id === 'qaSkClen00000001');
    t('rezervácia vznikla na členstvo', rezervacie.length === 1 && rezervacie[0].access_method === 'membership',
      JSON.stringify(rezervacie.map(b => b.access_method)));
  } catch (e) {
    zle++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nSKÚŠKA RUČNE + MESTO: ' + ok + ' OK / ' + zle + ' chýb');
    process.exit(zle ? 1 : 0);
  }
})();
