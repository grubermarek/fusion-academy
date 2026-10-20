/**
 * FUNNEL-005: Meta CAPI event_id dedup + plné eventy
 * Server sa spustí s CAPI_DEBUG_FILE → metaCapi zapisuje payloady do súboru namiesto siete.
 * Overuje: CompleteRegistration/Lead/Schedule/FirstClassAttended nesú event_id z klienta,
 * + statické kontroly Purchase/InitiateCheckout dedup kľúčov (server aj klient).
 *
 * Spustenie:  node qa/funnel-005-capi.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4499;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-f005-'));
const CAPI = path.join(DATA, 'capi.jsonl');

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
const capiLines = () => { try { return fs.readFileSync(CAPI, 'utf8').trim().split('\n').map(l => JSON.parse(l)); } catch (e) { return []; } };
const waitFor = async (pred, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (pred(capiLines())) return true; await new Promise(r => setTimeout(r, 200)); } return pred(capiLines()); };
const past = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

(async () => {
  console.log('FUNNEL-005 QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', CAPI_DEBUG_FILE: CAPI },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  try {
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } }, adm);

    // ── 1) Registrácia s event_id v atribúcii → CompleteRegistration nesie event_id ──
    const jar = {};
    await j('/api/register', { method: 'POST', body: {
      name: 'Qa Kapiova', email: 'qa.capi@qa-biz.local', password: 'Heslo123!', consent: true, city: 'Detva',
      attribution: { event_id: 'regeid_qa1', landing: '/registracia?utm_source=fb', fbp: 'fb.1.111.222' },
    } }, jar);
    await waitFor(ls => ls.some(l => l.event_name === 'CompleteRegistration'));
    const cr = capiLines().find(l => l.event_name === 'CompleteRegistration');
    ok('CompleteRegistration odoslané cez CAPI', !!cr);
    ok('CompleteRegistration nesie event_id z klienta', cr && cr.event_id === 'regeid_qa1', JSON.stringify(cr));
    ok('CompleteRegistration nesie event_source_url', cr && (cr.event_source_url || '').startsWith('/registracia'), JSON.stringify(cr));

    // ── 2) Landing rezervácia → Lead + Schedule s event_id_lead/event_id_schedule ──
    const sched = await j('/api/first-class/schedule?city=detva');
    const slot = (sched.d.items || [])[0];
    ok('landing rozvrh vracia termíny', !!slot);
    const bk = await j('/api/first-class/book', { method: 'POST', body: {
      name: 'Qa Landingova', email: 'qa.landing5@qa-biz.local', phone: '',
      class_id: slot.class_id, booking_date: slot.date,
      attribution: { event_id_lead: 'lead_qax', event_id_schedule: 'sch_qax', event_id_registration: 'reg_qax', landing: '/prva-hodina?city=detva&utm_source=fb', fbclid: 'fbtest1' },
    } });
    ok('landing booking prešiel', bk.d && bk.d.ok, JSON.stringify(bk.d));
    await waitFor(ls => ls.some(l => l.event_name === 'Schedule'));
    const lead = capiLines().find(l => l.event_name === 'Lead');
    const schd = capiLines().find(l => l.event_name === 'Schedule');
    ok('Lead nesie event_id_lead', lead && lead.event_id === 'lead_qax', JSON.stringify(lead));
    ok('Schedule nesie event_id_schedule', schd && schd.event_id === 'sch_qax', JSON.stringify(schd));
    ok('Lead nesie event_source_url landing', lead && (lead.event_source_url || '').startsWith('/prva-hodina'), JSON.stringify(lead));
    // Pozn.: dospelý landing posiela CompleteRegistration len pri zapnutom prvom týždni
    // zadarmo, takže sa tu neoveruje behom — drží to statická kontrola v bode 4.

    // ── 2b) Detský landing: tá istá dedupikácia ──
    const scK = await j('/api/first-class/kids-schedule');
    const slotK = ((scK.d && scK.d.items) || [])[0];
    if (slotK) {
      const bkK = await j('/api/first-class/book-kids', { method: 'POST', body: {
        child_name: 'Qa Dietko', birth_year: 2017, parent_name: 'Qa Rodic Capi',
        email: 'qa.kids5@qa-biz.local', class_id: slotK.class_id, booking_date: slotK.date,
        attribution: { event_id_registration: 'reg_kidsqa', event_id_schedule: 'sch_kidsqa',
          landing: '/prva-hodina-kids?utm_source=fb', fbclid: 'fbtest2' },
      } });
      ok('detská rezervácia prešla', bkK.d && bkK.d.ok, JSON.stringify(bkK.d).slice(0, 140));
      await waitFor(ls => ls.some(l => l.event_id === 'reg_kidsqa'));
      const crK = capiLines().find(l => l.event_id === 'reg_kidsqa');
      const schK = capiLines().find(l => l.event_id === 'sch_kidsqa');
      ok('detská registrácia nesie event_id z prehliadača', crK && crK.event_name === 'CompleteRegistration',
        JSON.stringify(crK));
      ok('detský Schedule nesie event_id z prehliadača', !!schK, JSON.stringify(schK));
    }

    // ── 3) Prvá ODCHODENÁ hodina → FirstClassAttended s event_id fca_<uid> ──
    const _l = ((await j('/api/admin/leads?search=qa.landing5', {}, adm)).d.leads || [])[0] || {};
    const uid = _l._id || _l.id;
    ok('klientka z landingu v admin zozname', !!uid);
    await j('/api/attendance/manual-booking', { method: 'POST', body: { user_id: uid, class_id: slot.class_id, booking_date: past(1), is_free: true } }, adm);
    await waitFor(ls => ls.some(l => l.event_name === 'FirstClassAttended'));
    const fca = capiLines().find(l => l.event_name === 'FirstClassAttended');
    ok('FirstClassAttended po 1. účasti', !!fca, JSON.stringify(capiLines().map(l => l.event_name)));
    ok('FirstClassAttended event_id = fca_<uid>', fca && fca.event_id === 'fca_' + uid, JSON.stringify(fca));

    // druhá účasť → FCA sa už NEposiela (len raz)
    await j('/api/attendance/manual-booking', { method: 'POST', body: { user_id: uid, class_id: slot.class_id, booking_date: past(2), is_free: true } }, adm);
    await new Promise(r => setTimeout(r, 800));
    ok('FirstClassAttended len raz', capiLines().filter(l => l.event_name === 'FirstClassAttended').length === 1);

    // ── 4) Statické kontroly dedup kľúčov (server + klient) ──
    const app = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const srvSrc = app('server.js'), evSrc = app('event-tickets.js');
    ok('creditAttendance posiela FirstClassAttended (kiosk/tréner cesta)', /creditAttendance[\s\S]{0,400}FirstClassAttended/.test(srvSrc));
    ok('Stripe fulfil posiela Purchase s pur_<session>', srvSrc.includes("trackPurchase(meta.user_id, plan.price, 'pur_'+s.id)"));
    ok('membership checkout posiela InitiateCheckout', srvSrc.includes("metaCapi('InitiateCheckout'") && srvSrc.includes("event_id:'ic_'+r.body.id"));
    ok('event objednávka posiela InitiateCheckout ic_<order>', evSrc.includes("event_id:'ic_'+order_number"));
    ok('event fulfil posiela Purchase pur_<order>', evSrc.includes("event_id:'pur_'+order.order_number"));
    const ft = app('public/fa-track.js'), ph = app('public/prva-hodina.html'), cd = app('public/client-dashboard.html');
    ok('fa-track: faEventId + event_id v atribúcii', ft.includes('window.faEventId') && ft.includes('a.event_id = window.faEventId()'));
    ok('fa-track: fbq dostáva eventID (dedup)', ft.includes('eid?{eventID:eid}:undefined'));
    ok('landing: event_id_lead/schedule v atribúcii + eventID na fbq', ph.includes("event_id_lead:'lead_'+eidBase") && ph.includes('eventID:attribution.event_id_lead'));
    // Registrácia sa dedupikuje rovnako ako Lead/Schedule. Do 20. 10. nie: prehliadač
    // posielal reg_<event_id>, server reg_<id používateľa> — Meta by ju rátala dvakrát
    // a cena za registráciu by vyšla polovičná. To isté na detskej stránke s id dieťaťa.
    const phk = app('public/prva-hodina-kids.html');
    ok('landing: registrácia má event_id z prehliadača (klient aj server)',
      ph.includes("event_id_registration:'reg_'+eidBase") && ph.includes('eventID:attribution.event_id_registration')
      && srvSrc.includes("event_id:clean(attr.event_id_registration)||('reg_'+u._id)"));
    ok('detský landing: registrácia aj Schedule majú event_id z prehliadača',
      phk.includes("attribution.event_id_registration='reg_'+eidBase")
      && phk.includes('eventID:attribution.event_id_schedule')
      && phk.includes('eventID:attribution.event_id_registration')
      && srvSrc.includes("event_id:clean(attr.event_id_registration)||('reg_'+rodic._id)"));
    ok('dashboard: Purchase pixel s pur_<session_id>', cd.includes("eventID:'pur_'+p.get('session_id')"));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nFUNNEL-005: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
