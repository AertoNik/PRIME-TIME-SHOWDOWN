// Beta 2.6.2 — `npm run cardperf`: COMBAT CARDS PERFORMANCE & UI POLISH, the guarantees in code.
//   1. the fight is untouched: SIM_VERSION a141348f2a0dea20, the server's fight file built from today's src/combat;
//   2. effects warmed ahead (Renderer.warmPrograms / warmProgramsAsync / warmStep): at boot behind the loading screen, at
//      each fight's set-up for its new objects, a fighter's hidden parts with the fighter (warmRig) — never mid-fight;
//   3. the automatic drop to a quality without bloom prepares its shaders over frames before switching (stepDown);
//   4. the battle hand: no forced layout in a tap, a frame, a combo, a rating pop (twin animations instead), each card's
//      combo hint once a frame, its pictures decoded ahead;
//   5. the hand's animations run on the compositor (transform / opacity only), the twins identical, the energy curtain
//      without a per-frame transition, the HOLO foil drifting by transform; reduced motion still honoured;
//   6. the measuring probe is dev-only (never in the game's bundle).
import { SIM_VERSION } from '../src/league/simVersion';
import { leagueSim, simVersionSource } from './backend';
import { ROOT } from './lib/backendKit';
import { fs, path, proc } from './lib/node';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
const section = (t: string) => console.log(`\n— ${t}`);
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** The body of a method / function `name(` in a TS source (from its opening brace to the matching one). */
function body(src: string, head: RegExp): string {
  const m = head.exec(src);
  if (!m) return '';
  let i = src.indexOf('{', m.index + m[0].length - 1);
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return '';
}
/** A CSS @keyframes block's body, whitespace-normalised. */
function keyframes(css: string, name: string): string | null {
  const at = css.indexOf(`@keyframes ${name} {`);
  if (at < 0) return null;
  let i = css.indexOf('{', at);
  const start = i;
  let depth = 0;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start + 1, i).replace(/\s+/g, ' ').trim();
  }
  return null;
}

const css = read('src/styles/main.css');
const hud = read('src/ui/screens/BattleHUD.ts');
const ren = read('src/render/Renderer.ts');
const game = read('src/game/Game.ts');
const bv = read('src/render/BattleView.ts');

section('Бой не тронут');
check(`SIM_VERSION is Beta 2.6.1's a141348f2a0dea20 and the server's fight file is built from today's code`, SIM_VERSION === 'a141348f2a0dea20' && read('backend/pb_hooks/lib/league_sim.js') === leagueSim().code && read('src/league/simVersion.ts') === simVersionSource());
check('the HUD only reads the match (comboHint is a query): no rule, timing or card value is written by the UI', !/m\.hands\[0\]\.(energy|lockout)\s*=|\.cooldown\s*=|cardLockout\s*=/.test(hud));
check('the 0.3 s card lockout and the 280 ms same-slot guard are kept as they were', /cardLockout: 0\.3,/.test(read('src/config/balance.ts')) && /if \(now - this\.lastPlayAt\[i\] < 280\) return;/.test(hud));

