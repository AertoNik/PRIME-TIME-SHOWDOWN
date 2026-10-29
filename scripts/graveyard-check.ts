// Headless checks for Alpha 1.7.5 — GRAVEYARD BROADCAST (npm run graveyard): the CURSED CEMETERY
// SET and the first cover on the fighting floor. The picker data and the seasonal (UTC) opening,
// the four looks and the hit points of tombstones, columns and pumpkins, shots and strikes stopped
// by cover (CHARGED SHOT goes through), collision gone with the piece, fast moves and object cards
// next to cover (DASH, BACKTRACK, BAT BITE, KNOCKOUT, knockbacks, PULSE PUSH, STAGE BARRIER, PROP
// DROP, mines, holograms), no fighter stuck or inside cover in many automatic fights, the AI going
// round and taking cover briefly, the season bonus (once, wins only, inside the daily cap) and its
// economy, and the proof that every other set, mode and save is exactly as before.
// In-memory saves, fake clock, no browser (the look is checked in the browser).
import { ARENAS, ARENA_ORDER } from '../src/config/arenas.config';
import { ARENA, CARD_TUNING, COVER_TUNING, MATCH } from '../src/config/balance';
import { EVENTS } from '../src/config/events.config';
import { FIGHTERS, FIGHTER_ORDER, RIVAL_ORDER } from '../src/config/fighters';
import { ARENA_MUSIC } from '../src/config/music.config';
import type { CardId, Difficulty, FighterId, RivalId } from '../src/config/types';
import { coverStage } from '../src/combat/Covers';
import { Match } from '../src/combat/Match';
import type { MatchEvent, MatchResultData } from '../src/combat/types';
import { arenaAvailable, availableArenas, resolveArena, validArenaPref } from '../src/meta/ArenaSelection';
import { EventManager } from '../src/meta/EventManager';
import { defaultSave, sanitize, type SaveData, type SaveSystem } from '../src/meta/SaveSystem';
import { ARENA_ART } from '../src/ui/arenaArt';
import { AUTO, comboBot, runMatch, type BotState, type Mode } from './bots';

interface Fs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
const { readFileSync } = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process.getBuiltinModule('node:fs') as Fs;

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const T = (iso: string) => Date.parse(iso);
const DT = 1 / 60;
const GY = ARENAS.graveyard;
const COV = GY.covers ?? [];
const HW = EVENTS.find((e) => e.id === 'halloween-2026')!;
const hash = (s: string) => {
  let x = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619) >>> 0;
  }
  return x.toString(16);
};

class Mem {
  data: SaveData = defaultSave();
  saves = 0;
  save(): void {
    this.saves++;
    this.data = sanitize(JSON.parse(JSON.stringify(this.data)));
  }
  get persistent(): boolean {
    return true;
  }
  reset(): void {
    this.data = defaultSave();
  }
}

/** A graveyard match at the FIGHT, both brains switched off (scripted scenes move the fighters by hand). */
function scene(fighter: FighterId = 'ray', deck?: CardId[]): Match {
  const m = new Match({ fighter, deck: deck ?? FIGHTERS[fighter].defaultDeck, rival: 'dex', difficulty: 'rookie', seed: 11, fans: 0, arena: 'graveyard' });
  while (m.phase !== 'fight') {
    m.step(DT);
    m.drainEvents();
  }
  m.ais[0].hold = true;
  m.ais[1].hold = true;
  return m;
}
const place = (m: Match, side: 0 | 1, x: number, z: number) => {
  const f = m.fighters[side];
  f.x = f.px = x;
  f.z = f.pz = z;
  f.vx = f.vz = 0;
};
/** Deepest a fighter got into any live piece (positive = inside). */
const depth = (m: Match): number => {
  let worst = -9;
  for (const f of m.fighters) for (const c of m.covers.list) if (c.alive) worst = Math.max(worst, f.radius - m.covers.gap(c, f.x, f.z));
  return worst;
};
const coverEvents = (ev: MatchEvent[]) => ev.filter((e): e is Extract<MatchEvent, { type: 'cover' }> => e.type === 'cover');

// ------------------------------------------------------------ 1. the picker
{
  check('picker: CURSED CEMETERY SET is the fifth set, after HAUNTED PRIME SET', ARENA_ORDER.indexOf('graveyard') === 4 && ARENA_ORDER.indexOf('haunted') === 3);
  check('picker: its own name, show title, Russian description and caption', GY.name === 'CURSED CEMETERY SET' && GY.show === 'GRAVEYARD BROADCAST' && /кладбищ/.test(GY.description) && GY.caption.includes('CURSED CEMETERY SET'));
  check('picker: a thumbnail of its own (not a copy of another set)', !!ARENA_ART.graveyard && ARENA_ART.graveyard.startsWith('<svg') && ARENA_ORDER.every((id) => id === 'graveyard' || ARENA_ART[id] !== ARENA_ART.graveyard));
  check('picker: its own colours and the Halloween dressing (no second set of seasonal pumpkins)', GY.colors.a !== ARENAS.haunted.colors.a && GY.nativeSeason === 'halloween');
  check('music: the existing Halloween fight track (haunted_arena), no new music', ARENA_MUSIC.graveyard === 'haunted_arena');
  const prep = readFileSync('src/ui/screens/PrepScreen.ts', 'utf8');
  check('picker: a permanent set (1.8.9.5) — the «Постоянная» chip, never «Сезонная»', GY.availability.kind === 'permanent' && prep.includes("'<span class=\"chip teal\">Постоянная</span>'"));
  check('picker card shows «Разрушаемые укрытия» and the season bonus chip', prep.includes('Разрушаемые укрытия') && prep.includes('arenaBonus('));
}

// ----------------------------------------------- 2. HAUNTED and the others unchanged
{
  // fingerprints of 1.7.1: the four earlier sets' data and their stage code
  const DATA: Record<string, string> = { original: '69dde642', casino: '2d1240e8', backlot: '38bbcaf8', haunted: '347a1089' };
  const CODE: Record<string, string> = { HauntedStage: 'ba204c7a', OriginalStage: '3692e30f', CasinoStage: '2c95aa0', BacklotStage: 'd6ba30c7' };
  check('HAUNTED PRIME SET: its data is exactly as in 1.7.1 (props, light, colours, availability)', hash(JSON.stringify(ARENAS.haunted)) === DATA.haunted && !ARENAS.haunted.covers);
  check('HAUNTED PRIME SET: its stage code is untouched', hash(readFileSync('src/render/stages/HauntedStage.ts', 'utf8')) === CODE.HauntedStage);
  check('the three permanent sets: data and stage code untouched', (['original', 'casino', 'backlot'] as const).every((id) => hash(JSON.stringify(ARENAS[id])) === DATA[id]) && ['OriginalStage', 'CasinoStage', 'BacklotStage'].every((n) => hash(readFileSync(`src/render/stages/${n}.ts`, 'utf8')) === CODE[n]));
  check('only the cemetery has cover on the floor', ARENA_ORDER.every((id) => (id === 'graveyard') === !!ARENAS[id].covers?.length));
}

