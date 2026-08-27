/**
 * Osemsmerovka — druhý typ denného hlavolamu.
 * Mriežka písmen, v nej ukryté tanečné slová v 8 smeroch (aj pozpiatku).
 *
 * Slová sú zámerne BEZ diakritiky — na mriežke sa Ľ/Š/Č zle čítajú a hráčka
 * by nevedela, či hľadá RADOST alebo RADOSŤ.
 */
const WORDS = [
  'SALSA', 'ZUMBA', 'BACHATA', 'MERENGUE', 'TANEC', 'RYTMUS', 'HUDBA', 'PARKET',
  'KROKY', 'POHYB', 'RADOST', 'ENERGIA', 'PARTNER', 'CHACHA', 'RUMBA', 'SAMBA',
  'TANGO', 'VALCIK', 'LATINO', 'FITNESS', 'TRENING', 'LEKCIA', 'OTOCKA', 'BOKY',
  'USMEV', 'POTLESK', 'KOSTYM', 'ZRKADLO', 'SALA', 'TRENERKA', 'KAMOSKA',
  'VIKEND', 'VECER', 'PIATOK', 'DETVA', 'ZVOLEN', 'BREZNO', 'FUSION', 'KONDICIA',
  'VYDRZ', 'TEMPO', 'SKUPINA', 'ZABAVA', 'DYCHANIE', 'ROZCVICKA', 'CHOREO',
];
const ABC = 'ABCDEFGHIJKLMNOPRSTUVZ';           // bez Q, W, X, Y — v SK slovách zriedkavé
const SIZE = 11;
const WORD_COUNT = 10;
const DIRS = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]];

function build(rnd) {
  // výber slov na daný deň — kratšie sa umiestňujú ľahšie, tak ich mixujeme
  const pool = WORDS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const grid = Array.from({ length: SIZE }, () => new Array(SIZE).fill(''));
  const placed = [];

  const fits = (w, r, c, [dr, dc]) => {
    const cells = [];
    for (let i = 0; i < w.length; i++) {
      const rr = r + dr * i, cc = c + dc * i;
      if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE) return null;
      const cur = grid[rr][cc];
      if (cur && cur !== w[i]) return null;          // krížiť sa smie len na zhodnom písmene
      cells.push(rr * SIZE + cc);
    }
    return cells;
  };

  for (const w of pool) {
    if (placed.length >= WORD_COUNT) break;
    if (w.length > SIZE) continue;
    const tries = [];
    for (let t = 0; t < 220; t++) {
      const dir = DIRS[Math.floor(rnd() * DIRS.length)];
      const r = Math.floor(rnd() * SIZE), c = Math.floor(rnd() * SIZE);
      const cells = fits(w, r, c, dir);
      if (cells) { tries.push(cells); break; }
    }
    if (!tries.length) continue;
    const cells = tries[0];
    cells.forEach((cellIdx, i) => { grid[Math.floor(cellIdx / SIZE)][cellIdx % SIZE] = w[i]; });
    placed.push({ word: w, cells });
  }

  // zvyšok mriežky doplníme náhodnými písmenami
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!grid[r][c]) grid[r][c] = ABC[Math.floor(rnd() * ABC.length)];
    }
  }

  return {
    size: SIZE,
    grid: grid.map(row => row.join('')),
    words: placed.map(p => p.word).sort(),
    _placed: placed,                                  // riešenie – klientovi sa neposiela
  };
}

/**
 * Overenie: klient pošle { word, cells } za každé nájdené slovo.
 * Uznáme aj opačný smer ťahu — hráčka nemusí trafiť, kde slovo „začína".
 */
function validate(puzzle, found) {
  if (!Array.isArray(found)) return 'Chýbajú nájdené slová.';
  const need = new Set(puzzle.words);
  for (const f of found) {
    if (!f || typeof f.word !== 'string' || !Array.isArray(f.cells)) return 'Neplatný formát odpovede.';
    const w = f.word.toUpperCase();
    const real = puzzle._placed.find(p => p.word === w);
    if (!real) return 'Slovo „' + w + '" v tejto osemsmerovke nie je.';
    const a = f.cells.join(','), b = real.cells.join(','), rev = real.cells.slice().reverse().join(',');
    if (a !== b && a !== rev) return 'Slovo „' + w + '" nie je označené správne.';
    need.delete(w);
  }
  if (need.size) return 'Ešte ti chýba ' + need.size + ' ' + (need.size === 1 ? 'slovo' : need.size <= 4 ? 'slová' : 'slov') + '.';
  return null;
}

module.exports = { build, validate, SIZE, WORD_COUNT };
