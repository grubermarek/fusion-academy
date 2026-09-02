/**
 * Oprava dňa Latin Tropical Party (2. 9. 2026).
 *
 * V pozvánke bolo „V piatok tancujeme", ale 5. 9. 2026 je SOBOTA. Mail odišiel
 * 280 ľuďom. Test stráži, že oprava:
 *   · príde presne tým, komu odišiel zlý mail — nikomu inému
 *   · nepošle sa nikomu dvakrát
 *   · obsahuje správny deň aj odkaz na lístky
 *   · a že pôvodná pozvánka po oprave predmetu neodíde druhýkrát
 *
 * Vedľajší produkt: uloží náhľad do qa/nahlad-oprava.html.
 *
 * Spustenie:  node qa/oprava-dna.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4571;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-opr-'));

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

const ZLY = '🍹 V piatok tancujeme — vstup 5 € do dňa akcie';
const OPRAVA = 'Oprava: Latin Tropical Party je v SOBOTU 5. 9., nie v piatok 🙏';

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  let kod = 0;
  const K = (id, meno, mail) => JSON.stringify({ _id: id, name: meno, email: mail,
    password: hash, user_type: 'client', active: true, referral_code: 'QAOPR' + String(++kod).padStart(2, '0'),
    visit_count: 3, created_at: '2026-06-01', city: 'Detva' });

  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaOprAdmin00001', name: 'Adam Admin', email: 'qa.opr.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }),
    K('qaOprDostal001', 'Dana Dostala', 'qa.opr.dostal@qa-biz.local'),
    K('qaOprDostal002', 'Petra Dostala', 'qa.opr.dostal2@qa-biz.local'),
    K('qaOprNedostal1', 'Nina Nedostala', 'qa.opr.nedostal@qa-biz.local'),
  ].join('\n') + '\n');

  // Dvom zlý mail odišiel, tretej nie — oprava musí ísť len tým dvom.
  fs.writeFileSync(path.join(DATA, 'mail_log.db'), [
    JSON.stringify({ _id: 'qaOprMail000001', to: 'qa.opr.dostal@qa-biz.local', subject: ZLY,
      template: 'event_campaign_party', created_at: '2026-09-02T09:00:00.000Z' }),
    JSON.stringify({ _id: 'qaOprMail000002', to: 'qa.opr.dostal2@qa-biz.local', subject: ZLY,
      template: 'event_campaign_party', created_at: '2026-09-02T09:01:00.000Z' }),
  ].join('\n') + '\n');

  console.log('OPRAVA DŇA QA — štart servera…');
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
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.opr.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    console.log('\n5. 9. 2026 je naozaj sobota:');
    ok('kontrola dátumu', ['nedeľa','pondelok','utorok','streda','štvrtok','piatok','sobota'][new Date('2026-09-05T12:00:00').getDay()] === 'sobota');

    console.log('\nOprava odchádza:');
    const r = await j('/api/admin/qa/run-event-mail/oprava', { method: 'POST' }, adm);
    ok('vlna zbehla', r.status === 200 && r.d && !r.d.error, JSON.stringify(r.d).slice(0, 120));
    await new Promise(x => setTimeout(x, 900));

    const opravy = rd('mail_log.db').filter(m => m.subject === OPRAVA);
    const komu = opravy.map(m => String(m.to).toLowerCase()).sort();
    ok('prišla presne tým dvom, čo dostali zlý mail', komu.length === 2
      && komu.join() === 'qa.opr.dostal2@qa-biz.local,qa.opr.dostal@qa-biz.local', JSON.stringify(komu));
    ok('a nikomu inému', !komu.includes('qa.opr.nedostal@qa-biz.local'));

    console.log('\nObsah opravy:');
    const html = String((opravy[0] && (opravy[0].html || opravy[0].body)) || '');
    ok('hovorí, že sa pomýlil', /pomýlili sme sa|naša chyba/i.test(html));
    ok('menuje správny deň veľkými', /SOBOTA 5\. septembra/.test(html));
    ok('aj čas a miesto', /21:00/.test(html) && /Fusion Club Detva/.test(html));
    ok('drží pôvodnú cenu 5 €', /5 €/.test(html) && /10 €/.test(html));
    ok('a má odkaz na lístky', /latin-tropical-2026/.test(html));
    ok('je oslovená menom', /Dana|Petra/.test(html));
    if (html) { fs.writeFileSync(path.join(__dirname, 'nahlad-oprava.html'), html); console.log('  📄 náhľad: qa/nahlad-oprava.html'); }

    console.log('\nDruhé spustenie:');
    await j('/api/admin/qa/run-event-mail/oprava', { method: 'POST' }, adm);
    await new Promise(x => setTimeout(x, 700));
    ok('nikto nedostane opravu dvakrát',
      rd('mail_log.db').filter(m => m.subject === OPRAVA).length === 2,
      String(rd('mail_log.db').filter(m => m.subject === OPRAVA).length));

    console.log('\nPôvodná pozvánka po oprave predmetu:');
    const p = await j('/api/admin/qa/run-event-mail/party', { method: 'POST' }, adm);
    await new Promise(x => setTimeout(x, 900));
    const znova = rd('mail_log.db').filter(m => /tancujeme/.test(String(m.subject || ''))
      && ['qa.opr.dostal@qa-biz.local', 'qa.opr.dostal2@qa-biz.local'].includes(String(m.to).toLowerCase()));
    ok('tí dvaja ju nedostanú druhýkrát', znova.length === 2,
      JSON.stringify(znova.map(m => m.to + ' · ' + m.subject)).slice(0, 160));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nOPRAVA DŇA: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
