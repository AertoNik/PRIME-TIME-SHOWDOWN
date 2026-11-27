import { LIVE } from '../config/live.config';
import { stateHash } from '../league/replay';
import { LiveApi, LiveClock, type LiveMatchView, type LiveMessage, type LiveRoom } from '../net/LiveApi';
import { PrimeApiError } from '../net/PrimeApi';
import { LiveDriver } from './driver';

/** The realtime channel (PocketBase SSE) as the session needs it — the SDK's in the game, a stand-in in the checks. */
export interface LiveRealtime {
  /** Subscribes to a topic; resolves once the server holds the subscription. */
  subscribe(topic: string, cb: (data: unknown) => void): Promise<() => Promise<void>>;
  /** This connection's id (after subscribe). */
  clientId(): string;
}

export type LiveEvent =
  | { type: 'room'; room: LiveRoom }
  | { type: 'start'; room: LiveRoom; match: LiveMatchView }
  | { type: 'rebuild' }
  | { type: 'end'; room: LiveRoom | null; match: LiveMatchView }
  | { type: 'closed'; room: LiveRoom | null; why: string }
  | { type: 'error'; code: string };

/** Timers the session uses (the checks can drive them by hand). */
export interface LiveTimers {
  every(ms: number, fn: () => void): () => void;
  after(ms: number, fn: () => void): () => void;
}
export const realTimers: LiveTimers = {
  every: (ms, fn) => {
    const h = setInterval(fn, ms);
    return () => clearInterval(h);
  },
  after: (ms, fn) => {
    const h = setTimeout(fn, ms);
    return () => clearTimeout(h);
  },
};

const TOPIC = 'prime_live';

function opId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return 'lv_' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Beta 2.7 LIVE DUELS — one account's presence in a room and its matches: realtime news, the heartbeat, the player's
 * cards, the journal, the end of a fight. No DOM, no renderer: the game (LiveRuntime) listens to its events and draws.
 */
export class LiveSession {
  readonly clock = new LiveClock();
  room: LiveRoom | null = null;
  match: LiveMatchView | null = null;
  driver: LiveDriver | null = null;
  /** The settled match (the server's result) — until the next one starts. */
  last: LiveMatchView | null = null;
  private unsub: (() => Promise<void>) | null = null;
  private stopPulse: (() => void) | null = null;
  private listeners = new Set<(e: LiveEvent) => void>();
  private finishing = false;
  private fetching = false;
  /** Cards sent and not yet in the journal (deck index → op). */
  readonly pending = new Map<number, string>();
  /** Diagnostics: realtime messages received, journal entries fed by heartbeats (missed news). */
  readonly stats = { messages: 0, healed: 0, actsSent: 0, actsFailed: 0, failCodes: {} as Record<string, number> };

  constructor(
    readonly api: LiveApi,
    private readonly rt: LiveRealtime,
    private readonly timers: LiveTimers = realTimers,
  ) {
    api.onClock = (s) => this.clock.add(s);
  }

