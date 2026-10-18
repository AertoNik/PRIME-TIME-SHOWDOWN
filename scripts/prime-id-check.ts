// Headless checks for Alpha 1.8 — PRIME ID & SAVE FOUNDATION (npm run primeid).
// The local save: migration of every schema (reproducible fixtures built from each version's
// format — not real players' files), a damaged save kept aside, a newer schema never written
// over, safety copies, export/import, one tab per profile, no storage at all. The win streaks:
// where they count, reset and keep their records, per fighter and for the producer, and that
// Survival waves, the tutorial and repeated calls never count twice. The PRIME ID figures:
// computed from the career data without changing it. In-memory storage, fake clock, no browser.
import { CAREER_START } from '../src/config/career';
import { NEW_CARDS } from '../src/config/cards';
import { FIGHTERS, FIGHTER_ORDER } from '../src/config/fighters';
import { APP_VERSION } from '../src/config/version';
import type { MatchResultData } from '../src/combat/types';
import { CareerSystem } from '../src/meta/CareerSystem';
import { EventManager } from '../src/meta/EventManager';
import { GameModes } from '../src/meta/GameModes';
import { MAX_BACKUPS, SaveSystem, VERSION, defaultSave, profileKeys, sanitize, type SaveData, type SaveStorage } from '../src/meta/SaveSystem';
import { LOCK_STALE_MS, TabLock } from '../src/meta/TabLock';
import { buildProfile, hallOfFame, winRate } from '../src/meta/ProducerProfile';

interface Fs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
const { readFileSync } = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process.getBuiltinModule('node:fs') as Fs;

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const KEYS = profileKeys('guest');

class MemoryStorage implements SaveStorage {
  map = new Map<string, string>();
  writes = 0;
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.writes++;
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}
/** A browser that refuses storage altogether (old private modes, blocked site data). */
class DeniedStorage implements SaveStorage {
  getItem(): string | null {
    throw new Error('denied');
  }
  setItem(): void {
    throw new Error('denied');
  }
  removeItem(): void {
    throw new Error('denied');
  }
}

let now = Date.parse('2026-10-28T12:00:00Z');
const clock = () => now;
const open = (st: SaveStorage, lock: TabLock | null = null) => new SaveSystem({ storage: st, lock, clock });
const stored = (st: MemoryStorage, key = KEYS.save) => JSON.parse(st.getItem(key) ?? 'null');

// --------------------------------------------------------------- fixtures
/**
 * An Alpha 1.7.6 career (schema 11 with the 1.6.5 tutorial flag and the 1.7 LUCIEN purchase):
 * every kind of progress the game keeps. Built from the save format, not taken from a player.
 */
function save176(): Record<string, any> {
  const t0 = Date.parse('2026-10-24T18:30:00Z');
  const fp = (unlocked: boolean, fans: number, wins: number, losses: number, draws: number, classicWins: number, bestRating: number, deck: string[]) => ({ unlocked, fans, wins, losses, draws, matches: wins + losses + draws, classicWins, bestRating, deck });
  return {
    version: 11,
    orgName: 'MIDNIGHT ROCKET STUDIO',
    money: 12345,
    reputation: 1850,
    matches: 140,
    wins: 96,
    losses: 40,
    draws: 4,
    bestRating: 97,
    totalEarned: 88000,
    fansEarned: 26000,
    bestCombosInMatch: 7,
    bestPerfectsInMatch: 5,
    proWins: 40,
    championWins: 12,
    fighters: {
      ray: fp(true, 9000, 40, 15, 1, 30, 97, ['dash', 'power_shot', 'second_take', 'split_shot']),
      bruno: fp(true, 6100, 20, 9, 1, 18, 88, ['shield', 'power_shot', 'overdrive', 'knockout']),
      nika: fp(true, 5200, 14, 8, 1, 12, 90, ['shock', 'power_shot', 'smoke', 'system_overload']),
      vega: fp(true, 4300, 10, 4, 1, 8, 92, ['dash', 'power_shot', 'backtrack', 'charged_shot']),
      kai: fp(true, 2500, 6, 2, 0, 6, 85, ['dash', 'shield', 'overdrive', 'bank_shot']),
      rina: fp(false, 1800, 0, 0, 0, 0, 0, ['dash', 'shield', 'smoke', 'false_start']),
      lucien: fp(true, 2600, 6, 2, 0, 5, 88, ['dash', 'shield', 'overdrive', 'bat_bite']),
    },
    selected: 'lucien',
    difficulty: 'champion',
    goals: { first_win: { done: true, claimed: true }, combo_3: { done: true, claimed: true }, rating_70: { done: true, claimed: false }, sign_second: { done: true, claimed: true } },
    settings: { sound: false, music: true, quality: 'low', camera: 'reduced' },
    nextRival: 'zoe',
    lastRival: 'tank',
    seed: 424242,
    hintsSeen: true,
    events: {
      'halloween-2026': {
        tokens: 120,
        earned: 720,
        spent: 600,
        quests: { first_night: { p: 3, claimed: true }, combo_carnival: { p: 10, claimed: false } },
        bought: ['card_pumpkin', 'dash_phantom'],
        fighters: [{ id: 'lucien', at: t0 }],
        grandClaimed: false,
        day: '2026-10-25',
        dayTokens: 34,
      },
    },
    cosmetics: {
      owned: ['title_prime_legend', 'card_pumpkin', 'dash_phantom', 'title_prime_star'],
      equipped: { cardStyle: 'card_pumpkin', dashFx: 'dash_phantom', title: 'title_prime_star' },
      history: [
        { id: 'title_prime_legend', event: 'boss-vale', at: t0 - 9e8, fighter: 'ray' },
        { id: 'title_prime_star', event: 'career-star', at: t0 - 5e8 },
        { id: 'card_pumpkin', event: 'halloween-2026', at: t0 - 2e8 },
        { id: 'dash_phantom', event: 'halloween-2026', at: t0 - 1e8 },
      ],
      seen: ['title_prime_legend', 'card_pumpkin'],
      personal: { title_prime_legend: ['ray', 'vega'] },
      personalEquipped: { ray: { title: 'title_prime_legend' } },
      unassigned: [],
    },
    modes: {
      survival: { runs: 9, completions: 2, bestWave: 5, bestScore: 420, recordAt: t0 - 3e8, recordFighter: 'ray', bestByFighter: { ray: 5, bruno: 3 }, firstClearPaid: true, active: null },
      challenges: { energy_rush: { attempts: 4, clears: 2, firstClearAt: t0 - 6e8, best: 9, bestAt: t0 - 6e8, bestFighter: 'nika' } },
      boss: {
        vale: {
          attempts: 12,
          wins: 3,
          firstWinAt: t0 - 9e8,
          bestTime: 71.5,
          bestRating: 91,
          bestPhase: 3,
          bestBossHp: 0,
          bestFighter: 'ray',
          winsByFighter: { ray: 2, vega: 1 },
          history: [{ at: t0 - 9e8, fighter: 'ray', won: true, time: 71.5, rating: 91, phase: 3, bossHp: 0 }],
        },
      },
    },
    arena: 'graveyard',
    careerClaimed: ['rookie', 'rising'],
    cards: { owned: ['second_take', 'split_shot', 'backtrack'] },
    tutorial: 'done',
  };
}

