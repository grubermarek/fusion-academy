/**
 * AUDIT E4 — číslovanie faktúr pri súbehu (Marek 1. 9.).
 *
 * nextInvoiceNumber() číta všetky faktúry, spočíta poradie a zapíše — bez zámku.
 * NeDB transakcie nemá, takže dve súbežné platby môžu dostať rovnaké číslo.
 * V produkčných dátach zatiaľ žiadny duplikát nie je (87 faktúr, rad bez medzier),
 * ale to nie je dôkaz, že tam nikdy nebude.
 *
 * Test spustí naraz 20 predajov a pozrie sa, či:
 *   · nevznikne duplicitné číslo faktúry
 *   · nevznikne platba bez dokladu (unikátny index by druhý zápis odmietol)
 *
 * Spustenie:  node qa/invoice-numbering.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4558;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-inv-'));
const POCET = 20;

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
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const ucty = [JSON.stringify({ _id: 'qaInvAdmin00001', name: 'Adam Admin', email: 'qa.inv.admin@qa-biz.local',
    password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' })];
  for (let i = 1; i <= POCET; i++) {
    ucty.push(JSON.stringify({ _id: 'qaInvKli' + String(i).padStart(7, '0'), name: 'Klientka ' + i,
      email: 'qa.inv.k' + i + '@qa-biz.local', password: hash, user_type: 'client', active: true,
      referral_code: 'QAINV' + String(i).padStart(2, '0'), visit_count: 1, created_at: '2026-06-01', city: 'Detva' }));
  }
  fs.writeFileSync(path.join(DATA, 'users.db'), ucty.join('\n') + '\n');

  console.log('ČÍSLOVANIE FAKTÚR QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.inv.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    const predFa = rd('invoices.db').length;

    console.log('\n' + POCET + ' súbežných predajov naraz:');
    const vysledky = await Promise.all(Array.from({ length: POCET }, (_, i) =>
      j('/api/admin/users/qaInvKli' + String(i + 1).padStart(7, '0') + '/grant-membership',
        { method: 'POST', body: { plan_id: 'bronze', gift: false, payment_method: 'cash', amount: 50 } }, adm)
        .catch(e => ({ status: 0, d: { error: e.message } }))));

    const uspesne = vysledky.filter(v => v.status === 200 && v.d && (v.d.ok !== false)).length;
    ok('všetkých ' + POCET + ' požiadaviek prešlo', uspesne === POCET,
      uspesne + '/' + POCET + '  ' + JSON.stringify(vysledky.filter(v => v.status !== 200).slice(0, 3).map(v => v.status + ':' + JSON.stringify(v.d).slice(0, 60))));

    await new Promise(r => setTimeout(r, 1500));
    const fa = rd('invoices.db');
    const nove = fa.length - predFa;
    console.log('  (vzniklo faktúr: ' + nove + ')');

    const cisla = fa.map(i => String(i.number));
    const duplicity = cisla.filter((n, i) => cisla.indexOf(n) !== i);
    ok('žiadne duplicitné číslo faktúry', duplicity.length === 0,
      duplicity.length ? [...new Set(duplicity)].join(', ') : '');

    ok('každá faktúra má číslo', fa.every(i => i.number && String(i.number).length >= 6),
      JSON.stringify(fa.filter(i => !i.number).length) + ' bez čísla');

    // Kľúčové: keď unikátny index odmietne druhý zápis, vznikne PLATBA BEZ DOKLADU.
    const clenstva = rd('memberships.db').filter(m => !m._type);
    ok('ku každému predaju vznikla faktúra', nove >= clenstva.length,
      'členstiev ' + clenstva.length + ' vs nových faktúr ' + nove);

    const poradia = cisla.filter(n => /^\d{8}$/.test(n)).map(n => +n.slice(4)).sort((a, b) => a - b);
    const medzery = [];
    for (let k = 1; k < (poradia[poradia.length - 1] || 0); k++) if (!poradia.includes(k)) medzery.push(k);
    ok('číselný rad je bez medzier', medzery.length === 0,
      medzery.length ? 'chýba ' + medzery.slice(0, 8).join(', ') : '');

    console.log('\nČo z toho vyplýva:');
    console.log('  rad: ' + (cisla.sort()[0] || '—') + ' … ' + (cisla.sort()[cisla.length - 1] || '—'));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nČÍSLOVANIE FAKTÚR: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
