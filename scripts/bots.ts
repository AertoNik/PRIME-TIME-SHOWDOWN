// Scripted "players" for headless balance checks. They only use information
// a human sees on screen (cards, energy, charge telegraphs) and react with a
// human-like delay, so results approximate real play rather than perfect play.
import { Match, type MatchConfig, type MatchMods } from '../src/combat/Match';
import { CARDS, COMBOS } from '../src/config/cards';
import { FIGHTERS } from '../src/config/fighters';
import type { CardId, Difficulty, FighterId, RivalId } from '../src/config/types';
import type { MatchEvent } from '../src/combat/types';

/** The five combos of 1.0–1.5 (the bot plays them exactly as before Alpha 1.6). */
const CLASSIC = new Set<string>(['counter_strike', 'electro_blast', 'iron_rush', 'phantom_step', 'superstar']);

export interface BotState {
  think: number;
  react: number;
  reactKey: string;
}

/** Deliberate player: banks energy for combo pairs and answers telegraphs. */
export function comboBot(m: Match, st: BotState, dt: number, reaction = 0.38): void {
  if (m.phase !== 'fight') return;
  const h = m.hands[0];
  const foe = m.fighters[1];
  // React like a human: interrupt early charges with SHOCK, dodge/block once
  // the red lane locks (or a charge is incoming), each after a reaction delay.
  const fa = foe.action;
  const me = m.fighters[0];
  // Alpha 1.5.5: Zoe's SHOCK sparks in her hand before the bolt leaves — DASH or SHIELD after a reaction delay
  if (foe.zap > 0) {
    const key = 'zap:' + Math.round((m.time + foe.zap) * 20);
    if (st.reactKey !== key) {
      st.reactKey = key;
      st.react = reaction;
    }
  }
  if (fa.kind === 'windup' || fa.kind === 'rush') {
    const key = fa.kind + ':' + (m.time - fa.t).toFixed(1) + (fa.kind === 'windup' && fa.locked ? 'L' : '');
    if (st.reactKey !== key) {
      st.reactKey = key;
      st.react = fa.kind === 'windup' && !fa.locked ? reaction : 0.12;
    }
  }
  // DIRECTOR'S CUT: try to interrupt the alert with SHOCK; when a frozen line runs through
  // (or right next to) the fighter, DASH or SHIELD after a human reaction delay
  let cutLane = false;
  if (fa.kind === 'cut') {
    cutLane = fa.stage === 'lock' && m.abilities.inCutLane(foe, fa.dirX, fa.dirZ, fa.tune.halfWidth[fa.shot] + 0.3, fa.tune.length[fa.shot], me.x, me.z, me.radius) >= 0;
    const key = fa.stage === 'prep' ? 'cutP' + (m.time - fa.t).toFixed(1) : cutLane ? 'cutL' + fa.shot + ':' + fa.lockedAt.toFixed(2) : '';
    if (key && st.reactKey !== key) {
      st.reactKey = key;
      st.react = reaction;
    }
  }
  if (st.react >= 0) {
    st.react -= dt;
    if (st.react < 0) {
      const di = h.hand.indexOf('dash');
      const si = h.hand.indexOf('shield');
      const shi = h.hand.indexOf('shock');
      // Alpha 1.5: FALSE START reads a locked line / charge like a dodge would
      const fi = h.hand.indexOf('false_start');
      if (foe.zap > 0 || m.projectiles.some((p) => p.alive && p.kind === 'zap' && p.owner === 1)) {
        if (di >= 0 && h.energy >= 2) m.playCard(0, di);
        else if (si >= 0 && h.energy >= 3 && me.shield <= 0) m.playCard(0, si);
        return;
      }
      if (fa.kind === 'cut') {
        if (fa.stage === 'prep' && shi >= 0 && h.energy >= 4) m.playCard(0, shi);
        else if (cutLane && di >= 0 && h.energy >= 2) m.playCard(0, di);
        else if (cutLane && fi >= 0 && h.energy >= 3 && me.feint <= 0) m.playCard(0, fi);
        else if (cutLane && si >= 0 && h.energy >= 3 && me.shield <= 0) m.playCard(0, si);
        return;
      }
      const locked = fa.kind === 'rush' || (fa.kind === 'windup' && fa.locked);
      // Alpha 1.6: a frame or a screen also answers a POWER / BANK SHOT that is about to leave
      const shot = fa.kind === 'windup' && (fa.card === 'power_shot' || fa.card === 'bank_shot');
      const fci = h.hand.indexOf('frame_catch');
      const bi = h.hand.indexOf('stage_barrier');
      if (fa.kind === 'windup' && !fa.locked && shi >= 0 && h.energy >= 4) m.playCard(0, shi);
      else if (locked && di >= 0 && h.energy >= 2) m.playCard(0, di);
      else if (locked && fi >= 0 && h.energy >= 3 && me.feint <= 0) m.playCard(0, fi);
      else if (locked && si >= 0 && h.energy >= 3) m.playCard(0, si);
      else if (locked && shot && fci >= 0 && h.energy >= 2 && me.frame <= 0) m.playCard(0, fci);
      else if (locked && shot && bi >= 0 && h.energy >= 3) m.playCard(0, bi);
      return;
    }
  }
  st.think -= dt;
  if (st.think > 0) return;
  st.think = 0.3;
  // Alpha 1.6: a deliberate player keeps DASH for reading attacks — positional DASH combos and
  // defensive set pieces happen when a threat shows up (the reaction above), not as a routine.
  const threatened = foe.overdrive > 0 || foe.adrenaline > 0 || fa.kind === 'windup';
  // finish a primed combo
  const gap = Math.hypot(foe.x - me.x, foe.z - me.z);
  for (let k = 0; k < 3; k++) {
    const c = h.hand[k];
    const cb = m.combos.wouldCombo(0, c, m.time);
    if (cb && c === 'dash' && !CLASSIC.has(cb.id) && !threatened) continue;
    // Alpha 1.7: BAT BITE is a lunge — wait inside the window until it can reach
    if (cb && c === 'bat_bite' && (gap > 4.4 || foe.shield > 0)) continue;
    if (cb && h.energy >= CARDS[c].cost) {
      m.playCard(0, k);
      return;
    }
  }
  // open a combo if both halves are affordable soon (chains like JACKPOT follow on their own)
  for (const cb of COMBOS) {
    if (cb.after) continue;
    // (the classic five are played exactly as before 1.6)
    const dashy = !CLASSIC.has(cb.id) && (cb.first.includes('dash') || cb.second.includes('dash')) && cb.id !== 'tight_spread';
    const guard = cb.first.some((c) => c === 'stage_barrier' || c === 'freeze_frame' || c === 'holo_decoy' || c === 'frame_catch');
    if ((dashy || guard) && !threatened) continue;
    const a = h.hand.findIndex((c) => cb.first.includes(c));
    const b = h.hand.findIndex((c) => cb.second.includes(c));
    // Alpha 1.7: a combo that ends in BAT BITE only opens within the lunge's reach
    if (b >= 0 && h.hand[b] === 'bat_bite' && (gap > 4.0 || foe.shield > 0)) continue;
    if (a >= 0 && b >= 0 && a !== b && h.energy >= CARDS[h.hand[a]].cost + CARDS[h.hand[b]].cost - 2) {
      m.playCard(0, a);
      return;
    }
  }
  // Alpha 1.6: the plain sensible use of the new cards (what a player reads off the card text)
  if (newCardMove(m)) return;
  // Alpha 1.7: LUCIEN's BAT BITE — close enough, the target open, a DASH kept in reserve
  const bi = h.hand.indexOf('bat_bite');
  if (bi >= 0 && gap < 4.2 && foe.shield <= 0 && foe.invuln <= 0 && foe.bleedTicks <= 2) {
    const reserve = h.hand.includes('dash') ? 2 : 0;
    if (h.energy >= CARDS.bat_bite.cost + reserve && m.playCard(0, bi) === null) return;
  }
  // don't sit on full energy
  if (h.energy >= 9.5) {
    const order = [0, 1, 2].sort((x, y) => CARDS[h.hand[y]].cost - CARDS[h.hand[x]].cost);
    for (const i of order) if (m.playCard(0, i) === null) return;
  }
}

