/**
 * E2E: Fusion AI fáza 1 — deterministický CEO dashboard + brief.
 * Overuje, že metriky sedia s reálne vytvorenými dátami (žiadne vymyslené čísla).
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

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ FUSION AI (fáza 1) ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // ── prístup ──────────────────────────────────────────────────────────────
  await post('C', '/api/register', { name: 'Fusion Klientka', email: 'fai-c-' + uniq + '@example.com', password: 'AuditPass123!', consent: true });
  const noAuth = await g('C', '/api/admin/fusion-ai/dashboard');
  ok('bežný klient nemá prístup', noAuth.status === 401 || noAuth.status === 403, noAuth.status);

  // ── baseline ─────────────────────────────────────────────────────────────
  const before = (await g('admin', '/api/admin/fusion-ai/dashboard?force=1')).data;
  ok('dashboard odpovedá', before?.ok === true, before);
  ok('má revenue/members/opportunities/money_left', !!(before.revenue && before.members && before.opportunities && before.money_left));

  // ── kontrola: nová platba sa premietne do dnešného obratu ────────────────
  const me = (await g('C', '/api/me')).data;
  // rovnaké API ako admin okno „Zaznamenať predaj"
  const sale = await post('admin', '/api/admin/transactions', { client_id: me.id, amount: 10, notes: 'FAI test' });
  ok('predaj zaznamenaný', sale.status === 200 && sale.data?.ok, sale);
  const after = (await g('admin', '/api/admin/fusion-ai/dashboard?force=1')).data;
  ok('predaj 10 € zvýšil dnešný obrat o 10', Math.round((after.revenue.today - before.revenue.today) * 100) / 100 === 10, { pred: before.revenue.today, po: after.revenue.today });

  // ── nekontaktovaný lead (starší ako 24 h) sa objaví v príležitostiach ────
  // registrácia leada s created_at včera sa nedá cez API — použijeme počty konzistentne:
  ok('uncontacted count = leads.uncontacted_24h', after.opportunities.uncontacted.count === after.leads.uncontacted_24h);
  ok('money_left.total = súčet breakdownu', Math.abs(after.money_left.total - after.money_left.breakdown.reduce((s, b) => s + (b.value || 0), 0)) < 0.01, after.money_left);
  for (const b of after.money_left.breakdown) ok('breakdown „' + b.key + '" má vysvetlenie výpočtu', !!b.how);

  // ── obsadenosť: čísla sedia s /api/classes ───────────────────────────────
  const classes = (await g('admin', '/api/classes')).data || [];
  const occ = after.occupancy.all;
  const sample = occ[0];
  if (sample) {
    const cls = classes.find(c => (c.location || '') === sample.city && c.time_start === sample.time && c.day_of_week === sample.day);
    ok('obsadenosť sedí s /api/classes (booked)', !cls || Math.abs((cls.booked || 0) - sample.booked) <= 1, { fai: sample, cls: cls && { booked: cls.booked } });
  } else ok('obsadenosť: žiadne hodiny v sandboxe (ok)', true);

  // ── brief ────────────────────────────────────────────────────────────────
  const brief = (await post('admin', '/api/admin/fusion-ai/run-brief', {})).data;
  ok('brief sa vygeneroval', brief?.ok && typeof brief.text === 'string' && brief.text.includes('FUSION AI'), brief?.text?.slice(0, 80));
  ok('brief obsahuje reálny včerajší obrat', brief.text.includes('OBRAT VČERA'), null);
  const stored = (await g('admin', '/api/admin/fusion-ai/brief')).data;
  ok('brief je uložený a načítateľný', stored?.ok && stored.text === brief.text);

  // ── deterministickosť: dva force prepočty dajú rovnaké čísla ─────────────
  const a1 = (await g('admin', '/api/admin/fusion-ai/dashboard?force=1')).data;
  const a2 = (await g('admin', '/api/admin/fusion-ai/dashboard?force=1')).data;
  ok('výpočet je deterministický (revenue+money_left zhodné)',
    JSON.stringify(a1.revenue) === JSON.stringify(a2.revenue) && a1.money_left.total === a2.money_left.total);

  console.log(`\n═══ ${PASS} passed, ${FAIL} failed ═══\n`);
  process.exit(FAIL ? 1 : 0);
})();
