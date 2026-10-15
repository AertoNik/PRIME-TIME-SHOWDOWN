import { CARD_TUNING, PASSIVE_TUNING } from '../config/balance';
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
}
export interface RecoverAction {
  kind: 'recover';
  t: number;
  total: number;
}
export type Action = { kind: 'none' } | WindupAction | DashAction | RushAction | RecoverAction;

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
    if (this.slow > 0) m *= 1 - this.slowAmount;
    if (this.glitch > 0) m *= CARD_TUNING.system_overload.moveMult;
    if (this.action.kind === 'windup') m *= 0.3;
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
