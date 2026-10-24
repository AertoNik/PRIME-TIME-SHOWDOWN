import type { CosmeticId } from './cosmetics.config';
import type { FighterId } from './types';

// Alpha 1.8.8 — PRIME SHOP: the one registry of what the shop shows. Stable ids (`sku`) — they will
// be the keys of the server's purchase records, so they never change once payments exist.
//
//   skins     alternate looks of EXISTING fighters (same fighter id, stats, cards and animations;
//             only the procedural look changes — src/config/looks.ts, `base`)
//   effects   PRIME SHOP cosmetics in the existing slots of MY COLLECTION (cosmetics.config `paid`)
//   fighters  LUCIEN: a full fighter (own stats, passive, signature card BAT BITE) — opened for the event's
//             currency during Halloween Premiere (EventManager); after the event, for an account that has not
//             opened him, the paid way (PRIME SHOP)
//
// Prices: SHOP_PRICES_RUB holds every price; SHOP_PRICE_STATUS says, ITEM BY ITEM, which of them the owner has
// approved. Only an approved price is ever shown as a price or charged (approvedPriceRub; the server's rules
// carry only approved prices). SHOP_SALES_OPEN (real money) stays false until the owner opens sales.

export type ShopSku =
  | 'skin_ray_neon_runner'
  | 'skin_bruno_casino_boss'
  | 'fx_prime_broadcast'
  | 'fx_phantom_dash'
  | 'fx_golden_confetti'
  | 'fx_vhs_card_frame'
  | 'fighter_lucien';

export type ShopCategory = 'skins' | 'effects' | 'fighters';

/** Alpha 1.8.8: alternate looks of existing fighters. */
export type SkinId = 'ray_neon_runner' | 'bruno_casino_boss';

export interface SkinDef {
  id: SkinId;
  fighter: FighterId;
  /** The look id built by FighterModel (looks.ts; its `base` is the fighter's own look). */
  look: string;
  name: string;
}

export const SKINS: Record<SkinId, SkinDef> = {
  ray_neon_runner: { id: 'ray_neon_runner', fighter: 'ray', look: 'ray_neon_runner', name: 'NEON RUNNER' },
  bruno_casino_boss: { id: 'bruno_casino_boss', fighter: 'bruno', look: 'bruno_casino_boss', name: 'CASINO BOSS' },
};

export function isSkinId(id: unknown): id is SkinId {
  return typeof id === 'string' && id in SKINS;
}

/** How the item is shown before buying (the fitting room / preview). */
export type ShopPreview = 'model' | 'frame' | 'dash' | 'confetti' | 'cards' | 'fighter';

export interface ShopItemDef {
  sku: ShopSku;
  category: ShopCategory;
  name: string;
  /** Short type line on the card («3D-СКИН · РЭЙ»). */
  kind: string;
  desc: string;
  /** What exactly changes — the item page lists it. */
  highlights: string[];
  rarity: 'rare' | 'epic' | 'legendary';
  /** What it gives: a skin, a PRIME SHOP cosmetic or a fighter. */
  skin?: SkinId;
  cosmetic?: CosmeticId;
  fighter?: FighterId;
  preview: ShopPreview;
  /** Featured block at the top of the shop. */
  featured?: boolean;
}

