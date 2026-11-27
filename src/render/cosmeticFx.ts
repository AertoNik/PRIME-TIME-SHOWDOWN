import { Color, Vector3 } from 'three';
import type { Rng } from '../core/math';
import type { VFX } from './VFX';
import { clockDialTexture, clockHandTexture, lightPoolTexture, peppermintTexture, retroSunTexture, signalBarsTexture, waveTexture } from './fxKit';
import { raysTexture, ringTexture } from './textures';

// The battle cosmetics of the dash and victory slots, in one place: BattleView plays them in a match and the PRIME SHOP
// fitting room (Alpha 1.8.8) plays the same effects as a preview. Pure visuals on the shared VFX pools and the cosmetic
// kit (fxKit.ts) — nothing here touches the simulation.
//
// Beta 2.7.5 — VFX REWORK: every effect has its own SHAPE and MOTION, not only its own colour (before, six of the seven
// dashes were a row of round glows in different colours, and three victories were the same gold ray-burst):
//   PHANTOM DASH     hologram afterimages of the fighter itself (holo copies of the model, scanlines), a cyan floor line
//   PURPLE PHANTOM   ectoplasm: purple smoke curling upward, green will-o'-wisps spiralling up out of it
//   GLITCH DASH      a torn TV signal: magenta / cyan doubles split apart, flickering tear bars, stepped pixel blocks,
//                    a «signal back» line
//   COMET TRAIL      one long straight tapering streak (layered beams) with a white-hot head and falling embers
//   ARC SURGE        three re-striking lightning arcs, forks into the floor, crackle, an ion glow at both ends
//   CANDY COMET      a red-and-white double helix wound round the path, sugar sparkles, a spinning peppermint
//   INVITE SIGNAL    broadcast wave fronts travelling along the path, an antenna pulse, the gold «on air» bars
//   GOLDEN CONFETTI  two confetti cannons: real paper confetti and curling foil streamers arcing over the winner, gold rays
//   MIDNIGHT CONF.   a giant gold clock behind the winner strikes midnight: chimes, gold sparks, then snow and confetti
//   PUMPKIN VICTORY  a carousel of jack-o'-lanterns rising round the winner, bats, Halloween confetti, purple fog
//   STUDIO SPOTL.    four volumetric spotlight cones sweep the stage and lock on, a pool of light, a gold ring, flashbulbs
//   NEON FIREWORKS   five rockets, five shapes: peony, ring, willow, star, crackle
//   РАССВЕТ          a striped retro sun rises behind the winner over a horizon line, slow turning rays, warm sparks falling
// Every piece is pooled (bounded counts); quality LOW plays lighter versions (vfx.detail). Effects stay around the
// fighter's body — not over the cards, never a full-screen flash.

export type DashFx = 'phantom' | 'prime' | 'glitch' | 'comet' | 'arc' | 'candy' | 'signal';
export type VictoryFx = 'pumpkin' | 'gold' | 'spotlights' | 'fireworks' | 'sunrise' | 'midnight';

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
/** ARC SURGE (PRIME LEAGUE exchange, 1.9.6): a silver-blue charge with electric arcs along the path. */
export const ARC_TRAIL = new Color(0x7cc0ff);
export const ARC_SPARK = new Color(0xe6f2ff);
/** CANDY COMET (WINTER SHOWDOWN, 1.9.7): a red-and-white candy trail with glittering sparks. */
export const CANDY_RED = new Color(0xff2a44);
export const CANDY_WHITE = new Color(0xfff6f0);
/** INVITE SIGNAL (PRIME INVITE CASE, Beta 2.4): a navy broadcast ribbon, turquoise signal waves, gold sparks. */
export const SIGNAL_NAVY = new Color(0x2a4dff);
export const SIGNAL_TEAL = new Color(0x3ff0d8);
export const SIGNAL_GOLD = new Color(0xffc84a);

/** Which effect a dash / victory cosmetic plays (ThemeManager and the PRIME SHOP preview). */
export const DASH_FX: Partial<Record<string, DashFx>> = { dash_phantom: 'phantom', dash_prime_phantom: 'prime', dash_glitch: 'glitch', dash_comet: 'comet', dash_league_arc: 'arc', dash_candy_comet: 'candy', dash_invite_signal: 'signal' };
export const VICTORY_FX: Partial<Record<string, VictoryFx>> = { victory_pumpkin: 'pumpkin', victory_golden_confetti: 'gold', victory_studio_spotlights: 'spotlights', victory_neon_fireworks: 'fireworks', victory_daily_sunrise: 'sunrise', victory_midnight_confetti: 'midnight' };

export const GOLDEN_CONFETTI = [0xffd23a, 0xffe58a, 0xf2b02a, 0xfff3c4, 0xd9921a, 0xffffff];
const GOLD_PAPER = [0xffcf3a, 0xffe07a, 0xe8a91c, 0xfff1c4, 0xffffff, 0xd9921a];
const MIDNIGHT_PAPER = [0xe8f6ff, 0xbfe7ff, 0xffd36a, 0xffffff, 0x9fc9ff];
const HALLOWEEN_PAPER = [0xff8a1f, 0xb06bff, 0x9dff5c, 0xffb347, 0x7a34c8];

const _c = new Color();
const _from = new Vector3();
const _to = new Vector3();
const _a = new Vector3();

/**
 * Who can draw the fighter's own hologram afterimages (BattleView in a fight, the fitting room's showcase in the shop):
 * a copy of the fighter frozen in its current pose, at (x, z), shown after `delay` for `life` s in `color`.
 */
export interface GhostHost {
  ghost(x: number, z: number, delay: number, life: number, color: Color, peak: number): void;
}

/** The trail colour of a dash cosmetic (null: the fighter's own accent). */
export function dashColor(fx: DashFx | null): Color | null {
  return fx === 'phantom' ? PHANTOM : fx === 'prime' ? PRIME_DASH : fx === 'glitch' ? GLITCH_A : fx === 'comet' ? COMET_TAIL : fx === 'arc' ? ARC_TRAIL : fx === 'candy' ? CANDY_RED : fx === 'signal' ? SIGNAL_NAVY : null;
}

