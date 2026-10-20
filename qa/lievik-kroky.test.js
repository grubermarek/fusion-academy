/**
 * Medzikroky lievika na landingoch (20. 10. 2026)
 *
 * Kampaň priniesla 71 návštev /prva-hodina, 1 „začatý formulár" a 0 odoslaní —
 * a medzi načítaním stránky a formulárom sme nemerali nič. Prázdny zoznam termínov
 * tak vyzeral v štatistike presne ako „pozrela a odišla", hoci je to iná chyba.
 *
 * Stráži, že:
 *   · server nové kroky prijme (FUNNEL_KROKY) a zapíše ich do funnel_events
 *   · prežijú aj nové kľúče meta (pocet, volne, z, skupina) — filtrujú sa na zozname
 *   · vymyslený krok sa ticho zahodí a nič nezapíše
 *   · lp_skupina z detského landingu už nepadá do koša (chýbal od 18. 10.)
 *   · prehľad v admine ukáže kroky v poradí, zádrhely zvlášť a detský landing tiež
 *   · stránky tie kroky naozaj posielajú (kontrola zdrojákov)
 *   · „začatý formulár" znamená na OBOCH landingoch písanie, nie zaostrenie poľa
 *   · kreatíva TEJTO návštevy (utm_content z adresy) sa nezlúči s prvým dotykom
 *     v cookie fa_zdroj — bez toho tri reklamy jednej kampane splynú do jedného riadku
 *
 * Spustenie:  node qa/lievik-kroky.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4641;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-lievik-'));
const KOREN = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts, jar) {
  const headers = { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: (opts && opts.method) || 'GET', headers, body: opts && opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) {
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
    sc.forEach(c => { const kv = c.split(';')[0]; const i = kv.indexOf('='); jar.jar = jar.jar || {}; jar.jar[kv.slice(0, i)] = kv.slice(i + 1); });
    if (jar.jar) jar.cookie = Object.entries(jar.jar).map(([k, v]) => k + '=' + v).join('; ');
  }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
// NeDB je append-only: ten istý dokument je v súbore po každom update znova,
// takže sa počítajú unikátne _id, nie riadky.
const udalosti = () => {
  try {
    const m = new Map();
    fs.readFileSync(path.join(DATA, 'funnel_events.db'), 'utf8').split('\n').filter(Boolean)
      .forEach(l => { try { const o = JSON.parse(l); if (o._id) m.set(o._id, o); } catch (e) {} });
    return [...m.values()];
  } catch (e) { return []; }
};
const zdroj = f => fs.readFileSync(path.join(KOREN, f), 'utf8');

(async () => {
  fs.writeFileSync(path.join(DATA, 'users.db'), JSON.stringify({
    _id: 'qaLvAdmin00001', name: 'Marek Gruber', email: 'qa.lievik.admin@qa-biz.local',
    password: bcrypt.hashSync('Heslo123!', 10), is_admin: true, user_type: 'admin',
    active: true, created_at: '2026-01-01',
  }) + '\n');

  console.log('MEDZIKROKY LIEVIKA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', PRVY_TYZDEN: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 9000));

  try {
    // Návštevníčka: cookie fa_vid dostane z načítania stránky, inak by každý krok
    // vyzeral ako iný človek a unikátne počty by nesedeli.
    const ona = {};
    await j('/prva-hodina', {}, ona);
    const posli = (krok, meta, stranka) => j('/api/funnel', { method: 'POST', body: { krok, stranka: stranka || '/prva-hodina', meta: meta || null } }, ona);

    console.log('\n1) Server nové kroky prijme:');
    const NOVE = ['lp_mesta', 'lp_mesta_prazdno', 'lp_terminy', 'lp_prazdno', 'lp_plne', 'lp_viac', 'lp_spat', 'lp_skupina', 'lp_chyba'];
    for (const k of NOVE) await posli(k, { pocet: '3' });
    await new Promise(r => setTimeout(r, 500));
    const zapisane = udalosti();
    for (const k of NOVE) ok('krok ' + k + ' sa zapísal', zapisane.some(e => e.krok === k));
    ok('všetky majú rovnakú návštevníčku (vid)',
      new Set(zapisane.filter(e => NOVE.includes(e.krok)).map(e => e.vid)).size === 1,
      JSON.stringify([...new Set(zapisane.filter(e => NOVE.includes(e.krok)).map(e => e.vid))]));

    console.log('\n2) Meta prežije filter:');
    await posli('lp_terminy', { city: 'Detva', pocet: '7', volne: '5' }, '/prva-hodina-x');
    await posli('lp_spat', { z: '3' }, '/prva-hodina-x');
    await posli('lp_skupina', { skupina: 'Kids' }, '/prva-hodina-x');
    await new Promise(r => setTimeout(r, 500));
    const x = udalosti().filter(e => e.stranka === '/prva-hodina-x');
    const met = k => ((x.find(e => e.krok === k) || {}).meta) || {};
    ok('pocet a volne sa uložili', met('lp_terminy').pocet === '7' && met('lp_terminy').volne === '5', JSON.stringify(met('lp_terminy')));
    ok('z ktorého kroku sa vrátila', met('lp_spat').z === '3', JSON.stringify(met('lp_spat')));
    ok('skupina sa uložila', met('lp_skupina').skupina === 'Kids', JSON.stringify(met('lp_skupina')));

    console.log('\n3) Vymyslený krok sa zahodí:');
    const pred = udalosti().length;
    const zly = await posli('lp_vymyslene', null, '/prva-hodina-x');
    await new Promise(r => setTimeout(r, 400));
    ok('odpoveď je 204', zly.status === 204, String(zly.status));
    ok('nič sa nezapísalo', udalosti().length === pred, pred + ' → ' + udalosti().length);

    console.log('\n4) Prehľad v admine:');
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.lievik.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));
    const d = (await j('/api/admin/funnel-stranky?days=7', {}, adm)).d || {};
    const lp = (d.stranky || {})['/prva-hodina'] || {};
    const kroky = (lp.kroky || []).map(k => k.krok);
    ok('lievik obsahuje lp_mesta, lp_city aj lp_terminy',
      ['lp_mesta', 'lp_city', 'lp_terminy'].every(k => kroky.includes(k)), JSON.stringify(kroky));
    ok('poradie: načítanie → mestá → mesto → termíny → termín',
      kroky.indexOf('lp_view') < kroky.indexOf('lp_mesta')
      && kroky.indexOf('lp_mesta') < kroky.indexOf('lp_city')
      && kroky.indexOf('lp_city') < kroky.indexOf('lp_terminy')
      && kroky.indexOf('lp_terminy') < kroky.indexOf('lp_termin'), JSON.stringify(kroky));
    ok('zádrhely sú mimo lievika',
      !kroky.includes('lp_prazdno') && !kroky.includes('lp_spat'), JSON.stringify(kroky));
    const prek = (lp.prekazky || []).map(p => p.krok);
    ok('prázdny zoznam termínov je medzi zádrhelmi', prek.includes('lp_prazdno'), JSON.stringify(prek));
    ok('návrat o krok späť je medzi zádrhelmi', prek.includes('lp_spat'), JSON.stringify(prek));
    ok('nenačítaný rozvrh je medzi zádrhelmi', prek.includes('lp_chyba'), JSON.stringify(prek));
    ok('detský landing je v prehľade', !!(d.stranky || {})['/prva-hodina-kids']);
    const kidsKroky = (((d.stranky || {})['/prva-hodina-kids'] || {}).kroky || []).map(k => k.krok);
    ok('detský lievik má lp_terminy pred lp_termin',
      kidsKroky.indexOf('lp_terminy') >= 0 && kidsKroky.indexOf('lp_terminy') < kidsKroky.indexOf('lp_termin'),
      JSON.stringify(kidsKroky));

    console.log('\n5) Stránky tie kroky naozaj posielajú:');
    const dosp = zdroj('public/prva-hodina.html');
    ok('dospelý: hlási prázdny zoznam termínov', /krok\('lp_prazdno'/.test(dosp));
    ok('dospelý: hlási, že sú všetky plné', /krok\('lp_plne'/.test(dosp));
    ok('dospelý: hlási zoznam miest', /krok\('lp_mesta'/.test(dosp) && /krok\('lp_mesta_prazdno'/.test(dosp));
    ok('dospelý: hlási termíny po výbere mesta aj pri štarte',
      (dosp.match(/hlasTerminy\(\)/g) || []).length >= 3, String((dosp.match(/hlasTerminy\(\)/g) || []).length));
    ok('dospelý: obe tlačidlá späť idú cez spat()',
      /onclick="spat\(1\)"/.test(dosp) && /onclick="spat\(2\)"/.test(dosp) && !/onclick="naKrok\(1\)"/.test(dosp));
    ok('dospelý: „ďalšie termíny" je krok', /krok\('lp_viac'\)/.test(dosp));
    ok('dospelý: začatý formulár = písanie, nie zaostrenie',
      /addEventListener\('input',\(\)=>krok\('form_start'/.test(dosp));
    // Zachytené naživo 20. 10.: server vrátil 502, rozvrh neprišiel a na stránke ticho
    // visel starý zoznam — bez slova pre človeka a bez jediného kroku v lieviku.
    ok('dospelý: nenačítaný rozvrh sa ohlási a povie to aj človeku',
      /krok\('lp_chyba'/.test(dosp) && /Termíny sa teraz nenačítali/.test(dosp));
    ok('dospelý: po neúspešnom rozvrhu sa termíny nehlásia ako videné',
      /if\(await load\(\)\) hlasTerminy\(\);/.test(dosp) && /if\(rozvrhPrisiel\) hlasTerminy\(\);/.test(dosp));

    const deti = zdroj('public/prva-hodina-kids.html');
    ok('detský: hlási termíny aj prázdny zoznam', /krok\('lp_terminy'/.test(deti) && /krok\('lp_prazdno'/.test(deti));
    ok('detský: tlačidlo späť ide cez spat()', /onclick="spat\(1\)"/.test(deti));
    ok('detský: nenačítaný rozvrh sa ohlási a povie to aj človeku',
      /krok\('lp_chyba'/.test(deti) && /Termíny sa teraz nenačítali/.test(deti));
    // vyber() sám zaostrí prvé pole, takže krok na focus-e sa hlásil aj bez písmena —
    // číslo „začatých formulárov" bolo rovnaké ako „videla formulár".
    ok('detský: začatý formulár = písanie, nie zaostrenie',
      /addEventListener\('input',\(\)=>krok\('form_start'/.test(deti) && !/addEventListener\('focus',\(\)=>krok\('form_start'/.test(deti));
    ok('detský: zoznam sa nedrží na starom filtri',
      deti.indexOf('window.__zoznam=zoznam;') < deti.indexOf("if(!zoznam.length){"));

    // Cookie fa_zdroj je zámerne prvý dotyk na 90 dní, takže ďalší platený klik ju
    // neprepíše. Keby sa kreatíva brala len z nej, tri reklamy jednej kampane by v lieviku
    // splynuli a nebolo by vidieť, ktorá ľudí stráca — o tom je celá táto zmena.
    console.log('\n6) Kreatíva tejto návštevy vs. prvý dotyk:');
    const ina = {};
    await j('/prva-hodina?utm_source=fb&utm_medium=cpc&utm_campaign=stara-kampan&utm_content=111111&utm_term=777777', {}, ina);
    ok('prvý dotyk je v cookie fa_zdroj', /fa_zdroj=/.test(ina.cookie || ''), String(ina.cookie || '').slice(0, 60));
    const NOVA = '52558359230473', SADA = '52557795589673';
    const adresa = '/prva-hodina?utm_source=fb&utm_medium=cpc&utm_campaign=fa-zumba-skuska-2610&utm_content=' + NOVA + '&utm_term=' + SADA;
    await j(adresa, {}, ina);
    const posliZ = (krok, ref) => j('/api/funnel', { method: 'POST', headers: { Referer: BASE + ref }, body: { krok, stranka: '/prva-hodina' } }, ina);
    for (const k of ['lp_view', 'lp_terminy', 'lp_termin', 'form_start', 'form_submit']) await posliZ(k, adresa);
    await posliZ('lp_view', '/prva-hodina'); // návrat priamo, bez utm v adrese
    await new Promise(r => setTimeout(r, 600));
    const jejVid = (ina.jar || {}).fa_vid;
    const jej = udalosti().filter(e => e.vid === jejVid);
    const nova = jej.find(e => e.krok === 'lp_view' && e.obsah === NOVA);
    ok('obsah sa vzal z adresy, nie zo staršej cookie', !!nova, JSON.stringify(jej.map(e => [e.krok, e.obsah])));
    ok('prvý dotyk ostal zachovaný zvlášť', nova && nova.obsah_prvy === '111111', nova && String(nova.obsah_prvy));
    ok('kampaň ostala prvý dotyk (cookie sa neprepisuje)', nova && nova.kampan === 'stara-kampan', nova && String(nova.kampan));
    ok('súbor reklám (utm_term) sa uložil', nova && nova.sada === SADA, nova && String(nova.sada));
    ok('celý lievik návštevy nesie tú istú kreatívu',
      ['lp_terminy', 'lp_termin', 'form_start', 'form_submit'].every(k => jej.some(e => e.krok === k && e.obsah === NOVA)),
      JSON.stringify(jej.map(e => [e.krok, e.obsah])));
    ok('bez utm v adrese padne obsah na cookie',
      jej.some(e => e.krok === 'lp_view' && e.obsah === '111111'), JSON.stringify(jej.filter(e => e.krok === 'lp_view').map(e => e.obsah)));

    const d2 = (await j('/api/admin/funnel-stranky?days=7', {}, adm)).d || {};
    const kr = (d2.kreativy || []).find(x => x.obsah === NOVA);
    ok('admin ukáže rozpad po kreatívach', !!kr, JSON.stringify(d2.kreativy));
    ok('kreatíva má čísla celého lievika',
      kr && kr.navstevy === 1 && kr.videla_terminy === 1 && kr.vybrala_termin === 1 && kr.zacali === 1 && kr.odoslali === 1,
      JSON.stringify(kr));
    ok('súbor reklám je pri kreatíve', kr && kr.sada === SADA, JSON.stringify(kr && kr.sada));
    ok('staršia kreatíva z cookie má vlastný riadok',
      (d2.kreativy || []).some(x => x.obsah === '111111'), JSON.stringify((d2.kreativy || []).map(x => x.obsah)));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nMEDZIKROKY LIEVIKA: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-800));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
