import { ARENA, CARD_TUNING, COMBO_TUNING } from '../config/balance';
import type { CardId, ComboDef } from '../config/types';
import { clampRoundedRect, type ClampResult } from '../core/math';
import type { FighterSim, RushAction, WindupAction } from './FighterSim';
import type { Match } from './Match';

const tmp: ClampResult = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };

/** Card effects. Every card changes the simulation state — nothing is cosmetic only. */
export class Abilities {
  private m: Match;
  constructor(m: Match) {
    this.m = m;
  }

  execute(f: FighterSim, card: CardId, combo: ComboDef | null): void {
    const m = this.m;
    const foe = m.foe(f.side);
    const comboId = combo?.id ?? null;
    switch (card) {
      case 'dash': {
        const t = CARD_TUNING.dash;
        const dir = this.chooseDashDir(f, foe);
        const fromX = f.x;
        const fromZ = f.z;
        if (comboId === 'phantom_step') m.spawnDecoy(f, COMBO_TUNING.phantomDecoyTime);
        f.action = { kind: 'dash', t: 0, total: t.duration, dirX: dir.x, dirZ: dir.z, speed: t.distance / t.duration, style: f.def.dashStyle };
        f.invuln = Math.max(f.invuln, t.invuln);
        f.lastDash = m.time;
        f.readDash =
          foe.action.kind === 'windup' ||
          foe.action.kind === 'rush' ||
          m.projectiles.some((p) => p.owner !== f.side && p.heavy && p.alive);
        f.stun = 0;
        clampRoundedRect(fromX + dir.x * t.distance, fromZ + dir.z * t.distance, ARENA.halfX, ARENA.halfZ, ARENA.cornerRadius, tmp);
        m.emit({ type: 'dash', side: f.side, fromX, fromZ, toX: tmp.x, toZ: tmp.z, style: f.def.dashStyle });
        break;
      }
      case 'power_shot':
      case 'knockout': {
        const t = card === 'power_shot' ? CARD_TUNING.power_shot : CARD_TUNING.knockout;
        const telegraph = f.side === 1;
        const total = telegraph ? t.telegraph * m.difficulty.telegraphMult : t.windup;
        const dx = f.aimX - f.x;
        const dz = f.aimZ - f.z;
        const d = Math.hypot(dx, dz) || 1;
        f.action = {
          kind: 'windup',
          card,
          t: 0,
          total,
          lockAt: telegraph ? t.lockAt : 1,
          locked: false,
          dirX: dx / d,
          dirZ: dz / d,
          combo: comboId,
          telegraph,
        };
        m.emit({ type: 'telegraph', side: f.side, card, duration: total, lockAt: telegraph ? t.lockAt : 1, player: !telegraph });
        break;
      }
      case 'shield': {
        const t = CARD_TUNING.shield;
        f.shield = t.duration;
        f.shieldHp = t.absorb;
        f.shieldAbsorbed = 0;
        m.emit({ type: 'shieldUp', side: f.side });
        break;
      }
      case 'smoke': {
        m.spawnSmoke(f);
        break;
      }
      case 'shock': {
        const t = CARD_TUNING.shock;
        const target = foe;
        if (target.invuln > 0) {
          m.emit({ type: 'shock', side: f.side, fromX: f.x, fromZ: f.z, toX: target.x, toZ: target.z, hit: false });
          target.m.perfects++;
          m.emit({ type: 'dodge', side: target.side, x: target.x, z: target.z, perfect: true, heavy: true });
          m.combat.onEvade(target);
          break;
        }
        let stun: number = t.stun;
        if (target.shield > 0) {
          target.shield = 0;
          target.shieldHp = 0;
          m.emit({ type: 'shieldBreak', side: target.side, x: target.x, z: target.z });
          stun = t.shieldStun;
        }
        m.emit({ type: 'shock', side: f.side, fromX: f.x, fromZ: f.z, toX: target.x, toZ: target.z, hit: true });
        const dx = target.x - f.x;
        const dz = target.z - f.z;
        const d = Math.hypot(dx, dz) || 1;
        m.combat.applyHit(target, f, {
          damage: t.damage * f.outgoingDamageMult(),
          kind: 'shock',
          heavy: false,
          crit: false,
          electric: true,
          combo: comboId,
          knockback: 0,
          stun: 0,
          slowAmount: 0,
          slowDuration: 0,
          dx: dx / d,
          dz: dz / d,
          sure: true,
          projectile: null,
        });
        m.combat.applyStun(target, stun, f.side);
        break;
      }
      case 'overdrive': {
        const t = CARD_TUNING.overdrive;
        const iron = comboId === 'iron_rush';
        f.overdrive = t.duration * (iron ? COMBO_TUNING.ironRushDurationMult : 1);
        m.emit({ type: 'buff', side: f.side, buff: 'overdrive', duration: f.overdrive });
        if (iron) {
          f.shield = 0;
          f.shieldHp = 0;
          const dx = foe.x - f.x;
          const dz = foe.z - f.z;
          const d = Math.hypot(dx, dz) || 1;
          const hit = d < COMBO_TUNING.ironRushRadius && !foe.ko;
          m.emit({ type: 'shieldBurst', side: f.side, x: f.x, z: f.z, hit });
          if (hit) {
            m.combat.applyHit(foe, f, {
              damage: COMBO_TUNING.ironRushDamage * f.outgoingDamageMult(),
              kind: 'burst',
              heavy: true,
              crit: true,
              electric: false,
              combo: comboId,
              knockback: COMBO_TUNING.ironRushKnockback,
              stun: 0,
              slowAmount: 0,
              slowDuration: 0,
              dx: dx / d,
              dz: dz / d,
              sure: true,
              projectile: null,
            });
          }
        }
        break;
      }
      case 'adrenaline': {
        const t = CARD_TUNING.adrenaline;
        const mult = comboId === 'superstar' ? COMBO_TUNING.superstarMult : 1;
        f.adrenalineMult = mult;
        f.adrenalineShots = Math.round(t.shots * mult);
        f.adrenaline = t.duration * mult + 0.3;
        f.adrenalineTimer = 0;
        m.emit({ type: 'buff', side: f.side, buff: 'adrenaline', duration: f.adrenaline });
        break;
      }
      case 'system_overload': {
        const t = CARD_TUNING.system_overload;
        const target = foe;
        if (target.invuln > 0) {
          m.emit({ type: 'overload', side: f.side, x: target.x, z: target.z, hit: false });
          target.m.perfects++;
          m.emit({ type: 'dodge', side: target.side, x: target.x, z: target.z, perfect: true, heavy: true });
          m.combat.onEvade(target);
          break;
        }
        const mult = comboId === 'superstar' ? COMBO_TUNING.superstarMult : 1;
        if (target.shield > 0) {
          target.shield = 0;
          target.shieldHp = 0;
          m.emit({ type: 'shieldBreak', side: target.side, x: target.x, z: target.z });
        }
        target.glitch = t.duration * mult;
        target.glitchDot = t.dotInterval;
        if (target.action.kind === 'windup') {
          m.emit({ type: 'interrupt', side: target.side, by: f.side });
          f.m.perfects++;
          target.action = { kind: 'none' };
        }
        target.overdrive = 0;
        m.hands[target.side].drain(t.energyDrain * mult);
        m.emit({ type: 'overload', side: f.side, x: target.x, z: target.z, hit: true });
        const dx = target.x - f.x;
        const dz = target.z - f.z;
        const d = Math.hypot(dx, dz) || 1;
        m.combat.applyHit(target, f, {
          damage: t.damage * mult * f.outgoingDamageMult(),
          kind: 'overload',
          heavy: true,
          crit: mult > 1,
          electric: true,
          combo: comboId,
          knockback: 0,
          stun: 0,
          slowAmount: 0,
          slowDuration: 0,
          dx: dx / d,
          dz: dz / d,
          sure: true,
          projectile: null,
        });
        break;
      }
    }
  }