/**
 * Beta 2.7.5: the motion ribbon behind a dashing fighter differs too — a glitch has almost none (the signal breaks
 * instead of streaking), a comet the widest; null = the plain dash.
 */
export function dashTrailWidth(fx: DashFx | null): number {
  return fx === 'glitch' ? 0.3 : fx === 'comet' ? 1.4 : fx === 'arc' ? 0.55 : fx === 'prime' ? 0.75 : fx === 'candy' ? 0.85 : fx === 'signal' ? 1.0 : fx === 'phantom' ? 1.0 : 0.9;
}

/** Every third spark of the dash in the cosmetic's second colour. */
export function dashSpark(fx: DashFx): Color {
  return fx === 'phantom' ? PHANTOM_SPARK : fx === 'glitch' ? GLITCH_B : fx === 'comet' ? COMET_EMBER : fx === 'arc' ? ARC_SPARK : fx === 'candy' ? CANDY_WHITE : fx === 'signal' ? SIGNAL_GOLD : PRIME_DASH_GLOW;
}

/**
 * A dash leaving (fromX, fromZ): dust, a ring and a line of sparks in the trail colour `color` — or, with a dash
 * cosmetic worn, that cosmetic's own effect instead of the ring and sparks (the dust stays). `ghosts`: who can draw
 * the PHANTOM DASH afterimages (without it the phantom draws glows in their place).
 */
export function dashBurst(vfx: VFX, rng: Rng, fx: DashFx | null, color: Color, fromX: number, fromZ: number, toX: number, toZ: number, ghosts?: GhostHost): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const l = Math.hypot(dx, dz) || 1;
  vfx.dust(fromX, fromZ, fx ? 5 : 8, dx / l, dz / l);
  if (!fx) {
    vfx.ring(fromX, fromZ, color, 0.4, 2.2, 0.3, 2);
    for (let i = 0; i < 10; i++) {
      const t = i / 10;
      vfx.sparks.spawn(fromX + dx * t, rng.range(0.4, 1.8), fromZ + dz * t, (dx / l) * 2, 0, (dz / l) * 2, 0.22 + t * 0.15, 0.2, 0.02, color, 2, 4, 0);
    }
    return;
  }
  dashExtras(vfx, rng, fx, fromX, fromZ, toX, toZ, ghosts);
}

/** The cosmetic part of a dash. */
function dashExtras(vfx: VFX, rng: Rng, fx: DashFx, fromX: number, fromZ: number, toX: number, toZ: number, ghosts?: GhostHost): void {
  if (fx === 'glitch') return glitchDash(vfx, rng, fromX, fromZ, toX, toZ, ghosts);
  if (fx === 'comet') return cometDash(vfx, rng, fromX, fromZ, toX, toZ);
  if (fx === 'arc') return arcDash(vfx, rng, fromX, fromZ, toX, toZ);
  if (fx === 'candy') return candyDash(vfx, rng, fromX, fromZ, toX, toZ);
  if (fx === 'signal') return signalDash(vfx, rng, fromX, fromZ, toX, toZ);
  if (fx === 'phantom') return purplePhantom(vfx, rng, fromX, fromZ, toX, toZ);
  return hologramDash(vfx, rng, fromX, fromZ, toX, toZ, ghosts);
}

/**
 * PHANTOM DASH (PRIME SHOP): the fighter leaves hologram copies of ITSELF along the path — frozen in the pose it dashed
 * in, violet fading to cyan, scanlines running over them, the oldest fading first — a projector line flickers off where
 * it began and a thin cyan line stays on the floor. HIGH: three copies, MEDIUM two, LOW one.
 */
function hologramDash(vfx: VFX, rng: Rng, fromX: number, fromZ: number, toX: number, toZ: number, ghosts?: GhostHost): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const n = vfx.detail >= 2 ? 3 : vfx.detail === 1 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : 0.22 + (i / (n - 1)) * 0.5;
    const col = _c.copy(PRIME_DASH).lerp(PRIME_DASH_GLOW, n === 1 ? 0.4 : i / (n - 1));
    // (the first copy a beat after the dash began: the pose it takes is the dash's lean, not the stance before it)
    if (ghosts) ghosts.ghost(fromX + dx * t, fromZ + dz * t, 0.05 + i * 0.035, 0.42 + i * 0.1, col, 0.78 - i * 0.12);
    else vfx.glow(fromX + dx * t, 1.15, fromZ + dz * t, col, 1.6, 0.7, 0.3 + i * 0.07, 2);
  }
  // the projector beam it stepped out of, flickering off
  vfx.kit.bars.spawn({ x: fromX, y: 1.0, z: fromZ, life: 0.26, w: 0.09, h: 2.1, w1: 0.02, color: PRIME_DASH_GLOW, intensity: 2.2, flicker: 26, fadeIn: 0.05 });
  // a thin cyan line left on the floor along the path
  _from.set(fromX, 0.05, fromZ);
  _to.set(toX, 0.05, toZ);
  vfx.bolt(_from, _to, PRIME_DASH_GLOW, 0.05, 0.55, 0, 2.4);
  // a few violet motes drifting up off the copies
  for (let i = 0; i < 8; i++) {
    const t = rng.range(0.15, 0.85);
    vfx.kit.motes.spawn({ x: fromX + dx * t, y: rng.range(0.5, 1.7), z: fromZ + dz * t, vy: rng.range(0.3, 0.7), life: rng.range(0.45, 0.7), w: 0.14, w1: 0.05, color: i % 2 ? PRIME_DASH : PRIME_DASH_GLOW, intensity: 2, delay: rng.range(0, 0.15) });
  }
}

/**
 * PURPLE PHANTOM (Halloween Premiere): ectoplasm — dark purple smoke curls up off the path (it rises, it does not
 * streak) and green will-o'-wisps spiral upward out of it; a pale wail-wave where the fighter vanished.
 */
