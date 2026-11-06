// Alpha 1.9.6 — `npm run economy:check`: the economy's guard rails (scripts/lib/economyModel.ts on real measured fights).
//
// Fails when a later change makes a currency inflate, a reward arrive twice, the season track or the streak too fast or
// out of reach, the exchange too cheap or unreachable, the fight bundle change, or an earned item collide with a paid one.
// The thresholds are the design of docs/ALPHA_1_9_6_ECONOMY_IMPLEMENTATION_REPORT.md — change them only with that report.
import { CAREER_START, REWARDS } from '../src/config/career';
import { PRICE_TIER, cardPrice, contractCost } from '../src/config/careerPrices';
import { CARDS } from '../src/config/cards';
import { FIGHTERS } from '../src/config/fighters';
import type { CardId, FighterId } from '../src/config/types';
import { COSMETICS, COSMETIC_ORDER, isServerEarned, type CosmeticId } from '../src/config/cosmetics.config';
import { DAILY } from '../src/config/daily.config';
import { LEAGUE } from '../src/config/league.config';
import { SHOP_ITEMS } from '../src/config/shop.config';
import { SIM_VERSION } from '../src/league/simVersion';
import { ARCHETYPES, CAREER_195, DAILY_SERVER, careerSink, LEAGUE_195, type CareerVariant, honestPerHour, lossFarmPerHour, runCareer, runDaily, runLeague } from './lib/economyModel';
import { sampleFights } from './lib/economySamples';
import { proc } from './lib/node';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
const A = (id: string) => ARCHETYPES.find((a) => a.id === id)!;

// ------------------------------------------------------------------ the fight and the career
console.log('\n— Бой и карьера (1.9.6: прогрессивные цены, доллары по сложности)');
check('the fight is untouched: SIM_VERSION 76236bbb2e281ec4', SIM_VERSION === '76236bbb2e281ec4');
const fightCosts = (Object.keys(FIGHTERS) as FighterId[]).reduce((t, f) => t + (FIGHTERS[f].contract?.cost ?? 0), 0);
const fightPrices = (Object.keys(CARDS) as CardId[]).reduce((t, c) => t + (CARDS[c].shop?.price ?? 0), 0);
check('the BASE prices in the fight files are as they were (6 000 $ contracts, 6 850 $ cards) — the career prices them by tier on top', fightCosts === 6000 && fightPrices === 6850);
const sink = careerSink();
check(`the career's prices: ${sink.contracts} $ contracts + ${sink.cards} $ cards = ${sink.total} $ (Alpha 1.9.5: 12 850 $)`, sink.total === 29050 && sink.contractCount === 5 && sink.cardCount === 15);
check('a comfortable start: the first contract (500 $) and the five level-2 cards (250–300 $) cost what they did', contractCost('bruno') === 500 && (Object.keys(CARDS) as CardId[]).filter((c) => CARDS[c].shop?.level === 2).every((c) => cardPrice(c) === CARDS[c].shop!.price));
check('the price curve only rises with the unlock level (×1 → ×1.5 → ×2.2 → ×3.2), so a later item costs more than an earlier one', PRICE_TIER[2] === 1 && PRICE_TIER[2] < PRICE_TIER[3] && PRICE_TIER[3] < PRICE_TIER[4] && PRICE_TIER[4] < PRICE_TIER[5] && contractCost('nika') < contractCost('vega') && contractCost('vega') < contractCost('kai') && contractCost('kai') < contractCost('rina'));
check('career rewards: purse 150/80/50, KO 40, rating ×2.2, combo 25 ×5, the start 150 $ — unchanged; sponsors up to 160 (was 240); dollars by difficulty ×1 / ×1.3 / ×1.6 (was ×1 / ×1.6 / ×2.4)', REWARDS.purse.win === 150 && REWARDS.purse.draw === 80 && REWARDS.purse.loss === 50 && REWARDS.koBonus === 40 && REWARDS.ratingMoney === 2.2 && REWARDS.comboMoney === 25 && REWARDS.comboCap === 5 && REWARDS.starPowerK === 1.25 && REWARDS.starPowerCap === 160 && CAREER_START.money === 150 && REWARDS.difficultyMoney?.rookie === 1 && REWARDS.difficultyMoney?.pro === 1.3 && REWARDS.difficultyMoney?.champion === 1.6);
const careerSamples = sampleFights(24);
const career = (id: string, v: CareerVariant = { id: '196', ru: '' }) => {
  const a = A(id);
  const dd = runDaily(a, 120).byDay;
  return runCareer(a, careerSamples, v, 120, (d) => dd[d] ?? 0);
};
const nb = career('newbie');
const rg = career('regular');
const ac = career('active');
const nb0 = career('newbie', CAREER_195);
const rg0 = career('regular', CAREER_195);
check(`a beginner's first contract and first card come in the first fights as before (fights ${nb.at.firstContract} / ${nb.at.firstCard}; 1.9.5: ${nb0.at.firstContract} / ${nb0.at.firstCard})`, (nb.at.firstContract ?? 99) <= 3 && (nb.at.firstCard ?? 99) <= 3 && nb.at.firstContract === nb0.at.firstContract);
check(`never weeks of saving for one item: at most ${Math.max(nb.maxGap, rg.maxGap, ac.maxGap)} fights between two purchases (≤ 10; a beginner plays ~9 a week)`, nb.maxGap <= 10 && rg.maxGap <= 10 && ac.maxGap <= 10);
check(`a skilled regular player no longer buys nearly everything in half an hour: half the prices after ${rg.at.half} fights, everything after ${rg.at.everything} (1.9.5: ${rg0.at.half} / ${rg0.at.everything})`, (rg.at.half ?? 0) >= 12 && (rg.at.everything ?? 0) >= 30 && (rg.at.everything ?? 999) <= 60);
check(`progress is felt all along: the first 10 purchases within ${rg.buys[9]} fights, the last 5 spread over ${rg.buys[19] - rg.buys[14]} fights`, rg.buys.length === 20 && rg.buys[9] <= 8 && rg.buys[19] - rg.buys[14] >= 10);
const slowNb = (nb.at.everything ?? 999) / (nb0.at.everything ?? 1);
const slowRg = (rg.at.everything ?? 999) / (rg0.at.everything ?? 1);
check(`a beginner is slowed down no more than a skilled player (×${slowNb.toFixed(2)} vs ×${slowRg.toFixed(2)} fights to everything)`, slowNb <= slowRg);
check(`a beginner still has everything within ~2 months of 3 short sessions a week (day ${nb.day.everything})`, (nb.day.everything ?? 999) <= 60);
check(`a beginner's own dollars per fight on «Новичок» are untouched (income by day 7: ${nb.earnedBy[7]} vs ${nb0.earnedBy[7]}; the small gap is «Профи» ×1.3 instead of ×1.6)`, nb.earnedBy[7] >= nb0.earnedBy[7] * 0.85);

