// Beta 2.5 — ECONOMY AUDIT numbers (npm run economy:audit25): ANALYSIS ONLY, nothing in the game changes. Reads the live
// configs and the game's own formulas (CareerSystem.computeRewards, dailyReward, oddsOf / the server's case catalogue,
// LEAGUE, the WINTER SHOWDOWN event) and prints the tables of docs/BETA_2_5_ECONOMY_AUDIT.md that the older models
// (npm run economy, careerpace, winter:economy) do not cover: dollars per fight, the Beta 2.4 cases, the league's RP
// equilibrium and exchange, and the winter event under a falling income instead of daily caps (a scenario, not a plan).
import { CASES, dailyTierOf, oddsOf } from '../src/config/cases.config';
import { DAILY, dailyReward } from '../src/config/daily.config';
import { EVENTS } from '../src/config/events.config';
import { LEAGUE, RANKS } from '../src/config/league.config';
import { CareerSystem } from '../src/meta/CareerSystem';
import { defaultSave } from '../src/meta/SaveSystem';

/* eslint-disable @typescript-eslint/no-explicit-any */
const f0 = (n: number) => Math.round(n).toLocaleString('ru-RU');
const f1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ru-RU');
const out: string[] = [];
const p = (s = '') => out.push(s);

// ------------------------------------------------------------------ A. dollars per career fight
p('## A. Доллары за бой карьеры (CareerSystem.computeRewards)');
p('Показатели боя — из измеренных боёв `npm run economy` (рейтинг 80 / 87, комбо 0,6 / 5,6); проигрыш — рейтинг 70, 1 комбо.');
p('');
p('| исход | славы бойца | Новичок ×1 | Профи ×1,3 | Чемпион ×1,6 |');
p('|---|---|---|---|---|');
const diffs = ['rookie', 'pro', 'champion'] as const;
const row = (label: string, fans: number, r: any) => {
  const save = defaultSave();
  save.fighters.ray.fans = fans;
  const cs = new CareerSystem({ data: save } as any);
  const vals = diffs.map((d) => cs.computeRewards(r, 'ray', d).money);
  p(`| ${label} | ${f0(fans)} | ${vals.map(f0).join(' $ | ')} $ |`);
  return vals;
};
const winNew = { outcome: 'win', method: 'ko', rating: 80, combos: 1, perfects: 2, damageDealt: 0, damageTaken: 0, duration: 60, cardsUsed: 3 };
const winPro = { ...winNew, rating: 87, combos: 6 };
const loss = { ...winNew, outcome: 'loss', method: 'time', rating: 70, combos: 1 };
const money = {
  newWin: row('победа нокаутом, новичок', 0, winNew),
  proWin: row('победа нокаутом, опытный', 0, winPro),
  vetWin: row('победа нокаутом, опытный ветеран', 16000, winPro),
  newLoss: row('поражение по времени', 0, loss),
};
p('');

// ------------------------------------------------------------------ B. the Beta 2.4 cases
const mid = (o: any) => (o.min + o.max) / 2;
const ev = (table: any[], owned: string[], tokens: boolean) => {
  const odds = oddsOf(table, { owned, tokens });
  const r = { money: 0, rep: 0, tokens: 0, item: 0 };
  for (const x of odds) {
    const share = x.share / 10000;
    const o: any = x.outcome;
    if (o.kind === 'money') r.money += share * mid(o);
    else if (o.kind === 'rep') r.rep += share * mid(o);
    else if (o.kind === 'tokens') r.tokens += share * mid(o);
    else r.item += share;
  }
  return r;
};
p('## B. Средняя ценность кейсов (серверный каталог, oddsOf — те же исключения, что у сервера)');
p('');
p('| кейс | с PRIME TOKENS | $ | репутация | PRIME TOKENS | эксклюзив |');
p('|---|---|---|---|---|---|');
for (const tokens of [true, false]) {
  const e = ev(CASES.invite as any, [], tokens);
  p(`| PRIME INVITE CASE | ${tokens ? 'да' : 'нет'} | ${f1(e.money)} | ${f1(e.rep)} | ${f1(e.tokens)} | ${f1(e.item * 100)} % |`);
}
for (const t of CASES.daily as any[]) {
  for (const tokens of [true, false]) {
    const e = ev(t.table, [], tokens);
    p(`| DAILY, уровень ${t.tier} (с дня ${t.from}) | ${tokens ? 'да' : 'нет'} | ${f1(e.money)} | ${f1(e.rep)} | ${f1(e.tokens)} | — |`);
  }
}
p('');

