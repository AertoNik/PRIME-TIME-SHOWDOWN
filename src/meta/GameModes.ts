import { bossById, type BossDef } from '../config/boss.config';
import { REWARDS } from '../config/career';
import { COSMETICS, type CosmeticId } from '../config/cosmetics.config';
import { RIVALS, RIVAL_ORDER } from '../config/fighters';
import { PERKS, PERK_ORDER, SURVIVAL, challengeById, type ChallengeDef, type ModeReward, type PerkDef, type PerkId } from '../config/modes.config';
import type { CardId, Difficulty, FighterId, RivalId } from '../config/types';
import type { MatchMods } from '../combat/Match';
import type { MatchResultData } from '../combat/types';
import { Rng } from '../core/math';
import type { CareerSystem, GrantOutcome, RewardLine } from './CareerSystem';
import type { EventManager, MatchEventOutcome } from './EventManager';
import { emptyBoss, emptyChallenge, emptyPerks, type BossProgress, type ChallengeProgress, type SaveSystem, type SurvivalRecords, type SurvivalRun, type WaveLog } from './SaveSystem';

/**
 * How a Survival attempt ended.
 * complete — all waves won; defeat — lost or drew a wave; forfeit — gave up mid-fight;
 * retired — stopped between waves; abandoned — the game was closed during the attempt.
 */
export type SurvivalEnd = 'complete' | 'defeat' | 'forfeit' | 'retired' | 'abandoned';

export interface SurvivalSummary {
  run: SurvivalRun;
  end: SurvivalEnd;
  cleared: number;
  /** Sum of the cleared waves' show ratings. */
  score: number;
  lines: RewardLine[];
  reward: ModeReward;
  newRecord: boolean;
  prevBestWave: number;
  prevBestScore: number;
  firstClear: boolean;
  grant: GrantOutcome;
  event: MatchEventOutcome | null;
}

export interface WaveOutcome {
  won: boolean;
  /** HP fraction at the end of the wave and after the between-wave heal. */
  hpAfterFight: number;
  hpAfterHeal: number;
  /** Set when this wave ended the attempt. */
  summary: SurvivalSummary | null;
}

export interface WaveSetup {
  index: number;
  total: number;
  final: boolean;
  rival: RivalId;
  difficulty: Difficulty;
  mods: MatchMods;
}

export interface PerkOption {
  def: PerkDef;
  stacks: number;
  available: boolean;
}

export interface ChallengeCheck {
  label: string;
  ok: boolean;
}

export interface ChallengeOutcome {
  def: ChallengeDef;
  cleared: boolean;
  checks: ChallengeCheck[];
  /** Paid now (first clear only). */
  firstClear: { money: number; rep: number } | null;
  /** This fight's record value when cleared. */
  value: number | null;
  newBest: boolean;
  progress: ChallengeProgress;
}

export interface BossOutcome {
  def: BossDef;
  won: boolean;
  /** Highest phase the champion reached. */
  phase: number;
  /** Champion's health left (0 on a win). */
  bossHp: number;
  /** Paid now (first win only). */
  firstWin: { money: number; fans: number; rep: number; cosmetic: CosmeticId } | null;
  /** The cosmetic was newly added to the collection. */
  cosmeticNew: boolean;
  newBestTime: boolean;
  newBestRating: boolean;
  progress: BossProgress;
}

const ULTRA = new Set(['superstar', 'electro_blast']);

/** Personal-best value for a cleared challenge fight. Lower is better for 'fastest'. */
export function challengeValue(def: ChallengeDef, r: MatchResultData): number {
  if (def.record === 'combos') return r.combos;
  if (def.record === 'fastest') return Math.max(1, Math.ceil(r.duration));
  return r.rating;
}

export function formatChallengeValue(def: ChallengeDef, v: number): string {
  if (def.record === 'combos') return `${v} комбо`;
  if (def.record === 'fastest') return `${v} с`;
  return `рейтинг ${v}`;
}

