import { CARDS, UNIVERSAL_CARDS } from '../../config/cards';
import { FIGHTERS } from '../../config/fighters';
import { LEAGUE, LEAGUE_FIGHTERS, LEAGUE_RULES_VERSION, RANKS, TACTICS, TACTIC_ORDER, type TacticId } from '../../config/league.config';
import { plural } from '../../config/events.config';
import { SKINS } from '../../config/shop.config';
import type { CardId, FighterId } from '../../config/types';
import type { MatchResultData } from '../../combat/types';
import type { Game } from '../../game/Game';
import { lastEntry, rememberEntry } from '../../game/LeagueRuntime';
import { lang } from '../../i18n/lang';
import { ownsPaid } from '../../meta/entitlements';
import { inRoster } from '../../meta/roster';
import { newOp, type LeagueBoard, type LeagueFinish, type LeagueHistory, type LeagueMatch, type LeagueMe, type LeagueSeries, type LeagueSlot } from '../../net/LeagueApi';
import { PrimeApiError } from '../../net/PrimeApi';
import { cardHTML, el, esc, portraitHTML } from '../dom';
import { UI_ICONS } from '../icons';
import { ICONS } from '../eventArt';
import { MODE_ICONS } from '../modeArt';
import { onAir, rankEmblem, tacticIcon } from '../leagueArt';
import { producerSVG, systemProducerSVG } from '../producerArt';
import type { Screen } from '../UI';

// Alpha 1.9.0 — PRIME LEAGUE screens. Everything shown comes from the server (/api/prime/league/*): the game never
// invents a rank, an opponent or a result. Honest wording throughout: the opponent may be off air — the AI director
// plays its saved cards.

const tr = (ru: string, en: string) => (lang() === 'en' ? en : ru);
const TABS = ['play', 'board', 'defense', 'rewards', 'history'] as const;
/** The attributes that name a control (to give it back the keyboard focus after a redraw). */
const FOCUS_KEYS = ['data-act', 'data-tab', 'data-i', 'data-f', 'data-c', 'data-k', 'data-v', 'data-t', 'data-e', 'data-mode', 'data-a'];
type Tab = (typeof TABS)[number];
const TAB_NAME: Record<Tab, [string, string]> = { play: ['ИГРАТЬ', 'PLAY'], board: ['РЕЙТИНГ', 'RANKING'], defense: ['ЗАЩИТА', 'DEFENCE'], rewards: ['НАГРАДЫ', 'REWARDS'], history: ['ИСТОРИЯ', 'HISTORY'] };
/** 1.9.1: each tab has its sign — five equal tabs that fit a 320 px phone without cutting a word. */
const TAB_ICON: Record<Tab, string> = { play: UI_ICONS.bolt, board: UI_ICONS.trophy, defense: UI_ICONS.shieldMini, rewards: UI_ICONS.gift, history: UI_ICONS.film };

const ERR: Record<string, [string, string]> = {
  fighter_not_owned: ['Этот боец ещё не подписан в вашей карьере (или PRIME CLOUD не успел синхронизироваться).', 'This fighter is not signed in your career yet (or PRIME CLOUD has not synced).'],
  card_not_allowed: ['В колоде есть карта, которой нет в вашей коллекции.', 'The deck holds a card your collection does not have.'],
  deck_size: ['В колоде должно быть ровно 4 карты.', 'A deck holds exactly 4 cards.'],
  deck_duplicate: ['Одна карта дважды в колоде.', 'The same card twice in a deck.'],
  defense_duplicate: ['Один боец может стоять в защите только один раз.', 'A fighter may defend only once.'],
  match_active: ['У вас уже идёт эфир — продолжите его.', 'You have a broadcast running — resume it.'],
  update_required: ['Сервер уже работает по новым правилам боя. Обновите страницу.', 'The server runs newer fight rules. Reload the page.'],
  too_many_matches: ['Слишком много эфиров за час. Передохните немного.', 'Too many broadcasts this hour. Take a short break.'],
  series_active: ['Сначала завершите открытую серию.', 'Finish the open series first.'],
  challenge_open: ['Открыта квалификация PRIME CHALLENGE — сыграйте её.', 'A PRIME CHALLENGE qualifier is open — play it.'],
  league_off: ['PRIME LEAGUE сейчас не в эфире.', 'PRIME LEAGUE is off air right now.'],
  too_many_requests: ['Слишком много запросов подряд — подождите несколько секунд и повторите.', 'Too many requests in a row — wait a few seconds and try again.'],
  rate_limited: ['PRIME NETWORK сейчас перегружена с вашего адреса — подождите несколько секунд.', 'PRIME NETWORK is busy from your address — wait a few seconds.'],
  not_enough_tokens: ['Не хватает PRIME TOKENS.', 'Not enough PRIME TOKENS.'],
  not_league_fighter: ['Этот персонаж не участвует в лиге: в PRIME LEAGUE выходят только бойцы вашего ростера.', 'This character does not take part in the league: only fighters of your roster do.'],
  defense_look: ['Этот облик не куплен для бойца.', 'This look is not owned for the fighter.'],
  defense_tactic: ['Неизвестная тактика.', 'Unknown tactic.'],
  defense_slots: ['В защите от 1 до 5 бойцов.', 'A defence holds 1 to 5 fighters.'],
  no_challenge: ['Квалификация ещё не открыта.', 'The qualifier is not open yet.'],
};
function errText(e: unknown): string {
  const code = e instanceof PrimeApiError ? e.code : '';
  const t = ERR[code];
  if (t) return tr(t[0], t[1]);
  if (e instanceof PrimeApiError && e.kind === 'network') return tr('Нет связи с PRIME NETWORK. Проверьте интернет и повторите.', 'No connection to PRIME NETWORK. Check the connection and retry.');
  return tr('Сервер не принял запрос', 'The server refused the request') + (code ? ` (${code})` : '') + '.';
}

const rankName = (i: number) => (lang() === 'en' ? RANKS[i].en : RANKS[i].ru);
const fmtDate = (t: number) => new Date(t).toLocaleDateString(lang() === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long' });

/** Fighters of this player's roster (signed in the career, opened in an event or bought) — the only league fighters. */
function myFighters(g: Game): FighterId[] {
  return LEAGUE_FIGHTERS.filter((id) => inRoster(g.save.data, id));
}
/** Roster fighters not open yet, with the honest reason (career rivals and bosses are never league fighters at all). */
function lockedFighters(g: Game): { id: FighterId; why: string }[] {
  return LEAGUE_FIGHTERS.filter((id) => !inRoster(g.save.data, id)).map((id) => ({
    id,
    why: FIGHTERS[id].seasonal ? tr('Событие или PRIME SHOP', 'Event or PRIME SHOP') : tr('Открывается в карьере', 'Opens in the career'),
  }));
}
/** The deck a fighter attacks with in the league: its league deck (server), else the career deck (the save is never changed). */
function deckOf(g: Game, id: FighterId): CardId[] {
  const d = g.league.me?.decks?.[id];
  return d && d.length === 4 ? d.slice() : (g.save.data.fighters[id]?.deck?.slice(0, 4) ?? FIGHTERS[id].defaultDeck.slice());
}
function lockedPicks(g: Game): string {
  return lockedFighters(g)
    .map((l) => `<span class="lg-fpick locked" title="${esc(l.why)}" aria-disabled="true">${portraitHTML(g.portraitOf(l.id), FIGHTERS[l.id].theme.main, FIGHTERS[l.id].theme.dark)}<span>${esc(FIGHTERS[l.id].name)}</span><em>${esc(l.why)}</em></span>`)
    .join('');
}
/** Cards this fighter may take into a league deck (the same rule the server applies). */
function allowedCards(g: Game, id: FighterId): CardId[] {
  return [...UNIVERSAL_CARDS, FIGHTERS[id].signature, ...g.save.data.cards.owned.filter((c) => c in CARDS)];
}
/** A bought PRIME SHOP skin of this fighter (rendering only), or null. */
function skinOf(id: FighterId): string | null {
  for (const s of Object.values(SKINS)) if (s.fighter === id && ownsPaid('skin_' + s.id)) return s.id;
  return null;
}

/** 1.9.1: PRIME SQUAD's sign — three fighters shoulder to shoulder. */
const SQUAD_ICON = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="16" cy="24" r="7" fill="#7cf7d4" opacity=".75"/><path d="M4 50c0-8 5-14 12-14s12 6 12 14z" fill="#7cf7d4" opacity=".75"/><circle cx="48" cy="24" r="7" fill="#7cf7d4" opacity=".75"/><path d="M36 50c0-8 5-14 12-14s12 6 12 14z" fill="#7cf7d4" opacity=".75"/><circle cx="32" cy="20" r="9" fill="#fff"/><path d="M17 54c0-10 7-17 15-17s15 7 15 17z" fill="#fff"/></svg>`;

/** 1.9.1: the PRIME TOKEN as a coin (a league currency, never money) — one inline SVG, no image file. */
function tokenCoin(size: number): string {
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="#ffb21a"/><circle cx="24" cy="24" r="21" fill="none" stroke="#ffe9a8" stroke-width="2.5"/><circle cx="24" cy="24" r="15.5" fill="#ff8a1a" opacity=".55"/><path d="M16 15h16v5h-5.5v14h-5V20H16z" fill="#fff"/><path d="M9 18a17 17 0 0 1 9-10" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".6"/></svg>`;
}

/**
 * 1.9.1: «КАРЬЕРА | PRIME LEAGUE» — the two halves of the show, on the career's modes screen and in the league alike.
 * Tapping the other half is the player's explicit choice: «В БОЙ!» goes there next time.
 */
export function entrySwitch(active: 'career' | 'league'): string {
  return `<div class="ent-switch" role="tablist" aria-label="${tr('Эфир', 'Broadcast')}">
      <button class="es-opt career ${active === 'career' ? 'on' : ''}" data-act="to-career" role="tab" aria-selected="${active === 'career'}"><span class="es-ico" aria-hidden="true">${MODE_ICONS.classic}</span><span>${tr('КАРЬЕРА', 'CAREER')}</span></button>
      <button class="es-opt league ${active === 'league' ? 'on' : ''}" data-act="to-league" role="tab" aria-selected="${active === 'league'}"><span class="es-ico" aria-hidden="true">${rankEmblem(3, null, 22)}</span><span>PRIME LEAGUE</span></button>
    </div>`;
}

