import { VERSION, type ProfileId, type SaveStorage, type SaveSystem } from '../meta/SaveSystem';
import { randomId } from '../meta/TabLock';
import { readSync, writeSync, type SyncMeta } from './accountStore';
import { cloudCopyOf, readCloudText, type CloudCopy } from './cloudSave';
import { PrimeApiError, dailyStatusOf, type CloudSave, type DailyClaim, type DailyClaimResult, type DailyStatus, type HistoryEntry, type PrimeApi } from './PrimeApi';
import type { SessionManager } from './SessionManager';

// Alpha 1.8.1 — SYNC MANAGER: keeps the signed-in account's local copy and its cloud save in step.
//
//   game → SaveSystem (local, synchronous, works offline) → SyncManager → PocketBase
//
// The game never waits for the network: every local write only marks the copy as changed; the
// upload follows a little later (sooner after a finished match), one request at a time, and is
// retried with growing pauses when the server cannot be reached. «Synchronised» is shown only after
// the server confirmed the write. Each upload names the revision it is based on — the server takes it
// only if that is still the current one; otherwise the two versions are compared and, if both have
// changed, the player decides (nothing is merged, nothing is picked by level or money).
//
// 1.8.3 PRIME CLOUD 2.0 (a server with game sessions): only the page holding the account's game
// session uploads (SessionManager), and every upload carries that session. Right after the page
// claims the session, reconcile() makes PRIME CLOUD the source of truth automatically: a newer cloud
// is loaded, this device's own progress is uploaded when the cloud did not move — and when both moved
// (another device played on while this one had unsent progress) the cloud stays, this device's
// version goes into the account's cloud copies (and the local safety copies), and the player is told.

export type SyncStatus =
  | 'idle'
  | 'synced'
  | 'pending'
  | 'saving'
  | 'offline'
  | 'conflict'
  | 'newer'
  | 'signed-out'
  | 'unverified'
  | 'rejected'
  | 'error'
  /** 1.8.3: another page holds the account's game session — this page uploads nothing */
  | 'superseded'
  /** 1.8.3: the server needs a game session this page cannot give (reload the game) */
  | 'outdated';

export type SyncDecision = 'in-sync' | 'upload' | 'adopt' | 'fast-forward' | 'conflict' | 'newer' | 'damaged' | 'missing';

/**
 * 1.8.9 DAILY PRIME STREAK — how a claim ended: paid (applied: the dollars went into this device's copy now; false —
 * the copy already held them), or why not: already claimed today (the server's status), offline (a claim sent and
 * unanswered is asked again with the same id), the page may not write / is not in step yet, a conflict, refused.
 */
export type DailyOutcome =
  | { ok: true; claim: DailyClaim; status: DailyStatus | null; applied: boolean }
  | { ok: false; code: 'already_claimed' | 'offline' | 'not_ready' | 'conflict' | 'no_cloud_save' | 'session' | 'refused'; status: DailyStatus | null };

/**
 * What to do, given what this device last confirmed (meta), its account copy now (localHash) and
 * the cloud save. Pure — the heart of the conflict rules:
 *   - same text → nothing to do (or just remember the cloud revision);
 *   - only this device changed → upload;
 *   - only the cloud changed → take the cloud version (fast-forward);
 *   - both changed (or the cloud went back in time) → a conflict for the player.
 */
export function decideSync(meta: Pick<SyncMeta, 'revision' | 'hash'>, localHash: string, cloud: { revision: number; hash: string; schema: number } | null, cloudReadable = true): SyncDecision {
  if (!cloud) return meta.revision === 0 ? 'upload' : 'missing';
  if (cloud.schema > VERSION) return 'newer';
  if (!cloudReadable) return 'damaged';
  if (cloud.hash === localHash) return cloud.revision === meta.revision && meta.hash === localHash ? 'in-sync' : 'adopt';
  const localChanged = localHash !== meta.hash;
  if (cloud.revision === meta.revision) {
    // the cloud text changed without a new revision (edited on the server): treat like a newer cloud
    if (cloud.hash !== meta.hash) return localChanged ? 'conflict' : 'fast-forward';
    return 'upload';
  }
  if (cloud.revision > meta.revision) return localChanged ? 'conflict' : 'fast-forward';
  return 'conflict'; // the server is behind what this device saw (its database was restored)
}

