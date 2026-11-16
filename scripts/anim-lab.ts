// Beta 2.1 — ANIMATION LAB (npm run animlab): measures the procedural animation of every fighter on its real rig
// (no WebGL), with Math.random seeded so two runs give the same numbers. What it reports, per fighter:
//   pops      sudden changes of a joint's speed in one frame (rad/s) outside deliberate fast moves (dash, spins)
//   jerkP99   99th percentile of joint acceleration (rad/s²) in a busy scripted fight — how «smooth» motion reads
//   fps       how far the same fight drifts at 30 / 45 / 144 fps and with an uneven frame time from the 120 fps
//             reference (RMS rad over the body, head and arm joints, sampled at the same moments) — frame-rate independence
//   slip      how fast the planted foot slides along the ground while running, as a share of the running speed
//             (0 = planted; measured at a jog and a full run, forward and strafing)
//   sink      how deep a shoe goes into the floor (m) while running, turning and landing; float — how high the
//             lower shoe stands above the floor at rest (m)
//   clip      how deep the weapon enters the torso (m) while carried, aimed and fired (0 = never)
//   idle      head motion while standing (mm RMS) and how mechanically it repeats (autocorrelation 0..1)
//   drift     what is left in the springs and the weapon slide after 10 minutes of fighting and 6 s of rest
// `npm run animlab -- --json=path` also writes the numbers (the Beta 2.1 report compares before / after).
import { Vector3 } from 'three';
import { fs, proc } from './lib/node';

// ---------------------------------------------------------------- seeded Math.random (before any rig is built)
let seed = 0x2b21;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
Math.random = rnd;

const { defaultInput, FighterAnimator } = await import('../src/render/FighterAnimator');
const { ModelCache } = await import('../src/render/ModelCache');
const { RIG_BUILD } = await import('../src/render/FighterModel');
// Beta 2.2: `--legacy21` measures the Beta 2.1 legs (no tucked trouser leg, rigid boots) — the «before» of the boot fix
if (proc.argv.includes('--legacy21')) {
  RIG_BUILD.legacy21 = true;
  FighterAnimator.rigidBoots = true;
}
type AnimInput = ReturnType<typeof defaultInput>;
type Cached = ReturnType<InstanceType<typeof ModelCache>['get']>;

const LOOKS = ['ray', 'bruno', 'nika', 'vega', 'kai', 'rina', 'lucien', 'dex', 'tank', 'zoe', 'crash', 'vale', 'bot', 'ace', 'crax'];
const jsonOut = (proc.argv.find((a: string) => a.startsWith('--json=')) ?? '').slice(7);
const showPops = proc.argv.includes('--pops');
const popLog: [number, string][] = [];
const JOINT_NAMES = ['roll', 'hips', 'spine', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'legL', 'legR', 'kneeL', 'kneeR'];
const only = (proc.argv.find((a: string) => a.startsWith('--look=')) ?? '').slice(7);
const lookList = (proc.argv.find((a: string) => a.startsWith('--looks=')) ?? '').slice(8);
const checkMode = proc.argv.includes('--check');

function fresh(look: string): Cached {
  seed = 0x2b21 + look.length * 7919;
  const models = new ModelCache();
  const c = models.get(look);
  c.anim.reset(0);
  return c;
}

/** The joint rotations of the pose (root yaw excluded: turns are deliberate), radians. */
function joints(c: Cached): number[] {
  const r = c.rig;
  const out: number[] = [];
  for (const o of [r.roll, r.hips, r.spine, r.head, r.shoulderL, r.shoulderR, r.elbowL, r.elbowR, r.legL, r.legR, r.kneeL, r.kneeR]) out.push(o.rotation.x, o.rotation.y, o.rotation.z);
  return out;
}
const wrap = (a: number) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};

// ----------------------------------------------------------------- one scripted fight, driven by TIME only
interface Script {
  /** Called every frame before update: sets the input for time t (seconds). */
  step(c: Cached, inp: AnimInput, t: number, dt: number): void;
  /** One-off events (shots, hits, dashes) at exact moments — the frame is split there, at any frame rate. */
  events?: [number, (c: Cached) => void][];
  /** Frames where fast motion is deliberate (dash, spin, KO, victory) — excluded from the pop count. */
  deliberate(t: number): boolean;
}

