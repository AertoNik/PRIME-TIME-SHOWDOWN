// Producer career: economy, levels, goals. Kept intentionally small and readable.

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

export const REWARDS = {
  purse: { win: 150, draw: 80, loss: 50 },
  koBonus: 40,
  /** Money per point of final show rating. */
  ratingMoney: 2.2,
  comboMoney: 25,
  comboCap: 5,
  /** Star power: sponsor money scales with the fighter's fame. */
  starPowerK: 1.25,
  starPowerCap: 240,
  fans: { win: 220, draw: 120, loss: 70 },
  /** fans multiplier = base + rating/100 * k */
  fansRatingBase: 0.35,
  fansRatingK: 1.65,
  rep: { win: 14, draw: 7, loss: 4 },
  repRatingDiv: 8,
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
