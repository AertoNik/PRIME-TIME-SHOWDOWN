// Animation feel parameters (render-side only; never affects the simulation).
import type { IdleStyle, VictoryStyle, WeaponType } from './types';

/** How a fighter carries their weight while moving. */
export interface GaitProfile {
  /** World units covered by one full cycle (two steps) — keeps feet planted. */
  strideLength: number;
  legSwing: number;
  kneeLift: number;
  /** Vertical bob per step. */
  bob: number;
  /** Lateral weight shift onto the stance leg. */
  sway: number;
  /** Forward lean at full speed. */
  lean: number;
  /** Lean from acceleration / braking. */
  accelLean: number;
  /** Bank into turns (per rad/s of yaw rate). */
  turnBank: number;
  /** Arm motion while aiming and running. */
  armBob: number;
  /** Squash on foot contact. */
  contactSquash: number;
  /** How quickly the body turns toward its aim (higher = snappier). */
  turnRate: number;
}

export const GAITS: Record<IdleStyle, GaitProfile> = {
  // Ray: light, springy, quick cadence.
  bouncy: {
    strideLength: 2.05,
    legSwing: 0.88,
    kneeLift: 1.55,
    bob: 0.085,
    sway: 0.035,
    lean: 0.22,
    accelLean: 0.075,
    turnBank: 0.07,
    armBob: 0.12,
    contactSquash: 0.07,
    turnRate: 17,
  },
  // Bruno: heavy, planted, rolling shoulders.
  heavy: {
    strideLength: 1.95,
    legSwing: 0.6,
    kneeLift: 0.95,
    bob: 0.05,
    sway: 0.085,
    lean: 0.12,
    accelLean: 0.045,
    turnBank: 0.035,
    armBob: 0.06,
    contactSquash: 0.045,
    turnRate: 9,
  },
  // Nika: smooth glide, hip sway, precise.
  sway: {
    strideLength: 2.4,
    legSwing: 0.72,
    kneeLift: 1.2,
    bob: 0.035,
    sway: 0.07,
    lean: 0.17,
    accelLean: 0.09,
    turnBank: 0.09,
    armBob: 0.05,
    contactSquash: 0.02,
    turnRate: 14,
  },
  // Alpha 1.5 — Kai: a showman's swagger: loose shoulders, confident medium stride, bank into turns.
  showman: {
    strideLength: 2.2,
    legSwing: 0.8,
    kneeLift: 1.3,
    bob: 0.06,
    sway: 0.06,
    lean: 0.16,
    accelLean: 0.08,
    turnBank: 0.11,
    armBob: 0.08,
    contactSquash: 0.04,
    turnRate: 16,
  },
  // Alpha 1.5 — Rina: light, low, quick stance changes; short quick steps.
  feint: {
    strideLength: 1.85,
    legSwing: 0.8,
    kneeLift: 1.4,
    bob: 0.045,
    sway: 0.05,
    lean: 0.2,
    accelLean: 0.1,
    turnBank: 0.08,
    armBob: 0.05,
    contactSquash: 0.035,
    turnRate: 20,
  },
  // Alpha 1.5 — Crash: impulsive, forward-leaning, heavy stomps with a jerky upper body.
  brawler: {
    strideLength: 1.9,
    legSwing: 0.75,
    kneeLift: 1.15,
    bob: 0.075,
    sway: 0.08,
    lean: 0.26,
    accelLean: 0.1,
    turnBank: 0.06,
    armBob: 0.1,
    contactSquash: 0.06,
    turnRate: 13,
  },
  // Alpha 1.5 — Victor: calm and heavy, long unhurried strides, the chest leads.
  champion: {
    strideLength: 2.35,
    legSwing: 0.66,
    kneeLift: 1.0,
    bob: 0.035,
    sway: 0.05,
    lean: 0.1,
    accelLean: 0.04,
    turnBank: 0.035,
    armBob: 0.03,
    contactSquash: 0.03,
    turnRate: 10,
  },
  // Alpha 1.5.5 — Zoe: a tactician — low and economical, quick small steps, eyes always working.
  tactician: {
    strideLength: 2.1,
    legSwing: 0.7,
    kneeLift: 1.15,
    bob: 0.03,
    sway: 0.04,
    lean: 0.19,
    accelLean: 0.085,
    turnBank: 0.07,
    armBob: 0.04,
    contactSquash: 0.02,
    turnRate: 18,
  },
  // Vega: composed and economical — long smooth strides, minimal bob, snaps onto targets.
  poise: {
    strideLength: 2.3,
    legSwing: 0.74,
    kneeLift: 1.1,
    bob: 0.03,
    sway: 0.045,
    lean: 0.15,
    accelLean: 0.07,
    turnBank: 0.06,
    armBob: 0.035,
    contactSquash: 0.02,
    turnRate: 19,
  },
};

