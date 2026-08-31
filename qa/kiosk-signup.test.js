/**
 * Kiosk: prihlásenie na dnešné tréningy cez checkboxy (Marek 30. 8. 2026).
 * Sken QR → zoznam dnešných hodín → zaškrtnutie → prihlásenie.
 *
 * Najcitlivejšie je strhávanie vstupov: každá hodina stojí jeden, takže sa musí
 * najprv overiť krytie na VŠETKY vybrané a až potom zapisovať. Inak by prvé dve
 * prešli a tretia spadla s prázdnym kontom.
 *
 * Spustenie:  node qa/kiosk-signup.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4518;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-ks-'));

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

(async () => {
  const DNES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const DOW = new Date().getDay();
  const hash = bcrypt.hashSync('Heslo123!', 10);

  const U = (id, meno, kod, extra = {}) => JSON.stringify({
    _id: id, name: meno, email: id.toLowerCase() + '@qa-biz.local', password: hash, referral_code: kod,
    user_type: 'client', active: true, is_admin: false, visit_count: 2, created_at: '2026-07-01',
    city: 'Detva', account_creation_type: 'self_registration', free_class_used: true,
    free_credits: 0, single_entries: 0, ...extra,
  });
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaKsAdmin0000001', name: 'Adam Kioskovy', email: 'qa.ks.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-06-01' }),
    U('qaKsClenka00001', 'Klara Clenka', 'QAKS01'),                       // členstvo → všetko zdarma
    U('qaKsDvaVstupy01', 'Dana Dvojvstup', 'QAKS02', { single_entries: 2 }),
    U('qaKsBezNicoho01', 'Bara Prazdna', 'QAKS03'),                       // nič nemá
    U('qaKsPrvaZdarma1', 'Petra Prva', 'QAKS04', { free_class_used: false }),
  ].join('\n') + '\n');

  fs.writeFileSync(path.join(DATA, 'memberships.db'), JSON.stringify({
    _id: 'qaKsMem00000001', user_id: 'qaKsClenka00001', plan_id: 'silver', status: 'active',
    started_at: '2026-08-01', expires_at: '2026-12-31', price: 69,
  }) + '\n');

  // Tri dnešné hodiny v Detve + technika (kiosk ju nesmie ponúkať) + iné mesto
  const C = (id, meno, start, end, extra = {}) => JSON.stringify({
    _id: id, name: meno, emoji: '🎵', category: 'Zumba', instructor: 'Marek Gruber',
    location: 'Detva', address: 'Záhradná 7, Detva', day_of_week: DOW,
    time_start: start, time_end: end, capacity: 30, level: 'Všetky úrovne',
    description: '', price: 10, color: '#C9A84C', active: true, ...extra,
  });
  // Časy odvodíme od aktuálnej hodiny, nech test nezávisí od toho, kedy beží:
  // hodina po konci sa (správne) neponúka, takže pevné 08:00 by popoludní zmizlo.
  const teraz = new Date();
  const nowMin = teraz.getHours() * 60 + teraz.getMinutes();
  const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const NESKORO = nowMin + 200 > 23 * 60 + 30;     // po ~20:10 by hodiny pretiekli cez polnoc
  const t1 = Math.max(0, nowMin - 10), t2 = nowMin + 60, t3 = nowMin + 130;
  fs.writeFileSync(path.join(DATA, 'classes.db'), [
    C('qaKsCls00000001', 'Zumba prvá', hhmm(t1), hhmm(t1 + 55)),      // práve beží
    C('qaKsCls00000002', 'Zumba druhá', hhmm(t2), hhmm(t2 + 55)),
    C('qaKsCls00000003', 'Zumba tretia', hhmm(t3), hhmm(t3 + 55)),
    C('qaKsClsTech0001', 'Technický tréning', hhmm(t2), hhmm(t2 + 55), { category: 'Technika' }),
    C('qaKsClsOnline01', 'Zumba ONLINE', hhmm(t2), hhmm(t2 + 55), { category: 'Online', location: 'Online' }),
    C('qaKsClsZvolen01', 'Zumba Zvolen', hhmm(t2), hhmm(t2 + 55), { location: 'Zvolen' }),
  ].join('\n') + '\n');

  console.log('KIOSK PRIHLÁSENIE QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_OFF: '1' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol do 180 s'); process.exit(1); }

  try {
    const adm = {};
    await j('/api/login', { method: 'POST', body: { email: 'qa.ks.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    const kcfg = await j('/api/admin/kiosk', {}, adm);
    const detva = ((kcfg.d && kcfg.d.studios) || []).find(x => /detva/i.test(x.slug + ' ' + x.city));
    ok('kiosk Detva existuje', !!detva, JSON.stringify((kcfg.d && kcfg.d.studios || []).map(x => x.slug)));
    if (!detva) throw new Error('bez kiosku sa ďalej nedá');
    await j('/api/admin/kiosk/' + detva.slug, { method: 'PUT', body: { enabled: true } }, adm);
    const K = detva.token, ST = detva.slug;

    const zoznam = (qr) => j('/api/kiosk/day-classes', { method: 'POST', body: { studio: ST, k: K, qr_data: qr } });
    const prihlas = (qr, ids) => j('/api/kiosk/signup', { method: 'POST', body: { studio: ST, k: K, qr_data: qr, class_ids: ids } });

    // ── zoznam hodín ──
    const z = await zoznam('FA:qaKsClenka00001');
    ok('zoznam sa načíta po QR', z.status === 200 && z.d && z.d.ok, JSON.stringify(z.d).slice(0, 140));
    const mena = (z.d.classes || []).map(c => c.name);
    ok('ponúka dnešné hodiny v Detve', mena.includes('Zumba prvá'), JSON.stringify(mena));
    ok('bežiaca hodina je označená ako „teraz"',
      (z.d.classes || []).some(c => c.name === 'Zumba prvá' && c.teraz), JSON.stringify((z.d.classes || []).map(c => c.name + ':' + c.teraz)));
    ok('NEponúka techniku (má vlastný cenník)', !mena.includes('Technický tréning'), JSON.stringify(mena));
    ok('NEponúka online hodinu', !mena.some(m => /ONLINE/i.test(m)), JSON.stringify(mena));
    ok('NEponúka hodinu z iného mesta', !mena.includes('Zumba Zvolen'), JSON.stringify(mena));
    ok('pri každej hodine je čas aj voľné miesta',
      (z.d.classes || []).every(c => c.time_start && typeof c.volnych === 'number'), JSON.stringify(z.d.classes[0]));
    ok('členke povie, že má členstvo', z.d.krytie && z.d.krytie.clenstvo === true, JSON.stringify(z.d.krytie));

    const zlyQr = await zoznam('FA:neexistuje');
    ok('neznámy QR je odmietnutý', zlyQr.status === 404, JSON.stringify(zlyQr.d));
    const bezKluca = await j('/api/kiosk/day-classes', { method: 'POST', body: { studio: ST, k: 'zly', qr_data: 'FA:qaKsClenka00001' } });
    ok('bez platného kľúča kiosku to nejde', bezKluca.status === 403, String(bezKluca.status));

    // ── členka: viac hodín naraz, nič sa nestrháva ──
    const vsetky = (z.d.classes || []).map(c => c.id);
    const p1 = await prihlas('FA:qaKsClenka00001', vsetky);
    ok('členka sa prihlási na všetky naraz', p1.status === 200 && p1.d.ok, JSON.stringify(p1.d).slice(0, 140));
    ok('zapísali sa všetky vybrané', (p1.d.zapisane || []).length === vsetky.length, String((p1.d.zapisane || []).length));
    ok('členke neubudli vstupy', p1.d.krytie.vstupy === 0 && p1.d.krytie.clenstvo === true, JSON.stringify(p1.d.krytie));

    const z2 = await zoznam('FA:qaKsClenka00001');
    ok('po prihlásení sú hodiny označené ako moje',
      (z2.d.classes || []).every(c => c.moja), JSON.stringify((z2.d.classes || []).map(c => c.name + ':' + c.moja)));
    const p1b = await prihlas('FA:qaKsClenka00001', vsetky);
    ok('opakované prihlásenie nič nezdvojí', (p1b.d.zapisane || []).length === 0 && p1b.d.uz_mala === vsetky.length,
      JSON.stringify({ z: (p1b.d.zapisane || []).length, u: p1b.d.uz_mala }));

    // ── dva vstupy, tri hodiny → musí odmietnuť CELÉ, nie zapísať dve ──
    const zD = await zoznam('FA:qaKsDvaVstupy01');
    const tri = (zD.d.classes || []).slice(0, 3).map(c => c.id);
    if (NESKORO && tri.length < 3) {
      console.log('  ⏭️  neskorá hodina — časť o vstupoch preskočená (hodiny by pretiekli cez polnoc)');
    } else {
    ok('má na výber aspoň tri hodiny', tri.length === 3, String(tri.length));
    const pMalo = await prihlas('FA:qaKsDvaVstupy01', tri);
    ok('tri hodiny s dvoma vstupmi = odmietnuté', pMalo.status === 402, JSON.stringify(pMalo.d).slice(0, 120));
    ok('povie, koľko treba a koľko má', pMalo.d.potrebne === 3 && pMalo.d.mas === 2, JSON.stringify({ p: pMalo.d.potrebne, m: pMalo.d.mas }));
    const zD2 = await zoznam('FA:qaKsDvaVstupy01');
    ok('NIČ sa nezapísalo (žiadna čiastočná rezervácia)',
      (zD2.d.classes || []).every(c => !c.moja), JSON.stringify((zD2.d.classes || []).map(c => c.moja)));
    ok('a nestrhol sa ani jeden vstup', zD2.d.krytie.vstupy === 2, JSON.stringify(zD2.d.krytie));

    // dve hodiny prejdú a strhnú presne dva vstupy
    const pDva = await prihlas('FA:qaKsDvaVstupy01', tri.slice(0, 2));
    ok('dve hodiny s dvoma vstupmi prejdú', pDva.status === 200 && (pDva.d.zapisane || []).length === 2, JSON.stringify(pDva.d).slice(0, 120));
    ok('strhli sa presne dva vstupy', pDva.d.krytie.vstupy === 0, JSON.stringify(pDva.d.krytie));
    }

    // ── prvá hodina zadarmo sa spotrebuje ako prvá ──
    const zP = await zoznam('FA:qaKsPrvaZdarma1');
    ok('vidí, že má prvú zdarma', zP.d.krytie.prva_zdarma === true, JSON.stringify(zP.d.krytie));
    const pP = await prihlas('FA:qaKsPrvaZdarma1', [(zP.d.classes || [])[0].id]);
    ok('prihlásila sa na prvú zdarma', pP.status === 200 && (pP.d.zapisane || []).length === 1);
    ok('prvá zdarma sa spotrebovala', pP.d.krytie.prva_zdarma === false, JSON.stringify(pP.d.krytie));

    // ── bez vstupov ──
    const zB = await zoznam('FA:qaKsBezNicoho01');
    const pB = await prihlas('FA:qaKsBezNicoho01', [(zB.d.classes || [])[0].id]);
    ok('bez vstupov to neprejde', pB.status === 402, JSON.stringify(pB.d).slice(0, 110));
    ok('a hláška posiela za trénerom', /trénerovi/i.test(pB.d.error || ''), pB.d.error);

    // ── ochrany ──
    const pPrazdne = await prihlas('FA:qaKsClenka00001', []);
    ok('prázdny výber je odmietnutý', pPrazdne.status === 400, JSON.stringify(pPrazdne.d));
    const pTech = await prihlas('FA:qaKsPrvaZdarma1', ['qaKsClsTech0001']);
    ok('technika sa cez kiosk prihlásiť nedá', pTech.status === 400, JSON.stringify(pTech.d));
    const pCudzie = await prihlas('FA:qaKsPrvaZdarma1', ['qaKsClsZvolen01']);
    ok('hodina z iného mesta sa prihlásiť nedá', pCudzie.status === 400, JSON.stringify(pCudzie.d));

    // ── stránka kiosku ──
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'kiosk.html'), 'utf8');
    // Dve výzvy na skenovanie vedľa seba mýlili (Marek 31. 8.) — na ploche ostalo
    // jedno tlačidlo a prihlásenie sa ponúka až po check-ine, s už načítaným QR.
    ok('plocha má jedinú výzvu na skenovanie',
      (html.match(/onclick="openScan\(/g) || []).length === 1, html.match(/onclick="openScan\([^)]*\)/g));
    ok('prihlásenie sa ponúkne po check-ine', html.includes('prihlasNaDalsie()') && html.includes('id="wMore"'));
    ok('a QR sa druhýkrát neskenuje', html.includes('poslednyQr=txt') && html.includes('nacitajHodiny(poslednyQr)'));
    ok('výber je cez zaškrtávacie políčka', html.includes('prepniHodinu') && html.includes('class="box"'));
    ok('bežiaca hodina je predznačená', html.includes('c.teraz && !c.moja'));
    ok('pýta sa až po skene QR', html.includes('nacitajHodiny'));
    ok('ukazuje, koľko vstupov zostáva', html.includes('Zostáva ti '));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    console.log('\nKIOSK PRIHLÁSENIE: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
