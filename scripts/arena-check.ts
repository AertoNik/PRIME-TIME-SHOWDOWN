// Headless checks for the Alpha 1.4 studio sets (npm run arenas).
// Availability and RANDOM, set-piece invariants (finite, outside the fighting area,
// never change a fight), Survival keeping its set, save migration and the BOSS FIGHT
// season layering. No WebGL here: the visual side is checked in the browser.
import { ARENA, MATCH } from '../src/config/balance';
import { ARENAS, ARENA_ORDER, arenaById, type ArenaId } from '../src/config/arenas.config';
import { BOSSES } from '../src/config/boss.config';
import { FIGHTERS, RIVAL_ORDER } from '../src/config/fighters';
import { THEMES, bossPhaseSpots, championThemeFor } from '../src/config/themes.config';
import type { FighterId } from '../src/config/types';
import { Match } from '../src/combat/Match';
import type { MatchEvent } from '../src/combat/types';
import { Rng } from '../src/core/math';
import { arenaAvailable, availableArenas, resolveArena, validArenaPref } from '../src/meta/ArenaSelection';
import { CareerSystem } from '../src/meta/CareerSystem';
import { EventManager } from '../src/meta/EventManager';
import { GameModes } from '../src/meta/GameModes';
import { defaultSave, sanitize, type SaveData, type SaveSystem } from '../src/meta/SaveSystem';
import { AUTO } from './bots';

const BOSS = Object.values(BOSSES)[0];
const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);

class MemSave {
  data: SaveData = defaultSave();
  save(): void {
    this.data = sanitize(JSON.parse(JSON.stringify(this.data)));
  }
  get persistent(): boolean {
    return true;
  }
  reset(): void {
    this.data = defaultSave();
  }
}

