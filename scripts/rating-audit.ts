// Where does the show rating come from? Runs bots and buckets rating gains by reason.
import { Match, type MatchConfig } from '../src/combat/Match';
import { FIGHTERS, RIVAL_ORDER } from '../src/config/fighters';
import type { FighterId } from '../src/config/types';

const MODES: Record<string, MatchConfig['autoPlayer']> = {
  idle: undefined,
  mash: { behavior: 'aggressive', smarts: 0, dodge: 0.2, reaction: 0.6, eagerness: 1.6 },
  smart: { behavior: 'tactical', smarts: 0.95, dodge: 0.65, reaction: 0.4, eagerness: 1.2 },
};

for (const mode of Object.keys(MODES)) {
  const buckets = new Map<string, number>();
  let total = 0;
  let finals = 0;
  let peaks = 0;
  const N = 30;
  for (let i = 0; i < N; i++) {
    const fighter: FighterId = (['ray', 'bruno', 'nika'] as FighterId[])[i % 3];
    const m = new Match({
      fighter,
      deck: FIGHTERS[fighter].defaultDeck,
      rival: RIVAL_ORDER[i % 3],
      difficulty: 'rookie',
      seed: 77 + i * 131,
      fans: 500,
      autoPlayer: MODES[mode],
    });
    const orig = m.broadcast.add.bind(m.broadcast);
    m.broadcast.add = (amount: number, label: string) => {
      const key = label || (amount > 0 ? '(damage/unlabeled+)' : '(unlabeled-)');
      buckets.set(key, (buckets.get(key) ?? 0) + amount);
      total += amount;
      orig(amount, label);
    };
    let steps = 0;
    while (m.phase !== 'over' && steps < 60 * 120) {
      m.step(1 / 60);
      m.drainEvents();
      steps++;
    }
    finals += m.result!.rating;
    peaks += m.result!.peakRating;
  }
  console.log(`\n== ${mode}: final avg ${(finals / N).toFixed(1)}, peak avg ${(peaks / N).toFixed(1)}, gains/match ${(total / N).toFixed(1)}`);
  [...buckets.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(28)} ${(v / N).toFixed(1)}`));
}

// Deliberate combo player: banks energy for a combo pair, reacts to telegraphs.
import { CARDS, COMBOS } from '../src/config/cards';
import type { Difficulty } from '../src/config/types';
function comboRun(difficulty: Difficulty) {
  let finals = 0;
  let combos = 0;
  let wins = 0;
  let dur = 0;
  const N = 30;
  for (let i = 0; i < N; i++) {
    const fighter: FighterId = (['ray', 'bruno', 'nika'] as FighterId[])[i % 3];
    const m = new Match({ fighter, deck: FIGHTERS[fighter].defaultDeck, rival: RIVAL_ORDER[i % 3], difficulty, seed: 991 + i * 37, fans: 500 });
    let steps = 0;
    let think = 0;
    while (m.phase !== 'over' && steps < 60 * 120) {
      m.step(1 / 60);
      m.drainEvents();
      steps++;
      if (m.phase !== 'fight') continue;
      think -= 1 / 60;
      if (think > 0) continue;
      think = 0.25;
      const h = m.hands[0];
      const foe = m.fighters[1];
      // react to telegraph
      if (foe.action.kind === 'windup') {
        const di = h.hand.indexOf('dash');
        const si = h.hand.indexOf('shield');
        if (di >= 0 && h.energy >= 2 && foe.action.t > foe.action.total * 0.7) { m.playCard(0, di); continue; }
        if (si >= 0 && h.energy >= 3) { m.playCard(0, si); continue; }
      }
      // finish a primed combo
      let played = false;
      for (let k = 0; k < 3; k++) {
        const c = h.hand[k];
        if (m.combos.wouldCombo(0, c, m.time) && h.energy >= CARDS[c].cost) { m.playCard(0, k); played = true; break; }
      }
      if (played) continue;
      // open a combo if we can afford both soon
      for (const cb of COMBOS) {
        const a = h.hand.findIndex((c) => cb.first.includes(c));
        const b = h.hand.findIndex((c) => cb.second.includes(c));
        if (a >= 0 && b >= 0 && h.energy >= CARDS[h.hand[a]].cost + CARDS[h.hand[b]].cost - 2) { m.playCard(0, a); played = true; break; }
      }
      if (!played && h.energy >= 9.5) m.playCard(0, 0);
    }
    finals += m.result!.rating;
    combos += m.result!.combos;
    wins += m.result!.outcome === 'win' ? 1 : 0;
    dur += m.result!.duration;
  }
  console.log(`== combo-player ${difficulty}: final avg ${(finals / N).toFixed(1)}, combos ${(combos / N).toFixed(1)}, win ${((wins / N) * 100).toFixed(0)}%, dur ${(dur / N).toFixed(0)}s`);
}
comboRun('rookie');
comboRun('pro');
comboRun('champion');
