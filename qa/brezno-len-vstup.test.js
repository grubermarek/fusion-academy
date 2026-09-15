/**
 * Brezno len za jednorazový vstup 10 € (Marek 15. 9. 2026): „v Brezne budeme dočasne učiť len za 10 € na hodinu
 * jednorazové vstupy, kým sa nám nerozbehne návštevnosť". Členstvo tam hodinu nekryje; kto mal 15. 9. zaplatené
 * členstvo, tomu dobehne do konca („dobehne, potom 10 €").
 *
 * A) migrácia: do zoznamu „dobieha" sa zapíše aktívne platené členstvo, nie online, permanentka ani vypršané;
 *    hodiny v Brezne majú cenu 10 € a v popise oznam
 * B) pravidlo:
 *    - rezervácia: členka zo zoznamu kryté; iná členka 402 (len_vstup, 10 €, bez skúšky), na mieste 10 € bez
 *      predaja členstva; Zvolen ostáva krytý členstvom; vstup z appky sa odpočíta
 *    - kiosk: zoznam (len_vstup, 10 €), zápis (hotovosť 10 €), check-in (402 ask_cash 10 €), členka zo zoznamu prejde
 *    - tréner: stav klientky pri hodine (len_vstup), manuálny zápis „členstvo" odmietne, „na mieste" 10 € prejde,
 *      QR check-in bez krytia
 *    - profil: okno „Jednorazový vstup" bez ponuky členstva
 * Spustenie:  node qa/brezno-len-vstup.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const mkRd = DATA => f => { const p = path.join(DATA, f); if (!fs.existsSync(p)) return []; const m = new Map();
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l.trim()) continue; let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o.$$indexCreated) continue; if (o.$$deleted) { m.delete(o._id); continue; } m.set(o._id, o); } return [...m.values()]; };
const mkJ = BASE => async (url, opts = {}, jar) => {
  const headers = { 'Content-Type': 'application/json' };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
};
async function start(PORT, DATA) {
  const BASE = 'http://localhost:' + PORT;
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' };
  delete env.PRVY_TYZDEN;
  const proc = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: 'ignore' });
  const t0 = Date.now(); while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); break; } catch (e) { await sleep(1000); } }
  await sleep(3000);
  return { proc, BASE };
}

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const DOW = new Date().getDay();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  if (nowMin < 60 || nowMin + 120 > 23 * 60 + 30) { console.log('  ⏭️  test beží v noci — hodiny by pretiekli cez polnoc, spusti ho cez deň'); process.exit(0); }
  const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const dni = n => new Date(Date.now() + n * 86400000).toISOString();
  const pm = new Date(+DNES.slice(0, 4), +DNES.slice(5, 7) - 2, 1);
  const mw = riadky([{ _id: 'qaBrMW01', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'x', created_at: '2026-01-01' }]);
  const STARE = ['retro_confirm_v1', 'noshow_revert_v1', 'brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'stripe_obnovy_doplnenie_20260915', 'hotovost_dodatocne_20260914', 'hotovost_dodatocne2_20260914'];
  const U = (id, name, extra) => ({ _id: id, name, email: id.toLowerCase() + '@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-06-01', city: 'Brezno',
    onboarding_done: true, free_class_used: true, visit_count: 5, free_credits: 0, single_entries: 0, referral_code: 'QABR' + id.slice(4, 8).toUpperCase(), ...(extra || {}) });
  const M = (id, uid, plan, status, exp, extra) => ({ _id: id, user_id: uid, plan_id: plan, plan_name: plan, status, started_at: dni(-20), expires_at: exp, price: 49.9, created_at: dni(-20), ...(extra || {}) });
  const CL = (id, name, loc, extra) => ({ _id: id, name, emoji: '💃', category: 'Zumba', instructor: 'Tina Trénerka', instructor_id: 'qaBrTrener00001', location: loc, day_of_week: DOW,
    time_start: hhmm(nowMin + 30), time_end: hhmm(nowMin + 85), capacity: 30, price: 10, active: true, created_at: '2026-01-01', description: 'Zumba pre všetky', ...(extra || {}) });
  let srv = null, browser = null;

  // ═══ A) migrácia ═══
  const DA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-brA-'));
  fs.writeFileSync(path.join(DA, 'users.db'), riadky([U('qaBrEma0000001', 'Ema Členka'), U('qaBrOlivia00001', 'Olívia Online'), U('qaBrStara000001', 'Stanka Stará'), U('qaBrPerm0000001', 'Paula Permanentka')]));
  fs.writeFileSync(path.join(DA, 'memberships.db'), riadky([
    M('qaBrMemEma', 'qaBrEma0000001', 'bronze', 'active', dni(10)),
    M('qaBrMemOl', 'qaBrOlivia00001', 'online_basic', 'active', dni(10)),
    M('qaBrMemSt', 'qaBrStara000001', 'bronze', 'active', dni(-2)),
    M('qaBrMemPe', 'qaBrPerm0000001', 'permanentka10', 'bundle', dni(40)),
  ]));
  fs.writeFileSync(path.join(DA, 'classes.db'), riadky([CL('qaBrClsBrezno', 'Zumba', 'Brezno', { price: 12 }), CL('qaBrClsZvolen', 'Zumba', 'Zvolen')]));
  fs.writeFileSync(path.join(DA, 'monthly_winners.db'), mw);
  fs.writeFileSync(path.join(DA, 'settings.db'), riadky(STARE.map((k, i) => ({ _id: 'qaBrSetA' + i, key: k, value: true, at: '2026-01-01T00:00:00.000Z' }))));
  try {
    console.log('A) MIGRÁCIA — štart servera…');
    ({ proc: srv } = await start(4601, DA));
    await sleep(14000);
    const rd = mkRd(DA);
    const s = rd('settings.db').find(x => x.key === 'mesta_len_vstup');
    const br = s && s.value && s.value.Brezno;
    ok('Brezno zapnuté: 10 €, od dnes', br && br.aktivne === true && br.cena === 10 && br.od === DNES, JSON.stringify(br && { a: br.aktivne, c: br.cena, od: br.od }));
    ok('dobieha len aktívne platené členstvo (Ema), nie online, vypršané ani permanentka', br && Object.keys(br.dobiehaju).join(',') === 'qaBrEma0000001', JSON.stringify(br && br.dobiehaju));
    const cls = rd('classes.db');
    const b = cls.find(c => c._id === 'qaBrClsBrezno'), z = cls.find(c => c._id === 'qaBrClsZvolen');
    ok('hodina v Brezne: cena 10 € a oznam v popise', b && b.price === 10 && /jednorazový vstup 10 €/.test(b.description) && /Zumba pre všetky/.test(b.description), JSON.stringify(b && { p: b.price, d: b.description }));
    ok('hodina vo Zvolene sa nezmenila', z && z.description === 'Zumba pre všetky');
  } catch (e) { failed++; console.log('  ❌ výnimka A: ' + e.stack); }
  finally { if (srv) srv.kill(); await sleep(800); fs.rmSync(DA, { recursive: true, force: true }); }

  // ═══ B) pravidlo ═══
  const DB = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-brB-'));
  fs.writeFileSync(path.join(DB, 'users.db'), riadky([
    { _id: 'qaBrAdmin000001', name: 'Adam Admin', email: 'qa.br.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01', referral_code: 'QABRAD' },
    { _id: 'qaBrTrener00001', name: 'Tina Trénerka', email: 'qa.br.tina@qa-biz.local', password: hash, user_type: 'trainer', active: true, created_at: '2026-01-01', referral_code: 'QABRTI' },
    U('qaBrEma0000001', 'Ema Členka'), U('qaBrEva0000001', 'Eva Členka'),
    U('qaBrNina000001', 'Nina Nová'), U('qaBrNora000001', 'Nora Nová'), U('qaBrZora000001', 'Zora Nová'),
    U('qaBrOlga000001', 'Olga Vstupová', { single_entries: 1 }),
  ]));
  fs.writeFileSync(path.join(DB, 'memberships.db'), riadky(['Ema', 'Eva', 'Nina', 'Nora', 'Zora'].map(n => M('qaBrMem' + n, 'qaBr' + n + (n.length === 3 ? '0000001' : '000001'), 'bronze', 'active', dni(10)))));
  fs.writeFileSync(path.join(DB, 'classes.db'), riadky([CL('qaBrClsBrezno', 'Zumba Brezno', 'Brezno'), CL('qaBrClsZvolen', 'Zumba Zvolen', 'Zvolen')]));
  fs.writeFileSync(path.join(DB, 'monthly_winners.db'), mw);
  fs.writeFileSync(path.join(DB, 'settings.db'), riadky([
    ...STARE.concat(['mesta_len_vstup_brezno_20260915']).map((k, i) => ({ _id: 'qaBrSetB' + i, key: k, value: true, at: '2026-01-01T00:00:00.000Z' })),
    { _id: 'qaBrSetLV', key: 'mesta_len_vstup', value: { Brezno: { aktivne: true, cena: 10, od: DNES, dobiehaju: { qaBrEma0000001: dni(10), qaBrEva0000001: dni(10) } } }, at: '2026-01-01T00:00:00.000Z' },
  ]));
  try {
    console.log('\nB) PRAVIDLO — štart servera…');
    let BASE; ({ proc: srv, BASE } = await start(4602, DB));
    const j = mkJ(BASE), rd = mkRd(DB);
    const jar = {};
    for (const [k, mail] of Object.entries({ admin: 'qa.br.admin@qa-biz.local', tina: 'qa.br.tina@qa-biz.local', ema: 'qabrema0000001@qa-biz.local', nina: 'qabrnina000001@qa-biz.local', olga: 'qabrolga000001@qa-biz.local' })) {
      jar[k] = {}; const lg = await j('/api/login', { method: 'POST', body: { email: mail, password: 'Heslo123!' } }, jar[k]);
      if (lg.status !== 200) ok('prihlásenie ' + k, false, JSON.stringify(lg.d));
    }
    const bk = (uid, cid) => rd('bookings.db').filter(b => b.user_id === uid && b.class_id === cid && b.status !== 'cancelled').pop();

    console.log('\nRezervácia:');
    const e1 = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaBrClsBrezno', booking_date: DNES } }, jar.ema);
    ok('Ema (členstvo jej dobieha): Brezno krytá členstvom', e1.status === 200 && (bk('qaBrEma0000001', 'qaBrClsBrezno') || {}).access_method === 'membership', JSON.stringify(e1.d));
    const n1 = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaBrClsBrezno', booking_date: DNES } }, jar.nina);
    ok('Nina (členstvo po zmene): Brezno → 402 len vstup 10 €, bez ponuky skúšky', n1.status === 402 && n1.d.len_vstup === true && n1.d.tech_price === 10 && n1.d.trial_available === false && /V Brezne/.test(n1.d.message) && n1.d.can_pay_on_site === true, JSON.stringify(n1.d));
    const n2 = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaBrClsBrezno', booking_date: DNES, pay_on_site: true, pay_plan: 'bronze' } }, jar.nina);
    const nb = bk('qaBrNina000001', 'qaBrClsBrezno') || {};
    ok('Nina na mieste: 10 €, členstvo sa na mieste nepredáva', n2.status === 200 && nb.pay_on_site === true && nb.pay_amount === 10 && !nb.pay_plan, JSON.stringify({ s: n2.status, b: { p: nb.pay_amount, plan: nb.pay_plan } }));
    const n3 = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaBrClsZvolen', booking_date: DNES } }, jar.nina);
    ok('Nina Zvolen: členstvo kryje ako doteraz', n3.status === 200 && (bk('qaBrNina000001', 'qaBrClsZvolen') || {}).access_method === 'membership', JSON.stringify(n3.d));
    const o1 = await j('/api/bookings', { method: 'POST', body: { class_id: 'qaBrClsBrezno', booking_date: DNES } }, jar.olga);
    ok('Olga: vstup z appky sa v Brezne odpočíta', o1.status === 200 && (bk('qaBrOlga000001', 'qaBrClsBrezno') || {}).access_method === 'single_entry' && rd('users.db').find(u => u._id === 'qaBrOlga000001').single_entries === 0, JSON.stringify(o1.d));

    console.log('\nKiosk:');
    const kc = await j('/api/admin/kiosk', {}, jar.admin);
    const st = ((kc.d && kc.d.studios) || []).find(x => /brezn/i.test(x.slug + ' ' + x.city));
    ok('kiosk Brezno existuje', !!st, JSON.stringify((kc.d && kc.d.studios || []).map(x => x.slug)));
    if (st) {
      await j('/api/admin/kiosk/' + st.slug, { method: 'PUT', body: { enabled: true } }, jar.admin);
      const kiosk = (cesta, body) => j('/api/kiosk/' + cesta, { method: 'POST', body: { studio: st.slug, k: st.token, ...body } });
      const zNora = await kiosk('day-classes', { qr_data: 'FA:qaBrNora000001' });
      const hNora = ((zNora.d && zNora.d.classes) || []).find(c => c.id === 'qaBrClsBrezno') || {};
      ok('zoznam pre Noru: Brezno len vstup, 10 € v hotovosti', hNora.len_vstup === true && hNora.cena_hotovost === 10, JSON.stringify(hNora));
      const zEva = await kiosk('day-classes', { qr_data: 'FA:qaBrEva0000001' });
      ok('zoznam pre Evu (dobieha): bez príznaku len vstup', (((zEva.d && zEva.d.classes) || []).find(c => c.id === 'qaBrClsBrezno') || {}).len_vstup === false);
      const sNora = await kiosk('signup', { qr_data: 'FA:qaBrNora000001', class_ids: ['qaBrClsBrezno'] });
      ok('zápis Nory: pýta 10 € v hotovosti a vysvetlí prečo', sNora.status === 402 && sNora.d.ask_cash === true && sNora.d.spolu === 10 && /len jednorazový vstup/.test(sNora.d.error), JSON.stringify(sNora.d));
      const sEva = await kiosk('signup', { qr_data: 'FA:qaBrEva0000001', class_ids: ['qaBrClsBrezno'] });
      ok('zápis Evy: prejde na členstvo', sEva.status === 200 && (bk('qaBrEva0000001', 'qaBrClsBrezno') || {}).access_method === 'membership', JSON.stringify(sEva.d));
      const cZora = await kiosk('checkin', { qr_data: 'FA:qaBrZora000001', class_id: 'qaBrClsBrezno' });
      ok('check-in Zory: 402 hotovosť 10 €, len vstup', cZora.status === 402 && cZora.d.ask_cash === true && cZora.d.price === 10 && cZora.d.len_vstup === true && /Brezne/.test(cZora.d.error), JSON.stringify(cZora.d));
    }

    console.log('\nTréner:');
    const csH = await j('/api/attendance/client-status?user_id=qaBrNora000001&class_id=qaBrClsBrezno', {}, jar.tina);
    ok('stav Nory pri hodine v Brezne: len vstup 10 €', csH.status === 200 && csH.d.len_vstup === true && csH.d.tech_price === 10 && csH.d.len_vstup_mesto === 'Brezno', JSON.stringify(csH.d));
    const csBez = await j('/api/attendance/client-status?user_id=qaBrNora000001', {}, jar.tina);
    ok('stav bez hodiny: bez príznaku (ako doteraz)', csBez.status === 200 && !csBez.d.len_vstup, JSON.stringify(csBez.d));
    const mbC = await j('/api/attendance/manual-booking', { method: 'POST', body: { user_id: 'qaBrNora000001', class_id: 'qaBrClsBrezno', booking_date: DNES, method: 'membership' } }, jar.tina);
    ok('manuálny zápis „členstvo" v Brezne odmietne s vysvetlením', mbC.status === 400 && mbC.d.code === 'mesto_len_vstup' && /len jednorazový vstup 10 €/.test(mbC.d.error), JSON.stringify(mbC.d));
    const mbH = await j('/api/attendance/manual-booking', { method: 'POST', body: { user_id: 'qaBrNora000001', class_id: 'qaBrClsBrezno', booking_date: DNES, method: 'pay_on_site', pay_amount: 10 } }, jar.tina);
    ok('manuálny zápis „na mieste" 10 € prejde', mbH.status === 200 && (bk('qaBrNora000001', 'qaBrClsBrezno') || {}).pay_amount === 10, JSON.stringify(mbH.d));
    const qr = await j('/api/attendance/qr-checkin', { method: 'POST', body: { qr_data: 'FA:qaBrZora000001', class_id: 'qaBrClsBrezno' } }, jar.tina);
    ok('QR check-in Zory u trénera: bez krytia s vysvetlením', qr.d && qr.d.ok === false && qr.d.error === 'membership_required' && /Brezne/.test(qr.d.note || ''), JSON.stringify(qr.d));
    const qrE = await j('/api/attendance/qr-checkin', { method: 'POST', body: { qr_data: 'FA:qaBrEva0000001', class_id: 'qaBrClsZvolen' } }, jar.tina);
    ok('QR check-in Evy vo Zvolene: členstvo kryje', qrE.d && qrE.d.ok === true && qrE.d.booking && qrE.d.booking.access_type === 'membership', JSON.stringify(qrE.d));

    console.log('\nProfil (prehliadač):');
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const [meno, hodnota] = jar.nina.cookie.split('=');
    await ctx.addCookies([{ name: meno, value: hodnota, domain: 'localhost', path: '/' }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('fa_welcome_seen', '1'); } catch (e) {} });
    const p = await ctx.newPage(); const chyby = []; p.on('pageerror', e => chyby.push(e.message));
    await p.goto(BASE + '/client-dashboard', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof showPayOnSiteChoice === 'function', null, { timeout: 20000 });
    await p.evaluate(() => showPayOnSiteChoice('qaBrClsBrezno', 'Zumba Brezno', 10, 0, false, { len_vstup: true, message: 'V Brezne je teraz jednorazový vstup 10 € na hodinu — členstvo tu dočasne neplatí. Zaplatíš na mieste alebo vstupom z appky.' }));
    await sleep(400);
    const okno = await p.evaluate(() => (document.getElementById('posCard') || {}).innerText || '');
    ok('okno: jednorazový vstup 10 €, vysvetlenie, zaplatiť na mieste', /Jednorazový vstup/.test(okno) && /10,00|10 €|10\s?€/.test(okno) && /V Brezne je teraz/.test(okno) && /Zaplatím na mieste/.test(okno), okno.slice(0, 200));
    ok('okno neponúka mesačné členstvo', !/Mesačné členstvo/.test(okno), okno);
    ok('profil bez chýb v JS', chyby.length === 0, chyby.join(' | '));
  } catch (e) { failed++; console.log('  ❌ výnimka B: ' + e.stack); }
  finally {
    if (browser) await browser.close().catch(() => {});
    if (srv) srv.kill(); await sleep(800);
    fs.rmSync(DB, { recursive: true, force: true });
    console.log('\nBREZNO LEN VSTUP: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
  }
})();
