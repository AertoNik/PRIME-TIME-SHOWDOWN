// BOSS FIGHT (Alpha 1.3.1): the legendary champion and his three phases.
// Data only. The simulation side is src/combat/BossDirector.ts; rewards and
// records live in src/meta/GameModes.ts. Guide: docs/GAME_MODES.md.
import { CARD_TUNING } from './balance';
import type { CosmeticId } from './cosmetics.config';
import type { BehaviorDef, CardId, DifficultyDef, RivalId } from './types';

export interface BossPhase {
  /** 1-based phase number. */
  n: 1 | 2 | 3;
  title: string;
  /** What the producer should expect (prep screen, banner). */
  desc: string;
  /** The phase starts when the boss's health drops to this fraction. */
  at: number;
  /** The boss's 4 cards in this phase (3 in hand + 1 queued). */
  deck: CardId[];
  /** AI personality for the phase (same fields as BEHAVIORS). */
  behavior: BehaviorDef;
  /** Card-energy regeneration multiplier. */
  energyMult: number;
  /** STAR POWER on entering the phase: seconds of OVERDRIVE (0 = none). */
  starPower: number;
  /** Energy added on entering the phase. */
  energyBonus: number;
  /** PRIME PULSE numbers for this phase (default: CARD_TUNING.prime_pulse). FINAL BROADCAST is stronger. */
  pulse?: typeof CARD_TUNING.prime_pulse;
  /** Spotlight colours of the arena during this phase. */
  spots: [number, number, number, number];
}

export interface BossMove {
  id: 'spotlight' | 'pulse' | 'star' | 'finale';
  name: string;
  desc: string;
  /** Phase from which the move is used. */
  from: 1 | 2 | 3;
  /** How to answer it. */
  counter: string;
}

export interface BossDef {
  id: string;
  rival: RivalId;
  /** Show title of the fight. */
  title: string;
  kicker: string;
  tagline: string;
  /** Fight length (seconds). The win is by knockout only: on time-up the champion keeps the title. */
  duration: number;
  /** Longer pre-fight intro for the boss presentation (seconds, Classic: 3.4). */
  introTime: number;
  /** Rival AI quality: between "Профи" and "Чемпион", with fair telegraph timing. */
  ai: DifficultyDef;
  phases: BossPhase[];
  moves: BossMove[];
  /** Names the HUD shows when the boss plays a card. */
  cardNames: Partial<Record<CardId, string>>;
  rewards: {
    /** Difficulty used for the regular match purse (reward multiplier). */
    purseDifficulty: 'pro';
    /** Extra multiplier on the match money for every boss fight. */
    moneyMult: number;
    /** Paid once: the first win over the champion. */
    firstWin: { money: number; fans: number; rep: number; cosmetic: CosmeticId };
  };
}

const PHASE_BEHAVIOR: Record<1 | 2 | 3, BehaviorDef> = {
  // technical: holds the centre of the stage (a champion never runs from shorter-ranged
  // fighters — a small pressure value disables kiting), reads you, builds combos
  1: {
    id: 'tactical',
    label: 'ТЕХНИКА',
    desc: 'Держит дистанцию, проверяет защиту, собирает комбо.',
    rangeMult: 1,
    strafe: 0.85,
    dodgeMult: 1.1,
    cardEagerness: 1,
    retreatHp: 0,
    energyReserve: 1,
    comboHunter: true,
    pressure: 0.15,
  },
  // pressure: closes in and uses PRIME PULSE at mid range
  2: {
    id: 'aggressive',
    label: 'ДАВЛЕНИЕ',
    desc: 'Сокращает дистанцию и чаще бьёт фирменными приёмами.',
    rangeMult: 0.78,
    strafe: 0.65,
    dodgeMult: 1,
    cardEagerness: 1.25,
    retreatHp: 0,
    energyReserve: 0,
    comboHunter: true,
    pressure: 0.5,
  },
  // final broadcast: all-in show
  3: {
    id: 'reckless',
    label: 'ФИНАЛ',
    desc: 'Максимум шоу: постоянный напор и усиленная PRIME PULSE.',
    rangeMult: 0.62,
    strafe: 0.5,
    dodgeMult: 0.9,
    cardEagerness: 1.45,
    retreatHp: 0,
    energyReserve: 0,
    comboHunter: true,
    pressure: 0.9,
  },
};

