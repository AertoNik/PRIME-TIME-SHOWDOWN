// Seasonal events: calendar, quests, seasonal currency and rewards.
// Everything here is data; EventManager (src/meta/EventManager.ts) runs it.
// Step-by-step guide in Russian: docs/SEASONAL_EVENTS.md
import type { CosmeticId } from './cosmetics.config';
import type { ThemeId } from './themes.config';
import type { Difficulty, FighterId } from './types';

// ---------------------------------------------------------------- settings
// mode 'auto'   — the event is chosen by the calendar below (normal published game).
// mode 'manual' — always use `forcedEventId`, ignoring dates (testing / previews).
//   forcedEventId: 'none' (standard look), 'halloween-2026', 'winter-preview'.
// In `npm run dev` you can also add ?event=halloween-2026 (or ?event=none) and
// ?now=2026-10-25 to the address. Those URL switches are ignored in the published build.
// A manual preview outside the event's dates is theme-only (no quests or currency)
// unless `previewRewards: true` — the dev URL switch sets it, a published build never does.
export const eventSettings: EventSettings = {
  mode: 'auto',
  forcedEventId: 'halloween-2026',
};

export interface EventSettings {
  mode: 'auto' | 'manual';
  forcedEventId: string;
  /**
   * Manual mode only: also run quests and pay seasonal currency outside the event's
   * real dates. Off by default, so a manual theme preview never pays players by
   * accident; only the `?event=` switch of `npm run dev` turns it on (Alpha 1.4).
   */
  previewRewards?: boolean;
}

// ------------------------------------------------------------------ types
/** What a quest counts. Each finished match (not forfeited) adds to it. */
export type QuestMetric =
  | { kind: 'wins' }
  | { kind: 'matches' }
  | { kind: 'combos' }
  | { kind: 'ultraCombos' }
  | { kind: 'perfects' }
  | { kind: 'koWins' }
  | { kind: 'ratingSum' }
  /** Matches finished with a show rating of at least `min`. */
  | { kind: 'ratingAtLeast'; min: number }
  /** Wins on `min` difficulty or harder. */
  | { kind: 'winsOnDifficulty'; min: Difficulty };

export interface QuestDef {
  id: string;
  title: string;
  desc: string;
  metric: QuestMetric;
  target: number;
  /** Seasonal currency paid when the player claims the finished quest. */
  reward: number;
  icon: 'moon' | 'combo' | 'star' | 'ghost' | 'clock' | 'crown' | 'tv';
}

export interface CurrencyDef {
  id: string;
  name: string;
  /** Russian plural forms for 1 / 2 / 5: ['жетон', 'жетона', 'жетонов']. */
  short: [string, string, string];
  icon: 'pumpkin' | 'snowflake';
}

