import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CircleGeometry,
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
  Vector3,
  type Material,
} from 'three';
import { arenaById, type ArenaCoverDef } from '../../config/arenas.config';
import { ARENA, COVER_TUNING } from '../../config/balance';
import type { ArenaTheme } from '../../config/themes.config';
import { Rng } from '../../core/math';
import { canvasTexture } from '../textures';
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
  mergeStatic,
  neonMaterial,
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

// Alpha 1.9.8 — NEON NEWSROOM, a permanent set: a big, expensive retro-futuristic TV newsroom of PRIME TIME turned
// into a fighting floor. A glossy navy LED floor with a glowing cyan grid and a wireframe news globe in the middle; a
// dark barrier with a cyan light strip and the live LED tickers; behind the north barrier the anchor desk, two studio
// cameras on pedestals and the giant LED video wall — the live picture in the middle, BREAKING NEWS and the world feed
// on the angled side panels, LED tile columns, the scrolling news ticker and the NEON NEWSROOM sign; signal panels on
// the side walls; the moving spotlights hang from trusses ALONG the sides (never across the set — the iPhone lesson of
// STUDIO BACKLOT, see occlusionProbe). Palette: deep blue, cyan and violet, small red (LIVE, BREAKING, tally lights) and
// warm accents (the desk's top light, the key light).
//
// The cover on the floor is the GRAVEYARD system (src/combat/Covers.ts): every piece is round or a capsule exactly like
// its collision body — anchor-desk segments (capsules), mobile tech panels on wheels (narrow capsules), octagonal
// equipment racks and studio camera pedestals (round) — pre-split into chunks that crack, lose a part and fly as
// debris; what is left on the floor is a low base that stops nothing (the simulation removes the body at 0 hp).
//
// Mobile budget: static pieces sharing a material are merged (mergeStatic), repeated small parts are instanced, the
// animated screens are cheap (a texture offset for the ticker, a few LED tiles recoloured per frame — none on the low
// preset or with reduced motion), no extra lights (the renderer's lights are recoloured by `lighting`).

const DEF = arenaById('newsroom');
const COVERS: readonly ArenaCoverDef[] = DEF.covers ?? [];
const CYAN = 0x3ae6ff;
const VIOLET = 0x8a4dff;
const RED = 0xff2f55;
const WARM = 0xffb45a;
const _c = new Color();
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _v = new Vector3();
/** The north studio wall (z of the LED video wall). */
const ZF = -15.4;

/**
 * Alpha 1.9.9 — where the studio kit stands (NewsroomStage.buildStudioKit): all of it outside the barrier (|x| > 5.75 on
 * the sides, z < −7.75 behind the far barrier) and low or behind the fight, so the battle camera sees over it.
 */
export const NEWSROOM_KIT = {
  guide: { x: [6.55, 6.95], z: -2.5, len: 20 },
  pars: { x: [-4.8, -3.2, -1.6, 1.6, 3.2, 4.8], z: -8.75 },
  arch: { r: 6.0, z: -12.9 },
  jib: { x: 8.6, z: -3.0, post: 1.5, arm: 1.6, lift: 0.3 },
  softboxes: { x: 7.55, z: [2.6, -6.6], h: 1.9 },
  cart: { x: 7.35, z: 0.2 },
} as const;

// ------------------------------------------------------------------ textures
function drawFloor(): { map: CanvasTexture; emissive: CanvasTexture } {
  const { c, g, e, eg, X, Y, ppu, W, H } = floorCanvas(1024);
  // deep studio navy, a little brighter in the middle (where the fight is)
  const gr = g.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.9);
  gr.addColorStop(0, '#1d2c86');
  gr.addColorStop(0.4, '#121c62');
  gr.addColorStop(0.8, '#0b1244');
  gr.addColorStop(1, '#070b2c');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  // LED floor tiles: 1 m squares, a few a little brighter or darker (a real LED floor is never even)
  const rng = new Rng(4040);
  const tile = 1.0 * ppu;
  for (let x = W / 2 - tile * 12; x < W; x += tile)
    for (let y = H / 2 - tile * 16; y < H; y += tile) {
      const r = rng.next();
      if (r < 0.12) g.fillStyle = 'rgba(80,200,255,0.05)';
      else if (r < 0.2) g.fillStyle = 'rgba(0,0,20,0.18)';
      else continue;
      g.fillRect(x, y, tile, tile);
    }
  g.strokeStyle = 'rgba(90,210,255,0.12)';
  g.lineWidth = 2;
  for (let x = W / 2 - tile * 12; x < W; x += tile) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  for (let y = H / 2 - tile * 16; y < H; y += tile) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  // the half-way line: a thin red broadcast line with a cyan glow either side
  const cz = Y(0);
  for (const ctx of [g, eg]) {
    ctx.fillStyle = 'rgba(58,230,255,0.55)';
    ctx.fillRect(X(-ARENA.halfX - 0.2), cz - 7, X(ARENA.halfX + 0.2) - X(-ARENA.halfX - 0.2), 2);
    ctx.fillRect(X(-ARENA.halfX - 0.2), cz + 5, X(ARENA.halfX + 0.2) - X(-ARENA.halfX - 0.2), 2);
    ctx.fillStyle = '#ff2f55';
    ctx.fillRect(X(-ARENA.halfX - 0.2), cz - 2, X(ARENA.halfX + 0.2) - X(-ARENA.halfX - 0.2), 4);
  }
  // the edge: cyan light line outside, violet line inside (both glow)
  const lines: [number, number, number, number, string][] = [
    [ARENA.halfX + 0.28, ARENA.halfZ + 0.28, ARENA.cornerRadius + 0.28, 6, '#3ae6ff'],
    [ARENA.halfX - 0.2, ARENA.halfZ - 0.2, ARENA.cornerRadius - 0.2, 3, '#a87aff'],
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
  // a soft violet frame between the two lines
  g.beginPath();
  insetPath(g, X, Y, ppu, ARENA.halfX + 0.04, ARENA.halfZ + 0.04, ARENA.cornerRadius + 0.04);
  g.closePath();
  g.strokeStyle = 'rgba(120,80,255,0.22)';
  g.lineWidth = 0.32 * ppu;
  g.stroke();
  // the centre: the PRIME NEWS globe — a cyan glow, a wireframe globe, a violet broadcast-clock ring with 60 ticks
  const cx = X(0);
  const fg = g.createRadialGradient(cx, cz, 0, cx, cz, 2.6 * ppu);
  fg.addColorStop(0, 'rgba(58,230,255,0.24)');
  fg.addColorStop(0.6, 'rgba(110,80,255,0.10)');
  fg.addColorStop(1, 'rgba(58,230,255,0)');
  g.fillStyle = fg;
  g.fillRect(0, 0, W, H);
  const R = 1.55 * ppu;
  for (const ctx of [g, eg]) {
    ctx.strokeStyle = ctx === g ? 'rgba(120,235,255,0.9)' : 'rgba(58,230,255,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cz, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    // meridians (ellipses) and parallels (chords)
    for (const k of [0.25, 0.55, 0.82]) {
      ctx.beginPath();
      ctx.ellipse(cx, cz, R * k, R, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx, cz - R);
    ctx.lineTo(cx, cz + R);
    ctx.stroke();
    for (const k of [-0.66, -0.33, 0, 0.33, 0.66]) {
      const yy = cz + R * k;
      const hw = R * Math.sqrt(1 - k * k);
      ctx.beginPath();
      ctx.moveTo(cx - hw, yy);
      ctx.lineTo(cx + hw, yy);
      ctx.stroke();
    }
    // the broadcast clock ring
    ctx.strokeStyle = '#a87aff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cz, 2.1 * ppu, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = 'round';
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      const big = k % 5 === 0;
      const r0 = (big ? 2.18 : 2.22) * ppu;
      const r1 = 2.36 * ppu;
      ctx.lineWidth = big ? 5 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cz + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cz + Math.sin(a) * r1);
      ctx.stroke();
    }
    // four red marks at the quarter hours (the LIVE accent)
    ctx.fillStyle = '#ff2f55';
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * 2.52 * ppu, cz + Math.sin(a) * 2.52 * ppu, 0.07 * ppu, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // glowing «cities» on the globe
  for (let k = 0; k < 26; k++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * R * 0.92;
    for (const ctx of [g, eg]) {
      ctx.fillStyle = ctx === g ? 'rgba(220,250,255,0.9)' : 'rgba(150,240,255,0.9)';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cz + Math.sin(a) * r, rng.range(2, 4), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // NEON NEWSROOM written at both ends (read from the battle camera), a violet glow behind the letters
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const z of [-5.35, 5.35]) {
    const ty = Y(z);
    g.font = `italic 900 ${Math.round(0.5 * ppu)}px Unbounded, "Arial Black", sans-serif`;
    g.fillStyle = 'rgba(120,80,255,0.35)';
    g.fillText('NEON NEWSROOM', cx + 3, ty + 3);
    g.fillStyle = 'rgba(160,236,255,0.55)';
    g.fillText('NEON NEWSROOM', cx, ty);
    eg.font = g.font;
    eg.textAlign = 'center';
    eg.textBaseline = 'middle';
    eg.fillStyle = 'rgba(58,200,255,0.35)';
    eg.fillText('NEON NEWSROOM', cx, ty);
  }
  return { map: canvasTexture(c), emissive: canvasTexture(e) };
}

/** A crack pattern over a screen or a panel (more for the later looks). */
function paintCracks(g: CanvasRenderingContext2D, w: number, h: number, stage: number, seed: number, color: string): void {
  if (stage <= 0) return;
  const rng = new Rng(seed);
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (let k = 0; k < stage * 3; k++) {
    let x = rng.range(0.15, 0.85) * w;
    let y = rng.range(0.15, 0.85) * h;
    g.lineWidth = rng.range(1.5, 3);
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += rng.range(-0.12, 0.12) * w;
      y += rng.range(-0.15, 0.15) * h;
      g.lineTo(x, y);
    }
    g.stroke();
  }
}

/**
 * A studio monitor / tech-panel screen (`stage` 0–2 for the cover's looks, 3 = dead). The outer 6 % is the dark bezel:
 * a box's other faces are mapped onto its corner (see screenBox).
 */
