import { isArenaId, type ArenaId, type ArenaPref } from '../config/arenas.config';
import { CAREER_STAGES, CAREER_START, GOALS, LEVEL_THRESHOLDS, type GoalId, type StageId } from '../config/career';
import { NEW_CARDS, UNIVERSAL_CARDS } from '../config/cards';
import { FIGHTERS, FIGHTER_ORDER, RIVAL_ORDER } from '../config/fighters';
import { COSMETICS, COSMETIC_SLOTS, isGameCosmeticId as isCosmeticId, type CosmeticId, type CosmeticSlot } from '../config/cosmetics.config';
import { isSkinId, SKINS, type SkinId } from '../config/shop.config';
import { PERK_ORDER, SURVIVAL, type PerkId } from '../config/modes.config';
import type { CardId, Difficulty, FighterId, RivalId } from '../config/types';
import { APP_VERSION } from '../config/version';
import { TabLock, randomId } from './TabLock';

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
  /** v12 (1.8): this fighter's current run of wins in career matches, and the longest one. */
  streak: number;
  bestStreak: number;
}

/**
 * v12 (1.8) — the producer's win streak over career matches (Classic Duel, Prime Challenge,
 * Boss Fight — exactly the matches that count as wins and losses; see CareerSystem.applyMatch).
 * Older saves keep every win and loss but start their streaks at 0: the order of past results
 * was never stored, so it is not invented. `since`: when tracking began for this career (ms).
 */
export interface StreakState {
  current: number;
  best: number;
  since: number;
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
  /** Device settings (never uploaded to PRIME CLOUD). headHp: the small HP bars over the fighters in a fight (off by default). */
  settings: { sound: boolean; music: boolean; quality: QualitySetting; camera: CameraMotion; headHp: boolean };
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
  /** v12 (1.8): the producer's win streak (fighters keep their own in FighterProgress). */
  streak: StreakState;
  /** 1.8.8 (PRIME SHOP): what the player chose to WEAR among PRIME SHOP items — never ownership. */
  shop: ShopState;
  /**
   * 1.8.9 DAILY PRIME STREAK: the last daily reward this save already holds (the claim's number for the account and
   * its game day) — written by the PRIME NETWORK server together with the dollars, so a reward is never applied
   * twice. Not the streak itself (that is the server's: GET /api/prime/daily). No save version bump.
   */
  daily: { claims: number; day: number };
}

/**
 * Alpha 1.8.8 — the wardrobe choices for PRIME SHOP items. Ownership is NOT here (paid items are
 * owned only through confirmed purchases — src/meta/entitlements.ts); a choice of an item the
 * player does not own is simply not shown. No save version bump: an older game drops the field.
 */
export interface ShopState {
  /** fighter → its skin (absent: the standard look). */
  skins: Partial<Record<FighterId, SkinId>>;
  /** slot → the PRIME SHOP item worn there (absent: the game's own item, if any). */
  equip: Partial<Record<CosmeticSlot, CosmeticId>>;
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
// v12 (1.8): win streaks (`streak`, `fighters[id].streak / bestStreak`).
// From 1.8 on, EVERY change to the saved data raises the version: the save system refuses to
// write over a save from a newer schema (it would drop the fields it does not know).
export const VERSION = 12;

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
      streak: 0,
      bestStreak: 0,
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
    settings: { sound: true, music: true, quality: 'auto', camera: 'full', headHp: false },
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
    streak: { current: 0, best: 0, since: Date.now() },
    shop: { skins: {}, equip: {} },
    daily: { claims: 0, day: 0 },
  };
}

