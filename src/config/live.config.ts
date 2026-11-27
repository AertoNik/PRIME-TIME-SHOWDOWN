// Beta 2.7 LIVE DUELS — the numbers of the live mode, shared by the game and the server (`npm run backend:rules`
// writes backend/pb_hooks/lib/live_rules.js from this file).

/**
 * The two numbers the fight engine itself reads (they are inside league_sim.js and so part of SIM_VERSION — keep them
 * apart from the network rules below, which may change without touching the engine).
 */
export const LIVE_SIM = {
  /** Cosmetic viewer count of a live duel (the studio's crowd line). */
  fans: 2400,
  /** Most actions one side may have in a match's journal. */
  maxInputs: 150,
} as const;

/** The network, room and reward rules (server and game). Never part of the fight engine. */
export const LIVE = {
  ...LIVE_SIM,
  /** Steps the server puts between «now» and the step an action is applied (time for it to reach both games). */
  inputDelay: 6,
  /** The game's own buffer behind the server clock, in steps: start, least, most. */
  buffer: { start: 9, min: 6, max: 30 },
  /** Most actions a side may send per second. */
  actsPerSecond: 4,
  /** From «both ready» to the fight's step 0 (the 3.4 s intro after it is the countdown both see). */
  startDelayMs: 2500,
  /** The game's heartbeat while it is in a room or a match. */
  pulseMs: 2000,
  /** No heartbeat for this long → the other side sees «Переподключение…». */
  staleMs: 6500,
  /** No heartbeat for this long during a fight → the match ends; the one who stayed wins. */
  dropMs: 25000,
  /** A room waits this long for the second player. */
  waitMs: 15 * 60000,
  /** A room with nothing happening for this long is closed. */
  idleMs: 20 * 60000,
  /** Code alphabet: no 0/O, 1/I/L. */
  codeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  codeLength: 6,
  /** Per account: rooms created / codes tried per 10 minutes, live requests per minute. */
  limits: { rooms: 6, joins: 20, perMinute: 240 },
  /** Every this many steps both games report a fingerprint of the fight (the server compares them). */
  checkEvery: 300,
  /** PRIME RIVALS — what makes a fight count for the day's mini case. */
  honest: { fightSeconds: 30, cards: 3 },
} as const;

/** The invitation link for a room code. */
export function inviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/?duel=${encodeURIComponent(code)}`;
}

/** A room code typed by a person → its canonical form (or null). Spaces and dashes ignored, lower case accepted. */
export function normalizeCode(v: string): string | null {
  const s = String(v ?? '').toUpperCase().replace(/[\s-]+/g, '');
  if (s.length !== LIVE.codeLength) return null;
  for (const ch of s) if (!LIVE.codeAlphabet.includes(ch)) return null;
  return s;
}
