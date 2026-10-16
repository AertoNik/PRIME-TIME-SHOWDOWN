// Alpha 1.4 NEW STAGES: the TV studio sets a fight can be broadcast from.
// Pure data. The fighting area (floor size, barrier, spawns, camera, AI) is the same
// on every stage — a stage only changes how the studio looks, its lighting and which
// set pieces stand on the barrier and react to hits. Rendering: src/render/stages/,
// selection rules: src/meta/ArenaSelection.ts. Guide: docs/ARENAS.md.
import { ARENA } from './balance';
import type { ThemeId } from './themes.config';

export type ArenaId = 'original' | 'casino' | 'backlot' | 'haunted';
/** What the player picked: a stage or a random available one. */
export type ArenaPref = ArenaId | 'random';

/** Set pieces on the barrier that react to hits (visual only: no damage, no rating). */
export type PropKind =
  | 'speaker'
  | 'chips'
  | 'neonSign'
  | 'roulette'
  | 'propWall'
  | 'spotlight'
  | 'crate'
  | 'clapper'
  | 'pumpkin'
  | 'gravestone'
  | 'lantern'
  | 'fogGate';

export interface ArenaPropDef {
  kind: PropKind;
  /** Position on (or just behind) the barrier: shots that hit the barrier nearby reach it. */
  x: number;
  z: number;
  /** Hits until it breaks. */
  hp: number;
  /** Seconds until it is rebuilt during the same fight (0 = stays broken until the next fight). */
  respawn: number;
  /** Reach around a barrier impact (default: 1.7 for heavy shots, 0.95 for normal ones). */
  radius?: number;
  /** Reactive set piece: never breaks, reacts to every nearby hit after `cooldown` seconds. */
  reactive?: boolean;
  cooldown?: number;
}

/** Studio lighting of a stage (no extra lights: the renderer's lights are recoloured and dimmed/boosted). */
export interface ArenaLighting {
  hemiSky: number;
  hemiGround: number;
  key: number;
  fillA: number;
  fillB: number;
  rim: number;
  fog: number;
  intensity: { hemi: number; key: number; fill: number; rim: number };
}

export interface ArenaDef {
  id: ArenaId;
  /** Set name, e.g. LUXURY CASINO SET. */
  name: string;
  /** Show title of the set, e.g. HIGH ROLLER SHOWDOWN. */
  show: string;
  /** One-line description for the picker (Russian). */
  description: string;
  availability: { kind: 'permanent' } | { kind: 'seasonal'; themeId: ThemeId; event: string };
  /** Short broadcast caption shown before the fight. */
  caption: string;
  props: ArenaPropDef[];
  lighting: ArenaLighting;
  /**
   * How strongly a seasonal or BOSS FIGHT theme recolours this stage's lights
   * (0 = the stage keeps its own light, 1 = the theme decides, as on the original studio).
   */
  themeTint: number;
  /** The stage already dresses itself for this season (seasonal decor then only adds ambience). */
  nativeSeason?: ThemeId;
  /** Picker card colours (CSS). */
  colors: { a: string; b: string; ink: string };
}

const N = ARENA.wallZ;
const W = ARENA.wallX;
// the middle of each rounded barrier corner (where many stray shots land)
const CX = W - ARENA.wallCorner + ARENA.wallCorner * Math.SQRT1_2;
const CZ = N - ARENA.wallCorner + ARENA.wallCorner * Math.SQRT1_2;

