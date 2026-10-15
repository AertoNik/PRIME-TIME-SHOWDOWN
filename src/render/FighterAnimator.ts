import type { MeshBasicMaterial } from 'three';
import { GAITS, HIT_REACTION, RECOIL, type GaitProfile, type RecoilProfile } from '../config/animation';
import type { CardId, DashStyle, IdleStyle, VictoryStyle } from '../config/types';
import { clamp, clamp01, damp, dampAngle, ease, smoothstep, Spring, TAU, wrapAngle } from '../core/math';
import type { FighterRig } from './FighterModel';
import { toonUniforms } from './materials';

export interface AnimInput {
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  maxSpeed: number;
  combat: boolean;
  action: 'none' | 'windup' | 'dash' | 'rush' | 'recover';
  actionCard: CardId | null;
  actionT: number;
  actionTotal: number;
  dashX: number;
  dashZ: number;
  stunned: boolean;
  knockback: boolean;
  ko: boolean;
  victory: boolean;
  glitch: boolean;
  overdrive: boolean;
}

export function defaultInput(): AnimInput {
  return {
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    facing: 0,
    maxSpeed: 4.5,
    combat: false,
    action: 'none',
    actionCard: null,
    actionT: 0,
    actionTotal: 1,
    dashX: 0,
    dashZ: 1,
    stunned: false,
    knockback: false,
    ko: false,
    victory: false,
    glitch: false,
    overdrive: false,
  };
}

const POSE_KEYS = [
  'bodyY',
  'bodyX',
  'rollRX',
  'rollRZ',
  'hipsRY',
  'hipsRZ',
  'spineRX',
  'spineRY',
  'spineRZ',
  'headRX',
  'headRY',
  'headRZ',
  'shLX',
  'shLZ',
  'elL',
  'shRX',
  'shRZ',
  'elR',
  'legLX',
  'legLZ',
  'kneeL',
  'legRX',
  'legRZ',
  'kneeR',
] as const;
type PoseKey = (typeof POSE_KEYS)[number];
type Pose = Record<PoseKey, number>;

function zeroPose(): Pose {
  const p = {} as Pose;
  for (const k of POSE_KEYS) p[k] = 0;
  return p;
}

/** Callbacks the battle view uses to spawn world effects in sync with animation beats. */
export interface AnimEvents {
  /** A heavy footfall (dust / tiny shake). */
  onStep?: (heavy: boolean) => void;
  /** KO body hits the floor. */
  onLand?: (strength: number) => void;
  /** Victory stomp / flourish beat. */
  onFlourish?: () => void;
}

/**
 * Procedural animation for one fighter rig. Layered: gait-driven locomotion
 * (stride-matched so feet don't skate), idle, weapon aim pose, actions,
 * spring reactions (recoil, hits, stagger), and terminal states (KO /
 * victory). All motion is delta-time based and never feeds back into the
 * simulation.
 */
export class FighterAnimator {
  readonly rig: FighterRig;
  readonly idleStyle: IdleStyle;
  readonly dashStyle: DashStyle;
  readonly victoryStyle: VictoryStyle;
  readonly gait: GaitProfile;
  readonly recoil: RecoilProfile;
  events: AnimEvents = {};

  private t = Math.random() * 10;
  private phase = 0;
  private lastContact = 0;
  private speedN = 0;
  private yaw = 0;
  private prevYaw = 0;
  private yawRate = 0;
  private yawInit = false;
  private aimW = 0;
  private prevVX = 0;
  private prevVZ = 0;
  private accX = 0;
  private accZ = 0;
  private cur = zeroPose();
  private tgt = zeroPose();

  private recoilR: Spring;
  private recoilL: Spring;
  private recoilBody = new Spring(150, 11);
  private hitPitch = new Spring(170, 11);
  private hitRoll = new Spring(170, 11);
  private headSnap = new Spring(320, 14);
  private headRoll = new Spring(320, 14);
  private squash = new Spring(230, 12);
  private shove = new Spring(140, 12);
  private flash = 0;
  private blinkT = 2;
  private blinkDur = 0;
  private mouthT = 0;
  private koT = -1;
  private koYaw = 0;
  private koLanded = 0;
  private victoryT = -1;
  private dashT = -1;
  private dashYaw = 0;
  private dashLanded = false;
  private staggerT = -1;
  private staggerSide = 0;
  private stunAge = 0;
  private lastHitX = 0;
  private lastHitZ = 1;
  private flair = 0;
  private flairT = 4 + Math.random() * 3;
  private glowPulse = 0;
  private spinT = -1;
  private flourishDone = false;
  private weaponBaseR = 0;
  private weaponBaseL = 0;
  /** PRIME OSCILLATOR emitter rings: angular speed, post-pulse cool-down, last action. */
  private ringSpeed = 2;
  private ringCool = 0;
  private prevAction = 'none';

  constructor(rig: FighterRig, idle: IdleStyle, dash: DashStyle, victory: VictoryStyle) {
    this.rig = rig;
    this.idleStyle = idle;
    this.dashStyle = dash;
    this.victoryStyle = victory;
    this.gait = GAITS[idle];
    this.recoil = RECOIL[rig.look.weapon];
    this.recoilR = new Spring(this.recoil.stiffness, this.recoil.damping);
    this.recoilL = new Spring(this.recoil.stiffness, this.recoil.damping);
    this.weaponBaseR = rig.weaponR?.position.y ?? 0;
    this.weaponBaseL = rig.weaponL?.position.y ?? 0;
  }

