/**
 * Tematický deň v dennom hlavolame (4. 9. 2026).
 *
 * V deň akcie má hlavolam aj pripomenúť, kam sa má večer prísť: mriežka obsahuje
 * len slová z akcie a nad ňou je pruh s termínom, miestom a odkazom na vstupenku.
 * Prvý tematický deň je Latin Tropical Party 5. 9.
 *
 * Stráži, že:
 *   · tematická sada sa do mriežky dostane CELÁ (zoznam slov je sám o sebe odkaz)
 *   · slová sú bez diakritiky a vojdú sa do mriežky (inak by ich generátor zahodil)
 *   · bežný deň ostáva nedotknutý — pôvodná zásoba slov a žiadny pruh
 *   · fakty v pruhu sedia s eventom (čas, miesto, ceny) a odkaz vedie na vstupenky
 *   · hlavolam.html pruh naozaj vykresľuje
 *
 * Spustenie:  node qa/hlavolam-tema.test.js
 */
const fs = require('fs');
const path = require('path');
const WORDS = require('../puzzle-words');

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

// rovnaký seedovaný generátor ako v puzzle.js — hádanka musí byť pre všetkých rovnaká
function seedFromString(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const src = fs.readFileSync(path.join(__dirname, '..', 'puzzle.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hlavolam.html'), 'utf8');

// THEMES sa dá prečítať priamo zo zdroja — modul potrebuje bežiacu appku
const blok = src.slice(src.indexOf('const THEMES = {'), src.indexOf('function themeFor'));
const DATUM = '2026-09-05';

console.log('TEMATICKÝ HLAVOLAM QA\n');
console.log('Definícia témy:');
ok('téma na ' + DATUM + ' existuje', blok.includes("'" + DATUM + "'"), blok.slice(0, 80));
ok('je to osemsmerovka', /type:\s*'words'/.test(blok));
const slova = (blok.match(/slova:\s*\[([\s\S]*?)\]/) || [])[1] || '';
const SADA = slova.split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
ok('sada má aspoň 10 slov', SADA.length >= 10, 'n=' + SADA.length);
ok('slová sú bez diakritiky (na mriežke sa Š/Č/Ľ nedajú prečítať)',
  SADA.every(w => /^[A-Z]+$/.test(w)), SADA.filter(w => !/^[A-Z]+$/.test(w)).join(', '));
ok('žiadne slovo nie je dlhšie ako mriežka (' + WORDS.SIZE + ')',
  SADA.every(w => w.length <= WORDS.SIZE), SADA.filter(w => w.length > WORDS.SIZE).join(', '));
ok('slová sú z akcie, nie náhodné', ['PARTY', 'DETVA', 'VECER'].every(w => SADA.includes(w)), SADA.join(','));

console.log('\nMriežka na ' + DATUM + ':');
const p = WORDS.build(mulberry32(seedFromString('fusion-words-' + DATUM)), SADA);
ok('do mriežky sa dostali VŠETKY slová sady', p.words.length === SADA.length,
  p.words.length + '/' + SADA.length + ', chýba: ' + SADA.filter(w => !p.words.includes(w)).join(', '));
ok('a nič navyše (žiadne slovo z bežnej zásoby)', p.words.every(w => SADA.includes(w)),
  p.words.filter(w => !SADA.includes(w)).join(', '));
ok('každé slovo sa v mriežke naozaj nachádza', p._placed.every(x => {
  const txt = x.cells.map(c => p.grid[Math.floor(c / WORDS.SIZE)][c % WORDS.SIZE]).join('');
  return txt === x.word;
}));
ok('hádanka je pre všetkých rovnaká (rovnaký seed = rovnaká mriežka)',
  WORDS.build(mulberry32(seedFromString('fusion-words-' + DATUM)), SADA).grid.join('') === p.grid.join(''));

console.log('\nBežný deň ostáva nedotknutý:');
const bezny = WORDS.build(mulberry32(seedFromString('fusion-words-2026-09-04')));
ok('bez témy sa berie pôvodná zásoba slov', bezny.words.length === WORDS.WORD_COUNT, 'n=' + bezny.words.length);
ok('a nie sú to slová z akcie', !bezny.words.every(w => SADA.includes(w)));
// v bloku THEMES musí byť práve jeden pruh na jeden dátum — inak by sa akcia
// pripomínala aj v deň, keď sa nič nekoná
ok('každý tematický deň má práve jeden pruh',
  (blok.match(/banner:/g) || []).length === (blok.match(/'20\d\d-\d\d-\d\d':\s*\{/g) || []).length,
  'pruhov=' + (blok.match(/banner:/g) || []).length + ', dní=' + (blok.match(/'20\d\d-\d\d-\d\d':\s*\{/g) || []).length);
ok('bežné dni tému nemajú', !/'2026-09-04'|'2026-09-06'/.test(blok));

console.log('\nFakty v pruhu (musia sedieť s eventom):');
ok('čas 21:00', /21:00/.test(blok));
ok('miesto Fusion Club Detva, Záhradná 7', /Fusion Club Detva/.test(blok) && /Záhradná 7/.test(blok));
ok('vstup online 5 € a na mieste 10 €', /5 €/.test(blok) && /10 €/.test(blok));
ok('predpredaj končí 20:59 (po ňom platí cena na mieste)', /20:59/.test(blok));
ok('odkaz vedie na event s vlastným utm', /\/event\/latin-tropical-2026\?/.test(blok) && /utm_medium=hlavolam/.test(blok));
ok('v pruhu nie je vymyslený deň v týždni', !/piatok|streda|utorok|nedeľa/i.test(blok));

console.log('\nVykreslenie v appke:');
ok('hlavolam.html pruh vykresľuje', /P\.banner/.test(html));
ok('má vlastné štýly pre obe témy', /\.evb\{/.test(html) && /data-theme="aurora"\] \.evb/.test(html));
ok('tlačidlo vedie na adresu z pruhu', /href="\$\{P\.banner\.url\}"/.test(html));
ok('bez pruhu sa nič nevykreslí (bežný deň)', /P\.banner \?/.test(html));

console.log('\nTEMATICKÝ HLAVOLAM: ' + passed + ' OK / ' + failed + ' chýb');
process.exit(failed ? 1 : 0);