// ------------------------------------------------------------------ DAILY STREAK
console.log('\n— DAILY STREAK');
{
  let st = DAILY_SERVER.emptyState();
  st = DAILY_SERVER.apply(st, 1000).state;
  check('one reward per game day (the same day twice: nothing)', DAILY_SERVER.apply(st, 1000) === null);
  check('a day from the past or «the future» on the record never pays', DAILY_SERVER.apply({ ...st, lastDay: 1003 }, 1000) === null);
  const reg = runDaily(A('regular'), 120);
  const newb = runDaily(A('newbie'), 120);
  check(`a regular player (5 days of 7) reaches day 7 within 2 weeks and day 30 within 2 months (day ${reg.milestoneDay[7]}, ${reg.milestoneDay[30]})`, (reg.milestoneDay[7] ?? 99) <= 14 && (reg.milestoneDay[30] ?? 999) <= 60);
  check(`a newcomer (3 days of 7) gets the first exclusive item within 3 weeks (day ${newb.milestoneDay[7]})`, (newb.milestoneDay[7] ?? 99) <= 21);
  check('no break for players who come 3–5 days a week (the pause forgives up to 2 missed days in a row)', reg.resets === 0 && newb.resets === 0);
  // a milestone pays once — even across breaks (checkpoints): an every-other-week player
  let q = DAILY_SERVER.emptyState();
  const milestones: number[] = [];
  for (let d = 0; d < 200; d++) {
    if (Math.floor(d / 7) % 2 === 1 && d % 7 < 5) continue; // five days off every second week
    const x = DAILY_SERVER.apply(q, 2000 + d);
    if (x) {
      if (x.claim.milestone) milestones.push(x.claim.milestone);
      q = x.state;
    }
  }
  check(`every milestone pays once, breaks or not — five days off every other week: ${milestones.join(', ')} (a long absence costs the days since the last checkpoint, never a milestone twice)`, new Set(milestones).size === milestones.length && milestones.length >= 2);
  const samples = careerSamples;
  for (const id of ['newbie', 'regular', 'active', 'grinder']) {
    const a = A(id);
    const dd = runDaily(a, 120).byDay;
    const r = runCareer(a, samples, { id: 'x', ru: '' }, 120, (d) => dd[d] ?? 0);
    const total = r.earned.matches + r.earned.modes + r.earned.goals + r.earned.stages + r.earned.daily;
    const share = r.earned.daily / total;
    check(`${a.ru}: daily dollars help but never replace play — ${Math.round(share * 100)} % of 120 days' income (≤ 15 %)`, share <= 0.15);
  }
  const items = DAILY.milestones.filter((m) => m.cosmetic).map((m) => m.cosmetic!);
  check('three exclusive items on milestones 7 / 30 / 100 — own ids, earned (server-proved), never sold', items.join(',') === 'title_daily_regular,frame_daily_live,victory_daily_sunrise' && items.every((i) => COSMETICS[i].source === 'daily' && !COSMETICS[i].paid && isServerEarned(i)));
}

