/**
 * Natívne push pre iOS obal (Marek 19. 10. 2026: appku v App Store nahrádzame našou,
 * Apple „web v obale" bez natívnych funkcií zamieta — push sú hlavný dôvod obalu).
 *
 * Overuje serverovú časť bez Apple: registráciu telefónu k účtu, že sa ten istý token
 * nezduplikuje, odhlásenie telefónu, ochrany (neprihlásený, nezmysel namiesto tokenu),
 * že bez APNS kľúča modul potichu spí a nič nezhodí, a že /nativ.js v obyčajnom
 * prehliadači nerobí nič (appka beží ďalej bez chyby).
 *
 * Spustenie:  node qa/push-ios.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4634, BASE = 'http://localhost:' + PORT;
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-push-'));
let ok = 0, zle = 0;
const t = (n, c, d) => { if (c) { ok++; console.log('  ✅ ' + n); } else { zle++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const TOKEN1 = 'a'.repeat(64), TOKEN2 = 'b'.repeat(64);
const citaj = f => { try { return fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x)); } catch (e) { return []; } };
const posledne = f => citaj(f).reduce((a, r) => (r.$$deleted ? delete a[r._id] : a[r._id] = r, a), {});

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaPuAdmin000001', name: 'Adam Admin', email: 'qa.pu.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01', referral_code: 'QAPU01' },
    { _id: 'qaPuKlient00001', name: 'Klientka Mobilná', email: 'qa.pu.klient@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAPU02' },
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1', 'clenstvo_na_ucte_zarovnanie_20261009', 'konto_historia_backfill_20261017']
    .map((x, i) => ({ _id: 'qaPuSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' }))));
  const ZAJTRA = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date(Date.now() + 864e5));
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    { _id: 'qaPuHodina00001', name: 'Zumba', category: 'Zumba', location: 'Detva', day_of_week: new Date(ZAJTRA + 'T12:00:00Z').getUTCDay(),
      time_start: '19:00', time_end: '20:00', capacity: 30, price: 10, emoji: '💃', active: true, instructor: 'Marek Gruber', created_at: '2026-01-01' },
  ]));
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky([
    { _id: 'qaPuBk000000001', class_id: 'qaPuHodina00001', class_name: 'Zumba', class_location: 'Detva', class_time_start: '19:00',
      user_id: 'qaPuKlient00001', user_name: 'Klientka Mobilná', booking_date: ZAJTRA, status: 'confirmed', attendance_status: 'pending',
      access_method: 'membership', created_at: '2026-10-18T10:00:00.000Z' },
  ]));

  console.log('iOS PUSH — štart servera (bez APNS kľúča, ako na lokále)…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1',
      APNS_KEY_P8: '', APNS_KEY_ID: '', APNS_TEAM_ID: '' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; srv.stderr.on('data', d => { err += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + err.slice(-600)); process.exit(1); }
  await sleep(2500);

  const prihlas = async email => { const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Heslo123!' }) }); return String(r.headers.get('set-cookie') || '').split(';')[0]; };
  const post = async (cesta, telo, c) => { const r = await fetch(BASE + cesta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) }, body: JSON.stringify(telo) }); let d = null; try { d = await r.json(); } catch (e) {} return { status: r.status, d }; };

  try {
    const cKlient = await prihlas('qa.pu.klient@qa-biz.local');
    const cAdmin = await prihlas('qa.pu.admin@qa-biz.local');

    t('neprihlásený telefón sa nezaregistruje', (await post('/api/push/device', { token: TOKEN1 })).status === 401, '');
    t('nezmysel namiesto tokenu odmietne', (await post('/api/push/device', { token: 'xx' }, cKlient)).status === 400, '');

    const r1 = await post('/api/push/device', { token: TOKEN1, platform: 'ios', app_version: '9.0.0' }, cKlient);
    t('telefón sa zaregistroval k účtu', r1.status === 200 && r1.d.ok === true, JSON.stringify(r1.d));
    const z1 = Object.values(posledne('push_devices.db'));
    t('token je uložený s účtom aj verziou', z1.length === 1 && z1[0].user_id === 'qaPuKlient00001' && z1[0].app_version === '9.0.0', JSON.stringify(z1[0]));

    await post('/api/push/device', { token: TOKEN1, platform: 'ios', app_version: '9.0.1' }, cKlient);
    const z2 = Object.values(posledne('push_devices.db'));
    t('ten istý telefón sa nezduplikuje', z2.length === 1 && z2[0].app_version === '9.0.1', JSON.stringify(z2.map(x => x.app_version)));

    await post('/api/push/device', { token: TOKEN2, platform: 'ios' }, cKlient);
    t('druhý telefón tej istej klientky pribudne', Object.values(posledne('push_devices.db')).length === 2, '');

    await post('/api/push/device/odhlasit', { token: TOKEN2 }, cKlient);
    t('odhlásený telefón sa odstráni', Object.values(posledne('push_devices.db')).length === 1, '');

    const test = await post('/api/admin/push/test', { user_id: 'qaPuKlient00001', text: 'skúška' }, cAdmin);
    t('bez APNS kľúča modul potichu spí (nespadne)', test.status === 200 && test.d.zapnute === false && test.d.poslane === 0, JSON.stringify(test.d));
    t('skúšobný push nesmie vedieť spustiť klientka', (await post('/api/admin/push/test', {}, cKlient)).status === 403, '');

    // appka musí bežať aj bez obalu — /nativ.js sa v prehliadači nemá na čom chytiť
    const nativ = await fetch(BASE + '/nativ.js');
    const kod = await nativ.text();
    t('/nativ.js sa servíruje', nativ.status === 200 && kod.includes('FA_NATIV'), String(nativ.status));
    t('v prehliadači bez Capacitoru sa hneď ukončí', /if\(!C \|\| !C\.Plugins\) return;/.test(kod), '');
    const dash = await fetch(BASE + '/client-dashboard');
    t('nástenka má mostík zapojený', (await dash.text()).includes('/nativ.js'), '');

    // obal musí smerovať na rovnaké bundle ID ako appka v App Store
    const cfg = JSON.parse(fs.readFileSync(path.join(KOREN, 'ios', 'capacitor.config.json'), 'utf8'));
    t('obal má bundle ID appky z App Store', cfg.appId === 'ie.zappy.latindancefusion', cfg.appId);
    t('obal načítava ostrú appku', cfg.server && cfg.server.url === 'https://app.fusionacademy.sk', JSON.stringify(cfg.server && cfg.server.url));
    t('verzia obalu je vyššia ako glofoxová 8.4.4', require(path.join(KOREN, 'ios', 'package.json')).version === '9.0.0', '');

    // ── cloudový build (GitHub Actions) ──
    const wf = fs.readFileSync(path.join(KOREN, '.github', 'workflows', 'ios-testflight.yml'), 'utf8');
    t('workflow stavia na macOS runneri', /runs-on:\s*macos-/.test(wf), '');
    t('workflow sa spúšťa ručne s voľbou verzie', /workflow_dispatch:/.test(wf) && /verzia:/.test(wf), '');
    for (const s of ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_P8', 'APPLE_TEAM_ID'])
      t('workflow berie tajomstvo ' + s, wf.includes('secrets.' + s), '');
    t('workflow dopĺňa povolenie pre push', /App\.entitlements/.test(wf) && /remote-notification/.test(wf), '');
    const ent = fs.readFileSync(path.join(KOREN, 'ios', 'extras', 'App.entitlements'), 'utf8');
    t('povolenie pre push je nastavené na ostré APNs', /aps-environment<\/key>\s*<string>production/.test(ent), '');
    const ff = fs.readFileSync(path.join(KOREN, 'ios', 'fastlane', 'Fastfile'), 'utf8');
    t('fastlane stavia správne bundle ID', ff.includes('ie.zappy.latindancefusion'), '');
    t('fastlane nahráva do TestFlightu', /upload_to_testflight/.test(ff), '');
    // ── Online členstvo sa v iOS appke nesmie dať kúpiť (Apple chce zaň 30 %) ──
    const UA = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 FusionAcademyApp/9.0' };
    const vPrehliadaci = await (await fetch(BASE + '/api/membership/plans', { headers: { Cookie: cKlient } })).json();
    const vAppke = await (await fetch(BASE + '/api/membership/plans', { headers: { Cookie: cKlient, ...UA } })).json();
    t('v prehliadači sa online členstvá ponúkajú', !!vPrehliadaci.online_basic && !!vPrehliadaci.online_premium, Object.keys(vPrehliadaci).join(','));
    t('v appke online členstvá nie sú', !vAppke.online_basic && !vAppke.online_premium, Object.keys(vAppke).join(','));
    t('v appke bežné členstvá ostávajú', !!vAppke.bronze && !!vAppke.silver && !!vAppke.gold && !!vAppke.permanentka10, Object.keys(vAppke).join(','));
    const kupa = await fetch(BASE + '/api/membership/buy', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cKlient, ...UA }, body: JSON.stringify({ plan_id: 'online_basic', payment_method: 'manual' }) });
    const kupaD = await kupa.json().catch(() => ({}));
    t('kúpu online členstva z appky server odmietne', kupa.status === 400 && /appke kúpiť nedá/.test(kupaD.error || ''), JSON.stringify(kupaD).slice(0, 120));

    // ── Hodina do kalendára telefónu ──
    const ics = await fetch(BASE + '/api/kalendar/hodina.ics?booking_id=qaPuBk000000001', { headers: { Cookie: cKlient } });
    const icsText = await ics.text();
    t('kalendár sa servíruje ako .ics', ics.status === 200 && /text\/calendar/.test(ics.headers.get('content-type') || ''), String(ics.status) + ' ' + ics.headers.get('content-type'));
    t('.ics má hlavičku aj udalosť', /BEGIN:VCALENDAR/.test(icsText) && /BEGIN:VEVENT/.test(icsText) && /END:VCALENDAR/.test(icsText), '');
    t('.ics má správny názov, miesto a čas', /SUMMARY:Zumba — Fusion Academy/.test(icsText) && /LOCATION:Detva/.test(icsText) && /DTSTART;TZID=Europe\/Bratislava:\d{8}T190000/.test(icsText), icsText.split('\r\n').filter(r => /SUMMARY|DTSTART|LOCATION/.test(r)).join(' | '));
    t('.ics nesie pásmo, inak by čas sedel vedľa', /BEGIN:VTIMEZONE[\s\S]*TZID:Europe\/Bratislava/.test(icsText), '');
    t('.ics pripomenie hodinu 2 h vopred', /BEGIN:VALARM[\s\S]*TRIGGER:-PT2H/.test(icsText), '');
    t('hodina trvá podľa rozvrhu (19:00–20:00)', /DTEND;TZID=Europe\/Bratislava:\d{8}T200000/.test(icsText), '');
    const icsCudzi = await fetch(BASE + '/api/kalendar/hodina.ics?booking_id=qaPuBk000000001', { headers: { Cookie: cAdmin } });
    t('cudziu rezerváciu do kalendára nepustí', icsCudzi.status === 403, String(icsCudzi.status));
    t('neprihlásený .ics nedostane', (await fetch(BASE + '/api/kalendar/hodina.ics?booking_id=qaPuBk000000001')).status === 401, '');
    const dash2 = await (await fetch(BASE + '/client-dashboard')).text();
    t('nástenka má tlačidlo Do kalendára', /kalendar\/hodina\.ics/.test(dash2) && /Do kalendára/.test(dash2), '');

    const ikona = fs.readFileSync(path.join(KOREN, 'ios', 'icons', 'AppIcon-1024.png'));
    t('ikona má 1024×1024', ikona.readUInt32BE(16) === 1024 && ikona.readUInt32BE(20) === 1024, ikona.readUInt32BE(16) + '×' + ikona.readUInt32BE(20));
    t('ikona je bez priehľadnosti (inak ju Apple odmietne)', ikona[25] === 2, 'typ farby ' + ikona[25]);
  } catch (e) {
    zle++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\niOS PUSH: ' + ok + ' OK / ' + zle + ' chýb');
    process.exit(zle ? 1 : 0);
  }
})();
