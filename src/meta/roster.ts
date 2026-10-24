import { SKU_OF_FIGHTER } from '../config/shop.config';
import type { FighterId } from '../config/types';
import { ownsPaid } from './entitlements';
import type { SaveData } from './SaveSystem';

// Alpha 1.8.8 (stage 4) — who is in the player's roster. Two independent ways in:
//   the save      signed in the career, or opened for an event's tokens (LUCIEN during Halloween Premiere)
//   PRIME SHOP    opened by a purchase the PRIME NETWORK server confirmed (entitlements.ts) — NEVER written
//                 into the save, so a refund of that purchase takes back only what it gave
// Career progress (stages, signed-fighter counts) keeps reading the save: a purchase does not advance it.

/** In the roster: signed / opened for tokens (the save), or opened by a confirmed PRIME SHOP purchase. */
export function inRoster(d: SaveData, id: FighterId): boolean {
  if (d.fighters[id]?.unlocked) return true;
  const sku = SKU_OF_FIGHTER[id];
  return !!sku && ownsPaid(sku);
}

/** Opened ONLY by a PRIME SHOP purchase (not in the save). */
export function inRosterByPurchase(d: SaveData, id: FighterId): boolean {
  return !d.fighters[id]?.unlocked && inRoster(d, id);
}
