// Cosmetic items. They are free, earned in-game and outlive the event that gave
// them. Each item fills one slot; the game reads only the equipped id per slot:
//   cardStyle      -> data-card-style on <html>          (styles/main.css)
//   broadcastFrame -> data-frame on <html>               (battle HUD frame, menu plate)
//   dashFx         -> BattleView: colour of the player's DASH trail/afterimages
//   victoryFx      -> BattleView: celebration when the player wins
//   title          -> menu nameplate + results screen styling
// Adding an item: add it here, then give it a look in the matching place above.
// Ownership lives in one place — save.cosmetics (owned / equipped / history), managed
// by src/meta/Collection.ts. Events, BOSS FIGHT and the career only *grant* items;
// MY COLLECTION shows and equips them (Alpha 1.5).

export type CosmeticSlot = 'cardStyle' | 'broadcastFrame' | 'dashFx' | 'victoryFx' | 'title';

export type CosmeticId =
  | 'card_pumpkin'
  | 'frame_spooky'
  | 'dash_phantom'
  | 'victory_pumpkin'
  | 'title_halloween_champion'
  | 'title_prime_legend'
  // Alpha 1.5: producer career rewards
  | 'title_prime_star'
  | 'frame_legendary'
  // Alpha 1.8.8: PRIME SHOP items (paid — owned only through a confirmed purchase, see `paid`)
  | 'frame_prime_broadcast'
  | 'dash_prime_phantom'
  | 'victory_golden_confetti'
  | 'card_vhs'
  // Alpha 1.9.5: PRIME SHOP effects, part 1
  | 'victory_studio_spotlights'
  | 'victory_neon_fireworks'
  | 'dash_glitch'
  | 'dash_comet'
  | 'frame_arcade'
  | 'card_holo'
  // Alpha 1.9.6: DAILY STREAK milestones (earned — the PRIME NETWORK server confirms the milestone)
  | 'title_daily_regular'
  | 'frame_daily_live'
  | 'victory_daily_sunrise'
  // Alpha 1.9.6: PRIME LEAGUE exchange for PRIME TOKENS (earned — the server's token ledger confirms it)
  | 'card_league_ranked'
  | 'dash_league_arc'
  | 'frame_league_arena';

/**
 * Where an item comes from — the collection's categories (1.8.8: 'shop' — PRIME SHOP; 1.9.6: 'daily' — a DAILY STREAK
 * milestone, 'league' — the PRIME LEAGUE exchange for PRIME TOKENS). 'daily' and 'league' items are never sold and never
 * granted by the game alone: the server names them (DAILY status, league /me) and refuses a cloud save that lists one
 * the account has not earned (lib/earned.js).
 */
export type CosmeticSource = 'season' | 'boss' | 'career' | 'shop' | 'daily' | 'league';

/**
 * Alpha 1.9.5 — the four tiers of rarity, the same for cosmetics and PRIME SHOP skins. Cosmetic only: a tier never
 * changes a fighter, a card, a reward or a price.
 */