function busyFight(): Script {
  // a fixed sequence of situations (no random input): run, strafe, backpedal, stop, aim and fire, hits, dash, stun
  const events: [number, (c: Cached) => void][] = [];
  for (let k = 0; k < 40; k++) events.push([1 + k * 0.45, (c) => c.anim.fire(k % 2, k % 9 === 0)]);
  for (const t of [3.1, 7.4, 11.2, 15.8]) events.push([t, (c) => c.anim.hit(0.6, -0.8, false)]);
  for (const t of [9.3]) events.push([t, (c) => c.anim.hit(-0.5, 0.9, true)]);
  for (const t of [5.0, 13.0]) events.push([t, (c) => c.anim.dash(0.7, 0.7)]);
  events.push([17.2, (c) => c.anim.evade()]);
  events.sort((a, b) => a[0] - b[0]);
  const DASH = [5.0, 13.0];
  return {
    events,
    step(_c, inp, t) {
      inp.combat = true;
      const seg = Math.floor(t / 1.25) % 8;
      const dirs: [number, number][] = [
        [0, 4.5],
        [4.2, 0],
        [0, -3.4],
        [0, 0],
        [-4.5, 0.4],
        [2.2, 2.2],
        [0, 0],
        [-3, -3],
      ];
      const [vx, vz] = dirs[seg];
      const [px, pz] = dirs[(seg + 7) % 8];
      // speeds change over 0.2 s like the simulation's acceleration (a function of time, never of the frame)
      const k = Math.min(1, (t % 1.25) / 0.2);
      inp.vx = px + (vx - px) * k;
      inp.vz = pz + (vz - pz) * k;
      inp.facing = Math.sin(t * 0.35) * 1.2;
      inp.fireIn = (t % 0.45) - 0.05;
      inp.stunned = t > 18.5 && t < 19.6;
      inp.action = t > 20 && t < 20.9 ? 'windup' : 'none';
      inp.actionT = Math.max(0, t - 20);
      inp.actionTotal = 0.9;
    },
    deliberate: (t) => DASH.some((d) => t >= d && t < d + 0.75) || (t > 17.2 && t < 17.7),
  };
}

function run(look: string, script: Script, dts: (i: number) => number, seconds: number, onFrame?: (c: Cached, t: number, dt: number, inp: AnimInput) => void): Cached {
  const c = fresh(look);
  const inp = defaultInput();
  inp.maxSpeed = 4.5;
  let t = 0;
  let i = 0;
  let ev = 0;
  const evs = script.events ?? [];
  while (t < seconds) {
    const dt = dts(i++);
    const end = t + dt;
    // split the frame at every event inside it (exact timing at any frame rate)
    while (ev < evs.length && evs[ev][0] <= end) {
      const h = evs[ev][0] - t;
      if (h > 1e-6) {
        script.step(c, inp, t + h, h);
        inp.x += inp.vx * h;
        inp.z += inp.vz * h;
        c.anim.update(h, inp);
        t += h;
      }
      evs[ev++][1](c);
    }
    const h = end - t;
    script.step(c, inp, end, h);
    inp.x += inp.vx * h;
    inp.z += inp.vz * h;
    if (h > 1e-6) c.anim.update(h, inp);
    t = end;
    onFrame?.(c, t, dt, inp);
  }
  return c;
}

// ------------------------------------------------------------------------------------------ metrics
interface Result {
  look: string;
  pops: number;
  legPops: number;
  popMax: number;
  jerkP99: number;
  fps30: number;
  fps45: number;
  fps144: number;
  fpsJitter: number;
  slipJog: number;
  slipRun: number;
  slipStrafe: number;
  sink: number;
  float: number;
  clip: number;
  idleHeadMM: number;
  idleRepeat: number;
  drift: number;
  /** Beta 2.2: how far the boot's collar is from where the shin carries it (m: p95 and max over idle, run, strafe, a busy fight, a dash) */
  collarP95: number;
  collarMax: number;
  /** Beta 2.2: how far the trouser leg reaches out of the boot's upper (m, sideways / lengthwise) and below the shaft's band */
  legOut: number;
  legLow: number;
}

