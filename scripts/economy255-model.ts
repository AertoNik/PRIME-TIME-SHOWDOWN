// Beta 2.5.5 — `npm run economy:255 [shipped|all]`: the career dollars of the shipped config (or candidate variants) on the
// SAME measured fights and players as `npm run economy` (scripts/lib/economyModel.ts, economySamples.ts): dollars per
// fight, fights to the first / half / all purchases, the longest saving gap, the purchase curve, the win / loss ratio.
// Used to choose the Beta 2.5.5 values; with `shipped` it prints only the values the game ships with now.
import { REWARDS } from '../src/config/career';
import { CareerSystem } from '../src/meta/CareerSystem';
import { defaultSave } from '../src/meta/SaveSystem';
import { ARCHETYPES, LEAGUE_RULES, REWARDS_25, SURVIVAL_25, careerSink, caseMoneyEV, honestPerHour, lossFarmPerHour, runCareer, runDaily, runLeague, type CareerVariant, type LeagueVariant } from './lib/economyModel';
import { LEAGUE } from '../src/config/league.config';
import { sampleFights } from './lib/economySamples';
import { proc } from './lib/node';
import { EVENTS } from '../src/config/events.config';
import { runWinter } from './winter-economy';
import { CASES, type CaseOutcome } from '../src/config/cases.config';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DAYS = 365;
const k = (n: number) => Math.round(n).toLocaleString('ru-RU');
const fmt = (n: number | null) => (n === null ? '—' : String(n));
const samples = sampleFights(24);

/** Beta 2.5 as published — the «before» column whatever the config says now (economyModel CAREER_25). */
const BETA25 = REWARDS_25;
const CANDIDATES: Record<string, Partial<typeof REWARDS>> = {
  A: { purse: { win: 90, draw: 40, loss: 20 }, koBonus: 20, ratingMoney: 0.5, comboMoney: 8, starPowerK: 0.4, starPowerCap: 50 },
  B: { purse: { win: 80, draw: 35, loss: 15 }, koBonus: 20, ratingMoney: 0.4, comboMoney: 6, starPowerK: 0.35, starPowerCap: 45 },
  C: { purse: { win: 70, draw: 30, loss: 12 }, koBonus: 15, ratingMoney: 0.35, comboMoney: 5, starPowerK: 0.3, starPowerCap: 40 },
  D: { purse: { win: 60, draw: 25, loss: 10 }, koBonus: 12, ratingMoney: 0.3, comboMoney: 4, starPowerK: 0.25, starPowerCap: 35 },
};

/** Dollars of typical fights with these rewards (CareerSystem.computeRewards on the measured fight figures). */
function perFight(r: Partial<typeof REWARDS>) {
  const saved = { ...REWARDS };
  Object.assign(REWARDS, r);
  const cs = new CareerSystem({ data: defaultSave() } as any);
  const base = { method: 'ko', perfects: 2, damageDealt: 0, damageTaken: 0, duration: 60, cardsUsed: 3 };
  const win = cs.computeRewards({ ...base, outcome: 'win', rating: 87, combos: 6 } as any, 'ray', 'pro').money;
  const loss = cs.computeRewards({ ...base, outcome: 'loss', method: 'time', rating: 70, combos: 1 } as any, 'ray', 'pro').money;
  const newbieWin = cs.computeRewards({ ...base, outcome: 'win', rating: 80, combos: 1 } as any, 'ray', 'rookie').money;
  Object.assign(REWARDS, saved);
  return { win, loss, newbieWin };
}

