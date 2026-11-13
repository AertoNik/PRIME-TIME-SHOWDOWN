import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Material,
} from 'three';
import { arenaById, type ArenaCoverDef } from '../../config/arenas.config';
import { ARENA, COVER_TUNING } from '../../config/balance';
import type { ArenaTheme } from '../../config/themes.config';
import { Rng } from '../../core/math';
import { canvasTexture } from '../textures';
import { pointOnRing } from './CasinoStage';
import {
  colorCones,
  drawNeon,
  flatExtrude,
  floorCanvas,
  floorMesh,
  FLOOR_TOP,
  GROUND_Y,
  insetPath,
  landingY,
  makeSpotCone,
  merge,
  neonMaterial,
  tint,
  paintTexture,
  Pieces,
  ringShape,
  Stage,
  surfaceY,
  swingCones,
  WALL_TOP,
  type DebrisShape,
  type DecorLayout,
  type SpotCone,
  type StageShared,
} from './StageKit';

// Alpha 1.9.7 — HOLIDAY BROADCAST, the New Year set of WINTER SHOWDOWN: a luxury studio a minute before midnight.
// Deep navy-violet floor with frost-blue light lines and a gold snowflake, a barrier wrapped in a twinkling garland,
// a studio wall with a giant clock at 11:59, the HOLIDAY BROADCAST neon, two trees with lights and gift piles, and
// candy-cane arches. The cover on the floor is the GRAVEYARD system (src/combat/Covers.ts): every piece is ROUND or a
// capsule exactly like its collision body (round gift boxes, snow cannons, clockwork columns, capsule set consoles),
// pre-split into chunks that crack, lose their top and fly as debris; what is left on the floor is low rubble that
// stops nothing (the simulation removes the body at 0 hp).

const DEF = arenaById('holiday');
const COVERS: readonly ArenaCoverDef[] = DEF.covers ?? [];
const FROST = 0x7fe3ff;
const GOLD = 0xffcc4d;
const RED = 0xff3a5a;
const _c = new Color();
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _v = new Vector3();

// ------------------------------------------------------------------ textures
function drawFloor(): { map: CanvasTexture; emissive: CanvasTexture } {
  const { c, g, e, eg, X, Y, ppu, W, H } = floorCanvas(1024);
  // 1.9.7 final art: a royal winter blue with the warm light of the midnight clock in the middle
  const gr = g.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.85);
  gr.addColorStop(0, '#3c4cae');
  gr.addColorStop(0.35, '#24328a');
  gr.addColorStop(0.75, '#151d5c');
  gr.addColorStop(1, '#0a1038');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  const warm = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 2.8 * ppu);
  warm.addColorStop(0, 'rgba(255,214,120,0.30)');
  warm.addColorStop(1, 'rgba(255,214,120,0)');
  g.fillStyle = warm;
  g.fillRect(0, 0, W, H);
  // a lattice of fine frost lines (ice-crystal tiles)
  g.strokeStyle = 'rgba(190,225,255,0.075)';
  g.lineWidth = 2;
  const step = 0.92 * ppu;
  for (let k = -H; k < W + H; k += step) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + H, H);
    g.moveTo(k + H, 0);
    g.lineTo(k, H);
    g.stroke();
  }
  // frost creeping in from the barrier: a soft white edge
  for (let i = 0; i < 7; i++) {
    const o = 0.62 - i * 0.07;
    g.beginPath();
    insetPath(g, X, Y, ppu, ARENA.halfX + o, ARENA.halfZ + o, ARENA.cornerRadius + o);
    g.closePath();
    g.strokeStyle = `rgba(225,240,255,${0.045 + i * 0.012})`;
    g.lineWidth = 0.16 * ppu;
    g.stroke();
  }
  // a candy-cane border: white band, red stripes
  const band = () => {
    g.beginPath();
    insetPath(g, X, Y, ppu, ARENA.halfX + 0.02, ARENA.halfZ + 0.02, ARENA.cornerRadius + 0.02);
    g.closePath();
  };
  g.lineCap = 'butt';
  band();
  g.strokeStyle = '#f4efe8';
  g.lineWidth = 0.17 * ppu;
  g.stroke();
  band();
  g.setLineDash([0.2 * ppu, 0.2 * ppu]);
  g.strokeStyle = '#d3203c';
  g.stroke();
  g.setLineDash([]);
  // frost-blue light line outside the band, gold line inside it (both glow)
  const lines: [number, number, number, number, string][] = [
    [ARENA.halfX + 0.28, ARENA.halfZ + 0.28, ARENA.cornerRadius + 0.28, 6, '#7fe3ff'],
    [ARENA.halfX - 0.2, ARENA.halfZ - 0.2, ARENA.cornerRadius - 0.2, 3, '#ffcc4d'],
  ];
  for (const [hx, hz, r, w, col] of lines) {
    for (const ctx of [g, eg]) {
      ctx.beginPath();
      insetPath(ctx, X, Y, ppu, hx, hz, r);
      ctx.closePath();
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.stroke();
    }
  }
  // holly sprigs in the four corners: three leaves and red berries, turned toward the centre
  const holly = (x: number, z: number) => {
    const cx = X(x);
    const cz = Y(z);
    const toC = Math.atan2(Y(0) - cz, X(0) - cx);
    for (const da of [-0.75, 0, 0.75]) {
      const a = toC + Math.PI + da;
      g.save();
      g.translate(cx + Math.cos(a) * 0.2 * ppu, cz + Math.sin(a) * 0.2 * ppu);
      g.rotate(a);
      g.fillStyle = '#1e7a46';
      g.beginPath();
      const L = 0.34 * ppu;
      const w = 0.12 * ppu;
      g.moveTo(-L / 2, 0);
      for (let k = 0; k <= 4; k++) g.lineTo(-L / 2 + (L * k) / 4, (k % 2 ? -1 : -0.7) * w);
      for (let k = 4; k >= 0; k--) g.lineTo(-L / 2 + (L * k) / 4, (k % 2 ? 1 : 0.7) * w);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(160,230,180,0.6)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(-L / 2, 0);
      g.lineTo(L / 2, 0);
      g.stroke();
      g.restore();
    }
    for (const [ox, oz] of [
      [0, 0],
      [0.07, 0.06],
      [-0.06, 0.07],
    ]) {
      g.fillStyle = '#e11d3c';
      g.beginPath();
      g.arc(cx + ox * ppu, cz + oz * ppu, 0.055 * ppu, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,220,220,0.75)';
      g.beginPath();
      g.arc(cx + (ox - 0.015) * ppu, cz + (oz - 0.015) * ppu, 0.016 * ppu, 0, Math.PI * 2);
      g.fill();
    }
  };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) holly(sx * (ARENA.halfX - 0.75), sz * (ARENA.halfZ - 0.75));
  // the centre: the midnight clock on the floor — a frost glow, a double gold ring, twelve gold marks and a snowflake
  const cx = X(0);
  const cz = Y(0);
  const fg = g.createRadialGradient(cx, cz, 0, cx, cz, 1.55 * ppu);
  fg.addColorStop(0, 'rgba(127,227,255,0.22)');
  fg.addColorStop(1, 'rgba(127,227,255,0)');
  g.fillStyle = fg;
  g.fillRect(0, 0, W, H);
  for (const ctx of [g, eg]) {
    ctx.strokeStyle = '#ffcc4d';
    ctx.lineWidth = 4;
    for (const rr of [1.25, 1.95]) {
      ctx.beginPath();
      ctx.arc(cx, cz, rr * ppu, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 - Math.PI / 2;
      const big = k % 3 === 0;
      const r0 = (big ? 1.4 : 1.5) * ppu;
      const r1 = 1.8 * ppu;
      ctx.lineWidth = big ? 7 : 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cz + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cz + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(160,236,255,0.95)';
    ctx.lineWidth = 5;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      const L = 1.05 * ppu;
      ctx.beginPath();
      ctx.moveTo(cx, cz);
      ctx.lineTo(cx + ux * L, cz + uz * L);
      for (const f of [0.42, 0.68]) {
        const bx = cx + ux * L * f;
        const bz = cz + uz * L * f;
        for (const s of [1, -1]) {
          const b = a + s * 0.7;
          ctx.moveTo(bx, bz);
          ctx.lineTo(bx + Math.cos(b) * L * 0.22, bz + Math.sin(b) * L * 0.22);
        }
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + ux * L, cz + uz * L, 0.045 * ppu, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200,245,255,1)';
      ctx.fill();
    }
  }
  // glitter of snow: soft dots and a few four-point twinkles (these shine a little)
  const rng = new Rng(97);
  for (let k = 0; k < 260; k++) {
    g.fillStyle = `rgba(225,242,255,${rng.range(0.06, 0.26)})`;
    const s = rng.range(1.5, 3);
    g.fillRect(rng.range(0, W), rng.range(0, H), s, s);
  }
  for (let k = 0; k < 12; k++) {
    const x = rng.range(0.05, 0.95) * W;
    const y = rng.range(0.05, 0.95) * H;
    const L = rng.range(3, 6);
    for (const ctx of [g, eg]) {
      ctx.strokeStyle = ctx === g ? 'rgba(235,248,255,0.7)' : 'rgba(140,200,240,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - L, y);
      ctx.lineTo(x + L, y);
      ctx.moveTo(x, y - L);
      ctx.lineTo(x, y + L);
      ctx.stroke();
    }
  }
  return { map: canvasTexture(c), emissive: canvasTexture(e) };
}

