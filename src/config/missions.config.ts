// Beta 2.6 — DAILY MISSIONS («ЕЖЕДНЕВНЫЕ ЗАДАНИЯ»): five different tasks a day for a signed-in player, each worth one
// free DAILY MISSION MINI CASE. The ONE place for the catalogue and the day's mix; the PRIME NETWORK server picks,
// counts and pays (backend/pb_hooks/lib/mission_rules.js is generated from this file by `npm run backend:rules`, the
// shared logic src/missions/missionMath.ts → mission_math.js). Nothing here replaces DAILY STREAK, DAILY BROADCAST
// CASE, achievements, seasonal quests or PRIME CHALLENGE.
//
// Only what the server can stand behind counts:
//   * career fights — the game's report of a finished fight, checked like WINTER SHOWDOWN's (R-22): clamped figures,
//     a fight of at least 30 s, a TIME BANK that never runs ahead of the real clock, at most 40 reports an hour, each
//     report once (its op), an exit from the fight counts NOTHING; the fighter must be one the cloud save has signed;
//   * PRIME LEAGUE fights — the server's own replay (lib/league.js settle), once per fight, never a forfeit.
// The day is the DAILY STREAK's game day (Moscow, UTC+3); a day's set is written once and never changes after.

/** What a mission counts. */
export type MissionMetric =
  | 'fights' // career fights finished (won, lost or drawn — never an exit)
  | 'wins' // career wins
  | 'koWins' // career wins by knockout
  | 'proWins' // career wins on «Профи» or «Чемпион»
  | 'champWins' // career wins on «Чемпион»
  | 'combos' // combos landed in career fights
  | 'perfects' // perfect reactions in career fights
  | 'rating' // career fights with a show rating ≥ `min`
  | 'fighters' // different signed fighters that finished a career fight
  | 'fighterWins' // different signed fighters that won a career fight
  | 'rivals' // different career rivals beaten (DEX, TANK, ZOE, CRASH)
  | 'challengeWins' // PRIME CHALLENGE fights won
  | 'leagueFights' // PRIME LEAGUE fights finished
  | 'leagueWins' // PRIME LEAGUE fights won
  | 'leagueCombos'; // combos landed in PRIME LEAGUE fights

export type MissionTier = 'easy' | 'medium' | 'hard';

export interface MissionDef {
  id: string;
  /** Two missions of one family are never given on the same day (they would chase the same goal). */
  family: string;
  tier: MissionTier;
  metric: MissionMetric;
  target: number;
  /** For `rating`: the show rating a fight must reach. */
  min?: number;
  /** The task as the player reads it. */
  title: string;
  /** About how long it takes alone (minutes) — one fight often counts for several missions at once. */
  minutes: number;
  /** Given only when the player can do it: PRIME LEAGUE joined, a difficulty open, enough signed fighters. */
  needs?: { league?: true; difficulty?: 'pro' | 'champion'; fighters?: number };
}

export const MISSIONS_VERSION = 1;

