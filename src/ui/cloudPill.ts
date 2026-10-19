// Alpha 1.8.3.1 — the PRIME CLOUD line of the main menu: when it shows, when it fades away. Pure (no
// DOM): `npm run accounts` checks these rules, MenuScreen applies them.

/** What the PRIME CLOUD line is about — a passing moment, work in progress, or something to act on. */
export type CloudKind = 'synced' | 'saving' | 'waiting' | 'loading' | 'offline' | 'superseded' | 'signin' | 'issue';

export interface CloudState {
  text: string;
  tone: string;
  kind: CloudKind;
}

/** How long «СИНХРОНИЗИРОВАНО» stays in the menu before it fades away. */
export const CLOUD_SYNCED_MS = 2600;

/**
 * What the line does when the state changes:
 *   'show'  loading / saving, and anything that needs the player (no connection, another device,
 *           signing in, a decision) — it stays until the state changes, never hidden by a timer;
 *   'flash' a save just went through (or the account just loaded): «СИНХРОНИЗИРОВАНО» for a moment;
 *   'keep'  a change waits a few seconds before it goes up — nothing new to show;
 *   'hide'  in step and nothing happened: no line.
 */
export function cloudPillPlan(prev: CloudKind | null, next: CloudKind): 'show' | 'flash' | 'keep' | 'hide' {
  if (next === 'waiting') return 'keep';
  if (next !== 'synced') return 'show';
  return prev === 'synced' ? 'hide' : 'flash';
}
