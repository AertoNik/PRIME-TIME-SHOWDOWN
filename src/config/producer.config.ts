// Alpha 1.9.0 — PRIME PRODUCER AVATARS: the producer's persona in PRIME ID and PRIME LEAGUE (never a fighter, never a
// fight stat). The one catalogue: the game draws these (src/ui/producerArt.ts), `npm run backend:rules` copies the ids to
// backend/pb_hooks/lib/producer_rules.js and the server accepts nothing else. All items here are FREE; `access` exists
// so later seasonal / reward items can be added without code changes — the server refuses anything not 'free' today.

export type ProducerAccess = 'free' | 'reward' | 'season';

/** The catalogue version (a new item or a changed access = a new number). */
export const PRODUCER_CATALOG_VERSION = 1;
/** Saves of the look per account: at most `changes` in `windowMinutes`. */
export const PRODUCER_LIMIT = { changes: 30, windowMinutes: 10 };

export type HairStyle = 'side' | 'waves_long' | 'afro' | 'pomp' | 'bun' | 'bald' | 'bob' | 'mohawk' | 'braids' | 'swept' | 'pixie' | 'fade' | 'ponytail' | 'curls';
export type Outfit = 'suit_tie' | 'sequin' | 'bomber' | 'blazer_tee' | 'turtleneck' | 'suit_bow' | 'hoodie_blazer';
export type Mouth = 'smile' | 'grin' | 'smirk' | 'laugh' | 'calm' | 'lips';
export type Extra = 'round_glasses' | 'aviators' | 'rect_glasses' | 'headset' | 'hoops' | 'studs' | 'beard' | 'mustache' | 'goatee' | 'beads' | 'pin';

export interface ProducerAvatar {
  id: string;
  ru: string;
  en: string;
  access: ProducerAccess;
  skin: string;
  hair: { style: HairStyle; color: string; shine?: string };
  outfit: { kind: Outfit; color: string; accent: string };
  eyes: 'round' | 'almond' | 'sharp';
  brows: 'arch' | 'flat' | 'bold';
  mouth: Mouth;
  extras: Extra[];
  /** Narrower face (rx) — the silhouette, not a gender rule: anyone picks any producer. */
  face: 'soft' | 'square' | 'oval';
}

