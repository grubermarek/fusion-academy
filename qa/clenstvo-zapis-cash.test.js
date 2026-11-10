/**
 * Zápis zaplateného členstva z karty klientky (Marek 10. 11. 2026).
 *
 * Hanke Ilčíkovej sa cash Bronze nedal zapísať: v admin paneli viedla k predaju
 * členstva jediná cesta — Dochádzka → zapísať na hodinu — a tá ponuku „Predať
 * členstvo" dáva LEN klientke bez krytia. Hanka mala zapnutý zimný mesiac
 * zadarmo, takže ju panel zapísal ako krytú a zaplatiť nemala kde.
 *
 * Test stráži, že:
 *   · členstvo sa dá zapísať aj klientke, ktorá už jedno bežiace má
 *   · predvolená cena je bez automatickej obnovy (+10 %)
 *   · štart sa vyberá: od dnes, alebo nadviazať na koniec bežiaceho
 *   · tržba vznikne RAZ (transakcia), nie dvakrát (aj z členského záznamu)
 *   · faktúra je zaplatená v deň platby, aj pri spätnom zápise
 *   · poistky: nulová suma, dátum v budúcnosti, neznámy plán, neznámy človek
 *   · cena na zázname sa dá opraviť (darovaný mesiac nechá nulu), ale nie tam,
 *     kde je cena samotná tržba — a oprava tržbou nepohne
 *
 * Spustenie:  node qa/clenstvo-zapis-cash.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4572;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-memsell-'));

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
const den = d => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zadarmoDo = new Date(Date.now() + 21 * 86400000).toISOString();
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaSellAdmin00001', name: 'Adam Admin', email: 'qa.sell.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }),
    // klientka so zimným mesiacom zadarmo — presne Hankin prípad
    JSON.stringify({ _id: 'qaSellZima000001', name: 'Hana Zimna', email: 'qa.sell.zima@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: den(0), city: 'Detva' }),
    // klientka bez členstva — bežný zápis
    JSON.stringify({ _id: 'qaSellNova000001', name: 'Nina Nova', email: 'qa.sell.nova@qa-biz.local',
      password: hash, user_type: 'lead', active: true, created_at: den(0), city: 'Detva' }),
    // klientka so staršími záznamami — darovaný mesiac (nula) aj hotovosť od trénera
    JSON.stringify({ _id: 'qaSellStary00001', name: 'Stela Stara', email: 'qa.sell.stara@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: den(-60), city: 'Zvolen' }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(DATA, 'memberships.db'), [
    JSON.stringify({ _id: 'qaSellMem0000001', user_id: 'qaSellZima000001', plan_id: 'bronze',
      plan_name: 'Bronze', price: 0, status: 'active', started_at: new Date().toISOString(),
      expires_at: zadarmoDo, created_at: new Date().toISOString() }),
    // darovaný mesiac: cena 0, žiadna platobná metóda — tu sa cena opravuje
    JSON.stringify({ _id: 'qaSellMemDar0001', user_id: 'qaSellStary00001', plan_id: 'bronze',
      plan_name: 'Bronze', price: 0, status: 'expired', started_at: den(-60) + 'T10:00:00.000Z',
      expires_at: den(-30) + 'T23:59:59.000Z', created_at: den(-60) + 'T10:00:00.000Z' }),
    // hotovosť zapísaná trénerom: cena JE tržba (revenueEvents ju číta zo záznamu)
    JSON.stringify({ _id: 'qaSellMemCash001', user_id: 'qaSellStary00001', plan_id: 'bronze',
      plan_name: 'Bronze', price: 54.9, status: 'expired', payment_method: 'cash',
      started_at: den(-30) + 'T10:00:00.000Z', expires_at: den(-1) + 'T23:59:59.000Z',
      created_at: den(-30) + 'T10:00:00.000Z' }),
  ].join('\n') + '\n');

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

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.sell.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    console.log('\nČo panel ponúkne:');
    const opt = await j('/api/admin/membership/sell-options?user_id=qaSellZima000001', {}, adm);
    ok('ponuka sa načíta', opt.status === 200 && opt.d?.ok === true, JSON.stringify(opt.d).slice(0, 200));
    const bronze = (opt.d?.plans || []).find(p => p.id === 'bronze');
    ok('Bronze má cenu bez automatickej obnovy (54,90)', bronze && Math.abs(bronze.price - 54.9) < 0.005, JSON.stringify(bronze));
    ok('a vedľa nej aj cenu s obnovou (49,90)', bronze && Math.abs(bronze.price_auto - 49.9) < 0.005, JSON.stringify(bronze));
    ok('panel povie, že členstvo beží', !!opt.d?.current && opt.d.current.plan_id === 'bronze', JSON.stringify(opt.d?.current));
    ok('a že ho má zadarmo', opt.d?.current?.zadarmo === true, JSON.stringify(opt.d?.current));
    ok('zrušený plán Zumba Kids v ponuke nie je', !(opt.d?.plans || []).some(p => p.id === 'kids'), JSON.stringify((opt.d?.plans || []).map(p => p.id)));

    console.log('\nPoistky:');
    const nula = await j('/api/admin/membership/sell', { method: 'POST', body: { user_id: 'qaSellZima000001', plan_id: 'bronze', amount: 0 } }, adm);
    ok('nulová suma → 400', nula.status === 400, JSON.stringify(nula.d));
    const buduci = await j('/api/admin/membership/sell', { method: 'POST', body: { user_id: 'qaSellZima000001', plan_id: 'bronze', amount: 54.9, date: den(3) } }, adm);
    ok('dátum v budúcnosti → 400', buduci.status === 400, JSON.stringify(buduci.d));
    const zlyPlan = await j('/api/admin/membership/sell', { method: 'POST', body: { user_id: 'qaSellZima000001', plan_id: 'platinum', amount: 54.9 } }, adm);
    ok('neznámy plán → 400', zlyPlan.status === 400, JSON.stringify(zlyPlan.d));
    const nikto = await j('/api/admin/membership/sell', { method: 'POST', body: { user_id: 'nikto000000000', plan_id: 'bronze', amount: 54.9 } }, adm);
    ok('neznámy človek → 404', nikto.status === 404, JSON.stringify(nikto.d));
    const bezPrihlasenia = await j('/api/admin/membership/sell', { method: 'POST', body: { user_id: 'qaSellZima000001', plan_id: 'bronze', amount: 54.9 } });
    ok('bez admina to nejde', bezPrihlasenia.status === 401 || bezPrihlasenia.status === 403, JSON.stringify(bezPrihlasenia.d));

    console.log('\nHankin prípad — hotovosť popri mesiaci zadarmo, platí od dnes:');
    const prodaj = await j('/api/admin/membership/sell', { method: 'POST', body: {
      user_id: 'qaSellZima000001', plan_id: 'bronze', amount: 54.9, payment_method: 'cash', date: den(0), start: 'today' } }, adm);
    ok('zápis prejde, aj keď členstvo beží', prodaj.status === 200 && prodaj.d?.ok === true, JSON.stringify(prodaj.d));
    ok('členstvo platí odo dnes +30 dní', String(prodaj.d?.expires_at || '').slice(0, 10) === den(30), prodaj.d?.expires_at + ' vs ' + den(30));
    ok('vznikla faktúra', !!prodaj.d?.invoice, JSON.stringify(prodaj.d));

    const tx = rd('transactions.db').filter(t => t.user_id === 'qaSellZima000001');
    ok('tržbu nesie jedna transakcia', tx.length === 1, JSON.stringify(tx.map(t => [t.type, t.amount, t.payment_method])));
    ok('typ je členstvo', tx[0]?.type === 'membership', tx[0]?.type);
    ok('so spôsobom platby hotovosť', tx[0]?.payment_method === 'cash', tx[0]?.payment_method);
    ok('a s dnešným dátumom', String(tx[0]?.date || '').slice(0, 10) === den(0), tx[0]?.date);

    const mems = rd('memberships.db').filter(m => m.user_id === 'qaSellZima000001');
    ok('členský záznam ostal jeden (nepribudol druhý bežiaci)', mems.length === 1, JSON.stringify(mems.map(m => [m.plan_id, m.status, m.expires_at])));
    ok('a nemá payment_method (inak by sa tržba rátala dvakrát)', !mems[0]?.payment_method, JSON.stringify(mems[0]));
    ok('ale nesie zaplatenú cenu, nie nulu po mesiaci zadarmo', Math.abs((+mems[0]?.price || 0) - 54.9) < 0.005, String(mems[0]?.price));

    const predaje = await j('/api/admin/predaje?limit=500', {}, adm);
    const riadky = (predaje.d?.rows || []).filter(r => r.who?.id === 'qaSellZima000001');
    ok('v Predajoch je presne jeden riadok', riadky.length === 1, JSON.stringify(riadky.map(r => [r.a, r.what])));
    ok('a je na 54,90 €', Math.abs((riadky[0]?.a || 0) - 54.9) < 0.005, JSON.stringify(riadky[0]));
    ok('s naviazanou faktúrou', !!riadky[0]?.invoice?.number, JSON.stringify(riadky[0]?.invoice));

    const karta = await j('/api/admin/crm/client/qaSellZima000001', {}, adm);
    ok('karta klientky ukazuje 54,90 € zaplatených', Math.abs((karta.d?.kpis?.totalPaid || 0) - 54.9) < 0.005, JSON.stringify(karta.d?.kpis?.totalPaid));
    ok('a platbu v zozname', (karta.d?.payments || []).length === 1, JSON.stringify((karta.d?.payments || []).map(p => [p.amount, p.note])));

    console.log('\nSpätný zápis a nadviazanie na koniec bežiaceho:');
    const opt2 = await j('/api/admin/membership/sell-options?user_id=qaSellZima000001', {}, adm);
    const doKedy = String(opt2.d?.current?.expires_at || '');
    const prodaj2 = await j('/api/admin/membership/sell', { method: 'POST', body: {
      user_id: 'qaSellZima000001', plan_id: 'bronze', amount: 54.9, payment_method: 'transfer', date: den(-5), start: 'after' } }, adm);
    ok('druhý mesiac sa zapíše', prodaj2.status === 200 && prodaj2.d?.ok === true, JSON.stringify(prodaj2.d));
    const cakane = new Date(Date.parse(doKedy) + 30 * 86400000).toISOString().slice(0, 10);
    ok('a nadviaže na koniec predošlého', String(prodaj2.d?.expires_at || '').slice(0, 10) === cakane, prodaj2.d?.expires_at + ' vs ' + cakane);
    const tx2 = rd('transactions.db').filter(t => t.user_id === 'qaSellZima000001');
    ok('spätná platba má dátum spred 5 dní', tx2.some(t => String(t.date || '').slice(0, 10) === den(-5)), JSON.stringify(tx2.map(t => t.date)));
    ok('a sedí v mesiaci dňa platby', tx2.some(t => t.month === den(-5).slice(0, 7)), JSON.stringify(tx2.map(t => t.month)));
    const fakt = rd('invoices.db').filter(i => i.user_id === 'qaSellZima000001');
    const spatna = fakt.find(i => String(i.paid_at || '').slice(0, 10) === den(-5));
    ok('faktúra je zaplatená v deň platby', !!spatna, JSON.stringify(fakt.map(i => [i.number, i.issued_at, i.paid_at])));
    ok('ale vystavená dneškom (číslovanie ide po dátumoch)', String(spatna?.issued_at || '').slice(0, 10) === den(0), spatna?.issued_at);

    console.log('\nKlientka bez členstva:');
    const prodaj3 = await j('/api/admin/membership/sell', { method: 'POST', body: {
      user_id: 'qaSellNova000001', plan_id: 'silver', amount: 82.4, payment_method: 'cash', note: 'platila na recepcii' } }, adm);
    ok('Silver sa zapíše', prodaj3.status === 200 && prodaj3.d?.ok === true, JSON.stringify(prodaj3.d));
    const u3 = rd('users.db').find(u => u._id === 'qaSellNova000001');
    ok('z leadu je klientka', u3?.user_type === 'client', u3?.user_type);
    ok('a má členstvo na profile', u3?.membership_plan === 'silver', JSON.stringify([u3?.membership_plan, u3?.membership_expires]));
    const tx3 = rd('transactions.db').find(t => t.user_id === 'qaSellNova000001');
    ok('poznámka z panela sa zapísala', tx3?.note === 'platila na recepcii', tx3?.note);

    console.log('\nPermanentka (vstupy, nie členstvo):');
    const perm = await j('/api/admin/membership/sell', { method: 'POST', body: {
      user_id: 'qaSellNova000001', plan_id: 'permanentka10', amount: 80, payment_method: 'cash' } }, adm);
    ok('permanentka sa dá zapísať tiež', perm.status === 200 && perm.d?.ok === true, JSON.stringify(perm.d));
    ok('appka ju označí ako vstupy', perm.d?.bundle === true, JSON.stringify(perm.d));
    const u3b = rd('users.db').find(u => u._id === 'qaSellNova000001');
    ok('a pripíše 10 vstupov', (u3b?.single_entries || 0) === 10, String(u3b?.single_entries));
    const txPerm = rd('transactions.db').find(t => t.user_id === 'qaSellNova000001' && t.type === 'single_entry');
    ok('tržba za permanentku má typ vstupu', !!txPerm && Math.abs(txPerm.amount - 80) < 0.005, JSON.stringify(txPerm && [txPerm.type, txPerm.amount]));

    console.log('\nOprava ceny na členskom zázname:');
    const predajePred = await j('/api/admin/predaje?limit=500', {}, adm);
    const sumaPred = (predajePred.d?.rows || []).reduce((s2, r) => s2 + (+r.a || 0), 0);

    const nieCislo = await j('/api/admin/memberships/qaSellMemDar0001/cena', { method: 'POST', body: { price: 'asi tak' } }, adm);
    ok('nečíslo → 400', nieCislo.status === 400, JSON.stringify(nieCislo.d));
    const privela = await j('/api/admin/memberships/qaSellMemDar0001/cena', { method: 'POST', body: { price: 99999 } }, adm);
    ok('nezmyselná suma → 400', privela.status === 400, JSON.stringify(privela.d));
    const nieto = await j('/api/admin/memberships/nieto00000000001/cena', { method: 'POST', body: { price: 10 } }, adm);
    ok('neznámy záznam → 404', nieto.status === 404, JSON.stringify(nieto.d));
    const jeTrzba = await j('/api/admin/memberships/qaSellMemCash001/cena', { method: 'POST', body: { price: 10 } }, adm);
    ok('na zázname s platbou to server nepustí (cena je tam tržba)', jeTrzba.status === 400, JSON.stringify(jeTrzba.d));
    const bezAdmina2 = await j('/api/admin/memberships/qaSellMemDar0001/cena', { method: 'POST', body: { price: 10 } });
    ok('bez admina to nejde', bezAdmina2.status === 401 || bezAdmina2.status === 403, JSON.stringify(bezAdmina2.d));

    const oprava = await j('/api/admin/memberships/qaSellMemDar0001/cena', { method: 'POST', body: { price: '49,90' } }, adm);
    ok('cena sa opraví (aj zapísaná s desatinnou čiarkou)', oprava.status === 200 && Math.abs((oprava.d?.price || 0) - 49.9) < 0.005, JSON.stringify(oprava.d));
    ok('a odpoveď povie, z čoho sa menila', Math.abs((oprava.d?.od ?? -1) - 0) < 0.005, JSON.stringify(oprava.d));
    const darRow = rd('memberships.db').find(m => m._id === 'qaSellMemDar0001');
    ok('záznam nesie novú cenu', Math.abs((+darRow?.price || 0) - 49.9) < 0.005, String(darRow?.price));
    ok('a platobnú metódu mu to nepridalo', !darRow?.payment_method, JSON.stringify(darRow));

    const predajePo = await j('/api/admin/predaje?limit=500', {}, adm);
    const sumaPo = (predajePo.d?.rows || []).reduce((s2, r) => s2 + (+r.a || 0), 0);
    ok('tržba sa opravou nepohla', Math.abs(sumaPo - sumaPred) < 0.005, sumaPred + ' → ' + sumaPo);

    const kartaS = await j('/api/admin/crm/client/qaSellStary00001', {}, adm);
    const riadokDar = (kartaS.d?.memberships || []).find(m => m.id === 'qaSellMemDar0001');
    ok('tab Členstvá už nehlási 0 €', riadokDar && Math.abs(riadokDar.price - 49.9) < 0.005, JSON.stringify(riadokDar));
    ok('a ponúka opravu len na tomto zázname', riadokDar?.fixable === true, JSON.stringify(riadokDar));
    const riadokCash = (kartaS.d?.memberships || []).find(m => m.id === 'qaSellMemCash001');
    ok('na zázname s hotovosťou opravu neponúka', riadokCash?.fixable === false, JSON.stringify(riadokCash));
    ok('a karta ukazuje zaplatených len 54,90 € (nula sa do LTV nepridala)', Math.abs((kartaS.d?.kpis?.totalPaid || 0) - 54.9) < 0.005, String(kartaS.d?.kpis?.totalPaid));

    const znova = await j('/api/admin/memberships/qaSellMemDar0001/cena', { method: 'POST', body: { price: 49.9 } }, adm);
    ok('tá istá cena druhý raz nič nemení', znova.status === 200 && znova.d?.bez_zmeny === true, JSON.stringify(znova.d));
    const audCena = rd('audit.db').filter(a => a.action === 'membership_cena');
    ok('oprava má jeden riadok v audite', audCena.length === 1, String(audCena.length));
    ok('a v ňom starú aj novú cenu', audCena[0]?.before?.price === 0 && Math.abs((audCena[0]?.after?.price || 0) - 49.9) < 0.005, JSON.stringify(audCena[0] && [audCena[0].before, audCena[0].after]));

    console.log('\nStopa v audite:');
    const aud = rd('audit.db').filter(a => a.action === 'membership_sell');
    ok('každý zápis má riadok v audite', aud.length === 4, String(aud.length));
    ok('a v ňom sumu aj spôsob platby', aud.every(a => a.after && a.after.amount > 0 && a.after.method), JSON.stringify(aud.map(a => a.after)));
  } finally {
    console.log('\n──────────────────────────────');
    console.log(`  ${passed} ✅   ${failed} ❌`);
    srv.kill('SIGTERM');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