export const MISSIONS: MissionDef[] = [
  // Targets from the measured fights of the economy model (scripts/lib/economySamples.ts, a fight + the menus ≈ 1.75 min):
  // easy ≈ 6–8 fights, medium ≈ 12–16, hard ≈ 22–30 — one fight counts for every mission at once, so three missions
  // take about 20–45 minutes and a whole set about 40–60 (npm run missions measures it).
  // ---------------------------------------------------------------- easy
  { id: 'c_fights_8', family: 'fights', tier: 'easy', metric: 'fights', target: 8, title: 'Проведите 8 боёв в карьере', minutes: 14 },
  { id: 'c_wins_7', family: 'wins', tier: 'easy', metric: 'wins', target: 7, title: 'Победите в 7 боях карьеры', minutes: 15 },
  { id: 'c_combos_20', family: 'combos', tier: 'easy', metric: 'combos', target: 20, title: 'Проведите 20 комбо в боях карьеры', minutes: 14 },
  { id: 'c_rating_70', family: 'rating', tier: 'easy', metric: 'rating', target: 7, min: 70, title: 'Наберите рейтинг шоу 70+ в 7 боях карьеры', minutes: 14 },
  { id: 'c_perfects_14', family: 'perfects', tier: 'easy', metric: 'perfects', target: 14, title: 'Сделайте 14 идеальных реакций', minutes: 16 },
  { id: 'c_ko_6', family: 'ko', tier: 'easy', metric: 'koWins', target: 6, title: 'Победите нокаутом 6 раз', minutes: 15 },
  { id: 'c_rivals_3', family: 'rivals', tier: 'easy', metric: 'rivals', target: 3, title: 'Победите 3 разных соперников карьеры', minutes: 8 },
  { id: 'l_fights_3', family: 'league_fights', tier: 'easy', metric: 'leagueFights', target: 3, title: 'Проведите 3 боя PRIME LEAGUE', minutes: 8, needs: { league: true } },
  // ---------------------------------------------------------------- medium
  { id: 'c_fights_12', family: 'fights', tier: 'medium', metric: 'fights', target: 12, title: 'Проведите 12 боёв в карьере', minutes: 21 },
  { id: 'c_wins_10', family: 'wins', tier: 'medium', metric: 'wins', target: 10, title: 'Победите в 10 боях карьеры', minutes: 22 },
  { id: 'c_pro_6', family: 'difficulty', tier: 'medium', metric: 'proWins', target: 6, title: 'Победите 6 раз на сложности «Профи» или выше', minutes: 14, needs: { difficulty: 'pro' } },
  { id: 'c_combos_30', family: 'combos', tier: 'medium', metric: 'combos', target: 30, title: 'Проведите 30 комбо в боях карьеры', minutes: 22 },
  { id: 'c_rating_85', family: 'rating', tier: 'medium', metric: 'rating', target: 4, min: 85, title: 'Наберите рейтинг шоу 85+ в 4 боях карьеры', minutes: 18 },
  { id: 'c_perfects_20', family: 'perfects', tier: 'medium', metric: 'perfects', target: 20, title: 'Сделайте 20 идеальных реакций', minutes: 22 },
  { id: 'c_fighter_wins_3', family: 'fighters', tier: 'medium', metric: 'fighterWins', target: 3, title: 'Победите тремя разными бойцами', minutes: 10, needs: { fighters: 3 } },
  { id: 'c_challenge_2', family: 'challenge', tier: 'medium', metric: 'challengeWins', target: 2, title: 'Пройдите 2 испытания PRIME CHALLENGE', minutes: 12 },
  { id: 'c_ko_8', family: 'ko', tier: 'medium', metric: 'koWins', target: 8, title: 'Победите нокаутом 8 раз', minutes: 22 },
  { id: 'c_rivals_4', family: 'rivals', tier: 'medium', metric: 'rivals', target: 4, title: 'Победите всех четырёх соперников карьеры', minutes: 12 },
  { id: 'l_wins_4', family: 'league_wins', tier: 'medium', metric: 'leagueWins', target: 4, title: 'Победите в 4 боях PRIME LEAGUE', minutes: 18, needs: { league: true } },
  { id: 'l_combos_12', family: 'league_combos', tier: 'medium', metric: 'leagueCombos', target: 12, title: 'Проведите 12 комбо в боях PRIME LEAGUE', minutes: 18, needs: { league: true } },
  // ---------------------------------------------------------------- hard
  { id: 'c_fights_25', family: 'fights', tier: 'hard', metric: 'fights', target: 25, title: 'Проведите 25 боёв в карьере', minutes: 44 },
  { id: 'c_wins_20', family: 'wins', tier: 'hard', metric: 'wins', target: 20, title: 'Победите в 20 боях карьеры', minutes: 42 },
  { id: 'c_champ_3', family: 'difficulty', tier: 'hard', metric: 'champWins', target: 3, title: 'Победите 3 раза на сложности «Чемпион»', minutes: 16, needs: { difficulty: 'champion' } },
  { id: 'c_combos_60', family: 'combos', tier: 'hard', metric: 'combos', target: 60, title: 'Проведите 60 комбо в боях карьеры', minutes: 42 },
  { id: 'c_fighter_wins_5', family: 'fighters', tier: 'hard', metric: 'fighterWins', target: 5, title: 'Победите пятью разными бойцами', minutes: 18, needs: { fighters: 5 } },
  { id: 'c_rating_90', family: 'rating', tier: 'hard', metric: 'rating', target: 2, min: 90, title: 'Наберите рейтинг шоу 90+ в двух боях карьеры', minutes: 30 },
  { id: 'c_perfects_40', family: 'perfects', tier: 'hard', metric: 'perfects', target: 40, title: 'Сделайте 40 идеальных реакций', minutes: 42 },
  { id: 'l_wins_8', family: 'league_wins', tier: 'hard', metric: 'leagueWins', target: 8, title: 'Победите в 8 боях PRIME LEAGUE', minutes: 36, needs: { league: true } },
];

/** The day's mix: always five, all different families. */
export const MISSION_MIX = {
  count: 5,
  tiers: { easy: 2, medium: 2, hard: 1 } as Record<MissionTier, number>,
  /** A league player gets at most this many league missions (the rest are career — playable without the league). */
  maxLeague: 2,
  /** Combos land in at most this many career fights' worth per report (the report's own clamp is REPORT_LIMITS). */
  maxCombosPerFight: 12,
  maxPerfectsPerFight: 20,
};

/** The career rivals a «different rivals» mission counts (the Classic Duel's opponents). */
export const MISSION_RIVALS = ['dex', 'tank', 'zoe', 'crash'];
