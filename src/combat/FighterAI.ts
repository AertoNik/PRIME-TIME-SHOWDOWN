import { ARENA, CARD_TUNING } from '../config/balance';
import { CARDS } from '../config/cards';
import type { BehaviorDef, CardId, Side } from '../config/types';
import { clamp } from '../core/math';
import type { FighterSim } from './FighterSim';
import type { Match } from './Match';

export interface AIProfile {
  aimLead: number;
  aimError: number;
  dodgeSkill: number;
  reaction: number;
  cardSmarts: number;
  usesCards: boolean;
  behavior: BehaviorDef;
}

interface Perceived {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/**
 * Drives one fighter: range management, strafing, sidestepping, aiming and
 * (for the rival) card decisions. The player's own fighter uses the same
 * brain with `usesCards = false` — the producer plays the cards.
 */
export class FighterAI {
  private m: Match;
  readonly side: Side;
  readonly profile: AIProfile;
  private strafeDir: number;
  private strafeTimer: number;
  private decisionTimer: number;
  private aimTimer = 0;
  private dodgeX = 0;
  private dodgeZ = 0;
  private dodgeT = 0;
  private considered = new Set<number>();
  private memX = 0;
  private memZ = 0;
  private memT = 0;
  private threatKey = '';
  private reactT = -1;
  private reactKind: 'windup' | 'incoming' = 'incoming';
  private surgeT = 0;
  private surgeTimer: number;

  constructor(m: Match, side: Side, profile: AIProfile) {
    this.m = m;
    this.side = side;
    this.profile = profile;
    this.strafeDir = m.rng.sign();
    this.strafeTimer = m.rng.range(0.8, 2);
    this.decisionTimer = 1.6 + m.rng.range(0, 1);
    this.surgeTimer = m.rng.range(3, 6);
  }

  update(dt: number): void {
    const m = this.m;
    const f = m.fighters[this.side];
    const foe = m.fighters[1 - this.side];
    if (f.ko || m.phase !== 'fight' || foe.ko) {
      f.intentSpeed = 0;
      f.wantFire = false;
      return;
    }
    const target = this.perceive(f, foe, dt);
    this.move(f, foe, target, dt);
    this.aim(f, foe, target, dt);
    if (this.profile.usesCards) this.thinkCards(f, foe, dt);
  }

  // --------------------------------------------------------------- perceive
  private perceive(f: FighterSim, foe: FighterSim, dt: number): Perceived {
    const m = this.m;
    for (const d of m.decoys) {
      if (d.alive && d.owner === foe.side) return { x: d.x, z: d.z, vx: 0, vz: 0 };
    }
    if (m.inOwnSmoke(foe) && !m.inOwnSmoke(f)) {
      this.memT -= dt;
      if (this.memT <= 0) {
        this.memT = 0.7;
        this.memX = foe.x + m.rng.range(-1.3, 1.3);
        this.memZ = foe.z + m.rng.range(-1.3, 1.3);
      }
      return { x: this.memX, z: this.memZ, vx: 0, vz: 0 };
    }
    this.memT = 0;
    return { x: foe.x, z: foe.z, vx: foe.vx, vz: foe.vz };
  }

