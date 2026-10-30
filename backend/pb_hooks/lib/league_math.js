// PRIME TIME: SHOWDOWN — Alpha 1.9.0 PRIME LEAGUE: the pure rules (no database). The server (lib/league.js) and the
// balance simulator (`npm run league:sim`) both use exactly these functions with the numbers of league_rules.js.
//
//   seasons      by the SERVER's clock: season n lasts lengthDays from epoch + (n − 1) · lengthDays (before the epoch: 0)
//   ranks        8 major ranks, III → II → I inside each by RP; the last one has no divisions
//   RP / MMR     MMR is the hidden skill estimate (Elo); RP is what the player sees. RP moves faster toward the RP
//                that the MMR «belongs» at and slower away from it, so RP follows skill instead of growing with the
//                number of matches. A player keeps the major rank once reached (floor) until the season ends.
//   CHALLENGE    entering a major rank from index challenge.from needs 3 wins before 2 losses; RP waits one below the
//                next rank meanwhile; a failed challenge drops failDrop RP but never the rank already held.

const RULES = require('./league_rules.js');

const DAY_MS = 86400000;
const MSK_MS = 3 * 3600000;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/**
 * When season 1 starts (ms) — or null: no start fixed, the pre-season goes on. On the SERVER the only source is
 * PRIME_LEAGUE_SEASON_START (YYYY-MM-DD = 00:00 Moscow time, or a full ISO moment); the config's epoch is only the
 * suggestion the model and the Node tests use. A late launch therefore never starts season 1 in the past.
 */
function seasonStart(rules) {
  const r = rules || RULES;
  if (r._epoch !== undefined) return r._epoch;
  if (typeof $os !== 'undefined') {
    const raw = String($os.getenv('PRIME_LEAGUE_SEASON_START') || '').trim();
    if (!raw) return null;
    const t = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? Date.parse(raw + 'T00:00:00+03:00') : Date.parse(raw);
    return isFinite(t) ? t : null;
  }
  return Date.parse(r.season.epoch);
}

/** The season number at server time `ms` (0 = the pre-season, before season 1 or with no start fixed). */
function seasonOf(ms, rules) {
  const r = rules || RULES;
  const epoch = seasonStart(r);
  if (epoch === null || ms < epoch) return 0;
  return Math.floor((ms - epoch) / (r.season.lengthDays * DAY_MS)) + 1;
}

/** [start, end) of season n in ms (season 0: until season 1 starts — end null while no start is fixed). */
function seasonBounds(n, rules) {
  const r = rules || RULES;
  const epoch = seasonStart(r);
  const len = r.season.lengthDays * DAY_MS;
  if (n <= 0) return [0, epoch];
  return [epoch + (n - 1) * len, epoch + n * len];
}

/** Moscow calendar day number (daily caps). */
function dayOf(ms) {
  return Math.floor((ms + MSK_MS) / DAY_MS);
}

/** Major rank index of an RP value. */
function rankIndex(rp, rules) {
  const ranks = (rules || RULES).ranks;
  let i = 0;
  for (let k = 0; k < ranks.length; k++) if (rp >= ranks[k].base) i = k;
  return i;
}

/** { index, id, ru, en, division ('III'|'II'|'I'|null), base, next (RP of the next major rank or null), progress 0..1 to next division }. */
function rankOf(rp, rules) {
  const ranks = (rules || RULES).ranks;
  const i = rankIndex(rp, rules);
  const r = ranks[i];
  const next = i + 1 < ranks.length ? ranks[i + 1].base : null;
  if (next === null) return { index: i, id: r.id, ru: r.ru, en: r.en, color: r.color, division: null, base: r.base, next: null, divBase: r.base, divNext: null, progress: 1 };
  const span = next - r.base;
  const d = Math.min(2, Math.floor(((rp - r.base) * 3) / span));
  const divBase = r.base + Math.round((span * d) / 3);
  const divNext = d < 2 ? r.base + Math.round((span * (d + 1)) / 3) : next;
  return { index: i, id: r.id, ru: r.ru, en: r.en, color: r.color, division: ['III', 'II', 'I'][d], base: r.base, next: next, divBase: divBase, divNext: divNext, progress: clamp((rp - divBase) / (divNext - divBase), 0, 1) };
}

/** Elo expectation of A against B. */
function expected(mmrA, mmrB) {
  return 1 / (1 + Math.pow(10, (mmrB - mmrA) / 400));
}

/** The RP this MMR belongs at. */
function targetRp(mmr, rules) {
  const r = (rules || RULES).rp;
  return Math.max(0, (mmr - r.targetFrom) * r.targetScale);
}

/**
 * RP change of one ranked result for profile p ({ rp, mmr, games }) against an opponent of MMR `opp`.
 * `factor` scales it (PRIME NETWORK participants, SQUAD). Floors and the challenge cap are applied by applyRp.
 */
