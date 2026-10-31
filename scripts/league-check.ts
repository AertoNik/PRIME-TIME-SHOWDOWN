// Alpha 1.9.0 — `npm run league`: PRIME LEAGUE.
//
//   1. the rules (pure): generated files up to date, ranks / RP / MMR / CHALLENGE / season reset;
//   2. the fight: league mode is symmetric, tactics change only card choice, looks change nothing, a fight replays
//      bit-exactly from its taps through the very server bundle (lib/league_sim.js);
//   3. a REAL PocketBase with a temporary database (deleted at the end; backend/pb_data and every real server are never
//      touched; «now» from a test clock file, PRIME_SERVER_ROLE=dev only): joining, Defense Studio, matchmaking, the
//      server's replay (a client cannot send a result), forged and rewritten taps, two finishes at once, one active
//      match, expiry, changed rules, defence rewards and caps, PRIME CHALLENGE, a season change, the season track,
//      PRIME SQUAD and PRIME RUSH, upgrades behind their flag, the league switched off;
//   4. Alpha 1.9.3 (same server): the set chosen before the start in every mode (RANDOM, forged ids, fixed per series,
//      the replay on it), one start per tap, «Убрать» in the Defense Studio (base, two devices, frozen matches) and a
//      paid skin seen by another player (two synthetic accounts: its owner and a rival), revoked → the fighter's own look.
//
// All accounts here are test data on 127.0.0.1. Taps are made by the headless bot of scripts/bots.ts.

import PocketBase from 'pocketbase';
import { Match } from '../src/combat/Match';
import type { LeagueSide } from '../src/combat/league';
import { CARD_KIND, LEAGUE, RANKS, TACTICS, TACTIC_ORDER, type TacticId } from '../src/config/league.config';
import { FIGHTERS } from '../src/config/fighters';
import type { CardId, FighterId } from '../src/config/types';
import { defaultSave } from '../src/meta/SaveSystem';
import { canonicalJSON } from '../src/net/cloudSave';
import { leagueConfig, replayLeague, type LeagueInput, type LeagueSnapshot } from '../src/league/replay';
import { SIM_VERSION } from '../src/league/simVersion';
import { leagueRulesSource, leagueSim, producerRulesSource, simVersionSource } from './backend';
import { PRODUCER_AVATARS, PRODUCER_BACKDROPS, PRODUCER_FRAMES, defaultLook } from '../src/config/producer.config';
import { producerSVG } from '../src/ui/producerArt';
import { comboBot, type BotState } from './bots';
import { availableArenas } from '../src/meta/ArenaSelection';
import { EventManager } from '../src/meta/EventManager';
import { leagueArenaCatalog, leagueArenasAt } from '../src/meta/LeagueArenas';
import { EVENTS } from '../src/config/events.config';
import { ARENAS, ARENA_ORDER } from '../src/config/arenas.config';
import type { SaveSystem } from '../src/meta/SaveSystem';
import { LEAGUE_ARENAS, leagueLook } from '../src/game/LeagueRuntime';
import { defenseBase, type LeagueSlot } from '../src/net/LeagueApi';
import { LEGACY_CHECK_ENV, MIGRATIONS, PB_BIN, ROOT, binariesReady, dbFingerprint, ensurePortsFree, ownServerStarted, registrationExtras, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { cp, crypto, fs, nodeModule, os, path, proc, sleep } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
function section(t: string): void {
  console.log(`\n— ${t}`);
}

const req = nodeModule.createRequire(path.join(ROOT, 'backend', 'pb_hooks', 'lib', 'x.js'));
const LM = req('./league_math.js');
const SIM = req('./league_sim.js');
// 1.9.3: the server's own set rules (pure functions of lib/league.js: no PocketBase needed for them)
const LS = req('./league.js');

// ---------------------------------------------------------------- the player's taps
/** Plays the snapshot with the deliberate bot (reaction `react`), returns its taps. */
function botTaps(s: LeagueSnapshot, react = 0.38, giveUpAt = -1): LeagueInput[] {
  const m = new Match(leagueConfig(s));
  const taps: LeagueInput[] = [];
  const orig = m.playCard.bind(m);
  m.playCard = (side, i) => {
    if (side === 0) taps.push([m.steps, i]);
    return orig(side, i);
  };
  const st: BotState = { think: 0, react: -1, reactKey: '' };
  while (m.phase !== 'over' && m.steps < 60 * 90) {
    if (giveUpAt >= 0 && m.steps === giveUpAt) {
      taps.push([m.steps, -1]);
      break;
    }
    comboBot(m, st, 1 / 60, react);
    m.step(1 / 60);
    m.drainEvents();
  }
  return taps;
}

/** Taps that win this snapshot (a short search over the bot's reaction time), or null. */
function winningTaps(s: LeagueSnapshot): LeagueInput[] | null {
  for (let i = 0; i < 24; i++) {
    const taps = botTaps(s, 0.2 + i * 0.03);
    if (replayLeague(s, taps).outcome === 'win') return taps;
  }
  return null;
}

// =============================================================== 1. rules (pure)
function rulesChecks(): void {
  section('Правила: файлы сервера, ранги, RP, MMR, вызов, сезон');
  check('league_rules.js is generated from league.config.ts and up to date (npm run backend:rules)', fs.readFileSync(path.join(ROOT, 'backend/pb_hooks/lib/league_rules.js'), 'utf8') === leagueRulesSource());
  check('league_sim.js (the fight the server replays) is built from today\'s src/combat and up to date', fs.readFileSync(path.join(ROOT, 'backend/pb_hooks/lib/league_sim.js'), 'utf8') === leagueSim().code);
  check(`the game and the server carry the same SIM_VERSION (${SIM_VERSION})`, SIM.SIM_VERSION === SIM_VERSION && fs.readFileSync(path.join(ROOT, 'src/league/simVersion.ts'), 'utf8') === simVersionSource());
  check('1.9.3: the fight rules are those of 1.9.0 — SIM_VERSION 76236bbb2e281ec4 unchanged (the set choice lives outside the fight code)', SIM_VERSION === '76236bbb2e281ec4');
  const LR = req('./league_rules.js');
  check('1.9.3: the permanent sets are the four of 1.9.0, CURSED CEMETERY included all year', JSON.stringify(LR.arenas) === JSON.stringify(['original', 'casino', 'backlot', 'graveyard']) && JSON.stringify(LEAGUE_ARENAS) === JSON.stringify(LR.arenas) && availableArenas('none').includes('graveyard'));
  const cat = leagueArenaCatalog();
  const hw = cat.find((a) => a.id === 'haunted');
  check('1.9.3: the seasonal sets come from the game\'s own catalogue and calendar (no second list): HAUNTED with the dated Halloween events; a theme without a dated event (WINTER GALA preview) opens nothing', JSON.stringify(LR.arenaCatalog) === JSON.stringify(cat) && !!hw && hw.windows!.every((w) => EVENTS.some((e) => e.id === w.event && e.themeId === 'halloween' && e.start === w.from && e.end === w.until)) && cat.filter((a) => a.windows).every((a) => a.windows!.length > 0) && cat.length === 5, JSON.stringify(cat));
  // the game's own calendar (EventManager, auto mode) at the same moments as the server's rule
  const clientSets = (t: number) => {
    const em = new EventManager({ data: defaultSave(), save() {} } as unknown as SaveSystem, { clock: () => t, settings: { mode: 'auto', forcedEventId: 'none' } });
    return availableArenas(em.themeId).filter((id) => cat.some((a) => a.id === id));
  };
  const moments = ['2026-10-19T23:59:59.999Z', '2026-10-20T00:00:00Z', '2026-10-31T12:00:00Z', '2026-11-03T23:59:59.999Z', '2026-11-04T00:00:00Z', '2026-12-31T23:00:00Z', new Date().toISOString()];
  const parity = moments.map((m) => {
    const t = Date.parse(m);
    const sv = LS.arenasAt(t).join();
    return { m, ok: sv === leagueArenasAt(cat, t).join() && sv === clientSets(t).join(), sv };
  });
  check(`1.9.3: the server, the game's set list and the game's event calendar agree at ${moments.length} moments (window edges included): ${parity.map((x) => `${x.m.slice(5, 16)}→${x.sv.includes('haunted') ? '+HAUNTED' : '4'}`).join(' ')}`, parity.every((x) => x.ok), JSON.stringify(parity.filter((x) => !x.ok)));
  const T = (d: string) => Date.parse(d);
  // a FUTURE season (no code change): a made-up New Year set + a dated winter event — the catalogue picks it up, the
  // server's rule opens it inside the event only, exactly as the game's; the permanent sets stay as they are
  {
    const winterSet = { ...ARENAS.casino, id: 'newyear_gala' as any, name: 'NEW YEAR GALA SET', availability: { kind: 'seasonal' as const, themeId: 'winter' as const, event: 'New Year Gala' } };
    const nyEvent = { ...EVENTS[1], id: 'newyear-2027', start: '2026-12-25T00:00:00Z', end: '2027-01-10T00:00:00Z' };
    const fut = leagueArenaCatalog({ ...ARENAS, newyear_gala: winterSet } as any, [...ARENA_ORDER, 'newyear_gala'], [...EVENTS, nyEvent]);
    const at = (d: string) => LS.arenasIn(fut, T(d)).join();
    check('1.9.3: a future seasonal set (made-up NEW YEAR GALA + a dated winter event) needs no league code: catalogued from the set and the calendar, open only inside its event, the same rule on both sides', at('2026-12-24T23:59:59Z') === 'original,casino,backlot,graveyard' && at('2026-12-31T12:00:00Z') === 'original,casino,backlot,graveyard,newyear_gala' && at('2027-01-10T00:00:00Z') === 'original,casino,backlot,graveyard' && ['2026-10-25T00:00:00Z', '2026-12-31T12:00:00Z'].every((d) => LS.arenasIn(fut, T(d)).join() === leagueArenasAt(fut, T(d)).join()), at('2026-12-31T12:00:00Z'));
  }
  check('1.9.3: HAUNTED is a choice only inside its event (before / after → «closed», 409 arena_unavailable); forged ids stay RANDOM', LS.arenaChoice('haunted', T('2026-10-25T00:00:00Z')) === 'haunted' && LS.arenaChoice('haunted', T('2026-11-04T00:00:00Z')) === null && LS.arenaChoice('haunted', T('2026-10-19T00:00:00Z')) === null && LS.arenaChoice('moon', T('2026-10-25T00:00:00Z')) === 'random' && LS.arenaChoice('graveyard', T('2027-03-01T00:00:00Z')) === 'graveyard');
  check('8 major ranks in rising order, III → II → I inside each, the last without divisions', RANKS.length === 8 && RANKS.every((r, i) => i === 0 || r.base > RANKS[i - 1].base) && LM.rankOf(0).division === 'III' && LM.rankOf(299).division === 'I' && LM.rankOf(4200).division === null);
  const p = { rp: LM.targetRp(1000), mmr: 1000, games: 40, floor: 300 };
  check('equal opponents at the RP the skill belongs at: a win +20, a loss −20 (no drift from the number of matches)', LM.rpDelta(p, 1000, 'win') === 20 && LM.rpDelta(p, 1000, 'loss') === -20);
  check('beating a stronger opponent gives more, losing to one costs less', LM.rpDelta(p, 1200, 'win') > 20 && -LM.rpDelta(p, 1200, 'loss') < 20);
  check('a beginner (variant C: the first 25 games) loses half — game 24 too, game 25 the full amount', LEAGUE.rp.newcomerGames === 25 && -LM.rpDelta({ ...p, games: 24 }, 1000, 'loss') === 10 && -LM.rpDelta({ ...p, games: 25 }, 1000, 'loss') === 20);
  check('producer_rules.js is generated from producer.config.ts and up to date; 14 avatars, 4 frames, 4 backdrops, all free', fs.readFileSync(path.join(ROOT, 'backend/pb_hooks/lib/producer_rules.js'), 'utf8') === producerRulesSource() && PRODUCER_AVATARS.length >= 12 && PRODUCER_FRAMES.length >= 4 && PRODUCER_BACKDROPS.length >= 4 && [...PRODUCER_AVATARS, ...PRODUCER_FRAMES, ...PRODUCER_BACKDROPS].every((x) => x.access === 'free'));
  const svgs = PRODUCER_AVATARS.map((a) => producerSVG({ avatar: a.id, frame: 'studio', backdrop: 'violet' }, 48));
  check('every avatar is its own drawing (14 different SVGs), vector only — no external image, URL or script', new Set(svgs.map((x) => x.replace(/id="[^"]+"|url\(#[^)]+\)/g, ''))).size === PRODUCER_AVATARS.length && svgs.every((x) => !/<image|href=|https?:|<script/i.test(x)));
  check('RP below the skill climbs faster, above it slower', LM.rpDelta({ ...p, rp: 100 }, 1000, 'win') > LM.rpDelta({ ...p, rp: 1600 }, 1000, 'win'));
  check('the floor: once reached, a major rank is never lost to RP in the season', LM.applyRp(310, 300, -40).rp === 300);
  const a = LM.applyRp(690, 300, 30);
  check('reaching a rank that needs PRIME CHALLENGE: RP waits one below (699) and the challenge opens', a.rp === 699 && a.challengeReady && a.promoted === null);
  check('the first two ranks need no challenge (ПЕРВЫЙ ДУБЛЬ straight from КАСТИНГ)', LM.applyRp(290, 0, 30).promoted === 1);
  check('CHALLENGE: 3 wins before 2 losses', LM.challengeStep({ to: 2, wins: 2, losses: 1 }, 'win').state === 'passed' && LM.challengeStep({ to: 2, wins: 2, losses: 1 }, 'loss').state === 'failed' && LM.challengeStep({ to: 2, wins: 1, losses: 0 }, 'win').state === 'open');
  const sr = LM.softReset(2600, 1300);
  check('a new season: RP × 0.6 keeps the rank it lands in, MMR moves a quarter back to the start', sr.rp === 1560 && sr.floor === 1200 && sr.mmr === 1225);
  const e1 = Date.parse(LEAGUE.season.epoch);
  check('seasons by the server clock: season 1 starts Monday 2 Nov 2026 00:00 MSK and lasts 42 days; before it — 0', LM.seasonOf(e1 - 1) === 0 && LM.seasonOf(e1) === 1 && LM.seasonOf(e1 + 42 * 86400000 - 1) === 1 && LM.seasonOf(e1 + 42 * 86400000) === 2);
  check('upgrades off: every level fights at ×1', LM.levelMult(10, false).hp === 1 && LM.levelMult(10, true).hp === 1.06);
  check('every league card has a kind; DIRECTOR\'S CUT (the boss\'s) is not a league card', !('directors_cut' in CARD_KIND) && Object.keys(CARD_KIND).length === 28);
}

// =============================================================== 2. the fight
const snapOf = (seed: number, a: LeagueSide, d: LeagueSide, arena: any = 'original'): LeagueSnapshot => ({ seed, arena, attacker: a, defender: d, hpMult: [1, 1], dmgMult: [1, 1] });

function fightChecks(): void {
  section('Бой лиги: симметрия, тактики, облик, доказательство');
  // symmetry: RAY against RAY, neither side plays a card (the defender's energy is zero) — only the fighters
  let wins = 0;
  let losses = 0;
  for (let i = 0; i < 40; i++) {
    const cfg = leagueConfig(snapOf(1000 + i * 977, { fighter: 'ray', deck: FIGHTERS.ray.defaultDeck }, { fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, tactic: 'balance' }));
    cfg.mods = { rivalEnergyMult: 0 };
    const m = new Match(cfg);
    while (m.phase !== 'over' && m.steps < 6000) m.step(1 / 60);
    if (m.result!.outcome === 'win') wins++;
    else if (m.result!.outcome === 'loss') losses++;
  }
  check(`mirror RAY–RAY without cards is even: ${wins} wins / ${losses} losses of 40 (no hidden side bonus)`, wins >= 12 && losses >= 12);
  const m0 = new Match(leagueConfig(snapOf(7, { fighter: 'bruno', deck: FIGHTERS.bruno.defaultDeck }, { fighter: 'nika', deck: FIGHTERS.nika.defaultDeck, tactic: 'counter' })));
  check('the defender is the real fighter with its standard stats, the saved deck, no difficulty bonus', m0.fighters[1].maxHp === FIGHTERS.nika.stats.maxHp && m0.hands[1].hand.concat(m0.hands[1].queue).join() === FIGHTERS.nika.defaultDeck.join() && m0.difficulty.hpMult === 1 && m0.difficulty.dmgMult === 1 && m0.difficulty.telegraphMult === 1);
  check('the attacker is its standard fighter too (HP, damage ×1 while upgrades are off)', m0.fighters[0].maxHp === FIGHTERS.bruno.stats.maxHp);

  // tactics: card kinds the defender plays over 30 fights each against the same deliberate attacker
  const share: Record<string, { attack: number; control: number; defense: number; cards: number; combos: number }> = {};
  for (const t of TACTIC_ORDER) {
    const c = { attack: 0, control: 0, defense: 0, cards: 0, combos: 0 };
    for (let i = 0; i < 30; i++) {
      const s = snapOf(5000 + i * 131, { fighter: 'ray', deck: FIGHTERS.ray.defaultDeck }, { fighter: 'kai', deck: ['dash', 'shield', 'power_shot', 'bank_shot'], tactic: t });
      const m = new Match(leagueConfig(s));
      const st: BotState = { think: 0, react: -1, reactKey: '' };
      while (m.phase !== 'over' && m.steps < 6000) {
        comboBot(m, st, 1 / 60);
        m.step(1 / 60);
        for (const ev of m.drainEvents()) {
          if (ev.type === 'card' && ev.side === 1) {
            c.cards++;
            c[CARD_KIND[ev.card as CardId] ?? 'attack']++;
          }
          if (ev.type === 'combo' && ev.side === 1) c.combos++;
        }
      }
    }
    share[t] = c;
  }
  const atk = (t: string) => share[t].attack / Math.max(1, share[t].cards);
  const dfn = (t: string) => share[t].defense / Math.max(1, share[t].cards);
  console.log('      tactic    cards  attack%  defense%  combos  — ' + TACTIC_ORDER.map((t) => `${t}:${share[t].cards}/${Math.round(atk(t) * 100)}%/${Math.round(dfn(t) * 100)}%/${share[t].combos}`).join('  '));
  check('PRIME ASSAULT plays a larger share of attack cards than PRIME FORTRESS', atk('assault') > atk('fortress'));
  check('PRIME FORTRESS plays a larger share of defence cards than PRIME ASSAULT', dfn('fortress') > dfn('assault'));
  check('PRIME COMBO builds more combos than PRIME ASSAULT', share.combo.combos > share.assault.combos);
  check('all six tactics exist with Russian and English names', TACTIC_ORDER.length === 6 && TACTIC_ORDER.every((t) => TACTICS[t].ru && TACTICS[t].en && TACTICS[t].name.startsWith('PRIME ')));
  const s1 = snapOf(42, { fighter: 'ray', deck: FIGHTERS.ray.defaultDeck }, { fighter: 'nika', deck: FIGHTERS.nika.defaultDeck, tactic: 'assault' });
  const s2 = snapOf(42, { fighter: 'ray', deck: FIGHTERS.ray.defaultDeck }, { fighter: 'nika', deck: FIGHTERS.nika.defaultDeck, tactic: 'fortress' });
  const m1 = new Match(leagueConfig(s1));
  const m2 = new Match(leagueConfig(s2));
  check('tactics never touch movement, aim or dodging (the same AI numbers; only card fields differ)', m1.ais[1].profile.aimLead === m2.ais[1].profile.aimLead && m1.ais[1].profile.dodgeSkill === m2.ais[1].profile.dodgeSkill && m1.ais[1].profile.behavior.rangeMult === m2.ais[1].profile.behavior.rangeMult && m1.ais[1].profile.behavior.strafe === m2.ais[1].profile.behavior.strafe && m1.ais[1].profile.reactMin === m2.ais[1].profile.reactMin);
  // a paid look changes nothing in the fight
  const plain = snapOf(77, { fighter: 'ray', deck: FIGHTERS.ray.defaultDeck }, { fighter: 'bruno', deck: FIGHTERS.bruno.defaultDeck, tactic: 'balance' });
  const skinned = { ...plain, attacker: { ...plain.attacker, look: 'ray_neon_runner' }, defender: { ...plain.defender, look: 'bruno_casino_boss' } };
  const taps = botTaps(plain);
  check('a PRIME SHOP skin on either side gives exactly the same fight (looks are rendering only)', replayLeague(plain, taps).hash === replayLeague(skinned as LeagueSnapshot, taps).hash);
  // the proof: a fight replays bit-exactly from its taps through the server bundle
  let same = 0;
  for (let i = 0; i < 12; i++) {
    const f: FighterId[] = ['ray', 'bruno', 'nika', 'vega', 'kai', 'rina', 'lucien'];
    const s = snapOf(9000 + i * 7919, { fighter: f[i % 7], deck: FIGHTERS[f[i % 7]].defaultDeck }, { fighter: f[(i + 3) % 7], deck: FIGHTERS[f[(i + 3) % 7]].defaultDeck, tactic: TACTIC_ORDER[i % 6] as TacticId }, LEAGUE.arenas[i % 4] as any);
    const t = botTaps(s);
    const live = replayLeague(s, t);
    const srv = SIM.replayLeague(s, t);
    if (live.hash === srv.hash && live.outcome === srv.outcome && live.steps === srv.steps) same++;
  }
  check('12 fights (7 fighters, 4 sets, 6 tactics): the server bundle replays them exactly like the game', same === 12);
  check('a forfeit tap ends the fight as a loss', replayLeague(plain, [[300, -1]]).outcome === 'loss' && replayLeague(plain, [[300, -1]]).method === 'forfeit');
  check('impossible taps change nothing the rules would allow (a card during the intro, an empty slot)', replayLeague(plain, [[0, 0], [1, 2]]).hash === replayLeague(plain, []).hash);
  check('well-formed taps only: card −1…2, steps in order, at most ' + LEAGUE.match.maxInputs, SIM.checkInputs([[5, 0], [5, 1], [9, -1]]) === null && SIM.checkInputs([[5, 3]]) === 'bad_tap' && SIM.checkInputs([[9, 0], [5, 0]]) === 'order' && SIM.checkInputs([[1.5, 0]]) === 'bad_tap' && SIM.checkInputs(Array.from({ length: 401 }, (_, i) => [i, 0])) === 'too_many' && SIM.checkInputs({ win: true }) === 'not_list');
}

// =============================================================== 3. the server
const PORTS = { api: 19690, smtp: 11969, mailUi: 19691 };
const API = `http://127.0.0.1:${PORTS.api}`;
const PW = 'League2026pass';
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-league-check-'));
const dataDir = path.join(work, 'pb_data');
const clockFile = path.join(work, 'clock.txt');
const SEASON1 = Date.parse(LEAGUE.season.epoch) + 2 * 86400000;
let pb: any = null;
const pbLog: string[] = [];
let clock = SEASON1;
const setClock = (t: number) => {
  clock = t;
  fs.writeFileSync(clockFile, String(t));
};
const tick = (ms: number) => setClock(clock + ms);

async function startPb(extra: Record<string, string> = {}): Promise<void> {
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], args: proc.env.LEAGUE_DEV ? ['--dev'] : [], env: { PRIME_REGISTRATION: 'public', PRIME_SERVER_ROLE: 'dev', PRIME_LEAGUE: 'on', PRIME_LEAGUE_TOKENS: 'on', PRIME_LEAGUE_CLOCK_FILE: clockFile, PRIME_LEAGUE_SEASON_START: '2026-11-02', PRIME_LEAGUE_BUDGET_SCALE: '1000', ...LEGACY_CHECK_ENV, ...extra } });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 300) pbLog.splice(0, pbLog.length - 300);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-15).join('\n'));
}
async function restart(extra: Record<string, string> = {}): Promise<void> {
  await stopChild(pb);
  await sleep(300);
  await startPb(extra);
}

