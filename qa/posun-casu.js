/**
 * Preload pre QA: posunie hodiny procesu na FAKE_NOW (ISO čas) — od toho
 * okamihu plynú ďalej normálne. Používa sa cez `node -r ./qa/posun-casu.js`,
 * aby sa dali overiť chyby, ktoré sa ukážu len v istú hodinu (napr. po polnoci).
 * Bez FAKE_NOW nerobí nič.
 */
if (process.env.FAKE_NOW) {
  const Skutocny = Date;
  const posun = Skutocny.parse(process.env.FAKE_NOW) - Skutocny.now();
  if (Number.isNaN(posun)) throw new Error('FAKE_NOW nie je platný čas: ' + process.env.FAKE_NOW);
  class PosunutyDate extends Skutocny {
    constructor(...a) { if (a.length === 0) super(Skutocny.now() + posun); else super(...a); }
    static now() { return Skutocny.now() + posun; }
  }
  global.Date = PosunutyDate;
}
