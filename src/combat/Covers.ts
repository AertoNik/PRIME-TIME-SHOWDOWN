import { ARENA, COVER_TUNING } from '../config/balance';
import type { ArenaCoverDef, CoverKind } from '../config/arenas.config';
import type { Side } from '../config/types';
import { clampRoundedRect, pointSegDist, segSegDist, segmentCircleHit, type ClampResult } from '../core/math';
import type { FighterSim } from './FighterSim';
import type { Match } from './Match';
import type { Projectile } from './types';
import { dm } from '../core/dmath';

/** One piece of cover on the fighting floor (Alpha 1.7.5, GRAVEYARD BROADCAST). */
export interface CoverState {
  /** Index in the arena's `covers` list (the view's id for the piece). */
  index: number;
  kind: CoverKind;
  x: number;
  z: number;
  /** Ends of the capsule's axis on the floor (the same point for a round piece). */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  radius: number;
  hp: number;
  maxHp: number;
  /** 0 intact, 1 cracked, 2 battered, 3 shattered (gone: no collision any more). */
  stage: number;
  alive: boolean;
  /** Match time of the last hit it took. */
  hitAt: number;
}

/** The look for the hit points left: intact above 2/3, cracked down to 1/3, battered below, shattered at 0. */
export function coverStage(hp: number, maxHp: number): number {
  if (hp <= 0) return 3;
  if (hp <= maxHp / 3) return 2;
  if (hp <= (maxHp * 2) / 3) return 1;
  return 0;
}

const tmp: ClampResult = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };
const near = { x: 0, z: 0 };

/**
 * Alpha 1.7.5 — the destructible cover of GRAVEYARD BROADCAST. Pure simulation like the rest
 * of Match (deterministic, no random numbers): tombstones, columns and big pumpkins standing
 * on the fighting floor. They stop fighters (who slide round them) and the shots of both
 * sides, soak whatever hits them and shatter when their hit points run out — then nothing of
 * them is left in the fight (the debris is the view's business and has no collision). Nothing
 * is rebuilt during a fight; every Match builds its pieces anew from the arena data.
 * On every other set the list is empty and each query returns at once.
 */
export class Covers {
  readonly list: CoverState[];
  /** Pieces still standing (0: no cover on this set, or all of it is down). */
  live: number;
  private m: Match;

  constructor(m: Match, defs: readonly ArenaCoverDef[]) {
    this.m = m;
    this.list = defs.map((d, index) => {
      const t = COVER_TUNING[d.kind];
      const yaw = d.yaw ?? 0;
      // the same turn as the view's rotation.y: local +X → (cos, −sin)
      const ux = dm.cos(yaw) * t.half;
      const uz = -dm.sin(yaw) * t.half;
      return { index, kind: d.kind, x: d.x, z: d.z, ax: d.x - ux, az: d.z - uz, bx: d.x + ux, bz: d.z + uz, radius: t.radius, hp: t.hp, maxHp: t.hp, stage: 0, alive: true, hitAt: -99 };
    });
    this.live = this.list.length;
  }

  /** The point of the piece's axis closest to (x, z). */
  private closest(c: CoverState, x: number, z: number): { x: number; z: number } {
    const dx = c.bx - c.ax;
    const dz = c.bz - c.az;
    const l = dx * dx + dz * dz;
    let t = l < 1e-9 ? 0 : ((x - c.ax) * dx + (z - c.az) * dz) / l;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    near.x = c.ax + dx * t;
    near.z = c.az + dz * t;
    return near;
  }

  /** Distance from (x, z) to the piece's surface (negative inside). */
  gap(c: CoverState, x: number, z: number): number {
    return pointSegDist(x, z, c.ax, c.az, c.bx, c.bz) - c.radius;
  }

  /** The live piece nearest to (x, z), with its surface gap. */
  nearest(x: number, z: number): { c: CoverState; gap: number } | null {
    let best: CoverState | null = null;
    let bg = Infinity;
    for (const c of this.list) {
      if (!c.alive) continue;
      const g = this.gap(c, x, z);
      if (g < bg) {
        bg = g;
        best = c;
      }
    }
    return best ? { c: best, gap: bg } : null;
  }

