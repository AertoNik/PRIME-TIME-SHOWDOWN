// Alpha 1.9.9 — how players and the AI use combos (npm run combos [runs]): per combo how often it lands and how often the
// SAME combo comes again and again in a row, the longest such streak, the combo damage share and the show rating — for
// the human-like bot ('combo') and the AI pilot ('smart') on every fighter, default decks and combo-heavy decks.
// A report, not a pass / fail test (the pass / fail rules of 1.9.9's combos live in `npm run combofresh`).
import { COMBO_FRESH } from '../src/config/balance';
import { COMBOS } from '../src/config/cards';
import { FIGHTERS, FIGHTER_ORDER, RIVAL_ORDER } from '../src/config/fighters';

const comboNames = new Set(COMBOS.map((c) => c.name));
import type { CardId, FighterId } from '../src/config/types';
import { Match } from '../src/combat/Match';
import type { MatchEvent } from '../src/combat/types';
import { comboBot, AUTO, type BotState, type Mode } from './bots';

const argv = (globalThis as { process?: { argv?: string[] } }).process?.argv ?? [];
const N = Number(argv[2] ?? 6);
/** `npm run combos -- 6 off`: the same fights without the 1.9.9 freshness rule (every combo at full power, no sighs). */
if (argv[3] === 'off') {
  (COMBO_FRESH as { power: readonly number[] }).power = [1, 1, 1, 1, 1];
  COMBO_FRESH.dullRating = 0;
}

interface Agg {
  fights: number;
  wins: number;
  combos: number;
  /** times a combo was the 3rd (or later) of the same combo in a row */
  repeats3: number;
  longest: number;
  rating: number;
  comboDmg: number;
  dmg: number;
  /** the show rating the combos themselves brought (their callouts) and the «ОДНООБРАЗНО» sighs */
  comboRating: number;
  dull: number;
  /** mean freshness the combos landed with */
  power: number;
  per: Map<string, number>;
}
const agg = (): Agg => ({ fights: 0, wins: 0, combos: 0, repeats3: 0, longest: 0, rating: 0, comboDmg: 0, dmg: 0, comboRating: 0, dull: 0, power: 0, per: new Map() });

const DECKS: Record<string, (f: FighterId) => CardId[]> = {
  default: (f) => FIGHTERS[f].defaultDeck,
  // the classic loop: DASH → POWER SHOT again and again, SHOCK to open ELECTRO BLAST
  counter: (f) => ['dash', 'power_shot', 'shock', f === 'ray' ? 'shield' : FIGHTERS[f].signature],
  // 1.9.8's cards
  showtime: () => ['showtime', 'power_shot', 'magnet_pull', 'safe_cut'],
  // 1.9.9's new pairs: POINT BLANK, COUNTER CUT / FADE OUT, ENCORE
  evolve: () => ['magnet_pull', 'split_shot', 'safe_cut', 'power_shot'],
  fade: () => ['smoke', 'safe_cut', 'showtime', 'dash'],
};

function fight(fighter: FighterId, rival: (typeof RIVAL_ORDER)[number], mode: Mode, seed: number, deck: CardId[], a: Agg): void {
  const m = new Match({ fighter, deck, rival, difficulty: 'pro', seed, fans: 500, autoPlayer: mode === 'combo' ? undefined : AUTO[mode as Exclude<Mode, 'combo'>] });
  const st: BotState = { think: 0, react: -1, reactKey: '' };
  let last = '';
  let run = 0;
  const dt = 1 / 60;
  let steps = 0;
  while (m.phase !== 'over' && steps < 60 * (m.duration + 55)) {
    if (mode === 'combo') comboBot(m, st, dt);
    m.step(dt);
    steps++;
    for (const e of m.drainEvents() as MatchEvent[]) {
      if (e.type === 'rating') {
        if (e.label === 'ОДНООБРАЗНО') a.dull += e.amount;
        else if (comboNames.has(e.label)) a.comboRating += e.amount;
      }
      if (e.type === 'combo' && e.side === 0) {
        a.power += (e as { power?: number }).power ?? 1;
        a.combos++;
        a.per.set(e.combo, (a.per.get(e.combo) ?? 0) + 1);
        run = e.combo === last ? run + 1 : 1;
        last = e.combo;
        if (run >= 3) a.repeats3++;
        a.longest = Math.max(a.longest, run);
      }
      if (e.type === 'hit' && e.source === 0) {
        a.dmg += e.damage;
        if (e.combo) a.comboDmg += e.damage;
      }
    }
  }
  a.fights++;
  if (m.result?.outcome === 'win') a.wins++;
  a.rating += m.result?.rating ?? m.broadcast.rating;
}

for (const mode of ['combo', 'smart'] as Mode[]) {
  for (const [name, mk] of Object.entries(DECKS)) {
    const a = agg();
    for (const f of FIGHTER_ORDER) for (let i = 0; i < N; i++) fight(f, RIVAL_ORDER[i % RIVAL_ORDER.length], mode, 5000 + i * 97, mk(f), a);
    const top = [...a.per.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round((v / Math.max(1, a.combos)) * 100)}%`).join(', ');
    console.log(
      `${mode.padEnd(6)} ${name.padEnd(9)} win ${Math.round((a.wins / a.fights) * 100)}%  combos/fight ${(a.combos / a.fights).toFixed(1)}  3rd+-in-a-row ${Math.round((a.repeats3 / Math.max(1, a.combos)) * 100)}%  longest ${a.longest}  fresh ${Math.round((a.power / Math.max(1, a.combos)) * 100)}%  combo dmg ${Math.round((a.comboDmg / Math.max(1, a.dmg)) * 100)}%  combo rating ${(a.comboRating / a.fights).toFixed(1)} dull ${(a.dull / a.fights).toFixed(1)}  final rating ${(a.rating / a.fights).toFixed(0)}  | ${top}`,
    );
  }
}
