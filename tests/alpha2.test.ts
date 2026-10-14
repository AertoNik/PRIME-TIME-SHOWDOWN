import { afterEach, describe, expect, it, vi } from 'vitest';
import { Combat } from '../src/combat';
import { BOT_DECKS, botChoice, preferredRange, type Tactic } from '../src/ai';
import { DEFAULT_DECK, CARDS } from '../src/data';
import { clampX, clampZ, sidestep } from '../src/movement';
import { freshProfile, load, reward } from '../src/storage';
import { UI } from '../src/ui';
const create = (tactic: Tactic = 'tactical') => new Combat('pistol', [...DEFAULT_DECK], () => 0.1, tactic);
const tick = (m: Combat, seconds: number) => { for (let i = 0; i < seconds * 60; i++) m.update(1 / 60); };

describe('Alpha 0.2 combos', () => {
  it('SHIELD + OVERDRIVE grants real damage, extends protection and records one combo', () => {
    const m = create(); m.player.energy = 10;
    m.activate(m.player, m.enemy, 'shield'); m.activate(m.player, m.enemy, 'overdrive');
    expect(m.player.fortified).toBe(3); expect(m.player.shield).toBe(4); expect(m.stats.combos).toBe(1);
    expect(m.stats.best).toBe('SHIELD + OVERDRIVE');
    m.enemy.z = -1; m.shoot(m.player, m.enemy); expect(m.stats.damage).toBe(18); // 14 × 1.25, rounded
    expect(m.events.find(e => e.type === 'combo')?.detail).toContain('+25%');
  });
  it('does not grant fortified attacks after the two-second combo window', () => {
    const m = create(); m.activate(m.player, m.enemy, 'shield'); tick(m, 2.1); m.player.energy = 10;
    m.activate(m.player, m.enemy, 'overdrive'); expect(m.player.fortified).toBe(0); expect(m.stats.combos).toBe(0);
  });
  it('SHOCK + POWER requires the target to still be stunned on impact', () => {
    const m = create(); m.player.energy = 10; m.activate(m.player, m.enemy, 'shock'); m.activate(m.player, m.enemy, 'power');
    m.enemy.stun = 0; const hp = m.enemy.hp; m.shoot(m.player, m.enemy, true);
    expect(hp - m.enemy.hp).toBe(45); expect(m.stats.combos).toBe(0);
  });
  it('does not promise a shock combo when the stun cannot last through the windup', () => {
    const m = create(); m.player.energy = 10; m.activate(m.player, m.enemy, 'shock');
    m.enemy.stun = 0.5; m.activate(m.player, m.enemy, 'power'); expect(m.player.pendingCombo).toBe('');
  });
  it('keeps the strongest successful combo as the best moment rather than simply the last', () => {
    const m = create(); m.player.energy = 10; m.activate(m.player, m.enemy, 'shock'); m.activate(m.player, m.enemy, 'power');
    m.shoot(m.player, m.enemy, true); m.player.energy = 10;
    m.activate(m.player, m.enemy, 'shield'); m.activate(m.player, m.enemy, 'overdrive');
    expect(m.stats.combos).toBe(2); expect(m.stats.best).toBe('SHOCK + POWER');
  });
  it('charges energy, counts key cards, and keeps SHIELD → OVERDRIVE playable through the cycle', () => {
    const m = new Combat('pistol', ['shield', 'overdrive', 'smoke', 'power'], () => 0.5);
    m.cycle.hand = ['shield', 'overdrive', 'smoke']; m.cycle.queue = ['power']; m.player.energy = 10;
    expect(m.play(0)).toBe(true); expect(m.play(1)).toBe(true);
    expect(m.player.energy).toBe(10 - CARDS.shield.cost - CARDS.overdrive.cost);
    expect(m.stats.cardUses).toEqual({ shield: 1, overdrive: 1 }); expect(m.stats.cards).toBe(2);
  });
  it('tracks blocked damage and interrupted power attacks', () => {
    const m = create(); m.player.energy = 10; m.activate(m.player, m.enemy, 'shield'); m.hurt(m.enemy, m.player, 50, true);
    expect(m.stats.blocked).toBe(40); expect(m.events.find(e => e.type === 'hit')?.blocked).toBe(true);
    m.activate(m.enemy, m.player, 'power'); m.activate(m.player, m.enemy, 'shock');
    expect(m.stats.interrupts).toBe(1); expect(m.enemy.windup).toBe(0);
  });
});

