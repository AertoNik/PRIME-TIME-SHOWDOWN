import { entitlementsKnown, setEntitlements } from '../meta/entitlements';
import { isTestPay } from '../meta/Payments';
import { inRoster } from '../meta/roster';
import type { ProfileId } from '../meta/SaveSystem';
import { AccountService, type LoginPlan } from '../net/AccountService';
import { AUTH_KEY, emptySyncMeta, forgetAccountLocally, readAccounts, readSync, rememberName, userIdOf, writeSync } from '../net/accountStore';
import { readCloudText } from '../net/cloudSave';
import { browserStorage } from '../net/build';
import type { NetworkConfig } from '../net/config';
import { PrimeApi, PrimeApiError, type CloudSave, type Me, type RegisterInput, type RegisterResult, type ServerConfig } from '../net/PrimeApi';
import { solvePow } from '../net/pow';
import { SessionManager, deviceLabel } from '../net/SessionManager';
import { SyncManager, type SyncStatus } from '../net/SyncManager';
import { accountAction, accountPanelHTML, cloudLabel, explainGate, showKeptDevice, showSessionTaken, showSyncDecision, syncLine } from '../ui/accountUI';
import { showLegalAccept } from '../ui/legalUI';
import type { CloudState } from '../ui/cloudPill';
import type { Game } from './Game';

// Alpha 1.8.1–1.8.3 — the accounts layer of a running page. It owns the API client, the
// AccountService (sign-in/out, switching) and — when this page plays an account — the SyncManager.
// PRIME ID reads `view()`; the dialogs live in ui/accountUI.ts. Who may register is read from the
// server (GET /api/prime/config), never assumed.
//
// 1.8.3 PRIME CLOUD 2.0 — with a server that enforces game sessions (config `sessions: 1`):
//   - opening the game on an account claims the account's ONE game session (SessionManager); any
//     other tab / browser / device of the account loses it and shows «PRIME ID ОТКРЫТ НА ДРУГОМ
//     УСТРОЙСТВЕ» with «Продолжить здесь» (which reloads the page — and the reload claims);
//   - the claim is followed by reconcile(): the account's current progress is loaded automatically
//     (no import, no choice in the ordinary case); only then may a match start (`gate()`);
//   - while the server cannot confirm the session for longer than its lifetime, no new match starts
//     under the PRIME ID (another device may have taken over) — playing as a guest is offered;
//   - a page that lost the session starts no match, pays no reward and writes nothing.
// With a 1.8.2 server (or PRIME_SESSIONS=off) everything works exactly as in 1.8.2.

export type AccountView =
  | { kind: 'starting' }
  | { kind: 'server-down' }
  /** Signed out; the page plays the guest career. */
  | { kind: 'guest' }
  /** Signed in, email not confirmed: the page still plays the guest career. */
  | { kind: 'unverified'; nickname: string; email: string }
  /** Signed in and confirmed, but the account is not loaded on this page yet (a choice was put off). */
  | { kind: 'not-loaded'; nickname: string; email: string }
  /** The page plays the account. */
  | { kind: 'account'; nickname: string; email: string; status: SyncStatus; unsynced: boolean; syncedAt: number; conflict: string | null; signedIn: boolean; gate: PlayGate | null; cloud2: boolean };

/**
 * 1.8.3: why a match under the PRIME ID cannot start right now (null: it can). 1.8.4: 'terms' — the
 * account has documents to accept (or the age question to answer) before PRIME CLOUD continues.
 */
export type PlayGate = 'loading' | 'offline' | 'superseded' | 'signed-out' | 'terms';

/** 1.8.3.1: before a match the session must have been confirmed at most this long ago… */
const FRESH_MS = 1000;
/** …otherwise it is asked, waiting at most this long for the answer. */
const FRESH_WAIT_MS = 2500;