  on(fn: (e: LiveEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: LiveEvent): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(e);
      } catch (err) {
        console.warn('PRIME TIME LIVE: listener failed', err);
      }
    }
  }

  get mySide(): 0 | 1 | null {
    return this.match ? this.match.side : null;
  }

  /** Enters a room (just created or joined, or found after a reload): realtime, attach, heartbeat. */
  async enter(room: LiveRoom, match: LiveMatchView | null = null): Promise<void> {
    this.room = room;
    if (!this.unsub) this.unsub = await this.rt.subscribe(TOPIC, (d) => this.onMessage(d));
    await this.attach();
    this.stopPulse?.();
    this.stopPulse = this.timers.every(LIVE.pulseMs, () => void this.pulse());
    if (match && match.status === 'active') this.startMatch(match);
    else if (match) this.last = match;
    this.emit({ type: 'room', room: this.room });
  }

  /** (Again after the realtime connection came back with a new id.) */
  async attach(): Promise<void> {
    if (!this.room) return;
    const r = await this.api.attach(this.room.id, this.rt.clientId());
    this.setRoom(r.room);
  }

  private setRoom(room: LiveRoom): void {
    this.room = room;
    if (room.status === 'closed') {
      this.stopPulse?.();
      this.stopPulse = null;
      this.emit({ type: 'closed', room, why: room.closedWhy ?? 'closed' });
      return;
    }
    this.emit({ type: 'room', room });
  }

  private onMessage(raw: unknown): void {
    let msg: LiveMessage;
    try {
      msg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as LiveMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    this.stats.messages++;
    if (typeof msg.t === 'number') this.clock.floor(msg.t);
    if (msg.type === 'in') {
      if (this.match && msg.m === this.match.id) this.feed(msg.k, msg.s, msg.p, msg.c);
      return;
    }
    if (!this.room || msg.room.id !== this.room.id) return;
    if (msg.type === 'room') this.setRoom(msg.room);
    else if (msg.type === 'start') {
      this.room = msg.room;
      if (!this.match || this.match.id !== msg.match.id) this.startMatch(msg.match);
    } else if (msg.type === 'end') this.endMatch(msg.room, msg.match);
  }

  private startMatch(view: LiveMatchView): void {
    this.match = view;
    this.last = null;
    this.finishing = false;
    this.pending.clear();
    this.driver = new LiveDriver(view.snapshot, view.side, view.startAt, () => this.clock.now());
    view.inputs.forEach((x, i) => this.feed(view.from + i, x[0], x[1], x[2]));
    this.emit({ type: 'start', room: this.room as LiveRoom, match: view });
  }

  private endMatch(room: LiveRoom | null, view: LiveMatchView): void {
    if (room) this.room = room;
    if (this.last && this.last.id === view.id) return;
    if (this.match && this.match.id !== view.id) return;
    // the journal the server settled with (a fight shown without some entry still ends with the server's result)
    view.inputs.forEach((x, i) => this.feed(view.from + i, x[0], x[1], x[2]));
    this.last = view;
    this.match = null;
    this.pending.clear();
    this.emit({ type: 'end', room: this.room, match: view });
  }

  private feed(k: number, s: number, p: number, c: number): void {
    const d = this.driver;
    if (!d) return;
    const r = d.receive(k, s, p, c);
    if (p === d.side) this.pending.delete(c);
    if (r === 'late') this.emit({ type: 'rebuild' });
    else if (r === 'gap') void this.heal();
  }

  /** A hole in the journal: the missing entries from the server. */
  private async heal(): Promise<void> {
    const m = this.match;
    const d = this.driver;
    if (!m || !d || this.fetching) return;
    this.fetching = true;
    try {
      const r = await this.api.match(m.id, d.count);
      if (this.match?.id !== m.id) return;
      const before = d.count;
      r.match.inputs.forEach((x, i) => this.feed(r.match.from + i, x[0], x[1], x[2]));
      this.stats.healed += d.count - before;
      if (r.match.status !== 'active') this.endMatch(null, r.match);
    } catch {
      /* the next heartbeat tries again */
    } finally {
      this.fetching = false;
    }
  }

  /** The heartbeat: presence, the room, the entries the realtime news may have missed, a fingerprint to compare. */
  async pulse(): Promise<void> {
    const room = this.room;
    if (!room || room.status === 'closed') return;
    const d = this.driver;
    const check = d && d.hashes.length ? d.hashes.shift()! : null;
    try {
      const r = await this.api.pulse(room.id, d ? d.count : 0, check);
      this.setRoom(r.room);
      const v = r.match;
      if (v && this.match && v.id === this.match.id) {
        const before = d ? d.count : 0;
        v.inputs.forEach((x, i) => this.feed(v.from + i, x[0], x[1], x[2]));
        if (d) this.stats.healed += d.count - before;
        if (v.status !== 'active') this.endMatch(r.room, v);
      } else if (v && v.status === 'active' && (!this.match || this.match.id !== v.id)) this.startMatch(v);
      else if (v && v.status !== 'active' && (!this.last || this.last.id !== v.id) && this.match?.id === v.id) this.endMatch(r.room, v);
    } catch (e) {
      if (e instanceof PrimeApiError && e.code === 'room_not_found') this.setRoom({ ...room, status: 'closed', closedWhy: 'gone' });
    }
  }

  /** The player's card (index in the own deck 0–3). false: not sent (no fight running, already on its way). */
  play(card: number): boolean {
    const m = this.match;
    const d = this.driver;
    if (!m || !d || m.status !== 'active' || d.match.phase !== 'fight' || this.pending.has(card)) return false;
    const op = opId();
    this.pending.set(card, op);
    this.stats.actsSent++;
    void this.sendAct(m.id, op, card, 0);
    return true;
  }

  private async sendAct(matchId: string, op: string, card: number, tries: number): Promise<void> {
    try {
      const r = await this.api.act(matchId, op, card);
      if (this.match?.id === matchId && this.driver) this.feed(r.k, r.s, this.driver.side, card);
      this.pending.delete(card);
    } catch (e) {
      const code = e instanceof PrimeApiError ? e.code : 'network';
      // the same op again is safe: the server answers a repeat with the entry it already made
      if ((code === 'network' || code === 'timeout') && tries < 2 && this.match?.id === matchId) {
        this.timers.after(250 * (tries + 1), () => void this.sendAct(matchId, op, card, tries + 1));
        return;
      }
      this.pending.delete(card);
      this.stats.actsFailed++;
      this.stats.failCodes[code] = (this.stats.failCodes[code] ?? 0) + 1;
      if (code === 'match_over') void this.pulse();
    }
  }

  /** The fight is over on this screen: the server replays the journal and settles (its result, never ours). */
  async finish(): Promise<void> {
    const m = this.match;
    const d = this.driver;
    if (!m || !d || this.finishing) return;
    this.finishing = true;
    const hash = d.overHash ?? stateHash(d.match);
    for (let i = 0; i < 12 && this.match?.id === m.id; i++) {
      try {
        const r = await this.api.finish(m.id, hash);
        this.endMatch(null, r.match);
        // the answer carries the match, not the room: the head-to-head score and the rematch buttons at once
        void this.pulse();
        return;
      } catch (e) {
        const wait = e instanceof PrimeApiError && typeof e.data.wait === 'number' ? Math.min(5000, e.data.wait as number) : 1500;
        await new Promise<void>((res) => this.timers.after(wait, res));
      }
    }
    this.finishing = false;
  }

  /** Gives the running fight up (a loss — unless the fight had already been decided). */
  async surrender(): Promise<void> {
    const m = this.match;
    if (!m) return;
    const r = await this.api.leaveMatch(m.id);
    this.endMatch(null, r.match);
    void this.pulse();
  }

  async ready(on: boolean): Promise<void> {
    if (!this.room) return;
    const r = await this.api.ready(this.room.id, on);
    this.room = r.room;
    if (r.match && r.match.status === 'active' && (!this.match || this.match.id !== r.match.id)) this.startMatch(r.match);
    else this.emit({ type: 'room', room: r.room });
  }

  async rematch(want: boolean): Promise<void> {
    if (!this.room) return;
    const r = await this.api.rematch(this.room.id, want);
    this.room = r.room;
    if (r.match && r.match.status === 'active' && (!this.match || this.match.id !== r.match.id)) this.startMatch(r.match);
    else this.emit({ type: 'room', room: r.room });
  }

  /** Leaves the room for good (closing it); the realtime subscription ends with it. */
  async leave(): Promise<void> {
    const room = this.room;
    this.stopPulse?.();
    this.stopPulse = null;
    if (room && room.status !== 'closed') {
      try {
        const r = await this.api.leave(room.id);
        this.room = r.room;
      } catch {
        /* the room closes on its own when idle */
      }
    }
    await this.dispose();
  }

  async dispose(): Promise<void> {
    this.stopPulse?.();
    this.stopPulse = null;
    const u = this.unsub;
    this.unsub = null;
    this.match = null;
    this.driver = null;
    this.room = null;
    if (u) {
      try {
        await u();
      } catch {
        /* gone already */
      }
    }
  }
}
