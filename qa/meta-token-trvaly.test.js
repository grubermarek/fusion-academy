/**
 * Meta token sa má starať o seba sám (30. 10. 2026)
 *
 * Marek: „sprav natrvalo ten token, lebo to sa nedá každý deň dokola." Token pre Metu
 * drží aj čítanie kampaní, aj posielanie udalostí — keď padne, stíchne oboje. Doteraz
 * sa obnovoval až pri 14 dňoch a výmena sa robila jediným spôsobom; keď Meta vrátila
 * token s tou istou lehotou, appka to brala za úspech a o dva mesiace bolo ticho.
 *
 * Stráži, že:
 *   · bez app secretu je dôvod povedaný nahlas (nie ticho v Railway logu)
 *   · výmena, ktorá nepohla lehotou, sa zopakuje s parametrom, ktorý Meta
 *     dokumentuje pre tokeny systémového používateľa (set_token_expires_in_60_days)
 *   · nový token sa uloží aj pre CAPI (náš dataset vlastný token mať nemôže)
 *   · token bez expirácie sa nemení — nie je čo predlžovať
 *   · mŕtvy token nie je zelená: appka to povie a zapíše dôvod
 *   · admin karta číta skutočný stav z Mety, nie len „nejaký token tam je"
 *
 * Spustenie:  node qa/meta-token-trvaly.test.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4631, GPORT = 4632;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-mtok-'));
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const rd = f => { const p = path.join(DATA, f); if (!fs.existsSync(p)) return []; const m = new Map();
  fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (o._id) m.set(o._id, o); } catch (e) {} });
  return [...m.values()]; };
const nastavenie = k => (rd('settings.db').find(s => s.key === k) || {}).value;

// Tokeny musia prejsť kontrolou formátu v admin endpointe (EAA + aspoň 50 znakov).
const T = n => 'EAA' + n + 'x'.repeat(60);
const STARY = T('stary'), BEZSTROPU = T('bezstropu'), SOSTROPOM = T('sostropom'),
      SYSTEM = T('system'), MRTVY = T('mrtvy');

// Falošný Graph. Podstatná je výmena: bez parametra vráti token s TOU ISTOU lehotou
// (presne to Meta robí pri už dlhodobom tokene), s parametrom vráti plných 60 dní.
const sek = d => Math.floor(Date.now() / 1000) + d * 86400;
const graf = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const J = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const p = u.pathname.replace(/^\/+/, '');
  if (p === 'debug_token') {
    const t = u.searchParams.get('input_token');
    if (t === SYSTEM) return J({ data: { is_valid: true, type: 'SYSTEM_USER' } });
    if (t === MRTVY) return J({ error: { message: 'Error validating access token: Session has expired.', code: 190 } });
    const dni = t === SOSTROPOM ? 60 : 20;
    return J({ data: { is_valid: true, type: 'USER', expires_at: sek(dni), data_access_expires_at: sek(70) } });
  }
  if (p === 'oauth/access_token')
    return J({ access_token: u.searchParams.get('set_token_expires_in_60_days') === 'true' ? SOSTROPOM : BEZSTROPU });
  if (p.startsWith('act_51759494')) return J({ data: [] });
  return J({ data: [] });
});

(async () => {
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaMtokAdmin00001', name: 'QA Admin', email: 'qa.mtok.admin@qa-biz.local',
      password: bcrypt.hashSync('Heslo123!', 10), is_admin: true, active: true, user_type: 'admin',
      referral_code: 'QAMTOK', created_at: new Date().toISOString().slice(0, 10) },
  ]));
  // Token platí ešte 20 dní a app secret chýba — stav, v ktorom appka doteraz mlčala.
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky([
    { _id: 'qaMtokSetTok0001', key: 'meta_ads_token', value: STARY, at: new Date().toISOString() },
  ]));

  await new Promise(r => graf.listen(GPORT, r));
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1',
      MAIL_CAPTURE: '1', META_GRAPH_URL: 'http://localhost:' + GPORT + '/', META_PIXEL_ID: 'PIXQA',
      META_APP_SECRET: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); graf.close(); process.exit(1); }
  // Kontrola po nasadení beží 20 s po starte — nech nám nepíše do stavu uprostred testu.
  await sleep(24000);

  const jar = {};
  const ide = async (url, opts = {}) => {
    const r = await fetch(BASE + url, { redirect: 'manual', headers: { 'Content-Type': 'application/json', 'Cookie': Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ') }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); });
    let d = null; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };

  try {
    await ide('/api/login', { method: 'POST', body: { email: 'qa.mtok.admin@qa-biz.local', password: 'Heslo123!' } });

    console.log('\n① Bez app secretu');
    const st1 = (await ide('/api/admin/meta-stats')).d || {};
    const t1 = st1.token || {};
    ok('karta vidí skutočný stav z Mety, nie len prítomnosť tokenu', t1.platny === true && t1.dni >= 19 && t1.dni <= 21, JSON.stringify(t1));
    ok('karta vie, že app secret chýba', t1.secret === false, JSON.stringify(t1.secret));
    ok('karta nehlási systémový token, keď ide o bežný', t1.systemovy === false);
    const p1 = (await ide('/api/admin/meta-token-predlzit', { method: 'POST', body: {} })).d || {};
    ok('bez secretu obnova zlyhá a povie prečo', p1.ok === false && /app secret/i.test(p1.dovod || ''), JSON.stringify(p1));
    ok('dôvod sa zapíše do stavu (nielen do logu)', /app secret/i.test((nastavenie('meta_token_stav') || {}).dovod || ''), JSON.stringify(nastavenie('meta_token_stav')));
    ok('token sa pri zlyhaní nemení', nastavenie('meta_ads_token') === STARY);

    console.log('\n② So secretom — výmena, ktorá nepohla lehotou, sa zopakuje s parametrom');
    const s2 = (await ide('/api/admin/meta-app-secret', { method: 'POST', body: { secret: 'a'.repeat(32) } })).d || {};
    const p2 = s2.predlzenie || {};
    ok('obnova prebehla', p2.ok === true && p2.predlzene === true, JSON.stringify(p2));
    ok('výsledkom je token so 60 dňami, nie ten s pôvodnou lehotou', nastavenie('meta_ads_token') === SOSTROPOM,
      String(nastavenie('meta_ads_token')).slice(0, 14));
    ok('nový token sa uložil aj pre CAPI', nastavenie('meta_capi_token') === SOSTROPOM);
    ok('appka hlási ~60 dní', p2.dni >= 59 && p2.dni <= 61, String(p2.dni));
    const stav2 = nastavenie('meta_token_stav') || {};
    ok('stav si pamätá úspech aj kedy', stav2.ok === true && stav2.predlzene === true && !!stav2.at, JSON.stringify(stav2));

    console.log('\n③ Token bez expirácie');
    const s3 = (await ide('/api/admin/meta-ads-token', { method: 'POST', body: { token: SYSTEM } })).d || {};
    const p3 = s3.predlzenie || {};
    ok('token systémového používateľa sa neobnovuje', p3.ok === true && p3.trvaly === true && p3.predlzene !== true, JSON.stringify(p3));
    ok('a nemení sa za iný', nastavenie('meta_ads_token') === SYSTEM, String(nastavenie('meta_ads_token')).slice(0, 14));
    const st3 = ((await ide('/api/admin/meta-stats')).d || {}).token || {};
    ok('karta ho označí za systémový a bez lehoty', st3.systemovy === true && st3.dni === null, JSON.stringify(st3));

    console.log('\n④ Mŕtvy token');
    const s4 = (await ide('/api/admin/meta-ads-token', { method: 'POST', body: { token: MRTVY } })).d || {};
    const p4 = s4.predlzenie || {};
    ok('mŕtvy token nie je zelená', p4.ok === false && /overi|neplat/i.test(p4.dovod || ''), JSON.stringify(p4));
    const st4 = ((await ide('/api/admin/meta-stats')).d || {}).token || {};
    ok('karta povie, že Meta token neoverila', !!st4.chyba, JSON.stringify(st4));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  }

  srv.kill(); graf.close();
  await sleep(500);
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + (failed ? '❌ ' + failed + ' z ' + (passed + failed) + ' kontrol spadlo' : '✅ všetkých ' + passed + ' kontrol prešlo'));
  process.exit(failed ? 1 : 0);
})();
