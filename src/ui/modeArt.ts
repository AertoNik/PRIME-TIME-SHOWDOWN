// Inline SVG art for the game modes (Alpha 1.3): mode cards, challenge icons,
// Survival bonuses and record badges. Solid fills only (no gradient ids), so
// many copies can live on one screen; colours follow the UI via currentColor.
import type { PerkId } from '../config/modes.config';

const S = (body: string, vb = '0 0 64 64') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

/**
 * Alpha 1.9.2 — CLASSIC DUEL: two gloves meeting head-on (the player's orange, the rival's violet) and the spark of
 * the hit between them. Solid fills like every mode sign; readable at 22–44 px.
 */
const GLOVE = (main: string, light: string, ink: string, cuff: string) =>
  `<path d="M5 37.5 V47 a3 3 0 0 0 3 3 H17 a3 3 0 0 0 3 -3 V37.5 Z" fill="${cuff}"/><rect x="5" y="40.5" width="15" height="3" fill="${main}"/>` +
  `<path d="M6.5 38 C3.5 30.5 4.5 19 12 14 C19 9.5 28.5 11.5 31 18.5 C33 24 31.5 30.5 26.5 33.5 C23.5 35.5 20.5 37 18.5 38 Z" fill="${main}" stroke="${ink}" stroke-width="1.8" stroke-linejoin="round"/>` +
  `<path d="M11.5 18.5 C15 14.5 21.5 14 25 16.5" stroke="${light}" stroke-width="2.6" fill="none" stroke-linecap="round"/>` +
  `<path d="M9.5 31 C14 28 20.5 28.5 23.5 32.5" stroke="${ink}" stroke-width="1.7" fill="none" stroke-linecap="round" opacity=".75"/>`;
export const DUEL_EMBLEM = S(
  `<g transform="translate(-1 3)">${GLOVE('#ff7a1a', '#ffc08a', '#7a2e00', '#fff1e0')}</g>` +
    `<g transform="translate(65 3) scale(-1 1)">${GLOVE('#8c6eff', '#c8baff', '#2e1a7a', '#efe9ff')}</g>` +
    `<path d="M32 3.5 L34.6 11 L42 9.6 L37 15.6 L41 22 L33.6 19.6 L30.4 26.5 L29.6 19 L22.4 18.2 L28.6 14 L26 7.4 L31 10.6 Z" fill="#ffd23a" stroke="#7a4a00" stroke-width="1.3" stroke-linejoin="round"/>`,
  '2 2 60 54', // the art's own box: no empty band under the gloves
);