  reset(yaw: number): void {
    this.koT = -1;
    this.koLanded = 0;
    this.victoryT = -1;
    this.dashT = -1;
    this.spinT = -1;
    this.staggerT = -1;
    this.flash = 0;
    this.flourishDone = false;
    this.yaw = yaw;
    this.prevYaw = yaw;
    this.yawRate = 0;
    this.yawInit = true;
    this.aimW = 0;
    this.accX = this.accZ = 0;
    for (const s of [this.recoilR, this.recoilL, this.recoilBody, this.hitPitch, this.hitRoll, this.headSnap, this.headRoll, this.squash, this.shove]) s.reset();
    this.cur = zeroPose();
    const rig = this.rig;
    rig.body.visible = true;
    rig.koEyes.visible = false;
    rig.eyes.visible = true;
    rig.body.scale.set(1, 1, 1);
    rig.body.position.set(0, 0, 0);
    rig.body.rotation.set(0, 0, 0);
    if (rig.weaponR) rig.weaponR.position.y = this.weaponBaseR;
    if (rig.weaponL) rig.weaponL.position.y = this.weaponBaseL;
    this.ringSpeed = 2;
    this.ringCool = 0;
    this.prevAction = 'none';
    if (rig.spinR) {
      rig.spinR.rotation.z = 0;
      rig.spinR.scale.setScalar(1);
    }
  }

  // ----------------------------------------------------------- triggers
  fire(muzzle: number, heavy: boolean): void {
    const r = this.recoil;
    const k = heavy ? 2.4 : 1;
    if (muzzle === 1) this.recoilL.kick(r.kick * k);
    else this.recoilR.kick(r.kick * k);
    // Two-handed weapons rock both arms (the arm-mounted resonator only its own).
    if (this.rig.look.weapon !== 'twin_blasters' && this.rig.look.weapon !== 'oscillator') this.recoilL.kick(r.kick * 0.6 * k);
    // the resonator's rings flick round on every disc
    if (this.rig.spinR) this.ringSpeed += heavy ? 14 : 7;
    this.recoilBody.kick((r.spine * 60 + (heavy ? 2.5 : 0)) * k);
    if (r.shove > 0 || heavy) this.shove.kick(-(r.shove + (heavy ? 3 : 0)));
    if (heavy) this.squash.kick(-2.5);
    this.glowPulse = heavy ? 1.8 : 0.9;
  }

  hit(dx: number, dz: number, heavy: boolean): void {
    // projectile travel direction in the fighter's local frame
    const s = Math.sin(-this.yaw);
    const c = Math.cos(-this.yaw);
    const lx = dx * c + dz * s;
    const lz = -dx * s + dz * c;
    const k = heavy ? HIT_REACTION.heavy : HIT_REACTION.light;
    this.hitPitch.kick(lz * 7 * k);
    this.hitRoll.kick(-lx * 6 * k);
    this.headSnap.kick(lz * 11 * k);
    this.headRoll.kick(-lx * 9 * k);
    this.squash.kick(4 * k);
    this.flash = heavy ? 1 : 0.7;
    this.mouthT = heavy ? 0.5 : 0.22;
    this.lastHitX = dx;
    this.lastHitZ = dz;
    if (heavy && this.koT < 0) {
      this.staggerT = 0;
      this.staggerSide = lx >= 0 ? 1 : -1;
    }
  }

  dash(dx: number, dz: number): void {
    this.dashT = 0;
    this.dashLanded = false;
    this.dashYaw = Math.atan2(dx, dz);
  }

  ko(): void {
    if (this.koT >= 0) return;
    this.koT = 0;
    this.staggerT = -1;
    // Fall backward along the finishing blow.
    const l = Math.hypot(this.lastHitX, this.lastHitZ);
    this.koYaw = l > 0.01 ? Math.atan2(-this.lastHitX / l, -this.lastHitZ / l) : this.yaw;
  }

  victory(): void {
    if (this.victoryT < 0) {
      this.victoryT = 0;
      this.flourishDone = false;
      if (this.victoryStyle === 'peace') this.spinT = 0;
    }
  }

