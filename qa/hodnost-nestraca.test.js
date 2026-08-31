/**
 * Hodnosť ambasádorky sa nestráca novým mesiacom (Marek 1. 9.).
 *
 * 1. septembra bol Marek na 12 % postupu a spadol na nulu, lebo hodnosť aj
 * progres sa počítali z objemu BEŽIACEHO mesiaca — a ten je prvého vždy nula.
 * Zobrazená hodnosť ide odteraz zo životného maxima; provízia sa naďalej
 * počíta z bežiaceho mesiaca, lebo hodnosť je uznanie, nie nárok.
 *
 * Spustenie:  node qa/hodnost-nestraca.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4546;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-hod2-'));

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
const MESIAC = DNES.slice(0, 7);
const MINULY = (() => { const d = new Date(+MESIAC.slice(0, 4), +MESIAC.slice(5, 7) - 1 - 1, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })();

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaAmbAdmin00001', name: 'Adam Admin', email: 'qa.amb.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }),
    // ambasádorka, ktorá v minulom mesiaci vyrobila 1 950 bodov (Senior Partner),
    // ale tento mesiac zatiaľ nič — presne Marekov prípad
    JSON.stringify({ _id: 'qaAmbSkusena001', name: 'Sona Skusena', email: 'qa.amb.skusena@qa-biz.local',
      password: hash, user_type: 'ambassador', active: true, rank: 1, referral_code: 'QAAMB1',
      ambassador_since: '2026-02-01', created_at: '2026-01-15', amb_rank: 1 }),
  ].join('\n') + '\n');

  // uzavreté mesiace: história objemov
  fs.writeFileSync(path.join(DATA, 'amb_volume_months.db'), [
    JSON.stringify({ _id: 'qaAmbVm00000001', user_id: 'qaAmbSkusena001', user_name: 'Sona Skusena',
      month: MINULY, own_ob: 400, team_ob: 1550, group_ob: 1950, rank_id: 3, rank_name: 'Senior Partner',
      stars: 2, closed_at: '2026-08-31T22:00:00.000Z' }),
  ].join('\n') + '\n');

  console.log('HODNOSŤ SA NESTRÁCA QA — štart servera…');
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
    const jar = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.amb.skusena@qa-biz.local', password: 'Heslo123!' } }, jar);
    ok('ambasádorka prihlásená', lg.status === 200, JSON.stringify(lg.d));

    const me = (await j('/api/ambassador/me', {}, jar)).d;
    ok('panel odpovedá', me && me.ok, JSON.stringify(me && me.error));

    console.log('\nZobrazená hodnosť (nesmie spadnúť s novým mesiacom):');
    ok('drží sa životného maxima 1 950 b.', me.best_ob === 1950, 'best_ob=' + me.best_ob);
    ok('hodnosť je Senior Partner, nie nula', me.rank && me.rank.name === 'Senior Partner',
      JSON.stringify(me.rank && { r: me.rank.rank, n: me.rank.name }));
    ok('progres NIE je nula', (me.rank.progress || 0) > 0, 'progress=' + (me.rank && me.rank.progress));
    ok('hviezdy ostali', (me.rank.stars || 0) >= 1, 'stars=' + (me.rank && me.rank.stars));

    console.log('\nBežiaci mesiac (z neho ide provízia):');
    ok('objem mesiaca je naozaj 0', (me.volume && me.volume.total) === 0, JSON.stringify(me.volume && me.volume.total));
    ok('mesačná hodnosť je oddelene a je nulová',
      me.rank_month && (me.rank_month.rank || 0) === 0, JSON.stringify(me.rank_month && me.rank_month.rank));
    ok('provízia sa počíta z mesiaca, nie z dosiahnutej',
      me.rate === undefined ? false : me.rate <= 0.10 + 1e-9, 'rate=' + me.rate);

    console.log('\nČo klientka uvidí:');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'ambasador.html'), 'utf8');
    ok('panel označí hodnosť ako dosiahnutú', /TVOJA DOSIAHNUTÁ HODNOSŤ/.test(html));
    ok('a ukáže, ako je na tom tento mesiac', /class="mesiac"/.test(html) && /Tento mesiac/.test(html));
    ok('vrátane provízie', /provízia <b>/.test(html));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nHODNOSŤ SA NESTRÁCA: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
