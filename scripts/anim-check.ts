// Headless checks for the procedural animation of every fighter in battle (npm run anims):
// player fighters and AI rivals alike. Builds the real rigs (no WebGL needed) and drives the
// animator with fight-like input: stable numbers, state priorities, smooth transitions,
// three victory routines per style with no immediate repeat, weapon fire styles.
import { FIRE_STYLE, VICTORY_SETS } from '../src/config/animation';
import { Rng, wrapAngle } from '../src/core/math';
import { defaultInput, type AnimInput } from '../src/render/FighterAnimator';
import { ModelCache } from '../src/render/ModelCache';
import type { FighterRig } from '../src/render/FighterModel';

const LOOKS = ['ray', 'bruno', 'nika', 'vega', 'kai', 'rina', 'dex', 'tank', 'zoe', 'crash', 'vale'];
const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const models = new ModelCache();
const DT = 1 / 60;

/** Joint rotations that make up the pose (root yaw excluded: spins and turns are deliberate). */
function joints(rig: FighterRig): number[] {
  const out: number[] = [];
  for (const o of [rig.roll, rig.hips, rig.spine, rig.head, rig.shoulderL, rig.shoulderR, rig.elbowL, rig.elbowR, rig.legL, rig.legR, rig.kneeL, rig.kneeR]) out.push(o.rotation.x, o.rotation.y, o.rotation.z);
  out.push(rig.body.position.x, rig.body.position.y, rig.body.position.z);
  return out;
}

let allFinite = true;
let worstJump = 0;
let worstJumpWhere = '';
for (const look of LOOKS) {
  const { rig, anim } = models.get(look);
  anim.reset(0);
  const rng = new Rng(look.length * 977 + 13);
  const inp: AnimInput = defaultInput();
  inp.combat = true;
  inp.maxSpeed = 4.5;
  let prev = joints(rig);
  let dirT = 0;
  // 25 s of a busy fight: running, strafing, backpedalling, turning, shooting, hits, dashes, charges, stuns
  for (let i = 0; i < 60 * 25; i++) {
    const t = i * DT;
    dirT -= DT;
    if (dirT <= 0) {
      dirT = rng.range(0.3, 1.4);
      const a = rng.range(-Math.PI, Math.PI);
      const sp = rng.chance(0.2) ? 0 : rng.range(1, 4.8);
      inp.vx = Math.sin(a) * sp;
      inp.vz = Math.cos(a) * sp;
      inp.facing = rng.range(-Math.PI, Math.PI);
    }
    inp.x += inp.vx * DT;
    inp.z += inp.vz * DT;
    inp.fireIn = (t % 0.6) - 0.05;
    if (i % 36 === 0) anim.fire(i % 72 === 0 ? 1 : 0, rng.chance(0.1));
    if (rng.chance(0.02)) anim.hit(rng.range(-1, 1), rng.range(-1, 1), rng.chance(0.15));
    if (i % 240 === 120) anim.dash(rng.range(-1, 1), rng.range(-1, 1));
    const phase = Math.floor(t / 2.5) % 6;
    inp.action = phase === 2 ? 'windup' : phase === 4 ? 'feint' : 'none';
    inp.actionT = t % 2.5;
    inp.actionTotal = 0.9;
    inp.stunned = phase === 3 && t % 2.5 < 1;
    inp.reading = phase === 5 && t % 2.5 < 0.7;
    inp.zap = look === 'zoe' && phase === 1 && t % 2.5 < 0.45;
    anim.update(DT, inp);
    const cur = joints(rig);
    // the dash itself is deliberate fast motion (a tuck roll turns 360° in 0.3 s): skip its frames
    const inDash = i % 240 >= 120 && i % 240 < 120 + 24;
    for (let k = 0; k < cur.length; k++) {
      if (inDash) continue;
      if (!Number.isFinite(cur[k])) allFinite = false;
      // rotations compare modulo a full turn (a roll that ends at 360° is the same pose)
      const jump = k < 36 ? Math.abs(wrapAngle(cur[k] - prev[k])) : Math.abs(cur[k] - prev[k]);
      if (jump > worstJump) {
        worstJump = jump;
        worstJumpWhere = `${look} joint ${k} t=${t.toFixed(2)}`;
      }
    }
    prev = cur;
  }
}
check('every fighter and rival: the pose stays finite through a busy fight (no NaN)', allFinite);
check(`transitions are smooth: the biggest joint step in one frame is ${worstJump.toFixed(2)} rad (< 0.6; ${worstJumpWhere})`, worstJump < 0.6);

