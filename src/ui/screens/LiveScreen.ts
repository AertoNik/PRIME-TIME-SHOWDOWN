import { FIGHTERS } from '../../config/fighters';
import { LEAGUE_FIGHTERS } from '../../config/league.config';
import { leagueCards, leagueDeckFrom } from '../../config/leagueDeck';
import { LIVE, inviteLink, normalizeCode } from '../../config/live.config';
import type { CardId, FighterId } from '../../config/types';
import type { Game } from '../../game/Game';
import { liveError } from '../../game/LiveRuntime';
import { leagueLook } from '../../game/LeagueRuntime';
import { inRoster } from '../../meta/roster';
import type { LiveMatchView, LivePlayer, LiveRoom } from '../../net/LiveApi';
import { PrimeApiError } from '../../net/PrimeApi';
import { cardHTML, el, esc, portraitHTML } from '../dom';
import { UI_ICONS } from '../icons';
import { uiIcon } from '../menuArt';
import type { Screen } from '../UI';

// Beta 2.7 LIVE DUELS — the lobby (create a duel / enter a code), the room (code, link, both players, fighter and
// deck, «ГОТОВ») and the result of a live fight (the server's, never this screen's own) with «РЕВАНШ».

const PICK_KEY = 'primetime-live-pick';
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

export class LiveScreen implements Screen {
  readonly el: HTMLElement;
  private busy = false;
  private msg = '';
  private closed: string | null = null;
  private pick: Pick | null = null;
  private off: (() => void) | null = null;

