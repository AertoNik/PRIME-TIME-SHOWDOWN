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
  | 'frame_legendary';

/** Where an item comes from — the collection's categories. */
export type CosmeticSource = 'season' | 'boss' | 'career';

export interface CosmeticDef {
  id: CosmeticId;
  slot: CosmeticSlot;
  name: string;
  desc: string;
  /** Where the player will see it (shown on the reward card). */
  where: string;
  /** Preview art key (ui/eventArt.ts). */
  art: 'card' | 'frame' | 'phantom' | 'victory' | 'crown' | 'belt' | 'star' | 'studio';
  rarity: 'rare' | 'epic' | 'legendary';
  /** Event (or game mode) that awards it (for the collection's history). */
  eventId: string;
  /** Seasonal event, BOSS FIGHT or the producer career (Alpha 1.5). */
  source: CosmeticSource;
  /** Human name of the source shown in the collection ("Halloween Premiere 2026"). */
  sourceLabel: string;
  /** How to get it, shown on a locked card. */
  howTo: string;
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
    rarity: 'epic',
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
    rarity: 'epic',
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
    desc: 'Победитель легендарного чемпиона Виктора Вейла: золотой титул на табличке бойца и чемпионский победный экран.',
    where: 'Меню и экран победы',
    art: 'belt',
    rarity: 'legendary',
    eventId: 'boss-vale',
    source: 'boss',
    sourceLabel: 'Boss Fight · Виктор Вейл',
    howTo: 'Первая победа над Виктором Вейлом в Boss Fight',
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
  frame_legendary: {
    id: 'frame_legendary',
    slot: 'broadcastFrame',
    name: 'LEGENDARY PRODUCTION',
    desc: 'Золотая студийная рамка трансляции: золотые уголки эфира, табло таймера и табличка бойца в меню.',
    where: 'Экран боя и табличка бойца',
    art: 'studio',
    rarity: 'legendary',
    eventId: 'career',
    source: 'career',
    sourceLabel: 'Карьера продюсера',
    howTo: 'Карьерный этап LEGENDARY PRODUCTION',
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
];

export const COSMETIC_SLOTS: CosmeticSlot[] = ['cardStyle', 'broadcastFrame', 'dashFx', 'victoryFx', 'title'];

export function isCosmeticId(id: unknown): id is CosmeticId {
  return typeof id === 'string' && id in COSMETICS;
}
