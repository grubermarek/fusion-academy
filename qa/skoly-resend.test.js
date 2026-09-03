/**
 * Opätovné odoslanie mailu škole (2.–3. 9. 2026).
 *
 * ZŠ Sekier tvrdila, že mail nedostala. Drip zámerne preskakuje školy so
 * sent_at, takže cez admin sa nedalo poslať znova. Nový /api/schools/resend
 * je chránený IMPORT_TOKEN, aby sa dal spustiť aj z terminálu.
 *
 * Stráži, že:
 *   · bez tokenu endpoint neexistuje (404), s tokenom pošle
 *   · škola dostane mail znova a zapíše sa, že šlo o resend
 *   · odhlásenej škole sa nepošle nič
 *   · vlastný predmet a text (napr. ponuka zľavy riaditeľke) sa použije
 *     namiesto štandardnej šablóny
 *
 * Spustenie:  node qa/skoly-resend.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4574;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-skres-'));
const TOKEN = 'qa-import-token-123';

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function post(url, body, token) {
  const r = await fetch(BASE + url, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-import-token': token } : {}) },
    body: JSON.stringify(body || {}) });
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'),
    JSON.stringify({ _id: 'qaSkAdmin000001', name: 'Adam Admin', email: 'qa.sk.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }) + '\n');
  fs.writeFileSync(path.join(DATA, 'schools.db'), [
    JSON.stringify({ _id: 'qaSkola00000001', name: 'ZŠ Sekier (QA)', email: 'qa.skola.sekier@qa-biz.local',
      city: 'Zvolen', status: 'sent', sent_at: '2026-08-28T07:02:25.531Z', created_at: '2026-08-27' }),
    JSON.stringify({ _id: 'qaSkola00000002', name: 'ZŠ Odhlásená (QA)', email: 'qa.skola.odhlas@qa-biz.local',
      city: 'Detva', status: 'sent', sent_at: '2026-08-28T07:02:25.531Z', unsubscribed: true, created_at: '2026-08-27' }),
    JSON.stringify({ _id: 'qaSkola00000003', name: 'ZŠ Kukučínova (QA)', email: 'qa.skola.detva@qa-biz.local',
      city: 'Detva', director: 'Mgr. Testová', status: 'sent', sent_at: '2026-08-29T07:06:27.316Z', created_at: '2026-08-27' }),
  ].join('\n') + '\n');

  console.log('RESEND ŠKOLE QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', IMPORT_TOKEN: TOKEN },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  try {
    console.log('\nOchrana tokenom:');
    const bez = await post('/api/schools/resend', { email: 'qa.skola.sekier@qa-biz.local' });
    ok('bez tokenu endpoint „neexistuje"', bez.status === 404, 'HTTP ' + bez.status);
    const zly = await post('/api/schools/resend', { email: 'qa.skola.sekier@qa-biz.local' }, 'zly-token');
    ok('so zlým tokenom tiež', zly.status === 404, 'HTTP ' + zly.status);

    console.log('\nOpätovné odoslanie (Sekier):');
    const pred = rd('mail_log.db').filter(m => m.to === 'qa.skola.sekier@qa-biz.local').length;
    const r = await post('/api/schools/resend', { email: 'qa.skola.sekier@qa-biz.local' }, TOKEN);
    ok('s tokenom prejde', r.status === 200 && r.d && r.d.ok, JSON.stringify(r.d).slice(0, 120));
    await new Promise(x => setTimeout(x, 700));
    const po = rd('mail_log.db').filter(m => m.to === 'qa.skola.sekier@qa-biz.local');
    ok('škole odišiel ďalší mail', po.length === pred + 1, pred + ' → ' + po.length);
    ok('so štandardnou šablónou pre školy', po.slice(-1)[0] && po.slice(-1)[0].template === 'skoly_posledny_tanec',
      po.slice(-1)[0] && po.slice(-1)[0].template);
    const s1 = rd('schools.db').find(x => x._id === 'qaSkola00000001');
    ok('zapísalo sa, že šlo o resend a kedy bol pôvodný', s1 && s1.resend_of === '2026-08-28T07:02:25.531Z' && !!s1.resend_at,
      JSON.stringify({ resend_of: s1 && s1.resend_of, resend_at: !!(s1 && s1.resend_at) }));
    ok('a škola má nové sent_at, takže drip ju nepošle ešte raz', s1 && s1.sent_at && s1.sent_at !== '2026-08-28T07:02:25.531Z',
      s1 && s1.sent_at);
    ok('dá sa poslať aj podľa id', (await post('/api/schools/resend', { id: 'qaSkola00000001' }, TOKEN)).status === 200);

    console.log('\nOdhlásená škola:');
    const odh = await post('/api/schools/resend', { email: 'qa.skola.odhlas@qa-biz.local' }, TOKEN);
    ok('nedostane nič', odh.status === 400 && /odhlásila/i.test(String(odh.d && odh.d.error)), JSON.stringify(odh.d));
    ok('a v logu po nej nie je stopa', rd('mail_log.db').filter(m => m.to === 'qa.skola.odhlas@qa-biz.local').length === 0);

    console.log('\nVlastný text (ponuka riaditeľke):');
    const vl = await post('/api/schools/resend', { email: 'qa.skola.detva@qa-biz.local',
      subject: 'Venček len pre vašu školu — 20 % zľava', html: '<p>Vážená pani riaditeľka, <b>20 % zľava</b> a samostatný venček.</p>' }, TOKEN);
    ok('vlastný mail prejde', vl.status === 200 && vl.d && vl.d.ok, JSON.stringify(vl.d).slice(0, 100));
    await new Promise(x => setTimeout(x, 700));
    const m3 = rd('mail_log.db').filter(m => m.to === 'qa.skola.detva@qa-biz.local').slice(-1)[0];
    ok('použil sa vlastný predmet, nie šablóna', m3 && m3.subject === 'Venček len pre vašu školu — 20 % zľava', m3 && m3.subject);
    ok('a vlastný text je v tele', m3 && /20 % zľava/.test(String(m3.html || '')), String(m3 && m3.html).slice(0, 80));
    ok('je označený ako ručná ponuka, nie drip', m3 && m3.template === 'skoly_rucna_ponuka', m3 && m3.template);
    ok('má pätičku s odhlásením', m3 && /\/unsubscribe\?e=/.test(String(m3.html || '')));

    console.log('\nNeexistujúca škola:');
    ok('vráti 404, nie 500', (await post('/api/schools/resend', { email: 'nikto@nikde.test' }, TOKEN)).status === 404);

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nRESEND ŠKOLE: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