export interface SyncOptions {
  save: SaveSystem;
  api: PrimeApi;
  storage: SaveStorage;
  clock?: () => number;
  /** After the local copy was replaced from the cloud (the browser reloads the page). */
  onReplaced?: () => void;
  /** Delay before an ordinary change is uploaded (ms). */
  debounceMs?: number;
  /** Delay after a finished match (the match count grew). */
  soonMs?: number;
  /** Schedule uploads by itself (browser). The checks call syncNow() / check() directly. */
  autoTimers?: boolean;
  /** 1.8.3: the page's game session (a server with sessions) — uploads only while it may write. */
  session?: SessionManager;
}

const RETRY_MS = [5000, 15000, 30000, 60000];
const newOp = (prefix = 'op_') => prefix + randomId().replace(/[^A-Za-z0-9]/g, '').slice(0, 40);

export class SyncManager {
  status: SyncStatus = 'idle';
  /** Server code of the last failure (developer diagnostics). */
  detail = '';
  /** The cloud save as last seen (no text). */
  cloudInfo: { revision: number; hash: string; schema: number; updated: string; device: string } | null = null;
  readonly profile: ProfileId;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private busy: Promise<SyncStatus> | null = null;
  private failures = 0;
  private lastMatches: number;
  private stopped = false;

  constructor(private readonly o: SyncOptions) {
    this.profile = o.save.profile;
    this.lastMatches = o.save.data.matches;
    // 1.8.3: the page lost the account's game session (a heartbeat said so): nothing more goes up from here
    o.session?.onChange(() => {
      if (o.session!.state === 'superseded' && this.status !== 'superseded') {
        this.stop();
        this.set('superseded');
      }
    });
  }

  private now(): number {
    return (this.o.clock ?? Date.now)();
  }

  get meta(): SyncMeta {
    return readSync(this.o.storage, this.profile);
  }

  private setMeta(m: SyncMeta): void {
    writeSync(this.o.storage, this.profile, m);
  }

  /** The account copy of the local save right now. */
  local(): CloudCopy {
    return cloudCopyOf(this.o.save.serialized());
  }

  /** Progress on this device the server has not confirmed yet. */
  hasUnsynced(): boolean {
    const m = this.meta;
    return m.pending !== null || this.local().hash !== m.hash;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(status: SyncStatus, detail = ''): SyncStatus {
    this.status = status;
    this.detail = detail;
    for (const fn of this.listeners) fn();
    return status;
  }

  /** A decision or a sign-in is needed: no automatic upload until then. */
  get blocked(): boolean {
    const m = this.meta;
    if (this.o.session && !this.o.session.canWrite) return true;
    return m.conflict !== null || m.newer > 0 || this.status === 'signed-out' || this.status === 'unverified' || this.status === 'superseded' || this.status === 'outdated';
  }

  start(): Promise<SyncStatus> {
    this.o.save.onSaved = () => this.noteLocalChange();
    const m = this.meta;
    this.set(m.conflict ? 'conflict' : m.newer ? 'newer' : this.hasUnsynced() ? 'pending' : 'synced');
    return this.check();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.o.save.onSaved = null;
  }

  /**
   * 1.8.3: uploads go on from here (after reconcile, which just compared with the cloud). A change
   * still waiting (made before the reload, or while offline) goes out soon.
   */
  startSession(): void {
    this.stopped = false;
    this.o.save.onSaved = () => this.noteLocalChange();
    this.lastMatches = this.o.save.data.matches;
    if (this.hasUnsynced() && !this.blocked) {
      this.set('pending');
      this.schedule(this.o.soonMs ?? 3000);
    }
  }

  /** SaveSystem wrote locally (hooked to save.onSaved). */
  noteLocalChange(): void {
    if (this.stopped) return;
    const matches = this.o.save.data.matches;
    const soon = matches > this.lastMatches;
    this.lastMatches = matches;
    if (this.blocked) {
      this.set(this.status);
      return;
    }
    if (this.status !== 'saving') this.set(this.hasUnsynced() ? 'pending' : 'synced');
    if (this.status === 'pending' || this.status === 'saving') this.schedule(soon ? (this.o.soonMs ?? 3000) : (this.o.debounceMs ?? 20000));
  }

  /** Upload as soon as possible (button «Синхронизировать», the network came back). */
  soon(ms = 400): void {
    this.failures = 0;
    this.schedule(ms, true);
  }

  private schedule(ms: number, force = false): void {
    if (!this.o.autoTimers || this.stopped) return;
    const at = this.now() + ms;
    if (this.timer && !force && this.timerAt <= at) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, ms);
  }

