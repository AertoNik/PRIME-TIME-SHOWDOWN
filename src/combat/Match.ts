import { ARENA, BROADCAST, CARD_TUNING, COMBO_TUNING, MATCH, PASSIVE_TUNING, PILOT } from '../config/balance';
import { arenaById, type ArenaId } from '../config/arenas.config';
import { bossById } from '../config/boss.config';
import { CARDS } from '../config/cards';
import { BEHAVIORS, DIFFICULTIES, FIGHTERS, RIVALS, rivalFighterDef } from '../config/fighters';
import type { Behavior, CardId, ComboDef, ComboId, Difficulty, DifficultyDef, FighterId, RivalDef, RivalId, Side } from '../config/types';
import { Rng, clampRoundedRect, type ClampResult } from '../core/math';
import { Abilities } from './Abilities';
import { BossDirector } from './BossDirector';
import { BroadcastSystem, type BroadcastHost } from './BroadcastSystem';
import { CardHand } from './CardSystem';
import { CombatSystem } from './CombatSystem';
import { ComboSystem } from './ComboSystem';
import { FighterAI, type AIProfile } from './FighterAI';
import { FighterSim } from './FighterSim';
import { StageObjects } from './StageObjects';
import type { CardFailReason, Decoy, MatchEvent, MatchPhase, MatchResultData, Projectile, PropState, SmokeZone } from './types';

/** Cards that need the fighter's body free (no charge, rush or recovery running); a DASH-like move defers them. */
const NEEDS_BODY = new Set<CardId>(['dash', 'power_shot', 'knockout', 'charged_shot', 'directors_cut', 'bank_shot', 'false_start', 'split_shot', 'rebound_disc', 'backtrack', 'bat_bite']);
const tmpClamp: ClampResult = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };

export interface MatchConfig {
  fighter: FighterId;
  deck: CardId[];
  rival: RivalId;
  difficulty: Difficulty;
  seed: number;
  /** Player fighter fans (cosmetic viewer count). */
  fans: number;
  /** Headless testing: let an AI play the player's cards too. */
  autoPlayer?: { behavior: Behavior; smarts: number; dodge: number; reaction: number; eagerness?: number };
  /** Game-mode modifiers (Survival / Prime Challenge). Absent in Classic Duel. */
  mods?: MatchMods;
  /** BOSS FIGHT: id from src/config/boss.config.ts (the rival must be that boss). */
  boss?: string;
  /** Alpha 1.4: studio set (only its set pieces matter to the simulation). Default: the original arena. */
  arena?: ArenaId;
}

/**
 * Per-fight rule changes used by the game modes. They live only inside one
 * Match instance, so nothing carries over to the next fight by accident.
 */
export interface MatchMods {
  /** Fight length in seconds (default MATCH.duration). */
  duration?: number;
  /** Player / rival energy regeneration multipliers (rivalEnergyMult 0: the rival has no energy at all — it never plays a card). */
  energyMult?: number;
  rivalEnergyMult?: number;
  /** Player starts with this fraction of max HP (Survival carry-over). */
  playerHpFrac?: number;
  /** Player outgoing damage multiplier (Survival POWER SURGE). */
  playerDmgMult?: number;
  /** Rival HP / damage multipliers on top of the difficulty (Survival waves). */
  rivalHpMult?: number;
  rivalDmgMult?: number;
  /** Pre-fight intro length (default MATCH.introTime). */
  introTime?: number;
  /** Who wins when time runs out: 'hp' (default: lost the smaller share of HP) or 'rival' (BOSS FIGHT: knockout only). */
  timeUpRule?: 'hp' | 'rival';
  /** Alpha 1.6.5: combo window in seconds (default MATCH.comboWindow) — FIRST BROADCAST gives a beginner time to read. */
  comboWindow?: number;
}

interface Deferred {
  card: CardId;
  combo: ComboDef | null;
  t: number;
}

/**
 * One duel. Pure simulation: deterministic for a given seed and inputs,
 * no DOM / WebGL. The renderer and UI read state and drain `events`.
 */
export class Match implements BroadcastHost {
  readonly cfg: MatchConfig;
  readonly rng: Rng;
  readonly difficulty: DifficultyDef;
  readonly rival: RivalDef;

