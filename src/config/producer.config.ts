// Alpha 1.9.0 — PRIME PRODUCER AVATARS: the producer's persona in PRIME ID and PRIME LEAGUE (never a fighter, never a
// fight stat). The one catalogue: the game draws these (src/ui/producerArt.ts), `npm run backend:rules` copies the ids to
// backend/pb_hooks/lib/producer_rules.js and the server accepts nothing else. All items here are FREE; `access` exists
// so later seasonal / reward items can be added without code changes — the server refuses anything not 'free' today.
//
// Alpha 1.9.4 — 3D PORTRAITS: the 19 producers of producer-avatars-new/ (originals kept there; the game ships 128 px and
// 256 px copies in public/producers/) are the catalogue now. The 14 vector producers of 1.9.0 stay as LEGACY: still
// valid ids (a saved look keeps its face on every device, no database migration), never a default and not offered in
// the studio — except the one an account already wears. New ids only: an old id never changes its meaning.
//
// Alpha 1.9.5 — 3D ONLY (the owner's decision): the game shows and offers nothing but the 19 portraits. A legacy id that an
// account still has saved stays valid DATA (the server accepts it, nothing in the database changes — an older client keeps
// working) and is SHOWN as its own 3D portrait (LEGACY_PORTRAIT: one portrait per legacy producer, chosen by persona); the
// studio opens on that portrait, and saving there writes the portrait id. The vector drawing left the build.

export type ProducerAccess = 'free' | 'reward' | 'season';

/** The catalogue version (a new item or a changed access = a new number). */
export const PRODUCER_CATALOG_VERSION = 2;
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
  /** Alpha 1.9.4: kept for saved looks only (see the header). */
  legacy?: boolean;
}

/** Alpha 1.9.4 — a 3D portrait: `image` is the file name in public/producers/{128,256}/ (a transparent PNG bust). */
export interface ProducerPortrait {
  id: string;
  ru: string;
  en: string;
  access: ProducerAccess;
  image: string;
  legacy?: undefined;
}

export type ProducerPersona = ProducerAvatar | ProducerPortrait;
export const isPortrait = (a: ProducerPersona): a is ProducerPortrait => 'image' in a;

const portrait = (n: number, ru: string, en: string): ProducerPortrait => {
  const nn = String(n).padStart(2, '0');
  return { id: `portrait_${nn}`, ru, en, access: 'free', image: `avatar-${nn}.png` };
};

export const PRODUCER_PORTRAITS: ProducerPortrait[] = [
  portrait(1, 'Помреж', 'Assistant Director'),
  portrait(2, 'Бунтарь', 'The Rebel'),
  portrait(3, 'Звукорежиссёр', 'Sound Engineer'),
  portrait(4, 'Стажёр студии', 'Studio Intern'),
  portrait(5, 'Конферансье', 'Ringmaster'),
  portrait(6, 'Сценарист', 'Screenwriter'),
  portrait(7, 'Монтажёр', 'The Cutter'),
  portrait(8, 'Сенсация', 'Breaking News'),
  portrait(9, 'Хедлайнер', 'Headliner'),
  portrait(10, 'Ледяной ведущий', 'Ice Host'),
  portrait(11, 'Тёмная лошадка', 'Dark Horse'),
  portrait(12, 'Ведущий шоу', 'Show Host'),
  portrait(13, 'Магнат', 'The Mogul'),
  portrait(14, 'Блогер', 'The Vlogger'),
  portrait(15, 'Тренер', 'The Coach'),
  portrait(16, 'Старая школа', 'Old School'),
  portrait(17, 'Звезда вечера', 'Evening Star'),
  portrait(18, 'Главред', 'Editor-in-Chief'),
  portrait(19, 'Платина', 'Platinum'),
];

/** Alpha 1.9.0 vector producers — LEGACY since 1.9.4 (drawn by src/ui/producerArt.ts for looks saved with them). */
const legacy = (l: ProducerAvatar[]): ProducerAvatar[] => l.map((a) => ({ ...a, legacy: true }));
const VECTOR_PRODUCERS = legacy([
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
]);

/**
 * 1.9.5: the 3D portrait each legacy producer is shown as (one each, never shared; by persona: the assistant director, the
 * diva → the evening star, the voice in the headset → the sound engineer…). Never changes once published.
 */
export const LEGACY_PORTRAIT: Record<string, string> = {
  director: 'portrait_01',
  circuit: 'portrait_02',
  live_wire: 'portrait_03',
  brainstorm: 'portrait_06',
  floor: 'portrait_07',
  spark: 'portrait_08',
  queen_bee: 'portrait_09',
  noir: 'portrait_11',
  showman: 'portrait_12',
  baron: 'portrait_13',
  smooth: 'portrait_15',
  veteran: 'portrait_16',
  diva: 'portrait_17',
  curator: 'portrait_18',
};

/** The whole catalogue (every id the server accepts): the portraits, then the legacy vector producers. */
export const PRODUCER_AVATARS: ProducerPersona[] = [...PRODUCER_PORTRAITS, ...VECTOR_PRODUCERS];
/** What the studio offers and a default is drawn from: free and not legacy. */
export const offeredAvatars = () => PRODUCER_AVATARS.filter((a) => a.access === 'free' && !a.legacy);

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
  const free = offeredAvatars();
  return { avatar: free[h % free.length].id, frame: 'studio', backdrop: PRODUCER_BACKDROPS[(h >>> 8) % PRODUCER_BACKDROPS.length].id };
}

export const avatarById = (id: string): ProducerPersona | null => PRODUCER_AVATARS.find((a) => a.id === id) ?? null;

/**
 * 1.9.5: the 3D portrait the game shows for any saved avatar id — a portrait as itself, a legacy producer as its own
 * portrait (LEGACY_PORTRAIT), anything unknown or damaged as the first portrait. Never a vector drawing, never empty.
 */
export function shownPortrait(id: string): ProducerPortrait {
  const a = avatarById(id);
  if (a && isPortrait(a)) return a;
  const mapped = PRODUCER_PORTRAITS.find((p) => p.id === LEGACY_PORTRAIT[id]);
  return mapped ?? PRODUCER_PORTRAITS[0];
}
