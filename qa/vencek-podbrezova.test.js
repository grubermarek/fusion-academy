/**
 * Venček Podbrezová (Marek 17. 9. 2026): 60 € za žiaka, nácviky v Klásku,
 * začiatok ešte nie je dohodnutý.
 *  · skupina VEN-PODBREZOVA vznikne sama pri štarte (a len raz),
 *  · registrácia ukáže cenu, miesto nácvikov a „Termín upresníme" — žiadny vymyslený dátum,
 *  · servis vie neskôr doplniť začiatok, cenu aj počet lekcií (a nezmysly odmietne).
 *
 * Spustenie:  node qa/vencek-podbrezova.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4617;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-vp-'));
const KOREN = path.join(__dirname, '..');
const TOKEN = 'qa-vp-token-' + Date.now();
let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };
const spi = ms => new Promise(r => setTimeout(r, ms));
const citajDb = f => { try { return fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (e) { return []; } };
const info = async () => (await fetch(BASE + '/api/vencek/info?code=VEN-PODBREZOVA')).json().catch(() => null);
const servis = async body => {
  const r = await fetch(BASE + '/api/vencek/service/set', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-import-token': TOKEN }, body: JSON.stringify(body) });
  return { status: r.status, d: await r.json().catch(() => null) };
};
function spusti() {
  return spawn(process.execPath, ['server.js'], {
    cwd: KOREN, stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', IMPORT_TOKEN: TOKEN },
  });
}
async function cakaj() {
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); return true; } catch (e) { await spi(1000); } }
  return false;
}

(async () => {
  let srv = spusti();
  try {
    if (!(await cakaj())) throw new Error('server nenabehol');
    let d = null;
    for (let i = 0; i < 20 && !(d && d.ok); i++) { await spi(1000); d = await info(); }
    ok('skupina VEN-PODBREZOVA vznikla sama', d && d.ok, JSON.stringify(d));
    ok('škola Podbrezová', d.school === 'Podbrezová' && d.city === 'Podbrezová', d.school + ' / ' + d.city);
    ok('cena 60 € za žiaka', d.price === 60, String(d.price));
    ok('nácviky v Klásku, začiatok sa ešte upresní', d.schedule === 'Nácviky v Klásku · začiatok upresníme', d.schedule);
    ok('bez vymysleného dátumu aj miesta večera', d.event_date === '' && d.event_venue === '', JSON.stringify([d.event_date, d.event_venue]));
    ok('10 lekcií do venčeka, bez bonusových (ako Klenovec a Hnúšťa)', d.pred_veckom === 10 && d.bonusov === 0, JSON.stringify([d.pred_veckom, d.bonusov]));
    ok('registrovať sa môže žiak, rodič aj učiteľ', JSON.stringify(d.roles) === JSON.stringify(['student', 'parent', 'teacher']), JSON.stringify(d.roles));
    ok('učí Marek Gruber', d.lecturer === 'Marek Gruber');

    const html = await (await fetch(BASE + '/v/VEN-PODBREZOVA')).text();
    ok('registračná stránka existuje', /vencek|Venček/i.test(html));
    const reg = fs.readFileSync(path.join(KOREN, 'public', 'vencek-registracia.html'), 'utf8');
    ok('stránka bez dátumu večera píše „Termín upresníme"', reg.includes("d.event_date ? esc(fmtDatum(d.event_date)) : 'Termín upresníme'"));

    // servis: neskoršie doplnenie
    ok('nezmyselná cena sa odmietne', (await servis({ code: 'VEN-PODBREZOVA', price: -5 })).status === 400);
    ok('nezmyselný počet lekcií sa odmietne', (await servis({ code: 'VEN-PODBREZOVA', lessons_total: 8, lessons_before: 9 })).status === 400);
    ok('bez tokenu servis neodpovedá', (await fetch(BASE + '/api/vencek/service/set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"code":"VEN-PODBREZOVA","price":1}' })).status === 404);
    const zmena = await servis({ code: 'VEN-PODBREZOVA', lessons_total: 12, lessons_before: 10, start_at: '2027-03-04T15:00' });
    ok('servis doplní začiatok aj počet lekcií', zmena.status === 200 && zmena.d.terminy && zmena.d.terminy.length === 3, JSON.stringify(zmena.d));
    const po = await info();
    ok('po doplnení: 10 do venčeka + 2 bonusové, cena ostala', po.pred_veckom === 10 && po.bonusov === 2 && po.price === 60, JSON.stringify([po.pred_veckom, po.bonusov, po.price]));

    // reštart servera nesmie založiť druhú skupinu
    srv.kill(); await spi(1500);
    srv = spusti();
    if (!(await cakaj())) throw new Error('server po reštarte nenabehol');
    await spi(8000);
    const skupiny = citajDb('venceky_classes.db').filter(c => c.code === 'VEN-PODBREZOVA');
    ok('po reštarte je skupina stále len jedna', new Set(skupiny.map(c => c._id)).size === 1, String(skupiny.length));
    ok('a zmeny zo servisu ostali', (await info()).bonusov === 2);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    console.log('\nVENČEK PODBREZOVÁ: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 500);
  }
})();
