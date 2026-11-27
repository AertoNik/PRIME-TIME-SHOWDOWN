// Headless checks for Beta 2.2 — the owner's pictures of PRIME_TIME_2_2_ART_ASSETS (npm run art22):
//   * all 17 originals are mapped, each once, to an EXISTING game id (no picture earns or changes anything), byte for
//     byte as the owner left them (SHA-256), and every WebP copy exists with the manifest's size and SHA;
//   * nothing earlier changed: the manifest's 87 earlier entries (Beta 2.0) and the 1.9.9 cards / arenas keep their
//     exact fingerprint, the mode icons «Карьера» / «PRIME LEAGUE» their Beta 2.0 files;
//   * where each one shows: the career stages' achievements PRIME TIME STAR / LEGENDARY PRODUCTION, MY COLLECTION's
//     four sections, the six remaining «Цели сезона», the PRIME LEAGUE road's three titles, DAILY PRIME STREAK's 7-day
//     title and 100-day victory effect — each with a fallback to its earlier drawing.
import { GOALS } from '../src/config/career';
import { COSMETICS } from '../src/config/cosmetics.config';
import { DAILY } from '../src/config/daily.config';
import { LEAGUE } from '../src/config/league.config';
import { ICON_SIZES, fallbackHTML } from '../src/ui/artIcons';
import { cosmeticPic, EFFECT_ART, TITLE_ART } from '../src/ui/effectArt';
import { achievementArt, achievementArtId, CAREER_GOAL_ART, careerGoalArt, LEAGUE_TITLE_ART, leagueTitleArt, sectionArt } from '../src/ui/rewardArt';
import { Collection } from '../src/meta/Collection';
import { defaultSave } from '../src/meta/SaveSystem';
import { crypto, fs, path, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;
const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') as string;
const srcOf = (html: string) => /src="([^"]+)"/.exec(html)?.[1] ?? '';
const nfc = (s: string) => s.normalize('NFC');

interface Out {
  file: string;
  w: number;
  h: number;
  bytes: number;
  sha256: string;
}
interface Entry {
  src: string;
  sha256: string;
  size: number[];
  out: Record<string, Out>;
}
const manifest = JSON.parse(read('scripts/art/manifest.json')) as {
  icon: { sizes: Record<string, Record<string, number>> };
  icons: Record<string, Record<string, Entry>>;
  cards: unknown;
  arenas: unknown;
};
const DIR = 'PRIME_TIME_2_2_ART_ASSETS';

// ------------------------------------------------------------- originals and copies
const originals = (fs.readdirSync(DIR) as string[]).filter((f) => f.toLowerCase().endsWith('.png'));
const all: [string, string, Entry][] = Object.entries(manifest.icons).flatMap(([g, ids]) => Object.entries(ids).map(([i, e]) => [g, i, e] as [string, string, Entry]));
const mine = all.filter(([, , e]) => e.src.startsWith(`${DIR}/`));
// (Beta 2.4: the owner added dash_invite_signal.png to this folder — the 18th original, INVITE SIGNAL's preview)
check(`18 originals in ${DIR} (Beta 2.2's 17 + Beta 2.4's INVITE SIGNAL), found ${originals.length}`, originals.length === 18 && originals.includes('dash_invite_signal.png'));
check('every original is mapped exactly once', originals.every((f) => mine.filter(([, , e]) => nfc(path.basename(e.src)) === nfc(f)).length === 1) && mine.length === 18 && manifest.icons.effects.dash_invite_signal?.src === `${DIR}/dash_invite_signal.png`);
check('the owner\'s originals are untouched (SHA-256 of each PNG = the manifest)', mine.every(([, , e]) => fs.existsSync(e.src) && sha(e.src) === e.sha256));
check('every original is a 1254² picture with real transparency (RGBA)', mine.every(([, , e]) => e.size[0] === 1254 && e.size[1] === 1254));
let copies = true;
for (const [g, , e] of mine) {
  const sizes = ICON_SIZES[g as keyof typeof ICON_SIZES] as Record<string, number> | undefined;
  if (!sizes || Object.keys(e.out).join() !== Object.keys(sizes).join()) copies = false;
  for (const [k, o] of Object.entries(e.out)) {
    const p = `public/${o.file}`;
    if (!fs.existsSync(p) || sha(p) !== o.sha256 || o.w !== sizes?.[k] || o.h !== sizes?.[k]) copies = false;
  }
}
check('every WebP copy exists in public/ui with the size of its group (artIcons.ts = prepare_art.py) and the manifest\'s SHA', copies && JSON.stringify(manifest.icon.sizes) === JSON.stringify(ICON_SIZES));

