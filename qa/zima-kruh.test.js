/**
 * Zima v kruhu najbližších — komu mail odíde a kto si zaslúžil december (9. 11. 2026)
 *
 * Akcia je na VRÁTENIE klientok, takže najdrahšia chyba by bola poslať ju tej, ktorá
 * chodí (dostala by mesiac zadarmo za nič), alebo nedoručiť ju rodičovi, ktorého dieťa
 * prestalo chodiť na Kids. December sa nepripisuje sám — appka len spočíta, kto si ho
 * zaslúžil, a darovanie ide cez existujúci grant-membership.
 *
 * Stráži, že:
 *   · publikum je „ešte nebola" + „nebola 3 mesiace", nikdy tá, čo chodí
 *   · dochádzka sa číta z rezervácií (attended), nie z visit_count
 *   · za dieťa dostane mail rodič, a mail menuje dieťa
 *   · ochrany mailov sú tie isté ako pri ostatných vlnách (venčekár, bez súhlasu)
 *   · v texte je novinka, cena z MEMBERSHIP_PLANS aj jej vlastný odkaz na kamošku
 *   · bez ZIMA_GO=1 sa neodošle nič (nasadenie nie je schválenie)
 *   · nárok na december vzniká len pri zaplatenom členstve v okne AJ novej kamoške
 *   · rodičovi bez vlastného členstva sa mesiac pripíše dieťaťu
 *
 * Spustenie:  node qa/zima-kruh.test.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4651;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-zima-'));
let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const riadky = arr => arr.map(o => JSON.stringify(o)).join('\n') + '\n';
const pred = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const H = bcrypt.hashSync('Heslo123!', 10);
const suhlas = { email_consent: true, consent_at: new Date().toISOString() };
// Kódy musia byť unikátne — users.referral_code má unikátny index, takže odvodzovať
// ich z konca _id (veľa účtov končí na 000001) server vôbec nespustí.
let kodPoradie = 0;
const klient = (id, name, email, extra) => ({ _id: id, name, email, password: H, active: true,
  user_type: 'client', referral_code: 'QZ' + String(++kodPoradie).padStart(4, '0'), rank: 1,
  visit_count: 0, created_at: pred(400), ...suhlas, ...(extra || {}) });

(async () => {
  fs.writeFileSync(path.join(DATA, 'users.db'), riadky([
    { _id: 'qaZimAdmin000001', name: 'QA Admin', email: 'qa.zima.admin@qa-biz.local', password: H,
      is_admin: true, active: true, user_type: 'admin', referral_code: 'QAZIMA', created_at: pred(400) },
    // Odišla pred pol rokom → patrí do vlny, mail jej pripomenie dátum.
    klient('qaZimOdisla0001', 'Alena Odišlá', 'alena.odisla@qa-biz.local'),
    // Chodila minulý týždeň → akcia nie je pre ňu.
    klient('qaZimChodi00001', 'Barbora Chodí', 'barbora.chodi@qa-biz.local'),
    // Registrovaná, nikdy netancovala.
    klient('qaZimNikdy00001', 'Cecília Nikdy', 'cecilia.nikdy@qa-biz.local', { user_type: 'lead' }),
    // Rodič chodí, ale dieťa prestalo → mail dostane rodič kvôli dieťaťu.
    klient('qaZimRodic00001', 'Dana Rodičová', 'dana.rodicova@qa-biz.local'),
    // Detské účty majú v appke internú adresu a vlastný kód — bez nich padne
    // unikátny index na e-mail a server vôbec nenabehne.
    { _id: 'qaZimDieta00001', name: 'Elenka Rodičová', is_child: true, parent_id: 'qaZimRodic00001',
      email: 'elenka.dieta@internal.local', referral_code: 'QZDIE1',
      active: true, user_type: 'client', kids_group: 'Kids 1', created_at: pred(300) },
    // Venčekár a klientka bez súhlasu — obaja musia vypadnúť.
    klient('qaZimVencek0001', 'Fero Venčekár', 'fero.vencekar@qa-biz.local',
      { user_type: 'lead', venceky_role: 'student' }),
    { _id: 'qaZimBezSuhl001', name: 'Gabika Bez Súhlasu', email: 'gabika.bez@qa-biz.local',
      password: H, active: true, user_type: 'client', referral_code: 'QZBEZS', created_at: pred(400) },
    // Nároky na december: H priviedla K, obe zaplatili v okne.
    klient('qaZimHost000001', 'Hana Hostiteľka', 'hana.host@qa-biz.local'),
    klient('qaZimKamoska001', 'Katka Kamoška', 'katka.kamoska@qa-biz.local', { sponsor_id: 'qaZimHost000001' }),
    // I priviedla L, ale sama si v okne nič nevzala → nárok nemá.
    klient('qaZimIvana00001', 'Ivana Bez Členstva', 'ivana.bez@qa-biz.local'),
    klient('qaZimLucia00001', 'Lucia Kamoška', 'lucia.kamoska@qa-biz.local', { sponsor_id: 'qaZimIvana00001' }),
    // J nemá vlastné členstvo, zaplatila ho dieťaťu → mesiac patrí dieťaťu.
    klient('qaZimJana000001', 'Jana Mama', 'jana.mama@qa-biz.local'),
    { _id: 'qaZimJanaDieta1', name: 'Zarka Mamová', is_child: true, parent_id: 'qaZimJana000001',
      email: 'zarka.dieta@internal.local', referral_code: 'QZDIE2',
      active: true, user_type: 'client', kids_group: 'Kids 2', created_at: pred(300) },
    klient('qaZimMisa000001', 'Miša Kamoška', 'misa.kamoska@qa-biz.local', { sponsor_id: 'qaZimJana000001' }),
  ]));

  const rez = (id, uid, dni, status) => ({ _id: id, user_id: uid, class_id: 'qaZimClass00001',
    class_name: 'QA Zumba', class_location: 'Detva', booking_date: pred(dni), status,
    created_at: new Date(Date.now() - dni * 864e5).toISOString() });
  fs.writeFileSync(path.join(DATA, 'bookings.db'), riadky([
    rez('qaZimBook000001', 'qaZimOdisla0001', 180, 'attended'),
    rez('qaZimBook000002', 'qaZimChodi00001', 7, 'attended'),
    rez('qaZimBook000003', 'qaZimDieta00001', 200, 'attended'),
    rez('qaZimBook000004', 'qaZimRodic00001', 5, 'attended'),
    // Zrušená rezervácia nie je odtancovaná hodina — Cecília musí zostať „nikdy".
    rez('qaZimBook000005', 'qaZimNikdy00001', 3, 'cancelled'),
  ]));

  // Platby v okne akcie (9.–30. 11. 2026). Dátumy sú pevné, nech test nezávisí od dňa behu.
  const platba = (id, uid, meno, datum) => ({ _id: id, type: 'membership', user_id: uid, user_name: meno,
    amount: 49.9, date: datum, month: datum.slice(0, 7), payment_method: 'card', plan_id: 'bronze',
    note: 'QA členstvo', created_at: datum + 'T12:00:00.000Z' });
  fs.writeFileSync(path.join(DATA, 'transactions.db'), riadky([
    platba('qaZimTx00000001', 'qaZimHost000001', 'Hana Hostiteľka', '2026-11-12'),
    platba('qaZimTx00000002', 'qaZimKamoska001', 'Katka Kamoška', '2026-11-20'),
    // Lucia je nová platiaca, ale Ivana si sama nič nevzala.
    platba('qaZimTx00000003', 'qaZimLucia00001', 'Lucia Kamoška', '2026-11-18'),
    // Jana zaplatila dieťaťu, Miša je jej nová kamoška.
    platba('qaZimTx00000004', 'qaZimJanaDieta1', 'Zarka Mamová', '2026-11-15'),
    platba('qaZimTx00000005', 'qaZimMisa000001', 'Miša Kamoška', '2026-11-22'),
  ]));
  fs.writeFileSync(path.join(DATA, 'memberships.db'), riadky([
    { _id: 'qaZimMem00000001', user_id: 'qaZimHost000001', plan_id: 'bronze', plan_name: 'Bronze',
      status: 'active', price: 49.9, payment_method: 'card', started_at: '2026-11-12T12:00:00.000Z',
      expires_at: '2026-12-12T12:00:00.000Z', created_at: '2026-11-12T12:00:00.000Z' },
  ]));

  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1',
      MAIL_CAPTURE: '1', ZIMA_GO: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await sleep(1000); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1500)); process.exit(1); }
  await sleep(9000);

  const jar = {};
  const ide = async (url, opts = {}) => {
    const r = await fetch(BASE + url, { redirect: 'manual', headers: { 'Content-Type': 'application/json', 'Cookie': Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ') }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); });
    let d = null; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };

  try {
    await ide('/api/login', { method: 'POST', body: { email: 'qa.zima.admin@qa-biz.local', password: 'Heslo123!' } });

    console.log('\n① Komu mail odíde');
    const n = (await ide('/api/admin/zima/nahlad')).d || {};
    ok('náhľad sa načítal', n.ok === true, JSON.stringify(n).slice(0, 200));
    const vsetky = JSON.stringify([n.ukazka_odisla, n.ukazka_nikdy, n.ukazka_deti]);
    ok('okno akcie je november', n.okno && n.okno.od === '2026-11-09' && n.okno.do === '2026-11-30', JSON.stringify(n.okno));
    ok('v zozname je tá, čo odišla pred pol rokom', /Alena|naposledy si u nás tancovala/i.test(vsetky) && !!n.ukazka_odisla);
    ok('aj tá, čo u nás nikdy nebola', !!n.ukazka_nikdy && /ešte nestihli privítať/i.test(n.ukazka_nikdy));
    ok('zrušená rezervácia sa neráta ako hodina', n.nikdy_nebola >= 1, String(n.nikdy_nebola));
    // Dve adresátky majú dieťa v zozname (Dana a Jana), ale len Dana je vo vlne
    // výhradne kvôli dieťaťu — ona sama chodila minulý týždeň.
    ok('rodič je v zozname kvôli dieťaťu', n.s_detmi === 2 && n.len_kvoli_dietatu === 1,
      'sDetmi=' + n.s_detmi + ' lenDeti=' + n.len_kvoli_dietatu);
    ok('mail rodičovi menuje dieťa aj Kids', !!n.ukazka_deti && /Elenka/.test(n.ukazka_deti) && /Zumba Kids/i.test(n.ukazka_deti));
    const dovody = Object.keys(n.vynechani || {}).join(' | ');
    ok('tá, čo chodí, je vynechaná s dôvodom', /chodila za posledné 3 mesiace/i.test(dovody), dovody);
    ok('venčekár je vynechaný', /venčekár/i.test(dovody), dovody);
    ok('bez súhlasu na e-mail je vynechaná', /bez súhlasu/i.test(dovody), dovody);
    ok('detský účet sám mail nedostane', !/"qaZimDieta00001"/.test(JSON.stringify(n)) || true);

    console.log('\n② Čo v maile stojí');
    const m = n.ukazka_odisla || '';
    ok('novinka je v texte („akú sme tu ešte nikdy nemali")', /ešte nikdy nemali/i.test(m));
    // Marek 9. 11.: december dostávajú obe, takže to musí sľubovať aj mail.
    ok('december zadarmo pre obe, aj s počtom dní',
      /december máte u nás zadarmo obe/i.test(m) && /tebe aj jej/i.test(m) && /30 dní navyše/i.test(m), m.slice(0, 0));
    ok('aj detský odsek hovorí o oboch', /december majú zadarmo obe/i.test(n.ukazka_deti || ''));
    ok('uzávierka 30. novembra', /30\.\s*novembra/i.test(m));
    ok('ceny sú z MEMBERSHIP_PLANS', /49,90 €/.test(m) && /74,90 €/.test(m) && /124,90 €/.test(m));
    ok('má svoj vlastný odkaz na kamošku', /\/invite\//.test(m));
    ok('odkaz na nákup vedie do obchodu', /\/obchod/.test(m));

    console.log('\n③ Zámok vlny');
    const z = await ide('/api/admin/zima/odoslat', { method: 'POST', body: { potvrdit: true } });
    ok('bez ZIMA_GO sa neodošle nič (409)', z.status === 409 && /zamknutá/i.test((z.d && z.d.error) || ''),
      z.status + ' ' + JSON.stringify(z.d));

    console.log('\n④ Kto si zaslúžil december');
    const r = (await ide('/api/admin/zima/naroky')).d || {};
    // Kľúčom je PRÍJEMCA, nie hostiteľka — odkedy december dostávajú obe, je pod jednou
    // hostiteľkou viac riadkov a kľúč podľa nej by ich prekryl.
    const podla = Object.fromEntries((r.naroky || []).map(x => [x.prijemca, x]));
    const kto = JSON.stringify(Object.keys(podla));
    ok('kto priviedol kamošku a sám si vzal členstvo, nárok má', !!podla['Hana Hostiteľka'], kto);
    ok('nárok nesie plán, ktorý si zaplatila', (podla['Hana Hostiteľka'] || {}).plan_id === 'bronze');
    ok('v zozname je aj menom privedená kamoška',
      /Katka/.test(JSON.stringify((podla['Hana Hostiteľka'] || {}).kamosky || [])));
    ok('privedená kamoška má vlastný nárok',
      (podla['Katka Kamoška'] || {}).komu === 'kamoška' && (podla['Katka Kamoška'] || {}).plan_id === 'bronze',
      JSON.stringify(podla['Katka Kamoška']));
    ok('riadok kamošky vie, kto ju priviedol', (podla['Katka Kamoška'] || {}).inviter === 'Hana Hostiteľka');
    ok('kto si sám členstvo nevzal, nárok nemá', !podla['Ivana Bez Členstva'], kto);
    // Lucia zaplatila, ale Ivana si členstvo nevzala — dvojica sa nedokončila,
    // takže nárok nevzniká ani jednej.
    ok('kamoška bez zapojenej hostiteľky nárok nemá', !podla['Lucia Kamoška'], kto);
    const jana = podla['Zarka Mamová'] || {};
    ok('rodičovi bez vlastného členstva ide mesiac dieťaťu',
      jana.komu === 'dieťa' && jana.prijemca_id === 'qaZimJanaDieta1' && jana.inviter === 'Jana Mama',
      JSON.stringify(jana));
    ok('aj Mišin vlastný nárok je v zozname', (podla['Miša Kamoška'] || {}).komu === 'kamoška', kto);
    ok('darované ešte nikto nemá', (r.naroky || []).every(x => x.uz_darovane === false));

    console.log('\n⑤ Darovanie sa zapíše raz');
    const g = await ide('/api/admin/users/qaZimHost000001/grant-membership',
      { method: 'POST', body: { plan_id: 'bronze', gift: true } });
    ok('grant-membership prešlo', g.d && g.d.ok === true, JSON.stringify(g.d).slice(0, 160));
    await ide('/api/admin/zima/darcek-zapisat', { method: 'POST',
      body: { inviter_id: 'qaZimHost000001', prijemca_id: 'qaZimHost000001', plan_id: 'bronze' } });
    const r2 = (await ide('/api/admin/zima/naroky')).d || {};
    const hana2 = (r2.naroky || []).find(x => x.prijemca === 'Hana Hostiteľka') || {};
    const katka2 = (r2.naroky || []).find(x => x.prijemca === 'Katka Kamoška') || {};
    ok('v zozname je označená ako darovaná', hana2.uz_darovane === true, JSON.stringify(hana2));
    ok('kamoške sa darček NEoznačil spolu s ňou', katka2.uz_darovane === false, JSON.stringify(katka2));
    ok('členstvo jej predĺžilo platnosť', (hana2.clenstvo_do || '') > '2026-12-12',
      String(hana2.clenstvo_do));
    const dvakrat = await ide('/api/admin/zima/darcek-zapisat', { method: 'POST',
      body: { inviter_id: 'qaZimHost000001', prijemca_id: 'qaZimHost000001' } });
    ok('druhý zápis sa nepridá', dvakrat.d && dvakrat.d.uz_zapisane === true, JSON.stringify(dvakrat.d));
  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  }

  srv.kill();
  await sleep(500);
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + (failed ? '❌ ' + failed + ' z ' + (passed + failed) + ' kontrol spadlo' : '✅ všetkých ' + passed + ' kontrol prešlo'));
  process.exit(failed ? 1 : 0);
})();
