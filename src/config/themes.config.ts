// Visual themes (seasons). A theme is pure data: CSS design tokens for the UI,
// colours/texts for the 3D arena, VFX palette, decor kinds and an audio sting.
// ThemeManager (src/game/ThemeManager.ts) applies it; nothing else needs to change
// to add a new look. See docs/SEASONAL_EVENTS.md.

export type ThemeId = 'default' | 'halloween' | 'winter' | 'champion' | 'champion_halloween';

/** 3D decoration sets built by render/SeasonalDecor.ts. */
export type DecorKind = 'none' | 'pumpkins' | 'frost' | 'champion' | 'championHalloween';
/** Floating ambient particles in the arena. */
export type AmbientKind = 'none' | 'spirits' | 'snow';
/** DOM decoration on menu screens (corners + a few floating glyphs). */
export type UiDecorKind = 'none' | 'cobweb' | 'frost';
export type StingKind = 'none' | 'spooky' | 'frost' | 'champion';

export interface Sponsor {
  text: string;
  bg: string;
  fg: string;
}

export interface ArenaTheme {
  /** Light colours (hex). Intensities stay as in the default scene. */
  lights: { hemiSky: number; hemiGround: number; fillA: number; fillB: number; rim: number; fog: number };
  /** Four moving spotlight cone colours. */
  spots: [number, number, number, number];
  /** Crowd glow-stick colours. */
  sticks: number[];
  /** Neon signs: big one above the screen, side signs, small ON AIR sign. */
  neon: { main: [string, string]; side: [string, string]; live: [string, string] };
  /** LED ribbon around the walls. */
  sponsors: Sponsor[];
  boardLive: [string, string];
  /** Big TV screen in menus / during the fight. */
  screen: { title: string; subtitle: string; colorA: string; colorB: string; bgTop: string; bgBottom: string; fightHeadline: string };
  decor: DecorKind;
  ambient: AmbientKind;
  ambientColors: number[];
}

export interface ThemeDef {
  id: ThemeId;
  label: string;
  /** CSS custom properties (see :root in styles/main.css). Empty = stylesheet defaults. */
  css: Record<string, string>;
  arena: ArenaTheme;
  /** VFX accents: combo bursts, confetti. */
  vfx: { combo: number[]; confetti: number[] };
  ui: { decor: UiDecorKind; particleColors: string[] };
  sting: StingKind;
}

// The stock PRIME TIME look. Values mirror the original scene so switching back restores it exactly.
const DEFAULT_ARENA: ArenaTheme = {
  lights: { hemiSky: 0x9fb6ff, hemiGround: 0x3a1f4a, fillA: 0x22d8ff, fillB: 0xff6a2a, rim: 0x6fe8ff, fog: 0x070816 },
  spots: [0x22d8ff, 0xff6a2a, 0x7a5bff, 0xff3df0],
  sticks: [0x22f0e0, 0xff7a1a, 0xff4fd8, 0xffe14d, 0x7aa8ff, 0xffffff],
  neon: { main: ['PRIME TIME', '#22f0e0'], side: ['SHOWDOWN', '#ff7a1a'], live: ['● ON AIR', '#ff2a4a'] },
  sponsors: [
    { text: 'VOLTA COLA', bg: '#e8202a', fg: '#ffffff' },
    { text: 'HYPERDRIVE', bg: '#101433', fg: '#22f0e0' },
    { text: 'NEON NOODLE', bg: '#ffcc1a', fg: '#1a1033' },
    { text: 'KINETIX', bg: '#7a2bff', fg: '#ffffff' },
  ],
  boardLive: ['PRIME TIME', 'SHOWDOWN'],
  screen: { title: 'PRIME TIME', subtitle: 'SHOWDOWN', colorA: '#22f0e0', colorB: '#ff7a1a', bgTop: '#0d1440', bgBottom: '#060818', fightHeadline: '' },
  decor: 'none',
  ambient: 'none',
  ambientColors: [],
};

