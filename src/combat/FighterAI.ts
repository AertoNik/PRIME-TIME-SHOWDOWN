import { ARENA, CARD_TUNING, MATCH } from '../config/balance';
import { CARDS, COMBOS } from '../config/cards';
import type { BehaviorDef, CardId, Side } from '../config/types';
import { clamp } from '../core/math';
import type { FighterSim } from './FighterSim';
import type { Match } from './Match';

export interface AIProfile {
  aimLead: number;
  aimError: number;
  dodgeSkill: number;
  /** Human-like reaction window to visible threats. */
  reactMin: number;
  reactMax: number;
  /** Regular card decision cadence. */
  decideMin: number;
  decideMax: number;
  cardSmarts: number;
  /** 0..1 how often the AI deliberately chains its own combos. */
  comboPlanning: number;
  usesCards: boolean;
  behavior: BehaviorDef;
}

interface Perceived {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

interface ComboPlan {
  second: CardId;
  until: number;
}

/**
 * Drives one fighter: range management (aware of the matchup), strafing
 * with pauses, corner escape, sidestepping, aiming and — for the rival —
 * card decisions with human reaction delays, variety and combo planning.
 * The player's own fighter uses the same brain with `usesCards = false`.
 *
 * Fairness: the AI only reacts to things a player can see (charge
 * telegraphs, projectiles in flight) and always after a reaction delay.
 */
export class FighterAI {
  private m: Match;
  readonly side: Side;
  readonly profile: AIProfile;
  private strafeDir: number;
  private strafeTimer: number;
  private strafeAmt = 1;
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
  private plantT = 0;
  private plantTimer: number;
  private recent: CardId[] = [];
  private plan: ComboPlan | null = null;