// state priorities
{
  const { rig, anim } = models.get('ray');
  anim.reset(0);
  const inp = defaultInput();
  inp.combat = true;
  for (let i = 0; i < 30; i++) anim.update(DT, inp);
  anim.ko();
  anim.victory();
  check('KO beats victory: a knocked-out fighter never starts a victory routine', anim.victoryRoutine === null);
  for (let i = 0; i < 60; i++) anim.update(DT, inp);
  const before = rig.shoulderR.rotation.x;
  anim.fire(0, true);
  for (let i = 0; i < 6; i++) anim.update(DT, inp);
  check('KO beats shooting: a late shot does not move a knocked-out body', Math.abs(rig.shoulderR.rotation.x - before) < 0.02 && rig.koEyes.visible);
  anim.reset(0);
  check('a new fight starts clean (no KO left over)', !rig.koEyes.visible && rig.eyes.visible);
}
{
  // a stunned fighter drops the aim (the attack was interrupted)
  const { rig, anim } = models.get('vega');
  anim.reset(0);
  const inp = defaultInput();
  inp.combat = true;
  for (let i = 0; i < 60; i++) anim.update(DT, inp);
  const aimed = rig.shoulderL.rotation.x;
  inp.stunned = true;
  for (let i = 0; i < 40; i++) anim.update(DT, inp);
  check('stun beats aiming: the arms come off the aim while stunned', rig.shoulderL.rotation.x > aimed + 0.6);
}
{
  // Zoe raises the shocker hand while her SHOCK charges
  const { rig, anim } = models.get('zoe');
  anim.reset(0);
  const inp = defaultInput();
  inp.combat = true;
  for (let i = 0; i < 30; i++) anim.update(DT, inp);
  inp.zap = true;
  for (let i = 0; i < 24; i++) anim.update(DT, inp);
  check('Zoe: the shocker hand reaches toward the target during the charge', rig.shoulderL.rotation.x < -1.25 && rig.elbowL.rotation.x > -0.6);
}

// victory routines
for (const [style, set] of Object.entries(VICTORY_SETS)) {
  check(`victory style ${style}: three routines`, set.length === 3);
}
{
  let repeats = 0;
  const seen = new Set<string>();
  for (const look of ['ray', 'bruno', 'nika', 'vega', 'kai', 'rina', 'crash', 'vale']) {
    const { anim } = models.get(look);
    let last: string | null = null;
    for (let i = 0; i < 40; i++) {
      anim.reset(0);
      anim.victory();
      const r = anim.victoryRoutine;
      if (r && r === last) repeats++;
      if (r) seen.add(r);
      last = r;
    }
  }
  check(`victories: never the same routine twice in a row (repeats: ${repeats})`, repeats === 0);
  check(`victories: all 24 routines of the eight characters come up (${seen.size})`, seen.size === 24);
}

// weapon fire styles
{
  const weapons = Object.keys(FIRE_STYLE);
  check(`fire styles exist for all ${weapons.length} weapons`, weapons.length === 7);
  // the opening shot after a pause commits harder than the next shot of the series
  const { rig, anim } = models.get('bruno');
  anim.reset(0);
  const inp = defaultInput();
  inp.combat = true;
  for (let i = 0; i < 90; i++) anim.update(DT, inp);
  const peak = () => {
    let p = 0;
    for (let i = 0; i < 18; i++) {
      anim.update(DT, inp);
      p = Math.max(p, rig.kneeL.rotation.x);
    }
    return p;
  };
  const base = rig.kneeL.rotation.x;
  anim.fire(0, false);
  const first = peak() - base;
  anim.fire(0, false);
  const second = peak() - base;
  check(`Bruno standing: the legs soak the blast, the opening shot harder than the follow-up (${first.toFixed(3)} > ${second.toFixed(3)} > 0)`, first > second && second > 0);
}

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
}
console.log(ok ? `anims: OK (${checks.length} checks)` : 'anims: FAILED');
const proc = (globalThis as { process?: { exitCode?: number } }).process;
if (!ok && proc) proc.exitCode = 1;
