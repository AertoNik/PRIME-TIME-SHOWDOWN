import { shownPortrait, type ProducerLook, type ProducerPortrait } from '../config/producer.config';

// Alpha 1.9.0 — PRIME PRODUCER AVATARS: original vector portraits of the show's producers (head and shoulders, one camera,
// one light), drawn here from the catalogue in src/config/producer.config.ts — no photos, no external images, crisp at any
// size (Retina included). Pure strings: the same code renders the game, the preview sheet and tests. A producer is a
// persona, never a fighter: fighters keep their own 3D portraits.
// Alpha 1.9.4 — the catalogue is 3D portraits now (transparent PNG busts in public/producers/): the backdrop and the frame
// stay this file's vector layers around the picture, so any portrait wears any backdrop and frame.
// Alpha 1.9.5 — 3D only: the 1.9.0 vector drawing of the producers left the build (it stays in the 1.9.4 sources for a
// rollback); a look saved with a legacy id is shown as its own portrait (producer.config.ts shownPortrait).

/** The page's base (Vite `base: './'`); scripts run without Vite and get the same relative path. */
const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
/** The file of a portrait for a badge of `size` px: 128 px up to 72 px badges (Retina included), else 256 px. */
export const portraitUrl = (p: ProducerPortrait, size: number) => `${BASE}producers/${size > 72 ? 256 : 128}/${p.image}`;

let uid = 0;


function backdrop(id: string, k: string): string {
  switch (id) {
    case 'cyan':
      return `<defs><radialGradient id="bd${k}" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="#3ff6e6"/><stop offset=".55" stop-color="#127a8c"/><stop offset="1" stop-color="#071c33"/></radialGradient></defs><rect width="120" height="120" fill="url(#bd${k})"/><path d="M30 0L52 120H68L90 0Z" fill="#fff" opacity=".07"/>`;
    case 'sunset':
      return `<defs><linearGradient id="bd${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4fa0"/><stop offset=".55" stop-color="#ff8a3c"/><stop offset="1" stop-color="#3a0f3e"/></linearGradient></defs><rect width="120" height="120" fill="url(#bd${k})"/><circle cx="60" cy="58" r="30" fill="#ffd27a" opacity=".22"/>`;
    case 'night':
      return `<defs><radialGradient id="bd${k}" cx=".5" cy=".3" r=".8"><stop offset="0" stop-color="#2a2f6e"/><stop offset="1" stop-color="#070a1c"/></radialGradient></defs><rect width="120" height="120" fill="url(#bd${k})"/>${[
        [18, 20],
        [96, 16],
        [104, 44],
        [12, 52],
        [28, 8],
        [88, 30],
      ]
        .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 2 ? 1 : 1.4}" fill="#fff" opacity=".7"/>`)
        .join('')}<path d="M0 96H120M0 104H120M0 112H120" stroke="#7a5cff" stroke-width=".6" opacity=".35"/>`;
    default:
      return `<defs><radialGradient id="bd${k}" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="#9d86ff"/><stop offset=".55" stop-color="#4a2fb0"/><stop offset="1" stop-color="#140c38"/></radialGradient></defs><rect width="120" height="120" fill="url(#bd${k})"/><ellipse cx="60" cy="40" rx="34" ry="26" fill="#fff" opacity=".1"/>`;
  }
}

function frame(id: string, k: string, hex: boolean): string {
  switch (id) {
    case 'neon':
      return `<circle cx="60" cy="60" r="56.5" fill="none" stroke="#ff4fd8" stroke-width="6" opacity=".18"/><circle cx="60" cy="60" r="56.5" fill="none" stroke="#ff4fd8" stroke-width="2.2"/><circle cx="60" cy="60" r="52.6" fill="none" stroke="#7a5cff" stroke-width="1.6"/>`;
    case 'onair':
      return `<circle cx="60" cy="60" r="55.5" fill="none" stroke="#e9e4ff" stroke-width="3.2"/>${Array.from({ length: 24 }, (_, i) => `<rect x="59.3" y="1.2" width="1.4" height="${i % 6 === 0 ? 5 : 3}" fill="#e9e4ff" opacity="${i % 6 === 0 ? 1 : 0.55}" transform="rotate(${i * 15} 60 60)"/>`).join('')}<circle cx="60" cy="4.6" r="3.4" fill="#ff3a4a" stroke="#fff" stroke-width="1"/>`;
    case 'prime':
      return `<defs><linearGradient id="fr${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22f0e0"/><stop offset="1" stop-color="#9d86ff"/></linearGradient></defs><path d="${hex ? HEX : ''}" fill="none" stroke="url(#fr${k})" stroke-width="4" stroke-linejoin="round"/>`;
    default:
      return `<defs><linearGradient id="fr${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22f0e0"/><stop offset="1" stop-color="#7a5cff"/></linearGradient></defs><circle cx="60" cy="60" r="55.5" fill="none" stroke="url(#fr${k})" stroke-width="4"/>`;
  }
}

const HEX = 'M60 4L108.5 32V88L60 116L11.5 88V32Z';

/** The bust stands on the badge's lower edge; the hair keeps a margin under the top of the circle and of the hexagon. */
function portrait(a: ProducerPortrait, size: number): string {
  return `<image href="${portraitUrl(a, size)}" x="8" y="14" width="104" height="104" preserveAspectRatio="xMidYMax meet"/>`;
}

/** The producer's badge: backdrop + portrait + frame, at `size` px (any size). */
export function producerSVG(look: ProducerLook, size = 64, cls = ''): string {
  // (1.9.5: always a 3D portrait — a legacy or unknown id resolves to its portrait, never an empty badge)
  const a = shownPortrait(look.avatar);
  const k = 'p' + ++uid;
  const hex = look.frame === 'prime';
  const clip = hex ? `<path d="${HEX}"/>` : '<circle cx="60" cy="60" r="54"/>';
  return `<svg class="pr-ava ${cls}" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="${a.ru}">
    <defs><clipPath id="c${k}">${clip}</clipPath></defs>
    <g clip-path="url(#c${k})">${backdrop(look.backdrop, k)}${portrait(a, size)}</g>
    ${frame(look.frame, k, hex)}
  </svg>`;
}

/** A PRIME NETWORK participant: the network's emblem, never a human face (system line-ups are not people). */
export function systemProducerSVG(size = 64, cls = ''): string {
  const k = 's' + ++uid;
  return `<svg class="pr-ava pr-sys ${cls}" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="PRIME NETWORK">
    <defs><radialGradient id="g${k}" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="#3a2f8a"/><stop offset="1" stop-color="#0b0f2a"/></radialGradient></defs>
    <path d="${HEX}" fill="url(#g${k})" stroke="#5ec8ff" stroke-width="3" stroke-linejoin="round"/>
    <rect x="34" y="44" width="40" height="30" rx="5" fill="none" stroke="#5ec8ff" stroke-width="4"/><path d="M74 52L88 44V74L74 66Z" fill="none" stroke="#5ec8ff" stroke-width="4" stroke-linejoin="round"/>
    <circle cx="44" cy="54" r="3.4" fill="#ff3a4a"/><text x="60" y="96" text-anchor="middle" font-family="Unbounded, Arial Black, sans-serif" font-size="11" font-weight="900" fill="#5ec8ff" letter-spacing="1">NETWORK</text>
  </svg>`;
}