/** Alpha 1.6 — when a deliberate player plays a new card outside a combo. Returns true if it played one. */
function newCardMove(m: Match): boolean {
  const h = m.hands[0];
  const me = m.fighters[0];
  const foe = m.fighters[1];
  const dist = Math.hypot(foe.x - me.x, foe.z - me.z);
  const threatened = foe.overdrive > 0 || foe.adrenaline > 0;
  const held = foe.netSlow < 1 || foe.tether > 0 || foe.stun > 0;
  const want = (c: CardId): boolean => {
    switch (c) {
      case 'pulse_push':
        return dist < 2.4 && me.stats.preferredRange > 3;
      case 'split_shot':
        return dist < 3.5 && foe.shield <= 0;
      case 'prop_drop':
      case 'rebound_disc':
        return held && foe.shield <= 0;
      case 'second_take':
        // Alpha 1.6.1: replay the last attack card while it is still fresh
        return m.takeReady(me) && foe.shield <= 0;
      case 'holo_decoy':
      case 'freeze_frame':
      case 'stage_barrier':
        return threatened;
      case 'backtrack':
        return me.tether > 0 || m.objects.list.some((o) => o.owner === 1 && o.kind === 'prop' && Math.hypot(o.x - me.x, o.z - me.z) < o.radius);
      case 'high_stakes':
        return h.energy <= 4 && me.hpFrac > 0.55 && h.hand.some((x) => x !== 'high_stakes' && CARDS[x].cost >= 4);
      case 'gravity_net':
      case 'cable_snare':
      case 'pressure_mine':
        return h.energy >= 7;
      default:
        return false;
    }
  };
  for (let k = 0; k < 3; k++) {
    const c = h.hand[k];
    if (c && CARDS[c].shop && h.energy >= CARDS[c].cost && want(c) && m.playCard(0, k) === null) return true;
  }
  return false;
}