// champion_halloween is added below (it is built from the champion look)
const BASE_THEMES: Record<Exclude<ThemeId, 'champion_halloween'>, ThemeDef> = {
  default: {
    id: 'default',
    label: 'PRIME TIME',
    css: {},
    arena: DEFAULT_ARENA,
    vfx: { combo: [0xffd23a], confetti: [0x22f0e0, 0xff7a1a, 0xff4fd8, 0xffe14d, 0x7aa8ff, 0xffffff] },
    ui: { decor: 'none', particleColors: [] },
    sting: 'none',
  },

  // Retro-futuristic Halloween TV special: purple, graphite, neon orange, soft acid green.
  halloween: {
    id: 'halloween',
    label: 'HALLOWEEN',
    css: {
      '--bg': '#07040d',
      '--navy-950': '#0f0a1a',
      '--navy-900': '#150d24',
      '--navy-850': '#1b1030',
      '--navy-800': '#24143e',
      '--navy-700': '#2e1a50',
      '--line': 'rgba(190, 120, 255, 0.18)',
      '--line-rgb': '200, 140, 255',
      '--muted': '#b49ed8',
      '--dim': '#6f5a94',
      '--teal': '#a8ff60',
      '--teal-2': '#72d63c',
      '--teal-rgb': '168, 255, 96',
      '--shade-rgb': '10, 5, 18',
      '--pop-rgb': '26, 12, 42',
      '--panel-a': 'rgba(48, 24, 80, 0.94)',
      '--panel-b': 'rgba(20, 11, 34, 0.96)',
      '--surface-a': 'rgba(78, 42, 124, 0.92)',
      '--surface-b': 'rgba(32, 17, 54, 0.96)',
      '--tile-a': 'rgba(44, 24, 74, 0.92)',
      '--tile-b': 'rgba(20, 11, 34, 0.94)',
      '--btn-a': '#ffc05a',
      '--btn-b': '#ff8a1f',
      '--btn-c': '#ff5e14',
      '--btn-edge': '#963008',
      '--btn-glow': 'rgba(255, 130, 30, 0.38)',
      '--btn2-a': '#dcff98',
      '--btn2-b': '#a8ff60',
      '--btn2-c': '#6fd23a',
      '--btn2-edge': '#3b7418',
      '--btn2-ink': '#16290a',
      '--app-glow-1': 'rgba(150, 60, 255, 0.24)',
      '--app-glow-2': 'rgba(255, 120, 30, 0.18)',
      '--rating-grad': 'linear-gradient(90deg, #9dff5c, #a64dff 45%, #ff5ad8 70%, #ffb21a)',
      '--edge-glow': 'rgba(255, 140, 40, 0.8)',
      '--card-ring': 'rgba(255, 170, 80, 0.6)',
      '--card-glow': 'rgba(166, 77, 255, 0.35)',
      '--live-bg': '#ff6a1a',
      '--season-a': '#b45cff',
      '--season-b': '#ff8a1f',
    },
    arena: {
      lights: { hemiSky: 0xb9a0ff, hemiGround: 0x2a1236, fillA: 0x9a4dff, fillB: 0xff7a2a, rim: 0xa6ff8a, fog: 0x0b0614 },
      spots: [0xa64dff, 0xff7a1a, 0x8dff5a, 0xd04dff],
      sticks: [0xff8a1f, 0xa64dff, 0x9dff5c, 0xffb347, 0xd96bff, 0xffffff],
      neon: { main: ['PRIME TIME', '#b45cff'], side: ['HALLOWEEN', '#ff8a1f'], live: ['● SPOOKY LIVE', '#9dff5c'] },
      sponsors: [
        { text: 'PUMPKIN COLA', bg: '#ff7a1a', fg: '#1a0a24' },
        { text: 'GHOST NOODLE', bg: '#1c0f2e', fg: '#a8ff60' },
        { text: 'HALLOWEEN SPECIAL', bg: '#6a1fc8', fg: '#ffd27a' },
        { text: 'KINETIX', bg: '#14081f', fg: '#ff8a1f' },
      ],
      boardLive: ['HALLOWEEN', 'SPECIAL'],
      screen: {
        title: 'HALLOWEEN',
        subtitle: 'SPECIAL',
        colorA: '#b45cff',
        colorB: '#ff8a1f',
        bgTop: '#1c0b30',
        bgBottom: '#08040e',
        fightHeadline: 'HALLOWEEN SPECIAL',
      },
      decor: 'pumpkins',
      ambient: 'spirits',
      ambientColors: [0xff8a1f, 0xa8ff60, 0xb45cff],
    },
    vfx: { combo: [0xffd23a, 0xff8a1f, 0xb45cff, 0xa8ff60], confetti: [0xff8a1f, 0xb45cff, 0xa8ff60, 0xffd27a, 0x1a0a24, 0xffffff] },
    ui: { decor: 'cobweb', particleColors: ['#ff8a1f', '#b45cff', '#a8ff60'] },
    sting: 'spooky',
  },

  // Visual-only preset proving the system: icy blues, frost and snow. No quests yet.
  winter: {
    id: 'winter',
    label: 'WINTER',
    css: {
      '--bg': '#040812',
      '--navy-950': '#08101f',
      '--navy-900': '#0c1730',
      '--navy-850': '#10203c',
      '--navy-800': '#152a4c',
      '--line': 'rgba(150, 210, 255, 0.18)',
      '--line-rgb': '170, 220, 255',
      '--muted': '#9fb8dc',
      '--teal': '#8fe8ff',
      '--teal-2': '#5cc4f0',
      '--teal-rgb': '143, 232, 255',
      '--shade-rgb': '4, 8, 18',
      '--pop-rgb': '12, 24, 46',
      '--panel-a': 'rgba(24, 48, 92, 0.94)',
      '--panel-b': 'rgba(10, 20, 42, 0.96)',
      '--surface-a': 'rgba(44, 82, 140, 0.92)',
      '--surface-b': 'rgba(16, 32, 64, 0.96)',
      '--tile-a': 'rgba(24, 46, 86, 0.92)',
      '--tile-b': 'rgba(10, 20, 42, 0.94)',
      '--btn-a': '#ff9a8a',
      '--btn-b': '#ff5a5a',
      '--btn-c': '#e83a4a',
      '--btn-edge': '#8a1424',
      '--btn-glow': 'rgba(255, 80, 90, 0.32)',
      '--btn2-a': '#f2fdff',
      '--btn2-b': '#a9ecff',
      '--btn2-c': '#5cc4f0',
      '--btn2-edge': '#1d6a92',
      '--btn2-ink': '#06233a',
      '--app-glow-1': 'rgba(120, 200, 255, 0.22)',
      '--app-glow-2': 'rgba(255, 255, 255, 0.08)',
      '--rating-grad': 'linear-gradient(90deg, #8fe8ff, #7a9bff 45%, #d6f6ff 75%, #ffffff)',
      '--edge-glow': 'rgba(170, 230, 255, 0.8)',
      '--card-ring': 'rgba(200, 240, 255, 0.6)',
      '--card-glow': 'rgba(120, 200, 255, 0.3)',
      '--season-a': '#8fe8ff',
      '--season-b': '#ff5a5a',
    },
    arena: {
      lights: { hemiSky: 0xc8e4ff, hemiGround: 0x1a2a44, fillA: 0x6fd0ff, fillB: 0xffffff, rim: 0xbfe8ff, fog: 0x070d1a },
      spots: [0x8fe8ff, 0xffffff, 0x6f8dff, 0xbfe8ff],
      sticks: [0xffffff, 0x8fe8ff, 0xff5a5a, 0x9dffc8, 0xbfd4ff],
      neon: { main: ['PRIME TIME', '#8fe8ff'], side: ['WINTER', '#ffffff'], live: ['● ON AIR', '#ff5a5a'] },
      sponsors: [
        { text: 'FROST COLA', bg: '#e83a4a', fg: '#ffffff' },
        { text: 'HYPERDRIVE', bg: '#0c1730', fg: '#8fe8ff' },
        { text: 'WINTER GALA', bg: '#f2fdff', fg: '#0c1730' },
        { text: 'KINETIX', bg: '#2a5cff', fg: '#ffffff' },
      ],
      boardLive: ['WINTER', 'GALA'],
      screen: { title: 'WINTER', subtitle: 'GALA', colorA: '#8fe8ff', colorB: '#ffffff', bgTop: '#0c2140', bgBottom: '#050a16', fightHeadline: 'WINTER GALA' },
      decor: 'frost',
      ambient: 'snow',
      ambientColors: [0xffffff, 0xcfefff],
    },
    vfx: { combo: [0xffd23a, 0x8fe8ff, 0xffffff], confetti: [0xffffff, 0x8fe8ff, 0xff5a5a, 0x9dffc8, 0xbfd4ff] },
    ui: { decor: 'frost', particleColors: ['#ffffff', '#cfefff'] },
    sting: 'frost',
  },

  // Alpha 1.3.1 BOSS FIGHT: championship dressing of the same studio (not a season).
  // Applied only for the boss fight and its results; the season theme returns afterwards.
  champion: {
    id: 'champion',
    label: 'LEGENDARY SHOWDOWN · CHAMPIONSHIP EDITION',
    css: {
      '--bg': '#07060a',
      '--navy-950': '#0d0b10',
      '--navy-900': '#14111a',
      '--navy-850': '#1a1620',
      '--navy-800': '#221c28',
      '--navy-700': '#2c2433',
      '--line': 'rgba(255, 200, 90, 0.18)',
      '--line-rgb': '255, 205, 110',
      '--muted': '#cdb88e',
      '--dim': '#7a6a4c',
      '--teal': '#ffd76a',
      '--teal-2': '#e8b23a',
      '--teal-rgb': '255, 215, 106',
      '--shade-rgb': '8, 6, 10',
      '--pop-rgb': '26, 18, 12',
      '--panel-a': 'rgba(42, 33, 30, 0.95)',
      '--panel-b': 'rgba(16, 12, 16, 0.97)',
      '--surface-a': 'rgba(72, 56, 40, 0.92)',
      '--surface-b': 'rgba(28, 22, 22, 0.96)',
      '--tile-a': 'rgba(46, 36, 30, 0.92)',
      '--tile-b': 'rgba(18, 14, 16, 0.94)',
      '--btn-a': '#ffe08a',
      '--btn-b': '#f2b632',
      '--btn-c': '#d8901a',
      '--btn-edge': '#7a4a08',
      '--btn-glow': 'rgba(255, 190, 60, 0.38)',
      '--btn2-a': '#ff8a96',
      '--btn2-b': '#e8283c',
      '--btn2-c': '#b8142a',
      '--btn2-edge': '#5a0814',
      '--btn2-ink': '#fff3f0',
      '--app-glow-1': 'rgba(255, 180, 60, 0.18)',
      '--app-glow-2': 'rgba(220, 30, 50, 0.16)',
      '--rating-grad': 'linear-gradient(90deg, #ffe08a, #ffb43a 45%, #ff5a3a 75%, #e8203c)',
      '--edge-glow': 'rgba(255, 200, 60, 0.85)',
      '--card-ring': 'rgba(255, 215, 106, 0.55)',
      '--card-glow': 'rgba(255, 180, 60, 0.25)',
      '--live-bg': '#e8203c',
      '--season-a': '#ffd76a',
      '--season-b': '#e8203c',
    },
    arena: {
      lights: { hemiSky: 0xffe6bf, hemiGround: 0x2a1418, fillA: 0xffb43a, fillB: 0xe8203c, rim: 0xffe08a, fog: 0x0a0708 },
      spots: [0xffc23a, 0xfff1c0, 0xffa31a, 0xffffff],
      sticks: [0xffd76a, 0xffffff, 0xe8203c, 0xffb43a, 0xfff1c0],
      neon: { main: ['LEGENDARY', '#ffd76a'], side: ['SHOWDOWN', '#ff3a4a'], live: ['● TITLE FIGHT', '#ffd76a'] },
      sponsors: [
        { text: 'CHAMPION GOLD', bg: '#1a1208', fg: '#ffd76a' },
        { text: 'VICTOR VALE', bg: '#e8203c', fg: '#fff3e0' },
        { text: 'LEGENDARY SHOWDOWN', bg: '#ffd76a', fg: '#1a1208' },
        { text: 'PRIME TIME', bg: '#14111a', fg: '#ffb43a' },
      ],
      boardLive: ['TITLE', 'FIGHT'],
      screen: {
        title: 'LEGENDARY',
        subtitle: 'SHOWDOWN',
        colorA: '#ffd76a',
        colorB: '#ff3a4a',
        bgTop: '#2a1a08',
        bgBottom: '#0a0608',
        fightHeadline: 'CHAMPIONSHIP EDITION · TITLE FIGHT',
      },
      decor: 'champion',
      ambient: 'spirits',
      ambientColors: [0xffd76a, 0xffb43a, 0xff3a4a],
    },
    vfx: { combo: [0xffd23a, 0xffe08a, 0xff3a4a], confetti: [0xffd76a, 0xffffff, 0xe8203c, 0xffb43a, 0x1a1208] },
    ui: { decor: 'none', particleColors: [] },
    sting: 'champion',
  },
};