  /** Called when a windup finishes. */
  release(f: FighterSim, a: WindupAction): void {
    const m = this.m;
    f.action = { kind: 'none' };
    m.emit({ type: 'release', side: f.side, card: a.card });
    let dirX = a.dirX;
    let dirZ = a.dirZ;
    if (!a.locked) {
      const dx = f.aimX - f.x;
      const dz = f.aimZ - f.z;
      const d = Math.hypot(dx, dz) || 1;
      dirX = dx / d;
      dirZ = dz / d;
    }
    let mult = 1;
    if (a.combo === 'counter_strike') mult = COMBO_TUNING.counterStrikeMult;
    else if (a.combo === 'electro_blast') mult = COMBO_TUNING.electroBlastMult;
    else if (a.combo === 'superstar') mult = COMBO_TUNING.superstarMult;

    if (a.card === 'power_shot') {
      const t = CARD_TUNING.power_shot;
      m.combat.firePower(f, dirX, dirZ, t.damage * mult * f.outgoingDamageMult(), {
        crit: a.combo !== null,
        electric: a.combo === 'electro_blast',
        stun: a.combo === 'electro_blast' ? COMBO_TUNING.electroBlastStun : 0,
        combo: a.combo,
      });
      f.fireTimer = Math.max(f.fireTimer, 0.35);
    } else {
      const t = CARD_TUNING.knockout;
      const rush: RushAction = {
        kind: 'rush',
        t: 0,
        total: t.rushDistance / t.rushSpeed,
        dirX,
        dirZ,
        speed: t.rushSpeed,
        combo: a.combo,
        dodged: false,
      };
      f.action = rush;
      f.facing = Math.atan2(dirX, dirZ);
      m.emit({ type: 'rush', side: f.side, x: f.x, z: f.z, dx: dirX, dz: dirZ });
    }
  }

