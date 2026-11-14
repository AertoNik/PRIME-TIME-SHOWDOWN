// Headless checks for Alpha 1.9.9 CARD EVOLUTION — the owner's card pictures and arena previews (npm run cardart):
//   * every card of a player's collection (33) has exactly one picture, named by its real id; the boss card has none;
//   * the game's WebP copies exist, have the one geometry of scripts/art/prepare_art.py and match its manifest, and the
//     manifest's originals are the owner's files byte for byte (nothing was swapped or edited);
//   * a picture card repeats nothing drawn on the picture (no second frame, name, gem or role tag) and keeps its layers
//     for the bought card styles, the signature gold and the battle states; the boss card is drawn as before;
//   * the six arena previews map to the right sets, HAUNTED / RANDOM keep their drawings, and a picture never opens a
//     set: HOLIDAY BROADCAST stays locked outside WINTER SHOWDOWN;
//   * the card itself did not change: ids, energy, prices, levels, families, combos (a snapshot of 1.9.8's values).
// The look itself (styles, phone sizes, the battle) is checked in the browser — docs/ALPHA_1_9_9_WORKLOG.md.
import { CARDS, NEW_CARDS, UNIVERSAL_CARDS } from '../src/config/cards';
import { ARENA_ORDER, arenaById } from '../src/config/arenas.config';
import type { CardId } from '../src/config/types';
import { arenaAvailable, availableArenas } from '../src/meta/ArenaSelection';
import { ARENA_ART, ARENA_PREVIEWS, arenaPreviewUrl } from '../src/ui/arenaArt';
import { CARD_ART, CARD_FRAME, CARD_PAD, cardArtUrl } from '../src/ui/cardArt';
import { cardHTML } from '../src/ui/dom';
import { crypto, fs, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;
const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') as string;

/** Width and height of a WebP file (VP8X, VP8 or VP8L header). */
function webpSize(p: string): [number, number] | null {
  const b = fs.readFileSync(p) as Uint8Array;
  const s = (o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));
  if (s(0, 4) !== 'RIFF' || s(8, 4) !== 'WEBP') return null;
  const kind = s(12, 4);
  const u24 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  if (kind === 'VP8X') return [u24(24) + 1, u24(27) + 1];
  if (kind === 'VP8 ') return [(b[26] | (b[27] << 8)) & 0x3fff, (b[28] | (b[29] << 8)) & 0x3fff];
  if (kind === 'VP8L') {
    const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1];
  }
  return null;
}

interface ManifestOut {
  file: string;
  w: number;
  h: number;
  bytes: number;
  sha256: string;
}
interface Manifest {
  card: { frameRatio: number; pad: Record<'l' | 't' | 'r' | 'b', number>; sizes: Record<string, number> };
  arena: { ratio: number; sizes: Record<string, number> };
  cards: Record<string, { src: string; sha256: string; out: Record<string, ManifestOut> }>;
  arenas: Record<string, { src: string; sha256: string; out: Record<string, ManifestOut> }>;
}
const manifest = JSON.parse(read('scripts/art/manifest.json')) as Manifest;

// ----------------------------------------------------------- 33 cards ↔ 33 pictures
const SIGNATURES = (Object.keys(CARDS) as CardId[]).filter((id) => CARDS[id].exclusive);
const collection = [...UNIVERSAL_CARDS, ...SIGNATURES, ...NEW_CARDS];
const withArt = Object.keys(CARD_ART) as CardId[];
check('the collection is 33 cards: 6 basic + 9 signature + 18 bought', collection.length === 33 && new Set(collection).size === 33 && UNIVERSAL_CARDS.length === 6 && SIGNATURES.length === 9 && NEW_CARDS.length === 18);
check(
  'every collection card has exactly one picture and nothing else has one (the boss card DIRECTOR\'S CUT is drawn)',
  withArt.length === 33 && collection.every((id) => CARD_ART[id]) && withArt.every((id) => collection.includes(id)) && !CARD_ART.directors_cut,
);
check('each picture is named by the card\'s real id (no card borrows another\'s picture)', withArt.every((id) => CARD_ART[id] === id) && new Set(Object.values(CARD_ART)).size === 33);
const originals = (fs.readdirSync('PRIME_TIME_1_9_9_CARDS') as string[]).filter((f) => f.toLowerCase().endsWith('.png'));
check('the owner\'s folder holds 33 PNGs, one per card id, no duplicate, nothing missing', originals.length === 33 && originals.every((f) => CARD_ART[f.slice(0, -4) as CardId] === f.slice(0, -4)));

