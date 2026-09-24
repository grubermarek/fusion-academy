/**
 * E2E: Influencer program — samoregistrácia, profil sietí, odkaz /i/<kód> s počítaním
 * klikov, privedená registrácia, dashboard influencerky a admin prehľad.
 *
 * Spustenie: izolovaný server na QA_PORT (default 3999) s vlastnou DATA_DIR a MAIL_OFF=1, potom
 *   node qa/influencer.test.js
 */
const BASE = 'http://localhost:' + (process.env.QA_PORT || 3999);
let PASS = 0, FAIL = 0;
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : '')); }
}
const jars = {};
async function call(jar, method, path, body, extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (jars[jar]) headers['Cookie'] = jars[jar];
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) {
    const cur = Object.fromEntries((jars[jar] || '').split('; ').filter(Boolean).map(x => [x.split('=')[0], x]));
    for (const part of sc.split(/,(?=\s*[\w.-]+=)/)) { const kv = part.trim().split(';')[0]; cur[kv.split('=')[0]] = kv; }
    jars[jar] = Object.values(cur).join('; ');
  }
  let data = null; try { data = await r.json(); } catch (e) {}
  return { status: r.status, data, location: r.headers.get('location') };
}
const g = (jar, p, h) => call(jar, 'GET', p, null, h);
const post = (jar, p, b) => call(jar, 'POST', p, b);
const put = (jar, p, b) => call(jar, 'PUT', p, b);
const RND = Date.now().toString(36);

