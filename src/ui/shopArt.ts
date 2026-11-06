import type { CosmeticId } from '../config/cosmetics.config';
import { FIGHTERS } from '../config/fighters';
import { LOOKS } from '../config/looks';
import { SKINS, type ShopItemDef } from '../config/shop.config';
import type { Game } from '../game/Game';
import { cardHTML, esc, portraitHTML } from './dom';

// Alpha 1.8.8 — the pictures and names of PRIME SHOP items, shared by the shop (ShopScreen) and the
// purchase window (PRIME CHECKOUT): skins and LUCIEN as real 3D portraits (PortraitStudio, drawn once
// and kept), the effects as light drawings and real card markup — no extra 3D scene for a picture.

const S = (body: string, vb = '0 0 64 64') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** «RAY: NEON RUNNER» → a small fighter line and the item's own name, so a name never breaks mid-word. */
export function nameHTML(name: string): string {
  const i = name.indexOf(': ');
  if (i < 0) return `<span class="nm-main">${esc(name)}</span>`;
  return `<span class="nm-pre">${esc(name.slice(0, i))}</span> <span class="nm-main">${esc(name.slice(i + 2))}</span>`;
}

/**
 * 1.9.5: the CSS style of each broadcast frame / card style — the same names ThemeManager sets on <html>
 * (data-frame, data-card-style); the shop's previews use them as classes (.fd-screen.<key>, .<key>-set).
 */
export const FRAME_STYLE: Partial<Record<CosmeticId, string>> = { frame_prime_broadcast: 'prime', frame_arcade: 'arcade', frame_spooky: 'spooky' };
export const CARD_STYLE: Partial<Record<CosmeticId, string>> = { card_vhs: 'vhs', card_holo: 'holo', card_pumpkin: 'pumpkin' };
/** The words on a frame's plate in its preview («ON AIR», «PLAYER 1», «LIVE»). */
const FRAME_TAG: Record<string, string> = { prime: 'ON AIR', arcade: 'PLAYER 1', spooky: 'LIVE' };

