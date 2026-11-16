import { COSMETICS, type CosmeticId } from '../config/cosmetics.config';
import { artImg, registerFallback } from './artIcons';
import { REWARD_ART } from './eventArt';

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

/** A title's picture at `size` CSS px, or null when it has none (the caller keeps its icon). */
export function titlePic(id: CosmeticId, size: number, cls = ''): string | null {
  return TITLE_ART[id] ? artImg('titles', id, size, { cls: `title-art ${cls}`, alt: '', fb: `fx|${id}` }) : null;
}

export function hasEffectArt(id: string | null | undefined): id is CosmeticId {
  return !!id && !!EFFECT_ART[id as CosmeticId];
}

/** The effect's preview, sized by its box in CSS (`size` only picks a sharp file). */
export function effectImg(id: CosmeticId, size: number, cls = ''): string {
  return artImg('effects', id, size, { cls: `fx-art ${cls}`, alt: COSMETICS[id].name, fb: `fx|${id}` });
}

/** A cosmetic's picture: the owner's preview where there is one, else its 1.x drawing. */
export function cosmeticPic(id: CosmeticId, size: number): string {
  if (TITLE_ART[id]) return artImg('titles', id, size, { cls: 'fx-art fill', alt: COSMETICS[id].name, fb: `fx|${id}` });
  return EFFECT_ART[id] ? effectImg(id, size, 'fill') : REWARD_ART[COSMETICS[id].art];
}

registerFallback('fx', ([id]) => {
  const c = COSMETICS[id as CosmeticId];
  return c ? REWARD_ART[c.art] : '';
});
