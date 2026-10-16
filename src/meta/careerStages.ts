import { CAREER_STAGES, type MilestoneDef, type MilestoneMetric, type StageDef, type StageId } from '../config/career';
import { CHALLENGES } from '../config/modes.config';
import { FIGHTER_ORDER } from '../config/fighters';
import type { SaveData } from './SaveSystem';

// Alpha 1.5: the producer's career stages, read straight from the save's real
// counters (wins, fans, contracts, mode records). Nothing here is stored: only
// the "reward paid" marks live in save.careerClaimed.

export interface MilestoneView {
  def: MilestoneDef;
  value: number;
  done: boolean;
}

export interface StageView {
  def: StageDef;
  index: number;
  /** All milestones met and the previous stage reached. */
  reached: boolean;
  /** Reward already paid (stages without a reward count as claimed). */
  claimed: boolean;
  milestones: MilestoneView[];
}

export function milestoneValue(s: SaveData, metric: MilestoneMetric): number {
  switch (metric) {
    case 'wins':
      return s.wins;
    case 'fansEarned':
      return s.fansEarned;
    case 'signed':
      return FIGHTER_ORDER.filter((id) => s.fighters[id]?.unlocked).length;
    case 'bestRating':
      return s.bestRating;
    case 'proWins':
      return s.proWins;
    case 'championWins':
      return s.championWins;
    case 'survivalClears':
      return s.modes.survival.completions;
    case 'challengeClears':
      return CHALLENGES.filter((c) => (s.modes.challenges[c.id]?.firstClearAt ?? 0) > 0).length;
    case 'bossWins':
      return Object.values(s.modes.boss).reduce((a, b) => a + b.wins, 0);
  }
}

/** Every stage with its milestones; stages are reached in order. */
export function careerStages(s: SaveData): StageView[] {
  let prevReached = true;
  return CAREER_STAGES.map((def, index) => {
    const milestones = def.milestones.map((m) => {
      const value = milestoneValue(s, m.metric);
      return { def: m, value, done: value >= m.target };
    });
    const reached = prevReached && milestones.every((m) => m.done);
    prevReached = reached;
    return { def, index, reached, claimed: !def.reward || s.careerClaimed.includes(def.id), milestones };
  });
}

/** The highest stage reached (ROOKIE PRODUCER at least). */
export function currentStage(s: SaveData): StageView {
  const all = careerStages(s);
  let cur = all[0];
  for (const st of all) if (st.reached) cur = st;
  return cur;
}

export function stageById(id: StageId): StageDef | undefined {
  return CAREER_STAGES.find((st) => st.id === id);
}
