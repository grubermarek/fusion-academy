/**
 * Popis technického tréningu v rozvrhu musí hovoriť to, čo appka naozaj robí
 * (Marek 17. 9.: „platí 8 7 6“ a čo sa zmení v appke, musí sa zmeniť aj v textoch).
 *  · ceny sa berú z TECHNIKA_CENNIK (10 € / Bronze 8 / Silver 7 / Gold 6),
 *  · kým beží prvý týždeň zadarmo, popis nesmie sľubovať „Prvá hodina zadarmo",
 *  · vlastný popis, ktorý admin napísal ručne, sa neprepisuje.
 *
 * Spustenie:  node qa/technika-popis.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const KOREN = path.join(__dirname, '..');
let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };
const STARY = 'Technika, izolácie a štýl — nadstavba k Zumbe. 💳 10 € jednorazový vstup · Bronze 9 € · Silver 8 € · Gold 7 €. Platí aj permanentka (1 vstup).';
const VLASTNY = 'Špeciálny workshop techniky s hosťom — cena podľa dohody.';

async function spusti(port, prvyTyzden) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-tp-'));
  const C = (id, desc) => JSON.stringify({ _id: id, name: 'Technický tréning', category: 'Technika', location: 'Detva',
    day_of_week: 5, time_start: '18:00', time_end: '19:00', capacity: 20, price: 10, description: desc, active: true, created_at: '2026-08-14' });
  // staré jednorazové migrácie popisu na produkcii už prebehli — tu ich označíme ako hotové
  fs.writeFileSync(path.join(DATA, 'settings.db'), ['tech_training_detva_20260814', 'tech_price_gold7_20260815',
    'tech_freeclass_20260816', 'tech_popis_cennik_20260904']
    .map((k, i) => JSON.stringify({ _id: 'qaTpSet' + i, key: k, value: true, at: '2026-09-04T00:00:00.000Z' })).join('\n') + '\n');
  fs.writeFileSync(path.join(DATA, 'classes.db'), [C('qaTpStary000001', STARY), C('qaTpVlastny0001', VLASTNY)].join('\n') + '\n');
  const env = { ...process.env, PORT: String(port), DATA_DIR: DATA, APP_URL: 'http://localhost:' + port, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' };
  delete env.PRVY_TYZDEN;
  if (prvyTyzden) env.PRVY_TYZDEN = '1';
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN, env, stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) { try { await fetch('http://localhost:' + port + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  await new Promise(r => setTimeout(r, 4000));   // migrácie pri štarte dobehnú
  const r = await fetch('http://localhost:' + port + '/api/classes').then(x => x.json()).catch(() => null);
  srv.kill();
  await new Promise(r2 => setTimeout(r2, 500));
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  const zoznam = Array.isArray(r) ? r : (r && (r.classes || r.rows)) || [];
  return { stary: zoznam.find(c => c._id === 'qaTpStary000001' || c.id === 'qaTpStary000001'), vlastny: zoznam.find(c => c._id === 'qaTpVlastny0001' || c.id === 'qaTpVlastny0001') };
}

(async () => {
  try {
    console.log('POPIS TECHNIKY QA — prvý týždeň zapnutý…');
    const a = await spusti(4615, true);
    ok('hodina je v rozvrhu', !!a.stary, JSON.stringify(a).slice(0, 200));
    const d = (a.stary || {}).description || '';
    ok('ceny v popise sú podľa cenníka (10 / 8 / 7 / 6 €)', d.includes('10 € jednorazový vstup · Bronze 8 € · Silver 7 € · Gold 6 €'), d);
    ok('počas prvého týždňa zadarmo popis nesľubuje prvú hodinu zadarmo', !/Prvá hodina zadarmo/i.test(d), d);
    ok('staré ceny zmizli', !/Bronze 9|Gold 7/.test(d), d);
    ok('vlastný popis admina ostal', a.vlastny && a.vlastny.description === VLASTNY, a.vlastny && a.vlastny.description);

    console.log('…prvý týždeň vypnutý');
    const b = await spusti(4616, false);
    const d2 = (b.stary || {}).description || '';
    ok('bez prvého týždňa popis sľubuje prvú hodinu zadarmo (appka ju vtedy dáva)', d2.startsWith('Technika, izolácie a štýl — nadstavba k Zumbe. 🎁 Prvá hodina zadarmo! Inak 💳 10 €'), d2);
    ok('ceny sedia aj tu', d2.includes('Bronze 8 € · Silver 7 € · Gold 6 €'), d2);

    const src = fs.readFileSync(path.join(KOREN, 'server.js'), 'utf8');
    ok('server berie ceny z cenníka, nie z textu', src.includes("function popisTechniky(skuska)") && src.includes('TECHNIKA_CENNIK.bronze'));
    ok('prvá hodina zadarmo sa pri technike naozaj nedáva počas skúšky', src.includes('const prvaZdarmaDostupna = !u.free_class_used && !skuska;'));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    console.log('\nPOPIS TECHNIKY: ' + passed + ' OK / ' + failed + ' chýb');
    process.exit(failed ? 1 : 0);
  }
})();
