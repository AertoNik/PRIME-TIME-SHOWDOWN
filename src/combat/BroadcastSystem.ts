import { BROADCAST } from '../config/balance';
import { COMBOS } from '../config/cards';
import type { CardId, ComboId } from '../config/types';
import { clamp } from '../core/math';
import type { MatchEvent } from './types';

/** The original five combos (their show value is unchanged by Alpha 1.6). */
const CLASSIC_COMBOS = new Set<ComboId>(['counter_strike', 'electro_blast', 'iron_rush', 'phantom_step', 'superstar']);

/** Minimal surface of Match the broadcast needs (avoids a circular import). */
export interface BroadcastHost {
  time: number;
  timeLeft: number;
  playerHpFrac(): number;
  playerEnergyFull(): boolean;
  emit(e: MatchEvent): void;
}

/**
 * TV spectacle rating 0..100. Rewards the producer's (player side) spectacular
 * decisions: combos, perfect reads, heavy hits, variety and a strong finish.
 * Never rewards taking damage or stalling — a static fight bleeds rating.
 */
export class BroadcastSystem {
  rating = BROADCAST.start;
  peak = BROADCAST.start;
  private sum = 0;
  private sampled = 0;
  private lastPlayerAction = 0;
  private reached = new Set<number>();
  /** Alpha 1.6: when each tactical combo last landed (repeat fatigue). */
  private lastComboAt = new Map<ComboId, number>();
  private usedCards = new Set<CardId>();
  private reactionCd = 0;
  private host: BroadcastHost;
  bestCombo: ComboId | null = null;
  private bestComboValue = 0;
  private lastHeavy = -99;
  finisher = false;

  constructor(host: BroadcastHost) {
    this.host = host;
  }

  get average(): number {
    return this.sampled > 0 ? this.sum / this.sampled : this.rating;
  }

  add(amount: number, label: string): void {
    if (amount === 0) return;
    const before = this.rating;
    this.rating = clamp(this.rating + amount, 0, 100);
    if (this.rating > this.peak) this.peak = this.rating;
    if (label) this.host.emit({ type: 'rating', amount: Math.round(amount), label });
    if (amount > 0) {
      for (const th of BROADCAST.thresholds) {
        if (before < th.value && this.rating >= th.value && !this.reached.has(th.value)) {
          this.reached.add(th.value);
          this.host.emit({ type: 'reaction', text: th.text, tier: th.value >= 75 ? 3 : 2 });
        }
      }
    }
  }

  /** Smaller, rate-limited callouts. */
  private callout(text: string, tier: 1 | 2 | 3 = 1): void {
    if (this.reactionCd > 0 && tier < 2) return;
    this.reactionCd = 1.1;
    this.host.emit({ type: 'reaction', text, tier });
  }

  markPlayerAction(): void {
    this.lastPlayerAction = this.host.time;
  }

