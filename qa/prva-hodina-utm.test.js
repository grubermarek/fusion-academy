/**
 * Stará vstupná stránka /prva-hodina pri prvom týždni zadarmo (Marek 16. 9. 2026).
 *
 * Reklama HEJ BABY posiela ľudí na /prva-hodina?utm_…&fbclid=… Od 14. 9. stránka
 * presmeruje na úvod appky — a parametre z reklamy sa strácali, takže registrácia
 * sa nedala priradiť kampani ani Mete. Test stráži, že idú so sebou.
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

(async () => {
  console.log('PRVÁ HODINA → ÚVOD S PARAMETRAMI REKLAMY\n');
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
    const kam = async u => { const r = await fetch(BASE + u, { redirect: 'manual' }); return { s: r.status, loc: r.headers.get('location') || '' }; };
    const a = await kam('/prva-hodina?utm_source=fb&utm_medium=cpc&utm_campaign=fa-video-hej-baby&fbclid=IwAR_test-1&city=banska-bystrica');
    ok('presmeruje na úvod appky', a.s === 302 && a.loc.startsWith('/?src=prva-hodina&'), a.s + ' ' + a.loc);
    const p = new URLSearchParams(a.loc.split('?')[1]);
    ok('utm_campaign ide so sebou', p.get('utm_campaign') === 'fa-video-hej-baby', a.loc);
    ok('utm_source aj utm_medium', p.get('utm_source') === 'fb' && p.get('utm_medium') === 'cpc');
    ok('fbclid ide so sebou (Meta spáruje registráciu s klikom)', p.get('fbclid') === 'IwAR_test-1');
    ok('mesto ide so sebou', p.get('city') === 'banska-bystrica');
    ok('src ostáva prvý', a.loc.indexOf('src=prva-hodina') === 2);
    const b = await kam('/prva-hodina');
    ok('bez parametrov bez prázdneho &', b.s === 302 && b.loc === '/?src=prva-hodina', b.loc);
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
