// Beta 2.0 VISUAL EVOLUTION — the owner's emblem and icon pictures in the game's UI.
//
// The originals stay untouched in PRIME_TIME_2_0_RANK_ART/ and PRIME_TIME_2_0_EFFECT_PREVIEWS/; the game gets square
// WebP copies (scripts/art/prepare_art.py --icons-only → public/ui/<group>/<size>/<id>.webp, all with one margin, so a
// 1024² render and a 1254² one, a tall badge and a wide trail stand at one scale). The manifest's `icons` section and
// `npm run art20` keep this module, the script and the files in step.
//
// Every picture is an <img> with a FALLBACK: if its file cannot be loaded (an old cache, a broken connection), the
// element is swapped for the game's previous drawing (the SVG rank badge, the CSS level hexagon, the old icons). The
// fallback is named in data-fb ("kind|arg|arg…") and rebuilt by the function registered for that kind — no inline
// handlers (the page's CSP allows none).

/** The canvas sides of every group's variants (= ICON_SIZES in prepare_art.py). */
export const ICON_SIZES = {
  ranks: { xs: 96, sm: 192, md: 400 },
  'ranks-plain': { xs: 96, sm: 192 },
  league: { sm: 192, md: 400 },
  levels: { sm: 192 },
  stages: { sm: 192, md: 400 },
  fame: { xs: 96, sm: 192 },
  modes: { sm: 192, md: 400 },
  currency: { xs: 96, sm: 192 },
  effects: { sm: 256, md: 512 },
  // Beta 2.0 final: the existing achievements, the collection's reward sections, two seasonal goals
  achievements: { sm: 192, md: 400 },
  rewards: { xs: 96, sm: 192 },
  goals: { xs: 96, sm: 192 },
  // Beta 2.2: MY COLLECTION's section emblems; titles (the PRIME LEAGUE road's and DAILY PRIME STREAK's)
  sections: { sm: 192, md: 400 },
  titles: { xs: 96, sm: 192, md: 400 },
  // Beta 2.2 final: WINTER SHOWDOWN's quests and the season's dress of the DAILY gift
  winter: { xs: 96, sm: 192, md: 400 },
  // Beta 2.3: the main screen's own icons (the DAILY gift, «Пригласить друга», PRIME SHOP, CARDS, settings)
  ui: { xs: 96, sm: 192 },
  // Beta 2.6: DAILY MISSIONS' own picture (the daily window's entry 44–52 px, the missions window's header 64–84 px)
  missions: { xs: 96, sm: 192, md: 400 },
} as const;

export type IconGroup = keyof typeof ICON_SIZES;

/** The page's base (Vite `base: './'`); scripts run without Vite and get the same relative path. */
const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';

/** Device pixels a CSS pixel takes on the sharpest phones the game meets (iPhone: 3×). */
const DPR = 3;

/** The smallest variant that is sharp at `cssPx` on a 3× screen (else the largest there is). */
export function iconVariant(group: IconGroup, cssPx: number): string {
  const sizes = Object.entries(ICON_SIZES[group]).sort((a, b) => a[1] - b[1]);
  const need = cssPx * DPR;
  return (sizes.find(([, side]) => side >= need) ?? sizes[sizes.length - 1])[0];
}

export function iconUrl(group: IconGroup, id: string, cssPx: number): string {
  return `${BASE}ui/${group}/${iconVariant(group, cssPx)}/${id}.webp`;
}

/** Attribute-safe text. */
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export interface ArtImgOptions {
  cls?: string;
  /** Text for screen readers (empty: decorative). */
  alt?: string;
  /** "kind|arg|…" — the drawing that replaces the picture if its file fails (see registerFallback). */
  fb?: string;
  /** Inline style for the element (e.g. a CSS variable the old drawing needs). */
  style?: string;
  /** Width / height when the box is not square (default: both cssPx). */
  w?: number;
  h?: number;
}

/** One picture of a group at `cssPx` CSS pixels (square unless w/h say otherwise). */
export function artImg(group: IconGroup, id: string, cssPx: number, o: ArtImgOptions = {}): string {
  const w = o.w ?? cssPx;
  const h = o.h ?? cssPx;
  const alt = o.alt ?? '';
  return `<img class="art-ico ${o.cls ?? ''}" src="${iconUrl(group, id, Math.max(w, h))}" width="${w}" height="${h}" alt="${attr(alt)}"${alt ? '' : ' aria-hidden="true"'} decoding="async" draggable="false"${o.fb ? ` data-fb="${attr(o.fb)}"` : ''}${o.style ? ` style="${attr(o.style)}"` : ''}>`;
}

// ------------------------------------------------------------------ fallbacks
const FALLBACKS = new Map<string, (args: string[]) => string>();

/** Registers how to redraw a picture of `kind` the old way (args are the strings after the kind in data-fb). */
export function registerFallback(kind: string, draw: (args: string[]) => string): void {
  FALLBACKS.set(kind, draw);
}

/** The old drawing for a data-fb value ('' when nothing is registered). */
export function fallbackHTML(fb: string): string {
  const [kind, ...args] = fb.split('|');
  const draw = FALLBACKS.get(kind);
  return draw ? draw(args) : '';
}

if (typeof document !== 'undefined') {
  // capture phase: <img> error events do not bubble
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.dataset.fb) return;
      const html = fallbackHTML(img.dataset.fb);
      if (!html) return;
      img.insertAdjacentHTML('afterend', html);
      img.remove();
    },
    true,
  );
}
