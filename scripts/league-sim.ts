// Alpha 1.9.0 — `npm run league:sim [players] [rounds]`: the PRIME LEAGUE balance model.
//
// A population of players with a hidden TRUE skill (Elo scale, mean 1000, sd 150) plays ranked duels through the
// SERVER's own rules (backend/pb_hooks/lib/league_math.js + league_rules.js): matchmaking by MMR within the windows,
// RP / MMR moves, floors, PRIME CHALLENGE (3 wins before 2 losses), PRIME TOKENS with the daily caps. A win is
// decided by the true skills (logistic). Deterministic (a fixed seed). Prints the table for docs/PRIME_LEAGUE_BALANCE.md.
// A MODEL, not the game: it says how the numbers behave, not how fun a fight is.

import { ROOT } from './lib/backendKit';
import { nodeModule, path, proc } from './lib/node';

const req = nodeModule.createRequire(path.join(ROOT, 'backend', 'pb_hooks', 'lib', 'x.js'));
const M = req('./league_math.js');
const R = JSON.parse(JSON.stringify(req('./league_rules.js')));
// variants for the owner's decision (the server keeps league_rules.js): LEAGUE_SIM_TARGET_FROM, LEAGUE_SIM_NEWCOMER_GAMES
if (proc.env.LEAGUE_SIM_TARGET_FROM) R.rp.targetFrom = Number(proc.env.LEAGUE_SIM_TARGET_FROM);
if (proc.env.LEAGUE_SIM_NEWCOMER_GAMES) R.rp.newcomerGames = Number(proc.env.LEAGUE_SIM_NEWCOMER_GAMES);
R._epoch = Date.parse(R.season.epoch);

let seed = 20261030;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

interface P {
  skill: number;
  rp: number;
  mmr: number;
  floor: number;
  games: number;
  wins: number;
  ch: { to: number; wins: number; losses: number } | null;
  reachedAt: Record<number, number>;
  tokens: number;
}

const N = Number(proc.argv[2] ?? 400);
const ROUNDS = Number(proc.argv[3] ?? 300);
const players: P[] = Array.from({ length: N }, () => ({ skill: 1000 + gauss() * 150, rp: 0, mmr: R.mmr.start, floor: 0, games: 0, wins: 0, ch: null, reachedAt: { 0: 0 }, tokens: 0 }));

function opponent(p: P): P {
  for (const w of R.matchmaking.window) {
    const pool = players.filter((q) => q !== p && Math.abs(q.mmr - p.mmr) <= w);
    if (pool.length) return pool[Math.floor(rnd() * pool.length)];
  }
  return players[Math.floor(rnd() * N)];
}

function play(p: P): void {
  const o = opponent(p);
  const win = rnd() < M.expected(p.skill, o.skill);
  const outcome = win ? 'win' : 'loss';
  const md = M.mmrDelta(p, o.mmr, outcome, 1, R);
  if (p.ch) {
    const s = M.challengeStep(p.ch, outcome, R);
    if (s.state === 'passed') {
      p.rp = R.ranks[s.to].base;
      p.floor = p.rp;
      p.ch = null;
    } else if (s.state === 'failed') {
      p.rp = Math.max(p.floor, R.ranks[s.to].base - R.challenge.failDrop);
      p.ch = null;
    } else p.ch = { to: s.to, wins: s.wins, losses: s.losses };
  } else {
    const a = M.applyRp(p.rp, p.floor, M.rpDelta(p, o.mmr, outcome, 1, R), R);
    p.rp = a.rp;
    p.floor = a.floor;
    if (a.challengeReady) p.ch = { to: M.rankIndex(a.rp, R) + 1, wins: 0, losses: 0 };
  }
  p.mmr += md;
  p.games++;
  if (win) p.wins++;
  p.tokens += win ? R.tokens.win : R.tokens.loss;
  const k = M.rankIndex(p.rp, R);
  if (p.reachedAt[k] === undefined) p.reachedAt[k] = p.games;
}

for (let r = 0; r < ROUNDS; r++) for (const p of players) play(p);

