import type { MeshBasicMaterial } from 'three';
import { FIRE_STYLE, GAITS, HIT_REACTION, RECOIL, VICTORY_SETS, type FireStyle, type GaitProfile, type RecoilProfile, type VictoryMove } from '../config/animation';
import type { CardId, DashStyle, IdleStyle, VictoryStyle } from '../config/types';
import { clamp, clamp01, damp, dampAngle, ease, lerp, smoothstep, Spring, TAU, wrapAngle } from '../core/math';
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
  action: 'none' | 'windup' | 'dash' | 'rush' | 'recover' | 'cut' | 'feint';
  /** DIRECTOR'S CUT stage while action === 'cut'. */
  cutStage: 'prep' | 'aim' | 'lock' | 'gap' | null;
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
  /** Alpha 1.5 — FALSE START read window is open (coiled, ready to counter). */
  reading: boolean;
  /** Alpha 1.5.5: seconds until the next auto shot while the fighter wants to fire (-1 = not firing). */
  fireIn: number;
  /** Alpha 1.5.5: Zoe's SHOCK is charging in her hand. */
  zap: boolean;
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
    cutStage: null,
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
    reading: false,
    fireIn: -1,
    zap: false,
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

/** Last victory routine per fighter look, so the same one never plays twice in a row. */
const lastVictory = new Map<string, number>();

/** Victory routines that begin with a full turn on the spot. */
const SPIN_START: ReadonlySet<VictoryMove> = new Set<VictoryMove>(['peace_sign', 'hype_spin', 'grace_pirouette']);

/**
 * Alpha 1.5.6: kick a damped spring so its first swing peaks at `peak` (same units as the
 * spring value). Lets every motion be tuned in what the eye sees — radians or metres — instead
 * of raw impulses.
 */
function kickTo(s: Spring, peak: number): void {
  const w = Math.sqrt(s.stiffness);
  const z = Math.min(0.95, s.damping / (2 * w));
  const r = Math.sqrt(1 - z * z);
  s.kick((peak * w) / Math.exp((-z / r) * Math.atan2(r, z)));
}

/** Alpha 1.5.6 — short readable reactions to key moments of the show. */
export type AnimCue = 'combo' | 'trick' | 'counter' | 'brace';
const CUE_TIME: Record<AnimCue, number> = { combo: 0.42, trick: 0.6, counter: 0.36, brace: 0.32 };

/** Callbacks the battle view uses to spawn world effects in sync with animation beats. */
export interface AnimEvents {
  /** A heavy footfall (dust / tiny shake). */
  onStep?: (heavy: boolean) => void;
  /** KO body hits the floor. */
  onLand?: (strength: number) => void;
  /** Victory flourish beat: `heavy` = a stomp / slam, otherwise a sparkle. */
  onFlourish?: (heavy: boolean) => void;
}

/**
 * Procedural animation for one fighter rig. Layered: gait-driven locomotion
 * (stride-matched so feet don't skate, strafing legs, turn steps and a settle
 * after stopping), a living idle (breathing, weight shifts, glances and a style
 * of its own), weapon aim pose and shot flourishes, actions, spring reactions
 * (recoil, hits, stagger), and terminal states (KO / one of three victory
 * routines). All motion is delta-time based, allocation-free per frame and never
 * feeds back into the simulation.
 */
export class FighterAnimator {
  readonly rig: FighterRig;
  readonly idleStyle: IdleStyle;
  readonly dashStyle: DashStyle;
  readonly victoryStyle: VictoryStyle;
  readonly gait: GaitProfile;
  readonly recoil: RecoilProfile;
  readonly fireStyle: FireStyle;
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
  /** Blend weight used by `to()` (victory / flair / stagger mixes). */
  private w = 1;

  private recoilR: Spring;
  private recoilL: Spring;
  private recoilBody = new Spring(150, 11);
  private hitPitch = new Spring(170, 11);
  private hitRoll = new Spring(170, 11);
  private headSnap = new Spring(320, 14);
  private headRoll = new Spring(320, 14);
  private squash = new Spring(230, 12);
  private shove = new Spring(140, 12);
  /** Alpha 1.5: the little sway when a run stops (fore-aft and sideways). */
  private settle = new Spring(70, 7);
  private settleSide = new Spring(70, 7);
  // Alpha 1.5.6 — silhouette-scale motion (see FireStyle.climb / lean / push)
  private climbR: Spring;
  private climbL: Spring;
  private push: Spring;
  /** Heavy shot or heavy hit: one foot steps back to catch the weight. */
  private stepT = -1;
  /** Crash presses forward right after his blast. */
  private pressT = -1;
  /** A sharp change of direction swings the body (momentum), at most this often. */
  private lastSwing = -10;
  private svx = 0;
  private svz = 0;
  private stillArmed = true;
  private evadeT = -1;
  private evadeSide = 1;
  private cueT = -1;
  private cueKind: AnimCue = 'combo';
  // Alpha 1.5.5 — how a shot moves the body (weapon fire styles)
  private shotTwist = new Spring(240, 15);
  private shotChest = new Spring(190, 13);
  private shotDip = new Spring(170, 12);
  private shotNod = new Spring(260, 16);
  private shotSway = 0;
  private lastShotT = -10;
  private seriesIdx = 0;
  private altSign = 1;
  private braceW = 0;
  /** Recent small hits soften the next flinch (no exaggerated reaction to every pellet). */
  private hitHeat = 0;
  private hitAlt = 1;
  /** Gait direction with hysteresis (no flicker between running forward and backpedalling). */
  private backpedal = false;
  /** After a dash: a short recovery into the stance, leaning against the momentum. */
  private dashRecT = -1;
  private dashLX = 0;
  private dashLZ = 1;
  private readonly heavyBody: boolean;
  /** Face mimicry (Kai): seconds to the next single-brow flash, and how long the current one lasts. */
  private browT = 3 + Math.random() * 4;
  private browUp = 0;
  private flash = 0;
  private blinkT = 2;
  private blinkDur = 0;
  private mouthT = 0;
  private koT = -1;
  private koYaw = 0;
  private koLanded = 0;
  private victoryT = -1;
  private victoryMove: VictoryMove = 'hype_jump';
  private beatN = 0;
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
  /** The weapon groups' own tilt from the model (the hand grip), kept under any flourish spin. */
  private weaponTiltR = 0;
  private weaponTiltL = 0;
  // living idle
  private breathRate: number;
  private shift = 0;
  private shiftTarget = 0;
  private shiftT = 2 + Math.random() * 3;
  private glance = 0;
  private glanceTarget = 0;
  private glanceT = 1.5 + Math.random() * 2;
  // locomotion memory
  private stopArmed = false;
  private lastLX = 0;
  private lastLZ = 1;
  private turnPh = 0;
  // shot flourishes
  private shotN = 0;
  private twirlT = -1;
  private pumpT = -1;
  private tapT = -1;
  // per-frame outputs (reset at the top of update)
  private wSpin = 0;
  private wFlip = 0;
  private yawAdd = 0;
  private sx = 1;
  private sy = 1;
  private sz = 1;

  constructor(rig: FighterRig, idle: IdleStyle, dash: DashStyle, victory: VictoryStyle) {
    this.rig = rig;
    this.idleStyle = idle;
    this.dashStyle = dash;
    this.victoryStyle = victory;
    this.gait = GAITS[idle];
    this.recoil = RECOIL[rig.look.weapon];
    this.fireStyle = FIRE_STYLE[rig.look.weapon];
    this.heavyBody = idle === 'heavy' || idle === 'champion' || idle === 'brawler';
    // heavier weapons come back to the stance more slowly (same damping ratio, lower frequency)
    const wt = this.fireStyle.weight;
    this.climbR = new Spring(220 / (wt * wt), 15 / wt);
    this.climbL = new Spring(220 / (wt * wt), 15 / wt);
    this.push = new Spring(120 / (wt * wt), 11 / wt);
    this.recoilR = new Spring(this.recoil.stiffness, this.recoil.damping);
    this.recoilL = new Spring(this.recoil.stiffness, this.recoil.damping);
    this.weaponBaseR = rig.weaponR?.position.y ?? 0;
    this.weaponBaseL = rig.weaponL?.position.y ?? 0;
    this.weaponTiltR = rig.weaponR?.rotation.x ?? 0;
    this.weaponTiltL = rig.weaponL?.rotation.x ?? 0;
    this.breathRate = idle === 'heavy' || idle === 'champion' ? 1.25 : idle === 'bouncy' || idle === 'brawler' ? 2.2 : 1.7;
  }

  reset(yaw: number): void {
    this.koT = -1;
    this.koLanded = 0;
    this.victoryT = -1;
    this.dashT = -1;
    this.spinT = -1;
    this.staggerT = -1;
    this.twirlT = this.pumpT = this.tapT = -1;
    this.dashRecT = -1;
    this.lastShotT = -10;
    this.seriesIdx = 0;
    this.braceW = 0;
    this.hitHeat = 0;
    this.shotSway = 0;
    this.backpedal = false;
    this.flash = 0;
    this.flourishDone = false;
    this.yaw = yaw;
    this.prevYaw = yaw;
    this.yawRate = 0;
    this.yawInit = true;
    this.aimW = 0;
    this.accX = this.accZ = 0;
    this.stopArmed = false;
    for (const s of [this.recoilR, this.recoilL, this.recoilBody, this.hitPitch, this.hitRoll, this.headSnap, this.headRoll, this.squash, this.shove, this.settle, this.settleSide, this.shotTwist, this.shotChest, this.shotDip, this.shotNod, this.climbR, this.climbL, this.push]) s.reset();
    this.stepT = this.pressT = this.evadeT = this.cueT = -1;
    this.stillArmed = true;
    this.svx = this.svz = 0;
    this.cur = zeroPose();
    const rig = this.rig;
    rig.body.visible = true;
    rig.koEyes.visible = false;
    rig.eyes.visible = true;
    rig.body.scale.set(1, 1, 1);
    rig.body.position.set(0, 0, 0);
    rig.body.rotation.set(0, 0, 0);
    if (rig.weaponR) {
      rig.weaponR.position.y = this.weaponBaseR;
      rig.weaponR.rotation.set(this.weaponTiltR, 0, 0);
    }
    if (rig.weaponL) {
      rig.weaponL.position.y = this.weaponBaseL;
      rig.weaponL.rotation.set(this.weaponTiltL, 0, 0);
    }
  }

