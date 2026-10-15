// SVG art for seasonal UI: currency icons, quest icons, reward previews and
// menu decorations. Inline SVG keeps everything crisp at any phone size and
// needs no extra files for GitHub Pages.

const S = (body: string, vb = '0 0 64 64', extra = '') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" ${extra}>${body}</svg>`;

// Solid fills only: SVG gradient ids would clash between the many inline copies.
const PUMPKIN_BODY = `
  <ellipse cx="20" cy="36" rx="13" ry="20" fill="#e2650e"/>
  <ellipse cx="44" cy="36" rx="13" ry="20" fill="#e2650e"/>
  <ellipse cx="32" cy="36" rx="15" ry="22" fill="#ff8a1f"/>
  <ellipse cx="27" cy="27" rx="6" ry="9" fill="#ffc86a" opacity=".45"/>
  <path d="M30 15 C30 9 33 6 37 5 L38 8 C35 9 34 11 34 15 Z" fill="#5a8a2e"/>`;

export const ICONS = {
  pumpkin: S(
    `${PUMPKIN_BODY}
     <path d="M21 31 L27 31 L24 25 Z M37 31 L43 31 L40 25 Z" fill="#fff1b0"/>
     <path d="M20 40 L25 44 L29 40 L32 45 L35 40 L39 44 L44 40 Q32 54 20 40 Z" fill="#fff1b0"/>`,
  ),
  snowflake: S(
    `<g stroke="#e6f9ff" stroke-width="4" stroke-linecap="round" fill="none">
      <path d="M32 6 V58 M9.5 19 L54.5 45 M9.5 45 L54.5 19"/>
      <path d="M26 10 L32 16 L38 10 M26 54 L32 48 L38 54 M12 26 L19 28 L17 20 M52 38 L45 36 L47 44 M12 38 L19 36 L17 44 M52 26 L45 28 L47 20"/>
    </g>`,
  ),
  moon: S(`<path d="M40 8 A24 24 0 1 0 56 44 A19 19 0 1 1 40 8 Z" fill="#ffe7a0"/><circle cx="20" cy="18" r="2" fill="#fff"/><circle cx="12" cy="34" r="1.5" fill="#fff"/>`),
  combo: S(`<path d="M8 40 L24 16 L30 30 L44 8 L40 28 L56 26 L34 56 L36 38 Z" fill="#ffd23a" stroke="#7a3a00" stroke-width="2" stroke-linejoin="round"/>`),
  star: S(`<path d="M32 4 L40 23 L60 24 L44 37 L50 58 L32 46 L14 58 L20 37 L4 24 L24 23 Z" fill="#ffd23a" stroke="#7a3a00" stroke-width="2" stroke-linejoin="round"/>`),
  ghost: S(
    `<path d="M14 58 V28 C14 15 22 8 32 8 C42 8 50 15 50 28 V58 L43 52 L37 58 L32 52 L27 58 L21 52 Z" fill="#efe6ff"/>
     <ellipse cx="25" cy="28" rx="4" ry="6" fill="#2a1446"/><ellipse cx="39" cy="28" rx="4" ry="6" fill="#2a1446"/>`,
  ),
  clock: S(
    `<circle cx="32" cy="34" r="24" fill="#2a1446" stroke="#b45cff" stroke-width="5"/>
     <path d="M32 18 V34 L43 41" stroke="#ffe7a0" stroke-width="5" stroke-linecap="round" fill="none"/>
     <path d="M14 10 L22 14 M50 10 L42 14" stroke="#b45cff" stroke-width="5" stroke-linecap="round"/>`,
  ),
  crown: S(
    `<path d="M8 50 L12 18 L24 32 L32 12 L40 32 L52 18 L56 50 Z" fill="#ffd23a" stroke="#7a3a00" stroke-width="2.5" stroke-linejoin="round"/>
     <rect x="8" y="50" width="48" height="7" rx="2" fill="#ff8a1f"/>
     <circle cx="32" cy="38" r="4" fill="#b45cff"/>`,
  ),
  tv: S(
    `<rect x="6" y="14" width="52" height="38" rx="7" fill="#2a1446" stroke="#ff8a1f" stroke-width="4"/>
     <path d="M24 4 L32 13 L40 4" stroke="#ff8a1f" stroke-width="4" stroke-linecap="round" fill="none"/>
     <path d="M20 40 L28 28 L34 36 L38 30 L46 40 Z" fill="#a8ff60"/>`,
  ),
  check: S(`<path d="M12 34 L26 48 L52 18" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`),
  lock: S(`<rect x="14" y="28" width="36" height="28" rx="6" fill="currentColor"/><path d="M22 28 V20 A10 10 0 0 1 42 20 V28" stroke="currentColor" stroke-width="6" fill="none"/>`),
  calendar: S(
    `<rect x="8" y="12" width="48" height="44" rx="7" fill="none" stroke="currentColor" stroke-width="5"/>
     <path d="M8 26 H56 M20 6 V16 M44 6 V16" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>`,
  ),
};

