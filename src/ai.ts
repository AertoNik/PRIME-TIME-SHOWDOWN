export type Tactic = 'aggressive' | 'cautious';
export function preferredRange(range: number, tactic: Tactic) { return range * (tactic === 'aggressive' ? 0.82 : 1.08); }
export function botChoice(health: number, incoming: boolean, random: number): 'shield' | 'dash' | 'shock' | 'power' | 'overdrive' | 'smoke' {
  if (incoming) return random < 0.5 ? 'shield' : 'dash';
  if (health < 100 && random < 0.5) return 'shield';
  return random < 0.22 ? 'shock' : random < 0.56 ? 'power' : random < 0.8 ? 'overdrive' : 'smoke';
}
