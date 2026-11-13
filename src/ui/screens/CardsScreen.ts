// Alpha 1.9.8 — CARDS, a section of the main menu: every card of the game in one place — the basic six, the shop cards by
// family, every fighter's signature — what each does, its energy, the combos, whether the producer has it, how a closed
// one opens, and the purchase for career dollars (CareerSystem: once, forever, for every fighter). The deck itself is
// built before the fight (PrepScreen) — this section only browses and buys; nothing about decks or saves changed.
import { CARDS } from '../../config/cards';
import { FIGHTERS } from '../../config/fighters';
import type { CardId } from '../../config/types';
import type { Game } from '../../game/Game';
import { inRoster } from '../../meta/roster';
import { cardCatalog, catalogCardHTML, catalogStats, cardDetailHTML, type CatalogCard, type CatalogGroup } from '../cardCatalog';
import { el, esc, setScreenHTML } from '../dom';
import { UI_ICONS } from '../icons';
import type { Screen } from '../UI';

type Filter = 'all' | 'buy' | 'mine' | 'closed';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'buy', label: 'Купить' },
  { id: 'mine', label: 'Мои' },
  { id: 'closed', label: 'Закрытые' },
];

const pass = (c: CatalogCard, f: Filter): boolean =>
  f === 'all' ||
  (f === 'buy' && (c.standing === 'buyable' || c.standing === 'short')) ||
  (f === 'mine' && (c.standing === 'basic' || c.standing === 'owned' || c.standing === 'signature')) ||
  (f === 'closed' && (c.standing === 'locked' || c.standing === 'signature_locked'));

/** Where the section was opened from (the back button returns there). */
export interface CardsParams {
  back?: 'menu' | 'prep';
  card?: CardId;
}

export class CardsScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private focus: CardId | null = null;
  private filter: Filter = 'all';
  private back: 'menu' | 'prep' = 'menu';

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'cards-screen');
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  onShow(params?: unknown): void {
    const p = (params ?? {}) as CardsParams;
    this.back = p.back === 'prep' ? 'prep' : 'menu';
    this.focus = p.card && CARDS[p.card] ? p.card : null;
    this.filter = 'all';
    this.render(false);
  }

  private groups(): CatalogGroup[] {
    const g = this.g;
    return cardCatalog(g.career, g.save.data, (f) => inRoster(g.save.data, f));
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    const g = this.g;
    const act = t.dataset.act!;
    if (act === 'back') {
      g.audio.ui('click');
      g.goto(this.back);
      return;
    }
    if (act === 'filter') {
      g.audio.ui('click');
      this.filter = (t.dataset.f as Filter) ?? 'all';
      this.render();
      return;
    }
    if (act === 'card') {
      g.audio.ui('click');
      const c = t.dataset.card as CardId;
      this.focus = this.focus === c ? null : c;
      this.render();
      return;
    }
    if (act === 'buy') {
      const c = t.dataset.card as CardId;
      const can = g.career.canBuyCard(c);
      if (!can.ok) {
        g.audio.ui('deny');
        g.ui.toast(can.reason);
        return;
      }
      if (g.career.buyCard(c)) {
        g.audio.ui('coin');
        g.ui.toast(`${CARDS[c].name} — ваша карта навсегда, для всех бойцов. Добавьте её в колоду перед эфиром.`, true);
        this.focus = c;
        this.render();
      }
      return;
    }
    if (act === 'deck') {
      g.audio.ui('click');
      if (this.back === 'prep') g.goto('prep');
      else g.goto('prep', { mode: { kind: 'classic' } });
    }
  }

  private render(keep = true): void {
    const g = this.g;
    const groups = this.groups();
    const st = catalogStats(groups);
    const money = Math.floor(g.save.data.money).toLocaleString('ru-RU');
    const sections = groups
      .map((grp) => {
        const cards = grp.cards.filter((c) => pass(c, this.filter));
        if (!cards.length) return '';
        const focused = cards.find((c) => c.id === this.focus);
        const shopGroup = grp.id !== 'basic' && grp.id !== 'signature';
        const head = shopGroup ? `${esc(grp.title)}` : esc(grp.title);
        const count = shopGroup ? `<span class="label">${grp.cards.filter((c) => c.standing === 'owned').length}/${grp.cards.length}</span>` : `<span class="label">${grp.cards.length}</span>`;
        return `<div class="section panel cards-group" data-group="${grp.id}">
            <div class="section-title"><span class="h2">${head}</span>${count}</div>
            ${grp.note ? `<p class="shop-note">${esc(grp.note)}</p>` : ''}
            <div class="collection shop">${cards.map((c) => catalogCardHTML(c, c.id === this.focus)).join('')}</div>
            ${focused ? this.detail(focused) : ''}
          </div>`;
      })
      .join('');
    const empty =
      this.filter === 'buy'
        ? 'Сейчас нечего купить: новые карты откроются с уровнем продюсера и этапами карьеры.'
        : this.filter === 'closed'
          ? 'Все карты открыты — коллекция собрана!'
          : 'Пока пусто.';
    setScreenHTML(
      this.el,
      `
      <div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад">${UI_ICONS.back}</button>
        <div class="h1">Карты</div>
        <span class="chip gold cards-money" aria-label="Гонорары: ${money} долларов">$${money}</span>
      </div>
      <div class="fill scroll" style="padding-bottom:10px">
        <div class="section panel cards-intro">
          <div class="ci-stats">
            <div><b>${st.have}</b><span>из ${st.total} карт ваши</span></div>
            <div><b>${st.bought}/${st.shop}</b><span>новых куплено</span></div>
            <div class="${st.buyable ? 'hot' : ''}"><b>${st.buyable}</b><span>можно купить</span></div>
          </div>
          <p class="shop-note">Новые карты открываются уровнем продюсера или этапом карьеры и покупаются один раз за гонорары — навсегда и для всех бойцов. Колоду из 4 карт вы собираете перед эфиром.</p>
          <div class="seg-control cards-filter">${FILTERS.map((f) => `<button class="${this.filter === f.id ? 'on' : ''}" data-act="filter" data-f="${f.id}">${f.label}</button>`).join('')}</div>
        </div>
        ${sections || `<div class="section panel"><p class="shop-note">${esc(empty)}</p></div>`}
      </div>
      <div style="padding:8px 12px 0">
        <button class="btn wide" data-act="deck">${this.back === 'prep' ? 'Вернуться к колоде' : 'Собрать колоду'} · ${esc(FIGHTERS[g.save.data.selected].name)}</button>
      </div>`,
      keep,
    );
  }

  private detail(c: CatalogCard): string {
    const g = this.g;
    return cardDetailHTML(c, { buy: true, canBuy: CARDS[c.id].shop ? g.career.canBuyCard(c.id) : undefined });
  }
}
