/**
 * Venčeky — dvojitý účet dieťaťa (Marek 24. 9. 2026).
 *
 * V Halíči mali tri deti dva účty s rovnakým menom: jeden si založil rodič na svoj
 * e-mail (a z neho zaplatil kurz), druhý si založilo dieťa. Dieťa potom vyšlo ako
 * neplatič, chodili mu pripomienky, dochádzka aj „zaplatilo X/Y" boli mimo a rodič
 * nebol nikde vedený ako rodič. Príčina: do 16. 9. sa v skupine dala pri registrácii
 * zvoliť len rola žiak.
 *
 * Test stráži:
 *   · registrácia s menom, ktoré už v skupine je, sa zastaví a poradí rolu rodič
 *   · menovec sa vie zaregistrovať po potvrdení; rodič a iná skupina sa neblokujú
 *   · zrušený účet duplicitou nie je
 *   · admin opraví dvojicu: z druhého účtu je rodič, platba aj dochádzka idú dieťaťu
 *   · oprava beží potichu — žiadne oznamy ani maily rodine
 *   · po oprave je dieťa v skupine raz, zaplatené, s rodičom; oprava je opakovateľná
 *
 * Spustenie:  node qa/vencek-duplicita.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4611;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-dupl-'));

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
const user = id => rd('users.db').find(u => u._id === id);
const podlaMailu = e => rd('users.db').find(u => u.email === e);

const A = 'qaDpTriedaA0001', B = 'qaDpTriedaB0001';
const DIETA = 'qaDpDieta000001', RODIC = 'qaDpRodic000001', INY = 'qaDpIny00000001';
const ZRUSENY = 'qaDpZruseny0001', LEA = 'qaDpLea00000001';

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zakl = { password: hash, user_type: 'client', active: true, created_at: '2026-09-01' };
  const vA = { venceky_class_id: A, venceky_school_id: 'qaDpSkolaA00001', venceky_role: 'student' };
  w('users.db', [
    { _id: 'qaDpAdmin000001', name: 'Marek Gruber', email: 'qa.dp.admin@qa-biz.local', ...zakl, is_admin: true, user_type: 'admin' },
    // Dieťa má vlastný e-mail a nezaplatené, rodič si založil účet na svoje meno dieťaťa a zaplatil.
    { _id: DIETA, name: 'Félix Kokavec', email: 'qa.dp.felix@qa-biz.local', phone: '+421900000001', ...zakl, ...vA },
    { _id: RODIC, name: 'Felix  Kokavec', email: 'qa.dp.otec@qa-biz.local', ...zakl, ...vA },
    { _id: INY, name: 'Ema Szabóová', email: 'qa.dp.ema@qa-biz.local', ...zakl, ...vA },
    { _id: ZRUSENY, name: 'Marek Búr', email: 'qa.dp.zruseny@qa-biz.local', ...zakl, ...vA, active: false },
    { _id: LEA, name: 'Lea Hnúšťanská', email: 'qa.dp.lea@qa-biz.local', ...zakl, venceky_class_id: B, venceky_school_id: 'qaDpSkolaB00001', venceky_role: 'student' },
  ]);
  w('venceky_schools.db', [
    { _id: 'qaDpSkolaA00001', name: 'Halíč QA', city: 'Halíč', year: '2026/27', created_at: '2026-09-01' },
    { _id: 'qaDpSkolaB00001', name: 'Hnúšťa QA', city: 'Hnúšťa', year: '2026/27', created_at: '2026-09-01' },
  ]);
  const trieda = (id, sid, code) => ({ _id: id, school_id: sid, name: 'Venčeková skupina', year: '2026/27', code, price: 49.90,
    lessons_total: 10, lessons_before: 10, lessons_done: 1, lecturer: 'Marek Gruber', event_date: '2027-06-05', roles: ['student', 'teacher'],
    start_at: '2026-09-02T12:30:00.000Z', dances: [{ name: 'Waltz', level: 0 }], created_at: '2026-09-01' });
  w('venceky_classes.db', [trieda(A, 'qaDpSkolaA00001', 'VEN-QADUPA'), trieda(B, 'qaDpSkolaB00001', 'VEN-QADUPB')]);
  // Platba visí na rodičovskom účte — presne ako v Halíči (karta, 8. 9.).
  w('venceky_payments.db', [{ _id: 'qaDpPlatba00001', class_id: A, school_id: 'qaDpSkolaA00001', user_id: RODIC,
    user_name: 'Felix  Kokavec', amount: 49.90, method: 'stripe', paid_at: '2026-09-14T09:00:00.000Z',
    stripe_session_id: 'cs_qa_dupl_1', created_at: '2026-09-14T09:00:00.000Z' }]);
  // Dochádzku 1. lekcie má tiež rodičovský účet (Adelin prípad) — dieťa vtedy účet ešte nemalo.
  w('venceky_attendance.db', [{ _id: 'qaDpDoch0000001', class_id: A, school_id: 'qaDpSkolaA00001', lesson_no: 1,
    present: [RODIC, INY], absent: [], created_at: '2026-09-12T16:24:00.000Z' }]);

  console.log('VENČEKY — DVOJITÝ ÚČET DIEŤAŤA\n');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TZ: 'UTC', PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await sleep(16000); // migrácie po štarte (roly, oznam, maily)

  const jar = { adm: {} };
  try {
    await j('/api/login', { method: 'POST', body: { email: 'qa.dp.admin@qa-biz.local', password: 'Heslo123!' } }, jar.adm);

    const reg = (telo) => j('/api/register', { method: 'POST', body: { password: 'Heslo123!', consent: true, user_type: 'client', lead_source: 'vencek', ...telo } });

    console.log('1) Rovnaké meno v skupine registráciu zastaví:');
    const blok = await reg({ name: 'Felix Kokavec', email: 'qa.dp.dupl1@qa-biz.local', vencek_code: 'VEN-QADUPA', vencek_role: 'student' });
    ok('409 s príznakom duplicity', blok.status === 409 && blok.d.vencek_duplicita === true, blok.status + ' ' + JSON.stringify(blok.d));
    ok('vetu dostane aj bez diakritiky a s inou veľkosťou písmen', /už je zapísaný\/á/.test(blok.d.error || ''), JSON.stringify(blok.d));
    ok('poradí rolu rodič', /rolu rodič/.test(blok.d.hint || ''), JSON.stringify(blok.d.hint));
    ok('účet naozaj nevznikol', !podlaMailu('qa.dp.dupl1@qa-biz.local'));
    const blok2 = await reg({ name: '  félix   KOKAVEC ', email: 'qa.dp.dupl2@qa-biz.local', vencek_code: 'VEN-QADUPA', vencek_role: 'student' });
    ok('zdvojené medzery ani veľké písmená blok neobídu', blok2.status === 409 && !podlaMailu('qa.dp.dupl2@qa-biz.local'), blok2.status);

    console.log('\n2) Koho blok netrápi:');
    const rodicReg = await reg({ name: 'Felix Kokavec', email: 'qa.dp.rodicreg@qa-biz.local', vencek_code: 'VEN-QADUPA', vencek_role: 'parent' });
    ok('rodič s menom dieťaťa prejde', rodicReg.status === 200 && !!podlaMailu('qa.dp.rodicreg@qa-biz.local'), rodicReg.status + ' ' + JSON.stringify(rodicReg.d));
    ok('a je vedený ako rodič', (podlaMailu('qa.dp.rodicreg@qa-biz.local') || {}).venceky_role === 'parent');
    const inaSkupina = await reg({ name: 'Félix Kokavec', email: 'qa.dp.inask@qa-biz.local', vencek_code: 'VEN-QADUPB', vencek_role: 'student' });
    ok('rovnaké meno v inej skupine prejde', inaSkupina.status === 200 && !!podlaMailu('qa.dp.inask@qa-biz.local'), inaSkupina.status);
    const poZruseni = await reg({ name: 'Marek Búr', email: 'qa.dp.burr@qa-biz.local', vencek_code: 'VEN-QADUPA', vencek_role: 'student' });
    ok('zrušený účet duplicitou nie je', poZruseni.status === 200 && !!podlaMailu('qa.dp.burr@qa-biz.local'), poZruseni.status);
    const menovec = await reg({ name: 'Lea Hnustanska', email: 'qa.dp.menovec@qa-biz.local', vencek_code: 'VEN-QADUPB', vencek_role: 'student', vencek_duplicita_ok: true });
    ok('menovec po potvrdení prejde', menovec.status === 200 && !!podlaMailu('qa.dp.menovec@qa-biz.local'), menovec.status + ' ' + JSON.stringify(menovec.d));

    console.log('\n3) Oprava dvojice — čo endpoint odmietne:');
    const op = (telo) => j('/api/admin/venceky/rodic-z-uctu', { method: 'POST', body: telo }, jar.adm);
    ok('ten istý účet dvakrát', (await op({ rodic_id: RODIC, dieta_id: RODIC })).status === 400);
    ok('dieťa z inej skupiny', (await op({ rodic_id: RODIC, dieta_id: LEA })).status === 400);
    ok('neznámy účet', (await op({ rodic_id: 'nieje', dieta_id: DIETA })).status === 404);
    const bezPrav = await j('/api/admin/venceky/rodic-z-uctu', { method: 'POST', body: { rodic_id: RODIC, dieta_id: DIETA } });
    ok('bez admina sa nedá', bezPrav.status === 401 || bezPrav.status === 403, bezPrav.status);

    console.log('\n4) Oprava prebehne — a potichu:');
    const oznamovPred = rd('notifications.db').length, mailovPred = rd('mail_log.db').length;
    const r = await op({ rodic_id: RODIC, dieta_id: DIETA });
    ok('endpoint vrátil ok', r.status === 200 && r.d.ok === true, r.status + ' ' + JSON.stringify(r.d));
    ok('ohlásil presun platby aj lekcie', r.d.platba && r.d.platba.amount === 49.90 && r.d.lekcie === 1, JSON.stringify(r.d));
    ok('žiadny nový oznam', rd('notifications.db').length === oznamovPred, oznamovPred + ' → ' + rd('notifications.db').length);
    ok('žiadny mail', rd('mail_log.db').length === mailovPred, mailovPred + ' → ' + rd('mail_log.db').length);

    const platby = rd('venceky_payments.db');
    ok('platba ostala jedna', platby.length === 1, String(platby.length));
    ok('patrí dieťaťu, platcom je rodič', platby[0].user_id === DIETA && platby[0].payer_id === RODIC && platby[0].payer_name === 'Felix  Kokavec', JSON.stringify(platby[0]));
    ok('spôsob, dátum aj Stripe id ostali', platby[0].method === 'stripe' && platby[0].paid_at === '2026-09-14T09:00:00.000Z' && platby[0].stripe_session_id === 'cs_qa_dupl_1', JSON.stringify(platby[0]));
    const doch = rd('venceky_attendance.db')[0];
    ok('dochádzku 1. lekcie má dieťa', doch.present.includes(DIETA) && !doch.present.includes(RODIC), JSON.stringify(doch.present));
    ok('spolužiak v dochádzke ostal', doch.present.includes(INY) && doch.present.length === 2, JSON.stringify(doch.present));
    ok('z druhého účtu je rodič', user(RODIC).venceky_role === 'parent' && user(RODIC).venceky_class_id === A, JSON.stringify(user(RODIC).venceky_role));
    ok('dieťa má rodiča v väzbe', (user(DIETA).vencek_rodicia || []).includes(RODIC), JSON.stringify(user(DIETA).vencek_rodicia));
    ok('rodič má pri sebe meno dieťaťa', user(RODIC).vencek_child_name === 'Félix Kokavec', String(user(RODIC).vencek_child_name));
    ok('dieťa ostalo žiakom', (user(DIETA).venceky_role || 'student') === 'student');

    console.log('\n5) Ako to vidí admin:');
    const det = (await j('/api/admin/venceky/class/' + A, {}, jar.adm)).d;
    const felixovia = det.members.filter(m => /kokavec/i.test(m.name));
    ok('Félix je v skupine raz', felixovia.length === 1, JSON.stringify(det.members.map(m => m.name)));
    ok('a je zaplatený, platcom rodič', felixovia[0].paid === true && felixovia[0].payer === 'Felix  Kokavec', JSON.stringify(felixovia[0]));
    ok('má pri sebe rodiča', (felixovia[0].rodicia || []).includes('Felix  Kokavec'), JSON.stringify(felixovia[0].rodicia));
    ok('rodič je v zozname rodičov s dieťaťom', det.parents.some(p => p.id === RODIC && p.child === 'Félix Kokavec'), JSON.stringify(det.parents.map(p => [p.name, p.child])));
    const prehlad = (await j('/api/admin/venceky/overview', {}, jar.adm)).d;
    const skupA = prehlad.schools.flatMap(s => s.classes).find(c => c.id === A);
    ok('„zaplatilo X/Y" už nie je skreslené', skupA.paid === 1 && skupA.members === skupA.paid + skupA.unpaid, JSON.stringify({ p: skupA.paid, n: skupA.unpaid, m: skupA.members }));

    console.log('\n6) Oprava sa dá spustiť znova bez škody:');
    const znova = await op({ rodic_id: RODIC, dieta_id: DIETA });
    ok('druhý beh prejde', znova.status === 200 && znova.d.ok === true, znova.status + ' ' + JSON.stringify(znova.d));
    ok('platba sa nezdvojila', rd('venceky_payments.db').length === 1 && rd('venceky_payments.db')[0].user_id === DIETA);
    ok('rodič ostal jeden', (user(DIETA).vencek_rodicia || []).length === 1, JSON.stringify(user(DIETA).vencek_rodicia));

    console.log('\n7) Dve platby sa ticho nespoja:');
    const dvojka = await j('/api/admin/venceky/payment', { method: 'POST', body: { class_id: A, user_id: INY, amount: 49.90, method: 'cash' } }, jar.adm);
    ok('spolužiačka zaplatila hotovosťou', dvojka.status === 200, JSON.stringify(dvojka.d));
    const kolizia = await op({ rodic_id: INY, dieta_id: DIETA });
    ok('endpoint odmietne, keď sú zaplatené oba účty', kolizia.status === 400 && /OBA/.test(kolizia.d.error || ''), kolizia.status + ' ' + JSON.stringify(kolizia.d));
    ok('a obe platby ostali nedotknuté', rd('venceky_payments.db').length === 2);
  } catch (e) {
    failed++; console.log('  ❌ výnimka — ' + e.message + '\n' + e.stack);
  } finally {
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\n' + (failed ? '❌ ' : '✅ ') + passed + ' prešlo, ' + failed + ' zlyhalo');
  process.exit(failed ? 1 : 0);
})();
