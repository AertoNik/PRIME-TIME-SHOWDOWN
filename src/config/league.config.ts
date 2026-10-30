import { FIGHTER_ORDER } from './fighters';
import type { CardId, FighterId } from './types';

// Alpha 1.9.0 — PRIME LEAGUE. The one source of every league number: the game shows them, `npm run backend:rules`
// copies them to backend/pb_hooks/lib/league_rules.js (the server decides with exactly these), `npm run league:sim`
// models them. PROPOSED STARTING SETTINGS — they need the owner's product approval before PRODUCTION
// (docs/PRIME_LEAGUE_BALANCE.md shows the simulation behind each one).

/**
 * Who may fight in PRIME LEAGUE: exactly the roster of the character menu (FIGHTER_ORDER) — fighters a player signs in
 * the career, opens in an event or buys in PRIME SHOP. Career rivals (ДЕКС, ТАНК, ЗОИ, КРАШ — RIVALS), the champion
 * (BOSSES) and any NPC are other entities and never appear here. The server checks ownership on top of this list.
 */
export const LEAGUE_FIGHTERS: readonly FighterId[] = FIGHTER_ORDER;

/** Version of the participation rules a player accepts on joining (a new text = a new number = accept again). */
export const LEAGUE_RULES_VERSION = 1;

// ------------------------------------------------------------------ AI director tactics
export type TacticId = 'assault' | 'balance' | 'fortress' | 'counter' | 'combo' | 'adapt';
export type CardKind = 'attack' | 'control' | 'defense';

export interface TacticDef {
  id: TacticId;
  name: string;
  ru: string;
  en: string;
  descRu: string;
  descEn: string;
  /** Card choice only: a multiplier on the AI's own score of a card of each kind (1 = unchanged). */
  weights: Record<CardKind, number>;
  /** 0..1 how often the director opens one of its combos. */
  comboPlanning: number;
  /** Energy it prefers to keep after a card (it still plays strong cards below it). */
  energyReserve: number;
  /** Multiplier on how often it answers a VISIBLE threat with a card (a charge, a shot on its way). */
  react: number;
  comboHunter: boolean;
  /** PRIME ADAPT: priorities follow the stage of the fight (see adaptWeights). */
  adaptive?: boolean;
}

export const TACTICS: Record<TacticId, TacticDef> = {
  assault: {
    id: 'assault',
    name: 'PRIME ASSAULT',
    ru: 'Штурм эфира',
    en: 'Air Assault',
    descRu: 'Атакующие карты и давление. Меньше бережёт энергию и реже защищается.',
    descEn: 'Attack cards and pressure. Spends energy freely, defends less often.',
    weights: { attack: 1.35, control: 0.9, defense: 0.75 },
    comboPlanning: 0.35,
    energyReserve: 0,
    react: 0.85,
    comboHunter: false,
  },
  balance: {
    id: 'balance',
    name: 'PRIME BALANCE',
    ru: 'Идеальный эфир',
    en: 'Perfect Broadcast',
    descRu: 'Равновесие атаки, защиты и энергии. Хороший выбор для первой защиты.',
    descEn: 'Even attack, defence and energy. A good first defence.',
    weights: { attack: 1, control: 1, defense: 1 },
    comboPlanning: 0.5,
    energyReserve: 1,
    react: 1,
    comboHunter: false,
  },
  fortress: {
    id: 'fortress',
    name: 'PRIME FORTRESS',
    ru: 'Железная оборона',
    en: 'Iron Fortress',
    descRu: 'Щиты, уклонения и выживание. Держит запас энергии на ответ.',
    descEn: 'Shields, dodges and survival. Keeps energy in reserve to answer.',
    weights: { attack: 0.8, control: 1, defense: 1.45 },
    comboPlanning: 0.4,
    energyReserve: 3,
    react: 1.25,
    comboHunter: false,
  },
  counter: {
    id: 'counter',
    name: 'PRIME COUNTER',
    ru: 'Обратный удар',
    en: 'Counterstrike',
    descRu: 'Отвечает на видимые угрозы: прерывает заряды, уходит от выстрелов, ловит на ошибке.',
    descEn: 'Answers visible threats: interrupts charges, slips shots, punishes mistakes.',
    weights: { attack: 0.95, control: 1.25, defense: 1.15 },
    comboPlanning: 0.45,
    energyReserve: 2,
    react: 1.4,
    comboHunter: false,
  },
  combo: {
    id: 'combo',
    name: 'PRIME COMBO',
    ru: 'Мастер комбинаций',
    en: 'Combo Master',
    descRu: 'Собирает связки из карт колоды. Сильнее с колодой, где есть пары для комбо.',
    descEn: 'Builds combos from its deck. Stronger with a deck that has combo pairs.',
    weights: { attack: 1.05, control: 1.05, defense: 0.9 },
    comboPlanning: 0.95,
    energyReserve: 1,
    react: 0.95,
    comboHunter: true,
  },
  adapt: {
    id: 'adapt',
    name: 'PRIME ADAPT',
    ru: 'Режиссёр боя',
    en: 'Fight Director',
    descRu: 'Меняет приоритеты по ходу боя: бережётся при малом HP, давит, когда соперник слаб.',
    descEn: 'Shifts priorities as the fight goes: guards when hurt, presses when the foe is low.',
    weights: { attack: 1, control: 1, defense: 1 },
    comboPlanning: 0.55,
    energyReserve: 1,
    react: 1.1,
    comboHunter: false,
    adaptive: true,
  },
};

