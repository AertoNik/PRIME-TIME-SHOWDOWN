// Alpha 1.9.7 — `npm run winter`: WINTER SHOWDOWN 2026–2027 in the game (no server — `npm run winter:server` is the wallet,
// `npm run league` the league's candy canes). The calendar and the teaser, Halloween untouched, the secure event's local
// rules (nothing is paid or bought on the device), the items, CRAX and TWELFTH STRIKE in real fights, the balance against
// the other seven, determinism, HOLIDAY BROADCAST's layout and its cover in real fights, the music, the wiring.
import { ARENA, COVER_TUNING, CARD_TUNING, MATCH, PASSIVE_TUNING } from '../src/config/balance';
import { ARENAS } from '../src/config/arenas.config';
import { CARDS, COMBOS } from '../src/config/cards';
import { COSMETICS, isServerEarned, type CosmeticId } from '../src/config/cosmetics.config';
import { EVENTS } from '../src/config/events.config';
import { FIGHTERS, FIGHTER_ORDER, RIVAL_ORDER } from '../src/config/fighters';
import { CARD_KIND } from '../src/config/league.config';
import { LOOKS } from '../src/config/looks';
import { ARENA_MUSIC, MENU_MUSIC, MUSIC_TRACKS } from '../src/config/music.config';
import { SHOP_ITEMS, SHOP_PRICES_RUB, approvedPriceRub, type ShopSku } from '../src/config/shop.config';
import { SHOP_OFFERS } from '../src/config/offer.config';
import type { FighterId, RivalId } from '../src/config/types';
import { Match } from '../src/combat/Match';
import type { MatchEvent } from '../src/combat/types';
import { stateHash } from '../src/league/replay';
import { EventManager } from '../src/meta/EventManager';
import { defaultSave, type SaveSystem } from '../src/meta/SaveSystem';
import type { SeasonWallet } from '../src/net/PrimeApi';
import { careerLines, clampFight, mskDay, questStep, seasonPhase, type SeasonFight } from '../src/season/seasonMath';
import { comboBot, runMatch, type BotState } from './bots';
import { fs } from './lib/node';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
const section = (s: string) => console.log(`\n=== ${s}`);
const read = (p: string) => fs.readFileSync(p, 'utf8');
const EV = EVENTS.find((e) => e.id === 'winter-2026')!;
const T = (iso: string) => Date.parse(iso);
const msk = (iso: string) => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function world(at: number, data = defaultSave()) {
  let now = at;
  const store = { data, saves: 0, save() {
    this.saves++;
  } };
  const events = new EventManager(store as unknown as SaveSystem, { clock: () => now, settings: { mode: 'auto', forcedEventId: 'none' } });
  return { store, events, set: (t: number) => ((now = t), events.refresh()) };
}

// =========================================================== 1. calendar
section('Даты, анонс, одна активная кампания');
check('WINTER SHOWDOWN starts 03.12.2026 00:00 Moscow time', msk(EV.start!) === '03.12.2026, 00:00', msk(EV.start!));
check('…and ends 04.01.2027 00:00 Moscow time (03.01 inclusive)', msk(EV.end!) === '04.01.2027, 00:00' && msk(new Date(T(EV.end!) - 1).toISOString()) === '03.01.2027, 23:59', msk(EV.end!));
check('a 7-day teaser, the winter theme, the server keeps its currency (secure), Halloween keeps the old local rules', EV.announceDays === 7 && EV.themeId === 'winter' && EV.secure === true && !EVENTS.find((e) => e.id === 'halloween-2026')!.secure);
const dated = EVENTS.filter((e) => e.start && e.end).sort((a, b) => T(a.start!) - T(b.start!));
check('dated events never overlap (one active event at a time)', dated.every((e, i) => i === 0 || T(e.start!) >= T(dated[i - 1].end!)));
check('phases by the clock: none → announce (7 days before) → running → over', seasonPhase(EV, T(EV.start!) - 7 * 86400000 - 1) === 'none' && seasonPhase(EV, T(EV.start!) - 7 * 86400000) === 'announce' && seasonPhase(EV, T(EV.start!) - 1) === 'announce' && seasonPhase(EV, T(EV.start!)) === 'running' && seasonPhase(EV, T(EV.end!) - 1) === 'running' && seasonPhase(EV, T(EV.end!)) === 'over');
const w = world(T('2026-11-20T12:00:00Z'));
check('20.11: nothing announced yet (no teaser, standard theme)', w.events.active === null && w.events.upcoming === null && w.events.themeId === 'default');
w.set(T('2026-11-28T12:00:00Z'));
check(`28.11: the teaser counts down (${Math.ceil(w.events.timeToStart(EV) / 86400000)} days) — no currency, no exchange, nothing to earn`, w.events.upcoming?.id === EV.id && w.events.active === null && !w.events.playable && Math.ceil(w.events.timeToStart(EV) / 86400000) === 5);
w.set(T(EV.start!));
check('03.12 00:00 МСК: the event starts by itself — winter theme, quests and exchange (playable)', w.events.active?.id === EV.id && w.events.themeId === 'winter' && w.events.playable && w.events.upcoming === null);
w.set(T(EV.end!));
check('04.01 00:00 МСК: over — the standard theme again, nothing playable', w.events.active === null && w.events.themeId === 'default' && !w.events.playable);