function screenTexture(stage: number, variant: number): CanvasTexture {
  return paintTexture(256, 160, (g, w, h) => {
    g.fillStyle = '#05071a';
    g.fillRect(0, 0, w, h);
    const b = Math.round(w * 0.06);
    if (stage >= 3) {
      g.fillStyle = '#020309';
      g.fillRect(b, b, w - 2 * b, h - 2 * b);
      paintCracks(g, w, h, 3, 900 + variant, 'rgba(120,140,180,0.55)');
      return;
    }
    const dim = stage === 0 ? 1 : stage === 1 ? 0.75 : 0.45;
    const sg = g.createLinearGradient(0, b, 0, h - b);
    sg.addColorStop(0, `rgba(20,40,${Math.round(140 * dim)},1)`);
    sg.addColorStop(1, `rgba(8,12,${Math.round(60 * dim)},1)`);
    g.fillStyle = sg;
    g.fillRect(b, b, w - 2 * b, h - 2 * b);
    if (variant % 2 === 0) {
      // the LIVE bug and signal bars
      g.fillStyle = stage >= 2 ? '#5a2030' : '#ff2f55';
      g.fillRect(b + 8, b + 8, 62, 26);
      g.font = '900 20px Unbounded, "Arial Black", sans-serif';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffffff';
      g.fillText('LIVE', b + 14, b + 22);
      for (let k = 0; k < 6; k++) {
        g.fillStyle = k < 6 - stage * 2 ? `rgba(58,230,255,${0.9 * dim})` : 'rgba(58,230,255,0.15)';
        const bh = 12 + k * 10;
        g.fillRect(w - b - 90 + k * 14, h - b - 14 - bh, 9, bh);
      }
      g.strokeStyle = `rgba(168,122,255,${0.9 * dim})`;
      g.lineWidth = 3;
      g.beginPath();
      for (let x = b + 8; x < w - b - 100; x += 4) {
        const y = h * 0.62 + Math.sin(x * 0.11) * 14 * Math.sin(x * 0.023);
        if (x === b + 8) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    } else {
      // test-card colour bars and a PRIME NEWS strap
      const cols = ['#e8e8f0', '#e8e04a', '#3ae6ff', '#4ae86a', '#d84af0', '#ff2f55', '#3a5aff'];
      const bw = (w - 2 * b) / cols.length;
      cols.forEach((col, i) => {
        g.globalAlpha = dim;
        g.fillStyle = col;
        g.fillRect(b + i * bw, b, bw + 1, (h - 2 * b) * 0.62);
      });
      g.globalAlpha = 1;
      g.fillStyle = '#0a1040';
      g.fillRect(b, b + (h - 2 * b) * 0.62, w - 2 * b, (h - 2 * b) * 0.38);
      g.fillStyle = `rgba(58,230,255,${dim})`;
      g.font = 'italic 900 22px Unbounded, "Arial Black", sans-serif';
      g.textBaseline = 'middle';
      g.fillText('PRIME NEWS', b + 10, b + (h - 2 * b) * 0.81);
    }
    if (stage >= 1) {
      g.fillStyle = 'rgba(127,227,255,0.18)';
      for (let y = b; y < h - b; y += 7) g.fillRect(b, y, w - 2 * b, 2);
    }
    paintCracks(g, w, h, stage, 300 + variant * 17, 'rgba(210,230,255,0.7)');
  });
}

/** BREAKING NEWS on the left LED panel. */
function breakingTexture(): CanvasTexture {
  return paintTexture(512, 320, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#101a5a');
    gr.addColorStop(1, '#2a0f5a');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff2f55';
    g.fillRect(0, 34, w, 74);
    g.fillStyle = '#ffffff';
    g.font = 'italic 900 52px Unbounded, "Arial Black", sans-serif';
    g.textBaseline = 'middle';
    g.fillText('BREAKING', 24, 73);
    g.fillStyle = '#0a0f2c';
    g.fillRect(0, 108, w, 46);
    g.fillStyle = '#3ae6ff';
    g.font = 'italic 900 34px Unbounded, "Arial Black", sans-serif';
    g.fillText('NEWS · PRIME TIME', 24, 132);
    // headline lines and a lower third
    g.fillStyle = 'rgba(220,235,255,0.85)';
    for (const [y, len] of [
      [188, 0.86],
      [214, 0.7],
      [240, 0.78],
    ] as [number, number][])
      g.fillRect(24, y, (w - 48) * len, 12);
    g.fillStyle = '#ffb45a';
    g.fillRect(24, 272, 120, 24);
    g.fillStyle = '#0a0f2c';
    g.font = '900 16px Unbounded, "Arial Black", sans-serif';
    g.fillText('SHOWDOWN', 32, 285);
    g.strokeStyle = 'rgba(58,230,255,0.6)';
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 4, h - 4);
  });
}

/** The world feed on the right LED panel: a wireframe globe with signal arcs and a LIVE bug. */
function worldTexture(): CanvasTexture {
  return paintTexture(512, 320, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#0a1652');
    gr.addColorStop(1, '#170a46');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    const cx = w * 0.42;
    const cy = h * 0.56;
    const R = h * 0.36;
    g.strokeStyle = 'rgba(58,230,255,0.85)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1.5;
    for (const k of [0.3, 0.62, 0.88]) {
      g.beginPath();
      g.ellipse(cx, cy, R * k, R, 0, 0, Math.PI * 2);
      g.stroke();
    }
    for (const k of [-0.6, -0.3, 0, 0.3, 0.6]) {
      const hw = R * Math.sqrt(1 - k * k);
      g.beginPath();
      g.moveTo(cx - hw, cy + R * k);
      g.lineTo(cx + hw, cy + R * k);
      g.stroke();
    }
    // signal arcs between glowing points
    const rng = new Rng(77);
    const pts: [number, number][] = [];
    for (let k = 0; k < 7; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * R * 0.9;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    g.strokeStyle = 'rgba(255,180,90,0.85)';
    g.lineWidth = 2;
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[0];
      const [x1, y1] = pts[k];
      g.beginPath();
      g.moveTo(x0, y0);
      g.quadraticCurveTo((x0 + x1) / 2, Math.min(y0, y1) - 40, x1, y1);
      g.stroke();
    }
    for (const [x, y] of pts) {
      g.fillStyle = '#e8fbff';
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ff2f55';
    g.fillRect(w - 150, 22, 128, 40);
    g.fillStyle = '#ffffff';
    g.font = '900 26px Unbounded, "Arial Black", sans-serif';
    g.textBaseline = 'middle';
    g.fillText('● LIVE', w - 140, 43);
    g.fillStyle = '#a87aff';
    g.font = 'italic 900 22px Unbounded, "Arial Black", sans-serif';
    g.fillText('WORLD FEED', w - 190, h - 34);
    g.strokeStyle = 'rgba(168,122,255,0.6)';
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 4, h - 4);
  });
}

/** The news ticker under the video wall (repeats along the band; scrolled by a texture offset). */
function tickerTexture(): CanvasTexture {
  const tex = paintTexture(2048, 64, (g, w, h) => {
    g.fillStyle = '#0a0f36';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(58,230,255,0.25)';
    g.fillRect(0, 0, w, 3);
    g.fillRect(0, h - 3, w, 3);
    g.font = 'italic 900 34px Unbounded, "Arial Black", sans-serif';
    g.textBaseline = 'middle';
    const items = ['PRIME TIME SHOWDOWN — LIVE FROM THE NEON NEWSROOM', 'BREAKING: THE ARENA IS ON AIR', 'PRIME LEAGUE TONIGHT', 'STAY TUNED — NEXT FIGHT AFTER THE BREAK'];
    let x = 24;
    for (const t of items) {
      g.fillStyle = '#ff2f55';
      g.beginPath();
      g.arc(x + 8, h / 2, 8, 0, Math.PI * 2);
      g.fill();
      x += 28;
      g.fillStyle = '#e8f6ff';
      g.fillText(t, x, h / 2 + 2);
      x += g.measureText(t).width + 40;
    }
  });
  tex.wrapS = RepeatWrapping;
  return tex;
}

/** The back wall: a deep blue-violet studio wall with soft light bands and a faint hexagon grid. */
function wallTexture(): CanvasTexture {
  return paintTexture(1024, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#04061a');
    gr.addColorStop(0.5, '#0d1450');
    gr.addColorStop(1, '#1a0f48');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(90,160,255,0.08)';
    g.lineWidth = 1.5;
    const s = 22;
    for (let y = 0; y < h + s; y += s * 1.5)
      for (let x = 0; x < w + s; x += s * Math.sqrt(3)) {
        const ox = (Math.round(y / (s * 1.5)) % 2) * ((s * Math.sqrt(3)) / 2);
        g.beginPath();
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const px = x + ox + Math.cos(a) * s * 0.92;
          const py = y + Math.sin(a) * s * 0.92;
          if (k === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.stroke();
      }
    for (const [y0, col] of [
      [0.18, 'rgba(58,230,255,0.10)'],
      [0.82, 'rgba(138,77,255,0.14)'],
    ] as [number, string][]) {
      g.fillStyle = col;
      g.fillRect(0, h * y0 - 10, w, 20);
    }
  });
}

/** A vertical signal panel for the side walls: ON AIR or the signal meters. */
function sidePanelTexture(kind: 'onair' | 'signal'): CanvasTexture {
  return paintTexture(256, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#0b1240');
    gr.addColorStop(1, '#1c0c44');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = kind === 'onair' ? 'rgba(255,47,85,0.8)' : 'rgba(58,230,255,0.8)';
    g.lineWidth = 6;
    g.strokeRect(6, 6, w - 12, h - 12);
    if (kind === 'onair') {
      g.fillStyle = '#ff2f55';
      g.fillRect(28, 40, w - 56, 120);
      g.fillStyle = '#ffffff';
      g.font = '900 60px Unbounded, "Arial Black", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('ON', w / 2, 76);
      g.fillText('AIR', w / 2, 128);
      g.fillStyle = 'rgba(232,246,255,0.8)';
      for (let k = 0; k < 7; k++) g.fillRect(40, 210 + k * 38, (w - 80) * (0.5 + ((k * 37) % 50) / 100), 12);
      g.fillStyle = '#ffb45a';
      g.fillRect(40, h - 70, w - 80, 26);
    } else {
      g.font = 'italic 900 34px Unbounded, "Arial Black", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#3ae6ff';
      g.fillText('SIGNAL', w / 2, 56);
      for (let k = 0; k < 8; k++) {
        const y = 110 + k * 44;
        const v = 0.35 + ((k * 53) % 60) / 100;
        g.fillStyle = 'rgba(58,230,255,0.15)';
        g.fillRect(36, y, w - 72, 24);
        g.fillStyle = k % 3 === 2 ? '#a87aff' : '#3ae6ff';
        g.fillRect(36, y, (w - 72) * v, 24);
      }
    }
  });
}

/** The anchor desk's front logo. */
function deskLogoTexture(): CanvasTexture {
  return paintTexture(512, 128, (g, w, h) => {
    g.fillStyle = '#070a26';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff2f55';
    g.fillRect(0, h - 16, w, 8);
    g.font = 'italic 900 70px Unbounded, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#3ae6ff';
    g.fillText('PRIME NEWS', w / 2, h / 2 - 6);
  });
}

/** LED dots for the equipment racks behind the set. */
function rackTexture(): CanvasTexture {
  return paintTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#0a0d22';
    g.fillRect(0, 0, w, h);
    const rng = new Rng(19);
    for (let y = 10; y < h - 10; y += 14) {
      g.fillStyle = '#151a3a';
      g.fillRect(8, y, w - 16, 10);
      for (let x = 14; x < w - 14; x += 10) {
        const r = rng.next();
        if (r > 0.6) continue;
        g.fillStyle = r < 0.1 ? '#ff2f55' : r < 0.35 ? '#3ae6ff' : '#4ae86a';
        g.fillRect(x, y + 3, 4, 4);
      }
    }
  });
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

