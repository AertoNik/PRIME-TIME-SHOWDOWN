import { VERSION, defaultSave, hasProgress, summarize, SaveSystem, type ProfileId, type SaveStorage, type SaveSummary } from '../meta/SaveSystem';
import { randomId } from '../meta/TabLock';
import { bootProfile, emptySyncMeta, hasLocalSlot, readAccounts, readSync, rememberName, userProfile, writeAccounts, writeSync } from './accountStore';
import { cloudCopyOf, readCloudText } from './cloudSave';
import { PrimeApiError, type CloudSave, type Me, type PrimeApi, type PutReason } from './PrimeApi';

// Alpha 1.8.1 — signing in, out and switching the local profile, with no DOM: the UI asks, this
// does. The rules that keep progress safe:
//   - the local copy of an account is written BEFORE the page switches to it (and the switch is a
//     reload), so a new session can never start on an empty slot and upload it over the account;
//   - the guest career goes into an account only when the player says so, after a local safety
//     copy, and the switch happens only after the server confirmed the upload;
//   - a network error never turns into a clean profile: the page just stays where it was.

export type LoginPlan =
  /** Signed in, email not confirmed yet: the game stays on the guest career (no cloud writes allowed). */
  | { kind: 'unverified'; me: Me }
  /** This page already plays this account (signed in again after the session ran out). */
  | { kind: 'resume'; me: Me }
  /** The account's local copy is ready: switch (reload). */
  | { kind: 'switch'; me: Me; from: 'local' | 'cloud' }
  /** New account, the guest career has progress: ask «ПЕРЕНЕСТИ ПРОГРЕСС / НАЧАТЬ НОВУЮ КАРЬЕРУ». */
  | { kind: 'offer-transfer'; me: Me; guest: SaveSummary }
  /** New account and nothing to move (no guest progress, or it already went into another account). */
  | { kind: 'new-career'; me: Me; guestBoundTo: string | null }
  /** The account was saved by a newer game: not loaded (nothing is lost — update the game). */
  | { kind: 'cloud-newer'; me: Me; schema: number }
  /** The account's cloud save cannot be read: the player chooses what replaces it (it stays in the history). */
  | { kind: 'cloud-damaged'; me: Me; cloud: CloudSave };

export interface AccountServiceOptions {
  api: PrimeApi;
  storage: SaveStorage;
  /** The save the page runs now (guest or an account). */
  current: SaveSystem;
  clock?: () => number;
}

const newOp = () => 'op_' + randomId().replace(/[^A-Za-z0-9]/g, '').slice(0, 40);

export class AccountService {
  /** The id of a transfer/new-career upload in progress: a retry reuses it (the server dedupes). */
  private ops = new Map<string, string>();

  constructor(private readonly o: AccountServiceOptions) {}

  private now(): number {
    return (this.o.clock ?? Date.now)();
  }

  /** A save system for another local profile (no tab lock: it is written once, before the reload). */
  private slot(p: ProfileId): SaveSystem {
    return p === this.o.current.profile ? this.o.current : new SaveSystem({ profile: p, storage: this.o.storage, lock: null, clock: this.o.clock });
  }

  /** The guest career on this device (the running one, or read from its slot). */
  guestSave(): SaveSystem {
    return this.slot('guest');
  }

  /** What signing in leads to (nothing is switched yet). */
  async planFor(me: Me): Promise<LoginPlan> {
    rememberName(this.o.storage, me.id, me.nickname);
    if (!me.verified) return { kind: 'unverified', me };
    const p = userProfile(me.id);
    if (this.o.current.profile === p) return { kind: 'resume', me };
    if (hasLocalSlot(this.o.storage, p)) return { kind: 'switch', me, from: 'local' };
    const cloud = await this.o.api.getSave();
    if (cloud) {
      const read = readCloudText(cloud.text);
      if (!read.ok && read.reason === 'newer') return { kind: 'cloud-newer', me, schema: read.version };
      if (!read.ok) return { kind: 'cloud-damaged', me, cloud };
      this.writeSlot(p, cloud.text, cloud.revision, cloud.hash, 'cloud');
      return { kind: 'switch', me, from: 'cloud' };
    }
    const guest = this.guestSave();
    const bound = readAccounts(this.o.storage).guestBound;
    if (hasProgress(guest.data) && !bound && guest.status !== 'damaged' && guest.status !== 'newer') return { kind: 'offer-transfer', me, guest: summarize(guest.data, VERSION) };
    return { kind: 'new-career', me, guestBoundTo: bound && bound.user !== me.id ? bound.nickname || bound.user : null };
  }

  /**
   * Write an account's local slot from a cloud text (keeps this device's settings) and remember the
   * confirmed revision. The slot is complete before anything switches to it.
   */
  private writeSlot(p: ProfileId, text: string, revision: number, hash: string, reason: 'cloud' | 'account'): void {
    const read = readCloudText(text);
    if (!read.ok) throw new Error('cloud save unreadable');
    const s = this.slot(p);
    if (!s.applyExternal(read.data, read.extra, reason, this.o.current.data.settings)) throw new Error('local slot write failed');
    const m = emptySyncMeta();
    m.revision = revision;
    m.hash = hash;
    m.syncedAt = this.now();
    writeSync(this.o.storage, p, m);
  }

