import { CAREER_STAGES, type StageId } from '../../config/career';
import { COSMETICS, COSMETIC_SLOTS, FX_SLOTS, RARITY_LABEL, RARITY_ORDER, SLOT_LABELS, isFxSlot, type CosmeticId, type FxSlot, type Rarity } from '../../config/cosmetics.config';
import { EVENTS } from '../../config/events.config';
import { FIGHTERS, FIGHTER_ORDER } from '../../config/fighters';
import { LOOKS } from '../../config/looks';
import { SHOP_ITEMS, SKINS, SKU_OF_COSMETIC, SKU_OF_SKIN, shopItem, type SkinId } from '../../config/shop.config';
import { RANKS } from '../../config/league.config';
import type { FighterId } from '../../config/types';
import type { Game } from '../../game/Game';
import type { AchievementView, CollectionTab, CosmeticView } from '../../meta/Collection';
import { paidSource } from '../../meta/entitlements';
import { inRoster } from '../../meta/roster';
import { stageArt } from '../careerArt';
import { currencyArt } from '../currencyArt';
import { el, esc, portraitHTML, setScreenHTML } from '../dom';
import { cosmeticPic } from '../effectArt';
import { REWARD_ART } from '../eventArt';
import { UI_ICONS } from '../icons';
import { rankEmblem, seasonEmblem } from '../leagueArt';
import { MODE_ICONS } from '../modeArt';
import { achievementArt, rewardSectionArt, type RewardSection } from '../rewardArt';
import { shopArt } from '../shopArt';
import type { Screen } from '../UI';

// MY COLLECTION — Beta 2.0: the producer's personal hall of fame. The SAME ownership as before (src/meta/Collection.ts,
// PRIME SHOP purchases, the league / daily server proofs): this screen only shows and equips — it never grants, never
// hides an owned item and never asks to obtain one twice. An item bought or earned during a season is ONE item: it may
// show in its season and in its category, with one right of ownership.
//
//   ОБЗОР          the hall: counts, what is on air now, the fighters' personal effects, the rarest items, what is new
//   КУПЛЕННОЕ      PRIME SHOP purchases: skins · effects · frames and card styles · other
//   СЕЗОНЫ         Halloween, WINTER SHOWDOWN and future events: their items and seasonal stars
//   ДОСТИЖЕНИЯ     the existing achievements (no new ones in Beta 2.0)
//   PRIME LEAGUE   the rank, the season's titles and emblem, the PRIME TOKENS exchange items
//   НАГРАДЫ        career, BOSS FIGHT and DAILY PRIME STREAK rewards
// Lists have search, state filters (получено · применено · новое), rarity and sorting; a tap opens the big view.
//
// Beta 2.0 (final) — the screen is built ONCE when it opens (render); a tab, a category, a filter or an action in the
// big view only refreshes it in place (update): the tab bar is never recreated, so it keeps its horizontal scroll (the
// 2.0 build rebuilt everything with innerHTML, and on iPhone the bar jumped back to its start), the category chips and
// the strips keep theirs, and the page stays where it was — a new section starts right under the tabs.

type Section = 'overview' | 'shop' | 'seasons' | 'achievements' | 'league' | 'rewards';
type ShopSub = 'all' | 'skins' | 'effects' | 'style' | 'other';
type Filter = 'all' | 'owned' | 'applied' | 'new';
type Sort = 'rarity' | 'date' | 'name';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'shop', label: 'Купленное' },
  { id: 'seasons', label: 'Сезоны' },
  { id: 'achievements', label: 'Достижения' },
  { id: 'league', label: 'PRIME LEAGUE' },
  { id: 'rewards', label: 'Награды' },
];
const SUBS: { id: ShopSub; label: string }[] = [
  { id: 'all', label: 'Всё' },
  { id: 'skins', label: 'Скины' },
  { id: 'effects', label: 'Эффекты' },
  { id: 'style', label: 'Оформление и рамки' },
  { id: 'other', label: 'Другое' },
];
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'owned', label: 'Получено' },
  { id: 'applied', label: 'Применено' },
  { id: 'new', label: 'Новое' },
];
// 1.9.5: the four tiers of rarity, one wording everywhere (cosmetics.config.ts)
const RARITY = RARITY_LABEL;
const FX_SLOT_LABEL: Record<FxSlot, string> = { dashFx: 'Рывок', victoryFx: 'Победа' };

