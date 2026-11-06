// Producer career: economy, levels, goals. Kept intentionally small and readable.
import type { CosmeticId } from './cosmetics.config';
import type { Difficulty } from './types';

export const CAREER_START = {
  orgName: 'NEON NIGHT PRODUCTIONS',
  money: 150,
  reputation: 0,
};

/** Reputation needed to reach each producer level (index 0 = level 1). */
export const LEVEL_THRESHOLDS = [0, 60, 150, 290, 480, 720, 1020, 1400, 1850, 2400];

export const LEVEL_TITLES = [
  'Стажёр эфира',
  'Ассистент продюсера',
  'Продюсер',
  'Старший продюсер',
  'Шоураннер',
  'Глава канала',
  'Медиамагнат',
  'Король прайм-тайма',
  'Икона эфира',
  'Легенда ТВ',
];

export const REWARDS: {
  purse: { win: number; draw: number; loss: number };
  koBonus: number;
  ratingMoney: number;
  comboMoney: number;
  comboCap: number;
  starPowerK: number;
  starPowerCap: number;
  fans: { win: number; draw: number; loss: number };
  fansRatingBase: number;
  fansRatingK: number;
  rep: { win: number; draw: number; loss: number };
  repRatingDiv: number;
  /** 1.9.6: the money multiplier of each difficulty (absent: the difficulty's own rewardMult, as before 1.9.6). */
  difficultyMoney?: Partial<Record<Difficulty, number>>;
} = {
  purse: { win: 150, draw: 80, loss: 50 },
  koBonus: 40,
  /** Money per point of final show rating. */
  ratingMoney: 2.2,
  comboMoney: 25,
  comboCap: 5,
  /**
   * Star power: sponsor money scales with the fighter's fame. 1.9.6: capped at 160 (was 240) — the cap only touches a
   * fighter past ~16 000 fans (a veteran), never a beginner's (scripts/economy-model.ts).
   */
  starPowerK: 1.25,
  starPowerCap: 160,
  fans: { win: 220, draw: 120, loss: 70 },
  /** fans multiplier = base + rating/100 * k */
  fansRatingBase: 0.35,
  fansRatingK: 1.65,
  rep: { win: 14, draw: 7, loss: 4 },
  repRatingDiv: 8,
  /**
   * 1.9.6 — the dollars of a fight by difficulty (was the difficulty's ×1 / ×1.6 / ×2.4, which made a skilled player's
   * fights pay 2–2.5 times a beginner's). «Новичок» pays as before; harder fights still pay more, only less steeply. Fans
   * and reputation keep ×1.6 / ×2.4. Together with the progressive prices (src/config/careerPrices.ts) the purchases of a
   * career stretch for every kind of player about alike, a beginner's a little less (docs/ALPHA_1_9_6_FINAL_STAGING_REPORT.md).
   */
  difficultyMoney: { rookie: 1, pro: 1.3, champion: 1.6 },
};

export type GoalId =
  | 'first_win'
  | 'rating_70'
  | 'combo_3'
  | 'perfect_3'
  | 'fans_2500'
  | 'sign_second'
  | 'pro_win'
  | 'champion_win';

export interface GoalDef {
  id: GoalId;
  title: string;
  desc: string;
  target: number;
  reward: { money: number; rep: number };
}

export const GOALS: GoalDef[] = [
  { id: 'first_win', title: 'Дебют в эфире', desc: 'Выиграйте первый бой.', target: 1, reward: { money: 150, rep: 15 } },
  { id: 'combo_3', title: 'Мастер комбо', desc: 'Выполните 3 комбинации за один матч.', target: 3, reward: { money: 200, rep: 15 } },
  { id: 'rating_70', title: 'Золотой рейтинг', desc: 'Завершите бой с рейтингом шоу 70+.', target: 70, reward: { money: 200, rep: 20 } },
  {
    id: 'perfect_3',
    title: 'Идеальный тайминг',
    desc: 'За один матч: 3 идеальных уклонения, блока или прерывания.',
    target: 3,
    reward: { money: 200, rep: 15 },
  },
  { id: 'fans_2500', title: 'Восходящая звезда', desc: 'Привлеките 2 500 новых фанатов.', target: 2500, reward: { money: 250, rep: 20 } },
  { id: 'sign_second', title: 'Расширение состава', desc: 'Подпишите контракт со вторым бойцом.', target: 2, reward: { money: 120, rep: 30 } },
  { id: 'pro_win', title: 'Большая лига', desc: 'Победите на сложности «Профи».', target: 1, reward: { money: 300, rep: 30 } },
  { id: 'champion_win', title: 'Чемпион прайм-тайма', desc: 'Победите на сложности «Чемпион».', target: 1, reward: { money: 600, rep: 60 } },
];

