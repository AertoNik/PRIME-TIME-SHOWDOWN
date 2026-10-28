import { PrimeApiError, type DailyStatus } from '../net/PrimeApi';
import type { DailyOutcome } from '../net/SyncManager';
import type { Game } from './Game';

// Alpha 1.8.9 — DAILY PRIME STREAK in the game: who may take a reward on this page, the streak as the PRIME NETWORK
// server sees it, and the claim (src/net/SyncManager.claimDaily — the server pays into the cloud save, this page's
// copy takes the same change). Nothing here decides a day, a streak or an amount: the window only shows them.

/**
 * May this page take today's reward?
 *   off         this game has no PRIME NETWORK, or the server has no DAILY PRIME STREAK (no gift is shown)
 *   guest       nobody is signed in (or another account's career is on screen) — sign in to take rewards
 *   unverified  the PRIME ID's email is not confirmed yet
 *   terms       the current documents wait to be accepted
 *   wait        the account's progress is still being loaded / compared with PRIME CLOUD, or another page plays it
 *   ok          signed in, in step with PRIME CLOUD, holding the game session
 */
export type DailyGate = 'off' | 'guest' | 'unverified' | 'terms' | 'wait' | 'ok';

/** Status older than this is read again when the window opens or the account changes. */
const STALE_MS = 60_000;

export class DailyRuntime {
  status: DailyStatus | null = null;
  /** The last read failed: 'offline' (no answer) or the server's code. */
  error = '';
  loading = false;
  claiming = false;
  /** performance.now() when status was read (the server's clock is used only as differences from its own «now»). */
  private readAt = 0;
  private owner: string | null = null;
  private rollover: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private reading: Promise<void> | null = null;

  constructor(private readonly g: Game) {
    // the account changes (signed in / out, ready, another account): a fresh status for whoever plays now
    g.account?.onChange(() => {
      const owner = this.gate() === 'ok' ? (g.account?.api?.userId ?? null) : null;
      if (owner !== this.owner) {
        this.owner = owner;
        this.status = null;
        this.error = '';
        this.emit();
      }
      if (owner && (!this.status || this.age() > STALE_MS * 5)) void this.refresh();
    });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private age(): number {
    return this.readAt ? performance.now() - this.readAt : Infinity;
  }

  /** Does this server have DAILY PRIME STREAK at all (the gift appears only then)? */
  get supported(): boolean {
    return !!this.g.account?.serverConfig?.daily;
  }

  gate(): DailyGate {
    const a = this.g.account;
    if (!a || !a.serverConfig?.daily) return 'off';
    const uid = a.api?.userId ?? null;
    if (!uid || !a.api?.sessionRecord) return 'guest';
    // another account's career is on this page: its rewards are not this PRIME ID's to take here
    if (a.playing !== uid) return 'guest';
    if (a.me && !a.me.verified) return 'unverified';
    if (a.termsNeeded()) return 'terms';
    if (!a.ready || !a.sync || a.sync.blocked) return 'wait';
    return 'ok';
  }

  /** A reward waits for this PRIME ID today (the menu lights the gift). */
  get giftReady(): boolean {
    return this.gate() === 'ok' && !!this.status?.canClaim && !this.claiming;
  }

  /** Milliseconds until the server's next game day (from its own clock), or null. */
  msToNextDay(): number | null {
    const s = this.status;
    if (!s || !s.nextDayAt || !s.now) return null;
    return Math.max(0, s.nextDayAt - s.now - this.age());
  }

  /** Read the streak from the server (`force`: even if just read). */
  refresh(force = false): Promise<void> {
    if (this.gate() !== 'ok') return Promise.resolve();
    if (!force && this.status && this.age() < STALE_MS) return Promise.resolve();
    if (this.reading) return this.reading;
    this.reading = this.doRefresh().finally(() => (this.reading = null));
    return this.reading;
  }

  private async doRefresh(): Promise<void> {
    const api = this.g.account?.api;
    if (!api) return;
    this.loading = true;
    this.emit();
    try {
      this.take(await api.dailyStatus());
      this.error = '';
    } catch (e) {
      this.error = e instanceof PrimeApiError ? (e.kind === 'network' ? 'offline' : e.code) : 'offline';
    } finally {
      this.loading = false;
      this.emit();
    }
  }

  private take(s: DailyStatus | null): void {
    if (!s) return;
    this.status = s;
    this.readAt = performance.now();
    // the next game day: read again shortly after the server's midnight (its clock, not this device's)
    if (this.rollover) clearTimeout(this.rollover);
    const ms = this.msToNextDay();
    if (ms !== null) this.rollover = setTimeout(() => void this.refresh(true), Math.min(ms + 2500, 0x7fffffff));
  }

  /**
   * Today's reward — through PRIME CLOUD (SyncManager.claimDaily): the server pays it into the cloud save and this
   * page's copy takes the same change. Resolves only with what the SERVER said; the window plays its show after.
   */
  async claim(): Promise<DailyOutcome> {
    const sync = this.g.account?.sync;
    if (this.gate() !== 'ok' || !sync) return { ok: false, code: 'not_ready', status: null };
    if (this.claiming) return { ok: false, code: 'not_ready', status: null };
    this.claiming = true;
    this.emit();
    try {
      const r = await sync.claimDaily();
      if (r.status) this.take(r.status);
      else if (r.ok || r.code === 'already_claimed') await this.doRefresh();
      return r;
    } finally {
      this.claiming = false;
      this.emit();
    }
  }
}