// ------------------------------------------------------- 3. UTC availability
{
  const mem = new Mem();
  let now = 0;
  const em = new EventManager(mem as unknown as SaveSystem, { clock: () => now, settings: { mode: 'auto', forcedEventId: 'none' } });
  const at = (iso: string) => {
    now = T(iso);
    em.refresh(); // the game re-reads the calendar every few seconds
    return { open: arenaAvailable(GY, em.themeId), random: availableArenas(em.themeId).includes('graveyard'), pref: validArenaPref('graveyard', em.themeId), pays: em.playable };
  };
  const before = at('2026-10-19T23:59:59Z');
  const first = at('2026-10-20T00:00:00Z');
  const last = at('2026-11-03T23:59:59Z');
  const after = at('2026-11-04T00:00:00Z');
  check(`UTC: open before the event too (19 Oct 23:59:59 → ${before.open ? 'open' : 'closed'}), but no event pays yet`, before.open && before.random && before.pref === 'graveyard' && !before.pays);
  check('UTC: open from 20 Oct 00:00:00 (in the picker and in RANDOM)', first.open && first.random && first.pref === 'graveyard' && first.pays);
  check('UTC: still open on 3 Nov 23:59:59', last.open && last.random && last.pays);
  check('UTC: still open from 4 Nov 00:00 — the saved choice stays, RANDOM keeps it; the event no longer pays', after.open && after.random && after.pref === 'graveyard' && !after.pays);
  check('RANDOM picks the cemetery in and out of the season; a fixed choice outside it is honoured', resolveArena('graveyard', 'default', () => 0) === 'graveyard' && resolveArena('random', 'halloween', () => 0.99) === 'graveyard');
  // the cemetery itself adds no save fields; the schema is 12 since Alpha 1.8 (win streaks)
  check('saves: the choice round-trips by id and survives the season check (no new save fields)', sanitize(JSON.parse(JSON.stringify({ ...defaultSave(), arena: 'graveyard' }))).arena === 'graveyard' && defaultSave().version === 12);
}

// ---------------------------------------------- the layout (fair, passable)
{
  const R = MATCH.fighterRadius;
  const m = scene();
  const C = m.covers;
  const sym = COV.every((a) => COV.some((b) => b.kind === a.kind && Math.abs(b.x + a.x) < 1e-9 && Math.abs(b.z + a.z) < 1e-9));
  check(`layout: ${COV.length} pieces (tombstones, columns, pumpkins), point-symmetric — both corners see the same floor`, COV.length >= 6 && COV.length <= 8 && sym && new Set(COV.map((c) => c.kind)).size === 3);
  // a fighter fits between any two pieces and between a piece and the barrier (≥ 0.35 m of floor to spare)
  let tight = 9;
  for (let i = 0; i < C.list.length; i++) {
    const a = C.list[i];
    // the barrier: the movement limit for a fighter's centre is the rounded rect halfX / halfZ
    const samples = [
      [a.ax, a.az],
      [a.bx, a.bz],
      [a.x, a.z],
    ];
    for (const [x, z] of samples) {
      const toWall = Math.min(ARENA.halfX - Math.abs(x), ARENA.halfZ - Math.abs(z));
      tight = Math.min(tight, toWall - (a.radius + R));
    }
    for (let j = i + 1; j < C.list.length; j++) {
      const b = C.list[j];
      let d = 9;
      for (const [x, z] of [
        [a.ax, a.az],
        [a.bx, a.bz],
        [a.x, a.z],
      ])
        d = Math.min(d, C.gap(b, x, z) - a.radius);
      tight = Math.min(tight, d - 2 * R);
    }
  }
  check(`layout: room to walk round every piece (narrowest passage leaves ${tight.toFixed(2)} m to spare)`, tight >= 0.35);
  const spawnGap = Math.min(...C.list.map((c) => Math.min(C.gap(c, 0, MATCH.spawnZ), C.gap(c, 0, -MATCH.spawnZ))));
  check(`layout: the spawn points stay clear (${spawnGap.toFixed(2)} m to the nearest piece)`, spawnGap >= 1.2);
  // the battle camera looks down at ~53°: a piece of height h hides at most ~0.75·h of floor behind it
  const tallest = Math.max(...Object.values(COVER_TUNING).map((v) => (typeof v === 'object' ? v.height : 0)));
  check(`view: no piece taller than ${tallest.toFixed(2)} m — a fighter standing right behind one shows from the knees up`, tallest <= 2.0 && tallest - 1.33 * (COVER_TUNING.column.radius + R) < 0.7);
  check('view: every piece is taller than the line of fire (1.05 m): it visibly stops the shots', Object.values(COVER_TUNING).every((v) => typeof v !== 'object' || v.height > ARENA.shotHeight));
}

// -------------------------------------------------- 7. stages follow hit points
{
  check('stages: intact above 2/3, cracked to 1/3, battered below, shattered at 0', coverStage(1000, 1000) === 0 && coverStage(667, 1000) === 0 && coverStage(666, 1000) === 1 && coverStage(334, 1000) === 1 && coverStage(333, 1000) === 2 && coverStage(1, 1000) === 2 && coverStage(0, 1000) === 3);
  const m = scene();
  const c = m.covers.list.find((x) => x.kind === 'tombstone')!;
  const looks: string[] = [];
  for (let k = 0; k < 10; k++) {
    m.covers.damage(c, c.maxHp / 10, c.x, c.z + 0.4, 0, -1, false, 0);
    for (const e of coverEvents(m.drainEvents())) looks.push(e.what[0] + e.stage);
  }
  check(`stages: ten equal hits read hit… crack 1… crack 2… break (${looks.join(' ')})`, looks.join(' ') === 'h0 h0 h0 c1 h1 h1 c2 h2 h2 b3');
  check('stages: a shattered piece is gone at once (no hit points, no collision, counted down)', !c.alive && c.stage === 3 && c.hp === 0 && m.covers.live === COV.length - 1);
  m.covers.damage(c, 500, c.x, c.z, 0, -1, true, 0);
  check('stages: hitting the remains does nothing (no events, nothing to farm)', coverEvents(m.drainEvents()).length === 0);
  // a jump straight from intact to battered (a heavy blow) reports the look it lands on
  const p = m.covers.list.find((x) => x.kind === 'pumpkin')!;
  m.covers.damage(p, p.maxHp * 0.7, p.x, p.z, 0, -1, true, 1);
  const e = coverEvents(m.drainEvents())[0];
  check('stages: one heavy blow from intact to battered is one crack to stage 2', e?.what === 'crack' && e.stage === 2 && e.heavy);
}