function table(id: string, r: Partial<typeof REWARDS> | null, survival: CareerVariant['survival'] = undefined, cases = false): void {
  const v: CareerVariant = { id, ru: id, rewards: r ?? undefined, survival };
  const pf = perFight(r ?? {});
  const sk = careerSink();
  console.log(`\n### ${id}${r ? '' : ' (the config as shipped)'} — win on «Профи» ${pf.win} $, loss ${pf.loss} $ (×${(pf.win / pf.loss).toFixed(1)}), a beginner's rookie win ${pf.newbieWin} $; the career sells ${k(sk.total)} $\n`);
  console.log('| player | $ per career fight | first contract / card (fights) | half of all | everything (fights · day · hours) | longest saving, fights | income in 365 days: fights / modes / goals / stages / daily |');
  console.log('|---|---|---|---|---|---|---|');
  for (const a of ARCHETYPES) {
    const dd = runDaily(a, DAYS, undefined, { cases }).byDay;
    const run = runCareer(a, samples, v, DAYS, (d) => dd[d] ?? 0);
    const fights = run.matches || 1;
    console.log(`| ${a.ru} | ${k(run.earned.matches / fights)} | ${fmt(run.at.firstContract)} / ${fmt(run.at.firstCard)} | ${fmt(run.at.half)} | ${fmt(run.at.everything)} · д.${fmt(run.day.everything)}${run.hoursToEverything ? ` · ${run.hoursToEverything.toFixed(1)} ч` : ''} | ${run.maxGap} | ${[run.earned.matches, run.earned.modes, run.earned.goals, run.earned.stages, run.earned.daily].map(k).join(' / ')} |`);
  }
}

const mode = proc.argv[2] ?? 'all';
console.log(`# Beta 2.5.5 career model (${new Date().toISOString().slice(0, 10)}; ${DAYS} days; the measured fights of npm run economy)`);
table('Beta 2.5 (published)', BETA25, SURVIVAL_25);
if (mode === 'shipped') {
  table('Now in the config', null);
  // production pays an ordinary day of the streak as the day's DAILY BROADCAST CASE (PRIME_CASES on) — its expected dollars
  table('Now in the config, daily cases on (as production)', null, undefined, true);
}
else for (const [id, r] of Object.entries(CANDIDATES)) table(`candidate ${id}`, r);

// ------------------------------------------------------------------ PRIME LEAGUE tokens (a 42-day season)
const LEAGUE_V: Record<string, { v: LeagueVariant; exchange: number[] }> = {
  'Beta 2.5 (published)': { v: { id: 'b25', ru: '', tokens: { win: 6, draw: 2, loss: 1, attackPerDay: 60 } }, exchange: [500, 900, 1600] },
  'L1: 4/2/1, no daily cap, same prices': { v: { id: 'l1', ru: '', tokens: { win: 4, draw: 2, loss: 1, attackPerDay: 0 } }, exchange: [500, 900, 1600] },
  'L2: 4/2/1, no daily cap, prices ×1.6': { v: { id: 'l2', ru: '', tokens: { win: 4, draw: 2, loss: 1, attackPerDay: 0 } }, exchange: [800, 1450, 2550] },
  'L3: 5/2/1, no daily cap, prices ×1.8': { v: { id: 'l3', ru: '', tokens: { win: 5, draw: 2, loss: 1, attackPerDay: 0 } }, exchange: [900, 1600, 2900] },
};
if (mode === 'shipped') LEAGUE_V['Now in the config'] = { v: { id: 'now', ru: '' }, exchange: LEAGUE.exchange.map((x) => x.tokens) };
else LEAGUE_V['L4 (chosen): 5/2/1, no daily cap, 500 / 1300 / 2600'] = { v: { id: 'l4', ru: '', tokens: { win: 5, draw: 2, loss: 1, attackPerDay: 0 } }, exchange: [500, 1300, 2600] };
{
  console.log('\n## PRIME LEAGUE — PRIME TOKENS a season and seasons to the exchange (runLeague, 42 days)');
  for (const [name, { v, exchange }] of Object.entries(LEAGUE_V)) {
    console.log(`\n### ${name} — exchange ${exchange.join(' / ')} = ${exchange.reduce((a, b) => a + b, 0)}`);
    console.log('| player | tokens a season (fights + defence + CHALLENGE + track) | per play day | first item | first two | all three |');
    console.log('|---|---|---|---|---|---|');
    for (const a of ARCHETYPES) {
      const r = runLeague(a, v);
      const t = r.tokens.total;
      console.log(`| ${a.ru} | ${k(r.tokens.attack)} + ${k(r.tokens.defense)} + ${k(r.tokens.challenge)} + ${k(r.tokens.track)} = **${k(t)}** | ${k(r.perPlayDay)} | ${(exchange[0] / t).toFixed(1)} сез. | ${((exchange[0] + exchange[1]) / t).toFixed(1)} сез. | ${(exchange.reduce((x, y) => x + y, 0) / t).toFixed(1)} сез. |`);
    }
  }
  // an hour of thrown fights against an honest hour (tokens and air points; the server's startsPerHour)
  const lf = lossFarmPerHour(mode === 'shipped' ? { id: 'now', ru: '' } : LEAGUE_V['L4 (chosen): 5/2/1, no daily cap, 500 / 1300 / 2600'].v, 69);
  const hh = honestPerHour(mode === 'shipped' ? { id: 'now', ru: '' } : LEAGUE_V['L4 (chosen): 5/2/1, no daily cap, 500 / 1300 / 2600'].v);
  console.log(`\nAn hour of thrown fights (≈ 69 s each): ${lf.fights} fights → ${k(lf.tokens)} tokens, ${k(lf.air)} air; an honest hour (50 % wins): ${hh.fights} fights → ${k(hh.tokens)} tokens, ${k(hh.air)} air (${Math.round((lf.tokens / hh.tokens) * 100)} % / ${Math.round((lf.air / hh.air) * 100)} %).`);
  void LEAGUE_RULES;
}