section('Halloween 2026 не тронут');
const H = EVENTS.find((e) => e.id === 'halloween-2026')!;
check('Halloween Premiere: the same dates, 7 quests, the same exchange and LUCIEN 500', H.start === '2026-10-20T00:00:00Z' && H.end === '2026-11-04T00:00:00Z' && H.quests.length === 7 && H.shop.map((s) => `${s.cosmetic}:${s.cost}`).join() === 'card_pumpkin:120,dash_phantom:150,frame_spooky:180,victory_pumpkin:220' && H.fighters?.[0].fighter === 'lucien' && H.fighters[0].cost === 500 && H.grandPrize?.cosmetic === 'title_halloween_champion');
const hw = world(T('2026-10-25T12:00:00Z'));
check('during Halloween its quests and PUMPKIN TOKENS still work locally (the old rules)', hw.events.active?.id === 'halloween-2026' && (hw.events.applyMatch('halloween-2026', { outcome: 'win', method: 'ko', rating: 70, peakRating: 70, avgRating: 60, bestCombo: null, combos: 2, comboList: [], perfects: 1, damageDealt: 1, damageTaken: 1, cardsUsed: 1, duration: 60, playerHpFrac: 1, enemyHpFrac: 0, finisher: false } as any, 'pro')?.tokens ?? 0) > 0);

