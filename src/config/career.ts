// Producer career: economy, levels, goals. Kept intentionally small and readable.
import type { CosmeticId } from './cosmetics.config';
import type { Difficulty } from './types';

export const CAREER_START = {
  orgName: 'NEON NIGHT PRODUCTIONS',
  money: 150,
  reputation: 0,
};

/**
 * Reputation needed to reach each producer level (index 0 = level 1).
 *
 * Levels 1–10 (Alpha 1.0–1.9) are untouched: they gate the difficulties, contracts and career cards (levels 2–6).
 * Beta 2.0 — the career goes on past 10: levels 11–20 are titles only (no unlocks, no rewards — rewards come with
 * Beta 2.1). A level is never stored: it is read from the reputation every time (levelFor, SaveSystem.summarize), so a
 * veteran gets his level at once and no save changes. Steps grow ~22 % a level (700 → 4 400 ★); with the measured
 * pace of `npm run economy` (Beta 2.0 report) a regular player (5 days a week) reaches 11 about 4 days after 10 and 20
 * in ~5½ months, an active one in ~2 months, a beginner (3 short days a week) climbs one level every 1–2 months.
 * A later level: append here (thresholds only grow) and, when its picture exists, to LEVEL_ART (src/ui/careerArt.ts).
 */
// Beta 2.1 (npm run careerpace): levels 11–20 re-paced — each level takes ONE more play day than the one before for a
// regular player (≈3 → ≈12 days) instead of a wait that grew to 23 play days; level 20 at ≈ day 120 instead of 167. Every
// threshold is at or below Beta 2.0's (3100 … 23200), so no producer ever drops a level; levels 1–10 are untouched.
export const LEVEL_THRESHOLDS = [0, 60, 150, 290, 480, 720, 1020, 1400, 1850, 2400, 3060, 3900, 4950, 6250, 7700, 9400, 11300, 13450, 15750, 18300];
/** Beta 2.0's thresholds (for the checks: the re-pace may only lower them). */
export const LEVEL_THRESHOLDS_200 = [0, 60, 150, 290, 480, 720, 1020, 1400, 1850, 2400, 3100, 3950, 5000, 6300, 7900, 9850, 12250, 15200, 18800, 23200];

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
  // Beta 2.0
  'Продюсер года',
  'Хитмейкер',
  'Хозяин рейтингов',
  'Архитектор эфира',
  'Звезда индустрии',
  'Медиаимператор',
  'Титан телевидения',
  'Легенда прайм-тайма',
  'Бессмертный эфир',
  'Зал славы ТВ',
];

/** The levels of Alpha 1.0–1.9 (the ones that open things). */
export const CLASSIC_LEVELS = 10;

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
  /** Beta 2.5.5: what a voluntary exit (forfeit) gives — nothing (see below). */
  forfeit: { money: 0; fans: 0; rep: 0 };
} = {
  /**
   * Beta 2.5.5 — PROGRESSION: a fight pays about a fifth of Beta 2.5's dollars, and a win clearly more than a loss
   * (×3 on «Профи», was ×2): every contract and card took 43–58 fights (1.4–1.7 h), now ~175 for a regular player and
   * 170–190 for everyone, the first purchase still in 1–2 fights (`npm run economy:255`, docs/BETA_2_5_5_ECONOMY_REPORT.md).
   * Reputation and fans are unchanged — the producer levels keep their pace. Beta 2.5: purse 150 / 80 / 50, KO 40,
   * rating 2.2 $ a point, combo 25 $, sponsors 1.25·√fans up to 160.
   */
  purse: { win: 60, draw: 25, loss: 10 },
  koBonus: 12,
  /** Money per point of final show rating. */
  ratingMoney: 0.3,
  comboMoney: 4,
  comboCap: 5,
  /**
   * Star power: sponsor money scales with the fighter's fame. 1.9.6: capped at 160 (was 240) — the cap only touches a
   * fighter past ~16 000 fans (a veteran), never a beginner's (scripts/economy-model.ts).
   */
  starPowerK: 0.25,
  starPowerCap: 35,
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
  /**
   * Beta 2.5.5 — a VOLUNTARY EXIT («Выйти из боя» in the pause) is allowed at any second and gives nothing: no dollars,
   * fans or reputation, no goal progress (best rating / combos / perfects stay), the season's canes are 0 on the server
   * as before. It counts as a technical loss (the win streak ends). Until 2.5 a forfeit paid up to 30 % of a loss after
   * the first 15 s («Бой идёт меньше 15 с…»). A fight that was never finished (the page closed, the connection lost,
   * Safari reloaded the tab) is not applied at all — no reward and no penalty, as before.
   */
  forfeit: { money: 0, fans: 0, rep: 0 },
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