export class AccountRuntime {
  api: PrimeApi | null = null;
  service: AccountService | null = null;
  sync: SyncManager | null = null;
  /** 1.8.3: this page's game session (only with a server that has sessions, while it plays an account). */
  session: SessionManager | null = null;
  me: Me | null = null;
  serverUp: boolean | null = null;
  /** When the server check fails: nothing answers (down) or it answers but refuses this page (blocked, CORS). */
  serverProblem: 'down' | 'blocked' | null = null;
  /** 1.8.2: the server's registration mode (null: not known yet — then nothing is offered). */
  serverConfig: ServerConfig | null = null;
  /** 1.8.3: the account's progress is loaded and compared with PRIME CLOUD — matches may start. */
  ready = false;
  private started = false;
  private listeners = new Set<() => void>();
  /** The decision dialog was already shown for this conflict (don't nag on every screen). */
  private promptedAt = -1;
  private lastCheck = 0;
  /** 1.8.3: this page has claimed (or tried to) at least once — later claims only on an explicit action. */
  private activated = false;
  private activating: Promise<void> | null = null;
  private lostShown = false;
  /** 1.8.4: the «accept the documents» window was shown on this page already (asked once, then on a tap). */
  private termsAsked = false;
  /** 1.8.8 stage 4: whose PRIME SHOP rights are in entitlements.ts (undefined: not decided yet). */
  private rightsOwner: string | null | undefined = undefined;
  private rightsSeq = 0;

  constructor(
    readonly g: Game,
    readonly config: NetworkConfig,
  ) {}

  private get storage() {
    return browserStorage()!;
  }

  /** The account this page plays (null: the guest career). */
  get playing(): string | null {
    return userIdOf(this.g.save.profile);
  }

  /**
   * 1.8.3: does this server enforce game sessions? Not known yet (it was unreachable at start) counts
   * as yes: until the server says otherwise, no match starts on an account it cannot confirm.
   */
  get cloud2(): boolean {
    return this.serverConfig ? this.serverConfig.sessions : true;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    // 1.8.8 stage 4: the paid items follow the signed-in PRIME ID (cheap unless the account changed)
    this.refreshRights(false);
    for (const fn of this.listeners) fn();
  }

  // ------------------------------------------------------- 1.8.8 stage 4: PRIME SHOP rights
  /**
   * Whose PRIME SHOP rights this page may use: the signed-in PRIME ID — while it plays its own career or the
   * guest career on this device; never while another account's career is loaded.
   */
  private rightsFor(): string | null {
    const uid = this.api?.userId ?? null;
    if (!uid) return null;
    const playing = this.playing;
    return !playing || playing === uid ? uid : null;
  }

  /**
   * Keep entitlements.ts in step with the signed-in PRIME ID. Another account (or none) → the list is emptied
   * AT ONCE (never another account's items, not even for a moment), then read from the server. `force`: read
   * again now (the shop opens, a purchase was confirmed). Never kept on the device: offline, paid items wait
   * for PRIME NETWORK instead of trusting a copy anybody could edit.
   */
  refreshRights(force: boolean): void {
    const owner = this.rightsFor();
    const changed = owner !== this.rightsOwner;
    if (changed) {
      this.rightsOwner = owner;
      this.rightsSeq++;
      // nobody signed in: known to own nothing; an account: unknown until the server answers
      setEntitlements([], owner === null);
      if (owner === null) this.afterRights();
    }
    if (!owner || !this.api || !this.serverConfig?.shopPayments || (!changed && !force)) return;
    const seq = ++this.rightsSeq;
    this.api
      .purchases()
      .then((r) => {
        if (seq !== this.rightsSeq || this.rightsOwner !== owner) return;
        // (rights of Robokassa's test mode — staging, the demonstration — are shown as test purchases)
        setEntitlements(r.owned, true, isTestPay(r.env) ? 'test' : 'purchase');
        this.afterRights();
        this.emit();
      })
      .catch(() => {
        /* offline / signed out: the next account event or the shop asks again */
      });
  }

  /** The server's answer about one order brings the account's rights along (PRIME CHECKOUT): use them now. */
  applyRights(owned: readonly string[]): void {
    const owner = this.rightsFor();
    if (!owner || owner !== this.rightsOwner) return;
    this.rightsSeq++;
    setEntitlements(owned, true, isTestPay(this.serverConfig?.shop?.env) ? 'test' : 'purchase');
    this.afterRights();
    this.emit();
  }

  /**
   * A fighter selected through a purchase that is not there any more (refunded, another account): back to
   * Ray — only once the list is the server's answer (an unanswered list corrects nothing).
   */
  private afterRights(): void {
    const s = this.g.save.data;
    if (!entitlementsKnown() || !this.g.save.writable || inRoster(s, s.selected)) return;
    this.g.career.select('ray');
  }

