// Headless checks for Alpha 1.9.9 — CARD EVOLUTION, the career's quick-exit farm (npm run forfeit):
//   * a forfeit pays by the seconds really fought (REWARDS.forfeit): nothing in the first 15 s, then evenly up to the old
//     30 % of a loss at 60 s — dollars AND reputation; a fight fought to the end (won, drawn, lost) pays exactly as before;
//   * starting fights and giving up at once earns nothing, and giving up is never worth more per hour than fighting on;
//   * nothing new can be farmed or paid twice; earned money and saves are untouched; an unfinished fight is not applied.
// In-memory saves and real headless fights (the autopilot fights on its own — the producer only plays cards).
import { REWARDS } from '../src/config/career';
import { FIGHTERS, RIVAL_ORDER } from '../src/config/fighters';
import type { Difficulty, FighterId } from '../src/config/types';
import type { MatchResultData } from '../src/combat/types';
import { Match } from '../src/combat/Match';
import { CareerSystem, forfeitPart } from '../src/meta/CareerSystem';
import { EventManager } from '../src/meta/EventManager';
import { defaultSave, sanitize, type SaveData, type SaveSystem } from '../src/meta/SaveSystem';
import { DIFFICULTIES } from '../src/config/fighters';
import { fs, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;

class MemSave {
  data: SaveData = defaultSave();
  save(): void {
    this.data = sanitize(JSON.parse(JSON.stringify(this.data)));
  }
  get persistent(): boolean {
    return true;
  }
  reset(): void {
    this.data = defaultSave();
  }
}
const career = () => {
  const store = new MemSave();
  return Object.assign(new CareerSystem(store as unknown as SaveSystem), { mem: store });
};

/** The 1.9.8 reward formula (money, fans, reputation), copied verbatim — what a fought fight must still pay. */
function old198(r: MatchResultData, fans: number, diff: Difficulty, moneyMult = 1): { money: number; fans: number; rep: number } {
  const dm = DIFFICULTIES[diff].rewardMult;
  const dmm = REWARDS.difficultyMoney?.[diff] ?? dm;
  const key = r.outcome;
  let money = Math.round(REWARDS.purse[key] * dmm);
  if (r.method === 'ko' && key === 'win') money += Math.round(REWARDS.koBonus * dmm);
  money += Math.round(r.rating * REWARDS.ratingMoney * dmm);
  const combos = Math.min(REWARDS.comboCap, r.combos);
  if (combos > 0) money += combos * REWARDS.comboMoney;
  const star = Math.round(Math.min(REWARDS.starPowerCap, Math.sqrt(fans) * REWARDS.starPowerK));
  if (star > 0 && r.method !== 'forfeit') money += star;
  if (moneyMult !== 1 && r.method !== 'forfeit') money += Math.round(money * (moneyMult - 1));
  if (r.method === 'forfeit') money = Math.round(money * 0.3);
  const fanMult = REWARDS.fansRatingBase + (r.rating / 100) * REWARDS.fansRatingK;
  const gained = r.method === 'forfeit' ? 0 : Math.round(REWARDS.fans[key] * dm * fanMult);
  const rep = Math.max(0, Math.round(REWARDS.rep[key] * dm + r.rating / REWARDS.repRatingDiv) - (r.method === 'forfeit' ? 6 : 0));
  return { money, fans: gained, rep };
}
const result = (o: Partial<MatchResultData>): MatchResultData =>
  ({ outcome: 'loss', method: 'time', rating: 50, peakRating: 60, avgRating: 45, bestCombo: null, combos: 2, comboList: [], perfects: 0, damageDealt: 0, damageTaken: 0, duration: 90, ...o }) as MatchResultData;

// ================================================================ the rule
{
  const f = REWARDS.forfeit;
  check(`the rule: a forfeit pays nothing in the first ${f.freeS} s of fight, then evenly more up to the old ${Math.round(f.share * 100)} % of a loss at ${f.fullS} s`, f.share === 0.3 && f.freeS === 15 && f.fullS === 60);
  const parts = [0, 5, 15, 26.25, 37.5, 60, 95].map(forfeitPart);
  check(`forfeitPart: ${parts.map((x) => x.toFixed(2)).join(' / ')} at 0 / 5 / 15 / 26 / 38 / 60 / 95 s`, parts.join() === [0, 0, 0, 0.25, 0.5, 1, 1].join());
}

// ================================================================ fought fights pay as before
{
  const c = career();
  let same = 0;
  let total = 0;
  for (const diff of ['rookie', 'pro', 'champion'] as Difficulty[])
    for (const outcome of ['win', 'draw', 'loss'] as const)
      for (const method of ['ko', 'time'] as const)
        for (const rating of [8, 42, 77, 100])
          for (const combos of [0, 3, 9])
            for (const fans of [0, 900, 40000])
              for (const mm of [1, 1.5]) {
                c.mem.data.fighters.ray.fans = fans;
                const r = result({ outcome, method, rating, combos });
                const now = c.computeRewards(r, 'ray', diff, { moneyMult: mm });
                const was = old198(r, fans, diff, mm);
                total++;
                if (now.money === was.money && now.fans === was.fans && now.rep === was.rep) same++;
              }
  check(`a fight fought to the end pays exactly as in 1.9.8 — ${same} of ${total} cases (win / draw / loss, KO / time, every difficulty, ratings, combos, fame, mode bonus)`, same === total);
}

// ================================================================ forfeits
{
  const c = career();
  const at = (sec: number, diff: Difficulty = 'pro', rating = 12, combos = 0, mm = 1) => c.computeRewards(result({ method: 'forfeit', duration: sec, rating, combos }), 'ray', diff, { moneyMult: mm });
  const instant = (['rookie', 'pro', 'champion'] as Difficulty[]).map((d) => at(3, d));
  check(`an instant forfeit (3 s) pays nothing: $${instant.map((x) => x.money).join(' / ')}, reputation ${instant.map((x) => x.rep).join(' / ')}, fans ${instant.map((x) => x.fans).join(' / ')} (1.9.8 paid $${(['rookie', 'pro', 'champion'] as Difficulty[]).map((d) => old198(result({ method: 'forfeit', duration: 3, rating: 12 }), 0, d).money).join(' / ')} and +2 reputation on Pro)`, instant.every((x) => x.money === 0 && x.rep === 0 && x.fans === 0));
  check('…and says why on the results screen («Сдача в первые 15 с боя — без гонорара»)', instant[0].lines.some((l) => l.label === 'Сдача в первые 15 с боя' && l.note === 'без гонорара'));
  const late = at(75, 'champion', 61, 4);
  const lateOld = old198(result({ method: 'forfeit', duration: 75, rating: 61, combos: 4 }), 0, 'champion');
  check(`a forfeit after a real fight (75 s) pays as before: $${late.money} = $${lateOld.money}, reputation ${late.rep} = ${lateOld.rep}`, late.money === lateOld.money && late.rep === lateOld.rep && late.fans === 0);
  const ramp = [10, 20, 30, 40, 50, 60, 70].map((s) => at(s, 'champion', 40, 2).money);
  check(`in between it grows with the fight ($${ramp.join(' → ')}) and never above the old forfeit or a fought loss`, ramp.every((x, i) => i === 0 || x >= ramp[i - 1]) && ramp[0] === 0 && ramp[ramp.length - 1] === old198(result({ method: 'forfeit', duration: 70, rating: 40, combos: 2 }), 0, 'champion').money && Math.max(...ramp) < c.computeRewards(result({ outcome: 'loss', method: 'time', rating: 40, combos: 2 }), 'ray', 'champion').money);
  check('a mode bonus (PRIME CHALLENGE, BOSS FIGHT) never pays a forfeit, an early one pays nothing there either', at(4, 'pro', 30, 0, 1.5).money === 0 && at(90, 'pro', 30, 0, 1.5).money === at(90, 'pro', 30, 0, 1).money);
}

// ================================================ per hour: giving up is never a farm
{
  // real fights to the end (the autopilot fights; the producer plays nothing — the laziest honest loss there is)
  const c = career();
  const OVERHEAD_FIGHT = 35; // menus, intro and results between two fought fights (scripts/lib/economySamples.ts)
  const OVERHEAD_QUIT = 8; // the fastest restart: start, pause, «Сдаться», results — no intro waiting counted
  let honestMoney = 0;
  let honestSec = 0;
  let honestRep = 0;
  const quit: Record<number, { money: number; rep: number }> = {};
  const marks = [1, 5, 10, 15, 20, 30, 45, 60];
  for (let i = 0; i < 12; i++) {
    const fighter: FighterId = (['ray', 'bruno', 'nika', 'vega'] as FighterId[])[i % 4];
    const m = new Match({ fighter, deck: FIGHTERS[fighter].defaultDeck, rival: RIVAL_ORDER[i % 4], difficulty: 'pro', seed: 3100 + i * 977, fans: 500 });
    const quitAt: Record<number, MatchResultData> = {};
    let steps = 0;
    while (m.phase !== 'over' && steps < 60 * 400) {
      m.step(1 / 60);
      steps++;
      for (const s of marks)
        if (!quitAt[s] && m.phase === 'fight' && m.time >= s) {
          // what a forfeit at this second would have been: the same fight, given up here
          quitAt[s] = result({ method: 'forfeit', outcome: 'loss', duration: m.time, rating: Math.round(m.broadcast.finalRating() * 0.4), combos: m.fighters[0].m.combos });
        }
      m.drainEvents();
    }
    const r = m.result!;
    const pay = c.computeRewards(r, fighter, 'pro');
    honestMoney += pay.money;
    honestRep += pay.rep;
    honestSec += r.duration + OVERHEAD_FIGHT;
    for (const s of marks) {
      const q = quitAt[s] ? c.computeRewards(quitAt[s], fighter, 'pro') : { money: 0, rep: 0 };
      quit[s] = { money: (quit[s]?.money ?? 0) + q.money, rep: (quit[s]?.rep ?? 0) + q.rep };
    }
  }
  const honestHour = (honestMoney / honestSec) * 3600;
  const quitHour = marks.map((s) => ({ s, money: (quit[s].money / (12 * (s + OVERHEAD_QUIT))) * 3600, rep: (quit[s].rep / (12 * (s + OVERHEAD_QUIT))) * 3600 }));
  const best = quitHour.reduce((a, b) => (b.money > a.money ? b : a));
  // 1.9.8: an instant forfeit (1 s fought) paid 30 % of a loss — the farm the owner saw
  const old1 = old198(result({ method: 'forfeit', duration: 1, rating: 12 }), 0, 'pro').money;
  const oldHour = (old1 / (1 + OVERHEAD_QUIT)) * 3600;
  check(
    `fighting on (the autopilot alone) pays $${Math.round(honestHour)}/h; the best a quick-exit loop can do now is $${Math.round(best.money)}/h (giving up at ${best.s} s) — ${Math.round((best.money / honestHour) * 100)} % of it (1.9.8: $${Math.round(oldHour)}/h, ${(oldHour / honestHour).toFixed(1)}× fighting)`,
    best.money <= honestHour * 0.25 && oldHour > honestHour,
  );
  check(`the first ${REWARDS.forfeit.freeS} s give nothing at all ($${quitHour.filter((q) => q.s <= REWARDS.forfeit.freeS).map((q) => Math.round(q.money)).join(' / ')}/h, reputation ${quitHour.filter((q) => q.s <= REWARDS.forfeit.freeS).map((q) => Math.round(q.rep)).join(' / ')}/h)`, quitHour.filter((q) => q.s <= REWARDS.forfeit.freeS).every((q) => q.money === 0 && q.rep === 0));
  check(`producer levels: a quick-exit loop never beats fighting on (best ${Math.round(Math.max(...quitHour.map((q) => q.rep)))} vs ${Math.round((honestRep / honestSec) * 3600)} reputation an hour)`, Math.max(...quitHour.map((q) => q.rep)) <= ((honestRep / honestSec) * 3600) * 0.25);
}

// ======================================================= nothing else to farm or pay twice
{
  const game = read('src/game/Game.ts');
  check('a fight is paid once, only when it is over (finishMatch: m.result and the resultsShown guard) — a fight never finished (page closed, connection lost) pays nothing and costs nothing', game.includes('if (!m || !m.result || !this.matchMeta || this.resultsShown) return;') && game.includes('this.resultsShown = true;'));
  const e = new EventManager(new MemSave() as unknown as SaveSystem, { clock: () => Date.parse('2026-10-25T12:00:00Z'), settings: { mode: 'auto', forcedEventId: 'none' } });
  e.refresh();
  const ev = e.applyMatch('halloween-2026', result({ method: 'forfeit', duration: 2 }), 'pro');
  check('season tokens and quests never counted a forfeit (unchanged)', !ev || ev.tokens === 0);
  check('PRIME LEAGUE pays no career dollars (its forfeits are the server\'s, untouched)', game.includes("if (mode.kind === 'league') {") && !read('src/game/LeagueRuntime.ts').includes('career.applyMatch'));
  check('the pause dialog says what a forfeit pays right now (nothing in the first seconds, the share later)', game.includes('const part = forfeitPart(this.match?.time ?? 0);') && game.includes('сдача сейчас без гонорара'));
  check('no new save field (schema 12): money and progress already earned stay as they are', defaultSave().version === 12 && !('forfeit' in defaultSave()));
}

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\nforfeit: FAILED (${failed} of ${checks.length})` : `\nforfeit: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
