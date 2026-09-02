/**
 * Deň v týždni sa nesmie rozísť s dátumom (2. 9. 2026).
 *
 * V pozvánke na Latin Tropical Party bolo „piatok 5. 9.", hoci to bola sobota —
 * odišlo to 350 ľuďom. V tom istom súbore bolo aj „nedeľa 31. 8.", pričom to
 * bol pondelok. Deň bol písaný ručne vedľa dátumu a nič ho nekontrolovalo.
 *
 * Tento test prechádza server.js a pri každom „<deň> <dátum>" overí, či deň
 * naozaj sedí. Beží bez servera — je to čistá kontrola textu.
 *
 * Spustenie:  node qa/dni-datumy.test.js
 */
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

const DNI = ['nedeľa', 'pondelok', 'utorok', 'streda', 'štvrtok', 'piatok', 'sobota'];
// tvary, ktoré sa v textoch reálne vyskytujú (aj „v sobotu", „do nedele")
const TVARY = {
  'nedeľa': 0, 'nedeľu': 0, 'nedele': 0, 'nedeli': 0,
  'pondelok': 1, 'pondelka': 1, 'pondelkom': 1,
  'utorok': 2, 'utorka': 2,
  'streda': 3, 'stredu': 3, 'stredy': 3,
  'štvrtok': 4, 'štvrtka': 4,
  'piatok': 5, 'piatka': 5,
  'sobota': 6, 'sobotu': 6, 'soboty': 6,
};
const MESIACE = ['januára','februára','marca','apríla','mája','júna','júla','augusta','septembra','októbra','novembra','decembra'];

const ROK_DEFAULT = 2026;
const subory = ['server.js', 'coach.js', 'event-tickets.js', 'school-outreach.js']
  .map(f => path.join(__dirname, '..', f)).filter(f => fs.existsSync(f));

console.log('DEŇ vs DÁTUM — kontrola textov\n');
let najdenych = 0, zlych = 0;
const chyby = [];

for (const subor of subory) {
  const riadky = fs.readFileSync(subor, 'utf8').split('\n');
  riadky.forEach((r, i) => {
    // „sobota 5. 9. 2026", „v sobotu 5. 9.", „piatok 5. septembra"
    const re = new RegExp('(' + Object.keys(TVARY).join('|') + ')\s+(?:<b>)?(\d{1,2})\.\s*(?:(\d{1,2})\.|(' + MESIACE.join('|') + '))(?:\s*(\d{4}))?', 'gi');
    let m;
    while ((m = re.exec(r)) !== null) {
      const tvar = m[1].toLowerCase();
      const den = +m[2];
      const mes = m[3] ? +m[3] : (MESIACE.indexOf(String(m[4]).toLowerCase()) + 1);
      const rok = m[5] ? +m[5] : ROK_DEFAULT;
      if (!mes || !den) continue;
      najdenych++;
      const d = new Date(rok + '-' + String(mes).padStart(2, '0') + '-' + String(den).padStart(2, '0') + 'T12:00:00');
      if (isNaN(d)) continue;
      const skutocny = d.getDay();
      if (skutocny !== TVARY[tvar]) {
        zlych++;
        chyby.push(path.basename(subor) + ':' + (i + 1) + ' — píše „' + tvar + '" k ' + den + '. ' + mes + '. ' + rok
          + ', pritom je ' + DNI[skutocny].toUpperCase());
      }
    }
  });
}

console.log('Prehľadaných súborov: ' + subory.length + ' · nájdených dvojíc deň+dátum: ' + najdenych + '\n');
chyby.forEach(c => console.log('  ' + c));
if (chyby.length) console.log('');

ok('každý deň v týždni sedí so svojím dátumom', zlych === 0, zlych + ' nesedí');

// Že kontrola nič nenašla, môže znamenať aj to, že regex nefunguje. Overíme ho
// na presne tej vete, ktorá 2. 9. odišla 350 ľuďom — tú musí zachytiť.
const skuska = (text) => {
  const re = new RegExp('(' + Object.keys(TVARY).join('|') + ')\\s+(?:<b>)?(\\d{1,2})\\.\\s*(?:(\\d{1,2})\\.|(' + MESIACE.join('|') + '))(?:\\s*(\\d{4}))?', 'gi');
  const m = re.exec(text);
  if (!m) return null;
  const mes = m[3] ? +m[3] : (MESIACE.indexOf(String(m[4]).toLowerCase()) + 1);
  const d = new Date((m[5] ? +m[5] : ROK_DEFAULT) + '-' + String(mes).padStart(2, '0') + '-' + String(+m[2]).padStart(2, '0') + 'T12:00:00');
  return { tvar: m[1].toLowerCase(), sedi: d.getDay() === TVARY[m[1].toLowerCase()] };
};
const zlaVeta = skuska('V piatok 5. 9. 2026 tancujeme');
ok('kontrola by pôvodnú chybu zachytila', zlaVeta && zlaVeta.sedi === false, JSON.stringify(zlaVeta));
const dobraVeta = skuska('V sobotu 5. 9. 2026 tancujeme');
ok('a správnu vetu prepustí', dobraVeta && dobraVeta.sedi === true, JSON.stringify(dobraVeta));
const slovny = skuska('nedeľa 31. augusta');
ok('rozumie aj slovnému mesiacu', slovny && slovny.sedi === false, JSON.stringify(slovny));

// Poistka: helper v server.js musí existovať a rátať správne.
const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
ok('server.js má pomôcku denADatum', /function denADatum\(/.test(s));
ok('a používa sa v textoch', (s.match(/denADatum\(/g) || []).length >= 4,
  (s.match(/denADatum\(/g) || []).length + '×');

console.log('\nDNI vs DÁTUMY: ' + passed + ' OK / ' + failed + ' chýb');
process.exit(failed ? 1 : 0);