function smoothness(look: string): { pops: number; legPops: number; popMax: number; jerkP99: number } {
  const DT = 1 / 60;
  const s = busyFight();
  const hist: number[][] = [];
  let pops = 0;
  let legPops = 0;
  let popMax = 0;
  const acc: number[] = [];
  run(look, s, () => DT, 22, (c, t) => {
    hist.push(joints(c));
    const n = hist.length;
    if (n < 3 || t < 0.6 || s.deliberate(t) || s.deliberate(t - 2 * DT)) return;
    const a = hist[n - 1];
    const b = hist[n - 2];
    const d = hist[n - 3];
    for (let k = 0; k < a.length; k++) {
      const v1 = wrap(a[k] - b[k]) / DT;
      const v0 = wrap(b[k] - d[k]) / DT;
      const dv = Math.abs(v1 - v0);
      if (k < 24) {
        acc.push(dv / DT);
        if (dv > popMax) popMax = dv;
      }
      // a joint that changes its speed by more than 6 rad/s in one 60 fps frame reads as a «pop» — counted for the body,
      // head and arms (joints 0–23); the legs of a planted run have sharp push-offs by nature, counted apart (legPops)
      if (dv > 6 && k >= 24) legPops++;
      if (dv > 6 && k < 24) {
        pops++;
        if (showPops) popLog.push([dv, `${JOINT_NAMES[Math.floor(k / 3)]}.${'xyz'[k % 3]} t=${t.toFixed(2)}`]);
      }
    }
  });
  acc.sort((x, y) => x - y);
  if (showPops) {
    const byJoint = new Map<string, number>();
    for (const [, w] of popLog) byJoint.set(w.split(' ')[0], (byJoint.get(w.split(' ')[0]) ?? 0) + 1);
    console.log('pops by joint', JSON.stringify([...byJoint].sort((a, b) => b[1] - a[1])));
    console.log('worst', popLog.sort((a, b) => b[0] - a[0]).slice(0, 12).map(([v, w]) => `${v.toFixed(1)} ${w}`).join(' | '));
    popLog.length = 0;
  }
  return { pops, legPops, popMax: +popMax.toFixed(2), jerkP99: Math.round(acc[Math.floor(acc.length * 0.99)]) };
}

function frameRate(look: string): { fps30: number; fps45: number; fps144: number; fpsJitter: number } {
  const sample = (dts: (i: number) => number) => {
    const out: number[][] = [];
    let nextT = 0.5;
    run(look, busyFight(), dts, 21, (c, t) => {
      if (t >= nextT) {
        out.push(joints(c));
        nextT += 0.1;
      }
    });
    return out;
  };
  const ref = sample(() => 1 / 120);
  if (proc.argv.includes('--fpsdiag')) {
    const o = sample(() => 1 / 30);
    const perJ = new Array(ref[0].length).fill(0);
    const perT: [number, number][] = [];
    for (let i = 0; i < Math.min(ref.length, o.length); i++) {
      let st = 0;
      for (let k = 0; k < ref[i].length; k++) {
        const d = wrap(ref[i][k] - o[i][k]);
        perJ[k] += d * d;
        st += d * d;
      }
      perT.push([0.5 + i * 0.1, Math.sqrt(st / ref[i].length)]);
    }
    console.log('fps30 by joint', perJ.map((v, k) => [JOINT_NAMES[Math.floor(k / 3)] + '.' + 'xyz'[k % 3], +Math.sqrt(v / ref.length).toFixed(3)] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => x.join(' ')).join(' | '));
    console.log('fps30 worst moments', perT.sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, v]) => `t=${t.toFixed(1)} ${v.toFixed(3)}`).join(' | '));
  }
  // the upper body and the arms (joints 0–23): the legs' cycle may sit at another point of the same stride after a long
  // run at another frame rate (the phase integrates the speed) — a time shift, not a different motion; the legs are
  // measured by slip and pops instead
  const rms = (other: number[][]) => {
    let s = 0;
    let n = 0;
    for (let i = 0; i < Math.min(ref.length, other.length); i++)
      for (let k = 0; k < 24; k++) {
        const d = wrap(ref[i][k] - other[i][k]);
        s += d * d;
        n++;
      }
    return +Math.sqrt(s / n).toFixed(4);
  };
  const jitter = (i: number) => [1 / 40, 1 / 90, 1 / 60, 1 / 25, 1 / 120, 1 / 60][i % 6];
  return { fps30: rms(sample(() => 1 / 30)), fps45: rms(sample(() => 1 / 45)), fps144: rms(sample(() => 1 / 144)), fpsJitter: rms(sample(jitter)) };
}

const foot = (c: Cached, side: 'L' | 'R', v: Vector3) => (side === 'L' ? c.rig.kneeL : c.rig.kneeR).localToWorld(v.set(0, -c.rig.dims.shin, 0));