/** 1.9.8 polish: the anchor desk's front — the PRIME NEWS globe mark, the name and a red LIVE line (looks 0–2). */
function deskFrontTexture(stage: number): CanvasTexture {
  return paintTexture(512, 160, (g, w, h) => {
    const dim = stage === 0 ? 1 : stage === 1 ? 0.78 : 0.5;
    g.fillStyle = '#05071a';
    g.fillRect(0, 0, w, h);
    const b = Math.round(w * 0.025);
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, `rgba(16,26,${Math.round(96 * dim)},1)`);
    gr.addColorStop(0.5, `rgba(24,40,${Math.round(130 * dim)},1)`);
    gr.addColorStop(1, `rgba(16,26,${Math.round(96 * dim)},1)`);
    g.fillStyle = gr;
    g.fillRect(b, b, w - 2 * b, h - 2 * b);
    // the globe mark
    const cx = 92;
    const cy = h / 2 - 6;
    const R = 38;
    g.strokeStyle = `rgba(58,230,255,${0.95 * dim})`;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2.5;
    for (const k of [0.35, 0.75]) {
      g.beginPath();
      g.ellipse(cx, cy, R * k, R, 0, 0, Math.PI * 2);
      g.stroke();
    }
    for (const k of [-0.5, 0, 0.5]) {
      const hw = R * Math.sqrt(1 - k * k);
      g.beginPath();
      g.moveTo(cx - hw, cy + R * k);
      g.lineTo(cx + hw, cy + R * k);
      g.stroke();
    }
    // (sized to fit: «PRIME NEWS» ends before the right edge of the panel at any font fallback)
    let px = 50;
    g.font = `italic 900 ${px}px Unbounded, "Arial Black", sans-serif`;
    while (px > 30 && g.measureText('PRIME NEWS').width > w - 150 - b - 18) g.font = `italic 900 ${(px -= 2)}px Unbounded, "Arial Black", sans-serif`;
    g.textBaseline = 'middle';
    g.fillStyle = `rgba(240,248,255,${dim})`;
    g.fillText('PRIME', 150, cy - 2);
    g.fillStyle = `rgba(58,230,255,${dim})`;
    g.fillText('NEWS', 150 + g.measureText('PRIME ').width, cy - 2);
    g.fillStyle = stage >= 2 ? '#5a2030' : '#ff2f55';
    g.fillRect(150, h - 40, w - 150 - b - 14, 8);
    g.fillStyle = `rgba(200,220,255,${0.7 * dim})`;
    g.font = '800 18px Unbounded, "Arial Black", sans-serif';
    g.fillText('LIVE · BREAKING SHOWDOWN', 152, h - 18);
    paintCracks(g, w, h, stage, 512, 'rgba(210,230,255,0.7)');
  });
}

/** 1.9.8 polish: a studio control strip — rows of lit buttons, faders and a small VU meter (looks 0–2). */
function controlTexture(stage: number): CanvasTexture {
  return paintTexture(256, 112, (g, w, h) => {
    const dim = stage === 0 ? 1 : stage === 1 ? 0.75 : 0.45;
    g.fillStyle = '#05071a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#10163a';
    g.fillRect(6, 6, w - 12, h - 12);
    const cols = ['#3ae6ff', '#a87aff', '#ff2f55', '#ffb45a', '#4ae86a'];
    for (let r = 0; r < 2; r++)
      for (let k = 0; k < 8; k++) {
        g.globalAlpha = (k + r) % 3 === 0 ? dim : 0.35 * dim;
        g.fillStyle = cols[(k + r * 3) % cols.length];
        g.fillRect(14 + k * 15, 16 + r * 18, 10, 9);
      }
    g.globalAlpha = 1;
    for (let k = 0; k < 6; k++) {
      g.fillStyle = '#05071a';
      g.fillRect(150 + k * 15, 14, 5, h - 30);
      g.fillStyle = `rgba(220,230,255,${dim})`;
      g.fillRect(146 + k * 15, 22 + ((k * 23) % 44), 13, 7);
    }
    for (let k = 0; k < 10; k++) {
      g.fillStyle = k < 7 ? `rgba(74,232,106,${dim})` : k < 9 ? `rgba(255,180,90,${dim})` : `rgba(255,47,85,${dim})`;
      g.fillRect(14 + k * 12, h - 34, 9, 16);
    }
    paintCracks(g, w, h, stage, 77, 'rgba(210,230,255,0.6)');
  });
}

/** 1.9.8 polish: the equipment rack's tall LIVE FEED screen (looks 0–2). */
function feedTexture(stage: number): CanvasTexture {
  return paintTexture(160, 256, (g, w, h) => {
    const dim = stage === 0 ? 1 : stage === 1 ? 0.75 : 0.45;
    g.fillStyle = '#04061a';
    g.fillRect(0, 0, w, h);
    const sg = g.createLinearGradient(0, 0, 0, h);
    sg.addColorStop(0, `rgba(22,36,${Math.round(130 * dim)},1)`);
    sg.addColorStop(1, `rgba(30,14,${Math.round(90 * dim)},1)`);
    g.fillStyle = sg;
    g.fillRect(6, 6, w - 12, h - 12);
    g.fillStyle = stage >= 2 ? '#5a2030' : '#ff2f55';
    g.fillRect(6, 6, w - 12, 30);
    g.fillStyle = '#ffffff';
    g.font = '900 18px Unbounded, "Arial Black", sans-serif';
    g.textBaseline = 'middle';
    g.fillText('● LIVE FEED', 14, 22);
    // a small globe and signal bars
    g.strokeStyle = `rgba(58,230,255,${0.9 * dim})`;
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(w / 2, 88, 30, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.ellipse(w / 2, 88, 12, 30, 0, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(w / 2 - 30, 88);
    g.lineTo(w / 2 + 30, 88);
    g.stroke();
    for (let k = 0; k < 6; k++) {
      g.fillStyle = k < 6 - stage * 2 ? `rgba(58,230,255,${0.9 * dim})` : 'rgba(58,230,255,0.15)';
      const bh = 10 + k * 7;
      g.fillRect(24 + k * 19, 176 - bh, 12, bh);
    }
    g.strokeStyle = `rgba(168,122,255,${0.9 * dim})`;
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 14; x < w - 14; x += 3) {
      const y = 214 + Math.sin(x * 0.17) * 12 * Math.sin(x * 0.041 + 1);
      if (x === 14) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    paintCracks(g, w, h, stage, 160, 'rgba(210,230,255,0.6)');
  });
}

/** 1.9.8 polish: rack units under the screen — vents and small status LEDs (looks 0–2). */
function unitsTexture(stage: number): CanvasTexture {
  return paintTexture(160, 192, (g, w, h) => {
    const dim = stage === 0 ? 1 : stage === 1 ? 0.7 : 0.4;
    g.fillStyle = '#070a1e';
    g.fillRect(0, 0, w, h);
    const rng = new Rng(29 + stage);
    for (let y = 8; y < h - 8; y += 30) {
      g.fillStyle = '#141a3a';
      g.fillRect(8, y, w - 16, 24);
      g.fillStyle = '#0a0d24';
      for (let x = 16; x < 90; x += 8) g.fillRect(x, y + 6, 4, 12);
      for (let k = 0; k < 4; k++) {
        const r = rng.next();
        g.fillStyle = r < 0.15 ? `rgba(255,47,85,${dim})` : r < 0.6 ? `rgba(58,230,255,${dim})` : `rgba(74,232,106,${dim})`;
        g.fillRect(100 + k * 12, y + 9, 6, 6);
      }
    }
    paintCracks(g, w, h, stage, 192, 'rgba(210,230,255,0.5)');
  });
}

/** A box whose +z face shows the whole texture and every other face its dark corner (one material, one draw). */
function screenBox(w: number, h: number, d: number): BoxGeometry {
  const g = new BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry faces: +x, −x, +y, −y, +z, −z — 4 vertices each; only the +z face keeps its UVs
  for (let i = 0; i < uv.count; i++) if (i < 16 || i >= 20) uv.setXY(i, 0.01, 0.01);
  uv.needsUpdate = true;
  return g;
}

// ------------------------------------------------------------------ cover chunks
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

/** Half of a regular prism (`front`: the +z half) of circumradius r with `sides` sides, from y0 to y0 + h. */
function halfPrism(r: number, sides: number, y0: number, h: number, front: boolean): BufferGeometry {
  const s = new Shape();
  const n = sides / 2;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = flatExtrude(s, h);
  // flatExtrude maps the shape's +y to world −z: the shape is the back half; turned round, the front one
  if (front) g.rotateY(Math.PI);
  return g.translate(0, y0, 0);
}

/** A capsule plan (stadium) of half length `len`/2 and half depth `r`, cut to x0..x1, from y0 to y0 + h. */
function stadiumPart(len: number, r: number, x0: number, x1: number, y0: number, h: number): BufferGeometry {
  const s = new Shape();
  const a = -len / 2;
  const b = len / 2;
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

/** Which material family a chunk wears (each has three looks: intact, cracked, battered). */
type Part = 'body' | 'top' | 'screen' | 'glow' | 'metal' | 'logo' | 'dark' | 'panel' | 'feed' | 'units' | 'tally' | 'beacon' | 'cam';

interface KindModel {
  remains: BufferGeometry;
  chunks: Chunk[];
  parts: Part[];
  /** The chunk that falls off at the battered look (−1: none). */
  lost: number;
}

/**
 * A compact anchor desk (1.9.8 polish): a navy lacquered body in three blocks on a dark recessed plinth with a fine cyan
 * line under it, a white desktop with a slim edge, the wide PRIME NEWS front (globe mark, red LIVE line) and, on top, the
 * anchor's small monitor (its back to the camera) and a microphone. Inside the capsule body; ~1.1 m tall.
 */
function newsdeskModel(): KindModel {
  const t = COVER_TUNING.newsdesk;
  const len = t.half * 2;
  const r = t.radius - 0.01;
  const A = -len / 2 - r;
  const B = len / 2 + r;
  const cuts = [A, -0.24, 0.24, B];
  const chunks: Chunk[] = [];
  const parts: Part[] = [];
  for (let i = 0; i < 3; i++) {
    chunks.push(centred(stadiumPart(len, r * 0.93, cuts[i], cuts[i + 1], 0.13, 0.78)));
    parts.push('body');
  }
  chunks.push(centred(stadiumPart(len + 0.02, r + 0.004, A - 0.01, B + 0.01, 0.91, 0.05)));
  parts.push('top');
  chunks.push(centred(stadiumPart(len, r * 0.8, A + 0.05, B - 0.05, 0.03, 0.1)));
  parts.push('dark');
  chunks.push(centred(merge([stadiumPart(len, r * 0.95, A + 0.03, B - 0.03, 0.125, 0.012), stadiumPart(len, r * 0.945, A + 0.02, B - 0.02, 0.87, 0.01)])));
  parts.push('glow');
  chunks.push(centred(screenBox(0.92, 0.32, 0.02).translate(0, 0.5, r * 0.93 + 0.012)));
  parts.push('logo');
  // the anchor's monitor (a dark back with a thin cyan line) on a short stand, and a desk microphone
  chunks.push(
    centred(
      merge([
        new BoxGeometry(0.32, 0.14, 0.03).rotateX(-0.22).translate(0.26, 1.045, -0.06),
        new BoxGeometry(0.04, 0.05, 0.04).translate(0.26, 0.98, -0.07),
        new BoxGeometry(0.16, 0.012, 0.1).translate(0.26, 0.966, -0.07),
        new CylinderGeometry(0.008, 0.008, 0.13, 6).rotateX(0.35).translate(-0.3, 1.02, -0.02),
        new SphereGeometry(0.022, 10, 8).translate(-0.3, 1.08, 0.0),
        new CylinderGeometry(0.035, 0.04, 0.012, 12).translate(-0.3, 0.966, -0.04),
      ]),
    ),
  );
  parts.push('metal');
  return { remains: stadiumPart(len, r, A, B, 0, 0.05), chunks, parts, lost: 6 };
}

/**
 * A studio tech panel on wheels (1.9.8 polish): an open stand with a crossbar, a control unit with a lit strip of
 * buttons, faders and a VU meter, a broadcast monitor in a dark bezel and a red ON AIR tally lamp on its corner.
 */
function techpanelModel(): KindModel {
  const t = COVER_TUNING.techpanel;
  const len = t.half * 2;
  const r = t.radius - 0.01;
  const chunks: Chunk[] = [];
  const parts: Part[] = [];
  chunks.push(
    centred(
      merge([
        new CylinderGeometry(0.03, 0.03, 0.9, 8).translate(-0.32, 0.55, -0.04),
        new CylinderGeometry(0.03, 0.03, 0.9, 8).translate(0.32, 0.55, -0.04),
        new BoxGeometry(0.66, 0.035, 0.035).translate(0, 0.16, -0.04),
      ]),
    ),
  );
  parts.push('metal');
  chunks.push(centred(new BoxGeometry(0.72, 0.3, 0.3).translate(0, 0.42, 0)));
  parts.push('dark');
  chunks.push(centred(screenBox(0.66, 0.24, 0.02).rotateX(-0.25).translate(0, 0.45, 0.155)));
  parts.push('panel');
  chunks.push(centred(new BoxGeometry(len + r * 1.6, 0.6, 0.09).translate(0, 1.2, -0.02)));
  parts.push('dark');
  chunks.push(centred(screenBox(len + r * 1.6 - 0.07, 0.52, 0.02).translate(0, 1.2, 0.035)));
  parts.push('screen');
  chunks.push(centred(new BoxGeometry(0.06, 0.035, 0.035).translate(-0.44, 1.52, 0.0)));
  parts.push('tally');
  const base = merge([stadiumPart(len, r, -len / 2 - r, len / 2 + r, 0.03, 0.07), ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => new CylinderGeometry(0.04, 0.04, 0.05, 8).rotateZ(Math.PI / 2).translate(sx * (len / 2 + r * 0.5), 0.03, sz * r * 0.6)))]);
  return { remains: base, chunks, parts, lost: 4 };
}

/**
 * An equipment rack with a screen (1.9.8 polish): a 12-sided tower in two blocks (front and back halves) turned so a flat
 * face looks forward, a dark front frame carrying a tall LIVE FEED screen over rack units with status LEDs, two cyan
 * light strips down the frame and a cap with a small violet beacon (≤ 1.8 m).
 */
function rackModel(): KindModel {
  const r = COVER_TUNING.rack.radius / Math.cos(Math.PI / 12) - 0.012;
  const ri = r * Math.cos(Math.PI / 12);
  const chunks: Chunk[] = [];
  const parts: Part[] = [];
  for (const [y0, hh] of [
    [0.1, 0.72],
    [0.82, 0.74],
  ] as [number, number][])
    for (const f of [false, true]) {
      chunks.push(centred(halfPrism(r, 12, y0, hh, f).rotateY(Math.PI / 12)));
      parts.push('body');
    }
  const fz = ri + 0.005;
  chunks.push(centred(merge([new BoxGeometry(0.32, 1.32, 0.02).translate(0, 0.86, fz), new CylinderGeometry(r + 0.006, r + 0.006, 0.035, 12, 1, true).rotateY(Math.PI / 12).translate(0, 0.82, 0)])));
  parts.push('dark');
  chunks.push(centred(screenBox(0.27, 0.5, 0.01).translate(0, 1.2, fz + 0.014)));
  parts.push('feed');
  chunks.push(centred(screenBox(0.27, 0.52, 0.01).translate(0, 0.58, fz + 0.014)));
  parts.push('units');
  chunks.push(centred(merge([-1, 1].map((sx) => new BoxGeometry(0.014, 1.22, 0.01).translate(sx * 0.152, 0.86, fz + 0.014)))));
  parts.push('glow');
  chunks.push(centred(merge([new CylinderGeometry(r * 0.94, r, 0.07, 12).rotateY(Math.PI / 12).translate(0, 1.6, 0), new CylinderGeometry(0.05, 0.06, 0.06, 10).translate(0, 1.66, 0)])));
  parts.push('metal');
  chunks.push(centred(new SphereGeometry(0.045, 12, 8).translate(0, 1.72, 0)));
  parts.push('beacon');
  return { remains: new CylinderGeometry(r, r + 0.02, 0.1, 12).rotateY(Math.PI / 12).translate(0, 0.05, 0), chunks, parts, lost: 5 };
}

/**
 * A TV studio camera on its pedestal (1.9.8 polish): a three-legged dolly base with wheel caps, a telescopic column with
 * the steering ring, the camera body with a lens and a square hood (to +z), a viewfinder on top, two pan bars reaching
 * back and a red ON AIR tally lamp. Kept within the base's reach (the body is the look).
 */
function pedestalModel(): KindModel {
  const r = COVER_TUNING.pedestal.radius - 0.01;
  const chunks: Chunk[] = [];
  const parts: Part[] = [];
  const legs: BufferGeometry[] = [new CylinderGeometry(0.11, 0.13, 0.12, 14).translate(0, 0.11, 0)];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
    legs.push(new BoxGeometry(0.06, 0.05, r * 0.88).translate(0, 0.08, r * 0.44).rotateY(a));
    legs.push(new SphereGeometry(0.045, 10, 8).translate(Math.sin(a) * r * 0.86, 0.045, Math.cos(a) * r * 0.86));
  }
  chunks.push(centred(merge(legs)));
  parts.push('dark');
  chunks.push(centred(merge([new CylinderGeometry(0.07, 0.085, 0.5, 12).translate(0, 0.42, 0), new CylinderGeometry(0.055, 0.06, 0.42, 12).translate(0, 0.86, 0), new TorusGeometry(0.19, 0.02, 6, 22).rotateX(Math.PI / 2).translate(0, 0.74, 0)])));
  parts.push('metal');
  // the camera: body, lens barrel and its hood forward, the viewfinder on top towards the back
  chunks.push(
    centred(
      merge([
        new BoxGeometry(0.24, 0.24, 0.38).translate(0, 1.26, -0.05),
        new CylinderGeometry(0.08, 0.09, 0.16, 16).rotateX(Math.PI / 2).translate(0, 1.26, 0.21),
        new BoxGeometry(0.2, 0.17, 0.06).translate(0, 1.26, 0.31),
        new BoxGeometry(0.16, 0.11, 0.12).translate(0, 1.44, -0.12),
      ]),
    ),
  );
  parts.push('cam');
  chunks.push(centred(merge([-1, 1].map((sx) => new CylinderGeometry(0.012, 0.012, 0.26, 6).rotateX(1.15).translate(sx * 0.1, 1.14, -0.22)))));
  parts.push('metal');
  chunks.push(centred(new BoxGeometry(0.06, 0.03, 0.03).translate(0, 1.4, 0.1)));
  parts.push('tally');
  // the lens: a fine cyan ring inside the hood (the camera reads as a camera from every side)
  chunks.push(centred(new TorusGeometry(0.066, 0.011, 6, 18).translate(0, 1.26, 0.342)));
  parts.push('glow');
  return { remains: new CylinderGeometry(r, r + 0.02, 0.04, 18).translate(0, 0.02, 0), chunks, parts, lost: 2 };
}

