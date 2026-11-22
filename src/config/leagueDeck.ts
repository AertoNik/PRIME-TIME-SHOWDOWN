import { UNIVERSAL_CARDS } from './cards';
import { FIGHTERS } from './fighters';
import { CARD_KIND, type CardKind } from './league.config';
import type { CardId, FighterId } from './types';

/**
 * Beta 2.6.1 — the cards a PRIME LEAGUE deck may hold, by kind: the server's deck rule (league_rules.cardKind →
 * lib/league.js deckProblem) and SMART DEFENSE's deck builder read exactly this map.
 *
 * Why it is not CARD_KIND itself: Alpha 1.9.8 brought ACE into the league but left his signature MAIN EVENT out of
 * CARD_KIND, so the server refused the very deck the game offered («a card your collection does not have» — ACE's
 * career deck holds it, so an attack with ACE could not even start). CARD_KIND is part of the league's fight bundle
 * (the AI's tactic weights → league_sim.js → SIM_VERSION); a card without a kind there already plays as an «attack»
 * (src/combat/FighterAI.ts), which is the kind MAIN EVENT gets here — so the fight stays the same bits and SIM_VERSION
 * does not move. This file is never imported by the fight (src/league/server.ts).
 *
 * Still not league cards (unchanged): DIRECTOR'S CUT (the boss's) and the three universal cards of 1.9.8 — SHOWTIME,
 * MAGNET PULL, SAFE CUT. Admitting those would change how the league's AI weighs them, i.e. the fight and SIM_VERSION:
 * a decision for a later update, not this patch.
 */
export const LEAGUE_DECK_KIND: Partial<Record<CardId, CardKind>> = { ...CARD_KIND, main_event: 'attack' };

export const isLeagueCard = (c: CardId): boolean => !!LEAGUE_DECK_KIND[c];

/**
 * The cards this fighter may take into a league deck (the server's rule): the six basic cards, its own signature and
 * the cards the career bought — only those the league admits.
 */
export function leagueCards(fighter: FighterId, owned: readonly CardId[]): CardId[] {
  const out: CardId[] = [];
  for (const c of [...UNIVERSAL_CARDS, FIGHTERS[fighter].signature, ...owned]) if (isLeagueCard(c) && !out.includes(c)) out.push(c);
  return out;
}

/**
 * A deck the league accepts, made from `deck` (the career deck, when the fighter has no league deck yet): its league
 * cards are kept in place, a card the league does not take (a 1.9.8 card, one no longer owned) is replaced by the first
 * allowed card of the fighter's default deck, then of the basics. Always 4 different cards; the save is never changed.
 */
export function leagueDeckFrom(fighter: FighterId, deck: readonly CardId[] | undefined, owned: readonly CardId[]): CardId[] {
  const allowed = leagueCards(fighter, owned);
  const src = (deck ?? []).slice(0, 4);
  const keep = src.map((c) => (allowed.includes(c) ? c : null));
  const used = new Set<CardId>();
  for (let i = 0; i < keep.length; i++) {
    const c = keep[i];
    if (c && used.has(c)) keep[i] = null;
    else if (c) used.add(c);
  }
  const spare = [...FIGHTERS[fighter].defaultDeck, ...allowed].filter((c, i, a) => allowed.includes(c) && a.indexOf(c) === i);
  while (keep.length < 4) keep.push(null);
  for (let i = 0; i < 4; i++) {
    if (keep[i]) continue;
    const c = spare.find((x) => !used.has(x));
    if (!c) break;
    keep[i] = c;
    used.add(c);
  }
  return keep.filter((c): c is CardId => !!c);
}