  // ----------------------------------------------------------- triggers
  fire(muzzle: number, heavy: boolean): void {
    // a knocked-out or celebrating fighter does not shoot (late events are ignored)
    if (this.koT >= 0 || this.victoryT >= 0) return;
    const r = this.recoil;
    const k = heavy ? 2.4 : 1;
    // Alpha 1.5.5 — fire style: a committed opening shot, then a lighter cadence for the series
    const fs = this.fireStyle;
    const first = this.t - this.lastShotT > 0.8;
    this.seriesIdx = first ? 0 : (this.seriesIdx + 1) % fs.series.length;
    this.lastShotT = this.t;
    const base = first ? fs.firstShot : fs.series[this.seriesIdx];
    const sk = base * (heavy ? 1.8 : 1);
    // standing, the legs and chest take the kick; on the move only the upper body does
    const moving = Math.min(1, this.speedN * 1.6);
    const side = this.rig.look.weapon === 'twin_blasters' ? (muzzle === 1 ? -1 : 1) : 1;
    this.altSign = -this.altSign;
    this.shotTwist.kick(fs.twist * 30 * sk * side * (1 + moving * 0.25));
    this.shotChest.kick(fs.chest * 26 * sk * (1 - moving * 0.35));
    this.shotDip.kick(fs.dip * 24 * sk * (1 - moving * 0.7));
    this.shotNod.kick(fs.nod * 30 * sk);
    this.shotSway = fs.sway * this.altSign * sk;
    // Alpha 1.5.6 — what reads at battle distance: the muzzle climbs, the upper body rocks back
    // (feet planted), the weight goes to the heels; heavy shots twice as much plus a step back
    const wpn = this.rig.look.weapon;
    const climb = Math.min(0.42, fs.climb * base * (heavy ? 1.5 : 1));
    if (wpn === 'twin_blasters') kickTo(muzzle === 1 ? this.climbL : this.climbR, climb);
    else {
      kickTo(this.climbR, climb);
      // the support hand rides along on two-handed weapons
      if (wpn !== 'ricochet') kickTo(this.climbL, climb * 0.8);
    }
    const settled = 1 - moving * 0.45;
    // Crash (brawler) barely gives ground: he leans back less and then presses forward
    const back = this.idleStyle === 'brawler' ? 0.6 : 1;
    kickTo(this.settle, -Math.min(0.26, fs.lean * base * settled * back * (heavy ? 1.9 : 1)));
    kickTo(this.push, Math.min(0.24, fs.push * base * (1 - moving * 0.6) * back * (heavy ? 1.9 : 1)));
    if (heavy) this.stepT = 0;
    if (this.idleStyle === 'brawler') this.pressT = 0;
    if (muzzle === 1) this.recoilL.kick(r.kick * k);
    else this.recoilR.kick(r.kick * k);
    // Two-handed weapons rock both arms (Kai's trick pistol is one-handed: his free hand stays loose).
    const w = this.rig.look.weapon;
    if (w !== 'twin_blasters' && w !== 'ricochet') this.recoilL.kick(r.kick * (w === 'stinger' ? 0.35 : 0.6) * k);
    this.recoilBody.kick((r.spine * 60 + (heavy ? 2.5 : 0)) * k);
    if (r.shove > 0 || heavy) this.shove.kick(-(r.shove + (heavy ? 3 : 0)));
    if (heavy) this.squash.kick(-2.5);
    this.glowPulse = heavy ? 1.8 : 0.9;
    // weapon-specific follow-through
    this.shotN++;
    if (w === 'ricochet' && !heavy && this.shotN % 4 === 0 && this.twirlT < 0) this.twirlT = 0; // showman spins the pistol every few shots
    else if (w === 'boom_cannon') this.pumpT = 0; // pump the shotgun
    else if (w === 'stinger' && !heavy) this.tapT = 0; // the second barrel of the double tap
  }

  hit(dx: number, dz: number, heavy: boolean): void {
    // projectile travel direction in the fighter's local frame
    const s = Math.sin(-this.yaw);
    const c = Math.cos(-this.yaw);
    const lx = dx * c + dz * s;
    const lz = -dx * s + dz * c;
    // Alpha 1.5.5: a quick stream of small hits flinches less each time (heavy hits always land in full)
    const soft = heavy ? 1 : 1 / (1 + this.hitHeat * 1.4);
    this.hitHeat = Math.min(3, this.hitHeat + (heavy ? 0.2 : 0.45));
    this.hitAlt = -this.hitAlt;
    const k = (heavy ? HIT_REACTION.heavy : HIT_REACTION.light) * soft;
    this.hitPitch.kick(lz * 7 * k);
    this.hitRoll.kick(-lx * 6 * k);
    this.headSnap.kick(lz * 11 * k);
    this.headRoll.kick((-lx * 9 + this.hitAlt * 2.5) * k);
    this.squash.kick(4 * k);
    // a heavy hit shoves the body along the blow; the feet catch it in the stagger
    if (heavy && this.koT < 0) {
      this.shove.kick(lz * 4);
      // Alpha 1.5.6: the whole upper body is thrown along the blow and a foot steps back
      kickTo(this.settle, lz * 0.14);
      kickTo(this.settleSide, -lx * 0.12);
      kickTo(this.push, -lz * 0.08);
      this.stepT = 0;
    }
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
    this.dashRecT = -1;
    this.dashYaw = Math.atan2(dx, dz);
    // Alpha 1.5.6: the body throws itself into the dash (a lunge most, a blink least)
    const rel = this.dashYaw - this.yaw;
    const sf = this.dashStyle === 'lunge' ? 1.2 : this.dashStyle === 'blink' ? 0.35 : this.dashStyle === 'roll' ? 0.55 : 0.8;
    kickTo(this.settle, Math.cos(rel) * 0.2 * sf);
    kickTo(this.settleSide, -Math.sin(rel) * 0.2 * sf);
  }

  /** Alpha 1.5.6 — a perfect dodge: a quick lean away and a light hop (visual only). */
  evade(): void {
    if (this.koT >= 0 || this.victoryT >= 0) return;
    this.evadeSide = -this.evadeSide;
    this.evadeT = 0;
    kickTo(this.settleSide, this.evadeSide * 0.17);
  }

  /** Alpha 1.5.6 — a short reaction to a moment of the show (combo, trick shot, counter, block). */
  cue(kind: AnimCue): void {
    if (this.koT >= 0 || this.victoryT >= 0) return;
    this.cueKind = kind;
    this.cueT = 0;
    if (kind === 'combo') kickTo(this.settle, -0.06);
    else if (kind === 'counter' || kind === 'brace') kickTo(this.settle, 0.09);
  }

  ko(): void {
    if (this.koT >= 0) return;
    this.koT = 0;
    this.staggerT = -1;
    this.victoryT = -1;
    // Fall backward along the finishing blow.
    const l = Math.hypot(this.lastHitX, this.lastHitZ);
    this.koYaw = l > 0.01 ? Math.atan2(-this.lastHitX / l, -this.lastHitZ / l) : this.yaw;
  }

  /**
   * Start a victory routine: one of the three of this fighter's style, at random and
   * never the previous one again (`variant` forces one, for previews and tests).
   */
  victory(variant?: number): void {
    if (this.victoryT >= 0 || this.koT >= 0) return;
    const set = VICTORY_SETS[this.victoryStyle];
    const key = this.rig.look.id;
    let i: number;
    if (variant !== undefined) i = ((Math.floor(variant) % set.length) + set.length) % set.length;
    else {
      i = Math.floor(Math.random() * set.length);
      const last = lastVictory.get(key);
      if (set.length > 1 && i === last) i = (i + 1 + Math.floor(Math.random() * (set.length - 1))) % set.length;
    }
    lastVictory.set(key, i);
    this.victoryMove = set[i];
    this.victoryT = 0;
    this.flourishDone = false;
    this.beatN = 0;
    this.spinT = SPIN_START.has(this.victoryMove) ? 0 : -1;
  }

  /** Ease out of a victory routine back into the idle (menu showcase), without a pose pop. */
  endVictory(): void {
    this.victoryT = -1;
    this.spinT = -1;
  }

  /** The routine playing now (null when not celebrating). */
  get victoryRoutine(): VictoryMove | null {
    return this.victoryT >= 0 ? this.victoryMove : null;
  }