/** Mean ground speed of the planted foot / running speed while running at (vx, vz) facing forward. */
function slip(look: string, vx: number, vz: number): number {
  const DT = 1 / 120;
  const script: Script = {
    step(_c, inp) {
      inp.combat = true;
      inp.vx = vx;
      inp.vz = vz;
      inp.facing = 0;
    },
    deliberate: () => false,
  };
  const prev = { L: new Vector3(), R: new Vector3() };
  const cur = { L: new Vector3(), R: new Vector3() };
  let have = false;
  let sum = 0;
  let n = 0;
  let ground = Infinity;
  run(look, script, () => DT, 5, (c, t) => {
    c.rig.root.updateMatrixWorld(true);
    foot(c, 'L', cur.L);
    foot(c, 'R', cur.R);
    if (t > 1.5 && t <= 2) ground = Math.min(ground, cur.L.y, cur.R.y);
    if (have && t > 2) {
      // a foot is on the floor when it is within 6 mm of the lowest the feet get; its ground speed is the slip
      for (const side of ['L', 'R'] as const) {
        if (cur[side].y > ground + 0.006) continue;
        sum += Math.hypot(cur[side].x - prev[side].x, cur[side].z - prev[side].z) / DT;
        n++;
      }
    }
    prev.L.copy(cur.L);
    prev.R.copy(cur.R);
    have = true;
  });
  return +(sum / Math.max(1, n) / Math.hypot(vx, vz)).toFixed(3);
}

/** The lowest point of the two shoes (the shin meshes' real vertices in the world), relative to the floor (y = 0). */
const SOLE_PTS = new WeakMap<object, Vector3[]>();
function soleY(c: Cached): number {
  let low = Infinity;
  const v = new Vector3();
  // the shoes: on the foot bones since Beta 2.1 (before, merged into the shin)
  const r = c.rig as unknown as { footL?: import('three').Object3D; footR?: import('three').Object3D };
  for (const knee of r.footL && r.footR ? [r.footL, r.footR] : [c.rig.kneeL, c.rig.kneeR]) {
    for (const ch of knee.children) {
      const m = ch as unknown as { isMesh?: boolean; material?: { side?: number }; geometry?: { attributes: { position: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } }; matrixWorld: import('three').Matrix4 };
      if (!m.isMesh || !m.geometry || m.material?.side === 1) continue;
      // the shoe's lowest vertices (bottom 4 cm of the shin mesh) — enough to find the sole in any pose
      let pts = SOLE_PTS.get(m.geometry);
      if (!pts) {
        // only vertices of real (non-degenerate) triangles: the merged geometry has collapsed helper points
        const g = m.geometry as unknown as { index: { count: number; getX(i: number): number } | null; attributes: { position: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } };
        const pos = g.attributes.position;
        const tri = g.index ? g.index.count : pos.count;
        const at = (i: number) => (g.index ? g.index.getX(i) : i);
        const A = new Vector3();
        const B = new Vector3();
        const C = new Vector3();
        const real: Vector3[] = [];
        for (let i = 0; i + 2 < tri; i += 3) {
          A.set(pos.getX(at(i)), pos.getY(at(i)), pos.getZ(at(i)));
          B.set(pos.getX(at(i + 1)), pos.getY(at(i + 1)), pos.getZ(at(i + 1)));
          C.set(pos.getX(at(i + 2)), pos.getY(at(i + 2)), pos.getZ(at(i + 2)));
          if (B.clone().sub(A).cross(C.clone().sub(A)).lengthSq() < 1e-12) continue;
          real.push(A.clone(), B.clone(), C.clone());
        }
        let minY = Infinity;
        for (const p of real) minY = Math.min(minY, p.y);
        pts = real.filter((p) => p.y < minY + 0.04);
        SOLE_PTS.set(m.geometry, pts);
      }
      for (const p of pts) low = Math.min(low, v.copy(p).applyMatrix4(m.matrixWorld).y);
    }
  }
  return low;
}

/**
 * Beta 2.2 — THE BOOT ON THE LEG. collar: every frame, the boot's top ring (its vertices within 2 cm of the top, with the
 * boot's morph targets applied as the GPU does) against the same vertices carried rigidly by the shin — 0 = the shaft
 * stays around the leg. legOut / legLow: the shin's own vertices under the boot's top (1.5 cm below it) that stand out of
 * the upper's width or length, or below the band where the shaft is fixed to the shin (static geometry).
 */
