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

const RANDOM = S(`
  <rect width="160" height="90" fill="#0b0e2c"/>
  <rect x="0" y="0" width="80" height="45" fill="#141c52"/><rect x="80" y="0" width="80" height="45" fill="#5a0f1c"/>
  <rect x="0" y="45" width="80" height="45" fill="#26282e"/><rect x="80" y="45" width="80" height="45" fill="#1e1828"/>
  <rect x="56" y="21" width="48" height="48" rx="10" fill="#fff" transform="rotate(-8 80 45)"/>
  <g fill="#1a1d4a" transform="rotate(-8 80 45)"><circle cx="68" cy="33" r="4"/><circle cx="92" cy="33" r="4"/><circle cx="80" cy="45" r="4"/><circle cx="68" cy="57" r="4"/><circle cx="92" cy="57" r="4"/></g>`);

export const ARENA_ART: Record<ArenaPref, string> = {
  original: ORIGINAL,
  casino: CASINO,
  backlot: BACKLOT,
  haunted: HAUNTED,
  random: RANDOM,
};