  nickname(id: string | null = this.playing): string {
    if (!id) return '';
    if (this.me && this.me.id === id && this.me.nickname) return this.me.nickname;
    return readAccounts(this.storage).names[id] ?? 'PRODUCER';
  }

  view(): AccountView {
    if (!this.started) return { kind: 'starting' };
    const uid = this.playing;
    if (uid) {
      const s = this.sync;
      const m = readSync(this.storage, this.g.save.profile);
      return {
        kind: 'account',
        nickname: this.nickname(uid),
        email: this.me?.id === uid ? this.me.email : (this.api?.sessionRecord?.id === uid ? this.api.sessionRecord.email : ''),
        status: s ? s.status : 'idle',
        unsynced: s ? s.hasUnsynced() : true,
        syncedAt: m.syncedAt,
        conflict: m.conflict ? m.conflict.kind : null,
        signedIn: !!this.api?.sessionRecord && this.api.sessionRecord.id === uid,
        gate: this.gate(),
        cloud2: this.cloud2,
      };
    }
    if (this.serverUp === false && !this.me) return { kind: 'server-down' };
    if (this.me && !this.me.verified) return { kind: 'unverified', nickname: this.me.nickname ?? '', email: this.me.email };
    if (this.me) return { kind: 'not-loaded', nickname: this.me.nickname ?? '', email: this.me.email };
    return this.serverUp === false ? { kind: 'server-down' } : { kind: 'guest' };
  }

  // ------------------------------------------------------------- 1.8.3 gate
  /**
   * Why a match under the PRIME ID cannot start now (null: it can). Guests and 1.8.2 servers are
   * never held back.
   */
  gate(): PlayGate | null {
    if (!this.playing || !this.cloud2) return null;
    if (!this.started) return 'loading';
    if (this.termsNeeded()) return 'terms';
    const s = this.session;
    // no session: not signed in to this account here — unless the save itself is in trouble (another
    // tab holds it, damaged, newer): the save dialogs of 1.8 handle that
    if (!s) return this.g.save.writable ? 'signed-out' : null;
    switch (s.state) {
      case 'superseded':
        return 'superseded';
      case 'signed-out':
        return 'signed-out';
      case 'failed':
        return 'offline';
      case 'idle':
      case 'claiming':
        return 'loading';
    }
    if (!this.ready) return s.state === 'unconfirmed' ? 'offline' : 'loading';
    return s.canPlay ? null : 'offline';
  }

  /** 1.8.4: what the signed-in account still has to accept ([] = nothing; a server older than 1.8.4 says nothing). */
  legalNeeds(): string[] {
    return this.me?.legalNeeds ?? [];
  }

  /** 1.8.4: the account this page plays waits for its documents (PRIME CLOUD does not continue until then). */
  termsNeeded(): boolean {
    return !!this.playing && this.me?.id === this.playing && this.legalNeeds().length > 0;
  }

  /** 1.8.4: accept the documents / answer the age question; PRIME CLOUD continues right away. */
  async acceptLegal(b: { accept: Record<string, number>; privacy?: number; lang: 'ru' | 'en'; age?: number; country?: string }): Promise<string[]> {
    const needs = await this.api!.acceptLegal(b);
    if (this.me) this.me = { ...this.me, legalNeeds: needs };
    this.emit();
    if (!needs.length && this.playing && this.me?.id === this.playing && this.g.save.writable) {
      if (this.cloud2) {
        if (!this.session) this.startSession(this.playing);
        else void this.activate();
      } else this.startSync(this.playing);
    }
    return needs;
  }

  /** 1.8.4: show the «documents» window for the account this page plays (once by itself; again on a tap). */
  askTerms(force = false): void {
    if (!this.me || !this.legalNeeds().length) return;
    if (this.termsAsked && !force) return;
    this.termsAsked = true;
    showLegalAccept(this.g, this.legalNeeds(), () => this.emit());
  }

  /** 1.8.4: a fresh registration challenge, solved (the form starts it while the player types). */
  async solveChallenge(signal?: AbortSignal): Promise<{ id: string; nonce: string } | undefined> {
    if (!this.serverConfig?.pow) return undefined;
    const c = await this.api!.challenge();
    return { id: c.id, nonce: await solvePow(c.salt, c.bits, signal) };
  }

  /** 1.8.4: everything the server keeps about the signed-in account. */
  exportData(): Promise<Record<string, unknown>> {
    return this.api!.exportData();
  }

