/**
 * E2E: dvojitá aktivácia členstva (Marek 7. 9. 2026).
 *
 * Alena N. si kúpila Bronze, hoci sa jej členstvo obnovovalo automaticky —
 * appka ju do platby pustila bez slova. Nákup, ktorý by znamenal druhé bežiace
 * členstvo (rovnaký plán) alebo druhý mesačný odber, musí appka zastaviť ešte
 * pred platbou a povedať, čo má klientka spraviť.
 *
 * Čo NESMIE zastaviť: permanentky a jednorazové vstupy (tie sa stackujú zámerne)
 * a zmenu plánu bez odberu (zvyšok sa prepočíta na kredit).
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

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ DVOJITÁ AKTIVÁCIA ČLENSTVA ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  const mail = 'qa-dupl-' + uniq + '@test-fa-qa.local';
  await post('K', '/api/register', { name: 'QA Duplicita Klientka', email: mail, password: 'AuditPass123!', consent: true });
  const zoznam = (await g('admin', '/api/admin/users?limit=500')).data || {};
  const kl = (zoznam.users || []).find(u => u.email === mail);
  ok('klientka vytvorená', !!kl, zoznam.total);
  if (!kl) { console.log('FATAL'); process.exit(1); }

  // ── Bez členstva sa Bronze kúpiť dá ──────────────────────────────────────
  const prvy = await post('K', '/api/membership/buy', { plan_id: 'bronze', payment_method: 'manual' });
  ok('bez členstva prejde nákup Bronze', prvy.status === 200 && prvy.data?.ok === true, prvy);

  // ── Bežiace členstvo Bronze (ako po zaplatení / automatickej obnove) ─────
  await post('admin', '/api/admin/users/' + kl.id + '/grant-membership', { plan_id: 'bronze', gift: true });
  const mem = (await g('K', '/api/membership')).data || {};
  ok('klientka má aktívny Bronze', /bronze/i.test(JSON.stringify(mem)), mem);

  // ── 1) Ten istý plán druhýkrát → zastavené ──────────────────────────────
  const druhy = await post('K', '/api/membership/buy', { plan_id: 'bronze', payment_method: 'manual' });
  ok('druhý Bronze → 409', druhy.status === 409, druhy);
  ok('kód je membership_active', druhy.data?.code === 'membership_active', druhy.data);
  ok('hláška je pre klientku, nie kód', /kupovať ho druhýkrát nemusíš/i.test(druhy.data?.error || ''), druhy.data);
  ok('a povie, dokedy členstvo platí', /\d{4}-\d{2}-\d{2}/.test(druhy.data?.error || ''), druhy.data);

  // ── 2) Permanentka a vstup sa stackovať smú ─────────────────────────────
  const perm = await post('K', '/api/membership/buy', { plan_id: 'permanentka10', payment_method: 'manual' });
  ok('permanentku si kúpiť môže aj s členstvom', perm.status === 200 && perm.data?.ok === true, perm);
  const vstup = await post('K', '/api/membership/buy', { plan_id: 'vstup1', payment_method: 'manual' });
  ok('jednorazový vstup tiež', vstup.status === 200 && vstup.data?.ok === true, vstup);

  // ── 3) Zmena plánu (bez odberu) ostáva možná ────────────────────────────
  const upgrade = await post('K', '/api/membership/buy', { plan_id: 'gold', payment_method: 'manual' });
  ok('prechod na iný plán appka nezablokuje', upgrade.status === 200 && upgrade.data?.ok === true, upgrade);

  // ── 4) Klientka bez členstva nie je obmedzená ───────────────────────────
  const mail2 = 'qa-dupl2-' + uniq + '@test-fa-qa.local';
  await post('N', '/api/register', { name: 'QA Nova Klientka', email: mail2, password: 'AuditPass123!', consent: true });
  const nova = await post('N', '/api/membership/buy', { plan_id: 'silver', payment_method: 'manual' });
  ok('nová klientka kúpi členstvo bez prekážky', nova.status === 200 && nova.data?.ok === true, nova);

  // ── Upratanie ───────────────────────────────────────────────────────────
  // Účty tu ZÁMERNE nemažeme: test po sebe necháva nákupy a faktúry, a analytika
  // vylučuje testovacie dáta podľa e-mailu (@test-fa-qa.local). Po zmazaní účtu
  // by transakcie osireli, prepadli sa do štatistík a zhodili obchod.test.js.
  // Účty ostávajú označené testovacou doménou, takže sa dajú kedykoľvek upratať.
  const zoznam2 = (await g('admin', '/api/admin/users?limit=500')).data || {};
  ok('testovacie účty nesú QA doménu', [mail, mail2].every(m =>
    (zoznam2.users || []).some(u => u.email === m && /@test-fa-qa.local$/.test(u.email))));

  console.log('\n═══ ' + PASS + ' passed, ' + FAIL + ' failed ═══\n');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
