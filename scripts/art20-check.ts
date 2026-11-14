// Headless checks for Beta 2.0 VISUAL EVOLUTION — the owner's emblem / icon pictures (npm run art20):
//   * all 79 originals of PRIME_TIME_2_0_RANK_ART / PRIME_TIME_2_0_EFFECT_PREVIEWS are mapped, each once, to a real game
//     id, byte for byte as the owner left them (SHA-256), and every WebP copy exists with the manifest's size and SHA;
//   * the 22 rank steps show exactly their picture (III / II / I; ЛЕГЕНДА never a division — the ceremony's old 'III'),
//     a rank without a division its bar-less emblem, the league's symbols and the mode emblems their own files;
//   * producer levels 1–20 have their badges (11–20: the final Beta 2.0 set), a level beyond them the drawn prestige
//     badge with the real number (never another level's picture);
//   * the final set: the existing achievements (BOSS FIGHT, Survival, three PRIME CHALLENGE), the collection's reward
//     sections and two seasonal goals get their pictures — and nothing about them changes (ids, goals, conditions);
//   * the four stages, the five fame tiers, three currencies and ten effect previews map to the right ids, and items
//     without a new preview (PURPLE PHANTOM, RANKED CARDS, RANKED ARENA, frames, card styles) keep their art;
//   * every picture has a registered fallback (the old drawing) and the rank ids, thresholds and RP stay as they were.
import { CAREER_STAGES, FAME_TIERS } from '../src/config/career';
import { COSMETICS, type CosmeticId } from '../src/config/cosmetics.config';
import { RANKS } from '../src/config/league.config';
import { fallbackHTML, ICON_SIZES, iconVariant, type IconGroup } from '../src/ui/artIcons';
import { fameIcon, fameIndex, LEVEL_ART, levelBadge, stageArt } from '../src/ui/careerArt';
import { currencyArt } from '../src/ui/currencyArt';
import { cosmeticPic, EFFECT_ART } from '../src/ui/effectArt';
import { leagueSymbol, modeEmblem, rankEmblem, rankEmblemSvg, seasonEmblem } from '../src/ui/leagueArt';
import { achievementArt, achievementArtId, CAREER_GOAL_ART, careerGoalArt, rewardSectionArt } from '../src/ui/rewardArt';
import { GOALS } from '../src/config/career';
import { EVENTS } from '../src/config/events.config';
import { CHALLENGES } from '../src/config/modes.config';
import { BOSSES } from '../src/config/boss.config';
import { Collection } from '../src/meta/Collection';
import { defaultSave } from '../src/meta/SaveSystem';
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
  bytes: number;
  sha256: string;
}
interface Entry {
  src: string;
  sha256: string;
  out: Record<string, Out>;
}
const manifest = JSON.parse(read('scripts/art/manifest.json')) as { icon: { sizes: Record<string, Record<string, number>> }; icons: Record<string, Record<string, Entry>> };

// ------------------------------------------------------------- originals and copies
const FOLDERS = ['PRIME_TIME_2_0_RANK_ART', 'PRIME_TIME_2_0_EFFECT_PREVIEWS'];
const originals = FOLDERS.flatMap((d) => (fs.readdirSync(d) as string[]).filter((f) => f.toLowerCase().endsWith('.png')).map((f) => `${d}/${f}`));
const entries = Object.values(manifest.icons).flatMap((g) => Object.values(g));
const mapped = new Set(entries.map((e) => e.src));
check(`79 originals on disk (43 + 36), found ${originals.length}`, originals.length === 79);
check('every original is mapped to a game id (the plain rank emblems reuse division III)', originals.every((f) => mapped.has(f)));
check('the manifest names only files that exist, byte for byte (SHA-256 of the owner\'s PNG)', entries.every((e) => fs.existsSync(e.src) && sha(e.src) === e.sha256));
let copies = true;
let count = 0;
for (const [group, ids] of Object.entries(manifest.icons)) {
  for (const [id, e] of Object.entries(ids)) {
    for (const [size, o] of Object.entries(e.out)) {
      count++;
      const p = `public/${o.file}`;
      if (o.file !== `ui/${group}/${size}/${id}.webp` || !fs.existsSync(p) || sha(p) !== o.sha256 || o.w !== o.h || o.w !== manifest.icon.sizes[group]?.[size]) copies = false;
    }
  }
}
check(`every WebP copy exists, square, sized and byte-identical to the manifest (${count} files)`, copies && count > 0);
check('the module and the script agree on the groups and sizes', JSON.stringify(ICON_SIZES) === JSON.stringify(manifest.icon.sizes));
const file = (group: IconGroup, id: string, px: number) => fs.existsSync(`public/ui/${group}/${iconVariant(group, px)}/${id}.webp`);