export const MODE_ICONS = {
  /** Classic Duel: two crossed beams with a VS spark. */
  classic: S(
    `<path d="M10 50 L40 14 L46 20 L16 56 Z" fill="currentColor" opacity=".9"/>
     <path d="M54 50 L24 14 L18 20 L48 56 Z" fill="currentColor" opacity=".55"/>
     <circle cx="32" cy="35" r="9" fill="#fff"/>
     <path d="M28 31 L32 39 L36 31" fill="none" stroke="#0b1028" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  /** Survival: a star standing on five wave steps. */
  survival: S(
    `<rect x="4" y="50" width="10" height="10" rx="2" fill="currentColor" opacity=".45"/>
     <rect x="16" y="44" width="10" height="16" rx="2" fill="currentColor" opacity=".6"/>
     <rect x="28" y="38" width="10" height="22" rx="2" fill="currentColor" opacity=".75"/>
     <rect x="40" y="32" width="10" height="28" rx="2" fill="currentColor" opacity=".9"/>
     <rect x="52" y="26" width="10" height="34" rx="2" fill="currentColor"/>
     <path d="M30 4 L34 14 L45 14 L36 21 L40 31 L30 25 L20 31 L24 21 L15 14 L26 14 Z" fill="#ffd23a" stroke="#7a3a00" stroke-width="1.5" stroke-linejoin="round"/>`,
  ),
  /** Prime Challenge: a TV with a lightning bolt. */
  challenge: S(
    `<rect x="6" y="14" width="52" height="38" rx="8" fill="currentColor"/>
     <rect x="12" y="20" width="40" height="26" rx="4" fill="#0b1028"/>
     <path d="M34 22 L24 35 L31 35 L28 45 L40 31 L33 31 L37 22 Z" fill="#ffd23a"/>
     <path d="M24 6 L32 14 L40 6" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
     <rect x="18" y="54" width="28" height="4" rx="2" fill="currentColor" opacity=".7"/>`,
  ),
  energy_rush: S(
    `<path d="M36 2 L12 36 L28 36 L22 62 L52 24 L35 24 L44 2 Z" fill="#2ff3ff" stroke="#043a4a" stroke-width="2" stroke-linejoin="round"/>
     <path d="M6 20 H16 M4 30 H12 M50 44 H60 M52 54 H58" stroke="#2ff3ff" stroke-width="3" stroke-linecap="round" opacity=".7"/>`,
  ),
  high_stakes: S(
    `<circle cx="32" cy="36" r="22" fill="#fff" stroke="#3a0a10" stroke-width="3"/>
     <circle cx="32" cy="36" r="17" fill="#ff3a4a"/>
     <path d="M32 36 L32 22 M32 36 L42 42" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
     <rect x="26" y="4" width="12" height="7" rx="2" fill="#fff"/>
     <path d="M50 12 L56 6 M14 12 L8 6" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
  ),
  spotlight: S(
    `<path d="M24 8 L40 8 L58 58 L6 58 Z" fill="#ffe27a" opacity=".35"/>
     <rect x="22" y="2" width="20" height="10" rx="3" fill="#fff"/>
     <path d="M32 26 L36 36 L47 36 L38 43 L42 54 L32 47 L22 54 L26 43 L17 36 L28 36 Z" fill="#ffd23a" stroke="#7a3a00" stroke-width="1.5" stroke-linejoin="round"/>`,
  ),
  trophy: S(
    `<path d="M18 6 H46 V22 C46 32 40 38 32 38 C24 38 18 32 18 22 Z" fill="#ffd23a"/>
     <path d="M18 10 H8 C8 22 14 26 20 26 M46 10 H56 C56 22 50 26 44 26" fill="none" stroke="#ffd23a" stroke-width="5"/>
     <path d="M28 38 H36 V48 H44 V56 H20 V48 H28 Z" fill="#ffd23a"/>`,
  ),
  heart: S(`<path d="M32 56 C14 44 6 34 6 22 C6 13 13 7 21 7 C26 7 30 10 32 14 C34 10 38 7 43 7 C51 7 58 13 58 22 C58 34 50 44 32 56 Z" fill="currentColor"/>`),
  skull: S(
    `<path d="M32 6 C17 6 8 16 8 29 C8 37 12 42 18 45 V54 H46 V45 C52 42 56 37 56 29 C56 16 47 6 32 6 Z" fill="currentColor"/>
     <circle cx="22" cy="30" r="6" fill="#0b1028"/><circle cx="42" cy="30" r="6" fill="#0b1028"/>
     <path d="M26 54 V48 M32 54 V48 M38 54 V48" stroke="#0b1028" stroke-width="3"/>`,
  ),
};

export const PERK_ICONS: Record<PerkId, string> = {
  second_wind: S(
    `<path d="M32 56 C14 44 6 34 6 22 C6 13 13 7 21 7 C26 7 30 10 32 14 C34 10 38 7 43 7 C51 7 58 13 58 22 C58 34 50 44 32 56 Z" fill="#ff5a7a" stroke="#4a0a1a" stroke-width="2"/>
     <path d="M32 20 V42 M21 31 H43" stroke="#fff" stroke-width="7" stroke-linecap="round"/>`,
  ),
  energy_boost: S(
    `<path d="M36 2 L12 36 L28 36 L22 62 L52 24 L35 24 L44 2 Z" fill="#2ff3ff" stroke="#043a4a" stroke-width="2" stroke-linejoin="round"/>`,
  ),
  power_surge: S(
    `<path d="M32 4 C40 16 50 22 48 38 C46 52 38 60 32 60 C26 60 18 52 16 38 C14 22 24 16 32 4 Z" fill="#ff8a1f" stroke="#5a1a00" stroke-width="2"/>
     <path d="M32 26 C36 32 40 36 39 44 C38 50 35 53 32 53 C29 53 26 50 25 44 C24 36 28 32 32 26 Z" fill="#ffe27a"/>`,
  ),
};
