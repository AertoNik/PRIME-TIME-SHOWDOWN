// Beta 2.5 — WEAPONS IN THE HANDS (npm run anim25): every fighter and every skin plays each of its victory routines and
// each of its menu gestures on its real rig (no WebGL, Math.random seeded), and the weapon's rotation is read where it
// matters — relative to the hand that holds it (the weapon group's own rotation in its parent). Per look:
//   yaw     the largest turn around the GRIP axis (weapon +Y). A closed fist cannot turn a gun around its grip: until
//           Beta 2.4 Ray's blasters spun like propellers there (lobby «spin», victories «hype_jump» / «hype_spin»)
//   speed   the fastest the weapon turns in the hand (rad/s) — a deliberate pistol / cane twirl is fast, a held gun is not
//   turns   the angle travelled in the hand in one routine, in full turns (twirls of Kai's pistol, ACE's revolver, Lucien's
//           cane; small back-and-forth turns of the wrist add up too — information only)
//   reach   the farthest the weapon gets from the way it is held when the routine starts (rad): a twirl passes π
// Gates (after Beta 2.5): no weapon ever turns around its grip; a twin-blaster look (Ray, his skin, Dex, the training bot)
// never twirls a blaster (reach < 1.2 rad ≈ 69°, < 8 rad/s). `-- --root=<folder>` measures another copy of the game (e.g. the
// published Beta 2.4 in ~/Desktop/PRIME TIME SHOWDOWN) — the «before» of the report. `--json=path` writes the numbers.
import { BackSide, DoubleSide, Quaternion, Raycaster, Vector3 } from 'three';
import { fs, path, proc } from './lib/node';

let seed = 0x2b25;
Math.random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const rootArg = (proc.argv.find((a: string) => a.startsWith('--root=')) ?? '').slice(7);
const ROOT = rootArg ? path.resolve(rootArg.replace(/^~/, proc.env.HOME ?? '~')) : path.resolve('.');
const jsonOut = (proc.argv.find((a: string) => a.startsWith('--json=')) ?? '').slice(7);
const at = (p: string) => path.join(ROOT, p);
const { defaultInput } = await import(at('src/render/FighterAnimator.ts'));
const { ModelCache } = await import(at('src/render/ModelCache.ts'));
const { LOOKS } = await import(at('src/config/looks.ts'));
const { FLAIR_SETS, FLAIR_TIME, VICTORY_SETS } = await import(at('src/config/animation.ts'));
const { FIGHTERS } = await import(at('src/config/fighters.ts'));

/* eslint-disable @typescript-eslint/no-explicit-any */
const FIGHTER_LOOKS = ['ray', 'bruno', 'nika', 'vega', 'kai', 'rina', 'lucien', 'dex', 'tank', 'zoe', 'crash', 'vale', 'bot', 'ace', 'crax'];
const SKINS = Object.keys(LOOKS).filter((id) => (LOOKS as any)[id].base && !FIGHTER_LOOKS.includes(id));
const ALL = [...FIGHTER_LOOKS, ...SKINS];
const DT = 1 / 120;
const models = new ModelCache();

interface Row {
  look: string;
  weapon: string;
  yaw: number;
  speed: number;
  turns: number;
  reach: number;
  worst: string;
}

