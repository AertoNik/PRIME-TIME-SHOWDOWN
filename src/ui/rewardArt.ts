import type { GoalId } from '../config/career';
import type { AchievementView } from '../meta/Collection';
import { artImg, registerFallback } from './artIcons';
import { REWARD_ART } from './eventArt';
import { UI_ICONS } from './icons';
import { MODE_ICONS } from './modeArt';

// Beta 2.0 (final) — the owner's pictures of EXISTING achievements, reward sections and seasonal goals
// (PRIME_TIME_2_0_EFFECT_PREVIEWS → scripts/art/prepare_art.py → public/ui/{achievements,rewards,goals}/…).
// Only pictures change: no achievement, reward, goal or condition is added, and the records stay where they were.
// Anything without a picture keeps its 1.x drawing, which is also the fallback when a file fails to load.

/** Achievement kind → picture id (the ids of Collection.achievements(): boss-<id>, survival-clear, challenge-<id>). */
const ACH_ART: Readonly<Record<string, string>> = {
  survival: 'survival',
  energy_rush: 'energy_rush',
  high_stakes: 'high_stakes',
  spotlight: 'spotlight',
  boss: 'boss',
};

/** The picture id of an achievement, or null (the career stages draw their own stage emblem). */
export function achievementArtId(a: Pick<AchievementView, 'id'>): string | null {
  // Beta 2.2: the career stage PRIME TIME STAR (achievement_prime_time_star.png). Mini hotfix: RISING BROADCAST and
  // LEGENDARY PRODUCTION keep their stage emblems — achievement_prime_legend.png is the PRIME LEGEND achievement below
  if (a.id === 'career-star') return 'career_star';
  // Beta 2.2 mini hotfix: «Победитель легенды» (BOSS FIGHT vs Victor «Legend» Vale — its reward is the title PRIME
  // LEGEND) wears the owner's PRIME LEGEND achievement picture; the title itself wears title_prime_legend.png
  if (a.id === 'boss-vale') return 'prime_legend';
  // Beta 2.2 final (PRIME_TIME_2_3_WINTER_COLLECTION_ART): «Комбо-шоу» and «Пять чемпионских эфиров»; Beta 2.3
  // (PRIME_TIME_2_3_UI_MODE_ART_REFINED): the other two MASTERY achievements — «Полный состав» (achievement_full_roster)
  // and «Идеальный эфир» (achievement_perfect_broadcast; PRIME LEAGUE's defence style PRIME BALANCE shares that Russian
  // name but is not an achievement and keeps its own sign)
  if (a.id === 'mastery-combo') return 'mastery_combo';
  if (a.id === 'mastery-champion') return 'mastery_champion';
  if (a.id === 'mastery-roster') return 'mastery_roster';
  if (a.id === 'mastery-rating') return 'mastery_rating';
  // Beta 2.3: the career stage RISING BROADCAST's achievement (achievement_career_rising_broadcast); the stage keeps its
  // emblem on the career screen, LEGENDARY PRODUCTION keeps its emblem everywhere
  if (a.id === 'career-rising') return 'career_rising';
  if (a.id.startsWith('boss-')) return ACH_ART.boss;
  if (a.id === 'survival-clear') return ACH_ART.survival;
  if (a.id.startsWith('challenge-')) return ACH_ART[a.id.slice(10)] ?? null;
  return null;
}

/** The 1.x drawing of an achievement kind (the fallback). */
function achievementOld(art: string): string {
  if (art === 'survival') return MODE_ICONS.survival;
  if (art === 'challenge') return MODE_ICONS.challenge;
  return art === 'belt' || art === 'star' || art === 'studio' ? REWARD_ART[art] : REWARD_ART.star;
}

/** An achievement's picture at `size` CSS px (null when it has none: the caller draws the old art). */
export function achievementArt(a: Pick<AchievementView, 'id' | 'art' | 'title'>, size: number, cls = ''): string | null {
  const id = achievementArtId(a);
  return id ? artImg('achievements', id, size, { cls: `ach-art ${cls}`, fb: `ach|${a.art}` }) : null;
}

registerFallback('ach', ([art]) => `<span class="ach-art-old">${achievementOld(art ?? '')}</span>`);

/** The sections of rewards in MY COLLECTION: the whole section and its three sources (CosmeticDef.source). */
export type RewardSection = 'collection' | 'career' | 'boss' | 'daily';

const REWARD_OLD: Record<RewardSection, () => string> = {
  collection: () => REWARD_ART.belt,
  career: () => UI_ICONS.trophy,
  boss: () => REWARD_ART.belt,
  daily: () => UI_ICONS.gift,
};

/**
 * Beta 2.2 final: the reward CATEGORY «Карьера продюсера» wears the owner's v3 emblem (reward_career_emblem_v3.png →
 * rewards/career_producer). The earlier `rewards/career` file stays where it was; the mode button «Карьера» is another
 * picture (modes/career) and is not touched.
 */
