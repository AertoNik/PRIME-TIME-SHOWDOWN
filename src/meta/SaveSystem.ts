import { CAREER_START, GOALS, type GoalId } from '../config/career';
import { UNIVERSAL_CARDS } from '../config/cards';
import { FIGHTERS, FIGHTER_ORDER, RIVAL_ORDER } from '../config/fighters';
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
}

// The key never changes between versions so existing careers keep loading;
// `version` records the schema and sanitize() fills anything missing.
const KEY = 'primetime-showdown-save-v1';
const VERSION = 2;

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
  };
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
