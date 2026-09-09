/**
 * Obchod otvorený v skutočnom prehliadači (9. 9. 2026).
 *
 * Prečo existuje: 8. 9. som pri úprave obchodu vyrezal kus súboru a zmizlo
 * 20 funkcií — karty Vstupy, Súkromné, Merch, Eventy aj Nákupy sa prestali
 * vykresľovať a permanentka sa nedala kúpiť. Serverové testy prešli všetky,
 * lebo chyba bola až v prehliadači. Odvtedy sa obchod overuje tak, ako ho
 * vidí klientka.
 *
 * Stráži, že:
 *   · stránka nabehne bez jedinej chyby v konzole
 *   · všetkých šesť kariet vykreslí obsah (nie prázdno)
 *   · na karte Vstupy je jednorazový vstup aj 10-vstupová permanentka
 *   · odkaz z reklamy /obchod?buy=permanentka10 otvorí rovno nákup permanentky
 *     na karte Vstupy (showTab prepisuje adresu — parameter sa nesmie stratiť)
 *   · nákupný modál ukáže cenu a obe platobné tlačidlá
 *   · kredit sa neodpočíta z tlačidla „zaplatiť kartou" — Stripe pýta plnú cenu
 *   · hotovostná žiadosť o permanentku naozaj vznikne
 *
 * Spustenie:  node qa/obchod-v-prehliadaci.test.js
 */
process.env.NODE_PATH = 'C:/Fusion Academy/automatizacie/node_modules';
require('module').Module._initPaths();

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');
const { chromium } = require('playwright');

const PORT = 4596;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-obchod-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  w('users.db', [
    { _id: 'qaObchAdmin0001', name: 'Marek Gruber', email: 'qa.obchod.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    // bežná klientka bez kreditu — kupuje permanentku
    { _id: 'qaObchKlient001', name: 'Obchodná klientka', email: 'qa.obchod@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-08-01',
      referral_code: 'QAOBCH1', visit_count: 4, single_entries: 0, referral_credit: 0 },
    // klientka s kreditom — na kontrolu tlačidla karty
    { _id: 'qaObchKredit001', name: 'Kreditná klientka', email: 'qa.kredit@qa-biz.local',
      password: hash, user_type: 'client', active: true, created_at: '2026-08-01',
      referral_code: 'QAOBCH2', visit_count: 2, single_entries: 0, referral_credit: 43 },
  ]);

  console.log('OBCHOD V PREHLIADAČI\n');

  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1',
      // len aby sa vykreslilo kartové tlačidlo — na Stripe sa v teste neklikne
      STRIPE_SECRET_KEY: 'sk_test_qa_obchod' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 9000));

  let browser = null;
  try {
    browser = await chromium.launch();
    // veľkosť telefónu — klientky nakupujú z mobilu
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const chybyKonzoly = [];
    page.on('console', m => { if (m.type() === 'error') chybyKonzoly.push(m.text()); });
    page.on('pageerror', e => chybyKonzoly.push(String(e.message)));

    // prihlásenie mimo stránky — cookie zdieľa celý kontext prehliadača
    const prihlas = async (email) => {
      await ctx.request.post(BASE + '/api/login', { data: { email, password: 'Heslo123!' } });
    };

    console.log('1) Stránka nabehne a nič nespadne:');
    await prihlas('qa.obchod@qa-biz.local');
    await page.goto(BASE + '/obchod', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    ok('žiadna chyba v konzole', chybyKonzoly.length === 0, chybyKonzoly.slice(0, 3).join(' | '));

    console.log('\n2) Všetkých šesť kariet vykreslí obsah:');
    for (const [id, nazov] of [['clenstva', 'Členstvá'], ['vstupy', 'Vstupy'], ['sukromne', 'Súkromné'],
      ['merch', 'Merch'], ['eventy', 'Eventy'], ['nakupy', 'Moje nákupy']]) {
      await page.click('#tab-' + id);
      await page.waitForTimeout(900);
      const dlzka = await page.$eval('#p-' + id, el => el.innerHTML.trim().length);
      ok(nazov + ' sa vykreslí', dlzka > 20, 'obsah má ' + dlzka + ' znakov');
    }

    console.log('\n3) Karta Vstupy ponúka vstup aj permanentku:');
    await page.click('#tab-vstupy');
    await page.waitForTimeout(800);
    const vstupyText = await page.$eval('#p-vstupy', el => el.textContent);
    ok('jednorazový vstup', /10,00\s?€/.test(vstupyText), vstupyText.slice(0, 90));
    ok('10-vstupová permanentka za 80 €', /80,00\s?€/.test(vstupyText), vstupyText.slice(0, 90));

    console.log('\n4) Odkaz z reklamy /obchod?buy=permanentka10:');
    chybyKonzoly.length = 0;
    await page.goto(BASE + '/obchod?buy=permanentka10', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    ok('otvorí sa karta Vstupy',
      await page.$eval('#p-vstupy', el => el.classList.contains('active')));
    ok('modál je otvorený',
      await page.$eval('#buyM', el => el.classList.contains('open')));
    const titulok = await page.$eval('#mTitle', el => el.textContent);
    ok('a je to permanentka', /permanentka/i.test(titulok), titulok);
    ok('cena 80 €', /80,00\s?€/.test(await page.$eval('#mTotal', el => el.textContent)));
    ok('je tam tlačidlo karty', !!(await page.$('#mStripe')));
    ok('aj tlačidlo hotovosti', !!(await page.$('#mManual')));
    ok('žiadna chyba v konzole', chybyKonzoly.length === 0, chybyKonzoly.slice(0, 3).join(' | '));

    console.log('\n5) Kredit sa netvári, že ho vezme karta:');
    await prihlas('qa.kredit@qa-biz.local');
    await page.goto(BASE + '/obchod?buy=permanentka10', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    ok('modál odpočíta kredit zo sumy',
      /37,00\s?€/.test(await page.$eval('#mTotal', el => el.textContent)),
      await page.$eval('#mTotal', el => el.textContent));
    const kartaText = await page.$eval('#mStripe', el => el.textContent);
    ok('na karte je plná cena 80 €', /80,00\s?€/.test(kartaText), kartaText);
    const pozn = await page.$eval('#mStripeNote', el => el.style.display + '|' + el.textContent);
    ok('a upozornenie je viditeľné', pozn.startsWith('block') && /plnú cenu/i.test(pozn), pozn.slice(0, 90));

    console.log('\n6) Permanentka sa dá naozaj kúpiť (hotovosť):');
    await prihlas('qa.obchod@qa-biz.local');
    await page.goto(BASE + '/obchod?buy=permanentka10', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.click('#mManual');
    await page.waitForTimeout(2500);
    const ziadosti = rd('payments.db').filter(p => p.user_id === 'qaObchKlient001');
    ok('vznikla žiadosť o platbu', ziadosti.length === 1, JSON.stringify(ziadosti.map(p => p.status)));
    ok('na permanentku za 80 €',
      ziadosti[0] && ziadosti[0].ref_id === 'permanentka10' && Math.abs(ziadosti[0].amount - 80) < 0.01,
      ziadosti[0] && ziadosti[0].ref_id + '/' + ziadosti[0].amount);
    ok('a čaká na potvrdenie, nie je aktivovaná',
      ziadosti[0] && ziadosti[0].status === 'pending_manual', ziadosti[0] && ziadosti[0].status);
    ok('vstupy sa zatiaľ nepripísali',
      (rd('users.db').find(u => u._id === 'qaObchKlient001').single_entries || 0) === 0);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nOBCHOD V PREHLIADAČI: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-800));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
