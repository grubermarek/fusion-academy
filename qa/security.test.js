// QA bezpečnostný test — IDOR / privilege escalation / validácie
// Všetky vytvorené záznamy nesú test_run_id a doménu @test-fa-qa.local
const B = 'http://localhost:3991';
const RUN = 'QA_' + Date.now();
const F = [];   // findings
const OK = [];  // passed checks

function find(id, sev, mod, title, detail) { F.push({ id, sev, mod, title, detail }); console.log(`❌ [${sev}] ${id} ${title} — ${detail}`); }
function pass(t) { OK.push(t); console.log(`✅ ${t}`); }

async function req(path, { method = 'GET', cookie = '', body } = {}) {
  const r = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  let j = null; const txt = await r.text();
  try { j = JSON.parse(txt); } catch (e) { j = txt.slice(0, 120); }
  return { status: r.status, body: j, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
async function reg(name, email) {
  await req('/api/register', { method: 'POST', body: { name, email, password: 'QAtest1234', phone: '', consent: true } });
  const l = await req('/api/login', { method: 'POST', body: { email, password: 'QAtest1234' } });
  const me = await req('/api/me', { cookie: l.cookie });
  return { cookie: l.cookie, id: me.body.id || me.body._id, email, name };
}

(async () => {
  console.log('=== TEST RUN', RUN, '===\n');
  // ── aktéri ──
  const admin = await req('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } });
  const A = admin.cookie;
  const alice = await reg('QA Alice ' + RUN, `qa.alice.${RUN}@test-fa-qa.local`);
  const mallory = await reg('QA Mallory ' + RUN, `qa.mallory.${RUN}@test-fa-qa.local`);
  console.log('actors ready: alice=%s mallory=%s\n', alice.id, mallory.id);

  // ═══ 1. IDOR: čítanie cudzích dát ═══
  const idorTargets = [
    ['GET', `/api/admin/client/${alice.id}`, 'detail klienta (financie, LTV)'],
    ['GET', `/api/user-profile/${alice.id}`, 'rozšírený profil'],
    ['GET', `/api/admin/users`, 'zoznam všetkých klientov'],
    ['GET', `/api/admin/payouts`, 'výplaty trénerov'],
    ['GET', `/api/admin/finance`, 'financie'],
    ['GET', `/api/admin/campaigns`, 'kampane'],
    ['GET', `/api/admin/winback`, 'odídení klienti (kontakty)'],
    ['GET', `/api/admin/kiosk`, 'kiosk tokeny'],
    ['GET', `/api/admin/meta-stats`, 'Meta štatistiky'],
    ['GET', `/api/trainer/earnings`, 'zárobky trénera'],
    ['GET', `/api/trainer/cash`, 'hotovosť trénera'],
    ['GET', `/api/trainer/sell-options`, 'predajný katalóg'],
    ['GET', `/api/attendance/schedule`, 'rozvrh s dochádzkou'],
    ['GET', `/api/admin/audit`, 'auditné logy'],
    ['GET', `/api/admin/settings`, 'systémové nastavenia'],
  ];
  for (const [m, path, label] of idorTargets) {
    const r = await req(path, { method: m, cookie: mallory.cookie });
    if (r.status === 200) find('SEC-' + path, 'P0', 'authz', `Klient vidí ${label}`, `${m} ${path} → 200 pre bežného klienta`);
    else pass(`${label} chránené (${r.status})`);
  }

  // ═══ 2. Privilege escalation: zmena vlastných dát ═══
  const escalations = [
    ['POST', `/api/admin/users/${mallory.id}/credit`, { amount: 999 }, 'pridanie kreditu sebe'],
    ['POST', `/api/admin/users/${mallory.id}/entries`, { entries: 50 }, 'pridanie vstupov sebe'],
    ['POST', `/api/admin/users/${mallory.id}/grant-membership`, { plan_id: 'gold', gift: true }, 'darovanie členstva sebe'],
    ['PUT', `/api/admin/users/${mallory.id}/role`, { user_type: 'trainer' }, 'povýšenie na trénera'],
    ['PUT', `/api/admin/users/${mallory.id}/awards`, { manual_achievements: ['founder'] }, 'pridanie odznakov'],
    ['POST', `/api/trainer/sell`, { user_id: mallory.id, kind: 'plan', plan_id: 'gold', amount: 0 }, 'predaj členstva sebe za 0 €'],
    ['POST', `/api/trainer/cash`, { amount: 100 }, 'zápis hotovosti (výplata)'],
    ['PUT', `/api/admin/kiosk/detva`, { enabled: true }, 'zapnutie kiosku'],
    ['POST', `/api/admin/campaigns`, { name: 'QA hack' }, 'vytvorenie kampane'],
  ];
  for (const [m, path, body, label] of escalations) {
    const r = await req(path, { method: m, cookie: mallory.cookie, body });
    if (r.status < 300) find('ESC-' + path, 'P0', 'authz', `Klient môže: ${label}`, `${m} ${path} → ${r.status}`);
    else pass(`Blokované: ${label} (${r.status})`);
  }

  // ═══ 3. IDOR: zásah do CUDZIEHO účtu (Mallory → Alice) ═══
  const cross = [
    ['POST', `/api/admin/users/${alice.id}/credit`, { amount: -999 }, 'odobratie kreditu cudziemu'],
    ['POST', `/api/admin/users/${alice.id}/reset-password`, {}, 'reset hesla cudziemu'],
    ['DELETE', `/api/admin/users/${alice.id}`, undefined, 'zmazanie cudzieho účtu'],
    ['PUT', `/api/admin/users/${alice.id}/sponsor`, { sponsor_id: mallory.id }, 'prepísanie sponzora (krádež provízií)'],
  ];
  for (const [m, path, body, label] of cross) {
    const r = await req(path, { method: m, cookie: mallory.cookie, body });
    if (r.status < 300) find('IDOR-' + path, 'P0', 'authz', `Klient môže: ${label}`, `${m} ${path} → ${r.status}`);
    else pass(`Blokované: ${label} (${r.status})`);
  }

  // ═══ 4. Neprihlásený prístup ═══
  for (const [m, path, label] of idorTargets.slice(0, 8)) {
    const r = await req(path, { method: m });
    if (r.status === 200) find('ANON-' + path, 'P0', 'authz', `Neprihlásený vidí ${label}`, `${m} ${path} → 200`);
  }
  pass('Neprihlásený prístup otestovaný');

  // ═══ 5. Spin (koleso) — manipulácia ═══
  const s1 = await req('/api/spin', { method: 'POST', cookie: mallory.cookie, body: {} });
  const s2 = await req('/api/spin', { method: 'POST', cookie: mallory.cookie, body: {} });
  if (s2.status < 300) find('SPIN-DUP', 'P1', 'gamifikácia', 'Koleso sa dá točiť viackrát denne', `2. pokus → ${s2.status}`);
  else pass('Koleso: druhé točenie blokované');
  const s3 = await req('/api/spin', { method: 'POST', cookie: mallory.cookie, body: { test: true } });
  if (s3.status < 300) find('SPIN-TEST', 'P1', 'gamifikácia', 'Klient môže spustiť admin TEST režim kolesa', `test:true → ${s3.status}`);
  else pass('Koleso: test režim len pre admina');

  // ═══ 6. Rezervácie — duplicita, kapacita, cudzie zrušenie ═══
  const cls = await req('/api/classes');
  const zumba = (Array.isArray(cls.body) ? cls.body : []).find(c => (c.category || '') === 'Zumba' && c.active !== false);
  if (zumba) {
    const b1 = await req('/api/bookings', { method: 'POST', cookie: alice.cookie, body: { class_id: zumba._id } });
    const b2 = await req('/api/bookings', { method: 'POST', cookie: alice.cookie, body: { class_id: zumba._id } });
    if (b2.status < 300) find('BOOK-DUP', 'P1', 'rezervácie', 'Duplicitná rezervácia na tú istú hodinu', `2. rezervácia → ${b2.status}`);
    else pass('Rezervácie: duplicita blokovaná');
    // súbežné rezervácie (race condition)
    const par = await Promise.all([0, 1, 2].map(() => req('/api/bookings', { method: 'POST', cookie: mallory.cookie, body: { class_id: zumba._id } })));
    const okCount = par.filter(r => r.status < 300).length;
    if (okCount > 1) find('BOOK-RACE', 'P1', 'rezervácie', 'Race condition: súbežné rezervácie vytvoria duplicity', `${okCount}/3 uspelo naraz`);
    else pass('Rezervácie: súbežné požiadavky ošetrené');
    // zrušenie cudzej rezervácie
    if (b1.body && b1.body.id) {
      const del = await req('/api/bookings/' + b1.body.id, { method: 'DELETE', cookie: mallory.cookie });
      if (del.status < 300) find('BOOK-IDOR', 'P0', 'rezervácie', 'Klient zruší CUDZIU rezerváciu', `DELETE → ${del.status}`);
      else pass('Rezervácie: cudzia rezervácia chránená');
    }
  } else console.log('⚠️  žiadna Zumba hodina na test rezervácií');

  // ═══ 7. Validácie vstupov ═══
  const v = [
    ['/api/register', { name: 'x', email: 'nie-je-email', password: 'QAtest1234' }, 'neplatný email'],
    ['/api/register', { name: 'x', email: `qa.short.${RUN}@test-fa-qa.local`, password: '12' }, 'krátke heslo'],
    ['/api/register', { name: '', email: `qa.noname.${RUN}@test-fa-qa.local`, password: 'QAtest1234' }, 'prázdne meno'],
    ['/api/register', { name: 'A'.repeat(5000), email: `qa.long.${RUN}@test-fa-qa.local`, password: 'QAtest1234' }, 'extrémne dlhé meno (5000 zn.)'],
  ];
  for (const [path, body, label] of v) {
    const r = await req(path, { method: 'POST', body });
    if (r.status < 300) find('VAL-' + label, 'P2', 'validácie', `Prijatý neplatný vstup: ${label}`, `${path} → ${r.status}`);
    else pass(`Validácia funguje: ${label}`);
  }
  // duplicitný email
  const dup = await req('/api/register', { method: 'POST', body: { name: 'QA Dup', email: alice.email, password: 'QAtest1234' } });
  if (dup.status < 300) find('VAL-DUPEMAIL', 'P1', 'validácie', 'Registrácia s existujúcim emailom prešla', `→ ${dup.status}`);
  else pass('Validácia: duplicitný email blokovaný');

  // ═══ 8. XSS / injection ═══
  const xss = '<img src=x onerror=alert(1)>';
  const px = await req('/api/profile', { method: 'PUT', cookie: alice.cookie, body: { name: 'QA' + xss, status: xss } });
  const prof = await req('/api/profile/' + alice.id, { cookie: mallory.cookie });
  const raw = JSON.stringify(prof.body || '');
  if (raw.includes('onerror=')) find('XSS-STORED', 'P1', 'bezpečnosť', 'Uložený XSS payload v profile (nie je sanitizovaný na vstupe)', 'kontrola: escapuje sa aspoň na výstupe v HTML?');
  else pass('XSS: payload sa neuložil neescapovaný');

  // ═══ 9. Brute force ═══
  const bf = [];
  for (let i = 0; i < 12; i++) bf.push(await req('/api/login', { method: 'POST', body: { email: alice.email, password: 'zle' + i } }));
  const blocked = bf.some(r => r.status === 429 || (typeof r.body === 'object' && /blok|pokus|neskôr|limit/i.test(JSON.stringify(r.body))));
  if (!blocked) find('BF-LOGIN', 'P1', 'bezpečnosť', 'Chýba rate limiting na prihlásení', '12 neúspešných pokusov za sebou bez blokácie');
  else pass('Brute force: prihlásenie limitované');

  // ═══ 10. Bezpečnostné hlavičky ═══
  const h = await fetch(B + '/');
  const need = ['x-frame-options', 'x-content-type-options', 'content-security-policy', 'strict-transport-security'];
  const missing = need.filter(n => !h.headers.get(n));
  if (missing.length) find('HDR', 'P2', 'bezpečnosť', 'Chýbajú bezpečnostné hlavičky', missing.join(', '));
  else pass('Bezpečnostné hlavičky prítomné');

  console.log('\n=== VÝSLEDOK ===');
  console.log('PASS:', OK.length, ' | NÁLEZY:', F.length);
  console.log(JSON.stringify({ run: RUN, findings: F }, null, 1));
  require('fs').writeFileSync(process.env.OUT || 'findings.json', JSON.stringify({ run: RUN, actors: [alice.id, mallory.id], findings: F, passed: OK.length }, null, 1));
})().catch(e => console.error('FATAL', e));
