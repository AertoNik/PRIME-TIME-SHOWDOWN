import type PocketBase from 'pocketbase';
import { APP_VERSION } from '../config/version';

// Alpha 1.8.1 — the game's only door to the accounts server: the official PocketBase JS SDK plus
// the PRIME routes (backend/pb_hooks). Every failure becomes a PrimeApiError with a `kind` the
// game understands (no raw server error ever reaches the screen). The browser loads the SDK on
// demand (AccountRuntime): a build without accounts never contains or downloads it.

export type ApiFailKind = 'network' | 'unauthorized' | 'unverified' | 'forbidden' | 'notfound' | 'conflict' | 'rate' | 'invalid' | 'server'
  /** 1.8.3: another page holds the account's game session now (this page may not write). */
  | 'superseded'
  /** 1.8.3: the server wants a game session this request did not carry (a game older than the server). */
  | 'outdated';

export class PrimeApiError extends Error {
  constructor(
    readonly kind: ApiFailKind,
    readonly code: string,
    readonly status: number,
    readonly data: Record<string, unknown> = {},
  ) {
    super(code || kind);
    this.name = 'PrimeApiError';
  }
}

export interface Me {
  id: string;
  email: string;
  verified: boolean;
  nickname: string | null;
  created: string;
  save: { revision: number; hash: string; schema: number; updated: string } | null;
  /**
   * 1.8.4: what the account still has to accept before PRIME CLOUD continues ('terms', 'consent',
   * 'age'); [] = nothing (also from a server older than 1.8.4).
   */
  legalNeeds: string[];
}

export interface CloudSave {
  id: string;
  revision: number;
  schema: number;
  hash: string;
  client: string;
  device: string;
  reason: string;
  updated: string;
  text: string;
}

export interface HistoryEntry extends CloudSave {
  created: string;
}

export type PutReason = 'sync' | 'transfer' | 'new' | 'resolve-device' | 'replace-damaged';

export interface PutBody {
  base: number;
  text: string;
  hash: string;
  op: string;
  device: string;
  reason: PutReason;
}

export interface PutResult {
  revision: number;
  hash: string;
  /** The same request (op) had been applied already — nothing was written twice. */
  duplicate: boolean;
  /** …and the account has moved on since (another device wrote after it). */
  superseded: boolean;
  /** The cloud already held exactly this text. */
  unchanged: boolean;
}

export interface RegisterInput {
  nickname: string;
  email: string;
  password: string;
  passwordConfirm: string;
  /** 1.8.2: the PRIME NETWORK invite (closed beta). */
  invite?: string;
  /** 1.8.4: the age in full years and the country (ISO code) the player named — checked by the server. */
  age?: number;
  country?: string;
  lang?: 'ru' | 'en';
  /** 1.8.4: the versions of the documents the player ticked, and of the privacy notice shown. */
  accept?: Record<string, number>;
  privacy?: number;
  /** 1.8.4: the solved one-time challenge (proof of work). */
  pow?: { id: string; nonce: string };
  /** 1.8.4: the hidden field people never fill. */
  website?: string;
}

/** 1.8.4: a document of PRIME ID as the server lists it. */
export interface LegalDoc {
  v: number;
  required: boolean;
}
export type LegalInfo = Record<'terms' | 'consent' | 'privacy', LegalDoc>;

/** 1.8.4: the age rules the server applies (the game only explains them; the server decides). */
export interface AgeConfig {
  min: number;
  self: number;
  rules: Record<string, number>;
  closed: string[];
}

/** 1.8.4: a registration challenge (proof of work). */
export interface Challenge {
  id: string;
  salt: string;
  bits: number;
  expiresAt: number;
}

/** 1.8.2: what the server says about itself (GET /api/prime/config — public, no secrets). */
export type RegistrationMode = 'disabled' | 'invite_only' | 'public';
export interface ServerConfig {
  registration: RegistrationMode;
  inviteRequired: boolean;
  beta: boolean;
  /**
   * The server sends email (verification, password reset). false — including a server too old to
   * say — means none: accounts are confirmed by the administrator and the game promises no letter.
   */
  mail: boolean;
  /**
   * 1.8.3 PRIME CLOUD 2.0: the server enforces ONE active game session per account — cloud writes
   * must carry it. false (a 1.8.2 server, or PRIME_SESSIONS=off) = the 1.8.2 rules, unchanged.
   */
  sessions: boolean;
  heartbeatMs: number;
  ttlMs: number;
  /** 1.8.4: the documents (null: a server older than 1.8.4 — it records nothing). */
  legal: LegalInfo | null;
  age: AgeConfig | null;
  /** 1.8.4: registration needs a solved challenge. */
  pow: boolean;
  /** 1.8.4: export, deletion and «send again» with a timer exist on this server. */
  accountTools: boolean;
}