/** 1.8.8: only known skins of the right fighter and PRIME SHOP items in their own slot survive. */
function sanitizeShop(raw: unknown): ShopState {
  const out: ShopState = { skins: {}, equip: {} };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { skins?: unknown; equip?: unknown };
  if (r.skins && typeof r.skins === 'object') {
    for (const [f, id] of Object.entries(r.skins as Record<string, unknown>)) if (isSkinId(id) && SKINS[id].fighter === f) out.skins[f as FighterId] = id;
  }
  if (r.equip && typeof r.equip === 'object') {
    for (const slot of COSMETIC_SLOTS) {
      const id = (r.equip as Record<string, unknown>)[slot];
      if (typeof id === 'string' && id in COSMETICS && COSMETICS[id as CosmeticId].paid && COSMETICS[id as CosmeticId].slot === slot) out.equip[slot] = id as CosmeticId;
    }
  }
  return out;
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
      // v12: streaks (absent before 1.8 -> 0: past streaks are not reconstructed from the totals)
      t.streak = count(f.streak);
      t.bestStreak = Math.max(t.streak, count(f.bestStreak));
      // (decks are checked below, once the bought cards are known)
    }
  }
  // 1.8.8: a seasonal star may stay selected without being opened in the save — opened by a PRIME SHOP
  // purchase (the server's rights, never the save); the game falls back to Ray while that is not confirmed
  if (typeof r.selected === 'string' && FIGHTER_ORDER.includes(r.selected as FighterId) && (d.fighters[r.selected as FighterId].unlocked || !!FIGHTERS[r.selected as FighterId].seasonal)) {
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
    // the HP bars over the fighters: off unless the player switched them on (absent before this setting)
    d.settings.headHp = bool(s.headHp, false);
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
  // 1.8.8: PRIME SHOP wardrobe choices (absent before -> standard looks, the game's own items)
  d.shop = sanitizeShop(r.shop);
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
  // v12: the producer's win streak (absent before 1.8 -> starts now at 0)
  if (r.streak && typeof r.streak === 'object') {
    const st = r.streak as Partial<StreakState>;
    d.streak.current = count(st.current);
    d.streak.best = Math.max(d.streak.current, count(st.best));
    const since = num(st.since, 0);
    if (since > 0) d.streak.since = since;
  }
  // 1.8.9: the daily reward the save holds (absent before 1.8.9 -> none)
  if (r.daily && typeof r.daily === 'object') {
    const dl = r.daily as Partial<SaveData['daily']>;
    d.daily = { claims: Math.min(1e6, count(dl.claims)), day: Math.min(1e7, count(dl.day)) };
  }
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

// ------------------------------------------------------------- local storage (Alpha 1.8)

/** Who a local save belongs to: the guest (1.8) or, from 1.8.1, a signed-in account. */
export type ProfileId = 'guest' | `user:${string}`;

/** The localStorage keys of one local profile. The guest keeps the historic key, so every existing career loads as before. */
export function profileKeys(profile: ProfileId): { save: string; backups: string; damaged: string; meta: string; lock: string; sync: string } {
  const base = profile === 'guest' ? KEY : `${KEY}:${profile}`;
  // 1.8.1: `sync` — the account's cloud bookkeeping (revision, hash, conflict), kept apart from the progress
  return { save: base, backups: `${base}:backups`, damaged: `${base}:damaged`, meta: `${base}:meta`, lock: `${base}:lock`, sync: `${base}:sync` };
}

/** One id per browser (diagnostics in exports; the device of a save in 1.8.1). Not a fingerprint. */
const DEVICE_KEY = 'primetime-showdown-device-v1';

/** The storage the save needs: window.localStorage, or an in-memory double in the checks. */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * How the stored save was found at launch:
 * - 'ok': loaded (or nothing stored yet — a new career);
 * - 'unavailable': the browser gives no storage (private mode, blocked): play without saving;
 * - 'damaged': the stored text is not a readable save — kept aside, NOTHING is written until the
 *   player chooses (restore a backup / start anew);
 * - 'newer': written by a newer version of the game — nothing is written (it would drop the
 *   fields this version does not know); the player is asked to update.
 */
export type SaveStatus = 'ok' | 'unavailable' | 'damaged' | 'newer';

/** A save in one line: backups, the import preview and (1.8.1) the choice between two versions. */
export interface SaveSummary {
  version: number;
  orgName: string;
  level: number;
  reputation: number;
  money: number;
  matches: number;
  wins: number;
  fighters: number;
}

/** 1.8.1: 'cloud' — before the account's cloud save replaced this copy; 'account' — before the guest career moved into an account. */
export type BackupReason = 'auto' | 'migration' | 'reset' | 'import' | 'restore' | 'cloud' | 'account';

/** One local safety copy: the save text exactly as it was stored. */
export interface SaveBackup {
  at: number;
  reason: BackupReason;
  app: string;
  summary: SaveSummary;
  raw: string;
}

/**
 * Bookkeeping beside the save (never inside it, so the save itself stays the player's data):
 * a local write counter and time — the base the cloud sync of 1.8.1 builds on.
 */
export interface SaveMeta {
  revision: number;
  savedAt: number;
  app: string;
  device: string;
}

/** Safety copies kept per profile (the oldest goes first). */
export const MAX_BACKUPS = 3;
/** A session that starts this long after the newest copy makes a fresh one first. */
const AUTO_BACKUP_MS = 20 * 3600 * 1000;
/** Marker of an exported save file. */
export const EXPORT_FORMAT = 'primetime-showdown-save';
const IMPORT_MAX_BYTES = 512 * 1024;
const KNOWN_FIELDS = new Set(Object.keys(defaultSave()));

/** The schema a stored object was written with (Alpha 1.0 saves say 1; nothing at all counts as 1). */
export function savedVersion(obj: Record<string, unknown>): number {
  const v = obj.version;
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
}

/** Top-level fields this version does not know (kept and written back unchanged). */
export function unknownFields(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (k !== 'version' && !KNOWN_FIELDS.has(k)) out[k] = v;
  return out;
}

export function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function summarize(d: SaveData, version: number): SaveSummary {
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) if (d.reputation >= LEVEL_THRESHOLDS[i]) level = i + 1;
  return {
    version,
    orgName: d.orgName,
    level,
    reputation: Math.floor(d.reputation),
    money: Math.floor(d.money),
    matches: d.matches,
    wins: d.wins,
    fighters: FIGHTER_ORDER.filter((id) => d.fighters[id].unlocked).length,
  };
}

