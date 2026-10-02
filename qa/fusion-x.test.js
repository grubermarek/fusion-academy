/**
 * E2E: Fusion X — žiadosť partnera z webu (bez registrácie), schválenie v admine, verejný
 * zoznam, nárok len pri mesačnom členstve, krátkodobý QR bez osobných údajov, overovacia
 * stránka bez prihlásenia, počítanie overení a oznam po aktivácii.
 *
 * Spustenie: izolovaný server na QA_PORT (default 3999) s vlastnou DATA_DIR a MAIL_OFF=1, potom
 *   node qa/fusion-x.test.js
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
  const r = await fetch(BASE + path, { method, headers, body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) {
    const cur = Object.fromEntries((jars[jar] || '').split('; ').filter(Boolean).map(x => [x.split('=')[0], x]));
    for (const part of sc.split(/,(?=\s*[\w.-]+=)/)) { const kv = part.trim().split(';')[0]; cur[kv.split('=')[0]] = kv; }
    jars[jar] = Object.values(cur).join('; ');
  }
  let data = null; try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}
const g = (jar, p) => call(jar, 'GET', p);
const post = (jar, p, b) => call(jar, 'POST', p, b);
const put = (jar, p, b) => call(jar, 'PUT', p, b);
const RND = Date.now().toString(36);
const form = o => new URLSearchParams(o).toString();
const formPost = (o) => fetch(BASE + '/api/public/fusion-x/partner', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://fusionacademy.sk' }, body: form(o) });

(async () => {
  console.log('\n═══ FUSION X ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // ── 1) žiadosť partnera z webu ────────────────────────────────────────────
  const zaklad = { firma: 'Kaderníctvo Lucia ' + RND, mesto: 'Zvolen', kategoria: 'Krása a starostlivosť', kontakt: 'Lucia Nováková',
    email: 'lucia-' + RND + '@qa-biz.local', telefon: '0905 123 456', web: 'instagram.com/kadernictvolucia',
    opis: 'Strihy, farbenie a úpravy obočia pre dámy.', zlava: '1', consent: '1', ms: '25000' };
  const bezZlavy = await formPost({ ...zaklad, zlava: '' });
  ok('bez potvrdenia 10 % zľavy sa žiadosť neprijme', bezZlavy.status === 400 && (await bezZlavy.json()).pole === 'zlava');
  const bezMesta = await formPost({ ...zaklad, mesto: '' });
  ok('bez mesta sa žiadosť neprijme', bezMesta.status === 400);
  const r1 = await formPost(zaklad);
  const z1 = await r1.json();
  ok('platná žiadosť sa uloží', r1.status === 200 && z1.ok && z1.id, z1);
  ok('odpoveď má CORS pre web', r1.headers.get('access-control-allow-origin') === '*');
  const pub0 = await g('anon', '/api/public/fusion-x/partneri');
  ok('neschválený partner nie je verejný', pub0.data && !pub0.data.partneri.some(p => p.id === z1.id), pub0.data);
  const adm0 = await g('admin', '/api/admin/fusion-x');
  const zz = adm0.data && adm0.data.partneri.find(p => p._id === z1.id);
  ok('žiadosť je v admine ako nová', zz && zz.stav === 'novy' && zz.suhlas_zlava === true, zz);
  const notif = await g('admin', '/api/notifications');
  const zoznamN = Array.isArray(notif.data) ? notif.data : (notif.data && (notif.data.notifications || notif.data.items)) || [];
  ok('správca dostal oznam o žiadosti', zoznamN.some(n => n.type === 'fusion_x_ziadost'), notif.data && Object.keys(notif.data));
  const spam = await formPost({ ...zaklad, website: 'http://spam.example', firma: 'Spam ' + RND });
  const zs = await spam.json();
  const adm1 = await g('admin', '/api/admin/fusion-x');
  ok('bot (skryté pole) sa uloží ako zamietnutý spam', adm1.data.partneri.some(p => p._id === zs.id && p.stav === 'zamietnuty' && p.spam));
  const anonAdm = await g('anon', '/api/admin/fusion-x');
  ok('admin zoznam je len pre admina', anonAdm.status === 401 || anonAdm.status === 403, anonAdm.status);

  // ── 2) klientka bez členstva ──────────────────────────────────────────────
  const reg = await post('kl', '/api/register', { name: 'Petra Skúšobná', email: 'fx-' + RND + '@test-fa-qa.local', password: 'heslo123', consent: true });
  ok('registrácia klientky', reg.data && reg.data.ok, reg.data);
  const me0 = await g('kl', '/api/me');
  const uid = me0.data.id;
  ok('bez členstva je Fusion X neaktívny', me0.data.fusion_x && me0.data.fusion_x.aktivny === false, me0.data.fusion_x);
  const kod0 = await post('kl', '/api/fusion-x/kod', {});
  ok('bez členstva sa QR nevydá', kod0.status === 403 && kod0.data.aktivny === false, kod0.data);

  // permanentka nedáva nárok
  await post('admin', '/api/admin/membership/activate', { user_id: uid, plan_id: 'permanentka10' });
  const me1 = await g('kl', '/api/me');
  ok('permanentka Fusion X neotvorí', me1.data.fusion_x && me1.data.fusion_x.aktivny === false, me1.data.fusion_x);

  // ── 3) mesačné členstvo → nárok ───────────────────────────────────────────
  const akt = await post('admin', '/api/admin/membership/activate', { user_id: uid, plan_id: 'bronze', duration_days: 30 });
  ok('admin aktivuje Bronze', akt.data && akt.data.ok, akt.data);
  const me2 = await g('kl', '/api/me');
  ok('s Bronze je Fusion X aktívny s dátumom platnosti', me2.data.fusion_x && me2.data.fusion_x.aktivny === true && !!me2.data.fusion_x.platne_do, me2.data.fusion_x);
  ok('zľava je 10 %', me2.data.fusion_x && me2.data.fusion_x.zlava === 10);
  const st = await g('kl', '/api/fusion-x/stav');
  ok('stav karty má meno člena', st.data && st.data.meno === 'Petra Skúšobná' && st.data.aktivny, st.data);

  // Oznam čaká, kým nie je zverejnený partner (prázdny zoznam neoznamujeme)
  await new Promise(r => setTimeout(r, 300));
  let n0 = await g('kl', '/api/notifications');
  const listN = d => Array.isArray(d) ? d : (d && (d.notifications || d.items)) || [];
  ok('bez zverejneného partnera oznam „Fusion X máš otvorený" ešte nejde', !listN(n0.data).some(n => n.type === 'fusion_x'));

  // ── 4) schválenie partnera ────────────────────────────────────────────────
  const bezNazvu = await put('admin', '/api/admin/fusion-x/partneri/' + z1.id, { stav: 'schvaleny', profil: { nazov: '', mesto: '' } });
  ok('bez názvu a mesta sa zverejniť nedá', bezNazvu.status === 400, bezNazvu.data);
  const schv = await put('admin', '/api/admin/fusion-x/partneri/' + z1.id, { stav: 'schvaleny', poznamka: 'dohodnuté telefonicky',
    profil: { nazov: 'Kaderníctvo Lucia ' + RND, mesto: 'Zvolen', kategoria: 'Krása a starostlivosť', popis: 'Strihy a farbenie.', adresa: 'Námestie SNP 1', web: 'kadernictvolucia.sk', logo: 'javascript:alert(1)' } });
  ok('admin partnera schváli', schv.data && schv.data.ok, schv.data);
  const pub1 = await g('anon', '/api/public/fusion-x/partneri');
  const vp = pub1.data && pub1.data.partneri.find(p => p.id === z1.id);
  ok('schválený partner je verejný', !!vp, pub1.data);
  ok('verejný profil neobsahuje kontakt zo žiadosti ani poznámku', vp && !JSON.stringify(vp).includes('lucia-' + RND) && !JSON.stringify(vp).includes('Nováková') && !JSON.stringify(vp).includes('telefonicky'), vp);
  ok('web dostane https:// a nebezpečné logo sa zahodí', vp && vp.web === 'https://kadernictvolucia.sk' && vp.logo === '', vp);
  const kl1 = await g('kl', '/api/fusion-x/partneri');
  ok('klientka vidí partnera v appke', kl1.data && kl1.data.partneri.some(p => p.id === z1.id));

  await g('kl', '/api/me'); await new Promise(r => setTimeout(r, 400));
  const n1 = await g('kl', '/api/notifications');
  const fxN = listN(n1.data).filter(n => n.type === 'fusion_x');
  ok('po zverejnení partnera príde oznam „Fusion X máš otvorený!"', fxN.length === 1 && /Fusion X máš otvorený/.test(fxN[0].title), listN(n1.data).map(n => n.type));
  await g('kl', '/api/me'); await new Promise(r => setTimeout(r, 300));
  const n2 = await g('kl', '/api/notifications');
  ok('oznam sa neopakuje', listN(n2.data).filter(n => n.type === 'fusion_x').length === 1);

  // ── 5) QR a overenie ──────────────────────────────────────────────────────
  const pred = (await g('admin', '/api/admin/fusion-x')).data.overenia;
  const kod = await post('kl', '/api/fusion-x/kod', {});
  ok('aktívna klientka dostane QR', kod.data && kod.data.ok && /^data:image\/png;base64,/.test(kod.data.qr) && /\/fx\/[A-Za-z0-9_-]+$/.test(kod.data.url), kod.data && kod.data.url);
  const token = kod.data.url.split('/fx/')[1];
  ok('token neobsahuje meno, e-mail ani id v čitateľnej podobe', !token.includes(uid) && !Buffer.from(token, 'base64url').toString('latin1').includes(uid) && !/petra|test-fa-qa/i.test(token));
  ok('QR platí 5 minút', Math.abs(new Date(kod.data.plati_do) - Date.now() - 300000) < 15000, kod.data.plati_do);
  const strana = await fetch(BASE + '/fx/' + token);
  const html = await strana.text();
  ok('overovacia stránka sa otvorí bez prihlásenia', strana.status === 200);
  ok('ukáže „Aktívne členstvo — nárok na zľavu Fusion X 10 %."', html.includes('Aktívne členstvo — nárok na zľavu Fusion X 10 %.'));
  ok('ukáže len skrátené meno (Petra S.), nie e-mail', html.includes('Petra S.') && !html.includes('test-fa-qa') && !html.includes('Skúšobná'));
  ok('stránka sa necacheuje a neindexuje', strana.headers.get('cache-control') === 'no-store' && /noindex/.test(html));
  await fetch(BASE + '/fx/' + token);
  const zly = await (await fetch(BASE + '/fx/' + token.slice(0, -3) + 'abc')).text();
  ok('pozmenený kód = „Nárok na zľavu nie je platný."', zly.includes('Nárok na zľavu nie je platný.') && !zly.includes('Aktívne členstvo'));
  const nahodny = await (await fetch(BASE + '/fx/nieco-uplne-ine')).text();
  ok('nezmyselný kód = neplatný', nahodny.includes('Nárok na zľavu nie je platný.'));

  const adm2 = await g('admin', '/api/admin/fusion-x');
  const o = adm2.data.overenia;
  ok('overenie sa započíta raz za kód (obnovenie stránky nie)', o && o.platne === pred.platne + 1 && o.clenov === pred.clenov + 1, { pred, o });
  ok('admin vidí overenia, žiadne nákupy ani úspory', o && !('usetrene' in o) && !('nakupy' in o));

  // ── 6) koniec nároku ──────────────────────────────────────────────────────
  const kod2 = await post('kl', '/api/fusion-x/kod', {});
  const token2 = kod2.data.url.split('/fx/')[1];
  // členstvo skončí (zmrazenie/expirácia) → ten istý platný kód už nárok neukáže
  await post('admin', '/api/admin/membership/freeze', { user_id: uid, days: 7 }).catch(() => {});
  const frz = await g('kl', '/api/me');
  if (frz.data.fusion_x && frz.data.fusion_x.aktivny === false) {
    const po = await (await fetch(BASE + '/fx/' + token2)).text();
    ok('po skončení členstva QR ukáže neplatný nárok (počíta sa naživo)', po.includes('Nárok na zľavu nie je platný.'));
  } else console.log('  · zmrazenie nechá nárok aktívny — test skončenia preskočený');

  // ── 7) pozastavenie a mazanie ─────────────────────────────────────────────
  const zmaz = await call('admin', 'DELETE', '/api/admin/fusion-x/partneri/' + z1.id);
  ok('zverejneného partnera nejde zmazať bez pozastavenia', zmaz.status === 400);
  await put('admin', '/api/admin/fusion-x/partneri/' + z1.id, { stav: 'pozastaveny' });
  const pub2 = await g('anon', '/api/public/fusion-x/partneri');
  ok('pozastavený partner zmizne zo zoznamu', !pub2.data.partneri.some(p => p.id === z1.id));
  ok('pozastaveného možno zmazať', (await call('admin', 'DELETE', '/api/admin/fusion-x/partneri/' + z1.id)).status === 200);
  await call('admin', 'DELETE', '/api/admin/fusion-x/partneri/' + zs.id);

  const pg = await fetch(BASE + '/fusion-x');
  ok('stránka /fusion-x existuje', pg.status === 200 && /Fusion X/.test(await pg.text()));

  console.log(`\n${PASS} prešlo, ${FAIL} zlyhalo`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
