/**
 * Event kampane Latin Tropical: vlna A (leady) + vlna B (urgencia pre klientky).
 * Server beží s MAIL_CAPTURE=1 → maily sa logujú a linky prepisujú, nič sa neodošle.
 * Overuje výber adresátov, dedup, vylúčenie kupujúcich a obsah (ceny, voľné miesta).
 *
 * Spustenie:  node qa/event-mail-waves.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4506;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-evm-'));

let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };

async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const mkid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
const iso = n => new Date(Date.now() - n * 864e5).toISOString();
function mailLogs() {
  try {
    const rows = {};
    for (const line of fs.readFileSync(path.join(DATA, 'mail_log.db'), 'utf8').trim().split('\n')) {
      try { const d = JSON.parse(line); if (d._id) rows[d._id] = { ...rows[d._id], ...d }; } catch (e) {}
    }
    return Object.values(rows);
  } catch (e) { return []; }
}

(async () => {
  // Fixture: 2 leady, 2 klientky (jedna už má vstupenku), 1 odhlásená z ponúk
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const mk = (name, email, type, extra) => ({
    _id: mkid(), name, email, phone: '', password: hash, referral_code: mkid().slice(0, 6).toUpperCase(),
    sponsor_id: null, rank: 1, is_admin: false, active: true, user_type: type, visit_count: 1,
    referral_credit: 0, lead_source: 'qa', created_at: iso(40).slice(0, 10), city: 'Detva',
    account_creation_type: 'self_registration', ...extra,
  });
  const users = [
    mk('Qa Leadova Jedna', 'qa.lead1@qa-biz.local', 'lead'),
    mk('Qa Leadova Dva', 'qa.lead2@qa-biz.local', 'lead'),
    mk('Qa Leadova Optout', 'qa.lead3@qa-biz.local', 'lead', { offers_optout: true }),
    mk('Qa Klientka Bez', 'qa.klient1@qa-biz.local', 'client'),
    mk('Qa Klientka Kupila', 'qa.klient2@qa-biz.local', 'client'),
  ];
  fs.writeFileSync(path.join(DATA, 'users.db'), users.map(u => JSON.stringify(u)).join('\n') + '\n');
  // klientka 2 už má zaplatenú vstupenku (Full) → urgencia jej ísť nesmie
  fs.writeFileSync(path.join(DATA, 'ev_orders.db'), JSON.stringify({
    _id: mkid(), order_number: 'EVQA1', event_slug: 'latin-tropical-2026',
    buyer_name: 'Qa Klientka Kupila', buyer_email: 'qa.klient2@qa-biz.local',
    items: [{ type: 'full', type_name: 'FULL EXPERIENCE — MASTERCLASS', qty: 2 }],
    total: 110, status: 'paid', created_at: iso(1), paid_at: iso(1),
  }) + '\n');

  console.log('EVENT MAIL WAVES QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1',
      MAIL_CAPTURE: '1', BREVO_API_KEY: 'qa-dummy', QA_EVENT_WINDOW: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } }, adm);

    // ── VLNA A: leady ──
    const a1 = await j('/api/admin/qa/run-event-mail/leads', { method: 'POST' }, adm);
    const selA = a1.d.selected || [];
    ok('vlna A vybrala oba leady', selA.includes('qa.lead1@qa-biz.local') && selA.includes('qa.lead2@qa-biz.local'), JSON.stringify(a1.d));
    ok('vlna A NEposiela odhláseným z ponúk', !selA.includes('qa.lead3@qa-biz.local'));
    ok('vlna A NEposiela klientkam', !selA.some(e => e.includes('klient')));
    await new Promise(r => setTimeout(r, 600));
    const leadMails = mailLogs().filter(m => (m.template || '') === 'event_campaign_leads');
    ok('leadom sa zalogovali maily', leadMails.length === 2, String(leadMails.length));
    ok('predmet o párty za 5 €', leadMails[0] && /párty 5\. 9\. za 5 €/.test(leadMails[0].subject || ''), leadMails[0] && leadMails[0].subject);
    ok('link na event medzi cieľmi', leadMails[0] && (leadMails[0].links || []).some(l => l.includes('/event/latin-tropical-2026')));

    // dedup: druhý beh nesmie vybrať tých istých
    const a2 = await j('/api/admin/qa/run-event-mail/leads', { method: 'POST' }, adm);
    ok('vlna A dedup — druhý beh nikoho nevyberie', (a2.d.selected || []).length === 0, JSON.stringify(a2.d));

    // ── VLNA B: urgencia pre klientky ──
    const b1 = await j('/api/admin/qa/run-event-mail/urgency', { method: 'POST' }, adm);
    const selB = b1.d.selected || [];
    ok('vlna B vybrala klientku bez vstupenky', selB.includes('qa.klient1@qa-biz.local'), JSON.stringify(b1.d));
    ok('vlna B NEposiela tej, čo už kúpila', !selB.includes('qa.klient2@qa-biz.local'));
    ok('vlna B NEposiela leadom', !selB.some(e => e.includes('lead')));
    ok('voľné miesta = 28 (30 − 2 predané)', b1.d.volne === 28, String(b1.d.volne));
    await new Promise(r => setTimeout(r, 600));
    const urgMails = mailLogs().filter(m => (m.template || '') === 'event_campaign_urgency');
    ok('urgencia zalogovaná', urgMails.length === 1, String(urgMails.length));
    ok('predmet o posledných dňoch', urgMails[0] && /Posledné dni/.test(urgMails[0].subject || ''));

    const b2 = await j('/api/admin/qa/run-event-mail/urgency', { method: 'POST' }, adm);
    ok('vlna B dedup', (b2.d.selected || []).length === 0);

    // ── statické kontroly ──
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    ok('vlna B beží len 29.–31. 8.', src.includes("t < '2026-08-29' || t > '2026-08-31'"));
    ok('vlna A sa po 5. 9. zastaví', src.includes("if(today() > '2026-09-05') return;"));
    ok('QA okno len s QA_EVENT_WINDOW=1', src.includes("process.env.QA_EVENT_WINDOW==='1'"));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nEVENT MAIL WAVES: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
