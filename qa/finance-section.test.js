// Kompletná kontrola sekcie FINANCIE & REPORTY — každá položka menu
const B = 'http://localhost:3991'; const R = 'FIN' + Date.now();
const F = [], OK = [], WARN = [];
const bad = (t, d) => { F.push(t + ' — ' + d); console.log(`❌ ${t} — ${d}`); };
const warn = (t, d) => { WARN.push(t + ' — ' + d); console.log(`⚠️  ${t} — ${d}`); };
const ok = t => { OK.push(t); console.log(`✅ ${t}`); };
const req = async (p, o = {}) => { const r = await fetch(B + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.cookie ? { cookie: o.cookie } : {}) }, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) }); const t = await r.text(); let j; try { j = JSON.parse(t) } catch (e) { j = t.slice(0, 200) } return { status: r.status, body: j, raw: t, cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };

(async () => {
  const A = (await req('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } })).cookie;
  const mk = async (n, e) => { await req('/api/register', { method: 'POST', body: { name: n, email: e, password: 'QAtest1234', consent: true } }); const l = await req('/api/login', { method: 'POST', body: { email: e, password: 'QAtest1234' } }); return { cookie: l.cookie, id: (await req('/api/me', { cookie: l.cookie })).body.id, email: e, name: n }; };
  const T = new Date().toISOString().slice(0, 10);
  const M = T.slice(0, 7);

  // ── Priprav reálne dáta: 3 predaje rôznymi cestami ──
  console.log('── príprava dát ──');
  const c1 = await mk('FIN A ' + R, `fin.a.${R}@test-fa-qa.local`);
  const c2 = await mk('FIN B ' + R, `fin.b.${R}@test-fa-qa.local`);
  const c3 = await mk('FIN C ' + R, `fin.c.${R}@test-fa-qa.local`);
  await req(`/api/admin/users/${c1.id}/grant-membership`, { method: 'POST', cookie: A, body: { plan_id: 'silver', amount: 75, gift: false, payment_method: 'cash' } });
  await req(`/api/admin/users/${c2.id}/grant-membership`, { method: 'POST', cookie: A, body: { plan_id: 'permanentka10', amount: 80, gift: false, payment_method: 'cash' } });
  await req('/api/trainer/sell', { method: 'POST', cookie: A, body: { user_id: c3.id, kind: 'plan', plan_id: 'bronze', amount: 50 } });
  const EXPECTED = 75 + 80 + 50;
  console.log(`   predané za ${EXPECTED} € (75 Silver + 80 permanentka + 50 Bronze)\n`);

  const check = async (label, path, validate) => {
    const r = await req(path, { cookie: A });
    if (r.status !== 200) { bad(label, `HTTP ${r.status} — ${JSON.stringify(r.body).slice(0, 120)}`); return null; }
    if (typeof r.body === 'string') { bad(label, 'nevrátilo JSON: ' + r.body.slice(0, 80)); return null; }
    const msg = validate ? validate(r.body) : null;
    if (msg) { bad(label, msg); return r.body; }
    ok(label);
    return r.body;
  };

  console.log('\n═══ FINANCIE ═══');
  const fin = await check('1. Financie (finance/stats)', `/api/admin/finance/stats?from=${T}&to=${T}`,
    d => (d.revenue === undefined ? 'chýba pole revenue' : null));
  if (fin) console.log(`     tržby dnes=${fin.revenue&&fin.revenue.today} € · za obdobie=${fin.revenue&&fin.revenue.period} € · MRR=${fin.mrr} · aktívnych členov=${fin.activeMembers} · AOV=${fin.aov}`);

  const acc = await check('2. Účtovníctvo (accounting/summary)', `/api/admin/accounting/summary?from=${T}&to=${T}`,
    d => (!Array.isArray(d.byPlan) ? 'chýba rozpad podľa produktu' : null));
  const accTotal = acc ? (acc.byPlan || []).reduce((s, x) => s + x.revenue, 0) : 0;
  if (acc) console.log(`     dnes=${accTotal} € · metódy=${JSON.stringify(acc.byMethod || [])}`);

  const inv = await check('3. Faktúry (admin/invoices)', '/api/admin/invoices',
    d => { const l = Array.isArray(d) ? d : d.invoices; return !Array.isArray(l) ? 'nevrátil zoznam' : null; });
  const invList = inv ? (Array.isArray(inv) ? inv : inv.invoices) : [];
  const invToday = invList.filter(i => (i.issued_at || '').slice(0, 10) === T && i.type !== 'credit_note');
  console.log(`     faktúr dnes: ${invToday.length} · spolu ${invToday.reduce((s, i) => s + (+i.total || 0), 0)} €`);

  await check('4. Refundácie (admin/refunds)', '/api/admin/refunds', d => (d.refunds || Array.isArray(d)) ? null : 'neznámy formát');
  const fp=await check('5. Neúspešné platby (failed-payments)', '/api/admin/failed-payments', d => (d.rows===undefined ? 'chýbajú riadky' : null));
  if(fp) console.log(`     neuhradených: ${fp.count} · dlžná suma: ${fp.owed} €`);
  await check('6. Zaznamenať predaj — partneri', '/api/admin/partners');
  await check('6. Zaznamenať predaj — produkty', '/api/products', d => Array.isArray(d) ? null : 'nevrátil zoznam produktov');
  const tx = await check('7. Všetky predaje (transactions)', '/api/transactions', d => Array.isArray(d) ? null : 'nevrátil zoznam');
  const pay = await check('8. Platby PayPal (payments)', '/api/payments', d => Array.isArray(d) ? null : 'nevrátil zoznam');
  if (pay) {
    const pp = pay.filter(p => (p.provider || '').toLowerCase().includes('paypal') || p.paypal_order_id);
    if (!pp.length) warn('8. Platby PayPal', 'PayPal je vypnutý (platby idú cez Stripe) — sekcia je trvalo prázdna');
  }

  console.log('\n═══ VÝKON & RETENCIA ═══');
  await check('9. Retencia & LTV', '/api/admin/analytics/retention', d => (d.ltv !== undefined || d.cohorts || d.retention) ? null : 'chýbajú metriky');
  const pts = await check('10. Body klientov (points-summary)', `/api/admin/points-summary?from=${T}&to=${T}`,
    d => (d.rows === undefined ? 'chýbajú riadky' : null));
  if (pts) console.log(`     klientov s bodmi: ${pts.count} · body spolu: ${pts.grandPoints}`);
  const lb = await check('11. Leaderboard dochádzky', '/api/leaderboard?period=month', d => (Array.isArray(d) || d.rows || d.leaders) ? null : 'neznámy formát');
  await check('12. História hodín & zárobky', `/api/admin/payouts?month=${M}`, d => Array.isArray(d) || d.rows ? null : 'neznámy formát');
  await check('13. Úlohy trénerov', '/api/tasks/admin/overview?month=' + M, d => (d.tasks===undefined ? 'chýbajú úlohy' : null));
  await check('14. Výkon trénerov', '/api/admin/trainers/performance?month=' + M);
  const po = await check('15. Výplaty trénerov', `/api/admin/payouts?month=${M}`, d => (Array.isArray(d) || d.rows) ? null : 'neznámy formát');
  const poRows = po ? (Array.isArray(po) ? po : po.rows || []) : [];
  console.log(`     trénerov vo výplatách: ${poRows.length}${poRows.length ? ' · ' + poRows.map(p => `${p.trainer}:${(p.total || 0).toFixed(2)}€`).join(', ') : ''}`);

  console.log('\n═══ SYSTÉM ═══');
  const al = await check('16. Alerty', '/api/admin/alerts', d => (d.alerts || Array.isArray(d)) ? null : 'neznámy formát');
  if (al) console.log(`     alertov: ${(al.alerts || al).length} · neprečítaných: ${al.unread ?? '—'}`);
  // Exporty
  for (const ds of ['members', 'crm', 'campaigns', 'payments', 'refunds']) {
    const r = await req(`/api/admin/export/${ds}.csv`, { cookie: A });
    r.status === 200 && r.raw.length > 10 ? ok(`17. Export ${ds}.csv (${r.raw.split('\n').length} riadkov)`) : bad(`17. Export ${ds}.csv`, `HTTP ${r.status}`);
  }
  for (const [lbl,u] of [['faktury','/api/admin/invoices/export.csv'],['uctovnictvo','/api/admin/accounting/export.csv?from=2000-01-01&to=2100-01-01'],['vyplaty','/api/admin/payouts/export.csv?month='+M]]) {
    const r = await req(u, { cookie: A });
    const rows = r.raw ? r.raw.split(String.fromCharCode(10)).length : 0;
    if (r.status===200 && r.raw.length>5) ok('17. Export ' + lbl + ' (' + rows + ' riadkov)'); else bad('17. Export ' + lbl, 'HTTP ' + r.status);
  }
  const au = await check('18. Audit log', '/api/admin/audit', d => Array.isArray(d) ? null : 'nevrátil zoznam');
  if (au) console.log(`     záznamov: ${au.length} · najnovší: ${au[0] ? au[0].action : '—'}`);

  console.log('\n═══ NADVÄZNOSŤ ČÍSEL ═══');
  Math.abs(accTotal - EXPECTED) < 0.01 ? ok(`Účtovníctvo = reálne predaje (${accTotal} €)`) : bad('Účtovníctvo', `${accTotal} € ≠ predané ${EXPECTED} €`);
  const finRev = fin && fin.revenue ? (+fin.revenue.period || +fin.revenue.today || 0) : 0;
  Math.abs(finRev - EXPECTED) < 0.01 ? ok(`Financie = Účtovníctvo (${finRev} €)`) : bad('Financie vs Účtovníctvo', `Financie ${finRev} € ≠ ${EXPECTED} €`);
  const invSum = invToday.reduce((s, i) => s + (+i.total || 0), 0);
  Math.abs(invSum - EXPECTED) < 0.01 ? ok(`Faktúry = tržby (${invSum} €)`) : bad('Faktúry vs tržby', `faktúry ${invSum} € ≠ ${EXPECTED} €`);

  console.log('\n═══════ VÝSLEDOK ═══════');
  console.log(`✅ OK: ${OK.length}   ⚠️  upozornenia: ${WARN.length}   ❌ chyby: ${F.length}`);
  if (F.length) console.log('\nCHYBY:\n' + F.map(x => ' • ' + x).join('\n'));
  if (WARN.length) console.log('\nUPOZORNENIA:\n' + WARN.map(x => ' • ' + x).join('\n'));
})().catch(e => console.error('FATAL', e));
