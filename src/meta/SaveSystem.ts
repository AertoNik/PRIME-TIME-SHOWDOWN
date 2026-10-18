import { isArenaId, type ArenaId, type ArenaPref } from '../config/arenas.config';
import { CAREER_STAGES, CAREER_START, GOALS, type GoalId, type StageId } from '../config/career';
import { NEW_CARDS, UNIVERSAL_CARDS } from '../config/cards';
import { FIGHTERS, FIGHTER_ORDER, RIVAL_ORDER } from '../config/fighters';
import { COSMETICS, COSMETIC_SLOTS, isCosmeticId, type CosmeticId, type CosmeticSlot } from '../config/cosmetics.config';
import { PERK_ORDER, SURVIVAL, type PerkId } from '../config/modes.config';
import type { CardId, Difficulty, FighterId, RivalId } from '../config/types';

export type QualitySetting = 'auto' | 'high' | 'medium' | 'low';
export type CameraMotion = 'full' | 'reduced' | 'off';

export interface FighterProgress {
  unlocked: boolean;
  fans: number;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  /**
   * v6 (1.3.3): wins in Classic Duel only (BOSS FIGHT access). `wins` also counts
   * Prime Challenge and boss wins.
   */
  classicWins: number;
  bestRating: number;
  deck: CardId[];
}

export interface GoalState {
  done: boolean;
  claimed: boolean;
}

/** Progress in one seasonal event (kept after the event ends). */
export interface EventProgress {
  /** Spendable seasonal currency. */
  tokens: number;
  /** Lifetime currency earned / spent in this event (history, never decreases). */
  earned: number;
  spent: number;
  /** Quest id -> counted progress and whether its reward was claimed. */
  quests: Record<string, { p: number; claimed: boolean }>;
  /** Cosmetics bought in the event shop. */
  bought: CosmeticId[];
  /** 1.7: seasonal stars opened in this event's exchange, and when (they stay in the roster for good). */
  fighters: { id: FighterId; at: number }[];
  grandClaimed: boolean;
  /** Daily cap bookkeeping for match tokens (local date key). */
  day: string;
  dayTokens: number;
}

export interface CosmeticsState {
  owned: CosmeticId[];
  equipped: Partial<Record<CosmeticSlot, CosmeticId>>;
  /** When and where each item was obtained (`fighter`: who earned a personal item). */
  history: { id: CosmeticId; event: string; at: number; fighter?: FighterId }[];
  /** v8 (1.5): items the player has already looked at in MY COLLECTION (the rest show "NEW"). */
  seen: CosmeticId[];
  /** v9 (1.5.5): personal items — the fighters who earned each one («Победитель легенды»). */
  personal: Partial<Record<CosmeticId, FighterId[]>>;
  /** v9: personal items each fighter wears, on top of the producer's common slots. */
  personalEquipped: Partial<Record<FighterId, Partial<Record<CosmeticSlot, CosmeticId>>>>;
  /** v9: personal items from older saves whose fighter cannot be told from the records — the player assigns them once. */
  unassigned: CosmeticId[];
}

/** One finished Survival wave (kept while the run is in progress). */
export interface WaveLog {
  rival: RivalId;
  outcome: 'win' | 'loss' | 'draw';
  method: 'ko' | 'time' | 'forfeit';
  rating: number;
  combos: number;
  comboList: string[];
  perfects: number;
  damageDealt: number;
  damageTaken: number;
  cardsUsed: number;
  duration: number;
}

/**
 * Survival attempt in progress. Written at the start and after every wave, so a
 * closed tab or reload cannot turn into a free retry or a second payout: on the
 * next launch the run is closed with the waves it really cleared.
 */
export interface SurvivalRun {
  id: number;
  fighter: FighterId;
  deck: CardId[];
  /** Planned opponents for waves 1..5. */
  rivals: RivalId[];
  /** Index of the next wave to fight (0-based). */
  wave: number;
  /** HP fraction the fighter brings into the next wave. */
  hpFrac: number;
  perks: Record<PerkId, number>;
  waves: WaveLog[];
  /** A wave was just won and the bonus is not picked yet. */
  pendingPerk: boolean;
  /** Seasonal event running when the attempt started (gets the result once). */
  eventId: string | null;
  startedAt: number;
  /** v7 (1.4): the studio set chosen at the start; every wave is broadcast from it. */
  arena: ArenaId;
}

