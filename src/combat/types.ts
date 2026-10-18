import type { PropKind } from '../config/arenas.config';
import type { CardId, ComboId, DashStyle, PassiveId, Side, WeaponType } from '../config/types';

export type MatchPhase = 'intro' | 'fight' | 'outro' | 'over';

export type HitKind =
  | 'auto'
  | 'power'
  | 'shock'
  | 'knockout'
  | 'overload'
  | 'dot'
  | 'slam'
  | 'adrenaline'
  | 'burst'
  | 'cut'
  | 'bank'
  | 'counter'
  // Alpha 1.6
  | 'split'
  | 'disc'
  | 'prop'
  | 'mine'
  | 'cable'
  | 'release'
  // Alpha 1.7 — LUCIEN: a cane strike, the BAT BITE and its bleed ticks
  | 'cane'
  | 'bite'
  | 'bleed';

export type ProjectileKind =
  | 'auto'
  | 'pellet'
  | 'bolt'
  | 'rail'
  | 'slug'
  | 'power'
  | 'adrenaline'
  | 'bank'
  | 'counter'
  | 'zap'
  // Alpha 1.6: SPLIT SHOT bolts, REBOUND DISC, CABLE SNARE, CATCH & RELEASE shot
  | 'split'
  | 'disc'
  | 'cable'
  | 'release';

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
  /** Alpha 1.5 (BANK SHOT): reflections left off the barrier (0 = dies at the wall as usual). */
  bounces: number;
  /** Has already bounced once (a hit now is a TRICK SHOT). */
  bounced: boolean;
  /** Alpha 1.6: combo damage multiplier already in `damage` (SPOTLIGHT TAG never stacks on it). */
  boost: number;
  /** Alpha 1.6 (BLINDSIDE): the target's fighter does not see it coming (no automatic sidestep). */
  blind: boolean;
  /** Alpha 1.6 (CROSS ANGLE): flies through its owner's own STAGE BARRIER. */
  ownPass: boolean;
  /** Alpha 1.6.1 SECOND TAKE: an echo of an earlier card attack (no tag, no refunds, never recorded again). */
  echo: boolean;
  /** Alpha 1.6 — REBOUND DISC: on its way back; hits landed (bit 0 out, bit 1 back); seconds in flight. */
  ret: boolean;
  mask: number;
  life: number;
  /**
   * Alpha 1.7.5 (GRAVEYARD covers): where the shot really starts for the cover test of its
   * first step — the shooter's body, so a muzzle poking past a tombstone still hits it.
   */
  ox: number;
  oz: number;
  first: boolean;
  /** Covers a piercing CHARGED SHOT already went through (bit per cover). */
  coverMask: number;
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
  /**
   * 'phantom' (SMOKE → DASH, DASH → BACKTRACK): draws every attack aimed by sight.
   * 'holo' (Alpha 1.6 HOLO DECOY): draws regular fire only and pops after soaking one volley.
   */
  kind: 'phantom' | 'holo';
  /** HOLO DECOY: seconds left before it pops after its first hit (-1 = not hit yet). */
  soak: number;
}

/** Alpha 1.6: temporary set pieces the new cards put on the stage (all removed by the end of the fight). */
export type StageKind = 'net' | 'mine' | 'barrier' | 'prop' | 'echo' | 'freeze';

export interface StageObject {
  id: number;
  kind: StageKind;
  owner: Side;
  /** Where it is (net / mine: landing point; cam: on the barrier; barrier: centre). */
  x: number;
  z: number;
  /** Throw origin (net and mine fly in an arc from here). */
  fromX: number;
  fromZ: number;
  /** Barrier: along the screen. Cam: line of fire. */
  dirX: number;
  dirZ: number;
  /** Zone / trigger radius, the barrier's half length. */
  radius: number;
  /** Seconds in the current stage and its length. */
  t: number;
  total: number;
  /**
   * Per kind: net 'fly' → 'on'; mine 'fly' → 'arming' → 'armed'; barrier 'on';
   * prop 'warn' → 'landed'; echo (SECOND TAKE) 'aim' → 'lock' → 'retract'; freeze 'on'. 'gone' = being removed.
   */
  stage: 'fly' | 'on' | 'arming' | 'armed' | 'warn' | 'landed' | 'aim' | 'lock' | 'retract' | 'gone';
  /** Barrier hit points (others: unused). */
  hp: number;
  maxHp: number;
  /** Combo flags (echo: CROSS ANGLE / BLINDSIDE / CAMERA LOCK). */
  combo: ComboId | null;
  /** Visual variant (prop drop: which set piece; echo: which attack it replays, see TAKE_CARDS). */
  variant: number;
}

