// Alpha 1.9.6 — the ECONOMY MODEL of PRIME TIME: SHOWDOWN (career dollars, DAILY STREAK, PRIME LEAGUE tokens and air points).
//
// A MODEL, not the game: four kinds of players live day by day through the game's own numbers. Career fights are the
// REAL measured fights of scripts/lib/economySamples.ts (paid by CareerSystem.computeRewards); the daily streak and the
// league use the SERVER's own rules (backend/pb_hooks/lib/daily.js, league_math.js with daily_rules.js / league_rules.js).
// Every assumption that is not the game's own number is written next to it (ASSUMPTIONS below and in the report).
// Deterministic: fixed seeds, the same tables on every run (scripts/economy-model.ts prints them, economy-check.ts asserts).
import { nodeModule, path } from './node';
import { ROOT } from './backendKit';
import { CAREER_STAGES, GOALS, LEVEL_THRESHOLDS, REWARDS } from '../../src/config/career';
import { CARDS } from '../../src/config/cards';
import { PRICE_TIER, cardPrice, contractCost } from '../../src/config/careerPrices';
import { FIGHTERS } from '../../src/config/fighters';
import { BOSSES } from '../../src/config/boss.config';
import { SURVIVAL, CHALLENGES } from '../../src/config/modes.config';
import type { CardId, Difficulty, FighterId } from '../../src/config/types';
import { CareerSystem } from '../../src/meta/CareerSystem';
import type { SaveSystem } from '../../src/meta/SaveSystem';
import { MemSave, SESSION_OVERHEAD_S, type FightSample, type Skill } from './economySamples';

const req = nodeModule.createRequire(path.join(ROOT, 'backend', 'pb_hooks', 'lib', 'x.js'));
const LIB = './';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DAILY_SERVER: any = req(LIB + 'daily.js');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DAILY_RULES: any = req(LIB + 'daily_rules.js');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const LEAGUE_RULES: any = req(LIB + 'league_rules.js');

// ------------------------------------------------------------------------------------------------ the players
export interface Archetype {
  id: 'newbie' | 'regular' | 'active' | 'grinder';
  ru: string;
  /** Which days of each week the player comes (1 = plays): the same mask every week. */
  week: number[];
  careerPerDay: number;
  skill: Skill;
  /** PRIME LEAGUE duels per play day, the share won (matchmaking by MMR keeps it near 50 % — a better player sits higher). */
  leaguePerDay: number;
  leagueWin: number;
  /** Won defences per play day (other players attacking this player's Defense Studio). */
  defenseWins: number;
  /** PRIME CHALLENGEs passed in a 42-day season (from `npm run league:sim`: average → НОЧНОЙ ЭФИР, strong → ПРЕТЕНДЕНТ…). */
  challenges: number;
}

/** ASSUMPTIONS — who plays how much (the only invented numbers of the model; the report shows them). */
export const ARCHETYPES: Archetype[] = [
  { id: 'newbie', ru: 'Новичок', week: [1, 0, 1, 0, 0, 1, 0], careerPerDay: 3, skill: 'mash', leaguePerDay: 2, leagueWin: 0.42, defenseWins: 0.3, challenges: 0 },
  { id: 'regular', ru: 'Обычный', week: [1, 1, 0, 1, 1, 1, 0], careerPerDay: 6, skill: 'combo', leaguePerDay: 5, leagueWin: 0.5, defenseWins: 1.5, challenges: 1 },
  { id: 'active', ru: 'Активный', week: [1, 1, 1, 1, 1, 1, 1], careerPerDay: 12, skill: 'combo', leaguePerDay: 15, leagueWin: 0.55, defenseWins: 4, challenges: 2 },
  { id: 'grinder', ru: 'Очень активный', week: [1, 1, 1, 1, 1, 1, 1], careerPerDay: 30, skill: 'combo', leaguePerDay: 35, leagueWin: 0.6, defenseWins: 8, challenges: 3 },
];

/** A tiny deterministic generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------------ career
export interface CareerVariant {
  id: string;
  ru: string;
  /** Overrides of REWARDS (src/config/career.ts) for this run — the shipped values when empty. */
  rewards?: Partial<typeof REWARDS>;
  /** Overrides of the price curve (src/config/careerPrices.ts PRICE_TIER) — `{ 2: 1, 3: 1, 4: 1, 5: 1 }` = Alpha 1.9.5. */
  priceTier?: Record<number, number>;
}

