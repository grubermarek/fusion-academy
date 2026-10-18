/**
 * Strážca tokenu a CAPI — ticho musí byť nález (18. 10. 2026)
 *
 * Token pre Metu vypršal 13. 10. a všimli sme si to až 18. 10. Strážca dovtedy hlásil
 * chybu, len kým bola mladšia než 48 hodín, a staré „posledná ok" ukazoval ako zelenú —
 * takže päť dní tvrdil, že je všetko v poriadku, hoci Meta nedostala ani jednu udalosť.
 * Denné predlžovanie tokenu pritom ticho nerobilo nič, lebo v nastaveniach chýbal
 * app secret, a jediná stopa po tom bola vo výpise na Railway, ktorý sa nedrží.
 *
 * Stráži, že:
 *   · dlhé ticho v CAPI je nález, nie zelená — aj keď žiadna chyba neprišla
 *   · nález povie, že reklama pritom beží (teda že sa za slepé meranie platí)
 *   · token pred vypršaním stupňuje: do 3 dní súrne
 *   · chýbajúci app secret je vlastný nález (inak sa token nevie predĺžiť sám)
 *   · nálezy okolo tokenu a CAPI prídu adminovi aj mailom, nielen do notifikácií
 *
 * Spustenie:  node qa/strazca-capi.test.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4619, GPORT = 4620;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-strazca-'));
const TOKEN = 'qa-strazca-token';
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const rd = f => { const p = path.join(DATA, f); if (!fs.existsSync(p)) return []; const m = new Map();
  fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (o._id) m.set(o._id, o); } catch (e) {} });
  return [...m.values()]; };

// Falošný Graph API: token je platný, ale vyprší o dva dni, a jedna reklama míňa.
const graf = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const J = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const p = u.pathname.replace(/^\/+/, '');
  if (p === 'debug_token') return J({ data: { is_valid: true, expires_at: Math.floor(Date.now() / 1000) + 2 * 86400 } });
  if (p === 'act_51759494/insights' && u.searchParams.get('level') === 'ad') return J({ data: [
    { ad_id: '777', ad_name: 'QA reklama', campaign_id: '9007', campaign_name: 'QA kampaň', spend: '4.20' } ] });
  if (p.startsWith('act_51759494/')) return J({ data: [] });
  // Reklama je po stránke merania v poriadku — nech test nerieši cudzie nálezy.
  if (p === '777') return J({ id: '777', name: 'QA reklama',
    tracking_specs: [{ 'action.type': ['offsite_conversion'], fb_pixel: ['PIXQA'] }],
    creative: { url_tags: '', object_story_spec: { link_data: { link: BASE + '/prva-hodina?utm_source=fb&utm_medium=cpc&utm_campaign=qa-strazca' } } } });
  return J({ data: [] });
});

(async () => {
  const pred5dnami = new Date(Date.now() - 5 * 864e5).toISOString();
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaStrAdmin00001', name: 'QA Admin', email: 'qa.strazca.admin@qa-biz.local',
      password: bcrypt.hashSync('Heslo123!', 10), is_admin: true, active: true, user_type: 'admin',
      referral_code: 'QASTRADM', rank: 1, visit_count: 0, referral_credit: 0, created_at: '2026-01-01' },
  ]));
  fs.writeFileSync(path.join(DATA, 'campaigns.db'), riadky([
    { _id: 'qaStrKarta00001', name: 'QA kampaň', platform: 'facebook', utm_key: 'qa-strazca*',
      meta_campaign_id: '9007', spend: 0, created_at: '2026-10-01' },
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky([
    { _id: 'qaStrSetTok0001', key: 'meta_ads_token', value: 'tok_qa_strazca' },
    { _id: 'qaStrSetCapi001', key: 'meta_capi_token', value: 'tok_qa_strazca' },
    // Posledná prijatá udalosť pred piatimi dňami a ŽIADNA chyba — presne stav,
    // ktorý strážca dovtedy vyhodnotil ako zelenú.
    { _id: 'qaStrSetStav001', key: 'meta_capi_stav', value: {
      udalosti: { CompleteRegistration: { ok: 4, chyby: 0, posledna_ok: pred5dnami } },
      posledna_ok: pred5dnami } },
  ]));

  await new Promise(r => graf.listen(GPORT, r));
  console.log('STRÁŽCA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1',
      MAIL_CAPTURE: '1', IMPORT_TOKEN: TOKEN, META_GRAPH_URL: 'http://localhost:' + GPORT + '/',
      META_PIXEL_ID: 'PIXQA' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await sleep(9000);

  const jar = {};
  const ide = async (url, opts = {}) => {
    const r = await fetch(BASE + url, { redirect: 'manual', headers: { 'Content-Type': 'application/json', 'Cookie': Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ') }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); });
    let d = null; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };

  try {
    await ide('/api/login', { method: 'POST', body: { email: 'qa.strazca.admin@qa-biz.local', password: 'Heslo123!' } });
    // Kontrola s upozornením beží cez servisný endpoint (admin tlačidlo neupozorňuje).
    await fetch(BASE + '/api/service/ads-sync', { method: 'POST', headers: { 'x-import-token': TOKEN, 'Content-Type': 'application/json' }, body: '{}' });
    await sleep(1500);
    const m = await ide('/api/admin/meranie');
    const nalezy = (m.d && m.d.stav && m.d.stav.nalezy) || [];
    const text = nalezy.map(n => n.text).join(' | ');
    const okTexty = ((m.d && m.d.stav && m.d.stav.ok) || []).join(' | ');

    console.log('\n1) Ticho v CAPI:');
    ok('ticho je nález, nie zelená', nalezy.some(n => n.kod === 'capi'), text);
    ok('nález hovorí, koľko dní neprešla udalosť', /neprešla žiadna udalosť z appky už 5 dní/.test(text), text);
    ok('nález pripomenie, že reklama beží', /reklama pritom beží/.test(text), text);
    ok('staré „prijaté" sa už neukazuje ako v poriadku', !/Meta prijala udalosť/.test(okTexty), okTexty);

    console.log('\n2) Token:');
    ok('vypršanie do 3 dní je súrne', /Token pre Metu vyprší o 2 dni/.test(text), text);
    ok('chýbajúci app secret je vlastný nález', /nevie predĺžiť sám/.test(text), text);
    ok('návrh riešenia je v náleze (systémový používateľ)', /systémového používateľa/.test(text), text);

    console.log('\n3) Upozornenia:');
    const mojeOznamy = rd('notifications.db').filter(n => n.type === 'meranie' && n.user_id === 'qaStrAdmin00001');
    ok('každý admin má oznam v appke ku každému nálezu', mojeOznamy.length === nalezy.length,
      mojeOznamy.length + ' / ' + nalezy.length);
    const maily = rd('mail_log.db').filter(x => x.template === 'meranie_alert');
    // Mail ide len majiteľovi — token ani app secret nikto iný vybaviť nevie.
    ok('mail odišiel práve raz', maily.length === 1, JSON.stringify(maily.map(x => x.to + ': ' + x.subject)));
    ok('…a práve majiteľovi', maily.length === 1 && maily[0].to === 'gruber.marek@gmail.com', JSON.stringify((maily[0] || {}).to));
    ok('predmet povie, koľko nálezov', maily.length === 1 && /3 nálezy/.test(maily[0].subject), JSON.stringify((maily[0] || {}).subject));

    console.log('\n4) Neopakuje sa:');
    const oznamovPred = rd('notifications.db').filter(n => n.type === 'meranie').length;
    await fetch(BASE + '/api/service/ads-sync', { method: 'POST', headers: { 'x-import-token': TOKEN, 'Content-Type': 'application/json' }, body: '{}' });
    await sleep(1500);
    ok('druhá kontrola v ten istý deň neupozorní znova',
      rd('notifications.db').filter(n => n.type === 'meranie').length === oznamovPred
      && rd('mail_log.db').filter(x => x.template === 'meranie_alert').length === 1,
      'oznamy ' + oznamovPred + ' → ' + rd('notifications.db').filter(n => n.type === 'meranie').length);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    srv.kill(); graf.close();
    await sleep(600);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nSTRÁŽCA TOKENU A CAPI: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-900));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