  /**
   * 1.8.4: delete the signed-in account (password again). The server removes it with everything
   * attached; this device forgets its local copy too; the guest career stays. true = this page played
   * that account: it writes nothing more and must reload (after the player has read the message).
   */
  async deleteAccount(password: string): Promise<boolean> {
    const id = this.api?.sessionRecord?.id ?? this.me?.id ?? null;
    await this.api!.deleteAccount(password);
    this.me = null;
    if (!id) return false;
    const playing = this.playing === id;
    if (playing) {
      this.sync?.stop();
      this.session?.stop();
      this.g.save.suspend();
    }
    forgetAccountLocally(this.storage, id);
    this.emit();
    return playing;
  }

  /** 1.8.4: the language changed — PRIME ID draws itself again. */
  refreshView(): void {
    this.emit();
  }

  /** A finished match must not pay into the account: this page lost the game session. */
  rewardsBlocked(): boolean {
    return this.cloud2 && !!this.playing && this.session?.state === 'superseded';
  }

  /**
   * 1.8.3.1: a match is about to start and the last confirmation is a few seconds old — ask the server
   * first (another device may have taken over since the last heartbeat).
   */
  needsFreshCheck(): boolean {
    const s = this.session;
    return this.cloud2 && !!this.playing && !!s && s.state === 'active' && Date.now() - s.lastConfirmed > FRESH_MS;
  }

  /**
   * …that check: the answer of the server — or, if it is slow, the gate as it stands (still within
   * the session's lifetime: a slow network does not hold the match back). Never claims.
   */
  async confirmFresh(): Promise<PlayGate | null> {
    const s = this.session;
    if (s) await Promise.race([s.check(FRESH_MS), new Promise((r) => setTimeout(r, FRESH_WAIT_MS))]);
    return this.gate();
  }

  /** The tap on a match button met the gate: say why (and offer what can be done). */
  explainGate(why: PlayGate): void {
    explainGate(this.g, why);
  }

  /**
   * After the title tap: if the account is still being loaded, show «PRIME CLOUD — Синхронизация…»
   * and continue only once it is ready (or the player picks another way).
   */
  holdUntilReady(then: () => void): void {
    if (this.gate() !== 'loading') {
      then();
      return;
    }
    explainGate(this.g, 'loading', then);
  }

  // ------------------------------------------------------------------ start
  async init(): Promise<void> {
    try {
      // the SDK is downloaded only now; the session token lives in its LocalAuthStore (a token, never a password).
      // In a build without accounts this condition is the literal false: the import (and the SDK file) is not even emitted.
      if (import.meta.env.DEV || import.meta.env.VITE_PRIME_ACCOUNTS === 'beta' || import.meta.env.VITE_PRIME_ACCOUNTS === 'production') {
        const sdk = await import('pocketbase');
        // a real internet connection is slower than the Mac's own: a little more time per request
        this.api = new PrimeApi(new sdk.default(this.config.apiUrl, new sdk.LocalAuthStore(AUTH_KEY)), this.config.mode === 'remote' ? 15000 : 10000);
      }
      if (!this.api) throw new Error('no client');
    } catch {
      this.started = true;
      this.serverUp = false;
      this.emit();
      return;
    }
    this.service = new AccountService({ api: this.api, storage: this.storage, current: this.g.save });
    this.serverUp = await this.api.health();
    this.serverProblem = this.serverUp ? null : await this.diagnose();
    if (this.serverUp) await this.loadServerConfig();
    // one line for the developer's console: which server, from which page, with what result
    console.info(`[PRIME NETWORK] сервер ${this.config.apiUrl} · страница ${location.origin} · ${this.serverUp ? 'доступен' : this.serverProblem === 'blocked' ? 'отвечает, но не принимает запросы с этой страницы (CORS)' : 'не отвечает'}${this.serverConfig?.sessions ? ' · PRIME CLOUD 2.0 (одна активная сессия)' : ''}`);
    if (this.api.sessionRecord) {
      try {
        this.me = await this.api.refresh();
        rememberName(this.storage, this.me.id, this.me.nickname);
      } catch (e) {
        // offline: keep playing on the stored session; a busy shared address (429): the same, and ask again a little
        // later (PRIME ID and the producer look need the profile); 401: signed out (the account's local copy stays)
        if (e instanceof PrimeApiError && e.kind === 'rate') this.retryMe(1);
        else if (e instanceof PrimeApiError && e.kind !== 'network') this.me = null;
      }
    }
    this.started = true;
    const uid = this.playing;
    if (uid && this.g.save.writable) {
      if (this.cloud2) this.startSession(uid);
      else this.startSync(uid);
    }
    this.wire();
    this.emit();
  }

