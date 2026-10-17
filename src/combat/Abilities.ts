import { ARENA, CARD_TUNING, COMBO_TUNING, type CutTuning } from '../config/balance';
import type { CardId, ComboDef } from '../config/types';
import { clampRoundedRect, type ClampResult } from '../core/math';
import { lineReach, type BankSolution } from './CombatSystem';
import type { CutAction, FighterSim, RushAction, WindupAction } from './FighterSim';
import type { Match } from './Match';

const tmp: ClampResult = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };
const bank: BankSolution = { dirX: 0, dirZ: 1, bx: 0, bz: 0, bounce: false, len1: 0, len2: 0 };
const aim = { x: 0, z: 0 };

/** Alpha 1.6: the new cards announce their activation (gesture + sound in the view). */
const CAST_CARDS = new Set<CardId>([
  'spotlight_tag',
  'split_shot',
  'rebound_disc',
  'prop_drop',
  'pulse_push',
  'gravity_net',
  'pressure_mine',
  'stage_barrier',
  'cable_snare',
  'holo_decoy',
  'frame_catch',
  'backtrack',
  'high_stakes',
  'side_cam',
  'freeze_frame',
]);

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
    if (CAST_CARDS.has(card)) m.emit({ type: 'cast', side: f.side, card });
    switch (card) {
      case 'dash': {
        const t = CARD_TUNING.dash;
        let dir = this.chooseDashDir(f, foe);
        let dist: number = t.distance;
        const fromX = f.x;
        const fromZ = f.z;
        if (comboId === 'phantom_step') m.spawnDecoy(f, COMBO_TUNING.phantomDecoyTime);
        // Alpha 1.6 BACKSTAGE: the dash ends behind the fighter's own barrier
        const screen = comboId === 'backstage' ? m.objects.own(f.side, 'barrier') : null;
        if (screen) {
          const bx = screen.x - foe.x;
          const bz = screen.z - foe.z;
          const bl = Math.hypot(bx, bz) || 1;
          const hx = screen.x + (bx / bl) * 1.1 - f.x;
          const hz = screen.z + (bz / bl) * 1.1 - f.z;
          const hl = Math.hypot(hx, hz);
          if (hl > 0.4) {
            dir = { x: hx / hl, z: hz / hl };
            dist = Math.min(dist, hl);
          }
        }
        // Alpha 1.6 TIME SLIP: a longer dash out of the slow-motion zone
        if (comboId === 'time_slip') dist *= COMBO_TUNING.timeSlipDist;
        // Alpha 1.6 CATCH & RELEASE: the caught shot is fired back when the dash lands
        if (comboId === 'catch_release' && f.caught > 0) {
          f.releaseDmg = Math.min(f.caughtDmg * COMBO_TUNING.releaseShare, COMBO_TUNING.releaseCap);
          f.caught = 0;
        }
        f.action = { kind: 'dash', t: 0, total: t.duration, dirX: dir.x, dirZ: dir.z, speed: dist / t.duration, style: f.def.dashStyle };
        f.invuln = Math.max(f.invuln, t.invuln);
        f.lastDash = m.time;
        f.counterShots = f.stats.attack.alternate ? 2 : 1;
        f.counterT = t.counterWindow;
        f.readDash =
          foe.action.kind === 'windup' ||
          foe.action.kind === 'rush' ||
          foe.action.kind === 'cut' ||
          m.projectiles.some((p) => p.owner !== f.side && p.heavy && p.alive);
        f.stun = 0;
        clampRoundedRect(fromX + dir.x * dist, fromZ + dir.z * dist, ARENA.halfX, ARENA.halfZ, ARENA.cornerRadius, tmp);
        if (comboId === 'time_slip') m.objects.moveFreeze(f.side, tmp.x, tmp.z);
        m.emit({ type: 'dash', side: f.side, fromX, fromZ, toX: tmp.x, toZ: tmp.z, style: f.def.dashStyle });
        break;
      }
      case 'power_shot':
      case 'charged_shot':
      case 'bank_shot':
      case 'knockout': {
        const t =
          card === 'power_shot' ? CARD_TUNING.power_shot : card === 'charged_shot' ? CARD_TUNING.charged_shot : card === 'bank_shot' ? CARD_TUNING.bank_shot : CARD_TUNING.knockout;
        const telegraph = f.side === 1;
        const total = telegraph ? t.telegraph * m.difficulty.telegraphMult : t.windup;
        // Alpha 1.6: charged attacks aim at the real fighter (a HOLO DECOY only fools regular fire)
        m.combat.windupAim(f, card, comboId, aim);
        let dx = aim.x - f.x;
        let dz = aim.z - f.z;
        if (card === 'bank_shot') {
          // the line points at the bounce point on the barrier, not at the target
          m.combat.bankAim(f, bank, comboId === 'spotlight' ? COMBO_TUNING.spotlightLead : 0.85);
          dx = bank.dirX;
          dz = bank.dirZ;
        }
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
      case 'directors_cut': {
        // raised-rifle pose and the alert first; the three lines follow (updateCut)
        const t = this.cutTuning();
        const empowered = t !== CARD_TUNING.directors_cut;
        const dx = f.aimX - f.x;
        const dz = f.aimZ - f.z;
        const d = Math.hypot(dx, dz) || 1;
        f.action = { kind: 'cut', stage: 'prep', shot: 0, t: 0, total: t.prep, dirX: dx / d, dirZ: dz / d, lockedAt: -1, inLaneAtLock: false, tune: t, empowered };
        f.cutCd = t.cooldown + this.cutLength(t);
        m.emit({ type: 'cutStart', side: f.side, prep: t.prep, empowered });
        break;
      }
      case 'false_start': {
        // a short feint step sideways (no invulnerability) and the read window
        const t = CARD_TUNING.false_start;
        const mult = comboId === 'superstar' ? COMBO_TUNING.superstarMult : 1;
        const dir = this.chooseDashDir(f, foe);
        f.action = { kind: 'feint', t: 0, total: t.duration, dirX: dir.x, dirZ: dir.z, speed: t.distance / t.duration };
        f.feint = t.window * (mult > 1 ? 1.2 : 1);
        f.feintMult = mult;
        m.emit({ type: 'feint', side: f.side, x: f.x, z: f.z, dx: dir.x, dz: dir.z, window: f.feint });
        break;
      }
      case 'shield': {
        const t = CARD_TUNING.shield;
        f.shield = t.duration;
        // Alpha 1.6 INSURANCE (HIGH STAKES → SHIELD): a sturdier dome
        f.shieldHp = t.absorb + (comboId === 'insurance' ? COMBO_TUNING.insuranceAbsorb : 0);
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
        // Alpha 1.5.5: a rival with a control profile (Zoe) charges a visible bolt instead of an instant hit
        const ctl = f.side === 1 ? m.rival.mods?.control : undefined;
        if (ctl && ctl.shockCharge > 0) {
          f.zap = ctl.shockCharge;
          f.zapCombo = comboId;
          m.emit({ type: 'zapCharge', side: f.side, duration: ctl.shockCharge });
          break;
        }
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
        // Alpha 1.6 ALL IN (HIGH STAKES → OVERDRIVE): a little longer
        f.overdrive = t.duration * (iron ? COMBO_TUNING.ironRushDurationMult : 1) + (comboId === 'all_in' ? COMBO_TUNING.allInTime : 0);
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
        target.glitch = t.duration * mult * (target.side === 1 && m.boss ? m.boss.def.poise.glitchMult : 1);
        target.glitchDot = t.dotInterval;
        if (target.action.kind === 'windup' || target.action.kind === 'cut') {
          m.emit({ type: 'interrupt', side: target.side, by: f.side });
          f.m.perfects++;
          this.cancelCut(target);
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

      // ------------------------------------------------- Alpha 1.6 — CARD REVOLUTION
      case 'spotlight_tag': {
        // the spotlight finds what the fighter can see: not a DASH in the air, not someone in their own smoke
        const t = CARD_TUNING.spotlight_tag;
        const hit = !foe.ko && foe.invuln <= 0 && !m.inOwnSmoke(foe);
        if (hit) {
          foe.tag = t.duration;
          foe.tagBy = f.side;
        }
        m.emit({ type: 'tag', side: f.side, target: foe.side, hit, duration: hit ? t.duration : 0 });
        break;
      }
      case 'split_shot':
        m.combat.fireSplit(f, comboId === 'tight_spread');
        break;
      case 'rebound_disc':
        m.combat.fireDisc(f, comboId);
        break;
      case 'prop_drop':
        m.objects.spawnProp(f, comboId);
        break;
      case 'pulse_push':
        m.combat.pulsePush(f, foe, comboId);
        break;
      case 'gravity_net':
        m.objects.spawnNet(f, comboId);
        break;
      case 'pressure_mine':
        m.objects.spawnMine(f, comboId);
        break;
      case 'stage_barrier':
        m.objects.spawnBarrier(f);
        break;
      case 'cable_snare':
        m.combat.fireCable(f);
        break;
      case 'holo_decoy':
        m.spawnHolo(f, foe);
        break;
      case 'frame_catch': {
        const t = CARD_TUNING.frame_catch;
        f.frame = t.duration;
        m.emit({ type: 'frame', side: f.side, duration: t.duration });
        break;
      }
      case 'backtrack':
        this.backtrack(f, comboId);
        break;
      case 'high_stakes':
        this.highStakes(f, comboId);
        break;
      case 'side_cam':
        m.objects.spawnCam(f, comboId);
        break;
      case 'freeze_frame':
        m.objects.spawnFreeze(f);
        break;
    }
  }

  /**
   * Alpha 1.6 — BACKTRACK: glide back to where the fighter stood `lookback` s ago (on the
   * floor, never through the barrier). No invulnerability, no health back. DOUBLE TAKE leaves
   * a phantom where the DASH ended; REWIND TRAP arms the fighter's mines; REPLAY erases the
   * opponent's projectiles stuck in the fighter's freeze zone.
   */
  private backtrack(f: FighterSim, combo: string | null): void {
    const m = this.m;
    const t = CARD_TUNING.backtrack;
    const n = f.hist.length / 2;
    let tx = f.x;
    let tz = f.z;
    if (n > 0) {
      const i = Math.max(0, n - 1 - Math.round(t.lookback / t.sample));
      tx = f.hist[i * 2];
      tz = f.hist[i * 2 + 1];
    }
    clampRoundedRect(tx, tz, ARENA.halfX, ARENA.halfZ, ARENA.cornerRadius, tmp);
    tx = tmp.x;
    tz = tmp.z;
    if (combo === 'double_take') m.spawnDecoy(f, COMBO_TUNING.doubleTakeTime);
    if (combo === 'rewind_trap') m.objects.armMines(f.side);
    if (combo === 'replay') m.objects.erase(f.side);
    const dx = tx - f.x;
    const dz = tz - f.z;
    const d = Math.hypot(dx, dz);
    m.emit({ type: 'rewind', side: f.side, fromX: f.x, fromZ: f.z, toX: tx, toZ: tz, duration: t.duration });
    f.action = { kind: 'rewind', t: 0, total: t.duration, dirX: d > 0.01 ? dx / d : 0, dirZ: d > 0.01 ? dz / d : 0, speed: d / t.duration };
  }

  /** Alpha 1.6 — HIGH STAKES: health for energy (rules in Match.cardRules keep it safe and rare). */
  private highStakes(f: FighterSim, combo: string | null): void {
    const m = this.m;
    const t = CARD_TUNING.high_stakes;
    const cost = Math.round(f.maxHp * t.hpCost * (combo === 'safe_bet' ? COMBO_TUNING.safeBetCost : 1));
    f.hp = Math.max(1, f.hp - cost);
    if (combo === 'safe_bet') f.caught = 0;
    m.hands[f.side].gain(t.energy);
    f.stakesCd = t.cooldown;
    f.stakesUses++;
    m.emit({ type: 'stakes', side: f.side, hp: cost, energy: t.energy });
  }

  /** Called when a windup finishes. */
  release(f: FighterSim, a: WindupAction): void {
    const m = this.m;
    f.action = { kind: 'none' };
    m.emit({ type: 'release', side: f.side, card: a.card });
    let dirX = a.dirX;
    let dirZ = a.dirZ;
    if (!a.locked) {
      m.combat.windupAim(f, a.card, a.combo, aim);
      const dx = aim.x - f.x;
      const dz = aim.z - f.z;
      const d = Math.hypot(dx, dz) || 1;
      dirX = dx / d;
      dirZ = dz / d;
    }
    let mult = 1;
    if (a.combo === 'counter_strike') mult = COMBO_TUNING.counterStrikeMult;
    else if (a.combo === 'electro_blast') mult = COMBO_TUNING.electroBlastMult;
    else if (a.combo === 'superstar') mult = COMBO_TUNING.superstarMult;
    else if (a.combo === 'jackpot') mult = COMBO_TUNING.jackpotMult;

    if (a.card === 'bank_shot') {
      // re-solve the bank path from where Kai stands now (the AI's telegraph keeps its locked line)
      if (!a.locked) {
        m.combat.bankAim(f, bank, a.combo === 'spotlight' ? COMBO_TUNING.spotlightLead : 0.85);
        dirX = bank.dirX;
        dirZ = bank.dirZ;
      } else {
        dirX = a.dirX;
        dirZ = a.dirZ;
      }
      m.combat.fireBank(f, dirX, dirZ, CARD_TUNING.bank_shot.damage * mult * f.outgoingDamageMult(), {
        crit: a.combo !== null,
        electric: a.combo === 'electro_blast',
        stun: a.combo === 'electro_blast' ? COMBO_TUNING.electroBlastStun : 0,
        combo: a.combo,
        boost: mult,
      });
      f.fireTimer = Math.max(f.fireTimer, 0.35);
    } else if (a.card === 'power_shot' || a.card === 'charged_shot') {
      const charged = a.card === 'charged_shot';
      const t = charged ? CARD_TUNING.charged_shot : CARD_TUNING.power_shot;
      m.combat.firePower(
        f,
        dirX,
        dirZ,
        t.damage * mult * f.outgoingDamageMult(),
        {
          crit: a.combo !== null,
          electric: a.combo === 'electro_blast',
          stun: a.combo === 'electro_blast' ? COMBO_TUNING.electroBlastStun : 0,
          combo: a.combo,
          boost: mult,
          blind: a.combo === 'blindside',
        },
        charged,
      );
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

  /** DIRECTOR'S CUT numbers: the boss's current phase (FINAL BROADCAST is sharper), else the base tuning. */
  cutTuning(): CutTuning {
    return this.m.boss?.current.cut ?? CARD_TUNING.directors_cut;
  }

  /** Seconds from the card to the end of the recovery (the cooldown runs after that). */
  cutLength(t: CutTuning): number {
    return t.prep + t.aim[0] + t.aim[1] + t.aim[2] + t.lock[0] + t.lock[1] + t.lock[2] + t.gap * 2 + t.recover;
  }

  /**
   * Where the line goes during 'aim': at what the champion sees of the target. When it
   * freezes it leads the target's current motion by `lead` seconds — a fighter that keeps
   * running the same way walks into it, one that turns or DASHes does not.
   */
  private cutDir(f: FighterSim, a: CutAction, lead: number): void {
    const tx = f.seenX + f.seenVX * lead;
    const tz = f.seenZ + f.seenVZ * lead;
    const dx = tx - f.x;
    const dz = tz - f.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    a.dirX = dx / d;
    a.dirZ = dz / d;
  }

  /**
   * The one hit test of a DIRECTOR'S CUT shot: the rectangle that is drawn on the floor.
   * Origin = the champion, along the frozen direction, `length` long; a body counts as
   * inside when its centre is within halfWidth + half its radius of the centre line.
   */
  inCutLane(f: FighterSim, dirX: number, dirZ: number, halfWidth: number, length: number, x: number, z: number, r: number): number {
    const rx = x - f.x;
    const rz = z - f.z;
    const along = rx * dirX + rz * dirZ;
    const perp = Math.abs(rx * dirZ - rz * dirX);
    if (along < -r * 0.5 || along > length + r * 0.5 || perp > halfWidth + r * 0.5) return -1;
    return along;
  }

  /** Advances DIRECTOR'S CUT (called every fight step while the action runs). */
  updateCut(f: FighterSim, foe: FighterSim, a: CutAction, dt: number): void {
    const m = this.m;
    const t = a.tune;
    a.t += dt;
    switch (a.stage) {
      case 'prep':
        this.cutDir(f, a, 0);
        if (a.t >= a.total) this.cutNextLine(f, a, 0);
        break;
      case 'aim':
        this.cutDir(f, a, 0);
        if (a.t >= a.total) {
          // freeze: lead the target's motion, plus the champion's (small) aim error
          this.cutDir(f, a, t.lead);
          const err = m.rng.range(-1, 1) * m.difficulty.aimError * 0.5;
          if (err !== 0) {
            const c = Math.cos(err);
            const s = Math.sin(err);
            const x = a.dirX * c - a.dirZ * s;
            a.dirZ = a.dirX * s + a.dirZ * c;
            a.dirX = x;
          }
          a.stage = 'lock';
          a.t = 0;
          a.total = t.lock[a.shot];
          a.lockedAt = m.time;
          a.inLaneAtLock = !foe.ko && this.inCutLane(f, a.dirX, a.dirZ, t.halfWidth[a.shot], t.length[a.shot], foe.x, foe.z, foe.radius) >= 0;
          f.facing = Math.atan2(a.dirX, a.dirZ);
          m.emit({ type: 'cutLock', side: f.side, shot: a.shot, dx: a.dirX, dz: a.dirZ, lock: a.total, empowered: a.empowered });
        }
        break;
      case 'lock':
        if (a.t >= a.total) {
          this.fireCut(f, foe, a);
          if (f.action !== a) return; // the shot ended the match
          if (a.shot >= 2) {
            m.emit({ type: 'cutEnd', side: f.side, completed: true });
            f.action = { kind: 'recover', t: 0, total: t.recover };
            f.fireTimer = Math.max(f.fireTimer, t.recover * 0.6);
          } else {
            a.stage = 'gap';
            a.t = 0;
            a.total = t.gap;
          }
        }
        break;
      case 'gap':
        if (a.t >= a.total) this.cutNextLine(f, a, a.shot + 1);
        break;
    }
  }

  private cutNextLine(f: FighterSim, a: CutAction, shot: number): void {
    const t = a.tune;
    a.stage = 'aim';
    a.shot = shot;
    a.t = 0;
    a.total = t.aim[shot];
    a.inLaneAtLock = false;
    this.cutDir(f, a, 0);
    this.m.emit({ type: 'cutAim', side: f.side, shot, aim: a.total, lock: t.lock[shot], halfWidth: t.halfWidth[shot], length: t.length[shot], empowered: a.empowered });
  }

  /** One shot along the frozen line: resolved once, at this instant, against the drawn rectangle. */
  private fireCut(f: FighterSim, foe: FighterSim, a: CutAction): void {
    const m = this.m;
    const t = a.tune;
    const i = a.shot;
    const w = t.halfWidth[i];
    // the line ends at the barrier (the view clips the drawn line the same way)
    const len = lineReach(f.x, f.z, a.dirX, a.dirZ, t.length[i]);
    if (len < t.length[i]) m.hitProps(f.x + a.dirX * len, f.z + a.dirZ * len, true);
    const final = i === 2;
    let outcome: 'hit' | 'blocked' | 'dodged' | 'miss' | 'decoy' = 'miss';
    let end = len;
    const foeAlong = foe.ko ? -1 : this.inCutLane(f, a.dirX, a.dirZ, w, len, foe.x, foe.z, foe.radius);
    // a hologram decoy standing in the line in front of the target takes the shot
    let decoyAlong = Infinity;
    let decoy = null;
    for (const d of m.decoys) {
      if (!d.alive || d.owner === f.side || d.kind !== 'phantom') continue;
      const al = this.inCutLane(f, a.dirX, a.dirZ, w, len, d.x, d.z, 0.5);
      if (al >= 0 && al < decoyAlong) {
        decoyAlong = al;
        decoy = d;
      }
    }
    if (decoy && (foeAlong < 0 || decoyAlong < foeAlong)) {
      m.popDecoy(decoy);
      outcome = 'decoy';
      end = decoyAlong;
    } else if (foeAlong >= 0) {
      if (foe.invuln > 0) {
        outcome = 'dodged';
        foe.m.perfects++;
        m.emit({ type: 'dodge', side: foe.side, x: foe.x, z: foe.z, perfect: true, heavy: true });
        m.combat.onEvade(foe);
      } else {
        const r = m.combat.applyHit(foe, f, {
          damage: t.damage[i] * f.outgoingDamageMult(),
          kind: 'cut',
          heavy: true,
          crit: final,
          electric: false,
          combo: null,
          knockback: t.knockback[i],
          stun: t.stun[i],
          slowAmount: 0,
          slowDuration: 0,
          dx: a.dirX,
          dz: a.dirZ,
          sure: true,
          projectile: null,
        });
        outcome = r === 'hit' ? 'hit' : r === 'blocked' ? 'blocked' : r === 'dodged' ? 'dodged' : 'miss';
        // the beam stops on the body or the shield it struck
        if (outcome === 'hit' || outcome === 'blocked') end = Math.min(len, foeAlong);
      }
    } else if (!foe.ko && a.inLaneAtLock && foe.lastDash >= a.lockedAt) {
      // stepped out of the frozen line with a DASH: a read
      outcome = 'dodged';
      foe.m.perfects++;
      m.emit({ type: 'dodge', side: foe.side, x: foe.x, z: foe.z, perfect: true, heavy: true });
      m.combat.onEvade(foe);
    }
    f.facing = Math.atan2(a.dirX, a.dirZ);
    m.emit({
      type: 'cutShot',
      side: f.side,
      shot: i,
      x: f.x,
      z: f.z,
      ex: f.x + a.dirX * end,
      ez: f.z + a.dirZ * end,
      dx: a.dirX,
      dz: a.dirZ,
      halfWidth: w,
      outcome,
      final,
      empowered: a.empowered,
    });
  }

  /** Calls off a running DIRECTOR'S CUT (interrupt, phase change, KO, match end). Safe to call any time. */
  cancelCut(f: FighterSim): void {
    if (f.action.kind !== 'cut') return;
    f.action = { kind: 'none' };
    this.m.emit({ type: 'cutEnd', side: f.side, completed: false });
  }

  updateRush(f: FighterSim, foe: FighterSim, a: RushAction): void {
    const m = this.m;
    const t = CARD_TUNING.knockout;
    // Decoys absorb the charge (a HOLO DECOY does not: the charge is aimed at the real fighter).
    for (const d of m.decoys) {
      if (d.alive && d.kind === 'phantom' && d.owner !== f.side && Math.hypot(d.x - f.x, d.z - f.z) < t.hitRange) {
        m.popDecoy(d);
      }
    }
    const dist = Math.hypot(foe.x - f.x, foe.z - f.z);
    if (!foe.ko && dist < t.hitRange && !a.feinted) {
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
        const r = m.combat.applyHit(foe, f, {
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
          boost: mult,
        });
        if (r === 'dodged') {
          // FALSE START read the charge: it rushes on past her
          a.feinted = true;
          a.dodged = true;
        } else {
          f.action = { kind: 'recover', t: 0, total: 0.25 };
          f.vx *= 0.2;
          f.vz *= 0.2;
          return;
        }
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
      if (fa.kind === 'windup' || fa.kind === 'rush' || fa.kind === 'cut') {
        const perp = Math.abs(c.x * fa.dirZ - c.z * fa.dirX);
        score += perp * 3;
      }
      // DIRECTOR'S CUT: never land back inside the frozen line
      if (fa.kind === 'cut' && fa.stage === 'lock' && this.inCutLane(foe, fa.dirX, fa.dirZ, fa.tune.halfWidth[fa.shot], fa.tune.length[fa.shot], tmp.x, tmp.z, f.radius) >= 0) score -= 8;
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