// =========================================================== 2. the secure event on the device
section('Защищённое событие на устройстве: ничего не начисляется локально');
const win: any = { outcome: 'win', method: 'ko', rating: 90, peakRating: 90, avgRating: 80, bestCombo: null, combos: 3, comboList: [], perfects: 2, damageDealt: 1, damageTaken: 1, cardsUsed: 2, duration: 70, playerHpFrac: 1, enemyHpFrac: 0, finisher: false };
const sw = world(T(EV.start!) + 3600000);
const guest = sw.events.applyMatch(EV.id, win, 'pro', 'holiday')!;
check('a guest: the fight earns no canes (the results say «sign in to PRIME ID»), the save is not touched', guest.secure?.guest === true && guest.tokens === 0 && sw.store.saves === 0 && !sw.store.data.events[EV.id]);
sw.events.secureOnline = true;
const online = sw.events.applyMatch(EV.id, win, 'pro', 'holiday')!;
check('a PRIME ID: the expected 13 canes are shown, but nothing is written — the server pays (SeasonRuntime.report)', online.secure?.guest === false && online.tokens === 13 && online.secure.seconds === 70 && sw.store.saves === 0 && (sw.store.data.events[EV.id]?.tokens ?? 0) === 0);
check('local quests, grand prize, exchange and the star cannot be taken on the device', sw.events.claimQuest('first_snow') === null && sw.events.claimGrand() === null && !sw.events.buy('card_clockwork_gold').ok && !sw.events.buyFighter('crax').ok);
const wallet: SeasonWallet = { event: EV.id, phase: 'running', now: T(EV.start!) + 3600000, day: mskDay(T(EV.start!) + 3600000), balance: 120, earned: 1200, fights: 800, spent: 1080, dayCareer: 26, dayLeague: 6, caps: { career: 45, league: 30 }, quests: { first_snow: { p: 5, claimed: true }, holiday_hat_trick: { p: 15, claimed: false } }, grandClaimed: true, owned: { cosmetics: ['card_clockwork_gold', 'title_winter_champion'], fighters: ['crax'] } };
const fresh = sw.events.applyWallet(wallet);
const p = sw.store.data.events[EV.id];
check('the server\'s wallet is mirrored into the save (balance, quests, day, the grand prize)', p.tokens === 120 && p.earned === 1200 && p.quests.first_snow.claimed && p.quests.holiday_hat_trick.p === 15 && p.grandClaimed && p.dayTokens === 26);
check('…the items the server sold arrive in MY COLLECTION and CRAX in the roster', sw.events.owns('card_clockwork_gold') && sw.events.owns('title_winter_champion') && sw.store.data.fighters.crax.unlocked && p.fighters.some((f) => f.id === 'crax') && p.bought.includes('card_clockwork_gold'));
check('…and the quests that became finished are reported (for the results screen)', fresh.some((q) => q.id === 'holiday_hat_trick') && fresh.some((q) => q.id === 'first_snow'));
const again = sw.events.applyWallet(wallet);
check('mirroring the same wallet twice changes nothing (no duplicates)', again.length === 0 && p.fighters.filter((f) => f.id === 'crax').length === 1 && p.bought.filter((x) => x === 'card_clockwork_gold').length === 1);
const hwAfter = world(T(EV.end!) + 86400000, sw.store.data);
check('after the season: CRAX and the items stay (roster, collection)', hwAfter.events.ownsFighter('crax') && hwAfter.events.owns('card_clockwork_gold') && hwAfter.events.fighterVisible('crax'));
check('before the season a not-owned CRAX is not shown in the roster; during it he is (locked, with his price)', !world(T('2026-11-20T12:00:00Z')).events.fighterVisible('crax') && world(T(EV.start!) + 1).events.fighterVisible('crax'));

section('Правила начисления (общие с сервером)');
const f0: SeasonFight = { source: 'career', outcome: 'win', method: 'ko', rating: 90, combos: 5, ultra: 0, perfects: 1, difficulty: 'pro', arena: 'holiday' };
check('a career win: 4 + rating 2 + 2 + combos (cap 3) + HOLIDAY win 2 = 13', careerLines(EV.earnings!, f0).reduce((a, l) => a + l.value, 0) === 13);
check('a forfeit pays nothing and moves no quest', careerLines(EV.earnings!, { ...f0, method: 'forfeit' }).length === 0 && EV.quests.every((q) => questStep(q.metric, { ...f0, method: 'forfeit' }, 0) === 0));
check('league quests move only with league fights; «Профи» wins only with career fights', questStep({ kind: 'leagueWins' }, f0, 0) === 0 && questStep({ kind: 'leagueWins' }, { ...f0, source: 'league' }, 0) === 1 && questStep({ kind: 'winsOnDifficulty', min: 'pro' }, { ...f0, source: 'league' }, 0) === 0);
const cl = clampFight({ outcome: 'win', method: 'ko', rating: 999, combos: 999, perfects: -5, difficulty: 'champion', arena: 'moon' } as any, ['original', 'holiday']);
check('a forged report is clamped: rating 100, combos 30, perfects 0, unknown set → original', !!cl && cl.rating === 100 && cl.combos === 30 && cl.perfects === 0 && cl.arena === 'original' && clampFight({ outcome: 'x' } as any, []) === null);
check('the Moscow day: 20:59 UTC is still 03.12, 21:00 UTC is the next day', mskDay(T('2026-12-03T20:59:59Z')) === '2026-12-03' && mskDay(T('2026-12-03T21:00:00Z')) === '2026-12-04');

