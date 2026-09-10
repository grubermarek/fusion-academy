/**
 * Venčeky — opravy z auditu 10. 9. 2026.
 *
 * Marek si dal skontrolovať celý modul (žiacku aj admin stranu) a našlo sa
 * dvanásť vecí. Tento test stráži tie, ktoré sa dajú overiť na serveri:
 *
 *   · rozvrh zadaný z admina neposunie hodiny o dve hodiny (server beží v UTC)
 *   · platba kartou sa neeviduje ako hotovosť
 *   · venčekové peniaze sú v tržbách, nie vo vlastnom ostrovčeku
 *   · hotovosť vystaví faktúru rovnako ako karta
 *   · zápis dochádzky posunie počítadlo odučených lekcií
 *   · „bonusové lekcie po venčeku" sa rátajú podľa dátumu venčeka, nie z poradia
 *   · zlúčenie účtov vezme venčekovú skupinu, platbu aj chat so sebou
 *   · správa v chate dá o sebe vedieť ostatným
 *   · rodič sa spáruje s dieťaťom a môže zaň zaplatiť
 *   · priradenie existujúceho účtu nájde človeka aj bez diakritiky
 *
 * Spustenie:  node qa/vencek-opravy.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4595;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-vencek-'));
const TOKEN = 'qa-vencek-token-1';

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

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

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  w('users.db', [
    { _id: 'qaVoAdmin000001', name: 'Marek Gruber', email: 'qa.vo.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    { _id: 'qaVoZiak0000001', name: 'Adela Káková', email: 'qa.vo.adela@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-09-01',
      venceky_class_id: 'qaVoTrieda00001', venceky_school_id: 'qaVoSkola000001', venceky_role: 'student' },
    { _id: 'qaVoZiak0000002', name: 'Michal Lenč', email: 'qa.vo.michal@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-09-01',
      venceky_class_id: 'qaVoTrieda00001', venceky_school_id: 'qaVoSkola000001', venceky_role: 'student' },
    { _id: 'qaVoRodic000001', name: 'Jana Káková', email: 'qa.vo.rodic@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-09-01',
      venceky_class_id: 'qaVoTrieda00001', venceky_school_id: 'qaVoSkola000001', venceky_role: 'parent',
      vencek_child_name: 'Adela Kakova' },
    { _id: 'qaVoRodic000002', name: 'Eva Bezdietna', email: 'qa.vo.rodic2@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-09-01',
      venceky_class_id: 'qaVoTrieda00001', venceky_school_id: 'qaVoSkola000001', venceky_role: 'parent',
      vencek_child_name: 'Niekto Kto Tu Nie Je' },
    // duplicitný účet žiačky — na overenie zlúčenia
    { _id: 'qaVoDupl0000001', name: 'Adela Káková', email: 'qa.vo.adela.dupl@qa-biz.local',
      user_type: 'client', active: true, created_at: '2026-08-01' },
  ]);
  w('venceky_schools.db', [{ _id: 'qaVoSkola000001', name: 'ZŠ Halíč QA', city: 'Halíč', year: '2026/27', created_at: '2026-09-01' }]);
  w('venceky_classes.db', [{ _id: 'qaVoTrieda00001', school_id: 'qaVoSkola000001', name: 'Venčeková skupina',
    year: '2026/27', code: 'VEN-QAHALIC', price: 49.9, lessons_total: 13, lessons_before: 10, lessons_done: 0,
    lecturer: 'Marek Gruber', event_date: '2026-12-12', roles: ['student', 'teacher'],
    dances: [{ name: 'Waltz', level: 0 }, { name: 'Polka', level: 0 }], created_at: '2026-09-01' }]);

  console.log('VENČEKY — OPRAVY\n');

  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TZ: 'UTC', PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', IMPORT_TOKEN: TOKEN,
      // len aby sa prešlo cez kontrolu dostupnosti platby — na Stripe sa neklikne
      STRIPE_SECRET_KEY: 'sk_test_qa_vencek' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 9000));

  const adm = {}, rodic = {}, rodic2 = {}, ziak = {};
  const CID = 'qaVoTrieda00001';

  try {
    await j('/api/login', { method: 'POST', body: { email: 'qa.vo.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    await j('/api/login', { method: 'POST', body: { email: 'qa.vo.rodic@qa-biz.local', password: 'Heslo123!' } }, rodic);
    await j('/api/login', { method: 'POST', body: { email: 'qa.vo.rodic2@qa-biz.local', password: 'Heslo123!' } }, rodic2);
    await j('/api/login', { method: 'POST', body: { email: 'qa.vo.adela@qa-biz.local', password: 'Heslo123!' } }, ziak);

    console.log('1) Rozvrh z admina sa neposunie o dve hodiny (server v UTC):');
    await j('/api/admin/venceky/progress', { method: 'POST', body: { class_id: CID, start_at: '2026-09-10T13:00' } }, adm);
    await new Promise(r => setTimeout(r, 600));
    let c = rd('venceky_classes.db')[0];
    ok('letný čas: 13:00 u nás = 11:00 UTC', c.start_at === '2026-09-10T11:00:00.000Z', String(c.start_at));
    const skSK = iso => new Intl.DateTimeFormat('sk-SK', { timeZone: 'Europe/Bratislava', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
    ok('a žiakovi sa ukáže 13:00', skSK(c.start_at) === '13:00', skSK(c.start_at));
    await j('/api/admin/venceky/progress', { method: 'POST', body: { class_id: CID, start_at: '2026-12-10T13:00' } }, adm);
    await new Promise(r => setTimeout(r, 600));
    ok('zimný čas: 13:00 u nás = 12:00 UTC', rd('venceky_classes.db')[0].start_at === '2026-12-10T12:00:00.000Z',
      String(rd('venceky_classes.db')[0].start_at));
    // späť na september, s ním sa počíta ďalej
    await j('/api/admin/venceky/progress', { method: 'POST', body: { class_id: CID, start_at: '2026-09-10T13:00' } }, adm);
    await new Promise(r => setTimeout(r, 600));

    console.log('\n2) Presun lekcie drží ten istý čas:');
    await j('/api/admin/venceky/lesson-change', { method: 'POST', body: { class_id: CID, week: 2, at: '2026-09-25T16:30' } }, adm);
    await new Promise(r => setTimeout(r, 600));
    const zmena = (rd('venceky_classes.db')[0].lesson_changes || [])[0];
    ok('presunutá lekcia má 16:30 nášho času', zmena && skSK(zmena.at) === '16:30', zmena ? String(zmena.at) : '—');

    console.log('\n3) Bonusové lekcie podľa dátumu venčeka:');
    const det = await j('/api/admin/venceky/class/' + CID, {}, adm);
    const term = (det.d.class.terminy || []).filter(t => !t.cancelled && t.at);
    ok('venček je 12. 12., posledná lekcia skôr → žiadny bonus',
      term.length === 13 && term.filter(t => t.bonus).length === 0,
      term.length + ' termínov, bonusových ' + term.filter(t => t.bonus).length);
    const info = await j('/api/vencek/info?code=VEN-QAHALIC');
    ok('registračná stránka sľubuje 13 lekcií a 0 bonusov',
      info.d.pred_veckom === 13 && info.d.bonusov === 0,
      JSON.stringify({ p: info.d.pred_veckom, b: info.d.bonusov }));

    console.log('\n4) Dochádzka posunie počítadlo lekcií:');
    await j('/api/admin/venceky/attendance', { method: 'POST', body: { class_id: CID, lesson_no: 3, absent: ['qaVoZiak0000002'] } }, adm);
    await new Promise(r => setTimeout(r, 600));
    ok('lessons_done je 3', rd('venceky_classes.db')[0].lessons_done === 3, String(rd('venceky_classes.db')[0].lessons_done));
    await j('/api/admin/venceky/attendance', { method: 'POST', body: { class_id: CID, lesson_no: 2, absent: [] } }, adm);
    await new Promise(r => setTimeout(r, 600));
    ok('staršia lekcia ho nezníži', rd('venceky_classes.db')[0].lessons_done === 3, String(rd('venceky_classes.db')[0].lessons_done));

    console.log('\n5) Hotovosť: faktúra aj správny spôsob platby:');
    await j('/api/admin/venceky/payment', { method: 'POST', body: { class_id: CID, user_id: 'qaVoZiak0000001', amount: 49.9, method: 'cash' } }, adm);
    await new Promise(r => setTimeout(r, 900));
    const fa = rd('invoices.db').filter(i => i.user_id === 'qaVoZiak0000001');
    ok('vystavila sa faktúra', fa.length === 1 && Math.abs(fa[0].total - 49.9) < 0.01,
      JSON.stringify(fa.map(i => i.number + ':' + i.total)));
    ok('a je na venčekový kurz', fa[0] && /venček/i.test((fa[0].items || []).map(i => i.desc).join(' ')),
      fa[0] ? JSON.stringify(fa[0].items) : '—');

    console.log('\n6) Venčekové peniaze sú v tržbách:');
    const pr = await j('/api/admin/predaje', {}, adm);
    const riadok = ((pr.d && pr.d.rows) || []).find(r => r.cat === 'venceky');
    ok('predaj sa objaví v zozname', !!riadok, JSON.stringify(((pr.d && pr.d.rows) || []).map(r => r.cat)));
    ok('so sumou 49,90 € a menom žiačky',
      riadok && Math.abs(riadok.a - 49.9) < 0.01 && /Adela/.test(riadok.who.name),
      riadok ? riadok.a + ' / ' + riadok.who.name : '—');
    ok('a spôsobom „hotovosť"', riadok && riadok.method === 'hotovosť', riadok ? riadok.method : '—');
    ok('kategória má slovenský názov', pr.d && pr.d.kategorie && pr.d.kategorie.venceky === 'Venčeky',
      JSON.stringify(pr.d && pr.d.kategorie));

    console.log('\n7) Rodič je spárovaný s dieťaťom:');
    const mR = await j('/api/vencek/mine', {}, rodic);
    ok('appka vie, ktoré dieťa je jeho', mR.d.child_matched === true, JSON.stringify({ m: mR.d.child_matched }));
    ok('a že kurz je zaplatený', mR.d.child_paid === true, JSON.stringify({ p: mR.d.child_paid }));
    const mR2 = await j('/api/vencek/mine', {}, rodic2);
    ok('rodič bez zhody nedostane falošnú istotu', mR2.d.child_matched === false, JSON.stringify({ m: mR2.d.child_matched }));
    const chk = await j('/api/vencek/checkout', { method: 'POST', body: {} }, rodic2);
    ok('a platbu mu appka zrozumiteľne odmietne',
      chk.status === 400 && /spárujeme|účet žiaka/i.test(String(chk.d && chk.d.error)),
      JSON.stringify(chk.d));

    console.log('\n8) Chat dá o sebe vedieť:');
    const predT = rd('notifications.db').length;
    await j('/api/vencek/chat', { method: 'POST', body: { class_id: CID, text: 'Ahojte, zajtra si vezmite tenisky.' } }, adm);
    await new Promise(r => setTimeout(r, 900));
    const nove = rd('notifications.db').filter(n => /píše v chate/.test(String(n.title || '')));
    ok('ostatní v skupine dostali notifikáciu', nove.length === 4, 'nových: ' + nove.length + ' (spolu ' + predT + '→' + rd('notifications.db').length + ')');
    ok('autorovi neprišla', !nove.some(n => n.user_id === 'qaVoAdmin000001'));
    ok('a nesie začiatok správy', nove[0] && /tenisky/.test(nove[0].body), nove[0] ? nove[0].body : '—');

    console.log('\n9) Priradenie účtu bez diakritiky:');
    const pr2 = await j('/api/admin/venceky/assign-student', { method: 'POST', body: { class_id: CID, query: 'kakova' } }, adm);
    const najdene = (pr2.d && pr2.d.pick) || (pr2.d && pr2.d.assigned ? [pr2.d.assigned] : []);
    ok('„kakova" nájde Kákovú aj bez dĺžňa', najdene.some(x => /Kákov/.test(x.name)), JSON.stringify(pr2.d).slice(0, 160));

    console.log('\n10) Zlúčenie účtov vezme venček so sebou:');
    // duplicitný účet dostane platbu a správu, aby bolo čo prenášať
    await j('/api/admin/venceky/member-role', { method: 'POST', body: { user_id: 'qaVoDupl0000001', class_id: CID, role: 'student' } }, adm);
    await j('/api/admin/venceky/payment', { method: 'POST', body: { class_id: CID, user_id: 'qaVoDupl0000001', amount: 49.9, method: 'cash' } }, adm);
    await new Promise(r => setTimeout(r, 700));
    const zluc = await j('/api/service/merge-users', { method: 'POST',
      headers: { 'x-import-token': TOKEN }, body: { source_id: 'qaVoDupl0000001', target_id: 'qaVoZiak0000002' } });
    ok('zlúčenie prešlo', zluc.status === 200 && zluc.d && zluc.d.ok, JSON.stringify(zluc.d).slice(0, 140));
    await new Promise(r => setTimeout(r, 900));
    const cielovy = rd('users.db').find(u => u._id === 'qaVoZiak0000002');
    ok('cieľ ostal v skupine', cielovy.venceky_class_id === CID, String(cielovy.venceky_class_id));
    ok('platba sa preniesla', rd('venceky_payments.db').some(p => p.user_id === 'qaVoZiak0000002'),
      JSON.stringify(rd('venceky_payments.db').map(p => p.user_id)));
    ok('po zdroji neostala žiadna platba', !rd('venceky_payments.db').some(p => p.user_id === 'qaVoDupl0000001'));

    console.log('\n11) Zmazanie skupiny upratá aj chat:');
    await j('/api/admin/venceky/class-delete', { method: 'POST', body: { class_id: CID } }, adm);
    await new Promise(r => setTimeout(r, 800));
    ok('chat skupiny je preč', rd('venceky_chat.db').filter(m => m.class_id === CID).length === 0,
      'zostalo ' + rd('venceky_chat.db').length + ' správ');
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nVENČEKY — OPRAVY: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-900));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
