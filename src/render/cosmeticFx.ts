import { Color } from 'three';
import type { Rng } from '../core/math';
import type { VFX } from './VFX';

// The battle cosmetics of the dash and victory slots, in one place: BattleView plays them in a
// match and the PRIME SHOP fitting room (Alpha 1.8.8) plays the same effects as a preview. Pure
// visuals on the shared VFX pools — nothing here touches the simulation.

export type DashFx = 'phantom' | 'prime';
export type VictoryFx = 'pumpkin' | 'gold';

/** PURPLE PHANTOM (Halloween Premiere). */
export const PHANTOM = new Color(0xa855ff);
export const PHANTOM_SPARK = new Color(0x9dff5c);
/** PHANTOM DASH (PRIME SHOP, 1.8.8): a violet hologram with a cyan afterglow. */
export const PRIME_DASH = new Color(0x8a5cff);
export const PRIME_DASH_GLOW = new Color(0x48f4ff);

/** Which effect a dash / victory cosmetic plays (ThemeManager and the PRIME SHOP preview). */
export const DASH_FX: Partial<Record<string, DashFx>> = { dash_phantom: 'phantom', dash_prime_phantom: 'prime' };
export const VICTORY_FX: Partial<Record<string, VictoryFx>> = { victory_pumpkin: 'pumpkin', victory_golden_confetti: 'gold' };

export const GOLDEN_CONFETTI = [0xffd23a, 0xffe58a, 0xf2b02a, 0xfff3c4, 0xd9921a, 0xffffff];
const PUMPKIN_CONFETTI = [0xff8a1f, 0xb45cff, 0xa8ff60, 0xffd27a];

const _c = new Color();

/** The trail colour of a dash cosmetic (null: the fighter's own accent). */
export function dashColor(fx: DashFx | null): Color | null {
  return fx === 'phantom' ? PHANTOM : fx === 'prime' ? PRIME_DASH : null;
}

/** Every third spark of the dash in the cosmetic's second colour. */
export function dashSpark(fx: DashFx): Color {
  return fx === 'phantom' ? PHANTOM_SPARK : PRIME_DASH_GLOW;
}

/**
 * A dash leaving (fromX, fromZ): dust, a ring and a line of sparks in the trail colour `color`, and
 * on top of it the dash cosmetic `fx` when one is worn.
 */
export function dashBurst(vfx: VFX, rng: Rng, fx: DashFx | null, color: Color, fromX: number, fromZ: number, toX: number, toZ: number): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const l = Math.hypot(dx, dz) || 1;
  vfx.dust(fromX, fromZ, 8, dx / l, dz / l);
  vfx.ring(fromX, fromZ, color, 0.4, 2.2, 0.3, 2);
  for (let i = 0; i < 10; i++) {
    const t = i / 10;
    vfx.sparks.spawn(fromX + dx * t, rng.range(0.4, 1.8), fromZ + dz * t, (dx / l) * 2, 0, (dz / l) * 2, 0.22 + t * 0.15, 0.2, 0.02, fx && i % 3 === 0 ? dashSpark(fx) : color, 2, 4, 0);
  }
  if (fx) dashExtras(vfx, fx, fromX, fromZ, toX, toZ);
}

/** The cosmetic part of a dash, on top of the standard ring, dust and sparks. */
function dashExtras(vfx: VFX, fx: DashFx, fromX: number, fromZ: number, toX: number, toZ: number): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  if (fx === 'phantom') {
    // PURPLE PHANTOM: fading ghost silhouettes along the dash path
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      vfx.glow(fromX + dx * t, 1.1, fromZ + dz * t, PHANTOM, 1.4, 0.6, 0.35 + i * 0.06, 1.8);
    }
    vfx.burst(fromX, 1.0, fromZ, PHANTOM_SPARK, 10, 3, 0.14, 0.4, 2.2, -1, 1);
    return;
  }
  // PHANTOM DASH: tall violet hologram ghosts that fade one after another, a low cyan afterglow
  // lingering a little longer along the path, and a soft cyan flare where the dash began
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    vfx.glow(fromX + dx * t, 1.15, fromZ + dz * t, PRIME_DASH, 1.6, 0.7, 0.3 + i * 0.07, 2);
    vfx.glow(fromX + dx * (t - 0.12), 0.55, fromZ + dz * (t - 0.12), PRIME_DASH_GLOW, 0.9, 0.3, 0.55 + i * 0.05, 1.7);
  }
  vfx.flash(fromX, 1.0, fromZ, PRIME_DASH_GLOW, 1.4, 0.4, 0.16, 2.2);
  vfx.burst(fromX, 1.0, fromZ, PRIME_DASH, 8, 3, 0.13, 0.42, 2.2, -1, 1);
  vfx.burst(toX, 1.0, toZ, PRIME_DASH_GLOW, 6, 2.2, 0.1, 0.5, 2.2, -1, 1);
}

/**
 * The winner's celebration: the equipped victory cosmetic or the season's confetti. `alive` stops
 * the late second wave when the scene has moved on (a new match, the shop closed).
 */
export function victoryCelebration(vfx: VFX, fx: VictoryFx | null, x: number, z: number, seasonColors: number[], alive: () => boolean): void {
  if (fx === 'pumpkin') {
    // PUMPKIN VICTORY
    vfx.confetti(x, 3, z, 110, PUMPKIN_CONFETTI);
    vfx.pumpkins(x, 1.6, z, 14);
    setTimeout(() => alive() && vfx.pumpkins(x, 1.6, z, 8), 700);
    vfx.ring(x, z, _c.set(0xff8a1f), 1, 6, 0.8, 2.6);
    vfx.rays(x, 1.4, z, _c.set(0xb45cff), 1, 5, 0.8, 1.8);
    return;
  }
  if (fx === 'gold') {
    // GOLDEN CONFETTI: a gold burst with a ring and rays of light, a smaller second wave
    vfx.confetti(x, 3, z, 130, GOLDEN_CONFETTI);
    vfx.ring(x, z, _c.set(0xffd23a), 1, 6.4, 0.9, 2.8);
    vfx.rays(x, 1.4, z, _c.set(0xffe58a), 1, 5.4, 0.9, 2);
    vfx.flash(x, 1.5, z, _c.set(0xfff3c4), 1.2, 3.2, 0.35, 1.6);
    setTimeout(() => alive() && vfx.confetti(x, 3.4, z, 60, GOLDEN_CONFETTI), 650);
    return;
  }
  vfx.confetti(x, 3, z, 160, seasonColors);
}
