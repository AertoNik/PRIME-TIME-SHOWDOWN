// Beta 2.7 — LONG SESSION PROBE (dev only: imported from the page by the measuring automation, never by the game, so
// it is not in the production bundle). A long run of the game's OWN loop with a real sequence of play: classic fights
// with different fighters, rivals and studio sets, the player's cards tapped through the HUD (the real tap path), the
// results screen, the menu, the prep screen, the next fight — frame after frame at a fixed 1/60 s, every frame rendered
// and finished on the GPU (gl.finish), so the numbers do not depend on whether the browser pane is visible.
//
// Recorded per fight: frame cost p50 / p95 / p99 / max (CPU + GPU of this computer), frames over 16.7 / 33 ms, the tap
// handler's time, JS heap, renderer.info (geometries, textures, programs, calls), DOM nodes, objects in the scene, the
// effect pools. The point is the TREND from the first fight to the last (growth = a leak or a slowdown), not the
// absolute speed of this Mac. The game's rAF loop is held while the probe drives the frames.
//
// Usage: const s = await import('/src/dev/soakProbe.ts'); s.start(window.__game, { fights: 18 }); … s.state()

/* eslint-disable @typescript-eslint/no-explicit-any */
type G = any;

export interface FightSample {
  i: number;
  fighter: string;
  rival: string;
  arena: string;
  quality: string;
  frames: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  over16: number;
  over33: number;
  tapP50: number;
  tapMax: number;
  heapMB: number;
  geometries: number;
  textures: number;
  programs: number;
  calls: number;
  dom: number;
  sceneObjects: number;
  /** wall-clock seconds the probe has been running */
  at: number;
  /** where the slow frames' time went: summed ms of the game update, the render submission, the GPU wait (gl.finish) */
  slowSplit: [number, number, number];
  /** GPU time per frame from the timer query (ms, when the browser offers EXT_disjoint_timer_query_webgl2) */
  gpuMs: number | null;
  /** JS heap sampled every 120 frames during this fight: the lowest (≈ what is really kept after a collection) and the highest */
  heapMin: number;
  heapMax: number;
  /** distinct materials in the scene after the fight */
  materials: number;
  /** live memory after a collection (performance.measureUserAgentSpecificMemory, MB) — only on a cross-origin
   *  isolated page (the probe's own server sends COOP/COEP); null elsewhere */
  liveMB: number | null;
}

/** GPU ms per frame and the frames of one screen standing still (menus, rooms): the 30 fps question. */
export interface IdleSample {
  screen: string;
  quality: string;
  gpuMs: number | null;
  cpuP50: number;
}

interface Run {
  running: boolean;
  done: boolean;
  error: string | null;
  samples: FightSample[];
  idle: IdleSample[];
  /** the heap after the run and 15 s of quiet (the browser collects meanwhile) */
  heapAfter: number[];
  spikes: { what: string; ms: number }[];
  startedAt: number;
  frames: number;
}

const run: Run = { running: false, done: false, error: null, samples: [], idle: [], heapAfter: [], spikes: [], startedAt: 0, frames: 0 };
export function state(): Run {
  return run;
}

const q = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
};
const heap = () => Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1048576);
const yieldNow = () =>
  new Promise<void>((r) => {
    const c = new MessageChannel();
    c.port1.onmessage = () => r();
    c.port2.postMessage(0);
  });

function countScene(g: G): number {
  let n = 0;
  g.renderer.scene.traverse(() => n++);
  return n;
}
function countMaterials(g: G): number {
  const set = new Set<unknown>();
  g.renderer.scene.traverse((o: any) => {
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => set.add(x));
    else if (m) set.add(m);
  });
  return set.size;
}

const FIGHTERS = ['ray', 'bruno', 'nika', 'vega', 'kai', 'rina', 'ace', 'lucien', 'crax'];
const RIVALS = ['dex', 'zoe', 'tank', 'crash', 'nova', 'blaze'];
const ARENAS = ['original', 'newsroom', 'backlot', 'casino', 'graveyard', 'haunted', 'holiday'];

