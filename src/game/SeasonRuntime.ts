import { COSMETICS, isCosmeticId } from '../config/cosmetics.config';
import { FIGHTERS } from '../config/fighters';
import type { QuestDef } from '../config/events.config';
import type { FighterId } from '../config/types';
import type { MatchEventOutcome } from '../meta/EventManager';
import { PrimeApiError, type SeasonWallet } from '../net/PrimeApi';
import type { SeasonFight } from '../season/seasonMath';
import type { Game } from './Game';

// Alpha 1.9.7 — WINTER SHOWDOWN (R-22) in the game: the CANDY CANES wallet lives on the PRIME NETWORK server
// (lib/season.js). This page reports its finished career fights, asks the server to pay quests, the grand prize and
// the exchange, and mirrors the server's answer into the save (EventManager.applyWallet) — nothing here decides an
// amount, a quest or a price. A fight reported while offline waits in a small queue for this account (localStorage)
// and is sent later; the server's time bank and daily cap judge it then. A guest earns nothing.

/** Who may use the wallet on this page (as DAILY: a signed-in, verified PRIME ID holding the game session). */
export type SeasonGate = 'off' | 'guest' | 'unverified' | 'terms' | 'wait' | 'ok';

interface QueuedFight {
  op: string;
  event: string;
  fight: SeasonFight;
  seconds: number;
}

export interface SeasonActResult {
  ok: boolean;
  reason?: string;
  reward?: number;
  item?: string;
  kind?: 'cosmetic' | 'fighter';
}

const STALE_MS = 30_000;
const QUEUE_MAX = 20;
const queueKey = (uid: string) => `primetime-season-queue-${uid}`;

