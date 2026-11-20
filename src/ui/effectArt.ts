import { COSMETICS, type CosmeticId } from '../config/cosmetics.config';
import { artImg, registerFallback } from './artIcons';
import { REWARD_ART } from './eventArt';
import { cosmeticDemo } from './styleDemo';

// Beta 2.0 VISUAL EVOLUTION — the owner's 3D previews of the dash and victory effects (PRIME_TIME_2_0_EFFECT_PREVIEWS
// → public/ui/effects/<cosmetic id>.webp). A preview is only a picture of the item: the effect in a fight is the same
// VFX as before (src/render/cosmeticFx.ts), and rarity, price, season and ownership are untouched.
// PURPLE PHANTOM (Halloween) has no new preview and keeps its drawing; RANKED CARDS / RANKED ARENA / the card styles
// and broadcast frames keep their real demonstrations (the buyer sees exactly what he gets).

/** The cosmetics with the owner's preview (spelled out: an item added later never borrows a picture). */
export const EFFECT_ART: Readonly<Partial<Record<CosmeticId, true>>> = {
  dash_prime_phantom: true,
  dash_glitch: true,
  dash_comet: true,
  dash_league_arc: true,
  dash_candy_comet: true,
  victory_golden_confetti: true,
  victory_studio_spotlights: true,
  victory_neon_fireworks: true,
  victory_pumpkin: true,
  victory_midnight_confetti: true,
  // Beta 2.2: DAILY PRIME STREAK's 100-day «РАССВЕТ ПРАЙМ-ТАЙМА» (PRIME_TIME_2_2_ART_ASSETS/reward_prime_dawn.png)
  victory_daily_sunrise: true,
  // Beta 2.4: PRIME INVITE CASE's legendary INVITE SIGNAL (PRIME_TIME_2_2_ART_ASSETS/dash_invite_signal.png); its 1.x-style
  // drawing REWARD_ART.signal stays as the fallback if the picture cannot load
  dash_invite_signal: true,
};

/**
 * Beta 2.2 — cosmetics that are not effects but have the owner's picture (public/ui/titles): DAILY PRIME STREAK's
 * 7-day title «ЕЖЕДНЕВНЫЙ ЭФИР» (reward_daily_broadcast.png). Spelled out like EFFECT_ART.
 */
export const TITLE_ART: Readonly<Partial<Record<CosmeticId, true>>> = {
  title_daily_regular: true,
  // Beta 2.2 final (PRIME_TIME_2_3_WINTER_COLLECTION_ART): BOSS FIGHT's PRIME LEGEND (title_prime_legend.png — not the
  // achievement picture «PRIME LEGEND») and WINTER SHOWDOWN's grand prize WINTER CHAMPION (winter_champion_title.png)
  title_prime_legend: true,
  title_winter_champion: true,
};

/**
 * Beta 2.2 mini hotfix — a title that wears an approved picture made for its own career stage: PRIME TIME STAR (the
 * title the stage «PRIME TIME STAR» gives, `title_prime_star`) shows achievement_prime_time_star.png (achievements/
 * career_star) instead of the 1.x star drawing. Two entities, one approved picture of the same name; nothing else shared.
 */
export const TITLE_PIC_ALIAS: Readonly<Partial<Record<CosmeticId, readonly ['achievements', string]>>> = {
  title_prime_star: ['achievements', 'career_star'],
};

/** A title's picture at `size` CSS px, or null when it has none (the caller keeps its icon). */
export function titlePic(id: CosmeticId, size: number, cls = ''): string | null {
  if (TITLE_ART[id]) return artImg('titles', id, size, { cls: `title-art ${cls}`, alt: '', fb: `fx|${id}` });
  const alias = TITLE_PIC_ALIAS[id];
  return alias ? artImg(alias[0], alias[1], size, { cls: `title-art ${cls}`, alt: '', fb: `fx|${id}` }) : null;
}

export function hasEffectArt(id: string | null | undefined): id is CosmeticId {
  return !!id && !!EFFECT_ART[id as CosmeticId];
}

/** The effect's preview, sized by its box in CSS (`size` only picks a sharp file). */
export function effectImg(id: CosmeticId, size: number, cls = ''): string {
  return artImg('effects', id, size, { cls: `fx-art ${cls}`, alt: COSMETICS[id].name, fb: `fx|${id}` });
}

/**
 * A cosmetic's picture: the owner's preview where there is one, else its 1.x drawing. Beta 2.2 mini hotfix: a broadcast
 * frame or a card style shows its REAL look (styleDemo.ts — the game's own markup and rules, as in PRIME SHOP).
 */
export function cosmeticPic(id: CosmeticId, size: number): string {
  const demo = cosmeticDemo(id, size);
  if (demo) return demo;
  if (TITLE_ART[id]) return artImg('titles', id, size, { cls: 'fx-art fill', alt: COSMETICS[id].name, fb: `fx|${id}` });
  const alias = TITLE_PIC_ALIAS[id];
  if (alias) return artImg(alias[0], alias[1], size, { cls: 'fx-art fill', alt: COSMETICS[id].name, fb: `fx|${id}` });
  return EFFECT_ART[id] ? effectImg(id, size, 'fill') : REWARD_ART[COSMETICS[id].art];
}

registerFallback('fx', ([id]) => {
  const c = COSMETICS[id as CosmeticId];
  return c ? REWARD_ART[c.art] : '';
});
