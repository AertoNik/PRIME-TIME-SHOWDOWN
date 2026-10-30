import { Match, type MatchConfig } from '../combat/Match';
import type { LeagueSide } from '../combat/league';
import type { ArenaId } from '../config/arenas.config';
import { MATCH } from '../config/balance';
import { LEAGUE_FIGHT } from '../config/league.config';

// Alpha 1.9.0 PRIME LEAGUE — the proof of a fight. The server fixes a snapshot (seed, set, both sides); the game plays
// it and records only the player's taps; the server runs THIS code on those taps and gets the result itself. The very
// same file is bundled into backend/pb_hooks/lib/league_sim.js (`npm run backend:rules`).

/** One tap: [fixed step it came before, card index in the hand 0–2] — or [step, −1]: the player gave up. */
export type LeagueInput = [number, number];

export interface LeagueSnapshot {
  seed: number;
  arena: ArenaId;
  attacker: LeagueSide;
  defender: LeagueSide;
  /** [attacker, defender] multipliers from fighter levels (1 while upgrades are off). */
  hpMult: [number, number];
  dmgMult: [number, number];
}

export interface LeagueOutcome {
  outcome: 'win' | 'loss' | 'draw';
  method: 'ko' | 'time' | 'forfeit';
  rating: number;
  hp: [number, number];
  /** Seconds of fighting (after the intro). */
  duration: number;
  /** Fixed steps until the fight was decided (real-time floor of the fight). */
  steps: number;
  cardsUsed: number;
  combos: number;
  /** Taps that were applied (all of them, once the fight is over the rest are ignored). */
  applied: number;
  /** Bit-exact fingerprint of the final state (the game shows it next to the server's in diagnostics). */
  hash: number;
}

export const STEP = MATCH.fixedStep;

export function leagueConfig(s: LeagueSnapshot): MatchConfig {
  return {
    fighter: s.attacker.fighter,
    deck: s.attacker.deck.slice(),
    // ignored in a league fight (the defender is cfg.league.foe)
    rival: 'dex',
    difficulty: 'pro',
    seed: s.seed >>> 0,
    fans: LEAGUE_FIGHT.fans,
    arena: s.arena,
    league: { foe: { ...s.defender, deck: s.defender.deck.slice() }, hpMult: [s.hpMult[0], s.hpMult[1]], dmgMult: [s.dmgMult[0], s.dmgMult[1]] },
  };
}

/** The longest a fight can run (intro + fight + outro + slack), in steps. */
export function maxSteps(m: Match): number {
  return Math.ceil((m.introTime + m.duration + MATCH.outroTime + 5) / STEP);
}

/** A well-formed tap list: integer steps in order, card −1…2, not more than the league allows. null = fine. */
export function checkInputs(inputs: unknown): string | null {
  if (!Array.isArray(inputs)) return 'not_list';
  if (inputs.length > LEAGUE_FIGHT.maxInputs) return 'too_many';
  let last = 0;
  for (const x of inputs) {
    if (!Array.isArray(x) || x.length !== 2) return 'bad_tap';
    const [st, c] = x as unknown[];
    if (typeof st !== 'number' || typeof c !== 'number' || !Number.isInteger(st) || !Number.isInteger(c)) return 'bad_tap';
    if (st < 0 || st > 20000 || c < -1 || c >= MATCH.handSize) return 'bad_tap';
    if (st < last) return 'order';
    last = st;
  }
  return null;
}

/** 32-bit FNV over the exact bits of the state that decides the fight. */
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
function mix(h: number, x: number): number {
  f64[0] = x;
  h = Math.imul(h ^ u32[0], 16777619) >>> 0;
  return Math.imul(h ^ u32[1], 16777619) >>> 0;
}
export function stateHash(m: Match): number {
  let h = 2166136261;
  for (const f of m.fighters) {
    h = mix(h, f.hp);
    h = mix(h, f.x);
    h = mix(h, f.z);
  }
  h = mix(h, m.hands[0].energy);
  h = mix(h, m.hands[1].energy);
  h = mix(h, m.time);
  h = mix(h, m.broadcast.rating);
  return h;
}

/**
 * Plays the fight from the snapshot with these taps (to the end: after the last tap the fighter keeps fighting without
 * cards — that is also how a fight is settled when the player's connection is gone).
 */
export function replayLeague(s: LeagueSnapshot, inputs: LeagueInput[]): LeagueOutcome {
  const m = new Match(leagueConfig(s));
  const limit = maxSteps(m);
  const over = () => m.phase === 'over';
  let k = 0;
  let decidedAt = -1;
  while (!over() && m.steps < limit) {
    while (k < inputs.length && inputs[k][0] <= m.steps && !over()) {
      const c = inputs[k][1];
      if (c < 0) m.forfeit();
      else m.playCard(0, c);
      k++;
    }
    if (over()) break;
    m.step(STEP);
    m.drainEvents();
    if (decidedAt < 0 && m.result) decidedAt = m.steps;
  }
  if (!m.result) m.forfeit(); // never: a fight always ends inside `limit`
  const r = m.result!;
  return {
    outcome: r.outcome,
    method: r.method,
    rating: r.rating,
    hp: [r.playerHpFrac, r.enemyHpFrac],
    duration: r.duration,
    steps: decidedAt < 0 ? m.steps : decidedAt,
    cardsUsed: r.cardsUsed,
    combos: r.combos,
    applied: k,
    hash: stateHash(m),
  };
}
