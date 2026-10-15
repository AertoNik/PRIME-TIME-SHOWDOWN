import { ARENA, BROADCAST, CARD_TUNING, MATCH, PASSIVE_TUNING, PILOT } from '../config/balance';
import { CARDS } from '../config/cards';
import { BEHAVIORS, DIFFICULTIES, FIGHTERS, RIVALS, rivalFighterDef } from '../config/fighters';
import type { Behavior, CardId, ComboDef, ComboId, Difficulty, DifficultyDef, FighterId, RivalDef, RivalId, Side } from '../config/types';
import { Rng } from '../core/math';
import { Abilities } from './Abilities';
import { BroadcastSystem, type BroadcastHost } from './BroadcastSystem';
import { CardHand } from './CardSystem';
import { CombatSystem } from './CombatSystem';
import { ComboSystem } from './ComboSystem';
import { FighterAI, type AIProfile } from './FighterAI';
import { FighterSim } from './FighterSim';
import type { CardFailReason, Decoy, MatchEvent, MatchPhase, MatchResultData, Projectile, PropState, SmokeZone } from './types';

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
  timeLeft: number = MATCH.duration;
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
    this.difficulty = DIFFICULTIES[cfg.difficulty];
    this.rival = RIVALS[cfg.rival];
    const pDef = FIGHTERS[cfg.fighter];
    const eDef = rivalFighterDef(this.rival);
    const d = this.difficulty;

    const player = new FighterSim(0, pDef, pDef.name, pDef.look, 1, 1, MATCH.fighterRadius);
    const enemy = new FighterSim(1, eDef, this.rival.name, this.rival.look, d.hpMult, d.dmgMult, MATCH.fighterRadius);
    player.place(0, MATCH.spawnZ, Math.PI);
    enemy.place(0, -MATCH.spawnZ, 0);
    player.aimX = enemy.x;
    player.aimZ = enemy.z;
    enemy.aimX = player.x;
    enemy.aimZ = player.z;
    this.fighters = [player, enemy];

    this.hands = [new CardHand(cfg.deck, 1), new CardHand(this.rival.deck, d.energyMult)];

    this.broadcast = new BroadcastSystem(this);
    this.combat = new CombatSystem(this);
    this.abilities = new Abilities(this);

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
    };
    this.ais = [new FighterAI(this, 0, playerProfile), new FighterAI(this, 1, enemyProfile)];
    this.props = ARENA.props.map((p) => ({ x: p.x, z: p.z, alive: true, respawn: 0 }));
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

  // ------------------------------------------------------------------- step
  step(dt: number): void {
    this.clock += dt;
    if (this.phase === 'intro') {
      this.phaseTime += dt;
      const remaining = MATCH.introTime - this.phaseTime;
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
      this.timeLeft = Math.max(0, MATCH.duration - this.time);
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
    }

    this.combat.updateFighter(this.fighters[0], dt);
    this.combat.updateFighter(this.fighters[1], dt);
    this.combat.separate();
    this.combat.updateProjectiles(dt);
    this.updateZones(dt);

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
      if (d.t >= d.duration) {
        d.alive = false;
        this.emit({ type: 'decoyPop', side: d.owner, id: d.id, x: d.x, z: d.z, hit: false });
      }
    }
    this.decoys = this.decoys.filter((d) => d.alive);
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i];
      if (p.alive) continue;
      p.respawn -= dt;
      if (p.respawn <= 0) {
        p.alive = true;
        this.emit({ type: 'propRespawn', index: i });
      }
    }
  }

  // ------------------------------------------------------------------ cards
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
    if (f.glitch > 0) return fail('glitched');
    if ((f.stun > 0 || f.knockback > 0) && card !== 'shield') return fail('stunned');
    const needsBody = card === 'dash' || card === 'power_shot' || card === 'knockout' || card === 'charged_shot';
    const a = f.action.kind;
    let defer = false;
    if (needsBody) {
      if (a === 'windup' || a === 'rush' || a === 'recover') return fail('busy');
      if (a === 'dash') {
        if (card === 'dash' || this.deferred[side]) return fail('busy');
        defer = true;
      }
    }
    if (card === 'adrenaline' && (a === 'windup' || a === 'rush')) return fail('busy');

    hand.consume(index);
    const combo = this.combos.detect(side, card, this.time);
    this.combos.record(side, card, this.time);
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
    const d: Decoy = { id: this.nextId(), owner: f.side, x: f.x, z: f.z, facing: f.facing, t: 0, duration, alive: true };
    this.decoys.push(d);
    this.emit({ type: 'decoy', side: f.side, id: d.id, x: d.x, z: d.z, duration });
  }

  popDecoy(d: Decoy): void {
    if (!d.alive) return;
    d.alive = false;
    this.emit({ type: 'decoyPop', side: d.owner, id: d.id, x: d.x, z: d.z, hit: true });
  }

  hitProps(x: number, z: number, heavy: boolean): void {
    const r = heavy ? 1.7 : 0.95;
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i];
      if (!p.alive) continue;
      if (Math.hypot(p.x - x, p.z - z) < r) {
        p.alive = false;
        p.respawn = ARENA.propRespawn;
        this.emit({ type: 'propBreak', index: i, x: p.x, z: p.z });
      }
    }
  }

  // ---------------------------------------------------------------- endings
  knockOut(target: FighterSim, heavy: boolean): void {
    if (target.ko) return;
    target.ko = true;
    target.hp = 0;
    target.action = { kind: 'none' };
    target.stun = 0;
    target.glitch = 0;
    target.shield = 0;
    target.overdrive = 0;
    target.adrenaline = 0;
    this.emit({ type: 'ko', side: target.side, x: target.x, z: target.z, heavy });
    this.finish('ko', (1 - target.side) as Side);
  }

  private timeUp(): void {
    this.emit({ type: 'timeUp' });
    const pf = this.fighters[0].hpFrac;
    const ef = this.fighters[1].hpFrac;
    let winner: Side | null = null;
    if (Math.abs(pf - ef) >= MATCH.drawEpsilon) winner = pf > ef ? 0 : 1;
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
      if (f.action.kind !== 'none') f.action = { kind: 'none' };
    }
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
    };
  }
}