// ------------------------------------------------------------------ C. the daily streak before / after the cases
p('## C. Ежедневная серия: доллары до кейсов (2.3) и после (2.4), игрок заходит каждый день');
p('Обычный день: доллары заменены кейсом; 7-й день недели и рубежи — их доллары + кейс.');
p('');
p('| дней подряд | $ до (2.3) | $ после (2.4), с лигой | репутация от кейсов | PRIME TOKENS от кейсов | $ после, без лиги |');
p('|---|---|---|---|---|---|');
for (const days of [7, 30, 60, 100]) {
  let before = 0;
  let after = 0;
  let afterNoLeague = 0;
  let rep = 0;
  let tok = 0;
  for (let d = 1; d <= days; d++) {
    const r = dailyReward(d);
    before += r.money;
    const kept = r.kind === 'daily' ? 0 : r.money;
    const t = dailyTierOf(d);
    const e = ev(t.table as any, [], true);
    const e0 = ev(t.table as any, [], false);
    after += kept + e.money;
    afterNoLeague += kept + e0.money;
    rep += e.rep;
    tok += e.tokens;
  }
  p(`| ${days} | ${f0(before)} | ${f0(after)} (${after >= before ? '+' : ''}${f0(((after - before) / before) * 100)} %) | ${f0(rep)} | ${f0(tok)} | ${f0(afterNoLeague)} |`);
}
p(`(Обычный день до кейсов давал ${DAILY.week.slice(0, 6).join(' / ')} $, в среднем ${f1(DAILY.week.slice(0, 6).reduce((s, x) => s + x, 0) / 6)} $.)`);
p('');

// ------------------------------------------------------------------ D. invitations
const inv = ev(CASES.invite as any, [], true);
const invOwned = ev(CASES.invite as any, ['dash_invite_signal'], true);
p('## D. Приглашения');
p(`Один подтверждённый друг = по кейсу обоим. Средний кейс: ${f0(inv.money)} $ + ${f0(inv.rep)} репутации + ${f0(inv.tokens)} PRIME TOKENS; INVITE SIGNAL — ${f1(inv.item * 100)} % на кейс, после получения — 0 (${f0(invOwned.money)} $ + ${f0(invOwned.rep)} реп. + ${f0(invOwned.tokens)} жетонов).`);
const chance = (n: number) => 1 - Math.pow(1 - inv.item, n);
p(`Шанс получить INVITE SIGNAL: за 1 кейс ${f1(chance(1) * 100)} %, за 5 — ${f1(chance(5) * 100)} %, за 10 — ${f1(chance(10) * 100)} %, за 25 — ${f1(chance(25) * 100)} % (с лигой; без лиги доля 5 %).`);
p(`Для сравнения: средний кейс ≈ ${f1(inv.money / money.proWin[1])} победы опытного игрока на «Профи» в долларах — приглашение не заменяет игру.`);
p('');

// ------------------------------------------------------------------ E. PRIME LEAGUE
p('## E. PRIME LEAGUE');
p(`RP за бой с равным: ±${LEAGUE.rp.base}, пределы победы ${LEAGUE.rp.winMin}–${LEAGUE.rp.winMax}, поражения ${LEAGUE.rp.lossMin}–${LEAGUE.rp.lossMax}; поправка к «своему» RP = (MMR − ${LEAGUE.rp.targetFrom}) × ${LEAGUE.rp.targetScale}, ×${LEAGUE.rp.catchUpMin}–${LEAGUE.rp.catchUpMax}; первые ${LEAGUE.rp.newcomerGames} боёв поражение −50 %. Новый сезон: RP × ${LEAGUE.season.rpCarry}.`);
p('');
p('| MMR (навык) | «свой» RP | ранг, к которому тянет | ');
p('|---|---|---|');
for (const mmr of [900, 1000, 1100, 1200, 1400, 1600, 1800, 2000, 2200]) {
  const target = (mmr - LEAGUE.rp.targetFrom) * LEAGUE.rp.targetScale;
  const rank = [...RANKS].reverse().find((r) => target >= r.base)!;
  p(`| ${mmr} | ${f0(target)} | ${rank.ru} |`);
}
p('');
p(`Жетоны: победа ${LEAGUE.tokens.win}, ничья ${LEAGUE.tokens.draw}, поражение ${LEAGUE.tokens.loss}, не больше ${LEAGUE.tokens.attackPerDay} в день за бои; защита ${LEAGUE.tokens.defenseWin} (≤ ${LEAGUE.tokens.defensePerDay} в день); CHALLENGE ${LEAGUE.tokens.challengeWin}.`);
const season = { 'Новичок': 191, 'Обычный': 969, 'Активный': 3108, 'Очень активный': 3550 } as Record<string, number>;
const ex = LEAGUE.exchange.map((x) => x.tokens);
p('');
p(`| игрок | жетонов за сезон (npm run economy) | ${LEAGUE.exchange.map((x) => `${x.item} (${x.tokens})`).join(' | ')} | все три (${ex.reduce((s, x) => s + x, 0)}) |`);
p(`|---|---|${LEAGUE.exchange.map(() => '---').join('|')}|---|`);
for (const [who, t] of Object.entries(season)) {
  let acc = 0;
  const cells = ex.map((c) => {
    acc += c;
    return `${f1(acc / t)} сез.`;
  });
  p(`| ${who} | ${f0(t)} | ${cells.join(' | ')} | ${f1(ex.reduce((s, x) => s + x, 0) / t)} сез. |`);
}
p('(Дорожка сезона даёт ещё ' + f0((LEAGUE as any).track.reduce((s: number, x: any) => s + (x.tokens ?? 0), 0)) + ' жетонов — уже включены в «за сезон».)');
p('');

