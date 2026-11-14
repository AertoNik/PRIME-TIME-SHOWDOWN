import type { CardId } from '../config/types';

// Alpha 1.9.9 — CARD EVOLUTION: the owner's 33 card pictures (PRIME_TIME_1_9_9_CARDS/<id>.png) as the faces of the
// game's cards. Only the look changes: a card keeps its id, mechanics, energy, combos, prices and ownership.
//
// The game's copies (scripts/art/prepare_art.py → public/cards/{sm,md}/<id>.webp) share one geometry: the card box in
// CSS is the picture's FRAME (0.70 wide per 1 high, its corners CARD_RADIUS), and the picture overflows that box by
// CARD_PAD — on the left and the top for the energy gem drawn on it, a hair on the right and the bottom. Rings, glows,
// the energy curtain and the combo highlight therefore follow the drawn frame, never a second one.
//
// Layers of a card (cardHTML in dom.ts, styles in main.css «1.9.9 CARD EVOLUTION»):
//   1. .pc-sh  — behind the picture: the lift shadow, the bought card style's glow, the gold glow of a signature card,
//                the focus / picked / combo-ready rings (outside the frame, so never a double frame);
//   2. .face   — the picture: frame, art, name and energy gem as the owner drew them;
//   3. .art    — over the picture, clipped to the frame with a hole for the gem: the bought style's foil / scanlines /
//                engraving and the «ready» sweep;
//   4. the card style's corner ornaments (::before / ::after) and the battle's own marks (energy curtain, КОМБО, lock).

/**
 * The cards with a 1.9.9 picture — the 33 cards of a player's collection (6 basic, 9 signature, 18 bought in the
 * career). Spelled out (not derived) so a card added later cannot silently borrow a picture, and a missing picture is a
 * type / test failure (`npm run cardart`). The boss card DIRECTOR'S CUT has none: it keeps the drawn card.
 */
export const CARD_ART: Readonly<Partial<Record<CardId, string>>> = {
  dash: 'dash',
  power_shot: 'power_shot',
  shield: 'shield',
  smoke: 'smoke',
  shock: 'shock',
  overdrive: 'overdrive',
  adrenaline: 'adrenaline',
  knockout: 'knockout',
  system_overload: 'system_overload',
  charged_shot: 'charged_shot',
  bank_shot: 'bank_shot',
  false_start: 'false_start',
  bat_bite: 'bat_bite',
  twelfth_strike: 'twelfth_strike',
  main_event: 'main_event',
  spotlight_tag: 'spotlight_tag',
  split_shot: 'split_shot',
  rebound_disc: 'rebound_disc',
  prop_drop: 'prop_drop',
  pulse_push: 'pulse_push',
  gravity_net: 'gravity_net',
  pressure_mine: 'pressure_mine',
  stage_barrier: 'stage_barrier',
  cable_snare: 'cable_snare',
  holo_decoy: 'holo_decoy',
  frame_catch: 'frame_catch',
  backtrack: 'backtrack',
  high_stakes: 'high_stakes',
  second_take: 'second_take',
  freeze_frame: 'freeze_frame',
  showtime: 'showtime',
  magnet_pull: 'magnet_pull',
  safe_cut: 'safe_cut',
};

/** The room the picture takes around its frame, as fractions of the frame (= prepare_art.py PAD; main.css .card.pc .face). */
export const CARD_PAD = { l: 0.055, t: 0.085, r: 0.008, b: 0.008 } as const;
/** The frame: width / height and its corner radius (fraction of the width), measured on the pictures. */
export const CARD_FRAME = { ratio: 0.7, radius: 0.145 } as const;

/** sm: grids, decks, lists (frame 240 px wide — sharp up to ~80 CSS px on a 3× phone); md: the battle hand (frame 400 px). */
export type CardArtSize = 'sm' | 'md';

/** The page's base (Vite `base: './'`); scripts run without Vite and get the same relative path. */
const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';

/** The picture of a card, or null (no 1.9.9 picture: the card is drawn as before). */
export function cardArtUrl(id: CardId, size: CardArtSize = 'sm'): string | null {
  const file = CARD_ART[id];
  return file ? `${BASE}cards/${size}/${file}.webp` : null;
}

const warmed = new Set<string>();

/**
 * Fetch and decode the pictures of `ids` ahead of time (the deck before a fight), so the hand never shows an empty card
 * for a frame. Each file once per page; failures are ignored (the card then simply loads when shown).
 */
export function preloadCardArt(ids: readonly CardId[], size: CardArtSize): void {
  if (typeof Image === 'undefined') return;
  for (const id of ids) {
    const url = cardArtUrl(id, size);
    if (!url || warmed.has(url)) continue;
    warmed.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
}
