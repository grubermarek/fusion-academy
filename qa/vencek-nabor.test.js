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

    const tr = await j('/api/admin/venceky/classes', { method: 'POST',
      body: { school_id: sid, name: '9.A', price: 49.90, lessons_total: 13, lecturer: 'Marek Gruber' } }, adm);
    ok('trieda sa založí', tr.status === 200 && tr.d && tr.d.class, JSON.stringify(tr.d).slice(0, 110));
    const kod = tr.d.class && tr.d.class.code;
    ok('trieda dostane kód VEN-XXXXX', /^VEN-[A-Z0-9]{5}$/.test(String(kod)), String(kod));
    ok('a registračný odkaz pre žiakov', tr.d.join_link === BASE + '/?vencek=' + kod, String(tr.d.join_link));
    ok('cena aj počet hodín sedia', tr.d.class.price === 49.9 && tr.d.class.lessons_total === 13,
      tr.d.class.price + ' € · ' + tr.d.class.lessons_total + ' hodín');

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
    const trieda = skola && Array.isArray(skola.classes) ? skola.classes[0] : null;
    ok('prehľad ukáže školu aj triedu', !!trieda, JSON.stringify(ov && Object.keys(ov)).slice(0, 110));
    ok('a počíta žiakov (2: cez kód + ručne)', trieda && trieda.members === 2,
      trieda ? 'members=' + trieda.members : '—');

    const pay = await j('/api/admin/venceky/payment', { method: 'POST',
      body: { class_id: tr.d.class._id, user_id: (zu || {})._id, amount: 49.90, method: 'cash' } }, adm);
    ok('platba za žiaka sa zapíše', pay.status === 200 && pay.d && pay.d.ok !== false, JSON.stringify(pay.d).slice(0, 110));
    await new Promise(r => setTimeout(r, 600));
    const ov2 = (await j('/api/admin/venceky/overview', {}, adm)).d;
    const t2 = ov2 && ov2.schools && ov2.schools[0] && ov2.schools[0].classes && ov2.schools[0].classes[0];
    ok('a je vidieť v tržbe triedy', t2 && +t2.income >= 49.9, t2 ? 'income=' + t2.income + ' € · zaplatilo ' + t2.paid + ' z ' + t2.members : '—');

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nVENČEKOVÝ NÁBOR: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