const fmtDate = (t: number) => (t > 0 ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const check = (n = 11) => UI_ICONS.check.replace('<svg', `<svg width="${n}" height="${n}"`);
const lock = (n = 11) => UI_ICONS.lock.replace('<svg', `<svg width="${n}" height="${n}"`);

/** One thing the collection shows: a cosmetic, a fighter's skin or a seasonal star. */
interface Entry {
  key: string;
  kind: 'cos' | 'skin' | 'star';
  id: string;
  name: string;
  type: string;
  rarity: Rarity;
  owned: boolean;
  applied: boolean;
  fresh: boolean;
  at: number;
  source: string;
  group: 'shop' | 'season' | 'league' | 'rewards';
  sub: ShopSub;
  eventId: string | null;
  /** A seasonal item owned through a PRIME SHOP purchase: also listed among the purchases (one item, one right). */
  bought: boolean;
}

export class CollectionScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private section: Section = 'overview';
  private sub: ShopSub = 'all';
  private filter: Filter = 'all';
  private rarity: Rarity | 'any' = 'any';
  private sort: Sort = 'rarity';
  private query = '';
  /** Items that were new when the screen opened keep their NEW tag until it closes. */
  private freshOnOpen = new Set<CosmeticId>();

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'archive-screen cl20');
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => this.onInput(e));
    this.el.addEventListener('change', (e) => this.onInput(e));
  }

  onShow(params?: unknown): void {
    const p = params as { tab?: CollectionTab; section?: Section; fx?: FighterId } | undefined;
    // the 1.x tabs still open the right place (checkout → cosmetics, events → seasons)
    const map: Record<string, Section> = { all: 'overview', cosmetics: 'shop', achievements: 'achievements', seasons: 'seasons' };
    if (p?.section) this.section = p.section;
    else if (p?.tab) this.section = map[p.tab] ?? 'overview';
    const col = this.g.collection;
    this.freshOnOpen = new Set(col.cosmetics().filter((v) => v.fresh).map((v) => v.def.id));
    col.markAllSeen();
    this.render(false);
    requestAnimationFrame(() => this.revealTab(false));
    if (p?.fx && FIGHTER_ORDER.includes(p.fx)) this.openFighterFx(p.fx);
  }

  // ------------------------------------------------------------------ data
  private roster(): FighterId[] {
    const s = this.g.save.data;
    return FIGHTER_ORDER.filter((f) => inRoster(s, f));
  }

  private cosEntry(v: CosmeticView): Entry {
    const c = v.def;
    const col = this.g.collection;
    const sel = this.g.save.data.selected;
    const sku = SKU_OF_COSMETIC[c.id];
    const bought = c.source === 'season' && v.owned && !this.g.save.data.cosmetics.owned.includes(c.id) && !!sku && !!paidSource(sku);
    let applied: boolean;
    if (isFxSlot(c.slot)) applied = v.owned && col.wornBy(c.id, this.roster()).length > 0;
    else if (c.personal) applied = v.owners.some((f) => col.isEquipped(c.id, f));
    else applied = v.owned && col.isEquipped(c.id, sel);
    const group: Entry['group'] = c.source === 'shop' ? 'shop' : c.source === 'season' ? 'season' : c.source === 'league' ? 'league' : 'rewards';
    const sub: ShopSub = isFxSlot(c.slot) ? 'effects' : c.slot === 'broadcastFrame' || c.slot === 'cardStyle' ? 'style' : 'other';
    return {
      key: `c:${c.id}`,
      kind: 'cos',
      id: c.id,
      name: c.name,
      type: SLOT_LABELS[c.slot],
      rarity: c.rarity,
      owned: c.personal ? v.owners.length > 0 : v.owned,
      applied,
      fresh: this.freshOnOpen.has(c.id),
      at: v.at,
      source: c.sourceLabel,
      group,
      sub,
      eventId: c.source === 'season' ? c.eventId : null,
      bought,
    };
  }

  private skinEntries(): Entry[] {
    const g = this.g;
    // (1.9.5: a skin whose price is not approved yet shows only once owned — like the catalog)
    return (Object.keys(SKINS) as SkinId[])
      .filter((id) => g.shop.skinsOf(SKINS[id].fighter).includes(id) && g.shop.ownsSkin(id))
      .map((id) => {
        const sk = SKINS[id];
        const src = g.shop.skinSource(id);
        return {
          key: `s:${id}`,
          kind: 'skin',
          id,
          name: `${FIGHTERS[sk.fighter].name}: ${sk.name}`,
          type: 'Облик бойца',
          rarity: shopItem(SKU_OF_SKIN[id]).rarity,
          owned: true,
          applied: g.shop.skinFor(sk.fighter) === id,
          fresh: false,
          at: 0,
          source: src === 'dev' ? 'Тест (dev)' : src === 'test' ? 'Тестовая покупка' : src === 'season' ? 'Сезонная награда' : 'PRIME SHOP',
          group: 'shop',
          sub: 'skins',
          eventId: null,
          bought: false,
        } satisfies Entry;
      });
  }

  private starEntries(): Entry[] {
    return this.g.collection.seasonalFighters().map((x) => ({
      key: `f:${x.id}`,
      kind: 'star',
      id: x.id,
      name: `${FIGHTERS[x.id].name} · ${FIGHTERS[x.id].nickname}`,
      type: 'Сезонный боец',
      rarity: 'legendary',
      owned: true,
      applied: false,
      fresh: false,
      at: x.at,
      source: EVENTS.find((e) => e.id === x.eventId)?.title ?? FIGHTERS[x.id].seasonal?.title ?? '',
      group: 'season',
      sub: 'other',
      eventId: x.eventId,
      bought: false,
    }));
  }

  /** Everything the collection may show (seasonal and PRIME SHOP items only once owned — no spoilers). */
  private entries(): Entry[] {
    const sel = this.g.save.data.selected;
    return [...this.g.collection.cosmetics(undefined, sel).map((v) => this.cosEntry(v)), ...this.skinEntries(), ...this.starEntries()];
  }

  private refine(list: Entry[]): Entry[] {
    const q = this.query.trim().toLowerCase();
    const out = list.filter(
      (e) =>
        (this.filter === 'all' || (this.filter === 'owned' && e.owned) || (this.filter === 'applied' && e.applied) || (this.filter === 'new' && e.fresh)) &&
        (this.rarity === 'any' || e.rarity === this.rarity) &&
        (!q || `${e.name} ${e.type} ${e.source}`.toLowerCase().includes(q)),
    );
    const rank = (r: Rarity) => RARITY_ORDER.indexOf(r);
    out.sort((a, b) => {
      if (a.owned !== b.owned) return a.owned ? -1 : 1;
      if (this.sort === 'name') return a.name.localeCompare(b.name, 'ru');
      if (this.sort === 'date') return b.at - a.at || rank(b.rarity) - rank(a.rarity);
      return rank(b.rarity) - rank(a.rarity) || a.name.localeCompare(b.name, 'ru');
    });
    return out;
  }

  // ------------------------------------------------------------------ input
  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.matches('.cl-search input')) this.query = t.value.slice(0, 40);
    else if (t.matches('select[data-k="rarity"]')) this.rarity = t.value as Rarity | 'any';
    else if (t.matches('select[data-k="sort"]')) this.sort = t.value as Sort;
    else return;
    const box = this.el.querySelector('.cl-results');
    if (box) box.innerHTML = this.resultsHTML();
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    const g = this.g;
    const act = t.dataset.act!;
    if (act === 'back') {
      g.audio.ui('click');
      g.goto('menu');
    } else if (act === 'sec') {
      const sec = t.dataset.sec as Section;
      if (sec === this.section && t.closest('.cl-nav')) return; // the open tab: nothing to rebuild
      g.audio.ui('swipe');
      this.section = sec;
      this.query = '';
      this.refreshInPlace(true);
    } else if (act === 'sub') {
      g.audio.ui('swipe');
      this.sub = t.dataset.sub as ShopSub;
      this.pickChip(t);
      this.refreshResults();
    } else if (act === 'filter') {
      g.audio.ui('click');
      this.filter = t.dataset.f as Filter;
      this.pickChip(t);
      this.refreshResults();
    } else if (act === 'open') {
      g.audio.ui('click');
      this.openItem(t.dataset.key!);
    } else if (act === 'fxf') {
      g.audio.ui('click');
      this.openFighterFx(t.dataset.f as FighterId);
    } else if (act === 'assign') {
      // one-time: tie an old personal reward to the fighter who earned it
      const id = t.dataset.id as CosmeticId;
      const f = t.dataset.f as FighterId;
      g.confirm('Привязать награду?', `«${COSMETICS[id].name}» станет личной наградой бойца ${FIGHTERS[f].name}. Выбор делается один раз.`, 'Привязать', () => {
        if (g.collection.assignLegacy(id, f)) {
          g.audio.ui('confirm');
          g.applyCosmetics();
          g.ui.toast(`${COSMETICS[id].name}: теперь награда бойца ${FIGHTERS[f].name}`);
          this.refreshInPlace();
        }
      });
    } else if (act === 'go') {
      g.audio.ui('click');
      const to = t.dataset.to!;
      if (to === 'shop') g.goto('shop', t.dataset.sku ? { sku: t.dataset.sku, from: 'collection' } : undefined);
      else if (to === 'events' || to === 'career' || to === 'league') g.goto(to);
    }
  }

  // ------------------------------------------------------------------ render
  /** What the hero, the tabs and the body are built from (one pass over the collection). */
  private state() {
    const g = this.g;
    const all = this.entries();
    const owned = all.filter((e) => e.owned);
    const ach = g.collection.achievements();
    const achDone = ach.filter((a) => a.done).length;
    const counts: Partial<Record<Section, number>> = {
      shop: owned.filter((e) => e.group === 'shop' || e.bought).length,
      seasons: owned.filter((e) => e.group === 'season').length,
      achievements: achDone,
      league: owned.filter((e) => e.group === 'league').length,
      rewards: owned.filter((e) => e.group === 'rewards').length,
    };
    return { all, owned, ach, achDone, counts };
  }

  private topHTML(d: ReturnType<CollectionScreen['state']>): string {
    const g = this.g;
    const rare = d.owned.filter((e) => e.rarity === 'epic' || e.rarity === 'legendary').length;
    const applied = d.owned.filter((e) => e.applied).length;
    const legacy = g.collection.unassigned().map((id) => this.legacyCard(id)).join('');
    return `<div class="cl-hero panel">
          <div class="cl-hero-top"><div class="ca-org">${esc(g.save.data.orgName)}</div><span class="cl-hero-k">ЛИЧНЫЙ ЗАЛ СЛАВЫ</span></div>
          <div class="cl-stats">
            <div><b>${d.owned.length}</b><span>предметов</span></div>
            <div><b>${applied}</b><span>применено</span></div>
            <div><b>${rare}</b><span>редких</span></div>
            <div><b>${d.achDone}/${d.ach.length}</b><span>достижений</span></div>
          </div>
        </div>
        ${legacy}`;
  }

  private tabHTML(s: { id: Section; label: string }, counts: Partial<Record<Section, number>>): string {
    return `${s.label}${counts[s.id] ? `<i>${counts[s.id]}</i>` : ''}`;
  }

  private bodyHTML(d: ReturnType<CollectionScreen['state']>): string {
    if (this.section === 'overview') return this.overview(d.all, d.ach);
    if (this.section === 'achievements') return this.achievementsHTML(d.ach);
    return `${this.sectionHead()}${this.toolbar()}<div class="cl-results">${this.resultsHTML()}</div>`;
  }

  /** The whole screen, built once when it opens. */
  private render(keep = true): void {
    const d = this.state();
    setScreenHTML(
      this.el,
      `
      <div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад">${UI_ICONS.back}</button>
        <div class="col-head"><div class="h1">Моя коллекция</div><div class="col-sub">PRIME TIME STAR ARCHIVE</div></div>
      </div>
      <div class="fill scroll col-scroll">
        <div class="cl-top">${this.topHTML(d)}</div>
        <nav class="cl-nav" role="tablist">${SECTIONS.map((s) => `<button class="${this.section === s.id ? 'on' : ''}" data-act="sec" data-sec="${s.id}" role="tab" aria-selected="${this.section === s.id}">${this.tabHTML(s, d.counts)}</button>`).join('')}</nav>
        <div class="cl-body">${this.bodyHTML(d)}</div>
      </div>`,
      keep,
    );
  }

  /**
   * Refreshes the screen IN PLACE: the tab bar keeps its element (and so its horizontal scroll), the strips and the
   * category chips of the same section get their scroll back, and the page does not jump. `sectionChanged`: a new
   * section starts right under the tabs (if the page was scrolled past them) and its tab is brought into view.
   */
  private refreshInPlace(sectionChanged = false): void {
    const scroller = this.el.querySelector<HTMLElement>('.col-scroll');
    const top = this.el.querySelector<HTMLElement>('.cl-top');
    const nav = this.el.querySelector<HTMLElement>('.cl-nav');
    const body = this.el.querySelector<HTMLElement>('.cl-body');
    if (!scroller || !top || !nav || !body) {
      this.render();
      return;
    }
    const d = this.state();
    const y = scroller.scrollTop;
    top.innerHTML = this.topHTML(d);
    nav.querySelectorAll<HTMLElement>('button[data-sec]').forEach((b) => {
      const s = SECTIONS.find((x) => x.id === b.dataset.sec);
      if (!s) return;
      const on = s.id === this.section;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      const html = this.tabHTML(s, d.counts);
      if (b.innerHTML !== html) b.innerHTML = html;
    });
    const back = sectionChanged ? null : keepScrollX(body);
    body.innerHTML = this.bodyHTML(d);
    back?.();
    if (sectionChanged) {
      // the tabs stay under the finger: past them, the new section starts right below them; above them, nothing moves
      const navY = nav.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 6;
      scroller.scrollTop = Math.min(y, Math.max(0, navY));
      this.revealTab(true);
    } else if (scroller.scrollTop !== y) scroller.scrollTop = y;
  }

  /** Only the list of the open section (a category or a filter): the toolbar, its chips and the search stay. */
  private refreshResults(): void {
    const box = this.el.querySelector('.cl-results');
    if (box) box.innerHTML = this.resultsHTML();
    else this.refreshInPlace();
  }

  /** Marks `chip` as the chosen one of its row, in place (the row keeps its scroll). */
  private pickChip(chip: HTMLElement): void {
    chip.parentElement?.querySelectorAll('.cl-chip').forEach((c) => c.classList.toggle('on', c === chip));
  }

  /** Scrolls the tab bar just enough for the open tab to be fully visible (never the page itself). */
  private revealTab(smooth: boolean): void {
    const nav = this.el.querySelector<HTMLElement>('.cl-nav');
    const b = nav?.querySelector<HTMLElement>('button.on');
    if (!nav || !b || !nav.clientWidth) return;
    const pad = 14;
    const nr = nav.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    let dx = 0;
    if (br.left < nr.left + pad) dx = br.left - (nr.left + pad);
    else if (br.right > nr.right - pad) dx = br.right - (nr.right - pad);
    if (Math.abs(dx) < 1) return;
    const left = Math.max(0, Math.min(nav.scrollWidth - nav.clientWidth, nav.scrollLeft + dx));
    if (smooth && 'scrollBehavior' in document.documentElement.style) nav.scrollTo({ left, behavior: 'smooth' });
    else nav.scrollLeft = left;
  }

  private sectionHead(): string {
    if (this.section === 'shop') {
      return `<div class="cl-subnav">${SUBS.map((s) => `<button class="cl-chip ${this.sub === s.id ? 'on' : ''}" data-act="sub" data-sub="${s.id}">${s.label}</button>`).join('')}</div>`;
    }
    if (this.section === 'league') return this.leagueHall();
    if (this.section === 'seasons') {
      const em = this.g.events;
      const live = em.active && em.playable ? em.active : null;
      return live
        ? `<div class="cl-note panel"><div><b>${esc(live.title)}</b> идёт сейчас</div><div class="muted">Задания, обмен и награды события — в «Событиях». Полученное остаётся здесь навсегда.</div><button class="btn ghost cl-note-btn" data-act="go" data-to="events">События</button></div>`
        : '';
    }
    if (this.section === 'rewards')
      return `<div class="cl-note cl-rw-note panel"><span class="cl-rw-emb">${rewardSectionArt('collection', 46)}</span><div class="muted">Награды карьеры, BOSS FIGHT и DAILY PRIME STREAK. Ещё не полученные показаны с условием.</div></div>`;
    return '';
  }

  private toolbar(): string {
    return `<div class="cl-tools">
        <label class="cl-search"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg><input type="search" placeholder="Поиск по названию" value="${esc(this.query)}" maxlength="40" enterkeyhint="search" aria-label="Поиск по коллекции" autocomplete="off" autocorrect="off" spellcheck="false"></label>
        <div class="cl-chips">${FILTERS.map((f) => `<button class="cl-chip ${this.filter === f.id ? 'on' : ''}" data-act="filter" data-f="${f.id}">${f.label}</button>`).join('')}</div>
        <div class="cl-selects">
          <select data-k="rarity" aria-label="Редкость"><option value="any"${this.rarity === 'any' ? ' selected' : ''}>Любая редкость</option>${RARITY_ORDER.slice()
            .reverse()
            .map((r) => `<option value="${r}"${this.rarity === r ? ' selected' : ''}>${RARITY[r]}</option>`)
            .join('')}</select>
          <select data-k="sort" aria-label="Сортировка"><option value="rarity"${this.sort === 'rarity' ? ' selected' : ''}>По редкости</option><option value="date"${this.sort === 'date' ? ' selected' : ''}>Сначала новые</option><option value="name"${this.sort === 'name' ? ' selected' : ''}>По названию</option></select>
        </div>
      </div>`;
  }

  /** The entries of the current section, refined by the toolbar. */
  private resultsHTML(): string {
    const all = this.entries();
    let list: Entry[];
    if (this.section === 'shop') list = all.filter((e) => (e.group === 'shop' || e.bought) && (this.sub === 'all' || e.sub === this.sub));
    else if (this.section === 'seasons') list = all.filter((e) => e.group === 'season');
    else if (this.section === 'league') list = all.filter((e) => e.group === 'league');
    else list = all.filter((e) => e.group === 'rewards');
    const shown = this.refine(list);
    if (this.section === 'seasons') return this.seasonGroups(shown, list.length);
    if (this.section === 'rewards' && shown.length) return this.rewardGroups(shown, list);
    if (!shown.length) return this.empty(list.length > 0);
    const extra = this.section === 'shop' ? `<button class="cl-tile cl-more" data-act="go" data-to="shop"><span class="cl-more-ico">${UI_ICONS.shop}</span><b>PRIME SHOP</b><small>Скины и эффекты — примерка бесплатна</small></button>` : '';
    return `<div class="cl-grid">${shown.map((e) => this.tile(e)).join('')}${extra}</div>`;
  }

  private empty(filtered: boolean): string {
    if (filtered) return `<div class="cl-empty muted">Ничего не найдено. Измените поиск или фильтры.</div>`;
    if (this.section === 'shop')
      return `<div class="cl-empty panel"><div class="h2">Покупок пока нет</div><div class="muted">Скины и эффекты из PRIME SHOP появятся здесь сразу после подтверждённой оплаты.</div><button class="btn ghost" data-act="go" data-to="shop">Открыть PRIME SHOP</button></div>`;
    return `<div class="cl-empty muted">Здесь пока пусто.</div>`;
  }

  private seasonGroups(shown: Entry[], total: number): string {
    if (!total) return `<div class="cl-empty muted">Сезонных наград пока нет. Они появятся здесь, когда вы получите их во время события.</div>`;
    if (!shown.length) return this.empty(true);
    const groups = new Map<string, Entry[]>();
    for (const e of shown) {
      const k = e.eventId ?? 'other';
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    const em = this.g.events;
    const live = em.active && em.playable ? em.active : null;
    return [...groups]
      .map(([eventId, items]) => {
        const ev = EVENTS.find((x) => x.id === eventId);
        const running = live?.id === eventId;
        return `<section class="cl-season">
          <div class="cl-season-head"><div><b>${esc(ev?.title ?? items[0].source)}</b><small>Получено: ${items.filter((i) => i.owned).length} · остаётся навсегда</small></div><span class="chip ${running ? 'orange' : ''}">${running ? 'Идёт сейчас' : 'Сезон завершён'}</span></div>
          <div class="cl-grid">${items.map((e) => this.tile(e)).join('')}</div>
        </section>`;
      })
      .join('');
  }

  /** Beta 2.0 final: the rewards by their source — career, BOSS FIGHT, DAILY PRIME STREAK — each under its emblem. */
  private rewardGroups(shown: Entry[], list: Entry[]): string {
    const sources: { id: RewardSection; title: string }[] = [
      { id: 'career', title: 'Карьера продюсера' },
      { id: 'boss', title: 'BOSS FIGHT' },
      { id: 'daily', title: 'DAILY PRIME STREAK' },
    ];
    const srcOf = (e: Entry): RewardSection => {
      const s = e.kind === 'cos' ? COSMETICS[e.id as CosmeticId].source : 'career';
      return s === 'boss' || s === 'daily' ? s : 'career';
    };
    return sources
      .map((s) => {
        const items = shown.filter((e) => srcOf(e) === s.id);
        if (!items.length) return '';
        const all = list.filter((e) => srcOf(e) === s.id);
        return `<section class="cl-rw">
          <div class="cl-rw-head"><span class="cl-rw-emb">${rewardSectionArt(s.id, 40)}</span><div><b>${s.title}</b><small>Получено: ${all.filter((e) => e.owned).length} из ${all.length}</small></div></div>
          <div class="cl-grid">${items.map((e) => this.tile(e)).join('')}</div>
        </section>`;
      })
      .join('');
  }

  /** A tile of the grid: picture, rarity, name, state. */
  private tile(e: Entry): string {
    const state = !e.owned ? `<span class="cl-st lock">${lock(10)}</span>` : e.applied ? `<span class="cl-st on">${check(10)} Применено</span>` : `<span class="cl-st">Получено</span>`;
    return `<button class="cl-tile r-${e.rarity} ${e.owned ? 'owned' : 'locked'} ${e.applied ? 'applied' : ''}" data-act="open" data-key="${e.key}" aria-label="${esc(e.name)}">
        <span class="cl-art">${this.art(e, 132)}${e.fresh ? '<i class="cl-new">NEW</i>' : ''}${e.bought ? '<i class="cl-bought">PRIME SHOP</i>' : ''}</span>
        <span class="cl-name">${esc(e.name)}</span>
        <span class="cl-meta"><span class="cl-rar">${RARITY[e.rarity]}</span>${state}</span>
      </button>`;
  }

  /** The picture of an entry: the shop's own art for PRIME SHOP items, the 3D previews, portraits for looks. */
  private art(e: Entry, size: number): string {
    const g = this.g;
    if (e.kind === 'skin') {
      const sk = SKINS[e.id as SkinId];
      const look = LOOKS[sk.look];
      const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
      return portraitHTML(g.portraitFor(sk.look), hex(look.top.accent), hex(look.top.main));
    }
    if (e.kind === 'star') {
      const f = FIGHTERS[e.id as FighterId];
      return portraitHTML(g.portraitOf(f.id), f.theme.main, f.theme.dark);
    }
    const c = COSMETICS[e.id as CosmeticId];
    const item = c.paid ? SHOP_ITEMS.find((i) => i.sku === SKU_OF_COSMETIC[c.id]) : undefined;
    return item ? `<span class="cl-shopart">${shopArt(g, item)}</span>` : `<span class="cl-pic">${cosmeticPic(c.id, size)}</span>`;
  }

  // ------------------------------------------------------------------ overview
  private overview(all: Entry[], ach: AchievementView[]): string {
    const g = this.g;
    const col = g.collection;
    const sel = g.save.data.selected;
    const slots = COSMETIC_SLOTS.map((slot) => {
      const id = col.equippedFor(slot, sel);
      const inner = id ? `<span class="cl-slot-art">${cosmeticPic(id, 56)}</span><b>${esc(COSMETICS[id].name)}</b>` : `<span class="cl-slot-art none"></span><b>Стандарт</b>`;
      return `<button class="cl-slot ${id ? 'on' : ''}" ${id ? `data-act="open" data-key="c:${id}"` : 'disabled'}><span class="cl-slot-k">${esc(SLOT_LABELS[slot])}</span>${inner}</button>`;
    }).join('');
    const fx = this.roster()
      .map((f) => {
        const cells = FX_SLOTS.map((slot) => {
          const own = col.fighterFx(f, slot);
          const id = col.equippedFor(slot, f);
          const tag = own === 'off' ? 'выкл' : own ? 'свой' : 'общий';
          return `<span class="cl-fx-cell ${own ? 'own' : ''}"><small>${FX_SLOT_LABEL[slot]} · ${tag}</small><b>${id ? esc(COSMETICS[id].name) : 'Стандарт'}</b></span>`;
        }).join('');
        return `<button class="cl-fx-row" data-act="fxf" data-f="${f}"><span class="cl-fx-who">${portraitHTML(g.portraitOf(f), FIGHTERS[f].theme.main, FIGHTERS[f].theme.dark)}<b>${esc(FIGHTERS[f].name)}</b></span>${cells}<span class="cl-fx-go">${UI_ICONS.next}</span></button>`;
      })
      .join('');
    const owned = all.filter((e) => e.owned);
    const pride = this.refineFor(owned, 'rarity').filter((e) => e.rarity === 'legendary' || e.rarity === 'epic').slice(0, 8);
    const fresh = owned.filter((e) => e.fresh);
    const done = ach.filter((a) => a.done).length;
    const sec = (id: Section, title: string, n: string, art: string) => `<button class="cl-sec" data-act="sec" data-sec="${id}"><span class="cl-sec-art">${art}</span><b>${title}</b><small>${n}</small></button>`;
    const shopN = owned.filter((e) => e.group === 'shop' || e.bought).length;
    return `
      <div class="cl-block panel">
        <div class="cl-block-head"><span class="h2">Сейчас в эфире</span><span class="label">${esc(FIGHTERS[sel].name)}</span></div>
        <div class="cl-slots">${slots}</div>
      </div>
      <div class="cl-block panel">
        <div class="cl-block-head"><span class="h2">Эффекты бойцов</span><span class="label">у каждого бойца</span></div>
        <div class="cl-fx">${fx}</div>
        <div class="cl-fx-hint muted">Купленный эффект доступен всем вашим бойцам. «Общий» — как выбрано для всех, «свой» — личный выбор бойца, «выкл» — без эффекта.</div>
      </div>
      ${fresh.length ? `<div class="cl-block"><div class="cl-block-head"><span class="h2">Новое</span><span class="label">${fresh.length}</span></div><div class="cl-strip">${fresh.map((e) => this.tile(e)).join('')}</div></div>` : ''}
      ${pride.length ? `<div class="cl-block"><div class="cl-block-head"><span class="h2">Гордость коллекции</span><span class="label">эпические и легендарные</span></div><div class="cl-strip">${pride.map((e) => this.tile(e)).join('')}</div></div>` : ''}
      <div class="cl-secs">
        ${sec('shop', 'Купленное', `${shopN} ${shopN === 1 ? 'предмет' : 'предметов'}`, `<span class="cl-sec-ico">${UI_ICONS.shop}</span>`)}
        ${sec('seasons', 'Сезоны', `${owned.filter((e) => e.group === 'season').length} наград`, REWARD_ART.card)}
        ${sec('achievements', 'Достижения', `${done} из ${ach.length}`, stageArt('star', 44))}
        ${sec('league', 'PRIME LEAGUE', `${owned.filter((e) => e.group === 'league').length} предметов`, seasonEmblem(44))}
        ${sec('rewards', 'Награды', `${owned.filter((e) => e.group === 'rewards').length} получено`, rewardSectionArt('collection', 44))}
      </div>`;
  }

  private refineFor(list: Entry[], sort: Sort): Entry[] {
    const keep = { f: this.filter, r: this.rarity, s: this.sort, q: this.query };
    this.filter = 'all';
    this.rarity = 'any';
    this.sort = sort;
    this.query = '';
    const out = this.refine(list);
    ({ f: this.filter, r: this.rarity, s: this.sort, q: this.query } = keep);
    return out;
  }

  // ------------------------------------------------------------------ league
  private leagueHall(): string {
    const me = this.g.league.me;
    if (!me?.joined) {
      return `<div class="cl-league panel"><div class="cl-league-emb">${seasonEmblem(64)}</div><div><b>PRIME LEAGUE</b><div class="muted">Ранг, титулы сезона и эмблема появятся здесь, когда вы выйдете в эфир лиги с PRIME ID.</div><button class="btn ghost cl-note-btn" data-act="go" data-to="league">PRIME LEAGUE</button></div></div>`;
    }
    const best = Math.max(0, Math.min(RANKS.length - 1, Number(me.stats?.bestRank ?? me.rank.index)));
    const claimed = me.track.tiers.filter((t) => me.track.claimed.includes(t.tier));
    const titles = claimed.filter((t) => t.title).map((t) => `<span class="cl-ltitle">${UI_ICONS.trophy}«${esc(t.title!)}»</span>`).join('');
    const emblem = claimed.some((t) => t.emblem);
    return `<div class="cl-league panel">
        <div class="cl-league-emb">${rankEmblem(me.rank.index, me.rank.division, 76)}</div>
        <div class="cl-league-body">
          <div class="cl-league-k">${me.season.number ? `Сезон ${me.season.number}` : 'Предсезонье'}</div>
          <b>${esc(me.rank.ru)} ${me.rank.division ?? ''}</b>
          <div class="muted">${me.rp} RP · лучший ранг: ${esc(RANKS[best].ru)}</div>
          <div class="cl-league-row">${currencyArt('tokens', 18)}<span>${me.tokens} PRIME TOKENS</span></div>
        </div>
      </div>
      <div class="cl-league-awards">
        <div class="cl-la ${emblem ? 'got' : ''}">${seasonEmblem(44)}<span><b>Эмблема сезона</b><small>${emblem ? 'Получена в этом сезоне' : 'Награда пути эфира'}</small></span></div>
        <div class="cl-la-titles">${titles || '<span class="muted">Титулы сезона — награды пути эфира в PRIME LEAGUE.</span>'}</div>
      </div>`;
  }

  // ------------------------------------------------------------------ achievements
  private achievementsHTML(ach: AchievementView[]): string {
    const done = ach.filter((a) => a.done);
    const todo = ach.filter((a) => !a.done);
    return `<div class="cl-ach-sum panel"><b>${done.length}</b> из ${ach.length} достижений · новые достижения появятся в Beta 2.1</div>
      <div class="cl-ach">${done.map((a) => this.achievementCard(a)).join('')}</div>
      ${todo.length ? `<div class="cl-block-head"><span class="h2">В процессе</span><span class="label">${todo.length}</span></div><div class="cl-ach">${todo.map((a) => this.achievementCard(a)).join('')}</div>` : ''}`;
  }

  private achievementCard(a: AchievementView): string {
    const stage = a.id.startsWith('career-') ? (a.id.slice(7) as StageId) : null;
    // Beta 2.0 final: the owner's pictures of BOSS FIGHT, Survival and the three PRIME CHALLENGE achievements
    const art = stage && CAREER_STAGES.some((s) => s.id === stage)
      ? stageArt(stage, 64)
      : achievementArt(a, 64) ?? (a.art === 'belt' || a.art === 'star' || a.art === 'studio'
        ? REWARD_ART[a.art]
        : a.art === 'survival'
          ? MODE_ICONS.survival
          : a.art === 'challenge'
            ? MODE_ICONS.challenge
            : REWARD_ART.star);
    const reward = a.reward ? `<span class="cc-reward">Награда: <b>${esc(COSMETICS[a.reward].name)}</b>${this.g.collection.owns(a.reward) ? ' · в коллекции' : ''}</span>` : '';
    return `<div class="cl-ach-card ${a.done ? 'done' : 'todo'}">
        <div class="cl-ach-art ach-${a.art}${art.startsWith('<img') ? ' has-art' : ''}">${art}</div>
        <div class="cl-ach-body">
          <div class="cl-ach-top"><span>${esc(a.source)}</span>${a.done ? `<span class="cl-st on">${check(10)} Получено</span>` : '<span class="cl-st">В процессе</span>'}</div>
          <b>${esc(a.title)}</b>
          <p>${esc(a.desc)}</p>
          <small>${esc(a.note)}${a.done && a.at ? ` · ${fmtDate(a.at)}` : ''}</small>
          ${reward}
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ the big view
  private openItem(key: string): void {
    let e = this.entries().find((x) => x.key === key);
    if (!e) return;
    const g = this.g;
    g.ui.modal(this.itemHTML(e), (root, close) => {
      root.addEventListener('click', (ev) => {
        const t = (ev.target as HTMLElement).closest('[data-m]') as HTMLElement | null;
        if (!t || !e) return;
        if (t.dataset.m === 'close') {
          close();
          return;
        }
        if (this.itemAction(e, t)) {
          // the screen behind refreshes in place, the big view stays open where it was (no re-opening, no jump)
          this.refreshInPlace();
          const fresh = this.entries().find((x) => x.key === key);
          if (!fresh) {
            close();
            return;
          }
          e = fresh;
          const panel = root.querySelector<HTMLElement>('.modal') ?? root;
          const y = panel.scrollTop;
          panel.innerHTML = this.itemHTML(e);
          panel.scrollTop = y;
        } else if (t.dataset.m === 'go') {
          close();
        }
      });
    });
  }

  private itemHTML(e: Entry): string {
    let desc = '';
    let where = '';
    let howTo = '';
    if (e.kind === 'cos') {
      const c = COSMETICS[e.id as CosmeticId];
      desc = c.desc;
      where = c.where;
      howTo = c.howTo;
    } else if (e.kind === 'skin') {
      desc = 'Облик виден в меню, составе, подготовке и в бою. Бой и характеристики не меняются.';
    } else {
      desc = `${FIGHTERS[e.id as FighterId].style}. Сезонная звезда — в вашем составе навсегда.`;
    }
    const when = e.owned && e.at ? ` · ${fmtDate(e.at)}` : '';
    return `<div class="cl-item r-${e.rarity}">
        <button class="icon-btn cl-x" data-m="close" aria-label="Закрыть">${UI_ICONS.back}</button>
        <div class="cl-item-art">${this.art(e, 220)}</div>
        <div class="cl-item-rar">${RARITY[e.rarity]} · ${esc(e.type)}</div>
        <div class="h1 cl-item-name">${esc(e.name)}</div>
        <div class="cl-item-src">${esc(e.source)}${when}${where ? ` · ${esc(where)}` : ''}</div>
        <p class="cl-item-desc">${esc(desc)}</p>
        ${e.owned ? this.itemControls(e) : `<div class="cl-item-lock">${lock(12)} ${esc(howTo || 'Ещё не получено')}</div>${this.whereToGet(e)}`}
      </div>`;
  }

  private whereToGet(e: Entry): string {
    if (e.kind !== 'cos') return '';
    const c = COSMETICS[e.id as CosmeticId];
    if (c.source === 'league') return `<button class="btn ghost wide" data-m="go" data-act="go" data-to="league">PRIME LEAGUE · обмен PRIME TOKENS</button>`;
    if (c.source === 'career') return `<button class="btn ghost wide" data-m="go" data-act="go" data-to="career">Карьера</button>`;
    if (c.source === 'season') return `<button class="btn ghost wide" data-m="go" data-act="go" data-to="events">События</button>`;
    return '';
  }

  /** What can be done with an owned item, in the big view. */
  private itemControls(e: Entry): string {
    const g = this.g;
    const col = g.collection;
    if (e.kind === 'star') return `<button class="btn teal wide" data-m="star" data-f="${e.id}">Мои бойцы</button>`;
    if (e.kind === 'skin') {
      const sk = SKINS[e.id as SkinId];
      const worn = g.shop.skinFor(sk.fighter) === e.id;
      return `<div class="cl-item-k">Облик бойца ${esc(FIGHTERS[sk.fighter].name)}</div>
        <div class="seg-control cl-item-seg"><button class="${worn ? '' : 'on'}" data-m="skin" data-skin="">Стандарт</button><button class="${worn ? 'on' : ''}" data-m="skin" data-skin="${e.id}">${esc(sk.name)}</button></div>`;
    }
    const id = e.id as CosmeticId;
    const c = COSMETICS[id];
    const sel = g.save.data.selected;
    if (c.personal) {
      const owners = col.owners(id);
      return `<div class="cl-item-k">Личная награда: надевает тот, кто её заработал</div>
        <div class="cl-item-fighters">${owners
          .map((f) => {
            const on = col.isEquipped(id, f);
            return `<button class="cl-fbtn ${on ? 'on' : ''}" data-m="${on ? 'pun' : 'pon'}" data-f="${f}">${on ? check(10) : ''}${esc(FIGHTERS[f].name)}</button>`;
          })
          .join('')}</div>`;
    }
    if (!isFxSlot(c.slot)) {
      const on = col.isEquipped(id, sel);
      return `<div class="cl-item-k">${esc(SLOT_LABELS[c.slot])} — общая для всей трансляции</div>
        <button class="btn ${on ? 'ghost' : 'teal'} wide" data-m="${on ? 'off-all' : 'all'}">${on ? 'Снять' : 'Применить'}</button>`;
    }
    // Beta 2.0: dash / victory effects — for every fighter or for one
    const slot = c.slot;
    const common = col.equipped(slot) === id;
    const rows = this.roster()
      .map((f) => {
        const own = col.fighterFx(f, slot);
        const wears = col.equippedFor(slot, f) === id;
        const tag = own === id ? 'свой выбор' : own === 'off' ? 'без эффекта' : own ? `свой: ${COSMETICS[own].name}` : wears ? 'общий' : 'общий: другой';
        const btn = own === id ? `<button class="btn ghost cl-fx-btn" data-m="inherit" data-f="${f}">Как у всех</button>` : `<button class="btn teal cl-fx-btn" data-m="only" data-f="${f}">Только ему</button>`;
        return `<div class="cl-item-row ${wears ? 'on' : ''}"><span><b>${wears ? check(10) : ''}${esc(FIGHTERS[f].name)}</b><small>${esc(tag)}</small></span>${btn}</div>`;
      })
      .join('');
    const overrides = this.roster().filter((f) => col.fighterFx(f, slot) !== null).length;
    return `<div class="cl-item-k">${FX_SLOT_LABEL[slot]}: один купленный эффект — для всех ваших бойцов</div>
      <div class="cl-item-actions">
        <button class="btn ${common && !overrides ? 'ghost' : 'teal'} wide" data-m="all" ${common && !overrides ? 'disabled' : ''}>${common && !overrides ? `${check(11)} У всех бойцов` : 'Применить ко всем'}</button>
        <button class="btn wide" data-m="only" data-f="${sel}">Только ${esc(FIGHTERS[sel].name)}</button>
        ${common ? `<button class="btn ghost wide" data-m="off-all">Снять общий выбор</button>` : ''}
      </div>
      ${overrides && !common ? `<div class="cl-item-note muted">«Применить ко всем» заменит и личные выборы ${overrides === 1 ? 'одного бойца' : `${overrides} бойцов`}.</div>` : ''}
      <div class="cl-item-rows">${rows}</div>`;
  }

  /** Runs an action of the big view; true = the view should be redrawn. */
  private itemAction(e: Entry, t: HTMLElement): boolean {
    const g = this.g;
    const col = g.collection;
    const m = t.dataset.m!;
    const f = t.dataset.f as FighterId | undefined;
    if (m === 'go') {
      const to = t.dataset.to!;
      if (to === 'events' || to === 'career' || to === 'league') g.goto(to);
      return false;
    }
    if (m === 'star' && f) {
      g.ui.closeModal();
      g.goto('roster', f);
      return false;
    }
    if (e.kind === 'skin' && m === 'skin') {
      const sk = SKINS[e.id as SkinId];
      const skin = (t.dataset.skin || null) as SkinId | null;
      if (!g.shop.setSkin(sk.fighter, skin)) return false;
      g.audio.ui(skin ? 'confirm' : 'click');
      if (sk.fighter === g.save.data.selected) g.showcase.show(g.fighterLook(sk.fighter), FIGHTERS[sk.fighter].theme.accent);
      g.ui.toast(`${FIGHTERS[sk.fighter].name}: ${skin ? sk.name : 'стандартный облик'}`);
      return true;
    }
    if (e.kind !== 'cos') return false;
    const id = e.id as CosmeticId;
    const c = COSMETICS[id];
    let ok = false;
    let msg = '';
    if (m === 'pon' || m === 'pun') {
      ok = !!f && col.setEquipped(id, m === 'pon', f);
      msg = `${c.name} (${f ? FIGHTERS[f].name : ''}): ${m === 'pon' ? 'надето' : 'снято'}`;
    } else if (m === 'all') {
      ok = col.equipForAll(id);
      msg = isFxSlot(c.slot) ? `${c.name}: у всех бойцов` : `${c.name}: применено`;
    } else if (m === 'off-all') {
      ok = col.setEquipped(id, false);
      msg = `${c.name}: снято`;
    } else if (m === 'only' && f && isFxSlot(c.slot)) {
      ok = col.setFighterFx(f, c.slot, id);
      msg = `${c.name}: только у бойца ${FIGHTERS[f].name}`;
    } else if (m === 'inherit' && f && isFxSlot(c.slot)) {
      ok = col.setFighterFx(f, c.slot, null);
      msg = `${FIGHTERS[f].name}: как у всех`;
    }
    if (!ok) return false;
    g.audio.ui('confirm');
    g.applyCosmetics();
    g.ui.toast(msg);
    return true;
  }

  // ------------------------------------------------------------------ a fighter's effects
  /** Beta 2.0: one fighter's dash and victory effects — the common choice, none, or one of the owned items. */
  openFighterFx(f: FighterId): void {
    const g = this.g;
    const col = g.collection;
    const body = () =>
      FX_SLOTS.map((slot) => {
        const own = col.fighterFx(f, slot);
        const common = col.commonFor(slot, f);
        const items = this.g.collection
          .cosmetics((d) => d.slot === slot)
          .filter((v) => v.owned && col.ownsFor(v.def.id, f))
          .map((v) => v.def.id);
        const opt = (val: string, label: string, art: string, on: boolean) => `<button class="cl-fxo ${on ? 'on' : ''}" data-m="set" data-slot="${slot}" data-v="${val}"><span class="cl-fxo-art">${art}</span><span>${label}</span>${on ? `<i>${check(10)}</i>` : ''}</button>`;
        return `<div class="cl-fxs"><div class="cl-item-k">${FX_SLOT_LABEL[slot]}</div><div class="cl-fxo-list">
            ${opt('', `Как у всех<small>${common ? esc(COSMETICS[common].name) : 'стандарт'}</small>`, common ? cosmeticPic(common, 48) : '', own === null)}
            ${opt('off', 'Без эффекта<small>стандартный</small>', '', own === 'off')}
            ${items.map((id) => opt(id, esc(COSMETICS[id].name), cosmeticPic(id, 48), own === id)).join('')}
          </div>${items.length ? '' : `<div class="muted cl-fxo-none">Эффектов этого типа пока нет — они есть в PRIME SHOP и сезонных событиях.</div>`}</div>`;
      }).join('');
    const html = () => `<div class="cl-fxm">
        <button class="icon-btn cl-x" data-m="close" aria-label="Закрыть">${UI_ICONS.back}</button>
        <div class="cl-fxm-head">${portraitHTML(g.portraitOf(f), FIGHTERS[f].theme.main, FIGHTERS[f].theme.dark)}<div><div class="h1">${esc(FIGHTERS[f].name)}</div><div class="muted">Личные эффекты бойца. Купленный предмет не нужно покупать второй раз.</div></div></div>
        ${body()}
      </div>`;
    g.ui.modal(html(), (root, close) => {
      root.addEventListener('click', (ev) => {
        const t = (ev.target as HTMLElement).closest('[data-m]') as HTMLElement | null;
        if (!t) return;
        if (t.dataset.m === 'close') {
          close();
          return;
        }
        if (t.dataset.m !== 'set') return;
        const slot = t.dataset.slot as FxSlot;
        const v = t.dataset.v ?? '';
        const choice = v === '' ? null : v === 'off' ? 'off' : (v as CosmeticId);
        if (!col.setFighterFx(f, slot, choice)) return;
        g.audio.ui('confirm');
        g.applyCosmetics();
        const panel = root.querySelector<HTMLElement>('.modal') ?? root;
        const y = panel.scrollTop;
        panel.innerHTML = html();
        panel.scrollTop = y;
        this.refreshInPlace();
      });
    });
  }

  // ------------------------------------------------------------------ legacy rewards
  /** An old personal reward the records could not tie to a fighter: the player picks once. */
  private legacyCard(id: CosmeticId): string {
    const c = COSMETICS[id];
    const fighters = this.roster();
    return `<div class="col-legacy panel">
        <div class="cl-head"><div class="cc-art">${cosmeticPic(id, 74)}</div>
          <div><div class="h2">${esc(c.name)}: чья это победа?</div>
          <div class="muted cl-text">Эта награда получена до появления личных наград, и сохранение не помнит, какой боец её заработал. Выберите бойца — один раз, награду не придётся зарабатывать заново.</div></div></div>
        <div class="cl-fighters">${fighters.map((f) => `<button class="btn ghost cl-f" data-act="assign" data-id="${id}" data-f="${f}">${esc(FIGHTERS[f].name)}</button>`).join('')}</div>
      </div>`;
  }
}

/**
 * Remembers the horizontal scroll of the strips and chip rows inside `root` (by their class and order) and returns how
 * to put it back after `root` is rebuilt — so a refresh of the same section never throws them back to the start.
 */
function keepScrollX(root: HTMLElement): () => void {
  const SEL = '.cl-subnav, .cl-strip, .cl-chips';
  const key = (e: HTMLElement) => e.className.split(' ')[0];
  const saved = new Map<string, number[]>();
  root.querySelectorAll<HTMLElement>(SEL).forEach((e) => saved.set(key(e), [...(saved.get(key(e)) ?? []), e.scrollLeft]));
  return () => {
    const seen = new Map<string, number>();
    root.querySelectorAll<HTMLElement>(SEL).forEach((e) => {
      const k = key(e);
      const i = seen.get(k) ?? 0;
      seen.set(k, i + 1);
      const x = saved.get(k)?.[i];
      if (x) e.scrollLeft = x;
    });
  };
}