/** Clear conditions of a challenge, each with its own pass/fail (shown on the results screen). */
export function evaluateChallenge(def: ChallengeDef, r: MatchResultData): { cleared: boolean; checks: ChallengeCheck[] } {
  const checks: ChallengeCheck[] = [];
  const g = def.goal;
  const won = r.outcome === 'win';
  checks.push({ label: 'Победа', ok: won });
  if (g.timeUpMargin !== undefined) {
    const lead = r.playerHpFrac - r.enemyHpFrac;
    const ok = won && (r.method === 'ko' || lead >= g.timeUpMargin - 1e-9);
    checks.push({
      label: r.method === 'time' && won ? `Перевес по здоровью ${Math.round(lead * 100)}% (нужно ${Math.round(g.timeUpMargin * 100)}%)` : 'Нокаут или перевес 10% по времени',
      ok,
    });
  }
  if (g.minRating !== undefined) checks.push({ label: `Рейтинг шоу ${r.rating} (нужно ${g.minRating}+)`, ok: r.rating >= g.minRating });
  return { cleared: r.method !== 'forfeit' && checks.every((c) => c.ok), checks };
}

/**
 * Survival marathon and Prime Challenge rules on top of the save. Every payout
 * happens exactly once and is saved together with the flag that prevents a repeat.
 */
export class GameModes {
  private store: SaveSystem;
  private career: CareerSystem;
  private events: EventManager | null;
  private clock: () => number;

  constructor(store: SaveSystem, career: CareerSystem, events: EventManager | null, clock: () => number = () => Date.now()) {
    this.store = store;
    this.career = career;
    this.events = events;
    this.clock = clock;
  }

  get survival(): SurvivalRecords {
    return this.store.data.modes.survival;
  }

  get activeRun(): SurvivalRun | null {
    return this.survival.active;
  }

  // ------------------------------------------------------------- survival
  /** Five opponents: every rival once in random order, the finale is never the previous opponent. */
  planRivals(seed: number): RivalId[] {
    const rng = new Rng(seed);
    const pool = RIVAL_ORDER.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const out: RivalId[] = [];
    for (let i = 0; i < SURVIVAL.waves.length; i++) {
      if (i < pool.length) out.push(pool[i]);
      else {
        // replay an early opponent (never the one just fought)
        const early = out.slice(0, Math.max(1, out.length - 2)).filter((r) => r !== out[out.length - 1]);
        out.push(early[Math.floor(rng.next() * early.length) % early.length] ?? pool[0]);
      }
    }
    return out;
  }

  startRun(fighter: FighterId, deck: CardId[], eventId: string | null, seed: number): SurvivalRun {
    const run: SurvivalRun = {
      id: Math.floor(this.clock()) * 10 + (Math.abs(Math.floor(seed)) % 10),
      fighter,
      deck: deck.slice(),
      rivals: this.planRivals(seed),
      wave: 0,
      hpFrac: 1,
      perks: emptyPerks(),
      waves: [],
      pendingPerk: false,
      eventId,
      startedAt: this.clock(),
    };
    this.survival.active = run;
    this.store.save();
    return run;
  }

  /** Rival, AI level and fight modifiers for the next wave of the active run. */
  waveSetup(run: SurvivalRun): WaveSetup {
    const i = Math.min(run.wave, SURVIVAL.waves.length - 1);
    const w = SURVIVAL.waves[i];
    return {
      index: i,
      total: SURVIVAL.waves.length,
      final: i === SURVIVAL.waves.length - 1,
      rival: run.rivals[i],
      difficulty: w.difficulty,
      mods: {
        playerHpFrac: run.hpFrac,
        energyMult: 1 + run.perks.energy_boost * PERKS.energy_boost.value,
        playerDmgMult: 1 + run.perks.power_surge * PERKS.power_surge.value,
        rivalHpMult: w.hpMult,
        rivalDmgMult: w.dmgMult,
      },
    };
  }

