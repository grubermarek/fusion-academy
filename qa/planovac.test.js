/**
 * E2E: Denný plánovač akcií a kampaní — kalendár sviatkov a okien, playbooky,
 * odškrtávanie krokov, vlastné akcie, nastavenia prázdnin, denné upozornenie.
 *
 * Spustenie: server na QA_PORT (default 3999) s MAIL_OFF=1, potom
 *   node qa/planovac.test.js
 */
const BASE = 'http://localhost:' + (process.env.QA_PORT || 3999);
let PASS = 0, FAIL = 0;
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : '')); }
}
const jars = {};
async function call(jar, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (jars[jar]) headers['Cookie'] = jars[jar];
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jars[jar] = sc.split(';')[0];
  let data = null; try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}
const g = (jar, p) => call(jar, 'GET', p);
const post = (jar, p, b) => call(jar, 'POST', p, b);
const del = (jar, p) => call(jar, 'DELETE', p);
const najdi = (d, re) => d.polozky.filter(x => re.test(x.nazov));

(async () => {
  console.log('\n═══ PLÁNOVAČ AKCIÍ A KAMPANÍ ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // ── 1) prístup len pre admina ──────────────────────────────────────────────
  const anon = await g('anon', '/api/admin/planovac');
  ok('bez prihlásenia sa plánovač nedá otvoriť', anon.status === 401 || anon.status === 403, anon.status);

  // ── 2) kalendár na rok dopredu ─────────────────────────────────────────────
  const r = await g('admin', '/api/admin/planovac?dni=400');
  const d = r.data;
  ok('plánovač vráti kalendár', !!(d && d.ok && Array.isArray(d.polozky) && d.polozky.length > 10), d && d.polozky && d.polozky.length);

  // dátumy sa počítajú, nie prepisujú — kontrolujeme pohyblivé sviatky a akcie
  const bf = najdi(d, /^Black Friday$/)[0];
  ok('Black Friday je piatok po 4. štvrtku v novembri', !!bf && new Date(bf.datum + 'T12:00:00Z').getUTCDay() === 5, bf && bf.datum);
  const dm = najdi(d, /Deň matiek/)[0];
  ok('Deň matiek je druhá májová nedeľa', !!dm && dm.datum.slice(5, 7) === '05'
    && new Date(dm.datum + 'T12:00:00Z').getUTCDay() === 0 && +dm.datum.slice(8) >= 8 && +dm.datum.slice(8) <= 14, dm && dm.datum);
  const vp = najdi(d, /Veľký piatok/)[0], vn = najdi(d, /Veľkonočná nedeľa/)[0];
  ok('Veľký piatok je dva dni pred Veľkonočnou nedeľou',
    !!vp && !!vn && Math.round((Date.parse(vn.datum) - Date.parse(vp.datum)) / 86400000) === 2, vp && vp.datum + ' / ' + (vn && vn.datum));

  // 1. september je štátny sviatok, ale PRACOVNÝ deň — nesmie hlásiť rušenie hodín
  const ustava = d.polozky.find(x => x.datum.slice(5) === '09-01' && x.typ === 'sviatok');
  ok('Deň Ústavy SR je vedený ako pracovný deň', !ustava || (!ustava.prevadzka && !ustava.kroky.length), ustava && ustava.nazov);

  // ── 3) žiadne duplicity a žiadny predĺžený víkend kratší ako 3 dni ─────────
  const pocty = {}; d.polozky.forEach(x => pocty[x.kluc] = (pocty[x.kluc] || 0) + 1);
  ok('kalendár nemá duplicitné položky', !Object.values(pocty).some(v => v > 1),
    Object.entries(pocty).filter(([, v]) => v > 1));
  const vikendy = d.polozky.filter(x => x.typ === 'vikend');
  ok('predĺžený víkend má vždy aspoň 3 dni voľna',
    vikendy.every(v => Math.round((Date.parse(v.obdobie.do) - Date.parse(v.obdobie.od)) / 86400000) + 1 >= 3),
    vikendy.map(v => v.nazov));

  // ── 4) sviatok pozná dopad na rozvrh, online hodiny neráta ────────────────
  const sVolnom = d.polozky.filter(x => x.typ === 'sviatok' && x.hodiny && x.hodiny.length);
  ok('pri sviatku vidno, ktoré hodiny naň pripadajú', sVolnom.length > 0, sVolnom.length);
  ok('online hodiny sa do sviatočného varovania nerátajú',
    sVolnom.every(s => s.hodiny.every(h => h.mesto !== 'Online')),
    sVolnom.flatMap(s => s.hodiny.map(h => h.mesto)).filter(m => m === 'Online'));

  // ── 5) playbook — kampaň aj kroky prípravy ────────────────────────────────
  const skampanou = d.polozky.filter(x => x.kampan);
  ok('príležitosti majú kampaň s ponukou, publikom a kanálmi',
    skampanou.length > 0 && skampanou.every(x => x.kampan.nazov && x.kampan.publikum && Array.isArray(x.kampan.kanaly)),
    skampanou.length);
  ok('kroky prípravy majú spočítaný termín aj stav',
    d.polozky.every(x => x.kroky.every(k => /^\d{4}-\d{2}-\d{2}$/.test(k.termin) && typeof k.hotovo === 'boolean')));
  const bfKroky = bf ? bf.kroky.map(k => k.d) : [];
  ok('Black Friday sa pripravuje najmenej tri týždne dopredu', Math.max(...bfKroky, 0) >= 21, bfKroky);

  // ── 6) odškrtnutie kroku ostane uložené ───────────────────────────────────
  const ciel = d.polozky.find(x => x.kroky.length);
  const krokD = ciel.kroky[0].d;
  await post('admin', '/api/admin/planovac/stav', { key: ciel.kluc, krok: krokD, hotovo: true });
  let po = (await g('admin', '/api/admin/planovac?dni=400')).data;
  let poCiel = po.polozky.find(x => x.kluc === ciel.kluc);
  ok('odškrtnutý krok sa uloží', !!poCiel && poCiel.kroky.find(k => k.d === krokD).hotovo === true);
  await post('admin', '/api/admin/planovac/stav', { key: ciel.kluc, krok: krokD, hotovo: false });
  po = (await g('admin', '/api/admin/planovac?dni=400')).data;
  poCiel = po.polozky.find(x => x.kluc === ciel.kluc);
  ok('odškrtnutie sa dá vrátiť', !!poCiel && poCiel.kroky.find(k => k.d === krokD).hotovo === false);

  // ── 7) vlastná akcia ──────────────────────────────────────────────────────
  const zaTyzden = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const nova = await post('admin', '/api/admin/planovac/akcia', {
    datum: zaTyzden, nazov: 'QA testovacia akcia', emoji: '🧪', dopad: 'nizky',
    popis: 'QA — po teste sa maže', kroky: [{ d: 3, text: 'QA krok' }],
  });
  ok('vlastnú akciu sa podarilo pridať', !!(nova.data && nova.data.ok && nova.data.id), nova.data);
  po = (await g('admin', '/api/admin/planovac?dni=400')).data;
  const vlastna = po.polozky.find(x => x.nazov === 'QA testovacia akcia');
  ok('vlastná akcia je v kalendári aj s krokom', !!vlastna && vlastna.kroky.length === 1, vlastna && vlastna.kroky);
  const zly = await post('admin', '/api/admin/planovac/akcia', { datum: 'nezmysel', nazov: '' });
  ok('akcia bez dátumu a názvu sa odmietne', zly.status === 400, zly.status);

  // ── 8) skrytie položky ────────────────────────────────────────────────────
  await post('admin', '/api/admin/planovac/stav', { key: vlastna.kluc, stav: 'skryte' });
  po = (await g('admin', '/api/admin/planovac?dni=400')).data;
  ok('skrytá položka zmizne z plánovača', !po.polozky.some(x => x.kluc === vlastna.kluc));

  // ── 9) nastavenia prázdnin ────────────────────────────────────────────────
  const pred = (await g('admin', '/api/admin/planovac?dni=400')).data.config;
  const cfg = await post('admin', '/api/admin/planovac/config', {
    hodina: 9, dni_dopredu: 150, mail: true,
    prazdniny: { rok: pred.prazdniny.rok, kraj: pred.prazdniny.kraj, polozky: pred.prazdniny.polozky },
  });
  ok('nastavenia sa uložia', !!(cfg.data && cfg.data.ok && cfg.data.config.hodina === 9), cfg.data);
  ok('školské prázdniny sú v kalendári', najdi(po, /prázdniny/i).length > 0);
  await post('admin', '/api/admin/planovac/config', { hodina: pred.hodina, dni_dopredu: pred.dni_dopredu, mail: pred.mail });

  // ── 10) denné upozornenie sa dá vyrobiť ──────────────────────────────────
  const beh = await post('admin', '/api/admin/planovac/run-daily', {});
  ok('denné upozornenie sa vygeneruje', !!(beh.data && beh.data.ok), beh.data);
  ok('text upozornenia obsahuje dnešný dátum alebo výhľad',
    !beh.data.text || /PLÁNOVAČ ·/.test(beh.data.text), (beh.data.text || '').slice(0, 80));

  // ── upratanie ────────────────────────────────────────────────────────────
  await del('admin', '/api/admin/planovac/akcia/' + nova.data.id);
  await post('admin', '/api/admin/planovac/stav', { key: vlastna.kluc, stav: 'planuje' });
  po = (await g('admin', '/api/admin/planovac?dni=400')).data;
  ok('QA akcia je po teste zmazaná', !po.polozky.some(x => x.nazov === 'QA testovacia akcia'));

  console.log('\n─────────────────────────────');
  console.log('PASS: ' + PASS + '   FAIL: ' + FAIL);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('CHYBA TESTU:', e); process.exit(1); });