/** Pick the Russian plural form: 1 жетон, 2 жетона, 5 жетонов. */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(Math.floor(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

/** Tokens per finished match while the event runs (forfeits give nothing). */
export interface MatchEarnings {
  win: number;
  /** Bonus per show-rating threshold reached, e.g. [[60, 2], [85, 2]]. */
  rating: [number, number][];
  perCombo: number;
  comboCap: number;
  /** Max tokens per local calendar day from matches (quests are not capped). */
  dailyCap: number;
}

export interface ShopItem {
  cosmetic: CosmeticId;
  cost: number;
}

/**
 * Alpha 1.7: a seasonal star in the event's exchange — a playable fighter opened once for the
 * event's currency and kept forever (FighterDef.seasonal). Bought like the cosmetics, never paid
 * with real money; after the event it cannot be opened through it any more.
 */
export interface SeasonFighter {
  fighter: FighterId;
  cost: number;
}

export interface EventDef {
  id: string;
  title: string;
  subtitle: string;
  themeId: ThemeId;
  /** UTC ISO dates; `end` is exclusive. Omit both for manual-only previews. */
  start?: string;
  end?: string;
  /** Show an "upcoming" teaser this many days before the start. */
  announceDays: number;
  tagline: string;
  currency?: CurrencyDef;
  earnings?: MatchEarnings;
  quests: QuestDef[];
  shop: ShopItem[];
  /** Alpha 1.7: seasonal stars on sale in the exchange (Halloween Premiere: LUCIEN). */
  fighters?: SeasonFighter[];
  /** Season grand prize, unlocked by finishing `questsNeeded` quests. */
  grandPrize?: { cosmetic: CosmeticId; questsNeeded: number };
}

// --------------------------------------------------------------- calendar
export const EVENTS: EventDef[] = [
  {
    id: 'halloween-2026',
    title: 'HALLOWEEN PREMIERE',
    subtitle: 'Ночной спецвыпуск PRIME TIME',
    themeId: 'halloween',
    start: '2026-10-20T00:00:00Z',
    end: '2026-11-04T00:00:00Z',
    announceDays: 14,
    tagline: 'Тыквы на трибунах, неон в тумане и самые зрелищные бои сезона.',
    currency: { id: 'pumpkin', name: 'PUMPKIN TOKENS', short: ['жетон', 'жетона', 'жетонов'], icon: 'pumpkin' },
    earnings: { win: 4, rating: [[60, 2], [85, 2]], perCombo: 1, comboCap: 3, dailyCap: 60 },
    quests: [
      { id: 'first_night', title: 'FIRST NIGHT ON AIR', desc: 'Победите в 3 матчах', metric: { kind: 'wins' }, target: 3, reward: 30, icon: 'moon' },
      { id: 'combo_carnival', title: 'COMBO CARNIVAL', desc: 'Проведите 10 комбо', metric: { kind: 'combos' }, target: 10, reward: 40, icon: 'combo' },
      { id: 'prime_fright', title: 'PRIME TIME FRIGHT', desc: 'Закончите матч с рейтингом шоу 80+', metric: { kind: 'ratingAtLeast', min: 80 }, target: 1, reward: 40, icon: 'star' },
      { id: 'ghost_step', title: 'GHOST STEP', desc: 'Сделайте 5 идеальных уклонений или блоков', metric: { kind: 'perfects' }, target: 5, reward: 35, icon: 'ghost' },
      { id: 'midnight_marathon', title: 'MIDNIGHT MARATHON', desc: 'Проведите 10 матчей до конца', metric: { kind: 'matches' }, target: 10, reward: 50, icon: 'clock' },
      { id: 'night_champion', title: 'NIGHT CHAMPION', desc: 'Победите на сложности «Профи» или выше', metric: { kind: 'winsOnDifficulty', min: 'pro' }, target: 1, reward: 50, icon: 'crown' },
      { id: 'showtime_legend', title: 'SHOWTIME LEGEND', desc: 'Наберите 600 очков рейтинга шоу за все матчи', metric: { kind: 'ratingSum' }, target: 600, reward: 60, icon: 'tv' },
    ],
    shop: [
      { cosmetic: 'card_pumpkin', cost: 120 },
      { cosmetic: 'dash_phantom', cost: 150 },
      { cosmetic: 'frame_spooky', cost: 180 },
      { cosmetic: 'victory_pumpkin', cost: 220 },
    ],
    // Alpha 1.7 — BLOOD MOON PREMIERE: the main star of the season. 500 tokens = all seven quests (305)
    // plus about four days of matches for a regular player (40–60 tokens a day), so the season's
    // other rewards stay within reach too (the calculation is in the Alpha 1.7 report).
    fighters: [{ fighter: 'lucien', cost: 500 }],
    grandPrize: { cosmetic: 'title_halloween_champion', questsNeeded: 6 },
  },
  {
    // Visual preview of the future winter season: theme only, no quests or currency yet.
    id: 'winter-preview',
    title: 'WINTER GALA',
    subtitle: 'Превью зимнего оформления',
    themeId: 'winter',
    announceDays: 0,
    tagline: 'Зимнее оформление PRIME TIME. Задания и награды появятся в будущем обновлении.',
    quests: [],
    shop: [],
  },
];