export const SHOP_ITEMS: ShopItemDef[] = [
  {
    sku: 'skin_ray_neon_runner',
    category: 'skins',
    name: 'RAY: NEON RUNNER',
    kind: '3D-скин · Рэй «Флэш»',
    desc: 'Футуристический уличный боец альтернативных 2000-х: неоновая куртка-раннер, новая причёска с бирюзовым гребнем, визор и неоновые бластеры.',
    highlights: [
      'Тёмная куртка-раннер с электрически-синими вставками, светящимся кантом и LED-шевроном',
      'Подстриженные виски и высокий гребень с бирюзовыми кончиками, неоновые полосы на скуле',
      'Неоновые линии на рукавах и голенях, кроссовки в цветах костюма',
      'Бластеры с бирюзовыми рельсами и кольцом у ствола; синий след рывка и заряда',
    ],
    rarity: 'legendary',
    skin: 'ray_neon_runner',
    fighter: 'ray',
    preview: 'model',
    featured: true,
  },
  {
    sku: 'skin_bruno_casino_boss',
    category: 'skins',
    name: 'BRUNO: CASINO BOSS',
    kind: '3D-скин · Бруно «Бульдозер»',
    desc: 'Хозяин ретрофутуристического казино: чёрно-золотой костюм, бордовая рубашка, зачёсанные назад волосы, ухоженная борода и золотая пушка.',
    highlights: [
      'Двубортный чёрный костюм с золотыми лацканами и пуговицами, бордовая рубашка и галстук с зажимом',
      'Зачёсанный помпадур с проседью, борода-эспаньолка, очки в золотой оправе на кончике носа',
      'Золотые перстни, цепь и платок в нагрудном кармане',
      'Пушка с золотыми кольцами, хромом и рубиновыми вставками; золотое свечение заряда',
    ],
    rarity: 'legendary',
    skin: 'bruno_casino_boss',
    fighter: 'bruno',
    preview: 'model',
    featured: true,
  },
  {
    sku: 'fx_prime_broadcast',
    category: 'effects',
    name: 'PRIME BROADCAST',
    kind: 'Рамка трансляции',
    desc: 'Премиальная рамка эфира PRIME NETWORK: фиолетово-бирюзовые неоновые линии, угловые метки и плашка ON AIR. Не закрывает показатели боя.',
    highlights: [
      'Неоновые угловые метки и тонкие линии по краям экрана',
      'Вертикальная плашка ON AIR у левого края',
      'Табло времени и табличка бойца в цветах PRIME NETWORK',
    ],
    rarity: 'epic',
    cosmetic: 'frame_prime_broadcast',
    preview: 'frame',
  },
  {
    sku: 'fx_phantom_dash',
    category: 'effects',
    name: 'PHANTOM DASH',
    kind: 'Эффект рывка DASH',
    desc: 'Фиолетовый голографический след и бирюзовое послесвечение рывка. Только внешний вид: дальность, скорость и неуязвимость DASH не меняются.',
    highlights: [
      'Фиолетовые голографические силуэты вдоль пути рывка',
      'Бирюзовое послесвечение, которое тает чуть дольше',
      'Отдельный предмет: сезонный PURPLE PHANTOM остаётся в коллекции',
    ],
    rarity: 'epic',
    cosmetic: 'dash_prime_phantom',
    preview: 'dash',
  },
  {
    sku: 'fx_golden_confetti',
    category: 'effects',
    name: 'GOLDEN CONFETTI',
    kind: 'Эффект победы',
    desc: 'Торжественный залп золотого конфетти и золотое кольцо света, когда ваш боец побеждает.',
    highlights: [
      'Золотой залп конфетти и вторая волна',
      'Золотое кольцо и лучи света вокруг победителя',
      'Сезонные эффекты победы не заменяются — выбирается любой полученный',
    ],
    rarity: 'legendary',
    cosmetic: 'victory_golden_confetti',
    preview: 'confetti',
  },
  {
    sku: 'fx_vhs_card_frame',
    category: 'effects',
    name: 'VHS CARD FRAME',
    kind: 'Оформление карт',
    desc: 'Рамки тактических карт в стиле VHS-кассет: этикетка, полосы трекинга и неон. Названия, стоимость и метки комбо читаются как прежде.',
    highlights: [
      'Этикетка-кассета над картой и цветная полоса плёнки',
      'Строки развёртки и полосы трекинга в розово-бирюзовом неоне',
      'Название, стоимость, метки комбо и состояния карт видны как прежде',
    ],
    rarity: 'rare',
    cosmetic: 'card_vhs',
    preview: 'cards',
  },
  {
    sku: 'fighter_lucien',
    category: 'fighters',
    name: 'LUCIEN: THE NIGHT STAR',
    kind: 'Сезонный боец',
    desc: 'Люсьен «Ночная звезда» — звезда Halloween Premiere с тростью VAMPIRE CANE BLASTER и фирменной картой BAT BITE.',
    highlights: [
      'Сезонная звезда Halloween Premiere: трость VAMPIRE CANE BLASTER и карта BAT BITE',
      'Во время события открывается только за PUMPKIN TOKENS',
      'Открытый Люсьен остаётся в составе навсегда',
    ],
    rarity: 'legendary',
    fighter: 'lucien',
    preview: 'fighter',
  },
];

/** The item that sells a PRIME SHOP cosmetic / a skin (entitlements are kept by sku). */
export const SKU_OF_COSMETIC: Partial<Record<CosmeticId, ShopSku>> = Object.fromEntries(
  SHOP_ITEMS.filter((i) => i.cosmetic).map((i) => [i.cosmetic!, i.sku]),
);
export const SKU_OF_SKIN: Record<SkinId, ShopSku> = Object.fromEntries(SHOP_ITEMS.filter((i) => i.skin).map((i) => [i.skin!, i.sku])) as Record<SkinId, ShopSku>;

export function shopItem(sku: ShopSku): ShopItemDef {
  return SHOP_ITEMS.find((i) => i.sku === sku)!;
}

export const SHOP_CATEGORIES: { id: ShopCategory; title: string }[] = [
  { id: 'skins', title: 'Скины' },
  { id: 'effects', title: 'Эффекты и оформление' },
  { id: 'fighters', title: 'Персонажи' },
];

export type PriceStatus = 'proposed' | 'approved';

