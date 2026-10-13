import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/combat.ts';
import type { CardId } from '../src/data.ts';

const deck: CardId[] = ['dash', 'power', 'shield', 'shock'];
function seeded(seed: number) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function advance(match: Match, seconds: number) { for (let t = 0; t < seconds; t += .05) match.step(.05); }

test('Only a valid four-card loadout can enter a match', () => {
  assert.throws(() => new Match('pulse', ['dash', 'dash', 'power', 'shield']));
  assert.throws(() => new Match('pulse', ['dash', 'power', 'shield']));
});

test('Energy and card cycling remain valid across repeated casts', () => {
  const m = new Match('pulse', deck, seeded(4));
  for (let i = 0; i < 400 && !m.finished; i++) {
    m.play(i % 3); m.step(.1);
    assert.ok(m.energy >= 0 && m.energy <= 10);
    assert.equal(new Set([...m.hand, ...m.queue]).size, 4);
    assert.ok(m.hand.every(c => deck.includes(c)));
    assert.equal(m.hand.length, 3);
  }
  assert.ok(m.stats.cards > 5);
});

test('Dash evades a telegraphed heavy shot', () => {
  const m = new Match('pulse', deck, seeded(2));
  m.player.attackIn = 100; m.enemy.attackIn = 100;
  m.warning = .1; m.hand = ['dash', 'power', 'shield']; m.queue = ['shock'];
  assert.ok(m.play(0)); advance(m, .5);
  assert.equal(m.player.hp, m.maxHp);
  assert.ok(m.stats.prevented > 100);
});

test('Shield reduces a heavy shot by 72%', () => {
  const m = new Match('pulse', deck, seeded(2));
  m.player.attackIn = 100; m.enemy.attackIn = 100;
  m.warning = .1; m.hand = ['shield', 'power', 'dash']; m.queue = ['shock'];
  m.play(0); advance(m, .5);
  assert.equal(m.player.hp, m.maxHp - Math.round(112 * .28));
});

test('Shock interrupts the enemy windup and applies stun', () => {
  const m = new Match('pulse', deck, seeded(7));
  m.warning = .8; m.hand = ['shock', 'power', 'shield']; m.queue = ['dash'];
  m.play(0);
  assert.equal(m.warning, 0); assert.equal(m.enemy.stun, 1.8);
  advance(m, .5); assert.equal(m.player.hp, m.maxHp);
});

test('Smoke reduces incoming hits while adrenaline increases the firing rate', () => {
  const setup = (smoke: boolean) => {
    const m = new Match('pulse', ['smoke', 'adrenaline', 'power', 'shield'], seeded(20));
    m.player.attackIn = 100; m.heavyIn = 100; m.defenseIn = 100;
    if (smoke) m.player.smoke = 5;
    advance(m, 4.9);
    return m.player.hp;
  };
  assert.ok(setup(true) > setup(false));
  const shots = (boost: boolean) => {
    const m = new Match('pulse', ['smoke', 'adrenaline', 'power', 'shield'], seeded(20));
    m.enemy.attackIn = 100; m.heavyIn = 100; m.defenseIn = 100;
    if (boost) { m.hand = ['adrenaline', 'power', 'shield']; m.queue = ['smoke']; m.play(0); }
    advance(m, 4.9);
    return m.drainEvents().filter(e => e.type === 'shot' && e.side === 'player').length;
  };
  assert.ok(shots(true) >= shots(false) * 1.5);
});

test('Time limit compares health and supports a draw', () => {
  for (const hp of [1000, 1200]) {
    const m = new Match('scatter', deck, seeded(1));
    m.player.attackIn = 1000; m.enemy.attackIn = 1000; m.heavyIn = 1000; m.defenseIn = 1000;
    m.enemy.hp = hp; advance(m, 76);
    assert.equal(m.remaining, 0); assert.equal(m.finished, true);
    assert.equal(m.winner, hp === 1200 ? 'draw' : 'player');
    const energy = m.energy; assert.equal(m.play(0), false); m.step(.1); assert.equal(m.energy, energy);
  }
});

test('Both weapons complete matches; timely card play improves win rate', () => {
  let passiveWins = 0, tacticalWins = 0;
  for (const weapon of ['pulse', 'scatter'] as const) {
    for (let seed = 1; seed <= 25; seed++) {
      for (const active of [false, true]) {
        const m = new Match(weapon, deck, seeded(seed));
        for (let frame = 0; frame < 1550 && !m.finished; frame++) {
          if (active) {
            const defensive = m.warning > 0 && m.warning < .9;
            const index = m.hand.findIndex((id, i) => m.canPlay(i) && (defensive ? ['dash', 'shield', 'shock'].includes(id) : id === 'power' && m.energy > 4));
            if (index >= 0) m.play(index);
          }
          m.step(.05);
        }
        assert.ok(m.finished); assert.ok(m.elapsed <= 75.1);
        if (m.winner === 'player') active ? tacticalWins++ : passiveWins++;
      }
    }
  }
  console.log(`Balance, 50 seeds per style: passive ${passiveWins}/50, tactical ${tacticalWins}/50`);
  assert.ok(tacticalWins > passiveWins + 15, 'Timing abilities must meaningfully change the outcome');
});