// --------------------------------------------------- 8–9. durability by kind
{
  const T0 = COVER_TUNING;
  const maxNormal = Math.max(...FIGHTER_ORDER.map((id) => FIGHTERS[id].stats.attack.damage * ((FIGHTERS[id].stats.attack as { projectiles?: number }).projectiles ?? 1)));
  check(`durability: pumpkin < tombstone < column (${T0.pumpkin.hp} / ${T0.tombstone.hp} / ${T0.column.hp})`, T0.pumpkin.hp < T0.tombstone.hp && T0.tombstone.hp < T0.column.hp);
  check(`durability: no piece breaks from one normal shot — not even a whole shotgun blast (${maxNormal} at point blank)`, maxNormal * 2 < T0.pumpkin.hp && maxNormal * 4 < T0.tombstone.hp);
  check(`durability: a POWER SHOT (${CARD_TUNING.power_shot.damage}) breaks a pumpkin, cracks a tombstone to its last third, a KNOCKOUT charge (${CARD_TUNING.knockout.damage}) breaks a tombstone`, CARD_TUNING.power_shot.damage >= T0.pumpkin.hp && coverStage(T0.tombstone.hp - CARD_TUNING.power_shot.damage, T0.tombstone.hp) === 2 && CARD_TUNING.knockout.damage >= T0.tombstone.hp && CARD_TUNING.knockout.damage < T0.column.hp);
}

// -------------------------------------------- 6. shots and strikes stopped by cover
{
  // Ray right below the column at (2.75, 2.3), Dex right above it: every bolt meets the stone
  const m = scene('ray');
  const col = m.covers.list.find((c) => c.kind === 'column' && c.z > 0)!;
  place(m, 0, col.x, col.z + 2.2);
  place(m, 1, col.x, col.z - 2.2);
  const dexHp = m.fighters[1].hp;
  const hp0 = col.hp;
  m.ais[0].hold = false; // the player's brain aims and fires; it may try to step round, so pin it
  let hits = 0;
  for (let i = 0; i < 60 * 3; i++) {
    place(m, 0, col.x, col.z + 2.2);
    place(m, 1, col.x, col.z - 2.2);
    m.step(DT);
    for (const e of m.drainEvents()) if (e.type === 'cover' && e.side === 0) hits++;
  }
  check(`blocking: bolts at a target behind a column hit the column (${hits} hits, ${Math.round(hp0 - col.hp)} damage) and never the target`, hits >= 4 && col.hp < hp0 && m.fighters[1].hp === dexHp);
  // a piercing CHARGED SHOT goes through, damaging the piece once, and still lands
  const m2 = scene('ray');
  const c2 = m2.covers.list.find((c) => c.kind === 'column' && c.z > 0)!;
  place(m2, 0, c2.x, c2.z + 2.2);
  place(m2, 1, c2.x, c2.z - 2.4);
  const f = m2.fighters[0];
  f.facing = Math.PI;
  m2.combat.firePower(f, 0, -1, CARD_TUNING.charged_shot.damage, {}, true);
  const hp2 = c2.hp;
  const foeHp = m2.fighters[1].hp;
  let coverHits = 0;
  for (let i = 0; i < 60; i++) {
    place(m2, 1, c2.x, c2.z - 2.4);
    m2.step(DT);
    for (const e of m2.drainEvents()) if (e.type === 'cover') coverHits++;
  }
  check(`blocking: CHARGED SHOT pierces cover (the column takes it once: ${coverHits} hit, ${Math.round(hp2 - c2.hp)} damage) and hits the target`, coverHits === 1 && c2.hp < hp2 && m2.fighters[1].hp < foeHp);
  // a POWER SHOT stops at the piece
  const m3 = scene('ray');
  const c3 = m3.covers.list.find((c) => c.kind === 'tombstone' && c.z > 0)!;
  place(m3, 0, c3.x, c3.z + 2.0);
  place(m3, 1, c3.x, c3.z - 2.4);
  m3.combat.firePower(m3.fighters[0], 0, -1, CARD_TUNING.power_shot.damage, {}, false);
  const foe3 = m3.fighters[1].hp;
  for (let i = 0; i < 60; i++) {
    place(m3, 1, c3.x, c3.z - 2.4);
    m3.step(DT);
    m3.drainEvents();
  }
  check('blocking: a POWER SHOT stops at a tombstone (cracked, the target untouched)', c3.stage >= 1 && m3.fighters[1].hp === foe3);
  // a muzzle poking past the stone does not shoot through it (the shot starts at the shooter's body)
  const m4 = scene('ray');
  const c4 = m4.covers.list.find((c) => c.kind === 'tombstone' && c.z > 0)!;
  place(m4, 0, c4.x, c4.z + c4.radius + 0.56);
  place(m4, 1, c4.x, c4.z - 2.6);
  m4.combat.firePower(m4.fighters[0], 0, -1, 300, {}, false);
  const foe4 = m4.fighters[1].hp;
  for (let i = 0; i < 40; i++) {
    m4.step(DT);
    m4.drainEvents();
  }
  check('blocking: pressed against a tombstone, a shot still hits the stone (no shooting through it at point blank)', c4.hp < c4.maxHp && m4.fighters[1].hp === foe4);
  // a target in front of a piece is still hit (the piece behind it does not steal the shot)
  const m5 = scene('ray');
  const c5 = m5.covers.list.find((c) => c.kind === 'tombstone' && c.z > 0)!;
  place(m5, 1, c5.x, c5.z + c5.radius + 0.57);
  place(m5, 0, c5.x, c5.z + 3.6);
  const foe5 = m5.fighters[1].hp;
  m5.combat.firePower(m5.fighters[0], 0, -1, 300, {}, false);
  for (let i = 0; i < 40; i++) {
    place(m5, 1, c5.x, c5.z + c5.radius + 0.57);
    m5.step(DT);
    m5.drainEvents();
  }
  // (the shot hits the fighter; its knockback may then slam them into the stone — that is the only damage the stone takes)
  check('blocking: a fighter standing in front of a tombstone is hit, not the stone behind', m5.fighters[1].hp < foe5 && c5.maxHp - c5.hp <= COVER_TUNING.slamDamage);
  // a cane strike through a tombstone hits the stone
  const m6 = scene('lucien');
  const c6 = m6.covers.list.find((c) => c.kind === 'tombstone' && c.z > 0)!;
  place(m6, 0, c6.x, c6.z + 1.0);
  place(m6, 1, c6.x, c6.z - 1.0);
  m6.ais[0].hold = false;
  const foe6 = m6.fighters[1].hp;
  for (let i = 0; i < 60 * 3; i++) {
    place(m6, 0, c6.x, c6.z + 1.0);
    place(m6, 1, c6.x, c6.z - 1.0);
    m6.step(DT);
    m6.drainEvents();
  }
  check('blocking: LUCIEN\'s cane rings off a tombstone between him and the target', c6.hp < c6.maxHp && m6.fighters[1].hp === foe6);
}

