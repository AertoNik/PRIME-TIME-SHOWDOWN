import type { LeagueSide } from '../combat/league';
import type { CardId, FighterId } from '../config/types';
import type { TacticId } from '../config/league.config';
import type { ProducerLook } from '../config/producer.config';
import type { LeagueInput, LeagueSnapshot } from '../league/replay';
import { SIM_VERSION } from '../league/simVersion';
import type { PrimeApi } from './PrimeApi';

// Alpha 1.9.0 PRIME LEAGUE — what the game reads from /api/prime/league/*. The server decides everything here; the game
// only shows it (and plays the fight the server fixed).

export interface LeagueRank {
  index: number;
  id: string;
  ru: string;
  en: string;
  color: string;
  division: 'III' | 'II' | 'I' | null;
  base: number;
  next: number | null;
  divBase: number;
  divNext: number | null;
  progress: number;
}

export interface LeagueSlot {
  slot: number;
  fighter: FighterId;
  deck: CardId[];
  tactic: TacticId;
  look: string | null;
  enabled: boolean;
  version: number;
  wins: number;
  losses: number;
  draws: number;
  level: number;
  /** Why this saved defender cannot defend now (null: it can) — the server checks again before every match. */
  problem?: string | null;
}

export interface LeagueReport {
  since: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  tokens: number;
  byFighter: Record<string, { wins: number; losses: number; draws: number }>;
  byTactic: Record<string, { wins: number; losses: number; draws: number }>;
}

export interface LeagueOpponent {
  kind: 'player' | 'system';
  name: string;
  nameEn?: string;
  rank?: { ru: string; en: string; division: string | null; color: string; index: number };
  rp?: number;
  /** 1.9.0: the producer's look when the match was made (a player; null for PRIME NETWORK). */
  look?: ProducerLook | null;
}

export interface LeagueCeremony {
  kind: 'rank' | 'challenge_failed';
  rank: number;
  challenge?: boolean;
}

export interface LeagueMatch {
  id: string;
  mode: 'duel' | 'challenge' | 'rush' | 'squad';
  series: string | null;
  round: number;
  status: 'active' | 'done' | 'void';
  ranked: boolean;
  season: number;
  sim: string;
  seed: number;
  arena: string;
  started: number;
  expires: number;
  attacker: LeagueSide;
  defender: LeagueSide;
  hpMult: [number, number];
  dmgMult: [number, number];
  opponent: LeagueOpponent;
  inputs?: LeagueInput[];
  outcome?: 'win' | 'loss' | 'draw';
  method?: 'ko' | 'time' | 'forfeit';
  result?: { hp: [number, number]; rating: number; duration: number; steps: number; cardsUsed: number; combos: number; hash: number; clientHash?: number | null; ceremony: LeagueCeremony[]; challengeTokens?: number } | null;
  rp?: number;
  rpAfter?: number;
  tokens?: number;
  air?: number;
  how?: string;
}

export interface LeagueSeries {
  id: string;
  kind: 'rush' | 'squad';
  status?: string;
  round: number;
  results: { round: number; outcome: string; match: string | null }[];
  wins: number;
  losses: number;
  draws: number;
  lineup: { fighter: FighterId; deck: CardId[] }[];
  done: { won: boolean; rp: number; rpAfter?: number; tokens: number; air: number; cancelled?: boolean } | null;
}

export interface LeagueMe {
  joined: boolean;
  flags: { league: boolean; tokens: boolean; upgrades: boolean; rules: number; sim: string };
  /** `end` null: the pre-season with no season start fixed yet. */
  season: { number: number; start: number; end: number | null; now: number; length?: number };
  rules?: number;
  rulesAccepted?: number;
  rp: number;
  rank: LeagueRank;
  floor: number;
  peak: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  air: number;
  tokens: number;
  challenge: { to: number; wins: number; losses: number; since: number } | null;
  defenseOn: boolean;
  stats: Record<string, number>;
  place: number | null;
  track: { tiers: { tier: number; at: number; tokens: number; title: string | null; emblem: boolean }[]; claimed: number[] };
  upgrades: Record<string, number>;
  report: LeagueReport;
  ceremony: LeagueCeremony | null;
  active: LeagueMatch | null;
  series: { id: string; kind: 'rush' | 'squad' | 'challenge'; state: Record<string, unknown> }[];
  calibration: number;
  defense: LeagueSlot[];
  /** The attacker's league decks per fighter (the career's decks stay in the save). */
  decks?: Partial<Record<FighterId, CardId[]>>;
}

