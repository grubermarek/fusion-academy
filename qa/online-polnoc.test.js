/**
 * Zoznam online hodín tesne po polnoci (17. 9. 2026).
 *
 * nextOccurrence() brala deň v týždni z miestneho času, ale dátum z UTC.
 * Medzi 0:00 a 2:00 (v zime 1:00) tak každá online hodina dostala o deň
 * menej: dnešný jednorazový prenos zo zoznamu zmizol a zrušený termín sa
 * hľadal na zlý dátum, takže zrušená hodina sa v zozname ešte ponúkala.
 * Prišlo sa na to, keď online-technika-pass padol po polnoci.
 *
 * Test spustí vlastnú inštanciu (DATA_DIR v tmp, RATE_LIMIT_OFF=1,
 * MAIL_CAPTURE=1 — nič neodíde mailom) s hodinami posunutými cez
 * qa/posun-casu.js na 0:20 slovenského času — raz v lete, raz v zime.
 *
 * Spustenie:  node qa/online-polnoc.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SCENARE = [
  { nazov: 'leto (UTC+2)', fakeNow: '2026-09-17T00:20:00+02:00', dnes: '2026-09-17', port: 4561 },
  { nazov: 'zima (UTC+1)', fakeNow: '2026-12-03T00:20:00+01:00', dnes: '2026-12-03', port: 4562 },
];

let PASS = 0, FAIL = 0; const FAILS = [];
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; FAILS.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : '')); }
}
const spi = ms => new Promise(r => setTimeout(r, ms));
const posunDni = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const denTyzdna = iso => new Date(iso + 'T12:00:00Z').getUTCDay();

async function scenar(s) {
  console.log('\n[' + s.nazov + '] server si myslí, že je ' + s.fakeNow);
  const BASE = 'http://localhost:' + s.port;
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-polnoc-'));
  const env = { ...process.env, PORT: String(s.port), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1',
    MAIL_CAPTURE: '1', TZ: 'Europe/Bratislava', FAKE_NOW: s.fakeNow };
  delete env.MAIL_ON;
  const srv = spawn(process.execPath, ['-r', path.join(__dirname, 'posun-casu.js'), 'server.js'],
    { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'], env });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });

  let jar = '';
  const call = async (method, p, body) => {
    const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(jar ? { Cookie: jar } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar = sc.split(';')[0];
    let data = null; try { data = await r.json(); } catch (e) {}
    return { status: r.status, data };
  };

  try {
    // Server beží a admin je založený (seed prebieha pri štarte)
    let prihlaseny = false; const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      try { if ((await call('POST', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' })).status === 200) { prihlaseny = true; break; } }
      catch (e) {}
      await spi(1000);
    }
    ok('server nabehol a admin sa prihlásil', prihlaseny, chyba.slice(-300));
    if (!prihlaseny) return;

    const DNES = s.dnes, DOW = denTyzdna(DNES);
    ok('v UTC je ešte včera — test naozaj beží v rizikovom okne',
      new Date(s.fakeNow).toISOString().slice(0, 10) === posunDni(DNES, -1));

    const mk = async (name, extra) => (await call('POST', '/api/admin/classes', {
      name, category: 'Online', location: 'Online', stream_city: 'QA-Polnoc-' + name,
      time_start: '18:00', time_end: '19:00', capacity: 50, price: 6, ...extra,
    })).data || {};
    const jednorazova = await mk('Dnes jednorazovo', { day_of_week: DOW, only_date: DNES });
    const dnesZrusena = await mk('Dnes zrusena', { day_of_week: DOW });
    const vcerajsia = await mk('Vcerajsia zrusena o tyzden', { day_of_week: (DOW + 6) % 7 });
    const zajtrajsia = await mk('Zajtrajsia', { day_of_week: (DOW + 1) % 7 });
    ok('hodiny vytvorené', !!(jednorazova.id && dnesZrusena.id && vcerajsia.id && zajtrajsia.id));

    // Posun času platí aj v serveri: odkaz na vysielanie si pamätá slovenský dnešok
    await call('PUT', '/api/admin/classes/' + jednorazova.id + '/stream', { stream_url: 'https://example.test/polnoc' });
    const hodiny = (await call('GET', '/api/classes')).data || [];
    const at = (hodiny.find(c => c._id === jednorazova.id) || {}).stream_url_at;
    ok('server počíta dnešok ako ' + DNES, at === DNES, { stream_url_at: at });

    await call('POST', '/api/attendance/cancel-session', { class_id: dnesZrusena.id, date: DNES, reason: 'QA polnoc' });
    await call('POST', '/api/attendance/cancel-session', { class_id: vcerajsia.id, date: posunDni(DNES, 6), reason: 'QA polnoc' });

    const zoznam = ((await call('GET', '/api/online/classes')).data || {}).classes || [];
    const je = c => zoznam.some(x => x._id === c.id);
    const mena = zoznam.map(x => x.name);
    ok('dnešný jednorazový prenos je v zozname', je(jednorazova), mena);
    ok('dnes zrušená hodina v zozname nie je', !je(dnesZrusena), mena);
    ok('hodina zrušená na najbližší termín (o 6 dní) v zozname nie je', !je(vcerajsia), mena);
    ok('zajtrajšia hodina v zozname je', je(zajtrajsia), mena);
  } catch (e) {
    ok('bez výnimky', false, e.message);
  } finally {
    srv.kill();
    await spi(800);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

(async () => {
  console.log('\n═══ ONLINE HODINY PO POLNOCI ═══');
  for (const s of SCENARE) await scenar(s);
  console.log('\n═══ VÝSLEDOK: ' + PASS + ' PASS, ' + FAIL + ' FAIL ═══');
  if (FAIL) FAILS.forEach(f => console.log('  FAIL: ' + f));
  process.exit(FAIL ? 1 : 0);
})();
