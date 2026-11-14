// Lightweight SVG previews of the studio sets for the arena picker (Alpha 1.4).
// A TV still of each set: backdrop on top, the fighting floor in perspective below.
// Solid fills only: SVG gradient ids would clash between the many inline copies.
import type { ArenaPref } from '../config/arenas.config';

const S = (body: string) => `<svg viewBox="0 0 160 90" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid slice">${body}</svg>`;

/** The arena floor in perspective (same footprint on every set). */
const FLOOR = 'M22 88 L44 48 L116 48 L138 88 Z';
const RIM = 'M26 86 L46 50 L114 50 L134 86 Z';

const ORIGINAL = S(`
  <rect width="160" height="90" fill="#070a24"/>
  <rect x="0" y="10" width="160" height="34" fill="#0d1440"/>
  <g fill="#1c2668">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${4 + i * 20}" y="${22 + (i % 2) * 2}" width="16" height="22" rx="2"/>`).join('')}</g>
  <g fill="#ff4fd8" opacity=".75">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `<circle cx="${8 + i * 13}" cy="${27 + (i % 3) * 5}" r="1.4"/>`).join('')}</g>
  <rect x="52" y="4" width="56" height="20" rx="3" fill="#0a0d2a" stroke="#22f0e0" stroke-width="1.5"/>
  <text x="80" y="17.5" font-family="Arial Black,sans-serif" font-size="8" font-weight="900" fill="#22f0e0" text-anchor="middle">PRIME TIME</text>
  <rect x="0" y="43" width="160" height="5" fill="#ff7a1a"/>
  <path d="${FLOOR}" fill="#141c52"/>
  <path d="${RIM}" fill="none" stroke="#22f0e0" stroke-width="2"/>
  <ellipse cx="80" cy="67" rx="16" ry="7" fill="none" stroke="#ff7a1a" stroke-width="1.5"/>
  <rect x="34" y="56" width="6" height="9" rx="1" fill="#22f0e0"/><rect x="120" y="56" width="6" height="9" rx="1" fill="#ff7a1a"/>`);

const CASINO = S(`
  <rect width="160" height="90" fill="#140508"/>
  <rect x="0" y="0" width="160" height="46" fill="#2a0a10"/>
  <g fill="#6a0f1c">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${i * 20} 0 Q${i * 20 + 10} 30 ${i * 20} 46 L${i * 20 + 6} 46 Q${i * 20 + 14} 28 ${i * 20 + 6} 0 Z"/>`).join('')}</g>
  <rect x="48" y="6" width="64" height="26" rx="3" fill="#1a0a0c" stroke="#ffd27a" stroke-width="2"/>
  <text x="80" y="17" font-family="Arial Black,sans-serif" font-size="7" font-weight="900" fill="#ffd27a" text-anchor="middle">HIGH</text>
  <text x="80" y="27" font-family="Arial Black,sans-serif" font-size="7" font-weight="900" fill="#ff3a5a" text-anchor="middle">ROLLER</text>
  <rect x="0" y="43" width="160" height="5" fill="#ffd27a"/>
  <path d="${FLOOR}" fill="#5a0f1c"/>
  <path d="${RIM}" fill="none" stroke="#ffd27a" stroke-width="2"/>
  <g fill="#fff3c0">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<circle cx="${46 + i * 8.5}" cy="50" r="1.2"/>`).join('')}</g>
  <ellipse cx="80" cy="67" rx="17" ry="8" fill="#1a0507" stroke="#ffd27a" stroke-width="1.5"/>
  <g stroke="#e8203c" stroke-width="2.4">${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="80" y1="67" x2="${80 + Math.cos(i) * 15}" y2="${67 + Math.sin(i) * 7}"/>`).join('')}</g>
  <circle cx="80" cy="67" r="2.5" fill="#ffd27a"/>
  ${[[34, 64, '#e8203c'], [126, 64, '#2a6aff'], [30, 78, '#1a1a1a'], [130, 78, '#20a050']].map(([x, y, c]) => `<g><rect x="${(x as number) - 5}" y="${(y as number) - 6}" width="10" height="8" fill="${c}"/><ellipse cx="${x}" cy="${(y as number) - 6}" rx="5" ry="2" fill="#fff"/></g>`).join('')}`);

const BACKLOT = S(`
  <rect width="160" height="90" fill="#070a14"/>
  <rect x="0" y="0" width="160" height="46" fill="#121828"/>
  <g stroke="#3a4560" stroke-width="1.5">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<line x1="${i * 20}" y1="0" x2="${i * 20 + 10}" y2="10"/>`).join('')}<line x1="0" y1="10" x2="160" y2="10"/></g>
  <path d="M8 46 V18 H44 V46 Z" fill="#8a5a3a"/><g fill="#ffd27a">${[0, 1, 2].map((r) => [0, 1, 2].map((c) => `<rect x="${12 + c * 11}" y="${22 + r * 8}" width="6" height="5"/>`).join('')).join('')}</g>
  <path d="M58 46 V24 H102 V46 Z" fill="#3a6a8a"/><text x="80" y="35" font-family="Arial Black,sans-serif" font-size="8" font-weight="900" fill="#ff4fd8" text-anchor="middle">EAT</text>
  <path d="M116 46 V20 H152 V46 Z" fill="#c8b48a"/><text x="134" y="31" font-family="Arial Black,sans-serif" font-size="6" font-weight="900" fill="#5a3a1a" text-anchor="middle">BANK</text>
  <path d="M0 44 L160 44 L160 48 L0 48 Z" fill="#ffc21a"/><g fill="#1a1a1a">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => `<path d="M${i * 10} 48 L${i * 10 + 4} 44 L${i * 10 + 8} 44 L${i * 10 + 4} 48 Z"/>`).join('')}</g>
  <path d="${FLOOR}" fill="#26282e"/>
  <g fill="#e8e8e8">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${52 + i * 8.5}" y="56" width="5" height="9"/>`).join('')}</g>
  <path d="M80 68 L80 88" stroke="#ffc21a" stroke-width="1.6" stroke-dasharray="4 3"/>
  <path d="M8 2 L40 88 L64 88 Z" fill="#fff4d0" opacity=".14"/>
  <circle cx="10" cy="4" r="4" fill="#ffd2a0"/>`);

const HAUNTED = S(`
  <rect width="160" height="90" fill="#0a0614"/>
  <circle cx="34" cy="16" r="11" fill="#fff2d0"/><circle cx="34" cy="16" r="16" fill="#b8a0ff" opacity=".18"/>
  <path d="M60 46 V24 L80 10 L100 24 V46 Z M108 46 V22 L116 8 L124 22 V46 Z M40 46 V30 L48 20 L56 30 V46 Z" fill="#241c30"/>
  <g fill="#ffa040">${[[70, 30], [86, 30], [70, 38], [114, 26]].map(([x, y]) => `<rect x="${x}" y="${y}" width="5" height="5"/>`).join('')}</g>
  <g fill="#b070ff">${[[86, 38], [46, 34], [114, 36]].map(([x, y]) => `<rect x="${x}" y="${y}" width="5" height="5"/>`).join('')}</g>
  <path d="M136 46 V30 M136 34 L146 28 M136 38 L128 32" stroke="#2a1e24" stroke-width="2" fill="none"/>
  <rect x="0" y="40" width="160" height="8" fill="#b8a0ff" opacity=".16"/>
  <g stroke="#15121c" stroke-width="1.4">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => `<line x1="${4 + i * 10}" y1="40" x2="${4 + i * 10}" y2="48"/>`).join('')}</g>
  <path d="${FLOOR}" fill="#1e1828"/>
  <path d="${RIM}" fill="none" stroke="#a64dff" stroke-width="2"/>
  <path d="M74 66 A8 6 0 1 0 86 62 A6 4.5 0 1 1 74 66 Z" fill="#ff9a3a" opacity=".8"/>
  ${[[38, 58], [122, 58], [30, 76], [130, 76]].map(([x, y]) => `<g><ellipse cx="${x}" cy="${y}" rx="6" ry="5" fill="#ff7a1a"/><path d="M${x - 3} ${y - 1} l2 -2 l1 2 Z M${x + 1} ${y - 1} l2 -2 l1 2 Z" fill="#ffe08a"/><rect x="${x - 1}" y="${y - 7}" width="2" height="3" fill="#4a7a2a"/></g>`).join('')}`);

// Alpha 1.7.5: the cemetery set — crypt, teal moon, and the tombstones, columns and pumpkins ON the floor
const GRAVEYARD = S(`
  <rect width="160" height="90" fill="#06100f"/>
  <circle cx="128" cy="15" r="11" fill="#e8fff6"/><circle cx="128" cy="15" r="17" fill="#3affd0" opacity=".16"/>
  <path d="M112 22 q6 -6 12 -2 q6 -5 12 0 q5 -2 8 2 Z" fill="#2a2f44"/>
  <path d="M44 46 V22 L80 8 L116 22 V46 Z" fill="#262a36"/>
  <g fill="#4a4858">${[52, 64, 96, 108].map((x) => `<rect x="${x - 2}" y="22" width="4" height="24"/>`).join('')}</g>
  <path d="M72 46 V34 A8 8 0 0 1 88 34 V46 Z" fill="#3affd0" opacity=".85"/>
  <path d="M8 46 V30 M8 34 L18 26 M8 38 L2 31 M152 46 V28 M152 33 L144 25 M152 37 L158 31" stroke="#241a20" stroke-width="2" fill="none"/>
  <rect x="0" y="40" width="160" height="8" fill="#3affd0" opacity=".12"/>
  <g stroke="#14161c" stroke-width="1.4">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => `<line x1="${4 + i * 10}" y1="40" x2="${4 + i * 10}" y2="48"/><circle cx="${4 + i * 10}" cy="40" r="1" fill="#14161c"/>`).join('')}</g>
  <path d="${FLOOR}" fill="#16201e"/>
  <path d="${RIM}" fill="none" stroke="#3affd0" stroke-width="2"/>
  <path d="M80 50 L80 88" stroke="#3a3c46" stroke-width="5" stroke-dasharray="4 2"/>
  <g fill="#6a6474">
    <path d="M58 60 h9 v-6 a4.5 3 0 0 0 -9 0 Z"/><path d="M95 78 h11 v-7 a5.5 3.5 0 0 0 -11 0 Z"/>
  </g>
  <g fill="#5e5a6c"><rect x="99" y="52" width="6" height="11"/><rect x="98" y="51" width="8" height="2"/><rect x="54" y="72" width="7" height="13"/><rect x="53" y="71" width="9" height="2"/></g>
  ${[[80, 66, 7], [42, 70, 5], [120, 62, 5]].map(([x, y, r]) => `<g><rect x="${x - r}" y="${y + r * 0.4}" width="${r * 2}" height="${r * 0.6}" fill="#b8902e"/><ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.8}" fill="#ff7a1a"/><path d="M${x - r * 0.5} ${y - 1} l${r * 0.25} -${r * 0.35} l${r * 0.2} ${r * 0.35} Z M${x + r * 0.1} ${y - 1} l${r * 0.25} -${r * 0.35} l${r * 0.2} ${r * 0.35} Z" fill="#ffe08a"/><rect x="${x - 0.8}" y="${y - r * 0.8 - 2}" width="1.6" height="2.4" fill="#4a7a2a"/></g>`).join('')}`);

// Alpha 1.9.7 — HOLIDAY BROADCAST: the New Year studio before midnight — a clock at 11:59, a tree, garlands, gift boxes
const HOLIDAY = S(`
  <rect width="160" height="90" fill="#0a0e24"/>
  <rect x="0" y="0" width="160" height="46" fill="#141a44"/>
  ${[[14, 8], [36, 20], [58, 6], [104, 12], [126, 24], [150, 9], [86, 26]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1" fill="#dff6ff"/>`).join('')}
  <circle cx="80" cy="20" r="13" fill="#0d1230" stroke="#ffcc4d" stroke-width="2.4"/>
  <path d="M80 20 V10.5 M80 20 L78.6 11" stroke="#fff4d0" stroke-width="2" stroke-linecap="round"/>
  <path d="M8 4 Q40 16 80 6 Q120 16 152 4" stroke="#ffcc4d" stroke-width="1" fill="none"/>
  ${[16, 28, 40, 52, 64, 96, 108, 120, 132, 144].map((x, i) => `<circle cx="${x}" cy="${8 + (i % 2) * 3}" r="1.6" fill="${['#ff5a7a', '#7fe3ff', '#ffcc4d'][i % 3]}"/>`).join('')}
  <path d="M26 46 L36 22 L46 46 Z M29 38 L36 18 L43 38 Z" fill="#1f6b4a"/><circle cx="36" cy="18" r="2.2" fill="#ffcc4d"/>
  <path d="M114 46 L124 24 L134 46 Z" fill="#1f6b4a"/><circle cx="124" cy="23" r="2" fill="#ffcc4d"/>
  <rect x="0" y="40" width="160" height="8" fill="#7fe3ff" opacity=".14"/>
  <path d="${FLOOR}" fill="#1a1640"/>
  <path d="${RIM}" fill="none" stroke="#7fe3ff" stroke-width="2"/>
  <path d="M80 50 L80 88" stroke="#3a3466" stroke-width="5" stroke-dasharray="4 2"/>
  ${[[60, 64, 7, '#c4122f'], [100, 72, 7, '#c4122f'], [44, 76, 5, '#2a6aff'], [118, 58, 5, '#2a6aff']].map(([x, y, r, c]) => `<g><rect x="${+x - +r}" y="${+y - +r}" width="${+r * 2}" height="${+r * 2}" fill="${c}"/><rect x="${+x - 1}" y="${+y - +r}" width="2" height="${+r * 2}" fill="#ffcc4d"/><rect x="${+x - +r}" y="${+y - 1}" width="${+r * 2}" height="2" fill="#ffcc4d"/></g>`).join('')}
  <g fill="#e0b84c"><rect x="70" y="80" width="6" height="7"/><rect x="88" y="52" width="5" height="7"/></g>`);

// Alpha 1.9.8 — NEON NEWSROOM: the LED video wall with BREAKING NEWS, the ticker, the anchor desk, the news globe
const NEWSROOM = S(`
  <rect width="160" height="90" fill="#060b22"/>
  <rect x="0" y="0" width="160" height="46" fill="#0d1450"/>
  <g fill="#1a2a8a">${[0, 1, 2].map((i) => `<rect x="${3 + i * 7}" y="6" width="6" height="30" rx="1"/><rect x="${136 + i * 7}" y="6" width="6" height="30" rx="1"/>`).join('')}</g>
  <g fill="#3ae6ff" opacity=".7">${[0, 1, 2, 3, 4].map((i) => `<rect x="${4 + (i % 3) * 7}" y="${8 + i * 6}" width="4" height="4"/><rect x="${137 + ((i + 1) % 3) * 7}" y="${10 + i * 5}" width="4" height="4"/>`).join('')}</g>
  <rect x="44" y="4" width="72" height="30" rx="2" fill="#101a5a" stroke="#3ae6ff" stroke-width="1.5"/>
  <rect x="44" y="9" width="72" height="8" fill="#ff2f55"/>
  <text x="80" y="15.6" font-family="Arial Black,sans-serif" font-size="6.5" font-weight="900" fill="#fff" text-anchor="middle">BREAKING NEWS</text>
  <text x="80" y="27" font-family="Arial Black,sans-serif" font-size="6" font-weight="900" fill="#3ae6ff" text-anchor="middle">NEON NEWSROOM</text>
  <rect x="24" y="36" width="112" height="5" fill="#0a0f36"/><rect x="24" y="36" width="18" height="5" fill="#ff2f55"/>
  <path d="M52 46 L56 40 L104 40 L108 46 Z" fill="#18215e"/><rect x="54" y="40" width="52" height="1.4" fill="#3ae6ff"/>
  <path d="${FLOOR}" fill="#121c62"/>
  <path d="${RIM}" fill="none" stroke="#3ae6ff" stroke-width="2"/>
  <ellipse cx="80" cy="67" rx="15" ry="7" fill="none" stroke="#3ae6ff" stroke-width="1.2"/>
  <ellipse cx="80" cy="67" rx="7" ry="7" fill="none" stroke="#3ae6ff" stroke-width=".8"/>
  <ellipse cx="80" cy="67" rx="19" ry="9" fill="none" stroke="#a87aff" stroke-width="1.4"/>
  <rect x="62" y="56" width="12" height="4" rx="2" fill="#1c2670" stroke="#3ae6ff" stroke-width=".6" transform="rotate(-12 68 58)"/>
  <rect x="86" y="74" width="12" height="4" rx="2" fill="#1c2670" stroke="#3ae6ff" stroke-width=".6" transform="rotate(-12 92 76)"/>
  <rect x="45" y="61" width="5" height="8" rx="1" fill="#2a3070"/><rect x="110" y="66" width="5" height="8" rx="1" fill="#2a3070"/>
  <circle cx="122" cy="16" r="2" fill="#ff2f55"/>`);

const RANDOM = S(`
  <rect width="160" height="90" fill="#0b0e2c"/>
  <rect x="0" y="0" width="80" height="45" fill="#141c52"/><rect x="80" y="0" width="80" height="45" fill="#5a0f1c"/>
  <rect x="0" y="45" width="80" height="45" fill="#26282e"/><rect x="80" y="45" width="80" height="45" fill="#1e1828"/>
  <rect x="56" y="21" width="48" height="48" rx="10" fill="#fff" transform="rotate(-8 80 45)"/>
  <g fill="#1a1d4a" transform="rotate(-8 80 45)"><circle cx="68" cy="33" r="4"/><circle cx="92" cy="33" r="4"/><circle cx="80" cy="45" r="4"/><circle cx="68" cy="57" r="4"/><circle cx="92" cy="57" r="4"/></g>`);

/** The page's base (Vite `base: './'`); scripts run without Vite and get the same relative path. */
const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';

/**
 * Alpha 1.9.9 — CARD EVOLUTION: the owner's 3D previews of six sets (PRIME_TIME_1_9_9_ARENA_PREVIEWS) replace the flat
 * drawings above (kept as the fallback). The game's copies (scripts/art/prepare_art.py → public/arenas/sm/<id>.webp,
 * 480 × 264, ratio 1.815, transparent rounded corners) are only pictures: a set's name, availability and rules stay in
 * arenas.config.ts — HOLIDAY BROADCAST stays locked outside WINTER SHOWDOWN whatever its preview shows. HAUNTED PRIME
 * SET and RANDOM have no picture and keep their drawings in the same box (main.css «1.9.9 arena previews»).
 */
export const ARENA_PREVIEWS: Readonly<Partial<Record<ArenaPref, string>>> = {
  original: 'original',
  casino: 'casino',
  backlot: 'backlot',
  graveyard: 'graveyard',
  holiday: 'holiday',
  newsroom: 'newsroom',
};

/** The preview file of a set, or null (drawn). Every preview box is ≤ 120 CSS px wide, so one 480 px file is enough. */
export function arenaPreviewUrl(id: ArenaPref): string | null {
  const f = ARENA_PREVIEWS[id];
  return f ? `${BASE}arenas/sm/${f}.webp` : null;
}

const picture = (id: ArenaPref, drawn: string): string => {
  const url = arenaPreviewUrl(id);
  return url ? `<img class="arena-img" src="${url}" alt="" draggable="false" decoding="async" loading="lazy"/>` : drawn;
};

export const ARENA_ART: Record<ArenaPref, string> = {
  original: picture('original', ORIGINAL),
  casino: picture('casino', CASINO),
  backlot: picture('backlot', BACKLOT),
  haunted: picture('haunted', HAUNTED),
  graveyard: picture('graveyard', GRAVEYARD),
  holiday: picture('holiday', HOLIDAY),
  newsroom: picture('newsroom', NEWSROOM),
  random: picture('random', RANDOM),
};