export const PRODUCER_AVATARS: ProducerAvatar[] = [
  { id: 'director', ru: 'Режиссёр', en: 'The Director', access: 'free', skin: '#b27a54', hair: { style: 'side', color: '#1d1a24', shine: '#4b4466' }, outfit: { kind: 'suit_tie', color: '#3b2a7a', accent: '#22f0e0' }, eyes: 'almond', brows: 'flat', mouth: 'smile', extras: ['round_glasses'], face: 'square' },
  { id: 'diva', ru: 'Дива прайм-тайма', en: 'Prime-Time Diva', access: 'free', skin: '#f2c9a8', hair: { style: 'waves_long', color: '#8a2f1c', shine: '#c45a34' }, outfit: { kind: 'sequin', color: '#b0287a', accent: '#ffd23a' }, eyes: 'almond', brows: 'arch', mouth: 'lips', extras: ['hoops'], face: 'oval' },
  { id: 'live_wire', ru: 'Голос в наушнике', en: 'Live Wire', access: 'free', skin: '#6b4027', hair: { style: 'afro', color: '#1b1210', shine: '#3d2a22' }, outfit: { kind: 'bomber', color: '#127a86', accent: '#ff7a1a' }, eyes: 'round', brows: 'arch', mouth: 'grin', extras: ['headset'], face: 'soft' },
  { id: 'showman', ru: 'Шоумен', en: 'The Showman', access: 'free', skin: '#f0c39c', hair: { style: 'pomp', color: '#e8b84a', shine: '#fff0a8' }, outfit: { kind: 'blazer_tee', color: '#ff4fa0', accent: '#141030' }, eyes: 'sharp', brows: 'bold', mouth: 'smirk', extras: ['aviators'], face: 'square' },
  { id: 'curator', ru: 'Куратор эфира', en: 'The Curator', access: 'free', skin: '#e8b98c', hair: { style: 'bun', color: '#15131c', shine: '#3e3a52' }, outfit: { kind: 'turtleneck', color: '#16141f', accent: '#ffd23a' }, eyes: 'sharp', brows: 'flat', mouth: 'calm', extras: ['studs'], face: 'oval' },
  { id: 'baron', ru: 'Барон студии', en: 'Studio Baron', access: 'free', skin: '#c08a5c', hair: { style: 'bald', color: '#2a1d16', shine: '#5a4334' }, outfit: { kind: 'suit_bow', color: '#1d1438', accent: '#ffd23a' }, eyes: 'round', brows: 'bold', mouth: 'laugh', extras: ['beard'], face: 'square' },
  { id: 'noir', ru: 'Нуар', en: 'Noir', access: 'free', skin: '#d9a57a', hair: { style: 'bob', color: '#0f0d16', shine: '#4a4565' }, outfit: { kind: 'turtleneck', color: '#5b2bb5', accent: '#22f0e0' }, eyes: 'almond', brows: 'arch', mouth: 'lips', extras: [], face: 'oval' },
  { id: 'circuit', ru: 'Схема', en: 'Circuit', access: 'free', skin: '#f4d6c4', hair: { style: 'mohawk', color: '#13c9c0', shine: '#9dfff5' }, outfit: { kind: 'hoodie_blazer', color: '#2b2f52', accent: '#ff4fd8' }, eyes: 'sharp', brows: 'flat', mouth: 'grin', extras: ['studs'], face: 'soft' },
  { id: 'queen_bee', ru: 'Королева рейтингов', en: 'Ratings Queen', access: 'free', skin: '#4f2e1d', hair: { style: 'braids', color: '#1a1110', shine: '#3a2a24' }, outfit: { kind: 'blazer_tee', color: '#ffd23a', accent: '#3b1e6e' }, eyes: 'almond', brows: 'arch', mouth: 'smile', extras: ['beads', 'hoops'], face: 'oval' },
  { id: 'veteran', ru: 'Ветеран эфира', en: 'On-Air Veteran', access: 'free', skin: '#efc6a6', hair: { style: 'swept', color: '#cfd3e0', shine: '#ffffff' }, outfit: { kind: 'suit_tie', color: '#22263f', accent: '#d8343f' }, eyes: 'round', brows: 'bold', mouth: 'smile', extras: ['mustache', 'pin'], face: 'square' },
  { id: 'spark', ru: 'Искра', en: 'Spark', access: 'free', skin: '#f7dccb', hair: { style: 'pixie', color: '#ff5fa8', shine: '#ffb3d6' }, outfit: { kind: 'bomber', color: '#6b2fd6', accent: '#22f0e0' }, eyes: 'round', brows: 'arch', mouth: 'grin', extras: ['studs'], face: 'soft' },
  { id: 'smooth', ru: 'Бархатный голос', en: 'Smooth Operator', access: 'free', skin: '#5c3622', hair: { style: 'fade', color: '#120c0a', shine: '#3a2a22' }, outfit: { kind: 'turtleneck', color: '#e9e4f5', accent: '#7a5cff' }, eyes: 'almond', brows: 'flat', mouth: 'smirk', extras: ['goatee'], face: 'square' },
  { id: 'floor', ru: 'Шеф площадки', en: 'Floor Chief', access: 'free', skin: '#d8a982', hair: { style: 'ponytail', color: '#5a3420', shine: '#8f5a38' }, outfit: { kind: 'suit_tie', color: '#0f6f7a', accent: '#ffd23a' }, eyes: 'sharp', brows: 'bold', mouth: 'calm', extras: ['headset'], face: 'oval' },
  { id: 'brainstorm', ru: 'Мозговой штурм', en: 'Brainstorm', access: 'free', skin: '#a8714a', hair: { style: 'curls', color: '#24160f', shine: '#5a3d2c' }, outfit: { kind: 'hoodie_blazer', color: '#ff7a1a', accent: '#1a1838' }, eyes: 'round', brows: 'arch', mouth: 'smile', extras: ['rect_glasses'], face: 'soft' },
];

export interface ProducerFrame {
  id: string;
  ru: string;
  en: string;
  access: ProducerAccess;
}
export const PRODUCER_FRAMES: ProducerFrame[] = [
  { id: 'studio', ru: 'Студия', en: 'Studio', access: 'free' },
  { id: 'neon', ru: 'Неон', en: 'Neon', access: 'free' },
  { id: 'onair', ru: 'В эфире', en: 'On Air', access: 'free' },
  { id: 'prime', ru: 'Прайм', en: 'Prime', access: 'free' },
];

export interface ProducerBackdrop {
  id: string;
  ru: string;
  en: string;
  access: ProducerAccess;
}
export const PRODUCER_BACKDROPS: ProducerBackdrop[] = [
  { id: 'violet', ru: 'Фиолетовый эфир', en: 'Violet Air', access: 'free' },
  { id: 'cyan', ru: 'Бирюзовый прожектор', en: 'Cyan Spotlight', access: 'free' },
  { id: 'sunset', ru: 'Закатный неон', en: 'Sunset Neon', access: 'free' },
  { id: 'night', ru: 'Ночная студия', en: 'Night Studio', access: 'free' },
];

export interface ProducerLook {
  avatar: string;
  frame: string;
  backdrop: string;
}

/** A stable default for an account that never chose (the same on every device): from its id, among the free items. */
export function defaultLook(seed: string): ProducerLook {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  const free = PRODUCER_AVATARS.filter((a) => a.access === 'free');
  return { avatar: free[h % free.length].id, frame: 'studio', backdrop: PRODUCER_BACKDROPS[(h >>> 8) % PRODUCER_BACKDROPS.length].id };
}

export const avatarById = (id: string) => PRODUCER_AVATARS.find((a) => a.id === id) ?? null;
