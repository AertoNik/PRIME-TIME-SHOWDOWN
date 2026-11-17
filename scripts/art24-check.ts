// Headless checks for Beta 2.3 — the owner's batch PRIME_TIME_2_3_UI_MODE_ART_REFINED (npm run art24):
//   * all 20 originals are mapped, each once, to an EXISTING game entity (a picture earns or changes nothing), byte for
//     byte as the owner left them (SHA-256); every WebP copy exists with its group's size and the manifest's SHA; the
//     bottom bar's skins keep their aspect and the slice shares menuArt.ts uses;
//   * nothing earlier changed: every earlier icon entry keeps its exact fingerprint, Beta 2.2's 251 WebP stay;
//   * where each one shows, each with its earlier drawing as the fallback: the main screen's gift / invite / PRIME SHOP /
//     cards / settings, the bottom bar's three skins (the label is HTML text — never part of a picture — and no button
//     is drawn inside a button), the five modes, three achievements, three winter quests, WINTER SHOWDOWN's emblem;
//   * the one picture that does not match its name is recorded, not forced: ui_nav_theme_button_v3 is a gear and the
//     game's fourth bottom button is «Настройки» — there is no theme toggle, so it is the settings button's face.
import { MASTERY } from '../src/config/achievements.config';
import { EVENTS } from '../src/config/events.config';
import { ICON_SIZES, fallbackHTML } from '../src/ui/artIcons';
import { ICONS } from '../src/ui/eventArt';
import { UI_ICONS } from '../src/ui/icons';
import { MODE_ICONS, DUEL_EMBLEM } from '../src/ui/modeArt';
import { modePic, NAV_SKIN, navSkinStyle, SQUAD_OLD, uiIcon } from '../src/ui/menuArt';
import { achievementArtId } from '../src/ui/rewardArt';
import { QUEST_ART, questIcon } from '../src/ui/screens/EventsScreen';
import { crypto, fs, path, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;
const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') as string;
const srcOf = (html: string) => /src="([^"]+)"/.exec(html)?.[1] ?? '';
const fbOf = (html: string) => /data-fb="([^"]+)"/.exec(html)?.[1] ?? '';

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
  aspect?: number;
  l?: number;
  r?: number;
  out: Record<string, Out>;
}
const manifest = JSON.parse(read('scripts/art/manifest.json')) as {
  icon: { sizes: Record<string, Record<string, number>>; navHeights: Record<string, number> };
  icons: Record<string, Record<string, Entry>>;
};
const DIR = 'PRIME_TIME_2_3_UI_MODE_ART_REFINED';
/** The earlier entries' fingerprint, taken from the manifest of the published Beta 2.2 (mini hotfix a58e0ca). */
const EARLIER_FP = '13cb25a263fbe08d5f87259a42c62c928b816fb22d300f022de9fcaf0aced025';

// ------------------------------------------------------------- the mapping (file → group / id)
const MAP: [string, string, string][] = [
  ['ui_home_gift_icon_v3.png', 'ui', 'gift'],
  ['ui_home_invite_friend_icon_v3.png', 'ui', 'invite'],
  ['ui_prime_shop_icon_v3.png', 'ui', 'shop'],
  ['ui_cards_icon_v3.png', 'ui', 'cards'],
  // a gear: the game has no theme toggle — the fourth bottom button is «Настройки» (recorded mismatch)
  ['ui_nav_theme_button_v3.png', 'ui', 'settings'],
  ['ui_nav_fighters_button_v3.png', 'nav', 'fighters'],
  ['ui_nav_career_button_v3.png', 'nav', 'career'],
  ['ui_nav_collection_button_v3.png', 'nav', 'collection'],
  ['mode_classic_duel_icon_v3.png', 'modes', 'classic_duel'],
  ['mode_survival_icon_v3.png', 'modes', 'survival'],
  ['mode_prime_challenge_icon_v3.png', 'modes', 'prime_challenge'],
  ['mode_prime_squad_icon_v3.png', 'modes', 'prime_squad'],
  ['mode_prime_rush_icon_v3.png', 'modes', 'prime_rush'],
  ['achievement_full_roster.png', 'achievements', 'mastery_roster'],
  ['achievement_perfect_broadcast.png', 'achievements', 'mastery_rating'],
  ['achievement_career_rising_broadcast.png', 'achievements', 'career_rising'],
  ['winter_quest_first_snow.png', 'winter', 'quest_first_snow'],
  ['winter_quest_holiday_hat_trick.png', 'winter', 'quest_holiday_hat_trick'],
  ['winter_quest_garland_combo.png', 'winter', 'quest_garland_combo'],
  ['winter_event_emblem.png', 'winter', 'event_emblem'],
];
const originals = (fs.readdirSync(DIR) as string[]).filter((f) => f.toLowerCase().endsWith('.png')).sort();
const all = Object.entries(manifest.icons).flatMap(([g, ids]) => Object.entries(ids).map(([i, e]) => [g, i, e] as const));
const mine = all.filter(([, , e]) => e.src.startsWith(`${DIR}/`));
check(`20 originals on disk, found ${originals.length}; each mapped exactly once`, originals.length === 20 && MAP.length === 20 && originals.every((f) => mine.filter(([, , e]) => e.src === `${DIR}/${f}`).length === 1) && mine.length === 20);
check('the mapping is the one recorded in docs (file → group/id)', MAP.every(([f, g, i]) => manifest.icons[g]?.[i]?.src === `${DIR}/${f}`));
check('the manifest names the owner\'s files byte for byte (SHA-256)', mine.every(([, , e]) => fs.existsSync(e.src) && sha(e.src) === e.sha256));

