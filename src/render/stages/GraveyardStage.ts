import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
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
  paintTexture,
  Pieces,
  ringShape,
  Stage,
  surfaceY,
  swingCones,
  tint,
  WALL_TOP,
  type DebrisShape,
  type DecorLayout,
  type SpotCone,
  type StageShared,
} from './StageKit';

// GRAVEYARD BROADCAST — CURSED CEMETERY SET (Alpha 1.7.5, Halloween Premiere). The channel's
// second Halloween set: a stylised studio cemetery — clearly a set: a plywood crypt with its
// battens showing, a stage moon on a truss, TV spotlights over the graves. Its own palette
// (ghostly teal, violet, pumpkin orange) and the first cover on the fighting floor itself:
// tombstones, monument columns and giant jack-o'-lanterns on hay bales. They crack, chip
// and shatter in four looks (the simulation decides when: src/combat/Covers.ts); their
// pieces fly as ordinary set debris (StageKit Pieces: rest, then shrink away). Atmospheric,
// never gory.

const DEF = arenaById('graveyard');
const COVERS: readonly ArenaCoverDef[] = DEF.covers ?? [];
const FONT = 'Unbounded, "Arial Black", sans-serif';
const TEAL = 0x3affd0;
const VIOLET = 0xa64dff;
const ORANGE = 0xff7a1a;
const _c = new Color();
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _v = new Vector3();
const _up = new Vector3(0, 1, 0);

// ------------------------------------------------------------------ textures
function drawFloor(): { map: CanvasTexture; emissive: CanvasTexture } {
  const { c, g, e, eg, X, Y, ppu, W, H } = floorCanvas(1024);
  // mossy cemetery lawn
  g.fillStyle = '#121a19';
  g.fillRect(0, 0, W, H);
  const rng = new Rng(1975);
  for (let i = 0; i < 2600; i++) {
    const v = rng.range(18, 34);
    g.fillStyle = rng.chance(0.55) ? `rgba(${v}, ${v + 22}, ${v + 12}, 0.55)` : `rgba(${v + 10}, ${v + 6}, ${v + 14}, 0.5)`;
    g.fillRect(rng.range(0, W), rng.range(0, H), rng.range(2, 5), rng.range(1, 3));
  }
  // a flagstone walk from corner to corner of the broadcast (along Z) and across the middle
  const stone = (x: number, z: number, w: number, h: number) => {
    const v = rng.range(46, 66);
    g.fillStyle = `rgb(${v}, ${v - 2}, ${v + 8})`;
    g.beginPath();
    g.roundRect(X(x - w / 2), Y(z - h / 2), w * ppu, h * ppu, 9);
    g.fill();
    g.strokeStyle = 'rgba(10, 14, 16, 0.6)';
    g.lineWidth = 2;
    g.stroke();
  };
  for (let z = -6.4; z <= 6.4; z += 0.86) stone(rng.range(-0.08, 0.08), z, rng.range(0.9, 1.2), 0.7);
  for (const sx of [-1, 1]) for (let x = 1.1; x <= 4.4; x += 0.84) stone(sx * x, rng.range(-0.06, 0.06), 0.68, rng.range(0.8, 1.0));
  // fallen leaves
  for (let i = 0; i < 90; i++) {
    g.fillStyle = rng.chance(0.5) ? 'rgba(210, 110, 30, 0.75)' : 'rgba(130, 70, 40, 0.7)';
    g.save();
    g.translate(rng.range(0, W), rng.range(0, H));
    g.rotate(rng.range(0, 6));
    g.beginPath();
    g.ellipse(0, 0, 7, 3.5, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // grave plots under the cover: dark earth, a moss rim and a faint teal ring (it stays when the piece is gone)
  for (const cv of COVERS) {
    const t = COVER_TUNING[cv.kind];
    const rx = (t.half + t.radius + 0.22) * ppu;
    const rz = (t.radius + 0.24) * ppu;
    for (const ctx of [g, eg]) {
      ctx.save();
      ctx.translate(X(cv.x), Y(cv.z));
      ctx.rotate(-(cv.yaw ?? 0));
      if (ctx === g) {
        ctx.fillStyle = 'rgba(18, 12, 10, 0.85)';
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, cv.kind === 'tombstone' ? rz : rx, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(70, 120, 70, 0.55)';
        ctx.lineWidth = 6;
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(58, 255, 208, 0.35)';
        ctx.shadowColor = 'rgba(58, 255, 208, 0.8)';
        ctx.shadowBlur = 14;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx + 6, (cv.kind === 'tombstone' ? rz : rx) + 6, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  // ghostly teal glow creeping in from the fence
  for (const ctx of [g, eg]) {
    ctx.save();
    ctx.strokeStyle = ctx === eg ? 'rgba(58, 255, 208, 0.5)' : 'rgba(40, 200, 170, 0.55)';
    ctx.lineWidth = 0.45 * ppu;
    if (ctx === eg) {
      ctx.shadowColor = 'rgba(58, 255, 208, 0.9)';
      ctx.shadowBlur = 30;
    }
    ctx.beginPath();
    insetPath(ctx, X, Y, ppu, ARENA.wallX - 0.25, ARENA.wallZ - 0.25, ARENA.wallCorner - 0.25);
    ctx.stroke();
    ctx.restore();
  }
  // contender marks: ghost teal for the player, pumpkin orange for the rival
  for (const [z, col] of [
    [ARENA.halfZ + 0.6, 'rgba(90, 255, 215, 0.85)'],
    [-ARENA.halfZ - 0.6, 'rgba(255, 130, 40, 0.85)'],
  ] as [number, string][]) {
    for (const ctx of [g, eg]) {
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 5;
      if (ctx === eg) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
      }
      ctx.beginPath();
      const up = z > 0;
      ctx.arc(X(0), Y(z), 2.3 * ppu, up ? Math.PI * 1.1 : Math.PI * 0.1, up ? Math.PI * 1.9 : Math.PI * 0.9);
      ctx.stroke();
      ctx.restore();
    }
  }
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `italic 900 ${Math.round(ppu * 0.34)}px ${FONT}`;
  g.fillStyle = 'rgba(160, 255, 230, 0.16)';
  g.fillText('GRAVEYARD', X(0), Y(1.55));
  g.fillText('BROADCAST', X(0), Y(-1.55));
  g.restore();
  return { map: canvasTexture(c), emissive: canvasTexture(e) };
}

function groundTexture(): CanvasTexture {
  const t = paintTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#0d1413';
    g.fillRect(0, 0, w, h);
    const rng = new Rng(77);
    for (let i = 0; i < 600; i++) {
      g.fillStyle = rng.chance(0.4) ? 'rgba(40, 80, 50, 0.4)' : 'rgba(30, 30, 44, 0.45)';
      g.fillRect(rng.range(0, w), rng.range(0, h), rng.range(2, 6), rng.range(1, 3));
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(20, 20);
  return t;
}

function fogTexture(): CanvasTexture {
  const t = paintTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const rng = new Rng(29);
    for (let i = 0; i < 24; i++) {
      const x = rng.range(0, w);
      const y = rng.range(0, h);
      const r = rng.range(30, 80);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
      grd.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = grd;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) g.fillRect(x - r + ox, y - r + oy, r * 2, r * 2);
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Jagged crack lines (stage 1: a few, stage 2: many, darker, with chipped corners). */
function paintCracks(g: CanvasRenderingContext2D, w: number, h: number, stage: number, seed: number): void {
  if (stage <= 0) return;
  const rng = new Rng(seed);
  g.save();
  g.strokeStyle = stage === 1 ? 'rgba(14, 10, 20, 0.85)' : 'rgba(6, 4, 10, 0.95)';
  g.lineCap = 'round';
  const n = stage === 1 ? 3 : 7;
  for (let i = 0; i < n; i++) {
    let x = rng.range(w * 0.15, w * 0.85);
    let y = i % 2 ? h * 0.02 : rng.range(h * 0.1, h * 0.5);
    g.lineWidth = stage === 1 ? 2.2 : 3.4;
    g.beginPath();
    g.moveTo(x, y);
    const steps = stage === 1 ? 5 : 8;
    for (let k = 0; k < steps; k++) {
      x += rng.range(-w * 0.12, w * 0.12);
      y += rng.range(h * 0.05, h * 0.13);
      g.lineTo(x, y);
      if (rng.chance(0.35)) {
        // a branch
        g.moveTo(x, y);
        g.lineTo(x + rng.range(-w * 0.12, w * 0.12), y + rng.range(h * 0.03, h * 0.08));
        g.moveTo(x, y);
      }
    }
    g.stroke();
  }
  if (stage >= 2) {
    // chipped, darkened edges
    g.fillStyle = 'rgba(10, 8, 14, 0.55)';
    for (let i = 0; i < 6; i++) {
      const x = rng.chance(0.5) ? rng.range(0, w * 0.15) : rng.range(w * 0.85, w);
      const y = rng.range(0, h);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + rng.range(-18, 18), y + rng.range(6, 22));
      g.lineTo(x + rng.range(-18, 18), y + rng.range(-12, 12));
      g.closePath();
      g.fill();
    }
  }
  g.restore();
}

const EPITAPHS = [
  ['R.I.P.', 'THE LAST', 'RERUN'],
  ['HERE LIES', 'LOW', 'RATINGS'],
];

/** Tombstone face (planar over the whole slab: chunks share it, cracks run across their seams). */
function tombTexture(epitaph: string[], stage: number, seed: number): { map: CanvasTexture; glow: CanvasTexture } {
  const w = 256;
  const h = 288;
  const rng = new Rng(seed);
  const map = paintTexture(w, h, (g) => {
    g.fillStyle = '#7e788a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 380; i++) {
      const v = rng.range(80, 130);
      g.fillStyle = `rgba(${v}, ${v - 6}, ${v + 12}, 0.35)`;
      g.fillRect(rng.range(0, w), rng.range(0, h), rng.range(2, 5), rng.range(2, 5));
    }
    // moss creeping up from the ground
    for (let i = 0; i < 140; i++) {
      g.fillStyle = 'rgba(70, 120, 70, 0.35)';
      g.beginPath();
      g.arc(rng.range(0, w), h - rng.range(0, 60) * rng.next(), rng.range(2, 7), 0, Math.PI * 2);
      g.fill();
    }
    // engraved frame and epitaph
    g.strokeStyle = 'rgba(30, 26, 38, 0.7)';
    g.lineWidth = 4;
    g.strokeRect(22, 30, w - 44, h - 70);
    g.fillStyle = 'rgba(28, 24, 36, 0.9)';
    g.textAlign = 'center';
    g.font = `900 30px ${FONT}`;
    g.fillText(epitaph[0], w / 2, 88);
    g.font = `900 24px ${FONT}`;
    g.fillText(epitaph[1], w / 2, 140);
    g.fillText(epitaph[2], w / 2, 176);
    g.fillRect(w / 2 - 40, 196, 80, 3);
    paintCracks(g, w, h, stage, seed * 7 + 3);
  });
  const glow = paintTexture(w, h, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.font = `900 30px ${FONT}`;
    g.fillText(epitaph[0], w / 2, 88);
    g.font = `900 24px ${FONT}`;
    g.fillText(epitaph[1], w / 2, 140);
    g.fillText(epitaph[2], w / 2, 176);
  });
  return { map, glow };
}

/** Monument column stone: lilac marble veins, moss at the foot, a band of glowing runes near the top. */
function columnTexture(stage: number): { map: CanvasTexture; glow: CanvasTexture } {
  const w = 256;
  const h = 256;
  const rng = new Rng(404);
  const map = paintTexture(w, h, (g) => {
    g.fillStyle = '#5e5a6c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(160, 150, 190, 0.35)';
    g.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      let x = rng.range(0, w);
      g.beginPath();
      g.moveTo(x, 0);
      for (let y = 0; y < h; y += 24) {
        x += rng.range(-10, 10);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 160; i++) {
      g.fillStyle = 'rgba(70, 120, 70, 0.35)';
      g.beginPath();
      g.arc(rng.range(0, w), h - rng.range(0, 50) * rng.next(), rng.range(2, 6), 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(26, 22, 34, 0.75)';
    g.fillRect(0, 34, w, 3);
    g.fillRect(0, 62, w, 3);
    paintCracks(g, w, h, stage, 911);
  });
  const glow = paintTexture(w, h, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.font = `900 18px ${FONT}`;
    g.textBaseline = 'middle';
    const runes = '✦ ☾ ✧ ✦ ☾ ✧ ✦ ☾';
    g.textAlign = 'center';
    g.fillText(runes, w / 2, 49);
  });
  return { map, glow };
}

/** Pumpkin skin: white (vertex colours carry the orange), dark crack lines per stage. */
function pumpkinSkin(stage: number): CanvasTexture {
  return paintTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    const rng = new Rng(55);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = 'rgba(200, 160, 120, 0.25)';
      g.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 3), rng.range(4, 10));
    }
    paintCracks(g, w, h, stage, 321);
  });
}

