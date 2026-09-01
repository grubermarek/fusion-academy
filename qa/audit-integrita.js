/**
 * AUDIT E1 — integrita dát. Číta LEN snapshot, nikdy nesiaha na produkciu.
 *
 * Snapshot: GET /api/admin/db-backup?token=BACKUP_TOKEN → .json.gz
 * Spustenie: node qa/audit-integrita.js <cesta-k-snapshotu.json.gz>
 *
 * Snapshot obsahuje osobné údaje klientok — drž ho mimo repozitára (ten je
 * verejný). Skript sám žiadne dáta neukladá, len ich sumarizuje na výstup.
 */
const fs = require('fs');
const zlib = require('zlib');

const CESTA = process.argv[2];
if (!CESTA || !fs.existsSync(CESTA)) {
  console.error('Použitie: node qa/audit-integrita.js <snapshot.json.gz>');
  process.exit(1);
}

const D = JSON.parse(zlib.gunzipSync(fs.readFileSync(CESTA)).toString());
const T = n => Array.isArray(D[n]) ? D[n] : [];

let nalezov = 0;
const sekcia = t => console.log('\n══ ' + t + ' ' + '═'.repeat(Math.max(0, 62 - t.length)));
function nalez(zavaznost, popis, ukazky) {
  nalezov++;
  console.log('  ' + (zavaznost === 'HIGH' ? '🔴' : zavaznost === 'MED' ? '🟠' : '🟡') + ' ' + popis);
  for (const u of (ukazky || []).slice(0, 6)) console.log('       ' + u);
  if ((ukazky || []).length > 6) console.log('       … a ďalších ' + (ukazky.length - 6));
}
const cisto = t => console.log('  ✅ ' + t);

// ── prehľad ────────────────────────────────────────────────────────────────
console.log('SNAPSHOT z ' + (D._at || '?'));
const velke = Object.keys(D).filter(k => Array.isArray(D[k]) && D[k].length)
  .sort((a, b) => D[b].length - D[a].length);
console.log('kolekcií: ' + Object.keys(D).filter(k => Array.isArray(D[k])).length
  + ' | neprázdnych: ' + velke.length + ' | záznamov spolu: '
  + velke.reduce((s, k) => s + D[k].length, 0));
console.log('najväčšie: ' + velke.slice(0, 8).map(k => k + '=' + D[k].length).join(', '));

const users = T('users');
const uById = Object.fromEntries(users.map(u => [u._id, u]));
const uByMail = {}; for (const u of users) if (u.email) uByMail[String(u.email).toLowerCase()] = u;
const meno = id => (uById[id]?.name) || ('neznámy(' + String(id).slice(0, 8) + ')');
const jeTest = u => !u ? false : (/test/i.test(u.name || '') || /@test-fa-qa\.local$|@qa-biz\.local$/i.test(u.email || '') || u.is_test);
const testIds = new Set(users.filter(jeTest).map(u => u._id));

// ── 1. DUPLICITY ───────────────────────────────────────────────────────────
sekcia('DUPLICITY');

const cisla = {};
for (const i of T('invoices')) (cisla[String(i.number)] = cisla[String(i.number)] || []).push(i);
const dupFa = Object.entries(cisla).filter(([, v]) => v.length > 1);
if (dupFa.length) nalez('HIGH', 'Duplicitné čísla faktúr: ' + dupFa.length,
  dupFa.map(([n, v]) => n + ' → ' + v.length + '× (' + v.map(x => meno(x.user_id)).join(', ') + ')'));
else cisto('čísla faktúr sú jedinečné (' + T('invoices').length + ' faktúr)');

const blizko = (a, b) => Math.abs(new Date(a) - new Date(b)) < 60000;
const dupPay = [];
const podlaOsoby = {};
for (const p of T('payments')) (podlaOsoby[p.user_id] = podlaOsoby[p.user_id] || []).push(p);
for (const [uid, zoz] of Object.entries(podlaOsoby)) {
  for (let i = 0; i < zoz.length; i++) for (let j = i + 1; j < zoz.length; j++) {
    const a = zoz[i], b = zoz[j];
    if (+a.amount === +b.amount && +a.amount > 0 && blizko(a.created_at || a.date, b.created_at || b.date))
      dupPay.push(meno(uid) + ' — ' + a.amount + ' € 2× do minúty (' + String(a.created_at || '').slice(0, 16) + ')');
  }
}
if (dupPay.length) nalez('HIGH', 'Možné duplicitné platby: ' + dupPay.length, dupPay);
else cisto('žiadne dve rovnaké platby do minúty');

