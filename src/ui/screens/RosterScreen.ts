import { CARDS, PASSIVES } from '../../config/cards';
import { FIGHTERS, FIGHTER_ORDER } from '../../config/fighters';
import { LOOKS } from '../../config/looks';
import type { SkinId } from '../../config/shop.config';
import { entitlementsVersion } from '../../meta/entitlements';
import type { WardrobeEntry } from '../../meta/Shop';
import { inRoster } from '../../meta/roster';
import type { FighterId } from '../../config/types';
import { formatNumber } from '../../core/math';
import type { Game } from '../../game/Game';
import { fameTier } from '../../meta/CareerSystem';
import { cardHTML, el, esc, portraitHTML, setScreenHTML } from '../dom';
import { currencyIcon } from './EventsScreen';
import { PASSIVE_ICONS, UI_ICONS } from '../icons';
import type { Screen } from '../UI';

const BAR_LABELS: [keyof (typeof FIGHTERS)['ray']['bars'], string][] = [
  ['health', 'Здоровье'],
  ['damage', 'Урон'],
  ['speed', 'Скорость'],
  ['range', 'Дальность'],
  ['control', 'Контроль'],
];

export class RosterScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private idx = 0;
  private dragId: number | null = null;
  private backTo: 'menu' | 'prep' | 'career' | 'events' = 'menu';
  private lastX = 0;
  /** The quick wardrobe (hanger) is open for the fighter on screen. */
  private wardrobe = false;
  /** The PRIME SHOP rights this screen was drawn with (entitlements.ts): a change redraws it. */
  private rights = -1;

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'roster');
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('pointerdown', (e) => {
      const z = (e.target as HTMLElement).closest('.drag-zone');
      if (!z || (e.target as HTMLElement).closest('.nav-arrow, .wr-hanger')) return;
      this.dragId = e.pointerId;
      this.lastX = e.clientX;
      this.g.showcase.setDragging(true);
    });
    window.addEventListener('pointermove', (e) => {
      if (this.dragId !== e.pointerId) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      this.g.showcase.drag(dx);
    });
    const end = (e: PointerEvent) => {
      if (this.dragId !== e.pointerId) return;
      this.dragId = null;
      this.g.showcase.setDragging(false);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    // the wardrobe closes with Esc (focus is inside it while it is open)
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.wardrobe) return;
      e.stopPropagation();
      this.closeWardrobe();
    });
    // rights arrive or change while the roster is open (sign-in, a purchase elsewhere, the end of a demonstration):
    // the fighter is shown again in what he may wear — a skin no longer owned falls back to the standard look
    g.account?.onChange(() => {
      if (g.ui.current === 'roster' && this.rights !== entitlementsVersion()) this.render();
    });
  }

  /** Alpha 1.7: who the roster shows — a seasonal star only once owned or while its event runs. */
  private get order(): FighterId[] {
    return FIGHTER_ORDER.filter((id) => this.g.events.fighterVisible(id));
  }

  get viewing(): FighterId {
    const o = this.order;
    return o[Math.min(this.idx, o.length - 1)];
  }

  /** params: a fighter id (opened from a contract in Career), { back: 'prep' }, or { back: 'events', fighter } (the season's star). */
  onShow(params?: unknown): void {
    const p = params as { back?: 'prep' | 'events'; fighter?: FighterId } | undefined;
    this.backTo = typeof params === 'string' ? 'career' : p?.back === 'prep' ? 'prep' : p?.back === 'events' ? 'events' : 'menu';
    const id = (typeof params === 'string' ? params : (p?.fighter ?? this.g.save.data.selected)) as FighterId;
    this.idx = Math.max(0, this.order.indexOf(id));
    this.wardrobe = false;
    this.render(false);
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    const act = t.dataset.act!;
    const g = this.g;
    if (act === 'back') {
      g.audio.ui('click');
      if (this.backTo === 'events') g.goto('events', { tab: 'rewards' });
      else g.goto(this.backTo);
    } else if (act === 'season') {
      // Alpha 1.7: a seasonal star is opened in the event's exchange
      g.audio.ui('click');
      g.goto('events', { tab: 'rewards' });
    } else if (act === 'tab') {
      g.audio.ui('swipe');
      this.idx = Number(t.dataset.i);
      this.render();
    } else if (act === 'prev' || act === 'next') {
      g.audio.ui('swipe');
      const n = this.order.length;
      this.idx = (Math.min(this.idx, n - 1) + (act === 'next' ? 1 : n - 1)) % n;
      this.render();
    } else if (act === 'wardrobe') {
      // 1.8.8+: the quick wardrobe — the looks of the fighter on screen, applied at once (Shop.setSkin)
      g.audio.ui('click');
      if (this.wardrobe) return this.closeWardrobe();
      this.wardrobe = true;
      // the rights as the server has them now (another device may have bought, a demonstration may have ended)
      g.account?.refreshRights(true);
      this.render();
      (this.el.querySelector('.wr-look.on') as HTMLElement | null)?.focus({ preventScroll: true });
    } else if (act === 'wardrobe-close') {
      g.audio.ui('click');
      this.closeWardrobe();
    } else if (act === 'look') {
      const id = this.viewing;
      const skin = (t.dataset.skin || null) as SkinId | null;
      const entry = g.shop.wardrobe(id).find((w) => w.skin === skin);
      if (!entry || entry.worn) return;
      // only an available look is worn: the standard one, or a skin this PRIME ID owns (setSkin checks it again)
      if (!entry.available || !g.shop.setSkin(id, skin)) {
        g.audio.ui('deny');
        g.ui.toast(`${entry.name}: облик открывается покупкой в PRIME SHOP — примерить его можно бесплатно`);
        return;
      }
      g.audio.ui(skin ? 'confirm' : 'click');
      this.render();
      (this.el.querySelector('.wr-look.on') as HTMLElement | null)?.focus({ preventScroll: true });
    } else if (act === 'select') {
      if (g.career.select(this.viewing)) {
        g.audio.ui('confirm');
        g.ui.toast(`${FIGHTERS[this.viewing].name} выходит в эфир следующим!`);
        g.showcase.cheer();
        this.render();
      }
    } else if (act === 'sign') {
      const id = this.viewing;
      const c = g.career.canSign(id);
      if (!c.ok) {
        g.audio.ui('deny');
        g.ui.toast(c.reason);
        return;
      }
      const fresh = g.career.sign(id);
      g.audio.ui('level');
      g.ui.toast(`Контракт подписан! ${FIGHTERS[id].fullName} в вашей команде.`, true);
      if (fresh.length) setTimeout(() => g.ui.toast('Цель карьеры выполнена — заберите награду!', true), 900);
      g.showcase.cheer();
      this.render();
    }
  }

  private closeWardrobe(): void {
    this.wardrobe = false;
    this.render();
    (this.el.querySelector('[data-act="wardrobe"]') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  /** The hanger's panel: the fighter's looks, the one worn lit up; a look not owned is shown locked, never worn. */
  private wardrobeHTML(name: string, looks: WardrobeEntry[]): string {
    const g = this.g;
    const f = FIGHTERS[this.viewing];
    const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
    const env = g.shop.payEnv();
    const cards = looks.map((w) => {
      const lk = LOOKS[w.look];
      const art = w.skin ? portraitHTML(g.portraitFor(w.look), hex(lk.top.accent), hex(lk.top.main)) : portraitHTML(g.portraitFor(w.look), f.theme.main, f.theme.dark);
      // a test-mode right is never shown as a purchase: DEMO (the official site's demonstration) / ТЕСТ / DEV
      const tag = w.source === 'test' ? (env === 'demo' ? 'DEMO' : 'ТЕСТ') : w.source === 'dev' ? 'DEV' : '';
      const state = w.worn ? `${UI_ICONS.check.replace('<svg', '<svg width="11" height="11"')} Надет` : w.available ? 'Выбрать' : `${UI_ICONS.lock.replace('<svg', '<svg width="11" height="11"')} PRIME SHOP`;
      return `<button type="button" class="wr-look ${w.worn ? 'on' : ''} ${w.available ? '' : 'locked'}" data-act="look" data-skin="${w.skin ?? ''}" aria-pressed="${w.worn}"${w.available ? '' : ' aria-disabled="true"'}>
          <span class="wr-art">${art}${tag ? `<i class="wr-tag">${tag}</i>` : ''}</span>
          <span class="wr-name">${esc(w.name)}</span>
          <span class="wr-state">${state}</span>
        </button>`;
    });
    return `<section class="wardrobe panel" id="roster-wardrobe" role="dialog" aria-label="${esc(name)} — выбор облика">
        <div class="wr-head">
          <span class="wr-ico">${UI_ICONS.hanger}</span>
          <div class="wr-title"><b>${esc(name)}</b><span>Выбор облика</span></div>
          <button type="button" class="wr-x" data-act="wardrobe-close" aria-label="Закрыть выбор облика">×</button>
        </div>
        <div class="wr-list scroll">${cards.join('')}</div>
        <div class="wr-note">Только внешний вид: характеристики, оружие и карты не меняются. Облик сохраняется и виден в меню, подготовке и бою.</div>
      </section>`;
  }

  private render(keep = true): void {
    const g = this.g;
    const s = g.save.data;
    const id = this.viewing;
    const f = FIGHTERS[id];
    const fp = s.fighters[id];
    // 1.8.8: signed / opened for tokens (the save) or opened by a confirmed PRIME SHOP purchase
    const open = inRoster(s, id);
    this.rights = entitlementsVersion();
    // 1.8.8+: the hanger only for a fighter who has more than the standard look (nothing to offer otherwise)
    const looks = g.shop.wardrobe(id);
    if (looks.length < 2) this.wardrobe = false;
    const worn = looks.find((w) => w.worn)!;
    const hanger =
      looks.length < 2
        ? ''
        : `<button type="button" class="wr-hanger ${this.wardrobe ? 'on' : ''} ${worn.skin ? 'skinned' : ''}" data-act="wardrobe" aria-label="Облик бойца ${esc(f.name)}: ${esc(worn.name)}" aria-expanded="${this.wardrobe}" aria-controls="roster-wardrobe">${UI_ICONS.hanger}</button>`;
    g.showcase.show(g.fighterLook(f.id), f.theme.accent);
    const sig = CARDS[f.signature];
    const pas = PASSIVES[f.passive];
    const order = this.order;
    const tabs = order.map((fid, i) => {
      const ff = FIGHTERS[fid];
      const locked = !inRoster(s, fid);
      return `<button class="roster-tab ${fid === id ? 'active' : ''} ${locked ? 'locked' : ''} ${ff.seasonal ? 'seasonal' : ''}" data-act="tab" data-i="${i}">
        ${portraitHTML(g.portraitOf(ff.id), ff.theme.main, ff.theme.dark)}
        ${locked ? `<span class="lock">${UI_ICONS.lock}</span>` : ''}
      </button>`;
    }).join('');
    const bars = BAR_LABELS.map(
      ([k, label]) =>
        `<div class="sl">${label}</div><div class="segs" style="--sc1:${f.theme.accent};--sc2:${f.theme.main}">${[0, 1, 2, 3, 4]
          .map((i) => `<i class="${i < f.bars[k] ? 'on' : ''}"></i>`)
          .join('')}</div>`,
    ).join('');

    let action = '';
    const offer = f.seasonal && !open ? g.events.fighterOffer(id) : null;
    if (open) {
      action =
        s.selected === id
          ? `<button class="btn ghost wide disabled">${UI_ICONS.check.replace('<svg', '<svg width="16" height="16"')} Выбран для эфира</button>`
          : `<button class="btn teal wide" data-act="select">Выбрать бойца</button>`;
    } else if (f.seasonal) {
      // Alpha 1.7: a seasonal star — opened in the running event's exchange, kept for good
      const ev = offer?.event ?? null;
      const tokens = ev ? g.events.tokens(ev) : 0;
      const cost = offer?.cost ?? 0;
      const ok = !!offer && tokens >= cost;
      action = `<div class="req-list">
          <span class="req ${ok ? 'ok' : ''}">${ok ? '✓' : '✗'} ${cost} ${esc(ev?.currency?.name ?? '')}${ok ? '' : ` · у вас ${tokens}`}</span>
          <span class="req ok">✓ Остаётся в составе навсегда</span>
        </div>
        <button class="btn wide season-btn" data-act="season"><span class="shine"></span>${ok ? 'Открыть' : 'Подробнее'} в «Событиях» · ${cost}<span class="eq-coin">${currencyIcon(ev)}</span></button>
        <div class="center muted" style="font-size:11.5px;margin-top:8px">Эксклюзивный боец ${esc(f.seasonal.title)}: только во время события</div>`;
    } else {
      const c = g.career.canSign(id);
      const lvl = g.career.level().level;
      const needLvl = f.contract!.level;
      const cost = f.contract!.cost;
      const lvlOk = lvl >= needLvl;
      const moneyOk = s.money >= cost;
      action = `<div class="req-list">
          <span class="req ${lvlOk ? 'ok' : ''}">${lvlOk ? '✓' : '✗'} Уровень продюсера ${needLvl}${lvlOk ? '' : ` · у вас ${lvl}`}</span>
          <span class="req ${moneyOk ? 'ok' : ''}">${moneyOk ? '✓' : '✗'} Бюджет $${cost}${moneyOk ? '' : ` · у вас $${Math.floor(s.money)}`}</span>
        </div>
        <button class="btn wide ${c.ok ? '' : 'disabled'}" data-act="sign"><span class="shine"></span>Подписать контракт · $${cost}</button>
        ${c.ok ? '' : `<div class="center muted" style="font-size:11.5px;margin-top:8px">Побеждайте в эфирах, чтобы заработать репутацию и деньги</div>`}`;
    }

    setScreenHTML(
      this.el,
      `
      <div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад">${UI_ICONS.back}</button>
        <div class="h1">Мои бойцы</div>
      </div>
      <div class="roster-tabs">${tabs}</div>
      <div class="drag-zone">
        <button class="nav-arrow l" data-act="prev" aria-label="Предыдущий">${UI_ICONS.back}</button>
        <button class="nav-arrow r" data-act="next" aria-label="Следующий">${UI_ICONS.next}</button>
        <div class="drag-hint">ПОТЯНИТЕ, ЧТОБЫ ПОВЕРНУТЬ</div>
        ${hanger}
      </div>
      <div class="sheet panel scroll">
        <div class="title-row">
          <div class="fill">
            <div class="fname">${esc(f.name)}</div>
            <div class="fnick" style="color:${f.theme.accent}">«${esc(f.nickname)}»</div>
          </div>
          <div style="text-align:right">
            <span class="chip ${s.selected === id && open ? 'gold' : open ? 'teal' : f.seasonal ? 'season' : 'orange'}">${s.selected === id && open ? '★ Выбран' : open ? 'В составе' : f.seasonal ? 'Сезонная звезда' : 'Свободный агент'}</span>
            <div class="label" style="margin-top:6px">${esc(f.style)}</div>
          </div>
        </div>
        ${f.seasonal ? `<div class="season-star">${UI_ICONS.star.replace('<svg', '<svg width="12" height="12"')} ${esc(f.seasonal.title.toUpperCase())} · СЕЗОННАЯ ЗВЕЗДА</div>` : ''}
        <div class="proscons">${f.strengths.map((x) => `<span class="pro">+ ${esc(x)}</span>`).join('')}${f.weaknesses.map((x) => `<span class="con">− ${esc(x)}</span>`).join('')}</div>
        <p>${esc(f.bio)}</p>
        <div class="stat-bars">${bars}</div>
        <div class="ability">
          <div class="ab-ico">${PASSIVE_ICONS[f.passive]}</div>
          <div><b>ПАССИВ · ${esc(pas.name)}</b><span>${esc(pas.desc)}</span></div>
        </div>
        <div class="ability">
          <div style="width:46px;flex:none">${cardHTML(f.signature, '', false)}</div>
          <div><b>ФИРМЕННАЯ КАРТА · ${esc(sig.name)} · ${sig.cost}⚡</b><span>${esc(sig.desc)}</span></div>
        </div>
        <div class="kv-grid">
          <div class="kv"><div class="v">${formatNumber(fp.fans)}</div><div class="k">${esc(fameTier(fp.fans))}</div></div>
          <div class="kv"><div class="v">${fp.wins}-${fp.losses}${fp.draws ? '-' + fp.draws : ''}</div><div class="k">Победы-поражения</div></div>
          <div class="kv"><div class="v">${fp.bestRating || '—'}</div><div class="k">Лучший рейтинг</div></div>
        </div>
        <div class="spacer-8"></div>
        ${action}
      </div>
      ${this.wardrobe ? this.wardrobeHTML(f.name, looks) : ''}`,
      keep,
    );
  }
}
