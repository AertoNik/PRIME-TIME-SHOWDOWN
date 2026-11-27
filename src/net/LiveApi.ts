import type { ArenaId, ArenaPref } from '../config/arenas.config';
import type { FighterId, CardId } from '../config/types';
import type { LiveInput, LiveSnapshot } from '../live/sim';
import { SIM_VERSION } from '../league/simVersion';
import type { PrimeApi } from './PrimeApi';

// Beta 2.7 LIVE DUELS — the requests to /api/prime/live/* and the shapes of the server's answers (lib/live.js).

export interface LivePlayer {
  name: string;
  fighter: FighterId | null;
  look: string | null;
  picked: boolean;
  ready: boolean;
  connected: boolean;
  /** Only in the player's own entry. */
  deck?: CardId[];
  /** Beta 2.7.1: the set this player wants (a set open now or 'random'); null before the first pick, absent on a 2.7 server. */
  arena?: ArenaPref | null;
}

export interface LiveRoom {
  id: string;
  code: string;
  status: 'waiting' | 'open' | 'fight' | 'closed';
  you: 'host' | 'guest';
  host: LivePlayer | null;
  guest: LivePlayer | null;
  score: { host: number; guest: number; draws: number };
  games: number;
  match: string | null;
  rematch: { host: boolean; guest: boolean };
  expires: number;
  closedWhy: string | null;
  /** Beta 2.7.1: the sets a player may choose now (absent: a 2.7 server — the set is always drawn). */
  arenas?: ArenaId[];
  /** Seasonal sets opening within two weeks (locked, with their start). */
  soon?: { id: ArenaId; from: number }[];
}

/** Beta 2.7.1: how the server chose a match's set (snapshot.arenaPick; prefs by side 0 / 1). */
export interface LiveArenaPick {
  how: 'same' | 'coin' | 'one' | 'random';
  prefs: [ArenaPref, ArenaPref];
}

export interface LiveResult {
  /** 0 / 1 = the side that won, −1 = a draw. */
  winner: number;
  method: 'ko' | 'time' | 'forfeit' | 'drop';
  steps: number;
  hp: [number, number];
  cards: [number, number];
  combos: [number, number];
  damage: [number, number];
  perfects: [number, number];
  duration: number;
  hash: number;
  /** The side that left (forfeit / drop). */
  left?: number;
  /** [side 0, side 1]: got the day's PRIME RIVALS mini case with this fight. */
  rewards?: [boolean, boolean];
  void?: string;
}

export interface LiveMatchView {
  id: string;
  room: string;
  game: number;
  side: 0 | 1;
  /** (arenaPick — 2.7.1 servers: how the set was chosen; the fight never reads it) */
  snapshot: LiveSnapshot & { arenaPick?: LiveArenaPick };
  startAt: number;
  status: 'active' | 'done' | 'void';
  sim: string;
  /** The journal from entry `from` (the whole of it from 0 when `from` is 0). */
  from: number;
  inputs: LiveInput[];
  count: number;
  result: LiveResult | null;
}

export interface LiveStats {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  best: number;
  rematches: number;
  caseToday: boolean;
  cases: boolean;
}

/** A message on the realtime topic «prime_live». */
export type LiveMessage =
  | { type: 'room'; room: LiveRoom; t: number }
  | { type: 'start'; room: LiveRoom; match: LiveMatchView; t: number }
  | { type: 'in'; m: string; k: number; s: number; p: number; c: number; t: number }
  | { type: 'end'; room: LiveRoom; match: LiveMatchView; t: number };

/** One clock sample: the server's time `t` seen between `sent` and `got` (local ms). */
export type ClockSample = { sent: number; got: number; t: number };

export class LiveApi {
  /** Every answer's server time goes here (the clock estimate of LiveClock). */
  onClock: ((s: ClockSample) => void) | null = null;

  constructor(readonly api: PrimeApi) {}