// ------------------------------------------------------------ availability
check('four sets registered in order', ARENA_ORDER.join() === 'original,casino,backlot,haunted' && ARENA_ORDER.every((id) => ARENAS[id].id === id));
check('standard season: the three permanent sets are open', availableArenas('default').join() === 'original,casino,backlot');
check('Halloween: the haunted set opens too', availableArenas('halloween').join() === 'original,casino,backlot,haunted');
check('another season (winter preview) does not open the haunted set', !availableArenas('winter').includes('haunted'));
check('haunted set is seasonal (Halloween Premiere)', ARENAS.haunted.availability.kind === 'seasonal' && ARENAS.haunted.availability.themeId === 'halloween');
check('a saved haunted choice falls back to the original studio after the season', validArenaPref('haunted', 'default') === 'original');
check('a saved haunted choice stays during Halloween', validArenaPref('haunted', 'halloween') === 'haunted');
check('RANDOM stays RANDOM; junk becomes the original studio', validArenaPref('random', 'default') === 'random' && validArenaPref('moon', 'default') === 'original' && validArenaPref(42, 'halloween') === 'original');
{
  const rng = new Rng(7);
  const seen = new Map<ArenaId, number>();
  for (let i = 0; i < 4000; i++) {
    const id = resolveArena('random', 'default', () => rng.next());
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  check('RANDOM (standard season) never picks the closed seasonal set', !seen.has('haunted'));
  check('RANDOM (standard season) picks every open set, roughly evenly', ['original', 'casino', 'backlot'].every((id) => (seen.get(id as ArenaId) ?? 0) > 1100));
  const seenH = new Set<ArenaId>();
  for (let i = 0; i < 400; i++) seenH.add(resolveArena('random', 'halloween', () => rng.next()));
  check('RANDOM during Halloween can pick all four sets', seenH.size === 4);
  check('a fixed choice is not randomised', resolveArena('casino', 'default', () => 0.99) === 'casino');
  check('resolveArena falls back for an unavailable fixed choice', resolveArena('haunted', 'default', () => 0) === 'original');
}

// ------------------------------------------------------------- set pieces
const kindsOf = (id: ArenaId) => new Set(ARENAS[id].props.map((p) => p.kind));
for (const id of ARENA_ORDER) {
  const def = ARENAS[id];
  const kinds = kindsOf(id);
  if (id !== 'original') check(`${id}: at least 2 kinds of interactive set pieces (${[...kinds].join(', ')})`, kinds.size >= 2);
  // never inside the movement area: set pieces cannot block fighters or shots
  check(`${id}: every set piece stands outside the fighting area`, def.props.every((p) => Math.abs(p.x) > ARENA.halfX || Math.abs(p.z) > ARENA.halfZ));
  check(`${id}: hit points are positive whole numbers`, def.props.every((p) => Number.isInteger(p.hp) && p.hp >= 1));
  check(`${id}: reactive pieces have a cooldown`, def.props.every((p) => !p.reactive || (p.cooldown ?? 0) > 0));
  check(`${id}: lighting and captions present`, !!def.caption && def.lighting.intensity.key > 0 && def.themeTint >= 0 && def.themeTint <= 1);
}
check('original studio keeps its speakers exactly as before', ARENAS.original.props.length === ARENA.props.length && ARENAS.original.props.every((p, i) => p.kind === 'speaker' && p.x === ARENA.props[i].x && p.z === ARENA.props[i].z && p.respawn === ARENA.propRespawn));
check('the new sets stay damaged until the next fight (no respawn farming)', (['casino', 'backlot', 'haunted'] as ArenaId[]).every((id) => ARENAS[id].props.every((p) => p.respawn === 0)));

/** Hammer every set piece many times: breaks are finite, reactive pieces never break. */
for (const id of ARENA_ORDER) {
  const cfg = { fighter: 'ray' as const, deck: FIGHTERS.ray.defaultDeck, rival: 'dex' as const, difficulty: 'pro' as const, seed: 5, fans: 500, arena: id };
  const m = new Match(cfg);
  const twin = new Match(cfg); // same fight, nobody touches its set pieces
  m.drainEvents();
  let breaks = 0;
  let hits = 0;
  let sameFight = true;
  for (let round = 0; round < 12; round++) {
    for (const p of m.props) m.hitProps(p.x, p.z, round % 2 === 1);
    for (let k = 0; k < 40; k++) {
      m.step(1 / 60); // cooldowns tick
      twin.step(1 / 60);
    }
    twin.drainEvents();
    sameFight &&= m.fighters.every((f, i) => f.hp === twin.fighters[i].hp && f.x === twin.fighters[i].x && f.z === twin.fighters[i].z) && m.broadcast.rating === twin.broadcast.rating;
    for (const e of m.drainEvents() as MatchEvent[]) {
      if (e.type === 'propBreak') breaks++;
      if (e.type === 'propHit') hits++;
    }
  }
  const breakable = m.props.filter((p) => !p.reactive).length;
  const respawning = m.props.some((p) => p.respawnTime > 0);
  if (respawning) check(`${id}: speakers respawn on their timer (as in 1.3)`, breaks >= breakable);
  else check(`${id}: each breakable piece breaks exactly once per fight (${breaks}/${breakable})`, breaks === breakable && m.props.every((p) => p.reactive || !p.alive));
  check(`${id}: reactive pieces react but never break`, m.props.every((p) => !p.reactive || p.alive));
  if (id !== 'original') check(`${id}: hits before the break and reactions are reported (${hits})`, hits > 0);
  check(`${id}: smashing set pieces changes nothing in the fight (health, positions, rating)`, sameFight);
}

/** Same seed, same fight on every set: the arena is presentation only. */
function fight(arena: ArenaId, fighter: FighterId, seed: number, boss?: string): string {
  const rival = boss ? BOSSES[boss].rival : RIVAL_ORDER[seed % RIVAL_ORDER.length];
  const m = new Match({ fighter, deck: FIGHTERS[fighter].defaultDeck, rival, difficulty: 'pro', seed, fans: 500, autoPlayer: AUTO.smart, boss, arena });
  let steps = 0;
  let props = 0;
  while (m.phase !== 'over' && steps < 60 * (MATCH.duration + 120)) {
    m.step(1 / 60);
    for (const e of m.drainEvents() as MatchEvent[]) if (e.type === 'propBreak' || e.type === 'propHit') props++;
    steps++;
  }
  const r = m.result!;
  (fight as unknown as { props: number }).props = props;
  return `${r.outcome}/${r.method}/${Math.round(r.damageDealt)}/${Math.round(r.damageTaken)}/${r.combos}/${r.rating}/${steps}`;
}
{
  let same = 0;
  let total = 0;
  let propEvents = 0;
  const fighters: FighterId[] = ['ray', 'bruno', 'nika', 'vega'];
  for (let i = 0; i < 8; i++) {
    const f = fighters[i % fighters.length];
    const base = fight('original', f, 1000 + i * 17);
    for (const id of ['casino', 'backlot', 'haunted'] as ArenaId[]) {
      total++;
      if (fight(id, f, 1000 + i * 17) === base) same++;
      propEvents += (fight as unknown as { props: number }).props;
    }
  }
  check(`identical fight results on every set for the same seed (${same}/${total})`, same === total);
  check(`set pieces are hit in real automatic fights (${propEvents} hit/break events)`, propEvents > 0);
  const boss = BOSS.id;
  const b0 = fight('original', 'ray', 77, boss);
  check('BOSS FIGHT result identical on every set', (['casino', 'backlot', 'haunted'] as ArenaId[]).every((id) => fight(id, 'ray', 77, boss) === b0));
}

// ----------------------------------------------------------- Survival
{
  const now = Date.parse('2026-10-25T12:00:00Z');
  const store = new MemSave();
  const s = store as unknown as SaveSystem;
  const career = new CareerSystem(s);
  const events = new EventManager(s, { clock: () => now, settings: { mode: 'auto', forcedEventId: 'none' } });
  const modes = new GameModes(s, career, events, () => now);
  const run = modes.startRun('ray', FIGHTERS.ray.defaultDeck, null, 31, 'backlot');
  check('Survival run stores its set', run.arena === 'backlot' && store.data.modes.survival.active?.arena === 'backlot');
  store.data.arena = 'casino';
  store.save();
  check('changing the preference mid-run does not move the run', store.data.modes.survival.active?.arena === 'backlot');
  const legacy = sanitize({ version: 6, modes: { survival: { active: { ...JSON.parse(JSON.stringify(run)), arena: undefined } } } });
  check('a run saved before 1.4 continues in the original studio', legacy.modes.survival.active?.arena === 'original');
  const junk = sanitize({ version: 7, modes: { survival: { active: { ...JSON.parse(JSON.stringify(run)), arena: 'moonbase' } } } });
  check('a corrupt run set falls back to the original studio', junk.modes.survival.active?.arena === 'original');
  check('the run keeps its set while it is open (haunted during Halloween)', arenaAvailable(arenaById('haunted'), 'halloween') && !arenaAvailable(arenaById('haunted'), 'default'));
}

// ------------------------------------------------------------- saves
{
  const v6 = { version: 6, money: 4321, reputation: 99, fighters: { ray: { unlocked: true, wins: 7, classicWins: 5, fans: 900 } }, modes: { boss: { vale: { wins: 1, attempts: 3 } } } };
  const m = sanitize(v6);
  check('1.3.x save (v6) loads with the original studio and keeps progress', m.version === 7 && m.arena === 'original' && m.money === 4321 && m.fighters.ray.wins === 7 && m.fighters.ray.classicWins === 5 && m.modes.boss.vale.wins === 1);
  check('arena preference round-trips by id', sanitize(JSON.parse(JSON.stringify({ ...defaultSave(), arena: 'casino' }))).arena === 'casino');
  check('RANDOM preference round-trips', sanitize({ arena: 'random' }).arena === 'random');
  check('an unknown arena id becomes the original studio', sanitize({ arena: 'volcano' }).arena === 'original' && sanitize({ arena: 7 }).arena === 'original');
  check('a saved haunted choice survives the save itself (season check is the game\'s job)', sanitize({ arena: 'haunted' }).arena === 'haunted');
}

// ---------------------------------------------------- BOSS FIGHT layering
check('BOSS FIGHT look: championship edition outside Halloween', championThemeFor('default') === 'champion' && championThemeFor('winter') === 'champion');
check('BOSS FIGHT look: HALLOWEEN SPECIAL during Halloween', championThemeFor('halloween') === 'champion_halloween' && THEMES.champion_halloween.arena.decor === 'championHalloween');
check('HALLOWEEN SPECIAL labels', THEMES.champion_halloween.label.includes('HALLOWEEN SPECIAL') && THEMES.champion.label.includes('CHAMPIONSHIP EDITION'));
check('boss phase spotlights: championship keeps the boss colours', BOSS.phases.every((ph, i) => bossPhaseSpots('champion', i, ph.spots) === ph.spots));
check('boss phase spotlights: Halloween palette per phase', BOSS.phases.every((ph, i) => bossPhaseSpots('champion_halloween', i, ph.spots).length === 4 && bossPhaseSpots('champion_halloween', i, ph.spots) !== ph.spots));

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
}
console.log(ok ? `\nAll ${checks.length} arena checks passed.` : '\nSome arena checks FAILED.');
if (!ok) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