export const TACTIC_ORDER: TacticId[] = ['balance', 'assault', 'fortress', 'counter', 'combo', 'adapt'];

/** PRIME ADAPT: the weights for the moment (only what both sides can see: HP and the clock). */
export function adaptWeights(ownHp: number, foeHp: number, time: number): Record<CardKind, number> {
  if (ownHp < 0.4 && ownHp < foeHp) return TACTICS.fortress.weights;
  if (foeHp < 0.35 || (time > 50 && ownHp > foeHp)) return TACTICS.assault.weights;
  if (time < 15) return TACTICS.balance.weights;
  return TACTICS.counter.weights;
}

/** Every card the league allows, by kind (DIRECTOR'S CUT is the boss's — never in a league deck). */
export const CARD_KIND: Partial<Record<CardId, CardKind>> = {
  power_shot: 'attack',
  overdrive: 'attack',
  adrenaline: 'attack',
  knockout: 'attack',
  charged_shot: 'attack',
  bank_shot: 'attack',
  bat_bite: 'attack',
  spotlight_tag: 'attack',
  split_shot: 'attack',
  rebound_disc: 'attack',
  prop_drop: 'attack',
  high_stakes: 'attack',
  second_take: 'attack',
  smoke: 'control',
  shock: 'control',
  system_overload: 'control',
  pulse_push: 'control',
  gravity_net: 'control',
  pressure_mine: 'control',
  stage_barrier: 'control',
  cable_snare: 'control',
  freeze_frame: 'control',
  dash: 'defense',
  shield: 'defense',
  false_start: 'defense',
  holo_decoy: 'defense',
  frame_catch: 'defense',
  backtrack: 'defense',
};

/**
 * The defender's AI skill: movement, aim and dodging exactly like the player's own fighter (PILOT in balance.ts —
 * symmetry), card decisions at a human cadence like a «pro» rival; no hidden bonuses (HP, damage, energy, telegraphs 1).
 */
export const LEAGUE_AI = {
  reactMin: 0.3,
  reactMax: 0.5,
  decideMin: 0.5,
  decideMax: 0.9,
  cardSmarts: 0.75,
};

// ------------------------------------------------------------------------- ranks
export interface RankDef {
  id: string;
  ru: string;
  en: string;
  /** RP where the rank begins. */
  base: number;
  /** Accent colour of the emblem (the game's palette). */
  color: string;
}