// ------------------------------------------------------------------- PRIME LEAGUE
const RANKS_198 = 'casting:0,first_take:300,night_air:700,contender:1200,headliner:1800,star:2500,icon:3300,legend:4200';
check('8 ranks, ids, order and RP thresholds unchanged', RANKS.map((r) => `${r.id}:${r.base}`).join(',') === RANKS_198);
let steps = 0;
let stepsOk = true;
RANKS.forEach((r, i) => {
  const divs = i < RANKS.length - 1 ? ['III', 'II', 'I'] : [null];
  for (const d of divs) {
    steps++;
    const html = rankEmblem(i, d, 76);
    const want = d ? `ui/ranks/md/${r.id}_${d.toLowerCase()}.webp` : `ui/ranks/md/${r.id}.webp`;
    if (!srcOf(html).endsWith(want) || !html.includes(`alt="${r.ru}${d ? ' ' + d : ''}"`) || !html.includes('lg-emblem')) stepsOk = false;
    if (!file('ranks', d ? `${r.id}_${d.toLowerCase()}` : r.id, 76) || !file('ranks', d ? `${r.id}_${d.toLowerCase()}` : r.id, 18)) stepsOk = false;
  }
});
check(`each of the ${steps} rank steps shows exactly its own picture (alt = name + division)`, steps === 22 && stepsOk);
check('ЛЕГЕНДА ЭФИРА never shows a division (the promotion ceremony passed III)', srcOf(rankEmblem(7, 'III', 132)).endsWith('ui/ranks/md/legend.webp') && rankEmblemSvg(7, 'III') === rankEmblemSvg(7, null));
check('a rank without a division shows its bar-less emblem (season history)', RANKS.slice(0, 7).every((r, i) => srcOf(rankEmblem(i, null, 34)).endsWith(`ui/ranks-plain/sm/${r.id}.webp`)));
check('small emblems load the small file (leaderboard 22 px → xs)', srcOf(rankEmblem(2, 'II', 22)).includes('/ranks/xs/'));
check('the league symbol and the season emblem are the generic pictures, not a player\'s rank', srcOf(leagueSymbol(92)).endsWith('ui/league/md/symbol.webp') && srcOf(seasonEmblem(38)).endsWith('ui/league/sm/season.webp'));
check('the mode choice uses the mode emblems (producer / trophy)', srcOf(modeEmblem('career', 56)).endsWith('ui/modes/sm/career.webp') && srcOf(modeEmblem('league', 32)).endsWith('ui/modes/sm/league.webp'));
const ls = read('src/ui/screens/LeagueScreen.ts');
check('no league place draws a rank for the league symbol any more', !ls.includes('rankEmblem(3, null') && !ls.includes('rankEmblem(6, null') && !ls.includes("rankEmblem(3, 'II'") && !ls.includes('CAREER_EMBLEM'));
check('a failed rank picture falls back to the drawn badge', fallbackHTML('rank|2|II|40|').startsWith('<svg') && fallbackHTML('rank|2|II|40|').includes('НОЧНОЙ ЭФИР II'));

