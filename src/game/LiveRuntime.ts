import type { CardId, FighterId } from '../config/types';
import { LIVE, normalizeCode } from '../config/live.config';
import { SIM_VERSION } from '../league/simVersion';
import { LiveSession, type LiveEvent, type LiveRealtime } from '../live/session';
import { LiveApi, type LiveMatchView, type LiveRoom, type LiveStats } from '../net/LiveApi';
import { PrimeApiError } from '../net/PrimeApi';
import type { Game } from './Game';

/** Who may play LIVE DUELS now. */
export type LiveAccess = 'off' | 'guest' | 'unverified' | 'held' | 'outdated' | 'ready';

/** The invitation code in the page address (?duel=CODE), remembered until the player is signed in. */
const INVITE_KEY = 'primetime-live-invite';

/** Human words for the server's codes (never a technical code on screen). */
export const LIVE_ERRORS: Record<string, string> = {
  room_not_found: 'Комната с таким кодом не найдена. Проверьте код или попросите новую ссылку.',
  room_expired: 'Срок приглашения истёк. Попросите друга создать новую дуэль.',
  room_full: 'В этой комнате уже два игрока.',
  room_active: 'Вы уже в другой комнате LIVE DUELS.',
  room_closed: 'Комната закрыта.',
  bad_code: 'Код — 6 букв и цифр, например K7M2QX.',
  fighter_not_owned: 'Этот боец ещё не открыт в вашем PRIME ID.',
  card_not_allowed: 'В колоде есть карта, которой нет в вашем PRIME ID.',
  deck_duplicate: 'Карты в колоде не должны повторяться.',
  deck_size: 'В колоде должно быть 4 карты.',
  look_not_owned: 'Этот облик не куплен.',
  not_league_fighter: 'Этого бойца нельзя взять в дуэль.',
  pick_first: 'Сначала выберите бойца и колоду.',
  match_running: 'Бой уже идёт.',
  update_required: 'Сервер уже работает по новым правилам боя. Обновите страницу.',
  too_many_requests: 'Слишком много попыток. Подождите минуту.',
  live_off: 'LIVE DUELS сейчас выключены на сервере.',
  not_verified: 'Подтвердите почту PRIME ID, чтобы играть онлайн.',
  terms_required: 'Примите обновлённые документы PRIME ID.',
  network: 'Нет связи с сервером. Проверьте интернет.',
  timeout: 'Сервер не ответил вовремя. Попробуйте ещё раз.',
};

export function liveError(e: unknown): string {
  const code = e instanceof PrimeApiError ? e.code || e.kind : 'network';
  return LIVE_ERRORS[code] ?? 'Не получилось. Попробуйте ещё раз.';
}

/**
 * Beta 2.7 LIVE DUELS — the game's glue around a LiveSession: who may play, the room the player is in (also after
 * a reload), the fight's start and end (Game draws them), the connection state for the HUD.
 */
export class LiveRuntime {
  session: LiveSession | null = null;
  stats: LiveStats | null = null;
  /** The last settled match (the result screen). */
  last: LiveMatchView | null = null;
  error: string | null = null;
  private listeners = new Set<() => void>();
  private offSession: (() => void) | null = null;
  private lastPulseOk = 0;
  private resumed = false;

