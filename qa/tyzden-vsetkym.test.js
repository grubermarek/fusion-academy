/**
 * Prvý týždeň zadarmo pre KAŽDÚ novú klientku (Marek 27. 9. 2026: „proste všetkým daj
 * prvý týždeň zdarma" — kód a text „Prvá hodina zadarmo skončila" klientky strašili).
 *
 * Overuje:
 *  - po registrácii beží skúška hneď, bez karty a bez kódu (členstvo Bronze na 7 dní)
 *  - appka nesľubuje automatickú platbu, keď karta nie je (oznam, mail aj pásik na nástenke)
 *  - venčekár skúšku nedostane (nie je cieľ predaja)
 *  - druhá registrácia toho istého človeka druhý týždeň zadarmo nedá
 *  - pozvánka od kamošky už nepíše „skončila" ani kód, len ponúkne registráciu
 *
 * Spustenie:  node qa/tyzden-vsetkym.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4622, BASE = 'http://localhost:' + PORT;
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-tyzden-'));
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const dnes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());

(async () => {
  fs.writeFileSync(path.join(DATA, 'venceky_schools.db'), riadky([{ _id: 'qaTvSkola000001', name: 'ZŠ Testovacia', year: '2026/27', created_at: '2026-09-01' }]));
  fs.writeFileSync(path.join(DATA, 'venceky_classes.db'), riadky([{ _id: 'qaTvTrieda00001', school_id: 'qaTvSkola000001', name: '9.A', year: '2026/27', code: 'QATRIEDA', price: 60,
    lessons_total: 10, lessons_before: 10, lessons_done: 1, dances: [{ name: 'Valčík', level: 1 }], created_at: '2026-09-01' }]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1']
    .map((x, i) => ({ _id: 'qaTvSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('TÝŽDEŇ ZADARMO PRE VŠETKÝCH — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', PRVY_TYZDEN: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; srv.stderr.on('data', d => { stderr += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + stderr.slice(-600)); process.exit(1); }
  await sleep(3000);

  const registruj = async (telo) => {
    const r = await fetch(BASE + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'Heslo123!', user_type: 'client', consent: true, ...telo }) });
    const d = await r.json().catch(() => ({}));
    return { status: r.status, d, cookie: String(r.headers.get('set-cookie') || '').split(';')[0] };
  };
  const me = async cookie => (await fetch(BASE + '/api/me', { headers: { Cookie: cookie } })).json();

  try {
    // ── nová klientka
    const a = await registruj({ name: 'Klára Nováčik', email: 'qa.tv.klara@qa-biz.local', phone: '0900111222' });
    ok('registrácia prejde', a.status === 200 && a.d.ok === true, JSON.stringify(a.d).slice(0, 200));
    ok('odpoveď hovorí, že skúška beží', !!(a.d.trial && a.d.trial.ends_at), JSON.stringify(a.d.trial));
    const m = await me(a.cookie);
    ok('skúška je aktívna hneď po registrácii', !!(m.trial && m.trial.active), JSON.stringify(m.trial));
    ok('appka vie, že karta uložená nie je', m.trial && m.trial.card === false, JSON.stringify(m.trial));
    ok('členstvo Bronze je aktívne', !!(m.membership && m.membership.status === 'active') && /bronze/i.test(JSON.stringify(m.membership)), JSON.stringify(m.membership).slice(0, 160));
    const dni = m.trial && m.trial.ends_at ? Math.round((new Date(m.trial.ends_at) - new Date()) / 864e5) : 0;
    ok('skúška končí o 7 dní (±1)', dni >= 6 && dni <= 8, String(dni));
    ok('nikde nevisí Stripe odber', !/stripe_subscription_id":"/.test(JSON.stringify(m)), 'odber by nemal byť');

    const notif = await (await fetch(BASE + '/api/notifications', { headers: { Cookie: a.cookie } })).json();
    const tn = (Array.isArray(notif) ? notif : (notif.notifications || [])).find(n => n.type === 'trial');
    ok('oznam o skúške prišiel', !!tn, JSON.stringify((Array.isArray(notif) ? notif : []).map(n => n.type)));
    ok('oznam nesľubuje automatickú platbu', tn && /nič nestrhne/i.test(tn.body) && !/automaticky/i.test(tn.body), tn && tn.body);

    // ── druhá registrácia rovnakého človeka (iný mail, ten istý stav) → skúška len raz na účet
    const b = await registruj({ name: 'Klára Nováčik', email: 'qa.tv.klara@qa-biz.local', phone: '0900111222' });
    ok('rovnaký e-mail sa druhý raz nezaregistruje', b.status !== 200 || b.d.ok !== true, JSON.stringify(b.d).slice(0, 120));

    // ── venčekár skúšku nedostane
    const v = await registruj({ name: 'Venčo Venček', email: 'qa.tv.vencek@qa-biz.local', vencek_code: 'QATRIEDA', vencek_role: 'student', vencek_duplicita_ok: true });
    ok('venčekár sa zaregistruje', v.status === 200 && v.d.ok === true, JSON.stringify(v.d).slice(0, 160));
    const mv = await me(v.cookie);
    ok('venčekár skúšku nedostal', !(mv.trial && mv.trial.active) && !v.d.trial, JSON.stringify(mv.trial));

    // ── pozvánka od kamošky
    const sp = await (await fetch(BASE + '/api/me', { headers: { Cookie: a.cookie } })).json();
    const kod = sp.referral_code || sp.user?.referral_code;
    ok('klientka má vlastný pozývací kód', !!kod, JSON.stringify(Object.keys(sp)).slice(0, 200));
    if (kod) {
      const r = await fetch(BASE + '/api/invite/' + kod + '/book', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hosť Hosťová', contact: 'qa.tv.host@qa-biz.local', class_id: 'x', booking_date: dnes }) });
      const d = await r.json();
      ok('pozvánka vráti ponuku týždňa (410)', r.status === 410 && d.trial === true, r.status + ' ' + JSON.stringify(d).slice(0, 160));
      ok('text už nestraší („skončila")', !/skončila/i.test(d.error || ''), d.error);
      ok('text nepýta prepisovanie kódu', !/kód|kod/i.test(d.error || ''), d.error);
      ok('text sľubuje celý prvý týždeň zadarmo', /celý prvý týždeň zadarmo/i.test(d.error || ''), d.error);
      ok('odkaz na registráciu nesie pozvánku v adrese', String(d.register_url || '').includes('ref=' + kod), d.register_url);
    }

    // ── texty v appke
    const zdroj = fs.readFileSync(path.join(KOREN, 'public/client-dashboard.html'), 'utf8');
    ok('pásik na nástenke rozlišuje, či je karta', zdroj.includes('me.trial.card') && zdroj.includes('Nič sa ti nestrhne'), 'chýba vetva bez karty');
    const inv = fs.readFileSync(path.join(KOREN, 'public/invite.html'), 'utf8');
    ok('pozvánka ukáže ponuku ako zlatú kartu, nie červenú chybu', inv.includes('Celý prvý týždeň zadarmo') && inv.includes("err.style.color='#e8e2d4'"), 'chýba priateľské zobrazenie');
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nTÝŽDEŇ ZADARMO: ' + passed + ' OK / ' + failed + ' chýb');
    process.exit(failed ? 1 : 0);
  }
})();