  constructor(m: Match, side: Side, profile: AIProfile) {
    this.m = m;
    this.side = side;
    this.profile = profile;
    this.strafeDir = m.rng.sign();
    this.strafeTimer = m.rng.range(0.8, 2);
    this.decisionTimer = 1.4 + m.rng.range(0, 1);
    this.surgeTimer = m.rng.range(3, 6);
    this.plantTimer = m.rng.range(2.5, 5);
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

  /** Preferred fighting distance for this matchup and situation. */
  private desiredRange(f: FighterSim, foe: FighterSim): number {
    const b = this.profile.behavior;
    let desired = f.stats.preferredRange * b.rangeMult;
    const myReach = f.stats.attack.range;
    const foeReach = foe.stats.attack.range;
    // Outranged fighters close in; longer-ranged fighters kite just outside
    // the opponent's effective range (aggressive fighters ignore this).
    if (b.id !== 'aggressive' && b.pressure <= 0 && myReach > foeReach + 1.5) {
      desired = Math.max(desired, Math.min(myReach * 0.85, foeReach + 1.4));
    } else if (myReach < foeReach - 1.5) {
      desired = Math.min(desired, f.stats.preferredRange);
    }
    if (f.overdrive > 0 || f.adrenaline > 0) desired *= 0.7;
    // Exploit a disabled or drained opponent by pressing in.
    if (foe.stun > 0 || foe.glitch > 0 || foe.action.kind === 'recover') desired *= 0.75;
    // Low-health personalities
    const losing = f.hpFrac < foe.hpFrac;
    if (f.hpFrac < 0.3) {
      if (b.id === 'aggressive' && foe.hpFrac < 0.4) desired *= 0.8; // all-in
      else if (b.id === 'cautious' || (b.id === 'tactical' && losing)) desired *= 1.25;
    } else if (b.retreatHp > 0 && f.hpFrac < b.retreatHp && losing) {
      desired *= 1.2;
    }
    if (this.surgeT > 0) desired *= 0.65;
    // relentless fighters never back off for low health
    if (b.pressure > 0 && f.hpFrac < 0.3) desired = Math.min(desired, f.stats.preferredRange * b.rangeMult);
    return clamp(desired, 1.7, 8.5);
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

    // Periodic surge: even cautious fighters push in so fights never stall.
    this.surgeTimer -= dt;
    if (this.surgeTimer <= 0) {
      const eager = b.id === 'aggressive' || b.pressure > 0;
      this.surgeT = m.rng.range(1.2, 2.2) * (1 + b.pressure * 0.5);
      this.surgeTimer = m.rng.range(eager ? 3.5 - b.pressure : 5, eager ? 6 - b.pressure * 1.5 : 9);
    }
    if (this.surgeT > 0) this.surgeT -= dt;
    const desired = this.desiredRange(f, foe);

    const band = 0.55;
    let radial = 0;
    if (dist > desired + band) radial = clamp((dist - desired) / 2, 0.35, 1);
    else if (dist < desired - band) radial = -clamp((desired - dist) / 2, 0.35, 1);

    // Pursuit: lead a retreating opponent instead of trailing behind.
    const foeAway = (foe.vx * ux + foe.vz * uz) / Math.max(0.1, foe.stats.moveSpeed);
    if (radial > 0 && foeAway > 0.5 && b.id !== 'cautious') radial = Math.min(1, radial + 0.3 + b.pressure * 0.3);
    // pressure fighters charge in at full speed instead of easing into range
    if (radial > 0 && b.pressure > 0) radial = Math.min(1, radial + b.pressure * 0.35);

    // Strafing with varying intensity and short planted pauses (shooting stance)
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      if (m.rng.chance(0.55)) this.strafeDir *= -1;
      this.strafeTimer = m.rng.range(0.8, 2.3);
      this.strafeAmt = m.rng.range(0.6, 1.15);
    }
    this.plantTimer -= dt;
    if (this.plantTimer <= 0) {
      this.plantT = m.rng.range(0.35, 0.75);
      this.plantTimer = m.rng.range(b.id === 'aggressive' ? 4 : 2.8, b.id === 'aggressive' ? 7 : 5) * (1 + b.pressure * 1.5);
    }
    let strafe = b.strafe * this.strafeAmt;
    if (this.plantT > 0) {
      this.plantT -= dt;
      strafe *= 0.15;
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

    let mx = ux * radial + tanX * strafe;
    let mz = uz * radial + tanZ * strafe;

    this.updateDodge(f);
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      mx = this.dodgeX + mx * 0.15;
      mz = this.dodgeZ + mz * 0.15;
    }

    // Soft walls, plus a stronger pull out of corners.
    const wx = ARENA.halfX - 0.8;
    const wz = ARENA.halfZ - 0.8;
    let walls = 0;
    if (f.x > wx) {
      mx -= (f.x - wx) * 1.2;
      walls++;
    }
    if (f.x < -wx) {
      mx += (-wx - f.x) * 1.2;
      walls++;
    }
    if (f.z > wz) {
      mz -= (f.z - wz) * 1.2;
      walls++;
    }
    if (f.z < -wz) {
      mz += (-wz - f.z) * 1.2;
      walls++;
    }
    if (walls >= 2) {
      const cl = Math.hypot(f.x, f.z) || 1;
      mx -= (f.x / cl) * 0.9;
      mz -= (f.z / cl) * 0.9;
    }

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
      f.intentSpeed = clamp(len, this.plantT > 0 ? 0.2 : 0.55, 1);
    } else {
      f.intentSpeed = 0;
    }
  }

  private updateDodge(f: FighterSim): void {
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
    const ok = this.m.playCard(this.side, i) === null;
    if (ok) this.remember(card);
    return ok;
  }