  private retryLater(): void {
    this.schedule(RETRY_MS[Math.min(this.failures, RETRY_MS.length) - 1] ?? RETRY_MS[0]);
  }

  /** Upload the local copy if it changed (one request at a time). */
  syncNow(keepalive = false): Promise<SyncStatus> {
    if (this.busy) return this.busy;
    this.busy = this.upload(keepalive).finally(() => (this.busy = null));
    return this.busy;
  }

  /** Compare with the cloud save (at start, on return to the tab, after a refused upload). */
  check(): Promise<SyncStatus> {
    if (this.busy) return this.busy.then(() => this.check());
    this.busy = this.doCheck().finally(() => (this.busy = null));
    return this.busy;
  }

  private async upload(keepalive: boolean): Promise<SyncStatus> {
    if (this.stopped) return this.status;
    // 1.8.3: only the page that holds the account's game session writes
    if (this.o.session && !this.o.session.canWrite) return this.status;
    // 1.8.9: a daily claim still unanswered goes first — the server may already have written its revision
    if (this.meta.daily) {
      const d = await this.settleDaily();
      if (d === 'offline') return this.status;
    }
    let m = this.meta;
    if (m.conflict) return this.set('conflict');
    if (m.newer) return this.set('newer');
    if (this.status === 'signed-out' || this.status === 'unverified') return this.status;
    const local = this.local();
    if (!m.pending && local.hash === m.hash) {
      // nothing to send — but after a failure «synchronised» must come from the server, not be assumed
      if (this.status === 'offline' || this.status === 'error' || this.status === 'idle') return this.doCheck();
      this.failures = 0;
      return this.set('synced');
    }
    // an earlier upload is still unconfirmed and the progress changed since: first learn whether it
    // landed (otherwise the next write would look like a conflict with this device's own upload)
    if (m.pending && m.pending.hash !== local.hash) return this.doCheck();
    // a write already sent with this very text keeps its id: if it did land, the server says so
    const pending = m.pending && m.pending.hash === local.hash && m.pending.base === m.revision ? m.pending : { op: newOp(), hash: local.hash, base: m.revision };
    m.pending = pending;
    this.setMeta(m);
    this.set('saving');
    try {
      const r = await this.o.api.putSave({ base: pending.base, text: local.text, hash: local.hash, op: pending.op, device: this.o.save.meta.device, reason: 'sync' }, keepalive);
      m = this.meta;
      m.revision = r.revision;
      m.hash = local.hash;
      m.syncedAt = this.now();
      m.pending = null;
      this.setMeta(m);
      this.failures = 0;
      if (r.superseded) return this.doCheck(); // it had landed earlier, and another device wrote since
      const st = this.local().hash === m.hash ? 'synced' : 'pending';
      this.set(st);
      if (st === 'pending') this.schedule(this.o.soonMs ?? 3000);
      return st;
    } catch (e) {
      return this.failed(e);
    }
  }