/** 1.8.3: the page's game session, sent with every cloud write (the key is random and lives only in memory). */
export interface SessionToken {
  key: string;
  generation: number;
}

export interface ClaimResult {
  generation: number;
  /** The page that held the session until now, if it was still active (its coarse device name). */
  previous: { label: string } | null;
  heartbeatMs: number;
  ttlMs: number;
}

/** After a registration: was the verification letter sent, or does the account wait for the administrator? */
export interface RegisterResult {
  mailSent: boolean;
  manual: boolean;
  /** 1.8.4: seconds until «send again» is allowed. */
  retryAfter: number;
}

/** Email as the server stores it (registration lower-cases it; sign-in compares exactly). */
export const normEmail = (e: string) => e.trim().toLowerCase();

function toError(e: unknown): PrimeApiError {
  if (e instanceof PrimeApiError) return e;
  const r = e as { status?: number; isAbort?: boolean; response?: Record<string, unknown> } | null;
  if (!r || typeof r !== 'object' || typeof r.status !== 'number') return new PrimeApiError('network', 'network', 0);
  const status = r.status;
  const body = (r.response ?? {}) as Record<string, unknown>;
  const code = typeof body.code === 'string' ? body.code : '';
  if (r.isAbort || status === 0) return new PrimeApiError('network', 'network', 0);
  if (status === 401) return new PrimeApiError('unauthorized', code || 'unauthorized', status, body);
  if (status === 403) return new PrimeApiError(code === 'not_verified' ? 'unverified' : 'forbidden', code || 'forbidden', status, body);
  if (status === 404) return new PrimeApiError('notfound', code || 'not_found', status, body);
  if (status === 409 && code === 'session_superseded') return new PrimeApiError('superseded', code, status, body);
  if (status === 409) return new PrimeApiError('conflict', code || 'conflict', status, body);
  if (status === 426) return new PrimeApiError('outdated', code || 'session_required', status, body);
  if (status === 429) return new PrimeApiError('rate', code || 'rate_limited', status, body);
  if (status >= 500) return new PrimeApiError('server', code || 'server_error', status, body);
  return new PrimeApiError('invalid', code || 'invalid', status, body);
}

type Rec = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0);

function cloudSaveOf(r: Rec): CloudSave {
  return {
    id: str(r.id),
    revision: int(r.revision),
    schema: int(r.schema),
    hash: str(r.hash),
    client: str(r.client),
    device: str(r.device),
    reason: str(r.reason),
    updated: str(r.updated),
    text: str(r.data),
  };
}

export class PrimeApi {
  /** 1.8.3: the game session this page holds (set by SessionManager); attached to every cloud write. */
  session: SessionToken | null = null;

  constructor(
    readonly pb: PocketBase,
    private readonly timeoutMs = 10000,
    /** Replaces fetch for every request (the checks use it to lose a reply on purpose). */
    private readonly fetchImpl?: typeof fetch,
  ) {
    // the SDK would cancel a request when the next one to the same endpoint starts — never wanted here
    pb.autoCancellation(false);
  }

  /** The account in the stored session (also offline; may be expired). */
  get sessionRecord(): { id: string; email: string; verified: boolean } | null {
    const r = this.pb.authStore.record as Record<string, unknown> | null;
    if (!this.pb.authStore.token || !r || typeof r.id !== 'string') return null;
    return { id: r.id, email: str(r.email), verified: r.verified === true };
  }

  get userId(): string | null {
    return this.pb.authStore.isValid ? (str(this.pb.authStore.record?.id) || null) : null;
  }

  get signedIn(): boolean {
    return this.userId !== null;
  }

