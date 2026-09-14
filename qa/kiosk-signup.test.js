/**
 * Kiosk: zápis na dnešné tréningy cez checkboxy (Marek 30. 8. 2026, prerobené po audite 14. 9.).
 * Sken QR → zoznam dnešných hodín → zaškrtnutie → zápis.
 *
 * Stráži:
 *   · krytie sa počíta dopredu na VŠETKY vybrané (členstvo → prvá zdarma → kredit → vstup),
 *     čo nič nekryje, to sa najprv ponúkne v hotovosti (402 ask_cash) — nikdy nie polovičný zápis
 *   · skončené hodiny sa ponúkajú a zapíše sa na ne účasť (Marek 14. 9.: zapisujú sa aj po tréningu)
 *   · technika sa ponúka s cenou podľa členstva (členstvo ju nekryje)
 *   · zrušená hodina sa neponúka ani nezapíše, detská len deťom, dospelá len dospelým
 *   · dve odchodené hodiny naraz = dve návštevy
 *   · rezervovaná hodina z appky, ktorá už začala alebo skončila, sa zapíše ako účasť (aj oprava no-show)
 *
 * Spustenie:  node qa/kiosk-signup.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4518;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-ks-'));

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
const rd = f => { const p = path.join(DATA, f); if (!fs.existsSync(p)) return []; const m = new Map();
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l.trim()) continue; let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o.$$indexCreated) continue; if (o.$$deleted) { m.delete(o._id); continue; } m.set(o._id, o); } return [...m.values()]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const DOW = new Date().getDay();
  const hash = bcrypt.hashSync('Heslo123!', 10);

  const U = (id, meno, kod, extra = {}) => JSON.stringify({
    _id: id, name: meno, email: id.toLowerCase() + '@qa-biz.local', password: hash, referral_code: kod,
    user_type: 'client', active: true, is_admin: false, visit_count: 2, created_at: '2026-07-01',
    city: 'Detva', account_creation_type: 'self_registration', free_class_used: true,
    free_credits: 0, single_entries: 0, ...extra,
  });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaKsAdmin0000001', name: 'Adam Kioskovy', email: 'qa.ks.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-06-01' }),
    U('qaKsClenka00001', 'Klara Clenka', 'QAKS01'),                       // Silver → Zumba zdarma, technika 7 €
    U('qaKsDvaVstupy01', 'Dana Dvojvstup', 'QAKS02', { single_entries: 2 }),
    U('qaKsBezNicoho01', 'Bara Prazdna', 'QAKS03'),                       // nič nemá → hotovosť
    U('qaKsPrvaZdarma1', 'Petra Prva', 'QAKS04', { free_class_used: false }),
    U('qaKsRezervov001', 'Rada Rezervovana', 'QAKS05', { visit_count: 4, no_show_count: 1 }),
    U('qaKsRodic000001', 'Renata Rodicova', 'QAKS06'),
    U('qaKsDieta000001', 'Danka Dieta', 'QAKS07', { is_child: true, parent_id: 'qaKsRodic000001', email: 'dieta.qaks@internal.local', single_entries: 3 }),
  ].join('\n') + '\n');

  fs.writeFileSync(path.join(DATA, 'memberships.db'), JSON.stringify({ _id: 'qaKsMem00000002', user_id: 'qaKsRezervov001', plan_id: 'bronze', status: 'active', started_at: '2026-08-01', expires_at: '2026-12-31', price: 50 }) + '\n' + JSON.stringify({
    _id: 'qaKsMem00000001', user_id: 'qaKsClenka00001', plan_id: 'silver', status: 'active',
    started_at: '2026-08-01', expires_at: '2026-12-31', price: 69,
  }) + '\n');

  const C = (id, meno, start, end, extra = {}) => JSON.stringify({
    _id: id, name: meno, emoji: '🎵', category: 'Zumba', instructor: 'Marek Gruber',
    location: 'Detva', address: 'Záhradná 7, Detva', day_of_week: DOW,
    time_start: start, time_end: end, capacity: 30, level: 'Všetky úrovne',
    description: '', price: 10, color: '#C9A84C', active: true, ...extra,
  });
  // Časy odvodené od aktuálnej hodiny, nech test nezávisí od toho, kedy beží.
  const teraz = new Date();
  const nowMin = teraz.getHours() * 60 + teraz.getMinutes();
  const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const MIMO_CASU = nowMin < 150 || nowMin + 200 > 23 * 60 + 30;   // skoro ráno / neskoro večer by hodiny pretiekli cez polnoc
  const t0 = nowMin - 130, t1 = nowMin - 10, t2 = nowMin + 60, t3 = nowMin + 130;
  fs.writeFileSync(path.join(DATA, 'classes.db'), [
    C('qaKsCls00000000', 'Zumba ranná', hhmm(t0), hhmm(t0 + 55)),     // skončila pred ~75 min
    C('qaKsCls00000001', 'Zumba prvá', hhmm(t1), hhmm(t1 + 55)),      // práve beží
    C('qaKsClsChvila1', 'Zumba o chvíľu', hhmm(nowMin + 10), hhmm(nowMin + 65)),   // prekrýva sa s prvou, začína o 10 min
    C('qaKsCls00000002', 'Zumba druhá', hhmm(t2), hhmm(t2 + 55)),
    C('qaKsCls00000003', 'Zumba tretia', hhmm(t3), hhmm(t3 + 55)),
    C('qaKsClsTech0001', 'Technický tréning', hhmm(t2), hhmm(t2 + 55), { category: 'Technika' }),
    C('qaKsClsKids0001', 'Zumba Kids', hhmm(t2), hhmm(t2 + 45), { category: 'Deti', price: 9 }),
    C('qaKsClsZrus0001', 'Zumba zrušená', hhmm(t3), hhmm(t3 + 55)),
    C('qaKsClsOnline01', 'Zumba ONLINE', hhmm(t2), hhmm(t2 + 55), { category: 'Online', location: 'Online' }),
    C('qaKsClsZvolen01', 'Zumba Zvolen', hhmm(t2), hhmm(t2 + 55), { location: 'Zvolen' }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(DATA, 'class_cancellations.db'), JSON.stringify({ _id: 'qaKsZrusenie001', class_id: 'qaKsClsZrus0001', class_name: 'Zumba zrušená', date: DNES, location: 'Detva', reason: 'test', created_at: DNES + 'T06:00:00.000Z' }) + '\n');

  // Rada má z appky rezervovanú rannú (už ju job označil no-show), bežiacu aj neskoršiu
  const BK = (id, cls, meno, extra = {}) => JSON.stringify({ _id: id, class_id: cls, class_name: meno, user_id: 'qaKsRezervov001', user_name: 'Rada Rezervovana', booking_date: DNES, status: 'confirmed', attendance_status: 'pending', access_method: 'membership', created_at: DNES + 'T06:00:00.000Z', ...extra });
  fs.writeFileSync(path.join(DATA, 'bookings.db'), [
    BK('qaKsBkRada0000', 'qaKsCls00000000', 'Zumba ranná', { attendance_status: 'no_show' }),
    BK('qaKsBkRada0001', 'qaKsCls00000001', 'Zumba prvá'),
    BK('qaKsBkRada0002', 'qaKsCls00000002', 'Zumba druhá'),
  ].join('\n') + '\n');
  const pm = new Date(+DNES.slice(0, 4), +DNES.slice(5, 7) - 2, 1);
  fs.writeFileSync(path.join(DATA, 'monthly_winners.db'), JSON.stringify({ _id: 'qaKsMW01', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'x', created_at: '2026-01-01' }) + '\n');
  fs.writeFileSync(path.join(DATA, 'settings.db'), JSON.stringify({ _id: 'qaKsSet1', key: 'retro_confirm_v1', value: true, at: '2026-01-01T00:00:00.000Z' }) + '\n');

  if (MIMO_CASU) { console.log('  ⏭️  test beží skoro ráno alebo neskoro večer — hodiny by pretiekli cez polnoc, spusti ho cez deň'); process.exit(0); }

  console.log('KIOSK PRIHLÁSENIE QA — štart servera…');
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' };
  delete env.PRVY_TYZDEN;
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: 'ignore' });
  const tStart = Date.now();
  let zije = false;
  while (Date.now() - tStart < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol do 180 s'); process.exit(1); }
  await sleep(4000);

  try {
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.ks.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    const kcfg = await j('/api/admin/kiosk', {}, adm);
    const detva = ((kcfg.d && kcfg.d.studios) || []).find(x => /detva/i.test(x.slug + ' ' + x.city));
    ok('kiosk Detva existuje', !!detva, JSON.stringify((kcfg.d && kcfg.d.studios || []).map(x => x.slug)));
    if (!detva) throw new Error('bez kiosku sa ďalej nedá');
    await j('/api/admin/kiosk/' + detva.slug, { method: 'PUT', body: { enabled: true } }, adm);
    const K = detva.token, ST = detva.slug;

    const zoznam = (qr) => j('/api/kiosk/day-classes', { method: 'POST', body: { studio: ST, k: K, qr_data: qr } });
    const prihlas = (qr, ids, extra = {}) => j('/api/kiosk/signup', { method: 'POST', body: { studio: ST, k: K, qr_data: qr, class_ids: ids, ...extra } });
    const bez = list => (list || []).filter(c => !c.tech);

    // ── zoznam hodín ──
    const z = await zoznam('FA:qaKsClenka00001');
    ok('zoznam sa načíta po QR', z.status === 200 && z.d && z.d.ok, JSON.stringify(z.d).slice(0, 140));
    const mena = (z.d.classes || []).map(c => c.name);
    const podla = n => (z.d.classes || []).find(c => c.name === n) || {};
    ok('ponúka dnešné hodiny v Detve', mena.includes('Zumba prvá') && mena.includes('Zumba tretia'), JSON.stringify(mena));
    ok('bežiaca hodina je „teraz" a zapíše sa účasť', podla('Zumba prvá').teraz === true && podla('Zumba prvá').ucast === true);
    ok('pri prekrytí je predznačená len hodina, ktorá začína najneskôr', podla('Zumba o chvíľu').predznacit === true && podla('Zumba prvá').predznacit === false && (z.d.classes || []).filter(c => c.predznacit).length === 1, JSON.stringify((z.d.classes || []).map(c => c.name + ':' + c.predznacit)));
    ok('ponúka aj skončenú hodinu, na ktorú zapíše účasť', podla('Zumba ranná').prebehla === true && podla('Zumba ranná').ucast === true && !podla('Zumba ranná').teraz, JSON.stringify(podla('Zumba ranná')));
    ok('neskoršia hodina sa zapíše ako rezervácia', podla('Zumba tretia').ucast === false);
    ok('ponúka techniku s cenou podľa členstva (Silver 7 €)', podla('Technický tréning').tech === true && podla('Technický tréning').cena_hotovost === 7, JSON.stringify(podla('Technický tréning')));
    ok('NEponúka zrušenú hodinu', !mena.includes('Zumba zrušená'), JSON.stringify(mena));
    ok('dospelej NEponúka detskú hodinu', !mena.includes('Zumba Kids'), JSON.stringify(mena));
    ok('NEponúka online hodinu', !mena.some(m => /ONLINE/i.test(m)), JSON.stringify(mena));
    ok('NEponúka hodinu z iného mesta', !mena.includes('Zumba Zvolen'), JSON.stringify(mena));
    ok('pri každej hodine je čas aj voľné miesta', (z.d.classes || []).every(c => c.time_start && typeof c.volnych === 'number'));
    ok('členke povie, že má členstvo', z.d.krytie && z.d.krytie.clenstvo === true, JSON.stringify(z.d.krytie));

    const zlyQr = await zoznam('FA:neexistuje');
    ok('neznámy QR je odmietnutý', zlyQr.status === 404, JSON.stringify(zlyQr.d));
    const bezKluca = await j('/api/kiosk/day-classes', { method: 'POST', body: { studio: ST, k: 'zly', qr_data: 'FA:qaKsClenka00001' } });
    ok('bez platného kľúča kiosku to nejde', bezKluca.status === 403, String(bezKluca.status));

    // ── členka: všetky Zumby naraz vrátane skončenej, nič sa nestrháva ──
    const zumby = bez(z.d.classes).map(c => c.id);
    const p1 = await prihlas('FA:qaKsClenka00001', zumby);
    ok('členka sa zapíše na všetky Zumby naraz', p1.status === 200 && p1.d.ok && (p1.d.zapisane || []).length === zumby.length, JSON.stringify(p1.d).slice(0, 160));
    ok('členke neubudli vstupy ani nič neplatí', p1.d.krytie.clenstvo === true && p1.d.hotovost_spolu === 0);
    ok('skončená, bežiaca a začínajúca = tri návštevy naraz (2 → 5)', p1.d.user && p1.d.user.visit_count === 5, JSON.stringify(p1.d.user && p1.d.user.visit_count));
    const z2 = await zoznam('FA:qaKsClenka00001');
    const z2p = n => (z2.d.classes || []).find(c => c.name === n) || {};
    ok('skončená aj bežiaca sú „attended", neskoršie „booked"', z2p('Zumba ranná').moja === 'attended' && z2p('Zumba prvá').moja === 'attended' && z2p('Zumba tretia').moja === 'booked', JSON.stringify((z2.d.classes || []).map(c => c.name + ':' + c.moja)));
    const p1b = await prihlas('FA:qaKsClenka00001', zumby);
    ok('opakovaný zápis nič nezdvojí', (p1b.d.zapisane || []).length === 0 && p1b.d.uz_mala === zumby.length, JSON.stringify({ z: (p1b.d.zapisane || []).length, u: p1b.d.uz_mala }));

    // ── členka na technike: otázka na hotovosť 7 €, bez potvrdenia nič ──
    const pt = await prihlas('FA:qaKsClenka00001', ['qaKsClsTech0001']);
    ok('technika členke: 402 otázka na hotovosť 7 €', pt.status === 402 && pt.d.ask_cash === true && pt.d.spolu === 7 && pt.d.hotovost[0].tech === true && /technický tréning členstvo nekryje/.test(pt.d.error), JSON.stringify(pt.d).slice(0, 200));
    ok('bez potvrdenia sa technika nezapísala', !rd('bookings.db').some(b => b.user_id === 'qaKsClenka00001' && b.class_id === 'qaKsClsTech0001'));
    const pt2 = await prihlas('FA:qaKsClenka00001', ['qaKsClsTech0001'], { pay_on_site: true });
    await sleep(300);
    const bkT = rd('bookings.db').find(b => b.user_id === 'qaKsClenka00001' && b.class_id === 'qaKsClsTech0001');
    ok('po potvrdení technika „platí na mieste" 7 €', pt2.status === 200 && pt2.d.hotovost_spolu === 7 && bkT && bkT.pay_on_site === true && +bkT.pay_amount === 7 && bkT.access_method === 'pay_on_site' && bkT.status === 'confirmed', JSON.stringify(bkT && { pos: bkT.pay_on_site, a: bkT.pay_amount, s: bkT.status }));
    ok('tréner / admin dostal oznam vybrať 7 €', rd('notifications.db').some(n => n.type === 'pay_on_site' && /vybrať 7 €/.test(n.title) && /Klara/.test(n.title)));

    // ── dva vstupy, tri hodiny → otázka na hotovosť za tretiu, nič polovičné ──
    const zD = await zoznam('FA:qaKsDvaVstupy01');
    const tri = bez(zD.d.classes).slice(0, 3).map(c => c.id);
    ok('má na výber aspoň tri Zumby', tri.length === 3, String(tri.length));
    const pMalo = await prihlas('FA:qaKsDvaVstupy01', tri);
    ok('tri hodiny s dvoma vstupmi = otázka na hotovosť za jednu (10 €)', pMalo.status === 402 && pMalo.d.ask_cash === true && pMalo.d.hotovost.length === 1 && pMalo.d.spolu === 10 && pMalo.d.potrebne === 3 && pMalo.d.mas === 2, JSON.stringify(pMalo.d).slice(0, 200));
    const zD2 = await zoznam('FA:qaKsDvaVstupy01');
    ok('bez potvrdenia sa NIČ nezapísalo a nestrhol sa vstup', bez(zD2.d.classes).every(c => !c.moja) && zD2.d.krytie.vstupy === 2, JSON.stringify(zD2.d.krytie));
    const pAno = await prihlas('FA:qaKsDvaVstupy01', tri, { pay_on_site: true });
    ok('po potvrdení zapísané všetky tri, dve zo vstupov a jedna v hotovosti', pAno.status === 200 && (pAno.d.zapisane || []).length === 3 && pAno.d.krytie.vstupy === 0 && pAno.d.zapisane.filter(x => x.hotovost === 10).length === 1 && pAno.d.hotovost_spolu === 10, JSON.stringify(pAno.d).slice(0, 220));

    // ── prvá hodina zadarmo sa spotrebuje ako prvá ──
    const zP = await zoznam('FA:qaKsPrvaZdarma1');
    ok('vidí, že má prvú zdarma', zP.d.krytie.prva_zdarma === true, JSON.stringify(zP.d.krytie));
    const pP = await prihlas('FA:qaKsPrvaZdarma1', ['qaKsCls00000002']);
    ok('zapísala sa na prvú zdarma a spotrebovala sa', pP.status === 200 && (pP.d.zapisane || []).length === 1 && pP.d.krytie.prva_zdarma === false, JSON.stringify(pP.d.krytie));

    // ── bez vstupov: hotovosť namiesto slepej uličky ──
    const pB = await prihlas('FA:qaKsBezNicoho01', ['qaKsCls00000001']);
    ok('bez vstupov 402 s otázkou na hotovosť 10 €', pB.status === 402 && pB.d.ask_cash === true && pB.d.spolu === 10 && /trénerovi/.test(pB.d.error || ''), JSON.stringify(pB.d).slice(0, 160));
    const pB2 = await prihlas('FA:qaKsBezNicoho01', ['qaKsCls00000001'], { pay_on_site: true });
    await sleep(300);
    const bkB = rd('bookings.db').find(b => b.user_id === 'qaKsBezNicoho01');
    ok('po potvrdení účasť „platí na mieste" 10 €', pB2.status === 200 && bkB && bkB.status === 'attended' && bkB.pay_on_site === true && +bkB.pay_amount === 10, JSON.stringify(bkB && { s: bkB.status, a: bkB.pay_amount }));

    // ── rezervovaná z appky: skončená (no-show) aj bežiaca sa zapíšu ako účasť, neskoršia nie ──
    const zR = await zoznam('FA:qaKsRezervov001');
    const rr = id => (zR.d.classes || []).find(c => c.id === id) || {};
    ok('rezervované: ranná a bežiaca sa dajú zaškrtnúť (ucast), neskoršia nie', rr('qaKsCls00000000').moja === 'booked' && rr('qaKsCls00000000').ucast && rr('qaKsCls00000001').ucast && rr('qaKsCls00000002').moja === 'booked' && !rr('qaKsCls00000002').ucast);
    ok('predznačená je rezervovaná bežiaca hodina, nie tá, čo začína neskôr', rr('qaKsCls00000001').predznacit === true && rr('qaKsClsChvila1').predznacit === false, JSON.stringify((zR.d.classes || []).map(c => c.name + ':' + c.predznacit)));
    const pR = await prihlas('FA:qaKsRezervov001', ['qaKsCls00000000', 'qaKsCls00000001', 'qaKsCls00000002']);
    ok('ranná aj bežiaca zapísané ako účasť, neskoršia sa nezdvojí', pR.status === 200 && (pR.d.zapisane || []).length === 2 && pR.d.zapisane.every(x => x.teraz) && pR.d.uz_mala === 1, JSON.stringify(pR.d).slice(0, 200));
    ok('dve návštevy pribudli (4 → 6)', pR.d.user && pR.d.user.visit_count === 6, JSON.stringify(pR.d.user && pR.d.user.visit_count));
    const bkRanna = rd('bookings.db').find(b => b._id === 'qaKsBkRada0000');
    const uRada = rd('users.db').find(u => u._id === 'qaKsRezervov001');
    ok('no-show rannej hodiny opravený a počítadlo znížené', bkRanna && bkRanna.attendance_status === 'attended' && !!bkRanna.no_show_corrected_at && uRada.no_show_count === 0, JSON.stringify(bkRanna && { a: bkRanna.attendance_status, n: uRada.no_show_count }));

    // ── zrušená, detská, ochrany ──
    const pZrus = await prihlas('FA:qaKsClenka00001', ['qaKsClsZrus0001']);
    ok('zrušená hodina sa zapísať nedá a povie prečo', pZrus.status === 400 && /zrušená/.test(pZrus.d.error || ''), JSON.stringify(pZrus.d));
    const zK = await zoznam('FA:qaKsDieta000001');
    ok('dieťaťu ponúka len detskú hodinu', JSON.stringify((zK.d.classes || []).map(c => c.name)) === JSON.stringify(['Zumba Kids']), JSON.stringify((zK.d.classes || []).map(c => c.name)));
    ok('dieťa sa nezapíše na dospelú hodinu', (await prihlas('FA:qaKsDieta000001', ['qaKsCls00000002'])).status === 400);
    ok('dospelá sa nezapíše na detskú hodinu', (await prihlas('FA:qaKsPrvaZdarma1', ['qaKsClsKids0001'])).status === 400);
    const pKid = await prihlas('FA:qaKsDieta000001', ['qaKsClsKids0001']);
    ok('dieťa sa zapíše na detskú hodinu zo svojich vstupov', pKid.status === 200 && pKid.d.krytie.vstupy === 2, JSON.stringify(pKid.d).slice(0, 140));
    ok('prázdny výber je odmietnutý', (await prihlas('FA:qaKsClenka00001', [])).status === 400);
    ok('online hodina sa zapísať nedá', (await prihlas('FA:qaKsPrvaZdarma1', ['qaKsClsOnline01'])).status === 400);
    ok('hodina z iného mesta sa zapísať nedá', (await prihlas('FA:qaKsPrvaZdarma1', ['qaKsClsZvolen01'])).status === 400);

    // ── stránka kiosku ──
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'kiosk.html'), 'utf8');
    ok('plocha má jedinú výzvu a vedie rovno na výber hodín', (html.match(/onclick="openScan\(/g) || []).length === 1 && html.includes(`onclick="openScan('signup')"`));
    ok('po skene rovno zoznam, bez starej otázky na jednu hodinu', html.includes('await nacitajHodiny(txt)') && !html.includes('showClassChoice'));
    ok('výber je cez zaškrtávacie políčka', html.includes('prepniHodinu') && html.includes('class="box"'));
    ok('predznačenie berie kiosk zo servera (jedna hodina)', html.includes('if(c.predznacit)') && html.includes("začína o '+c.za_min+' min"));
    ok('texty stavov: skončená, rezervovaná, rezervovaná neskôr', html.includes('hodina už skončila — zapíšeme ti účasť') && html.includes('máš rezervované — zapíšeme ti účasť') && html.includes('keď prídeš, naskenuj QR a zapíšeme ti účasť') && html.includes('.pk.ok{'));
    ok('otázka na hotovosť vo výbere', html.includes('Áno, zaplatím') && html.includes('pay_on_site:true') && html.includes('d.ask_cash'));
    ok('chybová hláška sa neprepíše vykreslením', html.includes("až po vykreslení, inak by hlášku prepísal"));
    ok('automatické zatvorenie výberu, skenu aj registrácie', html.includes('VYBER_IDLE_MS=45000') && html.includes('zavriVyber();') && html.includes('zavriRegistraciu();'));
    ok('tlačidlo „Ešte nemám účet" s QR na registráciu', html.includes('Ešte nemám účet') && html.includes('utm_source=kiosk'));
    ok('ukazuje, koľko vstupov zostáva a koľko zaplatí', html.includes('Zostáva ti ') && html.includes('Trénerovi zaplatíš'));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    srv.kill();
    console.log('\nKIOSK PRIHLÁSENIE: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 500);
  }
})();