function measure(look: string): Row {
  const c = models.get(look);
  const a = c.anim as any;
  const rig = c.rig as any;
  const weapons = [rig.weaponR, rig.weaponL].filter(Boolean);
  const out: Row = { look, weapon: rig.look.weapon, yaw: 0, speed: 0, turns: 0, reach: 0, worst: '' };
  if (!weapons.length) return out;
  const prev = weapons.map(() => new Quaternion());
  const q = new Quaternion();
  const track = (what: string, frames: number, step: () => void) => {
    weapons.forEach((w: any, i: number) => prev[i].copy(w.quaternion));
    const start = weapons.map((w: any) => w.quaternion.clone());
    const acc = weapons.map(() => 0);
    for (let f = 0; f < frames; f++) {
      step();
      weapons.forEach((w: any, i: number) => {
        // (the turn in the hand this frame: the angle between two orientations in the parent)
        q.copy(prev[i]).invert().multiply(w.quaternion);
        const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
        acc[i] += ang;
        const sp = ang / DT;
        if (sp > out.speed) {
          out.speed = +sp.toFixed(2);
          out.worst = what;
        }
        out.yaw = Math.max(out.yaw, +Math.abs(w.rotation.y).toFixed(3));
        q.copy(start[i]).invert().multiply(w.quaternion);
        out.reach = Math.max(out.reach, +(2 * Math.acos(Math.min(1, Math.abs(q.w)))).toFixed(3));
        prev[i].copy(w.quaternion);
      });
    }
    out.turns = Math.max(out.turns, +(Math.max(...acc) / (Math.PI * 2)).toFixed(2));
  };
  const def = FIGHTERS[look as keyof typeof FIGHTERS] ?? null;
  const style = (a.victoryStyle ?? def?.victoryStyle) as keyof typeof VICTORY_SETS;
  const input = defaultInput();
  // the victory routines (each one, 3.5 s), from a settled idle
  (VICTORY_SETS[style] as readonly string[]).forEach((move, i) => {
    a.reset(0);
    for (let f = 0; f < 60; f++) a.update(DT, input);
    a.victory(i);
    track(`victory ${move}`, Math.round(3.5 / DT), () => a.update(DT, input));
  });
  // the menu gestures (each one, its own length + a little), out of combat
  const flairs = (FLAIR_SETS as any)[style] as readonly string[] | undefined;
  for (const move of flairs ?? []) {
    a.reset(0);
    for (let f = 0; f < 60; f++) a.update(DT, input);
    a.flairT = 99;
    a.flairMove = move;
    a.flairDur = (FLAIR_TIME as any)[move] ?? 1.6;
    a.flair = a.flairDur;
    track(`gesture ${move}`, Math.round((a.flairDur + 0.3) / DT), () => a.update(DT, input));
  }
  return out;
}

const rows = ALL.map(measure);
for (const r of rows) console.log(`${r.look.padEnd(18)} ${String(r.weapon).padEnd(14)} yaw ${r.yaw.toFixed(3)}  speed ${r.speed.toFixed(1).padStart(6)} rad/s  turns ${r.turns.toFixed(2)}  reach ${r.reach.toFixed(2)}  (fastest: ${r.worst || '—'})`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ root: ROOT, rows }, null, 2));
if (rootArg) proc.exit(0);