  // ------------------------------------------------------------- update
  update(dt: number, inp: AnimInput): void {
    const rig = this.rig;
    const G = this.gait;
    this.t += dt;
    const t = this.t;
    const P = this.tgt;
    for (const k of POSE_KEYS) P[k] = 0;
    this.wSpin = 0;
    this.wFlip = 0;
    this.yawAdd = 0;
    this.sx = this.sy = this.sz = 1;
    const terminal = this.koT >= 0 || this.victoryT >= 0;

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
    if (this.spinT >= 0) {
      this.spinT += dt;
      const sp = clamp01(this.spinT / 0.7);
      this.yawAdd += ease.outCubic(sp) * TAU;
      if (sp >= 1) this.spinT = -1;
    }

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
    let resid = 0;
    let lx = 0;
    let lz = 0;
    if (speed > 0.15) {
      lx = (inp.vx * cy + inp.vz * sy) / speed;
      lz = (-inp.vx * sy + inp.vz * cy) / speed;
      const a = Math.atan2(lx, lz);
      // switch between running forward and backpedalling with a margin, so the legs never flicker
      const absA = Math.abs(a);
      if (this.backpedal) {
        if (absA < 1.75) this.backpedal = false;
      } else if (absA > 2.15) this.backpedal = true;
      if (!this.backpedal) {
        hipOff = clamp(a, -0.85, 0.85);
        resid = a - hipOff;
      } else {
        const b = wrapAngle(a + Math.PI);
        hipOff = clamp(b, -0.85, 0.85);
        resid = b - hipOff;
        legDir = -1;
      }
      this.lastLX = lx;
      this.lastLZ = lz;
    }
    // Stride-matched cadence: one full cycle per strideLength of travel.
    const cadenceBoost = inp.overdrive ? 1.08 : 1;
    this.phase += ((speed * cadenceBoost) / G.strideLength) * TAU * dt * legDir;
    const ph = this.phase;
    const sinP = Math.sin(ph);
    const swing = G.legSwing * A;
    // The hips turn toward the travel direction (up to ~50°); whatever is left over
    // (strafing) swings the legs sideways, so the feet follow the ground instead of skating.
    const fwdK = Math.cos(resid);
    const sideK = Math.sin(resid) * 0.85;
    P.hipsRY = hipOff * sN;
    P.spineRY = -hipOff * sN * 0.85;
    P.headRY = -hipOff * sN * 0.12;
    P.legLX = -sinP * swing * fwdK;
    P.legRX = sinP * swing * fwdK;
    P.legLZ = sinP * swing * sideK;
    P.legRZ = -sinP * swing * sideK;
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
    P.rollRZ = -lx * G.lean * 0.8 * A - clamp(this.accX * G.accelLean * 0.06, -0.16, 0.16) + clamp(this.yawRate * G.turnBank * sN, -0.18, 0.18);
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
    } else if (rig.look.weapon === 'breaker') {
      // PRIME BREAKER carried low across the body, muzzle down: the weight shows in the arms
      P.shRX = -0.22 + sinP * A * 0.08;
      P.shRZ = 0.24;
      P.elR = -1.0;
      P.shLX = -0.82 - sinP * A * 0.06;
      P.shLZ = -0.56;
      P.elL = -0.78;
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
    } else if (rig.look.weapon === 'ricochet') {
      // the long trick pistol carried muzzle-up at the shoulder, showman style
      P.shRX = -0.45 + sinP * A * 0.12;
      P.shRZ = 0.12;
      P.elR = -1.75;
      P.shLX = sinP * A * 0.6;
      P.shLZ = 0.16;
      P.elL = -0.35 - A * 0.4;
    } else if (rig.look.weapon === 'stinger') {
      // compact blaster carried close at the chest, the free hand near the wrist
      P.shRX = -0.55 + sinP * A * 0.1;
      P.shRZ = 0.2;
      P.elR = -1.35;
      P.shLX = -0.6 - sinP * A * 0.1;
      P.shLZ = -0.3;
      P.elL = -1.3;
    }
    // Shoulders counter-rotate against the stride (applied after the aim pose).
    const twist = sinP * A * 0.09 * fwdK;
    // The chest leads a fast turn toward the target, the hips follow a beat later.
    P.hipsRY -= clamp(this.yawRate * 0.018, -0.14, 0.14) * sN;
    // Foot contact beats
    const contact = Math.abs(sinP);
    if (A > 0.35 && contact > 0.97 && this.t - this.lastContact > 0.18) {
      this.lastContact = this.t;
      if (this.idleStyle === 'heavy' || this.idleStyle === 'champion') this.events.onStep?.(true);
      this.squash.kick(G.contactSquash * 30 * A);
    }
    // A run that stops settles with a sway instead of freezing on the spot (Alpha 1.5.6: sized
    // to read at battle distance), a start pushes off, and a sharp change of direction swings
    // the body along its old momentum. Heavier bodies (gait lean) swing more.
    const wk = clamp(G.lean / 0.16, 0.8, 1.25);
    if (this.speedN > 0.6) this.stopArmed = true;
    else if (this.stopArmed && this.speedN < 0.25) {
      this.stopArmed = false;
      if (!terminal) {
        kickTo(this.settle, this.lastLZ * 0.27 * wk);
        kickTo(this.settleSide, -this.lastLX * 0.2 * wk);
      }
    }
    if (this.speedN < 0.15) this.stillArmed = true;
    else if (this.stillArmed && this.speedN > 0.45 && speed > 0.15) {
      this.stillArmed = false;
      if (!terminal) {
        kickTo(this.settle, lz * 0.12 * wk);
        kickTo(this.settleSide, -lx * 0.1 * wk);
      }
    }
    this.svx = damp(this.svx, inp.vx, 6, dt);
    this.svz = damp(this.svz, inp.vz, 6, dt);
    const sv2 = Math.hypot(this.svx, this.svz);
    if (!terminal && speed > 1.8 && sv2 > 1.8 && this.t - this.lastSwing > 0.45 && (inp.vx * this.svx + inp.vz * this.svz) / (speed * sv2) < 0.15) {
      this.lastSwing = this.t;
      const ox = (this.svx * cy + this.svz * sy) / sv2;
      const oz = (-this.svx * sy + this.svz * cy) / sv2;
      kickTo(this.settle, oz * 0.2 * wk);
      kickTo(this.settleSide, -ox * 0.2 * wk);
    }
    // Turning on the spot: small stepping feet, the hips lag behind the shoulders.
    const turnW = terminal ? 0 : clamp01((Math.abs(this.yawRate) - 1.2) / 4) * (1 - Math.min(1, sN * 2.5));
    if (turnW > 0.01) {
      this.turnPh += Math.abs(this.yawRate) * dt * 2.2;
      const s1 = Math.max(0, Math.sin(this.turnPh));
      const s2 = Math.max(0, -Math.sin(this.turnPh));
      P.kneeL += s1 * 0.55 * turnW;
      P.legLX -= s1 * 0.18 * turnW;
      P.kneeR += s2 * 0.55 * turnW;
      P.legRX -= s2 * 0.18 * turnW;
      P.hipsRY -= clamp(this.yawRate * 0.035, -0.25, 0.25) * turnW;
      P.bodyY += (s1 + s2) * 0.015 * turnW;
    }