// ----------------------------------------------------------- the copies and the manifest
const sizes = Object.entries(manifest.card.sizes);
let filesOk = true;
let geomOk = true;
let shaOk = true;
let weightOk = true;
for (const id of withArt) {
  const m = manifest.cards[id];
  if (!m || sha(m.src) !== m.sha256) shaOk = false;
  for (const [size, frameW] of sizes) {
    const o = m?.out[size];
    const p = `public/cards/${size}/${id}.webp`;
    if (!o || o.file !== `cards/${size}/${id}.webp` || !fs.existsSync(p) || sha(p) !== o.sha256) {
      filesOk = false;
      continue;
    }
    const wh = webpSize(p);
    const H = Math.round(frameW / manifest.card.frameRatio);
    const want = [Math.round(frameW * (1 + CARD_PAD.l + CARD_PAD.r)), Math.round(H * (1 + CARD_PAD.t + CARD_PAD.b))];
    if (!wh || wh[0] !== want[0] || wh[1] !== want[1]) geomOk = false;
    if (o.bytes > (size === 'sm' ? 60 : 110) * 1024) weightOk = false;
  }
}
check('every card has its sm and md WebP copy, byte-identical to the manifest', filesOk);
check('the manifest\'s originals are the owner\'s PNGs byte for byte (SHA-256)', shaOk);
check('one geometry for all 33: the frame box 0.70 and the gem room CARD_PAD (sm 255×375, md 425×624)', geomOk);
check('the geometry is the same in the script, the module and the CSS', manifest.card.frameRatio === CARD_FRAME.ratio && JSON.stringify(manifest.card.pad) === JSON.stringify(CARD_PAD));
check('light files for phones: a card ≤ 60 KB (sm) / ≤ 110 KB (md)', weightOk);
const total = Object.values(manifest.cards).reduce((a, c) => a + Object.values(c.out).reduce((x, o) => x + o.bytes, 0), 0);
check(`all card files together stay small (${Math.round(total / 1024)} KB ≤ 4 MB; the originals are ${Math.round((originals.length * 1.9) | 0)} MB)`, total <= 4 * 1024 * 1024);
check('no copy of an original PNG ships with the game (public/ holds WebP only)', !(fs.readdirSync('public/cards/sm') as string[]).some((f) => !f.endsWith('.webp')) && !(fs.readdirSync('public/cards/md') as string[]).some((f) => !f.endsWith('.webp')));

// ----------------------------------------------------------- the markup: the picture is the card
{
  const h = cardHTML('dash', 'hand-card', false, true);
  const sm = cardHTML('main_event', 'lg-mcard', false);
  check('a picture card shows the picture (the hand gets the md file, everything else sm, lazily)', h.includes('class="card pc') && h.includes(`src="${cardArtUrl('dash', 'md')}"`) && sm.includes(`src="${cardArtUrl('main_event', 'sm')}"`) && sm.includes('loading="lazy"') && !h.includes('loading="lazy"'));
  check('nothing drawn on the picture is repeated: no second gem, name, icon or role tag', !h.includes('class="gem"') && !h.includes('class="nm"') && !h.includes('class="ic"') && !cardHTML('dash').includes('class="tag"'));
  check('its layers are there: the glow/ring layer behind, the style layer over it, the name and energy for screen readers', h.indexOf('pc-sh') < h.indexOf('class="face"') && h.indexOf('class="face"') < h.indexOf('class="art"') && h.includes('<span class="vh">DASH · 2 ⚡</span>'));
  check('a signature card stays a signature card (gold: the class the styles and the gold glow use)', sm.includes('card pc exclusive') && cardHTML('twelfth_strike').includes('card pc exclusive') && !cardHTML('dash').includes('exclusive'));
  const boss = cardHTML('directors_cut', '', false);
  check('the boss card keeps its drawn card (icon, name, gem)', !boss.includes('class="card pc') && boss.includes('class="gem">5<') && boss.includes('class="ic"'));
}

