import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Points,
  Quaternion,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  type Material,
  type Object3D,
  type Texture,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ArenaId } from '../../config/arenas.config';
import { ARENA } from '../../config/balance';
import type { ArenaTheme } from '../../config/themes.config';
import { clamp01, ease, type Rng } from '../../core/math';
import { canvasTexture, makeCanvas } from '../textures';
import type { VFX } from '../VFX';

// Shared building blocks of the studio sets (Alpha 1.4). Every stage keeps the
// same fighting area: floor plate FLOOR_HX × FLOOR_HZ, barrier ring at
// ARENA.wallX / wallZ. Only the dressing differs.

export const FLOOR_HX = ARENA.wallX + 0.4;
export const FLOOR_HZ = ARENA.wallZ + 0.4;

export function roundedRectShape(hx: number, hz: number, r: number): Shape {
  const s = new Shape();
  s.moveTo(-hx + r, -hz);
  s.lineTo(hx - r, -hz);
  s.absarc(hx - r, -hz + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hx, hz - r);
  s.absarc(hx - r, hz - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hx + r, hz);
  s.absarc(-hx + r, hz - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hx, -hz + r);
  s.absarc(-hx + r, -hz + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

export function ringShape(hx: number, hz: number, r: number, thick: number): Shape {
  const outer = roundedRectShape(hx + thick, hz + thick, r + thick);
  const inner = roundedRectShape(hx, hz, r);
  outer.holes.push(inner);
  return outer;
}

/** Extrude in XY then lay flat so +depth points up (+Y). Shape y maps to world -z. */
export function flatExtrude(shape: Shape, depth: number, bevel = false): BufferGeometry {
  const g = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2,
    curveSegments: 18,
  });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Colours every vertex by world z: blue on the player side, hot orange on the rival side. */
export function teamGradient(g: BufferGeometry, a: Color, b: Color, intensity: number): void {
  const pos = g.getAttribute('position');
  const arr = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = clamp01((z + ARENA.wallZ) / (ARENA.wallZ * 2));
    c.copy(b).lerp(a, ease.inOutCubic(t)).multiplyScalar(intensity);
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(arr, 3));
}

/** Flat vertex colour (for merged, single-material set pieces). */
export function tint(g: BufferGeometry, color: number, k = 1): BufferGeometry {
  const c = new Color(color).multiplyScalar(k);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(a, 3));
  return g;
}

/** Merge many vertex-coloured parts into one geometry (one draw call); the inputs are disposed. */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  const flat = parts.map((p) => {
    const n = p.index ? p.toNonIndexed() : p;
    if (n !== p) p.dispose();
    // uv is optional on some parts: keep the attribute sets identical
    if (!n.getAttribute('uv')) n.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n.getAttribute('position').count * 2), 2));
    if (!n.getAttribute('normal')) n.computeVertexNormals();
    return n;
  });
  const g = mergeGeometries(flat)!;
  flat.forEach((p) => p.dispose());
  return g;
}

/** Floor plate of the fighting area with a painted top (map + glowing emissive lines). */
export function floorMesh(map: CanvasTexture, emissive: CanvasTexture | null, top: { roughness: number; metalness: number; emissiveIntensity?: number; color?: number }, sideColor: number): Mesh {
  map.anisotropy = 8;
  if (emissive) emissive.anisotropy = 8;
  const shape = roundedRectShape(FLOOR_HX, FLOOR_HZ, ARENA.wallCorner + 0.4);
  const geo = flatExtrude(shape, 0.35, true);
  geo.translate(0, -0.35, 0);
  // planar UVs for the top cap
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + FLOOR_HX) / (FLOOR_HX * 2);
    uv[i * 2 + 1] = 1 - (pos.getZ(i) + FLOOR_HZ) / (FLOOR_HZ * 2);
  }
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  const topMat = new MeshStandardMaterial({
    map,
    emissiveMap: emissive,
    emissive: emissive ? new Color(1, 1, 1) : new Color(0, 0, 0),
    emissiveIntensity: top.emissiveIntensity ?? 1.6,
    roughness: top.roughness,
    metalness: top.metalness,
    color: top.color ?? 0xffffff,
  });
  const side = new MeshStandardMaterial({ color: sideColor, roughness: 0.5, metalness: 0.4 });
  const floor = new Mesh(geo, [topMat, side]);
  floor.receiveShadow = true;
  return floor;
}

