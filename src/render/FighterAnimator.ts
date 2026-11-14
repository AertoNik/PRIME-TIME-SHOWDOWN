import { Matrix4, Vector3, type MeshBasicMaterial } from 'three';
import { FIRE_STYLE, GAITS, HIT_REACTION, RECOIL, VICTORY_SETS, type FireStyle, type GaitProfile, type RecoilProfile, type VictoryMove } from '../config/animation';
import type { CardId, CastKind, DashStyle, IdleStyle, VictoryStyle } from '../config/types';
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
  action: 'none' | 'windup' | 'dash' | 'rush' | 'recover' | 'cut' | 'feint' | 'rewind' | 'bite';
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
  /** Alpha 1.7: Lucien's cane in its close-range mode (fencing guard, strikes instead of shots). */
  melee: boolean;
  /** Alpha 1.7: BAT BITE stage while action === 'bite'. */
  biteStage: 'rush' | 'leap' | null;
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
    melee: false,
    biteStage: null,
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

/**
 * Beta 2.1 — one leg's footstep state for planted locomotion (FighterAnimator.plantFeet): in stance the foot holds a
 * point on the floor (x, z in the fighter's parent space); in swing it travels from where it lifted off (relative to the
 * hip) to the next touchdown along a Hermite curve, so its speed is continuous at lift-off and at touchdown.
 */
interface FootState {
  /** -1 not initialised; 0 stance; 1 swing. */
  mode: -1 | 0 | 1;
  /** The IK's last hip pitch, hip roll and knee (rad) — rate-limited, so an extreme turn never snaps the leg. */
  aX: number;
  aZ: number;
  aK: number;
  plantX: number;
  plantZ: number;
  /** Lift-off point relative to the hip (ground plane). */
  relX: number;
  relZ: number;
  /** The hip's ground velocity at lift-off (the swing starts moving with it). */
  vX: number;
  vZ: number;
}
const footState = (): FootState => ({ mode: -1, aX: 0, aZ: 0, aK: 0, plantX: 0, plantZ: 0, relX: 0, relZ: 0, vX: 0, vZ: 0 });
// scratch for the leg IK (no per-frame allocations)
const IK_M = new Matrix4();
const IK_INV = new Matrix4();
const IK_V = new Vector3();
const IK_H = new Vector3();
// scratch for the level feet
const FT_M = new Matrix4();
const FT_F = new Vector3();

/** Last victory routine per fighter look, so the same one never plays twice in a row. */
const lastVictory = new Map<string, number>();

/** Alpha 1.7: seconds of a cane strike animation (the contact comes at the strike's own windup). */
const STRIKE_TIME = 0.4;
/** Alpha 1.7: the thumb-across-the-lip flourish after a BAT BITE. */
const SAVOR_TIME = 0.7;

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
export type AnimCue = 'combo' | 'trick' | 'counter' | 'brace' | 'parry';
const CUE_TIME: Record<AnimCue, number> = { combo: 0.42, trick: 0.6, counter: 0.36, brace: 0.32, parry: 0.32 };
/**
 * Alpha 1.6 — five reusable card activation gestures (CastKind), each with small variants:
 * throw (net / mine / disc), shot (split shot / cable), device (wrist projector: barrier,
 * hologram, rewind, freeze), guard (palms out: push, frame) and signal (a call to the crew
 * or a pointed finger: tag, prop, camera, high stakes). Visual only; the card's effect
 * timing is the simulation's.
 */
const CAST_TIME: Record<CastKind, number> = { throw: 0.5, shot: 0.34, device: 0.5, guard: 0.4, signal: 0.56 };
/**
 * Alpha 1.9.7 (CRAX): the key-turn of TWELFTH STRIKE (in a fight: the same 0.75 s as before), a slower one for the lobby
 * and the victory (nothing waits for it there), and one turn of the rifle's crank.
 */
const CLOCK_WIND_TIME = 0.75;
const CLOCK_WIND_SLOW = 1.15;
/**
 * The reach behind the back to the key between the shoulder blades, measured on CRAX's rig (the free hand within a few
 * centimetres of the key's bow, the arm clear of the torso and 0.5 m from the head): the body turns a little, the arm
 * swings back and in, the elbow almost straight. Two wrist turns, each stepping the key a third of a turn.
 */
const KEY_REACH = { shLX: 1.5, shLZ: -0.8, elL: -0.4, spineRY: 0.25 } as const;
/** The arm's side swing while it passes the hip (out of the body's way) before it comes in behind the back. */
const KEY_OUT = 0.32;
const CRANK_TIME = 0.42;
/**
 * Alpha 1.6.1 — when a thrown card leaves the free (left) hand, seconds after the gesture
 * starts: the view keeps the mine / generator in that hand until then and flies it from
 * there, landing exactly when the simulation lands it (no change to any card's timing).
 */