  constructor(private readonly g: Game) {
    // back from another app / tab (an iPhone suspends the page): «I am here» at once, not at the next heartbeat — the
    // missed journal entries come with the answer and the fight catches up on the next frame
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.session?.room) void this.session.pulse();
      });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }

  access(): LiveAccess {
    const acc = this.g.account;
    const cfg = acc?.serverConfig;
    if (!acc || !cfg || !cfg.live) return 'off';
    const v = acc.view();
    if (v.kind === 'unverified') return 'unverified';
    if (v.kind !== 'account') return 'guest';
    if (cfg.league.sim && cfg.league.sim !== SIM_VERSION) return 'outdated';
    if (v.gate) return 'held';
    return 'ready';
  }

  get room(): LiveRoom | null {
    return this.session?.room ?? null;
  }

  // ----------------------------------------------------------- invitation link
  /** ?duel=CODE in the address: remembered (until used) and taken out of the address bar. */
  readInvite(): void {
    try {
      const u = new URL(location.href);
      const raw = u.searchParams.get('duel');
      if (!raw) return;
      const code = normalizeCode(raw);
      if (code) sessionStorage.setItem(INVITE_KEY, code);
      u.searchParams.delete('duel');
      history.replaceState(history.state, '', u.pathname + (u.search ? u.search : '') + u.hash);
    } catch {
      /* no storage / no history: the code is simply typed */
    }
  }
  pendingInvite(): string | null {
    try {
      return sessionStorage.getItem(INVITE_KEY);
    } catch {
      return null;
    }
  }
  clearInvite(): void {
    try {
      sessionStorage.removeItem(INVITE_KEY);
    } catch {
      /* ignore */
    }
  }

  // ----------------------------------------------------------- the session
  private api(): LiveApi | null {
    const a = this.g.account?.api;
    return a ? new LiveApi(a) : null;
  }

  private realtime(): LiveRealtime | null {
    const a = this.g.account?.api;
    if (!a) return null;
    const pb = a.pb;
    return {
      subscribe: async (topic, cb) => {
        const off = await pb.realtime.subscribe(topic, (d: unknown) => cb(d));
        // a new connection (the SDK reconnects by itself) has a new id: the server must know it again
        const offConnect = await pb.realtime.subscribe('PB_CONNECT', () => {
          void this.session?.attach().catch(() => undefined);
        });
        return async () => {
          await off();
          await offConnect();
        };
      },
      clientId: () => pb.realtime.clientId,
    };
  }

  private ensureSession(): LiveSession | null {
    if (this.session) return this.session;
    const api = this.api();
    const rt = this.realtime();
    if (!api || !rt) return null;
    const s = new LiveSession(api, rt);
    this.offSession = s.on((e) => this.onEvent(e));
    const pulse = s.pulse.bind(s);
    s.pulse = async () => {
      await pulse();
      this.lastPulseOk = Date.now();
    };
    this.session = s;
    return s;
  }

  private onEvent(e: LiveEvent): void {
    if (e.type === 'start') {
      this.last = null;
      this.g.launchLive(e.match);
    } else if (e.type === 'rebuild') this.g.liveRebuild();
    else if (e.type === 'end') {
      this.last = e.match;
      this.g.liveEnded(e.match);
      void this.refreshStats();
    } else if (e.type === 'closed') {
      this.g.liveClosed(e.why);
    }
    this.emit();
  }

  /** Creates a room (or returns to the one this account already has). */
  async create(): Promise<void> {
    const s = this.ensureSession();
    if (!s) throw new PrimeApiError('network', 'network', 0);
    try {
      const r = await s.api.create();
      await s.enter(r.room);
    } catch (e) {
      if (e instanceof PrimeApiError && e.code === 'room_active' && e.data.room) {
        await s.enter(e.data.room as LiveRoom);
        return;
      }
      throw e;
    }
    this.emit();
  }

  async join(code: string): Promise<void> {
    const c = normalizeCode(code);
    if (!c) throw new PrimeApiError('invalid', 'bad_code', 400);
    const s = this.ensureSession();
    if (!s) throw new PrimeApiError('network', 'network', 0);
    const r = await s.api.join(c);
    this.clearInvite();
    await s.enter(r.room);
    this.emit();
  }

  /** After a reload / sign-in: the room (and the running match) this account is still in. */
  async resume(): Promise<boolean> {
    if (this.access() !== 'ready') return false;
    if (this.session?.room) return true;
    const api = this.api();
    if (!api) return false;
    const r = await api.active();
    if (!r.room) return false;
    const s = this.ensureSession();
    if (!s) return false;
    await s.enter(r.room, r.match ?? null);
    this.resumed = true;
    this.emit();
    return true;
  }

  async pick(fighter: FighterId, deck: CardId[], look: string | null): Promise<void> {
    const s = this.session;
    if (!s?.room) return;
    const r = await s.api.pick(s.room.id, fighter, deck, look);
    s.room = r.room;
    this.emit();
  }

  async ready(on: boolean): Promise<void> {
    await this.session?.ready(on);
    this.emit();
  }

  async rematch(want: boolean): Promise<void> {
    await this.session?.rematch(want);
    this.emit();
  }

  async leave(): Promise<void> {
    const s = this.session;
    if (!s) return;
    this.offSession?.();
    this.offSession = null;
    this.session = null;
    await s.leave();
    this.emit();
  }

  async surrender(): Promise<void> {
    await this.session?.surrender();
  }

  async refreshStats(): Promise<void> {
    const api = this.api();
    if (!api || this.access() !== 'ready') return;
    try {
      this.stats = await api.stats();
      this.emit();
    } catch {
      /* the stats wait for the next time */
    }
  }

  // ----------------------------------------------------------- the fight
  /** The player's card (index in the hand of its own side): false = not sent. */
  play(handIndex: number): boolean {
    const s = this.session;
    const d = s?.driver;
    if (!s || !d) return false;
    const hand = d.match.hands[d.side];
    const card = hand.hand[handIndex];
    if (!card) return false;
    return s.play(hand.deck.indexOf(card));
  }

  pending(deckIndex: number): boolean {
    return !!this.session?.pending.has(deckIndex);
  }

  /** The HUD's connection chip. */
  net(): 'ok' | 'peer' | 'self' {
    const s = this.session;
    if (!s?.room) return 'ok';
    if (this.lastPulseOk && Date.now() - this.lastPulseOk > LIVE.staleMs) return 'self';
    const other = s.room.you === 'host' ? s.room.guest : s.room.host;
    return other && !other.connected ? 'peer' : 'ok';
  }

  private autoTried = false;
  /**
   * From the menu, once per page: an invitation code waiting (?duel=CODE) → the LIVE screen joins it (after the sign-in
   * when needed); a room this account is still in (a reload) → back into it (a running fight resumes at once).
   */
  autoOpen(): void {
    if (this.g.currentScreen !== 'menu') return;
    if (this.pendingInvite()) {
      this.g.goto('live');
      return;
    }
    if (this.autoTried || this.access() !== 'ready') return;
    this.autoTried = true;
    void this.resume()
      .then((back) => {
        if (back && this.g.currentScreen === 'menu' && this.session?.room && this.session.room.status !== 'fight') this.g.goto('live');
      })
      .catch(() => undefined);
  }

  /** Whether a reload brought the player back into a room (the menu opens LIVE DUELS). */
  takeResumed(): boolean {
    const r = this.resumed;
    this.resumed = false;
    return r;
  }
}
