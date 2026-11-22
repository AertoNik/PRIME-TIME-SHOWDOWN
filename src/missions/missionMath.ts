// Beta 2.6 — DAILY MISSIONS: the shared logic of the five daily tasks — which ones a player can be given, the day's
// pick, how a fight counts. The PRIME NETWORK server runs exactly this file (backend/pb_hooks/lib/mission_math.js is its
// bundle, `npm run backend:rules`); the game only shows what the server answered.
import { MISSIONS, MISSION_MIX, MISSION_RIVALS, type MissionDef, type MissionMetric, type MissionTier } from '../config/missions.config';

/** What the server knows of the player today (from the cloud save and the league profile). */
export interface MissionContext {
  /** PRIME LEAGUE on and joined (the rules accepted). */
  league: boolean;
  /** Difficulties open in the career («Профи» from producer level 2, «Чемпион» from 4). */
  pro: boolean;
  champion: boolean;
  /** Signed fighters (the career roster of the save). */
  fighters: number;
}

/** One mission of a day as the server keeps it. */
export interface MissionState {
  id: string;
  metric: MissionMetric;
  target: number;
  min?: number;
  progress: number;
  /** For «different …» missions: what was counted already. */
  seen?: string[];
  done: boolean;
  /** Its mini case was granted (once, when it was done). */
  rewarded: boolean;
}

/** A career fight as the game reports it, after the server's clamp. */
export interface MissionFight {
  outcome: 'win' | 'loss' | 'draw';
  method: 'ko' | 'time' | 'forfeit';
  rating: number;
  combos: number;
  perfects: number;
  difficulty: 'rookie' | 'pro' | 'champion';
  mode: 'classic' | 'challenge' | 'boss';
  fighter: string;
  rival: string;
}

/** A PRIME LEAGUE fight the server settled itself. */
export interface MissionLeagueFight {
  outcome: 'win' | 'loss' | 'draw';
  method: string;
  combos: number;
}

export function missionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

/** Can this player be given `m` today? (No league task without the league, no locked difficulty, enough fighters.) */
export function available(m: MissionDef, ctx: MissionContext): boolean {
  const n = m.needs;
  if (!n) return true;
  if (n.league && !ctx.league) return false;
  if (n.difficulty === 'pro' && !ctx.pro) return false;
  if (n.difficulty === 'champion' && !ctx.champion) return false;
  if (n.fighters && ctx.fighters < n.fighters) return false;
  return true;
}

/** A small repeatable random stream (mulberry32) from a 32-bit seed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The 32-bit seed of an account's day (FNV-1a of «uid:day») — the same day always gives the same pick. */
export function daySeed(uid: string, day: number): number {
  let h = 0x811c9dc5;
  const s = uid + ':' + day;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The day's five missions: 2 easy, 2 medium, 1 hard of different families, only available ones, at most
 * MISSION_MIX.maxLeague of the league; yesterday's missions are avoided while others are left (they may come back
 * on later days). A tier short of candidates borrows from the neighbouring tier, so the count is always five when the
 * catalogue allows. Deterministic for (seed, ctx, yesterday).
 */
export function pickMissions(seed: number, ctx: MissionContext, yesterday: string[] = []): MissionDef[] {
  const rnd = seeded(seed);
  const pool = MISSIONS.filter((m) => available(m, ctx));
  const chosen: MissionDef[] = [];
  const families = new Set<string>();
  let league = 0;
  const can = (m: MissionDef) => !families.has(m.family) && !chosen.includes(m) && (!m.needs?.league || league < MISSION_MIX.maxLeague);
  const take = (m: MissionDef) => {
    chosen.push(m);
    families.add(m.family);
    if (m.needs?.league) league++;
  };
  const draw = (tier: MissionTier | null, avoidYesterday: boolean): boolean => {
    const c = pool.filter((m) => (tier === null || m.tier === tier) && can(m) && (!avoidYesterday || !yesterday.includes(m.id)));
    if (!c.length) return false;
    take(c[Math.min(c.length - 1, Math.floor(rnd() * c.length))]);
    return true;
  };
  // hard first (the scarcest), then medium, then easy
  for (const tier of ['hard', 'medium', 'easy'] as MissionTier[]) {
    for (let i = 0; i < MISSION_MIX.tiers[tier]; i++) {
      if (draw(tier, true) || draw(tier, false)) continue;
      // a tier with nothing left: the neighbouring tier gives one (a smaller roster, no league)
      if (draw(tier === 'hard' ? 'medium' : 'easy', true) || draw(null, false)) continue;
    }
  }
  // the player reads them easy → hard
  const order: Record<MissionTier, number> = { easy: 0, medium: 1, hard: 2 };
  return chosen.slice(0, MISSION_MIX.count).sort((a, b) => order[a.tier] - order[b.tier]);
}

