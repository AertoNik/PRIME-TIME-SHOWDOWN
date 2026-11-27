// Alpha 1.9.0 PRIME LEAGUE — the entry of backend/pb_hooks/lib/league_sim.js (built by `npm run backend:rules`).
// Only the fight and its proof: no DOM, no network, nothing from the game's screens.
// Beta 2.7: the LIVE DUELS journal replay is part of the same engine file (one fight engine, one SIM_VERSION).
export { checkInputs, leagueConfig, replayLeague, stateHash } from './replay';
export { checkLiveInputs, replayLive } from '../live/sim';