// ------------------------------------------------------------- the Beta 2.5 new moves (every look that has them)
const { DEFEAT_SETS } = await import(at('src/config/animation.ts'));
const NEW_FLAIR = ['crossdraw', 'chestbeat', 'bounce', 'radio', 'holster', 'releve', 'beckon', 'watch', 'hiss', 'clockbow', 'crowd'];
const NEW_VICTORY = ['hype_crossfire', 'flex_chest', 'precise_salute', 'show_holster'];
const NEW_DEFEAT = ['headshake', 'applaud', 'cloak', 'jam'];
const jointsOf = (rig: any): number[] => {
  const out: number[] = [];
  for (const o of [rig.roll, rig.hips, rig.spine, rig.head, rig.shoulderL, rig.shoulderR, rig.elbowL, rig.elbowR, rig.legL, rig.legR, rig.kneeL, rig.kneeR]) out.push(o.rotation.x, o.rotation.y, o.rotation.z);
  return out;
};
const dist = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
interface MoveRow { look: string; move: string; kind: string; reach: number; speed: number; back: number; nan: boolean }
const moveRows: MoveRow[] = [];
const oldSpeed: number[] = [];
const oldBack: number[] = [];
const runMove = (look: string, kind: 'gesture' | 'victory' | 'defeat', move: string, idx: number, isNew: boolean) => {
  // (a freshly built rig on a fixed random sequence — the move's run and its control run below start identical)
  const runSeed = [...(look + move)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0x2b25);
  seed = runSeed;
  const c = new ModelCache().get(look);
  const a = c.anim as any;
  const inp = defaultInput();
  inp.combat = kind === 'defeat';
  a.reset(0);
  a.flairT = 99;
  for (let f = 0; f < 120; f++) a.update(DT, inp);
  const ref = jointsOf(c.rig);
  let prev = ref;
  let reach = 0;
  let speed = 0;
  let nan = false;
  let len = 3.5;
  if (kind === 'gesture') {
    a.flairT = 99;
    a.flairMove = move;
    a.flairDur = (FLAIR_TIME as any)[move] ?? 1.6;
    a.flair = a.flairDur;
    len = a.flairDur;
  } else if (kind === 'victory') a.victory(idx);
  else a.defeat('loss', idx, 0.45);
  for (let f = 0; f < Math.round(len / DT); f++) {
    a.update(DT, inp);
    const j = jointsOf(c.rig);
    if (j.some((x) => !Number.isFinite(x))) nan = true;
    reach = Math.max(reach, dist(j, ref));
    speed = Math.max(speed, dist(j, prev) / DT);
    prev = j;
  }
  // a gesture hands back to the idle: 0.8 s after its end the body is where the SAME idle without the gesture is
  // (a control run on the same random sequence — the idle's own weight shifts and glances cancel out)
  let back = 0;
  if (kind === 'gesture') {
    a.flairT = 99;
    for (let f = 0; f < Math.round(0.8 / DT); f++) a.update(DT, inp);
    const after = jointsOf(c.rig);
    seed = runSeed;
    const c2 = new ModelCache().get(look);
    const a2 = c2.anim as any;
    a2.reset(0);
    a2.flairT = 99;
    for (let f = 0; f < 120 + Math.round(len / DT) + Math.round(0.8 / DT); f++) a2.update(DT, inp);
    back = dist(after, jointsOf(c2.rig));
  }
  if (isNew) moveRows.push({ look, move, kind, reach: +reach.toFixed(3), speed: +speed.toFixed(1), back: +back.toFixed(3), nan });
  else if (kind === 'gesture') {
    oldSpeed.push(speed);
    oldBack.push(back);
  }
};
for (const look of ALL) {
  const style = (models.get(look).anim as any).victoryStyle as keyof typeof VICTORY_SETS;
  const idle = (models.get(look).anim as any).idleStyle as keyof typeof DEFEAT_SETS;
  ((FLAIR_SETS as any)[style] as string[]).forEach((m) => runMove(look, 'gesture', m, 0, NEW_FLAIR.includes(m)));
  ((VICTORY_SETS as any)[style] as string[]).forEach((m, i) => NEW_VICTORY.includes(m) && runMove(look, 'victory', m, i, true));
  ((DEFEAT_SETS as any)[idle] as string[]).forEach((m, i) => NEW_DEFEAT.includes(m) && runMove(look, 'defeat', m, i, true));
}
const oldMax = Math.max(...oldSpeed);
// (the idle under a gesture keeps living — weight shifts, glances — so «back» is compared with the old gestures' own)
const oldBackMax = Math.max(...oldBack);
const looksOf = (m: string) => moveRows.filter((r) => r.move === m).map((r) => r.look);
console.log('\nnew moves (reach from idle rad / fastest joint rad/s / back to idle after a gesture rad):');
for (const m of [...NEW_FLAIR, ...NEW_VICTORY, ...NEW_DEFEAT]) {
  const rs = moveRows.filter((r) => r.move === m);
  console.log(`  ${m.padEnd(15)} ${rs.length ? `${looksOf(m).join(', ')} — reach ${Math.min(...rs.map((r) => r.reach)).toFixed(2)}–${Math.max(...rs.map((r) => r.reach)).toFixed(2)}, fastest ${Math.max(...rs.map((r) => r.speed)).toFixed(1)}${rs[0].kind === 'gesture' ? `, back ${Math.max(...rs.map((r) => r.back)).toFixed(2)}` : ''}` : 'NOT PLAYED'}`);
}
console.log(`  (the Beta 2.2–2.4 gestures: fastest joint ${oldMax.toFixed(1)} rad/s, back to idle ≤ ${oldBackMax.toFixed(2)} rad)`);
// the KO: both falls happen (by the finishing blow's direction), differ, and lie still before the results screen
const koRun = (look: string, theta: number) => {
  const c = models.get(look);
  const a = c.anim as any;
  const inp = defaultInput();
  inp.combat = true;
  a.reset(0);
  for (let f = 0; f < 120; f++) a.update(DT, inp);
  // (the finishing blow's direction first, then the KO — the input's ko flag only keeps it down afterwards)
  a.lastHitX = Math.sin(theta);
  a.lastHitZ = Math.cos(theta);
  a.ko();
  inp.ko = true;
  let at1 = [] as number[];
  let at26 = [] as number[];
  let at31 = [] as number[];
  let nan = false;
  for (let f = 1; f <= Math.round(3.1 / DT); f++) {
    a.update(DT, inp);
    const j = jointsOf(c.rig);
    if (j.some((x) => !Number.isFinite(x))) nan = true;
    if (f === Math.round(1.0 / DT)) at1 = j;
    if (f === Math.round(2.6 / DT)) at26 = j;
    if (f === Math.round(3.1 / DT)) at31 = j;
  }
  return { variant: a.koVar as number, at1, still: dist(at26, at31), nan };
};
const koByLook = ALL.map((look) => {
  const runs = Array.from({ length: 12 }, (_, i) => koRun(look, (i / 12) * Math.PI * 2));
  const v0 = runs.find((r) => r.variant === 0);
  const v1 = runs.find((r) => r.variant === 1);
  return { look, both: !!v0 && !!v1, differ: v0 && v1 ? dist(v0.at1, v1.at1) : 0, still: Math.max(...runs.map((r) => r.still)), nan: runs.some((r) => r.nan) };
});
console.log(`KO: both falls on every look ${koByLook.every((k) => k.both)}, twisted vs classic ${Math.min(...koByLook.map((k) => k.differ)).toFixed(2)}–${Math.max(...koByLook.map((k) => k.differ)).toFixed(2)} rad, still 2.6–3.1 s ≤ ${Math.max(...koByLook.map((k) => k.still)).toFixed(3)} rad`);