export const BOSSES: Record<string, BossDef> = {
  vale: {
    id: 'vale',
    rival: 'vale',
    title: 'LEGENDARY SHOWDOWN',
    kicker: 'Чемпион PRIME TIME',
    tagline: 'Главный бой сезона: легендарный чемпион шоу с резонатором PRIME OSCILLATOR. Три фазы, фирменная волна PRIME PULSE, победа только нокаутом.',
    duration: 120,
    introTime: 5.6,
    ai: {
      id: 'champion',
      label: 'ЛЕГЕНДА',
      desc: 'Чемпион шоу: быстрые реакции, комбо и фирменные приёмы, но каждый мощный удар он честно показывает красной зоной.',
      hpMult: 1,
      // tuned with `npm run modes`: 23 800 HP (Vega base ×1.75 in fighters.ts), 75% damage
      dmgMult: 0.75,
      energyMult: 1,
      reaction: 0.4,
      reactMin: 0.3,
      reactMax: 0.5,
      decideMin: 0.45,
      decideMax: 0.8,
      comboPlanning: 0.7,
      aimLead: 0.8,
      aimError: 0.06,
      dodgeSkill: 0.55,
      cardSmarts: 0.9,
      telegraphMult: 1.05,
      rewardMult: 1.6,
      unlockLevel: 1,
    },
    phases: [
      {
        n: 1,
        title: 'SHOW OPENING',
        desc: 'Чемпион работает технично: держит дистанцию, стреляет резонансными дисками и бьёт SPOTLIGHT SHOT.',
        at: 1,
        deck: ['dash', 'shield', 'overdrive', 'charged_shot'],
        behavior: PHASE_BEHAVIOR[1],
        energyMult: 1,
        starPower: 0,
        energyBonus: 0,
        spots: [0xffc23a, 0xfff1c0, 0xffa31a, 0xffffff],
      },
      {
        n: 2,
        title: 'PRIME PRESSURE',
        desc: 'С 65% здоровья: STAR POWER, напор и волна PRIME PULSE.',
        at: 0.65,
        deck: ['dash', 'overdrive', 'prime_pulse', 'charged_shot'],
        behavior: PHASE_BEHAVIOR[2],
        energyMult: 1.1,
        starPower: 4.5,
        energyBonus: 2,
        spots: [0xffc23a, 0xff3a4a, 0xffa31a, 0xff6a2a],
      },
      {
        n: 3,
        title: 'FINAL BROADCAST',
        desc: 'С 30%: максимум шоу. Долгий STAR POWER и усиленная PRIME PULSE: шире, дальше, сильнее и чаще.',
        at: 0.3,
        deck: ['prime_pulse', 'overdrive', 'charged_shot', 'dash'],
        behavior: PHASE_BEHAVIOR[3],
        energyMult: 1.25,
        starPower: 6,
        energyBonus: 3,
        // FINAL BROADCAST: a longer, more visible charge for a wider and stronger wave
        pulse: { ...CARD_TUNING.prime_pulse, telegraph: 1.45, range: 8.4, halfAngle: 0.6, damage: 1100, knockback: 4.5, stun: 0.4, recover: 0.6, cooldown: 5 },
        spots: [0xff2a3a, 0xffc23a, 0xc0102a, 0xff7a1a],
      },
    ],
    moves: [
      {
        id: 'spotlight',
        name: 'SPOTLIGHT SHOT',
        desc: 'Заряженный луч через всю арену. Пробивает щит: щит ломается и гасит только половину.',
        from: 1,
        counter: 'Красная линия — уйдите рывком DASH в сторону.',
      },
      {
        id: 'pulse',
        name: 'PRIME PULSE',
        desc: 'Резонатор заряжается, перед чемпионом загорается красный сектор — и по нему проходит энергетическая волна.',
        from: 2,
        counter: 'SHIELD поглощает волну. DASH — когда сектор застынет. После волны чемпион открыт.',
      },
      {
        id: 'star',
        name: 'STAR POWER',
        desc: 'В начале 2-й и 3-й фазы чемпион входит в разгон: стреляет чаще и сильнее.',
        from: 2,
        counter: 'Переждите разгон: SHIELD, SMOKE или дистанция.',
      },
      {
        id: 'finale',
        name: 'FINAL PULSE',
        desc: 'В финальной фазе PRIME PULSE шире, дальше и сильнее, а перезаряжается быстрее.',
        from: 3,
        counter: 'Держите энергию на SHIELD или DASH к каждой волне.',
      },
    ],
    cardNames: {
      charged_shot: 'SPOTLIGHT SHOT',
      prime_pulse: 'PRIME PULSE',
      overdrive: 'STAR POWER',
      shield: 'CHAMPION GUARD',
    },
    rewards: {
      purseDifficulty: 'pro',
      moneyMult: 1.25,
      firstWin: { money: 1500, fans: 1500, rep: 80, cosmetic: 'title_prime_legend' },
    },
  },
};

export const BOSS_ORDER: string[] = ['vale'];

export function bossById(id: string): BossDef | null {
  return BOSSES[id] ?? null;
}