/** Weapon handling: recoil spring and how much of the body follows each shot. */
export interface RecoilProfile {
  /** Spring impulse on the firing arm. */
  kick: number;
  stiffness: number;
  damping: number;
  /** Spine pitch back per unit of recoil. */
  spine: number;
  /** Whole-body shove backward. */
  shove: number;
  /** Weapon slides back along its barrel. */
  slide: number;
  /** Camera trauma per shot (player side halves it). */
  shake: number;
}

export const RECOIL: Record<WeaponType, RecoilProfile> = {
  twin_blasters: { kick: 11, stiffness: 520, damping: 26, spine: 0.004, shove: 0, slide: 0.05, shake: 0 },
  boom_cannon: { kick: 9, stiffness: 150, damping: 11, spine: 0.03, shove: 2.6, slide: 0.12, shake: 0.07 },
  tech_carbine: { kick: 5, stiffness: 380, damping: 20, spine: 0.007, shove: 0.35, slide: 0.04, shake: 0 },
  // marksman rifle: one firm shouldered kick per shot, quick settle
  pulse_rifle: { kick: 8, stiffness: 430, damping: 22, spine: 0.014, shove: 0.3, slide: 0.08, shake: 0 },
  // PRIME BREAKER (boss): a heavy rifle — every slug of the burst rocks the shoulders and the
  // body, the gun slides hard into the stance; a light camera tremor sells the weight
  breaker: { kick: 10, stiffness: 300, damping: 17, spine: 0.026, shove: 0.75, slide: 0.1, shake: 0.018 },
  // Alpha 1.5 — Kai's trick pistol: a snappy wrist flick with a showy follow-through
  ricochet: { kick: 12, stiffness: 360, damping: 15, spine: 0.012, shove: 0.25, slide: 0.07, shake: 0 },
  // Alpha 1.5 — Rina's compact twin-barrel: crisp light double-tap, almost no body follow
  stinger: { kick: 7, stiffness: 560, damping: 28, spine: 0.005, shove: 0.12, slide: 0.045, shake: 0 },
};

/**
 * Alpha 1.5.5 — how each weapon *feels* when it fires, on top of the recoil spring:
 * the opening shot of a series commits harder than the follow-ups, the torso and
 * shoulders take the kick, the legs absorb it when standing, and a few weapons brace
 * just before the trigger (read from the simulation's real fire timer — visual only).
 */
export interface FireStyle {
  /** Kick multiplier of the first shot after a pause (a committed opening shot). */
  firstShot: number;
  /** Relative kick of the follow-up shots: a short repeating cadence, not random noise. */
  series: readonly number[];
  /** Torso twist per shot toward the firing hand (rad). */
  twist: number;
  /** Chest lift / shoulders rocking back per shot (rad). */
  chest: number;
  /** Knee dip of a standing shot — the legs soak the kick (rad); a fraction of it while moving. */
  dip: number;
  /** Head nod with the shot (rad). */
  nod: number;
  /** Small alternating side tilt from shot to shot (controlled variation, rad). */
  sway: number;
  /** Seconds before the next shot to settle into the stance (0 = no anticipation). */
  brace: number;
  /** How deep that settle goes (0..1): lower stance, steadier arms. */
  braceAmt: number;
  // Alpha 1.5.6 — silhouette-scale recoil, sized for the battle camera (a fighter is ~85 px tall
  // on a 390×844 phone, ~40 px per metre). Peaks of a standing opening shot:
  /** Muzzle climb: the gun arm kicks up and comes back down (rad). */
  climb: number;
  /** The upper body rocks back from the shot, feet planted (rad). */
  lean: number;
  /** Weight thrown back on the heels (m) — heavy shots also take a step back. */
  push: number;
  /** Mass of the weapon: >1 slower, heavier return to the stance; <1 snappier. */
  weight: number;
}

