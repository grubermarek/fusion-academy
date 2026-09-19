/**
 * Ambasádorská sekcia — provízie nemiznú, výplata funguje, sadzba sedí (19. 9. 2026).
 *
 * Čo sa pokazilo a čo test stráži:
 *  1. Provízia po 14-dňovej lehote prešla na 'approved' a z appky ZMIZLA —
 *     dostupný kredit rátal len 'pending' + referral_credit. Teraz sa dozretá
 *     provízia pripíše do kreditu (aj spätne pre už 'approved') a zapíše do ledgeru.
 *  2. Výplata na účet brala aj čakajúce provízie (obišla lehotu) a tlačidlo
 *     „Požiadať o výplatu" viedlo na dashboard, kde ambasádorka sekciu s kreditom
 *     nevidí. Teraz ide na účet len pripísaný kredit a modál je priamo v sekcii.
 *  3. Zobrazená sadzba bola z bežiaceho mesiaca (prvého vždy 10 %), engine platí
 *     podľa uzávierky minulého mesiaca. Teraz sa ukazuje reálna sadzba + kam smeruje.
 *  4. Uzávierka mesiaca posiela bilanciu (body, provízie, sadzba na ďalší mesiac).
 *  5. Stránka školenia a zamknutá sekcia neukazujú natvrdo prešlý 28. august —
 *     termín sa berie z najbližšieho eventu skolenie-*.
 *
 * Spustenie:  node qa/ambasador-motivacia.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4551;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-amb-mot-'));

let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const readDb = name => fs.existsSync(path.join(DATA, name + '.db'))
  ? fs.readFileSync(path.join(DATA, name + '.db'), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean)
  : [];
// NeDB append-only: posledný záznam s daným _id je platný
const latest = (rows, id) => rows.filter(r => r._id === id).pop();

const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
const MESIAC = DNES.slice(0, 7);
const MINULY = (() => { const d = new Date(+MESIAC.slice(0, 4), +MESIAC.slice(5, 7) - 1 - 1, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })();
const isoAgo = days => new Date(Date.now() - days * 86400000).toISOString();
const plusDays = (iso, days) => new Date(new Date(iso).getTime() + days * 86400000).toISOString().slice(0, 10);

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const LEA = 'qaAmbLea0000001', KLI = 'qaAmbKli0000001', ADM = 'qaAmbAdm0000001', ZUZ = 'qaAmbZuz0000001', DVE = 'qaAmbDve0000001';
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: ADM, name: 'Adam Admin', email: 'qa.amb2.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }),
    // ambasádorka: uzávierka minulého mesiaca jej dala Partner (11 %)
    JSON.stringify({ _id: LEA, name: 'Lea Testova', email: 'qa.amb2.lea@qa-biz.local',
      password: hash, user_type: 'ambassador', active: true, referral_code: 'QAAMB2', amb_rank: 2,
      referral_credit: 0, ambassador_since: '2026-03-01', created_at: '2026-02-01', visit_count: 12 }),
    // jej klientka — v minulom mesiaci zaplatila (objem línie)
    JSON.stringify({ _id: KLI, name: 'Klara Klientka', email: 'qa.amb2.klara@qa-biz.local',
      password: hash, user_type: 'client', active: true, referral_code: 'QAKLI2', sponsor_id: LEA,
      visit_count: 3, created_at: '2026-04-01', membership_expires: '2027-12-31T00:00:00.000Z', membership_plan: 'bronze' }),
    // bežná klientka s 3 platiacimi kamoškami → má dostať ponuku školenia
    JSON.stringify({ _id: ZUZ, name: 'Zuzana Aktivna', email: 'qa.amb2.zuzka@qa-biz.local',
      password: hash, user_type: 'client', active: true, referral_code: 'QAZUZ2', visit_count: 20, created_at: '2026-03-01' }),
    ...[1, 2, 3].map(i => JSON.stringify({ _id: 'qaAmbKam000000' + i, name: 'Kamoska Cislo' + i, email: 'qa.amb2.kam' + i + '@qa-biz.local',
      password: hash, user_type: 'client', active: true, referral_code: 'QAKAM' + i, sponsor_id: ZUZ, visit_count: 2, created_at: '2026-08-1' + i })),
    // klientka s 3 kamoškami, z ktorých platia len 2 → ponuka nie
    JSON.stringify({ _id: DVE, name: 'Dana Dvojka', email: 'qa.amb2.dana@qa-biz.local',
      password: hash, user_type: 'client', active: true, referral_code: 'QADVE2', visit_count: 5, created_at: '2026-03-01' }),
    ...[1, 2, 3].map(i => JSON.stringify({ _id: 'qaAmbDka000000' + i, name: 'Danina Kamoska' + i, email: 'qa.amb2.dka' + i + '@qa-biz.local',
      password: hash, user_type: 'client', active: true, referral_code: 'QADKA' + i, sponsor_id: DVE, visit_count: 1, created_at: '2026-08-1' + i })),
  ].join('\n') + '\n');

  const c1at = isoAgo(20), c2at = isoAgo(2);
  fs.writeFileSync(path.join(DATA, 'commissions.db'), [
    // dozretá (20 dní) — musí sa pripísať
    JSON.stringify({ _id: 'qaAmbC1', partner_id: LEA, transaction_id: 'qaTx1', level: 0, percentage: 0.11, amount: 60,
      status: 'pending', month: c1at.slice(0, 7), created_at: c1at }),
    // čerstvá (2 dni) — čaká, nesmie sa vyplatiť
    JSON.stringify({ _id: 'qaAmbC2', partner_id: LEA, transaction_id: 'qaTx2', level: 0, percentage: 0.11, amount: 30,
      status: 'pending', month: c2at.slice(0, 7), created_at: c2at }),
    // už 'approved' spred opravy (bez credited_at) — zachytí ju backfill
    JSON.stringify({ _id: 'qaAmbC3', partner_id: LEA, transaction_id: 'qaTx3', level: 0, percentage: 0.11, amount: 50,
      status: 'approved', approved_at: isoAgo(10), month: isoAgo(25).slice(0, 7), created_at: isoAgo(25) }),
  ].join('\n') + '\n');

  fs.writeFileSync(path.join(DATA, 'transactions.db'), [
    JSON.stringify({ _id: 'qaAmbTx01', type: 'membership', user_id: KLI, user_name: 'Klara Klientka', amount: 1600,
      payment_method: 'stripe', date: MINULY + '-10', month: MINULY, created_at: MINULY + '-10T10:00:00.000Z' }),
    // Zuzkine 3 kamošky platia, Danine len 2
    ...[1, 2, 3].map(i => JSON.stringify({ _id: 'qaAmbTxK' + i, type: 'membership', user_id: 'qaAmbKam000000' + i, user_name: 'Kamoska Cislo' + i,
      amount: 49.9, payment_method: 'stripe', date: MESIAC + '-02', month: MESIAC, created_at: MESIAC + '-02T10:00:00.000Z' })),
    ...[1, 2].map(i => JSON.stringify({ _id: 'qaAmbTxD' + i, type: 'single_entry', user_id: 'qaAmbDka000000' + i, user_name: 'Danina Kamoska' + i,
      amount: 10, payment_method: 'cash', date: MESIAC + '-02', month: MESIAC, created_at: MESIAC + '-02T10:00:00.000Z' })),
  ].join('\n') + '\n');

  // budúce školenie — stránka aj zámok si termín berú odtiaľto
  fs.writeFileSync(path.join(DATA, 'ev_events.db'), [
    JSON.stringify({ _id: 'qaAmbEv001', slug: 'skolenie-qa-2027', name: 'QA ŠKOLENIE', date: '2027-01-15',
      date_label: '15. január 2027 · 16:00', venue: 'Fusion Academy Detva', address: 'Záhradná 7, Detva', active: true,
      types: [{ key: 'full', name: 'ŠKOLENIE', presale: 15, door: 15 }], created_at: '2026-09-01T00:00:00.000Z' }),
  ].join('\n') + '\n');

  console.log('AMBASÁDORKY — MOTIVÁCIA QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  try {
    // backfill 'approved' provízií beží 6 s po štarte
    await sleep(7500);

    const lea = {}, adm = {};
    ok('ambasádorka prihlásená', (await j('/api/login', { method: 'POST', body: { email: 'qa.amb2.lea@qa-biz.local', password: 'Heslo123!' } }, lea)).status === 200);
    ok('admin prihlásený', (await j('/api/login', { method: 'POST', body: { email: 'qa.amb2.admin@qa-biz.local', password: 'Heslo123!' } }, adm)).status === 200);

    console.log('\n1) Provízia po lehote NEMIZNE — pripíše sa do kreditu:');
    let me = (await j('/api/ambassador/me', {}, lea)).d;
    ok('panel odpovedá', me && me.ok, JSON.stringify(me && me.error));
    ok('spätne pripísaná už „approved" provízia 50 €', me.credit === 50, 'credit=' + me.credit);
    ok('dve čakajúce provízie (60 + 30) sú vidieť zvlášť', me.credit_pending === 90, 'pending=' + me.credit_pending);
    ok('vie, kedy sa prvá pripíše', me.pending_release === plusDays(c1at, 14), me.pending_release + ' vs ' + plusDays(c1at, 14));

    const run1 = (await j('/api/admin/ambassadors/run-daily', { method: 'POST', body: {} }, adm)).d;
    ok('denná úloha pripísala 1 dozretú províziu', run1 && run1.ok && run1.approved === 1, JSON.stringify(run1));
    me = (await j('/api/ambassador/me', {}, lea)).d;
    ok('kredit narástol na 110 € (50 + 60)', me.credit === 110, 'credit=' + me.credit);
    ok('čaká už len 30 € (čerstvá provízia)', me.credit_pending === 30, 'pending=' + me.credit_pending);
    ok('termín pripísania sa posunul na čerstvú', me.pending_release === plusDays(c2at, 14), me.pending_release);
    ok('ambasádorka dostala oznam o pripísaní', (me.notifications || []).some(n => /Provízie pripísané do kreditu: \+60\.00 €/.test(n.title)),
      JSON.stringify((me.notifications || []).map(n => n.title)));
    const mesC1 = c1at.slice(0, 7);
    const rowC1 = (me.earnings || []).find(x => x.month === mesC1);
    ok('zárobky mesiaca rozlišujú pripísané a čakajúce', rowC1 && rowC1.credited >= 60, JSON.stringify(rowC1));
    const ledger = readDb('credit_ledger').filter(r => r.user_id === LEA);
    ok('ledger má +50 (backfill) aj +60 (lehota)', ledger.some(r => r.delta === 50) && ledger.some(r => r.delta === 60),
      JSON.stringify(ledger.map(r => r.delta + ' ' + r.reason)));
    ok('druhé spustenie nič nepripíše dvakrát', (await j('/api/admin/ambassadors/run-daily', { method: 'POST', body: {} }, adm)).d.approved === 0);
    ok('kredit ostal 110 €', (await j('/api/ambassador/me', {}, lea)).d.credit === 110);

    console.log('\n2) Výplata na účet — len pripísaný kredit, priamo zo sekcie:');
    const po = await j('/api/client/referral-credit/payout', { method: 'POST',
      body: { amount: 100, iban: 'SK3112000000198742637541', name: 'Lea Testova' } }, lea);
    ok('žiadosť o 100 € prešla', po.status === 200 && po.d && po.d.ok, JSON.stringify(po.d));
    ok('zvyšok kreditu 10 €', po.d && po.d.remaining === 10, 'remaining=' + (po.d && po.d.remaining));
    me = (await j('/api/ambassador/me', {}, lea)).d;
    ok('čakajúca provízia 30 € ostala čakať (lehota sa neobišla)', me.credit_pending === 30, 'pending=' + me.credit_pending);
    ok('čerstvá provízia je stále pending v DB', (latest(readDb('commissions'), 'qaAmbC2') || {}).status === 'pending');
    ok('výplata je v histórii ako čakajúca', (me.payouts || [])[0] && me.payouts[0].amount === 100 && me.payouts[0].status === 'pending', JSON.stringify(me.payouts));
    ok('IBAN sa predvyplní nabudúce', me.bank_account === 'SK3112000000198742637541');
    ok('ledger má −100 za výplatu', readDb('credit_ledger').some(r => r.user_id === LEA && r.delta === -100));
    const po2 = await j('/api/client/referral-credit/payout', { method: 'POST',
      body: { amount: 100, iban: 'SK3112000000198742637541', name: 'Lea Testova' } }, lea);
    ok('druhá žiadosť pod 100 € je odmietnutá', po2.status === 400, JSON.stringify(po2.d));
    ok('a vysvetlí, že 30 € ešte čaká na lehotu', po2.d && /čaká/.test(po2.d.error || ''), po2.d && po2.d.error);
    const ref = (await j('/api/client/referral', {}, lea)).d;
    ok('dashboardový „dostupný kredit" sedí s pripísaným (10 €)', ref && ref.available_credit === 10, JSON.stringify(ref && ref.available_credit));

    console.log('\n3) Sadzba = to, čo engine reálne platí (uzávierka minulého mesiaca):');
    ok('sadzba 11 % podľa amb_rank (Partner), nie 10 % z prázdneho mesiaca', me.rate === 0.11 && me.rate_rank_name === 'Partner',
      'rate=' + me.rate + ' ' + me.rate_rank_name);
    ok('vidí, kam smeruje (bežiaci mesiac = 0 b → 10 %)', me.rate_next === 0.10, 'rate_next=' + me.rate_next);
    ok('lehota je v odpovedi (14 dní)', me.hold_days === 14);

    console.log('\n4) Uzávierka mesiaca — bilancia a nová sadzba:');
    const run2 = (await j('/api/admin/ambassadors/run-daily', { method: 'POST', body: { month: MINULY } }, adm)).d;
    ok('minulý mesiac uzavretý', run2 && run2.ok && run2.closed >= 1, JSON.stringify(run2));
    me = (await j('/api/ambassador/me', {}, lea)).d;
    ok('1 600 b v línii → Senior Partner → sadzba 12 %', me.rate === 0.12 && me.rate_rank_name === 'Senior Partner',
      'rate=' + me.rate + ' ' + me.rate_rank_name);
    const uz = (me.notifications || []).find(n => n.title === '📕 Uzávierka ' + MINULY + ': 1600 bodov');
    ok('prišla bilancia mesiaca', !!uz, JSON.stringify((me.notifications || []).map(n => n.title)));
    ok('bilancia hovorí sadzbu na ďalší mesiac', uz && /Sadzba na ďalší mesiac: 12 %/.test(uz.body), uz && uz.body);
    ok('a čo chýbalo do ďalšej hviezdy (1 800 − 1 600)', uz && /chýbalo 200 b/.test(uz.body), uz && uz.body);
    ok('medaila ostala Senior Partner', me.rank && me.rank.name === 'Senior Partner', JSON.stringify(me.rank && me.rank.name));

    console.log('\n5) Školenie — termín z eventu, nie natvrdo:');
    const tr = (await j('/api/public/ambassador-training')).d;
    // seed appky má školenie 25. 9. 2026 (20:00); kým neprešlo, je najbližšie ono, potom QA event 2027
    const skol26 = DNES <= '2026-09-25';
    const expSlug = skol26 ? 'skolenie-ambasador-2026-09' : 'skolenie-qa-2027';
    const expLabel = skol26 ? '25. september 2026 · 20:00' : '15. január 2027 · 16:00';
    ok('verejný endpoint vráti najbližšie školenie', tr && tr.ok && tr.next && tr.next.slug === expSlug, JSON.stringify(tr));
    ok('s termínom, miestom a cenou', tr.next.date_label === expLabel && tr.next.venue === 'Fusion Academy Detva' && tr.next.price === 15, JSON.stringify(tr.next));
    ok('s odkazom na kúpu miesta', tr.next.url === '/event/' + expSlug + '?src=app');
    const kli = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.amb2.klara@qa-biz.local', password: 'Heslo123!' } }, kli);
    ok('klientka bez prístupu dostane 403 (zámok, nie chyba)', (await j('/api/ambassador/me', {}, kli)).status === 403);

    console.log('\n6) Admin hub vidí, kto je blízko ďalšej hodnosti:');
    const hub = (await j('/api/admin/ambassadors', {}, adm)).d;
    const row = hub && (hub.members || []).find(m => m.id === LEA);
    ok('riadok ambasádorky má hodnosť a sadzbu', row && row.hodnost === 'Senior Partner' && row.sadzba === 12, JSON.stringify(row));
    ok('a koľko chýba do ďalšieho stupňa', row && row.dalsia && row.dalsia.missing === 200, JSON.stringify(row && row.dalsia));

    console.log('\n7) Materiály a texty:');
    const mat = (await j('/api/ambassador/materials', {}, lea)).d;
    ok('materiály obsahujú jej odkaz', mat && mat.ok && mat.materials.some(m => (m.text || '').includes('/invite/QAAMB2')));
    const amb = fs.readFileSync(path.join(__dirname, '..', 'public', 'ambasador.html'), 'utf8');
    ok('výplata má modál priamo v sekcii', /function openPayout\(/.test(amb) && /onclick="openPayout\(\)"/.test(amb));
    ok('odkaz na dashboard#struktura je preč', !/client-dashboard#struktura/.test(amb));
    ok('správa v appke otvára DM (?dm=)', /community\?dm=/.test(amb) && !/community\?to=/.test(amb));
    ok('„doladíme na školení" je preč', !/doladíme na školení/.test(amb));
    ok('čakajúce provízie sú označené lehotou', /Čaká na '\+hold\+'-dňovú lehotu/.test(amb));
    const sk = fs.readFileSync(path.join(__dirname, '..', 'public', 'skolenie.html'), 'utf8');
    const cd = fs.readFileSync(path.join(__dirname, '..', 'public', 'client-dashboard.html'), 'utf8');
    ok('školenie nemá natvrdo 28. august', !/28\. august/.test(sk) && /ambassador-training/.test(sk));
    ok('dashboard nemá natvrdo 28. august', !/28\. august/.test(cd));

    console.log('\n8) Automatická ponuka školenia po 3 platiacich kamoškách:');
    const run3 = (await j('/api/admin/ambassadors/run-daily', { method: 'POST', body: { offers: true } }, adm)).d;
    ok('ponuka odišla presne jednej klientke (Zuzka)', run3 && run3.offers === 1, JSON.stringify(run3));
    const zuz = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.amb2.zuzka@qa-biz.local', password: 'Heslo123!' } }, zuz);
    const zn = (await j('/api/notifications', {}, zuz)).d;
    const zList = Array.isArray(zn) ? zn : (zn && (zn.notifications || zn.items)) || [];
    const ponuka = zList.find(x => x.type === 'ambassador_offer');
    ok('Zuzka má oznam s ponukou školenia', !!ponuka, JSON.stringify(zList.map(x => x.title)).slice(0, 300));
    ok('oznam hovorí termín z eventu', ponuka && new RegExp(expLabel.replace(/[.·]/g, '.')).test(ponuka.body), ponuka && ponuka.body);
    ok('oznam vedie na /skolenie', ponuka && ponuka.link === '/skolenie');
    const dana = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.amb2.dana@qa-biz.local', password: 'Heslo123!' } }, dana);
    const dn = (await j('/api/notifications', {}, dana)).d;
    const dList = Array.isArray(dn) ? dn : (dn && (dn.notifications || dn.items)) || [];
    ok('Dana (len 2 platiace) ponuku nedostala', !dList.some(x => x.type === 'ambassador_offer'));
    const an = (await j('/api/notifications', {}, adm)).d;
    const aList = Array.isArray(an) ? an : (an && (an.notifications || an.items)) || [];
    ok('admin dostal tip, komu zavolať', aList.some(x => x.type === 'ambassador_offer' && /Zuzana Aktivna/.test(x.title)));
    const run4 = (await j('/api/admin/ambassadors/run-daily', { method: 'POST', body: { offers: true } }, adm)).d;
    ok('druhý beh ponuku neposiela znova', run4 && run4.offers === 0, JSON.stringify(run4));

    console.log('\n9) Týždenný súhrn ambasádorkám:');
    const run5 = (await j('/api/admin/ambassadors/run-daily', { method: 'POST', body: { weekly: true } }, adm)).d;
    ok('súhrn odišiel ambasádorke (nie adminovi)', run5 && run5.weekly === 1, JSON.stringify(run5));
    me = (await j('/api/ambassador/me', {}, lea)).d;
    const tyz = (me.notifications || []).find(n => /^📬 Týždenný súhrn/.test(n.title));
    ok('Lea má oznam so súhrnom', !!tyz, JSON.stringify((me.notifications || []).map(n => n.title)));
    ok('súhrn obsahuje sadzbu 12 % a hodnosť', tyz && /Sadzba: 12 %/.test(tyz.body) && /Senior Partner/.test(tyz.body), tyz && tyz.body);
    ok('a stav kreditu s čakajúcou províziou', tyz && /Kredit: 10\.00 € \+ čaká 30\.00 €/.test(tyz.body), tyz && tyz.body);

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 3).join('\n'));
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nAMBASÁDORKY — MOTIVÁCIA: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