  private failed(e: unknown): Promise<SyncStatus> | SyncStatus {
    const err = e instanceof PrimeApiError ? e : new PrimeApiError('network', 'network', 0);
    switch (err.kind) {
      case 'superseded':
        // another page holds the session: this write did not land (the server checked before writing),
        // and nothing more is sent from here
        this.o.session?.markSuperseded(err.data);
        this.stop();
        return this.set('superseded');
      case 'outdated':
        // the server enforces game sessions and this page has none (it started against an older
        // server): nothing is retried — the progress waits on this device until the game reloads
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        return this.set('outdated', err.code);
      case 'conflict': {
        if (err.code === 'schema_downgrade' || err.code === 'schema_unsupported') {
          const m = this.meta;
          m.newer = Math.max(VERSION + 1, Math.floor(Number(err.data.schema) || 0));
          m.pending = null;
          this.setMeta(m);
          return this.set('newer');
        }
        return this.doCheck();
      }
      case 'network':
        this.failures++;
        this.retryLater();
        return this.set('offline');
      case 'unauthorized':
        return this.set('signed-out');
      case 'unverified':
        return this.set('unverified');
      case 'rate':
        this.failures++;
        this.schedule(60000);
        return this.set('pending', 'rate_limited');
      case 'invalid': {
        // the server refuses this text: retrying the same text is pointless until the next change
        const m = this.meta;
        m.pending = null;
        this.setMeta(m);
        return this.set('rejected', err.code);
      }
      default:
        this.failures++;
        this.retryLater();
        return this.set('error', err.code);
    }
  }

  private async doCheck(): Promise<SyncStatus> {
    if (this.stopped) return this.status;
    let cloud: CloudSave | null;
    try {
      cloud = await this.o.api.getSave();
    } catch (e) {
      return this.failed(e);
    }
    const m = this.meta;
    this.cloudInfo = cloud ? { revision: cloud.revision, hash: cloud.hash, schema: cloud.schema, updated: cloud.updated, device: cloud.device } : null;
    if (m.pending) {
      if (cloud && cloud.hash === m.pending.hash) {
        // an upload whose reply was lost: the cloud holds exactly that text — it landed
        m.revision = cloud.revision;
        m.hash = cloud.hash;
        m.pending = null;
        m.syncedAt = this.now();
      } else if ((cloud ? cloud.revision : 0) === m.pending.base) m.pending = null; // it never landed
    }
    const local = this.local();
    const read = cloud ? readCloudText(cloud.text) : null;
    const readable = !read || read.ok || read.reason === 'newer';
    const d = decideSync(m, local.hash, cloud, readable);
    m.conflict = null;
    m.newer = 0;
    const conflict = (kind: NonNullable<SyncMeta['conflict']>['kind']) => {
      m.conflict = { kind, revision: cloud ? cloud.revision : 0, hash: cloud ? cloud.hash : '', at: this.now() };
      m.pending = null;
      this.setMeta(m);
      return this.set('conflict');
    };
    switch (d) {
      case 'in-sync':
        this.setMeta(m);
        this.failures = 0;
        return this.set('synced');
      case 'adopt':
        m.revision = cloud!.revision;
        m.hash = cloud!.hash;
        m.pending = null;
        m.syncedAt = this.now();
        this.setMeta(m);
        return this.set('synced');
      case 'upload':
        this.setMeta(m);
        return this.upload(false);
      case 'fast-forward':
        return conflict('cloud-newer');
      case 'conflict':
        return conflict('diverged');
      case 'damaged':
        return conflict('damaged');
      case 'missing':
        return conflict('missing');
      case 'newer':
        m.newer = cloud!.schema;
        m.pending = null;
        this.setMeta(m);
        return this.set('newer');
    }
  }

