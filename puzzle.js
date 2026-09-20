/**
 * Denný hlavolam — štyri typy, ktoré sa striedajú po dňoch:
 *  · „Cesta" (zip): spoj čísla v poradí a vyplň celú mriežku (tu v súbore),
 *  · „Osemsmerovka" (words): nájdi tanečné slová v mriežke (./puzzle-words.js),
 *  · „Poznáš rytmus?" (rhythm): uhádni tanec podľa rytmu (./puzzle-rhythm.js),
 *  · „Poskladaj slovo" (anagram): poskladaj výraz z rozhádzaných písmen (./puzzle-anagram.js),
 *  · „Denný kvíz" (quiz): päť otázok o výžive, pohybe, tanci, svete a o nás (./puzzle-quiz.js).
 * Poradie určuje settings.puzzle_config.schedule, konkrétny deň sa dá prebiť
 * cez overrides — admin tak vie na akciu nasadiť typ, ktorý chce.
 *
 * Kľúčové rozhodnutia:
 *  · Hádanka je pre všetkých rovnaká a odvodená z DÁTUMU (seedovaný generátor),
 *    takže sa dá porovnávať čas a nedá sa „preklikať" na ľahšiu.
 *  · Riešenie overuje VÝHRADNE server — klient posiela len svoje ťahy.
 *  · Body sú zámerne nízke a mesačne stropované, aby hlavolam nenarušil
 *    súťaž Klientka mesiaca (hodina = 5 b).
 */
const WORDS = require('./puzzle-words');
const RYTMUS = require('./puzzle-rhythm');
const ANAGRAM = require('./puzzle-anagram');
const KVIZ = require('./puzzle-quiz');
const VOTRELEC = require('./puzzle-votrelec');

