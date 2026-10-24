// Alpha 1.8.8 — PRIME SHOP ownership: the ONE place the game asks «does this player own a paid item?».
//
// Paid items are never owned through the save: a purchase is confirmed by the PRIME NETWORK server
// (1.8.8 stage 4, backend lib/payments.js), which hands the signed-in account its list here
// (setEntitlements — AccountRuntime.refreshRights). The list follows the PRIME ID: another account or
// signing out empties it at once; it is never kept on the device (offline, paid items wait for the
// server rather than trust a copy anybody could edit).
//
// Development only: `devGrant` (reachable from `npm run dev` via ?shopgrant=all) lends items to this
// page so the wardrobe can be tested. It is kept apart from purchases (the shop says «тестовый
// доступ», never «приобретено»), lives in memory only (never saved, never uploaded) and is compiled
// out of production builds (import.meta.env.DEV is the literal false there).

const confirmed = new Set<string>();
const testing = new Set<string>();
/**
 * 1.8.8 final: what the confirmed list is — real purchases, or rights from Robokassa's TEST mode (a staging
 * server, or the official site's demonstration): those are shown as «тестовая покупка», never «приобретено».
 */
let kind: 'purchase' | 'test' = 'purchase';
let version = 0;
let known = false;

/** Does the player own this paid item? Keys are PRIME SHOP skus (shop.config) — the ids of the future purchase records. */
export function ownsPaid(id: string): boolean {
  return confirmed.has(id) || testing.has(id);
}

/** Where the ownership comes from: a confirmed purchase, a test-mode (demonstration) right, a development grant, or nothing. */
export function paidSource(id: string): 'purchase' | 'test' | 'dev' | null {
  return confirmed.has(id) ? kind : testing.has(id) ? 'dev' : null;
}

/** Bumped whenever the list changes (screens can redraw). */
export function entitlementsVersion(): number {
  return version;
}

/**
 * The server's confirmed list for the signed-in account (stage 4). Replaces whatever was there.
 * `isKnown` false: emptied while the new account's list is being read (nothing to correct yet).
 */
export function setEntitlements(ids: readonly string[], isKnown = true, rights: 'purchase' | 'test' = 'purchase'): void {
  confirmed.clear();
  for (const id of ids) if (typeof id === 'string' && id.length <= 64) confirmed.add(id);
  known = isKnown;
  kind = rights;
  version++;
}

/** The list is the server's answer for whoever plays now (a guest: known to be empty) — not «still loading». */
export function entitlementsKnown(): boolean {
  return known;
}

/** Development builds only: a temporary, in-memory grant for testing the wardrobe. */
export function devGrant(ids: readonly string[]): boolean {
  if (!import.meta.env?.DEV) return false;
  for (const id of ids) testing.add(id);
  version++;
  return true;
}
