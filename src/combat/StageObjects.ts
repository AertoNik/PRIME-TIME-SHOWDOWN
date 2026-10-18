import { ARENA, CARD_TUNING, COMBO_TUNING } from '../config/balance';
import { TAKE_CARDS } from '../config/cards';
import type { ComboId, Side } from '../config/types';
import { clampRoundedRect, pointSegDist, segSegDist, type ClampResult } from '../core/math';
import type { FighterSim } from './FighterSim';
import type { Match } from './Match';
import type { Projectile, ProjectileKind, StageKind, StageObject } from './types';

const tmp: ClampResult = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };

/** Regular projectiles a FREEZE FRAME slows (heavy card shots keep their speed). */
const FREEZABLE = new Set<ProjectileKind>(['auto', 'pellet', 'bolt', 'rail', 'slug', 'adrenaline', 'counter', 'zap', 'split', 'disc', 'cable', 'release']);

/**
 * Alpha 1.6 — the temporary set pieces of the new cards: GRAVITY NET, PRESSURE MINE,
 * STAGE BARRIER, PROP DROP, FREEZE FRAME and (1.6.1) the SECOND TAKE echo. Pure simulation like the rest of
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
    const p = this.onFloor(f.seenX + f.seenVX * t.lead, f.seenZ + f.seenVZ * t.lead, 0.2);
    this.add({ ...this.base('net', f, p.x, p.z), radius: t.radius, stage: 'fly', total: t.flight, combo });
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

  /**
   * STAGE BARRIER (Alpha 1.6.1 placement): across the line to the opponent, between the two
   * fighters at a share of their real distance, clear of both bodies. When they are too close
   * for a screen in between, it rises behind the fighter instead — cover to step back to —
   * and never inside or behind the opponent. Nobody is moved or teleported.
   */
  spawnBarrier(f: FighterSim): void {
    const t = CARD_TUNING.stage_barrier;
    this.removeOwn(f.side, 'barrier');
    const foe = this.m.fighters[1 - f.side];
    // the screen faces what the fighter sees; the bodies it must stay clear of are the real ones
    let dx = f.seenX - f.x;
    let dz = f.seenZ - f.z;
    let dl = Math.hypot(dx, dz);
    if (dl < 0.05) {
      dx = Math.sin(f.facing);
      dz = Math.cos(f.facing);
      dl = 1;
    }
    const ux = dx / dl;
    const uz = dz / dl;
    const d = Math.hypot(foe.x - f.x, foe.z - f.z);
    const cands: number[] = [];
    const between = Math.min(t.ahead, Math.max(t.minAhead, d * t.share));
    if (d - between >= t.clear && between >= t.clear) cands.push(between);
    cands.push(d * 0.5); // the middle, if the first did not fit
    cands.push(-t.behind, -t.behind * 1.4); // too close: cover behind the fighter
    for (const a of cands) {
      const spot = this.screenSpot(f.x + ux * a, f.z + uz * a, -uz, ux, t.halfLen);
      if (!spot) continue;
      const ax = spot.x - uz * t.halfLen;
      const az = spot.z + ux * t.halfLen;
      const bx = spot.x + uz * t.halfLen;
      const bz = spot.z - ux * t.halfLen;
      const clearF = pointSegDist(f.x, f.z, ax, az, bx, bz);
      const clearE = foe.ko ? 99 : pointSegDist(foe.x, foe.z, ax, az, bx, bz);
      // never behind the opponent: the opponent must not be between the fighter and the screen
      const along = (spot.x - f.x) * ux + (spot.z - f.z) * uz;
      if (clearF < t.clear - 0.05 || clearE < t.clear - 0.05 || (along > 0 && along > d - t.clear)) continue;
      this.add({ ...this.base('barrier', f, spot.x, spot.z), dirX: -uz, dirZ: ux, radius: t.halfLen, total: t.duration, hp: t.hp, maxHp: t.hp });
      return;
    }
    // nowhere clear (pinned in a corner): the screen stands right behind the fighter
    const p = this.onFloor(f.x - ux * t.behind, f.z - uz * t.behind, 0.3);
    this.add({ ...this.base('barrier', f, p.x, p.z), dirX: -uz, dirZ: ux, radius: t.halfLen, total: t.duration, hp: t.hp, maxHp: t.hp });
  }

  /**
   * A screen centre near (x, z) on the fighters' floor whose ends stay inside the stage walls
   * (slid along itself if needed — a fighter hugging the wall still gets a screen across the
   * line); null if it cannot fit.
   */
  private screenSpot(x: number, z: number, dirX: number, dirZ: number, half: number): { x: number; z: number } | null {
    const c = this.onFloor(x, z, 0.2);
    let cx = c.x;
    let cz = c.z;
    for (let i = 0; i < 2; i++) {
      for (const sg of [1, -1]) {
        const ex = cx + dirX * half * sg;
        const ez = cz + dirZ * half * sg;
        const e = clampRoundedRect(ex, ez, ARENA.wallX - 0.1, ARENA.wallZ - 0.1, ARENA.wallCorner, tmp);
        if (e.hit) {
          cx += e.x - ex;
          cz += e.z - ez;
        }
      }
    }
    if (Math.hypot(cx - x, cz - z) > 1.2) return null;
    return { x: cx, z: cz };
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
   * Alpha 1.6.1 — SECOND TAKE: the echo of the fighter's last card attack rises where that
   * attack was first played, tracks the target for a moment, freezes its line and fires (see
   * updateEcho / CombatSystem.fireEcho). The take is used up: a replay is never replayed.
   */
  spawnEcho(f: FighterSim, combo: ComboId | null): void {
    const take = f.take;
    if (!take) return;
    f.take = null;
    this.removeOwn(f.side, 'echo');
    const vx = f.seenX - take.x;
    const vz = f.seenZ - take.z;
    const vl = Math.hypot(vx, vz) || 1;
    const o = this.add({ ...this.base('echo', f, take.x, take.z), dirX: vx / vl, dirZ: vz / vl, stage: 'aim', total: CARD_TUNING.second_take.aim, combo });
    o.variant = Math.max(0, TAKE_CARDS.indexOf(take.card));
  }

  /** FREEZE FRAME (Alpha 1.6.1): a time-distortion ring around the fighter that moves with them (one per side). */
  spawnFreeze(f: FighterSim): void {
    const t = CARD_TUNING.freeze_frame;
    this.removeOwn(f.side, 'freeze');
    this.add({ ...this.base('freeze', f, f.x, f.z), radius: t.radius, total: t.duration });
  }

  // --------------------------------------------------------------- combos
  /** TIME SLIP: the slow-motion ring lasts a little longer. */
  extendFreeze(side: Side, secs: number): void {
    const o = this.own(side, 'freeze');
    if (!o) return;
    o.total += secs;
    this.m.emit({ type: 'object', id: o.id, kind: 'freeze', owner: side, what: 'land', x: o.x, z: o.z });
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
   * Speed factor for a projectile this step (FREEZE FRAME, Alpha 1.6.1). Inside a fighter's
   * ring the opponent's regular shots that are heading in — towards the fighter — crawl. The
   * fighter's own shots are never slowed; the champion's shots and heavy card shots neither.
   */
  freezeScale(p: Projectile): number {
    if (!FREEZABLE.has(p.kind) || (this.m.boss && p.owner === 1)) return 1;
    for (const o of this.list) {
      if (o.kind !== 'freeze' || o.stage !== 'on' || o.owner === p.owner) continue;
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
   * CROSS ANGLE echoes pass their owner's own screen. Returns the screen it hit.
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

  /**
   * Alpha 1.7: the STAGE BARRIER standing on the line (x0, z0) → (x1, z1), if any — a cane strike
   * or a BAT BITE lunge never goes through a screen (whoever's it is; nobody walks into one either).
   */
  barrierOnLine(x0: number, z0: number, x1: number, z1: number, pad: number): StageObject | null {
    const th = CARD_TUNING.stage_barrier.thickness;
    for (const o of this.list) {
      if (o.kind !== 'barrier' || o.stage !== 'on') continue;
      const ax = o.x - o.dirX * o.radius;
      const az = o.z - o.dirZ * o.radius;
      const bx = o.x + o.dirX * o.radius;
      const bz = o.z + o.dirZ * o.radius;
      if (segSegDist(x0, z0, x1, z1, ax, az, bx, bz) <= pad + th) return o;
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
        case 'echo':
          this.updateEcho(o);
          break;
        case 'freeze': {
          // Alpha 1.6.1: the ring travels with its fighter
          const owner = m.fighters[o.owner];
          o.x = owner.x;
          o.z = owner.z;
          if (o.t >= o.total || owner.ko) this.end(o);
          break;
        }
        default:
          // barrier: just a lifetime
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

  /**
   * SECOND TAKE echo: 'aim' (the ghost tracks what its fighter sees of the target), 'lock'
   * (the line freezes — the opponent's cue to step aside), fire, 'retract' (the ghost fades).
   * The locked aim point is kept in fromX / fromZ for the shot.
   */
  private updateEcho(o: StageObject): void {
    const m = this.m;
    const t = CARD_TUNING.second_take;
    const f = m.fighters[o.owner];
    if (o.stage === 'aim') {
      const vx = f.seenX - o.x;
      const vz = f.seenZ - o.z;
      const vl = Math.hypot(vx, vz);
      if (vl > 0.05) {
        o.dirX = vx / vl;
        o.dirZ = vz / vl;
      }
      if (o.t >= o.total) {
        // freeze the aim point, leading the target (CAMERA LOCK: fully)
        const speed = TAKE_CARDS[o.variant] === 'rebound_disc' ? CARD_TUNING.rebound_disc.speed : TAKE_CARDS[o.variant] === 'split_shot' ? CARD_TUNING.split_shot.speed : CARD_TUNING.power_shot.speed;
        const k = o.combo === 'camera_lock' ? COMBO_TUNING.cameraLockLead : t.lead;
        const time = (t.lock + vl / speed) * k;
        const p = this.onFloor(f.seenX + f.seenVX * time, f.seenZ + f.seenVZ * time, 0);
        o.fromX = p.x;
        o.fromZ = p.z;
        m.combat.echoAim(o);
        o.stage = 'lock';
        o.t = 0;
        o.total = t.lock;
        m.emit({ type: 'object', id: o.id, kind: 'echo', owner: o.owner, what: 'lock', x: o.x, z: o.z });
      }
      return;
    }
    if (o.stage === 'lock') {
      if (o.t < o.total) return;
      o.stage = 'retract';
      o.t = 0;
      o.total = t.retract;
      if (m.phase === 'fight' && !f.ko) m.combat.fireEcho(f, o);
      m.emit({ type: 'object', id: o.id, kind: 'echo', owner: o.owner, what: 'fire', x: o.x, z: o.z });
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
