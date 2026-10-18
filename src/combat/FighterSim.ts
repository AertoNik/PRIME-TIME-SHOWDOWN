import { CARD_TUNING, PASSIVE_TUNING, type CutTuning } from '../config/balance';
import type { CardId, ComboId, DashStyle, FighterDef, FighterStats, Side } from '../config/types';

export interface WindupAction {
  kind: 'windup';
  card: CardId;
  t: number;
  total: number;
  lockAt: number;
  locked: boolean;
  dirX: number;
  dirZ: number;
  combo: ComboId | null;
  telegraph: boolean;
  /** Match time when the aim froze (telegraphed windups). */
  lockedAt?: number;
}
export interface DashAction {
  kind: 'dash';
  t: number;
  total: number;
  dirX: number;
  dirZ: number;
  speed: number;
  style: DashStyle;
}
export interface RushAction {
  kind: 'rush';
  t: number;
  total: number;
  dirX: number;
  dirZ: number;
  speed: number;
  combo: ComboId | null;
  dodged: boolean;
  /** Alpha 1.5: the target read this charge with FALSE START — it cannot land any more. */
  feinted?: boolean;
}
/** Alpha 1.5 — FALSE START: a short feint step (no invulnerability; the read window is `feint`). */
export interface FeintAction {
  kind: 'feint';
  t: number;
  total: number;
  dirX: number;
  dirZ: number;
  speed: number;
}
export interface RecoverAction {
  kind: 'recover';
  t: number;
  total: number;
}
/** Alpha 1.6 — BACKTRACK: a straight glide back to an earlier position (no invulnerability). */
export interface RewindAction {
  kind: 'rewind';
  t: number;
  total: number;
  dirX: number;
  dirZ: number;
  speed: number;
}
/**
 * DIRECTOR'S CUT (boss): prep pose, then for each of the three shots a tracking line
 * ('aim'), a frozen line ('lock') and a short pause after the shot ('gap').
 */
export interface CutAction {
  kind: 'cut';
  stage: 'prep' | 'aim' | 'lock' | 'gap';
  /** Current shot, 0..2. */
  shot: number;
  /** Time in the current stage and its length. */
  t: number;
  total: number;
  /** Line direction: follows the target during 'aim', frozen from 'lock' on. */
  dirX: number;
  dirZ: number;
  /** Match time when the current line froze. */
  lockedAt: number;
  /** The target stood in the frozen line at the lock (a DASH out of it is a read). */
  inLaneAtLock: boolean;
  /** Numbers for this cast (the boss's current phase). */
  tune: CutTuning;
  empowered: boolean;
}
/**
 * Alpha 1.7 — LUCIEN's BAT BITE after its coil: the swarm lunge ('rush', steering a little toward
 * the target) and, once the bite landed, a light leap back out of reach ('leap', no attacks).
 */
export interface BiteAction {
  kind: 'bite';
  stage: 'rush' | 'leap';
  t: number;
  total: number;
  dirX: number;
  dirZ: number;
  speed: number;
  combo: ComboId | null;
  /** The target's DASH i-frames let the lunge pass (it rushes on and misses). */
  dodged: boolean;
  /** FALSE START read the lunge: it cannot land any more. */
  feinted: boolean;
}
export type Action = { kind: 'none' } | WindupAction | DashAction | RushAction | RecoverAction | CutAction | FeintAction | RewindAction | BiteAction;

export interface FighterMatchStats {
  damageDealt: number;
  damageTaken: number;
  hits: number;
  shots: number;
  perfects: number;
  combos: number;
  cardsUsed: number;
  bestCombo: ComboId | null;
  bestComboValue: number;
}

/** Alpha 1.6.1 — the last replayable card attack: what it was, where and when it was played. */
export interface TakeRecord {
  card: CardId;
  x: number;
  z: number;
  time: number;
}

/** Pure simulation state for one fighter. No rendering here. */
export class FighterSim {
  readonly side: Side;
  readonly def: FighterDef;
  readonly stats: FighterStats;
  readonly name: string;
  readonly look: string;
  readonly dmgMult: number;

