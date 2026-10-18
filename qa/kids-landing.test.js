/**
 * Detský landing /prva-hodina-kids (18. 10. 2026)
 *
 * Dospelý landing deti zámerne nepúšťa (MIMO_LANDING), takže reklama na Zumba Kids
 * nemala kam viesť. Tento tok rezervuje DIEŤA: rodič zadá jeho meno a rok narodenia,
 * účet dostane rodič a dieťa vznikne pod ním. Skúška sa detí netýka — ponuka je
 * prvá hodina zadarmo.
 *
 * Stráži, že:
 *   · rozvrh vracia len detské hodiny, s vekovou skupinou a cenou z MEMBERSHIP_PLANS
 *   · rezervácia založí rodiča (s heslom), dieťa pod ním a rezerváciu na dieťa
 *   · dieťa dostane skupinu podľa vybranej hodiny, ale NIE automatické rezervácie navyše
 *   · rodič je po odoslaní prihlásený a dostane odkaz /vstup/ na prihlásenie z mailu
 *   · dvojklik nezaloží druhé dieťa ani druhú rezerváciu
 *   · validácie: e-mail, rok narodenia, meno dieťaťa
 *   · dospelý landing detskú hodinu neponúka
 *
 * Spustenie:  node qa/kids-landing.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4601;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-kids-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const jar = {};
const cookieHdr = () => Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
const j = async (url, opts = {}) => {
  const r = await fetch(BASE + url, { redirect: 'manual', headers: { 'Content-Type': 'application/json', 'Cookie': cookieHdr(), ...(opts.headers || {}) }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); });
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d, headers: r.headers };
};
const riadky = (file, needle) => { try { return fs.readFileSync(path.join(DATA, file), 'utf8').split('\n').filter(l => l.includes(needle)).map(l => JSON.parse(l)); } catch (e) { return []; } };

(async () => {
  console.log('DETSKÝ LANDING — štart servera…');
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
    console.log('\n1) Stránka a rozvrh:');
    const page = await j('/prva-hodina-kids');
    ok('/prva-hodina-kids je 200', page.status === 200);
    const sc = await j('/api/first-class/kids-schedule');
    const items = (sc.d && sc.d.items) || [];
    ok('rozvrh vracia detské termíny', sc.d && sc.d.ok && items.length > 0, 'termínov: ' + items.length);
    ok('každý termín má vekovú skupinu', items.every(i => i.skupina && /Kids/.test(i.skupina)),
      JSON.stringify(items.map(i => i.skupina)));
    ok('vek je pri termíne (4–6 / 7–14)', items.some(i => /\d+/.test(i.vek || '')), JSON.stringify(items.map(i => i.vek)));
    ok('cena je z cenníka appky (49,90 / 54,90)', sc.d.cena && sc.d.cena.auto === 49.9 && sc.d.cena.manual === 54.9,
      JSON.stringify(sc.d.cena));
    // Marek 18. 10.: kým detí nie je dosť na dve skupiny, chodia všetky na jednu hodinu.
    const skupiny = [...new Set(items.map(i => i.skupina))];
    ok('beží jediná spoločná skupina', skupiny.length === 1 && skupiny[0] === 'Kids', JSON.stringify(skupiny));
    ok('spoločná skupina je 4–14', items.every(i => i.vek === '4–14'), JSON.stringify([...new Set(items.map(i => i.vek))]));
    ok('stará skupina 4–6 sa už neponúka', items.every(i => !/Kids 1|\(4–6\)/.test(i.name)),
      JSON.stringify(items.map(i => i.name)));
    ok('zostali oba dni (piatok aj nedeľa)', new Set(items.map(i => i.day_name)).size === 2,
      JSON.stringify([...new Set(items.map(i => i.day_name))]));
    const dospely = await j('/api/first-class/schedule');
    ok('dospelý landing detské hodiny neponúka',
      ((dospely.d && dospely.d.items) || []).every(i => !/kids|deti/i.test(i.name)));

    console.log('\n2) Rezervácia dieťaťa:');
    const sess = items[0];
    const bk = await j('/api/first-class/book-kids', { method: 'POST', body: {
      child_name: 'Natálka Qa', birth_year: 2017, parent_name: 'Jana Qa Rodicova',
      email: 'qa.kids.rodic@qa-biz.local', class_id: sess.class_id, booking_date: sess.date,
      attribution: { utm_source: 'fb', utm_campaign: 'qa-kids-detva', fbclid: 'fb.qa.kids' } } });
    ok('rezervácia prešla', bk.status === 200 && bk.d && bk.d.ok, JSON.stringify(bk.d).slice(0, 160));
    ok('vrátilo heslo pre rodiča', /^Zumba\d{4}$/.test((bk.d || {}).heslo || ''));
    ok('vrátilo prihlasovací odkaz /vstup/', /\/vstup\/VS[0-9a-f]{32}/.test((bk.d || {}).vstup_url || ''));

    const rodic = riadky('users.db', 'qa.kids.rodic@qa-biz.local').pop();
    ok('rodič má účet s heslom a atribúciou', !!rodic && !!rodic.password && rodic.utm_campaign === 'qa-kids-detva'
      && rodic.account_creation_type === 'self_registration', JSON.stringify({ p: !!(rodic || {}).password, u: (rodic || {}).utm_campaign }));
    const deti = riadky('users.db', '"parent_id":"' + rodic._id + '"');
    const dieta = deti.filter(d => d.name === 'Natálka Qa').pop();
    ok('dieťa vzniklo pod rodičom', !!dieta && dieta.is_child === true && dieta.birth_year === 2017,
      JSON.stringify({ n: (dieta || {}).name, r: (dieta || {}).birth_year }));
    ok('dieťa má skupinu podľa hodiny', !!dieta && /Kids/.test(dieta.kids_group || ''), (dieta || {}).kids_group);
    ok('dieťa NEMÁ automatické hodiny navyše', !dieta.auto_classes || dieta.auto_classes.length === 0,
      JSON.stringify((dieta || {}).auto_classes));

    const b = riadky('bookings.db', dieta._id).filter(x => x.class_id === sess.class_id).pop();
    ok('rezervácia je na dieťa, platí rodič', !!b && b.user_id === dieta._id && b.booked_by === rodic._id
      && b.is_child_booking === true, JSON.stringify({ u: (b || {}).user_id === dieta._id, by: (b || {}).booked_by === rodic._id }));
    ok('prvá hodina je zadarmo a zo správneho zdroja', !!b && b.free_class === true && b.source === 'prva-hodina-kids'
      && b.status === 'confirmed');
    const me = await j('/api/me');
    ok('rodič je po odoslaní prihlásený', me.d && me.d.id === rodic._id);
    ok('krok booking_ok + register_ok zo stránky kids',
      riadky('funnel_events.db', '"/prva-hodina-kids"').some(e => e.krok === 'booking_ok')
      && riadky('funnel_events.db', '"/prva-hodina-kids"').some(e => e.krok === 'register_ok'));

    console.log('\n3) Dvojklik a duplicita:');
    const znova = await j('/api/first-class/book-kids', { method: 'POST', body: {
      child_name: 'Natálka Qa', birth_year: 2017, parent_name: 'Jana Qa Rodicova',
      email: 'qa.kids.rodic@qa-biz.local', class_id: sess.class_id, booking_date: sess.date } });
    ok('druhá rovnaká rezervácia je odmietnutá (409)', znova.status === 409, JSON.stringify(znova.d));
    // NeDB je append-only: ten istý dokument je v súbore po každom update znova,
    // takže sa počítajú unikátne _id, nie riadky.
    const detiPo = new Set(riadky('users.db', '"parent_id":"' + rodic._id + '"')
      .filter(d => d.name === 'Natálka Qa').map(d => d._id));
    ok('nevzniklo druhé dieťa s tým istým menom', detiPo.size === 1, 'detí: ' + detiPo.size);

    console.log('\n4) Validácie:');
    const bezMailu = await j('/api/first-class/book-kids', { method: 'POST', body: {
      child_name: 'Testko', birth_year: 2018, parent_name: 'Rodic Test', email: '0900123456',
      class_id: sess.class_id, booking_date: sess.date } });
    ok('telefón namiesto e-mailu neprejde (400)', bezMailu.status === 400);
    const bezRoku = await j('/api/first-class/book-kids', { method: 'POST', body: {
      child_name: 'Testko', parent_name: 'Rodic Test', email: 'qa.kids.bezroku@qa-biz.local',
      class_id: sess.class_id, booking_date: sess.date } });
    ok('bez roku narodenia to neprejde (400)', bezRoku.status === 400, JSON.stringify(bezRoku.d));
    const bezMena = await j('/api/first-class/book-kids', { method: 'POST', body: {
      child_name: '', birth_year: 2018, parent_name: 'Rodic Test', email: 'qa.kids.bezmena@qa-biz.local',
      class_id: sess.class_id, booking_date: sess.date } });
    ok('bez mena dieťaťa to neprejde (400)', bezMena.status === 400);
    const dospelaHodina = ((dospely.d && dospely.d.items) || [])[0];
    if (dospelaHodina) {
      const zle = await j('/api/first-class/book-kids', { method: 'POST', body: {
        child_name: 'Testko', birth_year: 2018, parent_name: 'Rodic Test', email: 'qa.kids.dospela@qa-biz.local',
        class_id: dospelaHodina.class_id, booking_date: dospelaHodina.date } });
      ok('dospelú hodinu cez detský formulár rezervovať nejde (404)', zle.status === 404, JSON.stringify(zle.d));
    }
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nDETSKÝ LANDING: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-800));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
