// Beta 2.6 — SMART DEFENSE: the PRIME LEAGUE defence a new participant gets at once, so they can join and play without
// first learning the Defense Studio. A pure function of what the SERVER says the player owns (lib/league.js ownership:
// the cloud save and the purchases) — the same code runs in the game's checks and on the server
// (backend/pb_hooks/lib/league_auto.js is generated from this file by `npm run backend:rules`).
//
// The line-up:
//   * 1 fighter → that one; 2–4 → all of them; 5 and more → 5 different ones, picked at random;
//   * a TACTIC for each (the six AI director styles: balance, assault, fortress, counter, combo, adapt) — all different
//     within the line-up (so five defenders show five styles), each preferring one that suits the fighter (`affinity`);
//   * a DECK for each: 4 different cards the fighter really may use in the league (the six basic cards, its signature
//     card and the cards the player bought), shaped by the tactic — attack-heavy for ASSAULT, shields and dashes for
//     FORTRESS, a real combo pair for COMBO, every kind for BALANCE / ADAPT / COUNTER.
// Random within those rules (the server's cryptographic numbers), so two players' line-ups differ. Nothing is invented:
// no card or fighter the player does not own, no new card rules — the server still checks every slot (deckProblem).

export type Kind = 'attack' | 'control' | 'defense';

export interface AutoDefenseInput {
  /** League fighters the player owns (the server's ownership, in the league's roster order). */
  fighters: string[];
  /** The six basic cards every fighter may use. */
  universal: string[];
  /** Each fighter's signature card. */
  signature: Record<string, string>;
  /** Shop cards the player bought (from the cloud save, checked by the server). */
  owned: string[];
  /** The league's card kinds — a card without a kind is never allowed in a league deck. */
  cardKind: Record<string, Kind>;
  /** Combo pairs (first card → second card) of the game's combo table, chains left out. */
  comboPairs: { first: string[]; second: string[] }[];
  /** The six tactics in the game's order. */
  tactics: string[];
  /** The tactics that suit each fighter (missing → any). */
  affinity: Record<string, string[]>;
  /** How each tactic weighs the card kinds (league.config TACTICS weights). */
  weights: Record<string, Record<Kind, number>>;
  /** Defense Studio slots (5). */
  slots: number;
}

export interface AutoSlot {
  slot: number;
  fighter: string;
  deck: string[];
  tactic: string;
  enabled: true;
}

/** What a tactic's deck must hold at least, by kind (filled first, the rest by the tactic's weights). */
const NEED: Record<string, Partial<Record<Kind, number>>> = {
  assault: { attack: 2 },
  fortress: { defense: 2, attack: 1 },
  counter: { control: 1, defense: 1, attack: 1 },
  combo: { attack: 1 },
  balance: { attack: 1, control: 1, defense: 1 },
  adapt: { attack: 1, control: 1, defense: 1 },
};

function pickIndex(n: number, rnd: () => number): number {
  return Math.min(n - 1, Math.floor(rnd() * n));
}

function shuffled<T>(list: T[], rnd: () => number): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = pickIndex(i + 1, rnd);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** The cards this fighter may use in a league deck: basics + signature + bought, each only with a league kind. */
export function poolOf(input: AutoDefenseInput, fighter: string): string[] {
  const out: string[] = [];
  for (const c of input.universal.concat([input.signature[fighter]], input.owned)) if (c && input.cardKind[c] && out.indexOf(c) < 0) out.push(c);
  return out;
}

/** A deck of 4 different cards from `pool` for `tactic` (fewer only if the pool itself is smaller). */
export function deckFor(input: AutoDefenseInput, fighter: string, tactic: string, rnd: () => number): string[] {
  const pool = poolOf(input, fighter);
  const deck: string[] = [];
  const take = (c: string) => {
    if (deck.length < 4 && deck.indexOf(c) < 0 && pool.indexOf(c) >= 0) deck.push(c);
  };
  const kindOf = (c: string) => input.cardKind[c];
  // COMBO: a real pair first — the director only builds combos the deck can make
  if (tactic === 'combo') {
    const pairs: [string, string][] = [];
    for (const p of input.comboPairs) for (const a of p.first) for (const b of p.second) if (a !== b && pool.indexOf(a) >= 0 && pool.indexOf(b) >= 0) pairs.push([a, b]);
    if (pairs.length) {
      const [a, b] = pairs[pickIndex(pairs.length, rnd)];
      take(a);
      take(b);
    }
  }
  // the fighter's own signature card belongs to its identity — in every deck it can join
  take(input.signature[fighter]);
  // the tactic's minimums by kind
  const need = NEED[tactic] ?? { attack: 1 };
  for (const k of ['attack', 'defense', 'control'] as Kind[]) {
    let have = deck.filter((c) => kindOf(c) === k).length;
    const want = need[k] ?? 0;
    const cands = shuffled(pool.filter((c) => kindOf(c) === k && deck.indexOf(c) < 0), rnd);
    while (have < want && cands.length && deck.length < 4) {
      take(cands.shift()!);
      have++;
    }
  }
  // the rest by the tactic's weights (a weighted draw without repeats)
  const w = input.weights[tactic] ?? { attack: 1, control: 1, defense: 1 };
  while (deck.length < 4) {
    const rest = pool.filter((c) => deck.indexOf(c) < 0);
    if (!rest.length) break;
    const total = rest.reduce((s, c) => s + (w[kindOf(c)] ?? 1), 0);
    let r = rnd() * total;
    let chosen = rest[rest.length - 1];
    for (const c of rest) {
      r -= w[kindOf(c)] ?? 1;
      if (r <= 0) {
        chosen = c;
        break;
      }
    }
    take(chosen);
  }
  return deck;
}

/**
 * Different tactics for the line-up, each fighter preferring its own (`affinity`): fighters in random order take a
 * random free tactic of their affinity, else any free one (six tactics ≥ five slots, so they always differ).
 */
export function tacticsFor(input: AutoDefenseInput, fighters: string[], rnd: () => number): string[] {
  const free = input.tactics.slice();
  const out: string[] = new Array(fighters.length).fill('');
  for (const i of shuffled(fighters.map((_, k) => k), rnd)) {
    const pref = (input.affinity[fighters[i]] ?? []).filter((t) => free.indexOf(t) >= 0);
    const from = pref.length ? pref : free;
    const t = from[pickIndex(from.length, rnd)] ?? input.tactics[0];
    out[i] = t;
    const at = free.indexOf(t);
    if (at >= 0) free.splice(at, 1);
  }
  return out;
}

/** The whole line-up (see the header). Empty only when the player owns no league fighter at all. */
export function autoDefense(input: AutoDefenseInput, rnd: () => number): AutoSlot[] {
  const own = input.fighters.filter((f, i) => input.fighters.indexOf(f) === i && !!input.signature[f]);
  const n = Math.min(input.slots, own.length);
  const fighters = own.length <= input.slots ? shuffled(own, rnd) : shuffled(own, rnd).slice(0, n);
  const tactics = tacticsFor(input, fighters, rnd);
  return fighters.map((f, i) => ({ slot: i + 1, fighter: f, deck: deckFor(input, f, tactics[i], rnd), tactic: tactics[i], enabled: true as const }));
}
