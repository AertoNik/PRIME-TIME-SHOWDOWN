// Headless checks for the Beta 2.0 career extension (npm run career20):
//   * producer levels 1–10 and everything they open are exactly as in Alpha 1.9.9 (thresholds, titles, contracts,
//     difficulties, career cards); levels 11–20 continue the ladder (growing steps, unique titles, titles only);
//   * a level is read from the reputation, so a veteran gets his level at once — no save field, no migration;
//   * a level without a picture (11+) shows the drawn badge with its own number, never level 10's picture.
import { CAREER_STAGES, CLASSIC_LEVELS, LEVEL_THRESHOLDS, LEVEL_TITLES } from '../src/config/career';
import { NEW_CARDS, CARDS } from '../src/config/cards';
import { DIFFICULTIES, FIGHTERS } from '../src/config/fighters';
import { levelFor } from '../src/meta/CareerSystem';
import { defaultSave, summarize, VERSION } from '../src/meta/SaveSystem';
import { levelBadge } from '../src/ui/careerArt';
import { fs, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);

const CLASSIC = '0,60,150,290,480,720,1020,1400,1850,2400';
const CLASSIC_TITLES = 'Стажёр эфира,Ассистент продюсера,Продюсер,Старший продюсер,Шоураннер,Глава канала,Медиамагнат,Король прайм-тайма,Икона эфира,Легенда ТВ';
check('levels 1–10: thresholds and titles exactly as in Alpha 1.9.9', LEVEL_THRESHOLDS.slice(0, 10).join(',') === CLASSIC && LEVEL_TITLES.slice(0, 10).join(',') === CLASSIC_TITLES && CLASSIC_LEVELS === 10);
check('20 levels, one title per level, titles unique', LEVEL_THRESHOLDS.length === 20 && LEVEL_TITLES.length === 20 && new Set(LEVEL_TITLES).size === 20);
const steps = LEVEL_THRESHOLDS.slice(1).map((t, i) => t - LEVEL_THRESHOLDS[i]);
check('every step is bigger than the one before (the ladder only gets longer)', steps.every((s, i) => i === 0 || s > steps[i - 1]));
check('no step past 10 grows more than 30 % (no sudden wall)', steps.slice(9).every((s, i) => i === 0 || s <= steps[9 + i - 1] * 1.3));
const unlocks = [
  Object.values(FIGHTERS).filter((f) => f.contract).map((f) => `${f.id}:${f.contract!.level}`).join(','),
  Object.entries(DIFFICULTIES).map(([k, d]) => `${k}:${d.unlockLevel}`).join(','),
  NEW_CARDS.map((id) => `${id}:${CARDS[id].shop?.level}`).join(','),
].join(' | ');
check('contracts, difficulties and career cards still open at levels 1–6', /:([7-9]|\d\d)\b/.test(unlocks) === false && unlocks.includes('bruno:2') && unlocks.includes('champion:4'));
check('level from reputation: 2399 → 9, 2400 → 10 (next 3100), 23200 → 20 (top), any more stays 20', levelFor(2399).level === 9 && levelFor(2400).level === 10 && levelFor(2400).next === 3100 && levelFor(23200).level === 20 && levelFor(23200).next === null && levelFor(5e8).level === 20);
check('the titles follow the levels', levelFor(3100).title === 'Продюсер года' && levelFor(23199).title === 'Бессмертный эфир');
const vet = defaultSave();
vet.reputation = 10000;
check('a veteran save (reputation 10 000) is level 16 at once — no new field, schema unchanged', summarize(vet, VERSION).level === 16 && levelFor(10000).level === 16);
check('the save stores reputation only (no level field to migrate)', !/\blevel:\s*number/.test(fs.readFileSync('src/meta/SaveSystem.ts', 'utf8').split('export interface SaveSummary')[0]));
check('levels 11–20 have no rewards or unlocks (Beta 2.1): no stage or goal is tied to a level', CAREER_STAGES.every((st) => st.milestones.every((m) => (m.metric as string) !== 'level')));
// Beta 2.0 final: the owner's badges of levels 11–20 (PRIME_TIME_2_0_EFFECT_PREVIEWS/level_NN.png) replace the drawn ones
check('levels 11–20 show the owner\'s badge of their own number (the drawn badge stays the fallback and for any level beyond)', [11, 12, 15, 16, 20].every((l) => levelBadge(l, 44).includes(`ui/levels/sm/${l}.webp`) && levelBadge(l, 44).includes(`alt="Уровень ${l}"`) && levelBadge(l, 44).includes(`data-fb="level|${l}|44|`)) && levelBadge(10, 44).includes('ui/levels/sm/10.webp') && !levelBadge(21, 44).includes('<img') && levelBadge(21, 44).includes('<b>21</b>'));

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\ncareer20: FAILED (${failed} of ${checks.length})` : `\ncareer20: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
