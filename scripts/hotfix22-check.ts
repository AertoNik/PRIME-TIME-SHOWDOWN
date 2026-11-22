// Headless checks for the Beta 2.2 MINI HOTFIX — collection, achievements and reward previews (npm run hotfix22):
//   * PRIME LEGEND: «Победитель легенды» (boss-vale) wears the owner's PRIME LEGEND achievement picture
//     (achievement_prime_legend.png), the title PRIME LEGEND its own title_prime_legend.png — two entities, two pictures;
//     LEGENDARY PRODUCTION (career) is neither: it keeps its stage emblem;
//   * PRIME TIME STAR: an achievement's own picture comes before the stage emblem in MY COLLECTION (the cause: a career
//     stage always drew its emblem), and the title PRIME TIME STAR wears the same approved picture, not the 1.x star;
//   * every broadcast frame and card style shows its REAL look (the game's own rules through preview aliases, as PRIME
//     SHOP): the style maps cover every frame / card style ThemeManager knows, every in-game rule of the four styles the
//     shop never sold has its alias, the collection's tiles and big view, «Сейчас в эфире» and the event's reveal use it;
//   * nothing else changed: no new picture file, the earlier pictures and the shop's own previews as before.
import { COSMETICS, type CosmeticId } from '../src/config/cosmetics.config';
import { cosmeticPic, TITLE_ART, TITLE_PIC_ALIAS, titlePic } from '../src/ui/effectArt';
import { achievementArtId } from '../src/ui/rewardArt';
import { CARD_STYLE, cosmeticDemo, FRAME_STYLE } from '../src/ui/styleDemo';
import { fs, path, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;
const srcOf = (html: string) => /src="([^"]+)"/.exec(html)?.[1] ?? '';
const manifest = JSON.parse(read('scripts/art/manifest.json')) as { icons: Record<string, Record<string, { src: string; out: Record<string, { file: string }> }>> };
const css = read('src/styles/main.css');
const exact = (sel: string) => new RegExp(`(^|,)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(,|\\{)`, 'm').test(css);

// ------------------------------------------------------------- 1. PRIME LEGEND
check('«Победитель легенды» wears achievement_prime_legend.png (id prime_legend); the 2.2 id career_legendary is gone (same bytes, renamed)', achievementArtId({ id: 'boss-vale' }) === 'prime_legend' && manifest.icons.achievements.prime_legend?.src === 'PRIME_TIME_2_2_ART_ASSETS/achievement_prime_legend.png' && !('career_legendary' in manifest.icons.achievements) && Object.values(manifest.icons.achievements.prime_legend.out).every((o) => fs.existsSync(`public/${o.file}`) && o.file.endsWith('/prime_legend.webp')));
check('the title PRIME LEGEND keeps title_prime_legend.png everywhere it is drawn (tile, big view, slots, BOSS FIGHT screens)', srcOf(cosmeticPic('title_prime_legend', 220)).endsWith('ui/titles/md/title_prime_legend.webp') && srcOf(titlePic('title_prime_legend', 22) ?? '').endsWith('ui/titles/xs/title_prime_legend.webp') && COSMETICS.title_prime_legend.source === 'boss');
check('LEGENDARY PRODUCTION is not PRIME LEGEND: its achievement keeps the stage emblem, its frame shows the real frame', achievementArtId({ id: 'career-legendary' }) === null && cosmeticPic('frame_legendary', 132).includes('fd-screen legendary'));
const cs = read('src/ui/screens/CollectionScreen.ts');
check('the achievement card shows its reward title\'s own picture beside «Награда: PRIME LEGEND» (only titles with a picture of their own)', /TITLE_ART\[a\.reward\] \? titlePic\(a\.reward, 20, 'cc-reward-pic'\)/.test(cs) && !!TITLE_ART.title_prime_legend && !TITLE_ART.title_prime_star);

