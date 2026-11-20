// Headless checks for Beta 2.2 FINAL — the owner's last batch PRIME_TIME_2_3_WINTER_COLLECTION_ART (npm run art23):
//   * all 14 originals are mapped, each once, to an EXISTING game id (a picture earns or changes nothing), byte for
//     byte as the owner left them (SHA-256), every WebP copy exists with its group's size and the manifest's SHA;
//   * nothing earlier changed: the 104 earlier icon entries (Beta 2.0 + 2.2) keep their exact fingerprint — the earlier
//     career emblem `rewards/career` and the mode icon «Карьера» too;
//   * where each one shows, each with a fallback: CANDY CANES everywhere the season's currency is drawn (never PRIME
//     TOKENS), six winter quests (the three without a picture keep their icon), the titles PRIME LEGEND and WINTER
//     CHAMPION, the MASTERY pictures, MY COLLECTION's «Купленное», the reward category «Карьера продюсера», the winter
//     dress of the DAILY gift (only in winter); CLOCKWORK GOLD / FROSTLIGHT LIVE show the game's real demonstration;
//   * WINTER SHOWDOWN's calendar, quests, earnings and prices are exactly as before; «Золотой рейтинг» keeps its
//     picture (no new guess); the menu's DAILY hint no longer lies under «Пригласить друга».
import { COSMETICS } from '../src/config/cosmetics.config';
import { EVENTS } from '../src/config/events.config';
import { SKU_OF_COSMETIC } from '../src/config/shop.config';
import { ICON_SIZES, fallbackHTML } from '../src/ui/artIcons';
import { currencyArt } from '../src/ui/currencyArt';
import { cosmeticPic, EFFECT_ART, TITLE_ART, titlePic } from '../src/ui/effectArt';
import { ICONS } from '../src/ui/eventArt';
import { achievementArtId, CAREER_GOAL_ART, rewardSectionArt, sectionArt, winterGiftArt } from '../src/ui/rewardArt';
import { CARD_STYLE, FRAME_STYLE } from '../src/ui/shopArt';
import { achievementArtId as achId } from '../src/ui/rewardArt';
import { currencyIcon, QUEST_ART, questIcon } from '../src/ui/screens/EventsScreen';
import { crypto, fs, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;
const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') as string;
const srcOf = (html: string) => /src="([^"]+)"/.exec(html)?.[1] ?? '';

interface Out {
  file: string;
  w: number;
  h: number;
  sha256: string;
}
interface Entry {
  src: string;
  sha256: string;
  size: number[];
  out: Record<string, Out>;
}
const manifest = JSON.parse(read('scripts/art/manifest.json')) as { icon: { sizes: unknown }; icons: Record<string, Record<string, Entry>> };
const DIR = 'PRIME_TIME_2_3_WINTER_COLLECTION_ART';
/** WINTER SHOWDOWN's rules as released (events.config.ts byte-identical to the published Beta 2.1 when this was pinned). */
const RULES_SHA = '98f660d6231aeae0';

// ------------------------------------------------------------- the mapping (file → group / id)
const MAP: [string, string, string][] = [
  ['achievement_combo_show.png', 'achievements', 'mastery_combo'],
  ['achievement_five_champion_broadcasts.png', 'achievements', 'mastery_champion'],
  ['collection_purchased_v3.png', 'sections', 'shop'],
  ['reward_career_emblem_v3.png', 'rewards', 'career_producer'],
  ['title_prime_legend.png', 'titles', 'title_prime_legend'],
  ['winter_champion_title.png', 'titles', 'title_winter_champion'],
  ['WINTER_EVENT_CANDY_CANE_TOKEN.png', 'currency', 'candy_canes'],
  ['WINTER_GOAL_IDEAL_DEFENSE.png', 'winter', 'quest_frost_guard'],
  ['WINTER_GOAL_MIDNIGHT_RATING.png', 'winter', 'quest_midnight_rating'],
  ['WINTER_GOAL_HOLIDAY_BROADCAST.png', 'winter', 'quest_holiday_broadcast'],
  ['WINTER_GOAL_CHAMPIONS_EVE.png', 'winter', 'quest_champions_eve'],
  ['WINTER_GOAL_LEAGUE_SNOWFALL.png', 'winter', 'quest_league_snowfall'],
  ['WINTER_GOAL_CANDY_CANE_COLLECTOR.png', 'winter', 'quest_cane_collector'],
  ['WINTER_DAILY_REWARD_GIFT.png', 'winter', 'daily_gift'],
];

