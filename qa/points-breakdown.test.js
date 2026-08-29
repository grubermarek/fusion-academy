/**
 * Rozpis bodov musí sedieť všade rovnako.
 * Marek 29. 8.: v rebríčku klientky mesiaca ukazovalo „Denný hlavolam · 0× vyriešený",
 * hoci hráčka hádanky riešila — /api/client/spotlight si body z hlavolamu vôbec nerátal.
 * Test drží pod krkom to, čo sa dá ľahko znovu pokaziť: každý zdroj rozpisu
 * (profil aj rebríček) musí dať rovnaké položky aj rovnaký súčet.
 * Spustenie:  node qa/points-breakdown.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4512;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-pb-'));

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
// hľadanie položky podľa kúska názvu — bez regexu, nech test neťaží escapovaním
const polozka = (items, kus) => (items || []).find(i => String(i.label || '').toLowerCase().includes(kus.toLowerCase())) || null;

(async () => {
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const MES = DNES.slice(0, 7);
  const den = n => { const d = new Date(DNES + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  // ostávame v tom istom mesiaci, nech test nespadne 1. dňa v mesiaci
  const dni = [...new Set([DNES, den(1), den(2)].filter(d => d.slice(0, 7) === MES))];

  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = 'qaBodyRozpis0001';
  fs.writeFileSync(path.join(DATA, 'users.db'), JSON.stringify({
    _id: U, name: 'Zuzana Rozpisova', email: 'qa.rozpis@qa-biz.local', phone: '', password: hash,
    referral_code: 'QARZ01', sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: 'client',
    visit_count: 3, referral_credit: 0, lead_source: 'qa', created_at: '2026-07-01', city: 'Detva',
    account_creation_type: 'self_registration',
  }) + '\n');

  // hádanky: rôzne dni v tomto mesiaci, spolu známy počet bodov
  const BODY = [2, 3, 2].slice(0, dni.length);
  const SUM_BODY = BODY.reduce((a, b) => a + b, 0);
  fs.writeFileSync(path.join(DATA, 'puzzle_solves.db'),
    dni.map((d, i) => JSON.stringify({
      _id: 'qaSolve000' + i, user_id: U, user_name: 'Zuzana Rozpisova', date: d, month: d.slice(0, 7),
      seconds: 40 + i, points: BODY[i], verified: true, type: 'zip', created_at: d + 'T10:00:00.000Z',
    })).join('\n') + '\n');

  // koleso — položka, ktorá fungovala aj predtým; dáva sa s čím porovnávať
  fs.writeFileSync(path.join(DATA, 'spins.db'), JSON.stringify({
    _id: 'qaSpin0001', user_id: U, date: DNES, month: MES, points: 1, milestone: false, created_at: DNES + 'T09:00:00.000Z',
  }) + '\n');

  console.log('ROZPIS BODOV QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    const jar = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.rozpis@qa-biz.local', password: 'Heslo123!' } }, jar);
    ok('prihlásenie', lg.status === 200, JSON.stringify(lg.d));

    // ── 1) profil (monthlyPointsFor) ──
    const pr = await j('/api/profile/' + U, {}, jar);
    const pItems = pr.d && pr.d.points && pr.d.points.items;
    const pPuz = polozka(pItems, 'hlavolam');
    ok('profil: rozpis obsahuje hlavolam', !!pPuz, JSON.stringify(pItems && pItems.map(i => i.label)));
    ok('profil: počet vyriešení = ' + dni.length, pPuz && pPuz.count === dni.length, pPuz && String(pPuz.count));
    ok('profil: body z hlavolamu = ' + SUM_BODY, pPuz && pPuz.points === SUM_BODY, pPuz && String(pPuz.points));
    ok('profil: podtext nehovorí 0×', pPuz && pPuz.sub && pPuz.sub.indexOf('0×') !== 0, pPuz && pPuz.sub);
    const pSpin = polozka(pItems, 'denné odmeny');
    ok('profil: koleso sa ráta', pSpin && pSpin.count === 1 && pSpin.points === 1, JSON.stringify(pSpin));

    // ── 2) rebríček klientky mesiaca (spotlight) — tu bola chyba ──
    const sp = await j('/api/client/spotlight', {}, jar);
    const my = sp.d && sp.d.myMonth;
    const sItems = my && my.breakdown;
    const sPuz = polozka(sItems, 'hlavolam');
    ok('rebríček: klientka je v poradí', my && my.rank >= 1, JSON.stringify(my && { rank: my.rank, points: my.points }));
    ok('rebríček: rozpis obsahuje hlavolam', !!sPuz, JSON.stringify(sItems && sItems.map(i => i.label)));
    ok('rebríček: počet vyriešení = ' + dni.length, sPuz && sPuz.count === dni.length, sPuz && String(sPuz.count));
    ok('rebríček: body z hlavolamu = ' + SUM_BODY, sPuz && sPuz.points === SUM_BODY, sPuz && String(sPuz.points));
    ok('rebríček: podtext nehovorí 0×', sPuz && sPuz.sub && sPuz.sub.indexOf('0×') !== 0, sPuz && sPuz.sub);

    // ── 3) oba zdroje musia dať to isté ──
    ok('súčet bodov sedí medzi profilom a rebríčkom',
      pr.d.points.total === my.points, pr.d.points.total + ' vs ' + my.points);
    const nesedi = (pItems || []).filter(i => {
      const s = polozka(sItems, i.label);
      return !s || s.count !== i.count || s.points !== i.points;
    }).map(i => i.label);
    ok('všetky položky rozpisu sedia 1:1', nesedi.length === 0, nesedi.join(', '));

    // ── 4) v top rebríčku má tá istá klientka rovnaké skóre ──
    const vTop = (sp.d.topMonth || []).find(x => x.id === U);
    ok('skóre v top rebríčku sedí s „Tvoje body"', vTop && vTop.points === my.points,
      JSON.stringify(vTop && { p: vTop.points, my: my.points }));
    const tPuz = vTop && polozka(vTop.breakdown, 'hlavolam');
    ok('top rebríček: hlavolam v rozpise sedí', tPuz && tPuz.points === SUM_BODY, tPuz && String(tPuz.points));

    // ── 5) ročný rebríček ráta hádanky rovnako ──
    const myY = sp.d && sp.d.myYear;
    const yPuz = polozka(myY && myY.breakdown, 'hlavolam');
    ok('ročný rebríček: hlavolam sa ráta', yPuz && yPuz.points === SUM_BODY, yPuz && String(yPuz.points));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    console.log('\nROZPIS BODOV: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