/** The same career a version earlier: drop what that version did not have yet. */
function older(version: number): Record<string, any> {
  const s = save176();
  s.version = version;
  if (version <= 10) {
    // 1.6: before 1.6.1 the SECOND TAKE card was SIDE CAM; before 1.6.5 / 1.7 no tutorial flag, no LUCIEN
    delete s.tutorial;
    delete s.fighters.lucien;
    s.selected = 'ray';
    delete s.events['halloween-2026'].fighters;
    s.cards.owned = ['side_cam', 'split_shot', 'backtrack'];
    s.fighters.ray.deck = ['dash', 'power_shot', 'side_cam', 'split_shot'];
  }
  if (version <= 9) {
    // 1.5.5: no card shop yet — decks of the basic six and the signature only
    delete s.cards;
    s.fighters.ray.deck = ['dash', 'power_shot', 'shield', 'adrenaline'];
    s.fighters.vega.deck = ['dash', 'power_shot', 'shield', 'charged_shot'];
  }
  if (version <= 8) {
    // 1.5: personal rewards were common items
    delete s.cosmetics.personal;
    delete s.cosmetics.personalEquipped;
    delete s.cosmetics.unassigned;
    s.cosmetics.equipped.title = 'title_prime_legend';
  }
  if (version <= 7) {
    // 1.4: no Kai and Rina, no "seen" marks, no career stages
    delete s.fighters.kai;
    delete s.fighters.rina;
    delete s.cosmetics.seen;
    delete s.careerClaimed;
    s.cosmetics.owned = ['title_prime_legend', 'card_pumpkin', 'dash_phantom'];
    s.cosmetics.history = s.cosmetics.history.filter((h: { id: string }) => h.id !== 'title_prime_star');
    s.cosmetics.equipped = { cardStyle: 'card_pumpkin', dashFx: 'dash_phantom', title: 'title_prime_legend' };
    s.modes.survival.active = { id: 77, fighter: 'bruno', deck: ['shield', 'power_shot', 'overdrive', 'knockout'], rivals: ['dex', 'tank', 'zoe', 'crash', 'dex'], wave: 2, hpFrac: 0.6, perks: { second_wind: 1, energy_boost: 0, power_surge: 0 }, waves: [], pendingPerk: false, eventId: null, startedAt: 1, arena: 'casino' };
  }
  if (version <= 6) {
    delete s.arena;
    delete s.modes.survival.active.arena;
  }
  if (version <= 5) for (const f of Object.values(s.fighters) as { classicWins?: number }[]) delete f.classicWins;
  if (version <= 4) delete s.modes.boss;
  if (version <= 3) delete s.modes;
  if (version <= 2) {
    delete s.events;
    delete s.cosmetics;
  }
  if (version <= 1) delete s.settings.camera;
  return s;
}

