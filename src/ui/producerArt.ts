import { PRODUCER_AVATARS, avatarById, type ProducerAvatar, type ProducerLook } from '../config/producer.config';

// Alpha 1.9.0 — PRIME PRODUCER AVATARS: original vector portraits of the show's producers (head and shoulders, one camera,
// one light), drawn here from the catalogue in src/config/producer.config.ts — no photos, no external images, crisp at any
// size (Retina included). Pure strings: the same code renders the game, the preview sheet and tests. A producer is a
// persona, never a fighter: fighters keep their own 3D portraits.

let uid = 0;

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

const FACE = { soft: { rx: 20, ry: 23.5 }, square: { rx: 21, ry: 24 }, oval: { rx: 19.2, ry: 24.5 } } as const;
const CX = 60;
const CY = 52;

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

/** Hair drawn BEHIND the head (long hair, braids, ponytail, afro volume). */
function hairBack(a: ProducerAvatar): string {
  const c = a.hair.color;
  const d = shade(c, -0.25);
  switch (a.hair.style) {
    case 'waves_long':
      return `<path d="M34 50C30 30 44 20 60 20C76 20 90 30 86 52C90 66 92 80 88 96C84 102 76 100 74 92C72 84 76 74 72 66H48C44 74 48 84 46 92C44 100 36 102 32 96C28 80 30 66 34 50Z" fill="${c}"/><path d="M36 70C34 80 36 90 32 96M84 70C86 80 84 90 88 96" stroke="${d}" stroke-width="1.5" fill="none" opacity=".6"/>`;
    case 'afro':
      return `<circle cx="60" cy="42" r="31" fill="${c}"/>${[0, 40, 80, 120, 160, 200, 240, 280, 320].map((t) => `<circle cx="${(60 + Math.cos((t * Math.PI) / 180) * 29).toFixed(1)}" cy="${(42 + Math.sin((t * Math.PI) / 180) * 29).toFixed(1)}" r="7" fill="${c}"/>`).join('')}`;
    case 'bob':
      return `<path d="M36 52C34 28 86 28 84 52V70C80 74 74 74 71 68H49C46 74 40 74 36 70Z" fill="${c}"/>`;
    case 'braids': {
      const beads = a.extras.includes('beads');
      const braid = (x: number, dir: number) =>
        Array.from({ length: 7 }, (_, i) => `<ellipse cx="${x + dir * i * 0.4}" cy="${56 + i * 6.2}" rx="3.6" ry="3.6" fill="${i % 2 ? c : d}"/>`).join('') + (beads ? `<circle cx="${x + dir * 2.6}" cy="98" r="2.2" fill="#ffd23a"/>` : '');
      return `<path d="M37 52C35 28 85 28 83 52V60H37Z" fill="${c}"/>${braid(38, -1)}${braid(43, -1)}${braid(82, 1)}${braid(77, 1)}`;
    }
    case 'ponytail':
      return `<path d="M76 30C92 30 98 48 92 66C88 78 92 90 86 98C84 86 80 78 82 66C84 54 82 40 74 34Z" fill="${c}"/>`;
    case 'bald':
      return `<path d="M39 50C39 44 41 42 42 46V58H39ZM81 50C81 44 79 42 78 46V58H81Z" fill="${c}" opacity=".7"/>`;
    default:
      return '';
  }
}

