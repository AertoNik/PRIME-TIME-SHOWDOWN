import type { SaveData } from '../meta/SaveSystem';
import { FIGHTERS, FIGHTER_ORDER } from './fighters';

// Beta 2.2 — MASTERY ACHIEVEMENTS: four achievements on what the career already measures (no new mode, currency, item or
// paid advantage; nothing new is tracked). Each is read from a MONOTONE number of the save — a best-of or a count that
// never goes down — so it cannot be «reset and earned again»; its reward is claimed ONCE (save.achClaimed: the id is
// written in the same save as the money and the reputation). A producer who already met a condition before Beta 2.2 sees
// the achievement done at once and may claim it once; nothing earlier is taken back or paid twice.
// The rewards sit on the scale of the career's «Цели сезона» (career.ts GOALS: $120–600, 15–60 ★).
// No picture of the owner exists for them yet: they wear the game's drawing (docs/BETA_2_2_DEVELOPMENT_REPORT.md §4).

export type MasteryId = 'mastery-roster' | 'mastery-combo' | 'mastery-rating' | 'mastery-champion';

export interface MasteryDef {
  id: MasteryId;
  title: string;
  desc: string;
  /** The save's progress toward it (current, target). */
  progress: (s: SaveData) => { now: number; target: number };
  reward: { money: number; rep: number };
  /** Why it cannot be farmed (shown in the report, kept next to the rule). */
  antiFarm: string;
  art: 'star' | 'belt' | 'studio';
}

/** The career's fighters: RAY and every fighter with a contract (the seasonal stars LUCIEN / CRAX are not part of it). */
export function careerRoster(): string[] {
  return FIGHTER_ORDER.filter((f) => !FIGHTERS[f].seasonal);
}

export const MASTERY: readonly MasteryDef[] = [
  {
    id: 'mastery-roster',
    title: 'Полный состав',
    desc: 'Подпишите контракты со всеми бойцами карьеры.',
    progress: (s) => {
      const all = careerRoster();
      return { now: all.filter((f) => s.fighters[f as keyof SaveData['fighters']]?.unlocked).length, target: all.length };
    },
    reward: { money: 400, rep: 50 },
    antiFarm: 'контракт подписывается один раз и не отменяется; награда — одна',
    art: 'studio',
  },
  {
    id: 'mastery-combo',
    title: 'Комбо-шоу',
    desc: 'Выполните 6 комбинаций за один бой карьеры.',
    progress: (s) => ({ now: Math.min(6, s.bestCombosInMatch), target: 6 }),
    reward: { money: 250, rep: 25 },
    antiFarm: 'рекорд боя (bestCombosInMatch) только растёт; награда — одна',
    art: 'star',
  },
  {
    id: 'mastery-rating',
    title: 'Идеальный эфир',
    desc: 'Завершите бой карьеры с рейтингом шоу 95 или выше.',
    progress: (s) => ({ now: Math.min(95, s.bestRating), target: 95 }),
    reward: { money: 300, rep: 30 },
    antiFarm: 'лучший рейтинг (bestRating) только растёт; награда — одна',
    art: 'star',
  },
  {
    id: 'mastery-champion',
    title: 'Пять чемпионских эфиров',
    desc: 'Победите 5 раз на сложности «Чемпион».',
    progress: (s) => ({ now: Math.min(5, s.championWins), target: 5 }),
    reward: { money: 500, rep: 50 },
    antiFarm: 'счётчик побед на «Чемпионе» (championWins) только растёт; награда — одна',
    art: 'belt',
  },
];

export const MASTERY_IDS: readonly MasteryId[] = MASTERY.map((m) => m.id);

export function isMasteryId(v: unknown): v is MasteryId {
  return typeof v === 'string' && (MASTERY_IDS as readonly string[]).includes(v);
}
