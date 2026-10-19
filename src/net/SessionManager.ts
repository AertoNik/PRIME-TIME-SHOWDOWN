import { PrimeApiError, type PrimeApi, type SessionToken } from './PrimeApi';

// Alpha 1.8.3 — PRIME CLOUD 2.0: the page's GAME SESSION. One PRIME ID = one page (tab, browser,
// device) that may play the account and change its cloud save at a time. The server is the judge:
//
//   claim      opening the game / «Продолжить здесь» — this page takes the session over; every
//              other page of the account loses it at once (the server raises a fencing generation)
//   heartbeat  «still here» — every 4 s while the player uses the visible page, every ~20 s while it
//              only stays open, none in the background, plus a check at once when the page comes back,
//              gets the focus or is touched, and before a match starts (1.8.3.1). It NEVER takes the
//              session back: a page that lost it only learns so and stops (no tab ever grabs the session
//              in the background, so two pages cannot keep snatching it from each other)
//   writes     every cloud write carries { key, generation } (PrimeApi.session); the server checks it
//              in the same transaction as the write — a late request of a page that lost the session
//              is refused, it cannot overwrite what the new page saved
//
// The key is 128 random bits made for this page load and kept only in memory (not sessionStorage:
// a duplicated tab copies that, and would look like the same page). This is not an anti-cheat: the
// game still runs in the browser. It keeps progress from splitting between devices.

export type SessionState =
  /** created, nothing asked yet */
  | 'idle'
  | 'claiming'
  /** this page holds the session, confirmed by the server */
  | 'active'
  /** it held the session, but the server cannot be reached right now (may or may not still hold it) */
  | 'unconfirmed'
  /** another page took the session over: no matches, no rewards, no writes here */
  | 'superseded'
  /** the PRIME ID session ran out on this device (sign in again) */
  | 'signed-out'
  /** the claim did not get through (no connection, server error) — only an explicit retry claims again */
  | 'failed';

export interface SessionOptions {
  api: PrimeApi;
  /** This browser's random id (SaveSystem meta.device) — stored with the session, not a fingerprint. */
  device: string;
  /** Coarse device name shown on the other device («iPhone · Safari»). */
  label: string;
  clock?: () => number;
  heartbeatMs?: number;
  ttlMs?: number;
  /** Heartbeat by itself (browser). The checks call beat() directly. */
  autoTimers?: boolean;
  /** 1.8.3.1: the heartbeat while the player uses the page (default 4 s); `heartbeatMs` is the idle one. */
  activeMs?: number;
  /** 1.8.3.1: no touch / key for this long = the page only stays open (default 90 s). */
  idleAfterMs?: number;
}

/** 1.8.3.1: checks triggered by the player (touch, focus) — at most one per this gap. */
const NUDGE_GAP_MS = 1500;
/** 1.8.3.1: after «too many requests» the heartbeat slows down this long (the session stays as it was). */
const RATE_BACKOFF_MS = 60000;

function newKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** «iPhone · Safari», «Mac · Chrome»… from the user agent: only a hint for the player, never stored as an identity. */
export function deviceLabel(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Устройство';
  const br = /YaBrowser\//.test(ua) ? 'Яндекс Браузер' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /CriOS\/|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'браузер';
  return `${os} · ${br}`;
}

export class SessionManager {
  readonly key = newKey();
  generation = 0;
  state: SessionState = 'idle';
  /** When the server last confirmed this page holds the session (0: never). */
  lastConfirmed = 0;
  /** Who took the session over (shown in the message), if the server said. */
  holder = '';
  /** The page this one took over at its claim (if it was still active). */
  previous: { label: string } | null = null;
  heartbeatMs: number;
  ttlMs: number;
  /** 1.8.3.1: the heartbeat while the player uses the page. */
  readonly activeMs: number;
  private readonly idleAfterMs: number;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private paused = false;
  private beating: Promise<SessionState> | null = null;
  /** 1.8.3.1: last touch / key / focus on this page, last heartbeat sent, slow-down after a 429. */
  private lastInput = 0;
  private lastBeat = 0;
  private backoffUntil = 0;

  constructor(private readonly o: SessionOptions) {
    this.heartbeatMs = o.heartbeatMs ?? 20000;
    this.ttlMs = o.ttlMs ?? 75000;
    this.activeMs = o.activeMs ?? 4000;
    this.idleAfterMs = o.idleAfterMs ?? 90000;
    this.lastInput = this.now();
  }

  private now(): number {
    return (this.o.clock ?? Date.now)();
  }