const dupObj = [];
const objPodlaMailu = {};
for (const o of T('orders')) (objPodlaMailu[String(o.client_email).toLowerCase()] = objPodlaMailu[String(o.client_email).toLowerCase()] || []).push(o);
for (const [mail, zoz] of Object.entries(objPodlaMailu)) {
  for (let i = 0; i < zoz.length; i++) for (let j = i + 1; j < zoz.length; j++) {
    const a = zoz[i], b = zoz[j];
    if (+a.total === +b.total && blizko(a.created_at, b.created_at))
      dupObj.push(mail + ' — ' + a.total + ' € (' + a.order_number + ' / ' + b.order_number + ')');
  }
}
if (dupObj.length) nalez('HIGH', 'Možné duplicitné objednávky: ' + dupObj.length, dupObj);
else cisto('žiadne dve rovnaké objednávky do minúty');

const prekryv = [];
const memPodla = {};
for (const m of T('memberships')) { if (m._type) continue; (memPodla[m.user_id] = memPodla[m.user_id] || []).push(m); }
for (const [uid, zoz] of Object.entries(memPodla)) {
  const akt = zoz.filter(m => m.status === 'active');
  for (let i = 0; i < akt.length; i++) for (let j = i + 1; j < akt.length; j++) {
    const a = akt[i], b = akt[j];
    const zac = x => String(x.started_at || x.created_at || '').slice(0, 10);
    const kon = x => String(x.expires_at || '9999').slice(0, 10);
    if (zac(a) <= kon(b) && zac(b) <= kon(a))
      prekryv.push(meno(uid) + ': ' + a.plan_id + ' (' + zac(a) + '–' + kon(a) + ') × ' + b.plan_id + ' (' + zac(b) + '–' + kon(b) + ')');
  }
}
if (prekryv.length) nalez('MED', 'Prekrývajúce sa aktívne členstvá: ' + prekryv.length, prekryv);
else cisto('žiadne prekrývajúce sa aktívne členstvá');

const kluc = b => b.user_id + '|' + b.class_id + '|' + b.booking_date;
const bk = {};
for (const b of T('bookings')) { if (b.status === 'cancelled') continue; (bk[kluc(b)] = bk[kluc(b)] || []).push(b); }
const dupBk = Object.entries(bk).filter(([, v]) => v.length > 1);
if (dupBk.length) nalez('MED', 'Dvojité rezervácie na tú istú hodinu: ' + dupBk.length,
  dupBk.map(([k, v]) => meno(k.split('|')[0]) + ' — ' + k.split('|')[2] + ' (' + v.length + '×)'));
else cisto('žiadne dvojité rezervácie');

// ── 2. SIROTY ──────────────────────────────────────────────────────────────
sekcia('SIROTY (záznam bez protistrany)');

const sirotyPay = T('payments').filter(p => p.user_id && !uById[p.user_id]);
if (sirotyPay.length) nalez('HIGH', 'Platby bez existujúceho používateľa: ' + sirotyPay.length,
  sirotyPay.map(p => (p.amount || '?') + ' € · ' + String(p.created_at || '').slice(0, 10) + ' · uid=' + p.user_id));
else cisto('každá platba má existujúceho používateľa');

const sirotyFa = T('invoices').filter(i => i.user_id && !uById[i.user_id]);
if (sirotyFa.length) nalez('HIGH', 'Faktúry bez existujúceho používateľa: ' + sirotyFa.length,
  sirotyFa.map(i => i.number + ' · ' + (i.total || '?') + ' € · ' + (i.client_name || '')));
else cisto('každá faktúra má existujúceho používateľa');

const objBezUcty = T('orders').filter(o => o.client_email && !uByMail[String(o.client_email).toLowerCase()]);
if (objBezUcty.length) nalez('MED', 'Objednávky, ktorých e-mail nesedí so žiadnym účtom: ' + objBezUcty.length + ' (POTENTIAL ISSUE #6)',
  objBezUcty.map(o => o.order_number + ' · ' + o.client_email + ' · ' + (o.total || 0) + ' € · ' + o.status));
else cisto('každá objednávka sa dá priradiť k účtu');

const clsIds = new Set(T('classes').map(c => c._id));
const bkBezHod = T('bookings').filter(b => b.class_id && !clsIds.has(b.class_id));
if (bkBezHod.length) nalez('MED', 'Rezervácie na neexistujúcu hodinu: ' + bkBezHod.length,
  bkBezHod.slice(0, 6).map(b => meno(b.user_id) + ' · ' + b.booking_date + ' · ' + (b.class_name || b.class_id)));
else cisto('každá rezervácia má existujúcu hodinu');