  private remember(card: CardId): void {
    this.recent.unshift(card);
    if (this.recent.length > 3) this.recent.pop();
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
      if (tca < 0 || tca > 0.65) continue;
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

    // 1) Reactions to visible danger, after a human reaction delay.
    const threat = this.detectThreat(f, foe);
    if (threat && threat.key !== this.threatKey) {
      this.threatKey = threat.key;
      if (m.rng.chance(prof.dodgeSkill * b.dodgeMult)) {
        this.reactKind = threat.kind;
        this.reactT = m.rng.range(prof.reactMin, prof.reactMax);
      } else {
        this.reactT = -1;
      }
    }
    if (this.reactT >= 0) {
      this.reactT -= dt;
      if (this.reactT < 0) {
        if (this.reactKind === 'windup') {
          // Interrupt if the charge is still going, otherwise brace.
          if (foe.action.kind === 'windup' && (this.tryPlay('shock') || this.tryPlay('system_overload') || this.tryPlay('shield'))) return;
        } else if (this.tryPlay('dash') || this.tryPlay('shield')) {
          return;
        }
      }
    }

    // 2) Finish a planned combo while its window is open.
    if (this.plan) {
      const p = this.plan;
      if (m.time > p.until || m.combos.windowLeft(this.side, m.time) <= 0) {
        this.plan = null;
      } else if (!f.busy && hand.lockout <= 0 && hand.energy >= CARDS[p.second].cost && m.combos.wouldCombo(this.side, p.second, m.time)) {
        const disrupted = foe.shield > 0 && (p.second === 'power_shot' || p.second === 'knockout');
        // (CHARGED SHOT pierces shields, so a raised shield does not spoil it)
        if (!disrupted && this.tryPlay(p.second)) {
          this.plan = null;
          return;
        }
      }
    }

    // 3) Regular decisions at a human cadence.
    this.decisionTimer -= dt;
    if (this.decisionTimer > 0 || hand.lockout > 0 || f.busy) return;
    this.decisionTimer = m.rng.range(prof.decideMin, prof.decideMax);

    // 3a) Open a combo when both halves are in hand and affordable within the window.
    if (!this.plan && m.rng.chance(prof.comboPlanning * (b.comboHunter ? 1.15 : 0.8))) {
      const regen = MATCH.energyPerSecond * hand.regenMult * MATCH.comboWindow * 0.75;
      for (const c of COMBOS) {
        const first = c.first.find((x) => this.has(x) >= 0);
        // pressure fighters finish with the charge (KNOCKOUT) whenever they can
        const seconds = b.pressure > 0 ? [...c.second].sort((x, y) => Number(y === 'knockout') - Number(x === 'knockout')) : c.second;
        const second = seconds.find((x) => this.has(x) >= 0);
        if (!first || !second || first === second) continue;
        const total = CARDS[first].cost + CARDS[second].cost;
        if (hand.energy < CARDS[first].cost || hand.energy + regen < total) continue;
        if (!this.comboMakesSense(c.id, f, foe)) continue;
        if (this.tryPlay(first)) {
          this.plan = { second, until: m.time + MATCH.comboWindow - 0.1 };
          return;
        }
      }
    }

    const dist = Math.hypot(foe.x - f.x, foe.z - f.z);
    const scored: { i: number; s: number }[] = [];
    for (let i = 0; i < hand.hand.length; i++) {
      const card = hand.hand[i];
      const cost = CARDS[card].cost;
      if (hand.energy < cost) continue;
      let s = this.score(card, f, foe, dist);
      if (hand.energy - cost < b.energyReserve && s < 7) s *= 0.5;
      // variety: repeating recent cards is boring and predictable
      if (this.recent[0] === card) s -= 2.5;
      else if (this.recent.includes(card)) s -= 1;
      s = s * (0.5 + 0.5 * prof.cardSmarts) + m.rng.range(-1, 1) * (1 - prof.cardSmarts) * 3;
      s *= b.cardEagerness;
      if (s >= 5) scored.push({ i, s });
    }
    if (!scored.length) return;
    scored.sort((a, c) => c.s - a.s);
    // Usually the best option, sometimes the runner-up (keeps rivals from looping).
    const pick = scored.length > 1 && m.rng.chance(0.38 - 0.25 * prof.cardSmarts) ? scored[1] : scored[0];
    const card = hand.hand[pick.i];
    if (m.playCard(this.side, pick.i) === null) this.remember(card);
  }

  private comboMakesSense(id: string, f: FighterSim, foe: FighterSim): boolean {
    const dist = Math.hypot(foe.x - f.x, foe.z - f.z);
    switch (id) {
      case 'counter_strike':
      case 'electro_blast':
        return foe.shield <= 0 && dist < 10;
      case 'iron_rush':
        return dist < 5;
      case 'phantom_step':
        return f.hpFrac < 0.75;
      case 'superstar':
        return dist < f.stats.attack.range * 1.1 && foe.shield <= 0;
      default:
        return true;
    }
  }

