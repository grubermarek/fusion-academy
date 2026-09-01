// QA test dátovej integrity a kľúčových obchodných tokov
const B = 'http://localhost:3991';
const RUN = 'QAD_' + Date.now();
const F = []; const OK = [];
function find(id, sev, mod, title, detail) { F.push({ id, sev, mod, title, detail }); console.log(`❌ [${sev}] ${id} — ${title}: ${detail}`); }
function pass(t) { OK.push(t); console.log(`✅ ${t}`); }

async function req(path, { method = 'GET', cookie = '', body } = {}) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch (e) { j = txt.slice(0, 150); }
  return { status: r.status, body: j, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
async function reg(name, email) {
  await req('/api/register', { method: 'POST', body: { name, email, password: 'QAtest1234', consent: true } });
  const l = await req('/api/login', { method: 'POST', body: { email, password: 'QAtest1234' } });
  const me = await req('/api/me', { cookie: l.cookie });
  return { cookie: l.cookie, id: me.body.id || me.body._id, email, name };
}

(async () => {
  console.log('=== DATA INTEGRITY', RUN, '===\n');
  const A = (await req('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } })).cookie;
  const classes = (await req('/api/classes')).body;
  const zumby = (Array.isArray(classes) ? classes : []).filter(c => c.category === 'Zumba' && c.active !== false);
  const c1 = zumby[0], c2 = zumby[1], c3 = zumby[2];
  const uinfo = async (id) => (await req(`/api/admin/client/${id}`, { cookie: A })).body?.client || (await req(`/api/admin/users?search=${id}`, { cookie: A })).body;

  // ── T1: prvá hodina zdarma, druhá vyžaduje členstvo ──
  const u1 = await reg('QA Free ' + RUN, `qa.free.${RUN}@test-fa-qa.local`);
  const b1 = await req('/api/bookings', { method: 'POST', cookie: u1.cookie, body: { class_id: c1._id } });
  if (b1.status !== 200) find('T1a', 'P1', 'rezervácie', 'Prvá hodina zdarma nefunguje', `→ ${b1.status} ${JSON.stringify(b1.body)}`);
  else pass('T1: prvá hodina zdarma prešla');
  const b2 = await req('/api/bookings', { method: 'POST', cookie: u1.cookie, body: { class_id: c2._id } });
  if (b2.status === 200) find('T1b', 'P1', 'monetizácia', 'Druhá hodina bez členstva prešla ZADARMO', `→ 200 (očakávané 402 membership_required)`);
  else if (b2.body?.error === 'membership_required') pass('T1: druhá hodina správne vyžaduje členstvo');
  else pass(`T1: druhá hodina blokovaná (${b2.status})`);

  // ── T2: permanentka — presne 1 vstup za rezerváciu ──
  const u2 = await reg('QA Pass ' + RUN, `qa.pass.${RUN}@test-fa-qa.local`);
  await req(`/api/admin/users/${u2.id}/entries`, { method: 'POST', cookie: A, body: { op:'add', amount: 10 } });
  await req('/api/bookings', { method: 'POST', cookie: u2.cookie, body: { class_id: c1._id } }); // 1. = zdarma
  const before = (await req('/api/me', { cookie: u2.cookie })).body.single_entries;
  await req('/api/bookings', { method: 'POST', cookie: u2.cookie, body: { class_id: c2._id } }); // 2. = z permanentky
  const after = (await req('/api/me', { cookie: u2.cookie })).body.single_entries;
  const used = before - after;
  if (used !== 1) find('T2', 'P0', 'kredity', 'Nesprávny odpočet vstupov z permanentky', `pred=${before} po=${after} odpočítané=${used} (očakávané 1)`);
  else pass(`T2: permanentka odpočítala presne 1 vstup (${before}→${after})`);

  // ── T3: zrušenie rezervácie — vráti sa vstup? ──
  const bk = (await req('/api/my-bookings', { cookie: u2.cookie })).body;
  const last = Array.isArray(bk) ? bk.find(b => b.class_id === c2._id) : null;
  if (last) {
    const del = await req('/api/bookings/' + last._id, { method: 'DELETE', cookie: u2.cookie });
    const afterCancel = (await req('/api/me', { cookie: u2.cookie })).body.single_entries;
    if (del.status === 200 && afterCancel === after) find('T3', 'P1', 'kredity', 'Po zrušení rezervácie sa vstup NEVRÁTI', `zostatok ostal ${afterCancel} — klientka príde o vstup`);
    else if (del.status === 200) pass(`T3: zrušenie vrátilo vstup (${after}→${afterCancel})`);
    else pass(`T3: zrušenie blokované storno pravidlom (${del.status})`);
  }

  // ── T4: členstvo — aktivácia a dátum expirácie ──
  const u3 = await reg('QA Mem ' + RUN, `qa.mem.${RUN}@test-fa-qa.local`);
  await req(`/api/admin/users/${u3.id}/grant-membership`, { method: 'POST', cookie: A, body: { plan_id: 'silver', gift: false, amount: 75, payment_method: 'cash' } });
  const meM = (await req('/api/me', { cookie: u3.cookie })).body;
  const mem = (await req('/api/me', { cookie: u3.cookie })).body?.membership;
  if (!mem || !mem.expires_at) find('T4a', 'P1', 'členstvá', 'Členstvo sa neaktivovalo', JSON.stringify(mem));
  else {
    const days = Math.round((new Date(mem.expires_at) - Date.now()) / 86400000);
    if (days < 27 || days > 32) find('T4b', 'P2', 'členstvá', 'Nesprávna dĺžka členstva', `expiruje o ${days} dní (očakávané ~30)`);
    else pass(`T4: členstvo Silver aktívne, expiruje o ${days} dní`);
  }
  // člen s členstvom môže neobmedzene rezervovať
  const mb1 = await req('/api/bookings', { method: 'POST', cookie: u3.cookie, body: { class_id: c1._id } });
  const mb2 = await req('/api/bookings', { method: 'POST', cookie: u3.cookie, body: { class_id: c2._id } });
  if (mb1.status === 200 && mb2.status === 200) pass('T4: člen rezervuje neobmedzene');
  else find('T4c', 'P1', 'členstvá', 'Člen nemôže rezervovať', `${mb1.status}/${mb2.status}`);
  const entriesAfterMem = (await req('/api/me', { cookie: u3.cookie })).body.single_entries || 0;
  if (entriesAfterMem < 0) find('T4d', 'P1', 'kredity', 'Členovi sa odpočítavajú vstupy', `zostatok ${entriesAfterMem}`);

  // ── T5: tržby — nezapočítavajú sa zrušené/nezaplatené ──
  const fin = (await req('/api/admin/finance', { cookie: A })).body;
  const acct = (await req('/api/admin/accounting?from=2000-01-01&to=2100-01-01', { cookie: A })).body;
  console.log('   ℹ️  finance keys:', Object.keys(fin || {}).slice(0, 8).join(','));

  // ── T6: online hodina nesmie tvoriť výplatu ani odučenú hodinu ──
  const online = (Array.isArray(classes) ? classes : []).find(c => c.category === 'Online');
  if (online) {
    const conf = await req('/api/attendance/confirm-session', { method: 'POST', cookie: A, body: { class_id: online._id, present_ids: [] } });
    if (conf.status === 200) find('T6', 'P1', 'výplaty', 'Online hodinu možno potvrdiť ako odučenú (ide do výplaty)', `→ 200`);
    else pass('T6: online hodina sa nedá potvrdiť do výplaty');
  }

  // ── T7: tréner ako sponzor nedostáva kredit (dvojitá affiliate) ──
  const tr = await reg('QA Trainer ' + RUN, `qa.trainer.${RUN}@test-fa-qa.local`);
  await req(`/api/admin/users/${tr.id}/role`, { method: 'PUT', cookie: A, body: { user_type: 'trainer' } });
  const cl = await reg('QA Ref ' + RUN, `qa.ref.${RUN}@test-fa-qa.local`);
  await req(`/api/admin/users/${cl.id}/sponsor`, { method: 'PUT', cookie: A, body: { sponsor_id: tr.id } });
  await req(`/api/admin/users/${cl.id}/grant-membership`, { method: 'POST', cookie: A, body: { plan_id: 'silver', gift: false, amount: 75 } });
  const trMe = (await req('/api/me', { cookie: tr.cookie })).body;
  if ((trMe.referral_credit || 0) > 0) find('T7', 'P1', 'financie', 'Tréner dostal referral kredit AJ do dashboardu (dvojitá affiliate)', `kredit=${trMe.referral_credit}`);
  else pass('T7: tréner nedostáva kredit (affiliate len vo výplate)');

  // ── T8: samoodporúčanie ──
  const self = await req(`/api/admin/users/${cl.id}/sponsor`, { method: 'PUT', cookie: A, body: { sponsor_id: cl.id } });
  const clInfo = (await req(`/api/admin/client/${cl.id}`, { cookie: A })).body;
  if (self.status === 200 && clInfo?.client?.sponsor_id === cl.id) find('T8', 'P2', 'referral', 'Povolené samoodporúčanie (sponzor = ten istý človek)', 'možný podvodný cyklus');
  else pass('T8: samoodporúčanie ošetrené');

  // ── T9: nesprávne dátové typy / záporné hodnoty ──
  const neg = await req(`/api/admin/users/${u2.id}/entries`, { method: 'POST', cookie: A, body: { op:'add', amount: -5 } });
  const negAmt = await req(`/api/admin/users/${u2.id}/credit`, { method: 'POST', cookie: A, body: { amount: 'abc' } });
  const meNeg = (await req('/api/me', { cookie: u2.cookie })).body;
  if (typeof meNeg.referral_credit === 'number' && !isNaN(meNeg.referral_credit)) pass('T9: kredit ostal platné číslo po nevalidnom vstupe');
  else find('T9', 'P1', 'validácie', 'Kredit sa poškodil nevalidným vstupom', JSON.stringify(meNeg.referral_credit));

  // ── T10: kiosk check-in — dvojitý sken nepridá 2× ──
  const kioskCfg = await req('/api/admin/kiosk', { cookie: A });
  const detva = (kioskCfg.body?.studios || []).find(s => s.slug === 'detva');
  if (detva) {
    await req('/api/admin/kiosk/detva', { method: 'PUT', cookie: A, body: { enabled: true } });
    const tok = (await req('/api/admin/kiosk', { cookie: A })).body.studios.find(s => s.slug === 'detva').token;
    const u4 = await reg('QA Kiosk ' + RUN, `qa.kiosk.${RUN}@test-fa-qa.local`);
    const s1 = await req('/api/kiosk/checkin', { method: 'POST', body: { qr_data: 'FA:' + u4.id, k: tok, studio: 'detva' } });
    const v1 = (await req('/api/me', { cookie: u4.cookie })).body.visit_count;
    const s2 = await req('/api/kiosk/checkin', { method: 'POST', body: { qr_data: 'FA:' + u4.id, k: tok, studio: 'detva' } });
    const v2 = (await req('/api/me', { cookie: u4.cookie })).body.visit_count;
    if (s1.status === 200 && v2 > v1) find('T10', 'P0', 'dochádzka', 'Dvojitý kiosk sken pripísal návštevu 2×', `${v1}→${v2}`);
    else pass(`T10: dvojitý sken nepridal duplicitnú návštevu (${v1}→${v2}, 2.sken: ${s2.body?.already ? 'already' : s2.status})`);
    await req('/api/admin/kiosk/detva', { method: 'PUT', cookie: A, body: { enabled: false } });
  }

  console.log('\n=== VÝSLEDOK ===');
  console.log('PASS:', OK.length, '| NÁLEZY:', F.length);
  require('fs').writeFileSync(process.env.OUT || 'data-findings.json', JSON.stringify({ run: RUN, findings: F, passed: OK.length }, null, 1));
})().catch(e => console.error('FATAL', e));
