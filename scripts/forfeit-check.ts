// Headless checks for the career's VOLUNTARY EXIT (npm run forfeit). Beta 2.5.5 (was Alpha 1.9.9's «pays by the seconds
// fought»): «Выйти из боя» is allowed at any second and is a technical loss that gives NOTHING — no dollars, fans or
// reputation, no record and so no goal, no season canes — whatever the second, the difficulty or the mode; the win
// streak ends. A fight played to its end pays as the career's rules say (a win clearly more than a loss). A fight never
// finished (the page closed, the connection lost) is not applied at all — no reward, no penalty. Nothing is farmed by
// leaving and starting again; no new save field; money already earned stays.
import { REWARDS } from '../src/config/career';
import type { MatchResultData } from '../src/combat/types';
import { CareerSystem } from '../src/meta/CareerSystem';
import { defaultSave, type SaveSystem } from '../src/meta/SaveSystem';
import { fs, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;

const fresh = () => {
  const store = { data: defaultSave(), save() {} } as unknown as SaveSystem;
  return { store, career: new CareerSystem(store) };
};
const result = (o: Partial<MatchResultData>): MatchResultData =>
  ({ outcome: 'loss', method: 'forfeit', rating: 72, combos: 4, perfects: 3, damageDealt: 300, damageTaken: 400, duration: 30, cardsUsed: 3, ...o }) as MatchResultData;

// ------------------------------------------------------------- the rule
const { career } = fresh();
const seconds = [0, 3, 14, 15, 16, 30, 60, 75, 120, 200];
const diffs = ['rookie', 'pro', 'champion'] as const;
const exits = seconds.flatMap((s) => diffs.map((d) => career.computeRewards(result({ duration: s }), 'ray', d)));
check(`an exit pays nothing at any second (${seconds.join(' / ')} s) on every difficulty: $0, 0 fans, 0 reputation (${exits.length} cases)`, exits.every((r) => r.money === 0 && r.fans === 0 && r.rep === 0));
const mode = career.computeRewards(result({ duration: 90 }), 'ray', 'pro', { moneyMult: 1.5, moneyLabel: 'BOSS FIGHT' });
check('…in PRIME CHALLENGE and BOSS FIGHT too (a mode bonus never pays an exit)', mode.money === 0 && mode.rep === 0 && mode.fans === 0);
check('the results screen says why: «Выход из боя — технический проигрыш» — без гонорара, фанатов и репутации', exits[0].lines.length === 1 && exits[0].lines[0].label.includes('технический проигрыш'));
check('REWARDS.forfeit is all zero (the rule in one place)', REWARDS.forfeit.money === 0 && REWARDS.forfeit.fans === 0 && REWARDS.forfeit.rep === 0);

// ------------------------------------------------------------- finishing always pays more
const win = career.computeRewards(result({ outcome: 'win', method: 'ko', rating: 87, combos: 6, duration: 70 }), 'ray', 'pro');
const loss = career.computeRewards(result({ outcome: 'loss', method: 'time', rating: 70, combos: 1, duration: 120 }), 'ray', 'pro');
check(`a fight fought to the end pays: a win $${win.money} (+${win.rep} ★), a loss $${loss.money} (+${loss.rep} ★) — a win is worth ≥ 2.5 losses`, win.money > 0 && loss.money > 0 && win.money >= 2.5 * loss.money && win.rep > loss.rep);
// an hour of leaving at once and starting again (a fight start + menus ≈ 10 s) against an hour of honest losses (~105 s)
const quitHour = Math.floor(3600 / 10) * career.computeRewards(result({ duration: 3 }), 'ray', 'pro').money;
const lossHour = Math.floor(3600 / 105) * loss.money;
check(`a quick-exit loop earns nothing in an hour ($${quitHour}, 0 ★) — even losing honestly pays ($${lossHour} an hour)`, quitHour === 0 && lossHour > 0);

// ------------------------------------------------------------- what an exit does to the save
{
  const { store, career: c } = fresh();
  const d = store.data;
  d.streak.current = 4;
  d.fighters.ray.streak = 4;
  const before = { money: d.money, rep: d.reputation, fans: d.fansEarned, best: d.bestRating, combos: d.bestCombosInMatch, perfects: d.bestPerfectsInMatch, goals: JSON.stringify(d.goals), wins: d.wins };
  c.applyMatch(result({ duration: 50, rating: 99, combos: 9, perfects: 9 }), 'ray', 'pro', d.nextRival);
  check('an exit adds no money, reputation or fans', d.money === before.money && d.reputation === before.rep && d.fansEarned === before.fans);
  check('…moves no record (rating 99, 9 combos, 9 perfects reached before leaving count for nothing) — so no goal either', d.bestRating === before.best && d.bestCombosInMatch === before.combos && d.bestPerfectsInMatch === before.perfects && JSON.stringify(d.goals) === before.goals);
  check('…is a technical loss: the losses count, the win streak ends (the producer\'s and the fighter\'s)', d.losses === 1 && d.wins === before.wins && d.streak.current === 0 && d.fighters.ray.streak === 0);
}

// ------------------------------------------------------------- the game around it
const game = read('src/game/Game.ts');
check('the pause offers «Выйти из боя» at any second — no «15 с» wait or message anywhere', game.includes('data-a="forfeit">Выйти из боя</button>') && !/15 с|freeS|forfeitPart/.test(game + read('src/meta/CareerSystem.ts') + read('src/config/career.ts').replace(/\/\/.*$|^\s*\*.*$/gm, '')));
check('the confirmation says it plainly before: a technical loss, nothing paid, finishing pays more', game.includes("this.confirm('Выйти из боя?', text, 'Выйти'") && game.includes('Без гонорара, фанатов, репутации и прогресса целей — выгоднее довести бой до конца.'));
check('a fight is paid once, only when it is over (finishMatch: the resultsShown guard) — a fight never finished (page closed, connection lost, Safari reloaded) is not applied: no reward, no penalty', /if \(m\.phase === 'over' && !this\.resultsShown\) this\.finishMatch\(\);/.test(game));
check('season canes and quests never count an exit (the server pays 0 for a forfeit)', /if \(fight\.method === 'forfeit'\) \{\s*out = \[200, \{ ok: true, paid: 0,/.test(read('backend/pb_hooks/lib/season.js')));
check('PRIME LEAGUE pays no career dollars (its exits are the server\'s, untouched)', game.includes("if (mode.kind === 'league') {"));
check('no new save field (schema 12): money and progress already earned stay as they are', defaultSave().version === 12 && !('forfeit' in defaultSave()));

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\nforfeit: FAILED (${failed} of ${checks.length})` : `\nforfeit: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
