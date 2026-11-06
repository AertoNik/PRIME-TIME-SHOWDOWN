// Alpha 1.9.6 — the CAREER'S PRICES in dollars: a progressive curve by the producer level that opens an item.
//
// The base price of a contract / a shop card stays where it always was (src/config/fighters.ts `contract.cost`,
// src/config/cards.ts `shop.price` — those files are part of the fight bundle and its SIM_VERSION, so they are not
// edited). What the career CHARGES is that base × the multiplier of the item's tier (its unlock level): the first steps
// cost what they always did, every later step a little more (scripts/economy-model.ts chose the numbers; the report is
// docs/ALPHA_1_9_6_FINAL_STAGING_REPORT.md). A future fighter or card gets its price from the same curve by its level.
//
// Only what is bought FROM NOW ON: a contract signed and a card bought before stay as they are; dollars in hand are
// never touched.
import { CARDS } from './cards';
import { FIGHTERS } from './fighters';
import type { CardId, FighterId } from './types';

/** Multiplier on the base price by the unlock level (levels not listed: the nearest lower one; below 3: × 1). */
export const PRICE_TIER: Record<number, number> = { 2: 1, 3: 1.5, 4: 2.2, 5: 3.2 };

/** Prices are rounded to this step (readable numbers on the buttons). */
const STEP = 50;

function tierOf(level: number): number {
  let m = 1;
  for (const [l, k] of Object.entries(PRICE_TIER)) if (level >= Number(l)) m = k;
  return m;
}

function priced(base: number, level: number): number {
  return Math.max(STEP, Math.round((base * tierOf(level)) / STEP) * STEP);
}

/** Dollars a contract with `id` costs now (0: the fighter has no contract — a starter or a seasonal star). */
export function contractCost(id: FighterId): number {
  const c = FIGHTERS[id].contract;
  return c ? priced(c.cost, c.level) : 0;
}

/** Dollars a shop card costs now (0: not a shop card). */
export function cardPrice(id: CardId): number {
  const s = CARDS[id].shop;
  return s ? priced(s.price, s.level) : 0;
}
