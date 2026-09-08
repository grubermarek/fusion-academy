/**
 * Navolávanie škôl ako CRM (8. 9. 2026).
 *
 * Marek: „daj do tej sekcie miesto, kde sa dá napísať poznámka a označenie
 * termínu, kedy sa má lead znovu objaviť, ak by si ho Beátka odložila, že sa
 * dohodnú na neskorší telefonát… prepracuj ten zoznam ako CRM, aby sa s ním
 * dalo interaktívne pracovať — navolávať, písať poznámky, triediť."
 *
 * Stráži, že:
 *   · zoznam nesie telefón, stav, dojazd z Detvy a či mail otvorili/klikli
 *   · zápis z hovoru uloží stav, poznámku aj termín ozvania sa
 *   · poznámky sa PRIDÁVAJÚ, staršie ostávajú aj s dátumom a menom
 *   · odložená škola sa v deň termínu sama objaví medzi „na dnes"
 *   · zmeškaný termín je označený ako po termíne
 *   · odhlásená škola sa v navolávaní nezobrazí
 *   · stavy sa premietnu do pôvodného poľa status (drip a štatistiky)
 *   · neplatný dátum ani neznámy stav neprejdú
 *
 * Spustenie:  node qa/skoly-crm.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4588;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-skcrm-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts, jar) {
  const headers = { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: (opts && opts.method) || 'GET', headers, body: opts && opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };

(async () => {
  const dnes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const vcera = new Date(Date.parse(dnes + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  const o7 = new Date(Date.parse(dnes + 'T12:00:00Z') + 7 * 86400000).toISOString().slice(0, 10);
  const hash = bcrypt.hashSync('Heslo123!', 10);

  fs.writeFileSync(path.join(DATA, 'users.db'),
    JSON.stringify({ _id: 'qaSkAdmin000001', name: 'Beáta Gruber', email: 'qa.skc.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }) + '\n');

  fs.writeFileSync(path.join(DATA, 'schools.db'), [
    // blízka škola, ktorá klikla na ponuku → má byť hore
    JSON.stringify({ _id: 'qaSk00000000001', name: 'Základná škola – Štúrova 12 – Detva', city: 'Detva',
      email: 'qa.sk1@qa-biz.local', phone: '045 545 1111', status: 'sent',
      sent_at: '2026-08-20T07:00:00.000Z', created_at: '2026-08-01' }),
    // vzdialená škola bez záujmu
    JSON.stringify({ _id: 'qaSk00000000002', name: 'Základná škola – Hlavná 3 – Tornaľa', city: 'Tornaľa',
      email: 'qa.sk2@qa-biz.local', phone: '047 552 2222', status: 'sent',
      sent_at: '2026-08-20T07:00:00.000Z', created_at: '2026-08-01' }),
    // odložená na dnes → musí sa vrátiť medzi „na dnes"
    JSON.stringify({ _id: 'qaSk00000000003', name: 'Základná škola – Nám. mládeže 1 – Zvolen', city: 'Zvolen',
      email: 'qa.sk3@qa-biz.local', phone: '045 532 3333', status: 'sent', sent_at: '2026-08-20T07:00:00.000Z',
      crm_stav: 'odlozene', crm_ozvat_sa: dnes, created_at: '2026-08-01' }),
    // zmeškaný termín — včera
    JSON.stringify({ _id: 'qaSk00000000004', name: 'Základná škola – Golianova 8 – Banská Bystrica', city: 'Banská Bystrica',
      email: 'qa.sk4@qa-biz.local', phone: '048 441 4444', status: 'sent', sent_at: '2026-08-20T07:00:00.000Z',
      crm_stav: 'odlozene', crm_ozvat_sa: vcera, created_at: '2026-08-01' }),
    // odhlásená — v navolávaní nemá čo robiť
    JSON.stringify({ _id: 'qaSk00000000005', name: 'Základná škola – Odhlásená 1 – Lučenec', city: 'Lučenec',
      email: 'qa.sk5@qa-biz.local', phone: '047 433 5555', status: 'sent', unsubscribed: true, created_at: '2026-08-01' }),
  ].join('\n') + '\n');

  // mail_log: prvá škola klikla, druhá len otvorila
  fs.writeFileSync(path.join(DATA, 'mail_log.db'), [
    JSON.stringify({ _id: 'qaSkMl00000001', to: 'qa.sk1@qa-biz.local', subject: 'Venček', template: 'skoly_posledny_tanec',
      created_at: '2026-08-20T07:00:00.000Z', opened_at: '2026-08-20T08:00:00.000Z', clicked_at: '2026-08-20T08:05:00.000Z' }),
    JSON.stringify({ _id: 'qaSkMl00000002', to: 'qa.sk2@qa-biz.local', subject: 'Venček', template: 'skoly_posledny_tanec',
      created_at: '2026-08-20T07:00:00.000Z', opened_at: '2026-08-20T09:00:00.000Z' }),
  ].join('\n') + '\n');

  console.log('CRM ŠKÔL QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 9000));

  try {
    const adm = {};
    ok('admin prihlásený', (await j('/api/login', { method: 'POST', body: { email: 'qa.skc.admin@qa-biz.local', password: 'Heslo123!' } }, adm)).status === 200);
    ok('bez admina sa CRM nezobrazí', [401, 403].includes((await j('/api/admin/schools/crm')).status));

    console.log('\n1) Zoznam na navolávanie:');
    const c1 = (await j('/api/admin/schools/crm', {}, adm)).d;
    ok('načíta sa', c1 && c1.ok, JSON.stringify(c1).slice(0, 120));
    ok('odhlásená škola v ňom NIE JE', !c1.rows.some(r => r.id === 'qaSk00000000005'), c1.rows.map(r => r.city).join(','));
    ok('ostatné štyri áno', c1.rows.length === 4, 'n=' + c1.rows.length);
    const detva = c1.rows.find(r => r.id === 'qaSk00000000001');
    ok('nesie telefón', detva.phone === '045 545 1111', detva.phone);
    ok('vie, že škola klikla na ponuku', detva.klikol === true && detva.otvoril === true, JSON.stringify([detva.otvoril, detva.klikol]));
    ok('a že Detva je do 25 minút', detva.pasmo === 1 && /25/.test(detva.pasmo_nazov), detva.pasmo_nazov);
    const tornala = c1.rows.find(r => r.id === 'qaSk00000000002');
    ok('Tornaľa je nad 70 minút', tornala.pasmo === 4, tornala.pasmo_nazov);
    ok('a mail len otvorila, neklikla', tornala.otvoril === true && tornala.klikol === false);

    console.log('\n2) Termín „ozvať sa":');
    const zvolen = c1.rows.find(r => r.id === 'qaSk00000000003');
    ok('odložená na dnes je medzi „na dnes"', zvolen.na_dnes === true && zvolen.po_termine === false, JSON.stringify([zvolen.na_dnes, zvolen.po_termine]));
    const bb = c1.rows.find(r => r.id === 'qaSk00000000004');
    ok('zmeškaný termín je označený ako po termíne', bb.na_dnes === true && bb.po_termine === true);
    ok('súčet „na dnes" sedí', c1.totals.na_dnes === 2, 'na_dnes=' + c1.totals.na_dnes);

    console.log('\n3) Zápis z hovoru:');
    const z1 = await j('/api/admin/schools/qaSk00000000001/crm', { method: 'POST', body: {
      stav: 'odlozene', poznamka: 'Riaditeľka na dovolenke, volať po 15.', ozvat_sa: o7, volane: true } }, adm);
    ok('uloží sa', z1.status === 200 && z1.d && z1.d.ok, JSON.stringify(z1.d).slice(0, 100));
    await new Promise(r => setTimeout(r, 400));
    const s1 = rd('schools.db').find(x => x._id === 'qaSk00000000001');
    ok('stav je odložené', s1.crm_stav === 'odlozene', s1.crm_stav);
    ok('termín ozvania sa je uložený', s1.crm_ozvat_sa === o7, s1.crm_ozvat_sa);
    ok('poznámka aj s dátumom a menom', s1.crm_poznamky.length === 1
      && /dovolenke/.test(s1.crm_poznamky[0].text) && s1.crm_poznamky[0].kto === 'Beáta Gruber',
      JSON.stringify(s1.crm_poznamky));
    ok('zapísalo sa, kedy a kto volal', !!s1.crm_volane_at && s1.crm_volal === 'Beáta Gruber');

    console.log('\n4) Poznámky sa pridávajú, neprepisujú:');
    await j('/api/admin/schools/qaSk00000000001/crm', { method: 'POST', body: {
      stav: 'stretnutie', poznamka: 'Dohodnuté stretnutie v utorok o 14:00.', ozvat_sa: '' } }, adm);
    await new Promise(r => setTimeout(r, 400));
    const s2 = rd('schools.db').find(x => x._id === 'qaSk00000000001');
    ok('sú tam obe poznámky', s2.crm_poznamky.length === 2, 'n=' + s2.crm_poznamky.length);
    ok('staršia ostala prvá', /dovolenke/.test(s2.crm_poznamky[0].text));
    ok('termín sa dá zrušiť', s2.crm_ozvat_sa === null, JSON.stringify(s2.crm_ozvat_sa));
    ok('stav stretnutie sa premietol aj do pôvodného status', s2.status === 'meeting', s2.status);

    console.log('\n5) Stavy, ktoré menia pôvodný status:');
    await j('/api/admin/schools/qaSk00000000002/crm', { method: 'POST', body: { stav: 'nezaujem', poznamka: 'Majú iného lektora.' } }, adm);
    await new Promise(r => setTimeout(r, 300));
    ok('nemá záujem → lost', rd('schools.db').find(x => x._id === 'qaSk00000000002').status === 'lost');
    await j('/api/admin/schools/qaSk00000000003/crm', { method: 'POST', body: { stav: 'ziskane', poznamka: 'Idú do toho, 9.A.' } }, adm);
    await new Promise(r => setTimeout(r, 300));
    ok('získaná škola → won', rd('schools.db').find(x => x._id === 'qaSk00000000003').status === 'won');

    console.log('\n6) Čo nesmie prejsť:');
    ok('neznámy stav', (await j('/api/admin/schools/qaSk00000000001/crm', { method: 'POST', body: { stav: 'hocico' } }, adm)).status === 400);
    ok('nezmyselný dátum', (await j('/api/admin/schools/qaSk00000000001/crm', { method: 'POST', body: { ozvat_sa: 'zajtra' } }, adm)).status === 400);
    ok('neexistujúca škola', (await j('/api/admin/schools/nieje/crm', { method: 'POST', body: { stav: 'dovolane' } }, adm)).status === 404);

    console.log('\n7) Súčty po práci:');
    const c2 = (await j('/api/admin/schools/crm', {}, adm)).d;
    ok('stretnutia a získané sa počítajú', c2.totals.stretnutia === 1 && c2.totals.ziskane === 1,
      JSON.stringify(c2.totals));
    ok('„na dnes" ostal len zmeškaný Zvolen/BB', c2.totals.na_dnes === 1, 'na_dnes=' + c2.totals.na_dnes);
    ok('a posledná poznámka je vidieť v zozname',
      /stretnutie/i.test((c2.rows.find(r => r.id === 'qaSk00000000001') || {}).posledna_poznamka || ''),
      (c2.rows.find(r => r.id === 'qaSk00000000001') || {}).posledna_poznamka);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nCRM ŠKÔL: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-700));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