/** 1.9.1: a deck as the game's own cards (the career's card art — icon, colours, energy), small and read-only. */
function deckRow(deck: CardId[]): string {
  return `<div class="lg-deckrow" role="list">${deck.map((c) => `<span class="lg-dcard" role="listitem" aria-label="${esc(CARDS[c].name)} · ${CARDS[c].cost}">${cardHTML(c, 'lg-mcard', false)}</span>`).join('')}</div>`;
}
/** 1.9.1: a card to pick for a deck — the same card art, chosen or free, its role beneath (ids, costs and rules unchanged). */
function pickCard(c: CardId, on: boolean, act: string, extra = ''): string {
  return `<button class="lg-cardpick ${on ? 'on' : ''}" data-act="${act}" ${extra} data-c="${c}" aria-pressed="${on}" aria-label="${esc(CARDS[c].name)} · ${CARDS[c].cost} · ${esc(CARDS[c].role)}">${cardHTML(c, 'lg-pcard', false)}<small>${esc(CARDS[c].role)}</small></button>`;
}

/** «В БОЙ!»: the last chosen direction, or the choice between the career and PRIME LEAGUE. */
export function openFightEntry(g: Game): void {
  // while this server has no league (off, or a server before 1.9.0) «В БОЙ!» goes straight to the career as before —
  // nothing is remembered; without a connection the player is told the league is only out of reach for now
  if (g.league.access() === 'off') {
    if (g.account?.serverUp === false && !g.account.serverConfig) g.ui.toast(tr('PRIME NETWORK не отвечает — PRIME LEAGUE откроется, когда связь вернётся', 'PRIME NETWORK is not answering — PRIME LEAGUE opens once the connection is back'));
    return g.goto('modes');
  }
  const last = lastEntry();
  if (last === 'league') return g.goto('league');
  if (last === 'career') return g.goto('modes');
  const acc = g.league.access();
  // a guest may look at the league (its rules, how to take part) — the play itself needs a confirmed PRIME ID
  const hint = acc === 'guest' ? tr('PRIME LEAGUE можно открыть и посмотреть; играть — с подтверждённым PRIME ID.', 'You can open PRIME LEAGUE and look around; playing needs a confirmed PRIME ID.') : acc === 'unverified' ? tr('Для боёв лиги подтвердите email PRIME ID.', 'Confirm your PRIME ID email to fight in the league.') : '';
  g.ui.modal(
    `<div class="ent" role="dialog" aria-labelledby="ent-title">
       <div class="ent-head"><span class="ent-k">${onAir()} PRIME NETWORK</span><div class="h1" id="ent-title">${tr('Выберите эфир', 'Choose your broadcast')}</div>
         <p>${tr('Карьера и PRIME LEAGUE — две части одного шоу. Сменить эфир можно в любой момент кнопкой в шапке экрана.', 'The career and PRIME LEAGUE are two halves of one show. Switch any time with the button in the screen’s head.')}</p></div>
       <button class="ent-card career" data-e="career">
         <span class="ent-ico">${MODE_ICONS.classic}</span>
         <span class="ent-txt"><span class="ent-kick">${tr('СЮЖЕТ · БОССЫ · ОТКРЫТИЯ', 'STORY · BOSSES · UNLOCKS')}</span><b>${tr('КАРЬЕРА', 'CAREER')}</b><small>${tr('Ваше шоу против соперников карьеры: гонорары, новые бойцы и карты.', 'Your show against the career rivals: fees, new fighters and cards.')}</small></span>
         <span class="ent-go" aria-hidden="true">${UI_ICONS.next}</span>
       </button>
       <button class="ent-card league" data-e="league">
         <span class="ent-ico">${rankEmblem(3, null, 46)}</span>
         <span class="ent-txt"><span class="ent-kick">${tr('РЕЙТИНГ · РАНГИ · СЕЗОН', 'RANKING · RANKS · SEASON')}</span><b>PRIME LEAGUE</b><small>${tr('Дуэли с сохранёнными составами других продюсеров: RP, ранги, сезон.', 'Duels against other producers’ saved line-ups: RP, ranks, the season.')}</small></span>
         <span class="ent-go" aria-hidden="true">${UI_ICONS.next}</span>
       </button>
       ${hint ? `<small class="ent-hint">${hint}</small>` : ''}
     </div>`,
    (root, close) => {
      const onKey = (e: KeyboardEvent) => {
        if (!root.isConnected) return document.removeEventListener('keydown', onKey);
        if (e.key !== 'Escape') return;
        document.removeEventListener('keydown', onKey);
        close();
      };
      document.addEventListener('keydown', onKey);
      (root.querySelector('.ent-card') as HTMLElement | null)?.focus({ preventScroll: true });
      root.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('[data-e]') as HTMLElement | null;
        if (!b) return;
        document.removeEventListener('keydown', onKey);
        close();
        g.audio.ui('confirm');
        // a card of this window is the player's explicit choice: «В БОЙ!» goes there next time (the switch changes it)
        rememberEntry(b.dataset.e === 'league' ? 'league' : 'career');
        g.goto(b.dataset.e === 'league' ? 'league' : 'modes');
      });
    },
  );
}

interface DraftSlot {
  slot: number;
  fighter: FighterId;
  deck: CardId[];
  tactic: TacticId;
  look: string | null;
  enabled: boolean;
}

export class LeagueScreen implements Screen {
  readonly el: HTMLElement;
  private tab: Tab = 'play';
  private agree = false;
  /** The view drawn last (see render: the same view keeps its scroll). */
  private viewKey = '';
  private loading = false;
  private err = '';
  private notice = '';
  private board: LeagueBoard | null = null;
  private boardErr = '';
  private history: LeagueHistory | null = null;
  private historyErr = '';
  private draft: DraftSlot[] | null = null;
  private editSlot = -1;
  private pick: FighterId;
  private squadPick: FighterId[] = [];
  private busy = false;
  /** The attacker's league deck being edited (null: closed). */
  private deckDraft: CardId[] | null = null;

  constructor(private readonly g: Game) {
    this.el = el('div', 'league');
    this.pick = g.save.data.selected;
    this.el.addEventListener('click', (e) => this.onClick(e));
    g.league.onChange(() => {
      if (this.g.ui.current === 'league') this.render();
    });
  }

  onShow(params?: { tab?: Tab }): void {
    if (params?.tab) this.tab = params.tab;
    this.err = '';
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    if (this.g.league.access() !== 'ready') return;
    this.loading = !this.g.league.me;
    this.render();
    try {
      await this.g.league.refresh();
      this.err = '';
    } catch (e) {
      this.err = errText(e);
    }
    this.loading = false;
    this.render();
    if (this.tab === 'board') void this.loadBoard();
    if (this.tab === 'history') void this.loadHistory();
  }

  private async loadBoard(): Promise<void> {
    this.boardErr = '';
    try {
      this.board = await this.g.league.api()!.board(0);
    } catch (e) {
      this.boardErr = errText(e);
    }
    this.render();
  }
  private async loadHistory(): Promise<void> {
    this.historyErr = '';
    try {
      this.history = await this.g.league.api()!.history();
    } catch (e) {
      this.historyErr = errText(e);
    }
    this.render();
  }

  // ---------------------------------------------------------------- render
  private render(): void {
    const g = this.g;
    const acc = g.league.access();
    const me = g.league.me;
    // 1.9.1: a calm head (back · the title · ON AIR) and, beneath it, the big «КАРЬЕРА | PRIME LEAGUE» switch
    const head = `<div class="screen-head lg-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="${tr('Назад', 'Back')}">${UI_ICONS.back}</button>
        <div class="h1 lg-title"><span>PRIME LEAGUE</span>${onAir()}</div>
      </div>${entrySwitch('league')}`;
    let body = '';
    // which view is on screen: the same view drawn again keeps its scroll; another view starts at the top
    let viewKey = 'state';
    if (acc !== 'ready') body = this.intro(acc);
    else if (g.league.outdated()) body = `<div class="lg-card lg-warn"><b>${tr('Новые правила боя', 'New fight rules')}</b><p>${tr('Сервер PRIME NETWORK уже работает по обновлённым правилам боя. Обновите страницу, чтобы бой на экране совпадал с проверкой сервера.', 'PRIME NETWORK already runs updated fight rules. Reload the page so the fight on screen matches the server check.')}</p><button class="btn teal wide" data-act="reload">${tr('Обновить', 'Reload')}</button></div>`;
    else if (this.loading) body = `<div class="lg-state">${tr('Подключаемся к эфиру PRIME NETWORK…', 'Tuning in to PRIME NETWORK…')}</div>`;
    else if (!me && this.err) body = `<div class="lg-state err">${esc(this.err)}<button class="btn ghost" data-act="retry">${tr('Повторить', 'Retry')}</button></div>`;
    else if (!me) body = `<div class="lg-state">${tr('Подключаемся…', 'Connecting…')}</div>`;
    else if (!me.joined || (me.rulesAccepted ?? 0) < LEAGUE_RULES_VERSION) {
      body = this.invite(me);
      viewKey = 'invite';
    } else {
      viewKey = 'tab:' + this.tab;
      const tabs = TABS.map((t) => `<button class="lg-tab ${t === this.tab ? 'on' : ''}" data-tab="${t}" role="tab" aria-selected="${t === this.tab}"><span class="lg-tab-ico" aria-hidden="true">${TAB_ICON[t]}</span><span class="lg-tab-t">${tr(TAB_NAME[t][0], TAB_NAME[t][1])}</span>${t === 'defense' && me.report.matches ? `<i class="lg-dot">${me.report.matches}</i>` : ''}</button>`).join('');
      const view = this.tab === 'play' ? this.play(me) : this.tab === 'board' ? this.boardView(me) : this.tab === 'defense' ? this.defense(me) : this.tab === 'rewards' ? this.rewards(me) : this.historyView();
      body = `<div class="lg-tabs" role="tablist">${tabs}</div>${this.err ? `<div class="lg-note err">${esc(this.err)}</div>` : ''}${this.notice ? `<div class="lg-note">${esc(this.notice)}</div>` : ''}<div class="lg-view">${view}</div>`;
    }
    // a tick, a tactic or a card redraws the screen: the reader keeps their place (a phone must not jump back to the
    // top, away from the button it was scrolling to) and the keyboard keeps the control it just used
    const prev = this.el.querySelector('.lg-scroll') as HTMLElement | null;
    const keepY = prev && viewKey === this.viewKey ? prev.scrollTop : 0;
    const a = document.activeElement as HTMLElement | null;
    const focusSel = a && a !== this.el && this.el.contains(a) ? FOCUS_KEYS.filter((k) => a.hasAttribute(k)).map((k) => `[${k}="${CSS.escape(a.getAttribute(k) ?? '')}"]`).join('') : '';
    this.el.innerHTML = `${head}<div class="fill scroll lg-scroll">${body}</div>`;
    this.viewKey = viewKey;
    if (keepY) (this.el.querySelector('.lg-scroll') as HTMLElement).scrollTop = keepY;
    if (focusSel) (this.el.querySelector(focusSel) as HTMLElement | null)?.focus({ preventScroll: true });
    const ch = me?.ceremony;
    if (ch && ch.kind === 'rank' && this.g.ui.current === 'league') showCeremony(this.g, ch.rank, !!ch.challenge);
  }

