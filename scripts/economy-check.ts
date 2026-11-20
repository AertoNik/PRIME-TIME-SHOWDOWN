// Alpha 1.9.6 — `npm run economy:check`: the economy's guard rails (scripts/lib/economyModel.ts on real measured fights).
//
// Fails when a later change makes a currency inflate, a reward arrive twice, the season track or the streak too fast or
// out of reach, the exchange too cheap or unreachable, the fight bundle change, or an earned item collide with a paid one.
// The thresholds are the design of docs/ALPHA_1_9_6_ECONOMY_IMPLEMENTATION_REPORT.md, revised by the owner's Beta 2.5.5
// brief (docs/BETA_2_5_5_ECONOMY_REPORT.md: every changed threshold, why, and its measured value) — change them only with
// such a report.
import { CAREER_START, REWARDS } from '../src/config/career';
import { PRICE_TIER, cardPrice, contractCost } from '../src/config/careerPrices';
import { CARDS } from '../src/config/cards';
import { FIGHTERS } from '../src/config/fighters';
import type { CardId, FighterId } from '../src/config/types';
import { COSMETICS, COSMETIC_ORDER, isServerEarned, type CosmeticId } from '../src/config/cosmetics.config';
import { DAILY } from '../src/config/daily.config';
import { LEAGUE } from '../src/config/league.config';
import { SHOP_ITEMS } from '../src/config/shop.config';
import { seasonOf } from '../src/config/seasonal';
import { SIM_VERSION } from '../src/league/simVersion';
import { ARCHETYPES, CAREER_25, DAILY_SERVER, careerSink, LEAGUE_195, type CareerVariant, honestPerHour, lossFarmPerHour, runCareer, runDaily, runLeague } from './lib/economyModel';
import { CareerSystem } from '../src/meta/CareerSystem';
import { defaultSave } from '../src/meta/SaveSystem';
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
// (1.9.6: the economy left the fight untouched, SIM_VERSION 76236bbb2e281ec4; 1.9.7 WINTER SHOWDOWN changes the fight on purpose)
check(`the game and the server carry one SIM_VERSION (${SIM_VERSION}; 1.9.7 changed it for CRAX and HOLIDAY BROADCAST)`, (SIM_VERSION as string) !== '76236bbb2e281ec4' && /^[0-9a-f]{16}$/.test(SIM_VERSION));
const fightCosts = (Object.keys(FIGHTERS) as FighterId[]).reduce((t, f) => t + (FIGHTERS[f].contract?.cost ?? 0), 0);
const fightPrices = (Object.keys(CARDS) as CardId[]).reduce((t, c) => t + (CARDS[c].shop?.price ?? 0), 0);
// (1.9.6: 6 000 $ contracts, 6 850 $ cards; Alpha 1.9.8 adds ACE's contract 1 850 $ and SHOWTIME 300 + MAGNET PULL 400 + SAFE CUT 350 $)
check('the BASE prices in the fight files are those of 1.9.6 plus the 1.9.8 additions (7 850 $ contracts, 7 900 $ cards) — the career prices them by tier on top', fightCosts === 6000 + 1850 && fightPrices === 6850 + 1050);
const sink = careerSink();
// (1.9.6: 29 050 $ for 5 contracts and 15 cards; 1.9.8: + ACE 5 900 $ + the three cards 1 900 $)
check(`the career's prices: ${sink.contracts} $ contracts + ${sink.cards} $ cards = ${sink.total} $ (Alpha 1.9.5: 12 850 $; 1.9.6: 29 050 $)`, sink.total === 29050 + 5900 + 1900 && sink.contractCount === 6 && sink.cardCount === 18);
check('a comfortable start: the first contract (500 $) and the five level-2 cards (250–300 $) cost what they did', contractCost('bruno') === 500 && (Object.keys(CARDS) as CardId[]).filter((c) => CARDS[c].shop?.level === 2).every((c) => cardPrice(c) === CARDS[c].shop!.price));
check('the price curve only rises with the unlock level (×1 → ×1.5 → ×2.2 → ×3.2), so a later item costs more than an earlier one', PRICE_TIER[2] === 1 && PRICE_TIER[2] < PRICE_TIER[3] && PRICE_TIER[3] < PRICE_TIER[4] && PRICE_TIER[4] < PRICE_TIER[5] && contractCost('nika') < contractCost('vega') && contractCost('vega') < contractCost('kai') && contractCost('kai') < contractCost('rina') && contractCost('rina') < contractCost('ace'));
// Beta 2.5.5 (the owner's brief «PROGRESSION, ECONOMY & PERFORMANCE»; docs/BETA_2_5_5_ECONOMY_REPORT.md): a fight pays
// about a quarter of Beta 2.5's dollars, a win clearly more than a loss; a regular player buys every contract and card in
// ~120–220 fights (Beta 2.5: 43–58), the first purchase still within a few fights; prices and reputation unchanged.
check('career rewards (Beta 2.5.5): purse 60/25/10, KO 12, rating ×0.3, combo 4 ×5, sponsors 0.25·√fans up to 35, the start 150 $; dollars by difficulty ×1 / ×1.3 / ×1.6 (1.9.6)', REWARDS.purse.win === 60 && REWARDS.purse.draw === 25 && REWARDS.purse.loss === 10 && REWARDS.koBonus === 12 && REWARDS.ratingMoney === 0.3 && REWARDS.comboMoney === 4 && REWARDS.comboCap === 5 && REWARDS.starPowerK === 0.25 && REWARDS.starPowerCap === 35 && CAREER_START.money === 150 && REWARDS.difficultyMoney?.rookie === 1 && REWARDS.difficultyMoney?.pro === 1.3 && REWARDS.difficultyMoney?.champion === 1.6);
const REP_25 = { win: 14, draw: 7, loss: 4 };
const REP_DIV_25 = 8;
const FANS_25 = { win: 220, draw: 120, loss: 70 };
check('reputation and fans of a fight are those of Beta 2.5 — only the dollars changed (the producer levels keep their pace)', JSON.stringify(REWARDS.rep) === JSON.stringify(REP_25) && REWARDS.repRatingDiv === REP_DIV_25 && JSON.stringify(REWARDS.fans) === JSON.stringify(FANS_25) && REWARDS.fansRatingBase === 0.35 && REWARDS.fansRatingK === 1.65);
const careerSamples = sampleFights(24);
// (Beta 2.5.5: a 365-day horizon — a career of ~175 fights takes a beginner of 3 short sessions a week ~4–5 months)
const YEAR = 365;
const career = (id: string, v: CareerVariant = { id: 'now', ru: '' }) => {
  const a = A(id);
  const dd = runDaily(a, YEAR).byDay;
  return runCareer(a, careerSamples, v, YEAR, (d) => dd[d] ?? 0);
};
const nb = career('newbie');
const rg = career('regular');
const ac = career('active');
const gr = career('grinder');
const nb0 = career('newbie', CAREER_25);
const rg0 = career('regular', CAREER_25);
check(`a beginner's first contract and first card come in the first fights as before (fights ${nb.at.firstContract} / ${nb.at.firstCard}; Beta 2.5: ${nb0.at.firstContract} / ${nb0.at.firstCard})`, (nb.at.firstContract ?? 99) <= 3 && (nb.at.firstCard ?? 99) <= 3 && nb.at.firstContract === nb0.at.firstContract);
check(`the owner's pace: a regular player buys every contract and card in 120–220 fights (${rg.at.everything}; Beta 2.5: ${rg0.at.everything}), and so does everyone else (beginner ${nb.at.everything}, active ${ac.at.everything}, most active ${gr.at.everything})`, [nb, rg, ac, gr].every((r) => (r.at.everything ?? 0) >= 120 && (r.at.everything ?? 999) <= 220));
// the longest saving: never longer than earning the dearest item with honest «Профи» wins alone (daily, goals and stages
// shorten it) — Beta 2.5.5 does not change a price, so the dearest contract sets how long the last save can be
const proWin = new CareerSystem({ data: defaultSave() } as never).computeRewards({ outcome: 'win', method: 'ko', rating: 87, combos: 6, perfects: 2, damageDealt: 0, damageTaken: 0, duration: 60, cardsUsed: 3 } as never, 'ray', 'pro').money;
const dearest = Math.max(...(Object.keys(FIGHTERS) as FighterId[]).map((f) => contractCost(f)), ...(Object.keys(CARDS) as CardId[]).map((c) => (CARDS[c].shop ? cardPrice(c) : 0)));
const gapCap = Math.ceil(dearest / proWin);
check(`a save for one item is never longer than earning the dearest one (${dearest} $) with «Профи» wins alone: at most ${Math.max(nb.maxGap, rg.maxGap, ac.maxGap)} fights between two purchases (≤ ${gapCap})`, nb.maxGap <= gapCap && rg.maxGap <= gapCap && ac.maxGap <= gapCap);
// (1.9.8: 24 purchases — 6 contracts, 18 cards; «the last 5» are the last five of them)
const nBuys = rg.buys.length;
check(`progress is felt from the start: the first purchase in fight ${rg.buys[0]}, the first 10 within the first tenth of the career (fight ${rg.buys[9]} of ${rg.at.everything}); the last 5 spread over ${rg.buys[nBuys - 1] - rg.buys[nBuys - 6]} fights`, nBuys === 24 && rg.buys[0] <= 3 && rg.buys[9] <= (rg.at.everything ?? 0) * 0.1 && rg.buys[nBuys - 1] - rg.buys[nBuys - 6] >= 10);
const slowNb = (nb.at.everything ?? 999) / (nb0.at.everything ?? 1);
const slowRg = (rg.at.everything ?? 999) / (rg0.at.everything ?? 1);
check(`a beginner is slowed down no more than a skilled player against Beta 2.5 (×${slowNb.toFixed(2)} vs ×${slowRg.toFixed(2)} fights to everything)`, slowNb <= slowRg);
check(`a beginner of 3 short sessions a week still has everything within half a year (day ${nb.day.everything}; Beta 2.5: day ${nb0.day.everything})`, (nb.day.everything ?? 999) <= 183);
{
  const cs = new CareerSystem({ data: defaultSave() } as never);
  const base = { method: 'ko', perfects: 1, damageDealt: 0, damageTaken: 0, duration: 70, cardsUsed: 3 };
  const w = cs.computeRewards({ ...base, outcome: 'win', rating: 75, combos: 2 } as never, 'ray', 'rookie').money;
  const l = cs.computeRewards({ ...base, outcome: 'loss', method: 'time', rating: 60, combos: 1 } as never, 'ray', 'rookie').money;
  check(`a win is clearly better than a loss for a beginner too: «Новичок» $${w} vs $${l} (≥ ×2.5), «Профи» win $${proWin}`, w >= 2.5 * l && l > 0);
}

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
  // Beta 2.5.5: the streak's dollars (the weekly gift, the milestones) are kept and the day's case pays twice as much,
  // while a fight pays about a quarter — so daily dollars weigh more than in 1.9.6 (≤ 15 % then). The owner wants the
  // day's case to advance the next purchase noticeably; the career stays the main income: for a player who plays most
  // days at most a quarter, for a beginner of 3 short sessions a week at most 40 % (docs/BETA_2_5_5_ECONOMY_REPORT.md).
  // Counted as production pays it: an ordinary day = the day's DAILY BROADCAST CASE (its expected dollars).
  for (const id of ['newbie', 'regular', 'active', 'grinder']) {
    const a = A(id);
    const dd = runDaily(a, 120, undefined, { cases: true }).byDay;
    const r = runCareer(a, samples, { id: 'x', ru: '' }, 120, (d) => dd[d] ?? 0);
    const total = r.earned.matches + r.earned.modes + r.earned.goals + r.earned.stages + r.earned.daily;
    const share = r.earned.daily / total;
    const cap = id === 'newbie' ? 0.4 : 0.25;
    check(`${a.ru}: daily dollars (streak + cases) help but never replace play — ${Math.round(share * 100)} % of 120 days' income (≤ ${Math.round(cap * 100)} %)`, share <= cap);
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
  // Beta 2.5.5 (the owner): no daily cap on the tokens of fights played to the end — a fight pays less instead (win 5,
  // was 6), skill over grind, and the exchange prices hold the most active players back (economy:255)
  check('no daily cap on the PRIME TOKENS of one\'s own fights (attackPerDay 0); the passive defence income keeps its cap (15 a day)', LEAGUE.tokens.attackPerDay === 0 && LEAGUE.tokens.defensePerDay === 15 && LEAGUE.tokens.defenseWin === 3);
  check(`skill over grind: a won fight pays ${LEAGUE.tokens.win} tokens, a lost one ${LEAGUE.tokens.loss} (≥ ×4); an hour of thrown fights earns ${f.tokens} tokens against ${h.tokens} of an honest hour (≤ 40 %, as for air points)`, LEAGUE.tokens.win >= 4 * LEAGUE.tokens.loss && f.tokens <= 0.4 * h.tokens && h.tokens > 0);
  const ex = LEAGUE.exchange;
  const cost = ex.reduce((t, x) => t + x.tokens, 0);
  const allDays = (cost / gr.tokens.total) * days;
  check(`no instant collection: even 35 fights a day (${gr.tokens.total} tokens a season) needs ${allDays.toFixed(0)} days for the whole exchange (≥ 4 weeks; Beta 2.5 with the cap: 36)`, allDays >= 28);
  check(`the exchange is a real sink: the cheapest item within one season of a regular player (${ex[0].tokens} ≤ ${reg.tokens.total}), all of it about one season of an active one (${cost} vs ${act.tokens.total})`, Math.min(...ex.map((x) => x.tokens)) <= reg.tokens.total && cost >= act.tokens.total * 0.8 && cost <= act.tokens.total * 1.6);
  check('exchange items: league-only ids, earned (server-proved), never paid, never PRIME SHOP goods', ex.every((x) => COSMETICS[x.item].source === 'league' && !COSMETICS[x.item].paid && isServerEarned(x.item) && !SHOP_ITEMS.some((s) => s.cosmetic === x.item)));
  check('the exchange gives looks only (cosmetic slots; no fighter, no card, no level)', ex.every((x) => ['cardStyle', 'broadcastFrame', 'dashFx', 'victoryFx', 'title'].includes(COSMETICS[x.item].slot)));
  // (Beta 2.5.5: the collection's «how to get it» names the exchange price — it must say what the server charges)
  check(`the collection tells the server's prices: ${ex.map((x) => `${x.item} ${x.tokens}`).join(', ')}`, ex.every((x) => (COSMETICS[x.item].howTo ?? '').replace(/\s/g, '').includes(`${x.tokens}PRIMETOKENS`)));
}

