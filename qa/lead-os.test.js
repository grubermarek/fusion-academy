/**
 * LEAD OS — jednotná zdieľaná vrstva starostlivosti (docs/LEAD_OS_SPEC.md).
 * Overuje: admin kontakt je viditeľný trénerom (a naopak), semafor proti spamu,
 * starostlivosť v detaile klientky, automatika viditeľná trénerovi, watchdog,
 * hot leady, dismiss+kontakt jedným krokom.
 * Spustenie:  node qa/lead-os.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4519;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-leados-'));

let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };

async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = JSON.parse(await r.text()); } catch (e) {}
  return { status: r.status, d };
}

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const dnes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const pred = dni => new Date(Date.now() - dni * 86400000).toISOString();
  const W = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

  W('users.db', [
    { _id: 'trenerkaLeadOs01', name: 'Beata Trenerka', email: 'beata.qa@qa-biz.local', password: hash,
      user_type: 'trainer', active: true, rank: 1, referral_code: 'TRN1', created_at: '2026-01-01' },
    // čerstvá registrácia bez rezervácie → HOT + neodkladná úloha
    { _id: 'leadCerstvy00001', name: 'Nina Cerstvenka', email: 'nina.qa-lead@qa-real.sk', phone: '0905 111 111',
      user_type: 'lead', lead_source: 'web', active: true, rank: 1, referral_code: 'NC1', created_at: pred(1) },
    // starý lead bez kontaktu > 21 dní → zabudnutý
    { _id: 'leadZabudnuty001', name: 'Zora Zabudnuta', email: 'zora.qa-lead@qa-real.sk', phone: '0905 222 222',
      user_type: 'lead', lead_source: 'web', active: true, rank: 1, referral_code: 'ZZ1', created_at: pred(40) },
    // klientka na overenie detailu starostlivosti
    { _id: 'klientkaCare0001', name: 'Klara Klientka', email: 'klara.qa@qa-real.sk', phone: '0905 333 333',
      user_type: 'client', active: true, rank: 1, referral_code: 'KK1', created_at: pred(90), visit_count: 5 },
  ]);
  // automatika: klientka má naplánovaný pending mail
  W('email_steps.db', [{ _id: 'stepWinback01', sequence: 'winback', day: 4, label: 'Winback 1',
    active: true, subject: 'Chýbaš nám na parkete', body: 'Ahoj {meno}!', created_at: pred(10) }]);
  W('email_queue.db', [
    { _id: 'eq1', user_id: 'klientkaCare0001', sequence: 'winback', step_id: 'stepWinback01',
      scheduled_for: '2099-01-01', status: 'pending', created_at: pred(2) },
    { _id: 'eq2', user_id: 'klientkaCare0001', sequence: 'welcome', step_id: 'stepWinback01',
      scheduled_for: (pred(30) || '').slice(0, 10), status: 'sent', sent_at: pred(30), created_at: pred(31) },
  ]);

  console.log('LEAD OS QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { try { await fetch(BASE + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }

  const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };

  try {
    const adm = {}, trn = {};
    await j('/api/login', { method: 'POST', body: { email: 'admin@fusionacademy.sk', password: 'admin123' } }, adm);
    await j('/api/login', { method: 'POST', body: { email: 'beata.qa@qa-biz.local', password: 'Heslo123!' } }, trn);

    // ── 1. Neodkladné úlohy vidia čerstvú registráciu ──
    const u1 = (await j('/api/admin/urgent-tasks', {}, adm)).d;
    const ninaTask = u1.tasks.find(t => t.name === 'Nina Cerstvenka');
    ok('čerstvá registrácia je v neodkladných', !!ninaTask, JSON.stringify(u1.tasks.map(t => t.name)));
    ok('úloha nesie user_id (pre zdieľaný zápis)', ninaTask && ninaTask.user_id === 'leadCerstvy00001');
    ok('úloha ukazuje, že ju ešte nikto nekontaktoval', ninaTask && !ninaTask.last_contact);

    // ── 2. Tréner má Ninu v dennom zozname (HOT) ──
    const c1 = (await j('/api/coach/today', {}, trn)).d;
    const ninaCoach = (c1.leads || []).find(l => l.name === 'Nina Cerstvenka');
    ok('tréner vidí Ninu v dennom zozname', !!ninaCoach, JSON.stringify((c1.leads || []).map(l => l.name)));

    // ── 3. ADMIN zapíše kontakt → zdieľaná vrstva ──
    const ac = await j('/api/admin/leads/leadCerstvy00001/contact', { method: 'POST',
      body: { outcome: 'interested', note: 'volal som, chce prísť v utorok', followup_date: '2099-02-01' } }, adm);
    ok('admin kontakt sa zapíše', ac.d && ac.d.ok, JSON.stringify(ac.d));
    const cc = rd('coach_contacts.db').filter(c => c.lead_id === 'leadCerstvy00001');
    ok('kontakt je v coach_contacts (jedna vrstva)', cc.length === 1 && cc[0].by_role === 'admin'
      && /\(admin\)/.test(cc[0].trainer_name), JSON.stringify(cc));
    ok('poznámka je v lead_notes (vidia ju tréneri)', rd('lead_notes.db')
      .some(n => n.client_id === 'leadCerstvy00001' && /utorok/.test(n.text)));
    ok('follow-up vznikol v crm_tasks', rd('crm_tasks.db')
      .some(t => t.client_id === 'leadCerstvy00001' && t.status === 'open' && t.due_date === '2099-02-01'));
    ok('výsledok sa premietol do lead_status', (rd('users.db').find(u => u._id === 'leadCerstvy00001') || {}).lead_status === 'interested');

    // ── 4. Semafor: úloha zmizla adminom AJ trénerom ──
    const u2 = (await j('/api/admin/urgent-tasks', {}, adm)).d;
    ok('neodkladná úloha po kontakte zmizla', !u2.tasks.some(t => t.name === 'Nina Cerstvenka'), JSON.stringify(u2.tasks.map(t => t.name)));
    const c2 = (await j('/api/coach/today', {}, trn)).d;
    ok('tréner Ninu 3 dni nedostane (admin ju už kontaktoval)',
      !(c2.leads || []).some(l => l.name === 'Nina Cerstvenka'), JSON.stringify((c2.leads || []).map(l => l.name)));

    // ── 5. Tréner v detaile vidí admin kontakt aj poznámku ──
    const det = (await j('/api/coach/lead/leadCerstvy00001', {}, trn)).d;
    ok('tréner vidí admin kontakt v histórii', det.contacts.some(c => /\(admin\)/.test(c.trainer || '') && c.outcome === 'interested'), JSON.stringify(det.contacts));
    ok('tréner vidí admin poznámku', det.notes.some(n => /utorok/.test(n.text)));

    // ── 6. Tréner vidí automatiku (čo príde) ──
    const detK = (await j('/api/coach/lead/klientkaCare0001', {}, trn)).d;
    ok('tréner vidí ďalší naplánovaný mail', detK.next_mail && detK.next_mail.sequence === 'winback'
      && detK.next_mail.scheduled_for === '2099-01-01', JSON.stringify(detK.next_mail));
    ok('tréner vidí aktívne sekvencie', (detK.active_sequences || []).includes('winback'));

    // ── 7. Detail klientky (admin): starostlivosť + automatika ──
    await j('/api/admin/leads/klientkaCare0001/contact', { method: 'POST', body: { outcome: 'contacted', note: 'winback telefonát' } }, adm);
    const cd = (await j('/api/admin/crm/client/klientkaCare0001', {}, adm)).d;
    ok('detail klientky má kontakty', (cd.contacts || []).length === 1 && /\(admin\)/.test(cd.contacts[0].by), JSON.stringify(cd.contacts));
    ok('detail klientky má poznámky', (cd.notes_list || []).some(n => /winback telefonát/.test(n.text)));
    ok('detail klientky ukazuje ďalší automat. mail', cd.care && cd.care.next_mail
      && cd.care.next_mail.sequence === 'winback' && /Chýbaš/.test(cd.care.next_mail.subject), JSON.stringify(cd.care && cd.care.next_mail));
    ok('detail klientky ukazuje posledný kontakt', cd.care.last_contact && cd.care.last_contact.outcome === 'contacted');

    // ── 8. Zdieľaná poznámka z admin modalu ──
    const nt = await j('/api/admin/leads/leadZabudnuty001/note', { method: 'POST', body: { text: 'stara znama, skusit v septembri' } }, adm);
    ok('admin poznámka prejde', nt.d && nt.d.ok);
    ok('je v lead_notes aj v users.notes (zrkadlo)',
      rd('lead_notes.db').some(n => n.client_id === 'leadZabudnuty001' && /septembri/.test(n.text))
      && /septembri/.test((rd('users.db').find(u => u._id === 'leadZabudnuty001') || {}).notes || ''));

    // ── 9. Watchdog: zabudnutý lead sa ráta ──
    const ld = (await j('/api/admin/leads', {}, adm)).d;
    const zora = ld.leads.find(l => l.name === 'Zora Zabudnuta');
    ok('zoznam leadov obsahuje zabudnutú', !!zora);
    ok('štatistika ráta zabudnuté (>21 dní bez dotyku)', ld.stats.forgotten === 1, JSON.stringify(ld.stats));
    // Nina má follow-up + čerstvý kontakt → nie je zabudnutá; klientka nie je lead

    // ── 10. Dismiss + kontakt jedným krokom ──
    // vyrobíme druhú čerstvú registráciu, nech má úloha koho vybaviť
    await j('/api/register', { method: 'POST', body: { name: 'Dana Dismisnuta', email: 'dana.qa-lead@qa-real.sk', password: 'Heslo123!', consent: true } });
    const u3 = (await j('/api/admin/urgent-tasks', {}, adm)).d;
    const danaTask = (u3.tasks || []).find(t => t.name === 'Dana Dismisnuta');
    ok('nová registrácia vytvorila úlohu', !!danaTask, JSON.stringify((u3.tasks || []).map(t => t.name)));
    if (danaTask) {
      const dm = await j('/api/admin/urgent-tasks/dismiss', { method: 'POST',
        body: { key: danaTask.key, contacted: true, user_id: danaTask.user_id, outcome: 'no_reply', note: 'nedvíha, skúsim zajtra' } }, adm);
      ok('dismiss + kontakt prejde', dm.d && dm.d.ok);
      ok('kontakt z dismissu je v zdieľanej vrstve', rd('coach_contacts.db')
        .some(c => c.lead_id === danaTask.user_id && c.outcome === 'no_reply'), '');
    }

    // ── 11. Bezpečnosť ──
    ok('kontakt endpoint len pre admina (tréner dostane 403)', (await j('/api/admin/leads/leadCerstvy00001/contact', { method: 'POST', body: { outcome: 'contacted' } }, trn)).status === 403);
    ok('nezmyselný outcome sa zosype na contacted', (await (async () => {
      await j('/api/admin/leads/leadZabudnuty001/contact', { method: 'POST', body: { outcome: 'hocico' } }, adm);
      const posledny = rd('coach_contacts.db').filter(c => c.lead_id === 'leadZabudnuty001').pop();
      return posledny && posledny.outcome === 'contacted';
    })()));

    // ── 12. Starostlivosť v číslach (týždenný report) ──
    // stav v tomto teste: 4 admin kontakty (Nina interested, Klara contacted,
    // Zora contacted [fallback z 'hocico'], Dana no_reply z dismissu) + follow-upy
    const cr = (await j('/api/admin/care-report?days=7', {}, adm)).d;
    ok('report sa načíta', cr && cr.ok, JSON.stringify(cr).slice(0, 120));
    ok('ráta kontakty za 7 dní', cr.kontakty.spolu === 4, JSON.stringify(cr.kontakty));
    ok('ráta záujem (interested)', cr.kontakty.zaujem === 1, String(cr.kontakty.zaujem));
    const admRiadok = (cr.per_clen || []).find(x => /\(admin\)/.test(x.meno));
    ok('rozpad per člen tímu vrátane admina', admRiadok && admRiadok.kontakty === 4 && admRiadok.rola === 'admin', JSON.stringify(cr.per_clen));
    ok('duplicitné kontakty = 0 (nikto nevolal 2×)', cr.duplicitne === 0, String(cr.duplicitne));
    ok('hot pokrytie: registrácie v okne sa rátajú', cr.hot.registracie >= 2, JSON.stringify(cr.hot));
    ok('hot pokrytie: kontakt do 3 dní sa ráta', cr.hot.kontakt_do_3d >= 2, JSON.stringify(cr.hot));
    ok('follow-upy: vytvorený sa ráta', cr.followupy.vytvorene === 1, JSON.stringify(cr.followupy));
    // Zora dostala v kroku 11 admin kontakt → už NIE je zabudnutá (kontakt < 21 dní)
    ok('zabudnuté kleslo na 0 po kontakte so Zorou', cr.zabudnute.teraz === 0, JSON.stringify(cr.zabudnute));
    ok('report len pre admina', (await j('/api/admin/care-report', {}, trn)).status === 403);

    // duplicitný kontakt od DRUHÉHO človeka do 3 dní sa zaráta
    await j('/api/coach/contact', { method: 'POST', body: { lead_id: 'leadZabudnuty001', outcome: 'contacted', note: 'skusam znova' } }, trn);
    const cr2 = (await j('/api/admin/care-report?days=7', {}, adm)).d;
    ok('duplicitný kontakt (2 rôzni ľudia < 3 dni) sa zachytí', cr2.duplicitne === 1, String(cr2.duplicitne));

    // ── 12b. Konverzia leadu len s povinným zdôvodnením ──
    // tréner si prevezme Zoru a zapíše kontakt (nutná podmienka konverzie)
    await j('/api/coach/lead/leadZabudnuty001/claim', { method: 'POST', body: {} }, trn);
    // pokus o konverziu BEZ poznámky → 400 a case OSTÁVA otvorený
    const k1 = await j('/api/coach/lead/leadZabudnuty001/release', { method: 'POST',
      body: { lead_status: 'trial', convert: true, note: '' } }, trn);
    ok('konverzia bez poznámky sa odmietne', k1.status === 400 && k1.d && k1.d.need_note === true, JSON.stringify(k1.d));
    ok('chybová hláška vysvetľuje, čo treba', /pričinil/.test((k1.d && k1.d.error) || ''));
    const zoraPo = rd('users.db').find(u => u._id === 'leadZabudnuty001');
    ok('case po odmietnutí OSTÁVA prevzatý (lead sa nestratí)', zoraPo.coach_claimed_by === 'trenerkaLeadOs01', JSON.stringify(zoraPo.coach_claimed_by));
    // default sponzor (zakladateľ-admin) sa priraďuje pri štarte — podstatné je,
    // že sa sponzorom NEstal tréner (konverzia neprebehla)
    ok('trénerka sa sponzorom nestala', zoraPo.sponsor_id !== 'trenerkaLeadOs01', JSON.stringify(zoraPo.sponsor_id));
    // krátka poznámka (menej ako 20 znakov) tiež neprejde
    const k2 = await j('/api/coach/lead/leadZabudnuty001/release', { method: 'POST',
      body: { lead_status: 'trial', convert: true, note: 'volala som' } }, trn);
    ok('príliš krátke zdôvodnenie neprejde', k2.status === 400 && k2.d.need_note === true, JSON.stringify(k2.d));
    // s poriadnou poznámkou request PREJDE (konverzia sa ešte neuzná — case < 1 h,
    // ale to je až ďalšia podmienka; podstatné je, že brána poznámky pustila ďalej)
    const k3 = await j('/api/coach/lead/leadZabudnuty001/release', { method: 'POST',
      body: { lead_status: 'trial', convert: true, note: 'Trikrát som jej volala, dohodli sme termín a prišla na moju hodinu v utorok.' } }, trn);
    ok('so zdôvodnením request prejde', k3.status === 200 && k3.d && k3.d.ok, JSON.stringify(k3.d));
    ok('konverziu zastavila až ďalšia reálna podmienka (krátky case), nie poznámka',
      k3.d.converted === false && /krátko|reálne/.test(k3.d.convert_error || ''), JSON.stringify(k3.d.convert_error));
    ok('zdôvodnenie sa uložilo do poznámok', rd('lead_notes.db')
      .some(n => n.client_id === 'leadZabudnuty001' && /Trikrát som jej volala/.test(n.text)));

    // ── 12. Statika: joby a spec existujú ──
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    ok('hot-lead notifikačný job existuje (guard na deň)', src.includes("'hot_leads_'+today()") && src.includes("type:'hot_lead'"));
    ok('watchdog job existuje (pondelok, guard)', src.includes("'lead_watchdog_'+today()") && src.includes('zabudnuteLeady'));
    ok('pondelková notifikácia reportu existuje', src.includes("type:'care_report'") && src.includes('care_forgotten_hist'));
    ok('spec dokument existuje', fs.existsSync(path.join(__dirname, '..', 'docs', 'LEAD_OS_SPEC.md')));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message + '\n' + e.stack);
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\nLEAD OS: ' + passed + ' OK, ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
