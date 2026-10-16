// Verifies that Alpha 1.0 (schema v1) and Alpha 1.1 (schema v2) saves load into the
// current schema (v7, Alpha 1.4) without losing progress.
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
// Alpha 1.1 save: schema v2 with the camera setting and Nika signed.
const alpha11 = {
  ...alpha10,
  version: 2,
  money: 9870,
  reputation: 640,
  fighters: { ...alpha10.fighters, nika: { ...alpha10.fighters.nika, unlocked: true, fans: 3300, wins: 4, matches: 5 } },
  selected: 'nika',
  difficulty: 'champion',
  settings: { sound: true, music: false, quality: 'low', camera: 'reduced' },
};
const s = sanitize(JSON.parse(JSON.stringify(alpha10)));
const s11 = sanitize(JSON.parse(JSON.stringify(alpha11)));
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
  ['1.1: money and reputation kept', s11.money === 9870 && s11.reputation === 640],
  ['1.1: nika signed and selected', s11.fighters.nika.unlocked && s11.fighters.nika.fans === 3300 && s11.selected === 'nika'],
  ['1.1: difficulty kept', s11.difficulty === 'champion'],
  ['1.1: camera/sound/quality kept', s11.settings.camera === 'reduced' && s11.settings.music === false && s11.settings.quality === 'low'],
  // Alpha 1.2.5: the new fighter appears locked with its defaults; old progress is untouched
  ['1.2.5: Vega added, locked, default deck', !s.fighters.vega.unlocked && s.fighters.vega.deck.join() === 'dash,shield,overdrive,charged_shot' && s.fighters.vega.wins === 0],
  ['1.2.5: old fighters unchanged', s.fighters.ray.wins === 5 && s.fighters.bruno.fans === 4100],
  ['1.2.5: Crash accepted as next rival', sanitize({ ...alpha10, nextRival: 'crash' }).nextRival === 'crash'],
  // Alpha 1.3: game modes start empty on every old save; nothing else changes
  ['1.3: old saves get empty Survival / Challenge records', s.modes.survival.runs === 0 && s.modes.survival.bestWave === 0 && s.modes.survival.active === null && Object.keys(s.modes.challenges).length === 0 && s11.modes.survival.runs === 0],
  ['1.3: money, reputation and fighters untouched by the migration', s.money === alpha10.money && s.reputation === alpha10.reputation && s.fighters.ray.wins === 5],
  ['1.3: mode records round-trip', (() => {
    const v = sanitize(JSON.parse(JSON.stringify({ ...alpha11, modes: { survival: { runs: 4, completions: 1, bestWave: 5, bestScore: 402, firstClearPaid: true }, challenges: { spotlight: { attempts: 3, clears: 1, firstClearAt: 1790000000000, best: 86 } } } })));
    return v.modes.survival.bestWave === 5 && v.modes.survival.firstClearPaid && v.modes.challenges.spotlight.firstClearAt === 1790000000000 && v.modes.challenges.spotlight.best === 86;
  })()],
  // Alpha 1.3.1: boss progress starts empty; 1.3 records and the collection are untouched
  ['1.3.1: old saves get empty boss records', Object.keys(s.modes.boss).length === 0 && Object.keys(s11.modes.boss).length === 0],
  ['1.3.1: Alpha 1.3 records survive next to the boss block', (() => {
    const v = sanitize(JSON.parse(JSON.stringify({ ...alpha11, version: 4, modes: { survival: { runs: 6, bestWave: 3 }, challenges: { high_stakes: { attempts: 1, clears: 1, firstClearAt: 7 } } } })));
    return v.modes.survival.bestWave === 3 && v.modes.challenges.high_stakes.firstClearAt === 7 && Object.keys(v.modes.boss).length === 0;
  })()],
  ['1.3.1: boss records and the PRIME LEGEND title round-trip', (() => {
    const v = sanitize(JSON.parse(JSON.stringify({ ...alpha11, cosmetics: { owned: ['title_prime_legend'], equipped: { title: 'title_prime_legend' } }, modes: { boss: { vale: { attempts: 3, wins: 1, firstWinAt: 1790000000000, bestTime: 96, bestPhase: 3 } } } })));
    return v.modes.boss.vale.wins === 1 && v.modes.boss.vale.firstWinAt === 1790000000000 && v.cosmetics.equipped.title === 'title_prime_legend';
  })()],
  // Alpha 1.3.3: Classic Duel wins per fighter (BOSS FIGHT access). Old saves did not keep
  // them apart: all of the fighter's wins minus their boss wins.
  ['1.3.3: v1/v2 saves: every win was a Classic one', s.fighters.ray.classicWins === 5 && s.fighters.bruno.classicWins === 2 && s11.fighters.nika.classicWins === 4],
  ['1.3.3: v5 save: boss wins are not counted as Classic wins', (() => {
    const v = sanitize(JSON.parse(JSON.stringify({ ...alpha11, version: 5, modes: { boss: { vale: { attempts: 4, wins: 2, winsByFighter: { ray: 2 } } } } })));
    return v.fighters.ray.classicWins === 3 && v.fighters.ray.wins === 5 && v.fighters.bruno.classicWins === 2;
  })()],
  ['1.3.3: v6 counter kept as saved (never above total wins)', (() => {
    const f = { ...alpha11.fighters, ray: { ...alpha11.fighters.ray, classicWins: 4 }, bruno: { ...alpha11.fighters.bruno, classicWins: 99 } };
    const v = sanitize(JSON.parse(JSON.stringify({ ...alpha11, version: 6, fighters: f })));
    return v.fighters.ray.classicWins === 4 && v.fighters.bruno.classicWins === 2;
  })()],
  ['1.3.3: corrupt counter falls back to the estimate', sanitize({ ...alpha11, fighters: { ...alpha11.fighters, ray: { ...alpha11.fighters.ray, classicWins: 'x' } } }).fighters.ray.classicWins === 5],
  ['1.3.3: new fighters start with 0 Classic wins', s.fighters.vega.classicWins === 0],
  ['1.4: older saves start in the original studio (schema v7)', s.arena === 'original' && s11.arena === 'original' && s.version === 7],
  ['1.4: progress untouched by the arena migration', s11.money === 9870 && s11.fighters.nika.unlocked && s11.settings.camera === 'reduced'],
  ['1.4: arena preference round-trips by id (and RANDOM)', sanitize(JSON.parse(JSON.stringify({ ...alpha11, version: 7, arena: 'backlot' }))).arena === 'backlot' && sanitize({ ...alpha11, arena: 'random' }).arena === 'random'],
  ['1.4: unknown arena id falls back to the original studio', sanitize({ ...alpha11, arena: 'space_station' }).arena === 'original'],
  ['1.2.5: Vega progress round-trips', sanitize(JSON.parse(JSON.stringify({ ...alpha11, selected: 'vega', fighters: { ...alpha11.fighters, vega: { unlocked: true, fans: 2600, wins: 3, losses: 1, draws: 0, matches: 4, bestRating: 81, deck: ['dash', 'power_shot', 'overdrive', 'charged_shot'] } } }))).selected === 'vega'],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
}
console.log(ok ? 'save migration: OK' : 'save migration: FAILED');
