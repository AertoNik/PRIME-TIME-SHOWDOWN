import { artImg, registerFallback } from './artIcons';
import { UI_ICONS } from './icons';
import { DUEL_EMBLEM, MODE_ICONS } from './modeArt';

// Beta 2.3 — the owner's pictures of the main screen and the game modes (PRIME_TIME_2_3_UI_MODE_ART_REFINED →
// scripts/art/prepare_art.py --icons-24 → public/ui/{ui,nav,modes}/…). Only pictures change: every button, its action,
// its label (HTML text — never part of a picture, ready for localisation) and its states stay as they were. Each picture
// falls back to its earlier drawing if its file cannot be loaded.

/** The main screen's own icons (each IS its button's face — never a button drawn inside a button). */
export type UiIcon = 'gift' | 'invite' | 'shop' | 'cards' | 'settings';

const UI_OLD: Record<UiIcon, () => string> = {
  gift: () => UI_ICONS.gift,
  invite: () => UI_ICONS.invite,
  shop: () => UI_ICONS.shop,
  cards: () => UI_ICONS.cards,
  settings: () => UI_ICONS.gear,
};

/** A main-screen icon at `size` CSS px. */
export function uiIcon(id: UiIcon, size: number, cls = ''): string {
  return artImg('ui', id, size, { cls: `ui-pic ${cls}`, fb: `uiic|${id}` });
}
registerFallback('uiic', ([id]) => (UI_OLD[id as UiIcon] ?? UI_OLD.gift)());

/**
 * The bottom bar's button skins (the label stays HTML): the share of the picture's width that is the emblem (`l`) and
 * the rounded end (`r`), and its aspect — the same numbers as scripts/art/manifest.json `icons.nav` (npm run art24
 * checks they agree). CSS draws the emblem and the end unscaled and stretches only the panel between (border-image),
 * so no button width distorts the emblem.
 */
export const NAV_SKIN = {
  fighters: { l: 0.46, r: 0.14, aspect: 3.6981 },
  career: { l: 0.5, r: 0.16, aspect: 3.1408 },
  collection: { l: 0.36, r: 0.14, aspect: 3.7513 },
} as const;
export type NavSkin = keyof typeof NAV_SKIN;

const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';

/**
 * Beta 2.3 release fix: the skin's address is ABSOLUTE. A url() inside a CSS custom property is resolved where var() is
 * used — the stylesheet in assets/ — so the relative './ui/…' of the published build (base './') pointed at
 * assets/ui/nav/… (404) and the three skins did not show; dev (base '/') hid it. Resolved against the page here.
 */
export function skinUrl(rel: string): string {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  try {
    return new URL(BASE + rel, base).href;
  } catch {
    return BASE + rel;
  }
}

/**
 * The inline style of a skinned bottom-bar button: the picture (the sharper variant — the bar is 48 px tall, 3× on an
 * iPhone ≈ 144 px: «sm» is 160 px) and its slice shares as CSS variables (main.css `.nav-skin`).
 */
export function navSkinStyle(id: NavSkin): string {
  const s = NAV_SKIN[id];
  return `--skin:url('${skinUrl(`ui/nav/sm/${id}.webp`)}');--lk:${(s.l * s.aspect).toFixed(4)};--rk:${(s.r * s.aspect).toFixed(4)};--sl:${Math.round(s.l * 1000) / 10}%;--sr:${Math.round(s.r * 1000) / 10}%`;
}

/** The game modes with the owner's picture: the career's three cards and PRIME LEAGUE's two series. */
export type ModePic = 'classic_duel' | 'survival' | 'prime_challenge' | 'prime_squad' | 'prime_rush';

const MODE_OLD: Record<ModePic, () => string> = {
  classic_duel: () => DUEL_EMBLEM,
  survival: () => MODE_ICONS.survival,
  prime_challenge: () => MODE_ICONS.challenge,
  // (PRIME SQUAD's own sign lives in LeagueScreen.ts; its fallback draws three heads the way it did)
  prime_squad: () => SQUAD_OLD,
  prime_rush: () => MODE_ICONS.energy_rush,
};

/** 1.9.1: PRIME SQUAD's sign — three fighters shoulder to shoulder (the fallback of its picture). */
export const SQUAD_OLD = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="16" cy="24" r="7" fill="#7cf7d4" opacity=".75"/><path d="M4 50c0-8 5-14 12-14s12 6 12 14z" fill="#7cf7d4" opacity=".75"/><circle cx="48" cy="24" r="7" fill="#7cf7d4" opacity=".75"/><path d="M36 50c0-8 5-14 12-14s12 6 12 14z" fill="#7cf7d4" opacity=".75"/><circle cx="32" cy="20" r="9" fill="#fff"/><path d="M17 54c0-10 7-17 15-17s15 7 15 17z" fill="#fff"/></svg>`;

/** A game mode's picture at `size` CSS px. */
export function modePic(id: ModePic, size: number, cls = ''): string {
  return artImg('modes', id, size, { cls: `mode-pic ${cls}`, fb: `mpic|${id}` });
}
registerFallback('mpic', ([id]) => (MODE_OLD[id as ModePic] ?? MODE_OLD.classic_duel)());
