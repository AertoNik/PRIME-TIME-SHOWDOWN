// Where does the show rating come from? Buckets rating gains by reason per play style.
// Usage: npm run audit
import { RIVAL_ORDER } from '../src/config/fighters';
import type { FighterId } from '../src/config/types';
import { Match } from '../src/combat/Match';
import { runMatch, type Mode } from './bots';

const N = 30;
for (const mode of ['idle', 'mash', 'combo'] as Mode[]) {
  const buckets = new Map<string, number>();
  let finals = 0;
  let peaks = 0;
  let wins = 0;
  let combos = 0;
  const orig = Match.prototype.step;
  for (let i = 0; i < N; i++) {
    const fighter = (['ray', 'bruno', 'nika'] as FighterId[])[i % 3];
    // instrument BroadcastSystem.add via a one-off patch on construction
    const proto = Match.prototype as unknown as { step: typeof orig };
    let patched = false;
    proto.step = function (this: Match, dt: number) {
      if (!patched) {
        patched = true;
        const add = this.broadcast.add.bind(this.broadcast);
        this.broadcast.add = (amount: number, label: string) => {
          const key = label || (amount > 0 ? '(damage/unlabeled+)' : '(unlabeled-)');
          buckets.set(key, (buckets.get(key) ?? 0) + amount);
          add(amount, label);
        };
      }
      orig.call(this, dt);
    };
    const { m } = runMatch(fighter, RIVAL_ORDER[i % 3], 'pro', mode, 77 + i * 131);
    proto.step = orig;
    finals += m.result!.rating;
    peaks += m.result!.peakRating;
    combos += m.result!.combos;
    if (m.result!.outcome === 'win') wins++;
  }
  console.log(`\n== ${mode} (pro): final avg ${(finals / N).toFixed(1)}, peak ${(peaks / N).toFixed(1)}, combos ${(combos / N).toFixed(1)}, win ${((wins / N) * 100).toFixed(0)}%`);
  [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(`  ${k.padEnd(28)} ${(v / N).toFixed(1)}`));
}
