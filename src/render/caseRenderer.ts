import { WebGLRenderer } from 'three';

// Beta 2.4 — ONE WebGL context for everything REWARD CASES draw: the pictures of the cases in the windows and the
// opening show. It is made on first use and kept for the life of the page — never thrown away and never lost on purpose.
// Browsers cap the contexts of a page (when there are too many, the oldest one — the game's own — is the one dropped),
// and a context lost on purpose (forceContextLoss) took the whole GPU process down in Chromium during the Beta 2.4
// checks, the game's context with it. Between uses the canvas is parked: out of the page, with a 1×1 drawing buffer.

let shared: WebGLRenderer | null = null;
let failedAt = 0;
let owner: object | null = null;
const RETRY_MS = 15000;

/** The cases' renderer, or null when this browser has no WebGL now (the windows show a drawn case, the show no 3D). */
export function caseRenderer(): WebGLRenderer | null {
  if (shared && shared.getContext().isContextLost()) {
    // the GPU dropped it (a reset) and did not give it back: let it go — the browser frees it; a new one next time
    shared.dispose();
    shared.domElement.remove();
    shared = null;
    owner = null;
  }
  if (shared) return shared;
  if (failedAt && performance.now() - failedAt < RETRY_MS) return null;
  try {
    // the SAME power preference as the game's renderer (render/Renderer.ts): on a two-GPU Mac Chromium put a 'default'
    // context on the integrated GPU while the game's ran on the discrete one — one page on two GPUs, every frame of the
    // show crossing between them. Beta 2.4 checks: «Intel UHD 630» vs «AMD Radeon Pro 560X»; now both on one. A phone
    // has one GPU — nothing changes there.
    shared = new WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, powerPreference: 'high-performance' });
    shared.setClearColor(0x000000, 0);
    failedAt = 0;
    park(shared);
  } catch {
    shared = null;
    failedAt = performance.now();
  }
  return shared;
}

/** The show takes the renderer for itself (its canvas goes into the show) until it gives it back. */
export function takeCaseRenderer(who: object): WebGLRenderer | null {
  const r = caseRenderer();
  if (r) owner = who;
  return r;
}

/** Given back: the canvas leaves the page and its drawing buffer shrinks to 1×1. */
export function releaseCaseRenderer(who: object): void {
  if (!shared || owner !== who) return;
  owner = null;
  park(shared);
}

/** Is a show using the renderer right now (a picture made meanwhile must give its size back)? */
export function caseRendererBusy(): boolean {
  return !!owner;
}

/** Park the renderer when nobody uses it (after a picture). */
export function parkCaseRenderer(): void {
  if (shared && !owner) park(shared);
}

function park(r: WebGLRenderer): void {
  const c = r.domElement;
  c.remove();
  c.removeAttribute('style');
  c.removeAttribute('class');
  r.setPixelRatio(1);
  r.setSize(1, 1, false);
}
