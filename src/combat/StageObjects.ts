import { ARENA, CARD_TUNING, COMBO_TUNING } from '../config/balance';
import type { ComboId, Side } from '../config/types';
import { clamp, clampRoundedRect, segSegDist, type ClampResult } from '../core/math';
import type { FighterSim } from './FighterSim';
import type { Match } from './Match';
import type { Projectile, ProjectileKind, StageKind, StageObject } from './types';

const tmp: ClampResult = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };

/** Regular projectiles a FREEZE FRAME slows (heavy card shots keep their speed). */
const FREEZABLE = new Set<ProjectileKind>(['auto', 'pellet', 'bolt', 'rail', 'slug', 'adrenaline', 'counter', 'zap', 'split', 'disc', 'cable', 'cam', 'release']);

/**
 * Alpha 1.6 — the temporary set pieces of the new cards: GRAVITY NET, PRESSURE MINE,
 * STAGE BARRIER, PROP DROP, SIDE CAM and FREEZE FRAME. Pure simulation like the rest of
 * Match (deterministic, no DOM / WebGL); BattleView draws `list` by id. Every object has
 * a lifetime, per-side limits keep the count small, and the whole list is cleared when
 * the fight ends — nothing carries over to the next fight or Survival wave.
 */
export class StageObjects {
  list: StageObject[] = [];
  private m: Match;

  constructor(m: Match) {
    this.m = m;
  }