export const THROW_RELEASE = { lob: 0.16, frisbee: 0.09 };
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

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
  /** Beta 2.1: last frame's target (the pose filter interpolates toward this frame's within the frame). */
  private prevTgt = zeroPose();
  private prevValid = false;
  /** Beta 2.1: the pose's joint speeds (the second-order pose filter). */
  private curVel = zeroPose();
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
  private castT = -1;
  private castKind: CastKind = 'throw';
  private castVar = 0;
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
  /** Alpha 1.9.8: full turns of the current twirl (ACE: two after MAIN EVENT). */
  private twirlTurns = 1;
  private pumpT = -1;
  private tapT = -1;
  // Alpha 1.7 — Lucien's cane: its tilt in the hand (+ = tip down), the guard / point / fencing weights,
  // a strike in progress, the bite flourish and the coat tails
  private caneTgt = 0;
  private caneCur = 0;
  private meleeW = 0;
  private pointW = 0;
  private strikeT = -1;
  private strikeWind = 0.13;
  private strikeVar = 0;
  private savorT = -1;
  private wasLeap = false;
  private tailX = 0;
  private tailZ = 0;
  private tailKick = new Spring(90, 9);
  // Alpha 1.9.7 (CRAX): the key-turn gesture, the crank between bursts, the key's and the crank's angles
  private clockT = -1;
  private crankWait = -1;
  private crankT = -1;
  private keyAngle = 0;
  private crankAngle = 0;
  private selfWindT = 6;
  /** Alpha 1.9.8 (ACE): which lobby flourish comes next (the cuff, GOLDEN ACE spun on the finger). */
  private aceFlairN = 0;
  /** The key-turn's length now (fight / lobby) and the key's angle when the gesture began. */
  private windDur = CLOCK_WIND_TIME;
  private keyFrom = 0;
  /** The body steps forward into a strike (m, damped). */
  private lungeZ = 0;
  private lungeCur = 0;
  // Beta 2.1 — planted locomotion: how much the planted-foot legs replace the angle-driven ones (0 standing, 1 running),
  // the two legs' footstep states, the smoothed travel direction in the parent's space
  private ikW = 0;
  private footL = footState();
  private footR = footState();
  private travelX = 0;
  private travelZ = 1;
  private cadence = 0;
  /** Share of the cycle a foot is on the floor, and how far the body travels while it is (m). */
  private beta = 0.5;
  private reach = 0;
  /** The hips' turn toward the travel direction, smoothed. */
  private hipOffS = 0;
  /** Beta 2.1: this fighter's phase seed for the organic idle (from its look, so a skin copy moves alike). */
  private seed = 0;
  /** The velocity the planted steps follow (smoothed). */
  private stepVX = 0;
  private stepVZ = 0;
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
    // (from the fighter's own styles and weapon: a PRIME SHOP skin moves exactly like its fighter)
    const sid = `${idle}|${victory}|${rig.look.weapon}`;
    for (let i = 0; i < sid.length; i++) this.seed = (this.seed * 31 + sid.charCodeAt(i)) % 997;
    this.seed = (this.seed / 997) * TAU;
    this.breathRate = idle === 'heavy' || idle === 'champion' ? 1.25 : idle === 'bouncy' || idle === 'brawler' ? 2.2 : idle === 'duelist' ? 1.45 : idle === 'clockwork' ? 1.3 : 1.7;
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
    this.stepT = this.pressT = this.evadeT = this.cueT = this.castT = -1;
    this.clockT = this.crankWait = this.crankT = -1;
    this.crankAngle = 0;
    this.strikeT = this.savorT = -1;
    this.wasLeap = false;
    this.caneCur = this.caneTgt = 0;
    this.meleeW = this.pointW = 0;
    this.tailX = this.tailZ = 0;
    this.tailKick.reset();
    this.stillArmed = true;
    this.svx = this.svz = 0;
    this.cur = zeroPose();
    this.curVel = zeroPose();
    this.prevValid = false;
    if (this.rig.look.weapon === 'cane') {
      // Lucien starts from his gentleman's carry: the cane hanging from the pommel never sweeps through the floor
      this.cur.shRX = -0.22;
      this.cur.elR = -1.3;
      this.caneCur = this.caneTgt = 1.24;
      this.rig.shoulderR.rotation.set(-0.22, 0, 0);
      this.rig.elbowR.rotation.set(-1.3, 0, 0);
    }
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
    if (rig.tail) rig.tail.rotation.set(0, 0, 0);
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
      if (wpn !== 'ricochet' && wpn !== 'cane' && wpn !== 'revolver') kickTo(this.climbL, climb * 0.8);
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
    if (w !== 'twin_blasters' && w !== 'ricochet' && w !== 'cane' && w !== 'revolver') this.recoilL.kick(r.kick * (w === 'stinger' ? 0.35 : 0.6) * k);
    this.recoilBody.kick((r.spine * 60 + (heavy ? 2.5 : 0)) * k);
    if (r.shove > 0 || heavy) this.shove.kick(-(r.shove + (heavy ? 3 : 0)));
    if (heavy) this.squash.kick(-2.5);
    this.glowPulse = heavy ? 1.8 : 0.9;
    // weapon-specific follow-through
    this.shotN++;
    if (w === 'ricochet' && !heavy && this.shotN % 4 === 0 && this.twirlT < 0) this.twirlT = 0; // showman spins the pistol every few shots
    // Alpha 1.9.8 (ACE): GOLDEN ACE spun twice after MAIN EVENT, once now and then between regular shots
    else if (w === 'revolver' && this.twirlT < 0 && (heavy || this.shotN % 7 === 0)) {
      this.twirlT = 0;
      this.twirlTurns = heavy ? 2 : 1;
    }
    else if (w === 'boom_cannon') this.pumpT = 0; // pump the shotgun
    else if (w === 'stinger' && !heavy) this.tapT = 0; // the second barrel of the double tap
    // Alpha 1.9.7 (CRAX): the crank turns once the burst is over (each shot of the burst pushes it back)
    if (this.rig.crank) {
      this.crankWait = 0.16;
      this.crankT = -1;
    }
  }

  /**
   * Alpha 1.9.7 — CRAX turns the wind-up key on his back (TWELFTH STRIKE, and now and then in the lobby): the support
   * hand reaches over the shoulder and turns it, the head turns to it in small clockwork steps. Visual only.
   */
  clockWind(slow = false): void {
    if (this.koT >= 0 || this.victoryT >= 0 || !this.rig.key) return;
    this.clockT = 0;
    this.windDur = slow ? CLOCK_WIND_SLOW : CLOCK_WIND_TIME;
    this.keyFrom = this.keyAngle;
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
    if (this.rig.tail) this.tailKick.kick(8);
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
    else if (kind === 'parry') kickTo(this.settle, -0.07);
  }

  /**
   * Alpha 1.6 — a card activation gesture (`variant`: throw 1 = underarm lob; device 1 = both
   * hands; signal 0 = point at the opponent, 1 = call to the crew, 2 = both arms up).
   */
  cast(kind: CastKind, variant = 0): void {
    if (this.koT >= 0 || this.victoryT >= 0) return;
    this.castKind = kind;
    this.castVar = variant;
    this.castT = 0;
    if (kind === 'guard') kickTo(this.settle, 0.08);
    else if (kind === 'throw') kickTo(this.settle, variant === 1 ? 0.05 : 0.1);
    else if (kind === 'signal' && variant === 2) kickTo(this.settle, -0.07);
  }

  /**
   * Alpha 1.7 — a cane strike (Lucien): `variant` 0 = a lunging thrust, 1 = a slash from high outside
   * across the body, 2 = the back-slash. The contact lands `windup` s after the start — exactly when
   * the simulation resolves it — then a short follow-through back to the guard.
   */
  strike(variant: number, windup: number): void {
    if (this.koT >= 0 || this.victoryT >= 0) return;
    this.strikeVar = variant;
    this.strikeWind = Math.max(0.05, windup);
    this.strikeT = 0;
  }

  /** Alpha 1.7 — BAT BITE landed: the coat tails flare as he springs away (the bite itself is the 'leap' pose). */
  biteHit(): void {
    if (this.koT >= 0) return;
    this.tailKick.kick(9);
    this.flash = Math.max(this.flash, 0.3);
  }

  /** The pose layer of a card gesture at progress `p` (0..1), mixed over the current pose. */
  private castPose(P: Pose, p: number, t: number): void {
    const k = Math.sin(p * Math.PI);
    switch (this.castKind) {
      case 'throw': {
        // Alpha 1.6.1: thrown with the free (left) hand — the weapon stays in the other one
        const T = CAST_TIME.throw;
        if (this.castVar === 2) {
          // REBOUND DISC: a frisbee flick — the hand coils across the chest, then sweeps out
          const pr = THROW_RELEASE.frisbee / T;
          const coil = p < pr ? smoothstep(0, pr, p) : 1 - smoothstep(pr, pr + 0.15, p);
          const sweep = smoothstep(pr - 0.06, pr + 0.16, p) * (1 - smoothstep(0.65, 1, p));
          const w = Math.max(coil, sweep);
          P.shLX = mix(P.shLX, -1.1 * coil - 1.45 * sweep, w);
          P.shLZ = mix(P.shLZ, -0.6 * coil + 0.6 * sweep, w);
          P.elL = mix(P.elL, -1.5 * coil - 0.1 * sweep, w);
          P.spineRY += -0.32 * coil + 0.3 * sweep;
          P.kneeL += 0.18 * w;
          P.kneeR += 0.18 * w;
          break;
        }
        // PRESSURE MINE / GRAVITY NET: the hand drops back with the device, then lobs it forward and up
        const pr = THROW_RELEASE.lob / T;
        const wind = p < pr ? smoothstep(0, pr, p) : 1 - smoothstep(pr, pr + 0.2, p);
        const swing = smoothstep(pr - 0.05, pr + 0.2, p) * (1 - smoothstep(0.7, 1, p));
        const w = Math.max(wind, swing);
        P.shLX = mix(P.shLX, 0.85 * wind - 1.6 * swing, w);
        P.shLZ = mix(P.shLZ, 0.3 * wind + 0.05 * swing, w);
        P.elL = mix(P.elL, -0.7 * wind - 0.15 * swing, w);
        P.spineRY += 0.3 * wind - 0.28 * swing;
        P.spineRX += 0.12 * swing - 0.08 * wind;
        P.kneeL += 0.28 * wind;
        P.kneeR += 0.28 * wind;
        P.legRX -= 0.3 * swing;
        P.bodyY -= 0.05 * wind;
        break;
      }
      case 'shot': {
        // a wide planted stance for a wide shot, the free arm out for balance
        P.legLZ += 0.2 * k;
        P.legRZ -= 0.2 * k;
        P.kneeL += 0.32 * k;
        P.kneeR += 0.32 * k;
        P.bodyY -= 0.06 * k;
        P.spineRX -= 0.08 * k;
        P.shLZ += 0.35 * k;
        break;
      }
      case 'device': {
        // the wrist projector comes up in front of the face, then the hand flicks it out
        const up = p < 0.55 ? Math.sin((p / 0.55) * Math.PI * 0.5) : 1 - smoothstep(0.55, 1, p);
        const flick = smoothstep(0.45, 0.65, p) * (1 - smoothstep(0.8, 1, p));
        P.shLX = mix(P.shLX, -1.25 - 0.3 * flick, Math.max(up, flick));
        P.shLZ = mix(P.shLZ, -0.35 + 0.5 * flick, Math.max(up, flick));
        P.elL = mix(P.elL, -1.9 + 1.5 * flick, Math.max(up, flick));
        P.headRX += 0.16 * up;
        P.headRY += 0.18 * up;
        if (this.castVar === 1) {
          P.shRX = mix(P.shRX, -1.3, up);
          P.elR = mix(P.elR, -1.6, up);
        }
        this.glowPulse = Math.max(this.glowPulse, 0.9 * Math.max(up, flick));
        break;
      }
      case 'guard': {
        // palms out: both arms thrust forward with a short step into it
        const g = p < 0.25 ? p / 0.25 : 1 - smoothstep(0.25, 1, p);
        P.shLX = mix(P.shLX, -1.5, g);
        P.shRX = mix(P.shRX, -1.5, g);
        P.shLZ = mix(P.shLZ, -0.15, g);
        P.shRZ = mix(P.shRZ, 0.15, g);
        P.elL = mix(P.elL, -0.15, g);
        P.elR = mix(P.elR, -0.15, g);
        P.spineRX += 0.14 * g;
        P.legLX -= 0.28 * g;
        P.kneeR += 0.22 * g;
        P.bodyY -= 0.03 * g;
        break;
      }
      case 'signal': {
        if (this.castVar === 2) {
          // HIGH STAKES: both arms up to the crowd, chest out
          P.shLX = mix(P.shLX, -2.7, k);
          P.shRX = mix(P.shRX, -2.7, k);
          P.shLZ = mix(P.shLZ, 0.35, k);
          P.shRZ = mix(P.shRZ, -0.35, k);
          P.elL = mix(P.elL, -0.3, k);
          P.elR = mix(P.elR, -0.3, k);
          P.spineRX -= 0.2 * k;
          P.headRX -= 0.22 * k;
          P.bodyY += 0.04 * k;
          break;
        }
        if (this.castVar === 1) {
          // a call to the crew: the free hand up high, two quick waves
          const wave = Math.sin(t * 22) * 0.15 * k;
          P.shLX = mix(P.shLX, -2.6, k);
          P.shLZ = mix(P.shLZ, 0.3 + wave, k);
          P.elL = mix(P.elL, -0.5, k);
          P.headRX -= 0.24 * k;
          P.headRY += 0.25 * k;
          P.spineRZ -= 0.06 * k;
          break;
        }
        // SPOTLIGHT TAG: a pointed finger at the opponent, the body squared up
        P.shLX = mix(P.shLX, -1.6, k);
        P.shLZ = mix(P.shLZ, -0.05, k);
        P.elL = mix(P.elL, -0.08, k);
        P.spineRY -= 0.22 * k;
        P.headRX += 0.06 * k;
        break;
      }
    }
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
    this.caneTgt = 0;
    this.lungeZ = 0;
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
    if (inp.action === 'rush' || (inp.action === 'bite' && inp.biteStage === 'rush')) {
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
      // Beta 2.1: the hips swing to a new travel direction over ~0.15 s instead of flipping (a switch between running
      // forward and backpedalling used to turn them by up to 100° in one frame)
      this.hipOffS = damp(this.hipOffS, hipOff, 12, dt);
      hipOff = this.hipOffS;
      this.lastLX = lx;
      this.lastLZ = lz;
    }
    // Stride-matched cadence: one full cycle per strideLength of travel.
    // Beta 2.1: a slower fighter takes shorter, quicker steps (the stride shrinks to 55 % at a walk) instead of the
    // full running stride in slow motion, and a stepping fighter never drops below 1.4 steps/s (a stop finishes its
    // step). The phase only moves forward — the planted feet never run backwards in time (backpedalling steps
    // backwards in space, see plantFeet); the angle-driven legs still read `legDir`.
    // (Beta 2.1, measured: these short cartoon legs are straight when standing — 0.62 m of leg under a 0.62 m hip — so a
    // planted foot can travel only ~0.5 m under the body. A run therefore takes quicker, shorter steps (the cycle covers
    // 45–75 % of the old stride), spends less of the cycle on the floor (a short flight at full speed), and the body
    // drops just enough to let the legs reach — an athletic run instead of a skate.)
    // (the planted steps read a SMOOTHED velocity: a stop from full speed in one frame — a knockback, a stun — still
    // finishes the step in the air instead of snapping the swinging foot to a new path)
    this.stepVX = damp(this.stepVX, inp.vx, 10, dt);
    this.stepVZ = damp(this.stepVZ, inp.vz, 10, dt);
    const stepSp = Math.hypot(this.stepVX, this.stepVZ);
    const stepN = clamp01(stepSp / maxSp);
    const cadenceBoost = inp.overdrive ? 1.08 : 1;
    const strideEff = G.strideLength * (0.45 + 0.3 * stepN);
    let cad = (stepSp * cadenceBoost) / strideEff;
    if (this.ikW > 0.01) cad = Math.max(cad, 1.4);
    this.cadence = cad;
    this.beta = 0.5 - 0.2 * stepN;
    this.reach = stepSp * (this.beta / Math.max(0.5, cad));
    this.phase += cad * TAU * dt;
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
    P.legLX = -sinP * swing * fwdK * legDir;
    P.legRX = sinP * swing * fwdK * legDir;
    P.legLZ = sinP * swing * sideK * legDir;
    P.legRZ = -sinP * swing * sideK * legDir;
    P.kneeL = Math.max(0, Math.cos(ph) * legDir) * G.kneeLift * A + 0.06 * A;
    P.kneeR = Math.max(0, -Math.cos(ph) * legDir) * G.kneeLift * A + 0.06 * A;
    // Highest at mid-stance (legs passing), lowest at double support.
    P.bodyY = G.bob * A * (0.5 + 0.5 * Math.cos(2 * ph)) - G.bob * A * 0.5;
    // Beta 2.1 — with planted feet the body runs, it does not vault: lowest at mid-stance (the knee takes the weight),
    // highest in the short flight; and it sits as low as the stride needs for the legs to reach the floor
    if (this.ikW > 0.001) {
      const d = this.rig.dims;
      const L = (d.thigh + d.shin) * 0.95;
      const half = this.reach * 0.5;
      const crouch = clamp(d.thigh + d.shin - Math.sqrt(Math.max(0, L * L - half * half)) + 0.012, 0, 0.16) * this.rig.root.scale.y;
      const mid = Math.PI / 2 + this.beta * Math.PI;
      const runBob = -G.bob * A * 0.4 * (0.5 + 0.5 * Math.cos(2 * (ph - mid)));
      P.bodyY = mix(P.bodyY, runBob - crouch, this.ikW);
    }
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
    } else if (rig.look.weapon === 'revolver') {
      // Alpha 1.9.8 — ACE: GOLDEN ACE hangs easily at his side, muzzle down; the free arm swings with an easy stride
      P.shRX = -0.16 + sinP * A * 0.1;
      P.shRZ = -0.08;
      P.elR = -0.5;
      P.shLX = sinP * A * 0.5;
      P.shLZ = 0.12;
      P.elL = -0.3 - A * 0.35;
    } else if (rig.look.weapon === 'stinger') {
      // compact blaster carried close at the chest, the free hand near the wrist
      P.shRX = -0.55 + sinP * A * 0.1;
      P.shRZ = 0.2;
      P.elR = -1.35;
      P.shLX = -0.6 - sinP * A * 0.1;
      P.shLZ = -0.3;
      P.elL = -1.3;
    } else if (rig.look.weapon === 'cane') {
      // Alpha 1.7 — Lucien strolls like a gentleman: the forearm level, the cane hanging from the
      // pommel (tip near the floor), swinging forward with the step
      P.shRX = -0.22 + sinP * A * 0.14;
      P.shRZ = 0.06;
      P.elR = -1.3;
      this.caneTgt = 1.24 - sinP * A * 0.22 + A * 0.08;
      P.shLX = sinP * A * 0.45;
      P.shLZ = 0.1;
      P.elL = -0.3 - A * 0.3;
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
          const b = 0.5 + 0.5 * Math.sin(t * 6.2) * (0.85 + 0.15 * this.wob(t, 0.37, 1));
          P.bodyY += (b * 0.04 - 0.02) * idleW;
          P.kneeL += (0.24 + b * 0.14) * idleW;
          P.kneeR += (0.24 + b * 0.14) * idleW;
          P.legLX -= (0.13 + b * 0.07) * idleW;
          P.legRX -= (0.13 + b * 0.07) * idleW;
          P.legLZ += 0.07 * idleW;
          P.legRZ -= 0.07 * idleW;
          P.spineRX += 0.07 * idleW;
          P.headRX += (Math.sin(t * 6.2 + 0.6) * 0.03 + this.wob(t, 0.9, 2) * 0.012) * idleW;
          P.spineRY += this.wob(t, 1.3, 3) * 0.05 * idleW;
          break;
        }
        case 'heavy': {
          const br = this.wob(t, 1.6, 4);
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
          P.hipsRZ += this.wob(t, 0.8, 5) * 0.03 * idleW;
          break;
        }
        case 'poise': {
          // composed: weight settled on one hip, slow breathing, a slight chin-up
          const br = this.wob(t, 1.2, 6);
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
          const sw = this.wob(t, 1.5, 7);
          P.hipsRZ += sw * 0.08 * idleW;
          P.bodyX += sw * 0.03 * idleW;
          P.spineRZ -= sw * 0.09 * idleW;
          P.headRZ += this.wob(t + 0.47, 1.5, 7) * 0.08 * idleW;
          P.kneeL += (0.1 + Math.max(0, sw) * 0.2) * idleW;
          P.kneeR += (0.1 + Math.max(0, -sw) * 0.2) * idleW;
          P.legLX -= Math.max(0, sw) * 0.09 * idleW;
          P.legRX -= Math.max(0, -sw) * 0.09 * idleW;
          break;
        }
        case 'showman': {
          // Kai: cocky — weight on the back leg, the head nodding to the show's beat
          const beat = Math.sin(t * 4.4) * (0.8 + 0.2 * this.wob(t, 0.31, 8));
          P.hipsRZ -= 0.05 * idleW;
          P.bodyX -= 0.02 * idleW;
          P.spineRZ += 0.05 * idleW;
          P.kneeL += 0.2 * idleW;
          P.legLX -= 0.12 * idleW;
          P.kneeR += 0.05 * idleW;
          P.headRX += beat * 0.035 * idleW;
          P.headRZ += 0.04 * idleW;
          P.spineRY += this.wob(t, 2.2, 9) * 0.04 * idleW;
          P.shLZ += 0.06 * idleW;
          break;
        }
        case 'feint': {
          // Rina: light on the balls of the feet, small shuffles from side to side
          const sh = this.wob(t, 3.4, 10);
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
          P.headRY += this.wob(t, 1.7, 11) * 0.06 * idleW;
          break;
        }
        case 'brawler': {
          // Crash: restless — bouncing weight, rolling shoulders, a twitchy head
          const b = Math.abs(Math.sin(t * 5));
          const roll = this.wob(t, 2.6, 12);
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
          // (Beta 2.1: the twitch eases in and out — it was a one-frame step of 0.08 rad)
          const tw = (t * 1.3) % 3;
          P.headRZ += (tw < 1 ? Math.pow(Math.sin(Math.PI * tw), 2) * 0.08 : 0) * idleW;
          break;
        }
        case 'tactician': {
          // Zoe: low ready, weight forward, the head scanning the arena in short deliberate stops
          // (Beta 2.1: deliberate stops, each head turn eased over ~0.4 s instead of one frame)
          const sc = t * 0.9;
          const si = Math.floor(sc);
          const scan = (Math.sin((si - 1) * 2.4) + (Math.sin(si * 2.4) - Math.sin((si - 1) * 2.4)) * smoothstep(0, 0.35, sc - si)) * 0.22;
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
        case 'duelist': {
          // Lucien: upright and poised — the weight on the back leg, the front foot pointed, chest high,
          // chin up, a slow sway as if he listens to music only he can hear
          const sw = this.wob(t, 1.1, 13);
          P.hipsRZ += (0.05 + sw * 0.012) * idleW;
          P.bodyX += 0.02 * idleW;
          P.kneeL += 0.16 * idleW;
          P.legRX -= 0.14 * idleW;
          P.kneeR += 0.06 * idleW;
          P.legLZ += 0.04 * idleW;
          P.spineRX -= 0.05 * idleW;
          P.spineRZ += sw * 0.02 * idleW;
          P.headRX -= 0.06 * idleW;
          P.headRZ += 0.03 * idleW;
          break;
        }
        case 'clockwork': {
          // Alpha 1.9.7 — CRAX: a guard at attention (heels close, chest out, chin up); the head and the shoulders move in
          // small clockwork STEPS, never smoothly, and in the lobby he checks the key on his back now and then
          const step = (v: number, n: number) => Math.round(v * n) / n;
          P.headRY += step(Math.sin(t * 0.85), 3) * 0.17 * idleW;
          P.headRX -= (0.05 + step(Math.sin(t * 0.6 + 2), 2) * 0.03) * idleW;
          const sh = step(Math.sin(t * 1.7 + 1), 2) * 0.035;
          P.shLZ += sh * idleW;
          P.shRZ -= sh * idleW;
          P.spineRX -= 0.06 * idleW;
          P.legLZ += 0.025 * idleW;
          P.legRZ -= 0.025 * idleW;
          if (!inp.combat && idleW > 0.9) {
            this.selfWindT -= dt;
            if (this.selfWindT <= 0) {
              this.selfWindT = 8 + Math.random() * 6;
              this.clockWind(true);
            }
          }
          break;
        }
        case 'headliner': {
          // Alpha 1.9.8 — ACE: an easy star's stance — the weight on one leg, the other knee loose, a slight hip, the chest
          // open and the chin up, a slow sway as if the music of the show plays for him
          const sw = this.wob(t, 1.2, 14);
          P.hipsRZ += (0.045 + sw * 0.01) * idleW;
          P.bodyX += 0.018 * idleW;
          P.kneeR += 0.12 * idleW;
          P.legRX -= 0.06 * idleW;
          P.legRZ -= 0.04 * idleW;
          P.spineRX -= 0.04 * idleW;
          P.spineRZ += sw * 0.015 * idleW;
          P.headRX -= 0.05 * idleW;
          P.headRZ -= 0.025 * idleW;
          break;
        }
        case 'champion': {
          // Victor: still and upright — a slow deep breath, chin up, a wide planted stance
          const br = this.wob(t, 1.05, 15);
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
      // (Beta 2.1: breathing is a breath — a slightly irregular one — and the chest's small sway never repeats exactly)
      const br = Math.sin(t * this.breathRate + this.wob(t, 0.23, 16) * 0.6);
      P.spineRX += (this.wob(t, 2.3, 17) * 0.016 - br * 0.012) * idleW;
      // a living head: tiny, slow drift around where it looks (a few mm at the face)
      P.headRX += this.wob(t, 0.53, 18) * 0.012 * idleW;
      P.headRY += this.wob(t, 0.41, 19) * 0.018 * idleW;
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
        case 'revolver':
          // Alpha 1.9.8 — ACE: the duelist's line — the gun arm locked out at the target, the body bladed, chin up, the
          // free hand folded behind the back
          this.to('shRX', -1.44 + bob);
          this.to('shRZ', 0.1);
          this.to('elR', -0.08);
          this.to('shLX', 0.42);
          this.to('shLZ', 0.22);
          this.to('elL', -1.72);
          P.spineRY += -0.22 * aw;
          P.headRY += 0.14 * aw;
          P.headRX -= 0.04 * aw;
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
        case 'cane':
          this.canePose(P, inp, aw, bob, sN, dt);
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
      const p = this.twirlT / (0.42 * (this.twirlTurns > 1 ? 1.45 : 1));
      if (p >= 1) {
        this.twirlT = -1;
        this.twirlTurns = 1;
      } else this.wFlip = ease.inOutCubic(p) * TAU * this.twirlTurns;
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
      // (1.9.8: ACE stands tall for his duel shot — only a slight give in the knees)
      const low = inp.actionCard === 'main_event' ? 0.25 : 1;
      P.kneeL += 0.45 * crouch * low;
      P.kneeR += 0.45 * crouch * low;
      P.legLX -= 0.25 * crouch * low;
      P.legRX -= 0.25 * crouch * low;
      P.bodyY -= 0.08 * crouch * low;
      if (inp.actionCard === 'main_event') {
        this.mainEventPose(P, p);
      } else if (inp.actionCard === 'bat_bite') {
        // Alpha 1.7 — BAT BITE: a predatory coil — deep and low, chin up and eyes on the prey, the cane
        // drawn back, the free hand a claw reaching forward (the bats gather around him meanwhile)
        P.kneeL += 0.2 * crouch;
        P.kneeR += 0.2 * crouch;
        P.legLX -= 0.1 * crouch;
        P.legRX -= 0.1 * crouch;
        P.bodyY -= 0.05 * crouch;
        P.spineRX += 0.42 * crouch;
        P.rollRX += 0.1 * crouch;
        P.headRX -= 0.38 * crouch;
        P.shRX = mix(P.shRX, 0.55, crouch);
        P.shRZ = mix(P.shRZ, -0.25, crouch);
        P.elR = mix(P.elR, -0.35, crouch);
        this.caneTgt = mix(this.caneTgt, 0.35, crouch);
        P.shLX = mix(P.shLX, -1.15, crouch);
        P.shLZ = mix(P.shLZ, -0.1, crouch);
        P.elL = mix(P.elL, -0.75, crouch);
      } else if (inp.actionCard === 'knockout') {
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
    } else if (inp.action === 'bite') {
      const p = clamp01(inp.actionT / Math.max(0.05, inp.actionTotal));
      if (inp.biteStage === 'rush') {
        // Alpha 1.7 — the swarm lunge: diving forward almost flat, the cane trailing, the claw reaching
        P.rollRX += 0.8;
        P.spineRX += 0.18;
        P.headRX -= 0.5;
        P.shRX = 0.9;
        P.shRZ = -0.2;
        P.elR = -0.2;
        this.caneTgt = 0.15;
        P.shLX = -1.65;
        P.shLZ = -0.05;
        P.elL = -0.3;
        P.legLX = 0.45;
        P.legRX = 0.75;
        P.kneeL = 0.7;
        P.kneeR = 0.5;
        P.bodyY += 0.12;
      } else {
        // the bite (a snap of the head, the claw on the shoulder), then a light leap back out of reach,
        // the arms opening like wings
        const snap = 1 - smoothstep(0.18, 0.4, p);
        const hop = smoothstep(0.2, 0.42, p) * (1 - smoothstep(0.85, 1, p));
        P.headRX += 0.42 * snap;
        P.spineRX += 0.32 * snap - 0.12 * hop;
        P.shLX = mix(P.shLX, -1.45, snap);
        P.shLZ = mix(P.shLZ, -0.15, snap);
        P.elL = mix(P.elL, -0.85, snap);
        P.bodyY += Math.sin(clamp01((p - 0.2) / 0.8) * Math.PI) * 0.3;
        P.rollRX -= 0.32 * hop;
        P.shLZ += 1.15 * hop;
        P.shRZ -= 1.0 * hop;
        P.shRX = mix(P.shRX, -0.5, hop);
        P.elR = mix(P.elR, -0.3, hop);
        P.kneeL += 0.75 * hop;
        P.kneeR += 0.75 * hop;
        P.legLX -= 0.35 * hop;
        P.legRX -= 0.35 * hop;
      }
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
    } else if (inp.action === 'rewind') {
      // Alpha 1.6 BACKTRACK: pulled backwards through the tape — body leaning back, arms trailing
      // forward, a VHS jitter in the shoulders
      const p = clamp01(inp.actionT / Math.max(0.05, inp.actionTotal));
      const k = Math.sin(p * Math.PI);
      const jit = Math.sin(t * 90) * 0.07 * k;
      P.rollRX -= 0.22 * k;
      P.spineRX -= 0.16 * k;
      P.spineRY += jit;
      P.shLX = mix(P.shLX, -1.0, k);
      P.shRX = mix(P.shRX, -1.0, k);
      P.elL = mix(P.elL, -0.3, k);
      P.elR = mix(P.elR, -0.3, k);
      P.kneeL += 0.3 * k;
      P.kneeR += 0.3 * k;
      P.legLX -= 0.25 * k;
      P.legRX -= 0.25 * k;
      P.headRX -= 0.1 * k;
      this.glowPulse = Math.max(this.glowPulse, 1.2 * k);
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

    // --------------------------------------------- Alpha 1.7: cane strikes, bite flourish
    if (this.strikeT >= 0) {
      this.strikeT += dt;
      if (this.strikeT >= STRIKE_TIME || terminal || inp.stunned || inp.action !== 'none') this.strikeT = -1;
      else this.strikePose(P, this.strikeT);
    }
    const leap = inp.action === 'bite' && inp.biteStage === 'leap';
    if (this.wasLeap && !leap && !terminal) this.savorT = 0;
    this.wasLeap = leap;
    if (this.savorT >= 0) {
      // the thumb drawn slowly across the lower lip, a cocked brow: elegant, never gory
      this.savorT += dt;
      const p = this.savorT / SAVOR_TIME;
      if (p >= 1 || terminal || inp.stunned) this.savorT = -1;
      else {
        const k = Math.sin(p * Math.PI);
        P.shLX = mix(P.shLX, -1.75, k);
        P.shLZ = mix(P.shLZ, -0.38, k);
        P.elL = mix(P.elL, -2.4, k);
        P.headRZ += 0.1 * k;
        P.headRX -= 0.06 * k;
        P.headRY += 0.12 * Math.sin(p * Math.PI * 2) * k;
        this.browUp = Math.max(this.browUp, 0.2 * k);
      }
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
          case 'parry': {
            // Alpha 1.6.1 FRAME CATCH: the free hand snaps out, palm first, and the body sets behind it
            const snap = p < 0.25 ? p / 0.25 : 1 - smoothstep(0.25, 1, p);
            P.shLX = mix(P.shLX, -1.55, snap);
            P.shLZ = mix(P.shLZ, -0.12, snap);
            P.elL = mix(P.elL, -0.05, snap);
            P.spineRY -= 0.22 * snap;
            P.spineRX += 0.1 * snap;
            P.kneeL += 0.2 * snap;
            P.kneeR += 0.2 * snap;
            break;
          }
        }
      }
    }

    if (this.castT >= 0) {
      this.castT += dt;
      const p = this.castT / CAST_TIME[this.castKind];
      if (p >= 1 || terminal || inp.stunned) this.castT = -1;
      else this.castPose(P, p, t);
    }
    // Alpha 1.9.7 (CRAX): the key-turn and the crank (layers over the pose; the aim and the fight timing never wait)
    if (this.rig.key || this.rig.crank) this.clockworkLayers(P, inp, dt, terminal);

    // ------------------------------------------------------------ dash
    let rollSpin = 0;
    let bodyScaleX = 1;
    let bodyScaleZ = 1;
    let bodyScaleY = 1;
    rig.body.visible = true;
    if (this.dashT >= 0) {
      this.dashT += dt;
      const dur = this.dashStyle === 'roll' ? 0.32 : this.dashStyle === 'slide' ? 0.34 : this.dashStyle === 'swirl' ? 0.36 : 0.3;
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
      } else if (this.dashStyle === 'swirl') {
        // Alpha 1.7 — Lucien: a swirl out of harm's way — one and a quarter turns, low and leaning,
        // the cane held out level like a dancer's arm, the coat tails flaring (the view adds a few bats)
        this.yawAdd += ease.inOutCubic(smoothstep(0.04, 0.96, p)) * TAU * 1.25;
        const k = Math.sin(p * Math.PI);
        P.rollRX = 0.28 * k;
        P.rollRZ = -0.18 * k;
        P.bodyY = -0.1 * k;
        P.kneeL = 0.45 * k;
        P.kneeR = 0.3 + 0.35 * k;
        P.legRX = -0.3 * k;
        P.legLX = 0.25 * k;
        P.shRX = mix(P.shRX, -0.25, k);
        P.shRZ = mix(P.shRZ, -1.25, k);
        P.elR = mix(P.elR, -0.1, k);
        this.caneTgt = mix(this.caneTgt, -0.2, k);
        P.shLX = mix(P.shLX, -0.6, k);
        P.shLZ = mix(P.shLZ, 0.5, k);
        P.elL = mix(P.elL, -1.3, k);
        P.headRX = -0.15 * k;
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
          else if (this.dashStyle === 'slide' || this.dashStyle === 'spin' || this.dashStyle === 'swirl') this.events.onStep?.(false);
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
        } else if (this.dashStyle === 'swirl') {
          // Lucien comes out of the swirl with a little flick of the cane
          this.caneTgt -= 0.4 * Math.sin(rp * Math.PI);
          P.headRX -= 0.06 * w;
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
      // Beta 2.1: a long gun (Kai's trick pistol) dangles from the hand while dizzy — its barrel went into the body
      if (this.rig.look.weapon === 'ricochet') this.wFlip = -1.2;
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
        if (this.victoryStyle === 'headliner') this.aceFlairN++;
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
    // Beta 2.1 — frame-rate independence: the pose follows its target in steps of at most 1/120 s, the target moving in
    // a straight line from last frame's to this frame's. At 30 fps the old single step let fast targets (the stride,
    // a shot's kick) through with another size and timing than at 120 fps (animlab «fps30»).
    // Beta 2.1 — and it follows as a CRITICALLY DAMPED second-order system (no overshoot, the same rise time as the old
    // first-order step: ω = 2.15 × rate): a joint's speed is continuous, so a new state (a stun, a cast, a stop) starts
    // and ends its motion with an ease instead of a jump in speed (the «pop» animlab counts).
    const Q = this.prevTgt;
    const V = this.curVel;
    const n = Math.min(8, Math.max(1, Math.ceil(dt * 120 - 1e-6)));
    const h = dt / n;
    const om = rate * 2.15;
    const om2 = om * om;
    const om2x = 2 * om;
    for (const k of POSE_KEYS) {
      const from = this.prevValid ? Q[k] : P[k];
      let c = C[k];
      let v = V[k];
      for (let j = 1; j <= n; j++) {
        v += (om2 * (from + (P[k] - from) * (j / n) - c) - om2x * v) * h;
        c += v * h;
      }
      if (Number.isFinite(c) && Number.isFinite(v)) {
        C[k] = c;
        V[k] = v;
      } else {
        C[k] = P[k];
        V[k] = 0;
      }
      Q[k] = P[k];
    }
    this.prevValid = true;

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
    // Alpha 1.7: a cane strike steps the body forward a little
    this.lungeCur = damp(this.lungeCur, this.lungeZ, 22, dt);
    // Alpha 1.5.6: the lean springs (settle = fore/aft, settleSide = sideways) tilt the whole upper
    // body; the legs counter-rotate by the hip share so the feet stay where they are
    rig.body.position.set(C.bodyX, C.bodyY + koLift - dp * 0.12, koSlide + sv * 0.035 - pz + this.lungeCur);
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
    // Alpha 1.7: Lucien's cane turns in the hand (carried tip-down, pointed, swung) — 0 for every other weapon
    this.caneCur = damp(this.caneCur, this.caneTgt, 18, dt);
    if (rig.weaponR) {
      // (Alpha 1.5.6: plus a visible slide back with the climb)
      rig.weaponR.position.y = this.weaponBaseR + clamp(rR * 0.012, -0.05, 0.2) * slide * 10 + cR * 0.12;
      rig.weaponR.rotation.set(this.weaponTiltR + this.wFlip + this.caneCur, this.wSpin, 0);
    }
    if (rig.tail) {
      // Alpha 1.7: the coat tails trail with speed, flare in a dash or a lunge and sway against a strafe
      const tk = this.tailKick.update(dt);
      const rushing = inp.action === 'bite' || this.dashT >= 0;
      const tx = this.koT >= 0 ? 0.05 : 0.08 + sN * 0.42 + (rushing ? 0.6 : 0) + clamp(-this.accZ * 0.012, 0, 0.25);
      this.tailX = damp(this.tailX, tx, 8, dt);
      this.tailZ = damp(this.tailZ, this.koT >= 0 ? 0 : -lx * 0.3 * A, 6, dt);
      rig.tail.rotation.set(clamp(this.tailX + tk * 0.06, -0.2, 1.35), 0, this.tailZ);
    }
    // Alpha 1.9.7 (CRAX): the key turns slowly all the time (fast while he winds it); the crank turns between bursts
    if (rig.key) {
      if (this.clockT >= 0) {
        // the key turns WITH the hand: a third of a turn on each wrist turn, still while the hand reaches and returns
        const tp = clamp01((this.clockT / this.windDur - 0.28) / 0.54);
        const steps = Math.min(2, tp * 2);
        const k = Math.floor(steps) + ease.inOutCubic(steps - Math.floor(steps));
        this.keyAngle = this.keyFrom + (k * TAU) / 3;
      } else if (this.koT < 0) this.keyAngle = (this.keyAngle + dt * 0.6) % TAU;
      rig.key.rotation.set(0, 0, this.keyAngle);
    }
    if (rig.crank) rig.crank.rotation.set(this.crankAngle, 0, 0);
    if (rig.weaponL) {
      rig.weaponL.position.y = this.weaponBaseL + clamp(rL * 0.012, -0.05, 0.2) * slide * 10 + cL * 0.12;
      rig.weaponL.rotation.set(this.weaponTiltL, -this.wSpin, 0);
    }
    const sqk = clamp(sq * 0.012, -0.12, 0.18);
    rig.body.scale.set(bodyScaleX * this.sx * (1 + sqk * 0.5), bodyScaleY * this.sy * (1 - sqk), bodyScaleZ * this.sz * (1 + sqk * 0.5));

    // Beta 2.1 — planted feet while moving on the ground (not in a dash, a stagger, a knockback, a stun, a KO or a
    // victory routine: those keep their own leg poses)
    const grounded = !terminal && !inp.ko && !inp.knockback && !inp.stunned && this.dashT < 0 && this.staggerT < 0 && this.flair <= 0;
    // (a very fast turn of the body — a snap to a new target — hands the legs back to the turn-on-the-spot steps: the leg
    // has no ankle to twist a planted foot through half a turn)
    const turnFade = 1 - smoothstep(5, 9, Math.abs(this.yawRate));
    const ikTarget = grounded ? smoothstep(0.25, 0.9, speed) * turnFade : 0;
    this.ikW = damp(this.ikW, ikTarget, ikTarget > this.ikW ? 9 : 6, dt);
    let framed = false;
    if (this.ikW > 0.002) {
      this.plantFeet(inp, speed, dt);
      framed = true;
    } else {
      this.footL.mode = -1;
      this.footR.mode = -1;
    }
    this.levelFeet(framed);

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
    const open = this.mouthT > 0 || inp.stunned || this.koT >= 0 || inp.action === 'windup' || inp.action === 'rush' || inp.action === 'bite' || inp.cutStage === 'prep';
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

  /**
   * Beta 2.1 — PLANTED LOCOMOTION. The angle-driven legs swung on a sine and the low-pass pose lagged them, so a foot
   * touched down while still swinging forward and then slid (it moved at ~95 % of the running speed on the floor —
   * `npm run animlab`). Here each foot follows a footstep: in stance it holds its point on the floor while the body
   * passes over it (the knee takes the body's bob), in swing it lifts and travels to where the next stance will need it.
   * A two-bone IK (hip pitch and roll, knee) reaches that point from the hip, every frame, after the body's own pose,
   * so leans, sways, squash and recoil never drag a planted foot. The result is blended with the angle-driven legs by
   * `ikW` (standing still, dashing, stunned, KO and victory keep their own legs). Visual only: the simulation, hit boxes
   * and speeds are untouched.
   */
  private plantFeet(inp: AnimInput, speed: number, dt: number): void {
    const rig = this.rig;
    const d = rig.dims;
    const w = this.ikW;
    // the travel direction (parent space), smoothed so a sudden reversal turns the steps instead of flipping them
    const vx = this.stepVX;
    const vz = this.stepVZ;
    const sp = Math.hypot(vx, vz);
    if (sp > 0.2) {
      const k = 1 - Math.exp(-14 * dt);
      this.travelX += (vx / sp - this.travelX) * k;
      this.travelZ += (vz / sp - this.travelZ) * k;
      const n = Math.hypot(this.travelX, this.travelZ) || 1;
      this.travelX /= n;
      this.travelZ /= n;
    }
    const cad = Math.max(0.5, this.cadence);
    const sN = clamp01(sp / Math.max(0.1, inp.maxSpeed));
    // (the stance share and the reach come from the locomotion section — the same numbers that lowered the body)
    const beta = this.beta;
    const swingT = (1 - beta) / cad;
    const reach = this.reach;
    const lift = (0.05 + 0.065 * this.gait.kneeLift) * clamp01(sN * 1.4) * rig.root.scale.y;
    const ankleY = (d.hipY - 0.04 - d.thigh - d.shin) * rig.root.scale.y;
    // the chain root → body → roll → hips, with this frame's transforms
    this.hipsFrame();
    for (let side = 0; side < 2; side++) {
      const leg = side === 0 ? rig.legL : rig.legR;
      const knee = side === 0 ? rig.kneeL : rig.kneeR;
      const f = side === 0 ? this.footL : this.footR;
      // where this leg is in its cycle: touchdown at 0 (the left at the phase of the old left-front contact), swing from beta
      const c = (((this.phase - Math.PI / 2) / TAU + (side === 0 ? 0 : 0.5)) % 1 + 1) % 1;
      const inStance = c < beta;
      // the hip joint on the floor plane
      IK_H.copy(leg.position).applyMatrix4(IK_M);
      if (f.mode === -1) {
        f.aX = leg.rotation.x;
        f.aZ = leg.rotation.z;
        f.aK = knee.rotation.x;
        // first step: start where the cycle says the foot is
        if (inStance) {
          const s = reach / 2 - (c / beta) * reach;
          f.plantX = IK_H.x + this.travelX * s;
          f.plantZ = IK_H.z + this.travelZ * s;
          f.mode = 0;
        } else {
          f.relX = -this.travelX * reach * 0.5;
          f.relZ = -this.travelZ * reach * 0.5;
          f.vX = vx;
          f.vZ = vz;
          f.mode = 1;
        }
      } else if (inStance && f.mode === 1) {
        // touchdown: the foot stays where the swing put it
        f.plantX = IK_H.x + this.travelX * reach * 0.5;
        f.plantZ = IK_H.z + this.travelZ * reach * 0.5;
        f.mode = 0;
      } else if (!inStance && f.mode === 0) {
        // lift-off: remember where the foot is relative to the hip and how fast the hip moves away from it
        f.relX = f.plantX - IK_H.x;
        f.relZ = f.plantZ - IK_H.z;
        f.vX = vx;
        f.vZ = vz;
        f.mode = 1;
      }
      let tx: number;
      let ty: number;
      let tz: number;
      if (f.mode === 0) {
        tx = f.plantX;
        tz = f.plantZ;
        ty = ankleY;
      } else {
        // swing: Hermite from the lift-off point to the next touchdown point (both relative to the hip); the tangents
        // carry the foot's speed relative to the hip, so it leaves the floor and meets it without a jolt
        const u = clamp01((c - beta) / (1 - beta));
        const ex = this.travelX * reach * 0.5;
        const ez = this.travelZ * reach * 0.5;
        // (the foot leaves the floor already slowing against the hip — a push-off, not a further stretch of the leg)
        const m0x = -f.vX * swingT * 0.35;
        const m0z = -f.vZ * swingT * 0.35;
        const m1x = -vx * swingT;
        const m1z = -vz * swingT;
        const u2 = u * u;
        const u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1;
        const h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2;
        const h11 = u3 - u2;
        tx = IK_H.x + h00 * f.relX + h10 * m0x + h01 * ex + h11 * m1x;
        tz = IK_H.z + h00 * f.relZ + h10 * m0z + h01 * ez + h11 * m1z;
        // the lift peaks a little before the middle of the swing (the foot clears the floor early, then reaches); it
        // leaves and meets the floor with no vertical speed (sin^1.6), so the knee does not jolt at contact
        ty = ankleY + lift * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 1.6);
      }
      this.solveLeg(side, tx, ty, tz, dt);
      leg.rotation.set(mix(leg.rotation.x, f.aX, w), 0, mix(leg.rotation.z, f.aZ, w));
      knee.rotation.set(mix(knee.rotation.x, f.aK, w), 0, 0);
    }
  }

  /**
   * Beta 2.1 — the two-bone leg IK: the hip pitch and roll and the knee that put this leg's ankle at (tx, ty, tz) in the
   * fighter's parent space (IK_INV must hold the hips' inverse transform of this frame). The result goes to the foot
   * state's angles, rate-limited (a running leg swings at up to ~18 rad/s; faster is spread over a few frames).
   */
  private solveLeg(side: number, tx: number, ty: number, tz: number, dt: number): void {
    const rig = this.rig;
    const d = rig.dims;
    const leg = side === 0 ? rig.legL : rig.legR;
    const f = side === 0 ? this.footL : this.footR;
    // the target in the leg's own space (relative to the hip joint, before the leg's rotation); never above the knee's
    // reach under the hip (a foot left far behind by a sudden turn is reached for, not swung over the head)
    IK_V.set(tx, ty, tz).applyMatrix4(IK_INV).sub(leg.position);
    const below = (d.thigh + d.shin) * 0.35;
    if (IK_V.y > -below) IK_V.y = -below;
    const L1 = d.thigh;
    const L2 = d.shin;
    // soft reach: the last 6 % of the leg's length is approached smoothly, so the knee never snaps straight
    const Lmax = L1 + L2;
    const soft = Lmax * 0.94;
    let D = IK_V.length();
    if (D > soft) D = soft + (Lmax * 0.998 - soft) * (1 - Math.exp(-(D - soft) / (Lmax * 0.998 - soft)));
    D = Math.max(D, Math.abs(L1 - L2) + 0.01);
    // knee: law of cosines (the knee bends backwards, + is the bend)
    const cosK = clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1);
    const kneeA = Math.PI - Math.acos(cosK);
    // the leg chain with that knee: (0, fy, fz) in the leg's space, then the hip's roll (z) and pitch (x)
    const fy = -L1 - L2 * Math.cos(kneeA);
    const fz = -L2 * Math.sin(kneeA);
    const n = IK_V.length() || 1;
    const sx = (IK_V.x / n) * D;
    const syy = (IK_V.y / n) * D;
    const sz = (IK_V.z / n) * D;
    const roll = clamp(Math.asin(clamp(sx / Math.max(1e-4, -fy), -1, 1)), -0.6, 0.6);
    const v = fy * Math.cos(roll);
    // (the thigh's range: up to ~92° forward, ~57° back)
    const pitch = clamp(wrapAngle(Math.atan2(sz, syy) - Math.atan2(fz, v)), -1.6, 1.0);
    const lim = 24 * dt;
    f.aX += clamp(pitch - f.aX, -lim, lim);
    f.aK += clamp(kneeA - f.aK, -lim, lim);
    f.aZ += clamp(roll - f.aZ, -lim * 0.42, lim * 0.42);
  }

  /** Beta 2.1: this frame's hips transform (root → body → roll → hips) and its inverse, for the leg IK and the feet. */
  private hipsFrame(): void {
    const rig = this.rig;
    rig.root.updateMatrix();
    rig.body.updateMatrix();
    rig.roll.updateMatrix();
    rig.hips.updateMatrix();
    IK_M.copy(rig.root.matrix).multiply(rig.body.matrix).multiply(rig.roll.matrix).multiply(rig.hips.matrix);
    IK_INV.copy(IK_M).invert();
  }

  /**
   * Beta 2.1 — LEVEL FEET. The shoes used to be part of the shin, so a bent knee tipped the toe into the floor (3–9 cm in
   * the old idle) and lifted the heel. Now each shoe turns on its ankle: whenever it is near the floor it stays level
   * with it (pitch and a little roll, within an ankle's range); in the air it goes back to following the shin. A
   * planted step adds a small toe-down after lift-off and a toe-up before the next contact (both zero at the contacts).
   */
  /** The shoe's extent in its foot's frame (m, the root's scale aside): built once from the shoe's own meshes. */
  private shoeBoxCache: { y0: number; y1: number; z0: number; z1: number } | null = null;
  private shoeBox(): { y0: number; y1: number; z0: number; z1: number } {
    if (this.shoeBoxCache) return this.shoeBoxCache;
    const b = { y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
    for (const ch of this.rig.footL.children) {
      const m = ch as unknown as { isMesh?: boolean; material?: { side?: number }; position: Vector3; geometry?: { boundingBox: { min: Vector3; max: Vector3 } | null; computeBoundingBox(): void } };
      // (the outline shells — back faces — are left out: the shoe itself is what touches the floor)
      if (!m.isMesh || !m.geometry || m.material?.side === 1) continue;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox!;
      b.y0 = Math.min(b.y0, bb.min.y + m.position.y);
      b.y1 = Math.max(b.y1, bb.max.y + m.position.y);
      b.z0 = Math.min(b.z0, bb.min.z + m.position.z);
      b.z1 = Math.max(b.z1, bb.max.z + m.position.z);
    }
    // (a rig without shoe meshes: the sole line of the shoe's dimensions, as before)
    if (!Number.isFinite(b.y0)) {
      const d = this.rig.dims;
      Object.assign(b, { y0: 0, y1: 0, z0: 0.07 - d.shoeL * 0.5, z1: 0.07 + d.shoeL * 0.5 });
    }
    this.shoeBoxCache = b;
    return b;
  }

  private levelFeet(framed: boolean): void {
    const rig = this.rig;
    const terminalKO = this.koT >= 0;
    const sc = Math.max(0.01, rig.root.scale.y);
    // the ankle's height when the sole is on the floor (the shoes are built with the sole at the ankle)
    const floorY = 0;
    // (the hips' transform of this frame — already there when the planted steps ran)
    if (!framed) this.hipsFrame();
    for (let side = 0; side < 2; side++) {
      const leg = side === 0 ? rig.legL : rig.legR;
      const knee = side === 0 ? rig.kneeL : rig.kneeR;
      const foot = side === 0 ? rig.footL : rig.footR;
      const f = side === 0 ? this.footL : this.footR;
      leg.updateMatrix();
      knee.updateMatrix();
      FT_M.copy(IK_M).multiply(leg.matrix).multiply(knee.matrix);
      // the ankle's height above the floor (the foot's origin)
      FT_F.copy(foot.position).applyMatrix4(FT_M);
      // THE FLOOR: in any pose on the ground, an ankle below the floor is lifted onto it by the leg IK (the knee bends)
      // — the old poses lowered the body (a crouch, a bob, a landing) without shortening the legs, so the shoes sank
      if (!terminalKO && FT_F.y < floorY - 0.002) {
        f.aX = leg.rotation.x;
        f.aZ = leg.rotation.z;
        f.aK = knee.rotation.x;
        this.solveLeg(side, FT_F.x, floorY, FT_F.z, 1);
        leg.rotation.set(f.aX, 0, f.aZ);
        knee.rotation.set(f.aK, 0, 0);
        leg.updateMatrix();
        knee.updateMatrix();
        FT_M.copy(IK_M).multiply(leg.matrix).multiply(knee.matrix);
        FT_F.copy(foot.position).applyMatrix4(FT_M);
      }
      const ankleY = FT_F.y / sc;
      // level when the shoe is at the floor (ankle within ~6 cm), back to the shin's line by ~20 cm (jumps, tucks)
      const w = terminalKO ? 0 : 1 - smoothstep(0.06, 0.2, ankleY);
      // the shin's own axes in the world (columns of its matrix): the shoe's toe line at ankle angle `a` is
      // (0, −sin a, cos a) in the shin's frame, so its world height changes by z·(−sin a·Yy + cos a·Zy)
      const e = FT_M.elements;
      const ys = Math.hypot(e[4], e[5], e[6]) || 1;
      const zs = Math.hypot(e[8], e[9], e[10]) || 1;
      const Yy = e[5] / ys;
      const Zy = e[9] / zs;
      const Xy = e[1] / (Math.hypot(e[0], e[1], e[2]) || 1);
      // the angle that lays the sole flat (toe forward), and a little roll against the shin's side tilt
      const level = clamp(Math.atan2(Zy, Yy), -0.75, 1.3);
      let px = level * w;
      const pz = clamp(-Math.asin(clamp(Xy, -1, 1)), -0.35, 0.35) * w;
      // a planted step: toe down after lift-off, toe up before contact (zero at both)
      if (this.ikW > 0.002 && f.mode === 1) {
        const c = (((this.phase - Math.PI / 2) / TAU + (side === 0 ? 0 : 0.5)) % 1 + 1) % 1;
        const u = clamp01((c - this.beta) / (1 - this.beta));
        const toe = 0.35 * Math.sin(Math.PI * clamp01(u / 0.55)) - 0.18 * Math.sin(Math.PI * clamp01((u - 0.55) / 0.45));
        px += toe * this.ikW * clamp01(this.speedN * 1.5);
      }
      // toe and heel stay above the floor: among the ankle's angles (−0.75 … +1.3 rad) the one nearest the wanted angle
      // whose shoe clears the floor; if none does, the one that clears it most. Beta 2.1 final: the WHOLE shoe is
      // measured (its box: sole, toe, heel and the top of the upper — a steep angle swings the upper down, and measuring
      // the sole line alone let a kneeling slide bury it 12–16 cm), and a kneeling slide (the shin along the floor, no
      // angle in the range clears) may point the toe back further, the instep on the floor (to −1.65 rad).
      if (!terminalKO && ankleY < 0.4) {
        const box = this.shoeBox();
        const clear = (a: number) => {
          // a point (h up the shoe, z along it) at ankle angle a rises by h·(cos a·Yy + sin a·Zy) + z·(cos a·Zy − sin a·Yy)
          const hy = Math.cos(a) * Yy + Math.sin(a) * Zy;
          const zy = Math.cos(a) * Zy - Math.sin(a) * Yy;
          const lo = Math.min(box.y0 * hy, box.y1 * hy) + Math.min(box.z0 * zy, box.z1 * zy);
          return FT_F.y - floorY + lo * sc;
        };
        if (clear(px) < -0.004) {
          const search = (from: number, to: number) => {
            let best = px;
            let bestC = -Infinity;
            let near = Infinity;
            for (let a = from; a <= to + 1e-4; a += 0.05) {
              const cl = clear(a);
              const dist = Math.abs(a - px);
              if (cl >= -0.004 ? dist < near : near === Infinity && cl > bestC) {
                if (cl >= -0.004) near = dist;
                bestC = cl;
                best = a;
              }
            }
            return { a: best, c: bestC, ok: near < Infinity };
          };
          let r = search(-0.75, 1.3);
          if (!r.ok) {
            const wide = search(-1.65, 1.3);
            if (wide.ok || wide.c > r.c) r = wide;
          }
          px = r.a;
        }
      }
      foot.rotation.set(px, 0, pz);
    }
  }

  /**
   * Alpha 1.7 — Lucien's combat stance with the cane (aim layer, weight `aw`): the guard (forearm
   * level, the cane toward the opponent, the free hand behind his back), the point just before each
   * bolt (arm and cane in one line — from the simulation's own fire timer) and, up close, the
   * fencing guard (lower, the cane at chest height, the free hand raised behind).
   */
  private canePose(P: Pose, inp: AnimInput, aw: number, bob: number, sN: number, dt: number): void {
    this.meleeW = damp(this.meleeW, inp.melee ? 1 : 0, 7, dt);
    const pre = !inp.melee && inp.fireIn >= 0 && inp.fireIn < 0.18 && inp.action === 'none' ? 1 - inp.fireIn / 0.18 : 0;
    const post = inp.melee ? 0 : 1 - smoothstep(0.06, 0.22, this.t - this.lastShotT);
    const want = Math.max(smoothstep(0, 1, pre), post);
    this.pointW = damp(this.pointW, want, want > this.pointW ? 22 : 9, dt);
    const m = this.meleeW;
    const pt = this.pointW * (1 - m);
    // (shRZ swings the raised arm back toward the centre line against the bladed torso, so the cane points at the opponent)
    let shRX = mix(-0.68 + bob * 0.4, -1.52 + bob * 0.2, pt);
    let shRZ = mix(0.4, 0.44, pt);
    let elR = mix(-0.78, -0.04, pt);
    let tilt = mix(-0.5, -0.03, pt);
    shRX = mix(shRX, -1.18 + bob * 0.3, m);
    shRZ = mix(shRZ, 0.46, m);
    elR = mix(elR, -0.45, m);
    tilt = mix(tilt, -0.14, m);
    this.to('shRX', shRX);
    this.to('shRZ', shRZ);
    this.to('elR', elR);
    this.to('shLX', mix(0.5, 0.15, m));
    this.to('shLZ', mix(0.16, 1.25, m));
    this.to('elL', -1.7);
    this.caneTgt = mix(this.caneTgt, tilt, aw);
    // bladed: the right shoulder leads, the head stays on the opponent
    P.spineRY += (-0.22 - 0.08 * pt - 0.06 * m) * aw;
    P.headRY += (0.16 + 0.06 * pt + 0.05 * m) * aw;
    P.headRX -= 0.04 * pt * aw;
    // planted feet: a duelist's stance, lower and wider in the fencing guard
    const st = (1 - Math.min(1, sN * 2.5)) * aw;
    P.legRX -= (0.22 + 0.22 * m) * st;
    P.kneeR += (0.15 + 0.2 * m) * st;
    P.legLX += (0.1 + 0.15 * m) * st;
    P.kneeL += (0.2 + 0.18 * m) * st;
    P.bodyY -= 0.05 * m * st;
    // the crimson glow gathers in the cane as it comes up to point
    if (pre > 0) this.glowPulse = Math.max(this.glowPulse, 0.4 + pre * 1.2);
  }

  /** Alpha 1.7 — one cane strike at `p` s: chambered → the contact at the windup → follow-through to the guard. */
  private strikePose(P: Pose, p: number): void {
    const w = this.strikeWind;
    const env = smoothstep(0, 0.05, p) * (1 - smoothstep(0.24, STRIKE_TIME, p));
    const q = p < w ? smoothstep(0, w, p) : 1;
    // [shRX, shRZ, elR, cane tilt, spine twist] chambered and at the contact
    let a0 = -0.88, a1 = 0.12, a2 = -1.3, a3 = -0.2, a4 = -0.2;
    let b0 = -1.56, b1 = 0.03, b2 = -0.02, b3 = -0.02, b4 = -0.5;
    if (this.strikeVar === 1) {
      // a slash from high outside across the body
      a0 = -2.1; a1 = -0.55; a2 = -0.55; a3 = -0.55; a4 = -0.55;
      b0 = -1.25; b1 = 0.72; b2 = -0.15; b3 = 0.08; b4 = 0.28;
    } else if (this.strikeVar === 2) {
      // the back-slash: from low across the body up and out
      a0 = -1.0; a1 = 0.78; a2 = -0.9; a3 = 0.25; a4 = 0.3;
      b0 = -1.78; b1 = -0.5; b2 = -0.1; b3 = -0.32; b4 = -0.45;
    }
    P.shRX = mix(P.shRX, mix(a0, b0, q), env);
    P.shRZ = mix(P.shRZ, mix(a1, b1, q), env);
    P.elR = mix(P.elR, mix(a2, b2, q), env);
    this.caneTgt = mix(this.caneTgt, mix(a3, b3, q), env);
    P.spineRY = mix(P.spineRY, mix(a4, b4, q), env);
    // the step into it: a full lunge for the thrust, half a step for the slashes
    const lunge = (this.strikeVar === 0 ? 1 : 0.45) * q * env;
    P.legRX -= 0.6 * lunge;
    P.kneeR += 0.45 * lunge;
    P.legLX += 0.35 * lunge;
    P.rollRX += 0.22 * lunge;
    P.spineRX += 0.08 * lunge;
    this.lungeZ = 0.24 * lunge;
    if (p >= w && p < w + 0.06) this.glowPulse = Math.max(this.glowPulse, 1.1);
  }

  /**
   * Beta 2.1 — organic idle motion: three sines at golden-ratio-spaced frequencies around `f` (rad/s), offset by this
   * fighter's own seed and a channel number, so the idle never loops visibly and two fighters never move in step.
   * Range about −1..1, mean 0, the same «speed» as sin(f·t).
   */
  private wob(t: number, f: number, ch: number): number {
    const s = this.seed + ch * 2.399;
    return 0.66 * Math.sin(f * t + s) + 0.24 * Math.sin(f * 1.618 * t + s * 1.7 + 1.1) + 0.1 * Math.sin(f * 2.618 * t + s * 2.3 + 2.3);
  }

  /** Blend one pose key toward `v` by the current mix weight `this.w` (no per-frame closures). */
  /** Alpha 1.9.7 (CRAX): the key-turn gesture and the crank, mixed over the pose built so far. */
  private clockworkLayers(P: Pose, inp: AnimInput, dt: number, terminal: boolean): void {
    if (this.clockT >= 0) {
      this.clockT += dt;
      const p = this.clockT / this.windDur;
      if (p >= 1 || terminal || inp.stunned || inp.knockback) this.clockT = -1;
      else {
        // 0–28 %: the body turns and the free hand swings down past the hip and behind the back to the key;
        // 28–82 %: two short wrist turns (the key steps round with each); 82–100 %: back to the rifle
        // (in two steps, so the arm never cuts through the body: back with the arm a little out to the side, THEN in
        // behind the back; on the way back out first, then forward)
        const w = ease.inOutCubic(smoothstep(0, 0.2, p)) * (1 - ease.inOutCubic(smoothstep(0.88, 1, p)));
        const wIn = ease.inOutCubic(smoothstep(0.14, 0.28, p)) * (1 - ease.inOutCubic(smoothstep(0.82, 0.92, p)));
        const tp = clamp01((p - 0.28) / 0.54);
        const twist = p > 0.28 && p < 0.82 ? Math.sin(tp * TAU * 2) : 0;
        P.spineRY += (KEY_REACH.spineRY - P.spineRY) * w;
        P.shLX += (KEY_REACH.shLX - P.shLX) * w;
        P.shLZ += (lerp(KEY_OUT, KEY_REACH.shLZ + twist * 0.05, wIn) - P.shLZ) * w;
        P.elL += (KEY_REACH.elL - twist * 0.08 * wIn - P.elL) * w;
        // the head turns to the key in two small clockwork steps, the shoulders follow the body
        P.headRY += (Math.round(w * 2) / 2) * 0.22;
        P.headRX += 0.04 * w;
        P.shRZ -= 0.04 * w;
      }
    }
    if (this.crankWait >= 0) {
      this.crankWait -= dt;
      if (this.crankWait < 0) this.crankT = 0;
    }
    if (this.crankT >= 0) {
      this.crankT += dt;
      const p = this.crankT / CRANK_TIME;
      if (p >= 1 || terminal) {
        this.crankT = -1;
        this.crankAngle = 0;
      } else {
        // the support hand drops to the crank and gives it one turn, the shoulders tick with it
        const w = Math.sin(Math.PI * p);
        this.crankAngle = ease.inOutCubic(p) * TAU;
        if (this.clockT < 0) {
          P.elL += -0.22 * w;
          P.shLZ += Math.sin(p * TAU) * 0.06 * w;
          P.headRX += 0.04 * w;
        }
      }
    }
  }

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
      // ---- Lucien (Alpha 1.7): theatrical, poised, a little arrogant
      case 'night_bow': {
        // a sweeping theatrical bow, then he rises and plants the cane before him, both hands on the pommel, chin up
        const sweep = smoothstep(0, 0.35, vt) * (1 - smoothstep(1.2, 1.5, vt));
        const bow = vt > 0.3 && vt < 1.45 ? Math.sin(((vt - 0.3) / 1.15) * Math.PI) : 0;
        const plant = smoothstep(1.3, 1.65, vt);
        this.to('shLX', lerp(-1.0 * sweep, -0.85, plant));
        this.to('shLZ', lerp(-0.7 * sweep, -0.42, plant));
        this.to('elL', lerp(-1.4, -0.95, plant));
        this.to('shRX', lerp(-0.4, -0.78, plant));
        this.to('shRZ', lerp(-1.0 * sweep, 0.36, plant));
        this.to('elR', lerp(-0.2, -0.85, plant));
        this.caneTgt = mix(this.caneTgt, lerp(-0.6 * sweep, 1.32, plant), k);
        this.to('spineRX', 0.55 * bow - 0.06 * plant);
        this.to('headRX', 0.25 * bow - 0.14 * plant);
        this.to('rollRX', 0.12 * bow);
        this.to('legRX', 0.35 * bow);
        this.to('kneeL', 0.25 * bow + 0.05);
        this.to('legLZ', 0.06 * plant);
        this.to('legRZ', -0.06 * plant);
        this.flourish(vt, 1.4, false);
        break;
      }
      case 'night_twirl': {
        // the cane spun overhead three times, then snapped down to point straight at the camera, a hand on the hip
        const spinP = clamp01((vt - 0.1) / 0.85);
        this.wFlip = spinP > 0 && spinP < 1 ? ease.inOutCubic(spinP) * TAU * 3 : 0;
        const pt = smoothstep(0.92, 1.12, vt);
        this.to('shRX', lerp(-2.6, -1.5, pt));
        this.to('shRZ', lerp(-0.2, 0.05, pt));
        this.to('elR', lerp(-0.35, -0.05, pt));
        this.caneTgt = mix(this.caneTgt, lerp(-1.4, -0.05, pt), k);
        this.to('shLX', 0.1);
        this.to('shLZ', 0.62);
        this.to('elL', -1.45);
        this.to('spineRY', -0.3 * pt);
        this.to('headRY', 0.16 * pt);
        this.to('headRX', -0.1);
        this.to('hipsRZ', 0.06);
        this.to('kneeL', 0.18);
        this.flourish(vt, 0.98, false);
        break;
      }
      // ---- Alpha 1.9.7 — CRAX
      case 'clock_salute': {
        // a heel click, the free hand snaps to the brim of the shako, the head turns to the camera in two ticks; held, then down
        const up = smoothstep(0.15, 0.32, vt) * (1 - smoothstep(1.35, 1.6, vt));
        const tick = Math.min(2, Math.floor(clamp01((vt - 0.35) / 0.5) * 3)) / 2;
        this.to('shLX', -1.9 * up);
        this.to('shLZ', 0.55 * up);
        this.to('elL', -2.35 * up);
        this.to('headRY', -0.22 * tick);
        this.to('headRX', -0.1);
        this.to('spineRX', -0.1);
        this.to('shRX', -0.2);
        this.to('elR', -0.35);
        this.to('legLZ', 0.0);
        this.to('legRZ', 0.0);
        if (vt > 0.12 && vt < 0.2) P.bodyY += 0.03 * k;
        this.flourish(vt, 0.2, true);
        break;
      }
      case 'clock_wind': {
        // he reaches back and winds the key twice (the key spins), then throws both arms up — the gold gears burst
        const wind = smoothstep(0.05, 0.3, vt) * (1 - smoothstep(0.92, 1.05, vt));
        const turn = vt > 0.45 && vt < 0.9 ? Math.sin(((vt - 0.45) / 0.45) * TAU * 2) : 0;
        const cheer = smoothstep(1.0, 1.2, vt);
        // (1.9.7 polish: the same reach behind the back as the fight's key-turn — never a hand on the head; the arm comes
        // in behind the back only once it is back, and goes out again before it comes forward)
        const wIn = smoothstep(0.3, 0.45, vt) * (1 - smoothstep(0.86, 0.94, vt));
        this.to('shLX', lerp(KEY_REACH.shLX * wind, -2.75, cheer));
        this.to('shLZ', lerp(lerp(KEY_OUT * wind, KEY_REACH.shLZ + turn * 0.05, wIn), 0.35, cheer));
        this.to('elL', lerp((KEY_REACH.elL - turn * 0.08) * wind, -0.35, cheer));
        this.to('shRX', lerp(-0.2, -2.6, cheer));
        this.to('shRZ', lerp(0, -0.3, cheer));
        this.to('elR', lerp(-0.35, -0.4, cheer));
        this.to('spineRY', KEY_REACH.spineRY * wind);
        this.to('headRY', (Math.round(wind * 2) / 2) * 0.22);
        this.to('headRX', lerp(0, -0.2, cheer));
        this.to('spineRX', lerp(0, -0.12, cheer));
        // (the key itself turns with the hand: the slow key-turn runs under this routine's arm pose)
        if (wind > 0.5 && this.clockT < 0) {
          this.clockT = 0.14 * CLOCK_WIND_SLOW;
          this.windDur = CLOCK_WIND_SLOW;
          this.keyFrom = this.keyAngle;
        }
        const hop = cheer > 0 ? Math.max(0, Math.sin((vt - 1.0) * 6)) : 0;
        P.bodyY += hop * 0.16 * k;
        this.flourish(vt, 1.05, false);
        break;
      }
      case 'clock_present': {
        // «present arms»: the rifle raised upright before the chest, then a bow in three clockwork steps
        const raise = smoothstep(0.1, 0.35, vt);
        const bowStep = Math.min(3, Math.floor(clamp01((vt - 0.55) / 0.6) * 4)) / 3;
        const back = smoothstep(1.35, 1.6, vt);
        this.to('shRX', -1.15 * raise);
        this.to('shRZ', 0.38 * raise);
        this.to('elR', -1.75 * raise);
        this.to('shLX', -1.0 * raise);
        this.to('shLZ', -0.45 * raise);
        this.to('elL', -1.4 * raise);
        this.wFlip = -0.95 * raise;
        this.to('spineRX', 0.42 * bowStep * (1 - back));
        this.to('headRX', 0.2 * bowStep * (1 - back) - 0.08 * back);
        this.to('kneeL', 0.08);
        this.to('kneeR', 0.08);
        this.flourish(vt, 0.6, false);
        break;
      }
      case 'night_cape': {
        // the high collar drawn across the lower face with a raised forearm, then flung open — chest out, chin up, the cane to the shoulder
        const open = smoothstep(0.55, 0.85, vt);
        this.to('shLX', lerp(-1.62, -0.55, open));
        this.to('shLZ', lerp(-0.48, 1.3, open));
        this.to('elL', lerp(-2.15, -0.2, open));
        this.to('headRX', lerp(0.12, -0.16, open));
        this.to('headRZ', 0.06 * open);
        this.to('spineRX', lerp(0.06, -0.16, open));
        this.to('shRX', lerp(-0.05, -0.5, open));
        this.to('shRZ', lerp(0.0, -0.1, open));
        this.to('elR', lerp(-0.25, -2.2, open));
        this.caneTgt = mix(this.caneTgt, lerp(0.25, -0.2, open), k);
        this.to('legLZ', 0.06);
        this.to('legRZ', -0.06);
        this.to('kneeR', 0.1);
        if (vt > 0.9) this.browUp = Math.max(this.browUp, 0.1);
        this.flourish(vt, 0.62, false);
        break;
      }
      // ---- Alpha 1.9.8 — ACE
      case 'ace_cuff_bow': {
        // the cuff straightened (one tug, a look at it), then a short bow to the camera with the free hand over the heart;
        // he rises with a grin, GOLDEN ACE lowered at his side
        if (vt < 1.05) this.cuffPose(this.tgt, vt / 1.05, k);
        const bow = vt > 1.0 && vt < 2.0 ? Math.sin(((vt - 1.0) / 1.0) * Math.PI) : 0;
        const after = smoothstep(0.95, 1.25, vt);
        this.to('shLX', lerp(this.tgt.shLX, -1.2, after));
        this.to('shLZ', lerp(this.tgt.shLZ, -0.55, after));
        this.to('elL', lerp(this.tgt.elL, -1.85, after));
        this.to('shRX', lerp(this.tgt.shRX, -0.15, after));
        this.to('shRZ', lerp(this.tgt.shRZ, -0.12, after));
        this.to('elR', lerp(this.tgt.elR, -0.3, after));
        this.to('spineRX', 0.42 * bow);
        this.to('headRX', 0.2 * bow - 0.06 * after);
        this.to('legRX', 0.22 * bow);
        this.to('kneeL', 0.14 * bow + 0.04);
        if (vt > 1.9) this.browUp = Math.max(this.browUp, 0.1);
        this.flourish(vt, 1.5, false);
        break;
      }
      case 'ace_spin_holster': {
        // GOLDEN ACE spun three times on the finger at chest height, then dropped to the hip as if into a holster —
        // and the free hand points at the camera with a wink
        const spinP = clamp01((vt - 0.15) / 0.95);
        this.wFlip = spinP > 0 && spinP < 1 ? ease.inOutCubic(spinP) * TAU * 3 : 0;
        const drop = smoothstep(1.1, 1.35, vt);
        this.to('shRX', lerp(-1.0, 0.05, drop));
        this.to('shRZ', lerp(0.18, -0.18, drop));
        this.to('elR', lerp(-1.3, -0.15, drop));
        const point = smoothstep(1.3, 1.55, vt);
        this.to('shLX', lerp(0.0, -1.45, point));
        this.to('shLZ', lerp(0.12, -0.15, point));
        this.to('elL', lerp(-0.35, -0.12, point));
        this.to('headRZ', 0.1 * point);
        this.to('hipsRZ', 0.05);
        this.to('kneeR', 0.12);
        if (vt > 1.45) this.browUp = Math.max(this.browUp, 0.12);
        this.flourish(vt, 1.32, false);
        break;
      }
      case 'ace_curtain_call': {
        // the headliner's curtain call: both arms open wide to the crowd, GOLDEN ACE raised high, the chin up — then a slow
        // turn of the head across the audience and a deep, easy breath
        const open = smoothstep(0.1, 0.55, vt);
        const scan = Math.sin(clamp01((vt - 0.6) / 1.2) * Math.PI * 2) * 0.22;
        this.to('shRX', lerp(-0.2, -2.35, open));
        this.to('shRZ', lerp(0, -0.55, open));
        this.to('elR', -0.2);
        this.to('shLX', lerp(0, -0.55, open));
        this.to('shLZ', lerp(0.1, 1.15, open));
        this.to('elL', -0.18);
        this.to('spineRX', -0.14 * open);
        this.to('headRX', -0.16 * open);
        this.to('headRY', scan * open);
        this.to('legLZ', 0.06);
        this.to('legRZ', -0.06);
        this.flourish(vt, 0.55, false);
        break;
      }
    }
  }

  /**
   * Alpha 1.9.8 — ACE straightens the cuff of his gun hand: the right forearm comes up across the chest (GOLDEN ACE pointing
   * away, muzzle down), the free hand takes the cuff between finger and thumb and gives it one short tug, the chin dips to
   * look at it. `k` 0..1: how far into the gesture (in, tug, out); `w`: how much of it to blend in.
   */
  private cuffPose(P: Pose, k: number, w = 1): void {
    const inW = smoothstep(0, 0.28, k) * (1 - smoothstep(0.8, 1, k)) * w;
    const tug = Math.sin(clamp01((k - 0.36) / 0.26) * Math.PI);
    // the gun hand in front of the belt, GOLDEN ACE pointing forward and down; the free hand meets its wrist
    P.shRX = mix(P.shRX, -0.55, inW);
    P.shRZ = mix(P.shRZ, 0.58, inW);
    P.elR = mix(P.elR, -1.15, inW);
    P.shLX = mix(P.shLX, -0.6 - tug * 0.05, inW);
    P.shLZ = mix(P.shLZ, -1.22 + tug * 0.1, inW);
    P.elL = mix(P.elL, -0.6 - tug * 0.2, inW);
    P.headRX += 0.32 * inW;
    P.headRY -= 0.16 * inW;
    P.spineRX += 0.05 * inW;
    P.spineRY += 0.08 * inW;
    if (k > 0.3 && k < 0.7) this.browUp = Math.max(this.browUp, 0.06 * w);
  }

  /**
   * Alpha 1.9.8 — MAIN EVENT, driven by the wind-up's own progress (the player's short wind-up and a rival's longer one
   * alike): a tall stance → the cuff → the presentation (the gun hand sweeps out wide, the body turns into the line) →
   * the arm locked on the target. The golden spotlight and the shot are the effects' and the simulation's.
   */
  private mainEventPose(P: Pose, p: number): void {
    const st = smoothstep(0, 0.16, p);
    P.spineRX -= 0.06 * st;
    P.headRX -= 0.06 * st;
    P.hipsRZ += 0.04 * st;
    if (p < 0.64) this.cuffPose(P, clamp01((p - 0.08) / 0.52));
    const sweep = smoothstep(0.5, 0.7, p) * (1 - smoothstep(0.76, 0.9, p));
    const aim = smoothstep(0.72, 0.9, p);
    P.shRX = mix(mix(P.shRX, -1.05, sweep), -1.46, aim);
    P.shRZ = mix(mix(P.shRZ, -0.6, sweep), 0.08, aim);
    P.elR = mix(mix(P.elR, -0.22, sweep), -0.05, aim);
    const back = smoothstep(0.56, 0.74, p);
    P.shLX = mix(P.shLX, 0.42, back);
    P.shLZ = mix(P.shLZ, 0.22, back);
    P.elL = mix(P.elL, -1.72, back);
    P.spineRY += -0.3 * aim + 0.16 * sweep;
    P.headRY += 0.16 * aim;
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
      case 'clockwork':
        // CRAX: a short salute with the free hand, the head in two ticks
        this.to('shLX', -1.7);
        this.to('shLZ', 0.5);
        this.to('elL', -2.2);
        this.to('headRY', -Math.round(f * 2) / 2 * 0.18);
        break;
      case 'headliner':
        // Alpha 1.9.8 — ACE, in turns: the cuff straightened (one tug, a look at it) / GOLDEN ACE spun twice on the finger at
        // chest height, then a glance and a grin to the camera
        if (this.aceFlairN % 2 === 1) this.cuffPose(this.tgt, fp, f);
        else {
          this.to('shRX', -1.0);
          this.to('shRZ', 0.15);
          this.to('elR', -1.2);
          this.wFlip = ease.inOutCubic(clamp01((fp - 0.1) / 0.6)) * TAU * 2;
          this.to('headRY', 0.2 * smoothstep(0.6, 0.9, fp));
          if (fp > 0.7) this.browUp = Math.max(this.browUp, 0.1);
        }
        break;
      case 'nightstar':
        // Lucien: the cane twirled twice at his side, a glance over the collar
        this.to('shRX', -1.15);
        this.to('shRZ', -0.5);
        this.to('elR', -0.3);
        this.caneTgt = mix(this.caneTgt, -0.4, f);
        this.wFlip = ease.inOutCubic(fp) * TAU * 2;
        this.to('headRZ', 0.1);
        this.to('headRY', 0.18);
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
