// Headless checks for the Alpha 1.3 game modes (npm run modes).
// Part 1: rules, one-time rewards, records, saves and seasonal-event integration
//         (fake clock + in-memory save, like events-check).
// Part 2: balance report — real headless fights with the scripted players from bots.ts.
//         Usage: npm run modes [runsPerCell]   (0 skips the balance report)
import { CHALLENGES, PERKS, SURVIVAL, challengeById } from '../src/config/modes.config';
import { BOSSES } from '../src/config/boss.config';
import { FIGHTERS, RIVALS, RIVAL_ORDER } from '../src/config/fighters';
import type { FighterId } from '../src/config/types';
import { Match } from '../src/combat/Match';
import type { MatchResultData } from '../src/combat/types';
import { CareerSystem } from '../src/meta/CareerSystem';
import { EventManager } from '../src/meta/EventManager';
import { GameModes, evaluateChallenge } from '../src/meta/GameModes';
import { defaultSave, sanitize, type SaveData, type SaveSystem } from '../src/meta/SaveSystem';
import { runMatch, type Mode } from './bots';

class MemSave {
  data: SaveData = defaultSave();
  save(): void {
    this.data = sanitize(JSON.parse(JSON.stringify(this.data))); // round-trip like localStorage
  }
  get persistent(): boolean {
    return true;
  }
  reset(): void {
    this.data = defaultSave();
  }
}

const T = (iso: string) => Date.parse(iso);
let now = T('2026-10-25T12:00:00Z'); // inside Halloween Premiere
const clock = () => now;
const auto = { mode: 'auto' as const, forcedEventId: 'none' };

function world(store = new MemSave()) {
  const s = store as unknown as SaveSystem;
  const career = new CareerSystem(s);
  const events = new EventManager(s, { clock, settings: auto });
  const modes = new GameModes(s, career, events, clock);
  return { store, career, events, modes };
}

function result(p: Partial<MatchResultData>): MatchResultData {
  return {
    outcome: 'win',
    method: 'ko',
    rating: 70,
    peakRating: 80,
    avgRating: 60,
    bestCombo: null,
    combos: 2,
    comboList: ['counter_strike', 'iron_rush'],
    perfects: 1,
    damageDealt: 9000,
    damageTaken: 4000,
    cardsUsed: 10,
    duration: 60,
    playerHpFrac: 0.6,
    enemyHpFrac: 0,
    finisher: false,
    ...p,
  };
}

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);

// ------------------------------------------------------------ match modifiers
{
  const classic = new Match({ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, rival: 'dex', difficulty: 'rookie', seed: 1, fans: 0 });
  check('Classic Duel unchanged: 75 s, full HP, regen ×1', classic.duration === 75 && classic.timeLeft === 75 && classic.fighters[0].hp === classic.fighters[0].maxHp && classic.hands[0].regenMult === 1);
  const m = new Match({
    fighter: 'vega',
    deck: FIGHTERS.vega.defaultDeck,
    rival: 'tank',
    difficulty: 'pro',
    seed: 2,
    fans: 0,
    mods: { duration: 55, energyMult: 1.5, rivalEnergyMult: 1.5, playerHpFrac: 0.5, playerDmgMult: 1.24, rivalHpMult: 1.1 },
  });
  const p = m.fighters[0];
  const e = m.fighters[1];
  check('mods: 55 s fight', m.duration === 55 && m.timeLeft === 55);
  check('mods: energy ×1.5 for both sides', m.hands[0].regenMult === 1.5 && Math.abs(m.hands[1].regenMult - 1.5) < 1e-9);
  check('mods: player starts with carried HP', p.hp === Math.round(p.maxHp * 0.5) && p.startHp === p.hp);
  check('mods: POWER SURGE raises outgoing damage', Math.abs(p.outgoingDamageMult() - 1.24) < 1e-9);
  check('mods: rival HP multiplier on top of difficulty', e.maxHp === Math.round(16800 * 1.05 * 1.1));
  // energy really fills faster
  const a = new Match({ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, rival: 'dex', difficulty: 'rookie', seed: 3, fans: 0 });
  const b = new Match({ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, rival: 'dex', difficulty: 'rookie', seed: 3, fans: 0, mods: { energyMult: 1.5 } });
  for (const x of [a, b]) {
    x.hands[0].energy = 0;
    x.hands[0].update(2);
  }
  check('ENERGY RUSH: energy gain is 1.5× in the same time', Math.abs(b.hands[0].energy / a.hands[0].energy - 1.5) < 1e-6 && b.hands[0].energy <= 10);
  b.hands[0].update(60);
  check('ENERGY RUSH: energy still capped at 10', b.hands[0].energy === 10);
  // time-up with carried damage: whoever lost less HP this fight wins
  const t = new Match({ fighter: 'bruno', deck: FIGHTERS.bruno.defaultDeck, rival: 'dex', difficulty: 'rookie', seed: 4, fans: 0, mods: { duration: 0.05, playerHpFrac: 0.4 } });
  let guard = 0;
  while (t.phase === 'intro' && guard++ < 1000) t.step(1 / 60);
  t.fighters[0].hp = t.fighters[0].startHp - 100;
  t.fighters[1].hp = t.fighters[1].maxHp - 3000;
  while (t.phase !== 'over' && guard++ < 2000) t.step(1 / 60);
  check('Survival time-up: carried damage is not held against the player', t.result?.method === 'time' && t.winner === 0 && t.fighters[0].hpFrac < t.fighters[1].hpFrac);
}

