// BOSS FIGHT (Alpha 1.3.1, champion overhaul 1.3.3): the legendary champion and his three phases.
// Data only. The simulation side is src/combat/BossDirector.ts; rewards and
// records live in src/meta/GameModes.ts. Guide: docs/GAME_MODES.md.
import { CARD_TUNING, type CutTuning } from './balance';
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
  /** DIRECTOR'S CUT numbers for this phase (default: CARD_TUNING.directors_cut). FINAL BROADCAST is sharper. */
  cut?: CutTuning;
  /** Spotlight colours of the arena during this phase. */
  spots: [number, number, number, number];
}

export interface BossMove {
  id: 'burst' | 'cut' | 'spotlight' | 'star' | 'finale';
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
  /** Access: Classic Duel wins needed with the selected fighter (a fighter who already beat the boss keeps access). */
  unlock: { classicWins: number };
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
  // fighters — a small pressure value disables kiting), works with bursts only
  1: {
    id: 'tactical',
    label: 'ТЕХНИКА',
    desc: 'Держит дистанцию и бьёт короткими очередями.',
    rangeMult: 1,
    strafe: 0.85,
    dodgeMult: 1.1,
    cardEagerness: 1,
    retreatHp: 0,
    energyReserve: 1,
    comboHunter: true,
    pressure: 0.15,
    holdRange: 7.2,
  },
  // pressure: keeps a comfortable firing distance (DIRECTOR'S CUT reaches across the stage),
  // but steps in on openings
  2: {
    id: 'aggressive',
    label: 'ДАВЛЕНИЕ',
    desc: 'Держит удобную дистанцию и чаще бьёт фирменными приёмами.',
    rangeMult: 0.92,
    strafe: 0.72,
    dodgeMult: 1,
    cardEagerness: 1.25,
    retreatHp: 0,
    energyReserve: 0,
    comboHunter: true,
    pressure: 0.3,
    holdRange: 7,
  },
  // final broadcast: all-in show
  3: {
    id: 'reckless',
    label: 'ФИНАЛ',
    desc: 'Максимум шоу: напор и усиленный DIRECTOR\'S CUT.',
    rangeMult: 0.84,
    strafe: 0.6,
    dodgeMult: 0.9,
    cardEagerness: 1.45,
    retreatHp: 0,
    energyReserve: 0,
    comboHunter: true,
    pressure: 0.5,
    holdRange: 6.2,
  },
};

/**
 * FINAL BROADCAST DIRECTOR'S CUT: brighter lines that lead the target further, slightly
 * shorter windows (still above human reaction time), a wider and stronger third shot.
 */
const CUT_P3: CutTuning = {
  ...CARD_TUNING.directors_cut,
  prep: 0.5,
  aim: [0.6, 0.5, 0.62],
  lock: [0.55, 0.52, 0.6],
  gap: 0.28,
  halfWidth: [0.6, 0.6, 0.95],
  length: [12, 12, 13],
  damage: [900, 900, 1620],
  knockback: [1.2, 1.2, 5.5],
  stun: [0, 0, 0.4],
  lead: 0.5,
  recover: 0.85,
  cooldown: 7.5,
};

export const BOSSES: Record<string, BossDef> = {
  vale: {
    id: 'vale',
    rival: 'vale',
    title: 'LEGENDARY SHOWDOWN',
    kicker: 'Чемпион PRIME TIME',
    tagline: 'Главный бой сезона: легендарный чемпион шоу с тяжёлой винтовкой PRIME BREAKER. Три фазы, фирменный DIRECTOR\'S CUT, победа только нокаутом.',
    duration: 120,
    introTime: 5.6,
    unlock: { classicWins: 5 },
    ai: {
      id: 'champion',
      label: 'ЛЕГЕНДА',
      desc: 'Чемпион шоу: тяжёлые очереди, быстрые реакции и фирменные приёмы, но каждый мощный выстрел он честно показывает линией прицела.',
      hpMult: 1,
      // tuned with `npm run modes` (Alpha 1.3.3): 23 800 HP (Vega base ×1.75 in fighters.ts), 86% damage
      dmgMult: 0.86,
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
        desc: 'Чемпион работает технично: держит дистанцию и бьёт тяжёлыми очередями CHAMPION BURST. Только очереди, без фирменных приёмов.',
        at: 1,
        deck: ['dash', 'shield', 'overdrive'],
        behavior: PHASE_BEHAVIOR[1],
        energyMult: 1,
        starPower: 0,
        energyBonus: 0,
        spots: [0xffc23a, 0xfff1c0, 0xffa31a, 0xffffff],
      },
      {
        n: 2,
        title: 'PRIME PRESSURE',
        desc: 'С 65% здоровья: STAR POWER и DIRECTOR\'S CUT — три выстрела по линиям прицела.',
        at: 0.65,
        deck: ['dash', 'overdrive', 'directors_cut', 'charged_shot'],
        behavior: PHASE_BEHAVIOR[2],
        energyMult: 1.1,
        starPower: 4.5,
        energyBonus: 2,
        spots: [0xffc23a, 0xff3a4a, 0xffa31a, 0xff6a2a],
      },
      {
        n: 3,
        title: 'FINAL BROADCAST',
        desc: 'С 30%: максимум шоу. Долгий STAR POWER и усиленный DIRECTOR\'S CUT: ярче линии, хитрее прицел, короче окна, мощнее финальный выстрел.',
        at: 0.3,
        deck: ['directors_cut', 'overdrive', 'charged_shot', 'dash'],
        behavior: PHASE_BEHAVIOR[3],
        energyMult: 1.25,
        starPower: 6,
        energyBonus: 3,
        cut: CUT_P3,
        spots: [0xff2a3a, 0xffc23a, 0xc0102a, 0xff7a1a],
      },
    ],
    moves: [
      {
        id: 'burst',
        name: 'CHAMPION BURST',
        desc: 'PRIME BREAKER бьёт короткими очередями по три тяжёлых выстрела с паузой между ними. Достаёт дальше снайперов.',
        from: 1,
        counter: 'Двигайтесь и держите SHIELD под рукой. После очереди — пауза.',
      },
      {
        id: 'cut',
        name: 'DIRECTOR\'S CUT',
        desc: 'Чемпион вскидывает винтовку и делает три мощных выстрела. Перед каждым — красная линия: сначала следит за вами, потом застывает, и выстрел идёт ровно по ней.',
        from: 2,
        counter: 'Застывшая линия — сигнал: DASH уводит из неё, SHIELD гасит урон, SHOCK срывает серию. После третьего выстрела чемпион открыт.',
      },
      {
        id: 'spotlight',
        name: 'SPOTLIGHT SHOT',
        desc: 'Заряженный выстрел через всю арену. Пробивает щит: щит ломается и гасит только половину.',
        from: 2,
        counter: 'Красная линия — уйдите рывком DASH в сторону.',
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
        name: 'FINAL CUT',
        desc: 'В финальной фазе DIRECTOR\'S CUT ярче и хитрее: линии упреждают движение, окна короче, третий выстрел шире и сильнее.',
        from: 3,
        counter: 'Берегите энергию на DASH или SHIELD к каждой серии.',
      },
    ],
    cardNames: {
      charged_shot: 'SPOTLIGHT SHOT',
      directors_cut: 'DIRECTOR\'S CUT',
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