const REWARD_SECTION_PIC: Partial<Record<RewardSection, string>> = { career: 'career_producer' };

/** The emblem of a reward section at `size` CSS px. */
export function rewardSectionArt(id: RewardSection, size: number, cls = ''): string {
  return artImg('rewards', REWARD_SECTION_PIC[id] ?? id, size, { cls: `rw-art ${cls}`, fb: `rw|${id}` });
}

registerFallback('rw', ([id]) => `<span class="rw-art-old">${(REWARD_OLD[id as RewardSection] ?? REWARD_OLD.collection)()}</span>`);

/**
 * The career's «Цели сезона» (career.ts GOALS — the eight goals of the Career screen) → picture id. Beta 2.1: the two
 * pictures the owner prepared for «Дебют в эфире» and «Мастер комбо» belong HERE — Beta 2.0 had put them on the winter
 * event's quests by mistake (the event opens on 02.12, so no player saw them there). The six other goals keep their icon
 * until their pictures are ready.
 */
export const CAREER_GOAL_ART: Readonly<Partial<Record<GoalId, string>>> = {
  first_win: 'debut',
  combo_3: 'combo',
  // Beta 2.2 (PRIME_TIME_2_2_ART_ASSETS): the other six — all eight goals have the owner's picture now
  rating_70: 'golden_rating', // «Золотая звезда стремительного роста.png»: a gold star over a rising rating chart
  perfect_3: 'perfect_timing',
  fans_2500: 'rising_star', // the crowd under the rising star: the fans
  sign_second: 'roster_expansion',
  pro_win: 'big_league',
  champion_win: 'prime_time_champion',
};

/** A career goal's picture (`null` when it has none yet — the screen draws its usual icon). */
export function careerGoalArt(id: GoalId, size: number, cls = ''): string | null {
  const pic = CAREER_GOAL_ART[id];
  return pic ? artImg('goals', pic, size, { cls: `goal-art ${cls}`, fb: `goal|${id}` }) : null;
}

registerFallback('goal', () => UI_ICONS.star);

// ------------------------------------------------------------------ Beta 2.2
/** MY COLLECTION's sections with the owner's emblem (the overview's cards and the sections' heads). */
export type CollectionSection = 'shop' | 'achievements' | 'seasons' | 'league' | 'rewards';

/** A section's emblem at `size` CSS px; `old` is the drawing it replaces — shown again if the file fails to load. */
export function sectionArt(id: CollectionSection, size: number, cls = ''): string {
  return artImg('sections', id, size, { cls: `sec-art ${cls}`, fb: `sec|${id}|${size}` });
}

const SECTION_OLD = new Map<string, (size: number) => string>();
/** The previous drawing of a section (registered by the screen that drew it, so this module imports no screen art). */
export function registerSectionFallback(id: CollectionSection, draw: (size: number) => string): void {
  SECTION_OLD.set(id, draw);
}
registerFallback('sec', ([id, size]) => SECTION_OLD.get(id)?.(Number(size) || 44) ?? '');

/**
 * The PRIME LEAGUE road's titles (league.config.ts track — the server sends the same strings) → picture id. A title the
 * game has no picture for keeps the crown.
 */
export const LEAGUE_TITLE_ART: Readonly<Record<string, string>> = {
  'ON AIR': 'on_air',
  'ГОЛОС ЭФИРА': 'voice_of_air',
  'ПРАЙМ-ТАЙМ': 'prime_time',
};

/** A league road title's picture (null: no picture — the caller draws its usual crown). */
export function leagueTitleArt(title: string, size: number, cls = ''): string | null {
  const id = LEAGUE_TITLE_ART[title];
  return id ? artImg('titles', id, size, { cls: `title-art ${cls}`, alt: title, fb: 'ltitle' }) : null;
}
registerFallback('ltitle', () => UI_ICONS.trophy);

// ------------------------------------------------------------------ Beta 2.2 final
/**
 * The DAILY PRIME STREAK gift in its winter dress (WINTER_DAILY_REWARD_GIFT.png) — only while the winter theme is on
 * (WINTER SHOWDOWN's dates; the dev preview of its theme): the menu's gift button, the DAILY window's «today» gift and
 * its reveal. Nothing else changes — the reward, the streak and the server's answer are the same as all year.
 * null outside winter: the caller keeps the usual gift.
 */
export function winterGiftArt(g: { events: { themeId: string } }, size: number, cls = ''): string | null {
  return g.events.themeId === 'winter' ? artImg('winter', 'daily_gift', size, { cls: `gift-art ${cls}`, fb: 'giftw' }) : null;
}
registerFallback('giftw', () => UI_ICONS.gift);
