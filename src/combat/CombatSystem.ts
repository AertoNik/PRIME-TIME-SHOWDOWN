import { ARENA, BROADCAST, CARD_TUNING, COMBO_TUNING, MATCH, PASSIVE_TUNING } from '../config/balance';
import type { ComboId, Side, WeaponType } from '../config/types';
import { clamp, clampRoundedRect, dampAngle, segSegDist, segmentCircleHit, wrapAngle, type ClampResult } from '../core/math';
import type { FighterSim } from './FighterSim';
import type { Match } from './Match';
import type { HitInfo, HitKind, Projectile, ProjectileKind, StageObject } from './types';

const tmpClamp: ClampResult = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };
const bankTmp = { dirX: 0, dirZ: 1, bx: 0, bz: 0, bounce: false, len1: 0, len2: 0 };
const aimTmp = { x: 0, z: 0 };

export interface SpawnOpts {
  homing?: number;
  falloff?: number;
  knockback?: number;
  stun?: number;
  slowAmount?: number;
  slowDuration?: number;
  heavy?: boolean;
  crit?: boolean;
  electric?: boolean;
  combo?: Projectile['combo'];
  pierce?: number;
  /** BANK SHOT: reflections off the barrier. */
  bounces?: number;
  /** Alpha 1.6: combo multiplier already in the damage (SPOTLIGHT TAG never stacks on it). */
  boost?: number;
  /** Alpha 1.6 BLINDSIDE: the target's fighter does not sidestep it. */
  blind?: boolean;
  /** Alpha 1.6 CROSS ANGLE: passes the owner's own STAGE BARRIER. */
  ownPass?: boolean;
}

/**
 * Alpha 1.5 — attacks a FALSE START can read (instant SHOCK / OVERLOAD, poison ticks, slams and shockwaves cannot).
 * Alpha 1.6: the new card shots are shots too; PROP DROP and PRESSURE MINE are areas, not attacks to read.
 */
const FEINTABLE = new Set<HitInfo['kind']>(['auto', 'power', 'adrenaline', 'knockout', 'cut', 'bank', 'counter', 'split', 'disc', 'cable', 'cam', 'release']);
/** Alpha 1.6 — card hits a SPOTLIGHT TAG boosts. */
const TAG_KINDS = new Set<HitKind>(['power', 'bank', 'knockout', 'disc', 'prop', 'cam']);
/** Alpha 1.6 — regular fire a HOLO DECOY soaks (card shots and charged attacks go through the hologram). */
const HOLO_SOAK = new Set<ProjectileKind>(['auto', 'pellet', 'bolt', 'rail', 'slug', 'adrenaline', 'counter', 'split', 'release']);
/** Alpha 1.6 — what a FRAME CATCH can stop (not CHARGED SHOT, not Zoe's SHOCK bolt). */
const CATCHABLE = new Set<ProjectileKind>(['auto', 'pellet', 'bolt', 'rail', 'slug', 'power', 'adrenaline', 'bank', 'counter', 'split', 'disc', 'cable', 'cam', 'release']);
const HIT_KIND: Record<ProjectileKind, HitKind> = {
  auto: 'auto',
  pellet: 'auto',
  bolt: 'auto',
  rail: 'auto',
  slug: 'auto',
  power: 'power',
  adrenaline: 'adrenaline',
  bank: 'bank',
  counter: 'counter',
  zap: 'shock',
  split: 'split',
  disc: 'disc',
  cable: 'cable',
  cam: 'cam',
  release: 'release',
};

/** Alpha 1.5 — a BANK SHOT solution: first leg direction, the bounce point and both leg lengths. */
export interface BankSolution {
  dirX: number;
  dirZ: number;
  /** Bounce point on the barrier (null = no clean bounce: fired straight at the target). */
  bx: number;
  bz: number;
  bounce: boolean;
  len1: number;
  len2: number;
}

/**
 * Mirror-shot geometry: reflect the target across each straight barrier wall and aim at
 * the image. The bounce point must sit on the straight part of that wall (corners are
 * rounded, a reflection there would not be clean). Picks the shortest valid path.
 */
export function solveBank(sx: number, sz: number, tx: number, tz: number, out: BankSolution): BankSolution {
  const W = ARENA.wallX;
  const Z = ARENA.wallZ;
  const m = CARD_TUNING.bank_shot.wallMargin;
  const straightZ = Z - ARENA.wallCorner - m; // half length of the straight part of the side walls
  const straightX = W - ARENA.wallCorner - m;
  let best = Infinity;
  out.bounce = false;
  const walls: [number, number, number][] = [
    // [axis (0 = x wall, 1 = z wall), wall coordinate, -]
    [0, W, 0],
    [0, -W, 0],
    [1, Z, 0],
    [1, -Z, 0],
  ];
  for (const [axis, c] of walls) {
    let ix: number;
    let iz: number;
    if (axis === 0) {
      ix = 2 * c - tx;
      iz = tz;
      const den = ix - sx;
      if (Math.abs(den) < 1e-4) continue;
      const k = (c - sx) / den;
      if (k <= 0.05 || k >= 1) continue;
      const pz = sz + (iz - sz) * k;
      if (Math.abs(pz) > straightZ) continue;
      const l1 = Math.hypot(c - sx, pz - sz);
      const l2 = Math.hypot(tx - c, tz - pz);
      if (l1 + l2 < best) {
        best = l1 + l2;
        out.bx = c;
        out.bz = pz;
        out.len1 = l1;
        out.len2 = l2;
        out.bounce = true;
      }
    } else {
      ix = tx;
      iz = 2 * c - tz;
      const den = iz - sz;
      if (Math.abs(den) < 1e-4) continue;
      const k = (c - sz) / den;
      if (k <= 0.05 || k >= 1) continue;
      const px = sx + (ix - sx) * k;
      if (Math.abs(px) > straightX) continue;
      const l1 = Math.hypot(px - sx, c - sz);
      const l2 = Math.hypot(tx - px, tz - c);
      if (l1 + l2 < best) {
        best = l1 + l2;
        out.bx = px;
        out.bz = c;
        out.len1 = l1;
        out.len2 = l2;
        out.bounce = true;
      }
    }
  }
  if (out.bounce) {
    const dx = out.bx - sx;
    const dz = out.bz - sz;
    const d = Math.hypot(dx, dz) || 1;
    out.dirX = dx / d;
    out.dirZ = dz / d;
  } else {
    const dx = tx - sx;
    const dz = tz - sz;
    const d = Math.hypot(dx, dz) || 1;
    out.dirX = dx / d;
    out.dirZ = dz / d;
    out.bx = tx;
    out.bz = tz;
    out.len1 = d;
    out.len2 = 0;
  }
  return out;
}

/** Muzzle offsets in fighter-local space (x = right, z = forward). */
export function muzzleOffset(weapon: WeaponType, muzzle: number): { right: number; fwd: number } {
  switch (weapon) {
    case 'twin_blasters':
      return { right: muzzle === 0 ? 0.36 : -0.36, fwd: 0.85 };
    case 'boom_cannon':
      return { right: 0.32, fwd: 1.15 };
    case 'tech_carbine':
      return { right: 0.2, fwd: 1.05 };
    case 'pulse_rifle':
      return { right: 0.2, fwd: 1.32 };
    case 'breaker':
      // the long rifle in its chest-level hold: just behind the crown muzzle of the model
      return { right: 0.3, fwd: 1.55 };
    case 'ricochet':
      // Alpha 1.5: Kai's long-barrelled trick pistol, held out in the right hand
      return { right: 0.34, fwd: 1.12 };
    case 'stinger':
      // Alpha 1.5: Rina's compact twin-barrel blaster, held close
      return { right: 0.3, fwd: 0.82 };
  }
}

export function inArenaWall(x: number, z: number): boolean {
  clampRoundedRect(x, z, ARENA.wallX, ARENA.wallZ, ARENA.wallCorner, tmpClamp);
  return !tmpClamp.hit;
}

/** How far a straight line from (x, z) runs before it meets the barrier (capped at `length`). */
export function lineReach(x: number, z: number, dirX: number, dirZ: number, length: number): number {
  for (let d = 0.5; d < length; d += 0.25) {
    if (!inArenaWall(x + dirX * d, z + dirZ * d)) return d;
  }
  return length;
}

/** Movement, auto-fire, projectiles and damage resolution. */
export class CombatSystem {
  private m: Match;
  private pool: Projectile[] = [];
  private nextId = 1;

