import { casesOn, casesStatus, onCases, refreshCases } from '../caseUI';
import { formatMoney } from '../../core/math';
import type { Game } from '../../game/Game';
import { countUp, el, esc } from '../dom';
import { ICONS } from '../eventArt';
import { currencyIcon, formatSpan } from './EventsScreen';
import { UI_ICONS } from '../icons';
import { CHALLENGES, SURVIVAL } from '../../config/modes.config';
import type { Screen } from '../UI';
import { openFightEntry } from './LeagueScreen';
import { levelBadge } from '../careerArt';
import { currencyArt } from '../currencyArt';
import { CLOUD_SYNCED_MS, cloudPillPlan, type CloudKind, type CloudState } from '../cloudPill';
import { openDaily } from '../dailyUI';
import { openReferral } from '../referralUI';
import { winterGiftArt } from '../rewardArt';
import { navSkinStyle, uiIcon } from '../menuArt';
import { cardCatalog, catalogStats } from '../cardCatalog';
import { inRoster } from '../../meta/roster';

/**
 * Alpha 1.8.8: the «ТВОЙ PRIME ID» hint next to the profile button — for a player not signed in to
 * PRIME ID, until they open the profile or close the hint, and on at most 3 launches. Only this small
 * local note is stored (no save field, no account data).
 */
const HINT_KEY = 'primetime-showdown-hint-primeid-v1';
const HINT_LAUNCHES = 3;
let hintCounted = false;

function hintLeft(): boolean {
  try {
    const v = localStorage.getItem(HINT_KEY) ?? '0';
    return v !== 'done' && (Number(v) || 0) < HINT_LAUNCHES + (hintCounted ? 1 : 0);
  } catch {
    return false;
  }
}

function countHint(): void {
  if (hintCounted) return;
  hintCounted = true;
  try {
    const v = localStorage.getItem(HINT_KEY) ?? '0';
    if (v !== 'done') localStorage.setItem(HINT_KEY, String((Number(v) || 0) + 1));
  } catch {
    /* storage unavailable: the hint simply shows this time */
  }
}

function retireHint(): void {
  try {
    localStorage.setItem(HINT_KEY, 'done');
  } catch {
    /* this page only */
  }
}

/**
 * Alpha 1.8.9: the one-time «ТВОЙ ЕЖЕДНЕВНЫЙ ЭФИР НАЧАЛСЯ!» note by the gift — for a PRIME ID that has never taken a
 * daily reward, until the window is opened or the note closed. Only this small local mark is stored.
 */
const DAILY_HINT_KEY = 'primetime-showdown-hint-daily-v1';

function dailyHintLeft(): boolean {
  try {
    return localStorage.getItem(DAILY_HINT_KEY) !== 'done';
  } catch {
    return false;
  }
}

function retireDailyHint(): void {
  try {
    localStorage.setItem(DAILY_HINT_KEY, 'done');
  } catch {
    /* this page only */
  }
}

