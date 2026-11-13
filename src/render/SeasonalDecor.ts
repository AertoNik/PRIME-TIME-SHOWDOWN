import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  BoxGeometry,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARENA } from '../config/balance';
import type { ArenaId } from '../config/arenas.config';
import type { AmbientKind, DecorKind } from '../config/themes.config';
import { Rng } from '../core/math';
import { FLOOR_TOP, GROUND_Y, WALL_TOP, type DecorLayout, type DecorSpot } from './stages/StageKit';
import { canvasTexture, makeCanvas } from './textures';

// Seasonal 3D decoration layered over the current studio set. Everything sits
// outside the fighting area at anchors the set provides (DecorLayout: barrier
// corners, gaps beside the barrier, around its screens), so collisions, camera
// framing and fighter visibility are untouched. A few pieces stand next to the
// menu pedestal and are shown only on menu screens. One instanced mesh per object
// type keeps the extra draw calls to a handful.

type Spot = DecorSpot;

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();
const _up = new Vector3(0, 1, 0);
const _c = new Color();

/** A point at distance `d` along a rounded rectangle (half sizes hx, hz, corner radius r), from its back-left. */
function ringPoint(hx: number, hz: number, r: number, d: number): Vector3 {
  const sx = 2 * (hx - r);
  const sz = 2 * (hz - r);
  const arc = (Math.PI / 2) * r;
  const corner = (cx: number, cz: number, a: number) => new Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
  const segs: [number, (u: number) => Vector3][] = [
    [sx, (u) => new Vector3(-hx + r + u, 0, -hz)],
    [arc, (u) => corner(hx - r, -hz + r, -Math.PI / 2 + u / r)],
    [sz, (u) => new Vector3(hx, 0, -hz + r + u)],
    [arc, (u) => corner(hx - r, hz - r, u / r)],
    [sx, (u) => new Vector3(hx - r - u, 0, hz)],
    [arc, (u) => corner(-hx + r, hz - r, Math.PI / 2 + u / r)],
    [sz, (u) => new Vector3(-hx, 0, hz - r - u)],
    [arc, (u) => corner(-hx + r, -hz + r, Math.PI + u / r)],
  ];
  let left = d;
  for (const [len, f] of segs) {
    if (left <= len) return f(left);
    left -= len;
  }
  return new Vector3(-hx + r, 0, -hz);
}

