// Alpha 1.9.7 — WINTER SHOWDOWN (R-22): the pure rules of a `secure` seasonal event, the SAME code in the game and on
// the server (bundled into backend/pb_hooks/lib/season_math.js by `npm run backend:rules`). No DOM, no network, no
// clock of its own: every function gets the moment it decides for.
//
// The server pays from these numbers only. A career fight is reported by the game (the server cannot replay it, so a
// report is NOT a proof — it is clamped, rate-limited and capped per day: lib/season.js); a PRIME LEAGUE fight is the
// server's own settled result.
import type { EventDef, MatchEarnings, QuestMetric } from '../config/events.config';
import type { ArenaId } from '../config/arenas.config';
import type { Difficulty } from '../config/types';

const DIFFICULTY_RANK: Record<Difficulty, number> = { rookie: 0, pro: 1, champion: 2 };
const ULTRA = ['superstar', 'electro_blast'];

/** What one finished fight tells the season (career: the game's report; league: the server's settled fight). */
export interface SeasonFight {
  source: 'career' | 'league';
  outcome: 'win' | 'loss' | 'draw';
  method: 'ko' | 'time' | 'forfeit';
  rating: number;
  combos: number;
  ultra: number;
  perfects: number;
  difficulty: Difficulty;
  arena: ArenaId | string;
}

/** Report limits: what a career report may claim at most (anything above is clamped, never trusted). */
export const REPORT_LIMITS = {
  /** A fight shorter than this is not a fight (measured 1.9.7: the shortest of 192 bot fights 48.8 s, 5 % under 55 s). */
  minSeconds: 30,
  maxSeconds: 400,
  /**
   * The TIME BANK: each report takes `realTime` × its length + `overheadSeconds` of real time (menus between fights); all
   * reports together never run ahead of the server's clock. Unused time builds up for `bankReachMinutes` at most, so a
   * short offline session still counts later, and a forger cannot save up a day of «fights».
   */
  realTime: 0.8,
  overheadSeconds: 10,
  bankReachMinutes: 45,
  maxPerHour: 40,
  /** Only this many career reports of a Moscow day move the quests (the most active honest player in the model: 30). */
  questReportsPerDay: 30,
  combos: 30,
  perfects: 30,
};

/** Moscow game day (UTC+3, no daylight saving) of a moment, as YYYY-MM-DD — the same day DAILY and the league use. */
export function mskDay(ms: number): string {
  const d = new Date(ms + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/** The event's phase at `ms` by its own dates (the server's clock decides on the server). */
export function seasonPhase(e: Pick<EventDef, 'start' | 'end' | 'announceDays'>, ms: number): 'none' | 'announce' | 'running' | 'over' {
  if (!e.start || !e.end) return 'none';
  const s = Date.parse(e.start);
  const en = Date.parse(e.end);
  if (ms >= en) return 'over';
  if (ms >= s) return 'running';
  return ms >= s - e.announceDays * 86400000 ? 'announce' : 'none';
}

/** Currency a CAREER fight pays before the daily cap (the lines the results screen shows). */
export function careerLines(er: MatchEarnings, f: SeasonFight): { label: string; value: number }[] {
  const lines: { label: string; value: number }[] = [];
  if (f.method === 'forfeit') return lines;
  if (f.outcome === 'win' && er.win > 0) lines.push({ label: 'Победа', value: er.win });
  let rt = 0;
  for (const [min, v] of er.rating) if (f.rating >= min) rt += v;
  if (rt > 0) lines.push({ label: `Рейтинг ${Math.round(f.rating)}`, value: rt });
  const c = Math.min(er.comboCap, Math.max(0, Math.floor(f.combos)));
  if (c > 0 && er.perCombo > 0) lines.push({ label: `Комбо ×${c}`, value: c * er.perCombo });
  const aw = er.arenaWin;
  if (aw && f.arena === aw.arena && f.outcome === 'win' && (f.method === 'ko' || f.method === 'time') && aw.tokens > 0) lines.push({ label: aw.label, value: aw.tokens });
  return lines;
}

/** Currency a settled PRIME LEAGUE fight pays before the daily cap. */
export function leagueCanes(er: MatchEarnings, outcome: 'win' | 'loss' | 'draw'): number {
  const l = er.league;
  if (!l) return 0;
  return outcome === 'win' ? l.win : outcome === 'draw' ? l.draw : l.loss;
}

/** How far one fight moves a quest (0: not at all). `earned` counts the currency the fight really paid. */
export function questStep(m: QuestMetric, f: SeasonFight, paid: number): number {
  if (f.method === 'forfeit') return 0;
  const win = f.outcome === 'win';
  const real = win && (f.method === 'ko' || f.method === 'time');
  switch (m.kind) {
    case 'wins':
      return win ? 1 : 0;
    case 'matches':
      return 1;
    case 'combos':
      return Math.max(0, Math.floor(f.combos));
    case 'ultraCombos':
      return Math.max(0, Math.floor(f.ultra));
    case 'perfects':
      return Math.max(0, Math.floor(f.perfects));
    case 'koWins':
      return win && f.method === 'ko' ? 1 : 0;
    case 'ratingSum':
      return Math.max(0, Math.round(f.rating));
    case 'ratingAtLeast':
      return f.rating >= m.min ? 1 : 0;
    case 'winsOnDifficulty':
      return f.source === 'career' && win && DIFFICULTY_RANK[f.difficulty] >= DIFFICULTY_RANK[m.min] ? 1 : 0;
    case 'arenaWins':
      return real && f.arena === m.arena ? 1 : 0;
    case 'leagueWins':
      return f.source === 'league' && win ? 1 : 0;
    case 'leagueMatches':
      return f.source === 'league' ? 1 : 0;
    case 'earned':
      return Math.max(0, paid);
  }
  return 0;
}

/** Count the combos of a result that are ULTRA ones (SUPERSTAR MOVE, ELECTRO BLAST) — the same set as EventManager. */
export function ultraCount(list: readonly string[]): number {
  return list.filter((c) => ULTRA.indexOf(c) >= 0).length;
}

/** Clamp a career report to what a fight can really show (never trusted beyond REPORT_LIMITS). */
export function clampFight(raw: Partial<SeasonFight>, arenas: readonly string[]): SeasonFight | null {
  const outcome = raw.outcome === 'win' || raw.outcome === 'loss' || raw.outcome === 'draw' ? raw.outcome : null;
  const method = raw.method === 'ko' || raw.method === 'time' ? raw.method : raw.method === 'forfeit' ? 'forfeit' : null;
  const difficulty = raw.difficulty === 'rookie' || raw.difficulty === 'pro' || raw.difficulty === 'champion' ? raw.difficulty : null;
  if (!outcome || !method || !difficulty) return null;
  const n = (v: unknown, max: number) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
  return {
    source: 'career',
    outcome,
    method,
    rating: typeof raw.rating === 'number' && isFinite(raw.rating) ? Math.max(0, Math.min(100, raw.rating)) : 0,
    combos: n(raw.combos, REPORT_LIMITS.combos),
    ultra: Math.min(n(raw.ultra, REPORT_LIMITS.combos), n(raw.combos, REPORT_LIMITS.combos)),
    perfects: n(raw.perfects, REPORT_LIMITS.perfects),
    difficulty,
    arena: typeof raw.arena === 'string' && arenas.indexOf(raw.arena) >= 0 ? raw.arena : 'original',
  };
}