  phase: MatchPhase = 'intro';
  phaseTime = 0;
  /** Seconds since FIGHT. */
  time = 0;
  /** Fight length for this match (Classic: MATCH.duration). */
  readonly duration: number;
  readonly introTime: number;
  timeLeft: number;
  /** BOSS FIGHT phases and signature moves (null in every other mode). */
  readonly boss: BossDirector | null = null;
  clock = 0;
  winner: Side | null = null;

  readonly fighters: [FighterSim, FighterSim];
  readonly hands: [CardHand, CardHand];
  readonly combos = new ComboSystem();
  readonly broadcast: BroadcastSystem;
  readonly combat: CombatSystem;
  readonly abilities: Abilities;
  readonly ais: [FighterAI, FighterAI];

  projectiles: Projectile[] = [];
  smokes: SmokeZone[] = [];
  decoys: Decoy[] = [];
  /** Alpha 1.6: nets, mines, barriers, props, cameras and freeze zones of the new cards. */
  readonly objects: StageObjects;
  readonly props: PropState[];
  events: MatchEvent[] = [];
  result: MatchResultData | null = null;

  private idSeq = 1;
  private countdown = 4;
  private deferred: [Deferred | null, Deferred | null] = [null, null];
  private playerCombos: ComboId[] = [];

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed);
    const bossDef = cfg.boss ? bossById(cfg.boss) : null;
    this.difficulty = bossDef ? bossDef.ai : DIFFICULTIES[cfg.difficulty];
    this.rival = RIVALS[cfg.rival];
    const pDef = FIGHTERS[cfg.fighter];
    const eDef = rivalFighterDef(this.rival);
    const d = this.difficulty;
    const mods = cfg.mods ?? {};
    this.duration = mods.duration ?? MATCH.duration;
    this.introTime = mods.introTime ?? MATCH.introTime;
    this.timeLeft = this.duration;

    const player = new FighterSim(0, pDef, pDef.name, pDef.look, 1, mods.playerDmgMult ?? 1, MATCH.fighterRadius);
    const enemy = new FighterSim(1, eDef, this.rival.name, this.rival.look, d.hpMult * (mods.rivalHpMult ?? 1), d.dmgMult * (mods.rivalDmgMult ?? 1), MATCH.fighterRadius);
    if (mods.playerHpFrac !== undefined) {
      player.hp = Math.max(1, Math.round(player.maxHp * Math.min(1, Math.max(0, mods.playerHpFrac))));
      player.startHp = player.hp;
    }
    player.place(0, MATCH.spawnZ, Math.PI);
    enemy.place(0, -MATCH.spawnZ, 0);
    player.aimX = enemy.x;
    player.aimZ = enemy.z;
    enemy.aimX = player.x;
    enemy.aimZ = player.z;
    this.fighters = [player, enemy];

    this.hands = [new CardHand(cfg.deck, mods.energyMult ?? 1), new CardHand(this.rival.deck, d.energyMult * (mods.rivalEnergyMult ?? 1))];
    // Alpha 1.6.5: a rival with no energy at all (FIRST BROADCAST's training bot) does not even get the starting 4
    if (mods.rivalEnergyMult === 0) this.hands[1].energy = 0;

    this.broadcast = new BroadcastSystem(this);
    this.combat = new CombatSystem(this);
    this.abilities = new Abilities(this);
    this.objects = new StageObjects(this);
    this.combos.ready = (side, c, prev) => this.comboReady(side, c, prev);
    if (cfg.mods?.comboWindow) this.combos.window = cfg.mods.comboWindow;

    const auto = cfg.autoPlayer;
    const playerProfile: AIProfile = auto
      ? {
          aimLead: PILOT.aimLead,
          aimError: PILOT.aimError,
          dodgeSkill: auto.dodge,
          reactMin: auto.reaction * 0.7,
          reactMax: auto.reaction * 1.2,
          decideMin: auto.reaction,
          decideMax: auto.reaction * 1.6,
          comboPlanning: auto.smarts,
          cardSmarts: auto.smarts,
          usesCards: true,
          behavior: auto.eagerness
            ? { ...BEHAVIORS[auto.behavior], cardEagerness: auto.eagerness, energyReserve: 0 }
            : BEHAVIORS[auto.behavior],
        }
      : {
          aimLead: PILOT.aimLead,
          aimError: PILOT.aimError,
          dodgeSkill: PILOT.dodgeSkill,
          reactMin: 0.3,
          reactMax: 0.5,
          decideMin: 1,
          decideMax: 1,
          comboPlanning: 0,
          cardSmarts: 1,
          usesCards: false,
          behavior: BEHAVIORS.tactical,
        };
    const enemyProfile: AIProfile = {
      aimLead: d.aimLead,
      aimError: d.aimError,
      dodgeSkill: d.dodgeSkill,
      reactMin: d.reactMin,
      reactMax: d.reactMax,
      decideMin: d.decideMin,
      decideMax: d.decideMax,
      comboPlanning: d.comboPlanning,
      cardSmarts: d.cardSmarts,
      usesCards: true,
      behavior: BEHAVIORS[this.rival.behavior],
      control: this.rival.mods?.control,
    };
    this.ais = [new FighterAI(this, 0, playerProfile), new FighterAI(this, 1, enemyProfile)];
    // Alpha 1.4: the stage's set pieces (Classic default: the original studio's speaker stacks)
    this.props = arenaById(cfg.arena).props.map((p) => ({
      kind: p.kind,
      x: p.x,
      z: p.z,
      alive: true,
      respawn: 0,
      hp: p.hp,
      maxHp: p.hp,
      respawnTime: p.respawn,
      radius: p.radius ?? null,
      reactive: !!p.reactive,
      cooldown: p.cooldown ?? 0,
      cool: 0,
      hits: 0,
    }));
    if (bossDef) this.boss = new BossDirector(this, bossDef);
  }

  // ----------------------------------------------------------------- basics
  foe(side: Side): FighterSim {
    return this.fighters[1 - side];
  }

  emit(e: MatchEvent): void {
    this.events.push(e);
    this.broadcast.onEvent(e);
    // Reading an attack with DASH pays back energy.
    if (e.type === 'dodge' && e.perfect && this.time - this.fighters[e.side].lastDash < 1.0) {
      this.hands[e.side].gain(CARD_TUNING.dash.perfectRefund);
    }
  }

  drainEvents(): MatchEvent[] {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  playerHpFrac(): number {
    return this.fighters[0].hpFrac;
  }

  playerEnergyFull(): boolean {
    return this.hands[0].energy >= MATCH.maxEnergy - 0.01;
  }

  private nextId(): number {
    return this.idSeq++;
  }

  /** Alpha 1.6: ids for stage objects (shared sequence with smokes and decoys). */
  newId(): number {
    return this.idSeq++;
  }

  // ------------------------------------------------------------------- step
  step(dt: number): void {
    this.clock += dt;
    if (this.phase === 'intro') {
      this.phaseTime += dt;
      const remaining = this.introTime - this.phaseTime;
      const n = Math.ceil(remaining);
      if (n < this.countdown && n <= 3) {
        this.countdown = n;
        this.emit({ type: 'countdown', n: Math.max(0, n) });
      }
      if (remaining <= 0) {
        this.phase = 'fight';
        this.phaseTime = 0;
        this.emit({ type: 'phase', phase: 'fight' });
      }
    } else if (this.phase === 'fight') {
      this.time += dt;
      this.timeLeft = Math.max(0, this.duration - this.time);
    } else if (this.phase === 'outro') {
      this.phaseTime += dt;
      if (this.phaseTime >= MATCH.outroTime) {
        this.phase = 'over';
        this.emit({ type: 'phase', phase: 'over' });
      }
    }

    for (const f of this.fighters) f.storePrev();

    if (this.phase === 'fight') {
      for (const side of [0, 1] as Side[]) {
        const f = this.fighters[side];
        this.hands[side].update(dt, f.overclock > 0 ? PASSIVE_TUNING.overclock.regenMult : 1);
      }
      this.ais[0].update(dt);
      this.ais[1].update(dt);
      this.runDeferred(dt);
      this.boss?.update();
    }

    this.combat.updateFighter(this.fighters[0], dt);
    this.combat.updateFighter(this.fighters[1], dt);
    this.combat.separate();
    this.combat.updateProjectiles(dt);
    this.updateZones(dt);
    if (this.phase === 'fight') {
      this.objects.update(dt);
      this.recordHistory(dt);
    }

    if (this.phase === 'fight') {
      this.broadcast.update(dt);
      if (this.timeLeft <= 0) this.timeUp();
    }
  }

  private runDeferred(dt: number): void {
    for (const side of [0, 1] as Side[]) {
      const d = this.deferred[side];
      if (!d) continue;
      const f = this.fighters[side];
      d.t += dt;
      if (f.ko || d.t > 1.2) {
        this.deferred[side] = null;
        continue;
      }
      if (f.action.kind === 'none' && f.stun <= 0 && f.knockback <= 0) {
        this.deferred[side] = null;
        this.abilities.execute(f, d.card, d.combo);
      }
    }
  }

  private updateZones(dt: number): void {
    for (const s of this.smokes) {
      s.t += dt;
      if (s.t >= s.duration && s.owner === 0 && s.misses === 0 && this.phase === 'fight') {
        this.broadcast.add(BROADCAST.wasted, 'ВХОЛОСТУЮ');
      }
    }
    this.smokes = this.smokes.filter((s) => s.t < s.duration);
    for (const d of this.decoys) {
      if (!d.alive) continue;
      d.t += dt;
      // Alpha 1.6 HOLO DECOY: it soaked a volley and now glitches out
      if (d.soak >= 0) {
        d.soak -= dt;
        if (d.soak <= 0) {
          this.popDecoy(d);
          continue;
        }
      }
      if (d.t >= d.duration) {
        d.alive = false;
        this.emit({ type: 'decoyPop', side: d.owner, id: d.id, x: d.x, z: d.z, hit: false });
      }
    }
    this.decoys = this.decoys.filter((d) => d.alive);
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i];
      if (p.cool > 0) p.cool -= dt;
      if (p.alive) continue;
      p.respawn -= dt;
      if (p.respawn <= 0) {
        p.alive = true;
        p.hp = p.maxHp;
        this.emit({ type: 'propRespawn', index: i });
      }
    }
  }

  // ------------------------------------------------------------------ cards
  /**
   * The rules for playing `card` now, without side effects (energy is checked by the caller).
   * Shared by playCard, the HUD combo hints and the AI, so a hint never promises a card the
   * rules would refuse. `defer`: valid, but it waits for the running DASH-like move to end.
   */
  cardRules(side: Side, card: CardId, combo: ComboDef | null, ignoreLockout = false): { fail: CardFailReason | null; defer: boolean } {
    const hand = this.hands[side];
    const f = this.fighters[side];
    const no = (fail: CardFailReason) => ({ fail, defer: false });
    if (this.phase !== 'fight' || f.ko) return no('phase');
    if (!ignoreLockout && hand.lockout > 0) return no('cooldown');
    if (f.glitch > 0) return no('glitched');
    if ((f.stun > 0 || f.knockback > 0) && card !== 'shield') return no('stunned');
    if (card === 'directors_cut' && f.cutCd > 0) return no('cooldown');
    if (card === 'high_stakes') {
      // Alpha 1.6: rare, and never into the danger zone
      const t = CARD_TUNING.high_stakes;
      if (f.stakesCd > 0 || f.stakesUses >= t.uses) return no('recharge');
      const cost = f.maxHp * t.hpCost * (combo?.id === 'safe_bet' ? COMBO_TUNING.safeBetCost : 1);
      if (f.hp - cost < f.maxHp * t.minHp) return no('risk');
    }
    // Alpha 1.6.1 SECOND TAKE: only with a recent card attack to replay
    if (card === 'second_take' && !this.takeReady(f)) return no('notake');
    const a = f.action.kind;
    let defer = false;
    if (NEEDS_BODY.has(card)) {
      if (a === 'windup' || a === 'rush' || a === 'recover' || a === 'cut' || a === 'bite') return no('busy');
      if (a === 'dash' || a === 'feint' || a === 'rewind') {
        if (card === 'dash' || card === 'false_start' || this.deferred[side]) return no('busy');
        defer = true;
      }
    }
    // one read window at a time
    if (card === 'false_start' && f.feint > 0) return no('busy');
    if (card === 'adrenaline' && (a === 'windup' || a === 'rush' || a === 'cut' || a === 'bite')) return no('busy');
    return { fail: null, defer };
  }

  /**
   * Alpha 1.6: a combo whose setup is gone does not trigger (and is not hinted): the net
   * expired, the mine went off, nothing was caught, the target slipped the tag or cable.
   */
  comboReady(side: Side, c: ComboDef, prev: CardId): boolean {
    const f = this.fighters[side];
    const foe = this.fighters[1 - side];
    switch (c.id) {
      case 'spotlight':
        return foe.tag > 0 && foe.tagBy === side;
      case 'tight_spread':
      case 'boomerang':
      case 'set_piece':
      case 'gravity_trap':
      case 'camera_lock':
        if (prev === 'gravity_net') return !!this.objects.own(side, 'net');
        if (prev === 'cable_snare') return foe.tether > 0;
        return true;
      case 'mine_drive':
      case 'rewind_trap':
        return !!this.objects.own(side, 'mine');
      case 'wall_push':
      case 'backstage':
      case 'cross_angle':
        return !!this.objects.own(side, 'barrier');
      case 'blindside':
        return this.decoys.some((d) => d.alive && d.owner === side && d.kind === 'holo');
      case 'catch_release':
      case 'safe_bet':
        return f.caught > 0;
      case 'replay':
      case 'time_slip':
        return !!this.objects.own(side, 'freeze');
      default:
        return true;
    }
  }

  /** Alpha 1.6.1 SECOND TAKE: there is a card attack of the last few seconds to replay. */
  takeReady(f: FighterSim): boolean {
    return !!f.take && this.time - f.take.time <= CARD_TUNING.second_take.window;
  }

  /**
   * HUD hint: the combo `card` would form now — only when it is really playable: the rules
   * allow it and the energy is there or arrives before the combo window closes.
   */
  comboHint(side: Side, card: CardId): ComboDef | null {
    const c = this.combos.wouldCombo(side, card, this.time);
    if (!c) return null;
    if (this.cardRules(side, card, c, true).fail) return null;
    const hand = this.hands[side];
    const f = this.fighters[side];
    const regen = MATCH.energyPerSecond * hand.regenMult * (f.overclock > 0 ? PASSIVE_TUNING.overclock.regenMult : 1);
    if (hand.energy + regen * this.combos.windowLeft(side, this.time) < CARDS[card].cost) return null;
    return c;
  }

  /** Returns null on success or the reason the card could not be played. */
  playCard(side: Side, index: number): CardFailReason | null {
    const hand = this.hands[side];
    const f = this.fighters[side];
    const card = hand.hand[index];
    if (!card || this.phase !== 'fight' || f.ko) return 'phase';
    const fail = (reason: CardFailReason): CardFailReason => {
      this.emit({ type: 'cardFail', side, card, reason });
      return reason;
    };
    if (hand.lockout > 0) return fail('cooldown');
    if (hand.energy < CARDS[card].cost) return fail('energy');
    const combo = this.combos.detect(side, card, this.time);
    const rules = this.cardRules(side, card, combo);
    if (rules.fail) return fail(rules.fail);
    const defer = rules.defer;

    hand.consume(index);
    this.combos.record(side, card, this.time, combo?.id ?? null);
    f.m.cardsUsed++;
    this.emit({ type: 'card', side, card, combo: combo?.id ?? null });
    if (combo) {
      f.m.combos++;
      if (side === 0) this.playerCombos.push(combo.id);
      this.emit({ type: 'combo', side, combo: combo.id });
      if (f.def.passive === 'overclock') {
        hand.gain(PASSIVE_TUNING.overclock.energy);
        f.overclock = PASSIVE_TUNING.overclock.duration;
        this.emit({ type: 'passive', side, passive: 'overclock' });
      }
    }
    if (defer) this.deferred[side] = { card, combo, t: 0 };
    else this.abilities.execute(f, card, combo);
    return null;
  }

  /** Alpha 1.6 BACKTRACK: where each fighter stood over the last seconds (a small ring of samples). */
  private recordHistory(dt: number): void {
    const t = CARD_TUNING.backtrack;
    const keep = Math.round(t.keep / t.sample) * 2;
    for (const f of this.fighters) {
      if (f.ko) continue;
      f.histT += dt;
      if (f.histT < t.sample) continue;
      f.histT -= t.sample;
      f.hist.push(f.x, f.z);
      if (f.hist.length > keep) f.hist.splice(0, f.hist.length - keep);
    }
  }

  // ---------------------------------------------------------------- effects
  inOwnSmoke(f: { side: Side; x: number; z: number }): boolean {
    for (const s of this.smokes) {
      if (s.owner !== f.side || s.t < 0.15) continue;
      if (Math.hypot(f.x - s.x, f.z - s.z) < s.radius) return true;
    }
    return false;
  }

  spawnSmoke(f: FighterSim): void {
    const t = CARD_TUNING.smoke;
    const z: SmokeZone = { id: this.nextId(), owner: f.side, misses: 0, x: f.x, z: f.z, radius: t.radius, t: 0, duration: t.duration };
    this.smokes.push(z);
    this.emit({ type: 'smoke', side: f.side, id: z.id, x: z.x, z: z.z, radius: z.radius, duration: z.duration });
  }

  spawnDecoy(f: FighterSim, duration: number): void {
    const d: Decoy = { id: this.nextId(), owner: f.side, x: f.x, z: f.z, facing: f.facing, t: 0, duration, alive: true, kind: 'phantom', soak: -1 };
    this.decoys.push(d);
    this.emit({ type: 'decoy', side: f.side, id: d.id, x: d.x, z: d.z, duration });
  }

  /**
   * Alpha 1.6 — HOLO DECOY: a hologram `offset` m to the fighter's side (the side with more
   * floor), one per fighter. It draws the opponent's regular fire only (see CombatSystem).
   */
  spawnHolo(f: FighterSim, foe: FighterSim): void {
    const t = CARD_TUNING.holo_decoy;
    for (const d of this.decoys) if (d.alive && d.owner === f.side && d.kind === 'holo') this.popDecoy(d);
    const dx = foe.x - f.x;
    const dz = foe.z - f.z;
    const dl = Math.hypot(dx, dz) || 1;
    const px = -dz / dl;
    const pz = dx / dl;
    let best = { x: f.x, z: f.z };
    let bestRoom = -1;
    for (const sgn of [1, -1]) {
      const wx = f.x + px * sgn * t.offset;
      const wz = f.z + pz * sgn * t.offset;
      clampRoundedRect(wx, wz, ARENA.halfX - 0.2, ARENA.halfZ - 0.2, ARENA.cornerRadius, tmpClamp);
      const room = Math.hypot(tmpClamp.x - f.x, tmpClamp.z - f.z);
      if (room > bestRoom + 0.05) {
        bestRoom = room;
        best = { x: tmpClamp.x, z: tmpClamp.z };
      }
    }
    const d: Decoy = { id: this.nextId(), owner: f.side, x: best.x, z: best.z, facing: f.facing, t: 0, duration: t.duration, alive: true, kind: 'holo', soak: -1 };
    this.decoys.push(d);
    this.emit({ type: 'decoy', side: f.side, id: d.id, x: d.x, z: d.z, duration: t.duration });
  }

  popDecoy(d: Decoy): void {
    if (!d.alive) return;
    d.alive = false;
    this.emit({ type: 'decoyPop', side: d.owner, id: d.id, x: d.x, z: d.z, hit: true });
  }

  /**
   * A shot hit the barrier at (x, z): set pieces within reach react. Purely
   * visual — no damage, no rating, no random numbers — and a broken piece never
   * reacts again until it is rebuilt, so nothing can be farmed.
   */
  hitProps(x: number, z: number, heavy: boolean): void {
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i];
      if (!p.alive) continue;
      const r = p.radius !== null ? (heavy ? p.radius * 1.25 : p.radius) : heavy ? 1.7 : 0.95;
      if (Math.hypot(p.x - x, p.z - z) >= r) continue;
      if (p.reactive) {
        if (p.cool > 0) continue;
        p.cool = p.cooldown;
        p.hits++;
        this.emit({ type: 'propHit', index: i, x: p.x, z: p.z, hp: -1, heavy });
        continue;
      }
      p.hits++;
      p.hp--;
      if (p.hp > 0) {
        this.emit({ type: 'propHit', index: i, x: p.x, z: p.z, hp: p.hp, heavy });
        continue;
      }
      p.alive = false;
      p.respawn = p.respawnTime > 0 ? p.respawnTime : Infinity;
      this.emit({ type: 'propBreak', index: i, x: p.x, z: p.z });
    }
  }

  // ---------------------------------------------------------------- endings
  knockOut(target: FighterSim, heavy: boolean): void {
    if (target.ko) return;
    target.ko = true;
    target.hp = 0;
    this.abilities.cancelCut(target);
    target.action = { kind: 'none' };
    target.stun = 0;
    target.glitch = 0;
    target.shield = 0;
    target.overdrive = 0;
    target.adrenaline = 0;
    // Alpha 1.7: a knocked-out fighter stops bleeding and swinging
    target.strikeT = 0;
    if (target.bleedTicks > 0) {
      target.bleedTicks = 0;
      this.emit({ type: 'bleedEnd', side: target.side });
    }
    this.emit({ type: 'ko', side: target.side, x: target.x, z: target.z, heavy });
    this.finish('ko', (1 - target.side) as Side);
  }

  private timeUp(): void {
    this.emit({ type: 'timeUp' });
    // Whoever lost less of their max HP during this fight wins. With both sides
    // starting at full health (Classic) this is exactly "more HP left wins";
    // in Survival the carried-over damage from earlier waves is not held against the player.
    const [p, e] = this.fighters;
    const lostP = (p.startHp - p.hp) / p.maxHp;
    const lostE = (e.startHp - e.hp) / e.maxHp;
    let winner: Side | null = null;
    if (this.cfg.mods?.timeUpRule === 'rival') winner = 1;
    else if (Math.abs(lostP - lostE) >= MATCH.drawEpsilon) winner = lostP < lostE ? 0 : 1;
    this.finish('time', winner);
  }

  forfeit(): void {
    if (this.phase === 'over') return;
    if (this.phase !== 'fight') {
      this.phase = 'fight';
    }
    this.fighters[0].ko = true;
    this.finish('forfeit', 1);
    this.phase = 'over';
  }

  private finish(method: 'ko' | 'time' | 'forfeit', winner: Side | null): void {
    if (this.phase !== 'fight') return;
    this.phase = 'outro';
    this.phaseTime = 0;
    this.winner = winner;
    if (winner !== null) this.fighters[winner].victory = true;
    for (const f of this.fighters) {
      f.adrenaline = 0;
      f.overdrive = 0;
      this.abilities.cancelCut(f);
      if (f.action.kind !== 'none') f.action = { kind: 'none' };
      // Alpha 1.6: marks, cables, frames and pushes end with the fight
      if (f.tag > 0) this.emit({ type: 'tagEnd', side: f.side });
      if (f.tether > 0) this.emit({ type: 'tetherEnd', side: f.side, broke: false });
      f.tag = 0;
      f.tether = 0;
      f.frame = 0;
      f.shoveX = f.shoveZ = 0;
      // Alpha 1.7: a bleed and a swing on its way end with the fight
      f.strikeT = 0;
      if (f.bleedTicks > 0) {
        f.bleedTicks = 0;
        this.emit({ type: 'bleedEnd', side: f.side });
      }
    }
    // Alpha 1.6: every temporary set piece leaves the stage
    this.objects.clear();
    this.emit({ type: 'phase', phase: 'outro' });
    this.result = this.buildResult(method);
  }

  private buildResult(method: 'ko' | 'time' | 'forfeit'): MatchResultData {
    const p = this.fighters[0];
    const e = this.fighters[1];
    const outcome = this.winner === 0 ? 'win' : this.winner === 1 ? 'loss' : 'draw';
    let rating = this.broadcast.finalRating();
    if (method === 'forfeit') rating = Math.round(rating * 0.4);
    return {
      outcome,
      method,
      rating,
      peakRating: Math.round(this.broadcast.peak),
      avgRating: Math.round(this.broadcast.average),
      bestCombo: this.broadcast.bestCombo,
      combos: p.m.combos,
      comboList: this.playerCombos.slice(),
      perfects: p.m.perfects,
      damageDealt: p.m.damageDealt,
      damageTaken: p.m.damageTaken,
      cardsUsed: p.m.cardsUsed,
      duration: this.time,
      playerHpFrac: p.hpFrac,
      enemyHpFrac: e.hpFrac,
      finisher: this.broadcast.finisher,
      bossPhase: this.boss ? this.boss.phase : undefined,
    };
  }
}
