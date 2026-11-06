// Alpha 1.9.6 — `npm run economy [variant…]`: the economy model's tables (docs/ALPHA_1_9_6_ECONOMY_IMPLEMENTATION_REPORT.md).
// Career dollars on real measured fights, the server's DAILY STREAK and PRIME LEAGUE tokens / air points for four kinds of
// players. Without arguments: the values the game ships with now. A MODEL, not the game (scripts/lib/economyModel.ts).
import { ARCHETYPES, CAREER_195, DAILY_195, DAILY_RULES, LEAGUE_195, LEAGUE_RULES, careerSink, honestPerHour, lossFarmPerHour, runCareer, runDaily, runLeague, type CareerVariant, type LeagueVariant } from './lib/economyModel';
import { sampleFights, SESSION_OVERHEAD_S } from './lib/economySamples';
import { runMatch } from './bots';
import { proc } from './lib/node';
import { RIVAL_ORDER } from '../src/config/fighters';

const DAYS = 120;
const fmt = (n: number | null) => (n === null ? '—' : String(n));
const k = (n: number) => n.toLocaleString('ru-RU');

const samples = sampleFights(24);

console.log(`# Модель экономики (${new Date().toISOString().slice(0, 10)}; реальные бои: 24 на ячейку, +${SESSION_OVERHEAD_S} с меню на бой)\n`);
console.log('## Измеренные бои карьеры (CareerSystem.computeRewards, фанатов 0)\n');
console.log('| сложность | игрок | побед | рейтинг | комбо | $ за бой | секунд |');
console.log('|---|---|---|---|---|---|---|');
for (const d of ['rookie', 'pro', 'champion'] as const)
  for (const s of ['mash', 'combo'] as const) {
    const xs = samples[d][s];
    const avg = (f: (x: (typeof xs)[number]) => number) => xs.reduce((a, x) => a + f(x), 0) / xs.length;
    const run = runCareer({ ...ARCHETYPES[1], skill: s }, samples, { id: 'x', ru: '' }, 0, () => 0);
    void run;
    console.log(`| ${d} | ${s === 'mash' ? 'новичок' : 'опытный'} | ${Math.round((xs.filter((x) => x.outcome === 'win').length / xs.length) * 100)} % | ${avg((x) => x.rating).toFixed(0)} | ${avg((x) => x.combos).toFixed(1)} | — | ${avg((x) => x.seconds).toFixed(0)} |`);
  }

export function careerTable(v: CareerVariant): void {
  const sk = careerSink(v.priceTier);
  console.log(`\n## Карьера — ${v.ru}\n`);
  console.log(`Траты карьеры: ${sk.contractCount} контрактов ${k(sk.contracts)} $ + ${sk.cardCount} карт ${k(sk.cards)} $ = ${k(sk.total)} $ (других трат у долларов нет).\n`);
  console.log('| игрок | боёв до 1-го контракта / 1-й карты | до половины трат | все контракты | все карты | всё (боёв · день · часов) | дольше всего копил, боёв | заработано к 7 / 14 / 30 / 90 дню | на руках к 90 дню | доля DAILY |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  const curves: string[] = [];
  for (const a of ARCHETYPES) {
    const dd = runDaily(a, DAYS).byDay;
    const r = runCareer(a, samples, v, DAYS, (d) => dd[d] ?? 0);
    const total = r.earned.matches + r.earned.modes + r.earned.goals + r.earned.stages + r.earned.daily;
    curves.push(`${a.ru}: ${r.buys.join(' · ')}`);
    console.log(`| ${a.ru} | ${fmt(r.at.firstContract)} / ${fmt(r.at.firstCard)} | ${fmt(r.at.half)} | ${fmt(r.at.allContracts)} | ${fmt(r.at.allCards)} | ${fmt(r.at.everything)} · д.${fmt(r.day.everything)}${r.hoursToEverything ? ` · ${r.hoursToEverything.toFixed(1)} ч` : ''} | ${r.maxGap} | ${[7, 14, 30, 90].map((d) => k(r.earnedBy[d] ?? 0)).join(' / ')} | ${k(r.money[90])} | ${Math.round((r.earned.daily / total) * 100)} % |`);
   }
  console.log('\nНа каком бою каждая покупка (20 предметов):');
  for (const c of curves) console.log(`- ${c}`);
}

export function dailyTable(rules = DAILY_RULES, label = 'как сейчас'): void {
  console.log(`\n## DAILY STREAK — ${label}\n`);
  console.log('| игрок | заходов за 120 дней | $ за 120 дней | лучшая серия | сбросов | день 7 / 14 / 30 / 60 / 100 |');
  console.log('|---|---|---|---|---|---|');
  for (const a of ARCHETYPES) {
    const r = runDaily(a, DAYS, rules);
    console.log(`| ${a.ru} | ${r.claims} | ${k(r.money)} | ${r.bestStreak} | ${r.resets} | ${[7, 14, 30, 60, 100].map((m) => fmt(r.milestoneDay[m] ?? null)).join(' / ')} |`);
  }
}

export function leagueTable(v: LeagueVariant): void {
  console.log(`\n## PRIME LEAGUE, сезон ${LEAGUE_RULES.season.lengthDays} дней — ${v.ru}\n`);
  console.log('| игрок | бои/день | жетоны: матчи + защита + CHALLENGE + дорожка = всего | в игровой день | эфирные очки | дорожка пройдена (день) |');
  console.log('|---|---|---|---|---|---|');
  for (const a of ARCHETYPES) {
    const r = runLeague(a, v);
    console.log(`| ${a.ru} | ${a.leaguePerDay} (${Math.round(a.leagueWin * 100)} %) | ${r.tokens.attack} + ${r.tokens.defense} + ${r.tokens.challenge} + ${r.tokens.track} = **${r.tokens.total}** | ${r.perPlayDay.toFixed(0)} | ${r.air} | ${fmt(r.trackDoneDay)} |`);
  }
  // intentional losses: the quickest KO loss of a player who does nothing (real fights)
  let lossS = 0;
  for (let i = 0; i < 8; i++) lossS += runMatch('ray', RIVAL_ORDER[i % RIVAL_ORDER.length], 'pro', 'idle', 500 + i).m.result!.duration;
  lossS /= 8;
  const f = lossFarmPerHour(v, lossS);
  const h = honestPerHour(v);
  console.log(`\nНамеренные поражения (бой без действий ≈ ${lossS.toFixed(0)} с): за час ${f.fights} боёв → ${f.air} эфирных очков, ${f.tokens} жетонов. Честный час (50 % побед): ${h.fights} боёв → ${h.air} очков, ${h.tokens} жетонов. Отношение очков: ${Math.round((f.air / h.air) * 100)} %.`);
}

const only = proc.argv.slice(2);
if (!only.length || only.includes('now')) {
  careerTable(CAREER_195);
  careerTable({ id: '196', ru: 'Alpha 1.9.6: прогрессивные цены + доллары по сложности ×1 / ×1,3 / ×1,6, спонсоры до 160' });
  dailyTable(DAILY_195, 'Alpha 1.9.5 (до): щит раз в 7 дней, сброс на день 1');
  dailyTable(DAILY_RULES, 'Alpha 1.9.6: пауза до 2 дней подряд, контрольные точки');
  leagueTable(LEAGUE_195);
  leagueTable({ id: '196', ru: 'Alpha 1.9.6' });
}
