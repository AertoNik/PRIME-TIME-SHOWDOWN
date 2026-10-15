// Scripted "players" for headless balance checks. They only use information
// a human sees on screen (cards, energy, charge telegraphs) and react with a
// human-like delay, so results approximate real play rather than perfect play.
import { Match, type MatchConfig } from '../src/combat/Match';
import { CARDS, COMBOS } from '../src/config/cards';
import { FIGHTERS } from '../src/config/fighters';
import type { CardId, Difficulty, FighterId, RivalId } from '../src/config/types';
import type { MatchEvent } from '../src/combat/types';

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
  if (fa.kind === 'windup' || fa.kind === 'rush') {
    const key = fa.kind + ':' + (m.time - fa.t).toFixed(1) + (fa.kind === 'windup' && fa.locked ? 'L' : '');
    if (st.reactKey !== key) {
      st.reactKey = key;
      st.react = fa.kind === 'windup' && !fa.locked ? reaction : 0.12;
    }
  }
  if (st.react >= 0) {
    st.react -= dt;
    if (st.react < 0) {
      const di = h.hand.indexOf('dash');
      const si = h.hand.indexOf('shield');
      const shi = h.hand.indexOf('shock');
      const locked = fa.kind === 'rush' || (fa.kind === 'windup' && fa.locked);
      if (fa.kind === 'windup' && !fa.locked && shi >= 0 && h.energy >= 4) m.playCard(0, shi);
      else if (locked && di >= 0 && h.energy >= 2) m.playCard(0, di);
      else if (locked && si >= 0 && h.energy >= 3) m.playCard(0, si);
      return;
    }
  }
  st.think -= dt;
  if (st.think > 0) return;
  st.think = 0.3;
  // finish a primed combo
  for (let k = 0; k < 3; k++) {
    const c = h.hand[k];
    if (m.combos.wouldCombo(0, c, m.time) && h.energy >= CARDS[c].cost) {
      m.playCard(0, k);
      return;
    }
  }
  // open a combo if both halves are affordable soon
  for (const cb of COMBOS) {
    const a = h.hand.findIndex((c) => cb.first.includes(c));
    const b = h.hand.findIndex((c) => cb.second.includes(c));
    if (a >= 0 && b >= 0 && a !== b && h.energy >= CARDS[h.hand[a]].cost + CARDS[h.hand[b]].cost - 2) {
      m.playCard(0, a);
      return;
    }
  }
  // don't sit on full energy
  if (h.energy >= 9.5) {
    const order = [0, 1, 2].sort((x, y) => CARDS[h.hand[y]].cost - CARDS[h.hand[x]].cost);
    for (const i of order) if (m.playCard(0, i) === null) return;
  }
}

export type Mode = 'idle' | 'mash' | 'smart' | 'combo';

export const AUTO: Record<Exclude<Mode, 'combo'>, MatchConfig['autoPlayer']> = {
  idle: undefined,
  mash: { behavior: 'aggressive', smarts: 0, dodge: 0.2, reaction: 0.6, eagerness: 1.6 },
  smart: { behavior: 'tactical', smarts: 0.95, dodge: 0.65, reaction: 0.4, eagerness: 1.2 },
};

export interface RunResult {
  m: Match;
  events: Map<string, number>;
  cardDamage: Map<CardId, number>;
}

export function runMatch(fighter: FighterId, rival: RivalId, difficulty: Difficulty, mode: Mode, seed: number, deck?: CardId[]): RunResult {
  const m = new Match({
    fighter,
    deck: deck ?? FIGHTERS[fighter].defaultDeck,
    rival,
    difficulty,
    seed,
    fans: 500,
    autoPlayer: mode === 'combo' ? undefined : AUTO[mode],
  });
  const st: BotState = { think: 0, react: -1, reactKey: '' };
  const events = new Map<string, number>();
  const cardDamage = new Map<CardId, number>();
  let lastCard: CardId | null = null;
  let steps = 0;
  const dt = 1 / 60;
  while (m.phase !== 'over' && steps < 60 * 130) {
    if (mode === 'combo') comboBot(m, st, dt);
    m.step(dt);
    for (const e of m.drainEvents() as MatchEvent[]) {
      if (e.type === 'card' && e.side === 0) {
        events.set('card:' + e.card, (events.get('card:' + e.card) ?? 0) + 1);
        lastCard = e.card;
      }
      if (e.type === 'combo') events.set((e.side === 0 ? 'combo:' : 'rivalCombo:') + e.combo, (events.get((e.side === 0 ? 'combo:' : 'rivalCombo:') + e.combo) ?? 0) + 1);
      if (e.type === 'hit' && e.source === 0 && e.kind !== 'auto' && lastCard) {
        const key: CardId = e.kind === 'power' ? (lastCard === 'charged_shot' ? 'charged_shot' : 'power_shot') : e.kind === 'adrenaline' ? 'adrenaline' : e.kind === 'knockout' || e.kind === 'slam' ? 'knockout' : e.kind === 'shock' ? 'shock' : e.kind === 'overload' || e.kind === 'dot' ? 'system_overload' : e.kind === 'burst' ? 'overdrive' : lastCard;
        cardDamage.set(key, (cardDamage.get(key) ?? 0) + e.damage);
      }
      if (e.type === 'card' && e.side === 1) events.set('rivalCard:' + e.card, (events.get('rivalCard:' + e.card) ?? 0) + 1);
    }
    steps++;
  }
  return { m, events, cardDamage };
}