  constructor(m: Match) {
    this.m = m;
  }

  // ------------------------------------------------------------------ timers
  tickStatuses(f: FighterSim, dt: number): void {
    if (f.stun > 0 || f.glitch > 0) f.ctrlEnd = this.m.time;
    if (f.zap > 0) this.tickZap(f, dt);
    if (f.stun > 0) f.stun = Math.max(0, f.stun - dt);
    if (f.cutCd > 0) f.cutCd = Math.max(0, f.cutCd - dt);
    if (f.shield > 0) {
      f.shield -= dt;
      if (f.shield <= 0) {
        f.shield = 0;
        f.shieldHp = 0;
        if (f.side === 0 && f.shieldAbsorbed <= 0 && this.m.phase === 'fight') this.m.broadcast.add(BROADCAST.wasted, 'ВХОЛОСТУЮ');
      }
    }
    if (f.overdrive > 0) f.overdrive = Math.max(0, f.overdrive - dt);
    if (f.slow > 0) f.slow = Math.max(0, f.slow - dt);
    if (f.momentum > 0) f.momentum = Math.max(0, f.momentum - dt);
    if (f.momentumCd > 0) f.momentumCd -= dt;
    if (f.ironSkin > 0) f.ironSkin = Math.max(0, f.ironSkin - dt);
    if (f.ironSkinCd > 0) f.ironSkinCd -= dt;
    if (f.overclock > 0) f.overclock = Math.max(0, f.overclock - dt);
    if (f.invuln > 0) f.invuln = Math.max(0, f.invuln - dt);
    if (f.riposteCd > 0) f.riposteCd = Math.max(0, f.riposteCd - dt);
    if (f.feint > 0) {
      f.feint -= dt;
      if (f.feint <= 0) {
        // the read window closed with nothing to read: a wasted feint
        f.feint = 0;
        this.m.emit({ type: 'feintEnd', side: f.side });
        if (f.side === 0 && this.m.phase === 'fight') this.m.broadcast.add(BROADCAST.wasted, 'ВХОЛОСТУЮ');
      }
    }
    if (f.counterT > 0) {
      f.counterT -= dt;
      if (f.counterT <= 0) f.counterShots = 0;
    }
    // Alpha 1.6 timers
    if (f.tag > 0) {
      f.tag = Math.max(0, f.tag - dt);
      // the fighter's own smoke hides them from the spotlight
      if (f.tag > 0 && this.m.inOwnSmoke(f)) f.tag = 0;
      if (f.tag <= 0) this.m.emit({ type: 'tagEnd', side: f.side });
    }
    if (f.tether > 0) {
      f.tether -= dt;
      if (f.tether <= 0) this.releaseTether(f, false);
    }
    if (f.tetherCd > 0) f.tetherCd = Math.max(0, f.tetherCd - dt);
    // Alpha 1.6: holds are never endless — after `holdMax` s of nets / cables in a row the fighter
    // breaks free and shrugs them off for `holdImmune` s (the heat cools while free)
    const hr = CARD_TUNING.hold;
    if (f.holdImmune > 0) f.holdImmune = Math.max(0, f.holdImmune - dt);
    else if (f.netSlow < 1 || f.tether > 0) {
      f.holdHeat += dt;
      if (f.holdHeat >= hr.holdMax) {
        f.holdHeat = 0;
        f.holdImmune = hr.immune;
        f.netSlow = 1;
        if (f.tether > 0) this.releaseTether(f, true);
        this.m.emit({ type: 'breakFree', side: f.side, x: f.x, z: f.z });
      }
    } else f.holdHeat = Math.max(0, f.holdHeat - dt * hr.cool);
    if (f.frame > 0) f.frame = Math.max(0, f.frame - dt);
    if (f.caught > 0) f.caught = Math.max(0, f.caught - dt);
    if (f.stakesCd > 0) f.stakesCd = Math.max(0, f.stakesCd - dt);
    if (f.knockback > 0) f.knockback = Math.max(0, f.knockback - dt);
    if (f.glitch > 0) {
      f.glitch = Math.max(0, f.glitch - dt);
      f.glitchDot -= dt;
      if (f.glitchDot <= 0 && f.glitch > 0 && !f.ko) {
        f.glitchDot = CARD_TUNING.system_overload.dotInterval;
        const src = this.m.fighters[1 - f.side];
        this.applyHit(f, src, {
          damage: CARD_TUNING.system_overload.dot * src.dmgMult,
          kind: 'dot',
          heavy: false,
          crit: false,
          electric: true,
          combo: null,
          knockback: 0,
          stun: 0,
          slowAmount: 0,
          slowDuration: 0,
          dx: 0,
          dz: 0,
          sure: true,
          projectile: null,
        });
      }
    }
  }

  // ---------------------------------------------------------------- movement
  updateFighter(f: FighterSim, dt: number): void {
    const m = this.m;
    const foe = m.fighters[1 - f.side];
    this.tickStatuses(f, dt);

    if (f.ko || m.phase !== 'fight') {
      f.vx *= Math.exp(-8 * dt);
      f.vz *= Math.exp(-8 * dt);
      if (f.knockback > 0) {
        f.vx = f.kbX;
        f.vz = f.kbZ;
        f.kbX *= Math.exp(-5 * dt);
        f.kbZ *= Math.exp(-5 * dt);
      }
      this.integrate(f, dt);
      if (!f.ko && m.phase !== 'fight') {
        f.facing = dampAngle(f.facing, Math.atan2(foe.x - f.x, foe.z - f.z), 6, dt);
      }
      return;
    }

    this.updateAction(f, foe, dt);

    let tvx = 0;
    let tvz = 0;
    let accel = 32;
    const a = f.action;
    // Alpha 1.6: a CABLE SNARE snaps on any real move away (DASH, FALSE START, BACKTRACK, a charge, a knockback)
    if (f.tether > 0 && (a.kind === 'dash' || a.kind === 'feint' || a.kind === 'rewind' || a.kind === 'rush' || f.knockback > 0)) this.releaseTether(f, true);
    if (a.kind === 'dash' || a.kind === 'rush' || a.kind === 'feint' || a.kind === 'rewind') {
      tvx = a.dirX * a.speed;
      tvz = a.dirZ * a.speed;
      accel = a.kind === 'feint' ? 120 : 400;
    } else if (f.knockback > 0) {
      tvx = f.kbX;
      tvz = f.kbZ;
      f.kbX *= Math.exp(-5 * dt);
      f.kbZ *= Math.exp(-5 * dt);
      accel = 400;
    } else if (f.stun > 0 || a.kind === 'recover') {
      accel = 18;
    } else {
      const sp = f.stats.moveSpeed * f.speedMult() * clamp(f.intentSpeed, 0, 1);
      tvx = f.intentX * sp;
      tvz = f.intentZ * sp;
    }
    const dvx = tvx - f.vx;
    const dvz = tvz - f.vz;
    const dv = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    // Alpha 1.6 BACKTRACK: an exact glide back along the tape (lands where it started from)
    if (a.kind === 'rewind' || dv <= maxDv || dv < 1e-6) {
      f.vx = tvx;
      f.vz = tvz;
    } else {
      f.vx += (dvx / dv) * maxDv;
      f.vz += (dvz / dv) * maxDv;
    }
    this.integrate(f, dt);
    if (f.tether > 0) this.holdTether(f);

    // Aim / facing (model turns toward its aim point).
    const desired = a.kind === 'cut' ? Math.atan2(a.dirX, a.dirZ) : Math.atan2(f.aimX - f.x, f.aimZ - f.z);
    if (a.kind === 'rush' || a.kind === 'dash' || a.kind === 'rewind') {
      // Keep facing; view handles the dash pose.
    } else if (f.stun <= 0) {
      f.facing = dampAngle(f.facing, desired, a.kind === 'windup' ? 10 : a.kind === 'cut' ? 12 : 15, dt);
    }

    this.autoFire(f, foe, dt);
  }

