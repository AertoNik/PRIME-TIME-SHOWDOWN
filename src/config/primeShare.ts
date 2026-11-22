import type { VictoryStyle } from './types';

/**
 * Beta 2.6.1 — PRIME SHARE: the victory poster of a PRIME LEAGUE win (src/ui/primeShare.ts). Offered on the league's
 * result screen only for a fight the SERVER confirmed as a win, played to its end (KO or time — never a forfeit, never
 * a fight the server settled at its deadline), with a show rating of SHARE_MIN_RATING or more. Nothing is paid, counted
 * or sent anywhere: the picture is made in the browser on the player's tap and goes only where the player sends it.
 */
export const SHARE_MIN_RATING = 80;

/** The poster: 1080 × 1350 (4:5), PNG — made in its own pixels, never from the screen (so a phone draws the same). */
export const POSTER = { width: 1080, height: 1350 } as const;

/** The site printed on every poster. */
export const POSTER_SITE = 'primetimeshowdown.online';

/**
 * Which victory routine the hero shot catches, and when (seconds into it) — picked from contact sheets of every
 * fighter's routines (the moment the pose is widest and most readable from below). By the routine's NAME, so a reorder
 * of VICTORY_SETS never changes a poster. A style not listed: its first routine at 1.5 s.
 */
export const POSTER_POSE: Partial<Record<VictoryStyle, { move: string; at: number }>> = {
  hype: { move: 'hype_spin', at: 2.2 }, // RAY: a spin into a double point skyward
  flex: { move: 'flex_double', at: 1.5 }, // BRUNO: double biceps
  peace: { move: 'peace_hop', at: 1.5 }, // NIKA: arms up
  precise: { move: 'precise_shoulder', at: 1.5 }, // VEGA: carbine on the shoulder
  showman: { move: 'show_bow', at: 1.5 }, // KAI: the bow and the point
  graceful: { move: 'grace_pirouette', at: 1.5 }, // RINA: the pirouette's final pose
  nightstar: { move: 'night_cape', at: 1.5 }, // LUCIEN: the collar opened, cane up
  clockwork: { move: 'clock_wind', at: 2.0 }, // CRAX: both arms up
  headliner: { move: 'ace_curtain_call', at: 1.9 }, // ACE: arms open, GOLDEN ACE raised
};