export const RANKS: RankDef[] = [
  { id: 'casting', ru: 'КАСТИНГ', en: 'CASTING', base: 0, color: '#8f9bb3' },
  { id: 'first_take', ru: 'ПЕРВЫЙ ДУБЛЬ', en: 'FIRST TAKE', base: 300, color: '#5ec8ff' },
  { id: 'night_air', ru: 'НОЧНОЙ ЭФИР', en: 'LATE NIGHT', base: 700, color: '#7d6bff' },
  { id: 'contender', ru: 'ПРЕТЕНДЕНТ PRIME', en: 'PRIME CONTENDER', base: 1200, color: '#c86bff' },
  { id: 'headliner', ru: 'ХЕДЛАЙНЕР', en: 'HEADLINER', base: 1800, color: '#ff5fa8' },
  { id: 'star', ru: 'ЗВЕЗДА ЭФИРА', en: 'ON-AIR STAR', base: 2500, color: '#ff8a4c' },
  { id: 'icon', ru: 'ИКОНА PRIME', en: 'PRIME ICON', base: 3300, color: '#ffd166' },
  { id: 'legend', ru: 'ЛЕГЕНДА ЭФИРА', en: 'BROADCAST LEGEND', base: 4200, color: '#ffe9a8' },
];

export const DIVISIONS = ['III', 'II', 'I'] as const;

/**
 * The only league numbers the FIGHT itself reads (src/league/replay.ts). Kept apart from LEAGUE so that balance changes
 * (RP, seasons, tokens) never change the fight bundle and its SIM_VERSION — only a change of the fight does.
 */
const FIGHT_FANS = 500;
const FIGHT_MAX_INPUTS = 400;
export const LEAGUE_FIGHT = { fans: FIGHT_FANS, maxInputs: FIGHT_MAX_INPUTS } as const;

export const LEAGUE = {
  /** Hidden skill estimate (matchmaking). */
  mmr: { start: 1000, k: 24, kCalibration: 48, calibrationGames: 10 },
  rp: {
    /** RP for a win against an equal (and lost for a loss) before the catch-up factor. */
    base: 20,
    winMin: 6,
    winMax: 45,
    lossMin: 4,
    lossMax: 40,
    /** RP this MMR «belongs» at: (mmr − 700) × 3 → MMR 800 ≈ 300, 1000 ≈ 900, 1200 ≈ 1500 RP. Faster toward it, slower away. */
    targetFrom: 700,
    targetScale: 3,
    catchUpSpan: 500,
    catchUpMin: 0.6,
    catchUpMax: 1.8,
    /** The first games lose half (a beginner learns without a free fall). Variant C chosen for STAGING (30.10.2026): 25. */
    newcomerGames: 25,
    newcomerLossFactor: 0.5,
  },
  /** PRIME CHALLENGE: needed to enter major rank index ≥ `from`; 3 wins before 2 losses. */
  challenge: { from: 2, wins: 3, losses: 2, failDrop: 60 },
  /**
   * PRIME NETWORK participants (system defenders when no fitting player is there): labelled as such, never in the
   * players' table. Below rank index `rankedBelow` they count at `rpFactor`; from it on they are training only.
   */
  system: { rpFactor: 0.5, rankedBelow: 3 },
  matchmaking: {
    window: [150, 300, 500],
    /** Ranked fights against the same defender's owner per attacker in 24 h. */
    pairPerDay: 3,
    recentAvoid: 3,
  },
  match: {
    /** A started fight is resolved by the server after this many minutes (with what the player sent). */
    ttlMinutes: 15,
    /** The game sends its taps at least this often (seconds) so a lost connection loses nothing. */
    checkpointSeconds: 10,
    /** A finish is refused earlier than the fight could last in real time minus this slack (seconds). */
    realTimeSlack: 8,
    /** Taps per fight at most (energy allows far fewer). */
    maxInputs: FIGHT_MAX_INPUTS,
    /** Starts per account per hour. */
    startsPerHour: 40,
  },
  /** Permanent sets the server picks from (seasonal sets stay out). */
  arenas: ['original', 'casino', 'backlot', 'graveyard'],
  /** League fights are of the standard length. */
  fans: FIGHT_FANS,
  /** PRIME TOKENS (PRIME_LEAGUE_TOKENS=on). Never roubles, never PRIME SHOP. */
  tokens: { win: 6, draw: 2, loss: 1, attackPerDay: 60, defenseWin: 3, defensePerDay: 15, challengeWin: 40 },
  /** Air points (season progress, not a currency). */
  air: { win: 10, draw: 6, loss: 4, defenseWin: 2, defensePerDay: 20, challengeWin: 25, rushWin: 6, squadWin: 30 },
  season: {
    /**
     * A SUGGESTED start for the model and the tests only. A real server takes the start from PRIME_LEAGUE_SEASON_START
     * (YYYY-MM-DD, 00:00 Moscow time) and without it stays in the pre-season (season 0: RP counts, nothing rolls over) —
     * so a late launch never starts season 1 in the past.
     */
    epoch: '2026-11-01T21:00:00Z',
    lengthDays: 42,
    /** Soft reset at a new season: RP × this, MMR halfway back to the start (× 0.75 of the distance). */
    rpCarry: 0.6,
    mmrCarry: 0.75,
  },
  /** Season track: air points → reward (tokens; titles are league-only, shown in the league). */
  track: [
    { at: 40, tokens: 20 },
    { at: 100, tokens: 30 },
    { at: 180, title: 'ON AIR' },
    { at: 280, tokens: 40 },
    { at: 400, tokens: 50 },
    { at: 540, title: 'ГОЛОС ЭФИРА' },
    { at: 700, tokens: 60 },
    { at: 880, tokens: 80 },
    { at: 1080, title: 'ПРАЙМ-ТАЙМ' },
    { at: 1300, emblem: true },
  ] as { at: number; tokens?: number; title?: string; emblem?: boolean }[],
  /** Fighter levels for PRIME TOKENS (PRIME_LEAGUE_UPGRADES=on; off = every fighter fights at level 0). */
  upgrades: { maxLevel: 10, hpPerLevel: 0.006, dmgPerLevel: 0.006, costBase: 20, maxGap: 3, capByRank: [2, 3, 4, 5, 6, 8, 10, 10] },
  rush: { length: 5, lives: 2, rpFactor: 0 },
  squad: { size: 3, toWin: 2, rpFactor: 1.2 },
  /** Defense Studio. */
  defense: { slots: 5 },
} as const;

