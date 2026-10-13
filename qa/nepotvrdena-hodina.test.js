/**
 * Nepotvrdená hodina sa nehádže na klientky (Marek 12. 10. 2026: „Brezno som asi zabudol
 * potvrdiť po hodine, tie ženy na hodinách boli"). Dovtedy automat hodinu po konci hodiny
 * označil VŠETKY prihlásené ako „neprišla", poslal im oznámenie a zvýšil im no_show_count —
 * aj keď hodina normálne bežala a tréner ju len nepotvrdil.
 *
 * Nové pravidlo: keď na termíne nie je ani jedna označená prítomná, automat neoznačí nikoho
 * a pripomenie trénerovi, nech hodinu potvrdí (najviac 2×, prvá aj mailom). Keď na termíne
 * niekto prítomný je (tréner alebo QR), ostatní sa ako doteraz označia ako neprítomní.
 * Online hodiny sa potvrdzujú samy pri štarte vysielania — tam pravidlo neplatí.
 *
 * Spustenie:  node qa/nepotvrdena-hodina.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4631, BASE = 'http://localhost:' + PORT;
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-nepotvr-'));
let ok = 0, zle = 0;
const t = (n, c, d) => { if (c) { ok++; console.log('  ✅ ' + n); } else { zle++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const sk = ms => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date(ms));
const VCERA = sk(Date.now() - 864e5);
const DOW = new Date(VCERA + 'T12:00:00Z').getUTCDay();
const poslednyStav = f => fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x))
  .reduce((a, r) => (r.$$deleted ? delete a[r._id] : a[r._id] = { ...(a[r._id] || {}), ...r }, a), {});
const vsetky = f => fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaNhAdmin000001', name: 'Adam Admin', email: 'qa.nh.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01', referral_code: 'QANH01' },
    { _id: 'qaNhTrener00001', name: 'Tina Trénerka', email: 'qa.nh.trener@qa-biz.local', password: hash, user_type: 'trainer', active: true, created_at: '2026-01-01', referral_code: 'QANH02', onboarding_done: true },
    { _id: 'qaNhZabud00001', name: 'Zabudnutá Prvá', email: 'qa.nh.z1@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QANH03', visit_count: 12, no_show_count: 0 },
    { _id: 'qaNhZabud00002', name: 'Zabudnutá Druhá', email: 'qa.nh.z2@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QANH04', visit_count: 9, no_show_count: 1 },
    { _id: 'qaNhPotvr00001', name: 'Prítomná Klientka', email: 'qa.nh.p1@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QANH05', visit_count: 20, no_show_count: 0 },
    { _id: 'qaNhPotvr00002', name: 'Neprítomná Klientka', email: 'qa.nh.p2@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QANH06', visit_count: 3, no_show_count: 0 },
    { _id: 'qaNhOnline00001', name: 'Online Klientka', email: 'qa.nh.o1@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QANH07', visit_count: 2, no_show_count: 0 },
  ]));
  const hod = (id, meno, loc, extra) => ({ _id: id, name: meno, category: extra?.category || 'Zumba', location: loc, day_of_week: DOW, time_start: '19:00', time_end: '20:00',
    capacity: 30, price: 10, emoji: '💃', active: true, instructor: 'Tina Trénerka', instructor_id: 'qaNhTrener00001', created_at: '2026-01-01', ...extra });
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    hod('qaNhZabudnuta1', 'Zumba', 'Brezno'),                                   // nikto neoznačený → pripomienka
    hod('qaNhPotvrdena1', 'Zumba', 'Detva'),                                    // niekto prítomný → no-show po starom
    hod('qaNhOnlineHod1', 'Online Zumba', 'Online', { category: 'Online' }),     // online → po starom
  ]));
  const rez = (id, cid, uid, meno, extra) => ({ _id: id, class_id: cid, class_name: 'Zumba', user_id: uid, user_name: meno,
    booking_date: VCERA, status: 'confirmed', attendance_status: 'pending', access_method: 'membership', created_at: '2026-10-01T10:00:00.000Z', ...extra });
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky([
    rez('qaNhBk00000001', 'qaNhZabudnuta1', 'qaNhZabud00001', 'Zabudnutá Prvá'),
    rez('qaNhBk00000002', 'qaNhZabudnuta1', 'qaNhZabud00002', 'Zabudnutá Druhá'),
    rez('qaNhBk00000003', 'qaNhPotvrdena1', 'qaNhPotvr00001', 'Prítomná Klientka', { status: 'attended', attendance_status: 'attended', attended_at: VCERA + 'T20:05:00.000Z' }),
    rez('qaNhBk00000004', 'qaNhPotvrdena1', 'qaNhPotvr00002', 'Neprítomná Klientka'),
    rez('qaNhBk00000005', 'qaNhOnlineHod1', 'qaNhOnline00001', 'Online Klientka', { class_name: 'Online Zumba' }),
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky([
    { _id: 'qaNhSetNS', key: 'no_show_from', value: sk(Date.now() - 30 * 864e5), at: '2026-01-01T00:00:00.000Z' },
    ...['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1', 'clenstvo_na_ucte_zarovnanie_20261009']
      .map((x, i) => ({ _id: 'qaNhSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' })),
  ]));

  console.log('NEPOTVRDENÁ HODINA — štart servera (termín ' + VCERA + ')…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; srv.stderr.on('data', d => { err += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + err.slice(-600)); process.exit(1); }
  await sleep(4000);   // job beží aj pri štarte

  try {
    const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'qa.nh.admin@qa-biz.local', password: 'Heslo123!' }) });
    const cookie = String(r.headers.get('set-cookie') || '').split(';')[0];
    const spusti = async () => (await fetch(BASE + '/api/admin/attendance/run-noshow', { method: 'POST', headers: { Cookie: cookie } })).json();
    const beh1 = await spusti();
    await sleep(1500);

    const b = poslednyStav('bookings.db');
    t('zabudnutá hodina: nikoho neoznačil ako neprítomnú', b['qaNhBk00000001'].attendance_status === 'pending' && b['qaNhBk00000002'].attendance_status === 'pending',
      JSON.stringify([b['qaNhBk00000001'].attendance_status, b['qaNhBk00000002'].attendance_status]));
    t('zabudnutá hodina: žiadne no_show_at', !b['qaNhBk00000001'].no_show_at && !b['qaNhBk00000002'].no_show_at);
    t('potvrdená hodina: neprítomná sa označila ako doteraz', b['qaNhBk00000004'].attendance_status === 'no_show' && !!b['qaNhBk00000004'].no_show_at, JSON.stringify(b['qaNhBk00000004'].attendance_status));
    t('online hodina ostáva po starom', b['qaNhBk00000005'].attendance_status === 'no_show', JSON.stringify(b['qaNhBk00000005'].attendance_status));
    t('job hlási len naozaj označené', beh1.ok === true && beh1.marked === 2, JSON.stringify(beh1));

    const u = poslednyStav('users.db');
    t('zabudnutým klientkam nenarástlo „neprišla"', (u['qaNhZabud00001'].no_show_count || 0) === 0 && u['qaNhZabud00002'].no_show_count === 1,
      JSON.stringify([u['qaNhZabud00001'].no_show_count, u['qaNhZabud00002'].no_show_count]));
    t('na potvrdenej hodine „neprišla" pribudlo', u['qaNhPotvr00002'].no_show_count === 1, String(u['qaNhPotvr00002'].no_show_count));

    const ozn = vsetky('notifications.db');
    const klientkam = ozn.filter(n => ['qaNhZabud00001', 'qaNhZabud00002'].includes(n.user_id) && /Nezachytili/.test(n.title || ''));
    t('zabudnutým klientkam neprišlo „Nezachytili sme ťa"', klientkam.length === 0, String(klientkam.length));
    const trenerovi = ozn.filter(n => n.user_id === 'qaNhTrener00001' && /Potvrď dochádzku/.test(n.title || ''));
    t('tréner dostal pripomienku potvrdiť hodinu', trenerovi.length === 1, JSON.stringify(trenerovi.map(x => x.title)));
    t('v pripomienke je mesto, dátum aj počet prihlásených', trenerovi[0] && /Brezno/.test(trenerovi[0].body) && /2 prihlásen/.test(trenerovi[0].body), trenerovi[0] && trenerovi[0].body);
    t('za potvrdenú hodinu pripomienka nechodí', !ozn.some(n => n.user_id === 'qaNhTrener00001' && /Potvrď dochádzku/.test(n.title || '') && /Detva/.test(n.body || '')));

    const s = vsetky('settings.db').filter(x => String(x.key || '').startsWith('potvrd_pripomienka:'));
    t('pripomienka má zápis proti opakovaniu', s.length === 1 && s[s.length - 1].value.n === 1, JSON.stringify(s.map(x => [x.key, x.value])));

    // druhé spustenie do 12 h už pripomienku neopakuje a stále nikoho neoznačí
    const beh2 = await spusti();
    await sleep(1500);
    const ozn2 = vsetky('notifications.db').filter(n => n.user_id === 'qaNhTrener00001' && /Potvrď dochádzku/.test(n.title || ''));
    t('druhé spustenie pripomienku neopakuje', ozn2.length === 1, String(ozn2.length));
    t('druhé spustenie nikoho neoznačí', beh2.marked === 0 && poslednyStav('bookings.db')['qaNhBk00000001'].attendance_status === 'pending', JSON.stringify(beh2));

    // keď tréner hodinu potvrdí (hoci len jednu klientku), zvyšok sa po starom označí
    const src = fs.readFileSync(path.join(KOREN, 'server.js'), 'utf8');
    t('pravidlo sa nevzťahuje na online hodiny', /cls\.category!=='Online'[\s\S]{0,200}potvrdene\[kl\]/.test(src), 'podmienka v markNoShows');
    t('detské rezervácie sa spracujú ako prvé', /auto_kids\?1:0\)-\(a\.auto_kids\?1:0\)/.test(src), 'poradie rows');
  } catch (e) {
    zle++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nNEPOTVRDENÁ HODINA: ' + ok + ' OK / ' + zle + ' chýb');
    process.exit(zle ? 1 : 0);
  }
})();