// ------------------------------------------------------------- originals and copies
const originals = (fs.readdirSync(DIR) as string[]).filter((f) => f.toLowerCase().endsWith('.png'));
const all: [string, string, Entry][] = Object.entries(manifest.icons).flatMap(([g, ids]) => Object.entries(ids).map(([i, e]) => [g, i, e] as [string, string, Entry]));
const mine = all.filter(([, , e]) => e.src.startsWith(`${DIR}/`));
check(`14 originals in ${DIR}, found ${originals.length}`, originals.length === 14);
check('every original is mapped exactly once, to the id the report names', mine.length === 14 && MAP.every(([f, g, id]) => manifest.icons[g]?.[id]?.src === `${DIR}/${f}`) && originals.every((f) => MAP.some(([m]) => m === f)));
check('the owner\'s originals are untouched (SHA-256 of each PNG = the manifest)', mine.every(([, , e]) => fs.existsSync(e.src) && sha(e.src) === e.sha256));
let copies = true;
for (const [g, , e] of mine) {
  const sizes = ICON_SIZES[g as keyof typeof ICON_SIZES] as Record<string, number> | undefined;
  if (!sizes || Object.keys(e.out).join() !== Object.keys(sizes).join()) copies = false;
  for (const [k, o] of Object.entries(e.out)) {
    const p = `public/${o.file}`;
    if (!fs.existsSync(p) || sha(p) !== o.sha256 || o.w !== sizes?.[k] || o.h !== sizes?.[k] || !p.endsWith('.webp')) copies = false;
  }
}
check('every WebP copy exists in public/ui with its group\'s size (artIcons.ts = prepare_art.py, the new group «winter») and the manifest\'s SHA', copies && JSON.stringify(manifest.icon.sizes) === JSON.stringify(ICON_SIZES));

// ------------------------------------------------------------- nothing earlier changed
// (Beta 2.3's PRIME_TIME_2_3_UI_MODE_ART_REFINED is checked by npm run art24 — it adds, never replaces)
// (Beta 2.4 adds exactly one later entry, INVITE SIGNAL's preview — checked by npm run art22 / rewards24)
const older = all.filter(([, , e]) => !e.src.startsWith(`${DIR}/`) && !e.src.startsWith('PRIME_TIME_2_3_UI_MODE_ART_REFINED/') && e.src !== 'PRIME_TIME_2_2_ART_ASSETS/dash_invite_signal.png');
const groups = [...new Set(older.map(([g]) => g))].sort();
// (Beta 2.2 mini hotfix: the 2.2 id career_legendary is now prime_legend — same picture, same bytes; read under its old id)
const canonId = (i: string) => (i === 'prime_legend' ? 'career_legendary' : i);
const canon = JSON.stringify(groups.map((g) => [g, older.filter(([gg]) => gg === g).map(([, i, e]) => [canonId(i), e.src, e.sha256, Object.keys(e.out).sort().map((k) => [k, e.out[k].sha256])] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1))]));
check(`the 104 earlier icon entries (Beta 2.0 + 2.2) are exactly as before (fingerprint 473a3358…; ${older.length} entries)`, older.length === 104 && crypto.createHash('sha256').update(canon).digest('hex') === '473a3358e7ca5ea9f1705ed8c7c19a693b955bc8bebf5837d5c0865340590802');
check('the earlier career emblem and the mode button «Карьера» keep their own pictures (the v3 emblem is a separate id)', manifest.icons.rewards.career?.src.startsWith('PRIME_TIME_2_0_EFFECT_PREVIEWS/') && !manifest.icons.modes.career?.src.startsWith(`${DIR}/`) && fs.existsSync('public/ui/rewards/sm/career.webp'));

