/**
 * Dobehová vlna k párty 5. 9. (Marek 31. 8.): eventLastCallTick
 *
 * 31. 8. ráno odišla ešte staršia verzia textu — bez plagátu a bez masterclass.
 * Dobeh smie osloviť LEN toho, kto ranný mail nedostal do rúk (neotvoril ho),
 * takže test stráži predovšetkým to, čím sa dá uškodiť:
 *   · nikto nedostane druhý mail v ten istý deň, ak už ten prvý čítal
 *   · nikto nedostane dobeh dvakrát
 *   · keď sa zoznam otvorení nepodarí získať, vlna radšej nepošle NIČ
 *
 * Spustenie:  node qa/event-lastcall.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const BASE_PORT = 4531;
let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };

const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
const NOW = new Date().toISOString();
const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

async function j(base, url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(base + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}

// Text mailu overujeme na origináli: funkciu vytiahneme priamo zo server.js,
// nech test nikdy nekontroluje kópiu, ktorá sa medzitým rozišla so skutočnosťou.
function vytiahni(nazov) {
  let i = SRC.indexOf('function ' + nazov + '(');
  if (i < 0) throw new Error(nazov + ' sa nenašla');
  if (SRC.slice(i - 6, i) === 'async ') i -= 6;   // inak by sme z async funkcie spravili obyčajnú
  let h = 0, vRet = null;
  for (let k = i; k < SRC.length; k++) {
    const ch = SRC[k], pred = SRC[k - 1];
    if (vRet) { if (ch === vRet && pred !== String.fromCharCode(92)) vRet = null; continue; }
    if (ch === String.fromCharCode(39) || ch === '"' || ch === String.fromCharCode(96)) { vRet = ch; continue; }
    if (ch === '{') h++;
    else if (ch === '}') { h--; if (h === 0) return SRC.slice(i, k + 1); }
  }
  throw new Error('koniec ' + nazov + ' sa nenašiel');
}

let poradie = 0;
const U = (id, meno, mail, extra = {}) => JSON.stringify({
  _id: id, name: meno, email: mail, phone: '', password: '', referral_code: 'QALC' + String(++poradie).padStart(2, '0'),
  sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: 'client',
  visit_count: 2, created_at: '2026-06-01', city: 'Detva', account_creation_type: 'self_registration',
  ...extra,
});

// ranný mail presne tak, ako ho zapísala vlna C
const RANNY = (mail, id) => JSON.stringify({
  _id: id, to: mail, subject: 'Ranny mail', template: 'event_campaign_lastday',
  created_at: DNES + 'T07:07:00.000Z', opened_at: null, click_count: 0,
});

function pripravData() {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-lc-'));
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaLcAdmin0000001', name: 'Adam Dobehovy', email: 'qa.lc.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-06-01' }),
    U('qaLcNeotvor0001', 'Beata Neotvorila', 'qa.lc.neotvorila@qa-biz.local'),
    U('qaLcClenka00001', 'Katarina Clenkova', 'qa.lc.clenka@qa-biz.local'),
    U('qaLcOtvorila001', 'Ivana Otvorilova', 'qa.lc.otvorila@qa-biz.local'),
    U('qaLcBezMailu001', 'Nina Bezmailova', 'qa.lc.bezmailu@qa-biz.local'),
    U('qaLcKupila00001', 'Zuzana Kupilova', 'qa.lc.kupila@qa-biz.local'),
    U('qaLcOptout00001', 'Olga Odhlasena', 'qa.lc.optout@qa-biz.local', { offers_optout: true }),
    U('qaLcLead0000001', 'Petra Leadova', 'qa.lc.lead@qa-biz.local', { user_type: 'lead' }),
  ].join('\n') + '\n');

  fs.writeFileSync(path.join(DATA, 'memberships.db'), JSON.stringify({
    _id: 'qaLcMem00000001', user_id: 'qaLcClenka00001', plan_id: 'silver', status: 'active',
    started_at: '2026-08-01', expires_at: '2026-12-31', price: 69,
  }) + '\n');

  fs.writeFileSync(path.join(DATA, 'ev_orders.db'), JSON.stringify({
    _id: 'qaLcOrd00000001', order_number: 'QA-LC-1', event_slug: 'latin-tropical-2026',
    buyer_name: 'Zuzana Kupilova', buyer_email: 'qa.lc.kupila@qa-biz.local', status: 'paid',
    paid_at: NOW, created_at: NOW, total: 45, items: [{ type: 'full', qty: 2, holders: [] }],
  }) + '\n');

  // ranný mail dostali všetci okrem Niny a Petry
  fs.writeFileSync(path.join(DATA, 'mail_log.db'), [
    RANNY('qa.lc.neotvorila@qa-biz.local', 'qaLcMl00000001'),
    RANNY('qa.lc.clenka@qa-biz.local', 'qaLcMl00000002'),
    RANNY('qa.lc.otvorila@qa-biz.local', 'qaLcMl00000003'),
    RANNY('qa.lc.kupila@qa-biz.local', 'qaLcMl00000004'),
    RANNY('qa.lc.optout@qa-biz.local', 'qaLcMl00000005'),
  ].join('\n') + '\n');
  return DATA;
}

async function spusti(port, DATA, extraEnv) {
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATA_DIR: DATA, APP_URL: 'http://localhost:' + port,
           RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', QA_EVENT_WINDOW: '1',
           BREVO_API_KEY: 'qa-fake-key', ...extraEnv },
    stdio: 'ignore',
  });
  const base = 'http://localhost:' + port, t0 = Date.now();
  while (Date.now() - t0 < 180000) { try { await fetch(base + '/'); return { srv, base }; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  throw new Error('server na porte ' + port + ' nenabehol');
}

(async () => {
  console.log('DOBEHOVÁ VLNA QA\n');

  // ── 1. text mailu (bez servera, priamo z origináli v server.js) ──
  console.log('Text mailu:');
  const APP = 'https://app.fusionacademy.sk';
  const f = new Function('APP_URL', vytiahni('emailTemplate') + '\n' + vytiahni('evLastCallHtml')
    + '\nreturn {clen: evLastCallHtml("Katka", true, 24, "fa-masterclass-lastcall"),'
    + ' neclen: evLastCallHtml("Lucia", false, 24, "fa-masterclass-lastcall"),'
    + ' plno: evLastCallHtml("Nina", false, 0, "fa-masterclass-lastcall")};')(APP);
  ok('plagát je v maili', f.clen.includes('/img/events/latin-tropical.jpg'), 'chýba obrázok');
  ok('plagát je klikateľný na event', /<a href="[^"]*\/event\/latin-tropical-2026[^"]*"[^>]*>\s*<img/.test(f.clen));
  ok('masterclass menuje oboch lektorov',
    f.clen.includes('Marekom Gruberom') && f.clen.includes('Ivanom Ligártom'));
  ok('program večera je v maili', f.clen.includes('18:15') && f.clen.includes('21:00'));
  ok('drinky aj jedlo sú spomenuté', /welcome drink/i.test(f.clen) && /jedlo/i.test(f.clen));
  ok('členka vidí svojich 45 €', f.clen.includes('45 €') && !/Predpredaj <b/.test(f.clen));
  ok('nečlenka vidí 55 €', f.neclen.includes('55 €') && !f.neclen.includes('45 €'));
  ok('obom sa ukáže zajtrajších 65 €', f.clen.includes('65 €') && f.neclen.includes('65 €'));
  ok('voľné miesta sa doplnia číslom', f.clen.includes('<b>24</b>'));
  ok('pri vypredaní sa text zmení', /vypredan/i.test(f.plno) && !f.plno.includes('<b>0</b>'));
  ok('utm kampaň sa dá odlíšiť od rannej', f.clen.includes('fa-masterclass-lastcall'));
  ok('telefón na rezerváciu stola sedí', f.clen.includes('0904 31 51 51'));

  // ── 2. zoznam otvorení z Brevo (s podvrhnutým fetchom) ──
  console.log('\nZoznam otvorení z Brevo:');
  const helper = (odpoved) => new Function('fetch', 'process',
    vytiahni('brevoOtvoriliDnes') + '\nreturn brevoOtvoriliDnes;')(
    async () => odpoved, { env: { BREVO_API_KEY: 'x' } });

  const bo = helper({ ok: true, json: async () => ({ events: [
    { email: 'Anna@x.sk', subject: 'Ranny mail' },
    { email: 'bela@x.sk', subject: 'Rezervácia potvrdená – Zumba' },
    { email: 'cila@x.sk', subject: 'Ranny mail' },
  ] }) });
  const len = await bo(false, new Set(['Ranny mail']));
  ok('kto otvoril ranný mail, je v zozname', len.has('anna@x.sk') && len.has('cila@x.sk'), [...len].join(','));
  ok('kto otvoril iný mail, sa nepočíta', !len.has('bela@x.sk'), [...len].join(','));
  ok('adresy sa porovnávajú bez ohľadu na veľkosť písmen', len.has('anna@x.sk'), [...len].join(','));
  ok('bez zoznamu predmetov sa berú všetky otvorenia', (await bo(false, new Set())).size === 3);
  ok('pri chybe Brevo sa vráti null, nie prázdny zoznam',
    (await helper({ ok: false, status: 401 })(false, new Set())) === null);
  ok('pri nečakanej odpovedi tiež null',
    (await helper({ ok: true, json: async () => ({}) })(false, new Set())) === null);

  // ── 3. cieľovka: posielame len tomu, kto ranný neotvoril ──
  console.log('\nKomu vlna píše:');
  const DATA = pripravData();
  const { srv, base } = await spusti(BASE_PORT, DATA, {
    // Ivana ranný mail otvorila (v produkcii to príde z Brevo)
    QA_OPENED: 'qa.lc.otvorila@qa-biz.local',
  });
  let srv2 = null;
  try {
    const adm = {};
    const lg = await j(base, '/api/login', { method: 'POST', body: { email: 'qa.lc.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    const c = await j(base, '/api/admin/qa/run-event-mail/lastcall', { method: 'POST' }, adm);
    const cs = (c.d && c.d.selected || []).map(e => String(e).toLowerCase());
    ok('vlna beží', c.status === 200 && Array.isArray(c.d && c.d.selected), JSON.stringify(c.d));
    ok('kto ranný NEOTVORIL, dobeh dostane', cs.includes('qa.lc.neotvorila@qa-biz.local'), cs.join(','));
    ok('členka bez otvorenia ho dostane tiež', cs.includes('qa.lc.clenka@qa-biz.local'), cs.join(','));
    ok('kto ranný OTVORIL, druhý mail NEdostane', !cs.includes('qa.lc.otvorila@qa-biz.local'), cs.join(','));
    ok('kto ranný vôbec nedostal, nie je v dobehu', !cs.includes('qa.lc.bezmailu@qa-biz.local'), cs.join(','));
    ok('kto už kúpil, ponuku NEdostane', !cs.includes('qa.lc.kupila@qa-biz.local'), cs.join(','));
    ok('odhlásená z ponúk nedostane nič', !cs.includes('qa.lc.optout@qa-biz.local'), cs.join(','));
    ok('lead nie je v cieľovke', !cs.includes('qa.lc.lead@qa-biz.local'), cs.join(','));
    ok('členka je v poradí pred nečlenkou',
      cs.indexOf('qa.lc.clenka@qa-biz.local') < cs.indexOf('qa.lc.neotvorila@qa-biz.local'), cs.join(','));
    ok('voľné miesta sa rátajú z objednávok (30 − 2 = 28)', c.d && c.d.volne === 28, String(c.d && c.d.volne));

    const c2 = await j(base, '/api/admin/qa/run-event-mail/lastcall', { method: 'POST' }, adm);
    ok('druhý beh už nikoho neosloví', (c2.d && c2.d.selected || []).length === 0, JSON.stringify(c2.d && c2.d.selected));

    // ── 4. poistka: bez zoznamu otvorení sa neposiela nič ──
    console.log('\nPoistka, keď Brevo mlčí:');
    const DATA2 = pripravData();
    const s2 = await spusti(BASE_PORT + 1, DATA2, {});   // bez QA_OPENED → ide sa na Brevo, kľúč je falošný
    srv2 = s2.srv;
    const adm2 = {};
    await j(s2.base, '/api/login', { method: 'POST', body: { email: 'qa.lc.admin@qa-biz.local', password: 'Heslo123!' } }, adm2);
    const c3 = await j(s2.base, '/api/admin/qa/run-event-mail/lastcall', { method: 'POST' }, adm2);
    ok('keď sa otvorenia nedajú zistiť, NEposiela sa nikomu',
      !(c3.d && c3.d.selected || []).length, JSON.stringify(c3.d));
    ok('a vlna to povie chybou, nie tichým preskočením',
      c3.d && c3.d.error === 'brevo_opens', JSON.stringify(c3.d));
    fs.rmSync(DATA2, { recursive: true, force: true });

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill(); if (srv2) srv2.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nDOBEHOVÁ VLNA: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
