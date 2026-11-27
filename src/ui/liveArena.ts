// Beta 2.7.1 LIVE DUELS — the words for a duel's studio set (the room, the fight's intro, the result).
import { ARENAS, isArenaId, type ArenaPref } from '../config/arenas.config';
import type { LiveArenaPick } from '../net/LiveApi';

/** A set's short name for the room's lines («NEON NEWSROOM», «Случайная арена»). */
export function arenaName(v: ArenaPref | null | undefined): string {
  return v && v !== 'random' && isArenaId(v) ? ARENAS[v].name : 'Случайная арена';
}

/** How the server chose a match's set, for the player on `side` (the intro line and the result). */
export function arenaWhy(p: LiveArenaPick | undefined, side: 0 | 1): string {
  if (!p) return 'выбор сервера';
  if (p.how === 'same') return 'оба выбрали эту арену';
  if (p.how === 'coin') return 'жребий 50/50 из двух выбранных';
  if (p.how === 'one') return p.prefs[side] !== 'random' ? 'ваш выбор' : 'выбор соперника';
  return 'случайная арена';
}