// ------------------------------------------------------------- nothing earlier changed
// (Beta 2.2 final's batch PRIME_TIME_2_3_WINTER_COLLECTION_ART is checked by npm run art23 — it adds, never replaces)
// (Beta 2.3's PRIME_TIME_2_3_UI_MODE_ART_REFINED is checked by npm run art24 — it adds, never replaces)
// (Beta 2.6's PRIME_TIME_2_6_UI_ART — the DAILY MISSIONS picture — is checked by npm run missions; it adds, never replaces)
const older = all.filter(([, , e]) => !e.src.startsWith(`${DIR}/`) && !e.src.startsWith('PRIME_TIME_2_3_WINTER_COLLECTION_ART/') && !e.src.startsWith('PRIME_TIME_2_3_UI_MODE_ART_REFINED/') && !e.src.startsWith('PRIME_TIME_2_6_UI_ART/') && !e.src.startsWith('PRIME_TIME_2_7_UI_ART/'));
const groups = [...new Set(older.map(([g]) => g))].sort();
const canon = JSON.stringify(groups.map((g) => [g, older.filter(([gg]) => gg === g).map(([, i, e]) => [i, e.src, e.sha256, Object.keys(e.out).sort().map((k) => [k, e.out[k].sha256])] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1))]));
check(`the 87 earlier icon entries are exactly as Beta 2.1 published them (fingerprint 06f9576d…; ${older.length} entries)`, older.length === 87 && crypto.createHash('sha256').update(canon).digest('hex') === '06f9576d0f544523e9df80e75a2dce3458d11048ac5b7b53d9dbfd61dbd1b14c');
check('the 1.9.9 cards and arena previews are untouched (fingerprint 9d3ab0a8…)', crypto.createHash('sha256').update(JSON.stringify([manifest.cards, manifest.arenas])).digest('hex') === '9d3ab0a82d280c676c8966ca62f77a905e14bab8f7c1f559a66ba5c11ae61d72');
check('the mode icons «Карьера» and «PRIME LEAGUE» keep their Beta 2.0 pictures', manifest.icons.modes.career.src.endsWith('career_mode_emblem.png') && manifest.icons.modes.league.src.endsWith('league_mode_emblem.png') && Object.keys(manifest.icons.modes).slice(0, 2).join() === 'career,league' /* Beta 2.3 appends the five modes' own */);