function bootFit(look: string): { collarP95: number; collarMax: number; legOut: number; legLow: number } {
  const v = new Vector3();
  const w = new Vector3();
  const offs: number[] = [];
  const shoeOf = (foot: import('three').Object3D) =>
    foot.children.find((ch) => (ch as unknown as { isMesh?: boolean; material?: { side?: number } }).isMesh && (ch as unknown as { material: { side?: number } }).material.side !== 1) as unknown as {
      geometry: import('three').BufferGeometry;
      morphTargetInfluences?: number[];
      matrixWorld: import('three').Matrix4;
    };
  const top = (g: import('three').BufferGeometry) => {
    const p = g.getAttribute('position');
    let m = -Infinity;
    for (let i = 0; i < p.count; i++) m = Math.max(m, p.getY(i));
    return m;
  };
  const scripts: [string, Script, number][] = [
    ['idle', { step: (_c, inp) => ((inp.combat = true), (inp.vx = 0), (inp.vz = 0)), deliberate: () => false }, 4],
    ['run', { step: (_c, inp) => ((inp.combat = true), (inp.vx = 4.5), (inp.vz = 0), (inp.facing = Math.PI / 2)), deliberate: () => false }, 4],
    ['strafe', { step: (_c, inp) => ((inp.combat = true), (inp.vx = 0), (inp.vz = 4.2), (inp.facing = 0)), deliberate: () => false }, 4],
    ['dash', { events: [[1.5, (c) => c.anim.dash(1, 0)]], step: (_c, inp) => ((inp.combat = true), (inp.vx = 0), (inp.vz = 0)), deliberate: () => false }, 2.4],
    ['fight', busyFight(), 22],
  ];
  for (const [, script, secs] of scripts) {
    run(look, script, () => 1 / 60, secs, (c, t) => {
      if (t < 0.6) return;
      c.rig.root.updateMatrixWorld(true);
      for (const [foot, knee] of [[c.rig.footL, c.rig.kneeL], [c.rig.footR, c.rig.kneeR]] as const) {
        const m = shoeOf(foot);
        const g = m.geometry;
        const pos = g.getAttribute('position');
        const mt = g.morphAttributes.position ?? [];
        const inf = m.morphTargetInfluences ?? [];
        const yTop = top(g);
        let worst = 0;
        for (let i = 0; i < pos.count; i++) {
          if (pos.getY(i) < yTop - 0.02) continue;
          v.fromBufferAttribute(pos, i);
          for (let k = 0; k < mt.length; k++) if (inf[k]) v.addScaledVector(w.fromBufferAttribute(mt[k], i), inf[k]);
          v.applyMatrix4(m.matrixWorld);
          // the same vertex carried by the shin: the foot's origin is d.shin below the knee, unturned
          w.fromBufferAttribute(pos, i).add(foot.position).applyMatrix4(knee.matrixWorld);
          worst = Math.max(worst, v.distanceTo(w));
        }
        offs.push(worst);
      }
    });
  }
  offs.sort((a, b) => a - b);
  // the trouser leg against the boot (static): the shin's vertices under the boot's top
  const c0 = fresh(look);
  const d = c0.rig.dims;
  const shin = c0.rig.kneeL.children.find((ch) => (ch as unknown as { isMesh?: boolean; material?: { side?: number } }).isMesh && (ch as unknown as { material: { side?: number } }).material.side !== 1) as unknown as { geometry: import('three').BufferGeometry };
  const g0 = shoeOf(c0.rig.footL).geometry;
  const boots = top(g0) - 0.015;
  const hx = d.shoeW * 0.45;
  const zb = 0.02 - d.shoeL * 0.39;
  const zf = 0.02 + d.shoeL * 0.39;
  const tailored = (c0.rig as unknown as { look?: { pants: { style: string } } }).look?.pants.style === 'tailored';
  let legOut = 0;
  let legLow = 0;
  const sp = shin.geometry.getAttribute('position');
  for (let i = 0; i < sp.count; i++) {
    const h = sp.getY(i) + d.shin;
    if (h >= boots) continue;
    if (!tailored) legOut = Math.max(legOut, Math.abs(sp.getX(i)) - hx, zb - sp.getZ(i), sp.getZ(i) - zf);
    legLow = Math.max(legLow, 0.19 - h);
  }
  return { collarP95: +offs[Math.floor(offs.length * 0.95)].toFixed(3), collarMax: +offs[offs.length - 1].toFixed(3), legOut: +Math.max(0, legOut).toFixed(3), legLow: +Math.max(0, legLow).toFixed(3) };
}