export const FIRE_STYLE: Record<WeaponType, FireStyle> = {
  // Ray (and Dex): quick, confident pistols — alternating hands, the torso snaps to each side, no wind-up
  twin_blasters: { firstShot: 1.35, series: [1, 0.8, 0.95, 0.75], twist: 0.1, chest: 0.04, dip: 0.05, nod: 0.03, sway: 0.035, brace: 0, braceAmt: 0, climb: 0.16, lean: 0.065, push: 0.035, weight: 0.75 },
  // Bruno (Tank, Crash): a heavy cannon — sinks into the stance before the blast, the whole body takes it
  boom_cannon: { firstShot: 1.3, series: [1, 0.85], twist: 0.07, chest: 0.13, dip: 0.18, nod: 0.08, sway: 0.04, brace: 0.16, braceAmt: 1, climb: 0.18, lean: 0.075, push: 0.08, weight: 1.35 },
  // Nika (Zoe): compact, technical carbine — tight and economical, almost no body follow
  tech_carbine: { firstShot: 1.2, series: [1, 0.7, 0.8, 0.7], twist: 0.035, chest: 0.035, dip: 0.03, nod: 0.02, sway: 0.012, brace: 0.06, braceAmt: 0.4, climb: 0.11, lean: 0.06, push: 0.03, weight: 0.85 },
  // Vega: the marksman — holds her breath before the shot (steady arms), one clean kick into the shoulder
  pulse_rifle: { firstShot: 1.2, series: [1], twist: 0.02, chest: 0.05, dip: 0.04, nod: 0.06, sway: 0, brace: 0.22, braceAmt: 0.8, climb: 0.095, lean: 0.07, push: 0.05, weight: 1.05 },
  // Victor: PRIME BREAKER — braced, heavy and controlled: every slug of the burst rocks him, never sways him
  breaker: { firstShot: 1.25, series: [1, 0.8, 0.9], twist: 0.045, chest: 0.11, dip: 0.13, nod: 0.05, sway: 0, brace: 0.2, braceAmt: 1, climb: 0.125, lean: 0.065, push: 0.06, weight: 1.45 },
  // Kai: the showman — a flick of the wrist, the shoulders play to the camera, a varied rhythm
  ricochet: { firstShot: 1.4, series: [1, 0.8, 1.1, 0.75], twist: 0.13, chest: 0.06, dip: 0.035, nod: 0.05, sway: 0.07, brace: 0.1, braceAmt: 0.3, climb: 0.13, lean: 0.055, push: 0.03, weight: 0.9 },
  // Rina: a sharp double tap — quick in, quick out, ready to step
  stinger: { firstShot: 1.15, series: [1, 0.7], twist: 0.08, chest: 0.03, dip: 0.06, nod: 0.025, sway: 0.04, brace: 0, braceAmt: 0, climb: 0.16, lean: 0.06, push: 0.03, weight: 0.7 },
};

export const HIT_REACTION = {
  /** Spring impulse scale for normal hits. */
  light: 1,
  /** Heavy hits trigger a stagger pose for this long. */
  staggerTime: 0.5,
  heavy: 2.4,
};

/**
 * Alpha 1.5: victory routines. Every victory style has three; one is picked at random
 * for each win (never the same one twice in a row for the same fighter). Rivals use
 * the set of their victory style (Dex — Ray's, Tank — Bruno's, Zoe — Nika's; Crash and
 * Victor have their own).
 */
export const VICTORY_SETS = {
  // Ray: jump with a pistol twirl / pumping both blasters to the crowd / a spin into a double point skyward
  hype: ['hype_jump', 'hype_crowd', 'hype_spin'],
  // Bruno: double biceps with a stomp / cannon hoisted overhead and slammed onto the shoulder / chest thumps and a roar
  flex: ['flex_double', 'flex_cannon', 'flex_roar'],
  // Nika: spin and a peace sign / a wave with the rifle on the shoulder / happy hops with arms up
  peace: ['peace_sign', 'peace_wave', 'peace_hop'],
  // Vega: present arms and a crisp nod / carbine on the shoulder, calm look around / a last scan down the sights
  precise: ['precise_present', 'precise_shoulder', 'precise_check'],
  // Kai: revolver spin and a hat-tip / a theatrical bow and a point / blowing the smoke off the barrel
  showman: ['show_twirl', 'show_bow', 'show_smoke'],
  // Rina: a pirouette into a pose / dropping to one knee / a two-finger salute
  graceful: ['grace_pirouette', 'grace_kneel', 'grace_salute'],
  // Crash: fists up and a roar / stomp-stomp-stomp / a "come on" taunt
  brawler: ['brawl_roar', 'brawl_stomp', 'brawl_taunt'],
  // Victor (dignified): the rifle grounded and a measured wave / PRIME BREAKER raised like a trophy / fist over the heart, a bow of the head
  champion: ['champ_salute', 'champ_raise', 'champ_heart'],
} as const satisfies Record<VictoryStyle, readonly string[]>;

export type VictoryMove = (typeof VICTORY_SETS)[VictoryStyle][number];
