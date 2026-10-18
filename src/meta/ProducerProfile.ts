import { NEW_CARDS, UNIVERSAL_CARDS } from '../config/cards';
import { COSMETICS, type CosmeticId } from '../config/cosmetics.config';
import { FIGHTERS, FIGHTER_ORDER } from '../config/fighters';
import { CHALLENGES, SURVIVAL } from '../config/modes.config';
import type { FighterId } from '../config/types';
import type { CareerSystem, LevelInfo } from './CareerSystem';
import type { AchievementView, Collection } from './Collection';
import type { EventManager } from './EventManager';
import type { SaveData } from './SaveSystem';

// Alpha 1.8 — PRIME ID: what the producer profile shows, read from the career data the game already
// keeps (no second source of truth, nothing stored, nothing written). Level, roster and fans come
// from CareerSystem, the collection and achievements from Collection, which fighters may show from
// EventManager (a seasonal star only once owned or while its event runs — as in the roster).

/** Win rate in whole percent over decided-or-drawn career matches; null before the first one (no NaN). */
export function winRate(wins: number, losses: number, draws: number): number | null {
  const total = wins + losses + draws;
  return total > 0 ? Math.round((wins / total) * 100) : null;
}

/** One fighter's career record (career matches: Classic Duel, Prime Challenge, Boss Fight). */
export interface FighterRecord {
  id: FighterId;
  unlocked: boolean;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  streak: number;
  bestStreak: number;
  fans: number;
}

export function fighterRecord(d: SaveData, id: FighterId): FighterRecord {
  const f = d.fighters[id];
  return {
    id,
    unlocked: f.unlocked,
    matches: f.matches,
    wins: f.wins,
    losses: f.losses,
    draws: f.draws,
    winRate: winRate(f.wins, f.losses, f.draws),
    streak: f.streak,
    bestStreak: f.bestStreak,
    fans: f.fans,
  };
}

/** The roster as the player may see it now (LUCIEN keeps his seasonal rule). */
export function visibleFighters(em: Pick<EventManager, 'fighterVisible'>): FighterId[] {
  return FIGHTER_ORDER.filter((id) => em.fighterVisible(id));
}

const order = (id: FighterId) => FIGHTER_ORDER.indexOf(id);

/** Favourite fighter: the most career matches; ties → more wins, then roster order. None before the first match. */
export function favouriteOf(records: FighterRecord[]): FighterRecord | null {
  const played = records.filter((r) => r.matches > 0);
  if (!played.length) return null;
  return played.slice().sort((a, b) => b.matches - a.matches || b.wins - a.wins || order(a.id) - order(b.id))[0];
}

/** The most winning fighter: the most career wins; ties → higher win rate, then roster order. */
export function mostWinsOf(records: FighterRecord[]): FighterRecord | null {
  const winners = records.filter((r) => r.wins > 0);
  if (!winners.length) return null;
  return winners.slice().sort((a, b) => b.wins - a.wins || (b.winRate ?? 0) - (a.winRate ?? 0) || order(a.id) - order(b.id))[0];
}

/** The longest personal win streak; ties → the longer current run, then roster order. */
export function bestStreakOf(records: FighterRecord[]): FighterRecord | null {
  const st = records.filter((r) => r.bestStreak > 0);
  if (!st.length) return null;
  return st.slice().sort((a, b) => b.bestStreak - a.bestStreak || b.streak - a.streak || order(a.id) - order(b.id))[0];
}

export type HallSort = 'wins' | 'matches' | 'streak';

export interface HallOfFame {
  cards: FighterRecord[];
  badges: { mostWins: FighterId | null; bestStreak: FighterId | null; mostPlayed: FighterId | null };
}

/** HALL OF FAME: the visible fighters, the signed ones first, sorted by the chosen figure. */
export function hallOfFame(d: SaveData, em: Pick<EventManager, 'fighterVisible'>, sort: HallSort): HallOfFame {
  const records = visibleFighters(em).map((id) => fighterRecord(d, id));
  const key = (r: FighterRecord) => (sort === 'wins' ? r.wins : sort === 'matches' ? r.matches : r.bestStreak);
  const cards = records
    .slice()
    .sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || key(b) - key(a) || b.wins - a.wins || b.matches - a.matches || order(a.id) - order(b.id));
  return {
    cards,
    badges: { mostWins: mostWinsOf(records)?.id ?? null, bestStreak: bestStreakOf(records)?.id ?? null, mostPlayed: favouriteOf(records)?.id ?? null },
  };
}

export interface ProfileCollection {
  /** Visible cosmetics owned / shown (seasonal items appear only once owned — no spoilers). */
  owned: number;
  shown: number;
  titles: CosmeticId[];
  personal: { id: CosmeticId; owners: FighterId[] }[];
  seasonal: CosmeticId[];
  seasonalFighters: FighterId[];
  achievementsDone: number;
  achievementsTotal: number;
  highlights: AchievementView[];
  /** Cards a deck can take: the basic six, the signatures of signed fighters, the bought shop cards. */
  basicCards: number;
  signatureCards: number;
  shopOwned: number;
  shopTotal: number;
}