/** Alpha 1.9.5: every career item at its base price (no tiers). */
export const PRICES_195: Record<number, number> = { 2: 1, 3: 1, 4: 1, 5: 1 };
/** The whole career of Alpha 1.9.5: base prices, fight dollars ×1 / ×1.6 / ×2.4 by difficulty, sponsors up to 240. */
export const CAREER_195: CareerVariant = { id: '195', ru: 'Alpha 1.9.5 (до)', priceTier: PRICES_195, rewards: { difficultyMoney: { rookie: 1, pro: 1.6, champion: 2.4 }, starPowerCap: 240 } };

export interface CareerRun {
  archetype: Archetype['id'];
  matches: number;
  /** Game day (1-based) each milestone was reached, or null within the horizon. */
  day: { level5: number | null; level10: number | null; allContracts: number | null; allCards: number | null; everything: number | null; rising: number | null; star: number | null; legendary: number | null };
  /** Money in hand at the end of these days (after purchases). */
  money: Record<number, number>;
  /** Earned in all by source (dollars). */
  earned: { matches: number; modes: number; goals: number; stages: number; daily: number };
  /** Hours of play (fights + menus) until everything was bought. */
  hoursToEverything: number | null;
  /** The longest stretch (days) a purchase that was unlocked had to wait for money. */
  longestWait: number;
  /** FIGHTS (career fights, a SURVIVAL run counts its five) until: the first contract, the first card, half of all the
   * career's prices spent, every contract, every card, everything. */
  at: { firstContract: number | null; firstCard: number | null; half: number | null; allContracts: number | null; allCards: number | null; everything: number | null };
  /** Dollars earned in all (every source) by the end of these days. */
  earnedBy: Record<number, number>;
  /** The most fights between two purchases in a row (until everything is bought) — «saving up» for one item. */
  maxGap: number;
  /** Fights at each purchase (the progress curve: early steps close together, later ones further apart). */
  buys: number[];
  /** The career's prices of this run. */
  sink: { contracts: number; cards: number; total: number };
}

/** The career's goods at the prices in force (src/config/careerPrices.ts — a variant may change PRICE_TIER for a run). */
function careerGoods() {
  const contracts = (Object.keys(FIGHTERS) as FighterId[]).filter((f) => FIGHTERS[f].contract).map((f) => ({ id: f, level: FIGHTERS[f].contract!.level, cost: contractCost(f) })).sort((a, b) => a.cost - b.cost);
  const cards = (Object.keys(CARDS) as CardId[]).filter((c) => CARDS[c].shop).map((c) => ({ id: c, level: CARDS[c].shop!.level, stage: CARDS[c].shop!.stage, price: cardPrice(c) })).sort((a, b) => a.price - b.price);
  return { contracts, cards };
}

/** Everything the career sells, in dollars (the prices in force, or those of `priceTier`). */
export function careerSink(priceTier?: Record<number, number>): { contracts: number; cards: number; total: number; contractCount: number; cardCount: number } {
  return withTier(priceTier, () => {
    const g = careerGoods();
    const contracts = g.contracts.reduce((a, c) => a + c.cost, 0);
    const cards = g.cards.reduce((a, c) => a + c.price, 0);
    return { contracts, cards, total: contracts + cards, contractCount: g.contracts.length, cardCount: g.cards.length };
  });
}

function withTier<T>(tier: Record<number, number> | undefined, fn: () => T): T {
  if (!tier) return fn();
  const saved = { ...PRICE_TIER };
  for (const k of Object.keys(PRICE_TIER)) delete PRICE_TIER[Number(k)];
  Object.assign(PRICE_TIER, tier);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(PRICE_TIER)) delete PRICE_TIER[Number(k)];
    Object.assign(PRICE_TIER, saved);
  }
}

function levelOf(rep: number): number {
  let l = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) if (rep >= LEVEL_THRESHOLDS[i]) l = i + 1;
  return l;
}