// ------------------------------------------------------------------ survival
{
  const w = world();
  const { store, modes } = w;
  for (let seed = 1; seed < 200; seed++) {
    const r = modes.planRivals(seed);
    const ok = r.length === 5 && r.every((x) => RIVAL_ORDER.includes(x)) && r.every((x, i) => i === 0 || x !== r[i - 1]) && new Set(r).size === RIVAL_ORDER.length;
    if (!ok) {
      check(`rival plan valid for seed ${seed}`, false);
      break;
    }
  }
  check('rival plan: 5 waves, every rival appears, never the same twice in a row (199 seeds)', !checks.some(([n, p]) => n.startsWith('rival plan valid') && !p));

  store.data.money = 1000;
  const run = modes.startRun('ray', FIGHTERS.ray.defaultDeck, 'halloween-2026', 77);
  check('run starts at wave 1 with full HP and no bonuses', run.wave === 0 && run.hpFrac === 1 && Object.values(run.perks).every((v) => v === 0) && store.data.modes.survival.active?.id === run.id);
  const s0 = modes.waveSetup(store.data.modes.survival.active!);
  check('wave 1: rookie AI, no player bonuses', s0.difficulty === 'rookie' && s0.mods.playerHpFrac === 1 && s0.mods.energyMult === 1 && s0.mods.playerDmgMult === 1);
  const o1 = modes.recordWave(run.id, result({ rating: 70 }), 0.55)!;
  let act = store.data.modes.survival.active!;
  check('win: next wave, heal +20% (not to full), bonus pending', o1.won && act.wave === 1 && Math.abs(act.hpFrac - 0.75) < 1e-9 && act.pendingPerk && o1.summary === null);
  check('no next fight before the bonus is picked', modes.recordWave(run.id, result({}), 0.5) === null);
  check('power surge picked', modes.choosePerk(run.id, 'power_surge'));
  act = store.data.modes.survival.active!;
  check('only one bonus per cleared wave', !modes.choosePerk(run.id, 'energy_boost') && act.perks.energy_boost === 0);
  const s1 = modes.waveSetup(act);
  check('wave 2 carries HP and POWER SURGE', s1.mods.playerHpFrac === act.hpFrac && Math.abs(s1.mods.playerDmgMult! - (1 + PERKS.power_surge.value)) < 1e-9 && s1.index === 1);
  modes.recordWave(run.id, result({ rating: 82 }), 0.9);
  act = store.data.modes.survival.active!;
  check('heal never exceeds 100%', act.hpFrac === 1);
  modes.choosePerk(run.id, 'power_surge');
  modes.recordWave(run.id, result({ rating: 60 }), 0.3);
  check('POWER SURGE capped at 2 stacks', !modes.choosePerk(run.id, 'power_surge') && modes.perkOptions(store.data.modes.survival.active!).find((p) => p.def.id === 'power_surge')!.available === false);
  modes.choosePerk(run.id, 'second_wind');
  act = store.data.modes.survival.active!;
  check('SECOND WIND heals 30% on top of the wave heal', Math.abs(act.hpFrac - Math.min(1, 0.3 + SURVIVAL.healBetween + PERKS.second_wind.value)) < 1e-9);
  const s3 = modes.waveSetup(act);
  check('wave 4: pro AI, bonuses still active', s3.difficulty === 'pro' && Math.abs(s3.mods.playerDmgMult! - 1.24) < 1e-9);
  const tokensBefore = w.events.tokens();
  const marathonBefore = w.events.quests().find((q) => q.def.id === 'midnight_marathon')!.progress;
  const moneyBefore = store.data.money;
  const lost = modes.recordWave(run.id, result({ outcome: 'loss', method: 'ko', rating: 40, combos: 1, comboList: ['counter_strike'] }), 0)!;
  const sum = lost.summary!;
  check('defeat ends the marathon', !lost.won && sum.end === 'defeat' && store.data.modes.survival.active === null && sum.cleared === 3);
  check('reward paid once for the 3 cleared waves', store.data.money - moneyBefore === sum.reward.money && sum.reward.money > 0 && sum.lines.filter((l) => l.label.startsWith('Волна')).length === 3);
  check('records: best wave 3, score = sum of cleared ratings', store.data.modes.survival.bestWave === 3 && store.data.modes.survival.bestScore === 70 + 82 + 60 && sum.newRecord);
  check('a finished attempt cannot be counted again', modes.recordWave(run.id, result({}), 1) === null && modes.retire(run.id) === null && modes.closeAbandoned() === null && store.data.money === moneyBefore + sum.reward.money);
  check('event: the whole attempt counts as ONE match', w.events.quests().find((q) => q.def.id === 'midnight_marathon')!.progress === marathonBefore + 1 && sum.event !== null);
  check('event: tokens no more than one match can give', w.events.tokens() - tokensBefore <= 11 && w.events.tokens() - tokensBefore === sum.event!.tokens);
  check('event: real combos from every wave are summed', w.events.quests().find((q) => q.def.id === 'combo_carnival')!.progress === 2 * 3 + 1);

  // new attempt: bonuses and HP start from scratch
  const run2 = modes.startRun('ray', FIGHTERS.ray.defaultDeck, null, 5);
  const fresh = modes.waveSetup(store.data.modes.survival.active!);
  check('bonuses do not carry into a new attempt', fresh.mods.playerDmgMult === 1 && fresh.mods.energyMult === 1 && fresh.mods.playerHpFrac === 1);
  // full clear twice: completion each time, first-clear bonus once
  for (let i = 0; i < 5; i++) {
    modes.recordWave(run2.id, result({ rating: 75 }), 0.7);
    if (store.data.modes.survival.active?.pendingPerk) modes.choosePerk(run2.id, i % 2 ? 'energy_boost' : 'second_wind');
  }
  const runs = store.data.modes.survival;
  check('five wins complete the marathon', runs.completions === 1 && runs.bestWave === 5 && runs.firstClearPaid && runs.active === null);
  const m3 = store.data.money;
  const run3 = modes.startRun('nika', FIGHTERS.nika.defaultDeck, null, 9);
  let last = null;
  for (let i = 0; i < 5; i++) {
    last = modes.recordWave(run3.id, result({ rating: 75 }), 0.7);
    if (store.data.modes.survival.active?.pendingPerk) modes.choosePerk(run3.id, 'second_wind');
  }
  check('second full clear: completion bonus yes, first-clear bonus no', !!last?.summary && !last.summary.firstClear && !last.summary.lines.some((l) => l.label === 'Первое прохождение') && store.data.money - m3 === last.summary.reward.money);
  check('energy boost capped at 2 stacks', PERKS.energy_boost.maxStacks === 2);

  // forfeit: no seasonal credit
  const tk = w.events.tokens();
  const run4 = modes.startRun('ray', FIGHTERS.ray.defaultDeck, 'halloween-2026', 11);
  const f = modes.recordWave(run4.id, result({ outcome: 'loss', method: 'forfeit', rating: 20 }), 0.8)!;
  check('forfeit in wave 1: marathon over, no tokens, no participation fee', f.summary!.end === 'forfeit' && w.events.tokens() === tk && f.summary!.reward.money === 0);

  // reload in the middle of an attempt
  const run5 = modes.startRun('vega', FIGHTERS.vega.defaultDeck, null, 13);
  modes.recordWave(run5.id, result({ rating: 66 }), 0.6);
  modes.choosePerk(run5.id, 'energy_boost');
  modes.recordWave(run5.id, result({ rating: 71 }), 0.4);
  const reloaded = world(Object.assign(new MemSave(), { data: sanitize(JSON.parse(JSON.stringify(store.data))) }));
  check('reload: the attempt in progress is still in the save', reloaded.store.data.modes.survival.active?.id === run5.id && reloaded.store.data.modes.survival.active.waves.length === 2);
  const money5 = reloaded.store.data.money;
  const ab = reloaded.modes.closeAbandoned()!;
  check('reload: interrupted attempt closes with its 2 cleared waves (no free win)', ab.end === 'abandoned' && ab.cleared === 2 && reloaded.store.data.money - money5 === ab.reward.money && reloaded.store.data.modes.survival.active === null);
  check('reload: closing it again pays nothing', reloaded.modes.closeAbandoned() === null);
  const again = sanitize(JSON.parse(JSON.stringify(reloaded.store.data)));
  check('records survive a reload', again.modes.survival.bestWave === 5 && again.modes.survival.completions === 2 && again.modes.survival.firstClearPaid && again.modes.survival.bestByFighter.vega === 2);
}