  // ------------------------------------------------------------- 1.8.3 reconcile
  /**
   * Right after this page claimed the account's game session: make the local copy and PRIME CLOUD
   * agree, without asking in the ordinary cases.
   *   'ok'      in step (this device's waiting progress uploaded if the cloud had not moved)
   *   'reload'  the cloud version was written here (the page reloads to read it)
   *   'decide'  the cloud save is damaged / missing / from a newer game: the usual dialog
   *   'failed'  the server could not be reached
   */
  async reconcile(): Promise<'ok' | 'reload' | 'decide' | 'failed'> {
    if (this.stopped) this.stopped = false;
    let cloud: CloudSave | null;
    try {
      cloud = await this.o.api.getSave();
    } catch (e) {
      await this.failed(e);
      return 'failed';
    }
    const m = this.meta;
    this.cloudInfo = cloud ? { revision: cloud.revision, hash: cloud.hash, schema: cloud.schema, updated: cloud.updated, device: cloud.device } : null;
    if (m.pending) {
      if (cloud && cloud.hash === m.pending.hash) {
        m.revision = cloud.revision;
        m.hash = cloud.hash;
        m.pending = null;
        m.syncedAt = this.now();
      } else if ((cloud ? cloud.revision : 0) === m.pending.base) m.pending = null;
    }
    const local = this.local();
    const read = cloud ? readCloudText(cloud.text) : null;
    const readable = !read || read.ok || read.reason === 'newer';
    const d = decideSync(m, local.hash, cloud, readable);
    m.conflict = null;
    m.newer = 0;
    switch (d) {
      case 'in-sync':
      case 'adopt':
        if (cloud) {
          m.revision = cloud.revision;
          m.hash = cloud.hash;
          m.syncedAt = this.now();
        }
        m.pending = null;
        this.setMeta(m);
        this.failures = 0;
        this.set('synced');
        return 'ok';
      case 'upload':
        // the cloud did not move since this device's last confirmed save: its own progress goes up
        this.setMeta(m);
        await this.upload(false);
        return this.status === 'superseded' ? 'failed' : 'ok';
      case 'fast-forward':
        this.setMeta(m);
        return this.replaceLocal(cloud!.text, cloud!.revision, cloud!.hash) ? 'reload' : 'failed';
      case 'conflict': {
        // both moved: PRIME CLOUD stays the account's truth; this device's unsent version is kept in
        // the account's cloud copies (and, by replaceLocal, in the local safety copies) — not merged
        try {
          await this.o.api.archive(local.text, local.hash, 'session-device', this.o.save.meta.device);
        } catch (e) {
          if (!(e instanceof PrimeApiError) || e.kind !== 'invalid') {
            await this.failed(e);
            return 'failed';
          }
        }
        m.pending = null;
        m.notice = { kind: 'kept-device', at: this.now() };
        this.setMeta(m);
        return this.replaceLocal(cloud!.text, cloud!.revision, cloud!.hash) ? 'reload' : 'failed';
      }
      case 'damaged':
      case 'missing': {
        m.conflict = { kind: d, revision: cloud ? cloud.revision : 0, hash: cloud ? cloud.hash : '', at: this.now() };
        m.pending = null;
        this.setMeta(m);
        this.set('conflict');
        return 'decide';
      }
      case 'newer':
        m.newer = cloud!.schema;
        m.pending = null;
        this.setMeta(m);
        this.set('newer');
        return 'decide';
    }
  }

  // ------------------------------------------------------------- 1.8.9 DAILY PRIME STREAK
  /**
   * Today's reward. The page's own progress goes up first, so the server writes the dollars into exactly the cloud
   * revision this device holds; the answer is then applied to this device's copy in place (money + amount and the
   * claim's mark — the very change the server made), no reload, no conflict. Runs one request at a time with the
   * uploads. A claim whose answer never came is asked again with the same id first (the server never pays twice).
   */
  async claimDaily(): Promise<DailyOutcome> {
    while (this.busy) await this.busy.catch(() => undefined);
    let done!: (s: SyncStatus) => void;
    this.busy = new Promise<SyncStatus>((r) => (done = r));
    try {
      return await this.doClaimDaily();
    } finally {
      this.busy = null;
      done(this.status);
    }
  }