export const ARENAS: Record<ArenaId, ArenaDef> = {
  original: {
    id: 'original',
    name: 'ORIGINAL PRIME ARENA',
    show: 'PRIME TIME: SHOWDOWN',
    description: 'Родной павильон шоу: неоновая арена, трибуны со зрителями и LED-колонки на бортах.',
    availability: { kind: 'permanent' },
    caption: 'NEXT BROADCAST — ORIGINAL PRIME ARENA',
    // the LED speaker stacks of Alpha 1.0: rebuilt 10 s after they break
    props: ARENA.props.map((p) => ({ kind: 'speaker' as const, x: p.x, z: p.z, hp: 1, respawn: ARENA.propRespawn })),
    lighting: {
      hemiSky: 0x9fb6ff,
      hemiGround: 0x3a1f4a,
      key: 0xfff2e0,
      fillA: 0x22d8ff,
      fillB: 0xff6a2a,
      rim: 0x6fe8ff,
      fog: 0x070816,
      intensity: { hemi: 1.35, key: 2.4, fill: 0.85, rim: 1.5 },
    },
    themeTint: 1,
    colors: { a: '#22f0e0', b: '#ff7a1a', ink: '#0a0f28' },
  },

  casino: {
    id: 'casino',
    name: 'LUXURY CASINO SET',
    show: 'HIGH ROLLER SHOWDOWN',
    description: 'Элитный VIP-выпуск: павильон-казино с бархатом, золотом, рулетками и гигантскими фишками.',
    availability: { kind: 'permanent' },
    caption: 'NEXT BROADCAST — LUXURY CASINO SET',
    props: [
      { kind: 'neonSign', x: 0, z: -N - 0.15, hp: 3, respawn: 0, radius: 1.75 },
      { kind: 'chips', x: -2.9, z: -N - 0.15, hp: 1, respawn: 0 },
      { kind: 'chips', x: 2.9, z: -N - 0.15, hp: 1, respawn: 0 },
      { kind: 'chips', x: -CX - 0.1, z: -CZ - 0.1, hp: 1, respawn: 0 },
      { kind: 'chips', x: CX + 0.1, z: -CZ - 0.1, hp: 1, respawn: 0 },
      { kind: 'chips', x: -W - 0.15, z: -2.6, hp: 1, respawn: 0 },
      { kind: 'chips', x: W + 0.15, z: -2.6, hp: 1, respawn: 0 },
      { kind: 'chips', x: -W - 0.15, z: 1.6, hp: 1, respawn: 0 },
      { kind: 'chips', x: W + 0.15, z: 1.6, hp: 1, respawn: 0 },
      { kind: 'roulette', x: -CX - 1.5, z: -CZ - 1.5, hp: 1, respawn: 0, radius: 2.5, reactive: true, cooldown: 0.5 },
      { kind: 'roulette', x: CX + 1.5, z: -CZ - 1.5, hp: 1, respawn: 0, radius: 2.5, reactive: true, cooldown: 0.5 },
    ],
    lighting: {
      hemiSky: 0xffd9b0,
      hemiGround: 0x3a1012,
      key: 0xfff0d6,
      fillA: 0xffb347,
      fillB: 0xd0203a,
      rim: 0xffd27a,
      fog: 0x0d0507,
      intensity: { hemi: 1.25, key: 2.45, fill: 0.85, rim: 1.5 },
    },
    themeTint: 0.45,
    colors: { a: '#ffd76a', b: '#c8102e', ink: '#1a0508' },
  },

  backlot: {
    id: 'backlot',
    name: 'PRIME MOVIE BACKLOT',
    show: 'ACTION TAKE ONE',
    description: 'Съёмочный павильон боевика: улица из фанеры, камеры, краны и прожекторы прямо в кадре.',
    availability: { kind: 'permanent' },
    caption: 'NEXT BROADCAST — PRIME MOVIE BACKLOT',
    props: [
      { kind: 'clapper', x: 0, z: -N - 0.2, hp: 1, respawn: 0, radius: 1.1 },
      { kind: 'propWall', x: -2.6, z: -N - 0.2, hp: 1, respawn: 0, radius: 1.15 },
      { kind: 'propWall', x: 2.6, z: -N - 0.2, hp: 1, respawn: 0, radius: 1.15 },
      { kind: 'spotlight', x: -CX - 0.15, z: -CZ - 0.15, hp: 3, respawn: 0, radius: 1.3, reactive: true, cooldown: 0.45 },
      { kind: 'spotlight', x: CX + 0.15, z: -CZ - 0.15, hp: 3, respawn: 0, radius: 1.3, reactive: true, cooldown: 0.45 },
      { kind: 'propWall', x: -W - 0.2, z: -3, hp: 1, respawn: 0, radius: 1.15 },
      { kind: 'propWall', x: W + 0.2, z: -3, hp: 1, respawn: 0, radius: 1.15 },
      { kind: 'crate', x: -W - 0.2, z: 0.9, hp: 1, respawn: 0 },
      { kind: 'crate', x: W + 0.2, z: 0.9, hp: 1, respawn: 0 },
      { kind: 'crate', x: -W - 0.2, z: 4.1, hp: 1, respawn: 0 },
      { kind: 'crate', x: W + 0.2, z: 4.1, hp: 1, respawn: 0 },
    ],
    lighting: {
      hemiSky: 0x9fb8ff,
      hemiGround: 0x2a1a10,
      key: 0xffd2a0,
      fillA: 0x4a7aff,
      fillB: 0xff8a2a,
      rim: 0x8fd0ff,
      fog: 0x070a14,
      intensity: { hemi: 1.2, key: 2.6, fill: 0.95, rim: 1.4 },
    },
    themeTint: 0.45,
    colors: { a: '#ff9a3a', b: '#3a6aff', ink: '#0a1020' },
  },

  haunted: {
    id: 'haunted',
    name: 'HAUNTED PRIME SET',
    show: 'MIDNIGHT BROADCAST',
    description: 'Мистический павильон Halloween Premiere: бутафорский особняк, сценическая луна, тыквы и туман.',
    availability: { kind: 'seasonal', themeId: 'halloween', event: 'Halloween Premiere' },
    caption: 'NEXT BROADCAST — HAUNTED PRIME SET',
    props: [
      { kind: 'fogGate', x: 0, z: -N - 0.3, hp: 1, respawn: 0, radius: 1.7, reactive: true, cooldown: 2.2 },
      { kind: 'pumpkin', x: -2.4, z: -N - 0.15, hp: 1, respawn: 0 },
      { kind: 'pumpkin', x: 2.4, z: -N - 0.15, hp: 1, respawn: 0 },
      { kind: 'gravestone', x: -CX - 0.15, z: -CZ - 0.15, hp: 2, respawn: 0, radius: 1.1 },
      { kind: 'gravestone', x: CX + 0.15, z: -CZ - 0.15, hp: 2, respawn: 0, radius: 1.1 },
      { kind: 'lantern', x: -W - 0.15, z: -3.4, hp: 1, respawn: 0 },
      { kind: 'lantern', x: W + 0.15, z: -3.4, hp: 1, respawn: 0 },
      { kind: 'pumpkin', x: -W - 0.15, z: -0.6, hp: 1, respawn: 0 },
      { kind: 'pumpkin', x: W + 0.15, z: -0.6, hp: 1, respawn: 0 },
      { kind: 'gravestone', x: -W - 0.2, z: 2.6, hp: 2, respawn: 0, radius: 1.05 },
      { kind: 'gravestone', x: W + 0.2, z: 2.6, hp: 2, respawn: 0, radius: 1.05 },
    ],
    lighting: {
      hemiSky: 0xb8a0ff,
      hemiGround: 0x1a0a24,
      key: 0xe8dcff,
      fillA: 0x8a3dff,
      fillB: 0xff7a1a,
      rim: 0xa6c8ff,
      fog: 0x0a0614,
      intensity: { hemi: 1.2, key: 2.1, fill: 0.95, rim: 1.6 },
    },
    themeTint: 0.35,
    nativeSeason: 'halloween',
    colors: { a: '#b45cff', b: '#ff8a1f', ink: '#0e0618' },
  },
};

export const ARENA_ORDER: ArenaId[] = ['original', 'casino', 'backlot', 'haunted'];

export function isArenaId(v: unknown): v is ArenaId {
  return typeof v === 'string' && v in ARENAS;
}

export function arenaById(id: string | null | undefined): ArenaDef {
  return isArenaId(id) ? ARENAS[id] : ARENAS.original;
}
