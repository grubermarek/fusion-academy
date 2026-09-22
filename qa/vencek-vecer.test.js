/**
 * Venčekový večer — príprava a program naživo (Marek 22. 9. 2026).
 *
 * „Jedna časť bude príprava na venčekový večer a druhá itinerár aj s timerom,
 * programom a scenárom. Postupne sa bude preklikávať od prvého po posledný bod
 * a celému tímu to bude cinkať. Nákupný zoznam s možnosťou zakliknúť, že už to
 * máme, alebo že je kúpená polovica. Zistíme, či je dohodnutý DJ, fotograf."
 *
 * Test stráži:
 *   · založenie prípravy zo šablóny (tím, nákup podľa počtu žiakov, program s naučenými tancami)
 *   · kto čo smie: admin všetko, člen tímu len stav položiek, riadiaci aj program, pozerač nič
 *   · že tím nevidí honoráre ani cudzie odkazy
 *   · stav položky ↔ počet (máme / časť / nemáme)
 *   · riadenie: štart, ďalší, dvojklik z dvoch telefónov neskočí o dva body, pauza, späť, koniec, správa
 *   · súbežné ťukanie z viacerých telefónov sa nestratí (zámok)
 *   · kúpené veci → náklady skupiny raz
 *   · obrazovky: admin sekcia, tímová stránka na 375 px, moderátor klikne → DJ-ovi sa zmení bod naživo
 *
 * Spustenie:  node qa/vencek-vecer.test.js      (QA_SHOTS=priečinok uloží screenshoty)
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4617;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-vecer-'));
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

const TRIEDA = 'qaVcTrieda00001', SKOLA = 'qaVcSkola000001';

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zakl = { password: hash, user_type: 'client', active: true, created_at: '2026-09-01' };
  const vT = { venceky_class_id: TRIEDA, venceky_school_id: SKOLA };
  w('users.db', [
    { _id: 'qaVcAdmin000001', name: 'Marek Gruber', email: 'qa.vc.admin@qa-biz.local', ...zakl, is_admin: true, user_type: 'admin' },
    { _id: 'qaVcKlient00001', name: 'Klientka Zvedavá', email: 'qa.vc.klient@qa-biz.local', ...zakl },
    { _id: 'qaVcZiak0000001', name: 'Ema Prvá', email: 'qa.vc.z1@qa-biz.local', ...zakl, ...vT, venceky_role: 'student' },
    { _id: 'qaVcZiak0000002', name: 'Tomáš Druhý', email: 'qa.vc.z2@qa-biz.local', ...zakl, ...vT, venceky_role: 'student' },
    { _id: 'qaVcZiak0000003', name: 'Lea Tretia', email: 'qa.vc.z3@qa-biz.local', ...zakl, ...vT },
    { _id: 'qaVcUcitel00001', name: 'Učiteľka Triedna', email: 'qa.vc.uc@qa-biz.local', ...zakl, ...vT, venceky_role: 'teacher' },
    { _id: 'qaVcRodic000001', name: 'Mama Prvá', email: 'qa.vc.ro@qa-biz.local', ...zakl, ...vT, venceky_role: 'parent' },
  ]);
  w('venceky_schools.db', [{ _id: SKOLA, name: 'Halíč QA', city: 'Halíč', year: '2026/27', created_at: '2026-09-01' }]);
  w('venceky_classes.db', [{ _id: TRIEDA, school_id: SKOLA, name: 'Venčeková skupina', year: '2026/27', code: 'VEN-QAVC',
    price: 49.9, lessons_total: 13, lessons_before: 10, lessons_done: 3, lecturer: 'Marek Gruber', event_date: '2026-12-12',
    event_venue: 'Dom kultúry Halíč QA', roles: ['student', 'teacher'], start_at: '2026-09-02T12:30:00.000Z',
    dances: [{ name: 'Waltz', level: 3 }, { name: 'Polka', level: 0 }, { name: 'Cha-cha', level: 2 }], created_at: '2026-09-01' }]);

  console.log('VENČEKOVÝ VEČER — PRÍPRAVA A PROGRAM NAŽIVO\n');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TZ: 'UTC', PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_SECRET_KEY: 'sk_test_qa_fake', STRIPE_FAKE: '1', NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await sleep(15000); // migrácie po štarte (zakladajú aj ďalšie venčekové skupiny)

  const jar = { adm: {}, kl: {} };
  let browser;
  try {
    await j('/api/login', { method: 'POST', body: { email: 'qa.vc.admin@qa-biz.local', password: 'Heslo123!' } }, jar.adm);
    await j('/api/login', { method: 'POST', body: { email: 'qa.vc.klient@qa-biz.local', password: 'Heslo123!' } }, jar.kl);
    const opA = (op, data) => j('/api/vecer/op', { method: 'POST', body: { id: VID, op, ...(data || {}) } }, jar.adm);
    const opT = (t, op, data) => j('/api/vecer/op', { method: 'POST', body: { t, op, ...(data || {}) } });
    let VID = null;

    console.log('1) Zoznam a založenie zo šablóny:');
    const z0 = await j('/api/admin/vecer/zoznam', {}, jar.adm);
    const moja0 = (z0.d.skupiny || []).find(s => s.class_id === TRIEDA);
    ok('skupina je v zozname bez prípravy, s počtom žiakov 3', moja0 && moja0.vecer === null && moja0.students === 3, JSON.stringify(moja0));
    ok('klientka zoznam nevidí', (await j('/api/admin/vecer/zoznam', {}, jar.kl)).status === 403);
    const zal = await j('/api/admin/vecer/zaloz', { method: 'POST', body: { class_id: TRIEDA } }, jar.adm);
    VID = zal.d && zal.d.id;
    ok('príprava založená', zal.status === 200 && VID && !zal.d.existed, JSON.stringify(zal.d));
    const zal2 = await j('/api/admin/vecer/zaloz', { method: 'POST', body: { class_id: TRIEDA } }, jar.adm);
    ok('druhé založenie vráti tú istú', zal2.d.existed && zal2.d.id === VID);
    ok('klientka založiť nemôže', (await j('/api/admin/vecer/zaloz', { method: 'POST', body: { class_id: TRIEDA } }, jar.kl)).status === 403);

    let A = (await j('/api/vecer/stav?id=' + VID, {}, jar.adm)).d;
    ok('admin vidí stav, riadi, má odkazy', A.ok && A.admin && A.can_control && A.team.every(m => m.link && m.token) && A.view_link, '');
    ok('dátum a miesto večera zo skupiny', A.event_date === '2026-12-12' && A.event_venue === 'Dom kultúry Halíč QA' && A.school === 'Halíč QA');
    const rola = r => A.team.find(m => m.role === r);
    ok('tím: 8 rolí vrátane DJ, fotografa, moderátora, kvetov, diplomov', ['lektor', 'moderator', 'dj', 'foto', 'kamera', 'kvety', 'diplomy', 'skola'].every(r => rola(r)) && A.team.length === 8);
    ok('tanečný majster = lektor skupiny, dohodnutý, riadi', rola('lektor').name === 'Marek Gruber' && rola('lektor').dohoda === 'dohodnute' && rola('lektor').can_control);
    ok('DJ a fotograf zatiaľ nedohodnutí', rola('dj').dohoda === 'hladame' && rola('foto').dohoda === 'hladame' && !rola('dj').can_control);
    ok('moderátor môže posúvať program', rola('moderator').can_control);
    const kvety = A.items.find(i => /Kvety pre rodičov/.test(i.name));
    ok('kvety pre rodičov = počet žiakov (3)', kvety && kvety.qty === 3 && kvety.stav === 'nie' && kvety.cat === 'nakup', JSON.stringify(kvety));
    ok('všetky tri kategórie prípravy', ['nakup', 'priprava', 'zbalit'].every(k => A.items.some(i => i.cat === k)));
    const tanceBody = A.program.filter(p => /^Tanec: /.test(p.title)).map(p => p.title);
    ok('program: bod za každý naučený tanec (Waltz, Cha-cha), nie za nenaučenú Polku', tanceBody.length === 2 && tanceBody.includes('Tanec: Waltz') && tanceBody.includes('Tanec: Cha-cha'), tanceBody.join(', '));
    ok('program má zodpovedných z tímu', A.program.every(p => p.who.every(id => A.team.some(m => m.id === id))) && A.program[0].who.length > 0);
    ok('bez začiatku programu nie sú plánované časy', A.program.every(p => p.plan === null));
    ok('stav večera: pred začiatkom', A.live.status === 'pred' && A.live.idx === -1);

    console.log('\n2) Prístup cez osobné odkazy:');
    const DJ = rola('dj'), MOD = rola('moderator'), KV = rola('kvety');
    let D = (await j('/api/vecer/stav?t=' + DJ.token)).d;
    ok('DJ sa dostane bez účtu a vie, kto je', D.ok && D.me && D.me.id === DJ.id && !D.admin && !D.can_control);
    ok('DJ nevidí honoráre ani cudzie odkazy', D.team.every(m => m.token === undefined && m.price === undefined && m.link === undefined) && !D.view_link && !D.admin_link);
    ok('v stave nie sú údaje žiakov', !/qa\.vc\.z1|Ema Prvá|Tomáš Druhý/.test(JSON.stringify(D)));
    const Mo = (await j('/api/vecer/stav?t=' + MOD.token)).d;
    ok('moderátor môže riadiť', Mo.can_control === true);
    const V = (await j('/api/vecer/stav?t=' + A.view_link.split('/').pop())).d;
    ok('odkaz na pozeranie: len čítanie', V.ok && V.read_only && !V.me && !V.can_control);
    ok('zlý odkaz → 404', (await j('/api/vecer/stav?t=zlyodkazzlyodkaz123')).status === 404);
    ok('klientka cez id nič nevidí', (await j('/api/vecer/stav?id=' + VID, {}, jar.kl)).status === 404);
    ok('stránka /vecer/<token> sa načíta', (await fetch(BASE + '/vecer/' + DJ.token)).status === 200);
    ok('stránka /vecer/a/<id> sa načíta', (await fetch(BASE + '/vecer/a/' + VID)).status === 200);

    console.log('\n3) Kto čo smie:');
    ok('DJ nemení program', (await opT(DJ.token, 'prog.set', { point: { title: 'Hack' } })).status === 403);
    ok('DJ neposúva program', (await opT(DJ.token, 'live.start')).status === 403);
    ok('DJ nemení tím', (await opT(DJ.token, 'team.set', { member: { id: DJ.id, can_control: true } })).status === 403);
    ok('DJ nemaže položky', (await opT(DJ.token, 'item.del', { item_id: kvety.id })).status === 403);
    ok('pozerač nemení ani nákup', (await opT(A.view_link.split('/').pop(), 'item.set', { item: { id: kvety.id, stav: 'ok' } })).status === 403);
    ok('neznáma akcia → 400', (await opT(DJ.token, 'rm.rf')).status === 400);
    ok('moderátor nevracia večer na začiatok', (await opT(MOD.token, 'live.reset')).status === 403);

    console.log('\n4) Nákup: stav ↔ počet:');
    let r = await opT(KV.token, 'item.set', { item: { id: kvety.id, stav: 'pol' } });
    let it = r.d.items.find(i => i.id === kvety.id);
    ok('„časť" pri 3 ks → 2 z 3, zapísané kto', it.stav === 'pol' && it.have === 2 && it.updated_by === 'Kvety', JSON.stringify(it));
    r = await opT(KV.token, 'item.set', { item: { id: kvety.id, have: 3 } });
    it = r.d.items.find(i => i.id === kvety.id);
    ok('počet 3/3 → máme', it.stav === 'ok' && it.have === 3);
    r = await opT(KV.token, 'item.set', { item: { id: kvety.id, have: 0 } });
    ok('počet 0 → nemáme', r.d.items.find(i => i.id === kvety.id).stav === 'nie');
    r = await opT(KV.token, 'item.set', { item: { id: kvety.id, stav: 'ok' } });
    ok('„máme" doplní počet', r.d.items.find(i => i.id === kvety.id).have === 3);
    const bezPoctu = A.items.find(i => i.cat === 'priprava');
    r = await opT(DJ.token, 'item.set', { item: { id: bezPoctu.id, stav: 'ok' } });
    ok('úloha bez počtu: len stav', r.d.items.find(i => i.id === bezPoctu.id).stav === 'ok');
    r = await opT(DJ.token, 'item.set', { item: { name: 'Lepiaca páska <b>', cat: 'zbalit', qty: 2 } });
    const nova = r.d.item;
    ok('člen tímu pridá položku (bez HTML)', nova && nova.name === 'Lepiaca páska b' && nova.cat === 'zbalit' && nova.qty === 2, JSON.stringify(nova));
    ok('prázdna položka sa nepridá', (await opT(DJ.token, 'item.set', { item: { name: '  ' } })).status === 400);
    r = await opA('item.del', { item_id: nova.id });
    ok('admin položku zmaže', !r.d.items.some(i => i.id === nova.id));

    console.log('\n5) Súbežné ťukanie z viacerých telefónov:');
    const naraz = A.items.filter(i => i.cat === 'zbalit').slice(0, 6);
    await Promise.all(naraz.map((i, k) => opT(k % 2 ? DJ.token : KV.token, 'item.set', { item: { id: i.id, stav: 'ok' } })));
    A = (await j('/api/vecer/stav?id=' + VID, {}, jar.adm)).d;
    ok('všetkých 6 zmien sa uložilo', naraz.every(i => A.items.find(x => x.id === i.id).stav === 'ok'), naraz.map(i => A.items.find(x => x.id === i.id).stav).join(','));

    console.log('\n6) Tím a program (admin):');
    r = await opA('team.set', { member: { id: DJ.id, name: 'DJ Peter', phone: '0900 123 456', dohoda: 'dohodnute', price: '250,5', zaloha: true } });
    const djPo = r.d.team.find(m => m.id === DJ.id);
    ok('DJ dohodnutý s menom, telefónom a honorárom', djPo.name === 'DJ Peter' && djPo.phone === '0900 123 456' && djPo.dohoda === 'dohodnute' && djPo.price === 250.5 && djPo.zaloha);
    r = await opA('team.set', { member: { role: 'pomoc', name: 'Jana' } });
    const jana = r.d.team[r.d.team.length - 1];
    ok('pridaný pomocník s vlastným odkazom', jana.name === 'Jana' && jana.role === 'pomoc' && jana.token && jana.token !== DJ.token);
    const prvy = A.program[0];
    await opA('prog.set', { point: { id: prvy.id, who: [...prvy.who, jana.id] } });
    r = await opA('team.del', { member_id: jana.id });
    ok('odobratý člen zmizne aj z bodov programu', !r.d.team.some(m => m.id === jana.id) && !r.d.program[0].who.includes(jana.id));
    ok('jeho odkaz prestane platiť', (await j('/api/vecer/stav?t=' + jana.token)).status === 404);
    r = await opA('meta.set', { start_time: '18:00', warn_min: 3 });
    ok('začiatok 18:00 → prvý bod 18:00, druhý 18:30', r.d.program[0].plan === '18:00' && r.d.program[1].plan === '18:30' && r.d.warn_min === 3, r.d.program.slice(0, 2).map(p => p.plan).join(','));
    const obc = r.d.program.find(p => /Prípitok/.test(p.title));
    r = await opA('prog.set', { point: { id: obc.id, at: '20:15' } });
    const iObc = r.d.program.findIndex(p => p.id === obc.id);
    ok('pevný čas: bod začne 20:15 a ďalší nadväzuje', r.d.program[iObc].plan === '20:15' && r.d.program[iObc + 1].plan === '21:00', r.d.program[iObc].plan + ' / ' + r.d.program[iObc + 1].plan);
    r = await opA('prog.set', { point: { title: 'Tombola', dur: 20, after: prvy.id, who: [DJ.id, 'neexistuje'] } });
    ok('nový bod vložený za prvý, len platní členovia', r.d.program[1].title === 'Tombola' && r.d.program[1].who.length === 1);
    const tomb = r.d.program[1];
    r = await opA('prog.move', { point_id: tomb.id, dir: -1 });
    ok('posun hore', r.d.program[0].id === tomb.id);
    r = await opA('prog.del', { point_id: tomb.id });
    ok('zmazanie bodu', !r.d.program.some(p => p.id === tomb.id));
    ok('neplatný čas sa neuloží', (await opA('meta.set', { start_time: '25:99' })).d.start_time === '');
    await opA('meta.set', { start_time: '18:00' });

    console.log('\n7) Náklady skupiny:');
    await opA('item.set', { item: { id: kvety.id, price: '42,5' } });
    const nie = A.items.find(i => i.cat === 'nakup' && i.stav === 'nie' && i.id !== kvety.id);
    await opA('item.set', { item: { id: nie.id, price: 10 } });
    r = await opA('items.costs');
    ok('zapíše len kúpené s cenou (1 × 42,50 €)', r.d.costs && r.d.costs.count === 1 && r.d.costs.total === 42.5, JSON.stringify(r.d.costs));
    const naklady = rd('venceky_costs.db').filter(k => k.vecer_id === VID);
    ok('náklad je v skupine', naklady.length === 1 && naklady[0].class_id === TRIEDA && naklady[0].amount === 42.5);
    r = await opA('items.costs');
    ok('druhý raz nič nové', r.d.costs.count === 0 && rd('venceky_costs.db').filter(k => k.vecer_id === VID).length === 1);

    console.log('\n8) Riadenie programu:');
    const n = A.program.length;
    r = await opT(MOD.token, 'live.start');
    ok('moderátor spustí program → bod 1', r.d.live.status === 'bezi' && r.d.live.idx === 0 && r.d.live.point_started_at);
    r = await opT(MOD.token, 'live.start');
    ok('druhý štart sa ignoruje', r.d.ignored && r.d.live.idx === 0);
    const [k1, k2] = await Promise.all([opT(MOD.token, 'live.next', { from: 0 }), opA('live.next', { from: 0 })]);
    A = (await j('/api/vecer/stav?id=' + VID, {}, jar.adm)).d;
    ok('moderátor aj Marek klikli naraz → posun len o jeden bod', A.live.idx === 1 && [k1.d.ignored, k2.d.ignored].filter(Boolean).length === 1, 'idx ' + A.live.idx);
    r = await opT(MOD.token, 'live.pause');
    ok('pauza', r.d.live.status === 'pauza' && r.d.live.paused_at);
    await sleep(1100);
    r = await opT(MOD.token, 'live.resume');
    ok('pokračovanie zaráta pauzu', r.d.live.status === 'bezi' && r.d.live.pause_ms >= 1000, String(r.d.live.pause_ms));
    r = await opT(MOD.token, 'live.prev', { from: 1 });
    ok('späť na bod 1', r.d.live.idx === 0 && r.d.live.pause_ms === 0);
    r = await opA('live.goto', { idx: n - 1 });
    ok('skok na posledný bod', r.d.live.idx === n - 1);
    r = await opT(MOD.token, 'live.msg', { text: 'Fotograf k parketu', to: [rola('foto').id, 'zly'] });
    ok('správa len fotografovi', r.d.live.msg.text === 'Fotograf k parketu' && r.d.live.msg.to.length === 1 && r.d.live.msg.from === 'Moderátor', JSON.stringify(r.d.live.msg));
    ok('DJ správu posielať nemôže', (await opT(DJ.token, 'live.msg', { text: 'ahoj' })).status === 403);
    r = await opT(MOD.token, 'live.next', { from: n - 1 });
    ok('ďalší za posledným bodom = koniec', r.d.live.status === 'koniec' && r.d.live.ended_at);
    const log = r.d.live.log;
    ok('záznam skutočných časov bodov', log.length >= 4 && log.every(z => z.start && z.end), JSON.stringify(log.map(z => !!z.end)));
    r = await opT(MOD.token, 'live.prev', { from: n - 1 });
    ok('omylom ukončený → späť vráti posledný bod', r.d.live.status === 'bezi' && r.d.live.idx === n - 1);
    r = await opA('live.reset');
    ok('admin vráti program na začiatok', r.d.live.status === 'pred' && r.d.live.idx === -1);
    const z1 = await j('/api/admin/vecer/zoznam', {}, jar.adm);
    const moja1 = z1.d.skupiny.find(s => s.class_id === TRIEDA);
    ok('zoznam: DJ dohodnutý, fotograf nie, príprava sa ráta', moja1.vecer.dj === 'dohodnute' && moja1.vecer.foto === 'hladame' && moja1.vecer.items_ok >= 8, JSON.stringify(moja1.vecer));

    console.log('\n9) Obrazovky v prehliadači:');
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const stranka = async (k, cesta, sirka) => {
      const ctx = await browser.newContext({ viewport: { width: sirka || 375, height: 812 }, serviceWorkers: 'block' });
      if (k) { const [meno, hodnota] = jar[k].cookie.split('='); await ctx.addCookies([{ name: meno, value: hodnota, domain: 'localhost', path: '/' }]); }
      const p = await ctx.newPage(); p._chyby = []; p.on('pageerror', e => p._chyby.push(e.message));
      await p.goto(BASE + cesta, { waitUntil: 'domcontentloaded' });
      return p;
    };
    const pDJ = await stranka(null, '/vecer/' + DJ.token);
    await pDJ.waitForSelector('#odomkni button', { timeout: 20000 });
    await pDJ.click('#odomkni .btn-hl');
    await pDJ.waitForFunction(() => /Pred začiatkom/i.test(document.getElementById('pTeraz').innerText), null, { timeout: 15000 });
    const tDJ = await pDJ.evaluate(() => ({ t: document.body.innerText, sirka: document.documentElement.scrollWidth, ovl: !!document.querySelector('.ovl') }));
    ok('DJ: vidí pred začiatkom, svoju rolu, bez ovládania', /DJ \/ ozvučenie/.test(tDJ.t) && /DJ Peter/.test(tDJ.t) && !tDJ.ovl, tDJ.t.slice(0, 200));
    ok('DJ: 375 px bez vodorovného posúvania', tDJ.sirka <= 375, String(tDJ.sirka));
    if (SHOTS) await pDJ.screenshot({ path: path.join(SHOTS, 'vecer-dj-pred.png'), fullPage: true });

    const pMO = await stranka(null, '/vecer/' + MOD.token);
    await pMO.waitForSelector('#odomkni button', { timeout: 20000 });
    await pMO.click('#odomkni .linka');
    await pMO.waitForSelector('.ovl .btn-hl', { timeout: 15000 });
    await pMO.click('.ovl .btn-hl'); // ▶ Začať program
    const prvyNazov = A.program[0].title;
    await pDJ.waitForFunction(t => document.getElementById('zostava') && (document.querySelector('#pTeraz .hlavna .bod-nazov') || {}).textContent === t, prvyNazov, { timeout: 8000 }).catch(() => {});
    const poStarte = await pDJ.evaluate(() => ({ nazov: (document.querySelector('#pTeraz .hlavna .bod-nazov') || {}).textContent, banner: !document.getElementById('banner').hidden, text: document.getElementById('bannerTxt').textContent,
      zost: (document.getElementById('zostava') || {}).textContent }));
    ok('moderátor klikol → DJ-ovi sa naživo zmenil bod', poStarte.nazov === prvyNazov, JSON.stringify(poStarte));
    ok('DJ dostal upozornenie (banner „si na rade", lebo hrá hudbu)', poStarte.banner && /Si na rade/.test(poStarte.text), poStarte.text);
    ok('beží odpočet', /^\d{2}:\d{2}$/.test(poStarte.zost || ''), poStarte.zost);
    if (SHOTS) await pDJ.screenshot({ path: path.join(SHOTS, 'vecer-dj-bezi.png'), fullPage: true });
    if (SHOTS) await pMO.screenshot({ path: path.join(SHOTS, 'vecer-moderator.png'), fullPage: true });
    await sleep(1600); // zámok proti dvojkliku
    await pMO.click('#bDalej');
    const druhy = A.program[1].title;
    await pDJ.waitForFunction(t => (document.querySelector('#pTeraz .bod-nazov') || {}).textContent === t, druhy, { timeout: 8000 }).catch(() => {});
    ok('ďalší bod sa prenesie tiež', await pDJ.evaluate(() => (document.querySelector('#pTeraz .bod-nazov') || {}).textContent) === druhy);
    await pDJ.click('.spodok button[data-tab="priprava"]');
    const segs = await pDJ.$$('#pPriprava .seg button.s-ok');
    ok('DJ vidí nákupný zoznam s tlačidlami', segs.length >= 20, String(segs.length));
    await pDJ.click('.spodok button[data-tab="tim"]');
    const tTim = await pDJ.evaluate(() => document.getElementById('pTim').innerText);
    ok('tím: fotograf „ešte nemáme", DJ dohodnutý', /Fotograf[\s\S]*ešte nemáme/i.test(tTim) && /DJ Peter/.test(tTim), tTim.slice(0, 200));
    ok('tímová stránka bez chýb v JS', pDJ._chyby.length === 0 && pMO._chyby.length === 0, [...pDJ._chyby, ...pMO._chyby].join(' | '));

    const pA = await stranka('adm', '/admin', 1280);
    await pA.waitForFunction(() => typeof show === 'function', null, { timeout: 20000 });
    await pA.evaluate(() => show('vecer'));
    await pA.waitForSelector('#vvDetail .vv-hlava', { timeout: 15000 });
    const tA = await pA.evaluate(() => ({ t: document.getElementById('s-vecer').innerText, hub: document.querySelectorAll('#s-vecer .pen-tab').length }));
    ok('admin: sekcia so záložkami Venčeky ↔ Venčekový večer', tA.hub === 2 && /Školy a skupiny/.test(tA.t));
    ok('admin: karta skupiny a upozornenie na nedohodnutého fotografa', /Halíč QA/.test(tA.t) && /Ešte nie je dohodnutý: [^\n]*Fotograf/.test(tA.t), tA.t.slice(0, 400));
    for (const k of ['tim', 'program', 'pult', 'priprava']) {
      await pA.evaluate(k => vvTab(k), k);
      await sleep(300);
    }
    await pA.evaluate(() => vvTab('program'));
    const tP = await pA.evaluate(() => document.querySelector('#vvDetail .vv-telo').innerText);
    ok('admin: program so začiatkom a pevným časom', /18:00/.test(tP) && /pevne 20:15/.test(tP), tP.slice(0, 200));
    if (SHOTS) await pA.screenshot({ path: path.join(SHOTS, 'vecer-admin-program.png'), fullPage: false });
    await pA.evaluate(() => vvTab('priprava'));
    await pA.click('#vvDetail .vv-pol .vv-seg button.s-pol');
    await sleep(600);
    ok('admin: ťuknutie na „Časť" sa uloží', (await j('/api/vecer/stav?id=' + VID, {}, jar.adm)).d.items[0].stav === 'pol');
    if (SHOTS) await pA.screenshot({ path: path.join(SHOTS, 'vecer-admin-priprava.png'), fullPage: false });
    await pA.evaluate(() => show('venceky'));
    ok('admin: Venčeky majú tú istú lištu', await pA.evaluate(() => document.querySelectorAll('#s-venceky .pen-tab.on').length === 1));
    ok('admin: bez chýb v JS', pA._chyby.length === 0, pA._chyby.join(' | '));

    console.log('\n10) Zmazanie:');
    ok('klientka zmazať nemôže', (await j('/api/admin/vecer/zmaz', { method: 'POST', body: { id: VID } }, jar.kl)).status === 403);
    r = await j('/api/admin/vecer/zmaz', { method: 'POST', body: { id: VID } }, jar.adm);
    ok('admin zmaže prípravu', r.status === 200 && !rd('vencek_vecery.db').length);
    ok('odkazy tímu prestanú platiť', (await j('/api/vecer/stav?t=' + DJ.token)).status === 404);
    ok('skupina ostala nedotknutá', rd('venceky_classes.db').some(c => c._id === TRIEDA));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    await sleep(600);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nVENČEKOVÝ VEČER: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-1500));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
