import { RANKS, type TacticId } from '../config/league.config';
import { artImg, registerFallback } from './artIcons';

// Alpha 1.9.0 PRIME LEAGUE — the league's own marks: an emblem per rank step, the six AI director tactics, the ON AIR
// lamp. Beta 2.0 VISUAL EVOLUTION: the rank emblems are the owner's pictures (PRIME_TIME_2_0_RANK_ART → public/ui/ranks):
//   * 21 divided steps (7 ranks × III / II / I) and ЛЕГЕНДА ЭФИРА (no division) — the bars are drawn ON the pictures,
//     nothing is laid over them;
//   * a rank WITHOUT a division (season history) — the same emblem without its bars (ranks-plain);
//   * the league's own symbols — PRIME CONTENDER without bars (`leagueSymbol`) and PRIME ICON without bars for the
//     season emblem reward (`seasonEmblem`); the PRIME LEAGUE mode itself (the mode choice) is the trophy (`modeEmblem`).
// The inline SVG badge of 1.9.0 stays as the fallback when a picture cannot load (rankEmblemSvg).

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
 * The 1.9.0 drawn rank emblem (now the fallback of `rankEmblem`): a hexagonal broadcast badge in the rank's colour with its glyph and the division as 1–3 bars. The
 * status grows visibly with the tier, readable even at 28 px:
 *   КАСТИНГ, ПЕРВЫЙ ДУБЛЬ   the bare badge
 *   НОЧНОЙ ЭФИР, ПРЕТЕНДЕНТ  + the six broadcast marks around it
 *   ХЕДЛАЙНЕР, ЗВЕЗДА       + side wings
 *   ИКОНА, ЛЕГЕНДА          + a double gold rim and a crest (gold only for these prestige ranks)
 */
export function rankEmblemSvg(index: number, division: string | null, size = 64, cls = ''): string {
  const i = Math.max(0, Math.min(RANKS.length - 1, index));
  const r = RANKS[i];
  const tier = i < 2 ? 0 : i < 4 ? 1 : i < 6 ? 2 : 3;
  // the top rank has no divisions: no lit bar, no «III» in its label (Beta 2.0 — the ceremony passed 'III' for every rank)
  if (i === RANKS.length - 1) division = null;
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

const tierOf = (i: number) => (i < 2 ? 0 : i < 4 ? 1 : i < 6 ? 2 : 3);

/**
 * A rank emblem — the owner's picture of exactly this step: `division` 'III' | 'II' | 'I' for the 21 divided steps,
 * null for a rank without a division (the bar-less emblem). ЛЕГЕНДА ЭФИРА ignores the division: it has none.
 * `size` is the CSS box (18–132 px in the league); the file is the smallest variant sharp on a 3× phone.
 */
export function rankEmblem(index: number, division: string | null, size = 64, cls = ''): string {
  const i = Math.max(0, Math.min(RANKS.length - 1, index));
  const r = RANKS[i];
  const top = i === RANKS.length - 1;
  const div = top || !division || !(division in DIV_BARS) ? null : division;
  const group = div || top ? 'ranks' : 'ranks-plain';
  const id = div ? `${r.id}_${div.toLowerCase()}` : r.id;
  return artImg(group, id, size, {
    cls: `lg-emblem rank-art t${tierOf(i)} ${cls}`,
    alt: `${r.ru}${div ? ' ' + div : ''}`,
    fb: `rank|${i}|${div ?? ''}|${size}|${cls}`,
    style: `color:${r.color}`,
  });
}

registerFallback('rank', ([i, d, s, c]) => rankEmblemSvg(Number(i), d || null, Number(s), c ?? ''));

/** PRIME LEAGUE as a place (not a player's rank): the CONTENDER emblem without bars. */
export function leagueSymbol(size: number, cls = ''): string {
  return artImg('league', 'symbol', size, { cls: `lg-emblem lg-symbol ${cls}`, alt: 'PRIME LEAGUE', fb: `rank|3||${size}|${cls}` });
}

/** The «Эмблема сезона» reward of the season track: the PRIME ICON emblem without bars. */
export function seasonEmblem(size: number, cls = ''): string {
  return artImg('league', 'season', size, { cls: `lg-emblem lg-season-emb ${cls}`, alt: 'Эмблема сезона', fb: `rank|6||${size}|${cls}` });
}

/** 1.9.1 the career's sign in the mode choice — a championship belt (now the fallback of the Beta 2.0 picture). */
export const CAREER_BELT_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M1 23 Q10 20 18 21 V43 Q10 44 1 41 Z" fill="#e8641a"/><path d="M63 23 Q54 20 46 21 V43 Q54 44 63 41 Z" fill="#e8641a"/><path d="M1 34 Q10 35 18 34 V43 Q10 44 1 41 Z M63 34 Q54 35 46 34 V43 Q54 44 63 41 Z" fill="#a8400c"/><path d="M2 24.5 Q10 22 18 23 M62 24.5 Q54 22 46 23" stroke="#ffb06a" stroke-width="1.6" fill="none" stroke-linecap="round"/><rect x="8" y="26" width="5" height="12" rx="1.6" fill="#ffd56b"/><rect x="51" y="26" width="5" height="12" rx="1.6" fill="#ffd56b"/><circle cx="32" cy="33" r="17.5" fill="#ffc23a" stroke="#7a3a00" stroke-width="2.2"/><circle cx="29" cy="28.5" r="10" fill="#ffe58a" opacity=".55"/><circle cx="32" cy="33" r="13" fill="none" stroke="#fff3c4" stroke-width="1.3" opacity=".85"/><path d="M32 23 L35 29.6 L42.2 30.3 L36.8 35 L38.4 42 L32 38.3 L25.6 42 L27.2 35 L21.8 30.3 L29 29.6 Z" fill="#ff5a1f" stroke="#7a1f00" stroke-width="1.3" stroke-linejoin="round"/><path d="M24.5 14.5 L27 8 L32 12.5 L37 8 L39.5 14.5 Z" fill="#ffd23a" stroke="#7a3a00" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

/**
 * Beta 2.0: the sign of a GAME MODE in the mode choice — the career (a faceless producer climbing the career ladder)
 * and PRIME LEAGUE (the championship trophy). Never a player's rank and never the season emblem.
 */
export function modeEmblem(mode: 'career' | 'league', size: number, cls = ''): string {
  return artImg('modes', mode, size, { cls: `mode-emb ${cls}`, alt: mode === 'career' ? 'Карьера' : 'PRIME LEAGUE', fb: `mode|${mode}|${size}` });
}

registerFallback('mode', ([mode, s]) => (mode === 'career' ? CAREER_BELT_SVG : rankEmblemSvg(3, null, Number(s))));

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