export interface SurvivalRecords {
  runs: number;
  completions: number;
  /** Most waves cleared in one attempt (0..5). */
  bestWave: number;
  /** Best show score: sum of the cleared waves' ratings. */
  bestScore: number;
  /** When the last record was set (ms, 0 = never). */
  recordAt: number;
  recordFighter: FighterId | null;
  bestByFighter: Partial<Record<FighterId, number>>;
  /** The one-time first-clear bonus has been paid. */
  firstClearPaid: boolean;
  active: SurvivalRun | null;
}

export interface ChallengeProgress {
  attempts: number;
  clears: number;
  /** When the challenge was first cleared (0 = never). The first-clear reward is paid together with this flag. */
  firstClearAt: number;
  /** Personal best (combos / fastest seconds / rating), 0 = none. */
  best: number;
  bestAt: number;
  bestFighter: FighterId | null;
}

/** One BOSS FIGHT attempt, kept as a short history. */
export interface BossHistoryEntry {
  at: number;
  fighter: FighterId;
  won: boolean;
  /** Fight time in seconds. */
  time: number;
  rating: number;
  /** Highest phase the champion reached (1..3). */
  phase: number;
  /** Champion's health left at the end (0 on a win). */
  bossHp: number;
}

export interface BossProgress {
  attempts: number;
  wins: number;
  /** When the champion was first defeated (0 = never). The first-win reward is paid together with this flag. */
  firstWinAt: number;
  /** Fastest win in seconds (0 = none). */
  bestTime: number;
  /** Best show rating in a win (0 = none). */
  bestRating: number;
  /** Highest phase ever reached (1..3). */
  bestPhase: number;
  /** Lowest health the champion was left with in a lost fight (1 = never hurt). */
  bestBossHp: number;
  bestFighter: FighterId | null;
  winsByFighter: Partial<Record<FighterId, number>>;
  /** Most recent attempts first (max 10). */
  history: BossHistoryEntry[];
}

export interface ModesState {
  survival: SurvivalRecords;
  challenges: Record<string, ChallengeProgress>;
  /** v5 (1.3.1): BOSS FIGHT progress per boss id. */
  boss: Record<string, BossProgress>;
}

export interface SaveData {
  version: number;
  orgName: string;
  money: number;
  reputation: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  bestRating: number;
  totalEarned: number;
  fansEarned: number;
  bestCombosInMatch: number;
  bestPerfectsInMatch: number;
  proWins: number;
  championWins: number;
  fighters: Record<FighterId, FighterProgress>;
  selected: FighterId;
  difficulty: Difficulty;
  goals: Record<GoalId, GoalState>;
  settings: { sound: boolean; music: boolean; quality: QualitySetting; camera: CameraMotion };
  nextRival: RivalId;
  lastRival: RivalId | null;
  seed: number;
  hintsSeen: boolean;
  events: Record<string, EventProgress>;
  cosmetics: CosmeticsState;
  /** v4 (1.3): Survival records and Prime Challenge progress. */
  modes: ModesState;
  /** v7 (1.4): preferred studio set (an arena id or 'random'). */
  arena: ArenaPref;
  /** v8 (1.5): career stages whose reward has been paid (each once). */
  careerClaimed: StageId[];
  /** v10 (1.6): the new universal cards bought in the career (each once, kept for good). */
  cards: CardsState;
  /** 1.6.5: FIRST BROADCAST, the first-run tutorial (see TutorialState). */
  tutorial: TutorialState;
}

/**
 * 1.6.5 — FIRST BROADCAST. 'pending': a new player, the tutorial starts after the first tap;
 * 'done' / 'skipped': played through or skipped (never forced again; replay from the settings);
 * 'veteran': a save from before 1.6.5 with real progress — never forced into the tutorial.
 */
export type TutorialState = 'pending' | 'done' | 'skipped' | 'veteran';

/** v10 (1.6): bought cards. Only the fifteen shop cards can be in here. */
export interface CardsState {
  owned: CardId[];
}