  /** Record a finished wave. Returns null if it does not belong to the active run (no double counting). */
  recordWave(runId: number, r: MatchResultData, hpFracAfter: number): WaveOutcome | null {
    const run = this.survival.active;
    if (!run || run.id !== runId || run.pendingPerk || run.wave >= SURVIVAL.waves.length) return null;
    const log: WaveLog = {
      rival: run.rivals[run.wave],
      outcome: r.outcome,
      method: r.method,
      rating: Math.round(r.rating),
      combos: r.combos,
      comboList: r.comboList.slice(),
      perfects: r.perfects,
      damageDealt: Math.round(r.damageDealt),
      damageTaken: Math.round(r.damageTaken),
      cardsUsed: r.cardsUsed,
      duration: r.duration,
    };
    run.waves.push(log);
    const hp = Math.min(1, Math.max(0, hpFracAfter));
    if (r.outcome !== 'win') {
      return { won: false, hpAfterFight: hp, hpAfterHeal: hp, summary: this.finalize(r.method === 'forfeit' ? 'forfeit' : 'defeat') };
    }
    run.wave++;
    if (run.wave >= SURVIVAL.waves.length) {
      run.hpFrac = hp;
      return { won: true, hpAfterFight: hp, hpAfterHeal: hp, summary: this.finalize('complete') };
    }
    run.hpFrac = Math.min(1, hp + SURVIVAL.healBetween);
    run.pendingPerk = true;
    this.store.save();
    return { won: true, hpAfterFight: hp, hpAfterHeal: run.hpFrac, summary: null };
  }

  perkOptions(run: SurvivalRun): PerkOption[] {
    return PERK_ORDER.map((id) => {
      const def = PERKS[id];
      const stacks = run.perks[id];
      return { def, stacks, available: stacks < def.maxStacks };
    });
  }

  /** Apply the bonus picked between waves. One pick per cleared wave. */
  choosePerk(runId: number, id: PerkId): boolean {
    const run = this.survival.active;
    if (!run || run.id !== runId || !run.pendingPerk) return false;
    const def = PERKS[id];
    if (!def || run.perks[id] >= def.maxStacks) return false;
    run.perks[id]++;
    if (id === 'second_wind') run.hpFrac = Math.min(1, run.hpFrac + def.value);
    run.pendingPerk = false;
    this.store.save();
    return true;
  }

  /** Stop between waves and take what was earned. */
  retire(runId: number): SurvivalSummary | null {
    const run = this.survival.active;
    if (!run || run.id !== runId) return null;
    return this.finalize('retired');
  }

  /** An attempt left over from a closed tab or reload: close it with the waves it cleared. */
  closeAbandoned(): SurvivalSummary | null {
    return this.survival.active ? this.finalize('abandoned') : null;
  }

  score(run: SurvivalRun): number {
    return run.waves.filter((w) => w.outcome === 'win').reduce((a, w) => a + w.rating, 0);
  }

  /** Rewards for a run that ended this way (pure: nothing is paid). */
  computeRewards(run: SurvivalRun, end: SurvivalEnd, firstClear: boolean): { lines: RewardLine[]; reward: ModeReward } {
    const lines: RewardLine[] = [];
    let money = 0;
    let fans = 0;
    let rep = 0;
    run.waves.forEach((w, i) => {
      if (w.outcome !== 'win') return;
      const def = SURVIVAL.waves[i];
      const m = Math.round(def.reward.money + w.rating * SURVIVAL.ratingMoney);
      lines.push({ label: `Волна ${i + 1} · ${RIVALS[w.rival].name}`, value: m, kind: 'money', note: `рейтинг ${w.rating}` });
      money += m;
      fans += Math.round(def.reward.fans * (REWARDS.fansRatingBase + (w.rating / 100) * REWARDS.fansRatingK));
      rep += Math.round(def.reward.rep + w.rating * SURVIVAL.ratingRep);
    });
    const cleared = run.waves.filter((w) => w.outcome === 'win').length;
    if (end === 'complete') {
      const c = SURVIVAL.completion;
      lines.push({ label: 'Марафон пройден', value: c.money, kind: 'money', note: `${SURVIVAL.waves.length}/${SURVIVAL.waves.length}` });
      money += c.money;
      fans += c.fans;
      rep += c.rep;
      if (firstClear) {
        const f = SURVIVAL.firstClear;
        lines.push({ label: 'Первое прохождение', value: f.money, kind: 'money', note: 'один раз' });
        money += f.money;
        fans += f.fans;
        rep += f.rep;
      }
    }
    if (cleared === 0 && end === 'defeat') {
      const p = SURVIVAL.participation;
      lines.push({ label: 'Гонорар за выход', value: p.money, kind: 'money' });
      money += p.money;
      fans += p.fans;
      rep += p.rep;
    }
    lines.push({ label: 'Новые фанаты', value: fans, kind: 'fans', note: 'за пройденные волны' });
    lines.push({ label: 'Репутация продюсера', value: rep, kind: 'rep' });
    return { lines, reward: { money, fans, rep } };
  }