// ------------------------------------------------------------------ WINTER SHOWDOWN canes (32 days)
{
  const base = EVENTS.find((e: any) => e.id === 'winter-2026') as any;
  const W: Record<string, any> = {
    'Beta 2.5 (published): caps 45 + 30 a day': { ...base.earnings, overRate: 0, league: { ...base.earnings.league, overRate: 0 } },
    'W1: no caps, win 3, rating 1+1, combo ≤2, holiday 1, league 4/2/1': { ...base.earnings, win: 3, rating: [[60, 1], [85, 1]], perCombo: 1, comboCap: 2, dailyCap: 0, arenaWin: { ...base.earnings.arenaWin, tokens: 1 }, league: { win: 4, draw: 2, loss: 1, dailyCap: 0 } },
    'W2: no caps, win 2, rating 1+1, combo ≤2, holiday 1, league 3/1/1': { ...base.earnings, win: 2, rating: [[60, 1], [85, 1]], perCombo: 1, comboCap: 2, dailyCap: 0, arenaWin: { ...base.earnings.arenaWin, tokens: 1 }, league: { win: 3, draw: 1, loss: 1, dailyCap: 0 } },
    'W3: same per fight; past 45 / 30 a day each fight still pays ¼ (≥ 1)': { ...base.earnings, overRate: 0.25, league: { ...base.earnings.league, overRate: 0.25 } },
    'W4: same per fight; past 45 / 30 a day each fight pays ⅕ (≥ 1)': { ...base.earnings, overRate: 0.2, league: { ...base.earnings.league, overRate: 0.2 } },
    'W5: same per fight; past 45 / 30 a day each fight pays ⅒ (≥ 1)': { ...base.earnings, overRate: 0.1, league: { ...base.earnings.league, overRate: 0.1 } },
  };
  if (mode === 'shipped') for (const key of Object.keys(W)) if (!key.startsWith('Beta 2.5')) delete W[key];
  if (mode === 'shipped') W['Now in the config'] = base.earnings;
  console.log(`\n## WINTER SHOWDOWN — candy canes (all items ${[...base.shop, ...base.fighters].reduce((x: number, i: any) => x + i.cost, 0)}, CRAX ${base.fighters[0].cost}, quests ${base.quests.reduce((x: number, q: any) => x + q.reward, 0)})`);
  for (const [name, earnings] of Object.entries(W)) {
    console.log(`\n### ${name}`);
    console.log('| player | days played | canes: career + league + quests | by day 7 | CRAX (day) | everything (day) |');
    console.log('|---|---|---|---|---|---|');
    for (const a of ARCHETYPES) {
      const w = runWinter(a, { ...base, earnings });
      console.log(`| ${a.ru} | ${w.played} | ${k(w.fromCareer)} + ${k(w.fromLeague)} + ${k(w.fromQuests)} = **${k(w.canes)}** | ${k(w.day7)} | ${fmt(w.craxDay)} | ${fmt(w.allDay)} |`);
    }
  }
}

