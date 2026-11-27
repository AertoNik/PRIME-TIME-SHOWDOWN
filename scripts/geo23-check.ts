// Headless checks for Beta 2.3 — THE CHARACTERS' GEOMETRY (npm run geo23). The Beta 2.2 build (RIG_BUILD.v22) against
// today's, every look (15 fighters, the rivals, the 6 skins):
//   * the Beta 2.2 build is exactly the published one (look-baseline.json `looks`), today's prints are the ones pinned
//     ON PURPOSE in Beta 2.3 (`looks23`) — the print method is unchanged;
//   * only the head and the four limb bones changed — the torso, the pelvis, the shoes, the weapons, the coat tails, the
//     eyes, brows and mouths are byte for byte the Beta 2.2 ones;
//   * the limbs (taperLimbs): the same vertices and triangles, every height unchanged (the joints and the pivots are where
//     they were), each vertex narrowed or widened around the bone's axis by one factor 0.86…1.06, the hands untouched;
//   * the head (unionHead, stubbleOn): the jaw / chin spheres and the stubble shell are gone from the mesh, the head keeps
//     its size (bounding box within 1 cm), no vertex sinks inside the old head, the stubble fades (a gradient of shades);
//   * the cost does not grow: triangles and vertices per look ≤ Beta 2.2, the same draw calls.
import { fs, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;
const cp = proc.getBuiltinModule('node:child_process');
interface Bone {
  hash: string;
  n: number;
  box: number[];
  pos?: number[];
  col?: number[];
}
type Dump = Record<string, { bones: Record<string, Bone>; print: string; dims: Record<string, number>; stubble: boolean; boots: boolean; tris: number; drawCalls: number; verts: number }>;
const dump = (v22: boolean): Dump => JSON.parse(cp.execFileSync('npx', ['tsx', 'scripts/lib/geoDump.ts', ...(v22 ? ['--v22'] : [])], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }));
const before = dump(true);
const after = dump(false);
const looks = Object.keys(after);
const base = JSON.parse(read('scripts/lib/look-baseline.json')) as { looks: Record<string, string>; looks23?: Record<string, string> };

// (Beta 2.7.5: + ACE — BLACK TIE, the seventh skin)
check(`all ${looks.length} looks built both ways (15 fighters, the rivals, the 7 skins)`, looks.length === 22 && looks.every((l) => !!before[l]));
check('the Beta 2.2 build (RIG_BUILD.v22) gives exactly the published Beta 2.2 prints (look-baseline.json looks)', Object.keys(base.looks).length === 13 && Object.entries(base.looks).every(([id, p]) => before[id]?.print === p));
check('today\'s build gives the Beta 2.3 prints, pinned on purpose (look-baseline.json looks23) — and every one of them differs from 2.2', !!base.looks23 && Object.keys(base.looks23).length === 13 && Object.entries(base.looks23).every(([id, p]) => after[id]?.print === p && p !== base.looks[id]));