/** Fighter fame tiers (by fans). */
export const FAME_TIERS = [
  { min: 0, label: 'Новичок' },
  { min: 1000, label: 'Восходящая звезда' },
  { min: 5000, label: 'Звезда шоу' },
  { min: 20000, label: 'Суперзвезда' },
  { min: 100000, label: 'Легенда' },
];

// ------------------------------------------------------------ career stages
/**
 * Alpha 1.5: the producer's prestige path. Each stage is reached when ALL its
 * milestones are met (and the previous stage is reached). Milestones read the
 * real career counters of the save, so a long-running career is recognised at
 * once; each stage's reward is paid once (save.careerClaimed).
 */
export type StageId = 'rookie' | 'rising' | 'star' | 'legendary';
export type MilestoneMetric = 'wins' | 'fansEarned' | 'signed' | 'bestRating' | 'proWins' | 'championWins' | 'survivalClears' | 'challengeClears' | 'bossWins';

export interface MilestoneDef {
  metric: MilestoneMetric;
  target: number;
  label: string;
}

export interface StageDef {
  id: StageId;
  /** On-air name of the stage. */
  title: string;
  /** Short label for the stage track. */
  short: string;
  subtitle: string;
  desc: string;
  milestones: MilestoneDef[];
  reward: { money: number; rep: number; cosmetic?: CosmeticId } | null;
}

export const CAREER_STAGES: StageDef[] = [
  {
    id: 'rookie',
    title: 'ROOKIE PRODUCER',
    short: 'ROOKIE',
    subtitle: 'Начинающий продюсер',
    desc: 'Первое шоу в сетке канала: маленький павильон, один боец и большие планы.',
    milestones: [],
    reward: null,
  },
  {
    id: 'rising',
    title: 'RISING BROADCAST',
    short: 'RISING',
    subtitle: 'Шоу набирает аудиторию',
    desc: 'О вашем эфире начинают говорить: зрители возвращаются, спонсоры звонят сами.',
    milestones: [
      { metric: 'wins', target: 10, label: 'Победы в эфире' },
      { metric: 'fansEarned', target: 5000, label: 'Новые фанаты' },
      { metric: 'signed', target: 2, label: 'Бойцы в составе' },
      { metric: 'bestRating', target: 70, label: 'Лучший рейтинг шоу' },
    ],
    reward: { money: 600, rep: 40 },
  },
  {
    id: 'star',
    title: 'PRIME TIME STAR',
    short: 'STAR',
    subtitle: 'Звезда прайм-тайма',
    desc: 'Шоу в лучшем эфирном времени: громкий состав, марафоны и испытания канала.',
    milestones: [
      { metric: 'fansEarned', target: 20000, label: 'Новые фанаты' },
      { metric: 'signed', target: 4, label: 'Бойцы в составе' },
      { metric: 'proWins', target: 5, label: 'Победы на «Профи»' },
      { metric: 'survivalClears', target: 1, label: 'Пройденный Survival' },
      { metric: 'challengeClears', target: 2, label: 'Пройденные Prime Challenge' },
    ],
    reward: { money: 1500, rep: 80, cosmetic: 'title_prime_star' },
  },
  {
    id: 'legendary',
    title: 'LEGENDARY PRODUCTION',
    short: 'LEGENDARY',
    subtitle: 'Легендарное производство',
    desc: 'Главное событие индустрии: полный состав звёзд и победа над самой легендой шоу.',
    milestones: [
      { metric: 'fansEarned', target: 60000, label: 'Новые фанаты' },
      { metric: 'signed', target: 6, label: 'Бойцы в составе' },
      { metric: 'championWins', target: 3, label: 'Победы на «Чемпионе»' },
      { metric: 'challengeClears', target: 3, label: 'Все Prime Challenge' },
      { metric: 'bossWins', target: 1, label: 'Победа над Виктором' },
      { metric: 'bestRating', target: 90, label: 'Лучший рейтинг шоу' },
    ],
    reward: { money: 3000, rep: 150, cosmetic: 'frame_legendary' },
  },
];
