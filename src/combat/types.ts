import type { CardId, ComboId, DashStyle, PassiveId, Side, WeaponType } from '../config/types';

export type MatchPhase = 'intro' | 'fight' | 'outro' | 'over';

export type HitKind = 'auto' | 'power' | 'shock' | 'knockout' | 'overload' | 'dot' | 'slam' | 'adrenaline' | 'burst' | 'pulse';

export type ProjectileKind = 'auto' | 'pellet' | 'bolt' | 'rail' | 'disc' | 'power' | 'adrenaline';

export interface Projectile {
  id: number;
  owner: Side;
  kind: ProjectileKind;
  weapon: WeaponType;
  x: number;
  z: number;
  px: number;
  pz: number;
  vx: number;
  vz: number;
  speed: number;
  radius: number;
  damage: number;
  range: number;
  traveled: number;
  homing: number;
  falloff: number;
  knockback: number;
  stun: number;
  slowAmount: number;
  slowDuration: number;
  heavy: boolean;
  crit: boolean;
  electric: boolean;
  combo: ComboId | null;
  alive: boolean;
  /** Smoke miss already rolled for this projectile. */
  smokeRolled: boolean;
  passThrough: boolean;
  dodgeLogged: boolean;
  /** Closest distance to the target seen so far (near-miss detection). */
  closest: number;
  /** Fighter decided to sidestep this projectile. */
  sidestepped: boolean;
  /** 0..1 share of damage that ignores shields (CHARGED SHOT); shields it hits break. */
  pierce: number;
}

export interface SmokeZone {
  id: number;
  owner: Side;
  misses: number;
  x: number;
  z: number;
  radius: number;
  t: number;
  duration: number;
}

export interface Decoy {
  id: number;
  owner: Side;
  x: number;
  z: number;
  facing: number;
  t: number;
  duration: number;
  alive: boolean;
}

export interface PropState {
  x: number;
  z: number;
  alive: boolean;
  respawn: number;
}

export type MatchEvent =
  | { type: 'phase'; phase: MatchPhase }
  | { type: 'countdown'; n: number }
  | {
      type: 'shot';
      side: Side;
      weapon: WeaponType;
      muzzle: number;
      x: number;
      z: number;
      dx: number;
      dz: number;
      kind: ProjectileKind;
    }
  | {
      type: 'hit';
      side: Side;
      source: Side;
      damage: number;
      x: number;
      z: number;
      dx: number;
      dz: number;
      kind: HitKind;
      heavy: boolean;
      crit: boolean;
      combo: ComboId | null;
      electric: boolean;
    }
  | { type: 'impact'; side: Side; x: number; z: number; kind: 'wall' | 'expire' | 'shield' | 'decoy'; heavy: boolean; weapon: WeaponType }
  | { type: 'card'; side: Side; card: CardId; combo: ComboId | null }
  | { type: 'cardFail'; side: Side; card: CardId; reason: CardFailReason }
  /** BOSS FIGHT: the champion entered phase `phase` (2 or 3). */
  | { type: 'bossPhase'; phase: number }
  /** BOSS FIGHT: STAR POWER at the start of a phase. */
  | { type: 'bossMove'; move: 'star' }
  | { type: 'combo'; side: Side; combo: ComboId }
  | { type: 'dodge'; side: Side; x: number; z: number; perfect: boolean; heavy: boolean }
  | { type: 'miss'; side: Side; x: number; z: number }
  | { type: 'block'; side: Side; x: number; z: number; perfect: boolean; absorbed: number }
  | { type: 'shieldUp'; side: Side }
  | { type: 'shieldBreak'; side: Side; x: number; z: number }
  | { type: 'shieldBurst'; side: Side; x: number; z: number; hit: boolean }
  | { type: 'stun'; side: Side; duration: number }
  | { type: 'interrupt'; side: Side; by: Side }
  | { type: 'telegraph'; side: Side; card: CardId; duration: number; lockAt: number; player: boolean; range?: number; angle?: number }
  /** PRIME PULSE released: the shockwave sector (angle = half-width in radians). */
  | { type: 'pulse'; side: Side; x: number; z: number; dx: number; dz: number; range: number; angle: number; hit: boolean; empowered: boolean }
  | { type: 'aimLock'; side: Side; dx: number; dz: number }
  | { type: 'release'; side: Side; card: CardId }
  | { type: 'dash'; side: Side; fromX: number; fromZ: number; toX: number; toZ: number; style: DashStyle }
  | { type: 'rush'; side: Side; x: number; z: number; dx: number; dz: number }
  | { type: 'whiff'; side: Side; x: number; z: number }
  | { type: 'wallSlam'; side: Side; x: number; z: number; nx: number; nz: number }
  | { type: 'smoke'; side: Side; id: number; x: number; z: number; radius: number; duration: number }
  | { type: 'decoy'; side: Side; id: number; x: number; z: number; duration: number }
  | { type: 'decoyPop'; side: Side; id: number; x: number; z: number; hit: boolean }
  | { type: 'shock'; side: Side; fromX: number; fromZ: number; toX: number; toZ: number; hit: boolean }
  | { type: 'overload'; side: Side; x: number; z: number; hit: boolean }
  | { type: 'buff'; side: Side; buff: 'overdrive' | 'adrenaline'; duration: number }
  | { type: 'passive'; side: Side; passive: PassiveId }
  | { type: 'ko'; side: Side; x: number; z: number; heavy: boolean }
  | { type: 'timeUp' }
  | { type: 'rating'; amount: number; label: string }
  | { type: 'reaction'; text: string; tier: 1 | 2 | 3; sub?: string }
  | { type: 'propBreak'; index: number; x: number; z: number }
  | { type: 'propRespawn'; index: number };

export type CardFailReason = 'energy' | 'stunned' | 'glitched' | 'busy' | 'cooldown' | 'phase';

export interface HitInfo {
  damage: number;
  kind: HitKind;
  heavy: boolean;
  crit: boolean;
  electric: boolean;
  combo: ComboId | null;
  knockback: number;
  stun: number;
  slowAmount: number;
  slowDuration: number;
  dx: number;
  dz: number;
  /** Bypasses smoke miss rolls. */
  sure: boolean;
  projectile: Projectile | null;
  /** Share of damage that goes through a shield (the shield then breaks). */
  pierce?: number;
}

export interface MatchResultData {
  outcome: 'win' | 'loss' | 'draw';
  method: 'ko' | 'time' | 'forfeit';
  rating: number;
  peakRating: number;
  avgRating: number;
  bestCombo: ComboId | null;
  combos: number;
  /** Every combo the player landed, in order. */
  comboList: ComboId[];
  perfects: number;
  damageDealt: number;
  damageTaken: number;
  cardsUsed: number;
  duration: number;
  playerHpFrac: number;
  enemyHpFrac: number;
  finisher: boolean;
  /** BOSS FIGHT: highest phase the champion reached (1..3). */
  bossPhase?: number;
}
