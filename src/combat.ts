import { cardById, type CardId, type WeaponId } from './data';

export type Side = 'player' | 'enemy';
export interface FighterState {
  side: Side; hp: number; x: number; y: number; targetX: number; targetY: number;
  attackIn: number; moveIn: number; shield: number; dodge: number; smoke: number; stun: number; boost: number;
}
export type CombatEvent =
  | { type: 'shot'; side: Side; heavy: boolean; scatter: boolean; targetX: number; targetY: number }
  | { type: 'hit'; side: Side; damage: number; blocked: boolean; critical: boolean }
  | { type: 'miss'; side: Side }
  | { type: 'cast'; side: Side; card: CardId }
  | { type: 'warning'; active: boolean }
  | { type: 'showtime'; active: boolean }
  | { type: 'finish'; winner: Side | 'draw' }
  | { type: 'combo'; count: number };
interface PendingHit { in: number; target: Side; damage: number; accuracy: number; heavy: boolean; }

export function shuffled<T>(array: T[], random = Math.random): T[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export class Match {
  readonly maxHp = 1200;
  readonly maxEnergy = 10;
  player: FighterState;
  enemy: FighterState;
  hand: CardId[];
  queue: CardId[];
  slots = [0, 0, 0];
  energy = 6;
  elapsed = 0;
  remaining = 75;
  finished = false;
  winner: Side | 'draw' | null = null;
  showtime = false;
  showtimeAt: number;
  warning = 0;
  heavyIn = 5.5;
  defenseIn = 10;
  combo = 0;
  lastCardAt = -100;
  stats = { cards: 0, dealt: 0, prevented: 0, combos: 0 };
  private hits: PendingHit[] = [];
  private events: CombatEvent[] = [];
  constructor(public weapon: WeaponId, deck: CardId[], private random = Math.random) {
    if (deck.length !== 4 || new Set(deck).size !== 4) throw new Error('Choose four unique cards');
    const pool = shuffled(deck, random);
    this.hand = pool.slice(0, 3);
    this.queue = pool.slice(3);
    this.showtimeAt = 18 + random() * 8;
    this.player = this.fighter('player', 135, 410);
    this.enemy = this.fighter('enemy', 315, 370);
  }
  private fighter(side: Side, x: number, y: number): FighterState {
    return { side, hp: this.maxHp, x, y, targetX: x, targetY: y, attackIn: 0.7, moveIn: 1, shield: 0, dodge: 0, smoke: 0, stun: 0, boost: 0 };
  }
  drainEvents() { return this.events.splice(0); }
  canPlay(index: number) {
    return !this.finished && index >= 0 && index < 3 && this.slots[index] <= 0 && this.energy >= cardById(this.hand[index]).cost;
  }
  play(index: number): boolean {
    if (!this.canPlay(index)) return false;
    const card = this.hand[index];
    this.energy -= cardById(card).cost;
    this.slots[index] = 0.52;
    this.stats.cards++;
    this.combo = this.elapsed - this.lastCardAt < 4 ? this.combo + 1 : 1;
    this.lastCardAt = this.elapsed;
    if (this.combo >= 2) { this.events.push({ type: 'combo', count: this.combo }); this.stats.combos++; }
    this.cast('player', card);
    this.hand[index] = this.queue.shift()!;
    this.queue.push(card);
    return true;
  }
  private cast(side: Side, card: CardId) {
    const f = this[side];
    this.events.push({ type: 'cast', side, card });
    switch (card) {
      case 'dash':
        f.dodge = 1.05;
        f.targetX = side === 'player' ? 88 + this.random() * 100 : 270 + this.random() * 80;
        f.targetY = f.y > 405 ? 350 : 460;
        break;
      case 'power': this.fire(side, 125, 1, true); break;
      case 'shield': f.shield = 4; break;
      case 'smoke': f.smoke = 5; break;
      case 'shock': {
        const other = this[side === 'player' ? 'enemy' : 'player'];
        other.stun = 1.8;
        if (side === 'player' && this.warning > 0) {
          this.warning = 0; this.heavyIn = 6;
          this.events.push({ type: 'warning', active: false });
        }
        this.hits.push({ in: 0.05, target: other.side, damage: 35, accuracy: 1, heavy: false });
        break;
      }
      case 'adrenaline': f.boost = 5; break;
    }
  }
  private fire(side: Side, damage: number, accuracy: number, heavy = false) {
    const target = this[side === 'player' ? 'enemy' : 'player'];
    this.events.push({ type: 'shot', side, heavy, scatter: side === 'player' && this.weapon === 'scatter' && !heavy, targetX: target.x, targetY: target.y });
    this.hits.push({ in: heavy ? 0.25 : 0.16, target: target.side, damage: damage * (this.showtime ? 1.2 : 1), accuracy, heavy });
  }
  step(dt: number) {
    if (this.finished) return;
    dt = Math.min(dt, 0.1);
    this.elapsed += dt;
    this.remaining = Math.max(0, 75 - this.elapsed);
    this.energy = Math.min(this.maxEnergy, this.energy + dt * (this.showtime ? 1.4 : 0.78));
    this.slots = this.slots.map(v => Math.max(0, v - dt));
    if (!this.showtime && this.elapsed >= this.showtimeAt && this.elapsed < this.showtimeAt + 6) {
      this.showtime = true; this.events.push({ type: 'showtime', active: true });
    } else if (this.showtime && this.elapsed >= this.showtimeAt + 6) {
      this.showtime = false; this.events.push({ type: 'showtime', active: false });
    }
    for (const f of [this.player, this.enemy]) {
      for (const buff of ['shield', 'dodge', 'smoke', 'stun', 'boost'] as const) f[buff] = Math.max(0, f[buff] - dt);
      if (f.stun > 0) continue;
      f.moveIn -= dt;
      if (f.moveIn <= 0 && f.dodge <= 0) {
        f.targetX = f.side === 'player' ? 90 + this.random() * 120 : 250 + this.random() * 110;
        f.targetY = 350 + this.random() * 110;
        f.moveIn = 1.5 + this.random() * 1.5;
      }
      const dx = f.targetX - f.x, dy = f.targetY - f.y;
      const distance = Math.hypot(dx, dy);
      const speed = (f.dodge > 0 ? 460 : 42) * dt;
      if (distance > 1) { f.x += dx / distance * Math.min(distance, speed); f.y += dy / distance * Math.min(distance, speed); }
      f.attackIn -= dt * (f.boost > 0 ? 1.85 : 1) * (this.showtime ? 1.18 : 1);
      if (f.attackIn <= 0) {
        const scatter = f.side === 'player' && this.weapon === 'scatter';
        const distanceToEnemy = Math.hypot(this.player.x - this.enemy.x, this.player.y - this.enemy.y);
        this.fire(f.side, scatter ? 40 : f.side === 'player' ? 24 : 26, scatter ? distanceToEnemy < 205 ? 0.94 : 0.68 : 0.88);
        f.attackIn += scatter ? 1.15 : f.side === 'player' ? 0.8 : 0.9;
      }
    }
    if (this.enemy.stun <= 0) {
      if (this.warning > 0) {
        this.warning -= dt;
        if (this.warning <= 0) { this.fire('enemy', 112, 1, true); this.heavyIn = 7.5 + this.random() * 2; this.events.push({ type: 'warning', active: false }); }
      } else {
        this.heavyIn -= dt;
        if (this.heavyIn <= 0) { this.warning = 1.35; this.events.push({ type: 'warning', active: true }); }
      }
      this.defenseIn -= dt;
      if (this.defenseIn <= 0) { this.cast('enemy', this.random() > 0.5 ? 'shield' : 'adrenaline'); this.defenseIn = 12; }
    }
    const due = this.hits.filter(hit => (hit.in -= dt) <= 0);
    this.hits = this.hits.filter(hit => hit.in > 0);
    for (const hit of due) {
      const target = this[hit.target];
      const smoke = target.smoke > 0;
      if (target.dodge > 0 || this.random() > hit.accuracy * (smoke ? 0.35 : 1)) {
        this.events.push({ type: 'miss', side: hit.target });
        if (hit.target === 'player') this.stats.prevented += Math.round(hit.damage);
        continue;
      }
      const blocked = target.shield > 0;
      const damage = Math.round(hit.damage * (blocked ? 0.28 : 1));
      target.hp = Math.max(0, target.hp - damage);
      if (target.side === 'enemy') this.stats.dealt += damage;
      else if (blocked) this.stats.prevented += Math.round(hit.damage - damage);
      this.events.push({ type: 'hit', side: target.side, damage, blocked, critical: hit.heavy });
    }
    if (this.player.hp <= 0 || this.enemy.hp <= 0 || this.remaining <= 0) {
      this.finished = true;
      this.winner = this.player.hp === this.enemy.hp ? 'draw' : this.player.hp > this.enemy.hp ? 'player' : 'enemy';
      this.events.push({ type: 'finish', winner: this.winner });
    }
  }
}
