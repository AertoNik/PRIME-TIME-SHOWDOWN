// Headless checks for Alpha 1.6 — CARD REVOLUTION (npm run cards): the fifteen new cards,
// their mechanics, the combos and hints, safety limits (energy, control, stacking), cleanup
// between fights, the boss rules, the card shop and the save. In-memory save, no browser.
// Alpha 1.6.1 — CARD REFINEMENT: SECOND TAKE (replaces SIDE CAM), the FREEZE FRAME ring that
// follows its fighter, STAGE BARRIER placement at every distance, the FRAME CATCH parry.
import { CARD_TUNING, COMBO_TUNING, MATCH } from '../src/config/balance';
import { CARDS, COMBOS, NEW_CARDS, TAKE_CARDS, UNIVERSAL_CARDS, comboFor, deckCombos } from '../src/config/cards';
import { FIGHTERS, FIGHTER_ORDER } from '../src/config/fighters';
import type { CardId, ComboId, FighterId, RivalId } from '../src/config/types';
import { Match } from '../src/combat/Match';
import type { MatchEvent, Projectile, StageObject } from '../src/combat/types';
import { pointSegDist } from '../src/core/math';
import { CareerSystem } from '../src/meta/CareerSystem';
import { defaultSave, sanitize, validDeck, type SaveData, type SaveSystem } from '../src/meta/SaveSystem';
import { CARD_ICONS } from '../src/ui/icons';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const DT = 1 / 60;

class MemSave {
  data: SaveData = defaultSave();
  save(): void {
    this.data = sanitize(JSON.parse(JSON.stringify(this.data))); // round-trip like localStorage
  }
  get persistent(): boolean {
    return true;
  }
  reset(): void {
    this.data = defaultSave();
  }
}

/** A fight that has just started, both brains switched off (positions and cards set by the test). */
function arena(fighter: FighterId = 'ray', rival: RivalId = 'dex', boss?: string): Match {
  const m = new Match({ fighter, deck: FIGHTERS[fighter].defaultDeck, rival, difficulty: 'pro', seed: 77, fans: 0, boss, mods: boss ? { duration: 120, timeUpRule: 'rival' } : undefined });
  for (const ai of m.ais) ai.update = () => {};
  while (m.phase !== 'fight') m.step(DT);
  for (const f of m.fighters) {
    f.intentSpeed = 0;
    f.wantFire = false;
  }
  return m;
}
function place(m: Match, px: number, pz: number, ex: number, ez: number): void {
  const [p, e] = m.fighters;
  p.place(px, pz, Math.atan2(ex - px, ez - pz));
  e.place(ex, ez, Math.atan2(px - ex, pz - ez));
  for (const f of m.fighters) {
    f.vx = f.vz = 0;
    f.hist.length = 0;
  }
  // brains off: aim and "seen" positions are the real ones
  aimAt(m);
}
function aimAt(m: Match): void {
  const [p, e] = m.fighters;
  for (const [a, b] of [
    [p, e],
    [e, p],
  ]) {
    a.aimX = a.cardAimX = a.seenX = b.x;
    a.aimZ = a.cardAimZ = a.seenZ = b.z;
    a.seenVX = b.vx;
    a.seenVZ = b.vz;
  }
}
/** Put `cards` in the player's hand with full energy and no lockout, play hand slot 0. */
function play(m: Match, card: CardId, side: 0 | 1 = 0, energy = 10): string | null {
  const h = m.hands[side];
  h.hand = [card, h.hand[1] ?? 'dash', h.hand[2] ?? 'shield'];
  h.energy = energy;
  h.lockout = 0;
  return m.playCard(side, 0);
}
function run(m: Match, secs: number, every?: () => void): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (let i = 0; i < Math.round(secs / DT); i++) {
    aimAt(m);
    every?.();
    m.step(DT);
    out.push(...m.drainEvents());
  }
  return out;
}

// ------------------------------------------------------------- registry
{
  check(`registry: exactly 15 new cards, all different (${NEW_CARDS.length})`, NEW_CARDS.length === 15 && new Set(NEW_CARDS).size === 15);
  const expected: Record<string, number> = {
    spotlight_tag: 2,
    split_shot: 3,
    rebound_disc: 3,
    prop_drop: 3,
    pulse_push: 2,
    gravity_net: 2,
    pressure_mine: 2,
    stage_barrier: 2,
    cable_snare: 2,
    holo_decoy: 2,
    frame_catch: 2,
    backtrack: 2,
    high_stakes: 1,
    second_take: 3,
    freeze_frame: 2,
  };
  check('registry: every new card has its tuned energy cost (1–4)', NEW_CARDS.every((c) => CARDS[c].cost === expected[c]));
  check('registry: every new card has an icon, a family, a gesture, a counter text and a shop entry', NEW_CARDS.every((c) => CARD_ICONS[c]?.includes('<svg') && !!CARDS[c].family && !!CARDS[c].cast && (CARDS[c].counter?.length ?? 0) > 20 && !!CARDS[c].shop));
  check('registry: no new card is a fighter exclusive', NEW_CARDS.every((c) => !CARDS[c].exclusive));
  check('registry: the six basic cards are unchanged and free', UNIVERSAL_CARDS.join() === 'dash,power_shot,shield,smoke,shock,overdrive' && UNIVERSAL_CARDS.every((c) => !CARDS[c].shop));
  check('registry: every new card takes part in at least one combo', NEW_CARDS.every((c) => COMBOS.some((x) => x.first.includes(c) || x.second.includes(c))));
  // every card pair maps to at most one plain combo (no hidden overlaps)
  let overlap = 0;
  for (const a of Object.keys(CARDS) as CardId[])
    for (const b of Object.keys(CARDS) as CardId[]) if (COMBOS.filter((x) => !x.after && x.first.includes(a) && x.second.includes(b)).length > 1) overlap++;
  check('registry: no two combos claim the same pair of cards', overlap === 0);
  check('registry: the five classic combos are still there with their pairs', ['counter_strike', 'electro_blast', 'iron_rush', 'phantom_step', 'superstar'].every((id) => COMBOS.some((x) => x.id === id)) && comboFor('dash', 'power_shot')?.id === 'counter_strike' && comboFor('shield', 'overdrive')?.id === 'iron_rush' && comboFor('smoke', 'dash')?.id === 'phantom_step');
  check('registry: new combos have a Russian label and a description', COMBOS.filter((x) => !['counter_strike', 'electro_blast', 'iron_rush', 'phantom_step', 'superstar'].includes(x.id)).every((x) => !!x.tag && x.desc.length > 30));
  check('registry: only JACKPOT multiplies damage among the new combos', COMBO_TUNING.jackpotMult > 1 && COMBO_TUNING.jackpotMult <= 1.3);
}

// --------------------------------------------------------------- energy
{
  let ok = true;
  for (const c of NEW_CARDS) {
    const m = arena();
    place(m, 0, 3, 0, -3);
    const r = play(m, c, 0, CARDS[c].cost - 0.5);
    if (r !== 'energy' || m.hands[0].hand[0] !== c) ok = false;
  }
  check('energy: no new card can be played without its energy (it stays in hand)', ok);
  let played = true;
  for (const c of NEW_CARDS) {
    const m = arena();
    place(m, 0, 2.5, 0, -2.5);
    if (c === 'high_stakes') m.fighters[0].hp = m.fighters[0].maxHp;
    if (c === 'second_take') m.combat.recordTake(m.fighters[0], 'power_shot');
    const r = play(m, c);
    const e = m.drainEvents();
    if (r !== null || !e.some((x) => x.type === 'cast' && x.card === c)) played = false;
    run(m, 0.5);
  }
  check('energy: with energy every new card plays and announces its gesture', played);
}

