import { Color, Vector3 } from 'three';
import type { Rng } from '../core/math';
import type { VFX } from './VFX';

// The battle cosmetics of the dash and victory slots, in one place: BattleView plays them in a
// match and the PRIME SHOP fitting room (Alpha 1.8.8) plays the same effects as a preview. Pure
// visuals on the shared VFX pools — nothing here touches the simulation.

export type DashFx = 'phantom' | 'prime' | 'glitch' | 'comet';
export type VictoryFx = 'pumpkin' | 'gold' | 'spotlights' | 'fireworks';

/** PURPLE PHANTOM (Halloween Premiere). */
export const PHANTOM = new Color(0xa855ff);
export const PHANTOM_SPARK = new Color(0x9dff5c);
/** PHANTOM DASH (PRIME SHOP, 1.8.8): a violet hologram with a cyan afterglow. */
export const PRIME_DASH = new Color(0x8a5cff);
export const PRIME_DASH_GLOW = new Color(0x48f4ff);
/** GLITCH DASH (PRIME SHOP, 1.9.5): a magenta / cyan split of the signal. */
export const GLITCH_A = new Color(0xff3de0);
export const GLITCH_B = new Color(0x3dfcff);
/** COMET TRAIL (PRIME SHOP, 1.9.5): a hot white head, an amber tail, warm embers. */
export const COMET_HEAD = new Color(0xfff4d6);
export const COMET_TAIL = new Color(0xff9a2e);
export const COMET_EMBER = new Color(0xffc861);

/** Which effect a dash / victory cosmetic plays (ThemeManager and the PRIME SHOP preview). */
export const DASH_FX: Partial<Record<string, DashFx>> = { dash_phantom: 'phantom', dash_prime_phantom: 'prime', dash_glitch: 'glitch', dash_comet: 'comet' };
export const VICTORY_FX: Partial<Record<string, VictoryFx>> = { victory_pumpkin: 'pumpkin', victory_golden_confetti: 'gold', victory_studio_spotlights: 'spotlights', victory_neon_fireworks: 'fireworks' };

export const GOLDEN_CONFETTI = [0xffd23a, 0xffe58a, 0xf2b02a, 0xfff3c4, 0xd9921a, 0xffffff];
const PUMPKIN_CONFETTI = [0xff8a1f, 0xb45cff, 0xa8ff60, 0xffd27a];

const _c = new Color();
const _from = new Vector3();
const _to = new Vector3();
const NEON_SHELLS = [0xff4fd8, 0x3dfcff, 0xa86bff];

/** The trail colour of a dash cosmetic (null: the fighter's own accent). */
export function dashColor(fx: DashFx | null): Color | null {
  return fx === 'phantom' ? PHANTOM : fx === 'prime' ? PRIME_DASH : fx === 'glitch' ? GLITCH_A : fx === 'comet' ? COMET_TAIL : null;
}

/** Every third spark of the dash in the cosmetic's second colour. */
export function dashSpark(fx: DashFx): Color {
  return fx === 'phantom' ? PHANTOM_SPARK : fx === 'glitch' ? GLITCH_B : fx === 'comet' ? COMET_EMBER : PRIME_DASH_GLOW;
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
  if (fx === 'glitch') return glitchDash(vfx, fromX, fromZ, toX, toZ);
  if (fx === 'comet') return cometDash(vfx, fromX, fromZ, toX, toZ);
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
 * GLITCH DASH: the signal splits — two thin ghosts side by side (magenta and cyan, offset across the
 * path), two short white flickers, a few square «pixels» (debris) and a cyan pop on arrival. Short and
 * flat: nothing hangs in the air longer than half a second.
 */
function glitchDash(vfx: VFX, fromX: number, fromZ: number, toX: number, toZ: number): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const l = Math.hypot(dx, dz) || 1;
  const nx = -dz / l;
  const nz = dx / l;
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const x = fromX + dx * t;
    const z = fromZ + dz * t;
    vfx.glow(x + nx * 0.14, 1.1, z + nz * 0.14, GLITCH_A, 1.1, 0.5, 0.22 + i * 0.05, 1.9);
    vfx.glow(x - nx * 0.14, 1.1, z - nz * 0.14, GLITCH_B, 1.1, 0.5, 0.22 + i * 0.05, 1.9);
  }
  vfx.flash(fromX + dx * 0.35, 1.2, fromZ + dz * 0.35, _c.set(0xffffff), 0.6, 0.9, 0.06, 1.4);
  vfx.flash(fromX + dx * 0.7, 0.9, fromZ + dz * 0.7, _c.set(0xffffff), 0.5, 0.8, 0.05, 1.2);
  // small «pixels» of the broken signal (a third of a debris chunk)
  vfx.debrisBurst(fromX + dx * 0.5, 0.9, fromZ + dz * 0.5, GLITCH_B, 6, 0.38);
  vfx.burst(toX, 1.0, toZ, GLITCH_B, 7, 2.4, 0.1, 0.32, 2.2, -1, 0.6);
}