const groups: [string, (p: P) => boolean][] = [
  ['новичок (skill < 850)', (p) => p.skill < 850],
  ['средний (950–1050)', (p) => p.skill >= 950 && p.skill <= 1050],
  ['сильный (1150–1250)', (p) => p.skill >= 1150 && p.skill <= 1250],
  ['элита (> 1300)', (p) => p.skill > 1300],
];
const med = (a: number[]) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
console.log(`PRIME LEAGUE balance model: ${N} players × ${ROUNDS} ranked duels (seed 20261030; the server's league_math.js)\n`);
console.log('| игрок | n | RP (медиана) | ранг (медиана) | побед % | матчей до ПЕРВОГО ДУБЛЯ | до НОЧНОГО ЭФИРА | до ПРЕТЕНДЕНТА |');
console.log('|---|---|---|---|---|---|---|---|');
for (const [name, f] of groups) {
  const g = players.filter(f);
  const rp = med(g.map((p) => p.rp));
  const rk = M.rankOf(rp);
  const at = (i: number) => {
    const xs = g.map((p) => p.reachedAt[i]).filter((x) => x !== undefined);
    return xs.length ? `${med(xs)} (${Math.round((xs.length / g.length) * 100)}%)` : '—';
  };
  console.log(`| ${name} | ${g.length} | ${rp} | ${rk.ru} ${rk.division ?? ''} | ${Math.round((g.reduce((s, p) => s + p.wins, 0) / g.reduce((s, p) => s + p.games, 0)) * 100)} | ${at(1)} | ${at(2)} | ${at(3)} |`);
}
const dist: Record<string, number> = {};
for (const p of players) {
  const k = M.rankOf(p.rp).ru;
  dist[k] = (dist[k] || 0) + 1;
}
console.log('\nРаспределение по крупным рангам после ' + ROUNDS + ' матчей: ' + R.ranks.map((r: any) => `${r.ru} ${Math.round(((dist[r.ru] || 0) / N) * 100)}%`).join(' · '));
// drift: does RP grow with the number of matches alone? average player, RP at 100 vs 300 games
const avg = players.filter(groups[1][1]);
console.log(`Средний игрок: RP медиана ${med(avg.map((p) => p.rp))} после ${ROUNDS} матчей (RP следует за силой, а не за числом матчей — см. таблицу по раундам ниже)`);

// RP of the median average player over time (a fresh small run)
seed = 777;
const probe: P[] = Array.from({ length: N }, () => ({ skill: 1000 + gauss() * 150, rp: 0, mmr: R.mmr.start, floor: 0, games: 0, wins: 0, ch: null, reachedAt: { 0: 0 }, tokens: 0 }));
players.splice(0, players.length, ...probe);
const line: string[] = [];
for (let r = 1; r <= ROUNDS; r++) {
  for (const p of players) play(p);
  if (r === 25 || r === 50 || r === 100 || r === 200 || r === ROUNDS) line.push(`${r}: ${med(players.filter(groups[1][1]).map((p) => p.rp))}`);
}
console.log('Средний игрок, RP по числу матчей → ' + line.join(' · '));

// economy per day (caps from league_rules.js)
const perDay = (games: number, winRate: number, defWins: number) => Math.min(R.tokens.attackPerDay, Math.round(games * (winRate * R.tokens.win + (1 - winRate) * R.tokens.loss))) + Math.min(R.tokens.defensePerDay, defWins * R.tokens.defenseWin);
const maxFighter = Array.from({ length: R.upgrades.maxLevel }, (_, l) => M.upgradeCost(l)).reduce((a, b) => a + b, 0);
const track = R.track.reduce((s: number, t: any) => s + (t.tokens || 0), 0);
console.log(`\nPRIME TOKENS в день: 5 матчей, 50% побед, 2 победы защиты → ${perDay(5, 0.5, 2)}; 15 матчей, 60%, 5 защит → ${perDay(15, 0.6, 5)}; фармер (100 матчей, 100%, 50 защит) → ${perDay(100, 1, 50)} (потолки ${R.tokens.attackPerDay} + ${R.tokens.defensePerDay})`);
console.log(`Боец до уровня ${R.upgrades.maxLevel}: ${maxFighter} жетонов ≈ ${Math.round(maxFighter / perDay(5, 0.5, 2))} дней обычной игры (5 матчей/день) или ${Math.round(maxFighter / (R.tokens.attackPerDay + R.tokens.defensePerDay))} дней на потолке; дорожка сезона даёт ${track}`);
console.log(`Уровень 10 = +${Math.round(R.upgrades.hpPerLevel * R.upgrades.maxLevel * 100)}% HP и урона; разрыв уровней в подборе ≤ ${R.upgrades.maxGap} (≤ ${(R.upgrades.hpPerLevel * R.upgrades.maxGap * 100).toFixed(1)}%)`);
console.log(`Эфирные очки: 5 матчей/день, 50% → ${5 * (R.air.win + R.air.loss) / 2}/день; дорожка до ${R.track[R.track.length - 1].at} ≈ ${Math.round(R.track[R.track.length - 1].at / (5 * (R.air.win + R.air.loss) / 2))} дней (сезон ${R.season.lengthDays})`);
