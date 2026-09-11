/**
 * Venčekári nejdú trénerom na konverziu (11. 9. 2026).
 *
 * Marek: „Čo sa týka leadov z venčeka, nemusia ísť trénerom do leadforiem na
 * konverziu." Na produkcii bolo 22 venčekárov vedených ako leady, trénerka už
 * štyroch kontaktovala (dvoch učiteľov a dvoch deviatakov), jedna učiteľka
 * visela prevzatá v trénerskom zozname a prišlo o nich 98 notifikácií vrátane
 * „🔥 horúce leady čakajú". Venčekár totiž na bežné hodiny nechodí, takže bol
 * vždy „registrácia bez rezervácie" — presne to, čo appka hlási ako horúce.
 *
 * Stráži, že venčekár (žiak, rodič, učiteľ):
 *   · nie je v trénerskom zozname „Môj deň"
 *   · nie je v neodkladných úlohách (tie idú trénerom ako horúce leady)
 *   · nie je medzi zabudnutými leadmi vo watchdogu
 *   · pri registrácii nespustí adminom „🆕 Nový lead — ozvi sa" (venčekový oznam áno)
 * A zároveň, že sa nevyraďuje priveľa:
 *   · bežný lead v zozname aj v neodkladných úlohách ostáva
 *   · venčekár, ktorý sa stal platiacim klientom, je pre trénera normálna klientka
 * A že migrácia uprace, čo tam už zostalo (prevzatie, úlohy, follow-upy).
 *
 * Spustenie:  node qa/vencek-mimo-konverzie.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4592;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-venkonv-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts, jar) {
  opts = opts || {};
  const headers = { 'Content-Type': 'application/json' };
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
  const dnes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const denPred = n => { const d = new Date(dnes + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const V = { venceky_class_id: 'qaVkTrieda00001', venceky_school_id: 'qaVkSkola000001', lead_source: 'vencek' };

  w('users.db', [
    { _id: 'qaVkAdmin000001', name: 'Marek Gruber', email: 'qa.vk.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    { _id: 'qaVkTrener00001', name: 'Nelka Trénerka', email: 'qa.vk.trener@qa-biz.local',
      password: hash, user_type: 'trainer', active: true, created_at: '2026-01-01' },
    // čerstvý venčekový žiak — bez rezervácie, presne ten, čo sa sypal ako horúci lead
    { _id: 'qaVkZiak0000001', name: 'Deviatak Venčekový', email: 'qa.vk.ziak@qa-biz.local', phone: '0900111222',
      user_type: 'lead', active: true, created_at: dnes, venceky_role: 'student', ...V },
    // učiteľka zo školy — a navyše prevzatá trénerkou (migrácia ju má uvoľniť)
    { _id: 'qaVkUcitel00001', name: 'Učiteľka Triedna', email: 'qa.vk.ucitel@qa-biz.local', phone: '0900111333',
      user_type: 'lead', active: true, created_at: denPred(3), venceky_role: 'teacher', ...V,
      coach_claimed_by: 'qaVkTrener00001', coach_claimed_at: denPred(2) + 'T10:00:00.000Z' },
    // starý venčekový rodič — watchdog by ho inak hlásil ako zabudnutého
    { _id: 'qaVkRodic000001', name: 'Rodič Venčekový', email: 'qa.vk.rodic@qa-biz.local', phone: '0900111444',
      user_type: 'lead', active: true, created_at: denPred(40), venceky_role: 'parent', ...V },
    // venčekový rodič, ktorý si kúpil členstvo a prestal chodiť — ten je už normálna klientka
    { _id: 'qaVkKlient00001', name: 'Rodič Klientka', email: 'qa.vk.klient@qa-biz.local', phone: '0900111555',
      user_type: 'client', active: true, created_at: denPred(60), venceky_role: 'parent', ...V, visit_count: 4 },
    // bežný lead — musí ostať všade, kde bol
    { _id: 'qaVkLead0000001', name: 'Bežná Leadka', email: 'qa.vk.lead@qa-biz.local', phone: '0900111666',
      user_type: 'lead', active: true, created_at: dnes },
    { _id: 'qaVkLeadStar001', name: 'Zabudnutá Leadka', email: 'qa.vk.stara@qa-biz.local', phone: '0900111777',
      user_type: 'lead', active: true, created_at: denPred(40) },
  ]);
  w('venceky_schools.db', [{ _id: 'qaVkSkola000001', name: 'ZŠ QA', city: 'Halíč', year: '2026/27', created_at: '2026-09-01' }]);
  w('venceky_classes.db', [{ _id: 'qaVkTrieda00001', school_id: 'qaVkSkola000001', name: 'Venčeková skupina',
    year: '2026/27', code: 'VEN-QAKONV', price: 49.9, lessons_total: 13, lessons_before: 10, lessons_done: 0,
    roles: ['student', 'parent', 'teacher'], dances: [{ name: 'Waltz', level: 0 }], created_at: '2026-09-01' }]);
  w('classes.db', [{ _id: 'qaVkHodina00001', name: 'Zumba', category: 'Zumba', location: 'Detva',
    day_of_week: 1, time_start: '18:00', time_end: '19:00', capacity: 30, active: true }]);
  // klientka mala pred troma dňami no-show — tréner ju má vidieť
  w('bookings.db', [{ _id: 'qaVkRez00000001', class_id: 'qaVkHodina00001', class_name: 'Zumba', class_location: 'Detva',
    user_id: 'qaVkKlient00001', user_name: 'Rodič Klientka', booking_date: denPred(3),
    status: 'confirmed', attendance_status: 'no_show', created_at: denPred(4) + 'T10:00:00.000Z' }]);
  // pozostatky, ktoré má migrácia upratať
  w('coach_tasks.db', [{ _id: 'qaVkUloha000001', trainer_id: 'qaVkTrener00001', date: dnes,
    key: 'urgent_lead_qaVkZiak0000001', label: 'Nová registrácia bez rezervácie — Deviatak Venčekový',
    done: false, source: 'admin', created_at: dnes + 'T08:00:00.000Z' }]);
  w('crm_tasks.db', [{ _id: 'qaVkFollow00001', client_id: 'qaVkUcitel00001', client_name: 'Učiteľka Triedna',
    assigned_to: 'qaVkTrener00001', title: 'Zavolať', due_date: dnes, status: 'open', created_at: denPred(1) + 'T10:00:00.000Z' }]);

  console.log('VENČEKÁRI MIMO KONVERZIE\n');

  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 15000));   // migrácie bežia 10–11 s po štarte

  const adm = {}, tr = {};
  try {
    await j('/api/login', { method: 'POST', body: { email: 'qa.vk.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    await j('/api/login', { method: 'POST', body: { email: 'qa.vk.trener@qa-biz.local', password: 'Heslo123!' } }, tr);

    console.log('1) Migrácia upratala, čo zostalo:');
    const ucitel = rd('users.db').find(u => u._id === 'qaVkUcitel00001');
    ok('prevzatá učiteľka je uvoľnená', !ucitel.coach_claimed_by, String(ucitel.coach_claimed_by));
    ok('úloha „kontaktuj deviataka" zmizla', !rd('coach_tasks.db').some(t => t._id === 'qaVkUloha000001'),
      JSON.stringify(rd('coach_tasks.db').map(t => t.key)));
    const fu = rd('crm_tasks.db').find(t => t._id === 'qaVkFollow00001');
    ok('follow-up na učiteľku je zrušený', fu && fu.status === 'cancelled', fu && fu.status);

    console.log('\n2) Trénerský zoznam „Môj deň":');
    const den = await j('/api/coach/today', {}, tr);
    ok('zoznam sa načíta', den.status === 200 && den.d && den.d.ok, JSON.stringify(den.d).slice(0, 120));
    const ids = [...((den.d && den.d.leads) || []), ...((den.d && den.d.my_leads) || [])].map(x => x.id);
    ok('venčekový žiak v ňom nie je', !ids.includes('qaVkZiak0000001'), JSON.stringify(ids));
    ok('učiteľka tiež nie', !ids.includes('qaVkUcitel00001'));
    ok('ani venčekový rodič', !ids.includes('qaVkRodic000001'));
    ok('bežná leadka v ňom ostala', ids.includes('qaVkLead0000001'), JSON.stringify(ids));
    ok('venčekový rodič, čo je už klientka s no-show, v ňom je', ids.includes('qaVkKlient00001'), JSON.stringify(ids));

    console.log('\n3) Neodkladné úlohy (idú trénerom ako horúce leady):');
    const nu = await j('/api/admin/urgent-tasks', {}, adm);
    const uids = ((nu.d && nu.d.tasks) || []).map(t => t.user_id);
    ok('venčekový žiak nie je horúci lead', !uids.includes('qaVkZiak0000001'), JSON.stringify(uids));
    ok('bežná čerstvá registrácia tam je', uids.includes('qaVkLead0000001'), JSON.stringify(uids));

    console.log('\n4) Watchdog zabudnutých leadov:');
    const ld = await j('/api/admin/leads', {}, adm);
    const zab = ld.d && ld.d.stats ? ld.d.stats.forgotten : null;
    ok('zabudnutá je len bežná stará leadka, nie venčekový rodič', zab === 1, 'forgotten=' + zab);

    console.log('\n5) Registrácia cez venčekový kód:');
    const predN = rd('notifications.db').length;
    const reg = await j('/api/register', { method: 'POST', body: { name: 'Nový Deviatak', email: 'qa.vk.novy@qa-biz.local',
      phone: '0900222333', password: 'Heslo123!', consent: true, user_type: 'client', lead_source: 'vencek',
      vencek_code: 'VEN-QAKONV', vencek_role: 'student' } }, {});
    ok('registrácia prejde', reg.status === 200 && reg.d && reg.d.ok, JSON.stringify(reg.d).slice(0, 120));
    await new Promise(r => setTimeout(r, 1200));
    const nove = rd('notifications.db').slice(predN).filter(n => n.user_id === 'qaVkAdmin000001');
    ok('admin dostal „🎓 Nový venčekár"', nove.some(n => n.type === 'venceky' && /venčekár/i.test(n.title)),
      JSON.stringify(nove.map(n => n.title)));
    ok('ale nie „🆕 Nový lead — ozvi sa"', !nove.some(n => n.type === 'new_lead'), JSON.stringify(nove.map(n => n.type)));

    console.log('\n6) Bežná registrácia ďalej hlási lead:');
    const pred2 = rd('notifications.db').length;
    await j('/api/register', { method: 'POST', body: { name: 'Bežná Nováčka', email: 'qa.vk.bezna@qa-biz.local',
      phone: '0900222444', password: 'Heslo123!', consent: true, user_type: 'client' } }, {});
    await new Promise(r => setTimeout(r, 1200));
    ok('admin dostal „🆕 Nový lead"', rd('notifications.db').slice(pred2)
      .some(n => n.user_id === 'qaVkAdmin000001' && n.type === 'new_lead'));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nVENČEKÁRI MIMO KONVERZIE: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-900));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