  // ------------------------------------------------------------------- move
  private move(f: FighterSim, foe: FighterSim, t: Perceived, dt: number): void {
    const m = this.m;
    const b = this.profile.behavior;
    const dx = t.x - f.x;
    const dz = t.z - f.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const ux = dx / dist;
    const uz = dz / dist;

    let desired = f.stats.preferredRange * b.rangeMult;
    if (f.overdrive > 0 || f.adrenaline > 0) desired *= 0.7;
    if (b.retreatHp > 0 && f.hpFrac < b.retreatHp && f.hpFrac < foe.hpFrac) desired *= 1.25;
    // Periodic "surge": even cautious fighters push in sometimes so fights never stall.
    this.surgeTimer -= dt;
    if (this.surgeTimer <= 0) {
      this.surgeT = m.rng.range(1.2, 2.2);
      this.surgeTimer = m.rng.range(5, 9);
    }
    if (this.surgeT > 0) {
      this.surgeT -= dt;
      desired *= 0.65;
    }
    desired = clamp(desired, 1.7, 8.5);

    const band = 0.55;
    let radial = 0;
    if (dist > desired + band) radial = clamp((dist - desired) / 2, 0.35, 1);
    else if (dist < desired - band) radial = -clamp((desired - dist) / 2, 0.35, 1);

    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      if (m.rng.chance(0.55)) this.strafeDir *= -1;
      this.strafeTimer = m.rng.range(0.8, 2.3);
    }
    let tanX = -uz * this.strafeDir;
    let tanZ = ux * this.strafeDir;
    const aheadX = f.x + tanX * 1.5;
    const aheadZ = f.z + tanZ * 1.5;
    if (Math.abs(aheadX) > ARENA.halfX - 0.4 || Math.abs(aheadZ) > ARENA.halfZ - 0.4) {
      this.strafeDir *= -1;
      this.strafeTimer = m.rng.range(1, 2);
      tanX = -tanX;
      tanZ = -tanZ;
    }

    let mx = ux * radial + tanX * b.strafe;
    let mz = uz * radial + tanZ * b.strafe;

    this.updateDodge(f, dt);
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      mx = this.dodgeX + mx * 0.15;
      mz = this.dodgeZ + mz * 0.15;
    }

    // Soft walls
    const wx = ARENA.halfX - 0.8;
    const wz = ARENA.halfZ - 0.8;
    if (f.x > wx) mx -= (f.x - wx) * 1.2;
    if (f.x < -wx) mx += (-wx - f.x) * 1.2;
    if (f.z > wz) mz -= (f.z - wz) * 1.2;
    if (f.z < -wz) mz += (-wz - f.z) * 1.2;

    // Personal space (real foe position, not the perceived one)
    const rdx = foe.x - f.x;
    const rdz = foe.z - f.z;
    const rd = Math.hypot(rdx, rdz);
    if (rd < 1.5 && rd > 0.001) {
      mx -= (rdx / rd) * (1.5 - rd) * 1.5;
      mz -= (rdz / rd) * (1.5 - rd) * 1.5;
    }