/** What an import file would bring, checked before anything is replaced. */
export type ImportCheck =
  | { ok: true; data: SaveData; extra: Record<string, unknown>; version: number; summary: SaveSummary }
  | { ok: false; reason: string };

export interface SaveSystemOptions {
  /** Default: window.localStorage when the browser gives it; null = no storage at all. */
  storage?: SaveStorage | null;
  profile?: ProfileId;
  /** Default in a browser: a TabLock on this profile; null = no tab check (the headless checks). */
  lock?: TabLock | null;
  clock?: () => number;
  /**
   * 1.8.3: this page takes the profile from another tab of this browser instead of staying passive
   * (a PRIME ID account: the newly opened tab plays, the old one stops). The lock is taken BEFORE
   * the save is read, so the old tab's last write is either read here or refused there.
   */
  takeOverLock?: boolean;
}

function browserStorage(): SaveStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The local save (Alpha 1.8 SAVE FOUNDATION). Synchronous, as the whole game expects: the
 * career, events, collection and modes keep reading and changing `data` and call `save()`.
 * Around that:
 * - a profile layer (`profileKeys`): the guest keeps the historic key; accounts get their own
 *   slots in 1.8.1 without touching this class;
 * - a damaged save is kept aside and never overwritten automatically;
 * - a save from a newer schema is never written over; unknown top-level fields are kept;
 * - up to MAX_BACKUPS safety copies, made before anything replaces the save (migration to a
 *   new schema, reset, import, restore) and once a day at launch;
 * - one tab per profile (TabLock): a passive tab writes nothing;
 * - export / import as a JSON file, checked before it replaces anything.
 */
export class SaveSystem {
  data: SaveData;
  readonly profile: ProfileId;
  readonly keys: ReturnType<typeof profileKeys>;
  status: SaveStatus = 'ok';
  /** Schema the stored save was written with (0: nothing stored — a new career). */
  loadedVersion = 0;
  /** Another tab holds this profile: nothing is written here until this tab takes it over. */
  passive = false;
  /** Called when another tab takes the profile over while this one plays. */
  onLockLost: (() => void) | null = null;
  /** 1.8.1: called after every successful local write (the account sync notes the change). */
  onSaved: (() => void) | null = null;
  /** 1.8.1: the page is about to switch profile and reload — nothing more is written. */
  private suspended = false;
  meta: SaveMeta;
  readonly lock: TabLock | null;
  private available = true;
  private extra: Record<string, unknown> = {};
  private damagedRaw: string | null = null;
  private storage: SaveStorage | null;
  private clock: () => number;
  /** 1.8.3: the stored text as this page last read or wrote it. */
  private knownRaw: string | null = null;

