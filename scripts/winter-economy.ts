// Alpha 1.9.7 — `npm run winter:economy`: the CANDY CANES economy of WINTER SHOWDOWN 2026–2027 for four kinds of players,
// on REAL measured fights (scripts/lib/economySamples.ts) and with exactly the server's rules (src/season/seasonMath.ts,
// the event's caps, quests and prices from events.config.ts). A MODEL, not the game: who plays how much comes from
// scripts/lib/economyModel.ts ARCHETYPES (the same assumptions as the 1.9.6 economy report).
import { EVENTS, type EventDef } from '../src/config/events.config';
import { payCapped, careerLines, leagueCanes, questStep, type SeasonFight } from '../src/season/seasonMath';
import { ARCHETYPES, rng, type Archetype } from './lib/economyModel';
import { sampleFights, type FightSample } from './lib/economySamples';
import type { Difficulty } from '../src/config/types';
import { proc } from './lib/node';

const EV = EVENTS.find((e) => e.id === 'winter-2026') as EventDef;
const DAYS = Math.round((Date.parse(EV.end!) - Date.parse(EV.start!)) / 86400000);
const samples = sampleFights(24);

/** Which difficulty a player of this kind fights on (by the event day) and how often on the New Year set. */
function diffOf(a: Archetype, day: number, r: () => number): Difficulty {
  if (a.id === 'newbie') return day > 20 && r() < 0.3 ? 'pro' : 'rookie';
  if (a.id === 'regular') return r() < 0.7 ? 'pro' : 'rookie';
  if (a.id === 'active') return r() < 0.35 ? 'champion' : 'pro';
  return r() < 0.55 ? 'champion' : 'pro';
}
const HOLIDAY_SHARE = 0.4;

export interface WinterRun {
  id: string;
  ru: string;
  canes: number;
  fromCareer: number;
  fromLeague: number;
  fromQuests: number;
  questsDone: number;
  grandDay: number | null;
  craxDay: number | null;
  allDay: number | null;
  day1: number;
  day7: number;
  /** In-game days played. */
  played: number;
}

/** The server's rule (src/season/seasonMath.ts payCapped — what lib/season.js pays with). */
const capped = payCapped;

export function runWinter(a: Archetype, ev: EventDef = EV, seed = 1): WinterRun {
  const r = rng(seed * 7919 + a.id.length * 31);
  const er = ev.earnings!;
  const prog: Record<string, number> = {};
  const claimed = new Set<string>();
  let bal = 0;
  let fromCareer = 0;
  let fromLeague = 0;
  let fromQuests = 0;
  let grandDay: number | null = null;
  let craxDay: number | null = null;
  let allDay: number | null = null;
  let day1 = 0;
  let day7 = 0;
  let played = 0;
  // the player buys CRAX first, then the cosmetics from the cheapest
  const wishes = [...(ev.fighters ?? []).map((f) => ({ id: f.fighter, cost: f.cost })), ...ev.shop.map((s) => ({ id: s.cosmetic, cost: s.cost })).sort((x, y) => x.cost - y.cost)];
  const bought = new Set<string>();
  const count = (f: SeasonFight, paid: number) => {
    for (const q of ev.quests) {
      if ((prog[q.id] ?? 0) >= q.target) continue;
      prog[q.id] = Math.min(q.target, (prog[q.id] ?? 0) + questStep(q.metric, f, paid));
    }
  };
  for (let day = 1; day <= DAYS; day++) {
    const plays = a.week[(day - 1) % 7] === 1;
    if (plays) {
      played++;
      let dayCareer = 0;
      let dayLeague = 0;
      for (let k = 0; k < a.careerPerDay; k++) {
        const diff = diffOf(a, day, r);
        const pool: FightSample[] = samples[diff][a.skill];
        const s = pool[Math.floor(r() * pool.length)];
        const fight: SeasonFight = { source: 'career', outcome: s.outcome, method: s.method, rating: s.rating, combos: s.combos, ultra: 0, perfects: s.perfects, difficulty: diff, arena: r() < HOLIDAY_SHARE ? 'holiday' : 'original' };
        const sum = careerLines(er, fight).reduce((x, l) => x + l.value, 0);
        // (Beta 2.5.5: a cap of 0 = no daily cap, as the server's lib/season.js)
        const pay = capped(sum, er.dailyCap, dayCareer, er.overRate ?? 0);
        dayCareer += pay;
        bal += pay;
        fromCareer += pay;
        count(fight, pay);
      }
      for (let k = 0; k < a.leaguePerDay; k++) {
        const u = r();
        const outcome = u < a.leagueWin ? 'win' : u < a.leagueWin + 0.06 ? 'draw' : 'loss';
        const sum = leagueCanes(er, outcome);
        const pay = capped(sum, er.league?.dailyCap ?? 0, dayLeague, er.league?.overRate ?? 0);
        dayLeague += pay;
        bal += pay;
        fromLeague += pay;
        count({ source: 'league', outcome, method: 'time', rating: 60, combos: 1, ultra: 0, perfects: 0, difficulty: 'pro', arena: '' }, pay);
      }
      // quests are claimed at once when done (the server pays each once)
      for (const q of ev.quests) {
        if (!claimed.has(q.id) && (prog[q.id] ?? 0) >= q.target) {
          claimed.add(q.id);
          bal += q.reward;
          fromQuests += q.reward;
        }
      }
      if (grandDay === null && ev.grandPrize && claimed.size >= ev.grandPrize.questsNeeded) grandDay = day;
      for (const w of wishes) {
        if (bought.has(w.id) || bal < w.cost) continue;
        // in order: never a cosmetic before CRAX
        if (w !== wishes[0] && !bought.has(wishes[0].id)) break;
        bal -= w.cost;
        bought.add(w.id);
        if (w.id === wishes[0].id) craxDay = day;
      }
      if (allDay === null && bought.size === wishes.length) allDay = day;
    }
    if (day === 1) day1 = fromCareer + fromLeague + fromQuests;
    if (day === 7) day7 = fromCareer + fromLeague + fromQuests;
  }
  return { id: a.id, ru: a.ru, canes: fromCareer + fromLeague + fromQuests, fromCareer, fromLeague, fromQuests, questsDone: claimed.size, grandDay, craxDay, allDay, day1, day7, played };
}