  x = 0;
  z = 0;
  px = 0;
  pz = 0;
  vx = 0;
  vz = 0;
  facing = 0;
  radius: number;

  hp: number;
  maxHp: number;
  /** HP at the start of the fight (below max when Survival carries damage over). */
  startHp: number;
  ko = false;
  victory = false;

  // AI intent
  intentX = 0;
  intentZ = 0;
  intentSpeed = 0;
  aimX = 0;
  aimZ = 0;
  aimErr = 0;
  wantFire = false;

  fireTimer = 0.6;
  muzzleToggle = 0;
  burstLeft = 0;
  burstTimer = 0;
  /** Empowered "counter" volleys left after a DASH, and their expiry timer. */
  counterShots = 0;
  counterT = 0;
  burstCounter = false;
  /** DEADEYE passive: auto shots fired so far (every Nth is a marksman shot). */
  shotCount = 0;
  /** Seconds until DIRECTOR'S CUT can be used again (boss only). */
  cutCd = 0;
  /** Alpha 1.5 — FALSE START: seconds left in the read window, and its SUPERSTAR boost. */
  feint = 0;
  feintMult = 1;
  /** Alpha 1.5.5 — Zoe's SHOCK: seconds left of the visible charge before the bolt, and its combo. */
  zap = 0;
  zapCombo: ComboId | null = null;
  /** Alpha 1.5.5: match time this fighter was last stunned or glitched (control recovery window). */
  ctrlEnd = -99;
  /** Alpha 1.5 — RIPOSTE (Rina): an empowered volley is ready / cooldown. */
  riposte = false;
  riposteCd = 0;
  burstRiposte = false;
  /** What this fighter's brain currently sees of the opponent (decoys and smoke included). */
  seenX = 0;
  seenZ = 0;
  seenVX = 0;
  seenVZ = 0;
  action: Action = { kind: 'none' };

  // status timers
  stun = 0;
  shield = 0;
  shieldHp = 0;
  shieldAbsorbed = 0;
  overdrive = 0;
  adrenaline = 0;
  adrenalineShots = 0;
  adrenalineTimer = 0;
  adrenalineMult = 1;
  glitch = 0;
  glitchDot = 0;
  slow = 0;
  slowAmount = 0;
  momentum = 0;
  momentumCd = 0;
  ironSkin = 0;
  ironSkinCd = 0;
  overclock = 0;
  invuln = 0;
  knockback = 0;
  kbX = 0;
  kbZ = 0;
  lastDash = -99;
  /** The last dash was a reaction to a telegraphed attack (enables "read" perfect dodges). */
  readDash = false;
  lastHit = -99;
  /** Time (match clock) the last heavy hit landed on this fighter. */
  lastHeavyTaken = -99;

  // ------------------------------------------------ Alpha 1.6 — CARD REVOLUTION
  /** Where this fighter's brain aims cards and charged attacks (HOLO DECOY only fools regular fire). */
  cardAimX = 0;
  cardAimZ = 0;
  /** How much of the target's motion this brain leads (AI profile aimLead). */
  leadK = 0.85;
  /** SPOTLIGHT TAG on this fighter: seconds left and who marked it. */
  tag = 0;
  tagBy: Side = 0;
  /** PULSE PUSH / mine blast: a sliding push on top of the fighter's own movement (not a knockback). */
  shoveX = 0;
  shoveZ = 0;
  /** GRAVITY NET: speed factor this step (1 = free). */
  netSlow = 1;
  /** CABLE SNARE: seconds held, anchor, radius; `tetherCd` = no new tether yet. */
  tether = 0;
  tetherX = 0;
  tetherZ = 0;
  tetherR = 0;
  tetherCd = 0;
  /** Seconds held by nets / cables lately, and the break-free immunity that follows (no endless holds). */
  holdHeat = 0;
  holdImmune = 0;
  /** FRAME CATCH: seconds the frame stays up; a catch is remembered `caught` s (CATCH & RELEASE, SAFE BET). */
  frame = 0;
  caught = 0;
  caughtDmg = 0;
  /** CATCH & RELEASE: fire the caught shot back when the DASH ends. */
  releaseDmg = 0;
  /** Alpha 1.6.1 FRAME CATCH parry: shots caught by this frame, energy refunded / passive fired (once per card). */
  parryHits = 0;
  parryRefunded = false;
  parryEvaded = false;
  /** Alpha 1.6.1 SECOND TAKE: the last card attack that can be replayed (null after it was replayed). */
  take: TakeRecord | null = null;
  /** HIGH STAKES: cooldown and uses this fight. */
  stakesCd = 0;
  stakesUses = 0;
  /** BACKTRACK: positions sampled every CARD_TUNING.backtrack.sample s (ring buffer). */
  readonly hist: number[] = [];
  histT = 0;

