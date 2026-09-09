/**
 * Hľadanie klientky v admine ignoruje diakritiku (9. 9. 2026).
 *
 * Marek: „nejde otvoriť profil niektorých klientok — z admin menu zo zoznamu
 * klientov."
 *
 * Príčina: hľadanie porovnávalo znak po znaku vrátane diakritiky. Na telefóne
 * nikto nepíše „Kopuncová" s dĺžňom, takže klientka sa jednoducho nezobrazila
 * a nebolo čo otvoriť. Na produkčných dátach sa to týkalo 386 z 810 mien.
 *
 * Stráži, že:
 *   · priezvisko bez diakritiky nájde klientku s diakritikou
 *   · funguje to pre ď, ť, ň, ľ, š, č, ž, á, é, í, ó, ú, ý, ô
 *   · hľadanie S diakritikou funguje naďalej
 *   · hľadá sa aj podľa e-mailu a telefónu
 *   · prázdne hľadanie vráti všetkých
 *   · nesúvisiaci výraz nevráti nikoho
 *
 * Spustenie:  node qa/hladanie-klientok.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4598;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-hlad-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, jar) {
  const headers = { 'Content-Type': 'application/json' };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { headers });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  // mená pokrývajú celú slovenskú diakritiku
  const klientky = [
    ['qaHlad00000001', 'Alena Kopuncová', 'alena@qa-biz.local', '0905156261'],
    ['qaHlad00000002', 'Ľubica Ďurišová', 'lubica@qa-biz.local', '0911222333'],
    ['qaHlad00000003', 'Soňa Moskálová', 'sona@qa-biz.local', '0912333444'],
    ['qaHlad00000004', 'Jaroslava Švantnerová', 'jaroslava@qa-biz.local', '0913444555'],
    ['qaHlad00000005', 'Mirka Pančíková', 'mirka@qa-biz.local', '0914555666'],
    ['qaHlad00000006', 'Katarína Rôtová', 'katarina@qa-biz.local', '0915666777'],
    ['qaHlad00000007', 'Peter Novak', 'peter@qa-biz.local', '0916777888'],
  ];
  w('users.db', [
    { _id: 'qaHladAdmin0001', name: 'Marek Gruber', email: 'qa.hlad.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    ...klientky.map(([id, name, email, phone], i) => ({
      _id: id, name, email, phone, user_type: 'client', active: true,
      referral_code: 'QAHLAD' + i, created_at: '2026-0' + ((i % 8) + 1) + '-01' })),
  ]);

  console.log('HĽADANIE KLIENTOK\n');

  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 9000));

  const najdi = async (adm, s) => {
    const r = await j('/api/admin/clients' + (s ? '?search=' + encodeURIComponent(s) : ''), adm);
    return ((r.d && r.d.clients) || []).map(c => c.name);
  };

  try {
    const adm = {};
    const lg = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'qa.hlad.admin@qa-biz.local', password: 'Heslo123!' }) });
    adm.cookie = (lg.headers.get('set-cookie') || '').split(';')[0];
    ok('admin prihlásený', lg.status === 200);

    console.log('\n1) Priezvisko napísané bez diakritiky (ako na telefóne):');
    for (const [hladane, ocakavane] of [
      ['kopuncova', 'Alena Kopuncová'],
      ['durisova', 'Ľubica Ďurišová'],
      ['moskalova', 'Soňa Moskálová'],
      ['svantnerova', 'Jaroslava Švantnerová'],
      ['pancikova', 'Mirka Pančíková'],
      ['rotova', 'Katarína Rôtová'],
    ]) {
      const v = await najdi(adm, hladane);
      ok('„' + hladane + '" nájde ' + ocakavane, v.includes(ocakavane), 'našlo: ' + JSON.stringify(v));
    }

    console.log('\n2) S diakritikou to funguje naďalej:');
    ok('„Kopuncová" nájde Alenu', (await najdi(adm, 'Kopuncová')).includes('Alena Kopuncová'));
    ok('„Ďurišová" nájde Ľubicu', (await najdi(adm, 'Ďurišová')).includes('Ľubica Ďurišová'));

    console.log('\n3) Veľké/malé písmená a krstné mená:');
    ok('„ALENA" nájde Alenu', (await najdi(adm, 'ALENA')).includes('Alena Kopuncová'));
    ok('„sona" nájde Soňu', (await najdi(adm, 'sona')).includes('Soňa Moskálová'));

    console.log('\n4) E-mail a telefón:');
    ok('e-mail nájde klientku', (await najdi(adm, 'lubica@qa-biz')).includes('Ľubica Ďurišová'));
    ok('telefón nájde klientku', (await najdi(adm, '0905156261')).includes('Alena Kopuncová'));

    console.log('\n5) Hranice:');
    const vsetci = await najdi(adm, '');
    ok('prázdne hľadanie vráti všetkých 7', vsetci.length === 7, 'vrátilo ' + vsetci.length);
    ok('nezmysel nevráti nikoho', (await najdi(adm, 'xyzabc123')).length === 0);
    ok('meno bez diakritiky sa nepokazilo', (await najdi(adm, 'novak')).includes('Peter Novak'));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nHĽADANIE KLIENTOK: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-700));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
