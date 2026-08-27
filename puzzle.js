/**
 * Denný hlavolam „Cesta" (Zip) — spoj čísla v poradí a vyplň celú mriežku.
 *
 * Kľúčové rozhodnutia:
 *  · Hádanka je pre všetkých rovnaká a odvodená z DÁTUMU (seedovaný generátor),
 *    takže sa dá porovnávať čas a nedá sa „preklikať" na ľahšiu.
 *  · Riešenie overuje VÝHRADNE server — klient posiela len cestu buniek.
 *  · Body sú zámerne nízke a mesačne stropované, aby hlavolam nenarušil
 *    súťaž Klientka mesiaca (hodina = 5 b).
 */
module.exports = ({ app, db, q, auth, adminAuth, nowISO, today }) => {

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

  const cache = {};
  function puzzleFor(dateStr) {
    if (!cache[dateStr]) {
      cache[dateStr] = buildPuzzle(dateStr);
      const keys = Object.keys(cache).sort();
      while (keys.length > 5) delete cache[keys.shift()];   // nech pamäť nerastie
    }
    return cache[dateStr];
  }

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

  // ── Nastavenia (admin ich vie zmeniť bez zásahu do kódu) ──
  const DEFAULTS = { points: 1, fast_bonus: 1, fast_seconds: 90, monthly_cap: 40, enabled: true,
                     day_win_bonus: 5, day_win_min_players: 2 };
  async function cfg() {
    const row = await q.one(db.settings, { key: 'puzzle_config' });
    return { ...DEFAULTS, ...(row && row.value || {}) };
  }

  async function monthPoints(userId, month) {
    const rows = await q.find(db.puzzle_solves, { user_id: userId });
    return rows.filter(r => String(r.date || '').startsWith(month))
      .reduce((s, r) => s + (+r.points || 0), 0);
  }


  // ── Víťazka dňa: najrýchlejší čas dostane bonus. Vyhodnocuje sa až PO polnoci,
  // aby sa poradie počas dňa nemenilo a nikto nemal bonus "dočasne". ──
  async function awardDayWinner(dateStr) {
    const c = await cfg();
    if (!c.enabled || !c.day_win_bonus) return null;
    const all = await q.find(db.puzzle_solves, { date: dateStr });
    if (all.some(r => r.day_win)) return null;                 // už vyhodnotené
    const rows = all.filter(r => r.verified !== false);        // len serverom meraný čas
    if (rows.length < c.day_win_min_players) return null;      // sama proti sebe nesúťaží
    rows.sort((a, b) => (a.seconds || 0) - (b.seconds || 0)
      || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const w = rows[0];
    const month = dateStr.slice(0, 7);
    const capLeft = Math.max(0, c.monthly_cap - await monthPoints(w.user_id, month));
    const bonus = Math.min(c.day_win_bonus, capLeft);
    await q.update(db.puzzle_solves, { _id: w._id },
      { $set: { day_win: true, day_win_bonus: bonus, points: (+w.points || 0) + bonus } });
    await q.insert(db.notifications, {
      user_id: w.user_id, type: 'puzzle_win', title: '🏆 Vyhrala si denný hlavolam!',
      body: 'Včerajšiu hádanku si zvládla najrýchlejšie zo všetkých (' + w.seconds + ' s)'
        + (bonus ? ' — pripísali sme ti +' + bonus + ' bodov.' : '. Mesačný strop bodov máš už vyčerpaný.'),
      read: false, created_at: nowISO(),
    }).catch(() => {});
    console.log('🏆 Hlavolam ' + dateStr + ': vyhrala ' + (w.user_name || w.user_id) + ' (' + w.seconds + ' s, +' + bonus + ' b)');
    return { user_id: w.user_id, name: w.user_name, seconds: w.seconds, bonus };
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

  // ── Dnešná hádanka + môj stav ──
  app.get('/api/puzzle/today', auth, async (req, res) => {
    try {
      const c = await cfg();
      if (!c.enabled) return res.json({ ok: true, enabled: false });
      const d = today();
      const p = puzzleFor(d);
      if (!p) return res.status(500).json({ error: 'Hádanku sa nepodarilo pripraviť.' });
      const mine = await q.one(db.puzzle_solves, { user_id: req.session.uid, date: d });
      const earned = await monthPoints(req.session.uid, d.slice(0, 7));
      const solvers = await q.count(db.puzzle_solves, { date: d });
      res.json({
        ok: true, enabled: true, date: d, size: p.size,
        dots: p.dots.map(x => ({ n: x.n, cell: x.cell })),   // cesta sa NIKDY neposiela
        solved: !!mine,
        my_seconds: mine ? mine.seconds : null,
        my_points: mine ? mine.points : 0,
        month_points: earned, monthly_cap: c.monthly_cap,
        points: c.points, fast_bonus: c.fast_bonus, fast_seconds: c.fast_seconds,
        day_win_bonus: c.day_win_bonus, my_day_win: mine ? !!mine.day_win : false,
        solvers_today: solvers,
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
      const p = puzzleFor(d);
      if (!p) return res.status(500).json({ error: 'Hádanku sa nepodarilo pripraviť.' });

      // Ak medzitým nastala polnoc, klient rieši včerajšiu hádanku — povedz mu to zrozumiteľne.
      if (req.body.date && req.body.date !== d)
        return res.status(409).json({ error: 'Práve sa zmenil deň — načítaj novú hádanku.', new_day: true });
      const err = validate(p, req.body.cells);
      if (err) return res.status(400).json({ error: err });

      const already = await q.one(db.puzzle_solves, { user_id: req.session.uid, date: d });
      if (already) return res.json({ ok: true, already: true, points: 0, message: 'Dnešnú hádanku už máš vyriešenú. 🎉' });

      // Čas meriame zo SERVEROVÉHO štartu. Bez neho (reštart, iné zariadenie)
      // riešenie uznáme, ale nemôže vyhrať deň — inak by stačilo poslať "1 s".
      const st = req.session.puzzle;
      const verified = !!(st && st.date === d && st.at);
      const seconds = verified
        ? Math.max(1, Math.min(3600, Math.round((Date.now() - st.at) / 1000)))
        : Math.max(1, Math.min(3600, Math.round(+req.body.seconds || 0)));

      const capLeft = Math.max(0, c.monthly_cap - await monthPoints(req.session.uid, d.slice(0, 7)));
      let points = c.points + (seconds <= c.fast_seconds ? c.fast_bonus : 0);
      const capped = points > capLeft;
      points = Math.min(points, capLeft);

      const u = await q.one(db.users, { _id: req.session.uid });
      await q.insert(db.puzzle_solves, {
        user_id: req.session.uid, user_name: u ? u.name : '', date: d, month: d.slice(0, 7),
        seconds, points, fast: seconds <= c.fast_seconds, verified, created_at: nowISO(),
      });

      delete req.session.puzzle;
      const rank = await q.count(db.puzzle_solves, { date: d });
      res.json({
        ok: true, points, seconds, rank,
        fast: seconds <= c.fast_seconds,
        capped, month_points: await monthPoints(req.session.uid, d.slice(0, 7)), monthly_cap: c.monthly_cap,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Dnešný rebríček (kto to dal najrýchlejšie) ──
  app.get('/api/puzzle/leaderboard', auth, async (req, res) => {
    try {
      const d = today();
      const rows = (await q.find(db.puzzle_solves, { date: d })).filter(r => r.verified !== false)
        .sort((a, b) => (a.seconds || 0) - (b.seconds || 0)).slice(0, 10)
        .map((r, i) => ({ pos: i + 1, name: r.user_name || 'Tanečníčka', seconds: r.seconds, me: r.user_id === req.session.uid, win: !!r.day_win }));
      res.json({ ok: true, date: d, rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Admin: nastavenia + prehľad ──
  app.get('/api/admin/puzzle', adminAuth, async (req, res) => {
    try {
      const c = await cfg();
      const all = await q.find(db.puzzle_solves, {});
      const m = today().slice(0, 7);
      const thisMonth = all.filter(r => String(r.date || '').startsWith(m));
      res.json({
        ok: true, config: c,
        solves_total: all.length, solves_month: thisMonth.length,
        players_month: new Set(thisMonth.map(r => r.user_id)).size,
        points_month: thisMonth.reduce((s, r) => s + (+r.points || 0), 0),
        avg_seconds: thisMonth.length ? Math.round(thisMonth.reduce((s, r) => s + (+r.seconds || 0), 0) / thisMonth.length) : null,
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
        day_win_min_players: num(req.body.day_win_min_players, cur.day_win_min_players, 1, 50),
      };
      const row = await q.one(db.settings, { key: 'puzzle_config' });
      if (row) await q.update(db.settings, { key: 'puzzle_config' }, { $set: { value: next, at: nowISO() } });
      else await q.insert(db.settings, { key: 'puzzle_config', value: next, at: nowISO() });
      res.json({ ok: true, config: next });
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

  return { puzzleFor, validate, puzzlePointsMap, cfg, awardDayWinner, SIZE };
};
