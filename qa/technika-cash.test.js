/**
 * Technický tréning a výber peňazí na mieste (Marek 30. 8. 2026).
 * „Keď sa baby booknú na techniku, nech mi to napíše, koľko mám vybrať,
 *  a klikom potvrdím, že som vybral."
 *
 * Suma aj klik fungovali už predtým. Chýbalo ale to hlavné: vybraté peniaze
 * sa nikde neevidovali, takže tréner nevedel, koľko hotovosti má u seba a má
 * odovzdať. Test to stráži spolu s cenníkom podľa členstva.
 *
 * Cenník (Marek 30. 8., po oprave): bez členstva 10 · Bronze 8 · Silver 7 · Gold 6.
 * Pôvodné Bronze 9 € bolo drahšie než vstup z permanentky (80 €/10 = 8 €) —
 * každá úroveň členstva musí byť výhodnejšia než kúpa nastojato.
 *
 * Spustenie:  node qa/technika-cash.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4519;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-tc-'));

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

(async () => {
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const DOW = new Date().getDay();
  const hash = bcrypt.hashSync('Heslo123!', 10);

  const U = (id, meno, kod) => JSON.stringify({
    _id: id, name: meno, email: id.toLowerCase() + '@qa-biz.local', password: hash, referral_code: kod,
    user_type: 'client', active: true, is_admin: false, visit_count: 5, created_at: '2026-06-01',
    city: 'Detva', free_class_used: true, free_credits: 0, single_entries: 0,
    account_creation_type: 'self_registration',
  });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaTcTrener000001', name: 'Beata Trenerka', email: 'qa.tc.trener@qa-biz.local',
      password: hash, user_type: 'trainer', active: true, is_admin: false, created_at: '2026-06-01' }),
    JSON.stringify({ _id: 'qaTcAdmin0000001', name: 'Adam Admin', email: 'qa.tc.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-06-01' }),
    U('qaTcBezClen0001', 'Jana Bezclenstva', 'QATC1'),
    U('qaTcSilver00001', 'Sona Silverova', 'QATC2'),
    U('qaTcGold0000001', 'Gita Goldova', 'QATC3'),
  ].join('\n') + '\n');

  fs.writeFileSync(path.join(DATA, 'memberships.db'), [
    JSON.stringify({ _id: 'qaTcMem001', user_id: 'qaTcSilver00001', plan_id: 'silver', status: 'active',
      started_at: '2026-08-01', expires_at: '2026-12-31', price: 69 }),
    JSON.stringify({ _id: 'qaTcMem002', user_id: 'qaTcGold0000001', plan_id: 'gold', status: 'active',
      started_at: '2026-08-01', expires_at: '2026-12-31', price: 89 }),
  ].join('\n') + '\n');

  fs.writeFileSync(path.join(DATA, 'classes.db'), JSON.stringify({
    _id: 'qaTcTech00000001', name: 'Technický tréning', emoji: '🩰', category: 'Technika',
    instructor: 'Beata Trenerka', location: 'Detva', address: 'Záhradná 7, Detva', day_of_week: DOW,
    time_start: '18:00', time_end: '19:00', capacity: 20, level: 'Všetky úrovne',
    description: '', price: 10, color: '#C9A84C', active: true,
  }) + '\n');

  // Zumba do porovnania — členstvo ju kryť MUSÍ aj po oprave techniky
  fs.appendFileSync(path.join(DATA, 'classes.db'), JSON.stringify({
    _id: 'qaTcZumba0000001', name: 'Zumba', emoji: '🎵', category: 'Zumba',
    instructor: 'Beata Trenerka', location: 'Detva', address: 'Záhradná 7, Detva', day_of_week: DOW,
    time_start: '19:00', time_end: '20:00', capacity: 30, level: 'Všetky úrovne',
    description: '', price: 10, color: '#C9A84C', active: true,
  }) + String.fromCharCode(10));

  console.log('TECHNIKA + HOTOVOSŤ QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol do 180 s'); process.exit(1); }

  try {
    const prihlas = async mail => { const jar = {}; await j('/api/login', { method: 'POST', body: { email: mail, password: 'Heslo123!' } }, jar); return jar; };
    const jana = await prihlas('qatcbezclen0001@qa-biz.local');
    const sona = await prihlas('qatcsilver00001@qa-biz.local');
    const gita = await prihlas('qatcgold0000001@qa-biz.local');
    const trener = await prihlas('qa.tc.trener@qa-biz.local');

    // ── cenník podľa členstva ──
    const skus = jar => j('/api/bookings', { method: 'POST', body: { class_id: 'qaTcTech00000001', booking_date: DNES } }, jar);
    const bezClen = await skus(jana);
    ok('bez členstva sa technika neprihlási hneď', bezClen.status === 402 && bezClen.d.error === 'membership_required', JSON.stringify(bezClen.d).slice(0, 90));
    ok('ponúkne platbu na mieste', bezClen.d.can_pay_on_site === true);
    ok('bez členstva stojí 10 €', bezClen.d.tech_price === 10, String(bezClen.d.tech_price));
    ok('Silver má 7 €', (await skus(sona)).d.tech_price === 7, String((await skus(sona)).d.tech_price));
    ok('Gold má 6 €', (await skus(gita)).d.tech_price === 6, String((await skus(gita)).d.tech_price));
    ok('žiadna úroveň nie je drahšia než vstup z permanentky (8 €)',
      (await skus(sona)).d.tech_price <= 8 && (await skus(gita)).d.tech_price <= 8);

    // ── rezervácia s platbou na mieste ──
    const rez = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaTcTech00000001', booking_date: DNES, pay_on_site: true } }, jana);
    ok('s platbou na mieste rezervácia prejde', rez.status === 200 && rez.d.ok, JSON.stringify(rez.d).slice(0, 100));
    const rezS = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaTcTech00000001', booking_date: DNES, pay_on_site: true } }, sona);
    ok('aj Silver členke', rezS.status === 200 && rezS.d.ok);

    // ── čo vidí tréner v zozname ──
    const zoz = await j('/api/attendance/class/qaTcTech00000001', {}, trener);
    const riadky = Array.isArray(zoz.d) ? zoz.d : [];
    ok('tréner vidí prihlásené', riadky.length === 2, String(riadky.length));
    const rJana = riadky.find(x => /Jana/.test(x.name || '')) || {};
    const rSona = riadky.find(x => /Sona/.test(x.name || '')) || {};
    ok('pri Jane je „platí na mieste"', rJana.pay_on_site === true, JSON.stringify(rJana.pay_on_site));
    ok('a suma 10 €', rJana.pay_amount === 10, String(rJana.pay_amount));
    ok('pri Soni suma 7 € (zľava podľa členstva)', rSona.pay_amount === 7, String(rSona.pay_amount));
    ok('zatiaľ nič nevybrané', !rJana.entry_collected && !rSona.entry_collected);
    ok('tréner má na klik id rezervácie', !!rJana.booking_id, JSON.stringify(rJana.booking_id));

    // ── klik: vybral som peniaze ──
    const vyber = await j('/api/admin/bookings/' + rJana.booking_id + '/collect', { method: 'POST', body: { amount: 10, method: 'cash' } }, trener);
    ok('výber sa zapíše', vyber.status === 200 && vyber.d.ok, JSON.stringify(vyber.d));

    const zoz2 = Array.isArray((await j('/api/attendance/class/qaTcTech00000001', {}, trener)).d) ? (await j('/api/attendance/class/qaTcTech00000001', {}, trener)).d : [];
    const rJana2 = zoz2.find(x => /Jana/.test(x.name || '')) || {};
    ok('po výbere už nie je „platí na mieste"', rJana2.pay_on_site === false, String(rJana2.pay_on_site));
    ok('a je zaznamenané, koľko a čím', rJana2.entry_collected && rJana2.entry_collected.amount === 10
      && rJana2.entry_collected.method === 'cash', JSON.stringify(rJana2.entry_collected));

    // ── TOTO CHÝBALO: hotovosť v evidencii trénera ──
    const cash = await j('/api/trainer/cash', {}, trener);
    ok('vybraté peniaze sú v hotovostnej evidencii', (cash.d.rows || []).length === 1, JSON.stringify(cash.d).slice(0, 120));
    ok('drží presnú sumu', cash.d.pending === 10, String(cash.d.pending));
    const zaznam = (cash.d.rows || [])[0] || {};
    ok('poznámka hovorí, za koho to je', /Jana/.test(zaznam.note || ''), zaznam.note);
    ok('je vedená ako neodovzdaná', zaznam.status === 'held', zaznam.status);

    // druhý výber sa nedá
    const znova = await j('/api/admin/bookings/' + rJana.booking_id + '/collect', { method: 'POST', body: { amount: 10, method: 'cash' } }, trener);
    ok('druhý výber pri tej istej rezervácii neprejde', znova.status === 400, JSON.stringify(znova.d));
    ok('a hotovosť sa nezdvojí', ((await j('/api/trainer/cash', {}, trener)).d.rows || []).length === 1);

    // karta sa do hotovosti nepočíta
    const vyberKarta = await j('/api/admin/bookings/' + rSona.booking_id + '/collect', { method: 'POST', body: { amount: 8, method: 'card' } }, trener);
    ok('výber kartou prejde', vyberKarta.status === 200 && vyberKarta.d.ok);
    const cash2 = await j('/api/trainer/cash', {}, trener);
    ok('karta sa do hotovosti NEpočíta', (cash2.d.rows || []).length === 1 && cash2.d.pending === 10,
      JSON.stringify({ r: (cash2.d.rows || []).length, p: cash2.d.pending }));

    // ── Marek 30. 8.: admin panel zapísal Moniku na techniku ako „kryté členstvom
    // bronze", hoci technika sa členstvom nekryje a mal pýtať hotovosť. ──
    const admin = await prihlas('qa.tc.admin@qa-biz.local');
    const cezClenstvo = await j('/api/attendance/manual-booking', { method: 'POST',
      body: { user_id: 'qaTcGold0000001', class_id: 'qaTcTech00000001', booking_date: DNES, method: 'membership' } }, admin);
    ok('technika sa NEDÁ zapísať ako krytá členstvom', cezClenstvo.status === 400
      && cezClenstvo.d.error === 'technika_nie_je_v_clenstve', JSON.stringify(cezClenstvo.d).slice(0, 120));
    ok('a rovno povie, koľko vybrať (Gold 6 €)', cezClenstvo.d.tech_price === 6, String(cezClenstvo.d.tech_price));
    const zoznamPo = (await j('/api/attendance/class/qaTcTech00000001', {}, trener)).d || [];
    ok('taká rezervácia sa vôbec nevytvorí',
      !(Array.isArray(zoznamPo) ? zoznamPo : []).some(x => /Gita/.test(x.name || '')),
      JSON.stringify((Array.isArray(zoznamPo) ? zoznamPo : []).map(x => x.name)));

    // zápis cez „platí na mieste" prejde a nesie sumu
    const cezCash = await j('/api/attendance/manual-booking', { method: 'POST',
      body: { user_id: 'qaTcGold0000001', class_id: 'qaTcTech00000001', booking_date: DNES,
              method: 'pay_on_site', pay_amount: 6 } }, admin);
    ok('zápis „platí na mieste" prejde', cezCash.status === 200 && cezCash.d.ok, JSON.stringify(cezCash.d).slice(0, 100));
    const zoznamGita = (await j('/api/attendance/class/qaTcTech00000001', {}, trener)).d || [];
    const rGita = (Array.isArray(zoznamGita) ? zoznamGita : []).find(x => /Gita/.test(x.name || '')) || {};
    ok('tréner pri nej vidí sumu na výber (6 €)', rGita.pay_on_site === true && rGita.pay_amount === 6,
      JSON.stringify({ p: rGita.pay_on_site, a: rGita.pay_amount }));

    // Zumba členstvom krytá ostáva — oprava sa nesmie preliať na bežné hodiny
    const zumba = await j('/api/attendance/manual-booking', { method: 'POST',
      body: { user_id: 'qaTcSilver00001', class_id: 'qaTcZumba0000001', booking_date: DNES, method: 'membership' } }, admin);
    ok('Zumba sa členstvom kryť MÔŽE (oprava sa netýka bežných hodín)',
      zumba.status === 200 && zumba.d.ok, JSON.stringify(zumba.d).slice(0, 100));

    // stránka admina
    const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
    ok('admin panel berie cenu zo servera, neráta ju sám',
      adminHtml.includes('st.tech_price') && !adminHtml.includes("if(/bronze/.test(m)) return 9"));
    const trenerHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'trainer.html'), 'utf8');
    ok('trénerský panel pozná techniku', trenerHtml.includes("_currentClassCategory === 'Technika'"));
    ok('a ponúka výber hotovosti so správnou cenou',
      trenerHtml.includes('showTechnikaDialog') && trenerHtml.includes('bookTechCash'));
    ok('trénerský panel tiež berie cenu zo servera', trenerHtml.includes('st.tech_price'));
    ok('a pri technike ponúka výber hotovosti', adminHtml.includes('adminShowTechnika') && adminHtml.includes('adminBookTechCash'));

    // ── storno preklepu ──
    const storno = await j('/api/admin/bookings/' + rJana.booking_id + '/collect', { method: 'DELETE' }, trener);
    ok('preklep sa dá stornovať', storno.status === 200 && storno.d.ok, JSON.stringify(storno.d));
    const cash3 = await j('/api/trainer/cash', {}, trener);
    ok('hotovosť sa po storne vráti na nulu', (cash3.d.rows || []).length === 0 && cash3.d.pending === 0,
      JSON.stringify({ r: (cash3.d.rows || []).length, p: cash3.d.pending }));
    const zoz3 = (await j('/api/attendance/class/qaTcTech00000001', {}, trener)).d || [];
    const rJana3 = (Array.isArray(zoz3) ? zoz3 : []).find(x => /Jana/.test(x.name || '')) || {};
    ok('rezervácia sa vráti do „platí na mieste"', rJana3.pay_on_site === true && !rJana3.entry_collected,
      JSON.stringify({ p: rJana3.pay_on_site, e: rJana3.entry_collected }));
    const stornoZnova = await j('/api/admin/bookings/' + rJana.booking_id + '/collect', { method: 'DELETE' }, trener);
    ok('druhé storno už nemá čo rušiť', stornoZnova.status === 404, JSON.stringify(stornoZnova.d));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    console.log('\nTECHNIKA + HOTOVOSŤ: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