// ------------------------------------------------------------- CANDY CANES
const winter = EVENTS.find((e) => e.id === 'winter-2026')!;
const halloween = EVENTS.find((e) => e.themeId !== 'winter' && e.currency);
check('WINTER SHOWDOWN\'s currency icon is the cane picture (fills its box; fallback: the 1.9.7 cane drawing)', srcOf(currencyIcon(winter)).endsWith('ui/currency/sm/candy_canes.webp') && currencyIcon(winter).includes('cur-fill') && fallbackHTML('cur|candy_canes|36') === ICONS.cane);
check('CANDY CANES are not PRIME TOKENS: the league coin is still `tokens`, another event keeps its own icon', srcOf(currencyArt('tokens', 24)).endsWith('ui/currency/xs/tokens.webp') && (!halloween || !currencyIcon(halloween).includes('candy_canes')) && !read('src/ui/screens/LeagueScreen.ts').includes('candy_canes'));
const curUsers = ['MenuScreen', 'EventsScreen', 'ResultsScreen', 'SurvivalScreen', 'CareerScreen', 'RosterScreen'].filter((s) => /currencyIcon\(/.test(read(`src/ui/screens/${s}.ts`)));
check('every screen that draws the season\'s currency goes through currencyIcon (menu, events, results, marathon, career, roster) — no cane drawing left', curUsers.length === 6 && !/ICONS\.cane\b/.test(read('src/ui/screens/EventsScreen.ts').replace(/fallback[^\n]*/g, '')) && ['MenuScreen', 'ResultsScreen', 'SurvivalScreen', 'CareerScreen', 'RosterScreen'].every((s) => !read(`src/ui/screens/${s}.ts`).includes('ICONS.cane')));
const evSrc = read('src/ui/screens/EventsScreen.ts');
check('the «+N КАРАМЕЛЬНЫЕ ТРОСТИ» notes carry the cane too (UI.toast icon)', (evSrc.match(/toast\([^\n]*currency\?\.name[^\n]*currencyIcon\(/g) ?? []).length === 2 && /toast\(text: string, gold = false, icon = ''\)/.test(read('src/ui/UI.ts')));

// ------------------------------------------------------------- quests
const qIds = winter.quests.map((q) => q.id);
const withArt = Object.keys(QUEST_ART);
check('all nine winter quests wear their picture (Beta 2.2 final: frost_guard … cane_collector; Beta 2.3: first_snow, holiday_hat_trick, garland_combo)', withArt.join() === 'first_snow,holiday_hat_trick,garland_combo,frost_guard,midnight_rating,holiday_broadcast,champions_eve,league_snowfall,cane_collector' && qIds.every((id) => withArt.includes(id)) && withArt.every((id) => qIds.includes(id) && srcOf(questIcon(id, 'snow')).endsWith(`ui/winter/sm/quest_${id}.webp`)));
check('Beta 2.3: FIRST SNOW ON AIR, HOLIDAY WINS, GARLAND COMBO wear theirs too, each falling back to its quest\'s own icon; a failed picture falls back to the quest\'s icon', ['first_snow', 'holiday_hat_trick', 'garland_combo'].every((id) => { const q = winter.quests.find((x) => x.id === id)!; const h = questIcon(id, q.icon); return srcOf(h).endsWith(`ui/winter/sm/quest_${id}.webp`) && h.includes(`data-fb="qi|${q.icon}"`); }) && fallbackHTML('qi|snow') === ICONS.snow && fallbackHTML('qi|crown') === ICONS.crown);

// ------------------------------------------------------------- titles, achievements, sections, the gift
check('titles: PRIME LEGEND (BOSS FIGHT) and WINTER CHAMPION (the grand prize) wear their pictures wherever a cosmetic is drawn; a failed one shows its drawing', srcOf(cosmeticPic('title_prime_legend', 132)).endsWith('ui/titles/md/title_prime_legend.webp') && srcOf(cosmeticPic('title_winter_champion', 58)).endsWith('ui/titles/sm/title_winter_champion.webp') && srcOf(titlePic('title_prime_legend', 22) ?? '').endsWith('ui/titles/xs/title_prime_legend.webp') && titlePic('title_halloween_champion', 22) === null && !!TITLE_ART.title_prime_legend && !!TITLE_ART.title_winter_champion && fallbackHTML('fx|title_prime_legend').includes('<svg'));
check('PRIME LEGEND: the title wears title_prime_legend.png, the achievement «Победитель легенды» achievement_prime_legend.png (mini hotfix) — two entities, two pictures; LEGENDARY PRODUCTION has neither', manifest.icons.titles.title_prime_legend.src.endsWith('/title_prime_legend.png') && manifest.icons.achievements.prime_legend.src.endsWith('/achievement_prime_legend.png') && achId({ id: 'boss-vale' }) === 'prime_legend' && achId({ id: 'career-legendary' }) === null && COSMETICS.title_prime_legend.name === 'PRIME LEGEND');
check('BOSS FIGHT shows the title\'s picture on the first-win line (results) and in the boss\'s facts (preparation)', /titlePic\(fw\.cosmetic, 30, 'ch-title'\) \?\? UI_ICONS\.star/.test(read('src/ui/screens/ResultsScreen.ts')) && /titlePic\(fw\.cosmetic, 22, 'mf-title-art'\)/.test(read('src/ui/screens/PrepScreen.ts')));
check('MASTERY: «Комбо-шоу» and «Пять чемпионских эфиров» wear their pictures; Beta 2.3: «Полный состав» / «Идеальный эфир» too', achievementArtId({ id: 'mastery-combo' }) === 'mastery_combo' && achievementArtId({ id: 'mastery-champion' }) === 'mastery_champion' && achievementArtId({ id: 'mastery-roster' }) === 'mastery_roster' && achievementArtId({ id: 'mastery-rating' }) === 'mastery_rating');
check('MY COLLECTION «Купленное» wears collection_purchased_v3 (fallback: the bag icon)', srcOf(sectionArt('shop', 44)).endsWith('ui/sections/sm/shop.webp') && /sec\('shop', 'Купленное'[^\n]*sectionArt\('shop', 44\)/.test(read('src/ui/screens/CollectionScreen.ts')) && /registerSectionFallback\('shop'/.test(read('src/ui/screens/CollectionScreen.ts')));
check('the reward category «Карьера продюсера» wears reward_career_emblem_v3; BOSS FIGHT / DAILY / «Награды» keep theirs', srcOf(rewardSectionArt('career', 40)).endsWith('ui/rewards/sm/career_producer.webp') && (['collection', 'boss', 'daily'] as const).every((id) => srcOf(rewardSectionArt(id, 40)).endsWith(`ui/rewards/sm/${id}.webp`)));
check('the DAILY gift wears its winter dress only in winter (menu button, «today», the reveal) — otherwise the usual gift', winterGiftArt({ events: { themeId: 'default' } }, 34) === null && winterGiftArt({ events: { themeId: 'halloween' } }, 34) === null && srcOf(winterGiftArt({ events: { themeId: 'winter' } }, 34) ?? '').endsWith('ui/winter/sm/daily_gift.webp') && /winterGiftArt\(g, 46\) \?\? uiIcon\('gift', 46\)/.test(read('src/ui/screens/MenuScreen.ts')) /* Beta 2.3: the usual gift is the owner's picture */ && (read('src/ui/dailyUI.ts').match(/winterGiftArt\(g, /g) ?? []).length === 2);

// ------------------------------------------------------------- CLOCKWORK GOLD / FROSTLIGHT LIVE: the game's own demonstration
check('CLOCKWORK GOLD and FROSTLIGHT LIVE show the game\'s real card / frame demonstration in the exchange and the reveal — no PNG stand-in', CARD_STYLE.card_clockwork_gold === 'clockwork' && FRAME_STYLE.frame_frostlight_live === 'frostlight' && !!SKU_OF_COSMETIC.card_clockwork_gold && !!SKU_OF_COSMETIC.frame_frostlight_live && /er-art">\$\{rewardPic\(c, 72\)\}/.test(evSrc) && /rp-art">\$\{rewardPic\(c, 112\)\}/.test(evSrc) && cosmeticPic('card_clockwork_gold', 72).includes('art-cards clockwork-set') && cosmeticPic('frame_frostlight_live', 112).includes('fd-screen frostlight') && !all.some(([, i]) => i === 'card_clockwork_gold' || i === 'frame_frostlight_live'));
check('CANDY COMET and MIDNIGHT CONFETTI keep their Beta 2.0 previews (not overwritten)', !!EFFECT_ART.dash_candy_comet && !!EFFECT_ART.victory_midnight_confetti && manifest.icons.effects.dash_candy_comet.src.endsWith('/candy_comet.png') && manifest.icons.effects.victory_midnight_confetti.src.endsWith('/midnight_confetti.png'));

// ------------------------------------------------------------- the season's rules are untouched
// (Beta 2.5.5 added ONE thing to the earnings: past the day's threshold a fight still pays overRate = ⅒ of its canes,
// career and league — the 1.9.7 values are hashed without it, the new field is pinned on its own)
const { overRate: winterOver, league: winterLeague, ...earnings197 } = winter.earnings!;
const { overRate: leagueOver, ...league197 } = winterLeague!;
const rules = JSON.stringify([winter.start, winter.end, winter.announceDays, winter.currency, { ...earnings197, league: league197 }, winter.quests.map((q) => [q.id, q.metric, q.target, q.reward]), winter.shop, winter.fighters, winter.grandPrize]);
check('WINTER SHOWDOWN\'s calendar, 9 quests, earnings and exchange prices are exactly as released in 1.9.7 — plus Beta 2.5.5\'s soft threshold (⅒ past the day\'s 45 / 30, career and league)', crypto.createHash('sha256').update(rules).digest('hex').slice(0, 16) === RULES_SHA && winter.quests.length === 9 && winterOver === 0.1 && leagueOver === 0.1);
check('«Золотой рейтинг» keeps its Beta 2.2 picture — no new guess without the owner\'s confirmation', CAREER_GOAL_ART.rating_70 === 'golden_rating' && manifest.icons.goals.golden_rating.src.normalize('NFC') === 'PRIME_TIME_2_2_ART_ASSETS/Золотая звезда стремительного роста.png'.normalize('NFC'));

// ------------------------------------------------------------- the menu: the DAILY hint and «Пригласить друга»
const css = read('src/styles/main.css');
const ms = read('src/ui/screens/MenuScreen.ts');
check('while the first DAILY hint hangs under the gift, «Пригласить друга» steps below it (the hint is inserted right after the gift, before the button)', /\.menu > \.daily-hint ~ \.ref-btn \{\s*top: calc\(var\(--safe-top\) \+ 196px\);/.test(css) && ms.indexOf('class="daily-btn"') < ms.indexOf('class="ref-btn"') && /btn\.insertAdjacentHTML\(\s*'afterend'/.test(ms));

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\nart23: FAILED (${failed} of ${checks.length})` : `\nart23: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