/** A career of `days` game days for archetype `a` (career fights only; the daily money comes from `daily`). */
export function runCareer(a: Archetype, samples: Record<Difficulty, Record<Skill, FightSample[]>>, variant: CareerVariant, days: number, daily: (day: number) => number): CareerRun {
  return withTier(variant.priceTier, () => runCareerNow(a, samples, variant, days, daily));
}

function runCareerNow(a: Archetype, samples: Record<Difficulty, Record<Skill, FightSample[]>>, variant: CareerVariant, days: number, daily: (day: number) => number): CareerRun {
  const { contracts: CONTRACTS, cards: SHOP_CARDS } = careerGoods();
  const sinkTotal = CONTRACTS.reduce((t, c) => t + c.cost, 0) + SHOP_CARDS.reduce((t, c) => t + c.price, 0);
  const at: CareerRun['at'] = { firstContract: null, firstCard: null, half: null, allContracts: null, allCards: null, everything: null };
  const earnedBy: Record<number, number> = {};
  let spent = 0;
  const buys: number[] = [];
  const saved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(variant.rewards ?? {})) {
    saved[k] = (REWARDS as Record<string, unknown>)[k];
    (REWARDS as Record<string, unknown>)[k] = v;
  }
  try {
    const store = new MemSave();
    const career = new CareerSystem(store as unknown as SaveSystem);
    let money = 150;
    let rep = 0;
    let fans = 0;
    let fansEarned = 0;
    let wins = 0;
    let proWins = 0;
    let champWins = 0;
    let bestRating = 0;
    let signed = 1;
    let cards = 0;
    let survivalClears = 0;
    let challengeClears = 0;
    let bossWins = 0;
    let matches = 0;
    let seconds = 0;
    const goals = new Set<string>();
    const stages = new Set<string>();
    const earned = { matches: 0, modes: 0, goals: 0, stages: 0, daily: 0 };
    const day: CareerRun['day'] = { level5: null, level10: null, allContracts: null, allCards: null, everything: null, rising: null, star: null, legendary: null };
    const moneyAt: Record<number, number> = {};
    let hoursToEverything: number | null = null;
    let waitSince: number | null = null;
    let longestWait = 0;
    let cursor = a.id.length * 7;
    let playDays = 0;
    const goal = (id: string) => {
      if (goals.has(id)) return;
      const g = GOALS.find((x) => x.id === id)!;
      goals.add(id);
      money += g.reward.money;
      rep += g.reward.rep;
      earned.goals += g.reward.money;
    };
    /** After every fight and at the end of the day: stages (each pays once), then purchases — the cheapest open contract
     * first, then the cheapest open card (levels and stages gate them). Returns whether an open item waits for money. */
    const settle = (d: number): boolean => {
      for (const st of CAREER_STAGES) {
        if (!st.reward || stages.has(st.id)) continue;
        const ok = st.milestones.every((m) => (m.metric === 'wins' ? wins : m.metric === 'fansEarned' ? fansEarned : m.metric === 'signed' ? signed : m.metric === 'bestRating' ? bestRating : m.metric === 'proWins' ? proWins : m.metric === 'championWins' ? champWins : m.metric === 'survivalClears' ? survivalClears : m.metric === 'challengeClears' ? challengeClears : bossWins) >= m.target);
        const prevOk = CAREER_STAGES.slice(0, CAREER_STAGES.indexOf(st)).every((q) => !q.reward || stages.has(q.id));
        if (ok && prevOk) {
          stages.add(st.id);
          money += st.reward.money;
          rep += st.reward.rep;
          earned.stages += st.reward.money;
          (day as Record<string, number | null>)[st.id] ??= d;
        }
      }
      const lvl = levelOf(rep);
      let bought = true;
      let blocked = false;
      while (bought) {
        bought = false;
        blocked = false;
        const c = CONTRACTS[signed - 1];
        if (c && c.level <= lvl) {
          if (money >= c.cost) {
            money -= c.cost;
            spent += c.cost;
            signed++;
            buys.push(matches);
            at.firstContract ??= matches;
            bought = true;
            if (signed >= 2) goal('sign_second');
            continue;
          }
          blocked = true;
        }
        const k = SHOP_CARDS[cards];
        if (k && k.level <= lvl && (!k.stage || stages.has(k.stage))) {
          if (money >= k.price) {
            money -= k.price;
            spent += k.price;
            cards++;
            buys.push(matches);
            at.firstCard ??= matches;
            bought = true;
          } else blocked = true;
        }
      }
      if (spent * 2 >= sinkTotal) at.half ??= matches;
      if (signed - 1 >= CONTRACTS.length) at.allContracts ??= matches;
      if (cards >= SHOP_CARDS.length) at.allCards ??= matches;
      if (at.allContracts !== null && at.allCards !== null) at.everything ??= matches;
      return blocked;
    };
    for (let d = 1; d <= days; d++) {
      const plays = a.week[(d - 1) % 7] === 1;
      if (plays) {
        playDays++;
        const dm = daily(d);
        money += dm;
        earned.daily += dm;
        for (let i = 0; i < a.careerPerDay; i++) {
          const lvl = levelOf(rep);
          // the difficulty a sensible player picks: a beginner stays on «Новичок» until «Профи» opens and never takes the
          // champion; a skilled player moves on at once (unlock levels of src/config/fighters.ts DIFFICULTIES)
          const diff: Difficulty = a.skill === 'combo' && lvl >= 4 ? 'champion' : lvl >= 2 ? 'pro' : 'rookie';
          // every 4th play day from level 3 a skilled player runs SURVIVAL instead of five fights, and clears a PRIME
          // CHALLENGE a week (their own money; the stages count them)
          if (a.skill === 'combo' && lvl >= 3 && playDays % 4 === 0 && i === 0) {
            const runMoney = SURVIVAL.waves.reduce((x, r) => x + r.reward.money, 0) + SURVIVAL.completion.money + (survivalClears === 0 ? SURVIVAL.firstClear.money : 0);
            money += runMoney;
            earned.modes += runMoney;
            rep += SURVIVAL.waves.reduce((x, r) => x + r.reward.rep, 0) + SURVIVAL.completion.rep;
            survivalClears++;
            matches += 5;
            seconds += 5 * (70 + SESSION_OVERHEAD_S);
            i += 4;
            settle(d);
            continue;
          }
          const xs = samples[diff][a.skill];
          const s = xs[cursor++ % xs.length];
          store.data.fighters.ray.fans = fans;
          const r = career.computeRewards(s.result, 'ray', diff);
          money += r.money;
          earned.matches += r.money;
          rep += r.rep;
          fans += r.fans;
          fansEarned += r.fans;
          matches++;
          seconds += s.seconds + SESSION_OVERHEAD_S;
          bestRating = Math.max(bestRating, s.rating);
          if (s.outcome === 'win') {
            wins++;
            goal('first_win');
            if (diff === 'pro') (proWins++, goal('pro_win'));
            if (diff === 'champion') (champWins++, goal('champion_win'));
          }
          if (s.combos >= 3) goal('combo_3');
          if (s.rating >= 70) goal('rating_70');
          if (s.perfects >= 3) goal('perfect_3');
          if (fansEarned >= 2500) goal('fans_2500');
          settle(d);
        }
        if (a.skill === 'combo' && levelOf(rep) >= 3 && playDays % 7 === 0 && challengeClears < CHALLENGES.length) {
          const c = CHALLENGES[challengeClears];
          money += c.firstClear.money;
          earned.modes += c.firstClear.money;
          rep += c.firstClear.rep;
          challengeClears++;
        }
        if (a.skill === 'combo' && champWins >= 3 && bossWins === 0) {
          const b = Object.values(BOSSES)[0].rewards.firstWin;
          money += b.money;
          earned.modes += b.money;
          rep += b.rep;
          bossWins = 1;
        }
      }
      const blocked = settle(d);
      if (blocked) waitSince ??= d;
      else if (waitSince !== null) (longestWait = Math.max(longestWait, d - waitSince), (waitSince = null));
      earnedBy[d] = Math.round(earned.matches + earned.modes + earned.goals + earned.stages + earned.daily);
      if (levelOf(rep) >= 5) day.level5 ??= d;
      if (levelOf(rep) >= 10) day.level10 ??= d;
      if (signed - 1 >= CONTRACTS.length) day.allContracts ??= d;
      if (cards >= SHOP_CARDS.length) day.allCards ??= d;
      if (day.allContracts && day.allCards && !day.everything) (day.everything = d), (hoursToEverything = seconds / 3600);
      moneyAt[d] = Math.round(money);
    }
    if (waitSince !== null) longestWait = Math.max(longestWait, days - waitSince);
    let maxGap = 0;
    for (let i = 1; i < buys.length; i++) maxGap = Math.max(maxGap, buys[i] - buys[i - 1]);
    return { archetype: a.id, matches, day, money: moneyAt, earned, hoursToEverything, longestWait, at, earnedBy, maxGap, buys, sink: { contracts: CONTRACTS.reduce((t, c) => t + c.cost, 0), cards: SHOP_CARDS.reduce((t, c) => t + c.price, 0), total: sinkTotal } };
  } finally {
    for (const [k, v] of Object.entries(saved)) (REWARDS as Record<string, unknown>)[k] = v;
  }
}