/**
 * The owner's decision about each price, item by item (docs/PRIME_PRICES.md): 'approved' — confirmed by the owner
 * (`npm run backend:rules` gives it to the server); 'proposed' — NOT approved: the shop shows «Цена уточняется»,
 * the server's rules carry no price, nothing can be charged. Approved 23.10.2026: the six cosmetics. LUCIEN stays
 * proposed (a seasonal fighter: never sold for money before his event ends AND the owner decides).
 */
export const SHOP_PRICE_STATUS: Record<ShopSku, PriceStatus> = {
  skin_ray_neon_runner: 'approved',
  skin_bruno_casino_boss: 'approved',
  fx_prime_broadcast: 'approved',
  fx_phantom_dash: 'approved',
  fx_golden_confetti: 'approved',
  fx_vhs_card_frame: 'approved',
  fighter_lucien: 'proposed',
};

/** When the owner approved the approved prices (shown nowhere in the game; for the documents and checks). */
export const SHOP_PRICES_APPROVED_ON = '2026-10-23';

/**
 * Prices in roubles. Approved 23.10.2026 by the owner: RAY: NEON RUNNER 99, BRUNO: CASINO BOSS 149, PRIME
 * BROADCAST 49, PHANTOM DASH 49, GOLDEN CONFETTI 49, VHS CARD FRAME 49. LUCIEN 299 — proposed only. Whole
 * roubles; no VAT (the seller pays НПД).
 */
export const SHOP_PRICES_RUB: Record<ShopSku, number> = {
  skin_ray_neon_runner: 99,
  skin_bruno_casino_boss: 149,
  fx_prime_broadcast: 49,
  fx_phantom_dash: 49,
  fx_golden_confetti: 49,
  fx_vhs_card_frame: 49,
  fighter_lucien: 299,
};

/** The price the shop may show and the server may charge: the approved one — null while only proposed. */
export function approvedPriceRub(sku: ShopSku): number | null {
  return SHOP_PRICE_STATUS[sku] === 'approved' ? SHOP_PRICES_RUB[sku] : null;
}

/**
 * What the buyer pays for, in words fit for Robokassa's Description and the НПД receipt (≤ 100 characters, no
 * special characters): a look of a fighter and a PRIME SHOP cosmetic are «цифровое оформление»; LUCIEN is a
 * playable character.
 */
export function receiptNameOf(i: ShopItemDef): string {
  if (i.category === 'skins') return `Цифровой облик бойца ${i.name} для игры PRIME TIME: SHOWDOWN`;
  if (i.category === 'effects') return `Цифровой предмет оформления ${i.name} для игры PRIME TIME: SHOWDOWN`;
  return `Открытие игрового персонажа ${i.name} в игре PRIME TIME: SHOWDOWN`;
}

/**
 * 1.8.8 stage 4 — STAGING ONLY: what a TEST payment asks on a staging server whose Robokassa runs in
 * test mode (IsTest=1, the test passwords — no money moves). These are not prices: a production server
 * never reads them (backend lib/payments.js uses the APPROVED prices for live payments and for the
 * demonstration), and the shop shows them only as «тестовая оплата N ₽» next to the item's real price.
 */
export const SHOP_TEST_PRICES_RUB: Record<ShopSku, number> = {
  skin_ray_neon_runner: 10,
  skin_bruno_casino_boss: 10,
  fx_prime_broadcast: 10,
  fx_phantom_dash: 10,
  fx_golden_confetti: 10,
  fx_vhs_card_frame: 10,
  fighter_lucien: 10,
};

/** The paid way to open a fighter (LUCIEN after his season) — the sku its purchase record carries. */
export const SKU_OF_FIGHTER: Partial<Record<FighterId, ShopSku>> = Object.fromEntries(SHOP_ITEMS.filter((i) => i.fighter && !i.skin).map((i) => [i.fighter!, i.sku]));

/**
 * Roubles → kopecks, exactly (money is never compared as a fraction): 149 → 14900, 149.5 → 14950;
 * null for anything that is not a whole number of kopecks above zero.
 */
export function rubToKop(rub: number | null | undefined): number | null {
  if (typeof rub !== 'number' || !Number.isFinite(rub) || rub <= 0) return null;
  const kop = Math.round(rub * 100);
  return Math.abs(kop - rub * 100) < 1e-6 && kop <= 1e9 ? kop : null;
}

/** «1 490 ₽» — the way a rouble price is written everywhere in PRIME SHOP. */
export function formatRub(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₽`;
}

/** A price in kopecks the same way: «149 ₽», «149,50 ₽». */
export function formatKop(kop: number): string {
  return kop % 100 === 0 ? formatRub(kop / 100) : `${(kop / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

/**
 * Real-money sales are switched on only together with payments (stage 4). The server has its own
 * second switch (PRIME_SHOP_SALES=open): a release alone never opens sales.
 */
export const SHOP_SALES_OPEN = false;

// (1.8.8 stage 3: the public offer moved to src/config/offer.config.ts — revisions with their date
// and the hash of the published text, not a bare address.)
