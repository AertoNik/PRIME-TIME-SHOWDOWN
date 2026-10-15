// Card / deck strength: every 4-card deck from each fighter's pool, played by
// the deliberate bot on Pro. Compares results with and without each card.
// Usage: npm run decks [runsPerDeck]
import { UNIVERSAL_CARDS } from '../src/config/cards';
import { FIGHTERS, RIVAL_ORDER } from '../src/config/fighters';
import type { CardId, FighterId } from '../src/config/types';
import { runMatch } from './bots';

const K = Number((globalThis as { process?: { argv?: string[] } }).process?.argv?.[2] ?? 6);

function combos4<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let a = 0; a < arr.length; a++)
    for (let b = a + 1; b < arr.length; b++)
      for (let c = b + 1; c < arr.length; c++) for (let d = c + 1; d < arr.length; d++) out.push([arr[a], arr[b], arr[c], arr[d]]);
  return out;
}

for (const f of ['ray', 'bruno', 'nika', 'vega'] as FighterId[]) {
  const pool: CardId[] = [...UNIVERSAL_CARDS, FIGHTERS[f].signature];
  const decks = combos4(pool);
  const results: { deck: CardId[]; win: number; rating: number; dur: number }[] = [];
  const dmg = new Map<CardId, { dmg: number; uses: number }>();
  for (const deck of decks) {
    let win = 0, rating = 0, dur = 0;
    for (let i = 0; i < K; i++) {
      const { m, events, cardDamage } = runMatch(f, RIVAL_ORDER[i % RIVAL_ORDER.length], 'pro', 'combo', 5000 + i * 977, deck);
      const r = m.result!;
      if (r.outcome === 'win') win++;
      rating += r.rating;
      dur += r.duration;
      for (const c of deck) {
        const e = dmg.get(c) ?? { dmg: 0, uses: 0 };
        e.uses += events.get('card:' + c) ?? 0;
        e.dmg += cardDamage.get(c) ?? 0;
        dmg.set(c, e);
      }
    }
    results.push({ deck, win: win / K, rating: rating / K, dur: dur / K });
  }
  console.log(`\n=== ${f.toUpperCase()} (pro, ${decks.length} decks x ${K})`);
  console.log('card              with:win  rating  dur | without:win  rating | dmg/use');
  for (const c of pool) {
    const w = results.filter((r) => r.deck.includes(c));
    const wo = results.filter((r) => !r.deck.includes(c));
    const avg = (rs: typeof results, k: 'win' | 'rating' | 'dur') => rs.reduce((s, r) => s + r[k], 0) / Math.max(1, rs.length);
    const d = dmg.get(c)!;
    console.log(
      `${c.padEnd(17)} ${(avg(w, 'win') * 100).toFixed(0).padStart(5)}%  ${avg(w, 'rating').toFixed(0).padStart(6)}  ${avg(w, 'dur').toFixed(0).padStart(4)} | ${(avg(wo, 'win') * 100).toFixed(0).padStart(8)}%  ${avg(wo, 'rating').toFixed(0).padStart(6)} | ${(d.uses ? d.dmg / d.uses : 0).toFixed(0).padStart(6)}`,
    );
  }
  results.sort((a, b) => b.win - a.win || b.rating - a.rating);
  console.log('best decks:', results.slice(0, 3).map((r) => `${r.deck.join('+')} ${(r.win * 100).toFixed(0)}%/${r.rating.toFixed(0)}`).join('  |  '));
  console.log('worst decks:', results.slice(-2).map((r) => `${r.deck.join('+')} ${(r.win * 100).toFixed(0)}%/${r.rating.toFixed(0)}`).join('  |  '));
}