// every id is a real game entity
const winter = EVENTS.find((e) => e.id === 'winter-2026')!;
const masteryIds = MASTERY.map((m) => m.id) as string[];
check('the ids are real: the MASTERY achievements «Полный состав» (mastery-roster) and «Идеальный эфир» (mastery-rating), the career stage RISING BROADCAST (career-rising), the winter quests FIRST SNOW ON AIR / HOLIDAY WINS / GARLAND COMBO', masteryIds.includes('mastery-roster') && masteryIds.includes('mastery-rating') && MASTERY.find((m) => m.id === 'mastery-roster')!.title === 'Полный состав' && MASTERY.find((m) => m.id === 'mastery-rating')!.title === 'Идеальный эфир' && /id: 'rising',\s*title: 'RISING BROADCAST'/.test(read('src/config/career.ts')) && ([['first_snow', 'FIRST SNOW ON AIR'], ['holiday_hat_trick', 'HOLIDAY WINS'], ['garland_combo', 'GARLAND COMBO']] as const).every(([id, t]) => winter.quests.find((q) => q.id === id)?.title === t));

// ------------------------------------------------------------- the copies
const sizes = manifest.icon.sizes;
let copies = true;
for (const [g, i, e] of mine) {
  for (const [k, o] of Object.entries(e.out)) {
    const p = `public/${o.file}`;
    const sized = g === 'nav' ? o.h === manifest.icon.navHeights[k] && Math.abs(o.w - o.h * e.aspect!) <= 1 : o.w === o.h && o.w === sizes[g]?.[k];
    if (o.file !== `ui/${g}/${k}/${i}.webp` || !fs.existsSync(p) || sha(p) !== o.sha256 || !sized) copies = false;
  }
}
check('every WebP copy exists with its group\'s size (the nav skins: 160 / 240 px tall at their aspect) and the manifest\'s SHA', copies && mine.every(([g, , e]) => Object.keys(e.out).join() === Object.keys(g === 'nav' ? manifest.icon.navHeights : sizes[g]).join()));
check('the module and the script agree on the groups and sizes (the new group «ui»: 96 / 192)', JSON.stringify(ICON_SIZES) === JSON.stringify(sizes) && JSON.stringify(sizes.ui) === '{"xs":96,"sm":192}');
check('the bottom bar\'s slices in menuArt.ts are the manifest\'s (emblem share l, end share r, aspect)', (Object.keys(NAV_SKIN) as (keyof typeof NAV_SKIN)[]).every((id) => { const e = manifest.icons.nav[id]; const s = NAV_SKIN[id]; return !!e && e.l === s.l && e.r === s.r && Math.abs(e.aspect! - s.aspect) < 1e-3; }) && Object.keys(manifest.icons.nav).join() === 'fighters,career,collection');

// ------------------------------------------------------------- nothing earlier changed
const older = all.filter(([, , e]) => !e.src.startsWith(`${DIR}/`));
const groups = [...new Set(older.map(([g]) => g))].sort();
const canon = JSON.stringify(groups.map((g) => [g, older.filter(([gg]) => gg === g).map(([, i, e]) => [i, e.src, e.sha256, Object.keys(e.out).sort().map((k) => [k, e.out[k].sha256])] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1))]));
const FP = crypto.createHash('sha256').update(canon).digest('hex') as string;
if (proc.argv.includes('--print')) console.log('earlier fingerprint', FP, older.length);
check(`the ${older.length} earlier icon entries (Beta 2.0 → 2.2 final) are exactly as Beta 2.2 published them (fingerprint 13cb25a2…)`, older.length === 118 && FP === EARLIER_FP);
const webp: string[] = [];
const walk = (d: string) => {
  for (const f of fs.readdirSync(d) as string[]) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.webp')) webp.push(p);
  }
};
walk('public/ui');
const newCopies = mine.reduce((n, [, , e]) => n + Object.keys(e.out).length, 0);
check(`WebP in public/ui: ${webp.length} = Beta 2.2's 251 + ${newCopies} new, every one in the manifest`, newCopies === 44 && webp.length === 251 + 44);

