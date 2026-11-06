// Alpha 1.9.6 — real fights for the economy model (scripts/economy-model.ts, scripts/economy-check.ts).
//
// Headless career fights of the game itself (src/combat/Match through scripts/bots.ts — no rendering), each one paid by
// the game's own CareerSystem.computeRewards. The model then draws from these measured results instead of guessing an
// «average match». Deterministic: fixed seeds, the same samples every run.
import { FIGHTERS, RIVAL_ORDER } from '../../src/config/fighters';
import type { Difficulty, FighterId } from '../../src/config/types';
import type { MatchResultData } from '../../src/combat/types';
import { CareerSystem } from '../../src/meta/CareerSystem';
import { defaultSave, sanitize, type SaveData, type SaveSystem } from '../../src/meta/SaveSystem';
import { runMatch, type Mode } from '../bots';

export class MemSave {
  data: SaveData = defaultSave();
  save(): void {
    this.data = sanitize(JSON.parse(JSON.stringify(this.data)));
  }
  get persistent(): boolean {
    return true;
  }
  reset(): void {
    this.data = defaultSave();
  }
}

/** One measured fight: what the career pays for it (at a given fighter fame) and how long it took. */
export interface FightSample {
  outcome: MatchResultData['outcome'];
  method: MatchResultData['method'];
  rating: number;
  combos: number;
  perfects: number;
  /** Seconds of fight (the match clock); a real session adds menus and the result screen (see SESSION_OVERHEAD_S). */
  seconds: number;
  result: MatchResultData;
}

/** Menu, intro, result screen and rewards between two fights (seconds) — a conservative human figure. */
export const SESSION_OVERHEAD_S = 35;

/** Skill of the simulated player: 'mash' — taps cards as they come (a beginner); 'combo' — the human-like bot. */
export type Skill = 'mash' | 'combo';

const FIGHTERS4: FighterId[] = ['ray', 'bruno', 'nika', 'vega'];

/** `n` real fights per (difficulty, skill), the four original fighters against the career rivals in turn. */
export function sampleFights(n = 24): Record<Difficulty, Record<Skill, FightSample[]>> {
  const out = {} as Record<Difficulty, Record<Skill, FightSample[]>>;
  for (const diff of ['rookie', 'pro', 'champion'] as Difficulty[]) {
    out[diff] = { mash: [], combo: [] };
    for (const skill of ['mash', 'combo'] as Skill[]) {
      for (let i = 0; i < n; i++) {
        const fighter = FIGHTERS4[i % FIGHTERS4.length];
        const rival = RIVAL_ORDER[i % RIVAL_ORDER.length];
        const { m } = runMatch(fighter, rival, diff, skill as Mode, 9001 + i * 7919 + (diff === 'pro' ? 1 : diff === 'champion' ? 2 : 0) * 104729);
        const r = m.result!;
        out[diff][skill].push({ outcome: r.outcome, method: r.method, rating: r.rating, combos: r.combos, perfects: r.perfects, seconds: r.duration, result: r });
      }
    }
  }
  return out;
}

/** What the career pays for `s` with a fighter of `fans` fans (the game's own formula — CareerSystem.computeRewards). */
export function payOf(s: FightSample, diff: Difficulty, fans: number): { money: number; fans: number; rep: number } {
  const store = new MemSave();
  store.data.fighters.ray.fans = fans;
  const c = new CareerSystem(store as unknown as SaveSystem);
  const r = c.computeRewards(s.result, 'ray', diff);
  return { money: r.money, fans: r.fans, rep: r.rep };
}

export { FIGHTERS };
