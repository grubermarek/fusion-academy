/**
 * Presun súkromnej hodiny a staré rezervácie na nástenke (Marek 5. 10. 2026).
 *  · /api/service/private-move anuluje pôvodný termín bez poplatku a rezervuje nový,
 *    cenu prepočíta podľa zľavy z členstva, obom pošle oznam a zapíše audit,
 *  · „Moje aktívne rezervácie" na nástenke ukazujú len dnešok a budúcnosť — hodina,
 *    ktorú tréner neoznačil, tam predtým visela navždy.
 *
 * Spustenie:  node qa/sukromka-presun.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
process.env.NODE_PATH = [process.env.NODE_PATH, 'C:/Fusion Academy/automatizacie/node_modules'].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const PORT = 4627, BASE = 'http://localhost:' + PORT;
const KOREN = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-privmove-'));
const TOKEN = 'qa-servis-' + Date.now();
let ok = 0, zle = 0;
const t = (n, c, d) => { if (c) { ok++; console.log('  ✅ ' + n); } else { zle++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const sk = ms => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date(ms));
const DNES = sk(Date.now()), VCERA = sk(Date.now() - 864e5), O20DNI = sk(Date.now() + 20 * 864e5);
const citaj = s => fs.readFileSync(path.join(DATA, s), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaPmTrener00001', name: 'Nela Trénerka', email: 'qa.pm.trener@qa-biz.local', password: hash, user_type: 'trainer', active: true, created_at: '2026-01-01', referral_code: 'QAPM01', private_rate: 25, private_split: 80, private_enabled: true },
    { _id: 'qaPmKlient00001', name: 'Alica Klientka', email: 'qa.pm.klient@qa-biz.local', password: hash, user_type: 'client', active: true, created_at: '2026-01-01', referral_code: 'QAPM02' },
  ]));
  fs.writeFileSync(path.join(DATA, 'memberships.db'), riadky([
    { _id: 'qaPmMem00000001', user_id: 'qaPmKlient00001', plan_id: 'silver', plan_name: 'Silver', price: 74.9, status: 'active', started_at: VCERA + 'T10:00:00.000Z', expires_at: O20DNI + 'T10:00:00.000Z', created_at: VCERA },
  ]));
  fs.writeFileSync(path.join(DATA, 'private_slots.db'), riadky([
    { _id: 'qaPmSlotStary01', trainer_id: 'qaPmTrener00001', trainer_name: 'Nela Trénerka', date: VCERA, time_start: '17:00', duration_min: 60, city: 'Detva', location: '', price: 25, status: 'booked', created_at: '2026-09-01' },
    { _id: 'qaPmSlotNovy001', trainer_id: 'qaPmTrener00001', trainer_name: 'Nela Trénerka', date: O20DNI, time_start: '17:00', duration_min: 60, city: 'Detva', location: '', price: 25, status: 'open', created_at: '2026-09-28' },
  ]));
  fs.writeFileSync(path.join(DATA, 'private_bookings.db'), riadky([
    { _id: 'qaPmRezerv00001', slot_id: 'qaPmSlotStary01', trainer_id: 'qaPmTrener00001', trainer_name: 'Nela Trénerka', client_id: 'qaPmKlient00001', client_name: 'Alica Klientka',
      client_email: 'qa.pm.klient@qa-biz.local', date: VCERA, time_start: '17:00', duration_min: 60, city: 'Detva', price: 20, base_price: 25, discount_pct: 20, discount_plan: 'Silver',
      split: 80, pay_method: 'onsite', paid: false, status: 'booked', created_at: '2026-09-14' },
  ]));
  // stará skupinová rezervácia, ktorú tréner neoznačil → nesmie visieť medzi aktívnymi
  fs.writeFileSync(path.join(DATA, 'classes.db'), riadky([
    { _id: 'qaPmHodina00001', name: 'Technický tréning', category: 'Technika', location: 'Detva', day_of_week: new Date(DNES + 'T12:00:00Z').getUTCDay(), time_start: '18:00', time_end: '19:00',
      capacity: 20, price: 10, emoji: '🎯', active: true, created_at: '2026-01-01' },
  ]));
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky([
    { _id: 'qaPmBkStara0001', user_id: 'qaPmKlient00001', user_name: 'Alica Klientka', class_id: 'qaPmHodina00001', class_name: 'Technický tréning', class_time_start: '18:00',
      booking_date: sk(Date.now() - 8 * 864e5), status: 'confirmed', attendance_status: 'no_show', pay_on_site: true, pay_amount: 6, created_at: '2026-09-20T10:00:00.000Z' },
    { _id: 'qaPmBkBuduca001', user_id: 'qaPmKlient00001', user_name: 'Alica Klientka', class_id: 'qaPmHodina00001', class_name: 'Technický tréning', class_time_start: '18:00',
      booking_date: sk(Date.now() + 6 * 864e5), status: 'confirmed', attendance_status: 'pending', created_at: '2026-10-01T10:00:00.000Z' },
  ]));
  fs.writeFileSync(path.join(DATA, 'settings.db'), riadky(['brezno_extend_20260820', 'online_brezno_20260813', 'brezno_predlzenie_0926', 'retro_confirm_v1', 'noshow_revert_v1', 'classes_default_marek_v1']
    .map((x, i) => ({ _id: 'qaPmSet' + i, key: x, value: true, at: '2026-01-01T00:00:00.000Z' }))));

  console.log('PRESUN SÚKROMKY — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: KOREN,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1', IMPORT_TOKEN: TOKEN }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; srv.stderr.on('data', d => { err += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol\n' + err.slice(-600)); process.exit(1); }
  await sleep(3000);

  const vol = async (telo, token = TOKEN) => {
    const r = await fetch(BASE + '/api/service/private-move', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-import-token': token } : {}) }, body: JSON.stringify(telo) });
    let d = null; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };
  let b = null;
  try {
    t('bez tokenu nástroj neexistuje', (await vol({ booking_id: 'qaPmRezerv00001', slot_id: 'qaPmSlotNovy001' }, '')).status === 404);
    const obsadeny = await vol({ booking_id: 'qaPmRezerv00001', slot_id: 'qaPmSlotStary01' });
    t('obsadený termín sa neponúkne', obsadeny.status === 400 && /nie je voľný/.test(obsadeny.d?.error || ''), JSON.stringify(obsadeny));

    const r = await vol({ booking_id: 'qaPmRezerv00001', slot_id: 'qaPmSlotNovy001', reason: 'QA presun' });
    t('presun prejde', r.status === 200 && r.d.ok, JSON.stringify(r.d).slice(0, 180));
    t('nová hodina má dátum nového termínu a cenu so zľavou 20 %', r.d?.nova?.datum === O20DNI && r.d?.nova?.cena === 20, JSON.stringify(r.d?.nova));

    const pb = citaj('private_bookings.db');
    const stara = pb.filter(x => x._id === 'qaPmRezerv00001').pop();
    const nova = pb.filter(x => x._id === r.d.nova.id).pop();
    t('pôvodná je anulovaná a vie, kam sa presunula', stara.status === 'moved' && stara.moved_to_slot === 'qaPmSlotNovy001', JSON.stringify({ s: stara.status, k: stara.moved_to_slot }));
    t('nová je rezervovaná u toho istého trénera', nova.status === 'booked' && nova.trainer_id === 'qaPmTrener00001' && nova.moved_from === 'qaPmRezerv00001', JSON.stringify({ s: nova.status, t: nova.trainer_name }));
    const sl = citaj('private_slots.db');
    t('starý termín je zavretý, nový obsadený', sl.filter(s => s._id === 'qaPmSlotStary01').pop().status === 'cancelled' && sl.filter(s => s._id === 'qaPmSlotNovy001').pop().status === 'booked',
      JSON.stringify(sl.map(s => s._id + ':' + s.status)));
    const notif = citaj('notifications.db').filter(n => /presunut/i.test(n.title || ''));
    t('oznam dostala klientka aj trénerka', notif.some(n => n.user_id === 'qaPmKlient00001') && notif.some(n => n.user_id === 'qaPmTrener00001'), JSON.stringify(notif.map(n => n.user_id)));
    const audit = citaj('audit.db').filter(a => a.action === 'private_move');
    t('audit zapísal starý aj nový termín', audit.length === 1 && audit[0].before.datum === VCERA && audit[0].after.datum === O20DNI, JSON.stringify(audit[0] || {}).slice(0, 200));
    const druhy = await vol({ booking_id: 'qaPmRezerv00001', slot_id: 'qaPmSlotNovy001' });
    t('presunutá hodina sa nedá presunúť druhýkrát', druhy.status === 400, JSON.stringify(druhy));

    // ── nástenka: staré rezervácie preč
    const { chromium } = require('playwright');
    b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'sk-SK', serviceWorkers: 'block' });
    await ctx.addInitScript(() => { try { localStorage.setItem('fa_welcome_seen', '1'); } catch (e) {} });
    await ctx.request.post(BASE + '/api/login', { data: { email: 'qa.pm.klient@qa-biz.local', password: 'Heslo123!' } });
    const p = await ctx.newPage(); const js = []; p.on('pageerror', e => js.push(e.message));
    await p.goto(BASE + '/client-dashboard', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelector('#bookingsList'), null, { timeout: 25000 }).catch(() => {});
    await p.waitForTimeout(2500);
    const zoznam = await p.evaluate(() => ({ text: (document.getElementById('bookingsList') || {}).innerText || '', poloziek: document.querySelectorAll('#bookingsList .booking-item').length }));
    t('stará neoznačená hodina už medzi aktívnymi nie je', !zoznam.text.includes(new Intl.DateTimeFormat('sk-SK').format(new Date(Date.now() - 8 * 864e5))), zoznam.text.slice(0, 160));
    t('budúca rezervácia tam ostáva', /Technický tréning/.test(zoznam.text), zoznam.text.slice(0, 160));
    t('nástenka bez chýb v JS', js.length === 0, js.join(' | '));
  } catch (e) {
    zle++; console.log('  ❌ výnimka: ' + (e.stack || e.message));
  } finally {
    if (b) await b.close().catch(() => {});
    srv.kill();
    await sleep(500);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    console.log('\nPRESUN SÚKROMKY: ' + ok + ' OK / ' + zle + ' chýb');
    process.exit(zle ? 1 : 0);
  }
})();
