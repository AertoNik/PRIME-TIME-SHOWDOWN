import type { CosmeticId } from '../config/cosmetics.config';
import { cardHTML } from './dom';

// Beta 2.2 mini hotfix — the REAL look of a broadcast frame or a card style wherever the game shows the item (MY
// COLLECTION's tiles, its big view, «Сейчас в эфире», the wardrobe, an event's exchange and reveal). A picture cannot
// show what these items do — they restyle the game's own HUD and cards — so the preview is built from the same markup
// and the same CSS rules the game uses (ThemeManager sets data-frame / data-card-style; the rules have preview aliases
// .fd-screen.<key> / .<key>-set), exactly as PRIME SHOP's demonstrations. No PNG stand-ins.

/**
 * The CSS style of each broadcast frame / card style — the same names ThemeManager sets on <html> (data-frame,
 * data-card-style). Beta 2.2 mini hotfix: every frame and card style of the game, not only the ones PRIME SHOP sells
 * (LEGENDARY PRODUCTION from the career, ЭФИР БЕЗ ПЕРЕРЫВА from DAILY PRIME STREAK, RANKED ARENA / RANKED CARDS from
 * PRIME LEAGUE).
 */
export const FRAME_STYLE: Partial<Record<CosmeticId, string>> = {
  frame_prime_broadcast: 'prime',
  frame_arcade: 'arcade',
  frame_spooky: 'spooky',
  frame_frostlight_live: 'frostlight',
  frame_legendary: 'legendary',
  frame_daily_live: 'daily',
  frame_league_arena: 'ranked',
};
export const CARD_STYLE: Partial<Record<CosmeticId, string>> = {
  card_vhs: 'vhs',
  card_holo: 'holo',
  card_pumpkin: 'pumpkin',
  card_clockwork_gold: 'clockwork',
  card_league_ranked: 'ranked',
};

/** The small broadcast screen of PRIME SHOP's frame demonstration, wearing frame `key` (the same markup). */
export function frameScreenHTML(key: string): string {
  return `<div class="fd-screen ${key}">
        <div class="fd-frame"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>
        <div class="fd-top"><span class="fd-hp"><i style="width:72%"></i></span><span class="fd-timer"><b class="fd-live">LIVE</b>1:15</span><span class="fd-hp r"><i style="width:54%"></i></span></div>
        <div class="fd-floor"></div>
        <div class="fd-hand"><i></i><i></i><i></i></div>
      </div>`;
}

/** Two real cards in card style `key` (PRIME SHOP's catalog picture of a card style). */
export function cardSetHTML(key: string): string {
  return `<div class="art-cards ${key}-set">${cardHTML('dash', 'ac-1', false)}${cardHTML('power_shot', 'ac-2', false)}</div>`;
}

/**
 * The real preview of a frame / card style at about `size` CSS px, or null for any other cosmetic. A frame's screen
 * keeps its HUD bar and hand from 100 px (tiles, big view, reveal); below that only the frame, its tag and the floor
 * («small»: an event's exchange card), below 64 px the frame alone («tiny»: a slot).
 */
export function cosmeticDemo(id: CosmeticId, size: number): string | null {
  const tiny = size < 64 ? ' tiny' : size < 100 ? ' small' : '';
  const frame = FRAME_STYLE[id];
  if (frame) return `<span class="cos-demo frame${tiny}" aria-hidden="true">${frameScreenHTML(frame)}</span>`;
  const cards = CARD_STYLE[id];
  if (cards) return `<span class="cos-demo cards${tiny}" aria-hidden="true">${cardSetHTML(cards)}</span>`;
  return null;
}