  /** Close the active run once: pay, update records, report to the seasonal event, clear it. */
  private finalize(end: SurvivalEnd): SurvivalSummary | null {
    const rec = this.survival;
    const run = rec.active;
    if (!run) return null;
    rec.active = null; // cleared before anything is paid: a second call finds nothing
    const cleared = run.waves.filter((w) => w.outcome === 'win').length;
    const score = this.score(run);
    const firstClear = end === 'complete' && !rec.firstClearPaid;
    const { lines, reward } = this.computeRewards(run, end, firstClear);
    const prevBestWave = rec.bestWave;
    const prevBestScore = rec.bestScore;
    const newRecord = cleared > prevBestWave || (cleared > 0 && cleared === prevBestWave && score > prevBestScore);
    rec.runs++;
    if (end === 'complete') rec.completions++;
    if (firstClear) rec.firstClearPaid = true;
    if (cleared > rec.bestWave) rec.bestWave = cleared;
    if (score > rec.bestScore) rec.bestScore = score;
    if (newRecord) {
      rec.recordAt = this.clock();
      rec.recordFighter = run.fighter;
    }
    rec.bestByFighter[run.fighter] = Math.max(rec.bestByFighter[run.fighter] ?? 0, cleared);
    const grant = this.career.grant(reward, run.fighter);
    // One attempt = one session for seasonal quests and tokens (never once per wave).
    let event: MatchEventOutcome | null = null;
    if (this.events && run.eventId && run.waves.length) event = this.events.applyMatch(run.eventId, this.aggregate(run, end), this.topDifficulty(run));
    this.store.save();
    return { run, end, cleared, score, lines, reward, newRecord, prevBestWave, prevBestScore, firstClear, grant, event };
  }

  /** The whole attempt as one match-like result (real combos and reactions summed). */
  aggregate(run: SurvivalRun, end: SurvivalEnd): MatchResultData {
    const w = run.waves;
    const last = w[w.length - 1];
    const sum = (k: 'combos' | 'perfects' | 'damageDealt' | 'damageTaken' | 'cardsUsed' | 'duration') => w.reduce((a, x) => a + x[k], 0);
    const ratings = w.map((x) => x.rating);
    const avg = ratings.length ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
    const comboList = w.flatMap((x) => x.comboList) as MatchResultData['comboList'];
    const best = comboList.find((c) => ULTRA.has(c)) ?? comboList[0] ?? null;
    return {
      outcome: end === 'complete' ? 'win' : 'loss',
      method: end === 'forfeit' || end === 'abandoned' ? 'forfeit' : last?.method === 'forfeit' ? 'forfeit' : (last?.method ?? 'time'),
      rating: avg,
      peakRating: Math.max(0, ...ratings),
      avgRating: avg,
      bestCombo: best,
      combos: sum('combos'),
      comboList,
      perfects: sum('perfects'),
      damageDealt: sum('damageDealt'),
      damageTaken: sum('damageTaken'),
      cardsUsed: sum('cardsUsed'),
      duration: sum('duration'),
      playerHpFrac: run.hpFrac,
      enemyHpFrac: 0,
      finisher: false,
    };
  }

  private topDifficulty(run: SurvivalRun): Difficulty {
    const i = Math.max(0, Math.min(SURVIVAL.waves.length - 1, run.waves.length - 1));
    return SURVIVAL.waves[i].difficulty;
  }

  // ------------------------------------------------------------ boss fight
  bossProgress(id: string): BossProgress {
    return this.store.data.modes.boss[id] ?? emptyBoss();
  }

  /** Fight rules of a boss: longer bout, longer intro, knockout only. */
  bossMods(def: BossDef): MatchMods {
    return { duration: def.duration, introTime: def.introTime, timeUpRule: 'rival' };
  }

