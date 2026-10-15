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

function applyHeight(): void {
  scheduled = 0;
  const h = Math.round(window.innerHeight);
  if (h > 0) document.documentElement.style.setProperty('--app-h', h + 'px');
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
