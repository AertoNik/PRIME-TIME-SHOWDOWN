import type { MeshBasicMaterial } from 'three';
import type { CardId, DashStyle, IdleStyle, VictoryStyle } from '../config/types';
import { clamp, clamp01, damp, dampAngle, ease, Spring, TAU, wrapAngle } from '../core/math';
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
  'bodyRX',
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

/**
 * Procedural animation for one fighter rig. Layered: locomotion, idle,
 * weapon aim pose, actions (windup/dash/rush), reactions (spring-based),
 * and terminal states (KO / victory). All motion is delta-time based.
 */
export class FighterAnimator {
  readonly rig: FighterRig;
  readonly idleStyle: IdleStyle;
  readonly dashStyle: DashStyle;
  readonly victoryStyle: VictoryStyle;
  private t = Math.random() * 10;
  private phase = 0;
  private speedN = 0;
  private yaw = 0;
  private yawInit = false;
  private aimW = 0;
  private cur = zeroPose();
  private tgt = zeroPose();

  private recoilR = new Spring(260, 16);
  private recoilL = new Spring(260, 16);
  private hitPitch = new Spring(160, 11);
  private hitRoll = new Spring(160, 11);
  private squash = new Spring(220, 13);
  private shove = new Spring(140, 12);
  private flash = 0;
  private blinkT = 2;
  private blinkDur = 0;
  private mouthT = 0;
  private koT = -1;
  private victoryT = -1;
  private dashT = -1;
  private dashYaw = 0;
  private flair = 0;
  private flairT = 4 + Math.random() * 3;
  private glowPulse = 0;
  private spinT = -1;

  constructor(rig: FighterRig, idle: IdleStyle, dash: DashStyle, victory: VictoryStyle) {
    this.rig = rig;
    this.idleStyle = idle;
    this.dashStyle = dash;
    this.victoryStyle = victory;
  }

  reset(yaw: number): void {
    this.koT = -1;
    this.victoryT = -1;
    this.dashT = -1;
    this.spinT = -1;
    this.flash = 0;
    this.yaw = yaw;
    this.yawInit = true;
    this.aimW = 0;
    this.recoilR.reset();
    this.recoilL.reset();
    this.hitPitch.reset();
    this.hitRoll.reset();
    this.squash.reset();
    this.shove.reset();
    this.cur = zeroPose();
    this.rig.body.visible = true;
    this.rig.koEyes.visible = false;
    this.rig.eyes.visible = true;
    this.rig.body.scale.set(1, 1, 1);
    this.rig.body.position.set(0, 0, 0);
    this.rig.body.rotation.set(0, 0, 0);
  }

  // ----------------------------------------------------------- triggers
  fire(muzzle: number, heavy: boolean): void {
    const k = heavy ? 2.6 : 1;
    if (muzzle === 1) this.recoilL.kick(9 * k);
    else this.recoilR.kick(9 * k);
    if (heavy) {
      this.shove.kick(-3);
      this.squash.kick(-2);
    }
    this.glowPulse = heavy ? 1.6 : 0.8;
  }

  hit(dx: number, dz: number, heavy: boolean): void {
    // projectile travel direction into local frame
    const s = Math.sin(-this.yaw);
    const c = Math.cos(-this.yaw);
    const lx = dx * c + dz * s;
    const lz = -dx * s + dz * c;
    const k = heavy ? 2.4 : 1;
    this.hitPitch.kick(lz * 7 * k);
    this.hitRoll.kick(-lx * 6 * k);
    this.squash.kick(4 * k);
    this.flash = heavy ? 1 : 0.75;
    this.mouthT = heavy ? 0.45 : 0.22;
  }

  dash(dx: number, dz: number): void {
    this.dashT = 0;
    this.dashYaw = Math.atan2(dx, dz);
  }

  ko(): void {
    if (this.koT < 0) this.koT = 0;
  }

  victory(): void {
    if (this.victoryT < 0) {
      this.victoryT = 0;
      if (this.victoryStyle === 'peace') this.spinT = 0;
    }
  }