  /** What the league is — for everyone, signed in or not (nobody plays it without a confirmed PRIME ID). */
  private intro(acc: string): string {
    const why =
      acc === 'off'
        ? tr('PRIME LEAGUE скоро выйдет в эфир на этом сервере.', 'PRIME LEAGUE goes on air on this server soon.')
        : acc === 'unverified'
          ? tr('Подтвердите email PRIME ID — и эфир лиги откроется.', 'Confirm your PRIME ID email — and the league opens.')
          : acc === 'held'
            ? tr('PRIME ID на этой странице ещё не готов к эфиру (сессия или документы). Откройте профиль.', 'Your PRIME ID is not ready here yet (session or documents). Open the profile.')
            : tr('Лига доступна с подтверждённым PRIME ID. Гостевая карьера остаётся как есть.', 'The league needs a confirmed PRIME ID. The guest career stays as it is.');
    return `<div class="lg-hero">
        ${rankEmblem(3, 'II', 92, 'lg-hero-emb')}
        <div class="lg-hero-k">${tr('ЗВЁЗДНЫЙ ЭФИР PRIME NETWORK', 'THE PRIME NETWORK STAR BROADCAST')}</div>
        <div class="lg-hero-t">${tr('Докажи, что твоё шоу — лучшее', 'Prove your show is the best')}</div>
      </div>
      ${this.rulesList()}
      <div class="lg-card"><p>${why}</p>${acc === 'guest' || acc === 'held' || acc === 'unverified' ? `<button class="btn teal wide" data-act="profile">${tr('Открыть PRIME ID', 'Open PRIME ID')}</button>` : ''}</div>`;
  }

  private rulesList(): string {
    return `<ul class="lg-rules">
        <li><b>${tr('Асинхронные дуэли.', 'Asynchronous duels.')}</b> ${tr('Вы сами играете картами против сохранённого состава другого игрока. Соперник может быть офлайн: его картами управляет ИИ-режиссёр по выбранной им тактике — это не живой человек в эту секунду.', 'You play your cards against another player’s saved line-up. The opponent may be offline: the AI director plays its cards by the tactic its owner chose — not a live person right now.')}</li>
        <li><b>RP ${tr('и ранги', 'and ranks')}.</b> ${tr('Победы приносят RP, за сильного соперника — больше. Восемь рангов, дивизионы III → II → I; на новый ранг ведёт квалификация PRIME CHALLENGE.', 'Wins bring RP, more against stronger opponents. Eight ranks, divisions III → II → I; a PRIME CHALLENGE qualifier leads to each new rank.')}</li>
        <li><b>${tr('Защита.', 'Defence.')}</b> ${tr('Выставьте от 1 до 5 бойцов с колодами и тактикой. Пока вас нет, они защищают эфир. Поражение защиты не отнимает RP.', 'Field 1 to 5 fighters with decks and a tactic. While you are away they defend. A lost defence never costs RP.')}</li>
        <li><b>${tr('Честно.', 'Fair.')}</b> ${tr('Результат проверяет сервер, повторяя бой по вашим нажатиям. Скины — только внешний вид. Никаких покупок силы за деньги.', 'The server checks every result by replaying your taps. Skins are looks only. No power for money.')}</li>
        <li><b>${tr('Сезон', 'Season')} ${LEAGUE.season.lengthDays} ${tr('дней', 'days')}.</b> ${tr('Эфирные очки, дорожка наград, PRIME TOKENS и титулы. В начале сезона RP мягко пересчитывается, история остаётся.', 'Air points, a reward track, PRIME TOKENS and titles. RP is softly reset each season; history stays.')}</li>
        <li><b>${tr('Участники PRIME NETWORK.', 'PRIME NETWORK participants.')}</b> ${tr('Пока игроков мало, защищать могут и составы студии PRIME NETWORK. Они честно подписаны и не занимают мест в таблице игроков.', 'While players are few, PRIME NETWORK studio line-ups may defend too. They are labelled and never take places in the players’ table.')}</li>
      </ul>`;
  }

  private invite(me: LeagueMe): string {
    const again = me.joined;
    return `<div class="lg-hero invite">
        ${rankEmblem(0, 'III', 84, 'lg-hero-emb')}
        <div class="lg-hero-k">${onAir()} ${me.season.number ? `${tr('СЕЗОН', 'SEASON')} ${me.season.number}` : tr('ПРЕДСЕЗОНЬЕ', 'PRE-SEASON')}</div>
        <div class="lg-hero-t">${again ? tr('Правила лиги обновились', 'The league rules changed') : tr('Ты приглашён в PRIME LEAGUE', 'You are invited to PRIME LEAGUE')}</div>
      </div>
      ${this.rulesList()}
      <label class="lg-agree"><input type="checkbox" data-act="agree" ${this.agree ? 'checked' : ''}/> <span>${tr('Я прочитал(а) правила PRIME LEAGUE и согласен(на) участвовать: мои защитные составы будут доступны другим игрокам.', 'I have read the PRIME LEAGUE rules and agree to take part: my defence line-ups will be available to other players.')} <small>(${tr('версия', 'version')} ${LEAGUE_RULES_VERSION})</small></span></label>
      <button class="btn big wide lg-cta" data-act="join" ${this.agree && !this.busy ? '' : 'disabled'}><span class="shine"></span>${tr('Вступить в лигу', 'Join the league')}</button>`;
  }

  private rankCard(me: LeagueMe): string {
    const r = me.rank;
    const toNext = r.divNext !== null ? r.divNext - me.rp : null;
    const nextLabel = r.divNext === null ? tr('Высший ранг эфира', 'The top rank') : r.division === 'I' ? rankName(Math.min(RANKS.length - 1, r.index + 1)) : `${rankName(r.index)} ${r.division === 'III' ? 'II' : 'I'}`;
    const days = me.season.end ? Math.max(0, Math.ceil((me.season.end - me.season.now) / 86400000)) : 0;
    return `<div class="lg-rank" style="--rk:${r.color}">
        ${rankEmblem(r.index, r.division, 76)}
        <div class="lg-rank-main">
          <div class="lg-rank-name">${esc(rankName(r.index))} <span>${r.division ?? ''}</span></div>
          <div class="lg-rank-rp"><b>${me.rp}</b> RP${me.place ? ` · ${tr('место', 'place')} ${me.place}` : ''}</div>
          <div class="lg-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(r.progress * 100)}"><i style="width:${Math.round(r.progress * 100)}%"></i></div>
          <div class="lg-rank-next">${toNext !== null ? `${tr('до', 'to')} ${esc(nextLabel)}: <b>${toNext}</b> RP` : esc(nextLabel)}</div>
        </div>
      </div>
      <div class="lg-season">${me.season.number ? `${tr('Сезон', 'Season')} ${me.season.number} · ${tr('до', 'until')} ${fmtDate(me.season.end!)} (${days} ${tr('дн.', 'days')})` : me.season.end ? `${tr('Предсезонье', 'Pre-season')} · ${tr('сезон 1 стартует', 'season 1 starts')} ${fmtDate(me.season.end)}` : `${tr('Предсезонье', 'Pre-season')} · ${tr('дату старта сезона объявит PRIME NETWORK', 'PRIME NETWORK announces the season start')}`}${me.calibration ? ` · ${tr('калибровка', 'calibration')}: ${me.calibration}` : ''}</div>`;
  }

