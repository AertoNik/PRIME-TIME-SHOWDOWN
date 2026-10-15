// Verifies that an Alpha 1.0 save (schema v1) loads into the current schema without losing progress.
import { sanitize } from '../src/meta/SaveSystem';

const alpha10 = {
  version: 1,
  orgName: 'MY STUDIO',
  money: 2345,
  reputation: 180,
  matches: 9, wins: 7, losses: 2, draws: 0, bestRating: 84, totalEarned: 3100, fansEarned: 2900,
  bestCombosInMatch: 4, bestPerfectsInMatch: 3, proWins: 2, championWins: 0,
  fighters: {
    ray: { unlocked: true, fans: 2400, wins: 5, losses: 1, draws: 0, matches: 6, bestRating: 84, deck: ['dash', 'power_shot', 'shield', 'adrenaline'] },
    bruno: { unlocked: true, fans: 4100, wins: 2, losses: 1, draws: 0, matches: 3, bestRating: 70, deck: ['shield', 'power_shot', 'overdrive', 'knockout'] },
    nika: { unlocked: false, fans: 1200, wins: 0, losses: 0, draws: 0, matches: 0, bestRating: 0, deck: ['shock', 'power_shot', 'smoke', 'system_overload'] },
  },
  selected: 'bruno',
  difficulty: 'pro',
  goals: { first_win: { done: true, claimed: true }, combo_3: { done: true, claimed: false } },
  settings: { sound: false, music: true, quality: 'medium' }, // no `camera` in 1.0
  nextRival: 'zoe', lastRival: 'dex', seed: 12345, hintsSeen: true,
};
const s = sanitize(JSON.parse(JSON.stringify(alpha10)));
const checks: [string, boolean][] = [
  ['money kept', s.money === 2345],
  ['reputation kept', s.reputation === 180],
  ['bruno still signed', s.fighters.bruno.unlocked && s.fighters.bruno.fans === 4100],
  ['selected kept', s.selected === 'bruno'],
  ['difficulty kept', s.difficulty === 'pro'],
  ['goals kept', s.goals.first_win.claimed && s.goals.combo_3.done && !s.goals.combo_3.claimed],
  ['settings kept', s.settings.sound === false && s.settings.quality === 'medium'],
  ['new camera setting defaulted', s.settings.camera === 'full'],
  ['decks kept', s.fighters.ray.deck.join() === 'dash,power_shot,shield,adrenaline'],
  ['corrupt input safe', sanitize('not json' as unknown).money === 150],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
}
console.log(ok ? 'save migration: OK' : 'save migration: FAILED');