  // ------------------------------------------------------------- update
  update(dt: number, inp: AnimInput): void {
    const rig = this.rig;
    this.t += dt;
    const t = this.t;
    const P = this.tgt;
    for (const k of POSE_KEYS) P[k] = 0;

    rig.root.position.set(inp.x, 0, inp.z);

    // --------------------------------------------------------- facing
    const speed = Math.hypot(inp.vx, inp.vz);
    this.speedN = damp(this.speedN, clamp(speed / Math.max(0.1, inp.maxSpeed), 0, 1.5), 12, dt);
    let yawTarget = inp.facing;
    let yawRate = 16;
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
    if (!this.yawInit) {
      this.yaw = yawTarget;
      this.yawInit = true;
    }
    if (this.koT < 0) this.yaw = dampAngle(this.yaw, yawTarget, yawRate, dt);
    let yawOut = this.yaw;
    if (this.spinT >= 0) {
      this.spinT += dt;
      const sp = clamp01(this.spinT / 0.7);
      yawOut += ease.outCubic(sp) * TAU;
      if (sp >= 1) this.spinT = -1;
    }
    rig.root.rotation.y = yawOut;

    // ----------------------------------------------------- locomotion
    const sN = Math.min(1, this.speedN);
    const heavy = this.idleStyle === 'heavy';
    let legDir = 1;
    let hipOff = 0;
    let lx = 0;
    let lz = 0;
    if (speed > 0.15) {
      const s = Math.sin(-this.yaw);
      const c = Math.cos(-this.yaw);
      lx = (inp.vx * c + inp.vz * s) / speed;
      lz = (-inp.vx * s + inp.vz * c) / speed;
      const a = Math.atan2(lx, lz);
      if (Math.abs(a) <= 1.95) {
        hipOff = clamp(a, -0.85, 0.85);
      } else {
        hipOff = clamp(wrapAngle(a + Math.PI), -0.85, 0.85);
        legDir = -1;
      }
    }
    const strideK = heavy ? 2.3 : 2.75;
    this.phase += dt * speed * strideK * legDir;
    const ph = this.phase;
    const A = sN * (heavy ? 0.62 : 0.78);
    P.hipsRY = hipOff * sN;
    P.spineRY = -hipOff * sN * 0.85;
    P.headRY = -hipOff * sN * 0.12;
    P.legLX = -Math.sin(ph) * A;
    P.legRX = Math.sin(ph) * A;
    P.kneeL = Math.max(0, Math.cos(ph) * legDir) * A * 1.35 + 0.05;
    P.kneeR = Math.max(0, -Math.cos(ph) * legDir) * A * 1.35 + 0.05;
    P.bodyY = Math.abs(Math.sin(ph)) * 0.07 * A;
    P.rollRX = lz * 0.16 * sN;
    P.rollRZ = -lx * 0.1 * sN;
    P.hipsRZ = Math.sin(ph) * 0.05 * A;
    P.spineRZ = -Math.sin(ph) * 0.04 * A;
    // free-arm swing (overridden by aim below)
    P.shLX = Math.sin(ph) * A * 0.7;
    P.shRX = -Math.sin(ph) * A * 0.7;
    P.shLZ = 0.14;
    P.shRZ = -0.14;
    P.elL = -0.25 - A * 0.4;
    P.elR = -0.25 - A * 0.4;

    // ----------------------------------------------------------- idle
    const idleW = 1 - Math.min(1, sN * 3);
    if (idleW > 0) {
      switch (this.idleStyle) {
        case 'bouncy': {
          const b = 0.5 + 0.5 * Math.sin(t * 6.2);
          P.bodyY += b * 0.035 * idleW;
          P.kneeL += (0.22 + b * 0.12) * idleW;
          P.kneeR += (0.22 + b * 0.12) * idleW;
          P.legLX -= (0.12 + b * 0.06) * idleW;
          P.legRX -= (0.12 + b * 0.06) * idleW;
          P.legLZ += 0.06 * idleW;
          P.legRZ -= 0.06 * idleW;
          P.spineRX += 0.06 * idleW;
          P.headRX += Math.sin(t * 6.2 + 0.6) * 0.03 * idleW;
          break;
        }
        case 'heavy': {
          const br = Math.sin(t * 1.7);
          P.spineRX += (br * 0.035 + 0.04) * idleW;
          P.legLZ += 0.12 * idleW;
          P.legRZ -= 0.12 * idleW;
          P.kneeL += 0.16 * idleW;
          P.kneeR += 0.16 * idleW;
          P.legLX -= 0.08 * idleW;
          P.legRX -= 0.08 * idleW;
          P.bodyY -= 0.02 * idleW;
          P.headRX += br * 0.03 * idleW;
          P.shLZ += br * 0.04 * idleW;
          P.shRZ -= br * 0.04 * idleW;
          break;
        }
        case 'sway': {
          const sw = Math.sin(t * 1.5);
          P.hipsRZ += sw * 0.07 * idleW;
          P.spineRZ -= sw * 0.08 * idleW;
          P.headRZ += Math.sin(t * 1.5 + 0.7) * 0.07 * idleW;
          P.kneeL += (0.1 + Math.max(0, sw) * 0.18) * idleW;
          P.kneeR += (0.1 + Math.max(0, -sw) * 0.18) * idleW;
          P.legLX -= Math.max(0, sw) * 0.08 * idleW;
          P.legRX -= Math.max(0, -sw) * 0.08 * idleW;
          break;
        }
      }
      P.spineRX += Math.sin(t * 2.3) * 0.015 * idleW;
    }

    // ------------------------------------------------------ aim pose
    const aiming = inp.combat && !inp.ko && !inp.stunned && !inp.knockback && this.victoryT < 0;
    this.aimW = damp(this.aimW, aiming ? 1 : 0, 10, dt);
    const aw = this.aimW;
    if (aw > 0.001) {
      const lerpP = (k: PoseKey, v: number) => {
        P[k] = P[k] + (v - P[k]) * aw;
      };
      switch (rig.look.weapon) {
        case 'twin_blasters':
          lerpP('shRX', -1.42);
          lerpP('shRZ', 0.16);
          lerpP('elR', -0.22);
          lerpP('shLX', -1.42);
          lerpP('shLZ', -0.16);
          lerpP('elL', -0.22);
          break;
        case 'boom_cannon':
          lerpP('shRX', -0.45);
          lerpP('shRZ', -0.05);
          lerpP('elR', -1.12);
          lerpP('shLX', -0.95);
          lerpP('shLZ', -0.5);
          lerpP('elL', -1.05);
          P.spineRY += 0.12 * aw;
          break;
        case 'glitch_gauntlet':
          lerpP('shRX', -1.5);
          lerpP('shRZ', 0.08);
          lerpP('elR', -0.08);
          lerpP('shLX', 0.15);
          lerpP('shLZ', 0.5);
          lerpP('elL', -1.5);
          P.spineRY += -0.12 * aw;
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
        P.spineRX += 0.35 * crouch;
        P.shRX = 0.7 * crouch;
        P.shRZ = -0.3;
        P.elR = -1.6 * crouch;
        P.shLX = -1.2;
        P.shLZ = -0.3;
        P.elL = -1.0;
        P.spineRY += 0.45 * crouch;
      } else {
        P.spineRX -= 0.12 * crouch;
        P.spineRY += 0.18 * crouch;
        P.shRX -= 0.15 * crouch;
        P.headRX -= 0.08 * crouch;
      }
      // charge shake
      const sh = p * 0.03;
      P.spineRZ += Math.sin(t * 60) * sh;
      this.glowPulse = Math.max(this.glowPulse, 0.6 + p * 1.8);
    } else if (inp.action === 'rush') {
      P.rollRX += 0.55;
      P.shRX = 0.9;
      P.elR = -1.7;
      P.shLX = -1.3;
      P.elL = -0.6;
      P.spineRY += 0.35;
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
      const dur = this.dashStyle === 'roll' ? 0.34 : 0.3;
      const p = clamp01(this.dashT / dur);
      if (this.dashStyle === 'roll') {
        rollSpin = ease.inOutCubic(p) * TAU;
        const tuck = Math.sin(p * Math.PI);
        P.kneeL = 1.6 * tuck;
        P.kneeR = 1.6 * tuck;
        P.legLX = -1.2 * tuck;
        P.legRX = -1.2 * tuck;
        P.spineRX = 0.6 * tuck;
        P.headRX = 0.4 * tuck;
        P.shLX = -0.6;
        P.shRX = -0.6;
        P.elL = -1.6 * tuck;
        P.elR = -1.6 * tuck;
        P.bodyY = 0.12 * tuck;
      } else if (this.dashStyle === 'lunge') {
        const k = Math.sin(p * Math.PI);
        P.rollRX = 0.55 * k;
        P.shLX = 0.9 * k;
        P.shRX = 0.9 * k;
        P.legLX = -0.8 * k;
        P.legRX = 0.7 * k;
        P.kneeR = 0.6 * k;
        bodyScaleZ = 1 + 0.18 * k;
        bodyScaleX = 1 - 0.06 * k;
      } else {
        // blink: glitch-teleport flicker
        const k = Math.sin(p * Math.PI);
        rig.body.visible = p > 0.85 || Math.floor(this.dashT * 40) % 2 === 0;
        bodyScaleX = 1 - 0.7 * k;
        bodyScaleY = 1 + 0.25 * k;
      }
      if (p >= 1) this.dashT = -1;
    }

    // ------------------------------------------------------- stunned
    if (inp.stunned && this.koT < 0) {
      const j = inp.glitch ? 0.6 : 1;
      P.spineRX = 0.15 + Math.sin(t * 41) * 0.08 * j;
      P.spineRZ = Math.sin(t * 33) * 0.12 * j;
      P.headRZ = Math.sin(t * 27) * 0.3;
      P.headRX = 0.2;
      P.shLX = -0.3 + Math.sin(t * 47) * 0.2;
      P.shRX = -0.3 + Math.sin(t * 43) * 0.2;
      P.shLZ = 0.9;
      P.shRZ = -0.9;
      P.elL = -0.3;
      P.elR = -0.3;
      P.kneeL = 0.35;
      P.kneeR = 0.35;
      P.legLX = -0.15;
      P.legRX = -0.15;
      P.bodyY = -0.05;
    }
    if (inp.glitch && !inp.stunned && this.koT < 0) {
      // jittery hacked motion
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
      P.headRX = -0.3;
      P.bodyY = 0.12;
    }

    // -------------------------------------------------------------- KO
    let koFall = 0;
    if (this.koT >= 0) {
      this.koT += dt;
      const p = clamp01(this.koT / 0.6);
      koFall = ease.outBounce(p);
      P.bodyY = Math.sin(Math.min(1, p * 1.3) * Math.PI) * 0.35;
      P.shLX = -2.4;
      P.shRX = -2.4;
      P.shLZ = 1.0;
      P.shRZ = -1.0;
      P.elL = -0.3;
      P.elR = -0.3;
      P.legLX = -0.5;
      P.legRX = -0.2;
      P.kneeL = 0.5;
      P.kneeR = 0.2;
      P.headRX = -0.35;
      P.spineRX = -0.1;
      P.hipsRY = 0;
      P.spineRY = 0;
      rig.eyes.visible = false;
      rig.koEyes.visible = true;
    }

    // --------------------------------------------------------- victory
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
          P.bodyY += j * 0.32 * k;
          vk('shRX', -2.85);
          vk('shRZ', -0.15);
          vk('elR', -0.4 - j * 0.5);
          vk('shLX', -0.4);
          vk('shLZ', 0.5);
          vk('elL', -1.6);
          vk('kneeL', 0.3 + j * 0.6);
          vk('kneeR', 0.3 + j * 0.6);
          vk('legLX', -0.2 - j * 0.3);
          vk('legRX', -0.2 - j * 0.3);
          vk('headRX', -0.18);
          vk('spineRX', -0.08);
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
    const rate = this.koT >= 0 ? 14 : this.dashT >= 0 ? 30 : 18;
    for (const k of POSE_KEYS) {
      const v = damp(C[k], P[k], rate, dt);
      C[k] = Number.isFinite(v) ? v : 0;
    }

    const rR = this.recoilR.update(dt);
    const rL = this.recoilL.update(dt);
    const hp = this.hitPitch.update(dt);
    const hr = this.hitRoll.update(dt);
    const sq = this.squash.update(dt);
    const sv = this.shove.update(dt);

    rig.body.position.y = C.bodyY;
    rig.body.position.z = 0;
    rig.body.rotation.x = -koFall * 1.48;
    rig.roll.rotation.set(C.rollRX + rollSpin + sv * 0.04, 0, C.rollRZ);
    rig.hips.rotation.set(0, C.hipsRY, C.hipsRZ);
    rig.spine.rotation.set(C.spineRX + hp * 0.06 - (rR + rL) * 0.006, C.spineRY + (rR - rL) * 0.01, C.spineRZ + hr * 0.05);
    rig.head.rotation.set(C.headRX + hp * 0.09, C.headRY, C.headRZ + hr * 0.07);
    rig.shoulderL.rotation.set(C.shLX - rL * 0.05, 0, C.shLZ);
    rig.shoulderR.rotation.set(C.shRX - rR * 0.05, 0, C.shRZ);
    rig.elbowL.rotation.set(C.elL - rL * 0.06, 0, 0);
    rig.elbowR.rotation.set(C.elR - rR * 0.06, 0, 0);
    rig.legL.rotation.set(C.legLX, 0, C.legLZ);
    rig.legR.rotation.set(C.legRX, 0, C.legRZ);
    rig.kneeL.rotation.set(C.kneeL, 0, 0);
    rig.kneeR.rotation.set(C.kneeR, 0, 0);

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
    if (inp.stunned || this.flash > 0.4) eyeScale = Math.min(eyeScale, 0.35);
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
    return this.koT > 0.6;
  }
}
