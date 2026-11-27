import { ARENAS, isArenaId, type ArenaId, type ArenaPref } from '../../config/arenas.config';
import { CARDS, NEW_CARDS, UNIVERSAL_CARDS } from '../../config/cards';
import { plural } from '../../config/events.config';
import { FIGHTERS } from '../../config/fighters';
import { LEAGUE_FIGHTERS } from '../../config/league.config';
import { isLeagueCard, leagueCards, leagueDeckFrom } from '../../config/leagueDeck';
import { LIVE, inviteLink, normalizeCode } from '../../config/live.config';
import type { CardId, FighterId } from '../../config/types';
import type { Game } from '../../game/Game';
import { liveError } from '../../game/LiveRuntime';
import { leagueLook } from '../../game/LeagueRuntime';
import { inRoster } from '../../meta/roster';
import type { LiveMatchView, LivePlayer, LiveRoom } from '../../net/LiveApi';
import { PrimeApiError } from '../../net/PrimeApi';
import { ARENA_ART } from '../arenaArt';
import { arenaName, arenaWhy } from '../liveArena';
import { cardHTML, el, esc, portraitHTML } from '../dom';
import { UI_ICONS } from '../icons';
import { uiIcon } from '../menuArt';
import type { Screen } from '../UI';

// Beta 2.7 LIVE DUELS — the lobby (create a duel / enter a code), the room (code, link, both players, fighter, deck,
// studio set, «ГОТОВ») and the result of a live fight (the server's, never this screen's own) with «РЕВАНШ».
//
// Beta 2.7.1 — why the room no longer jumps to the top: the 2.7 screen rebuilt ALL of its markup (innerHTML of the
// whole screen, the scroll area included) whenever anything it showed changed — the friend's pick or «ready» arriving
// by realtime, the friend's connection dot after a late heartbeat, this player's own card taps, the «busy» flag of a
// request, the stats loading. A new scroll area starts at scrollTop 0, and every portrait and card picture was made
// anew (the blink). Now the screen keeps ONE frame (head + scroll area) and one skeleton per state (gate / lobby /
// room); a network update or a tap repaints only the section whose markup really changed, and the card / fighter /
// set tiles are built once and only switch classes. Nothing is ever scrolled back by hand. The lobby's code field is
// never repainted (the typed code and the iPhone keyboard stay).

const PICK_KEY = 'primetime-live-pick';
const ARENA_KEY = 'primetime-live-arena';
const SITE = 'https://primetimeshowdown.online';

interface Pick {
  fighter: FighterId;
  deck: CardId[];
}

function readPick(): Pick | null {
  try {
    const p = JSON.parse(localStorage.getItem(PICK_KEY) ?? 'null') as Pick | null;
    return p && typeof p.fighter === 'string' && Array.isArray(p.deck) ? p : null;
  } catch {
    return null;
  }
}
function writePick(p: Pick): void {
  try {
    localStorage.setItem(PICK_KEY, JSON.stringify(p));
  } catch {
    /* a private window: the pick is simply not remembered */
  }
}
/** The set chosen last time (this browser): offered again in the next room; the server checks it is open. */
function readArena(): ArenaPref {
  try {
    const v = localStorage.getItem(ARENA_KEY);
    return isArenaId(v) ? v : 'random';
  } catch {
    return 'random';
  }
}
function writeArena(v: ArenaPref): void {
  try {
    localStorage.setItem(ARENA_KEY, v);
  } catch {
    /* not remembered */
  }
}

/** The address an invitation opens: the official site (a test page uses its own address). */
function siteOrigin(): string {
  return /^https:\/\/primetimeshowdown\.online/.test(location.origin) || !/^https?:/.test(location.origin) ? SITE : location.origin + location.pathname.replace(/\/+$/, '');
}

async function copy(g: Game, text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    g.ui.toast(done);
  } catch {
    g.ui.toast('Выделите и скопируйте вручную: ' + text);
  }
}

function connDot(p: LivePlayer | null, you: boolean): string {
  if (!p) return '<span class="lv-conn wait">ждём</span>';
  if (you) return '<span class="lv-conn on">вы</span>';
  return p.connected ? '<span class="lv-conn on">в сети</span>' : '<span class="lv-conn off">переподключение…</span>';
}

/** One card of the deck builder: its face (energy and name are on it), a short line, a tick when it is in the deck. */
function cardTile(c: CardId): string {
  const d = CARDS[c];
  const role = d.role.split(' · ')[0];
  return `<button class="lv-c" data-act="card" data-card="${c}" aria-pressed="false" aria-label="${esc(d.name)} · ${d.cost} энергии · ${esc(role)}">
      <span class="lv-c-face">${cardHTML(c, 'lv-cf', false)}<i class="lv-c-ck" aria-hidden="true">${UI_ICONS.check}</i></span>
      <span class="lv-c-cap"><b>⚡${d.cost}</b>${esc(role)}</span>
    </button>`;
}
function lockedTile(c: CardId, short: string, long: string): string {
  const d = CARDS[c];
  return `<button class="lv-c locked" data-act="locked" data-card="${c}" data-why="${esc(long)}" aria-label="${esc(d.name)} — недоступна: ${esc(short)}">
      <span class="lv-c-face">${cardHTML(c, 'lv-cf', false)}<i class="lv-c-lock" aria-hidden="true">${UI_ICONS.lock}</i></span>
      <span class="lv-c-cap why">${esc(short)}</span>
    </button>`;
}