  private play(me: LeagueMe): string {
    const g = this.g;
    const own = myFighters(g);
    if (!own.includes(this.pick)) this.pick = own[0] ?? 'ray';
    const f = FIGHTERS[this.pick];
    let banner = '';
    if (me.active) {
      banner += `<div class="lg-card lg-resume">${onAir('LIVE')}<b>${tr('Незавершённый эфир', 'An unfinished broadcast')}</b><p>${tr('Бой против', 'The fight against')} ${esc(me.active.opponent.name)} ${tr('ещё идёт. Продолжите — сервер помнит все отправленные нажатия. Если не вернуться до', 'is still on. Resume it — the server keeps every tap it received. If you do not return by')} ${new Date(me.active.expires).toLocaleTimeString(lang() === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}, ${tr('сервер доиграет его сам по этим нажатиям.', 'the server plays it out from those taps.')}</p><button class="btn teal wide" data-act="resume">${tr('Продолжить эфир', 'Resume')}</button></div>`;
    }
    if (me.report.matches) {
      const r = me.report;
      banner += `<div class="lg-card lg-report"><div class="lg-k">${tr('ПОКА ТЕБЯ НЕ БЫЛО В ЭФИРЕ', 'WHILE YOU WERE OFF AIR')}</div><div class="lg-report-row"><span><b>${r.matches}</b> ${tr(plural(r.matches, ['матч', 'матча', 'матчей']), r.matches === 1 ? 'match' : 'matches')}</span><span class="w"><b>${r.wins}</b> ${tr(plural(r.wins, ['победа', 'победы', 'побед']), r.wins === 1 ? 'win' : 'wins')}</span><span class="l"><b>${r.losses}</b> ${tr(plural(r.losses, ['поражение', 'поражения', 'поражений']), r.losses === 1 ? 'loss' : 'losses')}</span>${r.tokens ? `<span class="t"><b>+${r.tokens}</b> TOKENS</span>` : ''}</div><small>${tr('RP за защиту не меняется.', 'Defence never changes RP.')}</small><button class="btn ghost" data-act="tab" data-v="defense">${tr('Подробнее', 'Details')}</button></div>`;
    }
    const ch = me.challenge;
    const cta = ch
      ? `<div class="lg-card lg-challenge">${rankEmblem(ch.to, 'III', 54)}<div><div class="lg-k gold">PRIME CHALLENGE · ${tr('КВАЛИФИКАЦИЯ', 'QUALIFIER')}</div><b>${esc(rankName(ch.to))}</b><p>${tr('3 победы до 2 поражений. Провал не отнимет текущий ранг.', '3 wins before 2 losses. Failing never takes your current rank.')}</p><div class="lg-pips">${[0, 1, 2].map((i) => `<i class="${i < ch.wins ? 'w' : ''}"></i>`).join('')}<em></em>${[0, 1].map((i) => `<i class="${i < ch.losses ? 'l' : ''}"></i>`).join('')}</div></div></div><button class="btn big wide lg-cta gold" data-act="duel" data-mode="challenge" ${me.active ? 'disabled' : ''}><span class="shine"></span>${tr('Квалификационный бой', 'Qualifier fight')}</button>`
      : `<button class="btn big wide lg-cta" data-act="duel" data-mode="duel" ${me.active ? 'disabled' : ''}><span class="shine"></span>PRIME DUEL — ${tr('в эфир', 'go on air')}</button>`;
    const picks = own.map((id) => `<button class="lg-fpick ${id === this.pick ? 'on' : ''}" data-act="pick" data-f="${id}" aria-pressed="${id === this.pick}">${portraitHTML(g.portraitOf(id), FIGHTERS[id].theme.main, FIGHTERS[id].theme.dark)}<span>${esc(FIGHTERS[id].name)}</span></button>`).join('') + lockedPicks(g);
    const own4 = deckOf(g, this.pick);
    const leagueDeck = !!me.decks?.[this.pick];
    const deck = deckRow(own4);
    const deckEditor = this.deckDraft
      ? `<div class="lg-editor"><div class="lg-k">${tr('КОЛОДА ДЛЯ ЛИГИ', 'LEAGUE DECK')} · ${this.deckDraft.length}/4</div><div class="lg-cardgrid">${allowedCards(g, this.pick)
          .map((c) => pickCard(c, this.deckDraft!.includes(c), 'deck-card'))
          .join('')}</div><small class="muted">${tr('Карьерная колода бойца не меняется — это отдельная колода только для PRIME LEAGUE, она хранится в PRIME ID.', 'The fighter\u2019s career deck stays as it is — this deck is for PRIME LEAGUE only and is kept in your PRIME ID.')}</small><div class="lg-editor-act"><button class="btn ghost" data-act="deck-cancel">${tr('Отмена', 'Cancel')}</button><button class="btn teal" data-act="deck-save" ${this.deckDraft.length === 4 && !this.busy ? '' : 'disabled'}>${tr('Сохранить колоду', 'Save the deck')}</button></div></div>`
      : '';
    const sq = me.series.find((x) => x.kind === 'squad' || x.kind === 'rush');
    const squadOk = own.length >= LEAGUE.squad.size;
    return `${this.rankCard(me)}${banner}
      <div class="lg-card lg-duel">
        <div class="lg-k">${tr('ВАШ БОЕЦ', 'YOUR FIGHTER')}</div>
        <div class="lg-fpicks">${picks}</div>
        <div class="lg-deck"><span>${leagueDeck ? tr('Колода лиги', 'League deck') : tr('Колода из карьеры', 'Career deck')}:</span>${deck}${this.deckDraft ? '' : `<button class="lg-mini" data-act="deck-edit">${UI_ICONS.pencil} ${tr('Колода для лиги', 'League deck')}</button>`}</div>${deckEditor}
        <small class="muted">${esc(f.name)} ${tr('сражается сам — вы командуете картами, как в карьере.', 'fights on its own — you command the cards, as in the career.')}</small>
      </div>
      ${cta}
      <div class="lg-modes">
        <div class="lg-mode squad">
          <div class="lg-mode-head"><span class="lg-mode-ico" aria-hidden="true">${SQUAD_ICON}</span><div><div class="lg-k">PRIME SQUAD</div><div class="lg-mode-chips"><span>${LEAGUE.squad.size} ${tr('бойца', 'fighters')}</span><span>${LEAGUE.squad.toWin} ${tr('из', 'of')} ${LEAGUE.squad.size}</span><span>RP</span></div></div></div>
          <p>${tr('Три ваших бойца против трёх защитников одного соперника. Три дуэли подряд, победа — 2 из 3. Один итог RP за весь отряд.', 'Three of your fighters against one opponent’s three defenders. Three duels in a row, 2 of 3 wins. One RP result for the squad.')}</p>
          ${squadOk ? `<div class="lg-fpicks mini">${own.map((id) => `<button class="lg-fpick ${this.squadPick.includes(id) ? 'on' : ''}" data-act="squadpick" data-f="${id}">${portraitHTML(g.portraitOf(id), FIGHTERS[id].theme.main, FIGHTERS[id].theme.dark)}<span>${this.squadPick.includes(id) ? this.squadPick.indexOf(id) + 1 : ''}</span></button>`).join('')}</div>` : `<small class="muted">${tr('Нужно три бойца в ростере.', 'Needs three fighters in the roster.')}</small>`}
          <button class="btn teal wide" data-act="squad" ${squadOk && this.squadPick.length === LEAGUE.squad.size && !me.active && !sq ? '' : 'disabled'}>${tr('Собрать отряд', 'Field the squad')} (${this.squadPick.length}/3)</button>
        </div>
        <div class="lg-mode rush">
          <div class="lg-mode-head"><span class="lg-mode-ico" aria-hidden="true">${MODE_ICONS.energy_rush}</span><div><div class="lg-k">PRIME RUSH</div><div class="lg-mode-chips"><span>${tr('до', 'up to')} ${LEAGUE.rush.length} ${tr('дуэлей', 'duels')}</span><span>${LEAGUE.rush.lives} ${tr('жизни', 'lives')}</span><span>${tr('без RP', 'no RP')}</span></div></div></div>
          <p>${tr(`Серия до ${LEAGUE.rush.length} дуэлей подряд выбранным бойцом, ${LEAGUE.rush.lives} поражения заканчивают забег. Свой рекорд и эфирные очки, RP не меняется.`, `A run of up to ${LEAGUE.rush.length} duels with the chosen fighter; ${LEAGUE.rush.lives} losses end it. Your own record and air points; RP stays.`)}</p>
          <button class="btn ghost wide" data-act="rush" ${!me.active && !sq ? '' : 'disabled'}>${tr('Начать серию', 'Start a run')} · ${esc(f.name)}</button>
        </div>
      </div>
      ${sq ? `<div class="lg-card"><b>${sq.kind === 'squad' ? 'PRIME SQUAD' : 'PRIME RUSH'}</b> — ${tr('серия открыта', 'a series is open')}. <button class="btn teal" data-act="series-next" data-k="${sq.kind}">${tr('Следующая дуэль', 'Next duel')}</button> <button class="btn ghost" data-act="series-abandon" data-k="${sq.kind}">${tr('Завершить', 'End')}</button></div>` : ''}`;
  }

  private boardView(me: LeagueMe): string {
    if (this.boardErr) return `<div class="lg-state err">${esc(this.boardErr)}<button class="btn ghost" data-act="board-retry">${tr('Повторить', 'Retry')}</button></div>`;
    const b = this.board;
    if (!b) return `<div class="lg-state">${tr('Загружаем таблицу сезона…', 'Loading the season table…')}</div>`;
    if (!b.rows.length) return this.empty(UI_ICONS.trophy, tr('Таблица сезона ждёт первого', 'The season table awaits its first'), tr('Ещё никто не сыграл рейтинговый бой в этом сезоне. Одна победа — и первая строка ваша.', 'Nobody has played a ranked fight this season yet. One win — and the first line is yours.'), { tab: 'play', label: tr('В эфир', 'Go on air') });
    const rows = b.rows
      .map((r) => `<li class="lg-row ${r.me ? 'me' : ''}" style="--rk:${r.rank.color}"><span class="lg-place">${r.place}</span>${producerSVG(r.me ? this.g.producer.shown() : r.look ?? { avatar: 'director', frame: 'studio', backdrop: 'violet' }, 40, 'lg-row-ava')}<span class="lg-who"><b class="lg-nick">${esc(r.name)}</b><span class="lg-rk">${rankEmblem(r.rank.index, r.rank.division, 18)}${esc(lang() === 'en' ? r.rank.en : r.rank.ru)} ${r.rank.division ?? ''}</span></span><span class="lg-rp">${r.rp}<small>RP</small></span><span class="lg-gw">${r.wins}/${r.games}</span></li>`)
      .join('');
    return `<div class="lg-k">${tr('СЕЗОН', 'SEASON')} ${b.season.number} · ${tr('реальные игроки', 'real players')} · ${b.total}</div><ol class="lg-board">${rows}</ol>${me.place && !b.rows.some((r) => r.me) ? `<div class="lg-note">${tr('Ваше место', 'Your place')}: ${me.place}</div>` : ''}<small class="muted">${tr('Участники PRIME NETWORK в таблице не участвуют.', 'PRIME NETWORK participants are never in the table.')}</small>`;
  }