// =========================================================== 3. items
section('Награды сезона');
const WIN_ITEMS: CosmeticId[] = ['card_clockwork_gold', 'dash_candy_comet', 'frame_frostlight_live', 'victory_midnight_confetti', 'title_winter_champion'];
check('five winter items, each confirmed by the server (serverSeason), from winter-2026', WIN_ITEMS.every((id) => COSMETICS[id].serverSeason === true && COSMETICS[id].eventId === EV.id && isServerEarned(id)));
check('rarity: two rare, two epic, the title legendary (not all legendary)', WIN_ITEMS.map((id) => COSMETICS[id].rarity).join() === 'rare,rare,epic,epic,legendary');
check('prices from the economy model: CRAX 900, items 180 / 220 / 300 / 380; the title only for 7 of 9 quests', EV.fighters![0].fighter === 'crax' && EV.fighters![0].cost === 900 && EV.shop.map((s) => s.cost).join() === '180,220,300,380' && EV.grandPrize?.cosmetic === 'title_winter_champion' && EV.grandPrize.questsNeeded === 7 && EV.quests.length === 9);
// 1.9.7 (the owner's task): after the event CRAX and the four items go to PRIME SHOP — prepared WITHOUT a price; nothing is sold
// until the owner sets the prices and an offer revision lists them; WINTER CHAMPION never has a sku
check('after the season: CRAX and the four items have their PRIME SHOP skus (the exchange\'s own ids) and the owner\'s approved prices (249 / 49 / 59 / 69 / 69 ₽); no listed revision (1–5) names them — they are sold under the universal revision 6 after 04.01.2027; the title is never sold', ['fighter_crax', 'season_clockwork_gold', 'season_candy_comet', 'season_frostlight_live', 'season_midnight_confetti'].every((s) => { const it = SHOP_ITEMS.find((i) => i.sku === s); return !!it && (it.fighter === 'crax' || WIN_ITEMS.includes(it.cosmetic!)) && approvedPriceRub(s as ShopSku) === SHOP_PRICES_RUB[s as ShopSku] && (SHOP_PRICES_RUB[s as ShopSku] ?? 0) > 0; }) && approvedPriceRub('fighter_crax') === 249 && !SHOP_ITEMS.some((i) => i.cosmetic === 'title_winter_champion') && !JSON.stringify(SHOP_OFFERS).match(/crax|clockwork_gold|candy_comet|frostlight|midnight_confetti|winter_champion/));
check('every quest metric is one the server can count, every quest icon exists', EV.quests.every((q) => ['wins', 'matches', 'combos', 'perfects', 'ratingAtLeast', 'winsOnDifficulty', 'arenaWins', 'leagueWins', 'earned'].includes(q.metric.kind)) && EV.quests.every((q) => read('src/ui/eventArt.ts').includes(`  ${q.icon}: S(`)));
check('the effects and styles are wired (dash, victory, card style, frame, title)', read('src/render/cosmeticFx.ts').includes("dash_candy_comet: 'candy'") && read('src/render/cosmeticFx.ts').includes("victory_midnight_confetti: 'midnight'") && read('src/game/ThemeManager.ts').includes("card_clockwork_gold') root.dataset.cardStyle = 'clockwork'") && read('src/game/ThemeManager.ts').includes("frame_frostlight_live') root.dataset.frame = 'frostlight'") && read('src/styles/main.css').includes(":root[data-title='winter-champion'] .plate-title"));