  private async doClaimDaily(): Promise<DailyOutcome> {
    if (this.stopped || this.blocked) return { ok: false, code: 'not_ready', status: null };
    if (this.meta.daily) {
      const s = await this.settleDaily();
      if (s === 'offline') return { ok: false, code: 'offline', status: null };
      if (typeof s === 'object') return s;
    }
    // this device's progress first: the reward is written into the revision it is in step with
    const st = await this.upload(false);
    if (st !== 'synced') return { ok: false, code: st === 'offline' ? 'offline' : st === 'superseded' || st === 'outdated' ? 'session' : 'not_ready', status: null };
    const m = this.meta;
    m.daily = { op: newOp('daily_'), base: m.revision, at: this.now() };
    this.setMeta(m);
    const r = await this.sendDaily();
    return r === 'offline' ? { ok: false, code: 'offline', status: null } : r;
  }

  /** The unanswered claim, asked again: its outcome, or 'offline' (still unanswered) / 'none' (nothing pending). */
  private settleDaily(): Promise<DailyOutcome | 'offline' | 'none'> {
    return this.meta.daily ? this.sendDaily() : Promise.resolve('none');
  }

  private async sendDaily(): Promise<DailyOutcome | 'offline'> {
    const p = this.meta.daily!;
    let r: DailyClaimResult;
    try {
      r = await this.o.api.dailyClaim(p.op, p.base);
    } catch (e) {
      const err = e instanceof PrimeApiError ? e : new PrimeApiError('network', 'network', 0);
      if (err.kind === 'network' || err.kind === 'server' || err.kind === 'rate') {
        // unanswered (or the server is busy): the same id is asked again later — the reward is never lost or doubled
        this.set('offline', err.code);
        this.retryLater();
        return 'offline';
      }
      const m = this.meta;
      m.daily = null;
      this.setMeta(m);
      const status = err.data && typeof err.data.status === 'object' && err.data.status ? dailyStatusOf(err.data.status as Record<string, unknown>) : null;
      if (err.code === 'already_claimed' || err.code === 'daily_clock') return { ok: false, code: 'already_claimed', status };
      if (err.code === 'no_cloud_save') return { ok: false, code: 'no_cloud_save', status };
      if (err.kind === 'conflict') {
        await this.doCheck();
        return { ok: false, code: 'conflict', status };
      }
      if (err.kind === 'superseded' || err.kind === 'outdated' || err.kind === 'unauthorized' || err.kind === 'unverified') {
        await this.failed(err);
        return { ok: false, code: 'session', status };
      }
      return { ok: false, code: 'refused', status };
    }
    const applied = this.applyDaily(r);
    return { ok: true, claim: r.claim, status: r.status, applied };
  }

  /** The server's change, made to this device's copy too — once (the save's daily mark says which claim it holds). */
  private applyDaily(r: DailyClaimResult): boolean {
    const save = this.o.save;
    const fresh = save.data.daily.claims < r.claim.seq;
    if (fresh) {
      save.data.money = Math.max(0, save.data.money) + r.claim.money;
      save.data.daily = { claims: r.claim.seq, day: r.claim.day };
      const hook = save.onSaved;
      save.onSaved = null;
      save.save();
      save.onSaved = hook;
    }
    const m = this.meta;
    m.daily = null;
    // the cloud revision the reward was written into (never back to an older one: a late repeat changes nothing)
    if (fresh || m.revision < r.revision) {
      m.revision = r.revision;
      m.hash = r.hash;
      m.pending = null;
      m.syncedAt = this.now();
    }
    this.setMeta(m);
    this.failures = 0;
    // the same text as the cloud's (canonical JSON on both sides); anything else here goes up as usual
    const st = this.local().hash === m.hash ? 'synced' : 'pending';
    this.set(st);
    if (st === 'pending') this.schedule(this.o.soonMs ?? 3000);
    return fresh;
  }

