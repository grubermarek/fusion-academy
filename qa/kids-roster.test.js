/**
 * Predbežný zoznam Zumba Kids (Marek 13. 9.): deti chodia skôr, než majú rodičia účet.
 * Zoznam drží meno, skupinu, platbu a dochádzku; po založení účtu sa prepojí s profilom.
 *
 * Overuje:
 *  - pridanie, skupina, dochádzka (bola/chýbala/zmazať), zmazanie (nie so zapísanou platbou),
 *  - „Zaplatené" ide hneď do Predajov (ručný predaj bez účtu, hotovosť do pokladne), zrušenie ju vezme späť,
 *  - prepojenie s detským profilom: členstvo od dátumu platby, transakcia prejde na dieťa (tržba
 *    sa neráta dvakrát), faktúra rodičovi k dátumu platby, odchodené hodiny skupiny za dochádzku,
 *    návštevy, automatické hodiny skupiny, upozornenie rodičovi; profil sa nedá prepojiť dvakrát,
 *  - dochádzka po prepojení zapisuje hodiny rovno dieťaťu; admin.html má sekciu.
 * Spustenie:  node qa/kids-roster.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4535;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-kids-'));
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };
async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const rd = f => { const p = path.join(DATA, f); if (!fs.existsSync(p)) return []; const m = new Map();
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l.trim()) continue; let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o.$$indexCreated) continue; if (o.$$deleted) { m.delete(o._id); continue; } m.set(o._id, o); } return [...m.values()]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const adm = fs.readFileSync(path.join(ROOT, 'public', 'admin.html'), 'utf8');
  console.log('STATICKÉ');
  ok('admin: sekcia Zumba Kids + menu + funkcie', /id="s-kids"/.test(adm) && /onclick="show\('kids'\)"/.test(adm) && /function loadKids/.test(adm) && /kidsLink\(/.test(adm) && /kidsPaid\(/.test(adm) && /if\(sec==='kids'\)loadKids\(\);/.test(adm));

  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const MES = DNES.slice(0, 7);
  const pm = new Date(+MES.slice(0, 4), +MES.slice(5, 7) - 2, 1);
  const den = n => { const d = new Date(DNES + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
  const D1 = den(-2), D2 = den(0); // dva dni dochádzky (D1 pred dvoma dňami, D2 dnes)
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zak = { rank: 1, is_admin: false, active: true, visit_count: 0, referral_credit: 0, lead_source: 'qa', city: 'Detva' };
  const ADM = 'qaKidAdmin0001', MAMA = 'qaKidMama00001';
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: ADM, name: 'Admin Kids', email: 'qa.kid.admin@qa-biz.local', password: hash, referral_code: 'QAKADM', ...zak, is_admin: true, user_type: 'admin', created_at: '2026-01-01' },
    { _id: MAMA, name: 'Tamara Timková', email: 'qa.kid.mama@qa-biz.local', phone: '0900111777', password: hash, referral_code: 'QAKMAM', sponsor_id: ADM, ...zak, user_type: 'client', created_at: '2026-06-01', free_class_used: true, onboarding_done: true },
  ]));
  const kidsBase = { emoji: '🧒', category: 'Deti', instructor: 'Admin Kids', instructor_id: ADM, location: 'Detva', capacity: 30, price: 9, active: true, created_at: '2026-09-09' };
  // skupina Kids 2 má hodinu v deň D1 aj D2 (dva rôzne dni v týždni, ak sa líšia)
  const cls = [{ _id: 'qaKidK2a', name: 'Zumba Kids 2 (7–14)', day_of_week: dow(D1), time_start: '15:00', time_end: '16:00', ...kidsBase }];
  if (dow(D2) !== dow(D1)) cls.push({ _id: 'qaKidK2b', name: 'Zumba Kids 2 (7–14)', day_of_week: dow(D2), time_start: '15:00', time_end: '16:00', ...kidsBase });
  cls.push({ _id: 'qaKidK1a', name: 'Zumba Kids 1 (4–6)', day_of_week: dow(D1), time_start: '16:00', time_end: '17:00', ...kidsBase });
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky(cls));
  fs.writeFileSync(path.join(DATA, 'monthly_winners.db'), riadky([{ _id: 'qaKidMW01', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'x', user_name: 'x', points: 1, type: 'month', created_at: '2026-01-01' }]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky([
    { _id: 'qaKidSet1', key: 'retro_confirm_v1', value: true, at: '2026-01-01T00:00:00.000Z' }, { _id: 'qaKidSet2', key: 'no_show_from', value: '2026-01-01', at: '2026-01-01T00:00:00.000Z' },
    { _id: 'qaKidSet3', key: 'zumba_kids_hodiny_20260909', value: true, at: '2026-01-01T00:00:00.000Z' }, { _id: 'qaKidSet4', key: 'zumba_kids_casy_20260909b', value: true, at: '2026-01-01T00:00:00.000Z' },
    { _id: 'qaKidSet5', key: 'zumba_kids_prehodenie_20260909c', value: true, at: '2026-01-01T00:00:00.000Z' }, { _id: 'qaKidSet6', key: 'zumba_kids_casy_20260913', value: true, at: '2026-01-01T00:00:00.000Z' }]));

  console.log('\nSERVER — štart…');
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', STRIPE_FAKE: '1' }, stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await sleep(1000); } }
  await sleep(4000);
  try {
    const aj = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.kid.admin@qa-biz.local', password: 'Heslo123!' } }, aj);
    ok('bez prihlásenia zoznam nejde', (await j('/api/kids/roster', {}, {})).status === 401);
    // ── 1) zoznam ──
    const t = await j('/api/admin/kids/roster', { method: 'POST', body: { name: 'Timka', group: 'Kids 2' } }, aj);
    const n = await j('/api/admin/kids/roster', { method: 'POST', body: { name: 'Ninka', group: 'Kids 2' } }, aj);
    ok('pridané dve deti', t.status === 200 && t.d.id && n.status === 200 && n.d.id, JSON.stringify([t.d, n.d]));
    ok('meno kratšie ako 2 znaky → 400', (await j('/api/admin/kids/roster', { method: 'POST', body: { name: 'X' } }, aj)).status === 400);
    const T = t.d.id, N = n.d.id;
    const g = await j('/api/admin/kids/roster/' + N, { method: 'PUT', body: { group: 'Kids 1' } }, aj);
    ok('zmena skupiny', g.status === 200 && rd('kids_roster.db').find(r => r._id === N).group === 'Kids 1');
    await j('/api/admin/kids/roster/' + N, { method: 'PUT', body: { group: 'Kids 2' } }, aj);
    // ── 2) dochádzka ──
    const a1 = await j('/api/kids/roster/' + T + '/attend', { method: 'POST', body: { date: D1, present: true } }, aj);
    const a2 = await j('/api/kids/roster/' + T + '/attend', { method: 'POST', body: { date: D2, present: true } }, aj);
    const a3 = await j('/api/kids/roster/' + N + '/attend', { method: 'POST', body: { date: D1, present: true } }, aj);
    const a4 = await j('/api/kids/roster/' + N + '/attend', { method: 'POST', body: { date: D2, present: false } }, aj);
    ok('dochádzka zapísaná (Timka 2×, Ninka bola/chýbala)', a1.status === 200 && a2.status === 200 && a3.status === 200 && a4.status === 200 && a2.d.attendance[D1] === true && a4.d.attendance[D2] === false, JSON.stringify([a2.d, a4.d]));
    const a5 = await j('/api/kids/roster/' + N + '/attend', { method: 'POST', body: { date: D2, present: null } }, aj);
    ok('zmazanie záznamu dňa', a5.status === 200 && !(D2 in a5.d.attendance));
    await j('/api/kids/roster/' + N + '/attend', { method: 'POST', body: { date: D2, present: false } }, aj);
    ok('neplatný dátum → 400', (await j('/api/kids/roster/' + N + '/attend', { method: 'POST', body: { date: 'včera', present: true } }, aj)).status === 400);
    const list = await j('/api/kids/roster', {}, aj);
    ok('zoznam: dátumy, riadky, žiadny voľný detský profil', list.d.ok && list.d.datumy.length === 2 && list.d.rows.length === 2 && list.d.deti.length === 0, JSON.stringify(list.d.datumy));
    // ── 3) platba ──
    const p = await j('/api/admin/kids/roster/' + T + '/paid', { method: 'POST', body: { amount: 50, method: 'cash', date: D1, plan_id: 'bronze' } }, aj);
    await sleep(300);
    ok('Timka zaplatená (hotovosť, 50 €)', p.status === 200 && p.d.paid && p.d.paid.amount === 50 && p.d.paid.tx_id, JSON.stringify(p.d));
    const tx = rd('transactions.db').find(x => x.kids_roster_id === T);
    ok('platba je v tržbách ako ručný predaj bez účtu (mesiac platby)', tx && tx.type === 'membership' && tx.amount === 50 && tx.payment_method === 'cash' && tx.month === D1.slice(0, 7) && /Timka/.test(tx.client_name) && !tx.user_id, JSON.stringify(tx));
    ok('hotovosť je v pokladni admina', rd('payouts.db').some(x => x._type === 'cash_collected' && x.kids_roster_id === T && x.amount === 50));
    const pred = await j('/api/admin/predaje?from=' + D1.slice(0, 7) + '-01&to=' + D1.slice(0, 7) + '-31', {}, aj);
    ok('Predaje ukazujú Timku (Zumba Kids) · 50 € · hotovosť', (pred.d.rows || []).some(r => /Timka/.test(r.who && r.who.name || '') && r.a === 50 && r.method === 'hotovosť'), JSON.stringify((pred.d.rows || []).map(r => r.who.name + ' ' + r.a + ' ' + r.method)));
    ok('druhá platba bez zrušenia → 400', (await j('/api/admin/kids/roster/' + T + '/paid', { method: 'POST', body: { amount: 50 } }, aj)).status === 400);
    ok('zmazať dieťa so zapísanou platbou → 400', (await j('/api/admin/kids/roster/' + T, { method: 'DELETE' }, aj)).status === 400);
    // zrušenie a znovuzapísanie (prevod)
    const c = await j('/api/admin/kids/roster/' + T + '/paid', { method: 'POST', body: { clear: true } }, aj);
    ok('zrušenie platby vezme tržbu aj pokladňu späť', c.status === 200 && !rd('transactions.db').some(x => x.kids_roster_id === T) && !rd('payouts.db').some(x => x.kids_roster_id === T));
    const p2 = await j('/api/admin/kids/roster/' + T + '/paid', { method: 'POST', body: { amount: 50, method: 'transfer', date: D1, plan_id: 'bronze' } }, aj);
    ok('platba znovu (prevod) bez pokladne', p2.status === 200 && !rd('payouts.db').some(x => x.kids_roster_id === T));
    ok('plán kids sa nedá zapísať', (await j('/api/admin/kids/roster/' + N + '/paid', { method: 'POST', body: { amount: 49.9, plan_id: 'kids' } }, aj)).status === 400);
    // ── 4) prepojenie s detským profilom ──
    const mj = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.kid.mama@qa-biz.local', password: 'Heslo123!' } }, mj);
    const ch = await j('/api/family/children', { method: 'POST', body: { name: 'Timea Timková', birth_date: '2017-02-02' } }, mj);
    ok('mama založila profil dieťaťa', ch.status === 200 && ch.d.id, JSON.stringify(ch.d));
    const list2 = await j('/api/kids/roster', {}, aj);
    ok('zoznam ponúka voľný profil na prepojenie', list2.d.deti.length === 1 && list2.d.deti[0].id === ch.d.id && /Tamara/.test(list2.d.deti[0].parent));
    ok('prepojiť s cudzím id → 400', (await j('/api/admin/kids/roster/' + T + '/link', { method: 'POST', body: { user_id: MAMA } }, aj)).status === 400);
    const lk = await j('/api/admin/kids/roster/' + T + '/link', { method: 'POST', body: { user_id: ch.d.id } }, aj);
    await sleep(800);
    ok('prepojené: členstvo, 2 hodiny, faktúra', lk.status === 200 && lk.d.ok && lk.d.membership && lk.d.bookings === 2 && lk.d.invoice, JSON.stringify(lk.d));
    const mem = rd('memberships.db').find(m => m.user_id === ch.d.id);
    const exp = new Date(D1 + 'T23:59:59Z'); exp.setUTCDate(exp.getUTCDate() + 30);
    ok('členstvo Bronze od dátumu platby na 30 dní', mem && mem.plan_id === 'bronze' && mem.status === 'active' && mem.expires_at.slice(0, 10) === exp.toISOString().slice(0, 10) && mem.payment_method === 'transfer', JSON.stringify(mem && { e: mem.expires_at, pm: mem.payment_method }));
    const tx2 = rd('transactions.db').find(x => x.kids_roster_id === T);
    ok('transakcia prešla na dieťa (bez novej)', tx2 && tx2.user_id === ch.d.id && rd('transactions.db').filter(x => x.kids_roster_id === T).length === 1);
    const inv = rd('invoices.db').find(i => i.user_id === ch.d.id);
    ok('faktúra rodičovi k dátumu platby', inv && inv.client_email === 'qa.kid.mama@qa-biz.local' && /za Timea/.test(inv.client_name) && String(inv.issued_at).slice(0, 10) === D1 && inv.total === 50, JSON.stringify(inv && { e: inv.client_email, n: inv.client_name, d: inv.issued_at }));
    const bks = rd('bookings.db').filter(b => b.user_id === ch.d.id && b.status === 'attended');
    ok('dochádzka prenesená ako odchodené hodiny Kids 2 (' + D1 + ', ' + D2 + ')', bks.length === 2 && bks.every(b => /Kids 2/.test(b.class_name) && b.attendance_source === 'roster' && b.is_child_booking) && bks.some(b => b.booking_date === D1) && bks.some(b => b.booking_date === D2), JSON.stringify(bks.map(b => b.class_name + ' ' + b.booking_date)));
    const dieta = rd('users.db').find(u => u._id === ch.d.id);
    ok('dieťa má 2 návštevy a automatické hodiny skupiny Kids 2', dieta.visit_count === 2 && Array.isArray(dieta.auto_classes) && dieta.auto_classes.length === cls.filter(c => /Kids 2/.test(c.name)).length && dieta.user_type === 'client', JSON.stringify({ v: dieta.visit_count, a: dieta.auto_classes }));
    const pred2 = await j('/api/admin/predaje?from=' + D1.slice(0, 7) + '-01&to=' + D1.slice(0, 7) + '-31', {}, aj);
    const timkaRows = (pred2.d.rows || []).filter(r => /Timea|Timka/.test(r.who && r.who.name || ''));
    ok('tržba sa po prepojení neráta dvakrát (1 riadok, 50 €)', timkaRows.length === 1 && timkaRows[0].a === 50 && timkaRows[0].who.name === 'Timea Timková', JSON.stringify(timkaRows.map(r => r.who.name + ' ' + r.a)));
    const notif = await j('/api/client/notifications', {}, mj);
    ok('rodič dostal upozornenie o prepojení', (notif.d || []).some(x => /je v zozname Zumba Kids/.test(x.title || '')), JSON.stringify((notif.d || []).map(x => x.title)));
    ok('ten istý profil sa nedá prepojiť druhýkrát', (await j('/api/admin/kids/roster/' + N + '/link', { method: 'POST', body: { user_id: ch.d.id } }, aj)).status === 400);
    const list3 = await j('/api/kids/roster', {}, aj);
    const rT = list3.d.rows.find(r => r._id === T);
    ok('zoznam ukazuje prepojenie a rodiča', rT.linked_user_id === ch.d.id && rT.linked_name === 'Timea Timková' && rT.parent_name === 'Tamara Timková' && list3.d.deti.length === 0);
    // dochádzka po prepojení ide rovno dieťaťu
    const D3 = den(7 * (dow(D1) === dow(D1) ? 1 : 1) - 2); // D1 + 7 dní = rovnaký deň v týždni
    const a6 = await j('/api/kids/roster/' + T + '/attend', { method: 'POST', body: { date: den(5), present: true } }, aj);
    await sleep(300);
    const bkPo = rd('bookings.db').filter(b => b.user_id === ch.d.id && b.status === 'attended').length;
    ok('dochádzka po prepojení zapíše hodinu dieťaťu (ak má skupina v ten deň hodinu)', a6.status === 200 && (bkPo === 3 || (dow(den(5)) !== dow(D1) && dow(den(5)) !== dow(D2) && bkPo === 2)), 'hodín ' + bkPo);
    ok('Ninka bez platby sa dá zmazať', (await j('/api/admin/kids/roster/' + N, { method: 'DELETE' }, aj)).status === 200 && rd('kids_roster.db').filter(r => !r.$$deleted).length === 1);
  } catch (e) { failed++; console.log('  ❌ výnimka: ' + e.stack); }
  finally {
    proc.kill();
    console.log('\nZUMBA KIDS ZOZNAM: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 600);
  }
})();
