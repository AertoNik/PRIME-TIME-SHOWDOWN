// Beta 2.3 — CHARACTER LAB (dev builds only: `npm run dev`, then /?charlab). Every fighter and skin, whole body or a
// close-up, frozen at an exact moment of any state, from any side — in the game's own light, tone mapping and outline —
// to compare models, stances and animation frames before and after a change in the same pose, light and scale. Never
// part of the published build (imported only under import.meta.env.DEV).
//
//   /?charlab&state=lobby&t=2&view=front&elev=8&focus=body&looks=ray,ray_neon_runner&cols=7&zoom=1
//   state: lobby | idle | walk | run | strafe | back | turn | stop | dash | hit | stun | fire | victory | ko | defeat | draw
//   view:  front | q | side | back | q2 (three-quarter from behind)   elev: camera elevation, degrees (battle ≈ 50)
//   focus: body | head | upper | legs
import { ACESFilmicToneMapping, Color, DirectionalLight, HemisphereLight, NeutralToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { defaultInput, type AnimInput } from '../render/FighterAnimator';
import { ModelCache, type CachedFighter } from '../render/ModelCache';

export const LAB_LOOKS = ['ray', 'bruno', 'nika', 'vega', 'kai', 'rina', 'ace', 'lucien', 'crax', 'dex', 'tank', 'zoe', 'crash', 'vale', 'bot', 'ray_neon_runner', 'bruno_casino_boss', 'nika_stage_idol', 'vega_star_pilot', 'kai_cue_master', 'rina_dune_mirage'];

interface LabParams {
  state: string;
  t: number;
  view: string;
  elev: number;
  focus: string;
  looks: string[];
  cols: number;
  zoom: number;
  variant: number;
}

function params(over: Partial<LabParams> = {}): LabParams {
  const q = new URLSearchParams(location.search);
  return {
    state: q.get('state') ?? 'lobby',
    t: Number(q.get('t') ?? 2),
    view: q.get('view') ?? 'front',
    elev: Number(q.get('elev') ?? 8),
    focus: q.get('focus') ?? 'body',
    looks: (q.get('looks') ?? LAB_LOOKS.join(',')).split(',').filter(Boolean),
    cols: Number(q.get('cols') ?? 7),
    zoom: Number(q.get('zoom') ?? 1),
    variant: Number(q.get('variant') ?? -1),
    ...over,
  };
}

/** A seeded Math.random for the lab: the same frame on every load (the animator draws its idle timers from it). */
let labSeed = 1;
export function seedLab(n: number): void {
  labSeed = n >>> 0 || 1;
  Math.random = () => {
    labSeed = (labSeed * 1664525 + 1013904223) >>> 0;
    return labSeed / 4294967296;
  };
}

/** Plays `state` on a fresh animator up to `until` seconds (fixed 1/120 s steps: the same frame every time). */
export function labPlay(c: CachedFighter, state: string, until: number, variant = -1): AnimInput {
  const a = c.anim as unknown as Record<string, (...x: unknown[]) => void>;
  seedLab(0x51ed + c.rig.look.id.length * 7919);
  // (the animator's own clock starts at a random moment — pin it, so two loads show the same frame)
  (c.anim as unknown as { t: number }).t = 3.7;
  c.anim.reset(0);
  const inp = defaultInput();
  inp.combat = state !== 'lobby';
  const dt = 1 / 120;
  let t = 0;
  let fired = false;
  // the end-of-fight states begin after a second of fighting stance
  const END = 1;
  while (t < until) {
    const s = state;
    inp.vx = s === 'walk' ? 1.6 : s === 'run' || (s === 'stop' && t < until - 0.6) ? 4.5 : 0;
    inp.vz = s === 'strafe' ? 4 : s === 'back' ? -3.4 : 0;
    if (s === 'run' || s === 'walk' || s === 'stop') inp.facing = Math.PI / 2;
    else if (s === 'turn') inp.facing = t * 2.2;
    else inp.facing = 0;
    inp.stunned = s === 'stun' && t > 0.5;
    if (!fired && s === 'dash' && t >= until - 0.14) (c.anim.dash(0, 1), (fired = true));
    if (!fired && s === 'hit' && t >= until - 0.12) (c.anim.hit(0.6, -0.8, true), (fired = true));
    if (s === 'fire' && Math.floor(t / 0.4) !== Math.floor((t + dt) / 0.4)) c.anim.fire(0, false);
    if (!fired && t >= END) {
      if (s === 'victory') {
        inp.combat = false;
        inp.victory = true;
        if (variant >= 0) c.anim.victory(variant);
        else c.anim.victory();
        fired = true;
      } else if (s === 'ko') {
        inp.ko = true;
        c.anim.ko();
        fired = true;
      } else if (s === 'defeat' || s === 'draw') {
        // Beta 2.3: the reaction of a fighter who lost on his feet (or drew) — absent in Beta 2.2 (he keeps the stance)
        if (typeof a.defeat === 'function') a.defeat(s === 'draw' ? 'draw' : 'loss', variant);
        fired = true;
      }
    }
    inp.x += inp.vx * dt;
    inp.z += inp.vz * dt;
    c.anim.update(dt, inp);
    t += dt;
  }
  return inp;
}

export function runCharLab(host: HTMLElement): void {
  seedLab(0x2b21);
  document.body.style.background = '#14162a';
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setScissorTest(true);
  // the game's own output (Renderer.ts): sRGB, neutral tone mapping, exposure 1.05
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping ?? ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.innerHTML = '';
  host.style.display = 'none';
  document.getElementById('ui')?.style.setProperty('display', 'none');
  renderer.domElement.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:1';
  document.body.appendChild(renderer.domElement);
  const labels = document.createElement('div');
  labels.style.cssText = 'position:fixed;inset:0;z-index:2;pointer-events:none;font:600 11px system-ui;color:#fff;text-shadow:0 1px 2px #000';
  document.body.appendChild(labels);
  const scene = new Scene();
  scene.background = new Color(0x1c2038);
  // the game's lights (Renderer.ts), turned with the camera so every view is lit like the game's front view
  const lights = new Scene();
  const hemi = new HemisphereLight(0x9fb6ff, 0x3a1f4a, 1.35);
  const key = new DirectionalLight(0xfff2e0, 2.4);
  key.position.set(-6, 16, 9);
  const rim = new DirectionalLight(0x6fe8ff, 1.5);
  rim.position.set(4, 8, -12);
  const fillA = new DirectionalLight(0x22d8ff, 0.85);
  fillA.position.set(-10, 5, 3);
  const fillB = new DirectionalLight(0xff6a2a, 0.85);
  fillB.position.set(10, 5, -4);
  void lights;
  scene.add(hemi, key, key.target, rim, rim.target, fillA, fillA.target, fillB, fillB.target);
  const cache = new ModelCache();
  const LIGHTS: [DirectionalLight, Vector3][] = [
    [key, new Vector3(-6, 16, 9)],
    [rim, new Vector3(4, 8, -12)],
    [fillA, new Vector3(-10, 5, 3)],
    [fillB, new Vector3(10, 5, -4)],
  ];
  const UP = new Vector3(0, 1, 0);

  const draw = (p: LabParams) => {
    const W = innerWidth;
    const H = innerHeight;
    renderer.setSize(W, H);
    renderer.setScissor(0, 0, W, H);
    renderer.setViewport(0, 0, W, H);
    renderer.clear();
    const rows = Math.max(Number(new URLSearchParams(location.search).get('rows') ?? 0), Math.ceil(p.looks.length / p.cols));
    const cw = W / p.cols;
    const ch = H / rows;
    labels.innerHTML = '';
    p.looks.forEach((look, i) => {
      const c = cache.get(look);
      for (const o of scene.children.filter((x) => x.name.startsWith('fighter-'))) scene.remove(o);
      scene.add(c.rig.root);
      labPlay(c, p.state, p.t, p.variant);
      const root = c.rig.root;
      root.updateMatrixWorld(true);
      const sc = root.scale.y || 1;
      // what the picture frames: the whole body (≈ 2.35 m of picture), the head, the upper body or the legs
      const base = new Vector3(root.position.x, 0, root.position.z);
      const span = (p.focus === 'head' ? 1.05 : p.focus === 'upper' ? 1.5 : p.focus === 'legs' ? 1.15 : 2.35) * sc * p.zoom;
      const mid = (p.focus === 'head' ? 1.42 : p.focus === 'upper' ? 1.18 : p.focus === 'legs' ? 0.42 : 0.98) * sc;
      const at = base.clone().add(new Vector3(0, mid, 0));
      const yawOff = p.view === 'side' ? Math.PI / 2 : p.view === 'back' ? Math.PI : p.view === 'q' ? Math.PI / 4 : p.view === 'q2' ? (Math.PI * 3) / 4 : 0;
      // (the camera turns around the fighter's own facing — a running fighter is still seen from the chosen side)
      const yaw = root.rotation.y + yawOff;
      const el = (p.elev * Math.PI) / 180;
      const cam = new PerspectiveCamera(26, cw / ch, 0.05, 80);
      // (the picture's HEIGHT is `span` metres whatever the cell's shape — the «before» sheets were taken this way, so a
      // sheet of 7 × 3 on the same window always shows the same scale; use &rows= for a few looks on a full grid)
      const dist = span / (2 * Math.tan((26 * Math.PI) / 360));
      cam.position.set(at.x + Math.sin(yaw) * Math.cos(el) * dist, at.y + Math.sin(el) * dist, at.z + Math.cos(yaw) * Math.cos(el) * dist);
      cam.lookAt(at);
      for (const [l, pos] of LIGHTS) {
        l.position.copy(pos).applyAxisAngle(UP, yaw).add(base);
        l.target.position.copy(base);
        l.target.updateMatrixWorld();
      }
      const x = (i % p.cols) * cw;
      const y = H - (Math.floor(i / p.cols) + 1) * ch;
      renderer.setViewport(x, y, cw, ch);
      renderer.setScissor(x, y, cw, ch);
      renderer.render(scene, cam);
      const l = document.createElement('div');
      l.textContent = look;
      l.style.cssText = `position:absolute;left:${x + 6}px;top:${H - y - ch + 4}px`;
      labels.appendChild(l);
    });
    const tag = document.createElement('div');
    tag.textContent = `${p.state}${p.variant >= 0 ? ' #' + p.variant : ''} · t=${p.t}s · ${p.view} · elev ${p.elev}° · ${p.focus}`;
    tag.style.cssText = 'position:absolute;right:8px;bottom:6px;font-size:13px;background:#000a;padding:3px 8px;border-radius:6px';
    labels.appendChild(tag);
    const info = renderer.info;
    (window as unknown as { __charlabInfo: unknown }).__charlabInfo = { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 };
  };
  draw(params());
  const w = window as unknown as Record<string, unknown>;
  w.__charlab = (o: Partial<LabParams>) => draw(params(o));
  /**
   * Saves the current sheet (the picture with its labels drawn in) through the local dev saver (a tiny script outside
   * the project, 127.0.0.1:5188 → docs/beta23/<name>). Only for the reports' before / after pictures.
   */
  const save = async (name: string): Promise<string> => {
    const src = renderer.domElement;
    const cv = document.createElement('canvas');
    cv.width = src.width;
    cv.height = src.height;
    const g = cv.getContext('2d')!;
    g.drawImage(src, 0, 0);
    const k = src.width / innerWidth;
    g.font = `600 ${Math.round(11 * k)}px system-ui`;
    g.fillStyle = '#fff';
    g.shadowColor = '#000';
    g.shadowBlur = 3 * k;
    for (const el of Array.from(labels.children) as HTMLElement[]) {
      const r = el.getBoundingClientRect();
      g.fillText(el.textContent ?? '', r.left * k, (r.top + 11) * k);
    }
    const blob: Blob = await new Promise((ok) => cv.toBlob((b) => ok(b!), 'image/jpeg', 0.9));
    const res = await fetch(`http://127.0.0.1:5188/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
    return `${name}: ${res.status} ${blob.size}`;
  };
  w.__charlabSave = save;
  /** Renders and saves several sheets: [[name, params], …]. */
  w.__charlabBatch = async (list: [string, Partial<LabParams>][]): Promise<string[]> => {
    const out: string[] = [];
    for (const [name, o] of list) {
      draw(params(o));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      out.push(await save(name));
    }
    return out;
  };
}