  private async call<T extends { t?: number }>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    const sent = Date.now();
    const out = await this.api.live<T>(method, path, body, timeoutMs);
    const got = Date.now();
    if (out && typeof out.t === 'number') this.onClock?.({ sent, got, t: out.t });
    return out;
  }

  create(): Promise<{ room: LiveRoom; again?: boolean; t: number }> {
    return this.call('POST', '/room', { sim: SIM_VERSION });
  }
  join(code: string): Promise<{ room: LiveRoom; again?: boolean; t: number }> {
    return this.call('POST', '/join', { code, sim: SIM_VERSION });
  }
  active(): Promise<{ room: LiveRoom | null; match?: LiveMatchView | null; t: number }> {
    return this.call('GET', '/active');
  }
  stats(): Promise<LiveStats & { t: number }> {
    return this.call('GET', '/stats');
  }
  attach(room: string, clientId: string): Promise<{ room: LiveRoom; t: number }> {
    return this.call('POST', `/room/${room}/attach`, { clientId });
  }
  /** (arena — 2.7.1: the set preference with the room's first pick; absent = the server keeps the stored one) */
  pick(room: string, fighter: FighterId, deck: CardId[], look: string | null, arena?: ArenaPref): Promise<{ room: LiveRoom; t: number }> {
    return this.call('POST', `/room/${room}/pick`, { fighter, deck, look: look ?? '', ...(arena ? { arena } : {}) });
  }
  /** Beta 2.7.1: this player's set preference for the next match (a set open now or 'random'). */
  arena(room: string, arena: ArenaPref): Promise<{ room: LiveRoom; t: number }> {
    return this.call('POST', `/room/${room}/arena`, { arena });
  }
  ready(room: string, ready: boolean): Promise<{ room: LiveRoom; match?: LiveMatchView; t: number }> {
    return this.call('POST', `/room/${room}/ready`, { ready });
  }
  rematch(room: string, want: boolean): Promise<{ room: LiveRoom; match?: LiveMatchView; t: number }> {
    return this.call('POST', `/room/${room}/rematch`, { want });
  }
  leave(room: string): Promise<{ room: LiveRoom; t: number }> {
    return this.call('POST', `/room/${room}/leave`, {});
  }
  pulse(room: string, k: number, check: [number, number] | null): Promise<{ room: LiveRoom; match?: LiveMatchView; t: number }> {
    return this.call('POST', `/room/${room}/pulse`, { k, ...(check ? { cs: check[0], h: check[1] } : {}) }, 6000);
  }
  match(id: string, from: number): Promise<{ match: LiveMatchView; t: number }> {
    return this.call('GET', `/match/${id}?from=${from}`);
  }
  act(id: string, op: string, card: number): Promise<{ k: number; s: number; duplicate?: boolean; t: number }> {
    return this.call('POST', `/match/${id}/act`, { op, card }, 5000);
  }
  finish(id: string, hash: number | null): Promise<{ match: LiveMatchView; duplicate?: boolean; t: number }> {
    return this.call('POST', `/match/${id}/finish`, hash === null ? {} : { hash }, 15000);
  }
  leaveMatch(id: string): Promise<{ match: LiveMatchView; t: number }> {
    return this.call('POST', `/match/${id}/leave`, {}, 15000);
  }
}

/**
 * The server's clock as this game sees it: the offset from the answers with the shortest round trip (the half of a
 * short trip is the best guess of when the server wrote its time). Kept to the last 16 samples.
 */
export class LiveClock {
  private samples: { rtt: number; offset: number }[] = [];
  offset = 0;
  rtt = 0;

  add(s: ClockSample): void {
    const rtt = Math.max(0, s.got - s.sent);
    this.samples.push({ rtt, offset: s.t - (s.sent + s.got) / 2 });
    if (this.samples.length > 16) this.samples.shift();
    let best = this.samples[0];
    for (const x of this.samples) if (x.rtt < best.rtt) best = x;
    this.offset = best.offset;
    this.rtt = best.rtt;
  }

  /** A realtime message's server time `t` arrived now: the server's clock cannot be behind it. */
  floor(t: number, got = Date.now()): void {
    if (t - got > this.offset) this.offset = t - got;
  }

  now(): number {
    return Date.now() + this.offset;
  }

  get ready(): boolean {
    return this.samples.length > 0;
  }
}