// ----------------------------------------------------------- the CSS layers
{
  const css = read('src/styles/main.css');
  const block = css.slice(css.indexOf('1.9.9 CARD EVOLUTION — picture cards'));
  check('the drawn card\'s own background and rings stay off a picture card (also over the combo keyframes)', block.includes('background: none !important;') && block.includes('box-shadow: none !important;') && block.includes('aspect-ratio: 0.7;'));
  check('the picture overflows the frame box by CARD_PAD (gem room on the left and the top)', block.includes('left: -5.5%;') && block.includes('top: -8.5%;') && block.includes('width: 106.3%;') && block.includes('height: 109.3%;'));
  const styles = ['pumpkin', 'vhs', 'holo', 'ranked', 'clockwork'];
  check('every bought card style has its picture-card look (glow + layer over the art)', styles.every((s) => block.includes(`:root[data-card-style='${s}'] .card.pc {`) || block.includes(`:root[data-card-style='${s}'] .card.pc,`)) && styles.every((s) => block.includes(`:root[data-card-style='${s}'] .card.pc .art::before`)));
  check('the shop previews of the styles (.pumpkin-set, .vhs-set, .holo-set, .clockwork-set) wear them too', ['pumpkin', 'vhs', 'holo', 'clockwork'].every((s) => block.includes(`.${s}-set .card.pc`)));
  check('the style ornaments keep working and RANKED\'s chevron moves off the gem', block.includes(":root[data-card-style='ranked'] .card.pc::before") && block.includes('right: 8%;'));
  check('signature gold, focus, picked and combo-ready rings sit OUTSIDE the drawn frame (no double frame)', block.includes('.card.pc.exclusive {') && block.includes('.card.pc.focus {') && block.includes('.lg-cardpick.on .card.pc {') && block.includes('@keyframes pcComboGlow') && !/--pc-ring:[^;]*inset/.test(block));
  check('the energy curtain and the style layer leave the drawn gem uncovered', block.includes('.hand-card.pc .drain {') && (block.match(/mask: var\(--pc-gem-hole\)/g) ?? []).length >= 2);
  check('motion off / reduced motion: no pulse and no foil drift', block.includes(":root[data-motion='off'] .hand-card.pc.combo-ready") && block.includes(":root[data-motion='off'][data-card-style='holo'] .card.pc .art::before"));
  check('the hand keeps its height (box 0.70 → width × 0.70), the deck slot matches the frame', block.includes('calc(var(--app-h) * 0.18 * 0.7)') && css.includes('.deck-slots .slot {\n  position: relative;\n  /* 1.9.9: the picture cards\' frame (cardArt.ts CARD_FRAME) */\n  aspect-ratio: 0.7;'));
  check('the КОМБО marks stay the battle\'s own dynamic ones (not drawn on SHOWTIME or any picture)', read('src/ui/screens/BattleHUD.ts').includes('<div class="combo-ribbon">COMBO</div><div class="combo-link">КОМБО ▸</div>'));
}

// ----------------------------------------------------------- the battle and the prep screen load the right files
{
  const hud = read('src/ui/screens/BattleHUD.ts');
  const prep = read('src/ui/screens/PrepScreen.ts');
  check('the battle hand uses the md file and the deck is preloaded (battle start and prep screen)', hud.includes("cardHTML(c, 'hand-card enter', false, true)") && hud.includes("preloadCardArt(m.hands[0].deck, 'md')") && prep.includes("preloadCardArt(this.deck, 'md')"));
}