/** Carved face (toward +Z at u = 0.25): glowing eyes, nose and a toothy grin. */
function pumpkinFace(): CanvasTexture {
  return paintTexture(256, 128, (g) => {
    g.fillStyle = '#1a0800';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#ffd24a';
    g.shadowColor = '#ffb020';
    g.shadowBlur = 6;
    const cx = 64;
    for (const dx of [-14, 14]) {
      g.beginPath();
      g.moveTo(cx + dx - 8, 50);
      g.lineTo(cx + dx + 8, 50);
      g.lineTo(cx + dx + (dx < 0 ? 4 : -4), 36);
      g.closePath();
      g.fill();
    }
    g.beginPath();
    g.moveTo(cx - 3, 60);
    g.lineTo(cx + 3, 60);
    g.lineTo(cx, 54);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(cx - 22, 66);
    g.quadraticCurveTo(cx, 86, cx + 22, 66);
    g.lineTo(cx + 15, 71);
    g.lineTo(cx + 10, 67);
    g.lineTo(cx + 5, 74);
    g.lineTo(cx, 69);
    g.lineTo(cx - 5, 74);
    g.lineTo(cx - 10, 67);
    g.lineTo(cx - 15, 71);
    g.closePath();
    g.fill();
  });
}

function strawTexture(): CanvasTexture {
  return paintTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#b8902e';
    g.fillRect(0, 0, w, h);
    const rng = new Rng(8);
    for (let i = 0; i < 260; i++) {
      g.strokeStyle = rng.chance(0.5) ? 'rgba(240, 200, 90, 0.6)' : 'rgba(120, 80, 20, 0.55)';
      g.lineWidth = 1;
      const x = rng.range(0, w);
      const y = rng.range(0, h);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + rng.range(-12, 12), y + rng.range(-3, 3));
      g.stroke();
    }
    g.fillStyle = 'rgba(60, 40, 10, 0.5)';
    g.fillRect(0, h * 0.3, w, 3);
    g.fillRect(0, h * 0.7, w, 3);
  });
}

function doorGlowTexture(): CanvasTexture {
  return paintTexture(128, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, h, 0, 0);
    grd.addColorStop(0, 'rgba(120, 255, 220, 1)');
    grd.addColorStop(0.6, 'rgba(40, 180, 160, 0.9)');
    grd.addColorStop(1, 'rgba(60, 30, 120, 0.9)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(10, 30, 30, 0.55)';
    for (let i = 0; i < 6; i++) g.fillRect(0, i * 42 + 10, w, 4);
  });
}

// ---------------------------------------------------------------- geometry
/**
 * Planar UVs over a slab (applied before a chunk is centred): the front and back faces show the
 * engraved face (u along X, v up Y); edges and tops take a strip of plain stone from the margin.
 */
function planarUV(geo: BufferGeometry, x0: number, w: number, y0: number, h: number): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const fy = (pos.getY(i) - y0) / h;
    if (Math.abs(nor.getZ(i)) > 0.6) {
      uv[i * 2] = (pos.getX(i) - x0) / w;
      uv[i * 2 + 1] = fy;
    } else {
      const f = ((((pos.getX(i) + pos.getZ(i)) * 2) % 1) + 1) % 1;
      uv[i * 2] = 0.935 + 0.05 * f;
      uv[i * 2 + 1] = 0.1 + 0.8 * Math.min(1, Math.max(0, fy));
    }
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return g;
}

/** A chunk built in its piece's local frame: centred on its own origin, `at` = where that origin sits. */
interface Chunk {
  geo: BufferGeometry;
  at: Vector3;
  /** Half sizes for the flat landing of the debris (thinnest axis ends up vertical). */
  half: [number, number, number];
}

function centred(geo: BufferGeometry, half?: [number, number, number]): Chunk {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const at = new Vector3();
  bb.getCenter(at);
  geo.translate(-at.x, -at.y, -at.z);
  const sz = new Vector3();
  bb.getSize(sz);
  return { geo, at, half: half ?? [sz.x / 2, sz.y / 2, sz.z / 2] };
}

/** Tombstone: low plinth (stays as rubble) + a slab pre-split into five chunks (staggered like masonry). */
function tombChunks(): { plinth: BufferGeometry; chunks: Chunk[]; top: number } {
  const W = 1.12;
  const T = 0.34;
  const x0 = -W / 2;
  const y0 = 0.14;
  const H = 1.18;
  const box = (xa: number, xb: number, ya: number, yb: number) => planarUV(new BoxGeometry(xb - xa, yb - ya, T).translate((xa + xb) / 2, (ya + yb) / 2, 0), x0, W, y0, H);
  const archRaw = new CylinderGeometry(W / 2, W / 2, T, 18, 1, false, -Math.PI / 2, Math.PI);
  archRaw.rotateX(-Math.PI / 2);
  archRaw.scale(1, 0.3 / (W / 2), 1);
  archRaw.translate(0, 1.02, 0);
  const arch = planarUV(archRaw, x0, W, y0, H);
  const plinth = new BoxGeometry(1.26, 0.14, 0.56).translate(0, 0.07, 0);
  return {
    plinth,
    chunks: [centred(box(-0.56, -0.08, 0.14, 0.62)), centred(box(-0.08, 0.56, 0.14, 0.62)), centred(box(-0.56, 0.1, 0.62, 1.02)), centred(box(0.1, 0.56, 0.62, 1.02)), centred(arch)],
    top: 4,
  };
}

/** Fluted half drum of the column shaft (theta: which half), UVs global around and up the column. */
function halfDrum(y0: number, h: number, theta: number): BufferGeometry {
  const g = new CylinderGeometry(0.36, 0.36, h, 10, 1, false, theta, Math.PI);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 0.01) {
      const a = Math.atan2(x, z);
      const k = 1 + 0.06 * Math.cos(a * 12);
      pos.setXYZ(i, x * k, pos.getY(i), z * k);
    }
    uv.setXY(i, (theta + uv.getX(i) * Math.PI) / (Math.PI * 2), (pos.getY(i) + h / 2 + y0) / 1.95);
  }
  g.computeVertexNormals();
  g.translate(0, y0 + h / 2, 0);
  return g;
}

/** Monument column: two-step plinth (stays), three fluted drums in halves, capital with a stone urn. */
function columnChunks(): { plinth: BufferGeometry; chunks: Chunk[]; capital: number } {
  const plinth = merge([new BoxGeometry(1.0, 0.2, 1.0).translate(0, 0.1, 0), new BoxGeometry(0.86, 0.1, 0.86).translate(0, 0.25, 0)]);
  const chunks: Chunk[] = [];
  const ys = [0.3, 0.77, 1.24];
  for (const y of ys) for (const th of [0, Math.PI]) chunks.push(centred(halfDrum(y, 0.47, th)));
  const cap = new CylinderGeometry(0.52, 0.4, 0.24, 14).translate(0, 1.71 + 0.12, 0);
  const urn = new LatheGeometry([new Vector2(0.0, 0), new Vector2(0.14, 0.02), new Vector2(0.2, 0.12), new Vector2(0.16, 0.26), new Vector2(0.09, 0.3), new Vector2(0.12, 0.34), new Vector2(0, 0.35)], 12).translate(0, 1.95, 0);
  const capital = merge([cap, urn]);
  const pos = capital.getAttribute('position');
  const uv = capital.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.atan2(pos.getX(i), pos.getZ(i)) / (Math.PI * 2) + 1) % 1, Math.min(1, pos.getY(i) / 1.95));
  chunks.push(centred(capital));
  return { plinth, chunks, capital: chunks.length - 1 };
}

