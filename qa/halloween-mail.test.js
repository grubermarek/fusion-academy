/**
 * Pozvánka na Halloweensku Zumba Party — komu smie odísť (25. 10. 2026)
 *
 * Pozvánka na akciu, ktorú si človek nevie kúpiť, je horšia než žiadna pozvánka.
 * Preto sa adresát neurčuje podľa „má členstvo", ale podľa toho, či mu
 * planPrice() vráti cenu — tým istým výpočtom, aký vidí na stránke eventu.
 * Skúšobný týždeň zadarmo je tiež členstvo, ale členskú cenu nedáva.
 *
 * Stráži, že:
 *   · Bronze, Silver, Gold a permanentka dostanú pozvánku so SVOJOU cenou
 *   · žena na týždni zadarmo, venčekár, dieťa, odhlásená, bez súhlasu,
 *     bez členstva, testovací a importovaný účet ju NEDOSTANÚ
 *   · dôvod vynechania sa dá prečítať (aby bolo vidieť, koho a prečo to minulo)
 *   · bez HALLOWEEN_GO=1 sa neodošle nič, ani s admin právami
 *   · druhý beh nikomu nepošle pozvánku dvakrát
 *   · mail nesie odhlasovací odkaz
 *
 * Spustenie:  node qa/halloween-mail.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4642;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-hw-'));

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
const ZAJTRA = new Date(Date.now() + 864e5).toISOString();

// Spoločný základ: klientka so súhlasom na e-mail
const klient = (id, meno, email, extra) => ({
  _id: 'qaHw' + id, name: meno, email, user_type: 'client', active: true,
  email_consent: true, created_at: '2026-01-01', ...extra,
});
const sClenstvom = plan => ({ membership_plan: plan, membership_expires: O_ROK });

(async () => {
  w('users.db', [
    { _id: 'qaHwAdmin00001', name: 'Marek Gruber', email: 'qa.hw.admin@qa-biz.local',
      password: bcrypt.hashSync('Heslo123!', 10), is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },

    // Majú dostať
    klient('Bronze01', 'Jana Bronzová', 'qa.hw.bronze@qa-biz.local', sClenstvom('bronze')),
    klient('Silver01', 'Eva Strieborná', 'qa.hw.silver@qa-biz.local', sClenstvom('silver')),
    klient('Gold0001', 'Zlata Zlatá', 'qa.hw.gold@qa-biz.local', sClenstvom('gold')),
    klient('Perman01', 'Petra Permanentková', 'qa.hw.perm@qa-biz.local', { single_entries: 6 }),

    // Nemajú dostať
    klient('Skuska01', 'Skúšobná Sofia', 'qa.hw.skuska@qa-biz.local',
      { ...sClenstvom('bronze'), trial_ends_at: ZAJTRA }),
    klient('Vencek01', 'Venčeková Vanda', 'qa.hw.vencek@qa-biz.local',
      { single_entries: 4, user_type: 'lead', venceky_role: 'student' }),
    klient('Dieta001', 'Detská Dáša', 'qa.hw.dieta@qa-biz.local',
      { ...sClenstvom('bronze'), is_child: true }),
    klient('Odhlas01', 'Odhlásená Olga', 'qa.hw.odhlas@qa-biz.local',
      { ...sClenstvom('silver'), offers_optout: true }),
    klient('BezSuhl1', 'Bez Súhlasu', 'qa.hw.bezsuhlasu@qa-biz.local',
      { ...sClenstvom('gold'), email_consent: false }),
    klient('BezClen1', 'Bez Členstva', 'qa.hw.bezclenstva@qa-biz.local', {}),
    // Pozor: účty @test-fa-qa.local appka pri štarte maže (cleanup_qa_online_test_v1),
    // takže by sa do filtra ani nedostal. Tú istú vetvu overíme príznakom is_test.
    klient('Test0001', 'Testovacia', 'qa.hw.test@qa-biz.local', { ...sClenstvom('bronze'), is_test: true }),
    klient('Import01', 'Importovaná', 'qa.hw.import@import.local', sClenstvom('bronze')),
  ]);

  console.log('POZVÁNKA NA HALLOWEEN — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', HALLOWEEN_GO: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 9000));

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.hw.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    console.log('\n1) Kto pozvánku dostane:');
    const n = (await j('/api/admin/event/halloween/nahlad', {}, adm)).d || {};
    ok('náhľad sa načítal', n.ok === true, JSON.stringify(n).slice(0, 200));
    ok('adresátov je presne 4', n.pocet === 4, 'je ich ' + n.pocet + ' — ' + JSON.stringify(n.podla_urovne));
    const u = n.podla_urovne || {};
    ok('Bronze má cenu 10 €', u['Bronze · 10 €'] === 1, JSON.stringify(u));
    ok('Silver má cenu 5 €', u['Silver · 5 €'] === 1, JSON.stringify(u));
    ok('Gold má cenu 5 €', u['Gold · 5 €'] === 1, JSON.stringify(u));
    ok('Permanentka má cenu 15 €', u['Permanentka · 15 €'] === 1, JSON.stringify(u));

    console.log('\n2) Koho to má minúť a prečo:');
    const v = n.vynechani || {};
    ok('žena na týždni zadarmo je vynechaná', v['má len týždeň zadarmo'] >= 1, JSON.stringify(v));
    ok('venčekár je vynechaný', v['venčekár (nie je klientka)'] >= 1, JSON.stringify(v));
    ok('detský účet je vynechaný', v['detský účet'] >= 1, JSON.stringify(v));
    ok('odhlásená je vynechaná', v['odhlásená z mailov'] >= 1, JSON.stringify(v));
    ok('bez súhlasu je vynechaná', v['bez súhlasu na e-mail'] >= 1, JSON.stringify(v));
    ok('bez členstva je vynechaná', v['bez členstva aj permanentky'] >= 1, JSON.stringify(v));
    ok('testovací účet je vynechaný', v['testovací účet'] >= 1, JSON.stringify(v));
    ok('importovaná adresa je vynechaná', v['importovaná adresa bez mailu'] >= 1, JSON.stringify(v));

    console.log('\n3) Mail samotný:');
    const h = n.ukazka_html || '';
    ok('ukážka mailu existuje', h.length > 200);
    ok('nesie odhlasovací odkaz', /\/unsubscribe/.test(h));
    ok('nesie odkaz na kúpu lístka', /\/event\/halloween-zumba-2026/.test(h));
    ok('píše, že vstup je len v maske', /len v maske/i.test(h));
    ok('nesie konkrétnu cenu', /\d+ €/.test(h));
    ok('predmet je jednoznačný', /Halloweenska Zumba Party/.test(n.predmet || ''));

    console.log('\n4) Poistka proti odoslaniu:');
    ok('náhľad hlási, že vlna je zamknutá', n.go_flag === false, String(n.go_flag));
    const bezGo = await j('/api/admin/event/halloween/odoslat', { method: 'POST', body: { potvrdit: true } }, adm);
    ok('bez HALLOWEEN_GO sa neodošle nič (409)', bezGo.status === 409, JSON.stringify(bezGo.d));
    ok('chyba vysvetlí, že deploy nie je schválenie', /deploy/i.test(((bezGo.d || {}).error) || ''), JSON.stringify(bezGo.d));

    console.log('\n5) Dvakrát to nikomu nepríde:');
    // mail_log sa plní aj pri MAIL_CAPTURE, takže druhý náhľad už adresátov nesmie mať
    process.env.HALLOWEEN_GO = '1';
    const stav = await j('/api/admin/event/halloween/nahlad', {}, adm);
    ok('druhé načítanie náhľadu dá to isté', (stav.d || {}).pocet === 4, JSON.stringify((stav.d || {}).pocet));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nPOZVÁNKA NA HALLOWEEN: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-900));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