  // ------------------------------------------------------------- update
  update(dt: number, inp: AnimInput): void {
    const rig = this.rig;
    const G = this.gait;
    this.t += dt;
    const t = this.t;
    const P = this.tgt;
    for (const k of POSE_KEYS) P[k] = 0;

    rig.root.position.set(inp.x, 0, inp.z);

    // --------------------------------------------------------- facing
    const speed = Math.hypot(inp.vx, inp.vz);
    const maxSp = Math.max(0.1, inp.maxSpeed);
    this.speedN = damp(this.speedN, clamp(speed / maxSp, 0, 1.6), 12, dt);
    let yawTarget = inp.facing;
    let yawRate = G.turnRate;
    const dashing = this.dashT >= 0 && this.dashT < 0.34;
    if (dashing && this.dashStyle !== 'blink') {
      yawTarget = this.dashYaw;
      yawRate = 40;
    }
    if (inp.action === 'rush') {
      yawTarget = Math.atan2(inp.dashX, inp.dashZ);
      yawRate = 30;
    }
    if (this.victoryT >= 0) {
      yawTarget = 0;
      yawRate = 5;
    }
    if (this.koT >= 0) {
      yawTarget = this.koYaw;
      yawRate = 20;
    }
    if (!this.yawInit) {
      this.yaw = yawTarget;
      this.prevYaw = yawTarget;
      this.yawInit = true;
    }
    this.yaw = dampAngle(this.yaw, yawTarget, yawRate, dt);
    if (dt > 1e-5) this.yawRate = damp(this.yawRate, clamp(wrapAngle(this.yaw - this.prevYaw) / dt, -12, 12), 10, dt);
    this.prevYaw = this.yaw;
    let yawOut = this.yaw;
    if (this.spinT >= 0) {
      this.spinT += dt;
      const sp = clamp01(this.spinT / 0.7);
      yawOut += ease.outCubic(sp) * TAU;
      if (sp >= 1) this.spinT = -1;
    }
    rig.root.rotation.y = yawOut;

    // ------------------------------------------------- local kinematics
    const sy = Math.sin(-this.yaw);
    const cy = Math.cos(-this.yaw);
    if (dt > 1e-5) {
      const ax = (inp.vx - this.prevVX) / dt;
      const az = (inp.vz - this.prevVZ) / dt;
      const lax = ax * cy + az * sy;
      const laz = -ax * sy + az * cy;
      this.accX = damp(this.accX, clamp(lax, -30, 30), 8, dt);
      this.accZ = damp(this.accZ, clamp(laz, -30, 30), 8, dt);
    }
    this.prevVX = inp.vx;
    this.prevVZ = inp.vz;

    // ----------------------------------------------------- locomotion
    const sN = Math.min(1, this.speedN);
    const A = Math.pow(sN, 0.85);
    let legDir = 1;
    let hipOff = 0;
    let lx = 0;
    let lz = 0;
    if (speed > 0.15) {
      lx = (inp.vx * cy + inp.vz * sy) / speed;
      lz = (-inp.vx * sy + inp.vz * cy) / speed;
      const a = Math.atan2(lx, lz);
      if (Math.abs(a) <= 1.95) {
        hipOff = clamp(a, -0.85, 0.85);
      } else {
        hipOff = clamp(wrapAngle(a + Math.PI), -0.85, 0.85);
        legDir = -1;
      }
    }
    // Stride-matched cadence: one full cycle per strideLength of travel.
    const cadenceBoost = inp.overdrive ? 1.08 : 1;
    this.phase += ((speed * cadenceBoost) / G.strideLength) * TAU * dt * legDir;
    const ph = this.phase;
    const sinP = Math.sin(ph);
    const swing = G.legSwing * A;
    P.hipsRY = hipOff * sN;
    P.spineRY = -hipOff * sN * 0.85;
    P.headRY = -hipOff * sN * 0.12;
    P.legLX = -sinP * swing;
    P.legRX = sinP * swing;
    P.kneeL = Math.max(0, Math.cos(ph) * legDir) * G.kneeLift * A + 0.06 * A;
    P.kneeR = Math.max(0, -Math.cos(ph) * legDir) * G.kneeLift * A + 0.06 * A;
    // Highest at mid-stance (legs passing), lowest at double support.
    P.bodyY = G.bob * A * (0.5 + 0.5 * Math.cos(2 * ph)) - G.bob * A * 0.5;
    // Weight over the stance leg.
    P.hipsRZ = sinP * G.sway * A;
    P.bodyX = -sinP * G.sway * A * 0.6;
    P.spineRZ = -sinP * G.sway * A * 0.7;
    // Lean into motion, acceleration and turns.
    P.rollRX = lz * G.lean * A + clamp(this.accZ * G.accelLean * 0.08, -0.22, 0.22);
    P.rollRZ = -lx * G.lean * 0.55 * A - clamp(this.accX * G.accelLean * 0.06, -0.16, 0.16) + clamp(this.yawRate * G.turnBank * sN, -0.18, 0.18);
    // Free-arm swing (overridden by aim pose below).
    P.shLX = sinP * A * 0.75;
    P.shRX = -sinP * A * 0.75;
    P.shLZ = 0.14;
    P.shRZ = -0.14;
    P.elL = -0.25 - A * 0.45;
    P.elR = -0.25 - A * 0.45;
    // Two-handed weapons are carried, not dangled, when not aiming.
    if (rig.look.weapon === 'pulse_rifle') {
      // rifle held across the body, muzzle down, while moving between shots
      P.shRX = -0.3 + sinP * A * 0.12;
      P.shRZ = 0.22;
      P.elR = -1.05;
      P.shLX = -0.75 - sinP * A * 0.08;
      P.shLZ = -0.5;
      P.elL = -0.85;
    } else if (rig.look.weapon === 'oscillator') {
      // resonator arm held forward and bent, showing the gauntlet; free fist swings a little
      P.shRX = -0.45 + sinP * A * 0.12;
      P.shRZ = -0.05;
      P.elR = -1.25;
      P.elL = -0.6 - A * 0.4;
    } else if (rig.look.weapon === 'tech_carbine') {
      P.shRX = -0.35 + sinP * A * 0.15;
      P.shRZ = 0.25;
      P.elR = -1.1;
      P.shLX = -0.65 - sinP * A * 0.1;
      P.shLZ = -0.45;
      P.elL = -0.95;
    } else if (rig.look.weapon === 'boom_cannon') {
      P.shRX = -0.25 - sinP * A * 0.2;
      P.shRZ = -0.08;
      P.elR = -0.95;
    }
    // Foot contact beats
    const contact = Math.abs(sinP);
    if (A > 0.35 && contact > 0.97 && this.t - this.lastContact > 0.18) {
      this.lastContact = this.t;
      if (this.idleStyle === 'heavy') this.events.onStep?.(true);
      this.squash.kick(G.contactSquash * 30 * A);
    }

    // ----------------------------------------------------------- idle
    const idleW = 1 - Math.min(1, sN * 3);
    if (idleW > 0) {
      switch (this.idleStyle) {
        case 'bouncy': {
          const b = 0.5 + 0.5 * Math.sin(t * 6.2);
          P.bodyY += (b * 0.04 - 0.02) * idleW;
          P.kneeL += (0.24 + b * 0.14) * idleW;
          P.kneeR += (0.24 + b * 0.14) * idleW;
          P.legLX -= (0.13 + b * 0.07) * idleW;
          P.legRX -= (0.13 + b * 0.07) * idleW;
          P.legLZ += 0.07 * idleW;
          P.legRZ -= 0.07 * idleW;
          P.spineRX += 0.07 * idleW;
          P.headRX += Math.sin(t * 6.2 + 0.6) * 0.035 * idleW;
          P.spineRY += Math.sin(t * 1.3) * 0.05 * idleW;
          break;
        }
        case 'heavy': {
          const br = Math.sin(t * 1.6);
          P.spineRX += (br * 0.04 + 0.05) * idleW;
          P.legLZ += 0.13 * idleW;
          P.legRZ -= 0.13 * idleW;
          P.kneeL += 0.18 * idleW;
          P.kneeR += 0.18 * idleW;
          P.legLX -= 0.09 * idleW;
          P.legRX -= 0.09 * idleW;
          P.bodyY -= 0.025 * idleW;
          P.headRX += br * 0.03 * idleW;
          P.shLZ += br * 0.05 * idleW;
          P.shRZ -= br * 0.05 * idleW;
          P.hipsRZ += Math.sin(t * 0.8) * 0.03 * idleW;
          break;
        }
        case 'poise': {
          // composed: weight settled on one hip, slow breathing, a slight chin-up
          const br = Math.sin(t * 1.2);
          P.hipsRZ += (0.06 + br * 0.015) * idleW;
          P.bodyX += 0.025 * idleW;
          P.spineRZ -= 0.07 * idleW;
          P.kneeR += 0.22 * idleW;
          P.legRX -= 0.08 * idleW;
          P.kneeL += 0.06 * idleW;
          P.headRX -= 0.04 * idleW;
          P.headRZ += 0.05 * idleW;
          P.spineRX += br * 0.012 * idleW;
          break;
        }
        case 'sway': {
          const sw = Math.sin(t * 1.5);
          P.hipsRZ += sw * 0.08 * idleW;
          P.bodyX += sw * 0.03 * idleW;
          P.spineRZ -= sw * 0.09 * idleW;
          P.headRZ += Math.sin(t * 1.5 + 0.7) * 0.08 * idleW;
          P.kneeL += (0.1 + Math.max(0, sw) * 0.2) * idleW;
          P.kneeR += (0.1 + Math.max(0, -sw) * 0.2) * idleW;
          P.legLX -= Math.max(0, sw) * 0.09 * idleW;
          P.legRX -= Math.max(0, -sw) * 0.09 * idleW;
          break;
        }
      }
      P.spineRX += Math.sin(t * 2.3) * 0.016 * idleW;
    }

    // ------------------------------------------------------ aim pose
    const aiming = inp.combat && !inp.ko && !inp.stunned && !inp.knockback && this.victoryT < 0;
    this.aimW = damp(this.aimW, aiming ? 1 : 0, 10, dt);
    const aw = this.aimW;
    if (aw > 0.001) {
      const lerpP = (k: PoseKey, v: number) => {
        P[k] = P[k] + (v - P[k]) * aw;
      };
      // breathing / step bob of the aimed arms keeps the stance alive
      const bob = Math.sin(ph * 2) * G.armBob * A + Math.sin(t * 2.1) * 0.02 * (1 - A);
      switch (rig.look.weapon) {
        case 'twin_blasters':
          lerpP('shRX', -1.42 + bob);
          lerpP('shRZ', 0.16);
          lerpP('elR', -0.22);
          lerpP('shLX', -1.42 - bob);
          lerpP('shLZ', -0.16);
          lerpP('elL', -0.22);
          break;
        case 'boom_cannon':
          lerpP('shRX', -0.45 + bob * 0.5);
          lerpP('shRZ', -0.05);
          lerpP('elR', -1.12);
          lerpP('shLX', -0.95 + bob * 0.5);
          lerpP('shLZ', -0.5);
          lerpP('elL', -1.05);
          P.spineRY += 0.12 * aw;
          break;
        case 'pulse_rifle':
          // shouldered marksman stance: rifle along the line of sight, cheek on the stock
          lerpP('shRX', -0.86 + bob * 0.35);
          lerpP('shRZ', 0.3);
          lerpP('elR', -0.82);
          lerpP('shLX', -1.36 + bob * 0.35);
          lerpP('shLZ', -0.36);
          lerpP('elL', -0.4);
          P.spineRY += -0.08 * aw;
          P.headRX += 0.07 * aw;
          P.headRZ -= 0.06 * aw;
          break;
        case 'oscillator':
          // resonator arm straight at the target, the free fist raised in a guard
          lerpP('shRX', -1.45 + bob);
          lerpP('shRZ', 0.1);
          lerpP('elR', -0.12);
          lerpP('shLX', -0.62 - bob * 0.5);
          lerpP('shLZ', -0.32);
          lerpP('elL', -1.7);
          P.spineRY += -0.14 * aw;
          break;
        case 'tech_carbine':
          lerpP('shRX', -0.78 + bob * 0.5);
          lerpP('shRZ', 0.3);
          lerpP('elR', -0.92);
          lerpP('shLX', -1.28 + bob * 0.5);
          lerpP('shLZ', -0.42);
          lerpP('elL', -0.5);
          P.spineRY += -0.06 * aw;
          P.headRX += 0.05 * aw;
          break;
      }
    }

    // -------------------------------------------------------- actions
    if (inp.action === 'windup') {
      const p = clamp01(inp.actionT / Math.max(0.05, inp.actionTotal));
      const crouch = ease.outCubic(Math.min(1, p * 2));
      P.kneeL += 0.45 * crouch;
      P.kneeR += 0.45 * crouch;
      P.legLX -= 0.25 * crouch;
      P.legRX -= 0.25 * crouch;
      P.bodyY -= 0.08 * crouch;
      if (inp.actionCard === 'knockout') {
        P.spineRX += 0.38 * crouch;
        P.shRX = 0.75 * crouch;
        P.shRZ = -0.3;
        P.elR = -1.7 * crouch;
        P.shLX = -1.2;
        P.shLZ = -0.3;
        P.elL = -1.0;
        P.spineRY += 0.5 * crouch;
      } else {
        P.spineRX -= 0.14 * crouch;
        P.spineRY += 0.2 * crouch;
        P.shRX -= 0.15 * crouch;
        P.headRX -= 0.08 * crouch;
      }
      const sh = p * 0.035;
      P.spineRZ += Math.sin(t * 60) * sh;
      this.glowPulse = Math.max(this.glowPulse, 0.6 + p * 2);
    } else if (inp.action === 'rush') {
      P.rollRX += 0.6;
      P.shRX = 0.95;
      P.elR = -1.7;
      P.shLX = -1.35;
      P.elL = -0.55;
      P.spineRY += 0.4;
      const rp = this.t * 26;
      P.legLX = -Math.sin(rp) * 1.0;
      P.legRX = Math.sin(rp) * 1.0;
      P.kneeL = Math.max(0, Math.cos(rp)) * 1.4;
      P.kneeR = Math.max(0, -Math.cos(rp)) * 1.4;
    } else if (inp.action === 'recover') {
      P.rollRX += 0.42 + Math.sin(t * 18) * 0.08;
      P.headRX += 0.3;
      P.shLX = -0.5 + Math.sin(t * 20) * 0.5;
      P.shRX = -0.5 - Math.sin(t * 20) * 0.5;
      P.shLZ = 0.8;
      P.shRZ = -0.8;
    }

    // ------------------------------------------------------------ dash
    let rollSpin = 0;
    let bodyScaleX = 1;
    let bodyScaleZ = 1;
    let bodyScaleY = 1;
    rig.body.visible = true;
    if (this.dashT >= 0) {
      this.dashT += dt;
      const dur = this.dashStyle === 'roll' ? 0.32 : 0.3;
      const p = clamp01(this.dashT / dur);
      if (this.dashStyle === 'roll') {
        // anticipation stretch → tight tuck roll → landing squash
        rollSpin = ease.inOutCubic(smoothstep(0.08, 1, p)) * TAU;
        const tuck = Math.sin(p * Math.PI);
        P.kneeL = 1.7 * tuck;
        P.kneeR = 1.7 * tuck;
        P.legLX = -1.25 * tuck;
        P.legRX = -1.25 * tuck;
        P.spineRX = 0.65 * tuck;
        P.headRX = 0.45 * tuck;
        P.shLX = -0.6;
        P.shRX = -0.6;
        P.elL = -1.6 * tuck;
        P.elR = -1.6 * tuck;
        P.bodyY = 0.14 * tuck;
        if (p < 0.1) bodyScaleY = 1.08;
      } else if (this.dashStyle === 'lunge') {
        const k = Math.sin(p * Math.PI);
        P.rollRX = 0.6 * k;
        P.shLX = 0.95 * k;
        P.shRX = 0.95 * k;
        P.legLX = -0.85 * k;
        P.legRX = 0.75 * k;
        P.kneeR = 0.65 * k;
        P.bodyY = -0.05 * k;
        bodyScaleZ = 1 + 0.2 * k;
        bodyScaleX = 1 - 0.07 * k;
      } else {
        // blink: glitch-teleport flicker
        const k = Math.sin(p * Math.PI);
        rig.body.visible = p > 0.85 || Math.floor(this.dashT * 40) % 2 === 0;
        bodyScaleX = 1 - 0.75 * k;
        bodyScaleY = 1 + 0.28 * k;
      }
      if (p >= 1) {
        if (!this.dashLanded) {
          this.dashLanded = true;
          this.squash.kick(this.dashStyle === 'lunge' ? 6 : 4);
          if (this.dashStyle === 'lunge') this.events.onStep?.(true);
        }
        this.dashT = -1;
      }
    }

    // ------------------------------------------------- heavy-hit stagger
    if (this.staggerT >= 0 && this.koT < 0) {
      this.staggerT += dt;
      const st = this.staggerT / HIT_REACTION.staggerTime;
      if (st >= 1) this.staggerT = -1;
      else {
        // fast rise, eased recovery
        const w = st < 0.15 ? st / 0.15 : 1 - ease.inOutCubic((st - 0.15) / 0.85);
        const sd = this.staggerSide;
        const mix = (k: PoseKey, v: number) => {
          P[k] = P[k] + (v - P[k]) * w;
        };
        mix('spineRX', -0.38);
        mix('headRX', -0.3);
        mix('rollRX', -0.22);
        mix('rollRZ', 0.12 * sd);
        mix('shLX', -0.9);
        mix('shRX', -0.9);
        mix('shLZ', 0.95);
        mix('shRZ', -0.95);
        mix('legRX', 0.45);
        mix('kneeR', 0.35);
        mix('legLX', -0.2);
        mix('kneeL', 0.25);
        P.bodyY -= 0.04 * w;
      }
    }

    // --------------------------------------------- stunned (dizzy)
    if (inp.stunned && this.koT < 0) {
      this.stunAge += dt;
      const jolt = inp.glitch ? 0.6 : Math.max(0, 1 - this.stunAge / 0.35);
      const wob = Math.sin(t * 4.6);
      P.spineRX = 0.18 + Math.sin(t * 41) * 0.08 * jolt;
      P.spineRZ = wob * 0.13 + Math.sin(t * 33) * 0.1 * jolt;
      P.headRX = 0.22 + Math.cos(t * 4.6) * 0.12;
      P.headRZ = wob * 0.28;
      P.shLX = 0.1 + Math.sin(t * 47) * 0.15 * jolt;
      P.shRX = 0.1 + Math.sin(t * 43) * 0.15 * jolt;
      P.shLZ = 0.4 + jolt * 0.5;
      P.shRZ = -0.4 - jolt * 0.5;
      P.elL = -0.25;
      P.elR = -0.25;
      P.kneeL = 0.32 + Math.max(0, wob) * 0.12;
      P.kneeR = 0.32 + Math.max(0, -wob) * 0.12;
      P.legLX = -0.14;
      P.legRX = -0.14;
      P.bodyX += wob * 0.05;
      P.bodyY = -0.05;
      P.hipsRZ = -wob * 0.06;
    } else {
      this.stunAge = 0;
    }
    if (inp.glitch && !inp.stunned && this.koT < 0) {
      if (Math.floor(t * 14) % 5 === 0) {
        P.spineRY += 0.3;
        P.headRZ += 0.3;
      }
    }

    // ------------------------------------------------------ knockback
    if (inp.knockback && this.koT < 0) {
      P.rollRX = -0.55;
      P.shLX = -1.6;
      P.shRX = -1.6;
      P.shLZ = 0.5;
      P.shRZ = -0.5;
      P.legLX = -0.6;
      P.legRX = -0.3;
      P.kneeL = 0.6;
      P.headRX = -0.35;
      P.bodyY = 0.12;
    }

    // -------------------------------------------------------------- KO
    let koFall = 0;
    let koLift = 0;
    let koSlide = 0;
    if (this.koT >= 0) {
      this.koT += dt;
      const kt = this.koT;
      // 0..0.38 thrown back in an arc, 0.38 impact, small bounce, settle.
      if (kt < 0.38) {
        const p = kt / 0.38;
        koFall = ease.inQuad(p) * 1.25;
        koLift = Math.sin(p * Math.PI) * 0.5;
        koSlide = -p * 0.35;
      } else if (kt < 0.62) {
        const p = (kt - 0.38) / 0.24;
        koFall = 1.25 + 0.25 * ease.outCubic(p);
        koLift = Math.sin(p * Math.PI) * 0.12;
        koSlide = -0.35 - p * 0.15;
        if (this.koLanded === 0) {
          this.koLanded = 1;
          this.squash.kick(7);
          this.events.onLand?.(1);
        }
      } else {
        koFall = 1.5;
        koSlide = -0.5;
        if (this.koLanded === 1 && kt > 0.66) {
          this.koLanded = 2;
          this.events.onLand?.(0.4);
        }
      }
      const limp = Math.min(1, kt / 0.5);
      P.shLX = -2.5 * limp;
      P.shRX = -2.4 * limp;
      P.shLZ = 1.1;
      P.shRZ = -1.0;
      P.elL = -0.35;
      P.elR = -0.25;
      P.legLX = kt < 0.38 ? -1.0 : -0.45;
      P.legRX = kt < 0.38 ? -0.6 : -0.15;
      P.kneeL = 0.55;
      P.kneeR = 0.2;
      P.headRX = kt < 0.38 ? -0.5 : -0.3;
      P.headRZ = 0.25;
      P.spineRX = -0.1;
      P.hipsRY = 0;
      P.spineRY = 0;
      P.rollRX = 0;
      P.rollRZ = 0;
      P.bodyY = 0;
      P.bodyX = 0;
      rig.eyes.visible = false;
      rig.koEyes.visible = true;
    }

    // --------------------------------------------------------- victory
    let weaponSpin = 0;
    if (this.victoryT >= 0) {
      this.victoryT += dt;
      const vt = this.victoryT;
      const k = clamp01(vt / 0.35);
      const vk = (key: PoseKey, v: number) => {
        P[key] = P[key] + (v - P[key]) * k;
      };
      switch (this.victoryStyle) {
        case 'hype': {
          const j = Math.max(0, Math.sin(vt * 7));
          P.bodyY += j * 0.34 * k;
          vk('shRX', -2.85);
          vk('shRZ', -0.15);
          vk('elR', -0.4 - j * 0.5);
          vk('shLX', -0.4);
          vk('shLZ', 0.5);
          vk('elL', -1.6);
          vk('kneeL', 0.3 + j * 0.65);
          vk('kneeR', 0.3 + j * 0.65);
          vk('legLX', -0.2 - j * 0.32);
          vk('legRX', -0.2 - j * 0.32);
          vk('headRX', -0.18);
          vk('spineRX', -0.08);
          // pistol twirl while airborne
          weaponSpin = j > 0.2 ? (vt * 18) % TAU : 0;
          break;
        }
        case 'flex': {
          const pulse = Math.max(0, Math.sin(vt * 4));
          vk('shLX', -0.15);
          vk('shRX', -0.15);
          vk('shLZ', 1.45 + pulse * 0.1);
          vk('shRZ', -1.45 - pulse * 0.1);
          vk('elL', -2.1 - pulse * 0.2);
          vk('elR', -2.1 - pulse * 0.2);
          vk('spineRX', -0.12 - pulse * 0.05);
          vk('headRX', -0.2);
          vk('legLZ', 0.18);
          vk('legRZ', -0.18);
          vk('kneeL', 0.3);
          vk('kneeR', 0.3);
          bodyScaleX = 1 + pulse * 0.04;
          if (!this.flourishDone && vt > 0.32) {
            this.flourishDone = true;
            this.squash.kick(6);
            this.events.onFlourish?.();
          }
          break;
        }
        case 'peace': {
          const sw = Math.sin(vt * 3);
          vk('shRX', -2.5);
          vk('shRZ', -0.35);
          vk('elR', -1.9);
          vk('shLX', 0.1);
          vk('shLZ', 0.7);
          vk('elL', -1.7);
          vk('kneeL', 1.1);
          vk('legLX', 0.15);
          vk('headRZ', 0.22 + sw * 0.05);
          vk('hipsRZ', sw * 0.1);
          vk('spineRZ', -sw * 0.08);
          if (!this.flourishDone && vt > 0.72) {
            this.flourishDone = true;
            this.events.onFlourish?.();
          }
          break;
        }
      }
      this.mouthT = Math.max(this.mouthT, Math.sin(vt * 2) > 0.6 ? 0.1 : 0);
    }

    // -------------------------------------------- showcase flair (menu)
    if (!inp.combat && this.victoryT < 0 && this.koT < 0) {
      this.flairT -= dt;
      if (this.flairT <= 0 && this.flair <= 0) {
        this.flair = 1.6;
        this.flairT = 6 + Math.random() * 4;
      }
      if (this.flair > 0) {
        this.flair -= dt;
        const f = Math.sin(clamp01(1 - this.flair / 1.6) * Math.PI);
        const fk = (key: PoseKey, v: number) => {
          P[key] = P[key] + (v - P[key]) * f;
        };
        switch (this.victoryStyle) {
          case 'hype':
            fk('shRX', -1.5);
            fk('shRZ', 0.3);
            fk('elR', -0.3);
            fk('headRZ', 0.15);
            weaponSpin = f > 0.3 ? (this.t * 16) % TAU : 0;
            break;
          case 'flex':
            fk('shLZ', 1.4);
            fk('elL', -2.0);
            fk('shLX', -0.2);
            fk('headRX', -0.1);
            break;
          case 'peace':
            fk('shRX', -2.4);
            fk('shRZ', -0.3);
            fk('elR', -1.8);
            fk('headRZ', 0.2);
            break;
        }
      }
    }

    // ---------------------------------------------------- apply pose
    const C = this.cur;
    const rate = this.koT >= 0 ? 16 : this.dashT >= 0 ? 30 : this.staggerT >= 0 ? 24 : 18;
    for (const k of POSE_KEYS) {
      const v = damp(C[k], P[k], rate, dt);
      C[k] = Number.isFinite(v) ? v : 0;
    }

    const rR = this.recoilR.update(dt);
    const rL = this.recoilL.update(dt);
    const rb = this.recoilBody.update(dt);
    const hp = this.hitPitch.update(dt);
    const hr = this.hitRoll.update(dt);
    const hs = this.headSnap.update(dt);
    const hrl = this.headRoll.update(dt);
    const sq = this.squash.update(dt);
    const sv = this.shove.update(dt);

    rig.body.position.set(C.bodyX, C.bodyY + koLift, koSlide + sv * 0.035);
    rig.body.rotation.x = -koFall;
    rig.roll.rotation.set(C.rollRX + rollSpin - rb * 0.012, 0, C.rollRZ);
    rig.hips.rotation.set(0, C.hipsRY, C.hipsRZ);
    rig.spine.rotation.set(C.spineRX + hp * 0.06 - rb * 0.02 - (rR + rL) * 0.004, C.spineRY + (rR - rL) * 0.01, C.spineRZ + hr * 0.05);
    rig.head.rotation.set(C.headRX + hp * 0.05 + hs * 0.06, C.headRY, C.headRZ + hr * 0.04 + hrl * 0.05);
    rig.shoulderL.rotation.set(C.shLX - rL * 0.05, 0, C.shLZ);
    rig.shoulderR.rotation.set(C.shRX - rR * 0.05, 0, C.shRZ);
    rig.elbowL.rotation.set(C.elL - rL * 0.06, 0, 0);
    rig.elbowR.rotation.set(C.elR - rR * 0.06, 0, 0);
    rig.legL.rotation.set(C.legLX, 0, C.legLZ);
    rig.legR.rotation.set(C.legRX, 0, C.legRZ);
    rig.kneeL.rotation.set(C.kneeL, 0, 0);
    rig.kneeR.rotation.set(C.kneeR, 0, 0);
    // weapon slides back along its barrel on each shot (+y is "back" in forearm space)
    const slide = this.recoil.slide;
    if (rig.weaponR) {
      rig.weaponR.position.y = this.weaponBaseR + clamp(rR * 0.012, -0.05, 0.2) * slide * 10;
      rig.weaponR.rotation.y = weaponSpin;
    }
    if (rig.weaponL) {
      rig.weaponL.position.y = this.weaponBaseL + clamp(rL * 0.012, -0.05, 0.2) * slide * 10;
      rig.weaponL.rotation.y = weaponSpin ? -weaponSpin : 0;
    }
    // PRIME OSCILLATOR: rings idle slowly, spin up while charging (PRIME PULSE / SPOTLIGHT SHOT),
    // then wind down for a moment after the release
    if (rig.spinR) {
      const charging = inp.action === 'windup';
      if (this.prevAction === 'windup' && !charging) this.ringCool = 0.9;
      this.prevAction = inp.action;
      if (this.ringCool > 0) this.ringCool -= dt;
      const charge = charging ? clamp(inp.actionT / Math.max(0.05, inp.actionTotal), 0, 1) : 0;
      const target = charging ? 10 + charge * 22 : this.ringCool > 0 ? 0.3 : 2;
      this.ringSpeed = damp(this.ringSpeed, target, charging ? 5 : 2.5, dt);
      rig.spinR.rotation.z += this.ringSpeed * dt;
      const s = charging ? 1 + charge * 0.22 + Math.sin(this.t * 40) * 0.025 * charge : this.ringCool > 0 ? 0.9 : 1;
      rig.spinR.scale.setScalar(damp(rig.spinR.scale.x, s, 12, dt));
    }

    const sqk = clamp(sq * 0.012, -0.12, 0.18);
    rig.body.scale.set(bodyScaleX * (1 + sqk * 0.5), bodyScaleY * (1 - sqk), bodyScaleZ * (1 + sqk * 0.5));

    // ---------------------------------------------------------- face
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blinkDur = 0.12;
      this.blinkT = 2.2 + Math.random() * 2.8;
    }
    let eyeScale = 1;
    if (this.blinkDur > 0) {
      this.blinkDur -= dt;
      eyeScale = 0.12;
    }
    if (inp.stunned || this.flash > 0.4 || this.staggerT >= 0) eyeScale = Math.min(eyeScale, 0.35);
    rig.eyes.scale.y = damp(rig.eyes.scale.y, eyeScale, 40, dt);
    if (this.mouthT > 0) this.mouthT -= dt;
    const open = this.mouthT > 0 || inp.stunned || this.koT >= 0 || inp.action === 'windup' || inp.action === 'rush';
    rig.mouth.visible = !open;
    rig.mouthOpen.visible = open;
    rig.brows.position.y = damp(rig.brows.position.y, inp.action !== 'none' || this.flash > 0.3 ? -0.025 : this.victoryT >= 0 ? 0.03 : 0, 14, dt);

    // ------------------------------------------------------- material
    this.flash = Math.max(0, this.flash - dt * 7);
    this.glowPulse = Math.max(0, this.glowPulse - dt * 4);
    if (rig.toonMat) {
      const u = toonUniforms(rig.toonMat);
      u.uFlash.value = this.flash * 0.85;
      const tintTarget = inp.overdrive ? 0.22 + Math.sin(t * 12) * 0.08 : inp.glitch ? 0.25 + (Math.floor(t * 18) % 3 === 0 ? 0.25 : 0) : 0;
      u.uTintAmount.value = damp(u.uTintAmount.value, tintTarget, 10, dt);
      if (inp.overdrive) u.uTint.value.setRGB(1.0, 0.35, 0.08);
      else if (inp.glitch) u.uTint.value.setRGB(0.9, 0.2, 1.0);
    }
    if (!rig.holo) {
      (rig.glowMat as MeshBasicMaterial).color.setScalar(1 + this.glowPulse);
    }
  }

  /** True once the KO fall finished (for camera / result timing). */
  get koDone(): boolean {
    return this.koT > 0.62;
  }

  get isStaggered(): boolean {
    return this.staggerT >= 0;
  }
}
