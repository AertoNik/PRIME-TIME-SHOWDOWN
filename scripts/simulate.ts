// Headless balance check: runs full duels with no rendering.
// Usage: npm run sim
import { Match, type MatchConfig } from '../src/combat/Match';
import { FIGHTERS, RIVAL_ORDER } from '../src/config/fighters';
import type { Difficulty, FighterId } from '../src/config/types';

type Mode = 'idle' | 'mash' | 'smart';

const MODES: Record<Mode, MatchConfig['autoPlayer']> = {
  idle: undefined,
  mash: { behavior: 'aggressive', smarts: 0, dodge: 0.2, reaction: 0.6 },
  smart: { behavior: 'tactical', smarts: 0.95, dodge: 0.65, reaction: 0.4, eagerness: 1.5 },
};

function runOne(fighter: FighterId, difficulty: Difficulty, mode: Mode, seed: number) {
  const rival = RIVAL_ORDER[seed % RIVAL_ORDER.length];
  const m = new Match({
    fighter,
    deck: FIGHTERS[fighter].defaultDeck,
    rival,
    difficulty,
    seed: 1000 + seed * 7919,
    fans: 500,
    autoPlayer: MODES[mode],
  });
  let steps = 0;
  while (m.phase !== 'over' && steps < 60 * 120) {
    m.step(1 / 60);
    m.drainEvents();
    steps++;
  }
  return { r: m.result!, rival, enemyCards: m.fighters[1].m.cardsUsed, enemyCombos: m.fighters[1].m.combos };
}

const N = Number((globalThis as { process?: { argv?: string[] } }).process?.argv?.[2] ?? 60);
const fighters: FighterId[] = ['ray', 'bruno', 'nika'];
const diffs: Difficulty[] = ['rookie', 'pro', 'champion'];
const modes: Mode[] = ['idle', 'mash', 'smart'];

console.log(`runs per cell: ${N}`);
console.log('fighter  diff      mode   win%  ko%   draw% dur   rating combos perf  cards  eCards eCombo');
for (const f of fighters) {
  for (const d of diffs) {
    for (const mode of modes) {
      let win = 0, ko = 0, draw = 0, dur = 0, rating = 0, combos = 0, perf = 0, cards = 0, eCards = 0, eCombos = 0;
      for (let i = 0; i < N; i++) {
        const { r, enemyCards, enemyCombos } = runOne(f, d, mode, i);
        if (r.outcome === 'win') win++;
        if (r.outcome === 'draw') draw++;
        if (r.method === 'ko') ko++;
        dur += r.duration;
        rating += r.rating;
        combos += r.combos;
        perf += r.perfects;
        cards += r.cardsUsed;
        eCards += enemyCards;
        eCombos += enemyCombos;
      }
      const p = (v: number) => ((v / N) * 100).toFixed(0).padStart(4);
      const a = (v: number, dg = 1) => (v / N).toFixed(dg).padStart(5);
      console.log(
        `${f.padEnd(8)} ${d.padEnd(9)} ${mode.padEnd(6)} ${p(win)}  ${p(ko)}  ${p(draw)}  ${a(dur, 0)}  ${a(rating, 0)}  ${a(combos)}  ${a(perf)}  ${a(cards)}  ${a(eCards)}  ${a(eCombos)}`,
      );
    }
  }
}