  constructor(opts: SaveSystemOptions = {}) {
    this.profile = opts.profile ?? 'guest';
    this.keys = profileKeys(this.profile);
    this.storage = opts.storage === undefined ? browserStorage() : opts.storage;
    this.clock = opts.clock ?? (() => Date.now());
    this.lock = opts.lock === undefined ? (this.storage && typeof window !== 'undefined' ? new TabLock(this.storage, this.keys.lock, this.clock) : null) : opts.lock;
    // 1.8.3: an account tab opened now takes the profile first (the other tab stops writing), then reads
    const takeFirst = !!opts.takeOverLock && !!this.lock;
    if (takeFirst) this.lock!.takeOver();
    const loaded = this.load();
    this.data = loaded.data;
    this.knownRaw = loaded.stored;
    this.meta = this.loadMeta();
    // one tab per profile: a tab that finds another live tab on it stays passive
    if (this.lock && this.status !== 'unavailable') {
      if (!takeFirst && this.lock.acquire() === 'busy') {
        this.passive = true;
        this.lock.markLost();
      }
      this.lock.onLost = () => this.loseLock();
      this.lock.start();
    }
    // the copy before the first write in the new schema / the daily copy — only by the tab in charge
    if (loaded.raw !== null && !this.passive) {
      if (this.loadedVersion < VERSION) this.addBackup('migration', loaded.raw, loaded.data);
      else this.autoBackup(loaded.raw, loaded.data);
    }
  }

  /**
   * Read the stored save. `raw`: the text of a readable save of this or an older schema (for its
   * safety copy); `stored`: exactly what the storage held (1.8.3 storedChanged()).
   */
  private load(): { data: SaveData; raw: string | null; stored: string | null } {
    const st = this.storage;
    if (!st) {
      this.available = false;
      this.status = 'unavailable';
      return { data: defaultSave(), raw: null, stored: null };
    }
    let raw: string | null;
    try {
      raw = st.getItem(this.keys.save);
    } catch {
      this.available = false;
      this.status = 'unavailable';
      return { data: defaultSave(), raw: null, stored: null };
    }
    if (raw === null) return { data: defaultSave(), raw: null, stored: null };
    const obj = parseObject(raw);
    if (!obj) return { data: this.quarantine(raw), raw: null, stored: raw };
    const v = savedVersion(obj);
    this.loadedVersion = v;
    this.extra = unknownFields(obj);
    const data = sanitize(obj);
    if (v > VERSION) {
      // a newer game wrote this: show what we can, write nothing
      this.status = 'newer';
      return { data, raw: null, stored: raw };
    }
    return { data, raw, stored: raw };
  }

  /** The stored text is not a readable save: keep it aside (export / support) and write nothing. */
  private quarantine(raw: string): SaveData {
    this.status = 'damaged';
    this.damagedRaw = raw;
    try {
      const prev = this.storage!.getItem(this.keys.damaged);
      const prevRaw = prev ? (parseObject(prev)?.raw as string | undefined) : undefined;
      if (prevRaw !== raw) this.storage!.setItem(this.keys.damaged, JSON.stringify({ at: this.clock(), app: APP_VERSION, raw }));
    } catch {
      /* the original stays in its own key anyway: nothing is written over it */
    }
    return defaultSave();
  }

  private loadMeta(): SaveMeta {
    const meta: SaveMeta = { revision: 0, savedAt: 0, app: APP_VERSION, device: '' };
    const st = this.storage;
    if (!st) return { ...meta, device: randomId() };
    try {
      const m = parseObject(st.getItem(this.keys.meta) ?? '');
      if (m) {
        meta.revision = Math.max(0, Math.floor(num(m.revision, 0)));
        meta.savedAt = Math.max(0, num(m.savedAt, 0));
        if (typeof m.app === 'string') meta.app = m.app.slice(0, 32);
      }
      let device = st.getItem(DEVICE_KEY);
      if (!device) {
        device = randomId();
        st.setItem(DEVICE_KEY, device);
      }
      meta.device = device.slice(0, 64);
    } catch {
      meta.device = meta.device || randomId();
    }
    return meta;
  }

  /** Nothing blocks writing: the save is readable and of this schema, and this tab holds the profile. */
  get writable(): boolean {
    return this.status !== 'damaged' && this.status !== 'newer' && !this.passive && !this.suspended;
  }

