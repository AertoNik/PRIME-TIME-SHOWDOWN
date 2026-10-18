/**
 * Alpha 1.8 — one tab per local profile. Every tab of the game used to keep its own copy of the
 * save in memory and write it whole, so two open tabs silently overwrote each other's progress.
 *
 * The tab that holds the profile keeps a small record in localStorage fresh (a heartbeat every
 * 2 s). A tab that finds a fresh record of another tab stays passive: the save system writes
 * nothing there and the game asks whether to play in this tab instead (taking the record over).
 * A tab that finds the record gone or stale (the holder was closed or crashed) simply takes it.
 * The holder notices a takeover at once through the `storage` event, at its next heartbeat or,
 * at the latest, right before its next write — the save system checks `owns()` every time.
 * No BroadcastChannel is needed: the record itself is the shared state, and the `storage`
 * event reaches the other tabs in every browser that has localStorage.
 */

/** The storage the lock needs (window.localStorage, or an in-memory double in the checks). */
export interface LockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A record older than this belongs to a tab that is gone (or frozen in the background). */
export const LOCK_STALE_MS = 8000;
/** How often the holder refreshes its record. */
export const LOCK_BEAT_MS = 2000;

interface LockRecord {
  id: string;
  at: number;
}

export function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class TabLock {
  /** This page's id (a new one on every load: a reload releases the record first, see start()). */
  readonly id: string;
  /** Called once when another tab takes the profile over. */
  onLost: (() => void) | null = null;
  private lost = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly storage: LockStorage,
    /** The record's key (one per local profile, see profileKeys). */
    readonly key: string,
    private readonly clock: () => number = () => Date.now(),
    id: string = randomId(),
  ) {
    this.id = id;
  }

  private read(): LockRecord | null {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      const r = JSON.parse(raw) as Partial<LockRecord>;
      return typeof r.id === 'string' && typeof r.at === 'number' ? { id: r.id, at: r.at } : null;
    } catch {
      return null;
    }
  }

  private write(): void {
    try {
      this.storage.setItem(this.key, JSON.stringify({ id: this.id, at: this.clock() }));
    } catch {
      /* storage full or blocked: the save system copes on its own */
    }
  }

  /** Take the profile unless another live tab holds it. */
  acquire(): 'ok' | 'busy' {
    const cur = this.read();
    if (cur && cur.id !== this.id && this.clock() - cur.at < LOCK_STALE_MS) return 'busy';
    this.write();
    this.lost = false;
    return this.owns() ? 'ok' : 'busy';
  }

  /** Does this tab hold the profile right now? */
  owns(): boolean {
    return this.read()?.id === this.id;
  }

  /** Has another tab taken the profile from this one? */
  get isLost(): boolean {
    return this.lost;
  }

  /** Heartbeat: keep the record fresh; finding someone else's record means this tab lost it. */
  beat(): void {
    if (this.lost) return;
    if (this.owns()) this.write();
    else this.markLost();
  }

  /** «Играть здесь»: this tab takes the profile (the other tab turns passive). */
  takeOver(): void {
    this.write();
    this.lost = false;
  }

  /** Give the profile up (closing or reloading the page). */
  release(): void {
    if (!this.owns()) return;
    try {
      this.storage.removeItem(this.key);
    } catch {
      /* nothing to do */
    }
  }

  /** The holder lost the profile (or a passive tab learns it never had it). */
  markLost(): void {
    if (this.lost) return;
    this.lost = true;
    this.onLost?.();
  }

  /** Browser wiring: heartbeat, other tabs' changes, closing, and coming back from the bfcache. */
  start(): void {
    if (typeof window === 'undefined' || this.timer) return;
    this.timer = setInterval(() => this.beat(), LOCK_BEAT_MS);
    window.addEventListener('storage', (e) => {
      if (e.key === this.key && !this.lost && !this.owns()) this.markLost();
    });
    // a closed or reloaded page frees the profile at once (a crashed one after LOCK_STALE_MS)
    window.addEventListener('pagehide', () => this.release());
    window.addEventListener('pageshow', (e) => {
      // back from the bfcache: the record was released on pagehide — take it again if it is free
      if ((e as PageTransitionEvent).persisted && !this.lost && this.acquire() === 'busy') this.markLost();
    });
  }
}