/** Giant jack-o'-lantern in six wedges (face toward +Z), its stem, and the glowing inside. */
function pumpkinChunks(): { wedges: Chunk[]; stem: Chunk; inner: BufferGeometry } {
  const wedges: Chunk[] = [];
  const RX = 0.52;
  const RY = 0.43;
  const base = 0.34;
  for (let k = 0; k < 6; k++) {
    const phi0 = (k * Math.PI) / 3;
    const g = new SphereGeometry(1, 6, 12, phi0, Math.PI / 3);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      let y = pos.getY(i);
      const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const rib = 1 + 0.08 * Math.cos(a * 8) * (1 - Math.abs(y) ** 3);
      if (y < -0.7) y = -0.7 + (y + 0.7) * 0.3;
      pos.setXYZ(i, x * rib * RX, base + (y + 0.79) * RY, z * rib * RX);
      uv.setX(i, (phi0 + uv.getX(i) * (Math.PI / 3)) / (Math.PI * 2));
    }
    g.computeVertexNormals();
    tint(g, ORANGE);
    wedges.push(centred(g));
  }
  const stem = new CylinderGeometry(0.05, 0.09, 0.26, 7);
  stem.rotateZ(0.2);
  stem.translate(0.02, base + 1.79 * RY + 0.08, 0);
  tint(stem, 0x4a7a2a);
  const inner = new SphereGeometry(0.9, 12, 8);
  inner.scale(RX, RY, RX);
  inner.translate(0, base + 0.79 * RY, 0);
  return { wedges, stem: centred(stem), inner };
}

// ------------------------------------------------------------------ set pieces
interface CoverView {
  kind: ArenaCoverDef['kind'];
  x: number;
  z: number;
  yaw: number;
  group: Group;
  /** Wobbles (pumpkin) / shakes (stone) on hits; the remains stay in `group`. */
  body: Group;
  chunks: Mesh[];
  /** Local transform of every chunk before the break (restored on reset). */
  home: { p: Vector3; q: Quaternion; s: Vector3 }[];
  halves: [number, number, number][];
  remains: Mesh | null;
  mats: Material[];
  stage: number;
  shake: number;
  wobble: number;
  wobbleV: number;
  wobAxis: Vector3;
  hitCd: number;
  /** Pumpkin: candle light inside and the material whose glow flickers. */
  inner: Mesh | null;
  glowMat: MeshStandardMaterial | null;
  phase: number;
  /** Index of the chunk knocked off at the battered look (-1: decided on the hit). */
  lost: number;
}

interface PumpkinP {
  body: Mesh;
  mat: MeshStandardMaterial;
  shards: Mesh[];
  x: number;
  z: number;
  y: number;
  broken: boolean;
  phase: number;
}

interface LampP {
  head: Group;
  glow: MeshBasicMaterial;
  flame: Mesh;
  out: number;
  flicker: number;
  broken: boolean;
}

interface Wisp {
  x: number;
  z: number;
  y0: number;
  speed: number;
  phase: number;
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
    { x: 0, y: 6.25, z: -14.5, rx: -0.08, ry: 0, w: 7.0, h: 3.8, front: 0.2, size: 1.6 },
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

const WISPS = 26;

export class GraveyardStage extends Stage {
  readonly id = 'graveyard' as const;
  readonly layout = LAYOUT;
  private cones: SpotCone[] = [];
  private pieces = new Pieces();
  private covers: CoverView[] = [];
  private coverGroup = new Group();
  private pumpkins: PumpkinP[] = [];
  private lamps: LampP[] = [];
  private propMap: ({ k: 'pumpkin'; i: number } | { k: 'lamp'; i: number } | { k: 'gate' })[] = [];
  private fogPlanes: Mesh[] = [];
  private fogMat!: MeshBasicMaterial;
  private edgeFogMat!: MeshBasicMaterial;
  private wisps!: Points;
  private wispMat!: ShaderMaterial;
  private wispData: Wisp[] = [];
  private moonGlow!: MeshBasicMaterial;
  private doorGlow!: MeshBasicMaterial;
  private gateSign!: MeshBasicMaterial;
  private gateFlicker = 0;
  private premiere!: MeshBasicMaterial;
  private postGlow!: MeshBasicMaterial;
  private gatePos = new Vector3();
  /** Shared geometry and the per-look materials of the cover (freed in dispose()). */
  private extraMats: Material[] = [];
  private extraGeos: BufferGeometry[] = [];
  private tombMats: MeshStandardMaterial[][] = [];
  private columnMats: MeshStandardMaterial[] = [];
  private pumpkinMats: MeshStandardMaterial[] = [];
  private stoneChip!: BufferGeometry;
  private chipMat!: MeshLambertMaterial;
  private chips: Mesh[] = [];
  private chipNext = 0;

  constructor(shared: StageShared) {
    super(shared);
    this.buildFloor();
    this.buildBarrier();
    this.buildCrypt();
    this.buildCemetery();
    this.buildFog();
    this.buildWisps();
    this.buildProps();
    this.buildLights();
    this.buildCovers();
    this.group.add(this.coverGroup);
  }