/**
 * COMET TRAIL: a hot head flashing where the dash ends, a tail that narrows back along the path, and
 * warm embers that drift down (gravity) — the one dash effect that lingers, kept low and small.
 */
function cometDash(vfx: VFX, fromX: number, fromZ: number, toX: number, toZ: number): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  vfx.flash(toX, 1.0, toZ, COMET_HEAD, 1.0, 1.8, 0.18, 2.4);
  for (let i = 1; i <= 4; i++) {
    const t = 1 - i / 5;
    vfx.glow(fromX + dx * t, 0.95, fromZ + dz * t, COMET_TAIL, 1.25 - i * 0.2, 0.25, 0.28 + i * 0.05, 2);
  }
  for (let i = 0; i < 9; i++) {
    const t = i / 9;
    vfx.sparks.spawn(fromX + dx * t, 0.9 + (i % 3) * 0.2, fromZ + dz * t, 0, 0.6, 0, 0.7 + t * 0.4, 0.13, 0.03, COMET_EMBER, 1.8, 1.5, 3.2);
  }
  vfx.ring(fromX, fromZ, COMET_TAIL, 0.3, 1.6, 0.35, 1.8);
}

/**
 * STUDIO SPOTLIGHTS: four studio lamps above the corners find the winner (straight light beams, no
 * lightning jitter), a pool of light on the floor, camera flashbulbs popping around, a few gold motes.
 */
function spotlights(vfx: VFX, x: number, z: number, alive: () => boolean): void {
  const lamps: [number, number][] = [
    [-3.2, -2.6],
    [3.2, -2.6],
    [-2.6, 2.8],
    [2.6, 2.8],
  ];
  lamps.forEach(([lx, lz], i) => {
    setTimeout(() => {
      if (!alive()) return;
      _from.set(x + lx, 6.2, z + lz);
      _to.set(x, 0.15, z);
      vfx.bolt(_from, _to, _c.set(i % 2 ? 0xfff1c8 : 0xd9f6ff), 0.24, 1.5, 0, 0.8);
    }, i * 140);
  });
  setTimeout(() => {
    if (!alive()) return;
    vfx.ring(x, z, _c.set(0xfff1c8), 1.4, 2.6, 1.6, 1.6);
    vfx.flash(x, 1.6, z, _c.set(0xfff6dc), 0.8, 1.8, 0.28, 0.9);
    vfx.burst(x, 2.2, z, _c.set(0xffd23a), 18, 1.2, 0.09, 1.3, 1.6, -0.6, 0.4);
  }, 600);
  for (let i = 0; i < 6; i++) {
    setTimeout(() => {
      if (!alive()) return;
      const a = (i / 6) * Math.PI * 2 + 0.4;
      vfx.flash(x + Math.cos(a) * 3.4, 1.2 + (i % 3) * 0.5, z + Math.sin(a) * 3.4, _c.set(0xffffff), 0.3, 0.9, 0.09, 2.2);
    }, 700 + i * 170);
  }
}

/**
 * NEON FIREWORKS: three shells (pink, cyan, violet) rise from around the winner and burst above the heads
 * into sparks that fall slowly — no confetti, nothing at the fighter's eye level.
 */
function fireworks(vfx: VFX, x: number, z: number, alive: () => boolean): void {
  const shells: [number, number, number][] = [
    [-1.0, -0.4, 0],
    [0.95, -0.2, 380],
    [0.05, 0.5, 760],
  ];
  shells.forEach(([ox, oz, delay], i) => {
    setTimeout(() => {
      if (!alive()) return;
      const col = _c.setHex(NEON_SHELLS[i]);
      vfx.sparks.spawn(x + ox, 0.4, z + oz, 0, 5.2, 0, 0.42, 0.16, 0.05, col, 2.4, 0.5, 0);
      setTimeout(() => {
        if (!alive()) return;
        const c2 = _c.setHex(NEON_SHELLS[i]);
        // (close above the winner's head: inside the winner close-up of the fight and the shop's fitting room)
        vfx.flash(x + ox, 2.55, z + oz, c2, 0.6, 1.9, 0.22, 1.8);
        vfx.burst(x + ox, 2.55, z + oz, c2, 44, 2.8, 0.1, 1.4, 2.1, 2.2, 0);
        vfx.burst(x + ox, 2.55, z + oz, _c.set(0xffffff), 10, 1.5, 0.07, 0.55, 2.4, 1, 0);
      }, 420);
    }, delay);
  });
  vfx.ring(x, z, _c.setHex(NEON_SHELLS[1]), 1, 4.6, 0.7, 2);
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
  if (fx === 'spotlights') return spotlights(vfx, x, z, alive);
  if (fx === 'fireworks') return fireworks(vfx, x, z, alive);
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
