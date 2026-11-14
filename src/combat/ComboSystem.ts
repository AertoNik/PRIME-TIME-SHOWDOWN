import { COMBO_FRESH, MATCH } from '../config/balance';
import { COMBO_BY_ID, comboFor } from '../config/cards';
import type { CardId, ComboDef, ComboId, Side } from '../config/types';

/**
 * Alpha 1.9.9 — COMBO FRESHNESS helpers: a combo's bonus at freshness `p` (1 fresh … 0.25 stale). Only the combo's extra
 * is scaled — the card's own numbers never change: a multiplier eases towards ×1, a combo value towards the card's own.
 */
export const boost = (mult: number, p: number): number => 1 + (mult - 1) * p;
export const toward = (base: number, combo: number, p: number): number => base + (combo - base) * p;

interface LastPlay {
  card: CardId | null;
  time: number;
  /** Alpha 1.6: the combo that card formed (chains: HIGH STAKES → SHIELD → POWER SHOT). */
  combo: ComboId | null;
}

/**
 * Alpha 1.9.9: how stale one combo is for one side — repeats in a row, when it last landed, and the other cards played
 * since (every `COMBO_FRESH.playsPerStep` of them heal a step).
 */
interface Stale {
  n: number;
  t: number;
  v: number;
}

/**
 * Tracks the previous card per side and recognises two-card combos inside the window.
 * Alpha 1.9.9 — COMBO FRESHNESS (balance.ts COMBO_FRESH): per side and combo, how many times in a row it has landed;
 * `power` is the share of its bonus it still has. Deterministic (match time only), the same for both sides.
 */
export class ComboSystem {
  private last: [LastPlay, LastPlay] = [
    { card: null, time: -99, combo: null },
    { card: null, time: -99, combo: null },
  ];
  private stale: [Map<ComboId, Stale>, Map<ComboId, Stale>] = [new Map(), new Map()];
  /** Alpha 1.6: the match rejects combos whose setup is gone (Match.comboReady). */
  ready: ((side: Side, c: ComboDef, prev: CardId) => boolean) | null = null;
  /** Seconds the second card of a pair may follow the first (Alpha 1.6.5: the tutorial gives a beginner longer). */
  window: number = MATCH.comboWindow;

  detect(side: Side, card: CardId, now: number): ComboDef | null {
    const l = this.last[side];
    if (!l.card || now - l.time > this.window) return null;
    const ready = this.ready;
    return comboFor(l.card, card, l.combo, ready ? (c, prev) => ready(side, c, prev) : undefined);
  }

  /** Every card can open the next combo, so chains like SMOKE → DASH → POWER SHOT work. */
  record(side: Side, card: CardId, now: number, combo: ComboId | null = null): void {
    this.last[side] = { card, time: now, combo };
  }

  /** Remaining combo window for UI (0 when nothing is primed). */
  windowLeft(side: Side, now: number): number {
    const l = this.last[side];
    if (!l.card) return 0;
    return Math.max(0, this.window - (now - l.time));
  }

  primed(side: Side): CardId | null {
    return this.last[side].card;
  }

  /** Would playing `card` now produce a combo? */
  wouldCombo(side: Side, card: CardId, now: number): ComboDef | null {
    return this.detect(side, card, now);
  }

  // ------------------------------------------------------------- Alpha 1.9.9 — freshness

  /** Repeats in a row `combo` has for `side` at `now` (healed by the time since it last landed). */
  repeats(side: Side, combo: ComboId, now: number): number {
    const s = this.stale[side].get(combo);
    if (!s) return 0;
    return Math.max(0, s.n - Math.floor(Math.max(0, now - s.t) / COMBO_FRESH.healTime));
  }

  /** The share of its bonus `combo` would have if it landed for `side` now (1 = fresh). */
  power(side: Side, combo: ComboId, now: number): number {
    const p = COMBO_FRESH.power;
    return p[Math.min(this.repeats(side, combo, now), p.length - 1)];
  }

  /**
   * `combo` landed for `side`: one more repeat for it unless it answered an attack (`read`; capped where the power floor is
 * reached, so a stale combo
   * recovers in a few steps — no lasting penalty), one step of healing for every other combo of that side.
   * Returns the power it landed with.
   */
  landed(side: Side, combo: ComboId, now: number, read = false): number {
    const map = this.stale[side];
    const n = this.repeats(side, combo, now);
    const power = COMBO_FRESH.power[Math.min(n, COMBO_FRESH.power.length - 1)];
    for (const [id, s] of [...map]) {
      if (id === combo) continue;
      // the variety step (the time healing since s.t keeps running); a fully healed combo is forgotten
      const next = { n: s.n - COMBO_FRESH.varietyHeal, t: s.t, v: s.v };
      if (next.n - Math.floor(Math.max(0, now - s.t) / COMBO_FRESH.healTime) <= 0) map.delete(id);
      else map.set(id, next);
    }
    // an answer to the rival's attack (`read`, see Match.comboRead) is the right combo at the right moment — the owner's
    // «не наказывать за грамотное применение»: it lands with its freshness but adds no repeat
    if (!read) map.set(combo, { n: Math.min(n + 1, COMBO_FRESH.power.length - 1), t: now, v: 0 });
    return power;
  }

  /**
   * A card played without forming a combo: variety of action. For every stale combo of `side` that this card is no part
   * of, one more play towards healing a step — a DASH → POWER SHOT loop played back to back stays stale, the same pair
   * between other moves (a SHIELD, a SMOKE, the signature…) recovers.
   */
  plain(side: Side, card: CardId, now: number): void {
    const map = this.stale[side];
    for (const [id, s] of [...map]) {
      const def = COMBO_BY_ID[id];
      if (def.first.includes(card) || def.second.includes(card)) continue;
      const v = s.v + 1;
      if (v < COMBO_FRESH.playsPerStep) {
        map.set(id, { ...s, v });
        continue;
      }
      const next = { n: s.n - 1, t: s.t, v: 0 };
      if (next.n - Math.floor(Math.max(0, now - s.t) / COMBO_FRESH.healTime) <= 0) map.delete(id);
      else map.set(id, next);
    }
  }
}