/**
 * PRIME NETWORK participants: the network's own studio line-ups (real fighters, their standard decks, a tactic). They
 * defend when no fitting player's defence is there — always labelled «Участник PRIME NETWORK», never in the players'
 * table, RP from them limited (LEAGUE.system). Their strength for RP is the attacker's own MMR (an even match).
 */
export interface SystemDefender {
  id: string;
  name: string;
  nameEn: string;
  fighter: 'ray' | 'bruno' | 'nika' | 'vega' | 'kai' | 'rina';
  deck: CardId[];
  tactic: TacticId;
}

export const SYSTEM_ROSTER: SystemDefender[] = [
  { id: 'net_alpha', name: 'СТУДИЯ «АЛЬФА»', nameEn: 'STUDIO ALPHA', fighter: 'ray', deck: ['dash', 'power_shot', 'shield', 'adrenaline'], tactic: 'balance' },
  { id: 'net_neon', name: 'НЕОН-ЛАБ', nameEn: 'NEON LAB', fighter: 'nika', deck: ['shock', 'power_shot', 'smoke', 'system_overload'], tactic: 'counter' },
  { id: 'net_iron', name: 'ЖЕЛЕЗНЫЙ ЭФИР', nameEn: 'IRON AIR', fighter: 'bruno', deck: ['shield', 'power_shot', 'overdrive', 'knockout'], tactic: 'fortress' },
  { id: 'net_frame', name: 'ТОЧНЫЙ КАДР', nameEn: 'PERFECT FRAME', fighter: 'vega', deck: ['dash', 'shield', 'overdrive', 'charged_shot'], tactic: 'assault' },
  { id: 'net_bounce', name: 'РИКОШЕТ-ТВ', nameEn: 'RICOCHET TV', fighter: 'kai', deck: ['dash', 'shield', 'overdrive', 'bank_shot'], tactic: 'combo' },
  { id: 'net_feint', name: 'ФАЛЬСТАРТ', nameEn: 'FALSE START', fighter: 'rina', deck: ['dash', 'shield', 'overdrive', 'false_start'], tactic: 'adapt' },
];