/** A tear or a crack pattern over a cover's paint (more for the later looks). */
function paintTears(g: CanvasRenderingContext2D, w: number, h: number, stage: number, seed: number, color: string): void {
  if (stage <= 0) return;
  const rng = new Rng(seed);
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (let k = 0; k < stage * 4; k++) {
    let x = rng.range(0.1, 0.9) * w;
    let y = rng.range(0.15, 0.85) * h;
    g.lineWidth = rng.range(2, 4);
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += rng.range(-0.12, 0.12) * w;
      y += rng.range(-0.1, 0.14) * h;
      g.lineTo(x, y);
    }
    g.stroke();
  }
}

/** Wrapping paper of a round gift box: stripes, polka dots and the gold ribbon down the front and back. */
function giftTexture(paper: string, dots: string, stage: number, seed: number): CanvasTexture {
  return paintTexture(256, 128, (g, w, h) => {
    g.fillStyle = paper;
    g.fillRect(0, 0, w, h);
    g.fillStyle = dots;
    for (let y = 10; y < h; y += 22) for (let x = (y / 22) % 2 ? 14 : 3; x < w; x += 22) {
      g.beginPath();
      g.arc(x, y, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#e0b84c';
    for (const x of [w * 0.25, w * 0.75]) g.fillRect(x - 9, 0, 18, h);
    g.fillStyle = 'rgba(255,240,190,0.55)';
    for (const x of [w * 0.25, w * 0.75]) g.fillRect(x - 3, 0, 3, h);
    paintTears(g, w, h, stage, seed, 'rgba(20,6,10,0.75)');
  });
}

/** The clockwork column's clock face (stage 0–2: the glass cracks). */
function clockFace(stage: number): CanvasTexture {
  return paintTexture(256, 256, (g, w) => {
    const r = w / 2;
    g.fillStyle = '#0d1230';
    g.fillRect(0, 0, w, w);
    g.fillStyle = '#f6efdc';
    g.beginPath();
    g.arc(r, r, r * 0.86, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#c49a3a';
    g.lineWidth = 10;
    g.stroke();
    g.fillStyle = '#3a0d1e';
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const L = k % 3 === 0 ? 22 : 12;
      g.save();
      g.translate(r + Math.sin(a) * r * 0.7, r - Math.cos(a) * r * 0.7);
      g.rotate(a);
      g.fillRect(-3, -L / 2, 6, L);
      g.restore();
    }
    g.strokeStyle = '#3a0d1e';
    g.lineCap = 'round';
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(r, r);
    g.lineTo(r, r - r * 0.62);
    g.stroke();
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(r, r);
    g.lineTo(r - Math.sin(0.1) * r * 0.48, r - Math.cos(0.1) * r * 0.48);
    g.stroke();
    paintTears(g, w, w, stage, 211, 'rgba(60,70,100,0.85)');
  });
}

function consoleScreen(stage: number): CanvasTexture {
  return paintTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#040616';
    g.fillRect(0, 0, w, h);
    g.fillStyle = stage >= 2 ? '#5a2030' : '#ff3a5a';
    g.beginPath();
    g.arc(30, h / 2, 12, 0, Math.PI * 2);
    g.fill();
    g.font = 'italic 900 52px Unbounded, "Arial Black", sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = stage >= 2 ? '#3a5a70' : '#7fe3ff';
    g.fillText('LIVE', 54, h / 2 + 2);
    if (stage >= 1) {
      g.fillStyle = 'rgba(127,227,255,0.35)';
      for (let y = 6; y < h; y += 9) g.fillRect(0, y, w, 2);
    }
    paintTears(g, w, h, stage, 77, 'rgba(200,230,255,0.6)');
  });
}

function wallTexture(): CanvasTexture {
  return paintTexture(1024, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#05071c');
    gr.addColorStop(0.55, '#121a52');
    gr.addColorStop(1, '#2a1d5e');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    // 1.9.7 final art: a soft aurora over the winter night
    for (const [y0, col, amp] of [
      [0.22, 'rgba(90,255,190,0.16)', 0.06],
      [0.3, 'rgba(127,227,255,0.14)', 0.05],
      [0.17, 'rgba(190,140,255,0.10)', 0.07],
    ] as [number, string, number][]) {
      g.strokeStyle = col;
      g.lineWidth = h * 0.09;
      g.lineCap = 'round';
      g.beginPath();
      for (let x = -20; x <= w + 20; x += 16) {
        const y = h * (y0 + Math.sin(x * 0.009 + y0 * 20) * amp + Math.sin(x * 0.023) * amp * 0.4);
        if (x < 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    const rng = new Rng(5);
    for (let k = 0; k < 360; k++) {
      g.fillStyle = `rgba(230,244,255,${rng.range(0.15, 0.75)})`;
      const s = rng.range(1, 3);
      g.fillRect(rng.range(0, w), rng.range(0, h * 0.72), s, s);
    }
    // a crescent moon high on the left
    g.fillStyle = 'rgba(255,246,214,0.95)';
    g.beginPath();
    g.arc(w * 0.16, h * 0.16, h * 0.07, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0a0d2c';
    g.beginPath();
    g.arc(w * 0.16 + h * 0.035, h * 0.16 - h * 0.02, h * 0.064, 0, Math.PI * 2);
    g.fill();
    // big faint snowflakes floating in the window
    g.strokeStyle = 'rgba(200,236,255,0.22)';
    g.lineCap = 'round';
    for (const [fx, fy, fr] of [
      [0.3, 0.42, 0.07],
      [0.72, 0.18, 0.05],
      [0.86, 0.48, 0.08],
      [0.08, 0.55, 0.05],
      [0.58, 0.58, 0.04],
    ] as [number, number, number][]) {
      const cx = fx * w;
      const cy = fy * h;
      const L = fr * h;
      g.lineWidth = 3;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L);
        for (const s of [1, -1]) {
          g.moveTo(cx + Math.cos(a) * L * 0.55, cy + Math.sin(a) * L * 0.55);
          g.lineTo(cx + Math.cos(a) * L * 0.55 + Math.cos(a + s * 0.7) * L * 0.25, cy + Math.sin(a) * L * 0.55 + Math.sin(a + s * 0.7) * L * 0.25);
        }
        g.stroke();
      }
    }
  });
}

/** Red and white stripes for the candy-cane rail (repeated along the tube). */
function caneTexture(): CanvasTexture {
  const tex = paintTexture(64, 32, (g, w, h) => {
    g.fillStyle = '#f7f1ea';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d3203c';
    for (let k = -2; k < 3; k++) {
      g.beginPath();
      g.moveTo(k * w * 0.5, 0);
      g.lineTo(k * w * 0.5 + w * 0.25, 0);
      g.lineTo(k * w * 0.5 + w * 0.25 + w * 0.5, h);
      g.lineTo(k * w * 0.5 + w * 0.5, h);
      g.closePath();
      g.fill();
    }
  });
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  return tex;
}

/** A soft round light pool (additive) for the floor. */
function poolTexture(): CanvasTexture {
  return paintTexture(128, 128, (g, w) => {
    const r = w / 2;
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
  });
}

/** Points around a rounded rectangle at offset `o` outside the barrier's inner face, every `step` metres. */
function ringPoints(o: number, step: number): Vector3[] {
  const hx = ARENA.wallX + o;
  const hz = ARENA.wallZ + o;
  const r = ARENA.wallCorner + o;
  const per = 2 * (2 * (hx - r) + 2 * (hz - r)) + 2 * Math.PI * r;
  const n = Math.max(8, Math.round(per / step));
  const out: Vector3[] = [];
  for (let i = 0; i < n; i++) out.push(pointOnRing(hx, hz, r, (i / n) * per));
  return out;
}

// ------------------------------------------------------------------ chunks
interface Chunk {
  geo: BufferGeometry;
  at: Vector3;
  half: [number, number, number];
}

function centred(geo: BufferGeometry): Chunk {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const at = new Vector3();
  bb.getCenter(at);
  geo.translate(-at.x, -at.y, -at.z);
  const sz = new Vector3();
  bb.getSize(sz);
  return { geo, at, half: [sz.x / 2, sz.y / 2, sz.z / 2] };
}

/** A closed half drum (`front`: the +z half) of radius r from y0 to y0 + h. */
function halfDrum(r: number, y0: number, h: number, front: boolean): BufferGeometry {
  const s = new Shape();
  s.moveTo(r, 0);
  s.absarc(0, 0, r, 0, Math.PI, false);
  s.closePath();
  const g = flatExtrude(s, h);
  // flatExtrude maps the shape's +y to world −z: the shape is the back half; turned round, the front one
  if (front) g.rotateY(Math.PI);
  return g.translate(0, y0, 0);
}

/** A capsule plan (stadium) from x0 to x1 of the console's body (`r` its half depth). */
function stadiumPart(len: number, r: number, x0: number, x1: number, y0: number, h: number): BufferGeometry {
  const s = new Shape();
  const a = -len / 2;
  const b = len / 2;
  // the slab: a rectangle between the two half circles, cut at x0..x1
  const pts: [number, number][] = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = Math.PI / 2 + (i / N) * Math.PI;
    pts.push([a + Math.cos(t) * r, Math.sin(t) * r]);
  }
  for (let i = 0; i <= N; i++) {
    const t = -Math.PI / 2 + (i / N) * Math.PI;
    pts.push([b + Math.cos(t) * r, Math.sin(t) * r]);
  }
  const clip = pts.map(([x, y]) => [Math.max(x0, Math.min(x1, x)), y] as [number, number]);
  s.moveTo(clip[0][0], clip[0][1]);
  for (let i = 1; i < clip.length; i++) s.lineTo(clip[i][0], clip[i][1]);
  s.closePath();
  return flatExtrude(s, h).translate(0, y0, 0);
}