  /** 1.8.2: the account's uploads, no game session (a server without sessions). */
  private startSync(uid: string): void {
    if (!this.api) return;
    if (this.termsNeeded()) {
      // 1.8.4: (a server without game sessions) — nothing goes up before the documents are accepted
      this.askTerms();
      return;
    }
    this.sync?.stop();
    this.sync = new SyncManager({ save: this.g.save, api: this.api, storage: this.storage, autoTimers: true, onReplaced: () => this.reload() });
    this.sync.onChange(() => {
      this.emit();
      this.maybePrompt();
    });
    const session = this.api.sessionRecord;
    if (!session || session.id !== uid) {
      // the page plays this account's local copy, but nobody is signed in to it: no uploads until they are
      this.sync.status = 'signed-out';
      this.g.save.onSaved = () => this.emit();
      return;
    }
    this.lastCheck = Date.now();
    void this.sync.start();
  }

  /** 1.8.3: the account plays under a game session — claimed once the page is in front. */
  private startSession(uid: string): void {
    if (!this.api) return;
    const signed = this.api.sessionRecord;
    if (!signed || signed.id !== uid) {
      // no PRIME ID session on this device for this account: sign in first (the gate says so)
      this.session = null;
      this.g.save.onSaved = () => this.emit();
      return;
    }
    this.sync?.stop();
    this.session?.stop();
    const cfg = this.serverConfig;
    const session = new SessionManager({ api: this.api, device: this.g.save.meta.device, label: deviceLabel(), heartbeatMs: cfg?.heartbeatMs, ttlMs: cfg?.ttlMs, autoTimers: true });
    this.session = session;
    this.ready = false;
    this.sync = new SyncManager({ save: this.g.save, api: this.api, storage: this.storage, autoTimers: true, session, soonMs: 800, debounceMs: 10000, onReplaced: () => this.reload() });
    this.sync.onChange(() => {
      this.emit();
      this.maybePrompt();
    });
    session.onChange(() => {
      if (session.state === 'superseded') this.lost();
      this.emit();
    });
    // a page opened in the background claims only when the player looks at it
    if (document.visibilityState === 'visible') void this.activate();
  }

  /**
   * Claim the session and load the account's current progress (opening the game; «Повторить» after
   * a failed claim). Never called by a timer for a page that once held the session.
   */
  activate(): Promise<void> {
    if (this.activating) return this.activating;
    this.activating = this.doActivate().finally(() => (this.activating = null));
    return this.activating;
  }

  private async doActivate(): Promise<void> {
    const session = this.session;
    const sync = this.sync;
    if (!session || !sync) return;
    this.activated = true;
    // 1.8.4: documents to accept first — no claim, no upload until then (export and deletion stay open)
    if (this.termsNeeded()) {
      this.emit();
      this.askTerms();
      return;
    }
    this.emit();
    let st = await session.claim();
    if (st === 'failed') {
      // one quick second try for a blip right at the start; after that only «Повторить» claims
      await new Promise((r) => setTimeout(r, 2500));
      if (this.session !== session) return;
      st = await session.claim();
    }
    if (st !== 'active') {
      this.emit();
      return;
    }
    // (back from Robokassa's page the «previous» session is this very browser before it left to pay: no news)
    const selfAfterPayment = this.g.backFromPayment && session.previous?.label === deviceLabel();
    if (session.previous && !selfAfterPayment) this.g.ui.toast(`PRIME ID продолжен здесь · ${session.previous.label || 'другое устройство'} больше не играет`, true);
    const res = await sync.reconcile();
    if (res === 'reload') return; // the cloud version is in — the page reloads to read it
    if (res === 'failed') {
      this.emit();
      return;
    }
    // another tab of this browser managed one more write just before this one took over: read it
    if (this.g.save.storedChanged()) {
      this.reload();
      return;
    }
    this.ready = true;
    sync.startSession();
    this.emit();
    const m = readSync(this.storage, this.g.save.profile);
    if (m.notice) {
      m.notice = null;
      writeSync(this.storage, this.g.save.profile, m);
      showKeptDevice(this.g);
    }
    this.maybePrompt();
  }