// ---------------------------------------------------------------- challenges
{
  const hs = challengeById('high_stakes')!;
  const sp = challengeById('spotlight')!;
  const er = challengeById('energy_rush')!;
  check('HIGH STAKES: KO win clears', evaluateChallenge(hs, result({ method: 'ko' })).cleared);
  check('HIGH STAKES: time win with 5% lead does not clear', !evaluateChallenge(hs, result({ method: 'time', playerHpFrac: 0.5, enemyHpFrac: 0.45 })).cleared);
  check('HIGH STAKES: time win with 15% lead clears', evaluateChallenge(hs, result({ method: 'time', playerHpFrac: 0.6, enemyHpFrac: 0.45 })).cleared);
  check('HIGH STAKES: 55 s and higher purse', hs.mods.duration === 55 && hs.moneyMult > 1);
  check('PRIME SPOTLIGHT: win with rating 65 does not clear', !evaluateChallenge(sp, result({ rating: 65 })).cleared);
  check('PRIME SPOTLIGHT: win with rating 80 clears', evaluateChallenge(sp, result({ rating: 80 })).cleared);
  check('PRIME SPOTLIGHT: rating 90 but a loss does not clear', !evaluateChallenge(sp, result({ outcome: 'loss', rating: 90 })).cleared);
  check('ENERGY RUSH: a win clears, player regen ×1.5, rival ×1.25', evaluateChallenge(er, result({})).cleared && er.mods.energyMult === 1.5 && er.mods.rivalEnergyMult === 1.25);
  check('forfeit never clears a challenge', !evaluateChallenge(er, result({ method: 'forfeit' })).cleared);

  const w = world();
  const { store, modes } = w;
  const m0 = store.data.money;
  const r1 = modes.recordChallenge('spotlight', result({ rating: 65 }), 'ray')!;
  check('spotlight failed: attempt counted, no reward', !r1.cleared && r1.firstClear === null && store.data.money === m0 && modes.progress('spotlight').attempts === 1);
  const r2 = modes.recordChallenge('spotlight', result({ rating: 84 }), 'ray')!;
  check('first clear pays its reward once', r2.cleared && r2.firstClear?.money === sp.firstClear.money && store.data.money - m0 === sp.firstClear.money && modes.progress('spotlight').firstClearAt > 0);
  const r3 = modes.recordChallenge('spotlight', result({ rating: 91 }), 'nika')!;
  check('repeat clear: no first-clear reward, new best rating', r3.cleared && r3.firstClear === null && store.data.money - m0 === sp.firstClear.money && r3.newBest && modes.progress('spotlight').best === 91);
  modes.recordChallenge('high_stakes', result({ method: 'ko', duration: 48.2 }), 'ray');
  const fast = modes.recordChallenge('high_stakes', result({ method: 'ko', duration: 39.5 }), 'ray')!;
  const slow = modes.recordChallenge('high_stakes', result({ method: 'ko', duration: 50 }), 'ray')!;
  check('HIGH STAKES record = fastest win', fast.newBest && !slow.newBest && modes.progress('high_stakes').best === 40);
  modes.recordChallenge('energy_rush', result({ combos: 4 }), 'bruno');
  const more = modes.recordChallenge('energy_rush', result({ combos: 7 }), 'bruno')!;
  check('ENERGY RUSH record = most combos', more.newBest && modes.progress('energy_rush').best === 7);
  const back = world(Object.assign(new MemSave(), { data: sanitize(JSON.parse(JSON.stringify(store.data))) }));
  const m1 = back.store.data.money;
  const r4 = back.modes.recordChallenge('spotlight', result({ rating: 88 }), 'ray')!;
  check('after reload: first-clear reward is not paid again', r4.cleared && r4.firstClear === null && back.store.data.money === m1 && back.modes.progress('spotlight').clears === 3);
  check('every challenge has rules, a goal and a first-clear reward', CHALLENGES.length === 3 && CHALLENGES.every((c) => c.rules.length > 0 && c.firstClear.money > 0 && !!c.goalShort));
}

