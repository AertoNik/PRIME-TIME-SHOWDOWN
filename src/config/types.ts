// Shared type vocabulary for config, simulation, rendering and UI.

export type FighterId = 'ray' | 'bruno' | 'nika';
export type RivalId = 'dex' | 'tank' | 'zoe';
export type CardId =
  | 'dash'
  | 'power_shot'
  | 'shield'
  | 'smoke'
  | 'shock'
  | 'overdrive'
  | 'adrenaline'
  | 'knockout'
  | 'system_overload';
export type ComboId = 'counter_strike' | 'electro_blast' | 'iron_rush' | 'phantom_step' | 'superstar';
export type WeaponType = 'twin_blasters' | 'boom_cannon' | 'tech_carbine';
export type Behavior = 'aggressive' | 'cautious' | 'tactical';
export type Difficulty = 'rookie' | 'pro' | 'champion';
export type PassiveId = 'momentum' | 'iron_skin' | 'overclock';
export type DashStyle = 'roll' | 'lunge' | 'blink';
export type VictoryStyle = 'hype' | 'flex' | 'peace';
export type IdleStyle = 'bouncy' | 'heavy' | 'sway';
/** 0 = player corner (blue), 1 = rival corner (red). */
export type Side = 0 | 1;

export interface AttackStats {
  weapon: WeaponType;
  /** Seconds between auto attacks. */
  interval: number;
  /** Damage per projectile. */
  damage: number;
  /** Projectiles per attack (shotgun pellets). */
  projectiles: number;
  /** Total fan angle for multi-projectile attacks (radians). */
  spread: number;
  /** Random per-shot angular error (radians). */
  inaccuracy: number;
  speed: number;
  range: number;
  radius: number;
  /** Homing turn rate (rad/s). */
  homing: number;
  /** Damage multiplier reached at max range (1 = no falloff). */
  falloff: number;
  slow?: { amount: number; duration: number };
  /** Twin weapons alternate muzzles. */
  alternate?: boolean;
  /** Burst fire: several shots per trigger pull (carbine). */
  burst?: { count: number; gap: number };
}

export interface FighterStats {
  maxHp: number;
  moveSpeed: number;
  /** Flat damage reduction fraction. */
  armor: number;
  attack: AttackStats;
  preferredRange: number;
  /** Natural evasion skill 0..1 (sidestep reflex). */
  evasion: number;
}

export interface StatBars {
  health: number;
  damage: number;
  speed: number;
  range: number;
  control: number;
}

export interface FighterDef {
  id: FighterId;
  name: string;
  nickname: string;
  fullName: string;
  style: string;
  tagline: string;
  bio: string;
  /** Short plain-language pros / cons shown on the roster. */
  strengths: string[];
  weaknesses: string[];
  stats: FighterStats;
  bars: StatBars;
  passive: PassiveId;
  signature: CardId;
  look: string;
  defaultDeck: CardId[];
  startFans: number;
  contract: { cost: number; level: number } | null;
  dashStyle: DashStyle;
  victoryStyle: VictoryStyle;
  idleStyle: IdleStyle;
  /** CSS colours used by the UI theme for this fighter. */
  theme: { main: string; accent: string; dark: string };
}

export interface RivalDef {
  id: RivalId;
  name: string;
  nickname: string;
  fullName: string;
  archetype: FighterId;
  behavior: Behavior;
  look: string;
  deck: CardId[];
  bio: string;
  theme: { main: string; accent: string; dark: string };
}

export interface CardDef {
  id: CardId;
  name: string;
  cost: number;
  role: string;
  short: string;
  desc: string;
  /** CSS gradient colours for the card face. */
  color: string;
  color2: string;
  exclusive?: FighterId;
  /** "Heavy" cards are finishers that combo off setups. */
  heavy?: boolean;
}

export interface ComboDef {
  id: ComboId;
  name: string;
  first: CardId[];
  second: CardId[];
  rating: number;
  desc: string;
  /** Short payoff shown when the combo lands ("×1.5 урона"). */
  bonus: string;
}

export interface PassiveDef {
  id: PassiveId;
  name: string;
  desc: string;
}

export interface DifficultyDef {
  id: Difficulty;
  label: string;
  desc: string;
  hpMult: number;
  dmgMult: number;
  energyMult: number;
  /** Legacy single reaction value (kept for reference/tools). */
  reaction: number;
  /** Human-like reaction delay range to visible threats (seconds). */
  reactMin: number;
  reactMax: number;
  /** Cadence of regular card decisions (seconds). */
  decideMin: number;
  decideMax: number;
  /** How often the AI deliberately sets up its own combos (0..1). */
  comboPlanning: number;
  /** 0..1 how well the AI leads moving targets. */
  aimLead: number;
  /** Extra random aim error (radians). */
  aimError: number;
  /** 0..1 chance-ish to react to threats. */
  dodgeSkill: number;
  /** 0..1 card decision quality. */
  cardSmarts: number;
  telegraphMult: number;
  rewardMult: number;
  unlockLevel: number;
}

export interface BehaviorDef {
  id: Behavior;
  label: string;
  desc: string;
  rangeMult: number;
  strafe: number;
  dodgeMult: number;
  cardEagerness: number;
  retreatHp: number;
  energyReserve: number;
  comboHunter: boolean;
}