// Alpha 1.4: BOSS FIGHT during Halloween Premiere — LEGENDARY SHOWDOWN · HALLOWEEN SPECIAL.
// The championship stays in charge (gold, crimson, crowns, title banners) and the season
// adds its accents: violet and pumpkin-orange light, jack-o'-lanterns, festive screens.
const CHAMPION_HALLOWEEN: ThemeDef = {
  id: 'champion_halloween',
  label: 'LEGENDARY SHOWDOWN · HALLOWEEN SPECIAL',
  css: {
    ...BASE_THEMES.champion.css,
    '--navy-950': '#0f0a14',
    '--navy-900': '#17101f',
    '--navy-850': '#1e1428',
    '--navy-800': '#281a34',
    '--navy-700': '#342242',
    '--line': 'rgba(255, 170, 90, 0.2)',
    '--muted': '#d2b496',
    '--panel-a': 'rgba(46, 28, 44, 0.95)',
    '--panel-b': 'rgba(18, 11, 20, 0.97)',
    '--surface-a': 'rgba(78, 48, 62, 0.92)',
    '--surface-b': 'rgba(30, 18, 30, 0.96)',
    '--app-glow-1': 'rgba(255, 170, 50, 0.18)',
    '--app-glow-2': 'rgba(150, 60, 255, 0.2)',
    '--rating-grad': 'linear-gradient(90deg, #ffe08a, #ff9a2a 40%, #c04dff 75%, #8a2bff)',
    '--live-bg': '#ff6a1a',
    '--season-a': '#ffd76a',
    '--season-b': '#b45cff',
  },
  arena: {
    ...BASE_THEMES.champion.arena,
    lights: { hemiSky: 0xf0c8ff, hemiGround: 0x2a1028, fillA: 0xffb43a, fillB: 0xa64dff, rim: 0xffa040, fog: 0x0c0712 },
    spots: [0xffc23a, 0xa64dff, 0xff7a1a, 0xfff1c0],
    sticks: [0xffd76a, 0xff8a1f, 0xb45cff, 0xffffff, 0xffb43a],
    neon: { main: ['LEGENDARY', '#ffd76a'], side: ['HALLOWEEN', '#ff8a1f'], live: ['● TITLE FIGHT', '#c070ff'] },
    sponsors: [
      { text: 'CHAMPION GOLD', bg: '#1a1208', fg: '#ffd76a' },
      { text: 'PUMPKIN COLA', bg: '#ff7a1a', fg: '#1a0a24' },
      { text: 'LEGENDARY SHOWDOWN', bg: '#ffd76a', fg: '#1a1208' },
      { text: 'HALLOWEEN SPECIAL', bg: '#5a1fa8', fg: '#ffd27a' },
    ],
    boardLive: ['TITLE FIGHT', 'HALLOWEEN SPECIAL'],
    screen: {
      title: 'LEGENDARY',
      subtitle: 'HALLOWEEN SPECIAL',
      colorA: '#ffd76a',
      colorB: '#ff8a1f',
      bgTop: '#2a1030',
      bgBottom: '#0a0610',
      fightHeadline: 'HALLOWEEN SPECIAL · TITLE FIGHT',
    },
    decor: 'championHalloween',
    ambient: 'spirits',
    ambientColors: [0xffd76a, 0xff8a1f, 0xb45cff],
  },
  vfx: { combo: [0xffd23a, 0xff8a1f, 0xb45cff], confetti: [0xffd76a, 0xff8a1f, 0xb45cff, 0xffffff, 0x1a1208] },
  ui: { decor: 'none', particleColors: [] },
  sting: 'champion',
};