/**
 * PRIME ID status. 1.8: always the guest — the progress lives in this browser only. 1.8.1 adds
 * the account states; nothing here pretends to sync anything.
 */
export type ProfileStatus = 'guest';

export interface ProfileView {
  status: ProfileStatus;
  orgName: string;
  level: LevelInfo;
  /** 0..1 towards the next level (1 at the top level). */
  levelProgress: number;
  reputation: number;
  money: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  streak: number;
  bestStreak: number;
  /** When streak tracking began for this career (Alpha 1.8 or the career's start). */
  streakSince: number;
  signed: number;
  visibleFighters: number;
  /** Fans of the signed fighters (CareerSystem.totalFans). */
  fans: number;
  /** Best SHOW rating of a match (the broadcast's spectacle score, 0–100) — not a league rating. */
  bestRating: number;
  bestCombos: number;
  bestPerfects: number;
  totalEarned: number;
  proWins: number;
  championWins: number;
  favourite: FighterRecord | null;
  mostWins: FighterRecord | null;
  /** The fighter on the card: the favourite, or the selected one before the first match. */
  featured: FighterId;
  modes: { survivalBest: number; survivalWaves: number; survivalRuns: number; challengesCleared: number; challengesTotal: number; bossWins: number };
  collection: ProfileCollection;
}

/** Everything PRIME ID shows, from the live career data. Pure: changes nothing. */
export function buildProfile(d: SaveData, career: CareerSystem, collection: Collection, em: Pick<EventManager, 'fighterVisible'>): ProfileView {
  const visible = visibleFighters(em);
  const records = visible.map((id) => fighterRecord(d, id));
  const favourite = favouriteOf(records);
  const level = career.level();
  const cos = collection.cosmetics();
  const ownedCos = cos.filter((v) => v.owned);
  const ach = collection.achievements();
  const done = ach.filter((a) => a.done);
  const signedIds = FIGHTER_ORDER.filter((id) => d.fighters[id].unlocked);
  return {
    status: 'guest',
    orgName: d.orgName,
    level,
    levelProgress: Math.min(1, Math.max(0, level.progress)),
    reputation: Math.floor(d.reputation),
    money: Math.floor(d.money),
    matches: d.matches,
    wins: d.wins,
    losses: d.losses,
    draws: d.draws,
    winRate: winRate(d.wins, d.losses, d.draws),
    streak: d.streak.current,
    bestStreak: d.streak.best,
    streakSince: d.streak.since,
    signed: career.signedCount(),
    visibleFighters: visible.length,
    fans: career.totalFans(),
    bestRating: Math.round(d.bestRating),
    bestCombos: d.bestCombosInMatch,
    bestPerfects: d.bestPerfectsInMatch,
    totalEarned: Math.floor(d.totalEarned),
    proWins: d.proWins,
    championWins: d.championWins,
    favourite,
    mostWins: mostWinsOf(records),
    featured: favourite?.id ?? d.selected,
    modes: {
      survivalBest: d.modes.survival.bestWave,
      survivalWaves: SURVIVAL.waves.length,
      survivalRuns: d.modes.survival.runs,
      challengesCleared: CHALLENGES.filter((c) => (d.modes.challenges[c.id]?.firstClearAt ?? 0) > 0).length,
      challengesTotal: CHALLENGES.length,
      bossWins: Object.values(d.modes.boss).reduce((a, b) => a + b.wins, 0),
    },
    collection: {
      owned: ownedCos.length,
      shown: cos.length,
      titles: ownedCos.filter((v) => v.def.slot === 'title').map((v) => v.def.id),
      personal: ownedCos.filter((v) => v.def.personal && v.owners.length).map((v) => ({ id: v.def.id, owners: v.owners })),
      seasonal: ownedCos.filter((v) => COSMETICS[v.def.id].source === 'season').map((v) => v.def.id),
      seasonalFighters: collection.seasonalFighters().map((x) => x.id),
      achievementsDone: done.length,
      achievementsTotal: ach.length,
      highlights: done.slice(0, 4),
      basicCards: UNIVERSAL_CARDS.length,
      signatureCards: signedIds.length,
      shopOwned: NEW_CARDS.filter((c) => d.cards.owned.includes(c)).length,
      shopTotal: NEW_CARDS.length,
    },
  };
}

/** The fighter's display data for cards (name, nickname, colours) — straight from the roster config. */
export function fighterLook(id: FighterId) {
  const f = FIGHTERS[id];
  return { name: f.name, nickname: f.nickname, look: f.look, theme: f.theme, seasonal: !!f.seasonal };
}
