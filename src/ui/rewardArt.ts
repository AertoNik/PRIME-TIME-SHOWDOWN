import type { QuestDef } from '../config/events.config';
import type { AchievementView } from '../meta/Collection';
import { artImg, registerFallback } from './artIcons';
import { ICONS, REWARD_ART } from './eventArt';
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

/** The emblem of a reward section at `size` CSS px. */
export function rewardSectionArt(id: RewardSection, size: number, cls = ''): string {
  return artImg('rewards', id, size, { cls: `rw-art ${cls}`, fb: `rw|${id}` });
}

registerFallback('rw', ([id]) => `<span class="rw-art-old">${(REWARD_OLD[id as RewardSection] ?? REWARD_OLD.collection)()}</span>`);

/** Seasonal goal → picture id (events.config.ts goal ids). The other goals keep their icons until Beta 2.1. */
export const GOAL_ART: Readonly<Record<string, string>> = {
  // «Дебют в эфире»: the season's first goal on air
  first_night: 'debut',
  first_snow: 'debut',
  // «Мастер комбо»: the season's combo goal
  combo_carnival: 'combo',
  garland_combo: 'combo',
};

/** A seasonal goal's icon: the owner's picture where there is one, else the goal's 1.x icon. */
export function goalArt(q: Pick<QuestDef, 'id' | 'icon'>, size: number): string {
  const id = GOAL_ART[q.id];
  return id ? artImg('goals', id, size, { cls: 'goal-art', fb: `goal|${q.icon}` }) : ICONS[q.icon];
}

registerFallback('goal', ([icon]) => ICONS[icon as QuestDef['icon']] ?? '');