// ------------------------------------------------------------------ F. WINTER SHOWDOWN: caps vs a falling income
const w: any = EVENTS.find((e: any) => e.id === 'winter-2026');
const days = Math.round((Date.parse(w.end) - Date.parse(w.start)) / 86400000);
const priceAll = w.shop.reduce((s: number, x: any) => s + x.cost, 0) + w.fighters.reduce((s: number, x: any) => s + x.cost, 0);
const quests = w.quests.reduce((s: number, q: any) => s + q.reward, 0);
p('## F. WINTER SHOWDOWN — лимиты сейчас и сценарий «убывающего дохода» (только расчёт)');
p(`Событие ${days} дн. (${w.start.slice(0, 10)} → ${w.end.slice(0, 10)} UTC), всё купить — ${f0(priceAll)} тростей, задания дают ${quests}. Карьера: победа ${w.earnings.win} + рейтинг до 4 + комбо до ${w.earnings.comboCap}, лимит ${w.earnings.dailyCap}/день; лига: ${w.earnings.league.win}/${w.earnings.league.draw}/${w.earnings.league.loss}, лимит ${w.earnings.league.dailyCap}/день.`);
p('Средние за бой: карьера 7,5 трости (измерено в модели 1.9.7: 1035 тростей за 138 боёв обычного игрока), лига 6·доля побед + 2·(1 − доля).');
p('Сценарии без лимита (каждый бой дня после N-го даёт меньше; карьера и лига отдельно): «мягкий» — бои 1–6 ×1, 7–12 ×0,5, 13–20 ×0,25, дальше ×0,1; «строгий» — 1–5 ×1, 6–8 ×0,5, 9–12 ×0,2, дальше ×0,05.');
p('');
p('| игрок | дней | карьера/день | лига/день (побед) | всего: сейчас / мягкий / строгий | всё куплено, день: сейчас / мягкий / строгий |');
p('|---|---|---|---|---|---|');
const profiles = [
  { who: 'Новичок', days: 14, career: 3, league: 2, win: 0.42 },
  { who: 'Обычный', days: 23, career: 6, league: 5, win: 0.5 },
  { who: 'Активный', days: 32, career: 12, league: 15, win: 0.55 },
  { who: 'Очень активный', days: 32, career: 30, league: 35, win: 0.6 },
];
const soft = (n: number) => (n <= 6 ? 1 : n <= 12 ? 0.5 : n <= 20 ? 0.25 : 0.1);
const strict = (n: number) => (n <= 5 ? 1 : n <= 8 ? 0.5 : n <= 12 ? 0.2 : 0.05);
for (const pr of profiles) {
  const lg = 6 * pr.win + 2 * (1 - pr.win);
  const capDay = Math.min(w.earnings.dailyCap, pr.career * 7.5) + Math.min(w.earnings.league.dailyCap, pr.league * lg);
  const perDay = (f: (n: number) => number) => {
    let x = 0;
    for (let i = 1; i <= pr.career; i++) x += 7.5 * f(i);
    for (let i = 1; i <= pr.league; i++) x += lg * f(i);
    return x;
  };
  const falling = perDay(soft);
  const hard = perDay(strict);
  const q = pr.days >= 20 ? quests : Math.round(quests * (pr.days / 23) * 0.6);
  const totalNow = capDay * pr.days + q;
  const totalFall = falling * pr.days + q;
  const totalStrict = hard * pr.days + q;
  const dayAll = (perDay: number) => {
    // quests spread evenly over the days the player plays
    const need = priceAll;
    for (let d = 1; d <= pr.days; d++) if (perDay * d + (q * d) / pr.days >= need) return String(Math.ceil((d / pr.days) * days));
    return '—';
  };
  p(`| ${pr.who} | ${pr.days} | ${pr.career} | ${pr.league} (${Math.round(pr.win * 100)} %) | ${f0(totalNow)} / ${f0(totalFall)} / ${f0(totalStrict)} | ${dayAll(capDay)} / ${dayAll(falling)} / ${dayAll(hard)} |`);
}
p('');
console.log(out.join('\n'));