/**
 * Feet and the floor: how deep a shoe goes INTO the floor (m, > 0 = sinks) while running, turning on the spot and
 * landing a dash, and how high the lower shoe floats above it while standing (m).
 */
function sink(look: string): { sink: number; float: number } {
  const c0 = fresh(look);
  const inp0 = defaultInput();
  inp0.combat = true;
  let standLow = Infinity;
  for (let i = 0; i < 240; i++) {
    c0.anim.update(1 / 60, inp0);
    if (i > 120) {
      c0.rig.root.updateMatrixWorld(true);
      standLow = Math.min(standLow, soleY(c0));
    }
  }
  let low = Infinity;
  const script: Script = {
    events: [[4.5, (c) => c.anim.dash(1, 0)]],
    step(_c, inp, t) {
      inp.combat = true;
      inp.vx = t < 3 ? 4.5 : 0;
      inp.vz = 0;
      inp.facing = t < 3 ? 0 : t * 3;
    },
    deliberate: () => false,
  };
  const seg = { run: Infinity, turn: Infinity, dash: Infinity };
  run(look, script, () => 1 / 120, 6, (c, t) => {
    if (t < 1) return;
    c.rig.root.updateMatrixWorld(true);
    const y = soleY(c);
    low = Math.min(low, y);
    const k = t < 3 ? 'run' : t < 4.5 ? 'turn' : 'dash';
    seg[k] = Math.min(seg[k], y);
  });
  if (proc.argv.includes('--sinkdiag')) console.log(look, 'sole low: run', seg.run.toFixed(3), 'turn', seg.turn.toFixed(3), 'dash', seg.dash.toFixed(3), 'stand', standLow.toFixed(3));
  return { sink: +Math.max(0, -low).toFixed(3), float: +standLow.toFixed(3) };
}

/** Deepest point of the weapon (grip → muzzle) inside the torso while carried, aimed and fired (m). */
function clip(look: string): number {
  const c0 = fresh(look);
  if (!c0.rig.weaponR || !c0.rig.muzzles[0]) return 0;
  const d = c0.rig.dims;
  // the torso as a vertical capsule around the spine: its widest half-width from the profile, scaled by depth
  const rad = Math.max(...d.profile.map((p) => p[1])) * Math.min(1, d.depth) * 0.85;
  const a = new Vector3();
  const b = new Vector3();
  const m = new Vector3();
  const top = new Vector3();
  const bot = new Vector3();
  let worst = 0;
  let worstAt = '';
  const script = busyFight();
  run(look, script, () => 1 / 60, 22, (c, t) => {
    if (script.deliberate(t) || t < 0.5) return;
    c.rig.root.updateMatrixWorld(true);
    c.rig.weaponR!.getWorldPosition(a);
    c.rig.muzzles[0].getWorldPosition(b);
    c.rig.spine.localToWorld(bot.set(0, 0.02, 0));
    c.rig.spine.localToWorld(top.set(0, d.torsoH * 0.85, 0));
    for (let s = 0; s <= 8; s++) {
      m.lerpVectors(a, b, s / 8);
      // distance from the weapon point to the spine segment
      const ab = top.clone().sub(bot);
      const k = Math.max(0, Math.min(1, m.clone().sub(bot).dot(ab) / ab.lengthSq()));
      const dist = m.distanceTo(bot.clone().addScaledVector(ab, k));
      if (rad - dist > worst) {
        worst = rad - dist;
        worstAt = `t=${t.toFixed(2)} seg=${Math.floor(t / 1.25) % 8} speed=${Math.hypot(c.rig.root.position.x, 0).toFixed(1)} point=${s}/8`;
      }
    }
  });
  if (proc.argv.includes('--clipdiag')) console.log(look, 'worst clip', worst.toFixed(3), worstAt);
  return +Math.max(0, worst).toFixed(3);
}