// ---------------------------------------------- 10. collision gone with the piece
{
  const m = scene();
  const c = m.covers.list.find((x) => x.kind === 'column' && x.z > 0)!;
  place(m, 0, c.x, c.z + 0.2);
  m.step(DT);
  const pushed = Math.hypot(m.fighters[0].x - c.x, m.fighters[0].z - c.z);
  m.covers.damage(c, 99999, c.x, c.z, 0, -1, true, 1);
  place(m, 0, c.x, c.z + 0.2);
  m.step(DT);
  const after = Math.hypot(m.fighters[0].x - c.x, m.fighters[0].z - c.z);
  check(`collision: a live column pushes a fighter out (${pushed.toFixed(2)} m from its axis)`, pushed >= c.radius + MATCH.fighterRadius - 1e-6);
  check('collision: the shattered column leaves no invisible wall (the fighter stands on its spot)', after < 0.3);
  check('collision: lines of fire through its spot are clear again', !m.covers.onLine(c.x, c.z + 3, c.x, c.z - 3, 0.1) || m.covers.onLine(c.x, c.z + 3, c.x, c.z - 3, 0.1) !== c);
}

// ------------------------------------- 12. fast moves and object cards next to cover
{
  // DASH straight at a column (any direction): never inside it
  let worst = -9;
  for (let a = 0; a < 16; a++) {
    const m = scene();
    const c = m.covers.list.find((x) => x.kind === 'column' && x.z > 0)!;
    const ang = (a / 16) * Math.PI * 2;
    place(m, 0, c.x + Math.sin(ang) * 1.6, c.z + Math.cos(ang) * 1.6);
    const f = m.fighters[0];
    f.action = { kind: 'dash', t: 0, total: CARD_TUNING.dash.duration, dirX: -Math.sin(ang), dirZ: -Math.cos(ang), speed: CARD_TUNING.dash.distance / CARD_TUNING.dash.duration, style: f.def.dashStyle };
    for (let i = 0; i < 30; i++) {
      m.step(DT);
      m.drainEvents();
      worst = Math.max(worst, depth(m));
    }
  }
  check(`DASH into a column from 16 directions: never inside it (deepest ${Math.max(0, worst).toFixed(3)} m)`, worst < 0.02);
  // the DASH planner avoids cover on the way
  {
    const m = scene();
    const c = m.covers.list.find((x) => x.kind === 'column' && x.z > 0)!;
    place(m, 0, c.x, c.z + 1.0);
    place(m, 1, c.x - 3.0, c.z + 1.0);
    const dir = m.abilities.chooseDashDir(m.fighters[0], m.fighters[1]);
    const free = m.covers.sweep(m.fighters[0].x, m.fighters[0].z, m.fighters[0].x + dir.x * CARD_TUNING.dash.distance, m.fighters[0].z + dir.z * CARD_TUNING.dash.distance, MATCH.fighterRadius);
    check(`DASH planner: next to a column it picks a way that stays clear of it (${Math.round(free * 100)}% of the dash free)`, free > 0.9);
  }
  // BACKTRACK: the tape went round a tombstone — the glide back is a straight line that never crosses it
  {
    const m = scene();
    const c = m.covers.list.find((x) => x.kind === 'tombstone' && x.z > 0)!;
    const f = m.fighters[0];
    f.hist.length = 0;
    // recorded path: from the far side of the stone round its end to the near side
    for (let k = 0; k <= 20; k++) {
      const a = Math.PI * (k / 20);
      f.hist.push(c.x + Math.cos(a) * 1.4, c.z - Math.sin(a) * 1.0 + 0.0);
    }
    place(m, 0, c.x - 1.4, c.z + 1.0);
    const p = m.abilities.backtrackPoint(f, { x: 0, z: 0 });
    const clear = m.covers.sweep(f.x, f.z, p.x, p.z, f.radius) >= 1;
    check(`BACKTRACK: with cover in the way it rewinds to the latest point it can reach in a straight line (${clear ? 'clear' : 'blocked'})`, clear);
  }
  // BAT BITE lunge into a pumpkin: stops at it, the pumpkin takes the bite
  {
    const m = scene('lucien');
    const c = m.covers.list.find((x) => x.kind === 'pumpkin' && x.x === 0)!;
    place(m, 0, 0, 2.2);
    place(m, 1, 0, -2.2);
    const f = m.fighters[0];
    const t = CARD_TUNING.bat_bite;
    f.action = { kind: 'bite', stage: 'rush', t: 0, total: t.rushDistance / t.rushSpeed, dirX: 0, dirZ: -1, speed: t.rushSpeed, combo: null, dodged: false, feinted: false };
    const foeHp = m.fighters[1].hp;
    let worstB = -9;
    let splash = false;
    for (let i = 0; i < 30; i++) {
      m.step(DT);
      for (const e of m.drainEvents()) if (e.type === 'bite' && e.what === 'barrier') splash = true;
      worstB = Math.max(worstB, depth(m));
    }
    check(`BAT BITE: the lunge stops at the pumpkin (it takes the bite: ${c.maxHp - Math.round(c.hp)}), never through it, the target untouched`, splash && c.hp < c.maxHp && worstB < 0.02 && m.fighters[1].hp === foeHp);
  }
  // KNOCKOUT charge into a tombstone: smashes it, stops
  {
    const m = scene('bruno');
    const c = m.covers.list.find((x) => x.kind === 'tombstone' && x.z > 0)!;
    place(m, 0, c.x, c.z + 2.5);
    place(m, 1, c.x, c.z - 2.5);
    const f = m.fighters[0];
    const t = CARD_TUNING.knockout;
    f.action = { kind: 'rush', t: 0, total: t.rushDistance / t.rushSpeed, dirX: 0, dirZ: -1, speed: t.rushSpeed, combo: null, dodged: false };
    const foeHp = m.fighters[1].hp;
    let worstK = -9;
    for (let i = 0; i < 40; i++) {
      m.step(DT);
      m.drainEvents();
      worstK = Math.max(worstK, depth(m));
    }
    check('KNOCKOUT: the charge smashes the tombstone (shattered) and stops — nobody passes through', !c.alive && worstK < 0.02 && m.fighters[1].hp === foeHp && m.fighters[0].z > c.z - 0.6);
  }
  // a knockback into a column slams it; the fighter stops at its surface
  {
    const m = scene();
    const c = m.covers.list.find((x) => x.kind === 'column' && x.z > 0)!;
    place(m, 1, c.x, c.z + 1.6);
    const f = m.fighters[1];
    f.knockback = 0.4;
    f.kbX = 0;
    f.kbZ = -9;
    f.vx = 0;
    f.vz = -9;
    let slam = false;
    let worstS = -9;
    for (let i = 0; i < 40; i++) {
      m.step(DT);
      for (const e of coverEvents(m.drainEvents())) if (e.heavy) slam = true;
      worstS = Math.max(worstS, depth(m));
    }
    check(`knockback: a fighter thrown into a column slams it (${COVER_TUNING.slamDamage} to the stone) and stops at its surface`, slam && c.hp === c.maxHp - COVER_TUNING.slamDamage && worstS < 0.02);
  }
  // PULSE PUSH shove into a tombstone
  {
    const m = scene();
    const c = m.covers.list.find((x) => x.kind === 'tombstone' && x.z > 0)!;
    place(m, 1, c.x, c.z + 1.2);
    m.combat.shove(m.fighters[1], 0, -1, 12);
    let worstP = -9;
    for (let i = 0; i < 60; i++) {
      m.step(DT);
      m.drainEvents();
      worstP = Math.max(worstP, depth(m));
    }
    check(`PULSE PUSH: a shove into a tombstone ends at the stone (deepest ${Math.max(0, worstP).toFixed(3)} m)`, worstP < 0.02);
  }
  // STAGE BARRIER: the screen never cuts through a piece
  {
    let crossed = 0;
    let spawned = 0;
    for (let k = 0; k < 24; k++) {
      const m = scene();
      const a = (k / 24) * Math.PI * 2;
      place(m, 0, Math.sin(a) * 3.2, Math.cos(a) * 3.2 + 1);
      place(m, 1, -Math.sin(a) * 3.0, -Math.cos(a) * 3.0 - 1);
      m.fighters[0].seenX = m.fighters[1].x;
      m.fighters[0].seenZ = m.fighters[1].z;
      m.objects.spawnBarrier(m.fighters[0]);
      const o = m.objects.own(0, 'barrier');
      if (!o) continue;
      spawned++;
      const t = CARD_TUNING.stage_barrier;
      if (m.covers.onLine(o.x - o.dirX * o.radius, o.z - o.dirZ * o.radius, o.x + o.dirX * o.radius, o.z + o.dirZ * o.radius, t.thickness)) crossed++;
    }
    check(`STAGE BARRIER: placed from 24 spots round the floor, it never cuts through a piece (${crossed}/${spawned} crossed, the corner fallback aside)`, spawned === 24 && crossed <= 2);
  }
  // PROP DROP: a prop landing on a piece damages it
  {
    const m = scene();
    const c = m.covers.list.find((x) => x.kind === 'pumpkin' && x.x === 0)!;
    place(m, 1, 0, -1.2);
    place(m, 0, 0, 3);
    const f = m.fighters[0];
    f.seenX = 0;
    f.seenZ = -0.6;
    f.seenVX = f.seenVZ = 0;
    m.objects.spawnProp(f, null);
    for (let i = 0; i < 60 * 2; i++) {
      m.step(DT);
      m.drainEvents();
    }
    check(`PROP DROP: the falling prop hits the pumpkin under it too (${c.maxHp - Math.round(c.hp)} damage)`, c.hp < c.maxHp);
  }
  // mines and holograms never end up inside a piece
  {
    const m = scene();
    const c = m.covers.list.find((x) => x.kind === 'column' && x.z > 0)!;
    const f = m.fighters[0];
    place(m, 0, c.x - 2.5, c.z);
    f.seenX = c.x;
    f.seenZ = c.z;
    f.seenVX = f.seenVZ = 0;
    m.objects.spawnMine(f, null);
    const mine = m.objects.own(0, 'mine')!;
    place(m, 0, c.x, c.z + 1.0);
    place(m, 1, c.x - 3.0, c.z + 1.0);
    m.spawnHolo(m.fighters[0], m.fighters[1]);
    const holo = m.decoys.find((d) => d.kind === 'holo')!;
    check('PRESSURE MINE and HOLO DECOY: never placed inside a piece', m.covers.clear(mine.x, mine.z, 0.29) && m.covers.clear(holo.x, holo.z, MATCH.fighterRadius - 0.01));
  }
}