    const len = Math.hypot(mx, mz);
    if (len > 0.05) {
      f.intentX = mx / len;
      f.intentZ = mz / len;
      f.intentSpeed = clamp(len, 0.55, 1);
    } else {
      f.intentSpeed = 0;
    }
  }

  private updateDodge(f: FighterSim, _dt: number): void {
    const m = this.m;
    if (this.considered.size > 300) this.considered.clear();
    for (const p of m.projectiles) {
      if (p.owner === f.side || !p.alive || this.considered.has(p.id)) continue;
      const rx = f.x - p.x;
      const rz = f.z - p.z;
      const vv = p.vx * p.vx + p.vz * p.vz;
      const tca = (rx * p.vx + rz * p.vz) / vv;
      if (tca < 0) {
        this.considered.add(p.id);
        continue;
      }
      if (tca > 0.5) continue;
      this.considered.add(p.id);
      const cx = p.x + p.vx * tca - f.x;
      const cz = p.z + p.vz * tca - f.z;
      const miss = Math.hypot(cx, cz);
      if (miss > f.radius + p.radius + 0.25) continue;
      const chance = this.profile.dodgeSkill * f.stats.evasion * this.profile.behavior.dodgeMult * (p.heavy ? 1.25 : 1);
      if (!m.rng.chance(chance)) continue;
      const pl = Math.sqrt(vv);
      const nx = -p.vz / pl;
      const nz = p.vx / pl;
      let side = Math.sign(rx * nx + rz * nz);
      if (side === 0) side = this.strafeDir;
      this.dodgeX = nx * side;
      this.dodgeZ = nz * side;
      this.dodgeT = 0.3;
      p.sidestepped = true;
    }
  }

  // -------------------------------------------------------------------- aim
  private aim(f: FighterSim, foe: FighterSim, t: Perceived, dt: number): void {
    const m = this.m;
    const atk = f.stats.attack;
    const dist = Math.hypot(t.x - f.x, t.z - f.z);
    const lead = (dist / atk.speed) * this.profile.aimLead;
    f.aimX = t.x + t.vx * lead;
    f.aimZ = t.z + t.vz * lead;
    this.aimTimer -= dt;
    if (this.aimTimer <= 0) {
      this.aimTimer = 0.22;
      let err = this.profile.aimError;
      if (m.inOwnSmoke(foe)) err += CARD_TUNING.smoke.aimError;
      f.aimErr = m.rng.range(-err, err);
    }
    const reach = atk.weapon === 'boom_cannon' ? 0.92 : 1.02;
    f.wantFire = dist <= atk.range * reach;
  }

  // ------------------------------------------------------------------ cards
  private has(card: CardId): number {
    return this.m.hands[this.side].hand.indexOf(card);
  }

  private tryPlay(card: CardId): boolean {
    const i = this.has(card);
    if (i < 0) return false;
    return this.m.playCard(this.side, i) === null;
  }

  private detectThreat(f: FighterSim, foe: FighterSim): { key: string; kind: 'windup' | 'incoming' } | null {
    const m = this.m;
    const fa = foe.action;
    if (fa.kind === 'windup') {
      return { key: 'w' + Math.round((m.time - fa.t) * 20), kind: 'windup' };
    }
    if (fa.kind === 'rush') {
      const toX = f.x - foe.x;
      const toZ = f.z - foe.z;
      const along = toX * fa.dirX + toZ * fa.dirZ;
      const perp = Math.abs(toX * fa.dirZ - toZ * fa.dirX);
      if (along > 0 && along < 6 && perp < 1.6) return { key: 'r' + Math.round((m.time - fa.t) * 20), kind: 'incoming' };
    }
    for (const p of m.projectiles) {
      if (p.owner === f.side || !p.heavy || !p.alive) continue;
      const rx = f.x - p.x;
      const rz = f.z - p.z;
      const vv = p.vx * p.vx + p.vz * p.vz;
      const tca = (rx * p.vx + rz * p.vz) / vv;
      if (tca < 0 || tca > 0.5) continue;
      const miss = Math.hypot(p.x + p.vx * tca - f.x, p.z + p.vz * tca - f.z);
      if (miss < f.radius + p.radius + 0.5) return { key: 'p' + p.id, kind: 'incoming' };
    }
    return null;
  }

  private thinkCards(f: FighterSim, foe: FighterSim, dt: number): void {
    const m = this.m;
    const prof = this.profile;
    const b = prof.behavior;
    const hand = m.hands[this.side];

    // 1) Reactions to telegraphed danger.
    const threat = this.detectThreat(f, foe);
    if (threat && threat.key !== this.threatKey) {
      this.threatKey = threat.key;
      if (m.rng.chance(prof.dodgeSkill * b.dodgeMult)) {
        this.reactKind = threat.kind;
        this.reactT = prof.reaction * m.rng.range(0.25, 0.6);
      } else {
        this.reactT = -1;
      }
    }
    if (this.reactT >= 0) {
      this.reactT -= dt;
      if (this.reactT < 0) {
        if (this.reactKind === 'windup') {
          // Interrupt if possible, otherwise brace.
          if (foe.action.kind === 'windup' && (this.tryPlay('shock') || this.tryPlay('system_overload') || this.tryPlay('shield'))) return;
        } else {
          if (this.tryPlay('dash') || this.tryPlay('shield')) return;
        }
      }
    }

    // 2) Regular decisions.
    this.decisionTimer -= dt;
    if (this.decisionTimer > 0 || hand.lockout > 0 || f.busy) return;
    this.decisionTimer = prof.reaction * m.rng.range(0.7, 1.3);

    const dist = Math.hypot(foe.x - f.x, foe.z - f.z);
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < hand.hand.length; i++) {
      const card = hand.hand[i];
      const cost = CARDS[card].cost;
      if (hand.energy < cost) continue;
      let s = this.score(card, f, foe, dist);
      if (hand.energy - cost < b.energyReserve && s < 7) s *= 0.5;
      s = s * (0.5 + 0.5 * prof.cardSmarts) + m.rng.range(-1, 1) * (1 - prof.cardSmarts) * 3;
      s *= b.cardEagerness;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best >= 0 && bestScore >= 5) m.playCard(this.side, best);
  }

  private score(card: CardId, f: FighterSim, foe: FighterSim, dist: number): number {
    const m = this.m;
    const b = this.profile.behavior;
    const hand = m.hands[this.side];
    const combo = m.combos.wouldCombo(this.side, card, m.time) !== null;
    const hasHeavy = this.has('power_shot') >= 0 || this.has('knockout') >= 0;
    const foeDisabled = foe.stun > 0 || foe.glitch > 0 || foe.action.kind === 'recover';
    const foeBlocking = foe.shield > 0 || foe.invuln > 0;
    let s = 0;
    switch (card) {
      case 'dash':
        if (b.comboHunter && hasHeavy && hand.energy >= 6) s = 4;
        if (dist < 1.8) s += 2;
        break;
      case 'power_shot':
        s = dist < 11 ? 4.5 : 0;
        if (foeDisabled) s += 4;
        if (foeBlocking) s -= 6;
        if (combo) s += 4;
        if (foe.hp < 650) s += 2;
        break;
      case 'knockout':
        s = dist < 5.2 ? 5 : 1;
        if (foeDisabled) s += 4;
        if (foeBlocking) s -= 6;
        if (combo) s += 4;
        break;
      case 'shield':
        s = 1;
        if ((foe.overdrive > 0 || foe.adrenaline > 0) && dist < foe.stats.attack.range) s += 4.5;
        if (f.hpFrac < 0.4) s += 1.5;
        if (b.id === 'cautious') s += 1.5;
        if (b.comboHunter && this.has('overdrive') >= 0 && hand.energy >= 8) s += 2.5;
        if (f.shield > 0) s = -10;
        break;
      case 'smoke':
        s = 1.5;
        if (f.hpFrac < 0.5) s += 2.5;
        if (foe.overdrive > 0 || foe.adrenaline > 0) s += 2;
        if (b.comboHunter && this.has('dash') >= 0) s += 1.5;
        if (m.inOwnSmoke(f)) s = -10;
        break;
      case 'shock':
        s = 2.5;
        if (foe.shield > 0) s += 5;
        if (foe.overdrive > 0 || foe.adrenaline > 0) s += 2;
        if (b.comboHunter && hasHeavy && hand.energy >= 8) s += 3.5;
        if (foe.stun > 0 || foe.invuln > 0) s = -6;
        break;
      case 'overdrive':
        s = 3;
        if (dist < f.stats.preferredRange * 1.5) s += 1.5;
        if (combo) s += 4;
        if (b.id === 'aggressive') s += 1.5;
        if (this.has(f.def.signature) >= 0 && hand.energy >= 9) s += 2;
        if (f.overdrive > 0) s = -10;
        break;
      case 'adrenaline':
        s = dist < f.stats.attack.range * 1.1 ? 4.5 : 1;
        if (combo) s += 4;
        if (foeDisabled) s += 2;
        if (foe.shield > 0) s -= 4;
        break;
      case 'system_overload':
        s = 4;
        if (m.hands[foe.side].energy >= 5) s += 2;
        if (foe.overdrive > 0) s += 3;
        if (combo) s += 4;
        if (foe.glitch > 0 || foe.invuln > 0) s = -10;
        break;
    }
    return s;
  }
}