interface KindModel {
  remains: BufferGeometry;
  chunks: Chunk[];
  /** The chunk that falls off at the battered look (−1: none). */
  lost: number;
}

function giftModel(): KindModel {
  const r = 0.44;
  const h = 0.84;
  const chunks: Chunk[] = [];
  for (const [y0, hh] of [
    [0.06, 0.39],
    [0.45, 0.39],
  ] as [number, number][])
    for (const f of [false, true]) chunks.push(centred(halfDrum(r, y0, hh, f)));
  const lid = merge([
    new CylinderGeometry(r + 0.03, r + 0.03, 0.12, 24).translate(0, h + 0.06, 0),
    new TorusGeometry(0.08, 0.03, 8, 14).rotateY(Math.PI / 4).translate(-0.06, h + 0.18, 0),
    new TorusGeometry(0.08, 0.03, 8, 14).rotateY(-Math.PI / 4).translate(0.06, h + 0.18, 0),
    new SphereGeometry(0.045, 10, 8).translate(0, h + 0.14, 0),
  ]);
  chunks.push(centred(lid));
  return { remains: new CylinderGeometry(r, r + 0.02, 0.07, 24).translate(0, 0.035, 0), chunks, lost: 4 };
}

function snowgenModel(): KindModel {
  const r = 0.37;
  const chunks: Chunk[] = [];
  for (const [y0, hh] of [
    [0.1, 0.45],
    [0.55, 0.45],
  ] as [number, number][])
    for (const f of [false, true]) chunks.push(centred(halfDrum(r, y0, hh, f)));
  const head = merge([
    new CylinderGeometry(0.28, 0.33, 0.18, 18).translate(0, 1.09, 0),
    new CylinderGeometry(0.1, 0.15, 0.42, 14).rotateX(-0.9).translate(0, 1.3, 0.12),
    new TorusGeometry(0.11, 0.03, 8, 14).rotateX(-0.9 + Math.PI / 2).translate(0, 1.44, 0.3),
  ]);
  chunks.push(centred(head));
  return { remains: new BoxGeometry(0.78, 0.1, 0.78).translate(0, 0.05, 0), chunks, lost: 4 };
}

function clocktowerModel(): KindModel {
  const r = 0.38;
  const chunks: Chunk[] = [];
  for (const [y0, hh] of [
    [0.2, 0.42],
    [0.62, 0.42],
    [1.04, 0.38],
  ] as [number, number][])
    for (const f of [false, true]) chunks.push(centred(halfDrum(r, y0, hh, f)));
  // the clock head: 1.42–1.86 m, a low brass roof to 1.98 m (the camera's view rule: nothing over 2.0 m)
  const head = merge([new BoxGeometry(0.62, 0.44, 0.62).translate(0, 1.64, 0), new ConeGeometry(0.46, 0.12, 4).rotateY(Math.PI / 4).translate(0, 1.92, 0)]);
  chunks.push(centred(head));
  return { remains: new CylinderGeometry(0.46, 0.5, 0.2, 18).translate(0, 0.1, 0), chunks, lost: 6 };
}

function consoleModel(): KindModel {
  const len = COVER_TUNING.console.half * 2;
  const r = COVER_TUNING.console.radius - 0.01;
  const h = 0.92;
  const A = -len / 2 - r;
  const B = len / 2 + r;
  const cuts = [A, -0.15, 0.15, B];
  const chunks: Chunk[] = [];
  for (let i = 0; i < 3; i++) chunks.push(centred(stadiumPart(len, r, cuts[i], cuts[i + 1], 0.08, h)));
  chunks.push(centred(new BoxGeometry(0.62, 0.3, 0.05).translate(0, 0.78, r + 0.01)));
  return { remains: stadiumPart(len, r, A, B, 0, 0.08), chunks, lost: 3 };
}

// ------------------------------------------------------------------ views
interface CoverView {
  kind: ArenaCoverDef['kind'];
  x: number;
  z: number;
  yaw: number;
  group: Group;
  body: Group;
  chunks: Mesh[];
  home: { p: Vector3; q: Quaternion }[];
  halves: [number, number, number][];
  remains: Mesh;
  /** Materials for the looks 0–2 per chunk slot (the screen / face chunk has its own). */
  looks: Material[][];
  stage: number;
  shake: number;
  hitCd: number;
  lost: number;
  phase: number;
  puffT: number;
}

interface GiftP {
  top: Mesh;
  low: Mesh;
  x: number;
  y: number;
  z: number;
  broken: boolean;
}

interface LampP {
  globe: Mesh;
  glow: MeshBasicMaterial;
  broken: boolean;
  flicker: number;
}

const LAYOUT: DecorLayout = {
  spots: [
    [-7.2, GROUND_Y, -5.6, 0.5],
    [7.2, GROUND_Y, -5.6, 0.5],
    [-7.4, GROUND_Y, 4.2, 0.46],
    [7.4, GROUND_Y, 4.2, 0.46],
    [-3.8, GROUND_Y, -12.2, 0.48],
    [3.8, GROUND_Y, -12.2, 0.48],
    [-9.0, GROUND_Y, -10.6, 0.5],
    [9.0, GROUND_Y, -10.6, 0.5],
    [-10.8, GROUND_Y, -1.2, 0.5],
    [10.8, GROUND_Y, -1.2, 0.5],
    [-5.6, WALL_TOP, 6.6, 0.28],
    [5.6, WALL_TOP, 6.6, 0.28],
  ],
  menuSpots: [
    [-1.95, 0, 0.55, 0.42],
    [1.85, 0, 0.95, 0.32],
    [-1.35, 0, -1.25, 0.28],
    [1.5, 0, -1.0, 0.24],
  ],
  screens: [
    { x: -10.8, y: 3.4, z: -9.6, rx: -0.1, ry: 0.72, w: 3.6, h: 2.2, front: 0.16, size: 0.9 },
    { x: 10.8, y: 3.4, z: -9.6, rx: -0.1, ry: -0.72, w: 3.6, h: 2.2, front: 0.16, size: 0.9 },
  ],
  banners: [
    [-5.6, 7.4, -14.4, 0],
    [5.6, 7.4, -14.4, 0],
    [-12.4, 6.0, -6.6, 0.7],
    [12.4, 6.0, -6.6, -0.7],
  ],
  bats: { r: [4, 8], h: [8, 11], cx: [-5, 5], cz: [-17, -13] },
};

const PAPERS: [string, string][] = [
  ['#c4122f', 'rgba(255,220,220,0.35)'],
  ['#1f4fd8', 'rgba(220,240,255,0.4)'],
  ['#157a4a', 'rgba(220,255,230,0.35)'],
];

export class HolidayStage extends Stage {
  readonly id = 'holiday' as const;
  readonly layout = LAYOUT;
  private cones: SpotCone[] = [];
  private pieces = new Pieces();
  private covers: CoverView[] = [];
  private coverGroup = new Group();
  private gifts: GiftP[] = [];
  private lamps: LampP[] = [];
  private propMap: ({ k: 'gift'; i: number } | { k: 'lamp'; i: number } | { k: 'clock' })[] = [];
  private bulbs: InstancedMesh | null = null;
  private bulbBase: Color[] = [];
  /** 1.9.7 final art: the garland over the studio window (twinkles like the barrier's). */
  private wallBulbs: InstancedMesh | null = null;
  private wallBulbBase: Color[] = [];
  private clockDots!: MeshBasicMaterial;
  private pools: { mesh: Mesh; mat: MeshBasicMaterial; col: number; base: number; ph: number; chime: boolean }[] = [];
  private lanterns: MeshBasicMaterial[] = [];
  private treeLights: MeshBasicMaterial[] = [];
  private secondHand!: Mesh;
  private clockGlow!: MeshBasicMaterial;
  private sign!: MeshBasicMaterial;
  private signTex!: CanvasTexture;
  private chime = 0;
  private extraGeos: BufferGeometry[] = [];
  private extraMats: Material[] = [];

  constructor(shared: StageShared) {
    super(shared);
    this.buildFloor();
    this.buildBarrier();
    this.buildOutside();
    this.buildStudio();
    this.buildStudioMagic();
    this.buildProps();
    this.buildLights();
    this.buildCovers();
    this.group.add(this.coverGroup);
  }

  private keepM<T extends Material>(m: T): T {
    this.extraMats.push(m);
    return m;
  }