  get token(): SessionToken | null {
    return this.generation > 0 ? { key: this.key, generation: this.generation } : null;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(state: SessionState): SessionState {
    const changed = state !== this.state;
    this.state = state;
    if (state === 'superseded' || state === 'signed-out') {
      this.stopTimer();
      // this page may not write any more: nothing carries the old session from now on
      if (this.o.api.session?.key === this.key) this.o.api.session = null;
    }
    if (changed) for (const fn of this.listeners) fn();
    return state;
  }

  /** The page may write to the cloud (it holds the session, or held it and is only offline). */
  get canWrite(): boolean {
    return this.state === 'active' || this.state === 'unconfirmed';
  }

  /**
   * The page may start a match under the PRIME ID: it holds the session and the server confirmed
   * so recently. When the server cannot be reached for longer than the session's lifetime, another
   * device may have taken over meanwhile — no new matches until that is known.
   */
  get canPlay(): boolean {
    return this.canWrite && this.now() - this.lastConfirmed < this.ttlMs;
  }

  /** Take the session for this page (opening the game, «Продолжить здесь», a first upload). */
  async claim(): Promise<SessionState> {
    if (this.state === 'claiming') return this.state;
    this.set('claiming');
    try {
      const r = await this.o.api.claimSession(this.key, this.o.label, this.o.device);
      this.generation = r.generation;
      this.previous = r.previous;
      this.heartbeatMs = r.heartbeatMs || this.heartbeatMs;
      this.ttlMs = r.ttlMs || this.ttlMs;
      this.lastConfirmed = this.now();
      this.holder = '';
      this.o.api.session = { key: this.key, generation: this.generation };
      this.set('active');
      this.schedule();
      return this.state;
    } catch (e) {
      return this.set(e instanceof PrimeApiError && e.kind === 'unauthorized' ? 'signed-out' : 'failed');
    }
  }

  /** «Still here». Only confirms or learns the session is gone — never claims it. */
  beat(): Promise<SessionState> {
    if (this.beating) return this.beating;
    this.beating = this.doBeat().finally(() => (this.beating = null));
    return this.beating;
  }

  private async doBeat(): Promise<SessionState> {
    const t = this.token;
    if (!t || !this.canWrite) return this.state;
    this.lastBeat = this.now();
    try {
      await this.o.api.heartbeat(t);
      this.lastConfirmed = this.now();
      this.set('active');
    } catch (e) {
      const err = e instanceof PrimeApiError ? e : new PrimeApiError('network', 'network', 0);
      if (err.kind === 'superseded') this.markSuperseded(err.data);
      else if (err.kind === 'unauthorized') this.set('signed-out');
      // the server answered «too many requests» (it is there): slow down, the session stays as it was
      else if (err.kind === 'rate') this.backoffUntil = this.now() + RATE_BACKOFF_MS;
      // offline / server trouble: still ours as far as we know; matches stop once it is too long ago
      else this.set('unconfirmed');
    }
    this.schedule();
    return this.state;
  }

  /**
   * 1.8.3.1: «is this page still the one that plays?» — answered from the last confirmation when it is
   * at most `maxAgeMs` old, otherwise asked now (a match is about to start).
   */
  check(maxAgeMs: number): Promise<SessionState> {
    if (this.state === 'active' && this.now() - this.lastConfirmed <= maxAgeMs) return Promise.resolve(this.state);
    return this.beat();
  }

  /**
   * 1.8.3.1: the player touched / focused the page: back to the quick heartbeat, and a check right away
   * if the last one is a little old (so another device's takeover shows the moment they look here).
   */
  noteActivity(): void {
    const t = this.now();
    this.lastInput = t;
    if (this.paused || !this.canWrite) return;
    if (t - this.lastBeat >= NUDGE_GAP_MS && t >= this.backoffUntil) {
      void this.beat();
      return;
    }
    // a slow (idle) heartbeat was planned: bring it forward
    if (this.timer && this.timerAt - t > this.activeMs) this.schedule();
  }

  /** 1.8.3.1: how long until the next heartbeat (quick while the player uses the page). */
  nextDelay(): number {
    const t = this.now();
    if (t < this.backoffUntil) return Math.max(this.heartbeatMs, 20000);
    return t - this.lastInput < this.idleAfterMs ? Math.min(this.activeMs, this.heartbeatMs) : this.heartbeatMs;
  }

  /** The server refused a write or a heartbeat: another page holds the session now. */
  markSuperseded(data: Record<string, unknown> = {}): void {
    if (typeof data.label === 'string') this.holder = data.label.slice(0, 48);
    this.set('superseded');
  }

  /** Give the session up (signing out / playing as a guest here). */
  async release(keepalive = false): Promise<void> {
    const t = this.token;
    this.stopTimer();
    if (!t || !this.canWrite) return;
    try {
      await this.o.api.releaseSession(t, keepalive);
    } catch {
      /* the next claim anywhere takes it over anyway */
    }
    this.set('signed-out');
  }

  // ----------------------------------------------------------------- timers
  /** The page went to the background: no heartbeats (they would only drain the battery). */
  pause(): void {
    this.paused = true;
    this.stopTimer();
  }

  /** Back in front: check at once whether this page still holds the session. */
  resume(): void {
    this.paused = false;
    this.lastInput = this.now();
    if (this.canWrite) void this.beat();
  }

  stop(): void {
    this.stopTimer();
    this.paused = true;
  }

  private schedule(): void {
    this.stopTimer();
    if (!this.o.autoTimers || this.paused || !this.canWrite) return;
    const ms = this.nextDelay();
    this.timerAt = this.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.beat();
    }, ms);
  }

  private stopTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