function newOp(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return 'ss_' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

const REASONS: Record<string, string> = {
  season_closed: 'WINTER SHOWDOWN уже завершён',
  season_not_started: 'WINTER SHOWDOWN ещё не начался',
  not_enough: 'Не хватает карамельных тростей',
  quest_not_done: 'Задание ещё не выполнено',
  grand_not_ready: 'Главный приз откроется после нужного числа заданий',
  season_off: 'Сезонные награды временно недоступны',
  session_required: 'Откройте игру заново, чтобы продолжить',
  not_verified: 'Подтвердите почту PRIME ID',
  terms_required: 'Примите обновлённые документы PRIME ID',
  offline: 'Нет связи с PRIME ID — попробуйте ещё раз',
};

export class SeasonRuntime {
  wallet: SeasonWallet | null = null;
  error = '';
  busy = false;
  private readAt = 0;
  private owner: string | null = null;
  private flushing: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  /** This account's reports waiting to be sent — in memory first; localStorage only keeps a copy across reloads. */
  private mem: QueuedFight[] | null = null;

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

  /** The active secure event (WINTER SHOWDOWN while it runs or is previewed), or null. */
  get eventId(): string | null {
    const e = this.g.events.active;
    return e?.secure ? e.id : null;
  }

  /** This server keeps the wallet of `eid` (a server before 1.9.7 keeps none: the event then pays nobody). */
  supports(eid: string | null): boolean {
    const c = this.g.account?.serverConfig?.season;
    return !!eid && !!c?.on && c.events.includes(eid);
  }

  gate(): SeasonGate {
    const a = this.g.account;
    if (!a || !this.supports(this.eventId)) return 'off';
    const uid = a.api?.userId ?? null;
    if (!uid || !a.api?.sessionRecord) return 'guest';
    if (a.playing !== uid) return 'guest';
    if (a.me && !a.me.verified) return 'unverified';
    if (a.termsNeeded()) return 'terms';
    if (!a.ready || !a.sync || a.sync.blocked) return 'wait';
    return 'ok';
  }

  /** The account / the season changed: who plays now, the mirror and the queued reports. */
  sync(): void {
    const ok = this.gate() === 'ok';
    this.g.events.secureOnline = ok;
    const owner = ok ? (this.g.account?.api?.userId ?? null) : null;
    if (owner !== this.owner) {
      this.owner = owner;
      this.mem = null;
      this.wallet = null;
      this.error = '';
      this.emit();
    }
    if (owner) void this.flush().then(() => this.refresh());
  }

  private age(): number {
    return this.readAt ? performance.now() - this.readAt : Infinity;
  }

  /** Read the wallet (`force`: even when just read). */
  async refresh(force = false): Promise<void> {
    const eid = this.eventId;
    const api = this.g.account?.api;
    if (!eid || !api || this.gate() !== 'ok') return;
    if (!force && this.wallet?.event === eid && this.age() < STALE_MS) return;
    try {
      this.take(await api.season<SeasonWallet>('GET', `?event=${encodeURIComponent(eid)}`));
      this.error = '';
    } catch (e) {
      this.error = e instanceof PrimeApiError ? (e.kind === 'network' ? 'offline' : e.code) : 'offline';
    }
    this.emit();
  }

  /** The server's wallet into the save (and every item it names into the roster / MY COLLECTION). */
  private take(w: SeasonWallet | undefined | null, wear = false): QuestDef[] {
    if (!w || typeof w.balance !== 'number') return [];
    this.wallet = w;
    this.readAt = performance.now();
    const fresh = this.g.events.applyWallet(w, wear);
    this.g.applyCosmetics();
    return fresh;
  }

  // ------------------------------------------------------------- career fights
  private queue(): QueuedFight[] {
    const uid = this.owner;
    if (!uid) return [];
    if (this.mem) return this.mem;
    let stored: QueuedFight[] = [];
    try {
      const v = JSON.parse(localStorage.getItem(queueKey(uid)) ?? '[]') as QueuedFight[];
      stored = Array.isArray(v) ? v.filter((x) => x && typeof x.op === 'string' && x.fight) : [];
    } catch {
      stored = [];
    }
    this.mem = stored;
    return this.mem;
  }

  private store(q: QueuedFight[]): void {
    const uid = this.owner;
    if (!uid) return;
    this.mem = q.slice(-QUEUE_MAX);
    try {
      if (this.mem.length) localStorage.setItem(queueKey(uid), JSON.stringify(this.mem));
      else localStorage.removeItem(queueKey(uid));
    } catch {
      /* storage blocked (a private window): the queue lives in memory until the page closes */
    }
  }

  /**
   * A finished career fight of the secure event: queued for this account and sent. Resolves with what the SERVER paid
   * (null: not sent now — it waits in the queue, or nobody may earn).
   */
  async report(o: MatchEventOutcome): Promise<{ paid: number; capped: boolean; completed: QuestDef[] } | null> {
    if (!o.secure || o.secure.guest || this.gate() !== 'ok') return null;
    const item: QueuedFight = { op: newOp(), event: o.eventId, fight: o.secure.fight, seconds: o.secure.seconds };
    this.store(this.queue().concat([item]));
    let res: { paid: number; capped: boolean; completed: QuestDef[] } | null = null;
    await this.flush((op, paid, capped, completed) => {
      if (op === item.op) res = { paid, capped, completed };
    });
    return res;
  }

  /** Send the queued reports in order (one at a time; a refused one is dropped, an unreachable server keeps them). */
  flush(onPaid?: (op: string, paid: number, capped: boolean, completed: QuestDef[]) => void): Promise<void> {
    if (this.flushing) return this.flushing.then(() => this.flush(onPaid));
    this.flushing = this.doFlush(onPaid).finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async doFlush(onPaid?: (op: string, paid: number, capped: boolean, completed: QuestDef[]) => void): Promise<void> {
    const api = this.g.account?.api;
    if (!api || this.gate() !== 'ok') return;
    for (;;) {
      const q = this.queue();
      const next = q[0];
      if (!next) return;
      try {
        const r = await api.season<{ ok: boolean; paid: number; capped?: boolean; state: SeasonWallet }>('POST', '/match', { event: next.event, op: next.op, fight: { ...next.fight, seconds: next.seconds } });
        const completed = this.take(r.state);
        onPaid?.(next.op, r.paid ?? 0, !!r.capped, completed);
      } catch (e) {
        const code = e instanceof PrimeApiError ? e.code : '';
        if (!(e instanceof PrimeApiError) || e.kind === 'network' || code === 'session_required' || e.status >= 500) {
          this.error = 'offline';
          return; // kept for later
        }
        if (code === 'fights_too_fast') return; // the time bank: later
        // refused for good (closed season, a too short fight, an unknown event): never sent again
      }
      this.store(this.queue().filter((x) => x.op !== next.op));
    }
  }

  // ------------------------------------------------------------- actions
  /** Claim a quest, the grand prize or an exchange item — the server decides; the mirror and the items follow. */
  async act(kind: 'quest' | 'grand' | 'exchange', arg = ''): Promise<SeasonActResult> {
    const eid = this.eventId;
    const api = this.g.account?.api;
    const gate = this.gate();
    if (!eid || !api || gate !== 'ok') return { ok: false, reason: gate === 'guest' || gate === 'off' ? 'Войдите в PRIME ID, чтобы получать карамельные трости' : gate === 'unverified' ? REASONS.not_verified : gate === 'terms' ? REASONS.terms_required : 'PRIME ID ещё загружается' };
    if (this.busy) return { ok: false, reason: 'Подождите…' };
    this.busy = true;
    this.emit();
    try {
      const body: Record<string, unknown> = { event: eid, op: newOp() };
      if (kind === 'quest') body.quest = arg;
      if (kind === 'exchange') body.item = arg;
      const r = await api.season<{ ok: boolean; reward?: number; item?: string; kind?: 'cosmetic' | 'fighter'; state: SeasonWallet }>('POST', `/${kind}`, body);
      // a fresh item is worn / selected at once (the save then proves it to the server: lib/earned.js)
      this.take(r.state, kind !== 'quest');
      return { ok: true, reward: r.reward, item: r.item, kind: r.kind };
    } catch (e) {
      const code = e instanceof PrimeApiError ? (e.kind === 'network' ? 'offline' : e.code) : 'offline';
      const st = e instanceof PrimeApiError ? ((e.data.state as SeasonWallet | undefined) ?? null) : null;
      if (st) this.take(st);
      return { ok: false, reason: REASONS[code] ?? 'PRIME ID не принял запрос — попробуйте позже' };
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Display name of an exchange item. */
  static itemName(id: string): string {
    if (isCosmeticId(id)) return COSMETICS[id].name;
    return FIGHTERS[id as FighterId]?.name ?? id;
  }
}