// ----------------------------------------------------------- career + saves
{
  const w = world();
  const s = w.store.data;
  const next = s.nextRival;
  w.career.applyMatch(result({}), 'ray', 'rookie', 'zoe', { rotateRival: false, moneyMult: 1.25, moneyLabel: 'Высокие ставки' });
  check('challenge fight does not change the Classic next opponent', s.nextRival === next && s.matches === 1);
  const plain = w.career.computeRewards(result({}), 'ray', 'rookie');
  const high = w.career.computeRewards(result({}), 'ray', 'rookie', { moneyMult: 1.25 });
  check('HIGH STAKES purse ×1.25', high.money === plain.money + Math.round(plain.money * 0.25));
  w.career.applyMatch(result({}), 'ray', 'rookie', 'zoe');
  check('Classic Duel still rotates the next opponent', w.store.data.lastRival === 'zoe');

  const v3 = { version: 3, money: 4321, reputation: 500, fighters: { ray: { unlocked: true, fans: 900 }, vega: { unlocked: true, fans: 3000 } }, selected: 'vega', events: { 'halloween-2026': { tokens: 42 } }, cosmetics: { owned: ['card_pumpkin'], equipped: { cardStyle: 'card_pumpkin' } }, settings: { sound: false, music: true, quality: 'low', camera: 'off' } };
  const m = sanitize(v3);
  check('Alpha 1.2.5 save (v3) loads: money, fighters, tokens, cosmetics, settings kept', m.money === 4321 && m.fighters.vega.unlocked && m.selected === 'vega' && m.events['halloween-2026'].tokens === 42 && m.cosmetics.equipped.cardStyle === 'card_pumpkin' && m.settings.camera === 'off' && !m.settings.sound);
  check('Alpha 1.2.5 save gets empty mode records', m.modes.survival.runs === 0 && m.modes.survival.active === null && Object.keys(m.modes.challenges).length === 0);
  const junk = sanitize({ modes: { survival: { bestWave: 99, runs: -3, active: { fighter: 'nobody', rivals: [] } }, challenges: { spotlight: { attempts: 'x', clears: 4, firstClearAt: 5 } } } });
  check('corrupt mode data is cleaned', junk.modes.survival.bestWave === 5 && junk.modes.survival.runs === 0 && junk.modes.survival.active === null && junk.modes.challenges.spotlight.attempts === 4);
  check('save version is 5', defaultSave().version === 5);
}

