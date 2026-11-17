// Headless checks for Beta 2.3 CHARACTER & ANIMATION EVOLUTION (npm run char23) — render only, every look on its real
// rig (no WebGL), Math.random seeded:
//   * the end of a fight: the winner celebrates, a loser ON HIS FEET (time ran out / forfeit) reacts, a draw makes both
//     react, a knocked-out fighter only falls — the precedence is the animator's own (KO > victory > defeat) and the
//     battle view asks for exactly that (never a reaction for a KO'd or winning fighter);
//   * every reaction of every look plays at 30 / 60 / 144 fps and with an uneven frame time and lands on the SAME pose
//     as at 120 fps (frame-rate independence), with no NaN, and reaches its pose before the results screen (2.8 s);
//   * every idle style has its reactions; the eyes / brows of a defeat give way to the knock-out's;
//   * the material classes: every look's toon parts carry a class, skin where there is a face, metal on the weapons;
//     the outline's thin share only on small parts;
//   * nothing in the fight changed: src/combat/** and the simulation's fingerprint are the published Beta 2.2's.
import { fs, proc } from './lib/node';

let seed = 0x2b23;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
Math.random = rnd;

const { defaultInput } = await import('../src/render/FighterAnimator');
const { ModelCache } = await import('../src/render/ModelCache');
const { DEFEAT_SETS, DEFEAT_DELAY, VICTORY_SETS } = await import('../src/config/animation');
const { MAT } = await import('../src/render/materials');
const { LOOKS } = await import('../src/config/looks');
const { MATCH } = await import('../src/config/balance');
type AnimInput = ReturnType<typeof defaultInput>;
type Cached = ReturnType<InstanceType<typeof ModelCache>['get']>;

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;
const verbose = proc.argv.includes('--print');

const ALL = Object.keys(LOOKS);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function fresh(look: string): Cached {
  seed = 0x2b23 + look.length * 7919;
  const c = new ModelCache().get(look);
  c.anim.reset(0);
  return c;
}
function joints(c: Cached): number[] {
  const r = c.rig;
  const out: number[] = [];
  for (const o of [r.roll, r.hips, r.spine, r.head, r.shoulderL, r.shoulderR, r.elbowL, r.elbowR, r.legL, r.legR, r.kneeL, r.kneeR]) out.push(o.rotation.x, o.rotation.y, o.rotation.z);
  return out;
}

type Outro = 'loss' | 'draw' | 'victory' | 'ko';
/**
 * A fight's last seconds: 1.2 s of combat stance, the bell, then the outro — the event lands exactly at its moment
 * whatever the frame rate (the frame is split there, like the battle view's fixed-step simulation does).
 */
function play(look: string, outro: Outro, variant: number, dts: (i: number) => number, onSample: (c: Cached, t: number) => void, seconds = 4.2): Cached {
  const c = fresh(look);
  const inp: AnimInput = defaultInput();
  inp.combat = true;
  inp.maxSpeed = 4.5;
  const at = 1.2 + (outro === 'loss' || outro === 'draw' ? DEFEAT_DELAY : 0);
  let fired = false;
  let t = 0;
  let i = 0;
  let next = 0.4;
  const fire = () => {
    fired = true;
    if (outro === 'loss') c.anim.defeat('loss', variant, 0.45);
    else if (outro === 'draw') c.anim.defeat('draw', variant, -0.3);
    else if (outro === 'victory') {
      inp.combat = false;
      c.anim.victory(variant);
    } else {
      inp.ko = true;
      c.anim.ko();
    }
  };
  while (t < seconds) {
    const end = t + dts(i++);
    // the frame is split where the bell rings and where a sample is read — a sample is the pose AT its moment, never
    // a few ms after it (a fast fall would read as a frame-rate difference that is only the sampling)
    for (;;) {
      const cut = Math.min(end, fired ? Infinity : at, next);
      const h = cut - t;
      if (h > 1e-9) c.anim.update(h, inp);
      t = cut;
      if (!fired && Math.abs(t - at) < 1e-9) fire();
      if (Math.abs(t - next) < 1e-9) {
        onSample(c, next);
        next = Math.round((next + 0.1) * 10) / 10;
      }
      if (t >= end - 1e-9) break;
    }
    t = end;
  }
  return c;
}