  /** Count a finished boss fight; pays the first-win reward (money, fans, reputation, title) exactly once. */
  recordBoss(id: string, r: MatchResultData, fighter: FighterId): BossOutcome | null {
    const def = bossById(id);
    if (!def) return null;
    const all = this.store.data.modes.boss;
    const p = (all[id] ??= emptyBoss());
    const won = r.outcome === 'win' && r.method !== 'forfeit';
    const phase = Math.min(3, Math.max(1, r.bossPhase ?? 1));
    const bossHp = won ? 0 : Math.min(1, Math.max(0, r.enemyHpFrac));
    const time = Math.max(1, Math.ceil(r.duration));
    p.attempts++;
    p.bestPhase = Math.max(p.bestPhase, phase);
    let newBestTime = false;
    let newBestRating = false;
    let firstWin: BossOutcome['firstWin'] = null;
    let cosmeticNew = false;
    if (won) {
      p.wins++;
      p.winsByFighter[fighter] = (p.winsByFighter[fighter] ?? 0) + 1;
      if (p.bestTime === 0 || time < p.bestTime) {
        p.bestTime = time;
        p.bestFighter = fighter;
        newBestTime = true;
      }
      if (r.rating > p.bestRating) {
        p.bestRating = r.rating;
        newBestRating = true;
      }
      if (p.firstWinAt === 0) {
        p.firstWinAt = this.clock();
        const fw = def.rewards.firstWin;
        firstWin = { ...fw };
        this.career.grant({ money: fw.money, fans: fw.fans, rep: fw.rep }, fighter);
        cosmeticNew = this.grantCosmetic(fw.cosmetic, `boss-${def.id}`);
      }
    } else if (r.method !== 'forfeit') {
      p.bestBossHp = Math.min(p.bestBossHp, bossHp);
    }
    p.history.unshift({ at: this.clock(), fighter, won, time, rating: r.rating, phase, bossHp });
    if (p.history.length > 10) p.history.length = 10;
    this.store.save();
    return { def, won, phase, bossHp, firstWin, cosmeticNew, newBestTime, newBestRating, progress: { ...p, history: p.history.slice() } };
  }

  /** Add a cosmetic to the collection once; a newly obtained item is equipped right away (like event rewards). */
  private grantCosmetic(id: CosmeticId, source: string): boolean {
    const c = this.store.data.cosmetics;
    if (c.owned.includes(id)) return false;
    c.owned.push(id);
    c.history.push({ id, event: source, at: this.clock() });
    c.equipped[COSMETICS[id].slot] = id;
    return true;
  }

  // ------------------------------------------------------------ challenges
  progress(id: string): ChallengeProgress {
    return this.store.data.modes.challenges[id] ?? emptyChallenge();
  }

  challengeMods(def: ChallengeDef): MatchMods {
    return {
      duration: def.mods.duration,
      energyMult: def.mods.energyMult,
      rivalEnergyMult: def.mods.rivalEnergyMult,
    };
  }

  /** Count a finished challenge fight; pays the first-clear reward exactly once. */
  recordChallenge(id: string, r: MatchResultData, fighter: FighterId): ChallengeOutcome | null {
    const def = challengeById(id);
    if (!def) return null;
    const all = this.store.data.modes.challenges;
    const p = (all[id] ??= emptyChallenge());
    const { cleared, checks } = evaluateChallenge(def, r);
    p.attempts++;
    let firstClear: ChallengeOutcome['firstClear'] = null;
    let value: number | null = null;
    let newBest = false;
    if (cleared) {
      p.clears++;
      value = challengeValue(def, r);
      const better = p.best === 0 || (def.record === 'fastest' ? value < p.best : value > p.best);
      if (better) {
        newBest = true;
        p.best = value;
        p.bestAt = this.clock();
        p.bestFighter = fighter;
      }
      if (p.firstClearAt === 0) {
        p.firstClearAt = this.clock();
        firstClear = { ...def.firstClear };
        this.career.grant({ money: def.firstClear.money, fans: 0, rep: def.firstClear.rep }, fighter);
      }
    }
    this.store.save();
    return { def, cleared, checks, firstClear, value, newBest, progress: { ...p } };
  }
}