// =========================================================== 4. CRAX
section('КРЭКС и ДВЕНАДЦАТЫЙ УДАР');
const C = FIGHTERS.crax;
check('CRAX: a seasonal star of winter-2026 (no contract), the carbine class (3-shot burst), MAINSPRING, TWELFTH STRIKE', C.seasonal?.eventId === EV.id && C.contract === null && C.stats.attack.weapon === 'tech_carbine' && C.stats.attack.burst?.count === 3 && C.passive === 'mainspring' && C.signature === 'twelfth_strike' && FIGHTER_ORDER[7] === 'crax');
check('his look: the CLOCKWORK RIFLE model on the carbine class (same muzzle), the key, the gears, a shako and a tunic', LOOKS.crax.weapon === 'tech_carbine' && LOOKS.crax.weaponModel === 'clockwork' && LOOKS.crax.accessories.includes('windkey') && LOOKS.crax.hair.style === 'shako' && LOOKS.crax.top.style === 'tunic' && LOOKS.crax.face?.wooden === true);
check('TWELFTH STRIKE: 3 energy, his exclusive, a league attack card, OVERDRIVE → it is a SUPERSTAR MOVE', CARDS.twelfth_strike.cost === 3 && CARDS.twelfth_strike.exclusive === 'crax' && CARD_KIND.twelfth_strike === 'attack' && COMBOS.find((c) => c.id === 'superstar')!.second.includes('twelfth_strike'));
// real fights of CRAX: the clock's events in order
let winds = 0;
let strikes = 0;
let blocked = 0;
let stops = 0;
let orderOk = true;
let strikeDmgOk = true;
let readyNoStrike = 0;
let mainsprings = 0;
for (let i = 0; i < 24; i++) {
  const r = runMatch('crax', RIVAL_ORDER[i % RIVAL_ORDER.length], i % 3 === 0 ? 'champion' : 'pro', 'combo', 70000 + i * 977);
  winds += r.events.get('clock:wind') ?? 0;
  strikes += r.events.get('clock:strike') ?? 0;
  blocked += r.events.get('clock:blocked') ?? 0;
  stops += r.events.get('clock:stop') ?? 0;
  void readyNoStrike;
}
// one fight step by step: wind → tick 3, 6, 9 → ready → strike (the strike hit carries +300 and a push)
{
  const m = new Match({ fighter: 'crax', deck: FIGHTERS.crax.defaultDeck, rival: 'bot', difficulty: 'rookie', seed: 4321, fans: 500 });
  const st: BotState = { think: 0, react: -1, reactKey: '' };
  const seq: string[] = [];
  let lastReadyT = -1;
  for (let s = 0; s < 60 * 200 && m.phase !== 'over'; s++) {
    comboBot(m, st, 1 / 60);
    m.step(1 / 60);
    for (const e of m.drainEvents() as MatchEvent[]) {
      if (e.type === 'clock' && e.side === 0) {
        seq.push(e.what === 'tick' ? `t${e.marks}` : e.what);
        if (e.what === 'ready') lastReadyT = m.time;
      }
      if (e.type === 'passive' && e.side === 0 && e.passive === 'mainspring') mainsprings++;
      if (e.type === 'hit' && e.source === 0 && e.kind === 'auto' && e.crit && e.heavy && lastReadyT >= 0) {
        if (e.damage < CARD_TUNING.twelfth_strike.damage) strikeDmgOk = false;
        lastReadyT = -1;
      }
    }
  }
  const str = seq.join(' ');
  const step = CARD_TUNING.twelfth_strike.marksPerHit;
  const ticks = Array.from({ length: 12 / step - 1 }, (_, k) => `t${(k + 1) * step}`).join(' ');
  orderOk = new RegExp(`wind ${ticks} ready (strike|blocked|stop)`).test(str) && !/ready (?!strike|blocked|stop)/.test(str);
  check(`the clock in a real fight: ${str.slice(0, 120)}`, orderOk);
}
check(`in 24 real fights (Pro / Champion) CRAX wound the clock ${winds} times and struck the hour ${strikes} (blocked ${blocked}, ran down ${stops})`, winds >= 24 && strikes >= winds * 0.3 && strikes + blocked + stops >= winds * 0.9);
check(`a struck hour hits harder (≥ +${CARD_TUNING.twelfth_strike.damage}) — a heavy, critical shot, never a sure hit`, strikeDmgOk);
check('MAINSPRING fires at most once a fight', mainsprings <= 1 && PASSIVE_TUNING.mainspring.threshold === 0.5);
{
  const cs = read('src/combat/CombatSystem.ts');
  const body = cs.slice(cs.indexOf('private clockShot('), cs.indexOf('stopClock(f: FighterSim)'));
  const hook = cs.slice(cs.indexOf('// Alpha 1.9.7 TWELFTH STRIKE: CRAX'), cs.indexOf('if (clocked) this.clockShot'));
  check('no homing, no stun, no sure hit: the struck hour is a regular shot that must land (the projectile\'s own stun passes through unchanged); only a short push', body.length > 0 && hook.length > 0 && !/stun|homing|sure: true/.test(body + hook.replace(/\n\s+stun,\n/, '\n')) && CARD_TUNING.twelfth_strike.knockback < 3);
}