  // ------------------------------------------------------------------ decisions
  /**
   * «Использовать это устройство»: this device's version becomes the account's — still through the
   * server's revision check (if the cloud moved again meanwhile, the conflict comes back with fresh
   * figures). The replaced cloud version stays in the account history.
   */
  async useDevice(): Promise<boolean> {
    let m = this.meta;
    const c = m.conflict;
    if (!c) return true;
    const local = this.local();
    const base = c.kind === 'missing' ? 0 : c.revision;
    const op = newOp();
    m.pending = { op, hash: local.hash, base };
    this.setMeta(m);
    this.set('saving');
    try {
      const r = await this.o.api.putSave({ base, text: local.text, hash: local.hash, op, device: this.o.save.meta.device, reason: c.kind === 'damaged' ? 'replace-damaged' : 'resolve-device' });
      m = this.meta;
      m.revision = r.revision;
      m.hash = local.hash;
      m.pending = null;
      m.conflict = null;
      m.syncedAt = this.now();
      this.setMeta(m);
      this.failures = 0;
      this.set('synced');
      return true;
    } catch (e) {
      m = this.meta;
      m.pending = null;
      this.setMeta(m);
      await this.failed(e);
      return false;
    }
  }

  /**
   * «Использовать облако» (or take the newer cloud version): this device's own version, if it has
   * unsynced progress, is kept in the account history first; then the local copy is replaced
   * (a local safety copy is made too) and the page reloads.
   */
  async useCloud(): Promise<boolean> {
    let cloud: CloudSave | null;
    try {
      cloud = await this.o.api.getSave();
    } catch (e) {
      await this.failed(e);
      return false;
    }
    if (!cloud) return false;
    const read = readCloudText(cloud.text);
    if (!read.ok) {
      await this.doCheck();
      return false;
    }
    const local = this.local();
    const m = this.meta;
    if (local.hash !== m.hash && local.hash !== cloud.hash) {
      try {
        await this.o.api.archive(local.text, local.hash, 'conflict-device', this.o.save.meta.device);
      } catch (e) {
        if (!(e instanceof PrimeApiError) || e.kind !== 'invalid') {
          await this.failed(e);
          return false;
        }
      }
    }
    return this.replaceLocal(cloud.text, cloud.revision, cloud.hash);
  }

  private replaceLocal(text: string, revision: number, hash: string): boolean {
    const read = readCloudText(text);
    if (!read.ok) return false;
    const hook = this.o.save.onSaved;
    this.o.save.onSaved = null;
    const ok = this.o.save.applyExternal(read.data, read.extra, 'cloud');
    this.o.save.onSaved = hook;
    if (!ok) {
      this.set('error', 'local_write');
      return false;
    }
    const m = this.meta;
    m.revision = revision;
    m.hash = hash;
    m.pending = null;
    m.conflict = null;
    m.newer = 0;
    m.syncedAt = this.now();
    this.setMeta(m);
    this.set('synced');
    this.o.onReplaced?.();
    return true;
  }

  /** The account's earlier versions (newest first). */
  history(): Promise<HistoryEntry[]> {
    return this.o.api.history();
  }

  /** Put a history copy back as a NEW cloud revision (unsynced progress here is kept in the history first). */
  async restore(h: HistoryEntry): Promise<boolean> {
    const read = readCloudText(h.text);
    if (!read.ok) return false;
    let cloud: CloudSave | null;
    try {
      cloud = await this.o.api.getSave();
    } catch (e) {
      await this.failed(e);
      return false;
    }
    const local = this.local();
    if (local.hash !== this.meta.hash && local.hash !== h.hash) {
      try {
        await this.o.api.archive(local.text, local.hash, 'before-restore', this.o.save.meta.device);
      } catch (e) {
        if (!(e instanceof PrimeApiError) || e.kind !== 'invalid') {
          await this.failed(e);
          return false;
        }
      }
    }
    try {
      const r = await this.o.api.restore(h.id, cloud ? cloud.revision : 0, newOp(), this.o.save.meta.device);
      return this.replaceLocal(h.text, r.revision, h.hash);
    } catch (e) {
      await this.failed(e);
      return false;
    }
  }
}
