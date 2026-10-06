/**
 * Venčeky — audit 6. 10. 2026, balík B: peniaze.
 *
 * Audit našiel: zrušenie platby bolo jeden riadok bez stopy (tržba zmizla z účtovníctva,
 * faktúra ostala platná, žiak ďalej veril, že má zaplatené), dvojitá platba kartou po
 * hotovosti sa prehltla ticho, pripomienka nezaplateného kurzu chodila len v appke
 * (a 21 z 24 detí nemá pripojeného rodiča) a náklady venčekov nevstupovali do výsledku firmy.
 *
 * Test stráži:
 *   · zrušenie platby: dôvod povinný, audit, dobropis, oznam žiakovi aj rodičom
 *   · platbu kartou nejde zrušiť bez potvrdenia, že peniaze sú vrátené
 *   · dvojitá platba (karta po hotovosti) upozorní admina
 *   · týždenná pripomienka ide aj mailom rodičom
 *   · prehľad venčekových dlžníkov + ručná upomienka
 *   · náklady venčekov znižujú výsledok firmy
 *
 * Spustenie:  node qa/vencek-audit-peniaze.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4633;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-vpen-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

const TRIEDA = 'qaVpTrieda00001', SKOLA = 'qaVpSkola000001';
const ZIAK = 'qaVpZiak0000001', ZIAK2 = 'qaVpZiak0000002', MAMA = 'qaVpMama0000001';

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zakl = { password: hash, user_type: 'client', active: true, created_at: '2026-09-01' };
  const vT = { venceky_class_id: TRIEDA, venceky_school_id: SKOLA };
  w('users.db', [
    { _id: 'qaVpAdmin000001', name: 'Marek Gruber', email: 'qa.vp.admin@qa-biz.local', ...zakl, is_admin: true, user_type: 'admin' },
    { _id: ZIAK, name: 'Ema Platiaca', email: 'qa.vp.z1@qa-biz.local', ...zakl, ...vT, venceky_role: 'student', vencek_rodicia: [MAMA] },
    { _id: ZIAK2, name: 'Tomáš Dlžník', email: 'qa.vp.z2@qa-biz.local', ...zakl, ...vT, venceky_role: 'student' },
    { _id: MAMA, name: 'Mama Platiaca', email: 'qa.vp.mama@qa-biz.local', ...zakl, ...vT, venceky_role: 'parent' },
  ]);
  w('venceky_schools.db', [{ _id: SKOLA, name: 'Halíč QA', city: 'Halíč', year: '2026/27', created_at: '2026-09-01' }]);
  w('venceky_classes.db', [{ _id: TRIEDA, school_id: SKOLA, name: 'Venčeková skupina', year: '2026/27', code: 'VEN-QAVP',
    price: 49.9, lessons_total: 13, lessons_before: 10, lessons_done: 2, lecturer: 'Marek Gruber', event_date: '2026-12-12',
    roles: ['student', 'parent', 'teacher'], start_at: '2026-09-10T11:00:00.000Z',
    dances: [{ name: 'Waltz', level: 0 }], created_at: '2026-09-01' }]);

  console.log('VENČEKY — PENIAZE (zrušenie platby, dvojitá platba, dlžníci, náklady)\n');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TZ: 'UTC', PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_FAKE: '1', NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await sleep(15000);

  const jar = { adm: {} };
  try {
    await j('/api/login', { method: 'POST', body: { email: 'qa.vp.admin@qa-biz.local', password: 'Heslo123!' } }, jar.adm);

    console.log('1) Zrušenie platby:');
    await j('/api/admin/venceky/payment', { method: 'POST', body: { class_id: TRIEDA, user_id: ZIAK, method: 'cash' } }, jar.adm);
    ok('platba zapísaná', rd('venceky_payments.db').length === 1 && rd('invoices.db').length === 1);
    let r = await j('/api/admin/venceky/payment-delete', { method: 'POST', body: { class_id: TRIEDA, user_id: ZIAK } }, jar.adm);
    ok('bez dôvodu to neprejde', r.status === 400 && /dôvod/i.test(r.d.error || ''), JSON.stringify(r.d));
    ok('platba ostala', rd('venceky_payments.db').length === 1);
    r = await j('/api/admin/venceky/payment-delete', { method: 'POST', body: { class_id: TRIEDA, user_id: ZIAK, reason: 'omyl pri zápise' } }, jar.adm);
    ok('s dôvodom sa zruší', r.status === 200 && !rd('venceky_payments.db').length, JSON.stringify(r.d));
    const au = rd('audit.db').find(a => a.action === 'vencek_platba_zrusena');
    ok('zapísané do auditu aj s dôvodom', au && au.reason === 'omyl pri zápise' && au.before.amount === 49.9, JSON.stringify(au && au.before));
    const dobropis = rd('invoices.db').find(i => i.type === 'credit_note');
    ok('vystavený dobropis na −49,90 €', dobropis && dobropis.total === -49.9, JSON.stringify(dobropis && dobropis.total));
    ok('pôvodná faktúra označená ako dobropisovaná', rd('invoices.db').some(i => i.status === 'credited'));
    const oz = rd('notifications.db').filter(n => /Platba za venčekový kurz bola zrušená/.test(n.title || ''));
    ok('oznam dostal žiak aj mama', oz.length === 2 && oz.some(n => n.user_id === ZIAK) && oz.some(n => n.user_id === MAMA));
    ok('neexistujúcu platbu to nezmaže potichu', (await j('/api/admin/venceky/payment-delete', { method: 'POST', body: { class_id: TRIEDA, user_id: ZIAK, reason: 'x' } }, jar.adm)).status === 404);

    console.log('\n2) Platba kartou:');
    await j('/api/admin/venceky/payment', { method: 'POST', body: { class_id: TRIEDA, user_id: ZIAK, method: 'cash' } }, jar.adm);
    const platba = rd('venceky_payments.db')[0];
    fs.writeFileSync(path.join(DATA, 'venceky_payments.db'), JSON.stringify({ ...platba, method: 'stripe' }) + '\n');
    srv.kill(); await sleep(800);
    const srv2 = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'),
      env: { ...process.env, TZ: 'UTC', PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_FAKE: '1', NODE_ENV: 'test' },
      stdio: ['ignore', 'ignore', 'pipe'] });
    srv2.stderr.on('data', d => { chyba += d; });
    const t1 = Date.now(); let z2 = false;
    while (Date.now() - t1 < 60000) { try { await fetch(BASE + '/'); z2 = true; break; } catch (e) { await sleep(800); } }
    ok('server po reštarte beží', z2);
    await sleep(14000);
    jar.adm = {}; await j('/api/login', { method: 'POST', body: { email: 'qa.vp.admin@qa-biz.local', password: 'Heslo123!' } }, jar.adm);
    r = await j('/api/admin/venceky/payment-delete', { method: 'POST', body: { class_id: TRIEDA, user_id: ZIAK, reason: 'test' } }, jar.adm);
    ok('kartu bez vrátenia peňazí nezruší', r.status === 400 && r.d.stripe === true && /Stripe/.test(r.d.error || ''), JSON.stringify(r.d));
    r = await j('/api/admin/venceky/payment-delete', { method: 'POST', body: { class_id: TRIEDA, user_id: ZIAK, reason: 'vrátené v Stripe', force: true } }, jar.adm);
    ok('s potvrdením „už som vrátil" sa zruší', r.status === 200 && !rd('venceky_payments.db').length);

    console.log('\n3) Dvojitá platba (karta po hotovosti):');
    await j('/api/admin/venceky/payment', { method: 'POST', body: { class_id: TRIEDA, user_id: ZIAK2, method: 'cash' } }, jar.adm);
    r = await j('/api/admin/qa/vencek-stripe-duplicate', { method: 'POST', body: { class_id: TRIEDA, user_id: ZIAK2 } }, jar.adm);
    const upoz = rd('notifications.db').find(n => /Dvojitá platba za venček/.test(n.title || ''));
    ok('admin dostal upozornenie, že treba vrátiť peniaze', !!upoz && /Tomáš/.test(upoz.body || ''), r.status + ' ' + JSON.stringify(r.d));
    ok('druhá platba sa nezapísala', rd('venceky_payments.db').filter(p => p.user_id === ZIAK2).length === 1);

    console.log('\n4) Pripomienka nezaplateného kurzu:');
    await j('/api/admin/qa/run-daily-tick?hour=9', { method: 'POST' }, jar.adm);
    await sleep(2500);
    const maily = rd('mail_log.db').filter(m => /ešte nie je uhradený/.test(m.subject || ''));
    ok('mail išiel rodičovi nezaplateného žiaka', maily.some(m => m.to === 'qa.vp.mama@qa-biz.local'), JSON.stringify(maily.map(m => m.to)));
    ok('upozornenie v appke ostalo', rd('notifications.db').some(n => /^vencek_platba:/.test(n.key || '')));

    console.log('\n5) Prehľad dlžníkov:');
    const dl = await j('/api/admin/vencek-dlznici', {}, jar.adm);
    ok('zoznam nezaplatených so sumou', dl.d.ok && dl.d.count >= 1 && dl.d.owed > 0, JSON.stringify({ c: dl.d.count, o: dl.d.owed }));
    const ema = (dl.d.rows || []).find(x => x.id === ZIAK);
    ok('pri žiakovi je škola, skupina a rodičia', ema && ema.school === 'Halíč QA' && ema.rodicia.length === 1 && ema.amount === 49.9, JSON.stringify(ema));
    const pocetMailovPred = rd('mail_log.db').length;
    r = await j('/api/admin/vencek-dlznici/remind', { method: 'POST', body: { user_id: ZIAK, class_id: TRIEDA } }, jar.adm);
    ok('ručná upomienka odišla žiakovi aj mame', r.d.ok && r.d.mailov === 2 && rd('mail_log.db').length === pocetMailovPred + 2, JSON.stringify(r.d));
    await j('/api/admin/venceky/payment', { method: 'POST', body: { class_id: TRIEDA, user_id: ZIAK, method: 'cash' } }, jar.adm);
    ok('zaplatenému už upomienka nejde', (await j('/api/admin/vencek-dlznici/remind', { method: 'POST', body: { user_id: ZIAK, class_id: TRIEDA } }, jar.adm)).status === 400);

    console.log('\n6) Náklady venčekov vo výsledku firmy:');
    const pred = await j('/api/admin/finance/stats?from=2026-09-01&to=2026-12-31', {}, jar.adm);
    await j('/api/admin/venceky/cost', { method: 'POST', body: { class_id: TRIEDA, label: 'Kvety a diplomy', amount: 120 } }, jar.adm);
    const po = await j('/api/admin/finance/stats?from=2026-09-01&to=2026-12-31', {}, jar.adm);
    const n1 = ((pred.d || {}).naklady || {}), n2 = ((po.d || {}).naklady || {});
    ok('venčekové náklady sú vo výsledku', (n2.venceky || 0) === 120 && (n2.spolu || 0) === +(((n1.spolu || 0) + 120).toFixed(2)), JSON.stringify({ pred: n1.spolu, po: n2.spolu, v: n2.venceky }));
    ok('čistý výsledok sa o ne znížil', ((po.d || {}).vysledok || {}).cisty === +((((pred.d || {}).vysledok || {}).cisty || 0) - 120).toFixed(2), JSON.stringify({ a: ((pred.d || {}).vysledok || {}).cisty, b: ((po.d || {}).vysledok || {}).cisty }));
    srv2.kill();
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    try { srv.kill(); } catch (e) {}
    await sleep(600);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nVENČEKY — PENIAZE: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-1500));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