/** The four cover models (1.9.8 polish: exported for `npm run newsroom` — every chunk inside its collision body). */
export function newsroomCoverModels(): Record<'newsdesk' | 'techpanel' | 'rack' | 'pedestal', { remains: BufferGeometry; chunks: { geo: BufferGeometry; at: Vector3 }[] }> {
  return { newsdesk: newsdeskModel(), techpanel: techpanelModel(), rack: rackModel(), pedestal: pedestalModel() };
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
  looks: Material[][];
  stage: number;
  shake: number;
  hitCd: number;
  lost: number;
  phase: number;
}

interface MonitorP {
  screen: Mesh;
  live: Material;
  dead: Material;
  broken: boolean;
  flicker: number;
}

interface TallyP {
  globe: Mesh;
  glow: MeshBasicMaterial;
  broken: boolean;
  flicker: number;
}

interface CamP {
  head: Group;
  tally: MeshBasicMaterial;
  nod: number;
  flash: number;
  yaw: number;
}

const LAYOUT: DecorLayout = {
  spots: [
    [-7.2, GROUND_Y, -5.6, 0.5],
    [7.2, GROUND_Y, -5.6, 0.5],
    [-7.4, GROUND_Y, 4.2, 0.46],
    [7.4, GROUND_Y, 4.2, 0.46],
    [-8.4, GROUND_Y, -11.4, 0.48],
    [8.4, GROUND_Y, -11.4, 0.48],
    [-10.6, GROUND_Y, -8.4, 0.5],
    [10.6, GROUND_Y, -8.4, 0.5],
    [-10.6, GROUND_Y, -0.6, 0.5],
    [10.6, GROUND_Y, -0.6, 0.5],
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
    { x: -8.3, y: GROUND_Y + 5.2, z: ZF + 0.9, rx: 0, ry: 0.34, w: 5.2, h: 3.25, front: 0.1, size: 0.9 },
    { x: 8.3, y: GROUND_Y + 5.2, z: ZF + 0.9, rx: 0, ry: -0.34, w: 5.2, h: 3.25, front: 0.1, size: 0.9 },
  ],
  banners: [
    [-10.4, 8.6, ZF + 0.4, 0],
    [10.4, 8.6, ZF + 0.4, 0],
    [-12.4, 6.2, -8.6, 0.7],
    [12.4, 6.2, -8.6, -0.7],
  ],
  bats: { r: [4, 8], h: [8, 11], cx: [-5, 5], cz: [-17, -13] },
};

export class NewsroomStage extends Stage {
  readonly id = 'newsroom' as const;
  readonly layout = LAYOUT;
  private cones: SpotCone[] = [];
  private pieces = new Pieces();
  private covers: CoverView[] = [];
  private coverGroup = new Group();
  private monitors: MonitorP[] = [];
  private tallies: TallyP[] = [];
  private cams: CamP[] = [];
  private propMap: ({ k: 'monitor'; i: number } | { k: 'tally'; i: number } | { k: 'cam'; i: number } | { k: 'onair' })[] = [];
  private tiles: InstancedMesh | null = null;
  private tileBase: Color[] = [];
  private tickerTex!: CanvasTexture;
  private screenMat!: MeshBasicMaterial;
  private onAirMat!: MeshBasicMaterial;
  private onAir = 0;
  private sign!: MeshBasicMaterial;
  private signTex!: CanvasTexture;
  private liveBug!: MeshBasicMaterial;
  private deskGlow!: MeshBasicMaterial;
  /** 1.9.9: the floor PAR cans' lenses (cyan / violet), breathing with the show. */
  private parGlow: MeshBasicMaterial | null = null;
  private parGlowV: MeshBasicMaterial | null = null;
  private decorTally!: MeshBasicMaterial;
  private pools: { mesh: Mesh; mat: MeshBasicMaterial; col: number; base: number; ph: number }[] = [];
  private statics: Mesh[] = [];
  private extraGeos: BufferGeometry[] = [];
  private extraMats: Material[] = [];

  constructor(shared: StageShared) {
    super(shared);
    this.buildFloor();
    this.buildBarrier();
    this.buildOutside();
    this.buildVideoWall();
    this.buildDesk();
    this.buildSides();
    this.buildStudioKit();
    this.buildProps();
    this.buildLights();
    this.buildCovers();
    this.group.add(this.coverGroup);
    // one draw call per shared material for everything that never moves
    mergeStatic(this.group, this.statics);
  }

  private keepM<T extends Material>(m: T): T {
    this.extraMats.push(m);
    return m;
  }

  /** A static piece (merged with the others of its material after the build). */
  private stat(geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0, ry = 0, rx = 0): Mesh {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    this.group.add(m);
    this.statics.push(m);
    return m;
  }