// -------------------------------------- 4–5. automatic fights: everyone, nobody stuck
interface FightStats {
  ok: boolean;
  breaks: number;
  byKind: Record<string, number>;
  still: number;
  inside: number;
  hides: number;
  result: MatchResultData;
}
function autoFight(fighter: FighterId, rival: RivalId, seed: number, mode: 'smart' | 'combo', diff: Difficulty = 'pro', deck?: CardId[]): FightStats {
  const m = new Match({ fighter, deck: deck ?? FIGHTERS[fighter].defaultDeck, rival, difficulty: diff, seed, fans: 500, autoPlayer: mode === 'combo' ? undefined : AUTO.smart, arena: 'graveyard' });
  const st: BotState = { think: 0, react: -1, reactKey: '' };
  const stillT = [0, 0];
  let still = 0;
  let inside = 0;
  let breaks = 0;
  const byKind: Record<string, number> = {};
  let hides = 0;
  let ok = true;
  let steps = 0;
  while (m.phase !== 'over' && steps < 60 * (m.duration + 40)) {
    if (mode === 'combo') comboBot(m, st, DT);
    m.step(DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'cover' && e.what === 'break') {
        breaks++;
        const k = m.covers.list[e.index].kind;
        byKind[k] = (byKind[k] ?? 0) + 1;
      }
    }
    steps++;
    if (m.phase !== 'fight') continue;
    for (const f of m.fighters) {
      if (!Number.isFinite(f.x) || !Number.isFinite(f.z) || !Number.isFinite(f.hp)) ok = false;
      inside = Math.max(inside, depth(m));
      const moving = Math.hypot(f.x - f.px, f.z - f.pz) / DT;
      if (f.intentSpeed > 0.5 && moving < 0.3 && f.action.kind === 'none' && f.stun <= 0 && f.knockback <= 0) {
        stillT[f.side] += DT;
        still = Math.max(still, stillT[f.side]);
      } else stillT[f.side] = 0;
    }
    const ai = m.ais[1] as unknown as { hideT: number };
    if (ai.hideT > 0) hides++;
  }
  return { ok: ok && !!m.result, breaks, byKind, still, inside, hides, result: m.result! };
}
{
  let n = 0;
  let ok = 0;
  let still = 0;
  let inside = -9;
  let breaks = 0;
  let wins = 0;
  let ko = 0;
  let hideFrames = 0;
  const kinds: Record<string, number> = {};
  for (const f of FIGHTER_ORDER) {
    for (const r of RIVAL_ORDER) {
      for (let i = 0; i < 2; i++) {
        const s = autoFight(f, r, 9000 + i * 97 + f.length * 13 + r.length, i % 2 ? 'combo' : 'smart');
        n++;
        if (s.ok) ok++;
        still = Math.max(still, s.still);
        inside = Math.max(inside, s.inside);
        breaks += s.breaks;
        hideFrames += s.hides;
        for (const k in s.byKind) kinds[k] = (kinds[k] ?? 0) + s.byKind[k];
        if (s.result.outcome === 'win') wins++;
        if (s.result.method === 'ko') ko++;
      }
    }
  }
  check(`fights: every fighter against every rival on the cemetery finishes normally (${ok}/${n})`, ok === n);
  check(`fights: nobody stuck — longest stand-still while trying to move ${still.toFixed(2)} s`, still < 1.0);
  check(`fights: nobody ever inside a piece (deepest ${Math.max(0, inside).toFixed(3)} m)`, inside < 0.02);
  check(`fights: most cover goes down during a fight (${(breaks / n).toFixed(1)} of ${COV.length} pieces a fight)`, breaks / n >= COV.length * 0.45);
  check(`fights: all three kinds get destroyed (${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')})`, (kinds.pumpkin ?? 0) > 0 && (kinds.tombstone ?? 0) > 0 && (kinds.column ?? 0) > 0);
  check(`fights: rivals take cover only briefly (${((hideFrames / (n * 60 * MATCH.duration)) * 100).toFixed(1)}% of fight time ducked)`, hideFrames > 0 && hideFrames / (n * 60 * MATCH.duration) < 0.08);
  check(`fights: results stay sane (${Math.round((wins / n) * 100)}% wins for the autopilot, ${Math.round((ko / n) * 100)}% by knockout)`, wins / n > 0.5 && ko > 0);
}
// object and movement cards in decks, on the cemetery (Lucien with BAT BITE, everyone with the 1.6 cards)
{
  const decks: [FighterId, CardId[]][] = [
    ['lucien', ['dash', 'backtrack', 'overdrive', 'bat_bite']],
    ['ray', ['stage_barrier', 'prop_drop', 'dash', 'power_shot']],
    ['bruno', ['pulse_push', 'knockout', 'dash', 'shield']],
    ['nika', ['pressure_mine', 'gravity_net', 'holo_decoy', 'backtrack']],
    ['kai', ['rebound_disc', 'cable_snare', 'dash', 'charged_shot']],
    ['rina', ['split_shot', 'freeze_frame', 'second_take', 'dash']],
  ];
  let worst = -9;
  let still = 0;
  let ok = 0;
  let n = 0;
  for (const [f, deck] of decks) {
    for (let i = 0; i < 4; i++) {
      const s = autoFight(f, RIVAL_ORDER[i % 4], 4100 + i * 59 + f.length, 'smart', 'pro', deck);
      n++;
      if (s.ok) ok++;
      worst = Math.max(worst, s.inside);
      still = Math.max(still, s.still);
    }
  }
  check(`cards: DASH, BACKTRACK, BAT BITE, STAGE BARRIER, PROP DROP, PULSE PUSH, mines, nets, holograms, discs, cables — ${ok}/${n} fights clean, never inside cover (${Math.max(0, worst).toFixed(3)} m), never stuck (${still.toFixed(2)} s)`, ok === n && worst < 0.02 && still < 1.0);
}