/** Catalog art of the effects: drawn, light (no extra 3D scene for a thumbnail). */
const ART = {
  frame: (key: string) =>
    `<div class="art-frame k-${key}"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><span class="af-air">${FRAME_TAG[key] ?? 'ON AIR'}</span><span class="af-hp l"></span><span class="af-hp r"></span><span class="af-time">1:15</span></div>`,
  // 1.9.5 GLITCH DASH: a magenta and a cyan double, offset across the path, and the signal's pixels
  glitch: S(
    `<g transform="skewX(-12) translate(8 0)"><g fill="#ff3de0" opacity=".75" transform="translate(-3 -2)"><circle cx="40" cy="22" r="5"/><rect x="35" y="28" width="10" height="16" rx="5"/></g>
     <g fill="#3dfcff" opacity=".75" transform="translate(3 2)"><circle cx="40" cy="22" r="5"/><rect x="35" y="28" width="10" height="16" rx="5"/></g>
     <g fill="#f4f0ff"><circle cx="40" cy="22" r="5"/><rect x="35" y="28" width="10" height="16" rx="5"/></g></g>
     <g>${[
       [6, 18, '#ff3de0'],
       [14, 30, '#3dfcff'],
       [9, 42, '#ff3de0'],
       [20, 22, '#f4f0ff'],
       [24, 38, '#3dfcff'],
       [16, 50, '#ff3de0'],
       [28, 46, '#3dfcff'],
       [55, 16, '#3dfcff'],
       [58, 40, '#ff3de0'],
     ]
       .map(([x, y, c]) => `<rect x="${x}" y="${y}" width="4" height="4" fill="${c}"/>`)
       .join('')}</g>
     <path d="M2 26 H20 M4 34 H16" stroke="#3dfcff" stroke-width="2" opacity=".6"/>`,
  ),
  // 1.9.5 COMET TRAIL: a white-hot head, a tapering golden tail and falling embers
  comet: S(
    `<defs><linearGradient id="sa-comet" x1="0" x2="1"><stop offset="0" stop-color="#ff9a2e" stop-opacity="0"/><stop offset=".7" stop-color="#ffc861"/><stop offset="1" stop-color="#fff4d6"/></linearGradient></defs>
     <path d="M4 36 Q30 30 50 25 L52 33 Q30 34 4 36 Z" fill="url(#sa-comet)"/>
     <path d="M10 40 Q30 36 48 33" stroke="#ff9a2e" stroke-width="2" fill="none" opacity=".55" stroke-linecap="round"/>
     <circle cx="51" cy="29" r="7" fill="#fff4d6"/><circle cx="51" cy="29" r="11" fill="#ffc861" opacity=".28"/>
     <g fill="#ffc861">${[
       [18, 46, 1.8],
       [28, 50, 1.4],
       [36, 44, 1.6],
       [42, 54, 1.2],
       [24, 56, 1],
     ]
       .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`)
       .join('')}</g>`,
  ),
  // 1.9.5 STUDIO SPOTLIGHTS: four beams meeting on the winner, a gold ring of light
  spotlights: S(
    `<defs><linearGradient id="sa-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c4" stop-opacity=".9"/><stop offset="1" stop-color="#ffd23a" stop-opacity=".05"/></linearGradient></defs>
     <g fill="url(#sa-beam)"><path d="M4 2 L12 2 L34 46 L28 48 Z"/><path d="M52 2 L60 2 L36 48 L30 46 Z"/><path d="M22 0 L28 0 L33 46 L29 46 Z" opacity=".7"/><path d="M36 0 L42 0 L35 46 L31 46 Z" opacity=".7"/></g>
     <ellipse cx="32" cy="50" rx="18" ry="5" fill="none" stroke="#ffd23a" stroke-width="2.5"/>
     <ellipse cx="32" cy="50" rx="10" ry="2.6" fill="#fff3c4" opacity=".55"/>
     <g fill="#fff">${[
       [8, 40],
       [56, 36],
       [14, 56],
       [52, 58],
     ]
       .map(([x, y]) => `<path d="M${x} ${y - 3} L${x + 1} ${y - 1} L${x + 3} ${y} L${x + 1} ${y + 1} L${x} ${y + 3} L${x - 1} ${y + 1} L${x - 3} ${y} L${x - 1} ${y - 1} Z"/>`)
       .join('')}</g>`,
  ),
  // 1.9.5 NEON FIREWORKS: three bursts — pink, cyan, violet — over a trail
  fireworks: S(
    `${[
      [18, 18, '#ff4fd8', 11],
      [44, 14, '#3dfcff', 12],
      [34, 34, '#a86bff', 9],
    ]
      .map(([x, y, c, r]) => `<g transform="translate(${x} ${y})" stroke="${c}" stroke-width="2" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M0 ${-(r as number) * 0.35} V${-(r as number)}" transform="rotate(${a})"/>`).join('')}<circle r="2.2" fill="#fff" stroke="none"/></g>`)
      .join('')}
     <path d="M34 62 Q33 50 34 40" stroke="#a86bff" stroke-width="1.6" fill="none" opacity=".6" stroke-dasharray="2 3"/>`,
  ),
  // 1.9.5 PUMPKIN VICTORY: a glowing pumpkin among confetti
  pumpkin: S(
    `<g transform="translate(32 34)"><ellipse rx="17" ry="14" fill="#ff8a1f"/><ellipse rx="9" ry="14" fill="#ffa54a" opacity=".6"/><path d="M-7 -4 L-3 -4 L-5 -8 Z M7 -4 L3 -4 L5 -8 Z" fill="#3a1200"/><path d="M-9 4 Q0 11 9 4 L5 6 L3 4 L0 7 L-3 4 L-5 6 Z" fill="#3a1200"/><rect x="-2" y="-19" width="4" height="7" rx="2" fill="#5a8a2e"/></g>
     <g>${[
       [8, 12, '#b45cff', 20],
       [54, 10, '#ff8a1f', -30],
       [10, 52, '#ffd23a', 40],
       [54, 54, '#b45cff', -15],
       [30, 6, '#ffd23a', 60],
     ]
       .map(([x, y, c, r]) => `<rect x="${x}" y="${y}" width="5" height="3" rx="1" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`)
       .join('')}</g>`,
  ),
  dash: S(
    `<defs><linearGradient id="sd-trail" x1="0" x2="1"><stop offset="0" stop-color="#48f4ff" stop-opacity="0"/><stop offset="1" stop-color="#48f4ff"/></linearGradient></defs>
     <path d="M4 44 H56 M10 36 H30 M6 28 H22" stroke="url(#sd-trail)" stroke-width="3" stroke-linecap="round"/>
     <g fill="#8a5cff" transform="skewX(-14) translate(8 0)"><g opacity=".22"><circle cx="14" cy="22" r="5"/><rect x="9" y="28" width="10" height="16" rx="5"/></g>
     <g opacity=".45"><circle cx="27" cy="22" r="5"/><rect x="22" y="28" width="10" height="16" rx="5"/></g>
     <g opacity=".75"><circle cx="40" cy="22" r="5"/><rect x="35" y="28" width="10" height="16" rx="5"/></g></g>
     <g fill="#e9e1ff" transform="skewX(-14) translate(8 0)"><circle cx="53" cy="22" r="5"/><rect x="48" y="28" width="10" height="16" rx="5"/></g>
     <g fill="#48f4ff"><circle cx="20" cy="50" r="1.6"/><circle cx="33" cy="53" r="1.3"/><circle cx="45" cy="49" r="1.8"/></g>`,
  ),
  confetti: S(
    `<g transform="translate(32 34)"><g fill="#ffd23a" opacity=".35">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<rect x="-1.5" y="-30" width="3" height="11" rx="1.5" transform="rotate(${a})"/>`).join('')}</g></g>
     <path d="M32 18 L36 28 L47 29 L39 36 L41 47 L32 41 L23 47 L25 36 L17 29 L28 28 Z" fill="#ffd23a" stroke="#fff3c4" stroke-width="1.5"/>
     <g>${[
       [8, 12, '#ffe58a', 20],
       [54, 10, '#f2b02a', -30],
       [12, 50, '#fff3c4', 40],
       [52, 52, '#ffd23a', -15],
       [20, 6, '#d9921a', 60],
       [44, 58, '#ffe58a', 10],
       [6, 32, '#f2b02a', -50],
       [58, 30, '#fff3c4', 35],
     ]
       .map(([x, y, c, r]) => `<rect x="${x}" y="${y}" width="5" height="3" rx="1" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`)
       .join('')}</g>`,
  ),
};

/** The picture of an item: a 3D portrait for skins and fighters, a drawing / real cards for the effects. */
export function shopArt(g: Game, it: ShopItemDef): string {
  if (it.skin) {
    const look = LOOKS[SKINS[it.skin].look];
    return portraitHTML(g.portraitFor(look.id, true), hex(look.top.accent), hex(look.top.main), 'si-portrait');
  }
  if (it.fighter) {
    const f = FIGHTERS[it.fighter];
    return portraitHTML(g.portraitFor(f.look, true), f.theme.main, f.theme.dark, 'si-portrait');
  }
  const c = it.cosmetic;
  if (it.preview === 'frame') return ART.frame((c && FRAME_STYLE[c]) || 'prime');
  if (it.preview === 'dash') {
    if (c === 'dash_glitch') return `<div class="art-svg art-dash k-glitch">${ART.glitch}</div>`;
    if (c === 'dash_comet') return `<div class="art-svg art-dash k-comet">${ART.comet}</div>`;
    return `<div class="art-svg art-dash">${ART.dash}</div>`;
  }
  if (it.preview === 'confetti') {
    if (c === 'victory_studio_spotlights') return `<div class="art-svg art-confetti k-spotlights">${ART.spotlights}</div>`;
    if (c === 'victory_neon_fireworks') return `<div class="art-svg art-confetti k-fireworks">${ART.fireworks}</div>`;
    if (c === 'victory_pumpkin') return `<div class="art-svg art-confetti k-pumpkin">${ART.pumpkin}</div>`;
    return `<div class="art-svg art-confetti">${ART.confetti}</div>`;
  }
  return `<div class="art-cards ${(c && CARD_STYLE[c]) || 'vhs'}-set">${cardHTML('dash', 'ac-1', false)}${cardHTML('power_shot', 'ac-2', false)}</div>`;
}