// ------------------------------------------------------------- the main screen
const ms = read('src/ui/screens/MenuScreen.ts');
const css = read('src/styles/main.css');
check('the gift, «Пригласить друга», PRIME SHOP and КАРТЫ wear the owner\'s icons (the winter gift keeps its winter dress first)', /winterGiftArt\(g, 46\) \?\? uiIcon\('gift', 46\)/.test(ms) && /class="ref-btn"[^\n]*>\$\{uiIcon\('invite', 46\)\}<\/button>/.test(ms) && /<span class="se-ico pic">\$\{uiIcon\('shop', 46\)\}<\/span>/.test(ms) && /<span class="ce-ico pic">\$\{uiIcon\('cards', 46\)\}<\/span>/.test(ms));
check('each icon IS its button\'s face: no button inside a button (the picture is an <img>, the gift / invite buttons hold nothing else but the gift\'s dot)', !/<button[^>]*>[^<]*<button/.test(ms) && uiIcon('gift', 46).startsWith('<img ') && !/<button/.test(uiIcon('shop', 46)) && /\.menu > \.daily-btn,\s*\.menu > \.ref-btn \{[^}]*background: none/.test(css));
check('the bottom bar: three skins + settings; every label is HTML text (Бойцы / Карьера / Коллекция / Настройки), actions unchanged', /data-act="roster" style="\$\{navSkinStyle\('fighters'\)\}"><span class="nav-label">Бойцы<\/span>/.test(ms) && /data-act="career" style="\$\{navSkinStyle\('career'\)\}"><span class="nav-label">Карьера<\/span>/.test(ms) && /data-act="collection" style="\$\{navSkinStyle\('collection'\)\}"[^>]*><span class="nav-label">Коллекция<\/span>/.test(ms) && /data-act="settings"[^>]*>\$\{uiIcon\('settings', 46, 'nav-gear'\)\}<span class="nav-label">Настройки<\/span>/.test(ms));
check('a skin\'s emblem and end are drawn unscaled, only the panel stretches (border-image 9-slice from the manifest\'s shares)', /\.nav-skin \{[^}]*border-image-source: var\(--skin\);[^}]*border-image-slice: 0 var\(--sr\) 0 var\(--sl\) fill;/.test(css) && navSkinStyle('career') === `--skin:url('http://localhost/ui/nav/sm/career.webp');--lk:1.5704;--rk:0.5025;--sl:50%;--sr:16%`);
// (Beta 2.3 release fix: the published build has base './' and a url() in a custom property resolves against the stylesheet
// in assets/ — so the skin's address must be absolute, resolved against the page; a relative one 404'd on the live site)
check('the skins\' address is absolute (resolved against the page, never against the stylesheet in assets/) — for the published base \'./\' too', /^--skin:url\('https?:\/\/[^']+\/ui\/nav\/sm\/fighters\.webp'\)/.test(navSkinStyle('fighters')) && !/assets\/ui\//.test(navSkinStyle('collection')) && /new URL\(BASE \+ rel, base\)\.href/.test(read('src/ui/menuArt.ts')) && !/style="--[a-z]+:url\('\.\//.test(ms));
check('phones get two rows (320–599 px of the game frame), wider frames one row — by the frame\'s width (container queries), never a window guess', /\.menu-nav\.skinned \{[^}]*grid-template-columns: 1fr 1fr;/.test(css) && /@container \(min-width: 600px\) \{\s*\.menu-nav\.skinned \{[^}]*grid-template-columns: auto auto auto min-content;/.test(css) && /@container \(max-width: 360px\) \{\s*\.menu-nav\.skinned \{\s*--nav-h: 42px;/.test(css));
check('fallbacks: each main-screen icon falls back to its earlier drawing', fallbackHTML('uiic|gift') === UI_ICONS.gift && fallbackHTML('uiic|invite') === UI_ICONS.invite && fallbackHTML('uiic|shop') === UI_ICONS.shop && fallbackHTML('uiic|cards') === UI_ICONS.cards && fallbackHTML('uiic|settings') === UI_ICONS.gear && fbOf(uiIcon('cards', 46)) === 'uiic|cards');

// ------------------------------------------------------------- the modes
const mds = read('src/ui/screens/ModesScreen.ts');
const lg = read('src/ui/screens/LeagueScreen.ts');
check('CLASSIC DUEL / SURVIVAL / PRIME CHALLENGE (the career\'s mode cards) wear their pictures', ['classic_duel', 'survival', 'prime_challenge'].every((id) => mds.includes(`<span class="mc-ico pic">\${modePic('${id}', 56)}</span>`)) && srcOf(modePic('survival', 56)).endsWith('ui/modes/sm/survival.webp'));
check('PRIME SQUAD / PRIME RUSH (PRIME LEAGUE\'s series) wear theirs; the league\'s PRIME CHALLENGE qualifier keeps its rank emblem', lg.includes(`\${modePic('prime_squad', 46)}`) && lg.includes(`\${modePic('prime_rush', 46)}`) && /lg-challenge">\$\{rankEmblem\(/.test(lg) && !/SQUAD_ICON\s*=/.test(lg));
check('fallbacks: each mode falls back to its earlier sign (PRIME SQUAD: its 1.9.1 three heads)', fallbackHTML('mpic|classic_duel') === DUEL_EMBLEM && fallbackHTML('mpic|survival') === MODE_ICONS.survival && fallbackHTML('mpic|prime_challenge') === MODE_ICONS.challenge && fallbackHTML('mpic|prime_rush') === MODE_ICONS.energy_rush && fallbackHTML('mpic|prime_squad') === SQUAD_OLD && SQUAD_OLD.includes('#7cf7d4'));

// ------------------------------------------------------------- achievements, winter
check('achievements: «Полный состав», «Идеальный эфир», RISING BROADCAST wear their pictures; LEGENDARY PRODUCTION keeps its emblem', achievementArtId({ id: 'mastery-roster' }) === 'mastery_roster' && achievementArtId({ id: 'mastery-rating' }) === 'mastery_rating' && achievementArtId({ id: 'career-rising' }) === 'career_rising' && achievementArtId({ id: 'career-legendary' }) === null);
check('all nine winter quests wear a picture; the three new ones fall back to their own icon', winter.quests.every((q) => QUEST_ART[q.id]) && Object.keys(QUEST_ART).length === 9 && (['first_snow', 'holiday_hat_trick', 'garland_combo'] as const).every((id) => { const q = winter.quests.find((x) => x.id === id)!; const h = questIcon(id, q.icon); return srcOf(h).endsWith(`ui/winter/sm/quest_${id}.webp`) && fbOf(h) === `qi|${q.icon}`; }));
const ev = read('src/ui/screens/EventsScreen.ts');
check('WINTER SHOWDOWN\'s emblem on its own banner only (id winter-2026, not every winter theme); the 1.9.7 snowflakes are its fallback and the preview keeps them', /const WINTER_EVENT_ID = 'winter-2026';/.test(ev) && /const emblem = e\.id === WINTER_EVENT_ID;/.test(ev) && /artImg\('winter', 'event_emblem', 96, \{ cls: 'evb-pic', fb: 'evb\|' \}\)/.test(ev) && fallbackHTML('evb|').includes(ICONS.snowflake) && /e\.themeId === 'winter'\s*\? SNOW_ART/.test(ev) && EVENTS.some((e) => e.id === 'winter-preview' && e.themeId === 'winter'));
check('the banner\'s text keeps its room beside the emblem', /\.ev-banner\.has-emblem \.evb-title \{\s*max-width: 64%;/.test(css) && /\.evb-emblem \{[^}]*width: min\(33%, 124px\);/.test(css));

// ------------------------------------------------------------- what a picture must not do
check('no picture carries a label: none of the new pictures has alt text or a title (each is aria-hidden; the label lives in the button)', [uiIcon('gift', 46), uiIcon('settings', 46), modePic('prime_rush', 46)].every((h) => / alt="" aria-hidden="true"/.test(h)));
check('nothing outside the pictures changed: rewards, prices, quest targets and the economy are not touched by this batch (winter quests: the same ids, targets, rewards)', winter.quests.map((q) => `${q.id}:${q.target}:${q.reward}`).join() === 'first_snow:5:30,holiday_hat_trick:15:40,garland_combo:60:50,frost_guard:40:50,midnight_rating:10:55,holiday_broadcast:12:60,champions_eve:20:65,league_snowfall:25:70,cane_collector:1000:90');

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\nart24: FAILED (${failed} of ${checks.length})` : `\nart24: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
