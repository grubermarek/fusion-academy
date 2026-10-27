/**
 * Pozvánka na kurz spoločenských tancov pre páry (26. 10. 2026)
 *
 * Iná akcia než párty: kurz za 160 € pre DVOCH a rovnaká cena pre všetkých, takže
 * adresáta neurčuje cena (ako pri Halloweene), ale to, či je to klient. Marek povedal
 * „rozpošli e-maily všetkým klientom" — leady sú preto mimo, ale dajú sa pribrať.
 *
 * Stráži, že:
 *   · pozvánku dostanú klienti, aj tí, čo sú klientmi len cez členstvo alebo permanentku
 *   · leady sú mimo, kým sa výslovne nepriberú (?vsetci=1)
 *   · venčekár, dieťa, odhlásená, bez súhlasu, test a import sú von v oboch rozsahoch
 *   · admin nedostane predajný mail
 *   · náhľad ukáže aj druhé číslo — o koľko by sa to zväčšilo s leadmi
 *   · bez KURZ_GO=1 sa neodošle nič
 *
 * Spustenie:  node qa/kurz-pary-mail.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4646;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-kurz-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts, jar) {
  const headers = { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: (opts && opts.method) || 'GET', headers, body: opts && opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const O_ROK = new Date(Date.now() + 365 * 864e5).toISOString();

(async () => {
  w('users.db', [
    { _id: 'qaKuAdmin00001', name: 'Marek Gruber', email: 'qa.ku.admin@qa-biz.local',
      password: bcrypt.hashSync('Heslo123!', 10), is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },

    // Dostanú
    { _id: 'qaKuKlient0001', name: 'Jana Klientka', email: 'qa.ku.klient@qa-biz.local',
      user_type: 'client', active: true, email_consent: true, created_at: '2026-01-01' },
    { _id: 'qaKuClenstvo01', name: 'Eva Členka', email: 'qa.ku.clenstvo@qa-biz.local',
      user_type: 'member', active: true, email_consent: true,
      membership_plan: 'bronze', membership_expires: O_ROK, created_at: '2026-01-01' },
    { _id: 'qaKuPermanen01', name: 'Petra Permanentková', email: 'qa.ku.perm@qa-biz.local',
      user_type: 'member', active: true, email_consent: true, single_entries: 4, created_at: '2026-01-01' },

    // Len keď sa priberú leady
    { _id: 'qaKuLead000001', name: 'Lucia Leadová', email: 'qa.ku.lead@qa-biz.local',
      user_type: 'lead', active: true, email_consent: true, created_at: '2026-01-01' },

    // Nedostanú nikdy
    { _id: 'qaKuVencek0001', name: 'Vanda Venčeková', email: 'qa.ku.vencek@qa-biz.local',
      user_type: 'lead', active: true, email_consent: true, venceky_role: 'student', created_at: '2026-01-01' },
    { _id: 'qaKuDieta00001', name: 'Detská Dáša', email: 'qa.ku.dieta@qa-biz.local',
      user_type: 'client', active: true, email_consent: true, is_child: true, created_at: '2026-01-01' },
    { _id: 'qaKuOdhlas0001', name: 'Olga Odhlásená', email: 'qa.ku.odhlas@qa-biz.local',
      user_type: 'client', active: true, email_consent: true, offers_optout: true, created_at: '2026-01-01' },
    { _id: 'qaKuBezSuhl001', name: 'Bez Súhlasu', email: 'qa.ku.bezsuhlasu@qa-biz.local',
      user_type: 'client', active: true, email_consent: false, created_at: '2026-01-01' },
    { _id: 'qaKuImport0001', name: 'Importovaná', email: 'qa.ku.import@import.local',
      user_type: 'client', active: true, email_consent: true, created_at: '2026-01-01' },
  ]);

  console.log('KURZ PRE PÁRY — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', KURZ_GO: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 9000));

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.ku.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    console.log('\n1) Len klienti (predvolené):');
    const n = (await j('/api/admin/event/kurz-pary/nahlad', {}, adm)).d || {};
    ok('náhľad sa načítal', n.ok === true, JSON.stringify(n).slice(0, 180));
    ok('rozsah je „len klienti"', n.rozsah === 'len klienti', n.rozsah);
    // klient + členka + permanentka = 3; lead, venčekár, dieťa, odhlásená, bez súhlasu,
    // import a admin sú von
    ok('adresátov je 3', n.pocet === 3, 'je ' + n.pocet + ' — ' + JSON.stringify(n.vynechani));
    ok('ukáže aj číslo s leadmi (4)', n.pocet_keby_aj_leady === 4, String(n.pocet_keby_aj_leady));

    const v = n.vynechani || {};
    ok('lead je mimo výberu', v['lead (mimo výberu)'] >= 1, JSON.stringify(v));
    ok('venčekár je von', v['venčekár (nie je klientka)'] >= 1, JSON.stringify(v));
    ok('dieťa je von', v['detský účet'] >= 1, JSON.stringify(v));
    ok('odhlásená je von', v['odhlásená z mailov'] >= 1, JSON.stringify(v));
    ok('bez súhlasu je von', v['bez súhlasu na e-mail'] >= 1, JSON.stringify(v));
    ok('importovaná adresa je von', v['importovaná adresa bez mailu'] >= 1, JSON.stringify(v));
    ok('admin predajný mail nedostane', v['admin'] >= 1, JSON.stringify(v));

    console.log('\n2) S leadmi:');
    const nv = (await j('/api/admin/event/kurz-pary/nahlad?vsetci=1', {}, adm)).d || {};
    ok('rozsah je „klienti + leady"', nv.rozsah === 'klienti + leady', nv.rozsah);
    ok('adresátov je 4', nv.pocet === 4, 'je ' + nv.pocet + ' — ' + JSON.stringify(nv.vynechani));
    ok('venčekár je von aj tu', (nv.vynechani || {})['venčekár (nie je klientka)'] >= 1, JSON.stringify(nv.vynechani));

    console.log('\n3) Mail samotný:');
    const h = n.ukazka_html || '';
    ok('nesie cenu za pár, nie za osobu', /160 €/.test(h) && /za celý pár/i.test(h), h.slice(0, 120));
    ok('nesie termín a časy', /13\. novembra/.test(h) && /20:00/.test(h));
    ok('nesie odkaz na kurz', /\/event\/kurz-spolocenske-tance-2026/.test(h));
    ok('nesie odhlasovací odkaz', /\/unsubscribe/.test(h));
    ok('hovorí o veľkosti skupiny', /desať párov/.test(h));
    // Marek 27. 10.: ak bude záujem, otvorí sa ďalšia skupina — urgencia by bola nepravdivá.
    ok('netlačí urgenciou', !/posledn|naposledy|už len|neváhaj|ponáhľaj|jediná (šanca|možnosť)/i.test(h), h.slice(0,200));
    ok('nesľubuje zľavu členkám', !/zľav/i.test(h));

    console.log('\n4) Poistka:');
    ok('náhľad hlási zamknutú vlnu', n.go_flag === false, String(n.go_flag));
    const bezGo = await j('/api/admin/event/kurz-pary/odoslat', { method: 'POST', body: { potvrdit: true } }, adm);
    ok('bez KURZ_GO sa neodošle nič (409)', bezGo.status === 409, JSON.stringify(bezGo.d));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nKURZ PRE PÁRY: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-900));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