function outfit(a: ProducerAvatar): string {
  const { kind, color, accent } = a.outfit;
  const dk = shade(color, -0.28);
  const S = 'M12 120C14 96 34 85 60 85C86 85 106 96 108 120Z';
  const lapels = `<path d="M50 85L60 104L54 120H38C40 100 44 90 50 85Z" fill="${dk}"/><path d="M70 85L60 104L66 120H82C80 100 76 90 70 85Z" fill="${dk}"/>`;
  const pin = a.extras.includes('pin') ? `<path d="M43 99l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z" fill="#ffd23a"/>` : '';
  switch (kind) {
    case 'suit_tie':
      return `<path d="${S}" fill="${color}"/><path d="M50 85L60 104L70 85Z" fill="#f4f1fb"/><path d="M58.3 87.5H61.7L63 101L60 106L57 101Z" fill="${accent}"/>${lapels}${pin}`;
    case 'suit_bow':
      return `<path d="${S}" fill="${color}"/><path d="M50 85L60 104L70 85Z" fill="#f4f1fb"/><path d="M53 88L59.5 91L53 94ZM67 88L60.5 91L67 94Z" fill="${accent}"/><circle cx="60" cy="91" r="1.8" fill="${shade(accent, -0.3)}"/>${lapels}${pin}`;
    case 'sequin':
      return `<path d="${S}" fill="${color}"/><path d="M53 85L60 95L67 85Z" fill="${shade(a.skin, -0.08)}"/>${Array.from({ length: 30 }, (_, i) => {
        const x = 18 + (i % 10) * 9.4 + (Math.floor(i / 10) % 2) * 4.7;
        const y = 96 + Math.floor(i / 10) * 8;
        return x > 50 && x < 70 && y < 100 ? '' : `<circle cx="${x.toFixed(1)}" cy="${y}" r="1.3" fill="${accent}" opacity=".85"/>`;
      }).join('')}`;
    case 'bomber':
      return `<path d="${S}" fill="${color}"/><path d="M46 86Q60 94 74 86L76 90Q60 99 44 90Z" fill="${accent}"/><path d="M46.5 88.3Q60 96 73.5 88.3" stroke="${shade(accent, -0.35)}" stroke-width=".8" fill="none"/><path d="M60 95V120" stroke="${dk}" stroke-width="1.6"/><path d="M24 104C26 112 26 116 25 120M96 104C94 112 94 116 95 120" stroke="${dk}" stroke-width="1.4" fill="none"/>`;
    case 'blazer_tee':
      return `<path d="${S}" fill="${color}"/><path d="M48 85Q60 99 72 85L72 120H48Z" fill="${accent}"/>${lapels}${pin}`;
    case 'turtleneck':
      return `<path d="${S}" fill="${color}"/><rect x="48" y="72" width="24" height="17" rx="7" fill="${shade(color, 0.12)}"/><path d="M51 76V87M55 76V88M59 76V88M63 76V88M67 76V87" stroke="${dk}" stroke-width=".7" opacity=".55"/><path d="M60 104l1.4 2.8 3 .5-2.2 2.1.5 3-2.7-1.4-2.7 1.4.5-3-2.2-2.1 3-.5z" fill="${accent}" opacity=".9"/>`;
    case 'hoodie_blazer':
      return `<path d="${S}" fill="${color}"/><path d="M42 88C44 78 52 76 60 80C68 76 76 78 78 88L72 120H48Z" fill="${accent}"/><path d="M56 88V100M64 88V100" stroke="#f4f1fb" stroke-width="1.1"/><circle cx="56" cy="101" r="1.2" fill="#f4f1fb"/><circle cx="64" cy="101" r="1.2" fill="#f4f1fb"/>${lapels}`;
  }
}

function head(a: ProducerAvatar, k: string): string {
  const { rx, ry } = FACE[a.face];
  const s = a.skin;
  const sd = shade(s, -0.16);
  const jaw = a.face === 'square' ? `<path d="M${CX - rx} ${CY}Q${CX - rx} ${CY + 20} ${CX - 8} ${CY + 24}H${CX + 8}Q${CX + rx} ${CY + 20} ${CX + rx} ${CY}Z" fill="${s}"/>` : '';
  return `<defs><radialGradient id="sk${k}" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="${shade(s, 0.12)}"/><stop offset="1" stop-color="${s}"/></radialGradient></defs>
    <path d="M51 68V86Q60 91 69 86V68Z" fill="${sd}"/>
    <ellipse cx="${CX - rx + 0.5}" cy="${CY + 2}" rx="3.6" ry="5.2" fill="${s}"/><ellipse cx="${CX + rx - 0.5}" cy="${CY + 2}" rx="3.6" ry="5.2" fill="${s}"/>
    <ellipse cx="${CX}" cy="${CY}" rx="${rx}" ry="${ry}" fill="url(#sk${k})"/>${jaw}
    <path d="M${CX - rx + 3} ${CY + 8}Q${CX} ${CY + ry + 4} ${CX + rx - 3} ${CY + 8}Q${CX} ${CY + ry - 2} ${CX - rx + 3} ${CY + 8}Z" fill="${sd}" opacity=".28"/>`;
}