/** The server's record of a picked mission (nothing counted yet). */
export function stateOf(m: MissionDef): MissionState {
  const s: MissionState = { id: m.id, metric: m.metric, target: m.target, progress: 0, done: false, rewarded: false };
  if (m.min !== undefined) s.min = m.min;
  if (m.metric === 'fighters' || m.metric === 'fighterWins' || m.metric === 'rivals') s.seen = [];
  return s;
}

/** A career report clamped to what a fight can show (never trusted beyond these). Null = not a fight. */
export function clampMissionFight(raw: Partial<MissionFight>, fighters: readonly string[]): MissionFight | null {
  const outcome = raw.outcome === 'win' || raw.outcome === 'loss' || raw.outcome === 'draw' ? raw.outcome : null;
  const method = raw.method === 'ko' || raw.method === 'time' || raw.method === 'forfeit' ? raw.method : null;
  const difficulty = raw.difficulty === 'rookie' || raw.difficulty === 'pro' || raw.difficulty === 'champion' ? raw.difficulty : null;
  const mode = raw.mode === 'classic' || raw.mode === 'challenge' || raw.mode === 'boss' ? raw.mode : null;
  if (!outcome || !method || !difficulty || !mode) return null;
  const n = (v: unknown, max: number) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
  const fighter = typeof raw.fighter === 'string' && fighters.includes(raw.fighter) ? raw.fighter : '';
  const rival = typeof raw.rival === 'string' && MISSION_RIVALS.includes(raw.rival) ? raw.rival : '';
  return {
    outcome,
    method,
    rating: typeof raw.rating === 'number' && isFinite(raw.rating) ? Math.max(0, Math.min(100, raw.rating)) : 0,
    combos: n(raw.combos, MISSION_MIX.maxCombosPerFight),
    perfects: n(raw.perfects, MISSION_MIX.maxPerfectsPerFight),
    difficulty,
    mode,
    fighter,
    rival,
  };
}

function bump(s: MissionState, by: number): boolean {
  if (s.done || by <= 0) return false;
  s.progress = Math.min(s.target, s.progress + by);
  if (s.progress >= s.target) s.done = true;
  return s.done;
}
function bumpSeen(s: MissionState, key: string): boolean {
  if (s.done || !key) return false;
  const seen = s.seen ?? (s.seen = []);
  if (seen.includes(key)) return false;
  seen.push(key);
  return bump(s, 1);
}

/**
 * A finished career fight counts for the day's missions (in place). Returns the indices of missions it completed now.
 * An exit from the fight (forfeit) counts nothing at all.
 */
export function countCareer(list: MissionState[], f: MissionFight): number[] {
  if (f.method === 'forfeit') return [];
  const won = f.outcome === 'win';
  const done: number[] = [];
  list.forEach((s, i) => {
    let now = false;
    switch (s.metric) {
      case 'fights':
        now = bump(s, 1);
        break;
      case 'wins':
        now = won && bump(s, 1);
        break;
      case 'koWins':
        now = won && f.method === 'ko' && bump(s, 1);
        break;
      case 'proWins':
        now = won && (f.difficulty === 'pro' || f.difficulty === 'champion') && bump(s, 1);
        break;
      case 'champWins':
        now = won && f.difficulty === 'champion' && bump(s, 1);
        break;
      case 'combos':
        now = bump(s, f.combos);
        break;
      case 'perfects':
        now = bump(s, f.perfects);
        break;
      case 'rating':
        now = f.rating >= (s.min ?? 100) && bump(s, 1);
        break;
      case 'fighters':
        now = bumpSeen(s, f.fighter);
        break;
      case 'fighterWins':
        now = won && bumpSeen(s, f.fighter);
        break;
      case 'rivals':
        now = won && f.mode === 'classic' && bumpSeen(s, f.rival);
        break;
      case 'challengeWins':
        now = won && f.mode === 'challenge' && bump(s, 1);
        break;
      default:
        break;
    }
    if (now) done.push(i);
  });
  return done;
}

/** A PRIME LEAGUE fight the server settled counts for the day's league missions (never a forfeit). */
export function countLeague(list: MissionState[], f: MissionLeagueFight): number[] {
  if (f.method === 'forfeit') return [];
  const done: number[] = [];
  list.forEach((s, i) => {
    let now = false;
    if (s.metric === 'leagueFights') now = bump(s, 1);
    else if (s.metric === 'leagueWins') now = f.outcome === 'win' && bump(s, 1);
    else if (s.metric === 'leagueCombos') now = bump(s, Math.max(0, Math.min(MISSION_MIX.maxCombosPerFight, Math.floor(f.combos) || 0)));
    if (now) done.push(i);
  });
  return done;
}

/** The producer level of a reputation (the career's thresholds, passed in by the caller). */
export function levelOf(rep: number, thresholds: readonly number[]): number {
  let lvl = 1;
  for (let i = 0; i < thresholds.length; i++) if (rep >= thresholds[i]) lvl = i + 1;
  return lvl;
}

/** About how many minutes a set takes alone, mission by mission (the checks keep the mix in the owner's range). */
export function setMinutes(list: MissionDef[]): number {
  return list.reduce((t, m) => t + m.minutes, 0);
}
