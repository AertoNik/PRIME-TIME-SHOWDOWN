// Alpha 1.9.1 — DEVELOPER PREVIEW of PRIME LEAGUE screens (dev builds only: main.ts imports it behind
// `import.meta.env.DEV`, so it never reaches the published game). Open the dev server with
//   ?preview=league&pstate=data|empty|new|guest|preseason
// and the league screens draw made-up but realistic data — no server, no account, no sign-in. Actions answer
// locally (a fight cannot start: the server is the only judge of a fight).
import { PRODUCER_AVATARS, PRODUCER_BACKDROPS, PRODUCER_FRAMES, type ProducerLook } from '../config/producer.config';
import { DIVISIONS, LEAGUE, RANKS } from '../config/league.config';
import type { CardId, FighterId } from '../config/types';
import type { Game } from '../game/Game';
import type { LeagueBoard, LeagueHistory, LeagueMatch, LeagueMe, LeagueRank, LeagueSlot } from '../net/LeagueApi';
import { PrimeApiError } from '../net/PrimeApi';
import { leagueArenaCatalog, leagueArenasAt } from '../meta/LeagueArenas';

type State = 'data' | 'empty' | 'new' | 'guest' | 'preseason';
const DAY = 86400000;

function rankOf(rp: number): LeagueRank {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (rp >= RANKS[k].base) i = k;
  const r = RANKS[i];
  const next = RANKS[i + 1]?.base ?? null;
  let division: LeagueRank['division'] = null;
  let divBase = r.base;
  let divNext = next;
  if (next !== null) {
    const step = (next - r.base) / 3;
    const d = Math.min(2, Math.floor((rp - r.base) / step));
    division = DIVISIONS[d];
    divBase = Math.round(r.base + step * d);
    divNext = d < 2 ? Math.round(r.base + step * (d + 1)) : next;
  }
  const progress = divNext === null ? 1 : (rp - divBase) / Math.max(1, divNext - divBase);
  return { index: i, id: r.id, ru: r.ru, en: r.en, color: r.color, division, base: r.base, next, divBase, divNext, progress } as LeagueRank;
}
const look = (i: number): ProducerLook => ({ avatar: PRODUCER_AVATARS[i % PRODUCER_AVATARS.length].id, frame: PRODUCER_FRAMES[i % PRODUCER_FRAMES.length].id, backdrop: PRODUCER_BACKDROPS[(i + 1) % PRODUCER_BACKDROPS.length].id });
const side = (fighter: FighterId, deck: CardId[]) => ({ fighter, deck, tactic: 'balance', look: null, level: 0 }) as unknown as LeagueMatch['attacker'];

