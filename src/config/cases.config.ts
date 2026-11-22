// Beta 2.4 — REWARD CASES: PRIME INVITE CASE (a friend you invited played 60 verified minutes — one for you, one for
// your friend) and DAILY BROADCAST CASE (one per day of the DAILY PRIME STREAK).
//
// The ONE place for what a case can give and how likely it is. The PRIME NETWORK server decides every result with
// these rules (backend/pb_hooks/lib/case_rules.js is generated from this file by `npm run backend:rules`; lib/cases.js
// draws with a cryptographic random number, writes the reward and marks the case opened in one transaction). The game
// reads this file only to SHOW the odds — the odds a player sees are the server's own (exclusive already owned or no
// PRIME TOKENS: those shares are spread over the rest, see oddsOf).
//
// Free rewards: a case is never sold, never bought, never paid out, never passed to another player.
//
// Balance (docs/BETA_2_4_DEVELOPMENT_REPORT.md): a rookie win pays ≈ 400–450 $ and ≈ 15–25 reputation; a day of
// PRIME LEAGUE fights pays at most 60 PRIME TOKENS; the old DAILY week paid 1 075 $ (ordinary days 75–150 $). A DAILY
// case is worth about an old ordinary day at first (≈ 110 $ in value) and a little more as the streak grows; an INVITE
// case — earned only when a friend played an hour of verified league fights — about one good career fight.

import type { CosmeticId } from './cosmetics.config';

export type CaseKind = 'invite' | 'daily' | 'mission';
export type CaseRewardKind = 'money' | 'rep' | 'tokens' | 'item';
/** Rarity of a case outcome — how the game names and colours it (the odds are the real numbers next to it). */
export type CaseRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface CaseOutcome {
  /** Stable id (history, analytics). */
  id: string;
  kind: CaseRewardKind;
  /** Inclusive range of the amount (dollars / reputation / PRIME TOKENS); 1…1 for an item. */
  min: number;
  max: number;
  /** Weight in basis points (100 = 1 %); a table sums to 10 000. */
  weight: number;
  rarity: CaseRarity;
  label: string;
  /** The exclusive collection item (kind 'item'): given once per account. */
  item?: CosmeticId;
}

export interface CaseDef {
  kind: CaseKind;
  name: string;
  tagline: string;
}

/** The exclusive item of PRIME INVITE CASE (cosmetics.config.ts, source 'referral'). */
export const INVITE_EXCLUSIVE: CosmeticId = 'dash_invite_signal';

export const CASE_DEFS: Record<CaseKind, CaseDef> = {
  invite: { kind: 'invite', name: 'PRIME INVITE CASE', tagline: 'За друга, который провёл час в эфире PRIME LEAGUE' },
  daily: { kind: 'daily', name: 'DAILY BROADCAST CASE', tagline: 'Подарок за каждый день ежедневного эфира' },
  mission: { kind: 'mission', name: 'DAILY MISSION MINI CASE', tagline: 'За каждое выполненное ежедневное задание' },
};

export const CASE_RARITY_LABEL: Record<CaseRarity, string> = { common: 'Обычная', rare: 'Редкая', epic: 'Эпическая', legendary: 'Легендарная' };

