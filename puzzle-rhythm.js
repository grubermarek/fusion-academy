/**
 * „Poznáš rytmus?" — tretí typ denného hlavolamu.
 * Zaznie minútová ukážka skladby a hráčka háda, na ktorý tanec je. Päť kôl.
 *
 * Prečo práve toto: obe doterajšie hry sú logické hádanky bez väzby na tanec.
 * Rozoznať, na čo sa dá tancovať čo, je zručnosť, s ktorou začiatočníčky reálne
 * bojujú — hra ich teda popri zábave učí niečo, čo využijú na parkete.
 *
 * Hudba (30. 8. 2026): prvá verzia skladala rytmus syntetickými údermi cez
 * Web Audio. Marek ako lektor hneď povedal, že to nesedí — a mal pravdu:
 * postavil som vzorce na KROKOCH tanečníka (bachata 1-2-3-tap), lenže to nie je
 * to, čo hrá hudba. Znelo to ako metronóm, nie ako bachata. Teraz sa preto
 * púšťajú skutočné nahrávky z Pixabay (Content License: komerčné použitie
 * povolené, atribúcia nevyžadovaná — aj tak autorov uvádzame).
 *
 * Anti-cheat: súbory sa volajú r01.mp3 … r11.mp3 a mapovanie na tanec je LEN
 * tu na serveri. Keby sa volali salsa-1.mp3, stačilo by otvoriť Network panel.
 */

const KATALOG = require('./puzzle-rhythm-katalog.json');

const KOL = 5;

const TANCE = [
  { key: 'salsa', name: 'Salsa', tip: 'Rýchla, plná dychov a klavíra — a stále počuť clave.' },
  { key: 'bachata', name: 'Bachata', tip: 'Pomalšia, vedie ju gitara a na štvorku počuť „pop".' },
  { key: 'merengue', name: 'Merengue', tip: 'Najrýchlejšia a rovnomerná — pochodový pulz bez synkopy.' },
  { key: 'chacha', name: 'Cha-cha-chá', tip: 'Stredné tempo a v ňom počuť tri rýchle kroky za sebou.' },
];

const podlaTanca = {};
for (const s of KATALOG) (podlaTanca[s.tanec] = podlaTanca[s.tanec] || []).push(s);

/**
 * Zostaví dennú hádanku. `rnd` je seedovaný generátor, takže rovnaký deň dá
 * rovnakých päť ukážok na každom zariadení a časy sú porovnateľné.
 */
function build(rnd) {
  const dostupne = TANCE.filter(t => (podlaTanca[t.key] || []).length);
  const zamiesaj = pole => {                       // Fisher-Yates so seedovaným rnd
    const p = pole.slice();
    for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    return p;
  };
  // Najprv každý tanec raz (v náhodnom poradí), až potom sa smie niektorý zopakovať.
  // Bez toho vyšlo pri jednom seede merengue 3× z 5 a hra strácala zmysel.
  const poradie = zamiesaj(dostupne);
  while (poradie.length < KOL) {
    const zvysne = zamiesaj(dostupne).filter(t => t.key !== poradie[poradie.length - 1].key);
    poradie.push(zvysne[0] || dostupne[0]);
  }
  const kola = [];
  const pouziteSkladby = new Set();
  for (let i = 0; i < KOL; i++) {
    const t = poradie[i];
    // Tú istú nahrávku nedávame v jednom dni dvakrát — hráčka by ju spoznala
    // podľa melódie, nie podľa rytmu, a druhé kolo by bolo zadarmo.
    const volne = podlaTanca[t.key].filter(x => !pouziteSkladby.has(x.id));
    const zoznam = volne.length ? volne : podlaTanca[t.key];
    const s = zoznam[Math.floor(rnd() * zoznam.length) % zoznam.length];
    pouziteSkladby.add(s.id);
    kola.push({ src: s.subor, _key: t.key, _id: s.id });
  }
  return {
    rounds: kola.map(k => ({ src: k.src })),
    options: dostupne.map(t => ({ key: t.key, name: t.name })),
    _answers: kola.map(k => k._key),
    _ids: kola.map(k => k._id),
  };
}

/**
 * Kontrola FORMÁTU (beží na serveri). Na rozdiel od ostatných dvoch hier tu
 * zlý tip nie je chyba — odpoveď sa prijme a obodujú sa správne kusy.
 * Marek 30. 8.: „jedna možnosť odovzdať, bod za každú správnu".
 */
function validate(puzzle, answers) {
  if (!Array.isArray(answers)) return 'Chýbajú odpovede.';
  const spravne = puzzle._answers || [];
  if (answers.length !== spravne.length) return 'Odpovedz na všetkých ' + spravne.length + ' ukážok.';
  const platne = new Set(TANCE.map(t => t.key));
  for (const a of answers) if (!platne.has(a)) return 'Neplatná odpoveď.';
  return null;
}

/** Koľko z piatich sedelo. Vyhodnotenie patrí na server, klient dostane len počet. */
function score(puzzle, answers) {
  const spravne = puzzle._answers || [];
  const trafene = spravne.map((k, i) => (answers || [])[i] === k);
  const pocet = trafene.filter(Boolean).length;
  return { spravne: pocet, celkom: spravne.length, perfect: pocet === spravne.length, trafene };
}

/** Po vyriešení ukážeme, čo bolo čo, aj s autorom — nech sa hráčka niečo naučí. */
function reveal(puzzle, answers) {
  const moje = Array.isArray(answers) ? answers : null;
  return (puzzle._answers || []).map((k, i) => {
    const t = TANCE.find(x => x.key === k) || {};
    const s = KATALOG.find(x => x.id === (puzzle._ids || [])[i]) || {};
    const tip = moje ? moje[i] : null;
    const tipT = tip ? (TANCE.find(x => x.key === tip) || {}) : null;
    return { key: k, name: t.name || k, tip: t.tip || '', skladba: s.nazov || '', autor: s.autor || '',
      ...(moje ? { trafene: tip === k, moj_tip: tipT ? tipT.name : null } : {}) };
  });
}

/** Zoznam skladieb aj s autormi — pre stránku s poďakovaním. */
function kredity() {
  return KATALOG.map(s => ({ nazov: s.nazov, autor: s.autor, odkaz: s.odkaz }));
}

module.exports = { build, validate, score, reveal, kredity, TANCE, KOL, KATALOG };