// ── 3. NEKONZISTENTNÉ STAVY ────────────────────────────────────────────────
sekcia('NEKONZISTENTNÉ STAVY');

const dnes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
const expAkt = T('memberships').filter(m => !m._type && m.status === 'active' && m.expires_at && String(m.expires_at).slice(0, 10) < dnes);
if (expAkt.length) nalez('MED', 'Členstvá označené „active", ktoré už vypršali: ' + expAkt.length,
  expAkt.map(m => meno(m.user_id) + ' · ' + m.plan_id + ' · do ' + String(m.expires_at).slice(0, 10)));
else cisto('žiadne aktívne členstvo nie je po expirácii');

const zrusenePrisla = T('bookings').filter(b => b.status === 'cancelled' && b.attendance_status === 'attended');
if (zrusenePrisla.length) nalez('MED', 'Zrušené rezervácie označené ako „prišla": ' + zrusenePrisla.length,
  zrusenePrisla.map(b => meno(b.user_id) + ' · ' + b.booking_date));
else cisto('žiadna zrušená rezervácia nie je označená ako navštívená');

const paidBezDatumu = T('orders').filter(o => o.status === 'paid' && !o.paid_at);
if (paidBezDatumu.length) nalez('MED', 'Zaplatené objednávky bez dátumu platby: ' + paidBezDatumu.length,
  paidBezDatumu.map(o => o.order_number + ' · ' + (o.total || 0) + ' € · vytvorená ' + String(o.created_at || '').slice(0, 10)));
else cisto('každá zaplatená objednávka má dátum platby');

const nulovePlatby = T('payments').filter(p => ['completed', 'active'].includes(p.status) && !(+p.amount > 0));
if (nulovePlatby.length) nalez('LOW', 'Dokončené platby s nulovou/zápornou sumou: ' + nulovePlatby.length,
  nulovePlatby.map(p => meno(p.user_id) + ' · ' + (p.amount ?? 'null') + ' € · ' + (p.plan_id || p.type || '')));
else cisto('žiadna dokončená platba nemá nulu');

const vybrateAjNaMieste = T('bookings').filter(b => b.entry_collected && b.pay_on_site === true);
if (vybrateAjNaMieste.length) nalez('LOW', 'Rezervácie „vybrané" aj „platí na mieste" naraz: ' + vybrateAjNaMieste.length,
  vybrateAjNaMieste.map(b => meno(b.user_id) + ' · ' + b.booking_date));
else cisto('výber hotovosti a „platí na mieste" sa nikde neprekrývajú');

// ── 4. HODNOTY ─────────────────────────────────────────────────────────────
sekcia('HODNOTY');

const zaporne = [];
for (const [kol, pole] of [['payments', 'amount'], ['orders', 'total'], ['transactions', 'amount'], ['invoices', 'total']])
  for (const x of T(kol)) if (typeof x[pole] !== 'undefined' && +x[pole] < 0)
    zaporne.push(kol + ' · ' + (x.order_number || x.number || x._id) + ' · ' + x[pole] + ' €');
if (zaporne.length) nalez('LOW', 'Záporné sumy (môžu byť legitímne dobropisy): ' + zaporne.length, zaporne);
else cisto('žiadne záporné sumy');

const nanky = [];
for (const [kol, pole] of [['payments', 'amount'], ['orders', 'total'], ['transactions', 'amount'], ['invoices', 'total']])
  for (const x of T(kol)) if (x[pole] !== undefined && x[pole] !== null && isNaN(+x[pole]))
    nanky.push(kol + ' · ' + (x.order_number || x.number || x._id) + ' · „' + x[pole] + '"');
if (nanky.length) nalez('HIGH', 'Sumy, ktoré nie sú číslo: ' + nanky.length, nanky);
else cisto('všetky sumy sú čísla');

const zleDatumy = [];
for (const kol of ['payments', 'orders', 'invoices', 'transactions', 'bookings'])
  for (const x of T(kol)) {
    const d = String(x.created_at || x.date || x.booking_date || '').slice(0, 10);
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && (d < '2024-01-01' || d > '2030-12-31'))
      zleDatumy.push(kol + ' · ' + (x.order_number || x.number || x._id) + ' · ' + d);
  }
if (zleDatumy.length) nalez('MED', 'Nezmyselné dátumy: ' + zleDatumy.length, zleDatumy);
else cisto('všetky dátumy sú v rozumnom rozsahu');