  /** «Повторить» in the offline dialog: confirm the session (heartbeat) or — never held yet — claim it. */
  async retry(): Promise<void> {
    if (this.serverUp === false || !this.serverConfig) await this.recheckServer();
    const s = this.session;
    if (!s) return;
    if (!this.cloud2) return;
    if (s.state === 'failed' || s.state === 'idle') return this.activate();
    if (s.state === 'unconfirmed' || s.state === 'active') {
      await s.beat();
      if (s.state === 'active' && !this.ready) return this.activate();
      this.sync?.soon(300);
      this.emit();
    }
  }

  /** This page lost the game session (a heartbeat, a refused write, or another tab of this browser). */
  private lost(): void {
    this.ready = false;
    this.sync?.stop();
    // nothing more is written here, locally either: the page reloads to play again («Продолжить здесь»)
    this.g.save.suspend();
    this.g.pauseForAccount();
    if (!this.lostShown) {
      this.lostShown = true;
      showSessionTaken(this.g);
    }
  }

  /** Game.save.onLockLost: does the account handle another tab taking the profile? (1.8.3 server) */
  handlesLocalTakeover(): boolean {
    return !!this.playing && this.cloud2 && !!this.session;
  }

  /** Another tab of this browser took the account over: the same as losing the session to it. */
  onLocalTakeover(): void {
    // (the session's listener then stops this page; another tab of this browser claims the server session too)
    this.session?.markSuperseded({});
  }

  private wire(): void {
    // 1.8.3.1: the player looks at / touches this page — a quick check (never a claim): another device's
    // takeover shows at once instead of at the next heartbeat
    const nudge = () => {
      if (!document.hidden) this.session?.noteActivity();
    };
    window.addEventListener('focus', nudge);
    window.addEventListener('pointerdown', nudge, { capture: true, passive: true });
    window.addEventListener('keydown', nudge, { capture: true, passive: true });
    window.addEventListener('pageshow', (e) => {
      // back from the browser's page cache (iOS app switch, back/forward): visibilitychange may not come
      if ((e as PageTransitionEvent).persisted && this.activated && !document.hidden) this.session?.resume();
    });
    window.addEventListener('online', () => {
      if (this.serverUp === false) void this.recheckServer();
      const s = this.session;
      // a heartbeat only confirms — it never takes the session back
      if (s && (s.state === 'unconfirmed' || s.state === 'active')) void s.beat().then(() => this.sync?.soon(500));
      else if (!s) this.sync?.soon(500);
    });
    document.addEventListener('visibilitychange', () => {
      const s = this.sync;
      const session = this.session;
      if (session) {
        if (document.hidden) {
          session.pause();
        } else if (!this.activated) {
          // first time in front since the page was opened (in the background): this is the opening
          void this.activate();
        } else session.resume();
      }
      if (!s || s.status === 'signed-out') return;
      // leaving the page: try to send what is waiting (not relied upon — it is retried next time anyway)
      if (document.hidden && s.hasUnsynced() && !s.blocked) void s.syncNow(true);
      // back after a while: maybe another device played meanwhile (1.8.2; with sessions the heartbeat tells)
      if (!session && !document.hidden && Date.now() - this.lastCheck > 60_000) {
        this.lastCheck = Date.now();
        void s.check();
      }
    });
  }