export type QuestIcon = 'moon' | 'combo' | 'star' | 'ghost' | 'clock' | 'crown' | 'tv';

/** Large preview art for reward cards. */
export const REWARD_ART: Record<'card' | 'frame' | 'phantom' | 'victory' | 'crown' | 'belt', string> = {
  card: S(
    `<rect x="16" y="6" width="40" height="54" rx="7" fill="#24123c" stroke="#ff8a1f" stroke-width="3" transform="rotate(10 36 33)"/>
     <rect x="8" y="8" width="40" height="54" rx="7" fill="#6a2ab8" stroke="#ffb347" stroke-width="3"/>
     <path d="M8 18 Q14 16 18 8 M48 18 Q42 16 38 8" stroke="#e8dcff" stroke-width="1.2" fill="none" opacity=".7"/>
     <g transform="translate(14 22) scale(.44)">${PUMPKIN_BODY}</g>`,
  ),
  frame: S(
    `<rect x="6" y="10" width="52" height="40" rx="5" fill="#140a22"/>
     <path d="M6 20 V10 H16 M48 10 H58 V20 M58 40 V50 H48 M16 50 H6 V40" stroke="#ff8a1f" stroke-width="4" fill="none" stroke-linecap="round"/>
     <rect x="20" y="15" width="24" height="9" rx="3" fill="#ff6a1a"/><circle cx="24" cy="19.5" r="2" fill="#fff"/>
     <path d="M28 18 H40 M28 21 H36" stroke="#fff" stroke-width="1.6"/>
     <path d="M14 44 L22 34 L28 40 L34 32 L50 44 Z" fill="#b45cff" opacity=".8"/>`,
  ),
  phantom: S(
    `<path d="M4 44 C16 40 22 30 34 30" stroke="#a855ff" stroke-width="10" stroke-linecap="round" fill="none" opacity=".35"/>
     <path d="M10 40 C20 36 26 30 36 30" stroke="#a855ff" stroke-width="6" stroke-linecap="round" fill="none" opacity=".6"/>
     <path d="M40 16 C48 16 54 22 54 30 V50 L50 47 L46 50 L42 47 L38 50 V30 C38 22 34 16 40 16 Z" fill="#d9b8ff"/>
     <circle cx="43" cy="29" r="2.4" fill="#2a1446"/><circle cx="50" cy="29" r="2.4" fill="#2a1446"/>
     <circle cx="20" cy="22" r="2.5" fill="#9dff5c"/><circle cx="12" cy="52" r="2" fill="#9dff5c"/><circle cx="28" cy="48" r="1.6" fill="#9dff5c"/>`,
  ),
  victory: S(
    `<path d="M32 60 L22 32 M32 60 L42 30 M32 60 L32 26" stroke="#ffd27a" stroke-width="2" opacity=".6"/>
     <g transform="translate(18 2) scale(.45)">${PUMPKIN_BODY}</g>
     <g transform="translate(2 22) scale(.32)">${PUMPKIN_BODY}</g>
     <g transform="translate(42 20) scale(.34)">${PUMPKIN_BODY}</g>
     <rect x="12" y="44" width="4" height="4" fill="#b45cff" transform="rotate(20 14 46)"/>
     <rect x="48" y="48" width="4" height="4" fill="#a8ff60" transform="rotate(40 50 50)"/>
     <rect x="30" y="40" width="3" height="3" fill="#fff"/>`,
  ),
  crown: S(
    `<circle cx="32" cy="34" r="26" fill="#2a1446" stroke="#ffd23a" stroke-width="3"/>
     <path d="M14 44 L17 22 L26 32 L32 16 L38 32 L47 22 L50 44 Z" fill="#ffd23a" stroke="#7a3a00" stroke-width="2" stroke-linejoin="round"/>
     <g transform="translate(24 30) scale(.26)">${PUMPKIN_BODY}</g>`,
  ),
  // Alpha 1.3.1: championship belt (BOSS FIGHT first-win title)
  belt: S(
    `<circle cx="32" cy="32" r="28" fill="#1a1208" stroke="#ffd23a" stroke-width="2.5"/>
     <rect x="2" y="27" width="60" height="12" rx="4" fill="#2a1d10" stroke="#7a5a1a" stroke-width="1.5"/>
     <ellipse cx="32" cy="33" rx="17" ry="13" fill="#ffc23a" stroke="#7a3a00" stroke-width="2"/>
     <ellipse cx="32" cy="33" rx="12" ry="9" fill="#ffe9a0"/>
     <circle cx="32" cy="33" r="4.5" fill="#e8202a" stroke="#7a0a10" stroke-width="1.2"/>
     <rect x="8" y="29" width="7" height="8" rx="2" fill="#d8a23a"/><rect x="49" y="29" width="7" height="8" rx="2" fill="#d8a23a"/>
     <path d="M24 14 L27 6 L32 12 L37 6 L40 14 Z" fill="#ffd23a" stroke="#7a3a00" stroke-width="1.5" stroke-linejoin="round"/>`,
  ),
};

