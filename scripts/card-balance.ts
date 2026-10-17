// Alpha 1.6 — CARD REVOLUTION balance report (npm run cardsim [runs]).
// Headless fights with the same seeds for the old and the new decks: every new card in
// every fighter's deck, archetype decks (attack / defence / traps / mixed / risk), all
// difficulties, the boss, Survival and ENERGY RUSH. Players: the deliberate human-like bot
// ('combo', see bots.ts) and the AI pilot ('smart'). Per card: uses, damage per use and per
// energy point, how often its effect landed, combos; per deck: wins, fight length, control time.
import { CARDS, NEW_CARDS } from '../src/config/cards';
import { FIGHTERS, FIGHTER_ORDER, RIVAL_ORDER } from '../src/config/fighters';
import { SURVIVAL, challengeById } from '../src/config/modes.config';
import { bossById } from '../src/config/boss.config';
import type { CardId, Difficulty, FighterId, RivalId } from '../src/config/types';
import type { MatchMods } from '../src/combat/Match';
import type { MatchEvent } from '../src/combat/types';
import { Match } from '../src/combat/Match';
import { comboBot, AUTO, type BotState, type Mode } from './bots';

const argv = (globalThis as { process?: { argv?: string[] } }).process?.argv ?? [];
const N = Number(argv[2] ?? 8);
/** Optional third argument: the sections to run, e.g. "1,2" (default: all). */
const ONLY = argv[3] ? new Set(argv[3].split(',')) : null;
const want = (s: string) => !ONLY || ONLY.has(s);
const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(5);

interface Stat {
  fights: number;
  wins: number;
  dur: number;
  rating: number;
  combos: number;
  /** Seconds the rival spent stunned / glitched (hard control) and slowed / tethered (soft). */
  hard: number;
  soft: number;
  /** Longest unbroken stretch of rival hard control. */
  hardMax: number;
}
const stat = (): Stat => ({ fights: 0, wins: 0, dur: 0, rating: 0, combos: 0, hard: 0, soft: 0, hardMax: 0 });

interface CardStat {
  plays: number;
  dmg: number;
  /** The card's effect landed (a hit, a catch, a tether, a trigger…). */
  landed: number;
}
const cards = new Map<CardId, CardStat>();
const comboCount = new Map<string, number>();
let netLanded = 0;
let netHeld = 0;
const cs = (c: CardId) => {
  let v = cards.get(c);
  if (!v) cards.set(c, (v = { plays: 0, dmg: 0, landed: 0 }));
  return v;
};

const HIT_CARD: Partial<Record<string, CardId>> = {
  split: 'split_shot',
  disc: 'rebound_disc',
  prop: 'prop_drop',
  mine: 'pressure_mine',
  cable: 'cable_snare',
  release: 'frame_catch',
  power: 'power_shot',
  bank: 'bank_shot',
  knockout: 'knockout',
  shock: 'shock',
  adrenaline: 'adrenaline',
};

/** One fight; `track` adds per-card numbers to the global tables. */
function fight(fighter: FighterId, rival: RivalId, diff: Difficulty, mode: Mode, seed: number, deck: CardId[], s: Stat, track = true, mods?: MatchMods, boss?: string): Match {
  const m = new Match({ fighter, deck, rival, difficulty: diff, seed, fans: 500, autoPlayer: mode === 'combo' ? undefined : AUTO[mode as Exclude<Mode, 'combo'>], mods, boss });
  const st: BotState = { think: 0, react: -1, reactKey: '' };
  const dt = 1 / 60;
  let run = 0;
  let steps = 0;
  while (m.phase !== 'over' && steps < 60 * (m.duration + 55)) {
    if (mode === 'combo') comboBot(m, st, dt);
    m.step(dt);
    steps++;
    const foe = m.fighters[1];
    if (m.phase === 'fight') {
      const hard = foe.stun > 0 || foe.glitch > 0;
      if (hard) {
        s.hard += dt;
        run += dt;
        s.hardMax = Math.max(s.hardMax, run);
      } else run = 0;
      if (foe.netSlow < 1 || foe.tether > 0) s.soft += dt;
    }
    for (const e of m.drainEvents() as MatchEvent[]) {
      if (!track) continue;
      if (e.type === 'card' && e.side === 0) cs(e.card).plays++;
      if (e.type === 'combo' && e.side === 0) comboCount.set(e.combo, (comboCount.get(e.combo) ?? 0) + 1);
      if (e.type === 'hit' && e.source === 0) {
        const c = e.echo ? 'second_take' : HIT_CARD[e.kind];
        if (c) {
          cs(c).dmg += e.damage;
          cs(c).landed++;
        }
      }
      if (e.type === 'object' && e.owner === 0 && e.kind === 'barrier' && e.what === 'hit') cs('stage_barrier').landed++;
      if (e.type === 'object' && e.owner === 0 && e.kind === 'net' && e.what === 'land') netLanded++;
      if (e.type === 'object') continue;
      if (!('side' in e) || (e.side !== 0 && e.type !== 'tether')) continue;
      if (e.type === 'tagHit') cs('spotlight_tag').landed++;
      if (e.type === 'frameCatch') cs('frame_catch').landed++;
      if (e.type === 'tether' && e.side === 1) cs('cable_snare').landed++;
      if (e.type === 'push' && e.hit) cs('pulse_push').landed++;
      if (e.type === 'decoyPop' && e.hit) cs('holo_decoy').landed++;
      if (e.type === 'erase') cs('freeze_frame').landed++;
      if (e.type === 'stakes') cs('high_stakes').landed++;
      if (e.type === 'rewind') cs('backtrack').landed++;
    }
    if (track && foe.netSlow < 1 && m.phase === 'fight') netHeld += dt;
  }
  const r = m.result!;
  s.fights++;
  if (r.outcome === 'win') s.wins++;
  s.dur += r.duration;
  s.rating += r.rating;
  s.combos += r.combos;
  return m;
}