/** The ceiling: every cap reached every day + every quest. */
export function ceiling(ev: EventDef = EV): number {
  return DAYS * (ev.earnings!.dailyCap + (ev.earnings!.league?.dailyCap ?? 0)) + ev.quests.reduce((x, q) => x + q.reward, 0);
}

const isMain = !!proc.argv[1]?.endsWith('winter-economy.ts');
if (isMain) {
  const shop = ev().shop.reduce((x, s) => x + s.cost, 0);
  const crax = ev().fighters![0].cost;
  console.log(`# WINTER SHOWDOWN — экономика карамельных тростей (${DAYS} дней, реальные бои: 24 на ячейку)\n`);
  console.log(`Цены: КРЭКС ${crax}, предметы ${ev().shop.map((s) => s.cost).join(' / ')} = ${shop}; всего ${crax + shop}. Задания: ${ev().quests.length} на ${ev().quests.reduce((x, q) => x + q.reward, 0)}. Полная оплата до дневных порогов каждый день + задания: ${ceiling()}${overNote()}.\n`);
  console.log('| игрок | дней в игре | трости: карьера + лига + задания = всего | к 1-му / 7-му дню | заданий | титул (день) | КРЭКС (день) | всё (день) |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const a of ARCHETYPES) {
    const w = runWinter(a);
    console.log(`| ${w.ru} | ${w.played} | ${w.fromCareer} + ${w.fromLeague} + ${w.fromQuests} = **${w.canes}** | ${w.day1} / ${w.day7} | ${w.questsDone}/${ev().quests.length} | ${w.grandDay ?? '—'} | ${w.craxDay ?? '—'} | ${w.allDay ?? '—'} |`);
  }
  // sensitivity: a beginner who comes a little more often (4 days a week, 5 career fights and 2 league duels)
  const plus: Archetype = { ...ARCHETYPES[0], ru: 'Новичок+ (4 дня в неделю × 5 боёв)', week: [1, 0, 1, 0, 1, 1, 0], careerPerDay: 5 };
  const wp = runWinter(plus);
  console.log(`| ${wp.ru} | ${wp.played} | ${wp.fromCareer} + ${wp.fromLeague} + ${wp.fromQuests} = **${wp.canes}** | ${wp.day1} / ${wp.day7} | ${wp.questsDone}/${ev().quests.length} | ${wp.grandDay ?? '—'} | ${wp.craxDay ?? '—'} | ${wp.allDay ?? '—'} |`);
  const h = EVENTS.find((e) => e.id === 'halloween-2026')!;
  const hd = Math.round((Date.parse(h.end!) - Date.parse(h.start!)) / 86400000);
  const hShop = h.shop.reduce((x, s) => x + s.cost, 0) + (h.fighters ?? []).reduce((x, f) => x + f.cost, 0);
  const hCeil = hd * h.earnings!.dailyCap + h.quests.reduce((x, q) => x + q.reward, 0);
  console.log(`\nДля сравнения Halloween Premiere 2026: ${hd} дней, обмен ${hShop} при потолке ${hCeil} (${Math.round((hShop / hCeil) * 100)} %); WINTER: ${crax + shop} при полной оплате до порогов ${ceiling()} (${Math.round(((crax + shop) / ceiling()) * 100)} %).`);
}

/** Beta 2.5.5: past the day's threshold a fight still pays a share (earnings.overRate) — no hard ceiling. */
function overNote(): string {
  const r = ev().earnings?.overRate ?? 0;
  return r ? ` (после порога бой платит ${Math.round(r * 100)} %, минимум 1 — жёсткого потолка нет)` : '';
}

function ev(): EventDef {
  return EV;
}