const faSucty = T('invoices').filter(i => Array.isArray(i.items) && i.items.length).filter(i => {
  const s = i.items.reduce((a, it) => a + (+it.total || (+it.price || 0) * (+it.qty || 1)), 0);
  return Math.abs(s - (+i.total || 0)) > 0.02;
});
if (faSucty.length) nalez('HIGH', 'Faktúry, kde súčet položiek ≠ celková suma: ' + faSucty.length,
  faSucty.map(i => i.number + ' · položky ' + i.items.reduce((a, it) => a + (+it.total || 0), 0).toFixed(2) + ' € vs total ' + i.total + ' €'));
else cisto('súčty položiek na faktúrach sedia');

// ── 5. KRÍŽOVÉ KONTROLY ────────────────────────────────────────────────────
sekcia('KRÍŽOVÉ KONTROLY');

const ledgerPodla = {};
for (const l of T('credit_ledger')) ledgerPodla[l.user_id] = (ledgerPodla[l.user_id] || 0) + (+l.delta || 0);
const kreditNesedi = users.filter(u => {
  const l = +(ledgerPodla[u._id] || 0), k = +(u.referral_credit || 0);
  return (l || k) && Math.abs(l - k) > 0.02;
});
if (kreditNesedi.length) nalez('HIGH', 'Kredit na účte ≠ súčet histórie: ' + kreditNesedi.length,
  kreditNesedi.map(u => u.name + ' · účet ' + (+u.referral_credit || 0).toFixed(2) + ' € vs história ' + (ledgerPodla[u._id] || 0).toFixed(2) + ' €'));
else cisto('kredit na účte sedí s históriou');

const zaporVstupy = users.filter(u => (+u.single_entries || 0) < 0);
if (zaporVstupy.length) nalez('HIGH', 'Záporný počet vstupov: ' + zaporVstupy.length,
  zaporVstupy.map(u => u.name + ' · ' + u.single_entries));
else cisto('nikto nemá záporné vstupy');

// dochádzka: dve polia vs visit_count (POTENTIAL ISSUE #5)
const podlaStatus = {}, podlaAttStatus = {};
for (const b of T('bookings')) {
  if (b.status === 'attended') podlaStatus[b.user_id] = (podlaStatus[b.user_id] || 0) + 1;
  if (b.attendance_status === 'attended') podlaAttStatus[b.user_id] = (podlaAttStatus[b.user_id] || 0) + 1;
}
const rozdiel = users.filter(u => !testIds.has(u._id))
  .map(u => ({ u, s: podlaStatus[u._id] || 0, a: podlaAttStatus[u._id] || 0, v: +u.visit_count || 0 }))
  .filter(x => x.s || x.a || x.v)
  .filter(x => !(x.s === x.a && x.a === x.v));
if (rozdiel.length) nalez('HIGH', 'Dochádzka sa nezhoduje medzi tromi zdrojmi: ' + rozdiel.length + ' klientok (POTENTIAL ISSUE #5)',
  rozdiel.sort((p, q) => Math.abs(q.v - q.a) - Math.abs(p.v - p.a))
    .map(x => x.u.name + ' · status=' + x.s + ' attendance_status=' + x.a + ' visit_count=' + x.v));
else cisto('dochádzka sedí vo všetkých troch zdrojoch');

// no_show sa ráta ako odchodená hodina?
const noShow = T('bookings').filter(b => b.attendance_status === 'no_show' && b.status === 'confirmed');
if (noShow.length) nalez('MED', '„Neprišla" so stavom confirmed — do súťaže sa ráta ako odchodená: ' + noShow.length,
  Object.entries(noShow.reduce((m, b) => { m[b.user_id] = (m[b.user_id] || 0) + 1; return m; }, {}))
    .sort((a, b) => b[1] - a[1]).map(([id, n]) => meno(id) + ' · ' + n + '×'));
else cisto('žiadna neúčasť sa neráta ako hodina');

// transakcie bez dátumu, ale s mesiacom (POTENTIAL ISSUE #8)
const bezDatumu = T('transactions').filter(t => t.month && !t.date && !t.created_at);
if (bezDatumu.length) nalez('MED', 'Transakcie len s „month", bez dátumu — do súťaže sa nerátajú: ' + bezDatumu.length + ' (POTENTIAL ISSUE #8)',
  bezDatumu.map(t => meno(t.user_id) + ' · ' + t.month + ' · ' + (t.amount || 0) + ' € · ' + (t.type || '')));
else cisto('každá transakcia má dátum');

// ── 6. ZHRNUTIE ────────────────────────────────────────────────────────────
sekcia('ZHRNUTIE');
console.log('  nálezov: ' + nalezov);
console.log('  (nález ≠ potvrdená chyba — každý treba overiť podľa plánu §9)');