// ------------------------------------------------------------- Rina: the free arm never inside her head or hair
// (Beta 2.5 final fix: the raised arm of «stretch», «releve» and «hair» went 3–18 cm through her head and hair — her head
// is wider than her shoulders). A point of the arm is INSIDE a head / hair / accessory mesh when rays from it in two
// directions both cross that mesh an odd number of times. Every gesture, its ease-in and its ease-out.
const isUnder = (o: any, p: any) => {
  for (let x = o; x; x = x.parent) if (x === p) return true;
  return false;
};
const meshesUnder = (root: any, skip: any[]) => {
  const out: any[] = [];
  root.traverse((o: any) => {
    if (skip.some((x) => x && isUnder(o, x))) return;
    if (o.isMesh && o.visible && o.material?.side !== BackSide) out.push(o);
  });
  return out;
};
const ray = new Raycaster();
const RAYS = [new Vector3(1, 0.31, 0.17).normalize(), new Vector3(-0.2, 1, 0.4).normalize()];
const armInHead = (rig: any, maxR = Infinity): number => {
  rig.root.updateMatrixWorld(true);
  // (maxR: leave out the big open shells — long hair, a high collar — where «inside» cannot be told by crossing rays)
  const heads = meshesUnder(rig.head, []).filter((m: any) => (m.geometry.computeBoundingSphere(), m.geometry.boundingSphere.radius <= maxR));
  const sides = heads.map((m: any) => m.material.side);
  heads.forEach((m: any) => (m.material.side = DoubleSide));
  const arm = [...meshesUnder(rig.elbowL, [rig.weaponL, rig.weaponR]), ...meshesUnder(rig.shoulderL, [rig.elbowL, rig.weaponL])];
  let n = 0;
  const v = new Vector3();
  for (const m of arm) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 5) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      for (const h of heads) {
        if (RAYS.every((d) => (ray.set(v, d), ray.intersectObject(h, false).length % 2 === 1))) n++;
      }
    }
  }
  heads.forEach((m: any, k: number) => (m.material.side = sides[k]));
  return n;
};
const rinaClip: string[] = [];
let rinaWorst = 0;
for (const look of ['rina', 'rina_dune_mirage']) {
  for (const move of (FLAIR_SETS as any).graceful as string[]) {
    seed = 0x2b25;
    const c = new ModelCache().get(look);
    const a = c.anim as any;
    const inp = defaultInput();
    a.reset(0);
    a.flairT = 99;
    for (let f = 0; f < 120; f++) a.update(DT, inp);
    a.flairMove = move;
    a.flairDur = (FLAIR_TIME as any)[move] ?? 1.6;
    a.flair = a.flairDur;
    let worst = armInHead(c.rig);
    for (let f = 0; f < Math.round((a.flairDur + 0.4) / DT); f++) {
      a.flairT = 99;
      a.update(DT, inp);
      if (f % 6 === 0) worst = Math.max(worst, armInHead(c.rig));
    }
    rinaWorst = Math.max(rinaWorst, worst);
    rinaClip.push(`${look}/${move} ${worst}`);
  }
}
console.log(`Rina's free arm inside her head / hair (points, worst frame): ${rinaClip.join(', ')}`);
// every Beta 2.5 move (one look of each style): the free hand at the head, the face, an ear or the brow — never in them
const newClip: string[] = [];
let newClipWorst = 0;
const runClip = (look: string, kind: 'gesture' | 'victory' | 'defeat', move: string, idx: number) => {
  seed = 0x2b25;
  const c = new ModelCache().get(look);
  const a = c.anim as any;
  const inp = defaultInput();
  inp.combat = kind === 'defeat';
  a.reset(0);
  a.flairT = 99;
  for (let f = 0; f < 120; f++) a.update(DT, inp);
  let len = 3.2;
  if (kind === 'gesture') {
    a.flairMove = move;
    a.flairDur = (FLAIR_TIME as any)[move] ?? 1.6;
    a.flair = a.flairDur;
    len = a.flairDur + 0.4;
  } else if (kind === 'victory') a.victory(idx);
  else a.defeat('loss', idx, 0.45);
  let worst = 0;
  for (let f = 0; f < Math.round(len / DT); f++) {
    a.flairT = 99;
    a.update(DT, inp);
    if (f % 12 === 0) worst = Math.max(worst, armInHead(c.rig, 0.35));
  }
  newClipWorst = Math.max(newClipWorst, worst);
  if (worst) newClip.push(`${look}/${move} ${worst}`);
};
for (const look of ['ray', 'bruno', 'nika', 'vega', 'kai', 'rina', 'lucien', 'crash', 'vale', 'crax', 'ace']) {
  const an = models.get(look).anim as any;
  ((FLAIR_SETS as any)[an.victoryStyle] as string[]).forEach((m) => NEW_FLAIR.includes(m) && runClip(look, 'gesture', m, 0));
  ((VICTORY_SETS as any)[an.victoryStyle] as string[]).forEach((m, i) => NEW_VICTORY.includes(m) && runClip(look, 'victory', m, i));
  ((DEFEAT_SETS as any)[an.idleStyle] as string[]).forEach((m, i) => NEW_DEFEAT.includes(m) && runClip(look, 'defeat', m, i));
}
console.log(`new moves — the free hand inside the head / face / accessories: ${newClip.length ? newClip.join(', ') : 'never'}`);

