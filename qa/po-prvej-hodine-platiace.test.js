/**
 * Maily „po prvej hodine" (trial_followup) len novým ženám (Marek 16. 9. 2026).
 *
 * V poradí čakali aj stálym klientkam (Janka R. 98 návštev, Glofox import) a ženám,
 * ktoré si už kúpili permanentku alebo členstvo. Test stráži:
 *   · jednorazové zrušenie po nasadení (migrácia) — stálej, s permanentkou, s kúpeným členstvom
 *   · nová žena, ktorá zaplatila len 10 € za vstup, maily dostáva ďalej
 *   · kontrolu pri odoslaní: kúpa vstupov alebo staré platby po zaradení mail zastavia
 *
 * Spustenie:  node qa/po-prvej-hodine-platiace.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4604;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-poprvej-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
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

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const dnes = new Date().toISOString().slice(0, 10);
  const pred = d => new Date(Date.now() - d * 864e5).toISOString();
  const U = (id, name, extra) => ({ _id: id, name, email: id.toLowerCase() + '@qa-biz.local', password: hash, user_type: 'client', active: true,
    created_at: pred(40), visit_count: 2, free_class_used: true, trial_followup_enrolled: true, trial_followup_at: pred(10), referral_code: 'QP' + id.slice(4, 8).toUpperCase() + id.slice(-1), ...extra });
  w('users.db', [
    { _id: 'qaPpAdmin000001', name: 'Admin QA', email: 'qa.pp.admin@qa-biz.local', password: hash, is_admin: true, user_type: 'admin', active: true, created_at: pred(400), referral_code: 'QPADM' },
    U('qaPpStala000001', 'Stála Klientka', { first_paid_at: pred(400), glofox_synced: true, visit_count: 98 }),
    U('qaPpPerm0000001', 'Permanentka Nová', { first_paid_at: pred(5), single_entries: 9 }),
    U('qaPpClen0000001', 'Kúpila Bronze', { first_paid_at: pred(20) }),
    U('qaPpNova0000001', 'Nová Vstup', { first_paid_at: pred(3) }),
    U('qaPpNova0000002', 'Nová Neskôr Kúpi', { first_paid_at: pred(3) }),
    U('qaPpNova0000003', 'Nová Ukáže Sa Stará', {}),
  ]);
  w('memberships.db', [
    { _id: 'qaPpMemClen0001', user_id: 'qaPpClen0000001', plan_id: 'bronze', plan_name: 'Bronze', status: 'expired', price: 49.9, expires_at: pred(2), created_at: pred(33) },
    { _id: 'qaPpMemNova0001', user_id: 'qaPpNova0000001', plan_id: 'vstup1', plan_name: 'Jednorazový vstup', status: 'bundle', price: 10, expires_at: pred(-20), created_at: pred(3) },
  ]);
  w('transactions.db', [
    { _id: 'qaPpTxNova00001', type: 'single_entry', user_id: 'qaPpNova0000001', amount: 10, date: pred(3).slice(0, 10), created_at: pred(3) },
  ]);
  w('email_steps.db', [
    { _id: 'qaPpKrok2000001', sequence: 'trial_followup', day: 2, label: 'Ako bolo', active: true, subject: '{meno}, aká bola tvoja prvá hodina?', body: '<p>Ahoj {meno}</p>', cta: 'Obchod', cta_url: BASE + '/obchod', created_at: pred(100) },
    { _id: 'qaPpKrok5000001', sequence: 'trial_followup', day: 25, label: 'Miesto ťa čaká', active: true, subject: '{meno}, miesto ťa čaká', body: '<p>Ahoj {meno}</p>', cta: 'Obchod', cta_url: BASE + '/obchod', created_at: pred(100) },
  ]);
  const Q = (id, uid, krok, kedy) => ({ _id: id, user_id: uid, sequence: 'trial_followup', step_id: krok, scheduled_for: kedy, status: 'pending', created_at: pred(10) });
  const buduci = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  w('email_queue.db', [
    Q('qaPpQStala00001', 'qaPpStala000001', 'qaPpKrok2000001', dnes), Q('qaPpQStala00002', 'qaPpStala000001', 'qaPpKrok5000001', buduci),
    Q('qaPpQPerm00001', 'qaPpPerm0000001', 'qaPpKrok2000001', dnes),
    Q('qaPpQClen00001', 'qaPpClen0000001', 'qaPpKrok2000001', dnes),
    Q('qaPpQNova00001', 'qaPpNova0000001', 'qaPpKrok2000001', dnes), Q('qaPpQNova00002', 'qaPpNova0000001', 'qaPpKrok5000001', buduci),
    Q('qaPpQNovb00001', 'qaPpNova0000002', 'qaPpKrok2000001', dnes),
    Q('qaPpQNovc00001', 'qaPpNova0000003', 'qaPpKrok2000001', dnes),
  ]);

  console.log('MAILY PO PRVEJ HODINE — LEN NOVÝM\n');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TZ: 'UTC', PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1', QA_HOOKS: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }
  await sleep(16000);

  try {
    console.log('1) Po nasadení sa zrušia maily tým, komu nepatria:');
    const cak = uid => rd('email_queue.db').filter(e => e.user_id === uid && e.status === 'pending').length;
    ok('stála klientka (platí rok) — zrušené oba', cak('qaPpStala000001') === 0, cak('qaPpStala000001') + '');
    ok('s permanentkou — zrušené', cak('qaPpPerm0000001') === 0);
    ok('kúpila Bronze (už vypršal) — zrušené', cak('qaPpClen0000001') === 0);
    ok('nová, zaplatila 10 € za vstup — ostávajú', cak('qaPpNova0000001') === 2, cak('qaPpNova0000001') + '');
    ok('ostatné nové — ostávajú', cak('qaPpNova0000002') === 1 && cak('qaPpNova0000003') === 1);
    const zaz = rd('settings.db').find(s => s.key === 'po_prvej_hodine_platiace_20260916');
    ok('zápis s menami', zaz && zaz.value.zrusene.length === 3 && zaz.value.zrusene.some(x => /Stála Klientka \(2\)/.test(x)), JSON.stringify(zaz && zaz.value));

    console.log('\n2) Kontrola pri odoslaní:');
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.pp.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    // po zaradení si jedna kúpi vstupy, pri druhej sa zistí, že platila už pred rokom (napr. doplnený Glofox)
    await j('/api/admin/qa/set-user', { method: 'POST', body: { user_id: 'qaPpNova0000002', set: { single_entries: 5 } } }, adm);
    await j('/api/admin/qa/set-user', { method: 'POST', body: { user_id: 'qaPpNova0000003', set: { first_paid_at: pred(300) } } }, adm);
    const tick = await j('/api/admin/qa/run-daily-tick?hour=9', { method: 'POST' }, adm);
    ok('denný beh prebehol', tick.status === 200 && tick.d.daily === true, JSON.stringify(tick.d));
    await sleep(2500);
    const logy = rd('mail_log.db');
    const komu = e => logy.filter(m => m.to === e && /prvá hodina/.test(m.subject)).length;
    ok('nová žena mail dostala', komu('qappnova0000001@qa-biz.local') === 1, JSON.stringify(logy.map(m => m.to + ' ' + m.subject)));
    ok('tá, čo si medzitým kúpila vstupy, nie', komu('qappnova0000002@qa-biz.local') === 0);
    ok('ani tá, čo platila už pred rokom', komu('qappnova0000003@qa-biz.local') === 0);
    const q2 = rd('email_queue.db').find(e => e._id === 'qaPpQNovb00001');
    ok('jej čakajúci mail je z fronty preč', !q2 || q2.status !== 'pending', JSON.stringify(q2));
    ok('budúci mail novej ženy čaká ďalej', rd('email_queue.db').find(e => e._id === 'qaPpQNova00002').status === 'pending');
    ok('stálym klientkam neodišlo nič', !logy.some(m => /qappstala|qappperm|qappclen/.test(m.to)), JSON.stringify(logy.map(m => m.to)));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.stack);
  } finally {
    srv.kill();
    await sleep(600);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nPO PRVEJ HODINE: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-1200));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
