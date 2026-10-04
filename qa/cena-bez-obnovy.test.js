/**
 * Mesačné členstvo bez automatickej obnovy je o 10 % drahšie (Marek 4. 10. 2026).
 * Kto už členstvo mal, platí starú cenu ďalej; keď si ho zruší a vráti sa neskôr,
 * platí novú.
 *
 * Overuje: ceny v ponuke plánov, jednorazovú platbu kartou, prevod/hotovosť,
 * odber (bez prirážky), predaj trénerom na mieste, držanie starej ceny aj jej
 * dobehnutie po prerušení členstva, a že permanentka prirážku nemá.
 *
 * Spustenie:  node qa/cena-bez-obnovy.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4626, BASE = 'http://localhost:' + PORT;
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-cena-'));
let ok = 0, zle = 0;
const t = (n, c, d) => { if (c) { ok++; console.log('  ✅ ' + n); } else { zle++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const den = p => { const d = new Date(Date.now() + p * 864e5); return d.toISOString().slice(0, 10); };

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaCeAdmin000001', name: 'Adam Admin', email: 'qa.ce.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01', referral_code: 'QACE01' },
    { _id: 'qaCeStara000001', name: 'Stará Členka', email: 'qa.ce.stara@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QACE02' },
    { _id: 'qaCeNova0000001', name: 'Nová Klientka', email: 'qa.ce.nova@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QACE03' },
    { _id: 'qaCeByvala00001', name: 'Bývalá Členka', email: 'qa.ce.byvala@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QACE04' },
    { _id: 'qaCeDohoda00001', name: 'Dohodnutá Cena', email: 'qa.ce.dohoda@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QACE05', custom_prices: { bronze: 40 } },
  ]));
  fs.writeFileSync(path.join(DATA, 'memberships.db'), riadky([
    // beží → stará cena sa zachová
    { _id: 'qaCeMem00000001', user_id: 'qaCeStara000001', plan_id: 'bronze', plan_name: 'Bronze', price: 49.9, status: 'active', started_at: den(-20) + 'T10:00:00.000Z', expires_at: den(10) + 'T10:00:00.000Z', created_at: den(-20) },
    // dávno skončené → prirážka platí
    { _id: 'qaCeMem00000002', user_id: 'qaCeByvala00001', plan_id: 'bronze', plan_name: 'Bronze', price: 49.9, status: 'expired', started_at: den(-200) + 'T10:00:00.000Z', expires_at: den(-170) + 'T10:00:00.000Z', created_at: den(-200) },
    { _id: 'qaCeMem00000003', user_id: 'qaCeDohoda00001', plan_id: 'bronze', plan_name: 'Bronze', price: 40, status: 'expired', started_at: den(-200) + 'T10:00:00.000Z', expires_at: den(-170) + 'T10:00:00.000Z', created_at: den(-200) },
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1']
    .map((x, i) => ({ _id: 'qaCeSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('CENA BEZ AUTOMATICKEJ OBNOVY — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', STRIPE_FAKE: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; srv.stderr.on('data', d => { err += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + err.slice(-600)); process.exit(1); }
  await sleep(12000);  // migrácie pri štarte (stará cena beží 8 s po nábehu)

  const prihlas = async email => { const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Heslo123!' }) }); return String(r.headers.get('set-cookie') || '').split(';')[0]; };
  const get = async (cesta, c) => (await fetch(BASE + cesta, { headers: c ? { Cookie: c } : {} })).json();
  const post = async (cesta, telo, c) => { const r = await fetch(BASE + cesta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) }, body: JSON.stringify(telo) }); let d = null; try { d = await r.json(); } catch (e) {} return { status: r.status, d }; };
  const users = () => fs.readFileSync(path.join(DATA, 'users.db'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x)).reduce((a, u) => (a[u._id] = u, a), {});

  try {
    // ── migrácia: bežiace členstvo = stará cena
    const u = users();
    t('bežiacej členke sa uložila stará cena', !!u['qaCeStara000001'].stara_cena_do, JSON.stringify(u['qaCeStara000001'].stara_cena_do));
    t('bývalej členke sa stará cena neuložila', !u['qaCeByvala00001'].stara_cena_do, JSON.stringify(u['qaCeByvala00001'].stara_cena_do));

    const cNova = await prihlas('qa.ce.nova@qa-biz.local');
    const cStara = await prihlas('qa.ce.stara@qa-biz.local');
    const cByvala = await prihlas('qa.ce.byvala@qa-biz.local');
    const cDohoda = await prihlas('qa.ce.dohoda@qa-biz.local');
    const cAdmin = await prihlas('qa.ce.admin@qa-biz.local');

    // ── ponuka plánov
    const pNova = await get('/api/membership/plans', cNova);
    t('Bronze s obnovou 49,90 € a bez nej 54,90 €', pNova.bronze.price === 49.9 && pNova.bronze.price_manual === 54.9, JSON.stringify(pNova.bronze));
    t('Silver 74,90 → 82,40 €', pNova.silver.price === 74.9 && pNova.silver.price_manual === 82.4, JSON.stringify({ a: pNova.silver.price, m: pNova.silver.price_manual }));
    t('Gold 124,90 → 137,40 €', pNova.gold.price === 124.9 && pNova.gold.price_manual === 137.4, JSON.stringify({ a: pNova.gold.price, m: pNova.gold.price_manual }));
    t('permanentka prirážku nemá', pNova.permanentka10.price_manual === undefined, JSON.stringify(pNova.permanentka10));
    const pStara = await get('/api/membership/plans', cStara);
    t('členka so starou cenou má obe ceny rovnaké', pStara.bronze.price === 49.9 && pStara.bronze.price_manual === 49.9 && pStara.bronze.stara_cena === true, JSON.stringify(pStara.bronze));
    const pDohoda = await get('/api/membership/plans', cDohoda);
    t('dohodnutá cena 40 € ostáva aj bez obnovy', pDohoda.bronze.price === 40 && pDohoda.bronze.price_manual === 40, JSON.stringify(pDohoda.bronze));

    // ── prevod/hotovosť v samoobsluhe (bez automatickej obnovy)
    const mByvala = await post('/api/membership/buy', { plan_id: 'bronze', payment_method: 'manual' }, cByvala);
    t('prevod: bývalá členka platí novú cenu 54,90 €', mByvala.status === 200 && mByvala.d.final_price === 54.9, JSON.stringify(mByvala.d).slice(0, 160));

    // ── predĺženie členstva klientke so starou cenou (tréner na mieste, hotovosť)
    const predaj = await post('/api/trainer/sell', { user_id: 'qaCeStara000001', kind: 'plan', plan_id: 'bronze' }, cAdmin);
    t('tréner predal Bronze so starou cenou 49,90 €', predaj.status === 200 && predaj.d.amount === 49.9, JSON.stringify(predaj.d).slice(0, 140));

    // ── predaj trénerom na mieste
    const so = await get('/api/trainer/sell-options?user_id=qaCeNova0000001', cAdmin);
    const bronzeS = (so.plans || []).find(p => p.id === 'bronze');
    t('tréner predáva Bronze za 54,90 € (hotovosť = bez obnovy)', bronzeS && bronzeS.price === 54.9 && bronzeS.price_auto === 49.9, JSON.stringify(bronzeS));
    const soStara = await get('/api/trainer/sell-options?user_id=qaCeStara000001', cAdmin);
    t('klientke so starou cenou ponúkne 49,90 €', (soStara.plans || []).find(p => p.id === 'bronze')?.price === 49.9, JSON.stringify((soStara.plans || []).find(p => p.id === 'bronze')));

    // ── stará cena sa pri predĺžení posunula ďalej
    const u3 = users();
    t('stará cena sa po predĺžení posunula ďalej', u3['qaCeStara000001'].stara_cena_do > u['qaCeStara000001'].stara_cena_do,
      JSON.stringify({ pred: u['qaCeStara000001'].stara_cena_do, po: u3['qaCeStara000001'].stara_cena_do }));

    // ── odber a karta: Stripe v QA nebeží (bez kľúča vracia 400), preto kontrolujeme,
    // ktorú cenu im server posiela
    const src = fs.readFileSync(path.join(KOREN, 'server.js'), 'utf8');
    t('odber posiela cenu s obnovou, nie s prirážkou', src.includes("'line_items[0][price_data][unit_amount]':Math.round((await cenyClenstva(memberId, plan_id)).auto*100)"), 'riadok odberu');
    t('jednorazová platba kartou berie cenu bez obnovy', /const ceny = await cenyClenstva\(memberId, plan_id\);[\s\S]{0,260}price = ceny\.manual;/.test(src), 'riadok platby kartou');
    t('prirážka je na jednom mieste v kóde', /const OBNOVA_PRIRAZKA = 0\.10;/.test(src) && (src.match(/cenaBezObnovy\(/g) || []).length >= 2);
  } catch (e) {
    zle++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nCENA BEZ OBNOVY: ' + ok + ' OK / ' + zle + ' chýb');
    process.exit(zle ? 1 : 0);
  }
})();
