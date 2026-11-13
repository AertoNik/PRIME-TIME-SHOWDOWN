// Alpha 1.9.8 — the CARDS section of the main menu and the deck editor share one card catalog: what each card is, whether
// the producer has it, how it opens and what it costs (career dollars). The model is plain data (checked headless by
// `npm run cardsmenu`); the HTML helpers are the same everywhere a card is described. Buying stays where it always was —
// CareerSystem.canBuyCard / buyCard (one purchase per card, forever, for every fighter; the save's `cards.owned`).
import { cardPrice } from '../config/careerPrices';
import { CARDS, CARD_FAMILIES, COMBOS, NEW_CARDS, UNIVERSAL_CARDS } from '../config/cards';
import { FIGHTERS, FIGHTER_ORDER } from '../config/fighters';
import type { CardId, FighterId } from '../config/types';
import type { CareerSystem } from '../meta/CareerSystem';
import type { SaveData } from '../meta/SaveSystem';
import { cardHTML, esc } from './dom';
import { UI_ICONS } from './icons';

/** How a card stands for this producer. */
export type CardStanding =
  /** the six basic cards: every fighter has them, free */
  | 'basic'
  /** a shop card bought (forever, every fighter) */
  | 'owned'
  /** a shop card open for purchase and affordable now */
  | 'buyable'
  /** open for purchase, not enough dollars yet */
  | 'short'
  /** not open yet (producer level / career stage) */
  | 'locked'
  /** a fighter's signature, the fighter is in the roster */
  | 'signature'
  /** a signature whose fighter is not in the roster yet */
  | 'signature_locked';

export interface CatalogCard {
  id: CardId;
  standing: CardStanding;
  /** Career price in dollars (shop cards). */
  price?: number;
  /** How a locked shop card opens («Уровень продюсера 4 …»). */
  requirement?: string;
  /** The fighter of a signature card. */
  fighter?: FighterId;
}

export interface CatalogGroup {
  id: string;
  title: string;
  note: string;
  cards: CatalogCard[];
}

/** The minimal career view the catalog needs (CareerSystem has all of it). */
type CareerView = Pick<CareerSystem, 'owns' | 'cardOpen' | 'cardRequirement'>;

export function cardStanding(career: CareerView, data: SaveData, id: CardId, inRoster: (f: FighterId) => boolean): CatalogCard {
  const def = CARDS[id];
  if (def.exclusive) {
    const f = def.exclusive as FighterId;
    return { id, standing: inRoster(f) ? 'signature' : 'signature_locked', fighter: f };
  }
  if (!def.shop) return { id, standing: 'basic' };
  const price = cardPrice(id);
  if (career.owns(id)) return { id, standing: 'owned', price };
  if (!career.cardOpen(id)) return { id, standing: 'locked', price, requirement: career.cardRequirement(id) };
  return { id, standing: data.money >= price ? 'buyable' : 'short', price };
}

/** The whole catalog: the basic six, the shop cards by family, then every fighter's signature (roster order). */
export function cardCatalog(career: CareerView, data: SaveData, inRoster: (f: FighterId) => boolean): CatalogGroup[] {
  const st = (id: CardId) => cardStanding(career, data, id, inRoster);
  const groups: CatalogGroup[] = [
    { id: 'basic', title: 'Базовые карты', note: 'Есть у каждого бойца с первого эфира — бесплатно.', cards: UNIVERSAL_CARDS.map(st) },
  ];
  for (const fam of CARD_FAMILIES) {
    const cards = NEW_CARDS.filter((c) => CARDS[c].family === fam.id).map(st);
    if (cards.length) groups.push({ id: fam.id, title: fam.label, note: '', cards });
  }
  groups.push({
    id: 'signature',
    title: 'Фирменные приёмы',
    note: 'У каждого бойца свой: открывается вместе с бойцом, в чужую колоду не попадает.',
    cards: FIGHTER_ORDER.map((f) => st(FIGHTERS[f].signature)),
  });
  return groups;
}

/** Counts for the menu tile and the section head. */
export function catalogStats(groups: CatalogGroup[]): { total: number; have: number; shop: number; bought: number; buyable: number } {
  const all = groups.flatMap((g) => g.cards);
  const shop = all.filter((c) => c.standing === 'owned' || c.standing === 'buyable' || c.standing === 'short' || c.standing === 'locked');
  return {
    total: all.length,
    have: all.filter((c) => c.standing === 'basic' || c.standing === 'owned' || c.standing === 'signature').length,
    shop: shop.length,
    bought: shop.filter((c) => c.standing === 'owned').length,
    buyable: all.filter((c) => c.standing === 'buyable').length,
  };
}

