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

/** DIRECTOR'S CUT numbers. Arrays hold one value per shot (1st, 2nd, 3rd). */
export interface CutTuning {
  /** Raised-rifle pose and the "DIRECTOR'S CUT!" alert before the first line. */
  prep: number;
  /** Seconds the warning line tracks the target before it freezes. */
  aim: [number, number, number];
  /** Seconds between the freeze and the shot (the time to DASH or raise a SHIELD). */
  lock: [number, number, number];
  /** Pause after a shot before the next line appears. */
  gap: number;
  /** Half-width of the line (world units). A fighter is hit when its centre is within halfWidth + half its body radius. */
  halfWidth: [number, number, number];
  /** Length of the line from the champion. */
  length: [number, number, number];
  damage: [number, number, number];
  knockback: [number, number, number];
  stun: [number, number, number];
  /** Seconds of the target's current motion the line leads by when it freezes (0 = where it stands). */
  lead: number;
  /** The champion stands open after the third shot. */
  recover: number;
  /** Seconds before the next DIRECTOR'S CUT. */
  cooldown: number;
}

/** Phase 2 DIRECTOR'S CUT (the base card numbers; Alpha 1.3.4: +20% damage, cooldown 9 → 7 s). */
const CUT_P2: CutTuning = {
  prep: 0.55,
  aim: [0.7, 0.55, 0.7],
  lock: [0.62, 0.6, 0.66],
  gap: 0.32,
  halfWidth: [0.55, 0.55, 0.78],
  length: [11, 11, 12],
  damage: [1008, 1008, 1656],
  knockback: [1, 1, 4.5],
  stun: [0, 0, 0.3],
  lead: 0.3,
  recover: 1.0,
  cooldown: 7,
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
  /**
   * DIRECTOR'S CUT (boss only, Alpha 1.3.3): PRIME BREAKER fires three heavy shots, each
   * along its own warning line. Per shot: the line tracks the target for `aim[i]` s, freezes
   * (lock) and the shot fires `lock[i]` s later along exactly that line — the hit test is the
   * drawn rectangle (`halfWidth[i]`, `length[i]`) at the moment of the shot, nothing else.
   * Each shot hits at most once. Phase 3 of the boss fight overrides these numbers
   * (boss.config.ts). Answers: DASH after the lock (leaves the line, i-frames), SHIELD
   * absorbs, SHOCK / heavy knockback interrupts the sequence.
   */
  directors_cut: CUT_P2,
  // Vega's signature: a charged rail shot. Damage grows with distance travelled
  // (falloff > 1), and it punches through shields.
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
  /**
   * Alpha 1.5 — Kai's BANK SHOT: a copper ricochet round aimed so that ONE bounce off a
   * straight barrier wall carries it into where the target is heading. It is a real
   * projectile (dodge / shield / smoke rules as usual): a hit before the bounce deals
   * only `directMult` of the damage; a hit after the bounce is a TRICK SHOT (full damage,
   * crit) and gives Kai `energyRefund` back. It bounces once, then dies at the next wall.
   */
  bank_shot: {
    windup: 0.3,
    telegraph: 0.95,
    lockAt: 0.6,
    damage: 560,
    directMult: 0.45,
    speed: 22,
    radius: 0.32,
    range: 24,
    knockback: 1.6,
    energyRefund: 2,
    /** Keep the bounce point this far from the corners of the straight walls. */
    wallMargin: 0.35,
  },
  /**
   * Alpha 1.5 — Rina's FALSE START: a short feint step (`distance` in `duration`, no
   * invulnerability) that opens a `window`. The first suitable attack (shots, POWER /
   * CHARGED / BANK SHOT, KNOCKOUT charge, DIRECTOR'S CUT shot) landing inside the window
   * misses her and she fires a counter shot back; `invulnAfter` covers the rest of that
   * volley (shotgun pellets). SHOCK, SYSTEM OVERLOAD, poison ticks and wall slams are not
   * evaded. One evade per card; an unused window simply runs out.
   */
  false_start: {
    duration: 0.22,
    distance: 0.95,
    window: 0.7,
    invulnAfter: 0.15,
    counterDamage: 420,
    counterSpeed: 30,
    counterRadius: 0.3,
    counterRange: 12,
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

  // ------------------------------------------------- Alpha 1.6 — CARD REVOLUTION
  // Numbers are sized against the real economy of a fight: ~0.8 energy/s, auto fire
  // 120–165 DPS, 13 600–16 800 HP, POWER SHOT = 600 for 4 energy (150 per energy point).
  // Every card has a visible tell and an answer; nothing stuns, nothing stacks forever.
  // Checked with `npm run cards` and `npm run decks` (Alpha 1.6 report).

  /**
   * SPOTLIGHT TAG: a small studio spotlight marks the opponent for `duration` s. The next
   * card hit from the tagger (POWER / CHARGED / BANK SHOT, KNOCKOUT, REBOUND DISC, PROP
   * DROP, SIDE CAM) deals `mult` — never on top of a combo multiplier (the larger one
   * counts). One hit, no stacking; the opponent's own SMOKE hides them and clears it.
   */
  spotlight_tag: { duration: 6, mult: 1.25 },
  /**
   * SPLIT SHOT: fires one volley of three energy bolts in a fan instead of the regular
   * one (the weapon's own burst / pellets are not multiplied). Strong point blank,
   * weak from afar (`falloff` = damage share at full range).
   */
  split_shot: { bolts: 3, fan: 0.5, damage: 165, speed: 21, radius: 0.22, range: 8.5, falloff: 0.55 },
  /**
   * REBOUND DISC: a spinning disc flies straight out to `reach` m (or a wall), then
   * returns to the thrower. It can hit once on the way out and once on the way back;
   * it never steers towards the target. Gone after `maxTime` s or when caught.
   */
  rebound_disc: { damage: 230, speed: 13, radius: 0.4, reach: 6.5, minReach: 3, maxTime: 2.6, catchRadius: 0.85, turnRate: 9 },
  /**
   * PROP DROP: the crew drops a foam set piece. A warning circle `radius` m where the
   * opponent is heading (`lead` s), the prop lands `delay` s later. No stun.
   */
  prop_drop: { delay: 1.0, radius: 1.4, lead: 0.45, damage: 540, knockback: 1.8, linger: 0.8 },
  /**
   * PULSE PUSH: a short wave in front of the fighter shoves an opponent within `range` m
   * (`force` m/s, decaying at `decay`/s: ~2.4 m) and throws their aim off: the next regular
   * shot comes `aimDelay` s later. No damage, no stun, no wall slam, cards are not touched.
   * Heavy fighters slide less, the champion much less and never during DIRECTOR'S CUT.
   */
  pulse_push: { range: 3.4, force: 12, decay: 5, heavyMult: 0.65, bossMult: 0.45, aimDelay: 0.4 },
  /**
   * GRAVITY NET: a thrown generator opens a slowing field (`slow` = speed factor) for
   * `duration` s where the opponent stands. One per side; never stacks with other slows.
   */
  gravity_net: { flight: 0.35, lead: 0.35, radius: 1.8, duration: 3.6, slow: 0.55, bossSlow: 0.8 },
  /**
   * PRESSURE MINE: thrown in an arc (`flight` s) to where the opponent is heading but never
   * closer than `minGap` m to them; arms after `arm` s, then waits `life` s. Fires once
   * when the opponent steps within `trigger` m. At most `max` per side.
   */
  pressure_mine: { flight: 0.5, lead: 0.8, minGap: 1.6, arm: 0.7, life: 9, trigger: 1.05, damage: 420, shove: 6, max: 2 },
  /**
   * STAGE BARRIER: a 2×`halfLen` m screen across the line to the opponent. Stops projectiles
   * of BOTH sides until `hp` damage or `duration` s. CHARGED SHOT goes through, DIRECTOR'S CUT
   * ignores it. Projectiles only: nobody bumps into it, so nobody can get stuck on it.
   * Alpha 1.6.1 placement: between the fighters at `share` of the distance (`minAhead`..`ahead`
   * m from the owner), never closer than `clear` m to either body. Too close for a screen in
   * between: it rises `behind` m behind the owner as cover to step back to (never inside or
   * behind the opponent, nobody is moved).
   */
  stage_barrier: { ahead: 1.6, minAhead: 0.8, share: 0.45, clear: 0.8, behind: 1.1, halfLen: 1.35, duration: 5, hp: 1100, thickness: 0.15 },
  /**
   * CABLE SNARE: a fast cable shot. On a hit the opponent stays within `tether` m of the
   * spot for `duration` s (still moves inside, shoots and plays cards). DASH, FALSE START,
   * BACKTRACK or a knockback snap it. Then `immunity` s before it can catch again.
   */
  cable_snare: { speed: 24, radius: 0.3, range: 9, damage: 60, duration: 2.4, tether: 1.7, bossDuration: 1.2, bossTether: 2.4, immunity: 1.5 },
  /**
   * HOLO DECOY: a glitching hologram `offset` m to the side. The opponent's regular fire
   * goes at it; after the first hit it keeps drawing fire for `soak` s (Alpha 1.6.1: about a
   * second instead of one volley), then pops. Charged attacks, shocks and traps are aimed at
   * the real fighter.
   */
  holo_decoy: { offset: 1.8, duration: 3, soak: 1.0 },
  /**
   * FRAME CATCH — a parry: an energy frame `ahead` m in front for `duration` s. The first enemy
   * projectile that crosses it is destroyed and the frame stays open `window` s more for the
   * rest of that volley (pellets, bursts; at most `maxCatch` shots), then closes. A parried
   * POWER / BANK SHOT gives `refund` energy back (once per card). The parry counts as an evade
   * for the fighter's passive (MOMENTUM, RIPOSTE), once per card. CHARGED SHOT, DIRECTOR'S CUT,
   * KNOCKOUT, traps and shocks are not projectiles it can catch. Remembers the catch `memory` s.
   */
  frame_catch: { duration: 1.5, ahead: 0.9, halfWidth: 0.95, window: 0.35, maxCatch: 6, refund: 1, memory: 3 },
  /**
   * Holds are never endless: GRAVITY NET slows and CABLE SNARE tethers add up; after `holdMax` s
   * of them in a row the fighter breaks free and ignores both for `immune` s. Free time cools the
   * count down (`cool` per second). A pure control deck cannot keep a rival slowed for good.
   */
  hold: { holdMax: 3.2, immune: 4, cool: 0.6 },
  /** BACKTRACK: back to where the fighter stood `lookback` s ago, in `duration` s (no invulnerability). */
  backtrack: { lookback: 1.4, duration: 0.3, sample: 0.1, keep: 2 },
  /**
   * HIGH STAKES: `hpCost` of max HP for `energy` energy. Not below `minHp` HP after the
   * cost; `cooldown` s between uses and `uses` per fight (each Survival wave is a fight,
   * but the HP it costs stays spent).
   */
  high_stakes: { hpCost: 0.02, energy: 4, minHp: 0.3, cooldown: 15, uses: 3 },
  /**
   * Alpha 1.6.1 — SECOND TAKE (replaces SIDE CAM): the fighter's last card attack of the
   * last `window` s (POWER SHOT, BANK SHOT, REBOUND DISC, SPLIT SHOT) is played again as an
   * energy echo from the spot where it was first played: a ghost raises the weapon (`aim` s,
   * tracking), freezes its line (`lock` s of warning) and fires. The echo deals `mult` of the
   * card's base damage, at most `cap` in total, with no combo bonus, no SPOTLIGHT TAG, no
   * TRICK SHOT refund; an echo is never recorded, so it cannot be repeated. One per attack.
   */
  second_take: { window: 8, aim: 0.35, lock: 0.25, retract: 0.45, mult: 0.5, cap: 300, lead: 0.6 },
  /**
   * FREEZE FRAME (Alpha 1.6.1): a time-distortion ring `radius` m around the fighter that MOVES
   * with them for `duration` s. Only the opponent's regular projectiles heading in (towards
   * the fighter) crawl at `speed` of their speed; the fighter's own shots are untouched. Heavy
   * card shots (POWER / CHARGED / BANK SHOT) and the champion's shots keep their speed. A slowed
   * shot is easier to read: it is sidestepped `dodgeMult`× as often. Nothing is absorbed.
   */
  freeze_frame: { radius: 2.3, duration: 4, speed: 0.3, dodgeMult: 2 },
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
  // Alpha 1.6 — tactical combos (only JACKPOT multiplies damage, and never on top of another bonus)
  /** SPOTLIGHT: the follow-up leads the marked target fully (no aim error); it can still be dodged. */
  spotlightLead: 1,
  /** TIGHT SPREAD: the fan narrows (radians), so two or three bolts can land. */
  tightFan: 0.26,
  /** BOOMERANG: the disc turns `boomerangPast` m behind the held target instead of at full reach. */
  boomerangPast: 1.0,
  /** SET PIECE: the prop drops right on the held target with a wider circle. */
  setPieceRadius: 1.5,
  /** GRAVITY TRAP: the mine lands inside the net, closer to the target, and arms faster. */
  trapGap: 1.1,
  trapArm: 0.4,
  /** MINE DRIVE: the push bends up to this angle towards your mine and is a little stronger. */
  mineDriveAngle: 0.6,
  mineDriveForce: 1.15,
  /** WALL PUSH: the wave leaves from the barrier (reaches further) and is stronger. */
  wallPushForce: 1.25,
  /** CAMERA LOCK (Alpha 1.6.1: NET / SNARE → SECOND TAKE): the echo leads the held target fully. */
  cameraLockLead: 1,
  /** CATCH & RELEASE: the caught shot is fired back after the DASH (share of its damage, capped). */
  releaseShare: 0.5,
  releaseCap: 220,
  releaseSpeed: 26,
  /** SAFE BET: HIGH STAKES costs this share of its HP price. */
  safeBetCost: 0.5,
  /** ALL IN: OVERDRIVE lasts this much longer. */
  allInTime: 1.5,
  /** INSURANCE: the shield absorbs this much more. */
  insuranceAbsorb: 300,
  /** JACKPOT (HIGH STAKES → SHIELD → POWER SHOT): damage multiplier. */
  jackpotMult: 1.3,
  /** DOUBLE TAKE: the afterimage left at the end of the DASH lasts this long. */
  doubleTakeTime: 1.6,
  /** TIME SLIP: DASH distance multiplier; Alpha 1.6.1: the slow-motion ring also lasts longer. */
  timeSlipDist: 1.3,
  timeSlipExtend: 1.5,
};

export const PASSIVE_TUNING = {
  momentum: { duration: 2.2, speed: 1.35, fireRate: 1.25, cooldown: 3.5 },
  iron_skin: { threshold: 330, duration: 3.0, reduction: 0.4, cooldown: 7 },
  overclock: { energy: 1.0, duration: 3.0, regenMult: 1.3 },
  /** Vega: every Nth auto shot is a marksman shot. */
  deadeye: { every: 4, mult: 1.75 },
  /** Alpha 1.5 — Kai: shots fired while moving sideways (relative to the aim) hit harder. */
  crossfire: { lateral: 0.55, mult: 1.15 },
  /** Alpha 1.5 — Rina: after any successful evade her next volley hits harder (once per cooldown). */
  riposte: { mult: 1.5, cooldown: 3 },
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
  /** Alpha 1.5: a BANK SHOT landing after its ricochet / a FALSE START reading an attack. */
  trickShot: 5,
  feintRead: 6,
  /** Alpha 1.6: the same tactical combo again within this many seconds is worth half the show rating. */
  comboRepeat: 15,
  /** Alpha 1.6: SPOTLIGHT TAG paid off / FRAME CATCH stopped a shot / a cable held / a push landed / HIGH STAKES. */
  spotlight: 4,
  frameCatch: 4,
  tether: 2,
  push: 1.5,
  stakes: 2.5,
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