function face(a: ProducerAvatar): string {
  const ink = '#1d1530';
  const brow = a.hair.style === 'bald' || a.hair.style === 'swept' ? shade(a.hair.color, -0.4) : a.hair.color;
  const ey = 52;
  const eye = (x: number) => {
    if (a.eyes === 'round') return `<ellipse cx="${x}" cy="${ey}" rx="2.5" ry="2.9" fill="${ink}"/><circle cx="${x + 0.9}" cy="${ey - 1}" r=".9" fill="#fff"/>`;
    if (a.eyes === 'almond') return `<path d="M${x - 3.6} ${ey}Q${x} ${ey - 3.4} ${x + 3.6} ${ey}Q${x} ${ey + 2.6} ${x - 3.6} ${ey}Z" fill="#fff"/><circle cx="${x}" cy="${ey}" r="2" fill="${ink}"/><circle cx="${x + 0.7}" cy="${ey - 0.7}" r=".6" fill="#fff"/><path d="M${x - 3.8} ${ey - 0.2}Q${x} ${ey - 3.8} ${x + 3.8} ${ey - 0.2}" stroke="${ink}" stroke-width="1" fill="none"/>`;
    return `<ellipse cx="${x}" cy="${ey + 0.4}" rx="2.4" ry="2.4" fill="${ink}"/><circle cx="${x + 0.8}" cy="${ey - 0.4}" r=".7" fill="#fff"/><path d="M${x - 3.6} ${ey - 1}H${x + 3.6}" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/>`;
  };
  const bw = a.brows === 'bold' ? 2.4 : 1.6;
  const brows =
    a.brows === 'arch'
      ? `<path d="M48.5 46Q52 43.2 55.5 45.4M64.5 45.4Q68 43.2 71.5 46" stroke="${brow}" stroke-width="${bw}" stroke-linecap="round" fill="none"/>`
      : a.brows === 'flat'
        ? `<path d="M48.5 45.6L55.8 44.8M64.2 44.8L71.5 45.6" stroke="${brow}" stroke-width="${bw}" stroke-linecap="round" fill="none"/>`
        : `<path d="M48 46.4Q52 44 56 45.2M64 45.2Q68 44 72 46.4" stroke="${brow}" stroke-width="${bw}" stroke-linecap="round" fill="none"/>`;
  const nose = `<path d="M60.5 54.5Q58.6 59 58.8 60.2Q60 61.2 61.6 60.4" stroke="${shade(a.skin, -0.35)}" stroke-width="1.1" stroke-linecap="round" fill="none"/>`;
  const lipC = '#7a2a3c';
  const mouths: Record<string, string> = {
    smile: `<path d="M54.5 64.2Q60 68.6 65.5 64.2" stroke="${lipC}" stroke-width="1.6" stroke-linecap="round" fill="none"/>`,
    grin: `<path d="M53.8 63.4Q60 71 66.2 63.4Z" fill="#3a1222"/><path d="M55 64Q60 66 65 64L64.6 65.4Q60 66.8 55.4 65.4Z" fill="#fff"/>`,
    smirk: `<path d="M55 65Q60.5 66.6 66 62.6" stroke="${lipC}" stroke-width="1.6" stroke-linecap="round" fill="none"/>`,
    laugh: `<path d="M53.4 63Q60 73 66.6 63Z" fill="#3a1222"/><path d="M54.6 63.6Q60 65.4 65.4 63.6L65 65Q60 66.5 55 65Z" fill="#fff"/><ellipse cx="60" cy="68.4" rx="3.4" ry="1.6" fill="#e0607a"/>`,
    calm: `<path d="M56.2 64.6Q60 65.8 63.8 64.6" stroke="${lipC}" stroke-width="1.5" stroke-linecap="round" fill="none"/>`,
    lips: `<path d="M55 64Q57.5 62.4 60 63.4Q62.5 62.4 65 64Q62.6 67.6 60 67.6Q57.4 67.6 55 64Z" fill="#c8325a"/><path d="M55.4 64.2Q60 65.2 64.6 64.2" stroke="#7a1a34" stroke-width=".6" fill="none"/>`,
  };
  const blush = `<ellipse cx="49.5" cy="59.5" rx="3.4" ry="2" fill="#ff6f8a" opacity=".16"/><ellipse cx="70.5" cy="59.5" rx="3.4" ry="2" fill="#ff6f8a" opacity=".16"/>`;
  return eye(52) + eye(68) + brows + nose + mouths[a.mouth] + blush;
}