const row = (label: string, s: Stat) =>
  `${label.padEnd(44)} ${pct(s.wins / s.fights)} ${(s.dur / s.fights).toFixed(0).padStart(4)}s ${(s.rating / s.fights).toFixed(0).padStart(4)} ${(s.combos / s.fights).toFixed(1).padStart(4)} ${pct(s.hard / Math.max(1, s.dur))} ${pct(s.soft / Math.max(1, s.dur))} ${s.hardMax.toFixed(1).padStart(4)}s`;
const HEAD = `${'deck'.padEnd(44)}  win   dur  rate  cmb  hard  soft  maxHard`;

// ------------------------------------------------------------ 1. old vs new
console.log(`runs per cell: ${N} · same seeds for every deck · player = deliberate bot unless noted\n`);
if (want('1')) {
console.log('=== 1. Default deck vs. the same deck with ONE new card in place of a basic one (Pro, all rivals)');
const base = new Map<FighterId, Stat>();
for (const f of FIGHTER_ORDER) {
  const s = stat();
  for (let i = 0; i < N * 2; i++) fight(f, RIVAL_ORDER[i % 4], 'pro', 'combo', 9000 + i * 131, FIGHTERS[f].defaultDeck, s, false);
  base.set(f, s);
}
const perCard = new Map<CardId, { wins: number; fights: number; delta: number[] }>();
// yardstick: the same slots swapped for an OLD basic card the default deck does not use
const OLD_SWAPS: CardId[] = ['smoke', 'shock', 'shield', 'dash', 'power_shot', 'overdrive'];
for (const card of [...OLD_SWAPS, ...NEW_CARDS]) {
  const pc = { wins: 0, fights: 0, delta: [] as number[] };
  for (const f of FIGHTER_ORDER) {
    const def = FIGHTERS[f].defaultDeck;
    const s = stat();
    // replace each basic card of the default deck in turn (never the signature)
    for (let k = 0; k < 4; k++) {
      if (def[k] === FIGHTERS[f].signature || def.includes(card)) continue;
      const deck = def.slice();
      deck[k] = card;
      for (let i = 0; i < N; i++) fight(f, RIVAL_ORDER[i % 4], 'pro', 'combo', 9000 + i * 131, deck, s);
    }
    pc.wins += s.wins;
    pc.fights += s.fights;
    const b = base.get(f)!;
    pc.delta.push(s.fights ? s.wins / s.fights - b.wins / b.fights : NaN);
  }
  perCard.set(card, pc);
}
console.log('baseline (default decks):', FIGHTER_ORDER.map((f) => `${f} ${pct(base.get(f)!.wins / base.get(f)!.fights)}`).join(' '));
console.log('card              cost  win(avg)  Δ vs default per fighter (ray bruno nika vega kai rina)');
for (const card of [...OLD_SWAPS, ...NEW_CARDS]) {
  const pc = perCard.get(card)!;
  if (card === NEW_CARDS[0]) console.log('--- new cards');
  const tag = OLD_SWAPS.includes(card) ? ' (old)' : '';
  console.log(`${(card + tag).padEnd(17)} ${String(CARDS[card].cost).padStart(3)}   ${pct(pc.wins / Math.max(1, pc.fights))}    ${pc.delta.map((d) => (Number.isNaN(d) ? '   ·' : `${d >= 0 ? '+' : ''}${Math.round(d * 100)}`.padStart(4))).join(' ')}`);
}

}