export async function start(g: G, o: { fights?: number; qualities?: string[]; idleQualities?: string[]; fighters?: string[]; arenas?: string[]; short?: number } = {}): Promise<void> {
  if (run.running) return;
  Object.assign(run, { running: true, done: false, error: null, samples: [], idle: [], heapAfter: [], spikes: [], startedAt: performance.now(), frames: 0 });
  const R = g.renderer.renderer;
  const gl = R.getContext();
  // the probe drives the frames: the game's own loop is held (restored at the end)
  const loop = g.loop;
  g.loop = () => {};
  let t = performance.now() / 1000;
  const dt = 1 / 60;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  let split: [number, number, number] = [0, 0, 0];
  let gpuQ: WebGLQuery[] = [];
  const frame = (cost: number[] | null) => {
    t += dt;
    const a = performance.now();
    const own = g.renderer.render;
    g.renderer.render = () => {};
    try {
      g.frame(dt, t);
    } finally {
      g.renderer.render = own;
    }
    const b = performance.now();
    const query = ext && run.frames % 10 === 0 ? gl.createQuery() : null;
    if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    g.renderer.render(dt);
    if (query) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      gpuQ.push(query);
    }
    const c = performance.now();
    gl.finish();
    const d = performance.now();
    run.frames++;
    if (cost) {
      cost.push(d - a);
      if (d - a > 33.4) split = [split[0] + (b - a), split[1] + (c - b), split[2] + (d - c)];
    }
  };
  const gpuRead = (): number | null => {
    if (!ext || !gpuQ.length) return null;
    const ok = gpuQ.filter((x) => gl.getQueryParameter(x, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT));
    const v = ok.length ? ok.reduce((sum: number, x: WebGLQuery) => sum + Number(gl.getQueryParameter(x, gl.QUERY_RESULT)) / 1e6, 0) / ok.length : null;
    gpuQ.forEach((x) => gl.deleteQuery(x));
    gpuQ = [];
    return v === null ? null : +v.toFixed(2);
  };
  let heaps: number[] = [];
  const frames = async (n: number, cost: number[] | null) => {
    for (let i = 0; i < n; i++) {
      frame(cost);
      if (run.frames % 120 === 0) heaps.push(heap());
      if (i % 30 === 29) await yieldNow();
    }
  };
  const timed = (what: string, fn: () => void) => {
    const a = performance.now();
    fn();
    run.spikes.push({ what, ms: +(performance.now() - a).toFixed(1) });
  };
  try {
    const fights = o.fights ?? 18;
    const qualities = o.qualities ?? ['high'];
    const valid = (l: string[], set: Record<string, unknown>) => l.filter((x) => x in set);
    const F = await import('../config/fighters');
    const fighters = valid(o.fighters ?? FIGHTERS, F.FIGHTERS);
    const rivals = valid(RIVALS, F.RIVALS);
    const arenas = valid(o.arenas ?? ARENAS, (await import('../config/arenas.config')).ARENAS);
    for (let i = 0; i < fights; i++) {
      const quality = qualities[i % qualities.length];
      if (g.renderer.setting !== quality) g.setQuality(quality);
      const fighter = fighters[i % fighters.length];
      const rival = rivals[i % rivals.length];
      const arena = arenas[i % arenas.length];
      g.setArenaPref(arena);
      const s = g.save.data;
      timed(`launch ${fighter} @ ${arena}`, () =>
        g.launch({ fighter, deck: s.fighters[fighter]?.deck?.slice() ?? ['dash', 'power_shot', 'shield', 'smoke'], rival, difficulty: 'pro', ...(o.short ? { mods: { duration: o.short } } : {}) }, { kind: 'classic' }),
      );
      const cost: number[] = [];
      const taps: number[] = [];
      // the fight: a tap through the HUD now and then (the real handler), until the fight is over
      let guard = 0;
      while (g.match && g.match.phase !== 'over' && guard < 6400) {
        frame(cost);
        guard++;
        if (guard % 40 === 0 && g.match.phase === 'fight') {
          const a = performance.now();
          g.hud.tapCard(Math.floor(Math.random() * 3));
          taps.push(performance.now() - a);
        }
        if (run.frames % 120 === 0) heaps.push(heap());
        if (guard % 30 === 0) await yieldNow();
      }
      // the results screen, the menu, the prep screen (screen changes and their first frames)
      await frames(240, cost);
      timed('goto menu', () => g.goto('menu'));
      await frames(120, cost);
      timed('goto prep', () => g.goto('prep'));
      await frames(60, cost);
      // the LIVE DUELS screen (entered and left again every fight)
      timed('goto live', () => g.goto('live'));
      await frames(60, cost);
      const info = R.info;
      run.samples.push({
        i,
        fighter,
        rival,
        arena,
        quality,
        frames: cost.length,
        p50: q(cost, 0.5),
        p95: q(cost, 0.95),
        p99: q(cost, 0.99),
        max: +Math.max(...cost).toFixed(1),
        over16: cost.filter((x) => x > 16.7).length,
        over33: cost.filter((x) => x > 33.4).length,
        tapP50: q(taps, 0.5),
        tapMax: +(taps.length ? Math.max(...taps) : 0).toFixed(2),
        heapMB: heap(),
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
        calls: info.render.calls,
        dom: document.getElementsByTagName('*').length,
        sceneObjects: countScene(g),
        at: Math.round((performance.now() - run.startedAt) / 1000),
        slowSplit: split.map((x) => Math.round(x)) as [number, number, number],
        gpuMs: gpuRead(),
        heapMin: heaps.length ? Math.min(...heaps) : heap(),
        heapMax: heaps.length ? Math.max(...heaps) : heap(),
        materials: countMaterials(g),
        liveMB: null,
      });
      const mem = (performance as any).measureUserAgentSpecificMemory;
      if ((globalThis as any).crossOriginIsolated && mem) {
        try {
          const r = await mem.call(performance);
          run.samples[run.samples.length - 1].liveMB = Math.round(r.bytes / 1048576);
        } catch {
          /* not offered here */
        }
      }
      split = [0, 0, 0];
      heaps = [];
    }
    timed('goto menu (end)', () => g.goto('menu'));
    // screens standing still: GPU per frame (menus with the studio, screens that dim it)
    for (const quality of o.idleQualities ?? ['high']) {
      if (g.renderer.setting !== quality) g.setQuality(quality);
      for (const screen of ['menu', 'live', 'modes', 'league', 'collection']) {
        g.goto(screen);
        await frames(90, null);
        gpuRead();
        const cost: number[] = [];
        await frames(300, cost);
        run.idle.push({ screen, quality, gpuMs: gpuRead(), cpuP50: q(cost, 0.5) });
      }
    }
    g.goto('menu');
  } catch (e) {
    run.error = String((e as Error)?.stack ?? e).slice(0, 600);
  } finally {
    // (the game's loop is an instance arrow function: put the very same one back and start its schedule again)
    g.loop = loop;
    g.last = performance.now();
    g.scheduleNext?.();
    run.running = false;
    // the heap after a quiet while (no frames driven by the probe; the browser collects the garbage of the run)
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      run.heapAfter.push(heap());
    }
    run.done = true;
  }
}
