/**
 * Venčeky — rodičovské účty (Marek 16. 9. 2026).
 *
 * „Spravme všetkým venčekom aj rodičovské účty — rodič bude môcť platiť za svoje
 * dieťa a vidieť jeho dochádzku aj ostatné info, len platby a dochádzku iných detí
 * nemusí vedieť." Doplnené odpovede: rodič vidí aj chat skupiny, deti ďalej vidia,
 * kto chýbal, rodičovi príde správa o absencii, hotovosť môže zapísať aj lektor,
 * súhlas rodiča sa dáva v appke.
 *
 * Test stráži:
 *   · väzbu rodič ↔ dieťa kódom z appky dieťaťa aj odkazom od rodiča (aj pri registrácii)
 *   · že rodič nevidí platby ani dochádzku spolužiakov
 *   · platbu kartou len za pripojené dieťa + zápis platby z webhooku (raz, doklad rodičovi)
 *   · správu rodičovi, keď dieťa chýbalo (raz za lekciu)
 *   · chat: pripojený rodič áno, nepripojený nie
 *   · lektor zapíše hotovosť, iný tréner nie
 *   · súhlas rodiča, odpojenie, pripomienku nezaplateného kurzu
 *   · obrazovky v prehliadači (rodič, žiak, lektor, návrat po prihlásení)
 *
 * Spustenie:  node qa/vencek-rodicia.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4603;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-rodicia-'));
const SECRET = 'whsec_qa_rodicia';
const SHOTS = process.env.QA_SHOTS || '';

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
function webhook(telo) {
  const raw = JSON.stringify(telo), t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', SECRET).update(t + '.' + raw).digest('hex');
  return fetch(BASE + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=' + t + ',v1=' + v1 }, body: raw })
    .then(async r => ({ status: r.status, text: (await r.text()).slice(0, 160) }));
}

const A = 'qaRdTriedaA0001', B = 'qaRdTriedaB0001';
const EMA = 'qaRdEma00000001', TOMAS = 'qaRdTomas000001', LEA = 'qaRdLea00000001';
const MAMA = 'qaRdMama0000001';

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zakl = { password: hash, user_type: 'client', active: true, created_at: '2026-09-01' };
  const vA = { venceky_class_id: A, venceky_school_id: 'qaRdSkolaA00001' };
  w('users.db', [
    { _id: 'qaRdAdmin000001', name: 'Marek Gruber', email: 'qa.rd.admin@qa-biz.local', ...zakl, is_admin: true, user_type: 'admin' },
    { _id: 'qaRdIveta000001', name: 'Iveta Lektorová', email: 'qa.rd.iveta@qa-biz.local', ...zakl, user_type: 'trainer' },
    { _id: 'qaRdNelka000001', name: 'Nelka Trénerka', email: 'qa.rd.nelka@qa-biz.local', ...zakl, user_type: 'trainer' },
    { _id: EMA, name: 'Ema Tanečná', email: 'qa.rd.ema@qa-biz.local', ...zakl, ...vA, venceky_role: 'student' },
    { _id: TOMAS, name: 'Tomáš Spolužiak', email: 'qa.rd.tomas@qa-biz.local', ...zakl, ...vA, venceky_role: 'student' },
    { _id: 'qaRdUcitel00001', name: 'Učiteľka Triedna', email: 'qa.rd.ucitel@qa-biz.local', ...zakl, ...vA, venceky_role: 'teacher' },
    { _id: LEA, name: 'Lea Hnúšťanská', email: 'qa.rd.lea@qa-biz.local', ...zakl, venceky_class_id: B, venceky_school_id: 'qaRdSkolaB00001', venceky_role: 'student' },
    { _id: MAMA, name: 'Mama Tanečná', email: 'qa.rd.mama@qa-biz.local', ...zakl },
    { _id: 'qaRdZvedavec001', name: 'Zvedavý Hádač', email: 'qa.rd.zvedavec@qa-biz.local', ...zakl },
    { _id: 'qaRdMenovkyna01', name: 'Iveta Lektorova', email: 'qa.rd.menovkyna@qa-biz.local', ...zakl },
  ]);
  w('venceky_schools.db', [
    { _id: 'qaRdSkolaA00001', name: 'Klenovec QA', city: 'Klenovec', year: '2026/27', created_at: '2026-09-01' },
    { _id: 'qaRdSkolaB00001', name: 'Hnúšťa QA', city: 'Hnúšťa', year: '2026/27', created_at: '2026-09-01' },
  ]);
  const trieda = (id, sid, code, cena, lektor) => ({ _id: id, school_id: sid, name: '8. a 9. ročník', year: '2026/27', code, price: cena,
    lessons_total: 10, lessons_before: 10, lessons_done: 0, lecturer: lektor, event_date: '2027-06-05', roles: ['student', 'teacher'],
    start_at: '2026-09-02T12:30:00.000Z', dances: [{ name: 'Waltz', level: 0 }, { name: 'Polka', level: 0 }], created_at: '2026-09-01' });
  w('venceky_classes.db', [
    trieda(A, 'qaRdSkolaA00001', 'VEN-QARDA', 65, 'Marek Gruber'),
    trieda(B, 'qaRdSkolaB00001', 'VEN-QARDB', 90, 'Iveta Lektorová'),
  ]);

  console.log('VENČEKY — RODIČOVSKÉ ÚČTY\n');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TZ: 'UTC', PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_SECRET_KEY: 'sk_test_qa_fake', STRIPE_FAKE: '1',
      STRIPE_WEBHOOK_SECRET: SECRET, NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await sleep(12000); // migrácia rolí beží 10 s po štarte

  const jar = { adm: {}, iveta: {}, nelka: {}, ema: {}, tomas: {}, ucitel: {}, lea: {}, mama: {}, zved: {}, menovkyna: {} };
  const prihlas = (k, e) => j('/api/login', { method: 'POST', body: { email: e, password: 'Heslo123!' } }, jar[k]);
  let browser;
  try {
    await prihlas('adm', 'qa.rd.admin@qa-biz.local'); await prihlas('iveta', 'qa.rd.iveta@qa-biz.local');
    await prihlas('nelka', 'qa.rd.nelka@qa-biz.local'); await prihlas('ema', 'qa.rd.ema@qa-biz.local');
    await prihlas('tomas', 'qa.rd.tomas@qa-biz.local'); await prihlas('ucitel', 'qa.rd.ucitel@qa-biz.local');
    await prihlas('lea', 'qa.rd.lea@qa-biz.local'); await prihlas('mama', 'qa.rd.mama@qa-biz.local');
    await prihlas('zved', 'qa.rd.zvedavec@qa-biz.local'); await prihlas('menovkyna', 'qa.rd.menovkyna@qa-biz.local');

    console.log('1) Rola rodič je v registrácii každej skupiny:');
    const skupiny = rd('venceky_classes.db');
    ok('migrácia doplnila rodiča do oboch skupín', skupiny.every(c => (c.roles || []).includes('parent')), JSON.stringify(skupiny.map(c => c.roles)));
    ok('žiak ostal prvý', skupiny.every(c => c.roles[0] === 'student'));
    const info = await j('/api/vencek/info?code=VEN-QARDA');
    ok('registračná stránka ponúka rodiča', (info.d.roles || []).includes('parent'), JSON.stringify(info.d.roles));

    console.log('\n2) Žiak má kód a odkaz pre rodiča:');
    const kodE = await j('/api/vencek/rodic/kod', {}, jar.ema);
    ok('kód má 6 znakov', kodE.status === 200 && /^[A-Z2-9]{6}$/.test(kodE.d.kod), JSON.stringify(kodE.d));
    ok('odkaz vedie na registráciu skupiny', /\/v\/VEN-QARDA\?dieta=/.test(kodE.d.odkaz), kodE.d.odkaz);
    const kodE2 = await j('/api/vencek/rodic/kod', {}, jar.ema);
    ok('kód sa nemení', kodE2.d.kod === kodE.d.kod);
    const mineE0 = await j('/api/vencek/mine', {}, jar.ema);
    ok('prehľad žiaka nesie kód aj prázdny zoznam rodičov', mineE0.d.kod_rodica === kodE.d.kod && (mineE0.d.rodicia || []).length === 0, JSON.stringify({ k: mineE0.d.kod_rodica, r: mineE0.d.rodicia }));
    ok('učiteľ kód nedostane', (await j('/api/vencek/rodic/kod', {}, jar.ucitel)).status === 403);
    const kodT = (await j('/api/vencek/rodic/kod', {}, jar.tomas)).d.kod;
    const kodL = (await j('/api/vencek/rodic/kod', {}, jar.lea)).d.kod;

    console.log('\n3) Hádanie kódu je obmedzené:');
    const zle = await j('/api/vencek/rodic/pripojit', { method: 'POST', body: { kod: 'ZZZZZZ' } }, jar.zved);
    ok('neznámy kód → 404 so zrozumiteľnou vetou', zle.status === 404 && /nepoznáme/.test(zle.d.error), JSON.stringify(zle.d));
    for (let i = 0; i < 7; i++) await j('/api/vencek/rodic/pripojit', { method: 'POST', body: { kod: 'ZZZZZ' + i } }, jar.zved);
    const blok = await j('/api/vencek/rodic/pripojit', { method: 'POST', body: { kod: kodT } }, jar.zved);
    ok('po 8 omyloch ani správny kód neprejde (429)', blok.status === 429, blok.status + ' ' + JSON.stringify(blok.d));
    ok('a Tomáš nemá cudzieho rodiča', !(user(TOMAS).vencek_rodicia || []).length);

    console.log('\n4) Rodič sa pripojí kódom:');
    const vlastny = await j('/api/vencek/rodic/pripojit', { method: 'POST', body: { kod: kodE.d.kod } }, jar.ema);
    ok('žiak nepripojí sám seba', vlastny.status === 400 && /vlastnému/.test(vlastny.d.error), JSON.stringify(vlastny.d));
    const ucit = await j('/api/vencek/rodic/pripojit', { method: 'POST', body: { kod: kodT } }, jar.ucitel);
    ok('učiteľ skupiny sa rodičom nestane', ucit.status === 400 && /učiteľ/.test(ucit.d.error), JSON.stringify(ucit.d));
    const pr = await j('/api/vencek/rodic/pripojit', { method: 'POST', body: { kod: kodE.d.kod.toLowerCase().replace(/^(...)/, '$1-') } }, jar.mama);
    ok('mama sa pripojí (aj s malými písmenami a pomlčkou)', pr.status === 200 && pr.d.dieta.id === EMA, JSON.stringify(pr.d));
    await sleep(500);
    ok('Ema má mamu v zozname rodičov', (user(EMA).vencek_rodicia || []).includes(MAMA), JSON.stringify(user(EMA).vencek_rodicia));
    ok('mama je vedená ako rodič v skupine Emy', user(MAMA).venceky_role === 'parent' && user(MAMA).venceky_class_id === A, JSON.stringify({ r: user(MAMA).venceky_role, c: user(MAMA).venceky_class_id }));
    const notE = rd('notifications.db').filter(n => n.user_id === EMA && /pripojený\/á ako tvoj rodič/.test(n.title));
    ok('Ema dostala upozornenie, kto sa pripojil', notE.length === 1 && /Mama Tanečná/.test(notE[0].title), JSON.stringify(notE.map(n => n.title)));
    const znova = await j('/api/vencek/rodic/pripojit', { method: 'POST', body: { kod: kodE.d.kod } }, jar.mama);
    ok('druhé pripojenie nič nezdvojí', znova.status === 200 && znova.d.uz === true && user(EMA).vencek_rodicia.length === 1);

    console.log('\n5) Rodič vidí svoje dieťa, nie spolužiakov:');
    const mM = await j('/api/vencek/mine', {}, jar.mama);
    ok('rola rodič, dieťa Ema', mM.d.role === 'parent' && mM.d.dieta && mM.d.dieta.id === EMA, JSON.stringify({ r: mM.d.role, d: mM.d.dieta && mM.d.dieta.name }));
    ok('bez počtu platiacich a priemeru triedy', mM.d.class.paid_count === null && mM.d.class.attendance === null, JSON.stringify({ p: mM.d.class.paid_count, a: mM.d.class.attendance }));
    ok('v odpovedi nie je meno spolužiaka', !JSON.stringify(mM.d).includes('Tomáš'), '');
    ok('dieťa zatiaľ bez súhlasu a bez platby', mM.d.dieta.suhlas === false && mM.d.dieta.payment === null);
    ok('má odkaz na pozvanie dieťaťa', /\/v\/VEN-QARDA\?rodic=[A-Z2-9]{10}$/.test(mM.d.pozvanka_odkaz || ''), mM.d.pozvanka_odkaz);
    ok('chat má skupinu dieťaťa', mM.d.chat_class_id === A);
    const mE = await j('/api/vencek/mine', {}, jar.ema);
    ok('Ema vidí pripojenú mamu', (mE.d.rodicia || []).map(r => r.name).join() === 'Mama Tanečná', JSON.stringify(mE.d.rodicia));

    console.log('\n6) Dochádzka: správa rodičovi, kto chýbal vidia len deti:');
    const att = await j('/api/admin/venceky/attendance', { method: 'POST', body: { class_id: A, lesson_no: 1, absent: [EMA] } }, jar.adm);
    ok('zápis prešiel', att.status === 200, JSON.stringify(att.d));
    await sleep(1200);
    await j('/api/admin/venceky/attendance', { method: 'POST', body: { class_id: A, lesson_no: 1, absent: [EMA] } }, jar.adm);
    await sleep(1200);
    const abs = rd('notifications.db').filter(n => n.user_id === MAMA && /chýbal\/a na nácviku/.test(n.title));
    ok('mame prišla správa o absencii raz', abs.length === 1 && /Ema/.test(abs[0].title) && /Lekcia 1/.test(abs[0].body), JSON.stringify(abs.map(n => n.title + ' | ' + n.body)));
    const absMail = rd('mail_log.db').filter(m => m.to === 'qa.rd.mama@qa-biz.local' && /chýbal/.test(m.subject));
    ok('aj e-mailom, raz', absMail.length === 1 && absMail[0].template === 'vencek_absent', JSON.stringify(absMail.map(m => m.subject)));
    ok('Tomáš (bez rodiča) nič nespustil', !rd('notifications.db').some(n => /Tomáš chýbal/.test(n.title)));
    const mM2 = await j('/api/vencek/mine', {}, jar.mama);
    const l1 = (mM2.d.lessons || []).find(l => l.lesson === 1) || {};
    ok('rodič: pri lekcii 1 „dieťa chýbalo", bez mien', l1.recorded === true && l1.dieta_chybalo === true && l1.absent === null, JSON.stringify(l1));
    ok('rodič: dochádzka 0 z 1, chýbala na 1.', mM2.d.dieta.attendance && mM2.d.dieta.attendance.attended === 0 && mM2.d.dieta.attendance.missed.join() === '1', JSON.stringify(mM2.d.dieta.attendance));
    const mT = await j('/api/vencek/mine', {}, jar.tomas);
    const l1T = (mT.d.lessons || []).find(l => l.lesson === 1) || {};
    ok('spolužiak ďalej vidí, kto chýbal', (l1T.absent || []).some(x => /Ema/.test(x)), JSON.stringify(l1T));

    console.log('\n7) Chat: pripojený rodič áno, nepripojený nie:');
    const chM = await j('/api/vencek/chat', { method: 'POST', body: { text: 'Dobrý deň, Ema bude budúci týždeň chýbať.' } }, jar.mama);
    ok('mama napíše do chatu', chM.status === 200, JSON.stringify(chM.d));
    await sleep(700);
    const msg = rd('venceky_chat.db').find(m => m.user_id === MAMA);
    ok('správa je v skupine Emy s rolou rodič', msg && msg.class_id === A && msg.role === 'parent', JSON.stringify(msg));
    const nov = {};
    const reg = await j('/api/register', { method: 'POST', body: { name: 'Otec Nepripojený', email: 'qa.rd.otec@qa-biz.local', password: 'Heslo123!',
      city: 'Klenovec', consent: true, user_type: 'client', lead_source: 'vencek', vencek_code: 'VEN-QARDA', vencek_role: 'parent' } }, nov);
    ok('rodič bez dieťaťa sa zaregistruje', reg.status === 200, JSON.stringify(reg.d));
    const chO = await j('/api/vencek/chat', {}, nov);
    ok('ale chat nevidí', chO.status === 403, chO.status + '');
    const mO = await j('/api/vencek/mine', {}, nov);
    ok('a v prehľade má len výzvu pripojiť dieťa', mO.d.role === 'parent' && !mO.d.dieta && (mO.d.deti || []).length === 0 && mO.d.class && mO.d.class.paid_count === null, JSON.stringify({ r: mO.d.role, n: (mO.d.deti || []).length }));
    const notChat = rd('notifications.db').filter(n => /píše v chate/.test(n.title));
    ok('upozornenie o správe dostali Ema, Tomáš aj učiteľka, otec nie', ['qaRdUcitel00001', EMA, TOMAS].every(id => notChat.some(n => n.user_id === id))
      && !notChat.some(n => n.user_id === podlaMailu('qa.rd.otec@qa-biz.local')._id) && !notChat.some(n => n.user_id === MAMA), JSON.stringify(notChat.map(n => n.user_id)));

    console.log('\n8) Registrácia z odkazu prepojí rovno:');
    const lMama = {};
    const regL = await j('/api/register', { method: 'POST', body: { name: 'Mama Hnúšťanská', email: 'qa.rd.leamama@qa-biz.local', password: 'Heslo123!',
      city: 'Hnúšťa', consent: true, user_type: 'client', lead_source: 'vencek', vencek_code: 'VEN-QARDB', vencek_role: 'parent', vencek_dieta_kod: kodL } }, lMama);
    ok('rodič Ley sa zaregistruje z odkazu', regL.status === 200, JSON.stringify(regL.d));
    await sleep(600);
    const lm = podlaMailu('qa.rd.leamama@qa-biz.local');
    ok('a je pripojený k Lei', (user(LEA).vencek_rodicia || []).includes(lm._id), JSON.stringify(user(LEA).vencek_rodicia));
    const poz = await j('/api/vencek/rodic/pozvanka', {}, jar.mama);
    const token = (poz.d.odkaz || '').split('rodic=')[1];
    ok('mama má pozvánku pre dieťa', poz.status === 200 && /^[A-Za-z0-9]{10}$/.test(token || ''), JSON.stringify(poz.d));
    ok('žiak pozvánku rodiča nedostane', (await j('/api/vencek/rodic/pozvanka', {}, jar.ema)).status === 403);
    const brat = {};
    const regB = await j('/api/register', { method: 'POST', body: { name: 'Filip Tanečný', email: 'qa.rd.filip@qa-biz.local', password: 'Heslo123!',
      city: 'Klenovec', consent: true, user_type: 'client', lead_source: 'vencek', vencek_code: 'VEN-QARDA', vencek_role: 'student', vencek_rodic_token: token } }, brat);
    ok('brat Emy sa zaregistruje z pozvánky', regB.status === 200, JSON.stringify(regB.d));
    await sleep(600);
    const filip = podlaMailu('qa.rd.filip@qa-biz.local');
    ok('a je pripojený k mame', (filip.vencek_rodicia || []).includes(MAMA), JSON.stringify(filip.vencek_rodicia));
    const mM3 = await j('/api/vencek/mine', {}, jar.mama);
    ok('mama má dve deti', (mM3.d.deti || []).length === 2, JSON.stringify(mM3.d.deti));
    const mM4 = await j('/api/vencek/mine?dieta=' + filip._id, {}, jar.mama);
    ok('a vie prepnúť na Filipa', mM4.d.dieta && mM4.d.dieta.id === filip._id);
    const mM5 = await j('/api/vencek/mine?dieta=' + TOMAS, {}, jar.mama);
    ok('cudzie dieťa cez adresu neotvorí (ukáže prvé svoje)', mM5.d.dieta && mM5.d.dieta.id !== TOMAS, JSON.stringify(mM5.d.dieta && mM5.d.dieta.name));
    const cudziLink = await j('/api/vencek/dieta/pripojit', { method: 'POST', body: { token: 'ZLYTOKEN12' } }, jar.tomas);
    ok('neplatná pozvánka → 404', cudziLink.status === 404);


    console.log('\n9) Platba kartou len za pripojené dieťa:');
    const c0 = await j('/api/vencek/checkout', { method: 'POST', body: {} }, jar.mama);
    ok('pri dvoch deťoch sa appka opýta za ktoré', c0.status === 400 && /Vyberte, za ktoré dieťa/.test(c0.d.error), JSON.stringify(c0.d));
    const c1 = await j('/api/vencek/checkout', { method: 'POST', body: { dieta_id: TOMAS } }, jar.mama);
    ok('za cudzie dieťa nezaplatí', c1.status === 400 && /Vyberte/.test(c1.d.error), JSON.stringify(c1.d));
    const c2 = await j('/api/vencek/checkout', { method: 'POST', body: { dieta_id: EMA } }, jar.mama);
    ok('za Emu prejde až po Stripe (v teste falošný)', !/Vyberte|pripojte|skupine/.test(String(c2.d && c2.d.error)), JSON.stringify(c2.d));
    const c3 = await j('/api/vencek/checkout', { method: 'POST', body: {} }, nov);
    ok('rodič bez dieťaťa dostane návod', c3.status === 400 && /pripojte dieťa/.test(c3.d.error), JSON.stringify(c3.d));

    console.log('\n10) Webhook zapíše platbu raz, doklad ide rodičovi:');
    const ses = { id: 'cs_qa_rodic_1', object: 'checkout.session', payment_status: 'paid', status: 'complete', amount_total: 6500,
      customer_email: 'qa.rd.mama@qa-biz.local', metadata: { type: 'vencek', class_id: A, user_id: EMA, payer_id: MAMA } };
    const wh1 = await webhook({ id: 'evt_qa_rodic_1', type: 'checkout.session.completed', data: { object: ses } });
    ok('webhook prijatý', wh1.status === 200, wh1.status + ' ' + wh1.text);
    await sleep(1200);
    const wh2 = await webhook({ id: 'evt_qa_rodic_2', type: 'checkout.session.completed', data: { object: ses } });
    ok('druhé doručenie tiež 200', wh2.status === 200);
    await sleep(1200);
    const plE = rd('venceky_payments.db').filter(p => p.user_id === EMA);
    ok('platba je jedna, 65 €, kartou, zaplatila mama', plE.length === 1 && plE[0].amount === 65 && plE[0].method === 'stripe' && plE[0].payer_id === MAMA && plE[0].stripe_session_id === 'cs_qa_rodic_1', JSON.stringify(plE));
    const faM = rd('invoices.db').filter(i => i.client_email === 'qa.rd.mama@qa-biz.local');
    ok('faktúra je jedna, na mamu s menom dieťaťa', faM.length === 1 && /Mama Tanečná \(dieťa: Ema Tanečná\)/.test(faM[0].client_name) && Math.abs(faM[0].total - 65) < 0.01, JSON.stringify(faM.map(i => i.client_name + ' ' + i.total)));
    ok('na Emu faktúra nevznikla', !rd('invoices.db').some(i => i.client_email === 'qa.rd.ema@qa-biz.local'));
    ok('potvrdenie prišlo Eme aj mame', rd('notifications.db').some(n => n.user_id === EMA && /Potvrdenie o platbe/.test(n.title))
      && rd('notifications.db').some(n => n.user_id === MAMA && /Ema: venčekový kurz je uhradený/.test(n.title)));
    const mM6 = await j('/api/vencek/mine?dieta=' + EMA, {}, jar.mama);
    ok('mama vidí: uhradené, zaplatila ona', mM6.d.dieta.payment && mM6.d.dieta.payment.payer_name === 'Mama Tanečná', JSON.stringify(mM6.d.dieta.payment));
    const c4 = await j('/api/vencek/checkout', { method: 'POST', body: { dieta_id: EMA } }, jar.mama);
    ok('druhú platbu za Emu appka odmietne', c4.status === 400 && /už je uhradený \(Ema Tanečná\)/.test(c4.d.error), JSON.stringify(c4.d));

    console.log('\n11) Lektor zapíše hotovosť, iný tréner nie:');
    const n1 = await j('/api/vencek/lektor/platba', { method: 'POST', body: { class_id: B, user_id: LEA, method: 'cash' } }, jar.nelka);
    ok('Nelka (skupinu neučí) → 403', n1.status === 403, JSON.stringify(n1.d));
    const i0 = await j('/api/vencek/lektor/platba', { method: 'POST', body: { class_id: A, user_id: TOMAS, method: 'cash' } }, jar.iveta);
    ok('Iveta za cudziu skupinu → 403', i0.status === 403);
    const mv = await j('/api/vencek/lektor/platba', { method: 'POST', body: { class_id: B, user_id: LEA, method: 'cash' } }, jar.menovkyna);
    ok('klientka s rovnakým menom ako lektorka → 403', mv.status === 403, mv.status + '');
    ok('a lektorský prehľad nedostane', (await j('/api/vencek/mine', {}, jar.menovkyna)).d.role === null);
    const i1 = await j('/api/vencek/lektor/platba', { method: 'POST', body: { class_id: B, user_id: EMA, method: 'cash' } }, jar.iveta);
    ok('žiak z inej skupiny → 404', i1.status === 404);
    const i2 = await j('/api/vencek/lektor/platba', { method: 'POST', body: { class_id: B, user_id: LEA, method: 'cash' } }, jar.iveta);
    ok('Iveta zapíše hotovosť Ley (90 €)', i2.status === 200 && i2.d.amount === 90, JSON.stringify(i2.d));
    await sleep(900);
    const plL = rd('venceky_payments.db').filter(p => p.user_id === LEA);
    ok('platba: hotovosť, zapísala Iveta', plL.length === 1 && plL[0].method === 'cash' && plL[0].recorded_by === 'qaRdIveta000001' && !plL[0].payer_id, JSON.stringify(plL));
    ok('Marek dostal správu', rd('notifications.db').some(n => n.user_id === 'qaRdAdmin000001' && /Iveta Lektorová: venček 90,00 € — Lea/.test(n.title)));
    ok('mama Ley dostala potvrdenie', rd('notifications.db').some(n => n.user_id === lm._id && /Lea: venčekový kurz je uhradený/.test(n.title)));
    const faL = rd('invoices.db').filter(i => i.user_id === LEA);
    ok('doklad na Leu, hotovosť', faL.length === 1 && /Hotovosť/.test(faL[0].method || faL[0].payment_method || ''), JSON.stringify(faL.map(i => [i.client_name, i.method])));
    const i3 = await j('/api/vencek/lektor/platba', { method: 'POST', body: { class_id: B, user_id: LEA, method: 'cash' } }, jar.iveta);
    ok('druhý zápis → 400', i3.status === 400);
    const mI = await j('/api/vencek/mine', {}, jar.iveta);
    ok('Iveta vidí svoju skupinu a kto zaplatil', mI.d.role === 'lektor' && mI.d.classes.length === 1 && mI.d.classes[0].id === B && mI.d.classes[0].students[0].paid === true, JSON.stringify(mI.d).slice(0, 200));
    ok('Nelka venček nemá', (await j('/api/vencek/mine', {}, jar.nelka)).d.role === null);
    const aI = await j('/api/admin/venceky/attendance', { method: 'POST', body: { class_id: A, lesson_no: 2, absent: [] } }, jar.iveta);
    ok('Iveta nezapíše dochádzku cudzej skupine', aI.status === 403, aI.status + '');
    const aI2 = await j('/api/admin/venceky/attendance', { method: 'POST', body: { class_id: B, lesson_no: 1, absent: [] } }, jar.iveta);
    ok('svojej áno', aI2.status === 200, JSON.stringify(aI2.d));
    ok('Nelka ani zoznam dochádzky', (await j('/api/admin/venceky/attendance/' + B, {}, jar.nelka)).status === 403);

    console.log('\n12) Súhlas a odpojenie:');
    ok('súhlas za cudzie dieťa → 404', (await j('/api/vencek/rodic/suhlas', { method: 'POST', body: { dieta_id: TOMAS } }, jar.mama)).status === 404);
    const s1 = await j('/api/vencek/rodic/suhlas', { method: 'POST', body: { dieta_id: EMA } }, jar.mama);
    await sleep(500);
    ok('súhlas za Emu uložený s menom rodiča', s1.status === 200 && user(EMA).vencek_suhlas_rodica && user(EMA).vencek_suhlas_rodica.rodic_meno === 'Mama Tanečná', JSON.stringify(user(EMA).vencek_suhlas_rodica));
    ok('Ema vidí, že súhlas je', (await j('/api/vencek/mine', {}, jar.ema)).d.suhlas_rodica === true);
    const od = await j('/api/vencek/rodic/odpojit', { method: 'POST', body: { dieta_id: filip._id } }, jar.mama);
    await sleep(500);
    ok('mama odpojí Filipa', od.status === 200 && !(podlaMailu('qa.rd.filip@qa-biz.local').vencek_rodicia || []).includes(MAMA));
    ok('ostane jej jedno dieťa', ((await j('/api/vencek/mine', {}, jar.mama)).d.deti || []).length === 1);
    ok('cudzie dieťa neodpojí', (await j('/api/vencek/rodic/odpojit', { method: 'POST', body: { dieta_id: TOMAS } }, jar.mama)).status === 404);

    console.log('\n13) Admin vidí rodičov pri deťoch:');
    const det = await j('/api/admin/venceky/class/' + A, {}, jar.adm);
    const emaR = (det.d.members || []).find(m => m.id === EMA) || {};
    ok('pri Eme je mama a kto platil', (emaR.rodicia || []).join() === 'Mama Tanečná' && emaR.payer === 'Mama Tanečná', JSON.stringify({ r: emaR.rodicia, p: emaR.payer }));
    const rodA = det.d.parents || [];
    ok('v zozname rodičov mama s Emou, otec „nepripojené"', rodA.some(p => p.name === 'Mama Tanečná' && p.child === 'Ema Tanečná')
      && rodA.some(p => p.name === 'Otec Nepripojený' && /nepripojené/.test(p.child)), JSON.stringify(rodA));

    console.log('\n14) Pripomienka nezaplateného kurzu:');
    await j('/api/admin/qa/run-daily-tick?hour=9', { method: 'POST' }, jar.adm);
    await sleep(1500);
    const pripT = rd('notifications.db').filter(n => String(n.key || '').startsWith('vencek_platba:' + A + ':' + TOMAS));
    ok('Tomáš (nezaplatil, lekcia prebehla) dostal pripomienku', pripT.length === 1, JSON.stringify(pripT.map(n => n.title)));
    ok('Ema (zaplatené) nie', !rd('notifications.db').some(n => String(n.key || '').includes(':' + EMA + ':') && /vencek_platba/.test(n.key)));
    ok('Lea (zaplatené) nie', !rd('notifications.db').some(n => String(n.key || '').includes(':' + LEA + ':') && /vencek_platba/.test(n.key)));
    ok('Filip (nezaplatil) tiež', rd('notifications.db').some(n => n.user_id === filip._id && /vencek_platba/.test(n.key || '')));

    console.log('\n15) Obrazovky v prehliadači:');
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const stranka = async (k, cesta) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      if (k) { const [meno, hodnota] = jar[k].cookie.split('='); await ctx.addCookies([{ name: meno, value: hodnota, domain: 'localhost', path: '/' }]); }
      await ctx.addInitScript(() => { try { localStorage.setItem('fa_welcome_seen', '1'); } catch (e) {} });
      const p = await ctx.newPage(); p._chyby = []; p.on('pageerror', e => p._chyby.push(e.message));
      await p.goto(BASE + cesta, { waitUntil: 'domcontentloaded' });
      return p;
    };
    const pM = await stranka('mama', '/vencek?dieta=' + EMA);
    await pM.waitForSelector('#chatKarta', { timeout: 20000 });
    await sleep(800);
    const tM = await pM.evaluate(() => document.body.innerText);
    ok('rodič: meno dieťaťa, uhradené, dochádzka, chat', /Ema Tanečná/.test(tM) && /Kurz je uhradený/.test(tM) && /Dochádzka — Ema/.test(tM) && /Chat skupiny/.test(tM), tM.slice(0, 300));
    ok('rodič: súhlas už nepýta', !/Súhlas rodiča/.test(tM));
    ok('rodič: nevidí Tomáša', !/Tomáš/.test(tM));
    ok('rodič: bez chýb v JS', pM._chyby.length === 0, pM._chyby.join(' | '));
    if (SHOTS) await pM.screenshot({ path: path.join(SHOTS, 'rodic.png'), fullPage: true });

    const pO = await stranka(null, '/vencek?pripojit=' + kodT);
    await pO.waitForURL(/\/\?login=1/, { timeout: 15000 }).catch(() => {});
    ok('neprihlásený z odkazu → prihlásenie', /\?login=1/.test(pO.url()), pO.url());
    const ulozene = await pO.evaluate(() => localStorage.getItem('fa_po_prihlaseni'));
    ok('a zapamätá si, kam sa vrátiť', /pripojit=/.test(ulozene || ''), ulozene);
    await pO.waitForSelector('#lEmail', { state: 'visible', timeout: 15000 });
    await pO.fill('#lEmail', 'qa.rd.otec@qa-biz.local');
    await pO.fill('#lPass', 'Heslo123!');
    await pO.evaluate(() => doLogin());
    await pO.waitForURL(/\/vencek/, { timeout: 20000 }).catch(() => {});
    await pO.waitForSelector('.oznam', { timeout: 15000 }).catch(() => {});
    const tO = await pO.evaluate(() => (document.querySelector('.oznam') || {}).innerText || '');
    ok('po prihlásení sa otec pripojí k Tomášovi', /Tomáš Spolužiak/.test(tO) && (user(TOMAS).vencek_rodicia || []).length === 1, tO + ' | ' + pO.url());
    if (SHOTS) await pO.screenshot({ path: path.join(SHOTS, 'otec-po-prihlaseni.png'), fullPage: true });

    const pE = await stranka('ema', '/vencek');
    await pE.waitForSelector('.kod', { timeout: 20000 });
    const tE = await pE.evaluate(() => document.body.innerText);
    ok('žiak: karta Rodičia s kódom a menom mamy', /Rodičia/.test(tE) && tE.includes(kodE.d.kod) && /Mama Tanečná/.test(tE), '');
    ok('žiak: bez chýb v JS', pE._chyby.length === 0, pE._chyby.join(' | '));
    if (SHOTS) await pE.screenshot({ path: path.join(SHOTS, 'ziak.png'), fullPage: true });

    const pN = await stranka('zved', '/vencek');
    await sleep(2500);
    const tN = await pN.evaluate(() => document.body.innerText);
    ok('bez venčeka: pôvodná hláška', /nie je priradený/.test(tN), tN.slice(0, 120));

    const pX = await stranka(null, '/v/VEN-QARDA?dieta=' + kodE.d.kod);
    await pX.waitForSelector('#f', { timeout: 20000 });
    const tX = await pX.evaluate(() => ({ t: document.body.innerText, rola: document.getElementById('rola').value, login: document.querySelector('.pod a').getAttribute('href'), dieta: !!document.getElementById('dieta') }));
    ok('registrácia z odkazu dieťaťa: pozvánka, rola rodič, bez písania mena', /Pozvánka od vášho dieťaťa/.test(tX.t) && tX.rola === 'parent' && !tX.dieta, JSON.stringify({ r: tX.rola, d: tX.dieta }));
    ok('prihlásenie vedie späť na pripojenie', tX.login === '/vencek?pripojit=' + kodE.d.kod, tX.login);
    if (SHOTS) await pX.screenshot({ path: path.join(SHOTS, 'registracia-rodic.png'), fullPage: true });

    const pI = await stranka('iveta', '/vencek');
    await pI.waitForSelector('.uz', { timeout: 20000 });
    const tI = await pI.evaluate(() => ({ t: document.body.innerText, sw: document.querySelector('.switch').getAttribute('href') }));
    ok('lektor: skupina Hnúšťa, Lea zaplatené, späť do trénerského panela', /Hnúšťa QA/.test(tI.t) && /Lea Hnúšťanská/.test(tI.t) && /hotovosti/.test(tI.t) && tI.sw === '/trainer', tI.t.slice(0, 200));
    ok('lektor: bez chýb v JS', pI._chyby.length === 0, pI._chyby.join(' | '));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    await sleep(600);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nVENČEKY — RODIČIA: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-1200));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
