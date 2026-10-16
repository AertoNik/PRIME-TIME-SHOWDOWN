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
import { Matrix4, Object3D } from 'three';
import { DEBRIS, FLOOR_TOP, GROUND_Y, Pieces, WALL_TOP, surfaceY, type DebrisShape } from '../src/render/stages/StageKit';
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
  check('1.3.x save (v6) loads with the original studio and keeps progress', m.version === 8 && m.arena === 'original' && m.money === 4321 && m.fighters.ray.wins === 7 && m.fighters.ray.classicWins === 5 && m.modes.boss.vale.wins === 1);
  check('arena preference round-trips by id', sanitize(JSON.parse(JSON.stringify({ ...defaultSave(), arena: 'casino' }))).arena === 'casino');
  check('RANDOM preference round-trips', sanitize({ arena: 'random' }).arena === 'random');
  check('an unknown arena id becomes the original studio', sanitize({ arena: 'volcano' }).arena === 'original' && sanitize({ arena: 7 }).arena === 'original');
  check('a saved haunted choice survives the save itself (season check is the game\'s job)', sanitize({ arena: 'haunted' }).arena === 'haunted');
}

// ------------------------------------------------- debris lifecycle (1.4.1)
/** Fly one piece from 1.2 m up and record when it starts fading and when it is gone. */
function debrisRun(size: 'medium' | 'large', vary: number) {
  const pcs = new Pieces();
  const o = new Object3D();
  o.position.set(0, 1.2, 0);
  o.scale.set(1, 2, 1);
  pcs.launch(o, [1, 2.5, 0], [3, 2, 1], 0, size, vary);
  const dt = 1 / 60;
  let t = 0;
  let fadeStart = -1;
  let gone = -1;
  let shrankInAir = false;
  while (t < 30 && pcs.busy) {
    pcs.update(dt);
    t += dt;
    const shrinking = o.scale.y < 2;
    if (shrinking && o.position.y > 0.001 && fadeStart < 0) shrankInAir = true;
    if (shrinking && fadeStart < 0) fadeStart = t;
    if (gone < 0 && !o.visible) gone = t;
  }
  return { pcs, o, fadeStart, gone, shrankInAir };
}
{
  const m = debrisRun('medium', 0);
  const m1 = debrisRun('medium', 1);
  const l = debrisRun('large', 0.5);
  // flight from 1.2 m with a bounce takes ~1 s; the rest timer only starts on landing
  check(`medium debris lies ~6 s before fading (fade starts at ${m.fadeStart.toFixed(1)} s)`, m.fadeStart > 6.3 && m.fadeStart < 8);
  check(`medium debris rest spreads up to ~8 s (fade starts at ${m1.fadeStart.toFixed(1)} s)`, m1.fadeStart > 8.3 && m1.fadeStart < 10);
  check(`medium debris disappears over 2 s (${(m.gone - m.fadeStart).toFixed(2)} s)`, Math.abs(m.gone - m.fadeStart - DEBRIS.medium.fade) < 0.05);
  check(`large debris lies ~10 s, then disappears over 2.5 s (fade at ${l.fadeStart.toFixed(1)} s, gone at ${l.gone.toFixed(1)} s)`, l.fadeStart > 10.3 && l.fadeStart < 12.5 && Math.abs(l.gone - l.fadeStart - DEBRIS.large.fade) < 0.05);
  check('debris never shrinks in the air (lands first, then fades)', !m.shrankInAir && !l.shrankInAir);
  check('a vanished piece is hidden, scaled to zero and the system goes idle', !m.o.visible && m.o.scale.lengthSq() === 0 && !m.pcs.busy);
  check('a vanished piece does not come back on its own', (() => { for (let i = 0; i < 600; i++) m.pcs.update(1 / 60); return !m.o.visible; })());
  m.pcs.clear();
  check('reset (new fight / Survival wave) restores scale and visibility', m.o.visible && m.o.scale.x === 1 && m.o.scale.y === 2 && m.o.scale.z === 1 && !m.pcs.busy);
  // early exit mid-flight / mid-rest: clear stops everything at once
  const e = new Pieces();
  const eo = new Object3D();
  eo.position.y = 2;
  e.launch(eo, [0, 1, 0], [0, 0, 0], 0, 'large', 0);
  for (let i = 0; i < 30; i++) e.update(1 / 60);
  e.clear();
  check('leaving a fight mid-flight stops the debris cleanly', !e.busy && eo.visible && eo.scale.x === 1 && !e.update(1 / 60));
  // a paused fight (dt = 0) holds the debris exactly where it is
  const f = new Pieces();
  const fo = new Object3D();
  fo.position.y = 1;
  f.launch(fo, [1, 1, 0], [1, 1, 1], 0, 'medium', 0);
  f.update(1 / 60);
  const y = fo.position.y;
  const moved = f.update(0);
  check('a paused fight freezes the debris (no movement, no ageing)', !moved && fo.position.y === y && f.busy);
  // a piece re-launched in the next fight starts from its real size again
  const r = debrisRun('medium', 0);
  r.pcs.clear();
  r.pcs.launch(r.o, [0, 2, 0], [0, 0, 0], 0, 'medium', 0);
  check('a piece re-launched after a reset keeps its original size', r.o.scale.y === 2 && r.o.visible);
}