export const THEMES: Record<ThemeId, ThemeDef> = { ...BASE_THEMES, champion_halloween: CHAMPION_HALLOWEEN };

/**
 * The BOSS FIGHT look for the season that is running: the championship edition
 * by default, its HALLOWEEN SPECIAL during Halloween. A future season adds its own
 * entry here (falls back to the plain championship look until then).
 */
export function championThemeFor(seasonThemeId: string): ThemeId {
  return seasonThemeId === 'halloween' ? 'champion_halloween' : 'champion';
}

/**
 * BOSS FIGHT phase spotlights. The championship keeps the boss config's colours;
 * the HALLOWEEN SPECIAL swaps in violet / pumpkin palettes that heat up per phase.
 */
const HALLOWEEN_PHASE_SPOTS: [number, number, number, number][] = [
  [0xffc23a, 0xa64dff, 0xff7a1a, 0xfff1c0],
  [0xff7a1a, 0xa64dff, 0xffc23a, 0xd04dff],
  [0xa64dff, 0xff3a1a, 0x7a2aff, 0xff7a1a],
];

export function bossPhaseSpots(themeId: ThemeId, phaseIndex: number, base: number[]): number[] {
  if (themeId !== 'champion_halloween') return base;
  return HALLOWEEN_PHASE_SPOTS[Math.max(0, Math.min(HALLOWEEN_PHASE_SPOTS.length - 1, phaseIndex))];
}

/** Screen flash when the champion enters a new phase. */
export function bossPhaseFlash(themeId: ThemeId, phase: number): number {
  if (themeId === 'champion_halloween') return phase >= 3 ? 0xa64dff : 0xff8a1f;
  return phase >= 3 ? 0xff3a4a : 0xffc23a;
}

export function themeById(id: string | null | undefined): ThemeDef {
  return (id && THEMES[id as ThemeId]) || THEMES.default;
}