  private score(card: CardId, f: FighterSim, foe: FighterSim, dist: number): number {
    const m = this.m;
    const b = this.profile.behavior;
    const hand = m.hands[this.side];
    const combo = m.combos.wouldCombo(this.side, card, m.time) !== null;
    const hasHeavy = this.has('power_shot') >= 0 || this.has('knockout') >= 0 || this.has('charged_shot') >= 0 || this.has('prime_pulse') >= 0;
    const foeDisabled = foe.stun > 0 || foe.glitch > 0 || foe.action.kind === 'recover';
    // Visible openings a pressure fighter jumps on: the foe just spent its DASH,
    // is slowed, or is committed to a charge of its own.
    const opening = b.pressure > 0 && (m.time - foe.lastDash < 1.2 || foe.slow > 0 || foe.action.kind === 'windup');
    const foeBlocking = foe.shield > 0 || foe.invuln > 0;
    const threatened = foe.overdrive > 0 || foe.adrenaline > 0;
    let s = 0;
    switch (card) {
      case 'dash':
        if (b.comboHunter && hasHeavy && hand.energy >= 6) s = 3.5;
        if (dist < 1.8 && b.pressure <= 0) s += 2.5;
        if (f.hpFrac < 0.35 && threatened) s += 2;
        // gap closer: rush in when the target keeps its distance
        if (b.pressure > 0 && dist > f.stats.preferredRange + 2.2) s += 5 * b.pressure;
        break;
      case 'power_shot':
        s = dist < 11 ? 4.5 : 0;
        if (foeDisabled) s += 4.5;
        if (foeBlocking) s -= 6;
        if (combo) s += 4;
        if (foe.hp < 700) s += 2.5;
        if (opening) s += 2.5;
        break;
      case 'knockout':
        s = dist < 4.8 ? 5.2 : 0.5;
        if (foeDisabled) s += 4.5;
        if (foeBlocking) s -= 6;
        if (combo) s += 4;
        if (opening && dist < 5.2) s += 3;
        if (b.pressure > 0 && dist < 5.2) s += 2.5 * b.pressure;
        break;
      case 'prime_pulse': {
        // the champion's shockwave: only when the target is inside its reach and not protected
        const reach = this.m.abilities.pulseTuning().range;
        if (f.pulseCd > 0) s = -10;
        else {
          s = dist < reach * 0.85 ? 6.5 : dist < reach ? 3 : -4;
          if (foeDisabled) s += 3;
          if (opening) s += 2;
          if (foe.shield > 0 || foe.invuln > 0) s -= 7;
        }
        break;
      }
      case 'charged_shot':
        // pierces shields and hits harder from afar
        s = dist > 5 ? 6 : 4;
        if (foeDisabled) s += 4;
        if (foe.shield > 0) s += 1.5;
        if (foe.invuln > 0) s -= 6;
        if (combo) s += 4;
        break;
      case 'shield':
        s = 1;
        if (threatened && dist < foe.stats.attack.range) s += 4.5;
        if (f.hpFrac < 0.4) s += 1.5;
        if (b.id === 'cautious') s += 1.5;
        if (f.shield > 0) s = -10;
        break;
      case 'smoke':
        s = 1.5;
        if (f.hpFrac < 0.5) s += 2.5;
        if (threatened) s += 2;
        if (b.id === 'cautious') s += 1;
        if (m.inOwnSmoke(f)) s = -10;
        break;
      case 'shock':
        s = 2.5;
        if (foe.shield > 0) s += 5;
        if (threatened) s += 2;
        if (b.comboHunter && hasHeavy && hand.energy >= 8) s += 3;
        if (foe.stun > 0 || foe.invuln > 0) s = -6;
        break;
      case 'overdrive':
        s = 3;
        if (dist < f.stats.preferredRange * 1.5) s += 1.5;
        if (combo) s += 4;
        if (b.id === 'aggressive') s += 1.5;
        if (b.pressure > 0 && dist < f.stats.preferredRange * 2) s += 2 * b.pressure;
        if (foe.hpFrac < 0.35) s += 1;
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
        if (threatened) s += 3;
        if (combo) s += 4;
        if (foe.glitch > 0 || foe.invuln > 0) s = -10;
        break;
    }
    return s;
  }
}
