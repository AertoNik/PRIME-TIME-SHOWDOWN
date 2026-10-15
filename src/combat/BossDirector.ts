import type { BossDef, BossPhase } from '../config/boss.config';
import { CardHand } from './CardSystem';
import type { Match } from './Match';
import type { MatchEvent } from './types';

/**
 * Runs the legendary champion's BOSS FIGHT inside the simulation: switches
 * phases by health (deck, AI personality, energy, STAR POWER) and performs the
 * FINAL BROADCAST "ENCORE" — a second, freshly telegraphed PRIME RUSH right after
 * the first. Deterministic like the rest of Match; it only uses the regular card
 * mechanics, so every heavy attack keeps its red-zone telegraph.
 */
export class BossDirector {
  readonly def: BossDef;
  /** Current phase (1-based). */
  phase = 1;
  private m: Match;
  /** A rush just happened in a phase with encore: follow up once the boss is free. */
  private encoreArmed = false;
  private encoreT = -1;
  private encoreCd = 0;
  private inEncore = false;

  constructor(m: Match, def: BossDef) {
    this.m = m;
    this.def = def;
    this.applyPhase(def.phases[0], false);
  }

  get current(): BossPhase {
    return this.def.phases[this.phase - 1];
  }

  /** Phase changes by health, encore timing. Called every fight step. */
  update(dt: number): void {
    const m = this.m;
    const boss = m.fighters[1];
    const foe = m.fighters[0];
    if (m.phase !== 'fight' || boss.ko) return;
    // health thresholds; a huge hit can cross two at once (each phase still announces itself)
    while (this.phase < this.def.phases.length && boss.hpFrac <= this.def.phases[this.phase].at) {
      this.phase++;
      this.applyPhase(this.current, true);
    }
    if (this.encoreCd > 0) this.encoreCd -= dt;
    // ENCORE: wait until the first rush (and its recovery) is over, then charge again
    if (this.encoreArmed && boss.action.kind === 'none') {
      this.encoreArmed = false;
      this.encoreT = this.def.encoreDelay;
    }
    if (this.encoreT >= 0) {
      this.encoreT -= dt;
      if (this.encoreT < 0) {
        if (!foe.ko && boss.action.kind === 'none' && boss.stun <= 0 && boss.knockback <= 0 && boss.glitch <= 0) {
          this.inEncore = true;
          m.emit({ type: 'bossMove', move: 'encore' });
          m.abilities.execute(boss, 'knockout', null);
        }
      }
    }
  }

  onEvent(e: MatchEvent): void {
    if (e.type !== 'rush' || e.side !== 1) return;
    if (this.inEncore) {
      // the encore itself never chains into another one
      this.inEncore = false;
      return;
    }
    if (this.current.encore && this.encoreCd <= 0) {
      this.encoreArmed = true;
      this.encoreCd = this.def.encoreCooldown;
    }
  }

  private applyPhase(p: BossPhase, announce: boolean): void {
    const m = this.m;
    const boss = m.fighters[1];
    // new deck for the phase; the energy the boss already had is kept
    const old = m.hands[1];
    const hand = new CardHand(p.deck, m.difficulty.energyMult * p.energyMult);
    hand.energy = Math.min(10, old.energy + p.energyBonus);
    m.hands[1] = hand;
    const prof = m.ais[1]?.profile;
    if (prof) prof.behavior = p.behavior;
    this.encoreArmed = false;
    this.encoreT = -1;
    if (!announce) return;
    m.emit({ type: 'bossPhase', phase: p.n });
    if (p.starPower > 0) {
      boss.overdrive = Math.max(boss.overdrive, p.starPower);
      m.emit({ type: 'buff', side: 1, buff: 'overdrive', duration: boss.overdrive });
      m.emit({ type: 'bossMove', move: 'star' });
    }
  }
}