// ---------------------------------------------------------- the AI and cover
{
  // a blocked line of fire: the fighter goes round instead of standing behind the stone shooting it
  let cleared = 0;
  let total = 0;
  for (let k = 0; k < 6; k++) {
    const m = new Match({ fighter: 'vega', deck: FIGHTERS.vega.defaultDeck, rival: 'dex', difficulty: 'pro', seed: 300 + k, fans: 0, autoPlayer: AUTO.smart, arena: 'graveyard' });
    while (m.phase !== 'fight') {
      m.step(DT);
      m.drainEvents();
    }
    const col = m.covers.list.find((c) => c.kind === 'column' && c.z > 0)!;
    place(m, 0, col.x + (k % 2 ? 0.1 : -0.1), col.z + 2.6);
    place(m, 1, col.x, col.z - 2.2);
    m.ais[1].hold = true;
    let t = 0;
    while (t < 3 && m.covers.onLine(m.fighters[0].x, m.fighters[0].z, m.fighters[1].x, m.fighters[1].z, 0.1)) {
      m.step(DT);
      m.drainEvents();
      t += DT;
    }
    total++;
    if (t < 3) cleared++;
  }
  check(`AI: with a column blocking the line it finds an angle within 3 s (${cleared}/${total})`, cleared >= total - 1);
  // a POWER SHOT charging: a fighter next to cover ducks behind it (sometimes), then comes out again
  let ducked = 0;
  let cameOut = 0;
  for (let k = 0; k < 12; k++) {
    const m = new Match({ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, rival: 'zoe', difficulty: 'champion', seed: 700 + k, fans: 0, arena: 'graveyard' });
    while (m.phase !== 'fight') {
      m.step(DT);
      m.drainEvents();
    }
    const tomb = m.covers.list.find((c) => c.kind === 'tombstone' && c.z > 0)!;
    place(m, 0, tomb.x - 1.6, tomb.z + 0.4);
    place(m, 1, tomb.x - 0.4, tomb.z - 3.6);
    m.ais[1].hold = true;
    const foe = m.fighters[1];
    foe.action = { kind: 'windup', card: 'power_shot', t: 0, total: 1.4, lockAt: 0.6, locked: false, dirX: 0, dirZ: 1, combo: null, telegraph: true };
    const ai = m.ais[0] as unknown as { hideT: number };
    let hid = false;
    for (let i = 0; i < 60 * 1.3; i++) {
      m.step(DT);
      m.drainEvents();
      if (ai.hideT > 0) hid = true;
      if (foe.action.kind === 'windup') foe.action.t = Math.min(foe.action.t, 1.2);
    }
    if (hid) ducked++;
    foe.action = { kind: 'none' };
    for (let i = 0; i < 60 * 1.0; i++) {
      m.step(DT);
      m.drainEvents();
    }
    if (hid && ai.hideT <= 0) cameOut++;
  }
  check(`AI: a charging POWER SHOT next to a tombstone — it ducks behind it in ${ducked}/12 tries and always comes out again (${cameOut}/${ducked})`, ducked >= 3 && ducked <= 11 && cameOut === ducked);
  // cards: the rival does not waste a POWER SHOT or a charge into a stone between them
  const m = new Match({ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, rival: 'dex', difficulty: 'champion', seed: 5, fans: 0, arena: 'graveyard' });
  while (m.phase !== 'fight') {
    m.step(DT);
    m.drainEvents();
  }
  const col = m.covers.list.find((c) => c.kind === 'column' && c.z > 0)!;
  place(m, 0, col.x, col.z + 2.0);
  place(m, 1, col.x, col.z - 2.0);
  const ai = m.ais[1] as unknown as { score(card: CardId, f: unknown, foe: unknown, dist: number): number };
  const blocked = ai.score('power_shot', m.fighters[1], m.fighters[0], 4);
  const ko = ai.score('knockout', m.fighters[1], m.fighters[0], 4);
  const charged = ai.score('charged_shot', m.fighters[1], m.fighters[0], 4);
  place(m, 0, col.x - 2.4, col.z + 2.0);
  const open = ai.score('power_shot', m.fighters[1], m.fighters[0], 4);
  check(`AI cards: with a column in between, POWER SHOT (${blocked.toFixed(1)}) and KNOCKOUT (${ko.toFixed(1)}) wait; CHARGED SHOT (${charged.toFixed(1)}) is fine; a clear line restores POWER SHOT (${open.toFixed(1)})`, blocked < open - 4 && ko < 5 && charged >= open - 1);
}

