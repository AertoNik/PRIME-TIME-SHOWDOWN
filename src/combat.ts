import { BALANCE, CARDS, WEAPONS, type CardId, type WeaponId } from './data';
import { CardCycle } from './cards';
import { botChoice, preferredRange, type Tactic } from './ai';
export type Side = 'player' | 'enemy';
export interface Fighter { side: Side; x: number; z: number; hp: number; weapon: WeaponId; energy: number; shield: number; smoke: number; stun: number; dodge: number; overdrive: number; cooldown: number; windup: number; pendingCombo: string; dashWindow: number; shockWindow: number; recoil: number; hit: number; stride: number; tactic: Tactic }
export interface CombatEvent { type: 'shot' | 'hit' | 'card' | 'combo' | 'showtime' | 'finish' | 'evade'; side: Side; x: number; z: number; tx?: number; tz?: number; damage?: number; heavy?: boolean; text?: string; card?: CardId; hit?: boolean; weapon?: WeaponId }
export interface MatchStats { damage: number; received: number; cards: number; combos: number; dodges: number; best: string }
export class Combat {
  player: Fighter;
  enemy: Fighter;
  cycle: CardCycle;
  elapsed = 0;
  remaining = BALANCE.duration;
  finished = false;
  winner: Side | 'draw' | null = null;
  showtime = false;
  events: CombatEvent[] = [];
  stats: MatchStats = { damage: 0, received: 0, cards: 0, combos: 0, dodges: 0, best: 'В центре внимания' };
  private aiClock = 2.5;
  constructor(weapon: WeaponId, deck: CardId[], public random: () => number = Math.random, tactic: Tactic = random() < 0.5 ? 'aggressive' : 'cautious') {
    const fighter = (side: Side, gun: WeaponId, z: number): Fighter => ({ side, x: side === 'player' ? -1.1 : 1.1, z, hp: BALANCE.hp, weapon: gun, energy: 7, shield: 0, smoke: 0, stun: 0, dodge: 0, overdrive: 0, cooldown: 0.7, windup: 0, pendingCombo: '', dashWindow: 0, shockWindow: 0, recoil: 0, hit: 0, stride: 0, tactic });
    this.player = fighter('player', weapon, 2.7);
    this.enemy = fighter('enemy', (['pistol', 'shotgun', 'carbine'] as WeaponId[])[Math.floor(random() * 3)], -2.7);
    this.cycle = new CardCycle(deck, random);
  }
  emit(type: CombatEvent['type'], f: Fighter, extra: Partial<CombatEvent> = {}) { this.events.push({ type, side: f.side, x: f.x, z: f.z, ...extra }); }
  play(index: number) { if (this.finished || this.player.stun > 0 || (this.cycle.hand[index] === 'power' && this.player.windup > 0)) return false; const card = this.cycle.play(index, this.player.energy); if (!card) return false; this.activate(this.player, this.enemy, card); this.stats.cards++; return true; }
  activate(f: Fighter, other: Fighter, card: CardId) {
    if (this.finished || f.stun > 0 || f.energy < CARDS[card].cost || (card === 'power' && f.windup > 0)) return false;
    f.energy -= CARDS[card].cost;
    this.emit('card', f, { card, text: CARDS[card].name });
    if (card === 'dash') { f.dodge = 0.65; f.dashWindow = 2; const dx = f.x - other.x, dz = f.z - other.z, d = Math.hypot(dx, dz) || 1; f.x = Math.max(-4.1, Math.min(4.1, f.x - dz / d * 1.7)); f.z = Math.max(-4.5, Math.min(4.5, f.z + dx / d * 1.7)); }
    if (card === 'shield') f.shield = 3;
    if (card === 'smoke') f.smoke = 4;
    if (card === 'overdrive') f.overdrive = 5;
    if (card === 'shock') { other.stun = 1.6; other.windup = 0; other.pendingCombo = ''; f.shockWindow = 2; this.hurt(f, other, 8, false); }
    if (card === 'power') { f.windup = 0.75; f.pendingCombo = f.shockWindow > 0 ? 'SHOCK + POWER' : f.dashWindow > 0 ? 'DASH + POWER' : ''; f.dashWindow = 0; f.shockWindow = 0; }
    return true;
  }
  hurt(from: Fighter, target: Fighter, damage: number, heavy: boolean) {
    if (target.dodge > 0) { this.emit('evade', target, { text: 'DODGE' }); if (target.side === 'player') this.stats.dodges++; return 0; }
    const amount = Math.min(target.hp, Math.round(damage * (target.shield > 0 ? 0.2 : 1)));
    target.hp = Math.max(0, target.hp - amount); target.hit = 0.28;
    const dx = target.x - from.x, dz = target.z - from.z, length = Math.hypot(dx, dz) || 1;
    target.x = Math.max(-4.2, Math.min(4.2, target.x + dx / length * (heavy ? 0.55 : 0.12)));
    target.z = Math.max(-4.7, Math.min(4.7, target.z + dz / length * (heavy ? 0.55 : 0.12)));
    if (from.side === 'player') this.stats.damage += amount; else this.stats.received += amount;
    this.emit('hit', target, { damage: amount, heavy }); return amount;
  }
  shoot(f: Fighter, target: Fighter, heavy = false) {
    const distance = Math.hypot(f.x - target.x, f.z - target.z), gun = WEAPONS[f.weapon];
    const accuracy = (heavy ? 1 : 0.93) * (target.smoke > 0 ? 0.35 : 1);
    const hit = this.random() < accuracy && target.dodge <= 0;
    const combo = heavy ? f.pendingCombo : '';
    let damage = heavy ? 45 * (combo ? 1.5 : 1) : gun.damage;
    if (!heavy && f.weapon === 'shotgun') damage *= Math.max(0.22, Math.min(1.2, 3.3 / Math.max(distance, 0.5)));
    if (!heavy && distance > gun.range + 1) damage *= 0.65;
    f.recoil = 0.22;
    this.emit('shot', f, { tx: target.x, tz: target.z, heavy, hit, weapon: f.weapon });
    if (hit) { const dealt = this.hurt(f, target, damage, heavy); if (combo && dealt > 0) { this.emit('combo', f, { text: combo }); if (f.side === 'player') { this.stats.combos++; this.stats.best = combo; } } }
    else if (target.dodge > 0) { this.emit('evade', target, { text: 'DODGE' }); if (target.side === 'player') this.stats.dodges++; }
    if (heavy) f.pendingCombo = '';
  }
  update(dt: number) {
    if (this.finished) return;
    dt = Math.max(0, Math.min(dt, 0.05)); this.elapsed += dt; this.remaining = Math.max(0, BALANCE.duration - this.elapsed);
    if (!this.showtime && this.elapsed >= BALANCE.showtime) { this.showtime = true; this.emit('showtime', this.player, { text: 'SHOWTIME' }); }
    for (const f of [this.player, this.enemy]) {
      const other = f === this.player ? this.enemy : this.player;
      if (f.hp <= 0 || other.hp <= 0) continue;
      f.energy = Math.min(BALANCE.energy, f.energy + dt * BALANCE.regen * (this.showtime ? 1.25 : 1));
      for (const key of ['shield', 'smoke', 'stun', 'dodge', 'overdrive', 'dashWindow', 'shockWindow', 'recoil', 'hit'] as const) f[key] = Math.max(0, f[key] - dt);
      if (f.stun > 0) continue;
      if (f.windup > 0) { f.windup -= dt; if (f.windup <= 0) this.shoot(f, other, true); continue; }
      const dx = other.x - f.x, dz = other.z - f.z, d = Math.hypot(dx, dz) || 1;
      const desired = preferredRange(WEAPONS[f.weapon].range, f.tactic);
      const radial = Math.max(-1, Math.min(1, (d - desired) * 0.8));
      const strafe = Math.sin(this.elapsed * 0.85 + (f.side === 'player' ? 0 : 2.8)) * 0.85;
      const speed = (f.dodge > 0 ? 5 : 1.3) * dt;
      const ox = f.x, oz = f.z;
      f.x = Math.max(-4.1, Math.min(4.1, f.x + (dx / d * radial - dz / d * strafe) * speed));
      f.z = Math.max(-4.5, Math.min(4.5, f.z + (dz / d * radial + dx / d * strafe) * speed));
      f.stride += Math.hypot(f.x - ox, f.z - oz) * 8;
      f.cooldown -= dt * (f.overdrive > 0 ? 1.9 : 1);
      if (f.cooldown <= 0 && d < 9) { this.shoot(f, other); f.cooldown = WEAPONS[f.weapon].interval; }
    }
    this.aiClock -= dt;
    if (this.aiClock <= 0 && this.enemy.stun <= 0) { this.aiClock = 2.3 + this.random() * 1.8; this.activate(this.enemy, this.player, botChoice(this.enemy.hp, this.player.windup > 0, this.random())); }
    if (this.player.hp <= 0 || this.enemy.hp <= 0 || this.remaining <= 0) this.finish();
  }
  finish() { if (this.finished) return; this.finished = true; this.winner = this.player.hp === this.enemy.hp ? 'draw' : this.player.hp > this.enemy.hp ? 'player' : 'enemy'; this.emit('finish', this.winner === 'enemy' ? this.enemy : this.player); }
  drainEvents() { return this.events.splice(0); }
}