// ------------------------------------------------------------------------ career
const LV = Array.from({ length: 20 }, (_, i) => i + 1);
check('producer levels 1–20 have their own badge files', LV.every((l) => LEVEL_ART[l] && srcOf(levelBadge(l, 44)).endsWith(`ui/levels/sm/${String(l).padStart(2, '0')}.webp`) && file('levels', LEVEL_ART[l]!, 44)));
check('levels 11–20 come from the owner\'s final set (level_NN.png), each its own picture', LV.slice(10).every((l) => manifest.icons.levels[String(l)]?.src === `PRIME_TIME_2_0_EFFECT_PREVIEWS/level_${l}.png`) && new Set(LV.map((l) => manifest.icons.levels[String(l).padStart(2, '0')]?.sha256)).size === 20);
const l21 = levelBadge(21, 44);
check('a level without a picture is the drawn prestige badge with its own number (never another level\'s picture)', !l21.includes('<img') && l21.includes('<b>21</b>') && l21.includes(' ext ') && levelBadge(27, 44).includes('<b>27</b>'));
check('a failed level picture falls back to the drawn hexagon with the same number', fallbackHTML('level|7|44|').includes('<b>7</b>') && fallbackHTML('level|17|44|').includes('<b>17</b>'));
check('the four stages map to their pictures', CAREER_STAGES.every((st) => srcOf(stageArt(st.id, 64)).endsWith(`ui/stages/sm/${st.id}.webp`) && file('stages', st.id, 64)));
check('a failed stage picture falls back to the 1.5 drawing', fallbackHTML('stage|legendary').includes('<svg'));
check('five fame tiers, thresholds unchanged', FAME_TIERS.map((t) => t.min).join(',') === '0,1000,5000,20000,100000');
check('a fighter\'s fame badge follows its fans', [0, 999, 1000, 4999, 5000, 20000, 99999, 100000, 5e6].map(fameIndex).join(',') === '0,0,1,1,2,3,3,4,4' && srcOf(fameIcon(25000, 18)).endsWith('ui/fame/xs/4.webp'));
check('the screens use the pictures: menu, career, PRIME ID, results, roster', ['MenuScreen', 'CareerScreen', 'ProfileScreen', 'ResultsScreen'].every((s) => read(`src/ui/screens/${s}.ts`).includes('levelBadge(')) && read('src/ui/screens/RosterScreen.ts').includes('fameIcon(') && !read('src/ui/screens/ProfileScreen.ts').includes('pid-hex'));

// ---------------------------------------------------------------------- currencies
check('three currencies: dollars, reputation, PRIME TOKENS', srcOf(currencyArt('money', 30)).endsWith('ui/currency/xs/money.webp') && srcOf(currencyArt('rep', 30)).endsWith('ui/currency/xs/rep.webp') && srcOf(currencyArt('tokens', 44)).endsWith('ui/currency/sm/tokens.webp'));
check('a failed currency picture falls back to the 1.x icon', fallbackHTML('cur|tokens|16').includes('<svg') && fallbackHTML('cur|money|30').includes('ico money'));

// -------------------------------------------------------------------------- effects
const fx = Object.keys(EFFECT_ART) as CosmeticId[];
check('ten effect previews, each a real dash / victory effect with a file', fx.length === 10 && fx.every((id) => COSMETICS[id] && (COSMETICS[id].slot === 'dashFx' || COSMETICS[id].slot === 'victoryFx') && file('effects', id, 160)));
check('PHANTOM DASH (PRIME SHOP) gets phantom_dash.png; the Halloween PURPLE PHANTOM keeps its drawing', manifest.icons.effects.dash_prime_phantom?.src.endsWith('phantom_dash.png') && !EFFECT_ART.dash_phantom && cosmeticPic('dash_phantom', 74).startsWith('<svg'));
check('RANKED CARDS, RANKED ARENA, frames and card styles keep their real demonstrations', (['card_league_ranked', 'frame_league_arena', 'card_vhs', 'frame_prime_broadcast'] as CosmeticId[]).every((id) => !EFFECT_ART[id]));
check('seasonal effects keep their events (PUMPKIN VICTORY, CANDY COMET, MIDNIGHT CONFETTI)', COSMETICS.victory_pumpkin.eventId === 'halloween-2026' && COSMETICS.dash_candy_comet.source === 'season' && COSMETICS.victory_midnight_confetti.source === 'season');
check('a failed effect preview falls back to the item\'s 1.x drawing', fallbackHTML('fx|dash_glitch').includes('<svg'));