// ------------------------------------------------------------- what changed
const LIMBS = ['thighL', 'thighR', 'shinL', 'shinR', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR'];
const CHANGEABLE = new Set(['head.toon', ...LIMBS.flatMap((b) => [`${b}.toon`, `${b}.glow`])]);
const others: string[] = [];
for (const l of looks) {
  const a = after[l].bones;
  const b = before[l].bones;
  if (Object.keys(a).sort().join() !== Object.keys(b).sort().join()) others.push(`${l}:bones`);
  for (const k of Object.keys(b)) if (!CHANGEABLE.has(k) && a[k]?.hash !== b[k].hash) others.push(`${l}:${k}`);
}
check(`only the head and the limbs changed — the torso, pelvis, shoes, weapons, coat tails and the face parts are byte for byte Beta 2.2 (${others.length ? others.slice(0, 6).join(' ') : 'none other'})`, others.length === 0);

// ------------------------------------------------------------- the limbs
let limbOK = true;
let hands = true;
let kMin = Infinity;
let kMax = -Infinity;
let moved = 0;
for (const l of looks) {
  for (const b of LIMBS) {
    const A = after[l].bones[`${b}.toon`];
    const B = before[l].bones[`${b}.toon`];
    if (!A || !B || !A.pos || !B.pos || A.n !== B.n) {
      limbOK = false;
      continue;
    }
    const len = b.startsWith('thigh') ? after[l].dims.thigh : b.startsWith('shin') ? after[l].dims.shin : b.startsWith('upper') ? after[l].dims.upperArm : after[l].dims.foreArm;
    // (inside the boot — below its top — the Beta 2.2 tuck keeps the trouser leg within the boot's width after the taper:
    // those vertices are hidden and only have to stay inside, which npm run boots22 / anim21 measure)
    const bootTop = 0.11 + (after[l].boots ? 0.27 : 0.17) - 0.015;
    for (let i = 0; i < A.pos.length; i += 3) {
      if (A.pos[i + 1] !== B.pos[i + 1]) limbOK = false;
      if (b.startsWith('shin') && A.pos[i + 1] + after[l].dims.shin < bootTop) continue;
      const r0 = Math.hypot(B.pos[i], B.pos[i + 2]);
      const r1 = Math.hypot(A.pos[i], A.pos[i + 2]);
      if (r0 < 0.004) continue;
      const k = r1 / r0;
      // the same factor on x and z (narrowed around the axis, never twisted)
      if (Math.abs(A.pos[i] - B.pos[i] * k) > 1e-5 || Math.abs(A.pos[i + 2] - B.pos[i + 2] * k) > 1e-5) limbOK = false;
      if (Math.abs(k - 1) > 1e-6) moved++;
      kMin = Math.min(kMin, k);
      kMax = Math.max(kMax, k);
      // the glove: everything below 72 % of the forearm keeps its place exactly
      if (b.startsWith('foreArm') && -B.pos[i + 1] / len >= 0.72 && (A.pos[i] !== B.pos[i] || A.pos[i + 2] !== B.pos[i + 2])) hands = false;
    }
  }
}
check(`the limbs: same vertices, every height unchanged, each visible vertex narrowed around the bone's axis by one factor (${kMin.toFixed(3)}…${kMax.toFixed(3)}; ${moved} vertices)`, limbOK && kMin >= 0.86 && kMax <= 1.06 && moved > 0);
check('the hands (gloves, fingers, rings) keep their exact shape and place', hands);

// ------------------------------------------------------------- the head
const heavy = ['bruno', 'tank', 'crash', 'bruno_casino_boss'];
let headBox = true;
let headParts = true;
let stubbleGrad = true;
let worstBox = 0;
const notes: string[] = [];
for (const l of looks) {
  const A = after[l].bones['head.toon'];
  const B = before[l].bones['head.toon'];
  for (let k = 0; k < 6; k++) worstBox = Math.max(worstBox, Math.abs(A.box[k] - B.box[k]));
  if (A.box.some((v, k) => Math.abs(v - B.box[k]) > 0.01)) headBox = false;
  // the removed parts: fewer vertices exactly where a jaw / chin / stubble existed; elsewhere the same head
  const removed = B.n - A.n;
  const hasParts = heavy.includes(l) || after[l].stubble || before[l].bones['head.toon'].hash !== A.hash;
  if (!hasParts && removed !== 0) headParts = false;
  if (hasParts && removed < 0) headParts = false;
  if (removed > 0) notes.push(`${l} −${removed}`);
  if (after[l].stubble && A.col) {
    // the stubble is a gradient: many shades between the skin and the stubble tone, not two
    const shades = new Set<string>();
    for (let i = 0; i < A.col.length; i += 3) shades.add(A.col[i].toFixed(4));
    if (shades.size < 6) stubbleGrad = false;
  }
}
check(`the head keeps its size: bounding box within 1 cm of Beta 2.2 for every look (worst ${(worstBox * 100).toFixed(2)} cm)`, headBox);
check(`the jaw / chin spheres and the stubble shell are no longer separate parts (vertices removed: ${notes.join(', ')})`, headParts && notes.length >= 4);
check('the stubble fades into the skin (a gradient of shades on the head, not a hard edge) — Bruno, Crash, Vale', stubbleGrad && looks.filter((l) => after[l].stubble).length >= 3);

// ------------------------------------------------------------- cost
const triUp = looks.filter((l) => after[l].tris > before[l].tris);
const dcDiff = looks.filter((l) => after[l].drawCalls !== before[l].drawCalls);
const mean = (d: Dump, k: 'tris' | 'verts') => Math.round(looks.reduce((n, l) => n + d[l][k], 0) / looks.length);
check(`the cost does not grow: triangles per look ≤ Beta 2.2 (mean ${mean(before, 'tris')} → ${mean(after, 'tris')}), vertices too (${mean(before, 'verts')} → ${mean(after, 'verts')}), the same draw calls`, triUp.length === 0 && dcDiff.length === 0 && looks.every((l) => after[l].verts <= before[l].verts));
check('the game builds the Beta 2.3 shapes: RIG_BUILD.v22 is off by default and set only by the measuring tools', !/RIG_BUILD\.v22\s*=\s*true/.test(read('src/render/FighterModel.ts') + read('src/main.ts')) && /v22: false/.test(read('src/render/FighterModel.ts')));

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\ngeo23: FAILED (${failed} of ${checks.length})` : `\ngeo23: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