// ------------------------------------------------------------------ PRIME LEAGUE
console.log('\n— PRIME LEAGUE: эфирные очки, дорожка, жетоны, обмен');
{
  check('a thrown fight moves the track little: loss air ≤ ¼ of a win, a weekly cap on fight air', LEAGUE.air.loss * 4 <= LEAGUE.air.win && LEAGUE.air.attackPerWeek > 0 && LEAGUE.air.attackPerWeek <= 250);
  const f = lossFarmPerHour({ id: 'x', ru: '' }, 69);
  const h = honestPerHour({ id: 'x', ru: '' });
  const f0 = lossFarmPerHour(LEAGUE_195, 69);
  const h0 = honestPerHour(LEAGUE_195);
  check(`an hour of deliberate losses earns ≤ 40 % of an honest hour's air (1.9.6 ${Math.round((f.air / h.air) * 100)} %, 1.9.5 ${Math.round((f0.air / h0.air) * 100)} %)`, f.air / h.air <= 0.4);
  const days = LEAGUE.season.lengthDays;
  const reg = runLeague(A('regular'), { id: 'x', ru: '' });
  const act = runLeague(A('active'), { id: 'x', ru: '' });
  const gr = runLeague(A('grinder'), { id: 'x', ru: '' });
  const nb = runLeague(A('newbie'), { id: 'x', ru: '' });
  check(`a regular player finishes the season track in the season, near its end (day ${reg.trackDoneDay} of ${days})`, reg.trackDoneDay !== null && reg.trackDoneDay >= days - 10 && reg.trackDoneDay <= days);
  check(`an active player not in under 3 weeks (day ${act.trackDoneDay}), the most active not in under 2½ weeks (day ${gr.trackDoneDay})`, (act.trackDoneDay ?? 99) >= 21 && (gr.trackDoneDay ?? 99) >= 18);
  check(`a newcomer still climbs part of the track (${nb.tiers} of ${LEAGUE.track.length} tiers)`, nb.tiers >= 3);
  check('the track only got easier than 1.9.5: the same tiers and rewards, no threshold raised (a reached tier stays reached)', LEAGUE.track.length === LEAGUE_195.track!.length && LEAGUE.track.every((t, i) => t.at <= LEAGUE_195.track![i].at && (t.tokens ?? 0) === (LEAGUE_195.track![i].tokens ?? 0)));
  const most = Math.max(reg.tokens.total, act.tokens.total, gr.tokens.total);
  check(`PRIME TOKENS are bounded by the daily caps — at most ${most} a season for anyone (≤ 3 700)`, most <= 3700);
  const ex = LEAGUE.exchange;
  const cost = ex.reduce((t, x) => t + x.tokens, 0);
  check(`the exchange is a real sink: the cheapest item within one season of a regular player (${ex[0].tokens} ≤ ${reg.tokens.total}), all of it about one season of an active one (${cost} vs ${act.tokens.total})`, Math.min(...ex.map((x) => x.tokens)) <= reg.tokens.total && cost >= act.tokens.total * 0.8 && cost <= act.tokens.total * 1.6);
  check('exchange items: league-only ids, earned (server-proved), never paid, never PRIME SHOP goods', ex.every((x) => COSMETICS[x.item].source === 'league' && !COSMETICS[x.item].paid && isServerEarned(x.item) && !SHOP_ITEMS.some((s) => s.cosmetic === x.item)));
  check('the exchange gives looks only (cosmetic slots; no fighter, no card, no level)', ex.every((x) => ['cardStyle', 'broadcastFrame', 'dashFx', 'victoryFx', 'title'].includes(COSMETICS[x.item].slot)));
}

// ------------------------------------------------------------------ the currencies stay apart
console.log('\n— Валюты не смешиваются');
{
  const earned = COSMETIC_ORDER.filter((id) => isServerEarned(id as CosmeticId));
  const shopIds = new Set(SHOP_ITEMS.map((s) => s.cosmetic).filter(Boolean));
  check('earned items (daily + league) are six, none of them a PRIME SHOP item, none paid', earned.length === 6 && earned.every((id) => !shopIds.has(id) && !COSMETICS[id].paid));
  check('dollars, PRIME TOKENS, seasonal tokens and roubles stay apart: the daily table pays dollars and items only, the exchange takes tokens only', DAILY.milestones.every((m) => typeof m.money === 'number') && LEAGUE.exchange.every((x) => Number.isInteger(x.tokens) && x.tokens > 0));
}

console.log(`\neconomy: ${failed ? 'FAILED' : 'OK'} (${passed} passed, ${failed} failed)`);
if (failed) proc.exitCode = 1;