function purplePhantom(vfx: VFX, rng: Rng, fromX: number, fromZ: number, toX: number, toZ: number): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const puffs = vfx.detail >= 1 ? 11 : 6;
  for (let i = 0; i < puffs; i++) {
    const t = (i + 0.5) / puffs;
    vfx.soft.spawn(fromX + dx * t + rng.range(-0.15, 0.15), rng.range(0.35, 1.0), fromZ + dz * t + rng.range(-0.15, 0.15), rng.range(-0.2, 0.2), rng.range(0.55, 0.95), rng.range(-0.2, 0.2), rng.range(0.85, 1.15), 0.45, 1.25, _c.setHex(i % 3 === 0 ? 0xb27aff : i % 3 === 1 ? 0x8a4ac8 : 0x6a2aa8), 1, 0.8, -0.2);
  }
  // a violet glow inside the mist (the smoke lit from within)
  for (let i = 0; i < 3; i++) {
    const t = (i + 0.5) / 3;
    vfx.kit.motes.spawn({ x: fromX + dx * t, y: 0.9, z: fromZ + dz * t, vy: 0.5, life: 0.7, w: 0.9, w1: 1.3, color: PHANTOM, intensity: 1.1, delay: i * 0.05 });
  }
  const wisps = vfx.detail >= 1 ? 5 : 3;
  for (let i = 0; i < wisps; i++) {
    const t = (i + 0.5) / wisps;
    const cx = fromX + dx * t;
    const cz = fromZ + dz * t;
    const vy = rng.range(0.95, 1.35);
    const w = (i % 2 ? 1 : -1) * rng.range(6, 8);
    const r = rng.range(0.2, 0.3);
    const a = rng.range(0, 6.28);
    // each will-o'-wisp a bright head and a fading tail of three (the same spiral, a little later each)
    for (let k = 0; k < 4; k++) {
      vfx.kit.motes.spawn({ x: cx, y: 0.5, z: cz, vy, life: 0.95, w: k ? 0.2 - k * 0.04 : 0.3, w1: 0.06, color: k ? 0xc8ff9a : PHANTOM_SPARK, intensity: k ? 1.8 - k * 0.3 : 2.6, orbit: { cx, cz, r, w, a: a - k * 0.35 }, delay: i * 0.04 + k * 0.045 });
    }
  }
  vfx.kit.bigs.spawn(waveTexture(), fromX, 1.2, fromZ, 0.7, 0.7, PHANTOM, 2.0, 0.5, { grow: 1.6, fadeIn: 0.1, fadeOut: 0.6 });
}

/**
 * GLITCH DASH: the broadcast breaks — the fighter splits into a magenta and a cyan double of itself, side by side across
 * the path, for a split second (the item's promise: «двойники со смещением»); horizontal tear bars flicker and jump
 * sideways where it was, square pixel blocks pop along the path in steps (following the dash) and vanish without
 * falling, and where it lands a white line flashes across with a magenta / cyan split (the signal coming back). Nothing
 * hangs longer than a third of a second.
 */
function glitchDash(vfx: VFX, rng: Rng, fromX: number, fromZ: number, toX: number, toZ: number, ghosts?: GhostHost): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const l = Math.hypot(dx, dz) || 1;
  const nx = -dz / l;
  const nz = dx / l;
  // the doubles: the fighter's own copies (the hologram twins of PHANTOM DASH — here only two, a fifth of a second, split
  // apart instead of left along the path); LOW and the rival's dash: two coloured glows in their place
  if (ghosts && vfx.detail >= 1) {
    ghosts.ghost(fromX + nx * 0.13, fromZ + nz * 0.13, 0.03, 0.2, GLITCH_A, 0.8);
    ghosts.ghost(fromX - nx * 0.13, fromZ - nz * 0.13, 0.03, 0.2, GLITCH_B, 0.8);
  } else {
    vfx.glow(fromX + nx * 0.14, 1.1, fromZ + nz * 0.14, GLITCH_A, 1.1, 0.5, 0.22, 1.9);
    vfx.glow(fromX - nx * 0.14, 1.1, fromZ - nz * 0.14, GLITCH_B, 1.1, 0.5, 0.22, 1.9);
  }
  const bars = vfx.detail >= 1 ? 9 : 5;
  for (let i = 0; i < bars; i++) {
    const col = i % 3 === 0 ? 0xffffff : i % 3 === 1 ? GLITCH_A : GLITCH_B;
    vfx.kit.bars.spawn({ x: fromX + rng.range(-0.2, 0.2), y: 0.3 + (i / bars) * 1.6 + rng.range(-0.05, 0.05), z: fromZ, life: rng.range(0.24, 0.36), w: rng.range(0.6, 1.5), h: rng.range(0.07, 0.16), color: col, intensity: i % 3 === 0 ? 1.7 : 2.4, flicker: rng.range(18, 26), jitter: 0.18, delay: rng.range(0, 0.06), fadeIn: 0.05 });
  }
  // the landing glitches too: three short tears across the fighter where it reappears
  for (let i = 0; i < (vfx.detail >= 1 ? 3 : 2); i++) {
    vfx.kit.bars.spawn({ x: toX, y: 0.6 + i * 0.45 + rng.range(-0.08, 0.08), z: toZ, life: 0.2, w: rng.range(0.5, 0.9), h: rng.range(0.06, 0.12), color: i % 2 ? GLITCH_A : GLITCH_B, intensity: 2.4, flicker: 24, jitter: 0.12, delay: 0.12 + i * 0.02, fadeIn: 0.05 });
  }
  const px = vfx.detail >= 1 ? 18 : 9;
  const grid = 0.14;
  for (let i = 0; i < px; i++) {
    const t = rng.range(0.05, 0.95);
    const x = Math.round((fromX + dx * t) / grid) * grid;
    const z = Math.round((fromZ + dz * t) / grid) * grid;
    const y = Math.round(rng.range(0.3, 1.8) / grid) * grid;
    const s = grid * (rng.range(0, 1) < 0.3 ? 1.6 : 0.85);
    vfx.kit.pixels.spawn({ x, y, z, life: rng.range(0.16, 0.26), w: s, color: i % 2 ? GLITCH_A : GLITCH_B, intensity: 2.2, flicker: 16, delay: t * 0.16, fadeIn: 0.02 });
  }
  // the signal back: a white line widening across the landing point, a magenta and a cyan copy just above / below it
  vfx.kit.bars.spawn({ x: toX, y: 1.05, z: toZ, life: 0.2, w: 0.2, w1: 2.0, h: 0.05, h1: 0.012, color: 0xffffff, intensity: 2.6, delay: 0.15, fadeIn: 0.05 });
  vfx.kit.bars.spawn({ x: toX, y: 1.11, z: toZ, life: 0.16, w: 0.3, w1: 1.4, h: 0.04, h1: 0.01, color: GLITCH_A, intensity: 2.2, delay: 0.17, fadeIn: 0.05 });
  vfx.kit.bars.spawn({ x: toX, y: 0.99, z: toZ, life: 0.16, w: 0.3, w1: 1.4, h: 0.04, h1: 0.01, color: GLITCH_B, intensity: 2.2, delay: 0.17, fadeIn: 0.05 });
}