function loadRaw(raw: unknown): { sys: SaveSystem; st: MemoryStorage } {
  const st = new MemoryStorage();
  st.setItem(KEYS.save, typeof raw === 'string' ? raw : JSON.stringify(raw));
  st.writes = 0;
  return { sys: open(st), st };
}

// ------------------------------------------- 1, 3–8: the Alpha 1.7.6 career
{
  const raw = save176();
  const { sys, st } = loadRaw(raw);
  const d = sys.data;
  check(`1.7.6 save loads: schema ${sys.loadedVersion} → current ${VERSION}, status ${sys.status}`, sys.loadedVersion === 11 && VERSION === 12 && sys.status === 'ok' && sys.writable);
  const keepTop = ['orgName', 'money', 'reputation', 'matches', 'wins', 'losses', 'draws', 'bestRating', 'totalEarned', 'fansEarned', 'bestCombosInMatch', 'bestPerfectsInMatch', 'proWins', 'championWins', 'selected', 'difficulty', 'nextRival', 'lastRival', 'seed', 'hintsSeen', 'arena', 'careerClaimed', 'tutorial'] as const;
  check('1.7.6: money, reputation, statistics, studio name, selection and arena kept exactly', keepTop.every((k) => same(d[k], raw[k])));
  const fighterKeys = ['unlocked', 'fans', 'wins', 'losses', 'draws', 'matches', 'classicWins', 'bestRating', 'deck'] as const;
  check('1.7.6: every fighter keeps unlock, fans, record and deck', FIGHTER_ORDER.every((id) => fighterKeys.every((k) => same(d.fighters[id][k], raw.fighters[id][k]))));
  check('LUCIEN: still opened (roster + the Halloween exchange record with its date)', d.fighters.lucien.unlocked && same(d.events['halloween-2026'].fighters, raw.events['halloween-2026'].fighters) && d.selected === 'lucien');
  check('cards: bought cards and custom decks kept (SECOND TAKE, SPLIT SHOT, BACKTRACK in decks)', same(d.cards.owned, NEW_CARDS.filter((c) => raw.cards.owned.includes(c))) && same(d.fighters.ray.deck, raw.fighters.ray.deck) && same(d.fighters.vega.deck, raw.fighters.vega.deck));
  check('collection: cosmetics, titles, history, "seen" marks and personal rewards kept', same(d.cosmetics, raw.cosmetics));
  check('seasonal: Halloween Premiere tokens, quests, exchange purchases and daily cap kept', same(d.events, raw.events));
  check('modes: Survival records, Prime Challenge and Boss Fight progress kept', same(d.modes, raw.modes));
  check('settings kept (sound, music, quality, camera)', same(d.settings, raw.settings));
  check('v12 fields appear: producer and fighter streaks start at 0, tracking from now', d.streak.current === 0 && d.streak.best === 0 && d.streak.since > 0 && FIGHTER_ORDER.every((id) => d.fighters[id].streak === 0 && d.fighters[id].bestStreak === 0));
  const b = sys.backups();
  check('migration: the original v11 text is kept as a safety copy before the first v12 write', b.length === 1 && b[0].reason === 'migration' && b[0].raw === JSON.stringify(raw) && b[0].summary.version === 11);
  check('loading alone writes nothing over the save (only its safety copy and the device id)', st.getItem(KEYS.save) === JSON.stringify(raw));
  sys.save();
  const again = open(st);
  check('after the first write: schema 12 on disk, the same career when loaded again', stored(st).version === 12 && again.loadedVersion === 12 && same({ ...again.data, streak: null }, { ...d, streak: null }) && again.data.streak.since === d.streak.since);
}

