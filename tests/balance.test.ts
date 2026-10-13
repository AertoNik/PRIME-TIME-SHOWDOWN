import { it, expect } from 'vitest';
import { Combat } from '../src/combat';
import { DEFAULT_DECK, type WeaponId } from '../src/data';
function rng(seed: number) { return () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
it('finishes varied seeded duels with valid bounds and lets timed card play win', () => {
 let passiveWins = 0, activeWins = 0, showtimes = 0;
 for (const weapon of ['pistol','shotgun','carbine'] as WeaponId[]) for (let seed = 1; seed <= 12; seed++) {
  for (const active of [false,true]) {
   const m = new Combat(weapon, [...DEFAULT_DECK], rng(seed));
   for(let frame = 0; frame < 4600 && !m.finished; frame++) {
    if (active && frame % 12 === 0) {
     const hand = m.cycle.hand;
     const index = (id: string) => hand.findIndex(c => c === id);
     if (m.enemy.windup > 0 && m.player.energy >= 3 && index('shock') >= 0) m.play(index('shock'));
     else if (m.enemy.windup > 0 && index('dash') >= 0) m.play(index('dash'));
     else if (m.enemy.windup > 0 && index('shield') >= 0) m.play(index('shield'));
     else if (m.player.energy >= 7 && index('shock') >= 0 && index('power') >= 0) m.play(index('shock'));
     else if (index('power') >= 0) m.play(index('power'));
     else if (m.player.energy >= 8) m.play(0);
    }
    m.update(1/60);
   }
   expect(m.finished).toBe(true); expect(m.elapsed).toBeLessThan(75.1);
   for(const f of [m.player,m.enemy]) { expect(Number.isFinite(f.hp)).toBe(true); expect(Math.abs(f.x)).toBeLessThanOrEqual(4.2); expect(Math.abs(f.z)).toBeLessThanOrEqual(4.7); expect(f.hp).toBeGreaterThanOrEqual(0); }
   if(m.winner === 'player') { if(active) activeWins++; else passiveWins++; }
   if(m.showtime) showtimes++;
  }
 }
 process.stdout.write(`72 seeded matches: passive wins ${passiveWins}/36; active wins ${activeWins}/36; SHOWTIME ${showtimes}/72\n`);
 expect(activeWins).toBeGreaterThan(passiveWins + 8); expect(activeWins).toBeGreaterThan(18);
});