const ROOM_SKELETON = `<div data-sec="status"></div>
  <div data-sec="codetop"></div>
  <div class="lv-players" data-sec="players"></div>
  <div class="lv-steps" data-steps>
    <section class="lv-step">
      <div class="lv-step-h"><span class="lv-step-n">1</span><b>Боец</b></div>
      <div class="lv-fighters" data-sec="fighters"></div>
    </section>
    <section class="lv-step">
      <div class="lv-step-h"><span class="lv-step-n">2</span><b>Колода</b><small>колода соперника скрыта до старта</small></div>
      <div class="lv-deck">
        <div class="lv-deck-k" data-sec="deckhead"></div>
        <div class="lv-slots">${[0, 1, 2, 3].map((i) => `<button class="lv-slot" data-act="slot" data-i="${i}" data-slot="${i}"></button>`).join('')}</div>
        <div class="lv-deck-hint" data-sec="deckhint"></div>
      </div>
      <div class="lv-pool-k">Доступные карты <small>нажмите, чтобы добавить или убрать</small></div>
      <div class="lv-pool" data-sec="pool"></div>
      <div data-sec="locked"></div>
    </section>
    <section class="lv-step" data-arena-step>
      <div class="lv-step-h"><span class="lv-step-n">3</span><b>Арена</b><small>выбирает каждый — решает сервер</small></div>
      <div class="lv-arenas" data-sec="arenas" role="radiogroup" aria-label="Арена дуэли"></div>
      <div data-sec="arenasum"></div>
    </section>
  </div>
  <div class="lv-acts" data-sec="acts"></div>`;

export class LiveScreen implements Screen {
  readonly el: HTMLElement;
  /** The scroll area — made once; its position is never reset by a repaint. */
  private readonly body: HTMLElement;
  private busy = false;
  private msg = '';
  private closed: string | null = null;
  private pick: Pick | null = null;
  /**
   * The four places of the deck as shown (an emptied place keeps its position, the next card goes there — the order is
   * the hand: places 1–3 in hand, 4 queued). `pick.deck` is always these cards in this order.
   */
  private slots: (CardId | null)[] = [null, null, null, null];
  private off: (() => void) | null = null;
  /** Which skeleton is in the scroll area (gate:<access> / lobby / room): a new one starts at the top, the same one is patched. */
  private mode = '';
  /** The last markup (or key) of each patched section: a section is touched only when it changes. */
  private secs = new Map<string, string>();
  /** The code typed in the lobby (kept through repaints and a sign-in). */
  private codeDraft = '';
  /** A set chosen here and not yet confirmed by the server (shown at once). */
  private arenaWant: ArenaPref | null = null;
  /** The pick on its way to the server (one request at a time; later changes go right after it). */
  private sending: Promise<void> | null = null;
  private pickDirty = false;
  /** The closed cards' list is folded until the player opens it (kept open while they stay in the room). */
  private closedOpen = false;

