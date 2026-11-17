// Headless checks for Beta 2.2 — THE BOOT FIX (npm run boots22):
//   * the shape: from the Beta 2.1 build (--legacy21) to today's, every bone of every look (15 fighters, the rivals and
//     the 6 skins) is byte for byte the same except shin vertices, and every vertex that moved stands below the boot's
//     top (the trouser leg tucked inside the boot); the shoes keep their vertices and only gain the bend's morph targets;
//   * the prints: the Beta 2.1 build still gives the pre-1.8.8 model prints (look-baseline.json `before22`), today's
//     build the regenerated ones (`looks`) — the fingerprint method itself is unchanged;
//   * the bend: the eight influences take a vertex of weight 1 exactly back onto the shin for any pitch and roll
//     (R·(v + Δ) = v), weight 0 (the sole, the heel, the toe) turns with the foot; the game never runs the Beta 2.1 mode.
// The motion itself (the collar on the leg, the trouser leg in the boot, every state, all fighters and skins) is gated
// by npm run anim21; the before / after numbers are docs/beta22/anim-{before,after}.json.
import { Euler, Matrix4, Vector3 } from 'three';
import { bootInfluences, RIG_BUILD } from '../src/render/FighterModel';
import { FighterAnimator } from '../src/render/FighterAnimator';
import { fs, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;
const cp = proc.getBuiltinModule('node:child_process');
// (Beta 2.3: «today's» side of this Beta 2.2 check is the Beta 2.2 build — RIG_BUILD.v22, exact to the published 2.2
// prints; what Beta 2.3 changed on purpose on top of it — the head and the limbs — is checked by npm run geo23)
const dump = (legacy: boolean) => JSON.parse(cp.execFileSync('npx', ['tsx', 'scripts/lib/rigDump.ts', legacy ? '--legacy21' : '--v22'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
type Dump = Record<string, { bones: Record<string, string>; shins: Record<string, number[]>; shin: number; boots: boolean; morphs: string[]; print: string }>;
const before: Dump = dump(true);
const after: Dump = dump(false);
const looks = Object.keys(after);

check(`all ${looks.length} looks built both ways (15 fighters, the rivals, the 6 skins)`, looks.length === 21 && looks.every((l) => !!before[l]));
const other = looks.every((l) => Object.keys(after[l].bones).join() === Object.keys(before[l].bones).join() && Object.keys(after[l].bones).every((b) => after[l].bones[b] === before[l].bones[b]));
check('every bone except the shins\' positions is byte for byte the Beta 2.1 one (the shoes, the faces, the weapons, the shins\' colours and normals)', other);
let moved = 0;
let inside = true;
for (const l of looks) {
  const top = 0.11 + (after[l].boots ? 0.27 : 0.17) - 0.015;
  for (const b of ['shinL', 'shinR']) {
    const p0 = before[l].shins[b];
    const p1 = after[l].shins[b];
    if (!p0 || !p1 || p0.length !== p1.length) inside = false;
    else
      for (let i = 0; i < p0.length; i += 3)
        if (p0[i] !== p1[i] || p0[i + 1] !== p1[i + 1] || p0[i + 2] !== p1[i + 2]) {
          moved++;
          if (p0[i + 1] + after[l].shin >= top) inside = false;
        }
  }
}
check(`only shin vertices under the boot's top moved (${moved}, all inside the boot)`, inside && moved > 0);
check('the shoes gained the bend (position + normal morph targets) in today\'s build only', looks.every((l) => after[l].morphs.join() === 'position,normal' && before[l].morphs.length === 0));
const base = JSON.parse(read('scripts/lib/look-baseline.json')) as { looks: Record<string, string>; before22: Record<string, string> };
check('the Beta 2.1 build still gives the pre-1.8.8 model prints (look-baseline.json before22) — the print method is unchanged', Object.keys(base.before22).length === 13 && Object.entries(base.before22).every(([id, p]) => before[id]?.print === p));
check('today\'s build gives the regenerated prints (look-baseline.json looks)', Object.keys(base.looks).length === 13 && Object.entries(base.looks).every(([id, p]) => after[id]?.print === p) && Object.keys(base.looks).every((id) => base.looks[id] !== base.before22[id]));

// the bend's arithmetic
const M = (x: number, y: number, z: number) => [[0, z, -y], [0, y, z], [y, -x, 0], [x, y, 0], [z, 0, 0], [y, 0, 0], [0, z, 0], [0, y, 0]];
let worst = 0;
for (const pitch of [-1.65, -0.75, -0.3, 0, 0.35, 0.8, 1.3])
  for (const roll of [-0.35, -0.1, 0, 0.2, 0.35]) {
    const inf: number[] = [];
    bootInfluences(inf, pitch, roll);
    const v = new Vector3(0.05, 0.31, -0.07);
    const d = new Vector3();
    M(v.x, v.y, v.z).forEach((t, i) => d.add(new Vector3(t[0], t[1], t[2]).multiplyScalar(inf[i])));
    worst = Math.max(worst, v.clone().add(d).applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(pitch, 0, roll))).distanceTo(v));
  }
check(`a shaft vertex (weight 1) lands exactly where the shin carries it for any pitch −1.65…1.3 and roll ±0.35 (worst ${worst.toExponential(1)} m)`, worst < 1e-9);
check('the game builds the Beta 2.2 legs: the Beta 2.1 switches are off by default and set only by the measuring tools', RIG_BUILD.legacy21 === false && FighterAnimator.rigidBoots === false && !/RIG_BUILD\.legacy21\s*=\s*true|rigidBoots\s*=\s*true/.test(read('src/game/Game.ts') + read('src/render/BattleView.ts') + read('src/render/Showcase.ts')));
const anim = read('src/render/FighterAnimator.ts');
check('the animator turns the boot\'s shaft back onto the shin every frame it sets the foot (both meshes of a boot: the shoe and its outline)', /foot\.rotation\.set\(px, 0, pz\);[\s\S]{0,400}bootInfluences\(inf, px, pz\)/.test(anim) && /for \(const ch of foot\.children\)/.test(anim));

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\nboots22: FAILED (${failed} of ${checks.length})` : `\nboots22: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