function fixtures(state: State, now: number) {
  const empty = state === 'empty' || state === 'new';
  const rp = empty ? 0 : 412;
  const season = state === 'preseason' ? { number: 0, start: 0, end: now + 2.4 * DAY, now } : { number: 1, start: now - 6 * DAY, end: now + 36 * DAY, now, length: 42 };
  const defense: LeagueSlot[] = empty
    ? []
    : [
        { slot: 1, fighter: 'ray', deck: ['dash', 'power_shot', 'shield', 'adrenaline'], tactic: 'assault', look: null, enabled: true, version: 3, wins: 4, losses: 2, draws: 0, level: 0, problem: null },
        { slot: 2, fighter: 'nika', deck: ['shock', 'power_shot', 'smoke', 'system_overload'], tactic: 'counter', look: null, enabled: true, version: 1, wins: 1, losses: 3, draws: 1, level: 0, problem: null },
      ];
  const tiers = LEAGUE.track.map((t, i) => ({ tier: i + 1, at: t.at, tokens: t.tokens ?? 0, title: t.title ?? null, emblem: !!t.emblem }));
  const air = empty ? 0 : 214;
  const me: LeagueMe = {
    joined: state !== 'new',
    flags: { league: true, tokens: true, upgrades: false, rules: 1, sim: 'preview' },
    season,
    rules: 1,
    rulesAccepted: state === 'new' ? 0 : 1,
    rp,
    rank: rankOf(rp),
    floor: empty ? 0 : 300,
    peak: rp,
    games: empty ? 0 : 23,
    wins: empty ? 0 : 15,
    losses: empty ? 0 : 7,
    draws: empty ? 0 : 1,
    air,
    tokens: empty ? 0 : 136,
    challenge: null,
    defenseOn: true,
    // 1.9.3: the sets a 1.9.3 server would open now (the same catalogue and rule as lib/league.js arenasAt)
    arenas: leagueArenasAt(leagueArenaCatalog(), now),
    arenaUntil: Object.fromEntries(leagueArenaCatalog().flatMap((a) => (a.windows ?? []).filter((w) => now >= Date.parse(w.from) && now < Date.parse(w.until)).map((w) => [a.id, Date.parse(w.until)]))),
    stats: {},
    place: empty ? null : 3,
    track: { tiers, claimed: empty ? [] : [1, 2] },
    upgrades: {},
    report: { since: now - DAY, matches: empty ? 0 : 3, wins: empty ? 0 : 2, losses: empty ? 0 : 1, draws: 0, tokens: empty ? 0 : 6, byFighter: {}, byTactic: {} },
    ceremony: null,
    active: null,
    series: [],
    calibration: empty ? 10 : 0,
    defense,
    decks: {},
  };
  const names = ['NeonVortex', 'Worker1', 'LunaCast', 'KaiFanClub', 'MrShowtime', 'PixelDiva', 'StudioNine', 'RetroWave'];
  const board: LeagueBoard = {
    season: { number: season.number, start: season.start, end: season.end },
    page: 0,
    total: empty ? 0 : names.length,
    rows: empty
      ? []
      : names.map((name, i) => {
          const r = [1240, 860, 412, 398, 311, 260, 120, 40][i];
          const k = rankOf(r);
          return { place: i + 1, name, rp: r, rank: { ru: k.ru, en: k.en, division: k.division, color: k.color, index: k.index }, games: 40 - i * 4, wins: 28 - i * 3, me: i === 2, look: look(i * 3 + 1) };
        }),
  };
  const fighters: FighterId[] = ['ray', 'bruno', 'vega', 'kai', 'rina'];
  const attacks: LeagueMatch[] = empty
    ? []
    : fighters.map((f, i) => {
        const outcome = (['win', 'win', 'loss', 'win', 'draw'] as const)[i];
        const system = i === 3;
        return {
          id: 'pv' + i,
          mode: i === 4 ? 'rush' : 'duel',
          series: null,
          round: 0,
          status: 'done',
          ranked: i !== 4,
          season: 1,
          sim: 'preview',
          seed: i,
          arena: 'original',
          started: now - (i + 1) * 3600000,
          expires: now,
          attacker: side(f, ['dash', 'power_shot', 'shield', 'adrenaline']),
          defender: side(fighters[(i + 2) % fighters.length], ['dash', 'shield', 'overdrive', 'charged_shot']),
          hpMult: [1, 1],
          dmgMult: [1, 1],
          opponent: system ? { kind: 'system', name: 'ЖЕЛЕЗНЫЙ ЭФИР', nameEn: 'IRON AIR' } : { kind: 'player', name: names[(i + 4) % names.length], rank: board.rows[(i + 3) % names.length]?.rank, rp: 300 + i * 40, look: look(i + 5) },
          outcome,
          method: outcome === 'draw' ? 'time' : i % 2 ? 'ko' : 'time',
          rp: i === 4 ? 0 : outcome === 'win' ? 24 - i : outcome === 'loss' ? -9 : 0,
          tokens: outcome === 'win' ? 6 : outcome === 'loss' ? 1 : 2,
          air: outcome === 'win' ? 10 : 4,
          how: 'finish',
        } as LeagueMatch;
      });
  const history: LeagueHistory = {
    attacks,
    defenses: empty
      ? []
      : [
          { id: 'pd1', finished: now - 5400000, outcome: 'win', fighter: 'ray', tactic: 'assault', attackerFighter: 'vega', tokens: 3 },
          { id: 'pd2', finished: now - 9000000, outcome: 'loss', fighter: 'nika', tactic: 'counter', attackerFighter: 'kai', tokens: 0 },
        ],
    seasons: empty ? [] : [{ season: 0, rp: 318, peak: 340, rank: 'first_take', games: 12, wins: 7 }],
  };
  return { me, board, history };
}

/** Puts the preview data behind the league runtime of this page (dev builds only). */
export function installLeaguePreview(g: Game): void {
  const q = new URLSearchParams(location.search);
  if (q.get('preview') !== 'league') return;
  const state = (q.get('pstate') ?? 'data') as State;
  const f = fixtures(state, Date.now());
  const lg = g.league as unknown as Record<string, unknown>;
  const emit = () => (g.league as unknown as { setMe(m: LeagueMe): void }).setMe(f.me);
  const wait = <T>(v: T, ms = 220) => new Promise<T>((r) => setTimeout(() => r(v), ms));
  lg.access = () => (state === 'guest' ? 'guest' : 'ready');
  lg.outdated = () => false;
  lg.refresh = async () => {
    await wait(null);
    emit();
    return f.me;
  };
  const noFight = () => Promise.reject(new PrimeApiError('invalid', 'preview_only', 400));
  const api = {
    me: () => wait(f.me),
    join: () => {
      f.me.joined = true;
      f.me.rulesAccepted = 1;
      return wait(f.me);
    },
    saveDefense: (slots: LeagueSlot[]) => {
      f.me.defense = slots.map((s) => ({ ...s, look: s.look ?? null, version: 1, wins: 0, losses: 0, draws: 0, level: 0, problem: null }));
      return wait({ ok: true, defense: f.me.defense });
    },
    toggleDefense: (on: boolean) => {
      f.me.defenseOn = on;
      return wait({ ok: true, defenseOn: on }, 500);
    },
    seen: () => {
      f.me.report = { ...f.me.report, matches: 0, wins: 0, losses: 0, draws: 0, tokens: 0 };
      return wait({ ok: true });
    },
    saveDeck: (fighter: FighterId, deck: CardId[]) => {
      f.me.decks = { ...f.me.decks, [fighter]: deck };
      return wait({ ok: true });
    },
    board: () => wait(f.board, 400),
    history: () => wait(f.history, 400),
    claim: (tier: number) => {
      f.me.track.claimed = [...f.me.track.claimed, tier];
      return wait({ ok: true, tokens: f.me.track.tiers[tier - 1]?.tokens ?? 0 });
    },
    start: noFight,
    match: noFight,
    checkpoint: noFight,
    finish: noFight,
    seriesStart: noFight,
    seriesNext: noFight,
    seriesAbandon: () => wait({ series: null }),
  };
  lg.api = () => api;
  emit();
  console.info(`[PRIME LEAGUE preview] state «${state}» — made-up data, no server`);
}