interface User {
  id: string;
  token: string;
  email: string;
}
async function call(u: User | null, method: string, p: string, body?: unknown): Promise<{ status: number; j: any }> {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: u.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j: any = null;
  try {
    j = await r.json();
  } catch {
    j = null;
  }
  return { status: r.status, j };
}
const op = () => 'op_' + crypto.randomBytes(9).toString('hex');

async function serverChecks(): Promise<void> {
  if (!binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  await ensurePortsFree([PORTS.api]);
  console.log(`\nВременная база: ${work}`);
  const SU = { email: 'league-admin@league.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  setClock(SEASON1);
  await startPb();
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const st = (await admin.settings.getAll()).rateLimits;
  await admin.settings.update({ rateLimits: { enabled: true, rules: st.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });

  const register = async (nick: string, email: string, verify = true): Promise<User> => {
    const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: nick, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)) }) });
    if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${await r.text()}`);
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    if (verify) await admin.collection('users').update(u.id, { verified: true });
    const c = new PocketBase(API);
    await c.collection('users').authWithPassword(email, PW);
    return { id: u.id, token: c.authStore.token, email };
  };
  /** A PRIME CLOUD save where these fighters are signed and these cards bought (as the career would have it). */
  const giveSave = async (u: User, fighters: FighterId[], cards: CardId[] = []) => {
    const s: any = defaultSave();
    for (const f of fighters) s.fighters[f].unlocked = true;
    s.cards.owned = cards;
    const text = canonicalJSON(s);
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const old = await admin.collection('saves').getFullList({ filter: `owner = "${u.id}"` });
    if (old.length) await admin.collection('saves').update(old[0].id, { data: text, hash, schema: 12 });
    else await admin.collection('saves').create({ owner: u.id, data: text, hash, schema: 12, revision: 1, client: 'test' });
  };
  const prof = async (u: User) => (await admin.collection('league_profiles').getFullList({ filter: `owner = "${u.id}"` }))[0];
  const snapFrom = (m: any): LeagueSnapshot => ({ seed: m.seed, arena: m.arena, attacker: m.attacker, defender: m.defender, hpMult: m.hpMult, dmgMult: m.dmgMult });
  /** Plays a started match to the end: advances the test clock by the fight's real length, sends the taps. */
  const play = async (u: User, m: any, taps: LeagueInput[]) => {
    const out = replayLeague(snapFrom(m), taps);
    tick(Math.ceil((out.steps / 60) * 1000) + 1000);
    const r = await call(u, 'POST', `/api/prime/league/match/${m.id}/finish`, { inputs: taps });
    return { r, out };
  };

  section('Сервер: доступ и вступление');
  const guest = await call(null, 'GET', '/api/prime/league/me');
  const cfg = await call(null, 'GET', '/api/prime/config');
  check('the server announces PRIME LEAGUE with its rules version and SIM_VERSION', cfg.j.league?.on === true && cfg.j.league?.sim === SIM_VERSION && cfg.j.league?.rules === 1);
  check('a guest has no league (401)', guest.status === 401);
  const late = await register('LateLeague', 'late@league.test', false);
  const lateMe = await call(late, 'GET', '/api/prime/league/me');
  check('an account with an unconfirmed email cannot enter (403 not_verified)', lateMe.j?.code === 'not_verified', JSON.stringify(lateMe));
  const A = await register('AttackStar', 'a@league.test');
  const B = await register('DefenseKing', 'b@league.test');
  const C = await register('ThirdShow', 'c@league.test');
  await giveSave(A, ['ray', 'bruno', 'nika', 'vega'], ['split_shot']);
  await giveSave(B, ['ray', 'bruno', 'kai', 'rina'], []);
  await giveSave(C, ['ray', 'vega'], []);
  const me0 = await call(A, 'GET', '/api/prime/league/me');
  check('before joining: the invitation (joined: false, the rules version, the season)', me0.status === 200 && me0.j.joined === false && me0.j.rules === 1 && me0.j.season.number === 1, JSON.stringify(me0).slice(0, 300));
  check('nothing is played before joining (403 league_not_joined)', (await call(A, 'POST', '/api/prime/league/match/start', { fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, sim: SIM_VERSION, op: op() })).j?.code === 'league_not_joined');
  check('joining needs the ticked box and the current rules version (an unticked or old one → 400)', (await call(A, 'POST', '/api/prime/league/join', { accept: false, rules: 1 })).status === 400 && (await call(A, 'POST', '/api/prime/league/join', { accept: true, rules: 0 })).status === 400);
  const jA = await call(A, 'POST', '/api/prime/league/join', { accept: true, rules: 1 });
  check('joined: КАСТИНГ III, 0 RP, the season, 0 tokens, defence on, the accepted version recorded', jA.j.joined && jA.j.rp === 0 && jA.j.rank.id === 'casting' && jA.j.rank.division === 'III' && jA.j.tokens === 0 && jA.j.defenseOn === true && jA.j.rulesAccepted === 1);
  await call(B, 'POST', '/api/prime/league/join', { accept: true, rules: 1 });
  await call(C, 'POST', '/api/prime/league/join', { accept: true, rules: 1 });
  const generic = await Promise.all(['league_profiles', 'league_matches', 'league_ledger', 'league_defense'].map((c) => fetch(`${API}/api/collections/${c}/records`, { headers: { Authorization: A.token } }).then((r) => r.status)));
  check('no league table is readable or writable through the generic API', generic.every((s) => s === 403 || s === 404));

  section('Alpha 1.9.3: сезонный павильон, пока идёт событие (часы сервера — Halloween Premiere)');
  // the test clock starts on 3 Nov 2026, 21:00 UTC — the last hours of Halloween Premiere (ends 4 Nov 00:00 UTC)
  const H1 = await register('HauntShow', 'h1@league.test');
  await giveSave(H1, ['ray', 'vega'], []);
  await call(H1, 'POST', '/api/prime/league/join', { accept: true, rules: 1 });
  const meH = await call(H1, 'GET', '/api/prime/league/me');
  check(`the server opens HAUNTED PRIME SET while Halloween runs (${new Date(clock).toISOString().slice(0, 16)}): 5 sets, its closing time 4 Nov 00:00 UTC`, meH.j.arenas?.join() === 'original,casino,backlot,haunted,graveyard' && meH.j.arenaUntil?.haunted === Date.parse('2026-11-04T00:00:00Z'), JSON.stringify({ a: meH.j.arenas, u: meH.j.arenaUntil }));
  const startH = (body: any = {}) => call(H1, 'POST', '/api/prime/league/match/start', { mode: 'duel', fighter: 'vega', deck: FIGHTERS.vega.defaultDeck, sim: SIM_VERSION, op: op(), ...body });
  const mh = (await startH({ arena: 'haunted' })).j.match;
  const th = botTaps(snapFrom(mh), 0.3);
  const fh = await play(H1, mh, th);
  check(`a duel on HAUNTED: the set of the match, replayed by the server bit-exactly (hash ${fh.r.j.match.result?.hash} = the game's ${fh.out.hash})`, mh.arena === 'haunted' && mh.arenaPick === 'haunted' && fh.r.j.match.result?.hash === fh.out.hash && fh.r.j.match.outcome === fh.out.outcome);
  check('no seasonal reward in the league for a seasonal set: the duel pays the league\'s own tokens / air only (no event currency in its answer)', !JSON.stringify(fh.r.j).includes('pumpkin') && !('event' in (fh.r.j.match.result ?? {})));
  const rh: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await startH();
    rh.push(r.j.match.arena);
    await call(H1, 'POST', `/api/prime/league/match/${r.j.match.id}/finish`, { inputs: [[0, -1]] });
  }
  check(`RANDOM draws among the sets open at that moment (the 5 incl. HAUNTED): ${rh.join(', ')}`, rh.every((a) => meH.j.arenas.includes(a)));
  const hr = await call(H1, 'POST', '/api/prime/league/series/start', { kind: 'rush', sim: SIM_VERSION, op: op(), lineup: [{ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck }], arena: 'haunted' });
  check('PRIME RUSH started on HAUNTED during the event (its first duel there)', hr.status === 200 && hr.j.series.arena === 'haunted' && hr.j.match.arena === 'haunted');
  await call(H1, 'POST', `/api/prime/league/match/${hr.j.match.id}/finish`, { inputs: [[0, -1]] });
  // (the run stays open — its next duel is played after the event, in the 1.9.3 section below)

  section('Сервер: Defense Studio');
  const put = (u: User, slots: any[]) => call(u, 'PUT', '/api/prime/league/defense', { slots });
  const sl = (slot: number, fighter: FighterId, tactic = 'balance', deck = FIGHTERS[fighter].defaultDeck, enabled = true, look?: string) => ({ slot, fighter, deck, tactic, enabled, look });
  check('a fighter not signed in the save → fighter_not_owned', (await put(B, [sl(1, 'nika')])).j?.code === 'fighter_not_owned');
  const NPC = ['zoe', 'crash', 'dex', 'tank', 'vale', 'league', 'ZOE', '', '__proto__'];
  const npcDef = await Promise.all(NPC.map((f) => put(B, [{ ...sl(1, 'ray'), fighter: f }])));
  check('career rivals ЗОИ / КРАШ / ДЕКС / ТАНК, the champion VALE and forged ids are no league fighters in defence → not_league_fighter', npcDef.every((r) => r.status === 400 && r.j?.code === 'not_league_fighter'), npcDef.map((r) => r.j?.code).join());
  // a save edited by hand to «sign» a rival changes nothing: only the roster of the character menu counts
  {
    const s: any = defaultSave();
    s.fighters.zoe = { ...s.fighters.ray, unlocked: true };
    s.fighters.crash = { ...s.fighters.ray, unlocked: true };
    const text = JSON.stringify(s);
    const old = await admin.collection('saves').getFullList({ filter: `owner = "${C.id}"` });
    await admin.collection('saves').update(old[0].id, { data: text, hash: crypto.createHash('sha256').update(text).digest('hex') });
    const r = await put(C, [{ ...sl(1, 'ray'), fighter: 'zoe' as FighterId, deck: ['dash', 'shield', 'power_shot', 'system_overload'] }]);
    check('a save edited to «unlock» ЗОИ and КРАШ: still refused (not_league_fighter)', r.j?.code === 'not_league_fighter');
    await giveSave(C, ['ray', 'vega'], []);
  }
  check('a card never bought, another fighter\'s signature or DIRECTOR\'S CUT → card_not_allowed', (await put(B, [sl(1, 'ray', 'balance', ['dash', 'shield', 'power_shot', 'split_shot'])])).j?.code === 'card_not_allowed' && (await put(B, [sl(1, 'ray', 'balance', ['dash', 'shield', 'power_shot', 'knockout'])])).j?.code === 'card_not_allowed' && (await put(B, [sl(1, 'ray', 'balance', ['dash', 'shield', 'power_shot', 'directors_cut'])])).j?.code === 'card_not_allowed');
  check('the same fighter twice, the same card twice, 6 slots, an unknown tactic → refused', (await put(B, [sl(1, 'ray'), sl(2, 'ray')])).j?.code === 'defense_duplicate' && (await put(B, [sl(1, 'ray', 'balance', ['dash', 'dash', 'shield', 'adrenaline'])])).j?.code === 'deck_duplicate' && (await put(B, [1, 2, 3, 4, 5, 6].map((i) => sl(i, 'ray')))).j?.code === 'defense_slots' && (await put(B, [sl(1, 'ray', 'cheat')])).j?.code === 'defense_tactic');
  check('a skin never bought → defense_look', (await put(B, [sl(1, 'ray', 'balance', FIGHTERS.ray.defaultDeck, true, 'ray_neon_runner')])).j?.code === 'defense_look');
  const d1 = await put(B, [sl(1, 'bruno', 'fortress')]);
  check('one defender saved (BRUNO, PRIME FORTRESS), version 1', d1.status === 200 && d1.j.defense.length === 1 && d1.j.defense[0].version === 1);
  const d3 = await put(B, [sl(1, 'bruno', 'fortress'), sl(2, 'kai', 'combo'), sl(3, 'rina', 'counter')]);
  check('three defenders, each with its own deck and tactic; an unchanged slot keeps its version', d3.j.defense.length === 3 && d3.j.defense[0].version === 1 && d3.j.defense[1].tactic === 'combo');
  await giveSave(B, ['ray', 'bruno', 'kai', 'rina', 'nika', 'vega'], []);
  const d5 = await put(B, [sl(1, 'bruno', 'fortress'), sl(2, 'kai', 'combo'), sl(3, 'rina', 'counter'), sl(4, 'nika', 'adapt'), sl(5, 'vega', 'assault')]);
  check('five defenders (the maximum), all six tactics allowed', d5.status === 200 && d5.j.defense.length === 5);
  await put(B, [sl(1, 'bruno', 'fortress'), sl(2, 'kai', 'combo'), sl(3, 'rina', 'counter')]);

  section('Сервер: PRIME DUEL — доказательство сервером');
  const startA = (body: any = {}) => call(A, 'POST', '/api/prime/league/match/start', { mode: 'duel', fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, sim: SIM_VERSION, op: op(), ...body });
  check('an old game (another SIM_VERSION) is asked to update — never judged by other rules', (await startA({ sim: 'old0000000000000' })).j?.code === 'update_required');
  check('the attacker\'s own deck is checked too (a card the save never bought → card_not_allowed)', (await startA({ deck: ['dash', 'shield', 'power_shot', 'gravity_net'] })).j?.code === 'card_not_allowed');
  const npcAtk = await Promise.all(['zoe', 'crash', 'dex', 'tank', 'vale'].map((f) => startA({ fighter: f })));
  check('attacking with a career rival or the champion → not_league_fighter, no match', npcAtk.every((r) => r.j?.code === 'not_league_fighter'));
  check('a league deck with a card from outside the collection → refused; the attacker\'s league deck is saved on the server', (await call(A, 'PUT', '/api/prime/league/deck', { fighter: 'ray', deck: ['dash', 'shield', 'power_shot', 'gravity_net'] })).j?.code === 'card_not_allowed' && (await call(A, 'PUT', '/api/prime/league/deck', { fighter: 'zoe', deck: ['dash', 'shield', 'power_shot', 'smoke'] })).j?.code === 'not_league_fighter' && (await call(A, 'PUT', '/api/prime/league/deck', { fighter: 'ray', deck: ['smoke', 'shield', 'power_shot', 'adrenaline'] })).j?.ok === true);
  const s1 = await startA({ win: true, rp: 99999, opponentRating: 1, tokenReward: 500, deck: undefined });
  const m1 = s1.j.match;
  check('a start without a deck uses the attacker\'s saved LEAGUE deck (the career deck in the save stays as it was)', m1.attacker.deck.join() === 'smoke,shield,power_shot,adrenaline');
  const idor = [await call(B, 'GET', `/api/prime/league/match/${m1.id}`), await call(B, 'POST', `/api/prime/league/match/${m1.id}/finish`, { inputs: [[0, -1]] }), await call(B, 'POST', `/api/prime/league/match/${m1.id}/inputs`, { inputs: [] })];
  check('another account cannot read, checkpoint or finish someone else\'s match (404, nothing changes)', idor.every((r) => r.status === 404));
  check('the duel answer never carries the opponent\'s hidden MMR or account', !JSON.stringify(s1.j).includes('mmr') && !JSON.stringify(s1.j).includes('defOwner') && !JSON.stringify(s1.j).includes('oppMmr'));
  check('a duel starts: the server\'s seed and set, BRUNO/KAI/RINA of DefenseKing with the saved deck and tactic', s1.status === 200 && typeof m1.seed === 'number' && LS.arenasAt(clock).includes(m1.arena) && m1.opponent.kind === 'player' && m1.opponent.name === 'DefenseKing' && ['bruno', 'kai', 'rina'].includes(m1.defender.fighter) && !!TACTICS[m1.defender.tactic as TacticId]);
  check('the opponent card shows a nickname, rank and RP — never an account id, email or age group', !JSON.stringify(s1.j).includes(B.id) && !JSON.stringify(s1.j).includes('b@league.test') && !/14-17|18\+/.test(JSON.stringify(s1.j)));
  check('one active match per account: a second start → 409 match_active (with the match to resume)', (await startA()).j?.code === 'match_active');
  const taps1 = botTaps(snapFrom(m1));
  check('taps sent as a checkpoint are kept', (await call(A, 'POST', `/api/prime/league/match/${m1.id}/inputs`, { inputs: taps1.slice(0, 3) })).j?.held === 3);
  check('a checkpoint can never be rewritten (other taps for the same steps → 409 inputs_changed)', (await call(A, 'POST', `/api/prime/league/match/${m1.id}/inputs`, { inputs: [[taps1[0][0], (taps1[0][1] + 1) % 3]] })).j?.code === 'inputs_changed');
  check('malformed taps → 400 (card 7, steps out of order, a result object instead of taps)', (await call(A, 'POST', `/api/prime/league/match/${m1.id}/finish`, { inputs: [[10, 7]] })).status === 400 && (await call(A, 'POST', `/api/prime/league/match/${m1.id}/finish`, { inputs: [[10, 0], [5, 0]] })).status === 400 && (await call(A, 'POST', `/api/prime/league/match/${m1.id}/finish`, { win: true, outcome: 'win', rp: 999 })).status === 400);
  check('a finish sooner than the fight could last in real time → 409 too_early', (await call(A, 'POST', `/api/prime/league/match/${m1.id}/finish`, { inputs: taps1 })).j?.code === 'too_early');
  const pB0 = await prof(B);
  const f1 = await play(A, m1, taps1);
  const r1 = f1.r.j.match;
  check(`the server replayed the fight itself: ${r1.outcome} by ${r1.method}, the same bits as the game (hash ${r1.result?.hash})`, f1.r.status === 200 && r1.status === 'done' && r1.outcome === f1.out.outcome && r1.result.hash === f1.out.hash && r1.how === 'finish');
  const pA1 = await prof(A);
  const expRp = LM.applyRp(0, 0, LM.rpDelta({ rp: 0, mmr: 1000, games: 0 }, 1000, r1.outcome)).rp;
  check(`RP by the server's own formula (${r1.rp >= 0 ? '+' : ''}${r1.rp} → ${pA1.rp}); the 99999 RP / win:true in the request were ignored`, pA1.rp === expRp && r1.rpAfter === expRp && pA1.games === 1 && pA1.rp < 100);
  const pB1 = await prof(B);
  check('the defender\'s RP never moves with its defence (a defence lost costs nothing, won earns no RP)', pB1.rp === pB0.rp && pB1.games === pB0.games);
  const again = await call(A, 'POST', `/api/prime/league/match/${m1.id}/finish`, { inputs: taps1 });
  check('the same finish again: the stored result, nothing paid twice', again.j.duplicate === true && (await prof(A)).rp === pA1.rp && (await admin.collection('league_ledger').getFullList({ filter: `owner = "${A.id}" && reason = "attack"` })).length === 1);

  // two finishes at once (two tabs) + a third with other taps: exactly one settlement
  const m2 = (await startA()).j.match;
  const t2 = botTaps(snapFrom(m2));
  const out2 = replayLeague(snapFrom(m2), t2);
  tick(Math.ceil((out2.steps / 60) * 1000) + 1000);
  const before2 = (await prof(A)).rp;
  // (a repeat that arrives while the first replay runs gets 409 finishing and tries again — as the game does)
  const finishRetry = async () => {
    for (let k = 0; k < 20; k++) {
      const r = await call(A, 'POST', `/api/prime/league/match/${m2.id}/finish`, { inputs: t2 });
      if (r.j?.code !== 'finishing') return r;
      await sleep(400);
    }
    return { status: 0, j: null };
  };
  const par = await Promise.all([0, 1, 2].map(() => finishRetry()));
  const after2 = await prof(A);
  const rows2 = await admin.collection('league_ledger').getFullList({ filter: `owner = "${A.id}" && ref = "${m2.id}"` });
  check('three finishes of one match at once: one replay, the others wait (finishing) — all get the same result, RP and tokens move exactly once', par.every((r) => r.status === 200 && r.j.match.outcome === out2.outcome) && after2.rp === par[0].j.match.rpAfter && after2.rp - before2 === par[0].j.match.rp && rows2.length <= 1 && after2.games === 2);

  // parallel starts: one active match
  const ps = await Promise.all([0, 1, 2, 3].map(() => startA()));
  const created = ps.filter((r) => r.status === 200);
  check('four starts at once: exactly one match is created, the others get match_active', created.length === 1 && ps.filter((r) => r.j?.code === 'match_active').length === 3);
  const m3 = created[0].j.match;

  // a lost connection: the server settles from what it holds when the deadline passes
  const t3 = botTaps(snapFrom(m3));
  const half = t3.filter((x) => x[0] < 1800);
  await call(A, 'POST', `/api/prime/league/match/${m3.id}/inputs`, { inputs: half });
  tick(LEAGUE.match.ttlMinutes * 60000 + 5000);
  await call(A, 'GET', '/api/prime/league/me');
  const r3 = (await call(A, 'GET', `/api/prime/league/match/${m3.id}`)).j.match;
  const exp3 = replayLeague(snapFrom(m3), half);
  check('the player vanished mid-fight: after the deadline the server played it out from the taps it held (no free cancel, no automatic loss)', r3.status === 'done' && r3.how === 'expired' && r3.outcome === exp3.outcome && r3.result.hash === exp3.hash);

  // changed rules of the fight on the server: the match is void, nothing paid
  const m4 = (await startA()).j.match;
  await admin.collection('league_matches').update(m4.id, { sim: 'old0000000000000' });
  tick(100000);
  const rp4 = (await prof(A)).rp;
  const f4 = await call(A, 'POST', `/api/prime/league/match/${m4.id}/finish`, { inputs: [] });
  check('a match begun under other fight rules (server updated meanwhile) is void: no RP, no tokens', f4.j.match.status === 'void' && f4.j.match.how === 'rules_changed' && (await prof(A)).rp === rp4);

  // the proof across engines through the real API: the server (PocketBase's JavaScript) and Node (V8) — other fighters,
  // sets, tactics, fight lengths and tap sequences, each fight the server's own seed
  const xe: string[] = [];
  let xeSame = 0;
  for (let i = 0; i < 6; i++) {
    const fighter = (['ray', 'bruno', 'nika', 'vega', 'ray', 'bruno'] as FighterId[])[i];
    const m = (await startA({ fighter, deck: FIGHTERS[fighter].defaultDeck })).j.match;
    const taps = i === 5 ? [] : botTaps(snapFrom(m), 0.18 + i * 0.09);
    const { r, out } = await play(A, m, taps);
    if (r.j.match.result?.hash === out.hash && r.j.match.outcome === out.outcome && r.j.match.result?.steps === out.steps) xeSame++;
    xe.push(`${fighter}/${m.defender.fighter}/${m.arena}/${m.defender.tactic}/${taps.length}taps/${out.outcome}/${Math.round(out.steps / 60)}s`);
  }
  console.log('      ' + xe.join('  '));
  check(`6 more fights replayed by the server bit-exactly like the game (V8 ↔ goja): ${xeSame}/6`, xeSame === 6);

  section('Сервер: PRIME PRODUCER AVATARS');
  const pget = (u: User | null) => call(u, 'GET', '/api/prime/producer');
  const pput = (u: User | null, body: any) => call(u, 'POST', '/api/prime/producer', body);
  const g0 = await pget(A);
  const dA = defaultLook(A.id);
  check('AV-01/02 an account that never chose: a stable default derived from its id (the same as the game draws), not chosen', g0.status === 200 && g0.j.look.avatar === dA.avatar && g0.j.look.backdrop === dA.backdrop && g0.j.look.rev === 0 && g0.j.look.chosen === false && (await pget(A)).j.look.avatar === dA.avatar);
  check('AV-07 a guest neither reads nor writes a look (401); an unconfirmed account cannot save (403)', (await pget(null)).status === 401 && (await pput(null, { avatar: 'diva', frame: 'neon', backdrop: 'sunset', rev: 0 })).status === 401 && (await pput(late, { avatar: 'diva', frame: 'neon', backdrop: 'sunset', rev: 0 })).j?.code === 'not_verified');
  const bad = await Promise.all([
    { avatar: 'nope', frame: 'neon', backdrop: 'sunset' },
    { avatar: 'diva', frame: 'gold_premium', backdrop: 'sunset' },
    { avatar: '<script>', frame: 'neon', backdrop: 'sunset' },
    { avatar: 'https://evil.example/x.png', frame: 'neon', backdrop: 'sunset' },
    { avatar: 'a'.repeat(200), frame: 'neon', backdrop: 'sunset' },
    { avatar: 'diva', frame: 'neon', backdrop: '__proto__' },
  ].map((l) => pput(A, { ...l, rev: 0 })));
  check('AV-08 unknown, locked, HTML, URL, overlong and prototype ids → 400 look_not_allowed; nothing saved', bad.every((r) => r.status === 400 && r.j?.code === 'look_not_allowed') && (await pget(A)).j.look.chosen === false);
  check('AV-08 a forged revision → 400', (await pput(A, { avatar: 'diva', frame: 'neon', backdrop: 'sunset', rev: 'x' })).status === 400);
  const s1p = await pput(A, { avatar: 'diva', frame: 'neon', backdrop: 'sunset', rev: 0, owner: B.id, user: B.id });
  check('AV-03 a choice is saved by the server (revision 1); an «owner» in the request is ignored — only the signed-in account changes', s1p.status === 200 && s1p.j.look.rev === 1 && s1p.j.look.avatar === 'diva' && (await pget(B)).j.look.chosen === false);
  const A2 = { ...A, token: (await (async () => { const c = new PocketBase(API); await c.collection('users').authWithPassword(A.email, PW); return c.authStore.token; })()) };
  const g2 = await pget(A2);
  check('AV-04 another session of the same account sees the same look', g2.j.look.avatar === 'diva' && g2.j.look.frame === 'neon' && g2.j.look.backdrop === 'sunset' && g2.j.look.rev === 1);
  const stale = await pput(A2, { avatar: 'baron', frame: 'onair', backdrop: 'night', rev: 0 });
  check('AV-05 a tab that saw an older revision is refused (409 look_changed) with the current look — never a mixed one', stale.status === 409 && stale.j.code === 'look_changed' && stale.j.look.avatar === 'diva' && stale.j.look.rev === 1);
  const race = await Promise.all([pput(A, { avatar: 'spark', frame: 'prime', backdrop: 'cyan', rev: 1 }), pput(A2, { avatar: 'noir', frame: 'onair', backdrop: 'night', rev: 1 })]);
  const won = race.filter((r) => r.status === 200);
  const now = (await pget(A)).j.look;
  check('AV-05 two tabs save at once: exactly one wins, the other gets look_changed; the stored look is exactly the winner\'s', won.length === 1 && race.some((r) => r.j?.code === 'look_changed') && now.rev === 2 && now.avatar === won[0].j.look.avatar && now.frame === won[0].j.look.frame && now.backdrop === won[0].j.look.backdrop);
  check('AV-06 another account keeps its own (default) look — nothing leaks between accounts', (await pget(B)).j.look.avatar === defaultLook(B.id).avatar);
  const lookB = { avatar: 'veteran', frame: 'onair', backdrop: 'night' };
  await pput(B, { ...lookB, rev: 0 });
  // the league: the table shows each producer's public look; a match freezes the opponent's look
  const mLook = (await startA()).j.match;
  check('AV-10 the opponent card of a match carries the producer\'s look (three ids) and nothing private', mLook.opponent.kind === 'player' ? mLook.opponent.look?.avatar === 'veteran' && Object.keys(mLook.opponent.look).sort().join() === 'avatar,backdrop,frame' : mLook.opponent.look === undefined);
  await pput(B, { avatar: 'smooth', frame: 'neon', backdrop: 'cyan', rev: 1 });
  const mLater = (await call(A, 'GET', `/api/prime/league/match/${mLook.id}`)).j.match;
  check('AV-13 the producer look is not part of the fight: snapshot sides carry no avatar; the match keeps the look it was made with', mLater.opponent.kind !== 'player' || mLater.opponent.look.avatar === 'veteran' && !('avatar' in mLater.defender) && !('avatar' in mLater.attacker));
  await call(A, 'POST', `/api/prime/league/match/${mLook.id}/finish`, { inputs: [[0, -1]] });
  const brd = await call(A, 'GET', '/api/prime/league/board');
  const rowB = brd.j.rows.find((r: any) => r.name === 'DefenseKing');
  check('AV-09 the table: each producer\'s public look (B now «smooth»), never an email, account id, MMR, consent or save', (!rowB || rowB.look?.avatar === 'smooth') && !/@league\.test|mmr|consent|"data"|"email"/i.test(JSON.stringify(brd.j)) && !JSON.stringify(brd.j).includes(B.id));
  let limited = false;
  let rev = (await pget(C)).j.look.rev;
  for (let i = 0; i < 32 && !limited; i++) {
    const r = await pput(C, { avatar: PRODUCER_AVATARS[i % 14].id, frame: 'studio', backdrop: 'violet', rev });
    if (r.status === 429) limited = true;
    else rev = r.j.look.rev;
  }
  check('rate limit: at most 30 saves in 10 minutes per account → 429 too_many_changes', limited && rev === 30);
  const cfgP = await call(null, 'GET', '/api/prime/config');
  check('the server announces PRIME PRODUCER AVATARS (catalogue version 1) — independent of the league switch', cfgP.j.producer === 1);

  section('Сервер: защита, лимиты, отчёт');
  // C (no fights against B yet) gives up at once against B twice: B's defence wins; it is paid ONCE per attacker and day
  const pBt0 = (await prof(B)).tokens;
  const airB0 = (await prof(B)).air;
  let againstB = 0;
  let gaveUp = 0;
  for (let i = 0; i < 2; i++) {
    const m = (await call(C, 'POST', '/api/prime/league/match/start', { mode: 'duel', fighter: 'vega', deck: FIGHTERS.vega.defaultDeck, sim: SIM_VERSION, op: op() })).j.match;
    if (m.opponent.kind === 'player') againstB++;
    const r = await call(C, 'POST', `/api/prime/league/match/${m.id}/finish`, { inputs: [[0, -1]] });
    if (r.j.match.outcome === 'loss') gaveUp++;
    tick(1000);
  }
  const pBt = await prof(B);
  check(`a forfeit is a loss at once (${gaveUp}/2) — no waiting, no too_early`, gaveUp === 2);
  check(`defence wins pay the owner ${LEAGUE.tokens.defenseWin} tokens ONCE per attacker and day (2 wins vs C → +${pBt.tokens - pBt0}), air points too`, againstB === 2 && pBt.tokens - pBt0 === LEAGUE.tokens.defenseWin && pBt.air > airB0);
  // A has already fought B three times today: the pair limit sends A elsewhere
  const pairBefore = (await admin.collection('league_matches').getFullList({ filter: `attacker = "${A.id}" && defOwner = "${B.id}" && ranked = true && status != "void"` })).length;
  const mPair = (await startA()).j.match;
  await call(A, 'POST', `/api/prime/league/match/${mPair.id}/finish`, { inputs: [[0, -1]] });
  check(`pair limit: after ${LEAGUE.matchmaking.pairPerDay} ranked fights against one owner in 24 h (here ${pairBefore}), the next goes to another participant or PRIME NETWORK`, pairBefore >= LEAGUE.matchmaking.pairPerDay && mPair.opponent.kind === 'system');
  const meB = await call(B, 'GET', '/api/prime/league/me');
  check('«while you were off air»: only real confirmed fights against the defence, by fighter and tactic', meB.j.report.matches >= againstB && meB.j.report.wins >= Math.min(againstB, 1) && Object.keys(meB.j.report.byTactic).every((t) => TACTIC_ORDER.includes(t as TacticId)));
  // the owner loses a fighter (a refund, a changed save): its saved defender stops defending at once and the studio says why
  await giveSave(B, ['ray', 'bruno', 'rina'], []);
  const meLost = await call(B, 'GET', '/api/prime/league/me');
  const lost = meLost.j.defense.find((d: any) => d.fighter === 'kai');
  const mLost = (await call(C, 'POST', '/api/prime/league/match/start', { mode: 'duel', fighter: 'vega', deck: FIGHTERS.vega.defaultDeck, sim: SIM_VERSION, op: op() })).j.match;
  await call(C, 'POST', `/api/prime/league/match/${mLost.id}/finish`, { inputs: [[0, -1]] });
  check('a defender whose fighter is no longer owned is shown with its reason and never sent into a new match', lost?.problem === 'fighter_not_owned' && mLost.defender.fighter !== 'kai');
  await giveSave(B, ['ray', 'bruno', 'kai', 'rina', 'nika', 'vega'], []);
  await call(B, 'POST', '/api/prime/league/report/seen', {});
  check('after reading, the report is empty until new fights', (await call(B, 'GET', '/api/prime/league/me')).j.report.matches === 0);
  // C's only possible opponent is B (A has no defence) — switch B off: PRIME NETWORK
  await call(B, 'POST', '/api/prime/league/defense/toggle', { on: false });
  const mC = await call(C, 'POST', '/api/prime/league/match/start', { mode: 'duel', fighter: 'vega', deck: FIGHTERS.vega.defaultDeck, sim: SIM_VERSION, op: op() });
  check('a defence switched off takes part in no NEW match; with nobody fitting, a labelled PRIME NETWORK participant defends', mC.j.match.opponent.kind === 'system' && /PRIME NETWORK|СТУДИЯ|ЛАБ|ЭФИР|КАДР|ТВ|ФАЛЬСТАРТ/.test(mC.j.match.opponent.name));
  await call(C, 'POST', `/api/prime/league/match/${mC.j.match.id}/finish`, { inputs: [[0, -1]] });
  await call(B, 'POST', '/api/prime/league/defense/toggle', { on: true });
  const board = await call(A, 'GET', '/api/prime/league/board');
  check('the table holds real players of this season only (PRIME NETWORK never), sorted by RP', board.j.rows.length >= 2 && board.j.rows.every((r: any, i: number) => i === 0 || board.j.rows[i - 1].rp >= r.rp) && !board.j.rows.some((r: any) => /СТУДИЯ|PRIME NETWORK/.test(r.name)) && board.j.rows.some((r: any) => r.me));

  section('Сервер: PRIME CHALLENGE');
  const pa = await prof(A);
  await admin.collection('league_profiles').update(pa.id, { rp: 695, floor: 300, peak: 695, games: 30 });
  let reached = false;
  for (let i = 0; i < 16 && !reached; i++) {
    // every try starts from 695 (a try without a winning line is given up and must not drag the RP down)
    await admin.collection('league_profiles').update(pa.id, { rp: 695, floor: 300 });
    const m = (await startA()).j.match;
    const w = winningTaps(snapFrom(m));
    const { r } = await play(A, m, w ?? [[0, -1]]);
    reached = !!r.j.profile?.challenge;
    if (proc.env.LEAGUE_DEBUG) console.log('      challenge try', i, m.opponent.kind, r.status, r.j?.code, r.j?.match?.outcome, r.j?.match?.ranked, r.j?.match?.rp, r.j?.profile?.rp, !!w);
  }
  const pc = await call(A, 'GET', '/api/prime/league/me');
  check('a win at 695 RP stops at 699: PRIME CHALLENGE for НОЧНОЙ ЭФИР opens', reached && pc.j.rp === 699 && pc.j.challenge?.to === 2, JSON.stringify({ reached, rp: pc.j.rp, ch: pc.j.challenge, code: pc.j.code }));
  check('an ordinary duel waits while the challenge is open (challenge_open)', (await startA()).j?.code === 'challenge_open');
  // two losses: the challenge fails, RP drops 60, the rank (ПЕРВЫЙ ДУБЛЬ) stays
  for (let i = 0; i < 2; i++) {
    const m = (await startA({ mode: 'challenge' })).j.match;
    await call(A, 'POST', `/api/prime/league/match/${m.id}/finish`, { inputs: [[0, -1]] });
  }
  const pf = await call(A, 'GET', '/api/prime/league/me');
  check('2 losses: the challenge failed — RP 640, still ПЕРВЫЙ ДУБЛЬ, no trap (duels open again)', pf.j.rp === 700 - LEAGUE.challenge.failDrop && pf.j.challenge === null && pf.j.rank.id === 'first_take');
  const chRows = async () => await admin.collection('league_ledger').getFullList({ filter: `owner = "${A.id}" && reason = "challenge"` });
  check('hotfix: a FAILED challenge pays no PRIME CHALLENGE bonus', (await chRows()).length === 0);
  // hotfix: the day's ordinary match tokens are already used up (60) — the +40 milestone must still be paid, once
  const dayNow = LM.dayOf(clock);
  const usedToday = (await admin.collection('league_ledger').getFullList({ filter: `owner = "${A.id}" && reason = "attack" && day = ${dayNow}` })).reduce((sum: number, l: any) => sum + l.delta, 0);
  const fill = Math.max(0, LEAGUE.tokens.attackPerDay - usedToday);
  const pFill = await prof(A);
  if (fill) await admin.collection('league_ledger').create({ owner: A.id, delta: fill, reason: 'attack', ref: 'check-fill-' + dayNow, balance: pFill.tokens + fill, day: dayNow });
  await admin.collection('league_profiles').update(pFill.id, { tokens: pFill.tokens + fill });
  const tokensBefore = pFill.tokens + fill;
  // three wins: promoted (the deciding win is sent four times at once: one settlement, one bonus)
  await admin.collection('league_profiles').update((await prof(A)).id, { rp: 699, challenge: { to: 2, wins: 0, losses: 0, since: clock } });
  let w3 = 0;
  let deciding: any[] = [];
  let decidingId = '';
  for (let i = 0; i < 12 && w3 < 3; i++) {
    const m = (await startA({ mode: 'challenge' })).j.match;
    const w = winningTaps(snapFrom(m));
    if (!w) {
      await admin.collection('league_matches').update(m.id, { status: 'void' });
      continue;
    }
    if (w3 === 2) {
      const out = replayLeague(snapFrom(m), w);
      tick(Math.ceil((out.steps / 60) * 1000) + 1000);
      deciding = await Promise.all([0, 1, 2, 3].map(() => call(A, 'POST', `/api/prime/league/match/${m.id}/finish`, { inputs: w })));
      decidingId = m.id;
      if (deciding.some((r) => r.j?.match?.outcome === 'win')) w3++;
      continue;
    }
    const { r } = await play(A, m, w);
    if (r.j.match.outcome === 'win') w3++;
  }
  const pp = await call(A, 'GET', '/api/prime/league/me');
  check('3 wins: НОЧНОЙ ЭФИР (700 RP, the floor 700), the ceremony is waiting to be shown once', w3 === 3 && pp.j.rp === 700 && pp.j.floor === 700 && pp.j.ceremony?.kind === 'rank' && pp.j.ceremony?.rank === 2);
  const rows = await chRows();
  const settled = deciding.find((r) => r.status === 200 && !r.j.duplicate && r.j.match?.status === 'done');
  check(`hotfix: the passed challenge pays +${LEAGUE.tokens.challengeWin} although the day's ${LEAGUE.tokens.attackPerDay} match tokens were used up — one ledger row (season + rank key), the result says so`, rows.length === 1 && rows[0].delta === LEAGUE.tokens.challengeWin && /^s\d+:r2$/.test(rows[0].ref) && pp.j.tokens === tokensBefore + LEAGUE.tokens.challengeWin && settled?.j.match.result?.challengeTokens === LEAGUE.tokens.challengeWin, JSON.stringify({ rows: rows.map((r: any) => [r.delta, r.ref]), tokens: pp.j.tokens, tokensBefore, statuses: deciding.map((r) => `${r.status}${r.j?.code ? ' ' + r.j.code : ''}${r.j?.duplicate ? ' dup' : ''}`) }));
  const repeatFinish = await call(A, 'POST', `/api/prime/league/match/${decidingId}/finish`, { inputs: [] });
  check('hotfix: four finishes at once and a later repeat of the deciding match → one settlement, the bonus never twice', deciding.every((r) => r.status === 200 || r.j?.code === 'finishing') && repeatFinish.j.duplicate === true && (await chRows()).length === 1 && (await call(A, 'GET', '/api/prime/league/me')).j.tokens === pp.j.tokens);
  await call(A, 'POST', '/api/prime/league/report/seen', {});
  check('the ceremony is not shown again after it was seen', (await call(A, 'GET', '/api/prime/league/me')).j.ceremony === null);

  section('Сервер: дорожка сезона, сезон, жетоны');
  const air = (await prof(A)).air;
  const c1 = await call(A, 'POST', '/api/prime/league/track/claim', { tier: 1 });
  check(`air points ${air} ≥ 50: tier 1 gives ${LEAGUE.track[0].tokens} tokens once (again → duplicate)`, c1.j.ok && c1.j.tokens === LEAGUE.track[0].tokens && (await call(A, 'POST', '/api/prime/league/track/claim', { tier: 1 })).j.duplicate === true);
  check('a tier not reached → 409', (await call(A, 'POST', '/api/prime/league/track/claim', { tier: 10 })).status === 409);
  const ledger = await admin.collection('league_ledger').getFullList({ filter: `owner = "${A.id}"`, sort: 'created' });
  check('every token is a ledger row with its reason; the balance equals the sum', (await prof(A)).tokens === ledger.reduce((s: number, l: any) => s + l.delta, 0));
  // a match across the season boundary is settled without RP
  const mS = (await startA()).j.match;
  const tS = botTaps(snapFrom(mS));
  setClock(Date.parse(LEAGUE.season.epoch) + LEAGUE.season.lengthDays * 86400000 + 60000);
  const fS = await call(A, 'POST', `/api/prime/league/match/${mS.id}/finish`, { inputs: tS });
  check('a fight begun in season 1 and finished in season 2 is settled but unranked (RP 0)', fS.j.match.status === 'done' && fS.j.match.rp === 0);
  const ns = await call(A, 'GET', '/api/prime/league/me');
  const hist = await admin.collection('league_history').getFullList({ filter: `owner = "${A.id}"` });
  check('season 2: season 1 archived once (history), RP × 0.6 (700 → 420), games and air start again', ns.j.season.number === 2 && hist.length === 1 && hist[0].season === 1 && ns.j.rp === 420 && ns.j.games === 0 && ns.j.air === 0);
  check('the new season\'s table is empty until someone plays it (seasons never mix)', (await call(A, 'GET', '/api/prime/league/board')).j.total === 0);
  check('tokens and lifetime records survive the season change', ns.j.tokens === (await prof(A)).tokens && ns.j.tokens > 0 && ns.j.stats.attackW + ns.j.stats.attackL >= 5);

  section('Сервер: PRIME SQUAD и PRIME RUSH');
  await call(B, 'POST', '/api/prime/league/report/seen', {});
  const sq = await call(A, 'POST', '/api/prime/league/series/start', { kind: 'squad', sim: SIM_VERSION, op: op(), lineup: [{ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck }, { fighter: 'bruno', deck: FIGHTERS.bruno.defaultDeck }, { fighter: 'nika', deck: FIGHTERS.nika.defaultDeck }] });
  check('PRIME SQUAD: three different fighters against DefenseKing\'s three defenders, the first duel starts', sq.status === 200 && sq.j.match.mode === 'squad' && sq.j.match.round === 0 && sq.j.match.opponent.name === 'DefenseKing');
  const npcSeries = [await call(C, 'POST', '/api/prime/league/series/start', { kind: 'squad', sim: SIM_VERSION, op: op(), lineup: [{ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck }, { fighter: 'vega', deck: FIGHTERS.vega.defaultDeck }, { fighter: 'zoe', deck: ['shock', 'power_shot', 'smoke', 'system_overload'] }] }), await call(C, 'POST', '/api/prime/league/series/start', { kind: 'rush', sim: SIM_VERSION, op: op(), lineup: [{ fighter: 'crash', deck: FIGHTERS.bruno.defaultDeck }] })];
  check('PRIME SQUAD with ЗОИ, PRIME RUSH with КРАШ → not_league_fighter, no series', npcSeries.every((r) => r.j?.code === 'not_league_fighter') && (await admin.collection('league_series').getFullList({ filter: `owner = "${C.id}"` })).length === 0);
  check('a squad needs three DIFFERENT fighters', (await call(C, 'POST', '/api/prime/league/series/start', { kind: 'squad', sim: SIM_VERSION, op: op(), lineup: [{ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck }, { fighter: 'ray', deck: FIGHTERS.ray.defaultDeck }, { fighter: 'vega', deck: FIGHTERS.vega.defaultDeck }] })).j?.code === 'invalid_lineup');
  const rpSq = (await prof(A)).rp;
  let sm = sq.j.match;
  const seenDef: string[] = [];
  let last: any = null;
  let lastSeries: any = null;
  for (let i = 0; i < 3 && sm; i++) {
    seenDef.push(sm.defender.fighter);
    const w = i === 0 ? winningTaps(snapFrom(sm)) : null;
    const { r } = await play(A, sm, w ?? [[0, -1]]);
    last = r.j.match;
    lastSeries = r.j.series;
    const nx = await call(A, 'POST', '/api/prime/league/series/next', { kind: 'squad' });
    sm = nx.status === 200 ? nx.j.match : null;
  }
  const sqRow = (await admin.collection('league_series').getFullList({ filter: `owner = "${A.id}" && kind = "squad"` }))[0];
  const sqRp = (await prof(A)).rp - rpSq;
  check(`the squad ended at 2 losses (${sqRow.state.wins}–${sqRow.state.losses}) against three different defenders (${seenDef.join(', ')})`, sqRow.status === 'done' && sqRow.state.losses === 2 && new Set(seenDef).size === seenDef.length);
  check('the last duel\'s answer carries the finished squad (status, score, its one RP result) for the result screen', lastSeries?.status === 'done' && lastSeries?.done && lastSeries.done.rp === sqRow.state.done.rp && lastSeries.losses === 2);
  check(`settled ONCE: one RP result for the squad (${sqRp}), one token row, no RP from its single duels`, last.rp === 0 && (await admin.collection('league_ledger').getFullList({ filter: `owner = "${A.id}" && reason = "squad"` })).length === 1 && sqRp === sqRow.state.done.rp);
  const ru = await call(A, 'POST', '/api/prime/league/series/start', { kind: 'rush', sim: SIM_VERSION, op: op(), lineup: [{ fighter: 'vega', deck: FIGHTERS.vega.defaultDeck }] });
  check('PRIME RUSH starts with one fighter; an ordinary duel waits while a series is open', ru.status === 200 && ru.j.match.mode === 'rush' && (await startA()).j?.code !== undefined);
  const rpRu = (await prof(A)).rp;
  // leave mid-run (a reload): the series and its duel are still there to resume
  const resume = await call(A, 'POST', '/api/prime/league/series/next', { kind: 'rush' });
  check('a reload mid-run gets the same open duel back (resume, not a new one)', resume.j.match.id === ru.j.match.id);
  let rm = ru.j.match;
  for (let i = 0; i < 2 && rm; i++) {
    await call(A, 'POST', `/api/prime/league/match/${rm.id}/finish`, { inputs: [[0, -1]] });
    const nx = await call(A, 'POST', '/api/prime/league/series/next', { kind: 'rush' });
    rm = nx.status === 200 ? nx.j.match : null;
  }
  const ruRow = (await admin.collection('league_series').getFullList({ filter: `owner = "${A.id}" && kind = "rush"` }))[0];
  check(`the run ended at ${LEAGUE.rush.lives} losses; RUSH moves no RP (rpFactor ${LEAGUE.rush.rpFactor})`, ruRow.status === 'done' && ruRow.state.losses === LEAGUE.rush.lives && (await prof(A)).rp === rpRu);

  section('Alpha 1.9.3: павильон до старта, отмена, «Убрать» из защиты, облик у соперника');
  // two new synthetic accounts: OWN — buys and wears a skin, puts its fighters in defence; RIV — attacks it.
  // DefenseKing's defence is switched off for this section so RIV meets OWN (restored at the end).
  await call(B, 'POST', '/api/prime/league/defense/toggle', { on: false });
  const OWN = await register('SkinOwner', 'own193@league.test');
  const RIV = await register('SkinRival', 'riv193@league.test');
  await giveSave(OWN, ['ray', 'bruno', 'nika'], []);
  await giveSave(RIV, ['ray', 'bruno', 'vega'], []);
  for (const u of [OWN, RIV]) await call(u, 'POST', '/api/prime/league/join', { accept: true, rules: 1 });
  tick(25 * 3600000);
  const HOUR_MS = 3600000;
  const startR = (body: any = {}) => call(RIV, 'POST', '/api/prime/league/match/start', { mode: 'duel', fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, sim: SIM_VERSION, op: op(), ...body });
  const quit = async (u: User, m: any) => (await call(u, 'POST', `/api/prime/league/match/${m.id}/finish`, { inputs: [[0, -1]] })).j;
  const putO = (slots: any[], base?: string) => call(OWN, 'PUT', '/api/prime/league/defense', { slots, ...(base !== undefined ? { base } : {}) });
  const defO = async (): Promise<LeagueSlot[]> => (await call(OWN, 'GET', '/api/prime/league/me')).j.defense;
  const own3 = [sl(1, 'ray', 'assault'), sl(2, 'bruno', 'fortress'), sl(3, 'nika', 'counter')];
  check('OWN puts three defenders (RAY, BRUNO, NIKA) — the starting point', (await putO(own3)).j?.defense?.length === 3);

  // --- the set, chosen before the start: DUEL in every set of the league
  const when = new Date(clock).toISOString().slice(0, 10);
  const byArena: string[] = [];
  for (const id of LEAGUE.arenas) {
    const r = await startR({ arena: id });
    byArena.push(`${id}→${r.j.match?.arena}/${r.j.match?.arenaPick}`);
    if (r.j.match) await quit(RIV, r.j.match);
  }
  check(`PRIME DUEL: each of the 4 sets chosen before the start is the set of the match (${byArena.join(' ')})`, byArena.every((x) => { const [want, got] = x.split('→'); return got === `${want}/${want}`; }));
  check(`CURSED CEMETERY is playable on ${when} — outside Halloween — and pays nothing seasonal (the league has no seasonal set bonus)`, byArena.some((x) => x.startsWith('graveyard→graveyard/')) && !/^10-/.test(when.slice(5)));
  tick(HOUR_MS + 60000);
  // RANDOM: an old game sends nothing, a new one sends «random»
  const rnd: string[] = [];
  let rndPick = true;
  for (let i = 0; i < 12; i++) {
    const r = await startR(i % 2 ? { arena: 'random' } : {});
    rnd.push(r.j.match.arena);
    rndPick = rndPick && r.j.match.arenaPick === 'random' && LEAGUE.arenas.includes(r.j.match.arena);
    await quit(RIV, r.j.match);
  }
  check(`RANDOM (no field from an old game, or «random»): the server draws among its 4 sets — ${[...new Set(rnd)].join(', ')} in 12 starts`, rndPick && new Set(rnd).size >= 2);
  tick(HOUR_MS + 60000);
  // forged or unknown sets: never in a fight — the server's RANDOM instead
  const forged: any[] = ['moon', '__proto__', 'constructor', 123, { id: 'graveyard' }, '', 'GRAVEYARD', null, 'toString'];
  const fz: string[] = [];
  for (const f of forged) {
    const r = await startR({ arena: f });
    fz.push(`${JSON.stringify(f)}→${r.j.match?.arena}/${r.j.match?.arenaPick}`);
    if (r.j.match) await quit(RIV, r.j.match);
  }
  check('a forged set (unknown ids, «__proto__», «toString», a number, an object, wrong case) never reaches a fight: RANDOM among the sets open now', fz.every((x) => /→(original|casino|backlot|graveyard)\/random$/.test(x)), fz.join(' '));
  // after Halloween: the seasonal set is closed for new fights — and kept where it was fixed before
  const meAfter = await call(RIV, 'GET', '/api/prime/league/me');
  check(`after the event (${when}) the server opens the 4 permanent sets only`, meAfter.j.arenas?.join() === 'original,casino,backlot,graveyard' && Object.keys(meAfter.j.arenaUntil ?? {}).length === 0);
  const closedDuel = await startR({ arena: 'haunted' });
  const seriesBefore = (await admin.collection('league_series').getFullList({ filter: `owner = "${RIV.id}"` })).length;
  const closedRush = await call(RIV, 'POST', '/api/prime/league/series/start', { kind: 'rush', sim: SIM_VERSION, op: op(), lineup: [{ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck }], arena: 'haunted' });
  check('HAUNTED after its event: a new duel or series on it → 409 arena_unavailable with the sets open now; no match, no series made', closedDuel.status === 409 && closedDuel.j.code === 'arena_unavailable' && closedDuel.j.arenas.join() === 'original,casino,backlot,graveyard' && closedRush.j?.code === 'arena_unavailable' && (await admin.collection('league_series').getFullList({ filter: `owner = "${RIV.id}"` })).length === seriesBefore && !(await call(RIV, 'GET', '/api/prime/league/me')).j.active);
  const hNext = await call(H1, 'POST', '/api/prime/league/series/next', { kind: 'rush' });
  check('the run started on HAUNTED during Halloween goes on there after the event (fixed in the series)', hNext.status === 200 && hNext.j.match.arena === 'haunted' && hNext.j.series.arena === 'haunted');
  const hNextDone = await call(H1, 'POST', `/api/prime/league/match/${hNext.j.match.id}/finish`, { inputs: [[0, -1]] });
  check('…and settles as before (the run ends at 2 losses)', hNextDone.j.series?.status === 'done');
  check('the Halloween duel keeps its set and result after the event', (await call(H1, 'GET', `/api/prime/league/match/${mh.id}`)).j.match.arena === 'haunted' && (await call(H1, 'GET', `/api/prime/league/match/${mh.id}`)).j.match.result?.hash === fh.out.hash);
  tick(HOUR_MS + 60000);

  // --- the fight on the chosen set: the server replays it there, bit-exactly (the set really is part of the proof)
  const mg = (await startR({ arena: 'graveyard', fighter: 'vega', deck: FIGHTERS.vega.defaultDeck })).j.match;
  const tg = botTaps(snapFrom(mg));
  const fg = await play(RIV, mg, tg);
  const onOriginal = replayLeague({ ...snapFrom(mg), arena: 'original' }, tg);
  check(`the server replayed the CURSED CEMETERY fight on that set: hash ${fg.r.j.match.result?.hash} = the game's ${fg.out.hash} (the same taps on another set: ${onOriginal.hash})`, fg.r.j.match.arena === 'graveyard' && fg.r.j.match.result?.hash === fg.out.hash && fg.r.j.match.outcome === fg.out.outcome && onOriginal.hash !== fg.out.hash);
  const mc = (await startR({ arena: 'casino' })).j.match;
  const tc = botTaps(snapFrom(mc), 0.3);
  const fc = await play(RIV, mc, tc);
  check(`…and the LUXURY CASINO fight: hash ${fc.r.j.match.result?.hash} = ${fc.out.hash}`, fc.r.j.match.arena === 'casino' && fc.r.j.match.result?.hash === fc.out.hash);
  const rowG = await admin.collection('league_matches').getOne(mg.id);
  check('the set is fixed in the match record before the fight (arena + the choice in its snapshot) — the finish request cannot change it', rowG.arena === 'graveyard' && rowG.snapshot.arenaPick === 'graveyard');
  // a match from before 1.9.3 (no choice in its snapshot) reads as RANDOM — as it was
  const { arenaPick: _ap, ...oldSnap } = rowG.snapshot;
  await admin.collection('league_matches').update(mg.id, { snapshot: oldSnap });
  check('an older match without the choice is shown as RANDOM, its set and result unchanged', (await call(RIV, 'GET', `/api/prime/league/match/${mg.id}`)).j.match.arenaPick === 'random' && (await call(RIV, 'GET', `/api/prime/league/match/${mg.id}`)).j.match.arena === 'graveyard');

  // --- one start per tap: the same request twice (a double tap, a retry after a lost answer) makes ONE match
  const same1 = op();
  const dbl = await Promise.all([startR({ op: same1, arena: 'backlot' }), startR({ op: same1, arena: 'backlot' })]);
  const dblRows = await admin.collection('league_matches').getFullList({ filter: `attacker = "${RIV.id}" && op = "${same1}"` });
  check('a double tap sends the same op twice: one match, the second answer is that match again (duplicate) — never two', dbl.every((r) => r.status === 200 || r.j?.code === 'match_active') && dblRows.length === 1 && dbl.filter((r) => r.status === 200).every((r) => r.j.match.id === dblRows[0].id));
  const dblRetry = await startR({ op: same1, arena: 'casino' });
  check('a retry of that request (the answer was lost) gets the same match and set — a new set cannot be smuggled in', dblRetry.j.duplicate === true && dblRetry.j.match.id === dblRows[0].id && dblRetry.j.match.arena === 'backlot');
  const rivBefore = await prof(RIV);
  await quit(RIV, dblRetry.j.match);
  check('after a match exists there is no free way out: leaving it is a loss settled by the server (RP moved)', (await prof(RIV)).games === rivBefore.games + 1);
  tick(HOUR_MS + 60000);

  // --- PRIME CHALLENGE on a chosen set
  const pR = await prof(RIV);
  await admin.collection('league_profiles').update(pR.id, { challenge: { to: 1, wins: 0, losses: 0, since: clock } });
  const chm = await startR({ mode: 'challenge', arena: 'backlot' });
  check('PRIME CHALLENGE (the qualifier) takes the chosen set too (BACKLOT) — no set is tied to it', chm.status === 200 && chm.j.match.mode === 'challenge' && chm.j.match.arena === 'backlot' && chm.j.match.arenaPick === 'backlot');
  await quit(RIV, chm.j.match);
  await admin.collection('league_profiles').update(pR.id, { challenge: null });

  // --- PRIME RUSH: one setting for the whole run, never changed mid-run
  const ser = (u: User, kind: string, lineup: any[], extra: any = {}) => call(u, 'POST', '/api/prime/league/series/start', { kind, sim: SIM_VERSION, op: op(), lineup, ...extra });
  const ru1 = await ser(RIV, 'rush', [{ fighter: 'bruno', deck: FIGHTERS.bruno.defaultDeck }], { arena: 'backlot' });
  check('PRIME RUSH started on BACKLOT: the series keeps the set, its first duel is there', ru1.status === 200 && ru1.j.series.arena === 'backlot' && ru1.j.match.arena === 'backlot');
  await quit(RIV, ru1.j.match);
  const ru2 = await call(RIV, 'POST', '/api/prime/league/series/next', { kind: 'rush', arena: 'casino' });
  check('the next duel of the run stays on BACKLOT — a set sent mid-run is ignored', ru2.status === 200 && ru2.j.match.arena === 'backlot' && ru2.j.series.arena === 'backlot');
  await quit(RIV, ru2.j.match);
  const ru3 = await ser(RIV, 'rush', [{ fighter: 'vega', deck: FIGHTERS.vega.defaultDeck }]);
  check('a run started by an older game (no set): RANDOM for each duel', ru3.status === 200 && ru3.j.series.arena === 'random' && ru3.j.match.arenaPick === 'random' && LEAGUE.arenas.includes(ru3.j.match.arena));
  // a series opened before 1.9.3 (its state has no set) goes on with RANDOM
  const ruRow3 = (await admin.collection('league_series').getFullList({ filter: `owner = "${RIV.id}" && kind = "rush" && status = "active"` }))[0];
  const { arena: _sa, ...oldState } = ruRow3.state;
  await admin.collection('league_series').update(ruRow3.id, { state: oldState });
  await quit(RIV, ru3.j.match);
  const ru4 = await call(RIV, 'POST', '/api/prime/league/series/next', { kind: 'rush' });
  check('a run from before 1.9.3 (no set in its state) goes on: RANDOM', ru4.status === 200 && ru4.j.series.arena === 'random' && ru4.j.match.arenaPick === 'random');
  await quit(RIV, ru4.j.match);
  tick(25 * 3600000);

  // --- PRIME SQUAD against OWN's three defenders on CURSED CEMETERY
  const sq1 = await ser(RIV, 'squad', [{ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck }, { fighter: 'bruno', deck: FIGHTERS.bruno.defaultDeck }, { fighter: 'vega', deck: FIGHTERS.vega.defaultDeck }], { arena: 'graveyard' });
  check('PRIME SQUAD against SkinOwner\'s three defenders, the squad\'s set CURSED CEMETERY', sq1.status === 200 && sq1.j.match.opponent.name === 'SkinOwner' && sq1.j.match.arena === 'graveyard' && sq1.j.series.arena === 'graveyard');
  await quit(RIV, sq1.j.match);
  const sq2 = await call(RIV, 'POST', '/api/prime/league/series/next', { kind: 'squad', arena: 'original' });
  check('the squad\'s second duel: the same set (a change sent mid-squad is ignored)', sq2.status === 200 && sq2.j.match.arena === 'graveyard' && sq2.j.match.round === 1);
  await quit(RIV, sq2.j.match);
  check('two lost duels end the squad as before (settled once)', (await admin.collection('league_series').getFullList({ filter: `owner = "${RIV.id}" && kind = "squad"` }))[0].status === 'done');
  tick(25 * 3600000);

  // --- «Убрать» in the Defense Studio: the server holds it, a second device and a new sign-in see it
  const seen0 = await defO();
  const base0 = defenseBase(seen0);
  const drop = await putO([sl(1, 'ray', 'assault'), sl(2, 'bruno', 'fortress')], base0);
  const rowsAfterDrop = await admin.collection('league_defense').getFullList({ filter: `owner = "${OWN.id}"` });
  check('«Убрать» NIKA: saved on the server (2 defenders), the other two slots untouched (their versions)', drop.status === 200 && drop.j.defense.length === 2 && !rowsAfterDrop.some((r: any) => r.fighter === 'nika') && drop.j.defense.every((d: any) => d.version === seen0.find((x) => x.fighter === d.fighter)!.version));
  const ownLeft = await admin.collection('saves').getFullList({ filter: `owner = "${OWN.id}"` });
  check('NIKA stays OWN\'s fighter: the cloud save still has her signed (only the defence line-up changed)', JSON.parse(ownLeft[0].data).fighters.nika.unlocked === true);
  const second = new PocketBase(API);
  await second.collection('users').authWithPassword('own193@league.test', PW);
  const OWN2: User = { id: OWN.id, token: second.authStore.token, email: OWN.email };
  const meNew = await call(OWN2, 'GET', '/api/prime/league/me');
  check('a new sign-in (another device) sees the defence without NIKA', meNew.j.defense.length === 2 && !meNew.j.defense.some((d: any) => d.fighter === 'nika'));
  const staleSave = await call(OWN2, 'PUT', '/api/prime/league/defense', { slots: own3, base: base0 });
  check('a device that still shows the old studio cannot silently bring NIKA back: 409 defense_changed with the studio as it is', staleSave.status === 409 && staleSave.j.code === 'defense_changed' && staleSave.j.defense.length === 2 && (await defO()).length === 2);
  check('a forged base (not text) → 400, nothing saved', (await putO(own3, 123 as any)).j?.code === 'defense_base' && (await defO()).length === 2);
  check('zero defenders is not a save (1–5 stays the rule; «no defence» is the defence switch) → 400 defense_slots', (await putO([], defenseBase(await defO()))).j?.code === 'defense_slots' && (await defO()).length === 2);
  const restore = await putO(own3, defenseBase(await defO()));
  check('NIKA back in defence from the current studio (restore) → 200, three defenders', restore.status === 200 && restore.j.defense.length === 3);
  const legacy = await putO(own3);
  check('an older game (no base) saves exactly as before', legacy.status === 200 && legacy.j.defense.length === 3);
  const b3 = defenseBase(await defO());
  const raceO = await Promise.all([putO([sl(1, 'ray', 'assault'), sl(2, 'bruno', 'fortress')], b3), putO([sl(1, 'ray', 'assault'), sl(3, 'nika', 'counter')], b3)]);
  const after = await defO();
  check('two devices remove two different defenders at the same moment: one wins (200), the other is refused (409) — never a mixed or empty studio', raceO.filter((r) => r.status === 200).length === 1 && raceO.filter((r) => r.j?.code === 'defense_changed').length === 1 && after.length === 2, raceO.map((r) => r.status).join(','));
  await putO(own3, defenseBase(after));

  // --- a frozen match keeps the defender it was made with
  const mf = (await startR({ arena: 'original' })).j.match;
  const df = mf.defender.fighter;
  const keep = own3.filter((x) => x.fighter !== df);
  await putO(keep, defenseBase(await defO()));
  const tf = botTaps(snapFrom(mf), 0.3);
  const ff = await play(RIV, mf, tf);
  check(`a fight already made against ${df.toUpperCase()} finishes as it was made after ${df.toUpperCase()} left the defence (server hash = the game's)`, ff.r.status === 200 && ff.r.j.match.status === 'done' && ff.r.j.match.defender.fighter === df && ff.r.j.match.result?.hash === ff.out.hash);
  const fresh: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await startR();
    fresh.push(r.j.match.opponent.kind === 'player' ? r.j.match.defender.fighter : 'system');
    await quit(RIV, r.j.match);
  }
  check(`new matches use the updated defence: ${df.toUpperCase()} no longer defends (${fresh.join(', ')})`, !fresh.includes(df) && fresh.some((x) => x !== 'system'));
  tick(25 * 3600000);

  // --- a paid skin seen by the other player
  const skinB = 'bruno_casino_boss';
  check('without the right: BRUNO in CASINO BOSS → defense_look (a skin is never put on from the browser)', (await putO([sl(2, 'bruno', 'fortress', FIGHTERS.bruno.defaultDeck, true, skinB)])).j?.code === 'defense_look');
  // OWN buys it (a test-env right, as the payment would write it) and wears it — the wardrobe choice is in the cloud save
  await admin.collection('shop_entitlements').create({ user: OWN.id, sku: 'skin_' + skinB, item: skinB, kind: 'skin', source: 'support', env: 'test', status: 'active', grantedAt: clock });
  check('with the right: BRUNO defends in CASINO BOSS (saved, shown in the studio)', (await putO([sl(2, 'bruno', 'fortress', FIGHTERS.bruno.defaultDeck, true, skinB)])).j?.defense?.[0]?.look === skinB);
  check('a skin made for another fighter (NEON RUNNER on BRUNO) or never bought (NEON RUNNER on RAY) → defense_look', (await putO([sl(2, 'bruno', 'fortress', FIGHTERS.bruno.defaultDeck, true, 'ray_neon_runner')])).j?.code === 'defense_look' && (await putO([sl(1, 'ray', 'assault', FIGHTERS.ray.defaultDeck, true, 'ray_neon_runner')])).j?.code === 'defense_look');
  const ms = await startR({ arena: 'casino' });
  const msm = ms.j.match;
  check('the rival\'s match against that defence carries BRUNO in CASINO BOSS — the look the rival\'s game draws (poster, fight)', msm.opponent.name === 'SkinOwner' && msm.defender.fighter === 'bruno' && msm.defender.look === skinB && leagueLook(msm.defender.fighter, msm.defender.look) === skinB);
  check('the skin is the owner\'s cosmetic only — the rival gets no right to it (its own defence with it → defense_look)', (await call(RIV, 'PUT', '/api/prime/league/defense', { slots: [sl(1, 'bruno', 'balance', FIGHTERS.bruno.defaultDeck, true, skinB)] })).j?.code === 'defense_look');
  await putO([sl(2, 'bruno', 'fortress')]);
  const ms2 = (await call(RIV, 'GET', `/api/prime/league/match/${msm.id}`)).j.match;
  check('the look is frozen in the match: OWN takes the skin off after the start — the rival\'s match still shows CASINO BOSS', ms2.defender.look === skinB);
  const ts = botTaps(snapFrom(msm), 0.3);
  const fs2 = await play(RIV, msm, ts);
  check('looks only: the server\'s result with the skin = the game\'s replay without it (same hash)', fs2.r.j.match.result?.hash === fs2.out.hash && replayLeague({ ...snapFrom(msm), defender: { ...msm.defender, look: undefined } }, ts).hash === fs2.out.hash);
  await putO([sl(2, 'bruno', 'fortress', FIGHTERS.bruno.defaultDeck, true, skinB)]);
  const ent = (await admin.collection('shop_entitlements').getFullList({ filter: `user = "${OWN.id}" && sku = "skin_${skinB}"` }))[0];
  await admin.collection('shop_entitlements').update(ent.id, { status: 'revoked', revokedAt: clock, revokeReason: 'test_refund' });
  const meRev = await call(OWN, 'GET', '/api/prime/league/me');
  const mr = (await startR()).j.match;
  check('the right revoked (a refund): the studio says so (defense_look), BRUNO still defends — in his own look', meRev.j.defense[0].problem === 'defense_look' && mr.opponent.kind === 'player' && mr.defender.fighter === 'bruno' && !mr.defender.look && leagueLook('bruno', mr.defender.look) === 'bruno');
  await quit(RIV, mr);
  check('the rival\'s game falls back to the fighter\'s own look for a skin it does not know or that is not the fighter\'s', leagueLook('bruno', 'bruno_future_skin') === 'bruno' && leagueLook('bruno', 'ray_neon_runner') === 'bruno' && leagueLook('ray', null) === 'ray' && leagueLook('ray', 'ray_neon_runner') === 'ray_neon_runner');
  check('the attacker\'s side carries no look at all — the attacker\'s own game draws its own wardrobe', !('look' in msm.attacker));
  await call(B, 'POST', '/api/prime/league/defense/toggle', { on: true });

  section('Сервер: улучшения бойцов (флаг) и выключенная лига');
  check('upgrades are off by default (404 upgrades_off) — no level counts in a fight', (await call(A, 'POST', '/api/prime/league/upgrade', { fighter: 'ray', op: op() })).j?.code === 'upgrades_off');
  await restart({ PRIME_LEAGUE_UPGRADES: 'on' });
  const tok = (await prof(A)).tokens;
  const same = op();
  const ups = await Promise.all([0, 1, 2].map(() => call(A, 'POST', '/api/prime/league/upgrade', { fighter: 'ray', op: same })));
  check(`with the flag: level 1 for ${LM.upgradeCost(0)} tokens; three taps of one request → one level, one charge`, ups.filter((r) => r.j.ok && !r.j.duplicate).length === 1 && (await prof(A)).tokens === tok - LM.upgradeCost(0));
  const lvl = await Promise.all([0, 1, 2, 3, 4, 5].map(() => call(A, 'POST', '/api/prime/league/upgrade', { fighter: 'ray', op: op() })));
  check('parallel purchases never take the balance below zero', (await prof(A)).tokens >= 0 && lvl.every((r) => r.status === 200 || r.j?.code === 'not_enough_tokens'));
  const mU = (await startA()).j.match;
  check('with upgrades on, a fight carries the levels as HP / damage multipliers fixed in the snapshot', mU.attacker.level >= 1 && mU.hpMult[0] > 1);
  await call(A, 'POST', `/api/prime/league/match/${mU.id}/finish`, { inputs: [[0, -1]] });
  // hotfix: with PRIME_LEAGUE_TOKENS off a passed challenge promotes but pays nothing and writes no ledger row
  await restart({ PRIME_LEAGUE_TOKENS: '' });
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const pT = await prof(A);
  const chBefore = (await chRows()).length;
  await admin.collection('league_profiles').update(pT.id, { rp: 699, floor: 300, challenge: { to: 2, wins: 2, losses: 0, since: clock } });
  let passedOff: any = null;
  for (let i = 0; i < 10 && !passedOff; i++) {
    const m = (await startA({ mode: 'challenge' })).j.match;
    const w = m ? winningTaps(snapFrom(m)) : null;
    if (!w) {
      if (m) await admin.collection('league_matches').update(m.id, { status: 'void' });
      continue;
    }
    const { r } = await play(A, m, w);
    if (r.j.match?.outcome === 'win') passedOff = r;
  }
  check('hotfix: PRIME_LEAGUE_TOKENS off — a passed challenge still promotes, pays no tokens, writes no ledger row', !!passedOff && passedOff.j.profile?.rank?.index === 2 && passedOff.j.match.tokens === 0 && (passedOff.j.match.result?.challengeTokens ?? 0) === 0 && (await chRows()).length === chBefore && (await prof(A)).tokens === pT.tokens, JSON.stringify({ ok: !!passedOff, tokens: passedOff?.j.match.tokens, rank: passedOff?.j.profile?.rank?.index }));
  await restart({ PRIME_LEAGUE: 'off' });
  const off = await call(A, 'GET', '/api/prime/league/me');
  const offCfg = await call(null, 'GET', '/api/prime/config');
  check('PRIME_LEAGUE=off: every league route answers 404 league_off; the config says off; nothing else changes (the shop, the producer look)', off.j?.code === 'league_off' && offCfg.j.league.on === false && (await call(A, 'GET', '/api/prime/shop/status')).status === 200 && (await call(A, 'GET', '/api/prime/producer')).status === 200);
  await restart({ PRIME_LEAGUE_SEASON_START: '' });
  const pre = await call(A, 'GET', '/api/prime/league/me');
  check('without PRIME_LEAGUE_SEASON_START the server stays in the pre-season (season 0, no end date) — a late launch never starts a season in the past', pre.j.season.number === 0 && pre.j.season.end === null);
  await restart();
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  await admin.collection('users').delete(B.id);
  check('a deleted PRIME ID takes its league rows and producer look with it; other players\' fights against it stay in their history', (await admin.collection('league_defense').getFullList({ filter: `owner = "${B.id}"` })).length === 0 && (await admin.collection('producer_looks').getFullList({ filter: `owner = "${B.id}"` })).length === 0 && (await admin.collection('league_matches').getFullList({ filter: `defOwner = "${B.id}"` })).length > 0);


  section('Сервер: лимиты частоты — общий IP, аккаунт, гости (hotfix)');
  const rule = st.rules.find((r: any) => r.label === '/api/prime/league/');
  check('the league has its own per-IP bucket for signed-in players (180 a minute), apart from /api/prime/ (60) — guests stay under the strict one', rule?.audience === '@auth' && rule?.maxRequests === 180 && st.rules.some((r: any) => r.label === '/api/prime/' && r.maxRequests === 60 && r.audience === ''));
  const crowd: User[] = [A, C];
  for (let i = 0; i < 3; i++) {
    const u = await register(`Nat${i}Show`, `nat${i}@league.test`);
    await call(u, 'POST', '/api/prime/league/join', { accept: true, rules: 1 });
    crowd.push(u);
  }
  await admin.settings.update({ rateLimits: { enabled: true, rules: st.rules } }); // the REAL limits from here on
  await restart({ PRIME_LEAGUE_BUDGET_SCALE: '1' }); // …and the real per-account budget (fresh counters)
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const tally = (xs: number[]) => Object.entries(xs.reduce((m: Record<string, number>, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).map(([k, v]) => `${k}×${v}`).join(' ');
  // five honest players behind one address: 25 league requests each within a minute (125 — the old shared 60 refused half)
  const honest = (await Promise.all(crowd.map(async (u) => {
    const out: number[] = [];
    for (let i = 0; i < 25; i++) out.push((await call(u, 'GET', i % 2 ? '/api/prime/league/me' : '/api/prime/league/board')).status);
    return out;
  }))).flat();
  const cloudMeanwhile = await call(A, 'GET', '/api/prime/me');
  check(`5 accounts on one IP, ${honest.length} league requests within a minute: no 429 (${tally(honest)}); PRIME CLOUD of the same address meanwhile ${cloudMeanwhile.status}`, honest.every((x) => x === 200) && cloudMeanwhile.status === 200);
  await sleep(61000);
  // one account floods: its own budget (90 a minute) stops it alone, with Retry-After; another account is not touched
  const flood: number[] = [];
  let retryAfter = '';
  let floodCode = '';
  for (let i = 0; i < 100; i++) {
    const r = await fetch(API + '/api/prime/league/me', { headers: { Authorization: A.token } });
    flood.push(r.status);
    if (r.status === 429 && !retryAfter) {
      retryAfter = r.headers.get('retry-after') ?? '';
      floodCode = ((await r.json()) as any).code;
    }
  }
  const bystander = await call(C, 'GET', '/api/prime/league/me');
  check(`one account flooding the league: 90 answered, then 429 ${floodCode} with Retry-After ${retryAfter} s (${tally(flood)}); another account on the same IP still 200`, flood.slice(0, 90).every((x) => x === 200) && flood.slice(90).every((x) => x === 429) && floodCode === 'too_many_requests' && Number(retryAfter) > 0 && bystander.status === 200);
  // writes have a smaller budget (defence, deck, toggles): 20 a minute
  const writes: number[] = [];
  for (let i = 0; i < 24; i++) writes.push((await call(C, 'PUT', '/api/prime/league/deck', { fighter: 'vega', deck: FIGHTERS.vega.defaultDeck })).status);
  check(`league writes: 20 a minute per account, then 429 (${tally(writes)})`, writes.slice(0, 20).every((x) => x === 200) && writes.slice(20).every((x) => x === 429));
  // the address as a whole still has a ceiling (180 a minute of signed-in league traffic) — a forged X-Forwarded-For does not escape it
  const crowdLoad = (await Promise.all(crowd.slice(1).map(async (u) => {
    const out: string[] = [];
    for (let i = 0; i < 30; i++) {
      const r = await fetch(API + '/api/prime/league/board', { headers: { Authorization: u.token, 'X-Forwarded-For': `203.0.113.${i}` } });
      const j: any = await r.json().catch(() => ({}));
      out.push(r.status === 429 ? `429:${j.code ?? j.message ?? ''}` : String(r.status));
    }
    return out;
  }))).flat();
  const ipCut = crowdLoad.filter((x) => /^429:(rate_limited|Too Many Requests)/i.test(x) || x === '429:').length;
  check(`the per-IP ceiling holds (${crowdLoad.length} more league requests from that address, a forged X-Forwarded-For on each): ${ipCut} refused by the address limit`, ipCut > 0 && !crowdLoad.includes('500'), [...new Set(crowdLoad)].join(' '));
  // guests: every league route needs a sign-in, and a guest flood stays under the strict /api/prime/ rule
  await sleep(61000);
  const guests: number[] = [];
  for (let i = 0; i < 70; i++) guests.push((await call(null, 'GET', '/api/prime/league/me')).status);
  check(`a guest flood on league routes: 401, then 429 at the strict shared rule (${tally(guests)}) — never 200`, guests.includes(401) && guests.includes(429) && !guests.includes(200) && guests.filter((x) => x === 401).length <= 60);}

// =============================================================== 4. the migration over a 1.8.9.5 database
function migrationChecks(): void {
  section('Миграция: поверх базы 1.8.9.5, повтор, откат');
  if (!binariesReady()) {
    check('PocketBase installed for the migration checks', false);
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-league-mig-'));
  const old = path.join(dir, 'migrations-1895');
  fs.mkdirSync(old);
  for (const f of fs.readdirSync(MIGRATIONS)) if (f.endsWith('.js') && f !== '1793100000_prime_league.js' && f !== '1793200000_prime_producer.js' && f !== '1793300000_prime_league_limits.js') fs.copyFileSync(path.join(MIGRATIONS, f), path.join(old, f));
  const hooks = path.join(dir, 'nohooks');
  fs.mkdirSync(hooks);
  const data = path.join(dir, 'pb_data');
  const pbCli = (migs: string, ...args: string[]) => {
    const r = cp.spawnSync(PB_BIN, [...args, `--dir=${data}`, `--migrationsDir=${migs}`, `--hooksDir=${hooks}`], { encoding: 'utf8', input: 'y\n' });
    return String(r.stdout) + String(r.stderr);
  };
  const sql = (q: string) => String(cp.spawnSync('/usr/bin/sqlite3', [path.join(data, 'data.db'), q], { encoding: 'utf8' }).stdout).trim();
  try {
    pbCli(old, 'migrate', 'up');
    // a 1.8.9.5 database with an account, its profile, cloud save, history, a consent, an order and a paid right
    sql(`insert into users (id, email, password, tokenKey, verified) values ('u1895aaaaaaaaaa', 'old@league.test', 'x', 'k', 1);
      insert into profiles (id, user, nickname, nicknameKey) values ('p1895aaaaaaaaaa', 'u1895aaaaaaaaaa', 'OldStar', 'oldstar');
      insert into saves (id, owner, data, schema, hash, revision) values ('s1895aaaaaaaaaa', 'u1895aaaaaaaaaa', '{"version":12}', 12, '${'a'.repeat(64)}', 7);
      insert into save_history (id, owner, data, schema, hash, revision, reason) values ('h1895aaaaaaaaaa', 'u1895aaaaaaaaaa', '{"version":12}', 12, '${'b'.repeat(64)}', 6, 'push');
      insert into consents (id, user, doc, version) values ('c1895aaaaaaaaaa', 'u1895aaaaaaaaaa', 'terms', 5);
      insert into shop_orders (id, user, sku, env, status, amountKop) values ('o1895aaaaaaaaaa', 'u1895aaaaaaaaaa', 'fx_prime_broadcast', 'live', 'fulfilled', 4900);
      insert into shop_entitlements (id, user, sku, env, status) values ('e1895aaaaaaaaaa', 'u1895aaaaaaaaaa', 'fx_prime_broadcast', 'live', 'active');`);
    const print = () => [dbFingerprint(path.join(data, 'data.db')), sql('select * from consents order by id;'), sql('select * from shop_orders order by id;'), sql('select * from shop_entitlements order by id;')].join('\n');
    const leagueTables = () => String(Number(sql("select count(*) from sqlite_master where type='table' and name like 'league_%';")) + (sql("select count(*) from sqlite_master where type='table' and name='producer_looks';") === '1' ? 100 : 0));
    const leagueRule = () => sql("select value from _params where id='settings';").includes('/api/prime/league/');
    const before = print();
    check('a 1.8.9.5 database (an account, save, history, consent, LIVE order, paid right) has no league or producer tables', leagueTables() === '0' && before.includes('fx_prime_broadcast'));
    const up = pbCli(MIGRATIONS, 'migrate', 'up');
    check('the 1.9.0 migrations apply on top: 8 league tables + producer_looks + the league rate-limit rule; accounts, saves, consents, orders and rights byte-for-byte the same', /1793100000_prime_league/.test(up) && /1793200000_prime_producer/.test(up) && /1793300000_prime_league_limits/.test(up) && leagueTables() === '108' && leagueRule() && print() === before);
    const again = pbCli(MIGRATIONS, 'migrate', 'up');
    check('running the migrations again changes nothing (no new migration, the same data)', !/1793100000_prime_league|1793200000_prime_producer|1793300000_prime_league_limits/.test(again) && print() === before && leagueTables() === '108');
    let down = '';
    for (let i = 0; i < 5 && !/Reverted 1793100000_prime_league/.test(down); i++) down += pbCli(MIGRATIONS, 'migrate', 'down', '1');
    check('rolled back: the league rate-limit rule, the producer and league tables go, nothing of 1.8.9.5 changes', /Reverted 1793300000_prime_league_limits/.test(down) && /Reverted 1793200000_prime_producer/.test(down) && /Reverted 1793100000_prime_league/.test(down) && leagueTables() === '0' && !leagueRule() && print() === before);
    pbCli(MIGRATIONS, 'migrate', 'up');
    check('…and forward again: the league and producer tables and the rule are back, the old data the same', leagueTables() === '108' && leagueRule() && print() === before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  rulesChecks();
  fightChecks();
  migrationChecks();
  try {
    await serverChecks();
  } catch (e) {
    check('server checks ran to the end', false, String((e as Error)?.stack ?? e).slice(0, 600) + '\n' + pbLog.slice(-12).join('\n'));
  } finally {
    if (pb) await stopChild(pb);
    await sleep(200);
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`\n${failed ? `league: FAILED (${passed} passed, ${failed} failed)` : `league: OK (${passed} passed, 0 failed)`} — временная база удалена`);
  proc.exitCode = failed ? 1 : 0;
}

void main();