// The key never changes between versions so existing careers keep loading;
// `version` records the schema and sanitize() fills anything missing.
const KEY = 'primetime-showdown-save-v1';
// v2 (1.1): settings.camera. v3 (1.2): events + cosmetics. v4 (1.3): game modes. v5 (1.3.1): boss fight.
// v6 (1.3.3): per-fighter Classic Duel wins (BOSS FIGHT access). v7 (1.4): arena preference.
// v8 (1.5): new fighters (filled from defaults), MY COLLECTION "seen" marks, claimed career stages.
// v9 (1.5.5): personal rewards per fighter (cosmetics.personal / personalEquipped / unassigned).
// v10 (1.6): bought cards (cards.owned); decks may hold them. Older saves own none.
// v11 (1.6.1): SIDE CAM was replaced by SECOND TAKE — a bought SIDE CAM becomes SECOND TAKE and decks swap it in place.
// 1.6.5: `tutorial` (FIRST BROADCAST) — no version bump: a save without it predates the tutorial and is
// judged by its progress (see hasProgress), so existing players are never sent through it.
// 1.7: LUCIEN — no version bump either: `fighters.lucien` is filled from the defaults (locked, like the
// v8 newcomers) and `events[id].fighters` (stars opened in an event's exchange) is simply absent before.
const VERSION = 11;

/** Cards renamed or replaced between versions (old id → new id). */
const RENAMED: Record<string, CardId> = { side_cam: 'second_take' };
const renamed = (c: unknown): unknown => (typeof c === 'string' && RENAMED[c] ? RENAMED[c] : c);

export function defaultSave(): SaveData {
  const fighters = {} as Record<FighterId, FighterProgress>;
  for (const id of FIGHTER_ORDER) {
    const f = FIGHTERS[id];
    fighters[id] = {
      // (1.7: a seasonal star has no contract either, but it is opened in its event's exchange)
      unlocked: f.contract === null && !f.seasonal,
      fans: f.startFans,
      wins: 0,
      losses: 0,
      draws: 0,
      matches: 0,
      classicWins: 0,
      bestRating: 0,
      deck: f.defaultDeck.slice(),
    };
  }
  const goals = {} as Record<GoalId, GoalState>;
  for (const g of GOALS) goals[g.id] = { done: false, claimed: false };
  return {
    version: VERSION,
    orgName: CAREER_START.orgName,
    money: CAREER_START.money,
    reputation: CAREER_START.reputation,
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    bestRating: 0,
    totalEarned: 0,
    fansEarned: 0,
    bestCombosInMatch: 0,
    bestPerfectsInMatch: 0,
    proWins: 0,
    championWins: 0,
    fighters,
    selected: 'ray',
    difficulty: 'rookie',
    goals,
    settings: { sound: true, music: true, quality: 'auto', camera: 'full' },
    nextRival: 'dex',
    lastRival: null,
    seed: Math.floor(Math.random() * 1e9),
    hintsSeen: false,
    events: {},
    cosmetics: { owned: [], equipped: {}, history: [], seen: [], personal: {}, personalEquipped: {}, unassigned: [] },
    modes: emptyModes(),
    arena: 'original',
    careerClaimed: [],
    cards: { owned: [] },
    tutorial: 'pending',
  };
}

export function emptySurvival(): SurvivalRecords {
  return { runs: 0, completions: 0, bestWave: 0, bestScore: 0, recordAt: 0, recordFighter: null, bestByFighter: {}, firstClearPaid: false, active: null };
}

export function emptyModes(): ModesState {
  return { survival: emptySurvival(), challenges: {}, boss: {} };
}

export function emptyBoss(): BossProgress {
  return { attempts: 0, wins: 0, firstWinAt: 0, bestTime: 0, bestRating: 0, bestPhase: 0, bestBossHp: 1, bestFighter: null, winsByFighter: {}, history: [] };
}

export function emptyChallenge(): ChallengeProgress {
  return { attempts: 0, clears: 0, firstClearAt: 0, best: 0, bestAt: 0, bestFighter: null };
}

export function emptyPerks(): Record<PerkId, number> {
  return { second_wind: 0, energy_boost: 0, power_surge: 0 };
}

export function emptyEventProgress(): EventProgress {
  return { tokens: 0, earned: 0, spent: 0, quests: {}, bought: [], fighters: [], grandClaimed: false, day: '', dayTokens: 0 };
}

