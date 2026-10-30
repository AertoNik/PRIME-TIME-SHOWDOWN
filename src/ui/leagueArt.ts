import { RANKS, type TacticId } from '../config/league.config';

// Alpha 1.9.0 PRIME LEAGUE — the league's own drawn marks (inline SVG, the game's palette): an emblem per major rank
// (a broadcast badge with its glyph and colour, the division as bars), the six AI director tactics, the ON AIR lamp.
// Nothing borrowed from other games.

/** The glyph inside each rank's badge (24×24 space, centred at 12,12). */
const GLYPH: Record<string, string> = {
  // a clapperboard
  casting: '<path d="M5 10h14v8H5z"/><path d="M5 10l2-4h12l-2 4"/><path d="M9 6l-2 4M13 6l-2 4M17 6l-2 4"/>',
  // a film frame with one take
  first_take: '<rect x="5" y="6" width="14" height="12" rx="1.5"/><path d="M8 6v12M16 6v12"/><path d="M11.5 10l1.5-1v6"/>',
  // a moon over an antenna
  night_air: '<path d="M14.5 5.5a5 5 0 1 0 4 7.5 4 4 0 0 1-4-7.5z"/><path d="M8 19l2-6 2 6M10 13v-1"/>',
  // an outlined star with a ring
  contender: '<circle cx="12" cy="12" r="7.5"/><path d="M12 7.5l1.3 2.8 3 .4-2.2 2.1.6 3-2.7-1.5-2.7 1.5.6-3-2.2-2.1 3-.4z"/>',
  // a spotlight beam
  headliner: '<path d="M6 7l4 3-1 2-4-2z"/><path d="M10 10l9 7M9 12l7 7"/><circle cx="18" cy="18.5" r="1"/>',
  // a full star
  star: '<path d="M12 4.5l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 9.8l5-.7z" fill="currentColor" fill-opacity=".35"/>',
  // a crown
  icon: '<path d="M5 17h14l1-9-4.5 3.5L12 6l-3.5 5.5L4 8z"/><path d="M5 19.5h14"/>',
  // a laurel crown
  legend: '<path d="M12 18c-4 0-7-3-7-8M12 18c4 0 7-3 7-8"/><path d="M6 13l-2-1M7 15.5l-2 .5M18 13l2-1M17 15.5l2 .5M6.5 10l-1.5-1.5M17.5 10l1.5-1.5"/><path d="M9.5 9.5l2.5-3 2.5 3-2.5 2.5z" fill="currentColor" fill-opacity=".4"/>',
};

const DIV_BARS: Record<string, number> = { III: 1, II: 2, I: 3 };

/**
 * A rank emblem: a hexagonal broadcast badge in the rank's colour with its glyph and the division as 1–3 bars. The
 * status grows visibly with the tier, readable even at 28 px:
 *   КАСТИНГ, ПЕРВЫЙ ДУБЛЬ   the bare badge
 *   НОЧНОЙ ЭФИР, ПРЕТЕНДЕНТ  + the six broadcast marks around it
 *   ХЕДЛАЙНЕР, ЗВЕЗДА       + side wings
 *   ИКОНА, ЛЕГЕНДА          + a double gold rim and a crest (gold only for these prestige ranks)
 */
export function rankEmblem(index: number, division: string | null, size = 64, cls = ''): string {
  const i = Math.max(0, Math.min(RANKS.length - 1, index));
  const r = RANKS[i];
  const tier = i < 2 ? 0 : i < 4 ? 1 : i < 6 ? 2 : 3;
  const bars = division ? DIV_BARS[division] ?? 0 : 0;
  const gold = '#ffd166';
  const id = `lgE${i}${division ?? ''}${size}`;
  const pips = Array.from({ length: 3 }, (_, k) => `<rect x="${22 + k * 7.5}" y="57.5" width="5" height="3" rx="1" fill="${k < bars ? r.color : 'rgba(255,255,255,.14)'}"/>`).join('');
  const marks =
    tier >= 1
      ? [0, 60, 120, 180, 240, 300].map((a) => `<rect x="31" y="1" width="2" height="4.5" rx="1" fill="currentColor" opacity=".8" transform="rotate(${a} 32 28.5)"/>`).join('')
      : '';
  const wings =
    tier >= 2
      ? `<path d="M9.5 22.5L2.5 19l2.5 7.5-2.5 6 7-2.5M54.5 22.5l7-3.5-2.5 7.5 2.5 6-7-2.5" fill="currentColor" fill-opacity=".28" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`
      : '';
  const crest =
    tier >= 3
      ? `<path d="M10 16.5L32 4l22 12.5v24L32 53 10 40.5z" fill="none" stroke="${gold}" stroke-width="1" transform="translate(32 28.5) scale(1.09) translate(-32 -28.5)"/><path d="M26 2.5l3 2.5 3-4 3 4 3-2.5-1.5 5h-9z" fill="${gold}" stroke="#7a4a00" stroke-width=".6"/>`
      : '';
  return `<svg class="lg-emblem t${tier} ${cls}" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="${r.ru}${division ? ' ' + division : ''}" style="color:${r.color}">
    <defs>
      <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${r.color}" stop-opacity="${0.26 + tier * 0.08}"/><stop offset="1" stop-color="#070a1c" stop-opacity=".96"/></linearGradient>
      <radialGradient id="${id}h" cx=".5" cy=".3" r=".7"><stop offset="0" stop-color="#fff" stop-opacity="${0.12 + tier * 0.05}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    </defs>
    ${wings}${marks}
    <path d="M32 6l20 11.5v22.5L32 51.5 12 40V17.5z" fill="url(#${id}g)" stroke="currentColor" stroke-width="${1.6 + tier * 0.35}"/>
    <path d="M32 11l15.5 9v18L32 47 16.5 38V20z" fill="url(#${id}h)" stroke="currentColor" stroke-opacity=".35" stroke-width="1"/>
    ${crest}
    <g transform="translate(20 16.5)" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${GLYPH[r.id] ?? ''}</g>
    ${pips}
  </svg>`;
}

const TACTIC_GLYPH: Record<TacticId, string> = {
  assault: '<path d="M4 12h11M11 7l5 5-5 5"/><path d="M17 6v12"/>',
  balance: '<path d="M12 4v15M6 19h12"/><path d="M5 9h14M5 9l-2 5h4zM19 9l-2 5h4z"/>',
  fortress: '<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  counter: '<path d="M20 9H8l3-3M4 15h12l-3 3"/>',
  combo: '<rect x="3.5" y="7" width="7" height="10" rx="1.5"/><rect x="13.5" y="7" width="7" height="10" rx="1.5"/><path d="M10.5 12h3"/>',
  adapt: '<circle cx="12" cy="12" r="7"/><path d="M12 5v3M12 16v3M5 12h3M16 12h3"/><path d="M12 12l3-2"/>',
};

export function tacticIcon(id: TacticId, size = 22): string {
  return `<svg class="lg-tac-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TACTIC_GLYPH[id]}</svg>`;
}

/** The studio's red ON AIR lamp. */
export function onAir(text = 'ON AIR'): string {
  return `<span class="lg-onair"><i></i>${text}</span>`;
}
