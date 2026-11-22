import { Color, DirectionalLight, HemisphereLight, MathUtils, PerspectiveCamera, Scene, type WebGLRenderer } from 'three';
import { defaultInput } from './FighterAnimator';
import type { ModelCache } from './ModelCache';
import type { Renderer } from './Renderer';

/**
 * Beta 2.6.1 — PRIME SHARE: the hero shot of the victory poster. The fighter's own 3D model (in the look it won in),
 * posed in one of its victory routines, lit like a championship broadcast and seen from below at three quarters.
 *
 * Drawn with the game's MAIN WebGL context (like the portraits, render/PortraitStudio.ts) — never a second context:
 * the picture is larger than the screen of a phone, so it is drawn in tiles (PerspectiveCamera.setViewOffset), each
 * copied out of the drawing buffer right after it is drawn. The game's colour pipeline (tone mapping, sRGB, MSAA) is
 * the one of the screen. A small first pass measures the fighter's silhouette, then the lens zooms and shifts so the
 * fighter fills exactly the poster's frame (no 2D scaling — every pixel is drawn at the poster's size). Nothing stays
 * behind: the lights and camera live for this call, the fighter is the studio copy (never the one standing in the
 * arena), the renderer's state is restored and the screen's frame redrawn at once. Only on the player's tap.
 */
export interface HeroFrame {
  /** Where the fighter must stand in the picture (pixels): head-top line, feet line, centre, widest. */
  top: number;
  bottom: number;
  cx: number;
  maxWidth: number;
}

export interface HeroShot {
  /** Width × height of the picture in pixels (the poster's own size: it never depends on the screen). */
  width: number;
  height: number;
  /** Which of the fighter's victory routines and how far into it (seconds). */
  variant: number;
  at: number;
  /** Where the fighter looks (radians, 0 = straight at the camera); the camera's side angle (radians). */
  facing: number;
  orbit: number;
  /** Height of the camera above the floor (world units, the fighter is ~2.3) — low = seen from below. */
  camY: number;
  /** Distance of the camera (sets the perspective), the height it looks at and its starting field of view. */
  dist: number;
  aimY: number;
  fov: number;
  frame: HeroFrame;
}

