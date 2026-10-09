/**
 * Koniec členstva na účte musí držať krok s členstvom (Marek 9. 10. 2026 — vyšlo pri
 * kontrole Stripe obnov: 15 klientok malo na členstve neskorší dátum ako na účte, lebo
 * kompenzačné dni za zrušenú hodinu sa pripisovali len na členstvo).
 *
 * Overuje: jednorazové zarovnanie pri štarte (vrátane účtu bez dátumu), že permanentka
 * dátum na účte nenastavuje, že zarovnanie nikomu dátum neskráti, že kompenzácia za
 * zrušenú hodinu predĺži členstvo AJ účet, a že si to appka sama dorovná pri ďalšom
 * čítaní členstva (druhý beh servera, keď je migrácia už odškrtnutá).
 *
 * Spustenie:  node qa/clenstvo-na-ucte.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4627, BASE = 'http://localhost:' + PORT;
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-clen-'));
let ok = 0, zle = 0;
const t = (n, c, d) => { if (c) { ok++; console.log('  ✅ ' + n); } else { zle++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const sk = ms => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date(ms));
const DNES = sk(Date.now());
const DOW = new Date(DNES + 'T12:00:00Z').getUTCDay();
const iso = p => new Date(Date.now() + p * 864e5).toISOString();
const den = p => iso(p).slice(0, 10);

const subor = (f, arr) => fs.writeFileSync(path.join(DATA, f), riadky(arr));
const citaj = f => fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));
// NeDB dopisuje zmeny na konec súboru — platí posledný záznam s daným _id
const poslednyStav = f => citaj(f).reduce((a, r) => (r.$$deleted ? delete a[r._id] : a[r._id] = { ...(a[r._id] || {}), ...r }, a), {});

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  subor('users.db', [
    { _id: 'qaZaTrener00001', name: 'Tina Trénerka', email: 'qa.za.trener@qa-biz.local', password: hash, user_type: 'trainer', active: true, created_at: '2026-01-01', referral_code: 'QAZA01', onboarding_done: true },
    // na členstve +10 dní, na účte len +6 → zarovnanie musí dotiahnuť účet
    { _id: 'qaZaRozdiel0001', name: 'Rozdielna Klientka', email: 'qa.za.rozdiel@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAZA02', membership_plan: 'bronze', membership_expires: iso(6) },
    // účet bez dátumu, členstvo beží
    { _id: 'qaZaPrazdny0001', name: 'Prázdny Účet', email: 'qa.za.prazdny@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAZA03' },
    // len permanentka → účet musí ostať bez dátumu členstva
    { _id: 'qaZaBundle00001', name: 'Permanentková Klientka', email: 'qa.za.bundle@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAZA04', single_entries: 10 },
    // kompenzácia za zrušenú hodinu
    { _id: 'qaZaKomp0000001', name: 'Kompenzovaná Klientka', email: 'qa.za.komp@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAZA05', membership_plan: 'bronze', membership_expires: iso(10) },
    // na účte neskorší dátum ako na členstve → zarovnanie ho NESMIE skrátiť
    { _id: 'qaZaNeskrat0001', name: 'Neskrátená Klientka', email: 'qa.za.neskrat@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAZA06', membership_plan: 'bronze', membership_expires: iso(30) },
  ]);
  subor('memberships.db', [
    { _id: 'qaZaMem00000001', user_id: 'qaZaRozdiel0001', plan_id: 'bronze', plan_name: 'Bronze', price: 49.9, status: 'active', started_at: iso(-20), expires_at: iso(10), created_at: den(-20) },
    { _id: 'qaZaMem00000002', user_id: 'qaZaPrazdny0001', plan_id: 'bronze', plan_name: 'Bronze', price: 49.9, status: 'active', started_at: iso(-25), expires_at: iso(5), created_at: den(-25) },
    { _id: 'qaZaMem00000003', user_id: 'qaZaBundle00001', plan_id: 'permanentka10', plan_name: 'Permanentka 10', price: 85, status: 'active', started_at: iso(-10), expires_at: iso(20), created_at: den(-10) },
    { _id: 'qaZaMem00000004', user_id: 'qaZaKomp0000001', plan_id: 'bronze', plan_name: 'Bronze', price: 49.9, status: 'active', started_at: iso(-20), expires_at: iso(10), created_at: den(-20) },
    { _id: 'qaZaMem00000005', user_id: 'qaZaNeskrat0001', plan_id: 'bronze', plan_name: 'Bronze', price: 49.9, status: 'active', started_at: iso(-20), expires_at: iso(12), created_at: den(-20) },
    // analýza tela nie je členstvo — zarovnanie si ju nesmie vziať ako koniec členstva
    { _id: 'qaZaMem00000006', user_id: 'qaZaRozdiel0001', _type: 'body_analysis', status: 'active', expires_at: iso(99), created_at: den(-5) },
  ]);
  subor('classes.db', [
    { _id: 'qaZaHodina00001', name: 'Zumba', category: 'Zumba', location: 'Detva', day_of_week: DOW, time_start: '19:00', time_end: '20:00', capacity: 30, price: 10,
      emoji: '💃', active: true, instructor: 'Tina Trénerka', instructor_id: 'qaZaTrener00001', created_at: '2026-01-01' },
  ]);
  subor('bookings.db', [
    { _id: 'qaZaBk000000001', user_id: 'qaZaKomp0000001', user_name: 'Kompenzovaná Klientka', class_id: 'qaZaHodina00001', class_name: 'Zumba', booking_date: DNES, status: 'confirmed', access_method: 'membership', created_at: iso(-2) },
  ]);
  subor('settings.db', ['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1']
    .map((x, i) => ({ _id: 'qaZaSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' })));

  const start = async popis => {
    console.log(popis);
    const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
      env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; srv.stderr.on('data', d => { err += d; });
    const t0 = Date.now(); let zije = false;
    while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
    if (!zije) { console.log('  ❌ server nenabehol\n' + err.slice(-600)); process.exit(1); }
    return srv;
  };
  const prihlas = async email => { const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Heslo123!' }) }); return String(r.headers.get('set-cookie') || '').split(';')[0]; };
  const get = async (cesta, c) => (await fetch(BASE + cesta, { headers: c ? { Cookie: c } : {} })).json();
  const post = async (cesta, telo, c) => { const r = await fetch(BASE + cesta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) }, body: JSON.stringify(telo) }); let d = null; try { d = await r.json(); } catch (e) {} return { status: r.status, d }; };

  let srv = await start('ČLENSTVO NA ÚČTE — prvý beh (jednorazové zarovnanie)…');
  try {
    await sleep(13000);   // migrácia štartuje 9 s po nábehu

    // ── jednorazové zarovnanie pri štarte
    const u1 = poslednyStav('users.db');
    t('rozdielnej klientke sa účet dotiahol na koniec členstva', String(u1['qaZaRozdiel0001'].membership_expires).slice(0, 10) === den(10),
      'účet ' + String(u1['qaZaRozdiel0001'].membership_expires).slice(0, 10) + ', členstvo ' + den(10));
    t('prázdnemu účtu sa dátum doplnil', String(u1['qaZaPrazdny0001'].membership_expires || '').slice(0, 10) === den(5), JSON.stringify(u1['qaZaPrazdny0001'].membership_expires));
    t('prázdnemu účtu sa doplnil aj plán', u1['qaZaPrazdny0001'].membership_plan === 'bronze', JSON.stringify(u1['qaZaPrazdny0001'].membership_plan));
    t('permanentka dátum členstva na účte nenastavila', !u1['qaZaBundle00001'].membership_expires, JSON.stringify(u1['qaZaBundle00001'].membership_expires));
    t('neskorší dátum na účte sa neskrátil', String(u1['qaZaNeskrat0001'].membership_expires).slice(0, 10) === den(30),
      'účet ' + String(u1['qaZaNeskrat0001'].membership_expires).slice(0, 10) + ' (členstvo ' + den(12) + ')');
    t('analýza tela sa nebrala ako členstvo', String(u1['qaZaRozdiel0001'].membership_expires).slice(0, 10) !== den(99), JSON.stringify(u1['qaZaRozdiel0001'].membership_expires));
    const m1 = poslednyStav('memberships.db');
    t('samotné členstvá sa zarovnaním nezmenili', String(m1['qaZaMem00000001'].expires_at).slice(0, 10) === den(10) && String(m1['qaZaMem00000005'].expires_at).slice(0, 10) === den(12),
      JSON.stringify([m1['qaZaMem00000001'].expires_at, m1['qaZaMem00000005'].expires_at]));
    const nastavenia = Object.values(poslednyStav('settings.db')).map(s => s.key);
    t('zarovnanie sa odškrtlo (druhý štart ho nepustí znova)', nastavenia.includes('clenstvo_na_ucte_zarovnanie_20261009'), JSON.stringify(nastavenia.slice(-3)));

    // ── kompenzácia za zrušenú hodinu predĺži členstvo AJ účet
    const cTrener = await prihlas('qa.za.trener@qa-biz.local');
    const komp = await post('/api/attendance/cancel-compensate', { class_id: 'qaZaHodina00001', date: DNES, days: 4, scope: 'booked' }, cTrener);
    t('kompenzácia prebehla pre prihlásenú klientku', komp.status === 200 && (komp.d.extended || []).length === 1, JSON.stringify(komp.d).slice(0, 160));
    const u2 = poslednyStav('users.db'), m2 = poslednyStav('memberships.db');
    t('členstvo sa predĺžilo o 4 dni', String(m2['qaZaMem00000004'].expires_at).slice(0, 10) === den(14), String(m2['qaZaMem00000004'].expires_at).slice(0, 10));
    t('účet ukazuje ten istý koniec ako členstvo', String(u2['qaZaKomp0000001'].membership_expires).slice(0, 10) === den(14), String(u2['qaZaKomp0000001'].membership_expires).slice(0, 10));
    const cKomp = await prihlas('qa.za.komp@qa-biz.local');
    const mem = await get('/api/membership', cKomp);
    t('klientke sa členstvo hlási ako aktívne do nového dátumu', String(mem.membership?.expires_at || '').slice(0, 10) === den(14), JSON.stringify(mem.membership?.expires_at));
    t('kompenzácia je zapísaná v histórii členstva', (m2['qaZaMem00000004'].kompenzacie || []).length === 1 && m2['qaZaMem00000004'].kompenzacie[0].days === 4, JSON.stringify(m2['qaZaMem00000004'].kompenzacie || []));

    // ── zarovnanie sa už nepustí druhý raz, ale appka si to dorovná sama pri čítaní členstva
    srv.kill(); await sleep(1500);
    const stale = { ...poslednyStav('users.db')['qaZaRozdiel0001'], membership_expires: iso(2) };   // umelo zostarnutý účet
    fs.appendFileSync(path.join(DATA, 'users.db'), JSON.stringify(stale) + '\n');
    srv = await start('ČLENSTVO NA ÚČTE — druhý beh (samo-oprava pri čítaní)…');
    await sleep(2000);
    const u3 = poslednyStav('users.db');
    t('zarovnanie pri štarte sa už nespustilo', String(u3['qaZaRozdiel0001'].membership_expires).slice(0, 10) === den(2), String(u3['qaZaRozdiel0001'].membership_expires).slice(0, 10));
    const cRozdiel = await prihlas('qa.za.rozdiel@qa-biz.local');
    const mem2 = await get('/api/membership', cRozdiel);
    t('čítanie členstva vráti dátum z členstva (nie z analýzy tela)', String(mem2.membership?.expires_at || '').slice(0, 10) === den(10), JSON.stringify(mem2.membership?.expires_at));
    await sleep(1200);
    const u4 = poslednyStav('users.db');
    t('účet sa pri čítaní členstva sám dorovnal', String(u4['qaZaRozdiel0001'].membership_expires).slice(0, 10) === den(10), String(u4['qaZaRozdiel0001'].membership_expires).slice(0, 10));
    const cBundle = await prihlas('qa.za.bundle@qa-biz.local');
    await get('/api/membership', cBundle);
    await sleep(1200);
    t('permanentke sa dátum členstva na účte nedopísal ani pri čítaní', !poslednyStav('users.db')['qaZaBundle00001'].membership_expires,
      JSON.stringify(poslednyStav('users.db')['qaZaBundle00001'].membership_expires));

    // ── kód: kompenzácia zarovnanie naozaj volá
    const src = fs.readFileSync(path.join(KOREN, 'server.js'), 'utf8');
    t('kompenzácia volá zarovnanie účtu', /extended\.push\([\s\S]{0,400}zarovnajClenstvoNaUcte\(uid/.test(src), 'kompenzujZrusenie');
    t('zarovnanie preskakuje permanentky', /zarovnajClenstvoNaUcte[\s\S]{0,400}type!=='bundle'/.test(src), 'filter bundle');
    t('zarovnanie dátum na účte neskracuje', /naUcte >= new Date\(m\.expires_at\)\) return null;/.test(src), 'poistka proti skráteniu');
    t('čítanie členstva filtruje _type záznamy', /status:'active'\}\)\)\.filter\(m=>!m\._type\)/.test(src), 'checkMembership');
  } catch (e) {
    zle++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nČLENSTVO NA ÚČTE: ' + ok + ' OK / ' + zle + ' chýb');
    process.exit(zle ? 1 : 0);
  }
})();