  save(): void {
    if (!this.writable) return;
    // another tab may have taken the profile since the last write: never write over its progress
    if (this.lock && this.status !== 'unavailable' && !this.lock.owns()) {
      this.loseLock();
      return;
    }
    const st = this.storage;
    if (!st) return;
    try {
      const text = this.serialize();
      st.setItem(this.keys.save, text);
      this.knownRaw = text;
      this.available = true;
      if (this.status === 'unavailable') this.status = 'ok';
    } catch {
      this.available = false;
      return;
    }
    this.meta.revision++;
    this.meta.savedAt = this.clock();
    this.meta.app = APP_VERSION;
    try {
      st.setItem(this.keys.meta, JSON.stringify(this.meta));
    } catch {
      /* the save itself is written; the counter catches up next time */
    }
    this.onSaved?.();
  }

  /** 1.8.1: stop writing for good (the profile is switched and the page reloads next). */
  suspend(): void {
    this.suspended = true;
  }

  /**
   * 1.8.3: did another tab write this profile after this page read or last wrote it? (The tiny gap
   * between an account tab taking the profile over and the old tab noticing: if the old tab managed
   * one more write, this page reloads to read it rather than ever writing over it.)
   */
  storedChanged(): boolean {
    if (!this.storage || this.status === 'unavailable') return false;
    return this.readStored() !== this.knownRaw;
  }

  /** 1.8.1: the save text as it is written now (the account sync derives its cloud copy from it). */
  serialized(): string {
    return this.serialize();
  }

  get persistent(): boolean {
    return this.available;
  }

  /** The save text as it would be written now (unknown fields of a newer minor kept). */
  private serialize(): string {
    return JSON.stringify({ ...this.extra, ...this.data, version: VERSION });
  }

  private loseLock(): void {
    if (this.passive) return;
    this.passive = true;
    this.lock?.markLost();
    this.onLockLost?.();
  }

  /** «Играть здесь»: take the profile back from the other tab (the page reloads to read its latest save). */
  takeOver(): void {
    this.lock?.takeOver();
  }