/** Head motion while standing (mm RMS) and how exactly it repeats (best autocorrelation over 0.6–8 s lags). */
function idle(look: string): { idleHeadMM: number; idleRepeat: number } {
  const DT = 1 / 30;
  const ys: number[] = [];
  const xs: number[] = [];
  const v = new Vector3();
  const script: Script = {
    step(_c, inp) {
      inp.combat = false;
    },
    deliberate: () => false,
  };
  run(look, script, () => DT, 40, (c, t) => {
    if (t < 4) return;
    c.rig.root.updateMatrixWorld(true);
    c.rig.head.getWorldPosition(v);
    xs.push(v.x);
    ys.push(v.y);
  });
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const mx = mean(xs);
  const my = mean(ys);
  const dx = xs.map((x) => x - mx);
  const dy = ys.map((y) => y - my);
  const rms = Math.sqrt(mean(dx.map((x, i) => x * x + dy[i] * dy[i])));
  const sig = dx.map((x, i) => x + dy[i] * 1.7);
  const v0 = sig.reduce((s, x) => s + x * x, 0);
  let best = 0;
  for (let lag = Math.round(0.6 / DT); lag < Math.round(8 / DT); lag++) {
    let s = 0;
    for (let i = 0; i + lag < sig.length; i++) s += sig[i] * sig[i + lag];
    best = Math.max(best, (s / (sig.length - lag)) / (v0 / sig.length));
  }
  return { idleHeadMM: +(rms * 1000).toFixed(1), idleRepeat: +best.toFixed(3) };
}

/** What is left after 10 minutes of fighting and 6 s of rest: spring values and the weapon's slide (abs sum). */
function drift(look: string): number {
  const fight = busyFight();
  // the same 22 s fight again and again for 10 minutes, then rest
  const events: [number, (c: Cached) => void][] = [];
  for (let k = 0; k < 27; k++) for (const [at, f] of fight.events!) events.push([k * 22 + at, f]);
  const script: Script = {
    events,
    step(c, inp, t, dt) {
      if (t < 594) fight.step(c, inp, t % 22, dt);
      else {
        inp.vx = inp.vz = 0;
        inp.action = 'none';
        inp.stunned = false;
        inp.fireIn = -1;
      }
    },
    deliberate: () => false,
  };
  const c = run(look, script, () => 1 / 60, 606);
  const a = c.anim as unknown as Record<string, { value?: number; vel?: number }>;
  let left = 0;
  for (const k of Object.keys(a)) {
    const s = a[k];
    if (s && typeof s === 'object' && typeof s.value === 'number' && typeof s.vel === 'number') left += Math.abs(s.value) + Math.abs(s.vel) * 0.1;
  }
  const w = c.rig.weaponR;
  if (w) left += Math.abs(w.position.y - (c.anim as unknown as { weaponBaseR: number }).weaponBaseR);
  return +left.toFixed(5);
}

// ---------------------------------------------------------------------------------------------- bench
/** CPU cost of one animator update in a busy fight (µs, median of 5 runs of 3 000 frames, one fighter). */
function bench(look: string): number {
  const times: number[] = [];
  for (let r = 0; r < 5; r++) {
    const c = fresh(look);
    const inp = defaultInput();
    inp.maxSpeed = 4.5;
    const s = busyFight();
    let t = 0;
    const t0 = performance.now();
    for (let i = 0; i < 3000; i++) {
      t += 1 / 60;
      s.step(c, inp, t % 22, 1 / 60);
      inp.x += inp.vx / 60;
      inp.z += inp.vz / 60;
      c.anim.update(1 / 60, inp);
    }
    times.push(((performance.now() - t0) * 1000) / 3000);
  }
  times.sort((a, b) => a - b);
  return +times[2].toFixed(2);
}
if (proc.argv.includes('--bench')) {
  const out: Record<string, number> = {};
  for (const look of only ? [only] : LOOKS) out[look] = bench(look);
  const vals = Object.values(out);
  console.log('µs per update', JSON.stringify(out), 'mean', (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
  proc.exit(0);
}

// ---------------------------------------------------------------------------------------------- main
const results: Result[] = [];
for (const look of only ? [only] : lookList ? lookList.split(',') : LOOKS) {
  const sm = smoothness(look);
  const fr = frameRate(look);
  const id = idle(look);
  results.push({
    look,
    ...sm,
    ...fr,
    slipJog: slip(look, 0, 2.2),
    slipRun: slip(look, 0, 4.5),
    slipStrafe: slip(look, 4.2, 0),
    ...sink(look),
    clip: clip(look),
    ...id,
    drift: drift(look),
    ...bootFit(look),
  });
  const r = results[results.length - 1];
  console.log(
    `${look.padEnd(7)} pops ${String(r.pops).padStart(4)} legs ${String(r.legPops).padStart(4)} (max ${r.popMax.toFixed(1).padStart(5)} rad/s) jerkP99 ${String(r.jerkP99).padStart(5)} | fps30 ${r.fps30.toFixed(3)} fps45 ${r.fps45.toFixed(3)} fps144 ${r.fps144.toFixed(3)} jitter ${r.fpsJitter.toFixed(3)} | slip jog ${r.slipJog.toFixed(2)} run ${r.slipRun.toFixed(2)} strafe ${r.slipStrafe.toFixed(2)} | sink ${r.sink.toFixed(3)} float ${r.float.toFixed(3)} clip ${r.clip.toFixed(3)} | idle ${r.idleHeadMM.toFixed(1)} mm repeat ${r.idleRepeat.toFixed(2)} | drift ${r.drift} | boot collar p95 ${(r.collarP95 * 100).toFixed(1)} max ${(r.collarMax * 100).toFixed(1)} cm, leg out ${(r.legOut * 100).toFixed(1)} low ${(r.legLow * 100).toFixed(1)} cm`,
  );
}
const avg = (k: keyof Result) => +(results.reduce((s, r) => s + (r[k] as number), 0) / results.length).toFixed(4);
const summary = Object.fromEntries((['pops', 'legPops', 'popMax', 'jerkP99', 'fps30', 'fps45', 'fps144', 'fpsJitter', 'slipJog', 'slipRun', 'slipStrafe', 'sink', 'float', 'clip', 'idleHeadMM', 'idleRepeat', 'drift', 'collarP95', 'collarMax', 'legOut', 'legLow'] as (keyof Result)[]).map((k) => [k, avg(k)]));
console.log('\nmean', JSON.stringify(summary));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), results, summary }, null, 2));

