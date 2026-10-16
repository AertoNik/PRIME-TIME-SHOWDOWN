// Shared type vocabulary for config, simulation, rendering and UI.

export type FighterId = 'ray' | 'bruno' | 'nika' | 'vega' | 'kai' | 'rina';
export type RivalId = 'dex' | 'tank' | 'zoe' | 'crash' | 'vale';
export type CardId =
  | 'dash'
  | 'power_shot'
  | 'shield'
  | 'smoke'
  | 'shock'
  | 'overdrive'
  | 'adrenaline'
  | 'knockout'
  | 'system_overload'
  | 'charged_shot'
  /** Alpha 1.5: Kai's ricochet shot (one controlled bounce off the barrier). */
  | 'bank_shot'
  /** Alpha 1.5: Rina's feint (a short read window that evades one attack and fires back). */
  | 'false_start'
  /** Boss only (Alpha 1.3.3): the champion's three-shot DIRECTOR'S CUT. Never in a player deck. */
  | 'directors_cut';
export type ComboId = 'counter_strike' | 'electro_blast' | 'iron_rush' | 'phantom_step' | 'superstar';
export type WeaponType = 'twin_blasters' | 'boom_cannon' | 'tech_carbine' | 'pulse_rifle' | 'breaker' | 'ricochet' | 'stinger';
export type Behavior = 'aggressive' | 'cautious' | 'tactical' | 'reckless';
export type Difficulty = 'rookie' | 'pro' | 'champion';
export type PassiveId = 'momentum' | 'iron_skin' | 'overclock' | 'deadeye' | 'crossfire' | 'riposte';
export type DashStyle = 'roll' | 'lunge' | 'blink' | 'spin' | 'slide';
/** Victory set key (render only): picks which family of victory animations a fighter performs. */
export type VictoryStyle = 'hype' | 'flex' | 'peace' | 'precise' | 'showman' | 'graceful' | 'brawler' | 'champion';
export type IdleStyle = 'bouncy' | 'heavy' | 'sway' | 'poise' | 'showman' | 'feint' | 'brawler' | 'champion' | 'tactician';
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
  /** Personal tweaks on top of the archetype (stats and animation feel). */
  mods?: {
    /** Style line shown on the prep screen (defaults to the archetype's). */
    style?: string;
    /** Weapon / projectile overrides (the boss's PRIME BREAKER). */
    attack?: Partial<AttackStats>;
    hpMult?: number;
    speedMult?: number;
    fireRateMult?: number;
    idleStyle?: IdleStyle;
    victoryStyle?: VictoryStyle;
    dashStyle?: DashStyle;
    /** Alpha 1.5.5: limits on how this rival uses its control cards (SHOCK / SYSTEM OVERLOAD). */
    control?: RivalControl;
  };
}

/**
 * Alpha 1.5.5 — fair control for a rival built around SHOCK / SYSTEM OVERLOAD (Zoe).
 * Rival-only: the player's cards and every other fighter keep the standard rules.
 */
export interface RivalControl {
  /** Seconds after one of its control cards before the AI may play another. */
  gap: number;
  /** Seconds between two of its SYSTEM OVERLOADs (the longest control: no cards at all). */
  overloadGap: number;
  /** No new control while the target is stunned / glitched, nor for this long after it ends. */
  recovery: number;
  /** Multiplier on the chance to answer a charge with a control card. */
  interruptMult: number;
  /** Its SHOCK is a visible charge (s) followed by a dodgeable bolt instead of an instant hit. */
  shockCharge: number;
  shockSpeed: number;
  shockRadius: number;
  /** How much of the target's movement the bolt leads (0 = straight at it, 1 = full lead). */
  shockLead: number;
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
  /**
   * 0..1 relentless pressure: closes distance hard, rarely plants or backs off,
   * uses DASH to get in and spends heavy cards in visible openings.
   */
  pressure: number;
  /**
   * BOSS FIGHT: the champion keeps at least this far from shorter-ranged fighters
   * (his rifle outranges them). Absent for regular rivals.
   */
  holdRange?: number;
}