// ------------------------------------ 14. the season bonus (and its economy)
{
  const aw = HW.earnings!.arenaWin!;
  check(`bonus: +${aw.tokens} ${HW.currency!.name} for a win on the cemetery («${aw.label}»)`, aw.arena === 'graveyard' && aw.tokens === 2);
  const res = (o: Partial<MatchResultData>): MatchResultData => ({ outcome: 'win', method: 'ko', rating: 40, peakRating: 50, avgRating: 30, bestCombo: null, combos: 0, comboList: [], perfects: 0, damageDealt: 1000, damageTaken: 500, cardsUsed: 2, duration: 60, playerHpFrac: 0.5, enemyHpFrac: 0, finisher: null, ...o }) as MatchResultData;
  const mem = new Mem();
  let now = T('2026-10-25T12:00:00Z');
  const em = new EventManager(mem as unknown as SaveSystem, { clock: () => now, settings: { mode: 'auto', forcedEventId: 'none' } });
  const pay = (o: Partial<MatchResultData>, arena: 'graveyard' | 'haunted' | undefined, id: string | null = 'halloween-2026') => em.applyMatch(id, res(o), 'pro', arena);
  const w = pay({}, 'graveyard')!;
  check(`bonus: a knockout win on the cemetery pays win + bonus (${w.tokens}: ${w.lines.map((l) => `${l.label} ${l.value}`).join(', ')})`, w.tokens === 6 && w.lines.some((l) => l.label === aw.label && l.value === 2));
  check('bonus: a win on time counts too', pay({ method: 'time' }, 'graveyard')!.lines.some((l) => l.label === aw.label));
  check('bonus: not for a win on another set', !pay({}, 'haunted')!.lines.some((l) => l.label === aw.label) && !pay({}, undefined)!.lines.some((l) => l.label === aw.label));
  check('bonus: not for a loss or a draw on the cemetery', !pay({ outcome: 'loss', method: 'time' }, 'graveyard')!.lines.some((l) => l.label === aw.label) && !pay({ outcome: 'draw', method: 'time' }, 'graveyard')!.lines.some((l) => l.label === aw.label));
  check('bonus: nothing at all for a forfeit (even one recorded as a win)', pay({ method: 'forfeit' }, 'graveyard')!.tokens === 0 && pay({ outcome: 'loss', method: 'forfeit' }, 'graveyard')!.tokens === 0);
  check('bonus: a match outside the event pays nothing (no event id)', pay({}, 'graveyard', null) === null);
  // the daily cap holds with the bonus inside it
  const mem2 = new Mem();
  const em2 = new EventManager(mem2 as unknown as SaveSystem, { clock: () => now, settings: { mode: 'auto', forcedEventId: 'none' } });
  let day = 0;
  for (let i = 0; i < 20; i++) day += em2.applyMatch('halloween-2026', res({ rating: 90, combos: 3 }), 'pro', 'graveyard')!.tokens;
  check(`bonus: inside the daily cap — 20 big cemetery wins in a day pay ${day} (cap ${HW.earnings!.dailyCap})`, day === HW.earnings!.dailyCap);
  // after the event the picker shows no bonus, and a manual preview without its rewards none either
  now = T('2026-11-04T00:00:01Z');
  em.refresh();
  check('bonus: after the event no bonus is offered (picker chip) — the set itself stays open', em.arenaBonus('graveyard') === null && arenaAvailable(GY, em.themeId));
  check('bonus: a cemetery win after the event pays no tokens at all (no event id → nothing)', pay({}, 'graveyard', null) === null);
  now = T('2026-10-25T12:00:00Z');
  em.refresh();
  check('bonus: offered in the picker while the event pays', em.arenaBonus('graveyard')?.tokens === 2 && em.arenaBonus('haunted') === null);
  const preview = new EventManager(new Mem() as unknown as SaveSystem, { clock: () => T('2026-12-10T12:00:00Z'), settings: { mode: 'manual', forcedEventId: 'halloween-2026' } });
  check('bonus: a manual Halloween preview outside its dates shows the set but pays no bonus', arenaAvailable(GY, preview.themeId) && preview.arenaBonus('graveyard') === null);
  // once per match: the game uses up the event id when it pays
  const game = readFileSync('src/game/Game.ts', 'utf8');
  check('bonus: once per match — Game hands the set over and clears the event id right after paying', /applyMatch\(this\.matchEventId, m\.result, meta\.difficulty, m\.cfg\.arena\);\s*this\.matchEventId = null;/.test(game));
  check('bonus: not from FIRST BROADCAST, Survival waves report per attempt as before', game.includes("mode.kind !== 'survival' && mode.kind !== 'tutorial' && this.events.playable"));
  check('BOSS FIGHT never takes place among the tombstones (the cemetery hands it to HAUNTED PRIME SET)', game.includes("if (mode.kind === 'boss' && arenaById(id).covers?.length) return 'haunted';"));
  // economy: real fights through the real exchange — days to LUCIEN (500) with and without the bonus
  class Bare {
    data: SaveData = defaultSave();
    save(): void {}
  }
  const dayTo = (mode: Mode, diff: Difficulty, perDay: number, bonus: boolean, arena: 'graveyard' | 'original' = 'graveyard') => {
    let clock = T('2026-10-20T09:00:00Z');
    const e = new EventManager(new Bare() as unknown as SaveSystem, { clock: () => clock, settings: { mode: 'auto', forcedEventId: 'none' } });
    let seed = 101;
    let tokens = 0;
    let n = 0;
    for (let d = 0; d < 15; d++) {
      clock = T('2026-10-20T09:00:00Z') + d * 86400000;
      e.refresh();
      for (let k = 0; k < perDay; k++) {
        const { m } = runMatch('ray', RIVAL_ORDER[seed % 4], diff, mode, seed * 31, undefined, undefined, undefined, arena);
        seed++;
        tokens += e.applyMatch('halloween-2026', m.result!, diff, bonus ? 'graveyard' : undefined)?.tokens ?? 0;
        n++;
        for (const q of e.quests()) if (q.done && !q.claimed) e.claimQuest(q.def.id);
        if (e.tokens() >= 500) return { day: d + 1, perMatch: tokens / n };
      }
    }
    return { day: 99, perMatch: tokens / n };
  };
  // the same five fights a day on the original studio, on the cemetery without and with the bonus
  const ao = dayTo('combo', 'pro', 5, false, 'original');
  const a0 = dayTo('combo', 'pro', 5, false);
  const a1 = dayTo('combo', 'pro', 5, true);
  const bo = dayTo('mash', 'rookie', 5, false, 'original');
  const b0 = dayTo('mash', 'rookie', 5, false);
  const b1 = dayTo('mash', 'rookie', 5, true);
  const f = (x: { day: number; perMatch: number }) => `${x.perMatch.toFixed(1)}/fight day ${x.day}`;
  console.log(`  economy, 5 fights a day — deliberate: original ${f(ao)} | cemetery ${f(a0)} | cemetery+bonus ${f(a1)}`);
  console.log(`  economy, 5 fights a day — random-card: original ${f(bo)} | cemetery ${f(b0)} | cemetery+bonus ${f(b1)}`);
  check(`economy: without a bonus the cemetery pays less than the ordinary studio (harder fights: ${a0.perMatch.toFixed(1)} < ${ao.perMatch.toFixed(1)}, ${b0.perMatch.toFixed(1)} < ${bo.perMatch.toFixed(1)} tokens a fight)`, a0.perMatch < ao.perMatch && b0.perMatch < bo.perMatch);
  check(`economy: with it, a cemetery fight pays at most ~1.5 tokens more than an ordinary one (deliberate +${(a1.perMatch - ao.perMatch).toFixed(1)}, random-card +${(b1.perMatch - bo.perMatch).toFixed(1)})`, a1.perMatch - ao.perMatch <= 1.6 && b1.perMatch - bo.perMatch <= 1.6 && a1.perMatch > a0.perMatch);
  check(`economy: LUCIEN's price holds — deliberate player day ${a1.day} (ordinary studio: day ${ao.day}), random-card day ${b1.day} (ordinary: ${bo.day}); never more than 2 days sooner, never day one`, a1.day >= 3 && ao.day - a1.day <= 1 && bo.day - b1.day <= 2 && b1.day >= 5);
  const quests = HW.quests.reduce((s, q) => s + q.reward, 0);
  check(`economy: the season maximum is unchanged — the bonus lives inside the daily cap (${quests} + ${HW.earnings!.dailyCap}×15 = ${quests + HW.earnings!.dailyCap * 15})`, quests === 305 && HW.earnings!.dailyCap === 60);
}

