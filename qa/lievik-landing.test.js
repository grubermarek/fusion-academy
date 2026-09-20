/**
 * Lievik stránok + landing /prva-hodina s prvým týždňom zadarmo (19. 9. 2026)
 * Testuje: kroky lievika (POST /api/funnel + serverové kroky), presmerovanie kliku z reklamy
 * z úvodu na landing, rezerváciu z landingu so skúškou (účet s heslom, session, next:'trial'),
 * povinný e-mail (telefón účet nezaloží), režim bez karty (skúška sa zapne hneď), A/B cookie,
 * admin štatistiku.
 *
 * Spustenie:  node qa/lievik-landing.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4499;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-lievik-'));

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name); } };
const jar = {};
const cookieHdr = () => Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
const j = async (url, opts = {}) => {
  const r = await fetch(BASE + url, { redirect: 'manual', headers: { 'Content-Type': 'application/json', 'Cookie': cookieHdr(), ...(opts.headers || {}) }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); });
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d, headers: r.headers };
};
const dbLines = (file, needle) => fs.readFileSync(path.join(DATA, file), 'utf8').split('\n').filter(l => l.includes(needle)).map(l => JSON.parse(l));

(async () => {
  console.log('LIEVIK QA — štart servera (PRVY_TYZDEN=1, STRIPE_FAKE=1)…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', PRVY_TYZDEN: '1', STRIPE_FAKE: '1', MAIL_CAPTURE: '1', STRIPE_SECRET_KEY: 'sk_test_fake' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    // 1) klik z reklamy na úvod → landing
    const r1 = await j('/?utm_source=fb&utm_medium=cpc&utm_campaign=qa-hej-baby&fbclid=fb.qa.1');
    ok('klik z reklamy na / presmeruje na /prva-hodina', r1.status === 302 && String(r1.headers.get('location')).startsWith('/prva-hodina?utm_source=fb'));
    ok('cookie fa_zdroj + fa_vid nastavené', !!jar.fa_zdroj && !!jar.fa_vid);
    const r1b = await j('/?utm_source=email_campaign&utm_campaign=newsletter');
    ok('vlastný mail (utm_source=email) ostáva na úvode', r1b.status === 200);
    const r1c = await j('/?ref=ABC123&utm_source=fb');
    ok('pozvánka (?ref=) ostáva na úvode', r1c.status === 200);
    const lp = await j('/prva-hodina?utm_source=fb&utm_campaign=qa-hej-baby');
    ok('landing je 200 aj so zapnutou skúškou', lp.status === 200);
    const cfg = await j('/api/landing/config');
    ok('landing config: skúška zapnutá, variant karta', cfg.d && cfg.d.prvy_tyzden === true && cfg.d.variant === 'karta');

    // 2) kroky zo stránky
    for (const krok of ['lp_view', 'lp_termin', 'form_view', 'form_start', 'form_submit']) {
      const r = await j('/api/funnel', { method: 'POST', body: { krok, stranka: '/prva-hodina', meta: { city: 'Zvolen' } } });
      ok('krok ' + krok + ' prijatý (204)', r.status === 204);
    }
    const bad = await j('/api/funnel', { method: 'POST', body: { krok: 'hocico', stranka: '/prva-hodina' } });
    ok('neznámy krok sa ticho ignoruje', bad.status === 204 && dbLines('funnel_events.db', '"hocico"').length === 0);
    const evLp = dbLines('funnel_events.db', '"lp_view"');
    ok('krok má vid, kampaň zo zdroja a stránku', evLp.length === 1 && evLp[0].vid === jar.fa_vid && evLp[0].kampan === 'qa-hej-baby' && evLp[0].stranka === '/prva-hodina');

    // 3) rezervácia z landingu — e-mail, skúška s kartou
    const sc = await j('/api/first-class/schedule?city=zvolen');
    ok('rozvrh ok', sc.d && sc.d.ok && sc.d.items.length > 0);
    const sess = sc.d.items[0];
    const bk = await j('/api/first-class/book', { method: 'POST', body: { name: 'Qa Lievikova', kontakt: 'qa.lievik@qa-biz.local', class_id: sess.class_id, booking_date: sess.date,
      attribution: { utm_source: 'fb', utm_campaign: 'qa-hej-baby', fbclid: 'fb.qa.1', landing: '/prva-hodina' } } });
    ok('rezervácia ok, next=trial, heslo v odpovedi', bk.d && bk.d.ok && bk.d.next === 'trial' && /^Zumba\d{4}$/.test(bk.d.heslo || '') && bk.d.variant === 'karta');
    const u = dbLines('users.db', 'qa.lievik@qa-biz.local').pop();
    ok('účet má heslo, vid, variant, self_registration', !!u.password && u.funnel_vid === jar.fa_vid && u.landing_variant === 'karta' && u.account_creation_type === 'self_registration');
    ok('free_class_used sa pri skúške nenastavuje', !u.free_class_used);
    const b = dbLines('bookings.db', u._id).pop();
    ok('rezervácia confirmed, access trial, nie free_class', b.status === 'confirmed' && b.access_method === 'trial' && b.free_class === false && b.source === 'prva-hodina');
    const me = await j('/api/me');
    ok('po rezervácii je návštevníčka prihlásená (session)', me.d && me.d.id === u._id);
    ok('serverové kroky booking_ok + register_ok', dbLines('funnel_events.db', '"booking_ok"').length === 1 && dbLines('funnel_events.db', '"register_ok"').length === 1);

    // 4) skúška zo landingu → Stripe (fake) → návrat na /prva-hodina
    const tr = await j('/api/stripe/trial', { method: 'POST', body: { navrat: 'landing' } });
    ok('trial session vracia url späť na landing', tr.d && tr.d.ok && /\/prva-hodina\?stripe=trial/.test(tr.d.url));
    ok('krok trial_open zapísaný', dbLines('funnel_events.db', '"trial_open"').length === 1);

    // 5) duplicita: ten istý kontakt s heslom na iný termín → 409 + login (rovnaký termín = 409 „už máš rezerváciu")
    const other0 = sc.d.items.find(i => i.class_id !== sess.class_id) || sess;
    const dup = await j('/api/first-class/book', { method: 'POST', body: { name: 'Qa Lievikova', kontakt: 'qa.lievik@qa-biz.local', class_id: other0.class_id, booking_date: other0.date } });
    ok('existujúci účet s heslom → 409 login', dup.status === 409 && dup.d && dup.d.login === true);
    const dup0 = await j('/api/first-class/book', { method: 'POST', body: { name: 'Qa Lievikova', kontakt: 'qa.lievik@qa-biz.local', class_id: sess.class_id, booking_date: sess.date } });
    ok('rovnaký termín znova → 409', dup0.status === 409);

    // 6) prihlásenie: odhlásiť, prihlásiť heslom z odpovede
    await j('/api/logout', { method: 'POST' });
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.lievik@qa-biz.local', password: bk.d.heslo } });
    ok('prihlásenie heslom z potvrdenia', lg.d && lg.d.ok);
    await j('/api/logout', { method: 'POST' });

    // 7) e-mail je POVINNÝ (Marek 20. 9.) — samotné telefónne číslo účet nezaloží
    delete jar.fa_vid; delete jar.fa_zdroj; delete jar['connect.sid']; delete jar.sid; delete jar['fa.sid'];
    await j('/prva-hodina?utm_source=ig&utm_campaign=qa-tel');
    const other = sc.d.items.find(i => i.class_id !== sess.class_id) || sess;
    const bt = await j('/api/first-class/book', { method: 'POST', body: { name: 'Qa Telefonova', kontakt: '0900 555 666', class_id: other.class_id, booking_date: other.date } });
    ok('rezervácia bez e-mailu odmietnutá (400)', bt.status === 400 && /e-mail/i.test(String(bt.d && bt.d.error)));
    const bz = await j('/api/first-class/book', { method: 'POST', body: { name: 'Qa Telefonova', kontakt: 'nie-je-mail', class_id: other.class_id, booking_date: other.date } });
    ok('nezmysel namiesto e-mailu odmietnutý (400)', bz.status === 400);
    ok('účet bez e-mailu nevznikol', dbLines('users.db', 'Qa Telefonova').length === 0 && dbLines('users.db', '@bez-emailu.local').length === 0);
    const mailLog = fs.existsSync(path.join(DATA, 'mail_log.db')) ? fs.readFileSync(path.join(DATA, 'mail_log.db'), 'utf8') : '';
    ok('potvrdenie e-mailom sa zalogovalo (capture)', mailLog.includes('qa.lievik@qa-biz.local'));
    ok('na syntetický e-mail sa nič neposiela', !mailLog.includes('@bez-emailu.local'));
    await j('/api/logout', { method: 'POST' });

    // 8) režim bez karty: admin prepne, skúška sa zapne hneď pri rezervácii
    const adm = await j('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } });
    ok('admin prihlásený', adm.d && adm.d.ok);
    const setAb = await j('/api/admin/landing-ab', { method: 'POST', body: { rezim: 'bez_karty' } });
    ok('režim bez_karty uložený', setAb.d && setAb.d.ok);
    const stat = await j('/api/admin/funnel-stranky?days=7');
    ok('admin lievik: landing má kroky a kampaň qa-hej-baby', stat.d && stat.d.ok && stat.d.stranky['/prva-hodina'].kroky.find(k => k.krok === 'booking_ok').n >= 1 && stat.d.kampane.some(k => k.kampan === 'qa-hej-baby'));
    ok('admin lievik: rezim = bez_karty', stat.d.rezim === 'bez_karty');
    await j('/api/logout', { method: 'POST' });
    delete jar.fa_vid; delete jar.fa_zdroj;
    const cfg2 = await j('/api/landing/config');
    ok('landing config hlási bez_karty', cfg2.d && cfg2.d.variant === 'bez_karty');
    const third = sc.d.items.find(i => i.class_id !== sess.class_id && i.class_id !== other.class_id) || other;
    const bb = await j('/api/first-class/book', { method: 'POST', body: { name: 'Qa Bezkarty', kontakt: 'qa.bezkarty@qa-biz.local', class_id: third.class_id, booking_date: third.date } });
    ok('bez karty: next=done a skúška beží', bb.d && bb.d.ok && bb.d.next === 'done' && bb.d.skuska && !!bb.d.skuska.ends_at);
    const ub = dbLines('users.db', 'qa.bezkarty@qa-biz.local').pop();
    ok('účet má trial_used + trial_ends_at, bez Stripe', ub.trial_used === true && !!ub.trial_ends_at && !ub.stripe_subscription_id);
    ok('krok trial_ok zo servera', dbLines('funnel_events.db', '"trial_ok"').some(e => e.uid === ub._id));

    // 9) A/B režim: cookie fa_ab
    await j('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } });
    await j('/api/admin/landing-ab', { method: 'POST', body: { rezim: 'ab' } });
    const badAb = await j('/api/admin/landing-ab', { method: 'POST', body: { rezim: 'nieco' } });
    ok('neplatný režim odmietnutý', badAb.status === 400);
    await j('/api/logout', { method: 'POST' });
    delete jar.fa_ab;
    const cfg3 = await j('/api/landing/config');
    ok('A/B: variant priradený a uložený v cookie', cfg3.d && ['karta', 'bez_karty'].includes(cfg3.d.variant) && jar.fa_ab === cfg3.d.variant);
    const cfg4 = await j('/api/landing/config');
    ok('A/B: variant sa drží (rovnaká cookie)', cfg4.d.variant === cfg3.d.variant);
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message + '\n' + e.stack);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nLIEVIK: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