  private buildFloor(): void {
    const { map, emissive } = drawFloor();
    this.group.add(floorMesh(map, emissive, { roughness: 0.86, metalness: 0.04, emissiveIntensity: 1.1 }, 0x101614));
    const ground = new Mesh(new PlaneGeometry(90, 90), new MeshStandardMaterial({ map: groundTexture(), roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    this.group.add(ground);
  }

  /** Mossy stone curb, a wrought-iron fence with round finials, posts with ghost-teal lantern caps. */
  private buildBarrier(): void {
    const stone = new MeshStandardMaterial({ color: 0x343a3c, roughness: 0.95, metalness: 0.02 });
    const wall = new Mesh(flatExtrude(ringShape(ARENA.wallX, ARENA.wallZ, ARENA.wallCorner, 0.45), WALL_TOP), stone);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.group.add(wall);
    // moss along the top edge
    const moss = flatExtrude(ringShape(ARENA.wallX + 0.05, ARENA.wallZ + 0.05, ARENA.wallCorner + 0.05, 0.32), 0.03);
    moss.translate(0, WALL_TOP, 0);
    this.group.add(new Mesh(moss, new MeshStandardMaterial({ color: 0x2c4a32, roughness: 1 })));
    const iron = new MeshStandardMaterial({ color: 0x14161c, roughness: 0.5, metalness: 0.6 });
    for (const y of [0.16, 0.46]) {
      const rail = flatExtrude(ringShape(ARENA.wallX + 0.18, ARENA.wallZ + 0.18, ARENA.wallCorner + 0.18, 0.04), 0.035);
      rail.translate(0, WALL_TOP + y, 0);
      this.group.add(new Mesh(rail, iron));
    }
    const picket = merge([new CylinderGeometry(0.016, 0.016, 0.5, 5).translate(0, 0.25, 0), new SphereGeometry(0.035, 6, 4).translate(0, 0.53, 0)]);
    const hx = ARENA.wallX + 0.2;
    const hz = ARENA.wallZ + 0.2;
    const r = ARENA.wallCorner + 0.2;
    const per = 2 * (2 * (hx - r) + 2 * (hz - r)) + 2 * Math.PI * r;
    const n = Math.round(per / 0.26);
    const pickets = new InstancedMesh(picket, iron, n);
    const rng = new Rng(13);
    for (let i = 0; i < n; i++) {
      const p = pointOnRing(hx, hz, r, (i / n) * per);
      // a little crooked, like an old cemetery fence
      _q.setFromAxisAngle(_v.set(rng.range(-1, 1), 0, rng.range(-1, 1)).normalize(), rng.range(-0.05, 0.05));
      _m.compose(_p.set(p.x, WALL_TOP, p.z), _q, _s.setScalar(1));
      pickets.setMatrixAt(i, _m);
    }
    this.group.add(pickets);
    // stone posts with lantern caps
    const W = ARENA.wallX + 0.22;
    const Z = ARENA.wallZ + 0.22;
    const c = ARENA.wallCorner;
    const k = 0.29;
    const posts: [number, number][] = [
      [-W, 0.4],
      [W, -0.4],
      [-(W - c * k), -(Z - c * k)],
      [W - c * k, -(Z - c * k)],
      [-(W - c * k), Z - c * k],
      [W - c * k, Z - c * k],
    ];
    const pil: BufferGeometry[] = [];
    const caps: BufferGeometry[] = [];
    for (const [x, z] of posts) {
      pil.push(new BoxGeometry(0.46, 1.2, 0.46).translate(x, 0.6, z));
      pil.push(new ConeGeometry(0.36, 0.3, 4).rotateY(Math.PI / 4).translate(x, 1.62, z));
      caps.push(new BoxGeometry(0.2, 0.26, 0.2).translate(x, 1.34, z));
    }
    this.group.add(new Mesh(merge(pil), stone));
    this.postGlow = new MeshBasicMaterial({ color: new Color(TEAL).multiplyScalar(1.8), toneMapped: false });
    this.group.add(new Mesh(merge(caps), this.postGlow));
  }

  /** The plywood crypt: columns, pediment, a glowing doorway, the big screen, signs and the stage moon. */
  private buildCrypt(): void {
    const zf = -15.4;
    const s = new Shape();
    s.moveTo(-10.5, 0);
    s.lineTo(-10.5, 4.6);
    s.lineTo(-9.4, 5.6);
    s.lineTo(-8.3, 4.6);
    s.lineTo(-7.2, 4.6);
    s.lineTo(-7.2, 8.4);
    s.lineTo(0, 10.8);
    s.lineTo(7.2, 8.4);
    s.lineTo(7.2, 4.6);
    s.lineTo(8.3, 4.6);
    s.lineTo(9.4, 5.6);
    s.lineTo(10.5, 4.6);
    s.lineTo(10.5, 0);
    s.closePath();
    const flatMat = new MeshStandardMaterial({ color: 0x262a36, roughness: 0.9, emissive: 0x060a10 });
    const flat = new Mesh(new ShapeGeometry(s), flatMat);
    flat.position.set(0, GROUND_Y, zf);
    this.group.add(flat);
    // trim lines: pediment and cornices
    const trim = new MeshBasicMaterial({ color: new Color(VIOLET).multiplyScalar(1.1) });
    const tr: BufferGeometry[] = [];
    const edge = (x0: number, y0: number, x1: number, y1: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const g = new BoxGeometry(len, 0.09, 0.05);
      g.rotateZ(Math.atan2(y1 - y0, x1 - x0));
      tr.push(g.translate((x0 + x1) / 2, GROUND_Y + (y0 + y1) / 2, zf + 0.14));
    };
    edge(-7.4, 8.4, 0, 10.85);
    edge(0, 10.85, 7.4, 8.4);
    edge(-7.4, 8.35, 7.4, 8.35);
    edge(-10.5, 4.6, -7.2, 4.6);
    edge(7.2, 4.6, 10.5, 4.6);
    this.group.add(new Mesh(merge(tr), trim));
    // columns in front of the facade
    const colMat = new MeshStandardMaterial({ color: 0x4a4858, roughness: 0.85 });
    const cols: BufferGeometry[] = [];
    for (const x of [-6.2, -3.4, 3.4, 6.2]) {
      cols.push(new CylinderGeometry(0.34, 0.38, 8.0, 12).translate(x, GROUND_Y + 4.0, zf + 0.5));
      cols.push(new BoxGeometry(0.95, 0.3, 0.95).translate(x, GROUND_Y + 0.15, zf + 0.5));
      cols.push(new BoxGeometry(0.95, 0.3, 0.95).translate(x, GROUND_Y + 8.05, zf + 0.5));
    }
    this.group.add(new Mesh(merge(cols), colMat));
    // the glowing doorway (an arch) with its stone frame
    const door = new Shape();
    door.moveTo(-1.4, 0);
    door.lineTo(1.4, 0);
    door.lineTo(1.4, 2.2);
    door.absarc(0, 2.2, 1.4, 0, Math.PI, false);
    door.lineTo(-1.4, 0);
    this.doorGlow = new MeshBasicMaterial({ map: doorGlowTexture(), toneMapped: false });
    const dm = new Mesh(new ShapeGeometry(door), this.doorGlow);
    dm.position.set(0, GROUND_Y, zf + 0.06);
    // planar uv for the arch
    const dpos = dm.geometry.getAttribute('position');
    const duv = new Float32Array(dpos.count * 2);
    for (let i = 0; i < dpos.count; i++) {
      duv[i * 2] = (dpos.getX(i) + 1.4) / 2.8;
      duv[i * 2 + 1] = dpos.getY(i) / 3.6;
    }
    dm.geometry.setAttribute('uv', new Float32BufferAttribute(duv, 2));
    this.group.add(dm);
    const frame = new Mesh(new TorusGeometry(1.5, 0.12, 6, 20, Math.PI), colMat);
    frame.position.set(0, GROUND_Y + 2.2, zf + 0.12);
    this.group.add(frame);
    this.group.add(new Mesh(merge([new BoxGeometry(0.24, 2.2, 0.24).translate(-1.5, GROUND_Y + 1.1, zf + 0.12), new BoxGeometry(0.24, 2.2, 0.24).translate(1.5, GROUND_Y + 1.1, zf + 0.12)]), colMat));
    // the back of the flat: battens and braces (it is a set)
    const wood = new MeshStandardMaterial({ color: 0x6e5636, roughness: 0.85 });
    const sc: BufferGeometry[] = [];
    for (let x = -10; x <= 10; x += 2) sc.push(new BoxGeometry(0.1, 8, 0.1).translate(x, GROUND_Y + 4, zf - 0.2));
    for (const y of [1.4, 4, 7]) sc.push(new BoxGeometry(21, 0.1, 0.1).translate(0, GROUND_Y + y, zf - 0.2));
    for (const x of [-7, 0, 7]) {
      const b = new BoxGeometry(0.1, 7, 0.1);
      b.rotateX(-0.45);
      sc.push(b.translate(x, GROUND_Y + 3.2, zf - 1.7));
    }
    this.group.add(new Mesh(merge(sc), wood));
    // studio walls far behind
    const wallMat = new MeshStandardMaterial({ color: 0x080d10, roughness: 0.95 });
    const back = new Mesh(new PlaneGeometry(46, 20), wallMat);
    back.position.set(0, 9, -20);
    this.group.add(back);
    for (const sx of [-1, 1]) {
      const side = new Mesh(new PlaneGeometry(34, 20), wallMat);
      side.position.set(sx * 16.5, 9, -3);
      side.rotation.y = (-sx * Math.PI) / 2;
      this.group.add(side);
    }

    // the big screen in a stone frame over the doorway
    const frameMat = new MeshStandardMaterial({ color: 0x1c2026, roughness: 0.5, metalness: 0.4, emissive: 0x061014 });
    const scrMat = new MeshBasicMaterial({ map: this.sh.screenTex, toneMapped: false });
    const scr = new Group();
    scr.add(new Mesh(new BoxGeometry(7.0, 3.8, 0.3), frameMat));
    const sm = new Mesh(new PlaneGeometry(6.5, 3.4), scrMat);
    sm.position.z = 0.16;
    scr.add(sm);
    // a thin glowing teal edge round the frame
    const rim = new Mesh(
      merge([
        new BoxGeometry(7.2, 0.07, 0.05).translate(0, 1.95, 0.16),
        new BoxGeometry(7.2, 0.07, 0.05).translate(0, -1.95, 0.16),
        new BoxGeometry(0.07, 3.97, 0.05).translate(-3.6, 0, 0.16),
        new BoxGeometry(0.07, 3.97, 0.05).translate(3.6, 0, 0.16),
      ]),
      new MeshBasicMaterial({ color: new Color(TEAL).multiplyScalar(1.4), toneMapped: false }),
    );
    scr.add(rim);
    scr.position.set(0, 6.25, -14.5);
    scr.rotation.x = -0.08;
    this.group.add(scr);
    // studio monitors on stands at the sides
    const steel = new MeshStandardMaterial({ color: 0x24262e, roughness: 0.4, metalness: 0.75 });
    for (const sx of [-1, 1]) {
      const g = new Group();
      g.add(new Mesh(new BoxGeometry(3.6, 2.2, 0.22), frameMat));
      const m2 = new Mesh(new PlaneGeometry(3.3, 1.9), scrMat);
      m2.position.z = 0.12;
      g.add(m2);
      g.add(new Mesh(new CylinderGeometry(0.06, 0.06, 3.0, 6).translate(0, -2.4, -0.1), steel));
      g.position.set(sx * 10.8, 3.4, -9.6);
      g.rotation.set(-0.1, -sx * 0.72, 0);
      this.group.add(g);
    }

    // stage moon on its truss (it is a prop: cables and a plywood cloud in front)
    const mx = 9.6;
    const my = 11.4;
    const mz = -18.2;
    const moon = new Mesh(new CircleGeometry(3.0, 48), new MeshBasicMaterial({ color: new Color(0xe8fff6).multiplyScalar(1.45), toneMapped: false }));
    moon.position.set(mx, my, mz);
    this.group.add(moon);
    this.moonGlow = new MeshBasicMaterial({
      map: paintTexture(256, 256, (g, w, h) => {
        const grd = g.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w / 2);
        grd.addColorStop(0, 'rgba(170, 255, 230, 0.5)');
        grd.addColorStop(1, 'rgba(90, 120, 255, 0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
      }),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const halo = new Mesh(new PlaneGeometry(11, 11), this.moonGlow);
    halo.position.set(mx, my, mz - 0.1);
    this.group.add(halo);
    const craters: BufferGeometry[] = [];
    for (const [dx, dy, r] of [
      [-0.9, 0.7, 0.55],
      [0.8, -0.4, 0.7],
      [0.4, 1.2, 0.3],
      [-0.5, -1.1, 0.38],
      [1.5, 0.6, 0.25],
    ])
      craters.push(new CircleGeometry(r, 16).translate(mx + dx, my + dy, mz + 0.02));
    this.group.add(new Mesh(merge(craters), new MeshBasicMaterial({ color: new Color(0xc8dcd2).multiplyScalar(1.15), toneMapped: false })));
    const cloud = new Shape();
    cloud.moveTo(-3.6, 0);
    cloud.absarc(-2.4, 0.4, 1.0, Math.PI, 0, true);
    cloud.absarc(-0.6, 0.8, 1.2, Math.PI, 0, true);
    cloud.absarc(1.4, 0.5, 1.0, Math.PI, 0, true);
    cloud.absarc(2.9, 0.2, 0.7, Math.PI, 0, true);
    cloud.lineTo(3.6, 0);
    cloud.lineTo(-3.6, 0);
    const cl = new Mesh(new ShapeGeometry(cloud), new MeshStandardMaterial({ color: 0x2a2f44, roughness: 0.9, emissive: 0x0a0c18 }));
    cl.position.set(mx - 0.6, my - 2.6, mz + 0.6);
    this.group.add(cl);
    this.group.add(
      new Mesh(
        merge([
          new CylinderGeometry(0.09, 0.09, 8, 6).rotateZ(Math.PI / 2).translate(mx - 1, my + 3.6, mz - 0.3),
          new CylinderGeometry(0.012, 0.012, 3.6, 4).translate(mx - 1.6, my + 1.8 + 0.1, mz - 0.2),
          new CylinderGeometry(0.012, 0.012, 3.6, 4).translate(mx + 1.6, my + 1.8 + 0.1, mz - 0.2),
          new CylinderGeometry(0.09, 0.09, 16, 6).translate(mx + 3.4, my - 4.4, mz - 0.4),
        ]),
        steel,
      ),
    );

    // signs: GRAVEYARD BROADCAST over the door, HALLOWEEN PREMIERE above the pediment
    this.gateSign = neonMaterial(drawNeon('GRAVEYARD BROADCAST', '#3affd0', 1024, 256, 62), 1.6);
    const gs = new Mesh(new PlaneGeometry(5.2, 1.3), this.gateSign);
    gs.position.set(0, GROUND_Y + 3.5, zf + 0.7);
    this.group.add(gs);
    this.premiere = neonMaterial(drawNeon('HALLOWEEN PREMIERE', '#ff8a1f', 1024, 256, 84), 1.5);
    const pm = new Mesh(new PlaneGeometry(9.6, 2.4), this.premiere);
    pm.position.set(-1.0, 12.4, zf - 0.3);
    this.group.add(pm);

    // the cemetery gate in the north barrier gap: iron arch and a fog machine (reactive prop)
    const gx = 0;
    const gz = -ARENA.wallZ - 1.05;
    this.gatePos.set(gx, 0.4, gz);
    const gate: BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      gate.push(new BoxGeometry(0.55, 2.3, 0.55).translate(gx + sx * 1.7, GROUND_Y + 1.15, gz));
      gate.push(new ConeGeometry(0.42, 0.4, 4).rotateY(Math.PI / 4).translate(gx + sx * 1.7, GROUND_Y + 2.5, gz));
    }
    this.group.add(new Mesh(merge(gate), new MeshStandardMaterial({ color: 0x343a3c, roughness: 0.95 })));
    const ironMat = new MeshStandardMaterial({ color: 0x14161c, roughness: 0.5, metalness: 0.6 });
    const ga = new Mesh(new TorusGeometry(1.7, 0.05, 6, 24, Math.PI), ironMat);
    ga.position.set(gx, GROUND_Y + 2.3, gz);
    this.group.add(ga);
    const bars: BufferGeometry[] = [];
    for (let i = -5; i <= 5; i++) bars.push(new CylinderGeometry(0.02, 0.02, 2.2, 4).translate(gx + i * 0.28, GROUND_Y + 1.1, gz));
    this.group.add(new Mesh(merge(bars), ironMat));
    const fx = new Mesh(merge([new BoxGeometry(0.7, 0.45, 0.5).translate(0, 0.22, 0), new CylinderGeometry(0.06, 0.08, 0.3, 8).rotateX(Math.PI / 2).translate(0, 0.26, 0.38)]), steel);
    fx.position.set(gx - 2.7, GROUND_Y, gz + 0.3);
    fx.rotation.y = 0.4;
    this.group.add(fx);
  }

  /** Outside the ring: headstones, obelisks, dead trees, pumpkin piles, TV cameras and lamps. */
  private buildCemetery(): void {
    const rng = new Rng(1313);
    // rounded headstones (one instanced mesh)
    const headGeo = merge([new BoxGeometry(0.66, 0.78, 0.16).translate(0, 0.39, 0), new CylinderGeometry(0.33, 0.33, 0.16, 12, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).translate(0, 0.78, 0)]);
    const tex = tombTexture(['R.I.P.', '', ''], 0, 3).map;
    const headMat = new MeshStandardMaterial({ map: tex, roughness: 0.95 });
    const spots: [number, number, number][] = [];
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 6; i++) spots.push([sx * rng.range(6.6, 10.2), rng.range(-10, 4.2), rng.range(0.7, 1.15)]);
      for (let i = 0; i < 2; i++) spots.push([sx * rng.range(3.6, 8.4), rng.range(-13.4, -11.2), rng.range(0.8, 1.2)]);
    }
    const heads = new InstancedMesh(headGeo, headMat, spots.length);
    spots.forEach(([x, z, sc], i) => {
      _q.setFromAxisAngle(_up, Math.atan2(-x, -z) + rng.range(-0.3, 0.3));
      _q.multiply(new Quaternion().setFromAxisAngle(_v.set(1, 0, 0), rng.range(-0.14, 0.14)));
      _m.compose(_p.set(x, GROUND_Y, z), _q, _s.setScalar(sc));
      heads.setMatrixAt(i, _m);
    });
    this.group.add(heads);
    // obelisks
    const ob: BufferGeometry[] = [];
    for (const [x, z, sc] of [
      [-8.2, -7.4, 1.2],
      [8.6, -6.6, 1.1],
      [-6.0, -12.6, 1.3],
      [6.4, -12.8, 1.2],
    ] as [number, number, number][]) {
      ob.push(new BoxGeometry(0.7 * sc, 0.3 * sc, 0.7 * sc).translate(x, GROUND_Y + 0.15 * sc, z));
      ob.push(new CylinderGeometry(0.16 * sc, 0.28 * sc, 2.0 * sc, 4).rotateY(Math.PI / 4).translate(x, GROUND_Y + (0.3 + 1.0) * sc, z));
      ob.push(new ConeGeometry(0.2 * sc, 0.4 * sc, 4).rotateY(Math.PI / 4).translate(x, GROUND_Y + 2.5 * sc, z));
    }
    this.group.add(new Mesh(merge(ob), new MeshStandardMaterial({ color: 0x4e4a5a, roughness: 0.9 })));
    // big twisted dead trees
    const bark = new MeshStandardMaterial({ color: 0x241a20, roughness: 0.95 });
    const trees: BufferGeometry[] = [];
    const branch = (x: number, y: number, z: number, len: number, rz: number, ry: number, r0: number, depth: number) => {
      const b = new CylinderGeometry(r0 * 0.45, r0, len, 5);
      b.translate(0, len / 2, 0);
      b.rotateZ(rz);
      b.rotateY(ry);
      trees.push(b.translate(x, y, z));
      if (depth <= 0) return;
      // tip of this branch
      _v.set(0, len, 0).applyAxisAngle(new Vector3(0, 0, 1), rz).applyAxisAngle(_up, ry);
      const tx = x + _v.x;
      const ty = y + _v.y;
      const tz = z + _v.z;
      branch(tx, ty, tz, len * 0.62, rz + rng.range(0.3, 0.7), ry + rng.range(-0.6, 0.6), r0 * 0.5, depth - 1);
      branch(tx, ty, tz, len * 0.55, rz - rng.range(0.3, 0.8), ry + rng.range(-0.6, 0.6), r0 * 0.45, depth - 1);
    };
    const tree = (x: number, z: number, s: number) => {
      trees.push(new CylinderGeometry(0.14 * s, 0.34 * s, 3.4 * s, 7).rotateZ(rng.range(-0.08, 0.08)).translate(x, GROUND_Y + 1.7 * s, z));
      for (let i = 0; i < 4; i++) branch(x, GROUND_Y + (2.0 + i * 0.45) * s, z, (1.3 - i * 0.15) * s, (i % 2 ? 1 : -1) * rng.range(0.5, 1.0), rng.range(0, 6.28), 0.1 * s, 1);
    };
    tree(-9.4, -10.8, 1.5);
    tree(10.0, -9.0, 1.35);
    tree(-11.2, -1.6, 1.15);
    tree(11.4, 1.6, 1.2);
    tree(-6.8, -14.6, 1.25);
    tree(13.2, -13.4, 1.5);
    this.group.add(new Mesh(merge(trees), bark));
    // glowing pumpkin piles (decor, not interactive)
    const pgeo = merge([...pumpkinChunks().wedges.map((w) => w.geo.clone().translate(w.at.x, w.at.y - 0.34, w.at.z))]);
    this.extraGeos.push(pgeo);
    const pmat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, emissiveMap: pumpkinFace(), emissive: new Color(1, 0.62, 0.22), emissiveIntensity: 2.2 });
    const piles: [number, number, number][] = [
      [2.9, -9.3, 0.8],
      [3.6, -9.6, 0.6],
      [-3.0, -9.4, 0.75],
      [-7.0, -12.0, 0.95],
      [6.8, -12.3, 0.9],
      [6.1, -11.7, 0.6],
      [-9.9, -4.2, 0.85],
      [9.9, -3.8, 0.8],
      [-8.6, 2.2, 0.7],
      [8.8, 2.6, 0.75],
    ];
    const pp = new InstancedMesh(pgeo, pmat, piles.length);
    piles.forEach(([x, z, sc], i) => {
      _q.setFromAxisAngle(_up, Math.atan2(-x, 6 - z));
      _m.compose(_p.set(x, GROUND_Y, z), _q, _s.setScalar(sc));
      pp.setMatrixAt(i, _m);
    });
    this.group.add(pp);
    this.pumpkinMats.push(pmat);
    // TV cameras on tripods watching the graves (it is still a studio)
    const steel = new MeshStandardMaterial({ color: 0x22242c, roughness: 0.4, metalness: 0.7 });
    const lens = new MeshBasicMaterial({ color: new Color(0xff3a5a).multiplyScalar(2), toneMapped: false });
    for (const [x, z] of [
      [-7.8, -7.8],
      [7.9, -8.2],
    ] as [number, number][]) {
      const g = new Group();
      g.position.set(x, GROUND_Y, z);
      g.rotation.y = Math.atan2(-x, -z);
      const legs: BufferGeometry[] = [];
      for (let i = 0; i < 3; i++) {
        const l = new CylinderGeometry(0.025, 0.03, 1.6, 5);
        l.translate(0, 0.8, 0);
        l.rotateX(0.32);
        l.rotateY((i * Math.PI * 2) / 3);
        legs.push(l);
      }
      legs.push(new BoxGeometry(0.42, 0.34, 0.7).translate(0, 1.66, 0));
      legs.push(new CylinderGeometry(0.11, 0.13, 0.32, 10).rotateX(Math.PI / 2).translate(0, 1.66, 0.48));
      g.add(new Mesh(merge(legs), steel));
      const tally = new Mesh(new BoxGeometry(0.08, 0.05, 0.05), lens);
      tally.position.set(0, 1.86, 0.2);
      g.add(tally);
      this.group.add(g);
    }
  }

