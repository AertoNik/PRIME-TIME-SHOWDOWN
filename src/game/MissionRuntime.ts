import { PrimeApiError, type MissionFightReport, type MissionsStatus } from '../net/PrimeApi';
import type { MatchResultData } from '../combat/types';
import type { Game } from './Game';

// Beta 2.6 — DAILY MISSIONS on this page: today's five missions as the PRIME NETWORK server states them, and the career
// fights reported to it. The server picks the missions, counts and grants the mini cases (lib/missions.js) — the game
// never decides that a mission is done. A fight reported while offline waits in a small queue for this account
// (localStorage) and is sent later (the server's time bank judges it then); a repeat of a report is counted once (its
// op). A guest or an unverified account has no missions. PRIME LEAGUE fights are counted by the server itself.

/** Who may have missions on this page (as DAILY: a signed-in, verified PRIME ID holding the game session). */
export type MissionGate = 'off' | 'guest' | 'unverified' | 'terms' | 'wait' | 'ok';

interface QueuedReport {
  op: string;
  fight: MissionFightReport;
}

const QUEUE_MAX = 20;
/** The status is read again when older than this (a window opened, the menu shown). */
const STALE_MS = 45000;
const queueKey = (uid: string) => `primetime-mission-queue-${uid}`;

function newOp(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return 'ms_' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class MissionRuntime {
  /** Today's missions as last read (null: not read, off, or another account). */
  status: MissionsStatus | null = null;
  error = '';
  private readAt = 0;
  private owner: string | null = null;
  private flushing: Promise<void> | null = null;
  private loading: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private mem: QueuedReport[] | null = null;

  constructor(private readonly g: Game) {
    g.account?.onChange(() => this.sync());
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  gate(): MissionGate {
    const a = this.g.account;
    if (!a || !a.serverConfig?.missions) return 'off';
    const uid = a.api?.userId ?? null;
    if (!uid || !a.api?.sessionRecord) return 'guest';
    if (a.playing !== uid) return 'guest';
    if (a.me && !a.me.verified) return 'unverified';
    if (a.termsNeeded()) return 'terms';
    if (!a.ready || !a.sync || a.sync.blocked) return 'wait';
    return 'ok';
  }

  /** The account changed: who plays now, the cached status and the queued reports. */
  sync(): void {
    const ok = this.gate() === 'ok';
    const owner = ok ? (this.g.account?.api?.userId ?? null) : null;
    if (owner !== this.owner) {
      this.owner = owner;
      this.mem = null;
      this.status = null;
      this.readAt = 0;
      this.error = '';
      this.emit();
    }
    if (owner) void this.flush().then(() => this.refresh());
  }

  /** Read today's missions (`force`: even when just read). Missions of another day are dropped at the day's turn. */
  refresh(force = false): Promise<void> {
    const api = this.g.account?.api;
    if (!api || this.gate() !== 'ok') return Promise.resolve();
    const turned = !!this.status && Date.now() >= this.status.resetsAt;
    if (!force && !turned && this.status && performance.now() - this.readAt < STALE_MS) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = api
      .missionsStatus()
      .then((s) => {
        this.status = s;
        this.readAt = performance.now();
        this.error = '';
      })
      .catch((e) => {
        this.error = e instanceof PrimeApiError ? (e.kind === 'network' ? 'offline' : e.code) : 'offline';
      })
      .finally(() => {
        this.loading = null;
        this.emit();
      });
    return this.loading;
  }

  /** Missions done whose mini case still waits to be opened (the menu's badge). */
  get casesReady(): number {
    return this.status?.cases.ready ?? 0;
  }

  /**
   * A finished career fight (Classic, PRIME CHALLENGE, BOSS) for today's missions. `onCompleted` gets the titles of the
   * missions the server says it completed. Never for PRIME LEAGUE (the server counts those), SURVIVAL or the tutorial.
   */
  async report(result: MatchResultData, meta: { fighter: string; rival: string; difficulty: 'rookie' | 'pro' | 'champion'; mode: 'classic' | 'challenge' | 'boss' }, onCompleted?: (titles: string[]) => void): Promise<void> {
    if (this.gate() !== 'ok') return;
    const fight: MissionFightReport = {
      outcome: result.outcome,
      method: result.method === 'ko' || result.method === 'time' ? result.method : 'forfeit',
      rating: Math.round(result.rating),
      combos: result.combos,
      perfects: result.perfects,
      difficulty: meta.difficulty,
      mode: meta.mode,
      fighter: meta.fighter,
      rival: meta.rival,
      seconds: Math.round(result.duration),
    };
    const item: QueuedReport = { op: newOp(), fight };
    this.store(this.queue().concat([item]));
    await this.flush((op, titles) => {
      if (op === item.op && titles.length) onCompleted?.(titles);
    });
  }

  /** Send the queued reports in order (one at a time; a refused one is dropped, an unreachable server keeps them). */
  flush(onDone?: (op: string, titles: string[]) => void): Promise<void> {
    if (this.flushing) return this.flushing.then(() => this.flush(onDone));
    this.flushing = this.doFlush(onDone).finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async doFlush(onDone?: (op: string, titles: string[]) => void): Promise<void> {
    const api = this.g.account?.api;
    if (!api || this.gate() !== 'ok') return;
    for (;;) {
      const next = this.queue()[0];
      if (!next) return;
      try {
        const r = await api.missionReport(next.op, next.fight);
        if (r.state) {
          const before = new Set((this.status?.missions ?? []).filter((m) => m.done).map((m) => m.id));
          this.status = r.state;
          this.readAt = performance.now();
          const titles = r.state.missions.filter((m) => m.done && r.completed.includes(m.id) && !before.has(m.id)).map((m) => m.title);
          onDone?.(next.op, titles);
          this.emit();
        }
      } catch (e) {
        const code = e instanceof PrimeApiError ? e.code : '';
        if (!(e instanceof PrimeApiError) || e.kind === 'network' || code === 'session_required' || e.status >= 500) {
          this.error = 'offline';
          return; // kept for later
        }
        if (code === 'fights_too_fast') return; // the time bank: later
        // refused for good (an invalid or too short fight, the feature off): never sent again
      }
      this.store(this.queue().filter((x) => x.op !== next.op));
    }
  }

  private queue(): QueuedReport[] {
    const uid = this.owner;
    if (!uid) return [];
    if (this.mem) return this.mem;
    let stored: QueuedReport[] = [];
    try {
      const v = JSON.parse(localStorage.getItem(queueKey(uid)) ?? '[]') as QueuedReport[];
      stored = Array.isArray(v) ? v.filter((x) => x && typeof x.op === 'string' && x.fight && typeof x.fight === 'object') : [];
    } catch {
      stored = [];
    }
    this.mem = stored;
    return this.mem;
  }

  private store(q: QueuedReport[]): void {
    const uid = this.owner;
    if (!uid) return;
    this.mem = q.slice(-QUEUE_MAX);
    try {
      if (this.mem.length) localStorage.setItem(queueKey(uid), JSON.stringify(this.mem));
      else localStorage.removeItem(queueKey(uid));
    } catch {
      /* private mode: the queue lives in memory only */
    }
  }
}