/** Canvas sized to the floor plate: X(x), Y(z) map world units to pixels (canvas top = far side). */
export function floorCanvas(width = 1024): { c: HTMLCanvasElement; g: CanvasRenderingContext2D; e: HTMLCanvasElement; eg: CanvasRenderingContext2D; X: (x: number) => number; Y: (z: number) => number; ppu: number; W: number; H: number } {
  const W = width;
  const H = Math.round((W * FLOOR_HZ) / FLOOR_HX);
  const ppu = W / (FLOOR_HX * 2);
  const { c, g } = makeCanvas(W, H);
  const e = makeCanvas(W, H);
  e.g.fillStyle = '#000';
  e.g.fillRect(0, 0, W, H);
  return { c, g, e: e.c, eg: e.g, X: (x) => W / 2 + x * ppu, Y: (z) => H / 2 + z * ppu, ppu, W, H };
}

/** Rounded-rect path in floor-canvas pixels (for borders that follow the barrier). */
export function insetPath(ctx: CanvasRenderingContext2D, X: (x: number) => number, Y: (z: number) => number, ppu: number, hx: number, hz: number, r: number): void {
  ctx.moveTo(X(-hx + r), Y(-hz));
  ctx.lineTo(X(hx - r), Y(-hz));
  ctx.arc(X(hx - r), Y(-hz + r), r * ppu, -Math.PI / 2, 0);
  ctx.lineTo(X(hx), Y(hz - r));
  ctx.arc(X(hx - r), Y(hz - r), r * ppu, 0, Math.PI / 2);
  ctx.lineTo(X(-hx + r), Y(hz));
  ctx.arc(X(-hx + r), Y(hz - r), r * ppu, Math.PI / 2, Math.PI);
  ctx.lineTo(X(-hx), Y(-hz + r));
  ctx.arc(X(-hx + r), Y(-hz + r), r * ppu, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

export function drawNeon(text: string, color: string, w = 1024, h = 256, font = 150): CanvasTexture {
  const { c, g } = makeCanvas(w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `italic 900 ${font}px Unbounded, "Arial Black", sans-serif`;
  g.shadowColor = color;
  g.shadowBlur = 30;
  g.strokeStyle = color;
  g.lineWidth = 10;
  g.strokeText(text, w / 2, h / 2);
  g.shadowBlur = 8;
  g.fillStyle = '#ffffff';
  g.fillText(text, w / 2, h / 2);
  return canvasTexture(c);
}

export function neonMaterial(tex: CanvasTexture, k = 1.6): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  m.color.setScalar(k);
  return m;
}

/** Plain painted texture: a canvas drawn by `paint` (signs, set walls, labels). */
export function paintTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const { c, g } = makeCanvas(w, h);
  paint(g, w, h);
  return canvasTexture(c);
}

// ---------------------------------------------------------------- spotlight cones
export interface SpotCone {
  pivot: Group;
  baseYaw: number;
  speed: number;
  phase: number;
  mat: ShaderMaterial;
  lens: MeshBasicMaterial;
}

let coneGeo: CylinderGeometry | null = null;
function sharedConeGeometry(): CylinderGeometry {
  // shared by every stage, never disposed with a stage
  if (!coneGeo) {
    coneGeo = new CylinderGeometry(0.12, 2.6, 13, 24, 1, true);
    coneGeo.translate(0, -6.5, 0);
    coneGeo.userData.shared = true;
  }
  return coneGeo;
}

/** Moving stage spotlight: additive light cone, housing and a glowing lens. */
export function makeSpotCone(x: number, y: number, z: number, color: number, yaw: number, housingMat: Material, intensity = 0.22, rng?: Rng): SpotCone {
  const mat = new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uIntensity: { value: intensity } },
    vertexShader: /* glsl */ `
      varying float vH;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vH = -position.y / 13.0;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying float vH;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float edge = abs(dot(normalize(vN), normalize(vV)));
        float a = (1.0 - vH) * edge * edge * uIntensity;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const pivot = new Group();
  pivot.position.set(x, y, z);
  pivot.add(new Mesh(sharedConeGeometry(), mat));
  pivot.add(new Mesh(new CylinderGeometry(0.35, 0.45, 0.7, 14), housingMat));
  const lensMat = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(3) });
  const lens = new Mesh(new SphereGeometry(0.32, 12, 8), lensMat);
  lens.position.y = -0.35;
  pivot.add(lens);
  const r = rng ? rng.next() : Math.random();
  const r2 = rng ? rng.next() : Math.random();
  return { pivot, baseYaw: yaw, speed: 0.35 + r * 0.2, phase: r2 * 6, mat, lens: lensMat };
}

export function swingCones(cones: SpotCone[], t: number, ex: number, boost: number, motion: number): void {
  for (const c of cones) {
    const sp = c.speed * (1 + ex * 1.6);
    const amp = 0.35 * (0.25 + 0.75 * motion);
    c.pivot.rotation.z = c.baseYaw + Math.sin(t * sp + c.phase) * amp;
    c.pivot.rotation.x = Math.cos(t * sp * 0.8 + c.phase) * 0.3 * (0.25 + 0.75 * motion);
    c.mat.uniforms.uIntensity.value = 0.14 + ex * 0.16 + boost * 0.25;
  }
}

export function colorCones(cones: SpotCone[], colors: number[]): void {
  cones.forEach((c, i) => {
    const col = colors[i % colors.length];
    (c.mat.uniforms.uColor.value as Color).setHex(col);
    c.lens.color.setHex(col).multiplyScalar(3);
  });
}

// --------------------------------------------------------------------- crowd
export interface CrowdUniforms {
  uTime: { value: number };
  uExcite: { value: number };
}

/**
 * Studio audience on the given seats: two instanced silhouettes (plain / arms up)
 * that bounce with the show's excitement, plus glow sticks and phone lights.
 */
export function buildCrowd(group: Group, seats: Vector3[], palette: number[], stickColors: number[], uniforms: CrowdUniforms, rng: Rng, maxSticks = 260): Points {
  const body = new CapsuleGeometry(0.2, 0.32, 2, 7);
  body.translate(0, 0.38, 0);
  const head = new SphereGeometry(0.17, 8, 6);
  head.translate(0, 0.8, 0);
  const armL = new CapsuleGeometry(0.06, 0.32, 1, 4);
  armL.rotateZ(0.5);
  armL.translate(-0.25, 0.85, 0);
  const armR = armL.clone();
  armR.rotateY(Math.PI);
  const fanA = mergeGeometries([body, head])!;
  const fanB = mergeGeometries([body.clone(), head.clone(), armL, armR])!;
  [body, head, armL, armR].forEach((g) => g.dispose());

  const mat = new MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uExcite = uniforms.uExcite;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uExcite;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float ph = ip.x * 1.7 + ip.z * 2.3;
          float j = max(0.0, sin(uTime * (4.0 + uExcite * 5.0) + ph));
          transformed.y += j * (0.03 + uExcite * 0.24);
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'pt-crowd';

  const half = Math.floor(seats.length / 2);
  const mk = (geo: BufferGeometry, list: Vector3[]) => {
    const im = new InstancedMesh(geo, mat, Math.max(1, list.length));
    im.count = list.length;
    const m = new Matrix4();
    const c = new Color();
    list.forEach((p, i) => {
      const s = rng.range(0.85, 1.12);
      m.makeScale(s, s, s);
      m.setPosition(p.x, p.y, p.z);
      im.setMatrixAt(i, m);
      c.setHex(palette[i % palette.length]).multiplyScalar(rng.range(0.8, 1.25));
      im.setColorAt(i, c);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    group.add(im);
  };
  mk(fanA, seats.slice(0, half));
  mk(fanB, seats.slice(half));

  // glow sticks & phone lights over the crowd
  const n = Math.min(seats.length, maxSticks);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  const cc = new Color();
  for (let i = 0; i < n; i++) {
    const p = seats[Math.floor(rng.next() * seats.length)];
    pos[i * 3] = p.x + rng.range(-0.2, 0.2);
    pos[i * 3 + 1] = p.y + rng.range(1.0, 1.25);
    pos[i * 3 + 2] = p.z;
    cc.setHex(stickColors[i % stickColors.length]);
    col[i * 3] = cc.r;
    col[i * 3 + 1] = cc.g;
    col[i * 3 + 2] = cc.b;
    phase[i] = rng.range(0, 100);
  }
  const sg = new BufferGeometry();
  sg.setAttribute('position', new Float32BufferAttribute(pos, 3));
  sg.setAttribute('color', new Float32BufferAttribute(col, 3));
  sg.setAttribute('phase', new Float32BufferAttribute(phase, 1));
  const sm = new ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uExcite: uniforms.uExcite, uScale: { value: 300 } },
    vertexShader: /* glsl */ `
      attribute float phase;
      attribute vec3 color;
      uniform float uTime;
      uniform float uExcite;
      uniform float uScale;
      varying vec3 vColor;
      varying float vA;
      void main() {
        vec3 p = position;
        float ph = p.x * 1.7 + p.z * 2.3;
        p.y += max(0.0, sin(uTime * (4.0 + uExcite * 5.0) + ph)) * (0.03 + uExcite * 0.24);
        p.x += sin(uTime * 3.0 + phase) * 0.12 * uExcite;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float blink = 0.55 + 0.45 * sin(uTime * 2.0 + phase);
        vA = blink * (0.35 + uExcite * 0.9);
        vColor = color;
        gl_PointSize = uScale * (0.09 + uExcite * 0.05) / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        float a = smoothstep(0.5, 0.0, r);
        gl_FragColor = vec4(vColor * a * vA * 2.2, 1.0);
      }`,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const sticks = new Points(sg, sm);
  group.add(sticks);
  return sticks;
}

export function colorSticks(sticks: Points, colors: number[]): void {
  const colAttr = sticks.geometry.getAttribute('color') as Float32BufferAttribute;
  const cc = new Color();
  for (let i = 0; i < colAttr.count; i++) {
    cc.setHex(colors[i % colors.length]);
    colAttr.setXYZ(i, cc.r, cc.g, cc.b);
  }
  colAttr.needsUpdate = true;
}

// ------------------------------------------------------------- flying pieces
/**
 * How long debris stays on the set (Alpha 1.4.1): it lands, lies there for `rest`
 * seconds, then shrinks away over `fade` seconds. Small sparks, dust and smoke are
 * the VFX pools' business (they live 0.4–2 s on their own).
 */
export const DEBRIS = {
  /** Chips, planks, pumpkin shards: 6–8 s on the floor, 2 s to disappear. */
  medium: { rest: [6, 8], fade: 2 },
  /** Big chunks of a prop (plywood wall pieces): ~10 s, 2.5 s to disappear. */
  large: { rest: [10, 10.5], fade: 2.5 },
} as const;
export type DebrisSize = keyof typeof DEBRIS;

/** How far a piece sinks into the floor while it shrinks away. */
const DEBRIS_SINK = 0.06;

/**
 * Alpha 1.4.2: a flat piece (chip, plank, plywood chunk) that lands on the real
 * surface under it and settles on its broadest face instead of stopping on an edge.
 */
export interface DebrisShape {
  /** Half sizes along the piece's own X, Y, Z. It comes to rest with its thinnest axis vertical. */
  half: [number, number, number];
  /** A disc around its own Y axis (casino chip): exact contact height instead of the box estimate. */
  round?: boolean;
  /** Height of whatever is under (x, z): floor plate, barrier cap, studio ground… */
  surface: (x: number, z: number) => number;
}

/** Seconds a flat piece takes to tip over onto its broad face after the last bounce. */
const SETTLE_TIME = 0.28;
const _rm = new Matrix4();
const _ax = new Vector3();
const _up = new Vector3();
const _qa = new Quaternion();

/** Vertical half-extent of the oriented piece: how far its lowest point is below its centre. */
function halfHeight(q: Quaternion, sh: DebrisShape): number {
  const e = _rm.makeRotationFromQuaternion(q).elements; // column-major: e[1], e[5], e[9] = world Y of the local X, Y, Z axes
  const [hx, hy, hz] = sh.half;
  if (sh.round) return Math.abs(e[5]) * hy + Math.sqrt(Math.max(0, 1 - e[5] * e[5])) * hx;
  return Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz;
}

/** Same orientation turned the shortest way so the thinnest axis points straight up or down (yaw kept). */
function flatTarget(q: Quaternion, sh: DebrisShape, out: Quaternion): Quaternion {
  const [hx, hy, hz] = sh.half;
  const i = hy <= hx && hy <= hz ? 1 : hx <= hz ? 0 : 2;
  _ax.set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(q);
  _up.set(0, _ax.y >= 0 ? 1 : -1, 0);
  _qa.setFromUnitVectors(_ax, _up);
  return out.copy(q).premultiply(_qa);
}

/** One loose piece of a broken set piece (simple ballistic flight, bounces, rests, fades). */
interface Piece {
  obj: Object3D;
  vx: number;
  vy: number;
  vz: number;
  sx: number;
  sy: number;
  sz: number;
  ground: number;
  /** Flat piece landing on real surfaces (1.4.2); null = the 1.4 behaviour (fixed landing height). */
  shape: DebrisShape | null;
  phase: 'idle' | 'fly' | 'settle' | 'rest' | 'fade' | 'gone';
  /** Seconds left in the rest / fade phase. */
  t: number;
  rest: number;
  fade: number;
  /** Scale before the break (restored on reset). */
  base: Vector3;
  /** Resting height (the piece sinks from here while fading). */
  y0: number;
  /** Settling onto the broad face: from / to orientation. */
  qFrom: Quaternion;
  qTo: Quaternion;
}

/**
 * Deterministic "debris" for set pieces: no physics engine, just gravity, a
 * couple of bounces and friction. A piece lands, lies on the set for a while,
 * then smoothly shrinks into the floor and is hidden — opaque all the way (no
 * transparent materials), nothing is created or freed during a fight, and a
 * vanished piece never comes back until `clear()` (new fight / Survival wave).
 * Debris has no collision of any kind: the fight never sees it.
 */
export class Pieces {
  private list: Piece[] = [];

  /**
   * `ground`: a fixed landing height, or (1.4.2) the shape of a flat piece that lands on
   * the real surface under it and settles on its broad face.
   * `vary` (0..1) spreads the resting time inside the size's range so pieces do not all vanish at once.
   */
  launch(obj: Object3D, v: [number, number, number], spin: [number, number, number], ground: number | DebrisShape, size: DebrisSize = 'medium', vary = 0.5): void {
    let p = this.list.find((q) => q.obj === obj);
    if (!p) {
      p = { obj, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, sz: 0, ground: 0, shape: null, phase: 'idle', t: 0, rest: 0, fade: 1, base: new Vector3(), y0: 0, qFrom: new Quaternion(), qTo: new Quaternion() };
      this.list.push(p);
    }
    if (p.phase === 'idle') p.base.copy(obj.scale);
    else obj.scale.copy(p.base);
    obj.visible = true;
    const d = DEBRIS[size];
    p.rest = d.rest[0] + (d.rest[1] - d.rest[0]) * clamp01(vary);
    p.fade = d.fade;
    p.vx = v[0];
    p.vy = v[1];
    p.vz = v[2];
    p.sx = spin[0];
    p.sy = spin[1];
    p.sz = spin[2];
    p.shape = typeof ground === 'number' ? null : ground;
    p.ground = typeof ground === 'number' ? ground : 0;
    p.phase = 'fly';
  }

  /** Something is still flying, resting or fading (the stage keeps calling update). */
  get busy(): boolean {
    return this.list.some((p) => p.phase === 'fly' || p.phase === 'settle' || p.phase === 'rest' || p.phase === 'fade');
  }

  /** Advance all pieces. Returns true if any piece moved or changed size this frame. */
  update(dt: number): boolean {
    if (dt <= 0) return false;
    let changed = false;
    for (const p of this.list) {
      const o = p.obj;
      if (p.phase === 'fly' && p.shape) {
        changed = true;
        this.flyFlat(p, dt);
      } else if (p.phase === 'settle') {
        changed = true;
        this.settle(p, dt);
      } else if (p.phase === 'fly') {
        changed = true;
        p.vy -= 9.8 * dt;
        o.position.x += p.vx * dt;
        o.position.y += p.vy * dt;
        o.position.z += p.vz * dt;
        o.rotation.x += p.sx * dt;
        o.rotation.y += p.sy * dt;
        o.rotation.z += p.sz * dt;
        if (o.position.y <= p.ground) {
          o.position.y = p.ground;
          if (Math.abs(p.vy) > 1.2) {
            p.vy = -p.vy * 0.32;
            p.vx *= 0.55;
            p.vz *= 0.55;
            p.sx *= 0.5;
            p.sy *= 0.5;
            p.sz *= 0.5;
          } else {
            // landed: lie on the set first, disappear later
            p.phase = 'rest';
            p.t = p.rest;
          }
        }
      } else if (p.phase === 'rest') {
        p.t -= dt;
        if (p.t <= 0) {
          p.phase = 'fade';
          p.t = p.fade;
          p.y0 = o.position.y;
        }
      } else if (p.phase === 'fade') {
        changed = true;
        p.t = Math.max(0, p.t - dt);
        const k = p.t / p.fade;
        const e = k * k * (3 - 2 * k); // smooth, no pop
        o.scale.copy(p.base).multiplyScalar(e);
        o.position.y = p.y0 - (1 - e) * DEBRIS_SINK;
        if (p.t <= 0) {
          o.scale.set(0, 0, 0);
          o.visible = false;
          p.phase = 'gone';
        }
      }
    }
    return changed;
  }

  /** Flight of a flat piece: lands on the real surface under it using its real oriented size. */
  private flyFlat(p: Piece, dt: number): void {
    const o = p.obj;
    const sh = p.shape!;
    const px = o.position.x;
    const pz = o.position.z;
    const prevBottom = o.position.y - halfHeight(o.quaternion, sh);
    const prevSurf = sh.surface(px, pz);
    p.vy -= 9.8 * dt;
    o.position.x += p.vx * dt;
    o.position.y += p.vy * dt;
    o.position.z += p.vz * dt;
    o.rotation.x += p.sx * dt;
    o.rotation.y += p.sy * dt;
    o.rotation.z += p.sz * dt;
    let surf = sh.surface(o.position.x, o.position.z);
    if (surf > prevSurf + 0.01 && surf > prevBottom + 0.01) {
      // flew into the side of something taller (the barrier): knocked back, keeps falling
      o.position.x = px;
      o.position.z = pz;
      p.vx *= -0.35;
      p.vz *= -0.35;
      surf = prevSurf;
    }
    const ext = halfHeight(o.quaternion, sh);
    if (o.position.y - ext > surf) return;
    o.position.y = surf + ext; // never inside the surface
    if (p.vy > 0) return; // still rising (e.g. launched from inside the stack)
    if (p.vy < -1.2) {
      p.vy = -p.vy * 0.32;
      p.vx *= 0.55;
      p.vz *= 0.55;
      p.sx *= 0.5;
      p.sy *= 0.5;
      p.sz *= 0.5;
      return;
    }
    // last touch: tip over onto the broad face, then lie still
    p.phase = 'settle';
    p.t = 0;
    p.ground = surf;
    p.vx *= 0.5;
    p.vz *= 0.5;
    p.qFrom.copy(o.quaternion);
    flatTarget(o.quaternion, sh, p.qTo);
  }

  /** Smoothly lay a flat piece on its broad face, resting exactly on the surface (no sinking, no hovering). */
  private settle(p: Piece, dt: number): void {
    const o = p.obj;
    const sh = p.shape!;
    p.t = Math.min(SETTLE_TIME, p.t + dt);
    const k = p.t / SETTLE_TIME;
    const e = k * k * (3 - 2 * k);
    // a short slide that dies out
    o.position.x += p.vx * dt * (1 - k);
    o.position.z += p.vz * dt * (1 - k);
    const surf = sh.surface(o.position.x, o.position.z);
    if (surf < p.ground - 0.05) {
      // slid off an edge (barrier top): fall again and land below
      p.phase = 'fly';
      p.vy = 0;
      return;
    }
    o.quaternion.slerpQuaternions(p.qFrom, p.qTo, e);
    o.position.y = surf + halfHeight(o.quaternion, sh);
    if (k >= 1) {
      o.quaternion.copy(p.qTo);
      o.position.y = surf + halfHeight(o.quaternion, sh);
      p.phase = 'rest';
      p.t = p.rest;
    }
  }

  /** New fight / Survival wave / leaving the battle: every piece back to its pre-break scale and visible. */
  clear(): void {
    for (const p of this.list) {
      if (p.phase === 'idle') continue;
      p.obj.scale.copy(p.base);
      p.obj.visible = true;
      p.phase = 'idle';
    }
  }
}

/** Ground level outside the floor plate. */
export const GROUND_Y = -0.36;
/** Top of the barrier wall. */
export const WALL_TOP = 0.6;

/** Where a broken piece lands: on the barrier top, beyond it on the ground, or on the floor plate. */
export function landingY(x: number, z: number): number {
  if (insideRounded(x, z, ARENA.wallX - 0.05, ARENA.wallZ - 0.05, ARENA.wallCorner - 0.05)) return 0;
  if (insideRounded(x, z, ARENA.wallX + 0.45, ARENA.wallZ + 0.45, ARENA.wallCorner + 0.45)) return WALL_TOP;
  return GROUND_Y;
}

/** Top of the bevelled floor plate built by floorMesh() (resting debris lies here, not at y = 0). */
export const FLOOR_TOP = 0.04;

/** Surface under (x, z) for resting debris: floor plate top, barrier top (`wallTop`, incl. its cap), studio ground. */
export function surfaceY(x: number, z: number, wallTop: number): number {
  if (insideRounded(x, z, ARENA.wallX - 0.05, ARENA.wallZ - 0.05, ARENA.wallCorner - 0.05)) return FLOOR_TOP;
  if (insideRounded(x, z, ARENA.wallX + 0.45, ARENA.wallZ + 0.45, ARENA.wallCorner + 0.45)) return wallTop;
  return GROUND_Y;
}

/** Is (x, z) inside the rounded rectangle with half sizes hx, hz and corner radius r? */
export function insideRounded(x: number, z: number, hx: number, hz: number, r: number): boolean {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (ax > hx || az > hz) return false;
  const qx = ax - (hx - r);
  const qz = az - (hz - r);
  if (qx <= 0 || qz <= 0) return true;
  return Math.hypot(qx, qz) <= r;
}

// --------------------------------------------------------------- decor anchors
export type DecorSpot = [x: number, y: number, z: number, scale: number];
/** A screen frame (for cobwebs in its top corners): centre, tilt, size, front offset, web size. */
export interface DecorScreen {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  w: number;
  h: number;
  front: number;
  size: number;
}
/** Where seasonal / BOSS FIGHT decoration may stand on a stage (never inside the fighting area). */
export interface DecorLayout {
  spots: DecorSpot[];
  menuSpots: DecorSpot[];
  screens: DecorScreen[];
  /** Champion banners: x, y, z, yaw. */
  banners: [number, number, number, number][];
  bats: { r: [number, number]; h: [number, number]; cx: [number, number]; cz: [number, number] };
  /** Winter preview trees (default: the low anchors). */
  trees?: DecorSpot[];
}

// ------------------------------------------------------------------- stage base
/** Things every stage shares with the arena: the live screen / LED ribbon canvases, crowd timing, VFX. */
export interface StageShared {
  screenTex: CanvasTexture;
  boardTex: CanvasTexture;
  crowd: CrowdUniforms;
  vfx(): VFX | null;
  /** Textures owned by the arena (a stage must never dispose them). */
  owned: Set<Texture>;
}

/**
 * One studio set. Builds its dressing into `group`, reacts to set-piece events
 * and frees everything it created in dispose() (shared arena textures excepted).
 */
export abstract class Stage {
  readonly group = new Group();
  abstract readonly id: ArenaId;
  abstract readonly layout: DecorLayout;
  protected sh: StageShared;
  protected low = false;
  protected motion = 1;
  protected time = 0;
  /** The fight is paused (pause menu, hitstop): debris holds still, like the VFX. */
  debrisFrozen = false;

  constructor(shared: StageShared) {
    this.sh = shared;
  }

  /** Recolour signs, LED ribbons, spots and glow sticks for a theme (`isDefault`: the stock look). */
  applyTheme(_th: ArenaTheme, _isDefault: boolean): void {}
  /** BOSS FIGHT phases recolour the moving spotlights. */
  setSpots(_colors: number[]): void {}
  /** A set piece was hit but holds (hp left) or a reactive piece reacted (hp = -1). */
  abstract propHit(index: number, hp: number, heavy: boolean, x: number, z: number): void;
  abstract propBreak(index: number, x: number, z: number): void;
  propRespawn(_index: number, _x: number, _z: number): void {}
  /**
   * Alpha 1.7.5: a piece of cover on the fighting floor took a hit ('hit'), changed its look
   * ('crack', stage 1–2) or shattered ('break'). Only GRAVEYARD BROADCAST has cover.
   */
  coverEvent(_index: number, _what: 'hit' | 'crack' | 'break', _stage: number, _x: number, _z: number, _dx: number, _dz: number, _heavy: boolean): void {}
  /** Every set piece back to its intact state (new fight, back to the menu). */
  abstract resetProps(): void;
  setQuality(low: boolean): void {
    this.low = low;
  }
  setMotion(m: number): void {
    this.motion = m;
  }
  setMenu(_menu: boolean): void {}
  abstract update(dt: number, excite: number, boost: number): void;

  protected get vfx(): VFX | null {
    return this.sh.vfx();
  }

  dispose(): void {
    const mats = new Set<Material>();
    const geos = new Set<BufferGeometry>();
    this.group.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (m.geometry && !m.geometry.userData.shared) geos.add(m.geometry);
      const mat = m.material as Material | Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => mats.add(x));
      else if (mat) mats.add(mat);
    });
    for (const g of geos) g.dispose();
    for (const m of mats) {
      const mm = m as Material & { map?: Texture | null; emissiveMap?: Texture | null; alphaMap?: Texture | null };
      for (const t of [mm.map, mm.emissiveMap, mm.alphaMap]) if (t && !this.sh.owned.has(t)) t.dispose();
      m.dispose();
    }
    this.group.removeFromParent();
    this.group.clear();
  }
}