  private integrate(f: FighterSim, dt: number): void {
    // Alpha 1.6: a PULSE PUSH / mine blast slides the fighter on top of its own movement
    const sh = f.shoveX !== 0 || f.shoveZ !== 0;
    const nx = f.x + (f.vx + f.shoveX) * dt;
    const nz = f.z + (f.vz + f.shoveZ) * dt;
    clampRoundedRect(nx, nz, ARENA.halfX, ARENA.halfZ, ARENA.cornerRadius, tmpClamp);
    f.x = tmpClamp.x;
    f.z = tmpClamp.z;
    if (sh) {
      // the push dies at the barrier (never a wall slam) and fades out
      if (tmpClamp.hit) {
        const sin = f.shoveX * tmpClamp.nx + f.shoveZ * tmpClamp.nz;
        if (sin > 0) {
          f.shoveX -= sin * tmpClamp.nx;
          f.shoveZ -= sin * tmpClamp.nz;
        }
      }
      const k = Math.exp(-CARD_TUNING.pulse_push.decay * dt);
      f.shoveX *= k;
      f.shoveZ *= k;
      if (f.shoveX * f.shoveX + f.shoveZ * f.shoveZ < 0.01) f.shoveX = f.shoveZ = 0;
    }
    if (tmpClamp.hit) {
      const speed = Math.hypot(f.vx, f.vz);
      const into = f.vx * tmpClamp.nx + f.vz * tmpClamp.nz;
      if (f.knockback > 0 && into > 5.5) {
        this.wallSlam(f, speed, tmpClamp.nx, tmpClamp.nz);
      }
      // remove velocity component into the wall
      if (into > 0) {
        f.vx -= into * tmpClamp.nx;
        f.vz -= into * tmpClamp.nz;
        if (f.knockback > 0) {
          f.kbX = f.vx * 0.3;
          f.kbZ = f.vz * 0.3;
        }
      }
    }
  }

  private wallSlam(f: FighterSim, speed: number, nx: number, nz: number): void {
    const m = this.m;
    const src = m.fighters[1 - f.side];
    m.emit({ type: 'wallSlam', side: f.side, x: f.x, z: f.z, nx, nz });
    const k = CARD_TUNING.knockout;
    const dmg = Math.min(k.wallSlamDamage, 60 + speed * 13) * src.dmgMult;
    f.knockback = 0;
    f.kbX = f.kbZ = 0;
    this.applyHit(f, src, {
      damage: dmg,
      kind: 'slam',
      heavy: true,
      crit: false,
      electric: false,
      combo: null,
      knockback: 0,
      stun: k.wallSlamStun,
      slowAmount: 0,
      slowDuration: 0,
      dx: nx,
      dz: nz,
      sure: true,
      projectile: null,
    });
  }

  separate(): void {
    const [a, b] = this.m.fighters;
    if (a.ko || b.ko) return;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    const min = a.radius + b.radius;
    if (d < min && d > 1e-4) {
      const push = (min - d) / 2;
      const ux = dx / d;
      const uz = dz / d;
      a.x -= ux * push;
      a.z -= uz * push;
      b.x += ux * push;
      b.z += uz * push;
    }
  }

