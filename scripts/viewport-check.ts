// Alpha 1.9.4 — `npm run viewport`: the height the game fills (src/ui/viewport.ts appHeightFor), pure checks.
// An iOS home-screen web app (navigator.standalone) with the black-translucent status bar reports a window shorter
// than the screen by the status bar; Safari, Android, desktop and in-app browsers keep the visible window.
import { appHeightFor } from '../src/ui/viewport';

let ok = true;
const check = (name: string, pass: boolean) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
};
const f = (innerW: number, innerH: number, screenW: number, screenH: number, iosStandalone: boolean) => appHeightFor({ innerW, innerH, screenW, screenH, iosStandalone });

check('iPhone 15 Pro home-screen app: window 393×798 on a 393×852 screen → the whole 852 (no band under the buttons)', f(393, 798, 393, 852, true) === 852);
check('iPhone SE home-screen app: 375×647 on 375×667 → 667', f(375, 647, 375, 667, true) === 667);
check('iPhone home-screen app that already reports the full screen → unchanged', f(393, 852, 393, 852, true) === 852);
check('iPhone Safari (not standalone): the visible window — the address bar is never covered', f(393, 659, 393, 852, false) === 659);
check('iPhone home-screen app in landscape: the screen\'s short side (iOS keeps screen in portrait)', f(852, 370, 393, 852, true) === 393);
check('a gap larger than any status bar (a split view, a keyboard) → the window as reported', f(393, 500, 393, 852, true) === 500);
check('Android PWA / Chrome and desktop (no navigator.standalone) → innerHeight, as before', f(412, 860, 412, 915, false) === 860 && f(1366, 768, 1366, 768, false) === 768);
check('a fractional window height is rounded like before', f(390, 843.6, 390, 844, false) === 844);
console.log(ok ? 'viewport: OK' : 'viewport: FAILED');
const proc = (globalThis as { process?: { exitCode?: number } }).process;
if (!ok && proc) proc.exitCode = 1;