section('Эффекты прогреты заранее');
check('Renderer.warmPrograms compiles for the frame\'s own target (the bloom buffer, else the screen) and uploads textures', /warmPrograms\(\): \{/.test(ren) && /this\.composer \? this\.composer\.readBuffer : null/.test(ren) && /gl\.initTexture\(/.test(ren));
check('only what was not warmed yet: a later fight looks up a few objects (or none)', /if \(!fresh\.length\) return \{ programs: 0/.test(ren) && /private warmed = new WeakSet<Material>\(\)/.test(ren));
check('hidden objects get their one draw (the driver\'s setup on first draw), off-view ones not culled for it, all restored', /if \(shown\.length\) gl\.render\(this\.scene, this\.camera\);/.test(ren) && /for \(const o of shown\) o\.visible = false;/.test(ren) && /for \(const o of culled\) o\.frustumCulled = true;/.test(ren));
check('a draw into the screen (no bloom) is covered by the true frame at once', /if \(!target && shown\.length\) \{\s*try \{\s*this\.render\(0\);/.test(ren));
check('boot: stepped behind the loading screen (two new programs a step, finished in that step, then the draws)', /this\.bootWarm = await this\.renderer\.warmProgramsAsync\(nextFrame\);/.test(game) && /\(gl\.info\.programs\?\.length \?\? 0\) - p0 < 2/.test(ren) && /ctx\.getProgramParameter\(progs\[k\]\.program, ctx\.LINK_STATUS\)/.test(ren));
check('a hidden page runs the boot steps back-to-back (its timers run once a second)', /if \(!document\.hidden\) await next\(\);/.test(ren));
check('each fight\'s set-up warms its new objects (behind the VS intro)', /this\.lastWarm = this\.r\.warmPrograms\(\);/.test(bv));
check('a fighter warmed at boot (Game.warmRig) draws its hidden parts too and is marked warmed', /if \(o !== root && !o\.visible\) \{\s*o\.visible = true;\s*shown\.push\(o\);/.test(game) && /r\.markWarmed\(root\);/.test(game) && /for \(const o of shown\) o\.visible = false;/.test(game));

section('Автопонижение качества без заморозки');
const mon = body(ren, /monitor\(dtReal: number, now: number\): void /);
check('the monitor\'s «down» goes through stepDown (not straight to applyQuality)', /this\.stepDown\(this\.quality === 'high' \? 'medium' : 'low'\);/.test(mon) && !/this\.applyQuality\(/.test(mon));
check('a drop that keeps bloom switches at once; one that removes it prepares first (programs, then draws, new shadows)', /if \(PROFILES\[q\]\.bloom === !!this\.composer\) \{\s*this\.applyQuality\(q\);/.test(ren) && /drawAll: true/.test(ren) && /gl\.shadowMap\.enabled = d\.shadows;/.test(ren));
check('the preparation runs a step before each frame; the last step switches and marks everything drawn', /if \(this\.downTo\) this\.prepareDown\(\);/.test(ren) && /this\.applyQuality\(d\.q\);\s*\/\/[^\n]*\n\s*this\.warmed = new WeakSet<Material>\(\);\s*this\.markWarmed\(this\.scene\);/.test(ren));
check('the draws of a step are on a layer of their own, the lights on it too, the camera\'s layers restored', /const LAYER = 31;/.test(ren) && /this\.camera\.layers\.set\(LAYER\);/.test(ren) && /this\.camera\.layers\.mask = camMask;/.test(ren) && /for \(const l of lights\) l\.layers\.disable\(LAYER\);/.test(ren));
check('the player\'s own quality choice cancels a drop being prepared', /setQualitySetting\(s: QualitySetting\): void \{[\s\S]{0,160}this\.downTo = null;/.test(ren));

section('Рука: без принудительной раскладки');
const tap = body(hud, /tapCard\(i: number\): void /);
const upd = body(hud, /\n {2}update\(dt: number\): void /);
const deny = body(hud, /private flashEnergyNeed\(cost: number\): void /);
const pop = body(hud, /private ratingPop\(amount: number, label: string\): void /);
check('a tap (played or refused) reads no layout', tap.length > 100 && !/offset(Width|Height|Top|Left)|getBoundingClientRect/.test(tap));
check('a frame of the hand reads no layout (the ready pulse restarts through its twin)', upd.length > 500 && !/offset(Width|Height)|getBoundingClientRect/.test(upd) && /if \(can && !this\.affordable\[i\]\) restart\(cardEl, 'ready'\);/.test(upd));
check('the energy «not enough» shake, a merged rating pop and a combo\'s edge glow read no layout', !/offsetWidth/.test(deny) && /restart\(this\.energyBar, 'deny'\)/.test(deny) && !/offsetWidth/.test(pop) && /same\.el\.classList\.toggle\('again-b'\)/.test(pop) && /restart\(this\.edgeGlow, 'on'\);/.test(hud) && !/edgeGlow\.offsetWidth/.test(hud));
check('restart(): the class and its twin take turns (a new animation name starts it over)', /function restart\(el: HTMLElement, cls: string\): void \{\s*const twin = cls \+ '-b';/.test(hud));
check('each card\'s combo hint is asked once a frame (an array reused every frame)', (upd.match(/m\.comboHint\(/g) ?? []).length === 1 && /private comboHints: /.test(hud));
check('the flying copy of a played card replays none of the one-shot animations', /ghost\.classList\.remove\('enter', 'combo-ready', 'disabled', 'ready', 'ready-b', 'shake', 'shake-b'\);/.test(tap));
check('the deck\'s pictures are decoded ahead and kept (the newest 12)', /void img\.decode\?\.\(\)\.catch\(\(\) => undefined\);/.test(read('src/ui/cardArt.ts')) && /if \(kept\.length > KEEP\) kept\.shift\(\);/.test(read('src/ui/cardArt.ts')));

section('Анимации руки — на компоновщике');
for (const [a, b] of [
  ['readyPulse', 'readyPulseB'],
  ['shake', 'shakeB'],
  ['cardSweep', 'cardSweepB'],
  ['edgePulse', 'edgePulseB'],
  ['ratingPop', 'ratingPopB'],
]) {
  const ka = keyframes(css, a);
  const kb = keyframes(css, b);
  check(`twin @keyframes ${b} is exactly ${a}`, !!ka && ka === kb, `${ka?.slice(0, 60)} | ${kb?.slice(0, 60)}`);
}
check('the light sweep moves by transform (left only as its fixed start), never by left', !/left:/.test(keyframes(css, 'cardSweep') ?? 'left:') && /translateX\(444\.44%\) skewX\(-18deg\)/.test(keyframes(css, 'cardSweep') ?? ''));
check('the combo glow pulses by opacity (a prepared ring fading in and out), not box-shadow', keyframes(css, 'pcComboGlow') === 'to { opacity: 1; }' && /\.hand-card\.pc\.combo-ready \.pc-sh::after \{[^}]*animation: pcComboGlow/.test(css));
check('reduced motion and «motion off» still stop it (the bright ring hidden)', /:root\[data-motion='off'\] \.hand-card\.pc\.combo-ready \.pc-sh::after \{\s*display: none;/.test(css) && /@media \(prefers-reduced-motion: reduce\) \{\s*\.hand-card\.pc\.combo-ready,\s*\.hand-card\.pc\.combo-ready \.pc-sh \{\s*animation: none;\s*\}\s*\.hand-card\.pc\.combo-ready \.pc-sh::after \{\s*display: none;/.test(css));
check('the HOLO foil drifts by transform on a 240 % layer, not background-position', keyframes(css, 'pcHoloDrift') === 'to { transform: translateX(-58.333%); }' && /\.holo-set \.card\.pc \.art::before \{[^}]*width: 240%;/.test(css));
check('the energy curtain has no transition (it is written every frame)', /\.hand-card \.drain \{[^}]*\}/.test(css) && !/\.hand-card \.drain \{[^}]*transition:/.test(css));
const handAnims = ['readyPulse', 'readyPulseB', 'shake', 'shakeB', 'cardSweep', 'cardSweepB', 'pcComboLift', 'pcComboGlow', 'enterCard', 'playCard', 'edgePulse', 'edgePulseB', 'pcHoloDrift'];
const bad = handAnims.filter((n) => /box-shadow|filter|left:|top:|width:|height:|background/.test(keyframes(css, n) ?? ''));
check(`every animation of the hand, its glow and the edge pulse animates only transform / opacity (${handAnims.length})`, bad.length === 0 && handAnims.every((n) => keyframes(css, n) !== null), bad.join(', '));

section('Пробник — только для разработки');
const srcFiles = (dir: string): string[] => (fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }) as { name: string; isDirectory(): boolean }[]).flatMap((d) => (d.isDirectory() ? srcFiles(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []));
check('src/dev/cardProbe.ts is imported by nothing in the game (the page imports it by hand) — not in the bundle', srcFiles('src').filter((f) => !f.startsWith('src/dev/') && /cardProbe/.test(read(f))).length === 0);
check('the A/B switch ?nofxwarm works only in development builds', (bv.match(/import\.meta\.env\.DEV && new URLSearchParams\(location\.search\)\.has\('nofxwarm'\)/g) ?? []).length === 1 && (game.match(/import\.meta\.env\.DEV && new URLSearchParams\(location\.search\)\.has\('nofxwarm'\)/g) ?? []).length === 1);

console.log(failed ? `\ncardperf: FAILED (${passed} passed, ${failed} failed)` : `\ncardperf: OK (${passed} passed, 0 failed)`);
proc.exit(failed ? 1 : 0);