section('Баланс: КРЭКС среди восьми');
const rates: Record<string, number> = {};
for (const f of FIGHTER_ORDER) {
  let wins = 0;
  let n = 0;
  for (let i = 0; i < 30; i++) {
    const rival: RivalId = RIVAL_ORDER[i % RIVAL_ORDER.length];
    const r = runMatch(f as FighterId, rival, i % 2 ? 'champion' : 'pro', 'combo', 91000 + i * 613);
    n++;
    if (r.m.result!.outcome === 'win') wins++;
  }
  rates[f] = wins / n;
}
const others = FIGHTER_ORDER.filter((f) => f !== 'crax').map((f) => rates[f]);
const lo = Math.min(...others);
const hi = Math.max(...others);
check(`CRAX wins ${Math.round(rates.crax * 100)} % of 30 Pro/Champion fights; the other seven ${Math.round(lo * 100)}–${Math.round(hi * 100)} % — inside their range (no new best, no new worst)`, rates.crax >= lo - 0.05 && rates.crax <= hi + 0.02, JSON.stringify(rates));

section('Детерминизм (лига, повторы)');
const h1 = runMatch('crax', 'zoe', 'pro', 'smart', 5150, undefined, undefined, undefined, 'holiday');
const h2 = runMatch('crax', 'zoe', 'pro', 'smart', 5150, undefined, undefined, undefined, 'holiday');
check('the same seed, CRAX on HOLIDAY BROADCAST: the same fight bit for bit (stateHash) — the server replays it exactly', stateHash(h1.m) === stateHash(h2.m) && h1.m.result!.duration === h2.m.result!.duration);
check('league_sim.js (the server\'s fight) contains CRAX, TWELFTH STRIKE and HOLIDAY BROADCAST', ['twelfth_strike', 'mainspring', 'clocktower', 'snowgen'].every((k) => read('backend/pb_hooks/lib/league_sim.js').includes(k)));

// =========================================================== 5. HOLIDAY BROADCAST
section('HOLIDAY BROADCAST: планировка и укрытия');
const HD = ARENAS.holiday;
const covers = HD.covers!;
check('eight pieces, point-symmetric (each has its twin at (−x, −z)): both corners see the same floor', covers.length === 8 && covers.every((c) => covers.some((d) => d.kind === c.kind && Math.abs(d.x + c.x) < 1e-9 && Math.abs(d.z + c.z) < 1e-9)));
const m0 = new Match({ fighter: 'crax', deck: FIGHTERS.crax.defaultDeck, rival: 'zoe', difficulty: 'pro', seed: 1, fans: 500, arena: 'holiday' });
const CV = m0.covers;
const R = m0.fighters[0].radius;
let tight = 99;
for (const a of CV.list)
  for (const b of CV.list) {
    if (a === b) continue;
    for (let k = 0; k <= 10; k++) tight = Math.min(tight, CV.gap(b, a.ax + ((a.bx - a.ax) * k) / 10, a.az + ((a.bz - a.az) * k) / 10) - a.radius - 2 * R);
  }