function rpDelta(p, opp, outcome, factor, rules) {
  const R = rules || RULES;
  const r = R.rp;
  const E = expected(p.mmr, opp);
  const g = clamp(1 + (targetRp(p.mmr, R) - p.rp) / r.catchUpSpan, r.catchUpMin, r.catchUpMax);
  let d;
  if (outcome === 'win') d = Math.round(clamp(2 * r.base * (1 - E) * g, r.winMin, r.winMax));
  else if (outcome === 'loss') {
    d = -Math.round(clamp((2 * r.base * E) / g, r.lossMin, r.lossMax));
    if (p.games < r.newcomerGames) d = -Math.round(-d * r.newcomerLossFactor);
  } else d = Math.round(clamp(2 * r.base * (0.5 - E), -10, 10));
  const f = typeof factor === 'number' ? factor : 1;
  return f === 1 ? d : d < 0 ? -Math.round(-d * f) : Math.round(d * f);
}

/** Hidden MMR change. */
function mmrDelta(p, opp, outcome, factor, rules) {
  const m = (rules || RULES).mmr;
  const k = p.games < m.calibrationGames ? m.kCalibration : m.k;
  const s = outcome === 'win' ? 1 : outcome === 'loss' ? 0 : 0.5;
  const f = typeof factor === 'number' ? factor : 1;
  return Math.round(k * (s - expected(p.mmr, opp)) * f * 10) / 10;
}

/** Does entering major rank `index` need a PRIME CHALLENGE? */
function needsChallenge(index, rules) {
  const R = rules || RULES;
  return index >= R.challenge.from && index < R.ranks.length;
}

/**
 * New RP after a delta: never below the floor (the major rank already reached this season), never past the next major
 * rank when that one needs a challenge (it waits one RP below and the challenge opens).
 * Returns { rp, floor, challengeReady, promoted (major index entered without a challenge or null) }.
 */
function applyRp(rp, floor, d, rules) {
  const R = rules || RULES;
  let n = Math.max(floor, rp + d, 0);
  const before = rankIndex(rp, R);
  let challengeReady = false;
  for (let i = before + 1; i < R.ranks.length; i++) {
    if (n < R.ranks[i].base) break;
    if (needsChallenge(i, R)) {
      n = R.ranks[i].base - 1;
      challengeReady = true;
      break;
    }
  }
  const after = rankIndex(n, R);
  const newFloor = Math.max(floor, R.ranks[after].base);
  return { rp: n, floor: newFloor, challengeReady: challengeReady, promoted: after > before ? after : null };
}

/** A challenge after one result: { state: 'open' | 'passed' | 'failed', wins, losses }. */
function challengeStep(ch, outcome, rules) {
  const c = (rules || RULES).challenge;
  const wins = ch.wins + (outcome === 'win' ? 1 : 0);
  const losses = ch.losses + (outcome === 'loss' ? 1 : 0);
  const state = wins >= c.wins ? 'passed' : losses >= c.losses ? 'failed' : 'open';
  return { state: state, wins: wins, losses: losses, to: ch.to };
}

/** The soft reset at a new season: { rp, floor, mmr }. */
function softReset(rp, mmr, rules) {
  const R = rules || RULES;
  // the carried RP keeps the rank it lands in (those ranks were earned, challenges included, last season)
  const nrp = Math.max(0, Math.round(rp * R.season.rpCarry));
  return { rp: nrp, floor: R.ranks[rankIndex(nrp, R)].base, mmr: Math.round((R.mmr.start + (mmr - R.mmr.start) * R.season.mmrCarry) * 10) / 10 };
}

/** HP / damage multipliers of a fighter level (1 when upgrades are off). */
function levelMult(level, on, rules) {
  const u = (rules || RULES).upgrades;
  const l = on ? clamp(Math.floor(level || 0), 0, u.maxLevel) : 0;
  return { hp: Math.round((1 + l * u.hpPerLevel) * 10000) / 10000, dmg: Math.round((1 + l * u.dmgPerLevel) * 10000) / 10000 };
}

/** PRIME TOKENS for the next level (level → level + 1). */
function upgradeCost(level, rules) {
  return (rules || RULES).upgrades.costBase * (level + 1);
}

/** Highest level a fighter may fight at in this major rank. */
function levelCap(rankIdx, rules) {
  const c = (rules || RULES).upgrades.capByRank;
  return c[clamp(rankIdx, 0, c.length - 1)];
}

/** The season-track tiers reached with `air` points: [{ tier, at, tokens?, title?, emblem? }]. */
function tiersReached(air, rules) {
  const out = [];
  const t = (rules || RULES).track;
  for (let i = 0; i < t.length; i++) if (air >= t[i].at) out.push(Object.assign({ tier: i + 1 }, t[i]));
  return out;
}

module.exports = {
  DAY_MS: DAY_MS,
  seasonStart: seasonStart,
  seasonOf: seasonOf,
  seasonBounds: seasonBounds,
  dayOf: dayOf,
  rankIndex: rankIndex,
  rankOf: rankOf,
  expected: expected,
  targetRp: targetRp,
  rpDelta: rpDelta,
  mmrDelta: mmrDelta,
  needsChallenge: needsChallenge,
  applyRp: applyRp,
  challengeStep: challengeStep,
  softReset: softReset,
  levelMult: levelMult,
  upgradeCost: upgradeCost,
  levelCap: levelCap,
  tiersReached: tiersReached,
};