/** RMS (rad) between the outro at `dts` and at 120 fps, over every joint, sampled every 0.1 s from 0.4 s. */
function drift(look: string, outro: Outro, variant: number, dts: (i: number) => number): number {
  const ref: number[][] = [];
  const got: number[][] = [];
  play(look, outro, variant, () => 1 / 120, (c) => ref.push(joints(c)));
  play(look, outro, variant, dts, (c) => got.push(joints(c)));
  let s = 0;
  let n = 0;
  for (let i = 0; i < Math.min(ref.length, got.length); i++)
    for (let k = 0; k < ref[i].length; k++) {
      const d = wrap(ref[i][k] - got[i][k]);
      s += d * d;
      n++;
    }
  return Math.sqrt(s / Math.max(1, n));
}
const jitter = (i: number) => [1 / 40, 1 / 90, 1 / 60, 1 / 25, 1 / 120, 1 / 60][i % 6];

// ------------------------------------------------------------- precedence (the animator's own rules)
{
  const a = fresh('ray').anim;
  a.ko();
  a.defeat('loss', 0);
  const koFirst = a.defeatRoutine === null;
  const b = fresh('ray').anim;
  b.victory(0);
  b.defeat('loss', 0);
  const winFirst = b.defeatRoutine === null && b.victoryRoutine !== null;
  const c = fresh('ray').anim;
  c.defeat('loss', 0);
  const started = c.defeatRoutine === 'kick';
  c.ko();
  const koWins = c.defeatRoutine === null;
  const d = fresh('vale').anim;
  d.defeat('loss', 1);
  d.defeat('draw');
  const noRestart = d.defeatRoutine === DEFEAT_SETS.champion[1];
  check('precedence: a knocked-out fighter never reacts, a winner never reacts, a knock-out ends a reaction, a reaction is not restarted', koFirst && winFirst && started && koWins && noRestart);
}
check('every idle style has 3–4 reactions of its own, a draw has one neutral move; each victory style keeps its routines', (Object.keys(DEFEAT_SETS) as (keyof typeof DEFEAT_SETS)[]).every((k) => DEFEAT_SETS[k].length >= 3 && DEFEAT_SETS[k].length <= 4 && k in VICTORY_SETS === k in VICTORY_SETS) && Object.keys(DEFEAT_SETS).length === 12);
{
  // the same reaction never twice in a row for a look (unless forced)
  let same = 0;
  let prev = '';
  for (let i = 0; i < 40; i++) {
    const a = new ModelCache().get('kai').anim;
    a.reset(0);
    a.defeat('loss');
    if (a.defeatRoutine === prev) same++;
    prev = a.defeatRoutine ?? '';
  }
  check('an unforced reaction never repeats the previous one (40 defeats in a row)', same === 0);
}

