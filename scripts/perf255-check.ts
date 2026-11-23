// Beta 2.5.5 — `npm run perf255`: the performance changes of 2.5.5, checked headless.
//   1. the automatic quality's decision (src/render/framePacing.ts) on frame-time traces: a slow average AND frequent
//      long frames step the quality down; at the lowest quality the game is paced to an even 30 fps; one hitch changes
//      nothing; a device that keeps up is never touched;
//   2. the paced loop's gate on a simulated stream of screen refreshes (60 / 90 / 120 Hz, with jitter): every drawn
//      frame comes after an even ~33 ms — the gate Game.loop uses, not a copy;
//   3. the code: a set's materials are let go without material.dispose() (shader programs stay compiled — the
//      0.15–0.75 s first frame on every return to a set, docs/beta255/perf255.md), the career's next rival is drawn
//      before its fight, a quality chosen by hand turns pacing off, the fight simulation is untouched.
// What this does NOT prove: how a real iPhone behaves — that needs the device (docs/BETA_2_5_5_DEVELOPMENT_REPORT.md).
import { LONG_FRAME_S, PACED_INTERVAL_S, PACING_WINDOW, SLOW_AVG_S, pacingStep, tooEarly } from '../src/render/framePacing';
import { SIM_VERSION } from '../src/league/simVersion';
import { fs, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;
const trace = (fn: (i: number) => number, n = PACING_WINDOW) => Array.from({ length: n }, (_, i) => fn(i));
const oldRule = (t: number[]) => t.reduce((a, b) => a + b, 0) / t.length > SLOW_AVG_S; // until 2.5: the average only

// ------------------------------------------------------------- 1. the decision
const s60 = trace(() => 1 / 60);
const s30 = trace(() => 1 / 30);
const judder = trace((i) => (i % 2 ? 1 / 30 : 1 / 60)); // 16.7 / 33.3 ms in turn
const hz120spikes = trace((i) => (i % 9 < 2 ? 0.03 : 1 / 120)); // 120 Hz, 2 frames in 9 at 30 ms (22 %)
const oneHitch = trace((i) => (i === 40 ? 0.5 : 1 / 60));
const someLong = trace((i) => (i % 20 < 3 ? 0.03 : 1 / 60)); // 15 % long
check('a device that keeps 60 fps is never touched (high stays high, no pacing)', pacingStep(s60, 'high', false) === null && pacingStep(s60, 'low', false) === null);
check('a steady 30 fps on «high» steps down as before (the average rule)', pacingStep(s30, 'high', false) === 'down' && oldRule(s30));
check('judder 16 / 33 ms steps down', pacingStep(judder, 'high', false) === 'down');
check(`frequent long frames step down even when the average looks fine (120 Hz with 22 % of frames at 30 ms: average ${((hz120spikes.reduce((a, b) => a + b, 0) / hz120spikes.length) * 1000).toFixed(1)} ms — the old rule said nothing)`, pacingStep(hz120spikes, 'high', false) === 'down' && !oldRule(hz120spikes));
check('a single hitch (a 0.5 s screen change among smooth frames) changes nothing', pacingStep(oneHitch, 'high', false) === null);
check(`fewer long frames than the line (15 % < ${20} %) and a fine average: nothing`, pacingStep(someLong, 'medium', false) === null);
check('still struggling at the LOWEST quality → an even 30 fps (pace30); once paced, nothing more', pacingStep(judder, 'low', false) === 'pace30' && pacingStep(s30, 'low', true) === null);
check(`a decision needs a full window (${PACING_WINDOW} frames)`, pacingStep(trace(() => 1 / 20, PACING_WINDOW - 1), 'high', false) === null);
check(`the lines: average slower than 42 fps, a long frame over ${Math.round(LONG_FRAME_S * 1000)} ms, a fifth of them`, Math.abs(SLOW_AVG_S - 1 / 42) < 1e-9 && Math.abs(LONG_FRAME_S - 0.025) < 1e-9);

// ------------------------------------------------------------- 2. the paced loop on a refresh stream
function paced(hz: number, jitterMs: number, frames = 600): number[] {
  // the loop's own rule: a refresh that comes too early is skipped (Game.loop → tooEarly)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const out: number[] = [];
  let last = 0;
  for (let k = 1; out.length < frames; k++) {
    const t = k / hz + (rnd() * jitterMs) / 1000;
    if (tooEarly(t - last, PACED_INTERVAL_S)) continue;
    out.push((t - last) * 1000);
    last = t;
  }
  return out.slice(5);
}
for (const [hz, j] of [[60, 0.6], [120, 0.4], [90, 0.5], [144, 0.3]] as const) {
  const iv = paced(hz, j);
  const lo = Math.min(...iv);
  const hi = Math.max(...iv);
  check(`paced at ${hz} Hz (±${j} ms refresh jitter): every frame ${lo.toFixed(1)}–${hi.toFixed(1)} ms apart — even, about 30 fps`, lo >= 28 && hi <= 36);
}
check('pacing off (interval 0): no refresh is ever skipped', [0.001, 0.008, 0.0167, 0.1].every((e) => !tooEarly(e, 0)));

// ------------------------------------------------------------- 3. the code
const kit = read('src/render/stages/StageKit.ts');
const stages = ['GraveyardStage', 'NewsroomStage', 'HolidayStage'].map((s) => read(`src/render/stages/${s}.ts`));
const disposeBody = (src: string) => {
  const i = src.indexOf('dispose(): void {');
  return i < 0 ? '' : src.slice(i, src.indexOf('\n  }\n', i));
};
check('a set\'s materials are let go without material.dispose() — textures and geometries still freed (StageKit and the three sets with their own lists)', /export function dropMaterial\(m: Material\): void/.test(kit) && /dropMaterial\(m\);/.test(disposeBody(kit)) && !/\bm\.dispose\(\);/.test(disposeBody(kit)) && /t\.dispose\(\)/.test(disposeBody(kit)) && /g\.dispose\(\)/.test(disposeBody(kit)) && stages.every((s) => /dropMaterial\(m\);/.test(disposeBody(s)) && !/\bm\.dispose\(\);/.test(disposeBody(s))));
check('…except a material the shadow pass copies (alpha test, displacement, clipping, alpha to coverage) — still disposed, so its depth copy is released', /m\.alphaTest > 0 \|\| mm\.displacementMap \|\| m\.alphaToCoverage \|\| mm\.clipShadows\) m\.dispose\(\)/.test(kit));
const game = read('src/game/Game.ts');
check('the career\'s next rival is drawn at boot (behind the loading screen) and again on the results screen when it changes — once a session each, never a rig on stage', /this\.warmNextRival\(\);[\s\S]{0,700}?this\.portraits = renderPortraits/.test(game) /* (2.6.2: the effects warm-up sits between them) */ && /if \(this\.screen === 'results'\) this\.warmNextRival\(\);/.test(game) && /if \(rig\.root\.parent\) return;/.test(game) && /this\.warmedRivals\.has\(id\)/.test(game));
check('the loop keeps to the paced interval (Game.loop → tooEarly) and the settings say «ровные 30 кадров/с» while it is on', /if \(tooEarly\(\(now - this\.last\) \/ 1000, this\.renderer\.frameInterval\)\) \{\s*\n\s*this\.scheduleNext\(\);\s*\n\s*return;/.test(game) && game.includes("' · ровные 30 кадров/с'"));
const rnd = read('src/render/Renderer.ts');
check('only «Авто» decides (a quality chosen by hand turns pacing off); the fight itself is not touched (fixed step, SIM_VERSION a141348f2a0dea20)', /if \(this\.setting !== 'auto' \|\| document\.hidden\) return;/.test(rnd) && /this\.frameInterval = 0;/.test(rnd.slice(rnd.indexOf('setQualitySetting'), rnd.indexOf('setQualitySetting') + 400)) && SIM_VERSION === 'a141348f2a0dea20');

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\nperf255: FAILED (${failed} of ${checks.length})` : `\nperf255: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