(async () => {
  console.log('\n═══ INFLUENCER PROGRAM ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // ── 1) verejná stránka a stav ──────────────────────────────────────────────
  const page = await fetch(BASE + '/influencer');
  ok('stránka /influencer sa otvorí', page.status === 200 && /Influencer program/.test(await page.text()), page.status);
  const st0 = await g('inf', '/api/influencer/stav');
  ok('neprihlásená vidí sadzbu z provízneho motora', st0.data && st0.data.prihlasena === false && st0.data.sadzba === 10, st0.data);

  // ── 2) registrácia + prihláška ────────────────────────────────────────────
  const reg = await post('inf', '/api/register', { name: 'Ivana Skusobna', email: 'inf-' + RND + '@qa-biz.local',
    password: 'heslo123', consent: true, lead_source: 'influencer_program' });
  ok('registrácia účtu prejde', reg.data && reg.data.ok, reg.data);
  const bez = await post('inf', '/api/influencer/prihlaska', { sledovatelia: '5000' });
  ok('prihláška bez sociálnej siete neprejde', bez.status === 400, bez.data);
  const pr = await post('inf', '/api/influencer/prihlaska', { instagram: '@ivana.tanci', tiktok: 'ivanatanci',
    hlavna: 'instagram', sledovatelia: '12 500', mesto: 'Zvolen', tema: 'fitness mamičky' });
  ok('prihláška so sieťou prejde a je nová', pr.data && pr.data.ok && pr.data.novy === true, pr.data);
  const me = await g('inf', '/api/influencer/me');
  ok('dashboard vráti odkaz /i/<kód>', me.data && me.data.ok && /\/i\/[A-Z0-9]+$/.test(me.data.odkaz), me.data);
  ok('sledovatelia sa uložia ako číslo', me.data && me.data.profil.sledovatelia === 12500, me.data && me.data.profil);
  ok('profil nový má stav „novy"', me.data && me.data.profil.stav === 'novy');
  const kod = me.data.kod;
  const amb = await g('inf', '/api/ambassador/me');
  ok('influencerka má ambasádorskú rolu (provízie, kredit, výplata)', amb.status === 200, amb.status);

  // ── 3) kliky ──────────────────────────────────────────────────────────────
  const k1 = await g('v1', '/i/' + kod + '?utm_source=instagram');
  ok('klik presmeruje na pozvánku /invite/<kód> aj s parametrami', k1.status === 302 && k1.location === '/invite/' + kod + '?utm_source=instagram', k1.location);
  await g('v1', '/i/' + kod);                                             // ten istý návštevník, ten istý deň
  await g('v2', '/i/' + kod.toLowerCase());                               // iný návštevník, malé písmená
  await g('bot', '/i/' + kod, { 'User-Agent': 'facebookexternalhit/1.1' }); // náhľad odkazu nie je klik
  const zly = await g('v3', '/i/NEEXISTUJE999');
  ok('neznámy kód aj tak presmeruje (žiadna chyba)', zly.status === 302, zly.status);
  const me2 = await g('inf', '/api/influencer/me');
  ok('kliky: 2 unikátne za deň (opakovaný a bot sa nerátajú)', me2.data.cisla.kliky === 2, me2.data.cisla.kliky);
  ok('zdroj kliku z utm_source', me2.data.cisla.zdroje.some(z => z.zdroj === 'instagram'), me2.data.cisla.zdroje);
  ok('graf 30 dní má 30 dní a dnešné kliky', me2.data.cisla.dni.length === 30 && me2.data.cisla.dni[29].kliky === 2, me2.data.cisla.dni.slice(-1));

  // ── 4) privedená registrácia ─────────────────────────────────────────────
  const r2 = await post('kl', '/api/register', { name: 'Klara Privedena', email: 'kl-' + RND + '@qa-biz.local',
    password: 'heslo123', consent: true, sponsorCode: kod });
  ok('klientka sa zaregistruje s kódom influencerky', r2.data && r2.data.ok, r2.data);
  const me3 = await g('inf', '/api/influencer/me');
  const c = me3.data.cisla;
  ok('registrácia sa započíta', c.registracie === 1 && c.ludia.length === 1 && c.ludia[0].stav === 'nová', c);
  ok('bez nákupu: predaje 0, kredit 0, straty 0', c.predaje === 0 && c.kredit === 0 && c.straty === 0, c);
  ok('konverzia klik → registrácia 50 %', c.konverzia_klik_reg === 50, c.konverzia_klik_reg);
  const kl = await g('kl', '/api/influencer/me');
  ok('bežná klientka dashboard influencerky nevidí', kl.status === 403 && kl.data.prihlaska, kl.status);

  // ── 5) admin ─────────────────────────────────────────────────────────────
  const zakaz = await g('kl', '/api/admin/influencers');
  ok('admin prehľad je len pre admina', zakaz.status === 401 || zakaz.status === 403, zakaz.status);
  const list = await g('admin', '/api/admin/influencers');
  const row = list.data && list.data.influenceri.find(x => x.kod === kod);
  ok('admin vidí influencerku s číslami', !!row && row.cisla.kliky === 2 && row.cisla.registracie === 1, row);
  ok('admin má stavy a sadzbu', list.data.stavy && list.data.stavy.spolupracuje && row.sadzba === 10, row && row.sadzba);
  const upd = await put('admin', '/api/admin/influencers/' + row.id, { stav: 'spolupracuje', admin_poznamka: 'volať v piatok',
    profil: { ...row.profil, sledovatelia: 13000 } });
  ok('admin zmení stav, poznámku a sledovateľov', upd.data && upd.data.ok && upd.data.profil.stav === 'spolupracuje'
    && upd.data.profil.sledovatelia === 13000 && upd.data.profil.admin_poznamka === 'volať v piatok'
    && upd.data.profil.siete.instagram === '@ivana.tanci', upd.data);
  const zlyStav = await put('admin', '/api/admin/influencers/' + row.id, { stav: 'hocico' });
  ok('neznámy stav admin nezapíše', zlyStav.status === 400, zlyStav.status);
  const det = await g('admin', '/api/admin/influencers/' + row.id);
  ok('admin detail má privedených ľudí aj graf', det.data && det.data.cisla.ludia.length === 1 && det.data.cisla.dni.length === 30, det.data && det.data.cisla);
  const kont = await put('admin', '/api/admin/influencers/' + row.id, { kontaktovana: true });
  ok('kontakt sa zapíše s dátumom', kont.data && /^\d{4}-/.test(kont.data.profil.kontaktovana_at || ''), kont.data);

  // ── 6) opätovná prihláška nezmaže stav od admina ─────────────────────────
  const pr2 = await post('inf', '/api/influencer/prihlaska', { instagram: '@ivana.nova', sledovatelia: '14000' });
  const me4 = await g('inf', '/api/influencer/me');
  ok('úprava profilu influencerkou nechá stav aj dátum vstupu', pr2.data.novy === false && me4.data.profil.stav === 'spolupracuje'
    && me4.data.profil.at === me.data.profil.at && me4.data.profil.siete.instagram === '@ivana.nova', me4.data.profil);

  // ── 7) predaj privedenej klientke → provízia influencerke ────────────────
  const sale = await post('admin', '/api/attendance/record-membership', { user_id: det.data.cisla.ludia[0].id,
    plan_id: 'bronze', amount: 49.9, payment_method: 'cash' });
  ok('admin zapíše klientke členstvo v hotovosti', sale.data && sale.data.ok, sale.data);
  await new Promise(r => setTimeout(r, 800));   // provízia sa zapisuje asynchrónne
  const me5 = await g('inf', '/api/influencer/me');
  const c5 = me5.data.cisla;
  ok('predaj sa započíta s obratom', c5.predaje === 1 && c5.obrat === 49.9 && c5.zakaznicky === 1, c5);
  ok('provízia 10 % čaká na lehotu, kredit ešte nie je', c5.caka === 4.99 && c5.kredit === 0, c5);
  ok('klientka má stav „platí"', c5.ludia[0].stav === 'platí' && c5.platiace === 1, c5.ludia);
  ok('provízia je v prehľade po mesiacoch', c5.mesiace.length === 1 && c5.mesiace[0].provizie === 4.99, c5.mesiace);

  console.log(`\n${PASS} ✓   ${FAIL} ✗`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