    // ----------------------------------------------------------- idle
    // living idle state keeps running so it never pops when the fighter stops
    this.shiftT -= dt;
    if (this.shiftT <= 0) {
      this.shiftTarget = this.shiftTarget > 0 ? -(0.4 + Math.random() * 0.6) : 0.4 + Math.random() * 0.6;
      this.shiftT = 3.5 + Math.random() * 4;
    }
    this.shift = damp(this.shift, this.shiftTarget, 1.6, dt);
    this.glanceT -= dt;
    if (this.glanceT <= 0) {
      if (this.glanceTarget !== 0) {
        this.glanceTarget = 0;
        this.glanceT = 1.8 + Math.random() * 3;
      } else {
        // in a fight the eyes stay on the opponent: only a quick, small check
        this.glanceTarget = (Math.random() * 2 - 1) * (inp.combat ? 0.12 : 0.42);
        this.glanceT = inp.combat ? 0.35 + Math.random() * 0.3 : 0.7 + Math.random() * 0.8;
      }
    }
    this.glance = damp(this.glance, this.glanceTarget, 5, dt);
    const idleW = terminal || inp.ko ? 0 : 1 - Math.min(1, sN * 3);
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
        case 'showman': {
          // Kai: cocky — weight on the back leg, the head nodding to the show's beat
          const beat = Math.sin(t * 4.4);
          P.hipsRZ -= 0.05 * idleW;
          P.bodyX -= 0.02 * idleW;
          P.spineRZ += 0.05 * idleW;
          P.kneeL += 0.2 * idleW;
          P.legLX -= 0.12 * idleW;
          P.kneeR += 0.05 * idleW;
          P.headRX += beat * 0.035 * idleW;
          P.headRZ += 0.04 * idleW;
          P.spineRY += Math.sin(t * 2.2) * 0.04 * idleW;
          P.shLZ += 0.06 * idleW;
          break;
        }
        case 'feint': {
          // Rina: light on the balls of the feet, small shuffles from side to side
          const sh = Math.sin(t * 3.4);
          const b = 0.5 + 0.5 * Math.sin(t * 6.8);
          P.bodyX += sh * 0.035 * idleW;
          P.bodyY += (b * 0.02 - 0.03) * idleW;
          P.kneeL += (0.3 + Math.max(0, sh) * 0.12) * idleW;
          P.kneeR += (0.3 + Math.max(0, -sh) * 0.12) * idleW;
          P.legLX -= 0.14 * idleW;
          P.legRX -= 0.14 * idleW;
          P.legLZ += 0.06 * idleW;
          P.legRZ -= 0.06 * idleW;
          P.spineRX += 0.08 * idleW;
          P.hipsRZ += sh * 0.04 * idleW;
          P.headRY += Math.sin(t * 1.7) * 0.06 * idleW;
          break;
        }
        case 'brawler': {
          // Crash: restless — bouncing weight, rolling shoulders, a twitchy head
          const b = Math.abs(Math.sin(t * 5));
          const roll = Math.sin(t * 2.6);
          P.bodyY += (b * 0.03 - 0.03) * idleW;
          P.kneeL += (0.28 + b * 0.08) * idleW;
          P.kneeR += (0.28 + b * 0.08) * idleW;
          P.legLZ += 0.12 * idleW;
          P.legRZ -= 0.12 * idleW;
          P.legLX -= 0.1 * idleW;
          P.legRX -= 0.1 * idleW;
          P.spineRX += 0.12 * idleW;
          P.shLZ += roll * 0.08 * idleW;
          P.shRZ += roll * 0.08 * idleW;
          P.spineRY += roll * 0.06 * idleW;
          P.headRZ += (Math.floor(t * 1.3) % 3 === 0 ? 0.08 : 0) * idleW;
          break;
        }
        case 'tactician': {
          // Zoe: low ready, weight forward, the head scanning the arena in short deliberate stops
          const scan = Math.sin(Math.floor(t * 0.9) * 2.4) * 0.22;
          P.kneeL += 0.22 * idleW;
          P.kneeR += 0.22 * idleW;
          P.legLX -= 0.1 * idleW;
          P.legRX -= 0.06 * idleW;
          P.legLZ += 0.06 * idleW;
          P.legRZ -= 0.06 * idleW;
          P.spineRX += 0.1 * idleW;
          P.bodyY -= 0.02 * idleW;
          P.headRY += scan * idleW;
          P.headRX += 0.03 * idleW;
          P.spineRY += scan * 0.2 * idleW;
          break;
        }
        case 'champion': {
          // Victor: still and upright — a slow deep breath, chin up, a wide planted stance
          const br = Math.sin(t * 1.05);
          P.spineRX += (-0.05 + br * 0.02) * idleW;
          P.headRX -= 0.06 * idleW;
          P.legLZ += 0.09 * idleW;
          P.legRZ -= 0.09 * idleW;
          P.kneeL += 0.08 * idleW;
          P.kneeR += 0.08 * idleW;
          P.shLZ += (0.04 + br * 0.02) * idleW;
          P.shRZ -= (0.04 + br * 0.02) * idleW;
          break;
        }
      }
      // every fighter: breathing (chest and shoulders rise), weight shifts, glances
      const br = Math.sin(t * this.breathRate);
      P.spineRX += (Math.sin(t * 2.3) * 0.016 - br * 0.012) * idleW;
      P.shLZ += br * 0.015 * idleW;
      P.shRZ -= br * 0.015 * idleW;
      P.bodyY += br * 0.004 * idleW;
      const sh = this.idleStyle === 'champion' ? this.shift * 0.5 : this.shift;
      P.hipsRZ += sh * 0.045 * idleW;
      P.bodyX += sh * 0.018 * idleW;
      P.kneeL += Math.max(0, -sh) * 0.12 * idleW;
      P.kneeR += Math.max(0, sh) * 0.12 * idleW;
      P.headRY += this.glance * idleW;
      P.spineRY += this.glance * 0.15 * idleW;
    }

    // ------------------------------------------------------ aim pose
    const aiming = inp.combat && !inp.ko && !inp.stunned && !inp.knockback && this.victoryT < 0;
    this.aimW = damp(this.aimW, aiming ? 1 : 0, 10, dt);
    const aw = this.aimW;
    // Alpha 1.5.5 — brace: some weapons settle into the stance just before the trigger
    // (the real fire timer of the simulation), the heavier ones dropping lower
    const fs = this.fireStyle;
    const bracing = aiming && fs.brace > 0 && inp.fireIn >= 0 && inp.fireIn < fs.brace && inp.action === 'none';
    this.braceW = damp(this.braceW, bracing ? 1 : 0, bracing ? 16 : 7, dt);
    const brace = this.braceW * fs.braceAmt;
    if (aw > 0.001) {
      this.w = aw;
      // breathing / step bob of the aimed arms keeps the stance alive (held still while bracing)
      const bob = (Math.sin(ph * 2) * G.armBob * A + Math.sin(t * 2.1) * 0.02 * (1 - A)) * (1 - brace * 0.85);
      switch (rig.look.weapon) {
        case 'twin_blasters':
          this.to('shRX', -1.42 + bob);
          this.to('shRZ', 0.16);
          this.to('elR', -0.22);
          this.to('shLX', -1.42 - bob);
          this.to('shLZ', -0.16);
          this.to('elL', -0.22);
          break;
        case 'boom_cannon':
          this.to('shRX', -0.45 + bob * 0.5);
          this.to('shRZ', -0.05);
          this.to('elR', -1.12);
          this.to('shLX', -0.95 + bob * 0.5);
          this.to('shLZ', -0.5);
          this.to('elL', -1.05);
          P.spineRY += 0.12 * aw;
          break;
        case 'pulse_rifle':
          // shouldered marksman stance: rifle along the line of sight, cheek on the stock
          this.to('shRX', -0.86 + bob * 0.35);
          this.to('shRZ', 0.3);
          this.to('elR', -0.82);
          this.to('shLX', -1.36 + bob * 0.35);
          this.to('shLZ', -0.36);
          this.to('elL', -0.4);
          P.spineRY += -0.08 * aw;
          P.headRX += 0.07 * aw;
          P.headRZ -= 0.06 * aw;
          break;
        case 'breaker':
          // heavy chest-level hold: wide planted stance, both hands on the rifle, braced forward
          this.to('shRX', -0.6 + bob * 0.3);
          this.to('shRZ', 0.26);
          this.to('elR', -0.98);
          this.to('shLX', -1.18 + bob * 0.3);
          this.to('shLZ', -0.46);
          this.to('elL', -0.52);
          P.spineRY += -0.1 * aw;
          P.spineRX += 0.05 * aw;
          P.legLZ += 0.05 * aw;
          P.legRZ -= 0.05 * aw;
          break;
        case 'ricochet':
          // bladed showman stance: gun arm out straight, the free hand loose at the hip
          this.to('shRX', -1.42 + bob);
          this.to('shRZ', 0.12);
          this.to('elR', -0.18);
          this.to('shLX', -0.15 - bob * 0.3);
          this.to('shLZ', 0.5);
          this.to('elL', -1.15);
          P.spineRY += -0.16 * aw;
          P.headRY += 0.1 * aw;
          break;
        case 'stinger':
          // compact two-hand hold close to the face: low, coiled, ready to step
          this.to('shRX', -1.22 + bob * 0.5);
          this.to('shRZ', 0.24);
          this.to('elR', -0.55);
          this.to('shLX', -1.28 + bob * 0.5);
          this.to('shLZ', -0.3);
          this.to('elL', -0.66);
          P.spineRX += 0.05 * aw;
          P.kneeL += 0.12 * aw;
          P.kneeR += 0.12 * aw;
          break;
        case 'tech_carbine':
          this.to('shRX', -0.78 + bob * 0.5);
          this.to('shRZ', 0.3);
          this.to('elR', -0.92);
          this.to('shLX', -1.28 + bob * 0.5);
          this.to('shLZ', -0.42);
          this.to('elL', -0.5);
          P.spineRY += -0.06 * aw;
          P.headRX += 0.05 * aw;
          break;
      }
    }
    P.spineRY += twist * (1 - 0.6 * aw);
    if (brace > 0.01) {
      P.kneeL += 0.12 * brace * (1 - sN);
      P.kneeR += 0.12 * brace * (1 - sN);
      P.bodyY -= 0.025 * brace * (1 - sN);
      P.spineRX += 0.04 * brace;
    }
    // the controlled shot-to-shot tilt fades between shots
    this.shotSway = damp(this.shotSway, 0, 6, dt);
    P.spineRZ += this.shotSway * aw;
    this.hitHeat = Math.max(0, this.hitHeat - dt * 1.5);

    // ------------------------------------------------ shot flourishes
    if (this.pumpT >= 0) {
      // BOOM CANNON: the support hand racks the pump right after the blast
      this.pumpT += dt;
      const p = (this.pumpT - 0.08) / 0.3;
      if (p >= 1) this.pumpT = -1;
      else if (p > 0) {
        const s = Math.sin(p * Math.PI);
        P.elL += 0.55 * s * aw;
        P.shLX += 0.22 * s * aw;
      }
    }
    if (this.twirlT >= 0) {
      // RICOCHET: a quick spin of the pistol around the trigger finger
      this.twirlT += dt;
      const p = this.twirlT / 0.42;
      if (p >= 1) this.twirlT = -1;
      else this.wFlip = ease.inOutCubic(p) * TAU;
    }
    if (this.tapT >= 0) {
      // STINGER: the second barrel of the double tap
      this.tapT += dt;
      if (this.tapT > 0.07) {
        this.recoilR.kick(this.recoil.kick * 0.45);
        this.tapT = -1;
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
        // every weapon charges its own way
        switch (rig.look.weapon) {
          case 'twin_blasters':
            // both blasters brought together onto the line
            P.shLZ -= 0.12 * crouch;
            P.shRZ += 0.12 * crouch;
            P.rollRX += 0.06 * crouch;
            break;
          case 'boom_cannon':
            // braced: feet wide, chest over the barrel
            P.legLZ += 0.12 * crouch;
            P.legRZ -= 0.12 * crouch;
            P.spineRX += 0.18 * crouch;
            break;
          case 'ricochet':
            // BANK SHOT: bladed side-on, the eyes on the barrier, the free arm out for balance
            P.spineRY -= 0.45 * crouch;
            P.headRY += 0.25 * crouch;
            P.shLZ += 0.6 * crouch;
            P.elL -= 0.3 * crouch;
            break;
          case 'stinger':
            P.kneeL += 0.15 * crouch;
            P.kneeR += 0.15 * crouch;
            P.spineRX += 0.2 * crouch;
            break;
          case 'pulse_rifle':
          case 'tech_carbine':
            // cheek tight to the stock
            P.headRX += 0.12 * crouch;
            P.headRZ -= 0.05 * crouch;
            break;
        }
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
    } else if (inp.action === 'cut') {
      // DIRECTOR'S CUT: the rifle goes up over the head for the alert (free arm out to the crowd), then comes down to the
      // shoulder; each line is aimed from a crouched, shouldered stance that freezes at the lock
      const p = clamp01(inp.actionT / Math.max(0.05, inp.actionTotal));
      if (inp.cutStage === 'prep') {
        const up = ease.outBack(Math.min(1, p * 1.8));
        P.shRX = -0.3 - 2.0 * up;
        P.shRZ = 0.12 + 0.3 * up;
        P.elR = -0.4 - 0.3 * up;
        // showman flourish: the free arm thrown out to the side, face to the crowd
        P.shLX = -0.25 - 0.45 * up;
        P.shLZ = -0.3 - 1.05 * up;
        P.elL = -0.35;
        P.spineRX -= 0.16 * up;
        P.headRX -= 0.18 * up;
        P.rollRX -= 0.05 * up;
        P.kneeL += 0.12 * up;
        P.kneeR += 0.12 * up;
        P.bodyY -= 0.03 * up;
        this.glowPulse = Math.max(this.glowPulse, 0.8 + p * 1.4);
      } else {
        const locked = inp.cutStage === 'lock';
        const settle = inp.cutStage === 'aim' ? ease.outCubic(Math.min(1, p * 3)) : 1;
        P.shRX = -0.92 * settle + P.shRX * (1 - settle);
        P.shRZ = 0.3;
        P.elR = -0.8 * settle + P.elR * (1 - settle);
        P.shLX = -1.4 * settle + P.shLX * (1 - settle);
        P.shLZ = -0.36;
        P.elL = -0.42;
        P.spineRY += -0.12;
        P.spineRX += locked ? 0.1 : 0.06;
        P.headRX += 0.08;
        P.headRZ -= 0.07;
        P.kneeL += locked ? 0.32 : 0.2;
        P.kneeR += locked ? 0.32 : 0.2;
        P.legLX -= 0.16;
        P.legRX += 0.1;
        P.legLZ += 0.08;
        P.legRZ -= 0.08;
        P.bodyY -= locked ? 0.06 : 0.035;
        if (locked) this.glowPulse = Math.max(this.glowPulse, 1 + p * 1.6);
      }
    } else if (inp.action === 'recover' && rig.look.weapon === 'breaker') {
      // the champion after his three shots: rifle down, chest out, a breath for the crowd
      const br = Math.sin(t * 3);
      P.shRX = -0.1;
      P.shRZ = 0.22;
      P.elR = -0.55;
      P.shLX = -0.25;
      P.shLZ = 0.3;
      P.elL = -0.35;
      P.spineRX -= 0.1 + br * 0.03;
      P.headRX -= 0.1;
      P.headRZ += 0.06;
    } else if (inp.action === 'recover') {
      P.rollRX += 0.42 + Math.sin(t * 18) * 0.08;
      P.headRX += 0.3;
      P.shLX = -0.5 + Math.sin(t * 20) * 0.5;
      P.shRX = -0.5 - Math.sin(t * 20) * 0.5;
      P.shLZ = 0.8;
      P.shRZ = -0.8;
    } else if (inp.action === 'feint') {
      // FALSE START: a sharp shimmy to one side — low, twisted, the blaster kept up
      // two beats: the shoulders sell the wrong side first, then she drops low into the real step
      const p = clamp01(inp.actionT / Math.max(0.05, inp.actionTotal));
      const fake = p < 0.35 ? Math.sin((p / 0.35) * Math.PI) : 0;
      const k = p > 0.2 ? Math.sin(clamp01((p - 0.2) / 0.8) * Math.PI) : 0;
      const side = inp.dashX * cy + inp.dashZ * sy >= 0 ? 1 : -1;
      P.rollRZ += side * 0.18 * fake - side * 0.32 * k;
      P.spineRY += -side * 0.24 * fake + side * 0.3 * k;
      P.spineRX += 0.16 * k;
      P.kneeL += 0.45 * k + 0.15 * fake;
      P.kneeR += 0.45 * k + 0.15 * fake;
      P.legLZ += 0.22 * k;
      P.legRZ -= 0.22 * k;
      P.bodyY -= 0.1 * k;
      P.headRZ += side * 0.12 * k - side * 0.08 * fake;
    }
    if (inp.zap && !terminal && !inp.stunned) {
      // Zoe's SHOCK: the free hand comes off the carbine and reaches toward the target, sparks crawling over it
      const j = Math.sin(t * 50) * 0.04;
      P.shLX = -1.55 + j;
      P.shLZ = -0.12;
      P.elL = -0.25;
      P.spineRY += 0.18;
      P.spineRX -= 0.04;
      P.headRX += 0.04;
      this.glowPulse = Math.max(this.glowPulse, 1.2);
    }
    if (inp.reading && inp.action === 'none' && !terminal) {
      // FALSE START read window: coiled, waiting for the attack to answer it
      P.kneeL += 0.22;
      P.kneeR += 0.22;
      P.spineRX += 0.1;
      P.bodyY -= 0.04;
      P.headRX += 0.04;
      this.glowPulse = Math.max(this.glowPulse, 0.5 + Math.sin(t * 20) * 0.2);
    }

    // ------------------------------------- Alpha 1.5.6: weight and show moments
    if (this.stepT >= 0) {
      // heavy shot / heavy hit: the right foot steps back to catch the weight, then comes home
      this.stepT += dt;
      const p = this.stepT / 0.38;
      if (p >= 1 || terminal) this.stepT = -1;
      else {
        const k = Math.sin(p * Math.PI);
        P.legRX += 0.5 * k;
        P.kneeR += 0.4 * k;
        P.legLX -= 0.18 * k;
        P.kneeL += 0.15 * k;
        P.bodyY -= 0.035 * k;
      }
    }
    if (this.pressT >= 0) {
      // Crash: right after the blast he presses forward into it
      this.pressT += dt;
      const p = (this.pressT - 0.1) / 0.35;
      if (p >= 1 || terminal) this.pressT = -1;
      else if (p > 0) {
        const k = Math.sin(p * Math.PI);
        P.spineRX += 0.14 * k;
        P.rollRX += 0.05 * k;
        P.headRX -= 0.06 * k;
      }
    }
    if (this.evadeT >= 0) {
      // perfect dodge: a light hop, the shoulders twist away, knees tuck
      this.evadeT += dt;
      const p = this.evadeT / 0.34;
      if (p >= 1 || terminal) this.evadeT = -1;
      else {
        const k = Math.sin(p * Math.PI);
        P.bodyY += 0.06 * k;
        P.spineRY += 0.32 * this.evadeSide * k;
        P.headRY -= 0.12 * this.evadeSide * k;
        P.kneeL += 0.3 * k;
        P.kneeR += 0.3 * k;
        P.legLX -= 0.12 * k;
        P.legRX -= 0.12 * k;
      }
    }
    if (this.cueT >= 0) {
      this.cueT += dt;
      const p = this.cueT / CUE_TIME[this.cueKind];
      if (p >= 1 || terminal) this.cueT = -1;
      else {
        const k = Math.sin(p * Math.PI);
        switch (this.cueKind) {
          case 'combo':
            // a combo lands: chest out, chin up, a little bounce
            P.spineRX -= 0.18 * k;
            P.headRX -= 0.14 * k;
            P.shLZ += 0.2 * k;
            P.shRZ -= 0.2 * k;
            P.bodyY += 0.045 * k;
            break;
          case 'trick':
            // Kai's TRICK SHOT: the pistol spins twice, the head tilts to the crowd
            this.wFlip = ease.inOutCubic(p) * TAU * 2;
            P.headRZ += 0.16 * k;
            P.spineRY -= 0.2 * k;
            P.spineRX -= 0.08 * k;
            break;
          case 'counter':
            // Rina's FALSE START counter: a snap of the shoulders into the shot
            P.spineRY += 0.38 * (1 - p) * k;
            P.spineRX += 0.12 * k;
            P.kneeL += 0.2 * k;
            P.kneeR += 0.2 * k;
            break;
          case 'brace':
            // a shot caught on the shield: dig in
            P.kneeL += 0.26 * k;
            P.kneeR += 0.26 * k;
            P.spineRX += 0.12 * k;
            P.bodyY -= 0.04 * k;
            break;
        }
      }
    }

    // ------------------------------------------------------------ dash
    let rollSpin = 0;
    let bodyScaleX = 1;
    let bodyScaleZ = 1;
    let bodyScaleY = 1;
    rig.body.visible = true;
    if (this.dashT >= 0) {
      this.dashT += dt;
      const dur = this.dashStyle === 'roll' ? 0.32 : this.dashStyle === 'slide' ? 0.34 : 0.3;
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
      } else if (this.dashStyle === 'spin') {
        // Kai: a showman's pirouette dash — one full turn, legs crossing, the pistol up
        this.yawAdd += ease.inOutCubic(smoothstep(0.05, 0.95, p)) * TAU;
        const k = Math.sin(p * Math.PI);
        P.shRX = -2.2 * k + P.shRX * (1 - k);
        P.shRZ = 0.1;
        P.elR = -0.8;
        P.shLX = -0.4;
        P.shLZ = 0.2 - 0.4 * k;
        P.elL = -1.6 * k;
        P.kneeL = 0.35 + 0.5 * k;
        P.kneeR = 0.35;
        P.legLX = -0.3 * k;
        P.legRX = 0.25 * k;
        P.legLZ = -0.15 * k;
        P.rollRX = 0.2 * k;
        P.bodyY = 0.05 * k;
        bodyScaleY = 1 + 0.05 * k;
      } else if (this.dashStyle === 'slide') {
        // Rina: a low slide along the floor — the leading leg out straight, the blaster still up
        const k = smoothstep(0, 0.2, p) * (1 - smoothstep(0.75, 1, p));
        P.bodyY = -0.3 * k;
        P.rollRX = -0.3 * k;
        P.legLX = -1.3 * k;
        P.kneeL = 0.1 * k;
        P.legRX = 0.3 * k;
        P.kneeR = 1.7 * k;
        P.legLZ = 0;
        P.legRZ = 0;
        P.spineRX = 0.15 * k;
        P.headRX = 0.12 * k;
        P.shRX = -1.3;
        P.shRZ = 0.2;
        P.elR = -0.5;
        P.shLX = 0.3 * k;
        P.shLZ = 0.7 * k;
        P.elL = -0.3;
        P.hipsRY = 0.35 * k;
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
          this.squash.kick(this.dashStyle === 'lunge' ? (this.heavyBody ? 8 : 6) : 4);
          if (this.dashStyle === 'lunge') this.events.onStep?.(true);
          else if (this.dashStyle === 'slide' || this.dashStyle === 'spin') this.events.onStep?.(false);
          // the body carries on along the dash for a moment, then the stance catches it
          const rel = this.dashYaw - this.yaw;
          this.dashLX = Math.sin(rel);
          this.dashLZ = Math.cos(rel);
          // Alpha 1.5.6: sized for the battle camera (a blink barely carries on, a heavy body most)
          const inertia = this.dashStyle === 'blink' ? 0.4 : this.heavyBody ? 1.3 : 1;
          kickTo(this.settle, this.dashLZ * 0.15 * inertia);
          kickTo(this.settleSide, -this.dashLX * 0.13 * inertia);
          this.dashRecT = 0;
        }
        this.dashT = -1;
      }
    }
    // ---------------------------------------------------- dash recovery
    if (this.dashRecT >= 0 && this.dashT < 0 && !terminal) {
      this.dashRecT += dt;
      const dur = this.dashStyle === 'lunge' ? (this.heavyBody ? 0.5 : 0.38) : this.dashStyle === 'slide' ? 0.22 : this.dashStyle === 'blink' ? 0.18 : 0.3;
      const rp = this.dashRecT / dur;
      if (rp >= 1) this.dashRecT = -1;
      else {
        // knees soak the stop, the free arms balance, then the aim settles back in
        // (Alpha 1.5.6: deeper and with each style's own finish, so it reads on a phone)
        const w = 1 - ease.inOutCubic(rp);
        const deep = this.heavyBody ? 1.3 : 1;
        P.kneeL += 0.42 * w * deep;
        P.kneeR += 0.42 * w * deep;
        P.legLX -= 0.17 * w * deep;
        P.legRX -= 0.17 * w * deep;
        P.bodyY -= 0.06 * w * deep;
        P.spineRX += 0.1 * w;
        P.shLZ += 0.45 * w * (1 - aw * 0.6);
        P.shRZ -= 0.45 * w * (1 - aw * 0.6);
        if (this.dashStyle === 'roll') {
          // coming up out of the roll, one hand still out to the floor
          P.spineRX += 0.18 * w;
          P.shLX -= 0.5 * w;
        } else if (this.dashStyle === 'spin') {
          // Kai finishes the pirouette with a tilt and a spin of the pistol
          P.headRZ += 0.14 * w;
          this.wFlip = ease.inOutCubic(clamp01(rp * 1.4)) * TAU;
        } else if (this.dashStyle === 'blink') {
          // the glitch re-forms: a short shimmy
          P.spineRZ += Math.sin(this.t * 55) * 0.12 * w;
        } else if (this.dashStyle === 'slide') {
          // Rina pops up out of the slide
          P.bodyY += 0.07 * Math.sin(rp * Math.PI);
        }
      }
    }

    // ------------------------------------------------- heavy-hit stagger
    if (this.staggerT >= 0 && this.koT < 0) {
      this.staggerT += dt;
      const st = this.staggerT / HIT_REACTION.staggerTime;
      if (st >= 1) this.staggerT = -1;
      else {
        // fast rise, eased recovery
        this.w = st < 0.15 ? st / 0.15 : 1 - ease.inOutCubic((st - 0.15) / 0.85);
        const sd = this.staggerSide;
        this.to('spineRX', -0.38);
        this.to('headRX', -0.3);
        this.to('rollRX', -0.22);
        this.to('rollRZ', 0.12 * sd);
        this.to('shLX', -0.9);
        this.to('shRX', -0.9);
        this.to('shLZ', 0.95);
        this.to('shRZ', -0.95);
        this.to('legRX', 0.45);
        this.to('kneeR', 0.35);
        this.to('legLX', -0.2);
        this.to('kneeL', 0.25);
        P.bodyY -= 0.04 * this.w;
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
      P.legLZ = 0;
      P.legRZ = 0;
      P.kneeL = 0.55;
      P.kneeR = 0.2;
      P.headRX = kt < 0.38 ? -0.5 : -0.3;
      P.headRY = 0;
      P.headRZ = 0.25;
      P.spineRX = -0.1;
      P.spineRZ = 0;
      P.hipsRY = 0;
      P.hipsRZ = 0;
      P.spineRY = 0;
      P.rollRX = 0;
      P.rollRZ = 0;
      P.bodyY = 0;
      P.bodyX = 0;
      rig.eyes.visible = false;
      rig.koEyes.visible = true;
    }

    // --------------------------------------------------------- victory
    if (this.victoryT >= 0) {
      this.victoryT += dt;
      this.w = clamp01(this.victoryT / 0.35);
      this.victoryPose(this.victoryT);
      this.mouthT = Math.max(this.mouthT, Math.sin(this.victoryT * 2) > 0.6 ? 0.1 : 0);
    }

    // -------------------------------------------- showcase flair (menu)
    if (!inp.combat && !terminal) {
      this.flairT -= dt;
      if (this.flairT <= 0 && this.flair <= 0) {
        this.flair = 1.6;
        this.flairT = 6 + Math.random() * 4;
      }
      if (this.flair > 0) {
        this.flair -= dt;
        const fp = clamp01(1 - this.flair / 1.6);
        this.w = Math.sin(fp * Math.PI);
        this.flairPose(fp);
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
    const st = this.settle.update(dt);
    const ss = this.settleSide.update(dt);
    const cR = this.climbR.update(dt);
    const cL = this.climbL.update(dt);
    const pz = this.push.update(dt);
    const tw = this.shotTwist.update(dt);
    const ch = this.shotChest.update(dt);
    const dp = this.shotDip.update(dt);
    const nd = this.shotNod.update(dt);

    rig.root.rotation.y = this.yaw + this.yawAdd;
    // Alpha 1.5.6: the lean springs (settle = fore/aft, settleSide = sideways) tilt the whole upper
    // body; the legs counter-rotate by the hip share so the feet stay where they are
    rig.body.position.set(C.bodyX, C.bodyY + koLift - dp * 0.12, koSlide + sv * 0.035 - pz);
    rig.body.rotation.x = -koFall;
    rig.roll.rotation.set(C.rollRX + rollSpin - rb * 0.012 + st * 0.45 - ch * 0.3, 0, C.rollRZ + ss * 0.45);
    rig.hips.rotation.set(0, C.hipsRY, C.hipsRZ);
    rig.spine.rotation.set(C.spineRX + hp * 0.06 - rb * 0.02 - (rR + rL) * 0.004 + st * 0.75 - ch, C.spineRY + (rR - rL) * 0.01 + tw, C.spineRZ + hr * 0.05 + ss * 0.75);
    rig.head.rotation.set(C.headRX + hp * 0.05 + hs * 0.06 - st * 0.6 - nd + ch * 0.5, C.headRY - tw * 0.5, C.headRZ + hr * 0.04 + hrl * 0.05 - ss * 0.4);
    // muzzle climb: the gun arm kicks up (shoulder and a bend of the elbow), then settles back.
    // While the torso rocks with a shot, the aimed arms hold most of the line (like a real shooter),
    // so the weapon moves by its own kick, not by the whole body's lever.
    const hold = (st * 1.2 - ch * 1.3) * 0.75 * this.aimW;
    rig.shoulderL.rotation.set(C.shLX - rL * 0.05 - cL - hold, 0, C.shLZ);
    rig.shoulderR.rotation.set(C.shRX - rR * 0.05 - cR - hold, 0, C.shRZ);
    rig.elbowL.rotation.set(C.elL - rL * 0.06 - cL * 0.25, 0, 0);
    rig.elbowR.rotation.set(C.elR - rR * 0.06 - cR * 0.25, 0, 0);
    rig.legL.rotation.set(C.legLX - dp * 0.5 - st * 0.45, 0, C.legLZ - ss * 0.45);
    rig.legR.rotation.set(C.legRX - dp * 0.5 - st * 0.45, 0, C.legRZ - ss * 0.45);
    rig.kneeL.rotation.set(C.kneeL + dp, 0, 0);
    rig.kneeR.rotation.set(C.kneeR + dp, 0, 0);
    // weapon slides back along its barrel on each shot (+y is "back" in forearm space);
    // wSpin rolls it around the barrel, wFlip spins it around the hand (revolver twirl)
    const slide = this.recoil.slide;
    if (rig.weaponR) {
      // (Alpha 1.5.6: plus a visible slide back with the climb)
      rig.weaponR.position.y = this.weaponBaseR + clamp(rR * 0.012, -0.05, 0.2) * slide * 10 + cR * 0.12;
      rig.weaponR.rotation.set(this.weaponTiltR + this.wFlip, this.wSpin, 0);
    }
    if (rig.weaponL) {
      rig.weaponL.position.y = this.weaponBaseL + clamp(rL * 0.012, -0.05, 0.2) * slide * 10 + cL * 0.12;
      rig.weaponL.rotation.set(this.weaponTiltL, -this.wSpin, 0);
    }
    const sqk = clamp(sq * 0.012, -0.12, 0.18);
    rig.body.scale.set(bodyScaleX * this.sx * (1 + sqk * 0.5), bodyScaleY * this.sy * (1 - sqk), bodyScaleZ * this.sz * (1 + sqk * 0.5));

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
    const open = this.mouthT > 0 || inp.stunned || this.koT >= 0 || inp.action === 'windup' || inp.action === 'rush' || inp.cutStage === 'prep';
    rig.mouth.visible = !open;
    rig.mouthOpen.visible = open;
    rig.brows.position.y = damp(rig.brows.position.y, inp.action !== 'none' || this.flash > 0.3 ? -0.025 : this.victoryT >= 0 ? 0.03 : 0, 14, dt);
    if (rig.look.face?.browFlash) {
      // Alpha 1.5.5 (Kai): now and then one brow flashes up — the cocky showman look
      this.browT -= dt;
      if (this.browT <= 0) {
        this.browUp = 0.7;
        this.browT = 4 + Math.random() * 5;
      }
      if (this.browUp > 0) this.browUp -= dt;
      const up = (this.browUp > 0 && this.koT < 0 && !inp.stunned) || this.victoryT >= 0;
      rig.brows.rotation.z = damp(rig.brows.rotation.z, up ? -0.08 : 0, 14, dt);
    }

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

  /** Blend one pose key toward `v` by the current mix weight `this.w` (no per-frame closures). */
  private to(key: PoseKey, v: number): void {
    const P = this.tgt;
    P[key] += (v - P[key]) * this.w;
  }

  /** One flourish beat per routine (sparkle, or a stomp / slam when `heavy`). */
  private flourish(vt: number, at: number, heavy: boolean): void {
    if (this.flourishDone || vt < at) return;
    this.flourishDone = true;
    if (heavy) this.squash.kick(6);
    this.events.onFlourish?.(heavy);
  }

  // ---------------------------------------------------- victory routines
  private victoryPose(vt: number): void {
    const P = this.tgt;
    const k = this.w;
    switch (this.victoryMove) {
      // ---- Ray
      case 'hype_jump': {
        const j = Math.max(0, Math.sin(vt * 7));
        P.bodyY += j * 0.34 * k;
        this.to('shRX', -2.85);
        this.to('shRZ', -0.15);
        this.to('elR', -0.4 - j * 0.5);
        this.to('shLX', -0.4);
        this.to('shLZ', 0.5);
        this.to('elL', -1.6);
        this.to('kneeL', 0.3 + j * 0.65);
        this.to('kneeR', 0.3 + j * 0.65);
        this.to('legLX', -0.2 - j * 0.32);
        this.to('legRX', -0.2 - j * 0.32);
        this.to('headRX', -0.18);
        this.to('spineRX', -0.08);
        // pistol twirl while airborne
        this.wSpin = j > 0.2 ? (vt * 18) % TAU : 0;
        this.flourish(vt, 0.3, false);
        break;
      }
      case 'hype_crowd': {
        // pumping the blasters to the crowd, one then the other, bouncing on the toes
        const ph = vt * 7.5;
        const j = Math.sin(ph);
        const up = Math.max(0, j);
        const dn = Math.max(0, -j);
        const hop = Math.abs(j);
        const look = Math.sin(vt * 1.6);
        P.bodyY += hop * 0.09 * k;
        this.to('shRX', -2.3 - up * 0.55);
        this.to('shRZ', -0.25);
        this.to('elR', -1.1 + up * 0.8);
        this.to('shLX', -2.3 - dn * 0.55);
        this.to('shLZ', 0.25);
        this.to('elL', -1.1 + dn * 0.8);
        this.to('kneeL', 0.25 + hop * 0.3);
        this.to('kneeR', 0.25 + hop * 0.3);
        this.to('legLX', -0.12 - hop * 0.12);
        this.to('legRX', -0.12 - hop * 0.12);
        this.to('headRX', -0.2);
        this.to('headRY', look * 0.35);
        this.to('spineRY', look * 0.18);
        this.to('spineRX', -0.1);
        this.flourish(vt, 0.45, false);
        break;
      }
      case 'hype_spin': {
        // a spin with the arms out, then both blasters pointed at the sky with a hop
        const s = smoothstep(0.55, 0.95, vt);
        const hop = vt > 0.7 && vt < 1.1 ? Math.sin(((vt - 0.7) / 0.4) * Math.PI) : 0;
        P.bodyY += hop * 0.3 * k;
        this.to('shRX', -0.3 - 2.35 * s);
        this.to('shRZ', -1.35 + 0.85 * s);
        this.to('elR', -0.15);
        this.to('shLX', -0.3 - 2.35 * s);
        this.to('shLZ', 1.35 - 0.85 * s);
        this.to('elL', -0.15);
        this.to('kneeL', 0.2 + hop * 0.6);
        this.to('kneeR', 0.2 + hop * 0.6);
        this.to('legLX', -hop * 0.3);
        this.to('legRX', -hop * 0.3);
        this.to('headRX', -0.25 * s);
        this.to('spineRX', -0.12 * s);
        this.wSpin = vt > 0.9 && vt < 1.5 ? ease.inOutCubic((vt - 0.9) / 0.6) * TAU * 2 : 0;
        this.flourish(vt, 0.85, false);
        break;
      }
      // ---- Bruno
      case 'flex_double': {
        const pulse = Math.max(0, Math.sin(vt * 4));
        this.to('shLX', -0.15);
        this.to('shRX', -0.15);
        this.to('shLZ', 1.45 + pulse * 0.1);
        this.to('shRZ', -1.45 - pulse * 0.1);
        this.to('elL', -2.1 - pulse * 0.2);
        this.to('elR', -2.1 - pulse * 0.2);
        this.to('spineRX', -0.12 - pulse * 0.05);
        this.to('headRX', -0.2);
        this.to('legLZ', 0.18);
        this.to('legRZ', -0.18);
        this.to('kneeL', 0.3);
        this.to('kneeR', 0.3);
        this.sx = 1 + pulse * 0.04;
        this.flourish(vt, 0.32, true);
        break;
      }
      case 'flex_cannon': {
        // the cannon hoisted overhead with one arm, shaking with effort, then slammed onto the shoulder
        const raise = smoothstep(0, 0.45, vt);
        const slam = smoothstep(0.95, 1.12, vt);
        const shake = vt < 0.95 ? Math.sin(vt * 26) * 0.05 * raise : 0;
        const dip = vt > 1.0 && vt < 1.45 ? Math.sin(((vt - 1.0) / 0.45) * Math.PI) : 0;
        const pulse = slam * Math.max(0, Math.sin((vt - 1.1) * 4));
        this.to('shRX', lerp(lerp(-0.4, -2.9, raise), -1.0, slam) + shake);
        this.to('shRZ', lerp(-0.2, -0.35, slam));
        this.to('elR', lerp(-0.25, -2.5, slam));
        this.to('shLX', lerp(-1.7, -0.15, slam));
        this.to('shLZ', lerp(0.55, 1.4 + pulse * 0.1, slam));
        this.to('elL', -1.9 - pulse * 0.2);
        this.to('legLZ', 0.16);
        this.to('legRZ', -0.16);
        this.to('kneeL', 0.28 + dip * 0.35);
        this.to('kneeR', 0.28 + dip * 0.35);
        P.bodyY -= dip * 0.07 * k;
        this.to('headRX', lerp(-0.3, -0.12, slam));
        this.to('spineRX', lerp(-0.12, -0.06 - pulse * 0.04, slam));
        this.flourish(vt, 1.05, true);
        break;
      }
      case 'flex_roar': {
        // chest thumps, then both arms up and a roar to the rafters
        const beat = Math.sin(vt * 6.5);
        const a = Math.max(0, beat);
        const b = Math.max(0, -beat);
        const roar = smoothstep(1.25, 1.55, vt);
        if (vt < 1.3) {
          this.to('shRX', -1.0 - a * 0.35);
          this.to('shRZ', 0.15);
          this.to('elR', -2.2 - a * 0.2);
          this.to('shLX', -1.0 - b * 0.35);
          this.to('shLZ', -0.15);
          this.to('elL', -2.2 - b * 0.2);
          this.to('spineRX', -0.08 + (a + b) * 0.05);
          this.to('headRX', -0.05);
        } else {
          const tr = Math.sin(vt * 18) * 0.08;
          this.to('shRX', -2.4);
          this.to('shRZ', -0.7);
          this.to('elR', -1.0 + tr);
          this.to('shLX', -2.4);
          this.to('shLZ', 0.7);
          this.to('elL', -1.0 - tr);
          this.to('spineRX', -0.22 * roar);
          this.to('headRX', -0.42 * roar);
          this.mouthT = Math.max(this.mouthT, 0.1);
        }
        this.to('legLZ', 0.2);
        this.to('legRZ', -0.2);
        this.to('kneeL', 0.38);
        this.to('kneeR', 0.38);
        P.bodyY -= 0.05 * k;
        this.flourish(vt, 1.3, true);
        break;
      }
      // ---- Nika
      case 'peace_sign': {
        const sw = Math.sin(vt * 3);
        this.to('shRX', -2.5);
        this.to('shRZ', -0.35);
        this.to('elR', -1.9);
        this.to('shLX', 0.1);
        this.to('shLZ', 0.7);
        this.to('elL', -1.7);
        this.to('kneeL', 1.1);
        this.to('legLX', 0.15);
        this.to('headRZ', 0.22 + sw * 0.05);
        this.to('hipsRZ', sw * 0.1);
        this.to('spineRZ', -sw * 0.08);
        this.flourish(vt, 0.72, false);
        break;
      }
      case 'peace_wave': {
        // a big wave, the rifle propped on the shoulder, a hip pop
        const sw = Math.sin(vt * 2.6);
        const wave = Math.sin(vt * 10);
        this.to('shLX', -2.55);
        this.to('shLZ', 0.45 + wave * 0.12);
        this.to('elL', -0.55 + wave * 0.35);
        this.to('shRX', -0.45);
        this.to('shRZ', 0.15);
        this.to('elR', -2.2);
        this.to('hipsRZ', 0.1 + sw * 0.06);
        this.to('spineRZ', -0.08 - sw * 0.05);
        this.to('bodyX', 0.03);
        this.to('kneeL', 0.55);
        this.to('legLX', 0.08);
        this.to('kneeR', 0.08);
        this.to('headRZ', -0.18 + sw * 0.05);
        this.to('headRX', -0.08);
        this.flourish(vt, 0.6, false);
        break;
      }
      case 'peace_hop': {
        // happy little hops, arms up in a V, kicking up one heel then the other
        const ph = vt * 6.2;
        const hop = Math.max(0, Math.sin(ph));
        const side = Math.sin(ph * 0.5) > 0;
        P.bodyY += hop * 0.2 * k;
        this.to('shRX', -2.5);
        this.to('shRZ', -0.55);
        this.to('elR', -0.35);
        this.to('shLX', -2.5);
        this.to('shLZ', 0.55);
        this.to('elL', -0.35);
        this.to('kneeL', 0.2 + hop * (side ? 1.2 : 0.35));
        this.to('kneeR', 0.2 + hop * (side ? 0.35 : 1.2));
        this.to('legLX', -hop * 0.2);
        this.to('legRX', -hop * 0.2);
        this.to('headRX', -0.2);
        this.to('headRZ', Math.sin(ph * 0.5) * 0.15);
        this.flourish(vt, 0.5, false);
        break;
      }
      // ---- Vega
      case 'precise_present': {
        // present arms: the carbine upright before the chest, heels together, a crisp nod
        const nod = vt > 0.8 && vt < 1.25 ? Math.sin(((vt - 0.8) / 0.45) * Math.PI) : 0;
        this.to('shRX', -1.05);
        this.to('shRZ', 0.42);
        this.to('elR', -1.85);
        this.to('shLX', -0.85);
        this.to('shLZ', -0.45);
        this.to('elL', -1.55);
        this.to('legLZ', 0);
        this.to('legRZ', 0);
        this.to('kneeL', 0.04);
        this.to('kneeR', 0.04);
        this.to('hipsRZ', 0);
        this.to('spineRX', -0.08);
        this.to('headRX', -0.08 + nod * 0.32);
        this.flourish(vt, 0.95, false);
        break;
      }
      case 'precise_shoulder': {
        // the carbine rests on the shoulder, a hand on the hip, a calm look around
        const look = Math.sin(vt * 0.9);
        this.to('shRX', -0.55);
        this.to('shRZ', 0.1);
        this.to('elR', -2.35);
        this.to('shLX', 0.12);
        this.to('shLZ', 0.75);
        this.to('elL', -1.35);
        this.to('hipsRZ', 0.08);
        this.to('bodyX', 0.03);
        this.to('spineRZ', -0.07);
        this.to('kneeR', 0.26);
        this.to('legRX', -0.08);
        this.to('kneeL', 0.05);
        this.to('headRY', look * 0.38);
        this.to('headRX', -0.06);
        this.to('spineRY', look * 0.08);
        this.flourish(vt, 0.7, false);
        break;
      }
      case 'precise_check': {
        // a last scan down the sights, then the carbine lowered to port arms
        const up = 1 - smoothstep(1.5, 1.9, vt);
        const sweep = Math.sin(vt * 2.2) * up;
        this.to('shRX', lerp(-0.7, -1.75, up));
        this.to('shRZ', 0.3);
        this.to('elR', lerp(-1.5, -0.95, up));
        this.to('shLX', lerp(-0.9, -1.95, up));
        this.to('shLZ', -0.4);
        this.to('elL', lerp(-1.3, -0.45, up));
        this.to('spineRY', sweep * 0.32);
        this.to('headRY', sweep * 0.12);
        this.to('headRX', lerp(-0.04, 0.06, up));
        this.to('kneeL', 0.12);
        this.to('kneeR', 0.12);
        this.flourish(vt, 1.75, false);
        break;
      }
      // ---- Kai
      case 'show_twirl': {
        // the revolver spins on the finger (three turns), back to the hip, and a tip of the hat
        const spinP = clamp01((vt - 0.15) / 0.9);
        this.wFlip = spinP > 0 && spinP < 1 ? ease.inOutCubic(spinP) * TAU * 3 : 0;
        const holster = smoothstep(1.0, 1.25, vt);
        const tip = smoothstep(1.15, 1.4, vt);
        this.to('shRX', lerp(-0.9, 0.05, holster));
        this.to('shRZ', lerp(-0.85, -0.2, holster));
        this.to('elR', lerp(-0.4, -0.5, holster));
        this.to('shLX', lerp(-0.2, -2.35, tip));
        this.to('shLZ', lerp(0.3, 0.15, tip));
        this.to('elL', lerp(-0.6, -2.3, tip));
        this.to('headRX', -0.06 + tip * 0.12);
        this.to('headRZ', 0.1);
        this.to('hipsRZ', -0.06);
        this.to('kneeL', 0.22);
        this.to('legLX', -0.1);
        this.to('spineRY', -0.12);
        this.flourish(vt, 1.2, false);
        break;
      }
      case 'show_bow': {
        // a theatrical bow with a sweep of the arm, then the pistol pointed at the camera
        const bow = vt < 1.3 ? Math.sin(clamp01((vt - 0.1) / 1.1) * Math.PI) : 0;
        const point = smoothstep(1.25, 1.5, vt);
        this.to('spineRX', 0.55 * bow - 0.05 * point);
        this.to('headRX', 0.2 * bow - 0.08 * point);
        this.to('rollRX', 0.12 * bow);
        this.to('shLX', lerp(-0.9 * bow, -0.15, point));
        this.to('shLZ', lerp(0.2 - 0.75 * bow, 0.4, point));
        this.to('elL', lerp(-1.45, -1.1, point));
        this.to('shRX', lerp(-0.3, -1.45, point));
        this.to('shRZ', lerp(-1.15, 0.12, point));
        this.to('elR', -0.15);
        this.to('legRX', 0.35 * bow);
        this.to('kneeR', 0.05 + 0.3 * bow);
        this.to('kneeL', 0.15 * bow);
        this.to('spineRY', -0.18 * point);
        this.to('headRY', 0.12 * point);
        this.flourish(vt, 1.4, false);
        break;
      }
      case 'show_smoke': {
        // blows the smoke off the barrel, then a pistol aimed at the camera
        const up = smoothstep(0.05, 0.4, vt);
        const aimC = smoothstep(1.15, 1.4, vt);
        this.to('shRX', lerp(-1.3 * up, -1.48, aimC));
        this.to('shRZ', lerp(0.4, 0.1, aimC));
        this.to('elR', lerp(-2.15 * up, -0.15, aimC));
        this.to('headRZ', lerp(-0.14 * up, 0.1, aimC));
        this.to('headRX', lerp(0.12 * up, 0, aimC));
        this.to('headRY', lerp(0.15 * up, 0, aimC));
        this.to('shLX', -0.1);
        this.to('shLZ', 0.5);
        this.to('elL', -1.2);
        this.to('hipsRZ', 0.07);
        this.to('kneeL', 0.2);
        if (vt > 0.7 && vt < 1.0) this.mouthT = Math.max(this.mouthT, 0.05);
        this.flourish(vt, 0.75, false);
        break;
      }
      // ---- Rina
      case 'grace_pirouette': {
        // a pirouette on one foot with the arms in a crown, then a pose with the arms open
        const pose = smoothstep(0.7, 0.95, vt);
        P.bodyY += (vt < 0.75 ? 0.06 : 0) * k;
        this.to('kneeL', lerp(1.45, 0.1, pose));
        this.to('legLX', lerp(-0.35, 0.25, pose));
        this.to('legLZ', lerp(0.25, 0.1, pose));
        this.to('kneeR', 0.04);
        this.to('shRX', lerp(-2.6, -1.3, pose));
        this.to('shRZ', lerp(0.35, -0.9, pose));
        this.to('elR', lerp(-0.7, -0.1, pose));
        this.to('shLX', lerp(-2.6, -0.4, pose));
        this.to('shLZ', lerp(-0.35, 1.0, pose));
        this.to('elL', lerp(-0.7, -0.2, pose));
        this.to('headRX', lerp(-0.15, 0.05, pose));
        this.to('headRZ', 0.12 * pose);
        this.to('spineRX', -0.1);
        this.to('hipsRZ', 0.06 * pose);
        this.flourish(vt, 0.8, false);
        break;
      }
      case 'grace_kneel': {
        // drops to one knee, the blaster up by the face, the free hand on the knee
        const d = ease.outCubic(clamp01(vt / 0.4));
        P.bodyY -= 0.3 * d * k;
        this.to('legLX', -1.15 * d);
        this.to('kneeL', 1.35 * d);
        this.to('legRX', 0.55 * d);
        this.to('kneeR', 1.75 * d);
        this.to('legLZ', 0);
        this.to('legRZ', 0);
        this.to('spineRX', 0.05);
        this.to('headRX', -0.18);
        this.to('headRZ', 0.12);
        this.to('shRX', -1.1);
        this.to('shRZ', 0.3);
        this.to('elR', -2.25);
        this.to('shLX', -0.75);
        this.to('shLZ', 0.2);
        this.to('elL', -0.55);
        this.flourish(vt, 0.42, false);
        break;
      }
      case 'grace_salute': {
        // a two-finger salute from the brow flicked out to the crowd, the blaster on the shoulder
        const flick = smoothstep(0.85, 1.0, vt);
        const sw = Math.sin(vt * 2.2);
        this.to('shLX', -2.05 + flick * 0.35);
        this.to('shLZ', 0.2 + flick * 0.7);
        this.to('elL', -2.35 + flick * 1.4);
        this.to('shRX', -0.5);
        this.to('shRZ', 0.15);
        this.to('elR', -2.2);
        this.to('hipsRZ', 0.12 + sw * 0.03);
        this.to('bodyX', 0.035);
        this.to('spineRZ', -0.1);
        this.to('kneeL', 0.45);
        this.to('legLX', 0.06);
        this.to('headRZ', -0.14);
        this.to('headRX', -0.06);
        this.flourish(vt, 0.92, false);
        break;
      }
      // ---- Crash
      case 'brawl_roar': {
        // both fists up, shaking, the head thrown back
        const sh = Math.sin(vt * 22) * 0.12;
        const up = ease.outBack(clamp01(vt / 0.35));
        this.to('shRX', -2.65 * up);
        this.to('shRZ', -0.45);
        this.to('elR', -0.95 + sh);
        this.to('shLX', -2.65 * up);
        this.to('shLZ', 0.45);
        this.to('elL', -0.95 - sh);
        this.to('headRX', -0.42);
        this.to('spineRX', -0.18);
        this.to('legLZ', 0.2);
        this.to('legRZ', -0.2);
        this.to('kneeL', 0.42);
        this.to('kneeR', 0.42);
        P.bodyY -= 0.05 * k;
        this.mouthT = Math.max(this.mouthT, 0.1);
        this.flourish(vt, 0.38, true);
        break;
      }
      case 'brawl_stomp': {
        // stomp-stomp-stomp, chest out, fists low and flexed — then he stands there daring anyone
        const period = 0.46;
        const stomping = vt < period * 5;
        const ph = (vt % period) / period;
        const foot = Math.floor(vt / period) % 2;
        const lift = stomping ? Math.sin(clamp01(ph / 0.7) * Math.PI) : 0;
        const jolt = stomping && ph > 0.7 ? 1 - (ph - 0.7) / 0.3 : 0;
        this.to('kneeL', 0.3 + (foot === 0 ? lift * 1.1 : 0));
        this.to('legLX', foot === 0 ? -lift * 0.55 : 0);
        this.to('kneeR', 0.3 + (foot === 1 ? lift * 1.1 : 0));
        this.to('legRX', foot === 1 ? -lift * 0.55 : 0);
        this.to('legLZ', 0.18);
        this.to('legRZ', -0.18);
        this.to('spineRX', -0.12 + jolt * 0.14);
        this.to('headRX', -0.2 + jolt * 0.1);
        this.to('shLX', -0.3);
        this.to('shLZ', 0.65);
        this.to('elL', -1.7);
        this.to('shRX', -0.3);
        this.to('shRZ', -0.65);
        this.to('elR', -1.7);
        this.to('hipsRZ', (foot === 0 ? 1 : -1) * 0.06 * (stomping ? 1 : 0));
        // a heavy footfall on every landing
        const n = stomping ? Math.floor((vt - period * 0.7) / period) + 1 : this.beatN;
        if (n > this.beatN) {
          this.beatN = n;
          this.squash.kick(4);
          this.events.onStep?.(true);
          if (n === 1) this.flourish(vt, 0, true);
        }
        break;
      }
      case 'brawl_taunt': {
        // "come on": the free hand beckons, the shotgun over the shoulder, chin up
        const curl = Math.max(0, Math.sin(vt * 6.5));
        this.to('shLX', -1.4);
        this.to('shLZ', 0.15);
        this.to('elL', -0.35 - curl * 1.2);
        this.to('shRX', -0.65);
        this.to('shRZ', -0.1);
        this.to('elR', -2.25);
        this.to('spineRX', -0.14);
        this.to('headRX', -0.22 + curl * 0.06);
        this.to('legRX', 0.25);
        this.to('kneeR', 0.2);
        this.to('legLX', -0.2);
        this.to('kneeL', 0.15);
        P.bodyY += Math.abs(Math.sin(vt * 3.25)) * 0.03 * k;
        this.flourish(vt, 0.5, false);
        break;
      }
      // ---- Victor (dignified, never cartoonish)
      case 'champ_salute': {
        // the rifle grounded at his side, a measured hand to the crowd, the gaze sweeping the stands
        const wave = Math.sin(vt * 2.4);
        const sweep = Math.sin(vt * 0.7);
        this.to('shRX', 0.04);
        this.to('shRZ', -0.12);
        this.to('elR', -0.35);
        this.to('shLX', -2.35);
        this.to('shLZ', 0.5 + wave * 0.08);
        this.to('elL', -0.35 + wave * 0.1);
        this.to('spineRX', -0.1);
        this.to('headRX', -0.12);
        this.to('headRY', sweep * 0.35);
        this.to('spineRY', sweep * 0.1);
        this.to('legLZ', 0.08);
        this.to('legRZ', -0.08);
        this.to('kneeL', 0.06);
        this.to('kneeR', 0.06);
        this.flourish(vt, 0.7, false);
        break;
      }
      case 'champ_raise': {
        // PRIME BREAKER lifted overhead with both hands like a trophy — slowly, deliberately
        const up = ease.inOutCubic(clamp01((vt - 0.1) / 1.1));
        this.to('shRX', lerp(-0.6, -2.85, up));
        this.to('shRZ', lerp(0.26, -0.35, up));
        this.to('elR', lerp(-0.98, -0.4, up));
        this.to('shLX', lerp(-1.18, -2.85, up));
        this.to('shLZ', lerp(-0.46, 0.35, up));
        this.to('elL', lerp(-0.52, -0.4, up));
        this.to('spineRX', -0.14 * up);
        this.to('headRX', -0.3 * up);
        this.to('legLZ', 0.1);
        this.to('legRZ', -0.1);
        this.to('kneeL', 0.1);
        this.to('kneeR', 0.1);
        this.flourish(vt, 1.2, false);
        break;
      }
      case 'champ_heart': {
        // a fist over the heart and a slow, respectful bow of the head — then the chin comes up
        const bowH = vt > 0.6 && vt < 1.8 ? Math.sin(((vt - 0.6) / 1.2) * Math.PI) : 0;
        const proud = smoothstep(1.7, 2.0, vt);
        this.to('shLX', -1.0);
        this.to('shLZ', -0.32);
        this.to('elL', -2.25);
        this.to('shRX', 0);
        this.to('shRZ', -0.15);
        this.to('elR', -0.45);
        this.to('headRX', 0.32 * bowH - 0.1 * proud);
        this.to('spineRX', 0.08 * bowH - 0.08);
        this.to('legLZ', 0.04);
        this.to('legRZ', -0.04);
        this.flourish(vt, 1.85, false);
        break;
      }
    }
  }

  /** Menu showcase gestures (`this.w` rises and falls over the 1.6 s gesture; fp = progress 0..1). */
  private flairPose(fp: number): void {
    const f = this.w;
    switch (this.victoryStyle) {
      case 'hype':
        this.to('shRX', -1.5);
        this.to('shRZ', 0.3);
        this.to('elR', -0.3);
        this.to('headRZ', 0.15);
        this.wSpin = f > 0.3 ? (this.t * 16) % TAU : 0;
        break;
      case 'flex':
        this.to('shLZ', 1.4);
        this.to('elL', -2.0);
        this.to('shLX', -0.2);
        this.to('headRX', -0.1);
        break;
      case 'peace':
        this.to('shRX', -2.4);
        this.to('shRZ', -0.3);
        this.to('elR', -1.8);
        this.to('headRZ', 0.2);
        break;
      case 'precise':
        // a quick look down the sights
        this.to('shRX', -1.7);
        this.to('shRZ', 0.3);
        this.to('elR', -0.95);
        this.to('shLX', -1.9);
        this.to('shLZ', -0.4);
        this.to('elL', -0.45);
        this.to('headRX', 0.06);
        break;
      case 'showman':
        // the pistol flipped twice around the finger
        this.to('shRX', -1.0);
        this.to('shRZ', -0.6);
        this.to('elR', -0.5);
        this.to('headRZ', 0.12);
        this.wFlip = ease.inOutCubic(fp) * TAU * 2;
        break;
      case 'graceful':
        // a hand through the hair, a hip pop
        this.to('shLX', -2.0);
        this.to('shLZ', 0.35);
        this.to('elL', -2.3);
        this.to('hipsRZ', 0.12);
        this.to('headRZ', -0.16);
        break;
      case 'brawler':
        // cracks the knuckles in front of the chest
        this.to('shLX', -1.3);
        this.to('shLZ', -0.35);
        this.to('elL', -1.5);
        this.to('shRX', -1.3);
        this.to('shRZ', 0.35);
        this.to('elR', -1.5);
        this.to('spineRX', 0.08);
        this.to('headRX', 0.1);
        break;
      case 'champion':
        // straightens the collar
        this.to('shLX', -2.0);
        this.to('shLZ', -0.1);
        this.to('elL', -2.45);
        this.to('headRZ', 0.08);
        this.to('headRX', -0.08);
        break;
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
