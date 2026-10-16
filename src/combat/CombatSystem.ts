import { ARENA, BROADCAST, CARD_TUNING, MATCH, PASSIVE_TUNING } from '../config/balance';
import type { Side, WeaponType } from '../config/types';
import { clamp, clampRoundedRect, dampAngle, segmentCircleHit, wrapAngle, type ClampResult } from '../core/math';
import type { FighterSim } from './FighterSim';
import type { Match } from './Match';
import type { HitInfo, Projectile, ProjectileKind } from './types';

const tmpClamp: ClampResult = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };

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
    if (f.counterT > 0) {
      f.counterT -= dt;
      if (f.counterT <= 0) f.counterShots = 0;
    }
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
    if (a.kind === 'dash' || a.kind === 'rush') {
      tvx = a.dirX * a.speed;
      tvz = a.dirZ * a.speed;
      accel = 400;
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
    if (dv <= maxDv || dv < 1e-6) {
      f.vx = tvx;
      f.vz = tvz;
    } else {
      f.vx += (dvx / dv) * maxDv;
      f.vz += (dvz / dv) * maxDv;
    }
    this.integrate(f, dt);

    // Aim / facing (model turns toward its aim point).
    const desired = a.kind === 'cut' ? Math.atan2(a.dirX, a.dirZ) : Math.atan2(f.aimX - f.x, f.aimZ - f.z);
    if (a.kind === 'rush' || a.kind === 'dash') {
      // Keep facing; view handles the dash pose.
    } else if (f.stun <= 0) {
      f.facing = dampAngle(f.facing, desired, a.kind === 'windup' ? 10 : a.kind === 'cut' ? 12 : 15, dt);
    }

    this.autoFire(f, foe, dt);
  }

  private integrate(f: FighterSim, dt: number): void {
    const nx = f.x + f.vx * dt;
    const nz = f.z + f.vz * dt;
    clampRoundedRect(nx, nz, ARENA.halfX, ARENA.halfZ, ARENA.cornerRadius, tmpClamp);
    f.x = tmpClamp.x;
    f.z = tmpClamp.z;
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
          const dx = f.aimX - f.x;
          const dz = f.aimZ - f.z;
          const d = Math.hypot(dx, dz) || 1;
          a.dirX = dx / d;
          a.dirZ = dz / d;
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
        a.t += dt;
        if (a.t >= a.total) f.action = { kind: 'none' };
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
    const dmg = atk.damage * f.outgoingDamageMult() * (counter ? CARD_TUNING.dash.counterMult : 1) * (deadeye ? PASSIVE_TUNING.deadeye.mult : 1);
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
        crit: counter || deadeye,
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
    this.m.projectiles.push(p);
    return p;
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

      if (p.homing > 0 && !foe.ko) {
        const desired = Math.atan2(foe.x - p.x, foe.z - p.z);
        const cur = Math.atan2(p.vx, p.vz);
        const diff = wrapAngle(desired - cur);
        if (Math.abs(diff) < 1.5) {
          const turn = clamp(diff, -p.homing * dt, p.homing * dt);
          const ny = cur + turn;
          p.vx = Math.sin(ny) * p.speed;
          p.vz = Math.cos(ny) * p.speed;
        }
      }

      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.traveled += p.speed * dt;

      // Decoys soak hostile fire.
      let consumed = false;
      for (const d of m.decoys) {
        if (!d.alive || d.owner === p.owner) continue;
        if (segmentCircleHit(p.px, p.pz, p.x, p.z, d.x, d.z, MATCH.fighterRadius + p.radius) >= 0) {
          m.popDecoy(d);
          m.emit({ type: 'impact', side: p.owner, x: p.x, z: p.z, kind: 'decoy', heavy: p.heavy, weapon: p.weapon });
          p.alive = false;
          consumed = true;
          break;
        }
      }
      if (consumed) continue;

      if (!foe.ko && !p.passThrough) {
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
            const dmg = p.damage * (1 + (p.falloff - 1) * prog);
            const len = Math.hypot(p.vx, p.vz) || 1;
            const outcome = this.applyHit(foe, m.fighters[p.owner], {
              damage: dmg,
              kind: p.kind === 'power' ? 'power' : p.kind === 'adrenaline' ? 'adrenaline' : 'auto',
              heavy: p.heavy,
              crit: p.crit,
              electric: p.electric,
              combo: p.combo,
              knockback: p.knockback,
              stun: p.stun,
              slowAmount: p.slowAmount,
              slowDuration: p.slowDuration,
              dx: p.vx / len,
              dz: p.vz / len,
              sure: false,
              projectile: p,
              pierce: p.pierce,
            });
            if (outcome === 'blocked') {
              m.emit({ type: 'impact', side: p.owner, x: p.x, z: p.z, kind: 'shield', heavy: p.heavy, weapon: p.weapon });
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

      if (p.traveled >= p.range) {
        p.alive = false;
        m.emit({ type: 'impact', side: p.owner, x: p.x, z: p.z, kind: 'expire', heavy: p.heavy, weapon: p.weapon });
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

  /** Called when a fighter successfully avoids an attack. */
  onEvade(f: FighterSim): void {
    if (f.def.passive === 'momentum' && f.momentumCd <= 0 && !f.ko) {
      const t = PASSIVE_TUNING.momentum;
      f.momentum = t.duration;
      f.momentumCd = t.cooldown;
      this.m.emit({ type: 'passive', side: f.side, passive: 'momentum' });
    }
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
    let dmg = h.damage;
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
      crit: h.crit,
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
