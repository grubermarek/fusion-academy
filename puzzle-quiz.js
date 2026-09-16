/**
 * „Denný kvíz" — piaty typ denného hlavolamu (Marek 16. 9. 2026).
 * Päť otázok so štyrmi možnosťami, jedna správna. Jeden pokus, bod za každú
 * správnu odpoveď a +5 pre najrýchlejšiu, ktorá má všetkých päť — rovnako ako rytmus.
 *
 * Marek chcel, aby sa ľudia pri hre aj niečo naučili: najviac otázok je
 * o výžive a stravovaní, potom o pohybe a tele, o tanci a hudbe, o svete
 * a pár aj o Fusion Academy. Každý kvíz preto skladáme z pevných „slotov",
 * nie náhodne z celej banky — inak by vyšlo päť otázok o geografii.
 *
 * Otázky sa NEOPAKUJÚ: server si pri prvom otvorení kvízu uloží, ktoré otázky
 * dostal daný deň (settings puzzle_pick_quiz_<dátum>), a ďalší kvíz berie len
 * z nepoužitých. Banka vydrží roky; keď sa minie, vracia sa k najdávnejším.
 *
 * Banka je v puzzle-quiz-otazky.json. Správna odpoveď je v súbore vždy PRVÁ —
 * poradie možností mieša server a klient správnu odpoveď nedostane skôr,
 * než kvíz odovzdá.
 */

const OTAZKY = require('./puzzle-quiz-otazky.json');

const KOL = 5;
const PISMENA = ['a', 'b', 'c', 'd'];

// Skupiny otázok a čo v nich je (pole „g" v banke).
const SKUPINY = {
  vyziva: 'Výživa a stravovanie',
  pohyb: 'Pohyb a telo',
  tanec: 'Tanec a hudba',
  svet: 'Svet okolo nás',
  fusion: 'Fusion Academy',
};

const podlaId = new Map(OTAZKY.map(o => [o.id, o]));

/**
 * Z čoho sa skladá kvíz poradového čísla `n` (0 = prvý kvíz vôbec).
 * Výživa je v každom kvíze, v každom druhom dokonca dvakrát — Marek chcel
 * „veľa otázok o výžive". V ostatných je namiesto druhej otázka o nás.
 */
function sloty(n) {
  return ['vyziva', 'pohyb', 'tanec', 'svet', n % 2 === 0 ? 'fusion' : 'vyziva'];
}

/**
 * Vyberie päť id otázok. `pouzite` je Map id → dátum posledného použitia.
 * Z každej skupiny berie najprv nepoužité; keď sa skupina minie, vezme
 * skupinu s najväčšou zásobou; keď sa minie všetko, najdávnejšie použité.
 */
function vyber(rnd, pouzite, n) {
  const vybrane = [];
  const volne = o => !pouzite.has(o.id) && !vybrane.includes(o.id);
  const zasoba = g => OTAZKY.filter(o => o.g === g && volne(o)).length;
  const nahodne = pole => pole[Math.floor(rnd() * pole.length) % pole.length];
  for (let slot of sloty(n)) {
    if (!zasoba(slot)) {
      const najviac = Object.keys(SKUPINY).sort((a, b) => zasoba(b) - zasoba(a))[0];
      if (zasoba(najviac)) slot = najviac;
    }
    let kandidati = OTAZKY.filter(o => o.g === slot && volne(o));
    if (!kandidati.length) {
      // všetko je už použité → najdávnejšie použité (najprv z vlastnej skupiny)
      const zvysne = OTAZKY.filter(o => !vybrane.includes(o.id));
      const zoSkupiny = zvysne.filter(o => o.g === slot);
      const zdroj = zoSkupiny.length ? zoSkupiny : zvysne;
      const najstarsi = zdroj.reduce((m, o) => {
        const d = pouzite.get(o.id) || '';
        return m === null || d < m ? d : m;
      }, null);
      kandidati = zdroj.filter(o => (pouzite.get(o.id) || '') === najstarsi);
    }
    if (kandidati.length) vybrane.push(nahodne(kandidati).id);
  }
  // poradie otázok zamiešame, nech výživa nie je vždy prvá
  for (let i = vybrane.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [vybrane[i], vybrane[j]] = [vybrane[j], vybrane[i]];
  }
  return vybrane;
}

/** Zostaví kvíz z vybraných id. Možnosti mieša seedovaný `rnd`. */
function build(rnd, ids) {
  const otazky = [], spravne = [];
  for (const id of ids) {
    const o = podlaId.get(id);
    if (!o) continue;
    const poradie = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [poradie[i], poradie[j]] = [poradie[j], poradie[i]]; }
    otazky.push({
      q: o.q, kat: SKUPINY[o.g] || '',
      moznosti: poradie.map((p, i) => ({ k: PISMENA[i], t: o.a[p] })),
    });
    spravne.push(PISMENA[poradie.indexOf(0)]);
  }
  return { otazky, pocet: otazky.length, _answers: spravne, _ids: ids.filter(id => podlaId.has(id)) };
}

/** Kontrola formátu — zlá odpoveď nie je chyba, len jej chýba bod. */
function validate(puzzle, answers) {
  if (!Array.isArray(answers)) return 'Chýbajú odpovede.';
  const n = (puzzle._answers || []).length;
  if (answers.length !== n) return 'Odpovedz na všetkých ' + n + ' otázok.';
  for (const a of answers) if (!PISMENA.includes(a)) return 'Neplatná odpoveď.';
  return null;
}

function score(puzzle, answers) {
  const spravne = puzzle._answers || [];
  const trafene = spravne.map((k, i) => (answers || [])[i] === k);
  const pocet = trafene.filter(Boolean).length;
  return { spravne: pocet, celkom: spravne.length, perfect: pocet === spravne.length, trafene };
}

/** Po odovzdaní: správna odpoveď a krátke vysvetlenie — pointa celej hry. */
function reveal(puzzle, answers) {
  const moje = Array.isArray(answers) ? answers : null;
  return (puzzle._answers || []).map((k, i) => {
    const o = podlaId.get((puzzle._ids || [])[i]) || {};
    const ot = (puzzle.otazky || [])[i] || { moznosti: [] };
    const tip = moje ? moje[i] : null;
    const tipText = tip ? ((ot.moznosti.find(m => m.k === tip) || {}).t || null) : null;
    return {
      key: k, spravna: o.a ? o.a[0] : '', vysvetlenie: o.v || '',
      ...(moje ? { trafene: tip === k, moj: tip, moj_tip: tipText } : {}),
    };
  });
}

module.exports = { build, vyber, validate, score, reveal, sloty, SKUPINY, KOL, OTAZKY };