export interface LeagueBoard {
  season: { number: number; start: number; end: number | null };
  page: number;
  total: number;
  rows: { place: number; name: string; rp: number; rank: { ru: string; en: string; division: string | null; color: string; index: number }; games: number; wins: number; me: boolean; look?: ProducerLook | null }[];
}

export interface LeagueHistory {
  attacks: LeagueMatch[];
  defenses: { id: string; finished: number; outcome: 'win' | 'loss' | 'draw'; fighter: FighterId | null; tactic: TacticId | null; attackerFighter: FighterId | null; tokens: number }[];
  seasons: { season: number; rp: number; peak: number; rank: string; games: number; wins: number }[];
}

export interface LeagueFinish {
  match: LeagueMatch;
  profile?: LeagueMe;
  /** The series this duel belongs to, after it (RUSH / SQUAD). */
  series?: LeagueSeries | null;
  duplicate?: boolean;
  expired?: boolean;
}

export function newOp(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return 'lg_' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function snapshotOf(m: LeagueMatch): LeagueSnapshot {
  return { seed: m.seed, arena: m.arena as LeagueSnapshot['arena'], attacker: m.attacker, defender: m.defender, hpMult: m.hpMult, dmgMult: m.dmgMult };
}

export class LeagueApi {
  constructor(readonly api: PrimeApi) {}

  me(): Promise<LeagueMe> {
    return this.api.league<LeagueMe>('GET', '/me');
  }
  join(rules: number): Promise<LeagueMe> {
    return this.api.league<LeagueMe>('POST', '/join', { accept: true, rules });
  }
  saveDefense(slots: { slot: number; fighter: FighterId; deck: CardId[]; tactic: TacticId; look?: string | null; enabled: boolean }[]): Promise<{ ok: boolean; defense: LeagueSlot[] }> {
    return this.api.league('PUT', '/defense', { slots });
  }
  toggleDefense(on: boolean): Promise<{ ok: boolean; defenseOn: boolean }> {
    return this.api.league('POST', '/defense/toggle', { on });
  }
  seen(what: 'report' | 'ceremony'): Promise<{ ok: boolean }> {
    return this.api.league('POST', '/report/seen', { what });
  }
  start(mode: 'duel' | 'challenge', fighter: FighterId, deck: CardId[], op: string): Promise<{ match: LeagueMatch; duplicate?: boolean }> {
    return this.api.league('POST', '/match/start', { mode, fighter, deck, op, sim: SIM_VERSION });
  }
  match(id: string): Promise<{ match: LeagueMatch }> {
    return this.api.league('GET', `/match/${id}`);
  }
  checkpoint(id: string, inputs: LeagueInput[]): Promise<{ ok: boolean; held: number }> {
    return this.api.league('POST', `/match/${id}/inputs`, { inputs });
  }
  finish(id: string, inputs: LeagueInput[], hash?: number): Promise<LeagueFinish> {
    // the server replays the whole fight here (≈1–5 s, longer on a busy small server): wait for it instead of re-sending
    return this.api.league('POST', `/match/${id}/finish`, { inputs, ...(typeof hash === 'number' ? { hash } : {}) }, 45000);
  }
  saveDeck(fighter: FighterId, deck: CardId[]): Promise<{ ok: boolean }> {
    return this.api.league('PUT', '/deck', { fighter, deck });
  }
  board(page = 0): Promise<LeagueBoard> {
    return this.api.league('GET', `/board?page=${page}`);
  }
  history(): Promise<LeagueHistory> {
    return this.api.league('GET', '/history');
  }
  claim(tier: number): Promise<{ ok: boolean; tokens?: number; duplicate?: boolean }> {
    return this.api.league('POST', '/track/claim', { tier });
  }
  seriesStart(kind: 'rush' | 'squad', lineup: { fighter: FighterId; deck: CardId[] }[], op: string): Promise<{ series: LeagueSeries; match: LeagueMatch }> {
    return this.api.league('POST', '/series/start', { kind, lineup, op, sim: SIM_VERSION });
  }
  seriesNext(kind: 'rush' | 'squad'): Promise<{ series: LeagueSeries; match: LeagueMatch }> {
    return this.api.league('POST', '/series/next', { kind });
  }
  seriesAbandon(kind: 'rush' | 'squad'): Promise<{ series: LeagueSeries | null }> {
    return this.api.league('POST', '/series/abandon', { kind });
  }
}
