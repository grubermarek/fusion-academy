/**
 * Kiosk check-in bez krytia → otázka na hotovosť (Marek 13. 9. 2026):
 * „Na techniku Stanku nechce pustiť, že nemá členstvo — daj tam otázku, či chce platiť
 * v hotovosti, ukáž sumu podľa členstva a po potvrdení ju bookni."
 *
 *  - bez členstva/vstupu: 402 + ask_cash so sumou (technika 10 € / vstup 10 €)
 *  - s Bronze na technike: 402 + ask_cash 8 € (členstvo techniku nekryje — predtým sa zapísala ako krytá)
 *  - s Bronze na Zumbe: rovno zapísaná (kryté)
 *  - pay_on_site:true → účasť zapísaná ako „platí na mieste" so sumou, návšteva +1, tréner dostane oznam
 *  - opakovaný sken nezdvojí
 * Spustenie:  node qa/kiosk-cash.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');
const PORT = 4537, BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-kc-'));
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const p = path.join(DATA, f); if (!fs.existsSync(p)) return []; const m = new Map();
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l.trim()) continue; let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o.$$indexCreated) continue; if (o.$$deleted) { m.delete(o._id); continue; } m.set(o._id, o); } return [...m.values()]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const DOW = new Date().getDay();
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = (id, meno, kod, extra = {}) => JSON.stringify({ _id: id, name: meno, email: id.toLowerCase() + '@qa-biz.local', password: hash, referral_code: kod,
    user_type: 'client', active: true, is_admin: false, visit_count: 3, created_at: '2026-07-01', city: 'Detva', free_class_used: true, free_credits: 0, single_entries: 0, ...extra });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaKcAdmin0000001', name: 'Adam Kioskovy', email: 'qa.kc.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-06-01' }),
    JSON.stringify({ _id: 'qaKcTrener000001', name: 'Tina Trenerka', email: 'qa.kc.trener@qa-biz.local', password: hash, user_type: 'trainer', active: true, created_at: '2026-06-01' }),
    U('qaKcStanka000001', 'Stanka Bezclenstva', 'QAKC01'),
    U('qaKcBea000000001', 'Bea Bronzova', 'QAKC02', { membership_plan: 'bronze', membership_expires: '2026-12-31T23:59:59.000Z' }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(DATA, 'memberships.db'), JSON.stringify({ _id: 'qaKcMem000000001', user_id: 'qaKcBea000000001', plan_id: 'bronze', plan_name: 'Bronze', status: 'active', started_at: '2026-09-01', expires_at: '2026-12-31T23:59:59.000Z', price: 50 }) + '\n');
  const teraz = new Date(); const nowMin = teraz.getHours() * 60 + teraz.getMinutes();
  const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const t1 = Math.max(0, nowMin - 10);
  const C = (id, meno, extra = {}) => JSON.stringify({ _id: id, name: meno, emoji: '🎵', category: 'Zumba', instructor: 'Tina Trenerka', instructor_id: 'qaKcTrener000001',
    location: 'Detva', day_of_week: DOW, time_start: hhmm(t1), time_end: hhmm(t1 + 55), capacity: 30, price: 10, active: true, ...extra });
  fs.writeFileSync(path.join(DATA, 'classes.db'), [
    C('qaKcTech00000001', 'Technický tréning', { category: 'Technika' }),
    C('qaKcZumba0000001', 'Zumba'),
    C('qaKcZrusena00001', 'Zumba zrušená'),
    C('qaKcKids00000001', 'Zumba Kids', { category: 'Deti', price: 9 }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(DATA, 'class_cancellations.db'), JSON.stringify({ _id: 'qaKcZrus01', class_id: 'qaKcZrusena00001', class_name: 'Zumba zrušená', date: DNES, location: 'Detva', created_at: DNES + 'T06:00:00.000Z' }) + '\n');
  fs.appendFileSync(path.join(DATA, 'users.db'), U('qaKcNova0000001', 'Nina Nova', 'QAKC03') + '\n');
  const pm = new Date(+DNES.slice(0, 4), +DNES.slice(5, 7) - 2, 1);
  fs.writeFileSync(path.join(DATA, 'monthly_winners.db'), JSON.stringify({ _id: 'qaKcMW01', month: pm.getFullYear() + '-' + String(pm.getMonth() + 1).padStart(2, '0'), user_id: 'x', created_at: '2026-01-01' }) + '\n');
  fs.writeFileSync(path.join(DATA, 'settings.db'), JSON.stringify({ _id: 'qaKcSet1', key: 'retro_confirm_v1', value: true, at: '2026-01-01T00:00:00.000Z' }) + '\n');
  console.log('KIOSK HOTOVOSŤ QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' }, stdio: 'ignore' });
  const t0 = Date.now(); while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await sleep(1000); } }
  await sleep(4000);
  try {
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.kc.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    const kcfg = await j('/api/admin/kiosk', {}, adm);
    const detva = ((kcfg.d && kcfg.d.studios) || []).find(x => /detva/i.test(x.slug + ' ' + x.city));
    ok('kiosk Detva existuje', !!detva);
    await j('/api/admin/kiosk/' + detva.slug, { method: 'PUT', body: { enabled: true } }, adm);
    const K = detva.token, ST = detva.slug;
    const checkin = (qr, extra = {}) => j('/api/kiosk/checkin', { method: 'POST', body: { studio: ST, k: K, qr_data: qr, ...extra } });

    // Stanka bez krytia → technika: otázka 10 €
    const s1 = await checkin('FA:qaKcStanka000001', { class_id: 'qaKcTech00000001' });
    ok('bez členstva na technike: 402 + otázka na hotovosť 10 €', s1.status === 402 && s1.d.ask_cash === true && s1.d.price === 10 && s1.d.tech === true && s1.d.class_id === 'qaKcTech00000001', JSON.stringify(s1.d));
    ok('text otázky hovorí sumu a hotovosť', /10 € v hotovosti/.test(s1.d.error || ''), s1.d.error);
    ok('nič sa nezapísalo bez potvrdenia', !rd('bookings.db').some(b => b.user_id === 'qaKcStanka000001'));
    const s2 = await checkin('FA:qaKcStanka000001', { class_id: 'qaKcTech00000001', pay_on_site: true });
    await sleep(300);
    const bk = rd('bookings.db').find(b => b.user_id === 'qaKcStanka000001' && b.class_id === 'qaKcTech00000001');
    ok('po potvrdení zapísaná účasť „platí na mieste" 10 €', s2.status === 200 && s2.d.ok && bk && bk.status === 'attended' && bk.pay_on_site === true && +bk.pay_amount === 10 && bk.access_method === 'pay_on_site' && bk.attendance_source === 'qr', JSON.stringify(bk && { s: bk.status, pos: bk.pay_on_site, a: bk.pay_amount, am: bk.access_method }));
    ok('návšteva pribudla (3 → 4)', s2.d.user && s2.d.user.visit_count === 4, JSON.stringify(s2.d.user && s2.d.user.visit_count));
    // inštruktora hodiny môže migrácia pri štarte prepísať — oznam musí ísť tomu, kto je na hodine zapísaný teraz
    const instr = (rd('classes.db').find(c => c._id === 'qaKcTech00000001') || {}).instructor_id;
    ok('inštruktor hodiny dostal oznam, že má vybrať 10 €', !!instr && rd('notifications.db').some(n => n.user_id === instr && /vybrať 10 €/.test(n.title || '') && /Stanka/.test(n.title || '') && n.type === 'pay_on_site'), JSON.stringify({ instr, n: rd('notifications.db').map(n => n.user_id + ':' + n.title) }));
    const s3 = await checkin('FA:qaKcStanka000001', { class_id: 'qaKcTech00000001' });
    ok('opakovaný sken nezdvojí (already)', s3.status === 200 && s3.d.already === true && rd('bookings.db').filter(b => b.user_id === 'qaKcStanka000001').length === 1);
    // Stanka na Zumbe: vstup 10 €
    const s4 = await checkin('FA:qaKcStanka000001', { class_id: 'qaKcZumba0000001' });
    ok('bez členstva na Zumbe: otázka na vstup 10 €', s4.status === 402 && s4.d.ask_cash === true && s4.d.price === 10 && s4.d.tech === false, JSON.stringify(s4.d));
    // Bea s Bronze: technika podľa členstva 8 €, Zumba krytá
    const b1 = await checkin('FA:qaKcBea000000001', { class_id: 'qaKcTech00000001' });
    ok('Bronze na technike: členstvo nekryje → otázka 8 €', b1.status === 402 && b1.d.ask_cash === true && b1.d.price === 8 && b1.d.has_membership === true, JSON.stringify(b1.d));
    const b2 = await checkin('FA:qaKcBea000000001', { class_id: 'qaKcTech00000001', pay_on_site: true });
    await sleep(300);
    const bkB = rd('bookings.db').find(b => b.user_id === 'qaKcBea000000001' && b.class_id === 'qaKcTech00000001');
    ok('Bronze po potvrdení: účasť „platí na mieste" 8 €', b2.status === 200 && bkB && bkB.pay_on_site === true && +bkB.pay_amount === 8, JSON.stringify(bkB && { pos: bkB.pay_on_site, a: bkB.pay_amount }));
    const b3 = await checkin('FA:qaKcBea000000001', { class_id: 'qaKcZumba0000001' });
    await sleep(300);
    const bkZ = rd('bookings.db').find(b => b.user_id === 'qaKcBea000000001' && b.class_id === 'qaKcZumba0000001');
    ok('Bronze na Zumbe: rovno zapísaná, krytá členstvom', b3.status === 200 && b3.d.ok && bkZ && bkZ.access_method === 'membership' && !bkZ.pay_on_site, JSON.stringify(bkZ && { am: bkZ.access_method, pos: bkZ.pay_on_site }));
    // stránka kiosku
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'kiosk.html'), 'utf8');
    ok('kiosk má otázku na hotovosť vo výbere hodín', html.includes('pay_on_site:true') && html.includes('Áno, zaplatím') && html.includes('d.ask_cash'));
    // check-in (API) neponúka zrušenú hodinu ani detskú hodinu dospelej (audit 14. 9.)
    const nova = await checkin('FA:qaKcNova0000001');
    const volby = (nova.d && nova.d.options || []).map(o => o.name).sort();
    ok('check-in: bez zrušenej a detskej hodiny', nova.status === 200 && nova.d.choose === true && JSON.stringify(volby) === JSON.stringify(['Technický tréning', 'Zumba']), JSON.stringify(nova.d).slice(0, 200));
  } catch (e) { failed++; console.log('  ❌ výnimka: ' + e.stack); }
  finally { srv.kill(); console.log('\nKIOSK HOTOVOSŤ: ' + passed + ' OK / ' + failed + ' chýb'); setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 500); }
})();