// ------------------------------------------------------------------ CASES and the daily streak against the career
{
  // Beta 2.5 tables (dollars; the shares are the same as now) — the «before» column
  const OLD_DAILY = [
    { money: [80, 140], jackpot: 300 },
    { money: [90, 160], jackpot: 350 },
    { money: [110, 190], jackpot: 450 },
  ];
  const OLD_INVITE = { money: [400, 700], jackpot: 1500 };
  const withMoney = (table: CaseOutcome[], money: number[], jackpot: number): CaseOutcome[] =>
    table.map((o) => (o.kind !== 'money' ? o : o.min === o.max ? { ...o, min: jackpot, max: jackpot } : { ...o, min: money[0], max: money[1] }));
  const pf25 = perFight(BETA25);
  const pfNow = perFight({});
  console.log(`\n## Cases — expected DOLLARS of one case (the server's odds; reputation and tokens apart) in fights («Профи» win: Beta 2.5 ${pf25.win} $, now ${pfNow.win} $)`);
  console.log('| case | Beta 2.5 | in Beta 2.5 wins | now | in wins now |');
  console.log('|---|---|---|---|---|');
  CASES.daily.forEach((t, i) => {
    const before = caseMoneyEV(withMoney(t.table, OLD_DAILY[i].money, OLD_DAILY[i].jackpot));
    const now = caseMoneyEV(t.table);
    console.log(`| DAILY tier ${t.tier} (from streak day ${t.from}) | ${k(before)} $ | ${(before / pf25.win).toFixed(2)} | ${k(now)} $ | ${(now / pfNow.win).toFixed(2)} |`);
  });
  const invBefore = caseMoneyEV(withMoney(CASES.invite, OLD_INVITE.money, OLD_INVITE.jackpot));
  const invNow = caseMoneyEV(CASES.invite);
  console.log(`| PRIME INVITE | ${k(invBefore)} $ | ${(invBefore / pf25.win).toFixed(2)} | ${k(invNow)} $ | ${(invNow / pfNow.win).toFixed(2)} |`);

  console.log('\n### The daily streak with cases (production: an ordinary day = the day\'s case) — 120 days, share of all dollars');
  console.log('| player | daily dollars (streak + cases) | all dollars | daily share | Beta 2.5: daily share |');
  console.log('|---|---|---|---|---|');
  for (const a of ARCHETYPES) {
    const dd = runDaily(a, 120, undefined, { cases: true }).byDay;
    const now = runCareer(a, samples, { id: 'now', ru: '' }, 120, (d) => dd[d] ?? 0);
    // Beta 2.5: the same streak, an ordinary day = the Beta 2.5 case (exactly half the dollars of now's DAILY case)
    const plain = runDaily(a, 120).byDay;
    const b25 = plain.map((x, d) => (dd[d] !== x ? dd[d] / 2 : x));
    const before = runCareer(a, samples, { id: 'b25', ru: '', rewards: BETA25, survival: SURVIVAL_25 }, 120, (d) => b25[d] ?? 0);
    const tot = (r: typeof now) => r.earned.matches + r.earned.modes + r.earned.goals + r.earned.stages + r.earned.daily;
    console.log(`| ${a.ru} | ${k(now.earned.daily)} | ${k(tot(now))} | ${Math.round((now.earned.daily / tot(now)) * 100)} % | ${Math.round((before.earned.daily / tot(before)) * 100)} % |`);
  }
}
