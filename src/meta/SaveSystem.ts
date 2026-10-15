import { CAREER_START, GOALS, type GoalId } from '../config/career';
import { UNIVERSAL_CARDS } from '../config/cards';
import { FIGHTERS, FIGHTER_ORDER, RIVAL_ORDER } from '../config/fighters';
import { COSMETIC_SLOTS, isCosmeticId, type CosmeticId, type CosmeticSlot } from '../config/cosmetics.config';
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
  grandClaimed: boolean;
  /** Daily cap bookkeeping for match tokens (local date key). */
  day: string;
  dayTokens: number;
}

export interface CosmeticsState {
  owned: CosmeticId[];
  equipped: Partial<Record<CosmeticSlot, CosmeticId>>;
  /** When and where each item was obtained. */
  history: { id: CosmeticId; event: string; at: number }[];
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
}

// The key never changes between versions so existing careers keep loading;
// `version` records the schema and sanitize() fills anything missing.
const KEY = 'primetime-showdown-save-v1';
// v2 (1.1): settings.camera. v3 (1.2): events + cosmetics.
const VERSION = 3;

export function defaultSave(): SaveData {
  const fighters = {} as Record<FighterId, FighterProgress>;
  for (const id of FIGHTER_ORDER) {
    const f = FIGHTERS[id];
    fighters[id] = {
      unlocked: f.contract === null,
      fans: f.startFans,
      wins: 0,
      losses: 0,
      draws: 0,
      matches: 0,
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
    cosmetics: { owned: [], equipped: {}, history: [] },
  };
}

export function emptyEventProgress(): EventProgress {
  return { tokens: 0, earned: 0, spent: 0, quests: {}, bought: [], grandClaimed: false, day: '', dayTokens: 0 };
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
    p.grandClaimed = bool(e.grandClaimed, false);
    p.day = typeof e.day === 'string' ? e.day.slice(0, 16) : '';
    p.dayTokens = Math.max(0, num(e.dayTokens, 0));
    out[id] = p;
  }
  return out;
}

function sanitizeCosmetics(raw: unknown): CosmeticsState {
  const c: CosmeticsState = { owned: [], equipped: {}, history: [] };
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
      if (h && typeof h === 'object' && isCosmeticId(h.id)) c.history.push({ id: h.id, event: String(h.event ?? '').slice(0, 64), at: num(h.at, 0) });
    }
  }
  return c;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

function validDeck(id: FighterId, deck: unknown): CardId[] {
  const allowed = new Set<CardId>([...UNIVERSAL_CARDS, FIGHTERS[id].signature]);
  if (!Array.isArray(deck)) return FIGHTERS[id].defaultDeck.slice();
  const out: CardId[] = [];
  for (const c of deck) if (allowed.has(c as CardId) && !out.includes(c as CardId)) out.push(c as CardId);
  if (out.length !== 4) return FIGHTERS[id].defaultDeck.slice();
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
      t.deck = validDeck(id, f.deck);
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
  // v3: seasonal progress and cosmetics (absent before Alpha 1.2 -> empty)
  d.events = sanitizeEvents(r.events);
  d.cosmetics = sanitizeCosmetics(r.cosmetics);
  return d;
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