export const CASES = {
  /** Bumps the server's case rules (a change of any table must be deliberate — npm run cases pins it). */
  // Beta 2.5.5 → 2: the DOLLARS of both cases ×2 (ranges and the big fees; the shares, reputation, tokens and the item
  // unchanged). A career fight pays about a quarter of Beta 2.5's now: a day's case is worth about one more fight (was
  // ~0.15), and PRIME INVITE CASE stays above every DAILY sum as in 2.4 (its fee from 850 $, a DAILY sum at most 900 $).
  // Beta 2.6 → 3: the DAILY MISSION MINI CASE table (invite and daily unchanged)
  version: 3,
  invite: [
    { id: 'inv_money', kind: 'money', min: 850, max: 1400, weight: 4500, rarity: 'common', label: 'Гонорар' },
    { id: 'inv_rep', kind: 'rep', min: 40, max: 80, weight: 2500, rarity: 'common', label: 'Репутация продюсера' },
    { id: 'inv_tokens', kind: 'tokens', min: 25, max: 45, weight: 2000, rarity: 'rare', label: 'PRIME TOKENS' },
    { id: 'inv_jackpot', kind: 'money', min: 3000, max: 3000, weight: 600, rarity: 'epic', label: 'Крупный гонорар' },
    { id: 'inv_signal', kind: 'item', min: 1, max: 1, weight: 400, rarity: 'legendary', label: 'INVITE SIGNAL', item: 'dash_invite_signal' },
  ] as CaseOutcome[],
  /** DAILY BROADCAST CASE: the table of the tier the streak day falls in (from = the first streak day of the tier). */
  daily: [
    {
      from: 1,
      tier: 1,
      table: [
        { id: 'day1_money', kind: 'money', min: 160, max: 280, weight: 5500, rarity: 'common', label: 'Гонорар дня' },
        { id: 'day1_rep', kind: 'rep', min: 10, max: 18, weight: 2500, rarity: 'common', label: 'Репутация продюсера' },
        { id: 'day1_tokens', kind: 'tokens', min: 5, max: 8, weight: 1500, rarity: 'rare', label: 'PRIME TOKENS' },
        { id: 'day1_jackpot', kind: 'money', min: 600, max: 600, weight: 500, rarity: 'epic', label: 'Бонус спонсора' },
      ] as CaseOutcome[],
    },
    {
      from: 7,
      tier: 2,
      table: [
        { id: 'day2_money', kind: 'money', min: 180, max: 320, weight: 5200, rarity: 'common', label: 'Гонорар дня' },
        { id: 'day2_rep', kind: 'rep', min: 12, max: 22, weight: 2500, rarity: 'common', label: 'Репутация продюсера' },
        { id: 'day2_tokens', kind: 'tokens', min: 6, max: 10, weight: 1700, rarity: 'rare', label: 'PRIME TOKENS' },
        { id: 'day2_jackpot', kind: 'money', min: 700, max: 700, weight: 600, rarity: 'epic', label: 'Бонус спонсора' },
      ] as CaseOutcome[],
    },
    {
      from: 30,
      tier: 3,
      table: [
        { id: 'day3_money', kind: 'money', min: 220, max: 380, weight: 5000, rarity: 'common', label: 'Гонорар дня' },
        { id: 'day3_rep', kind: 'rep', min: 15, max: 28, weight: 2500, rarity: 'common', label: 'Репутация продюсера' },
        { id: 'day3_tokens', kind: 'tokens', min: 8, max: 12, weight: 1800, rarity: 'rare', label: 'PRIME TOKENS' },
        { id: 'day3_jackpot', kind: 'money', min: 900, max: 900, weight: 700, rarity: 'epic', label: 'Бонус спонсора' },
      ] as CaseOutcome[],
    },
  ],
  /**
   * Beta 2.6 — DAILY MISSION MINI CASE (one per done daily mission, up to five a day): small dollars, a little producer
   * reputation, a few PRIME TOKENS for a league player — no item, no skin, no fighter, no INVITE SIGNAL. Its expected
   * dollars ≈ 32 $ (≈ 37 $ without PRIME TOKENS — their share spreads over the rest), about a fifth of a DAILY BROADCAST
   * CASE (151–213 $); all five ≈ one «Профи» win a day (npm run missions — the economy section).
   */
  mission: [
    { id: 'm_money', kind: 'money', min: 30, max: 60, weight: 5800, rarity: 'common', label: 'Гонорар за задание' },
    { id: 'm_rep', kind: 'rep', min: 4, max: 8, weight: 2500, rarity: 'common', label: 'Репутация продюсера' },
    { id: 'm_tokens', kind: 'tokens', min: 2, max: 4, weight: 1200, rarity: 'rare', label: 'PRIME TOKENS' },
    { id: 'm_bonus', kind: 'money', min: 120, max: 120, weight: 500, rarity: 'rare', label: 'Бонус спонсора' },
  ] as CaseOutcome[],
};

/** The DAILY tier of a streak day (1, 2 or 3). */
export function dailyTierOf(streakDay: number): { tier: number; table: CaseOutcome[] } {
  let t = CASES.daily[0];
  for (const x of CASES.daily) if (streakDay >= x.from) t = x;
  return { tier: t.tier, table: t.table };
}

export interface CaseOdds {
  outcome: CaseOutcome;
  /** The share in basis points after the exclusions (sums to 10 000). */
  share: number;
}

/**
 * The real odds for this player: an exclusive item already owned, or PRIME TOKENS that cannot be paid (no PRIME LEAGUE
 * profile, tokens off), leave the table; their weight is spread over the rest in proportion (so the shares stay
 * exact and sum to 100 %). The same function runs on the server (lib/cases.js oddsOf).
 */
export function oddsOf(table: CaseOutcome[], o: { owned: string[]; tokens: boolean }): CaseOdds[] {
  const live = table.filter((x) => !(x.kind === 'item' && x.item && o.owned.includes(x.item)) && !(x.kind === 'tokens' && !o.tokens));
  const sum = live.reduce((s, x) => s + x.weight, 0);
  let left = 10000;
  return live.map((x, i) => {
    const share = i === live.length - 1 ? left : Math.round((x.weight * 10000) / sum);
    left -= share;
    return { outcome: x, share };
  });
}

/** A share in basis points as the game shows it, exactly («4 %», «7,5 %», «56,25 %» — the shown shares sum to 100 %). */
export function shareLabel(bp: number): string {
  return `${(Math.round(bp) / 100).toString().replace('.', ',')} %`;
}