  constructor(private readonly g: Game) {
    this.el = el(
      'div',
      'screen live-screen',
      `<div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад">${UI_ICONS.back}</button>
        <div class="h1 lv-h1">LIVE DUELS</div>
      </div>
      <div class="fill scroll lv-scroll"></div>`,
    );
    this.body = this.el.querySelector('.lv-scroll') as HTMLElement;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b || (b as HTMLButtonElement).disabled) return;
      void this.act(b.dataset.act ?? '', b);
    });
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.act('join', null);
    });
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'lv-code') this.codeDraft = t.value;
    });
    // («toggle» does not bubble: caught on the way down)
    this.el.addEventListener(
      'toggle',
      (e) => {
        const d = e.target as HTMLDetailsElement;
        if (d.classList?.contains('lv-closed')) this.closedOpen = d.open;
      },
      true,
    );
  }

  onShow(p?: { closed?: string }): void {
    this.closed = p?.closed ?? null;
    this.msg = '';
    // entering the screen: a fresh skeleton at the top
    this.mode = '';
    this.off?.();
    this.off = this.g.live.onChange(() => {
      if (this.g.currentScreen === 'live') this.render();
    });
    this.render();
    // after a reload: the room (and a running match) this account is still in; else a code from an invitation link
    void (async () => {
      try {
        if (this.g.live.access() === 'ready' && !this.g.live.room) {
          const back = await this.g.live.resume();
          if (!back) {
            const code = this.g.live.pendingInvite();
            if (code) await this.joinCode(code);
          }
        }
      } catch (e) {
        this.msg = liveError(e);
      }
      void this.g.live.refreshStats();
      this.render();
    })();
  }

  onHide(): void {
    this.off?.();
    this.off = null;
  }

  private async act(a: string, b: HTMLElement | null): Promise<void> {
    const g = this.g;
    if (a === 'back') {
      g.audio.ui('click');
      // leaving the screen is not leaving the room — but a «ready» left behind would start a fight elsewhere
      const r = g.live.room;
      const me = r ? (r.you === 'host' ? r.host : r.guest) : null;
      if (me?.ready && r?.status === 'open') void g.live.ready(false).catch(() => undefined);
      g.goto('menu');
      return;
    }
    if (a === 'signin') {
      g.audio.ui('click');
      g.goto('profile');
      return;
    }
    if (a === 'reload') {
      location.reload();
      return;
    }
    const room = g.live.room;
    // the room's own choices: local at once (no waiting for the network), the pick follows in the background —
    // never while this player is «ready» or a fight runs (the server would refuse; the steps are shown locked)
    const mine = room ? (room.you === 'host' ? room.host : room.guest) : null;
    const frozen = !room || room.status === 'fight' || room.status === 'closed' || !!mine?.ready;
    if ((a === 'fighter' || a === 'card' || a === 'slot' || a === 'arena') && frozen) return;
    if (a === 'fighter' && b?.dataset.f) {
      if (this.pick?.fighter === b.dataset.f) return;
      g.audio.ui('click');
      this.choose(b.dataset.f as FighterId);
      this.render();
      this.queuePick();
      return;
    }
    if ((a === 'card' || a === 'slot') && this.pick) {
      const slots = this.slots;
      const c = (a === 'card' ? b?.dataset.card : slots[Number(b?.dataset.i)]) as CardId | undefined;
      if (!c) return;
      const i = slots.indexOf(c);
      if (i >= 0) {
        // out of the deck: its place stays empty, at its position, for the next card (a quick swap keeps the order)
        g.audio.ui('click');
        slots[i] = null;
      } else {
        const free = slots.indexOf(null);
        if (free < 0) {
          g.ui.toast('Колода собрана: нажмите карту в колоде, чтобы освободить место');
          return;
        }
        g.audio.ui('click');
        slots[free] = c;
      }
      this.pick.deck = slots.filter((x): x is CardId => !!x);
      this.render();
      if (this.pick.deck.length === 4) this.queuePick();
      return;
    }
    if (a === 'locked' && b?.dataset.why) {
      g.ui.toast(b.dataset.why);
      return;
    }
    if (a === 'arena' && b?.dataset.arena) {
      await this.chooseArena(b.dataset.arena as ArenaPref);
      return;
    }
    if (a === 'copy-code' && room) return copy(g, room.code, 'Код скопирован');
    if (a === 'copy-link' && room) return copy(g, inviteLink(siteOrigin(), room.code), 'Ссылка скопирована');
    if (a === 'share' && room) {
      const url = inviteLink(siteOrigin(), room.code);
      try {
        await navigator.share({ title: 'PRIME TIME: SHOWDOWN — LIVE DUEL', text: `Вызываю тебя на дуэль! Код: ${room.code}`, url });
      } catch {
        /* the player closed the share sheet */
      }
      return;
    }
    if (this.busy) return;
    try {
      this.busy = true;
      this.msg = '';
      this.render();
      if (a === 'create') {
        g.audio.ui('confirm');
        this.closed = null;
        await g.live.create();
        await this.sendPick();
      } else if (a === 'join') {
        const input = this.el.querySelector('#lv-code') as HTMLInputElement | null;
        await this.joinCode(input?.value ?? this.codeDraft);
      } else if (a === 'ready' && room) {
        const me = room.you === 'host' ? room.host : room.guest;
        if (!me?.ready) {
          // the last change of the pick first (it would take the «ready» back on the server)
          if (this.sending) await this.sending;
          if (this.pick && this.pick.deck.length === 4 && (!me?.picked || this.pickChanged(me))) await this.sendPick();
        }
        g.audio.ui('confirm');
        await g.live.ready(!me?.ready);
      } else if (a === 'leave') {
        g.audio.ui('click');
        await g.live.leave();
        this.pick = null;
      }
    } catch (e) {
      this.msg = liveError(e);
      if (e instanceof PrimeApiError && e.code === 'room_active' && e.data.room) {
        this.msg = 'Вы уже в комнате LIVE DUELS — возвращаем вас туда.';
        await g.live.resume().catch(() => undefined);
      }
    } finally {
      this.busy = false;
      if (g.currentScreen === 'live') this.render();
    }
  }

  private async joinCode(raw: string): Promise<void> {
    const code = normalizeCode(raw);
    if (!code) {
      this.msg = liveError(new PrimeApiError('invalid', 'bad_code', 400));
      return;
    }
    this.g.audio.ui('confirm');
    this.closed = null;
    await this.g.live.join(code);
    this.codeDraft = '';
    await this.sendPick();
  }

  /** The fighters this account can field (opened in the career or bought) — the server checks the same. */
  private fighters(): FighterId[] {
    const s = this.g.save.data;
    return LEAGUE_FIGHTERS.filter((f) => inRoster(s, f));
  }

  private owned(): CardId[] {
    return this.g.save.data.cards.owned as CardId[];
  }

  private choose(f: FighterId): void {
    const s = this.g.save.data;
    const remembered = readPick();
    const base = remembered && remembered.fighter === f ? remembered.deck : s.fighters[f]?.deck;
    this.pick = { fighter: f, deck: leagueDeckFrom(f, base, this.owned()) };
    this.slots = [0, 1, 2, 3].map((i) => this.pick!.deck[i] ?? null);
  }

  private ensurePick(): Pick | null {
    if (this.pick) return this.pick;
    const list = this.fighters();
    if (!list.length) return null;
    const remembered = readPick();
    const f = remembered && list.includes(remembered.fighter) ? remembered.fighter : list.includes(this.g.save.data.selected) ? this.g.save.data.selected : list[0];
    this.choose(f);
    return this.pick;
  }

  private pickChanged(me: LivePlayer): boolean {
    const p = this.pick;
    return !!p && (me.fighter !== p.fighter || JSON.stringify(me.deck ?? []) !== JSON.stringify(p.deck));
  }

  /** The pick goes to the server; changes made meanwhile follow in one more request (never two at once). */
  private queuePick(): void {
    this.pickDirty = true;
    if (this.sending) return;
    this.sending = (async () => {
      while (this.pickDirty) {
        this.pickDirty = false;
        try {
          await this.sendPick();
        } catch (e) {
          this.msg = liveError(e);
          break;
        }
      }
    })().finally(() => {
      this.sending = null;
      if (this.g.currentScreen === 'live') this.render();
    });
  }

  /**
   * Sends the pick (the worn look when it is a bought one; refused → the fighter's own look). The first pick in a room
   * carries the set chosen last time (2.7.1 servers; the server checks it is open, else RANDOM).
   */
  private async sendPick(): Promise<void> {
    const room = this.g.live.room;
    const p = this.ensurePick();
    if (!room || !p || p.deck.length !== 4 || room.status === 'fight' || room.status === 'closed') return;
    const me = room.you === 'host' ? room.host : room.guest;
    if (me?.picked && !this.pickChanged(me)) return;
    const worn = this.g.fighterLook(p.fighter);
    const look = worn && worn !== FIGHTERS[p.fighter].look ? worn : null;
    const arena = room.arenas && !me?.picked ? readArena() : undefined;
    const deck = p.deck.slice();
    try {
      await this.g.live.pick(p.fighter, deck, look, arena);
    } catch (e) {
      if (e instanceof PrimeApiError && e.code === 'look_not_owned' && look) await this.g.live.pick(p.fighter, deck, null, arena);
      else throw e;
    }
    writePick({ fighter: p.fighter, deck });
  }

  /** This player's set: shown at once, confirmed by the server (which keeps it with the pick and shows it to both). */
  private async chooseArena(v: ArenaPref): Promise<void> {
    const g = this.g;
    const room = g.live.room;
    if (!room?.arenas || room.status === 'fight' || room.status === 'closed') return;
    const me = room.you === 'host' ? room.host : room.guest;
    if (me?.ready) return;
    if ((this.arenaWant ?? me?.arena ?? 'random') === v) return;
    g.audio.ui('click');
    this.arenaWant = v;
    this.msg = '';
    this.render();
    try {
      // the room has this player's pick first (the set travels inside it)
      if (this.sending) await this.sending;
      if (!g.live.room?.[room.you]?.picked) await this.sendPick();
      await g.live.arena(v);
      writeArena(v);
    } catch (e) {
      this.msg = liveError(e);
    } finally {
      this.arenaWant = null;
      if (g.currentScreen === 'live') this.render();
    }
  }

  // ------------------------------------------------------------------ painting
  /** A section's markup, set only when it differs from what is shown. */
  private sec(name: string, html: string): void {
    if (this.secs.get(name) === html) return;
    this.secs.set(name, html);
    const box = this.body.querySelector<HTMLElement>(`[data-sec="${name}"]`);
    if (box) box.innerHTML = html;
  }
  /** The same for a costly section: built only when its key changed. */
  private secKey(name: string, key: string, build: () => string): void {
    const k = '#' + name;
    if (this.secs.get(k) === key) return;
    this.secs.set(k, key);
    this.sec(name, build());
  }

  private render(): void {
    const g = this.g;
    const acc = g.live.access();
    const room = g.live.room;
    const mode = acc !== 'ready' ? 'gate:' + acc : room && room.status !== 'closed' ? 'room' : 'lobby';
    if (mode !== this.mode) {
      this.mode = mode;
      this.secs.clear();
      this.body.innerHTML = mode === 'room' ? ROOM_SKELETON : mode === 'lobby' ? this.lobbySkeleton() : '<div class="lv-gate-wrap" data-sec="gate"></div>';
      this.body.scrollTop = 0;
    }
    if (mode === 'room' && room) this.paintRoom(room);
    else if (mode === 'lobby') this.paintLobby();
    else this.sec('gate', this.gateHTML(acc));
  }

  private gateHTML(acc: string): string {
    const text: Record<string, [string, string, string]> = {
      off: ['LIVE DUELS скоро в эфире', 'Онлайн-дуэли с друзьями пока выключены на сервере.', ''],
      guest: ['Нужен PRIME ID', 'Онлайн-дуэли — для игроков с PRIME ID: бой идёт на сервере, итог и награды — в вашем аккаунте.', '<button class="btn big wide lv-cta" data-act="signin"><span class="shine"></span>Войти в PRIME ID</button>'],
      unverified: ['Подтвердите почту', 'Откройте письмо PRIME ID и подтвердите адрес — после этого онлайн-дуэли откроются.', '<button class="btn teal wide" data-act="signin">Открыть PRIME ID</button>'],
      held: ['PRIME ID ещё загружается', 'Подождите пару секунд или откройте PRIME ID: игра должна быть подключена к аккаунту на этом устройстве.', '<button class="btn teal wide" data-act="signin">Открыть PRIME ID</button>'],
      outdated: ['Нужна новая версия игры', 'Сервер уже работает по новым правилам боя.', '<button class="btn big wide lv-cta" data-act="reload"><span class="shine"></span>Обновить страницу</button>'],
    };
    const [h, p, btn] = text[acc] ?? text.off;
    const code = this.g.live.pendingInvite();
    return `<div class="lv-hero">${this.emblem()}<div class="lv-hero-k">ОНЛАЙН-ДУЭЛИ С ДРУЗЬЯМИ</div></div>
      <div class="lv-card lv-gate"><b>${esc(h)}</b><p>${esc(p)}</p>${code ? `<p class="lv-invite">Приглашение с кодом <b>${esc(code)}</b> сохранено — после входа вы сразу попадёте в комнату.</p>` : ''}${btn}</div>`;
  }

  private emblem(): string {
    return `<div class="lv-emb" aria-hidden="true">${uiIcon('live_duels', 92)}<span class="lv-live"><i></i>LIVE</span></div>`;
  }

  private statsLine(): string {
    const st = this.g.live.stats;
    if (!st) return '';
    const rivals = st.cases ? (st.caseToday ? '<span class="lv-rw done">Мини-кейс дня получен</span>' : '<span class="lv-rw">Первая честная дуэль дня — мини-кейс</span>') : '';
    return `<div class="lv-stats"><span><b>${st.played}</b> ${plural(st.played, ['дуэль', 'дуэли', 'дуэлей'])}</span><span><b>${st.wins}</b> ${plural(st.wins, ['победа', 'победы', 'побед'])}</span><span>серия <b>${st.best}</b></span></div>${rivals}`;
  }

  // ------------------------------------------------------------------ the lobby
  private lobbySkeleton(): string {
    const code = this.codeDraft || this.g.live.pendingInvite() || '';
    return `<div class="lv-hero">${this.emblem()}<div class="lv-hero-k">ОНЛАЙН-ДУЭЛИ С ДРУЗЬЯМИ</div></div>
      <div data-sec="note"></div>
      <div data-sec="create"></div>
      <form class="lv-join" autocomplete="off">
        <label class="lv-join-l" for="lv-code">Войти по коду</label>
        <div class="lv-join-row">
          <input id="lv-code" class="lv-code-in" maxlength="8" inputmode="text" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="K7M2QX" value="${esc(code)}" aria-label="Код комнаты" />
          <button class="btn teal" type="submit" data-join>Войти</button>
        </div>
      </form>
      <ol class="lv-how">
        <li><b>Создайте дуэль</b> — появится код из 6 знаков.</li>
        <li><b>Отправьте другу</b> код или ссылку — он откроет игру и войдёт в комнату.</li>
        <li><b>Выберите бойца, колоду и арену</b> и нажмите «Готов» — бой начнётся у обоих одновременно.</li>
      </ol>
      <div data-sec="stats"></div>
      <p class="lv-fine">Бой идёт на сервере: итог считает сервер по записи действий обоих игроков. Рейтинг PRIME LEAGUE, RP и жетоны не меняются.</p>`;
  }

  private paintLobby(): void {
    const closed = this.closed ? `<div class="lv-note">${esc(closedText(this.closed))}</div>` : '';
    this.sec('note', `${closed}${this.msg ? `<div class="lv-err" role="alert">${esc(this.msg)}</div>` : ''}`);
    this.sec('create', `<button class="btn big wide lv-cta" data-act="create" ${this.busy ? 'disabled' : ''}><span class="shine"></span>Создать дуэль</button>`);
    // (the code field itself is never repainted: what is typed and the keyboard stay)
    const join = this.body.querySelector<HTMLButtonElement>('[data-join]');
    if (join) join.disabled = this.busy;
    this.sec('stats', this.statsLine());
  }

  // ------------------------------------------------------------------ the room
  private paintRoom(room: LiveRoom): void {
    const me = room.you === 'host' ? room.host : room.guest;
    const other = room.you === 'host' ? room.guest : room.host;
    const p = this.ensurePick();
    const waiting = room.status === 'waiting';
    const locked = !!me?.ready || room.status === 'fight';

    const status = waiting
      ? '<div class="lv-status wait"><i></i>Ожидание друга…</div>'
      : room.status === 'fight'
        ? '<div class="lv-status on"><i></i>Бой идёт</div>'
        : other && !other.connected
          ? '<div class="lv-status off"><i></i>Соединение с другом потеряно — ждём…</div>'
          : other?.ready
            ? '<div class="lv-status on"><i></i>Соперник готов — ваш ход</div>'
            : '<div class="lv-status on"><i></i>Друг в комнате</div>';
    const score = room.games > 0 ? `<div class="lv-score">Счёт встреч <b>${room.you === 'host' ? room.score.host : room.score.guest}</b> : <b>${room.you === 'host' ? room.score.guest : room.score.host}</b>${room.score.draws ? ` · ничьих ${room.score.draws}` : ''}</div>` : '';
    this.sec('status', `${status}${score}${this.msg ? `<div class="lv-err" role="alert">${esc(this.msg)}</div>` : ''}`);
    this.sec('codetop', waiting ? this.codeBox(room, false) : '');

    // the two players (portraits are rebuilt only when a fighter, look, name, connection or readiness changes)
    const pl = (x: LivePlayer | null) => (x ? [x.name, x.fighter, x.look, x.picked, x.ready, x.connected] : null);
    this.secKey('players', JSON.stringify([room.you, pl(room.host), pl(room.guest)]), () => {
      const one = (x: LivePlayer | null, you: boolean) => {
        if (!x) return `<div class="lv-pl empty"><div class="lv-pl-face">?</div><b>Свободное место</b><small>Отправьте код другу</small><span class="lv-ready">ждём</span></div>`;
        const f = x.fighter ? FIGHTERS[x.fighter] : null;
        const face = f ? portraitHTML(this.g.portraitFor(leagueLook(x.fighter as FighterId, x.look ?? undefined)), f.theme.main, f.theme.dark, 'lv-pl-f') : '<div class="lv-pl-face">?</div>';
        const state = x.ready ? `<span class="lv-ready">${UI_ICONS.check}ГОТОВ</span>` : '<span class="lv-ready">НЕ ГОТОВ</span>';
        return `<div class="lv-pl ${you ? 'me' : 'foe'} ${x.ready ? 'ready' : ''}">${face}<b>${esc(x.name)}</b><small>${f ? esc(f.name) : 'выбирает бойца…'}</small>${connDot(x, you)}${state}</div>`;
      };
      const host = one(room.host, room.you === 'host');
      const guest = one(room.guest, room.you === 'guest');
      return `${room.you === 'host' ? host : guest}<div class="lv-vs">VS</div>${room.you === 'host' ? guest : host}`;
    });

    // 1 · the fighter: tiles made once, the choice is a class
    const list = this.fighters();
    this.secKey('fighters', JSON.stringify(list), () =>
      list
        .map((id) => {
          const f = FIGHTERS[id];
          return `<button class="lv-f" data-act="fighter" data-f="${id}" aria-pressed="false" aria-label="${esc(f.name)}">${portraitHTML(this.g.portraitOf(id), f.theme.main, f.theme.dark)}<span>${esc(f.name)}</span></button>`;
        })
        .join(''),
    );
    for (const b of this.body.querySelectorAll<HTMLElement>('.lv-f')) {
      const on = b.dataset.f === p?.fighter;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }

    // 2 · the deck: four places, the cards this fighter may take (with a tick when in the deck), the closed ones
    this.paintDeck(p);

    // 3 · the set (a 2.7 server has no choice: the step is hidden and the server draws as before)
    const arenaStep = this.body.querySelector<HTMLElement>('[data-arena-step]');
    if (arenaStep) arenaStep.hidden = !room.arenas;
    if (room.arenas) this.paintArenas(room, me, other);

    const steps = this.body.querySelector<HTMLElement>('[data-steps]');
    steps?.classList.toggle('locked', locked);

    // the actions
    const ready = !!me?.ready;
    const canReady = !!p && p.deck.length === 4 && room.status === 'open';
    const hint = ready
      ? waiting
        ? 'Ждём друга — бой начнётся, когда он тоже будет готов.'
        : 'Выбор зафиксирован. Ждём соперника — нажмите ещё раз, чтобы изменить выбор.'
      : room.status === 'open' && !canReady
        ? 'Соберите колоду из 4 карт, чтобы нажать «Готов».'
        : '';
    this.sec(
      'acts',
      `<button class="btn big wide lv-cta ${ready ? 'is-ready' : ''}" data-act="ready" ${(canReady || ready) && !this.busy ? '' : 'disabled'}><span class="shine"></span>${ready ? 'Готов ✓' : 'Готов'}</button>
        ${hint ? `<div class="lv-hint">${hint}</div>` : ''}
        ${waiting ? '' : this.codeBox(room, true)}
        <button class="btn ghost wide" data-act="leave" ${this.busy ? 'disabled' : ''}>Выйти из комнаты</button>`,
    );
  }

  private codeBox(room: LiveRoom, mini: boolean): string {
    return `<div class="lv-code ${mini ? 'mini' : ''}">
        <div class="lv-code-k">Код комнаты</div>
        <button class="lv-code-v" data-act="copy-code" aria-label="Скопировать код ${esc(room.code)}">${esc(room.code)}</button>
        <div class="lv-code-acts">
          <button class="btn ghost" data-act="copy-code">Копировать код</button>
          <button class="btn ghost" data-act="copy-link">Копировать ссылку</button>
          ${typeof navigator.share === 'function' ? '<button class="btn ghost" data-act="share">Поделиться</button>' : ''}
        </div>
        <small>Код действует ${Math.round(LIVE.waitMs / 60000)} минут.</small>
      </div>`;
  }

  /** The cards of the fighter in three groups: in the deck (places 1–4), may be taken, closed (with the reason). */
  private paintDeck(p: Pick | null): void {
    const deck = p?.deck ?? [];
    const slots = p ? this.slots : [null, null, null, null];
    const allowed = p ? leagueCards(p.fighter, this.owned()) : [];
    const closed = p ? this.closedCards(p.fighter) : [];
    this.sec('deckhead', `<span>ВЫБРАННАЯ КОЛОДА · <b>${deck.length}</b>/4</span><small>3 в руке + 1 в очереди</small>`);
    this.body.querySelector('.lv-deck')?.classList.toggle('full', deck.length === 4);
    const next = slots.indexOf(null);
    for (const s of this.body.querySelectorAll<HTMLButtonElement>('.lv-slot')) {
      const i = Number(s.dataset.slot);
      const c = slots[i];
      const key = c ?? (i === next ? '+next' : '+');
      if (s.dataset.k === key) continue;
      s.dataset.k = key;
      s.className = `lv-slot ${c ? 'filled' : 'empty'} ${i === next ? 'next' : ''}`;
      s.disabled = !c;
      s.setAttribute('aria-label', c ? `Место ${i + 1}: ${CARDS[c].name} — нажмите, чтобы убрать` : `Место ${i + 1}: пусто`);
      s.innerHTML = c
        ? `<span class="lv-slot-n">${i + 1}</span>${cardHTML(c, 'lv-cf', false)}<span class="lv-slot-x" aria-hidden="true">×</span>`
        : `<span class="lv-slot-n">${i + 1}</span><span class="lv-slot-plus" aria-hidden="true">+</span><span class="lv-slot-e">${i === next ? 'выберите' : 'пусто'}</span>`;
    }
    this.sec(
      'deckhint',
      deck.length === 4
        ? 'Колода собрана. Чтобы заменить карту, нажмите её — место освободится для другой.'
        : `Добавьте ещё ${4 - deck.length}: нажмите карту ниже.`,
    );
    this.secKey('pool', JSON.stringify([p?.fighter, allowed]), () => allowed.map(cardTile).join(''));
    for (const t of this.body.querySelectorAll<HTMLElement>('.lv-pool .lv-c')) {
      const on = deck.includes(t.dataset.card as CardId);
      t.classList.toggle('in', on);
      t.setAttribute('aria-pressed', String(on));
    }
    this.secKey('locked', JSON.stringify([p?.fighter, closed.map((x) => x.id + x.short)]), () =>
      closed.length
        ? `<details class="lv-closed" ${this.closedOpen ? 'open' : ''}><summary><span>Недоступные карты · ${closed.length}</span><small>не куплены или пока не для дуэлей — нажмите карту, чтобы узнать причину</small></summary><div class="lv-pool closed">${closed.map((x) => lockedTile(x.id, x.short, x.long)).join('')}</div></details>`
        : '',
    );
  }

  /**
   * Cards the fighter may NOT take now, with the reason: a card for sale not bought yet (opens in the career, bought in
   * «Карты») and the cards online duels and PRIME LEAGUE do not use yet. Other fighters' signatures are not listed.
   */
  private closedCards(f: FighterId): { id: CardId; short: string; long: string }[] {
    const g = this.g;
    const owned = this.owned();
    const out: { id: CardId; short: string; long: string }[] = [];
    for (const c of [...UNIVERSAL_CARDS, FIGHTERS[f].signature, ...NEW_CARDS]) {
      const d = CARDS[c];
      if (!d || out.some((x) => x.id === c)) continue;
      if (!isLeagueCard(c)) {
        out.push({ id: c, short: 'Не для дуэлей', long: `${d.name} пока не используется в онлайн-дуэлях и PRIME LEAGUE.` });
        continue;
      }
      if (UNIVERSAL_CARDS.includes(c) || c === FIGHTERS[f].signature || owned.includes(c)) continue;
      const open = g.career.cardOpen(c);
      const req = g.career.cardRequirement(c);
      out.push({
        id: c,
        short: open ? 'Не куплена' : `Ур. ${d.shop?.level ?? '?'}`,
        long: open ? `${d.name} ещё не ваша: купите её в разделе «Карты» главного меню.` : `${d.name} откроется: ${req.charAt(0).toLowerCase()}${req.slice(1)}. Затем её можно купить в разделе «Карты».`,
      });
    }
    return out;
  }

  /** The sets: RANDOM, the sets open now, seasonal ones opening soon (locked); both players' choices are marked. */
  private paintArenas(room: LiveRoom, me: LivePlayer | null, other: LivePlayer | null): void {
    const open = (room.arenas ?? []).filter((a): a is ArenaId => isArenaId(a));
    const soon = (room.soon ?? []).filter((s) => isArenaId(s.id));
    this.secKey('arenas', JSON.stringify([open, soon]), () => {
      const tile = (id: ArenaPref) => {
        const def = id === 'random' ? null : ARENAS[id];
        const tag = def?.availability.kind === 'seasonal' ? '<i class="lv-a-tag season">сезон</i>' : def?.covers?.length ? '<i class="lv-a-tag">укрытия</i>' : '';
        return `<button class="lv-a ${id === 'random' ? 'rnd' : ''}" data-act="arena" data-arena="${id}" role="radio" aria-checked="false">
            <span class="lv-a-art">${ARENA_ART[id]}${tag}</span>
            <span class="lv-a-n">${id === 'random' ? 'СЛУЧАЙНАЯ АРЕНА' : esc(def!.name)}</span>
            <span class="lv-a-who"><i class="me">ВЫ</i><i class="foe">СОПЕРНИК</i></span>
          </button>`;
      };
      const when = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });
      const later = soon
        .map(
          (s) =>
            `<div class="lv-a locked" aria-disabled="true"><span class="lv-a-art">${ARENA_ART[s.id]}<i class="lv-a-tag season">сезон</i><i class="lv-a-lock">${UI_ICONS.lock}</i></span><span class="lv-a-n">${esc(ARENAS[s.id].name)}</span><span class="lv-a-soon">откроется ${esc(when(s.from))}</span></div>`,
        )
        .join('');
      return [tile('random'), ...open.map(tile)].join('') + later;
    });
    const mine = this.arenaWant ?? me?.arena ?? 'random';
    const theirs = other?.picked ? (other.arena ?? 'random') : null;
    for (const b of this.body.querySelectorAll<HTMLElement>('.lv-a[data-arena]')) {
      const id = b.dataset.arena;
      b.classList.toggle('on', id === mine);
      b.classList.toggle('theirs', id === theirs);
      b.classList.toggle('pending', id === this.arenaWant);
      b.setAttribute('aria-checked', String(id === mine));
    }
    this.sec('arenasum', arenaSummary(mine, theirs, open.length, !!other));
  }
}