/** The silhouette's box (pixels of the picture) in a drawn image, or null when nothing was drawn. */
function alphaBox(ctx: CanvasRenderingContext2D, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Draws `W × H` of the scene through `cam` into `ctx` (tiles no larger than the drawing buffer). */
function drawTiled(gl: WebGLRenderer, scene: Scene, cam: PerspectiveCamera, ctx: CanvasRenderingContext2D, W: number, H: number, offX: number, offY: number): void {
  const canvas = gl.domElement;
  const pr = gl.getPixelRatio();
  const tileW = Math.min(W, canvas.width);
  const tileH = Math.min(H, canvas.height);
  for (let ty = 0; ty < H; ty += tileH) {
    for (let tx = 0; tx < W; tx += tileW) {
      const w = Math.min(tileW, W - tx);
      const h = Math.min(tileH, H - ty);
      cam.setViewOffset(W, H, tx + offX, ty + offY, w, h);
      cam.updateProjectionMatrix();
      gl.setViewport(0, 0, w / pr, h / pr);
      gl.setScissor(0, 0, w / pr, h / pr);
      gl.clear(true, true, true);
      gl.render(scene, cam);
      ctx.drawImage(canvas, 0, canvas.height - h, w, h, tx, ty, w, h);
    }
  }
}

export function renderHeroShot(r: Renderer, models: ModelCache, look: string, o: HeroShot): { canvas: HTMLCanvasElement; box: { x0: number; y0: number; x1: number; y1: number } } | null {
  const gl = r.renderer;
  const canvas = gl.domElement;
  const W = Math.round(o.width);
  const H = Math.round(o.height);
  if (Math.min(W, canvas.width) < 64 || Math.min(H, canvas.height) < 64 || gl.getContext().isContextLost()) return null;
  const pr = gl.getPixelRatio();

  // the broadcast's light: cool sky, violet floor bounce, a warm key from the front, cyan and violet rims, a gold kicker
  const scene = new Scene();
  scene.add(new HemisphereLight(0xa9bcff, 0x4a1f6a, 1.25));
  const key = new DirectionalLight(0xfff0dc, 2.7);
  key.position.set(-2.2, 3.4, 4.2);
  const rimA = new DirectionalLight(0x4fe6ff, 3.1);
  rimA.position.set(-3.6, 2.6, -3.2);
  const rimB = new DirectionalLight(0xb46bff, 2.6);
  rimB.position.set(3.8, 2.2, -2.8);
  const kick = new DirectionalLight(0xffc65a, 1.15);
  kick.position.set(1.2, -0.6, 3.6);
  scene.add(key, rimA, rimB, kick);

  const cam = new PerspectiveCamera(o.fov, W / H, 0.1, 40);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d', { willReadFrequently: false });
  // the measuring pass: a fifth of the size
  const PW = Math.max(64, Math.round(W / 5));
  const PH = Math.max(64, Math.round(H / 5));
  const probe = document.createElement('canvas');
  probe.width = PW;
  probe.height = PH;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx || !pctx) return null;

  const prevClear = new Color();
  gl.getClearColor(prevClear);
  const prevAlpha = gl.getClearAlpha();
  const prevAutoClear = gl.autoClear;
  const shadowsWere = gl.shadowMap.enabled;
  const prevTarget = gl.getRenderTarget();

  // the studio copy: the fighter on stage (results view) never moves, turns or changes its routine
  const usual = models.get(look);
  const m = usual.rig.root.parent ? models.get(look, 'studio') : usual;
  const rig = m.rig;
  const parent = rig.root.parent;
  const prevPos = rig.root.position.clone();
  const prevRot = rig.root.rotation.y;
  const prevVis = rig.root.visible;
  let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  try {
    gl.shadowMap.enabled = false;
    scene.add(rig.root);
    rig.root.visible = true;
    m.anim.reset(o.facing);
    const inp = defaultInput();
    inp.facing = o.facing;
    for (let i = 0; i < 6; i++) m.anim.update(1 / 60, inp);
    m.anim.victory(o.variant);
    inp.victory = true;
    // the routine at the chosen moment (fixed steps: the same poster for the same fight, every time)
    const steps = Math.max(1, Math.round(o.at * 60));
    for (let i = 0; i < steps; i++) m.anim.update(1 / 60, inp);
    rig.root.position.set(0, 0, 0);
    rig.root.updateMatrixWorld(true);

    cam.position.set(Math.sin(o.orbit) * o.dist, o.camY, Math.cos(o.orbit) * o.dist);
    cam.lookAt(0, o.aimY, 0);
    gl.setRenderTarget(null);
    gl.setScissorTest(true);
    gl.setClearColor(0x000000, 0);
    gl.autoClear = false;

    // 1. measure: where the silhouette falls with the starting lens
    drawTiled(gl, scene, cam, pctx, PW, PH, 0, 0);
    const p = alphaBox(pctx, PW, PH);
    if (!p) {
      out.width = out.height = 0;
      return null;
    }
    const k = W / PW;
    const bx0 = p.x0 * k;
    const bx1 = p.x1 * k;
    const by0 = p.y0 * (H / PH);
    const by1 = p.y1 * (H / PH);
    // 2. zoom (field of view) so the fighter fills the frame's height (or its width, if the pose is wider)
    const s = Math.min((o.frame.bottom - o.frame.top) / Math.max(1, by1 - by0), o.frame.maxWidth / Math.max(1, bx1 - bx0));
    cam.fov = 2 * MathUtils.radToDeg(Math.atan(Math.tan(MathUtils.degToRad(o.fov) / 2) / s));
    // a zoom scales the picture about its centre: shift the lens so the feet land on the floor line, centred
    const offY = Math.round(H / 2 + (by1 - H / 2) * s - o.frame.bottom);
    const offX = Math.round(W / 2 + ((bx0 + bx1) / 2 - W / 2) * s - o.frame.cx);
    // 3. the picture itself, at full size
    drawTiled(gl, scene, cam, ctx, W, H, offX, offY);
    box = {
      x0: Math.round(W / 2 + (bx0 - W / 2) * s - offX),
      x1: Math.round(W / 2 + (bx1 - W / 2) * s - offX),
      y0: Math.round(H / 2 + (by0 - H / 2) * s - offY),
      y1: Math.round(H / 2 + (by1 - H / 2) * s - offY),
    };
  } finally {
    scene.remove(rig.root);
    if (parent) parent.add(rig.root);
    rig.root.position.copy(prevPos);
    rig.root.rotation.y = prevRot;
    rig.root.visible = prevVis;
    m.anim.reset(prevRot);
    gl.setScissorTest(false);
    gl.setRenderTarget(prevTarget);
    gl.setViewport(0, 0, canvas.width / pr, canvas.height / pr);
    gl.setClearColor(prevClear, prevAlpha);
    gl.autoClear = prevAutoClear;
    gl.shadowMap.enabled = shadowsWere;
    // the drawing buffer now holds the last tile: draw the screen's own frame again before the browser shows it
    try {
      r.render(0);
    } catch {
      /* the next frame of the loop draws it anyway */
    }
    key.dispose();
    rimA.dispose();
    rimB.dispose();
    kick.dispose();
    probe.width = probe.height = 0;
  }
  return box ? { canvas: out, box } : null;
}