  private defense(me: LeagueMe): string {
    const g = this.g;
    const own = myFighters(g);
    const slots: DraftSlot[] = this.draft ?? me.defense.map((d) => ({ slot: d.slot, fighter: d.fighter, deck: d.deck.slice(), tactic: d.tactic, look: d.look, enabled: d.enabled }));
    this.draft = slots;
    const rep = me.report;
    const report = rep.matches
      ? `<div class="lg-card lg-report"><div class="lg-k">${tr('ПОКА ТЕБЯ НЕ БЫЛО В ЭФИРЕ', 'WHILE YOU WERE OFF AIR')}</div>
          <div class="lg-report-row"><span><b>${rep.matches}</b> ${tr(plural(rep.matches, ['матч', 'матча', 'матчей']), rep.matches === 1 ? 'match' : 'matches')}</span><span class="w"><b>${rep.wins}</b> ${tr(plural(rep.wins, ['победа', 'победы', 'побед']), rep.wins === 1 ? 'win' : 'wins')}</span><span class="l"><b>${rep.losses}</b> ${tr(plural(rep.losses, ['поражение', 'поражения', 'поражений']), rep.losses === 1 ? 'loss' : 'losses')}</span>${rep.tokens ? `<span class="t"><b>+${rep.tokens}</b> TOKENS</span>` : ''}</div>
          <div class="lg-report-by">${Object.entries(rep.byFighter).map(([fid, v]) => `<span>${esc(FIGHTERS[fid as FighterId]?.name ?? fid)}: ${v.wins}–${v.losses}</span>`).join('')}${Object.entries(rep.byTactic).map(([t, v]) => `<span>${esc(TACTICS[t as TacticId]?.name ?? t)}: ${v.wins}–${v.losses}</span>`).join('')}</div>
          <small>RP: ${tr('без изменений', 'unchanged')}</small><button class="btn ghost" data-act="report-seen">${tr('Понятно', 'Got it')}</button></div>`
      : '';
    const cards = slots
      .map((s, i) => {
        const f = FIGHTERS[s.fighter];
        const t = TACTICS[s.tactic];
        const stat = me.defense.find((d) => d.slot === s.slot && d.fighter === s.fighter);
        const problem = stat?.problem ? `<div class="lg-slot-warn">${esc(stat.problem === 'fighter_not_owned' ? tr('Боец больше не в вашем ростере — этот защитник не выходит в бой. Замените его.', 'This fighter is no longer in your roster — the defender sits out. Replace it.') : errText(new PrimeApiError('invalid', stat.problem, 400)))}</div>` : '';
        const open = this.editSlot === i;
        const deck = deckRow(s.deck);
        const editor = open ? this.slotEditor(s, i, slots) : '';
        return `<div class="lg-slot ${s.enabled ? '' : 'off'} ${open ? 'open' : ''}">
            <div class="lg-slot-top">${portraitHTML(g.portraitOf(s.fighter), f.theme.main, f.theme.dark)}
              <div class="lg-slot-main"><b>${esc(f.name)}</b><span class="lg-tac">${tacticIcon(s.tactic, 16)} ${esc(t.name)}</span><div class="lg-deck">${deck}</div>${stat ? `<small>${tr('Защиты', 'Defences')}: ${stat.wins}–${stat.losses}${stat.draws ? `–${stat.draws}` : ''}</small>` : ''}</div>
              <div class="lg-slot-act"><button class="switch ${s.enabled ? 'on' : ''}" data-act="slot-toggle" data-i="${i}" role="switch" aria-checked="${s.enabled}" aria-label="${tr('Участвует', 'Active')}"></button><button class="icon-btn" data-act="slot-edit" data-i="${i}" aria-label="${tr('Изменить', 'Edit')}">${UI_ICONS.pencil}</button></div>
            </div>${problem}${editor}</div>`;
      })
      .join('');
    const free = own.filter((id) => !slots.some((s) => s.fighter === id));
    const live = me.defense.filter((d) => d.enabled && !d.problem);
    const nick = this.g.account?.view().kind === 'account' ? (this.g.account.view() as { nickname: string }).nickname : '';
    const preview = live.length
      ? `<div class="lg-card lg-preview"><div class="lg-k">${tr('ТАК ВАС УВИДЯТ СОПЕРНИКИ', 'HOW OPPONENTS SEE YOU')}</div><div class="lg-preview-row">${producerSVG(this.g.producer.shown(), 40)}<b>${esc(nick || 'PRIME')}</b>${rankEmblem(me.rank.index, me.rank.division, 22)}<span>${esc(rankName(me.rank.index))} ${me.rank.division ?? ''} · ${me.rp} RP</span></div><div class="lg-preview-f">${live.map((d) => `<span>${portraitHTML(g.portraitOf(d.fighter), FIGHTERS[d.fighter].theme.main, FIGHTERS[d.fighter].theme.dark)}<b>${esc(FIGHTERS[d.fighter].name)}</b><small>${esc(TACTICS[d.tactic].name)}</small></span>`).join('')}</div><small class="muted">${tr('Для каждого боя сервер выбирает одного из включённых защитников (в SQUAD — троих). Соперник видит бойца, колоду и тактику — так же, как вы видите чужие.', 'For each fight the server picks one of the enabled defenders (three in SQUAD). The opponent sees the fighter, deck and tactic — just as you see theirs.')}</small></div>`
      : '';
    const dirty = JSON.stringify(slots) !== JSON.stringify(me.defense.map((d) => ({ slot: d.slot, fighter: d.fighter, deck: d.deck, tactic: d.tactic, look: d.look, enabled: d.enabled })));
    return `${report}
      <div class="lg-card lg-defhead"><div><b>${tr('Защита в эфире', 'Defence on air')}</b><small>${tr('Выключите — и ваши составы не попадут в новые матчи. Начатые бои доиграются по своим снимкам.', 'Switch off — your line-ups join no new match. Started fights finish by their snapshots.')}</small></div><button class="switch lg-defswitch ${me.defenseOn ? 'on' : ''}" data-act="def-global" role="switch" aria-checked="${me.defenseOn}" aria-label="${tr('Защита в эфире', 'Defence on air')}" ${this.busy ? 'disabled aria-busy="true"' : ''}></button></div>
      <p class="muted lg-defnote">${tr('От 1 до 5 разных бойцов. Каждый со своей колодой и тактикой ИИ-режиссёра. Поражение защиты не отнимает RP; за победы защиты — немного PRIME TOKENS и эфирных очков (с общим дневным пределом: пять слотов не дают пятикратного дохода).', '1 to 5 different fighters, each with its own deck and AI director tactic. A lost defence never costs RP; won defences give a few PRIME TOKENS and air points (with one daily limit: five slots never mean five times the income).')}</p>
      ${cards || this.empty(UI_ICONS.shieldMini, tr('Защита пуста', 'No defence yet'), tr('Выберите бойца ниже — он будет защищать ваш рейтинг, пока вас нет в эфире.', 'Pick a fighter below — they will guard your rating while you are off air.'))}
      ${preview}
      ${slots.length < LEAGUE.defense.slots && free.length ? `<div class="lg-k">${tr('ДОБАВИТЬ БОЙЦА', 'ADD A FIGHTER')}</div><div class="lg-add" role="list">${free.map((id) => `<button class="lg-fpick" data-act="slot-add" data-f="${id}">${portraitHTML(g.portraitOf(id), FIGHTERS[id].theme.main, FIGHTERS[id].theme.dark)}<span>${esc(FIGHTERS[id].name)}</span></button>`).join('')}${lockedPicks(g)}</div>` : ''}
      <button class="btn big wide lg-cta" data-act="def-save" ${dirty && slots.length && !this.busy ? '' : 'disabled'}><span class="shine"></span>${tr('Сохранить защиту', 'Save the defence')}</button>`;
  }

  private slotEditor(s: DraftSlot, i: number, slots: DraftSlot[]): string {
    const allowed = allowedCards(this.g, s.fighter);
    const cards = allowed.map((c) => pickCard(c, s.deck.includes(c), 'slot-card', `data-i="${i}"`)).join('');
    const tactics = TACTIC_ORDER.map((t) => `<button class="lg-tacpick ${s.tactic === t ? 'on' : ''}" data-act="slot-tactic" data-i="${i}" data-t="${t}" aria-pressed="${s.tactic === t}">${tacticIcon(t)}<b>${esc(TACTICS[t].name)}</b><span>${esc(lang() === 'en' ? TACTICS[t].en : TACTICS[t].ru)}</span><small>${esc(lang() === 'en' ? TACTICS[t].descEn : TACTICS[t].descRu)}</small></button>`).join('');
    const skin = skinOf(s.fighter);
    return `<div class="lg-editor">
        <div class="lg-k">${tr('КОЛОДА', 'DECK')} · ${s.deck.length}/4</div><div class="lg-cardgrid">${cards}</div>
        <div class="lg-k">${tr('ТАКТИКА ИИ-РЕЖИССЁРА', 'AI DIRECTOR TACTIC')}</div><div class="lg-tacgrid">${tactics}</div>
        <small class="muted">${tr('Тактика меняет только выбор карт. Движение, меткость, урон и скорость бойца — те же, что у всех.', 'A tactic changes only the choice of cards. Movement, aim, damage and speed stay the same for everyone.')}</small>
        ${skin ? `<label class="lg-agree"><input type="checkbox" data-act="slot-look" data-i="${i}" ${s.look ? 'checked' : ''}/> <span>${tr('Облик', 'Look')}: ${esc(SKINS[skin as keyof typeof SKINS].name)} <small>(${tr('только внешний вид', 'looks only')})</small></span></label>` : ''}
        <div class="lg-editor-act"><button class="btn ghost" data-act="slot-remove" data-i="${i}" ${slots.length <= 1 ? 'disabled' : ''}>${tr('Убрать из защиты', 'Remove')}</button><button class="btn teal" data-act="slot-edit" data-i="-1">${tr('Готово', 'Done')}</button></div>
      </div>`;
  }

  /** 1.9.1: an honest empty state — a sign, one line of meaning and, when there is one, the way forward. */
  private empty(icon: string, title: string, text: string, cta?: { tab: Tab; label: string }): string {
    return `<div class="lg-empty"><span class="lg-empty-ico" aria-hidden="true">${icon}</span><b>${title}</b><p>${text}</p>${cta ? `<button class="btn teal" data-tab="${cta.tab}">${cta.label}</button>` : ''}</div>`;
  }

  /** 1.9.1: the season's road as a real showcase — a step per reward with its sign; the server's thresholds as they are. */
  private rewards(me: LeagueMe): string {
    const tiers = me.track.tiers;
    const next = tiers.find((t) => t.at > me.air) ?? null;
    const prevAt = [...tiers].reverse().find((t) => t.at <= me.air)?.at ?? 0;
    const toNext = next ? next.at - me.air : 0;
    const pct = next ? Math.round(((me.air - prevAt) / Math.max(1, next.at - prevAt)) * 100) : 100;
    const steps = tiers
      .map((t) => {
        const got = me.track.claimed.includes(t.tier);
        const reached = me.air >= t.at;
        const can = reached && !got;
        const kind = t.tokens ? 'tokens' : t.title ? 'title' : 'emblem';
        const icon = kind === 'tokens' ? tokenCoin(30) : kind === 'title' ? ICONS.crown : rankEmblem(6, null, 30);
        const what = kind === 'tokens' ? `<b>${t.tokens}</b> PRIME TOKENS` : kind === 'title' ? `${tr('Титул', 'Title')} <b>«${esc(t.title!)}»</b>` : `<b>${tr('Эмблема сезона', 'Season emblem')}</b>`;
        const act = got
          ? `<span class="lg-step-got">${UI_ICONS.check}<span>${tr('Получено', 'Claimed')}</span></span>`
          : can
            ? `<button class="btn teal lg-step-claim" data-act="claim" data-t="${t.tier}">${tr('Забрать', 'Claim')}</button>`
            : `<span class="lg-step-lock">${UI_ICONS.lock}<span>${tr('ещё', 'in')} ${t.at - me.air}</span></span>`;
        return `<li class="lg-step ${kind} ${got ? 'got' : can ? 'can' : 'lock'} ${reached ? 'reached' : ''} ${next && next.tier === t.tier ? 'next' : ''}"><span class="lg-step-node" aria-hidden="true">${icon}</span><span class="lg-step-body"><span class="lg-step-at">${t.at} ${tr('очков', 'pts')}</span><span class="lg-step-what">${what}</span></span>${act}</li>`;
      })
      .join('');
    return `<div class="lg-card lg-road-head">
        <div class="lg-k">${tr('ПУТЬ ЭФИРА · СЕЗОН', 'ROAD OF THE BROADCAST · SEASON')} ${me.season.number}</div>
        <div class="lg-air"><b>${me.air}</b> ${tr('эфирных очков', 'air points')}</div>
        <div class="lg-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
        <small class="muted">${next ? `${tr('До следующей ступени', 'To the next step')}: <b>${toNext}</b>. ` : `${tr('Все ступени сезона пройдены.', 'Every step of the season is reached.')} `}${tr('Очки — за каждый бой лиги (победа 10, поражение 4) и победы защиты; это не валюта.', 'Points come from every league fight (win 10, loss 4) and won defences; not a currency.')}</small>
      </div>
      <ol class="lg-road">${steps}</ol>
      <div class="lg-card lg-wallet"><span class="lg-wallet-coin" aria-hidden="true">${tokenCoin(44)}</span><div><div class="lg-k">PRIME TOKENS</div><div class="lg-air"><b>${me.tokens}</b></div>
        <small class="muted">${me.flags.tokens ? tr(`Жетоны пока копятся — тратить их нельзя, обмен и применение появятся в следующих версиях. За победы — до ${LEAGUE.tokens.attackPerDay} в день, +${LEAGUE.tokens.challengeWin} за пройденный PRIME CHALLENGE сверх предела. Не продаются за рубли.`, `Tokens accumulate for now — they cannot be spent yet; exchange and use come in later versions. Wins give up to ${LEAGUE.tokens.attackPerDay} a day, +${LEAGUE.tokens.challengeWin} for a passed PRIME CHALLENGE on top. Never sold for money.`) : tr('Начисление PRIME TOKENS включится позже.', 'PRIME TOKENS start later.')}</small></div></div>`;
  }