// ------------------------------------------- 15. no accumulation in the simulation
{
  const m = new Match({ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, rival: 'dex', difficulty: 'pro', seed: 77, fans: 0, autoPlayer: AUTO.smart, arena: 'graveyard' });
  let maxProj = 0;
  let steps = 0;
  while (m.phase !== 'over' && steps < 60 * 130) {
    m.step(DT);
    m.drainEvents();
    maxProj = Math.max(maxProj, m.projectiles.length);
    steps++;
  }
  check(`no build-up: the cover list keeps its ${COV.length} pieces, projectiles stay few (peak ${maxProj})`, m.covers.list.length === COV.length && maxProj < 40);
  const fresh = new Match({ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, rival: 'dex', difficulty: 'pro', seed: 78, fans: 0, arena: 'graveyard' });
  check('next fight: every piece stands again, intact (nothing carries over, nothing respawns mid-fight)', fresh.covers.live === COV.length && fresh.covers.list.every((c) => c.alive && c.stage === 0 && c.hp === c.maxHp) && m.covers.list.some((c) => !c.alive));
}

// --------------------------------------- 16. other sets, modes and saves unchanged
{
  // the same automatic fight on the original studio, with and without the 1.7.5 code paths: no cover = no change
  const a = runMatch('kai', 'zoe', 'pro', 'smart', 4242);
  const b = runMatch('kai', 'zoe', 'pro', 'smart', 4242, undefined, undefined, undefined, 'haunted');
  const fp = (m: Match) => `${m.result!.outcome}/${m.result!.method}/${Math.round(m.result!.damageDealt)}/${Math.round(m.result!.damageTaken)}/${m.result!.rating}/${m.time.toFixed(3)}`;
  check(`other sets: the same fight on the original and the haunted studio is identical (${fp(a.m)})`, fp(a.m) === fp(b.m) && a.m.covers.list.length === 0 && b.m.covers.list.length === 0);
  check('saves: a 1.7.1 save (version 11) keeps its set and money (schema 12 since Alpha 1.8)', (() => {
    const old = { ...defaultSave(), version: 11, arena: 'haunted', money: 777 };
    const s = sanitize(JSON.parse(JSON.stringify(old)));
    return s.version === 12 && s.arena === 'haunted' && s.money === 777;
  })());
}

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
}
console.log(ok ? `\ngraveyard: OK (${checks.length} checks)` : '\ngraveyard: FAILED');
const proc = (globalThis as { process?: { exitCode?: number } }).process;
if (!ok && proc) proc.exitCode = 1;
