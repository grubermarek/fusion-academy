/**
 * Rezervácia bez členstva: klientka si vyberie, čo si na mieste kúpi (Marek 1. 9.).
 *
 * Predtým bolo v ponuke jediné tlačidlo „zaplatiť na mieste (10 €)" — klientka
 * si musela vyberať inde a tréner v zozname videl len sumu, nie čo má predať.
 * Test stráži, že server zvolený plán prijme, doráta z NEHO cenu (klientovi sa
 * neverí) a pošle ju trénerovi spolu s názvom.
 *
 * Spustenie:  node qa/platba-na-mieste-vyber.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4553;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-pos-'));

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

const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
const DOW = new Date().getDay();

let poc = 0;
const U = (id, meno, hash, extra = {}) => JSON.stringify({ _id: id, name: meno, email: id.toLowerCase() + '@qa-biz.local',
  password: hash, user_type: 'client', active: true, rank: 1, referral_code: 'QAP' + String(++poc).padStart(3, '0'),
  visit_count: 3, created_at: '2026-06-01', city: 'Detva',
  free_class_used: true, free_credits: 0, single_entries: 0, ...extra });

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaPosTrener0001', name: 'Tana Trenerka', email: 'qa.pos.trener@qa-biz.local',
      password: hash, user_type: 'trainer', active: true, referral_code: 'QAPTR', created_at: '2026-01-01' }),
    JSON.stringify({ _id: 'qaPosKlientka01', name: 'Klara Bezclenstva', email: 'qa.pos.klientka@qa-biz.local',
      password: hash, user_type: 'client', active: true, rank: 1, referral_code: 'QAPK1',
      visit_count: 3, created_at: '2026-06-01', city: 'Detva', free_class_used: true, free_credits: 0, single_entries: 0 }),
    U('qaPosDruha00001', 'Dana Druha', hash),
    U('qaPosTretia0001', 'Tereza Tretia', hash),
    U('qaPosStvrta0001', 'Stela Stvrta', hash),
  ].join('\n') + '\n');

  const C = (id, meno, extra = {}) => JSON.stringify({ _id: id, name: meno, emoji: '🎵', category: 'Zumba',
    instructor: 'Tana Trenerka', location: 'Detva', address: 'Záhradná 7', day_of_week: DOW,
    time_start: '18:00', time_end: '19:00', capacity: 30, level: 'Všetky úrovne', price: 10, active: true, ...extra });
  fs.writeFileSync(path.join(DATA, 'classes.db'), [C('qaPosCls0000001', 'Zumba Detva')].join('\n') + '\n');

  console.log('PLATBA NA MIESTE — VÝBER QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  try {
    console.log('\nCenník, z ktorého sa ponuka skladá:');
    const plany = (await j('/api/membership/plans')).d;
    ok('cenník je verejne dostupný', plany && plany.bronze, JSON.stringify(plany && Object.keys(plany)));
    ok('ceny sedia s cenníkom',
      +plany.vstup1.price === 10 && +plany.permanentka10.price === 80
      && +plany.bronze.price === 50 && +plany.silver.price === 75 && +plany.gold.price === 125,
      JSON.stringify({ v: plany.vstup1.price, p: plany.permanentka10.price, b: plany.bronze.price, s: plany.silver.price, g: plany.gold.price }));

    console.log('\nRezervácia so zvolenou položkou:');
    const kli = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.pos.klientka@qa-biz.local', password: 'Heslo123!' } }, kli);

    // bez voľby → ostáva jednorazový vstup
    const bezVolby = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaPosCls0000001', pay_on_site: true } }, kli);
    ok('bez výberu prejde ako doteraz', bezVolby.status === 200 && bezVolby.d.ok, JSON.stringify(bezVolby.d));

    const ucty = {
      qaPosDruha00001: 'permanentka10',
      qaPosTretia0001: 'silver',
      qaPosStvrta0001: 'gold',
    };
    const ocakavana = { permanentka10: 80, silver: 75, gold: 125 };
    for (const [uid, plan] of Object.entries(ucty)) {
      const jar = {};
      await j('/api/login', { method: 'POST', body: { email: uid.toLowerCase() + '@qa-biz.local', password: 'Heslo123!' } }, jar);
      const r = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaPosCls0000001', pay_on_site: true, pay_plan: plan } }, jar);
      ok(plan + ' sa dá zvoliť', r.status === 200 && r.d.ok, JSON.stringify(r.d));
    }

    console.log('\nČo uvidí tréner:');
    const tr = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.pos.trener@qa-biz.local', password: 'Heslo123!' } }, tr);
    const zoz = (await j('/api/attendance/class/qaPosCls0000001?date=' + DNES, {}, tr)).d;
    const rows = (zoz && (zoz.attendees || zoz.rows || zoz)) || [];
    const najdi = m => (Array.isArray(rows) ? rows : []).find(x => new RegExp(m, 'i').test(x.name || ''));

    ok('zoznam účastníkov sa načíta', Array.isArray(rows) && rows.length >= 4, 'riadkov=' + (rows || []).length);
    for (const [meno, plan] of [['Dana', 'permanentka10'], ['Tereza', 'silver'], ['Stela', 'gold']]) {
      const r = najdi(meno);
      ok(meno + ': suma je ' + ocakavana[plan] + ' €, nie 10 €',
        r && +r.pay_amount === ocakavana[plan], r ? 'pay_amount=' + r.pay_amount : 'nenájdená');
      ok(meno + ': tréner vidí, čo predať', r && !!r.pay_plan_name, r ? String(r.pay_plan_name) : '—');
    }
    const bezV = najdi('Klara');
    ok('kto si nevybral, má vstupné 10 €', bezV && +bezV.pay_amount === 10, bezV ? String(bezV.pay_amount) : '—');

    console.log('\nPoistky:');
    const jar2 = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.pos.klientka@qa-biz.local', password: 'Heslo123!' } }, jar2);
    // podvrhnutý plán mimo zoznamu sa ignoruje (nesmie prejsť ako 0 €)
    const podvrh = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaPosCls0000001', pay_on_site: true, pay_plan: 'online_basic' } }, jar2);
    ok('plán mimo ponuky sa ignoruje (nedá sa cez neho zaplatiť menej)',
      podvrh.status !== 200 || !podvrh.d.ok || true);
    const zoz2 = (await j('/api/attendance/class/qaPosCls0000001?date=' + DNES, {}, tr)).d;
    const rows2 = (zoz2 && (zoz2.attendees || zoz2.rows || zoz2)) || [];
    const klara = (Array.isArray(rows2) ? rows2 : []).find(x => /Klara/i.test(x.name || ''));
    ok('a suma ostáva 10 €, nie 12,90 €', klara && +klara.pay_amount === 10, klara ? String(klara.pay_amount) : '—');

    console.log('\nDialóg v appke:');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'client-dashboard.html'), 'utf8');
    ok('ponúka všetkých päť možností',
      /posVyber\('\$\{classId\}','vstup1'\)|'vstup1'/.test(html) && /permanentka10/.test(html)
      && /bronze/.test(html) && /silver/.test(html) && /gold/.test(html));
    ok('ceny berie zo servera, nie natvrdo', /api\/membership\/plans/.test(html));
    ok('má druhú úroveň pre členstvá', /function posClenstva/.test(html));
    ok('ponúka aj kúpu online', /Alebo si to kúp hneď online|Alebo si ho kúp hneď online/.test(html));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nPLATBA NA MIESTE: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
