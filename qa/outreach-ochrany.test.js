/**
 * Hromadné správy — koho tam nesmie pustiť (audit 25. 10. 2026)
 *
 * Nástroj admin → Hromadné správy je jediné miesto, ktoré osloví veľa ľudí naraz,
 * a práve jemu chýbali tri ochrany, ktoré zvyšok appky drží dôsledne:
 * venčekárov (nie sú cieľ predaja, kým nie sú klienti) a odhlásených cez
 * /unsubscribe (offers_optout / do_not_contact). Segment „Majú permanentkové
 * vstupy" je len (single_entries>0), takže venčekár s permanentkou tam spadol.
 *
 * Stráži, že:
 *   · venčekár sa do publika nedostane ani cez segment s permanentkou
 *   · odhlásená (offers_optout) ani do_not_contact tam nie sú
 *   · venčekár, ktorý si KÚPIL členstvo (user_type 'client'), tam patrí
 *   · počty v náhľade sedia s tým, komu to reálne odíde
 *   · bežná klientka to dostane (ochrany nezmazali publikum)
 *
 * Spustenie:  node qa/outreach-ochrany.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4644;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-outr-'));

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
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

(async () => {
  w('users.db', [
    { _id: 'qaOuAdmin00001', name: 'Marek Gruber', email: 'qa.ou.admin@qa-biz.local',
      password: bcrypt.hashSync('Heslo123!', 10), is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' },

    // Patrí tam: bežná klientka s permanentkou
    { _id: 'qaOuKlient0001', name: 'Jana Klientka', email: 'qa.ou.klient@qa-biz.local',
      user_type: 'client', active: true, email_consent: true, single_entries: 5, created_at: '2026-01-01' },

    // Nepatrí: venčekár s permanentkou (deviatak, nie klientka)
    { _id: 'qaOuVencek0001', name: 'Vanda Venčeková', email: 'qa.ou.vencek@qa-biz.local',
      user_type: 'lead', active: true, email_consent: true, single_entries: 5,
      venceky_role: 'student', venceky_class_id: 'trieda9A', created_at: '2026-01-01' },

    // Patrí tam: venčekár, ktorý si kúpil členstvo — je to už klientka
    { _id: 'qaOuVencekKli1', name: 'Klára Bývalá Venčekárka', email: 'qa.ou.vencekklient@qa-biz.local',
      user_type: 'client', active: true, email_consent: true, single_entries: 5,
      venceky_role: 'student', venceky_class_id: 'trieda9A', created_at: '2026-01-01' },

    // Nepatrí: odhlásená z ponúk cez /unsubscribe
    { _id: 'qaOuOdhlas0001', name: 'Olga Odhlásená', email: 'qa.ou.odhlas@qa-biz.local',
      user_type: 'client', active: true, email_consent: true, single_entries: 5,
      offers_optout: true, unsubscribed_at: '2026-10-01', created_at: '2026-01-01' },

    // Nepatrí: do_not_contact
    { _id: 'qaOuNekontak1', name: 'Nina Nekontaktovať', email: 'qa.ou.nekontakt@qa-biz.local',
      user_type: 'client', active: true, email_consent: true, single_entries: 5,
      do_not_contact: true, created_at: '2026-01-01' },
  ]);

  console.log('HROMADNÉ SPRÁVY — OCHRANY — štart servera…');
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
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.ou.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    console.log('\n1) Počty v náhľade:');
    const seg = (await j('/api/admin/outreach/segments', {}, adm)).d || {};
    const entries = (seg.segments || []).find(s => s.key === 'entries') || {};
    // Permanentku má 5 účtov, ale 3 z nich sú venčekár, odhlásená a do_not_contact
    ok('segment „permanentkové vstupy" má 2, nie 5', entries.count === 2,
      'je ' + entries.count + ' — ' + JSON.stringify(seg.segments));

    console.log('\n2) Komu to reálne odíde:');
    const send = await j('/api/admin/outreach/send', { method: 'POST', body: {
      segment: 'entries', subject: 'QA test ochrán', message: 'Toto je test.', channel: 'both' } }, adm);
    ok('rozoslanie prešlo', send.status === 200 && send.d && send.d.ok, JSON.stringify(send.d));
    ok('adresátov je 2 (sedí s náhľadom)', (send.d || {}).recipients === 2, JSON.stringify(send.d));

    const notif = (() => {
      try {
        const m = new Map();
        fs.readFileSync(path.join(DATA, 'notifications.db'), 'utf8').split('\n').filter(Boolean)
          .forEach(l => { try { const o = JSON.parse(l); if (o._id) m.set(o._id, o); } catch (e) {} });
        return [...m.values()].filter(n => n.type === 'campaign');
      } catch (e) { return []; }
    })();
    const komu = new Set(notif.map(n => n.user_id));
    ok('bežná klientka oznam dostala', komu.has('qaOuKlient0001'));
    ok('bývalá venčekárka s členstvom ho dostala', komu.has('qaOuVencekKli1'));
    ok('venčekár ho NEDOSTAL', !komu.has('qaOuVencek0001'), [...komu].join(','));
    ok('odhlásená ho NEDOSTALA', !komu.has('qaOuOdhlas0001'), [...komu].join(','));
    ok('do_not_contact ho NEDOSTALA', !komu.has('qaOuNekontak1'), [...komu].join(','));

    console.log('\n3) Publikum sa neodfiltrovalo do nuly:');
    const klienti = (seg.segments || []).find(s => s.key === 'clients') || {};
    ok('segment „Všetci klienti" nie je prázdny', klienti.count >= 2, JSON.stringify(klienti));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nHROMADNÉ SPRÁVY — OCHRANY: ' + passed + ' OK / ' + failed + ' chýb');
    if (failed && chyba) console.log(chyba.slice(-900));
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