/** Corner cobweb for the Halloween menu decor (top-left; mirrored with CSS for the right). */
export function cobwebSVG(): string {
  const spokes: string[] = [];
  const rings: string[] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    spokes.push(`M0 0 L${(Math.cos(a) * 150).toFixed(1)} ${(Math.sin(a) * 150).toFixed(1)}`);
  }
  for (let r = 22; r < 150; r += 24) {
    let d = '';
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * (Math.PI / 2);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) d += `M${x.toFixed(1)} ${y.toFixed(1)}`;
      else {
        const m = a - Math.PI / 4 / n;
        d += ` Q${(Math.cos(m) * r * 0.84).toFixed(1)} ${(Math.sin(m) * r * 0.84).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }
    }
    rings.push(d);
  }
  return S(
    `<g fill="none" stroke="currentColor" stroke-linecap="round"><path d="${spokes.join(' ')}" stroke-width="1.1"/><path d="${rings.join(' ')}" stroke-width=".9"/></g>
     <path d="M96 0 V58" stroke="currentColor" stroke-width=".8"/><circle cx="96" cy="62" r="4" fill="currentColor"/>`,
    '0 0 150 150',
  );
}

export function frostCornerSVG(): string {
  const flake = (x: number, y: number, r: number) =>
    `<g transform="translate(${x} ${y})" stroke="currentColor" stroke-linecap="round" stroke-width="${(r / 9).toFixed(1)}"><path d="M0 ${-r} V${r} M${-r * 0.87} ${-r / 2} L${r * 0.87} ${r / 2} M${-r * 0.87} ${r / 2} L${r * 0.87} ${-r / 2}"/></g>`;
  return S(
    `<path d="M0 0 H150 C120 10 100 8 84 22 C66 36 46 30 30 50 C18 66 10 90 0 110 Z" fill="currentColor" opacity=".16"/>
     ${flake(26, 22, 14)}${flake(70, 16, 9)}${flake(18, 64, 8)}${flake(104, 10, 6)}`,
    '0 0 150 150',
  );
}

export const BAT_SVG = S(
  `<path d="M32 18 C26 8 14 9 2 16 C8 17 11 21 12 25 C16 22 20 23 24 27 C27 24 30 25 32 30 C34 25 37 24 40 27 C44 23 48 22 52 25 C53 21 56 17 62 16 C50 9 38 8 32 18 Z M29 15 L30 10 L32 14 L34 10 L35 15 Z" fill="currentColor"/>`,
  '0 0 64 34',
);
