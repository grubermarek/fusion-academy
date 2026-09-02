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

    console.log('\n1d) Rozvrh — prvá lekcia a týždenné opakovanie:');
    const START = '2026-09-09T14:00:00.000Z';
    await j('/api/admin/venceky/progress', { method: 'POST',
      body: { class_id: sk.d.class._id, start_at: START } }, adm);
    await new Promise(r => setTimeout(r, 400));
    const detR = (await j('/api/admin/venceky/class/' + sk.d.class._id, {}, adm)).d;
    const T = (detR && detR.class && detR.class.terminy) || [];
    ok('vygeneruje sa 13 termínov', T.length === 13, 'termínov: ' + T.length);
    ok('prvý sedí s tým, čo si zadal', T[0] && T[0].at === START, T[0] && T[0].at);
    ok('druhý je presne o týždeň neskôr',
      T[1] && (new Date(T[1].at) - new Date(T[0].at)) === 7 * 86400000,
      T[1] && T[1].at);
    ok('posledné tri sú označené ako bonus',
      T.slice(-3).every(x => x.bonus) && !T[9].bonus,
      JSON.stringify(T.map(x => x.bonus ? 'B' : '.').join('')));

    // Pri prechode na zimný čas má týždeň 169 hodín. Keby sa termíny počítali
    // cez milisekundy, lekcie od konca októbra by vyšli o hodinu skôr.
    const cezZimnyCas = await j('/api/admin/venceky/progress', { method: 'POST',
      body: { class_id: sk.d.class._id, start_at: '2026-09-10T13:00:00' } }, adm);
    ok('rozvrh cez zmenu času sa uloží', cezZimnyCas.status === 200);
    await new Promise(r => setTimeout(r, 400));
    const TZ = ((await j('/api/admin/venceky/class/' + sk.d.class._id, {}, adm)).d.class.terminy) || [];
    const hodiny = TZ.filter(x => x.at).map(x => new Date(x.at).getHours());
    ok('všetky lekcie držia rovnaký čas aj po zmene na zimný čas',
      new Set(hodiny).size === 1, 'hodiny: ' + [...new Set(hodiny)].join(', '));
    // vráť pôvodný začiatok, nech ďalšie kontroly sedia
    await j('/api/admin/venceky/progress', { method: 'POST', body: { class_id: sk.d.class._id, start_at: START } }, adm);
    await new Promise(r => setTimeout(r, 300));

    console.log('\n1e) Presun a zrušenie jednej lekcie:');
    const presun = await j('/api/admin/venceky/lesson-change', { method: 'POST',
      body: { class_id: sk.d.class._id, week: 1, at: '2026-09-18T16:30:00.000Z' } }, adm);
    ok('lekcia sa presunie', presun.status === 200 && presun.d && presun.d.ok, JSON.stringify(presun.d).slice(0, 80));
    const T2 = (presun.d && presun.d.terminy) || [];
    ok('má nový čas a je označená ako presunutá',
      T2[1] && T2[1].at === '2026-09-18T16:30:00.000Z' && T2[1].moved === true,
      JSON.stringify(T2[1]));
    ok('ostatné termíny sa nepohli', T2[2] && T2[2].at === T[2].at, T2[2] && T2[2].at);

    const zrus = await j('/api/admin/venceky/lesson-change', { method: 'POST',
      body: { class_id: sk.d.class._id, week: 3, cancelled: true, reason: 'prázdniny' } }, adm);
    ok('lekcia sa dá zrušiť', zrus.status === 200, JSON.stringify(zrus.d).slice(0, 70));
    const T3 = (zrus.d && zrus.d.terminy) || [];
    ok('zrušený týždeň je označený a nemá číslo lekcie',
      T3[3] && T3[3].cancelled === true && !T3[3].lesson, JSON.stringify(T3[3]));
    ok('a kurz sa predĺžil o týždeň — stále je 13 lekcií',
      T3.filter(x => !x.cancelled).length === 13, 'lekcií: ' + T3.filter(x => !x.cancelled).length);
    ok('posledná lekcia je teda o týždeň neskôr než predtým',
      new Date(T3[T3.length - 1].at) - new Date(T[T.length - 1].at) === 7 * 86400000,
      T3[T3.length - 1].at + ' vs ' + T[T.length - 1].at);
    // Notifikáciu o zmene rozvrhu skúšame až v sekcii 9d — tu v skupine
    // ešte nikto nie je, takže by nemala komu prísť.

    const vratit = await j('/api/admin/venceky/lesson-change', { method: 'POST',
      body: { class_id: sk.d.class._id, week: 3, reset: true } }, adm);
    const T4 = (vratit.d && vratit.d.terminy) || [];
    ok('zrušenie sa dá vrátiť späť', !T4.some(x => x.cancelled) && T4.length === 13,
      'termínov: ' + T4.length);

    console.log('\n1c) Kiosk na nábor:');
    const kioskR = await fetch(BASE + '/vk/VEN-DETVA');
    ok('kiosk sa otvorí', kioskR.status === 200, 'HTTP ' + kioskR.status);
    const kioskTelo = await kioskR.text();
    ok('a ťahá QR z nášho endpointu, nie z cudzej služby',
      /\/api\/qr\.png/.test(kioskTelo) && !/qrserver\.com/.test(kioskTelo));
    ok('QR vedie na registráciu tej skupiny',
      /path=\$\{encodeURIComponent\('\/v\/'\+KOD\)\}/.test(kioskTelo));
    const infoK = (await j('/api/vencek/info?code=VEN-DETVA', {}, {})).d;
    ok('kiosk vie, koľko ich je zaregistrovaných', infoK && typeof infoK.registered === 'number',
      JSON.stringify(infoK && infoK.registered));
    ok('a nedostane pritom mená', !/qa\.ven\./.test(JSON.stringify(infoK)));

    console.log('\n1b) Tance, ktoré sa učia:');
    const TANCE = ['Waltz','Cha-cha','Tango','Jive','Valčík','Polka','Samba',
      'Salsa','Bachata','Quickstep','Slowfox','Čardáš','Merengue','Blues','Zumba'];
    const infoT = (await j('/api/vencek/info?code=VEN-DETVA', {}, {})).d;
    ok('skupina dostane všetkých 15 tancov v poradí',
      infoT && JSON.stringify(infoT.dances) === JSON.stringify(TANCE),
      JSON.stringify(infoT && infoT.dances));
    ok('a všetky začínajú ako nezačaté',
      (sk.d.class.dances || []).every(x => (x.level || 0) === 0),
      JSON.stringify((sk.d.class.dances || []).map(x => x.level)));

    // Marek zapíše po lekciách, čo sa učilo — tanec sa tým žiakom označí ako
    // zvládnutý, úrovne 0–4 klikať netreba.
    const zapis = await j('/api/admin/venceky/lesson-log', { method: 'POST', body: {
      class_id: sk.d.class._id, lesson: 1, dances: ['Waltz'], note: 'základné kroky' } }, adm);
    ok('zápis lekcie prejde', zapis.status === 200 && zapis.d && zapis.d.ok, JSON.stringify(zapis.d).slice(0, 90));
    await j('/api/admin/venceky/lesson-log', { method: 'POST', body: {
      class_id: sk.d.class._id, lesson: 2, dances: ['Cha-cha', 'Tango'], note: '' } }, adm);
    await new Promise(r => setTimeout(r, 500));
    const poLog = (await j('/api/admin/venceky/class/' + sk.d.class._id, {}, adm)).d;
    ok('zapísané tance sú označené ako zvládnuté',
      (poLog.class.dances || []).filter(x => x.level >= 4).map(x => x.name).sort().join() === 'Cha-cha,Tango,Waltz',
      JSON.stringify((poLog.class.dances || []).filter(x => x.level >= 4).map(x => x.name)));
    ok('a zvyšok zoznamu ostal nezačatý',
      (poLog.class.dances || []).filter(x => !x.level).length === 12,
      String((poLog.class.dances || []).filter(x => !x.level).length));
    ok('odučené lekcie sa dopočítali z denníka', poLog.class.lessons_done === 2,
      String(poLog.class.lessons_done));
    ok('poznámka k lekcii sa uložila',
      (poLog.class.lesson_log || []).find(z => z.lesson === 1)?.note === 'základné kroky',
      JSON.stringify(poLog.class.lesson_log));

    // Termíny sa dohadujú so školou osobne a zadáva ich Marek — musia sa
    // dostať až k žiakom, inak nevedia, kedy prísť.
    const term = await j('/api/admin/venceky/progress', { method: 'POST', body: {
      class_id: sk.d.class._id, schedule: 'Utorok 14:00 · telocvičňa školy', event_date: '2026-11-28' } }, adm);
    ok('termín hodín sa dá zapísať', term.status === 200, JSON.stringify(term.d).slice(0, 80));
    await new Promise(r => setTimeout(r, 500));
    const infoS = (await j('/api/vencek/info?code=VEN-DETVA', {}, {})).d;
    ok('a vidí ho aj ten, kto sa ešte len registruje',
      infoS && infoS.schedule === 'Utorok 14:00 · telocvičňa školy', JSON.stringify(infoS && infoS.schedule));
    const detailS = (await j('/api/admin/venceky/class/' + sk.d.class._id, {}, adm)).d;
    ok('aj žiak v appke', detailS && detailS.class && detailS.class.schedule === 'Utorok 14:00 · telocvičňa školy',
      JSON.stringify(detailS && detailS.class && detailS.class.schedule));
    await new Promise(r => setTimeout(r, 600));
    const poZapise = rd('venceky_classes.db').find(x => x._id === sk.d.class._id);
    ok('Waltz je označený ako zvládnutý', poZapise && poZapise.dances[0].level === 4,
      poZapise ? String(poZapise.dances[0].level) : '—');
    // Medzistupne zmizli — tanec sa buď učil (a je zvládnutý), alebo ešte nie.
    ok('nič nezostalo v polovičnej úrovni',
      poZapise && (poZapise.dances || []).every(x => x.level === 0 || x.level === 4),
      JSON.stringify((poZapise.dances || []).map(x => x.level)));
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
    // Jednorazový vstup sa 2. 9. zrušil — vedľa celého mesiaca zadarmo nič nepridával.
    ok('jednorazový vstup sa už nerozdáva', zu && !zu.free_credits, zu ? String(zu.free_credits) : '—');
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

    console.log('\n9b) Chat skupiny:');
    const ziakC = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.ven.ziak@qa-biz.local', password: 'Heslo123!' } }, ziakC);
    const posli = await j('/api/vencek/chat', { method: 'POST', body: { text: 'Ahojte, kedy máme ďalšiu hodinu?' } }, ziakC);
    ok('žiak napíše do chatu', posli.status === 200 && posli.d && posli.d.ok, JSON.stringify(posli.d).slice(0, 90));
    const citaj = (await j('/api/vencek/chat', {}, ziakC)).d;
    ok('a správu vidí', citaj && citaj.messages && citaj.messages.length === 1
      && /kedy máme/.test(citaj.messages[0].text), JSON.stringify(citaj && citaj.messages).slice(0, 110));
    ok('so správnou rolou pri mene', citaj && citaj.messages[0].role === 'student',
      citaj && citaj.messages[0].role);
    // Rodič je v tej istej skupine, takže má správu vidieť — je to spoločný chat.
    const rodicC = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.ven.rodic@qa-biz.local', password: 'Heslo123!' } }, rodicC);
    const citajR = (await j('/api/vencek/chat', {}, rodicC)).d;
    ok('vidí ju aj ďalší člen skupiny', citajR && citajR.messages && citajR.messages.length === 1);
    // Kto v skupine nie je, nesmie ani čítať, ani písať.
    const cudziC = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.ven.bezkodu@qa-biz.local', password: 'Heslo123!' } }, cudziC);
    await j('/api/admin/venceky/member-role', { method: 'POST',
      body: { user_id: (usr('qa.ven.bezkodu@qa-biz.local') || {})._id, role: 'none' } }, adm);
    await new Promise(r => setTimeout(r, 400));
    const cudziCita = await j('/api/vencek/chat', {}, cudziC);
    ok('kto v skupine nie je, chat nevidí', cudziCita.status === 403, 'HTTP ' + cudziCita.status);
    const cudziPise = await j('/api/vencek/chat', { method: 'POST', body: { text: 'nazdar' } }, cudziC);
    ok('ani doň nenapíše', cudziPise.status === 403, 'HTTP ' + cudziPise.status);
    const prazdna = await j('/api/vencek/chat', { method: 'POST', body: { text: '   ' } }, ziakC);
    ok('prázdna správa sa odmietne', prazdna.status === 400, 'HTTP ' + prazdna.status);
    const cudziaSprava = await j('/api/vencek/chat/' + citaj.messages[0].id, { method: 'DELETE' }, rodicC);
    ok('cudziu správu nikto nezmaže', cudziaSprava.status === 403, 'HTTP ' + cudziaSprava.status);
    const vlastna = await j('/api/vencek/chat/' + citaj.messages[0].id, { method: 'DELETE' }, ziakC);
    ok('vlastnú áno', vlastna.status === 200, 'HTTP ' + vlastna.status);

    console.log('\n9c) Profil v chate a ukončenie venčeka:');
    await j('/api/vencek/chat', { method: 'POST', body: { text: 'test profilu' } }, ziakC);
    // Profil si mení klientka sama — admin endpoint tieto polia zámerne neprijíma.
    // Fotka ide vlastným endpointom a musí byť data URI (1×1 priehľadný PNG).
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    await j('/api/profile', { method: 'PUT', body: { nickname: 'Zuzi' } }, ziakC);
    await j('/api/client/avatar', { method: 'POST', body: { avatar: PNG } }, ziakC);
    await new Promise(r => setTimeout(r, 500));
    const chatP = (await j('/api/vencek/chat', {}, ziakC)).d;
    const moja = (chatP.messages || []).slice(-1)[0];
    ok('chat ukazuje prezývku z profilu, nie meno pri registrácii',
      moja && moja.name === 'Zuzi', moja && moja.name);
    ok('a fotku z profilu', !!(moja && moja.avatar && moja.avatar.startsWith('data:image/png')), String(moja && moja.avatar).slice(0, 40));
    ok('so správnym user_id, aby sa dalo prejsť na profil',
      moja && moja.user_id === (zu || {})._id, moja && moja.user_id);

    const ukonci = await j('/api/admin/venceky/complete', { method: 'POST',
      body: { class_id: tr.d.class._id } }, adm);
    ok('venček sa dá ukončiť', ukonci.status === 200 && ukonci.d && ukonci.d.ok, JSON.stringify(ukonci.d).slice(0, 80));
    await new Promise(r => setTimeout(r, 700));
    const poUkonceni = (await j('/api/vencek/mine', {}, ziakC)).d;
    ok('skupina je označená ako ukončená (karta na nástenke zmizne)',
      poUkonceni && poUkonceni.class && poUkonceni.class.completed === true,
      JSON.stringify(poUkonceni && poUkonceni.class && poUkonceni.class.completed));
    const zuPo = usr('qa.ven.ziak@qa-biz.local');
    ok('žiak má odznak absolventa', !!(zuPo && zuPo.vencek_alumni), zuPo && zuPo.vencek_alumni);
    ok('a účet mu ostáva bežný — nič sa mu neodobralo',
      zuPo && zuPo.active !== false && !!zuPo.email && zuPo.nickname === 'Zuzi',
      JSON.stringify({ active: zuPo && zuPo.active, nick: zuPo && zuPo.nickname }));
    const absKup = rd('promo_codes.db').find(p => p.code === 'VENCEKABS');
    ok('absolventský kupón platí len na Silver, nie na Gold',
      absKup && Array.isArray(absKup.plan_ids) && absKup.plan_ids.join() === 'silver',
      JSON.stringify(absKup && absKup.plan_ids));

    console.log('\n9e) Dochádzka — zapisuje sa, kto chýba:');
    const chybajuci = await j('/api/admin/venceky/attendance', { method: 'POST',
      body: { class_id: tr.d.class._id, lesson_no: 1, absent: [(zu || {})._id] } }, adm);
    ok('zápis prejde', chybajuci.status === 200 && chybajuci.d && chybajuci.d.ok, JSON.stringify(chybajuci.d).slice(0, 80));
    // V tejto skupine je jediný žiak — keď zaškrtnem jeho, prítomných je nula.
    ok('kto je zaškrtnutý, ten chýba — zvyšok je prítomný automaticky',
      chybajuci.d && chybajuci.d.absent === 1 && chybajuci.d.present === 0,
      'prítomní ' + (chybajuci.d && chybajuci.d.present) + ' · chýbali ' + (chybajuci.d && chybajuci.d.absent));
    const zapisA = rd('venceky_attendance.db').find(x => x.lesson_no === 1 && x.class_id === tr.d.class._id);
    ok('do záznamu sa uložili obe strany', zapisA && Array.isArray(zapisA.absent) && Array.isArray(zapisA.present),
      JSON.stringify(zapisA && { p: (zapisA.present || []).length, a: (zapisA.absent || []).length }));
    const vsetciTam = await j('/api/admin/venceky/attendance', { method: 'POST',
      body: { class_id: tr.d.class._id, lesson_no: 2, absent: [] } }, adm);
    ok('keď nikto nechýba, prítomní sú všetci', vsetciTam.d && vsetciTam.d.absent === 0 && vsetciTam.d.present >= 1,
      'prítomní ' + (vsetciTam.d && vsetciTam.d.present));

    console.log('\n9d) Zmena rozvrhu dorazí žiakom:');
    await j('/api/admin/venceky/progress', { method: 'POST',
      body: { class_id: tr.d.class._id, start_at: START } }, adm);
    await j('/api/admin/venceky/lesson-change', { method: 'POST',
      body: { class_id: tr.d.class._id, week: 2, cancelled: true } }, adm);
    await new Promise(r => setTimeout(r, 800));
    const notifR = rd('notifications.db').filter(n => /rozvrhu/i.test(n.title || ''));
    ok('žiaci o zmene rozvrhu dostali notifikáciu', notifR.length >= 1,
      JSON.stringify(notifR.map(n => n.title)).slice(0, 90));

    console.log('\n9f) Detail lekcie, učiteľský zoznam a miesto venčeka:');
    // Marek 2. 9.: „ku každej lekcii im aj mne daj možnosť rozkliknúť detail —
    // kto chýbal a čo sa učilo." Zapísali sme lekciu 1 (Waltz + Zuzka chýbala).
    await j('/api/admin/venceky/lesson-log', { method: 'POST',
      body: { class_id: tr.d.class._id, lesson: 1, dances: ['Waltz'], note: 'základné kroky' } }, adm);
    await new Promise(r => setTimeout(r, 500));
    const ziakD = (await j('/api/vencek/mine', {}, ziakC)).d;
    const l1 = ziakD && Array.isArray(ziakD.lessons) ? ziakD.lessons.find(l => l.lesson === 1) : null;
    ok('žiak dostane detail lekcie', !!l1, JSON.stringify(ziakD && Object.keys(ziakD)));
    ok('vidí, čo sa učilo', l1 && l1.dances.includes('Waltz') && l1.note === 'základné kroky', JSON.stringify(l1));
    ok('a kto chýbal — menom', l1 && l1.recorded && Array.isArray(l1.absent) && l1.absent.length === 1,
      JSON.stringify(l1 && l1.absent));
    ok('a že chýbal práve on', l1 && l1.me_absent === true, String(l1 && l1.me_absent));
    ok('ale mená spolužiakov s platbami nie', !ziakD.students, JSON.stringify(ziakD.students || null));

    // Učiteľ vidí menný zoznam aj s tým, kto zaplatil (Marek 2. 9.).
    await j('/api/admin/venceky/member-role', { method: 'POST',
      body: { user_id: (uu || {})._id, class_id: tr.d.class._id, role: 'teacher' } }, adm);
    const ucitelC = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.ven.ucitel@qa-biz.local', password: 'Heslo123!' } }, ucitelC);
    const ucD = (await j('/api/vencek/mine', {}, ucitelC)).d;
    ok('učiteľ dostane zoznam žiakov', ucD && ucD.role === 'teacher' && Array.isArray(ucD.students) && ucD.students.length >= 1,
      JSON.stringify(ucD && { role: ucD.role, n: (ucD.students || []).length }));
    const zuz = ucD && (ucD.students || []).find(s => /Zuz/.test(s.name));
    ok('pri každom vidí, či zaplatil', zuz && zuz.paid === true, JSON.stringify(zuz));
    ok('aj koľkokrát chýbal', zuz && zuz.absences === 1, String(zuz && zuz.absences));
    ok('a detail lekcií má tiež', Array.isArray(ucD.lessons) && ucD.lessons.some(l => l.recorded));

    // Miesto venčeka — dátum sa dal zadať, miesto nie (Marek: „Dom kultúry v Halíči").
    await j('/api/admin/venceky/progress', { method: 'POST',
      body: { class_id: tr.d.class._id, event_date: '2026-12-12', event_venue: 'Dom kultúry Halíč' } }, adm);
    await new Promise(r => setTimeout(r, 400));
    const infoV = (await j('/api/vencek/info?code=' + kod, {}, {})).d;
    ok('miesto venčeka sa uloží a vidí ho aj ten, kto sa len registruje',
      infoV && infoV.event_venue === 'Dom kultúry Halíč' && infoV.event_date === '2026-12-12',
      JSON.stringify(infoV && [infoV.event_date, infoV.event_venue]));
    const ziakV = (await j('/api/vencek/mine', {}, ziakC)).d;
    ok('aj žiak v appke', ziakV && ziakV.class && ziakV.class.event_venue === 'Dom kultúry Halíč',
      JSON.stringify(ziakV && ziakV.class && ziakV.class.event_venue));

    console.log('\n10) Čo žiak NESMIE vidieť:');
    const z = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.ven.ziak@qa-biz.local', password: 'Heslo123!' } }, z);
    const mojePohlad = (await j('/api/vencek/mine', {}, z)).d;
    ok('žiak vidí len svoju skupinu, nie zoznam škôl',
      mojePohlad && mojePohlad.role === 'student' && !mojePohlad.schools,
      JSON.stringify(mojePohlad && Object.keys(mojePohlad)));
    // Počet zaplatených je neškodný agregát, ale mená spolužiakov ani ich platby
    // v žiackom pohľade nesmú byť — „kto zaplatil a kto nie" vidí len Marek.
    const surovo = JSON.stringify(mojePohlad);
    ok('v jeho pohľade nie sú mená ani platby spolužiakov',
      !/Rena Rucna|Nina Neprisla|Renata Rodicova/.test(surovo) && !/"payments"|"members":\s*\[/.test(surovo),
      surovo.slice(0, 140));
    ok('nedostane sa do cudzej skupiny cez podstrčené class_id',
      (await j('/api/vencek/mine?ako=student&class_id=' + hal.d.class._id, {}, z)).d.class.name !== 'Venčeková skupina'
        || (await j('/api/vencek/mine?ako=student&class_id=' + hal.d.class._id, {}, z)).d.preview !== true,
      'preview je len pre adminov');
    const fin = await j('/api/admin/venceky/overview', {}, z);
    ok('financie a prehľad škôl sú preňho zakázané', fin.status === 401 || fin.status === 403,
      'HTTP ' + fin.status);
    const detailZ = await j('/api/admin/venceky/class/' + tr.d.class._id, {}, z);
    ok('menný zoznam platieb tiež', detailZ.status === 401 || detailZ.status === 403, 'HTTP ' + detailZ.status);
    const zapisZ = await j('/api/admin/venceky/progress', { method: 'POST',
      body: { class_id: tr.d.class._id, lessons_done: 99 } }, z);
    ok('a nemôže si sám označiť tance ani lekcie', zapisZ.status === 401 || zapisZ.status === 403,
      'HTTP ' + zapisZ.status);
    const platbaZ = await j('/api/admin/venceky/payment', { method: 'POST',
      body: { class_id: tr.d.class._id, user_id: (zu || {})._id, amount: 49.9, method: 'cash' } }, z);
    ok('ani si zapísať, že zaplatil', platbaZ.status === 401 || platbaZ.status === 403, 'HTTP ' + platbaZ.status);

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nVENČEKOVÝ NÁBOR: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