  /**
   * Keep a fighter out of every live piece: pushed back onto its surface, the part of its
   * movement into the piece removed (it slides round it), a knockback slamming into it
   * damages the piece. Re-clamped to the floor after each pass (cover never stands closer to
   * the barrier than a fighter's width, so the two never pin anybody).
   */
  collide(f: FighterSim): void {
    if (this.live <= 0) return;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const c of this.list) {
        if (!c.alive) continue;
        const R = c.radius + f.radius;
        const q = this.closest(c, f.x, f.z);
        const qx = q.x;
        const qz = q.z;
        let nx = f.x - qx;
        let nz = f.z - qz;
        const d = dm.hypot(nx, nz);
        if (d >= R) continue;
        if (d > 1e-4) {
          nx /= d;
          nz /= d;
        } else {
          // dead centre (cannot happen by walking): out towards the fighter's own end of the floor
          nx = 0;
          nz = f.side === 0 ? 1 : -1;
        }
        f.x = qx + nx * R;
        f.z = qz + nz * R;
        moved = true;
        const into = -(f.vx * nx + f.vz * nz);
        if (into > 0) {
          if (f.knockback > 0 && into > COVER_TUNING.slamSpeed) {
            this.damage(c, COVER_TUNING.slamDamage, qx + nx * c.radius, qz + nz * c.radius, -nx, -nz, true, (1 - f.side) as Side);
          }
          f.vx += into * nx;
          f.vz += into * nz;
          if (f.knockback > 0) {
            f.kbX = f.vx * 0.3;
            f.kbZ = f.vz * 0.3;
          }
        }
        const push = -(f.shoveX * nx + f.shoveZ * nz);
        if (push > 0) {
          f.shoveX += push * nx;
          f.shoveZ += push * nz;
        }
      }
      if (!moved) break;
      clampRoundedRect(f.x, f.z, ARENA.halfX, ARENA.halfZ, ARENA.cornerRadius, tmp);
      f.x = tmp.x;
      f.z = tmp.z;
    }
  }

  /**
   * The first live piece (seen from (x0, z0)) whose body comes within `pad` of the line to
   * (x1, z1): what a strike, a lunge or a line of fire runs into. Null when the line is clear.
   */
  onLine(x0: number, z0: number, x1: number, z1: number, pad: number): CoverState | null {
    if (this.live <= 0) return null;
    const lx = x1 - x0;
    const lz = z1 - z0;
    const ll = dm.hypot(lx, lz) || 1;
    let best: CoverState | null = null;
    let bestAlong = Infinity;
    for (const c of this.list) {
      if (!c.alive) continue;
      if (segSegDist(x0, z0, x1, z1, c.ax, c.az, c.bx, c.bz) > c.radius + pad) continue;
      const along = ((c.x - x0) * lx + (c.z - z0) * lz) / ll;
      if (along < bestAlong) {
        bestAlong = along;
        best = c;
      }
    }
    return best;
  }

  /**
   * Did this projectile's step — from (fx, fz) to where it is now — touch a live piece?
   * Returns the first one and how far along the step (0..1) it touched it. A piercing
   * CHARGED SHOT skips the pieces it already went through (`p.coverMask`).
   */
  projectileHit(p: Projectile, fx: number, fz: number): { c: CoverState; t: number } | null {
    if (this.live <= 0) return null;
    let best: CoverState | null = null;
    let bt = Infinity;
    for (const c of this.list) {
      if (!c.alive || (p.coverMask & (1 << c.index)) !== 0) continue;
      const R = c.radius + p.radius;
      if (segSegDist(fx, fz, p.x, p.z, c.ax, c.az, c.bx, c.bz) > R) continue;
      let t: number;
      if (c.ax === c.bx && c.az === c.bz) {
        t = segmentCircleHit(fx, fz, p.x, p.z, c.x, c.z, R);
        if (t < 0) t = 1;
      } else t = this.firstTouch(c, fx, fz, p.x, p.z, R);
      if (t < bt) {
        bt = t;
        best = c;
      }
    }
    return best ? { c: best, t: bt } : null;
  }

  /** First fraction of the segment within R of a slab's axis (coarse march, then bisection). */
  private firstTouch(c: CoverState, x0: number, z0: number, x1: number, z1: number, R: number): number {
    const inside = (t: number) => pointSegDist(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, c.ax, c.az, c.bx, c.bz) <= R;
    if (inside(0)) return 0;
    let lo = 0;
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      if (!inside(t)) {
        lo = t;
        continue;
      }
      let hi = t;
      for (let k = 0; k < 5; k++) {
        const mid = (lo + hi) / 2;
        if (inside(mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    return 1;
  }

  /** Where a hit at the piece lands: its surface, on the side facing (x, z). */
  contact(c: CoverState, x: number, z: number, out: { x: number; z: number }): { x: number; z: number } {
    const q = this.closest(c, x, z);
    const dx = x - q.x;
    const dz = z - q.z;
    const d = dm.hypot(dx, dz) || 1;
    out.x = q.x + (dx / d) * c.radius;
    out.z = q.z + (dz / d) * c.radius;
    return out;
  }

  /**
   * How much of a straight move of a body (radius r) from (x0, z0) to (x1, z1) is free before
   * it touches cover: 1 = all of it. (DASH planning — the move itself slides round cover.)
   */
  sweep(x0: number, z0: number, x1: number, z1: number, r: number): number {
    if (this.live <= 0) return 1;
    let free = 1;
    for (const c of this.list) {
      if (!c.alive) continue;
      if (segSegDist(x0, z0, x1, z1, c.ax, c.az, c.bx, c.bz) > c.radius + r) continue;
      const t = this.firstTouch(c, x0, z0, x1, z1, c.radius + r);
      if (t < free) free = t;
    }
    return free;
  }

  /** (x, z) moved out of every live piece so that a body of radius r fits beside it. */
  pushOut(x: number, z: number, r: number, out: { x: number; z: number }): { x: number; z: number } {
    out.x = x;
    out.z = z;
    if (this.live <= 0) return out;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const c of this.list) {
        if (!c.alive) continue;
        const R = c.radius + r;
        const q = this.closest(c, out.x, out.z);
        let nx = out.x - q.x;
        let nz = out.z - q.z;
        const d = dm.hypot(nx, nz);
        if (d >= R) continue;
        if (d > 1e-4) {
          nx /= d;
          nz /= d;
        } else {
          nx = 0;
          nz = 1;
        }
        out.x = q.x + nx * R;
        out.z = q.z + nz * R;
        moved = true;
      }
      if (!moved) break;
      clampRoundedRect(out.x, out.z, ARENA.halfX - 0.2, ARENA.halfZ - 0.2, ARENA.cornerRadius, tmp);
      out.x = tmp.x;
      out.z = tmp.z;
    }
    return out;
  }

  /** Is (x, z) clear of cover for a body of radius r? */
  clear(x: number, z: number, r: number): boolean {
    if (this.live <= 0) return true;
    for (const c of this.list) if (c.alive && this.gap(c, x, z) < r) return false;
    return true;
  }

  /**
   * A piece soaks `dmg` (from `side`, at (x, z), the blow travelling along (dx, dz)). Its look
   * follows the hit points left; at 0 it shatters and stops blocking at once. No rating, no
   * energy, no rewards: hitting cover pays nothing, so it cannot be farmed.
   */
  damage(c: CoverState, dmg: number, x: number, z: number, dx: number, dz: number, heavy: boolean, side: Side | -1): void {
    if (!c.alive || !(dmg > 0)) return;
    const before = c.stage;
    c.hp = Math.max(0, c.hp - dmg);
    c.hitAt = this.m.time;
    c.stage = coverStage(c.hp, c.maxHp);
    let what: 'hit' | 'crack' | 'break' = c.stage !== before ? 'crack' : 'hit';
    if (c.hp <= 0) {
      c.alive = false;
      c.stage = 3;
      this.live--;
      what = 'break';
    }
    this.m.emit({ type: 'cover', index: c.index, what, stage: c.stage, hp: Math.round(c.hp), x, z, dx, dz, heavy, side });
  }
}