  private buildFloor(): void {
    const { map, emissive } = drawFloor();
    this.group.add(floorMesh(map, emissive, { roughness: 0.32, metalness: 0.28, emissiveIntensity: 1.3 }, 0x0a0f30));
    const ground = new Mesh(new PlaneGeometry(90, 90), new MeshStandardMaterial({ color: 0x0a0e2c, roughness: 0.42, metalness: 0.3 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    this.group.add(ground);
  }

  /** A dark glossy barrier with a cyan light strip on top, a violet band on its outer face and the LED tickers. */
  private buildBarrier(): void {
    const lacquer = new MeshStandardMaterial({ color: 0x141b4c, roughness: 0.3, metalness: 0.55 });
    const wall = new Mesh(flatExtrude(ringShape(ARENA.wallX, ARENA.wallZ, ARENA.wallCorner, 0.45), WALL_TOP), lacquer);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.group.add(wall);
    const strip = flatExtrude(ringShape(ARENA.wallX + 0.02, ARENA.wallZ + 0.02, ARENA.wallCorner + 0.02, 0.06), 0.03);
    strip.translate(0, WALL_TOP, 0);
    this.group.add(new Mesh(strip, new MeshBasicMaterial({ color: new Color(CYAN).multiplyScalar(1.5), toneMapped: false })));
    const band = flatExtrude(ringShape(ARENA.wallX + 0.45, ARENA.wallZ + 0.45, ARENA.wallCorner + 0.45, 0.02), 0.05);
    band.translate(0, 0.2, 0);
    this.group.add(new Mesh(band, this.keepM(new MeshBasicMaterial({ color: new Color(VIOLET).multiplyScalar(1.4), toneMapped: false }))));
    // the live LED tickers on the outer side: north and both sides (low, under the battle camera's view of the floor)
    const board = this.keepM(new MeshBasicMaterial({ map: this.sh.boardTex, toneMapped: false }));
    board.color.setScalar(1.1);
    this.stat(new PlaneGeometry(13, 0.7), board, 0, 0.6, -ARENA.wallZ - 1.05, 0, -0.35);
    for (const sx of [-1, 1]) {
      const m = this.stat(new PlaneGeometry(15, 0.7), board, sx * (ARENA.wallX + 1.3), 0.6, -2.2, (-sx * Math.PI) / 2);
      m.rotateX(-0.45);
    }
  }

  /** The studio floor outside the barrier: glossy navy with a cyan outline and a violet light line at the walls. */
  private buildOutside(): void {
    const carpet = new Mesh(flatExtrude(ringShape(ARENA.wallX + 0.44, ARENA.wallZ + 0.44, ARENA.wallCorner + 0.44, 4.4), 0.02), this.keepM(new MeshStandardMaterial({ color: 0x0f1646, roughness: 0.36, metalness: 0.35 })));
    carpet.position.y = GROUND_Y;
    carpet.receiveShadow = true;
    this.group.add(carpet);
    const line = new Mesh(flatExtrude(ringShape(ARENA.wallX + 4.8, ARENA.wallZ + 4.8, ARENA.wallCorner + 4.8, 0.05), 0.025), this.keepM(new MeshBasicMaterial({ color: new Color(CYAN).multiplyScalar(1.2), toneMapped: false })));
    line.position.y = GROUND_Y;
    this.group.add(line);
  }

  /**
   * The north wall: the studio wall, the LED video wall with the live picture in its middle (the arena's own big
   * screen), BREAKING NEWS and the world feed on angled panels, LED tile columns, the ticker and the NEON NEWSROOM sign.
   */
  private buildVideoWall(): void {
    this.stat(new PlaneGeometry(32, 14), this.keepM(new MeshBasicMaterial({ map: wallTexture() })), 0, GROUND_Y + 7, ZF - 0.35);
    const bezel = this.keepM(new MeshStandardMaterial({ color: 0x0a0d24, roughness: 0.35, metalness: 0.7 }));
    const glow = this.keepM(new MeshBasicMaterial({ color: new Color(CYAN).multiplyScalar(1.4), toneMapped: false }));
    const cy = GROUND_Y + 5.4;
    // the live picture: 10.4 × 5.4 in a thin bezel with a cyan glow line round it
    this.screenMat = this.keepM(new MeshBasicMaterial({ map: this.sh.screenTex, toneMapped: false }));
    const scr = new Mesh(new PlaneGeometry(10.4, 5.4), this.screenMat);
    scr.position.set(0, cy, ZF + 0.16);
    this.group.add(scr);
    this.stat(new BoxGeometry(10.9, 5.9, 0.24), bezel, 0, cy, ZF);
    for (const [x, y, w, h] of [
      [0, cy + 2.95, 10.9, 0.06],
      [0, cy - 2.95, 10.9, 0.06],
      [-5.45, cy, 0.06, 5.9],
      [5.45, cy, 0.06, 5.9],
    ] as [number, number, number, number][])
      this.stat(new BoxGeometry(w, h, 0.05), glow, x, y, ZF + 0.14);
    // the angled side panels (BREAKING NEWS, the world feed), each in its bezel
    for (const sx of [-1, 1]) {
      const x = sx * 8.3;
      const ry = -sx * 0.34;
      const tex = sx < 0 ? breakingTexture() : worldTexture();
      const p = new Mesh(new PlaneGeometry(5.2, 3.25), this.keepM(new MeshBasicMaterial({ map: tex, toneMapped: false })));
      p.position.set(x, GROUND_Y + 5.2, ZF + 0.9);
      p.rotation.y = ry;
      p.translateZ(0.13);
      this.group.add(p);
      this.stat(new BoxGeometry(5.6, 3.65, 0.22), bezel, x, GROUND_Y + 5.2, ZF + 0.9, ry);
    }
    // LED tile columns at the outer edges (a few tiles change colour each frame: a living wall, cheap)
    const tileGeo = new PlaneGeometry(0.86, 0.86);
    this.extraGeos.push(tileGeo);
    const cols = [CYAN, VIOLET, 0x2a5aff, 0x1a2a8a, RED];
    const at: [number, number, number, number][] = [];
    for (const sx of [-1, 1])
      for (let cx = 0; cx < 3; cx++)
        for (let r = 0; r < 7; r++) at.push([sx * (11.2 + cx * 0.92), GROUND_Y + 1.6 + r * 0.92, ZF + 0.3 + cx * 0.55, sx]);
    const tiles = new InstancedMesh(tileGeo, this.keepM(new MeshBasicMaterial({ toneMapped: false })), at.length);
    const rng = new Rng(2026);
    at.forEach(([x, y, z, sx], i) => {
      _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_v.set(0, 1, 0), -sx * 0.52), _s.setScalar(1));
      tiles.setMatrixAt(i, _m);
      const k = rng.next();
      const base = new Color(cols[k < 0.4 ? 0 : k < 0.65 ? 1 : k < 0.85 ? 2 : k < 0.96 ? 3 : 4]).multiplyScalar(0.55 + rng.range(0, 0.6));
      this.tileBase.push(base);
      tiles.setColorAt(i, base);
    });
    this.group.add(tiles);
    this.tiles = tiles;
    // the news ticker under the wall: a red BREAKING label and the scrolling headlines
    this.tickerTex = tickerTexture();
    this.tickerTex.repeat.set(2.2, 1);
    const tk = new Mesh(new PlaneGeometry(22, 0.62), this.keepM(new MeshBasicMaterial({ map: this.tickerTex, toneMapped: false })));
    tk.position.set(1.2, GROUND_Y + 2.25, ZF + 0.2);
    this.group.add(tk);
    const label = paintTexture(256, 64, (g, w, h) => {
      g.fillStyle = '#ff2f55';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.font = 'italic 900 34px Unbounded, "Arial Black", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('BREAKING', w / 2, h / 2 + 2);
    });
    this.stat(new PlaneGeometry(2.6, 0.62), this.keepM(new MeshBasicMaterial({ map: label, toneMapped: false })), -11.1, GROUND_Y + 2.25, ZF + 0.22);
    this.stat(new BoxGeometry(24.8, 0.78, 0.12), bezel, -0.1, GROUND_Y + 2.25, ZF + 0.12);
    // NEON NEWSROOM over the wall, a LIVE bug at its corner
    this.signTex = drawNeon('NEON NEWSROOM', '#5ef0ff', 1024, 256, 96);
    this.sign = neonMaterial(this.signTex, 1.5);
    this.extraMats.push(this.sign);
    const sign = new Mesh(new PlaneGeometry(10, 2.5), this.sign);
    sign.position.set(0, GROUND_Y + 9.7, ZF + 0.3);
    this.group.add(sign);
    this.liveBug = neonMaterial(drawNeon('● LIVE', '#ff3a5a', 512, 192, 110), 1.4);
    this.extraMats.push(this.liveBug);
    const bug = new Mesh(new PlaneGeometry(2.2, 0.82), this.liveBug);
    bug.position.set(4.6, GROUND_Y + 8.45, ZF + 0.34);
    this.group.add(bug);
  }

  /** The anchor desk behind the north barrier (a curved desk of three angled blocks), two chairs and two cameras. */
  private buildDesk(): void {
    const z0 = -11.2;
    const body = this.keepM(new MeshStandardMaterial({ color: 0x18215e, roughness: 0.3, metalness: 0.45 }));
    const top = this.keepM(new MeshStandardMaterial({ color: 0xe6ecff, roughness: 0.22, metalness: 0.2, emissive: new Color(WARM), emissiveIntensity: 0.06 }));
    this.deskGlow = this.keepM(new MeshBasicMaterial({ color: new Color(CYAN).multiplyScalar(1.6), toneMapped: false }));
    const blocks: [number, number, number][] = [
      [0, 0, 4.4],
      [-3.3, 0.42, 2.4],
      [3.3, -0.42, 2.4],
    ];
    for (const [x, ry, w] of blocks) {
      const zz = z0 + Math.abs(x) * 0.18;
      const d = this.stat(new BoxGeometry(w, 1.0, 0.85), body, x, GROUND_Y + 0.5, zz, ry);
      d.castShadow = true;
      this.stat(new BoxGeometry(w + 0.12, 0.06, 1.0), top, x, GROUND_Y + 1.03, zz, ry);
      // the glow strips: along the bottom of the front and under the top
      for (const y of [0.08, 0.9]) {
        const s = this.stat(new BoxGeometry(w, 0.04, 0.02), this.deskGlow, x, GROUND_Y + y, zz, ry);
        s.translateZ(0.44);
      }
    }
    const logo = new Mesh(new PlaneGeometry(2.4, 0.6), this.keepM(new MeshBasicMaterial({ map: deskLogoTexture(), toneMapped: false })));
    logo.position.set(0, GROUND_Y + 0.52, z0 + 0.44);
    this.group.add(logo);
    // two anchors' chairs (empty: the fight is the news)
    const chair = this.keepM(new MeshStandardMaterial({ color: 0x2a1a5a, roughness: 0.5, metalness: 0.2 }));
    for (const sx of [-1, 1]) {
      const x = sx * 1.1;
      this.stat(new CylinderGeometry(0.05, 0.05, 0.5, 8), chair, x, GROUND_Y + 0.25, z0 - 1.0);
      this.stat(new BoxGeometry(0.62, 0.12, 0.58), chair, x, GROUND_Y + 0.55, z0 - 1.0);
      this.stat(new BoxGeometry(0.62, 0.9, 0.1), chair, x, GROUND_Y + 1.0, z0 - 1.32);
    }
    // two studio cameras on pedestals, looking at the desk; red tally lights blink while «on air»
    const camMat = this.keepM(new MeshStandardMaterial({ color: 0x20243e, roughness: 0.4, metalness: 0.7 }));
    this.decorTally = this.keepM(new MeshBasicMaterial({ color: new Color(RED).multiplyScalar(2), toneMapped: false }));
    for (const sx of [-1, 1]) {
      const x = sx * 6.3;
      const z = -9.4;
      const ry = Math.atan2(0 - x, z0 - z);
      this.stat(new CylinderGeometry(0.42, 0.5, 0.18, 16), camMat, x, GROUND_Y + 0.09, z);
      this.stat(new CylinderGeometry(0.08, 0.1, 1.2, 10), camMat, x, GROUND_Y + 0.75, z);
      const head = new Group();
      head.position.set(x, GROUND_Y + 1.52, z);
      head.rotation.y = ry;
      head.add(new Mesh(new BoxGeometry(0.36, 0.36, 0.62), camMat));
      const lens = new Mesh(new CylinderGeometry(0.12, 0.15, 0.3, 14).rotateX(Math.PI / 2).translate(0, 0, 0.44), camMat);
      head.add(lens);
      const tally = new Mesh(new BoxGeometry(0.1, 0.06, 0.04).translate(0, 0.21, 0.2), this.decorTally);
      head.add(tally);
      this.group.add(head);
      this.statics.push(...(head.children as Mesh[]));
    }
    // equipment racks in the back corners (behind the side panels)
    const rackMat = this.keepM(new MeshStandardMaterial({ color: 0x0e1230, roughness: 0.5, metalness: 0.6 }));
    const rackFront = this.keepM(new MeshBasicMaterial({ map: rackTexture(), toneMapped: false }));
    for (const sx of [-1, 1])
      for (let k = 0; k < 3; k++) {
        const x = sx * (9.6 + k * 0.78);
        const z = -12.9 + k * 0.25;
        const ry = -sx * 0.25;
        this.stat(new BoxGeometry(0.72, 2.1, 0.6), rackMat, x, GROUND_Y + 1.05, z, ry);
        const f = this.stat(new PlaneGeometry(0.62, 1.95), rackFront, x, GROUND_Y + 1.05, z, ry);
        f.translateZ(0.305);
      }
  }

  /** Signal panels on the side walls (ON AIR and the meters) with a violet light line along their foot. */
  private buildSides(): void {
    const frame = this.keepM(new MeshStandardMaterial({ color: 0x0b0f2a, roughness: 0.4, metalness: 0.65 }));
    const onair = this.keepM(new MeshBasicMaterial({ map: sidePanelTexture('onair'), toneMapped: false }));
    const signal = this.keepM(new MeshBasicMaterial({ map: sidePanelTexture('signal'), toneMapped: false }));
    const foot = this.keepM(new MeshBasicMaterial({ color: new Color(VIOLET).multiplyScalar(1.5), toneMapped: false }));
    for (const sx of [-1, 1]) {
      const ry = sx > 0 ? -(Math.PI / 2 - 0.3) : Math.PI / 2 - 0.3;
      for (const [z, mat] of [
        [-3.4, sx < 0 ? onair : signal],
        [2.4, sx < 0 ? signal : onair],
      ] as [number, MeshBasicMaterial][]) {
        const x = sx * 12.3;
        this.stat(new BoxGeometry(2.6, 4.7, 0.2), frame, x, GROUND_Y + 3.0, z, ry);
        const p = this.stat(new PlaneGeometry(2.36, 4.46), mat, x, GROUND_Y + 3.0, z, ry);
        p.translateZ(0.11);
      }
      this.stat(new BoxGeometry(0.06, 0.05, 15), foot, sx * 11.9, GROUND_Y + 0.03, -2.0);
    }
  }

  /**
   * Alpha 1.9.9 — the studio around the fight: the set had its video wall and anchor desk far back, and little near the
   * arena. Now (NEWSROOM_KIT): neon guide lines on the studio floor along both sides, a row of floor PAR cans and a
   * stage monitor behind the far barrier, a chrome light arch framing the desk and the video wall, and on both sides
   * the broadcast kit — a camera jib reaching towards the arena, softbox lights on stands and monitor carts with the
   * live feed. Everything stands outside the barrier and never over the fight (`npm run arenapolish`); static, merged
   * by material (the tally lights blink with the desk cameras', the PAR lenses breathe with the show).
   */
  private buildStudioKit(): void {
    const K = NEWSROOM_KIT;
    const metal = this.keepM(new MeshStandardMaterial({ color: 0x141a3a, roughness: 0.35, metalness: 0.72 }));
    const chrome = this.keepM(new MeshStandardMaterial({ color: 0x9aa6c8, roughness: 0.24, metalness: 0.86 }));
    const cyan = this.keepM(new MeshBasicMaterial({ color: new Color(CYAN).multiplyScalar(1.6), toneMapped: false }));
    const violet = this.keepM(new MeshBasicMaterial({ color: new Color(VIOLET).multiplyScalar(1.6), toneMapped: false }));
    const soft = this.keepM(new MeshBasicMaterial({ color: new Color(0xeaf4ff).multiplyScalar(1.35), toneMapped: false }));
    this.parGlow = this.keepM(new MeshBasicMaterial({ color: new Color(CYAN).multiplyScalar(1.8), toneMapped: false }));
    const parGlowV = this.parGlowV = this.keepM(new MeshBasicMaterial({ color: new Color(VIOLET).multiplyScalar(1.8), toneMapped: false }));
    const feed = this.keepM(new MeshBasicMaterial({ map: feedTexture(0), toneMapped: false }));
    // neon guide lines on the studio floor, outside the barrier on both sides, and across behind the far barrier
    for (const sx of [-1, 1]) {
      this.stat(new BoxGeometry(0.05, 0.015, K.guide.len), cyan, sx * K.guide.x[0], GROUND_Y + 0.012, K.guide.z);
      this.stat(new BoxGeometry(0.05, 0.015, K.guide.len), violet, sx * K.guide.x[1], GROUND_Y + 0.012, K.guide.z);
    }
    this.stat(new BoxGeometry(K.guide.x[0] * 2, 0.015, 0.05), cyan, 0, GROUND_Y + 0.012, K.pars.z - 0.55);
    // floor PAR cans behind the far barrier, tilted up towards the wall; a stage monitor in the middle
    K.pars.x.forEach((x, i) => {
      this.stat(new CylinderGeometry(0.15, 0.13, 0.26, 14).rotateX(0.55), metal, x, GROUND_Y + 0.17, K.pars.z);
      this.stat(new BoxGeometry(0.34, 0.06, 0.2), metal, x, GROUND_Y + 0.03, K.pars.z);
      // (static: merged into one mesh per colour with the rest; the shared material still breathes)
      this.stat(new CircleGeometry(0.115, 18), i % 2 ? parGlowV : this.parGlow!, x, GROUND_Y + 0.25, K.pars.z - 0.08, 0, -Math.PI / 2 + 0.55 + Math.PI);
    });
    this.stat(new BoxGeometry(0.9, 0.34, 0.46), metal, 0, GROUND_Y + 0.17, K.pars.z - 0.25, 0, -0.35);
    const mon = this.stat(new PlaneGeometry(0.76, 0.24), feed, 0, GROUND_Y + 0.27, K.pars.z - 0.02, Math.PI, 0.35);
    void mon;
    // the light arch framing the desk and the video wall (a chrome truss with a violet line; behind the fight)
    const A = K.arch;
    this.stat(new TorusGeometry(A.r, 0.09, 10, 64, Math.PI), chrome, 0, GROUND_Y, A.z);
    this.stat(new TorusGeometry(A.r - 0.16, 0.035, 6, 64, Math.PI), violet, 0, GROUND_Y, A.z);
    for (let k = 1; k < 18; k++) {
      const a = (k / 18) * Math.PI;
      this.stat(new BoxGeometry(0.06, 0.24, 0.16).rotateZ(a - Math.PI / 2), chrome, Math.cos(a) * (A.r - 0.08), GROUND_Y + Math.sin(a) * (A.r - 0.08), A.z);
    }
    // the broadcast kit on both sides of the arena (all facing the fight)
    for (const sx of [-1, 1]) {
      const face = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
      // a camera jib: tripod, post, an arm reaching over the side towards the arena, the camera and its tally
      const J = K.jib;
      const jx = sx * J.x;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        this.stat(new CylinderGeometry(0.025, 0.025, 0.95, 6).rotateZ(0.45), metal, jx + Math.cos(a) * 0.22, GROUND_Y + 0.42, J.z + Math.sin(a) * 0.22, a);
      }
      this.stat(new CylinderGeometry(0.07, 0.08, J.post, 10), metal, jx, GROUND_Y + J.post / 2, J.z);
      const ex = Math.cos(J.lift) * J.arm;
      const ey = Math.sin(J.lift) * J.arm;
      const arm = this.stat(new BoxGeometry(J.arm + 0.7, 0.08, 0.08).translate((J.arm - 0.7) / 2, 0, 0), chrome, jx, GROUND_Y + J.post, J.z);
      arm.rotation.set(0, sx > 0 ? Math.PI : 0, J.lift);
      this.stat(new BoxGeometry(0.3, 0.26, 0.26), metal, jx + sx * 0.62 * Math.cos(J.lift), GROUND_Y + J.post - 0.62 * Math.sin(J.lift), J.z);
      const hx = jx - sx * ex;
      const hy = GROUND_Y + J.post + ey;
      this.stat(new BoxGeometry(0.42, 0.26, 0.3), metal, hx, hy - 0.2, J.z, face);
      this.stat(new CylinderGeometry(0.09, 0.11, 0.26, 12).rotateX(Math.PI / 2).translate(0, 0, 0.26), chrome, hx, hy - 0.2, J.z, face);
      this.stat(new BoxGeometry(0.09, 0.05, 0.04), this.decorTally, hx, hy - 0.04, J.z);
      // softbox lights on stands
      for (const z of K.softboxes.z) {
        const bx = sx * K.softboxes.x;
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + 0.4;
          this.stat(new CylinderGeometry(0.018, 0.018, 0.7, 6).rotateZ(0.5), metal, bx + Math.cos(a) * 0.16, GROUND_Y + 0.3, z + Math.sin(a) * 0.16, a);
        }
        this.stat(new CylinderGeometry(0.022, 0.022, K.softboxes.h, 6), chrome, bx, GROUND_Y + K.softboxes.h / 2, z);
        const yaw = Math.atan2(-bx, -z * 0.35);
        this.stat(new BoxGeometry(0.64, 0.5, 0.3), metal, bx, GROUND_Y + K.softboxes.h + 0.18, z, yaw, -0.25);
        const sb = this.stat(new PlaneGeometry(0.58, 0.44), soft, bx, GROUND_Y + K.softboxes.h + 0.18, z, yaw, -0.25);
        sb.translateZ(0.152);
      }
      // a monitor cart with the live feed on two screens
      const C = K.cart;
      const cx = sx * C.x;
      this.stat(new BoxGeometry(0.5, 0.78, 0.7), metal, cx, GROUND_Y + 0.42, C.z);
      for (const [dz, y] of [
        [0, 1.02],
        [0, 1.42],
      ] as [number, number][]) {
        this.stat(new BoxGeometry(0.66, 0.4, 0.06), metal, cx, GROUND_Y + y, C.z + dz, face);
        const sc = this.stat(new PlaneGeometry(0.6, 0.34), feed, cx, GROUND_Y + y, C.z + dz, face);
        sc.translateZ(0.032);
      }
      this.stat(new BoxGeometry(0.5, 0.03, 0.03), cyan, cx, GROUND_Y + 0.8, C.z, face).translateZ(0.36);
    }
  }

  /** The light pools on the floor are left out on the low preset. */
  override setQuality(low: boolean): void {
    super.setQuality(low);
    for (const p of this.pools) p.mesh.visible = !low;
  }

  // ---------------------------------------------------- barrier set pieces
  private buildProps(): void {
    const stand = this.keepM(new MeshStandardMaterial({ color: 0x1a1f3e, roughness: 0.4, metalness: 0.7 }));
    const live = [0, 1].map((v) => this.keepM(new MeshBasicMaterial({ map: screenTexture(0, v), toneMapped: false })));
    const dead = this.keepM(new MeshBasicMaterial({ map: screenTexture(3, 0), toneMapped: false }));
    DEF.props.forEach((p, idx) => {
      const y = landingY(p.x, p.z);
      // the piece faces the middle of the floor
      const ry = Math.atan2(-p.x, -p.z);
      if (p.kind === 'monitor') {
        this.propMap[idx] = { k: 'monitor', i: this.monitors.length };
        const g = new Group();
        g.position.set(p.x, y, p.z);
        g.rotation.y = ry;
        g.add(new Mesh(new CylinderGeometry(0.03, 0.04, 0.42, 8).translate(0, 0.21, 0), stand));
        const mat = live[this.monitors.length % 2];
        const screen = new Mesh(screenBox(0.7, 0.44, 0.06).translate(0, 0.62, 0), mat);
        g.add(screen);
        this.group.add(g);
        this.monitors.push({ screen, live: mat, dead, broken: false, flicker: 0 });
      } else if (p.kind === 'tallyLamp') {
        this.propMap[idx] = { k: 'tally', i: this.tallies.length };
        const post = new Mesh(new CylinderGeometry(0.035, 0.05, 1.1, 8), stand);
        post.position.set(p.x, y + 0.55, p.z);
        const glow = this.keepM(new MeshBasicMaterial({ color: new Color(RED).multiplyScalar(2.2), toneMapped: false, transparent: true, opacity: 0.95 }));
        const globe = new Mesh(new SphereGeometry(0.13, 14, 10), glow);
        globe.position.set(p.x, y + 1.18, p.z);
        this.group.add(post, globe);
        this.tallies.push({ globe, glow, broken: false, flicker: 0 });
      } else if (p.kind === 'newsCam') {
        this.propMap[idx] = { k: 'cam', i: this.cams.length };
        const base = new Mesh(new CylinderGeometry(0.06, 0.08, 0.9, 10), stand);
        base.position.set(p.x, y + 0.45, p.z);
        const head = new Group();
        head.position.set(p.x, y + 1.0, p.z);
        head.rotation.y = ry;
        head.add(new Mesh(new BoxGeometry(0.26, 0.26, 0.44), stand));
        head.add(new Mesh(new CylinderGeometry(0.09, 0.11, 0.22, 12).rotateX(Math.PI / 2).translate(0, 0, 0.32), stand));
        const tally = this.keepM(new MeshBasicMaterial({ color: new Color(RED).multiplyScalar(1.2), toneMapped: false }));
        head.add(new Mesh(new BoxGeometry(0.08, 0.05, 0.03).translate(0, 0.16, 0.14), tally));
        this.group.add(base, head);
        this.cams.push({ head, tally, nod: 0, flash: 0, yaw: ry });
      } else if (p.kind === 'onAirSign') {
        this.propMap[idx] = { k: 'onair' };
        const post = new Mesh(new BoxGeometry(0.1, 0.32, 0.1), stand);
        post.position.set(p.x, y + 0.16, p.z);
        const tex = paintTexture(256, 64, (g, w, h) => {
          g.fillStyle = '#5a0a18';
          g.fillRect(0, 0, w, h);
          g.fillStyle = '#ff2f55';
          g.fillRect(4, 4, w - 8, h - 8);
          g.fillStyle = '#ffffff';
          g.font = '900 40px Unbounded, "Arial Black", sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('ON AIR', w / 2, h / 2 + 2);
        });
        this.onAirMat = this.keepM(new MeshBasicMaterial({ map: tex, toneMapped: false }));
        const box = new Mesh(screenBox(1.6, 0.4, 0.14), this.onAirMat);
        box.position.set(p.x, y + 0.52, p.z);
        this.group.add(post, box);
      }
    });
  }

  private buildLights(): void {
    const housing = this.keepM(new MeshStandardMaterial({ color: 0x161a2a, roughness: 0.4, metalness: 0.7 }));
    const spots: [number, number, number, number][] = [
      [-9.6, -6, CYAN, 0.5],
      [9.6, -6, VIOLET, -0.5],
      [-9.6, 4, VIOLET, 0.6],
      [9.6, 4, CYAN, -0.6],
    ];
    for (const [x, z, col, yaw] of spots) {
      const c = makeSpotCone(x, 11, z, col, yaw, housing, 0.2);
      this.group.add(c.pivot);
      this.cones.push(c);
    }
    // trusses ALONG the sides (never across the set: the battle camera looks over it — Alpha 1.7.6 / 1.9.8) and one
    // over the video wall, behind the far barrier, with a row of small PAR cans aimed at the wall
    const steel = this.keepM(new MeshStandardMaterial({ color: 0x2a2c3a, roughness: 0.4, metalness: 0.8 }));
    this.stat(new BoxGeometry(0.18, 0.18, 12), steel, -9.6, 11.5, -1);
    this.stat(new BoxGeometry(0.18, 0.18, 12), steel, 9.6, 11.5, -1);
    this.stat(new BoxGeometry(19.4, 0.18, 0.18), steel, 0, 11.7, ZF + 1.6);
    const lens = this.keepM(new MeshBasicMaterial({ color: new Color(WARM).multiplyScalar(1.8), toneMapped: false }));
    for (let k = 0; k < 7; k++) {
      const x = -7.2 + k * 2.4;
      this.stat(new CylinderGeometry(0.16, 0.2, 0.36, 10), steel, x, 11.3, ZF + 1.6, 0, 0.5);
      this.stat(new CircleLensGeometry(), lens, x, 11.2, ZF + 1.48, 0, 0.5);
    }
    // soft light pools on the floor: cyan under the globe, violet at the two ends (none on low)
    const tex = poolTexture();
    const pool = (x: number, z: number, size: number, col: number, base: number, ph: number) => {
      const mat = this.keepM(new MeshBasicMaterial({ map: tex, color: new Color(col).multiplyScalar(base), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
      const m = new Mesh(new PlaneGeometry(size, size), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, FLOOR_TOP + 0.012, z);
      m.renderOrder = 1;
      this.group.add(m);
      this.pools.push({ mesh: m, mat, col, base, ph });
    };
    pool(0, 0, 5.4, CYAN, 0.14, 0);
    pool(0, -4.6, 3.6, VIOLET, 0.1, 1.7);
    pool(0, 4.6, 3.6, VIOLET, 0.1, 3.1);
  }

  // ------------------------------------------------------------------ cover
  private buildCovers(): void {
    const models = { newsdesk: newsdeskModel(), techpanel: techpanelModel(), rack: rackModel(), pedestal: pedestalModel() } as const;
    for (const md of Object.values(models)) this.extraGeos.push(md.remains, ...md.chunks.map((c) => c.geo));
    const looks3 = (mk: (st: number) => Material) => [0, 1, 2].map((st) => this.keepM(mk(st)));
    const dim = (st: number) => 1 - st * 0.14;
    const tex3 = (mk: (st: number) => CanvasTexture, k: number[]) => [0, 1, 2].map((st) => this.keepM(new MeshBasicMaterial({ map: mk(st), toneMapped: false, color: new Color(1, 1, 1).multiplyScalar(k[st]) })));
    const look: Record<Part, Material[]> = {
      body: looks3((st) => new MeshStandardMaterial({ color: new Color(0x1c2670).multiplyScalar(dim(st)), roughness: 0.3 + st * 0.12, metalness: 0.5, emissive: new Color(VIOLET), emissiveIntensity: st === 0 ? 0.07 : 0.03 })),
      top: looks3((st) => new MeshStandardMaterial({ color: new Color(0xe6ecff).multiplyScalar(dim(st)), roughness: 0.22 + st * 0.15, metalness: 0.2 })),
      metal: looks3((st) => new MeshStandardMaterial({ color: new Color(0x3a4062).multiplyScalar(dim(st)), roughness: 0.35, metalness: 0.8 })),
      dark: looks3((st) => new MeshStandardMaterial({ color: new Color(0x10142e).multiplyScalar(dim(st)), roughness: 0.45, metalness: 0.6 })),
      glow: looks3((st) => new MeshBasicMaterial({ color: new Color(CYAN).multiplyScalar(st === 0 ? 1.4 : st === 1 ? 0.8 : 0.3), toneMapped: false })),
      tally: looks3((st) => new MeshBasicMaterial({ color: new Color(st === 2 ? 0x4a1020 : RED).multiplyScalar(st === 0 ? 1.8 : st === 1 ? 1.1 : 1), toneMapped: false })),
      beacon: looks3((st) => new MeshBasicMaterial({ color: new Color(VIOLET).multiplyScalar(st === 0 ? 2.0 : st === 1 ? 1.2 : 0.4), toneMapped: false })),
      cam: looks3((st) => new MeshStandardMaterial({ color: new Color(0x343c62).multiplyScalar(dim(st)), roughness: 0.38, metalness: 0.65, emissive: new Color(VIOLET), emissiveIntensity: st === 0 ? 0.05 : 0.02 })),
      screen: tex3((st) => screenTexture(st, 0), [1.35, 1.05, 0.7]),
      logo: tex3(deskFrontTexture, [1.3, 1.0, 0.7]),
      panel: tex3(controlTexture, [1.25, 1.0, 0.7]),
      feed: tex3(feedTexture, [1.3, 1.0, 0.7]),
      units: tex3(unitsTexture, [1.2, 0.95, 0.7]),
    };
    const plinth = this.keepM(new MeshStandardMaterial({ color: 0x1a2048, roughness: 0.6, metalness: 0.4 }));
    COVERS.forEach((cv, i) => {
      const md = models[cv.kind as keyof typeof models];
      if (!md) return;
      const group = new Group();
      group.position.set(cv.x, FLOOR_TOP - 0.02, cv.z);
      // 1.9.8 polish — the facing tells the story (the bodies are round or symmetric capsules: the fight is the same):
      // a desk and a tech panel keep their turn with their fronts to the broadcast camera (south); a rack shows its screen
      // to the broadcast camera, turned a little towards the middle; a studio camera looks at the action in the middle
      const yaw =
        COVER_TUNING[cv.kind].half > 0
          ? (cv.yaw ?? 0)
          : cv.kind === 'rack'
            ? -Math.sign(cv.x) * 0.45
            : Math.atan2(-cv.x, -cv.z);
      group.rotation.y = yaw;
      const body = new Group();
      group.add(body);
      const remains = new Mesh(md.remains, plinth);
      remains.castShadow = true;
      remains.receiveShadow = true;
      group.add(remains);
      const looks: Material[][] = [];
      const view: CoverView = { kind: cv.kind, x: cv.x, z: cv.z, yaw, group, body, chunks: [], home: [], halves: [], remains, looks, stage: 0, shake: 0, hitCd: 0, lost: md.lost, phase: i * 1.3 };
      md.chunks.forEach((ch, k) => {
        const lk = look[md.parts[k]];
        const m = new Mesh(ch.geo, lk[0]);
        m.position.copy(ch.at);
        m.castShadow = md.parts[k] !== 'glow' && md.parts[k] !== 'tally' && md.parts[k] !== 'beacon';
        body.add(m);
        view.chunks.push(m);
        view.home.push({ p: ch.at.clone(), q: new Quaternion() });
        view.halves.push(ch.half);
        looks.push(lk);
      });
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

  /** The hit colour: sparks of cyan for the electronics, violet for the desk, warm for a camera. */
  private hitColor(kind: ArenaCoverDef['kind']): number {
    return kind === 'newsdesk' ? 0xb48cff : kind === 'pedestal' ? WARM : CYAN;
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
      vfx.burst(x, y, z, _c.set(col), heavy ? 12 : 5, heavy ? 4.5 : 2.8, 0.1, 0.32, 1.8, 6, 1);
      if (v.kind !== 'newsdesk') vfx.burst(x, y, z, _c.set(0xe8fbff), heavy ? 6 : 2, 4, 0.05, 0.25, 2.2, 8, 1);
    }
    if (what === 'crack') {
      this.setCoverLook(v, stage);
      if (stage >= 2 && v.lost >= 0) this.throwChunk(v, v.lost, -dx * 1.4 + dz * 0.6, 2.4, -dz * 1.4 - dx * 0.6, 5, 'medium', 0.5);
      if (vfx) {
        vfx.dust(x, z, stage >= 2 ? 7 : 4, dx, dz);
        if (v.kind === 'techpanel' || v.kind === 'rack') vfx.burst(x, y + 0.3, z, _c.set(CYAN), 10, 4, 0.06, 0.25, 2.2, 8, 1);
        if (v.kind === 'pedestal') vfx.flash(x, y + 0.5, z, _c.set(RED), 0.3, 1.6, 0.18, 2);
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
      this.throwChunk(v, i, (ox * 1.4 + dx * 1.6) * p, up * p, (oz * 1.4 + dz * 1.6) * p, 3 + i, v.kind === 'techpanel' || v.kind === 'pedestal' ? 'medium' : 'large', i / Math.max(1, n - 1));
    }
    v.remains.scale.set(1, 0.6, 1);
    if (vfx) {
      vfx.dust(v.x, v.z, 12, dx, dz);
      vfx.burst(v.x, 0.9, v.z, _c.set(this.hitColor(v.kind)), 26, 5, 0.12, 0.7, 2, -1, 1.4);
      if (v.kind === 'newsdesk') vfx.debrisBurst(v.x, 0.7, v.z, _c.set(0xe6ecff), 10);
      else {
        // electronics: a white flash and a spray of cyan and red sparks
        vfx.flash(v.x, 1.1, v.z, _c.set(0xe8fbff), 0.6, 2.8, 0.22, 2.6);
        for (const c of [CYAN, RED]) vfx.burst(v.x, 1.0, v.z, _c.set(c), 12, 6, 0.06, 0.45, 2.4, 10, 1);
      }
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
    colorCones(this.cones, isDefault ? [CYAN, VIOLET, VIOLET, CYAN] : th.spots);
    const champ = th.decor === 'champion';
    this.signTex.dispose();
    this.signTex = champ ? drawNeon('CHAMPION NEWS', '#ffc23a', 1024, 256, 92) : drawNeon('NEON NEWSROOM', '#5ef0ff', 1024, 256, 96);
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
    if (m.k === 'onair') {
      // ON AIR flashes and the video wall flickers
      this.onAir = 1;
      if (vfx) vfx.flash(0, GROUND_Y + 5.4, ZF + 0.6, _c.set(RED), 0.6, 4, 0.3, 2.2);
      return;
    }
    if (m.k === 'cam') {
      const c = this.cams[m.i];
      c.nod = 1;
      c.flash = 1;
      if (vfx) vfx.burst(x, 1.1, z, _c.set(WARM), heavy ? 8 : 4, 3, 0.08, 0.35, 1.8, 2, 1);
      return;
    }
    if (vfx) vfx.burst(x, 0.9, z, _c.set(CYAN), heavy ? 10 : 6, 3, 0.1, 0.4, 1.8, 2, 1);
  }

  propBreak(i: number, x: number, z: number): void {
    const m = this.propMap[i];
    if (!m) return;
    const vfx = this.vfx;
    if (m.k === 'monitor') {
      const M = this.monitors[m.i];
      M.broken = true;
      M.flicker = 0.8;
      M.screen.material = M.dead;
      if (vfx) {
        M.screen.getWorldPosition(_v);
        vfx.burst(_v.x, _v.y + 0.6, _v.z, _c.set(0xe8fbff), 16, 5, 0.06, 0.4, 2.4, 9, 1);
        vfx.burst(_v.x, _v.y + 0.6, _v.z, _c.set(CYAN), 8, 4, 0.06, 0.4, 2.2, 8, 1);
      }
    } else if (m.k === 'tally') {
      const L = this.tallies[m.i];
      L.broken = true;
      L.flicker = 0.9;
      if (vfx) {
        L.globe.getWorldPosition(_v);
        vfx.burst(_v.x, _v.y, _v.z, _c.set(0xffd0d8), 16, 5, 0.08, 0.45, 2.4, 9, 1);
      }
    } else if (vfx) vfx.burst(x, 1.0, z, _c.set(WARM), 10, 4, 0.08, 0.4, 2, 6, 1);
  }

  resetProps(): void {
    this.pieces.clear();
    for (const M of this.monitors) {
      M.broken = false;
      M.flicker = 0;
      M.screen.material = M.live;
      M.screen.visible = true;
    }
    for (const L of this.tallies) {
      L.broken = false;
      L.flicker = 0;
      L.glow.opacity = 0.95;
      L.globe.visible = true;
    }
    for (const c of this.cams) {
      c.nod = 0;
      c.flash = 0;
      c.head.rotation.set(0, c.yaw, 0);
    }
    this.resetCovers();
    this.onAir = 0;
  }

  // ---------------------------------------------------------------------- frame
  update(dt: number, ex: number, boost: number): void {
    this.time += dt;
    const t = this.time;
    const mo = this.motion;
    swingCones(this.cones, t, ex * 0.7, boost, mo * 0.6);
    // the ticker scrolls (slower with reduced motion); the sign and the LIVE bug breathe
    this.tickerTex.offset.x = (t * 0.035 * (0.35 + 0.65 * mo)) % 1;
    this.sign.color.setScalar(1.45 + boost * 0.5 + Math.sin(t * 2.1) * 0.06);
    this.liveBug.color.setScalar(Math.sin(t * 3.2) > -0.3 || mo < 0.2 ? 1.4 : 0.55);
    // ON AIR: lit, flashing after a hit; the video wall flickers with it
    this.onAir = Math.max(0, this.onAir - dt * 1.6);
    const flick = this.onAir > 0 && mo > 0.2 ? (Math.sin(t * 40) > 0 ? 1 : 0.4) : 1;
    this.onAirMat.color.setScalar(1.15 + this.onAir * 1.4 * flick);
    this.screenMat.color.setScalar(1 + this.onAir * 0.35 * (flick - 0.4));
    // the desk's glow follows the show; the decor cameras' tally lights blink
    this.deskGlow.color.setHex(CYAN).multiplyScalar(1.4 + ex * 0.4 + boost * 0.5 + Math.sin(t * 1.3) * 0.12 * mo);
    this.decorTally.color.setHex(RED).multiplyScalar(Math.sin(t * 1.7) > -0.5 ? 2 : 0.4);
    // 1.9.9: the floor PAR cans breathe with the show (steady with reduced motion)
    if (this.parGlow && this.parGlowV) {
      const k = 1.5 + ex * 0.4 + boost * 0.4;
      this.parGlow.color.setHex(CYAN).multiplyScalar(k + Math.sin(t * 1.9) * 0.3 * mo);
      this.parGlowV.color.setHex(VIOLET).multiplyScalar(k + Math.sin(t * 1.9 + 1.6) * 0.3 * mo);
    }
    // the living LED wall: a few tiles change each frame (none on the low preset or with reduced motion)
    const tl = this.tiles;
    if (tl && !this.low && mo > 0.2) {
      const n = tl.count;
      for (let k = 0; k < 3; k++) {
        const i = Math.floor((t * 29 + k * 53) % n);
        const on = Math.sin(t * 2.3 + i * 1.7) > -0.1;
        tl.setColorAt(i, _c.copy(this.tileBase[i]).multiplyScalar(on ? 1 + ex * 0.5 : 0.35));
      }
      if (tl.instanceColor) tl.instanceColor.needsUpdate = true;
    }
    for (const p of this.pools) p.mat.color.setHex(p.col).multiplyScalar(p.base * (1 + Math.sin(t * 0.8 + p.ph) * 0.25 * mo + boost * 0.4));
    for (const c of this.cams) {
      c.nod = Math.max(0, c.nod - dt * 2.2);
      c.flash = Math.max(0, c.flash - dt * 1.5);
      c.head.rotation.x = Math.sin(t * 18) * 0.12 * c.nod * mo;
      c.tally.color.setHex(RED).multiplyScalar(1.2 + c.flash * 1.4);
    }
    for (const M of this.monitors) {
      if (!M.broken) continue;
      M.flicker = Math.max(0, M.flicker - dt);
      M.screen.material = M.flicker > 0 && Math.sin(t * (mo > 0.5 ? 46 : 6)) > 0 ? M.live : M.dead;
    }
    for (const L of this.tallies) {
      if (!L.broken) {
        L.glow.opacity = 0.88 + Math.sin(t * 2.6 + L.globe.id) * 0.07;
        continue;
      }
      L.flicker = Math.max(0, L.flicker - dt);
      const on = L.flicker > 0 && Math.sin(t * (mo > 0.5 ? 50 : 6)) > 0;
      L.glow.opacity = on ? 0.9 : 0.08;
    }
    this.updateCovers(dt, t);
    if (this.pieces.busy) this.pieces.update(this.debrisFrozen ? 0 : dt);
  }

  private updateCovers(dt: number, t: number): void {
    const step = this.debrisFrozen ? 0 : dt;
    for (const v of this.covers) {
      v.hitCd = Math.max(0, v.hitCd - dt);
      if (v.stage >= 3 || v.shake <= 0) continue;
      v.shake = Math.max(0, v.shake - step);
      const a = v.shake * 0.06 * (0.25 + 0.75 * this.motion);
      v.body.position.set(Math.sin(t * 71 + v.phase) * a, 0, Math.cos(t * 63 + v.phase) * a * 0.6);
      if (v.shake === 0) v.body.position.set(0, 0, 0);
    }
  }

  override dispose(): void {
    super.dispose();
    for (const g of this.extraGeos) g.dispose();
    for (const m of this.extraMats) {
      const mm = m as Material & { map?: { dispose(): void } | null; emissiveMap?: { dispose(): void } | null };
      if (mm.map && !this.sh.owned.has(mm.map as never)) mm.map.dispose();
      mm.emissiveMap?.dispose();
      m.dispose();
    }
  }
}

/** A small round PAR-can lens (a disc facing −z before the can's tilt). */
class CircleLensGeometry extends CylinderGeometry {
  constructor() {
    super(0.15, 0.15, 0.02, 12);
    this.rotateX(Math.PI / 2);
  }
}
