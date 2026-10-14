import { MATCH } from '../config/balance';
import { comboFor } from '../config/cards';
import type { CardId, ComboDef, Side } from '../config/types';

interface LastPlay {
  card: CardId | null;
  time: number;
}

/** Tracks the previous card per side and recognises two-card combos inside the window. */
export class ComboSystem {
  private last: [LastPlay, LastPlay] = [
    { card: null, time: -99 },
    { card: null, time: -99 },
  ];

  detect(side: Side, card: CardId, now: number): ComboDef | null {
    const l = this.last[side];
    if (!l.card || now - l.time > MATCH.comboWindow) return null;
    return comboFor(l.card, card);
  }

  /** Every card can open the next combo, so chains like SMOKE → DASH → POWER SHOT work. */
  record(side: Side, card: CardId, now: number): void {
    this.last[side] = { card, time: now };
  }

  /** Remaining combo window for UI (0 when nothing is primed). */
  windowLeft(side: Side, now: number): number {
    const l = this.last[side];
    if (!l.card) return 0;
    return Math.max(0, MATCH.comboWindow - (now - l.time));
  }

  primed(side: Side): CardId | null {
    return this.last[side].card;
  }

  /** Would playing `card` now produce a combo? */
  wouldCombo(side: Side, card: CardId, now: number): ComboDef | null {
    return this.detect(side, card, now);
  }
}