export class MenuScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private shownMoney = -1;
  private shownRep = -1;

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'menu');
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'hint-close') {
        // 1.8.8: «×» on the PRIME ID hint — it does not come back
        retireHint();
        this.el.querySelector('.pid-hint')?.remove();
        return;
      }
      if (act === 'daily-hint-close') {
        // 1.8.9: the daily note does not come back either
        retireDailyHint();
        this.el.querySelector('.daily-hint')?.remove();
        return;
      }
      this.g.audio.ui(act === 'modes' ? 'confirm' : 'click');
      if (act === 'profile') retireHint();
      // 1.8.8: one way into the fights — «В БОЙ!» opens the modes (CLASSIC DUEL first)
      // 1.9.0: «В БОЙ!» → the career's modes or PRIME LEAGUE (the last choice; the first time — the choice)
      if (act === 'modes') openFightEntry(this.g);
      else if (act === 'shop') this.g.goto('shop');
      else if (act === 'live') this.g.goto('live');
      else if (act === 'roster') this.g.goto('roster');
      else if (act === 'career') this.g.goto('career');
      else if (act === 'settings') this.g.openSettings();
      else if (act === 'events') this.g.goto('events');
      else if (act === 'collection') this.g.goto('collection');
      else if (act === 'cards') this.g.goto('cards', { back: 'menu' });
      else if (act === 'profile') this.g.goto('profile');
      else if (act === 'referral') openReferral(this.g);
      else if (act === 'daily') {
        // 1.8.9: DAILY PRIME STREAK — the window over the menu (never on its own, never during a fight)
        retireDailyHint();
        this.el.querySelector('.daily-hint')?.remove();
        openDaily(this.g);
      }
    });
    // Alpha 1.8.3: the PRIME CLOUD line follows the account live (only an account career shows it)
    g.account?.onChange(() => {
      this.paintCloud();
      this.paintDaily();
      this.paintReferral();
      this.paintLive();
    });
    // 1.8.9: the gift lights up when today's reward waits, and goes quiet once it is taken
    g.daily.onChange(() => this.paintDaily());
    // Beta 2.4: the cases waiting — a number on the invite and the gift
    onCases(() => this.paintCases());
  }

  /**
   * Beta 2.7.1: LIVE DUELS follow the account too. The server's config (the button) and the sign-in (the way back into a
   * room or a running fight after a reload) can arrive after the menu was drawn — a player who tapped the title early
   * on a slow connection had no button and was not taken back into the fight until the menu was opened again.
   */
  private paintLive(): void {
    const g = this.g;
    if (g.currentScreen !== 'menu') return;
    const liveOn = !!g.account?.serverConfig?.live;
    const shown = this.el.querySelector('.live-entry');
    if (liveOn && !shown) this.el.querySelector('.menu-play .menu-shops')?.insertAdjacentHTML('beforebegin', liveEntryHTML());
    else if (!liveOn && shown) shown.remove();
    if (liveOn && g.save.data.tutorial !== 'pending') queueMicrotask(() => g.live.autoOpen());
  }

  /** Beta 2.4: how many PRIME INVITE / DAILY BROADCAST cases wait — a badge on «Пригласить друга» and the gift. */
  private paintCases(): void {
    const cs = casesOn(this.g) ? casesStatus() : null;
    const put = (sel: string, n: number) => {
      const btn = this.el.querySelector(sel) as HTMLElement | null;
      if (!btn) return;
      let b = btn.querySelector('.case-badge') as HTMLElement | null;
      if (n > 0) {
        if (!b) {
          b = document.createElement('span');
          b.className = 'badge-dot case-badge';
          b.setAttribute('aria-hidden', 'true');
          btn.appendChild(b);
        }
        b.textContent = n > 9 ? '9+' : String(n);
      } else b?.remove();
    };
    put('[data-act="referral"].ref-btn', cs?.invite.ready ?? 0);
    // (Beta 2.6: and the DAILY MISSION MINI CASES waiting — they open in the daily window's missions)
    put('[data-act="daily"].daily-btn', (cs?.daily.ready ?? 0) + (cs?.mission.ready ?? 0));
  }

  /**
   * 1.8.9: the DAILY PRIME STREAK gift under the sound button — only where the server has the streak; a soft gold
   * dot while today's reward waits (a short pulse, then still); the one-time note for a first-time PRIME ID.
   */
  /** Beta 2.2: «Пригласить друга» shows only when the PRIME NETWORK server has invitations on (config referrals). */
  private paintReferral(): void {
    const btn = this.el.querySelector('[data-act="referral"].ref-btn') as HTMLButtonElement | null;
    if (btn) btn.hidden = this.g.account?.serverConfig?.referrals !== true;
  }

  private paintDaily(): void {
    const btn = this.el.querySelector('[data-act="daily"].daily-btn') as HTMLButtonElement | null;
    if (!btn) return;
    const d = this.g.daily;
    // Beta 2.4: the gift is a PRIME ID's — a guest does not see it (the invitation stays for everybody)
    const gate = d.gate();
    btn.hidden = !d.supported || gate === 'guest' || gate === 'off';
    const ready = d.giftReady;
    btn.classList.toggle('ready', ready);
    btn.setAttribute('aria-label', `DAILY PRIME STREAK — ежедневный эфир${ready ? ': подарок ждёт' : d.status?.claimedToday ? ': сегодня получено' : ''}`);
    const s = d.status;
    const wantHint = ready && !!s && s.claims === 0 && this.g.save.data.tutorial !== 'pending' && this.g.ui.current === 'menu' && dailyHintLeft();
    const hint = this.el.querySelector('.daily-hint');
    if (wantHint && !hint) {
      btn.insertAdjacentHTML(
        'afterend',
        `<div class="daily-hint" data-act="daily" role="note">
          <span class="dh-arrow" aria-hidden="true"></span>
          <b>Твой ежедневный эфир начался!</b>
          <span>Загляни за первым подарком</span>
          <button class="ph-x" data-act="daily-hint-close" aria-label="Закрыть подсказку">×</button>
        </div>`,
      );
    } else if (!wantHint && hint) hint.remove();
  }

  // 1.8.3.1: the PRIME CLOUD line no longer hangs there — it shows loading / saving and anything the
  // player must act on, and «СИНХРОНИЗИРОВАНО» only for a moment after a save went through
  private cloudKind: CloudKind | null = null;
  private cloudOn = false;
  private cloudHideAt = 0;
  private cloudFlashPending = false;
  private cloudTimer: ReturnType<typeof setTimeout> | null = null;

  /** The PRIME CLOUD line under the studio name (`shown`: the menu was just drawn). */
  private paintCloud(shown = false): void {
    const pill = this.el.querySelector('[data-cloud]') as HTMLElement | null;
    if (!pill) return;
    const c = this.g.account?.cloudStatus() ?? null;
    // the guest career has no line at all (and leaves no gap)
    pill.hidden = !c;
    if (!c) {
      this.cloudOn = false;
      return;
    }
    const visible = shown || this.g.ui.current === 'menu';
    const plan = c.kind === this.cloudKind ? null : cloudPillPlan(this.cloudKind, c.kind);
    this.cloudKind = c.kind;
    if (plan === 'show') this.setCloud(pill, c, true);
    else if (plan === 'hide') this.setCloud(pill, c, false);
    else if (plan === 'flash') {
      // a save went through while the menu was not on screen: the player sees it on coming back
      if (visible) this.flashCloud(pill, c);
      else {
        this.cloudFlashPending = true;
        this.setCloud(pill, c, false);
      }
    } else if (plan === null) {
      // same state (the menu drawn again, or another update): keep what the player sees
      if (c.kind === 'synced') {
        if (this.cloudFlashPending && visible) this.flashCloud(pill, c);
        else this.setCloud(pill, c, Date.now() < this.cloudHideAt);
      } else if (c.kind === 'waiting') this.setCloud(pill, null, this.cloudOn);
      else this.setCloud(pill, c, true);
    }
    // 'keep': a change waits to go up — nothing new to say (a running «синхронизировано» finishes)
    else this.setCloud(pill, null, this.cloudOn);
  }

  private flashCloud(pill: HTMLElement, c: CloudState): void {
    this.cloudFlashPending = false;
    this.cloudHideAt = Date.now() + CLOUD_SYNCED_MS;
    this.setCloud(pill, c, true);
    if (this.cloudTimer) clearTimeout(this.cloudTimer);
    this.cloudTimer = setTimeout(() => {
      this.cloudTimer = null;
      const el = this.el.querySelector('[data-cloud]') as HTMLElement | null;
      if (el && this.cloudKind === 'synced') this.setCloud(el, null, false);
    }, CLOUD_SYNCED_MS);
  }

  private setCloud(pill: HTMLElement, c: CloudState | null, on: boolean): void {
    if (c) {
      pill.dataset.tone = c.tone;
      (pill.querySelector('span') as HTMLElement).textContent = c.text;
    }
    this.cloudOn = on;
    pill.classList.toggle('on', on);
    pill.setAttribute('aria-hidden', on ? 'false' : 'true');
    pill.tabIndex = on ? 0 : -1;
  }

  onShow(): void {
    const g = this.g;
    const s = g.save.data;
    const lvl = g.career.level();
    const unclaimed = g.career.unclaimed();
    const em = g.events;
    const ev = em.active;
    // seasonal entry: the main way into the Events screen
    let entry = '';
    if (ev && em.playable) {
      const pend = em.pending();
      const left = em.timeLeft();
      entry = `<button class="event-entry live" data-act="events">
          <span class="ee-ico">${currencyIcon(ev)}</span>
          <span class="ee-text"><b>${esc(ev.title)}</b><small>${Number.isFinite(left) ? `ещё ${formatSpan(left)}` : 'тестовый режим'} · <span class="ee-tok">${em.tokens(ev)}<i>${currencyIcon(ev)}</i></span></small></span>
          ${pend ? `<span class="ee-badge">${pend}</span>` : ''}<span class="ee-go">${UI_ICONS.next}</span>
        </button>`;
    } else if (ev) {
      entry = `<button class="event-entry" data-act="events"><span class="ee-ico">${currencyIcon(ev)}</span><span class="ee-text"><b>${esc(ev.title)}</b><small>${esc(ev.subtitle)}</small></span><span class="ee-go">${UI_ICONS.next}</span></button>`;
    } else if (em.upcoming) {
      entry = `<button class="event-entry soon" data-act="events"><span class="ee-ico">${ICONS.calendar}</span><span class="ee-text"><b>Скоро: ${esc(em.upcoming.title)}</b><small>Премьера через ${formatSpan(em.timeToStart(em.upcoming))}</small></span><span class="ee-go">${UI_ICONS.next}</span></button>`;
    }
    const freshItems = g.collection.freshCount();
    // game modes entry (Alpha 1.3): Survival record and cleared challenges at a glance
    const sv = s.modes.survival;
    const chDone = CHALLENGES.filter((c) => (s.modes.challenges[c.id]?.firstClearAt ?? 0) > 0).length;
    const bossP = s.modes.boss.vale;
    const fresh = sv.runs === 0 && CHALLENGES.every((c) => !s.modes.challenges[c.id]?.attempts);
    const bossNew = !bossP?.attempts;
    // Alpha 1.8.8: «В БОЙ!» and the modes are one entry; the line under it keeps the modes at a glance
    const modesLine = fresh ? 'Classic · Survival · Challenge · Boss' : `Волны ${sv.bestWave}/${SURVIVAL.waves.length} · испытания ${chDone}/${CHALLENGES.length} · босс ${bossP?.wins ? '✓' : '—'}`;
    const fightEntry = `<button class="btn big wide fight-cta" data-act="modes" aria-label="В бой! Выбрать режим: ${esc(modesLine)}">
        <span class="shine"></span>
        <span class="fc-main">В бой!</span>
        <span class="fc-sub">Выбрать режим</span>
        ${fresh || bossNew ? `<span class="me-new fc-badge">${fresh ? 'NEW' : 'BOSS'}</span>` : ''}
      </button>`;
    // 1.8.8 stage 2: the real PRIME SHOP — purple and gold, a step below the orange «В БОЙ!»
    const shopEntry = `<button class="shop-entry" data-act="shop" aria-label="PRIME SHOP — магазин: скины, эффекты и бесплатная примерка">
        <span class="se-glint" aria-hidden="true"></span>
        <span class="se-ico pic">${uiIcon('shop', 46)}</span>
        <span class="se-text"><b>PRIME <em>SHOP</em></b><small>Скины · эффекты<span class="se-more"> · примерка</span></small></span>
        <span class="se-go">${UI_ICONS.next}</span>
      </button>`;
    // Alpha 1.9.8: CARDS beside PRIME SHOP — the cards for career dollars (browse, buy); a dot when one can be bought now
    const cardStats = catalogStats(cardCatalog(g.career, s, (f) => inRoster(s, f)));
    const cardsEntry = `<button class="cards-entry" data-act="cards" aria-label="Карты: все карты, их эффекты и покупка за гонорары${cardStats.buyable ? ` — можно купить: ${cardStats.buyable}` : ''}">
        <span class="ce-ico pic">${uiIcon('cards', 46)}</span>
        <span class="ce-text"><b>КАРТЫ</b><small>${cardStats.have}/${cardStats.total}</small></span>
        ${cardStats.buyable ? `<span class="badge-dot">${cardStats.buyable}</span>` : ''}
      </button>`;
    // Beta 2.7 LIVE DUELS: online duels with friends — shown while this server runs them (a guest is shown the way in)
    const liveOn = !!g.account?.serverConfig?.live;
    const liveEntry = liveOn ? liveEntryHTML() : '';
    // 1.8.8: the PRIME ID hint (not signed in, not during the first-run choice, not retired)
    const signedIn = !!g.account?.api?.sessionRecord;
    const showHint = !signedIn && s.tutorial !== 'pending' && hintLeft();
    if (showHint) countHint();
    const hint = showHint
      ? `<div class="pid-hint" data-act="profile" role="note">
          <span class="ph-arrow" aria-hidden="true"></span>
          <b>Твой PRIME ID</b>
          <span>${g.account ? 'Профиль продюсера и вход в аккаунт' : 'Профиль продюсера и статистика'}</span>
          <button class="ph-x" data-act="hint-close" aria-label="Закрыть подсказку">×</button>
        </div>`
      : '';
    this.el.innerHTML = `
      <button class="daily-btn" data-act="daily" aria-label="DAILY PRIME STREAK — ежедневный эфир" hidden>${winterGiftArt(g, 46) ?? uiIcon('gift', 46)}<i class="daily-dot" aria-hidden="true"></i></button>
      <button class="ref-btn" data-act="referral" aria-label="Пригласить друга" title="Пригласить друга" hidden>${uiIcon('invite', 46)}</button>
      <div class="topbar" style="padding-right:62px">
        <button class="lvl-btn" data-act="profile" aria-label="PRIME ID: профиль продюсера, уровень ${lvl.level}"><span class="lvl-badge-box">${levelBadge(lvl.level, 44, 'lvl-badge')}</span><span class="lvl-id">ID</span></button>${hint}
        <div class="stat-pill"><span class="ico pic">${currencyArt('money', 30)}</span><span data-money>${formatMoney(this.shownMoney < 0 ? s.money : this.shownMoney)}</span></div>
        <div class="stat-pill"><span class="ico pic">${currencyArt('rep', 30)}</span><span data-rep>${Math.floor(this.shownRep < 0 ? s.reputation : this.shownRep)}</span></div>
      </div>
      <div class="menu-head">
        <div class="logo"><span class="live">LIVE</span><span class="l1">PRIME TIME</span><span class="l2">SHOWDOWN</span>${ev ? `<span class="season-tag">${esc(ev.title)}</span>` : ''}</div>
        <button class="cloud-pill" data-cloud data-act="profile" aria-live="polite" aria-hidden="true" tabindex="-1" hidden><i></i><span></span></button>
      </div>
      <div class="fill pass"></div>
      <div class="spacer-8"></div>
      ${entry ? `<div class="menu-event">${entry}</div>` : ''}
      <div class="menu-actions">
        <div class="menu-play">
          ${fightEntry}
          ${liveEntry}
          <div class="menu-shops">${shopEntry}${cardsEntry}</div>
        </div>
        <div class="menu-nav skinned">
          <button class="btn nav-skin" data-act="roster" style="${navSkinStyle('fighters')}"><span class="nav-label">Бойцы</span></button>
          <button class="btn nav-skin" data-act="career" style="${navSkinStyle('career')}"><span class="nav-label">Карьера</span>${unclaimed ? `<span class="badge-dot">${unclaimed}</span>` : ''}</button>
          <button class="btn nav-skin" data-act="collection" style="${navSkinStyle('collection')}" aria-label="Моя коллекция"><span class="nav-label">Коллекция</span>${freshItems ? `<span class="badge-dot">${freshItems}</span>` : ''}</button>
          <button class="btn nav-settings" data-act="settings" aria-label="Настройки">${uiIcon('settings', 46, 'nav-gear')}<span class="nav-label">Настройки</span></button>
        </div>
      </div>`;
    // currencies roll up to their new values after a match
    const moneyEl = this.el.querySelector('[data-money]') as HTMLElement;
    const repEl = this.el.querySelector('[data-rep]') as HTMLElement;
    if (this.shownMoney >= 0 && this.shownMoney !== s.money) {
      countUp(moneyEl, this.shownMoney, s.money, 0.9, (n) => formatMoney(n), () => g.audio.ui('coin'));
      moneyEl.parentElement!.classList.add('bump');
    }
    if (this.shownRep >= 0 && this.shownRep !== s.reputation) countUp(repEl, this.shownRep, s.reputation, 0.9, (n) => String(Math.floor(n)));
    this.shownMoney = s.money;
    this.paintCloud(true);
    this.paintDaily();
    this.paintReferral();
    // Beta 2.4: the cases (read again on every visit to the menu — an invitation may have been confirmed meanwhile)
    this.paintCases();
    void refreshCases(this.g);
    void g.daily.refresh();
    this.shownRep = s.reputation;
    // Beta 2.7 LIVE DUELS: an invitation link (?duel=CODE) or a room left by a reload brings the player straight back
    // (after this screen finished showing — switching screens from inside onShow would leave both on screen)
    if (liveOn && s.tutorial !== 'pending') queueMicrotask(() => g.live.autoOpen());
  }
}

/** The LIVE DUELS button of the menu (Beta 2.7; 2.7.1: also put in later, when the server's config comes after the menu). */
function liveEntryHTML(): string {
  return `<button class="live-entry" data-act="live" aria-label="LIVE DUELS — онлайн-дуэли с друзьями">
        <span class="le-emb pic" aria-hidden="true">${uiIcon('live_duels', 56)}</span>
        <span class="le-text"><b>LIVE <em>DUELS</em></b><small>Онлайн-дуэли с друзьями</small></span>
        <span class="le-live" aria-hidden="true"><i></i>LIVE</span>
      </button>`;
}
