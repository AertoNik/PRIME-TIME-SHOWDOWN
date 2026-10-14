import { BALANCE, CARDS, WEAPONS, type CardId, type WeaponId } from './data';
import { CardCycle } from './cards';
import { BOT_DECKS, botChoice, type Tactic } from './ai';
import { moveFighter, sidestep } from './movement';
export type Side = 'player' | 'enemy';
export interface Fighter { side: Side; x: number; z: number; hp: number; weapon: WeaponId; energy: number; shield: number; smoke: number; stun: number; dodge: number; overdrive: number; cooldown: number; windup: number; pendingCombo: string; dashWindow: number; shockWindow: number; recoil: number; hit: number; stride: number; tactic: Tactic; shieldWindow: number; fortified: number; vx: number; vz: number; speed: number; movePhase: number; evadeTimer: number; intent: 'advance' | 'retreat' | 'strafe' | 'evade' | 'charge' | 'stunned' }
export interface CombatEvent { type: 'shot' | 'hit' | 'card' | 'combo' | 'showtime' | 'finish' | 'evade'; side: Side; x: number; z: number; tx?: number; tz?: number; damage?: number; heavy?: boolean; text?: string; card?: CardId; hit?: boolean; weapon?: WeaponId; blocked?: boolean; detail?: string }
export interface MatchStats { damage: number; received: number; cards: number; combos: number; dodges: number; best: string; cardUses: Partial<Record<CardId, number>>; interrupts: number; blocked: number }
export class Combat {
  player: Fighter;
  enemy: Fighter;
  cycle: CardCycle;
  enemyCycle: CardCycle;
  elapsed = 0;
  remaining = BALANCE.duration;
  finished = false;
  winner: Side | 'draw' | null = null;
  showtime = false;
  events: CombatEvent[] = [];
  stats: MatchStats = { damage: 0, received: 0, cards: 0, combos: 0, dodges: 0, best: 'В центре внимания', cardUses: {}, interrupts: 0, blocked: 0 };
  private bestComboValue = 0;
  private aiClock = 1.4;
  private threatAge = 0;
  private aiReadyAt = 0;
  constructor(weapon: WeaponId, deck: CardId[], public random: () => number = Math.random, tactic: Tactic = (['aggressive', 'tactical', 'evasive'] as Tactic[])[Math.floor(random() * 3)]) {
    const fighter = (side: Side, gun: WeaponId, z: number): Fighter => ({ side, x: side === 'player' ? -1.1 : 1.1, z, hp: BALANCE.hp, weapon: gun, energy: 7, shield: 0, smoke: 0, stun: 0, dodge: 0, overdrive: 0, cooldown: 0.7, windup: 0, pendingCombo: '', dashWindow: 0, shockWindow: 0, recoil: 0, hit: 0, stride: 0, tactic: side === 'player' ? 'tactical' : tactic, shieldWindow: 0, fortified: 0, vx: 0, vz: 0, speed: 0, movePhase: side === 'player' ? 0.3 : 2.7, evadeTimer: 5 + random() * 3, intent: 'strafe' });
    this.player = fighter('player', weapon, 2.7);
    this.enemy = fighter('enemy', (['pistol', 'shotgun', 'carbine'] as WeaponId[])[Math.floor(random() * 3)], -2.7);
    this.cycle = new CardCycle(deck, random);
    this.enemyCycle = new CardCycle(BOT_DECKS[tactic], random);
  }
  emit(type: CombatEvent['type'], f: Fighter, extra: Partial<CombatEvent> = {}) { this.events.push({ type, side: f.side, x: f.x, z: f.z, ...extra }); }
  play(index: number) { if (this.finished || this.player.stun > 0 || (this.cycle.hand[index] === 'power' && this.player.windup > 0)) return false; const card = this.cycle.play(index, this.player.energy); if (!card) return false; this.activate(this.player, this.enemy, card); this.stats.cards++; this.stats.cardUses[card] = (this.stats.cardUses[card] || 0) + 1; return true; }
  activate(f: Fighter, other: Fighter, card: CardId) {
    if (this.finished || f.stun > 0 || f.energy < CARDS[card].cost || (card === 'power' && f.windup > 0)) return false;
    f.energy -= CARDS[card].cost;
    this.emit('card', f, { card, text: CARDS[card].name, tx: other.x, tz: other.z });
    if (card === 'dash') { const x = f.x, z = f.z; f.dodge = 0.65; f.dashWindow = 2; sidestep(f, other, 2.1); this.emit('evade', f, { text: 'DASH TRAIL', tx: x, tz: z }); }
    if (card === 'shield') { f.shield = 3; f.shieldWindow = 2; }
    if (card === 'smoke') f.smoke = 4;
    if (card === 'overdrive') {
      f.overdrive = 5;
      if (f.shieldWindow > 0 && f.shield > 0) {
        f.fortified = 3; f.shield = Math.max(f.shield, 4); f.shieldWindow = 0;
        this.combo(f, 'SHIELD + OVERDRIVE', '+25% УРОНА · ЩИТ +1 С', 22);
      }
    }
    if (card === 'shock') {
      const interrupted = other.windup > 0;
      other.stun = 1.6; other.windup = 0; other.pendingCombo = ''; f.shockWindow = 2;
      this.hurt(f, other, 8, false);
      if (interrupted) { this.emit('evade', f, { text: 'INTERRUPTED', detail: 'АТАКА ПРЕРВАНА' }); if (f.side === 'player') this.stats.interrupts++; }
    }
    if (card === 'power') {
      f.windup = BALANCE.powerWindup;
      f.pendingCombo = f.shockWindow > 0 && other.stun > BALANCE.powerWindup ? 'SHOCK + POWER' : f.dashWindow > 0 ? 'DASH + POWER' : '';
      f.dashWindow = 0; f.shockWindow = 0;
    }
    return true;
  }
  combo(f: Fighter, text: string, detail: string, value: number) {
    this.emit('combo', f, { text, detail });
    if (f.side === 'player') { this.stats.combos++; if (value >= this.bestComboValue) { this.bestComboValue = value; this.stats.best = text; } }
  }
  hurt(from: Fighter, target: Fighter, damage: number, heavy: boolean) {
    if (target.dodge > 0) { this.emit('evade', target, { text: 'DODGE' }); if (target.side === 'player') this.stats.dodges++; return 0; }
    const amount = Math.min(target.hp, Math.round(damage * (target.shield > 0 ? 0.2 : 1)));
    target.hp = Math.max(0, target.hp - amount); target.hit = heavy ? 0.42 : 0.25;
    const dx = target.x - from.x, dz = target.z - from.z, length = Math.hypot(dx, dz) || 1;
    target.x = Math.max(-4.2, Math.min(4.2, target.x + dx / length * (target.shield > 0 ? 0.04 : heavy ? 0.8 : 0.15)));
    target.z = Math.max(-4.7, Math.min(4.7, target.z + dz / length * (target.shield > 0 ? 0.04 : heavy ? 0.8 : 0.15)));
    if (from.side === 'player') this.stats.damage += amount; else this.stats.received += amount;
    if (target.side === 'player' && target.shield > 0) this.stats.blocked += Math.round(damage) - amount;
    this.emit('hit', target, { damage: amount, heavy, blocked: target.shield > 0 }); return amount;
  }
  shoot(f: Fighter, target: Fighter, heavy = false) {
    const distance = Math.hypot(f.x - target.x, f.z - target.z), gun = WEAPONS[f.weapon];
    const accuracy = (heavy ? 1 : 0.93) * (target.smoke > 0 ? 0.35 : 1);
    const hit = this.random() < accuracy && target.dodge <= 0;
    const combo = heavy && (f.pendingCombo !== 'SHOCK + POWER' || target.stun > 0) ? f.pendingCombo : '';
    let damage = heavy ? 45 * (combo ? 1.5 : 1) : gun.damage * (f.fortified > 0 ? 1.25 : 1);
    if (!heavy && f.weapon === 'shotgun') damage *= Math.max(0.22, Math.min(1.2, 3.3 / Math.max(distance, 0.5)));
    if (!heavy && distance > gun.range + 1) damage *= 0.65;
    f.recoil = heavy ? 0.5 : f.weapon === 'shotgun' ? 0.38 : 0.25;
    this.emit('shot', f, { tx: target.x, tz: target.z, heavy, hit, weapon: f.weapon, text: combo });
    if (hit) { const dealt = this.hurt(f, target, damage, heavy); if (combo && dealt > 0) this.combo(f, combo, '+50% УРОНА', dealt); }
    else if (target.dodge > 0) { this.emit('evade', target, { text: 'DODGE' }); if (target.side === 'player') this.stats.dodges++; }
    if (heavy) f.pendingCombo = '';
  }
  update(dt: number) {
    if (this.finished || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.max(0, Math.min(dt, 0.05)); this.elapsed += dt; this.remaining = Math.max(0, BALANCE.duration - this.elapsed);
    if (!this.showtime && this.elapsed >= BALANCE.showtime) { this.showtime = true; this.emit('showtime', this.player, { text: 'SHOWTIME' }); }
    for (const f of [this.player, this.enemy]) {
      const other = f === this.player ? this.enemy : this.player;
      if (f.hp <= 0 || other.hp <= 0) continue;
      f.energy = Math.min(BALANCE.energy, f.energy + dt * BALANCE.regen * (this.showtime ? 1.25 : 1));
      for (const key of ['shield', 'smoke', 'stun', 'dodge', 'overdrive', 'dashWindow', 'shockWindow', 'shieldWindow', 'fortified', 'recoil', 'hit'] as const) f[key] = Math.max(0, f[key] - dt);
      if (f.stun > 0) { f.speed = 0; f.intent = 'stunned'; continue; }
      if (f.windup > 0) { f.speed = 0; f.intent = 'charge'; f.windup -= dt; if (f.windup <= 0) this.shoot(f, other, true); continue; }
      f.evadeTimer -= dt;
      if (f.evadeTimer <= 0) {
        f.evadeTimer = (f.tactic === 'evasive' ? 4 : 6.5) + this.random() * 2;
        if (f.dodge <= 0) { f.dodge = 0.16; sidestep(f, other, 0.65); this.emit('evade', f, { text: 'SIDESTEP' }); }
      }
      moveFighter(f, other, this.elapsed, dt);
      const d = Math.hypot(other.x - f.x, other.z - f.z);
      f.cooldown -= dt * (f.overdrive > 0 ? 1.9 : 1);
      if (f.cooldown <= 0 && d < 9) { this.shoot(f, other); f.cooldown = WEAPONS[f.weapon].interval; }
    }
    this.threatAge = this.player.windup > 0 ? this.threatAge + dt : 0;
    this.aiClock -= dt;
    if (this.aiClock <= 0 && this.elapsed >= this.aiReadyAt && this.enemy.hp > 0 && this.player.hp > 0) {
      this.aiClock = 0.18 + this.random() * 0.12;
      const choice = botChoice(this.enemy, this.player, this.enemyCycle.hand, this.threatAge, this.random());
      if (choice) {
        const index = this.enemyCycle.hand.indexOf(choice);
        if (this.activate(this.enemy, this.player, choice)) {
          // activate has already paid the energy. Rotation never has a separate bot exemption.
          this.enemyCycle.play(index, CARDS[choice].cost);
          this.aiReadyAt = this.elapsed + (choice === 'shield' || choice === 'shock' || choice === 'dash' ? 0.48 : 1.15);
        }
      }
    }
    if (this.player.hp <= 0 || this.enemy.hp <= 0 || this.remaining <= 0) this.finish();
  }
  finish() { if (this.finished) return; if (this.stats.combos === 0) this.stats.best = this.stats.interrupts > 0 ? `СОРВАНО АТАК: ${this.stats.interrupts}` : this.stats.dodges > 0 ? `УКЛОНЕНИЯ: ${this.stats.dodges}` : 'Ни секунды вне эфира'; this.finished = true; this.winner = this.player.hp === this.enemy.hp ? 'draw' : this.player.hp > this.enemy.hp ? 'player' : 'enemy'; this.emit('finish', this.winner === 'enemy' ? this.enemy : this.player); }
  drainEvents() { return this.events.splice(0); }
}
