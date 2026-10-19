import { profileKeys, type ProfileId, type SaveStorage } from '../meta/SaveSystem';

// Alpha 1.8.1 — the account layer's own small records in localStorage, kept apart from every
// save (the progress itself never holds account or sync data):
//
//   primetime-showdown-accounts-v1        which local profile this browser plays (guest or an
//                                         account) and whether the guest career was moved into one
//   primetime-showdown-auth-v1            the PocketBase session (SDK auth store) — token only, never a password
//   <profile save key>:sync               per account: the cloud revision and hash of the last
//                                         confirmed upload, a write in flight, a conflict to decide
//
// Each account plays its own local slot (`primetime-showdown-save-v1:user:<id>`, see profileKeys),
// so two accounts on one computer never share money, fighters, decks or the collection.

export const ACCOUNTS_KEY = 'primetime-showdown-accounts-v1';
export const AUTH_KEY = 'primetime-showdown-auth-v1';

const USER_ID_RE = /^[a-z0-9]{15}$/;

export interface GuestBinding {
  user: string;
  nickname: string;
  at: number;
}

export interface AccountsState {
  active: ProfileId;
  /** The guest career was moved into this account (it is not offered to a second account automatically). */
  guestBound: GuestBinding | null;
  /** Nicknames of the accounts played here (shown in PRIME ID even offline). */
  names: Record<string, string>;
}

export function userProfile(userId: string): ProfileId {
  if (!USER_ID_RE.test(userId)) throw new Error('bad account id');
  return `user:${userId}`;
}

export function userIdOf(p: ProfileId): string | null {
  if (p === 'guest') return null;
  const id = p.slice(5);
  return USER_ID_RE.test(id) ? id : null;
}

function read(st: SaveStorage | null, key: string): unknown {
  if (!st) return null;
  try {
    const raw = st.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(st: SaveStorage | null, key: string, v: unknown): boolean {
  if (!st) return false;
  try {
    st.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export function readAccounts(st: SaveStorage | null): AccountsState {
  const r = read(st, ACCOUNTS_KEY) as Partial<AccountsState> | null;
  const out: AccountsState = { active: 'guest', guestBound: null, names: {} };
  if (!r || typeof r !== 'object') return out;
  if (typeof r.active === 'string' && r.active !== 'guest' && userIdOf(r.active as ProfileId)) out.active = r.active as ProfileId;
  const b = r.guestBound as Partial<GuestBinding> | null | undefined;
  if (b && typeof b.user === 'string' && USER_ID_RE.test(b.user)) out.guestBound = { user: b.user, nickname: typeof b.nickname === 'string' ? b.nickname.slice(0, 16) : '', at: typeof b.at === 'number' ? b.at : 0 };
  if (r.names && typeof r.names === 'object') {
    for (const [id, n] of Object.entries(r.names as Record<string, unknown>)) if (USER_ID_RE.test(id) && typeof n === 'string') out.names[id] = n.slice(0, 16);
  }
  return out;
}

export function writeAccounts(st: SaveStorage | null, s: AccountsState): boolean {
  return write(st, ACCOUNTS_KEY, s);
}

/** Remember an account's nickname on this device (display only). */
export function rememberName(st: SaveStorage | null, userId: string, nickname: string | null): void {
  if (!nickname || !USER_ID_RE.test(userId)) return;
  const s = readAccounts(st);
  if (s.names[userId] === nickname) return;
  s.names[userId] = nickname;
  writeAccounts(st, s);
}

export function hasLocalSlot(st: SaveStorage | null, p: ProfileId): boolean {
  if (!st) return false;
  try {
    return st.getItem(profileKeys(p).save) !== null;
  } catch {
    return false;
  }
}

/**
 * The profile this page starts with: the active account only when its local copy is really here
 * (it is written before the switch). Otherwise the guest — never an empty slot that could later
 * be taken for the account's progress.
 */
export function bootProfile(st: SaveStorage | null): ProfileId {
  const s = readAccounts(st);
  return s.active !== 'guest' && hasLocalSlot(st, s.active) ? s.active : 'guest';
}

// ---------------------------------------------------------------------- sync meta
export type ConflictKind = 'diverged' | 'cloud-newer' | 'damaged' | 'missing';

export interface SyncMeta {
  /** Cloud revision and account-copy hash of the last upload/download the server confirmed (0 / '' = never). */
  revision: number;
  hash: string;
  syncedAt: number;
  /** An upload sent but not confirmed: retried with the SAME op, so the server can tell a repeat. */
  pending: { op: string; hash: string; base: number } | null;
  /** A decision the player has to make; nothing is uploaded automatically until it is made. */
  conflict: { kind: ConflictKind; revision: number; hash: string; at: number } | null;
  /** The cloud holds a schema this game cannot read (0 = none). */
  newer: number;
  /**
   * 1.8.3: something the player should hear once after the page reloads — «this device's unsent
   * progress was kept in the cloud copies, the account's current progress was loaded».
   */
  notice: { kind: 'kept-device'; at: number } | null;
}

export function emptySyncMeta(): SyncMeta {
  return { revision: 0, hash: '', syncedAt: 0, pending: null, conflict: null, newer: 0, notice: null };
}

export function readSync(st: SaveStorage | null, p: ProfileId): SyncMeta {
  const r = read(st, profileKeys(p).sync) as Partial<SyncMeta> | null;
  const m = emptySyncMeta();
  if (!r || typeof r !== 'object') return m;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  m.revision = n(r.revision);
  m.hash = typeof r.hash === 'string' ? r.hash : '';
  m.syncedAt = n(r.syncedAt);
  const pe = r.pending as SyncMeta['pending'];
  if (pe && typeof pe.op === 'string' && typeof pe.hash === 'string') m.pending = { op: pe.op, hash: pe.hash, base: n(pe.base) };
  const c = r.conflict as SyncMeta['conflict'];
  if (c && (c.kind === 'diverged' || c.kind === 'cloud-newer' || c.kind === 'damaged' || c.kind === 'missing')) m.conflict = { kind: c.kind, revision: n(c.revision), hash: typeof c.hash === 'string' ? c.hash : '', at: n(c.at) };
  m.newer = n(r.newer);
  const no = r.notice as SyncMeta['notice'];
  if (no && no.kind === 'kept-device') m.notice = { kind: 'kept-device', at: n(no.at) };
  return m;
}

export function writeSync(st: SaveStorage | null, p: ProfileId, m: SyncMeta): boolean {
  return write(st, profileKeys(p).sync, m);
}