  /**
   * Why the health check failed. A `no-cors` request reaches a running server even when its CORS
   * rules refuse this page (then only the real requests are blocked); it fails only when nothing listens.
   */
  private async diagnose(): Promise<'down' | 'blocked'> {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      await fetch(this.config.apiUrl + '/api/health', { mode: 'no-cors', cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      return 'blocked';
    } catch {
      return 'down';
    }
  }

  /** The registration mode as the server states it; unreadable → «disabled» (never offer what is closed). */
  async loadServerConfig(): Promise<void> {
    if (!this.api) return;
    try {
      this.serverConfig = await this.api.config();
    } catch {
      this.serverConfig = null;
    }
    // 1.8.8: the catalog shows the server's prices and «В ПРОДАЖЕ» only when this server really sells
    this.g.shop.setServer(this.serverConfig?.shop ?? null);
  }

  /** The profile was refused with 429 at start: asks again after 4, 8, 16, 30 s (never a tight loop), then gives up quietly. */
  private retryMe(n: number): void {
    setTimeout(async () => {
      if (this.me || !this.api?.sessionRecord) return;
      try {
        this.me = await this.api.refresh();
        rememberName(this.storage, this.me.id, this.me.nickname);
        this.emit();
      } catch (e) {
        if (e instanceof PrimeApiError && e.kind === 'rate' && n < 4) this.retryMe(n + 1);
      }
    }, Math.min(30000, 4000 * 2 ** (n - 1)));
  }

  async recheckServer(): Promise<boolean> {
    if (!this.api) return false;
    const before = this.serverConfig;
    this.serverUp = await this.api.health();
    this.serverProblem = this.serverUp ? null : await this.diagnose();
    if (this.serverUp) await this.loadServerConfig();
    if (this.serverUp && this.api.sessionRecord && !this.me) {
      try {
        this.me = await this.api.refresh();
      } catch {
        /* stays signed out */
      }
    }
    // the server turned out to be a 1.8.2 one (no sessions): the account plays by the 1.8.2 rules
    const uid = this.playing;
    if (uid && !before && this.serverConfig && !this.serverConfig.sessions && this.g.save.writable) {
      this.session?.stop();
      this.session = null;
      this.startSync(uid);
    }
    this.emit();
    return this.serverUp;
  }

  /** The newer cloud version right at the start (nothing played yet here): take it without asking (1.8.2). */
  private maybePrompt(): void {
    const s = this.sync;
    if (!s || s.status !== 'conflict') return;
    const m = readSync(this.storage, this.g.save.profile);
    if (!m.conflict) return;
    if (!this.session && m.conflict.kind === 'cloud-newer' && this.g.ui.current === 'title' && !s.hasUnsynced()) {
      void s.useCloud();
      return;
    }
    if (this.promptedAt === m.conflict.at || this.g.ui.current === 'battle' || this.g.ui.current === 'title' || this.g.ui.modalOpen) return;
    this.promptedAt = m.conflict.at;
    showSyncDecision(this.g);
  }

  // --------------------------------------------------------------- PRIME ID
  /** The account block of PRIME ID. */
  panelHTML(): string {
    return accountPanelHTML(this.g);
  }

  /** A tap in that block. */
  action(act: string): void {
    accountAction(this.g, act);
  }

  /** What the pass shows for the account this page plays (null: the guest pass of 1.8). */
  passInfo(): { nickname: string; line: string } | null {
    const v = this.view();
    return v.kind === 'account' ? { nickname: v.nickname, line: syncLine(v) } : null;
  }

  /** 1.8.3: the small PRIME CLOUD line of the main menu (null: the page plays the guest career). */
  cloudStatus(): CloudState | null {
    const v = this.view();
    return v.kind === 'account' ? cloudLabel(v) : null;
  }

  /** Game.goto: a decision that waited for the end of a fight is asked now. */
  onScreen(): void {
    this.maybePrompt();
  }

  // ------------------------------------------------------------------ actions
  async register(input: RegisterInput): Promise<RegisterResult> {
    let r: RegisterResult;
    try {
      r = await this.api!.register(input);
    } catch (e) {
      // the server closed registration meanwhile (or changed its mode): show what it says now
      if (e instanceof PrimeApiError && (e.code === 'registration_closed' || e.code === 'invite_required')) {
        await this.loadServerConfig();
        this.emit();
      }
      throw e;
    }
    // sign in right away (unconfirmed): the player can resend the email and sees the account waiting
    try {
      this.me = await this.api!.login(input.email, input.password);
    } catch {
      /* the account exists; they can sign in later */
    }
    this.emit();
    return r;
  }

  async login(email: string, password: string): Promise<LoginPlan> {
    this.me = await this.api!.login(email, password);
    this.serverUp = true;
    const plan = await this.service!.planFor(this.me);
    if (plan.kind === 'resume') this.resume();
    this.emit();
    return plan;
  }

  /** Signed in again to the account this page plays: uploads go on. */
  private resume(): void {
    const uid = this.playing;
    if (!uid || !this.g.save.writable) return;
    if (this.cloud2) {
      this.startSession(uid);
      this.activated = false;
      void this.activate();
    } else this.startSync(uid);
  }

  /**
   * 1.8.3: a first save of an account is written from this page (moving the guest career, a new
   * career, replacing a damaged save): the page claims that account's session first — the player
   * asked for it right here. Nothing to do with a 1.8.2 server.
   */
  private async claimFor(userId: string): Promise<void> {
    if (!this.cloud2 || !this.api) return;
    if (this.session && this.playing === userId && this.session.state === 'active') return;
    const s = new SessionManager({ api: this.api, device: this.g.save.meta.device, label: deviceLabel() });
    const st = await s.claim();
    if (st === 'signed-out') throw new PrimeApiError('unauthorized', 'unauthorized', 401);
    if (st !== 'active') throw new PrimeApiError('network', 'network', 0);
  }

  /** «Перенести прогресс» (see AccountService.transferGuest), under the account's session. */
  async transferGuest(me: Me): Promise<boolean> {
    await this.claimFor(me.id);
    return this.service!.transferGuest(me);
  }

  async startNewCareer(me: Me, replaceRevision = 0): Promise<boolean> {
    await this.claimFor(me.id);
    return this.service!.startNewCareer(me, replaceRevision);
  }

  async replaceDamagedWithGuest(me: Me, cloud: CloudSave): Promise<boolean> {
    await this.claimFor(me.id);
    return this.service!.replaceDamagedWithGuest(me, cloud);
  }

  /** «Я подтвердил email»: read the account again and continue the sign-in. */
  async recheckAccount(): Promise<LoginPlan | null> {
    if (!this.api?.sessionRecord) return null;
    this.me = await this.api.refresh();
    const plan = await this.service!.planFor(this.me);
    if (plan.kind === 'resume') this.resume();
    this.emit();
    return plan;
  }

  /** «Отправить ещё раз»: the seconds until the next letter may be asked for (1.8.4 servers say; older: 60). */
  async resendVerification(): Promise<number> {
    if (this.serverConfig?.accountTools && this.api?.sessionRecord) {
      const r = await this.api.resendMine();
      if (r.verified && this.me) this.me = { ...this.me, verified: true };
      return r.retryAfter || 60;
    }
    const email = this.me?.email ?? this.api?.sessionRecord?.email;
    if (email) await this.api!.resendVerification(email);
    return 60;
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.api!.requestPasswordReset(email);
  }

  /** Switch the page to another local profile: no more writes here, then a full reload. */
  switchTo(p: ProfileId): void {
    this.service!.activate(p);
    this.reload();
  }

  /**
   * 1.8.3.1: the account's copy on this device is unreadable — write the PRIME CLOUD version over it
   * (the unreadable text stays in its quarantine record) and reload: the account plays its real progress.
   */
  async reloadFromCloud(): Promise<boolean> {
    const uid = this.playing;
    if (!uid || !this.api?.sessionRecord || this.api.sessionRecord.id !== uid) return false;
    try {
      const cloud = await this.api.getSave();
      const read = cloud ? readCloudText(cloud.text) : null;
      if (!cloud || !read || !read.ok) return false;
      if (!this.g.save.applyExternal(read.data, read.extra, 'cloud')) return false;
      const m = emptySyncMeta();
      m.revision = cloud.revision;
      m.hash = cloud.hash;
      m.syncedAt = Date.now();
      writeSync(this.storage, this.g.save.profile, m);
      this.reload();
      return true;
    } catch {
      return false;
    }
  }

  /** 1.8.3: «Играть как гость» — the account stays signed in, its session is given up, the guest career plays. */
  async playAsGuest(): Promise<void> {
    await this.session?.release(true);
    this.switchTo('guest');
  }

  /** 1.8.3: «Продолжить здесь» — reload: opening the game is what claims the session. */
  continueHere(): void {
    this.g.save.suspend();
    setTimeout(() => location.reload(), 150);
  }

  reload(): void {
    this.sync?.stop();
    this.session?.stop();
    this.g.save.suspend();
    setTimeout(() => location.reload(), 300);
  }

  /** Sign out: try to send what is waiting first; the account's local copy stays on this device. */
  async logout(): Promise<void> {
    const s = this.sync;
    if (s && s.hasUnsynced() && !s.blocked) await s.syncNow().catch(() => s.status);
    await this.session?.release();
    this.service!.logout();
    this.me = null;
    this.reload();
  }

  /** Sign out of an account that is not loaded on this page (the page stays as it is). */
  signOutOnly(): void {
    this.api?.logout();
    this.me = null;
    this.emit();
  }
}
