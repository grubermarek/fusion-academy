/**
 * Poskladaj slovo — štvrtý typ denného hlavolamu (Marek 31. 8.).
 * Päť rozhádzaných výrazov z tanca, fitnessu a Fusion Academy: A S L S A → SALSA.
 *
 * Slová idú od najkratšieho po najdlhšie, nech sa hra rozbieha zľahka a končí
 * poriadnou výzvou. Rovnako ako v osemsmerovke sú zámerne BEZ diakritiky —
 * hráčka by inak hádala, či písať ROZCVICKA alebo ROZCVIČKA, a to s hrou
 * nesúvisí. Odpovede sa aj tak porovnávajú bez diakritiky, takže keď ju napíše,
 * uznáme to.
 */

// Výrazy sú roztriedené podľa dĺžky, nie podľa témy — dĺžka robí obťažnosť.
// V jednej hre je z každej priehradky práve jeden, takže postup je vždy plynulý.
const SLOVA = {
  5: ['SALSA', 'ZUMBA', 'RUMBA', 'SAMBA', 'TANGO', 'TANEC', 'HUDBA', 'KROKY', 'POHYB', 'TEMPO', 'DETVA', 'VYDRZ'],
  6: ['CUMBIA', 'LATINO', 'RYTMUS', 'RADOST', 'FUSION', 'LEKCIA', 'OTOCKA', 'ZABAVA', 'ZVOLEN', 'PARKET', 'KOSTYM', 'BREZNO'],
  7: ['BACHATA', 'ENERGIA', 'PARTNER', 'TRENING', 'FITNESS', 'ZRKADLO', 'SKUPINA', 'POTLESK', 'KIZOMBA', 'KAMOSKA'],
  8: ['MERENGUE', 'TRENERKA', 'DYCHANIE', 'KONDICIA', 'FLAMENCO', 'CVICENIE', 'HUDOBNIK'],
  9: ['ROZCVICKA', 'REGGAETON', 'TANECNICA', 'PARTNERKA'],
};
const DLZKY = [5, 6, 7, 8, 9];
const POCET = DLZKY.length;

/** Fisher-Yates so seedovaným generátorom — rovnaký deň dá rovnakú hru. */
function zamiesaj(pole, rnd) {
  const a = pole.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Rozhádže písmená tak, aby výsledok nebol náhodou to isté slovo — inak by
 * hráčka videla hotovú odpoveď a hra by stratila zmysel.
 */
function rozhadz(slovo, rnd) {
  const p = slovo.split('');
  for (let pokus = 0; pokus < 12; pokus++) {
    const m = zamiesaj(p, rnd);
    if (m.join('') !== slovo) return m.join('');
  }
  // Slovo z opakovaných písmen (napr. AAA) sa zamiešať nedá — vymeníme dve rôzne.
  const i = p.findIndex((ch, k) => k > 0 && ch !== p[0]);
  if (i > 0) { const m = p.slice(); [m[0], m[i]] = [m[i], m[0]]; return m.join(''); }
  return p.join('');
}

function build(rnd) {
  const vybrane = DLZKY.map(d => {
    const zoznam = SLOVA[d];
    return zoznam[Math.floor(rnd() * zoznam.length)];
  });
  return {
    pocet: POCET,
    slova: vybrane.map((s, i) => ({ i, dlzka: s.length, pismena: rozhadz(s, rnd).split('') })),
    _answers: vybrane,
  };
}

/**
 * Kontroluje formát aj správnosť — hra je vyriešená, až keď sedí všetkých päť.
 * Porovnávame bez ohľadu na veľkosť písmen a medzery; diakritiku hráčka síce
 * písať nemá, ale keď ju napíše, uznáme to tiež.
 */
const norm = s => String(s || '').trim().toUpperCase()
  .normalize('NFD').replace(new RegExp('[\u0300-\u036f]','g'), '')
  .replace(/\s+/g, '');

function validate(puzzle, answers) {
  const spravne = puzzle._answers || [];
  if (!Array.isArray(answers)) return 'Chýbajú odpovede.';
  if (answers.length !== spravne.length) return 'Vyplň všetkých ' + spravne.length + ' slov.';
  for (const a of answers) if (typeof a !== 'string' || a.length > 40) return 'Neplatná odpoveď.';
  const zle = spravne.reduce((n, s, i) => n + (norm(answers[i]) === s ? 0 : 1), 0);
  if (zle) return zle === 1 ? 'Jedno slovo ešte nesedí.' : zle + ' slová ešte nesedia.';
  return null;
}

/** Koľko z piatich sedelo — pre priebežnú nápovedu, ktoré políčko je zelené. */
function score(puzzle, answers) {
  const spravne = puzzle._answers || [];
  const trafene = spravne.map((s, i) => norm((answers || [])[i]) === s);
  const pocet = trafene.filter(Boolean).length;
  return { spravne: pocet, celkom: spravne.length, perfect: pocet === spravne.length, trafene };
}

/** Po vyriešení ukážeme celý zoznam — nech si hráčka pozrie, čo jej robilo problém. */
function reveal(puzzle, answers) {
  const moje = Array.isArray(answers) ? answers : null;
  return (puzzle._answers || []).map((s, i) => ({
    slovo: s,
    pismena: ((puzzle.slova || [])[i] || {}).pismena || [],
    ...(moje ? { trafene: norm(moje[i]) === s, moj_tip: String(moje[i] || '').trim() } : {}),
  }));
}

module.exports = { build, validate, score, reveal, SLOVA, DLZKY, POCET, norm };
