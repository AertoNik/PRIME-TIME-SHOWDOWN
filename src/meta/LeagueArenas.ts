import { ARENAS, ARENA_ORDER, type ArenaDef, type ArenaId } from '../config/arenas.config';
import { EVENTS, type EventDef } from '../config/events.config';
import { LEAGUE } from '../config/league.config';

/**
 * Alpha 1.9.3 — the studio sets of PRIME LEAGUE, from the game's own catalogue (arenas.config.ts) and event calendar
 * (events.config.ts), never a second list:
 *   · a permanent set of LEAGUE.arenas — every day (CURSED CEMETERY SET included, all year);
 *   · a seasonal set — while a dated event of its theme runs (Halloween → HAUNTED PRIME SET; a future New Year set with a
 *     dated winter event the same way: add the set and the event, run `npm run backend:rules` — nothing else changes).
 * The server gets exactly this as league_rules.arenaCatalog (`npm run backend:rules`) and decides with lib/league.js
 * arenasAt — the same rule as leagueArenasAt below, at the server's clock. The game shows the list the server sends.
 * Picking a set never pays anything seasonal in the league.
 */
export interface LeagueArenaWindow {
  /** The event that opens the set (events.config.ts id). */
  event: string;
  /** UTC ISO; `until` is exclusive — the same rule as EventManager.isRunning. */
  from: string;
  until: string;
}
export interface LeagueArenaEntry {
  id: ArenaId;
  /** Absent: a permanent set. */
  windows?: LeagueArenaWindow[];
}

/** `arenas` / `order` / `events`: the game's own catalogue and calendar (other values only in the checks). */
export function leagueArenaCatalog(arenas: Record<string, ArenaDef> = ARENAS, order: readonly string[] = ARENA_ORDER, events: readonly EventDef[] = EVENTS): LeagueArenaEntry[] {
  const out: LeagueArenaEntry[] = [];
  for (const key of order) {
    const def = arenas[key];
    if (!def) continue;
    const id = key as ArenaId;
    if (def.availability.kind === 'permanent') {
      if ((LEAGUE.arenas as readonly string[]).includes(id)) out.push({ id });
      continue;
    }
    const theme = def.availability.themeId;
    const windows = events.filter((e) => e.themeId === theme && e.start && e.end && Number.isFinite(Date.parse(e.start)) && Number.isFinite(Date.parse(e.end))).map((e) => ({ event: e.id, from: e.start!, until: e.end! }));
    // a seasonal set without a dated event (a theme preview) never opens in the league
    if (windows.length) out.push({ id, windows });
  }
  return out;
}

/** The sets a league fight can be made on at `t` (ms) — lib/league.js arenasAt is the same rule. */
export function leagueArenasAt(catalog: readonly LeagueArenaEntry[], t: number): ArenaId[] {
  return catalog.filter((a) => !a.windows || a.windows.some((w) => t >= Date.parse(w.from) && t < Date.parse(w.until))).map((a) => a.id);
}