// ------------------------------------------------------------- 2. PRIME TIME STAR
check('the cause: MY COLLECTION drew a career stage\'s emblem even when the achievement had its picture — the own picture now comes first', /const own = achievementArt\(a, 64\);\s*const art = own\s*\? own\s*: stage && CAREER_STAGES\.some/.test(cs));
check('the career stage PRIME TIME STAR wears achievement_prime_time_star.png (RISING: its stage emblem until Beta 2.3, now achievement_career_rising_broadcast)', achievementArtId({ id: 'career-star' }) === 'career_star' && achievementArtId({ id: 'career-rising' }) === 'career_rising' && manifest.icons.achievements.career_star.src === 'PRIME_TIME_2_2_ART_ASSETS/achievement_prime_time_star.png');
check('the title PRIME TIME STAR wears the same approved picture in the tile and the big view (not the 1.x star); the two entities stay apart', srcOf(cosmeticPic('title_prime_star', 132)).endsWith('ui/achievements/md/career_star.webp') && srcOf(cosmeticPic('title_prime_star', 56)).endsWith('ui/achievements/sm/career_star.webp') && JSON.stringify(TITLE_PIC_ALIAS) === JSON.stringify({ title_prime_star: ['achievements', 'career_star'] }) && COSMETICS.title_prime_star.source === 'career');