// ------------------------------------------------------------ 2. archetypes
const ARCH: Record<string, (f: FighterId) => CardId[]> = {
  'default (1.5.6)': (f) => FIGHTERS[f].defaultDeck,
  'aggro: DASH+SPLIT+TAG+sig': (f) => ['dash', 'split_shot', 'spotlight_tag', FIGHTERS[f].signature],
  'skirmish: DASH+DISC+SNARE+sig': (f) => ['dash', 'rebound_disc', 'cable_snare', FIGHTERS[f].signature],
  'traps: NET+MINE+PUSH+SHIELD': () => ['gravity_net', 'pressure_mine', 'pulse_push', 'shield'],
  'control: SNARE+PROP+SHOCK+DASH': () => ['cable_snare', 'prop_drop', 'shock', 'dash'],
  'defence: FRAME+HOLO+SHIELD+sig': (f) => ['frame_catch', 'holo_decoy', 'shield', FIGHTERS[f].signature],
  'cover: BARRIER+DASH+SHIELD+sig': (f) => ['stage_barrier', 'dash', 'shield', FIGHTERS[f].signature],
  'replay: TAKE+POWER+BANK+sig': (f) => ['second_take', 'power_shot', 'bank_shot', FIGHTERS[f].signature],
  'replay+: BARRIER+TAKE+POWER+sig': (f) => ['stage_barrier', 'second_take', 'power_shot', FIGHTERS[f].signature],
  'tempo: FREEZE+BACKTRACK+DASH+sig': (f) => ['freeze_frame', 'backtrack', 'dash', FIGHTERS[f].signature],
  'risk: STAKES+SHIELD+POWER+OVERDRIVE': () => ['high_stakes', 'shield', 'power_shot', 'overdrive'],
  'stress: NET+SNARE+SHOCK+PROP': () => ['gravity_net', 'cable_snare', 'shock', 'prop_drop'],
  'old best: DASH+POWER+SHIELD+sig': (f) => ['dash', 'power_shot', 'shield', FIGHTERS[f].signature],
};
if (want('2')) for (const diff of ['rookie', 'pro', 'champion'] as Difficulty[]) {
  console.log(`\n=== 2. Archetype decks · ${diff} · all six fighters vs all rivals (deliberate bot)`);
  console.log(HEAD);
  for (const [name, mk] of Object.entries(ARCH)) {
    const s = stat();
    for (const f of FIGHTER_ORDER) for (let i = 0; i < N; i++) fight(f, RIVAL_ORDER[i % 4], diff, 'combo', 12000 + i * 77, mk(f), s, diff === 'pro');
    console.log(row(name, s));
  }
}
if (want('2b')) {
console.log('\n=== 2b. Same archetypes played by the AI pilot (smart), Pro');
console.log(HEAD);
for (const [name, mk] of Object.entries(ARCH)) {
  const s = stat();
  for (const f of FIGHTER_ORDER) for (let i = 0; i < N; i++) fight(f, RIVAL_ORDER[i % 4], 'pro', 'smart', 15000 + i * 59, mk(f), s, false);
  console.log(row(name, s));
}

}

// ------------------------------------------------------- 3. per fighter / rival
if (want('3')) {
console.log('\n=== 3. Best and worst new deck per fighter (Pro, deliberate) — no deck should make a fighter unbeatable');
for (const f of FIGHTER_ORDER) {
  const res: { name: string; w: number }[] = [];
  for (const [name, mk] of Object.entries(ARCH)) {
    const s = stat();
    for (let i = 0; i < N * 2; i++) fight(f, RIVAL_ORDER[i % 4], 'pro', 'combo', 17000 + i * 53, mk(f), s, false);
    res.push({ name, w: s.wins / s.fights });
  }
  res.sort((a, b) => b.w - a.w);
  console.log(`${f.padEnd(6)} best ${res[0].name} ${pct(res[0].w)} · worst ${res[res.length - 1].name} ${pct(res[res.length - 1].w)} · default ${pct(res.find((r) => r.name.startsWith('default'))!.w)}`);
}
console.log('\n=== 3b. Per rival (Pro, all fighters, new archetypes pooled vs default)');
for (const r of RIVAL_ORDER) {
  const sNew = stat();
  const sOld = stat();
  for (const f of FIGHTER_ORDER)
    for (let i = 0; i < N; i++) {
      for (const [name, mk] of Object.entries(ARCH)) if (!name.startsWith('default') && !name.startsWith('old')) fight(f, r, 'pro', 'combo', 19000 + i * 41, mk(f), sNew, false);
      fight(f, r, 'pro', 'combo', 19000 + i * 41, FIGHTERS[f].defaultDeck, sOld, false);
    }
  console.log(`${r.padEnd(6)} default ${pct(sOld.wins / sOld.fights)} · new decks ${pct(sNew.wins / sNew.fights)} · rival hard control on player? (see modes check for Zoe)`);
}

}