  /** 1.9.1: the history as a feed of real fights — result, opponent with their look, fighters, what it gave. */
  private historyView(): string {
    if (this.historyErr) return `<div class="lg-state err">${esc(this.historyErr)}<button class="btn ghost" data-act="history-retry">${tr('Повторить', 'Retry')}</button></div>`;
    const h = this.history;
    if (!h) return `<div class="lg-state">${tr('Загружаем историю…', 'Loading the history…')}</div>`;
    const res = (o?: string) => (o === 'win' ? tr('ПОБЕДА', 'WIN') : o === 'loss' ? tr('ПОРАЖЕНИЕ', 'LOSS') : o === 'draw' ? tr('НИЧЬЯ', 'DRAW') : tr('АННУЛИРОВАН', 'VOID'));
    const how = (m?: string) => (m === 'ko' ? 'KO' : m === 'time' ? tr('по времени', 'on time') : m === 'forfeit' ? tr('сдача', 'forfeit') : '');
    const mini = (id: FighterId | null) => (id && FIGHTERS[id] ? `<span class="lg-mini-face">${portraitHTML(this.g.portraitOf(id), FIGHTERS[id].theme.main, FIGHTERS[id].theme.dark)}</span>` : '');
    const att = h.attacks
      .map((m) => {
        const o = m.status === 'void' ? 'void' : (m.outcome ?? 'void');
        const sys = m.opponent.kind === 'system';
        const ava = sys ? systemProducerSVG(34) : producerSVG(m.opponent.look ?? { avatar: 'director', frame: 'studio', backdrop: 'violet' }, 34);
        const gain = m.mode === 'squad' || m.mode === 'rush' ? `<b>${m.mode === 'squad' ? 'SQUAD' : 'RUSH'}</b><small>${tr('в серии', 'in a series')}</small>` : m.ranked && m.status === 'done' ? `<b>${(m.rp ?? 0) >= 0 ? '+' : ''}${m.rp} RP</b>${m.tokens ? `<small>+${m.tokens} T</small>` : ''}` : `<b>${tr('без RP', 'no RP')}</b>`;
        return `<li class="lg-fight ${o}"><span class="lg-fres">${res(o === 'void' ? undefined : o)}<small>${how(m.method)}</small></span><span class="lg-fava">${ava}</span><span class="lg-fwho"><b>${esc(lang() === 'en' && m.opponent.nameEn ? m.opponent.nameEn : m.opponent.name)}</b><small>${mini(m.attacker.fighter)}${esc(FIGHTERS[m.attacker.fighter]?.name ?? '')} <i>vs</i> ${esc(FIGHTERS[m.defender.fighter as FighterId]?.name ?? '')}${sys ? ` · PRIME NETWORK` : ''}</small></span><span class="lg-fgain">${gain}</span></li>`;
      })
      .join('');
    const def = h.defenses
      .map((d) => `<li class="lg-fight ${d.outcome}"><span class="lg-fres">${res(d.outcome)}<small>${tr('защита', 'defence')}</small></span><span class="lg-fava lg-fava-f">${mini(d.fighter as FighterId)}</span><span class="lg-fwho"><b>${esc(FIGHTERS[d.fighter as FighterId]?.name ?? '')}</b><small>${[d.tactic ? esc(TACTICS[d.tactic].name) : '', d.attackerFighter ? `${tr('атаковал', 'attacked by')} ${esc(FIGHTERS[d.attackerFighter]?.name ?? '')}` : ''].filter(Boolean).join(' · ')}</small></span><span class="lg-fgain">${d.tokens ? `<b>+${d.tokens} T</b>` : '<b>—</b>'}<small>${tr('RP не меняется', 'no RP change')}</small></span></li>`)
      .join('');
    const seasons = h.seasons
      .map((x) => {
        const ri = Math.max(0, RANKS.findIndex((r) => r.id === x.rank));
        return `<li class="lg-season-row">${rankEmblem(ri, null, 34)}<span><b>${x.season ? `${tr('Сезон', 'Season')} ${x.season}` : tr('Предсезонье', 'Pre-season')}</b><small>${esc(rankName(ri))} · ${tr('пик', 'peak')} ${x.peak} RP</small></span><span class="lg-fgain"><b>${x.rp} RP</b><small>${x.wins}/${x.games} ${tr('побед', 'wins')}</small></span></li>`;
      })
      .join('');
    return `<div class="lg-k">${tr('МОИ АТАКИ', 'MY ATTACKS')}</div>${att ? `<ul class="lg-feed">${att}</ul>` : this.empty(UI_ICONS.bolt, tr('Вы ещё не провели бой', 'No fight yet'), tr('Первая дуэль появится здесь сразу после проверки сервером.', 'Your first duel appears here once the server has checked it.'), { tab: 'play', label: tr('В эфир', 'Go on air') })}
      <div class="lg-k">${tr('МОЯ ЗАЩИТА', 'MY DEFENCE')}</div>${def ? `<ul class="lg-feed">${def}</ul>` : this.empty(UI_ICONS.shieldMini, tr('На вашу защиту пока не нападали', 'Nobody has attacked your defence yet'), tr('Выставьте защитников — они сражаются за вас, пока вас нет в эфире.', 'Set your defenders — they fight for you while you are off air.'), { tab: 'defense', label: tr('Моя защита', 'My defence') })}
      ${seasons ? `<div class="lg-k">${tr('ПРОШЛЫЕ СЕЗОНЫ', 'PAST SEASONS')}</div><ul class="lg-feed">${seasons}</ul>` : ''}`;
  }

  // --------------------------------------------------------------- actions
  private async run(fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.err = '';
    this.render();
    try {
      await fn();
    } catch (e) {
      this.err = errText(e);
      if (e instanceof PrimeApiError && e.code === 'match_active') await this.g.league.refresh().catch(() => null);
    }
    this.busy = false;
    if (this.g.ui.current === 'league') this.render();
  }

  private onClick(e: Event): void {
    const t = e.target as HTMLElement;
    const b = t.closest('[data-act],[data-tab]') as HTMLElement | null;
    if (!b) return;
    const g = this.g;
    if (b.dataset.tab) {
      g.audio.ui('click');
      this.tab = b.dataset.tab as Tab;
      this.notice = '';
      this.render();
      if (this.tab === 'board') void this.loadBoard();
      if (this.tab === 'history') void this.loadHistory();
      return;
    }
    const act = b.dataset.act;
    const api = g.league.api();
    const me = g.league.me;
    switch (act) {
      case 'back':
        g.audio.ui('click');
        g.goto('menu');
        return;
      case 'to-league':
        // (already here)
        return;
      case 'to-career':
        g.audio.ui('click');
        rememberEntry('career');
        g.goto('modes');
        return;
      case 'profile':
        g.goto('profile');
        return;
      case 'reload':
        location.reload();
        return;
      case 'retry':
        void this.load();
        return;
      case 'agree':
        this.agree = (t as HTMLInputElement).checked;
        this.render();
        return;
      case 'join':
        if (!this.agree || !api) return;
        void this.run(async () => {
          g.league.setMe(await api.join(LEAGUE_RULES_VERSION));
          g.audio.ui('confirm');
          this.tab = 'defense';
          this.notice = tr('Добро пожаловать в эфир! Выставьте первого защитника — пока вас нет, он будет защищать ваше шоу.', 'Welcome on air! Field your first defender — it defends your show while you are away.');
          if (!g.league.me!.defense.length) this.draft = [{ slot: 1, fighter: g.save.data.selected, deck: deckOf(g, g.save.data.selected), tactic: 'balance', look: null, enabled: true }];
        });
        return;
      case 'pick':
        this.pick = b.dataset.f as FighterId;
        this.deckDraft = null;
        g.audio.ui('click');
        this.render();
        return;
      case 'deck-edit':
        this.deckDraft = deckOf(g, this.pick);
        this.render();
        return;
      case 'deck-cancel':
        this.deckDraft = null;
        this.render();
        return;
      case 'deck-card': {
        const c = b.dataset.c as CardId;
        if (!this.deckDraft) return;
        if (this.deckDraft.includes(c)) this.deckDraft = this.deckDraft.filter((x) => x !== c);
        else if (this.deckDraft.length < 4) this.deckDraft = [...this.deckDraft, c];
        this.render();
        return;
      }
      case 'deck-save':
        if (!api || !this.deckDraft || this.deckDraft.length !== 4) return;
        void this.run(async () => {
          await api.saveDeck(this.pick, this.deckDraft!);
          this.deckDraft = null;
          await g.league.refresh();
          this.notice = tr('Колода для лиги сохранена.', 'League deck saved.');
          g.audio.ui('confirm');
        });
        return;
      case 'squadpick': {
        const f = b.dataset.f as FighterId;
        const i = this.squadPick.indexOf(f);
        if (i >= 0) this.squadPick.splice(i, 1);
        else if (this.squadPick.length < LEAGUE.squad.size) this.squadPick.push(f);
        this.render();
        return;
      }
      case 'duel':
        if (!api) return;
        void this.run(async () => {
          const mode = b.dataset.mode === 'challenge' ? 'challenge' : 'duel';
          const r = await api.start(mode, this.pick, deckOf(g, this.pick), newOp());
          showPoster(g, r.match);
        });
        return;
      case 'resume':
        if (me?.active) g.league.begin(me.active);
        return;
      case 'squad':
        if (!api) return;
        void this.run(async () => {
          const r = await api.seriesStart('squad', this.squadPick.map((f) => ({ fighter: f, deck: deckOf(g, f) })), newOp());
          this.squadPick = [];
          showPoster(g, r.match, r.series);
        });
        return;
      case 'rush':
        if (!api) return;
        void this.run(async () => {
          const r = await api.seriesStart('rush', [{ fighter: this.pick, deck: deckOf(g, this.pick) }], newOp());
          showPoster(g, r.match, r.series);
        });
        return;
      case 'series-next':
        if (!api) return;
        void this.run(async () => {
          const r = await api.seriesNext(b.dataset.k as 'rush' | 'squad');
          showPoster(g, r.match, r.series);
        });
        return;
      case 'series-abandon':
        if (!api) return;
        g.confirm(tr('Завершить серию?', 'End the series?'), tr('Сыгранные дуэли засчитаются; в PRIME SQUAD несыгранные дуэли засчитаются как поражения.', 'Played duels count; in PRIME SQUAD the unplayed duels count as losses.'), tr('Завершить', 'End'), () => {
          void this.run(async () => {
            await api.seriesAbandon(b.dataset.k as 'rush' | 'squad');
            await g.league.refresh();
          });
        });
        return;
      case 'report-seen':
        if (!api) return;
        void this.run(async () => {
          await api.seen('report');
          await g.league.refresh();
        });
        return;
      case 'def-global':
        if (!api || !me) return;
        void this.run(async () => {
          await api.toggleDefense(!me.defenseOn);
          await g.league.refresh();
        });
        return;
      case 'slot-add': {
        const f = b.dataset.f as FighterId;
        const used = new Set((this.draft ?? []).map((s) => s.slot));
        const slot = [1, 2, 3, 4, 5].find((n) => !used.has(n)) ?? 1;
        this.draft = [...(this.draft ?? []), { slot, fighter: f, deck: deckOf(g, f), tactic: 'balance', look: null, enabled: true }];
        this.editSlot = this.draft.length - 1;
        this.render();
        return;
      }
      case 'slot-edit':
        this.editSlot = Number(b.dataset.i);
        this.render();
        return;
      case 'slot-remove': {
        const i = Number(b.dataset.i);
        this.draft = (this.draft ?? []).filter((_, k) => k !== i);
        this.editSlot = -1;
        this.render();
        return;
      }
      case 'slot-toggle': {
        const s = this.draft?.[Number(b.dataset.i)];
        if (s) s.enabled = !s.enabled;
        this.render();
        return;
      }
      case 'slot-card': {
        const s = this.draft?.[Number(b.dataset.i)];
        const c = b.dataset.c as CardId;
        if (!s) return;
        if (s.deck.includes(c)) s.deck = s.deck.filter((x) => x !== c);
        else if (s.deck.length < 4) s.deck = [...s.deck, c];
        this.render();
        return;
      }
      case 'slot-tactic': {
        const s = this.draft?.[Number(b.dataset.i)];
        if (s) s.tactic = b.dataset.t as TacticId;
        this.render();
        return;
      }
      case 'slot-look': {
        const s = this.draft?.[Number(b.dataset.i)];
        if (s) s.look = (t as HTMLInputElement).checked ? skinOf(s.fighter) : null;
        this.render();
        return;
      }
      case 'def-save': {
        if (!api || !this.draft) return;
        const bad = this.draft.find((s) => s.deck.length !== 4);
        if (bad) {
          this.err = tr(`В колоде ${FIGHTERS[bad.fighter].name} должно быть 4 карты.`, `${FIGHTERS[bad.fighter].name}’s deck needs 4 cards.`);
          this.render();
          return;
        }
        const slots = this.draft.map((s) => ({ ...s, look: s.look ?? '' }));
        void this.run(async () => {
          await api.saveDefense(slots);
          this.draft = null;
          this.editSlot = -1;
          await g.league.refresh();
          this.notice = tr('Защита сохранена. Новые матчи пойдут уже с ней.', 'Defence saved. New matches use it.');
          g.audio.ui('confirm');
        });
        return;
      }
      case 'claim':
        if (!api) return;
        void this.run(async () => {
          const r = await api.claim(Number(b.dataset.t));
          await g.league.refresh();
          this.notice = r.tokens ? `+${r.tokens} PRIME TOKENS` : tr('Награда получена', 'Reward claimed');
          g.audio.ui('confirm');
        });
        return;
      case 'board-retry':
        void this.loadBoard();
        return;
      case 'history-retry':
        void this.loadHistory();
        return;
    }
  }
}