describe('fair bot decisions and movement', () => {
  it('uses three distinct preferred ranges', () => {
    expect(preferredRange(5, 'aggressive')).toBeLessThan(preferredRange(5, 'tactical'));
    expect(preferredRange(5, 'tactical')).toBeLessThan(preferredRange(5, 'evasive'));
  });
  it('waits a reaction delay, then shields a telegraphed attack', () => {
    const m = create(); m.player.windup = 0.8; m.enemy.energy = 10;
    expect(botChoice(m.enemy, m.player, ['shield','power','shock'], 0.1, 0.5)).toBeNull();
    expect(botChoice(m.enemy, m.player, ['shield','power','shock'], 0.4, 0.5)).toBe('shield');
  });
  it('can interrupt with SHOCK, but cannot use a card it does not hold or afford', () => {
    const m = create(); m.player.windup = 0.8; m.enemy.energy = 3;
    expect(botChoice(m.enemy, m.player, ['power','shock','overdrive'], 0.4, 0.5)).toBe('shock');
    m.enemy.energy = 2;
    expect(botChoice(m.enemy, m.player, ['power','shock','overdrive'], 0.4, 0.5)).toBeNull();
  });
  it('tactical bots conserve energy and follow up a shield with OVERDRIVE', () => {
    const m = create(); m.enemy.energy = 5;
    expect(botChoice(m.enemy, m.player, ['power','shield','shock'], 0, 0.5)).toBeNull();
    m.enemy.shield = 3; m.enemy.shieldWindow = 1;
    expect(botChoice(m.enemy, m.player, ['power','overdrive','shock'], 0, 0.5)).toBe('overdrive');
  });
  it.each(['aggressive','tactical','evasive'] as Tactic[])('%s bot pays energy, uses only its deck and keeps three cards in hand', tactic => {
    const m = create(tactic); m.player.hp = 10000; m.enemy.hp = 10000;
    for (let i = 0; i < 1800; i++) {
      m.update(1 / 60);
      expect(m.enemy.energy).toBeGreaterThanOrEqual(0); expect(m.enemy.energy).toBeLessThanOrEqual(10);
      expect(new Set(m.enemyCycle.hand).size).toBe(3);
      for (const e of m.drainEvents()) if (e.type === 'card' && e.side === 'enemy') expect(BOT_DECKS[tactic]).toContain(e.card);
    }
  });
  it('sidesteps toward available room and remains inside the arena', () => {
    const m = create(); m.player.x = 4; m.player.z = 0; m.enemy.x = 4; m.enemy.z = -3;
    sidestep(m.player, m.enemy, 2.1); expect(m.player.x).toBeLessThan(4);
    expect(clampX(100)).toBe(4.1); expect(clampZ(-100)).toBe(-4.5);
  });
  it('automatic footwork changes position and intent without granting manual dash combos', () => {
    const m = create('evasive'); m.player.hp = m.enemy.hp = 10000; m.player.energy = m.enemy.energy = -100;
    m.enemy.evadeTimer = 0.01; m.update(1/60);
    expect(m.enemy.intent).toBe('evade'); expect(m.enemy.dashWindow).toBe(0);
    expect(m.events.some(e => e.type === 'evade' && e.text === 'SIDESTEP')).toBe(true);
  });
  it('zero or invalid steps never corrupt movement velocities', () => {
    const m = create(); for (const dt of [0, -1, NaN, Infinity]) m.update(dt);
    expect(m.elapsed).toBe(0); expect(m.player.vx).toBe(0); expect(m.enemy.speed).toBe(0);
  });
});

describe('career continuity and TV results', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('loads an Alpha 0.1 save without resetting progress or settings', () => {
    const old = { ...freshProfile(), fans:390, coins:800, wins:4, matches:7, weapon:'shotgun', deck:['shield','overdrive','dash','power'], sound:false };
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(old) }); expect(load()).toEqual(old);
  });
  it('reports a popularity level increase and renders a real victory broadcast', () => {
    const m = create(); m.enemy.hp = 0; m.finish(); const p = freshProfile(); p.fans = 390;
    const r = reward(p, m); expect(r.fromLevel).toBe(1); expect(r.toLevel).toBe(2); expect(r.beforeFans).toBe(390);
    const ui = new UI({} as HTMLElement), html = ui.results(p, m, r);
    expect(html).toContain('VICTORY'); expect(html).toContain('LEVEL UP!'); expect(html).toContain('PLAY AGAIN'); expect(html).toContain('RISING STAR');
  });
});