function sanitizeEvents(raw: unknown): Record<string, EventProgress> {
  const out: Record<string, EventProgress> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || id.length > 64) continue;
    const e = v as Partial<EventProgress>;
    const p = emptyEventProgress();
    p.tokens = Math.max(0, Math.floor(num(e.tokens, 0)));
    p.earned = Math.max(0, Math.floor(num(e.earned, 0)));
    p.spent = Math.max(0, Math.floor(num(e.spent, 0)));
    if (e.quests && typeof e.quests === 'object') {
      for (const [q, st] of Object.entries(e.quests as Record<string, { p?: unknown; claimed?: unknown }>)) {
        if (!st || typeof st !== 'object') continue;
        p.quests[q] = { p: Math.max(0, num(st.p, 0)), claimed: bool(st.claimed, false) };
      }
    }
    if (Array.isArray(e.bought)) p.bought = [...new Set(e.bought.filter(isCosmeticId))];
    // 1.7: seasonal stars opened here (absent before 1.7 -> none)
    if (Array.isArray(e.fighters)) {
      for (const f of e.fighters as unknown[]) {
        const r = f as { id?: unknown; at?: unknown } | null;
        if (r && isFighter(r.id) && FIGHTERS[r.id].seasonal && !p.fighters.some((x) => x.id === r.id)) p.fighters.push({ id: r.id, at: Math.max(0, num(r.at, 0)) });
      }
    }
    p.grandClaimed = bool(e.grandClaimed, false);
    p.day = typeof e.day === 'string' ? e.day.slice(0, 16) : '';
    p.dayTokens = Math.max(0, num(e.dayTokens, 0));
    out[id] = p;
  }
  return out;
}

/**
 * Which fighters earned a personal item, read from the records an older save already keeps
 * (v9 migration). «Победитель легенды»: every fighter with a win over the champion
 * (`winsByFighter`, kept since 1.3.1, and the fight history). Empty = cannot be told.
 */
function personalOwnersFromRecords(id: CosmeticId, modes: ModesState): FighterId[] {
  const out: FighterId[] = [];
  if (id === 'title_prime_legend') {
    const b = modes.boss.vale;
    if (b) {
      for (const f of FIGHTER_ORDER) if ((b.winsByFighter[f] ?? 0) > 0) out.push(f);
      for (const h of b.history) if (h.won && !out.includes(h.fighter)) out.push(h.fighter);
    }
  }
  return out;
}

