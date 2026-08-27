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

  // Hamiltonovská cesta cez celú mriežku — náhodné DFS s návratom.
  // Warnsdorff (najmenej voľných susedov najskôr) drží hľadanie rýchle.
  function hamiltonPath(rnd) {
    const start = Math.floor(rnd() * CELLS);
    const seen = new Array(CELLS).fill(false);
    const path = [];
    let steps = 0;
    const free = i => neighbours(i).filter(n => !seen[n]).length;
    function walk(cur) {
      if (++steps > 400000) return false;             // poistka proti zaseknutiu
      seen[cur] = true; path.push(cur);
      if (path.length === CELLS) return true;
      const next = neighbours(cur).filter(n => !seen[n])
        .map(n => ({ n, deg: free(n), r: rnd() }))
        .sort((a, b) => a.deg - b.deg || a.r - b.r);
      for (const { n } of next) if (walk(n)) return true;
      seen[cur] = false; path.pop();
      return false;
    }
    return walk(start) ? path : null;
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
    if (!cache[dateStr]) cache[dateStr] = buildPuzzle(dateStr);
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
  const DEFAULTS = { points: 1, fast_bonus: 1, fast_seconds: 90, monthly_cap: 20, enabled: true };
  async function cfg() {
    const row = await q.one(db.settings, { key: 'puzzle_config' });
    return { ...DEFAULTS, ...(row && row.value || {}) };
  }

  async function monthPoints(userId, month) {
    const rows = await q.find(db.puzzle_solves, { user_id: userId });
    return rows.filter(r => String(r.date || '').startsWith(month))
      .reduce((s, r) => s + (+r.points || 0), 0);
  }

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
        solvers_today: solvers,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Odoslanie riešenia ──
  app.post('/api/puzzle/solve', auth, async (req, res) => {
    try {
      const c = await cfg();
      if (!c.enabled) return res.status(400).json({ error: 'Hlavolam je momentálne vypnutý.' });
      const d = today();
      const p = puzzleFor(d);
      if (!p) return res.status(500).json({ error: 'Hádanku sa nepodarilo pripraviť.' });

      const err = validate(p, req.body.cells);
      if (err) return res.status(400).json({ error: err });

      const already = await q.one(db.puzzle_solves, { user_id: req.session.uid, date: d });
      if (already) return res.json({ ok: true, already: true, points: 0, message: 'Dnešnú hádanku už máš vyriešenú. 🎉' });

      // Čas meriame zo serverového štartu, klientovi neveríme
      const secondsRaw = Math.round((+req.body.seconds || 0));
      const seconds = Math.max(1, Math.min(3600, secondsRaw));

      const capLeft = Math.max(0, c.monthly_cap - await monthPoints(req.session.uid, d.slice(0, 7)));
      let points = c.points + (seconds <= c.fast_seconds ? c.fast_bonus : 0);
      const capped = points > capLeft;
      points = Math.min(points, capLeft);

      const u = await q.one(db.users, { _id: req.session.uid });
      await q.insert(db.puzzle_solves, {
        user_id: req.session.uid, user_name: u ? u.name : '', date: d, month: d.slice(0, 7),
        seconds, points, fast: seconds <= c.fast_seconds, created_at: nowISO(),
      });

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
      const rows = (await q.find(db.puzzle_solves, { date: d }))
        .sort((a, b) => (a.seconds || 0) - (b.seconds || 0)).slice(0, 10)
        .map((r, i) => ({ pos: i + 1, name: r.user_name || 'Tanečníčka', seconds: r.seconds, me: r.user_id === req.session.uid }));
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
      const next = {
        enabled: req.body.enabled !== undefined ? !!req.body.enabled : cur.enabled,
        points: Math.max(0, Math.min(10, +req.body.points ?? cur.points)),
        fast_bonus: Math.max(0, Math.min(10, +req.body.fast_bonus ?? cur.fast_bonus)),
        fast_seconds: Math.max(10, Math.min(600, +req.body.fast_seconds ?? cur.fast_seconds)),
        monthly_cap: Math.max(0, Math.min(200, +req.body.monthly_cap ?? cur.monthly_cap)),
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

  return { puzzleFor, validate, puzzlePointsMap, cfg, SIZE };
};
