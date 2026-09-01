/**
 * Venčekový nábor v škole — celá reťaz od založenia školy po registráciu žiaka.
 *
 * Marek ide 2. 9. na prvý nábor a na produkcii nie je ešte ani jedna škola,
 * takže modul ide naostro po prvý raz. Test prechádza presne to, čo sa bude
 * diať v telocvični:
 *   škola → trieda (kód + QR) → žiak sa registruje cez kód → priradí sa
 *   → dostane uvítacie benefity → objaví sa v prehľade → platba sedí
 *
 * Plus prípady, ktoré v škole reálne nastanú:
 *   · rodič sa registruje za dieťa
 *   · učiteľ/riaditeľ čaká na schválenie (nesmie sa priradiť sám)
 *   · niekto sa zaregistruje bez kódu → dá sa dohľadať a priradiť ručne
 *   · zlý kód sa odmietne zrozumiteľne
 *
 * Spustenie:  node qa/vencek-nabor.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4569;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-ven-'));

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
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'),
    JSON.stringify({ _id: 'qaVenAdmin00001', name: 'Adam Admin', email: 'qa.ven.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }) + '\n');

  console.log('VENČEKOVÝ NÁBOR QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  const usr = mail => rd('users.db').find(u => String(u.email || '').toLowerCase() === mail);

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.ven.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    console.log('\n1) Založenie školy a triedy (robíš pred náborom alebo na mieste):');
    const sk = await j('/api/admin/venceky/schools', { method: 'POST',
      body: { name: 'ZŠ Kukučínova Detva', city: 'Detva', year: '2026/27' } }, adm);
    ok('škola sa založí', sk.status === 200 && sk.d && sk.d.school && sk.d.school._id, JSON.stringify(sk.d).slice(0, 110));
    const sid = sk.d.school._id;
    // Kód visí na skupine — škola bez nej je slepá ulička, tak vzniká rovno so školou.
    ok('a rovno s ňou aj skupina', !!(sk.d.class && sk.d.class._id), JSON.stringify(sk.d.class || null).slice(0, 90));
    ok('kód sa odvodí z mesta', sk.d.class && sk.d.class.code === 'VEN-DETVA', sk.d.class && sk.d.class.code);
    ok('a registrovať sa smie žiak a učiteľ', sk.d.class && JSON.stringify(sk.d.class.roles) === JSON.stringify(['student', 'teacher']),
      JSON.stringify(sk.d.class && sk.d.class.roles));
    // Odkaz vedie na vlastnú venčekovú stránku, nie na hlavnú — tá predáva
    // Zumbu dospelým a ôsmakovi po naskenovaní QR nehovorí nič.
    ok('odkaz vedie na venčekovú registráciu', sk.d.join_link === BASE + '/v/VEN-DETVA', String(sk.d.join_link));
    const strankaR = await fetch(BASE + '/v/VEN-DETVA');
    ok('a tá stránka existuje', strankaR.status === 200, 'HTTP ' + strankaR.status);
    const telo = await strankaR.text();
    ok('nie je to hlavná stránka („Nájdi svoj rytmus")', !/Nájdi svoj/i.test(telo) && /Venček/i.test(telo));
    const hlavna = await (await fetch(BASE + '/?vencek=VEN-DETVA')).text();
    ok('staré vytlačené QR (?vencek=) sa presmerujú', /location\.replace\('\/v\/'/.test(hlavna));
    // Venčekový večer je po 10. lekcii, zvyšné 3 sú bonus po ňom.
    ok('kurz má 13 lekcií, ale do venčeka ich je 10',
      sk.d.class && sk.d.class.lessons_total === 13 && sk.d.class.lessons_before === 10,
      sk.d.class ? sk.d.class.lessons_before + '/' + sk.d.class.lessons_total : '—');

    const tr = await j('/api/admin/venceky/classes', { method: 'POST',
      body: { school_id: sid, name: '9.A', price: 49.90, lessons_total: 13, lecturer: 'Marek Gruber' } }, adm);
    ok('trieda sa založí', tr.status === 200 && tr.d && tr.d.class, JSON.stringify(tr.d).slice(0, 110));
    const kod = tr.d.class && tr.d.class.code;
    ok('trieda dostane kód VEN-XXXXX', /^VEN-[A-Z0-9]{5}$/.test(String(kod)), String(kod));
    ok('a registračný odkaz pre žiakov', tr.d.join_link === BASE + '/v/' + kod, String(tr.d.join_link));
    ok('cena aj počet hodín sedia', tr.d.class.price === 49.9 && tr.d.class.lessons_total === 13,
      tr.d.class.price + ' € · ' + tr.d.class.lessons_total + ' hodín');

    console.log('\n1b) Tance, ktoré sa učia:');
    const TANCE = ['Waltz','Cha-cha','Tango','Jive','Valčík','Polka','Samba',
      'Salsa','Bachata','Quickstep','Slowfox','Čardáš','Merengue','Zumba'];
    const infoT = (await j('/api/vencek/info?code=VEN-DETVA', {}, {})).d;
    ok('skupina dostane všetkých 14 tancov v poradí',
      infoT && JSON.stringify(infoT.dances) === JSON.stringify(TANCE),
      JSON.stringify(infoT && infoT.dances));
    ok('a všetky začínajú ako nezačaté',
      (sk.d.class.dances || []).every(x => (x.level || 0) === 0),
      JSON.stringify((sk.d.class.dances || []).map(x => x.level)));

    // Marek po hodine označí, čo už vedia — žiakom to má pribudnúť medzi zvládnuté.
    const zapis = await j('/api/admin/venceky/progress', { method: 'POST', body: {
      class_id: sk.d.class._id, lessons_done: 2,
      dances: TANCE.map((n, i) => ({ name: n, level: i === 0 ? 4 : (i === 1 ? 2 : 0) })) } }, adm);
    ok('zápis hodiny prejde', zapis.status === 200, JSON.stringify(zapis.d).slice(0, 90));
    await new Promise(r => setTimeout(r, 600));
    const poZapise = rd('venceky_classes.db').find(x => x._id === sk.d.class._id);
    ok('Waltz je označený ako zvládnutý', poZapise && poZapise.dances[0].level === 4,
      poZapise ? String(poZapise.dances[0].level) : '—');
    ok('Cha-cha je rozrobená, zvyšok nezačatý',
      poZapise && poZapise.dances[1].level === 2 && poZapise.dances[2].level === 0);
    ok('a percento pokroku sa prepočítalo',
      (await j('/api/admin/venceky/class/' + sk.d.class._id, {}, adm)).d.class.progress > 0);

    console.log('\n2) Žiak sa registruje cez kód z QR:');
    const z1 = {};
    const rz = await j('/api/register', { method: 'POST', body: { name: 'Zuzka Ziacka',
      email: 'qa.ven.ziak@qa-biz.local', password: 'Heslo123!', city: 'Detva', consent: true,
      vencek_code: kod, vencek_role: 'student' } }, z1);
    ok('registrácia prejde', rz.status === 200 || rz.status === 201, JSON.stringify(rz.d).slice(0, 110));
    await new Promise(r => setTimeout(r, 700));
    const zu = usr('qa.ven.ziak@qa-biz.local');
    ok('žiak je priradený k triede', zu && zu.venceky_class_id === tr.d.class._id, zu ? String(zu.venceky_class_id) : 'účet nenájdený');
    ok('aj ku škole', zu && zu.venceky_school_id === sid);
    ok('s rolou žiak', zu && zu.venceky_role === 'student', zu ? String(zu.venceky_role) : '—');
    ok('dostal 1× Zumbu zdarma', zu && zu.free_credits === 1, zu ? String(zu.free_credits) : '—');
    const promo = rd('promo_codes.db').find(p => p.code === 'VENCEKRODIC');
    ok('kupón VENCEKRODIC vznikol (mesiac Zumby zadarmo)', !!promo && promo.value === 100,
      promo ? promo.value + '% na ' + promo.applies_to : 'kupón nevznikol');
    const nz = rd('notifications.db').filter(n => n.user_id === (zu || {})._id);
    ok('a vie o tom z notifikácie', nz.some(n => /Vitaj vo Fusion Ven/i.test(n.title || '')),
      JSON.stringify(nz.map(n => n.title)).slice(0, 120));

    console.log('\n3) Rodič sa registruje za dieťa:');
    const r2 = await j('/api/register', { method: 'POST', body: { name: 'Renata Rodicova',
      email: 'qa.ven.rodic@qa-biz.local', password: 'Heslo123!', city: 'Detva', consent: true,
      vencek_code: kod, vencek_role: 'parent', vencek_child_name: 'Zuzka Ziacka' } }, {});
    ok('registrácia rodiča prejde', r2.status === 200 || r2.status === 201, JSON.stringify(r2.d).slice(0, 100));
    await new Promise(r => setTimeout(r, 600));
    const ru = usr('qa.ven.rodic@qa-biz.local');
    ok('rodič je v triede s rolou rodič', ru && ru.venceky_role === 'parent', ru ? String(ru.venceky_role) : '—');
    ok('a je vidieť, koho je rodič', ru && ru.vencek_child_name === 'Zuzka Ziacka', ru ? String(ru.vencek_child_name) : '—');

    console.log('\n4) Učiteľka sa registruje (nesmie si dať prístup sama):');
    const r3 = await j('/api/register', { method: 'POST', body: { name: 'Ucitelka Uciteliakova',
      email: 'qa.ven.ucitel@qa-biz.local', password: 'Heslo123!', city: 'Detva', consent: true,
      vencek_code: kod, vencek_role: 'teacher' } }, {});
    ok('registrácia prejde', r3.status === 200 || r3.status === 201, JSON.stringify(r3.d).slice(0, 100));
    await new Promise(r => setTimeout(r, 600));
    const uu = usr('qa.ven.ucitel@qa-biz.local');
    ok('učiteľka NEMÁ prístup hneď', uu && !uu.venceky_role, uu ? String(uu.venceky_role) : '—');
    ok('ale čaká v rade na schválenie', uu && uu.vencek_pending_role === 'teacher', uu ? String(uu.vencek_pending_role) : '—');
    const adminNotif = rd('notifications.db').filter(n => n.user_id === 'qaVenAdmin00001' && n.type === 'venceky');
    ok('a ty o tom dostaneš notifikáciu', adminNotif.some(n => /schválenie/i.test(n.title || '')),
      JSON.stringify(adminNotif.map(n => n.title)).slice(0, 130));

    console.log('\n5) Zlý kód (preklep pri prepisovaní z tabule):');
    const zle = await j('/api/register', { method: 'POST', body: { name: 'Preklep Preklepovy',
      email: 'qa.ven.preklep@qa-biz.local', password: 'Heslo123!', city: 'Detva', consent: true,
      vencek_code: 'VEN-XXXXX', vencek_role: 'student' } }, {});
    ok('registrácia sa odmietne', zle.status === 400, 'HTTP ' + zle.status);
    ok('a povie prečo', zle.d && /kód/i.test(String(zle.d.error || '')), JSON.stringify(zle.d));

    console.log('\n6) Kto sa zaregistroval bez kódu — priradíš ho ručne:');
    await j('/api/register', { method: 'POST', body: { name: 'Bezkodu Bezkodova',
      email: 'qa.ven.bezkodu@qa-biz.local', password: 'Heslo123!', city: 'Detva', consent: true } }, {});
    await new Promise(r => setTimeout(r, 500));
    const pr = await j('/api/admin/venceky/assign-student', { method: 'POST',
      body: { class_id: tr.d.class._id, query: 'qa.ven.bezkodu@qa-biz.local', role: 'student' } }, adm);
    ok('ručné priradenie prejde', pr.status === 200 && pr.d && pr.d.assigned, JSON.stringify(pr.d).slice(0, 120));
    await new Promise(r => setTimeout(r, 500));
    const bu = usr('qa.ven.bezkodu@qa-biz.local');
    ok('a je v triede', bu && bu.venceky_class_id === tr.d.class._id, bu ? String(bu.venceky_class_id) : '—');

    console.log('\n7) Prehľad a peniaze:');
    const ov = (await j('/api/admin/venceky/overview', {}, adm)).d;
    const skola = ov && Array.isArray(ov.schools) ? ov.schools.find(s => s.id === sid) : null;
    // Škola má aj skupinu, ktorá vznikla s ňou — vyberáme tú našu podľa id.
    const trieda = skola && Array.isArray(skola.classes) ? skola.classes.find(x => x.id === tr.d.class._id) : null;
    ok('a počíta žiakov (2: cez kód + ručne)', trieda && trieda.members === 2,
      trieda ? 'members=' + trieda.members : '—');

    const pay = await j('/api/admin/venceky/payment', { method: 'POST',
      body: { class_id: tr.d.class._id, user_id: (zu || {})._id, amount: 49.90, method: 'cash' } }, adm);
    ok('platba za žiaka sa zapíše', pay.status === 200 && pay.d && pay.d.ok !== false, JSON.stringify(pay.d).slice(0, 110));
    await new Promise(r => setTimeout(r, 600));
    const ov2 = (await j('/api/admin/venceky/overview', {}, adm)).d;
    const t2 = ov2 && Array.isArray(ov2.schools) ? (ov2.schools.find(x => x.id === sid) || {classes:[]}).classes.find(x => x.id === tr.d.class._id) : null;
    ok('a je vidieť v tržbe triedy', t2 && +t2.income >= 49.9, t2 ? 'income=' + t2.income + ' € · zaplatilo ' + t2.paid + ' z ' + t2.members : '—');

    console.log('\n8) Skupina s obmedzenými rolami (Halíč: len žiak a učiteľ):');
    const hal = await j('/api/admin/venceky/classes', { method: 'POST',
      body: { school_id: sid, name: 'Venčeková skupina', price: 49.90, lecturer: 'Marek Gruber',
        roles: ['student', 'teacher'] } }, adm);
    ok('skupina sa založí s obmedzením', hal.status === 200 && hal.d && hal.d.class, JSON.stringify(hal.d).slice(0, 100));
    const hkod = hal.d.class && hal.d.class.code;

    const info = await j('/api/vencek/info?code=' + hkod, {}, {});
    ok('registračná stránka zistí, čo je za kódom', info.status === 200 && info.d && info.d.ok, JSON.stringify(info.d).slice(0, 110));
    ok('a dostane len povolené role', info.d && JSON.stringify(info.d.roles) === JSON.stringify(['student', 'teacher']),
      JSON.stringify(info.d && info.d.roles));
    ok('aj názov školy a skupiny', info.d && /Kuku/.test(info.d.school || '') && info.d.name === 'Venčeková skupina',
      JSON.stringify([info.d && info.d.school, info.d && info.d.name]));

    const podvod = await j('/api/register', { method: 'POST', body: { name: 'Podvod Podvodnik',
      email: 'qa.ven.podvod@qa-biz.local', password: 'Heslo123!', city: 'Detva', consent: true,
      vencek_code: hkod, vencek_role: 'director' } }, {});
    ok('kto pošle nepovolenú rolu, dostane prvú povolenú', podvod.status === 200 || podvod.status === 201, JSON.stringify(podvod.d).slice(0, 90));
    await new Promise(r => setTimeout(r, 600));
    const pu = usr('qa.ven.podvod@qa-biz.local');
    ok('takže riaditeľom sa nestal', pu && pu.venceky_role === 'student' && !pu.vencek_pending_role,
      pu ? (pu.venceky_role + ' / pending=' + pu.vencek_pending_role) : '—');

    console.log('\n7c) Platba kartou (Stripe nie je v QA nakonfigurovaný — stráži sa, koho vôbec pustí):');
    const ziak = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.ven.ziak@qa-biz.local', password: 'Heslo123!' } }, ziak);
    const platba = await j('/api/vencek/checkout', { method: 'POST', body: {} }, ziak);
    ok('žiak platbu vyvolá (bez kľúča skončí zrozumiteľne)', platba.status === 400 && /Stripe|kartou/i.test(String(platba.d && platba.d.error)),
      'HTTP ' + platba.status + ' ' + JSON.stringify(platba.d));
    const rodic = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.ven.rodic@qa-biz.local', password: 'Heslo123!' } }, rodic);
    const platbaR = await j('/api/vencek/checkout', { method: 'POST', body: {} }, rodic);
    ok('rodič sa odmietne (kurz sa platí cez účet žiaka)', platbaR.status === 400,
      'HTTP ' + platbaR.status + ' ' + JSON.stringify(platbaR.d).slice(0, 90));
    const nikto = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.ven.admin@qa-biz.local', password: 'Heslo123!' } }, nikto);
    const platbaA = await j('/api/vencek/checkout', { method: 'POST', body: {} }, nikto);
    ok('kto nie je v skupine, platbu nevyvolá', platbaA.status === 400,
      'HTTP ' + platbaA.status + ' ' + JSON.stringify(platbaA.d).slice(0, 90));
    const podvrh = await j('/api/vencek/verify', { method: 'POST', body: { session_id: 'cs_vymyslene_123' } }, ziak);
    ok('podvrhnuté session_id platbu nezaloží', podvrh.status >= 400,
      'HTTP ' + podvrh.status + ' ' + JSON.stringify(podvrh.d).slice(0, 90));
    ok('a v databáze po ňom nič nie je', rd('venceky_payments.db').filter(p => p.method === 'stripe').length === 0,
      JSON.stringify(rd('venceky_payments.db').map(p => p.method)));

    console.log('\n7b) Admin si pozrie skupinu očami žiaka:');
    const mojPrehlad = (await j('/api/vencek/mine', {}, adm)).d;
    ok('admin vidí prehľad škôl', mojPrehlad && mojPrehlad.role === 'admin' && Array.isArray(mojPrehlad.schools),
      JSON.stringify(mojPrehlad && Object.keys(mojPrehlad)));
    const nahlad = (await j('/api/vencek/mine?ako=student&class_id=' + tr.d.class._id, {}, adm)).d;
    ok('a vie sa prepnúť do žiackeho pohľadu', nahlad && nahlad.role === 'student' && nahlad.preview === true,
      JSON.stringify(nahlad && { role: nahlad.role, preview: nahlad.preview }));
    ok('náhľad nesie tance aj s popisom úrovne', nahlad && nahlad.class && Array.isArray(nahlad.class.dances)
      && nahlad.class.dances.every(x => 'level_label' in x),
      JSON.stringify(nahlad && nahlad.class && (nahlad.class.dances || []).slice(0, 1)));
    ok('a nevydáva cudziu platbu za jeho', nahlad && nahlad.my_payment === null && nahlad.my_attendance === null,
      JSON.stringify(nahlad && [nahlad.my_payment, nahlad.my_attendance]));
    const cudzi = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.ven.ziak@qa-biz.local', password: 'Heslo123!' } }, cudzi);
    const pokus = (await j('/api/vencek/mine?ako=student&class_id=' + tr.d.class._id, {}, cudzi)).d;
    ok('kto nie je admin, náhľad nedostane', pokus && pokus.preview !== true,
      JSON.stringify(pokus && { role: pokus.role, preview: pokus.preview }));

    console.log('\n8b) Vlastný kód skupiny (nech sa dá prepísať z papiera):');
    const vlastny = await j('/api/admin/venceky/classes', { method: 'POST',
      body: { school_id: sid, name: 'Skupina s kódom', price: 49.90, code: 'halic' } }, adm);
    ok('kód sa dá zadať a normalizuje sa', vlastny.status === 200 && vlastny.d.class && vlastny.d.class.code === 'VEN-HALIC',
      vlastny.d && vlastny.d.class ? vlastny.d.class.code : JSON.stringify(vlastny.d));
    const duplik = await j('/api/admin/venceky/classes', { method: 'POST',
      body: { school_id: sid, name: 'Druhá s tým istým', price: 49.90, code: 'VEN-HALIC' } }, adm);
    ok('ten istý kód druhýkrát neprejde', duplik.status === 400, 'HTTP ' + duplik.status + ' ' + JSON.stringify(duplik.d).slice(0, 80));
    const kratky = await j('/api/admin/venceky/classes', { method: 'POST',
      body: { school_id: sid, name: 'Prikrátky', price: 49.90, code: 'AB' } }, adm);
    ok('prikrátky kód sa odmietne', kratky.status === 400, 'HTTP ' + kratky.status);

    console.log('\n9) Preklik v role — prepnutie v admine:');
    const zmena = await j('/api/admin/venceky/member-role', { method: 'POST',
      body: { user_id: (pu || {})._id, class_id: hal.d.class._id, role: 'teacher' } }, adm);
    ok('prepnutie prejde', zmena.status === 200 && zmena.d && zmena.d.ok, JSON.stringify(zmena.d).slice(0, 100));
    await new Promise(r => setTimeout(r, 600));
    const pu2 = usr('qa.ven.podvod@qa-biz.local');
    ok('a človek je teraz učiteľ', pu2 && pu2.venceky_role === 'teacher', pu2 ? String(pu2.venceky_role) : '—');
    ok('ostáva v tej istej skupine', pu2 && pu2.venceky_class_id === hal.d.class._id);
    const det = (await j('/api/admin/venceky/class/' + hal.d.class._id, {}, adm)).d;
    ok('a je vidieť v detaile skupiny medzi učiteľmi', det && Array.isArray(det.staff) && det.staff.some(t => t.id === pu2._id),
      JSON.stringify(det && det.staff));

    const dolu = await j('/api/admin/venceky/member-role', { method: 'POST',
      body: { user_id: (pu || {})._id, class_id: hal.d.class._id, role: 'none' } }, adm);
    ok('dá sa aj úplne odobrať z venčekov', dolu.status === 200, JSON.stringify(dolu.d).slice(0, 90));
    await new Promise(r => setTimeout(r, 600));
    const pu3 = usr('qa.ven.podvod@qa-biz.local');
    ok('účet v appke mu ostane, len bez skupiny', pu3 && !pu3.venceky_role && !pu3.venceky_class_id,
      pu3 ? (pu3.venceky_role + ' / ' + pu3.venceky_class_id) : 'účet zmizol');

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nVENČEKOVÝ NÁBOR: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