function placeInstances(mesh: InstancedMesh, spots: Spot[], faceCentre: boolean, rng: Rng): void {
  spots.forEach(([x, y, z, s], i) => {
    const yaw = faceCentre ? Math.atan2(-x, -z) + rng.range(-0.35, 0.35) : rng.range(0, Math.PI * 2);
    _q.setFromAxisAngle(_up, yaw);
    _m.compose(_p.set(x, y, z), _q, _s.setScalar(s));
    mesh.setMatrixAt(i, _m);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

function colorAttr(g: BufferGeometry, c: Color): BufferGeometry {
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

// ------------------------------------------------------------ halloween bits
/** Ribbed, slightly squashed pumpkin with a stem; the carved face faces +Z (u = 0.25). */
function pumpkinGeometry(): BufferGeometry {
  const body = new SphereGeometry(1, 22, 14);
  const pos = body.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const phi = Math.atan2(z, x);
    const k = 1 + 0.075 * Math.cos(phi * 8) * (1 - Math.abs(y) ** 3);
    y *= 0.78;
    if (y < -0.62) y = -0.62 + (y + 0.62) * 0.35;
    pos.setXYZ(i, x * k, y + 0.66, z * k);
  }
  body.computeVertexNormals();
  colorAttr(body, new Color(0xff7a1a));
  const stem = new CylinderGeometry(0.07, 0.12, 0.34, 7);
  stem.rotateZ(0.18);
  stem.translate(0.02, 1.48, 0);
  const uv = stem.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.75, 0.98); // a dark texel: no glow on the stem
  colorAttr(stem, new Color(0x4a7a2a));
  const g = mergeGeometries([body, stem])!;
  body.dispose();
  stem.dispose();
  return g;
}

/** Emissive map: warm inner glow with carved eyes and a grin around u = 0.25. */
function pumpkinFaceTexture(): CanvasTexture {
  const { c, g } = makeCanvas(256, 128);
  g.fillStyle = '#2a1000';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#ffcf4a';
  g.shadowColor = '#ffb020';
  g.shadowBlur = 6;
  const cx = 64;
  // eyes
  for (const dx of [-15, 15]) {
    g.beginPath();
    g.moveTo(cx + dx - 8, 56);
    g.lineTo(cx + dx + 8, 56);
    g.lineTo(cx + dx, 42);
    g.closePath();
    g.fill();
  }
  // nose
  g.beginPath();
  g.moveTo(cx - 4, 66);
  g.lineTo(cx + 4, 66);
  g.lineTo(cx, 60);
  g.fill();
  // jagged grin
  g.beginPath();
  g.moveTo(cx - 26, 72);
  const pts = [-18, 80, -12, 74, -6, 82, 0, 75, 6, 82, 12, 74, 18, 80, 26, 72];
  for (let i = 0; i < pts.length; i += 2) g.lineTo(cx + pts[i], pts[i + 1]);
  g.quadraticCurveTo(cx, 98, cx - 26, 72);
  g.fill();
  return canvasTexture(c);
}

function batTexture(): CanvasTexture {
  const { c, g } = makeCanvas(128, 64);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(64, 26);
  g.quadraticCurveTo(52, 10, 30, 14);
  g.quadraticCurveTo(18, 16, 4, 30);
  g.quadraticCurveTo(16, 30, 22, 38);
  g.quadraticCurveTo(30, 32, 38, 40);
  g.quadraticCurveTo(46, 34, 56, 42);
  g.lineTo(64, 50);
  g.lineTo(72, 42);
  g.quadraticCurveTo(82, 34, 90, 40);
  g.quadraticCurveTo(98, 32, 106, 38);
  g.quadraticCurveTo(112, 30, 124, 30);
  g.quadraticCurveTo(110, 16, 98, 14);
  g.quadraticCurveTo(76, 10, 64, 26);
  g.fill();
  // ears
  g.beginPath();
  g.moveTo(58, 24);
  g.lineTo(60, 14);
  g.lineTo(64, 22);
  g.lineTo(68, 14);
  g.lineTo(70, 24);
  g.fill();
  return canvasTexture(c);
}

function webTexture(): CanvasTexture {
  const { c, g } = makeCanvas(256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 2;
  const spokes = 7;
  for (let i = 0; i <= spokes; i++) {
    const a = (i / spokes) * (Math.PI / 2);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * 250, Math.sin(a) * 250);
    g.stroke();
  }
  g.lineWidth = 1.5;
  for (let r = 34; r < 250; r += 30) {
    g.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * (Math.PI / 2);
      const sag = i > 0 && i < spokes ? 0.9 : 1;
      const x = Math.cos(a) * r * sag;
      const y = Math.sin(a) * r * sag;
      if (i === 0) g.moveTo(x, y);
      else g.quadraticCurveTo(Math.cos(a - 0.11) * r * 0.86, Math.sin(a - 0.11) * r * 0.86, x, y);
    }
    g.stroke();
  }
  return canvasTexture(c);
}

/** Crimson title banner with a gold border, crown and the boss monogram (BOSS FIGHT). */
function bannerTexture(halloween = false): CanvasTexture {
  const { c, g } = makeCanvas(160, 416);
  const W = 160;
  const H = 416;
  g.fillStyle = halloween ? '#3a0f5a' : '#8a0f22';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(W, 0);
  g.lineTo(W, H - 40);
  g.lineTo(W / 2, H);
  g.lineTo(0, H - 40);
  g.closePath();
  g.fill();
  g.strokeStyle = halloween ? '#ff9a2a' : '#ffd76a';
  g.lineWidth = 8;
  g.stroke();
  g.strokeStyle = halloween ? 'rgba(255, 154, 42, 0.55)' : 'rgba(255, 215, 106, 0.5)';
  g.lineWidth = 2;
  g.strokeRect(16, 16, W - 32, H - 90);
  // crown
  g.fillStyle = '#ffd76a';
  g.beginPath();
  g.moveTo(40, 96);
  g.lineTo(44, 50);
  g.lineTo(62, 74);
  g.lineTo(80, 40);
  g.lineTo(98, 74);
  g.lineTo(116, 50);
  g.lineTo(120, 96);
  g.closePath();
  g.fill();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'italic 900 64px Unbounded, "Arial Black", sans-serif';
  g.fillText('VV', W / 2, 160);
  g.font = '900 20px Unbounded, "Arial Black", sans-serif';
  g.fillStyle = halloween ? '#ffd9a0' : '#fff1c0';
  ['L', 'E', 'G', 'E', 'N', 'D'].forEach((ch, i) => g.fillText(ch, W / 2, 214 + i * 26));
  if (halloween) {
    // a small jack-o'-lantern under the letters: HALLOWEEN SPECIAL edition
    g.fillStyle = '#ff8a1f';
    g.beginPath();
    g.ellipse(W / 2, H - 70, 22, 17, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3a0f5a';
    for (const dx of [-8, 8]) {
      g.beginPath();
      g.moveTo(W / 2 + dx - 4, H - 72);
      g.lineTo(W / 2 + dx + 4, H - 72);
      g.lineTo(W / 2 + dx, H - 79);
      g.fill();
    }
    g.fillRect(W / 2 - 9, H - 64, 18, 3);
  }
  return canvasTexture(c);
}

/**
 * Flat additive glow on the fighting floor: seasonal colour creeping in from the
 * barrier, a few glyphs in the corners. The centre stays clear for readability.
 */
function floorDecal(kind: DecorKind): Mesh {
  const hx = ARENA.wallX;
  const hz = ARENA.wallZ;
  const W = 512;
  const H = Math.round((W * hz) / hx);
  const { c, g } = makeCanvas(W, H);
  const mixed = kind === 'championHalloween';
  const halloween = kind === 'pumpkins';
  const champion = kind === 'champion' || mixed;
  const edge = halloween ? '150, 60, 255' : champion ? '255, 190, 60' : '150, 215, 255';
  const grd = g.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, H * 0.62);
  grd.addColorStop(0, `rgba(${edge}, 0)`);
  grd.addColorStop(0.7, `rgba(${mixed ? '170, 70, 255' : edge}, 0.10)`);
  grd.addColorStop(1, `rgba(${edge}, 0.34)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // corner glyphs
  const ppu = W / (hx * 2);
  g.lineWidth = 3;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = W / 2 + sx * (hx - 1.25) * ppu;
      const y = H / 2 + sz * (hz - 1.25) * ppu;
      g.save();
      g.translate(x, y);
      if (champion) {
        // little crowns in the corners
        g.strokeStyle = 'rgba(255, 215, 106, 0.6)';
        g.beginPath();
        g.moveTo(-16, 10);
        g.lineTo(-14, -8);
        g.lineTo(-6, 2);
        g.lineTo(0, -12);
        g.lineTo(6, 2);
        g.lineTo(14, -8);
        g.lineTo(16, 10);
        g.closePath();
        g.stroke();
      } else if (halloween) {
        g.strokeStyle = 'rgba(255, 150, 50, 0.55)';
        for (const [dx, rx] of [[-9, 13], [9, 13], [0, 15]] as [number, number][]) {
          g.beginPath();
          g.ellipse(dx, 0, rx, 18, 0, 0, Math.PI * 2);
          g.stroke();
        }
        g.fillStyle = 'rgba(255, 190, 80, 0.5)';
        for (const dx of [-7, 7]) {
          g.beginPath();
          g.moveTo(dx - 4, -2);
          g.lineTo(dx + 4, -2);
          g.lineTo(dx, -8);
          g.fill();
        }
      } else {
        // 1.9.7: a snowflake with little branches in each corner
        g.strokeStyle = 'rgba(225, 246, 255, 0.6)';
        g.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          g.rotate(Math.PI / 3);
          g.beginPath();
          g.moveTo(0, 0);
          g.lineTo(0, -24);
          for (const s of [-1, 1]) {
            g.moveTo(0, -13);
            g.lineTo(s * 7, -19);
          }
          g.stroke();
        }
      }
      g.restore();
    }
  }
  if (kind === 'frost') {
    // 1.9.7: frost creeping in from the barrier — a soft white edge, and a dusting of frost sparkles
    const fr = g.createRadialGradient(W / 2, H / 2, H * 0.44, W / 2, H / 2, H * 0.62);
    fr.addColorStop(0, 'rgba(200, 235, 255, 0)');
    fr.addColorStop(1, 'rgba(220, 242, 255, 0.13)');
    g.fillStyle = fr;
    g.fillRect(0, 0, W, H);
    const rng = new Rng(404);
    for (let k = 0; k < 160; k++) {
      const x = rng.range(0, W);
      const y = rng.range(0, H);
      const edge = Math.max(Math.abs(x / W - 0.5) * 2, Math.abs(y / H - 0.5) * 2);
      if (edge < 0.55) continue;
      g.fillStyle = `rgba(235, 248, 255, ${rng.range(0.15, 0.45) * edge})`;
      g.fillRect(x, y, 2, 2);
    }
  }
  const tex = canvasTexture(c);
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  const mesh = new Mesh(new PlaneGeometry(hx * 2, hz * 2), mat);
  mesh.rotation.x = -Math.PI / 2;
  // 1.9.7: the winter decal lies on the floor plate's top (FLOOR_TOP since 1.7.5). The other decals keep their old
  // height (0.012 — under that top, so they do not show): lifting them would change the BOSS FIGHT and Halloween look
  // outside this release (noted for the owner)
  mesh.position.y = kind === 'frost' ? FLOOR_TOP + 0.008 : 0.012;
  mesh.renderOrder = 0;
  return mesh;
}

// --------------------------------------------------------------- ambient
function ambientPoints(kind: AmbientKind, colors: number[], count: number): Points {
  const rng = new Rng(77);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const c = new Color();
  for (let i = 0; i < count; i++) {
    // keep clear of the fighting floor: a ring around it plus the space above the stands
    let x = rng.range(-14, 14);
    let z = rng.range(-16, 7);
    if (Math.abs(x) < 6.2 && z > -8.2) x = Math.sign(x || 1) * rng.range(6.2, 13);
    pos[i * 3] = x;
    pos[i * 3 + 1] = rng.range(0, 9);
    pos[i * 3 + 2] = z;
    c.setHex(colors[i % colors.length] ?? 0xffffff);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    seed[i] = rng.range(0, 100);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('seed', new Float32BufferAttribute(seed, 1));
  const snow = kind === 'snow' ? 1 : 0;
  const mat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 300 } },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute float seed;
      uniform float uTime;
      uniform float uScale;
      varying vec3 vColor;
      varying float vA;
      void main() {
        vec3 p = position;
        float sp = ${snow ? '0.55' : '0.32'} + fract(seed * 0.37) * 0.35;
        float h = mod(p.y ${snow ? '-' : '+'} uTime * sp, 9.0);
        p.y = h;
        p.x += sin(uTime * 0.6 + seed) * ${snow ? '0.35' : '0.6'};
        p.z += cos(uTime * 0.5 + seed * 1.3) * 0.4;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float fade = smoothstep(0.0, 1.2, h) * smoothstep(9.0, 7.5, h);
        vA = fade * (${snow ? '0.75' : '0.45 + 0.35 * sin(uTime * 2.0 + seed)'});
        vColor = color;
        gl_PointSize = uScale * ${snow ? '0.075' : '0.11'} / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, ${snow ? '0.25' : '0.0'}, r) * vA;
        gl_FragColor = vec4(vColor * a * ${snow ? '1.1' : '2.0'}, 1.0);
      }`,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const pts = new Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

// ---------------------------------------------------------------- decor
interface Bat {
  r: number;
  h: number;
  cx: number;
  cz: number;
  speed: number;
  phase: number;
  size: number;
}

/** One theme's decoration. Call dispose() before building another. */
export class SeasonalDecor {
  readonly group = new Group();
  /** Pieces near the menu pedestal; hidden during fights. */
  readonly menuGroup = new Group();
  private ambient: Points | null = null;
  private ambientCount = 0;
  private bats: InstancedMesh | null = null;
  private batData: Bat[] = [];
  private glowMats: MeshStandardMaterial[] = [];
  /** 1.9.7: the ice crystals' soft glow (breathes slowly). */
  private glowMatsIce: MeshStandardMaterial[] = [];
  /** Alpha 1.9.7: twinkling lights (the lobby tree's only while the lobby shows) and their own colours. */
  private twinkles: { mesh: InstancedMesh; base: Color[]; menu: boolean }[] = [];
  private t = 0;

  private layout: DecorLayout;

  /**
   * @param layout anchors of the current studio set
   * @param native the set already dresses itself for this season (HAUNTED PRIME SET at
   *   Halloween): only ambience and BOSS FIGHT pieces are added, no second set of pumpkins
   */
  /** Alpha 1.9.7: which set this decor dresses (each wears the winter in its own style) and its barrier set pieces. */
  private stage: ArenaId | null;
  private barrierProps: { x: number; z: number }[];

  constructor(kind: DecorKind, ambient: AmbientKind, ambientColors: number[], lowQuality: boolean, layout: DecorLayout, native = false, opts: { stage?: ArenaId; props?: { x: number; z: number }[] } = {}) {
    this.layout = layout;
    this.stage = opts.stage ?? null;
    this.barrierProps = opts.props ?? [];
    this.group.add(this.menuGroup);
    if (kind === 'pumpkins' && !native) this.buildHalloween(layout.spots);
    // (1.9.7: on the New Year set — which dresses itself — only the lobby pieces)
    else if (kind === 'frost') this.buildFrost(native);
    else if (kind === 'champion') this.buildChampion(layout.spots, false);
    else if (kind === 'championHalloween') {
      // BOSS FIGHT during Halloween: champion pylons and banners in the season's colours,
      // with jack-o'-lanterns between the pylons
      const even = layout.spots.filter((_, i) => i % 2 === 0);
      const odd = layout.spots.filter((_, i) => i % 2 === 1);
      this.buildChampion(native ? layout.spots : even, true);
      if (!native) this.buildHalloween(odd);
    }
    if (kind !== 'none' && !native) this.group.add(floorDecal(kind));
    if (ambient !== 'none') {
      this.ambientCount = ambient === 'snow' ? 120 : 70;
      this.ambient = ambientPoints(ambient, ambientColors, this.ambientCount);
      this.group.add(this.ambient);
      this.setQuality(lowQuality);
    }
  }

  /** Fewer ambient particles on the low graphics preset. */
  setQuality(low: boolean): void {
    if (!this.ambient) return;
    this.ambient.geometry.setDrawRange(0, low ? Math.round(this.ambientCount * 0.4) : this.ambientCount);
  }

  private buildHalloween(spots: Spot[]): void {
    const L = this.layout;
    const rng = new Rng(31);
    const geo = pumpkinGeometry();
    const face = pumpkinFaceTexture();
    const mat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0.05,
      emissiveMap: face,
      emissive: new Color(1, 0.62, 0.22),
      emissiveIntensity: 2.6,
    });
    this.glowMats.push(mat);
    const arena = new InstancedMesh(geo, mat, spots.length);
    placeInstances(arena, spots, true, rng);
    arena.castShadow = false;
    this.group.add(arena);
    const menu = new InstancedMesh(geo, mat, L.menuSpots.length);
    // menu pumpkins look toward the camera side
    L.menuSpots.forEach(([x, y, z, s], i) => {
      _q.setFromAxisAngle(_up, Math.atan2(-x * 0.4, 6 - z) + rng.range(-0.3, 0.3));
      _m.compose(_p.set(x, y, z), _q, _s.setScalar(s));
      menu.setMatrixAt(i, _m);
    });
    menu.instanceMatrix.needsUpdate = true;
    this.menuGroup.add(menu);

    // bats circling above the stands
    const batMat = new MeshBasicMaterial({ map: batTexture(), color: 0x1a0c26, transparent: true, alphaTest: 0.35, side: DoubleSide });
    const batGeo = new PlaneGeometry(1, 0.5);
    this.bats = new InstancedMesh(batGeo, batMat, 7);
    this.bats.frustumCulled = false;
    for (let i = 0; i < 7; i++) {
      this.batData.push({
        r: rng.range(L.bats.r[0], L.bats.r[1]),
        h: rng.range(L.bats.h[0], L.bats.h[1]),
        cx: rng.range(L.bats.cx[0], L.bats.cx[1]),
        cz: rng.range(L.bats.cz[0], L.bats.cz[1]),
        speed: rng.range(0.25, 0.45) * (rng.chance(0.5) ? 1 : -1),
        phase: rng.range(0, 6.28),
        size: rng.range(0.7, 1.1),
      });
    }
    this.group.add(this.bats);

    // cobwebs in the top corners of the big screens (built in each screen's local frame)
    const webs: BufferGeometry[] = [];
    const screenObj = new Object3D();
    const corner = new Object3D();
    screenObj.add(corner);
    const addWebs = (x: number, y: number, z: number, rx: number, ry: number, w: number, h: number, front: number, size: number) => {
      screenObj.position.set(x, y, z);
      screenObj.rotation.set(rx, ry, 0);
      for (const side of [-1, 1]) {
        const p = new PlaneGeometry(size, size);
        p.translate(size / 2, -size / 2, 0); // top-left corner of the plane at the origin
        corner.position.set((side * w) / 2, h / 2, front);
        corner.scale.set(-side, 1, 1); // mirror for the right-hand corner
        screenObj.updateMatrixWorld(true);
        p.applyMatrix4(corner.matrixWorld);
        webs.push(p);
      }
    };
    for (const f of L.screens) addWebs(f.x, f.y, f.z, f.rx, f.ry, f.w, f.h, f.front, f.size);
    if (!webs.length) return;
    const webGeo = mergeGeometries(webs)!;
    webs.forEach((w) => w.dispose());
    const webMat = new MeshBasicMaterial({ map: webTexture(), color: 0xd8c8ff, transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide });
    this.group.add(new Mesh(webGeo, webMat));
  }

  private buildFrost(lobbyOnly = false): void {
    const rng = new Rng(53);
    this.buildHolidayLobby();
    if (lobbyOnly) return;
    // snow mounds where the pumpkins would be
    const mound = new SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    mound.scale(1.3, 0.55, 1.1);
    const snowMat = new MeshLambertMaterial({ color: 0xf2f8ff, emissive: new Color(0x2a4a78), emissiveIntensity: 0.6 });
    const mounds = new InstancedMesh(mound, snowMat, this.layout.spots.length);
    placeInstances(mounds, this.layout.spots, false, rng);
    this.group.add(mounds);

    // little pine trees in the gaps beside the barrier, with glowing star toppers
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const cone = new ConeGeometry(0.9 - i * 0.22, 1.1, 9);
      cone.translate(0, 0.9 + i * 0.6, 0);
      parts.push(colorAttr(cone, new Color(0x1f6a4a).multiplyScalar(1 - i * 0.08)));
    }
    const trunk = new CylinderGeometry(0.14, 0.18, 0.5, 6);
    trunk.translate(0, 0.25, 0);
    parts.push(colorAttr(trunk, new Color(0x5a3a22)));
    const treeGeo = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
    parts.forEach((p) => p.dispose());
    const treeMat = new MeshLambertMaterial({ vertexColors: true });
    const treeSpots: Spot[] = this.layout.trees ?? this.layout.spots.filter((p) => p[1] <= 0).slice(0, 6).map(([x, y, z]) => [x, y, z, 1] as Spot);
    const trees = new InstancedMesh(treeGeo, treeMat, treeSpots.length);
    placeInstances(trees, treeSpots, false, rng);
    this.group.add(trees);
    const star = new OctahedronGeometry(0.16, 0);
    const starMat = new MeshBasicMaterial({ color: new Color(0xfff2a0).multiplyScalar(3) });
    const stars = new InstancedMesh(star, starMat, treeSpots.length);
    treeSpots.forEach(([x, y, z, s], i) => {
      _m.compose(_p.set(x, y + 2.35 * s, z), _q.identity(), _s.setScalar(s));
      stars.setMatrixAt(i, _m);
    });
    this.group.add(stars);
    // 1.9.7: the set's own winter style (lights on its barrier, and its own pieces)
    this.buildWinterStyle(rng);

    // snowmen beside the menu pedestal
    const sm: BufferGeometry[] = [];
    const ball = (r: number, y: number) => colorAttr(new SphereGeometry(r, 14, 10).translate(0, y, 0), new Color(0xf4f9ff));
    sm.push(ball(0.5, 0.45), ball(0.36, 1.1), ball(0.26, 1.58));
    const nose = new ConeGeometry(0.06, 0.28, 6);
    nose.rotateX(Math.PI / 2);
    nose.translate(0, 1.6, 0.36);
    sm.push(colorAttr(nose, new Color(0xff7a1a)));
    for (const dx of [-0.09, 0.09]) sm.push(colorAttr(new SphereGeometry(0.035, 6, 4).translate(dx, 1.68, 0.23), new Color(0x101820)));
    const snowmanGeo = mergeGeometries(sm.map((p) => p.toNonIndexed()))!;
    sm.forEach((p) => p.dispose());
    const snowmen = new InstancedMesh(snowmanGeo, new MeshLambertMaterial({ vertexColors: true, emissive: new Color(0x10203a) }), 2);
    [
      [-1.9, 0, 0.5, 0.75],
      [1.8, 0, 0.8, 0.6],
    ].forEach(([x, y, z, s], i) => {
      _q.setFromAxisAngle(_up, Math.atan2(-x * 0.4, 6 - z));
      _m.compose(_p.set(x, y, z), _q, _s.setScalar(s));
      snowmen.setMatrixAt(i, _m);
    });
    this.menuGroup.add(snowmen);
  }

  /**
   * Alpha 1.9.7 — WINTER SHOWDOWN: the lobby as a New Year special — a tall tree with a gold star and twinkling lights
   * behind the pedestal on the right, gift boxes and two big candy canes beside it. Everything stands beside and behind
   * the fighter (|x| ≥ 1.2, z ≤ 0.9): the fighter, the buttons and the information stay clear.
   */
  private buildHolidayLobby(): void {
    const rng = new Rng(61);
    // the tree stands behind the fighter's left shoulder (screen right), close enough to show on a phone too
    const TX = 1.85;
    const TZ = -3.9;
    const TS = 1.05;
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) parts.push(colorAttr(new ConeGeometry(1.15 - i * 0.24, 1.15, 12).translate(0, 0.95 + i * 0.68, 0), new Color(0x1c6646).multiplyScalar(1 - i * 0.06)));
    parts.push(colorAttr(new CylinderGeometry(0.16, 0.2, 0.5, 8).translate(0, 0.25, 0), new Color(0x5a3a22)));
    // gift boxes under the tree and beside the pedestal (paper + gold ribbon)
    const gifts: [number, number, number, number, number][] = [
      [2.75, -2.55, 0.5, 0xc4122f, 0.4],
      [1.75, -2.35, 0.38, 0x1f4fd8, -0.3],
      [-2.35, -1.2, 0.46, 0x157a4a, 0.2],
      [-1.55, -1.75, 0.32, 0xe0b84c, 0.6],
    ];
    const giftParts: BufferGeometry[] = [];
    for (const [x, z, sz, col, yaw] of gifts) {
      const box = colorAttr(new BoxGeometry(sz, sz * 0.82, sz), new Color(col));
      const r1 = colorAttr(new BoxGeometry(sz * 1.02, sz * 0.84, sz * 0.16), new Color(0xe0b84c));
      const r2 = colorAttr(new BoxGeometry(sz * 0.16, sz * 0.84, sz * 1.02), new Color(0xe0b84c));
      const bow = colorAttr(new TorusGeometry(sz * 0.16, sz * 0.05, 6, 10).translate(0, sz * 0.48, 0), new Color(0xffd36a));
      for (const g of [box, r1, r2, bow]) {
        g.rotateY(yaw);
        g.translate(x, sz * 0.41, z);
        giftParts.push(g);
      }
    }
    // two candy canes: red and white bands, a hook
    for (const [x, z, sc] of [
      [-2.75, -0.45, 1],
      [2.6, 0.2, 0.85],
    ] as [number, number, number][]) {
      for (let k = 0; k < 7; k++) giftParts.push(colorAttr(new CylinderGeometry(0.07 * sc, 0.07 * sc, 0.2 * sc, 10).translate(x, (0.1 + k * 0.2) * sc, z), new Color(k % 2 ? 0xd8162e : 0xfaf4ee)));
      giftParts.push(colorAttr(new TorusGeometry(0.22 * sc, 0.07 * sc, 8, 14, Math.PI).translate(x - 0.22 * sc * Math.sign(x), 1.4 * sc, z), new Color(0xd8162e)));
    }
    const mat = new MeshLambertMaterial({ vertexColors: true, emissive: new Color(0x0c1426) });
    const treeGeo = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
    parts.forEach((p) => p.dispose());
    const tree = new Mesh(treeGeo, mat);
    tree.position.set(TX, 0, TZ);
    tree.scale.setScalar(TS);
    this.menuGroup.add(tree);
    const giftGeo = mergeGeometries(giftParts.map((p) => p.toNonIndexed()))!;
    giftParts.forEach((p) => p.dispose());
    this.menuGroup.add(new Mesh(giftGeo, mat));
    const star = new Mesh(new OctahedronGeometry(0.22, 0), new MeshBasicMaterial({ color: new Color(0xfff2a0).multiplyScalar(3) }));
    star.position.set(TX, 3.75 * TS, TZ);
    this.menuGroup.add(star);
    // the tree's lights (instanced, a few twinkle each frame)
    const n = 34;
    const lights = new InstancedMesh(new SphereGeometry(0.055, 6, 4), new MeshBasicMaterial({ toneMapped: false }), n);
    const cols = [0xff3a5a, 0xffcc4d, 0x7fe3ff, 0x7aff9a];
    for (let i = 0; i < n; i++) {
      const h = 0.6 + (i / n) * 2.6;
      const rad = Math.max(0.18, 1.08 - h * 0.33) * TS;
      const a = i * 2.4 + rng.range(-0.2, 0.2);
      _m.compose(_p.set(TX + Math.cos(a) * rad, (0.3 + h) * TS, TZ + Math.sin(a) * rad), _q.identity(), _s.setScalar(1));
      lights.setMatrixAt(i, _m);
      const c = new Color(cols[i % cols.length]).multiplyScalar(2.2);
      this.twinkleBase.push(c);
      lights.setColorAt(i, c);
    }
    this.menuGroup.add(lights);
    this.twinkles.push({ mesh: lights, base: this.twinkleBase, menu: true });
  }

  private twinkleBase: Color[] = [];

  // ------------------------------------------------------------ 1.9.7: a winter style per set
  /**
   * Every set wears the New Year in its own way — all of it outside the fighting area (on top of or outside the
   * barrier, on the walls, under the screens), so collisions, cover, the camera and the fighters are untouched:
   *   ORIGINAL PRIME ARENA  a cool «winter gala»: ice-blue and white lights on the barrier, ice crystal sculptures
   *   PRIME CASINO          red and gold: gold and red lights, towers of gifts with gold ribbons, baubles under the screens
   *   STUDIO BACKLOT        a snowy street: warm retro multicolour bulbs, icicles on the barrier, wreaths on the walls
   *   GRAVEYARD BROADCAST   a frozen night: icy blue and violet lights, icicles, ice crystals
   */
  private buildWinterStyle(rng: Rng): void {
    const st = this.stage;
    if (!st || st === 'holiday') return;
    const ground = this.layout.spots.filter((s) => s[1] <= 0.35);
    this.snowDrifts(rng);
    if (st === 'original') {
      this.barrierLights([0x9fe8ff, 0xffffff, 0x7fb8ff], 0.42, 0.05, rng);
      this.iceCrystals(ground.filter((_, i) => i % 2 === 0), rng);
      this.wreaths(0x9fe8ff);
    } else if (st === 'casino') {
      this.barrierLights([0xffcc4d, 0xff3a5a, 0xfff1c4], 0.38, 0.055, rng);
      this.giftTowers(ground.filter((_, i) => i % 2 === 1), rng);
      this.screenBaubles([0xd8162e, 0xe0b84c, 0xd8162e]);
      this.wreaths(0xffcc4d);
    } else if (st === 'backlot') {
      this.barrierLights([0xff5a3a, 0xffcc4d, 0x5ad0ff, 0x7aff7a, 0xff7ad9], 0.46, 0.07, rng);
      this.icicles(rng);
      this.wreaths(0xd8162e);
    } else if (st === 'graveyard' || st === 'haunted') {
      this.barrierLights([0x7fd8ff, 0xb48cff, 0xe8f6ff], 0.5, 0.05, rng);
      this.icicles(rng);
      this.iceCrystals(ground.filter((_, i) => i % 2 === 0), rng);
    }
  }

  /** Bulbs along the top of the barrier (none where a set piece stands on it); a few twinkle each frame. */
  private barrierLights(colors: number[], step: number, size: number, rng: Rng): void {
    const off = 0.24;
    const hx = ARENA.wallX + off;
    const hz = ARENA.wallZ + off;
    const r = ARENA.wallCorner + off;
    const per = 2 * (2 * (hx - r) + 2 * (hz - r)) + 2 * Math.PI * r;
    const pts: Vector3[] = [];
    for (let i = 0, n = Math.round(per / step); i < n; i++) {
      const p = ringPoint(hx, hz, r, (i / n) * per);
      if (this.barrierProps.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < 0.6)) continue;
      pts.push(p);
    }
    if (!pts.length) return;
    const mesh = new InstancedMesh(new SphereGeometry(size, 8, 6), new MeshBasicMaterial({ toneMapped: false }), pts.length);
    const base: Color[] = [];
    pts.forEach((p, i) => {
      _m.compose(_p.set(p.x, WALL_TOP + size + 0.02 + rng.range(0, 0.02), p.z), _q.identity(), _s.setScalar(1));
      mesh.setMatrixAt(i, _m);
      const c = new Color(colors[i % colors.length]).multiplyScalar(2.1);
      base.push(c);
      mesh.setColorAt(i, c);
    });
    this.group.add(mesh);
    this.twinkles.push({ mesh, base, menu: false });
  }

  /** Low snow drifts against the outside of the barrier (they never rise over it). */
  private snowDrifts(rng: Rng): void {
    const off = 0.64;
    const hx = ARENA.wallX + off;
    const hz = ARENA.wallZ + off;
    const r = ARENA.wallCorner + off;
    const per = 2 * (2 * (hx - r) + 2 * (hz - r)) + 2 * Math.PI * r;
    const n = Math.round(per / 0.75);
    const mesh = new InstancedMesh(new SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new MeshLambertMaterial({ color: 0xb8c8e8, emissive: new Color(0x1a3058), emissiveIntensity: 0.3 }), n);
    for (let i = 0; i < n; i++) {
      const p = ringPoint(hx, hz, r, (i / n) * per);
      const s = rng.range(0.45, 0.8);
      _q.setFromAxisAngle(_up, rng.range(0, 3));
      _m.compose(_p.set(p.x, GROUND_Y, p.z), _q, _s.set(s, rng.range(0.22, 0.42), s * rng.range(0.6, 1)));
      mesh.setMatrixAt(i, _m);
    }
    this.group.add(mesh);
  }

  /** Icicles under the outer lip of the barrier. */
  private icicles(rng: Rng): void {
    const off = 0.46;
    const hx = ARENA.wallX + off;
    const hz = ARENA.wallZ + off;
    const r = ARENA.wallCorner + off;
    const per = 2 * (2 * (hx - r) + 2 * (hz - r)) + 2 * Math.PI * r;
    const n = Math.round(per / 0.32);
    const cone = new ConeGeometry(1, 1, 6);
    cone.rotateX(Math.PI);
    cone.translate(0, -0.5, 0);
    const mesh = new InstancedMesh(cone, new MeshLambertMaterial({ color: 0xcfefff, emissive: new Color(0x3a78b8), emissiveIntensity: 0.55, transparent: true, opacity: 0.88 }), n);
    for (let i = 0; i < n; i++) {
      const p = ringPoint(hx, hz, r, (i / n) * per);
      const len = rng.range(0.1, 0.32);
      _m.compose(_p.set(p.x, WALL_TOP + 0.01, p.z), _q.identity(), _s.set(rng.range(0.025, 0.045), len, rng.range(0.025, 0.045)));
      mesh.setMatrixAt(i, _m);
    }
    this.group.add(mesh);
  }

  /** Ice crystal sculptures (clusters of tall glowing crystals) beside the arena. */
  private iceCrystals(spots: Spot[], rng: Rng): void {
    if (!spots.length) return;
    const parts: BufferGeometry[] = [];
    for (const [dx, h, tilt] of [
      [0, 1.4, 0],
      [0.32, 0.95, -0.35],
      [-0.3, 1.05, 0.3],
      [0.08, 0.7, 0.55],
    ] as [number, number, number][]) {
      const c = new OctahedronGeometry(0.22, 0);
      c.scale(1, h / 0.44, 1);
      c.rotateZ(tilt);
      c.translate(dx, h * 0.5, dx * 0.3);
      parts.push(c);
    }
    const geo = mergeGeometries(parts.map((q) => q.toNonIndexed()))!;
    parts.forEach((q) => q.dispose());
    const mat = new MeshStandardMaterial({ color: 0xbfeaff, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.86, emissive: new Color(0x5ac8ff), emissiveIntensity: 0.6 });
    this.glowMatsIce.push(mat);
    const mesh = new InstancedMesh(geo, mat, spots.length);
    spots.forEach(([x, y, z, s], i) => {
      _q.setFromAxisAngle(_up, rng.range(0, Math.PI * 2));
      _m.compose(_p.set(x + Math.sign(x) * 0.55, y, z), _q, _s.setScalar(s * 1.6));
      mesh.setMatrixAt(i, _m);
    });
    this.group.add(mesh);
  }

  /** Towers of gifts with gold ribbons (PRIME CASINO). */
  private giftTowers(spots: Spot[], rng: Rng): void {
    if (!spots.length) return;
    const parts: BufferGeometry[] = [];
    let y = 0;
    for (const [s, col, yaw] of [
      [0.9, 0xc4122f, 0],
      [0.66, 0x111111, 0.4],
      [0.46, 0xe0b84c, -0.3],
    ] as [number, number, number][]) {
      const h = s * 0.8;
      for (const g of [
        colorAttr(new BoxGeometry(s, h, s), new Color(col)),
        colorAttr(new BoxGeometry(s * 1.02, h * 1.02, s * 0.14), new Color(col === 0xe0b84c ? 0xd8162e : 0xe0b84c)),
        colorAttr(new BoxGeometry(s * 0.14, h * 1.02, s * 1.02), new Color(col === 0xe0b84c ? 0xd8162e : 0xe0b84c)),
      ]) {
        g.rotateY(yaw);
        g.translate(0, y + h / 2, 0);
        parts.push(g);
      }
      y += h;
    }
    parts.push(colorAttr(new TorusGeometry(0.12, 0.04, 6, 12).rotateY(0.6).translate(-0.08, y + 0.08, 0), new Color(0xffd36a)));
    parts.push(colorAttr(new TorusGeometry(0.12, 0.04, 6, 12).rotateY(-0.6).translate(0.08, y + 0.08, 0), new Color(0xffd36a)));
    const geo = mergeGeometries(parts.map((q) => q.toNonIndexed()))!;
    parts.forEach((q) => q.dispose());
    const mesh = new InstancedMesh(geo, new MeshLambertMaterial({ vertexColors: true, emissive: new Color(0x1a0e06) }), spots.length);
    spots.forEach(([x, gy, z, s], i) => {
      _q.setFromAxisAngle(_up, rng.range(-0.5, 0.5));
      _m.compose(_p.set(x + Math.sign(x) * 0.6, gy, z + 0.3), _q, _s.setScalar(s * 1.5));
      mesh.setMatrixAt(i, _m);
    });
    this.group.add(mesh);
  }

  /** Big baubles hanging under the edge of each screen (built in the screen's own frame). */
  private screenBaubles(colors: number[]): void {
    const parts: BufferGeometry[] = [];
    const frame = new Object3D();
    const at = new Object3D();
    frame.add(at);
    for (const f of this.layout.screens) {
      frame.position.set(f.x, f.y, f.z);
      frame.rotation.set(f.rx, f.ry, 0);
      [-0.32, 0, 0.32].forEach((u, k) => {
        const drop = 0.45 + (k % 2) * 0.35;
        const r = f.size * 0.16;
        at.position.set(u * f.w, -f.h / 2 - drop, f.front + 0.1);
        frame.updateMatrixWorld(true);
        const ball = colorAttr(new SphereGeometry(r, 14, 10), new Color(colors[k % colors.length]));
        const cap = colorAttr(new CylinderGeometry(r * 0.3, r * 0.34, r * 0.32, 8).translate(0, r * 1.02, 0), new Color(0xe0b84c));
        const thread = colorAttr(new CylinderGeometry(0.012, 0.012, drop, 4).translate(0, r + drop / 2, 0), new Color(0xe0b84c));
        for (const g of [ball, cap, thread]) {
          g.applyMatrix4(at.matrixWorld);
          parts.push(g);
        }
      });
    }
    if (!parts.length) return;
    const geo = mergeGeometries(parts.map((q) => q.toNonIndexed()))!;
    parts.forEach((q) => q.dispose());
    this.group.add(new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.6, emissive: new Color(0x1a1020), emissiveIntensity: 0.5 })));
  }

  /** Evergreen wreaths with a bow on the walls (at the banner anchors). */
  private wreaths(bow: number): void {
    const parts: BufferGeometry[] = [];
    for (const [x, y, z, yaw] of this.layout.banners) {
      const ring = colorAttr(new TorusGeometry(0.55, 0.17, 8, 22), new Color(0x1c6646));
      const bw = [
        colorAttr(new TorusGeometry(0.13, 0.05, 6, 12).scale(1, 0.75, 0.6).translate(-0.13, -0.55, 0.12), new Color(bow)),
        colorAttr(new TorusGeometry(0.13, 0.05, 6, 12).scale(1, 0.75, 0.6).translate(0.13, -0.55, 0.12), new Color(bow)),
        colorAttr(new SphereGeometry(0.07, 8, 6).translate(0, -0.55, 0.14), new Color(bow)),
      ];
      const berries: BufferGeometry[] = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + 0.3;
        berries.push(colorAttr(new SphereGeometry(0.06, 6, 4).translate(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.16), new Color(k % 2 ? 0xd8162e : 0xffcc4d)));
      }
      for (const g of [ring, ...bw, ...berries]) {
        g.rotateY(yaw);
        g.translate(x + Math.sin(yaw) * 0.18, y - 1.6, z + Math.cos(yaw) * 0.18);
        parts.push(g);
      }
    }
    if (!parts.length) return;
    const geo = mergeGeometries(parts.map((q) => q.toNonIndexed()))!;
    parts.forEach((q) => q.dispose());
    this.group.add(new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, emissive: new Color(0x0c1a12) })));
  }

  /**
   * BOSS FIGHT dressing: golden light pylons around the barrier (where seasonal
   * props stand) and four crimson-gold title banners above the stands.
   */
  private buildChampion(spots: Spot[], halloween: boolean): void {
    const rng = new Rng(71);
    const parts: BufferGeometry[] = [];
    const base = new CylinderGeometry(0.42, 0.52, 0.5, 10);
    base.translate(0, 0.25, 0);
    parts.push(colorAttr(base, new Color(0x1a1410)));
    const column = new CylinderGeometry(0.2, 0.28, 1.2, 10);
    column.translate(0, 1.1, 0);
    parts.push(colorAttr(column, new Color(0x2a2016)));
    const cupGeo = new CylinderGeometry(0.46, 0.26, 0.28, 12, 1, true);
    cupGeo.translate(0, 1.82, 0);
    parts.push(colorAttr(cupGeo, new Color(0xd8a23a)));
    const pylonGeo = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
    parts.forEach((p) => p.dispose());
    const pylons = new InstancedMesh(pylonGeo, new MeshLambertMaterial({ vertexColors: true, emissive: new Color(halloween ? 0x24102e : 0x2a1a08) }), spots.length);
    placeInstances(pylons, spots, false, rng);
    this.group.add(pylons);
    // glowing gold "flame" on top of each pylon (breathes with the crowd)
    // Halloween edition: the flames burn orange and violet instead of gold
    const glowMat = new MeshStandardMaterial({ color: 0x3a2408, emissive: halloween ? new Color(1, 0.5, 0.12) : new Color(1, 0.72, 0.22), emissiveIntensity: 2.4, roughness: 0.6 });
    this.glowMats.push(glowMat);
    const flame = new OctahedronGeometry(0.3, 0);
    flame.scale(1, 1.6, 1);
    const flames = new InstancedMesh(flame, glowMat, spots.length);
    spots.forEach(([x, y, z, s], i) => {
      _m.compose(_p.set(x, y + 2.15 * s, z), _q.setFromAxisAngle(_up, i * 0.7), _s.setScalar(s));
      flames.setMatrixAt(i, _m);
    });
    flames.instanceMatrix.needsUpdate = true;
    this.group.add(flames);
    // title banners above the stands, either side of the big screens
    const tex = bannerTexture(halloween);
    const bannerMat = new MeshBasicMaterial({ map: tex, side: DoubleSide, transparent: true, toneMapped: false });
    const bannerGeo = new PlaneGeometry(1.7, 4.4);
    const bannerSpots = this.layout.banners;
    const banners = new InstancedMesh(bannerGeo, bannerMat, bannerSpots.length);
    bannerSpots.forEach(([x, y, z, yaw], i) => {
      _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, yaw), _s.setScalar(1));
      banners.setMatrixAt(i, _m);
    });
    banners.instanceMatrix.needsUpdate = true;
    this.group.add(banners);
  }

  setMenuVisible(v: boolean): void {
    this.menuGroup.visible = v;
  }

  update(dt: number, excite: number): void {
    this.t += dt;
    const t = this.t;
    if (this.ambient) (this.ambient.material as ShaderMaterial).uniforms.uTime.value = t;
    // pumpkins breathe a little with the crowd
    for (const m of this.glowMats) m.emissiveIntensity = 2.4 + Math.sin(t * 2.2) * 0.25 + excite * 0.6;
    // Alpha 1.9.7: the lights twinkle — a few per frame (the lobby tree only while the lobby shows)
    for (const tw of this.twinkles) {
      if (tw.menu && !this.menuGroup.visible) continue;
      const m = tw.mesh;
      for (let k = 0; k < 3; k++) {
        const i = Math.floor((t * 23 + k * 11 + m.id) % m.count);
        const on = Math.sin(t * 4 + i * 1.7) > -0.3;
        m.setColorAt(i, _c.copy(tw.base[i]).multiplyScalar(on ? 1 + excite * 0.3 : 0.3));
      }
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    for (const m of this.glowMatsIce) m.emissiveIntensity = 0.55 + Math.sin(t * 1.3) * 0.12 + excite * 0.2;
    if (this.bats) {
      for (let i = 0; i < this.batData.length; i++) {
        const b = this.batData[i];
        const a = b.phase + t * b.speed;
        const flap = 0.35 + Math.abs(Math.sin(t * 9 + i)) * 0.65;
        _p.set(b.cx + Math.cos(a) * b.r, b.h + Math.sin(t * 1.3 + i) * 0.4, b.cz + Math.sin(a) * b.r * 0.45);
        _q.setFromAxisAngle(_up, -a + (b.speed > 0 ? 0 : Math.PI));
        _m.compose(_p, _q, _s.set(b.size, b.size * flap, b.size));
        this.bats.setMatrixAt(i, _m);
      }
      this.bats.instanceMatrix.needsUpdate = true;
    }
  }

  /** Free every geometry, material and texture this decor created. */
  dispose(): void {
    const mats = new Set<Material>();
    const geos = new Set<BufferGeometry>();
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) geos.add(m.geometry);
      const mat = m.material as Material | Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => mats.add(x));
      else if (mat) mats.add(mat);
    });
    for (const g of geos) g.dispose();
    for (const m of mats) {
      const mm = m as Material & { map?: { dispose(): void } | null; emissiveMap?: { dispose(): void } | null };
      mm.map?.dispose();
      mm.emissiveMap?.dispose();
      m.dispose();
    }
    this.group.removeFromParent();
    this.group.clear();
  }
}
