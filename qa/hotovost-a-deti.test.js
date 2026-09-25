/**
 * Marek 25. 9. 2026: „zjednoduš to a oprav chyby" — tri veci, ktoré sa doteraz dali
 * spraviť len cez kód alebo klikaním záznam po zázname:
 *
 *  1) Odovzdaná hotovosť v JEDNEJ sume (napr. „Nelka mi dala 160 €") — rozpustí sa do
 *     najstarších nevyrovnaných výberov, posledný sa v prípade potreby rozdelí.
 *     Keď tréner toľko u seba nemá, `zvysok` povie koľko sa nedalo priradiť.
 *  2) Admin vie rodičovi založiť detský profil (doteraz len rodič vo svojom účte).
 *  3) Individuálna („dohodnutá") cena členstva má konečne tlačidlo v profile klientky.
 *
 * Spustenie:  node qa/hotovost-a-deti.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4547;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-cash-'));
const ROOT = path.join(__dirname, '..');
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
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const rd = f => { const p = path.join(DATA, f); if (!fs.existsSync(p)) return []; const m = new Map();
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l.trim()) continue; let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o.$$indexCreated) continue; if (o.$$deleted) { m.delete(o._id); continue; } m.set(o._id, o); } return [...m.values()]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cash = () => rd('payouts.db').filter(r => r._type === 'cash_collected');
const suma = rows => +rows.reduce((s, r) => s + (+r.amount || 0), 0).toFixed(2);

(async () => {
  console.log('STATICKÉ');
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const adm = fs.readFileSync(path.join(ROOT, 'public', 'admin.html'), 'utf8');
  const prof = fs.readFileSync(path.join(ROOT, 'public', 'profile.html'), 'utf8');
  ok('admin: hotovosť sa dá prevziať jednou sumou', /cashHandoverSum/.test(adm) && /\/api\/admin\/cash\/handover/.test(adm));
  ok('admin: po prevzatí sa najprv prekreslí detail, až potom karta hotovosti (inak zmizne)',
    /renderPayoutDetail\(rd\); loadPayoutCash\(\)/.test(adm));
  ok('profil: tlačidlá na individuálnu cenu a pridanie dieťaťa', /saveCustomPrice/.test(prof) && /function addChild/.test(prof) && /admChildBirth/.test(prof));
  ok('server: detský profil vzniká na jednom mieste (vytvorDieta)', /async function vytvorDieta\(/.test(srv) && /\/api\/admin\/users\/:id\/children/.test(srv));
  ok('zmazaná migrácia, ktorá dávala 30 € nesprávnej Vivien', !/custom_price_vivien_20260819'\}\)\)\)\{/.test(srv));
  ok('prevzatie jedného záznamu zapisuje meno admina, nie „Admin" natvrdo', /settled_by:req\.user\?\.name\|\|'Admin'/.test(srv));

  // ── fixtúry ──
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const zak = { rank: 1, is_admin: false, active: true, visit_count: 0, referral_credit: 0, city: 'Detva' };
  const ADM = 'qaChAdmin00001', TRE = 'qaChTrener0001', TRE2 = 'qaChTrener0002', MAMA = 'qaChMama000001';
  const MES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date()).slice(0, 7);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: ADM, name: 'Admin Hotovosť', email: 'qa.ch.admin@qa-biz.local', password: hash, referral_code: 'QACHADM', ...zak, is_admin: true, user_type: 'admin', created_at: '2026-01-01' },
    { _id: TRE, name: 'Nela Trénerka', email: 'qa.ch.trener@qa-biz.local', password: hash, referral_code: 'QACHTRE', ...zak, user_type: 'trainer', created_at: '2026-02-01' },
    { _id: TRE2, name: 'Dana Trénerka', email: 'qa.ch.trener2@qa-biz.local', password: hash, referral_code: 'QACHTR2', ...zak, user_type: 'trainer', created_at: '2026-02-01' },
    { _id: MAMA, name: 'Jana Rodička', email: 'qa.ch.mama@qa-biz.local', password: hash, referral_code: 'QACHMAM', ...zak, user_type: 'client', created_at: '2026-06-01' },
  ]));
  // Obe trénerky majú u seba 50 + 70 + 60 = 180 € (od najstaršieho výberu).
  // „Nela" je tam kvôli migrácii 25. 9. (Marekových 160 €), „Dana" pre ručné prevzatie.
  const vyber = (id, tid, meno, amount, note, date) => ({ _id: id, _type: 'cash_collected', trainer_id: tid, trainer_name: meno, amount, note, month: MES, date, status: 'held', created_at: date + 'T18:00:00.000Z' });
  fs.writeFileSync(path.join(DATA, 'payouts.db'), riadky([
    vyber('qaChC1', TRE, 'Nela Trénerka', 50, 'Vstupné', '2026-09-02'),
    vyber('qaChC2', TRE, 'Nela Trénerka', 70, 'Členstvo Bronze', '2026-09-10'),
    vyber('qaChC3', TRE, 'Nela Trénerka', 60, 'Súkromná hodina', '2026-09-20'),
    vyber('qaChD1', TRE2, 'Dana Trénerka', 50, 'Vstupné', '2026-09-02'),
    vyber('qaChD2', TRE2, 'Dana Trénerka', 70, 'Členstvo Bronze', '2026-09-10'),
    vyber('qaChD3', TRE2, 'Dana Trénerka', 60, 'Súkromná hodina', '2026-09-20'),
  ]));

  console.log('\nSERVER');
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', STRIPE_FAKE: '1', MAIL_OFF: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await sleep(1000); } }
  await sleep(4000);
  try {
    const aj = {}, mj = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.ch.admin@qa-biz.local', password: 'Heslo123!' } }, aj);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));
    await j('/api/login', { method: 'POST', body: { email: 'qa.ch.mama@qa-biz.local', password: 'Heslo123!' } }, mj);

    // ── 1a) migrácia 25. 9.: „Nelka mi odovzdala 160 €" ──
    const nela = cash().filter(r => r.trainer_name === 'Nela Trénerka');
    const nelaOd = nela.filter(r => r.status === 'settled_handed'), nelaDrz = nela.filter(r => r.status === 'held');
    ok('migrácia uzavrela Nelke presne 160 € (50 + 70 + 40 z rozdeleného)', suma(nelaOd) === 160, JSON.stringify(nelaOd.map(r => [r.amount, r.note])));
    ok('zvyšných 20 € ostalo u nej', suma(nelaDrz) === 20 && nelaDrz.length === 1 && /zvyšok/.test(nelaDrz[0].note || ''), JSON.stringify(nelaDrz.map(r => [r.amount, r.note])));
    ok('rozdelený záznam si nechal trénerku, dátum aj mesiac', nelaOd.every(r => r.trainer_id === TRE && r.month === MES) && nelaOd.some(r => r.amount === 40 && r.date === '2026-09-20'), JSON.stringify(nelaOd.map(r => [r.amount, r.date, r.month])));
    ok('Nelke prišlo oznámenie o prevzatí', rd('notifications.db').some(n => n.user_id === TRE && /Hotovosť prevzatá/.test(n.title || '')));
    ok('výsledok migrácie sa dá spätne prečítať zo settings', (rd('settings.db').find(s => s.key === 'nelka_hotovost_160_20260925') || {}).value?.settled === 160,
      JSON.stringify((rd('settings.db').find(s => s.key === 'nelka_hotovost_160_20260925') || {}).value));

    // ── 1b) to isté ručne z admina (iná trénerka) ──
    const cudzi = await j('/api/admin/cash/handover', { method: 'POST', body: { trainer: 'Dana Trénerka', amount: 160 } }, mj);
    ok('klientka nevie prevziať hotovosť (403)', cudzi.status === 403, 'HTTP ' + cudzi.status);
    const zle = await j('/api/admin/cash/handover', { method: 'POST', body: { trainer: 'Dana Trénerka', amount: 0 } }, aj);
    ok('nulová suma neprejde (400)', zle.status === 400, 'HTTP ' + zle.status);

    const h = await j('/api/admin/cash/handover', { method: 'POST', body: { trainer: 'Dana Trénerka', amount: 160 } }, aj);
    ok('160 € prevzatých, nič neostalo nepriradené', h.status === 200 && h.d.settled === 160 && h.d.zvysok === 0, JSON.stringify(h.d));
    const dana = cash().filter(r => r.trainer_name === 'Dana Trénerka');
    ok('uzavreté presne 160 €, u trénerky ostalo 20 €', suma(dana.filter(r => r.status === 'settled_handed')) === 160 && suma(dana.filter(r => r.status === 'held')) === 20,
      JSON.stringify(dana.map(r => [r.amount, r.status])));
    ok('zápis v audite', rd('audit.db').some(a => a.action === 'cash_handover_sum'), JSON.stringify(rd('audit.db').map(a => a.action)));

    // výplata: zrážka je len zo zvyšných 20 €
    const vyp = await j('/api/admin/payouts?month=' + MES, {}, aj);
    const riadok = ((vyp.d && (vyp.d.rows || vyp.d)) || []).find(r => r.trainer === 'Dana Trénerka');
    ok('vo výplatách sa zráža už len 20 €', riadok && Math.abs((+riadok.cash_deduct || 0) - 20) < 0.01, JSON.stringify(riadok && [riadok.trainer, riadok.cash_deduct]));

    const viac = await j('/api/admin/cash/handover', { method: 'POST', body: { trainer: 'Dana Trénerka', amount: 500 } }, aj);
    ok('keď odovzdá viac, než má u seba: uzavrie sa 20 € a 480 € ostane nepriradených', viac.d.settled === 20 && viac.d.zvysok === 480, JSON.stringify(viac.d));
    const prazdno = await j('/api/admin/cash/handover', { method: 'POST', body: { trainer: 'Dana Trénerka', amount: 10 } }, aj);
    ok('bez nevyrovnanej hotovosti vráti zrozumiteľnú chybu', prazdno.status === 400 && /nevyrovnan/i.test(prazdno.d.error || ''), JSON.stringify(prazdno.d));

    // ── 2) admin založí dieťa rodičovi ──
    const bezDatumu = await j('/api/admin/users/' + MAMA + '/children', { method: 'POST', body: { name: 'Vivien Rodičková' } }, aj);
    ok('bez dátumu narodenia to neprejde', bezDatumu.status === 400 && /dátum narodenia/i.test(bezDatumu.d.error || ''), JSON.stringify(bezDatumu.d));
    const dieta = await j('/api/admin/users/' + MAMA + '/children', { method: 'POST', body: { name: 'Vivien Rodičková', birth_date: '2016-04-05' } }, aj);
    ok('dieťa založené', dieta.status === 200 && dieta.d.ok, JSON.stringify(dieta.d));
    const u = rd('users.db').find(x => x._id === (dieta.d || {}).id);
    ok('dieťa má rodiča, is_child a rok narodenia', u && u.parent_id === MAMA && u.is_child === true && u.birth_year === 2016, JSON.stringify(u && [u.parent_id, u.is_child, u.birth_year]));
    const naDieta = await j('/api/admin/users/' + u._id + '/children', { method: 'POST', body: { name: 'Vnúča', birth_date: '2020-01-01' } }, aj);
    ok('dieťa nemôže mať vlastné dieťa (400)', naDieta.status === 400, 'HTTP ' + naDieta.status);
    const cudziaMama = await j('/api/admin/users/' + MAMA + '/children', { method: 'POST', body: { name: 'Cudzie Dieťa', birth_date: '2016-01-01' } }, mj);
    ok('klientka cez admin endpoint dieťa nezaloží (403)', cudziaMama.status === 403, 'HTTP ' + cudziaMama.status);
    const rodicOv = await j('/api/family/overview', {}, mj);
    ok('rodič vidí dieťa vo svojom prehľade', (rodicOv.d.children || []).some(c => c.id === u._id), JSON.stringify((rodicOv.d.children || []).map(c => c.name)));

    // ── 3) dohodnutá cena z profilu ──
    const cp = await j('/api/admin/users/' + u._id + '/custom-price', { method: 'POST', body: { plan_id: 'bronze', price: 30 } }, aj);
    ok('individuálna cena 30 € uložená', cp.status === 200 && cp.d.custom_prices.bronze === 30, JSON.stringify(cp.d));
    const aw = await j('/api/admin/users/' + MAMA + '/awards', {}, aj);
    const kid = (aw.d.children || []).find(c => c.id === u._id);
    ok('profil rodiča ukáže dieťa aj s dohodnutou cenou', kid && kid.custom_price_bronze === 30, JSON.stringify(aw.d.children));
    const awKid = await j('/api/admin/users/' + u._id + '/awards', {}, aj);
    ok('profil dieťaťa vie, kto je rodič', awKid.d.is_child === true && awKid.d.parent_name === 'Jana Rodička', JSON.stringify([awKid.d.is_child, awKid.d.parent_name]));
    const kup = await j('/api/membership/buy', { method: 'POST', body: { plan_id: 'bronze', payment_method: 'manual', for_child_id: u._id } }, mj);
    ok('rodič platí dohodnutých 30 € (bez prirážky za platbu bez odberu)', kup.status === 200 && Math.abs(kup.d.final_price - 30) < 0.001, 'HTTP ' + kup.status + ' ' + JSON.stringify(kup.d));
    const zrus = await j('/api/admin/users/' + u._id + '/custom-price', { method: 'POST', body: { plan_id: 'bronze', price: null } }, aj);
    ok('výnimka sa dá zrušiť', zrus.status === 200 && !zrus.d.custom_prices, JSON.stringify(zrus.d));
  } catch (e) { failed++; console.log('  ❌ výnimka: ' + (e.stack || e.message)); }
  finally {
    proc.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log(`\n${passed} ✅  ${failed} ❌`);
    if (failed) console.log(log.split('\n').filter(l => /error|chyba/i.test(l)).slice(-15).join('\n'));
    process.exit(failed ? 1 : 0);
  }
})();
