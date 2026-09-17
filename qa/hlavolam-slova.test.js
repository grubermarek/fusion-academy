/**
 * Slová v osemsmerovke a v „Poskladaj slovo" sa neopakujú (Marek 17. 9. 2026).
 * Zásoba je v puzzle-slova.json; výber dňa berie najprv slová, ktoré ešte neboli.
 * Test beží bez servera (výber a ukladanie dňa overujú puzzle.test.js a puzzle-anagram.test.js).
 *
 * Spustenie:  node qa/hlavolam-slova.test.js
 */
const path = require('path');
const KOREN = path.join(__dirname, '..');
const W = require(path.join(KOREN, 'puzzle-words.js'));
const A = require(path.join(KOREN, 'puzzle-anagram.js'));
const Z = require(path.join(KOREN, 'puzzle-slova.json'));

let passed = 0, failed = 0;
const ok = (name, cond, note) => { if (cond) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + (note ? ' — ' + note : '')); } };
const mul = a => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const den = i => new Date(Date.UTC(2026, 8, 18) + i * 5 * 86400000).toISOString().slice(0, 10);

console.log('ZÁSOBA SLOV');
const znaky = w => /^[A-PR-VZ]+$/.test(w);
ok('osemsmerovka má aspoň 700 slov', Z.osemsmerovka.length >= 700, String(Z.osemsmerovka.length));
ok('appka ich naozaj používa', W.WORDS.length === Z.osemsmerovka.length);
ok('len písmená bez diakritiky a bez Q/W/X/Y', Z.osemsmerovka.every(znaky), Z.osemsmerovka.filter(w => !znaky(w)).join(','));
ok('dĺžka 4 až 10 písmen (mriežka má 11)', Z.osemsmerovka.every(w => w.length >= 4 && w.length <= 10));
ok('žiadne slovo dvakrát', new Set(Z.osemsmerovka).size === Z.osemsmerovka.length);
ok('Poskladaj slovo má na každú dĺžku aspoň 70 slov', A.DLZKY.every(d => A.SLOVA[d].length >= 70), A.DLZKY.map(d => d + ':' + A.SLOVA[d].length).join(' '));
ok('slová v anagrame majú správnu dĺžku a písmená', A.DLZKY.every(d => A.SLOVA[d].every(w => w.length === d && znaky(w))));
const kluc = w => w.split('').sort().join('');
const vsetkyB = A.DLZKY.flatMap(d => A.SLOVA[d]);
ok('žiadne dve slová v anagrame z rovnakých písmen', new Set(vsetkyB.map(kluc)).size === vsetkyB.length);
ok('vyradené dvojznačné slová v anagrame nie sú', !['TANGO', 'ODMENA', 'LATINO', 'PROSO', 'MAREC', 'POLKA', 'SALSA', 'SPORT'].some(w => vsetkyB.includes(w)));

console.log('\nOSEMSMEROVKA BEZ OPAKOVANIA');
let pouz = new Map(), opak = 0, malo = 0, dni = 0;
const cyklus = Math.floor(W.WORDS.length / W.WORD_COUNT) - 3;
for (let i = 0; i < cyklus; i++) {
  const kandidati = W.vyberSlova(mul(1000 + i), pouz);
  const p = W.build(mul(2000 + i), kandidati, W.WORD_COUNT);
  if (p.words.length < W.WORD_COUNT) malo++;
  for (const w of p.words) { if (pouz.has(w)) opak++; pouz.set(w, den(i)); }
  dni++;
}
ok('počas ' + dni + ' osemsmeroviek sa žiadne slovo nezopakovalo', opak === 0, String(opak));
ok('každá mala plných ' + W.WORD_COUNT + ' slov', malo === 0, malo + ' dní s menej slovami');
ok('kandidáti sú len z nepoužitých, kým nejaké sú', W.vyberSlova(mul(5), pouz).slice(0, 5).every(w => !pouz.has(w)));
const plne = new Map(W.WORDS.map((w, i) => [w, den(i)]));
const poMinuti = W.vyberSlova(mul(9), plne);
ok('po minutí zásoby sa berú najdávnejšie použité', poMinuti.length > W.WORD_COUNT && poMinuti.every(w => plne.get(w) <= den(40)), poMinuti.slice(0, 3).join(','));

console.log('\nPOSKLADAJ SLOVO BEZ OPAKOVANIA');
pouz = new Map(); opak = 0; dni = 0;
const cyklusA = Math.min(...A.DLZKY.map(d => A.SLOVA[d].length));
for (let i = 0; i < cyklusA; i++) {
  const slova = A.vyberSlova(mul(3000 + i), pouz);
  const h = A.build(mul(4000 + i), slova);
  if (JSON.stringify(h._answers) !== JSON.stringify(slova)) opak += 100;
  for (const w of slova) { if (pouz.has(w)) opak++; pouz.set(w, den(i)); }
  dni++;
}
ok('počas ' + dni + ' hier sa žiadne slovo nezopakovalo', opak === 0, String(opak));
const h = A.build(mul(1), A.vyberSlova(mul(2), new Map()));
ok('hra z výberu má 5 slov od najkratšieho', h._answers.length === 5 && h._answers.every((w, i) => w.length === A.DLZKY[i]));
ok('rozhádzané písmená sedia a nie sú hneď slovom', h.slova.every((s, i) => kluc(s.pismena.join('')) === kluc(h._answers[i]) && s.pismena.join('') !== h._answers[i]));

console.log('\nHLAVOLAM: ' + passed + ' OK / ' + failed + ' chýb');
process.exit(failed ? 1 : 0);
