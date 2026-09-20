/**
 * „Nájdi votrelca“ — šiesty typ denného hlavolamu (Marek 20. 9. 2026).
 * Päť kôl, v každom štyri slová. Tri patria k sebe, jedno tam nepatrí — a to sa
 * klikne. Po odovzdaní sa ukáže, aká bola kategória a prečo votrelec nepatril.
 *
 * Prečo práve toto: doterajšie hry sú logika (Spoj čísla), slovná zásoba
 * (Osemsmerovka, Poskladaj slovo), sluch (Poznáš rytmus?) a vedomosti (Kvíz).
 * Chýbal typ, kde sa hľadá SÚVISLOSŤ medzi vecami — to je iná zručnosť a dá sa
 * zvládnuť za minútu aj na mobile v šatni.
 *
 * Anti-cheat (dôležité po septembri 2026): klientovi ide iba štvorica slov.
 * Ktoré je votrelec, vie len server — v odpovedi z /api/puzzle/today nie je ani
 * kategória, ani poradie. Bez hrania sa správna odpoveď z Network panela vyčítať
 * nedá, rovnako ako pri kvíze a rytme.
 */

const BANKA = require('./puzzle-votrelec.json');

const KOL = 5;                    // päť kôl ako rytmus aj kvíz
const NA_KOLO = 4;                // štyri slová v kole: 3 z kategórie + 1 votrelec
const Z_KATEGORIE = NA_KOLO - 1;

// Použiteľná téma musí mať dosť členov na trojicu a aspoň jedného votrelca.
const TEMY = (BANKA.temy || []).filter(t => t && Array.isArray(t.s) && t.s.length >= Z_KATEGORIE
  && Array.isArray(t.v) && t.v.length);
const PODLA_ID = {};
for (const t of TEMY) PODLA_ID[t.id] = t;

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
 * Zostaví hru z piatich tém. Z každej vyberie tri slová kategórie a jedného
 * votrelca a zamieša ich — votrelec teda nie je vždy na tom istom mieste.
 */
function build(rnd, ids) {
  const temy = (Array.isArray(ids) && ids.length === KOL ? ids.map(id => PODLA_ID[id]) : [])
    .filter(Boolean);
  const vybrane = temy.length === KOL ? temy : zamiesaj(TEMY, rnd).slice(0, KOL);
  const kola = [], answers = [], meta = [];
  vybrane.forEach((t, i) => {
    const trojica = zamiesaj(t.s, rnd).slice(0, Z_KATEGORIE);
    const votrelec = t.v[Math.floor(rnd() * t.v.length) % t.v.length];
    const slova = zamiesaj(trojica.concat(votrelec.s), rnd);
    kola.push({ i, slova });
    answers.push(slova.indexOf(votrelec.s));
    meta.push({ kategoria: t.k, votrelec: votrelec.s, preco: votrelec.p, patria: trojica });
  });
  return { pocet: KOL, kola, _answers: answers, _meta: meta, _ids: vybrane.map(t => t.id) };
}

/** Na nový deň päť tém, ktoré ešte neboli (alebo najdlhšie neboli). */
function vyberTemy(rnd, pouzite) {
  const kedy = id => (pouzite && pouzite.get(id)) || '';
  const poradie = zamiesaj(TEMY, rnd)
    .map(t => ({ id: t.id, kedy: kedy(t.id) }))
    .sort((a, b) => a.kedy < b.kedy ? -1 : a.kedy > b.kedy ? 1 : 0);   // najdlhšie nehrané najprv
  return poradie.slice(0, KOL).map(x => x.id);
}

/** Odpoveď je index votrelca v kole (0–3). Hra je vyriešená po odovzdaní všetkých kôl. */
function validate(puzzle, answers) {
  const spravne = puzzle._answers || [];
  if (!Array.isArray(answers)) return 'Chýbajú odpovede.';
  if (answers.length !== spravne.length) return 'Označ votrelca vo všetkých ' + spravne.length + ' kolách.';
  for (const a of answers) {
    if (!Number.isInteger(a) || a < 0 || a >= NA_KOLO) return 'Neplatná odpoveď.';
  }
  return null;   // ako pri rytme a kvíze: odovzdať sa dá aj s chybami, bodujú sa trafené
}

/** Koľko votrelcov sedelo — podľa toho sa počítajú body. */
function score(puzzle, answers) {
  const spravne = puzzle._answers || [];
  const trafene = spravne.map((k, i) => (answers || [])[i] === k);
  const pocet = trafene.filter(Boolean).length;
  return { spravne: pocet, celkom: spravne.length, perfect: pocet === spravne.length, trafene };
}

/** Po odovzdaní ukážeme kategóriu aj dôvod — nech sa hráčka niečo dozvie. */
function reveal(puzzle, answers) {
  const moje = Array.isArray(answers) ? answers : null;
  return (puzzle._meta || []).map((m, i) => {
    const kolo = (puzzle.kola || [])[i] || {};
    const mojTip = moje && Number.isInteger(moje[i]) ? (kolo.slova || [])[moje[i]] : null;
    return {
      kategoria: m.kategoria, votrelec: m.votrelec, preco: m.preco, patria: m.patria,
      ...(moje ? { trafene: (puzzle._answers || [])[i] === moje[i], moj_tip: mojTip || null } : {}),
    };
  });
}

module.exports = { build, vyberTemy, validate, score, reveal, KOL, NA_KOLO, TEMY };