/** The bill before a fight: the two fighters, the opponent's public card and an honest note on how it plays. */
function showPoster(g: Game, m: LeagueMatch, series?: LeagueSeries): void {
  const a = FIGHTERS[m.attacker.fighter];
  const d = FIGHTERS[m.defender.fighter];
  const t = m.defender.tactic ? TACTICS[m.defender.tactic] : null;
  const o = m.opponent;
  const who = o.kind === 'system' ? tr('Участник PRIME NETWORK', 'PRIME NETWORK participant') : o.rank ? `${lang() === 'en' ? o.rank.en : o.rank.ru} ${o.rank.division ?? ''} · ${o.rp} RP` : '';
  const av = g.account?.view();
  const myNick = av && av.kind === 'account' ? av.nickname : tr('Вы', 'You');
  const me = g.league.me;
  const myLine = me ? `${esc(rankName(me.rank.index))} ${me.rank.division ?? ''} · ${me.rp} RP` : '';
  const kind = m.mode === 'challenge' ? `PRIME CHALLENGE · ${tr('КВАЛИФИКАЦИЯ', 'QUALIFIER')}` : m.mode === 'squad' ? `PRIME SQUAD · ${tr('дуэль', 'duel')} ${m.round + 1}/3` : m.mode === 'rush' ? `PRIME RUSH · ${tr('дуэль', 'duel')} ${m.round + 1}` : 'PRIME DUEL';
  g.ui.modal(
    `<div class="lg-poster">
       <div class="lg-poster-k">${onAir()} ${kind}${m.ranked ? '' : ` · ${tr('без RP', 'no RP')}`}</div>
       <div class="lg-vs pv">
         <div class="lg-prod me">${producerSVG(g.producer.shown(), 92)}<b>${esc(myNick)}</b><small>${myLine}</small></div>
         <div class="lg-vs-mark">VS</div>
         <div class="lg-prod foe">${o.kind === 'system' ? systemProducerSVG(92) : producerSVG(o.look ?? { avatar: 'director', frame: 'studio', backdrop: 'violet' }, 92)}<b>${esc(o.name)}</b><small>${esc(who)}</small></div>
       </div>
       <div class="lg-fighters"><span class="me">${portraitHTML(g.portraitFor(g.fighterLook(m.attacker.fighter)), a.theme.main, a.theme.dark)}<b>${esc(a.name)}</b></span><i>${tr('бойцы эфира', 'on-air fighters')}</i><span class="foe"><b>${esc(d.name)}</b>${portraitHTML(g.portraitFor(m.defender.look ?? d.look) ?? g.portraitOf(d.id), d.theme.main, d.theme.dark)}</span></div>
       ${t ? `<div class="lg-poster-tac">${tacticIcon(t.id)} <span><b>${esc(t.name)}</b> · ${esc(lang() === 'en' ? t.en : t.ru)}</span></div>` : ''}
       <p class="lg-poster-note">${o.kind === 'system' ? tr('Состав студии PRIME NETWORK: им управляет ИИ-режиссёр.', 'A PRIME NETWORK studio line-up, run by the AI director.') : tr('Соперник может быть офлайн: его сохранёнными картами управляет ИИ-режиссёр по выбранной тактике.', 'The opponent may be offline: the AI director plays its saved cards by the chosen tactic.')}</p>
       ${series ? `<div class="lg-poster-ser">${series.kind === 'squad' ? `${tr('Счёт отряда', 'Squad score')} ${series.wins}–${series.losses}` : `${tr('Серия', 'Run')}: ${series.wins} ${tr(plural(series.wins, ['победа', 'победы', 'побед']), series.wins === 1 ? 'win' : 'wins')}, ${series.losses}/${LEAGUE.rush.lives}`}</div>` : ''}
       <button class="btn big wide lg-cta" data-a="go"><span class="shine"></span>${tr('В эфир!', 'On air!')}</button>
       <small class="muted">${tr('Эфир уже начался: соперник выбран сервером.', 'The broadcast has begun: the server chose the opponent.')}</small>
     </div>`,
    (root, close) => {
      root.querySelector('[data-a="go"]')?.addEventListener('click', () => {
        close();
        g.audio.ui('confirm');
        g.league.begin(m);
      });
    },
    false,
  );
}

/** A promotion: a short broadcast moment, shown once (the server forgets it when it was seen). */
function showCeremony(g: Game, rank: number, challenge: boolean): void {
  if (g.ui.modalOpen) return;
  const r = RANKS[rank];
  g.audio.victory();
  g.ui.modal(
    `<div class="lg-ceremony" style="--rk:${r.color}">
       <div class="lg-cer-rays"></div>
       ${rankEmblem(rank, 'III', 132, 'lg-cer-emb')}
       <div class="lg-cer-k">${onAir()} ${challenge ? tr('КВАЛИФИКАЦИЯ ПРОЙДЕНА', 'QUALIFIER PASSED') : tr('НОВЫЙ РАНГ', 'NEW RANK')}</div>
       <div class="lg-cer-t">${esc(rankName(rank))}</div>
       <button class="btn big wide lg-cta ${rank >= 6 ? 'gold' : ''}" data-a="ok"><span class="shine"></span>${tr('В эфир!', 'On air!')}</button>
       <small class="muted">${tr('Нажмите в любом месте, чтобы продолжить', 'Tap anywhere to continue')}</small>
     </div>`,
    (root, close) => {
      // one tap anywhere ends it (the button included) — short, never in the way
      root.addEventListener('click', () => {
        close();
        if (g.league.me) g.league.me.ceremony = null;
        void g.league.api()?.seen('ceremony').catch(() => null);
      });
    },
    false,
  );
}

/** After a league fight: the fight we saw, then the result the SERVER computed from the taps. */
export class LeagueResultScreen implements Screen {
  readonly el: HTMLElement;
  private view: LeagueMatch | null = null;
  private local: MatchResultData | null = null;
  private res: LeagueFinish | null = null;
  private err = '';
  private wait = 0;
  private cer = false;
  private stung = false;

