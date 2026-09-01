/**
 * Septembrová vlna: prianie + plagát akcie (Marek 1. 9.).
 *
 * Stráži hlavne to, čím sa dá pokaziť hromadný mail:
 *   · nejde na test účty, deti, odhlásené ani na @import.local
 *   · nikto ho nedostane dvakrát
 *   · obrázok akcie v ňom naozaj je a odkazuje na existujúci súbor
 *
 * Vedľajší produkt: uloží náhľad mailu do qa/nahlad-september.html.
 *
 * Spustenie:  node qa/september-vlna.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4567;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-sep-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  let kod = 0;
  const K = (id, meno, email, extra = {}) => JSON.stringify({ _id: id, name: meno, email,
    password: hash, user_type: 'client', active: true, referral_code: 'QASEP' + String(++kod).padStart(2, '0'),
    visit_count: 3, created_at: '2026-06-01', city: 'Detva', ...extra });

  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaSepAdmin00001', name: 'Adam Admin', email: 'qa.sep.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }),
    K('qaSepBezna00001', 'Beata Bezna', 'qa.sep.bezna@qa-biz.local'),
    K('qaSepDruha00001', 'Dana Druha', 'qa.sep.druha@qa-biz.local'),
    K('qaSepTest000001', 'Test Testovaci', 'qa.sep.test@qa-biz.local', { is_test: true }),
    K('qaSepDieta00001', 'Deti Dietko', 'qa.sep.dieta@qa-biz.local', { is_child: true }),
    K('qaSepOptout0001', 'Olga Odhlasena', 'qa.sep.optout@qa-biz.local', { offers_optout: true }),
    K('qaSepImport0001', 'Iveta Importovana', 'iveta@import.local'),
    K('qaSepNeaktiv001', 'Nela Neaktivna', 'qa.sep.neaktiv@qa-biz.local', { active: false }),
  ].join('\n') + '\n');

  console.log('SEPTEMBROVÁ VLNA QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', QA_EVENT_WINDOW: '1',
      BREVO_API_KEY: 'qa-fake-key-nikam-neposiela' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.sep.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    console.log('\nPrvé spustenie vlny:');
    const r1 = await j('/api/admin/qa/run-event-mail/september', { method: 'POST' }, adm);
    ok('vlna zbehla', r1.status === 200 && r1.d && !r1.d.error, JSON.stringify(r1.d).slice(0, 140));
    await new Promise(r => setTimeout(r, 900));

    const maily = rd('mail_log.db').filter(m => /september/i.test(String(m.subject || '')));
    const prijemcovia = maily.map(m => String(m.to).toLowerCase());
    ok('odišiel obom bežným klientkam', prijemcovia.length === 2,
      prijemcovia.length + ': ' + JSON.stringify(prijemcovia));

    console.log('\nKoho vlna vynechala:');
    ok('test účet nedostal', !prijemcovia.some(e => e.includes('test')));
    ok('dieťa nedostalo', !prijemcovia.some(e => e.includes('dieta')));
    ok('odhlásená z ponúk nedostala', !prijemcovia.some(e => e.includes('optout')));
    ok('@import.local nedostal', !prijemcovia.some(e => e.includes('import.local')));
    ok('neaktívne konto nedostalo', !prijemcovia.some(e => e.includes('neaktiv')));

    console.log('\nObsah mailu:');
    const m = maily[0];
    const html = String((m && (m.html || m.body)) || '');
    ok('obsahuje plagát akcie', html.includes('/img/vyzva-september-2026.jpg'), html ? 'obrázok chýba' : 'HTML sa neuložilo');
    ok('obrázok má alt popis (bez neho je v Gmaile prázdny rámik)', /alt="[^"]{20,}"/.test(html));
    ok('praje krásny september', /spe(š|s)n(ý|y) september/i.test(html));
    ok('píše, čo klientka získa', /kromn.{1,3} hodinu/i.test(html));
    ok('má CTA na odkaz', /Skop.{1,3}rova/.test(html));
    ok('je oslovená menom', html.includes('Beata') || html.includes('Dana'));

    const notif = rd('notifications.db').filter(x => x.type === 'referral_goal');
    ok('klientka dostane aj notifikáciu v appke', notif.length === 2,
      notif.length + ': ' + JSON.stringify(notif.map(x => x.title)));

    const obr = path.join(__dirname, '..', 'public', 'img', 'vyzva-september-2026.jpg');
    ok('plagát v projekte naozaj existuje', fs.existsSync(obr), obr);
    if (fs.existsSync(obr)) {
      const kb = fs.statSync(obr).size / 1024;
      ok('a je dosť malý na mail (do 300 KB)', kb < 300, Math.round(kb) + ' KB');
    }

    if (html) { fs.writeFileSync(path.join(__dirname, 'nahlad-september.html'), html); console.log('  📄 náhľad: qa/nahlad-september.html'); }

    console.log('\nDruhé spustenie (nikto nesmie dostať dvakrát):');
    const r2 = await j('/api/admin/qa/run-event-mail/september', { method: 'POST' }, adm);
    await new Promise(r => setTimeout(r, 900));
    const po = rd('mail_log.db').filter(x => /september/i.test(String(x.subject || '')));
    ok('počet mailov sa nezmenil', po.length === maily.length, maily.length + ' → ' + po.length);
    ok('a vlna hlási, že nemá komu posielať', r2.d && r2.d.sent === 0, JSON.stringify(r2.d).slice(0, 90));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nSEPTEMBROVÁ VLNA: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
