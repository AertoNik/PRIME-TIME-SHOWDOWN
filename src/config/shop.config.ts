import type { CosmeticId, Rarity } from './cosmetics.config';
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
  | 'fighter_lucien'
  // Alpha 1.9.5 — PRIME SHOP EXPANSION (prices PROPOSED, not approved: nothing of these is sold)
  | 'skin_nika_stage_idol'
  | 'skin_vega_star_pilot'
  | 'fx_studio_spotlights'
  | 'fx_neon_fireworks'
  | 'fx_glitch_dash'
  | 'fx_comet_trail'
  | 'fx_arcade_frame'
  | 'fx_holo_foil'
  // Alpha 1.9.5 — seasonal items of Halloween Premiere sold after the season (the same item ids as the exchange)
  | 'season_halloween_cards'
  | 'season_spooky_broadcast'
  | 'season_pumpkin_victory';

export type ShopCategory = 'skins' | 'effects' | 'fighters';

/** Alpha 1.8.8: alternate looks of existing fighters. */
export type SkinId = 'ray_neon_runner' | 'bruno_casino_boss' | 'nika_stage_idol' | 'vega_star_pilot';

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
  nika_stage_idol: { id: 'nika_stage_idol', fighter: 'nika', look: 'nika_stage_idol', name: 'STAGE IDOL' },
  vega_star_pilot: { id: 'vega_star_pilot', fighter: 'vega', look: 'vega_star_pilot', name: 'STAR PILOT' },
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
  /**
   * 1.9.5: four tiers, purely cosmetic (no stat, mechanic or ownership depends on it): uncommon → rare → epic → legendary.
   * A cosmetic's tier is its MY COLLECTION tier (cosmetics.config.ts — one item, one tier). The owner's honest classification
   * of 06.11.2026 (docs/ALPHA_1_9_5_PART1_PRE_STAGING_REPORT.md, section 3) — by the real visual, items sold before included.
   */
  rarity: Rarity;
  /** What it gives: a skin, a PRIME SHOP cosmetic or a fighter. */
  skin?: SkinId;
  cosmetic?: CosmeticId;
  fighter?: FighterId;
  preview: ShopPreview;
  /** Featured block at the top of the shop. */
  featured?: boolean;
  /** 1.9.5: a new arrival — the «НОВИНКА» ribbon and the new-arrivals strip of the catalog. */
  isNew?: boolean;
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
    rarity: 'epic',
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
    sku: 'skin_nika_stage_idol',
    category: 'skins',
    name: 'NIKA: STAGE IDOL',
    kind: '3D-скин · Ника «Глитч»',
    desc: 'Поп-звезда финального концерта PRIME NETWORK: жемчужный сценический жакет, светящееся сердце на груди и розово-сиреневые пучки.',
    highlights: [
      'Укороченный жемчужный жакет со сиреневыми вставками, высоким сетчатым воротником и светящимся подолом',
      'Розовое неоновое сердце на груди, эполеты с маленькими звёздами, пояс со звёздной пряжкой',
      'Те же пучки и гарнитура Ники в новой розово-сиреневой гамме, светящиеся манжеты',
      'Белый карабин с розовым свечением; лицо, рост, оружие и анимации — как у Ники',
    ],
    rarity: 'epic',
    skin: 'nika_stage_idol',
    fighter: 'nika',
    preview: 'model',
    isNew: true,
  },
  {
    sku: 'skin_vega_star_pilot',
    category: 'skins',
    name: 'VEGA: STAR PILOT',
    kind: '3D-скин · Вега «Зенит»',
    desc: 'Пилот звёздного рейса PRIME NETWORK: тёмно-синий лётный комбинезон, оранжевые ремни подвески и пульт на груди.',
    highlights: [
      'Лётный комбинезон с перекрещёнными оранжевыми ремнями и плотными плечевыми блоками',
      'Нагрудный пульт с тремя огнями, мягкий белый воротник-кольцо, светящаяся нашивка миссии',
      'Тот же высокий хвост и визор Веги — платина с золотыми кончиками',
      'Оранжевые полосы на рукавах и белые манжеты; лицо, рост, оружие и анимации — как у Веги',
    ],
    rarity: 'epic',
    skin: 'vega_star_pilot',
    fighter: 'vega',
    preview: 'model',
    isNew: true,
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
    rarity: 'rare',
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
    rarity: 'rare',
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
    rarity: 'rare',
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
    sku: 'fx_studio_spotlights',
    category: 'effects',
    name: 'STUDIO SPOTLIGHTS',
    kind: 'Эффект победы',
    desc: 'Четыре студийных прожектора по очереди находят победителя, вспыхивают фотовспышки и золотое кольцо света.',
    highlights: [
      'Четыре луча с разных сторон студии сходятся на победителе',
      'Золотое кольцо и мягкий подъём искр в момент «кадра»',
      'Короткие вспышки фотокамер вокруг арены',
    ],
    rarity: 'epic',
    cosmetic: 'victory_studio_spotlights',
    preview: 'confetti',
    isNew: true,
  },
  {
    sku: 'fx_neon_fireworks',
    category: 'effects',
    name: 'NEON FIREWORKS',
    kind: 'Эффект победы',
    desc: 'Три неоновых залпа над ареной: ракеты взлетают и раскрываются розовыми, бирюзовыми и фиолетовыми шарами.',
    highlights: [
      'Три ракеты со следом взлетают над победителем',
      'Розовый, бирюзовый и фиолетовый шары с белой серединой',
      'Мягкое кольцо света на полу — без вспышек на весь экран',
    ],
    rarity: 'epic',
    cosmetic: 'victory_neon_fireworks',
    preview: 'confetti',
    isNew: true,
  },
  {
    sku: 'fx_glitch_dash',
    category: 'effects',
    name: 'GLITCH DASH',
    kind: 'Эффект рывка DASH',
    desc: 'Рывок как сбой сигнала: пурпурный и бирюзовый двойники со смещением, рассыпающиеся пиксели и короткая помеха.',
    highlights: [
      'Пурпурный и бирюзовый двойники, смещённые поперёк пути',
      'Пиксели сигнала разлетаются и гаснут',
      'Только внешний вид: дальность, скорость и неуязвимость DASH не меняются',
    ],
    rarity: 'rare',
    cosmetic: 'dash_glitch',
    preview: 'dash',
    isNew: true,
  },
  {
    sku: 'fx_comet_trail',
    category: 'effects',
    name: 'COMET TRAIL',
    kind: 'Эффект рывка DASH',
    desc: 'Боец проносится кометой: яркая голова, сужающийся огненный хвост и тёплые искры, которые оседают на пол.',
    highlights: [
      'Белая голова кометы в точке прибытия',
      'Сужающийся золотисто-оранжевый хвост вдоль пути',
      'Тёплые искры падают на пол; дальность и скорость DASH не меняются',
    ],
    rarity: 'rare',
    cosmetic: 'dash_comet',
    preview: 'dash',
    isNew: true,
  },
  {
    sku: 'fx_arcade_frame',
    category: 'effects',
    name: 'ARCADE CABINET',
    kind: 'Рамка трансляции',
    desc: 'Рамка в духе игрового автомата: пиксельные углы, янтарно-бирюзовые пунктиры и табличка PLAYER 1. Показатели боя не закрывает.',
    highlights: [
      'Ступенчатые «пиксельные» углы и пунктирные линии по краям',
      'Вертикальная табличка PLAYER 1 у правого края',
      'Янтарное табло времени и плашка LIVE',
    ],
    rarity: 'rare',
    cosmetic: 'frame_arcade',
    preview: 'frame',
    isNew: true,
  },
  {
    sku: 'fx_holo_foil',
    category: 'effects',
    name: 'HOLO FOIL',
    kind: 'Оформление карт',
    desc: 'Тактические карты как коллекционные голограммы: переливающаяся фольга и звёздный блик. Название, стоимость и метки комбо читаются как прежде.',
    highlights: [
      'Переливающийся радужный слой на рисунке карты',
      'Тонкая светлая кайма и звёздный блик в углу',
      'Состояния карт (комбо, энергия, фирменная) видны как прежде; без анимации при «меньше движения»',
    ],
    rarity: 'uncommon',
    cosmetic: 'card_holo',
    preview: 'cards',
    isNew: true,
  },
  {
    sku: 'season_halloween_cards',
    category: 'effects',
    name: 'HALLOWEEN CARD STYLE',
    kind: 'Сезонное оформление карт',
    desc: 'Тыквенные рамки, паутинка и фиолетовое свечение для всех карт — из обмена Halloween Premiere.',
    highlights: [
      'Тыквенная рамка, паутинка в углу рисунка и фиолетовое свечение',
      'Во время Halloween Premiere — только за PUMPKIN TOKENS, после него — в PRIME SHOP',
      'Полученный за жетоны остаётся в коллекции навсегда — повторно не продаётся',
    ],
    rarity: 'rare',
    cosmetic: 'card_pumpkin',
    preview: 'cards',
  },
  {
    sku: 'season_spooky_broadcast',
    category: 'effects',
    name: 'SPOOKY BROADCAST',
    kind: 'Сезонная рамка трансляции',
    desc: 'Рамка эфира Halloween Special: оранжевые уголки, фиолетовое свечение и плашка LIVE — из обмена Halloween Premiere.',
    highlights: [
      'Оранжевые уголки эфира с фиолетовым свечением',
      'Табло времени и плашка LIVE в цветах Halloween',
      'Полученная за жетоны остаётся в коллекции навсегда — повторно не продаётся',
    ],
    rarity: 'rare',
    cosmetic: 'frame_spooky',
    preview: 'frame',
  },
  {
    sku: 'season_pumpkin_victory',
    category: 'effects',
    name: 'PUMPKIN VICTORY',
    kind: 'Сезонный эффект победы',
    desc: 'Светящиеся тыквы и праздничное конфетти над ареной при победе — из обмена Halloween Premiere.',
    highlights: [
      'Светящиеся тыквы взлетают над ареной',
      'Праздничное конфетти в цветах Halloween',
      'Полученный за жетоны остаётся в коллекции навсегда — повторно не продаётся',
    ],
    rarity: 'epic',
    cosmetic: 'victory_pumpkin',
    preview: 'confetti',
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
 * the server's rules carry no price, nothing can be charged. Approved 23.10.2026: the six cosmetics.
 * Alpha 1.9.4: his event ended 04.11.2026 — the shop said «Цена уточняется» because LUCIEN's status was never changed
 * (the paid way after the season works as built). The owner approved 249 ₽ on 05.11.2026. A fighter is still sold
 * only under an offer revision that sells playable characters (offer.config.ts `fighters`; offer № 3 §3.4 excludes
 * LUCIEN) — the server checks that itself (lib/payments.js fightersOffered). docs/ALPHA_1_9_4_LUCIEN.md: the steps.
 */
export const SHOP_PRICE_STATUS: Record<ShopSku, PriceStatus> = {
  skin_ray_neon_runner: 'approved',
  skin_bruno_casino_boss: 'approved',
  fx_prime_broadcast: 'approved',
  fx_phantom_dash: 'approved',
  fx_golden_confetti: 'approved',
  fx_vhs_card_frame: 'approved',
  fighter_lucien: 'approved',
  // 1.9.5: APPROVED by the owner on 06.11.2026 (decision Р-18). Sold only once an offer revision that lists them in its
  // Appendix 1 is in force (offer.config.ts `items`; the server checks it — lib/payments.js itemOffered): revision 4
  // does not, so until revision 5 takes effect they are shown at most as «not on sale yet», never charged.
  skin_nika_stage_idol: 'approved',
  skin_vega_star_pilot: 'approved',
  fx_studio_spotlights: 'approved',
  fx_neon_fireworks: 'approved',
  fx_glitch_dash: 'approved',
  fx_comet_trail: 'approved',
  fx_arcade_frame: 'approved',
  fx_holo_foil: 'approved',
  season_halloween_cards: 'approved',
  season_spooky_broadcast: 'approved',
  season_pumpkin_victory: 'approved',
};

/** When the owner approved the approved prices (shown nowhere in the game; for the documents and checks). */
export const SHOP_PRICES_APPROVED_ON = '2026-10-23';
/** 1.9.4: prices approved on another day than SHOP_PRICES_APPROVED_ON (the documents name both days). */
export const SHOP_PRICES_APPROVED_LATER: Partial<Record<ShopSku, string>> = {
  fighter_lucien: '2026-11-05',
  // 1.9.5 (Р-18, 06.11.2026): the eleven items of PRIME SHOP EXPANSION and the three Halloween items sold after the season
  skin_nika_stage_idol: '2026-11-06',
  skin_vega_star_pilot: '2026-11-06',
  fx_studio_spotlights: '2026-11-06',
  fx_neon_fireworks: '2026-11-06',
  fx_glitch_dash: '2026-11-06',
  fx_comet_trail: '2026-11-06',
  fx_arcade_frame: '2026-11-06',
  fx_holo_foil: '2026-11-06',
  season_halloween_cards: '2026-11-06',
  season_spooky_broadcast: '2026-11-06',
  season_pumpkin_victory: '2026-11-06',
};

/**
 * Prices in roubles. Approved 23.10.2026 by the owner: RAY: NEON RUNNER 99, BRUNO: CASINO BOSS 149, PRIME
 * BROADCAST 49, PHANTOM DASH 49, GOLDEN CONFETTI 49, VHS CARD FRAME 49. LUCIEN 249 — approved 05.11.2026 (1.9.4).
 * Whole roubles; no VAT (the seller pays НПД).
 */
export const SHOP_PRICES_RUB: Record<ShopSku, number> = {
  skin_ray_neon_runner: 99,
  skin_bruno_casino_boss: 149,
  fx_prime_broadcast: 49,
  fx_phantom_dash: 49,
  fx_golden_confetti: 49,
  fx_vhs_card_frame: 49,
  fighter_lucien: 249,
  // 1.9.5 — approved 06.11.2026 (SHOP_PRICE_STATUS, Р-18)
  skin_nika_stage_idol: 149,
  skin_vega_star_pilot: 149,
  fx_studio_spotlights: 69,
  fx_neon_fireworks: 69,
  fx_glitch_dash: 59,
  fx_comet_trail: 59,
  fx_arcade_frame: 49,
  fx_holo_foil: 49,
  season_halloween_cards: 49,
  season_spooky_broadcast: 49,
  season_pumpkin_victory: 59,
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
  skin_nika_stage_idol: 10,
  skin_vega_star_pilot: 10,
  fx_studio_spotlights: 10,
  fx_neon_fireworks: 10,
  fx_glitch_dash: 10,
  fx_comet_trail: 10,
  fx_arcade_frame: 10,
  fx_holo_foil: 10,
  season_halloween_cards: 10,
  season_spooky_broadcast: 10,
  season_pumpkin_victory: 10,
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
 * This release MAY sell for real money (1.8.9: the owner's decision to open PRIME SHOP to every PRIME ID).
 * It opens nothing by itself: the PRIME NETWORK server decides — its live payment mode (with the receipt) AND
 * its own sales switch. Closing that switch stops new orders at once; paid orders are still delivered.
 */
export const SHOP_SALES_OPEN = true;

/**
 * Alpha 1.8.9.5 — purchases by PRIME IDs aged 14–17 (LIVE). The server sells to them ONLY when its own switch
 * PRIME_SHOP_MINORS=on is set AND the offer in force says so (its registry entry `minors: true`, offer.config.ts);
 * otherwise every buyer under 18 is refused («adult_only»), as before. Then: cosmetics and skins only (never a
 * fighter), at most `itemMaxRub` an item, at most `per30DaysRub` in all over 30 days (orders paid, delivered, under
 * review or being refunded, and orders waiting for payment while they can still be paid; failed, expired, cancelled
 * and refunded ones do not count — lib/checkout.js minorSpend). Approved by the owner on 29.10.2026 (offer revision 3,
 * section 5): a ceiling for the catalogue, not the price of any item — and not a statement that every purchase within
 * it is a small everyday transaction.
 */
// 1.9.4: the limits of offer revisions without their own (1–3); a revision may carry its own (offer.config.ts minorLimits)
export const MINOR_PURCHASES = { itemMaxRub: 299, per30DaysRub: 1500 } as const;

// (1.8.8 stage 3: the public offer moved to src/config/offer.config.ts — revisions with their date
// and the hash of the published text, not a bare address.)
