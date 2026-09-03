/**
 * Dopredajová vlna deň pred Latin Tropical Party (4. 9. 2026).
 *
 * Po 810 event mailoch za dva dni bez jedinej objednávky ide deň pred akciou
 * len jedna krátka výzva — štandardne LEN tým, čo v niektorom event maili
 * klikli. Rozsah „otvorili" je širší a musí sa zapnúť vedome.
 *
 * Stráži, že:
 *   · „klikli" dostane iba klikačka; „otvorili" pridá otváračku, klikačku nie 2×
 *   · kupujúca, držiteľka lístka, odhlásená, dieťa, test účet a ten, kto dnes
 *     už event mail dostal, nedostanú nič
 *   · text: SOBOTA (nie piatok), 5 € online / 10 € na mieste, 65 € Full,
 *     reálny počet voľných miest, odkaz s utm, podpísané odhlásenie
 *   · po vyčerpaní cieľovky sa vlna sama uzavrie a už nebeží
 *
 * Spustenie:  node qa/dopredaj-vlna.test.js
 *   NAHLAD_OUT=<súbor.html>  uloží zachytený mail ako náhľad pre Mareka
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4578;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-dopredaj-'));

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
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const dopredaj = () => rd('mail_log.db').filter(m => m.template === 'event_campaign_dopredaj');

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = (id, name, email, extra) => JSON.stringify({ _id: id, name, email, password: hash, user_type: 'client', active: true, created_at: '2026-05-01', ...(extra || {}) });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    U('qaDopAdmin00001', 'Adam Admin', 'qa.dop.admin@qa-biz.local', { is_admin: true, user_type: 'admin' }),
    U('qaDopKlik000001', 'Klára Klikačka', 'qa.dop.klik@qa-biz.local'),
    U('qaDopOtvor00001', 'Oľga Otváračka', 'qa.dop.otvor@qa-biz.local', { user_type: 'lead' }),
    U('qaDopNeotv00001', 'Nina Neotvorená', 'qa.dop.neotvor@qa-biz.local'),
    U('qaDopKupil00001', 'Katka Kúpila', 'qa.dop.kupila@qa-biz.local'),
    U('qaDopDrzit00001', 'Dana Držiteľka', 'qa.dop.drzitel@qa-biz.local'),
    U('qaDopOptout0001', 'Oľga Odhlásená', 'qa.dop.optout@qa-biz.local', { offers_optout: true }),
    U('qaDopDnes000001', 'Dáša Dnešná', 'qa.dop.dnes@qa-biz.local'),
    U('qaDopTest000001', 'Test Osoba', 'qa.dop.testovaci@qa-biz.local'),
    U('qaDopDieta00001', 'Dorka Dieťa', 'qa.dop.dieta@qa-biz.local', { is_child: true }),
  ].join('\n') + '\n');
  const M = (id, to, extra) => JSON.stringify({ _id: id, to, subject: '🍹 V sobotu tancujeme — vstup 5 € do dňa akcie', template: 'event_campaign_party',
    created_at: '2026-09-02T10:00:00.000Z', ...(extra || {}) });
  const teraz = new Date().toISOString();
  fs.writeFileSync(path.join(DATA, 'mail_log.db'), [
    M('qaDopMl00000001', 'qa.dop.klik@qa-biz.local', { opened_at: '2026-09-02T11:00:00.000Z', clicked_at: '2026-09-02T11:01:00.000Z' }),
    M('qaDopMl00000002', 'qa.dop.otvor@qa-biz.local', { opened_at: '2026-09-02T12:00:00.000Z' }),
    M('qaDopMl00000003', 'qa.dop.neotvor@qa-biz.local'),
    M('qaDopMl00000004', 'qa.dop.kupila@qa-biz.local', { opened_at: '2026-09-02T11:00:00.000Z', clicked_at: '2026-09-02T11:02:00.000Z' }),
    M('qaDopMl00000005', 'qa.dop.drzitel@qa-biz.local', { opened_at: '2026-09-02T11:00:00.000Z', clicked_at: '2026-09-02T11:03:00.000Z' }),
    M('qaDopMl00000006', 'qa.dop.optout@qa-biz.local', { opened_at: '2026-09-02T11:00:00.000Z', clicked_at: '2026-09-02T11:04:00.000Z' }),
    M('qaDopMl00000007', 'qa.dop.dnes@qa-biz.local', { opened_at: '2026-09-02T11:00:00.000Z', clicked_at: '2026-09-02T11:05:00.000Z' }),
    M('qaDopMl00000008', 'qa.dop.dnes@qa-biz.local', { created_at: teraz, template: 'event_campaign_party', subject: 'dnešný event mail' }),
    M('qaDopMl00000009', 'qa.dop.testovaci@qa-biz.local', { opened_at: '2026-09-02T11:00:00.000Z', clicked_at: '2026-09-02T11:06:00.000Z' }),
    M('qaDopMl00000010', 'qa.dop.dieta@qa-biz.local', { opened_at: '2026-09-02T11:00:00.000Z', clicked_at: '2026-09-02T11:07:00.000Z' }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(DATA, 'ev_orders.db'), [
    JSON.stringify({ _id: 'qaDopOrd0000001', event_slug: 'latin-tropical-2026', status: 'paid', buyer_email: 'qa.dop.kupila@qa-biz.local', buyer_name: 'Katka Kúpila',
      total: 5, items: [{ type: 'party', type_name: 'LATIN TROPICAL PARTY', qty: 1, holders: [] }], paid_at: '2026-08-30T10:00:00.000Z', created_at: '2026-08-30T10:00:00.000Z' }),
    JSON.stringify({ _id: 'qaDopOrd0000002', event_slug: 'latin-tropical-2026', status: 'paid', buyer_email: 'qa.dop.cudzi@qa-biz.local', buyer_name: 'Cudzí Kupec',
      total: 130, items: [{ type: 'full', type_name: 'FULL EXPERIENCE — MASTERCLASS', qty: 2, holders: [{ email: 'qa.dop.drzitel@qa-biz.local', name: 'Dana Držiteľka' }] }],
      paid_at: '2026-08-31T10:00:00.000Z', created_at: '2026-08-31T10:00:00.000Z' }),
  ].join('\n') + '\n');

  console.log('DOPREDAJOVÁ VLNA QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', QA_EVENT_WINDOW: '1',
      BREVO_API_KEY: 'qa-fake-key-nikam-neposiela' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.dop.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, 'HTTP ' + lg.status);
    ok('spustenie vlny bez admina je zakázané', [401, 403].includes((await j('/api/admin/qa/run-event-mail/dopredaj', { method: 'POST' })).status));

    console.log('\n1) Rozsah „klikli" (štandard):');
    const b1 = await j('/api/admin/qa/run-event-mail/dopredaj', { method: 'POST' }, adm);
    ok('vlna prebehla', b1.status === 200 && b1.d && b1.d.ok, JSON.stringify(b1.d).slice(0, 160));
    ok('rozsah je „klikli"', b1.d && b1.d.rozsah === 'klikli', b1.d && b1.d.rozsah);
    ok('vybraná je iba klikačka', b1.d && JSON.stringify(b1.d.selected) === JSON.stringify(['qa.dop.klik@qa-biz.local']), JSON.stringify(b1.d && b1.d.selected));
    // MAIL_CAPTURE: sendMail zaloguje a vráti false, takže „sent" je tu 0 — dôkazom je log nižšie
    ok('v capture režime sa nič neposlalo (sent=0), ale cieľovka bola 1', b1.d && b1.d.sent === 0 && b1.d.remaining === 1, JSON.stringify(b1.d));
    await new Promise(r => setTimeout(r, 500));
    const m1 = dopredaj();
    ok('v logu je práve 1 dopredajový mail', m1.length === 1, 'n=' + m1.length);
    const mail = m1[0] || {};
    const html = String(mail.html || '');
    ok('predmet sedí', mail.subject === '🍹 Zajtra večer Latin Tropical Party — online ešte za 5 €', mail.subject);
    ok('oslovenie krstným menom', /Ahoj Klára, zajtra tancujeme/.test(html));
    ok('deň je SOBOTA — vypočítaný, nie napísaný', /sobota 5\. 9\. 2026/.test(html) && !/piatok/i.test(html));
    ok('cena: online 5 €, na mieste 10 €', /Vstup online 5 €/.test(html) && /na mieste 10 €/.test(html));
    ok('Full Experience za 65 € (nie 55, predpredaj skončil)', /Full Experience za <b>65 €<\/b>/.test(html) && !/55 €/.test(html));
    ok('voľné miesta sú z reálnych objednávok (30 − 2 = 28)', /Voľných je ešte <b>28<\/b> z 30 miest/.test(html), (html.match(/Voľných je ešte <b>\d+/) || [])[0]);
    ok('miesto a čas', /od 21:00 · Fusion Club Detva, Záhradná 7/.test(html));
    ok('odkaz na event s utm dopredaja', /\/event\/latin-tropical-2026\?utm_source=email&utm_medium=email&utm_campaign=fa-dopredaj/.test(html));
    ok('plagát v maili', /\/img\/events\/latin-tropical\.jpg/.test(html));
    ok('podpísané odhlásenie v pätičke', /\/unsubscribe\?e=/.test(html));
    ok('šablóna je označená ako event kampaň (ráta sa do denného limitu)', mail.template === 'event_campaign_dopredaj');
    if (process.env.NAHLAD_OUT && html) { fs.writeFileSync(process.env.NAHLAD_OUT, html); console.log('  💾 náhľad: ' + process.env.NAHLAD_OUT); }

    console.log('\n2) Rozsah „otvorili" (širší, len na vedomý pokyn):');
    const b2 = await j('/api/admin/qa/run-event-mail/dopredaj?rozsah=otvorili', { method: 'POST' }, adm);
    ok('vlna prebehla s rozsahom „otvorili"', b2.status === 200 && b2.d && b2.d.rozsah === 'otvorili', JSON.stringify(b2.d).slice(0, 160));
    ok('pribudla otváračka — a klikačka nedostala druhýkrát', b2.d && JSON.stringify(b2.d.selected) === JSON.stringify(['qa.dop.otvor@qa-biz.local']), JSON.stringify(b2.d && b2.d.selected));
    await new Promise(r => setTimeout(r, 500));
    const m2 = dopredaj();
    ok('v logu sú 2 dopredajové maily', m2.length === 2, 'n=' + m2.length);
    const bezMena = m2.find(m => m.to === 'qa.dop.otvor@qa-biz.local');
    ok('lead dostane rovnaký mail s oslovením', bezMena && /Ahoj Oľga, zajtra tancujeme/.test(String(bezMena.html || '')));

    console.log('\n3) Kto NESMIE dostať nič:');
    const komu = new Set(m2.map(m => m.to));
    for (const [kto, e] of [['tá, čo mail neotvorila', 'qa.dop.neotvor@qa-biz.local'], ['kupujúca', 'qa.dop.kupila@qa-biz.local'],
      ['držiteľka lístka z cudzej objednávky', 'qa.dop.drzitel@qa-biz.local'], ['odhlásená z ponúk', 'qa.dop.optout@qa-biz.local'],
      ['tá, čo dnes už event mail dostala', 'qa.dop.dnes@qa-biz.local'], ['test účet', 'qa.dop.testovaci@qa-biz.local'],
      ['detský účet', 'qa.dop.dieta@qa-biz.local'], ['admin', 'qa.dop.admin@qa-biz.local']])
      ok(kto, !komu.has(e));

    console.log('\n4) Uzavretie vlny:');
    const b3 = await j('/api/admin/qa/run-event-mail/dopredaj?rozsah=otvorili', { method: 'POST' }, adm);
    ok('tretí beh už nikoho nevyberie', b3.d && b3.d.sent === 0 && Array.isArray(b3.d.selected) && b3.d.selected.length === 0, JSON.stringify(b3.d).slice(0, 120));
    await new Promise(r => setTimeout(r, 300));
    ok('a zapíše sa, že je hotovo', rd('settings.db').some(s => s.key === 'event_dopredaj_lt2026_done'));
    const b4 = await j('/api/admin/qa/run-event-mail/dopredaj', { method: 'POST' }, adm);
    ok('štvrtý beh sa už ani nespustí', b4.status === 200 && (!b4.d || b4.d.sent === undefined), JSON.stringify(b4.d).slice(0, 120));
    ok('v logu ostali stále len 2 maily', dopredaj().length === 2, 'n=' + dopredaj().length);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nDOPREDAJOVÁ VLNA: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-800));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
