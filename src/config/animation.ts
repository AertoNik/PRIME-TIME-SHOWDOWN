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
  // Alpha 1.9.7 — CRAX: a parade march — measured, even strides, a crisp knee lift, a straight back, a snappy turn.
  clockwork: {
    strideLength: 2.2,
    legSwing: 0.8,
    kneeLift: 1.2,
    bob: 0.034,
    sway: 0.018,
    lean: 0.1,
    accelLean: 0.06,
    turnBank: 0.04,
    armBob: 0.045,
    contactSquash: 0.024,
    turnRate: 20,
  },
  // Alpha 1.7 — Lucien: an elegant glide — long unhurried strides, almost no bob, the chest held high.
  duelist: {
    strideLength: 2.45,
    legSwing: 0.7,
    kneeLift: 1.05,
    bob: 0.028,
    sway: 0.035,
    lean: 0.12,
    accelLean: 0.07,
    turnBank: 0.07,
    armBob: 0.03,
    contactSquash: 0.018,
    turnRate: 16,
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
  // Alpha 1.9.8 — ACE: a headliner's walk onto the stage — easy confident strides, chest open to the camera, a light
  // swing of the free arm, crisp turns towards the target (a duelist's snap, not a brawler's lurch)
  headliner: {
    strideLength: 2.35,
    legSwing: 0.76,
    kneeLift: 1.15,
    bob: 0.04,
    sway: 0.05,
    lean: 0.13,
    accelLean: 0.075,
    turnBank: 0.09,
    armBob: 0.06,
    contactSquash: 0.028,
    turnRate: 18,
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
  // Alpha 1.7 — Lucien's cane: a clean flick of the wrist, the body barely moves
  cane: { kick: 6, stiffness: 430, damping: 22, spine: 0.005, shove: 0.12, slide: 0.03, shake: 0 },
  // Alpha 1.9.8 — ACE's GOLDEN ACE: a duel revolver — a crisp upward snap of the wrist, a quick clean return
  revolver: { kick: 13, stiffness: 400, damping: 19, spine: 0.009, shove: 0.18, slide: 0.05, shake: 0 },
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
  // Lucien: the cane is raised and pointed before each bolt (brace = the point), a small wrist flick, poised
  cane: { firstShot: 1.15, series: [1, 0.85], twist: 0.05, chest: 0.03, dip: 0.03, nod: 0.03, sway: 0.02, brace: 0.24, braceAmt: 0.35, climb: 0.1, lean: 0.04, push: 0.02, weight: 0.8 },
  // Alpha 1.9.8 — ACE: the duelist's draw — the revolver arm locks out, a sharp snap of the wrist, the shoulders square to
  // the target and the chest stays open to the camera; a measured rhythm, never a spray
  revolver: { firstShot: 1.3, series: [1, 0.85, 0.95], twist: 0.07, chest: 0.045, dip: 0.03, nod: 0.04, sway: 0.03, brace: 0.14, braceAmt: 0.35, climb: 0.15, lean: 0.055, push: 0.03, weight: 0.85 },
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
  hype: ['hype_jump', 'hype_crowd', 'hype_spin', 'hype_crossfire'],
  // Bruno: double biceps with a stomp / cannon hoisted overhead and slammed onto the shoulder / chest thumps and a roar
  flex: ['flex_double', 'flex_cannon', 'flex_roar', 'flex_chest'],
  // Nika: spin and a peace sign / a wave with the rifle on the shoulder / happy hops with arms up
  peace: ['peace_sign', 'peace_wave', 'peace_hop'],
  // Vega: present arms and a crisp nod / carbine on the shoulder, calm look around / a last scan down the sights
  precise: ['precise_present', 'precise_shoulder', 'precise_check', 'precise_salute'],
  // Kai: revolver spin and a hat-tip / a theatrical bow and a point / blowing the smoke off the barrel
  showman: ['show_twirl', 'show_bow', 'show_smoke', 'show_holster'],
  // Rina: a pirouette into a pose / dropping to one knee / a two-finger salute
  graceful: ['grace_pirouette', 'grace_kneel', 'grace_salute'],
  // Crash: fists up and a roar / stomp-stomp-stomp / a "come on" taunt
  brawler: ['brawl_roar', 'brawl_stomp', 'brawl_taunt'],
  // Victor (dignified): the rifle grounded and a measured wave / PRIME BREAKER raised like a trophy / fist over the heart, a bow of the head
  champion: ['champ_salute', 'champ_raise', 'champ_heart'],
  // Alpha 1.7 — Lucien: a theatrical bow, the cane planted before him / a cane twirl and a point at the camera / the high collar drawn across the face, then opened
  nightstar: ['night_bow', 'night_twirl', 'night_cape'],
  // Alpha 1.9.7 — CRAX: a heel-click salute to the brim / the key wound twice, then both arms up in a shower of gold gears /
  // «present arms» — the rifle raised upright before the chest, then a bow in three clockwork steps
  clockwork: ['clock_salute', 'clock_wind', 'clock_present'],
  // Alpha 1.9.8 — ACE: the cuff adjusted, then a bow to the camera / GOLDEN ACE spun on the finger and holstered at the hip
  // with a wink / both arms open to the crowd under a golden spotlight (the headliner's curtain call)
  headliner: ['ace_cuff_bow', 'ace_spin_holster', 'ace_curtain_call'],
} as const satisfies Record<VictoryStyle, readonly string[]>;

export type VictoryMove = (typeof VICTORY_SETS)[VictoryStyle][number];

/**
 * Beta 2.3 — a fighter who LOST ON HIS FEET (the time ran out and he had lost more, or any other ending without a
 * knock-out) reacts instead of keeping his fighting stance. Render only: the result is the simulation's, the reaction
 * never changes it. Four moves every fighter can make —
 *   slump   head and shoulders drop, a slow shake of the head;
 *   shrug   the hands open for a moment («how?»), then fall;
 *   exhale  a deep breath out, the weapon lowered;
 *   glance  a look at the winner / the scoreboard, then down
 * — and one of his own by idle style (the first of each set). One is picked at random per defeat, never the same one
 * twice in a row for the same fighter. A draw has its own small, neutral reaction for both fighters.
 */
export const DEFEAT_SETS = {
  // Ray, Dex: scuffs the floor with a toe, the blasters hanging
  bouncy: ['kick', 'slump', 'shrug', 'glance'],
  // Bruno, Tank: a slow, heavy shake of the head, the free fist clenched and dropped
  heavy: ['grumble', 'exhale', 'slump', 'glance'],
  // Nika, Zoe (rival): the head tips aside, a little stamp of the foot
  sway: ['pout', 'slump', 'shrug', 'glance'],
  // Vega: the weapon lowered and a crisp nod of respect
  poise: ['composed', 'exhale', 'glance', 'headshake'],
  // Kai: a theatrical hand to the forehead
  showman: ['facepalm', 'shrug', 'exhale', 'glance'],
  // Rina: turns half away, the free hand on the hip
  feint: ['turnaway', 'exhale', 'glance', 'slump'],
  // Crash, the training bot: an angry stomp, fists down
  brawler: ['stomp', 'shrug', 'slump', 'glance'],
  // Victor: a measured nod, the fist to the chest — he honours the winner
  champion: ['respect', 'exhale', 'glance', 'applaud'],
  // Zoe: checks the weapon, a short shake of the head
  tactician: ['recheck', 'exhale', 'glance', 'slump'],
  // Lucien: a small formal bow of the head, the cane lowered
  duelist: ['bowout', 'exhale', 'glance', 'cloak'],
  // CRAX: the spring runs down — head and arms drop in clockwork steps
  clockwork: ['winddown', 'slump', 'glance', 'jam'],
  // ACE: a wry tilt of the head while he straightens the cuff
  headliner: ['cufffix', 'shrug', 'exhale', 'glance'],
} as const satisfies Record<IdleStyle, readonly string[]>;

export type DefeatMove = (typeof DEFEAT_SETS)[IdleStyle][number] | 'draw';

/** Seconds after the fight ends before the loser on his feet reacts (the winner starts celebrating at 0.2 s). */
export const DEFEAT_DELAY = 0.35;

/**
 * Beta 2.3 (Opus) — LOBBY GESTURES. Each fighter had ONE flourish in the menu, the same every 6–10 s (it read as a loop).
 * Now each victory style has a few small gestures in its character — taken in turn at random, never the same one twice
 * in a row — each easing in from the living idle, holding, and easing back (the first of each set is the 2.2 one).
 */
export const FLAIR_SETS = {
  // Ray: a blaster spin / a look around, the blasters at the ready / a quick blaster pump
  hype: ['spin', 'scan', 'pump', 'crossdraw'],
  // Bruno: the biceps / a neck crack / the shoulders rolled
  flex: ['flex', 'neck', 'shrugroll', 'chestbeat'],
  // Nika, Zoe: the peace sign / a wave to the camera / a look around
  peace: ['peace', 'wave', 'scan', 'bounce'],
  // Vega: a look down the sights / the rifle checked / a look around
  precise: ['sights', 'check', 'scan', 'radio'],
  // Kai, the training bot: the pistol flipped / a finger pointed at the camera / a showman's bow
  showman: ['flip', 'point', 'bow', 'holster'],
  // Rina: a hand through the hair / a stretch of the free arm / a wave
  graceful: ['hair', 'stretch', 'wave', 'releve'],
  // Crash: the knuckles / a jab-jab / a neck crack
  brawler: ['knuckles', 'jab', 'neck', 'beckon'],
  // Victor: the collar / the hand to the chest and a nod / a look over the arena
  champion: ['collar', 'heart', 'scan', 'watch'],
  // Lucien: the cane twirled / the glove pulled tight / a short formal bow
  nightstar: ['twirl', 'glove', 'bow', 'hiss'],
  // CRAX: the salute / the head in clockwork ticks
  clockwork: ['salute', 'tick', 'clockbow'],
  // ACE: the cuff / GOLDEN ACE spun on the finger (as in 1.9.8)
  headliner: ['cuff', 'acespin', 'crowd'],
} as const satisfies Record<VictoryStyle, readonly string[]>;

export type FlairMove = (typeof FLAIR_SETS)[VictoryStyle][number];

/** How long a lobby gesture lasts (s): ease-in, hold, ease-out; 1.6 s unless listed. */
export const FLAIR_TIME: Partial<Record<FlairMove, number>> = { scan: 2.4, wave: 2.0, check: 2.0, bow: 2.0, heart: 2.1, glove: 1.9, neck: 1.8, shrugroll: 1.9, jab: 1.7, stretch: 2.0, tick: 1.9, pump: 1.4, point: 1.7,
  // Beta 2.5: the new gesture of each style
  crossdraw: 1.9, chestbeat: 1.8, bounce: 1.7, radio: 2.2, holster: 1.9, releve: 2.2, beckon: 1.8, watch: 2.2, hiss: 1.8, clockbow: 2.1, crowd: 2.3 };
