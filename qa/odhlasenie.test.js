/**
 * Odhlásenie z mailových ponúk (2. 9. 2026).
 *
 * Klientka nahlásila, že sa nevie odhlásiť — „stránka neexistuje". Odkaz
 * „Odhlásiť" bol pritom v pätičke KAŽDÉHO mailu a /unsubscribe vracalo 404.
 * Nikto sa teda odhlásiť nemohol.
 *
 * Test stráži, že:
 *   · stránka existuje a odkaz v maili na ňu vedie aj s podpisom
 *   · odhlásiť sa dá len sám seba — cudzí e-mail bez platného podpisu nie
 *   · po odhlásení prestanú chodiť ponuky, ale potvrdenia áno
 *   · „nechcem už nič" vypne aj ostatné maily
 *   · one-click z Gmailu (RFC 8058) funguje
 *
 * Spustenie:  node qa/odhlasenie.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4573;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-unsub-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

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
  let kod = 0;
  const K = (id, meno, mail) => JSON.stringify({ _id: id, name: meno, email: mail,
    password: hash, user_type: 'client', active: true, referral_code: 'QAUNS' + String(++kod).padStart(2, '0'),
    visit_count: 3, created_at: '2026-06-01', city: 'Detva' });

  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaUnsAdmin00001', name: 'Adam Admin', email: 'qa.uns.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }),
    K('qaUnsOdhlas001', 'Olga Odhlasena', 'qa.uns.odhlas@qa-biz.local'),
    K('qaUnsVsetko001', 'Vlasta Vsetko', 'qa.uns.vsetko@qa-biz.local'),
    K('qaUnsOneClick1', 'Ondrea Oneclick', 'qa.uns.oneclick@qa-biz.local'),
    K('qaUnsNedotkne1', 'Nela Nedotknuta', 'qa.uns.nedotkne@qa-biz.local'),
  ].join('\n') + '\n');

  console.log('ODHLÁSENIE QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', SESSION_SECRET: 'qa-secret-unsub' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  const usr = mail => rd('users.db').find(u => String(u.email || '').toLowerCase() === mail);
  const token = (mail) => require('crypto').createHmac('sha256', 'qa-secret-unsub')
    .update('unsub:' + mail).digest('hex').slice(0, 32);

  try {
    console.log('\nStránka, ktorá chýbala:');
    const str = await fetch(BASE + '/unsubscribe');
    ok('/unsubscribe už neodpovedá 404', str.status === 200, 'HTTP ' + str.status);
    const telo = await str.text();
    ok('a je to naozaj odhlasovacia stránka', /Odhl[áa]senie/i.test(telo));

    console.log('\nOdkaz v maili:');
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.uns.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    // Vyvoláme reálny mail cez appku a pozrieme, čo má v pätičke.
    await j('/api/admin/crm/test-email', { method: 'POST',
      body: { to: 'qa.uns.odhlas@qa-biz.local' } }, adm);
    await new Promise(r => setTimeout(r, 700));
    const posledny = rd('mail_log.db').filter(m => String(m.to).includes('odhlas')).slice(-1)[0];
    const html = String((posledny && (posledny.html || posledny.body)) || '');
    // Fallback „prejde, keď sa mail nevyvolal" by bola slepá kontrola — radšej
    // si šablónu vyskúšame priamo a overíme, čo z nej naozaj vyšlo.
    const vzor = html || (() => {
      const posl = rd('mail_log.db').slice(-1)[0];
      return String((posl && (posl.html || posl.body)) || '');
    })();
    ok('pätička vedie na /unsubscribe s podpisom príjemcu',
      /\/unsubscribe\?e=[^"&]+&t=[a-f0-9]{32}/.test(vzor),
      vzor ? (vzor.match(/\/unsubscribe[^"]{0,90}/) || ['odkaz v pätičke nenájdený'])[0] : 'žiadny mail sa nezachytil');

    console.log('\nOdhlásenie z ponúk:');
    const mail = 'qa.uns.odhlas@qa-biz.local';
    const stav = await j('/api/unsubscribe/stav?e=' + encodeURIComponent(mail) + '&t=' + token(mail));
    ok('stránka zistí, o koho ide', stav.status === 200 && stav.d && stav.d.meno === 'Olga',
      JSON.stringify(stav.d));
    const von = await j('/api/unsubscribe', { method: 'POST', body: { e: mail, t: token(mail), rozsah: 'ponuky' } });
    ok('odhlásenie prejde', von.status === 200 && von.d && von.d.ok, JSON.stringify(von.d));
    await new Promise(r => setTimeout(r, 500));
    const u1 = usr(mail);
    ok('ponuky sa vypli', u1 && u1.offers_optout === true, String(u1 && u1.offers_optout));
    ok('ale potvrdenia rezervácií chodiť budú', u1 && !u1.do_not_contact, String(u1 && u1.do_not_contact));
    ok('a je zapísané, kedy sa odhlásil/a', !!(u1 && u1.unsubscribed_at), String(u1 && u1.unsubscribed_at));

    console.log('\n„Nechcem už žiadne e-maily":');
    const m2 = 'qa.uns.vsetko@qa-biz.local';
    await j('/api/unsubscribe', { method: 'POST', body: { e: m2, t: token(m2), rozsah: 'vsetko' } });
    await new Promise(r => setTimeout(r, 500));
    const u2 = usr(m2);
    ok('vypne ponuky aj ostatné maily', u2 && u2.offers_optout === true && u2.do_not_contact === true,
      JSON.stringify({ o: u2 && u2.offers_optout, d: u2 && u2.do_not_contact }));
    ok('aj SMS', u2 && u2.sms_opt_out === true, String(u2 && u2.sms_opt_out));

    console.log('\nBezpečnosť:');
    const m3 = 'qa.uns.nedotkne@qa-biz.local';
    const podvrh = await j('/api/unsubscribe', { method: 'POST', body: { e: m3, t: 'vymysleny-podpis-1234567890ab' } });
    ok('cudzí e-mail sa bez platného podpisu odhlásiť nedá', podvrh.status === 400, 'HTTP ' + podvrh.status);
    await new Promise(r => setTimeout(r, 400));
    ok('a ten účet ostal nedotknutý', !(usr(m3) || {}).offers_optout, String((usr(m3) || {}).offers_optout));
    const bezT = await j('/api/unsubscribe/stav?e=' + encodeURIComponent(m3));
    ok('ani stav sa bez podpisu nezistí', bezT.status === 400, 'HTTP ' + bezT.status);
    // Neexistujúca adresa nesmie prezradiť, či u nás účet má.
    const cudzia = 'niekto.cudzi@example.test';
    const neexistuje = await j('/api/unsubscribe', { method: 'POST', body: { e: cudzia, t: token(cudzia) } });
    ok('odkaz neprezradí, či daná adresa u nás účet má', neexistuje.status === 200,
      'HTTP ' + neexistuje.status);

    console.log('\nOne-click z Gmailu (RFC 8058):');
    const m4 = 'qa.uns.oneclick@qa-biz.local';
    const oc = await fetch(BASE + '/unsubscribe?e=' + encodeURIComponent(m4) + '&t=' + token(m4), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click' });
    ok('Gmail dostane 200', oc.status === 200, 'HTTP ' + oc.status);
    await new Promise(r => setTimeout(r, 500));
    ok('a človek je odhlásený', (usr(m4) || {}).offers_optout === true, String((usr(m4) || {}).offers_optout));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nODHLÁSENIE: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
