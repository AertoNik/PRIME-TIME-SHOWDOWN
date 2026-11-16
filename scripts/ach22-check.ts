// Headless checks for Beta 2.2 — MASTERY ACHIEVEMENTS (npm run ach22):
//   * four achievements on monotone numbers the career already keeps (no new mode, currency, item or tracking), each with
//     its exact condition, id, anti-farm rule and a reward on the scale of the career's «Цели сезона»;
//   * an old save that already met a condition shows it done at once; its reward is taken ONCE (save.achClaimed), never
//     before the condition, never twice — not after a reload (sanitize), not through a forged id;
//   * the earlier eight achievements, their rewards and every earlier claim are untouched;
//   * the server's save check knows the new field (rules generated from the config) and refuses an unknown id; an
//     older server keeps it as one of its tolerated unknown fields (forward compatibility);
//   * no picture of the owner exists for them: the game's drawing, listed in the report.
import { GOALS } from '../src/config/career';
import { MASTERY, MASTERY_IDS, careerRoster } from '../src/config/achievements.config';
import { Collection } from '../src/meta/Collection';
import { defaultSave, sanitize, type SaveData } from '../src/meta/SaveSystem';
import { achievementArtId } from '../src/ui/rewardArt';
import { ROOT } from './lib/backendKit';
import { fs, nodeModule, path, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;
const store = (d: SaveData) => ({ data: d, saves: 0, save() { this.saves++; } });

// ------------------------------------------------------------------ the definitions
check('four MASTERY achievements with fixed ids', MASTERY_IDS.join() === 'mastery-roster,mastery-combo,mastery-rating,mastery-champion');
check('the career roster is RAY and the six contract fighters (the seasonal stars are not part of it)', careerRoster().join() === 'ray,bruno,nika,vega,kai,rina,ace');
const goalMoney = GOALS.map((g) => g.reward.money);
const goalRep = GOALS.map((g) => g.reward.rep);
check('every reward is on the scale of the «Цели сезона» (money and ★ within their range)', MASTERY.every((m) => m.reward.money >= Math.min(...goalMoney) && m.reward.money <= Math.max(...goalMoney) && m.reward.rep >= Math.min(...goalRep) && m.reward.rep <= Math.max(...goalRep)));
check('each one names why it cannot be farmed', MASTERY.every((m) => m.antiFarm.length > 10));
// (Beta 2.2 final: the owner's last batch has «Комбо-шоу» and «Пять чемпионских эфиров»; the other two keep the drawing)
check('pictures only where the owner made one: mastery-combo / mastery-champion theirs, «Полный состав» / «Идеальный эфир» the game\'s drawing (no borrowed picture)', achievementArtId({ id: 'mastery-combo' }) === 'mastery_combo' && achievementArtId({ id: 'mastery-champion' }) === 'mastery_champion' && achievementArtId({ id: 'mastery-roster' }) === null && achievementArtId({ id: 'mastery-rating' }) === null);

// ------------------------------------------------------------------ conditions and claims
const fresh = defaultSave();
const c0 = new Collection(store(fresh) as never);
const a0 = c0.achievements();
check('a new career: 12 achievements (the 8 earlier + 4), none of the four done, nothing claimable', a0.length === 12 && a0.filter((a) => MASTERY_IDS.includes(a.id as never)).every((a) => !a.done && a.claim && !a.claim.claimed));
check('a reward is never taken before its condition', MASTERY_IDS.every((id) => c0.claimMastery(id) === null) && fresh.achClaimed.length === 0 && fresh.money === defaultSave().money);

const vet = defaultSave();
vet.bestCombosInMatch = 7;
vet.bestRating = 96;
vet.championWins = 5;
for (const f of careerRoster()) vet.fighters[f as keyof SaveData['fighters']].unlocked = true;
const before = { money: vet.money, rep: vet.reputation };
const st = store(vet);
const cv = new Collection(st as never);
check('an old save that already met the four conditions shows them done at once (nothing to replay)', cv.achievements().filter((a) => MASTERY_IDS.includes(a.id as never)).every((a) => a.done && !a.claim!.claimed));
const got = MASTERY_IDS.map((id) => cv.claimMastery(id));
const sumMoney = MASTERY.reduce((s, m) => s + m.reward.money, 0);
const sumRep = MASTERY.reduce((s, m) => s + m.reward.rep, 0);
check('each reward is paid once: money and ★ exactly their sum, the ids recorded, the save written', got.every((x) => !!x) && vet.money === before.money + sumMoney && vet.reputation === before.rep + sumRep && vet.achClaimed.join() === MASTERY_IDS.join() && st.saves === 4);
check('a second claim pays nothing', MASTERY_IDS.every((id) => cv.claimMastery(id) === null) && vet.money === before.money + sumMoney);
const reloaded = sanitize(JSON.parse(JSON.stringify(vet)));
check('after a reload (sanitize) the claims stay — still nothing to take again', reloaded.achClaimed.join() === MASTERY_IDS.join() && MASTERY_IDS.every((id) => new Collection(store(reloaded) as never).claimMastery(id) === null));
const forged = sanitize({ ...JSON.parse(JSON.stringify(defaultSave())), achClaimed: ['mastery-combo', 'mastery-combo', 'bogus', 42, 'career-star'] });
check('a forged or repeated id is dropped on load (only known MASTERY ids, each once)', forged.achClaimed.join() === 'mastery-combo');
const old = sanitize({ ...JSON.parse(JSON.stringify(defaultSave())), achClaimed: undefined });
check('a save from before Beta 2.2 loads with none claimed (the field appears empty)', Array.isArray(old.achClaimed) && old.achClaimed.length === 0);
const part = defaultSave();
part.bestCombosInMatch = 5;
part.championWins = 4;
const pv = new Collection(store(part) as never).achievements();
check('the progress is shown honestly below the goal (5 / 6 combos, 4 / 5 champion wins)', pv.find((a) => a.id === 'mastery-combo')?.note === 'Прогресс: 5 / 6' && pv.find((a) => a.id === 'mastery-champion')?.note === 'Прогресс: 4 / 5');
check('the earlier eight are untouched (ids, order, their rewards)', a0.slice(0, 8).map((a) => a.id).join() === 'boss-vale,survival-clear,challenge-energy_rush,challenge-high_stakes,challenge-spotlight,career-rising,career-star,career-legendary' && a0.slice(0, 8).every((a) => a.claim === undefined));

// ------------------------------------------------------------------ the server's save check
const req = nodeModule.createRequire(path.join(ROOT, 'backend', 'pb_hooks', 'lib', 'x.js'));
const V = req('./validate.js');
const R = req('./save_rules.js');
check('the server\'s rules list the four ids (generated from achievements.config.ts — npm run backend:rules)', JSON.stringify(R.mastery) === JSON.stringify(MASTERY_IDS));
const ok = V.checkSaveText(JSON.stringify(vet), {});
const bad = V.checkSaveText(JSON.stringify({ ...JSON.parse(JSON.stringify(vet)), achClaimed: ['mastery-bogus'] }), {});
check('the server accepts a save with achClaimed and refuses an unknown id in it', ok.ok === true && bad.ok === false && JSON.stringify(bad.problems).includes('achClaimed'));
check('the field is known to the server (not counted among the tolerated unknown ones); an older server tolerates up to 24 unknown fields', /'careerClaimed', 'achClaimed'/.test(read('backend/pb_hooks/lib/validate.js')) && /MAX_UNKNOWN_TOP_FIELDS = 24/.test(read('backend/pb_hooks/lib/validate.js')));
const cs = read('src/ui/screens/CollectionScreen.ts');
check('MY COLLECTION shows the reward and a «Забрать награду» button while it waits; the claim goes through Collection.claimMastery', /data-act="ach-claim"/.test(cs) && /claimMastery\(id\)/.test(cs));

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\nach22: FAILED (${failed} of ${checks.length})` : `\nach22: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