// ------------------------------------------------------------------ 4. boss
if (want('4')) {
console.log('\n=== 4. BOSS FIGHT (Victor) · deliberate bot · same seeds');
console.log(HEAD);
for (const [name, mk] of Object.entries(ARCH)) {
  const s = stat();
  const bd = bossById('vale')!;
  for (const f of FIGHTER_ORDER) for (let i = 0; i < N; i++) fight(f, 'vale', 'pro', 'combo', 21000 + i * 37, mk(f), s, false, { duration: bd.duration, introTime: bd.introTime, timeUpRule: 'rival' }, 'vale');
  console.log(row(name, s));
}

}

// --------------------------------------------------------------- 5. survival
if (want('5')) {
console.log('\n=== 5. SURVIVAL (5 waves, HP carried, +20% between waves, no bonuses) · full clears');
for (const [name, mk] of Object.entries(ARCH)) {
  let clears = 0;
  let waves = 0;
  let runs = 0;
  for (const f of FIGHTER_ORDER)
    for (let i = 0; i < Math.max(2, Math.floor(N / 2)); i++) {
      runs++;
      let hp = 1;
      let cleared = 0;
      for (let w = 0; w < SURVIVAL.waves.length; w++) {
        const wd = SURVIVAL.waves[w];
        const s = stat();
        const m = fight(f, RIVAL_ORDER[(i + w) % 4], wd.difficulty, 'combo', 23000 + i * 97 + w * 7, mk(f), s, false, { playerHpFrac: hp, rivalHpMult: wd.hpMult, rivalDmgMult: wd.dmgMult });
        if (m.result!.outcome !== 'win') break;
        cleared++;
        // a fresh Match per wave: nothing from the last fight is left on the stage
        if (m.objects.list.length) throw new Error('stage objects left after a wave');
        hp = Math.min(1, m.fighters[0].hpFrac + SURVIVAL.healBetween);
      }
      waves += cleared;
      if (cleared === SURVIVAL.waves.length) clears++;
    }
  console.log(`${name.padEnd(44)} full clear ${pct(clears / runs)} · avg waves ${(waves / runs).toFixed(1)}`);
}

}

// ---------------------------------------------------------- 6. ENERGY RUSH
if (want('6')) {
console.log('\n=== 6. PRIME CHALLENGE · ENERGY RUSH (energy ×1.5) with HIGH STAKES decks — no endless energy');
{
  const ch = challengeById('energy_rush')!;
  for (const deck of [
    ['high_stakes', 'shield', 'power_shot', 'overdrive'],
    ['high_stakes', 'frame_catch', 'dash', 'power_shot'],
    ['dash', 'power_shot', 'shield', 'overdrive'],
  ] as CardId[][]) {
    const s = stat();
    let stakes = 0;
    let maxStakes = 0;
    for (const f of FIGHTER_ORDER)
      for (let i = 0; i < N; i++) {
        const m = fight(f, ch.rival, 'pro', 'combo', 25000 + i * 13, deck, s, false, { energyMult: ch.mods.energyMult, rivalEnergyMult: ch.mods.rivalEnergyMult });
        stakes += m.fighters[0].stakesUses;
        maxStakes = Math.max(maxStakes, m.fighters[0].stakesUses);
      }
    console.log(`${deck.join('+').padEnd(44)} win ${pct(s.wins / s.fights)} · HIGH STAKES per fight ${(stakes / s.fights).toFixed(2)} (max ${maxStakes})`);
  }
}

}

// ------------------------------------------------------------- 7. per card
console.log('\n=== 7. Per new card (all Pro fights above, deliberate bot)');
console.log('card              plays  landed  dmg/play  dmg/energy  combos opened/finished');
for (const card of NEW_CARDS) {
  const c = cards.get(card) ?? { plays: 0, dmg: 0, landed: 0 };
  console.log(
    `${card.padEnd(17)} ${String(c.plays).padStart(5)}  ${pct(c.landed / Math.max(1, c.plays))}  ${(c.dmg / Math.max(1, c.plays)).toFixed(0).padStart(7)}  ${(c.dmg / Math.max(1, c.plays * CARDS[card].cost)).toFixed(0).padStart(9)}`,
  );
}
for (const old of ['power_shot', 'shock'] as CardId[]) {
  const c = cards.get(old);
  if (c) console.log(`${(old + ' (old)').padEnd(17)} ${String(c.plays).padStart(5)}  ${pct(c.landed / Math.max(1, c.plays))}  ${(c.dmg / Math.max(1, c.plays)).toFixed(0).padStart(7)}  ${(c.dmg / Math.max(1, c.plays * CARDS[old].cost)).toFixed(0).padStart(9)}`);
}
console.log(`gravity_net: ${netLanded} nets, the rival stood in them ${(netHeld / Math.max(1, netLanded)).toFixed(1)} s per net on average`);
console.log('\ncombos triggered:', [...comboCount].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