// ---------------------------------------- flat debris landing (1.4.2)
/** Throw many flat pieces from the barrier top in all directions; check how they come to rest. */
function landingRun(shape: DebrisShape, startY: number) {
  const pcs = new Pieces();
  const objs: Object3D[] = [];
  for (let k = 0; k < 48; k++) {
    const o = new Object3D();
    const a = (k / 48) * Math.PI * 2;
    o.position.set(-ARENA.wallX - 0.2, startY + (k % 4) * 0.07, (k % 12) * 0.5 - 3);
    o.rotation.set(k * 0.3, k * 0.7, k * 0.5);
    pcs.launch(o, [Math.cos(a) * (1.6 + (k % 4) * 0.5), 3 + (k % 3), Math.sin(a) * 2], [6 + (k % 5), 3, 5 - (k % 7)], shape, 'medium', 0);
    objs.push(o);
  }
  // fly until every piece rests (well before the 6 s rest timer runs out)
  for (let i = 0; i < 60 * 5; i++) pcs.update(1 / 60);
  const m4 = new Matrix4();
  let maxGap = 0;
  let maxTilt = 0;
  const surfaces = new Set<number>();
  const [hx, hy, hz] = shape.half;
  const thin = hy <= hx && hy <= hz ? 1 : hx <= hz ? 0 : 2;
  for (const o of objs) {
    const e = m4.makeRotationFromQuaternion(o.quaternion).elements;
    const ext = shape.round ? Math.abs(e[5]) * hy + Math.sqrt(Math.max(0, 1 - e[5] * e[5])) * hx : Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz;
    const surf = shape.surface(o.position.x, o.position.z);
    surfaces.add(surf);
    maxGap = Math.max(maxGap, Math.abs(o.position.y - ext - surf));
    maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, Math.abs(e[thin * 4 + 1]))) * (180 / Math.PI));
  }
  const yaws = new Set(objs.map((o) => Math.round(Math.atan2(2 * (o.quaternion.w * o.quaternion.y + o.quaternion.x * o.quaternion.z), 1 - 2 * (o.quaternion.y ** 2 + o.quaternion.z ** 2)) * 10)));
  return { pcs, objs, maxGap, maxTilt, surfaces, yaws: yaws.size };
}
{
  const capTop = WALL_TOP + 0.07;
  const chip = landingRun({ half: [0.24, 0.035, 0.24], round: true, surface: (x, z) => surfaceY(x, z, capTop) }, capTop + 0.2);
  check(`casino chips rest exactly on the surface (max gap ${chip.maxGap.toFixed(4)} m)`, chip.maxGap < 1e-6);
  check(`casino chips lie flat (max tilt ${chip.maxTilt.toFixed(2)}°)`, chip.maxTilt < 0.01);
  check('chips land on the floor top, the barrier rail and the studio ground — whatever is really under them', chip.surfaces.has(FLOOR_TOP) && chip.surfaces.has(GROUND_Y));
  const before = chip.objs.map((o) => o.position.toArray().join() + o.quaternion.toArray().join());
  chip.pcs.update(1 / 60);
  check('chips lie still at full size after landing (resting, fade not started yet)', chip.objs.every((o, i) => o.position.toArray().join() + o.quaternion.toArray().join() === before[i] && o.visible && o.scale.x === 1));
  const plankShape: DebrisShape = { half: [0.375, 0.03, 0.08], surface: (x, z) => surfaceY(x, z, WALL_TOP + 0.05) };
  const plank = landingRun(plankShape, WALL_TOP + 0.3);
  check(`backlot planks rest exactly on the surface (max gap ${plank.maxGap.toFixed(4)} m)`, plank.maxGap < 1e-6);
  check(`backlot planks lie on their broad side (max tilt ${plank.maxTilt.toFixed(2)}°)`, plank.maxTilt < 0.01);
  check(`planks keep different horizontal turns (${plank.yaws} distinct yaws of 48)`, plank.yaws > 20);
  const chunk = landingRun({ half: [0.44, 0.33, 0.025], surface: (x, z) => surfaceY(x, z, WALL_TOP + 0.05) }, WALL_TOP + 0.5);
  check(`plywood chunks (thin along their own Z) lie on their broad side (gap ${chunk.maxGap.toFixed(4)} m, tilt ${chunk.maxTilt.toFixed(2)}°)`, chunk.maxGap < 1e-6 && chunk.maxTilt < 0.01);
  // never inside a surface during the flight either
  const pcs = new Pieces();
  const o = new Object3D();
  o.position.set(-2, 1.5, 0);
  o.rotation.set(0.4, 0.2, 1.1);
  const sh: DebrisShape = { half: [0.375, 0.03, 0.08], surface: (x, z) => surfaceY(x, z, WALL_TOP + 0.05) };
  pcs.launch(o, [0.5, 1, 0], [7, 3, 9], sh, 'medium', 0);
  const m4 = new Matrix4();
  let worst = 0;
  for (let i = 0; i < 240; i++) {
    pcs.update(1 / 60);
    const e = m4.makeRotationFromQuaternion(o.quaternion).elements;
    const ext = Math.abs(e[1]) * 0.375 + Math.abs(e[5]) * 0.03 + Math.abs(e[9]) * 0.08;
    worst = Math.min(worst, o.position.y - ext - sh.surface(o.position.x, o.position.z));
  }
  check(`a tumbling plank never dips into the floor while bouncing (deepest ${worst.toFixed(4)} m)`, worst > -1e-6);
  // the 1.4.1 fade still applies after a flat landing
  for (let i = 0; i < 60 * 12; i++) pcs.update(1 / 60);
  check('after resting, a flat piece still fades out and hides (1.4.1 rules)', !o.visible && !pcs.busy);
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