// ------------------------------------------------------------ mechanics
// SPOTLIGHT TAG
{
  const m = arena();
  place(m, 0, 3, 0, -3);
  const [p, e] = m.fighters;
  play(m, 'spotlight_tag');
  check('SPOTLIGHT TAG: the opponent is marked for 6 s by the player', e.tag === CARD_TUNING.spotlight_tag.duration && e.tagBy === 0);
  const hit = (boost: number) => {
    const hp = e.hp;
    m.combat.applyHit(e, p, { damage: 600 * boost, kind: 'power', heavy: true, crit: false, electric: false, combo: null, knockback: 0, stun: 0, slowAmount: 0, slowDuration: 0, dx: 0, dz: -1, sure: true, projectile: null, boost });
    return hp - e.hp;
  };
  const tagged = hit(1);
  const plain = hit(1);
  check(`SPOTLIGHT TAG: the marked POWER SHOT deals +25% once (${tagged} vs ${plain})`, Math.abs(tagged / plain - 1.25) < 0.01 && e.tag === 0);
  e.tag = 6;
  e.tagBy = 0;
  const cs = hit(COMBO_TUNING.counterStrikeMult);
  const cs2 = hit(COMBO_TUNING.counterStrikeMult);
  check(`SPOTLIGHT TAG + COUNTER STRIKE ×1.5: the larger bonus counts, never both (${cs} = ${cs2})`, cs === cs2);
  e.tag = 6;
  m.spawnSmoke(e);
  run(m, 0.3);
  check('SPOTLIGHT TAG: the target\'s own SMOKE hides it and clears the mark', e.tag === 0);
}
// SPLIT SHOT
{
  for (const f of ['bruno', 'nika', 'rina'] as FighterId[]) {
    const m = arena(f);
    place(m, 0, 2, 0, -2);
    play(m, 'split_shot');
    const split = m.projectiles.filter((x) => x.kind === 'split' && x.owner === 0).length;
    const other = m.projectiles.filter((x) => x.kind !== 'split' && x.owner === 0).length;
    const fp = m.fighters[0];
    check(`SPLIT SHOT (${f}): exactly 3 bolts, no extra pellets or burst (${split}+${other}), the next regular volley waits`, split === 3 && other === 0 && fp.burstLeft === 0 && fp.fireTimer >= fp.stats.attack.interval * 0.99 / fp.fireRateMult());
  }
  const m = arena();
  place(m, 0, 1.8, 0, -1.8);
  const ev = run(m, 0.01, () => undefined);
  void ev;
  play(m, 'split_shot');
  const near = run(m, 0.6).filter((x) => x.type === 'hit' && x.kind === 'split').length;
  const m2 = arena();
  place(m2, 0, 4, 0, -4);
  play(m2, 'split_shot');
  const far = run(m2, 0.8).filter((x) => x.type === 'hit' && x.kind === 'split').length;
  check(`SPLIT SHOT: point blank more bolts land than from afar (${near} vs ${far})`, near >= 2 && far <= 1);
}
// REBOUND DISC
{
  const m = arena();
  place(m, 0, 3, 0, -1);
  play(m, 'rebound_disc');
  let turned = false;
  let life = 0;
  const ev = run(m, 3.2, () => {
    const d = m.projectiles.find((x) => x.kind === 'disc');
    if (d) {
      if (d.ret) turned = true;
      life = d.life;
    }
  });
  const hits = ev.filter((x) => x.type === 'hit' && x.kind === 'disc').length;
  check(`REBOUND DISC: flies out, turns back, lands at most twice (out + back: ${hits})`, turned && hits >= 1 && hits <= 2);
  check(`REBOUND DISC: never lives longer than ${CARD_TUNING.rebound_disc.maxTime} s and is gone afterwards (${life.toFixed(2)} s)`, life <= CARD_TUNING.rebound_disc.maxTime + 0.02 && !m.projectiles.some((x) => x.kind === 'disc'));
  const m2 = arena();
  place(m2, 0, 3, 3, -1);
  const e2 = m2.fighters[1];
  play(m2, 'rebound_disc');
  const dir0 = m2.projectiles.find((x) => x.kind === 'disc')!;
  const yaw0 = Math.atan2(dir0.vx, dir0.vz);
  e2.place(-3, -1, 0); // the target moves away at once: the disc keeps its line
  run(m2, 0.3);
  const d2 = m2.projectiles.find((x) => x.kind === 'disc');
  check('REBOUND DISC: does not steer towards the target on the way out', !!d2 && Math.abs(Math.atan2(d2.vx, d2.vz) - yaw0) < 1e-6);
}
// PROP DROP
{
  const m = arena();
  place(m, 0, 4, 0, -2);
  play(m, 'prop_drop');
  const marker = m.objects.list.find((o) => o.kind === 'prop')!;
  check('PROP DROP: a warning circle appears first (no damage yet)', !!marker && marker.stage === 'warn' && m.fighters[1].hp === m.fighters[1].maxHp);
  const ev = run(m, CARD_TUNING.prop_drop.delay + 0.1);
  check('PROP DROP: a target that stays gets hit once, no stun', ev.filter((x) => x.type === 'hit' && x.kind === 'prop').length === 1 && m.fighters[1].stun === 0);
  const m2 = arena();
  place(m2, 0, 4, 0, -2);
  play(m2, 'prop_drop');
  m2.fighters[1].place(3, -4.5, 0); // leaves the circle
  const ev2 = run(m2, CARD_TUNING.prop_drop.delay + 0.1);
  check('PROP DROP: leaving the circle in time avoids it', ev2.filter((x) => x.type === 'hit' && x.kind === 'prop').length === 0);
  run(m2, 1.5);
  check('PROP DROP: the set piece is cleared away after it lands', m2.objects.list.length === 0);
}
// PULSE PUSH
{
  const m = arena();
  place(m, 0, 1, 0, -1);
  play(m, 'pulse_push');
  run(m, 1);
  const d = Math.hypot(m.fighters[1].x - m.fighters[0].x, m.fighters[1].z - m.fighters[0].z);
  check(`PULSE PUSH: a close opponent slides back about 2.4 m (${(d - 2).toFixed(2)} m), no stun / knockback`, d - 2 > 1.7 && m.fighters[1].stun === 0 && m.fighters[1].knockback === 0);
  const far = arena();
  place(far, 0, 3, 0, -3);
  play(far, 'pulse_push');
  run(far, 1);
  check('PULSE PUSH: out of reach (6 m) nothing moves', Math.abs(far.fighters[1].z + 3) < 0.01);
  const heavy = arena('ray', 'tank');
  place(heavy, 0, 1, 0, -1);
  play(heavy, 'pulse_push');
  run(heavy, 1);
  const dh = Math.abs(heavy.fighters[1].z + 1);
  check(`PULSE PUSH: a heavy fighter slides less (${dh.toFixed(2)} m < ${(d - 2).toFixed(2)} m)`, dh < d - 2 - 0.4);
  const wall = arena();
  place(wall, 0, -5, 0, -6.4);
  play(wall, 'pulse_push');
  run(wall, 1);
  check('PULSE PUSH: never out of the arena, no wall slam', Math.abs(wall.fighters[1].z) <= 6.61 && wall.fighters[1].stun === 0);
  const boss = arena('vega', 'vale', 'vale');
  place(boss, 0, 1, 0, -1);
  play(boss, 'pulse_push');
  run(boss, 1);
  const db = Math.abs(boss.fighters[1].z + 1);
  check(`PULSE PUSH: the champion barely moves (${db.toFixed(2)} m)`, db < 1.3);
}
// GRAVITY NET
{
  const m = arena();
  place(m, 0, 3, 0, -2);
  play(m, 'gravity_net');
  run(m, 0.5);
  const e = m.fighters[1];
  check('GRAVITY NET: the opponent in the net moves at 55% speed', Math.abs(e.speedMult() - CARD_TUNING.gravity_net.slow) < 1e-6);
  e.slow = 2;
  e.slowAmount = 0.3;
  check('GRAVITY NET: does not stack with another slow (the stronger one counts)', Math.abs(e.speedMult() - CARD_TUNING.gravity_net.slow) < 1e-6);
  e.slow = 0;
  check('GRAVITY NET: the owner is not slowed by their own net', m.fighters[0].speedMult() === 1);
  run(m, CARD_TUNING.gravity_net.duration + 0.5);
  check('GRAVITY NET: after its time the field is gone and the speed is back', m.objects.list.length === 0 && e.speedMult() === 1);
  const b = arena('vega', 'vale', 'vale');
  place(b, 0, 3, 0, -2);
  play(b, 'gravity_net');
  run(b, 0.5);
  check('GRAVITY NET: weaker on the champion (80% speed)', Math.abs(b.fighters[1].speedMult() - CARD_TUNING.gravity_net.bossSlow) < 1e-6);
}
// PRESSURE MINE
{
  const m = arena();
  place(m, 0, 3, 0, -2);
  m.fighters[1].vx = 0;
  play(m, 'pressure_mine');
  const mine = m.objects.list.find((o) => o.kind === 'mine')!;
  const gap = Math.hypot(mine.x - m.fighters[1].x, mine.z - m.fighters[1].z);
  check(`PRESSURE MINE: never lands right under the opponent (${gap.toFixed(2)} m ≥ ${CARD_TUNING.pressure_mine.minGap} m)`, gap >= CARD_TUNING.pressure_mine.minGap * 0.9);
  run(m, CARD_TUNING.pressure_mine.flight + CARD_TUNING.pressure_mine.arm + 0.05);
  check('PRESSURE MINE: lands, then arms after a short delay', mine.stage === 'armed');
  const ev = run(m, 0.5, () => m.fighters[1].place(mine.x, mine.z, 0));
  check('PRESSURE MINE: stepping in sets it off once (no stun, the mine is gone)', ev.filter((x) => x.type === 'hit' && x.kind === 'mine').length === 1 && m.fighters[1].stun === 0 && !m.objects.list.some((o) => o.kind === 'mine'));
  const n = arena();
  place(n, 0, 3, 0, -2);
  play(n, 'pressure_mine');
  play(n, 'pressure_mine');
  play(n, 'pressure_mine');
  run(n, 0.05);
  check(`PRESSURE MINE: at most ${CARD_TUNING.pressure_mine.max} at a time (the oldest goes)`, n.objects.list.filter((o) => o.kind === 'mine').length === CARD_TUNING.pressure_mine.max);
  run(n, CARD_TUNING.pressure_mine.flight + CARD_TUNING.pressure_mine.arm + CARD_TUNING.pressure_mine.life + 0.3);
  check('PRESSURE MINE: an untouched mine expires', n.objects.list.length === 0);
}
// STAGE BARRIER
{
  const m = arena('vega');
  place(m, 0, 3, 0, -3);
  play(m, 'stage_barrier');
  const [p, e] = m.fighters;
  const shoot = (from: 0 | 1, kind: Projectile['kind'] = 'auto', pierce = 0) => {
    const a = m.fighters[from];
    const b = m.fighters[1 - from];
    m.combat.spawn(from, kind, a.stats.attack.weapon, a.x, a.z, Math.atan2(b.x - a.x, b.z - a.z), 20, 100, 0.2, 12, { pierce });
  };
  const hp0 = p.hp;
  shoot(1);
  run(m, 0.5);
  check('STAGE BARRIER: stops the opponent\'s shot', p.hp === hp0);
  const ehp = e.hp;
  shoot(0);
  run(m, 0.5);
  check('STAGE BARRIER: stops the owner\'s own shot too (both sides)', e.hp === ehp);
  shoot(1, 'power', 0.5);
  run(m, 0.5);
  check('STAGE BARRIER: CHARGED SHOT goes through', p.hp < hp0);
  const b = m.objects.list.find((o) => o.kind === 'barrier')!;
  m.objects.damageBarrier(b, 5000, b.x, b.z);
  run(m, 0.1);
  check('STAGE BARRIER: breaks when its hit points run out', !m.objects.list.some((o) => o.kind === 'barrier'));
  // the champion's DIRECTOR'S CUT ignores the screen
  const c = arena('vega', 'vale', 'vale');
  place(c, 0, 2.5, 0, -4);
  play(c, 'stage_barrier');
  const boss = c.fighters[1];
  boss.cutCd = 0;
  const hpB = c.fighters[0].hp;
  play(c, 'directors_cut', 1);
  const cut = run(c, 6, () => {
    c.fighters[0].place(0, 2.5, Math.PI);
  });
  check('STAGE BARRIER: DIRECTOR\'S CUT is not blocked by it (the lines still hit)', cut.some((x) => x.type === 'cutShot' && x.outcome === 'hit') && c.fighters[0].hp < hpB);
}
// STAGE BARRIER placement (Alpha 1.6.1): between the fighters at every distance, never behind
// the opponent, never inside anybody, the fighters are not moved
{
  const ends = (b: StageObject) => [b.x - b.dirX * b.radius, b.z - b.dirZ * b.radius, b.x + b.dirX * b.radius, b.z + b.dirZ * b.radius] as const;
  const bad: string[] = [];
  let between = 0;
  let farBetween = 0;
  let farCount = 0;
  const cases: [number, number, number, number][] = [];
  for (const d of [0.9, 1.2, 1.6, 2.2, 3, 4, 5.5, 7.5]) cases.push([0, d / 2, 0, -d / 2]);
  // diagonal, near a wall and in a corner
  cases.push([2, 2, -1, -1], [4.6, 1, 4.6, -2], [-4.5, 6.4, -2.5, 4.5], [4.6, -6.4, 3.5, -5.2]);
  for (const [px, pz, ex, ez] of cases) {
    const m = arena('vega');
    place(m, px, pz, ex, ez);
    const [p, e] = m.fighters;
    const r = play(m, 'stage_barrier');
    const b = m.objects.list.find((o) => o.kind === 'barrier');
    const d = Math.hypot(ex - px, ez - pz);
    if (r !== null || !b) {
      bad.push(`d=${d.toFixed(1)}: not placed`);
      continue;
    }
    const [ax, az, bx, bz] = ends(b);
    const cp = pointSegDist(p.x, p.z, ax, az, bx, bz);
    const ce = pointSegDist(e.x, e.z, ax, az, bx, bz);
    const clear = CARD_TUNING.stage_barrier.clear - 0.06;
    // projection of the screen on the owner → opponent line (0 = owner, d = opponent)
    const t = ((b.x - px) * (ex - px) + (b.z - pz) * (ez - pz)) / d;
    const moved = Math.hypot(p.x - px, p.z - pz) + Math.hypot(e.x - ex, e.z - ez);
    if (cp < clear || ce < clear) bad.push(`d=${d.toFixed(1)}: inside a fighter (${cp.toFixed(2)}/${ce.toFixed(2)})`);
    if (t >= d - 0.05) bad.push(`d=${d.toFixed(1)}: behind the opponent`);
    if (moved > 1e-6) bad.push(`d=${d.toFixed(1)}: fighters moved`);
    if (t > 0 && t < d) between++;
    if (d >= 2.2) {
      farCount++;
      if (t > 0 && t < d) farBetween++;
    }
  }
  check(`STAGE BARRIER: placed at ${cases.length} distances / spots — never inside a fighter, never behind the opponent, nobody pushed${bad.length ? ' — ' + bad.join('; ') : ''}`, bad.length === 0);
  check(`STAGE BARRIER: from 2.2 m up the screen stands between the fighters (${farBetween}/${farCount}; ${between}/${cases.length} overall)`, farBetween === farCount);
  // it lasts its time
  const m = arena('vega');
  place(m, 0, 3, 0, -3);
  play(m, 'stage_barrier');
  run(m, CARD_TUNING.stage_barrier.duration + 0.2);
  check('STAGE BARRIER: limited time — gone after its duration', !m.objects.list.some((o) => o.kind === 'barrier'));
  // the opponent's brain walks round a screen that blocks its line of fire
  const a = new Match({ fighter: 'vega', deck: FIGHTERS.vega.defaultDeck, rival: 'dex', difficulty: 'pro', seed: 21, fans: 0 });
  while (a.phase !== 'fight') a.step(DT);
  a.ais[0].update = () => {};
  a.fighters[0].intentSpeed = 0;
  a.fighters[0].wantFire = false;
  place(a, 0, 3, 0, -3);
  a.hands[1].energy = 0;
  play(a, 'stage_barrier');
  const scr = a.objects.list.find((o) => o.kind === 'barrier')!;
  const [sax, saz, sbx, sbz] = ends(scr);
  const crosses = (x1: number, z1: number, x2: number, z2: number) => {
    const d1 = (sbx - sax) * (z1 - saz) - (sbz - saz) * (x1 - sax);
    const d2 = (sbx - sax) * (z2 - saz) - (sbz - saz) * (x2 - sax);
    const d3 = (x2 - x1) * (saz - z1) - (z2 - z1) * (sax - x1);
    const d4 = (x2 - x1) * (sbz - z1) - (z2 - z1) * (sbx - x1);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  let clearAt = -1;
  for (let i = 0; i < 60 * 3 && clearAt < 0; i++) {
    a.hands[1].energy = 0;
    a.step(DT);
    a.drainEvents();
    const [p, e] = a.fighters;
    p.place(0, 3, p.facing);
    if (!crosses(e.x, e.z, p.x, p.z)) clearAt = i * DT;
  }
  check(`AI: the opponent walks round a screen that blocks its line of fire (clear line after ${clearAt.toFixed(2)} s)`, clearAt >= 0 && clearAt < 2.5);
}
// CABLE SNARE
{
  const m = arena();
  place(m, 0, 3, 0, -2);
  play(m, 'cable_snare');
  run(m, 0.4);
  const e = m.fighters[1];
  check('CABLE SNARE: a hit holds the opponent (tether)', e.tether > 0);
  const ax = e.tetherX;
  const az = e.tetherZ;
  let far = 0;
  run(m, 1.2, () => {
    e.intentX = 1;
    e.intentZ = 0;
    e.intentSpeed = 1;
    far = Math.max(far, Math.hypot(e.x - ax, e.z - az));
  });
  check(`CABLE SNARE: the held fighter moves but never past the cable (${far.toFixed(2)} ≤ ${CARD_TUNING.cable_snare.tether})`, far <= CARD_TUNING.cable_snare.tether + 0.02 && far > 0.5);
  play(m, 'dash', 1);
  run(m, 0.1);
  check('CABLE SNARE: a DASH snaps it', e.tether === 0);
  play(m, 'cable_snare');
  run(m, 0.4);
  check('CABLE SNARE: no new hold right after one ends (short immunity)', e.tether === 0);
}
// HOLO DECOY
{
  const m = new Match({ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, rival: 'dex', difficulty: 'pro', seed: 5, fans: 0 });
  while (m.phase !== 'fight') m.step(DT);
  m.ais[0].update = () => {};
  m.fighters[0].intentSpeed = 0;
  place(m, 0, 3, 0, -3);
  play(m, 'holo_decoy');
  m.ais[1].update(DT);
  m.ais[1].update = () => {};
  m.fighters[1].wantFire = false;
  const e = m.fighters[1];
  const d = m.decoys.find((x) => x.kind === 'holo')!;
  check('HOLO DECOY: the opponent\'s regular aim goes to the hologram', Math.hypot(e.aimX - d.x, e.aimZ - d.z) < 0.01);
  check('HOLO DECOY: cards and charged attacks still aim at the real fighter', Math.hypot(e.cardAimX - m.fighters[0].x, e.cardAimZ - m.fighters[0].z) < 1);
  const hp0 = m.fighters[0].hp;
  m.combat.spawn(1, 'auto', 'twin_blasters', e.x, e.z, Math.atan2(d.x - e.x, d.z - e.z), 20, 80, 0.15, 12, {});
  for (let i = 0; i < 40; i++) {
    m.step(DT);
    m.drainEvents();
  }
  check('HOLO DECOY: it soaks the volley and keeps standing a moment (no damage to the fighter)', m.fighters[0].hp === hp0 && m.decoys.some((x) => x.kind === 'holo' && x.alive));
  for (let i = 0; i < 40; i++) {
    m.step(DT);
    m.drainEvents();
  }
  check(`HOLO DECOY: ~${CARD_TUNING.holo_decoy.soak} s after the first hit it glitches out`, !m.decoys.some((x) => x.kind === 'holo' && x.alive));
  // no invulnerability: a shot at the real fighter still lands
  const n = arena();
  place(n, 0, 3, 0, -3);
  play(n, 'holo_decoy');
  const hp1 = n.fighters[0].hp;
  n.combat.spawn(1, 'auto', 'twin_blasters', 0, -3, 0, 20, 80, 0.15, 12, {});
  run(n, 0.5);
  check('HOLO DECOY: no invulnerability — a shot at the real fighter lands', n.fighters[0].hp < hp1);
}
// FRAME CATCH
{
  const m = arena();
  place(m, 0, 3, 0, -3);
  play(m, 'frame_catch');
  const [p, e] = m.fighters;
  const hp0 = p.hp;
  const e0 = m.hands[0].energy;
  m.combat.spawn(1, 'power', e.stats.attack.weapon, e.x, e.z, Math.atan2(p.x - e.x, p.z - e.z), 20, 600, 0.5, 15, { heavy: true });
  const ev = run(m, 0.5);
  const fc = ev.find((x) => x.type === 'frameCatch');
  check('FRAME CATCH: the first enemy projectile (here a POWER SHOT) is parried — «ПАРИРОВАНО!»', !!fc && fc.type === 'frameCatch' && fc.first && p.hp === hp0 && p.caught > 0);
  check(`FRAME CATCH: parrying a heavy POWER SHOT pays +${CARD_TUNING.frame_catch.refund} energy (${(m.hands[0].energy - e0).toFixed(2)} incl. regen)`, !!fc && fc.type === 'frameCatch' && fc.refund === CARD_TUNING.frame_catch.refund && m.hands[0].energy - e0 >= 1);
  m.combat.spawn(1, 'auto', e.stats.attack.weapon, e.x, e.z, Math.atan2(p.x - e.x, p.z - e.z), 20, 60, 0.15, 15, {});
  run(m, 0.5);
  check(`FRAME CATCH: the frame closes ${CARD_TUNING.frame_catch.window} s after the parry — a later shot lands`, p.hp < hp0 && p.frame === 0);
  // a small volley in the parry window is caught whole; the energy comes once; MOMENTUM fires once
  const v = arena('ray');
  place(v, 0, 3, 0, -3);
  play(v, 'frame_catch');
  const [vp, ve] = v.fighters;
  const vhp = vp.hp;
  let parries = 0;
  let refunds = 0;
  let catches = 0;
  let passives = 0;
  const vev: MatchEvent[] = [];
  for (let i = 0; i < 4; i++) {
    v.combat.spawn(1, i < 2 ? 'power' : 'auto', ve.stats.attack.weapon, ve.x, ve.z, Math.atan2(vp.x - ve.x, vp.z - ve.z), 20, i < 2 ? 600 : 60, 0.3, 15, { heavy: i < 2 });
    vev.push(...run(v, 0.06));
  }
  vev.push(...run(v, 0.5));
  for (const x of vev) {
    if (x.type === 'frameCatch') {
      catches++;
      if (x.first) parries++;
      refunds += x.refund;
    }
    if (x.type === 'passive' && x.side === 0) passives++;
  }
  check(`FRAME CATCH: a tight volley is caught whole (${catches}/4), one parry callout, +1 energy only once (${refunds}), MOMENTUM once (${passives})`, catches === 4 && parries === 1 && refunds === 1 && passives === 1 && vp.hp === vhp);
  // RIPOSTE (Rina) loads once from a parry
  const r = arena('rina');
  place(r, 0, 3, 0, -3);
  play(r, 'frame_catch');
  const rev: MatchEvent[] = [];
  for (let i = 0; i < 3; i++) {
    r.combat.spawn(1, 'auto', 'twin_blasters', 0, -3, 0, 20, 60, 0.2, 15, {});
    rev.push(...run(r, 0.05));
  }
  rev.push(...run(r, 0.4));
  check('FRAME CATCH: RIPOSTE (Rina) loads once from a parry, no energy for light shots', rev.filter((x) => x.type === 'passive' && x.side === 0).length === 1 && r.fighters[0].riposte && !rev.some((x) => x.type === 'frameCatch' && x.refund > 0));
  // limits: at most maxCatch shots per card
  const lim = arena();
  place(lim, 0, 3, 0, -3);
  play(lim, 'frame_catch');
  for (let i = 0; i < 10; i++) lim.combat.spawn(1, 'auto', 'twin_blasters', -0.3 + i * 0.06, -3, 0, 20, 60, 0.2, 15, {});
  const lev = run(lim, 0.5);
  check(`FRAME CATCH: at most ${CARD_TUNING.frame_catch.maxCatch} shots per card — the rest lands`, lev.filter((x) => x.type === 'frameCatch').length === CARD_TUNING.frame_catch.maxCatch && lim.fighters[0].hp < lim.fighters[0].maxHp);
  const c = arena();
  place(c, 0, 3, 0, -3);
  play(c, 'frame_catch');
  const hp1 = c.fighters[0].hp;
  c.combat.spawn(1, 'power', 'pulse_rifle', 0, -3, 0, 40, 540, 0.28, 11, { heavy: true, pierce: 0.5 });
  run(c, 0.4);
  check('FRAME CATCH: CHARGED SHOT is not caught', c.fighters[0].hp < hp1);
}
// BACKTRACK
{
  const m = arena();
  place(m, -3, 4, 0, -3);
  const p = m.fighters[0];
  run(m, 2, () => {
    p.intentX = 1;
    p.intentZ = 0;
    p.intentSpeed = 1;
  });
  const back = p.hist.length / 2 - 1 - Math.round(CARD_TUNING.backtrack.lookback / CARD_TUNING.backtrack.sample);
  const tx = p.hist[back * 2];
  play(m, 'backtrack');
  let invuln = 0;
  run(m, CARD_TUNING.backtrack.duration + 0.05, () => {
    p.intentSpeed = 0;
    invuln = Math.max(invuln, p.invuln);
  });
  check(`BACKTRACK: back where the fighter stood 1.4 s ago (Δ ${Math.abs(p.x - tx).toFixed(2)} m)`, Math.abs(p.x - tx) < 0.35);
  check('BACKTRACK: no invulnerability, no health back', invuln === 0);
}
// HIGH STAKES
{
  const m = arena();
  place(m, 0, 3, 0, -3);
  const p = m.fighters[0];
  m.hands[0].energy = 2;
  const hp0 = p.hp;
  m.hands[0].hand = ['high_stakes', 'dash', 'shield'];
  m.playCard(0, 0);
  check(`HIGH STAKES: −2% max HP for +4 energy (${hp0 - p.hp} HP, energy ${m.hands[0].energy.toFixed(1)})`, hp0 - p.hp === Math.round(p.maxHp * CARD_TUNING.high_stakes.hpCost) && Math.abs(m.hands[0].energy - 5) < 0.05);
  check('HIGH STAKES: cannot be bet again right away', play(m, 'high_stakes') === 'recharge');
  let uses = 1;
  for (let i = 0; i < 6; i++) {
    p.stakesCd = 0;
    if (play(m, 'high_stakes') === null) uses++;
  }
  check(`HIGH STAKES: at most 3 bets per fight (${uses})`, uses === 3);
  const low = arena();
  place(low, 0, 3, 0, -3);
  low.fighters[0].hp = low.fighters[0].maxHp * 0.31;
  check('HIGH STAKES: refused when it would leave less than 30% HP', play(low, 'high_stakes') === 'risk');
  const cap = arena();
  place(cap, 0, 3, 0, -3);
  play(cap, 'high_stakes', 0, 9.5);
  check('HIGH STAKES: energy never above the 10 cap', cap.hands[0].energy <= MATCH.maxEnergy + 1e-9);
}
// SECOND TAKE (Alpha 1.6.1, replaces SIDE CAM)
/** Play (`first` →) `card`, let it resolve, (play `then`,) then SECOND TAKE; returns what the echo did. */
function secondTake(card: CardId, fighter: FighterId, first?: CardId, then?: CardId) {
  const m = arena(fighter);
  place(m, 0, 3, 0, -3);
  const [p, e] = m.fighters;
  if (first) {
    play(m, first);
    run(m, 0.3);
  }
  play(m, card);
  run(m, 2.6, () => p.place(0, 3, p.facing));
  const took = p.take?.card === card;
  const spot = p.take ? { x: p.take.x, z: p.take.z } : null;
  if (then) {
    play(m, then);
    run(m, 0.3, () => p.place(0, 3, p.facing));
  }
  e.hp = e.maxHp;
  e.place(0, -3, 0);
  p.place(1.5, 3.5, p.facing); // the fighter moved on: the echo still plays from the first take's spot
  aimAt(m);
  const hpE = e.hp;
  const res = play(m, 'second_take');
  const obj = m.objects.list.find((o) => o.kind === 'echo');
  const energy: number[] = [];
  let echoes = 0;
  let maxBolts = 0;
  let from: { x: number; z: number } | null = null;
  let blind = false;
  const ev = run(m, 2.4, () => {
    p.place(1.5, 3.5, p.facing);
    e.place(0, -3, 0);
    energy.push(m.hands[0].energy);
    const mine = m.projectiles.filter((x) => x.owner === 0 && x.echo);
    maxBolts = Math.max(maxBolts, mine.length);
    if (mine.length && !from) from = { x: mine[0].x, z: mine[0].z };
    if (mine.some((x) => x.blind)) blind = true;
  });
  for (const x of ev) if (x.type === 'hit' && x.echo) echoes++;
  let jump = 0;
  for (let i = 1; i < energy.length; i++) jump = Math.max(jump, energy[i] - energy[i - 1]);
  const dmg = ev.reduce((a, x) => a + (x.type === 'hit' && x.echo && x.source === 0 ? x.damage : 0), 0);
  return { m, res, took, spot, obj, dmg, hpLost: hpE - e.hp, echoes, maxBolts, from, jump, blind, combo: ev.find((x) => x.type === 'combo') };
}
{
  const base: Record<string, number> = {
    power_shot: CARD_TUNING.power_shot.damage,
    bank_shot: CARD_TUNING.bank_shot.damage,
    rebound_disc: CARD_TUNING.rebound_disc.damage,
    split_shot: CARD_TUNING.split_shot.damage * CARD_TUNING.split_shot.bolts,
  };
  const t = CARD_TUNING.second_take;
  const bad: string[] = [];
  const info: string[] = [];
  for (const c of TAKE_CARDS) {
    const r = secondTake(c, c === 'bank_shot' ? 'kai' : 'ray');
    const near = r.spot && r.obj ? Math.hypot(r.obj.x - r.spot.x, r.obj.z - r.spot.z) : 99;
    const cap = c === 'rebound_disc' ? t.cap / 2 : t.cap;
    const limit = Math.min(cap, base[c] * t.mult);
    info.push(`${c} ${Math.round(r.dmg)}/${Math.round(base[c])}`);
    if (!r.took) bad.push(`${c}: not recorded`);
    else if (r.res !== null) bad.push(`${c}: refused ${r.res}`);
    else if (near > 0.01) bad.push(`${c}: echo not at the first take's spot`);
    else if (r.dmg <= 0) bad.push(`${c}: the echo did not land`);
    else if (r.dmg > limit + 1) bad.push(`${c}: ${r.dmg.toFixed(0)} > ${limit.toFixed(0)}`);
    if (r.jump > 0.05) bad.push(`${c}: energy jumped +${r.jump.toFixed(2)}`);
    if (r.blind) bad.push(`${c}: blind without BLINDSIDE`);
    if (r.m.fighters[0].take !== null) bad.push(`${c}: the echo became a new take`);
  }
  check(`SECOND TAKE: replays all four attack cards from the first take's spot at ≤${t.mult * 100}% damage (cap ${t.cap}), no energy, dodgeable${bad.length ? ' — ' + bad.join('; ') : ''} [${info.join(', ')}]`, bad.length === 0);
  // nothing to replay
  const m = arena();
  place(m, 0, 3, 0, -3);
  check('SECOND TAKE: refused with no attack card to replay (stays in hand) — «Нечего повторять»', play(m, 'second_take') === 'notake' && m.hands[0].hand[0] === 'second_take');
  play(m, 'shock');
  run(m, 0.5);
  check('SECOND TAKE: basic cards other than POWER SHOT are not replayable (SHOCK)', play(m, 'second_take') === 'notake');
  m.combat.recordTake(m.fighters[0], 'directors_cut');
  check('SECOND TAKE: boss specials are never recorded', m.fighters[0].take === null);
  // replay of a replay
  const rr = secondTake('power_shot', 'ray');
  check('SECOND TAKE: no replay of a replay (the take is used up)', play(rr.m, 'second_take') === 'notake');
  // the take goes stale
  const old = arena();
  place(old, 0, 3, 0, -3);
  old.combat.recordTake(old.fighters[0], 'power_shot');
  old.fighters[0].take!.time -= t.window + 0.1;
  check(`SECOND TAKE: a take older than ${t.window} s is gone`, play(old, 'second_take') === 'notake');
  // one echo at a time, it ends after firing
  check('SECOND TAKE: the echo object is gone after its replay', !rr.m.objects.list.some((o) => o.kind === 'echo'));
  check('SECOND TAKE: one projectile per replay (SPLIT SHOT: its three bolts)', rr.maxBolts === 1 && secondTake('split_shot', 'ray').maxBolts === CARD_TUNING.split_shot.bolts);
  // COUNTER STRIKE is not multiplied again
  const cs = secondTake('power_shot', 'ray', 'dash');
  check(`SECOND TAKE: an echo of a COUNTER STRIKE power shot is a plain ${t.mult * 100}% replay (${Math.round(cs.dmg)} ≤ ${Math.min(t.cap, CARD_TUNING.power_shot.damage * t.mult)})`, cs.dmg > 0 && cs.dmg <= Math.min(t.cap, CARD_TUNING.power_shot.damage * t.mult) + 1);
  check('SECOND TAKE: never opens a combo chain (no combo starts with it)', !COMBOS.some((x) => x.first.includes('second_take')));
  // the show: an echo's damage counts for the rating, the heavy-hit bonus is not paid a second time
  {
    const b = arena();
    const hit = (echo: boolean): number => {
      b.broadcast.rating = 50;
      b.broadcast.onEvent({ type: 'hit', side: 1, source: 0, damage: 300, x: 0, z: 0, dx: 0, dz: 1, kind: 'power', heavy: true, crit: false, combo: null, electric: false, echo });
      return b.broadcast.rating - 50;
    };
    const plain = hit(false);
    const echoed = hit(true);
    check(`SECOND TAKE: the echo earns rating only for its damage, no repeated heavy-hit bonus (${echoed.toFixed(1)} < ${plain.toFixed(1)})`, echoed > 0 && echoed < plain);
  }
}
// FREEZE FRAME
{
  const m = arena();
  place(m, 0, 3, 0, -3);
  play(m, 'freeze_frame');
  const e = m.fighters[1];
  const p = m.combat.spawn(1, 'auto', e.stats.attack.weapon, -3.5, 1.4, Math.PI / 2, 20, 50, 0.15, 12, {});
  run(m, 0.12); // flies into the zone
  const x0 = p.x;
  run(m, 0.1);
  check(`FREEZE FRAME: a regular shot heading into the zone crawls at 30% speed (${((p.x - x0) / (20 * 0.1)).toFixed(2)})`, Math.abs((p.x - x0) / (20 * 0.1) - CARD_TUNING.freeze_frame.speed) < 0.05);
  const out = m.combat.spawn(0, 'auto', 'twin_blasters', m.fighters[0].x, m.fighters[0].z, Math.PI, 20, 50, 0.15, 12, {});
  const oz = out.z;
  run(m, 0.05);
  check('FREEZE FRAME: a shot heading out of the zone flies at full speed', Math.abs((oz - out.z) / (20 * 0.05) - 1) < 0.05);
  const q = m.combat.spawn(1, 'power', e.stats.attack.weapon, -0.5, 1.4, Math.PI / 2, 20, 600, 0.5, 15, { heavy: true });
  const qx = q.x;
  run(m, 0.1);
  check('FREEZE FRAME: a POWER SHOT keeps its speed', Math.abs((q.x - qx) / 2 - 1) < 0.05);
  const b = arena('vega', 'vale', 'vale');
  place(b, 0, 3, 0, -3);
  play(b, 'freeze_frame');
  const s = b.combat.spawn(1, 'slug', 'breaker', -0.5, 1.4, Math.PI / 2, 19, 90, 0.2, 12, {});
  const sx = s.x;
  run(b, 0.1);
  check('FREEZE FRAME: the champion\'s shots are not slowed', Math.abs((s.x - sx) / 1.9 - 1) < 0.05);
  // Alpha 1.6.1: the ring moves with its fighter, slows only the opponent's shots, lasts its time
  const f = arena();
  place(f, 0, 3, 0, -3);
  play(f, 'freeze_frame');
  const fp = f.fighters[0];
  run(f, 1, () => fp.place(fp.x + 0.03, 3, fp.facing));
  const ring = f.objects.list.find((o) => o.kind === 'freeze')!;
  check(`FREEZE FRAME: the ring follows its fighter (${Math.hypot(ring.x - fp.x, ring.z - fp.z).toFixed(3)} m off)`, Math.hypot(ring.x - fp.x, ring.z - fp.z) < 0.05);
  const own = f.combat.spawn(0, 'auto', 'twin_blasters', fp.x - 3.5, 1.4, Math.PI / 2, 20, 50, 0.15, 12, {});
  run(f, 0.12);
  const ox = own.x;
  run(f, 0.05);
  check('FREEZE FRAME: the owner\'s own shots are never slowed', Math.abs((own.x - ox) / (20 * 0.05) - 1) < 0.05);
  const hpF = fp.hp;
  f.combat.spawn(1, 'auto', 'twin_blasters', fp.x, -3, 0, 20, 50, 0.15, 12, {});
  run(f, 1.5, () => fp.place(fp.x, 3, fp.facing));
  check('FREEZE FRAME: a slowed shot still hurts if it is not dodged', fp.hp < hpF);
  run(f, CARD_TUNING.freeze_frame.duration);
  check(`FREEZE FRAME: ends after ${CARD_TUNING.freeze_frame.duration} s`, !f.objects.list.some((o) => o.kind === 'freeze'));
  const k = arena();
  place(k, 0, 3, 0, -3);
  play(k, 'freeze_frame');
  run(k, 0.5);
  k.knockOut(k.fighters[0], true);
  run(k, 0.05);
  check('FREEZE FRAME: the ring ends with its fighter\'s knockout', !k.objects.list.some((o) => o.kind === 'freeze'));
}

// --------------------------------------------------------------- combos
/** Set up and play first → second; returns the combo the second card formed. */
function combo(first: CardId, second: CardId, setup?: (m: Match) => void, fighter: FighterId = 'ray'): { got: ComboId | null; hinted: boolean } {
  const m = arena(fighter);
  place(m, 0, 2.2, 0, -2.2);
  play(m, first);
  run(m, 0.6);
  setup?.(m);
  const h = m.hands[0];
  h.hand = [second, 'shield', 'smoke'];
  h.energy = 10;
  h.lockout = 0;
  const hinted = !!m.comboHint(0, second);
  m.playCard(0, 0);
  const ev = m.drainEvents();
  const c = ev.find((x) => x.type === 'combo' && x.side === 0);
  return { got: c && c.type === 'combo' ? c.combo : null, hinted };
}
{
  const cases: [CardId, CardId, ComboId, ((m: Match) => void)?, FighterId?][] = [
    ['spotlight_tag', 'power_shot', 'spotlight'],
    ['spotlight_tag', 'rebound_disc', 'spotlight'],
    ['spotlight_tag', 'bank_shot', 'spotlight', undefined, 'kai'],
    ['dash', 'split_shot', 'tight_spread'],
    ['gravity_net', 'split_shot', 'tight_spread'],
    ['gravity_net', 'rebound_disc', 'boomerang'],
    ['cable_snare', 'rebound_disc', 'boomerang'],
    ['gravity_net', 'prop_drop', 'set_piece'],
    ['cable_snare', 'prop_drop', 'set_piece'],
    ['gravity_net', 'pressure_mine', 'gravity_trap'],
    ['pressure_mine', 'pulse_push', 'mine_drive'],
    ['stage_barrier', 'pulse_push', 'wall_push'],
    ['stage_barrier', 'dash', 'backstage'],
    ['stage_barrier', 'second_take', 'cross_angle', (m) => m.combat.recordTake(m.fighters[0], 'power_shot')],
    ['holo_decoy', 'second_take', 'blindside', (m) => m.combat.recordTake(m.fighters[0], 'power_shot')],
    ['holo_decoy', 'power_shot', 'blindside'],
    ['gravity_net', 'second_take', 'camera_lock', (m) => m.combat.recordTake(m.fighters[0], 'power_shot')],
    ['cable_snare', 'second_take', 'camera_lock', (m) => m.combat.recordTake(m.fighters[0], 'power_shot')],
    ['frame_catch', 'dash', 'catch_release', (m) => (m.fighters[0].caught = 2) && (m.fighters[0].caughtDmg = 300)],
    ['frame_catch', 'high_stakes', 'safe_bet', (m) => (m.fighters[0].caught = 2)],
    ['high_stakes', 'overdrive', 'all_in'],
    ['high_stakes', 'shield', 'insurance'],
    ['pressure_mine', 'backtrack', 'rewind_trap'],
    ['dash', 'backtrack', 'double_take'],
    ['freeze_frame', 'backtrack', 'replay'],
    ['freeze_frame', 'dash', 'time_slip'],
  ];
  const bad: string[] = [];
  for (const [a, b, id, setup, f] of cases) {
    const r = combo(a, b, setup, f);
    if (r.got !== id || !r.hinted) bad.push(`${a}→${b}=${r.got}/${r.hinted}`);
  }
  check(`combos: all ${cases.length} new pairs trigger in a real fight and are hinted first${bad.length ? ' — ' + bad.join(', ') : ''}`, bad.length === 0);
  const covered = new Set(cases.map((c) => c[2]));
  check('combos: every new combo id is covered by a live test', COMBOS.filter((x) => !['counter_strike', 'electro_blast', 'iron_rush', 'phantom_step', 'superstar', 'jackpot'].includes(x.id)).every((x) => covered.has(x.id)));
  // classics still work in a live fight
  check('combos: COUNTER STRIKE still triggers (DASH → POWER SHOT)', combo('dash', 'power_shot').got === 'counter_strike');
  check('combos: IRON RUSH still triggers (SHIELD → OVERDRIVE)', combo('shield', 'overdrive').got === 'iron_rush');
  check('combos: PHANTOM STEP still triggers (SMOKE → DASH)', combo('smoke', 'dash').got === 'phantom_step');
  // a combo whose setup is gone does not trigger and is not hinted
  const gone = combo('gravity_net', 'pressure_mine', (m) => run(m, CARD_TUNING.gravity_net.duration + 1));
  check('combos: GRAVITY NET → MINE after the net expired: no combo, no hint', gone.got === null && !gone.hinted);
  const noTake = combo('stage_barrier', 'second_take');
  check('combos: STAGE BARRIER → SECOND TAKE with nothing to replay: no combo, no hint', noTake.got === null && !noTake.hinted);
  // TIME SLIP keeps the ring 1.5 s longer
  {
    const m = arena();
    place(m, 0, 2.2, 0, -2.2);
    play(m, 'freeze_frame');
    run(m, 0.3);
    const ring = m.objects.list.find((o) => o.kind === 'freeze')!;
    const left0 = ring.total - ring.t;
    play(m, 'dash');
    const got = m.drainEvents().some((x) => x.type === 'combo' && x.combo === 'time_slip');
    check(`combos: TIME SLIP keeps the FREEZE ring ${COMBO_TUNING.timeSlipExtend} s longer`, got && Math.abs(ring.total - ring.t - left0 - COMBO_TUNING.timeSlipExtend) < 0.05);
  }
  // CROSS ANGLE: the echo goes through its own screen, still capped
  {
    const r = secondTake('power_shot', 'vega', undefined, 'stage_barrier');
    check(`combos: CROSS ANGLE — the echo passes the owner's own screen, still capped (${Math.round(r.dmg)})`, !!r.combo && r.combo.type === 'combo' && r.combo.combo === 'cross_angle' && r.dmg > 0 && r.dmg <= CARD_TUNING.second_take.cap + 1);
  }
  const nothing = combo('frame_catch', 'dash');
  check('combos: FRAME CATCH → DASH with nothing caught: no combo, no hint (no false promise)', nothing.got === null && !nothing.hinted);
  // JACKPOT is a chain: HIGH STAKES → SHIELD → POWER SHOT
  {
    const m = arena();
    place(m, 0, 2.2, 0, -2.2);
    play(m, 'high_stakes');
    run(m, 0.4);
    play(m, 'shield');
    run(m, 0.4);
    const h = m.hands[0];
    h.hand = ['power_shot', 'dash', 'smoke'];
    h.energy = 10;
    h.lockout = 0;
    const hinted = !!m.comboHint(0, 'power_shot');
    m.playCard(0, 0);
    const got = m.drainEvents().find((x) => x.type === 'combo');
    check('combos: JACKPOT — HIGH STAKES → SHIELD → POWER SHOT (hinted, ×1.3)', hinted && !!got && got.type === 'combo' && got.combo === 'jackpot');
    const plain = combo('shield', 'power_shot');
    check('combos: SHIELD → POWER SHOT without the bet is no combo', plain.got === null && !plain.hinted);
  }
  // hints only for a playable follow-up
  {
    const m = arena();
    place(m, 0, 2.2, 0, -2.2);
    play(m, 'spotlight_tag', 0, 2);
    const h = m.hands[0];
    h.hand = ['power_shot', 'dash', 'smoke'];
    h.energy = 0;
    h.lockout = 0;
    check('hints: no COMBO hint when the energy cannot arrive inside the window', !m.comboHint(0, 'power_shot'));
    h.energy = 2;
    check('hints: the COMBO hint shows once the energy arrives in time', !!m.comboHint(0, 'power_shot'));
    m.fighters[0].stun = 1;
    check('hints: no COMBO hint while the fighter cannot play it (stunned)', !m.comboHint(0, 'power_shot'));
  }
  // the prep screen list is the fight's registry
  check('deck list: GRAVITY NET + PRESSURE MINE shows GRAVITY TRAP («ЛОВУШКА»)', deckCombos(['gravity_net', 'pressure_mine', 'dash', 'shield']).some((c) => c.id === 'gravity_trap' && c.tag === 'ЛОВУШКА'));
  check('deck list: JACKPOT only with all three cards of the chain', !deckCombos(['shield', 'power_shot', 'dash', 'smoke']).some((c) => c.id === 'jackpot') && deckCombos(['high_stakes', 'shield', 'power_shot', 'dash']).some((c) => c.id === 'jackpot'));
  check('deck list: a deck without pairs lists nothing', deckCombos(['smoke', 'shock', 'frame_catch', 'pressure_mine']).filter((c) => !c.after).length === 0);
}

// --------------------------------------------------------------- safety
{
  // no endless hard control with every control card at once
  // two spam players with every control card: holds first (worst case for slows / cables),
  // and SHOCK first (worst case for stun chains)
  const spam = (shockFirst: boolean) => {
    const m = new Match({ fighter: 'nika', deck: ['gravity_net', 'cable_snare', 'shock', 'prop_drop'], rival: 'crash', difficulty: 'pro', seed: 9, fans: 0 });
    let shocks = 0;
    let run1 = 0;
    let maxRun = 0;
    let soft = 0;
    let t = 0;
    let holdNow = 0;
    let holdRun = 0;
    while (m.phase !== 'over') {
      if (m.phase === 'fight') {
        const h = m.hands[0];
        const si = h.hand.indexOf('shock');
        if (shockFirst) {
          if (si >= 0 && h.energy >= CARDS.shock.cost) m.playCard(0, si);
          else if (si < 0 || h.energy >= CARDS.shock.cost + 3) for (let k = 0; k < 3; k++) if (h.hand[k] !== 'shock' && m.playCard(0, k) === null) break;
        } else for (let k = 0; k < 3; k++) if (m.playCard(0, k) === null) break;
      }
      m.step(DT);
      for (const ev of m.drainEvents()) if (ev.type === 'hit' && ev.kind === 'shock' && ev.source === 0) shocks++;
      const e = m.fighters[1];
      if (m.phase !== 'fight') continue;
      t += DT;
      if (e.netSlow < 1 || e.tether > 0) {
        holdNow += DT;
        holdRun = Math.max(holdRun, holdNow);
      } else holdNow = 0;
      if (e.stun > 0) {
        run1 += DT;
        maxRun = Math.max(maxRun, run1);
      } else run1 = 0;
      if (e.netSlow < 1 || e.tether > 0) soft += DT;
    }
    return { m, shocks, maxRun, share: soft / t, holdRun };
  };
  const holds = spam(false);
  const zaps = spam(true);
  const m = holds.m;
  check(`safety: NET + SNARE + SHOCK + PROP spammed never chain into a long stun (${zaps.shocks} shocks, longest ${zaps.maxRun.toFixed(2)} s ≤ 1.2 s)`, zaps.shocks >= 3 && zaps.maxRun <= 1.2);
  check(`safety: holds spammed keep the rival slowed / tethered a limited share of the fight (${Math.round(holds.share * 100)}% < 45%)`, holds.share < 0.45);
  check(`safety: no hold lasts longer than ${CARD_TUNING.hold.holdMax} s in a row before the rival breaks free (${holds.holdRun.toFixed(2)} s)`, holds.holdRun <= CARD_TUNING.hold.holdMax + 0.05);
  check('safety: the fight ends with no set piece left on the stage', m.objects.list.length === 0 && m.fighters.every((f) => f.tether === 0 && f.tag === 0 && f.frame === 0));
  const next = new Match({ fighter: 'nika', deck: ['gravity_net', 'cable_snare', 'shock', 'prop_drop'], rival: 'crash', difficulty: 'pro', seed: 10, fans: 0 });
  check('safety: the next fight (Survival wave) starts with an empty stage', next.objects.list.length === 0 && next.decoys.length === 0);
  // a match ended mid-effect cleans up at once
  const k = arena();
  place(k, 0, 3, 0, -3);
  play(k, 'gravity_net');
  play(k, 'pressure_mine');
  k.combat.recordTake(k.fighters[0], 'power_shot');
  play(k, 'second_take');
  play(k, 'stage_barrier');
  play(k, 'freeze_frame');
  run(k, 0.2);
  k.knockOut(k.fighters[1], true);
  check('safety: a knockout mid-effect clears nets, mines, echoes, rings and barriers', k.objects.list.length === 0 && k.fighters[0].take === null);
  // energy: HIGH STAKES in ENERGY RUSH cannot loop
  const rush = new Match({ fighter: 'ray', deck: ['high_stakes', 'shield', 'power_shot', 'overdrive'], rival: 'zoe', difficulty: 'pro', seed: 3, fans: 0, mods: { energyMult: 1.5, rivalEnergyMult: 1.25 }, autoPlayer: { behavior: 'tactical', smarts: 1, dodge: 0.6, reaction: 0.35, eagerness: 2 } });
  let maxE = 0;
  while (rush.phase !== 'over') {
    rush.step(DT);
    rush.drainEvents();
    maxE = Math.max(maxE, rush.hands[0].energy);
  }
  check(`safety: ENERGY RUSH + HIGH STAKES — at most 3 bets, energy capped (${rush.fighters[0].stakesUses} bets, max ${maxE.toFixed(1)})`, rush.fighters[0].stakesUses <= 3 && maxE <= MATCH.maxEnergy + 1e-9);
}

// --------------------------------------------------------------- economy
{
  const store = new MemSave();
  const career = new CareerSystem(store as unknown as SaveSystem);
  check('shop: a new career owns none of the 15 cards; the basics stay free', store.data.cards.owned.length === 0 && career.availableCards('ray').length === 7);
  check('shop: at level 1 nothing can be bought yet (gradual unlock)', NEW_CARDS.every((c) => !career.cardOpen(c)) && !career.canBuyCard('spotlight_tag').ok);
  store.data.reputation = 60; // level 2
  store.data.money = 1000;
  check('shop: level 2 opens the first five cards', NEW_CARDS.filter((c) => career.cardOpen(c)).length === 5);
  const before = store.data.money;
  check('shop: buying SPOTLIGHT TAG takes its price once', career.buyCard('spotlight_tag') && store.data.money === before - CARDS.spotlight_tag.shop!.price);
  check('shop: a second purchase of the same card is refused and costs nothing', !career.buyCard('spotlight_tag') && store.data.money === before - CARDS.spotlight_tag.shop!.price);
  check('shop: a bought card is available to every fighter, the deck is not changed', FIGHTER_ORDER.every((f) => career.availableCards(f).includes('spotlight_tag')) && !store.data.fighters.ray.deck.includes('spotlight_tag'));
  check('shop: not enough money is refused', (() => {
    store.data.money = 10;
    return !career.buyCard('pulse_push') && store.data.money === 10;
  })());
  store.data.money = 5000;
  check('shop: level 3 cards stay closed at level 2', !career.cardOpen('gravity_net') && !career.buyCard('gravity_net'));
  store.data.reputation = 480; // level 5
  check('shop: level 5 opens the last tier (HIGH STAKES etc.)', career.cardOpen('high_stakes') && career.buyCard('high_stakes'));
  career.setDeck('ray', ['spotlight_tag', 'high_stakes', 'dash', 'adrenaline']);
  store.save();
  const reloaded = sanitize(JSON.parse(JSON.stringify(store.data)));
  check('save: bought cards and a deck with them survive a reload', reloaded.cards.owned.includes('spotlight_tag') && reloaded.cards.owned.includes('high_stakes') && reloaded.fighters.ray.deck.join() === 'spotlight_tag,high_stakes,dash,adrenaline' && reloaded.money === store.data.money);
  career.setDeck('ray', ['spotlight_tag', 'bank_shot', 'dash', 'adrenaline']);
  check('save: another fighter\'s signature never gets into a deck', store.data.fighters.ray.deck.join() === 'spotlight_tag,high_stakes,dash,adrenaline');
  const hacked = sanitize({ ...JSON.parse(JSON.stringify(store.data)), cards: { owned: ['spotlight_tag', 'bank_shot', 'nope'] } });
  check('save: only shop cards can be owned (no signatures, no junk)', hacked.cards.owned.join() === 'spotlight_tag');
  check('save: a deck with a card that was never bought resets to the default', hacked.fighters.ray.deck.join() === FIGHTERS.ray.defaultDeck.join());
  const v9 = sanitize({ version: 9, money: 777, fighters: { ray: { unlocked: true, deck: ['dash', 'shield', 'smoke', 'adrenaline'] } } });
  check('save: a 1.5.6 (v9) save loads as v12 with its deck and money, owning no new card', v9.version === 12 && v9.money === 777 && v9.fighters.ray.deck.join() === 'dash,shield,smoke,adrenaline' && v9.cards.owned.length === 0);
  // Alpha 1.6.1: SIDE CAM becomes SECOND TAKE — owned and in decks, nothing lost, nothing bought twice
  const v10 = sanitize({
    version: 10,
    money: 1234,
    reputation: 480,
    cards: { owned: ['spotlight_tag', 'side_cam', 'high_stakes'] },
    fighters: { ray: { unlocked: true, deck: ['side_cam', 'dash', 'spotlight_tag', 'adrenaline'] }, kai: { unlocked: true, deck: ['dash', 'side_cam', 'shield', 'bank_shot'] } },
  });
  check('save: a 1.6 (v10) save — SIDE CAM owned → SECOND TAKE owned, the other cards and money kept', v10.version === 12 && v10.money === 1234 && v10.cards.owned.includes('second_take') && !v10.cards.owned.includes('side_cam' as CardId) && v10.cards.owned.includes('spotlight_tag') && v10.cards.owned.includes('high_stakes') && v10.cards.owned.length === 3);
  check('save: SIDE CAM in saved decks is swapped for SECOND TAKE in the same slot', v10.fighters.ray.deck.join() === 'second_take,dash,spotlight_tag,adrenaline' && v10.fighters.kai.deck.join() === 'dash,second_take,shield,bank_shot');
  const both = sanitize({ version: 10, cards: { owned: ['side_cam', 'second_take'] } });
  check('save: owning both ids keeps one SECOND TAKE', both.cards.owned.filter((c) => c === 'second_take').length === 1 && both.cards.owned.length === 1);
  const store2 = new MemSave();
  store2.data = v10;
  const career2 = new CareerSystem(store2 as unknown as SaveSystem);
  const money2 = store2.data.money;
  check('shop: a migrated SECOND TAKE is not sold again', !career2.buyCard('second_take') && store2.data.money === money2);
  check('save: validDeck keeps exclusives exclusive', validDeck('ray', ['dash', 'shield', 'smoke', 'bank_shot']).join() === FIGHTERS.ray.defaultDeck.join());
}

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
}
console.log(ok ? `cards: OK (${checks.length} checks)` : 'cards: FAILED');
const proc = (globalThis as { process?: { exitCode?: number } }).process;
if (!ok && proc) proc.exitCode = 1;
