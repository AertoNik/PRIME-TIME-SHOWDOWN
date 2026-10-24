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

/** Catalog art of the effects: drawn, light (no extra 3D scene for a thumbnail). */
const ART = {
  frame: `<div class="art-frame"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><span class="af-air">ON AIR</span><span class="af-hp l"></span><span class="af-hp r"></span><span class="af-time">1:15</span></div>`,
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
  if (it.preview === 'frame') return ART.frame;
  if (it.preview === 'dash') return `<div class="art-svg art-dash">${ART.dash}</div>`;
  if (it.preview === 'confetti') return `<div class="art-svg art-confetti">${ART.confetti}</div>`;
  return `<div class="art-cards vhs-set">${cardHTML('dash', 'ac-1', false)}${cardHTML('power_shot', 'ac-2', false)}</div>`;
}