// ------------------------------------------------------------- 3. real previews of frames and card styles
const all = Object.values(COSMETICS);
const frames = all.filter((c) => c.slot === 'broadcastFrame').map((c) => c.id);
const cardStyles = all.filter((c) => c.slot === 'cardStyle').map((c) => c.id);
check(`every broadcast frame (${frames.length}) and card style (${cardStyles.length}) of the game has its style key`, frames.every((id) => !!FRAME_STYLE[id]) && cardStyles.every((id) => !!CARD_STYLE[id]));
const tm = read('src/game/ThemeManager.ts');
check('the keys are the very names ThemeManager sets on <html> (data-frame / data-card-style)', frames.every((id) => tm.includes(`equipped.broadcastFrame === '${id}') root.dataset.frame = '${FRAME_STYLE[id]}'`)) && cardStyles.every((id) => tm.includes(`card === '${id}') root.dataset.cardStyle = '${CARD_STYLE[id]}'`)));
const frameKeys = [...new Set(Object.values(FRAME_STYLE))] as string[];
const cardKeys = [...new Set(Object.values(CARD_STYLE))] as string[];
check('every frame shows on the preview screen (.fd-screen.<key> .fd-frame shares the in-game rule) and every card style on real cards (.<key>-set .card)', frameKeys.every((k) => exact(`.fd-screen.${k} .fd-frame`)) && cardKeys.every((k) => exact(`.${k}-set .card`) || exact(`.${k}-set .card.pc`)));
const missing: string[] = [];
for (const raw of new Set((css.match(/:root\[data-frame='(?:legendary|daily|ranked)'\][^,{]*|:root\[data-card-style='ranked'\][^,{]*/g) ?? []).map((x) => x.trim()))) {
  const f = /^:root\[data-frame='(\w+)'\]\s+(.*)$/.exec(raw);
  let alias: string | null = null;
  if (f) {
    const [, k, rest] = f;
    if (rest.startsWith('.bc-frame')) alias = `.fd-screen.${k} ${rest.replace('.bc-frame', '.fd-frame')}`;
    else if (rest.startsWith('.timer-box .live')) alias = `.fd-screen.${k} .fd-live${rest.slice(16)}`;
    else if (rest.startsWith('.timer-box')) alias = `.fd-screen.${k} .fd-timer${rest.slice(10)}`;
  } else alias = `.ranked-set ${raw.replace(/^:root\[data-card-style='ranked'\]\s+/, '')}`;
  if (alias && !exact(alias)) missing.push(alias);
}
check(`LEGENDARY PRODUCTION, ЭФИР БЕЗ ПЕРЕРЫВА, RANKED ARENA, RANKED CARDS: every in-game rule has its preview alias (the same declarations)${missing.length ? ' — missing ' + missing.join(' | ') : ''}`, missing.length === 0);
check('a frame previews as the game\'s HUD screen, a card style as two real cards; under 100 px without the HUD bar (an exchange card), under 64 px the frame alone', (frames as CosmeticId[]).every((id) => (cosmeticDemo(id, 132) ?? '').includes(`fd-screen ${FRAME_STYLE[id]}`)) && (cardStyles as CosmeticId[]).every((id) => (cosmeticDemo(id, 132) ?? '').includes(`art-cards ${CARD_STYLE[id]}-set`) && (cosmeticDemo(id, 132) ?? '').includes('data-card="dash"')) && (cosmeticDemo('frame_league_arena', 56) ?? '').includes('cos-demo frame tiny') && (cosmeticDemo('frame_frostlight_live', 72) ?? '').includes('cos-demo frame small') && /\.cos-demo\.small \.fd-top,\s*\.cos-demo\.small \.fd-hand \{\s*display: none;/.test(css) && !(cosmeticDemo('frame_frostlight_live', 132) ?? '').includes('small') && cosmeticDemo('title_prime_star', 56) === null);
check('RANKED ARENA / RANKED CARDS (the owner\'s report) are no longer the 1.x icons in MY COLLECTION', cosmeticPic('frame_league_arena', 132).includes('fd-screen ranked') && cosmeticPic('card_league_ranked', 132).includes('ranked-set') && !cosmeticPic('frame_league_arena', 132).includes('<svg'));
check('MY COLLECTION\'s tiles and big view use the real preview first — bought or earned alike (the shop catalog art only for other items)', /const demo = cosmeticDemo\(c\.id, size\);\s*if \(demo\) return `<span class="cl-shopart">\$\{demo\}<\/span>`;/.test(cs) && /cl-item-art">\$\{this\.art\(e, 220\)\}/.test(cs));
check('the event\'s exchange and reveal use the same real previews (cosmeticPic)', /function rewardPic\(c: CosmeticDef, size: number\): string \{\s*return `<span class="er-demo">\$\{cosmeticPic\(c\.id, size\)\}<\/span>`;/.test(read('src/ui/screens/EventsScreen.ts')));
const shop = read('src/ui/screens/ShopScreen.ts');
check('PRIME SHOP\'s own previews are unchanged (catalog art, frame and cards demonstrations)', /private frameDemo\(it: ShopItemDef\)/.test(shop) && /private cardsDemo\(it: ShopItemDef\)/.test(shop) && /if \(it\.preview === 'frame'\) return ART\.frame\(\(c && FRAME_STYLE\[c\]\) \|\| 'prime'\);/.test(read('src/ui/shopArt.ts')));
check('the big view\'s buttons wrap on a narrow phone («PRIME LEAGUE · ОБМЕН PRIME TOKENS» was cut at both edges)', /\.cl-item \.btn\.wide \{\s*white-space: normal;/.test(css));

// ------------------------------------------------------------- 4. resources
const webp: string[] = [];
const walk = (d: string) => {
  for (const f of fs.readdirSync(d) as string[]) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.webp')) webp.push(p);
  }
};
walk('public/ui');
const listed = Object.values(manifest.icons).flatMap((g) => Object.values(g).flatMap((e) => Object.values(e.out).map((o) => `public/${o.file}`)));
check(`every picture listed: ${webp.length} WebP in public/ui = the manifest's (Beta 2.2's 251 + Beta 2.3's 44 — npm run art24 checks the 251 are byte-for-byte the same — + Beta 2.4's 2 of INVITE SIGNAL + Beta 2.6's 3 of DAILY MISSIONS), each one exists`, webp.length === 300 && listed.length === 300 && listed.every((p) => fs.existsSync(p)) && ['public/ui/effects/sm/dash_invite_signal.webp', 'public/ui/effects/md/dash_invite_signal.webp'].every((p) => listed.includes(p)));

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\nhotfix22: FAILED (${failed} of ${checks.length})` : `\nhotfix22: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