/** A set piece on the barrier (Alpha 1.4: per stage, see src/config/arenas.config.ts). Visual only. */
export interface PropState {
  kind: PropKind;
  x: number;
  z: number;
  alive: boolean;
  /** Seconds until it is rebuilt (Infinity = stays broken until the next fight). */
  respawn: number;
  hp: number;
  maxHp: number;
  /** Rebuild delay after breaking (0 = never during this fight). */
  respawnTime: number;
  radius: number | null;
  /** Reactive pieces never break; they react to each hit once `cool` has run out. */
  reactive: boolean;
  cooldown: number;
  cool: number;
  /** Hits taken so far (reactive pieces show wear). */
  hits: number;
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
      /** Alpha 1.6.1: the hit came from a SECOND TAKE echo. */
      echo?: boolean;
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
  | { type: 'telegraph'; side: Side; card: CardId; duration: number; lockAt: number; player: boolean }
  /** DIRECTOR'S CUT: raised-rifle pose and alert (`prep` seconds before the first line). */
  | { type: 'cutStart'; side: Side; prep: number; empowered: boolean }
  /** DIRECTOR'S CUT: a new warning line appears for shot `shot` (0..2) and tracks the target. */
  | { type: 'cutAim'; side: Side; shot: number; aim: number; lock: number; halfWidth: number; length: number; empowered: boolean }
  /** DIRECTOR'S CUT: the line froze; the shot follows `lock` seconds later along (dx, dz). */
  | { type: 'cutLock'; side: Side; shot: number; dx: number; dz: number; lock: number; empowered: boolean }
  /** DIRECTOR'S CUT: shot fired along the frozen line from (x, z) to (ex, ez). */
  | {
      type: 'cutShot';
      side: Side;
      shot: number;
      x: number;
      z: number;
      ex: number;
      ez: number;
      dx: number;
      dz: number;
      halfWidth: number;
      /** 'hit' | 'blocked' (shield) | 'dodged' (DASH i-frames / left the line) | 'miss' | 'decoy'. */
      outcome: 'hit' | 'blocked' | 'dodged' | 'miss' | 'decoy';
      final: boolean;
      empowered: boolean;
    }
  /** DIRECTOR'S CUT ended: all three shots fired, or called off (interrupt, phase change, KO, match end). */
  | { type: 'cutEnd'; side: Side; completed: boolean }
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
  /** Alpha 1.5.5 — Zoe's SHOCK: the visible charge before the bolt (`duration` s), then the bolt leaves. */
  | { type: 'zapCharge'; side: Side; duration: number }
  | { type: 'zapFizzle'; side: Side }
  | { type: 'overload'; side: Side; x: number; z: number; hit: boolean }
  | { type: 'buff'; side: Side; buff: 'overdrive' | 'adrenaline'; duration: number }
  | { type: 'passive'; side: Side; passive: PassiveId }
  | { type: 'ko'; side: Side; x: number; z: number; heavy: boolean }
  | { type: 'timeUp' }
  | { type: 'rating'; amount: number; label: string }
  | { type: 'reaction'; text: string; tier: 1 | 2 | 3; sub?: string }
  | { type: 'propBreak'; index: number; x: number; z: number }
  /** A set piece was hit but holds (hp left), or a reactive piece reacted (hp = -1). */
  | { type: 'propHit'; index: number; x: number; z: number; hp: number; heavy: boolean }
  | { type: 'propRespawn'; index: number }
  /**
   * Alpha 1.7.5 — a piece of cover on the floor (GRAVEYARD BROADCAST) took a hit: 'hit' (same
   * look), 'crack' (its look changed: `stage` 1 cracked, 2 battered) or 'break' (stage 3:
   * shattered, its collision is gone). `side` dealt it (-1: nobody in particular); d = direction.
   */
  | { type: 'cover'; index: number; what: 'hit' | 'crack' | 'break'; stage: number; hp: number; x: number; z: number; dx: number; dz: number; heavy: boolean; side: Side | -1 }
  /** Alpha 1.5: a BANK SHOT ricocheted off the barrier at (x, z) (n = wall normal, d = new direction). */
  | { type: 'bank'; side: Side; x: number; z: number; nx: number; nz: number; dx: number; dz: number }
  /** Alpha 1.5: a BANK SHOT landed after its ricochet. */
  | { type: 'trickShot'; side: Side; x: number; z: number; refund: number }
  /** Alpha 1.5: FALSE START — the feint step (window seconds of reading). */
  | { type: 'feint'; side: Side; x: number; z: number; dx: number; dz: number; window: number }
  /** Alpha 1.5: the feint read an attack — it missed and the counter shot is on its way. */
  | { type: 'feintCounter'; side: Side; x: number; z: number; tx: number; tz: number; kind: HitKind }
  /** Alpha 1.5: the feint window ran out with nothing to read. */
  | { type: 'feintEnd'; side: Side }
  // ------------------------------------------------ Alpha 1.6 — CARD REVOLUTION
  /** A new card took effect: the activation gesture (FighterAnimator.cast) and its sound. */
  | { type: 'cast'; side: Side; card: CardId }
  /** SPOTLIGHT TAG on `side`'s opponent (hit = false: dodged); tagHit: the marked hit landed; tagEnd: it faded or was hidden. */
  | { type: 'tag'; side: Side; target: Side; hit: boolean; duration: number }
  | { type: 'tagHit'; side: Side; x: number; z: number }
  | { type: 'tagEnd'; side: Side }
  /** PULSE PUSH from (x, z) along (dx, dz); `hit`: the opponent was in reach. */
  | { type: 'push'; side: Side; x: number; z: number; dx: number; dz: number; range: number; hit: boolean }
  /** A stage object changed: spawned, landed, armed, fired, hit, broke, ended. */
  | { type: 'object'; id: number; kind: StageKind; owner: Side; what: 'spawn' | 'land' | 'arm' | 'lock' | 'fire' | 'trigger' | 'hit' | 'break' | 'end'; x: number; z: number }
  /** CABLE SNARE holds `side` near (ax, az); tetherEnd: released (broke = snapped by a move). */
  | { type: 'tether'; side: Side; ax: number; az: number; radius: number; duration: number }
  | { type: 'tetherEnd'; side: Side; broke: boolean }
  /** FRAME CATCH raised by `side`; frameCatch: it destroyed a projectile at (x, z) (first = the parry itself, then the rest of the volley). */
  | { type: 'frame'; side: Side; duration: number }
  | { type: 'frameCatch'; side: Side; x: number; z: number; first: boolean; heavy: boolean; refund: number }
  /** BACKTRACK: `side` rewinds from → to in `duration` s. */
  | { type: 'rewind'; side: Side; fromX: number; fromZ: number; toX: number; toZ: number; duration: number }
  /** HIGH STAKES: `side` paid `hp` health for `energy` energy. */
  | { type: 'stakes'; side: Side; hp: number; energy: number }
  /** REBOUND DISC turned back (what = 'turn') or came home (what = 'catch'). */
  | { type: 'disc'; side: Side; x: number; z: number; what: 'turn' | 'catch' }
  /** REPLAY: a projectile of the opponent was erased inside `side`'s freeze zone. */
  | { type: 'erase'; side: Side; x: number; z: number }
  /** `side` was held by nets / cables too long and broke free (short immunity). */
  | { type: 'breakFree'; side: Side; x: number; z: number }
  // ------------------------------------------------ Alpha 1.7 — BLOOD MOON PREMIERE
  /** A cane strike begins (`windup` s to the contact; `variant` 0 thrust, 1 / 2 slashes from either side). */
  | { type: 'strike'; side: Side; windup: number; variant: number }
  /** The strike's contact moment at (x, z) along (dx, dz): 'hit', 'blocked' (shield or a STAGE BARRIER), 'decoy', 'dodged' or 'miss'. */
  | { type: 'slash'; side: Side; x: number; z: number; dx: number; dz: number; outcome: 'hit' | 'blocked' | 'decoy' | 'dodged' | 'miss' }
  /** BAT BITE: the swarm lunge leaves, the bite lands, a shield stops it, a STAGE BARRIER stops the lunge. */
  | { type: 'bite'; side: Side; what: 'rush' | 'hit' | 'blocked' | 'barrier'; x: number; z: number; dx: number; dz: number }
  /** `side` bleeds for `duration` s (a refresh re-sends it); bleedEnd: the bleed is over. */
  | { type: 'bleed'; side: Side; duration: number }
  | { type: 'bleedEnd'; side: Side };

export type CardFailReason = 'energy' | 'stunned' | 'glitched' | 'busy' | 'cooldown' | 'phase' | 'risk' | 'recharge' | 'notake';

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
  /** Alpha 1.6: combo multiplier already in `damage` (SPOTLIGHT TAG uses the larger, never both). */
  boost?: number;
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