function sanitizeCosmetics(raw: unknown, modes: ModesState): CosmeticsState {
  const c: CosmeticsState = { owned: [], equipped: {}, history: [], seen: [], personal: {}, personalEquipped: {}, unassigned: [] };
  if (!raw || typeof raw !== 'object') return c;
  const r = raw as Partial<CosmeticsState>;
  if (Array.isArray(r.owned)) c.owned = [...new Set(r.owned.filter(isCosmeticId))];
  if (r.equipped && typeof r.equipped === 'object') {
    for (const slot of COSMETIC_SLOTS) {
      const id = (r.equipped as Record<string, unknown>)[slot];
      // only items the player actually owns can be equipped
      if (isCosmeticId(id) && c.owned.includes(id)) c.equipped[slot] = id;
    }
  }
  if (Array.isArray(r.history)) {
    for (const h of r.history) {
      if (h && typeof h === 'object' && isCosmeticId(h.id)) {
        const e: CosmeticsState['history'][number] = { id: h.id, event: String(h.event ?? '').slice(0, 64), at: num(h.at, 0) };
        if (isFighter(h.fighter)) e.fighter = h.fighter;
        c.history.push(e);
      }
    }
  }
  // v8: items owned before MY COLLECTION existed are not flagged as new
  c.seen = Array.isArray(r.seen) ? [...new Set(r.seen.filter((id): id is CosmeticId => isCosmeticId(id) && c.owned.includes(id)))] : c.owned.slice();
  // v9: personal items belong to the fighters who earned them
  const legacy = !r.personal || typeof r.personal !== 'object';
  for (const id of c.owned) {
    if (!COSMETICS[id].personal) continue;
    const slot = COSMETICS[id].slot;
    let owners: FighterId[];
    if (legacy) {
      // older save: bind the item to the fighters the records name — never to everyone
      owners = personalOwnersFromRecords(id, modes);
      if (!owners.length) c.unassigned.push(id);
      else if (c.equipped[slot] === id) {
        // it was worn before: each fighter who really earned it keeps wearing it
        for (const f of owners) (c.personalEquipped[f] ??= {})[slot] = id;
      }
    } else {
      const list = (r.personal as Record<string, unknown>)[id];
      owners = Array.isArray(list) ? [...new Set(list.filter(isFighter))] : [];
      // owned but bound to nobody (unassigned legacy item, or damaged data): the player picks the fighter once
      if (!owners.length) c.unassigned.push(id);
    }
    if (owners.length) c.personal[id] = owners;
    // a personal item is never a common slot item (it would show on every fighter)
    if (c.equipped[slot] === id) delete c.equipped[slot];
  }
  if (!legacy && r.personalEquipped && typeof r.personalEquipped === 'object') {
    for (const f of FIGHTER_ORDER) {
      const worn: unknown = (r.personalEquipped as Record<string, unknown>)[f];
      if (!worn || typeof worn !== 'object') continue;
      for (const slot of COSMETIC_SLOTS) {
        const id = (worn as Record<string, unknown>)[slot];
        // only a fighter who earned the item can wear it
        if (isCosmeticId(id) && COSMETICS[id].slot === slot && c.personal[id]?.includes(f)) (c.personalEquipped[f] ??= {})[slot] = id;
      }
    }
  }
  return c;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const count = (v: unknown) => Math.max(0, Math.floor(num(v, 0)));
const isFighter = (v: unknown): v is FighterId => typeof v === 'string' && FIGHTER_ORDER.includes(v as FighterId);
const isRival = (v: unknown): v is RivalId => typeof v === 'string' && RIVAL_ORDER.includes(v as RivalId);

function sanitizeWave(raw: unknown): WaveLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Partial<WaveLog>;
  if (!isRival(w.rival)) return null;
  const outcome = w.outcome === 'win' || w.outcome === 'loss' || w.outcome === 'draw' ? w.outcome : 'loss';
  const method = w.method === 'ko' || w.method === 'time' || w.method === 'forfeit' ? w.method : 'time';
  return {
    rival: w.rival,
    outcome,
    method,
    rating: Math.min(100, count(w.rating)),
    combos: count(w.combos),
    comboList: Array.isArray(w.comboList) ? w.comboList.filter((c) => typeof c === 'string').slice(0, 40) : [],
    perfects: count(w.perfects),
    damageDealt: count(w.damageDealt),
    damageTaken: count(w.damageTaken),
    cardsUsed: count(w.cardsUsed),
    duration: Math.max(0, num(w.duration, 0)),
  };
}

function sanitizeRun(raw: unknown, owned: readonly CardId[]): SurvivalRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<SurvivalRun>;
  if (!isFighter(r.fighter) || !Array.isArray(r.rivals)) return null;
  const rivals = r.rivals.filter(isRival);
  if (rivals.length !== SURVIVAL.waves.length) return null;
  const perks = emptyPerks();
  if (r.perks && typeof r.perks === 'object') {
    for (const id of PERK_ORDER) perks[id] = count((r.perks as Record<string, unknown>)[id]);
  }
  const waves = Array.isArray(r.waves) ? r.waves.map(sanitizeWave).filter((w): w is WaveLog => !!w).slice(0, SURVIVAL.waves.length) : [];
  return {
    id: num(r.id, 0),
    fighter: r.fighter,
    deck: validDeck(r.fighter, r.deck, owned),
    rivals,
    wave: Math.min(SURVIVAL.waves.length, count(r.wave)),
    hpFrac: Math.min(1, Math.max(0, num(r.hpFrac, 1))),
    perks,
    waves,
    pendingPerk: bool(r.pendingPerk, false),
    eventId: typeof r.eventId === 'string' ? r.eventId.slice(0, 64) : null,
    startedAt: num(r.startedAt, 0),
    // v7: runs started before 1.4 were broadcast from the original studio
    arena: isArenaId(r.arena) ? r.arena : 'original',
  };
}