  /** Low theatrical fog: strips outside the fence and a thin wisp along the inside edge (never over the middle). */
  private buildFog(): void {
    const tex = fogTexture();
    this.fogMat = new MeshBasicMaterial({ map: tex, color: new Color(0x9ad8ff).multiplyScalar(0.85), transparent: true, depthWrite: false, opacity: 0.85 });
    const strips: [number, number, number, number][] = [
      [0, -10.2, 22, 4],
      [-8.2, -2, 4.6, 16],
      [8.2, -2, 4.6, 16],
      [0, -13.8, 24, 4],
    ];
    for (const [x, z, w, d] of strips) {
      const m = new Mesh(new PlaneGeometry(w, d), this.fogMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, GROUND_Y + 0.25, z);
      m.renderOrder = 2;
      this.fogPlanes.push(m);
      this.group.add(m);
    }
    tex.repeat.set(3, 3);
    // inside edge: a ring hugging the barrier, faint teal
    const edgeTex = tex.clone();
    edgeTex.repeat.set(6, 6);
    this.edgeFogMat = new MeshBasicMaterial({ map: edgeTex, color: new Color(TEAL).multiplyScalar(0.55), transparent: true, depthWrite: false, opacity: 0.32 });
    const ring = flatExtrude(ringShape(ARENA.wallX - 0.75, ARENA.wallZ - 0.75, ARENA.wallCorner - 0.6, 0.75), 0.001);
    const pos = ring.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / 6;
      uv[i * 2 + 1] = pos.getZ(i) / 6;
    }
    ring.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    const edge = new Mesh(ring, this.edgeFogMat);
    edge.position.y = FLOOR_TOP + 0.03;
    edge.renderOrder = 2;
    this.group.add(edge);
  }