// --------------------------------------------- 2: every historical schema
{
  const results: string[] = [];
  let allOk = true;
  for (let v = 10; v >= 1; v--) {
    const raw = older(v);
    const { sys } = loadRaw(raw);
    const d = sys.data;
    const ok: Record<string, boolean> = {
      money: d.money === raw.money && d.reputation === raw.reputation && d.wins === raw.wins && d.matches === raw.matches,
      fighters: Object.keys(raw.fighters).every((id) => d.fighters[id as 'ray'].unlocked === raw.fighters[id].unlocked && d.fighters[id as 'ray'].fans === raw.fighters[id].fans && d.fighters[id as 'ray'].wins === raw.fighters[id].wins),
      lucien: !d.fighters.lucien.unlocked && d.fighters.lucien.deck.join() === FIGHTERS.lucien.defaultDeck.join(),
      schema: sys.status === 'ok' && sys.loadedVersion === v && d.version === 12,
      streak: d.streak.current === 0 && d.streak.best === 0,
      backup: sys.backups()[0]?.reason === 'migration',
    };
    if (v === 10) ok.v11 = d.cards.owned.includes('second_take') && !d.cards.owned.includes('side_cam' as never) && d.fighters.ray.deck.join() === 'dash,power_shot,second_take,split_shot' && d.tutorial === 'veteran';
    if (v === 9) ok.v10 = d.cards.owned.length === 0 && d.fighters.ray.deck.join() === 'dash,power_shot,shield,adrenaline';
    if (v === 8) ok.v9 = same(d.cosmetics.personal.title_prime_legend, ['ray', 'vega']) && d.cosmetics.personalEquipped.ray?.title === 'title_prime_legend' && d.cosmetics.equipped.title === undefined;
    if (v === 7) ok.v8 = same(d.cosmetics.seen, d.cosmetics.owned) && d.careerClaimed.length === 0 && !d.fighters.kai.unlocked && d.modes.survival.active?.arena === 'casino' && d.modes.survival.active?.wave === 2;
    if (v === 6) ok.v7 = d.arena === 'original' && d.modes.survival.active?.arena === 'original';
    if (v === 5) ok.v6 = d.fighters.ray.classicWins === raw.fighters.ray.wins - 2 && d.fighters.vega.classicWins === raw.fighters.vega.wins - 1;
    if (v === 4) ok.v5 = Object.keys(d.modes.boss).length === 0 && d.modes.survival.bestWave === 5;
    if (v === 3) ok.v4 = d.modes.survival.runs === 0 && d.events['halloween-2026'].tokens === 120;
    if (v === 2) ok.v3 = Object.keys(d.events).length === 0 && d.cosmetics.owned.length === 0 && d.settings.camera === 'reduced';
    if (v === 1) ok.v2 = d.settings.camera === 'full' && d.settings.quality === 'low' && d.settings.sound === false;
    const bad = Object.entries(ok).filter(([, p]) => !p).map(([k]) => k);
    results.push(`v${v}${bad.length ? ' ✗ ' + bad.join(',') : ''}`);
    allOk &&= bad.length === 0;
  }
  check(`schemas 1–10 (fixtures of each version's format) load without losing progress: ${results.join(' · ')}`, allOk);
}

// ----------------------------------------------------- 9–12: win streaks
const res = (o: Partial<MatchResultData> = {}): MatchResultData =>
  ({ outcome: 'win', method: 'ko', rating: 70, peakRating: 80, avgRating: 60, bestCombo: null, combos: 1, comboList: [], perfects: 0, damageDealt: 1000, damageTaken: 500, cardsUsed: 3, duration: 60, playerHpFrac: 0.5, enemyHpFrac: 0, finisher: null, ...o }) as MatchResultData;
function career(data?: SaveData): { sys: SaveSystem; career: CareerSystem; st: MemoryStorage } {
  const st = new MemoryStorage();
  const sys = open(st);
  if (data) sys.data = data;
  for (const id of FIGHTER_ORDER) sys.data.fighters[id].unlocked = true;
  return { sys, career: new CareerSystem(sys), st };
}
{
  const { sys, career: c } = career();
  const d = sys.data;
  for (let i = 0; i < 4; i++) c.applyMatch(res(), 'ray', 'pro', 'dex', { classic: true });
  for (let i = 0; i < 2; i++) c.applyMatch(res(), 'nika', 'pro', 'dex', { classic: true });
  check(`streaks: Ray wins 4, then Nika 2 → producer ${d.streak.current} (record ${d.streak.best}), Ray ${d.fighters.ray.streak}, Nika ${d.fighters.nika.streak}`, d.streak.current === 6 && d.streak.best === 6 && d.fighters.ray.streak === 4 && d.fighters.nika.streak === 2);
  c.applyMatch(res({ outcome: 'loss', method: 'ko' }), 'nika', 'pro', 'dex', { classic: true });
  check(`streaks: Nika loses → producer 0 (record stays ${d.streak.best}), Nika 0 (record ${d.fighters.nika.bestStreak}), Ray still 4`, d.streak.current === 0 && d.streak.best === 6 && d.fighters.nika.streak === 0 && d.fighters.nika.bestStreak === 2 && d.fighters.ray.streak === 4 && d.fighters.ray.bestStreak === 4);
  c.applyMatch(res(), 'ray', 'pro', 'dex', { classic: true });
  check('streaks: Ray\'s next win continues his own run (5) while the producer starts again (1)', d.fighters.ray.streak === 5 && d.fighters.ray.bestStreak === 5 && d.streak.current === 1 && d.streak.best === 6);
  const losses = d.losses;
  const draws = d.draws;
  c.applyMatch(res({ outcome: 'draw', method: 'time' }), 'ray', 'pro', 'dex', { classic: true });
  check('streaks: a draw ends both runs but is not a loss (draws +1, losses unchanged)', d.streak.current === 0 && d.fighters.ray.streak === 0 && d.fighters.ray.bestStreak === 5 && d.draws === draws + 1 && d.losses === losses);
  c.applyMatch(res({ outcome: 'loss', method: 'forfeit' }), 'bruno', 'pro', 'dex', { classic: true });
  check('streaks: a forfeit counts as the loss it already was', d.streak.current === 0 && d.fighters.bruno.streak === 0 && d.fighters.bruno.losses === 1);
  for (let i = 0; i < 3; i++) c.applyMatch(res(), 'vega', 'champion', 'zoe', { moneyMult: 2, moneyLabel: 'x', rotateRival: false });
  c.applyMatch(res(), 'kai', 'champion', 'vale', { moneyMult: 1.5, moneyLabel: 'x', rotateRival: false });
  check('streaks: Prime Challenge and Boss Fight results count like Classic Duel (they are career matches)', d.streak.current === 4 && d.fighters.vega.streak === 3 && d.fighters.kai.streak === 1);
  check('records never go down; matches = wins + losses + draws for every fighter', d.streak.best >= d.streak.current && FIGHTER_ORDER.every((id) => d.fighters[id].bestStreak >= d.fighters[id].streak && d.fighters[id].matches === d.fighters[id].wins + d.fighters[id].losses + d.fighters[id].draws));
  const st2 = new MemoryStorage();
  sys.save();
  st2.setItem(KEYS.save, JSON.stringify(JSON.parse(JSON.stringify(sys.data))));
  const re = open(st2);
  check('streaks survive a reload (producer current/best/since and every fighter)', same(re.data.streak, d.streak) && FIGHTER_ORDER.every((id) => re.data.fighters[id].streak === d.fighters[id].streak && re.data.fighters[id].bestStreak === d.fighters[id].bestStreak));
  const junk = sanitize({ ...JSON.parse(JSON.stringify(d)), streak: { current: -4, best: 2.7, since: 'x' }, fighters: { ray: { ...d.fighters.ray, streak: 9, bestStreak: 3 } } });
  check('damaged streak values are repaired (no negatives, the record at least the current run)', junk.streak.current === 0 && junk.streak.best === 2 && junk.streak.since > 0 && junk.fighters.ray.streak === 9 && junk.fighters.ray.bestStreak === 9);
}

