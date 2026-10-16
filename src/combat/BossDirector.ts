import type { BossDef, BossPhase } from '../config/boss.config';
import { CardHand } from './CardSystem';
import type { Match } from './Match';

/**
 * Runs the legendary champion's BOSS FIGHT inside the simulation: switches
 * phases by health (deck, AI personality, energy, STAR POWER) and exposes the
 * phase's DIRECTOR'S CUT numbers to Abilities. Deterministic like the rest of Match;
 * the champion only uses the regular card mechanics, so every heavy attack keeps
 * its telegraph.
 */
export class BossDirector {
  readonly def: BossDef;
  /** Current phase (1-based). */
  phase = 1;
  private m: Match;

  constructor(m: Match, def: BossDef) {
    this.m = m;
    this.def = def;
    this.applyPhase(def.phases[0], false);
  }

  get current(): BossPhase {
    return this.def.phases[this.phase - 1];
  }

  /** Phase changes by health. Called every fight step. */
  update(): void {
    const m = this.m;
    const boss = m.fighters[1];
    if (m.phase !== 'fight' || boss.ko) return;
    // health thresholds; a huge hit can cross two at once (each phase still announces itself)
    while (this.phase < this.def.phases.length && boss.hpFrac <= this.def.phases[this.phase].at) {
      this.phase++;
      this.applyPhase(this.current, true);
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
    if (!announce) return;
    // a charge or a DIRECTOR'S CUT in progress is called off: the new phase starts clean,
    // never with a half-shown line
    if (boss.action.kind === 'windup') {
      const card = boss.action.card;
      boss.action = { kind: 'none' };
      m.emit({ type: 'release', side: 1, card }); // clears the telegraph visuals
    }
    m.abilities.cancelCut(boss);
    // the new phase shows its DIRECTOR'S CUT soon instead of waiting out the old cooldown
    boss.cutCd = Math.min(boss.cutCd, 2.5);
    m.emit({ type: 'bossPhase', phase: p.n });
    if (p.starPower > 0) {
      boss.overdrive = Math.max(boss.overdrive, p.starPower);
      m.emit({ type: 'buff', side: 1, buff: 'overdrive', duration: boss.overdrive });
      m.emit({ type: 'bossMove', move: 'star' });
    }
  }
}
