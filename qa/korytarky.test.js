/**
 * Nová pobočka Korytárky + preskočenie prvého týždňa zadarmo (Marek 13. 10. 2026).
 *
 * Overuje:
 *  - migrácia založí Zumbu v Korytárkach (utorok 19:00, Beáta, 25 miest) a je v /api/classes
 *  - kiosk má pobočku korytarky zapnutú s vlastným kľúčom, staré pobočky ostali
 *  - nová klientka s týždňom zadarmo sa na Korytárky rezervuje → nástenka ponúkne preskočenie
 *  - preskočenie ukončí skúšku, rezervácia z nej prejde na platbu na mieste, ďalšia rezervácia pýta platbu
 *  - kto do Korytárok nechodí, ponuku preskočenia nevidí
 *
 * Spustenie:  node qa/korytarky.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');

const PORT = 4631, BASE = 'http://localhost:' + PORT;
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-korytarky-'));
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';

(async () => {
  // Starý kiosk config bez Korytárok — nová pobočka sa musí doplniť
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky([
    ...['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1']
      .map((x, i) => ({ _id: 'qaKoSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' })),
    { _id: 'qaKoKiosk', key: 'kiosk_config', at: '2026-09-14T00:00:00.000Z', value: { studios: Object.fromEntries(['detva', 'zvolen', 'bb', 'brezno']
      .map(s => [s, { enabled: s === 'detva', token: 'tok' + s, interval_s: 12, idle_s: 15, night_off: '21:30', night_on: '07:30', widgets: {}, announcement: '', custom_slides: [] }])) } }
  ]));

  console.log('KORYTÁRKY — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', PRVY_TYZDEN: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; srv.stderr.on('data', d => { stderr += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + stderr.slice(-600)); process.exit(1); }
  await sleep(4000);

  const registruj = async (telo) => {
    const r = await fetch(BASE + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'Heslo123!', user_type: 'client', consent: true, ...telo }) });
    return { status: r.status, d: await r.json().catch(() => ({})), cookie: String(r.headers.get('set-cookie') || '').split(';')[0] };
  };
  const me = async cookie => (await fetch(BASE + '/api/me', { headers: { Cookie: cookie } })).json();
  const rezervuj = async (cookie, telo) => { const r = await fetch(BASE + '/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(telo) });
    return { status: r.status, d: await r.json().catch(() => ({})) }; };

  try {
    const classes = await (await fetch(BASE + '/api/classes')).json();
    const k = classes.find(c => c.location === 'Korytárky');
    ok('hodina v Korytárkach existuje', !!k, classes.map(c => c.location).join(','));
    ok('utorok 19:00–20:00, Zumba, 25 miest', k && k.day_of_week === 2 && k.time_start === '19:00' && k.time_end === '20:00' && k.category === 'Zumba' && k.capacity === 25, JSON.stringify(k || {}).slice(0, 200));
    ok('učí Beáta, adresa Kultúrny dom', k && /Beáta/.test(k.instructor) && /Kultúrny dom/.test(k.address || ''), k && (k.instructor + ' / ' + k.address));
    ok('minimum 8 prihlásených platí', !!(k && k.min_ucast && k.min_ucast.pocet === 8), JSON.stringify(k && k.min_ucast));

    const set = fs.readFileSync(path.join(DATA, 'settings.db'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(x => x.key === 'kiosk_config').pop();
    const st = set && set.value.studios;
    ok('kiosk má pobočku korytarky zapnutú s kľúčom', !!(st && st.korytarky && st.korytarky.enabled && st.korytarky.token && st.korytarky.token.length >= 20), JSON.stringify(st && st.korytarky));
    ok('staré pobočky kiosku ostali nezmenené', !!(st && st.detva.token === 'tokdetva' && st.detva.enabled === true && st.brezno.enabled === false));
    const kr = await fetch(BASE + '/api/kiosk/content?studio=korytarky&k=' + (st && st.korytarky.token));
    const krd = await kr.json().catch(() => ({}));
    ok('kiosk Korytárky odpovedá a ukazuje svoju hodinu', kr.status === 200 && krd.city === 'Korytárky', kr.status + ' ' + JSON.stringify(krd).slice(0, 160));

    // ── nová klientka z Korytárok
    const a = await registruj({ name: 'Klára Korytárska', email: 'qa.ko.klara@qa-biz.local', phone: '0900111333' });
    ok('registrácia prejde a skúška beží', a.status === 200 && (await me(a.cookie)).trial.active === true);
    ok('pred rezerváciou ponuka preskočenia nie je', (await me(a.cookie)).trial.skip_offer === false);
    const b1 = await rezervuj(a.cookie, { class_id: k._id });
    ok('rezervácia na Korytárky v rámci skúšky', b1.status === 200, JSON.stringify(b1.d).slice(0, 200));
    const m1 = await me(a.cookie);
    ok('po rezervácii nástenka ponúkne preskočenie', m1.trial.skip_offer === true, JSON.stringify(m1.trial));

    const sk = await fetch(BASE + '/api/skuska/preskocit', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: a.cookie }, body: '{}' });
    const skd = await sk.json();
    ok('preskočenie prejde', sk.status === 200 && skd.ok && skd.bezal === true && skd.prepnute === 1, JSON.stringify(skd));
    const m2 = await me(a.cookie);
    ok('skúška už nebeží a nedá sa zapnúť znova', m2.trial.active === false && m2.trial.eligible === false && m2.trial.skipped === true, JSON.stringify(m2.trial));
    ok('členstvo zo skúšky nie je aktívne', !(m2.membership && m2.membership.status === 'active'), JSON.stringify(m2.membership));
    const moje = await (await fetch(BASE + '/api/my-bookings', { headers: { Cookie: a.cookie } })).json();
    const bk = (Array.isArray(moje) ? moje : (moje.bookings || [])).find(x => x.class_id === k._id);
    ok('rezervácia ostala, platí sa na mieste 10 €', !!(bk && bk.status === 'confirmed' && bk.pay_on_site === true && bk.pay_amount === 10), JSON.stringify(bk || {}).slice(0, 220));

    const z = classes.find(c => c.location === 'Zvolen' && c.category === 'Zumba');
    if (z) {
      const b2 = await rezervuj(a.cookie, { class_id: z._id });
      ok('ďalšia hodina už pýta platbu (bez ponuky skúšky)', b2.status === 402 && b2.d.error === 'membership_required' && !b2.d.trial_available, JSON.stringify(b2.d).slice(0, 200));
    }

    // ── klientka mimo Korytárok
    const c = await registruj({ name: 'Zuzka Zvolenská', email: 'qa.ko.zuzka@qa-biz.local', phone: '0900111444' });
    if (z) await rezervuj(c.cookie, { class_id: z._id });
    ok('mimo Korytárok sa preskočenie neponúka', (await me(c.cookie)).trial.skip_offer === false);

    const zdroj = fs.readFileSync(path.join(KOREN, 'public/index.html'), 'utf8');
    ok('rezervácia v registrácii má tlačidlo preskočenia', zdroj.includes('bcSkipBtn') && zdroj.includes('/skuska-preskocit.js'));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nKORYTÁRKY: ' + passed + ' OK / ' + failed + ' chýb');
    process.exit(failed ? 1 : 0);
  }
})();
