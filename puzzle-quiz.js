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

/*
 * Otázky o Fusion Academy sa musia meniť spolu s appkou (Marek 17. 9.):
 *  · čísla a názvy (body, dni, percentá, ceny, plány) nie sú v banke napísané
 *    natvrdo — text obsahuje {fakt} alebo {fakt|formát} a hodnota sa berie z tých
 *    istých konštánt, podľa ktorých appka počíta (server.js → faktyKvizu),
 *  · ostatné tvrdenia majú v poli „kontrola" podmienky — hodnotu faktu alebo
 *    reťazec, ktorý musí byť v kóde. Keď podmienka neplatí, otázka sa prestane
 *    vyberať a admin dostane upozornenie, že ju treba prepísať.
 *  · „vyradena": true → otázka sa už nevyberá (id ostáva kvôli uloženým dňom).
 */
const fs = require('fs');
const path = require('path');
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

// ── Šablóny ──────────────────────────────────────────────────────────────────
let FAKTY = {};
function nastavFakty(f) { FAKTY = f || {}; }

const SLOVOM = ['Nula', 'Jeden', 'Dva', 'Tri', 'Štyri', 'Päť', 'Šesť', 'Sedem', 'Osem', 'Deväť', 'Desať'];
const cislo = n => Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace('.', ',');
const tvar = (n, jeden, dva, pat) => n === 1 ? jeden : (n >= 2 && n <= 4 ? dva : pat);
const FORMATY = {
  body: n => cislo(n) + ' ' + tvar(n, 'bod', 'body', 'bodov'),
  dni: n => cislo(n) + ' ' + tvar(n, 'deň', 'dni', 'dní'),
  '%': n => cislo(n) + ' %',
  eur: n => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) + ' €',
  slovom: n => SLOVOM[n] || cislo(n),
};
const ZNACKA = /\{([a-z0-9_]+)(?:\|([^}]+))?\}/g;

// Vyplní {fakt|formát}. Keď fakt chýba, vráti null — otázka sa vtedy nepoužije.
function vypln(text, fakty) {
  let chyba = false;
  const out = String(text).replace(ZNACKA, (_, k, f) => {
    const v = fakty[k];
    if (v === undefined || v === null || v === '') { chyba = true; return ''; }
    if (!f) return typeof v === 'number' ? cislo(v) : String(v);
    if (typeof v !== 'number' || !FORMATY[f]) { chyba = true; return ''; }
    return FORMATY[f](v);
  });
  return chyba ? null : out;
}
const normTxt = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Keď po dosadení vyjde zlá možnosť rovnaká ako správna (napr. appka zmení
// body za hodinu z 5 na 20), nahradíme ju iným číslom v rovnakom tvare.
function nahradna(sablona, fakty, obsadene) {
  const m = String(sablona).match(/\{([a-z0-9_]+)(?:\|([^}]+))?\}/);
  const n = m && fakty[m[1]];
  if (typeof n !== 'number') return null;
  const kandidati = [n * 2, n * 3, n + 10, n * 10, Math.max(1, Math.round(n / 2)), n + 1, n + 25];
  for (const k of kandidati) {
    if (k === n || k <= 0) continue;
    const txt = vypln(sablona, { ...fakty, [m[1]]: k });
    if (txt && !obsadene.has(normTxt(txt))) return txt;
  }
  return null;
}

// Hotový text otázky (q, a, v) podľa aktuálnych faktov, alebo null.
function vyplnOtazku(o, fakty) {
  fakty = fakty || FAKTY;
  const q = vypln(o.q, fakty), v = vypln(o.v, fakty);
  if (q === null || v === null) return null;
  const spravna = vypln(o.a[0], fakty);
  if (spravna === null) return null;
  const a = [spravna];
  const obsadene = new Set([normTxt(spravna)]);
  for (const s of o.a.slice(1)) {
    let t = vypln(s, fakty);
    if (t !== null && obsadene.has(normTxt(t))) t = nahradna(s, fakty, obsadene) || nahradna(o.a[0], fakty, obsadene);
    if (t === null) return null;
    obsadene.add(normTxt(t));
    a.push(t);
  }
  return { q, a, v };
}