/**
 * COMET TRAIL: one long straight streak that narrows back along the path — three layered beams (a wide amber glow,
 * an orange body over the last two thirds, a white-hot core over the last third), a hot head flaring where the dash ends
 * and embers that fall (gravity) — the one dash effect that lingers, kept low and small.
 */
function cometDash(vfx: VFX, rng: Rng, fromX: number, fromZ: number, toX: number, toZ: number): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const y = 0.95;
  const layer = (start: number, width: number, life: number, col: Color, k: number) => {
    _from.set(fromX + dx * start, y, fromZ + dz * start);
    _to.set(toX, y, toZ);
    vfx.bolt(_from, _to, col, width, life, 0, k);
  };
  // the tail: a continuous cone of overlapping glows, widest and hottest at the head, thinning to nothing at the start
  const segs = vfx.detail >= 1 ? 16 : 9;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const k = t * t;
    vfx.kit.motes.spawn({ x: fromX + dx * t, y, z: fromZ + dz * t, life: 0.3 + t * 0.25, w: 0.12 + 0.75 * k, w1: 0.04 + 0.3 * k, color: _c.copy(COMET_TAIL).lerp(COMET_HEAD, k * 0.7), intensity: 1.2 + 1.4 * k, fadeIn: 0.04 });
  }
  layer(0.25, 0.13, 0.42, _c.setHex(0xffb24a), 2.2);
  layer(0.6, 0.05, 0.34, COMET_HEAD, 3);
  vfx.flash(toX, y, toZ, COMET_HEAD, 1.0, 2.0, 0.2, 2.6);
  vfx.kit.stars.spawn({ x: toX, y, z: toZ, life: 0.24, w: 0.55, w1: 0.2, rot: 0.3, spin: 3, color: COMET_HEAD, intensity: 2.4 });
  const embers = vfx.detail >= 1 ? 12 : 6;
  for (let i = 0; i < embers; i++) {
    const t = i / embers;
    vfx.sparks.spawn(fromX + dx * t, y + rng.range(-0.15, 0.2), fromZ + dz * t, rng.range(-0.3, 0.3), rng.range(0.2, 0.8), rng.range(-0.3, 0.3), 0.7 + t * 0.4, 0.12, 0.03, COMET_EMBER, 1.9, 1.5, 3.2);
  }
  vfx.ring(toX, toZ, COMET_TAIL, 0.3, 1.5, 0.35, 1.8);
}

/**
 * CANDY COMET (WINTER SHOWDOWN): a candy cane wound round the path — a red and a white strand twisting about each
 * other (a double helix, drawn in order with the dash), sugar sparkles twinkling on it, and a peppermint swirl spinning
 * on the floor where it lands. Short and low (looks only).
 */
function candyDash(vfx: VFX, rng: Rng, fromX: number, fromZ: number, toX: number, toZ: number): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const l = Math.hypot(dx, dz) || 1;
  const nx = -dz / l;
  const nz = dx / l;
  const pts = vfx.detail >= 1 ? 22 : 12;
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < pts; i++) {
      const t = i / (pts - 1);
      const th = t * Math.PI * 4 + s * Math.PI;
      const r = 0.26;
      vfx.kit.motes.spawn({
        x: fromX + dx * t + nx * Math.cos(th) * r,
        y: 0.95 + Math.sin(th) * r,
        z: fromZ + dz * t + nz * Math.cos(th) * r,
        life: 0.42,
        w: 0.14,
        w1: 0.05,
        color: s ? CANDY_WHITE : CANDY_RED,
        intensity: s ? 1.7 : 2.4,
        delay: t * 0.14,
        fadeIn: 0.05,
      });
    }
  }
  for (let i = 0; i < (vfx.detail >= 1 ? 6 : 3); i++) {
    const t = rng.range(0.1, 0.95);
    vfx.kit.stars.spawn({ x: fromX + dx * t, y: rng.range(0.7, 1.3), z: fromZ + dz * t, life: 0.5, w: 0.2, w1: 0.05, spin: 4, color: 0xffffff, intensity: 2.2, flicker: 12, delay: t * 0.14 + 0.05 });
  }
  vfx.kit.decals.spawn(peppermintTexture(), toX, 0.04, toZ, null, 0xffffff, 1.2, 0.4, 1.7, 0.8, { spin: 7, delay: 0.08, fadeIn: 0.1 });
}

/**
 * INVITE SIGNAL (Beta 2.4, PRIME INVITE CASE's exclusive): the dash goes out «on air» — an antenna pulse where it starts,
 * broadcast wave fronts (arcs standing across the path) travelling after the fighter one by one, gold sparks on each
 * wave, and the gold «signal bars» popping up where it lands. Short and low (looks only).
 */