  /** Rare mystic motes: a few teal and violet sparks drifting up round the edges of the set. */
  private buildWisps(): void {
    const rng = new Rng(66);
    const pos = new Float32Array(WISPS * 3);
    const col = new Float32Array(WISPS * 3);
    const ph = new Float32Array(WISPS);
    for (let i = 0; i < WISPS; i++) {
      // round the barrier and out in the graves, never over the middle of the floor
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(1.05, 1.5);
      const w: Wisp = { x: Math.cos(a) * ARENA.wallX * r, z: Math.sin(a) * ARENA.wallZ * r, y0: rng.range(0.2, 1.2), speed: rng.range(0.12, 0.28), phase: rng.range(0, 10) };
      this.wispData.push(w);
      pos[i * 3] = w.x;
      pos[i * 3 + 1] = w.y0;
      pos[i * 3 + 2] = w.z;
      _c.setHex(i % 3 === 0 ? VIOLET : TEAL);
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
      ph[i] = w.phase;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setAttribute('phase', new Float32BufferAttribute(ph, 1));
    this.wispMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 320 } },
      vertexShader: /* glsl */ `
        attribute float phase;
        attribute vec3 color;
        uniform float uTime;
        uniform float uScale;
        varying vec3 vColor;
        varying float vA;
        void main() {
          float cyc = fract(uTime * 0.08 + phase * 0.1);
          vec3 p = position;
          p.y += cyc * 2.6;
          p.x += sin(uTime * 0.7 + phase) * 0.35;
          p.z += cos(uTime * 0.5 + phase * 1.3) * 0.35;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vA = sin(cyc * 3.14159) * (0.55 + 0.45 * sin(uTime * 3.0 + phase));
          vColor = color;
          gl_PointSize = uScale * 0.12 / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, r);
          gl_FragColor = vec4(vColor * a * a * vA * 2.0, 1.0);
        }`,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.wisps = new Points(g, this.wispMat);
    this.wisps.frustumCulled = false;
    this.group.add(this.wisps);
  }

  // --------------------------------------------------------- barrier pieces
  private buildProps(): void {
    const face = pumpkinFace();
    const pgeo = merge(pumpkinChunks().wedges.map((w) => w.geo.clone().translate(w.at.x, w.at.y - 0.34, w.at.z)));
    this.extraGeos.push(pgeo);
    DEF.props.forEach((p, idx) => {
      if (p.kind === 'pumpkin') {
        this.propMap[idx] = { k: 'pumpkin', i: this.pumpkins.length };
        this.pumpkins.push(this.buildPropPumpkin(p.x, p.z, face, pgeo));
      } else if (p.kind === 'lantern') {
        this.propMap[idx] = { k: 'lamp', i: this.lamps.length };
        this.lamps.push(this.buildLamp(p.x, p.z));
      } else if (p.kind === 'fogGate') {
        this.propMap[idx] = { k: 'gate' };
      }
    });
  }

  private buildPropPumpkin(x: number, z: number, face: CanvasTexture, geo: BufferGeometry): PumpkinP {
    const y = landingY(x, z);
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, emissiveMap: face, emissive: new Color(1, 0.62, 0.22), emissiveIntensity: 2.6 });
    const body = new Mesh(geo, mat);
    body.position.set(x, y, z);
    body.rotation.y = Math.atan2(-x, -z);
    body.scale.setScalar(0.62);
    body.castShadow = true;
    this.group.add(body);
    const shardMat = new MeshLambertMaterial({ color: ORANGE, emissive: new Color(0x5a2000) });
    const shards: Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const m = new Mesh(new SphereGeometry(0.18, 5, 4, (i / 5) * Math.PI * 2, Math.PI / 2.5, 0.2, 1.6), shardMat);
      m.visible = false;
      this.group.add(m);
      shards.push(m);
    }
    return { body, mat, shards, x, z, y, broken: false, phase: (x * 7 + z * 3) % 6 };
  }

  private buildLamp(x: number, z: number): LampP {
    const y = landingY(x, z);
    const iron = new MeshStandardMaterial({ color: 0x14161c, roughness: 0.5, metalness: 0.6 });
    const post = new Group();
    post.position.set(x, y, z);
    post.add(new Mesh(merge([new CylinderGeometry(0.035, 0.05, 1.5, 6).translate(0, 0.75, 0), new BoxGeometry(0.42, 0.04, 0.04).translate(0.16, 1.5, 0)]), iron));
    const head = new Group();
    head.position.set(0.34, 1.48, 0);
    head.add(new Mesh(merge([new BoxGeometry(0.2, 0.03, 0.2).translate(0, -0.02, 0), new ConeGeometry(0.16, 0.14, 4).rotateY(Math.PI / 4).translate(0, -0.06, 0), new BoxGeometry(0.2, 0.03, 0.2).translate(0, -0.34, 0)]), iron));
    const glow = new MeshBasicMaterial({ color: new Color(TEAL).multiplyScalar(2), toneMapped: false, transparent: true, opacity: 0.9 });
    const cage = new Mesh(new BoxGeometry(0.17, 0.28, 0.17), glow);
    cage.position.y = -0.18;
    head.add(cage);
    const flame = new Mesh(new SphereGeometry(0.05, 8, 6), new MeshBasicMaterial({ color: new Color(0xd0fff0).multiplyScalar(3), toneMapped: false }));
    flame.position.y = -0.18;
    head.add(flame);
    post.rotation.y = Math.atan2(-x, -z) + Math.PI / 2;
    post.add(head);
    this.group.add(post);
    return { head, glow, flame, out: 0, flicker: 0, broken: false };
  }

  private buildLights(): void {
    const housing = new MeshStandardMaterial({ color: 0x161a20, roughness: 0.4, metalness: 0.7 });
    const spots: [number, number, number, number][] = [
      [-9, -6, VIOLET, 0.5],
      [9, -6, TEAL, -0.5],
      [-9, 4, ORANGE, 0.6],
      [9, 4, VIOLET, -0.6],
    ];
    for (const [x, z, col, yaw] of spots) {
      const c = makeSpotCone(x, 11, z, col, yaw, housing, 0.2);
      this.group.add(c.pivot);
      this.cones.push(c);
    }
    // the lighting truss the spotlights hang from: two rails along the sides of the set, above the
    // lamps (Alpha 1.7.6 — beams ACROSS the set at this height hung between the battle camera and the
    // floor and cut the fight with a dark bar whenever it moved to the far half)
    const steel = new MeshStandardMaterial({ color: 0x2a2c34, roughness: 0.4, metalness: 0.8 });
    this.group.add(new Mesh(merge([new BoxGeometry(0.18, 0.18, 12).translate(-9, 11.5, -1), new BoxGeometry(0.18, 0.18, 12).translate(9, 11.5, -1)]), steel));
  }

  // ------------------------------------------------------------------ cover
  private buildCovers(): void {
    const tomb = tombChunks();
    const col = columnChunks();
    const pk = pumpkinChunks();
    this.extraGeos.push(tomb.plinth, col.plinth, pk.inner, ...tomb.chunks.map((c) => c.geo), ...col.chunks.map((c) => c.geo), ...pk.wedges.map((c) => c.geo), pk.stem.geo);
    // per-look materials (shared by every piece of a kind)
    for (let e = 0; e < EPITAPHS.length; e++) {
      const row: MeshStandardMaterial[] = [];
      for (let st = 0; st < 3; st++) {
        const t = tombTexture(EPITAPHS[e], st, 40 + e * 11);
        row.push(new MeshStandardMaterial({ map: t.map, roughness: 0.92, emissiveMap: t.glow, emissive: new Color(TEAL), emissiveIntensity: st === 0 ? 0.55 : st === 1 ? 0.35 : 0.18 }));
      }
      this.tombMats.push(row);
    }
    for (let st = 0; st < 3; st++) {
      const t = columnTexture(st);
      this.columnMats.push(new MeshStandardMaterial({ map: t.map, roughness: 0.85, emissiveMap: t.glow, emissive: new Color(VIOLET), emissiveIntensity: st === 0 ? 0.9 : st === 1 ? 0.6 : 0.3 }));
    }
    const face = pumpkinFace();
    const skins = [0, 1, 2].map((st) => new MeshStandardMaterial({ vertexColors: true, map: pumpkinSkin(st), roughness: 0.55, emissiveMap: face, emissive: new Color(1, 0.62, 0.22), emissiveIntensity: 2.4 }));
    this.pumpkinMats.push(...skins);
    const baseMat = new MeshStandardMaterial({ color: 0x3e3a48, roughness: 0.95 });
    const strawMat = new MeshStandardMaterial({ map: strawTexture(), roughness: 1 });
    const innerMat = new MeshBasicMaterial({ color: new Color(0xffa030).multiplyScalar(2.2), toneMapped: false });
    this.extraMats.push(...this.tombMats.flat(), ...this.columnMats, baseMat, strawMat, innerMat);
    // stone chips for the cracks (a small shared pool)
    this.stoneChip = new BoxGeometry(0.11, 0.06, 0.09);
    this.extraGeos.push(this.stoneChip);
    this.chipMat = new MeshLambertMaterial({ color: 0x6a6474 });
    this.extraMats.push(this.chipMat);
    for (let i = 0; i < 12; i++) {
      const m = new Mesh(this.stoneChip, this.chipMat);
      m.visible = false;
      this.group.add(m);
      this.chips.push(m);
    }

    let tombN = 0;
    COVERS.forEach((cv, i) => {
      const group = new Group();
      group.position.set(cv.x, FLOOR_TOP - 0.02, cv.z);
      group.rotation.y = cv.yaw ?? 0;
      const body = new Group();
      group.add(body);
      const view: CoverView = {
        kind: cv.kind,
        x: cv.x,
        z: cv.z,
        yaw: cv.yaw ?? 0,
        group,
        body,
        chunks: [],
        home: [],
        halves: [],
        remains: null,
        mats: [],
        stage: 0,
        shake: 0,
        wobble: 0,
        wobbleV: 0,
        wobAxis: new Vector3(1, 0, 0),
        hitCd: 0,
        inner: null,
        glowMat: null,
        phase: i * 1.7,
        lost: -1,
      };
      const add = (ch: Chunk, mat: Material) => {
        const m = new Mesh(ch.geo, mat);
        m.position.copy(ch.at);
        m.castShadow = true;
        body.add(m);
        view.chunks.push(m);
        view.home.push({ p: ch.at.clone(), q: new Quaternion(), s: new Vector3(1, 1, 1) });
        view.halves.push(ch.half);
      };
      if (cv.kind === 'tombstone') {
        view.mats = this.tombMats[tombN++ % this.tombMats.length];
        view.remains = new Mesh(tomb.plinth, baseMat);
        tomb.chunks.forEach((ch) => add(ch, view.mats[0]));
        view.lost = tomb.top;
      } else if (cv.kind === 'column') {
        view.mats = this.columnMats;
        view.remains = new Mesh(col.plinth, baseMat);
        col.chunks.forEach((ch) => add(ch, view.mats[0]));
        view.lost = col.capital;
      } else {
        view.mats = skins;
        const bale = new Mesh(new BoxGeometry(0.98, 0.34, 0.9).translate(0, 0.17, 0), strawMat);
        this.extraGeos.push(bale.geometry);
        view.remains = bale;
        pk.wedges.forEach((ch) => add(ch, skins[0]));
        add(pk.stem, new MeshLambertMaterial({ color: 0x4a7a2a }));
        this.extraMats.push(view.chunks[view.chunks.length - 1].material as Material);
        view.inner = new Mesh(pk.inner, innerMat);
        body.add(view.inner);
        view.glowMat = skins[0];
      }
      if (view.remains) {
        view.remains.castShadow = true;
        view.remains.receiveShadow = true;
        group.add(view.remains);
      }
      this.coverGroup.add(group);
      this.covers.push(view);
    });
  }

  /** The look for a stage: material swap, chips knocked off, the battered piece losing its top. */
  private setCoverLook(v: CoverView, stage: number): void {
    const look = Math.min(2, stage);
    if (v.kind === 'pumpkin') {
      for (let i = 0; i < 6; i++) v.chunks[i].material = v.mats[look];
      v.glowMat = v.mats[look] as MeshStandardMaterial;
    } else for (const m of v.chunks) m.material = v.mats[look];
    v.stage = stage;
  }

  /** Throw chunk `i` of a piece as set debris (it leaves the piece for the stage group first). */
  private throwChunk(v: CoverView, i: number, vx: number, vy: number, vz: number, spin: number, size: 'medium' | 'large', vary: number): void {
    const m = v.chunks[i];
    if (!m.visible || m.parent !== v.body) return;
    this.group.attach(m);
    const half = v.halves[i];
    const wallTop = WALL_TOP + 0.05;
    if (v.kind === 'pumpkin') {
      // pumpkin pieces bounce (a fixed landing height: they hop a few times before they settle)
      this.pieces.launch(m, [vx, vy, vz], [spin, spin * 0.7, spin * 0.5], landingY(m.position.x, m.position.z) + 0.1, size, vary);
    } else {
      const shape: DebrisShape = { half, surface: (x, z) => surfaceY(x, z, wallTop) };
      this.pieces.launch(m, [vx, vy, vz], [spin, spin * 0.6, spin * 0.4], shape, size, vary);
    }
  }

  /** A couple of small stone chips flying off the hit point. */
  private spitChips(x: number, y: number, z: number, dx: number, dz: number, n: number, color: number): void {
    this.chipMat.color.setHex(color);
    for (let k = 0; k < n; k++) {
      const m = this.chips[this.chipNext];
      this.chipNext = (this.chipNext + 1) % this.chips.length;
      m.position.set(x, y, z);
      m.rotation.set(k, k * 2, 0);
      const a = (k - (n - 1) / 2) * 0.7;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ox = -dx * ca + dz * sa;
      const oz = -dz * ca - dx * sa;
      this.pieces.launch(m, [ox * 1.8, 2.2 + k * 0.4, oz * 1.8], [8, 5, 6], { half: [0.055, 0.03, 0.045], surface: (px, pz) => surfaceY(px, pz, WALL_TOP + 0.05) }, 'medium', k / Math.max(1, n - 1));
    }
  }

  override coverEvent(i: number, what: 'hit' | 'crack' | 'break', stage: number, x: number, z: number, dx: number, dz: number, heavy: boolean): void {
    const v = this.covers[i];
    if (!v) return;
    const vfx = this.vfx;
    const height = COVER_TUNING[v.kind].height;
    const y = Math.min(height * 0.75, 1.05);
    const stoneCol = v.kind === 'column' ? 0x7a7488 : 0x6e6878;
    // every hit: a nudge (pumpkins wobble, stone shivers) and a few sparks of grit
    if (v.kind === 'pumpkin') {
      // tilt away from the blow
      v.wobAxis.set(dz, 0, -dx);
      if (v.wobAxis.lengthSq() < 1e-4) v.wobAxis.set(1, 0, 0);
      v.wobAxis.normalize().applyAxisAngle(_up, -v.yaw);
      v.wobbleV += heavy ? 3.6 : 1.6;
    } else v.shake = Math.max(v.shake, heavy ? 0.3 : 0.16);
    if (vfx && (v.hitCd <= 0 || what !== 'hit')) {
      v.hitCd = 0.07;
      if (v.kind === 'pumpkin') vfx.burst(x, y, z, _c.set(0xff9a3a), heavy ? 14 : 5, heavy ? 5 : 3, 0.12, 0.35, 2.2, 6, 1);
      else {
        vfx.debrisBurst(x, y, z, _c.set(stoneCol), heavy ? 6 : 2);
        vfx.burst(x, y, z, _c.set(0xc8c0d8), heavy ? 10 : 4, heavy ? 4 : 2.5, 0.1, 0.3, 1.6, 6, 1);
      }
    }
    if (what === 'crack') {
      this.setCoverLook(v, stage);
      if (v.kind === 'pumpkin') {
        if (stage >= 2) {
          // a wedge splits off on the side that was hit: the candle glows through the gap
          // the blow in the piece's own frame; the wedge facing the attacker is at −blow
          const cy = Math.cos(v.yaw);
          const sy = Math.sin(v.yaw);
          const lx = dx * cy - dz * sy;
          const lz = dx * sy + dz * cy;
          const phi = Math.atan2(-lz, lx);
          const k = Math.floor((((phi % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 3)) % 6;
          this.throwChunk(v, k, -dx * 2.4, 3.2, -dz * 2.4, 7, 'medium', 0.3);
          if (vfx) vfx.flash(x, y, z, _c.set(0xffb040), 0.4, 1.8, 0.2, 2);
        }
        if (vfx) for (let k = 0; k < 3; k++) vfx.soft.spawn(x, y, z, (k - 1) * 0.3, 0.6, 0, 0.9, 0.3, 1.0, _c.set(0x8a4adf), 1, 2.2, -0.3);
      } else {
        this.spitChips(x, y, z, dx, dz, stage >= 2 ? 3 : 2, stoneCol);
        if (stage >= 2 && v.lost >= 0) {
          // the top (arch / capital with its urn) breaks off and falls
          this.throwChunk(v, v.lost, -dx * 1.4 + dz * 0.6, 2.0, -dz * 1.4 - dx * 0.6, 4, 'medium', 0.6);
        }
        if (vfx) {
          vfx.dust(x, z, stage >= 2 ? 8 : 5, dx, dz);
          vfx.burst(x, y, z, _c.set(v.kind === 'column' ? VIOLET : TEAL), 8, 2.5, 0.1, 0.5, 1.6, -0.5, 0.6);
        }
      }
    } else if (what === 'break') {
      this.shatter(v, x, z, dx, dz, heavy);
    }
  }

  /** The piece goes: its chunks fly as big debris, dust and mystic sparks; only low remains stay. */
  private shatter(v: CoverView, x: number, z: number, dx: number, dz: number, heavy: boolean): void {
    const vfx = this.vfx;
    this.setCoverLook(v, 3);
    const p = heavy ? 1.35 : 1;
    const n = v.chunks.length;
    for (let i = 0; i < n; i++) {
      const m = v.chunks[i];
      if (m.parent !== v.body) continue;
      m.getWorldPosition(_v);
      // outwards from the centre of the piece, pushed along the blow
      let ox = _v.x - v.x;
      let oz = _v.z - v.z;
      const ol = Math.hypot(ox, oz) || 1;
      ox /= ol;
      oz /= ol;
      const up = v.kind === 'pumpkin' ? 3.4 + (i % 3) * 0.8 : 1.4 + (_v.y - FLOOR_TOP) * 1.2;
      const out = v.kind === 'pumpkin' ? 2.6 : 1.3;
      this.throwChunk(v, i, (ox * out + dx * 1.6) * p, up * p, (oz * out + dz * 1.6) * p, v.kind === 'pumpkin' ? 7 : 3 + i, v.kind === 'pumpkin' ? 'medium' : 'large', i / Math.max(1, n - 1));
    }
    if (v.remains) {
      // low rubble: the plinth sinks a little, the hay bale squashes flat
      v.remains.scale.set(1, v.kind === 'pumpkin' ? 0.35 : 0.65, 1);
    }
    if (v.inner) v.inner.scale.set(1.15, 0.12, 1.15);
    if (vfx) {
      if (v.kind === 'pumpkin') {
        vfx.flash(x, 0.8, z, _c.set(0xffb040), 0.6, 2.8, 0.24, 2.4);
        vfx.burst(v.x, 0.8, v.z, _c.set(0xff8a1f), 26, 6, 0.13, 0.5, 2.4, 8, 2);
        for (let k = 0; k < 5; k++) vfx.soft.spawn(v.x + (k - 2) * 0.2, 0.9, v.z, (k - 2) * 0.3, 0.7, 0, 1.2, 0.5, 1.5, _c.set(0x8a4adf), 1, 2.2, -0.3);
      } else {
        vfx.dust(v.x, v.z, 14, dx, dz);
        vfx.debrisBurst(v.x, 0.7, v.z, _c.set(v.kind === 'column' ? 0x7a7488 : 0x6e6878), 10);
        // a soft mystic gasp: teal (tombstone) or violet (column) sparks rising
        vfx.burst(v.x, 0.9, v.z, _c.set(v.kind === 'column' ? VIOLET : TEAL), 22, 3.5, 0.12, 0.8, 1.8, -1.2, 1.2);
        vfx.glow(v.x, 1.0, v.z, _c.set(TEAL), 0.5, 2.6, 0.45, 1.2);
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
        m.scale.copy(h.s);
        m.visible = true;
      }
      if (v.remains) v.remains.scale.set(1, 1, 1);
      if (v.inner) v.inner.scale.set(1, 1, 1);
      v.body.position.set(0, 0, 0);
      v.body.quaternion.identity();
      v.shake = 0;
      v.wobble = 0;
      v.wobbleV = 0;
      v.hitCd = 0;
      this.setCoverLook(v, 0);
    }
    for (const c of this.chips) c.visible = false;
  }

  override setMenu(menu: boolean): void {
    // the menu shows the fighter in the middle of the set: the cover waits for the fight
    this.coverGroup.visible = !menu;
  }

  override applyTheme(th: ArenaTheme, isDefault: boolean): void {
    colorCones(this.cones, isDefault || th.decor === 'pumpkins' ? [VIOLET, TEAL, ORANGE, VIOLET] : th.spots);
    this.premiere.map?.dispose();
    this.premiere.map = th.decor === 'championHalloween' || th.decor === 'champion' ? drawNeon('LEGENDARY · HALLOWEEN', '#ffc23a', 1024, 256, 78) : drawNeon('HALLOWEEN PREMIERE', '#ff8a1f', 1024, 256, 84);
    this.premiere.needsUpdate = true;
  }

  override setSpots(colors: number[]): void {
    colorCones(this.cones, colors);
  }

  // ---------------------------------------------------- barrier piece events
  propHit(i: number, _hp: number, heavy: boolean, x: number, z: number): void {
    const m = this.propMap[i];
    if (!m) return;
    const vfx = this.vfx;
    if (m.k === 'gate') {
      // the fog machine puffs theatrical fog through the gate, the sign flickers
      this.gateFlicker = 0.8;
      if (vfx) {
        const g = this.gatePos;
        for (let k = 0; k < (heavy ? 10 : 6); k++) {
          const a = (k / 6) * Math.PI;
          vfx.soft.spawn(g.x + (k - 3) * 0.45, 0.2, g.z + 0.4, Math.cos(a) * 0.8, 0.5 + (k % 3) * 0.2, 1.2, 1.6, 0.6, 2.2, _c.set(0xb8fff0), 1, 1.4, -0.08);
        }
        vfx.glow(g.x, 1.4, g.z, _c.set(TEAL), 0.6, 3.2, 0.4, 1.6);
      }
      return;
    }
    if (vfx) vfx.burst(x, 0.9, z, _c.set(m.k === 'lamp' ? TEAL : ORANGE), 8, 3, 0.1, 0.4, 1.8, 2, 1);
  }

  propBreak(i: number, x: number, z: number): void {
    const m = this.propMap[i];
    if (!m) return;
    const vfx = this.vfx;
    if (m.k === 'pumpkin') {
      const p = this.pumpkins[m.i];
      p.broken = true;
      p.body.scale.set(0.62, 0.22, 0.62);
      p.mat.emissiveIntensity = 0.2;
      p.shards.forEach((s, k) => {
        s.visible = true;
        s.position.set(p.x, p.y + 0.3, p.z);
        s.rotation.set(0, k, 0);
        const a = (k / p.shards.length) * Math.PI * 2;
        const land = landingY(p.x + Math.cos(a) * 0.9, p.z + Math.sin(a) * 0.9);
        this.pieces.launch(s, [Math.cos(a) * 2.4, 3.2 + (k % 2) * 1.2, Math.sin(a) * 2.4], [6, 4 + k, 5], land + 0.05, 'medium', k / (p.shards.length - 1));
      });
      if (vfx) {
        vfx.flash(x, 0.9, z, _c.set(0xffb040), 0.5, 2.6, 0.22, 2.4);
        vfx.burst(x, 0.8, z, _c.set(0xff8a1f), 22, 6, 0.13, 0.5, 2.4, 8, 2);
        for (let k = 0; k < 4; k++) vfx.soft.spawn(x + (k - 2) * 0.2, 0.9, z, (k - 2) * 0.3, 0.7, 0, 1.2, 0.5, 1.5, _c.set(0x8a4adf), 1, 2.2, -0.3);
      }
    } else if (m.k === 'lamp') {
      const L = this.lamps[m.i];
      L.broken = true;
      L.flicker = 0.9;
      if (vfx) {
        L.head.getWorldPosition(_v);
        vfx.burst(_v.x, _v.y, _v.z, _c.set(0x9affe0), 16, 5, 0.09, 0.4, 2.6, 9, 1);
        vfx.soft.spawn(_v.x, _v.y, _v.z, 0, 0.6, 0, 1.0, 0.3, 1.0, _c.set(0x3a4a5a), 1, 2, -0.3);
      }
    }
  }

  resetProps(): void {
    this.pieces.clear();
    for (const p of this.pumpkins) {
      p.broken = false;
      p.body.scale.setScalar(0.62);
      p.mat.emissiveIntensity = 2.6;
      p.shards.forEach((s) => (s.visible = false));
    }
    for (const L of this.lamps) {
      L.broken = false;
      L.flicker = 0;
      L.out = 0;
      L.head.rotation.set(0, 0, 0);
      L.glow.opacity = 0.9;
      L.flame.visible = true;
    }
    this.resetCovers();
    this.gateFlicker = 0;
  }

  // ---------------------------------------------------------------------- frame
  update(dt: number, ex: number, boost: number): void {
    this.time += dt;
    const t = this.time;
    const mo = this.motion;
    swingCones(this.cones, t, ex * 0.7, boost, mo * 0.6);
    // fog drift (thinner on the low preset), the edge wisp breathes slowly
    const map = this.fogMat.map!;
    map.offset.x = (t * 0.015 * mo) % 1;
    map.offset.y = (t * 0.008 * mo) % 1;
    this.fogMat.opacity = this.low ? 0.5 : 0.85;
    for (const m of this.fogPlanes) m.visible = !this.low || m === this.fogPlanes[0];
    const em = this.edgeFogMat.map!;
    em.offset.x = (-t * 0.02 * mo) % 1;
    em.offset.y = (t * 0.012 * mo) % 1;
    this.edgeFogMat.opacity = (this.low ? 0.2 : 0.3) + Math.sin(t * 0.6) * 0.05;
    // rare mystic motes (fewer on the low preset; slow and still with reduced motion)
    this.wispMat.uniforms.uTime.value = t * (0.3 + 0.7 * mo);
    this.wisps.geometry.setDrawRange(0, this.low ? Math.round(WISPS * 0.4) : WISPS);
    // glows: the doorway and the moon breathe, the sign flickers when the gate puffs
    this.doorGlow.color.setScalar(1.1 + Math.sin(t * 1.1) * 0.15 + boost * 0.4);
    this.moonGlow.opacity = 0.85 + Math.sin(t * 0.7) * 0.15;
    this.gateFlicker = Math.max(0, this.gateFlicker - dt);
    const fl = mo > 0.5 ? 55 : 6;
    this.gateSign.color.setScalar(this.gateFlicker > 0 ? (Math.sin(t * fl) > 0 ? 1.8 : 0.4) : 1.5 + Math.sin(t * 2.2) * 0.1);
    this.premiere.color.setScalar(1.45 + boost * 0.5);
    this.postGlow.color.setHex(TEAL).multiplyScalar(1.6 + Math.sin(t * 2.3) * 0.2);
    // barrier pumpkins and the piles flicker like candles
    for (const p of this.pumpkins) if (!p.broken) p.mat.emissiveIntensity = 2.4 + Math.sin(t * 7 + p.phase) * 0.25 + Math.sin(t * 13 + p.phase) * 0.15 + ex * 0.4;
    this.pumpkinMats[0].emissiveIntensity = 2.1 + Math.sin(t * 6.3) * 0.2;
    // lamps: flicker, go out and droop
    for (const L of this.lamps) {
      if (!L.broken) {
        L.glow.opacity = 0.8 + Math.sin(t * 9 + L.head.id) * 0.1;
        continue;
      }
      L.flicker = Math.max(0, L.flicker - dt);
      const on = L.flicker > 0 && Math.sin(t * fl) > 0;
      L.glow.opacity = on ? 0.9 : 0.12;
      L.flame.visible = on;
      L.out = Math.min(1, L.out + dt * 1.5);
      L.head.rotation.z = -0.6 * L.out;
    }
    this.updateCovers(dt, t);
    if (this.pieces.busy) this.pieces.update(this.debrisFrozen ? 0 : dt);
  }

  /** Cover: stone shivers after a hit, pumpkins wobble on a spring, candles inside flicker. */
  private updateCovers(dt: number, t: number): void {
    const frozen = this.debrisFrozen;
    const step = frozen ? 0 : dt;
    // the shared jack-o'-lantern skins flicker together (cheap: three materials)
    for (let st = 1; st < this.pumpkinMats.length; st++) {
      const look = st - 1;
      this.pumpkinMats[st].emissiveIntensity = (look === 0 ? 2.4 : look === 1 ? 1.9 : 1.4) + Math.sin(t * 7.3 + st) * 0.22 + Math.sin(t * 12.1) * 0.12;
    }
    for (const v of this.covers) {
      v.hitCd = Math.max(0, v.hitCd - dt);
      if (v.stage >= 3) continue;
      if (v.kind === 'pumpkin') {
        // damped spring: wobble' = v, v' = −k·wobble − c·v
        v.wobbleV += (-60 * v.wobble - 7 * v.wobbleV) * step;
        v.wobble += v.wobbleV * step;
        if (Math.abs(v.wobble) < 1e-4 && Math.abs(v.wobbleV) < 1e-3) {
          v.wobble = 0;
          v.wobbleV = 0;
        }
        v.body.quaternion.setFromAxisAngle(v.wobAxis, v.wobble * 0.35);
        if (v.inner) (v.inner.material as MeshBasicMaterial).color.setHex(0xffa030).multiplyScalar(1.8 + Math.sin(t * 9 + v.phase) * 0.35);
      } else if (v.shake > 0) {
        v.shake = Math.max(0, v.shake - step);
        const a = v.shake * 0.06 * (0.25 + 0.75 * this.motion);
        v.body.position.set(Math.sin(t * 71 + v.phase) * a, 0, Math.cos(t * 63 + v.phase) * a * 0.6);
        if (v.shake === 0) v.body.position.set(0, 0, 0);
      }
    }
  }

  override dispose(): void {
    // chunks thrown as debris live in the stage group; the rest are freed here (shared ones once)
    super.dispose();
    for (const g of this.extraGeos) g.dispose();
    for (const m of this.extraMats) {
      const mm = m as Material & { map?: { dispose(): void } | null; emissiveMap?: { dispose(): void } | null };
      mm.map?.dispose();
      mm.emissiveMap?.dispose();
      m.dispose();
    }
    for (const m of this.pumpkinMats) {
      m.map?.dispose();
      m.emissiveMap?.dispose();
      m.dispose();
    }
  }
}
