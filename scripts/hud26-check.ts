// Beta 2.6 — `npm run hud26`: the compact COMBAT NOTIFICATIONS (src/ui/screens/BattleHUD.ts + main.css). Visual only —
// the fight, its events, timings and SIM_VERSION are untouched. Measured in the game at 390×844 (BETA_2_6_DEVELOPMENT_REPORT
// §7): a banner now spans y 136–213 px, the fighters' heads were at 264 / 476 (the old strip began at 228, on a head).
import { SIM_VERSION } from '../src/league/simVersion';
import { fs, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const hud = fs.readFileSync('src/ui/screens/BattleHUD.ts', 'utf8') as string;
const css = fs.readFileSync('src/styles/main.css', 'utf8') as string;
const rule = (sel: string) => {
  const i = css.indexOf(sel + ' {');
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
};
const px = (block: string) => (block.match(/clamp\((\d+)px,\s*([\d.]+)cqw,\s*(\d+)px\)/) ?? []).slice(1).map(Number);

const t3 = px(rule('.banner .bt'));
const t2 = px(rule('.banner.t2 .bt'));
const t1 = px(rule('.banner.t1 .bt'));
const ko = px(rule('.big-center .txt.ko'));
check(`a minor banner is ≈ 18 % smaller (tier 1 max ${t1[2]} px, was 22; tier 2 max ${t2[2]} px, was 30), a big moment ≈ 10 % (max ${t3[2]} px, was 38)`, t1[2] === 18 && t2[2] === 25 && t3[2] === 34);
check(`K.O. keeps its size (max ${ko[2]} px) — the one big message of its moment`, ko[2] === 120);
check('the banner strip sits under the top bar, above the fighters\' heads (top 18 %, was 27 %)', /\.banner-zone \{[^}]*top: 18%/.test(css));
check('frequent minor banners are brief: tier 1 1.2 s, tier 2 1.45 s on screen (a big moment 1.7 s)', /\.banner\.t1 \{\s*animation-duration: 1\.2s;/.test(css) && /\.banner\.t2:not\(\.has-detail\) \{\s*animation-duration: 1\.45s;/.test(css) && /this\.bannerT = b\.tier >= 3 \? 1\.2 : b\.tier === 2 \? 0\.85 : 0\.65;/.test(hud));
check('one banner at a time (the strip is replaced, never stacked)', /this\.bannerZone\.innerHTML = '';\s*\n\s*this\.bannerZone\.appendChild\(e\);/.test(hud));
check('a repeat merges as «×N» into the banner on screen or the one waiting — never queued again', /now\.b\.count = \(now\.b\.count \?\? 1\) \+ 1;/.test(hud) && /waiting\.count = \(waiting\.count \?\? 1\) \+ 1;/.test(hud) && /class="bc">×/.test(hud));
check('priorities: a big moment cuts a minor banner short; at most two minor ones wait', /if \(this\.bannerTier < 3\) this\.bannerT = 0;/.test(hud) && /else if \(this\.bannerQueue\.length < 2\)/.test(hud));
check('K.O. is the only message of its moment: the strip and the queue are cleared, minor banners are dropped, «WHAT A FINISH!» becomes one line under K.O.', /this\.big\('K\.O\.!', 'fight ko'\);\s*\n\s*this\.onKo\(\);/.test(hud) && /if \(this\.koT > 0\) \{\s*\n\s*if \(b\.tier >= 3\) this\.koLine\(b\.text\);\s*\n\s*return;/.test(hud) && /\.big-center \.ko-line \{/.test(css));
check('callouts over a fighter: the same text merges («ПРОМАХ! ×2»), at most two per fighter, shorter (0.95 s)', /same\.el\.textContent = `\$\{text\} ×\$\{same\.sum\}`;/.test(hud) && /if \(mine\.length >= 2\)/.test(hud) && /'callout', f\.x, 2\.9, f\.z, 0\.95, 0\.6\)/.test(hud));
check('the fight is untouched: SIM_VERSION a141348f2a0dea20 (no file of the simulation changed for this)', SIM_VERSION === 'a141348f2a0dea20');

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\nhud26: FAILED (${failed} of ${checks.length})` : `\nhud26: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
