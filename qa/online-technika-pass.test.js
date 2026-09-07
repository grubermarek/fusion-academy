/**
 * E2E: čo smie a čo nesmie zobrať vstup do online prenosu (Marek 7. 9. 2026).
 *
 * Diery, ktoré 6. 9. stáli Soňu M. výhernú online hodinu: nedeľný technický
 * tréning ostal v rozvrhu, hoci sa nekonal, appka ho pustila ako bežný prenos
 * a hodinu z kolesa strhla — za stream, ktorý nikdy nebežal.
 *
 * Pravidlá, ktoré tento test drží:
 *   1. Výherná online hodina (online_passes) sa NESMIE minúť na techniku.
 *   2. Zrušený termín sa nedá „navštíviť" a nič nestrhne.
 *   3. Keď nie je nastavené vysielanie, nestrhne sa nič.
 *   4. Na bežnej online Zumbe pass funguje ďalej.
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
const put = (jar, p, b) => call(jar, 'PUT', p, b);
const del = (jar, p) => call(jar, 'DELETE', p);
const dstr = d => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(d);
const TODAY = dstr(new Date());
const DOW = new Date().getDay();

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ ONLINE PRENOS: TECHNIKA vs. VÝHERNÁ HODINA ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // Hodiny sú DNEŠNÉ jednorazové termíny (only_date), aby test nezávisel od rozvrhu.
  // Každá má vlastné „mesto streamu" — appka zdieľa jeden link medzi hodinami
  // z rovnakého mesta a dňa, čo by testu prepísalo hodinu bez vysielania.
  const mk = (name, mesto, extra) => post('admin', '/api/admin/classes', {
    name, category: 'Online', location: 'Online', stream_city: mesto,
    day_of_week: DOW, time_start: '05:10', time_end: '06:10', capacity: 50, price: 6,
    only_date: TODAY, ...extra,
  });
  const setStream = (id, url) => put('admin', '/api/admin/classes/' + id + '/stream', { stream_url: url });
  const tech = (await mk('QA Technický tréning ONLINE ' + uniq, 'QA-Tech-' + uniq)).data;
  const zumba = (await mk('QA Zumba ONLINE ' + uniq, 'QA-Zumba-' + uniq)).data;
  const bezStreamu = (await mk('QA Zumba ONLINE bez linku ' + uniq, 'QA-Bez-' + uniq)).data;
  const zrusena = (await mk('QA Zumba ONLINE zrušená ' + uniq, 'QA-Zrus-' + uniq)).data;
  ok('admin vytvoril testovacie online hodiny', !!(tech?.id && zumba?.id && bezStreamu?.id && zrusena?.id),
    { tech: tech?.id, zumba: zumba?.id, bez: bezStreamu?.id, zrus: zrusena?.id });
  if (!tech?.id) { console.log('FATAL: hodiny sa nevytvorili'); process.exit(1); }
  await setStream(tech.id, 'https://example.test/tech');
  await setStream(zumba.id, 'https://example.test/zumba');
  await setStream(zrusena.id, 'https://example.test/x');
  await post('admin', '/api/attendance/cancel-session', { class_id: zrusena.id, date: TODAY, reason: 'QA test' });

  // Klientka bez členstva, s jednou výhernou online hodinou z kolesa a bez vstupov.
  const mail = 'qa-pass-' + uniq + '@test-fa-qa.local';
  await post('K', '/api/register', { name: 'QA Pass Klientka', email: mail, password: 'AuditPass123!', consent: true });
  const zoznam = (await g('admin', '/api/admin/users?limit=500')).data || {};
  const kl = (zoznam.users || []).find(u => u.email === mail);
  ok('klientka je v admin zozname', !!kl, zoznam.total);
  if (!kl) { console.log('FATAL: klientka sa nenašla'); process.exit(1); }
  await put('admin', '/api/admin/users/' + kl.id + '/awards', { online_passes: 1, single_entries: 0, free_credits: 0 });

  // ── 1) Technika NESMIE zobrať výhernú online hodinu ────────────────────────
  const r1 = await post('K', '/api/online/enter', { class_id: tech.id });
  ok('technika + iba výherná hodina → odmietnuté', r1.status === 402, r1);
  ok('a hláška vysvetlí prečo', /výherná online hodina neplatí/i.test(r1.data?.error || ''), r1.data);
  let stav = (await g('K', '/api/online/classes')).data || {};
  ok('výherná hodina ostala nespotrebovaná', stav.online_passes === 1, { passes: stav.online_passes });
  const techKarta = (stav.classes || []).find(c => c._id === tech.id);
  ok('technika sa v zozname neponúka ako „výherná hodina"', techKarta && techKarta.access_mode !== 'pass', techKarta);

  // ── 2) Zrušený termín nič nestrhne ────────────────────────────────────────
  const r2 = await post('K', '/api/online/enter', { class_id: zrusena.id });
  ok('zrušená hodina → 410, nie prehrávanie', r2.status === 410, r2);
  ok('a povie, že sa nič nestrhlo', /nestrhli/i.test(r2.data?.error || ''), r2.data);
  stav = (await g('K', '/api/online/classes')).data || {};
  ok('zrušená hodina zmizla zo zoznamu', !(stav.classes || []).some(c => c._id === zrusena.id),
    (stav.classes || []).map(c => c.name));

  // ── 3) Bez nastaveného vysielania sa nič nestrhne ──────────────────────────
  const r3 = await post('K', '/api/online/enter', { class_id: bezStreamu.id });
  ok('hodina bez linku → 409 a čakanie', r3.status === 409 && r3.data?.waiting === true, r3);
  stav = (await g('K', '/api/online/classes')).data || {};
  ok('výherná hodina stále nespotrebovaná', stav.online_passes === 1, { passes: stav.online_passes });

  // Odkaz na vysielanie si pamätá deň zadania — podľa toho sa pozná, či je
  // dnešný, alebo tam visí z minulého týždňa (vtedy sa zaň nesmie platiť).
  const zoznamHodin = (await g('admin', '/api/classes')).data || [];
  const techCls = zoznamHodin.find(c => c._id === tech.id);
  ok('odkaz na vysielanie nesie dátum zadania', techCls && techCls.stream_url_at === TODAY,
    techCls && { at: techCls.stream_url_at, dnes: TODAY });

  // ── 4) Na bežnej online Zumbe pass funguje ────────────────────────────────
  const r4 = await post('K', '/api/online/enter', { class_id: zumba.id });
  ok('Zumba online + výherná hodina → pustí', r4.status === 200 && r4.data?.mode === 'pass', r4);
  ok('a hodinu spotrebuje (zostáva 0)', r4.data?.remaining === 0, r4.data);
  ok('a vydá stream', r4.data?.stream?.stream_url === 'https://example.test/zumba', r4.data?.stream);

  // ── 5) Permanentkárka techniku zaplatiť môže — cenník to dovoľuje ─────────
  // Nová klientka: použitý pass otvára celý dnešný večer (jeden prenos), takže
  // pôvodná už má prístup zadarmo a odpočet vstupu by sa na nej overiť nedal.
  const mail2 = 'qa-perm-' + uniq + '@test-fa-qa.local';
  await post('P', '/api/register', { name: 'QA Permanentka Klientka', email: mail2, password: 'AuditPass123!', consent: true });
  const zoznam2 = (await g('admin', '/api/admin/users?limit=500')).data || {};
  const kl2 = (zoznam2.users || []).find(u => u.email === mail2);
  if (!kl2) { console.log('FATAL: druhá klientka sa nenašla'); process.exit(1); }
  await put('admin', '/api/admin/users/' + kl2.id + '/awards', { online_passes: 0, single_entries: 2 });
  const r5 = await post('P', '/api/online/enter', { class_id: tech.id });
  ok('technika + permanentka → pustí za 1 vstup', r5.status === 200 && r5.data?.mode === 'entry', r5);
  ok('a odčíta presne jeden vstup', r5.data?.remaining === 1, r5.data);

  // ── Upratanie ─────────────────────────────────────────────────────────────
  for (const c of [tech, zumba, bezStreamu, zrusena]) await del('admin', '/api/admin/classes/' + c.id);
  await del('admin', '/api/admin/users/' + kl.id);
  await del('admin', '/api/admin/users/' + kl2.id);
  const po = (await g('admin', '/api/classes')).data || [];
  ok('testovacie hodiny upratané', !po.some(c => String(c.name || '').includes(uniq)),
    po.filter(c => String(c.name || '').includes(uniq)).map(c => c.name));

  console.log('\n═══ ' + PASS + ' passed, ' + FAIL + ' failed ═══\n');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