// ------------------------------------------------------------------------------------------------ DAILY STREAK
export interface DailyRun {
  claims: number;
  money: number;
  /** Game day the streak first reached each milestone (the exclusive items of 1.9.6 hang on these). */
  milestoneDay: Record<number, number | null>;
  bestStreak: number;
  resets: number;
}

/**
 * The server's own streak (lib/daily.js apply — with ITS rules: the shipped daily_rules.js or a variant) for a player
 * who claims on the play days of `a.week`. Returns the money of each game day too.
 */
export function runDaily(a: Archetype, days: number, rules = DAILY_RULES): DailyRun & { byDay: number[] } {
  let st = DAILY_SERVER.emptyState();
  const byDay: number[] = [0];
  let money = 0;
  let resets = 0;
  const milestoneDay: Record<number, number | null> = {};
  for (const m of rules.milestones) milestoneDay[m.day] = null;
  for (let d = 1; d <= days; d++) {
    let got = 0;
    if (a.week[(d - 1) % 7] === 1) {
      const r = DAILY_SERVER.apply(st, 20000 + d, rules);
      if (r) {
        st = r.state;
        got = r.claim.money;
        money += got;
        if (r.claim.reset) resets++;
        if (r.claim.milestone && milestoneDay[r.claim.milestone] === null) milestoneDay[r.claim.milestone] = d;
      }
    }
    byDay.push(got);
  }
  return { claims: st.claims, money, milestoneDay, bestStreak: st.best, resets, byDay };
}