// ── Kontroly proti kódu appky ────────────────────────────────────────────────
const KOREN = __dirname;
const suborCache = {};
function citajSubor(rel) {
  if (!(rel in suborCache)) {
    try { suborCache[rel] = fs.readFileSync(path.join(KOREN, rel), 'utf8'); } catch (e) { suborCache[rel] = null; }
  }
  return suborCache[rel];
}
// Vráti zoznam dôvodov, prečo otázka nesedí s appkou (prázdny = sedí).
// Kontroly „web" sa týkajú webu fusionacademy.sk (iný projekt) — overuje ich test, nie server.
function preverOtazku(o, fakty) {
  fakty = fakty || FAKTY;
  const dovody = [];
  for (const k of o.kontrola || []) {
    if (k.f !== undefined) {
      const v = fakty[k.f];
      if ('je' in k && v !== k.je) dovody.push(k.f + ' je ' + JSON.stringify(v) + ', otázka počíta s ' + JSON.stringify(k.je));
      if ('viac' in k && !(typeof v === 'number' && v > k.viac)) dovody.push(k.f + ' je ' + JSON.stringify(v) + ', má byť viac ako ' + k.viac);
    } else if (k.s) {
      const t = citajSubor(k.s);
      if (t === null) { dovody.push('chýba súbor ' + k.s); continue; }
      if (k.obsahuje && !t.includes(k.obsahuje)) dovody.push(k.s + ' už neobsahuje „' + k.obsahuje.slice(0, 80) + '“');
      if (k.regex) {
        const n = (t.match(new RegExp(k.regex, 'g')) || []).length;
        if (k.pocet !== undefined && n !== k.pocet) dovody.push(k.s + ': „' + k.regex + '“ je ' + n + '×, otázka počíta s ' + k.pocet);
      }
    }
  }
  if (!vyplnOtazku(o, fakty)) dovody.push('chýba údaj pre šablónu alebo sa možnosti nedajú odlíšiť');
  return dovody;
}
// Otázka sa smie vybrať do nového kvízu?
const pouzitelna = (o, fakty) => !o.vyradena && !preverOtazku(o, fakty).length;

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
  // otázky o nás, ktoré nesedia s appkou (alebo sú vyradené), sa nevyberajú
  const BANKA = OTAZKY.filter(o => pouzitelna(o));
  const volne = o => !pouzite.has(o.id) && !vybrane.includes(o.id);
  const zasoba = g => BANKA.filter(o => o.g === g && volne(o)).length;
  const nahodne = pole => pole[Math.floor(rnd() * pole.length) % pole.length];
  for (let slot of sloty(n)) {
    if (!zasoba(slot)) {
      const najviac = Object.keys(SKUPINY).sort((a, b) => zasoba(b) - zasoba(a))[0];
      if (zasoba(najviac)) slot = najviac;
    }
    let kandidati = BANKA.filter(o => o.g === slot && volne(o));
    if (!kandidati.length) {
      // všetko je už použité → najdávnejšie použité (najprv z vlastnej skupiny)
      const zvysne = BANKA.filter(o => !vybrane.includes(o.id));
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
  const pouzite = [], texty = [];
  for (const id of ids) {
    const zdroj = podlaId.get(id);
    // Deň už má otázky pevne dané; keď sa medzitým zmenila appka, dosadíme nové čísla.
    // Ak sa otázka nedá vyplniť vôbec, ostane pôvodný text (stáva sa len pri chybe v banke).
    const o = zdroj && (vyplnOtazku(zdroj) || zdroj);
    if (!o) continue;
    const poradie = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [poradie[i], poradie[j]] = [poradie[j], poradie[i]]; }
    otazky.push({
      q: o.q, kat: SKUPINY[zdroj.g] || '',
      moznosti: poradie.map((p, i) => ({ k: PISMENA[i], t: o.a[p] })),
    });
    spravne.push(PISMENA[poradie.indexOf(0)]);
    pouzite.push(id); texty.push(o);
  }
  return { otazky, pocet: otazky.length, _answers: spravne, _ids: pouzite, _texty: texty };
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
    const o = (puzzle._texty || [])[i] || podlaId.get((puzzle._ids || [])[i]) || {};
    const ot = (puzzle.otazky || [])[i] || { moznosti: [] };
    const tip = moje ? moje[i] : null;
    const tipText = tip ? ((ot.moznosti.find(m => m.k === tip) || {}).t || null) : null;
    return {
      key: k, spravna: o.a ? o.a[0] : '', vysvetlenie: o.v || '',
      ...(moje ? { trafene: tip === k, moj: tip, moj_tip: tipText } : {}),
    };
  });
}

module.exports = { build, vyber, validate, score, reveal, sloty, SKUPINY, KOL, OTAZKY,
  nastavFakty, vyplnOtazku, preverOtazku, pouzitelna, vypln };
