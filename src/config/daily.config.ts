import type { CosmeticId } from './cosmetics.config';

// Alpha 1.8.9 — DAILY PRIME STREAK («ЕЖЕДНЕВНЫЙ ЭФИР»): one reward per game day for a verified PRIME ID, a long
// streak with milestones 7 / 14 / 30 / 60 / 100 that goes on after day 100.
//
// Alpha 1.9.6 (docs/ALPHA_1_9_6_ECONOMY_IMPLEMENTATION_REPORT.md):
// - a PAUSE instead of the weekly shield: up to 2 missed days in a row are forgiven every time (the streak counts claims);
// - CHECKPOINTS instead of a fall to day 1: a streak that broke (more than the free shield forgives) goes on from the last
//   milestone it had passed (7, 14, 30, 60, 100, then every 100th day) — a busy week costs the days since then, never the
//   whole streak. A milestone pays once (it is never reached twice).
// - EXCLUSIVE ITEMS on three milestones (7: a title, 30: a broadcast frame, 100: a victory effect) — own ids, never sold;
//   the server names them in the status and refuses a cloud save that lists one the account has not reached
//   (backend/pb_hooks/lib/earned.js). The game grants them into MY COLLECTION only when the server says so.
//
// The ONE place for the numbers and the rules. The PRIME NETWORK server applies them (backend/pb_hooks/lib/
// daily_rules.js is generated from this file by `npm run backend:rules`; lib/daily.js decides the day, the streak
// and the reward and writes the dollars into the cloud save itself — the game never names a day or an amount).
// The game reads this file only to show what is coming.
//
// Balance (docs/DAILY_PRIME_STREAK.md; 1.9.6: docs/ALPHA_1_9_6_FINAL_STAGING_REPORT.md): a rookie win pays ≈ 400–450 $;
// 1.9.6 career prices rise by tier — contracts 500–5 750 $ (13 750 $ in all), the fifteen shop cards 250–2 400 $
// (15 300 $). A full week of visits gives 1 075 $ — about two and a half rookie wins; daily dollars are 1–8 % of what a
// player earns (npm run economy:check keeps them under 15 %), so they help, but the career is still the way to grow.

export interface DailyMilestone {
  /** The streak day it falls on. */
  day: number;
  money: number;
  /** The headline of the celebration («7 ДНЕЙ В ЭФИРЕ!»). */
  title: string;
  /** A short name on the milestone track. */
  short: string;
  /** 1.9.6: the exclusive collection item this milestone gives (once per account). */
  cosmetic?: CosmeticId;
}

export const DAILY = {
  /** The game day is Moscow's calendar day (UTC+3, no daylight saving) — the same clock as PRIME_DEMO_UNTIL. */
  utcOffsetMinutes: 180,
  /** Each week of the streak, day 1…7; day 7 is the weekly gift. */
  week: [75, 100, 125, 100, 150, 125, 250],
  weekLabels: ['Гонорар за выход в эфир', 'Утренний эфир', 'Бонус спонсора', 'Дневной эфир', 'Повышенный гонорар', 'Вечерний эфир', 'Еженедельный подарок'],
  /** Milestone days replace that day's ordinary reward. */
  milestones: [
    { day: 7, money: 400, title: '7 ДНЕЙ В ЭФИРЕ!', short: 'Неделя', cosmetic: 'title_daily_regular' },
    { day: 14, money: 600, title: 'ДВЕ НЕДЕЛИ В ЭФИРЕ!', short: '2 недели' },
    { day: 30, money: 1000, title: 'МЕСЯЦ В ПРАЙМ-ТАЙМЕ!', short: 'Месяц', cosmetic: 'frame_daily_live' },
    { day: 60, money: 1500, title: '60 ДНЕЙ — ЗОЛОТОЙ СЕЗОН!', short: 'Сезон' },
    { day: 100, money: 2500, title: '100 ДНЕЙ В ЭФИРЕ — ЛЕГЕНДА!', short: 'Легенда', cosmetic: 'victory_daily_sunrise' },
  ] as DailyMilestone[],
  /** After day 100 the streak goes on; every 100th day (200, 300, …) is a jubilee of its own. */
  jubileeEvery: 100,
  jubileeMoney: 2500,
  /** One missed day is forgiven for free — at most once in this many calendar days. */
  shieldDays: 7,
  /** 1.9.6: a broken streak goes on from the last milestone it had passed (false: back to day 1, as in 1.8.9–1.9.5). */
  checkpoints: true,
  /**
   * 1.9.6: a PAUSE instead of the weekly shield — up to this many missed days IN A ROW never break the streak (it just
   * does not grow on them: one claim, one streak day). 0 = the 1.8.9 shield (one forgiven day in `shieldDays`).
   */
  graceDays: 2,
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

/** 1.9.6: the checkpoint a streak of `n` days keeps after a break — the last milestone passed (0: none, day 1 again). */
export function checkpointOf(n: number): number {
  if (!DAILY.checkpoints) return 0;
  let c = 0;
  for (const m of DAILY.milestones) if (m.day <= n && m.day > c) c = m.day;
  if (n >= DAILY.jubileeEvery) c = Math.max(c, Math.floor(n / DAILY.jubileeEvery) * DAILY.jubileeEvery);
  return c;
}

/** The next milestone after streak day `n` (the track shows progress toward it). */
export function nextMilestone(n: number): { day: number; title: string; short: string; money: number } {
  const m = DAILY.milestones.find((x) => x.day > n);
  if (m) return { day: m.day, title: m.title, short: m.short, money: m.money };
  const day = (Math.floor(n / DAILY.jubileeEvery) + 1) * DAILY.jubileeEvery;
  return { day, title: `${day} ДНЕЙ В ЭФИРЕ!`, short: `${day} дней`, money: DAILY.jubileeMoney };
}