export type Rarity = 'uncommon' | 'rare' | 'epic' | 'legendary';
export const RARITY_ORDER: Rarity[] = ['uncommon', 'rare', 'epic', 'legendary'];
export const RARITY_LABEL: Record<Rarity, string> = { uncommon: 'Необычный', rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный' };

export interface CosmeticDef {
  id: CosmeticId;
  slot: CosmeticSlot;
  name: string;
  desc: string;
  /** Where the player will see it (shown on the reward card). */
  where: string;
  /** Preview art key (ui/eventArt.ts). */
  art: 'card' | 'frame' | 'phantom' | 'victory' | 'crown' | 'belt' | 'star' | 'studio';
  rarity: Rarity;
  /** Event (or game mode) that awards it (for the collection's history). */
  eventId: string;
  /** Seasonal event, BOSS FIGHT or the producer career (Alpha 1.5). */
  source: CosmeticSource;
  /** Human name of the source shown in the collection ("Halloween Premiere 2026"). */
  sourceLabel: string;
  /** How to get it, shown on a locked card. */
  howTo: string;
  /**
   * Alpha 1.5.5: a personal reward — it belongs to each fighter who earned it (a fighter who
   * has not earned it cannot wear it). Common producer items leave this unset.
   */
  personal?: boolean;
  /**
   * Alpha 1.8.8: a PRIME SHOP item. Never granted by the game and never stored in
   * save.cosmetics (the server refuses it there): ownership comes only from confirmed purchases
   * (src/meta/Shop.ts — the PRIME NETWORK server will be the source of truth), the player's choice
   * to wear it lives apart in save.shop.equip.
   */
  paid?: boolean;
}

export const COSMETICS: Record<CosmeticId, CosmeticDef> = {
  card_pumpkin: {
    id: 'card_pumpkin',
    slot: 'cardStyle',
    name: 'HALLOWEEN CARD STYLE',
    desc: 'Тыквенные рамки, паутинка и фиолетовое свечение для всех карт.',
    where: 'Карты в бою и в колоде',
    art: 'card',
    rarity: 'rare',
    eventId: 'halloween-2026',
    source: 'season',
    sourceLabel: 'Halloween Premiere 2026',
    howTo: 'Обмен на 120 PUMPKIN TOKENS во время Halloween Premiere',
  },
  dash_phantom: {
    id: 'dash_phantom',
    slot: 'dashFx',
    name: 'PURPLE PHANTOM',
    desc: 'DASH вашего бойца оставляет фиолетовый призрачный след и зелёные искры.',
    where: 'Рывок DASH в бою',
    art: 'phantom',
    rarity: 'rare',
    eventId: 'halloween-2026',
    source: 'season',
    sourceLabel: 'Halloween Premiere 2026',
    howTo: 'Обмен на 150 PUMPKIN TOKENS во время Halloween Premiere',
  },
  frame_spooky: {
    id: 'frame_spooky',
    slot: 'broadcastFrame',
    name: 'SPOOKY BROADCAST',
    desc: 'Рамка трансляции в стиле Halloween Special: уголки эфира, плашка LIVE и табличка бойца в меню.',
    where: 'Экран боя и табличка бойца',
    art: 'frame',
    rarity: 'rare',
    eventId: 'halloween-2026',
    source: 'season',
    sourceLabel: 'Halloween Premiere 2026',
    howTo: 'Обмен на 180 PUMPKIN TOKENS во время Halloween Premiere',
  },
  victory_pumpkin: {
    id: 'victory_pumpkin',
    slot: 'victoryFx',
    name: 'PUMPKIN VICTORY',
    desc: 'При победе над ареной взлетают светящиеся тыквы и праздничное конфетти.',
    where: 'Победа в бою',
    art: 'victory',
    rarity: 'epic',
    eventId: 'halloween-2026',
    source: 'season',
    sourceLabel: 'Halloween Premiere 2026',
    howTo: 'Обмен на 220 PUMPKIN TOKENS во время Halloween Premiere',
  },
  title_halloween_champion: {
    id: 'title_halloween_champion',
    slot: 'title',
    name: 'HALLOWEEN CHAMPION',
    desc: 'Главный приз сезона: титул на табличке бойца и эксклюзивный победный экран.',
    where: 'Меню и экран победы',
    art: 'crown',
    rarity: 'legendary',
    eventId: 'halloween-2026',
    source: 'season',
    sourceLabel: 'Halloween Premiere 2026',
    howTo: 'Главный приз: выполните 6 заданий Halloween Premiere',
  },
  // Alpha 1.3.1: awarded once for the first win in BOSS FIGHT (not tied to a season)
  title_prime_legend: {
    id: 'title_prime_legend',
    slot: 'title',
    name: 'PRIME LEGEND',
    desc: 'Победитель легендарного чемпиона Виктора Вейла: золотой титул на табличке бойца и чемпионский победный экран. Личная награда: её носит только тот боец, который сам победил легенду.',
    where: 'Меню и экран победы этого бойца',
    art: 'belt',
    rarity: 'legendary',
    eventId: 'boss-vale',
    source: 'boss',
    sourceLabel: 'Boss Fight · Виктор Вейл',
    howTo: 'Победите Виктора Вейла в Boss Fight этим бойцом',
    personal: true,
  },
  // Alpha 1.5: producer career milestones (CareerSystem stages)
  title_prime_star: {
    id: 'title_prime_star',
    slot: 'title',
    name: 'PRIME TIME STAR',
    desc: 'Ваше шоу — звезда прайм-тайма: неоновый титул на табличке бойца и победный экран со звёздной лентой.',
    where: 'Меню и экран победы',
    art: 'star',
    rarity: 'epic',
    eventId: 'career',
    source: 'career',
    sourceLabel: 'Карьера продюсера',
    howTo: 'Карьерный этап PRIME TIME STAR',
  },
  // ------------------------------------------------ Alpha 1.8.8: PRIME SHOP (paid, see `paid`)
  frame_prime_broadcast: {
    id: 'frame_prime_broadcast',
    slot: 'broadcastFrame',
    name: 'PRIME BROADCAST',
    desc: 'Премиальная рамка трансляции PRIME NETWORK: фиолетово-бирюзовые неоновые линии, угловые метки и плашка ON AIR.',
    where: 'Рамка трансляции в бою',
    art: 'frame',
    rarity: 'rare',
    eventId: 'prime-shop',
    source: 'shop',
    sourceLabel: 'PRIME SHOP',
    howTo: 'PRIME SHOP',
    paid: true,
  },
  dash_prime_phantom: {
    id: 'dash_prime_phantom',
    slot: 'dashFx',
    name: 'PHANTOM DASH',
    desc: 'Рывок оставляет фиолетовый голографический след с бирюзовым послесвечением и мягко тающими частицами.',
    where: 'Рывок DASH в бою',
    art: 'phantom',
    rarity: 'rare',
    eventId: 'prime-shop',
    source: 'shop',
    sourceLabel: 'PRIME SHOP',
    howTo: 'PRIME SHOP',
    paid: true,
  },
  victory_golden_confetti: {
    id: 'victory_golden_confetti',
    slot: 'victoryFx',
    name: 'GOLDEN CONFETTI',
    desc: 'Победу бойца встречает торжественный залп золотого конфетти и золотое кольцо света.',
    where: 'Победа в бою',
    art: 'victory',
    rarity: 'rare',
    eventId: 'prime-shop',
    source: 'shop',
    sourceLabel: 'PRIME SHOP',
    howTo: 'PRIME SHOP',
    paid: true,
  },
  card_vhs: {
    id: 'card_vhs',
    slot: 'cardStyle',
    name: 'VHS CARD FRAME',
    desc: 'Рамки карт в стиле VHS-кассет: этикетка, полосы трекинга и розово-бирюзовый неон. Читаемость карт сохранена.',
    where: 'Карты в бою и в колоде',
    art: 'card',
    rarity: 'rare',
    eventId: 'prime-shop',
    source: 'shop',
    sourceLabel: 'PRIME SHOP',
    howTo: 'PRIME SHOP',
    paid: true,
  },
  // ------------------------------------------------ Alpha 1.9.5: PRIME SHOP effects, part 1 (paid)
  victory_studio_spotlights: {
    id: 'victory_studio_spotlights',
    slot: 'victoryFx',
    name: 'STUDIO SPOTLIGHTS',
    desc: 'Победу встречают прожекторы студии: четыре луча сходятся на бойце, на полу загорается световой круг, вокруг щёлкают вспышки фотокамер.',
    where: 'Победа в бою',
    art: 'victory',
    rarity: 'epic',
    eventId: 'prime-shop',
    source: 'shop',
    sourceLabel: 'PRIME SHOP',
    howTo: 'PRIME SHOP',
    paid: true,
  },
  victory_neon_fireworks: {
    id: 'victory_neon_fireworks',
    slot: 'victoryFx',
    name: 'NEON FIREWORKS',
    desc: 'Три неоновых салюта — розовый, бирюзовый и фиолетовый — взлетают над победителем и рассыпаются медленно гаснущими искрами.',
    where: 'Победа в бою',
    art: 'victory',
    rarity: 'epic',
    eventId: 'prime-shop',
    source: 'shop',
    sourceLabel: 'PRIME SHOP',
    howTo: 'PRIME SHOP',
    paid: true,
  },
  dash_glitch: {
    id: 'dash_glitch',
    slot: 'dashFx',
    name: 'GLITCH DASH',
    desc: 'Рывок как сбой трансляции: силуэт двоится в розовом и бирюзовом, мигают помехи, на пути остаются цифровые «пиксели».',
    where: 'Рывок DASH в бою',
    art: 'phantom',
    rarity: 'rare',
    eventId: 'prime-shop',
    source: 'shop',
    sourceLabel: 'PRIME SHOP',
    howTo: 'PRIME SHOP',
    paid: true,
  },
  dash_comet: {
    id: 'dash_comet',
    slot: 'dashFx',
    name: 'COMET TRAIL',
    desc: 'Рывок кометой: яркая вспышка в точке прибытия, сужающийся огненный шлейф и тёплые искры, медленно оседающие на пол.',
    where: 'Рывок DASH в бою',
    art: 'phantom',
    rarity: 'rare',
    eventId: 'prime-shop',
    source: 'shop',
    sourceLabel: 'PRIME SHOP',
    howTo: 'PRIME SHOP',
    paid: true,
  },
  frame_arcade: {
    id: 'frame_arcade',
    slot: 'broadcastFrame',
    name: 'ARCADE CABINET',
    desc: 'Рамка трансляции в стиле игрового автомата 80-х: пиксельные углы, табло PLAYER 1 и тёплый неон. HUD и бойцы не перекрываются.',
    where: 'Рамка трансляции в бою',
    art: 'frame',
    rarity: 'rare',
    eventId: 'prime-shop',
    source: 'shop',
    sourceLabel: 'PRIME SHOP',
    howTo: 'PRIME SHOP',
    paid: true,
  },
  card_holo: {
    id: 'card_holo',
    slot: 'cardStyle',
    name: 'HOLO FOIL',
    desc: 'Рамки карт с переливающейся голографической фольгой и бликом по краю. Название, стоимость и метки комбо читаются как прежде.',
    where: 'Карты в бою и в колоде',
    art: 'card',
    rarity: 'uncommon',
    eventId: 'prime-shop',
    source: 'shop',
    sourceLabel: 'PRIME SHOP',
    howTo: 'PRIME SHOP',
    paid: true,
  },
  frame_legendary: {
    id: 'frame_legendary',
    slot: 'broadcastFrame',
    name: 'LEGENDARY PRODUCTION',
    desc: 'Золотая студийная рамка трансляции: золотые уголки эфира, табло таймера и табличка бойца в меню.',
    where: 'Экран боя и табличка бойца',
    art: 'studio',
    rarity: 'rare',
    eventId: 'career',
    source: 'career',
    sourceLabel: 'Карьера продюсера',
    howTo: 'Карьерный этап LEGENDARY PRODUCTION',
  },
  // ------------------------------------------------ Alpha 1.9.6: DAILY STREAK milestones
  title_daily_regular: {
    id: 'title_daily_regular',
    slot: 'title',
    name: 'ЕЖЕДНЕВНЫЙ ЭФИР',
    desc: 'Неделя эфиров подряд: бирюзовый титул с мигающей отметкой LIVE на табличке бойца и бирюзовая лента на экране победы.',
    where: 'Меню и экран победы',
    art: 'star',
    rarity: 'uncommon',
    eventId: 'daily',
    source: 'daily',
    sourceLabel: 'Ежедневный эфир',
    howTo: 'Серия «Ежедневного эфира»: 7 дней',
  },
  frame_daily_live: {
    id: 'frame_daily_live',
    slot: 'broadcastFrame',
    name: 'ЭФИР БЕЗ ПЕРЕРЫВА',
    desc: 'Месяц в эфире: рамка трансляции с бирюзово-коралловыми уголками и делениями календаря, табло таймера «ON AIR · DAILY» и табличка бойца.',
    where: 'Экран боя и табличка бойца',
    art: 'frame',
    rarity: 'epic',
    eventId: 'daily',
    source: 'daily',
    sourceLabel: 'Ежедневный эфир',
    howTo: 'Серия «Ежедневного эфира»: 30 дней',
  },
  victory_daily_sunrise: {
    id: 'victory_daily_sunrise',
    slot: 'victoryFx',
    name: 'РАССВЕТ ПРАЙМ-ТАЙМА',
    desc: 'Сто дней в эфире: над победителем поднимается коралловое солнце студии, расходятся кольца и лучи, сверху опускаются тёплые искры.',
    where: 'Победа в бою',
    art: 'victory',
    rarity: 'legendary',
    eventId: 'daily',
    source: 'daily',
    sourceLabel: 'Ежедневный эфир',
    howTo: 'Серия «Ежедневного эфира»: 100 дней',
  },
  // ------------------------------------------------ Alpha 1.9.6: PRIME LEAGUE exchange (PRIME TOKENS)
  card_league_ranked: {
    id: 'card_league_ranked',
    slot: 'cardStyle',
    name: 'RANKED CARDS',
    desc: 'Рамки карт рейтингового эфира: тёмная сталь, серебряная кромка и голубая полоса ранга. Название, стоимость и метки комбо читаются как прежде.',
    where: 'Карты в бою и в колоде',
    art: 'card',
    rarity: 'rare',
    eventId: 'league',
    source: 'league',
    sourceLabel: 'PRIME LEAGUE',
    howTo: 'Обмен в PRIME LEAGUE: 500 PRIME TOKENS',
  },
  dash_league_arc: {
    id: 'dash_league_arc',
    slot: 'dashFx',
    name: 'ARC SURGE',
    desc: 'DASH оставляет серебристо-голубой след с электрическими разрядами вдоль пути. Только внешний вид: дальность и неуязвимость рывка не меняются.',
    where: 'Рывок DASH в бою',
    art: 'phantom',
    rarity: 'epic',
    eventId: 'league',
    source: 'league',
    sourceLabel: 'PRIME LEAGUE',
    howTo: 'Обмен в PRIME LEAGUE: 900 PRIME TOKENS',
  },
  frame_league_arena: {
    id: 'frame_league_arena',
    slot: 'broadcastFrame',
    name: 'RANKED ARENA',
    desc: 'Рамка трансляции рейтингового финала: серебро и холодный синий, угловые метки дивизионов, табло таймера «RANKED» и табличка бойца.',
    where: 'Экран боя и табличка бойца',
    art: 'studio',
    rarity: 'epic',
    eventId: 'league',
    source: 'league',
    sourceLabel: 'PRIME LEAGUE',
    howTo: 'Обмен в PRIME LEAGUE: 1 600 PRIME TOKENS',
  },
};

/** Slot names for the collection cards. */
export const SLOT_LABELS: Record<CosmeticSlot, string> = {
  cardStyle: 'Оформление карт',
  broadcastFrame: 'Рамка трансляции',
  dashFx: 'Эффект способности',
  victoryFx: 'Эффект победы',
  title: 'Титул',
};

/** Display order in the collection. */
export const COSMETIC_ORDER: CosmeticId[] = [
  'title_prime_legend',
  'frame_legendary',
  'title_prime_star',
  'title_halloween_champion',
  'victory_pumpkin',
  'frame_spooky',
  'dash_phantom',
  'card_pumpkin',
  // Alpha 1.8.8: PRIME SHOP — shown in MY COLLECTION only once really owned
  'frame_prime_broadcast',
  'dash_prime_phantom',
  'victory_golden_confetti',
  'card_vhs',
  // Alpha 1.9.5
  'victory_studio_spotlights',
  'victory_neon_fireworks',
  'dash_glitch',
  'dash_comet',
  'frame_arcade',
  'card_holo',
  // Alpha 1.9.6: earned — shown in MY COLLECTION once the server confirms them
  'title_daily_regular',
  'frame_daily_live',
  'victory_daily_sunrise',
  'card_league_ranked',
  'dash_league_arc',
  'frame_league_arena',
];

/** Alpha 1.9.6: items whose ownership the PRIME NETWORK server proves (a DAILY STREAK milestone or a PRIME LEAGUE exchange). */
export function isServerEarned(id: CosmeticId): boolean {
  const s = COSMETICS[id].source;
  return s === 'daily' || s === 'league';
}

export const COSMETIC_SLOTS: CosmeticSlot[] = ['cardStyle', 'broadcastFrame', 'dashFx', 'victoryFx', 'title'];

export function isCosmeticId(id: unknown): id is CosmeticId {
  return typeof id === 'string' && id in COSMETICS;
}

/** Alpha 1.8.8: an item the game itself grants and saves (everything but the PRIME SHOP items). */
export function isGameCosmeticId(id: unknown): id is CosmeticId {
  return isCosmeticId(id) && !COSMETICS[id].paid;
}