function sanitizeModes(raw: unknown, owned: readonly CardId[]): ModesState {
  const m = emptyModes();
  if (!raw || typeof raw !== 'object') return m;
  const r = raw as Partial<ModesState>;
  if (r.survival && typeof r.survival === 'object') {
    const s = r.survival as Partial<SurvivalRecords>;
    const t = m.survival;
    t.runs = count(s.runs);
    t.completions = count(s.completions);
    t.bestWave = Math.min(SURVIVAL.waves.length, count(s.bestWave));
    t.bestScore = Math.min(SURVIVAL.waves.length * 100, count(s.bestScore));
    t.recordAt = Math.max(0, num(s.recordAt, 0));
    t.recordFighter = isFighter(s.recordFighter) ? s.recordFighter : null;
    if (s.bestByFighter && typeof s.bestByFighter === 'object') {
      for (const id of FIGHTER_ORDER) {
        const v = (s.bestByFighter as Record<string, unknown>)[id];
        if (v !== undefined) t.bestByFighter[id] = Math.min(SURVIVAL.waves.length, count(v));
      }
    }
    t.firstClearPaid = bool(s.firstClearPaid, false);
    t.active = sanitizeRun(s.active, owned);
  }
  if (r.challenges && typeof r.challenges === 'object') {
    for (const [id, v] of Object.entries(r.challenges as Record<string, unknown>)) {
      if (!v || typeof v !== 'object' || id.length > 48) continue;
      const c = v as Partial<ChallengeProgress>;
      const p = emptyChallenge();
      p.clears = count(c.clears);
      p.attempts = Math.max(p.clears, count(c.attempts));
      p.firstClearAt = Math.max(0, num(c.firstClearAt, 0));
      p.best = Math.max(0, num(c.best, 0));
      p.bestAt = Math.max(0, num(c.bestAt, 0));
      p.bestFighter = isFighter(c.bestFighter) ? c.bestFighter : null;
      m.challenges[id] = p;
    }
  }
  if (r.boss && typeof r.boss === 'object') {
    for (const [id, v] of Object.entries(r.boss as Record<string, unknown>)) {
      if (!v || typeof v !== 'object' || id.length > 48) continue;
      const b = v as Partial<BossProgress>;
      const p = emptyBoss();
      p.wins = count(b.wins);
      p.attempts = Math.max(p.wins, count(b.attempts));
      p.firstWinAt = Math.max(0, num(b.firstWinAt, 0));
      p.bestTime = Math.max(0, num(b.bestTime, 0));
      p.bestRating = Math.min(100, count(b.bestRating));
      p.bestPhase = Math.min(3, count(b.bestPhase));
      p.bestBossHp = Math.min(1, Math.max(0, num(b.bestBossHp, 1)));
      p.bestFighter = isFighter(b.bestFighter) ? b.bestFighter : null;
      if (b.winsByFighter && typeof b.winsByFighter === 'object') {
        for (const f of FIGHTER_ORDER) {
          const n = (b.winsByFighter as Record<string, unknown>)[f];
          if (n !== undefined) p.winsByFighter[f] = count(n);
        }
      }
      if (Array.isArray(b.history)) {
        for (const h of b.history.slice(0, 10)) {
          if (!h || typeof h !== 'object' || !isFighter(h.fighter)) continue;
          p.history.push({
            at: Math.max(0, num(h.at, 0)),
            fighter: h.fighter,
            won: bool(h.won, false),
            time: Math.max(0, num(h.time, 0)),
            rating: Math.min(100, count(h.rating)),
            phase: Math.min(3, Math.max(1, count(h.phase))),
            bossHp: Math.min(1, Math.max(0, num(h.bossHp, 1))),
          });
        }
      }
      m.boss[id] = p;
    }
  }
  return m;
}

/**
 * A deck this fighter may take into a fight: four different cards from the basic six, the
 * fighter's own signature and (v10) the shop cards the producer bought. Anything else —
 * another fighter's signature, an unknown id, a card that was never bought — resets the
 * deck to the fighter's default rather than playing with a broken one.
 */
