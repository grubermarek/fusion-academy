/**
 * Septembrová referral výzva (Marek 31. 8.): jediná odmena — súkromná hodina
 * s Marekom za kamošku, ktorá si reálne zaplatí.
 *
 * Augustová verzia mala tri stupne a druhý ani tretí nedosiahol nikto, preto
 * test stráži hlavne to, aby sa progres rátal správne a aby odmena padla len
 * za PLATIACU kamošku — darček ani 0 € sa rátať nesmú, inak by sme rozdávali
 * hodiny za registrácie.
 *
 * Spustenie:  node qa/referral-vyzva-september.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4536;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-vyzva-'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

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

const V_OKNE = '2026-09-10';        // v okne výzvy
const MIMO = '2026-08-20';          // pred štartom
const NOW = new Date().toISOString();

let poradie = 0;
const U = (id, meno, extra = {}) => JSON.stringify({
  _id: id, name: meno, email: id.toLowerCase() + '@qa-biz.local', phone: '', password: '',
  referral_code: 'QAV' + String(++poradie).padStart(3, '0'), sponsor_id: null, rank: 1,
  is_admin: false, user_type: 'client', active: true, visit_count: 1, created_at: '2026-06-01',
  city: 'Detva', account_creation_type: 'self_registration', ...extra,
});

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaVyzAdmin00001', name: 'Adam Admin', email: 'qa.vyz.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-06-01' }),
    // sponzorky
    JSON.stringify({ _id: 'qaVyzSponzor001', name: 'Sona Sponzorka', email: 'qa.vyz.sponzor@qa-biz.local',
      password: hash, user_type: 'client', active: true, referral_code: 'QAVS01', visit_count: 5,
      created_at: '2026-06-01', city: 'Detva' }),
    JSON.stringify({ _id: 'qaVyzNulova0001', name: 'Nina Nulova', email: 'qa.vyz.nulova@qa-biz.local',
      password: hash, user_type: 'client', active: true, referral_code: 'QAVS02', visit_count: 5,
      created_at: '2026-06-01', city: 'Detva' }),
    // pozvané
    U('qaVyzPlatiaca01', 'Petra Platiaca', { sponsor_id: 'qaVyzSponzor001', created_at: V_OKNE }),
    U('qaVyzDarcek0001', 'Dana Darcekova', { sponsor_id: 'qaVyzNulova0001', created_at: V_OKNE }),
    U('qaVyzMimoOkna01', 'Miriam Skorá', { sponsor_id: 'qaVyzNulova0001', created_at: MIMO }),
    U('qaVyzBezPlatby1', 'Bara Bezplatna', { sponsor_id: 'qaVyzNulova0001', created_at: V_OKNE }),
  ].join('\n') + '\n');

  // Petra si kúpila členstvo (ráta sa), Dana dostala darček (nesmie sa rátať),
  // Miriam zaplatila, ale mimo okna výzvy. Bára nezaplatila nič.
  fs.writeFileSync(path.join(DATA, 'transactions.db'), [
    JSON.stringify({ _id: 'qaVyzTx00000001', user_id: 'qaVyzPlatiaca01', type: 'membership',
      amount: 49, payment_method: 'card', created_at: V_OKNE }),
    JSON.stringify({ _id: 'qaVyzTx00000002', user_id: 'qaVyzDarcek0001', type: 'membership',
      amount: 0, payment_method: 'free', created_at: V_OKNE }),
    JSON.stringify({ _id: 'qaVyzTx00000003', user_id: 'qaVyzMimoOkna01', type: 'membership',
      amount: 49, payment_method: 'card', created_at: MIMO }),
  ].join('\n') + '\n');

  console.log('SEPTEMBROVÁ VÝZVA QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1',
           MAIL_CAPTURE: '1', QA_EVENT_WINDOW: '1', BREVO_API_KEY: 'qa-fake-key' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); process.exit(1); }

  try {
    console.log('\nNastavenie výzvy:');
    ok('okno je celý september', /REFERRAL_GOAL_FROM = '2026-09-01'/.test(SRC) && /REFERRAL_GOAL_TO   = '2026-09-30'/.test(SRC));
    ok('odmena je jediná — súkromná hodina',
      /REFERRAL_GOAL_TIERS = \[\s*\{ need:1[^}]*Súkromná hodina s Marekom[^}]*\},\s*\]/.test(SRC), 'stupne sa nezhodujú');
    ok('taška a masterclass zo stupňov zmizli', !/label:'Športová taška Fusion'/.test(SRC) && !/label:'Masterclass event ZDARMA'/.test(SRC));

    console.log('\nProgres klientky:');
    const spz = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.vyz.sponzor@qa-biz.local', password: 'Heslo123!' } }, spz);
    const g = (await j('/api/client/referral-goal', {}, spz)).d;
    ok('endpoint odpovedá', g && g.ok, JSON.stringify(g));
    ok('platiaca kamoška sa ráta', g.count === 1, 'count=' + (g && g.count));
    ok('odmena je odomknutá', g.tiers && g.tiers[0] && g.tiers[0].reached === true, JSON.stringify(g && g.tiers));
    ok('je len jeden stupeň', g.tiers && g.tiers.length === 1, 'stupňov=' + (g.tiers || []).length);
    ok('okno sedí aj v odpovedi', g.from === '2026-09-01' && g.to === '2026-09-30', g.from + '–' + g.to);

    const nul = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.vyz.nulova@qa-biz.local', password: 'Heslo123!' } }, nul);
    const g2 = (await j('/api/client/referral-goal', {}, nul)).d;
    ok('darček sa NErátal', g2.count === 0, 'count=' + g2.count + ' (darček/mimo okna/bez platby)');
    ok('a odmena teda nie je odomknutá', g2.tiers[0].reached === false);

    console.log('\nAdmin prehľad:');
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.vyz.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    const rep = (await j('/api/admin/referral-goal-report', {}, adm)).d;
    ok('report beží', rep && rep.ok, JSON.stringify(rep && rep.error));
    ok('počíta hodiny na odovzdanie', rep.totals && rep.totals.hodina === 1, JSON.stringify(rep.totals));
    ok('staré kľúče (taška/event50) sú preč',
      rep.totals && rep.totals.taska === undefined && rep.totals.event50 === undefined, JSON.stringify(rep.totals));
    const sona = (rep.rows || []).find(r => /Sona/.test(r.sponsor));
    ok('Sona má nárok na hodinu', sona && sona.rewards.hodina === true, JSON.stringify(sona));

    console.log('\nMail k výzve:');
    const w = (await j('/api/admin/qa/run-event-mail/challenge', { method: 'POST' }, adm)).d;
    const ws = (w && w.selected || []).map(e => String(e).toLowerCase());
    ok('vlna beží', w && Array.isArray(w.selected), JSON.stringify(w));
    ok('klientky sú oslovené', ws.includes('qa.vyz.sponzor@qa-biz.local'), ws.join(','));
    ok('admin mail nedostane', !ws.includes('qa.vyz.admin@qa-biz.local'), ws.join(','));
    const w2 = (await j('/api/admin/qa/run-event-mail/challenge', { method: 'POST' }, adm)).d;
    ok('druhý beh nikoho neosloví', (w2 && w2.selected || []).length === 0, JSON.stringify(w2 && w2.selected));
    ok('predmet hovorí o hodine, nie o taške',
      /REF_CHALLENGE_SUBJ = '💃 Priveď kamošku a hodinu tancuješ so mnou/.test(SRC));
    ok('text menuje hodnotu 100 €', /bežne 100 €/.test(SRC));

    console.log('\nTexty v appke:');
    const dash = fs.readFileSync(path.join(__dirname, '..', 'public', 'client-dashboard.html'), 'utf8');
    ok('nástenka ponúka súkromnú hodinu', /súkromná hodina s Marekom zadarmo \(hodnota 100 €\)/.test(dash));
    ok('nástenka už nespomína tašku ako odmenu', !/taška je tvoja/.test(dash) && !/športová taška Fusion \(limitovaná/.test(dash));
    ok('termín je september', /do 30\. septembra/.test(dash) && !/⏳ do 31\. augusta/.test(dash));
    const pop = fs.readFileSync(path.join(__dirname, '..', 'public', 'booking-success.js'), 'utf8');
    ok('pop-up po rezervácii tiež', /tancuješ hodinu s Marekom/.test(pop) && !/športová taška je TVOJA/.test(pop));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nSEPTEMBROVÁ VÝZVA: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
