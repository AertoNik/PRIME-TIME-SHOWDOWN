import { Match, type MatchConfig } from '../combat/Match';
import type { ArenaId } from '../config/arenas.config';
import { MATCH } from '../config/balance';
import { LIVE_SIM } from '../config/live.config';
import type { CardId, FighterId, Side } from '../config/types';
import { stateHash } from '../league/replay';

// Beta 2.7 LIVE DUELS — the fight of two people. The server keeps the only list of actions (its «journal»): every card
// either player plays gets its step from the SERVER. Both games run this very Match on the journal and see the same
// fight; at the end the server runs replayLive on the full journal and settles what IT computed. Bundled into
// backend/pb_hooks/lib/league_sim.js together with the league's replay (one fight engine, one SIM_VERSION).

/** One corner of a live duel, as the server fixed it when the match started. */
export interface LiveSide {
  fighter: FighterId;
  /** The four cards in the order the player set them (3 in hand + 1 queued). */
  deck: CardId[];
  /** Look id — rendering only, never the fight. */
  look?: string;
  /** Shown name (the producer's nickname). */
  name?: string;
}

export interface LiveSnapshot {
  seed: number;
  arena: ArenaId;
  /** [side 0, side 1] — the server draws who stands where. */
  sides: [LiveSide, LiveSide];
}

/** One action of the journal: [step it is applied before, side 0/1, card = index in THAT side's deck 0–3]. */
export type LiveInput = [number, number, number];

export interface LiveOutcome {
  /** null = a draw. */
  winner: Side | null;
  method: 'ko' | 'time';
  /** HP fractions at the end [side 0, side 1]. */
  hp: [number, number];
  /** Fixed steps until the fight was decided. */
  steps: number;
  /** Seconds of fighting (after the intro). */
  duration: number;
  cards: [number, number];
  combos: [number, number];
  damage: [number, number];
  perfects: [number, number];
  /** Journal actions that reached the fight (the rest came after the end). */
  applied: number;
  hash: number;
}

export const STEP = MATCH.fixedStep;

export function liveConfig(s: LiveSnapshot): MatchConfig {
  const [a, b] = s.sides;
  return {
    fighter: a.fighter,
    deck: a.deck.slice(),
    // ignored: side 1 is cfg.league.foe, both sides use the league's neutral difficulty (multipliers 1)
    rival: 'dex',
    difficulty: 'pro',
    seed: s.seed >>> 0,
    fans: LIVE_SIM.fans,
    arena: s.arena,
    league: { foe: { fighter: b.fighter, deck: b.deck.slice(), look: b.look, name: b.name, tactic: 'balance' }, hpMult: [1, 1], dmgMult: [1, 1] },
    live: true,
  };
}

export function liveMatch(s: LiveSnapshot): Match {
  return new Match(liveConfig(s));
}

/** The longest a live fight can run (intro + fight + outro + slack), in steps. */
export function liveMaxSteps(m: Match): number {
  return Math.ceil((m.introTime + m.duration + MATCH.outroTime + 5) / STEP);
}

/**
 * Applies one journal action: the card is looked up in the side's hand by its deck index (the hand keeps changing;
 * the deck never does). A card no longer in the hand, a fight not running — nothing happens (the same everywhere).
 */
export function applyLiveInput(m: Match, x: LiveInput): void {
  const side = x[1] as Side;
  const card = m.hands[side].deck[x[2]];
  if (!card) return;
  const i = m.hands[side].hand.indexOf(card);
  if (i < 0) return;
  m.playCard(side, i);
}

/** A well-formed journal: integer steps in order, sides 0/1, deck index 0–3, within the per-side limit. null = fine. */
export function checkLiveInputs(inputs: unknown): string | null {
  if (!Array.isArray(inputs)) return 'not_list';
  if (inputs.length > LIVE_SIM.maxInputs * 2) return 'too_many';
  let last = 0;
  for (const x of inputs) {
    if (!Array.isArray(x) || x.length !== 3) return 'bad_input';
    const [st, p, c] = x as unknown[];
    if (![st, p, c].every((v) => typeof v === 'number' && Number.isInteger(v))) return 'bad_input';
    if ((st as number) < 0 || (st as number) > 20000 || (p !== 0 && p !== 1) || (c as number) < 0 || (c as number) >= MATCH.deckSize) return 'bad_input';
    if ((st as number) < last) return 'order';
    last = st as number;
  }
  return null;
}

/**
 * Runs the journal from the snapshot. `until`: stop before this step (the state a moment of the fight had — used to
 * tell whether a fight was already decided when someone left). Without it, to the end of the fight.
 */
export function replayLive(s: LiveSnapshot, inputs: LiveInput[], until = -1): LiveOutcome & { over: boolean } {
  const m = liveMatch(s);
  const limit = until >= 0 ? Math.min(until, liveMaxSteps(m)) : liveMaxSteps(m);
  let k = 0;
  let decidedAt = -1;
  const over = () => m.phase === 'over';
  while (!over() && m.steps < limit) {
    while (k < inputs.length && inputs[k][0] <= m.steps && !over()) {
      applyLiveInput(m, inputs[k]);
      k++;
    }
    m.step(STEP);
    m.drainEvents();
    if (decidedAt < 0 && m.result) decidedAt = m.steps;
  }
  const f = m.fighters;
  const r = m.result;
  return {
    over: !!r,
    winner: r ? m.winner : null,
    method: r && r.method === 'ko' ? 'ko' : 'time',
    hp: [f[0].hpFrac, f[1].hpFrac],
    steps: decidedAt < 0 ? m.steps : decidedAt,
    duration: m.time,
    cards: [f[0].m.cardsUsed, f[1].m.cardsUsed],
    combos: [f[0].m.combos, f[1].m.combos],
    damage: [Math.round(f[0].m.damageDealt), Math.round(f[1].m.damageDealt)],
    perfects: [f[0].m.perfects, f[1].m.perfects],
    applied: k,
    hash: stateHash(m),
  };
}
