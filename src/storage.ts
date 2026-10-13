import { CARD_IDS, DEFAULT_DECK, WEAPONS, type CardId, type WeaponId } from './data';
import type { Combat } from './combat';
export interface Profile { version: 1; name: string; fans: number; coins: number; wins: number; matches: number; damage: number; combos: number; weapon: WeaponId; deck: CardId[]; intro: boolean; sound: boolean; quality: 'auto' | 'low' }
export const SAVE_KEY = 'prime-time.alpha.1';
export const freshProfile = (): Profile => ({ version: 1, name: 'ROOKIE', fans: 0, coins: 100, wins: 0, matches: 0, damage: 0, combos: 0, weapon: 'pistol', deck: [...DEFAULT_DECK], intro: false, sound: true, quality: 'auto' });
export function load(): Profile {
  const base = freshProfile();
  try { const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (!raw || raw.version !== 1) return base;
    for (const k of ['fans', 'coins', 'wins', 'matches', 'damage', 'combos'] as const) if (Number.isFinite(raw[k]) && raw[k] >= 0) base[k] = Math.floor(raw[k]);
    if (typeof raw.name === 'string') base.name = raw.name.slice(0, 16) || 'ROOKIE';
    if (Object.hasOwn(WEAPONS, raw.weapon)) base.weapon = raw.weapon;
    if (Array.isArray(raw.deck) && raw.deck.length === 4 && new Set(raw.deck).size === 4 && raw.deck.every((c: CardId) => CARD_IDS.includes(c))) base.deck = raw.deck;
    base.intro = raw.intro === true; base.sound = raw.sound !== false; base.quality = raw.quality === 'low' ? 'low' : 'auto';
    return base;
  } catch { return base; }
}
export function save(profile: Profile): boolean { try { localStorage.setItem(SAVE_KEY, JSON.stringify(profile)); return true; } catch { return false; } }
export function reward(profile: Profile, match: Combat) {
  const win = match.winner === 'player', draw = match.winner === 'draw';
  const fans = (win ? 85 : draw ? 45 : 25) + match.stats.combos * 15 + Math.min(20, match.stats.dodges * 5);
  const coins = win ? 60 : draw ? 35 : 25;
  profile.fans += fans; profile.coins += coins; profile.matches++; if (win) profile.wins++;
  profile.damage += match.stats.damage; profile.combos += match.stats.combos;
  return { fans, coins, win, draw };
}
