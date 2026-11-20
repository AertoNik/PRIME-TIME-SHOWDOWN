// Beta 2.5 — PERFORMANCE PROBE (dev only: imported from the page by the measuring scripts, never by the game, so it
// is not in the production bundle). It drives the game's OWN frame (Game.frame) and render with a fixed dt — the same
// scenes before and after a change — because the browser pane of these sessions is often hidden (no
// requestAnimationFrame), as in the Beta 2.1 / 2.3 measurements. Reported per scenario:
//   cpu      ms per frame (game update + render submission): p50 / p95 / p99 / max; «hitches» = finished frames over
//            16.7 ms (a dropped frame at 60 Hz). Without gl.finish a synchronous loop runs ahead of the GPU and the browser
//            stalls it every ~16 frames to drain its command buffer — not a game hitch, so `wall` is the main number
//   wall     the same with gl.finish() after the render (waits for the GPU) — a stand-in for GPU time, which Chrome does
//            not expose here (EXT_disjoint_timer_query_webgl2 is used when the browser offers it)
//   calls / triangles / programs / geometries / textures (renderer.info), JS heap MB before / after
//   spikes   the one-off costs: a screen change, the first build of a fighter's rig, a match start (ms, synchronous)
// Usage (page console / automation): const p = await import('/src/dev/perfProbe.ts'); await p.runAll(window.__game)
import type { WebGLRenderer } from 'three';

/* eslint-disable @typescript-eslint/no-explicit-any */
type G = any;

export interface Series {
  frames: number;
  cpu: { p50: number; p95: number; p99: number; max: number; mean: number };
  wall: { p50: number; p95: number; p99: number; max: number } | null;
  hitches: number;
  /** ms of the game update (Game.frame) and of the render alone: p50 / p99 / max */
  update: { p50: number; p99: number; max: number };
  render: { p50: number; p99: number; max: number };
  /** the frames over the hitch line: [frame index, update ms, render ms] (where the time went) */
  slow: [number, number, number][];
  calls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
  heapMB: [number, number];
  gpuMs: number | null;
}

const q = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3);
};
const heap = () => Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1048576);
const r3 = (n: number) => +n.toFixed(3);

/** `frames` frames of the current scene at `dt`, every one rendered (whatever the pane's visibility). */
export function measure(g: G, frames = 240, dt = 1 / 60, wall = true): Series {
  const R: WebGLRenderer = g.renderer.renderer;
  const gl = R.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const cpu: number[] = [];
  const wl: number[] = [];
  const up: number[] = [];
  const rd: number[] = [];
  // (the game draws in several passes; info would keep only the last one — count the whole frame)
  const autoReset = R.info.autoReset;
  R.info.autoReset = false;
  let calls = 0;
  let tris = 0;
  let t = performance.now() / 1000;
  const h0 = heap();
  const gpu: WebGLQuery[] = [];
  for (let i = 0; i < frames; i++) {
    t += dt;
    R.info.reset();
    const a = performance.now();
    // (a visible page renders inside Game.frame — that render is held back so every frame is drawn exactly once, below)
    const own = g.renderer.render;
    g.renderer.render = () => {};
    try {
      g.frame(dt, t);
    } finally {
      g.renderer.render = own;
    }
    const m = performance.now();
    const query = ext && i % 8 === 0 ? gl.createQuery() : null;
    if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    g.renderer.render(dt);
    if (query) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      gpu.push(query);
    }
    const b = performance.now();
    cpu.push(b - a);
    up.push(m - a);
    rd.push(b - m);
    if (wall) {
      gl.finish();
      wl.push(performance.now() - a);
    }
    calls += R.info.render.calls;
    tris += R.info.render.triangles;
  }
  R.info.autoReset = autoReset;
  let gpuMs: number | null = null;
  if (ext && gpu.length) {
    gl.finish();
    const ok = gpu.filter((x) => gl.getQueryParameter(x, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT));
    if (ok.length) gpuMs = r3(ok.reduce((sum: number, x) => sum + Number(gl.getQueryParameter(x, gl.QUERY_RESULT)) / 1e6, 0) / ok.length);
    gpu.forEach((x) => gl.deleteQuery(x));
  }
  const p50 = q(cpu, 0.5);
  return {
    frames,
    cpu: { p50, p95: q(cpu, 0.95), p99: q(cpu, 0.99), max: r3(Math.max(...cpu)), mean: r3(cpu.reduce((s, x) => s + x, 0) / cpu.length) },
    wall: wall ? { p50: q(wl, 0.5), p95: q(wl, 0.95), p99: q(wl, 0.99), max: r3(Math.max(...wl)) } : null,
    // (with wall: the finished frame — CPU + GPU — over 16.7 ms is a dropped frame at 60 Hz; without: CPU over the line)
    hitches: wall ? wl.filter((x) => x > 16.7).length : cpu.filter((x) => x > Math.max(8, 2 * p50)).length,
    update: { p50: q(up, 0.5), p99: q(up, 0.99), max: r3(Math.max(...up)) },
    render: { p50: q(rd, 0.5), p99: q(rd, 0.99), max: r3(Math.max(...rd)) },
    slow: cpu.map((x, i) => [i, r3(up[i]), r3(rd[i])] as [number, number, number]).filter((_, i) => cpu[i] > Math.max(8, 2 * p50)).slice(0, 40),
    calls: Math.round(calls / frames),
    triangles: Math.round(tris / frames),
    programs: R.info.programs?.length ?? 0,
    geometries: R.info.memory.geometries,
    textures: R.info.memory.textures,
    heapMB: [h0, heap()],
    gpuMs,
  };
}

/** One synchronous call, timed (a screen change, a rig build, a match start). */
export function spike(fn: () => void): number {
  const a = performance.now();
  fn();
  return r3(performance.now() - a);
}

/** The worst single frame right after something heavy (shader compiles land on the first render). */
export function firstFrames(g: G, n = 5, dt = 1 / 60): number[] {
  const out: number[] = [];
  let t = performance.now() / 1000;
  for (let i = 0; i < n; i++) {
    t += dt;
    out.push(spike(() => {
      const own = g.renderer.render;
      g.renderer.render = () => {};
      try {
        g.frame(dt, t);
      } finally {
        g.renderer.render = own;
      }
      g.renderer.render(dt);
      (g.renderer.renderer.getContext() as WebGL2RenderingContext).finish();
    }));
  }
  return out;
}

/** Steps the game until `ok()` (or `max` frames) without measuring — e.g. through a match intro. */
export function stepUntil(g: G, ok: () => boolean, max = 2000, dt = 1 / 60): number {
  let t = performance.now() / 1000;
  let i = 0;
  for (; i < max && !ok(); i++) {
    t += dt;
    g.frame(dt, t);
  }
  return i;
}
