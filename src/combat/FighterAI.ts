import { ARENA, CARD_TUNING, MATCH } from '../config/balance';
import { CARDS, COMBOS } from '../config/cards';
import type { BehaviorDef, CardId, RivalControl, Side } from '../config/types';
import { clamp, segSegDist } from '../core/math';
import type { BankSolution } from './CombatSystem';
import type { FighterSim } from './FighterSim';
import type { StageObject } from './types';
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
  /** Alpha 1.5.5: rival-only limits on control cards (Zoe). */
  control?: RivalControl;
}

const isControl = (card: CardId) => card === 'shock' || card === 'system_overload';

const bankScore: BankSolution = { dirX: 0, dirZ: 1, bx: 0, bz: 0, bounce: false, len1: 0, len2: 0 };

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
  /** Alpha 1.5.5: match time from which a control card may be played again (rivals with a control profile). */
  private ctrlReadyAt = 0;
  private ovlReadyAt = 0;
  /** Alpha 1.6: stage hazards this fighter noticed (object id → steers clear), decided once per object. */
  private hazards = new Map<number, boolean>();

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
    // Alpha 1.6 HOLO DECOY: regular fire goes at the hologram, cards and charged attacks do not
    const holo = this.holoTarget(foe);
    this.move(f, foe, target, dt);
    this.aim(f, foe, target, holo, dt);
    if (this.profile.usesCards) this.thinkCards(f, foe, dt);
  }

  /** The opponent's live HOLO DECOY, if any (it fools this fighter's regular aim only). */
  private holoTarget(foe: FighterSim): Perceived | null {
    for (const d of this.m.decoys) {
      if (d.alive && d.kind === 'holo' && d.owner === foe.side) return { x: d.x, z: d.z, vx: 0, vz: 0 };
    }
    return null;
  }

  // --------------------------------------------------------------- perceive
  private perceive(f: FighterSim, foe: FighterSim, dt: number): Perceived {
    const m = this.m;
    for (const d of m.decoys) {
      if (d.alive && d.kind === 'phantom' && d.owner === foe.side) return { x: d.x, z: d.z, vx: 0, vz: 0 };
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
    // BOSS FIGHT: the champion's rifle outranges everyone — whatever the surge or phase, he
    // holds his firing distance and repositions instead of walking into the opponent
    if (b.holdRange && myReach > foeReach + 1) desired = Math.max(desired, Math.min(b.holdRange, foeReach + 1));
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
    // BOSS FIGHT: backing away from a fighter who is too close, the champion circles towards
    // open floor instead of retreating into the barrier (where brawlers pin him)
    const retreating = !!b.holdRange && radial < 0;
    if (retreating) {
      const edge = Math.max(Math.abs(f.x) / ARENA.halfX, Math.abs(f.z) / ARENA.halfZ);
      if (edge > 0.5 && tanX * -f.x + tanZ * -f.z < 0) {
        this.strafeDir *= -1;
        this.strafeTimer = m.rng.range(0.8, 1.6);
        tanX = -tanX;
        tanZ = -tanZ;
      }
      this.strafeAmt = Math.max(this.strafeAmt, 1);
      // near the barrier: circle round the opponent instead of backing further into the wall
      const wallK = clamp((edge - 0.55) / 0.35, 0, 1);
      radial *= 1 - 0.75 * wallK;
      strafe = Math.max(strafe, b.strafe) * (1 + 0.6 * wallK);
    }
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

    // Alpha 1.6: step out of warning circles, slowing nets and around armed mines (when noticed)
    const avoid = this.hazardSteer(f);
    if (avoid) {
      mx = mx * 0.35 + avoid.x;
      mz = mz * 0.35 + avoid.z;
    }
    // Alpha 1.6: own set pieces — peek round the edge of one's STAGE BARRIER to shoot, keep to one's FREEZE FRAME
    const own = this.ownPieces(f, foe);
    if (own) {
      mx = mx * 0.5 + own.x;
      mz = mz * 0.5 + own.z;
    }

    this.updateDodge(f);
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      // the champion keeps repositioning while he sidesteps (a shotgun spray up close cannot be dodged anyway)
      const keep = retreating ? 0.8 : 0.15;
      mx = this.dodgeX * (retreating ? 0.5 : 1) + mx * keep;
      mz = this.dodgeZ * (retreating ? 0.5 : 1) + mz * keep;
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

  /**
   * Alpha 1.6 — counterplay to the new set pieces, with human limits: each hazard is noticed
   * (or not) once, with the fighter's dodge skill, and only after a reaction delay; then the
   * fighter walks out of a PROP DROP circle or a GRAVITY NET and around an armed mine.
   */
  private hazardSteer(f: FighterSim): { x: number; z: number } | null {
    const m = this.m;
    if (this.hazards.size > 64) this.hazards.clear();
    let sx = 0;
    let sz = 0;
    let any = false;
    for (const o of m.objects.list) {
      if (o.owner === f.side) continue;
      const hazard = (o.kind === 'prop' && o.stage === 'warn') || (o.kind === 'mine' && o.stage !== 'fly') || (o.kind === 'net' && o.stage === 'on') || (o.kind === 'echo' && o.stage === 'lock' && o.combo !== 'blindside');
      if (!hazard) continue;
      let seen = this.hazards.get(o.id);
      if (seen === undefined) {
        const b = this.profile.behavior;
        seen = m.rng.chance(clamp(this.profile.dodgeSkill * b.dodgeMult * f.stats.evasion * 1.15 + 0.15, 0.15, 0.95));
        this.hazards.set(o.id, seen);
      }
      if (!seen) continue;
      if (o.kind === 'echo') {
        // the frozen line of a SECOND TAKE echo: sidestep off it
        const rx = f.x - o.x;
        const rz = f.z - o.z;
        const along = rx * o.dirX + rz * o.dirZ;
        const perp = rx * o.dirZ - rz * o.dirX;
        if (along > 0 && Math.abs(perp) < f.radius + 0.6) {
          const sg = perp >= 0 ? 1 : -1;
          sx += o.dirZ * sg * 1.4;
          sz += -o.dirX * sg * 1.4;
          any = true;
        }
        continue;
      }
      // react after a short delay (reading the hazard), then move out
      const age = o.kind === 'prop' ? o.t : o.kind === 'mine' ? o.t + (o.stage === 'armed' ? 1 : 0) : o.t;
      if (age < this.profile.reactMin) continue;
      const dx = f.x - o.x;
      const dz = f.z - o.z;
      const d = Math.hypot(dx, dz) || 0.01;
      const reach = o.kind === 'mine' ? o.radius + 0.8 : o.radius + 0.5;
      if (d >= reach) continue;
      const w = o.kind === 'mine' ? 1.4 : o.kind === 'prop' ? 1.8 : 1.1;
      sx += (dx / d) * w * (1 - d / reach + 0.35);
      sz += (dz / d) * w * (1 - d / reach + 0.35);
      any = true;
    }
    return any ? { x: sx, z: sz } : null;
  }

  /**
   * Alpha 1.6.1 — how a fighter treats STAGE BARRIERS (screens stop the shots of both sides):
   * - its own screen: under fire it keeps (or steps back) behind it; otherwise, when the screen
   *   blocks its line of fire, it edges to the nearer end to shoot round it (cover shooting);
   * - the opponent's screen: when it blocks the line of fire, it walks round the nearer end
   *   (and keeps shooting it down meanwhile).
   * Nobody bumps into a screen, so nobody can get stuck on one.
   */
  private ownPieces(f: FighterSim, foe: FighterSim): { x: number; z: number } | null {
    const m = this.m;
    let sx = 0;
    let sz = 0;
    let any = false;
    const own = m.objects.own(f.side, 'barrier');
    if (own) {
      // the screen's normal towards the opponent; which side each fighter is on
      let nx = -own.dirZ;
      let nz = own.dirX;
      if ((foe.x - own.x) * nx + (foe.z - own.z) * nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const mySide = (f.x - own.x) * nx + (f.z - own.z) * nz;
      const lateral = (f.x - own.x) * own.dirX + (f.z - own.z) * own.dirZ;
      const covered = mySide < 0 && Math.abs(lateral) < own.radius;
      const pressed = this.underFire(f, foe) || (mySide > 0 && Math.hypot(foe.x - f.x, foe.z - f.z) < 2.2);
      if (pressed && !covered) {
        // take cover: behind the screen, in line with it
        const l = Math.max(-own.radius + 0.45, Math.min(own.radius - 0.45, lateral));
        const cx = own.x + own.dirX * l - nx * 0.9;
        const cz = own.z + own.dirZ * l - nz * 0.9;
        const dx = cx - f.x;
        const dz = cz - f.z;
        const d = Math.hypot(dx, dz) || 1;
        sx += (dx / d) * 1.3;
        sz += (dz / d) * 1.3;
        any = true;
      } else if (!pressed && this.coverBlocks(f, own)) {
        // peek: the end of the screen nearer to the fighter, plus a step past it
        const s1 = lateral >= 0 ? 1 : -1;
        const ex = own.x + own.dirX * s1 * (own.radius + 0.7);
        const ez = own.z + own.dirZ * s1 * (own.radius + 0.7);
        const dx = ex - f.x;
        const dz = ez - f.z;
        const d = Math.hypot(dx, dz) || 1;
        sx += (dx / d) * 1.1;
        sz += (dz / d) * 1.1;
        any = true;
      }
    }
    const theirs = m.objects.own(foe.side, 'barrier');
    if (theirs && this.coverBlocks(f, theirs)) {
      // go round the opponent's screen: past its nearer end, on this fighter's side
      const lateral = (f.x - theirs.x) * theirs.dirX + (f.z - theirs.z) * theirs.dirZ;
      const s1 = lateral >= 0 ? 1 : -1;
      const ex = theirs.x + theirs.dirX * s1 * (theirs.radius + 1.0);
      const ez = theirs.z + theirs.dirZ * s1 * (theirs.radius + 1.0);
      const dx = ex - f.x;
      const dz = ez - f.z;
      const d = Math.hypot(dx, dz) || 1;
      sx += (dx / d) * 0.9;
      sz += (dz / d) * 0.9;
      any = true;
    }
    return any ? { x: sx, z: sz } : null;
  }

  /** Under fire right now: the opponent's burst is on, a charge is coming, or shots are on the way. */
  private underFire(f: FighterSim, foe: FighterSim): boolean {
    if (foe.overdrive > 0 || foe.adrenaline > 0 || foe.action.kind === 'windup') return true;
    for (const p of this.m.projectiles) {
      if (!p.alive || p.owner === f.side) continue;
      const rx = f.x - p.x;
      const rz = f.z - p.z;
      const v = Math.hypot(p.vx, p.vz) || 1;
      const along = (rx * p.vx + rz * p.vz) / v;
      if (along > 0 && along < 6 && Math.abs(rx * p.vz - rz * p.vx) / v < 1.2) return true;
    }
    return false;
  }

  private updateDodge(f: FighterSim): void {
    const m = this.m;
    if (this.considered.size > 300) this.considered.clear();
    for (const p of m.projectiles) {
      // a BANK SHOT after its ricochet is a new approach (its own key)
      const key = p.bounced ? -p.id : p.id;
      if (p.owner === f.side || !p.alive || this.considered.has(key)) continue;
      // Alpha 1.6 BLINDSIDE: distracted by the hologram, the fighter does not see this one coming
      if (p.blind) {
        this.considered.add(key);
        continue;
      }
      const rx = f.x - p.x;
      const rz = f.z - p.z;
      // Alpha 1.6 FREEZE FRAME: time the sidestep by the speed the shot really has in a slow-motion
      // zone (with the full speed the fighter stepped aside far too early and walked back into it)
      const k = m.objects.freezeScale(p);
      const pvx = p.vx * k;
      const pvz = p.vz * k;
      const vv = pvx * pvx + pvz * pvz;
      const tca = (rx * pvx + rz * pvz) / vv;
      if (tca < 0) {
        this.considered.add(key);
        continue;
      }
      if (tca > 0.5) continue;
      this.considered.add(key);
      const cx = p.x + pvx * tca - f.x;
      const cz = p.z + pvz * tca - f.z;
      const miss = Math.hypot(cx, cz);
      if (miss > f.radius + p.radius + 0.25) continue;
      // Alpha 1.6 FREEZE FRAME: a shot crawling through a slow-motion zone is easier to read
      let chance = this.profile.dodgeSkill * f.stats.evasion * this.profile.behavior.dodgeMult * (p.heavy ? 1.25 : 1);
      if (k < 1) chance = Math.min(0.95, chance * CARD_TUNING.freeze_frame.dodgeMult);
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
  private aim(f: FighterSim, foe: FighterSim, t: Perceived, holo: Perceived | null, dt: number): void {
    const m = this.m;
    const atk = f.stats.attack;
    const dist = Math.hypot(t.x - f.x, t.z - f.z);
    const lead = (dist / atk.speed) * this.profile.aimLead;
    // charged attacks and card shots (Alpha 1.6: a HOLO DECOY does not fool these)
    f.cardAimX = t.x + t.vx * lead;
    f.cardAimZ = t.z + t.vz * lead;
    f.leadK = this.profile.aimLead;
    if (holo) {
      // the hologram stands still: no lead
      f.aimX = holo.x;
      f.aimZ = holo.z;
    } else {
      f.aimX = f.cardAimX;
      f.aimZ = f.cardAimZ;
    }
    f.seenX = t.x;
    f.seenZ = t.z;
    f.seenVX = t.vx;
    f.seenVZ = t.vz;
    this.aimTimer -= dt;
    if (this.aimTimer <= 0) {
      this.aimTimer = 0.22;
      let err = this.profile.aimError;
      if (m.inOwnSmoke(foe)) err += CARD_TUNING.smoke.aimError;
      f.aimErr = m.rng.range(-err, err);
    }
    const reach = atk.weapon === 'boom_cannon' ? 0.92 : 1.02;
    const fireDist = holo ? Math.hypot(holo.x - f.x, holo.z - f.z) : dist;
    const own = m.objects.own(f.side, 'barrier');
    f.wantFire = fireDist <= atk.range * reach && !(own && this.coverBlocks(f, own));
  }

  /** Alpha 1.6: a STAGE BARRIER stands in this fighter's line of fire (its own: hold fire until the line is clear). */
  private coverBlocks(f: FighterSim, b: StageObject): boolean {
    return segSegDist(f.x, f.z, f.aimX, f.aimZ, b.x - b.dirX * b.radius, b.z - b.dirZ * b.radius, b.x + b.dirX * b.radius, b.z + b.dirZ * b.radius) < 0.25;
  }

  // ------------------------------------------------------------------ cards
  private has(card: CardId): number {
    return this.m.hands[this.side].hand.indexOf(card);
  }

  private tryPlay(card: CardId): boolean {
    const i = this.has(card);
    if (i < 0) return false;
    if (isControl(card) && !this.controlAllowed(card)) return false;
    const ok = this.m.playCard(this.side, i) === null;
    if (ok) this.remember(card);
    return ok;
  }

  private remember(card: CardId): void {
    this.recent.unshift(card);
    if (this.recent.length > 3) this.recent.pop();
    const c = this.profile.control;
    if (c && isControl(card)) this.ctrlReadyAt = this.m.time + c.gap;
    if (c && card === 'system_overload') this.ovlReadyAt = this.m.time + c.overloadGap;
  }

  /**
   * Alpha 1.5.5 — a rival with a control profile (Zoe) keeps its SHOCK / SYSTEM OVERLOAD fair:
   * a cooldown between control cards, none while the target is still stunned / glitched or
   * just recovering (the player always gets a window to act), and none mid-charge.
   */
  private controlAllowed(card: CardId | null = null): boolean {
    const c = this.profile.control;
    if (!c) return true;
    const m = this.m;
    const f = m.fighters[this.side];
    const foe = m.fighters[1 - this.side];
    if (m.time < this.ctrlReadyAt || f.zap > 0) return false;
    if (card === 'system_overload' && m.time < this.ovlReadyAt) return false;
    if (foe.stun > 0 || foe.glitch > 0 || m.time - foe.ctrlEnd < c.recovery) return false;
    return true;
  }

  private detectThreat(f: FighterSim, foe: FighterSim): { key: string; kind: 'windup' | 'incoming' } | null {
    const m = this.m;
    const fa = foe.action;
    // Alpha 1.6 BLINDSIDE: a charge behind the hologram goes unseen
    if (fa.kind === 'windup' && fa.combo !== 'blindside') {
      return { key: 'w' + Math.round((m.time - fa.t) * 20), kind: 'windup' };
    }
    if (fa.kind === 'cut') {
      // the alert is a chance to interrupt; a frozen line through me is the cue to DASH / SHIELD
      if (fa.stage === 'prep') return { key: 'cp' + Math.round((m.time - fa.t) * 20), kind: 'windup' };
      if (fa.stage === 'lock') {
        const t = fa.tune;
        const near = m.abilities.inCutLane(foe, fa.dirX, fa.dirZ, t.halfWidth[fa.shot] + 0.35, t.length[fa.shot], f.x, f.z, f.radius);
        if (near >= 0) return { key: 'cl' + fa.shot + '_' + Math.round(fa.lockedAt * 20), kind: 'incoming' };
      }
    }
    if (fa.kind === 'rush') {
      const toX = f.x - foe.x;
      const toZ = f.z - foe.z;
      const along = toX * fa.dirX + toZ * fa.dirZ;
      const perp = Math.abs(toX * fa.dirZ - toZ * fa.dirX);
      if (along > 0 && along < 6 && perp < 1.6) return { key: 'r' + Math.round((m.time - fa.t) * 20), kind: 'incoming' };
    }
    // Alpha 1.6.1 SECOND TAKE: the echo's frozen line through the fighter is a cue for DASH / SHIELD
    for (const o of m.objects.list) {
      if (o.kind !== 'echo' || o.stage !== 'lock' || o.owner === f.side || o.combo === 'blindside') continue;
      const rx = f.x - o.x;
      const rz = f.z - o.z;
      if (rx * o.dirX + rz * o.dirZ > 0 && Math.abs(rx * o.dirZ - rz * o.dirX) < f.radius + 0.5) return { key: 'c' + o.id, kind: 'incoming' };
    }
    for (const p of m.projectiles) {
      if (p.owner === f.side || !p.heavy || !p.alive || p.blind) continue;
      const rx = f.x - p.x;
      const rz = f.z - p.z;
      const vv = p.vx * p.vx + p.vz * p.vz;
      const tca = (rx * p.vx + rz * p.vz) / vv;
      if (tca < 0 || tca > 0.65) continue;
      const miss = Math.hypot(p.x + p.vx * tca - f.x, p.z + p.vz * tca - f.z);
      if (miss < f.radius + p.radius + 0.5) return { key: 'p' + p.id + (p.bounced ? 'b' : ''), kind: 'incoming' };
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
          const charging = foe.action.kind === 'windup' || (foe.action.kind === 'cut' && foe.action.stage === 'prep');
          // FALSE START reads a charge whose aim already froze (the shot comes within the window)
          const locked = foe.action.kind === 'windup' && foe.action.locked;
          // a control rival only sometimes answers with SHOCK / OVERLOAD (its roll comes after the usual one)
          const c = prof.control;
          const zapOk = !c || (this.controlAllowed() && m.rng.chance(c.interruptMult));
          // Alpha 1.6: a screen or a frame also answers a shot that is coming (not CHARGED SHOT, not a charge)
          const shot = foe.action.kind === 'windup' && (foe.action.card === 'power_shot' || foe.action.card === 'bank_shot');
          if (
            charging &&
            ((zapOk && (this.tryPlay('shock') || this.tryPlay('system_overload'))) ||
              (locked && this.tryPlay('false_start')) ||
              this.tryPlay('shield') ||
              (shot && locked && (this.tryPlay('frame_catch') || this.tryPlay('stage_barrier'))))
          )
            return;
        } else if (this.tryPlay('dash') || this.tryPlay('false_start') || this.tryPlay('shield') || (this.projectileThreat(f) && this.tryPlay('frame_catch'))) {
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
      if (isControl(card) && !this.controlAllowed(card)) s = -10;
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

  /** A heavy enemy projectile is on its way to this fighter (FRAME CATCH can take it). */
  private projectileThreat(f: FighterSim): boolean {
    for (const p of this.m.projectiles) {
      if (p.owner === f.side || !p.alive || !p.heavy || (p.kind === 'power' && p.pierce > 0) || p.kind === 'zap') continue;
      const rx = f.x - p.x;
      const rz = f.z - p.z;
      if (rx * p.vx + rz * p.vz > 0 && Math.hypot(rx, rz) < 7) return true;
    }
    return false;
  }

  private comboMakesSense(id: string, f: FighterSim, foe: FighterSim): boolean {
    const dist = Math.hypot(foe.x - f.x, foe.z - f.z);
    const threatened = foe.overdrive > 0 || foe.adrenaline > 0;
    switch (id) {
      // Alpha 1.6
      case 'spotlight':
      case 'blindside':
        return foe.shield <= 0 && dist < 10;
      case 'tight_spread':
        return dist < 6;
      case 'boomerang':
        return dist < 8;
      case 'gravity_trap':
        return dist < 9;
      case 'mine_drive':
        return dist < 3.2;
      case 'wall_push':
        return dist < 4.5;
      // DASH is the answer to telegraphed attacks: positional DASH combos only under threat
      case 'backstage':
      case 'double_take':
        return threatened;
      case 'all_in':
        return dist < f.stats.preferredRange * 1.6;
      case 'insurance':
        return f.hpFrac < 0.85 || threatened;
      case 'jackpot':
        return false; // a chain: it follows INSURANCE on its own
      case 'rewind_trap':
        return dist < 4;
      case 'replay':
        return threatened || dist < 3;
      case 'time_slip':
        return threatened;
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
    const hasHeavy =
      this.has('power_shot') >= 0 || this.has('knockout') >= 0 || this.has('charged_shot') >= 0 || this.has('directors_cut') >= 0 || this.has('bank_shot') >= 0;
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
        if (b.pressure > 0 && dist > f.stats.preferredRange + 2.2 && !b.holdRange) s += 5 * b.pressure;
        // BOSS FIGHT: the champion steps back out to his firing distance instead of brawling
        if (b.holdRange && dist < b.holdRange * 0.55) s += 4.5;
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
      case 'directors_cut': {
        // the champion's long-range answer: three lines from a comfortable distance, never point-blank
        const t = this.m.abilities.cutTuning();
        if (f.cutCd > 0) s = -10;
        else {
          const reach = t.length[0];
          s = dist < reach * 0.85 ? 6.5 : dist < reach ? 3.5 : -4;
          if (dist < 2.4) s -= 3;
          if (dist > 7) s += 1.5;
          if (foeDisabled) s += 2.5;
          if (foe.invuln > 0) s -= 6;
          if (foe.shield > 0) s -= 5;
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
      case 'bank_shot': {
        // the ricochet needs a clean bounce point and a target that is not hiding behind a shield
        const sol = m.combat.bankAim(f, bankScore);
        s = sol.bounce ? 5.5 : 2;
        if (dist < 2.2) s -= 2;
        if (foeDisabled) s += 4;
        if (foe.shield > 0) s -= 4;
        if (foe.invuln > 0) s -= 6;
        if (combo) s += 4;
        if (foe.hp < 600) s += 1.5;
        break;
      }
      case 'false_start':
        // mostly a reaction card (see the reaction step); proactively only under fire
        s = 1;
        if (threatened && dist < foe.stats.attack.range) s += 3.5;
        if (foe.fireTimer < 0.25 && dist < foe.stats.attack.range * 0.9) s += 2;
        if (f.feint > 0) s = -10;
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

      // ------------------------------------------------ Alpha 1.6 — CARD REVOLUTION
      case 'spotlight_tag': {
        const payoff = ['power_shot', 'bank_shot', 'charged_shot', 'knockout', 'rebound_disc', 'prop_drop'].some((c) => this.has(c as CardId) >= 0);
        s = payoff ? 5 : 1;
        if (hand.energy >= 6) s += 1;
        if (foe.tag > 0 || foe.invuln > 0 || m.inOwnSmoke(foe)) s = -10;
        break;
      }
      case 'split_shot':
        s = dist < 3.5 ? 6.5 : dist < 6 ? 4.5 : 1.5;
        if (foeBlocking) s -= 5;
        if (foeDisabled) s += 1.5;
        if (combo) s += 3;
        break;
      case 'rebound_disc':
        s = dist > 2.5 && dist < 7.5 ? 5 : 2.5;
        if (foeDisabled || foe.netSlow < 1 || foe.tether > 0) s += 2;
        if (foe.shield > 0) s -= 4;
        if (combo) s += 4;
        break;
      case 'prop_drop':
        s = 4;
        if (foeDisabled || foe.netSlow < 1 || foe.tether > 0) s += 3.5;
        if (foe.shield > 0) s -= 3;
        if (combo) s += 3;
        break;
      case 'pulse_push':
        s = dist < 2.6 ? 6 : dist < CARD_TUNING.pulse_push.range ? 3.5 : -10;
        if (b.pressure > 0) s -= 3;
        if (f.stats.preferredRange > dist + 1.5) s += 1.5;
        if (combo) s += 3;
        break;
      case 'gravity_net':
        s = 4;
        if (dist > f.stats.preferredRange + 1) s += 1;
        if (['prop_drop', 'pressure_mine', 'split_shot', 'rebound_disc'].some((c) => this.has(c as CardId) >= 0)) s += 1.5;
        if (foe.netSlow < 1 || m.objects.own(this.side, 'net')) s = -8;
        if (combo) s += 3;
        break;
      case 'pressure_mine': {
        const own = m.objects.list.filter((o) => o.kind === 'mine' && o.owner === this.side).length;
        s = 4.2;
        if (foe.netSlow < 1) s += 1.5;
        if (b.pressure <= 0 && dist < f.stats.preferredRange) s += 1;
        if (own >= CARD_TUNING.pressure_mine.max) s -= 6;
        if (combo) s += 3;
        break;
      }
      case 'stage_barrier':
        s = 1.5;
        if (threatened) s += 4;
        if (foe.stats.attack.range > f.stats.attack.range && dist > 4) s += 2;
        if (f.hpFrac < 0.5) s += 1.5;
        if (dist < 2.2) s -= 3;
        if (m.objects.own(this.side, 'barrier')) s = -10;
        break;
      case 'cable_snare':
        s = 4;
        if (dist > f.stats.preferredRange + 1.5) s += 2;
        if (foe.shield > 0) s -= 4;
        if (dist > CARD_TUNING.cable_snare.range - 0.5) s -= 6;
        if (foe.tether > 0 || foe.tetherCd > 0) s = -10;
        break;
      case 'holo_decoy':
        s = 1.5;
        if (threatened) s += 3.5;
        if (f.hpFrac < 0.6) s += 1.5;
        if (dist < foe.stats.attack.range) s += 1;
        if (m.decoys.some((d) => d.alive && d.owner === this.side && d.kind === 'holo')) s = -10;
        break;
      case 'frame_catch':
        // mostly a reaction (see the reaction step)
        s = 1;
        if (foe.fireTimer < 0.3 && dist < foe.stats.attack.range) s += 2.5;
        if (this.projectileThreat(f)) s += 4;
        if (f.frame > 0) s = -10;
        break;
      case 'backtrack': {
        s = 0.5;
        if (dist < 1.8 && b.pressure <= 0) s += 3;
        if (f.tether > 0) s += 3;
        const under = m.objects.list.some((o) => o.owner !== this.side && ((o.kind === 'prop' && o.stage === 'warn') || o.kind === 'net') && Math.hypot(o.x - f.x, o.z - f.z) < o.radius);
        if (under) s += 4.5;
        if (combo) s += 3;
        break;
      }
      case 'high_stakes': {
        const t = CARD_TUNING.high_stakes;
        const big = hand.hand.some((c) => c && c !== 'high_stakes' && CARDS[c].cost >= 4);
        s = hand.energy <= 5 && big ? 5 : 1;
        if (hand.energy > 7) s = -6;
        if (f.stakesCd > 0 || f.stakesUses >= t.uses || f.hp - f.maxHp * t.hpCost < f.maxHp * t.minHp) s = -10;
        if (f.hpFrac < 0.5) s -= 2;
        break;
      }
      case 'second_take':
        // a replay of the last card attack: worth it while the target is open
        s = 5;
        if (foeDisabled || foe.netSlow < 1 || foe.tether > 0) s += 1.5;
        if (foe.shield > 0 || foe.invuln > 0) s -= 4;
        if (combo) s += 3;
        if (!m.takeReady(f) || m.objects.own(this.side, 'echo')) s = -10;
        break;
      case 'freeze_frame': {
        s = 1.5;
        if (threatened) s += 3;
        let incoming = 0;
        for (const p of m.projectiles) if (p.alive && p.owner !== this.side && Math.hypot(p.x - f.x, p.z - f.z) < 6) incoming++;
        if (incoming >= 3) s += 2.5;
        if (f.hpFrac < 0.5) s += 1;
        if (m.objects.own(this.side, 'freeze')) s = -10;
        break;
      }
    }
    return s;
  }
}