function facialHair(a: ProducerAvatar): string {
  const c = a.hair.color;
  let out = '';
  if (a.extras.includes('beard'))
    out += `<path d="M39.5 54Q40 77 60 80Q80 77 80.5 54Q77 66 69 67.4Q60 69.4 51 67.4Q43 66 39.5 54Z" fill="${c}"/><path d="M53 61.6Q57 59.8 60 61.4Q63 59.8 67 61.6Q63.4 63.6 60 62.6Q56.6 63.6 53 61.6Z" fill="${c}"/>`;
  if (a.extras.includes('mustache')) out += `<path d="M52.6 61.6Q56.6 59.4 60 61.2Q63.4 59.4 67.4 61.6Q64 64 60 62.8Q56 64 52.6 61.6Z" fill="${shade(c, -0.15)}"/>`;
  if (a.extras.includes('goatee')) out += `<path d="M55.5 70Q60 76 64.5 70Q60 72.2 55.5 70Z" fill="${c}"/><path d="M55 61.8Q60 60.4 65 61.8" stroke="${c}" stroke-width="1.4" stroke-linecap="round" fill="none"/>`;
  return out;
}

/** Hair drawn OVER the forehead (the silhouette that makes each producer recognisable). */
function hairFront(a: ProducerAvatar): string {
  const c = a.hair.color;
  const sh = a.hair.shine ?? shade(c, 0.3);
  const shine = (d: string) => `<path d="${d}" stroke="${sh}" stroke-width="1.6" stroke-linecap="round" fill="none" opacity=".75"/>`;
  switch (a.hair.style) {
    case 'side':
      return `<path d="M38.5 50C36 31 48 23.5 62 24C77 24.5 85 35 82 50C80 43 75 38 66 36.5C58 35.4 49 38 42.5 46Z" fill="${c}"/><path d="M50 29Q47 34 46 40" stroke="${shade(c, -0.4)}" stroke-width="1" fill="none"/>${shine('M56 28Q66 26 74 31')}`;
    case 'waves_long':
      return `<path d="M38 50C35 32 46 22 61 22C76 22 86 32 82 50C78 40 72 34 62 33C56 38 48 40 41 48Z" fill="${c}"/>${shine('M48 30Q56 25 66 27M70 30Q76 33 78 39')}`;
    case 'afro':
      return `<path d="M40 44C42 32 50 27 60 27C70 27 78 32 80 44C74 38 66 36 60 36C54 36 46 38 40 44Z" fill="${c}"/>${shine('M48 22Q60 15 72 22')}`;
    case 'pomp':
      return `<path d="M38.5 48C34 30 46 13 66 15.5C84 18 89 36 82 48C79 39 72 33.5 61 33.5C51 33.5 45 38 41 45Z" fill="${c}"/>${shine('M52 20Q63 14 76 21M58 25Q66 22 73 26')}`;
    case 'bun':
      return `<circle cx="60" cy="21" r="8.5" fill="${c}"/><path d="M39 49C37 32 48 26 60 26C72 26 83 32 81 49C76 40 69 35 60 35C51 35 44 40 39 49Z" fill="${c}"/>${shine('M55 17Q60 14 65 17M50 31Q60 27 70 31')}`;
    case 'bald':
      return `<ellipse cx="55" cy="35" rx="8" ry="4" fill="#fff" opacity=".18"/>`;
    case 'bob':
      return `<path d="M37 50C35 31 47 25 60 25C73 25 85 31 83 50C80 46 76 44 72 44C66 44.5 64 42 60 42.5C56 42 54 44.5 48 44C44 44 40 46 37 50Z" fill="${c}"/>${shine('M47 31Q60 26 73 31')}`;
    case 'mohawk':
      return `<path d="M53.5 37C50 24 54 9 60 7C67 9 71 23 66.5 37C64 34 56 34 53.5 37Z" fill="${c}"/><path d="M55 30L50 22M58 22L55 12M62 22L64 11M65 30L70 21" stroke="${c}" stroke-width="3" stroke-linecap="round"/>${shine('M58 14Q60 10 62 14')}<path d="M41 46C42 38 46 34 50 33" stroke="${shade(c, -0.5)}" stroke-width="1.4" opacity=".35" fill="none"/><path d="M79 46C78 38 74 34 70 33" stroke="${shade(c, -0.5)}" stroke-width="1.4" opacity=".35" fill="none"/>`;
    case 'braids':
      return `<path d="M38.5 49C37 32 48 26 60 26C72 26 83 32 81.5 49C78 42 72 37 60 37C48 37 42 42 38.5 49Z" fill="${c}"/><path d="M60 26.5V37" stroke="${shade(c, -0.4)}" stroke-width="1.1"/>${shine('M48 31Q55 28 59 28.5M61 28.5Q66 28 72 31')}`;
    case 'swept':
      return `<path d="M39.5 48C38 32 49 24 61 24.5C74 25 84 33 80.5 48C78 41 73 36.5 66 35C60 32.5 52 33.5 46 38C43 41 41 44 39.5 48Z" fill="${c}"/><path d="M46 31Q56 27 70 29M48 35Q58 31 74 34" stroke="${shade(c, -0.25)}" stroke-width="1" fill="none"/>`;
    case 'pixie':
      return `<path d="M38.5 50C36 31 49 23 61 24C74 25 84 32 81.5 48L77 42L74 46L70 39L64 44L60 37L53 43L50 38L44 46Z" fill="${c}"/>${shine('M50 29Q60 25 72 30')}`;
    case 'fade':
      return `<path d="M40 46C40 33 49 27.5 60 27.5C71 27.5 80 33 80 46C77 39 70 35 60 35C50 35 43 39 40 46Z" fill="${c}"/><path d="M48 31.5Q60 28.5 72 31.5M46 35Q60 31.5 74 35" stroke="${shade(c, 0.25)}" stroke-width=".7" fill="none" opacity=".6"/>`;
    case 'ponytail':
      return `<path d="M39 50C37 32 48 25 61 25C74 25 84 32 81 49C78 41 71 36 61 35.5C52 35.5 45 40 39 50Z" fill="${c}"/><circle cx="77.5" cy="31.5" r="2.4" fill="#22f0e0"/>${shine('M50 30Q60 26 70 29')}`;
    case 'curls':
      return `<path d="M40 47C39 34 48 27 60 27C72 27 81 34 80 47C76 40 70 37 60 37C50 37 44 40 40 47Z" fill="${c}"/>${[
        [44, 33],
        [50, 28],
        [57, 25.5],
        [64, 25.5],
        [71, 28],
        [77, 33],
        [47, 39],
        [74, 39],
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="${c}"/><path d="M${x - 2} ${y - 1}q2-2.4 4 0" stroke="${sh}" stroke-width="1" fill="none" opacity=".7"/>`)
        .join('')}`;
  }
}

function accessories(a: ProducerAvatar, k: string): string {
  let out = '';
  const { rx } = FACE[a.face];
  for (const x of a.extras) {
    if (x === 'round_glasses') out += `<circle cx="52" cy="52" r="5.4" fill="#fff" fill-opacity=".14" stroke="#1a1428" stroke-width="1.6"/><circle cx="68" cy="52" r="5.4" fill="#fff" fill-opacity=".14" stroke="#1a1428" stroke-width="1.6"/><path d="M57.4 51.6Q60 50 62.6 51.6" stroke="#1a1428" stroke-width="1.4" fill="none"/>`;
    if (x === 'rect_glasses') out += `<rect x="46" y="48" width="12" height="8.4" rx="2.4" fill="#fff" fill-opacity=".14" stroke="#1a1428" stroke-width="1.6"/><rect x="62" y="48" width="12" height="8.4" rx="2.4" fill="#fff" fill-opacity=".14" stroke="#1a1428" stroke-width="1.6"/><path d="M58 51.4H62" stroke="#1a1428" stroke-width="1.4"/>`;
    if (x === 'aviators')
      out += `<defs><linearGradient id="av${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1d5e"/><stop offset="1" stop-color="#ff4fa0"/></linearGradient></defs><path d="M45.5 49H58Q58.5 57 52.4 57.6Q45.8 57.4 45.5 49Z" fill="url(#av${k})" stroke="#ffd23a" stroke-width="1.1"/><path d="M62 49H74.5Q74.2 57.4 67.6 57.6Q61.5 57 62 49Z" fill="url(#av${k})" stroke="#ffd23a" stroke-width="1.1"/><path d="M58 50.2H62" stroke="#ffd23a" stroke-width="1.1"/><path d="M47.5 50.6L50.5 50.6" stroke="#fff" stroke-width="1" opacity=".6"/>`;
    if (x === 'headset')
      out += `<path d="M${CX - rx - 1} 52C${CX - rx - 2} 21 ${CX + rx + 2} 21 ${CX + rx + 1} 52" stroke="#20202c" stroke-width="3.2" fill="none"/><ellipse cx="${CX - rx - 0.5}" cy="54" rx="4.4" ry="6.2" fill="#2a2a3a"/><ellipse cx="${CX - rx - 0.5}" cy="54" rx="2.2" ry="3.4" fill="${a.outfit.accent}"/><path d="M${CX - rx + 1} 58Q${CX - rx + 3} 66 52 66.5" stroke="#20202c" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="52.5" cy="66.5" r="2" fill="${a.outfit.accent}"/>`;
    if (x === 'hoops') out += `<circle cx="${CX - rx + 0.5}" cy="${CY + 9.5}" r="3.4" fill="none" stroke="#ffd23a" stroke-width="1.3"/><circle cx="${CX + rx - 0.5}" cy="${CY + 9.5}" r="3.4" fill="none" stroke="#ffd23a" stroke-width="1.3"/>`;
    if (x === 'studs') out += `<circle cx="${CX - rx + 0.5}" cy="${CY + 6.4}" r="1.4" fill="#22f0e0"/><circle cx="${CX + rx - 0.5}" cy="${CY + 6.4}" r="1.4" fill="#22f0e0"/>`;
  }
  return out;
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

/** The producer's badge: backdrop + portrait + frame, at `size` px (any size; vector). */
export function producerSVG(look: ProducerLook, size = 64, cls = ''): string {
  const a = avatarById(look.avatar) ?? PRODUCER_AVATARS[0];
  const k = 'p' + ++uid;
  const hex = look.frame === 'prime';
  const clip = hex ? `<path d="${HEX}"/>` : '<circle cx="60" cy="60" r="54"/>';
  return `<svg class="pr-ava ${cls}" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="${a.ru}">
    <defs><clipPath id="c${k}">${clip}</clipPath></defs>
    <g clip-path="url(#c${k})">${backdrop(look.backdrop, k)}<g transform="translate(60 63) scale(1.2) translate(-60 -60)">${hairBack(a)}${outfit(a)}${head(a, k)}${face(a)}${facialHair(a)}${hairFront(a)}${accessories(a, k)}</g></g>
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