  private async call<T>(fn: (o: { signal: AbortSignal; requestKey: null; keepalive?: boolean; fetch?: typeof fetch }) => Promise<T>, keepalive = false): Promise<T> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      return await fn({ signal: ctl.signal, requestKey: null, ...(keepalive ? { keepalive: true } : {}), ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}) });
    } catch (e) {
      throw toError(e);
    } finally {
      clearTimeout(t);
    }
  }

  async health(): Promise<boolean> {
    try {
      await this.call((o) => this.pb.health.check(o));
      return true;
    } catch {
      return false;
    }
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    const body: Rec = { nickname: input.nickname.trim(), email: normEmail(input.email), password: input.password, passwordConfirm: input.passwordConfirm };
    if (input.invite) body.invite = input.invite.trim();
    for (const k of ['age', 'country', 'lang', 'accept', 'privacy', 'pow', 'website'] as const) if (input[k] !== undefined) body[k] = input[k];
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/register', { ...o, method: 'POST', body }));
    return { mailSent: r.mailSent === true, manual: r.verification === 'manual', retryAfter: int(r.retryAfter) || 60 };
  }

  /** 1.8.4: a fresh one-time challenge for the next registration attempt. */
  async challenge(): Promise<Challenge> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/challenge', { ...o, method: 'POST' }));
    return { id: str(r.id), salt: str(r.salt), bits: int(r.bits), expiresAt: int(r.expiresAt) };
  }

  /** 1.8.4: «send the email again» for the signed-in account; the seconds until the next one. */
  async resendMine(): Promise<{ verified: boolean; retryAfter: number }> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/verify/resend', { ...o, method: 'POST' }));
    return { verified: r.verified === true, retryAfter: int(r.retryAfter) };
  }

  /** 1.8.4: accept the current documents (and answer the age question); what is still needed afterwards. */
  async acceptLegal(b: { accept: Record<string, number>; privacy?: number; lang: 'ru' | 'en'; age?: number; country?: string }): Promise<string[]> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/legal/accept', { ...o, method: 'POST', body: b }));
    const l = (r.legal ?? {}) as Rec;
    return Array.isArray(l.needs) ? l.needs.filter((x): x is string => typeof x === 'string') : [];
  }

  /** 1.8.4: everything the server keeps about the signed-in account. */
  async exportData(): Promise<Rec> {
    return this.call((o) => this.pb.send<Rec>('/api/prime/account/export', { ...o, method: 'GET' }));
  }

  /** 1.8.4: delete the signed-in account for good (its password again). */
  async deleteAccount(password: string): Promise<void> {
    await this.call((o) => this.pb.send('/api/prime/account/delete', { ...o, method: 'POST', body: { password, confirm: 'DELETE' } }));
    this.pb.authStore.clear();
  }

  /**
   * The server's registration mode. An unreadable or unknown answer counts as «disabled»: the game
   * never offers a registration the server has not opened.
   */
  async config(): Promise<ServerConfig> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/config', { ...o, method: 'GET' }));
    const m = r.registration === 'invite_only' || r.registration === 'public' ? r.registration : 'disabled';
    const sess = (r.session ?? {}) as Rec;
    const legal = r.legal && typeof r.legal === 'object' ? (r.legal as Rec) : null;
    const doc = (d: unknown): LegalDoc => ({ v: int((d as Rec | undefined)?.v), required: (d as Rec | undefined)?.required === true });
    const age = r.age && typeof r.age === 'object' ? (r.age as Rec) : null;
    return {
      registration: m,
      inviteRequired: m === 'invite_only',
      beta: m === 'invite_only',
      mail: r.mail === true,
      sessions: r.sessions === 1,
      heartbeatMs: Math.min(60000, Math.max(5000, int(sess.heartbeatMs) || 20000)),
      ttlMs: Math.min(300000, Math.max(30000, int(sess.ttlMs) || 75000)),
      legal: legal ? { terms: doc(legal.terms), consent: doc(legal.consent), privacy: doc(legal.privacy) } : null,
      age: age
        ? {
            min: int(age.min) || 13,
            self: int(age.self) || 18,
            rules: Object.fromEntries(Object.entries((age.rules ?? {}) as Rec).filter(([k, v]) => /^[A-Z]{2}$/.test(k) && typeof v === 'number')) as Record<string, number>,
            closed: Array.isArray(age.closed) ? age.closed.filter((c): c is string => typeof c === 'string') : [],
          }
        : null,
      pow: r.pow === 1,
      accountTools: r.account === 1,
    };
  }

  // ------------------------------------------------------------ game sessions (1.8.3)
  /** This page becomes the account's active game session (only on opening the game or «Продолжить здесь»). */
  async claimSession(key: string, label: string, device: string): Promise<ClaimResult> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/session/claim', { ...o, method: 'POST', body: { key, label, device } }));
    const prev = r.previous as Rec | null;
    return { generation: int(r.generation), previous: prev && typeof prev === 'object' ? { label: str(prev.label) } : null, heartbeatMs: int(r.heartbeatMs) || 20000, ttlMs: int(r.ttlMs) || 75000 };
  }

  /** «Still here» — never takes the session back (409 → kind 'superseded'). */
  async heartbeat(s: SessionToken): Promise<{ generation: number; renewed: boolean }> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/session/heartbeat', { ...o, method: 'POST', body: { session: s } }));
    return { generation: int(r.generation), renewed: r.renewed === true };
  }

  /** Free the session (signing out, playing as a guest here). Best effort. */
  async releaseSession(s: SessionToken, keepalive = false): Promise<void> {
    await this.call((o) => this.pb.send('/api/prime/session/release', { ...o, method: 'POST', body: { session: s } }), keepalive);
  }

  /** The session part of a cloud write's body (nothing when no session is held — a 1.8.2 server needs none). */
  private sessionBody(): { session?: SessionToken } {
    return this.session ? { session: { key: this.session.key, generation: this.session.generation } } : {};
  }

  async login(email: string, password: string): Promise<Me> {
    await this.call((o) => this.pb.collection('users').authWithPassword(normEmail(email), password, o));
    return this.me();
  }

  /** Renew the session token (and read the account again). 401 = the session is over: signed out. */
  async refresh(): Promise<Me> {
    try {
      await this.call((o) => this.pb.collection('users').authRefresh(o));
    } catch (e) {
      const err = toError(e);
      if (err.kind === 'unauthorized' || err.kind === 'notfound') this.pb.authStore.clear();
      throw err;
    }
    return this.me();
  }

  async me(): Promise<Me> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/me', { ...o, method: 'GET' }));
    const s = r.save as Rec | null;
    return {
      id: str(r.id),
      email: str(r.email),
      verified: r.verified === true,
      nickname: typeof r.nickname === 'string' ? r.nickname : null,
      created: str(r.created),
      save: s ? { revision: int(s.revision), hash: str(s.hash), schema: int(s.schema), updated: str(s.updated) } : null,
      legalNeeds: Array.isArray((r.legal as Rec | undefined)?.needs) ? ((r.legal as Rec).needs as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    };
  }

  logout(): void {
    this.pb.authStore.clear();
  }

  async resendVerification(email: string): Promise<void> {
    await this.call((o) => this.pb.collection('users').requestVerification(normEmail(email), o));
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.call((o) => this.pb.collection('users').requestPasswordReset(normEmail(email), o));
  }

  /** This account's cloud save (null: none yet). The collection rule lets an account read only its own. */
  async getSave(): Promise<CloudSave | null> {
    const list = await this.call((o) => this.pb.collection('saves').getList<Rec>(1, 1, { ...o, sort: '-updated' }));
    return list.items.length ? cloudSaveOf(list.items[0]) : null;
  }

  async putSave(b: PutBody, keepalive = false): Promise<PutResult> {
    const r = await this.call(
      (o) =>
        this.pb.send<Rec>('/api/prime/save', {
          ...o,
          method: 'PUT',
          body: { base: b.base, data: b.text, hash: b.hash, op: b.op, device: b.device, client: APP_VERSION, reason: b.reason, ...this.sessionBody() },
        }),
      keepalive,
    );
    return { revision: int(r.revision), hash: str(r.hash), duplicate: r.duplicate === true, superseded: r.superseded === true, unchanged: r.unchanged === true };
  }

  /** Keep a device version in the account history without making it current. */
  async archive(text: string, hash: string, reason: 'conflict-device' | 'before-restore' | 'session-device', device: string): Promise<void> {
    await this.call((o) => this.pb.send('/api/prime/save/archive', { ...o, method: 'POST', body: { data: text, hash, reason, device, client: APP_VERSION, ...this.sessionBody() } }));
  }

  /** The account's earlier versions, newest first (only its own — collection rule). */
  async history(): Promise<HistoryEntry[]> {
    const list = await this.call((o) => this.pb.collection('save_history').getList<Rec>(1, 20, { ...o, sort: '-created,-revision' }));
    return list.items.map((r) => ({ ...cloudSaveOf(r), created: str(r.created) }));
  }

  async restore(historyId: string, base: number, op: string, device: string): Promise<PutResult> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/save/restore', { ...o, method: 'POST', body: { history: historyId, base, op, device, ...this.sessionBody() } }));
    return { revision: int(r.revision), hash: str(r.hash), duplicate: r.duplicate === true, superseded: false, unchanged: r.unchanged === true };
  }
}