  updateRush(f: FighterSim, foe: FighterSim, a: RushAction): void {
    const m = this.m;
    const t = CARD_TUNING.knockout;
    // Decoys absorb the charge.
    for (const d of m.decoys) {
      if (d.alive && d.owner !== f.side && Math.hypot(d.x - f.x, d.z - f.z) < t.hitRange) {
        m.popDecoy(d);
      }
    }
    const dist = Math.hypot(foe.x - f.x, foe.z - f.z);
    if (!foe.ko && dist < t.hitRange) {
      if (foe.invuln > 0) {
        if (!a.dodged) {
          a.dodged = true;
          foe.m.perfects++;
          m.emit({ type: 'dodge', side: foe.side, x: foe.x, z: foe.z, perfect: true, heavy: true });
          m.combat.onEvade(foe);
        }
      } else {
        let mult = 1;
        if (a.combo === 'counter_strike') mult = COMBO_TUNING.counterStrikeMult;
        else if (a.combo === 'electro_blast') mult = COMBO_TUNING.electroBlastMult;
        else if (a.combo === 'superstar') mult = COMBO_TUNING.superstarMult;
        const dx = foe.x - f.x;
        const dz = foe.z - f.z;
        const d = Math.hypot(dx, dz) || 1;
        // Push direction blends charge direction and contact normal.
        let kx = a.dirX * 0.6 + (dx / d) * 0.4;
        let kz = a.dirZ * 0.6 + (dz / d) * 0.4;
        const kl = Math.hypot(kx, kz) || 1;
        kx /= kl;
        kz /= kl;
        m.combat.applyHit(foe, f, {
          damage: t.damage * mult * f.outgoingDamageMult(),
          kind: 'knockout',
          heavy: true,
          crit: a.combo !== null,
          electric: a.combo === 'electro_blast',
          combo: a.combo,
          knockback: t.knockback * (a.combo === 'superstar' ? 1.25 : 1),
          stun: t.stun + (a.combo === 'electro_blast' ? COMBO_TUNING.electroBlastStun : 0),
          slowAmount: 0,
          slowDuration: 0,
          dx: kx,
          dz: kz,
          sure: true,
          projectile: null,
        });
        f.action = { kind: 'recover', t: 0, total: 0.25 };
        f.vx *= 0.2;
        f.vz *= 0.2;
        return;
      }
    }
    if (a.t >= a.total) {
      if (!foe.ko && foe.readDash && m.time - foe.lastDash < 1.0 && !a.dodged) {
        foe.m.perfects++;
        m.emit({ type: 'dodge', side: foe.side, x: foe.x, z: foe.z, perfect: true, heavy: true });
        m.combat.onEvade(foe);
      }
      m.emit({ type: 'whiff', side: f.side, x: f.x, z: f.z });
      f.action = { kind: 'recover', t: 0, total: t.missRecover };
    }
  }

  /** Pick the safest sideways dash: away from incoming fire and telegraphed lines. */
  chooseDashDir(f: FighterSim, foe: FighterSim): { x: number; z: number } {
    const m = this.m;
    const dx = foe.x - f.x;
    const dz = foe.z - f.z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d;
    const uz = dz / d;
    const px = -uz;
    const pz = ux;
    const cands = [
      { x: px, z: pz },
      { x: -px, z: -pz },
      { x: px * 0.75 - ux * 0.66, z: pz * 0.75 - uz * 0.66 },
      { x: -px * 0.75 - ux * 0.66, z: -pz * 0.75 - uz * 0.66 },
      { x: px * 0.75 + ux * 0.66, z: pz * 0.75 + uz * 0.66 },
      { x: -px * 0.75 + ux * 0.66, z: -pz * 0.75 + uz * 0.66 },
    ];
    const dist = CARD_TUNING.dash.distance;
    const pref = f.stats.preferredRange;
    let best = cands[0];
    let bestScore = -Infinity;
    for (const c of cands) {
      const l = Math.hypot(c.x, c.z);
      c.x /= l;
      c.z /= l;
      const ex = f.x + c.x * dist;
      const ez = f.z + c.z * dist;
      clampRoundedRect(ex, ez, ARENA.halfX - 0.3, ARENA.halfZ - 0.3, ARENA.cornerRadius, tmp);
      let score = 0;
      // stay on the floor: penalise clamped distance
      score -= Math.hypot(tmp.x - ex, tmp.z - ez) * 3;
      // keep a sensible range
      const nd = Math.hypot(foe.x - tmp.x, foe.z - tmp.z);
      score -= Math.abs(nd - pref) * 0.35;
      if (nd < 1.6) score -= 4;
      // dodge the telegraphed line: prefer perpendicular to the attack direction
      const fa = foe.action;
      if (fa.kind === 'windup' || fa.kind === 'rush') {
        const perp = Math.abs(c.x * fa.dirZ - c.z * fa.dirX);
        score += perp * 3;
      }
      // dodge incoming projectiles
      for (const p of m.projectiles) {
        if (p.owner === f.side) continue;
        const pl = Math.hypot(p.vx, p.vz) || 1;
        const toX = f.x - p.x;
        const toZ = f.z - p.z;
        const along = (toX * p.vx + toZ * p.vz) / pl;
        if (along < 0 || along > 6) continue;
        const w = p.heavy ? 2.5 : 0.4;
        const perp = Math.abs(c.x * (p.vz / pl) - c.z * (p.vx / pl));
        score += perp * w;
      }
      score += m.rng.range(0, 0.15);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }
}
