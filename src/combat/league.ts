import { PILOT } from '../config/balance';
import { BEHAVIORS, DIFFICULTIES, FIGHTERS } from '../config/fighters';
import { LEAGUE_AI, TACTICS, type TacticId } from '../config/league.config';
import type { BehaviorDef, CardId, DifficultyDef, FighterId, RivalDef, RivalId } from '../config/types';

/**
 * Alpha 1.9.0 PRIME LEAGUE — one side of a league fight as the SERVER fixed it when the match was made
 * (league_matches.snapshot). The game and the server build the very same Match from it.
 */
export interface LeagueSide {
  fighter: FighterId;
  deck: CardId[];
  /** The defender's AI director (the attacker plays its own cards). */
  tactic?: TacticId;
  /** Look id — rendering only, never the fight. */
  look?: string;
  /** Shown name (the owner's nickname or a PRIME NETWORK participant). */
  name?: string;
  /** Fighter level (0 while PRIME_LEAGUE_UPGRADES is off). */
  level?: number;
}

export interface LeagueFight {
  foe: LeagueSide;
  /** HP / damage multipliers [attacker, defender] from fighter levels (1 = none). */
  hpMult?: [number, number];
  dmgMult?: [number, number];
}

/** The defender as a «rival» the fight code knows: a real fighter with its standard stats, its saved deck. */
export function leagueRival(s: LeagueSide): RivalDef {
  const f = FIGHTERS[s.fighter];
  return {
    id: 'league' as RivalId,
    name: s.name ?? f.name,
    nickname: s.name ?? f.name,
    fullName: s.name ?? f.name,
    archetype: s.fighter,
    behavior: 'tactical',
    look: s.look ?? f.look,
    deck: s.deck.slice(),
    bio: '',
    theme: f.theme,
  };
}

/** No hidden bonuses: HP, damage, energy and telegraphs exactly as the attacker's; aim and dodging like PILOT. */
export const LEAGUE_DIFFICULTY: DifficultyDef = {
  ...DIFFICULTIES.pro,
  hpMult: 1,
  dmgMult: 1,
  energyMult: 1,
  telegraphMult: 1,
  aimLead: PILOT.aimLead,
  aimError: PILOT.aimError,
  dodgeSkill: PILOT.dodgeSkill,
  reactMin: LEAGUE_AI.reactMin,
  reactMax: LEAGUE_AI.reactMax,
  decideMin: LEAGUE_AI.decideMin,
  decideMax: LEAGUE_AI.decideMax,
  cardSmarts: LEAGUE_AI.cardSmarts,
};

/** Movement stays the standard «tactical» brain for every tactic; only the card fields follow the tactic. */
export function tacticBehavior(id: TacticId): BehaviorDef {
  const t = TACTICS[id];
  return { ...BEHAVIORS.tactical, cardEagerness: 1, energyReserve: t.energyReserve, comboHunter: t.comboHunter };
}