  constructor(private readonly g: Game) {
    this.el = el('div', 'screen live-screen');
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b || (b as HTMLButtonElement).disabled) return;
      void this.act(b.dataset.act ?? '', b);
    });
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.act('join', null);
    });
  }

  onShow(p?: { closed?: string }): void {
    this.closed = p?.closed ?? null;
    this.msg = '';
    this.shownKey = '';
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
    if (this.busy) return;
    const room = g.live.room;
    try {
      this.busy = true;
      this.msg = '';
      if (a === 'create') {
        g.audio.ui('confirm');
        this.closed = null;
        await g.live.create();
        await this.sendPick();
      } else if (a === 'join') {
        const input = this.el.querySelector('#lv-code') as HTMLInputElement | null;
        await this.joinCode(input?.value ?? '');
      } else if (a === 'copy-code' && room) await copy(g, room.code, 'Код скопирован');
      else if (a === 'copy-link' && room) await copy(g, inviteLink(siteOrigin(), room.code), 'Ссылка скопирована');
      else if (a === 'share' && room) {
        const url = inviteLink(siteOrigin(), room.code);
        try {
          await navigator.share({ title: 'PRIME TIME: SHOWDOWN — LIVE DUEL', text: `Вызываю тебя на дуэль! Код: ${room.code}`, url });
        } catch {
          /* the player closed the share sheet */
        }
      } else if (a === 'fighter' && b?.dataset.f) {
        g.audio.ui('click');
        this.choose(b.dataset.f as FighterId);
        await this.sendPick();
      } else if (a === 'deck' && b?.dataset.i && this.pick) {
        g.audio.ui('click');
        this.pick.deck.splice(Number(b.dataset.i), 1);
        this.render();
      } else if (a === 'card' && b?.dataset.card && this.pick) {
        g.audio.ui('click');
        const c = b.dataset.card as CardId;
        if (!this.pick.deck.includes(c) && this.pick.deck.length < 4) this.pick.deck.push(c);
        if (this.pick.deck.length === 4) await this.sendPick();
        else this.render();
      } else if (a === 'ready' && room) {
        const me = room.you === 'host' ? room.host : room.guest;
        if (!me?.ready && this.pick && this.pick.deck.length === 4 && (!me?.picked || this.pickChanged(me))) await this.sendPick();
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

  /** Sends the pick (the worn look when it is a bought one; refused → the fighter's own look). */
  private async sendPick(): Promise<void> {
    const room = this.g.live.room;
    const p = this.ensurePick();
    if (!room || !p || p.deck.length !== 4 || room.status === 'fight' || room.status === 'closed') return;
    const worn = this.g.fighterLook(p.fighter);
    const look = worn && worn !== FIGHTERS[p.fighter].look ? worn : null;
    try {
      await this.g.live.pick(p.fighter, p.deck, look);
    } catch (e) {
      if (e instanceof PrimeApiError && e.code === 'look_not_owned' && look) await this.g.live.pick(p.fighter, p.deck, null);
      else throw e;
    }
    writePick(p);
  }

  private shownKey = '';

  /** Repaints only when something the player sees changed (the heartbeat brings the same room every 2 s). */
  private render(force = false): void {
    const g = this.g;
    const room = g.live.room;
    const key = JSON.stringify([g.live.access(), room, this.pick, this.msg, this.busy, this.closed, g.live.stats, g.live.pendingInvite()]);
    if (!force && key === this.shownKey) return;
    this.shownKey = key;
    const acc = g.live.access();
    const head = `<div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад">${UI_ICONS.back}</button>
        <div class="h1 lv-h1">LIVE DUELS</div>
      </div>`;
    let body: string;
    if (acc !== 'ready') body = this.gateHTML(acc);
    else if (g.live.room && g.live.room.status !== 'closed') body = this.roomHTML(g.live.room);
    else body = this.lobbyHTML();
    this.el.innerHTML = `${head}<div class="fill scroll lv-scroll">${body}</div>`;
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
    return `<div class="lv-stats"><span><b>${st.played}</b> дуэлей</span><span><b>${st.wins}</b> побед</span><span>серия <b>${st.best}</b></span></div>${rivals}`;
  }

  private lobbyHTML(): string {
    const closed = this.closed ? `<div class="lv-note">${esc(closedText(this.closed))}</div>` : '';
    const code = this.g.live.pendingInvite() ?? '';
    return `<div class="lv-hero">${this.emblem()}<div class="lv-hero-k">ОНЛАЙН-ДУЭЛИ С ДРУЗЬЯМИ</div></div>
      ${closed}${this.msg ? `<div class="lv-err" role="alert">${esc(this.msg)}</div>` : ''}
      <button class="btn big wide lv-cta" data-act="create" ${this.busy ? 'disabled' : ''}><span class="shine"></span>Создать дуэль</button>
      <form class="lv-join" autocomplete="off">
        <label class="lv-join-l" for="lv-code">Войти по коду</label>
        <div class="lv-join-row">
          <input id="lv-code" class="lv-code-in" maxlength="8" inputmode="text" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="K7M2QX" value="${esc(code)}" aria-label="Код комнаты" />
          <button class="btn teal" type="submit" ${this.busy ? 'disabled' : ''}>Войти</button>
        </div>
      </form>
      <ol class="lv-how">
        <li><b>Создайте дуэль</b> — появится код из 6 знаков.</li>
        <li><b>Отправьте другу</b> код или ссылку — он откроет игру и войдёт в комнату.</li>
        <li><b>Выберите бойцов</b> и нажмите «Готов» — бой начнётся у обоих одновременно.</li>
      </ol>
      ${this.statsLine()}
      <p class="lv-fine">Бой идёт на сервере: итог считает сервер по записи действий обоих игроков. Рейтинг PRIME LEAGUE, RP и жетоны не меняются.</p>`;
  }

  private roomHTML(room: LiveRoom): string {
    const me = room.you === 'host' ? room.host : room.guest;
    const other = room.you === 'host' ? room.guest : room.host;
    const p = this.ensurePick();
    const waiting = room.status === 'waiting';
    const status = waiting
      ? '<div class="lv-status wait"><i></i>Ожидание друга…</div>'
      : room.status === 'fight'
        ? '<div class="lv-status on"><i></i>Бой идёт</div>'
        : other && !other.connected
          ? '<div class="lv-status off"><i></i>Соединение с другом потеряно — ждём…</div>'
          : other?.ready
            ? '<div class="lv-status on"><i></i>Соперник готов</div>'
            : '<div class="lv-status on"><i></i>Друг в комнате</div>';
    const score = room.games > 0 ? `<div class="lv-score">Счёт встреч <b>${room.you === 'host' ? room.score.host : room.score.guest}</b> : <b>${room.you === 'host' ? room.score.guest : room.score.host}</b>${room.score.draws ? ` · ничьих ${room.score.draws}` : ''}</div>` : '';
    const player = (x: LivePlayer | null, you: boolean) => {
      if (!x) return `<div class="lv-pl empty"><div class="lv-pl-face">?</div><b>Свободное место</b><small>Отправьте код другу</small></div>`;
      const f = x.fighter ? FIGHTERS[x.fighter] : null;
      const face = f ? portraitHTML(this.g.portraitFor(leagueLook(x.fighter as FighterId, x.look ?? undefined)), f.theme.main, f.theme.dark, 'lv-pl-f') : '<div class="lv-pl-face">?</div>';
      return `<div class="lv-pl ${you ? 'me' : 'foe'} ${x.ready ? 'ready' : ''}">${face}<b>${esc(x.name)}</b><small>${f ? esc(f.name) : 'выбирает бойца…'}</small>${connDot(x, you)}<span class="lv-ready">${x.ready ? 'ГОТОВ' : 'не готов'}</span></div>`;
    };
    const codeBox = `<div class="lv-code">
        <div class="lv-code-k">Код комнаты</div>
        <button class="lv-code-v" data-act="copy-code" aria-label="Скопировать код ${esc(room.code)}">${esc(room.code)}</button>
        <div class="lv-code-acts">
          <button class="btn ghost" data-act="copy-code">Копировать код</button>
          <button class="btn ghost" data-act="copy-link">Копировать ссылку</button>
          ${typeof navigator.share === 'function' ? '<button class="btn ghost" data-act="share">Поделиться</button>' : ''}
        </div>
        <small>Код действует ${Math.round(LIVE.waitMs / 60000)} минут.</small>
      </div>`;
    const fighters = this.fighters()
      .map((id) => {
        const f = FIGHTERS[id];
        return `<button class="lv-f ${p?.fighter === id ? 'on' : ''}" data-act="fighter" data-f="${id}" aria-pressed="${p?.fighter === id}" aria-label="${esc(f.name)}">${portraitHTML(this.g.portraitOf(id), f.theme.main, f.theme.dark)}<span>${esc(f.name)}</span></button>`;
      })
      .join('');
    const allowed = p ? leagueCards(p.fighter, this.owned()) : [];
    const slots = [0, 1, 2, 3].map((i) => {
      const c = p?.deck[i];
      return `<div class="slot" data-act="${c ? 'deck' : ''}" data-i="${i}">${c ? cardHTML(c, '', false) : '+'}</div>`;
    });
    const coll = allowed
      .filter((c) => !p?.deck.includes(c))
      .map((c) => `<div data-act="card" data-card="${c}">${cardHTML(c, '', false)}</div>`)
      .join('');
    const locked = !!me?.ready || room.status === 'fight';
    const ready = me?.ready;
    const canReady = !!p && p.deck.length === 4 && room.status === 'open';
    return `${status}${score}${this.msg ? `<div class="lv-err" role="alert">${esc(this.msg)}</div>` : ''}
      ${waiting ? codeBox : ''}
      <div class="lv-players">${player(room.you === 'host' ? me : other, room.you === 'host')}<div class="lv-vs">VS</div>${player(room.you === 'host' ? other : me, room.you === 'guest')}</div>
      <section class="lv-pick ${locked ? 'locked' : ''}">
        <div class="lv-sec">Ваш боец</div>
        <div class="lv-fighters">${fighters}</div>
        <div class="lv-sec">Колода · ${p?.deck.length ?? 0}/4 <small>колода соперника скрыта до старта</small></div>
        <div class="deck-slots">${slots.join('')}</div>
        ${coll ? `<div class="collection lv-coll">${coll}</div>` : ''}
      </section>
      <div class="lv-acts">
        <button class="btn big wide lv-cta ${ready ? 'is-ready' : ''}" data-act="ready" ${canReady || ready ? '' : 'disabled'}><span class="shine"></span>${ready ? 'Готов ✓' : 'Готов'}</button>
        ${ready ? `<div class="lv-hint">${waiting ? 'Ждём друга — бой начнётся, когда он тоже будет готов.' : 'Ждём соперника. Нажмите ещё раз, чтобы отменить.'}</div>` : ''}
        ${waiting ? '' : codeBox.replace('lv-code"', 'lv-code mini"')}
        <button class="btn ghost wide" data-act="leave">Выйти из комнаты</button>
      </div>`;
  }
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
    this.shownKey = '';
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

  private shownKey = '';

  private render(): void {
    const g = this.g;
    const v: LiveMatchView | null = g.live.last ?? g.liveView;
    const rm = g.live.room;
    const key = JSON.stringify([v?.id, v?.status, v?.result?.hash, rm?.status, rm?.rematch, rm?.score, rm?.host?.connected, rm?.guest?.connected, rm?.guest?.name]);
    if (key === this.shownKey) return;
    this.shownKey = key;
    if (!v) {
      this.el.innerHTML = '';
      return;
    }
    const r = v.status === 'done' ? v.result : null;
    const me = v.side;
    const foe = (1 - me) as 0 | 1;
    const outcome = !r ? 'pending' : r.winner < 0 ? 'draw' : r.winner === me ? 'win' : 'loss';
    if (r && this.stung !== v.id) {
      this.stung = v.id;
      if (outcome === 'win') g.audio.victory();
      else if (outcome === 'loss') g.audio.defeat();
      else g.audio.reaction(2);
    }
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
    const room = g.live.room;
    const open = !!room && room.status !== 'closed';
    const myWish = room ? (room.you === 'host' ? room.rematch.host : room.rematch.guest) : false;
    const theirWish = room ? (room.you === 'host' ? room.rematch.guest : room.rematch.host) : false;
    const other = room ? (room.you === 'host' ? room.guest : room.host) : null;
    const score = room && room.games > 0 ? `<div class="lv-score">Счёт встреч <b>${room.you === 'host' ? room.score.host : room.score.guest}</b> : <b>${room.you === 'host' ? room.score.guest : room.score.host}</b></div>` : '';
    const rematch = !r
      ? ''
      : open && other
        ? `<button class="btn big wide lg-cta lv-rematch ${myWish ? 'is-ready' : ''}" data-act="rematch"><span class="shine"></span>${myWish ? 'Реванш ✓' : theirWish ? 'Принять реванш!' : 'Реванш'}</button>${myWish ? '<div class="lv-hint">Ждём ответа друга. Нажмите ещё раз, чтобы отменить.</div>' : theirWish ? '<div class="lv-note">Друг предлагает реванш</div>' : ''}<button class="btn ghost wide" data-act="room">Сменить бойца</button>`
        : '<div class="lv-note">Соперник покинул комнату.</div>';
    this.el.innerHTML = `<div class="lg-result panel scroll ${outcome}" aria-live="polite">
        <div class="lg-res-k"><span class="lg-onair"><i></i>LIVE</span> LIVE DUEL${v.game > 1 ? ` · РЕВАНШ ${v.game - 1}` : ''}</div>
        <div class="lg-res-h"><span>${head}</span></div><div class="lg-res-m">${esc(method)}</div>
        <div class="lg-fo">${card(me)}<div class="lg-fo-vs">VS</div>${card(foe)}</div>
        ${stats}${reward}${score}
        <div class="lg-res-acts">${rematch}<button class="btn ghost wide" data-act="exit">Выйти</button></div>
        ${r ? '<small class="muted">Итог подтверждён сервером по записи действий обоих игроков.</small>' : ''}
      </div>`;
  }
}