  /** The live object of this kind owned by `side` (the newest one). */
  own(side: Side, kind: StageKind): StageObject | null {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      if (o.owner === side && o.kind === kind && o.stage !== 'gone') return o;
    }
    return null;
  }

  private add(o: Omit<StageObject, 'id'>): StageObject {
    const obj: StageObject = { id: this.m.newId(), ...o };
    this.list.push(obj);
    this.m.emit({ type: 'object', id: obj.id, kind: obj.kind, owner: obj.owner, what: 'spawn', x: obj.x, z: obj.z });
    return obj;
  }

  private end(o: StageObject, what: 'end' | 'break' | 'trigger' = 'end'): void {
    if (o.stage === 'gone') return;
    o.stage = 'gone';
    this.m.emit({ type: 'object', id: o.id, kind: o.kind, owner: o.owner, what, x: o.x, z: o.z });
  }

  private removeOwn(side: Side, kind: StageKind): void {
    for (const o of this.list) if (o.owner === side && o.kind === kind) this.end(o);
  }

  /** A point on the fighters' floor (objects never land outside the playable area). */
  private onFloor(x: number, z: number, margin: number): ClampResult {
    return clampRoundedRect(x, z, ARENA.halfX - margin, ARENA.halfZ - margin, Math.max(0.2, ARENA.cornerRadius - margin), tmp);
  }

  private base(kind: StageKind, f: FighterSim, x: number, z: number): Omit<StageObject, 'id'> {
    return { kind, owner: f.side, x, z, fromX: f.x, fromZ: f.z, dirX: 0, dirZ: 1, radius: 1, t: 0, total: 1, stage: 'on', hp: 0, maxHp: 0, combo: null, variant: 0 };
  }

  // ------------------------------------------------------------------ spawns
  /** GRAVITY NET: thrown where the fighter sees the opponent heading (CAMERA LOCK: right under them). */
  spawnNet(f: FighterSim, combo: ComboId | null): void {
    const t = CARD_TUNING.gravity_net;
    this.removeOwn(f.side, 'net');
    const lock = combo === 'camera_lock';
    const lead = lock ? 0 : t.lead;
    const p = this.onFloor(f.seenX + f.seenVX * lead, f.seenZ + f.seenVZ * lead, 0.2);
    this.add({ ...this.base('net', f, p.x, p.z), radius: t.radius + (lock ? COMBO_TUNING.cameraLockRadius : 0), stage: 'fly', total: t.flight, combo });
  }

  /**
   * PRESSURE MINE: where the opponent is heading, but never right under them — at least
   * `minGap` m away (GRAVITY TRAP: closer, the net holds them). Oldest mine goes past `max`.
   */
  spawnMine(f: FighterSim, combo: ComboId | null): void {
    const t = CARD_TUNING.pressure_mine;
    const own = this.list.filter((o) => o.kind === 'mine' && o.owner === f.side && o.stage !== 'gone');
    if (own.length >= t.max) this.end(own[0]);
    const trap = combo === 'gravity_trap';
    const gap = trap ? COMBO_TUNING.trapGap : t.minGap;
    const sx = f.seenX;
    const sz = f.seenZ;
    let x = sx + f.seenVX * t.lead;
    let z = sz + f.seenVZ * t.lead;
    let p = this.onFloor(x, z, 0.4);
    if (Math.hypot(p.x - sx, p.z - sz) < gap) {
      // too close: further along the opponent's way, or towards the thrower when they stand still
      const v = Math.hypot(f.seenVX, f.seenVZ);
      let ux = v > 0.6 ? f.seenVX / v : f.x - sx;
      let uz = v > 0.6 ? f.seenVZ / v : f.z - sz;
      const ul = Math.hypot(ux, uz) || 1;
      ux /= ul;
      uz /= ul;
      x = sx + ux * gap;
      z = sz + uz * gap;
      p = this.onFloor(x, z, 0.4);
      if (Math.hypot(p.x - sx, p.z - sz) < gap * 0.9) {
        // pinned against the barrier: put it between the opponent and the thrower
        const dx = f.x - sx;
        const dz = f.z - sz;
        const dl = Math.hypot(dx, dz) || 1;
        p = this.onFloor(sx + (dx / dl) * gap, sz + (dz / dl) * gap, 0.4);
      }
    }
    this.add({ ...this.base('mine', f, p.x, p.z), radius: t.trigger, stage: 'fly', total: t.flight, combo });
  }

  /** STAGE BARRIER: across the line to the opponent, `ahead` m in front of the fighter. */
  spawnBarrier(f: FighterSim): void {
    const t = CARD_TUNING.stage_barrier;
    this.removeOwn(f.side, 'barrier');
    const dx = f.seenX - f.x;
    const dz = f.seenZ - f.z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d;
    const uz = dz / d;
    const p = this.onFloor(f.x + ux * t.ahead, f.z + uz * t.ahead, 0);
    this.add({ ...this.base('barrier', f, p.x, p.z), dirX: -uz, dirZ: ux, radius: t.halfLen, total: t.duration, hp: t.hp, maxHp: t.hp });
  }

  /** PROP DROP: a warning circle where the opponent is heading (SET PIECE: right on them, wider). */
  spawnProp(f: FighterSim, combo: ComboId | null): void {
    const t = CARD_TUNING.prop_drop;
    const set = combo === 'set_piece';
    const lead = set ? 0 : t.lead;
    const p = this.onFloor(f.seenX + f.seenVX * lead, f.seenZ + f.seenVZ * lead, 0.3);
    const o = this.add({ ...this.base('prop', f, p.x, p.z), radius: set ? COMBO_TUNING.setPieceRadius : t.radius, stage: 'warn', total: t.delay, combo });
    o.variant = o.id % 3;
  }

  /**
   * SIDE CAM: on the straight part of the barrier at the opponent's flank — the wall whose
   * line to the opponent is closest to perpendicular to the fighter's own line of fire.
   * Fixed rules, no randomness: the player can read where it will rise.
   */
  spawnCam(f: FighterSim, combo: ComboId | null): void {
    this.removeOwn(f.side, 'cam');
    const tx = f.seenX;
    const tz = f.seenZ;
    const dx = tx - f.x;
    const dz = tz - f.z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d;
    const uz = dz / d;
    const sz = ARENA.wallZ - ARENA.wallCorner - 0.3;
    const sx = ARENA.wallX - ARENA.wallCorner - 0.3;
    const cands: [number, number][] = [
      [ARENA.wallX, clamp(tz, -sz, sz)],
      [-ARENA.wallX, clamp(tz, -sz, sz)],
      [clamp(tx, -sx, sx), ARENA.wallZ],
      [clamp(tx, -sx, sx), -ARENA.wallZ],
    ];
    let best = cands[0];
    let bestScore = -Infinity;
    for (const c of cands) {
      const vx = tx - c[0];
      const vz = tz - c[1];
      const vl = Math.hypot(vx, vz) || 1;
      const flank = 1 - Math.abs((vx / vl) * ux + (vz / vl) * uz);
      let score = flank * 2 - Math.abs(vl - 5) * 0.25;
      if (vl < 2.5) score -= 3;
      // never from right behind the fighter (it would read as a friendly shot past them)
      if (Math.hypot(c[0] - f.x, c[1] - f.z) < 2) score -= 2;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    const vx = tx - best[0];
    const vz = tz - best[1];
    const vl = Math.hypot(vx, vz) || 1;
    this.add({ ...this.base('cam', f, best[0], best[1]), dirX: vx / vl, dirZ: vz / vl, stage: 'aim', total: CARD_TUNING.side_cam.aim, combo });
  }

  /** FREEZE FRAME: a slow-motion zone around the fighter (one per side). */
  spawnFreeze(f: FighterSim): void {
    const t = CARD_TUNING.freeze_frame;
    this.removeOwn(f.side, 'freeze');
    this.add({ ...this.base('freeze', f, f.x, f.z), radius: t.radius, total: t.duration });
  }

  // --------------------------------------------------------------- combos
  /** TIME SLIP: the freeze zone moves with the DASH. */
  moveFreeze(side: Side, x: number, z: number): void {
    const o = this.own(side, 'freeze');
    if (!o) return;
    o.x = x;
    o.z = z;
    this.m.emit({ type: 'object', id: o.id, kind: 'freeze', owner: side, what: 'land', x, z });
  }

  /** REWIND TRAP: every mine of `side` arms now (still in flight: arms as it lands). */
  armMines(side: Side): void {
    for (const o of this.list) {
      if (o.kind !== 'mine' || o.owner !== side) continue;
      if (o.stage === 'arming') {
        o.stage = 'armed';
        o.t = 0;
        o.total = CARD_TUNING.pressure_mine.life;
        this.m.emit({ type: 'object', id: o.id, kind: 'mine', owner: side, what: 'arm', x: o.x, z: o.z });
      } else if (o.stage === 'fly') o.combo = 'rewind_trap';
    }
  }

  /** The nearest live mine of `side` to (x, z) (MINE DRIVE). */
  nearestMine(side: Side, x: number, z: number): StageObject | null {
    let best: StageObject | null = null;
    let bd = Infinity;
    for (const o of this.list) {
      if (o.kind !== 'mine' || o.owner !== side || o.stage === 'gone') continue;
      const d = Math.hypot(o.x - x, o.z - z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  // ------------------------------------------------------- projectile rules
  /**
   * Speed factor for a projectile this step (FREEZE FRAME). Inside a zone the regular shots of
   * BOTH sides that are heading in — towards its centre — crawl; shots heading out leave at full
   * speed (a shooter in the middle is not robbed of its own aim, an attacker who walked in still
   * is slowed). The champion's shots are never slowed.
   */
  freezeScale(p: Projectile): number {
    if (!FREEZABLE.has(p.kind) || (this.m.boss && p.owner === 1)) return 1;
    for (const o of this.list) {
      if (o.kind !== 'freeze' || o.stage !== 'on') continue;
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      if (dx * dx + dz * dz < o.radius * o.radius && dx * p.vx + dz * p.vz > 0) return CARD_TUNING.freeze_frame.speed;
    }
    return 1;
  }

  /** REPLAY: erase the opponent's regular projectiles inside `side`'s freeze zone. */
  erase(side: Side): number {
    const o = this.own(side, 'freeze');
    if (!o) return 0;
    let n = 0;
    for (const p of this.m.projectiles) {
      if (!p.alive || p.owner === side || !FREEZABLE.has(p.kind)) continue;
      if (this.m.boss && p.owner === 1) continue;
      if (Math.hypot(p.x - o.x, p.z - o.z) >= o.radius) continue;
      p.alive = false;
      n++;
      this.m.emit({ type: 'erase', side, x: p.x, z: p.z });
    }
    return n;
  }

  /**
   * STAGE BARRIER: did this projectile's step cross a screen? CHARGED SHOT goes through,
   * CROSS ANGLE camera bolts pass their owner's own screen. Returns the screen it hit.
   */
  barrierHit(p: Projectile): StageObject | null {
    const th = CARD_TUNING.stage_barrier.thickness;
    for (const o of this.list) {
      if (o.kind !== 'barrier' || o.stage !== 'on') continue;
      if (p.ownPass && o.owner === p.owner) continue;
      if (p.kind === 'power' && p.pierce > 0) continue;
      const ax = o.x - o.dirX * o.radius;
      const az = o.z - o.dirZ * o.radius;
      const bx = o.x + o.dirX * o.radius;
      const bz = o.z + o.dirZ * o.radius;
      if (segSegDist(p.px, p.pz, p.x, p.z, ax, az, bx, bz) <= p.radius + th) return o;
    }
    return null;
  }

  /** A projectile struck a screen: it soaks the damage and breaks when its hit points run out. */
  damageBarrier(o: StageObject, dmg: number, x: number, z: number): void {
    o.hp -= dmg;
    if (o.hp <= 0) {
      o.hp = 0;
      this.end(o, 'break');
    } else this.m.emit({ type: 'object', id: o.id, kind: 'barrier', owner: o.owner, what: 'hit', x, z });
  }

  // ------------------------------------------------------------------ update
  update(dt: number): void {
    const m = this.m;
    for (const f of m.fighters) f.netSlow = 1;
    for (const o of this.list) {
      if (o.stage === 'gone') continue;
      o.t += dt;
      const foe = m.fighters[1 - o.owner];
      switch (o.kind) {
        case 'net':
          this.updateNet(o, foe);
          break;
        case 'mine':
          this.updateMine(o, foe);
          break;
        case 'prop':
          this.updateProp(o, foe);
          break;
        case 'cam':
          this.updateCam(o);
          break;
        default:
          // barrier, freeze: just a lifetime
          if (o.t >= o.total) this.end(o);
      }
    }
    if (this.list.some((o) => o.stage === 'gone')) this.list = this.list.filter((o) => o.stage !== 'gone');
  }

  private updateNet(o: StageObject, foe: FighterSim): void {
    const t = CARD_TUNING.gravity_net;
    if (o.stage === 'fly') {
      if (o.t >= o.total) {
        o.stage = 'on';
        o.t = 0;
        o.total = t.duration;
        this.m.emit({ type: 'object', id: o.id, kind: 'net', owner: o.owner, what: 'land', x: o.x, z: o.z });
      }
      return;
    }
    if (o.t >= o.total) {
      this.end(o);
      return;
    }
    if (!foe.ko && foe.holdImmune <= 0 && Math.hypot(foe.x - o.x, foe.z - o.z) < o.radius) {
      const s = foe.side === 1 && this.m.boss ? t.bossSlow : t.slow;
      if (s < foe.netSlow) foe.netSlow = s;
    }
  }

  private updateMine(o: StageObject, foe: FighterSim): void {
    const m = this.m;
    const t = CARD_TUNING.pressure_mine;
    if (o.stage === 'fly') {
      if (o.t >= o.total) {
        // lands; REWIND TRAP (played while it flew) arms it at once
        const instant = o.combo === 'rewind_trap';
        o.stage = instant ? 'armed' : 'arming';
        o.t = 0;
        o.total = instant ? t.life : o.combo === 'gravity_trap' ? COMBO_TUNING.trapArm : t.arm;
        m.emit({ type: 'object', id: o.id, kind: 'mine', owner: o.owner, what: instant ? 'arm' : 'land', x: o.x, z: o.z });
      }
      return;
    }
    if (o.stage === 'arming') {
      if (o.t >= o.total) {
        o.stage = 'armed';
        o.t = 0;
        o.total = t.life;
        m.emit({ type: 'object', id: o.id, kind: 'mine', owner: o.owner, what: 'arm', x: o.x, z: o.z });
      }
      return;
    }
    if (o.t >= o.total) {
      this.end(o);
      return;
    }
    // armed: the opponent steps in (a DASH in the air skips over it)
    if (foe.ko || foe.invuln > 0) return;
    const dx = foe.x - o.x;
    const dz = foe.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d >= o.radius) return;
    this.end(o, 'trigger');
    const src = m.fighters[o.owner];
    const ux = d > 0.01 ? dx / d : 0;
    const uz = d > 0.01 ? dz / d : 1;
    const r = m.combat.applyHit(foe, src, {
      damage: t.damage * src.outgoingDamageMult(),
      kind: 'mine',
      heavy: true,
      crit: false,
      electric: true,
      combo: null,
      knockback: 0,
      stun: 0,
      slowAmount: 0,
      slowDuration: 0,
      dx: ux,
      dz: uz,
      sure: true,
      projectile: null,
    });
    if (r === 'hit') m.combat.shove(foe, ux, uz, t.shove);
  }

  private updateProp(o: StageObject, foe: FighterSim): void {
    const m = this.m;
    const t = CARD_TUNING.prop_drop;
    if (o.stage === 'landed') {
      if (o.t >= o.total) this.end(o);
      return;
    }
    if (o.t < o.total) return;
    // impact
    o.stage = 'landed';
    o.t = 0;
    o.total = t.linger;
    m.emit({ type: 'object', id: o.id, kind: 'prop', owner: o.owner, what: 'land', x: o.x, z: o.z });
    if (foe.ko) return;
    const dx = foe.x - o.x;
    const dz = foe.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d >= o.radius) return;
    if (foe.invuln > 0) {
      foe.m.perfects++;
      m.emit({ type: 'dodge', side: foe.side, x: foe.x, z: foe.z, perfect: true, heavy: true });
      m.combat.onEvade(foe);
      return;
    }
    const src = m.fighters[o.owner];
    m.combat.applyHit(foe, src, {
      damage: t.damage * src.outgoingDamageMult(),
      kind: 'prop',
      heavy: true,
      crit: o.combo !== null,
      electric: false,
      combo: o.combo,
      knockback: t.knockback,
      stun: 0,
      slowAmount: 0,
      slowDuration: 0,
      dx: d > 0.01 ? dx / d : 0,
      dz: d > 0.01 ? dz / d : 1,
      sure: true,
      projectile: null,
    });
  }

  private updateCam(o: StageObject): void {
    const m = this.m;
    const t = CARD_TUNING.side_cam;
    const f = m.fighters[o.owner];
    if (o.stage === 'aim') {
      // the lens follows what the owner sees of the opponent
      const vx = f.seenX - o.x;
      const vz = f.seenZ - o.z;
      const vl = Math.hypot(vx, vz);
      if (vl > 0.05) {
        o.dirX = vx / vl;
        o.dirZ = vz / vl;
      }
      if (o.t >= o.total) {
        // freeze the line, half-leading the target (CROSS ANGLE: better lead)
        const k = o.combo === 'cross_angle' ? COMBO_TUNING.crossAngleLead : t.lead;
        const time = (t.lock + vl / t.speed) * k;
        const lx = f.seenX + f.seenVX * time - o.x;
        const lz = f.seenZ + f.seenVZ * time - o.z;
        const ll = Math.hypot(lx, lz) || 1;
        o.dirX = lx / ll;
        o.dirZ = lz / ll;
        o.stage = 'lock';
        o.t = 0;
        o.total = t.lock;
        m.emit({ type: 'object', id: o.id, kind: 'cam', owner: o.owner, what: 'lock', x: o.x, z: o.z });
      }
      return;
    }
    if (o.stage === 'lock') {
      if (o.t < o.total) return;
      o.stage = 'retract';
      o.t = 0;
      o.total = t.retract;
      if (m.phase === 'fight' && !f.ko) m.combat.fireCam(f, o);
      m.emit({ type: 'object', id: o.id, kind: 'cam', owner: o.owner, what: 'fire', x: o.x, z: o.z });
      return;
    }
    if (o.t >= o.total) this.end(o);
  }

  /** End of the fight: every set piece goes (the view fades them out). */
  clear(): void {
    for (const o of this.list) this.end(o);
    this.list = [];
    for (const f of this.m.fighters) f.netSlow = 1;
  }
}