function signalDash(vfx: VFX, rng: Rng, fromX: number, fromZ: number, toX: number, toZ: number): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  vfx.ring(fromX, fromZ, SIGNAL_TEAL, 0.25, 1.4, 0.4, 2);
  vfx.kit.decals.spawn(ringTexture(), fromX, 0.05, fromZ, null, SIGNAL_NAVY, 2, 0.3, 2.2, 0.5, { delay: 0.08 });
  const waves = vfx.detail >= 1 ? 5 : 3;
  for (let k = 0; k < waves; k++) {
    const t = 0.15 + (k / (waves - 1)) * 0.8;
    const x = fromX + dx * t;
    const z = fromZ + dz * t;
    // a wave front: an arc that faces the camera and widens as it fades (the signal spreading out)
    vfx.kit.bigs.spawn(waveTexture(), x, 1.05, z, 0.75, 0.75, k % 2 ? SIGNAL_NAVY : SIGNAL_TEAL, k % 2 ? 3.4 : 2.8, 0.42, { delay: k * 0.045, grow: 1.5, fadeIn: 0.1, fadeOut: 0.6 });
    vfx.kit.motes.spawn({ x, y: 1.0 + rng.range(-0.2, 0.3), z, life: 0.32, w: 0.12, color: SIGNAL_GOLD, intensity: 2.2, delay: k * 0.045 + 0.05 });
  }
  vfx.kit.bigs.spawn(signalBarsTexture(), toX, 2.0, toZ, 0.34, 0.34, SIGNAL_GOLD, 2.2, 0.6, { delay: 0.12, vy: 0.4, fadeIn: 0.15, fadeOut: 0.45 });
  vfx.flash(toX, 1.0, toZ, SIGNAL_TEAL, 0.6, 1.3, 0.16, 2.2);
}

/**
 * ARC SURGE (1.9.6): electricity — three arcs strike along the path one after another (each a new jagged path),
 * forks jump down into the floor at both ends, crackle twinkles along the way and a cold ion glow marks the exit point.
 */
function arcDash(vfx: VFX, rng: Rng, fromX: number, fromZ: number, toX: number, toZ: number): void {
  const strikes = vfx.detail >= 1 ? 3 : 2;
  for (let k = 0; k < strikes; k++) {
    const go = () => {
      _from.set(fromX, 0.8 + k * 0.3, fromZ);
      _to.set(toX, 0.9 + (k % 2) * 0.35, toZ);
      vfx.bolt(_from, _to, k % 2 ? ARC_SPARK : ARC_TRAIL, 0.08 + (k === 0 ? 0.04 : 0), 0.22 + k * 0.05, 0.6, 3);
    };
    if (k === 0) go();
    else setTimeout(go, k * 70);
  }
  for (const [x, z] of [
    [fromX, fromZ],
    [toX, toZ],
  ] as [number, number][]) {
    for (let f = 0; f < 2; f++) {
      const a = rng.range(0, 6.28);
      _from.set(x, 1.0, z);
      _to.set(x + Math.cos(a) * 0.5, 0.02, z + Math.sin(a) * 0.5);
      vfx.bolt(_from, _to, ARC_SPARK, 0.05, 0.2, 0.35, 2.6);
    }
  }
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  for (let i = 0; i < (vfx.detail >= 1 ? 10 : 5); i++) {
    const t = rng.range(0, 1);
    vfx.kit.stars.spawn({ x: fromX + dx * t, y: rng.range(0.6, 1.4), z: fromZ + dz * t, life: 0.28, w: 0.13, w1: 0.04, rot: rng.range(0, 6), color: ARC_SPARK, intensity: 2.6, flicker: 30 });
  }
  vfx.kit.motes.spawn({ x: toX, y: 1.0, z: toZ, life: 0.3, w: 0.9, w1: 0.4, color: ARC_TRAIL, intensity: 1.6 });
  vfx.ring(toX, toZ, ARC_TRAIL, 0.3, 1.4, 0.3, 1.8);
  vfx.scorch(toX, toZ, 0.7, 1.2);
}

// ============================================================================ victory
/**
 * РАССВЕТ ПРАЙМ-ТАЙМА (DAILY STREAK, 100 days — 1.9.6): a striped retro studio sun rises slowly behind the winner over
 * a glowing horizon line on the floor, slow rays turn behind it, two warm rings spread and warm sparks drift down — calm.
 */
function sunrise(vfx: VFX, x: number, z: number, alive: () => boolean): void {
  const SUN = 0xff7a59;
  const GOLD = 0xffc66b;
  const bz = z - 1.4;
  vfx.kit.bigs.spawn(raysTexture(), x, 1.95, bz - 0.05, 4.4, 4.4, GOLD, 0.55, 2.4, { delay: 1.0, r0: 0, r1: 0.5, rT: 2.4, fadeIn: 0.3, fadeOut: 0.35 });
  vfx.kit.bigs.spawn(retroSunTexture(), x, 0.2, bz, 3.1, 3.1, 0xffffff, 1.3, 3.3, { rise: 1.75, riseT: 1.5, fadeIn: 0.14, fadeOut: 0.3 });
  _from.set(x - 3.4, 0.05, bz + 0.3);
  _to.set(x + 3.4, 0.05, bz + 0.3);
  vfx.bolt(_from, _to, _c.setHex(SUN), 0.07, 2.8, 0, 2.6);
  vfx.ring(x, z, _c.setHex(SUN), 1, 5.2, 1.2, 2);
  setTimeout(() => alive() && vfx.ring(x, z, _c.setHex(GOLD), 0.8, 4, 1.2, 1.8), 700);
  for (let i = 0; i < (vfx.detail >= 1 ? 18 : 9); i++) {
    const a = (i / 18) * Math.PI * 2;
    // (warm sparks come down from above — the item's description)
    vfx.kit.motes.spawn({ x: x + Math.cos(a) * 1.4, y: 2.7 + (i % 3) * 0.2, z: z + Math.sin(a) * 1.0 - 0.4, vy: -(0.38 + (i % 4) * 0.08), life: 2.2, w: 0.1, color: i % 2 ? GOLD : 0xffe2c4, intensity: 1.8, sway: 0.15, delay: 0.4 + (i % 6) * 0.15, fadeIn: 0.2 });
  }
}

/**
 * STUDIO SPOTLIGHTS: four volumetric spotlight cones sweep in across the stage from high lamps and lock on the winner
 * one after another, a pool of light opens on the floor under him with a gold ring spreading from it, dust motes hang in
 * the light and press flashbulbs pop around (all in white-gold studio light — no lightning).
 */