// ------------------------------------------------- achievements, rewards and goals (Beta 2.0 final)
const col = new Collection({ data: defaultSave(), save: () => undefined });
const ach = col.achievements();
const ACH_IDS = [...Object.values(BOSSES).map((b) => `boss-${b.id}`), 'survival-clear', ...CHALLENGES.map((c) => `challenge-${c.id}`), 'career-rising', 'career-star', 'career-legendary'];
check(`the achievements are the same ${ACH_IDS.length} (no new ones, the career stages keep their stage emblems)`, ach.map((a) => a.id).join() === ACH_IDS.join() && ach.filter((a) => a.id.startsWith('career-')).every((a) => achievementArtId(a) === null));
const achWant: Record<string, string> = { 'survival-clear': 'survival', 'challenge-energy_rush': 'energy_rush', 'challenge-high_stakes': 'high_stakes', 'challenge-spotlight': 'spotlight' };
for (const b of Object.values(BOSSES)) achWant[`boss-${b.id}`] = 'boss';
check('BOSS FIGHT, Survival and the three PRIME CHALLENGE achievements show their own pictures', Object.entries(achWant).every(([id, pic]) => {
  const a = ach.find((x) => x.id === id);
  return !!a && srcOf(achievementArt(a, 64) ?? '').endsWith(`ui/achievements/sm/${pic}.webp`) && file('achievements', pic, 64);
}));
check('the achievement pictures are the owner\'s files of those names', ['boss_legend_victory:boss', 'survival_final_star:survival', 'challenge_energy_rush:energy_rush', 'challenge_high_stakes:high_stakes', 'challenge_prime_spotlight:spotlight'].every((x) => {
  const [f, id] = x.split(':');
  return manifest.icons.achievements[id]?.src === `PRIME_TIME_2_0_EFFECT_PREVIEWS/achievement_${f}.png`;
}));
check('a failed achievement picture falls back to its 1.x drawing', fallbackHTML('ach|belt').includes('<svg') && fallbackHTML('ach|survival').includes('<svg') && fallbackHTML('ach|challenge').includes('<svg'));
check('the reward sections: the collection\'s «Награды» and its three sources have their emblems', (['collection', 'career', 'boss', 'daily'] as const).every((id) => srcOf(rewardSectionArt(id, 44)).endsWith(`ui/rewards/sm/${id}.webp`) && file('rewards', id, 40)) && manifest.icons.rewards.collection?.src.endsWith('collection_rewards_emblem.png') && manifest.icons.rewards.daily?.src.endsWith('reward_daily_streak_emblem.png'));
check('a failed reward emblem falls back to a 1.x drawing', (['collection', 'career', 'boss', 'daily'] as const).every((id) => fallbackHTML(`rw|${id}`).includes('<svg')));
const cs = read('src/ui/screens/CollectionScreen.ts');
check('MY COLLECTION uses them: the overview, the rewards section and its groups, the achievements', cs.includes("rewardSectionArt('collection', 44)") && cs.includes('rewardSectionArt(s.id, 40)') && cs.includes('achievementArt(a, 64)'));
// Beta 2.1: «Дебют в эфире» and «Мастер комбо» are the career's «Цели сезона» (career.ts GOALS: first_win, combo_3) —
// Beta 2.0 had put the two pictures on the winter event's quests by mistake
check('the two goal pictures belong to the career goals «Дебют в эфире» (first_win) and «Мастер комбо» (combo_3)', JSON.stringify(CAREER_GOAL_ART) === '{"first_win":"debut","combo_3":"combo"}' && GOALS.find((g) => g.id === 'first_win')?.title === 'Дебют в эфире' && GOALS.find((g) => g.id === 'combo_3')?.title === 'Мастер комбо' && GOALS.length === 8);
check('they load their files; the six other career goals keep their icon (pictures wait for a later update)', srcOf(careerGoalArt('first_win', 40) ?? '').endsWith('ui/goals/sm/debut.webp') && srcOf(careerGoalArt('combo_3', 24) ?? '').endsWith('ui/goals/xs/combo.webp') && GOALS.filter((g) => !CAREER_GOAL_ART[g.id]).every((g) => careerGoalArt(g.id, 40) === null) && file('goals', 'debut', 40) && fallbackHTML('goal|first_win').includes('<svg'));
check('the goals themselves are unchanged (first win $150 +15★; 3 combos in a match $200 +15★)', ((g) => g?.target === 1 && g.reward.money === 150 && g.reward.rep === 15)(GOALS.find((g) => g.id === 'first_win')) && ((g) => g?.target === 3 && g.reward.money === 200 && g.reward.rep === 15)(GOALS.find((g) => g.id === 'combo_3')));
check('the Career screen and the results draw them; the winter quests keep their own icons', read('src/ui/screens/CareerScreen.ts').includes('careerGoalArt(goal.id, 40)') && read('src/ui/screens/ResultsScreen.ts').includes('careerGoalArt(id, 22') && !read('src/ui/screens/EventsScreen.ts').includes('goalArt') && EVENTS.length > 0);

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\nart20: FAILED (${failed} of ${checks.length})` : `\nart20: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