const ICON = (svg: string, px: number) => svg.replace('<svg', `<svg width="${px}" height="${px}"`);

/** The small tag under a card in a grid: free / bought / price / lock / its fighter. */
export function cardTagHTML(c: CatalogCard): string {
  switch (c.standing) {
    case 'basic':
      return '<span class="shop-tag free">БАЗОВАЯ</span>';
    case 'owned':
      return `<span class="shop-tag own">${ICON(UI_ICONS.check, 10)} ВАША</span>`;
    case 'buyable':
      return `<span class="shop-tag ok">$${c.price}</span>`;
    case 'short':
      return `<span class="shop-tag">$${c.price}</span>`;
    case 'locked':
      return `<span class="shop-tag lock">${ICON(UI_ICONS.lock, 10)} УР. ${CARDS[c.id].shop!.level}</span>`;
    case 'signature':
      return `<span class="shop-tag sig">${esc(FIGHTERS[c.fighter!].name)}</span>`;
    case 'signature_locked':
      return `<span class="shop-tag lock">${ICON(UI_ICONS.lock, 10)} ${esc(FIGHTERS[c.fighter!].name)}</span>`;
  }
}

/** One card of a grid: the card itself (dimmed while closed) and its tag. */
export function catalogCardHTML(c: CatalogCard, focus: boolean): string {
  const closed = c.standing === 'locked' || c.standing === 'signature_locked';
  const cls = `${focus ? 'focus' : ''} ${closed ? 'sealed' : c.standing === 'buyable' || c.standing === 'short' ? 'buyable' : ''}`;
  return `<div data-act="card" data-card="${c.id}" class="shop-item ${closed ? 'locked' : 'open'}">${cardHTML(c.id, cls, false)}${cardTagHTML(c)}</div>`;
}

/**
 * What a card does and how to answer it; `buy`: the purchase line of a shop card not owned yet (the CARDS section only —
 * the deck editor shows the cards a fighter can already use).
 */
export function cardDetailHTML(c: CatalogCard, opts: { buy: boolean; canBuy?: { ok: boolean; reason: string } }): string {
  const fc = CARDS[c.id];
  const pairs = COMBOS.filter((x) => (x.first.includes(c.id) || x.second.includes(c.id)) && !x.after)
    .slice(0, 4)
    .map((x) => esc(x.name))
    .join(' · ');
  const chips = [
    `<span class="chip">${esc(fc.role)}</span>`,
    `<span class="chip teal">${fc.cost} ЭНЕРГИИ</span>`,
    fc.exclusive ? `<span class="chip gold">ФИРМЕННАЯ · ${esc(FIGHTERS[fc.exclusive as FighterId].name)}</span>` : '',
    c.standing === 'owned' ? '<span class="chip gold">КУПЛЕНА</span>' : '',
    c.standing === 'basic' ? '<span class="chip">БАЗОВАЯ</span>' : '',
  ].join('');
  let buy = '';
  if (opts.buy && fc.shop && c.standing !== 'owned') {
    const can = opts.canBuy ?? { ok: false, reason: '' };
    const open = c.standing !== 'locked';
    buy = `<div class="cd-buy">
        <span class="cd-req ${open ? 'open' : ''}">${open ? ICON(UI_ICONS.check, 11) + ' Открыта для покупки' : ICON(UI_ICONS.lock, 11) + ' ' + esc(c.requirement ?? '')}</span>
        <button class="btn small ${can.ok ? '' : 'disabled'}" data-act="buy" data-card="${c.id}">Купить · $${c.price}</button>
        ${can.ok || !open ? '' : `<span class="cd-why">${esc(can.reason)}</span>`}
      </div>`;
  }
  const sigNote =
    c.standing === 'signature_locked' ? `<p class="cd-counter"><b>Как открыть:</b> откройте бойца ${esc(FIGHTERS[c.fighter!].name)} — приём придёт вместе с ним.</p>` : '';
  return `<div class="card-detail ${c.standing === 'owned' || c.standing === 'basic' || c.standing === 'signature' ? '' : 'shop'}"><div class="cd-head"><span class="cd-name">${esc(fc.name)}</span>${chips}</div><p>${esc(fc.desc)}</p>${
    fc.counter ? `<p class="cd-counter"><b>Ответ соперника:</b> ${esc(fc.counter)}</p>` : ''
  }${pairs ? `<p class="cd-pairs"><b>Комбо:</b> ${pairs}</p>` : ''}${sigNote}${buy}</div>`;
}