function spotlights(vfx: VFX, x: number, z: number, alive: () => boolean): void {
  const lamps: [number, number, number][] = [
    [-2.8, -2.4, 0xfff1c8],
    [2.8, -2.4, 0xd9f6ff],
    [-2.4, 2.6, 0xd9f6ff],
    [2.4, 2.6, 0xfff1c8],
  ];
  const n = vfx.detail >= 1 ? 4 : 2;
  for (let i = 0; i < n; i++) {
    const [lx, lz, col] = lamps[i];
    _from.set(x + lx, 5.6, z + lz);
    _a.set(x - lx * 0.75, 0.02, z - lz * 0.4);
    _to.set(x, 0.02, z);
    vfx.kit.beams.spawn(_from, _a, _to, col, 0.6, 0.5, 2.6, 0.6, i * 0.12);
  }
  vfx.kit.decals.spawn(lightPoolTexture(), x, 0.03, z, null, 0xfff1d6, 1.1, 1.0, 2.1, 2.2, { delay: 0.55, fadeIn: 0.15 });
  for (let i = 0; i < (vfx.detail >= 1 ? 20 : 10); i++) {
    vfx.kit.motes.spawn({ x: x + (Math.random() - 0.5) * 1.6, y: 0.4 + Math.random() * 2.2, z: z + (Math.random() - 0.5) * 1.2, vy: 0.08, life: 2.0, w: 0.05, color: 0xfff1c8, intensity: 1.6, sway: 0.12, delay: 0.6 + Math.random() * 0.4, fadeIn: 0.3 });
  }
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const r = 2.6 + (i % 3) * 0.5;
    vfx.kit.stars.spawn({ x: x + Math.cos(a) * r, y: 0.9 + (i % 3) * 0.6, z: z + Math.sin(a) * r * 0.7 - 0.6, life: 0.14, w: 0.5, w1: 0.2, rot: 0.4, color: 0xffffff, intensity: 2.6, delay: 0.7 + i * 0.16, fadeIn: 0.1 });
  }
  setTimeout(() => {
    if (!alive()) return;
    vfx.flash(x, 1.5, z, _c.setHex(0xfff6dc), 0.6, 1.6, 0.3, 0.8);
    // the gold ring of light at the moment of the «shot» (the item's description)
    vfx.ring(x, z, _c.setHex(0xffd36a), 0.9, 3.6, 0.9, 2.2);
  }, 650);
}

/**
 * NEON FIREWORKS: five rockets climb from around the winner, one after another, and each bursts in its OWN shape — a
 * pink peony (a sphere), a cyan ring, a violet-gold willow (long drooping trails), a white-cyan five-armed star and a
 * glittering crackle — all just above the heads (inside the winner's close-up), nothing at eye level.
 */
function fireworks(vfx: VFX, x: number, z: number, alive: () => boolean): void {
  const shells: { ox: number; oz: number; y: number; d: number; kind: 'peony' | 'ring' | 'willow' | 'star' | 'crackle'; col: number }[] = [
    { ox: -1.15, oz: -0.5, y: 2.05, d: 0, kind: 'peony', col: 0xff4fd8 },
    { ox: 1.15, oz: -0.45, y: 2.15, d: 300, kind: 'ring', col: 0x3dfcff },
    { ox: 0.0, oz: -1.0, y: 2.35, d: 620, kind: 'willow', col: 0xa86bff },
    { ox: -0.95, oz: -0.7, y: 1.95, d: 980, kind: 'star', col: 0xe8fbff },
    { ox: 1.0, oz: -0.7, y: 1.9, d: 1300, kind: 'crackle', col: 0xffd76a },
  ];
  const list = vfx.detail >= 1 ? shells : shells.filter((_, i) => i % 2 === 0);
  for (const s of list) {
    setTimeout(() => {
      if (!alive()) return;
      // the rocket and its trail
      vfx.sparks.spawn(x + s.ox, 0.4, z + s.oz, 0, (s.y - 0.4) / 0.4, 0, 0.4, 0.15, 0.05, _c.setHex(s.col), 2.4, 0.4, 0);
      for (let k = 0; k < 4; k++) vfx.kit.motes.spawn({ x: x + s.ox, y: 0.5 + k * ((s.y - 0.5) / 4), z: z + s.oz, life: 0.3, w: 0.08, color: s.col, intensity: 1.6, delay: k * 0.09 });
      vfx.ring(x + s.ox, z + s.oz, _c.setHex(s.col), 0.2, 0.9, 0.3, 1.8);
      setTimeout(() => {
        if (!alive()) return;
        burstShape(vfx, s.kind, x + s.ox, s.y, z + s.oz, s.col);
      }, 400);
    }, s.d);
  }
}

function burstShape(vfx: VFX, kind: 'peony' | 'ring' | 'willow' | 'star' | 'crackle', x: number, y: number, z: number, col: number): void {
  const c = _c.setHex(col);
  vfx.flash(x, y, z, c, 0.5, 1.6, 0.2, 1.8);
  if (kind === 'peony') {
    // a full sphere of sparks
    for (let i = 0; i < 46; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = 2.1 + Math.random() * 0.4;
      vfx.sparks.spawn(x, y, z, Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp, 1.1, 0.11, 0.04, c, 2.2, 2.0, 1.2);
    }
  } else if (kind === 'ring') {
    // one flat ring, tilted toward the camera so it reads as an ellipse from any side
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2;
      const vx = Math.cos(a) * 2.2;
      const vy = Math.sin(a) * 2.2 * 0.85;
      vfx.sparks.spawn(x, y, z, vx, vy, Math.sin(a) * 1.0, 1.0, 0.12, 0.05, c, 2.4, 2.2, 0.6);
    }
    vfx.burst(x, y, z, _c.setHex(0xffffff), 8, 0.8, 0.07, 0.4, 2.2, 0, 0);
  } else if (kind === 'willow') {
    // slow, long-lived drooping trails in violet with gold tips
    for (let i = 0; i < 36; i++) {
      const u = Math.random() * 0.8 + 0.1;
      const a = Math.random() * Math.PI * 2;
      const sp = 1.4 + Math.random() * 0.5;
      vfx.sparks.spawn(x, y, z, Math.cos(a) * sp * (1 - u * 0.4), u * sp, Math.sin(a) * sp * (1 - u * 0.4), 1.8, 0.1, 0.07, i % 3 ? c : _c.setHex(0xffd76a), 2.0, 0.7, 2.6);
      _c.setHex(col);
    }
  } else if (kind === 'star') {
    // five straight arms in the burst's plane, sparks spaced along each arm
    for (let arm = 0; arm < 5; arm++) {
      const a = (arm / 5) * Math.PI * 2 + Math.PI / 2;
      for (let k = 1; k <= 6; k++) {
        const sp = k * 0.45;
        vfx.sparks.spawn(x, y, z, Math.cos(a) * sp, Math.sin(a) * sp, 0.25 * Math.sin(a), 0.9, 0.12, 0.05, k > 4 ? _c.setHex(0x3dfcff) : c, 2.3, 2.4, 0.4);
        _c.setHex(col);
      }
    }
  } else {
    // crackle: a cloud of glitter that twinkles (flickering stars), a few gold sparks falling out of it
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.75;
      vfx.kit.stars.spawn({ x: x + Math.cos(a) * r, y: y + (Math.random() - 0.5) * 0.8, z: z + Math.sin(a) * r * 0.6, vy: -0.25, life: 0.8 + Math.random() * 0.5, w: 0.15, w1: 0.06, rot: Math.random() * 6, color: i % 3 ? col : 0xffffff, intensity: 2.6, flicker: 22, delay: Math.random() * 0.25 });
    }
    vfx.burst(x, y, z, c, 16, 1.6, 0.09, 1.0, 2.0, 1.8, 0);
  }
}