export function validDeck(id: FighterId, deck: unknown, owned: readonly CardId[] = []): CardId[] {
  const allowed = new Set<CardId>([...UNIVERSAL_CARDS, FIGHTERS[id].signature, ...owned]);
  if (!Array.isArray(deck)) return FIGHTERS[id].defaultDeck.slice();
  const out: CardId[] = [];
  // v11: a replaced card keeps its slot under its new id
  for (const raw of deck) {
    const c = renamed(raw) as CardId;
    if (allowed.has(c) && !out.includes(c)) out.push(c);
  }
  if (out.length !== 4) return FIGHTERS[id].defaultDeck.slice();
  return out;
}

/** v10: the bought cards — shop cards only, each once, in the shop order. */
function sanitizeCards(raw: unknown): CardsState {
  const out: CardsState = { owned: [] };
  if (!raw || typeof raw !== 'object') return out;
  const owned = (raw as Partial<CardsState>).owned;
  if (!Array.isArray(owned)) return out;
  // v11: SIDE CAM bought in 1.6 counts as SECOND TAKE (no second purchase, no money lost)
  const set = new Set(owned.map(renamed).filter((c): c is CardId => typeof c === 'string'));
  out.owned = NEW_CARDS.filter((c) => set.has(c));
  return out;
}

/** Merge a parsed save onto defaults so old/corrupt data can never crash the game. */
export function sanitize(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData> & Record<string, unknown>;
  d.orgName = typeof r.orgName === 'string' && r.orgName.trim() ? r.orgName.slice(0, 28) : d.orgName;
  d.money = Math.max(0, num(r.money, d.money));
  d.reputation = Math.max(0, num(r.reputation, d.reputation));
  for (const k of ['matches', 'wins', 'losses', 'draws', 'bestRating', 'totalEarned', 'fansEarned', 'bestCombosInMatch', 'bestPerfectsInMatch', 'proWins', 'championWins'] as const) {
    d[k] = Math.max(0, num(r[k], d[k]));
  }
  if (r.fighters && typeof r.fighters === 'object') {
    for (const id of FIGHTER_ORDER) {
      const f = (r.fighters as Record<string, Partial<FighterProgress>>)[id];
      if (!f) continue;
      const t = d.fighters[id];
      t.unlocked = id === 'ray' ? true : bool(f.unlocked, t.unlocked);
      t.fans = Math.max(0, num(f.fans, t.fans));
      t.wins = Math.max(0, num(f.wins, 0));
      t.losses = Math.max(0, num(f.losses, 0));
      t.draws = Math.max(0, num(f.draws, 0));
      t.matches = Math.max(0, num(f.matches, 0));
      t.bestRating = Math.max(0, num(f.bestRating, 0));
      // (decks are checked below, once the bought cards are known)
    }
  }
  if (typeof r.selected === 'string' && FIGHTER_ORDER.includes(r.selected as FighterId) && d.fighters[r.selected as FighterId].unlocked) {
    d.selected = r.selected as FighterId;
  }
  if (r.difficulty === 'rookie' || r.difficulty === 'pro' || r.difficulty === 'champion') d.difficulty = r.difficulty;
  if (r.goals && typeof r.goals === 'object') {
    for (const g of GOALS) {
      const s = (r.goals as Record<string, Partial<GoalState>>)[g.id];
      if (s) d.goals[g.id] = { done: bool(s.done, false), claimed: bool(s.claimed, false) };
    }
  }
  if (r.settings && typeof r.settings === 'object') {
    const s = r.settings as Partial<SaveData['settings']>;
    d.settings.sound = bool(s.sound, true);
    d.settings.music = bool(s.music, true);
    if (s.quality === 'auto' || s.quality === 'high' || s.quality === 'medium' || s.quality === 'low') d.settings.quality = s.quality;
    // v2: camera motion intensity (absent in Alpha 1.0 saves -> 'full')
    if (s.camera === 'full' || s.camera === 'reduced' || s.camera === 'off') d.settings.camera = s.camera;
  }
  if (typeof r.nextRival === 'string' && RIVAL_ORDER.includes(r.nextRival as RivalId)) d.nextRival = r.nextRival as RivalId;
  if (typeof r.lastRival === 'string' && RIVAL_ORDER.includes(r.lastRival as RivalId)) d.lastRival = r.lastRival as RivalId;
  d.seed = num(r.seed, d.seed);
  d.hintsSeen = bool(r.hintsSeen, false);
  // v10: bought cards (absent before 1.6 -> none); read before the decks below are re-checked
  d.cards = sanitizeCards(r.cards);
  if (r.fighters && typeof r.fighters === 'object') {
    for (const id of FIGHTER_ORDER) {
      const f = (r.fighters as Record<string, Partial<FighterProgress>>)[id];
      if (f) d.fighters[id].deck = validDeck(id, f.deck, d.cards.owned);
    }
  }
  // v3: seasonal progress and cosmetics (absent before Alpha 1.2 -> empty)
  d.events = sanitizeEvents(r.events);
  // v4: game modes (absent before Alpha 1.3 -> empty records)
  d.modes = sanitizeModes(r.modes, d.cards.owned);
  // (cosmetics after the mode records: the v9 migration reads who beat the champion)
  d.cosmetics = sanitizeCosmetics(r.cosmetics, d.modes);
  // v8: claimed career stages (absent before 1.5 -> none claimed; reaching them is read from the counters)
  if (Array.isArray(r.careerClaimed)) {
    const ids = new Set(CAREER_STAGES.map((st) => st.id));
    d.careerClaimed = [...new Set((r.careerClaimed as unknown[]).filter((x): x is StageId => typeof x === 'string' && ids.has(x as StageId)))];
  }
  // v7: arena preference by id (absent before 1.4 -> the original studio). Whether a
  // seasonal set is still open is checked by the game against the running season.
  d.arena = r.arena === 'random' || isArenaId(r.arena) ? r.arena : 'original';
  // v6: Classic Duel wins per fighter. Older saves did not keep them apart, so they are
  // estimated as all of the fighter's wins minus their BOSS FIGHT wins (before 1.3 every
  // win was a Classic one; Prime Challenge wins from 1.3–1.3.2 cannot be told apart and count).
  if (r.fighters && typeof r.fighters === 'object') {
    for (const id of FIGHTER_ORDER) {
      const f = (r.fighters as Record<string, Partial<FighterProgress>>)[id];
      if (!f) continue;
      const t = d.fighters[id];
      if (typeof f.classicWins === 'number' && Number.isFinite(f.classicWins)) t.classicWins = Math.min(t.wins, count(f.classicWins));
      else {
        let bossWins = 0;
        for (const b of Object.values(d.modes.boss)) bossWins += b.winsByFighter[id] ?? 0;
        t.classicWins = Math.max(0, Math.floor(t.wins) - bossWins);
      }
    }
  }
  // 1.6.5: FIRST BROADCAST. A save without the flag is from before the tutorial existed: a
  // career with any progress is a veteran (never forced into it); an untouched one is new.
  // (The missing flag alone proves nothing — every older save lacks it.)
  if (r.tutorial === 'pending' || r.tutorial === 'done' || r.tutorial === 'skipped' || r.tutorial === 'veteran') d.tutorial = r.tutorial;
  else d.tutorial = hasProgress(d) ? 'veteran' : 'pending';
  return d;
}