/** Both preferences and what the server will do with them (the same rule it applies when the match is made). */
function arenaSummary(mine: ArenaPref, theirs: ArenaPref | null, open: number, friend: boolean): string {
  const you = `<span><i>Вы</i><b>${esc(arenaName(mine))}</b></span>`;
  const foe = `<span><i>Соперник</i><b>${theirs ? esc(arenaName(theirs)) : friend ? 'выбирает…' : 'ждём друга'}</b></span>`;
  let rule: string;
  if (!theirs) rule = mine === 'random' ? `Если оба оставят случайную, сервер выберет одну из ${open} открытых арен.` : 'Если соперник выберет другую арену, сервер бросит жребий 50/50.';
  else if (mine !== 'random' && theirs !== 'random') rule = mine === theirs ? `Оба выбрали ${esc(arenaName(mine))} — бой пройдёт там.` : 'Разные арены — сервер бросит жребий: одна из двух, 50 на 50.';
  else if (mine !== 'random' || theirs !== 'random') rule = `Будет ${esc(arenaName(mine !== 'random' ? mine : theirs))}: выбранная арена важнее случайной.`;
  else rule = `Обе случайные — сервер выберет одну из ${open} открытых арен.`;
  return `<div class="lv-asum"><div class="lv-asum-row">${you}${foe}</div><p>${rule}</p></div>`;
}

