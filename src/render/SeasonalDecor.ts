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
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARENA } from '../config/balance';
import type { AmbientKind, DecorKind } from '../config/themes.config';
import { Rng } from '../core/math';
import { canvasTexture, makeCanvas } from './textures';

// Seasonal 3D decoration for the existing arena. Everything sits outside the
// fighting area (beyond the barrier, on the stands, around the big screens), so
// collisions, camera framing and fighter visibility are untouched. A few pieces
// stand next to the menu pedestal and are shown only on menu screens.
// One instanced mesh per object type keeps the extra draw calls to a handful.

type Spot = [x: number, y: number, z: number, scale: number];

// Barrier corners (on the wall cap), the gaps between barrier and side stands, and the stands.
const ARENA_SPOTS: Spot[] = [
  // on the barrier top, along the rounded corners
  [-4.3, 0.6, -7.22, 0.3],
  [4.3, 0.6, -7.22, 0.34],
  [-5.2, 0.6, 6.31, 0.28],
  [5.2, 0.6, 6.31, 0.3],
  [-7.2, -0.36, -6.4, 0.55],
  [-7.35, -0.36, -2.0, 0.42],
  [-7.1, -0.36, 2.6, 0.5],
  [7.25, -0.36, -5.6, 0.5],
  [7.1, -0.36, -1.4, 0.58],
  [7.3, -0.36, 3.2, 0.44],
  [-9.6, 0.3, -9.25, 0.42],
  [9.4, 0.3, -9.25, 0.46],
  [-3.4, 1.4, -11.5, 0.4],
  [3.8, 1.4, -11.5, 0.38],
  [-10.9, 1.4, -2.5, 0.45],
  [10.9, 1.4, 1.8, 0.45],
  [-1.4, 0.85, -10.35, 0.34],
  [6.3, 0.85, -10.35, 0.36],
];
// Around the showcase pedestal at the arena centre (menu screens only).
const MENU_SPOTS: Spot[] = [
  [-1.95, 0, 0.55, 0.42],
  [1.85, 0, 0.95, 0.32],
  [-1.35, 0, -1.25, 0.28],
  [1.5, 0, -1.0, 0.24],
];

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();
const _up = new Vector3(0, 1, 0);

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
  const halloween = kind === 'pumpkins';
  const edge = halloween ? '150, 60, 255' : '150, 215, 255';
  const grd = g.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, H * 0.62);
  grd.addColorStop(0, `rgba(${edge}, 0)`);
  grd.addColorStop(0.7, `rgba(${edge}, 0.10)`);
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
      if (halloween) {
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
        g.strokeStyle = 'rgba(220, 245, 255, 0.5)';
        for (let i = 0; i < 3; i++) {
          g.rotate(Math.PI / 3);
          g.beginPath();
          g.moveTo(0, -18);
          g.lineTo(0, 18);
          g.stroke();
        }
      }
      g.restore();
    }
  }
  const tex = canvasTexture(c);
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  const mesh = new Mesh(new PlaneGeometry(hx * 2, hz * 2), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.012;
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
  private t = 0;

  constructor(kind: DecorKind, ambient: AmbientKind, ambientColors: number[], lowQuality: boolean) {
    this.group.add(this.menuGroup);
    if (kind === 'pumpkins') this.buildHalloween();
    else if (kind === 'frost') this.buildFrost();
    if (kind !== 'none') this.group.add(floorDecal(kind));
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

  private buildHalloween(): void {
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
    const arena = new InstancedMesh(geo, mat, ARENA_SPOTS.length);
    placeInstances(arena, ARENA_SPOTS, true, rng);
    arena.castShadow = false;
    this.group.add(arena);
    const menu = new InstancedMesh(geo, mat, MENU_SPOTS.length);
    // menu pumpkins look toward the camera side
    MENU_SPOTS.forEach(([x, y, z, s], i) => {
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
        r: rng.range(4, 9),
        h: rng.range(6.5, 10),
        cx: rng.range(-6, 6),
        cz: rng.range(-15, -11),
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
    addWebs(0, 4.6, -16.5, -0.18, 0, 10.6, 5.6, 0.23, 2.3);
    for (const sx of [-1, 1]) addWebs(sx * 11.5, 4.2, -11, -0.15, -sx * 0.7, 5.4, 3, 0.18, 1.3);
    const webGeo = mergeGeometries(webs)!;
    webs.forEach((w) => w.dispose());
    const webMat = new MeshBasicMaterial({ map: webTexture(), color: 0xd8c8ff, transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide });
    this.group.add(new Mesh(webGeo, webMat));
  }

  private buildFrost(): void {
    const rng = new Rng(53);
    // snow mounds where the pumpkins would be
    const mound = new SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    mound.scale(1.3, 0.55, 1.1);
    const snowMat = new MeshLambertMaterial({ color: 0xf2f8ff, emissive: new Color(0x2a4a78), emissiveIntensity: 0.6 });
    const mounds = new InstancedMesh(mound, snowMat, ARENA_SPOTS.length);
    placeInstances(mounds, ARENA_SPOTS, false, rng);
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
    const treeSpots: Spot[] = [
      [-7.3, -0.36, -4.2, 1.1],
      [7.3, -0.36, -3.6, 1.15],
      [-7.2, -0.36, 1.2, 0.9],
      [7.25, -0.36, 1.9, 0.95],
      [-10.5, 0.3, -9.4, 1],
      [10.4, 0.3, -9.4, 1],
    ];
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

  setMenuVisible(v: boolean): void {
    this.menuGroup.visible = v;
  }

  update(dt: number, excite: number): void {
    this.t += dt;
    const t = this.t;
    if (this.ambient) (this.ambient.material as ShaderMaterial).uniforms.uTime.value = t;
    // pumpkins breathe a little with the crowd
    for (const m of this.glowMats) m.emissiveIntensity = 2.4 + Math.sin(t * 2.2) * 0.25 + excite * 0.6;
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
