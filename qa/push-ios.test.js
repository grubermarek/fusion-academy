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
