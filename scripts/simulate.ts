// Headless balance check: full duels with no rendering.
// Usage: npm run sim [runsPerCell]
import { RIVAL_ORDER } from '../src/config/fighters';
import type { Difficulty, FighterId } from '../src/config/types';
import { runMatch, type Mode } from './bots';

const N = Number((globalThis as { process?: { argv?: string[] } }).process?.argv?.[2] ?? 30);
const fighters: FighterId[] = ['ray', 'bruno', 'nika', 'vega'];
const diffs: Difficulty[] = ['rookie', 'pro', 'champion'];
const modes: Mode[] = ['idle', 'mash', 'combo'];

console.log(`runs per cell: ${N}  (idle = no cards, mash = random spam, combo = deliberate human-like player)`);
console.log('fighter  diff      mode   win%  ko%   draw% dur   rating combos perf  cards  eCards eCombo');
for (const f of fighters) {
  for (const d of diffs) {
    for (const mode of modes) {
      let win = 0, ko = 0, draw = 0, dur = 0, rating = 0, combos = 0, perf = 0, cards = 0, eCards = 0, eCombos = 0;
      for (let i = 0; i < N; i++) {
        const { m } = runMatch(f, RIVAL_ORDER[i % RIVAL_ORDER.length], d, mode, 1000 + i * 7919);
        const r = m.result!;
        if (r.outcome === 'win') win++;
        if (r.outcome === 'draw') draw++;
        if (r.method === 'ko') ko++;
        dur += r.duration;
        rating += r.rating;
        combos += r.combos;
        perf += r.perfects;
        cards += r.cardsUsed;
        eCards += m.fighters[1].m.cardsUsed;
        eCombos += m.fighters[1].m.combos;
      }
      const p = (v: number) => ((v / N) * 100).toFixed(0).padStart(4);
      const a = (v: number, dg = 1) => (v / N).toFixed(dg).padStart(5);
      console.log(
        `${f.padEnd(8)} ${d.padEnd(9)} ${mode.padEnd(6)} ${p(win)}  ${p(ko)}  ${p(draw)}  ${a(dur, 0)}  ${a(rating, 0)}  ${a(combos)}  ${a(perf)}  ${a(cards)}  ${a(eCards)}  ${a(eCombos)}`,
      );
    }
  }
}