  /** Upload a first account save (base 0) — the same op on a retry; conflict = the account already has one. */
  private async firstUpload(me: Me, text: string, hash: string, reason: PutReason, base = 0): Promise<number> {
    const key = me.id + ':' + reason + ':' + hash;
    const op = this.ops.get(key) ?? newOp();
    this.ops.set(key, op);
    const r = await this.o.api.putSave({ base, text, hash, op, device: this.o.current.meta.device, reason });
    this.ops.delete(key);
    return r.revision;
  }

  /**
   * «ПЕРЕНЕСТИ ПРОГРЕСС»: the whole guest career (every saved field — fighters, decks, cards,
   * collection, seasonal progress, streaks, records…) becomes the account's first cloud save.
   * Order: local safety copy → read and check → upload → server confirms → account slot written →
   * guest marked as moved → switch. A failure at any step leaves the guest career exactly as it was.
   * Returns false when the account got a save in the meantime (sign in again to load it).
   */
  async transferGuest(me: Me): Promise<boolean> {
    const guest = this.guestSave();
    if (guest.status === 'damaged' || guest.status === 'newer') throw new Error('guest save not readable');
    guest.backupNow('account');
    const copy = cloudCopyOf(guest.serialized());
    const read = readCloudText(copy.text);
    if (!read.ok) throw new Error('guest save not readable');
    let revision: number;
    try {
      revision = await this.firstUpload(me, copy.text, copy.hash, 'transfer');
    } catch (e) {
      if (e instanceof PrimeApiError && e.kind === 'conflict' && e.code === 'conflict') return false;
      throw e;
    }
    const p = userProfile(me.id);
    const s = this.slot(p);
    if (!s.applyExternal(read.data, read.extra, 'account', guest.data.settings)) throw new Error('local slot write failed');
    const m = emptySyncMeta();
    m.revision = revision;
    m.hash = copy.hash;
    m.syncedAt = this.now();
    writeSync(this.o.storage, p, m);
    const acc = readAccounts(this.o.storage);
    acc.guestBound = { user: me.id, nickname: me.nickname ?? '', at: this.now() };
    acc.active = p;
    writeAccounts(this.o.storage, acc);
    return true;
  }

  /**
   * «НАЧАТЬ НОВУЮ КАРЬЕРУ» in the account (or replace a damaged cloud save with a new career).
   * The guest career stays untouched on this device. The tutorial is not forced again on a player
   * who has already seen it.
   */
  async startNewCareer(me: Me, replaceRevision = 0): Promise<boolean> {
    const fresh = defaultSave();
    const guestTutorial = this.guestSave().data.tutorial;
    if (guestTutorial !== 'pending') fresh.tutorial = 'done';
    const copy = cloudCopyOf(JSON.stringify({ ...fresh, version: VERSION }));
    let revision: number;
    try {
      revision = await this.firstUpload(me, copy.text, copy.hash, replaceRevision ? 'replace-damaged' : 'new', replaceRevision);
    } catch (e) {
      if (e instanceof PrimeApiError && e.kind === 'conflict' && e.code === 'conflict') return false;
      throw e;
    }
    this.writeSlot(userProfile(me.id), copy.text, revision, copy.hash, 'account');
    this.activate(userProfile(me.id));
    return true;
  }

  /** Replace a damaged cloud save with the guest career (the damaged one stays in the history). */
  async replaceDamagedWithGuest(me: Me, cloud: CloudSave): Promise<boolean> {
    const guest = this.guestSave();
    guest.backupNow('account');
    const copy = cloudCopyOf(guest.serialized());
    let revision: number;
    try {
      revision = await this.firstUpload(me, copy.text, copy.hash, 'replace-damaged', cloud.revision);
    } catch (e) {
      if (e instanceof PrimeApiError && e.kind === 'conflict') return false;
      throw e;
    }
    this.writeSlot(userProfile(me.id), copy.text, revision, copy.hash, 'account');
    const acc = readAccounts(this.o.storage);
    acc.guestBound = { user: me.id, nickname: me.nickname ?? '', at: this.now() };
    acc.active = userProfile(me.id);
    writeAccounts(this.o.storage, acc);
    return true;
  }

  /** Make a profile the one this browser plays (the caller suspends the save and reloads). */
  activate(p: ProfileId): void {
    const acc = readAccounts(this.o.storage);
    acc.active = p;
    writeAccounts(this.o.storage, acc);
  }

  /** Sign out: the session is cleared and the browser plays the guest career again. Account copies stay. */
  logout(): void {
    this.o.api.logout();
    this.activate('guest');
  }

  /** The profile the next page load will use. */
  nextProfile(): ProfileId {
    return bootProfile(this.o.storage);
  }

  /** Unconfirmed progress of the running account (for the sign-out warning). */
  unsynced(): boolean {
    const p = this.o.current.profile;
    if (p === 'guest') return false;
    const m = readSync(this.o.storage, p);
    return m.pending !== null || cloudCopyOf(this.o.current.serialized()).hash !== m.hash;
  }
}
