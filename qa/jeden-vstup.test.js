/**
 * Jeden vstup do appky (18. 10. 2026)
 *
 * Do 18. 10. viedli do appky štyri registrácie v troch dizajnoch: /prva-hodina,
 * /invite/:code, úvod appky a sedem aliasov. Kým beží prvý týždeň zadarmo, /invite
 * v poslednom kroku rezerváciu odmietol (410) a klientku prehodil na úvod appky —
 * vybrané mesto aj termín sa stratili. Odteraz všetko vedie na /prva-hodina a kód
 * pozvánky ide so sebou ako ?ref=.
 *
 * Stráži, že:
 *   · /invite/KÓD, /invite a všetkých sedem aliasov presmeruje na /prva-hodina
 *   · kód pozvánky prežije presmerovanie (?ref=) aj s ostatnými značkami z reklamy
 *   · odkaz na správu rezervácie (/invite/KÓD?manage=…) z mailu ostáva funkčný
 *   · rezervácia s ?ref= priradí pozývajúcu ako sponzora, zapíše odporúčanie a dá jej oznam
 *   · rezervácia bez pozvánky dostane zakladateľa ako sponzora (nie null ako predtým)
 *   · pozvánka na vlastný e-mail sa neuzná (nikto nepozve sám seba)
 *   · landing vie vypísať meno pozývajúcej (banner „Pozvala ťa …")
 *
 * Spustenie:  node qa/jeden-vstup.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4617;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-vstup-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const jar = {};
const cookieHdr = () => Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
const j = async (url, opts = {}) => {
  const r = await fetch(BASE + url, { redirect: 'manual', headers: { 'Content-Type': 'application/json', 'Cookie': cookieHdr(), ...(opts.headers || {}) }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); });
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d, loc: r.headers.get('location') || '', headers: r.headers };
};
// NeDB je append-only: ten istý dokument je v súbore po každom update znova,
// takže sa musí brať posledná verzia podľa _id.
const rd = f => { const p = path.join(DATA, f); if (!fs.existsSync(p)) return []; const m = new Map();
  fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (o._id) m.set(o._id, o); } catch (e) {} });
  return [...m.values()]; };

(async () => {
  // Pozývajúca s pevným kódom — na nej sa overuje, že pozvánka naozaj priradí sponzora.
  fs.writeFileSync(path.join(DATA, 'users.db'), [JSON.stringify({
    _id: 'qaVstupEva', name: 'Eva Pozývajúca', email: 'qa.vstup.eva@qa-biz.local',
    referral_code: 'QAEVA75', rank: 1, is_admin: false, active: true, user_type: 'client',
    visit_count: 0, referral_credit: 0, created_at: '2026-01-01',
  })].join('\n') + '\n');

  console.log('JEDEN VSTUP — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', PRVY_TYZDEN: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 9000));

  try {
    console.log('\n1) Staré vstupy vedú na jeden:');
    const inv = await j('/invite/QAEVA75');
    ok('/invite/KÓD presmeruje na /prva-hodina', inv.status === 302 && inv.loc.startsWith('/prva-hodina'), inv.status + ' → ' + inv.loc);
    ok('…a kód pozvánky ide so sebou', /[?&]ref=QAEVA75(&|$)/.test(inv.loc), inv.loc);

    const sZnackami = await j('/invite/QAEVA75?utm_source=fb&utm_campaign=fa-zumba-skuska-2610&city=detva');
    ok('značky z reklamy presmerovanie prežijú',
      /utm_source=fb/.test(sZnackami.loc) && /utm_campaign=fa-zumba-skuska-2610/.test(sZnackami.loc)
      && /city=detva/.test(sZnackami.loc) && /ref=QAEVA75/.test(sZnackami.loc), sZnackami.loc);

    const holy = await j('/invite');
    ok('/invite bez kódu tiež vedie na /prva-hodina', holy.status === 302 && holy.loc.startsWith('/prva-hodina'), holy.status + ' → ' + holy.loc);

    const aliasy = ['/registracia', '/register', '/signup', '/sign-up', '/vitaj', '/zaciatok', '/start'];
    const vysl = [];
    for (const a of aliasy) { const r = await j(a); vysl.push(a + ':' + r.status + (r.loc ? ' ' + r.loc : '')); }
    ok('všetkých 7 aliasov vedie na /prva-hodina',
      vysl.every(v => v.includes('302 /prva-hodina')), vysl.join(' | '));

    const refAlias = await j('/registracia?ref=QAEVA75');
    ok('alias si tiež nesie kód pozvánky', /ref=QAEVA75/.test(refAlias.loc), refAlias.loc);

    console.log('\n2) Správa rezervácie z mailu ostáva:');
    const manage = await j('/invite/QAEVA75?manage=MGTEST123');
    ok('/invite/KÓD?manage=… sa stále zobrazí (200, nie presmerovanie)', manage.status === 200, 'HTTP ' + manage.status + ' ' + manage.loc);

    console.log('\n3) Landing pozná pozývajúcu:');
    const info = await j('/api/invite/QAEVA75/info');
    ok('API vráti krstné meno pozývajúcej', info.status === 200 && info.d && info.d.inviter === 'Eva', JSON.stringify(info.d).slice(0, 120));
    const lp = await j('/prva-hodina?ref=QAEVA75');
    ok('/prva-hodina sa načíta aj s pozvánkou', lp.status === 200);

    console.log('\n4) Rezervácia cez pozvánku:');
    const sc = await j('/api/first-class/schedule');
    const sess = ((sc.d && sc.d.items) || [])[0];
    ok('rozvrh ponúka termín', !!sess, JSON.stringify(sc.d).slice(0, 120));
    const bk = await j('/api/first-class/book', { method: 'POST', body: {
      name: 'Nina Pozvaná', kontakt: 'qa.vstup.nina@qa-biz.local', ref: 'QAEVA75',
      class_id: sess.class_id, booking_date: sess.date,
      attribution: { utm_source: 'fb', utm_campaign: 'qa-vstup' } } });
    ok('rezervácia cez pozvánku prešla', bk.status === 200 && bk.d && bk.d.ok !== false, JSON.stringify(bk.d).slice(0, 160));

    const nina = rd('users.db').find(u => u.email === 'qa.vstup.nina@qa-biz.local');
    ok('pozvaná má pozývajúcu ako sponzora', !!nina && nina.sponsor_id === 'qaVstupEva', JSON.stringify({ s: (nina || {}).sponsor_id }));
    ok('zdroj kontaktu je „referral"', !!nina && nina.lead_source === 'referral', (nina || {}).lead_source);
    ok('odporúčanie je zapísané (referral_events)',
      rd('referral_events.db').some(e => e.sponsor_id === 'qaVstupEva' && e.type === 'booked'),
      JSON.stringify(rd('referral_events.db').map(e => e.type)));
    ok('pozývajúca dostala oznam',
      rd('notifications.db').some(n => n.user_id === 'qaVstupEva' && /pozv[áa]nka/i.test(n.title || '')),
      JSON.stringify(rd('notifications.db').filter(n => n.user_id === 'qaVstupEva').map(n => n.title)));

    console.log('\n5) Rezervácia bez pozvánky:');
    const sc2 = await j('/api/first-class/schedule');
    const sess2 = ((sc2.d && sc2.d.items) || [])[0];
    const bk2 = await j('/api/first-class/book', { method: 'POST', body: {
      name: 'Sara Bezpozvanky', kontakt: 'qa.vstup.sara@qa-biz.local',
      class_id: sess2.class_id, booking_date: sess2.date } });
    ok('rezervácia bez pozvánky prešla', bk2.status === 200, JSON.stringify(bk2.d).slice(0, 160));
    const sara = rd('users.db').find(u => u.email === 'qa.vstup.sara@qa-biz.local');
    const zakladatel = rd('users.db').find(u => u.email === 'gruber.marek@gmail.com');
    ok('bez pozvánky pripadne sponzorstvo zakladateľovi (nie null)',
      !!sara && !!zakladatel && sara.sponsor_id === zakladatel._id,
      JSON.stringify({ s: (sara || {}).sponsor_id, z: (zakladatel || {})._id }));

    console.log('\n6) Pozvánka sama na seba:');
    const sc3 = await j('/api/first-class/schedule');
    const sess3 = ((sc3.d && sc3.d.items) || [])[0];
    const bk3 = await j('/api/first-class/book', { method: 'POST', body: {
      name: 'Eva Pozývajúca', kontakt: 'qa.vstup.eva@qa-biz.local', ref: 'QAEVA75',
      class_id: sess3.class_id, booking_date: sess3.date } });
    const eva = rd('users.db').find(u => u._id === 'qaVstupEva');
    ok('nikto sa nestane sponzorom sám sebe', !eva || eva.sponsor_id !== 'qaVstupEva',
      JSON.stringify({ http: bk3.status, s: (eva || {}).sponsor_id }));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nJEDEN VSTUP: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-900));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