/**
 * GOLDEN CONFETTI: a champion's celebration — two confetti cannons beside the winner fire twice: real paper confetti
 * (gold, champagne and white pieces that tumble, flutter and catch the light) and curling gold foil streamers arc over
 * the winner and drift down round him; a gold ring on the floor, a short flare of gold rays behind him, glints in the air.
 */
function goldenConfetti(vfx: VFX, x: number, z: number, alive: () => boolean): void {
  const per = vfx.detail >= 1 ? 46 : 24;
  const ribbons = vfx.detail >= 1 ? 6 : 3;
  for (const side of [-1, 1]) {
    const cx = x + side * 1.55;
    const cz = z + 0.25;
    for (const [wave, delay] of [
      [0, 0],
      [1, 0.42],
    ] as [number, number][]) {
      const n = wave ? Math.round(per * 0.55) : per;
      for (let i = 0; i < n; i++) {
        const sp = 5 + Math.random() * 3.2;
        const inward = -side * (1.0 + Math.random() * 1.6);
        vfx.kit.paper.spawn(cx, 0.6, cz, inward, sp, (Math.random() - 0.5) * 1.4, GOLD_PAPER[i % GOLD_PAPER.length], 2.6 + Math.random() * 0.8, 0.08 + Math.random() * 0.04, delay + Math.random() * 0.08);
      }
      for (let i = 0; i < (wave ? Math.ceil(ribbons / 2) : ribbons); i++) {
        vfx.kit.ribbons.spawn(cx, 0.9, cz, -side * (0.9 + Math.random() * 1.0), 6 + Math.random() * 2, (Math.random() - 0.5) * 0.8, i % 3 === 2 ? 0xfff1c4 : 0xffc93a, 2.8, delay + 0.03 * i);
      }
      setTimeout(() => {
        if (!alive()) return;
        vfx.flash(cx, 0.75, cz, _c.setHex(0xfff3c4), 0.4, 1.2, 0.18, 2.2);
        vfx.burst(cx, 0.75, cz, _c.setHex(0xffd23a), 10, 2.4, 0.09, 0.35, 2.2, 0, 3);
        vfx.soft.spawn(cx, 0.7, cz, -side * 0.3, 0.6, 0, 0.7, 0.25, 0.7, _c.setHex(0xf6efe0), 0.8, 1.2, -0.1);
      }, delay * 1000);
    }
  }
  vfx.ring(x, z, _c.setHex(0xffd23a), 1, 5.6, 1.0, 2.4);
  // rays of gold light flaring behind the winner with the first salvo (short — not SUNRISE's slow turning crown)
  vfx.kit.bigs.spawn(raysTexture(), x, 1.35, z - 0.35, 3.0, 3.0, 0xffd23a, 0.9, 1.1, { r0: 0, r1: 0.35, rT: 1.1, fadeIn: 0.12, fadeOut: 0.6 });
  for (let i = 0; i < (vfx.detail >= 1 ? 12 : 6); i++) {
    vfx.kit.stars.spawn({ x: x + (Math.random() - 0.5) * 2.4, y: 1.3 + Math.random() * 1.4, z: z + (Math.random() - 0.5) * 1.2, life: 0.5, w: 0.22, w1: 0.06, rot: Math.random() * 6, spin: 3, color: 0xffe58a, intensity: 2.4, flicker: 9, delay: 0.5 + Math.random() * 1.2 });
  }
}

/**
 * MIDNIGHT CONFETTI (WINTER SHOWDOWN): the hour strikes — a giant gold clock face appears behind the winner, its hands
 * sweep up to twelve, three chimes ring out from it, gold sparks fly off it, and then it snows: snowflakes and silver-blue-gold paper
 * confetti fall from above (from the top down — no cannons), a frost ring on the floor.
 */
