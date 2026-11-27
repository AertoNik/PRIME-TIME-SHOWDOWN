// The fight engine's version the checks expect (src/league/simVersion.ts). Beta 2.7 LIVE DUELS changed it on purpose
// (a141348f2a0dea20 → this): the engine file now also carries the live replay and one rule asks `cfg.live`. PRIME
// LEAGUE plays bit-identically on both engines (`npm run live` replays 300 league fights on the 2.6 copy and this one).
// A change of this value must always be a decision of its own — never a side effect.
export const SIM_LOCK = '2b218cc38dbd7db2';