module.exports = ({ app, db, q, auth, adminAuth, nowISO, today, fakty, servisToken }) => {
  // Servisné volanie (x-import-token) alebo prihlásený admin — na jednorazové zásahy z konzoly.
  const adminAleboServis = (req, res, next) => (servisToken && servisToken(req)) ? next() : adminAuth(req, res, next);

  const SIZE = 6;                 // mriežka 6×6
  const CELLS = SIZE * SIZE;

  // ── Seedovaný generátor (rovnaký deň = rovnaká hádanka na každom zariadení) ──
  function seedFromString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const idx = (r, c) => r * SIZE + c;
  const neighbours = i => {
    const r = Math.floor(i / SIZE), c = i % SIZE, out = [];
    if (r > 0) out.push(idx(r - 1, c));
    if (r < SIZE - 1) out.push(idx(r + 1, c));
    if (c > 0) out.push(idx(r, c - 1));
    if (c < SIZE - 1) out.push(idx(r, c + 1));
    return out;
  };

  // Hamiltonovská cesta cez celú mriežku.
  // Náhodné DFS s návratom vie pri nešťastnom seede bežať minúty a zablokovať
  // server, preto ideme konštrukciou: hadovitá cesta + "backbite" premiešanie.
  // Každý krok je O(1) a cesta zostáva vždy platná — generovanie trvá milisekundy.
  function hamiltonPath(rnd) {
    const path = [];
    for (let r = 0; r < SIZE; r++) {                 // hadovitá cesta (vždy existuje)
      for (let k = 0; k < SIZE; k++) {
        const c = r % 2 === 0 ? k : SIZE - 1 - k;
        path.push(idx(r, c));
      }
    }
    const posOf = new Array(CELLS);
    path.forEach((cellIdx, i) => { posOf[cellIdx] = i; });
    const steps = 3000;
    for (let s = 0; s < steps; s++) {
      const fromStart = rnd() < 0.5;                 // striedavo prehýbame oba konce
      const endCell = fromStart ? path[0] : path[CELLS - 1];
      const nb = neighbours(endCell);
      const pick = nb[Math.floor(rnd() * nb.length)];
      const p = posOf[pick];
      if (fromStart) {
        if (p <= 1) continue;                        // sused je hneď vedľa konca → nič nezmení
        const seg = path.slice(0, p).reverse();      // otoč začiatok po suseda
        for (let i = 0; i < seg.length; i++) { path[i] = seg[i]; posOf[seg[i]] = i; }
      } else {
        if (p >= CELLS - 2) continue;
        const seg = path.slice(p + 1).reverse();     // otoč koniec za suseda
        for (let i = 0; i < seg.length; i++) { const at = p + 1 + i; path[at] = seg[i]; posOf[seg[i]] = at; }
      }
    }
    return path;
  }

  // Z hotovej cesty spravíme hádanku: rozsekáme ju na úseky a konce označíme číslami.
  function buildPuzzle(dateStr) {
    const rnd = mulberry32(seedFromString('fusion-zip-' + dateStr));
    let path = null;
    for (let attempt = 0; attempt < 40 && !path; attempt++) path = hamiltonPath(rnd);
    if (!path) return null;
    const count = 6 + Math.floor(rnd() * 3);          // 6–8 čísel
    const marks = [0];                                // 1 = vždy začiatok cesty
    const step = (CELLS - 1) / (count - 1);
    for (let k = 1; k < count - 1; k++) {
      // bod niekde v okolí rovnomerného delenia, nech to nie je pravidelné
      const base = Math.round(k * step);
      const jitter = Math.floor(rnd() * 5) - 2;
      const pos = Math.max(marks[marks.length - 1] + 2, Math.min(CELLS - 2, base + jitter));
      marks.push(pos);
    }
    marks.push(CELLS - 1);                            // posledné = koniec cesty
    const dots = marks.map((p, i) => ({ n: i + 1, cell: path[p] }));
    return { date: dateStr, size: SIZE, dots, _path: path };
  }

  // ── Tematické dni ────────────────────────────────────────────────────────────
  // V deň akcie nemá hlavolam len zabaviť, ale aj pripomenúť, že sa večer niekam ide.
  // Mriežka vtedy obsahuje len slová z akcie a nad hádankou je pruh s termínom,
  // miestom a odkazom na vstupenku. Fakty sú prevzaté z ev_events (nič vymyslené).
  const THEMES = {
    '2026-09-05': {
      type: 'words',
      slova: ['LATINO', 'TROPICAL', 'PARTY', 'SOBOTA', 'VECER', 'DETVA',
              'KOKTAIL', 'TANEC', 'SALSA', 'BACHATA', 'PARKET', 'VYROCIE'],
      banner: {
        emoji: '🌴',
        title: 'Dnes večer tancujeme v Detve!',
        text: 'Latin Tropical Party — <b>dnes o 21:00</b>, Fusion Club Detva, Záhradná 7. '
            + 'Slávime <b>prvý rok</b> tanečnej školy. Vstupenka online <b>5 €</b> (do 20:59), '
            + 'na mieste 10 € — welcome drink je v cene.',
        // Bez počtu slov — koľko sa ich do mriežky zmestí, závisí od generátora,
        // a číslo v texte by pri inom seede klamalo.
        note: 'Všetky slová v mriežke sú z dnešného večera. 💃',
        cta: '🎟️ Vstupenka za 5 €',
        url: '/event/latin-tropical-2026?utm_source=appka&utm_medium=hlavolam&utm_campaign=fa-party-den-d',
      },
    },
  };
  function themeFor(dateStr) { return THEMES[dateStr] || null; }

  // Aký typ pripadá na daný deň. Striedame, aby to neomrzelo; admin vie poradie
  // zmeniť (schedule) alebo typ na konkrétny deň natvrdo určiť (overrides).
  const TYPES = ['zip', 'words', 'rhythm', 'anagram', 'quiz', 'votrelec'];
  function typeForSync(dateStr, conf) {
    const th = themeFor(dateStr);
    if (th && TYPES.includes(th.type)) return th.type;   // tematický deň má prednosť
    const ov = conf && conf.overrides && conf.overrides[dateStr];
    if (ov && TYPES.includes(ov)) return ov;
    const list = (conf && Array.isArray(conf.schedule) && conf.schedule.length) ? conf.schedule : TYPES;
    const days = Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 86400000);
    const t = list[((days % list.length) + list.length) % list.length];
    return t === 'quiz' && KVIZ.OTAZKY.length < KVIZ.KOL ? 'zip' : t;   // bez banky otázok kvíz nejde
  }

  // Cache zahadzujeme v poradí, v akom pribúdala — nie podľa abecedy.
  // (Abecedné triedenie vedelo vyhodiť práve vygenerovanú hádanku a vrátiť undefined.)
  const cache = {};
  const cacheOrder = [];
  function puzzleFor(dateStr, type, vyber, verzia) {
    const t = type || 'zip';
    const key = dateStr + '|' + t + '|' + (vyber && vyber.ids ? vyber.ids.join(',') : '') + '|' + (verzia || '');
    if (!cache[key]) {
      if (t === 'quiz') {
        const rnd = mulberry32(seedFromString('fusion-quiz-moznosti-' + dateStr));
        cache[key] = { ...KVIZ.build(rnd, (vyber && vyber.ids) || []), type: 'quiz', date: dateStr };
      } else if (t === 'rhythm' && vyber && vyber.ids) {
        cache[key] = { ...RYTMUS.zIds(vyber.ids), type: 'rhythm', date: dateStr };
      } else if (t === 'words') {
        const rnd = mulberry32(seedFromString('fusion-words-' + dateStr));
        const th = themeFor(dateStr);
        cache[key] = th && th.slova
          ? { ...WORDS.build(rnd, th.slova), type: 'words', date: dateStr }
          : vyber && vyber.ids
          ? { ...WORDS.build(rnd, vyber.ids, WORDS.WORD_COUNT), type: 'words', date: dateStr }
          : { ...WORDS.build(rnd), type: 'words', date: dateStr };
      } else if (t === 'rhythm') {
        const rnd = mulberry32(seedFromString('fusion-rhythm-' + dateStr));
        cache[key] = { ...RYTMUS.build(rnd), type: 'rhythm', date: dateStr };
      } else if (t === 'votrelec') {
        const rnd = mulberry32(seedFromString('fusion-votrelec-' + dateStr));
        cache[key] = { ...VOTRELEC.build(rnd, vyber && vyber.ids), type: 'votrelec', date: dateStr };
      } else if (t === 'anagram') {
        const rnd = mulberry32(seedFromString('fusion-anagram-' + dateStr));
        cache[key] = { ...ANAGRAM.build(rnd, vyber && vyber.ids), type: 'anagram', date: dateStr };
      } else {
        cache[key] = { ...buildPuzzle(dateStr), type: 'zip' };
      }
      cacheOrder.push(key);
      while (cacheOrder.length > 8) delete cache[cacheOrder.shift()];   // nech pamäť nerastie
    }
    return cache[key];
  }

  // ── Uložený výber otázok a skladieb (Marek 16. 9.: „stále sa opakujú") ──
  // Kvíz a rytmus si pri prvom otvorení dňa zapíšu, čo dostali, a ďalší deň
  // berie z toho, čo ešte nebolo (alebo najdlhšie nebolo). Zápis v settings
  // zaručí, že výber sa počas dňa nezmení ani po reštarte servera.
  const vyberyHotove = {};
  const vyberyBezia = {};                    // dve súčasné požiadavky nesmú vybrať dvakrát
  const RYTMUS_BEZ_ZAPISU_DO = '2026-09-17'; // staršie rytmy sa dajú presne prepočítať zo seedu
  async function historiaVyberov(type, pred) {
    const pouzite = new Map();
    const zapis = (ids, d) => { for (const id of ids || []) if ((pouzite.get(id) || '') < d) pouzite.set(id, d); };
    const pref = 'puzzle_pick_' + type + '_';
    const riadky = await q.find(db.settings, { key: { $regex: new RegExp('^' + pref) } });
    let n = 0;
    for (const r of riadky) {
      const d = String(r.key).slice(pref.length);
      if (!(d < pred)) continue;
      n++; zapis(r.value && (r.value.pouzite || r.value.ids), d);
    }
    if (type === 'rhythm') {
      const dni = new Set((await q.find(db.puzzle_solves, { type: 'rhythm' })).map(r => String(r.date || ''))
        .filter(d => d && d < RYTMUS_BEZ_ZAPISU_DO && d < pred));
      for (const d of dni) if (!riadky.some(r => r.key === pref + d))
        zapis(RYTMUS.build(mulberry32(seedFromString('fusion-rhythm-' + d)))._ids, d);
    }
    return { pouzite, n };
  }
  function vyberDna(d, type) {
    const key = 'puzzle_pick_' + type + '_' + d;
    if (vyberyHotove[key]) return Promise.resolve(vyberyHotove[key]);
    if (!vyberyBezia[key]) {
      vyberyBezia[key] = (async () => {
        const ulozeny = await q.one(db.settings, { key });
        if (ulozeny && ulozeny.value && Array.isArray(ulozeny.value.ids)) return ulozeny.value;
        const { pouzite, n } = await historiaVyberov(type, d);
        if (type === 'quiz') await obnovFaktyKvizu(await cfg());
        const rnd = mulberry32(seedFromString('fusion-' + type + '-' + d));
        const ids = type === 'votrelec' ? VOTRELEC.vyberTemy(rnd, pouzite)
          : type === 'quiz' ? KVIZ.vyber(rnd, pouzite, n)
          : type === 'words' ? WORDS.vyberSlova(rnd, pouzite)
          : type === 'anagram' ? ANAGRAM.vyberSlova(rnd, pouzite)
          : RYTMUS.vyberNove(rnd, pouzite, n);
        const value = { type, ids, poradie: n };
        await q.insert(db.settings, { key, value, at: nowISO() });
        return value;
      })().then(v => { vyberyHotove[key] = v; delete vyberyBezia[key]; return v; },
                e => { delete vyberyBezia[key]; throw e; });
    }
    return vyberyBezia[key];
  }
  // Hádanka dňa vrátane uloženého výberu — toto volajú endpointy.
  async function hadanka(d, type) {
    if (type === 'quiz') {
      // otázky o nás berú čísla z aktuálneho stavu appky — pri zmene sa text prepočíta
      const f = await obnovFaktyKvizu(await cfg());
      return puzzleFor(d, type, await vyberDna(d, type), String(seedFromString(JSON.stringify(f))));
    }
    if (type === 'rhythm' || type === 'anagram' || type === 'votrelec') return puzzleFor(d, type, await vyberDna(d, type));
    // Osemsmerovka (od 17. 9.): slová sa neopakujú. Tematický deň má vlastné slová.
    if (type === 'words' && !(themeFor(d) && themeFor(d).slova)) {
      const vyber = await vyberDna(d, type);
      const p = puzzleFor(d, type, vyber);
      // Do mriežky sa nezmestia všetci kandidáti — ako použité si zapíšeme len umiestnené slová.
      if (!vyber.pouzite && p && Array.isArray(p.words)) {
        vyber.pouzite = p.words.slice();
        q.update(db.settings, { key: 'puzzle_pick_words_' + d }, { $set: { 'value.pouzite': vyber.pouzite } }).catch(() => {});
      }
      return p;
    }
    return puzzleFor(d, type);
  }

  // ── Fakty pre otázky o Fusion Academy ──
  // Časť dodá server (body, ceny, plány…), časť vie len hlavolam (typy hier, sadzby).
  const NAZVY_HIER = { zip: 'Spoj čísla', words: 'Osemsmerovka', rhythm: 'Poznáš rytmus?', anagram: 'Poskladaj slovo', quiz: 'Denný kvíz', votrelec: 'Nájdi votrelca' };
  const zoznamSk = a => a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' a ' + a[a.length - 1];
  async function obnovFaktyKvizu(c) {
    let zoServera = {};
    try { zoServera = (typeof fakty === 'function' ? await fakty() : {}) || {}; }
    catch (e) { console.error('fakty kvízu:', e.message); }
    const rozvrh = Array.isArray(c.schedule) && c.schedule.length ? c.schedule : TYPES;
    const hry = TYPES.filter(t => rozvrh.includes(t));
    const f = {
      ...zoServera,
      typy_pocet: hry.length,
      typy_zoznam: zoznamSk(hry.map(t => NAZVY_HIER[t])),
      ma_zip: hry.includes('zip'), ma_words: hry.includes('words'),
      ma_rytmus: hry.includes('rhythm'), ma_anagram: hry.includes('anagram'),
      ma_votrelec: hry.includes('votrelec'),
      votrelec_kol: VOTRELEC.KOL, votrelec_slov: VOTRELEC.NA_KOLO,
      rytmus_tance: zoznamSk(RYTMUS.TANCE.map((t, i) => i ? t.name.toLowerCase() : t.name)),
      kviz_body: naOdpoved(c, 'quiz'), kviz_bonus: bonusBezchybnej(c, 'quiz'),
      podium_pocet: (Array.isArray(c.podium_bonus) ? c.podium_bonus : []).filter(x => +x > 0).length,
    };
    KVIZ.nastavFakty(f);
    return f;
  }

  // Ktoré otázky nesedia s appkou — admin dostane upozornenie, otázka sa nevyberá.
  // Dve kontroly naraz (štart servera + ručná) by poslali upozornenie dvakrát.
  let kontrolaBezi = null;
  function skontrolujOtazky() {
    if (!kontrolaBezi) kontrolaBezi = kontrolaOtazok().finally(() => { kontrolaBezi = null; });
    return kontrolaBezi;
  }
  async function kontrolaOtazok() {
    const f = await obnovFaktyKvizu(await cfg());
    const zle = KVIZ.OTAZKY.filter(o => !o.vyradena)
      .map(o => ({ id: o.id, q: o.q, dovody: KVIZ.preverOtazku(o, f) }))
      .filter(x => x.dovody.length);
    const ulozene = await q.find(db.settings, { key: { $regex: /^kviz_nesedi_/ } });
    const zleIds = new Set(zle.map(x => x.id));
    for (const r of ulozene) if (!zleIds.has(String(r.key).slice(12))) await q.remove(db.settings, { _id: r._id });
    const noveVsetky = zle.filter(x => !ulozene.some(r => r.key === 'kviz_nesedi_' + x.id));
    for (const x of noveVsetky) await q.insert(db.settings, { key: 'kviz_nesedi_' + x.id, value: x.dovody, at: nowISO() });
    // Otázka o hre, ktorá sa zámerne nehrá (napr. rytmus), sa len ticho nevyberá — to nie je chyba.
    const nove = noveVsetky.filter(x => x.dovody.some(d => !d.startsWith(KVIZ.TICHO)));
    if (nove.length) {
      const text = nove.slice(0, 3).map(x => '„' + x.q + '“ — ' + x.dovody[0]).join(' · ')
        + (nove.length > 3 ? ' · a ďalšie (' + (nove.length - 3) + ')' : '');
      for (const a of await q.find(db.users, { is_admin: true })) await q.insert(db.notifications, {
        user_id: a._id, type: 'kviz_kontrola',
        title: '❓ Kvíz: ' + nove.length + (nove.length === 1 ? ' otázka o škole nesedí' : ' otázky o škole nesedia') + ' s appkou',
        body: text + '. Kým ich neopravíme, do kvízu sa nedostanú.',
        read: false, created_at: nowISO(),
      }).catch(() => {});
      console.log('❓ Kvíz: nesedí s appkou → ' + nove.map(x => x.id + ' (' + x.dovody.join('; ') + ')').join(' | '));
    }
    return zle;
  }
  // Konštanty servera sú dostupné až po načítaní celého server.js — preto s odstupom.
  setTimeout(() => { skontrolujOtazky().catch(e => console.error('kontrola kvízu:', e.message)); }, 45 * 1000);
  setInterval(() => { skontrolujOtazky().catch(() => {}); }, 6 * 60 * 60 * 1000);
  // Hry s bodom za každú správnu odpoveď (jeden pokus, bonus pre bezchybnú).
  const BODOVANE = { rhythm: RYTMUS, quiz: KVIZ, votrelec: VOTRELEC };
  const KLUC_BODOV = type => BODOVANE[type] ? type : 'rhythm';
  const naOdpoved = (c, type) => +c[KLUC_BODOV(type) + '_per_answer'] || 1;
  const bonusBezchybnej = (c, type) => +c[KLUC_BODOV(type) + '_perfect_bonus'] || 0;

  // ── Overenie riešenia (beží len na serveri) ──
  function validate(puzzle, cells) {
    if (!Array.isArray(cells) || cells.length !== CELLS) return 'Cesta musí prejsť všetky políčka.';
    const seen = new Set();
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!Number.isInteger(c) || c < 0 || c >= CELLS) return 'Neplatné políčko.';
      if (seen.has(c)) return 'Cez jedno políčko sa dá prejsť len raz.';
      seen.add(c);
      if (i > 0 && !neighbours(cells[i - 1]).includes(c)) return 'Cesta musí ísť po susedných políčkach.';
    }
    // čísla v správnom poradí
    let last = -1;
    for (const d of puzzle.dots) {
      const at = cells.indexOf(d.cell);
      if (at < 0) return 'Cesta musí prejsť cez všetky čísla.';
      if (at < last) return 'Čísla musia byť spojené v poradí 1, 2, 3…';
      last = at;
    }
    return null;
  }

  // riešenie overuje ten modul, ktorému hádanka patrí
  function validateAny(p, body) {
    if (p.type === 'words') return WORDS.validate(p, body.found);
    if (p.type === 'rhythm') return RYTMUS.validate(p, body.answers);
    if (p.type === 'anagram') return ANAGRAM.validate(p, body.answers);
    if (p.type === 'quiz') return KVIZ.validate(p, body.answers);
    if (p.type === 'votrelec') return VOTRELEC.validate(p, body.answers);
    return validate(p, body.cells);
  }

  // ── Nastavenia (admin ich vie zmeniť bez zásahu do kódu) ──
  const DEFAULTS = { points: 2, fast_bonus: 0, fast_seconds: 90, monthly_cap: 40, enabled: true,
                     podium_bonus: [5, 3, 1],       // 1. / 2. / 3. najrýchlejší čas dňa
                     day_win_bonus: 5, day_win_min_players: 2,
                     // Kvíz pribudol 16. 9. Rytmus Marek 17. 9. najprv vyradil (menej ako 100
                     // skladieb), potom povolil pripraviť 71 skladieb z Pixabay → späť v hre;
                     // s novým výberom sa skladba zopakuje až po ~15 kolách rytmu.
                     // Poradie drží dni: 17. 9. kvíz, 18. 9. osemsmerovka, 19. 9. rytmus,
                     // 20. 9. „Poskladaj slovo", 21. 9. „Spoj čísla", 22. 9. kvíz.
                     // 20. 9. pribudol šiesty typ „Nájdi votrelca". Šesťdňové poradie posunie
                     // aj dnešok, preto má 20. 9. výnimku — kto ho už hral, nesmie dostať inú hru.
                     schedule: ['rhythm', 'anagram', 'zip', 'quiz', 'words', 'votrelec'],
                     overrides: { '2026-09-20': 'anagram' },
                     // Rytmus sa boduje inak (Marek 30. 8.): jeden pokus, bod za každú
                     // správnu odpoveď a +5 pre najrýchlejšiu, ktorá má všetkých päť.
                     rhythm_per_answer: 1, rhythm_perfect_bonus: 5,
                     // Kvíz rovnako (Marek 16. 9.): bod za správnu, +5 najrýchlejšej s 5/5.
                     quiz_per_answer: 1, quiz_perfect_bonus: 5,
                     // „Nájdi votrelca" (Marek 20. 9.) rovnako: bod za každé trafené kolo, +5 najrýchlejšej s 5/5.
                     votrelec_per_answer: 1, votrelec_perfect_bonus: 5 };
  async function cfg() {
    const row = await q.one(db.settings, { key: 'puzzle_config' });
    return { ...DEFAULTS, ...(row && row.value || {}) };
  }


  // Strop 0 (alebo záporný) znamená BEZ stropu. Marek ho 10. 9. zrušil — najaktívnejšia
  // hráčka ho vyčerpala za týždeň a zvyšok mesiaca hrala za nulu, čo je presne opačná
  // motivácia, než akú od hlavolamu chceme.
  async function zostatokDoStropu(c, userId, month) {
    if (!(+c.monthly_cap > 0)) return Infinity;
    return Math.max(0, c.monthly_cap - await monthPoints(userId, month));
  }

  async function monthPoints(userId, month) {
    const rows = await q.find(db.puzzle_solves, { user_id: userId });
    return rows.filter(r => String(r.date || '').startsWith(month))
      .reduce((s, r) => s + (+r.points || 0), 0);
  }


  // ── Víťazka dňa: najrýchlejší čas dostane bonus. Vyhodnocuje sa až PO polnoci,
  // aby sa poradie počas dňa nemenilo a nikto nemal bonus "dočasne". ──
  // Bonus za pódium: prvé tri najrýchlejšie časy dňa dostanú +5 / +3 / +1.
  // Vyhodnocuje sa až PO polnoci, keď je deň uzavretý a poradie definitívne.
  async function awardDayWinner(dateStr) {
    const c = await cfg();
    const podium = Array.isArray(c.podium_bonus) && c.podium_bonus.length
      ? c.podium_bonus : [c.day_win_bonus || 5];
    if (!c.enabled || !podium.some(x => +x > 0)) return null;
    const all = await q.find(db.puzzle_solves, { date: dateStr });
    if (all.some(r => r.day_win)) return null;                 // už vyhodnotené
    // kto má zákaz bodov (podvádzanie), bonus nedostane a nikoho neodsunie
    const zakazane = new Set((await q.find(db.users, { body_zakaz: true })).map(u => u._id));
    let rows = all.filter(r => r.verified !== false && !r.body_zakaz && !r.mimo_poradia && !zakazane.has(r.user_id));   // len serverom meraný čas
    if (rows.length < c.day_win_min_players) return null;      // sama proti sebe nesúťaží
    rows.sort((a, b) => (a.seconds || 0) - (b.seconds || 0)
      || String(a.created_at || '').localeCompare(String(b.created_at || '')));

    // Deň rytmu má vlastné pravidlo (Marek 30. 8.): body si každá odniesla už pri
    // odovzdaní (bod za správnu ukážku) a bonus +5 patrí JEDNEJ — najrýchlejšej
    // z tých, čo mali všetkých päť. Kto sa pomýlil, bonus nedostane ani keby bol
    // najrýchlejší; inak by sa oplatilo klikať naslepo.
    // Denný kvíz (od 17. 9.) má to isté pravidlo.
    const bodovany = all.find(r => BODOVANE[r.type]);
    if (bodovany) {
      const NAZOV_LOG = { quiz: '❓ Kvíz ', rhythm: '🎵 Rytmus ', votrelec: '🕵️ Votrelec ' };
      const CO = { quiz: 'Včerajšie otázky v kvíze si mala všetky správne',
                   rhythm: 'Včerajšie rytmy si mala všetky správne',
                   votrelec: 'Včera si našla všetkých votrelcov' };
      const nazov = NAZOV_LOG[bodovany.type] || NAZOV_LOG.rhythm;
      const bezchybne = rows.filter(r => r.perfect);
      if (!bezchybne.length) { console.log(nazov + dateStr + ': nikto nemal všetkých päť — bonus nikomu'); return null; }
      const v = bezchybne[0];
      const capLeft = await zostatokDoStropu(c, v.user_id, dateStr.slice(0, 7));
      const bonus = Math.min(bonusBezchybnej(c, bodovany.type), capLeft);
      await q.update(db.puzzle_solves, { _id: v._id },
        { $set: { day_win: true, podium: 1, day_win_bonus: bonus, points: (+v.points || 0) + bonus } });
      await q.insert(db.notifications, {
        user_id: v.user_id, type: 'puzzle_win', title: '🥇 Najrýchlejšia s plným počtom!',
        body: (CO[bodovany.type] || CO.rhythm) + ' a odovzdala najrýchlejšie (' + v.seconds + ' s)'
          + (bonus ? ' — pripísali sme ti +' + bonus + ' bonusových bodov.' : '. Mesačný strop bodov máš už vyčerpaný.'),
        read: false, created_at: nowISO(),
      }).catch(() => {});
      console.log(nazov + dateStr + ': bonus +' + bonus + ' pre ' + (v.user_name || v.user_id)
        + ' (' + v.seconds + ' s, ' + bezchybne.length + ' bezchybných z ' + rows.length + ')');
      return [{ miesto: 1, user_id: v.user_id, name: v.user_name, seconds: v.seconds, bonus }];
    }
    const MEDAILA = ['🥇', '🥈', '🥉'];
    const NAZOV = ['1. miesto', '2. miesto', '3. miesto'];
    const vysledok = [];
    for (let i = 0; i < Math.min(podium.length, rows.length); i++) {
      const r = rows[i], odmena = +podium[i] || 0;
      if (odmena <= 0) continue;
      const capLeft = await zostatokDoStropu(c, r.user_id, dateStr.slice(0, 7));
      const bonus = Math.min(odmena, capLeft);
      await q.update(db.puzzle_solves, { _id: r._id },
        { $set: { day_win: i === 0, podium: i + 1, day_win_bonus: bonus, points: (+r.points || 0) + bonus } });
      await q.insert(db.notifications, {
        user_id: r.user_id, type: 'puzzle_win',
        title: MEDAILA[i] + ' ' + NAZOV[i] + ' v dennom hlavolame!',
        body: 'Včerajšiu hádanku si zvládla za ' + r.seconds + ' s — ' + NAZOV[i].toLowerCase() + ' zo všetkých'
          + (bonus ? ' a +' + bonus + ' bonusových bodov.' : '. Mesačný strop bodov máš už vyčerpaný.'),
        read: false, created_at: nowISO(),
      }).catch(() => {});
      vysledok.push({ miesto: i + 1, user_id: r.user_id, name: r.user_name, seconds: r.seconds, bonus });
    }
    if (vysledok.length) console.log('🏆 Hlavolam ' + dateStr + ' pódium: '
      + vysledok.map(v => v.miesto + '. ' + (v.name || v.user_id) + ' (' + v.seconds + ' s, +' + v.bonus + ' b)').join(' · '));
    return vysledok.length ? vysledok : null;
  }
  // beží každých 20 minút; guard v settings zabezpečí jedno vyhodnotenie na deň
  setInterval(async () => {
    try {
      const y = new Date(Date.parse(today()) - 86400000).toISOString().slice(0, 10);
      const key = 'puzzle_winner_' + y;
      if (await q.one(db.settings, { key })) return;
      const res = await awardDayWinner(y);
      await q.insert(db.settings, { key, value: res || 'none', at: nowISO() });
    } catch (e) { console.error('puzzle winner:', e.message); }
  }, 20 * 60 * 1000);

  // QA: vyhodnotenie pódia/bonusu sa inak čaká 20 minút a až po polnoci —
  // takto sa dá logika otestovať hneď. Guard sa pri ručnom behu obchádza.
  app.post('/api/admin/qa/puzzle-award/:date', adminAuth, async (req, res) => {
    try {
      const d = String(req.params.date || '').slice(0, 10);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d)) return res.status(400).json({ error: 'Neplatný dátum.' });
      const vysledok = await awardDayWinner(d);
      res.json({ ok: true, date: d, vysledok: vysledok || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Admin/QA: kontrola otázok o škole hneď (inak beží 45 s po štarte a každých 6 h).
  app.post('/api/admin/kviz/kontrola', adminAuth, async (req, res) => {
    try {
      const zle = await skontrolujOtazky();
      res.json({ ok: true, nesedi: zle, fakty: await obnovFaktyKvizu(await cfg()) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Dnešná hádanka + môj stav ──
  app.get('/api/puzzle/today', auth, async (req, res) => {
    try {
      const c = await cfg();
      if (!c.enabled) return res.json({ ok: true, enabled: false });
      const d = today();
      const type = typeForSync(d, c);
      const p = await hadanka(d, type);
      if (!p) return res.status(500).json({ error: 'Hádanku sa nepodarilo pripraviť.' });
      const mine = await q.one(db.puzzle_solves, { user_id: req.session.uid, date: d });
      const M = BODOVANE[type];
      const earned = await monthPoints(req.session.uid, d.slice(0, 7));
      const solvers = await q.count(db.puzzle_solves, { date: d });
      const ja = await q.one(db.users, { _id: req.session.uid });
      res.json({
        ok: true, enabled: true, date: d, size: p.size, type,
        ...(type === 'words'
          ? { grid: p.grid, words: p.words }                  // umiestnenie slov sa neposiela
          : type === 'rhythm'
          ? { rounds: p.rounds, options: p.options }          // správne odpovede sa NIKDY neposielajú
          : type === 'anagram'
          ? { slova: p.slova, pocet: p.pocet }             // len rozhádzané písmená, riešenie nikdy
          : type === 'quiz'
          ? { otazky: p.otazky, pocet: p.pocet }           // otázky a zamiešané možnosti, správna nikdy
          : type === 'votrelec'
          ? { kola: p.kola, pocet: p.pocet }               // len štvorice slov — kategória ani votrelec nikdy
          : { dots: p.dots.map(x => ({ n: x.n, cell: x.cell })) }),   // cesta sa NIKDY neposiela
        solved: !!mine,
        // Kto už má dnešok vyriešený, nech vidí aj riešenie — inak sa vráti na prázdnu mriežku.
        ...(mine ? (type === 'words'
          ? { solution: p._placed.map(x => ({ word: x.word, cells: x.cells })) }
          : M
          ? { reveal: M.reveal(p, mine && mine.answers), // po odovzdaní nech sa niečo naučí
              my_correct: mine ? (mine.correct != null ? mine.correct : null) : null,
              my_total: mine ? (mine.total || M.KOL) : null,
              my_perfect: mine ? !!mine.perfect : false }
          : type === 'anagram'
          ? { reveal: ANAGRAM.reveal(p, mine && mine.answers) }
          : { solution_path: p._path }) : {}),
        my_seconds: mine ? mine.seconds : null,
        my_points: mine ? mine.points : 0,
        month_points: earned, monthly_cap: c.monthly_cap,
        points: c.points, fast_bonus: c.fast_bonus, fast_seconds: c.fast_seconds,
        day_win_bonus: c.day_win_bonus, podium_bonus: c.podium_bonus || [5, 3, 1],
        rhythm_per_answer: +c.rhythm_per_answer || 1, rhythm_perfect_bonus: +c.rhythm_perfect_bonus || 0,
        quiz_per_answer: naOdpoved(c, 'quiz'), quiz_perfect_bonus: bonusBezchybnej(c, 'quiz'),
        votrelec_per_answer: naOdpoved(c, 'votrelec'), votrelec_perfect_bonus: bonusBezchybnej(c, 'votrelec'),
        my_day_win: mine ? !!mine.day_win : false,
        body_zakaz: !!(ja && ja.body_zakaz),
        solvers_today: solvers,
        banner: (themeFor(d) || {}).banner || null,   // pruh s akciou v tematický deň
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Štart merania času (beží na serveri, klientovi sa neverí) ──
  app.post('/api/puzzle/start', auth, async (req, res) => {
    const d = today();
    // Čas beží od OTVORENIA hádanky. Opakované otvorenie ani obnovenie stránky
    // ho nenuluje — inak by stačilo hádanku naštudovať a potom "zabehnúť".
    if (!req.session.puzzle || req.session.puzzle.date !== d) {
      req.session.puzzle = { date: d, at: Date.now() };
    }
    res.json({ ok: true, elapsed: Math.round((Date.now() - req.session.puzzle.at) / 1000) });
  });

  // ── Odoslanie riešenia ──
  app.post('/api/puzzle/solve', auth, async (req, res) => {
    try {
      const c = await cfg();
      if (!c.enabled) return res.status(400).json({ error: 'Hlavolam je momentálne vypnutý.' });
      const d = today();
      const p = await hadanka(d, typeForSync(d, c));
      if (!p) return res.status(500).json({ error: 'Hádanku sa nepodarilo pripraviť.' });

      // Ak medzitým nastala polnoc, klient rieši včerajšiu hádanku — povedz mu to zrozumiteľne.
      if (req.body.date && req.body.date !== d)
        return res.status(409).json({ error: 'Práve sa zmenil deň — načítaj novú hádanku.', new_day: true });
      const err = validateAny(p, req.body);
      if (err) {
        // Pri „Poskladaj slovo" povedz, KTORÉ riadky nesedia. Bez toho hráčka
        // videla len „3 slová ešte nesedia", skúšala dokola a hodinu sa jej
        // točil čas bez šance dokončiť (Miška Ď., 7. 9.). Riešenie sa neprezradí —
        // posielame iba áno/nie pre už napísané slová.
        if (p.type === 'anagram')
          return res.status(400).json({ error: err, trafene: ANAGRAM.score(p, req.body.answers).trafene });
        return res.status(400).json({ error: err });
      }

      const already = await q.one(db.puzzle_solves, { user_id: req.session.uid, date: d });
      if (already) return res.json({ ok: true, already: true, points: 0, message: 'Dnešnú hádanku už máš odovzdanú. 🎉' });

      // Čas meriame zo SERVEROVÉHO štartu. Bez neho (reštart, iné zariadenie)
      // riešenie uznáme, ale nemôže vyhrať deň — inak by stačilo poslať "1 s".
      const st = req.session.puzzle;
      const verified = !!(st && st.date === d && st.at);
      const seconds = verified
        ? Math.max(1, Math.min(3600, Math.round((Date.now() - st.at) / 1000)))
        : Math.max(1, Math.min(3600, Math.round(+req.body.seconds || 0)));

      const capLeft = await zostatokDoStropu(c, req.session.uid, d.slice(0, 7));
      // Rytmus má vlastné bodovanie: hráčka odovzdáva RAZ a dostane bod za každú
      // trafenú ukážku. Bonus +5 za bezchybné riešenie sa nedáva hneď — až po
      // polnoci ho dostane tá najrýchlejšia z bezchybných (awardDayWinner).
      // Denný kvíz sa boduje rovnako.
      const M = BODOVANE[p.type];
      const vysledok = M ? M.score(p, req.body.answers) : null;
      let points = vysledok
        ? vysledok.spravne * naOdpoved(c, p.type)
        : c.points + (seconds <= c.fast_seconds ? c.fast_bonus : 0);
      const capped = points > capLeft;
      points = Math.min(points, capLeft);
      // Kto podvádzal, hrať môže, ale body nedostane (Marek 16. 9.).
      const u = await q.one(db.users, { _id: req.session.uid });
      const bezBodov = !!(u && u.body_zakaz);
      if (bezBodov) points = 0;
      await q.insert(db.puzzle_solves, {
        user_id: req.session.uid, user_name: u ? u.name : '', date: d, month: d.slice(0, 7),
        seconds, points, fast: seconds <= c.fast_seconds, verified, type: p.type, created_at: nowISO(),
        ...(bezBodov ? { body_zakaz: true } : {}),
        ...(vysledok ? { correct: vysledok.spravne, total: vysledok.celkom, perfect: vysledok.perfect,
                         answers: req.body.answers } : {}),
      });

      delete req.session.puzzle;
      const rank = await q.count(db.puzzle_solves, { date: d });
      res.json({
        ok: true, points, seconds, rank,
        ...(vysledok ? { correct: vysledok.spravne, total: vysledok.celkom, perfect: vysledok.perfect,
                         reveal: M.reveal(p, req.body.answers),
                         perfect_bonus: bonusBezchybnej(c, p.type) } : {}),
        fast: seconds <= c.fast_seconds, body_zakaz: bezBodov,
        capped, month_points: await monthPoints(req.session.uid, d.slice(0, 7)), monthly_cap: c.monthly_cap,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Admin: reset dnešnej hry pre jednu klientku ──
  // Keď sa niekomu hra zasekne (zle uznané riešenie, spadnutá odpoveď), admin ju
  // vie vrátiť do stavu „ešte nehrala" bez zásahu do databázy cez konzolu.
  app.post('/api/admin/puzzle/reset', adminAuth, async (req, res) => {
    try {
      const uid = String(req.body.user_id || '');
      const d = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(req.body.date || '')) ? req.body.date : today();
      if (!uid) return res.status(400).json({ error: 'Chýba klientka.' });
      const u = await q.one(db.users, { _id: uid });
      if (!u) return res.status(404).json({ error: 'Klientka nenájdená.' });
      const mine = await q.find(db.puzzle_solves, { user_id: uid, date: d });
      for (const r of mine) await q.remove(db.puzzle_solves, { _id: r._id });
      if (mine.length) await q.insert(db.notifications, { user_id: uid, type: 'puzzle',
        title: '🧩 Hlavolam ti je odomknutý',
        body: 'Dnešný hlavolam sme ti vrátili na začiatok — môžeš si ho zahrať znova. Prepáč za komplikácie! 💛',
        read: false, created_at: nowISO() }).catch(() => {});
      console.log('🧩 Hlavolam reset: ' + u.name + ' ' + d + ' (zmazané: ' + mine.length + ')');
      res.json({ ok: true, date: d, removed: mine.length, points_back: mine.reduce((s, r) => s + (+r.points || 0), 0) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Kto má zákaz bodov (podvádzanie), v poradí hlavolamu nefiguruje.
  const zakazaneIds = async () => new Set((await q.find(db.users, { body_zakaz: true })).map(u => u._id));
  const vPoradi = zak => r => r.verified !== false && !r.body_zakaz && !r.mimo_poradia && !zak.has(r.user_id);

  // Pri rytme a kvíze rozhoduje najprv počet správnych, až potom čas — inak by
  // na prvom mieste svietila tá, čo klikala naslepo, hoci bonus dostane iná.
  const poradieRiesitelov = bodovany => (a, b) =>
    (bodovany ? (+b.correct || 0) - (+a.correct || 0) : 0)
    || (a.seconds || 0) - (b.seconds || 0)
    || String(a.created_at || '').localeCompare(String(b.created_at || ''));

  // ── Dnešný rebríček (kto to dal najrýchlejšie) ──
  app.get('/api/puzzle/leaderboard', auth, async (req, res) => {
    try {
      const d = today();
      const vsetky = (await q.find(db.puzzle_solves, { date: d })).filter(vPoradi(await zakazaneIds()));
      const bodovany = vsetky.some(r => BODOVANE[r.type]);
      const rows = vsetky.sort(poradieRiesitelov(bodovany))
        .map((r, i) => ({ pos: i + 1, name: r.user_name || 'Tanečníčka', seconds: r.seconds,
          me: r.user_id === req.session.uid, win: !!r.day_win, podium: r.podium || null,
          ...(bodovany ? { correct: +r.correct || 0, total: +r.total || 5, perfect: !!r.perfect } : {}) }));
      res.json({ ok: true, date: d, rows, scored: bodovany });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── História: kto sa v ktorý deň zapojil, s časmi a bodmi ──
  // Marek 30. 8.: rebríček ukazoval len dnešok, takže sa nedalo pozrieť dozadu.
  // Vraciame dni zostupne aj s celým poradím — kto to v UI nerozklikne, uvidí
  // len súhrn, takže dlhá história nikoho nezahltí.
  app.get('/api/puzzle/history', auth, async (req, res) => {
    try {
      const dni = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
      const dnes = today();
      const podlaDna = {};
      const zak = await zakazaneIds();
      for (const r of await q.find(db.puzzle_solves, {})) {
        const d = String(r.date || '').slice(0, 10);
        if (!d || d > dnes) continue;                       // dnešok áno, budúcnosť nie
        (podlaDna[d] = podlaDna[d] || []).push(r);
      }
      const zoznam = Object.keys(podlaDna).sort().reverse().slice(0, dni).map(d => {
        const vsetky = podlaDna[d];
        const bodovany = vsetky.some(r => BODOVANE[r.type]);
        const rows = vsetky.filter(vPoradi(zak))
          .sort(poradieRiesitelov(bodovany))
          .map((r, i) => ({
            pos: i + 1, name: r.user_name || 'Tanečníčka', seconds: r.seconds,
            points: +r.points || 0, bonus: +r.day_win_bonus || 0,
            podium: r.podium || null, me: r.user_id === req.session.uid,
            ...(bodovany ? { correct: +r.correct || 0, total: +r.total || 5, perfect: !!r.perfect } : {}),
          }));
        // pri bodovanej hre je víťazka tá najrýchlejšia s plným počtom
        const vitazka = rows[0] && (!bodovany || rows[0].perfect) ? rows[0] : null;
        return {
          date: d, type: (vsetky.find(r => r.type) || {}).type || null,
          players: rows.length, points: rows.reduce((s2, r) => s2 + r.points, 0),
          winner: vitazka ? { name: vitazka.name, seconds: vitazka.seconds } : null,
          scored: bodovany,
          rows,
        };
      });
      res.json({ ok: true, days: zoznam, total_days: Object.keys(podlaDna).length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Admin: nastavenia + prehľad ──
  // Čítanie nastavení pustíme aj servisnému tokenu — po nasadení sa tak dá overiť,
  // čo appka naozaj beží (railway logy sú stratové). Zapisovať smie len admin.
  app.get('/api/admin/puzzle', adminAleboServis, async (req, res) => {
    try {
      const c = await cfg();
      const all = await q.find(db.puzzle_solves, {});
      const m = today().slice(0, 7);
      const thisMonth = all.filter(r => String(r.date || '').startsWith(m));
      const nesedi = (await q.find(db.settings, { key: { $regex: /^kviz_nesedi_/ } }))
        .map(r => ({ id: String(r.key).slice(12), dovody: r.value }));
      res.json({
        ok: true, config: c, kviz_nesedi: nesedi,
        solves_total: all.length, solves_month: thisMonth.length,
        players_month: new Set(thisMonth.map(r => r.user_id)).size,
        points_month: thisMonth.reduce((s, r) => s + (+r.points || 0), 0),
        avg_seconds: thisMonth.length ? Math.round(thisMonth.reduce((s, r) => s + (+r.seconds || 0), 0) / thisMonth.length) : null,
        upcoming: Array.from({ length: 7 }, (_, i) => {
          const d = new Date(Date.parse(today() + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
          return { date: d, type: typeForSync(d, c) };
        }),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/admin/puzzle', adminAuth, async (req, res) => {
    try {
      const cur = await cfg();
      // Pozor: +undefined je NaN a ?? ho NEzachytí — čiastočná zmena by ostatné
      // hodnoty prepísala na null. Preto kontrolujeme Number.isFinite.
      const num = (v, fallback, lo, hi) => {
        if (v === undefined || v === null || v === '') return fallback;
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
      };
      const next = {
        enabled: req.body.enabled !== undefined ? !!req.body.enabled : cur.enabled,
        points: num(req.body.points, cur.points, 0, 10),
        fast_bonus: num(req.body.fast_bonus, cur.fast_bonus, 0, 10),
        fast_seconds: num(req.body.fast_seconds, cur.fast_seconds, 10, 600),
        monthly_cap: num(req.body.monthly_cap, cur.monthly_cap, 0, 200),
        day_win_bonus: num(req.body.day_win_bonus, cur.day_win_bonus, 0, 20),
        podium_bonus: Array.isArray(req.body.podium_bonus) && req.body.podium_bonus.length <= 3
          && req.body.podium_bonus.every(x => Number.isFinite(+x) && +x >= 0 && +x <= 20)
          ? req.body.podium_bonus.map(Number) : cur.podium_bonus,
        day_win_min_players: num(req.body.day_win_min_players, cur.day_win_min_players, 1, 50),
        rhythm_per_answer: num(req.body.rhythm_per_answer, cur.rhythm_per_answer, 0, 10),
        rhythm_perfect_bonus: num(req.body.rhythm_perfect_bonus, cur.rhythm_perfect_bonus, 0, 20),
        quiz_per_answer: num(req.body.quiz_per_answer, cur.quiz_per_answer, 0, 10),
        quiz_perfect_bonus: num(req.body.quiz_perfect_bonus, cur.quiz_perfect_bonus, 0, 20),
        votrelec_per_answer: num(req.body.votrelec_per_answer, cur.votrelec_per_answer, 0, 10),
        votrelec_perfect_bonus: num(req.body.votrelec_perfect_bonus, cur.votrelec_perfect_bonus, 0, 20),
        schedule: Array.isArray(req.body.schedule) && req.body.schedule.every(t => TYPES.includes(t)) && req.body.schedule.length
          ? req.body.schedule : cur.schedule,
        overrides: (req.body.overrides && typeof req.body.overrides === 'object')
          ? Object.fromEntries(Object.entries(req.body.overrides)
              .filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && TYPES.includes(v)))
          : cur.overrides,
      };
      const row = await q.one(db.settings, { key: 'puzzle_config' });
      if (row) await q.update(db.settings, { key: 'puzzle_config' }, { $set: { value: next, at: nowISO() } });
      else await q.insert(db.settings, { key: 'puzzle_config', value: next, at: nowISO() });
      res.json({ ok: true, config: next });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Admin: body hlavolamu za mesiac po hráčkach (na porovnanie, kto vytŕča) ──
  async function mesiacPoHrackach(month) {
    const zak = await zakazaneIds();
    const podla = {};
    for (const r of await q.find(db.puzzle_solves, {})) {
      if (!String(r.date || '').startsWith(month) || r.verified === false) continue;
      const b = podla[r.user_id] = podla[r.user_id] || { user_id: r.user_id, name: r.user_name || '', points: 0, count: 0, seconds: 0, perfect: 0, wins: 0, body_zakaz: zak.has(r.user_id) };
      b.points += (+r.points || 0); b.count++; b.seconds += (+r.seconds || 0);
      if (r.perfect) b.perfect++; if (r.day_win) b.wins++; if (r.mimo_poradia) b.mimo_poradia = true;
    }
    const rows = Object.values(podla).map(b => ({ ...b, avg_seconds: b.count ? Math.round(b.seconds / b.count) : null }))
      .sort((a, b) => b.points - a.points);
    const pts = rows.filter(r => !r.body_zakaz).map(r => r.points).sort((a, b) => a - b);
    const avg = pts.length ? Math.round(pts.reduce((s, x) => s + x, 0) / pts.length) : 0;
    const median = pts.length ? pts[Math.floor(pts.length / 2)] : 0;
    return { month, players: rows.length, avg, median, rows };
  }
  app.get('/api/admin/puzzle/mesiac', adminAleboServis, async (req, res) => {
    try {
      const m = /^d{4}-d{2}$/.test(String(req.query.month || '')) ? req.query.month : today().slice(0, 7);
      res.json({ ok: true, ...(await mesiacPoHrackach(m)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Admin: skrátenie bodov za podvádzanie (Marek 18. 9.) ──
  // Hráčka s podozrivo rýchlymi a vždy správnymi riešeniami príde o body nad
  // zadaný strop za daný mesiac. Body sa jej nechajú v poradí, ako ich získala
  // (od začiatku mesiaca), zvyšok sa vynuluje; pôvodná hodnota ostáva v
  // points_povodne, aby sa dal zásah dohľadať alebo vrátiť. Klientka dostane oznam.
  app.post('/api/admin/puzzle/skrat', adminAleboServis, async (req, res) => {
    try {
      const uid = String(req.body.user_id || '');
      const cap = Math.max(0, parseInt(req.body.cap, 10) || 0);
      const m = /^d{4}-d{2}$/.test(String(req.body.month || '')) ? req.body.month : today().slice(0, 7);
      const dovod = String(req.body.dovod || '').trim().slice(0, 300);
      if (!uid) return res.status(400).json({ error: 'Chýba klientka.' });
      const u = await q.one(db.users, { _id: uid });
      if (!u) return res.status(404).json({ error: 'Klientka nenájdená.' });
      const mine = (await q.find(db.puzzle_solves, { user_id: uid }))
        .filter(r => String(r.date || '').startsWith(m))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
      const pred = mine.reduce((s, r) => s + (+r.points || 0), 0);
      if (pred <= cap) return res.json({ ok: true, zmena: false, month: m, pred, po: pred, cap });
      let zostava = cap, upravene = 0;
      const at = nowISO(), by = (req.user && req.user.name) || 'service';
      for (const r of mine) {
        const povodne = +r.points || 0;
        const nove = Math.min(povodne, zostava);
        zostava -= nove;
        if (nove === povodne) continue;
        upravene++;
        await q.update(db.puzzle_solves, { _id: r._id }, { $set: {
          points: nove, points_povodne: r.points_povodne !== undefined ? r.points_povodne : povodne,
          korekcia: { at, by, cap, dovod } } });
      }
      await q.update(db.users, { _id: uid }, { $set: { puzzle_upozornenie: { at, month: m, cap, pred, dovod, by } } });
      if (req.body.oznam !== false) await q.insert(db.notifications, {
        user_id: uid, type: 'puzzle_podvod',
        title: '⚠️ Body z hlavolamu sme ti skrátili',
        body: 'Softvérovo sme vyhodnotili, že si v dennom hlavolame podvádzala — riešenia si odovzdávala nezvyčajne rýchlo a vždy správne. '
          + 'Body z hlavolamu za tento mesiac sme ti preto skrátili na ' + cap + ' bodov — na úroveň, ktorú majú ostatné aktívne dievčatá. '
          + 'Prosíme, hraj do budúcna férovo. Pri ďalšom podvádzaní ti prístup k tejto súťaži zakážeme.',
        read: false, created_at: at,
      }).catch(() => {});
      console.log('🧩 Skrátenie bodov: ' + u.name + ' ' + m + ' ' + pred + ' → ' + cap + ' b (' + by + (dovod ? ', ' + dovod : '') + ')');
      res.json({ ok: true, zmena: true, month: m, pred, po: cap, cap, upravene });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Admin: vyradenie z poradia za mesiac (Marek 18. 9.) ──
  // Podvodníčka nemá figurovať v histórii víťazov ani v rebríčku dňa, ale jej
  // (skrátené) body do súťaže ostávajú. Záznamy sa nemažú — dostanú mimo_poradia,
  // takže sa dá krok vrátiť (stav:false).
  app.post('/api/admin/puzzle/mimo-poradia', adminAleboServis, async (req, res) => {
    try {
      const uid = String(req.body.user_id || '');
      const m = /^d{4}-d{2}$/.test(String(req.body.month || '')) ? req.body.month : today().slice(0, 7);
      const stav = req.body.stav !== false;
      if (!uid) return res.status(400).json({ error: 'Chýba klientka.' });
      const u = await q.one(db.users, { _id: uid });
      if (!u) return res.status(404).json({ error: 'Klientka nenájdená.' });
      const mine = (await q.find(db.puzzle_solves, { user_id: uid })).filter(r => String(r.date || '').startsWith(m));
      for (const r of mine) await q.update(db.puzzle_solves, { _id: r._id },
        stav ? { $set: { mimo_poradia: true, mimo_poradia_at: nowISO() } } : { $unset: { mimo_poradia: true, mimo_poradia_at: true } });
      console.log('🧩 Mimo poradia: ' + u.name + ' ' + m + ' → ' + (stav ? 'vyradená' : 'vrátená') + ' (' + mine.length + ' dní)');
      res.json({ ok: true, month: m, stav, dni: mine.length, body: mine.reduce((s, r) => s + (+r.points || 0), 0) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // pre bodovú súťaž (pointsSummaryData)
  async function puzzlePointsMap(from, to) {
    const f = String(from || '0000').slice(0, 10), t = String(to || '9999').slice(0, 10);
    const map = {};
    for (const r of await q.find(db.puzzle_solves, {})) {
      const d = String(r.date || '').slice(0, 10);
      if (d < f || d > t) continue;
      const b = map[r.user_id] = map[r.user_id] || { points: 0, count: 0 };
      b.points += (+r.points || 0); b.count++;
    }
    return map;
  }

  return { puzzleFor, hadanka, vyberDna, validate, validateAny, typeForSync, puzzlePointsMap, cfg, awardDayWinner,
    skontrolujOtazky, obnovFaktyKvizu, SIZE };
};
