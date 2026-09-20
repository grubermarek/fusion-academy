/**
 * Klik z reklamy → landing /prva-hodina: parametre kampane sa nesmú stratiť.
 *
 * Reklama HEJ BABY posiela ľudí na /prva-hodina?utm_…&fbclid=… Od 19. 9. je to plnohodnotný
 * landing (predtým presmerovanie na úvod), takže test stráži, že značky z reklamy prejdú
 * až na založený účet — inak sa registrácia nedá priradiť kampani ani Mete.
 * Od 20. 9. je e-mail povinný (bez neho sa heslo nemá kam poslať).
 *
 * Spustenie:  node qa/prva-hodina-utm.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');

const PORT = 4605;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-phutm-'));
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rd = f => { const p = path.join(DATA, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return {}; } }) : []; };

(async () => {
  console.log('KLIK Z REKLAMY → LANDING /prva-hodina\n');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', PRVY_TYZDEN: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  try {
    const REKLAMA = 'utm_source=fb&utm_medium=cpc&utm_campaign=fa-video-hej-baby&fbclid=IwAR_test-1&city=banska-bystrica';
    // 1) úvod appky posiela klik z reklamy na landing aj s parametrami
    const uvod = await fetch(BASE + '/?' + REKLAMA, { redirect: 'manual' });
    const loc = uvod.headers.get('location') || '';
    ok('klik z reklamy na / ide na /prva-hodina', uvod.status === 302 && loc.startsWith('/prva-hodina?'), uvod.status + ' ' + loc);
    const p = new URLSearchParams(loc.split('?')[1] || '');
    ok('utm_campaign ide so sebou', p.get('utm_campaign') === 'fa-video-hej-baby', loc);
    ok('utm_source aj utm_medium', p.get('utm_source') === 'fb' && p.get('utm_medium') === 'cpc');
    ok('fbclid ide so sebou (Meta spáruje registráciu s klikom)', p.get('fbclid') === 'IwAR_test-1');
    ok('mesto ide so sebou', p.get('city') === 'banska-bystrica');
    // 2) landing sa zobrazí (už nepresmeruje)
    const lp = await fetch(BASE + '/prva-hodina?' + REKLAMA, { redirect: 'manual' });
    ok('landing vráti stránku (200)', lp.status === 200, String(lp.status));

    // 3) značky z reklamy prejdú až na účet založený z landingu
    const sc = await (await fetch(BASE + '/api/first-class/schedule')).json();
    const sess = (sc.items || [])[0];
    ok('rozvrh má termín', !!sess);
    const attribution = { utm_source: 'fb', utm_medium: 'cpc', utm_campaign: 'fa-video-hej-baby', fbclid: 'IwAR_test-1',
      landing: '/prva-hodina?' + REKLAMA, referrer: 'https://www.facebook.com/' };
    const bk = await fetch(BASE + '/api/first-class/book', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Qa Utmova', kontakt: 'qa.utm@qa-biz.local', class_id: sess.class_id, booking_date: sess.date, attribution }) });
    const bd = await bk.json();
    ok('rezervácia z landingu prešla', bk.status === 200 && bd.ok === true, JSON.stringify(bd).slice(0, 200));
    const u = rd('users.db').filter(x => x.email === 'qa.utm@qa-biz.local').pop();
    ok('účet nesie kampaň a fbclid', u && u.utm_campaign === 'fa-video-hej-baby' && u.utm_source === 'fb' && u.fbclid === 'IwAR_test-1', JSON.stringify(u && { c: u.utm_campaign, s: u.utm_source, f: u.fbclid }));
    ok('účet nesie landing_page + referrer', u && /prva-hodina/.test(u.landing_page || '') && /facebook/.test(u.referrer || ''));
    ok('účet je self_registration s heslom', u && u.account_creation_type === 'self_registration' && !!u.password);
    // 4) e-mail je povinný (20. 9.)
    const bezMailu = await fetch(BASE + '/api/first-class/book', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Qa Bezmailu', kontakt: '0902 111 222', class_id: sess.class_id, booking_date: sess.date, attribution }) });
    ok('bez e-mailu sa účet nezaloží (400)', bezMailu.status === 400 && rd('users.db').filter(x => x.name === 'Qa Bezmailu').length === 0);

    const ft = fs.readFileSync(path.join(__dirname, '..', 'public', 'fa-track.js'), 'utf8');
    ok('fa-track si pri návšteve bez UTM pamätá aj parametre adresy', /landing:location\.pathname\+location\.search, referrer:document\.referrer\}/.test(ft));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill(); await sleep(500);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nPRVÁ HODINA UTM: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
  }
})();