// ----------------------------------------------------------------- boss fight
{
  const def = BOSSES.vale;
  const mods = { duration: def.duration, introTime: def.introTime, timeUpRule: 'rival' as const };
  const mk = (seed: number, extra = {}) => new Match({ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, rival: 'vale', difficulty: 'pro', seed, fans: 0, mods: { ...mods, ...extra }, boss: 'vale' });
  const m = mk(1);
  const boss = m.fighters[1];
  check('boss: 2:00 fight, longer intro, champion AI', m.duration === 120 && m.introTime === 5.6 && m.difficulty.id === 'champion' && !!m.boss);
  check('boss: 23 800 HP, phase-1 deck and personality', boss.maxHp === Math.round(13600 * (RIVALS.vale.mods!.hpMult ?? 1)) && m.hands[1].deck.join() === def.phases[0].deck.join() && m.ais[1].profile.behavior.label === def.phases[0].behavior.label);
  check('boss is not a regular opponent (Classic / Survival never pick him)', !RIVAL_ORDER.includes('vale'));
  let guard = 0;
  while (m.phase === 'intro' && guard++ < 2000) m.step(1 / 60);
  check('boss intro lasts 5.6 s before FIGHT', Math.abs(m.clock - 5.6) < 0.05);
  const evs: string[] = [];
  const drain = () => {
    for (const e of m.drainEvents()) if (e.type === 'bossPhase' || e.type === 'bossMove') evs.push(e.type === 'bossPhase' ? 'phase' + e.phase : e.move);
  };
  m.drainEvents();
  boss.hp = Math.round(boss.maxHp * 0.6);
  m.step(1 / 60);
  drain();
  check('phase 2 at 65%: event, new deck, pressure AI, STAR POWER', m.boss!.phase === 2 && evs.includes('phase2') && evs.includes('star') && m.hands[1].deck.includes('prime_pulse') && m.ais[1].profile.behavior.pressure > 0 && boss.overdrive > 0);
  for (let i = 0; i < 120; i++) m.step(1 / 60);
  drain();
  check('phase 2 announced only once', evs.filter((x) => x === 'phase2').length === 1);
  boss.hp = Math.round(boss.maxHp * 0.25);
  m.step(1 / 60);
  drain();
  check('phase 3 at 30%: FINAL BROADCAST with the stronger PRIME PULSE', m.boss!.phase === 3 && evs.includes('phase3') && !!def.phases[2].pulse);
  const two = mk(2);
  guard = 0;
  while (two.phase === 'intro' && guard++ < 2000) two.step(1 / 60);
  two.drainEvents();
  two.fighters[1].hp = Math.round(two.fighters[1].maxHp * 0.2);
  two.step(1 / 60);
  const pe = two.drainEvents().filter((e) => e.type === 'bossPhase').length;
  check('a huge hit crossing both thresholds still announces both phases', two.boss!.phase === 3 && pe === 2);
  const t = mk(3, { duration: 0.05 });
  guard = 0;
  while (t.phase !== 'over' && guard++ < 3000) {
    if (t.phase === 'fight') t.fighters[1].hp = Math.round(t.fighters[1].maxHp * 0.1);
    t.step(1 / 60);
  }
  check('time-up in a boss fight: the champion keeps the title (knockout only)', t.result?.method === 'time' && t.winner === 1 && t.result.bossPhase === 3);
  const classic = new Match({ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, rival: 'dex', difficulty: 'pro', seed: 4, fans: 0 });
  check('Classic Duel has no boss logic and the usual 3.4 s intro', classic.boss === null && classic.introTime === 3.4 && classic.result === null);

  // rewards, records, saves
  const w = world();
  const { store, modes } = w;
  const m0 = store.data.money;
  const l1 = modes.recordBoss('vale', result({ outcome: 'loss', method: 'ko', bossPhase: 2, enemyHpFrac: 0.41, duration: 80 }), 'ray')!;
  check('lost boss fight: attempt and best result saved, no reward', !l1.won && l1.firstWin === null && store.data.money === m0 && l1.progress.bestPhase === 2 && Math.abs(l1.progress.bestBossHp - 0.41) < 1e-9);
  const w1 = modes.recordBoss('vale', result({ outcome: 'win', method: 'ko', bossPhase: 3, enemyHpFrac: 0, duration: 97.2, rating: 88 }), 'vega')!;
  const fw = def.rewards.firstWin;
  const c = store.data.cosmetics;
  check('first win pays money, fans, reputation and the PRIME LEGEND title once', !!w1.firstWin && store.data.money - m0 === fw.money && w1.cosmeticNew && c.owned.includes('title_prime_legend') && c.equipped.title === 'title_prime_legend');
  check('first win recorded with time, rating and fighter', w1.progress.firstWinAt > 0 && w1.progress.wins === 1 && w1.progress.bestTime === 98 && w1.progress.bestRating === 88 && w1.progress.winsByFighter.vega === 1);
  const m1 = store.data.money;
  const w2 = modes.recordBoss('vale', result({ outcome: 'win', method: 'ko', bossPhase: 3, enemyHpFrac: 0, duration: 85, rating: 80 }), 'ray')!;
  check('second win: no first-win reward again, new best time', w2.firstWin === null && !w2.cosmeticNew && store.data.money === m1 && w2.progress.bestTime === 85 && w2.newBestTime && w2.progress.bestRating === 88);
  const f = modes.recordBoss('vale', result({ outcome: 'loss', method: 'forfeit', bossPhase: 1, enemyHpFrac: 0.05 }), 'ray')!;
  check('forfeit counts as an attempt but never as a best result', !f.won && f.progress.attempts === 4 && Math.abs(f.progress.bestBossHp - 0.41) < 1e-9);
  for (let i = 0; i < 12; i++) modes.recordBoss('vale', result({ outcome: 'loss', bossPhase: 1, enemyHpFrac: 0.9 }), 'nika');
  check('fight history keeps the last 10 attempts', modes.bossProgress('vale').history.length === 10);
  const back = world(Object.assign(new MemSave(), { data: sanitize(JSON.parse(JSON.stringify(store.data))) }));
  const m2 = back.store.data.money;
  const w3 = back.modes.recordBoss('vale', result({ outcome: 'win', method: 'ko', bossPhase: 3, enemyHpFrac: 0, duration: 99 }), 'ray')!;
  check('after reload: records kept, first-win reward not paid again', w3.firstWin === null && back.store.data.money === m2 && w3.progress.wins === 3 && back.store.data.cosmetics.owned.filter((x) => x === 'title_prime_legend').length === 1);
  const v4 = sanitize({ version: 4, money: 900, modes: { survival: { runs: 3, bestWave: 4 }, challenges: { spotlight: { attempts: 2, clears: 1, firstClearAt: 5 } } } });
  check('Alpha 1.3 save (v4) loads: Survival/Challenge kept, empty boss records', v4.modes.survival.bestWave === 4 && v4.modes.challenges.spotlight.clears === 1 && Object.keys(v4.modes.boss).length === 0 && v4.money === 900);
  const junk = sanitize({ modes: { boss: { vale: { wins: 'x', attempts: 2, bestPhase: 9, bestBossHp: -1, history: [{ fighter: 'nobody' }, { fighter: 'ray', phase: 7, won: true }] } } } });
  check('corrupt boss data is cleaned', junk.modes.boss.vale.bestPhase === 3 && junk.modes.boss.vale.bestBossHp === 0 && junk.modes.boss.vale.history.length === 1 && junk.modes.boss.vale.history[0].phase === 3);
}

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
}
console.log(ok ? `modes: OK (${checks.length} checks)` : 'modes: FAILED');
if (!ok) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;