function midnight(vfx: VFX, x: number, z: number, alive: () => boolean): void {
  const cz = z - 0.9;
  const cy = 1.75;
  vfx.kit.bigs.spawn(clockDialTexture(), x, cy, cz, 2.5, 2.5, 0xffffff, 1.15, 2.9, { fadeIn: 0.12, fadeOut: 0.3 });
  // the minute hand from ten to twelve, the hour hand the last few minutes (CCW positive: twelve = 0)
  vfx.kit.bigs.spawn(clockHandTexture(), x, cy, cz + 0.02, 0.26, 2.0, 0xffffff, 1.4, 2.8, { r0: Math.PI / 3, r1: 0, rT: 0.85, fadeIn: 0.12, fadeOut: 0.3 });
  vfx.kit.bigs.spawn(clockHandTexture(), x, cy, cz + 0.03, 0.34, 1.35, 0xffd36a, 1.4, 2.8, { r0: 0.35, r1: 0, rT: 0.85, fadeIn: 0.12, fadeOut: 0.3 });
  for (let k = 0; k < 3; k++) {
    vfx.kit.bigs.spawn(ringTexture(), x, cy, cz + 0.05, 1.2, 1.2, 0xffd36a, 2.0, 0.6, { delay: 0.9 + k * 0.28, grow: 1.6, fadeIn: 0.05, fadeOut: 0.8 });
  }
  setTimeout(() => {
    if (!alive()) return;
    vfx.flash(x, cy, cz, _c.setHex(0xfff2b0), 0.8, 2.6, 0.35, 1.6);
    // gold sparks off the clock as it strikes (the item's description)
    vfx.burst(x, cy, cz + 0.1, _c.setHex(0xffd36a), vfx.detail >= 1 ? 18 : 9, 2.2, 0.08, 0.8, 2.2, 1.4, 0);
    vfx.ring(x, z, _c.setHex(0x7fe3ff), 1, 5.8, 1.0, 2.4);
    const flakes = vfx.detail >= 1 ? 34 : 16;
    for (let i = 0; i < flakes; i++) {
      vfx.kit.snow.spawn({ x: x + (Math.random() - 0.5) * 3.4, y: 2.6 + Math.random() * 0.8, z: z + (Math.random() - 0.5) * 1.8, vy: -0.55 - Math.random() * 0.25, life: 2.2 + Math.random() * 0.6, w: 0.13 + Math.random() * 0.12, spin: (Math.random() - 0.5) * 2.4, color: 0xffffff, intensity: 1.7, sway: 0.18, delay: Math.random() * 0.5, fadeIn: 0.1 });
    }
    const papers = vfx.detail >= 1 ? 70 : 34;
    for (let i = 0; i < papers; i++) {
      vfx.kit.paper.spawn(x + (Math.random() - 0.5) * 3.0, 2.7 + Math.random() * 0.7, z + (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.6, -0.2, (Math.random() - 0.5) * 0.4, MIDNIGHT_PAPER[i % MIDNIGHT_PAPER.length], 2.4 + Math.random() * 0.6, 0.07 + Math.random() * 0.03, Math.random() * 0.6);
    }
  }, 900);
}

/**
 * PUMPKIN VICTORY (Halloween Premiere): a carousel of jack-o'-lanterns circles the winner, rising as it turns, a flock of
 * bats bursts out from behind him and flaps away, Halloween confetti pops over him, purple fog rolls along the floor
 * and green sparks drift up.
 */
function pumpkinVictory(vfx: VFX, x: number, z: number, alive: () => boolean): void {
  const lanterns = vfx.detail >= 1 ? 8 : 5;
  for (let i = 0; i < lanterns; i++) {
    vfx.kit.lanterns.spawn({ x, y: 0.95 + (i % 2) * 0.35, z, vy: 0.4, life: 2.6, w: 0.56, color: 0xffffff, intensity: 1.2, orbit: { cx: x, cz: z, r: 1.1, w: 1.8, a: (i / lanterns) * Math.PI * 2 }, delay: i * 0.05, fadeIn: 0.12 });
  }
  const bats = vfx.detail >= 1 ? 14 : 7;
  for (let i = 0; i < bats; i++) {
    const side = i % 2 ? 1 : -1;
    vfx.kit.bats.spawn({ x: x + side * 0.2, y: 1.45 + Math.random() * 0.35, z: z - 0.4, vx: side * (0.9 + Math.random() * 1.4), vy: 0.35 + Math.random() * 0.9, vz: (Math.random() - 0.2) * 0.8, life: 1.7 + Math.random() * 0.4, w: 0.72, h: 0.36, drag: 0.25, flap: 15 + Math.random() * 6, color: 0xffffff, intensity: 1, delay: 0.2 + Math.random() * 0.35, fadeIn: 0.08 });
  }
  for (let i = 0; i < (vfx.detail >= 1 ? 12 : 6); i++) {
    const a = (i / 12) * Math.PI * 2;
    vfx.soft.spawn(x + Math.cos(a) * 0.9, 0.18, z + Math.sin(a) * 0.9, Math.cos(a) * 0.5, 0.05, Math.sin(a) * 0.5, 1.8, 0.6, 1.4, _c.setHex(i % 2 ? 0x5a2290 : 0x3a1458), 1, 0.5, 0);
  }
  vfx.ring(x, z, _c.setHex(0xff8a1f), 1, 5.6, 0.9, 2.4);
  // the festive confetti in the Halloween colours (the item's description): one pop over the winner as the lanterns
  // reach the top, the pieces spreading out round him and fluttering down
  setTimeout(() => {
    if (!alive()) return;
    const n = vfx.detail >= 1 ? 40 : 20;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 1.3;
      vfx.kit.paper.spawn(x, 2.0, z, Math.cos(a) * sp, 2.0 + Math.random() * 1.2, Math.sin(a) * sp * 0.6, HALLOWEEN_PAPER[i % HALLOWEEN_PAPER.length], 2.2 + Math.random() * 0.5, 0.075 + Math.random() * 0.03, Math.random() * 0.12);
    }
  }, 950);
  setTimeout(() => {
    if (!alive()) return;
    for (let i = 0; i < 10; i++) vfx.kit.motes.spawn({ x: x + (Math.random() - 0.5) * 1.6, y: 0.4, z: z + (Math.random() - 0.5) * 1.0, vy: 0.9 + Math.random() * 0.6, life: 1.2, w: 0.12, color: PHANTOM_SPARK, intensity: 2.2, sway: 0.1 });
  }, 500);
}

/**
 * The winner's celebration: the equipped victory cosmetic or the season's confetti. `alive` stops the late waves when
 * the scene has moved on (a new match, the shop closed).
 */
export function victoryCelebration(vfx: VFX, fx: VictoryFx | null, x: number, z: number, seasonColors: number[], alive: () => boolean): void {
  if (fx === 'pumpkin') return pumpkinVictory(vfx, x, z, alive);
  if (fx === 'spotlights') return spotlights(vfx, x, z, alive);
  if (fx === 'sunrise') return sunrise(vfx, x, z, alive);
  if (fx === 'fireworks') return fireworks(vfx, x, z, alive);
  if (fx === 'midnight') return midnight(vfx, x, z, alive);
  if (fx === 'gold') return goldenConfetti(vfx, x, z, alive);
  vfx.confetti(x, 3, z, 160, seasonColors);
}
