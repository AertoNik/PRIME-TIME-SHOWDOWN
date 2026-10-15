// Cosmetic items. They are free, earned in-game and outlive the event that gave
// them. Each item fills one slot; the game reads only the equipped id per slot:
//   cardStyle      -> data-card-style on <html>          (styles/main.css)
//   broadcastFrame -> data-frame on <html>               (battle HUD frame, menu plate)
//   dashFx         -> BattleView: colour of the player's DASH trail/afterimages
//   victoryFx      -> BattleView: celebration when the player wins
//   title          -> menu nameplate + results screen styling
// Adding an item: add it here, then give it a look in the matching place above.

export type CosmeticSlot = 'cardStyle' | 'broadcastFrame' | 'dashFx' | 'victoryFx' | 'title';

export type CosmeticId = 'card_pumpkin' | 'frame_spooky' | 'dash_phantom' | 'victory_pumpkin' | 'title_halloween_champion' | 'title_prime_legend';

export interface CosmeticDef {
  id: CosmeticId;
  slot: CosmeticSlot;
  name: string;
  desc: string;
  /** Where the player will see it (shown on the reward card). */
  where: string;
  /** Preview art key (ui/eventArt.ts). */
  art: 'card' | 'frame' | 'phantom' | 'victory' | 'crown' | 'belt';
  rarity: 'rare' | 'epic' | 'legendary';
  /** Event (or game mode) that awards it (for the collection's history). */
  eventId: string;
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
  },
};

export const COSMETIC_SLOTS: CosmeticSlot[] = ['cardStyle', 'broadcastFrame', 'dashFx', 'victoryFx', 'title'];

export function isCosmeticId(id: unknown): id is CosmeticId {
  return typeof id === 'string' && id in COSMETICS;
}
