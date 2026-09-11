/**
 * Venčekári nedostávajú predajné maily (11. 9. 2026).
 *
 * Marek: „nemusia dostávať ani predajné maily." Na produkcii dostalo 22
 * venčekárov (žiaci, rodičia, učitelia) 83 predajných mailov — uvítaciu sériu
 * s „prvá hodina je ZADARMO", „Ešte ti chýba jeden krok 💃", „Beátka schudla
 * 17 kg" aj „…, tvoja prvá hodina je zadarmo 💃" deviatakom — a ďalších 106
 * čakalo vo fronte.
 *
 * Stráži, že venčekár (kým nie je klientom):
 *   · pri registrácii nedostane do fronty uvítaciu ani leadovú sériu
 *   · predajné maily, čo už čakajú, sa zrušia (migrácia)
 *   · a tie, čo by sa do fronty dostali inak, sa pri odoslaní preskočia
 *   · nedostane pripomienku „vyber si prvú hodinu"
 *   · nedostane výzvy „prvá hodina je zadarmo" ani zľavové ponuky
 *   · nie je v eventových vlnách
 * A že sa nevyraďuje priveľa:
 *   · servisné maily mu chodia ďalej
 *   · bežný lead dostáva všetko ako doteraz
 *   · venčekový rodič, ktorý sa stal klientom, je normálna klientka
 *
 * Spustenie:  node qa/vencek-bez-predajnych-mailov.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4594;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-venmail-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const spi = ms => new Promise(r => setTimeout(r, ms));

async function j(url, opts, jar) {
  opts = opts || {};
  const headers = { 'Content-Type': 'application/json' };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const pridaj = (f, rows) => fs.appendFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

let srv = null, chyba = '';
async function start() {
  srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE,
      RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    try { await fetch(BASE + '/'); await spi(15000); return true; }   // migrácie bežia 10–11 s po štarte
    catch (e) { await spi(1000); }
  }
  return false;
}
async function stop() {
  if (!srv || srv.exitCode !== null) return;
  await spi(1200);                                   // nech NeDB dopíše
  await new Promise(r => { srv.once('exit', r); srv.kill(); });
  await spi(800);
}

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const dnes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const denPred = n => { const d = new Date(dnes + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const pred4h = new Date(Date.now() - 4 * 3600e3).toISOString();
  const V = { venceky_class_id: 'qaVmTrieda00001', venceky_school_id: 'qaVmSkola000001', lead_source: 'vencek' };
  // zaregistrovaní pred 2 dňami, bez rezervácie — presne tí, čo dostávali „prvá hodina zadarmo"
  const L = (_id, name, email, extra) => ({ _id, name, email, password: hash, user_type: 'lead', active: true,
    city: 'Detva', visit_count: 0, created_at: denPred(2), registration_at: pred4h,
    account_creation_type: 'self_registration', ...extra });

  w('users.db', [
    { _id: 'qaVmAdmin000001', name: 'Marek Gruber', email: 'qa.vm.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },
    L('qaVmZiak0000001', 'Deviatak Venčekový', 'qa.vm.ziak@qa-biz.local', { venceky_role: 'student', ...V }),
    L('qaVmUcitel00001', 'Učiteľka Triedna', 'qa.vm.ucitel@qa-biz.local', { venceky_role: 'teacher', ...V }),
    L('qaVmLead0000001', 'Bežná Leadka', 'qa.vm.lead@qa-biz.local', {}),
    L('qaVmKlient00001', 'Rodič Klientka', 'qa.vm.klient@qa-biz.local', { user_type: 'client', venceky_role: 'parent', ...V }),
  ]);
  w('venceky_schools.db', [{ _id: 'qaVmSkola000001', name: 'ZŠ QA', city: 'Halíč', year: '2026/27', created_at: '2026-09-01' }]);
  w('venceky_classes.db', [{ _id: 'qaVmTrieda00001', school_id: 'qaVmSkola000001', name: 'Venčeková skupina',
    year: '2026/27', code: 'VEN-QAMAIL', price: 49.9, lessons_total: 13, lessons_before: 10, lessons_done: 0,
    roles: ['student', 'parent', 'teacher'], dances: [{ name: 'Waltz', level: 0 }], created_at: '2026-09-01' }]);
  w('classes.db', [{ _id: 'qaVmHodina00001', name: 'Zumba', category: 'Zumba', location: 'Detva',
    day_of_week: 1, time_start: '18:00', time_end: '19:00', capacity: 30, active: true }]);
  const S = (_id, sequence, day, subject) => ({ _id, sequence, day, label: subject, active: true, subject, body: '<p>QA</p>' });
  w('email_steps.db', [
    S('qaVmStepWel0', 'welcome', 0, 'Vitaj QA'),
    S('qaVmStepNur3', 'lead_nurture', 3, 'Ešte si neprišla QA'),
    S('qaVmStepSrv0', 'servis_qa', 0, 'Servis QA'),
  ]);
  const Q = (_id, user_id, sequence, step_id) => ({ _id, user_id, sequence, step_id,
    scheduled_for: denPred(1), status: 'pending', created_at: denPred(2) + 'T10:00:00.000Z' });
  w('email_queue.db', [
    Q('qaVmQ000000001', 'qaVmZiak0000001', 'welcome', 'qaVmStepWel0'),
    Q('qaVmQ000000002', 'qaVmZiak0000001', 'lead_nurture', 'qaVmStepNur3'),
    Q('qaVmQ000000003', 'qaVmUcitel00001', 'lead_nurture', 'qaVmStepNur3'),
    Q('qaVmQ000000004', 'qaVmZiak0000001', 'servis_qa', 'qaVmStepSrv0'),
    Q('qaVmQ000000005', 'qaVmLead0000001', 'welcome', 'qaVmStepWel0'),
    Q('qaVmQ000000006', 'qaVmKlient00001', 'welcome', 'qaVmStepWel0'),
  ]);

  console.log('VENČEKÁRI BEZ PREDAJNÝCH MAILOV\n');
  const fr = id => rd('email_queue.db').find(x => x._id === id) || {};
  const us = id => rd('users.db').find(u => u._id === id) || {};
  const txt = x => JSON.stringify({ s: x.status, r: x.reason });

  try {
    if (!(await start())) { failed++; console.log('  ❌ server nenabehol'); return; }
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.vm.admin@qa-biz.local', password: 'Heslo123!' } }, adm);

    console.log('1) Čakajúce predajné maily venčekárov sa zrušili:');
    ok('uvítací mail žiakovi', fr('qaVmQ000000001').status === 'skipped' && fr('qaVmQ000000001').reason === 'vencek', txt(fr('qaVmQ000000001')));
    ok('leadový mail žiakovi', fr('qaVmQ000000002').status === 'skipped' && fr('qaVmQ000000002').reason === 'vencek', txt(fr('qaVmQ000000002')));
    ok('leadový mail učiteľke', fr('qaVmQ000000003').status === 'skipped' && fr('qaVmQ000000003').reason === 'vencek', txt(fr('qaVmQ000000003')));
    ok('bežnej leadke sa nezrušil', fr('qaVmQ000000005').reason !== 'vencek', txt(fr('qaVmQ000000005')));

    console.log('\n2) Ostatné maily fronta posiela ďalej:');
    const run = await j('/api/admin/email-queue/run', { method: 'POST' }, adm);
    ok('fronta zbehne', run.status === 200, 'HTTP ' + run.status);
    await spi(800);
    ok('servisný mail venčekárovi odišiel', fr('qaVmQ000000004').status === 'sent', txt(fr('qaVmQ000000004')));
    ok('bežnej leadke uvítací mail odišiel', fr('qaVmQ000000005').status === 'sent', txt(fr('qaVmQ000000005')));
    ok('venčekový rodič, čo je klientka, ho dostal tiež', fr('qaVmQ000000006').status === 'sent', txt(fr('qaVmQ000000006')));

    console.log('\n3) Pripomienka „vyber si prvú hodinu":');
    const fb = await j('/api/admin/qa/run-first-booking-nudge', { method: 'POST' }, adm);
    const sel = (fb.d && fb.d.selected) || [];
    ok('bežná leadka ju dostala', sel.includes('qa.vm.lead@qa-biz.local'), JSON.stringify(fb.d));
    ok('venčekový žiak nie', !sel.includes('qa.vm.ziak@qa-biz.local'));
    ok('učiteľka nie', !sel.includes('qa.vm.ucitel@qa-biz.local'));
    ok('rodič-klientka áno', sel.includes('qa.vm.klient@qa-biz.local'), JSON.stringify(sel));

    console.log('\n4) Výzvy „prvá hodina je zadarmo" a zľavy (denné joby):');
    const dt = await j('/api/admin/qa/run-daily-tick?hour=9', { method: 'POST' }, adm);
    ok('denné joby zbehnú', dt.status === 200, 'HTTP ' + dt.status + ' ' + JSON.stringify(dt.d).slice(0, 120));
    await spi(1500);
    ok('bežná leadka výzvu dostala', us('qaVmLead0000001').lead_fc_stage === 1, 'stage=' + us('qaVmLead0000001').lead_fc_stage);
    ok('venčekový žiak nie', !us('qaVmZiak0000001').lead_fc_stage, 'stage=' + us('qaVmZiak0000001').lead_fc_stage);
    ok('učiteľka nie', !us('qaVmUcitel00001').lead_fc_stage, 'stage=' + us('qaVmUcitel00001').lead_fc_stage);

    console.log('\n5) Registrácia:');
    const reg = await j('/api/register', { method: 'POST', body: { name: 'Nový Deviatak', email: 'qa.vm.novy@qa-biz.local',
      phone: '0900333444', password: 'Heslo123!', consent: true, user_type: 'client', lead_source: 'vencek',
      vencek_code: 'VEN-QAMAIL', vencek_role: 'student' } }, {});
    ok('venčeková registrácia prejde', reg.status === 200 && reg.d && reg.d.ok, JSON.stringify(reg.d).slice(0, 120));
    await new Promise(r => setTimeout(r, 1500));
    const novy = rd('users.db').find(u => u.email === 'qa.vm.novy@qa-biz.local');
    const jeho = novy ? rd('email_queue.db').filter(m => m.user_id === novy._id).map(m => m.sequence) : ['?'];
    ok('venčekár nemá vo fronte nič', jeho.length === 0, JSON.stringify(jeho));
    await j('/api/register', { method: 'POST', body: { name: 'Bežná Nováčka', email: 'qa.vm.bezna@qa-biz.local',
      phone: '0900333555', password: 'Heslo123!', consent: true, user_type: 'client' } }, {});
    await new Promise(r => setTimeout(r, 1500));
    const bezna = rd('users.db').find(u => u.email === 'qa.vm.bezna@qa-biz.local');
    const jej = bezna ? rd('email_queue.db').filter(m => m.user_id === bezna._id).map(m => m.sequence) : [];
    ok('bežná registrácia má uvítaciu aj leadovú sériu', jej.includes('welcome') && jej.includes('lead_nurture'), JSON.stringify(jej));

    console.log('\n6) Eventové vlny a pripomienky:');
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const filtre = src.split('\n').filter(l => l.includes('!u.offers_optout && !isTestU(u)'));
    ok('všetkých ' + filtre.length + ' filtrov vyraďuje venčekárov',
      filtre.length >= 10 && filtre.every(l => l.includes('vencekMimoKonverzie')),
      filtre.filter(l => !l.includes('vencekMimoKonverzie')).map(l => l.trim().slice(0, 80)).join(' | '));

    // Druhý štart: predajný mail, ktorý sa do fronty dostane inak (migrácia už
    // zbehla), sa musí preskočiť až pri odoslaní.
    console.log('\n7) Kontrola pri odoslaní:');
    await stop();
    pridaj('email_queue.db', [
      Q('qaVmQ000000007', 'qaVmZiak0000001', 'welcome', 'qaVmStepWel0'),
      Q('qaVmQ000000008', 'qaVmUcitel00001', 'lead_nurture', 'qaVmStepNur3'),
    ]);
    if (!(await start())) { failed++; console.log('  ❌ server druhýkrát nenabehol'); return; }
    const adm2 = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.vm.admin@qa-biz.local', password: 'Heslo123!' } }, adm2);
    await j('/api/admin/email-queue/run', { method: 'POST' }, adm2);
    await spi(800);
    ok('uvítací mail žiakovi sa preskočil', fr('qaVmQ000000007').status === 'skipped' && fr('qaVmQ000000007').reason === 'vencek', txt(fr('qaVmQ000000007')));
    ok('leadový mail učiteľke tiež', fr('qaVmQ000000008').status === 'skipped' && fr('qaVmQ000000008').reason === 'vencek', txt(fr('qaVmQ000000008')));

    console.log('\n8) Čo reálne odišlo:');
    const venc = new Set(['qa.vm.ziak@qa-biz.local', 'qa.vm.ucitel@qa-biz.local', 'qa.vm.novy@qa-biz.local']);
    const logy = rd('mail_log.db').filter(m => venc.has(String(m.to || '').toLowerCase()));
    const predajne = logy.filter(m => /^(welcome|lead_nurture|first_booking_nudge)/.test(m.template || '')
      || /zadarmo|zdarma|zľav/i.test(String(m.subject || '')));
    ok('venčekári nedostali ani jeden predajný mail', predajne.length === 0,
      JSON.stringify(predajne.map(m => (m.template || '?') + ' · ' + m.subject)));
    ok('servisný mail venčekárovi áno', logy.some(m => /^servis_qa/.test(m.template || '')),
      JSON.stringify(logy.map(m => m.template || m.subject)));
    const lead = rd('mail_log.db').filter(m => String(m.to || '').toLowerCase() === 'qa.vm.lead@qa-biz.local');
    ok('bežná leadka dostala uvítací mail, pripomienku aj výzvu',
      lead.some(m => /^welcome/.test(m.template || '')) && lead.some(m => m.template === 'first_booking_nudge')
        && lead.some(m => /prvá hodina je zadarmo/i.test(String(m.subject || ''))),
      JSON.stringify(lead.map(m => m.template || m.subject)));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    await stop().catch(() => {});
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nVENČEKÁRI BEZ PREDAJNÝCH MAILOV: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-900));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
