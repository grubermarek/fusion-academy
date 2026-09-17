/**
 * „Poznáš rytmus?" — tretí typ denného hlavolamu.
 * Zaznie krátka ukážka skladby a hráčka háda, na ktorý tanec je. Päť kôl.
 *
 * Od 17. 9. 2026 je v katalógu 73 skladieb (Marek: „71 skladieb môžeš pripraviť";
 * nové ukážky majú 20 s). Nové dni vyberá `vyberNove` — každá skladba zaznie raz,
 * kým sa nevystriedajú všetky, takže sa nič neopakuje ~15 kôl rytmu.
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

// Dni pred 17. 9. sa hrali z pôvodných 11 skladieb pôvodným algoritmom (`build`).
// Aby sa dalo presne dopočítať, čo vtedy zaznelo, `build` pracuje len s nimi.
const POVODNE = new Set(['r01', 'r02', 'r03', 'r04', 'r05', 'r06', 'r07', 'r08', 'r09', 'r10', 'r11']);
const podlaTanca = {};
for (const s of KATALOG.filter(x => POVODNE.has(x.id))) (podlaTanca[s.tanec] = podlaTanca[s.tanec] || []).push(s);

/**
 * Zostaví dennú hádanku. `rnd` je seedovaný generátor, takže rovnaký deň dá
 * rovnakých päť ukážok na každom zariadení a časy sú porovnateľné.
 */
function build(rnd, posledne) {
  // posledne: Map id skladby → dátum, kedy naposledy zaznela (od 17. 9. 2026).
  // Skladby sa opakovali, lebo každý deň sa ťahalo náhodne z celého katalógu.
  // Teraz sa z každého tanca berú najprv tie, ktoré najdlhšie nehrali.
  const kedy = id => (posledne && posledne.get(id)) || '';
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
    let zoznam = volne.length ? volne : podlaTanca[t.key];
    const najstarsia = zoznam.reduce((m, x) => (m === null || kedy(x.id) < m ? kedy(x.id) : m), null);
    zoznam = zoznam.filter(x => kedy(x.id) === najstarsia);   // bez histórie ostane celý zoznam
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
 * Výber piatich skladieb na nový deň. `posledne` = Map id → dátum, kedy skladba
 * naposledy zaznela; `n` = koľký deň rytmu to je.
 *
 * Sáls je v katalógu väčšina (50 zo 73). Keby sa bralo len podľa veku, ostatné
 * tance by sa minuli v prvých dňoch a potom by išlo päť sáls za sebou. Preto má
 * každý deň kvótu: striedavo 1 a 2 skladby z ostatných tancov (každá iný tanec),
 * zvyšok salsa. Oba koše majú vlastné poradie „najdlhšie nehrané" — žiadna
 * skladba sa nezopakuje, kým sa nevystriedajú ostatné (~14 dní rytmu).
 */
function vyberNove(rnd, posledne, n) {
  const kedy = id => (posledne && posledne.get(id)) || '';
  const pocty = KATALOG.reduce((m, s) => (m[s.tanec] = (m[s.tanec] || 0) + 1, m), {});
  const hlavny = Object.keys(pocty).sort((a, b) => pocty[b] - pocty[a])[0];
  const vybrane = [];
  const vezmi = (zdroj, kolko, pestro) => {
    for (let i = 0; i < kolko; i++) {
      const zvysne = zdroj.filter(s => !vybrane.includes(s));
      if (!zvysne.length) return;
      const najstarsi = zvysne.reduce((m, s) => (m === null || kedy(s.id) < m ? kedy(s.id) : m), null);
      let pool = zvysne.filter(s => kedy(s.id) === najstarsi);
      if (pestro) {
        const dnes = new Set(vybrane.map(s => s.tanec));
        const iny = pool.filter(s => !dnes.has(s.tanec));
        if (iny.length) pool = iny;
        else {                                       // v najstaršom koši je už len rovnaký tanec — skús mladší kôš
          const inyVsade = zvysne.filter(s => !dnes.has(s.tanec));
          if (inyVsade.length) {
            const n2 = inyVsade.reduce((m, s) => (m === null || kedy(s.id) < m ? kedy(s.id) : m), null);
            pool = inyVsade.filter(s => kedy(s.id) === n2);
          }
        }
      }
      vybrane.push(pool[Math.floor(rnd() * pool.length) % pool.length]);
    }
  };
  const ostatne = KATALOG.filter(s => s.tanec !== hlavny);
  const kvota = ostatne.length ? ((+n || 0) % 2 === 0 ? 2 : 1) : 0;
  vezmi(ostatne, kvota, true);
  vezmi(KATALOG.filter(s => s.tanec === hlavny), KOL - vybrane.length, false);
  vezmi(KATALOG, KOL - vybrane.length, false);           // poistka pri malom katalógu
  for (let i = vybrane.length - 1; i > 0; i--) {             // poradie kôl zamiešame
    const j = Math.floor(rnd() * (i + 1));
    [vybrane[i], vybrane[j]] = [vybrane[j], vybrane[i]];
  }
  return vybrane.map(s => s.id);
}

/** Hádanka z uloženého výberu (settings puzzle_pick_rhythm_<dátum>). */
function zIds(ids) {
  const kola = (ids || []).map(id => KATALOG.find(x => x.id === id)).filter(Boolean);
  const dostupne = TANCE.filter(t => KATALOG.some(s => s.tanec === t.key));
  return {
    rounds: kola.map(s => ({ src: s.subor })),
    options: dostupne.map(t => ({ key: t.key, name: t.name })),
    _answers: kola.map(s => s.tanec),
    _ids: kola.map(s => s.id),
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

module.exports = { build, zIds, vyberNove, validate, score, reveal, kredity, TANCE, KOL, KATALOG, POVODNE };