// -------------------------------------------- 13: nothing counted twice
{
  const { sys, career: c } = career();
  const em = new EventManager(sys, { clock, settings: { mode: 'auto', forcedEventId: 'none' } });
  const modes = new GameModes(sys, c, em, clock);
  const d = sys.data;
  c.applyMatch(res(), 'ray', 'pro', 'dex', { classic: true });
  const before = JSON.stringify({ m: d.matches, w: d.wins, l: d.losses, s: d.streak, f: d.fighters.bruno });
  const run = modes.startRun('bruno', FIGHTERS.bruno.defaultDeck, null, 5, 'original');
  const pick = () => modes.choosePerk(run.id, modes.perkOptions(modes.activeRun!).find((o) => o.available)!.def.id);
  let refused = true;
  for (let i = 0; i < 4; i++) {
    const o = modes.recordWave(run.id, res(), 0.8);
    // the same wave reported again before the bonus is picked is refused
    refused &&= !!o && modes.recordWave(run.id, res(), 0.8) === null;
    pick();
  }
  modes.recordWave(run.id, res({ outcome: 'loss' }), 0);
  const after = JSON.stringify({ m: d.matches, w: d.wins, l: d.losses, s: d.streak, f: d.fighters.bruno });
  check('Survival: waves and the closed marathon leave career matches, wins and streaks alone (as they always left the totals)', before.replace(/"fans":\d+,/, '') === after.replace(/"fans":\d+,/, '') && d.modes.survival.runs === 1 && modes.activeRun === null);
  check('Survival: a wave reported twice is refused, and a closed marathon takes no more results', refused && modes.recordWave(run.id, res(), 0.5) === null);
  modes.recordBoss('vale', res({ outcome: 'win', method: 'ko', bossPhase: 3, enemyHpFrac: 0 }), 'ray');
  check('Boss Fight records do not touch the streak (only the career result does, once)', d.streak.current === 1 && d.fighters.ray.streak === 1);
  const game = readFileSync('src/game/Game.ts', 'utf8');
  const fm = game.slice(game.indexOf('private finishMatch(): void {'));
  check('one place confirms a result: finishMatch runs once per match (resultsShown guard) and applyMatch is called only there', fm.indexOf('this.resultsShown) return;') > 0 && fm.indexOf('this.resultsShown = true;') > 0 && (game.match(/career\.applyMatch\(/g) ?? []).length === 3 && fm.indexOf('career.applyMatch(') > 0);
  check('FIRST BROADCAST leaves finishMatch before any career result (no streak from the tutorial)', fm.indexOf("if (mode.kind === 'tutorial') return;") > 0 && fm.indexOf("if (mode.kind === 'tutorial') return;") < fm.indexOf('career.applyMatch('));
  check('Survival leaves finishMatch before any career result', fm.indexOf("if (mode.kind === 'survival') {") < fm.indexOf('career.applyMatch(') && /if \(mode\.kind === 'survival'\) \{[\s\S]*?return;\s*\}/.test(fm));
}

// --------------------------------------------- 14: a damaged save is kept
{
  const st = new MemoryStorage();
  // a real career first, so there is a safety copy to come back to
  st.setItem(KEYS.save, JSON.stringify(save176()));
  open(st).save(); // migration copy + first v12 write
  const good = st.getItem(KEYS.save)!;
  const broken = good.slice(0, good.length / 2); // truncated write
  st.setItem(KEYS.save, broken);
  const sys = open(st);
  check(`damaged JSON: status "${sys.status}", nothing writable, an empty career only in memory`, sys.status === 'damaged' && !sys.writable && sys.data.matches === 0);
  sys.data.money = 999999;
  sys.save();
  check('damaged JSON: saving does not overwrite it (the broken text stays where it was)', st.getItem(KEYS.save) === broken);
  const q = JSON.parse(st.getItem(KEYS.damaged) ?? '{}');
  check('damaged JSON: the original text is copied into its own record (export / support)', q.raw === broken && sys.damaged === broken && JSON.parse(sys.exportJSON()).damaged === broken);
  const copies = sys.backups();
  check(`damaged JSON: a safety copy is offered (${copies.length}: ${copies.map((c) => c.reason).join(', ')})`, copies.length >= 1);
  const ok = sys.restoreBackup(copies[0].at);
  const back = open(st);
  check('damaged JSON: restoring the copy brings the career back (money, LUCIEN, collection) and its settings (the damaged session only had defaults)', ok && back.status === 'ok' && back.data.money === 12345 && back.data.fighters.lucien.unlocked && back.data.cosmetics.owned.length === 4 && back.data.settings.quality === 'low' && back.data.settings.camera === 'reduced');
  for (const text of ['{"money": 5, "fighters": {', '42', '[1,2,3]', 'null']) {
    const s2 = loadRaw(text);
    if (s2.sys.status !== 'damaged' || s2.st.getItem(KEYS.save) !== text) check(`damaged JSON: "${text}" is treated as damaged`, false);
  }
  check('damaged JSON: truncated text, a number, an array and null are all treated as damaged and left untouched', true);
  const s3 = loadRaw('{oops');
  check('damaged JSON: «start a new career» writes a fresh save; the damaged text stays in its record', s3.sys.startFresh() && stored(s3.st).version === 12 && JSON.parse(s3.st.getItem(KEYS.damaged)!).raw === '{oops');
}

// ----------------------------------------------- 15: safety copies
{
  const st = new MemoryStorage();
  st.setItem(KEYS.save, JSON.stringify({ ...save176(), version: 12 }));
  const a = open(st);
  check('daily copy: a session of a v12 career with no copy yet makes one', a.backups().length === 1 && a.backups()[0].reason === 'auto');
  now += 3600 * 1000;
  open(st);
  check('daily copy: not again within the day', open(st).backups().length === 1);
  now += 21 * 3600 * 1000;
  a.data.money = 500;
  a.save();
  const b = open(st);
  check('daily copy: a session a day later copies the save as it was then', b.backups().length === 2 && b.backups()[0].reason === 'auto' && JSON.parse(b.backups()[0].raw).money === 500);
  const settings = { ...b.data.settings };
  b.data.money = 777;
  b.save();
  b.reset();
  check('reset: the career before the reset is copied first; device settings survive the reset', b.backups()[0].reason === 'reset' && JSON.parse(b.backups()[0].raw).money === 777 && same(b.data.settings, settings) && b.data.money === CAREER_START.money);
  for (let i = 0; i < 5; i++) {
    b.data.matches = 10 + i;
    b.save();
    b.reset();
  }
  const list = b.backups();
  check(`at most ${MAX_BACKUPS} copies, newest first (no endless pile-up)`, list.length === MAX_BACKUPS && list[0].at >= list[1].at && JSON.parse(st.getItem(KEYS.backups)!).length === MAX_BACKUPS);
  const before = b.backups().length;
  const raw = st.getItem(KEYS.save)!;
  (b as unknown as { addBackup(r: string, raw: string): void }).addBackup('auto', raw);
  check('a new career without progress is never copied (nothing worth keeping)', b.backups().length === before);
  const c = loadRaw({ ...save176(), version: 12 }).sys;
  const n0 = c.backups().length;
  (c as unknown as { addBackup(r: string, raw: string): void }).addBackup('auto', c.backups()[0].raw);
  check('the same text is never copied twice in a row', c.backups().length === n0);
}

// ------------------------------------------- export / import (checked first)
{
  const src = loadRaw(save176()).sys;
  src.save();
  const file = src.exportJSON();
  const env = JSON.parse(file);
  check('export: a JSON file with its format, game version, schema and the save exactly as stored', env.format === 'primetime-showdown-save' && env.app === APP_VERSION && env.schema === VERSION && env.save.money === 12345 && env.save.version === 12 && env.profile === 'guest');
  const dst = career().sys; // another career on another "device"
  dst.data.settings.quality = 'high';
  dst.data.matches = 3;
  dst.data.wins = 3;
  dst.save();
  const chk = dst.checkImport(file);
  check('import: the file is read and summarised before anything changes', chk.ok && chk.summary.money === 12345 && chk.summary.matches === 140 && dst.data.matches === 3);
  const applied = chk.ok && dst.applyImport(chk);
  check('import: replaces the progress only when applied; the replaced career is copied first; this device keeps its settings', applied && dst.data.money === 12345 && dst.data.fighters.lucien.unlocked && dst.data.settings.quality === 'high' && dst.backups()[0].reason === 'import' && JSON.parse(dst.backups()[0].raw).matches === 3);
  const reasons = [dst.checkImport('not json'), dst.checkImport('{"hello": 1}'), dst.checkImport(JSON.stringify({ ...save176(), version: 99 })), dst.checkImport('x'.repeat(600 * 1024))];
  check(`import refuses broken, foreign, newer and oversized files (${reasons.filter((r) => !r.ok).length}/4)`, reasons.every((r) => !r.ok));
  const rawImport = dst.checkImport(JSON.stringify(older(6)));
  check('import also accepts a bare save of an older schema (migrated on the way)', rawImport.ok && rawImport.version === 6 && rawImport.data.arena === 'original');
}

// -------------------------------------------- 16: a newer schema
{
  const future = { ...save176(), version: 13, futureCurrency: { gems: 40 }, money: 54321 };
  const text = JSON.stringify(future);
  const { sys, st } = loadRaw(text);
  check(`newer schema (13): status "${sys.status}", the save is shown but not writable`, sys.status === 'newer' && !sys.writable && sys.data.money === 54321 && sys.loadedVersion === 13);
  sys.data.money = 1;
  sys.save();
  sys.reset();
  check('newer schema: nothing writes over it — not a save, not a reset', st.getItem(KEYS.save) === text);
  check('newer schema: the export keeps every field of the newer save (its own fields included)', JSON.parse(sys.exportJSON()).save.futureCurrency.gems === 40);
  const same12 = { ...save176(), version: 12, laterField: 'kept' };
  const k = loadRaw(same12);
  k.sys.data.money += 1;
  k.sys.save();
  check('unknown top-level fields of a save are written back unchanged, not dropped', stored(k.st).laterField === 'kept' && stored(k.st).money === 12346);
}

// --------------------------------------------------- 17: two tabs
{
  const st = new MemoryStorage();
  st.setItem(KEYS.save, JSON.stringify({ ...save176(), version: 12 }));
  const lockA = new TabLock(st, KEYS.lock, clock, 'tab-A');
  const A = open(st, lockA);
  const lockB = new TabLock(st, KEYS.lock, clock, 'tab-B');
  const B = open(st, lockB);
  check('two tabs: the first holds the profile, the second opens passive', !A.passive && A.writable && B.passive && !B.writable);
  A.data.money = 900;
  A.save();
  B.data.money = 1;
  B.save();
  check('two tabs: the passive tab writes nothing over the active one', stored(st).money === 900);
  const backupsBefore = st.getItem(KEYS.backups);
  B.reset();
  check('two tabs: a reset in the passive tab changes nothing (no copy, no wipe — not even in memory)', stored(st).money === 900 && st.getItem(KEYS.backups) === backupsBefore && B.data.matches > 0);
  let lost = 0;
  A.onLockLost = () => lost++;
  B.takeOver();
  A.data.money = 5;
  A.save();
  check('two tabs: «play here» moves the profile; the first tab stops writing at once (and is told)', stored(st).money === 900 && A.passive && lost === 1 && lockB.owns() && !lockA.owns());
  lockA.beat();
  check('two tabs: the heartbeat of the old tab never takes the profile back', lockB.owns() && lost === 1);
  lockB.release();
  check('closing the tab releases the profile', st.getItem(KEYS.lock) === null);
  const st2 = new MemoryStorage();
  const lockC = new TabLock(st2, KEYS.lock, clock, 'tab-C');
  open(st2, lockC);
  now += LOCK_STALE_MS + 1000; // the holder crashed: its heartbeat stops
  const lockD = new TabLock(st2, KEYS.lock, clock, 'tab-D');
  const D = open(st2, lockD);
  check(`a crashed tab's profile is free again after ${LOCK_STALE_MS / 1000} s without a heartbeat`, !D.passive && lockD.owns());
  const lockE = new TabLock(st2, KEYS.lock, clock, 'tab-E');
  lockD.beat();
  const E = open(st2, lockE);
  check('a live heartbeat keeps a new tab passive', E.passive);
}

// --------------------------------------------- 18: no storage at all
{
  const sys = new SaveSystem({ storage: new DeniedStorage(), clock });
  let threw = false;
  try {
    sys.data.money = 10;
    sys.save();
    sys.reset();
    sys.backups();
    sys.exportJSON();
  } catch {
    threw = true;
  }
  check('no storage (private mode / blocked): the game starts with a new career, never throws, reports it', !threw && sys.status === 'unavailable' && !sys.persistent && sys.data.version === 12);
  const none = new SaveSystem({ storage: null, clock });
  check('no localStorage object at all: same, in memory only', none.status === 'unavailable' && !none.persistent);
}

// ------------------------------------------------ 19: device settings
{
  const raw: Record<string, any> = { ...save176(), version: 12 };
  const { sys, st } = loadRaw(raw);
  sys.save();
  check('device settings survive save and reload unchanged', same(open(st).data.settings, raw.settings));
  const copy = sys.backups()[0];
  sys.data.settings.quality = 'high';
  sys.data.settings.sound = true;
  sys.save();
  sys.restoreBackup(copy.at);
  check('restoring a copy brings the progress back but keeps this device\'s current settings', sys.data.settings.quality === 'high' && sys.data.settings.sound === true);
}

// ------------------------------- PRIME ID figures (and 20: viewing changes nothing)
{
  const { sys, career: c, st } = career(sanitize({ ...save176(), version: 12 }));
  const em = new EventManager(sys, { clock, settings: { mode: 'auto', forcedEventId: 'none' } });
  const modes = new GameModes(sys, c, em, clock);
  const snapshot = JSON.stringify(sys.data);
  const writes = st.writes;
  const p = buildProfile(sys.data, c, em.collection, em);
  const hof = hallOfFame(sys.data, em, 'wins');
  hallOfFame(sys.data, em, 'matches');
  hallOfFame(sys.data, em, 'streak');
  check('viewing PRIME ID changes nothing: the save is identical and nothing is written', JSON.stringify(sys.data) === snapshot && st.writes === writes);
  check(`overview: matches ${p.matches}, wins ${p.wins}, losses ${p.losses}, draws ${p.draws}, win rate ${p.winRate}%`, p.matches === 140 && p.wins === 96 && p.losses === 40 && p.draws === 4 && p.winRate === Math.round((96 / 140) * 100));
  check(`overview: level ${p.level.level} «${p.level.title}» from the career's own levelFor, reputation ${p.reputation}`, p.level.level === c.level().level && p.reputation === 1850 && p.levelProgress >= 0 && p.levelProgress <= 1);
  check(`overview: fighters in the roster ${p.signed}/${p.visibleFighters}, fans ${p.fans} (the career's own total)`, p.signed === c.signedCount() && p.fans === c.totalFans());
  check(`favourite = most matches (${p.favourite?.id}), most wins = ${p.mostWins?.id}`, p.favourite?.id === 'ray' && p.mostWins?.id === 'ray');
  check('the show rating is labelled as the best broadcast rating, not a league rating', p.bestRating === 97);
  check('PRIME ID status is the honest guest one (no account, no cloud)', p.status === 'guest');
  check(`Hall of Fame: every visible fighter (${hof.cards.length}), LUCIEN included once owned`, hof.cards.length === FIGHTER_ORDER.length && hof.cards.some((x) => x.id === 'lucien' && x.unlocked));
  check(`Hall of Fame badges: MOST WINS ${hof.badges.mostWins}, MOST PLAYED ${hof.badges.mostPlayed}`, hof.badges.mostWins === 'ray' && hof.badges.mostPlayed === 'ray');
  const order = hof.cards.map((x) => x.id);
  check(`Hall of Fame sorted by wins, locked fighters last (${order.join(', ')})`, order[0] === 'ray' && order[order.length - 1] === 'rina');
  const fresh = career();
  fresh.sys.data = defaultSave();
  const em2 = new EventManager(fresh.sys, { clock: () => Date.parse('2026-12-10T12:00:00Z'), settings: { mode: 'auto', forcedEventId: 'none' } });
  const p0 = buildProfile(fresh.sys.data, new CareerSystem(fresh.sys), em2.collection, em2);
  const hof0 = hallOfFame(fresh.sys.data, em2, 'wins');
  check('a new career: win rate is empty (no NaN), no favourite yet, streaks 0', p0.winRate === null && p0.favourite === null && p0.streak === 0 && p0.bestStreak === 0 && winRate(0, 0, 0) === null);
  check('outside Halloween an unowned LUCIEN stays out of the Hall of Fame (his seasonal rule)', !hof0.cards.some((x) => x.id === 'lucien') && hof0.badges.mostWins === null);
  check('win rate: wins / (wins + losses + draws), rounded', winRate(2, 1, 0) === 67 && winRate(1, 0, 1) === 50);
  void modes;
}

// ----------------------------------------------------------- version
{
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  check(`game version ${APP_VERSION} matches package.json (${pkg.version})`, pkg.version === APP_VERSION);
  check('the profile layer keeps the historic key for the guest (no move of existing saves)', profileKeys('guest').save === 'primetime-showdown-save-v1' && profileKeys('user:abc').save !== profileKeys('guest').save);
  const main = readFileSync('src/main.ts', 'utf8');
  check('window.__game exists in development only', /if \(import\.meta\.env\.DEV\) \(window as unknown as \{ __game: Game \}\)\.__game = game;/.test(main));
}

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
}
console.log(ok ? `\nprimeid: OK (${checks.length} checks)` : '\nprimeid: FAILED');
const proc = (globalThis as { process?: { exitCode?: number } }).process;
if (!ok && proc) proc.exitCode = 1;