  private readStored(): string | null {
    try {
      return this.storage?.getItem(this.keys.save) ?? null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- backups
  /** Safety copies of this profile, newest first. */
  backups(): SaveBackup[] {
    const list = this.storage ? parseList(this.readKey(this.keys.backups)) : [];
    return list.slice(0, MAX_BACKUPS);
  }

  private readKey(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  /** Keep a copy of this save text (a career with progress only; never the same text twice in a row). */
  private addBackup(reason: BackupReason, raw: string, data?: SaveData): void {
    if (!this.storage) return;
    const obj = parseObject(raw);
    const d = data ?? (obj ? sanitize(obj) : null);
    if (!obj || !d || !hasProgress(d)) return;
    const version = savedVersion(obj);
    const list = this.backups();
    if (list[0]?.raw === raw) return;
    list.unshift({ at: this.clock(), reason, app: APP_VERSION, summary: summarize(d, version), raw });
    list.length = Math.min(list.length, MAX_BACKUPS);
    try {
      this.storage.setItem(this.keys.backups, JSON.stringify(list));
    } catch {
      /* no room: the save itself is untouched */
    }
  }

  /** Once a day: the save as it was when this session began. */
  private autoBackup(raw: string, data: SaveData): void {
    const newest = this.backups()[0];
    if (!newest || this.clock() - newest.at >= AUTO_BACKUP_MS) this.addBackup('auto', raw, data);
  }

  /** Copy whatever is stored now before it is replaced. */
  private backupCurrent(reason: BackupReason): void {
    const raw = this.readStored();
    if (raw && this.status !== 'damaged') this.addBackup(reason, raw);
  }

  /**
   * Replace the progress with a copy (or an import). The device's own settings stay as they are
   * (after a damaged save the copy's settings come back, the current ones being defaults); what is
   * stored now is copied first. The caller reloads the page so every system reads it anew.
   */
  private replace(data: SaveData, extra: Record<string, unknown>, reason: BackupReason, keepGivenSettings = false): boolean {
    if (this.passive || this.suspended || this.status === 'newer') return false;
    this.backupCurrent(reason);
    // the device keeps its own settings — unless the save was unreadable (then they are only defaults)
    if (this.status !== 'damaged' && !keepGivenSettings) data.settings = { ...this.data.settings };
    this.data = data;
    this.extra = extra;
    this.status = this.available ? 'ok' : this.status;
    this.damagedRaw = null;
    this.save();
    return true;
  }

  /**
   * 1.8.1: replace the progress with a career that came from the account (the cloud save, or the
   * guest career moved into a new account). What is stored now becomes a safety copy first; the
   * device settings stay this device's own (or the given ones — the guest's, on the same device).
   */
  applyExternal(data: SaveData, extra: Record<string, unknown>, reason: 'cloud' | 'account', settings?: SaveData['settings']): boolean {
    if (settings) data.settings = { ...settings };
    return this.replace(data, extra, reason, !!settings);
  }

  /** 1.8.1: copy what is stored now into the local safety copies (before it leaves for an account). */
  backupNow(reason: BackupReason): void {
    this.backupCurrent(reason);
  }

  /** Put a safety copy back (by its time). */
  restoreBackup(at: number): boolean {
    const b = this.backups().find((x) => x.at === at);
    const obj = b ? parseObject(b.raw) : null;
    if (!b || !obj || savedVersion(obj) > VERSION) return false;
    return this.replace(sanitize(obj), unknownFields(obj), 'restore');
  }

  /** A damaged save: begin a new career (the damaged text stays in its own record for support). */
  startFresh(): boolean {
    if (this.status !== 'damaged' || this.passive) return false;
    this.status = 'ok';
    this.data = defaultSave();
    this.extra = {};
    this.save();
    return true;
  }

  /** The damaged text kept aside at launch (null when the save was fine). */
  get damaged(): string | null {
    return this.damagedRaw;
  }

  reset(): void {
    if (!this.writable) return;
    this.backupCurrent('reset');
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.extra = {};
    this.save();
  }

  // ---------------------------------------------------------- export / import
  /** The save as a JSON file for diagnostics and support (exactly what is stored, plus who made it). */
  exportJSON(): string {
    const stored = this.readStored();
    const obj = stored ? parseObject(stored) : null;
    return JSON.stringify(
      {
        format: EXPORT_FORMAT,
        exportedAt: new Date(this.clock()).toISOString(),
        app: APP_VERSION,
        schema: VERSION,
        profile: this.profile,
        status: this.status,
        meta: this.meta,
        save: obj ?? JSON.parse(this.serialize()),
        ...(this.damagedRaw !== null ? { damaged: this.damagedRaw } : {}),
      },
      null,
      2,
    );
  }

  /** Read an import file without touching anything: format, schema and contents. */
  checkImport(text: string): ImportCheck {
    if (text.length > IMPORT_MAX_BYTES) return { ok: false, reason: 'Файл слишком большой для сохранения игры.' };
    const top = parseObject(text);
    if (!top) return { ok: false, reason: 'Это не файл сохранения: не удалось прочитать JSON.' };
    const inner = top.format === EXPORT_FORMAT ? top.save : top;
    const obj = inner && typeof inner === 'object' && !Array.isArray(inner) ? (inner as Record<string, unknown>) : null;
    if (!obj || !('fighters' in obj) || !('money' in obj)) return { ok: false, reason: 'В файле нет сохранения PRIME TIME: SHOWDOWN.' };
    const version = savedVersion(obj);
    if (version > VERSION) return { ok: false, reason: `Сохранение из более новой версии игры (схема ${version}, эта версия понимает до ${VERSION}). Обновите игру и повторите.` };
    const data = sanitize(obj);
    return { ok: true, data, extra: unknownFields(obj), version, summary: summarize(data, version) };
  }

  /** Replace the progress with a checked import (the current progress becomes a safety copy). */
  applyImport(check: ImportCheck): boolean {
    if (!check.ok) return false;
    return this.replace(check.data, check.extra, 'import');
  }
}

function parseList(raw: string | null): SaveBackup[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: SaveBackup[] = [];
    for (const e of v) {
      const b = e as Partial<SaveBackup> | null;
      if (!b || typeof b.raw !== 'string' || typeof b.at !== 'number' || !b.summary || typeof b.summary !== 'object') continue;
      const reason: BackupReason = b.reason === 'migration' || b.reason === 'reset' || b.reason === 'import' || b.reason === 'restore' || b.reason === 'cloud' || b.reason === 'account' ? b.reason : 'auto';
      out.push({ at: b.at, reason, app: typeof b.app === 'string' ? b.app : '', summary: b.summary as SaveSummary, raw: b.raw });
    }
    return out;
  } catch {
    return [];
  }
}
