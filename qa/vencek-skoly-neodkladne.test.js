/**
 * Venčeky — školy, ktoré klikli na ponuku, patria do Neodkladných (audit 6. 10. 2026).
 *
 * Prečo: klik sa pri škole NEukladá — zisťuje sa až pri čítaní z mail_log podľa
 * adresy príjemcu (withMail v school-outreach.js). Prvý pokus o túto úlohu filtroval
 * x.clicked_at priamo na dokumente školy, takže sa na produkcii nikdy neobjavila,
 * hoci 36 škôl kliklo a nikto im nevolal. Test stráži, že sa úloha ukáže,
 * že má tvar ostatných úloh ({type,title,name,why}) a že zmizne po zápise hovoru.
 *
 * Spustenie:  node qa/vencek-skoly-neodkladne.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4639;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-vskoly-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function j(url, opts, jar) {
  opts = opts || {};
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  w('users.db', [{ _id: 'qaSkAdmin000001', name: 'Marek Gruber', email: 'qa.sk.admin@qa-biz.local',
    password: hash, user_type: 'admin', is_admin: true, active: true, created_at: '2026-09-01' }]);

  // 5 škôl: štyri klikli (jedna už má zápis z hovoru, jedna odhlásená),
  // jedna mail len otvorila. V Neodkladných majú ostať tri + súhrn? Nie — tri klikli
  // a nikto im nevolal → tri karty a žiaden súhrn (súhrn až od štvrtej).
  const skola = (id, name, email, extra) => ({ _id: id, name, city: 'Detva', email, phone: '0901 111 ' + id.slice(-3),
    status: 'sent', unsubscribed: false, sent_at: '2026-09-20', created_at: '2026-09-01', ...(extra || {}) });
  w('schools.db', [
    skola('qaSkA01', 'ZŠ Kukučínova', 'qa.skola.a@qa-biz.local'),
    skola('qaSkB02', 'ZŠ Obrancov mieru', 'qa.skola.b@qa-biz.local'),
    skola('qaSkC03', 'ZŠ Štúrova', 'qa.skola.c@qa-biz.local'),
    skola('qaSkD04', 'ZŠ Volané', 'qa.skola.d@qa-biz.local', { crm_volane_at: '2026-10-01T09:00:00.000Z', crm_stav: 'dovolane' }),
    skola('qaSkE05', 'ZŠ Odhlásená', 'qa.skola.e@qa-biz.local', { unsubscribed: true }),
    skola('qaSkF06', 'ZŠ Len otvorila', 'qa.skola.f@qa-biz.local'),
  ]);
  const mail = (id, to, extra) => ({ _id: id, to, subject: 'Venček pre deviatakov', created_at: '2026-09-20T08:00:00.000Z', ...(extra || {}) });
  w('mail_log.db', [
    mail('qaMlA1', 'qa.skola.a@qa-biz.local', { opened_at: '2026-09-21T08:00:00.000Z', clicked_at: '2026-09-21T08:05:00.000Z' }),
    mail('qaMlB1', 'qa.skola.b@qa-biz.local', { opened_at: '2026-09-22T08:00:00.000Z', clicked_at: '2026-09-22T08:05:00.000Z' }),
    mail('qaMlC1', 'qa.skola.c@qa-biz.local', { clicked_at: '2026-09-23T08:05:00.000Z' }),
    mail('qaMlD1', 'qa.skola.d@qa-biz.local', { clicked_at: '2026-09-24T08:05:00.000Z' }),
    mail('qaMlE1', 'qa.skola.e@qa-biz.local', { clicked_at: '2026-09-25T08:05:00.000Z' }),
    mail('qaMlF1', 'qa.skola.f@qa-biz.local', { opened_at: '2026-09-26T08:00:00.000Z' }),
  ]);

  console.log('VENČEKY — ŠKOLY S KLIKOM V NEODKLADNÝCH\n');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TZ: 'UTC', PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_FAKE: '1', NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await sleep(12000);

  try {
    const jar = { adm: {} };
    let r = await j('/api/login', { method: 'POST', body: { email: 'qa.sk.admin@qa-biz.local', password: 'Heslo123!' } }, jar.adm);
    ok('admin prihlásený', r.status === 200, JSON.stringify(r.d));

    console.log('\n1) Úloha sa vôbec objaví:');
    r = await j('/api/admin/urgent-tasks', {}, jar.adm);
    let skoly = (r.d.tasks || []).filter(t => String(t.key).startsWith('skola_klik_'));
    ok('školy s klikom sú medzi neodkladnými', skoly.length === 3, 'našiel ' + skoly.length + ' z ' + (r.d.tasks || []).length);
    ok('nie je tam škola, ktorej už niekto volal', !skoly.some(t => /Volané/.test(t.name || '')));
    ok('nie je tam odhlásená škola', !skoly.some(t => /Odhlásená/.test(t.name || '')));
    ok('nie je tam škola, čo mail len otvorila', !skoly.some(t => /otvorila/.test(t.name || '')));

    console.log('\n2) Tvar úlohy je rovnaký ako pri ostatných:');
    const t = skoly.find(x => /Kukučínova/.test(x.name || ''));
    ok('karta má meno školy aj mesto', t && t.name === 'ZŠ Kukučínova (Detva)', t && t.name);
    ok('karta má titul a vysvetlenie', !!(t && t.title && t.why && !t.text), JSON.stringify(t && { title: t.title, text: t.text }));
    ok('v texte je dátum kliku', !!(t && /2026-09-21/.test(t.why)), t && t.why);
    ok('karta má telefón na školu', !!(t && t.phone), t && t.phone);
    ok('typ je skola (kvôli ikone v admine)', !!(t && t.type === 'skola'), t && t.type);
    ok('najnovší klik je hore', skoly[0] && /Štúrova/.test(skoly[0].name), skoly.map(x => x.name).join(' | '));

    console.log('\n3) Po zápise hovoru úloha zmizne:');
    r = await j('/api/admin/schools/qaSkA01/crm', { method: 'POST', body: { stav: 'dovolane', volane: true, poznamka: 'Riaditeľka chce ponuku mailom.' } }, jar.adm);
    ok('zápis z hovoru prešiel', r.status === 200, JSON.stringify(r.d));
    r = await j('/api/admin/urgent-tasks', {}, jar.adm);
    skoly = (r.d.tasks || []).filter(x => String(x.key).startsWith('skola_klik_'));
    ok('dovolaná škola už neotravuje', skoly.length === 2 && !skoly.some(x => /Kukučínova/.test(x.name || '')), skoly.map(x => x.name).join(' | '));

    console.log('\n4) Pri viac ako troch školách pribudne súhrn:');
    // doplníme štyri ďalšie kliky priamo do mail_log + schools (bez API, aby test nezávisel od importu)
    const pridaj = [];
    for (let i = 1; i <= 4; i++) {
      pridaj.push(JSON.stringify(skola('qaSkX0' + i, 'ZŠ Nová ' + i, 'qa.skola.x' + i + '@qa-biz.local')));
    }
    fs.appendFileSync(path.join(DATA, 'schools.db'), pridaj.join('\n') + '\n');
    const pridajM = [];
    for (let i = 1; i <= 4; i++) {
      pridajM.push(JSON.stringify(mail('qaMlX' + i, 'qa.skola.x' + i + '@qa-biz.local', { clicked_at: '2026-09-1' + i + 'T08:05:00.000Z' })));
    }
    fs.appendFileSync(path.join(DATA, 'mail_log.db'), pridajM.join('\n') + '\n');
    // reštart servera, nech NeDB prečíta doplnené riadky
    srv.kill(); await sleep(1200);
    const srv2 = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, TZ: 'UTC', PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
        RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_FAKE: '1', NODE_ENV: 'test' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    srv2.stderr.on('data', d => { chyba += d; });
    const t1 = Date.now(); let zije2 = false;
    while (Date.now() - t1 < 120000) { try { await fetch(BASE + '/'); zije2 = true; break; } catch (e) { await sleep(1000); } }
    await sleep(8000);
    const jar2 = { adm: {} };
    await j('/api/login', { method: 'POST', body: { email: 'qa.sk.admin@qa-biz.local', password: 'Heslo123!' } }, jar2.adm);
    r = await j('/api/admin/urgent-tasks', {}, jar2.adm);
    const karty = (r.d.tasks || []).filter(x => String(x.key).startsWith('skola_klik_'));
    const suhrn = (r.d.tasks || []).find(x => String(x.key).startsWith('skoly_kliky_suhrn'));
    ok('server po reštarte beží', zije2);
    ok('kariet ostávajú najviac tri', karty.length === 3, String(karty.length));
    ok('súhrn hovorí, koľko škôl čaká', !!suhrn && /6 škôl/.test(suhrn.name || ''), suhrn && suhrn.name);
    ok('súhrn nasmeruje do navolávania', !!suhrn && /Navolávanie škôl/.test(suhrn.why || ''), suhrn && suhrn.why);

    console.log('\n5) Vybavenie úlohy:');
    const kluc = karty[0].key;
    r = await j('/api/admin/urgent-tasks/dismiss', { method: 'POST', body: { key: kluc } }, jar2.adm);
    ok('úloha sa dá odkliknúť', r.status === 200, JSON.stringify(r.d));
    r = await j('/api/admin/urgent-tasks', {}, jar2.adm);
    ok('odkliknutá úloha sa nevráti', !(r.d.tasks || []).some(x => x.key === kluc));
    srv2.kill();
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    try { srv.kill(); } catch (e) {}
    await sleep(600);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nŠKOLY S KLIKOM: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-1500));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