  // ------------------------------------------------ Alpha 1.7 — BLOOD MOON PREMIERE
  /** Dual-mode weapon (Lucien's cane): striking up close instead of shooting, and since when (match time). */
  caneStrike = false;
  caneSince = -99;
  /** What a melee swing goes at: the body this fighter's brain sees (or a HOLO DECOY), no lead. */
  meleeX = 0;
  meleeZ = 0;
  /** A cane strike on its way to the contact (seconds left; 0 = none), its variant and DASH counter boost. */
  strikeT = 0;
  strikeVar = 0;
  strikeCrit = false;
  strikeN = 0;
  /** BAT BITE bleed on this fighter: ticks left, seconds to the next tick, damage per tick, who bit. */
  bleedTicks = 0;
  bleedT = 0;
  bleedDmg = 0;
  bleedBy: Side = 0;

  readonly m: FighterMatchStats = {
    damageDealt: 0,
    damageTaken: 0,
    hits: 0,
    shots: 0,
    perfects: 0,
    combos: 0,
    cardsUsed: 0,
    bestCombo: null,
    bestComboValue: 0,
  };

  constructor(side: Side, def: FighterDef, name: string, look: string, hpMult: number, dmgMult: number, radius: number) {
    this.side = side;
    this.def = def;
    this.stats = def.stats;
    this.name = name;
    this.look = look;
    this.maxHp = Math.round(def.stats.maxHp * hpMult);
    this.hp = this.maxHp;
    this.startHp = this.hp;
    this.dmgMult = dmgMult;
    this.radius = radius;
  }

  get hpFrac(): number {
    return this.hp / this.maxHp;
  }

  get busy(): boolean {
    return this.action.kind !== 'none';
  }

  get canAct(): boolean {
    return !this.ko && this.stun <= 0 && this.knockback <= 0;
  }

  speedMult(): number {
    let m = 1;
    if (this.overdrive > 0) m *= CARD_TUNING.overdrive.speed;
    if (this.momentum > 0) m *= PASSIVE_TUNING.momentum.speed;
    if (this.adrenaline > 0) m *= CARD_TUNING.adrenaline.speed;
    // slows never stack: the strongest one counts (weapon slow, Alpha 1.6 GRAVITY NET)
    let slowF = this.slow > 0 ? 1 - this.slowAmount : 1;
    if (this.netSlow < slowF) slowF = this.netSlow;
    m *= slowF;
    if (this.glitch > 0) m *= CARD_TUNING.system_overload.moveMult;
    if (this.action.kind === 'windup') m *= 0.3;
    // DIRECTOR'S CUT: planted while a line is frozen, a slow step otherwise
    else if (this.action.kind === 'cut') m *= this.action.stage === 'lock' ? 0 : 0.18;
    return m;
  }

  fireRateMult(): number {
    let m = 1;
    if (this.overdrive > 0) m *= CARD_TUNING.overdrive.fireRate;
    if (this.momentum > 0) m *= PASSIVE_TUNING.momentum.fireRate;
    if (this.glitch > 0) m *= CARD_TUNING.system_overload.fireRateMult;
    return m;
  }

  outgoingDamageMult(): number {
    let m = this.dmgMult;
    if (this.overdrive > 0) m *= CARD_TUNING.overdrive.damage;
    return m;
  }

  storePrev(): void {
    this.px = this.x;
    this.pz = this.z;
  }

  place(x: number, z: number, facing: number): void {
    this.x = this.px = x;
    this.z = this.pz = z;
    this.vx = this.vz = 0;
    this.facing = facing;
  }
}
