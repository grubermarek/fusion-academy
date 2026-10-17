/**
 * História konta (Marek 17. 10. 2026: „skontroluj, či sa správne predlžujú členstvá a
 * vracajú permanentkové vstupy pri zrušení hodiny… postav aj nejakú históriu, aby som aj ja
 * aj klientky vedeli, kedy mali hodiny, kedy sa im pridali/ubrali vstupy… aby neboli hádky,
 * či sa im vrátili vstupy alebo nie").
 *
 * Overuje celý kolobeh na bežiacom serveri: prihlásenie na hodinu strhne vstup a zapíše to,
 * zrušenie hodiny štúdiom vstup vráti (znova so zápisom) a členke predĺži členstvo o 4 dni,
 * história sedí so zostatkom na konte, klientka vidí svoju a nie cudziu, admin vidí každú,
 * spätné doplnenie histórie zbehne pri štarte a nástroj na predĺženie členstva zapíše dôvod.
 *
 * Spustenie:  node qa/historia-konta.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4633, BASE = 'http://localhost:' + PORT, TOKEN = 'qa-servis-token';
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-hist-'));
let ok = 0, zle = 0;
const t = (n, c, d) => { if (c) { ok++; console.log('  ✅ ' + n); } else { zle++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const iso = p => new Date(Date.now() + p * 864e5).toISOString();
const sk = ms => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date(ms));
const ZAJTRA = sk(Date.now() + 864e5), DNES = sk(Date.now()), MINULE = sk(Date.now() - 14 * 864e5);
const DOW = new Date(ZAJTRA + 'T12:00:00Z').getUTCDay();

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaHiAdmin000001', name: 'Adam Admin', email: 'qa.hi.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01', referral_code: 'QAHI01' },
    { _id: 'qaHiTrener00001', name: 'Tina Trénerka', email: 'qa.hi.trener@qa-biz.local', password: hash, user_type: 'trainer', active: true, created_at: '2026-01-01', referral_code: 'QAHI02', onboarding_done: true },
    { _id: 'qaHiPerm00000001', name: 'Permanentková Klientka', email: 'qa.hi.perm@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAHI03', single_entries: 3, visit_count: 5, free_class_used: true },
    { _id: 'qaHiClen00000001', name: 'Členka Mesačná', email: 'qa.hi.clen@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAHI04', membership_plan: 'bronze', membership_expires: iso(20), visit_count: 9, free_class_used: true },
  ]));
  fs.writeFileSync(path.join(DATA, 'memberships.db'), riadky([
    { _id: 'qaHiMem00000001', user_id: 'qaHiClen00000001', plan_id: 'bronze', plan_name: 'Bronze', price: 49.9, status: 'active', started_at: iso(-10), expires_at: iso(20), created_at: iso(-10) },
    // permanentka kúpená v minulosti — spätné doplnenie histórie ju má nájsť
    { _id: 'qaHiMem00000002', user_id: 'qaHiPerm00000001', plan_id: 'permanentka10', plan_name: 'Permanentka 10', price: 80, status: 'bundle', started_at: iso(-30), expires_at: iso(60), created_at: iso(-30) },
  ]));
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    { _id: 'qaHiHodina00001', name: 'Zumba', category: 'Zumba', location: 'Detva', day_of_week: DOW, time_start: '19:00', time_end: '20:00', capacity: 30, price: 10,
      emoji: '💃', active: true, instructor: 'Tina Trénerka', instructor_id: 'qaHiTrener00001', created_at: '2026-01-01' },
  ]));
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky([
    // minulá hodina z permanentky — pre spätné doplnenie histórie
    { _id: 'qaHiBkStara0001', class_id: 'qaHiHodina00001', class_name: 'Zumba', class_location: 'Detva', user_id: 'qaHiPerm00000001', user_name: 'Permanentková Klientka',
      booking_date: MINULE, status: 'attended', attendance_status: 'attended', access_method: 'single_entry', created_at: iso(-14) },
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1', 'clenstvo_na_ucte_zarovnanie_20261009']
    .map((x, i) => ({ _id: 'qaHiSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('HISTÓRIA KONTA — štart servera (termín ' + ZAJTRA + ')…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', IMPORT_TOKEN: TOKEN }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; srv.stderr.on('data', d => { err += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + err.slice(-600)); process.exit(1); }
  await sleep(16000);   // spätné doplnenie histórie beží 12 s po štarte

  const prihlas = async email => { const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Heslo123!' }) }); return String(r.headers.get('set-cookie') || '').split(';')[0]; };
  const get = async (cesta, c) => { const r = await fetch(BASE + cesta, { headers: c ? { Cookie: c } : {} }); let d = null; try { d = await r.json(); } catch (e) {} return { status: r.status, d }; };
  const post = async (cesta, telo, c) => { const r = await fetch(BASE + cesta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) }, body: JSON.stringify(telo) }); let d = null; try { d = await r.json(); } catch (e) {} return { status: r.status, d }; };
  const servis = async (cesta, telo) => { const r = await fetch(BASE + cesta, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-import-token': TOKEN }, body: JSON.stringify(telo) }); let d = null; try { d = await r.json(); } catch (e) {} return { status: r.status, d }; };

  try {
    const cPerm = await prihlas('qa.hi.perm@qa-biz.local');
    const cClen = await prihlas('qa.hi.clen@qa-biz.local');
    const cAdmin = await prihlas('qa.hi.admin@qa-biz.local');
    const cTrener = await prihlas('qa.hi.trener@qa-biz.local');

    // ── spätné doplnenie histórie
    const h0 = await get('/api/me/historia-konta', cPerm);
    t('história sa po štarte doplnila spätne', h0.status === 200 && (h0.d.riadky || []).length > 0, JSON.stringify((h0.d.riadky || []).length));
    t('v histórii je kúpená permanentka', (h0.d.riadky || []).some(r => /Kúpená/.test(r.text || '') && r.zmena === 10), JSON.stringify((h0.d.riadky || []).map(r => r.text).slice(0, 6)));
    t('v histórii je stará hodina z permanentky', (h0.d.riadky || []).some(r => r.typ === 'vstupy' && r.zmena === -1), '');
    const sucet0 = (h0.d.riadky || []).filter(r => r.typ === 'vstupy').reduce((a, r) => a + (+r.zmena || 0), 0);
    t('súčet vstupov v histórii sedí so zostatkom na konte', sucet0 === h0.d.vstupy, 'história ' + sucet0 + ' vs konto ' + h0.d.vstupy);

    // ── prihlásenie na hodinu strhne vstup a zapíše to
    const rez = await post('/api/bookings', { class_id: 'qaHiHodina00001', booking_date: ZAJTRA }, cPerm);
    t('rezervácia z permanentky prešla', rez.status === 200 && rez.d && rez.d.ok !== false, JSON.stringify(rez.d).slice(0, 140));
    const rezClen = await post('/api/bookings', { class_id: 'qaHiHodina00001', booking_date: ZAJTRA }, cClen);
    t('členka sa prihlásila na tú istú hodinu', rezClen.status === 200 && rezClen.d && rezClen.d.ok !== false, JSON.stringify(rezClen.d).slice(0, 140));
    const h1 = await get('/api/me/historia-konta', cPerm);
    const strhnutie = (h1.d.riadky || [])[0];
    t('strhnutý vstup je v histórii navrchu', strhnutie && strhnutie.typ === 'vstupy' && strhnutie.zmena === -1, JSON.stringify(strhnutie));
    t('pri strhnutí je vidieť hodinu aj zostatok', strhnutie && /Zumba/.test(strhnutie.hodina || '') && strhnutie.zostatok === h1.d.vstupy, JSON.stringify(strhnutie));
    t('zostatok klesol o jeden vstup', h1.d.vstupy === h0.d.vstupy - 1, h0.d.vstupy + ' → ' + h1.d.vstupy);

    // ── zrušenie hodiny štúdiom: vstup späť + členstvo o 4 dni dlhšie
    const zrus = await post('/api/attendance/cancel-session', { class_id: 'qaHiHodina00001', date: ZAJTRA, reason: 'QA test' }, cTrener);
    t('hodina sa zrušila', zrus.status === 200 && zrus.d.ok, JSON.stringify(zrus.d).slice(0, 160));
    await sleep(1200);
    const h2 = await get('/api/me/historia-konta', cPerm);
    const vratenie = (h2.d.riadky || []).find(r => r.typ === 'vstupy' && r.zmena === 1);
    t('vstup sa vrátil späť na konto', h2.d.vstupy === h0.d.vstupy, h1.d.vstupy + ' → ' + h2.d.vstupy);
    t('vrátenie je v histórii ako samostatný riadok', vratenie && vratenie.typ === 'vstupy' && vratenie.zmena === 1 && /zrušil/i.test(vratenie.text || ''), JSON.stringify(vratenie));
    t('súčet vstupov v histórii stále sedí', (h2.d.riadky || []).filter(r => r.typ === 'vstupy').reduce((a, r) => a + (+r.zmena || 0), 0) === h2.d.vstupy, '');
    const h3 = await get('/api/me/historia-konta', cClen);
    const predlzenie = (h3.d.riadky || []).find(r => r.typ === 'clenstvo' && r.zmena > 0);
    t('členke sa členstvo predĺžilo o 4 dni', predlzenie && predlzenie.zmena === 4, JSON.stringify(predlzenie));
    t('pri predĺžení je napísané, za ktorú zrušenú hodinu', predlzenie && /Zrušená hodina/.test(predlzenie.text || '') && !!predlzenie.do_kedy, JSON.stringify(predlzenie));
    t('v histórii členky je aj samotná zrušená hodina', (h3.d.riadky || []).some(r => r.typ === 'hodina' && /zrušilo štúdio/i.test(r.text || '')), '');

    // ── kto čo vidí
    const cudzia = await get('/api/historia-konta/qaHiClen00000001', cPerm);
    t('klientka cudziu históriu nevidí (403)', cudzia.status === 403, String(cudzia.status));
    const adminVidi = await get('/api/historia-konta/qaHiPerm00000001', cAdmin);
    t('admin vidí históriu klientky', adminVidi.status === 200 && adminVidi.d.klientka === 'Permanentková Klientka', JSON.stringify(adminVidi.d && adminVidi.d.klientka));
    const trenerVidi = await get('/api/historia-konta/qaHiPerm00000001', cTrener);
    t('tréner vidí históriu klientky', trenerVidi.status === 200, String(trenerVidi.status));
    const bezPrihlasenia = await get('/api/me/historia-konta');
    t('neprihlásený nevidí nič', bezPrihlasenia.status === 401 || bezPrihlasenia.status === 403, String(bezPrihlasenia.status));

    // ── predĺženie členstva nástrojom (s dôvodom do histórie)
    const n = await servis('/api/service/clenstvo-predlzit', { email: 'qa.hi.clen@qa-biz.local', dni: 10, dovod: 'Appka jej mesiac nedala využiť.' });
    t('náhľad predĺženia ukáže starý aj nový dátum', n.status === 200 && n.d.apply === false && n.d.nahlad.dni === 10, JSON.stringify(n.d).slice(0, 160));
    const bezDovodu = await servis('/api/service/clenstvo-predlzit', { email: 'qa.hi.clen@qa-biz.local', dni: 10, apply: true });
    t('bez dôvodu to nespraví', bezDovodu.status === 400 && /dôvod/.test(bezDovodu.d.error || ''), JSON.stringify(bezDovodu.d));
    const a = await servis('/api/service/clenstvo-predlzit', { email: 'qa.hi.clen@qa-biz.local', dni: 10, dovod: 'Appka jej mesiac nedala využiť.', apply: true });
    t('predĺženie prešlo', a.status === 200 && a.d.dni === 10, JSON.stringify(a.d).slice(0, 140));
    const h4 = await get('/api/me/historia-konta', cClen);
    const riadokP = (h4.d.riadky || [])[0];
    t('dôvod predĺženia je v histórii', riadokP && riadokP.typ === 'clenstvo' && riadokP.zmena === 10 && /nedala využiť/.test(riadokP.text || ''), JSON.stringify(riadokP));
    t('členstvo na konte je o 10 dní dlhšie', h4.d.clenstvo && h4.d.clenstvo.do === a.d.clenstvo_do, JSON.stringify(h4.d.clenstvo));

    // ── stránka histórie
    const stranka = await fetch(BASE + '/historia', { headers: { Cookie: cPerm } });
    t('stránka /historia sa načíta', stranka.status === 200 && /História konta/.test(await stranka.text()), String(stranka.status));
  } catch (e) {
    zle++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nHISTÓRIA KONTA: ' + ok + ' OK / ' + zle + ' chýb');
    process.exit(zle ? 1 : 0);
  }
})();
