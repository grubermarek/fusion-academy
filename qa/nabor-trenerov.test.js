/**
 * Nábor trénerov — prihláška z webu (11. 9. 2026).
 *
 * Stránka fusionacademy.sk/programy/spolupracuj.html (Netlify) posiela
 * prihlášku do appky. Stráži, že:
 *   · web z inej domény prejde cez CORS (aj s hlavičkou na nahratie videa)
 *   · bez mena, telefónu, e-mailu, mesta alebo súhlasu sa prihláška neprijme
 *   · uloží sa medzi dopyty a admin ju vidí s typom „Nábor trénera"
 *   · Marek dostane mail a admin notifikáciu
 *   · HTML z formulára sa neuloží (prihláška je verejný vstup)
 *   · video sa nahrá len so správnym jednorazovým tokenom, len ako video
 *   · video si pozrie len admin
 *
 * Spustenie:  node qa/nabor-trenerov.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4595;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-nabor-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts, jar) {
  opts = opts || {};
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d, h: r.headers };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  w('users.db', [
    { _id: 'qaNbAdmin000001', name: 'Marek Gruber', email: 'qa.nb.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    { _id: 'qaNbKlient00001', name: 'Bežná Klientka', email: 'qa.nb.klient@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-05-01' },
  ]);

  console.log('NÁBOR TRÉNEROV\n');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 4000));

  const PRIHLASKA = {
    name: 'Nová <b>Trénerka</b>', phone: '0905 123 456', email: 'Qa.Nb.Trenerka@qa-biz.local', city: 'Zvolen', age: '27',
    class_types: ['Zumba a tanečné fitness', 'Mobility a strečing'], class_other: '', experience: 'Áno, tancujem / cvičím / pracujem s ľuďmi',
    qualification: 'Práve si ju robím', experience_note: 'licencia Zumba v marci', hours_week: '3–5 hodín',
    availability: ['Večer', 'Cez víkend'], income: 'Vedľajší', motivation: 'Chcem ľuďom dávať energiu.\nA baví ma to.',
    social: '@qa.trenerka', consent: true, has_video: true, utm: 'utm_source=facebook&utm_campaign=nabor', page: '/programy/spolupracuj.html',
  };

  try {
    console.log('1) Web z inej domény:');
    const opt = await fetch(BASE + '/api/public/trainer-application', { method: 'OPTIONS' });
    ok('preflight prejde', opt.status === 204, 'HTTP ' + opt.status);
    ok('povolí akúkoľvek doménu', opt.headers.get('access-control-allow-origin') === '*');
    const optV = await fetch(BASE + '/api/public/trainer-application/x/video', { method: 'OPTIONS' });
    ok('preflight videa pustí hlavičku s tokenom', /x-upload-token/i.test(optV.headers.get('access-control-allow-headers') || ''));

    console.log('\n2) Neúplná prihláška sa neprijme:');
    const bez = async (pole, hodnota) => (await j('/api/public/trainer-application', { method: 'POST', body: { ...PRIHLASKA, [pole]: hodnota } })).status;
    ok('bez mena', await bez('name', '') === 400);
    ok('bez telefónu', await bez('phone', '') === 400);
    ok('so zlým e-mailom', await bez('email', 'nie-je-mail') === 400);
    ok('bez mesta', await bez('city', '') === 400);
    ok('bez súhlasu', await bez('consent', false) === 400);
    ok('nič z toho sa neuložilo', rd('rentals.db').length === 0, String(rd('rentals.db').length));

    console.log('\n3) Platná prihláška:');
    const p = await j('/api/public/trainer-application', { method: 'POST', body: PRIHLASKA });
    ok('prejde', p.status === 200 && p.d && p.d.ok && p.d.id, JSON.stringify(p.d));
    ok('vráti jednorazový token na video', p.d && /^[0-9a-f]{32}$/.test(p.d.upload_token || ''));
    ok('odpoveď má CORS hlavičku', p.h.get('access-control-allow-origin') === '*');
    await new Promise(r => setTimeout(r, 700));
    const z = rd('rentals.db').find(x => x._id === (p.d && p.d.id)) || {};
    ok('uložená ako prihláška trénera', z._type === 'trainer_application' && z.event_type === '🎤 Nábor trénera', z._type + ' / ' + z.event_type);
    ok('HTML z mena je preč', z.name === 'Nová bTrénerka/b', z.name);
    ok('e-mail malými písmenami', z.email === 'qa.nb.trenerka@qa-biz.local', z.email);
    ok('vek ako číslo', z.age === 27, String(z.age));
    ok('druhy hodín aj čas ako zoznam', Array.isArray(z.class_types) && z.class_types.length === 2
      && Array.isArray(z.availability) && z.availability.includes('Večer'), JSON.stringify([z.class_types, z.availability]));
    ok('zhrnutie pre tabuľku v admine', /Zumba/.test(z.message || '') && /vedľajší/.test(z.message || ''), z.message);
    ok('stav „nový"', z.status === 'new');

    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.nb.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    const zoz = await j('/api/admin/rentals', {}, adm);
    ok('admin ju vidí v dopytoch', Array.isArray(zoz.d) && zoz.d.some(x => x._id === z._id && x.event_type === '🎤 Nábor trénera'));
    ok('admin dostal notifikáciu', rd('notifications.db').some(n => n.user_id === 'qaNbAdmin000001' && n.type === 'trainer_application'));
    const maily = rd('mail_log.db').filter(m => String(m.to).toLowerCase() === 'gruber.marek@gmail.com');
    ok('Marek dostal mail s menom a mestom', maily.some(m => /Nový tréner sa hlási/.test(m.subject || '') && /Zvolen/.test(m.subject || '')),
      JSON.stringify(maily.map(m => m.subject)));

    console.log('\n4) Video:');
    const vid = Buffer.alloc(4096, 7);
    const nahraj = (token, typ, telo) => fetch(BASE + '/api/public/trainer-application/' + z._id + '/video',
      { method: 'POST', headers: { 'Content-Type': typ, 'X-Upload-Token': token }, body: telo });
    ok('so zlým tokenom neprejde', (await nahraj('0'.repeat(32), 'video/mp4', vid)).status === 403);
    ok('obrázok namiesto videa neprejde', (await nahraj(p.d.upload_token, 'image/jpeg', vid)).status === 400);
    const v = await nahraj(p.d.upload_token, 'video/mp4', vid);
    ok('video so správnym tokenom prejde', v.status === 200, 'HTTP ' + v.status);
    await new Promise(r => setTimeout(r, 600));
    const subor = path.join(DATA, 'uploads', 'nabor', z._id + '.mp4');
    ok('súbor je uložený celý', fs.existsSync(subor) && fs.statSync(subor).size === 4096);
    const z2 = rd('rentals.db').find(x => x._id === z._id) || {};
    ok('prihláška vie o videu a token je spotrebovaný', z2.video_file === z._id + '.mp4' && !z2.upload_token, JSON.stringify({ f: z2.video_file, t: !!z2.upload_token }));
    ok('druhé nahratie tým istým tokenom neprejde', (await nahraj(p.d.upload_token, 'video/mp4', vid)).status === 403);
    ok('Marek dostal mail s odkazom na video', rd('mail_log.db').some(m => /Video k prihláške/.test(m.subject || '')));

    const pozri = await fetch(BASE + '/api/admin/trainer-applications/' + z._id + '/video', { headers: { Cookie: adm.cookie } });
    const telo = Buffer.from(await pozri.arrayBuffer());
    ok('admin si video pozrie', pozri.status === 200 && /video\/mp4/.test(pozri.headers.get('content-type') || '') && telo.length === 4096,
      pozri.status + ' ' + pozri.headers.get('content-type') + ' ' + telo.length);
    const kl = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.nb.klient@qa-biz.local', password: 'Heslo123!' } }, kl);
    const cudzi = await fetch(BASE + '/api/admin/trainer-applications/' + z._id + '/video', { headers: { Cookie: kl.cookie } });
    ok('klientka nie', cudzi.status === 401 || cudzi.status === 403, 'HTTP ' + cudzi.status);
    const anon = await fetch(BASE + '/api/admin/trainer-applications/' + z._id + '/video');
    ok('neprihlásený nie', anon.status === 401 || anon.status === 403, 'HTTP ' + anon.status);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    setTimeout(() => {
      fs.rmSync(DATA, { recursive: true, force: true });
      console.log('\nNÁBOR TRÉNEROV: ' + passed + ' OK / ' + failed + ' chýb');
      if (failed && chyba) console.log(chyba.slice(-900));
      process.exit(failed ? 1 : 0);
    }, 500);
  }
})();