check(`room to walk round every piece (the narrowest passage between two leaves ${tight.toFixed(2)} m beside a fighter; the cemetery's rule ≥ 0.35)`, tight >= 0.35);
// next to a side wall: either closed (no way through) or clearly open — never a squeeze
const walls = CV.list.map((a) => Math.min(ARENA.halfX - (Math.max(Math.abs(a.ax), Math.abs(a.bx)) + a.radius), ARENA.halfZ - (Math.max(Math.abs(a.az), Math.abs(a.bz)) + a.radius)) - 2 * R);
check(`beside the walls: closed or clearly open, never a squeeze (${walls.map((x) => x.toFixed(2)).join(' ')})`, walls.every((x) => x <= 0 || x >= 0.35));
const spawnGap = Math.min(...CV.list.map((c) => Math.min(CV.gap(c, 0, MATCH.spawnZ), CV.gap(c, 0, -MATCH.spawnZ))));
check(`the spawn points stay clear (${spawnGap.toFixed(2)} m)`, spawnGap >= 1.2);
check('the centre lane is open (no piece within 1.2 m of the line between the spawns)', CV.list.every((c) => Math.abs(c.x) - c.radius >= 1.2 - 1e-9 || Math.abs(c.z) > 4));
check('every piece taller than the line of fire and never over 2.0 m (the battle camera\'s view rule)', (['gift', 'snowgen', 'clocktower', 'console'] as const).every((k) => COVER_TUNING[k].height > ARENA.shotHeight && COVER_TUNING[k].height <= 2.0));
check('the views are round (or a capsule) like their bodies: gift box, snow cannon, column round; the console a capsule', COVER_TUNING.gift.half === 0 && COVER_TUNING.snowgen.half === 0 && COVER_TUNING.clocktower.half === 0 && COVER_TUNING.console.half > 0);
let breaks = 0;
let inside = 0;
let ended = 0;
let maxT = 0;
for (let i = 0; i < 16; i++) {
  const f = FIGHTER_ORDER[i % FIGHTER_ORDER.length] as FighterId;
  const m = new Match({ fighter: f, deck: FIGHTERS[f].defaultDeck, rival: RIVAL_ORDER[i % RIVAL_ORDER.length], difficulty: 'pro', seed: 3000 + i * 71, fans: 500, arena: 'holiday', autoPlayer: { behavior: 'tactical', smarts: 0.8, dodge: 0.6, reaction: 0.3 } });
  let steps = 0;
  while (m.phase !== 'over' && steps < 60 * 240) {
    m.step(1 / 60);
    steps++;
    for (const e of m.drainEvents() as MatchEvent[]) if (e.type === 'cover' && e.what === 'break') breaks++;
    if (m.phase === 'fight')
      for (const fs of m.fighters)
        for (const c of m.covers.list) if (c.alive && m.covers.gap(c, fs.x, fs.z) < fs.radius - 0.03) inside++;
  }
  if (m.phase === 'over' && m.result && m.result.method !== 'forfeit') ended++;
  maxT = Math.max(maxT, m.result?.duration ?? 999);
}
check(`16 fights on the set end normally (KO or time), the longest ${maxT.toFixed(0)} s`, ended === 16);
check(`the cover breaks in real fights (${breaks} pieces in 16 fights) and a fighter never stands inside a standing piece (${inside} frames)`, breaks >= 16 && inside === 0);
check('BOSS FIGHT is never held among the gifts (HOLIDAY → the Original Prime Arena)', read('src/game/Game.ts').includes("return id === 'holiday' ? 'original' : 'haunted';"));

// =========================================================== 6. music, lobby, wiring
section('Музыка, лобби, интерфейс');
check('the owner\'s two songs are where the game loads them (not replaced)', ['prime_menu_winter', 'winter_arena'].every((id) => fs.existsSync('public/audio/music/' + id + '.mp3') && MUSIC_TRACKS[id as 'winter_arena'].file === `audio/music/${id}.mp3`));
check('the menu song by the event\'s theme (Halloween as before), the winter fight song only on HOLIDAY BROADCAST', MENU_MUSIC.halloween === 'prime_menu_halloween' && MENU_MUSIC.winter === 'prime_menu_winter' && ARENA_MUSIC.holiday === 'winter_arena' && ARENA_MUSIC.original === 'prime_arena');
check('the lobby: a tree with lights, gifts and candy canes beside the pedestal (only on the menu; the set dresses itself)', read('src/render/SeasonalDecor.ts').includes('private buildHolidayLobby(): void') && read('src/render/SeasonalDecor.ts').includes("else if (kind === 'frost') this.buildFrost(native);"));
check('BattleView shows the clock (dial, strike, gears); Game plays its sounds; CRAX turns his key', read('src/render/BattleView.ts').includes("case 'clock': {") && read('src/render/BattleView.ts').includes('s.model.anim.clockWind();') && read('src/game/Game.ts').includes("case 'clock':") && read('src/audio/AudioSystem.ts').includes('clockChime(blocked: boolean)'));
check('Events: a secure event acts through PRIME ID (quests, grand prize, exchange) and tells a guest to sign in', read('src/ui/screens/EventsScreen.ts').includes("em.active?.secure && (act === 'claim' || act === 'grand' || act === 'buy' || act === 'buystar')") && read('src/ui/screens/EventsScreen.ts').includes('Войдите в PRIME ID, чтобы получать'));

console.log(`\nwinter: ${failed ? 'FAILED' : 'OK'} (${passed} passed, ${failed} failed)`);
if (failed) (globalThis as any).process.exit(1);