// ------------------------------------------------------------------------------------------------ PRIME LEAGUE
export interface LeagueVariant {
  id: string;
  ru: string;
  /** Overrides of LEAGUE.air / LEAGUE.tokens (the shipped league_rules.js when empty). */
  air?: Partial<{ win: number; draw: number; loss: number; attackPerDay: number; attackPerWeek: number }>;
  tokens?: Partial<{ win: number; draw: number; loss: number; attackPerDay: number }>;
  track?: { at: number; tokens?: number }[];
}

/** The values of Alpha 1.9.5 (before this update) — the model's «before» column. */
export const LEAGUE_195: LeagueVariant = {
  id: '195',
  ru: 'Alpha 1.9.5 (до)',
  air: { win: 10, draw: 6, loss: 4, attackPerWeek: 0 },
  track: [{ at: 40, tokens: 20 }, { at: 100, tokens: 30 }, { at: 180 }, { at: 280, tokens: 40 }, { at: 400, tokens: 50 }, { at: 540 }, { at: 700, tokens: 60 }, { at: 880, tokens: 80 }, { at: 1080 }, { at: 1300 }],
};
export const DAILY_195 = { ...DAILY_RULES, checkpoints: false, graceDays: 0 };

export interface LeagueRun {
  tokens: { attack: number; defense: number; challenge: number; track: number; total: number };
  air: number;
  /** Day the season track was finished (the last tier), or null. */
  trackDoneDay: number | null;
  tiers: number;
  perPlayDay: number;
}