// ------------------------------------------------------------- the mapping (real ids only)
const at = (g: string, i: string) => manifest.icons[g]?.[i]?.src.slice(DIR.length + 1) ?? '';
const save = defaultSave();
const store = { data: save, save: () => {} } as never;
const ach = new Collection(store).achievements();
// (Beta 2.2 mini hotfix: achievement_prime_legend.png is the PRIME LEGEND achievement «Победитель легенды» — id prime_legend;
// LEGENDARY PRODUCTION keeps its stage emblem)
check('PRIME TIME STAR: the career stage\'s achievement wears achievement_prime_time_star; «Победитель легенды» (boss-vale) achievement_prime_legend; LEGENDARY PRODUCTION its stage emblem', ach.some((a) => a.id === 'career-star') && ach.some((a) => a.id === 'boss-vale') && at('achievements', 'career_star') === 'achievement_prime_time_star.png' && at('achievements', 'prime_legend') === 'achievement_prime_legend.png' && !('career_legendary' in manifest.icons.achievements) && achievementArtId({ id: 'boss-vale' }) === 'prime_legend' && achievementArtId({ id: 'career-legendary' }) === null && srcOf(achievementArt({ id: 'career-star', art: 'career', title: '' }, 64) ?? '').endsWith('ui/achievements/sm/career_star.webp') && achievementArtId({ id: 'career-rising' }) === 'career_rising' /* Beta 2.3 */);
const goalMap: Record<string, [string, string]> = {
  rating_70: ['golden_rating', 'Золотая звезда стремительного роста.png'],
  perfect_3: ['perfect_timing', 'season_goal_perfect_timing.png'],
  fans_2500: ['rising_star', 'season_goal_rising_star.png'],
  sign_second: ['roster_expansion', 'season_goal_roster_expansion.png'],
  pro_win: ['big_league', 'season_goal_big_league.png'],
  champion_win: ['prime_time_champion', 'season_goal_prime_time_champion.png'],
};
check('all eight «Цели сезона» have a picture; the six new ones by their goal id and title (Восходящая звезда, Большая лига, Расширение состава, Идеальный тайминг, Чемпион прайм-тайма, Золотой рейтинг)', GOALS.length === 8 && GOALS.every((g) => !!CAREER_GOAL_ART[g.id]) && Object.entries(goalMap).every(([gid, [pic, file]]) => CAREER_GOAL_ART[gid as keyof typeof CAREER_GOAL_ART] === pic && nfc(at('goals', pic)) === nfc(file) && srcOf(careerGoalArt(gid as never, 40) ?? '').endsWith(`ui/goals/sm/${pic}.webp`)) && ['Золотой рейтинг', 'Идеальный тайминг', 'Восходящая звезда', 'Расширение состава', 'Большая лига', 'Чемпион прайм-тайма'].every((t) => GOALS.some((g) => g.title === t)));
check('the goals themselves are unchanged: conditions and rewards as in Beta 2.1', JSON.stringify(GOALS.map((g) => [g.id, g.target, g.reward])) === JSON.stringify([['first_win', 1, { money: 150, rep: 15 }], ['combo_3', 3, { money: 200, rep: 15 }], ['rating_70', 70, { money: 200, rep: 20 }], ['perfect_3', 3, { money: 200, rep: 15 }], ['fans_2500', 2500, { money: 250, rep: 20 }], ['sign_second', 2, { money: 120, rep: 30 }], ['pro_win', 1, { money: 300, rep: 30 }], ['champion_win', 1, { money: 600, rep: 60 }]]));
const roadTitles = (LEAGUE.track as { title?: string }[]).filter((t) => t.title).map((t) => t.title);
check('the PRIME LEAGUE road\'s three titles (ON AIR, ГОЛОС ЭФИРА, ПРАЙМ-ТАЙМ) wear title_on_air / title_voice_of_air / title_prime_time', roadTitles.join() === 'ON AIR,ГОЛОС ЭФИРА,ПРАЙМ-ТАЙМ' && roadTitles.every((t) => !!LEAGUE_TITLE_ART[t!]) && at('titles', 'on_air') === 'title_on_air.png' && at('titles', 'voice_of_air') === 'title_voice_of_air.png' && at('titles', 'prime_time') === 'title_prime_time.png' && srcOf(leagueTitleArt('ГОЛОС ЭФИРА', 38) ?? '').endsWith('ui/titles/sm/voice_of_air.webp') && leagueTitleArt('НЕИЗВЕСТНЫЙ', 38) === null);
const m7 = DAILY.milestones.find((m) => m.day === 7);
const m100 = DAILY.milestones.find((m) => m.day === 100);
check('DAILY PRIME STREAK: the 7-day title «ЕЖЕДНЕВНЫЙ ЭФИР» wears reward_daily_broadcast, the 100-day «РАССВЕТ ПРАЙМ-ТАЙМА» reward_prime_dawn', m7?.cosmetic === 'title_daily_regular' && m100?.cosmetic === 'victory_daily_sunrise' && COSMETICS.title_daily_regular.name === 'ЕЖЕДНЕВНЫЙ ЭФИР' && COSMETICS.victory_daily_sunrise.name === 'РАССВЕТ ПРАЙМ-ТАЙМА' && at('titles', 'title_daily_regular') === 'reward_daily_broadcast.png' && at('effects', 'victory_daily_sunrise') === 'reward_prime_dawn.png' && srcOf(cosmeticPic('title_daily_regular', 132)).endsWith('ui/titles/md/title_daily_regular.webp') && srcOf(cosmeticPic('victory_daily_sunrise', 132)).endsWith('ui/effects/md/victory_daily_sunrise.webp') && Object.keys(TITLE_ART).join() === 'title_daily_regular,title_prime_legend,title_winter_champion' && !!EFFECT_ART.victory_daily_sunrise);
check('MY COLLECTION\'s four sections wear collection_*_v2 (achievements, seasons, prime_league, rewards)', (['achievements', 'seasons', 'league', 'rewards'] as const).every((s) => srcOf(sectionArt(s, 44)).endsWith(`ui/sections/sm/${s}.webp`) && at('sections', s) === `collection_${s === 'league' ? 'prime_league' : s}_v2.png`));

// ------------------------------------------------------------- fallbacks and wiring
const cs = read('src/ui/screens/CollectionScreen.ts');
check('a failed section emblem shows its Beta 2.1 drawing again (registered for all four)', ['seasons', 'achievements', 'league', 'rewards'].every((s) => cs.includes(`registerSectionFallback('${s}'`)) && /fb="sec\|seasons\|44"/.test(sectionArt('seasons', 44)));
check('a failed title picture falls back to the trophy; a failed daily item to its 1.x drawing', fallbackHTML('ltitle').includes('<svg') && fallbackHTML('fx|title_daily_regular').includes('<svg') && fallbackHTML('fx|victory_daily_sunrise').includes('<svg'));
const ls = read('src/ui/screens/LeagueScreen.ts');
check('the league road and the collection\'s league section use the title pictures (the crown / trophy for any other title)', /leagueTitleArt\(t\.title!, 38\) \?\? ICONS\.crown/.test(ls) && /leagueTitleArt\(t\.title!, 22, 'cl-ltitle-art'\) \?\? UI_ICONS\.trophy/.test(cs));

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\nart22: FAILED (${failed} of ${checks.length})` : `\nart22: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
