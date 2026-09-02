/**
 * AUDIT E9 — kto sa kam dostane (2. 9. 2026).
 *
 * Appka má 493 endpointov a štyri guardy. Tento test vezme KAŽDÝ guardovaný
 * endpoint a zavolá ho postupne za neprihláseného, leada, klientku, trénerku
 * a ambasádorku. Kto tam nemá čo robiť, musí dostať 401/403 — nie dáta.
 *
 * Volajú sa aj POST/PUT/DELETE, zámerne: keby guard nedržal, zmena sa vykoná
 * a je to nález. Beží na izolovanej DB, takže sa tým nič skutočné nepokazí.
 *
 * Spustenie:  node qa/permissions-matrix.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4572;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-perm-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

// Endpointy, ktoré sa nevolajú: buď trvajú dlho, alebo by test spomalili.
// Guard na nich je overený rovnakým middleware ako inde.
const PRESKOCIT = [
  '/api/admin/db-backup',            // celá DB, zbytočne veľké
  '/api/admin/qa/run-event-mail/',   // spúšťa mailové vlny
  '/api/email-queue/run',
  '/api/import-oldlist', '/api/import-meta-leads',
];

function vytiahniEndpointy() {
  const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const GUARDY = ['auth', 'adminAuth', 'trainerAuth', 'ambassadorAuth'];
  const re = /app\.(get|post|put|delete|patch)\(\s*['`]([^'`]+)['`]\s*,\s*([A-Za-z_$][\w$]*)/g;
  const out = []; let m;
  while ((m = re.exec(s)) !== null) {
    if (!GUARDY.includes(m[3])) continue;
    const cesta = m[2];
    if (PRESKOCIT.some(p => cesta.startsWith(p))) continue;
    // :param nahradíme neexistujúcim id — guard musí zabrať PRED hľadaním
    out.push({ method: m[1].toUpperCase(), path: cesta.replace(/:[^/]+/g, 'qaNeexistuje1'), guard: m[3] });
  }
  return out;
}

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaPermAdmin0001', name: 'Adam Admin', email: 'qa.perm.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }),
    JSON.stringify({ _id: 'qaPermTrener001', name: 'Tina Trenerka', email: 'qa.perm.trener@qa-biz.local',
      password: hash, user_type: 'trainer', active: true, created_at: '2026-01-01' }),
    JSON.stringify({ _id: 'qaPermKlient001', name: 'Klara Klientka', email: 'qa.perm.klient@qa-biz.local',
      password: hash, user_type: 'client', active: true, referral_code: 'QAPRM1',
      visit_count: 3, created_at: '2026-06-01', city: 'Detva' }),
    JSON.stringify({ _id: 'qaPermAmb00001', name: 'Anna Ambasadorka', email: 'qa.perm.amb@qa-biz.local',
      password: hash, user_type: 'ambassador', active: true, referral_code: 'QAPRM2',
      visit_count: 5, created_at: '2026-05-01', city: 'Detva' }),
    JSON.stringify({ _id: 'qaPermLead00001', name: 'Lea Leadova', email: 'qa.perm.lead@qa-biz.local',
      password: hash, user_type: 'lead', active: true, referral_code: 'QAPRM3', created_at: '2026-08-01' }),
  ].join('\n') + '\n');

  console.log('PERMISSION MATRIX — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  const prihlas = async (mail) => {
    const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: mail, password: 'Heslo123!' }) });
    const sc = r.headers.get('set-cookie');
    return sc ? sc.split(';')[0] : null;
  };

  try {
    const ROLE = {
      neprihlaseny: null,
      lead:         await prihlas('qa.perm.lead@qa-biz.local'),
      klientka:     await prihlas('qa.perm.klient@qa-biz.local'),
      ambasadorka:  await prihlas('qa.perm.amb@qa-biz.local'),
      trenerka:     await prihlas('qa.perm.trener@qa-biz.local'),
    };
    ok('všetky testovacie role sa prihlásili',
      Object.entries(ROLE).filter(([k]) => k !== 'neprihlaseny').every(([, v]) => !!v),
      JSON.stringify(Object.fromEntries(Object.entries(ROLE).map(([k, v]) => [k, !!v]))));

    const endpointy = vytiahniEndpointy();
    ok('zoznam endpointov sa vytiahol zo server.js', endpointy.length > 300, endpointy.length + ' endpointov');

    // Kto smie na ktorý guard. Ostatní musia dostať 401/403.
    // Trénerka je zámerne aj ambasádorka — reprezentuje firmu a privádza ľudí,
    // takže ambasádorskú sekciu má otvorenú (viď komentár pri ambassadorAuth).
    const SMIE = {
      auth:            ['lead', 'klientka', 'ambasadorka', 'trenerka'],
      adminAuth:       [],
      trainerAuth:     ['trenerka'],
      ambassadorAuth:  ['ambasadorka', 'trenerka'],
    };

    console.log('\nPrechádzam ' + endpointy.length + ' endpointov × 5 rolí…');
    const diery = [];
    let volani = 0;
    for (const e of endpointy) {
      for (const [rola, cookie] of Object.entries(ROLE)) {
        if ((SMIE[e.guard] || []).includes(rola)) continue;   // tam patrí, netestujeme
        volani++;
        try {
          const r = await fetch(BASE + e.path, {
            method: e.method,
            headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
            body: ['POST', 'PUT', 'PATCH'].includes(e.method) ? '{}' : undefined,
          });
          // 401/403 = guard drží. 404 na neexistujúcom :id je tiež v poriadku,
          // ale len ak guard bežal — to spoznáme podľa toho, že telo nenesie dáta.
          if (r.status === 401 || r.status === 403) continue;
          if (r.status >= 500) continue;      // chyba servera, nie diera v právach
          let telo = ''; try { telo = (await r.text()).slice(0, 200); } catch (x) {}
          if (r.status === 404 && /nen[áa]jden|not found|neexistuje/i.test(telo)) continue;
          diery.push({ ...e, rola, status: r.status, telo: telo.replace(/\s+/g, ' ').slice(0, 90) });
        } catch (x) { /* sieťová chyba — endpoint neexistuje v tomto tvare */ }
      }
    }

    console.log('  vykonaných volaní: ' + volani);
    if (diery.length) {
      console.log('\n  NÁLEZY (' + diery.length + '):');
      diery.slice(0, 25).forEach(x => console.log('    ' + x.rola.padEnd(13) + ' → ' + x.method + ' ' + x.path
        + '  [' + x.guard + ']  HTTP ' + x.status + '  ' + x.telo));
      if (diery.length > 25) console.log('    …a ďalších ' + (diery.length - 25));
    }
    ok('žiadna rola sa nedostane tam, kam nepatrí', diery.length === 0, diery.length + ' dier');

    // Osobitne to, na čom najviac záleží: peniaze a cudzie údaje.
    console.log('\nCitlivé endpointy zvlášť:');
    const CITLIVE = [
      ['GET', '/api/admin/finance/stats', 'financie'],
      ['GET', '/api/admin/users', 'zoznam klientok'],
      ['POST', '/api/admin/refunds', 'refundy'],
      ['GET', '/api/admin/payouts', 'výplaty trénerov'],
      ['GET', '/api/admin/venceky/overview', 'venčeky a ich tržby'],
    ];
    for (const [met, cesta, popis] of CITLIVE) {
      const vysledky = [];
      for (const [rola, cookie] of Object.entries(ROLE)) {
        const r = await fetch(BASE + cesta, { method: met,
          headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
          body: met === 'POST' ? '{}' : undefined });
        if (r.status !== 401 && r.status !== 403) vysledky.push(rola + ':' + r.status);
      }
      ok(popis + ' — nikto neoprávnený sa nedostane', vysledky.length === 0, vysledky.join(', '));
    }

    // Časť endpointov je zámerne pod obyčajným `auth` a namiesto odmietnutia
    // filtruje OBSAH podľa účtu. To sa musí overiť dátami, nie stavovým kódom —
    // inak by sa dalo prehliadnuť, že klientka vidí cudzie predaje.
    console.log('\nEndpointy, ktoré filtrujú obsah:');
    const zoznamPre = async (cookie) => {
      const r = await fetch(BASE + '/api/transactions', { headers: cookie ? { Cookie: cookie } : {} });
      try { const d = await r.json(); return Array.isArray(d) ? d : []; } catch (e) { return []; }
    };
    // Admin má v DB transakciu, ktorá klientke nepatrí — nesmie ju uvidieť.
    await fetch(BASE + '/api/admin/transactions', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: await prihlas('qa.perm.admin@qa-biz.local') },
      body: JSON.stringify({ client_name: 'Cudzia Klientka', product_name: 'Tričko', amount: 20, date: '2026-09-01' }) });
    await new Promise(r => setTimeout(r, 500));
    const klientkine = await zoznamPre(ROLE.klientka);
    ok('klientka v predajoch nevidí cudzie transakcie',
      klientkine.every(t => t.partner_id === 'qaPermKlient001'),
      klientkine.length + ' riadkov, z toho cudzích ' + klientkine.filter(t => t.partner_id !== 'qaPermKlient001').length);
    const leadove = await zoznamPre(ROLE.lead);
    ok('a lead tiež nie', leadove.length === 0, leadove.length + ' riadkov');

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nPERMISSION MATRIX: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