function closedText(why: string): string {
  if (why === 'host_left' || why === 'guest_left') return 'Соперник покинул комнату. Создайте новую дуэль или войдите по коду.';
  if (why === 'expired') return 'Срок приглашения истёк — друг не успел войти.';
  if (why === 'idle') return 'Комната закрыта: долго ничего не происходило.';
  return 'Комната закрыта.';
}

/** The result of a live fight: the server's own (it replayed the journal), the head-to-head score, «РЕВАНШ». */
export class LiveResultScreen implements Screen {
  readonly el: HTMLElement;
  private off: (() => void) | null = null;
  private stung = '';
  private busy = false;
  /** The panel of the match shown (kept while the room's news arrive: only its parts are repainted). */
  private panel: HTMLElement | null = null;
  private panelFor = '';
  private secs = new Map<string, string>();

  constructor(private readonly g: Game) {
    this.el = el('div', 'league-result live-result');
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b || (b as HTMLButtonElement).disabled) return;
      void this.act(b.dataset.act ?? '');
    });
  }

  onShow(): void {
    this.off?.();
    this.off = this.g.live.onChange(() => {
      if (this.g.currentScreen === 'liveResult' || this.g.currentScreen === 'results') this.render();
    });
    this.panelFor = '';
    this.render();
  }

  onHide(): void {
    this.off?.();
    this.off = null;
  }

  private async act(a: string): Promise<void> {
    const g = this.g;
    if (this.busy) return;
    this.busy = true;
    try {
      if (a === 'rematch') {
        g.audio.ui('confirm');
        const room = g.live.room;
        const mine = room ? (room.you === 'host' ? room.rematch.host : room.rematch.guest) : false;
        await g.live.rematch(!mine);
      } else if (a === 'room') {
        g.audio.ui('click');
        g.goto('live');
      } else if (a === 'exit') {
        g.audio.ui('click');
        await g.live.leave();
        g.goto('menu');
      }
    } catch (e) {
      g.ui.toast(liveError(e));
    } finally {
      this.busy = false;
      if (g.currentScreen === 'liveResult' || g.currentScreen === 'results') this.render();
    }
  }

  private sec(name: string, html: string): void {
    if (this.secs.get(name) === html) return;
    this.secs.set(name, html);
    const box = this.panel?.querySelector<HTMLElement>(`[data-sec="${name}"]`);
    if (box) box.innerHTML = html;
  }

  private render(): void {
    const g = this.g;
    const v: LiveMatchView | null = g.live.last ?? g.liveView;
    if (!v) {
      this.el.innerHTML = '';
      this.panel = null;
      this.panelFor = '';
      return;
    }
    const r = v.status === 'done' ? v.result : null;
    const me = v.side;
    const outcome = !r ? 'pending' : r.winner < 0 ? 'draw' : r.winner === me ? 'win' : 'loss';
    if (r && this.stung !== v.id) {
      this.stung = v.id;
      if (outcome === 'win') g.audio.victory();
      else if (outcome === 'loss') g.audio.defeat();
      else g.audio.reaction(2);
    }
    // one panel per match; the room's news (score, rematch, connection) repaint only the actions below
    if (!this.panel || this.panelFor !== v.id) {
      this.el.innerHTML = `<div class="lg-result panel scroll" aria-live="polite"><div data-sec="main"></div><div data-sec="acts"></div></div>`;
      this.panel = this.el.firstElementChild as HTMLElement;
      this.panelFor = v.id;
      this.secs.clear();
    }
    this.panel.className = `lg-result panel scroll ${outcome}`;
    const mainKey = JSON.stringify([v.id, v.status, r?.hash ?? null]);
    if (this.secs.get('#main') !== mainKey) {
      this.secs.set('#main', mainKey);
      this.sec('main', this.mainHTML(v));
    }
    this.sec('acts', this.actsHTML(r !== null));
  }

  private mainHTML(v: LiveMatchView): string {
    const g = this.g;
    const r = v.status === 'done' ? v.result : null;
    const me = v.side;
    const foe = (1 - me) as 0 | 1;
    const outcome = !r ? 'pending' : r.winner < 0 ? 'draw' : r.winner === me ? 'win' : 'loss';
    const head = v.status === 'void' ? 'МАТЧ АННУЛИРОВАН' : !r ? 'ЭФИР ЗАВЕРШЁН' : outcome === 'win' ? 'ПОБЕДА' : outcome === 'loss' ? 'ПОРАЖЕНИЕ' : 'НИЧЬЯ';
    const method = !r
      ? v.status === 'void'
        ? 'сервер обновил правила боя — матч не засчитан'
        : 'итог подтверждает сервер…'
      : r.method === 'ko'
        ? 'нокаут'
        : r.method === 'time'
          ? 'по времени'
          : r.method === 'forfeit'
            ? r.left === me
              ? 'вы сдались'
              : 'соперник сдался'
            : r.left === me
              ? 'связь потеряна'
              : 'соперник отключился';
    const sides = v.snapshot.sides;
    const card = (side: 0 | 1) => {
      const c = sides[side];
      const f = FIGHTERS[c.fighter];
      const won = !!r && r.winner === side;
      const pct = r ? Math.max(r.hp[side] > 0 ? 1 : 0, Math.round(r.hp[side] * 100)) : null;
      return `<div class="lg-fo-side ${side === me ? 'me' : 'foe'} ${!r ? '' : r.winner < 0 ? 'draw' : won ? 'won' : 'lost'}">
          ${won ? '<span class="lg-fo-crown">ПОБЕДИТЕЛЬ</span>' : ''}
          <div class="lg-fo-top">${portraitHTML(g.portraitFor(leagueLook(c.fighter, c.look)), f.theme.main, f.theme.dark, 'lg-fo-f')}</div>
          <b>${esc(c.name ?? '')}</b><small>${esc(f.name)}</small>
          ${pct === null ? '' : `<div class="lg-fo-hp" role="img" aria-label="HP ${pct}%"><i style="--hp:${pct / 100}"></i><span>${pct}%</span></div>`}
        </div>`;
    };
    const tile = (k: string, a: number, b: number) => `<div class="lg-st lv-st"><b><i class="me">${a}</i><i class="foe">${b}</i></b><span>${k}</span></div>`;
    const sec = r ? Math.max(0, Math.round(r.duration)) : 0;
    const stats = r ? `<div class="lg-stats">${tile('КАРТЫ', r.cards[me], r.cards[foe])}${tile('КОМБО', r.combos[me], r.combos[foe])}${tile('УРОН', r.damage[me], r.damage[foe])}${tile('PERFECT', r.perfects[me], r.perfects[foe])}</div><div class="lv-res-time">Время боя ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}</div>` : '';
    const reward = r?.rewards?.[me] ? '<div class="lv-reward">PRIME RIVALS: <b>мини-кейс дня</b> — откройте его в «Ежедневном эфире»</div>' : r ? `<div class="lv-reward muted">${r.left === me ? 'Сдача и выход не награждаются.' : 'Мини-кейс PRIME RIVALS — раз в день за первую честную дуэль (бой от 30 с, у каждого от 3 карт).'}</div>` : '';
    const arena = isArenaId(v.snapshot.arena) ? `<div class="lv-res-arena">Арена: <b>${esc(ARENAS[v.snapshot.arena].name)}</b> · ${esc(arenaWhy(v.snapshot.arenaPick, me))}</div>` : '';
    return `<div class="lg-res-k"><span class="lg-onair"><i></i>LIVE</span> LIVE DUEL${v.game > 1 ? ` · РЕВАНШ ${v.game - 1}` : ''}</div>
        <div class="lg-res-h"><span>${head}</span></div><div class="lg-res-m">${esc(method)}</div>
        <div class="lg-fo">${card(me)}<div class="lg-fo-vs">VS</div>${card(foe)}</div>
        ${stats}${arena}${reward}`;
  }

  private actsHTML(settled: boolean): string {
    const room = this.g.live.room;
    const open = !!room && room.status !== 'closed';
    const myWish = room ? (room.you === 'host' ? room.rematch.host : room.rematch.guest) : false;
    const theirWish = room ? (room.you === 'host' ? room.rematch.guest : room.rematch.host) : false;
    const other = room ? (room.you === 'host' ? room.guest : room.host) : null;
    const score = room && room.games > 0 ? `<div class="lv-score">Счёт встреч <b>${room.you === 'host' ? room.score.host : room.score.guest}</b> : <b>${room.you === 'host' ? room.score.guest : room.score.host}</b></div>` : '';
    const rematch = !settled
      ? ''
      : open && other
        ? `<button class="btn big wide lg-cta lv-rematch ${myWish ? 'is-ready' : ''}" data-act="rematch"><span class="shine"></span>${myWish ? 'Реванш ✓' : theirWish ? 'Принять реванш!' : 'Реванш'}</button>${myWish ? '<div class="lv-hint">Ждём ответа друга. Нажмите ещё раз, чтобы отменить.</div>' : theirWish ? '<div class="lv-note">Друг предлагает реванш</div>' : '<div class="lv-hint">Тот же боец, колода и выбор арены. Изменить — кнопкой ниже.</div>'}<button class="btn ghost wide" data-act="room">Боец, колода, арена</button>`
        : '<div class="lv-note">Соперник покинул комнату.</div>';
    return `${score}<div class="lg-res-acts">${rematch}<button class="btn ghost wide" data-act="exit">Выйти</button></div>${settled ? '<small class="muted">Итог подтверждён сервером по записи действий обоих игроков.</small>' : ''}`;
  }
}
