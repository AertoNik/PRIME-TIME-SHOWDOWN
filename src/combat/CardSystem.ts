import { MATCH } from '../config/balance';
import { CARDS } from '../config/cards';
import type { CardId } from '../config/types';

/**
 * Energy + cyclic deck for one side.
 * Hand shows `handSize` cards, the rest wait in a queue. A played card goes
 * to the back of the queue and the queue head fills the freed slot.
 */
export class CardHand {
  readonly deck: CardId[];
  hand: CardId[];
  queue: CardId[];
  energy: number;
  regenMult: number;
  lockout = 0;
  /** Bumped on every hand change so UI can diff cheaply. */
  version = 0;

  constructor(deck: CardId[], regenMult = 1) {
    const d = deck.slice(0, MATCH.deckSize);
    this.deck = d;
    this.hand = d.slice(0, MATCH.handSize);
    this.queue = d.slice(MATCH.handSize);
    this.energy = MATCH.startEnergy;
    this.regenMult = regenMult;
  }

  get next(): CardId | null {
    return this.queue.length ? this.queue[0] : null;
  }

  update(dt: number, extraMult = 1): void {
    this.energy = Math.min(MATCH.maxEnergy, this.energy + MATCH.energyPerSecond * this.regenMult * extraMult * dt);
    if (this.lockout > 0) this.lockout -= dt;
  }

  canAfford(index: number): boolean {
    const c = this.hand[index];
    return !!c && this.energy >= CARDS[c].cost;
  }

  /** Removes card from hand, pays energy and cycles. Caller validated rules. */
  consume(index: number): CardId {
    const card = this.hand[index];
    this.energy -= CARDS[card].cost;
    const incoming = this.queue.shift();
    this.queue.push(card);
    if (incoming) this.hand[index] = incoming;
    this.lockout = MATCH.cardLockout;
    this.version++;
    return card;
  }

  drain(amount: number): void {
    this.energy = Math.max(0, this.energy - amount);
  }

  gain(amount: number): void {
    this.energy = Math.min(MATCH.maxEnergy, this.energy + amount);
  }
}
