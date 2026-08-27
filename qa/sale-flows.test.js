// E2E: každé predajné miesto od začiatku do konca — vstupy/členstvo → tržba → faktúra
const B = 'http://localhost:3991'; const R = 'SF' + Date.now();
const F = [], OK = [];
const bad = (t, d) => { F.push(t + ': ' + d); console.log(`❌ ${t} — ${d}`); };
const ok = t => { OK.push(t); console.log(`✅ ${t}`); };
const req = async (p, o = {}) => { const r = await fetch(B + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.cookie ? { cookie: o.cookie } : {}) }, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) }); const t = await r.text(); let j; try { j = JSON.parse(t) } catch (e) { j = t.slice(0, 150) } return { status: r.status, body: j, cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };

(async () => {
  const A = (await req('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } })).cookie;
  const mk = async (n, e) => { await req('/api/register', { method: 'POST', body: { name: n, email: e, password: 'QAtest1234', consent: true } }); const l = await req('/api/login', { method: 'POST', body: { email: e, password: 'QAtest1234' } }); return { cookie: l.cookie, id: (await req('/api/me', { cookie: l.cookie })).body.id, email: e, name: n }; };
  const zumby = (await req('/api/classes')).body.filter(c => c.category === 'Zumba' && c.active !== false);
  const invOf = async id => (await req('/api/admin/invoices', { cookie: A })).body;
  const T = new Date().toISOString().slice(0, 10);
  const state = async u => { const m = (await req('/api/me', { cookie: u.cookie })).body; return { entries: m.single_entries || 0, mem: m.membership ? m.membership.plan_name : null }; };
  const invCount = async (email) => { const all = (await req('/api/admin/invoices', { cookie: A })).body; const list = Array.isArray(all) ? all : (all.invoices || []); return list.filter(i => (i.client_email||'').toLowerCase() === email.toLowerCase() && i.type !== 'credit_note').length; };

  console.log('\n══ 1. ADMIN → PROFIL KLIENTKY: mesačné členstvo (hotovosť) ══');
  const u1 = await mk('Sofia Memcova', `sf.mem.${R}@test-fa-qa.local`);
  await req(`/api/admin/users/${u1.id}/grant-membership`, { method: 'POST', cookie: A, body: { plan_id: 'silver', amount: 75, gift: false, payment_method: 'cash' } });
  const s1 = await state(u1);
  s1.mem === 'Silver' ? ok('členstvo aktívne (Silver)') : bad('členstvo', 'nie je aktívne: ' + s1.mem);
  (await req('/api/bookings', { method: 'POST', cookie: u1.cookie, body: { class_id: zumby[0]._id } })).status === 200 ? ok('rezervácia prešla') : bad('rezervácia', 'zlyhala');
  (await invCount(u1.email)) === 1 ? ok('faktúra vystavená') : bad('faktúra', 'nevystavená (' + await invCount(u1.email) + ')');

  console.log('\n══ 2. ADMIN → PROFIL: permanentka 10 vstupov (hotovosť) ══');
  const u2 = await mk('Sofia Permanova', `sf.perm.${R}@test-fa-qa.local`);
  await req(`/api/admin/users/${u2.id}/grant-membership`, { method: 'POST', cookie: A, body: { plan_id: 'permanentka10', amount: 80, gift: false, payment_method: 'cash' } });
  const s2 = await state(u2);
  s2.entries === 10 ? ok('10 vstupov pripísaných') : bad('vstupy', 'má ' + s2.entries);
  await req('/api/bookings', { method: 'POST', cookie: u2.cookie, body: { class_id: zumby[0]._id } });
  const b2 = await req('/api/bookings', { method: 'POST', cookie: u2.cookie, body: { class_id: zumby[1]._id } });
  b2.status === 200 ? ok('rezervácia z permanentky prešla') : bad('rezervácia z permanentky', JSON.stringify(b2.body));
  (await state(u2)).entries === 9 ? ok('odpočítaný presne 1 vstup') : bad('odpočet', 'zostatok ' + (await state(u2)).entries);
  (await invCount(u2.email)) === 1 ? ok('faktúra vystavená') : bad('faktúra', 'nevystavená');

  console.log('\n══ 3. TRÉNER → SEKCIA PREDAJ: členstvo ══');
  const u3 = await mk('Sofia Trencova', `sf.trmem.${R}@test-fa-qa.local`);
  await req('/api/trainer/sell', { method: 'POST', cookie: A, body: { user_id: u3.id, kind: 'plan', plan_id: 'bronze', amount: 50 } });
  (await state(u3)).mem === 'Bronze' ? ok('členstvo aktívne (Bronze)') : bad('členstvo', 'nie je aktívne');
  (await invCount(u3.email)) === 1 ? ok('faktúra vystavená') : bad('faktúra', 'nevystavená');

  console.log('\n══ 4. TRÉNER → SEKCIA PREDAJ: permanentka ══');
  const u4 = await mk('Sofia Turcanova', `sf.trperm.${R}@test-fa-qa.local`);
  await req('/api/trainer/sell', { method: 'POST', cookie: A, body: { user_id: u4.id, kind: 'plan', plan_id: 'permanentka10', amount: 80 } });
  (await state(u4)).entries === 10 ? ok('10 vstupov pripísaných') : bad('vstupy', 'má ' + (await state(u4)).entries);
  (await invCount(u4.email)) === 1 ? ok('faktúra vystavená') : bad('faktúra', 'nevystavená');

  console.log('\n══ 5. TRÉNER → DOCHÁDZKA: record-membership ══');
  const u5 = await mk('Sofia Recova', `sf.rec.${R}@test-fa-qa.local`);
  await req('/api/attendance/record-membership', { method: 'POST', cookie: A, body: { user_id: u5.id, plan_id: 'gold', amount: 125, payment_method: 'cash' } });
  (await state(u5)).mem === 'Gold' ? ok('členstvo aktívne (Gold)') : bad('členstvo', 'nie je aktívne');
  (await invCount(u5.email)) === 1 ? ok('faktúra vystavená') : bad('faktúra', 'nevystavená');

  console.log('\n══ 6. TRÉNER → DOCHÁDZKA: jednorazové vstupy ══');
  const u6 = await mk('Sofia Entlova', `sf.ent.${R}@test-fa-qa.local`);
  await req('/api/attendance/single-entry', { method: 'POST', cookie: A, body: { user_id: u6.id, entries: 10, amount: 80, payment_method: 'cash' } });
  (await state(u6)).entries === 10 ? ok('10 vstupov pripísaných') : bad('vstupy', 'má ' + (await state(u6)).entries);
  (await invCount(u6.email)) === 1 ? ok('faktúra vystavená') : bad('faktúra', 'nevystavená');

  console.log('\n══ 7. TRÉNER → SEKCIA PREDAJ: merch ══');
  const prods = (await req('/api/trainer/sell-options', { cookie: A })).body.products || [];
  if (prods.length) {
    const u7 = await mk('Sofia Merchova', `sf.merch.${R}@test-fa-qa.local`);
    const r7 = await req('/api/trainer/sell', { method: 'POST', cookie: A, body: { user_id: u7.id, kind: 'merch', product_id: prods[0].id, qty: 2 } });
    r7.status === 200 ? ok('merch predaný (' + r7.body.what + ', ' + r7.body.amount + ' €)') : bad('merch', JSON.stringify(r7.body));
    (await invCount(u7.email)) === 1 ? ok('faktúra vystavená') : bad('faktúra merch', 'nevystavená');
  }

  console.log('\n══ 8. HOTOVOSŤ U TRÉNERA (zrážka z výplaty) ══');
  const cash = (await req('/api/trainer/cash', { cookie: A })).body;
  cash.pending > 0 ? ok(`hotovosť evidovaná: ${cash.pending} € u trénera`) : bad('hotovosť', 'nezaevidovaná');

  console.log('\n══ 9. ÚČTOVNÍCTVO — sedia tržby? ══');
  const acc = (await req(`/api/admin/accounting/summary?from=${T}&to=${T}`, { cookie: A })).body;
  const sum = (acc.byPlan || []).reduce((s, x) => s + x.revenue, 0);
  console.log('   podľa produktu:', JSON.stringify(acc.byPlan));
  const expected = 75 + 80 + 50 + 80 + 125 + 80 + (prods.length ? prods[0].price * 2 : 0);
  Math.abs(sum - expected) < 0.01 ? ok(`tržby sedia: ${sum} € (očakávané ${expected} €)`) : bad('tržby', `${sum} € vs očakávané ${expected} €`);

  console.log('\n══ 10. FAKTÚRY — počet a číslovanie ══');
  const allInv = (await req('/api/admin/invoices', { cookie: A })).body;
  const list = Array.isArray(allInv) ? allInv : (allInv.invoices || []);
  const mine = list.filter(i => (i.client_email || '').includes(R.toLowerCase()) || (i.client_email || '').includes('test-fa-qa'));
  console.log('   vystavených faktúr v teste:', mine.length, '| čísla:', mine.slice(0, 8).map(i => i.number).join(', '));
  const nums = mine.map(i => i.number).filter(Boolean);
  new Set(nums).size === nums.length ? ok('čísla faktúr sú jedinečné') : bad('číslovanie', 'duplicitné čísla faktúr!');

  console.log('\n═══ VÝSLEDOK ═══');
  console.log('PASS:', OK.length, '| CHYBY:', F.length);
  if (F.length) console.log(F.join('\n'));
})().catch(e => console.error('FATAL', e));
