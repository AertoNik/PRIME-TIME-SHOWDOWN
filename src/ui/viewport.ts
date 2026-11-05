// Viewport helpers for mobile browsers.
// - `--app-h` tracks the real visible height (address bar shown/hidden,
//   in-app browsers without dvh support), so the game never hides behind
//   browser chrome and never needs page scrolling.
// - Pinch-zoom gestures are blocked (iOS ignores user-scalable=no).
// - `isBlockedLandscape()` mirrors the CSS rule that shows the
//   "rotate your phone" / "make the window taller" overlay.

// Same condition as the .rotate-note rule in main.css.
const LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse), (max-height: 419px) and (pointer: fine)';

let scheduled = 0;

/** What the page knows about the window and the screen (CSS px). */
export interface ViewportFacts {
  innerW: number;
  innerH: number;
  screenW: number;
  screenH: number;
  /** iOS «Add to Home Screen» (navigator.standalone === true) — never true in Safari, Android or desktop. */
  iosStandalone: boolean;
}

/** The largest gap iOS leaves (the status bar / Dynamic Island area, 44–62 px) plus slack. */
const IOS_STANDALONE_GAP_MAX = 140;

/**
 * Alpha 1.9.4: the height the game fills. Everywhere it is the visible window (innerHeight). The one exception is an
 * iOS home-screen web app with the black-translucent status bar: iOS draws the page from the very top of the screen
 * (under the status bar) but reports a window shorter than the screen by the status bar's height — the game then
 * ended above the bottom edge and left an empty band under the bottom buttons. There the whole screen is used
 * (no browser chrome exists in that mode); the safe-area insets keep buttons clear of the notch and the home indicator.
 */
export function appHeightFor(v: ViewportFacts): number {
  const inner = Math.round(v.innerH);
  if (!v.iosStandalone || inner <= 0) return inner;
  // iOS keeps screen.width/height in portrait whatever the orientation
  const portrait = v.innerH >= v.innerW;
  const full = Math.round(portrait ? Math.max(v.screenW, v.screenH) : Math.min(v.screenW, v.screenH));
  const gap = full - inner;
  return gap > 0 && gap <= IOS_STANDALONE_GAP_MAX ? full : inner;
}

let lastH = 0;

function applyHeight(): void {
  scheduled = 0;
  const nav = navigator as Navigator & { standalone?: boolean };
  const h = appHeightFor({ innerW: window.innerWidth, innerH: window.innerHeight, screenW: window.screen?.width ?? 0, screenH: window.screen?.height ?? 0, iosStandalone: nav.standalone === true });
  if (h <= 0) return;
  document.documentElement.style.setProperty('--app-h', h + 'px');
  // the game's height moved apart from the window's (iOS home-screen app): the renderer measures its frame again on
  // the next frame (a second pass computes the same height and stops here — never a loop)
  if (lastH && h !== lastH) requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  lastH = h;
}

function scheduleHeight(): void {
  if (scheduled) return;
  scheduled = window.setTimeout(applyHeight, 0);
}

export function installViewport(): void {
  applyHeight();
  window.addEventListener('resize', scheduleHeight);
  window.visualViewport?.addEventListener('resize', scheduleHeight);
  window.addEventListener('pageshow', scheduleHeight);
  // iOS reports the old size for a moment after rotating: check again later.
  window.addEventListener('orientationchange', () => {
    scheduleHeight();
    window.setTimeout(applyHeight, 350);
  });
  // A page that never scrolls: undo any scroll the browser does on its own
  // (e.g. after the on-screen keyboard closes).
  window.addEventListener('scroll', () => {
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  });
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', stop);
  document.addEventListener('gesturechange', stop);
}

export function isBlockedLandscape(): boolean {
  return window.matchMedia?.(LANDSCAPE_QUERY).matches ?? false;
}

export function onLandscapeChange(cb: (blocked: boolean) => void): void {
  const mq = window.matchMedia?.(LANDSCAPE_QUERY);
  mq?.addEventListener?.('change', () => cb(mq.matches));
}
