import { CARDS, type CardId } from './data';
export function shuffled<T>(items: T[], random: () => number): T[] { const result = [...items]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; }
export class CardCycle {
  hand: CardId[];
  queue: CardId[];
  constructor(deck: CardId[], random: () => number) { const order = shuffled(deck, random); this.hand = order.slice(0, 3); this.queue = order.slice(3); }
  play(index: number, energy: number): CardId | null { const card = this.hand[index]; if (!card || energy < CARDS[card].cost) return null; this.hand[index] = this.queue.shift()!; this.queue.push(card); return card; }
  get next() { return this.queue[0]; }
}