/**
 * 1.6.5: has this career been played? Any match, money or reputation that moved, a hint seen
 * after a fight, a signed fighter, a bought card or item, a claimed stage, a mode record.
 */
export function hasProgress(d: SaveData): boolean {
  if (d.matches > 0 || d.wins > 0 || d.totalEarned > 0 || d.fansEarned > 0 || d.reputation > 0 || d.money !== CAREER_START.money || d.hintsSeen) return true;
  if (FIGHTER_ORDER.some((id) => d.fighters[id].matches > 0 || (d.fighters[id].unlocked && (FIGHTERS[id].contract !== null || !!FIGHTERS[id].seasonal)))) return true;
  if (d.cards.owned.length > 0 || d.cosmetics.owned.length > 0 || d.careerClaimed.length > 0) return true;
  return JSON.stringify(d.modes) !== JSON.stringify(emptyModes());
}

/** localStorage persistence. All access is guarded (private mode, quota, disabled storage). */
export class SaveSystem {
  data: SaveData;
  private available = true;

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return defaultSave();
      return sanitize(JSON.parse(raw));
    } catch {
      this.available = false;
      return defaultSave();
    }
  }

  save(): void {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.data));
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  get persistent(): boolean {
    return this.available;
  }

  reset(): void {
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.save();
  }
}