  // ------------------------------------------------------------------ action
  private updateAction(f: FighterSim, foe: FighterSim, dt: number): void {
    const m = this.m;
    const a = f.action;
    switch (a.kind) {
      case 'windup': {
        a.t += dt;
        if (!a.locked) {
          if (a.card === 'bank_shot') {
            // BANK SHOT aims at the bounce point (re-solved as both fighters move)
            this.bankAim(f, bankTmp, a.combo === 'spotlight' ? COMBO_TUNING.spotlightLead : 0.85);
            a.dirX = bankTmp.dirX;
            a.dirZ = bankTmp.dirZ;
          } else {
            // Alpha 1.6: charged attacks aim at the real fighter (a HOLO DECOY only fools regular fire)
            this.windupAim(f, a.card, a.combo, aimTmp);
            const dx = aimTmp.x - f.x;
            const dz = aimTmp.z - f.z;
            const d = Math.hypot(dx, dz) || 1;
            a.dirX = dx / d;
            a.dirZ = dz / d;
          }
          if (a.telegraph && a.t >= a.total * a.lockAt) {
            a.locked = true;
            a.lockedAt = m.time;
            m.emit({ type: 'aimLock', side: f.side, dx: a.dirX, dz: a.dirZ });
          }
        }
        if (a.t >= a.total) m.abilities.release(f, a);
        break;
      }
      case 'dash':
      case 'feint':
      case 'rewind':
        a.t += dt;
        if (a.t >= a.total) {
          f.action = { kind: 'none' };
          // Alpha 1.6 BACKTRACK ends on the spot (no slide past the point it rewound to)
          if (a.kind === 'rewind') f.vx = f.vz = 0;
          // Alpha 1.6 CATCH & RELEASE: the caught shot goes back once the DASH lands
          if (a.kind === 'dash' && f.releaseDmg > 0) this.fireRelease(f, foe);
        }
        break;
      case 'rush':
        a.t += dt;
        m.abilities.updateRush(f, foe, a);
        break;
      case 'recover':
        a.t += dt;
        if (a.t >= a.total) f.action = { kind: 'none' };
        break;
      case 'cut':
        m.abilities.updateCut(f, foe, a, dt);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- shooting
  private autoFire(f: FighterSim, foe: FighterSim, dt: number): void {
    f.fireTimer -= dt;
    const canShoot = f.stun <= 0 && f.knockback <= 0 && f.action.kind === 'none' && !foe.ko;
    if (f.adrenaline > 0) {
      f.adrenaline -= dt;
      f.adrenalineTimer -= dt;
      if (canShoot && f.adrenalineTimer <= 0 && f.adrenalineShots > 0) {
        const t = CARD_TUNING.adrenaline;
        f.adrenalineTimer = (t.duration / t.shots) * 0.92;
        f.adrenalineShots--;
        this.fireAdrenaline(f, foe);
      }
      if (f.adrenalineShots <= 0 || f.adrenaline <= 0) {
        f.adrenaline = 0;
        f.adrenalineShots = 0;
        f.fireTimer = Math.max(f.fireTimer, 0.25);
      }
      return;
    }
    // Burst weapons finish their burst (re-aiming each shot) unless interrupted.
    if (f.burstLeft > 0) {
      if (!canShoot) {
        f.burstLeft = 0;
      } else {
        f.burstTimer -= dt;
        if (f.burstTimer <= 0) {
          f.burstLeft--;
          f.burstTimer = f.stats.attack.burst!.gap / Math.sqrt(f.fireRateMult());
          this.fireAuto(f);
        }
      }
    }
    if (canShoot && f.wantFire && f.fireTimer <= 0 && f.burstLeft <= 0) {
      this.fireAuto(f);
      const atk = f.stats.attack;
      if (atk.burst) {
        f.burstLeft = atk.burst.count - 1;
        f.burstTimer = atk.burst.gap / Math.sqrt(f.fireRateMult());
      }
      f.fireTimer = atk.interval / f.fireRateMult();
    }
  }

  private muzzleWorld(f: FighterSim, muzzle: number, yaw: number): { x: number; z: number } {
    const off = muzzleOffset(f.stats.attack.weapon, muzzle);
    // fighter right vector for yaw θ is (-cosθ, sinθ); forward is (sinθ, cosθ)
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    return {
      x: f.x + s * off.fwd - c * off.right,
      z: f.z + c * off.fwd + s * off.right,
    };
  }

  fireAuto(f: FighterSim): void {
    const atk = f.stats.attack;
    const yaw = Math.atan2(f.aimX - f.x, f.aimZ - f.z) + f.aimErr;
    const rng = this.m.rng;
    let muzzle = 0;
    if (atk.alternate) {
      f.muzzleToggle ^= 1;
      muzzle = f.muzzleToggle;
    }
    const origin = this.muzzleWorld(f, muzzle, yaw);
    // DASH counter: the next volley (whole burst for the carbine) hits harder.
    const startsVolley = f.burstLeft <= 0;
    let counter = f.counterShots > 0 && f.counterT > 0;
    if (counter && startsVolley) f.counterShots--;
    if (!startsVolley) counter = f.burstCounter;
    f.burstCounter = counter;
    // DEADEYE (Vega): every Nth shot is a marksman shot.
    let deadeye = false;
    if (f.def.passive === 'deadeye' && startsVolley) {
      f.shotCount++;
      deadeye = f.shotCount % PASSIVE_TUNING.deadeye.every === 0;
    }
    // Alpha 1.5 — CROSSFIRE (Kai): shots fired while strafing across the line of fire hit harder
    let cross = false;
    if (f.def.passive === 'crossfire') {
      const lat = Math.abs(f.vx * Math.cos(yaw) - f.vz * Math.sin(yaw));
      cross = lat >= f.stats.moveSpeed * PASSIVE_TUNING.crossfire.lateral;
    }
    // Alpha 1.5 — RIPOSTE (Rina): the volley after an evade hits harder (the whole double tap)
    let riposte = false;
    if (f.def.passive === 'riposte') {
      if (startsVolley) {
        riposte = f.riposte;
        f.riposte = false;
        f.burstRiposte = riposte;
      } else riposte = f.burstRiposte;
    }
    const dmg =
      atk.damage *
      f.outgoingDamageMult() *
      (counter ? CARD_TUNING.dash.counterMult : 1) *
      (deadeye ? PASSIVE_TUNING.deadeye.mult : 1) *
      (cross ? PASSIVE_TUNING.crossfire.mult : 1) *
      (riposte ? PASSIVE_TUNING.riposte.mult : 1);
    const kind: ProjectileKind =
      atk.weapon === 'boom_cannon'
        ? 'pellet'
        : atk.weapon === 'tech_carbine'
          ? 'bolt'
          : atk.weapon === 'pulse_rifle'
            ? 'rail'
            : atk.weapon === 'breaker'
              ? 'slug'
              : 'auto';
    const n = atk.projectiles;
    for (let i = 0; i < n; i++) {
      const fan = n > 1 ? -atk.spread / 2 + (atk.spread * i) / (n - 1) : 0;
      const y = yaw + fan + rng.range(-atk.inaccuracy, atk.inaccuracy);
      this.spawn(f.side, kind, atk.weapon, origin.x, origin.z, y, atk.speed * rng.range(0.95, 1.05), dmg, atk.radius, atk.range, {
        homing: atk.homing,
        falloff: atk.falloff,
        slowAmount: atk.slow?.amount ?? 0,
        slowDuration: atk.slow?.duration ?? 0,
        crit: counter || deadeye || riposte,
      });
    }
    f.m.shots++;
    this.m.emit({ type: 'shot', side: f.side, weapon: atk.weapon, muzzle, x: origin.x, z: origin.z, dx: Math.sin(yaw), dz: Math.cos(yaw), kind });
  }

  private fireAdrenaline(f: FighterSim, foe: FighterSim): void {
    const atk = f.stats.attack;
    // Adrenaline shots use perfect lead.
    const t = CARD_TUNING.adrenaline;
    const dist = Math.hypot(foe.x - f.x, foe.z - f.z);
    const lead = dist / (atk.speed * 1.15);
    const tx = foe.x + foe.vx * lead;
    const tz = foe.z + foe.vz * lead;
    const yaw = Math.atan2(tx - f.x, tz - f.z);
    f.facing = yaw;
    f.muzzleToggle ^= 1;
    const muzzle = atk.alternate ? f.muzzleToggle : 0;
    const origin = this.muzzleWorld(f, muzzle, yaw);
    const dmg = t.damage * f.outgoingDamageMult() * f.adrenalineMult;
    this.spawn(f.side, 'adrenaline', atk.weapon, origin.x, origin.z, yaw, atk.speed * 1.15, dmg, atk.radius * 1.1, atk.range * 1.3, {});
    f.m.shots++;
    this.m.emit({ type: 'shot', side: f.side, weapon: atk.weapon, muzzle, x: origin.x, z: origin.z, dx: Math.sin(yaw), dz: Math.cos(yaw), kind: 'adrenaline' });
  }

  /** Heavy card shot: POWER SHOT by default, or CHARGED SHOT (faster, longer, pierces shields). */
  firePower(f: FighterSim, dirX: number, dirZ: number, damage: number, opts: SpawnOpts, charged = false): void {
    const yaw = Math.atan2(dirX, dirZ);
    f.facing = yaw;
    const origin = this.muzzleWorld(f, 0, yaw);
    const t = charged ? CARD_TUNING.charged_shot : CARD_TUNING.power_shot;
    this.spawn(f.side, 'power', f.stats.attack.weapon, origin.x, origin.z, yaw, t.speed, damage, t.radius, t.range, {
      knockback: t.knockback,
      heavy: true,
      ...(charged ? { falloff: CARD_TUNING.charged_shot.farMult, pierce: CARD_TUNING.charged_shot.pierce } : {}),
      ...opts,
    });
    this.m.emit({ type: 'shot', side: f.side, weapon: f.stats.attack.weapon, muzzle: 0, x: origin.x, z: origin.z, dx: dirX, dz: dirZ, kind: 'power' });
  }

  /** Alpha 1.5 — BANK SHOT: the copper ricochet round along the first leg of the bank path. */
  fireBank(f: FighterSim, dirX: number, dirZ: number, damage: number, opts: SpawnOpts): void {
    const yaw = Math.atan2(dirX, dirZ);
    f.facing = yaw;
    const origin = this.muzzleWorld(f, 0, yaw);
    const t = CARD_TUNING.bank_shot;
    this.spawn(f.side, 'bank', f.stats.attack.weapon, origin.x, origin.z, yaw, t.speed, damage, t.radius, t.range, {
      knockback: t.knockback,
      heavy: true,
      bounces: 1,
      ...opts,
    });
    this.m.emit({ type: 'shot', side: f.side, weapon: f.stats.attack.weapon, muzzle: 0, x: origin.x, z: origin.z, dx: dirX, dz: dirZ, kind: 'bank' });
  }

  /** Where Kai's BANK SHOT would go right now: aimed at where the target will be when the round arrives. */
  bankAim(f: FighterSim, out: BankSolution, lead = 0.85): BankSolution {
    const t = CARD_TUNING.bank_shot;
    // first guess at where the target stands, then lead it by the time the bank path takes
    solveBank(f.x, f.z, f.seenX, f.seenZ, out);
    const time = (out.len1 + out.len2) / t.speed;
    let tx = f.seenX + f.seenVX * time * lead;
    let tz = f.seenZ + f.seenVZ * time * lead;
    clampRoundedRect(tx, tz, ARENA.halfX, ARENA.halfZ, ARENA.cornerRadius, tmpClamp);
    tx = tmpClamp.x;
    tz = tmpClamp.z;
    return solveBank(f.x, f.z, tx, tz, out);
  }

  /**
   * Alpha 1.5.5 — Zoe's SHOCK charge. A stun, knockback or KO during the charge calls it off
   * (a real window to punish her); otherwise the bolt leaves with a partial lead and no
   * homing, so a DASH, a sidestep or a SHIELD answers it.
   */
  private tickZap(f: FighterSim, dt: number): void {
    const m = this.m;
    if (f.ko || f.stun > 0 || f.knockback > 0 || m.phase !== 'fight') {
      f.zap = 0;
      f.zapCombo = null;
      m.emit({ type: 'zapFizzle', side: f.side });
      return;
    }
    f.zap -= dt;
    if (f.zap > 0) return;
    f.zap = 0;
    const ctl = m.rival.mods?.control;
    const foe = m.fighters[1 - f.side];
    const t = CARD_TUNING.shock;
    const speed = ctl?.shockSpeed ?? 20;
    const lead = (Math.hypot(foe.x - f.x, foe.z - f.z) / speed) * (ctl?.shockLead ?? 0);
    const yaw = Math.atan2(foe.x + foe.vx * lead - f.x, foe.z + foe.vz * lead - f.z);
    f.facing = yaw;
    const origin = this.muzzleWorld(f, 0, yaw);
    this.spawn(f.side, 'zap', f.stats.attack.weapon, origin.x, origin.z, yaw, speed, t.damage * f.outgoingDamageMult(), ctl?.shockRadius ?? 0.32, 15, {
      stun: t.stun,
      electric: true,
      heavy: true,
      combo: f.zapCombo,
    });
    f.zapCombo = null;
    m.emit({ type: 'shot', side: f.side, weapon: f.stats.attack.weapon, muzzle: 0, x: origin.x, z: origin.z, dx: Math.sin(yaw), dz: Math.cos(yaw), kind: 'zap' });
  }

  /** Alpha 1.5 — FALSE START read an attack: Rina fires straight back at the attacker. */
  private fireCounter(f: FighterSim, foe: FighterSim): void {
    const t = CARD_TUNING.false_start;
    const dist = Math.hypot(foe.x - f.x, foe.z - f.z);
    const lead = dist / t.counterSpeed;
    const yaw = Math.atan2(foe.x + foe.vx * lead - f.x, foe.z + foe.vz * lead - f.z);
    f.facing = yaw;
    const origin = this.muzzleWorld(f, 0, yaw);
    this.spawn(f.side, 'counter', f.stats.attack.weapon, origin.x, origin.z, yaw, t.counterSpeed, t.counterDamage * f.feintMult * f.outgoingDamageMult(), t.counterRadius, t.counterRange, {
      crit: true,
    });
    f.m.shots++;
    f.fireTimer = Math.max(f.fireTimer, 0.25);
    this.m.emit({ type: 'shot', side: f.side, weapon: f.stats.attack.weapon, muzzle: 0, x: origin.x, z: origin.z, dx: Math.sin(yaw), dz: Math.cos(yaw), kind: 'counter' });
  }

  spawn(
    owner: Side,
    kind: ProjectileKind,
    weapon: WeaponType,
    x: number,
    z: number,
    yaw: number,
    speed: number,
    damage: number,
    radius: number,
    range: number,
    o: SpawnOpts,
  ): Projectile {
    const p = this.pool.pop() ?? ({} as Projectile);
    p.id = this.nextId++;
    p.owner = owner;
    p.kind = kind;
    p.weapon = weapon;
    p.x = p.px = x;
    p.z = p.pz = z;
    p.vx = Math.sin(yaw) * speed;
    p.vz = Math.cos(yaw) * speed;
    p.speed = speed;
    p.radius = radius;
    p.damage = damage;
    p.range = range;
    p.traveled = 0;
    p.homing = o.homing ?? 0;
    p.falloff = o.falloff ?? 1;
    p.knockback = o.knockback ?? 0;
    p.stun = o.stun ?? 0;
    p.slowAmount = o.slowAmount ?? 0;
    p.slowDuration = o.slowDuration ?? 0;
    p.heavy = o.heavy ?? false;
    p.crit = o.crit ?? false;
    p.electric = o.electric ?? false;
    p.combo = o.combo ?? null;
    p.alive = true;
    p.smokeRolled = false;
    p.passThrough = false;
    p.dodgeLogged = false;
    p.closest = 999;
    p.sidestepped = false;
    p.pierce = o.pierce ?? 0;
    p.bounces = o.bounces ?? 0;
    p.bounced = false;
    p.boost = o.boost ?? 1;
    p.blind = o.blind ?? false;
    p.ownPass = o.ownPass ?? false;
    p.ret = false;
    p.mask = 0;
    p.life = 0;
    this.m.projectiles.push(p);
    return p;
  }

  // ------------------------------------------------- Alpha 1.6 — card shots
  /**
   * Where a charged attack / card shot goes: the real fighter as this fighter's brain sees
   * it (smoke and SMOKE→DASH phantoms still fool it, a HOLO DECOY does not), led by its
   * flight time. SPOTLIGHT combos lead fully and without aim error.
   */
  leadAim(f: FighterSim, speed: number, k: number, out: { x: number; z: number }): { x: number; z: number } {
    const dist = Math.hypot(f.seenX - f.x, f.seenZ - f.z);
    const time = (dist / Math.max(1, speed)) * k;
    out.x = f.seenX + f.seenVX * time;
    out.z = f.seenZ + f.seenVZ * time;
    return out;
  }

  windupAim(f: FighterSim, card: string, combo: ComboId | null, out: { x: number; z: number }): { x: number; z: number } {
    if (combo === 'spotlight') {
      const speed = card === 'charged_shot' ? CARD_TUNING.charged_shot.speed : CARD_TUNING.power_shot.speed;
      return this.leadAim(f, speed, COMBO_TUNING.spotlightLead, out);
    }
    out.x = f.cardAimX;
    out.z = f.cardAimZ;
    return out;
  }

  /** SPLIT SHOT: one wide volley of three bolts instead of the next regular one (the weapon's own burst is skipped). */
  fireSplit(f: FighterSim, tight: boolean): void {
    const t = CARD_TUNING.split_shot;
    const yaw = Math.atan2(f.cardAimX - f.x, f.cardAimZ - f.z);
    f.facing = yaw;
    const origin = this.muzzleWorld(f, 0, yaw);
    const fan = tight ? COMBO_TUNING.tightFan : t.fan;
    const dmg = t.damage * f.outgoingDamageMult();
    for (let i = 0; i < t.bolts; i++) {
      const y = yaw - fan / 2 + (fan * i) / (t.bolts - 1);
      this.spawn(f.side, 'split', f.stats.attack.weapon, origin.x, origin.z, y, t.speed, dmg, t.radius, t.range, { falloff: t.falloff, crit: tight });
    }
    f.burstLeft = 0;
    f.fireTimer = Math.max(f.fireTimer, f.stats.attack.interval / f.fireRateMult());
    f.m.shots++;
    this.m.emit({ type: 'shot', side: f.side, weapon: f.stats.attack.weapon, muzzle: 0, x: origin.x, z: origin.z, dx: Math.sin(yaw), dz: Math.cos(yaw), kind: 'split' });
  }

  /** REBOUND DISC: straight out to its turn point, then home to the thrower (BOOMERANG: turns right past the held target). */
  fireDisc(f: FighterSim, combo: ComboId | null): void {
    const t = CARD_TUNING.rebound_disc;
    const at = combo === 'spotlight' ? this.leadAim(f, t.speed, COMBO_TUNING.spotlightLead, aimTmp) : { x: f.cardAimX, z: f.cardAimZ };
    const yaw = Math.atan2(at.x - f.x, at.z - f.z);
    f.facing = yaw;
    let reach: number = t.reach;
    if (combo === 'boomerang') reach = clamp(Math.hypot(f.seenX - f.x, f.seenZ - f.z) + COMBO_TUNING.boomerangPast, t.minReach, t.reach);
    const origin = this.muzzleWorld(f, 0, yaw);
    this.spawn(f.side, 'disc', f.stats.attack.weapon, origin.x, origin.z, yaw, t.speed, t.damage * f.outgoingDamageMult(), t.radius, reach, { crit: combo !== null });
    f.fireTimer = Math.max(f.fireTimer, 0.3);
  }

  /** CABLE SNARE: the cable shot (the tether comes with a hit, see updateProjectiles). */
  fireCable(f: FighterSim): void {
    const t = CARD_TUNING.cable_snare;
    this.leadAim(f, t.speed, f.leadK, aimTmp);
    const yaw = Math.atan2(aimTmp.x - f.x, aimTmp.z - f.z);
    f.facing = yaw;
    const origin = this.muzzleWorld(f, 0, yaw);
    this.spawn(f.side, 'cable', f.stats.attack.weapon, origin.x, origin.z, yaw, t.speed, t.damage * f.outgoingDamageMult(), t.radius, t.range, {});
    f.fireTimer = Math.max(f.fireTimer, 0.25);
  }

  /** SIDE CAM: the one bolt along the camera's frozen line. */
  fireCam(f: FighterSim, o: StageObject): void {
    const t = CARD_TUNING.side_cam;
    const yaw = Math.atan2(o.dirX, o.dirZ);
    this.spawn(f.side, 'cam', f.stats.attack.weapon, o.x + o.dirX * 0.5, o.z + o.dirZ * 0.5, yaw, t.speed, t.damage * f.outgoingDamageMult(), t.radius, t.range, {
      heavy: true,
      blind: o.combo === 'blindside',
      ownPass: o.combo === 'cross_angle',
      crit: o.combo !== null,
    });
  }

  /** CATCH & RELEASE: the caught shot goes back at the opponent after the DASH. */
  private fireRelease(f: FighterSim, foe: FighterSim): void {
    const dmg = f.releaseDmg;
    f.releaseDmg = 0;
    if (foe.ko || this.m.phase !== 'fight') return;
    const speed = COMBO_TUNING.releaseSpeed;
    this.leadAim(f, speed, f.leadK, aimTmp);
    const yaw = Math.atan2(aimTmp.x - f.x, aimTmp.z - f.z);
    f.facing = yaw;
    const origin = this.muzzleWorld(f, 0, yaw);
    this.spawn(f.side, 'release', f.stats.attack.weapon, origin.x, origin.z, yaw, speed, dmg, 0.3, 12, { crit: true });
    f.m.shots++;
    this.m.emit({ type: 'shot', side: f.side, weapon: f.stats.attack.weapon, muzzle: 0, x: origin.x, z: origin.z, dx: Math.sin(yaw), dz: Math.cos(yaw), kind: 'release' });
  }

  /** Slide a fighter (PULSE PUSH, mine blast): not a knockback — no interrupt, no stun, no wall slam. */
  shove(f: FighterSim, ux: number, uz: number, force: number): void {
    if (f.ko || force <= 0) return;
    let k = 1;
    if (f.stats.armor > 0) k *= CARD_TUNING.pulse_push.heavyMult;
    if (f.side === 1 && this.m.boss) {
      // the champion barely moves and never during DIRECTOR'S CUT
      if (f.action.kind === 'cut') return;
      k *= CARD_TUNING.pulse_push.bossMult;
    }
    f.shoveX += ux * force * k;
    f.shoveZ += uz * force * k;
    // one push at a time: never faster than a single full push
    const l = Math.hypot(f.shoveX, f.shoveZ);
    const cap = Math.max(force * k, CARD_TUNING.pulse_push.force);
    if (l > cap) {
      f.shoveX *= cap / l;
      f.shoveZ *= cap / l;
    }
  }

  /**
   * PULSE PUSH: a short wave towards the opponent; only an opponent within reach slides.
   * STAGE PUSH: the wave leaves from the fighter's barrier. MINE DRIVE: it bends towards
   * the fighter's mine (never more than the set angle) and pushes a little harder.
   */
  pulsePush(f: FighterSim, foe: FighterSim, combo: ComboId | null): void {
    const m = this.m;
    const t = CARD_TUNING.pulse_push;
    let ox = f.x;
    let oz = f.z;
    let force: number = t.force;
    if (combo === 'wall_push') {
      const b = m.objects.own(f.side, 'barrier');
      if (b) {
        ox = b.x;
        oz = b.z;
        force *= COMBO_TUNING.wallPushForce;
      }
    }
    const dx = foe.x - ox;
    const dz = foe.z - oz;
    const d = Math.hypot(dx, dz) || 1;
    let ux = dx / d;
    let uz = dz / d;
    const inReach = !foe.ko && d <= t.range + foe.radius * 0.5;
    const hit = inReach && foe.invuln <= 0;
    m.emit({ type: 'push', side: f.side, x: ox, z: oz, dx: ux, dz: uz, range: t.range, hit });
    if (!hit) {
      if (inReach) {
        // dashed through the wave
        m.emit({ type: 'dodge', side: foe.side, x: foe.x, z: foe.z, perfect: false, heavy: false });
        this.onEvade(foe);
      }
      return;
    }
    if (combo === 'mine_drive') {
      const mine = m.objects.nearestMine(f.side, foe.x, foe.z);
      if (mine) {
        const mx = mine.x - foe.x;
        const mz = mine.z - foe.z;
        const ml = Math.hypot(mx, mz);
        if (ml > 0.05) {
          const want = Math.atan2(mx / ml, mz / ml);
          const cur = Math.atan2(ux, uz);
          const turn = clamp(wrapAngle(want - cur), -COMBO_TUNING.mineDriveAngle, COMBO_TUNING.mineDriveAngle);
          ux = Math.sin(cur + turn);
          uz = Math.cos(cur + turn);
        }
      }
      force *= COMBO_TUNING.mineDriveForce;
    }
    this.shove(foe, ux, uz, force);
    // the wave throws the aim off: the next regular shot comes a little later (cards are not touched)
    foe.fireTimer = Math.max(foe.fireTimer, 0) + t.aimDelay;
    foe.burstLeft = 0;
  }

  /** CABLE SNARE landed: hold the target near this spot (shorter and looser on the champion). */
  private tetherTo(target: FighterSim): void {
    if (target.ko || target.tether > 0 || target.tetherCd > 0 || target.holdImmune > 0) return;
    const t = CARD_TUNING.cable_snare;
    const boss = target.side === 1 && !!this.m.boss;
    target.tether = boss ? t.bossDuration : t.duration;
    target.tetherR = boss ? t.bossTether : t.tether;
    target.tetherX = target.x;
    target.tetherZ = target.z;
    this.m.emit({ type: 'tether', side: target.side, ax: target.x, az: target.z, radius: target.tetherR, duration: target.tether });
  }

  /** The cable lets go: ran out (broke = false) or snapped by a move. A short immunity follows. */
  releaseTether(f: FighterSim, broke: boolean): void {
    f.tether = 0;
    f.tetherCd = CARD_TUNING.cable_snare.immunity;
    this.m.emit({ type: 'tetherEnd', side: f.side, broke });
  }

  /** Keeps a tethered fighter within the cable's reach (a smooth limit, never a teleport). */
  private holdTether(f: FighterSim): void {
    const dx = f.x - f.tetherX;
    const dz = f.z - f.tetherZ;
    const d = Math.hypot(dx, dz);
    if (d <= f.tetherR) return;
    const ux = dx / d;
    const uz = dz / d;
    f.x = f.tetherX + ux * f.tetherR;
    f.z = f.tetherZ + uz * f.tetherR;
    const out = f.vx * ux + f.vz * uz;
    if (out > 0) {
      f.vx -= out * ux;
      f.vz -= out * uz;
    }
    const sout = f.shoveX * ux + f.shoveZ * uz;
    if (sout > 0) {
      f.shoveX -= sout * ux;
      f.shoveZ -= sout * uz;
    }
  }

  // ------------------------------------------------------------- projectiles
  updateProjectiles(dt: number): void {
    const m = this.m;
    const list = m.projectiles;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.alive) continue;
      p.px = p.x;
      p.pz = p.z;
      const foe = m.fighters[1 - p.owner];
      // Alpha 1.6 FREEZE FRAME: regular projectiles crawl inside a slow-motion zone (range is kept in metres)
      const sdt = dt * m.objects.freezeScale(p);

      if (p.kind === 'disc') {
        if (!this.steerDisc(p, sdt)) continue;
      } else if (p.homing > 0 && !foe.ko) {
        const desired = Math.atan2(foe.x - p.x, foe.z - p.z);
        const cur = Math.atan2(p.vx, p.vz);
        const diff = wrapAngle(desired - cur);
        if (Math.abs(diff) < 1.5) {
          const turn = clamp(diff, -p.homing * sdt, p.homing * sdt);
          const ny = cur + turn;
          p.vx = Math.sin(ny) * p.speed;
          p.vz = Math.cos(ny) * p.speed;
        }
      }

      p.x += p.vx * sdt;
      p.z += p.vz * sdt;
      p.traveled += p.speed * sdt;

      // Decoys soak hostile fire (Alpha 1.6: a HOLO DECOY only soaks regular fire, and a whole volley)
      let consumed = false;
      for (const d of m.decoys) {
        if (!d.alive || d.owner === p.owner) continue;
        if (d.kind === 'holo' && !HOLO_SOAK.has(p.kind)) continue;
        if (segmentCircleHit(p.px, p.pz, p.x, p.z, d.x, d.z, MATCH.fighterRadius + p.radius) >= 0) {
          if (d.kind === 'holo') {
            if (d.soak < 0) d.soak = CARD_TUNING.holo_decoy.soak;
          } else m.popDecoy(d);
          m.emit({ type: 'impact', side: p.owner, x: p.x, z: p.z, kind: 'decoy', heavy: p.heavy, weapon: p.weapon });
          p.alive = false;
          consumed = true;
          break;
        }
      }
      if (consumed) continue;

      // Alpha 1.6 STAGE BARRIER: a screen stops projectiles of both sides
      const screen = m.objects.barrierHit(p);
      if (screen) {
        m.objects.damageBarrier(screen, p.damage, p.x, p.z);
        m.emit({ type: 'impact', side: p.owner, x: p.x, z: p.z, kind: 'shield', heavy: p.heavy, weapon: p.weapon });
        p.alive = false;
        continue;
      }

      // Alpha 1.6 FRAME CATCH: the first enemy projectile through the frame is destroyed
      if (foe.frame > 0 && CATCHABLE.has(p.kind) && !(p.kind === 'power' && p.pierce > 0) && this.frameHit(foe, p)) {
        foe.frame = 0;
        foe.caught = CARD_TUNING.frame_catch.memory;
        foe.caughtDmg = p.damage;
        // stopping a heavy shot is a timing read, like a PERFECT BLOCK
        if (p.heavy) foe.m.perfects++;
        m.emit({ type: 'frameCatch', side: foe.side, x: p.x, z: p.z });
        p.alive = false;
        continue;
      }

      // REBOUND DISC: one hit per pass (out / back), the disc flies on
      const discDone = p.kind === 'disc' && (p.mask & (p.ret ? 2 : 1)) !== 0;
      if (!foe.ko && !p.passThrough && !discDone) {
        const t = segmentCircleHit(p.px, p.pz, p.x, p.z, foe.x, foe.z, foe.radius + p.radius);
        if (t >= 0) {
          if (foe.invuln > 0) {
            if (!p.dodgeLogged) {
              p.dodgeLogged = true;
              foe.m.perfects++;
              m.emit({ type: 'dodge', side: foe.side, x: foe.x, z: foe.z, perfect: true, heavy: p.heavy });
              this.onEvade(foe);
            }
          } else if (!p.smokeRolled && m.inOwnSmoke(foe) && !p.heavy) {
            p.smokeRolled = true;
            if (m.rng.chance(CARD_TUNING.smoke.missChance)) {
              p.passThrough = true;
              for (const sz of m.smokes) if (sz.owner === foe.side) sz.misses++;
              m.emit({ type: 'miss', side: foe.side, x: foe.x, z: foe.z });
            }
          }
          if (foe.invuln <= 0 && !p.passThrough) {
            const prog = clamp(p.traveled / p.range, 0, 1);
            let dmg = p.kind === 'disc' ? p.damage : p.damage * (1 + (p.falloff - 1) * prog);
            // BANK SHOT: a straight hit before the ricochet is only a graze; after it, a TRICK SHOT
            const trick = p.kind === 'bank' && p.bounced;
            if (p.kind === 'bank' && !p.bounced) dmg *= CARD_TUNING.bank_shot.directMult;
            const len = Math.hypot(p.vx, p.vz) || 1;
            const src = m.fighters[p.owner];
            // Zoe's bolt keeps SHOCK's rule: it breaks a raised shield, which only shortens the stun
            let stun = p.stun;
            if (p.kind === 'zap' && foe.shield > 0) {
              foe.shield = 0;
              foe.shieldHp = 0;
              m.emit({ type: 'shieldBreak', side: foe.side, x: foe.x, z: foe.z });
              stun = CARD_TUNING.shock.shieldStun;
            }
            const outcome = this.applyHit(foe, src, {
              damage: dmg,
              kind: HIT_KIND[p.kind],
              heavy: p.heavy,
              crit: p.crit || trick,
              electric: p.electric,
              combo: p.combo,
              knockback: p.knockback,
              stun,
              slowAmount: p.slowAmount,
              slowDuration: p.slowDuration,
              dx: p.vx / len,
              dz: p.vz / len,
              sure: false,
              projectile: p,
              pierce: p.pierce,
              boost: p.boost,
            });
            if (outcome === 'dodged') {
              // FALSE START read it: the shot flies on past her
              p.passThrough = true;
              p.dodgeLogged = true;
              continue;
            }
            if (outcome === 'blocked') {
              m.emit({ type: 'impact', side: p.owner, x: p.x, z: p.z, kind: 'shield', heavy: p.heavy, weapon: p.weapon });
            }
            if (trick && outcome === 'hit' && !src.ko) {
              const refund = CARD_TUNING.bank_shot.energyRefund;
              m.hands[src.side].gain(refund);
              m.emit({ type: 'trickShot', side: src.side, x: p.x, z: p.z, refund });
            }
            if (p.kind === 'cable' && outcome === 'hit') this.tetherTo(foe);
            if (p.kind === 'disc' && outcome === 'hit') {
              // the disc keeps spinning on its path (a shield stops it)
              p.mask |= p.ret ? 2 : 1;
              continue;
            }
            p.alive = false;
            continue;
          }
        }
      }

      // Near-miss detection: projectile passed close to its target without landing.
      if (!foe.ko) {
        const dist = Math.hypot(foe.x - p.x, foe.z - p.z);
        if (dist < p.closest) {
          p.closest = dist;
        } else if (!p.dodgeLogged && p.closest < foe.radius + 0.9 && dist > p.closest + 0.35) {
          p.dodgeLogged = true;
          if (p.heavy) {
            // Dashing out of a telegraphed line is a read, not luck: count it as perfect.
            const read = foe.readDash && m.time - foe.lastDash < 1.0;
            if (read) foe.m.perfects++;
            m.emit({ type: 'dodge', side: foe.side, x: foe.x, z: foe.z, perfect: read, heavy: true });
            this.onEvade(foe);
          } else if (p.sidestepped || m.time - foe.lastDash < 0.7) {
            this.onEvade(foe);
          }
        }
      }

      if (p.kind === 'disc') continue; // turns and expiry: steerDisc
      if (p.traveled >= p.range) {
        p.alive = false;
        m.emit({ type: 'impact', side: p.owner, x: p.x, z: p.z, kind: 'expire', heavy: p.heavy, weapon: p.weapon });
        continue;
      }
      if (!inArenaWall(p.x, p.z) && p.bounces > 0) {
        // BANK SHOT: one clean reflection off the barrier (v' = v − 2(v·n)n), back inside the ring
        clampRoundedRect(p.x, p.z, ARENA.wallX, ARENA.wallZ, ARENA.wallCorner, tmpClamp);
        const nx = tmpClamp.nx;
        const nz = tmpClamp.nz;
        const vn = p.vx * nx + p.vz * nz;
        p.vx -= 2 * vn * nx;
        p.vz -= 2 * vn * nz;
        p.x = tmpClamp.x - nx * 0.06;
        p.z = tmpClamp.z - nz * 0.06;
        p.px = p.x;
        p.pz = p.z;
        p.bounces--;
        p.bounced = true;
        // the second leg is a fresh approach for near-miss / dodge bookkeeping
        p.closest = 999;
        p.dodgeLogged = false;
        p.sidestepped = false;
        const l = Math.hypot(p.vx, p.vz) || 1;
        m.emit({ type: 'bank', side: p.owner, x: tmpClamp.x, z: tmpClamp.z, nx, nz, dx: p.vx / l, dz: p.vz / l });
        m.hitProps(tmpClamp.x, tmpClamp.z, false);
        continue;
      }
      if (!inArenaWall(p.x, p.z)) {
        p.alive = false;
        clampRoundedRect(p.x, p.z, ARENA.wallX, ARENA.wallZ, ARENA.wallCorner, tmpClamp);
        m.emit({ type: 'impact', side: p.owner, x: tmpClamp.x, z: tmpClamp.z, kind: 'wall', heavy: p.heavy, weapon: p.weapon });
        m.hitProps(tmpClamp.x, tmpClamp.z, p.heavy);
      }
    }
    // compact
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.alive) list[w++] = p;
      else this.pool.push(p);
    }
    list.length = w;
  }

  /**
   * Alpha 1.6 — REBOUND DISC flight: straight out until its turn point or the barrier, then
   * back towards where its thrower stands now (it follows the thrower, never the target).
   * Caught near the thrower; gone after maxTime. Returns false when the disc is finished.
   */
  private steerDisc(p: Projectile, dt: number): boolean {
    const m = this.m;
    const t = CARD_TUNING.rebound_disc;
    const owner = m.fighters[p.owner];
    p.life += dt;
    if (p.life >= t.maxTime || owner.ko) {
      p.alive = false;
      m.emit({ type: 'impact', side: p.owner, x: p.x, z: p.z, kind: 'expire', heavy: false, weapon: p.weapon });
      return false;
    }
    if (!p.ret) {
      const nx = p.x + p.vx * dt;
      const nz = p.z + p.vz * dt;
      if (p.traveled >= p.range || !inArenaWall(nx, nz)) {
        p.ret = true;
        // the way back is a fresh approach for dodge bookkeeping
        p.closest = 999;
        p.dodgeLogged = false;
        p.sidestepped = false;
        m.emit({ type: 'disc', side: p.owner, x: p.x, z: p.z, what: 'turn' });
      }
      return true;
    }
    const dx = owner.x - p.x;
    const dz = owner.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < t.catchRadius) {
      p.alive = false;
      m.emit({ type: 'disc', side: p.owner, x: owner.x, z: owner.z, what: 'catch' });
      return false;
    }
    const desired = Math.atan2(dx, dz);
    const cur = Math.atan2(p.vx, p.vz);
    const ny = cur + clamp(wrapAngle(desired - cur), -t.turnRate * dt, t.turnRate * dt);
    p.vx = Math.sin(ny) * p.speed;
    p.vz = Math.cos(ny) * p.speed;
    // never leaves the ring on the way home
    const nx = p.x + p.vx * dt;
    const nz = p.z + p.vz * dt;
    if (!inArenaWall(nx, nz)) {
      clampRoundedRect(nx, nz, ARENA.wallX - 0.1, ARENA.wallZ - 0.1, ARENA.wallCorner, tmpClamp);
      p.vx = (tmpClamp.x - p.x) / Math.max(dt, 1e-4);
      p.vz = (tmpClamp.z - p.z) / Math.max(dt, 1e-4);
      const l = Math.hypot(p.vx, p.vz);
      if (l > p.speed) {
        p.vx *= p.speed / l;
        p.vz *= p.speed / l;
      }
    }
    return true;
  }

  /** FRAME CATCH geometry: a short segment `ahead` m in front of the fighter, across its facing. */
  private frameHit(f: FighterSim, p: Projectile): boolean {
    const t = CARD_TUNING.frame_catch;
    const fx = Math.sin(f.facing);
    const fz = Math.cos(f.facing);
    const cx = f.x + fx * t.ahead;
    const cz = f.z + fz * t.ahead;
    // only shots coming at the front of the frame
    if (p.vx * fx + p.vz * fz >= 0) return false;
    return segSegDist(p.px, p.pz, p.x, p.z, cx + fz * t.halfWidth, cz - fx * t.halfWidth, cx - fz * t.halfWidth, cz + fx * t.halfWidth) <= p.radius + 0.12;
  }

  /** Called when a fighter successfully avoids an attack. */
  onEvade(f: FighterSim): void {
    if (f.def.passive === 'momentum' && f.momentumCd <= 0 && !f.ko) {
      const t = PASSIVE_TUNING.momentum;
      f.momentum = t.duration;
      f.momentumCd = t.cooldown;
      this.m.emit({ type: 'passive', side: f.side, passive: 'momentum' });
    }
    // Alpha 1.5 — RIPOSTE (Rina): an evade loads her next volley
    if (f.def.passive === 'riposte' && f.riposteCd <= 0 && !f.ko && !f.riposte) {
      f.riposte = true;
      f.riposteCd = PASSIVE_TUNING.riposte.cooldown;
      this.m.emit({ type: 'passive', side: f.side, passive: 'riposte' });
    }
  }

  /**
   * Alpha 1.5 — FALSE START: an attack reached a fighter whose read window is open.
   * It misses (one attack per card), a short invulnerability covers the rest of that
   * volley, and the counter shot goes back at the attacker. Returns true if it read it.
   */
  private tryFeint(target: FighterSim, source: FighterSim, h: HitInfo): boolean {
    if (target.feint <= 0 || !FEINTABLE.has(h.kind) || target.stun > 0 || target.knockback > 0 || target.ko) return false;
    const t = CARD_TUNING.false_start;
    target.feint = 0;
    target.invuln = Math.max(target.invuln, t.invulnAfter);
    target.m.perfects++;
    this.m.emit({ type: 'dodge', side: target.side, x: target.x, z: target.z, perfect: true, heavy: h.heavy });
    this.m.emit({ type: 'feintCounter', side: target.side, x: target.x, z: target.z, tx: source.x, tz: source.z, kind: h.kind });
    this.onEvade(target);
    if (!source.ko) this.fireCounter(target, source);
    return true;
  }

  // ------------------------------------------------------------------ damage
  applyStun(target: FighterSim, duration: number, by: Side): void {
    if (target.ko || duration <= 0) return;
    // BOSS FIGHT: the champion shakes stuns off faster (poise), they still interrupt him
    if (target.side === 1 && this.m.boss) duration *= this.m.boss.def.poise.stunMult;
    if (target.action.kind === 'windup' || target.action.kind === 'rush' || target.action.kind === 'cut') {
      this.m.emit({ type: 'interrupt', side: target.side, by });
      if (by !== target.side) this.m.fighters[by].m.perfects++;
    }
    this.m.abilities.cancelCut(target);
    if (target.action.kind !== 'dash') target.action = { kind: 'none' };
    target.adrenaline = 0;
    target.adrenalineShots = 0;
    target.stun = Math.max(target.stun, duration);
    this.m.emit({ type: 'stun', side: target.side, duration });
  }

  applyHit(target: FighterSim, source: FighterSim, h: HitInfo): 'hit' | 'blocked' | 'dodged' | 'ignored' {
    const m = this.m;
    if (target.ko || m.phase !== 'fight') return 'ignored';
    if (target.invuln > 0 && h.kind !== 'dot' && h.kind !== 'slam') {
      return 'dodged';
    }
    if (target.feint > 0 && this.tryFeint(target, source, h)) return 'dodged';
    let dmg = h.damage;
    // Alpha 1.6 SPOTLIGHT TAG: the marked hit lands harder once — never on top of a combo bonus (the larger counts)
    let tagged = false;
    if (target.tag > 0 && target.tagBy === source.side && TAG_KINDS.has(h.kind)) {
      const mult = CARD_TUNING.spotlight_tag.mult;
      const boost = h.boost ?? 1;
      if (mult > boost) dmg *= mult / boost;
      target.tag = 0;
      tagged = true;
      m.emit({ type: 'tagHit', side: source.side, x: target.x, z: target.z });
      m.emit({ type: 'tagEnd', side: target.side });
    }
    if (target.glitch > 0) dmg *= CARD_TUNING.system_overload.damageTakenMult;
    if (h.kind !== 'dot' && this.m.inOwnSmoke(target)) dmg *= 1 - CARD_TUNING.smoke.damageCut;
    dmg *= 1 - target.stats.armor;
    if (target.ironSkin > 0) dmg *= 1 - PASSIVE_TUNING.iron_skin.reduction;

    if (target.shield > 0 && target.shieldHp > 0 && h.kind !== 'dot') {
      // piercing shots: part of the damage goes straight through, and the shield breaks
      const pierce = h.pierce ?? 0;
      const absorbed = Math.min(target.shieldHp, dmg * (1 - pierce));
      if (pierce > 0) target.shieldHp = absorbed;
      target.shieldHp -= absorbed;
      target.shieldAbsorbed += absorbed;
      dmg -= absorbed;
      // blocking a heavy attack is a PERFECT BLOCK — unless it pierced the shield
      const perfect = h.heavy && pierce <= 0;
      if (perfect) target.m.perfects++;
      m.emit({ type: 'block', side: target.side, x: target.x, z: target.z, perfect, absorbed: Math.round(absorbed) });
      if (target.shieldHp <= 0) {
        target.shield = 0;
        target.shieldHp = 0;
        m.emit({ type: 'shieldBreak', side: target.side, x: target.x, z: target.z });
      }
      if (dmg <= 0.5) return 'blocked';
    }

    const final = Math.max(1, Math.round(dmg));
    target.hp = Math.max(0, target.hp - final);
    target.lastHit = m.time;
    target.m.damageTaken += final;
    source.m.damageDealt += final;
    source.m.hits++;
    if (h.heavy) target.lastHeavyTaken = m.time;

    m.emit({
      type: 'hit',
      side: target.side,
      source: source.side,
      damage: final,
      x: target.x,
      z: target.z,
      dx: h.dx,
      dz: h.dz,
      kind: h.kind,
      heavy: h.heavy,
      crit: h.crit || tagged,
      combo: h.combo,
      electric: h.electric,
    });

    if (h.slowAmount > 0) {
      target.slow = Math.max(target.slow, h.slowDuration);
      target.slowAmount = h.slowAmount;
    }

    if (target.hp <= 0) {
      m.knockOut(target, h.heavy || h.combo !== null);
      if (h.knockback > 0 || h.heavy) {
        const kb = Math.max(h.knockback, 3);
        target.kbX = h.dx * kb * 2.6;
        target.kbZ = h.dz * kb * 2.6;
        target.knockback = 0.5;
      }
      return 'hit';
    }

    // DIRECTOR'S CUT: the champion stands his ground — knockback neither moves nor stops him
    // (stuns and SYSTEM OVERLOAD still break the series)
    if (h.knockback > 0 && target.action.kind !== 'cut') {
      target.kbX = h.dx * h.knockback * 2.6;
      target.kbZ = h.dz * h.knockback * 2.6;
      target.knockback = Math.min(0.7, 0.15 + h.knockback * 0.06);
      if (target.action.kind === 'windup') {
        m.emit({ type: 'interrupt', side: target.side, by: source.side });
        target.action = { kind: 'none' };
      }
    }
    if (h.stun > 0) this.applyStun(target, h.stun, source.side);

    if (target.def.passive === 'iron_skin' && final >= PASSIVE_TUNING.iron_skin.threshold && target.ironSkinCd <= 0) {
      target.ironSkin = PASSIVE_TUNING.iron_skin.duration;
      target.ironSkinCd = PASSIVE_TUNING.iron_skin.cooldown;
      m.emit({ type: 'passive', side: target.side, passive: 'iron_skin' });
    }
    return 'hit';
  }
}
