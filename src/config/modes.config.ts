// Game modes (Alpha 1.3): SURVIVAL marathon and PRIME CHALLENGE special broadcasts.
// Data only. src/meta/GameModes.ts runs the rules; Match receives the per-fight
// modifiers (MatchMods), so every mode uses the same duel engine as Classic Duel.
// New challenges are added by appending to CHALLENGES below (no engine changes).
import type { Difficulty, RivalId } from './types';

/** Reward bundle in the existing producer economy (no new currency). */
export interface ModeReward {
  money: number;
  fans: number;
  rep: number;
}

// ------------------------------------------------------------------ SURVIVAL
export interface SurvivalWave {
  /** Rival AI level for this wave. */
  difficulty: Difficulty;
  /** Extra rival multipliers on top of the difficulty (waves get tougher). */
  hpMult: number;
  dmgMult: number;
  /** Base pay for clearing the wave (fans are scaled by the wave's show rating). */
  reward: ModeReward;
}

export type PerkId = 'second_wind' | 'energy_boost' | 'power_surge';

export interface PerkDef {
  id: PerkId;
  name: string;
  /** Short effect line for the pick card and the HUD. */
  desc: string;
  /** second_wind: HP fraction healed now; energy_boost: +regen; power_surge: +damage. */
  value: number;
  /** How many times it can be taken in one run (bonuses never stack without limit). */
  maxStacks: number;
}

export const PERK_ORDER: PerkId[] = ['second_wind', 'energy_boost', 'power_surge'];

export const PERKS: Record<PerkId, PerkDef> = {
  second_wind: {
    id: 'second_wind',
    name: 'SECOND WIND',
    desc: 'Сразу восстановить ещё 30% здоровья.',
    value: 0.3,
    maxStacks: 4,
  },
  energy_boost: {
    id: 'energy_boost',
    name: 'ENERGY BOOST',
    desc: 'Энергия карт копится на 25% быстрее до конца марафона.',
    value: 0.25,
    maxStacks: 2,
  },
  power_surge: {
    id: 'power_surge',
    name: 'POWER SURGE',
    desc: 'Боец наносит на 12% больше урона до конца марафона.',
    value: 0.12,
    maxStacks: 2,
  },
};

export const SURVIVAL = {
  title: 'SURVIVAL',
  subtitle: 'LAST STAR STANDING',
  tagline: 'Телемарафон: один боец против пяти соперников подряд. Здоровье не восстанавливается полностью — сколько вы продержитесь?',
  /** Five duels in a row, each a little tougher. Tuned with `npm run modes`. */
  waves: [
    { difficulty: 'rookie', hpMult: 0.85, dmgMult: 0.9, reward: { money: 150, fans: 130, rep: 8 } },
    { difficulty: 'rookie', hpMult: 1.0, dmgMult: 1.0, reward: { money: 180, fans: 160, rep: 10 } },
    { difficulty: 'pro', hpMult: 0.9, dmgMult: 0.95, reward: { money: 260, fans: 200, rep: 13 } },
    { difficulty: 'pro', hpMult: 1.0, dmgMult: 1.0, reward: { money: 320, fans: 240, rep: 16 } },
    { difficulty: 'pro', hpMult: 1.1, dmgMult: 1.05, reward: { money: 400, fans: 290, rep: 20 } },
  ] as SurvivalWave[],
  /** HP restored after every cleared wave (fraction of max HP, never above max). */
  healBetween: 0.2,
  /** Money per show-rating point of each cleared wave. */
  ratingMoney: 1.8,
  /** Reputation per show-rating point of each cleared wave. */
  ratingRep: 1 / 16,
  /** All five waves cleared. */
  completion: { money: 500, fans: 400, rep: 25 } as ModeReward,
  /** Paid once per career: the first full clear. */
  firstClear: { money: 600, fans: 0, rep: 40 } as ModeReward,
  /** No wave cleared: a small appearance fee (same idea as the classic loss purse). */
  participation: { money: 60, fans: 40, rep: 2 } as ModeReward,
};

