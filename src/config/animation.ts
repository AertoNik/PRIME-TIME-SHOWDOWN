// Animation feel parameters (render-side only; never affects the simulation).
import type { IdleStyle, WeaponType } from './types';

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
};

export const HIT_REACTION = {
  /** Spring impulse scale for normal hits. */
  light: 1,
  /** Heavy hits trigger a stagger pose for this long. */
  staggerTime: 0.5,
  heavy: 2.4,
};