const fails: string[] = [];
const gate = (name: string, ok: boolean) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) fails.push(name);
};
const blasters = rows.filter((r) => r.weapon === 'twin_blasters');
gate(`no weapon ever turns around its grip in the hand (yaw ≤ 0.001 rad; ${rows.length} looks: 15 fighters + ${SKINS.length} skins)`, rows.every((r) => r.yaw <= 0.001));
gate(`twin blasters (${blasters.map((r) => r.look).join(', ')}) are held, never twirled: within 1.2 rad of the grip's pose and < 8 rad/s in every victory and gesture`, blasters.length >= 3 && blasters.every((r) => r.reach < 1.2 && r.speed < 8));
gate('Ray and his skin move their blasters the same way (a skin animates exactly like its fighter)', (() => {
  const ray = rows.find((r) => r.look === 'ray');
  return !!ray && rows.filter((r) => (LOOKS as any)[r.look]?.base === 'ray').every((r) => r.turns === ray.turns && r.speed === ray.speed);
})());
gate(`every new move is played by every look of its style (11 gestures, 4 victories, 4 defeats; ${moveRows.length} plays), no NaN`, [...NEW_FLAIR, ...NEW_VICTORY, ...NEW_DEFEAT].every((m) => looksOf(m).length > 0) && moveRows.every((r) => !r.nan));
gate('each new move is a real new movement, not a tweak: the body leaves the idle by ≥ 0.25 rad', moveRows.every((r) => r.reach >= 0.25));
gate(`the new gestures are no jerkier than the old ones (fastest joint ≤ ${oldMax.toFixed(1)} rad/s of the 2.2–2.4 gestures)`, moveRows.filter((r) => r.kind === 'gesture').every((r) => r.speed <= oldMax + 0.5));
gate(`a new gesture hands back to the idle: 0.8 s after it the body is within 0.05 rad of the same idle without it (the 2.2–2.4 gestures: ≤ ${oldBackMax.toFixed(3)})`, moveRows.filter((r) => r.kind === 'gesture').every((r) => r.back <= 0.05));
gate('KO: both falls happen on every look (by the blow\'s direction), the twisted one differs (≥ 0.3 rad), both lie still from 2.6 s, no NaN', koByLook.every((k) => k.both && k.differ >= 0.3 && k.still <= 0.05 && !k.nan));
gate('RINA and DUNE MIRAGE: the free arm never goes into the head, hair or accessories in any gesture (hair, stretch, wave, relevé — ease-in and ease-out included)', rinaWorst === 0);
gate('every new move keeps the free hand OUT of the head, face and accessories (19 moves; big open shells — long hair, a high collar — are left to the eye)', newClipWorst === 0);
console.log(fails.length ? `\nanim25: FAILED (${fails.length})` : '\nanim25: OK');
proc.exit(fails.length ? 1 : 0);