// ------------------------------------------------------------ balance report
const N = Number((globalThis as { process?: { argv?: string[] } }).process?.argv?.[2] ?? 12);
if (N > 0) {
  const fighters: FighterId[] = ['ray', 'bruno', 'nika', 'vega'];
  console.log(`\nSURVIVAL balance: ${N} marathons per cell (bot picks a bonus by HP: <55% SECOND WIND, else POWER SURGE / ENERGY BOOST)`);
  console.log('fighter  player  avgWaves  reach3  clear5  avgHPin5  dur(min)');
  const modesOf: Mode[] = ['mash', 'combo'];
  for (const f of fighters) {
    for (const mode of modesOf) {
      let waves = 0, reach3 = 0, clear = 0, hp5 = 0, hpN = 0, dur = 0;
      for (let i = 0; i < N; i++) {
        const store = new MemSave();
        const career = new CareerSystem(store as unknown as SaveSystem);
        const gm = new GameModes(store as unknown as SaveSystem, career, null, clock);
        const run = gm.startRun(f, FIGHTERS[f].defaultDeck, null, 500 + i * 37);
        let seed = 9000 + i * 7919;
        while (store.data.modes.survival.active) {
          const a = store.data.modes.survival.active;
          const ws = gm.waveSetup(a);
          if (ws.index === 4) {
            hp5 += ws.mods.playerHpFrac!;
            hpN++;
          }
          const { m } = runMatch(f, ws.rival, ws.difficulty, mode, seed++, a.deck, ws.mods);
          dur += m.time;
          const o = gm.recordWave(run.id, m.result!, m.fighters[0].hpFrac);
          if (!o) break;
          if (!o.summary) {
            const hpNow = store.data.modes.survival.active!.hpFrac;
            const opts = gm.perkOptions(store.data.modes.survival.active!).filter((p) => p.available).map((p) => p.def.id);
            const pick = hpNow < 0.55 && opts.includes('second_wind') ? 'second_wind' : opts.includes('power_surge') ? 'power_surge' : opts.includes('energy_boost') ? 'energy_boost' : 'second_wind';
            gm.choosePerk(run.id, pick);
          } else {
            waves += o.summary.cleared;
            if (o.summary.cleared >= 3) reach3++;
            if (o.summary.end === 'complete') clear++;
          }
        }
      }
      const pc = (v: number) => `${Math.round((v / N) * 100)}%`.padStart(6);
      console.log(`${f.padEnd(8)} ${mode.padEnd(7)} ${(waves / N).toFixed(2).padStart(8)}  ${pc(reach3)}  ${pc(clear)}  ${(hpN ? (hp5 / hpN) * 100 : 0).toFixed(0).padStart(7)}%  ${(dur / N / 60).toFixed(1).padStart(7)}`);
    }
  }

  console.log(`\nBOSS FIGHT vs ${RIVALS.vale.fullName}: ${N} fights per cell, default decks (idle = no cards)`);
  console.log('fighter  player  win%  avgDur  phase reached 1/2/3  bossHpLeftOnLoss  rushes  spotlights');
  const bd = BOSSES.vale;
  for (const f of fighters) {
    for (const mode of ['idle', 'mash', 'combo'] as Mode[]) {
      let win = 0, dur = 0, left = 0, rush = 0, spot = 0;
      const ph = [0, 0, 0, 0];
      for (let i = 0; i < N; i++) {
        const { m, events } = runMatch(f, 'vale', 'pro', mode, 5000 + i * 7919, undefined, { duration: bd.duration, introTime: bd.introTime, timeUpRule: 'rival' }, 'vale');
        const r = m.result!;
        if (r.outcome === 'win') win++;
        else left += r.enemyHpFrac;
        dur += r.duration;
        ph[r.bossPhase ?? 1]++;
        rush += events.get('rivalCard:knockout') ?? 0;
        spot += events.get('rivalCard:charged_shot') ?? 0;
      }
      const lost = N - win;
      console.log(`${f.padEnd(8)} ${mode.padEnd(7)} ${String(Math.round((win / N) * 100)).padStart(4)}%  ${(dur / N).toFixed(0).padStart(5)}s  ${`${ph[1]}/${ph[2]}/${ph[3]}`.padStart(9)}            ${lost ? String(Math.round((left / lost) * 100)).padStart(3) + '%' : '   -'}        ${(rush / N).toFixed(1).padStart(4)}  ${(spot / N).toFixed(1).padStart(5)}`);
    }
  }

  console.log(`\nPRIME CHALLENGE: clear rate, ${N} fights per cell (combo = deliberate player, mash = random cards)`);
  console.log('challenge     fighter  diff     mash   combo  avgDur  avgRating(combo)');
  for (const def of CHALLENGES) {
    for (const f of fighters) {
      for (const diff of ['rookie', 'pro'] as const) {
        const rate: Record<string, number> = {};
        let d = 0, rt = 0;
        for (const mode of ['mash', 'combo'] as Mode[]) {
          let c = 0;
          for (let i = 0; i < N; i++) {
            const { m } = runMatch(f, def.rival, diff, mode, 31337 + i * 911, undefined, { duration: def.mods.duration, energyMult: def.mods.energyMult, rivalEnergyMult: def.mods.rivalEnergyMult });
            if (evaluateChallenge(def, m.result!).cleared) c++;
            if (mode === 'combo') {
              d += m.result!.duration;
              rt += m.result!.rating;
            }
          }
          rate[mode] = c;
        }
        const pc = (v: number) => `${Math.round((v / N) * 100)}%`.padStart(5);
        console.log(`${def.id.padEnd(13)} ${f.padEnd(8)} ${diff.padEnd(8)} ${pc(rate.mash)}  ${pc(rate.combo)}  ${(d / N).toFixed(0).padStart(5)}  ${(rt / N).toFixed(0).padStart(6)}`);
      }
    }
  }
}
