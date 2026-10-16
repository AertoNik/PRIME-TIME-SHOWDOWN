import { ARENA_ORDER, arenaById, isArenaId, type ArenaDef, type ArenaId, type ArenaPref } from '../config/arenas.config';

/**
 * Which studio sets can host a fight right now. A seasonal set is open while its
 * season's theme is active — by the event calendar, or in the developer preview
 * (`?event=` in `npm run dev`). Opening a set never pays seasonal rewards: those
 * follow EventManager.playable as before.
 */
export function arenaAvailable(def: ArenaDef, seasonThemeId: string): boolean {
  return def.availability.kind === 'permanent' || def.availability.themeId === seasonThemeId;
}

export function availableArenas(seasonThemeId: string): ArenaId[] {
  return ARENA_ORDER.filter((id) => arenaAvailable(arenaById(id), seasonThemeId));
}

/** A saved preference that can still be honoured (a seasonal set after its season falls back to the original studio). */
export function validArenaPref(pref: unknown, seasonThemeId: string): ArenaPref {
  if (pref === 'random') return 'random';
  if (isArenaId(pref) && arenaAvailable(arenaById(pref), seasonThemeId)) return pref;
  return 'original';
}

/** The stage a fight is actually broadcast from. RANDOM picks among available stages only. */
export function resolveArena(pref: ArenaPref, seasonThemeId: string, rand: () => number): ArenaId {
  const p = validArenaPref(pref, seasonThemeId);
  if (p !== 'random') return p;
  const list = availableArenas(seasonThemeId);
  return list[Math.min(list.length - 1, Math.floor(rand() * list.length))] ?? 'original';
}