  onEvent(e: MatchEvent): void {
    switch (e.type) {
      case 'card':
        if (e.side !== 0) break;
        this.markPlayerAction();
        if (!this.usedCards.has(e.card)) {
          this.usedCards.add(e.card);
          // Variety counts only once the fight is underway.
          this.add(BROADCAST.varietyNew, 'НОВЫЙ ПРИЁМ');
        }
        break;
      case 'combo': {
        const def = COMBOS.find((c) => c.id === e.combo)!;
        if (e.side === 0) {
          let amt = def.rating;
          // Alpha 1.6: the cheap tactical combos lose half their show value when repeated within
          // `comboRepeat` s (no rating farming with a two-card loop); the classic five are untouched
          if (!CLASSIC_COMBOS.has(def.id)) {
            const last = this.lastComboAt.get(def.id) ?? -99;
            if (this.host.time - last < BROADCAST.comboRepeat) amt *= 0.5;
            this.lastComboAt.set(def.id, this.host.time);
          }
          const comeback = this.host.playerHpFrac() < 0.35;
          if (comeback) amt += BROADCAST.comeback;
          this.add(amt, def.name);
          const ultra = def.id === 'superstar' || def.id === 'electro_blast';
          this.host.emit({ type: 'reaction', text: def.name, tier: 3, sub: comeback ? 'COMEBACK!' : ultra ? 'ULTRA COMBO!' : 'AMAZING COMBO!' });
          this.reactionCd = 1.4;
          if (def.rating > this.bestComboValue) {
            this.bestComboValue = def.rating;
            this.bestCombo = def.id;
          }
        } else {
          this.add(BROADCAST.enemyCombo, '');
          this.callout('RIVAL COMBO!', 1);
        }
        break;
      }
      case 'hit':
        if (e.source === 0) {
          this.add(e.damage * BROADCAST.dmgToRating, '');
          if (e.heavy) {
            // Combo payoffs are already rewarded by the combo itself; repeated
            // plain heavies in quick succession bore the audience.
            if (!e.combo) {
              const fresh = this.host.time - this.lastHeavy > BROADCAST.heavyFatigue;
              this.add(BROADCAST.heavyHit * (fresh ? 1 : 0.4), fresh ? 'МОЩНОЕ ПОПАДАНИЕ' : '');
            } else {
              this.add(BROADCAST.heavyHit * 0.5, '');
            }
            this.lastHeavy = this.host.time;
          } else if (e.kind === 'shock') {
            this.add(BROADCAST.shockHit, '');
          } else if (e.kind === 'adrenaline') {
            this.add(BROADCAST.flurryHit, '');
          }
          // Alpha 1.6: the new set pieces landing are show moments
          if (e.kind === 'mine') this.callout('TRAP SPRUNG!', 2);
          else if (e.kind === 'prop') this.callout('PROP DROP!', 2);
          else if (e.kind === 'cam') this.callout('SIDE CAM!', 2);
        } else if (e.heavy) {
          this.add(BROADCAST.takenHeavy, '');
        }
        break;
      case 'dodge':
        if (e.side === 0) {
          if (e.perfect) {
            this.add(BROADCAST.perfectDodge * (e.heavy ? 1.3 : 1), 'PERFECT DODGE');
            this.callout('PERFECT DODGE!', e.heavy ? 2 : 1);
          } else {
            this.add(BROADCAST.closeCall, 'НА ВОЛОСОК');
          }
        }
        break;
      case 'block':
        if (e.side === 0) {
          if (e.perfect) {
            this.add(BROADCAST.perfectBlock, 'PERFECT BLOCK');
            this.callout('PERFECT BLOCK!', 2);
          } else {
            this.add(BROADCAST.block, '');
          }
        }
        break;
      case 'interrupt':
        if (e.by === 0) {
          this.add(BROADCAST.interrupt, 'ПРЕРЫВАНИЕ');
          this.callout('INTERRUPTED!', 2);
        }
        break;
      case 'miss':
        if (e.side === 0) this.add(BROADCAST.smokeMiss, '');
        break;
      case 'decoyPop':
        if (e.side === 0 && e.hit) this.add(BROADCAST.decoyPop, 'ПРИМАНКА');
        break;
      case 'wallSlam':
        if (e.side === 1) {
          this.add(BROADCAST.wallSlam, 'WALL SLAM');
          this.callout('WALL SLAM!', 2);
        }
        break;
      case 'whiff':
        if (e.side === 1) this.add(BROADCAST.whiffPunish, 'ПРОМАХ СОПЕРНИКА');
        break;
      // Alpha 1.5: the new signature moves are TV moments
      case 'trickShot':
        if (e.side === 0) {
          this.add(BROADCAST.trickShot, 'TRICK SHOT');
          this.host.emit({ type: 'reaction', text: 'TRICK SHOT!', tier: 3, sub: 'RICOCHET!' });
          this.reactionCd = 1.4;
        }
        break;
      case 'feintCounter':
        if (e.side === 0) {
          this.add(BROADCAST.feintRead, 'ОБМАННЫЙ МАНЁВР');
          this.host.emit({ type: 'reaction', text: 'FALSE START!', tier: 3, sub: 'COUNTER!' });
          this.reactionCd = 1.4;
        }
        break;
      // Alpha 1.6 — CARD REVOLUTION
      case 'tagHit':
        if (e.side === 0) {
          this.add(BROADCAST.spotlight, 'В ЦЕНТРЕ ВНИМАНИЯ');
          this.callout('SPOTLIGHT!', 2);
        }
        break;
      case 'frameCatch':
        if (e.side === 0) {
          this.add(BROADCAST.frameCatch, 'ПЕРЕХВАТ');
          this.callout('FRAME CATCH!', 2);
        }
        break;
      case 'tether':
        if (e.side === 1) this.add(BROADCAST.tether, 'НА ТРОСЕ');
        break;
      case 'push':
        if (e.side === 0 && e.hit) this.add(BROADCAST.push, '');
        break;
      case 'stakes':
        if (e.side === 0) {
          this.add(BROADCAST.stakes, 'HIGH STAKES');
          this.host.emit({ type: 'reaction', text: 'HIGH STAKES!', tier: 2, sub: `−${e.hp} HP · +${e.energy} ⚡` });
          this.reactionCd = 1.2;
        }
        break;
      case 'ko':
        if (e.side === 1) {
          this.add(BROADCAST.koWin, 'НОКАУТ');
          if (e.heavy) {
            this.finisher = true;
            this.add(BROADCAST.finisherHeavy, 'ЭФФЕКТНЫЙ ФИНИШ');
          }
          if (this.host.timeLeft < 10) this.add(BROADCAST.buzzerBeater, 'НА ПОСЛЕДНИХ СЕКУНДАХ');
          if (this.host.playerHpFrac() > 0.7) this.add(BROADCAST.dominant, 'ДОМИНИРОВАНИЕ');
          this.host.emit({ type: 'reaction', text: 'WHAT A FINISH!', tier: 3, sub: 'K.O.!' });
        } else {
          this.add(BROADCAST.koLoss, '');
        }
        break;
      default:
        break;
    }
  }

  update(dt: number): void {
    if (this.reactionCd > 0) this.reactionCd -= dt;
    let decay = BROADCAST.decay;
    const idleFor = this.host.time - this.lastPlayerAction;
    if (idleFor > BROADCAST.idleTime && this.host.playerEnergyFull()) decay += BROADCAST.idleDecay;
    this.rating = clamp(this.rating - decay * dt, 0, 100);
    this.sum += this.rating * dt;
    this.sampled += dt;
  }

  finalRating(): number {
    const w = BROADCAST.finalWeights;
    const v = this.average * w.avg + this.peak * w.peak + this.rating * w.end;
    return Math.round(clamp(v, 0, 100));
  }

  /** Cosmetic "viewers" figure for the HUD. */
  viewers(fans: number): number {
    const base = BROADCAST.baseViewers + fans * 18;
    return Math.round(base * (0.45 + (this.rating / 100) * 1.6));
  }
}