// ----------------------------------------------------------- PRIME CHALLENGE
export type ChallengeRecord = 'combos' | 'fastest' | 'rating';

export interface ChallengeDef {
  id: string;
  title: string;
  /** Host's line on the challenge card. */
  quote: string;
  /** Rules shown before the start (and on the prep screen). */
  rules: string[];
  /** Fixed opponent so records stay comparable. */
  rival: RivalId;
  /** Per-fight modifiers (only inside this challenge). */
  mods: {
    /** Fight length in seconds (Classic: 75). */
    duration?: number;
    /** Player energy regeneration multiplier. */
    energyMult?: number;
    /** Rival energy regeneration multiplier (kept lower so the rival stays fair, not overwhelming). */
    rivalEnergyMult?: number;
  };
  /** Clear condition, checked after the fight. */
  goal: {
    /** Win the duel (always required). */
    win: true;
    /** Minimum final show rating. */
    minRating?: number;
    /** On time-up the win counts only with this HP lead (fraction of max HP). */
    timeUpMargin?: number;
  };
  /** Short goal text (HUD strip, challenge list). */
  goalShort: string;
  /** Compact name for the HUD strip on narrow phones. */
  hudTag: string;
  /** What the personal best measures. */
  record: ChallengeRecord;
  /** Multiplier on the regular match money (higher stakes). */
  moneyMult: number;
  /** Paid once, on the first clear. */
  firstClear: { money: number; rep: number };
  icon: 'energy_rush' | 'high_stakes' | 'spotlight';
}

export const CHALLENGES: ChallengeDef[] = [
  {
    id: 'energy_rush',
    title: 'ENERGY RUSH',
    quote: 'Энергия восстанавливается быстрее. Время устроить настоящее шоу!',
    rules: [
      'Ваша энергия карт копится в 1,5 раза быстрее.',
      'Соперник тоже ускорен, но меньше: его энергия ×1,25.',
      'Обычный бой: 75 секунд, победа по стандартным правилам.',
      'Цель: победить.',
    ],
    rival: 'zoe',
    mods: { energyMult: 1.5, rivalEnergyMult: 1.25 },
    goal: { win: true },
    goalShort: 'ПОБЕДА',
    hudTag: 'ENERGY RUSH',
    record: 'combos',
    moneyMult: 1,
    firstClear: { money: 300, rep: 25 },
    icon: 'energy_rush',
  },
  {
    id: 'high_stakes',
    title: 'HIGH STAKES',
    quote: 'Времени меньше, ставки выше. Каждая секунда решает исход эфира!',
    rules: [
      'Бой длится 55 секунд вместо 75.',
      'Нокаут — победа сразу.',
      'Если время вышло: победа засчитывается, только если у вас больше здоровья хотя бы на 10% от максимума.',
      'Гонорар за бой ×1,25.',
    ],
    rival: 'crash',
    mods: { duration: 55 },
    goal: { win: true, timeUpMargin: 0.1 },
    goalShort: 'ПОБЕДА ЗА 55\u00a0С',
    hudTag: 'HIGH STAKES',
    record: 'fastest',
    moneyMult: 1.25,
    firstClear: { money: 400, rep: 30 },
    icon: 'high_stakes',
  },
  {
    id: 'spotlight',
    title: 'PRIME SPOTLIGHT',
    quote: 'Одной победы мало. Сделай такой бой, который запомнят зрители!',
    rules: [
      'Обычный бой: 75 секунд.',
      'Цель: победить И закончить эфир с рейтингом шоу 80 или выше.',
      'Рейтинг растёт за комбо, идеальные реакции, мощные попадания и эффектный финиш.',
    ],
    rival: 'dex',
    mods: {},
    goal: { win: true, minRating: 80 },
    goalShort: 'ПОБЕДА + РЕЙТИНГ\u00a080',
    hudTag: 'SPOTLIGHT',
    record: 'rating',
    moneyMult: 1,
    firstClear: { money: 450, rep: 35 },
    icon: 'spotlight',
  },
];

export function challengeById(id: string): ChallengeDef | null {
  return CHALLENGES.find((c) => c.id === id) ?? null;
}
