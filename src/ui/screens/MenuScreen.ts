import { FIGHTERS, RIVALS, BEHAVIORS } from '../../config/fighters';
import { formatMoney, formatNumber } from '../../core/math';
import type { Game } from '../../game/Game';
import { fameTier } from '../../meta/CareerSystem';
import { CARDS, PASSIVES } from '../../config/cards';
import { ThemeManager } from '../../game/ThemeManager';
import { countUp, el, esc, portraitHTML } from '../dom';
import { ICONS } from '../eventArt';
import { currencyIcon, formatSpan } from './EventsScreen';
import { UI_ICONS } from '../icons';
import { CHALLENGES, SURVIVAL } from '../../config/modes.config';
import type { Screen } from '../UI';
import { openFightEntry } from './LeagueScreen';
import { CLOUD_SYNCED_MS, cloudPillPlan, type CloudKind, type CloudState } from '../cloudPill';
import { openDaily } from '../dailyUI';

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
      else if (act === 'roster') this.g.goto('roster');
      else if (act === 'career') this.g.goto('career');
      else if (act === 'settings') this.g.openSettings();
      else if (act === 'events') this.g.goto('events');
      else if (act === 'collection') this.g.goto('collection');
      else if (act === 'profile') this.g.goto('profile');
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
    });
    // 1.8.9: the gift lights up when today's reward waits, and goes quiet once it is taken
    g.daily.onChange(() => this.paintDaily());
  }

  /**
   * 1.8.9: the DAILY PRIME STREAK gift under the sound button — only where the server has the streak; a soft gold
   * dot while today's reward waits (a short pulse, then still); the one-time note for a first-time PRIME ID.
   */
  private paintDaily(): void {
    const btn = this.el.querySelector('[data-act="daily"].daily-btn') as HTMLButtonElement | null;
    if (!btn) return;
    const d = this.g.daily;
    btn.hidden = !d.supported;
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
    const f = FIGHTERS[s.selected];
    const fp = s.fighters[s.selected];
    const rival = RIVALS[s.nextRival];
    const unclaimed = g.career.unclaimed();
    const em = g.events;
    const ev = em.active;
    // the nameplate title as the selected fighter wears it (personal titles only on their owners)
    const title = ThemeManager.titleName(g.collection.effectiveEquipped(s.selected));
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
        <span class="se-ico">${UI_ICONS.shop}</span>
        <span class="se-text"><b>PRIME <em>SHOP</em></b><small>Скины · эффекты · примерка</small></span>
        <span class="se-go">${UI_ICONS.next}</span>
      </button>`;
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
      <button class="daily-btn" data-act="daily" aria-label="DAILY PRIME STREAK — ежедневный эфир" hidden>${UI_ICONS.gift}<i class="daily-dot" aria-hidden="true"></i></button>
      <div class="topbar" style="padding-right:62px">
        <button class="lvl-btn" data-act="profile" aria-label="PRIME ID: профиль продюсера, уровень ${lvl.level}"><span class="lvl-badge">${lvl.level}</span><span class="lvl-id">ID</span></button>${hint}
        <div class="stat-pill"><span class="ico money">${UI_ICONS.money}</span><span data-money>${formatMoney(this.shownMoney < 0 ? s.money : this.shownMoney)}</span></div>
        <div class="stat-pill"><span class="ico rep">${UI_ICONS.rep}</span><span data-rep>${Math.floor(this.shownRep < 0 ? s.reputation : this.shownRep)}</span></div>
      </div>
      <div class="menu-head">
        <div class="logo"><span class="live">LIVE</span><span class="l1">PRIME TIME</span><span class="l2">SHOWDOWN</span>${ev ? `<span class="season-tag">${esc(ev.title)}</span>` : ''}</div>
        <div class="label menu-org" data-act="profile" role="button" tabindex="0" aria-label="Открыть PRIME ID" style="margin-top:2px">${esc(s.orgName)} · ${esc(lvl.title)}</div>
        <button class="cloud-pill" data-cloud data-act="profile" aria-live="polite" aria-hidden="true" tabindex="-1" hidden><i></i><span></span></button>
      </div>
      <div class="fill pass"></div>
      <div class="fighter-plate panel" data-act="roster" style="cursor:pointer">
        ${portraitHTML(g.portraitOf(f.id), f.theme.main, f.theme.dark)}
        <div class="meta">
          <div class="name">${esc(f.name)}</div>
          ${title ? `<div class="plate-title">${ICONS.crown}<span>${esc(title)}</span></div>` : ''}
          <div class="nick" style="color:${f.theme.accent}">«${esc(f.nickname)}» · ${esc(f.style)}</div>
          <div class="row" style="margin-top:6px;gap:6px;flex-wrap:wrap">
            <span class="chip gold">${UI_ICONS.fans.replace('<svg', '<svg width="11" height="11" style="color:#ff4fd8"')} ${formatNumber(fp.fans)} фанатов</span>
            <span class="chip plate-tier">${esc(fameTier(fp.fans))}</span>
          </div>
          <div class="plate-abilities"><span>◆ ${esc(PASSIVES[f.passive].name)}</span><span style="color:${CARDS[f.signature].color}">★ ${esc(CARDS[f.signature].name)}</span></div>
        </div>
      </div>
      <div class="next-bout">
        <span>След. эфир</span>
        <b>VS ${esc(rival.name)} «${esc(rival.nickname)}»</b>
        <span class="chip red">${esc(BEHAVIORS[rival.behavior].label)}</span>
      </div>
      <div class="spacer-8"></div>
      ${entry ? `<div class="menu-event">${entry}</div>` : ''}
      <div class="menu-actions">
        <div class="menu-play">
          ${fightEntry}
          ${shopEntry}
        </div>
        <div class="menu-nav">
          <button class="btn ghost" data-act="roster">${UI_ICONS.users.replace('<svg', '<svg width="18" height="18"')} Бойцы</button>
          <button class="btn ghost" data-act="career" style="position:relative">${UI_ICONS.career.replace('<svg', '<svg width="18" height="18"')} Карьера${unclaimed ? `<span class="badge-dot">${unclaimed}</span>` : ''}</button>
          <button class="btn ghost" data-act="collection" style="position:relative" aria-label="Моя коллекция">${UI_ICONS.archive.replace('<svg', '<svg width="18" height="18"')} Коллекция${freshItems ? `<span class="badge-dot">${freshItems}</span>` : ''}</button>
          <button class="icon-btn" data-act="settings" aria-label="Настройки" style="width:50px;height:46px">${UI_ICONS.gear}</button>
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
    void g.daily.refresh();
    this.shownRep = s.reputation;
  }
}
