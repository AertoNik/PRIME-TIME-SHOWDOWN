// All tunable numbers for the duel live here, separate from implementation.

export const MATCH = {
  /** Fight length in seconds (spec: 60–90, Alpha default 75). */
  duration: 75,
  /** Pre-fight intro / countdown length. */
  introTime: 3.4,
  /** Post-KO / time-up outro before results. */
  outroTime: 2.8,
  /** Fixed simulation step. */
  fixedStep: 1 / 60,
  maxEnergy: 10,
  /** ~1 energy per 1.25 s. */
  energyPerSecond: 0.8,
  startEnergy: 4,
  handSize: 3,
  deckSize: 4,
  /** Minimum delay between two card plays by the same side. */
  cardLockout: 0.3,
  /** Seconds after a card during which the next card can form a combo. */
  comboWindow: 3.0,
  /** HP fraction difference treated as a draw on time-up. */
  drawEpsilon: 0.005,
  fighterRadius: 0.55,
  spawnZ: 4.4,
};

/** Arena footprint (world units). Fighters move inside the inner rounded rect. */
export const ARENA = {
  halfX: 4.6,
  halfZ: 6.6,
  cornerRadius: 1.6,
  /** Inner face of the barrier walls. */
  wallX: 5.3,
  wallZ: 7.3,
  wallCorner: 2.2,
  /** Height projectiles travel at (visual only). */
  shotHeight: 1.05,
  /** Breakable LED speaker stacks embedded in the barrier. */
  props: [
    { x: -2.5, z: -7.3 },
    { x: 2.5, z: -7.3 },
    { x: -5.3, z: -2.9 },
    { x: 5.3, z: -2.9 },
    { x: -5.3, z: 2.9 },
    { x: 5.3, z: 2.9 },
  ],
  propRespawn: 10,
};

export const CARD_TUNING = {
  /** A perfect dodge (reading the attack) refunds energy. */
  /** perfectRefund: energy back on a read dodge. counter*: the next volley after a dash hits harder. */
  dash: { distance: 3.3, duration: 0.24, invuln: 0.45, perfectRefund: 1, counterWindow: 1.6, counterMult: 1.6 },
  power_shot: {
    windup: 0.26,
    telegraph: 0.9,
    /** Fraction of the telegraph after which the AI locks its aim. */
    lockAt: 0.62,
    damage: 600,
    speed: 20,
    radius: 0.5,
    knockback: 3.2,
    range: 15,
  },
  shield: { duration: 2.8, absorb: 1100 },
  smoke: { duration: 5.2, radius: 2.7, missChance: 0.55, aimError: 0.38, damageCut: 0.3 },
  shock: { damage: 220, stun: 1.0, shieldStun: 0.55 },
  overdrive: { duration: 5.0, fireRate: 1.6, damage: 1.2, speed: 1.22 },
  adrenaline: { duration: 2.2, shots: 12, damage: 80, speed: 1.35 },
  knockout: {
    windup: 0.3,
    telegraph: 0.85,
    lockAt: 0.6,
    rushDistance: 5.6,
    rushSpeed: 17,
    damage: 840,
    knockback: 8,
    stun: 0.55,
    hitRange: 1.45,
    wallSlamDamage: 260,
    wallSlamStun: 0.8,
    missRecover: 0.6,
  },
  // Vega's signature: a charged rail shot. Damage grows with distance travelled
  // (falloff > 1), and it punches through shields.
  /**
   * PRIME PULSE (boss only): the resonator charges, the danger sector is shown, its aim
   * freezes at `lockAt`, then a shockwave hits everything inside the sector. Phase 3 of
   * the boss fight overrides these numbers (boss.config.ts). Answers: SHIELD absorbs it,
   * DASH started after the sector freezes always gets out of the wave, SHOCK interrupts.
   */
  prime_pulse: {
    windup: 0.9,
    telegraph: 1.3,
    lockAt: 0.5,
    range: 7.2,
    /** Half-width of the sector (radians, ~27°). */
    halfAngle: 0.48,
    damage: 900,
    knockback: 3.5,
    stun: 0.3,
    /** The champion holds still after the wave: an opening. */
    recover: 0.75,
    /** Seconds before the next PRIME PULSE. */
    cooldown: 7,
  },
  charged_shot: {
    windup: 0.42,
    telegraph: 0.95,
    lockAt: 0.6,
    damage: 540,
    /** Damage multiplier reached at full range (1.4 = +40% from afar). */
    farMult: 1.4,
    speed: 40,
    radius: 0.28,
    range: 11,
    knockback: 2.2,
    /** Share of the shot that ignores a shield; a shield it hits always breaks. */
    pierce: 0.5,
  },
  system_overload: {
    duration: 2.8,
    damage: 180,
    dot: 75,
    dotInterval: 0.5,
    fireRateMult: 0.5,
    damageTakenMult: 1.2,
    moveMult: 0.75,
    energyDrain: 3,
  },
};

export const COMBO_TUNING = {
  counterStrikeMult: 1.5,
  electroBlastMult: 1.5,
  electroBlastStun: 0.9,
  ironRushDamage: 450,
  ironRushRadius: 3.4,
  ironRushKnockback: 5,
  ironRushDurationMult: 1.5,
  phantomDecoyTime: 2.8,
  superstarMult: 1.4,
};

export const PASSIVE_TUNING = {
  momentum: { duration: 2.2, speed: 1.35, fireRate: 1.25, cooldown: 3.5 },
  iron_skin: { threshold: 330, duration: 3.0, reduction: 0.4, cooldown: 7 },
  overclock: { energy: 1.0, duration: 3.0, regenMult: 1.3 },
  /** Vega: every Nth auto shot is a marksman shot. */
  deadeye: { every: 4, mult: 1.75 },
};

export const BROADCAST = {
  start: 30,
  /** Passive decay per second: a static fight bleeds viewers. */
  decay: 0.75,
  /** Extra decay when the producer sits idle on full energy. */
  idleDecay: 0.9,
  idleTime: 6,
  dmgToRating: 0.0022,
  heavyHit: 4,
  /** Heavy hits closer together than this are 'seen it' moments: half value. */
  heavyFatigue: 6,
  perfectDodge: 7,
  closeCall: 3,
  perfectBlock: 6,
  block: 0.8,
  interrupt: 8,
  smokeMiss: 1.5,
  decoyPop: 4,
  varietyNew: 2.5,
  comeback: 5,
  wallSlam: 5,
  shockHit: 2,
  /** Each ADRENALINE flurry hit is a small crowd-pleaser. */
  flurryHit: 0.5,
  whiffPunish: 4,
  koWin: 10,
  finisherHeavy: 10,
  buzzerBeater: 8,
  dominant: 6,
  koLoss: -12,
  takenHeavy: -2,
  enemyCombo: -3,
  /** A shield that blocked nothing / smoke that caused no miss: the audience shrugs. */
  wasted: -2.5,
  /** Repeating the same card back-to-back earns nothing from variety. */
  thresholds: [
    { value: 50, text: 'THE CROWD GOES WILD!' },
    { value: 75, text: 'PRIME TIME MOMENT!' },
    { value: 90, text: 'LEGENDARY BROADCAST!' },
  ],
  finalWeights: { avg: 0.62, peak: 0.18, end: 0.2 },
  /** Viewer counter shown in HUD (cosmetic, derived from rating & fame). */
  baseViewers: 120000,
};

/** Producer pilot profile: how the player's own fighter moves and aims on its own. */
export const PILOT = {
  aimLead: 0.85,
  aimError: 0.05,
  dodgeSkill: 0.55,
};