// ----------------------------------------------------------- the cards themselves did not change (1.9.8 values)
{
  const want: Record<string, [number, number?, number?]> = {
    dash: [2], power_shot: [4], shield: [3], smoke: [3], shock: [4], overdrive: [4],
    adrenaline: [4], knockout: [5], system_overload: [6], charged_shot: [5], bank_shot: [4], false_start: [3], bat_bite: [3], twelfth_strike: [3], main_event: [4],
    spotlight_tag: [2, 250, 2], split_shot: [3, 300, 2], rebound_disc: [3, 450, 3], prop_drop: [3, 650, 5], pulse_push: [2, 250, 2], gravity_net: [2, 400, 3],
    pressure_mine: [2, 300, 2], stage_barrier: [2, 500, 3], cable_snare: [2, 600, 5], holo_decoy: [2, 450, 3], frame_catch: [2, 250, 2], backtrack: [2, 400, 3],
    high_stakes: [1, 750, 5], second_take: [3, 650, 5], freeze_frame: [2, 650, 5], showtime: [2, 300, 3], magnet_pull: [3, 400, 4], safe_cut: [2, 350, 3],
  };
  const bad = Object.entries(want).filter(([id, [cost, price, level]]) => {
    const c = CARDS[id as CardId];
    return !c || c.id !== id || c.cost !== cost || (price !== undefined && (c.shop?.price !== price || c.shop?.level !== level)) || (price === undefined && !!c.shop);
  });
  check(`ids, energy, career prices and levels are 1.9.8's (${bad.length ? 'changed: ' + bad.map((b) => b[0]).join(', ') : 'all 33 unchanged'})`, bad.length === 0);
}

// ----------------------------------------------------------- arena previews
{
  const want: Record<string, string> = { original: 'original_prime_arena.png', casino: 'luxury_casino_set.png', backlot: 'prime_movie_backlot.png', graveyard: 'cursed_cemetery_set.png', holiday: 'new_year_studio_set.png', newsroom: 'neon_newsroom.png' };
  const mapped = Object.entries(want).every(([id, png]) => manifest.arenas[id]?.src === `PRIME_TIME_1_9_9_ARENA_PREVIEWS/${png}` && ARENA_PREVIEWS[id as keyof typeof ARENA_PREVIEWS] === id);
  check('the six previews map to their real sets (original, casino, backlot, graveyard, holiday, newsroom)', mapped && Object.keys(ARENA_PREVIEWS).length === 6 && Object.keys(manifest.arenas).length === 6);
  let ok = true;
  for (const id of Object.keys(want)) {
    const m = manifest.arenas[id];
    const p = `public/arenas/sm/${id}.webp`;
    const wh = fs.existsSync(p) ? webpSize(p) : null;
    if (!m || sha(m.src) !== m.sha256 || !wh || wh[0] !== 480 || wh[1] !== 264 || sha(p) !== m.out.sm.sha256 || m.out.sm.bytes > 80 * 1024) ok = false;
  }
  check('each preview: one 480×264 WebP (1.815, like every preview box), the owner\'s original untouched, ≤ 80 KB', ok && !fs.existsSync('public/arenas/md'));
  check('the six use the picture; HAUNTED PRIME SET and RANDOM keep their drawings', Object.keys(want).every((id) => ARENA_ART[id as keyof typeof ARENA_ART].startsWith('<img class="arena-img"') && ARENA_ART[id as keyof typeof ARENA_ART].includes(arenaPreviewUrl(id as keyof typeof ARENA_ART)!)) && ARENA_ART.haunted.startsWith('<svg') && ARENA_ART.random.startsWith('<svg') && ARENA_ORDER.length === 7);
  const hol = arenaById('holiday');
  check(
    'a preview never opens a set: HOLIDAY BROADCAST stays locked outside WINTER SHOWDOWN (default / Halloween), open in it',
    !arenaAvailable(hol, 'default') && !arenaAvailable(hol, 'halloween') && arenaAvailable(hol, 'winter') && !availableArenas('default').includes('holiday') && availableArenas('winter').includes('holiday'),
  );
  check('the arena picker still asks availability (not the picture) before offering a set', read('src/ui/screens/PrepScreen.ts').includes('const open = !def || arenaAvailable(def, season);'));
  const css = read('src/styles/main.css');
  check('one box for every preview: ratio 1.815 and one corner, the picture never stretched (contain)', css.includes('.lg-pa-art {\n  aspect-ratio: 1.815;\n  border-radius: 13.5% / 24.5%;') && css.includes('object-fit: contain;'));
}

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\ncardart: FAILED (${failed} of ${checks.length})` : `\ncardart: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