// ------------------------------------------------------------------------------- Beta 2.1 quality gate
// `npm run anim21` (--check): the Beta 2.1 animation work may not regress. Thresholds sit between the Beta 2.0 numbers
// (before: slip 0.39–1.07, floor −0.07 m, 24 pops, fps30 0.037) and today's, with room for honest noise.
if (checkMode) {
  const fails: string[] = [];
  const gate = (name: string, ok: boolean, got: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ' — ' + got}`);
    if (!ok) fails.push(name);
  };
  for (const r of results) {
    gate(`${r.look}: planted feet — slip on the floor ≤ 0.15 of the speed (jog ${r.slipJog}, run ${r.slipRun}, strafe ${r.slipStrafe})`, Math.max(r.slipJog, r.slipRun, r.slipStrafe) <= 0.15, JSON.stringify([r.slipJog, r.slipRun, r.slipStrafe]));
    gate(`${r.look}: standing soles on the floor (−1 … +3 cm: ${r.float} m)`, r.float >= -0.01 && r.float <= 0.03, String(r.float));
    // Beta 2.1 final: the slide dash (RINA, ACE, the training bot) buried the shoe 12–16 cm — the whole shoe is measured now
    gate(`${r.look}: shoes never deeper than 4 cm in the floor running, turning or dashing (${r.sink} m)`, r.sink <= 0.04, String(r.sink));
    // Beta 2.2: the boot's shaft stays on the leg (2.1: the collar swung 26–40 cm away at p95), the trouser leg inside the boot
    gate(`${r.look}: the boot's collar stays on the leg — ≤ 1 cm from where the shin carries it (p95 ${r.collarP95}, max ${r.collarMax} m)`, r.collarMax <= 0.01, String(r.collarMax));
    gate(`${r.look}: the trouser leg inside the boot — never out of its upper or below the shaft's band (${r.legOut} / ${r.legLow} m)`, r.legOut <= 0.002 && r.legLow <= 0.001, `${r.legOut} / ${r.legLow}`);
    gate(`${r.look}: body / arm pops ≤ 20 in the busy fight (${r.pops})`, r.pops <= 20, String(r.pops));
    gate(`${r.look}: 30 fps pose within 0.04 rad RMS of 120 fps (${r.fps30})`, r.fps30 <= 0.04, String(r.fps30));
    gate(`${r.look}: weapon never deeper than 7 cm in the torso (${r.clip} m)`, r.clip <= 0.07, String(r.clip));
    gate(`${r.look}: nothing left in the springs after 10 minutes (${r.drift})`, r.drift < 0.001, String(r.drift));
  }
  console.log(fails.length ? `\nanim21: FAILED (${fails.length})` : `\nanim21: OK (${results.length * 9} checks)`);
  proc.exit(fails.length ? 1 : 0);
}
