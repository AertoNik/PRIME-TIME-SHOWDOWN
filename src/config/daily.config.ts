// Alpha 1.8.9 — DAILY PRIME STREAK («ЕЖЕДНЕВНЫЙ ЭФИР»): one reward per game day for a verified PRIME ID, a long
// streak with milestones 7 / 14 / 30 / 60 / 100 that goes on after day 100.
//
// The ONE place for the numbers and the rules. The PRIME NETWORK server applies them (backend/pb_hooks/lib/
// daily_rules.js is generated from this file by `npm run backend:rules`; lib/daily.js decides the day, the streak
// and the reward and writes the dollars into the cloud save itself — the game never names a day or an amount).
// The game reads this file only to show what is coming.
//
// Balance (docs/DAILY_PRIME_STREAK.md): a rookie win pays ≈ 400–450 $, contracts cost 500–1 800 $ (6 000 $ in all)
// and the fifteen shop cards 250–750 $ (6 950 $). A full week of visits gives 1 075 $ — about two and a half
// rookie wins, one contract; the first month ≈ 5 300 $. Contracts and cards also wait for the producer's level,
// so daily dollars help, but the career is still the way to grow.

export interface DailyMilestone {
  /** The streak day it falls on. */
  day: number;
  money: number;
  /** The headline of the celebration («7 ДНЕЙ В ЭФИРЕ!»). */
  title: string;
  /** A short name on the milestone track. */
  short: string;
}

export const DAILY = {
  /** The game day is Moscow's calendar day (UTC+3, no daylight saving) — the same clock as PRIME_DEMO_UNTIL. */
  utcOffsetMinutes: 180,
  /** Each week of the streak, day 1…7; day 7 is the weekly gift. */
  week: [75, 100, 125, 100, 150, 125, 250],
  weekLabels: ['Гонорар за выход в эфир', 'Утренний эфир', 'Бонус спонсора', 'Дневной эфир', 'Повышенный гонорар', 'Вечерний эфир', 'Еженедельный подарок'],
  /** Milestone days replace that day's ordinary reward. */
  milestones: [
    { day: 7, money: 400, title: '7 ДНЕЙ В ЭФИРЕ!', short: 'Неделя' },
    { day: 14, money: 600, title: 'ДВЕ НЕДЕЛИ В ЭФИРЕ!', short: '2 недели' },
    { day: 30, money: 1000, title: 'МЕСЯЦ В ПРАЙМ-ТАЙМЕ!', short: 'Месяц' },
    { day: 60, money: 1500, title: '60 ДНЕЙ — ЗОЛОТОЙ СЕЗОН!', short: 'Сезон' },
    { day: 100, money: 2500, title: '100 ДНЕЙ В ЭФИРЕ — ЛЕГЕНДА!', short: 'Легенда' },
  ] as DailyMilestone[],
  /** After day 100 the streak goes on; every 100th day (200, 300, …) is a jubilee of its own. */
  jubileeEvery: 100,
  jubileeMoney: 2500,
  /** One missed day is forgiven for free — at most once in this many calendar days. */
  shieldDays: 7,
  /** Claims the server keeps in the account's visible history (all of them stay in the database). */
  historyShown: 10,
  /** Upcoming days shown as cards in the window. */
  upcoming: 7,
} as const;

export type DailyKind = 'daily' | 'weekly' | 'milestone';

export interface DailyReward {
  /** The streak day this reward belongs to. */
  day: number;
  money: number;
  kind: DailyKind;
  /** The milestone day (7, 14, 30, 60, 100, 200 …) or 0. */
  milestone: number;
  label: string;
}

/** What the streak's day `n` (1, 2, 3 …) pays — the same table the server applies. */
export function dailyReward(n: number): DailyReward {
  const day = Math.max(1, Math.floor(n));
  const m = DAILY.milestones.find((x) => x.day === day);
  if (m) return { day, money: m.money, kind: 'milestone', milestone: day, label: m.title };
  if (day > 100 && day % DAILY.jubileeEvery === 0) return { day, money: DAILY.jubileeMoney, kind: 'milestone', milestone: day, label: `${day} ДНЕЙ В ЭФИРЕ!` };
  const pos = (day - 1) % 7;
  return { day, money: DAILY.week[pos], kind: pos === 6 ? 'weekly' : 'daily', milestone: 0, label: DAILY.weekLabels[pos] };
}

/** The next milestone after streak day `n` (the track shows progress toward it). */
export function nextMilestone(n: number): { day: number; title: string; short: string; money: number } {
  const m = DAILY.milestones.find((x) => x.day > n);
  if (m) return { day: m.day, title: m.title, short: m.short, money: m.money };
  const day = (Math.floor(n / DAILY.jubileeEvery) + 1) * DAILY.jubileeEvery;
  return { day, title: `${day} ДНЕЙ В ЭФИРЕ!`, short: `${day} дней`, money: DAILY.jubileeMoney };
}