  private buildFloor(): void {
    const { map, emissive } = drawFloor();
    this.group.add(floorMesh(map, emissive, { roughness: 0.55, metalness: 0.12, emissiveIntensity: 1.25 }, 0x0d0f2a));
    const ground = new Mesh(new PlaneGeometry(90, 90), new MeshStandardMaterial({ color: 0x0a0a22, roughness: 0.92 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    this.group.add(ground);
  }

  /**
   * 1.9.7 final art: a crimson velvet barrier with snow on top, a frost light strip on its inner edge, a candy-cane rail
   * on gold posts and an evergreen garland in swags with coloured bulbs (a few twinkle each frame) and red bows. All of
   * it stands on or outside the barrier — the fighting floor and its edge are unchanged.
   */
  private buildBarrier(): void {
    const velvet = new MeshStandardMaterial({ color: 0x7a1530, roughness: 0.72, metalness: 0.06 });
    const wall = new Mesh(flatExtrude(ringShape(ARENA.wallX, ARENA.wallZ, ARENA.wallCorner, 0.45), WALL_TOP), velvet);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.group.add(wall);
    const strip = flatExtrude(ringShape(ARENA.wallX + 0.02, ARENA.wallZ + 0.02, ARENA.wallCorner + 0.02, 0.06), 0.03);
    strip.translate(0, WALL_TOP, 0);
    this.group.add(new Mesh(strip, new MeshBasicMaterial({ color: new Color(FROST).multiplyScalar(1.6), toneMapped: false })));
    // snow on the barrier: a soft white cap over its outer part and lumps of snow along it
    const snowMat = this.keepM(new MeshStandardMaterial({ color: 0xdde7fb, roughness: 0.92, emissive: new Color(0x9fc4ff), emissiveIntensity: 0.05 }));
    const cap = flatExtrude(ringShape(ARENA.wallX + 0.12, ARENA.wallZ + 0.12, ARENA.wallCorner + 0.12, 0.4), 0.05);
    cap.translate(0, WALL_TOP, 0);
    this.group.add(new Mesh(cap, snowMat));
    const lumpGeo = new SphereGeometry(1, 10, 6);
    this.extraGeos.push(lumpGeo);
    const lumpAt = ringPoints(0.3, 0.42);
    const lumps = new InstancedMesh(lumpGeo, snowMat, lumpAt.length);
    const rng = new Rng(611);
    lumpAt.forEach((pt, i) => {
      _m.compose(_p.set(pt.x, WALL_TOP + 0.04, pt.z), _q.identity(), _s.set(rng.range(0.16, 0.3), rng.range(0.05, 0.1), rng.range(0.16, 0.26)));
      lumps.setMatrixAt(i, _m);
    });
    this.group.add(lumps);
    // the candy-cane rail on gold posts (no post or bow where a set piece stands on the barrier)
    const off = 0.22;
    const railY = WALL_TOP + 0.42;
    const railPts = ringPoints(off, 0.25).map((v) => v.setY(railY));
    const railCurve = new CatmullRomCurve3(railPts, true, 'centripetal');
    const railLen = railCurve.getLength();
    const cane = caneTexture();
    cane.repeat.set(railLen / 0.32, 1);
    const rail = new Mesh(new TubeGeometry(railCurve, railPts.length * 2, 0.045, 8, true), this.keepM(new MeshStandardMaterial({ map: cane, roughness: 0.32, metalness: 0.05 })));
    this.group.add(rail);
    const busy = DEF.props.map((p) => new Vector3(p.x, 0, p.z));
    const free = (v: Vector3) => busy.every((b) => Math.hypot(b.x - v.x, b.z - v.z) > 0.75);
    const postAt = ringPoints(off, 2.4).filter(free);
    const postsGeo: BufferGeometry[] = [];
    const bowsGeo: BufferGeometry[] = [];
    for (const v of postAt) {
      postsGeo.push(new CylinderGeometry(0.035, 0.045, railY - WALL_TOP, 8).translate(v.x, WALL_TOP + (railY - WALL_TOP) / 2, v.z));
      postsGeo.push(new SphereGeometry(0.06, 10, 8).translate(v.x, railY + 0.05, v.z));
      // a red bow on the outer side of the post, facing out
      const a = Math.atan2(v.x / ARENA.wallX, v.z / ARENA.wallZ);
      const bow = merge([
        new TorusGeometry(0.075, 0.026, 8, 14).scale(1, 0.75, 0.6).translate(-0.075, 0, 0),
        new TorusGeometry(0.075, 0.026, 8, 14).scale(1, 0.75, 0.6).translate(0.075, 0, 0),
        new SphereGeometry(0.04, 10, 8),
        new BoxGeometry(0.035, 0.16, 0.02).rotateZ(0.35).translate(-0.04, -0.09, 0),
        new BoxGeometry(0.035, 0.16, 0.02).rotateZ(-0.35).translate(0.04, -0.09, 0),
      ]);
      bow.rotateY(a);
      const out = new Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(0.07);
      bow.translate(v.x + out.x, railY - 0.02, v.z + out.z);
      bowsGeo.push(bow);
    }
    const gold = this.keepM(new MeshStandardMaterial({ color: 0xd9ad48, roughness: 0.3, metalness: 0.85 }));
    if (postsGeo.length) this.group.add(new Mesh(merge(postsGeo), gold));
    if (bowsGeo.length) this.group.add(new Mesh(merge(bowsGeo), this.keepM(new MeshStandardMaterial({ color: 0xd8162e, roughness: 0.45 }))));
    // the evergreen garland: swags from post to post on the outer side, dipping between them
    const swag: Vector3[] = [];
    const gOff = 0.36;
    const hx = ARENA.wallX + gOff;
    const hz = ARENA.wallZ + gOff;
    const r = ARENA.wallCorner + gOff;
    const per = 2 * (2 * (hx - r) + 2 * (hz - r)) + 2 * Math.PI * r;
    const nSw = Math.round(per / 1.2);
    for (let i = 0; i < nSw * 4; i++) {
      const u = i / (nSw * 4);
      const p = pointOnRing(hx, hz, r, u * per);
      const ph = (i % 4) / 4;
      p.y = railY - 0.04 - Math.sin(ph * Math.PI) * 0.2;
      swag.push(p);
    }
    const swagCurve = new CatmullRomCurve3(swag, true, 'centripetal');
    const pine = this.keepM(new MeshStandardMaterial({ color: 0x1c6e3e, roughness: 0.95, emissive: new Color(0x0c3a1e), emissiveIntensity: 0.25 }));
    this.group.add(new Mesh(new TubeGeometry(swagCurve, swag.length * 2, 0.065, 6, true), pine));
    // bulbs along the garland (instanced; a few twinkle each frame)
    const n = Math.round(per / 0.3);
    const geo = new SphereGeometry(0.052, 8, 6);
    this.extraGeos.push(geo);
    const mat = this.keepM(new MeshBasicMaterial({ toneMapped: false }));
    const bulbs = new InstancedMesh(geo, mat, n);
    const cols = [RED, GOLD, FROST, 0x7aff9a, 0xff7ad9];
    for (let i = 0; i < n; i++) {
      const p = swagCurve.getPointAt(i / n);
      // under the garland and a little out of it, so every bulb shows
      const ox = p.x / Math.hypot(p.x, p.z * 0.7);
      const oz = (p.z * 0.7) / Math.hypot(p.x, p.z * 0.7);
      _m.compose(_p.set(p.x + ox * 0.05, p.y - 0.1, p.z + oz * 0.05), _q.identity(), _s.setScalar(1));
      bulbs.setMatrixAt(i, _m);
      const base = new Color(cols[i % cols.length]).multiplyScalar(2.3);
      this.bulbBase.push(base);
      bulbs.setColorAt(i, base);
    }
    this.group.add(bulbs);
    this.bulbs = bulbs;
  }

  /**
   * 1.9.7 final art: the snowy set around the barrier — a snow carpet with drifts against the barrier, small lit trees,
   * low lanterns and gift piles. Everything in front stays lower than the barrier (the battle camera looks over it);
   * the taller trees stand beside the arena, never between the camera and the floor.
   */
  private buildOutside(): void {
    // moonlit snow: blue in the studio's night light, so the bright fighting floor stays the centre of the picture
    const snow = this.keepM(new MeshStandardMaterial({ color: 0x27345f, roughness: 0.97 }));
    const carpet = new Mesh(flatExtrude(ringShape(ARENA.wallX + 0.44, ARENA.wallZ + 0.44, ARENA.wallCorner + 0.44, 4.2), 0.02), snow);
    carpet.position.y = GROUND_Y;
    carpet.receiveShadow = true;
    this.group.add(carpet);
    // drifts against the outside of the barrier
    const drift = this.keepM(new MeshStandardMaterial({ color: 0x6475ad, roughness: 0.94, emissive: new Color(0x4a66b8), emissiveIntensity: 0.06 }));
    const dGeo = new SphereGeometry(1, 12, 8);
    this.extraGeos.push(dGeo);
    const dAt = ringPoints(0.62, this.low ? 0.95 : 0.7);
    const drifts = new InstancedMesh(dGeo, drift, dAt.length);
    const rng = new Rng(812);
    dAt.forEach((pt, i) => {
      const s = rng.range(0.4, 0.75);
      _m.compose(_p.set(pt.x * (1 + rng.range(-0.01, 0.02)), GROUND_Y, pt.z * (1 + rng.range(-0.01, 0.02))), _q.setFromAxisAngle(_v.set(0, 1, 0), rng.range(0, 3)), _s.set(s, rng.range(0.16, 0.3), s * rng.range(0.6, 1.0)));
      drifts.setMatrixAt(i, _m);
    });
    this.group.add(drifts);
    // small lit trees beside the arena and at its corners (outside the barrier)
    const trees: [number, number, number][] = [
      [-7.1, -1.4, 1.9],
      [7.1, -1.4, 1.9],
      [-6.9, 6.3, 1.35],
      [6.9, 6.3, 1.35],
      [-6.8, -8.7, 2.2],
      [6.8, -8.7, 2.2],
    ];
    const pineGeo: BufferGeometry[] = [];
    const snowTips: BufferGeometry[] = [];
    const light: BufferGeometry[][] = [[], [], []];
    const stars: BufferGeometry[] = [];
    for (const [x, z, h] of trees) {
      for (let k = 0; k < 3; k++) {
        const rr = (0.75 - k * 0.2) * h * 0.55;
        const hh = h * 0.42;
        const y = GROUND_Y + h * 0.12 + k * h * 0.27;
        pineGeo.push(new ConeGeometry(rr, hh, 9).translate(x, y + hh / 2, z));
        snowTips.push(new ConeGeometry(rr * 0.98, hh * 0.18, 9).translate(x, y + hh * 0.42, z));
      }
      stars.push(new SphereGeometry(0.13 * h * 0.6, 8, 6).translate(x, GROUND_Y + h * 1.06, z));
      for (let k = 0; k < 12; k++) {
        const hy = rng.range(0.15, 0.9) * h;
        const rad = Math.max(0.08, (0.75 - (hy / h) * 0.62) * h * 0.55);
        const a = rng.range(0, Math.PI * 2);
        light[k % 3].push(new SphereGeometry(0.05, 6, 4).translate(x + Math.cos(a) * rad, GROUND_Y + h * 0.12 + hy, z + Math.sin(a) * rad));
      }
    }
    const treeMesh = new Mesh(merge(pineGeo), this.keepM(new MeshStandardMaterial({ color: 0x145a36, roughness: 0.88 })));
    treeMesh.castShadow = !this.low;
    this.group.add(treeMesh);
    this.group.add(new Mesh(merge(snowTips), drift));
    this.group.add(new Mesh(merge(stars), this.keepM(new MeshBasicMaterial({ color: new Color(GOLD).multiplyScalar(2.4), toneMapped: false }))));
    [RED, GOLD, FROST].forEach((col, k) => {
      const lm = this.keepM(new MeshBasicMaterial({ color: new Color(col).multiplyScalar(2.2), toneMapped: false }));
      this.treeLights.push(lm);
      this.group.add(new Mesh(merge(light[k]), lm));
    });
    // low warm lanterns along the front, gift piles and candy canes by the corners (all under the barrier's height)
    const brass = this.keepM(new MeshStandardMaterial({ color: 0xc49a3a, roughness: 0.35, metalness: 0.8 }));
    const lanternGeo: BufferGeometry[] = [];
    const globes: BufferGeometry[] = [];
    for (const x of [-4.3, -1.9, 1.9, 4.3]) {
      const z = ARENA.wallZ + 1.25;
      lanternGeo.push(new CylinderGeometry(0.03, 0.045, 0.5, 8).translate(x, GROUND_Y + 0.25, z));
      lanternGeo.push(new CylinderGeometry(0.11, 0.09, 0.05, 10).translate(x, GROUND_Y + 0.52, z));
      globes.push(new SphereGeometry(0.12, 12, 8).translate(x, GROUND_Y + 0.64, z));
    }
    this.group.add(new Mesh(merge(lanternGeo), brass));
    const lg = this.keepM(new MeshBasicMaterial({ color: new Color(0xffd27a).multiplyScalar(2), toneMapped: false }));
    this.lanterns.push(lg);
    this.group.add(new Mesh(merge(globes), lg));
    const giftGeo: BufferGeometry[] = [];
    const ribbonGeo: BufferGeometry[] = [];
    const giftCols = [0xc4122f, 0x1f4fd8, 0xe0b84c, 0x157a4a, 0xf2eee4];
    let gk = 0;
    for (const [x, z] of [
      [-6.4, 7.6],
      [6.4, 7.6],
      [-7.6, -0.2],
      [7.6, -0.2],
      [-7.0, -7.2],
      [7.0, -7.2],
    ] as [number, number][]) {
      for (let k = 0; k < 3; k++) {
        const s = rng.range(0.32, 0.52);
        const gx = x + rng.range(-0.45, 0.45);
        const gz = z + rng.range(-0.35, 0.35);
        const yaw = rng.range(-0.7, 0.7);
        giftGeo.push(tint(new BoxGeometry(s, s * 0.8, s).rotateY(yaw).translate(gx, GROUND_Y + s * 0.4, gz), giftCols[gk++ % giftCols.length]));
        ribbonGeo.push(new BoxGeometry(s * 1.02, s * 0.82, s * 0.16).rotateY(yaw).translate(gx, GROUND_Y + s * 0.4, gz));
        ribbonGeo.push(new BoxGeometry(s * 0.16, s * 0.82, s * 1.02).rotateY(yaw).translate(gx, GROUND_Y + s * 0.4, gz));
      }
    }
    this.group.add(new Mesh(merge(giftGeo), this.keepM(new MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }))));
    this.group.add(new Mesh(merge(ribbonGeo), brass));
    const caneMat = this.keepM(new MeshStandardMaterial({ map: (() => {
      const tx = caneTexture();
      tx.repeat.set(4, 1);
      return tx;
    })(), roughness: 0.35 }));
    for (const sx of [-1, 1]) {
      const x = sx * 3.1;
      const z = ARENA.wallZ + 1.0;
      const path = new CatmullRomCurve3([new Vector3(x, GROUND_Y, z), new Vector3(x, GROUND_Y + 0.55, z), new Vector3(x + sx * 0.06, GROUND_Y + 0.72, z), new Vector3(x + sx * 0.2, GROUND_Y + 0.74, z), new Vector3(x + sx * 0.27, GROUND_Y + 0.62, z)]);
      this.group.add(new Mesh(new TubeGeometry(path, 24, 0.045, 8, false), caneMat));
    }
  }

  /** The studio wall: a starry night window, the giant clock at 11:59, the neon, the trees, gifts and candy canes. */
  private buildStudio(): void {
    const zf = -15.2;
    const wall = new Mesh(new PlaneGeometry(26, 12), this.keepM(new MeshBasicMaterial({ map: wallTexture() })));
    wall.position.set(0, GROUND_Y + 6, zf - 0.2);
    this.group.add(wall);
    // gold frame of the window
    const gold = this.keepM(new MeshStandardMaterial({ color: 0xc49a3a, roughness: 0.3, metalness: 0.85 }));
    const frame: BufferGeometry[] = [];
    for (const [x, y, w, h] of [
      [0, 11.6, 26, 0.18],
      [0, 0.25, 26, 0.18],
      [-12.9, 6, 0.18, 11.6],
      [12.9, 6, 0.18, 11.6],
    ] as [number, number, number, number][])
      frame.push(new BoxGeometry(w, h, 0.12).translate(x, GROUND_Y + y, zf));
    this.group.add(new Mesh(merge(frame), gold));
    // the giant clock: a minute to midnight (the second hand sweeps; a hit on the barrier sign makes it chime)
    const cy = GROUND_Y + 7.0;
    const face = new Mesh(new CircleGeometry(2.3, 48), this.keepM(new MeshBasicMaterial({ map: clockFace(0), toneMapped: false })));
    face.position.set(0, cy, zf + 0.1);
    this.group.add(face);
    const ring = new Mesh(new TorusGeometry(2.36, 0.12, 10, 48), gold);
    ring.position.set(0, cy, zf + 0.12);
    this.group.add(ring);
    this.clockGlow = this.keepM(new MeshBasicMaterial({ color: new Color(GOLD).multiplyScalar(0.6), transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    const halo = new Mesh(new CircleGeometry(3.1, 48), this.clockGlow);
    halo.position.set(0, cy, zf + 0.02);
    this.group.add(halo);
    this.secondHand = new Mesh(new BoxGeometry(0.06, 1.9, 0.03).translate(0, 0.75, 0), this.keepM(new MeshBasicMaterial({ color: 0xc4122f })));
    this.secondHand.position.set(0, cy, zf + 0.18);
    this.group.add(this.secondHand);
    // HOLIDAY BROADCAST neon under the clock
    this.signTex = drawNeon('HOLIDAY BROADCAST', '#7fe3ff', 1024, 256, 84);
    this.sign = neonMaterial(this.signTex, 1.5);
    this.extraMats.push(this.sign);
    const sign = new Mesh(new PlaneGeometry(8.4, 2.1), this.sign);
    sign.position.set(0, GROUND_Y + 3.55, zf + 0.2);
    this.group.add(sign);
    // two trees with lights and a gold star, gift piles at their feet
    const pine = this.keepM(new MeshStandardMaterial({ color: 0x17633f, roughness: 0.8 }));
    const rng = new Rng(29);
    for (const sx of [-1, 1]) {
      const x = sx * 8.2;
      const z = -12.8;
      const tree = merge([0, 1, 2, 3].map((k) => new ConeGeometry(1.9 - k * 0.38, 1.9, 10).translate(0, GROUND_Y + 1.3 + k * 1.15, 0)));
      const tm = new Mesh(tree, pine);
      tm.position.set(x, 0, z);
      this.group.add(tm);
      const star = new Mesh(new SphereGeometry(0.28, 10, 8), this.keepM(new MeshBasicMaterial({ color: new Color(GOLD).multiplyScalar(2.4), toneMapped: false })));
      star.position.set(x, GROUND_Y + 5.55, z);
      this.group.add(star);
      for (const col of [RED, GOLD, FROST]) {
        const lm = this.keepM(new MeshBasicMaterial({ color: new Color(col).multiplyScalar(2.2), toneMapped: false }));
        this.treeLights.push(lm);
        const pts: BufferGeometry[] = [];
        for (let k = 0; k < 18; k++) {
          const hy = rng.range(0.4, 4.6);
          const rad = Math.max(0.2, 1.75 - hy * 0.36);
          const a = rng.range(0, Math.PI * 2);
          pts.push(new SphereGeometry(0.07, 6, 4).translate(Math.cos(a) * rad, GROUND_Y + 0.9 + hy, Math.sin(a) * rad));
        }
        const lights = new Mesh(merge(pts), lm);
        lights.position.set(x, 0, z);
        this.group.add(lights);
      }
      const giftCols = [0xc4122f, 0x1f4fd8, 0xe0b84c, 0x157a4a];
      const pile: Mesh[] = [];
      for (let k = 0; k < 4; k++) {
        const s = rng.range(0.55, 0.9);
        const m = new Mesh(new BoxGeometry(s, s * 0.8, s), this.keepM(new MeshStandardMaterial({ color: giftCols[k], roughness: 0.5 })));
        m.position.set(x + rng.range(-1.6, 1.6), GROUND_Y + s * 0.4, z + 1.6 + rng.range(-0.3, 0.5));
        m.rotation.y = rng.range(-0.6, 0.6);
        pile.push(m);
      }
      for (const m of pile) this.group.add(m);
      // a big candy cane arch on the side of the set
      const cane = new Group();
      const white = this.keepM(new MeshStandardMaterial({ color: 0xfaf4ee, roughness: 0.35 }));
      const red = this.keepM(new MeshStandardMaterial({ color: 0xd8162e, roughness: 0.35 }));
      for (let k = 0; k < 9; k++) cane.add(new Mesh(new CylinderGeometry(0.16, 0.16, 0.44, 12).translate(0, 0.22 + k * 0.44, 0), k % 2 ? red : white));
      const hook = new Mesh(new TorusGeometry(0.55, 0.16, 10, 18, Math.PI), red);
      hook.position.set(sx * -0.55, 4.0, 0);
      cane.add(hook);
      cane.position.set(sx * 11.6, GROUND_Y, -8.2);
      this.group.add(cane);
    }
  }

  /**
   * 1.9.7 final art over the studio window: a garland of bulbs in swags across the top, big glass baubles hanging on
   * threads, twelve glowing gold points round the giant clock (the magic minute) and soft light pools on the floor.
   */
  private buildStudioMagic(): void {
    const zf = -15.2;
    // the window garland
    const pts: Vector3[] = [];
    const y0 = GROUND_Y + 11.15;
    for (let x = -12.6; x <= 12.6 + 1e-6; x += 0.35) {
      const ph = ((x + 12.6) % 2.1) / 2.1;
      pts.push(new Vector3(x, y0 - Math.sin(ph * Math.PI) * 0.6, zf + 0.35));
    }
    const curve = new CatmullRomCurve3(pts, false, 'centripetal');
    this.group.add(new Mesh(new TubeGeometry(curve, pts.length * 2, 0.07, 6, false), this.keepM(new MeshStandardMaterial({ color: 0x1c6e3e, roughness: 0.95, emissive: new Color(0x0c3a1e), emissiveIntensity: 0.3 }))));
    const n = 64;
    const geo = new SphereGeometry(0.09, 8, 6);
    this.extraGeos.push(geo);
    const wb = new InstancedMesh(geo, this.keepM(new MeshBasicMaterial({ toneMapped: false })), n);
    const cols = [GOLD, RED, FROST, 0x7aff9a, 0xff7ad9];
    for (let i = 0; i < n; i++) {
      const p = curve.getPointAt((i + 0.5) / n);
      _m.compose(_p.set(p.x, p.y - 0.08, p.z + 0.02), _q.identity(), _s.setScalar(1));
      wb.setMatrixAt(i, _m);
      const base = new Color(cols[i % cols.length]).multiplyScalar(2.3);
      this.wallBulbBase.push(base);
      wb.setColorAt(i, base);
    }
    this.group.add(wb);
    this.wallBulbs = wb;
    // big glass baubles on gold threads (clear of the clock)
    const balls: BufferGeometry[] = [];
    const threads: BufferGeometry[] = [];
    const bcols = [0xd8162e, 0xe0b84c, 0x2a6fe8, 0x1f9a5a, 0xd8162e, 0x8a3ae0];
    [
      [-10.6, 8.6, 0.5],
      [-7.4, 9.4, 0.42],
      [-4.4, 9.9, 0.36],
      [4.4, 9.7, 0.38],
      [7.6, 9.1, 0.46],
      [10.4, 8.3, 0.52],
    ].forEach(([x, y, r], k) => {
      const yy = GROUND_Y + y;
      balls.push(tint(new SphereGeometry(r, 18, 14).translate(x, yy, zf + 0.6), bcols[k]));
      balls.push(tint(new CylinderGeometry(r * 0.28, r * 0.32, r * 0.3, 10).translate(x, yy + r * 1.02, zf + 0.6), 0xe0b84c));
      threads.push(new CylinderGeometry(0.012, 0.012, y0 - yy - r, 4).translate(x, (y0 + yy + r) / 2, zf + 0.6));
    });
    this.group.add(new Mesh(merge(balls), this.keepM(new MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 0.55, emissive: new Color(0x221a3a), emissiveIntensity: 0.4 }))));
    this.group.add(new Mesh(merge(threads), this.keepM(new MeshBasicMaterial({ color: 0xc49a3a }))));
    // twelve glowing points round the giant clock
    const cy = GROUND_Y + 7.0;
    const dots: BufferGeometry[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      dots.push(new SphereGeometry(k % 3 === 0 ? 0.16 : 0.11, 10, 8).translate(Math.sin(a) * 2.78, cy + Math.cos(a) * 2.78, zf + 0.16));
    }
    this.clockDots = this.keepM(new MeshBasicMaterial({ color: new Color(GOLD).multiplyScalar(2.2), toneMapped: false }));
    this.group.add(new Mesh(merge(dots), this.clockDots));
    // soft light pools on the fighting floor: warm gold under the floor clock, frost at the four corners (none on low)
    const tex = poolTexture();
    const pool = (x: number, z: number, size: number, col: number, base: number, ph: number, chime: boolean) => {
      const mat = this.keepM(new MeshBasicMaterial({ map: tex, color: new Color(col).multiplyScalar(base), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
      const m = new Mesh(new PlaneGeometry(size, size), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, FLOOR_TOP + 0.012, z);
      m.renderOrder = 1;
      this.group.add(m);
      this.pools.push({ mesh: m, mat, col, base, ph, chime });
    };
    pool(0, 0, 5.2, GOLD, 0.16, 0, true);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pool(sx * 3.4, sz * 5.1, 3.0, FROST, 0.1, sx + sz * 2, false);
  }

  /** The light pools on the floor are left out on the low preset. */
  override setQuality(low: boolean): void {
    super.setQuality(low);
    for (const p of this.pools) p.mesh.visible = !low;
  }

  private buildProps(): void {
    DEF.props.forEach((p, idx) => {
      if (p.kind === 'giftStack') {
        this.propMap[idx] = { k: 'gift', i: this.gifts.length };
        this.gifts.push(this.buildGiftStack(p.x, p.z, this.gifts.length));
      } else if (p.kind === 'snowLamp') {
        this.propMap[idx] = { k: 'lamp', i: this.lamps.length };
        this.lamps.push(this.buildLamp(p.x, p.z));
      } else if (p.kind === 'clockSign') {
        this.propMap[idx] = { k: 'clock' };
      }
    });
  }

  private buildGiftStack(x: number, z: number, n: number): GiftP {
    const y = landingY(x, z);
    const low = new Mesh(new BoxGeometry(0.5, 0.38, 0.5), this.keepM(new MeshStandardMaterial({ color: n % 2 ? 0x1f4fd8 : 0xc4122f, roughness: 0.5 })));
    low.position.set(x, y + 0.19, z);
    const top = new Mesh(new BoxGeometry(0.34, 0.28, 0.34), this.keepM(new MeshStandardMaterial({ color: 0xe0b84c, roughness: 0.4, metalness: 0.3 })));
    top.position.set(x, y + 0.52, z);
    top.rotation.y = 0.5;
    this.group.add(low, top);
    return { top, low, x, y, z, broken: false };
  }

  private buildLamp(x: number, z: number): LampP {
    const y = landingY(x, z);
    const post = new Mesh(new CylinderGeometry(0.04, 0.06, 1.3, 8), this.keepM(new MeshStandardMaterial({ color: 0xc49a3a, roughness: 0.35, metalness: 0.8 })));
    post.position.set(x, y + 0.65, z);
    const glow = this.keepM(new MeshBasicMaterial({ color: new Color(FROST).multiplyScalar(2), toneMapped: false, transparent: true, opacity: 0.92 }));
    const globe = new Mesh(new SphereGeometry(0.17, 14, 10), glow);
    globe.position.set(x, y + 1.42, z);
    this.group.add(post, globe);
    return { globe, glow, broken: false, flicker: 0 };
  }

  private buildLights(): void {
    const housing = this.keepM(new MeshStandardMaterial({ color: 0x161a2a, roughness: 0.4, metalness: 0.7 }));
    const spots: [number, number, number, number][] = [
      [-9, -6, FROST, 0.5],
      [9, -6, GOLD, -0.5],
      [-9, 4, RED, 0.6],
      [9, 4, FROST, -0.6],
    ];
    for (const [x, z, col, yaw] of spots) {
      const c = makeSpotCone(x, 11, z, col, yaw, housing, 0.2);
      this.group.add(c.pivot);
      this.cones.push(c);
    }
    // the truss along the sides of the set (never across it: the battle camera looks over it — see Alpha 1.7.6)
    const steel = this.keepM(new MeshStandardMaterial({ color: 0x2a2c3a, roughness: 0.4, metalness: 0.8 }));
    this.group.add(new Mesh(merge([new BoxGeometry(0.18, 0.18, 12).translate(-9, 11.5, -1), new BoxGeometry(0.18, 0.18, 12).translate(9, 11.5, -1)]), steel));
  }

  // ------------------------------------------------------------------ cover
  private buildCovers(): void {
    const models = { gift: giftModel(), snowgen: snowgenModel(), clocktower: clocktowerModel(), console: consoleModel() } as const;
    for (const md of Object.values(models)) this.extraGeos.push(md.remains, ...md.chunks.map((c) => c.geo));
    const looks3 = (mk: (st: number) => Material) => [0, 1, 2].map((st) => this.keepM(mk(st)));
    const giftLooks = PAPERS.map(([paper, dots], i) => looks3((st) => new MeshStandardMaterial({ map: giftTexture(paper, dots, st, 30 + i * 7), roughness: 0.55, color: new Color(1, 1, 1).multiplyScalar(1 - st * 0.12) })));
    const lidLooks = looks3((st) => new MeshStandardMaterial({ color: new Color(0xe0b84c).multiplyScalar(1 - st * 0.15), roughness: 0.35, metalness: 0.45 }));
    const snowLooks = looks3((st) => new MeshStandardMaterial({ color: new Color(0xdfe8f2).multiplyScalar(1 - st * 0.14), roughness: 0.4, metalness: 0.35, emissive: new Color(FROST), emissiveIntensity: st === 0 ? 0.22 : st === 1 ? 0.12 : 0.04 }));
    const towerLooks = looks3((st) => new MeshStandardMaterial({ color: new Color(0x6a1426).multiplyScalar(1 - st * 0.14), roughness: 0.5, metalness: 0.25, emissive: new Color(GOLD), emissiveIntensity: st === 0 ? 0.12 : 0.05 }));
    const faceLooks = looks3((st) => new MeshStandardMaterial({ map: clockFace(st), roughness: 0.4, emissive: new Color(1, 0.9, 0.7), emissiveMap: clockFace(st), emissiveIntensity: st === 0 ? 0.5 : st === 1 ? 0.32 : 0.14 }));
    const consoleLooks = looks3((st) => new MeshStandardMaterial({ color: new Color(0x18204a).multiplyScalar(1 - st * 0.12), roughness: 0.45, metalness: 0.4, emissive: new Color(FROST), emissiveIntensity: st === 0 ? 0.1 : 0.04 }));
    const screenLooks = looks3((st) => new MeshBasicMaterial({ map: consoleScreen(st), toneMapped: false, color: new Color(1, 1, 1).multiplyScalar(st === 0 ? 1.6 : st === 1 ? 1.1 : 0.6) }));
    const plinth = this.keepM(new MeshStandardMaterial({ color: 0x2a2c48, roughness: 0.8 }));
    let giftN = 0;
    COVERS.forEach((cv, i) => {
      const md = models[cv.kind as keyof typeof models];
      if (!md) return;
      const group = new Group();
      group.position.set(cv.x, FLOOR_TOP - 0.02, cv.z);
      group.rotation.y = cv.yaw ?? 0;
      const body = new Group();
      group.add(body);
      const remains = new Mesh(md.remains, plinth);
      remains.castShadow = true;
      remains.receiveShadow = true;
      group.add(remains);
      const looks: Material[][] = [];
      const view: CoverView = { kind: cv.kind, x: cv.x, z: cv.z, yaw: cv.yaw ?? 0, group, body, chunks: [], home: [], halves: [], remains, looks, stage: 0, shake: 0, hitCd: 0, lost: md.lost, phase: i * 1.3, puffT: 1 + i * 0.4 };
      md.chunks.forEach((ch, k) => {
        let lk: Material[];
        if (cv.kind === 'gift') lk = k === md.lost ? lidLooks : giftLooks[giftN % giftLooks.length];
        else if (cv.kind === 'snowgen') lk = snowLooks;
        else if (cv.kind === 'clocktower') lk = k === md.lost ? faceLooks : towerLooks;
        else lk = k === md.lost ? screenLooks : consoleLooks;
        const m = new Mesh(ch.geo, lk[0]);
        m.position.copy(ch.at);
        m.castShadow = true;
        body.add(m);
        view.chunks.push(m);
        view.home.push({ p: ch.at.clone(), q: new Quaternion() });
        view.halves.push(ch.half);
        looks.push(lk);
      });
      if (cv.kind === 'gift') giftN++;
      this.coverGroup.add(group);
      this.covers.push(view);
    });
  }

  private setCoverLook(v: CoverView, stage: number): void {
    const look = Math.min(2, stage);
    v.chunks.forEach((m, k) => (m.material = v.looks[k][look]));
    v.stage = stage;
  }

  private throwChunk(v: CoverView, i: number, vx: number, vy: number, vz: number, spin: number, size: 'medium' | 'large', vary: number): void {
    const m = v.chunks[i];
    if (!m.visible || m.parent !== v.body) return;
    this.group.attach(m);
    const shape: DebrisShape = { half: v.halves[i], surface: (x, z) => surfaceY(x, z, WALL_TOP + 0.05) };
    this.pieces.launch(m, [vx, vy, vz], [spin, spin * 0.6, spin * 0.4], shape, size, vary);
  }

  /** The hit colour of a piece: paper and gold for a gift, snow for a cannon, gold for a column, frost sparks for a console. */
  private hitColor(kind: ArenaCoverDef['kind']): number {
    return kind === 'gift' ? RED : kind === 'snowgen' ? 0xe8f6ff : kind === 'clocktower' ? GOLD : FROST;
  }

  override coverEvent(i: number, what: 'hit' | 'crack' | 'break', stage: number, x: number, z: number, dx: number, dz: number, heavy: boolean): void {
    const v = this.covers[i];
    if (!v) return;
    const vfx = this.vfx;
    const y = Math.min(COVER_TUNING[v.kind].height * 0.7, 1.05);
    v.shake = Math.max(v.shake, heavy ? 0.3 : 0.16);
    const col = this.hitColor(v.kind);
    if (vfx && (v.hitCd <= 0 || what !== 'hit')) {
      v.hitCd = 0.07;
      if (v.kind === 'snowgen') vfx.soft.spawn(x, y, z, -dx * 0.6, 0.5, -dz * 0.6, 0.7, 0.25, 0.8, _c.set(0xf2fbff), 1, 1.6, -0.2);
      vfx.burst(x, y, z, _c.set(col), heavy ? 12 : 5, heavy ? 4.5 : 2.8, 0.1, 0.32, 1.8, 6, 1);
      if (v.kind === 'gift') vfx.burst(x, y, z, _c.set(GOLD), heavy ? 8 : 3, 3, 0.08, 0.4, 1.6, 5, 1);
    }
    if (what === 'crack') {
      this.setCoverLook(v, stage);
      if (stage >= 2 && v.lost >= 0) this.throwChunk(v, v.lost, -dx * 1.4 + dz * 0.6, 2.4, -dz * 1.4 - dx * 0.6, 5, 'medium', 0.5);
      if (vfx) {
        vfx.dust(x, z, stage >= 2 ? 7 : 4, dx, dz);
        if (v.kind === 'console') vfx.burst(x, y, z, _c.set(FROST), 10, 4, 0.06, 0.25, 2.2, 8, 1);
        if (v.kind === 'clocktower') vfx.flash(x, y + 0.6, z, _c.set(GOLD), 0.35, 1.8, 0.2, 2);
      }
    } else if (what === 'break') this.shatter(v, x, z, dx, dz, heavy);
  }

  private shatter(v: CoverView, x: number, z: number, dx: number, dz: number, heavy: boolean): void {
    const vfx = this.vfx;
    this.setCoverLook(v, 3);
    const p = heavy ? 1.35 : 1;
    const n = v.chunks.length;
    for (let i = 0; i < n; i++) {
      const m = v.chunks[i];
      if (m.parent !== v.body) continue;
      m.getWorldPosition(_v);
      let ox = _v.x - v.x;
      let oz = _v.z - v.z;
      const ol = Math.hypot(ox, oz) || 1;
      ox /= ol;
      oz /= ol;
      const up = 1.5 + (_v.y - FLOOR_TOP) * 1.1;
      this.throwChunk(v, i, (ox * 1.4 + dx * 1.6) * p, up * p, (oz * 1.4 + dz * 1.6) * p, 3 + i, v.kind === 'gift' ? 'medium' : 'large', i / Math.max(1, n - 1));
    }
    v.remains.scale.set(1, 0.6, 1);
    if (vfx) {
      vfx.dust(v.x, v.z, 12, dx, dz);
      const col = this.hitColor(v.kind);
      vfx.burst(v.x, 0.9, v.z, _c.set(col), 26, 5, 0.12, 0.7, 2, -1, 1.4);
      if (v.kind === 'gift') {
        // a pop of confetti and gold ribbon bits
        for (const c of [RED, GOLD, FROST, 0x7aff9a]) vfx.burst(v.x, 0.8, v.z, _c.set(c), 10, 6, 0.08, 0.9, 2.6, 8, 2);
      } else if (v.kind === 'snowgen') {
        for (let k = 0; k < 6; k++) vfx.soft.spawn(v.x + (k - 3) * 0.15, 0.8, v.z, (k - 3) * 0.3, 0.9, 0, 1.2, 0.45, 1.6, _c.set(0xf2fbff), 1, 1.8, -0.15);
      } else if (v.kind === 'clocktower') {
        vfx.flash(v.x, 1.6, v.z, _c.set(GOLD), 0.7, 3.2, 0.25, 2.6);
        vfx.debrisBurst(v.x, 1.0, v.z, _c.set(0xc49a3a), 10);
      } else vfx.burst(v.x, 0.7, v.z, _c.set(FROST), 22, 6, 0.06, 0.4, 2.4, 10, 1);
    }
  }

  private resetCovers(): void {
    for (const v of this.covers) {
      for (let i = 0; i < v.chunks.length; i++) {
        const m = v.chunks[i];
        if (m.parent !== v.body) v.body.add(m);
        const h = v.home[i];
        m.position.copy(h.p);
        m.quaternion.copy(h.q);
        m.scale.set(1, 1, 1);
        m.visible = true;
      }
      v.remains.scale.set(1, 1, 1);
      v.body.position.set(0, 0, 0);
      v.shake = 0;
      v.hitCd = 0;
      this.setCoverLook(v, 0);
    }
  }

  override setMenu(menu: boolean): void {
    // the menu shows the fighter in the middle of the set: the cover waits for the fight
    this.coverGroup.visible = !menu;
  }

  override applyTheme(th: ArenaTheme, isDefault: boolean): void {
    colorCones(this.cones, isDefault || th.decor === 'frost' ? [FROST, GOLD, RED, FROST] : th.spots);
    const champ = th.decor === 'champion';
    this.signTex.dispose();
    this.signTex = champ ? drawNeon('CHAMPION · HOLIDAY', '#ffc23a', 1024, 256, 80) : drawNeon('HOLIDAY BROADCAST', '#7fe3ff', 1024, 256, 84);
    this.sign.map = this.signTex;
    this.sign.needsUpdate = true;
  }

  override setSpots(colors: number[]): void {
    colorCones(this.cones, colors);
  }

  // ---------------------------------------------------- barrier piece events
  propHit(i: number, _hp: number, heavy: boolean, x: number, z: number): void {
    const m = this.propMap[i];
    if (!m) return;
    const vfx = this.vfx;
    if (m.k === 'clock') {
      // the studio clock chimes: a gold flash on the face and a ring of light
      this.chime = 1;
      if (vfx) vfx.rays(0, GROUND_Y + 7.0, -15.0, _c.set(GOLD), 0.8, 3.6, 0.5, 2.2);
      return;
    }
    if (vfx) vfx.burst(x, 0.9, z, _c.set(m.k === 'lamp' ? FROST : GOLD), heavy ? 10 : 6, 3, 0.1, 0.4, 1.8, 2, 1);
  }

  propBreak(i: number, x: number, z: number): void {
    const m = this.propMap[i];
    if (!m) return;
    const vfx = this.vfx;
    if (m.k === 'gift') {
      const g = this.gifts[m.i];
      g.broken = true;
      g.low.scale.set(1, 0.5, 1);
      g.low.position.y = g.y + 0.1;
      this.pieces.launch(g.top, [-x * 0.25, 3.4, -z * 0.18], [6, 5, 4], landingY(g.x * 0.92, g.z * 0.92) + 0.14, 'medium', 0.5);
      if (vfx) for (const c of [RED, GOLD, FROST]) vfx.burst(x, 0.9, z, _c.set(c), 8, 5, 0.08, 0.7, 2.2, 8, 1.5);
    } else if (m.k === 'lamp') {
      const L = this.lamps[m.i];
      L.broken = true;
      L.flicker = 0.9;
      if (vfx) {
        L.globe.getWorldPosition(_v);
        vfx.burst(_v.x, _v.y, _v.z, _c.set(0xdff6ff), 18, 5, 0.08, 0.45, 2.4, 9, 1);
      }
    }
  }

  resetProps(): void {
    this.pieces.clear();
    for (const g of this.gifts) {
      g.broken = false;
      g.low.scale.set(1, 1, 1);
      g.low.position.set(g.x, g.y + 0.19, g.z);
      g.top.position.set(g.x, g.y + 0.52, g.z);
      g.top.rotation.set(0, 0.5, 0);
      g.top.visible = true;
    }
    for (const L of this.lamps) {
      L.broken = false;
      L.flicker = 0;
      L.glow.opacity = 0.92;
      L.globe.visible = true;
    }
    this.resetCovers();
    this.chime = 0;
  }

  // ---------------------------------------------------------------------- frame
  update(dt: number, ex: number, boost: number): void {
    this.time += dt;
    const t = this.time;
    const mo = this.motion;
    swingCones(this.cones, t, ex * 0.7, boost, mo * 0.6);
    // the clock: the second hand sweeps toward midnight; a chime flashes the halo
    this.secondHand.rotation.z = -((t * 0.105 * (0.4 + 0.6 * mo)) % (Math.PI * 2));
    this.chime = Math.max(0, this.chime - dt * 1.4);
    this.clockGlow.opacity = 0.28 + Math.sin(t * 1.2) * 0.05 + this.chime * 0.6 + boost * 0.15;
    this.sign.color.setScalar(1.45 + boost * 0.5 + Math.sin(t * 2.1) * 0.06);
    // the garland twinkles (a few bulbs per frame; still with reduced motion)
    const b = this.bulbs;
    if (b && mo > 0.2) {
      const n = b.count;
      for (let k = 0; k < 6; k++) {
        const i = Math.floor((t * 37 + k * 97) % n);
        const on = Math.sin(t * 5 + i) > -0.2;
        b.setColorAt(i, _c.copy(this.bulbBase[i]).multiplyScalar(on ? 1 + ex * 0.4 : 0.35));
      }
      if (b.instanceColor) b.instanceColor.needsUpdate = true;
    }
    const wb = this.wallBulbs;
    if (wb && mo > 0.2) {
      const n = wb.count;
      for (let k = 0; k < 3; k++) {
        const i = Math.floor((t * 23 + k * 41) % n);
        const on = Math.sin(t * 4 + i * 1.7) > -0.25;
        wb.setColorAt(i, _c.copy(this.wallBulbBase[i]).multiplyScalar(on ? 1 + ex * 0.3 : 0.3));
      }
      if (wb.instanceColor) wb.instanceColor.needsUpdate = true;
    }
    // the magic minute: the points round the clock breathe, a chime makes them flare
    this.clockDots.color.setHex(GOLD).multiplyScalar(1.7 + Math.sin(t * 1.6) * 0.35 * mo + this.chime * 1.6 + boost * 0.4);
    for (const p of this.pools) p.mat.color.setHex(p.col).multiplyScalar(p.base * (1 + Math.sin(t * 0.9 + p.ph) * 0.25 * mo + (p.chime ? this.chime * 0.8 : 0)));
    for (const l of this.lanterns) l.color.setHex(0xffd27a).multiplyScalar(1.8 + Math.sin(t * 7.3) * 0.08 * mo + Math.sin(t * 3.1) * 0.06 * mo);
    this.treeLights.forEach((m, k) => m.color.setHex(k % 3 === 0 ? RED : k % 3 === 1 ? GOLD : FROST).multiplyScalar(1.8 + Math.sin(t * (1.6 + k * 0.3) + k) * 0.6 * mo));
    for (const L of this.lamps) {
      if (!L.broken) {
        L.glow.opacity = 0.85 + Math.sin(t * 3 + L.globe.id) * 0.07;
        continue;
      }
      L.flicker = Math.max(0, L.flicker - dt);
      const on = L.flicker > 0 && Math.sin(t * (mo > 0.5 ? 50 : 6)) > 0;
      L.glow.opacity = on ? 0.9 : 0.1;
    }
    this.updateCovers(dt, t);
    if (this.pieces.busy) this.pieces.update(this.debrisFrozen ? 0 : dt);
  }

  private updateCovers(dt: number, t: number): void {
    const step = this.debrisFrozen ? 0 : dt;
    const vfx = this.vfx;
    for (const v of this.covers) {
      v.hitCd = Math.max(0, v.hitCd - dt);
      if (v.stage >= 3) continue;
      if (v.shake > 0) {
        v.shake = Math.max(0, v.shake - step);
        const a = v.shake * 0.06 * (0.25 + 0.75 * this.motion);
        v.body.position.set(Math.sin(t * 71 + v.phase) * a, 0, Math.cos(t * 63 + v.phase) * a * 0.6);
        if (v.shake === 0) v.body.position.set(0, 0, 0);
      }
      // a snow cannon puffs a little snow now and then (none on the low preset or with reduced motion)
      if (v.kind === 'snowgen' && vfx && !this.low && this.motion > 0.5 && v.stage < 2) {
        v.puffT -= step;
        if (v.puffT <= 0) {
          v.puffT = 2.2 + (v.phase % 1.3);
          const fx = Math.sin(v.yaw) * 0.3;
          vfx.soft.spawn(v.x + fx, 1.5, v.z + 0.3, 0, 0.7, 0.5, 0.9, 0.22, 0.9, _c.set(0xf6fcff), 1, 1.2, -0.12);
        }
      }
    }
  }

  override dispose(): void {
    super.dispose();
    for (const g of this.extraGeos) g.dispose();
    for (const m of this.extraMats) {
      const mm = m as Material & { map?: { dispose(): void } | null; emissiveMap?: { dispose(): void } | null };
      mm.map?.dispose();
      mm.emissiveMap?.dispose();
      m.dispose();
    }
  }
}