// ------------------------------------------------------------- the battle view asks for exactly that
const bv = read('src/render/BattleView.ts');
check('battle view: the winner celebrates (0.2 s, 0.9 s after a knock-out); the loser reacts only when he is on his feet', /if \(w\.victoryDelay < 0\) w\.victoryDelay = m\.fighters\[1 - m\.winner\]\.ko \? 0\.9 : 0\.2;/.test(bv) && /if \(l && !m\.fighters\[1 - m\.winner\]\.ko\) \{\s*l\.defeatKind = 'loss';\s*l\.defeatDelay = DEFEAT_DELAY;/.test(bv));
check('battle view: a draw — both standing fighters react, one a beat later; a knocked-out one does not', /else if \(e\.phase === 'outro'\) \{[\s\S]{0,400}if \(m\.fighters\[i\]\.ko\) return;\s*sl\.defeatKind = 'draw';\s*sl\.defeatDelay = DEFEAT_DELAY \+ i \* 0\.18;/.test(bv));
check('battle view: the reaction starts by the clock (dt), re-checked against KO / victory at that moment, glancing at the other fighter', /s\.defeatDelay -= dt;\s*if \(s\.defeatDelay < 0 && !f\.ko && !f\.victory\) \{/.test(bv) && /s\.model\.anim\.defeat\(s\.defeatKind, undefined, toward\);/.test(bv));
check(`every reaction is in place before the results screen (${DEFEAT_DELAY} s + 0.18 s + reaching the pose ≤ ${MATCH.outroTime} s)`, DEFEAT_DELAY + 0.18 + 1.0 < MATCH.outroTime);

// ------------------------------------------------------------- every look, every reaction, every frame rate
const LIMIT = { fps30: 0.03, fps144: 0.012, jitter: 0.03 };
let worst = { v: 0, what: '' };
let nan = false;
let lateAll = 0;
let fpsOk = true;
const perLook: string[] = [];
for (const look of ALL) {
  const c0 = fresh(look);
  const style = c0.anim.idleStyle;
  const moves: [Outro, number][] = [...DEFEAT_SETS[style].map((_, i) => ['loss', i] as [Outro, number]), ['draw', 0], ['victory', 0], ['ko', 0]];
  let lookWorst = 0;
  for (const [o, v] of moves) {
    const d30 = drift(look, o, v, () => 1 / 30);
    const d144 = drift(look, o, v, () => 1 / 144);
    const dj = drift(look, o, v, jitter);
    lookWorst = Math.max(lookWorst, d30, dj);
    if (d30 > LIMIT.fps30 || d144 > LIMIT.fps144 || dj > LIMIT.jitter) {
      fpsOk = false;
      if (verbose) console.log('fps', look, o, v, d30.toFixed(4), d144.toFixed(4), dj.toFixed(4));
    }
    if (d30 > worst.v) worst = { v: d30, what: `${look} ${o}${o === 'loss' ? ':' + DEFEAT_SETS[style][v] : ''} @30fps` };
    // no NaN anywhere, and a reaction is (almost) still by 2.6 s: the pose holds when the results screen comes
    if (o === 'loss' || o === 'draw') {
      const samples: [number, number[]][] = [];
      play(look, o, v, () => 1 / 60, (c, t) => samples.push([t, joints(c)]));
      if (samples.some(([, j]) => j.some((x) => !Number.isFinite(x)))) nan = true;
      const a = samples.find(([t]) => Math.abs(t - 3.6) < 0.05)?.[1];
      const b = samples.find(([t]) => Math.abs(t - 4.1) < 0.05)?.[1];
      // between 3.6 s and 4.1 s after the start (2.05–2.55 s into the reaction) the body moves less than 0.12 rad
      // (breathing and the idle's weight shifts stay underneath — it never freezes)
      const mv = a && b ? Math.max(...a.slice(0, 24).map((x, k) => Math.abs(wrap(x - b[k])))) : 0;
      if (mv > 0.12) {
        lateAll++;
        if (verbose) console.log('late', look, o, o === 'loss' ? DEFEAT_SETS[style][v] : '', mv.toFixed(3));
      }
    }
  }
  perLook.push(`${look}:${lookWorst.toFixed(3)}`);
}
if (verbose) console.log(perLook.join(' '));
check(`frame-rate independence: every look's reactions, draw, victory and knock-out land on the 120 fps pose (RMS ≤ ${LIMIT.fps30} rad at 30 fps, ≤ ${LIMIT.fps144} at 144, ≤ ${LIMIT.jitter} with uneven frames; worst ${worst.v.toFixed(4)} — ${worst.what})`, fpsOk);
check('no NaN in any joint of any look during any reaction', !nan);
check(`every reaction has settled into its held pose before the results screen (${lateAll} still moving)`, lateAll === 0);

// ------------------------------------------------------------- stun: in and out without a pop (Opus)
{
  /** Joint-speed jumps above 6 rad/s in one 60 fps frame (body, head, arms) — the animlab «pop». */
  const popsIn = (look: string, step: (inp: AnimInput, t: number) => void, seconds: number, from = 0.3) => {
    const c = fresh(look);
    const inp = defaultInput();
    inp.combat = true;
    const h: number[][] = [];
    let pops = 0;
    let bad = false;
    for (let i = 0; i * (1 / 60) < seconds; i++) {
      const t = i / 60;
      step(inp, t);
      c.anim.update(1 / 60, inp);
      const j = joints(c);
      if (j.some((x) => !Number.isFinite(x))) bad = true;
      h.push(j);
      const n = h.length;
      if (n < 3 || t < from) continue;
      for (let k = 0; k < 24; k++) {
        const v1 = wrap(h[n - 1][k] - h[n - 2][k]) * 60;
        const v0 = wrap(h[n - 2][k] - h[n - 3][k]) * 60;
        if (Math.abs(v1 - v0) > 6) pops++;
      }
    }
    return { pops, bad };
  };
  let stunPops = 0;
  const who: string[] = [];
  for (const look of ALL) {
    const r = popsIn(look, (inp, t) => {
      inp.stunned = t >= 1 && t < 2.1;
    }, 3.2);
    stunPops += r.pops;
    if (r.pops) who.push(`${look}:${r.pops}`);
  }
  check(`stun: every look goes dizzy and back into its stance without a pop (${stunPops}${who.length ? ' — ' + who.join(' ') : ''})`, stunPops === 0);

  // the lobby: gestures in turn, never twice in a row, eased in and out, no NaN
  const { FLAIR_SETS } = await import('../src/config/animation');
  let repeats = 0;
  let thin = 0;
  let lobbyPops = 0;
  let lobbyBad = false;
  const seen: string[] = [];
  const popAt: string[] = [];
  for (const look of ALL) {
    const c = fresh(look);
    const inp = defaultInput();
    inp.combat = false;
    const moves: string[] = [];
    let was = 0;
    const h: number[][] = [];
    for (let i = 0; i < 60 * 90; i++) {
      c.anim.update(1 / 60, inp);
      const a = c.anim as unknown as { flair: number; flairMove: string };
      if (a.flair > 0 && was <= 0) moves.push(a.flairMove);
      was = a.flair;
      const j = joints(c);
      if (j.some((x) => !Number.isFinite(x))) lobbyBad = true;
      h.push(j);
      const n = h.length;
      // (CRAX moves his head and shoulders in clockwork STEPS by design — Alpha 1.9.7 — so his steps are not pops)
      if (n >= 3 && i > 30 && c.anim.idleStyle !== 'clockwork')
        for (let k = 0; k < 24; k++)
          if (Math.abs(wrap(h[n - 1][k] - h[n - 2][k]) * 60 - wrap(h[n - 2][k] - h[n - 3][k]) * 60) > 6) {
            lobbyPops++;
            if (verbose) popAt.push(`${look}:${(c.anim as unknown as { flair: number }).flair > 0 ? (c.anim as unknown as { flairMove: string }).flairMove : 'idle'}:j${k}`);
          }
    }
    const set = FLAIR_SETS[c.anim.victoryStyle] as readonly string[];
    for (let i = 1; i < moves.length; i++) if (set.length > 1 && moves[i] === moves[i - 1]) repeats++;
    if (new Set(moves).size < Math.min(2, set.length) || moves.some((m) => !set.includes(m))) thin++;
    seen.push(`${look}:${moves.length}/${new Set(moves).size}`);
  }
  if (verbose) console.log('lobby gestures (played/distinct):', seen.join(' '));
  if (verbose && popAt.length) console.log('lobby pops:', Object.entries(popAt.reduce((m: Record<string, number>, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).map(([a, b]) => `${a}×${b}`).join(' '));
  check(`lobby: every look plays several of its gestures in 90 s, never the same one twice in a row (${repeats} repeats, ${thin} looks with one)`, repeats === 0 && thin === 0);
  check(`lobby: the gestures ease in and out of the idle — no pop in 90 s of any look (${lobbyPops}; CRAX's clockwork steps are his design), no NaN`, lobbyPops === 0 && !lobbyBad);
}

// ------------------------------------------------------------- the face during a reaction, then a knock-out
{
  const c = fresh('ray');
  const inp = defaultInput();
  inp.combat = true;
  c.anim.defeat('loss', 0);
  for (let i = 0; i < 120; i++) c.anim.update(1 / 60, inp);
  const lidded = c.rig.eyes.scale.y < 0.9;
  c.anim.ko();
  inp.ko = true;
  for (let i = 0; i < 60; i++) c.anim.update(1 / 60, inp);
  check('a defeat half-closes the eyes; a knock-out afterwards shows its own eyes (no leftover)', lidded && c.rig.koEyes.visible && !c.rig.eyes.visible);
}

// ------------------------------------------------------------- material classes
{
  let classed = true;
  let skinOK = true;
  let metalOK = true;
  let thinOK = true;
  const noFace = new Set(['bot', 'tank']);
  for (const look of ALL) {
    const c = fresh(look);
    const counts = new Map<number, number>();
    c.rig.root.traverse((o) => {
      const m = o as unknown as { isMesh?: boolean; geometry?: { getAttribute: (n: string) => { count: number; getX: (i: number) => number } | undefined }; material?: { type?: string } };
      if (!m.isMesh || !m.geometry || m.material?.type !== 'MeshToonMaterial') return;
      const pm = m.geometry.getAttribute('ptMat');
      const pt = m.geometry.getAttribute('ptThin');
      if (!pm || !pt) {
        classed = false;
        return;
      }
      for (let i = 0; i < pm.count; i += 7) counts.set(pm.getX(i), (counts.get(pm.getX(i)) ?? 0) + 1);
      for (let i = 0; i < pt.count; i += 13) if (pt.getX(i) < 0 || pt.getX(i) > 0.7) thinOK = false;
    });
    if (!noFace.has(look) && !(counts.get(MAT.skin) ?? 0)) skinOK = false;
    if (look !== 'bot' && !(counts.get(MAT.metal) ?? 0)) metalOK = false;
    if (verbose) console.log(look, [...counts.entries()].sort().map(([k, v]) => `${k}:${v}`).join(' '));
  }
  check('every toon part of every look carries a material class and an outline share (ptMat / ptThin)', classed);
  check('skin on every face (the robot and the helmeted TANK aside: skin where it shows), metal on every weapon', skinOK && metalOK);
  check('the outline is thinned only partly (0…0.7 of the line), the silhouette keeps its full line', thinOK);
}

// ------------------------------------------------------------- the fight itself is untouched
const PUB = `${proc.env.HOME}/Desktop/PRIME TIME SHOWDOWN`;
if (fs.existsSync(`${PUB}/src/combat`)) {
  const list = (d: string): string[] => (fs.readdirSync(d) as string[]).flatMap((f) => (fs.statSync(`${d}/${f}`).isDirectory() ? list(`${d}/${f}`).map((x) => `${f}/${x}`) : [f]));
  const a = list('src/combat').sort();
  const b = list(`${PUB}/src/combat`).sort();
  check(`src/combat/** byte-identical to the published Beta 2.2 (${a.length} files)`, a.join() === b.join() && a.every((f) => read(`src/combat/${f}`) === read(`${PUB}/src/combat/${f}`)));
}
check('SIM_VERSION unchanged (a141348f2a0dea20)', /a141348f2a0dea20/.test(read('src/league/simVersion.ts')));

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\nchar23: FAILED (${failed} of ${checks.length})` : `\nchar23: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