export type Mode = 'idle' | 'mash' | 'smart' | 'combo';

export const AUTO: Record<Exclude<Mode, 'combo'>, MatchConfig['autoPlayer']> = {
  idle: undefined,
  mash: { behavior: 'aggressive', smarts: 0, dodge: 0.2, reaction: 0.6, eagerness: 1.6 },
  smart: { behavior: 'tactical', smarts: 0.95, dodge: 0.65, reaction: 0.4, eagerness: 1.2 },
};

/** Which card a hit of this kind came from (damage per card in the reports). */
const HIT_CARD: Partial<Record<string, CardId>> = {
  adrenaline: 'adrenaline',
  shock: 'shock',
  overload: 'system_overload',
  dot: 'system_overload',
  burst: 'overdrive',
  // Alpha 1.6
  split: 'split_shot',
  disc: 'rebound_disc',
  prop: 'prop_drop',
  mine: 'pressure_mine',
  cable: 'cable_snare',
  release: 'frame_catch',
  // Alpha 1.7
  bite: 'bat_bite',
  bleed: 'bat_bite',
};

export interface RunResult {
  m: Match;
  events: Map<string, number>;
  cardDamage: Map<CardId, number>;
}

export function runMatch(fighter: FighterId, rival: RivalId, difficulty: Difficulty, mode: Mode, seed: number, deck?: CardId[], mods?: MatchMods, boss?: string): RunResult {
  const m = new Match({
    fighter,
    deck: deck ?? FIGHTERS[fighter].defaultDeck,
    rival,
    difficulty,
    seed,
    fans: 500,
    autoPlayer: mode === 'combo' ? undefined : AUTO[mode],
    mods,
    boss,
  });
  const st: BotState = { think: 0, react: -1, reactKey: '' };
  const events = new Map<string, number>();
  const cardDamage = new Map<CardId, number>();
  let lastCard: CardId | null = null;
  let steps = 0;
  const dt = 1 / 60;
  while (m.phase !== 'over' && steps < 60 * (m.duration + 55)) {
    if (mode === 'combo') comboBot(m, st, dt);
    m.step(dt);
    for (const e of m.drainEvents() as MatchEvent[]) {
      if (e.type === 'card' && e.side === 0) {
        events.set('card:' + e.card, (events.get('card:' + e.card) ?? 0) + 1);
        lastCard = e.card;
      }
      if (e.type === 'combo') events.set((e.side === 0 ? 'combo:' : 'rivalCombo:') + e.combo, (events.get((e.side === 0 ? 'combo:' : 'rivalCombo:') + e.combo) ?? 0) + 1);
      if (e.type === 'hit' && e.source === 0 && e.kind !== 'auto' && lastCard) {
        const key: CardId = e.echo ? 'second_take' : HIT_CARD[e.kind] ?? (e.kind === 'power' ? (lastCard === 'charged_shot' ? 'charged_shot' : 'power_shot') : e.kind === 'knockout' || e.kind === 'slam' ? 'knockout' : lastCard);
        cardDamage.set(key, (cardDamage.get(key) ?? 0) + e.damage);
      }
      if (e.type === 'card' && e.side === 1) events.set('rivalCard:' + e.card, (events.get('rivalCard:' + e.card) ?? 0) + 1);
      if (e.type === 'cutShot') events.set('cutShot:' + e.outcome, (events.get('cutShot:' + e.outcome) ?? 0) + 1);
      if (e.type === 'cutEnd') events.set(e.completed ? 'cut:completed' : 'cut:cancelled', (events.get(e.completed ? 'cut:completed' : 'cut:cancelled') ?? 0) + 1);
      if (e.type === 'hit' && e.side === 0) {
        events.set('taken:' + e.kind, (events.get('taken:' + e.kind) ?? 0) + e.damage);
        if (e.kind === 'auto') events.set('slugHits', (events.get('slugHits') ?? 0) + 1);
      }
    }
    if (m.phase === 'fight') {
      // long-range share: how often the fighters stand more than 7.5 m apart
      events.set('fightSteps', (events.get('fightSteps') ?? 0) + 1);
      const [a, b] = m.fighters;
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist > 7.5) events.set('far', (events.get('far') ?? 0) + 1);
      events.set('distSum', (events.get('distSum') ?? 0) + dist);
    }
    steps++;
  }
  return { m, events, cardDamage };
}
