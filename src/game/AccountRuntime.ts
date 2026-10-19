import type { ProfileId } from '../meta/SaveSystem';
import { AccountService, type LoginPlan } from '../net/AccountService';
import { AUTH_KEY, readAccounts, readSync, rememberName, userIdOf } from '../net/accountStore';
import { browserStorage } from '../net/build';
import type { NetworkConfig } from '../net/config';
import { PrimeApi, PrimeApiError, type Me, type RegisterInput, type RegisterResult, type ServerConfig } from '../net/PrimeApi';
import { SyncManager, type SyncStatus } from '../net/SyncManager';
import { accountAction, accountPanelHTML, showSyncDecision, syncLine } from '../ui/accountUI';
import type { Game } from './Game';

// Alpha 1.8.1–1.8.2 — the accounts layer of a running page (`npm run dev:accounts` today; a beta
// build in stage 2). It owns the API client, the AccountService (sign-in/out, switching) and — when
// this page plays an account — the SyncManager. PRIME ID reads `view()`; the dialogs live in
// ui/accountUI.ts. Who may register is read from the server (GET /api/prime/config), never assumed.

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
  | { kind: 'account'; nickname: string; email: string; status: SyncStatus; unsynced: boolean; syncedAt: number; conflict: string | null; signedIn: boolean };

export class AccountRuntime {
  api: PrimeApi | null = null;
  service: AccountService | null = null;
  sync: SyncManager | null = null;
  me: Me | null = null;
  serverUp: boolean | null = null;
  /** When the server check fails: nothing answers (down) or it answers but refuses this page (blocked, CORS). */
  serverProblem: 'down' | 'blocked' | null = null;
  /** 1.8.2: the server's registration mode (null: not known yet — then nothing is offered). */
  serverConfig: ServerConfig | null = null;
  private started = false;
  private listeners = new Set<() => void>();
  /** The decision dialog was already shown for this conflict (don't nag on every screen). */
  private promptedAt = -1;
  private lastCheck = 0;

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

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
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
      };
    }
    if (this.serverUp === false && !this.me) return { kind: 'server-down' };
    if (this.me && !this.me.verified) return { kind: 'unverified', nickname: this.me.nickname ?? '', email: this.me.email };
    if (this.me) return { kind: 'not-loaded', nickname: this.me.nickname ?? '', email: this.me.email };
    return this.serverUp === false ? { kind: 'server-down' } : { kind: 'guest' };
  }

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
    console.info(`[PRIME NETWORK] сервер ${this.config.apiUrl} · страница ${location.origin} · ${this.serverUp ? 'доступен' : this.serverProblem === 'blocked' ? 'отвечает, но не принимает запросы с этой страницы (CORS)' : 'не отвечает'}`);
    if (this.api.sessionRecord) {
      try {
        this.me = await this.api.refresh();
        rememberName(this.storage, this.me.id, this.me.nickname);
      } catch (e) {
        // offline: keep playing on the stored session; 401: signed out (the account's local copy stays)
        if (e instanceof PrimeApiError && e.kind !== 'network') this.me = null;
      }
    }
    this.started = true;
    const uid = this.playing;
    if (uid && this.g.save.writable) this.startSync(uid);
    this.wire();
    this.emit();
  }

  private startSync(uid: string): void {
    if (!this.api) return;
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

  private wire(): void {
    window.addEventListener('online', () => {
      this.sync?.soon(500);
      if (this.serverUp === false) void this.recheckServer();
    });
    document.addEventListener('visibilitychange', () => {
      const s = this.sync;
      if (!s || s.status === 'signed-out') return;
      // leaving the page: try to send what is waiting (not relied upon — it is retried next time anyway)
      if (document.hidden && s.hasUnsynced() && !s.blocked) void s.syncNow(true);
      // back after a while: maybe another device played meanwhile
      if (!document.hidden && Date.now() - this.lastCheck > 60_000) {
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
      this.serverConfig = { registration: 'disabled', inviteRequired: false, beta: false, mail: false };
    }
  }

  async recheckServer(): Promise<boolean> {
    if (!this.api) return false;
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
    this.emit();
    return this.serverUp;
  }

  /** The newer cloud version right at the start (nothing played yet here): take it without asking. */
  private maybePrompt(): void {
    const s = this.sync;
    if (!s || s.status !== 'conflict') return;
    const m = readSync(this.storage, this.g.save.profile);
    if (!m.conflict) return;
    if (m.conflict.kind === 'cloud-newer' && this.g.ui.current === 'title' && !s.hasUnsynced()) {
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
    if (uid && this.g.save.writable) this.startSync(uid);
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

  async resendVerification(): Promise<void> {
    const email = this.me?.email ?? this.api?.sessionRecord?.email;
    if (email) await this.api!.resendVerification(email);
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.api!.requestPasswordReset(email);
  }

  /** Switch the page to another local profile: no more writes here, then a full reload. */
  switchTo(p: ProfileId): void {
    this.service!.activate(p);
    this.reload();
  }

  reload(): void {
    this.sync?.stop();
    this.g.save.suspend();
    setTimeout(() => location.reload(), 300);
  }

  /** Sign out: try to send what is waiting first; the account's local copy stays on this device. */
  async logout(): Promise<void> {
    const s = this.sync;
    if (s && s.hasUnsynced() && !s.blocked) await s.syncNow().catch(() => s.status);
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
