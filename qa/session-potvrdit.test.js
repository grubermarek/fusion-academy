/**
 * Spätné potvrdenie zabudnutej hodiny (Marek 12. 10. 2026: „Brezno som asi zabudol
 * potvrdiť po hodine, tie ženy na hodinách boli"). Keď sa hodina nepotvrdí, hodinu po jej
 * konci označí automat všetky rezervácie ako „neprišla" — klientky prídu o návštevu a body,
 * narastie im no_show_count a v Odídených klientoch vyzerajú, že prestali chodiť.
 *
 * Overuje POST /api/service/session-potvrdit: suchý náhľad, pripísanie návštev, zrušenie
 * neprávom pripísaných „neprišla", výnimku pre tú, čo naozaj nebola, idempotenciu
 * (druhé spustenie nezdvojí návštevy), nedotknuté zrušené rezervácie a ochrany.
 *
 * Spustenie:  node qa/session-potvrdit.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4630, BASE = 'http://localhost:' + PORT, TOKEN = 'qa-servis-token';
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-sespot-'));
let ok = 0, zle = 0;
const t = (n, c, d) => { if (c) { ok++; console.log('  ✅ ' + n); } else { zle++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const iso = p => new Date(Date.now() + p * 864e5).toISOString();
const den = p => iso(p).slice(0, 10);
const DEN = den(-5);
const poslednyStav = f => fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x))
  .reduce((a, r) => (r.$$deleted ? delete a[r._id] : a[r._id] = { ...(a[r._id] || {}), ...r }, a), {});

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaSpTrenerka001', name: 'Tina Trénerka', email: 'qa.sp2.trener@qa-biz.local', password: hash, user_type: 'trainer', active: true, created_at: '2026-01-01', referral_code: 'QASP11', onboarding_done: true },
    { _id: 'qaSpEva00000001', name: 'Eva Brezňanka', email: 'qa.sp2.eva@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QASP12', visit_count: 10, no_show_count: 3, membership_plan: 'bronze', membership_expires: iso(20) },
    { _id: 'qaSpJana00000001', name: 'Jana Brezňanka', email: 'qa.sp2.jana@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QASP13', visit_count: 5, no_show_count: 1, single_entries: 2 },
    { _id: 'qaSpNebola00001', name: 'Naozaj Nebola', email: 'qa.sp2.nebola@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QASP14', visit_count: 7, no_show_count: 2 },
    { _id: 'qaSpZrusila0001', name: 'Zrušila Rezerváciu', email: 'qa.sp2.zrusila@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QASP15', visit_count: 4, no_show_count: 0 },
  ]));
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    { _id: 'qaSpHodinaBr001', name: 'Zumba', category: 'Zumba', location: 'Brezno', day_of_week: new Date(DEN + 'T12:00:00Z').getUTCDay(), time_start: '19:00', time_end: '20:00', capacity: 30, price: 10,
      emoji: '💃', active: true, instructor: 'Tina Trénerka', instructor_id: 'qaSpTrenerka001', created_at: '2026-01-01' },
  ]));
  const bk = (id, uid, meno, extra) => ({ _id: id, class_id: 'qaSpHodinaBr001', class_name: 'Zumba', user_id: uid, user_name: meno,
    booking_date: DEN, status: 'confirmed', attendance_status: 'no_show', attendance_source: 'auto', no_show_at: DEN + 'T19:05:00.000Z', created_at: iso(-7), ...extra });
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky([
    bk('qaSpBk000000001', 'qaSpEva00000001', 'Eva Brezňanka', { access_method: 'membership' }),
    bk('qaSpBk000000002', 'qaSpJana00000001', 'Jana Brezňanka', { access_method: 'single_entry' }),
    bk('qaSpBk000000003', 'qaSpNebola00001', 'Naozaj Nebola', { access_method: 'single_entry' }),
    { _id: 'qaSpBk000000004', class_id: 'qaSpHodinaBr001', class_name: 'Zumba', user_id: 'qaSpZrusila0001', user_name: 'Zrušila Rezerváciu',
      booking_date: DEN, status: 'cancelled', attendance_status: 'cancelled', created_at: iso(-7) },
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1', 'clenstvo_na_ucte_zarovnanie_20261009']
    .map((x, i) => ({ _id: 'qaSpSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('SPÄTNÉ POTVRDENIE HODINY — štart servera (termín ' + DEN + ')…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', IMPORT_TOKEN: TOKEN }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; srv.stderr.on('data', d => { err += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + err.slice(-600)); process.exit(1); }
  await sleep(2000);

  const post = async (telo, token = TOKEN) => {
    const r = await fetch(BASE + '/api/service/session-potvrdit', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-import-token': token } : {}) }, body: JSON.stringify(telo) });
    let d = null; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };

  try {
    t('bez tokenu endpoint neexistuje (404)', (await post({ class_id: 'qaSpHodinaBr001', date: DEN }, null)).status === 404);
    const bud = await post({ class_id: 'qaSpHodinaBr001', date: den(3), apply: true });
    t('termín v budúcnosti odmietne', bud.status === 400 && /nebola/.test(bud.d.error || ''), JSON.stringify(bud.d));

    // ── náhľad
    const n = await post({ class_id: 'qaSpHodinaBr001', date: DEN });
    t('náhľad ukáže všetky tri ženy z termínu', n.status === 200 && n.d.zoznam.length === 3, JSON.stringify(n.d).slice(0, 160));
    t('náhľad vie, že ich označil automat', n.d.zoznam.every(x => x.auto_neprisla === true), JSON.stringify(n.d.zoznam.map(x => x.auto_neprisla)));
    t('náhľad zrušenú rezerváciu neberie', !n.d.zoznam.some(x => /Zrušila/.test(x.klientka)), JSON.stringify(n.d.zoznam.map(x => x.klientka)));
    t('náhľad nič nezapísal', poslednyStav('bookings.db')['qaSpBk000000001'].attendance_status === 'no_show');

    // ── potvrdenie, jedna naozaj nebola
    const a = await post({ class_id: 'qaSpHodinaBr001', date: DEN, neprisli: ['qaSpBk000000003'], apply: true, reason: 'QA' });
    t('potvrdenie pripísalo dve návštevy', a.status === 200 && a.d.pripisane === 2, JSON.stringify(a.d).slice(0, 160));
    t('zrušili sa dve neprávom pripísané „neprišla"', a.d.opravene === 2, JSON.stringify(a.d.opravene));
    const b1 = poslednyStav('bookings.db');
    t('Eve sa rezervácia prepla na odchodenú', b1['qaSpBk000000001'].status === 'attended' && b1['qaSpBk000000001'].attendance_status === 'attended', JSON.stringify(b1['qaSpBk000000001'].attendance_status));
    t('zostala stopa, že to bola oprava automatu', !!b1['qaSpBk000000001'].no_show_corrected_at, JSON.stringify(b1['qaSpBk000000001'].no_show_corrected_at));
    t('tá, čo naozaj nebola, ostala neprítomná', b1['qaSpBk000000003'].attendance_status === 'no_show' && b1['qaSpBk000000003'].status === 'confirmed');
    t('zrušená rezervácia ostala zrušená', b1['qaSpBk000000004'].status === 'cancelled');
    const u1 = poslednyStav('users.db');
    t('Eve pribudla návšteva (10 → 11)', u1['qaSpEva00000001'].visit_count === 11, String(u1['qaSpEva00000001'].visit_count));
    t('Eve ubudlo „neprišla" (3 → 2)', u1['qaSpEva00000001'].no_show_count === 2, String(u1['qaSpEva00000001'].no_show_count));
    t('Jane pribudla návšteva (5 → 6)', u1['qaSpJana00000001'].visit_count === 6, String(u1['qaSpJana00000001'].visit_count));
    t('Jane neubudli vstupy z permanentky', (u1['qaSpJana00000001'].single_entries || 0) === 2, String(u1['qaSpJana00000001'].single_entries));
    t('tej, čo nebola, sa nič nezmenilo', u1['qaSpNebola00001'].visit_count === 7 && u1['qaSpNebola00001'].no_show_count === 2,
      JSON.stringify({ v: u1['qaSpNebola00001'].visit_count, n: u1['qaSpNebola00001'].no_show_count }));

    // ── druhé spustenie nesmie nič zdvojiť
    const a2 = await post({ class_id: 'qaSpHodinaBr001', date: DEN, neprisli: ['qaSpBk000000003'], apply: true });
    t('druhé potvrdenie už nič nepripíše', a2.status === 200 && a2.d.pripisane === 0, JSON.stringify(a2.d).slice(0, 120));
    const u2 = poslednyStav('users.db');
    t('návštevy sa nezdvojili', u2['qaSpEva00000001'].visit_count === 11 && u2['qaSpJana00000001'].visit_count === 6,
      JSON.stringify({ e: u2['qaSpEva00000001'].visit_count, j: u2['qaSpJana00000001'].visit_count }));

    // ── termín bez rezervácií
    const prazdny = await post({ class_id: 'qaSpHodinaBr001', date: den(-12), apply: true });
    t('termín bez rezervácií povie, že nie je čo potvrdiť', prazdny.status === 400 && /nie je čo/.test(prazdny.d.error || ''), JSON.stringify(prazdny.d));
  } catch (e) {
    zle++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nSPÄTNÉ POTVRDENIE HODINY: ' + ok + ' OK / ' + zle + ' chýb');
    process.exit(zle ? 1 : 0);
  }
})();
