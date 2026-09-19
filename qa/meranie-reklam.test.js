/**
 * Meranie reklám „raz a navždy správne" (Marek 16. 9. 2026).
 *
 * Kampaň HEJ BABY mala za mesiac 3 090 návštev a v appke 2 priradené registrácie —
 * presmerovanie strácalo utm/fbclid, reklama neposielala Mete udalosti webu, karty
 * rátali útratu A/B reklamy dvakrát a nikto sa to nedozvedel. Test stráži:
 *   · zdroj návštevy v cookie zo servera (aj cez presmerovanie, prvý dotyk, nie pre /api)
 *   · registrácia si zdroj doplní z cookie; fbclid z tej istej kampane sa doplní
 *   · číslo reklamy z fbclid a odvodenie kampane z inej registrácie z tej istej reklamy
 *   · udalosť pre Metu nesie čas kliku, external_id, IP a prehliadač
 *   · karta celej kampane neráta reklamu, ktorá má vlastnú kartu
 *   · strážca merania: token, utm, udalosti webu, nefunkčný odkaz, chýbajúca karta,
 *     odmietnuté udalosti, nepriradené registrácie; upozornenie raz, nie pri každej kontrole
 *   · karta „Meranie reklám" v admine
 *
 * Spustenie:  node qa/meranie-reklam.test.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4606, GPORT = 4607;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-meranie-'));
const CAPI = path.join(DATA, 'capi.jsonl');
const TOKEN = 'qa-meranie-token';
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

// Prehliadač s cookies (session aj fa_zdroj)
function prehliadac() {
  const c = {};
  return {
    c,
    async ide(url, opts = {}) {
      const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      const k = Object.entries(c).map(([a, b]) => a + '=' + b).join('; ');
      if (k) headers.Cookie = k;
      const r = await fetch(BASE + url, { method: opts.method || 'GET', headers, redirect: 'manual', body: opts.body ? JSON.stringify(opts.body) : undefined });
      for (const sc of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [p] = sc.split(';'); const i = p.indexOf('='); c[p.slice(0, i)] = p.slice(i + 1); }
      let d = null; try { d = await r.json(); } catch (e) {}
      return { status: r.status, d, loc: r.headers.get('location') || '' };
    },
  };
}
// Syntetický fbclid s číslom reklamy (tvar ako z platenej reklamy) a bez neho (organický klik)
const fbclidReklama = adid => { const b = Buffer.alloc(24); b.write('pdof', 0); b.write('adid', 4); b.writeBigUInt64BE(BigInt(adid), 8); b.write('srtcapp_', 16); return 'Iw' + b.toString('base64url') + '_aem_qa'; };
const fbclidOrganicky = () => 'Iw' + Buffer.from('clck\x05ext\x03aem\x0211srtc\x06app_id').toString('base64url') + '_aem_qa';
const REKLAMA_X = '52547260236073', REKLAMA_Y = '52599999999999';

// Falošný Graph API
const volania = [];
const graf = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  volania.push(u.pathname + u.search);
  const f = u.searchParams.get('fields') || '', dp = u.searchParams.get('date_preset') || '';
  const J = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const p = u.pathname.replace(/^\/+/, '');
  if (p === 'debug_token') return J({ data: { is_valid: true, expires_at: Math.floor(Date.now() / 1000) + 5 * 86400 } });
  if (p === 'act_51759494/insights' && u.searchParams.get('level') === 'ad') return J({ data: [
    { ad_id: '111', ad_name: 'HEJ reklama', campaign_id: '9001', campaign_name: 'FA — Video HEJ BABY', spend: '5.10' },
    { ad_id: '222', ad_name: 'Zlá reklama', campaign_id: '9002', campaign_name: 'Kampaň bez karty', spend: '3.00' },
    { ad_id: '444', ad_name: 'Stará', campaign_id: '9004', campaign_name: 'Vypnutá', spend: '0' },
    { ad_id: '555', ad_name: 'Nábor Kids', campaign_id: '9005', campaign_name: 'Kids nábor', spend: '5.37' } ] });
  if (p === '555' && f.includes('tracking_specs')) return J({ id: '555', name: 'Nábor Kids', adset: { end_time: '2026-09-13T13:00:00-0700' }, campaign: { stop_time: '2026-09-13T13:00:00-0700' },
    tracking_specs: [], creative: { object_story_spec: { link_data: { link: BASE + '/neexistuje-kids' } } } });
  if (p.startsWith('act_51759494/')) return J({ data: [] });
  if (p === '111' && f.includes('tracking_specs')) return J({ id: '111', name: 'HEJ reklama',
    tracking_specs: [{ 'action.type': ['offsite_conversion'], fb_pixel: ['PIX123'] }],
    creative: { object_story_spec: { video_data: { call_to_action: { type: 'BOOK_TRAVEL', value: { link: BASE + '/prva-hodina?utm_source=fb&utm_medium=cpc&utm_campaign=fa-video-hej-baby' } } } } } });
  if (p === '222' && f.includes('tracking_specs')) return J({ id: '222', name: 'Zlá reklama',
    tracking_specs: [{ 'action.type': ['onsite_conversion'] }],
    creative: { object_story_spec: { link_data: { link: BASE + '/neexistuje-strazca' } } } });
  const ins = (spend, impr, clicks, extra) => J({ data: [{ spend: String(spend), impressions: String(impr), clicks: String(clicks), reach: '500', ...(extra || {}) }] });
  if (p === '9001/insights') return dp === 'last_7d' ? J({ data: [{ spend: '35', actions: [{ action_type: 'landing_page_view', value: '150' }] }] }) : ins(144.65, 63988, 4194);
  if (p === '9003/insights') return dp === 'last_7d' ? J({ data: [{ spend: '10' }] }) : ins(243.34, 1000, 100);
  if (p === '333/insights') return dp === 'last_7d' ? J({ data: [{ spend: '4' }] }) : ins(117.02, 400, 30);
  if (/^\d+$/.test(p) && f === 'effective_status') return J({ id: p, effective_status: 'ACTIVE' });
  return J({ data: [] });
});

(async () => {
  await new Promise(r => graf.listen(GPORT, r));
  const hash = bcrypt.hashSync('Heslo123!', 10);
  w('users.db', [{ _id: 'qaMrAdmin000001', name: 'Admin Meranie', email: 'qa.mr.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01', referral_code: 'QAMRADM' }]);
  w('campaigns.db', [
    { _id: 'qaMrKartaHej001', name: 'QA — Video HEJ BABY', platform: 'facebook', utm_key: 'fa-video-hej*', meta_campaign_id: '9001', date_from: '2026-08-17', budget: 5, spend: 0, created_at: '2026-08-18' },
    { _id: 'qaMrKartaWeb001', name: 'QA — celá kampaň Web', platform: 'facebook', utm_key: 'qa-web-cela', meta_campaign_id: '9003', date_from: '2026-07-27', spend: 0, created_at: '2026-07-27' },
    { _id: 'qaMrKartaAB0001', name: 'QA — A/B reklama', platform: 'facebook', utm_key: 'qa-ab-reklama', meta_campaign_id: '9003', meta_ad_id: '333', date_from: '2026-08-07', spend: 0, created_at: '2026-08-07' },
  ]);
  const hodinuDozadu = new Date(Date.now() - 3600e3).toISOString();
  w('settings.db', [
    { _id: 'qaMrSetTok00001', key: 'meta_ads_token', value: 'tok_test_qa' },
    { _id: 'qaMrSetCapi0001', key: 'meta_capi_stav', value: { udalosti: { CompleteRegistration: { ok: 3, chyby: 1, chyba: 'Invalid parameter' } }, posledna_ok: new Date(Date.now() - 5 * 3600e3).toISOString(), posledna_chyba: hodinuDozadu, chyba: 'Invalid parameter' } },
  ]);

  console.log('MERANIE REKLÁM\n');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TZ: 'UTC', PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1',
      PRVY_TYZDEN: '1', IMPORT_TOKEN: TOKEN, META_GRAPH_URL: 'http://localhost:' + GPORT + '/', META_PIXEL_ID: 'PIX123', CAPI_DEBUG_FILE: CAPI },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/api/config'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await sleep(2000);
  let browser;
  try {
    const reg = (b, meno, mail, attribution) => b.ide('/api/register', { method: 'POST', body: { name: meno, email: mail, password: 'Heslo123!', city: 'Detva', consent: true, user_type: 'client', ...(attribution ? { attribution } : {}) } });
    const usr = e => rd('users.db').find(u => u.email === e);

    console.log('1) Zdroj návštevy v cookie zo servera:');
    const A = prehliadac();
    const FX = fbclidReklama(REKLAMA_X);
    // Od 19. 9. je smer opačný: klik z reklamy na úvod „/" ide na landing /prva-hodina (aj s parametrami)
    const r1 = await A.ide('/?utm_source=fb&utm_medium=cpc&utm_campaign=fa-video-hej-baby&fbclid=' + FX);
    ok('presmerovanie s parametrami', r1.status === 302 && r1.loc.startsWith('/prva-hodina?') && r1.loc.includes('utm_campaign=fa-video-hej-baby') && r1.loc.includes('fbclid='), r1.loc);
    ok('cookie fa_zdroj nastavená už pri presmerovaní', !!A.c.fa_zdroj, JSON.stringify(Object.keys(A.c)));
    const zdroj = JSON.parse(Buffer.from(decodeURIComponent(A.c.fa_zdroj || ''), 'base64url').toString() || '{}');
    ok('nesie kampaň, fbclid, vstupnú adresu a čas', zdroj.utm_campaign === 'fa-video-hej-baby' && zdroj.fbclid === FX && /^\/(prva-hodina)?\?/.test(zdroj.landing) && !!zdroj.at, JSON.stringify(zdroj).slice(0, 160));
    const pred = A.c.fa_zdroj;
    await A.ide('/?utm_source=google&utm_campaign=ina-kampan');
    ok('neskoršia návšteva prvý dotyk neprepíše', A.c.fa_zdroj === pred);
    const B0 = prehliadac();
    await B0.ide('/api/config?utm_campaign=api');
    ok('volanie /api cookie nenastaví', !B0.c.fa_zdroj);
    const O = prehliadac();
    await O.ide('/about-bez-parametrov');
    ok('návšteva bez parametrov cookie nenastaví', !O.c.fa_zdroj);

    console.log('\n2) Registrácia si zdroj doplní:');
    // Stránka po presmerovaní pošle utm, ale nie fbclid (napr. in-app prehliadač bez localStorage)
    const ra = await reg(A, 'Anna Z Reklamy', 'qa.mr.anna@qa-biz.local', { utm_source: 'fb', utm_medium: 'cpc', utm_campaign: 'fa-video-hej-baby', landing: '/?src=prva-hodina', event_id: 'ev_anna' });
    ok('registrácia prešla', ra.status === 200, JSON.stringify(ra.d));
    await sleep(700);
    const ua = usr('qa.mr.anna@qa-biz.local');
    ok('fbclid doplnený z cookie (tá istá kampaň)', ua.fbclid === FX, ua.fbclid);
    ok('zdroj meta, kampaň z reklamy', ua.lead_source === 'meta' && ua.utm_campaign === 'fa-video-hej-baby');
    ok('číslo reklamy z fbclid', ua.meta_klik === REKLAMA_X, ua.meta_klik);
    ok('čas kliku uložený', !!ua.klik_at && ua.klik_at === zdroj.at, ua.klik_at);
    const capi = fs.existsSync(CAPI) ? fs.readFileSync(CAPI, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    const ev = capi.find(x => x.event_name === 'CompleteRegistration' && x.event_id === 'ev_anna');
    ok('Meta dostane registráciu s fbclid, časom kliku, external_id, IP a prehliadačom', ev && ev.fbclid && ev.click_at === zdroj.at && ev.external_id && ev.ip && ev.ua, JSON.stringify(ev));

    const B = prehliadac();
    await B.ide('/?fbclid=' + FX);
    const rb = await reg(B, 'Beata Bez Utm', 'qa.mr.beata@qa-biz.local', {});
    ok('registrácia bez údajov zo stránky prešla', rb.status === 200);
    await sleep(700);
    const ub = usr('qa.mr.beata@qa-biz.local');
    ok('zdroj celý z cookie (fbclid, vstupná adresa)', ub.fbclid === FX && ub.landing_page === '/?fbclid=' + FX && ub.lead_source === 'meta', JSON.stringify({ f: !!ub.fbclid, l: ub.landing_page, s: ub.lead_source }));
    ok('kampaň odvodená z registrácie z tej istej reklamy', ub.utm_campaign === 'fa-video-hej-baby' && ub.utm_odvodene === 'fbclid', JSON.stringify({ c: ub.utm_campaign, o: ub.utm_odvodene }));

    const C = prehliadac();
    await C.ide('/?fbclid=' + fbclidReklama(REKLAMA_Y));
    await reg(C, 'Cecilia Neznama', 'qa.mr.cecilia@qa-biz.local', {});
    const D = prehliadac();
    await D.ide('/?fbclid=' + fbclidOrganicky());
    await reg(D, 'Dana Organicka', 'qa.mr.dana@qa-biz.local', {});
    await sleep(700);
    const uc = usr('qa.mr.cecilia@qa-biz.local'), ud = usr('qa.mr.dana@qa-biz.local');
    ok('neznáma reklama: číslo reklamy áno, kampaň sa nevymýšľa', uc.meta_klik === REKLAMA_Y && !uc.utm_campaign, JSON.stringify({ k: uc.meta_klik, c: uc.utm_campaign }));
    ok('organický klik z FB: bez čísla reklamy', ud.fbclid && !ud.meta_klik);

    console.log('\n3) Synchronizácia kariet a strážca:');
    const s1 = await fetch(BASE + '/api/service/ads-sync', { method: 'POST', headers: { 'x-import-token': TOKEN, 'Content-Type': 'application/json' }, body: '{}' });
    const d1 = await s1.json();
    ok('synchronizácia prebehla', s1.status === 200 && d1.karty && d1.karty.ok, JSON.stringify(d1).slice(0, 200));
    await sleep(800);
    const karta = id => rd('campaigns.db').find(k => k._id === id);
    ok('karta A/B reklamy: 117,02 €', karta('qaMrKartaAB0001').spend === 117.02, JSON.stringify(rd('campaigns.db').map(k => [k._id, k.name, k.spend])));
    ok('karta celej kampane bez A/B reklamy: 126,32 €', karta('qaMrKartaWeb001').spend === 126.32 && karta('qaMrKartaWeb001').impressions === 600 && karta('qaMrKartaWeb001').clicks === 70 && karta('qaMrKartaWeb001').spend_7d === 6,
      JSON.stringify({ s: karta('qaMrKartaWeb001').spend, i: karta('qaMrKartaWeb001').impressions, c: karta('qaMrKartaWeb001').clicks, w: karta('qaMrKartaWeb001').spend_7d }));
    ok('karta HEJ BABY: 144,65 €', karta('qaMrKartaHej001').spend === 144.65);
    const kody = (d1.meranie && d1.meranie.nalezy || []).map(n => n.kod);
    const text = (d1.meranie && d1.meranie.nalezy || []).map(n => n.text).join(' | ');
    ok('nález: token čoskoro expiruje', kody.includes('token'), text);
    ok('nález: reklama bez utm', (d1.meranie.nalezy || []).some(n => n.kod === 'utm' && /Zlá reklama/.test(n.text)));
    ok('nález: reklama nesleduje udalosti webu', (d1.meranie.nalezy || []).some(n => n.kod === 'pixel' && /Zlá reklama/.test(n.text)));
    ok('HEJ reklama so sledovaním webu je v poriadku', !(d1.meranie.nalezy || []).some(n => n.kod === 'pixel' && /HEJ reklama/.test(n.text)));
    ok('nález: odkaz končí chybou 404', (d1.meranie.nalezy || []).some(n => n.kod === 'stranka' && /404/.test(n.text)));
    ok('presmerovanie /prva-hodina parametre drží (bez nálezu)', !kody.includes('presmerovanie'), text);
    ok('nález: kampaň bez karty', (d1.meranie.nalezy || []).some(n => n.kod === 'karta' && /Kampaň bez karty/.test(n.text)));
    ok('HEJ BABY: 150 návštev a 2 registrácie → bez poplachu', !kody.includes('konverzie') && (d1.meranie.ok || []).some(x => /150 návštev, 2 registrácií/.test(x)), JSON.stringify(d1.meranie.ok));
    ok('nález: Meta odmieta udalosti', kody.includes('capi'));
    ok('nález: registrácia z reklamy bez kampane (Cecília)', (d1.meranie.nalezy || []).some(n => n.kod === 'nepriradene' && /Cecilia Neznama/.test(n.detail)));
    ok('reklama bez útraty sa nekontroluje', !volania.some(v => v.startsWith('/444')));
    ok('skončená reklama bez poplachu, len poznámka', !text.includes('Kids nábor') && (d1.meranie.ok || []).some(x => /Kids nábor.*skončila 13\. 9\. 2026/.test(x)), JSON.stringify(d1.meranie.ok));
    await sleep(500);
    const notif = rd('notifications.db').filter(n => n.type === 'meranie');
    const mojich = notif.filter(n => n.user_id === 'qaMrAdmin000001');
    ok('admin dostal upozornenie ku každému nálezu', mojich.length === kody.length, mojich.length + ' / ' + kody.length);
    await fetch(BASE + '/api/service/ads-sync', { method: 'POST', headers: { 'x-import-token': TOKEN, 'Content-Type': 'application/json' }, body: '{}' });
    await sleep(500);
    ok('druhá kontrola v ten istý deň neupozorní znova', rd('notifications.db').filter(n => n.type === 'meranie').length === notif.length);
    ok('bez tokenu servisný endpoint neexistuje', (await fetch(BASE + '/api/service/ads-sync', { method: 'POST' })).status === 404);

    console.log('\n4) Admin:');
    const adm = prehliadac();
    await adm.ide('/api/login', { method: 'POST', body: { email: 'qa.mr.admin@qa-biz.local', password: 'Heslo123!' } });
    const m = await adm.ide('/api/admin/meranie');
    ok('prehľad merania', m.status === 200 && m.d.stav && m.d.stav.nalezy.length === kody.length && m.d.capi && m.d.capi.udalosti, JSON.stringify(m.d).slice(0, 160));
    const m2 = await adm.ide('/api/admin/meranie/skontroluj', { method: 'POST', body: {} });
    ok('kontrola na klik', m2.status === 200 && Array.isArray(m2.d.nalezy));
    ok('klient prehľad merania nevidí', (await A.ide('/api/admin/meranie')).status !== 200);

    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await ctx.addCookies(Object.entries(adm.c).map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
    const p = await ctx.newPage(); const jsChyby = []; p.on('pageerror', e => jsChyby.push(e.message));
    await p.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof loadMeranie === 'function', null, { timeout: 20000 });
    await p.evaluate(() => loadMeranie());
    await p.waitForFunction(() => /Posledná kontrola/.test((document.getElementById('meraniePanel') || {}).innerText || ''), null, { timeout: 15000 });
    const panel = await p.evaluate(() => document.getElementById('meraniePanel').innerText);
    ok('karta v admine ukazuje nálezy aj udalosti pre Metu', /reklama nemá zapnuté „Udalosti webu"/.test(panel) && /CompleteRegistration: 3 prijatých/.test(panel), panel.slice(0, 300));
    ok('admin bez chýb v JS', jsChyby.length === 0, jsChyby.join(' | '));
    if (process.env.QA_SHOTS) await p.locator('#meraniePanel').screenshot({ path: path.join(process.env.QA_SHOTS, 'meranie-admin.png') }).catch(() => {});
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill(); graf.close();
    await sleep(600);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nMERANIE REKLÁM: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-1500));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
