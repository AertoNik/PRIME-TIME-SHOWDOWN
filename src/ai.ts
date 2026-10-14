import { CARDS, type CardId } from './data';
import type { Fighter } from './combat';
export type Tactic = 'aggressive' | 'tactical' | 'evasive';
export const BOT_DECKS: Record<Tactic, CardId[]> = {
  aggressive: ['dash', 'power', 'shock', 'overdrive'],
  tactical: ['shield', 'power', 'shock', 'overdrive'],
  evasive: ['dash', 'smoke', 'shield', 'power'],
};
export function preferredRange(range: number, tactic: Tactic) { return range * (tactic === 'aggressive' ? 0.8 : tactic === 'evasive' ? 1.12 : 0.96); }

// Only public combat state is used. Bots pay the same costs and obey their four-card cycle.
export function botChoice(f: Fighter, other: Fighter, hand: CardId[], threatAge: number, random: number): CardId | null {
  if (f.stun > 0 || f.windup > 0) return null;
  if (other.windup > 0 && threatAge < 0.32) return null;
  const available = (id: CardId) => hand.includes(id) && f.energy >= CARDS[id].cost;
  if (other.windup > 0 && threatAge >= 0.32) {
    const order: CardId[] = f.tactic === 'evasive' ? ['dash', 'shield', 'shock'] : ['shield', 'shock', 'dash'];
    return order.find(available) ?? null;
  }
  if (f.shieldWindow > 0 && available('overdrive')) return 'overdrive';
  if ((f.dashWindow > 0 || other.stun > 0) && available('power')) return 'power';
  if (f.tactic === 'tactical' && f.energy < 7) return null;
  if (other.shield <= 0 && other.dodge <= 0 && other.smoke <= 0 && available('power') && (f.energy >= 6 || f.tactic === 'aggressive')) return 'power';
  if (f.energy < 6) return null;
  if (f.tactic === 'tactical' && available('shield') && available('overdrive')) return 'shield';
  if (other.stun <= 0 && available('shock') && (f.energy >= 7 || random < 0.2)) return 'shock';
  if (f.tactic === 'evasive' && f.smoke <= 0 && available('smoke')) return 'smoke';
  if (f.overdrive <= 0 && available('overdrive')) return 'overdrive';
  if (f.shield <= 0 && available('shield') && f.hp < 160) return 'shield';
  if (available('dash') && f.energy >= 8) return 'dash';
  return null;
}
