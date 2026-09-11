/**
 * Herbalife preč (11. 9. 2026).
 *
 * Marek: „všetok herbalife preč." Na produkcii bolo v obchode 27 Herbalife
 * produktov (skrytých, ale v databáze) a v komunite dva články o Herbalife a F1
 * a tri príbehy klientok s riadkom o Herbalife. Staršia migrácia hľadala názov
 * článku v poli title, ktoré príspevky nemajú — takže nikdy nič nezmazala.
 *
 * Stráži, že:
 *   · Herbalife produkty zmiznú, ostatné produkty ostanú
 *   · články o Herbalife a F1 zmiznú, ostatné články ostanú
 *   · z príbehov zmizne len riadok s Herbalife, zvyšok textu ostane
 *   · po reštarte sa Herbalife produkty nevrátia (seed je preč)
 *   · obchod ani komunita ich neukážu
 *
 * Spustenie:  node qa/herbalife-prec.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4596;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-herba-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

let srv = null, chyba = '';
async function start() {
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' } });
  srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); await new Promise(r => setTimeout(r, 15000)); return true; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  return false;
}
async function stop() {
  if (!srv || srv.exitCode !== null) return;
  await new Promise(r => setTimeout(r, 1000));
  await new Promise(r => { srv.once('exit', r); srv.kill(); });
  await new Promise(r => setTimeout(r, 700));
}

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  w('users.db', [{ _id: 'qaHbAdmin000001', name: 'Marek Gruber', email: 'qa.hb.admin@qa-biz.local', password: hash,
    is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }]);
  w('products.db', [
    { _id: 'qaHbProdF10001', cat: 'Herbalife', name: 'Formula 1 – Vanilka-smotana (500g)', price: 38.9, type: 'product', active: false },
    { _id: 'qaHbProdAloe01', cat: 'Herbalife', name: 'Bylinný nápoj z Aloe Vera – Originál', price: 34.9, type: 'product', active: true },
    { _id: 'qaHbProdTric01', cat: 'Oblečenie', name: 'Fusion tričko (dámske)', price: 25, type: 'product', active: true },
    { _id: 'qaHbProdGold01', cat: 'Členstvá', name: 'Členstvo GOLD', price: 125, type: 'subscription', active: true },
  ]);
  const B = (id, text, t) => ({ _id: id, channel: 'blog', user_id: 'qaHbAdmin000001', user_name: 'Marek Gruber | Fusion Academy',
    text, is_article: true, created_at: t });
  w('messages.db', [
    B('qaHbMsgHerba01', '📰 *Herbalife — prečo je jednotka v kvalite doplnkov výživy*\n\n🌿 Prečo odporúčame…', 1783368562000),
    B('qaHbMsgF1kokt1', '📰 *F1 kokteil — raňajky, ktoré ti zmenia deň*\n\n☀️ Raňajky za 30 sekúnd — Formula 1 kokteil', 1783454962000),
    B('qaHbMsgBeatka1', '📰 *Príbeh Beátky — −17 kg za rok vďaka Zumbe a výžive*\n\nJej cesta:\n✅ 3–4× týždenne Zumba\n✅ Herbalife shake na rýchle dni\n✅ Priorita spánku', 1783714162000),
    B('qaHbMsgZumba01', '📰 *Zumba v Detve, Zvolene, Banskej Bystrici a Brezne*\n\nRozvrh hodín…', 1783800000000),
    { _id: 'qaHbMsgChat001', channel: 'general', user_id: 'qaHbAdmin000001', text: 'Ahojte, dnes Zumba o 19:00', created_at: 1783900000000 },
  ]);

  console.log('HERBALIFE PREČ\n');
  try {
    if (!(await start())) { failed++; console.log('  ❌ server nenabehol'); return; }
    const prod = () => rd('products.db');
    const msg = () => rd('messages.db');

    console.log('1) Obchod:');
    ok('Herbalife produkty sú preč (aj skrytý, aj aktívny)', !prod().some(p => p.cat === 'Herbalife'), JSON.stringify(prod().map(p => p.name)));
    ok('tričko ostalo', prod().some(p => p._id === 'qaHbProdTric01'));
    ok('členstvo Gold ostalo', prod().some(p => p._id === 'qaHbProdGold01'));
    const shop = await (await fetch(BASE + '/api/products')).json().catch(() => null);
    ok('verejný zoznam produktov neobsahuje Herbalife', Array.isArray(shop) ? !JSON.stringify(shop).match(/herbalife|formula 1/i) : true,
      Array.isArray(shop) ? '' : 'endpoint nevrátil zoznam: ' + JSON.stringify(shop).slice(0, 80));

    console.log('\n2) Komunita:');
    ok('článok o Herbalife je preč', !msg().some(m => m._id === 'qaHbMsgHerba01'));
    ok('článok o F1 je preč', !msg().some(m => m._id === 'qaHbMsgF1kokt1'));
    const beata = msg().find(m => m._id === 'qaHbMsgBeatka1');
    ok('príbeh Beátky ostal', !!beata);
    ok('bez riadku o Herbalife', beata && !/herbalife/i.test(beata.text), beata && beata.text);
    ok('zvyšok príbehu je celý', beata && /3–4× týždenne Zumba/.test(beata.text) && /Priorita spánku/.test(beata.text));
    ok('iný článok ostal nedotknutý', msg().some(m => m._id === 'qaHbMsgZumba01'));
    ok('bežný chat ostal', msg().some(m => m._id === 'qaHbMsgChat001'));
    ok('migrácia sa zapísala', rd('settings.db').some(s => s.key === 'herbalife_prec_v1'));

    console.log('\n3) Po reštarte sa Herbalife nevráti:');
    await stop();
    if (!(await start())) { failed++; console.log('  ❌ server druhýkrát nenabehol'); return; }
    ok('v obchode stále nie je', !prod().some(p => p.cat === 'Herbalife'), JSON.stringify(prod().map(p => p.cat)));
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    // migrácia sa na kategóriu pýta ({cat:'Herbalife'}), seed by mal aj názov produktu
    ok('v kóde nie je seed Herbalife produktov', !/cat:'Herbalife',\s*name:/.test(src));
    ok('obchod nemá Herbalife v kľúčových slovách', !/herbalife/i.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'shop.html'), 'utf8')));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    await stop().catch(() => {});
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nHERBALIFE PREČ: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-900));
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
  }
})();