// ------------------------------------------------------------------ the currencies stay apart
console.log('\n— Валюты не смешиваются');
{
  const earned = COSMETIC_ORDER.filter((id) => isServerEarned(id as CosmeticId));
  const shopIds = new Set(SHOP_ITEMS.map((s) => s.cosmetic).filter(Boolean));
  // (1.9.7, the owner's task: after the event WINTER SHOWDOWN's four items go to PRIME SHOP like Halloween's — the same ids, sold only
  // after the season and once priced; the daily and league exclusives and the WINTER CHAMPION title are never sold)
  // (Beta 2.4: the seventh — INVITE SIGNAL, PRIME INVITE CASE's exclusive, proven by the account's opened case; never sold)
  check('earned items (daily + league + Beta 2.4 INVITE SIGNAL) are seven, (1.9.7) plus the five of WINTER SHOWDOWN confirmed by the season ledger — the daily / league / invite exclusives and the title never a PRIME SHOP item, the four winter items only as seasonal ones after the event; none paid', earned.filter((id) => !COSMETICS[id].serverSeason).length === 7 && earned.includes('dash_invite_signal') && !shopIds.has('dash_invite_signal') && earned.filter((id) => COSMETICS[id].serverSeason).length === 5 && earned.every((id) => !COSMETICS[id].paid && (COSMETICS[id].serverSeason && id !== 'title_winter_champion' ? !!seasonOf(SHOP_ITEMS.find((i) => i.cosmetic === id)!) : !shopIds.has(id))));
  check('dollars, PRIME TOKENS, seasonal tokens and roubles stay apart: the daily table pays dollars and items only, the exchange takes tokens only', DAILY.milestones.every((m) => typeof m.money === 'number') && LEAGUE.exchange.every((x) => Number.isInteger(x.tokens) && x.tokens > 0));
}

console.log(`\neconomy: ${failed ? 'FAILED' : 'OK'} (${passed} passed, ${failed} failed)`);
if (failed) proc.exitCode = 1;