  constructor(private readonly g: Game) {
    this.el = el('div', 'league-result');
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b) return;
      const act = b.dataset.act;
      const api = g.league.api();
      if (act === 'lobby') g.goto('league');
      else if (act === 'retry') void this.confirm();
      else if (act === 'again' && api && this.view) {
        const v = this.view;
        b.setAttribute('disabled', '');
        api
          .start(g.league.me?.challenge ? 'challenge' : 'duel', v.attacker.fighter, v.attacker.deck, newOp())
          .then((r) => showPoster(g, r.match))
          .catch((e) => {
            this.err = errText(e);
            this.render();
          });
      } else if (act === 'next' && api && this.view) {
        const kind = this.view.mode as 'rush' | 'squad';
        b.setAttribute('disabled', '');
        api
          .seriesNext(kind)
          .then((r) => showPoster(g, r.match, r.series))
          .catch(() => g.goto('league'));
      }
    });
  }

  onShow(p?: { view: LeagueMatch; local: MatchResultData }): void {
    this.view = p?.view ?? null;
    this.local = p?.local ?? null;
    this.res = null;
    this.err = '';
    this.wait = 0;
    this.cer = false;
    this.stung = false;
    this.render();
    void this.confirm();
  }

  private async confirm(): Promise<void> {
    this.err = '';
    this.render();
    try {
      this.res = await this.g.league.finish((ms) => {
        this.wait = ms;
        this.render();
      });
      if (this.local && this.res.match.result && this.res.match.outcome !== this.local.outcome) console.warn('PRIME LEAGUE: the server’s replay differs from the fight on screen — the server’s result counts');
    } catch (e) {
      this.err = errText(e);
    }
    this.render();
  }

  /** The producer who won this broadcast (only after the SERVER confirmed it) and the fighter that fought for them. */
  private winnerBlock(v: LeagueMatch, outcome: string): string {
    if (outcome === 'draw') return '';
    const meWon = outcome === 'win';
    const av = this.g.account?.view();
    const myNick = av && av.kind === 'account' ? av.nickname : tr('Вы', 'You');
    const f = FIGHTERS[meWon ? v.attacker.fighter : v.defender.fighter];
    const ava = meWon ? producerSVG(this.g.producer.shown(), 72) : v.opponent.kind === 'system' ? systemProducerSVG(72) : producerSVG(v.opponent.look ?? { avatar: 'director', frame: 'studio', backdrop: 'violet' }, 72);
    return `<div class="lg-winner ${meWon ? 'me' : 'foe'}">${ava}<div><span class="lg-k">${tr('ПОБЕДИТЕЛЬ ЭФИРА', 'BROADCAST WINNER')}</span><b>${esc(meWon ? myNick : v.opponent.name)}</b><small>${tr('боец', 'fighter')}: ${esc(f.name)}</small></div></div>`;
  }

  /** RUSH / SQUAD: where the series stands after this duel — and, once it ended, its one settlement. */
  private seriesBlock(): string {
    const ser = this.res?.series;
    if (!ser) return '';
    const name = ser.kind === 'squad' ? 'PRIME SQUAD' : 'PRIME RUSH';
    const pips = ser.results.map((r) => `<i class="${r.outcome === 'win' ? 'w' : r.outcome === 'loss' ? 'l' : 'd'}"></i>`).join('');
    if (ser.status !== 'done' || !ser.done) {
      const left = ser.kind === 'squad' ? tr(`Счёт ${ser.wins}–${ser.losses}: для победы отряда нужно 2 из 3.`, `Score ${ser.wins}–${ser.losses}: the squad needs 2 of 3.`) : tr(`Побед: ${ser.wins}, поражений ${ser.losses} из ${LEAGUE.rush.lives}. Серия — до ${LEAGUE.rush.length} дуэлей.`, `Wins: ${ser.wins}, losses ${ser.losses} of ${LEAGUE.rush.lives}. Up to ${LEAGUE.rush.length} duels.`);
      return `<div class="lg-series"><div class="lg-k">${name}</div><div class="lg-pips">${pips}</div><small>${left}</small></div>`;
    }
    const d = ser.done;
    const title = ser.kind === 'squad' ? (d.won ? tr('ОТРЯД ПОБЕДИЛ', 'SQUAD WINS') : tr('ОТРЯД ПРОИГРАЛ', 'SQUAD LOSES')) : tr(`СЕРИЯ ЗАВЕРШЕНА · ${ser.wins} ${plural(ser.wins, ['ПОБЕДА', 'ПОБЕДЫ', 'ПОБЕД'])}`, `RUN OVER · ${ser.wins} ${ser.wins === 1 ? 'WIN' : 'WINS'}`);
    return `<div class="lg-series done ${d.won ? 'won' : ''}"><div class="lg-k">${name} · ${title}</div><div class="lg-pips">${pips}</div>
      <div class="lg-res-gain">${ser.kind === 'squad' ? `<span>${d.rp >= 0 ? '+' : ''}${d.rp} RP ${tr('за отряд', 'for the squad')}</span>` : `<span>${tr('без RP', 'no RP')}</span>`}${d.air ? `<span>+${d.air} ${tr('эфирных очков', 'air points')}</span>` : ''}${d.tokens ? `<span>+${d.tokens} TOKENS</span>` : ''}</div>
      <small class="muted">${tr('Итог серии начислен один раз.', 'The series was settled once.')}</small></div>`;
  }

  private render(): void {
    const v = this.view;
    if (!v) {
      this.el.innerHTML = '';
      return;
    }
    const m = this.res?.match;
    // nothing is announced as a win or a loss before the SERVER confirmed it
    const confirmed = !!m && m.status === 'done';
    const outcome = confirmed ? m!.outcome! : 'pending';
    const head = !confirmed ? (m?.status === 'void' ? tr('МАТЧ АННУЛИРОВАН', 'MATCH VOID') : tr('ЭФИР ЗАВЕРШЁН', 'BROADCAST OVER')) : outcome === 'win' ? tr('ПОБЕДА', 'VICTORY') : outcome === 'loss' ? tr('ПОРАЖЕНИЕ', 'DEFEAT') : tr('НИЧЬЯ', 'DRAW');
    const method = !confirmed ? tr('результат подтверждает сервер', 'the server confirms the result') : m!.method === 'ko' ? 'KO' : m!.method === 'forfeit' ? tr('сдача', 'forfeit') : tr('по времени', 'on time');
    if (confirmed && !this.stung) {
      this.stung = true;
      if (outcome === 'win') this.g.audio.victory();
      else if (outcome === 'loss') this.g.audio.defeat();
      else this.g.audio.reaction(2);
    }
    let body: string;
    if (this.err) body = `<div class="lg-state err">${esc(this.err)}<p class="muted">${tr('Нажатия сохранены. Если связь не вернётся, сервер подведёт итог сам по истечении срока матча.', 'Your taps are kept. If the connection does not return, the server settles the fight itself at its deadline.')}</p><button class="btn teal" data-act="retry">${tr('Повторить', 'Retry')}</button></div>`;
    else if (!m) body = `<div class="lg-state lg-verify">${onAir('REC')} ${tr('Сервер проверяет запись эфира…', 'The server checks the broadcast record…')}${this.wait ? `<small>${tr('Эфир ещё идёт в реальном времени', 'The broadcast still runs in real time')} (${Math.ceil(this.wait / 1000)} ${tr('с', 's')})</small>` : ''}</div>`;
    else if (m.status === 'void') body = `<div class="lg-card"><b>${tr('Матч аннулирован', 'Match void')}</b><p>${tr('Пока шёл бой, сервер обновил правила боя. Матч не засчитан: RP и награды не изменились.', 'The server updated the fight rules during the fight. The match does not count: RP and rewards unchanged.')}</p></div>`;
    else {
      const rp = m.rp ?? 0;
      const me = this.res?.profile;
      const atFloor = m.outcome === 'loss' && rp === 0 && m.ranked && (v.mode === 'duel' || v.mode === 'challenge');
      const serDone = this.res?.series?.status === 'done';
      // the PRIME CHALLENGE milestone (paid by the server outside the daily match cap) — shown apart from the match's own tokens
      const bonus = m.result?.challengeTokens ?? 0;
      const why = v.mode === 'rush' ? tr('PRIME RUSH не меняет RP: свой рекорд, эфирные очки и жетоны за серию.', 'PRIME RUSH never moves RP: your record, air points and tokens for the run.') : v.mode === 'squad' ? (serDone ? tr('Отряд завершён — его итог ниже.', 'The squad is over — its result below.') : tr('RP отряда начисляется один раз, когда отряд закончится.', 'Squad RP is settled once, when the squad ends.')) : atFloor ? tr('Ниже пола вашего ранга RP не опускается.', 'RP never drops below your rank\u2019s floor.') : !m.ranked ? tr('Тренировочный бой — без RP.', 'A training fight — no RP.') : v.mode === 'challenge' ? tr('В квалификации RP не меняется — считаются победы и поражения.', 'A qualifier moves no RP — wins and losses count.') : v.opponent.kind === 'system' ? tr('Соперник PRIME NETWORK: RP вдвое меньше.', 'A PRIME NETWORK opponent: half the RP.') : rp >= 0 ? tr('Чем сильнее соперник, тем больше RP за победу.', 'The stronger the opponent, the more RP a win brings.') : tr('Проигрыш сильному сопернику стоит меньше RP.', 'Losing to a stronger opponent costs less RP.');
      body = `<div class="lg-res-rp ${rp > 0 ? 'up' : rp < 0 ? 'down' : ''}"><b>${rp > 0 ? '+' : ''}${rp}</b> RP</div>
        <div class="lg-res-why">${why}</div>
        ${this.winnerBlock(v, m.outcome!)}
        ${me ? `<div class="lg-res-rank">${rankEmblem(me.rank.index, me.rank.division, 48)}<span>${esc(rankName(me.rank.index))} ${me.rank.division ?? ''} · <b>${me.rp}</b> RP</span></div>` : ''}
        <div class="lg-res-gain">${m.air ? `<span>+${m.air} ${tr('эфирных очков', 'air points')}</span>` : ''}${(m.tokens ?? 0) - bonus > 0 ? `<span>+${(m.tokens ?? 0) - bonus} TOKENS</span>` : ''}${bonus ? `<span class="lg-bonus">+${bonus} TOKENS ${tr('за PRIME CHALLENGE', 'for PRIME CHALLENGE')}</span>` : ''}</div>
        ${this.seriesBlock()}
        <small class="muted">${tr('Результат подтверждён сервером по записи ваших нажатий.', 'Confirmed by the server from the record of your taps.')}${m.how === 'expired' ? ' ' + tr('Бой доигран сервером по последней сохранённой записи.', 'The server finished the fight from the last saved record.') : ''}</small>`;
    }
    const ser = this.res?.series;
    const seriesOpen = (v.mode === 'squad' || v.mode === 'rush') && (ser ? ser.status === 'active' : this.g.league.me?.series.some((s) => s.kind === v.mode));
    const acts = m
      ? `${seriesOpen ? `<button class="btn big wide lg-cta" data-act="next"><span class="shine"></span>${tr('Следующая дуэль', 'Next duel')}</button>` : v.mode === 'duel' || v.mode === 'challenge' ? `<button class="btn big wide lg-cta" data-act="again"><span class="shine"></span>${tr('Ещё дуэль', 'Another duel')}</button>` : ''}<button class="btn ghost wide" data-act="lobby">${tr('В лобби лиги', 'League lobby')}</button>`
      : '';
    this.el.innerHTML = `<div class="lg-result panel ${outcome}" aria-live="polite">
        <div class="lg-res-k">${onAir()} PRIME LEAGUE · VS ${esc(v.opponent.name)}</div>
        <div class="lg-res-h">${head}</div><div class="lg-res-m">${method}</div>
        ${body}
        <div class="lg-res-acts">${acts}</div>
      </div>`;
    const ch = this.res?.match.result?.ceremony?.find((c) => c.kind === 'rank');
    if (ch && !this.cer) {
      this.cer = true;
      setTimeout(() => showCeremony(this.g, ch.rank, !!ch.challenge), 900);
    }
  }
}

export type { LeagueSlot };