/** One 42-day season of PRIME LEAGUE for `a` (tokens and air by the server's caps; challenges from the population model). */
export function runLeague(a: Archetype, v: LeagueVariant, days = LEAGUE_RULES.season.lengthDays, seed = 4242): LeagueRun {
  const T = { ...LEAGUE_RULES.tokens, ...(v.tokens ?? {}) };
  const A = { ...LEAGUE_RULES.air, attackPerDay: 0, ...(v.air ?? {}) };
  const rnd = rng(seed + a.id.length);
  const out: LeagueRun = { tokens: { attack: 0, defense: 0, challenge: 0, track: 0, total: 0 }, air: 0, trackDoneDay: null, tiers: 0, perPlayDay: 0 };
  let playDays = 0;
  let weekGot = 0;
  const track: { at: number; tokens?: number }[] = v.track ?? LEAGUE_RULES.track;
  const lastTier = track[track.length - 1].at;
  const challengeDays = Array.from({ length: a.challenges }, (_, i) => Math.round(((i + 1) * days) / (a.challenges + 1)));
  for (let d = 1; d <= days; d++) {
    if ((d - 1) % 7 === 0) weekGot = 0;
    if (a.week[(d - 1) % 7] !== 1) continue;
    playDays++;
    let tok = 0;
    let air = 0;
    for (let i = 0; i < a.leaguePerDay; i++) {
      const o = rnd() < a.leagueWin ? 'win' : rnd() < 0.04 ? 'draw' : 'loss';
      tok += T[o];
      air += A[o];
    }
    const paid = Math.min(tok, T.attackPerDay);
    let airPaid = A.attackPerDay > 0 ? Math.min(air, A.attackPerDay) : air;
    if (A.attackPerWeek > 0) (airPaid = Math.max(0, Math.min(airPaid, A.attackPerWeek - weekGot))), (weekGot += airPaid);
    const def = Math.min(Math.floor(a.defenseWins + (rnd() < a.defenseWins % 1 ? 1 : 0)) * T.defenseWin, T.defensePerDay);
    const defAir = Math.min(Math.floor(a.defenseWins) * A.defenseWin, A.defensePerDay);
    out.tokens.attack += paid;
    out.tokens.defense += def;
    const before = out.air;
    out.air += airPaid + defAir;
    if (challengeDays.includes(d)) (out.tokens.challenge += T.challengeWin), (out.air += A.challengeWin);
    for (const t of track) if (t.tokens && before < t.at && out.air >= t.at) out.tokens.track += t.tokens;
    if (before < lastTier && out.air >= lastTier) out.trackDoneDay = d;
  }
  out.tiers = track.filter((t) => out.air >= t.at).length;
  out.tokens.total = out.tokens.attack + out.tokens.defense + out.tokens.challenge + out.tokens.track;
  out.perPlayDay = playDays ? out.tokens.total / playDays : 0;
  return out;
}

/**
 * Intentional losses: what a player who throws every PRIME LEAGUE fight earns in an hour (`lossSeconds` — a quick KO
 * loss measured on real fights; the server allows `startsPerHour` starts and refuses a finish before the fight's time).
 */
export function lossFarmPerHour(v: LeagueVariant, lossSeconds: number): { fights: number; air: number; tokens: number } {
  const T = { ...LEAGUE_RULES.tokens, ...(v.tokens ?? {}) };
  const A = { ...LEAGUE_RULES.air, attackPerDay: 0, ...(v.air ?? {}) };
  const fights = Math.min(LEAGUE_RULES.match.startsPerHour, Math.floor(3600 / (lossSeconds + SESSION_OVERHEAD_S)));
  return { fights, air: fights * A.loss, tokens: Math.min(fights * T.loss, T.attackPerDay) };
}

/** An honest hour at 50 % wins (average fight ~70 s + the menus). */
export function honestPerHour(v: LeagueVariant): { fights: number; air: number; tokens: number } {
  const T = { ...LEAGUE_RULES.tokens, ...(v.tokens ?? {}) };
  const A = { ...LEAGUE_RULES.air, attackPerDay: 0, ...(v.air ?? {}) };
  const fights = Math.min(LEAGUE_RULES.match.startsPerHour, Math.floor(3600 / (70 + SESSION_OVERHEAD_S)));
  const air = (fights / 2) * (A.win + A.loss);
  return { fights, air, tokens: Math.min((fights / 2) * (T.win + T.loss), T.attackPerDay) };
}
