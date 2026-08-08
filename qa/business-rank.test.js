/**
 * E2E: Business Rank — prázdna firma, platené vs. darčekové členstvá, test účty
 * mimo výpočtu, refundácie (net revenue), parita s Financiami, permissions,
 * misie/health/simulátor config.
 */
const BASE = 'http://localhost:' + (process.env.QA_PORT || 3999);
let PASS = 0, FAIL = 0; const FAILS = [];
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; FAILS.push({ name }); console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : '')); }
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
const br = async () => (await g('admin', '/api/admin/business-rank?fresh=1')).data;

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ BUSINESS RANK AUDIT ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // 1) permissions
  const anon = await g('anon', '/api/admin/business-rank');
  ok('bez prihlásenia 401', anon.status === 401, anon);
  await post('C0', '/api/register', { name: 'BIZ Klientka', email: 'biz-cli-' + uniq + '@qa-biz.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
  const cli = await g('C0', '/api/admin/business-rank');
  ok('klient 403', cli.status === 403, cli);

  // 2) takmer prázdna firma — endpoint drží pokope
  const d0 = await br();
  ok('endpoint 200 + štruktúra', !!(d0 && d0.rank && d0.metrics && d0.config && Array.isArray(d0.missions)), d0 && Object.keys(d0));
  ok('100 levelov v configu', d0.config.ranks.length === 100, d0.config.ranks.length);
  ok('level 100 ≈ 460k XP (1 mld € ročne)', d0.config.ranks[99].xp >= 400000 && d0.config.ranks[99].xp <= 500000, d0.config.ranks[99]);
  ok('rank má level + name', Number.isFinite(d0.rank.level) && !!d0.rank.name, d0.rank);
  ok('levely rastú monotónne', d0.config.ranks.every((r, i, a) => !i || r.xp > a[i - 1].xp), null);
  ok('XP je číslo ≥ 0', Number.isFinite(d0.xp) && d0.xp >= 0, d0.xp);
  ok('misie max 5', d0.missions.length >= 1 && d0.missions.length <= 5, d0.missions.length);
  ok('health 0–100', d0.health.score >= 0 && d0.health.score <= 100, d0.health);
  const baseMembers = d0.metrics.members, baseRev = d0.metrics.grossMonth;

  // 3) platené členstvo sa ráta (members +1, revenue +50)
  const meC = (await g('C0', '/api/me')).data || {};
  await post('admin', '/api/admin/users/' + meC.id + '/grant-membership', { plan_id: 'bronze', gift: false, payment_method: 'cash', amount: 50 });
  const d1 = await br();
  ok('platené členstvo → members +1', d1.metrics.members === baseMembers + 1, { pred: baseMembers, po: d1.metrics.members });
  ok('platené členstvo → obrat +50 €', Math.abs(d1.metrics.grossMonth - baseRev - 50) < 0.01, { pred: baseRev, po: d1.metrics.grossMonth });
  ok('breakdown memberships ≥ 50 €', (d1.breakdown.memberships || 0) >= 50, d1.breakdown);
  ok('XP stúplo', d1.xp > d0.xp, { pred: d0.xp, po: d1.xp });

  // 4) darčekové členstvo sa NEráta
  await post('G1', '/api/register', { name: 'BIZ Darcek', email: 'biz-gift-' + uniq + '@qa-biz.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
  const meG = (await g('G1', '/api/me')).data || {};
  await post('admin', '/api/admin/users/' + meG.id + '/grant-membership', { plan_id: 'gold', gift: true });
  const d2 = await br();
  ok('darček → members bez zmeny', d2.metrics.members === d1.metrics.members, { pred: d1.metrics.members, po: d2.metrics.members });
  ok('darček → obrat bez zmeny', Math.abs(d2.metrics.grossMonth - d1.metrics.grossMonth) < 0.01, { pred: d1.metrics.grossMonth, po: d2.metrics.grossMonth });

  // 5) parita s Financiami (rovnaký gross mesiac, kým nie sú test účty s platbami)
  const fin = (await g('admin', '/api/admin/finance/stats')).data || {};
  ok('parita s Financiami (gross mesiac)', Math.abs((fin.revenue?.month || 0) - d2.metrics.grossMonth) < 0.01, { financie: fin.revenue?.month, bizrank: d2.metrics.grossMonth });

  // 6) test účet (@test-fa-qa.local) je z Business Ranku vylúčený
  await post('T1', '/api/register', { name: 'BIZ TestUcet', email: 'biz-test-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
  const meT = (await g('T1', '/api/me')).data || {};
  await post('admin', '/api/admin/users/' + meT.id + '/grant-membership', { plan_id: 'silver', gift: false, payment_method: 'cash', amount: 75 });
  const d3 = await br();
  ok('test účet → members bez zmeny', d3.metrics.members === d2.metrics.members, { pred: d2.metrics.members, po: d3.metrics.members });
  ok('test účet → obrat bez zmeny', Math.abs(d3.metrics.grossMonth - d2.metrics.grossMonth) < 0.01, { pred: d2.metrics.grossMonth, po: d3.metrics.grossMonth });

  // 7) refundácia znižuje NET revenue, gross ostáva
  await post('admin', '/api/admin/refunds', { type: 'transfer', amount: 20, reason: 'other', note: 'QA biz rank' });
  const d4 = await br();
  ok('refund −20 € v net revenue', Math.abs((d4.metrics.grossMonth - d4.metrics.refundsMonth) - d4.metrics.revenue) < 0.01 && d4.metrics.refundsMonth >= 20, d4.metrics);
  ok('net = gross − refunds', d4.metrics.revenue <= d4.metrics.grossMonth, d4.metrics);

  // 8) permanentka → passes revenue kategória
  await post('P1', '/api/register', { name: 'BIZ Permicka', email: 'biz-pass-' + uniq + '@qa-biz.local', password: 'AuditPass123!', city: 'Zvolen', consent: true });
  const meP = (await g('P1', '/api/me')).data || {};
  await post('admin', '/api/admin/users/' + meP.id + '/grant-membership', { plan_id: 'permanentka10', gift: false, payment_method: 'cash', amount: 80 });
  const d5 = await br();
  ok('permanentka → breakdown passes ≥ 80 €', (d5.breakdown.passes || 0) >= 80, d5.breakdown);
  ok('permanentka NEzvyšuje aktívne členstvá', d5.metrics.members === d4.metrics.members, { pred: d4.metrics.members, po: d5.metrics.members });
  ok('aktívne permanentky ≥ 1', d5.metrics.passes >= 1, d5.metrics.passes);

  // 9) next rank + simulátor podklady
  ok('next rank s progress + missingXp', !d5.next || (Number.isFinite(d5.next.missingXp) && d5.next.progress >= 0 && d5.next.progress <= 100), d5.next);
  ok('config.weights pre simulátor', !!(d5.config.weights.members && d5.config.weights.revenue), Object.keys(d5.config.weights || {}));
  ok('xpParts sedia so súčtom XP', Math.abs(Object.values(d5.xpParts).reduce((s, p) => s + p.xp, 0) - d5.xp) <= 1, d5.xp);

  console.log(`\n═══ VÝSLEDOK: ${PASS} ✓ / ${FAIL} ✗ ═══`);
  if (FAIL) { console.log(FAILS.map(f => f.name).join('\n')); process.exit(1); }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
