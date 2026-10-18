import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three';
import type { Side } from '../config/types';
import type { FighterSim } from '../combat/FighterSim';

/**
 * Alpha 1.7 — BLOOD MOON PREMIERE: LUCIEN's battle visuals, all pooled and created once.
 *  - a swarm of small stylised bats (one instanced mesh + one instanced crimson halo: two draw calls):
 *    it gathers around him in the BAT BITE coil, streams behind the lunge, scatters after it and
 *    bursts out of his DASH swirl. Nothing flies when nothing happens.
 *  - crimson slash arcs of the cane strikes (four reusable crescents).
 *  - the vampire mark over a bleeding opponent (one sprite per side) with rising crimson motes.
 * Everything is hidden when the fight is torn down; nothing allocates per frame.
 */
const BATS = 16;
const SLASHES = 4;

interface Bat {
  on: boolean;
  /** Seconds alive and the life it has (scatter: it fades out by then). */
  t: number;
  life: number;
  /** Orbit around the swarm centre: angle, radius, height, angular speed, flap phase. */
  a: number;
  r: number;
  y: number;
  w: number;
  ph: number;
  /** World position and velocity (scatter flight). */
  x: number;
  z: number;
  py: number;
  vx: number;
  vy: number;
  vz: number;
  /** Lag behind the lunge (trail). */
  lag: number;
  scatter: boolean;
}

interface Slash {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  t: number;
  life: number;
}

const _o = new Object3D();
const _c = new Color();

/** A bat silhouette lying flat (wings along X, head toward +Z), about 0.36 m across. */
function batGeometry(): BufferGeometry {
  const s = new Shape();
  s.moveTo(0, 0.07);
  s.lineTo(0.025, 0.045);
  s.quadraticCurveTo(0.09, 0.08, 0.18, 0.05);
  s.quadraticCurveTo(0.15, 0.02, 0.13, -0.02);
  s.quadraticCurveTo(0.1, 0.0, 0.085, -0.035);
  s.quadraticCurveTo(0.06, -0.01, 0.04, -0.04);
  s.lineTo(0, -0.06);
  s.lineTo(-0.04, -0.04);
  s.quadraticCurveTo(-0.06, -0.01, -0.085, -0.035);
  s.quadraticCurveTo(-0.1, 0.0, -0.13, -0.02);
  s.quadraticCurveTo(-0.15, 0.02, -0.18, 0.05);
  s.quadraticCurveTo(-0.09, 0.08, -0.025, 0.045);
  s.lineTo(0, 0.07);
  const g = new ShapeGeometry(s, 4);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A crescent (110°, radius 1.0–1.35) in the XZ plane opening toward +Z, bright on the leading edge, fading along the arc. */
function slashGeometry(): BufferGeometry {
  const seg = 18;
  const span = (110 * Math.PI) / 180;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const a = -span / 2 + span * u;
    const fade = Math.sin(u * Math.PI) * (0.35 + 0.65 * u);
    const r0 = 1.0 + 0.12 * (1 - Math.abs(u - 0.6));
    const r1 = 1.35;
    pos.push(Math.sin(a) * r0, 0, Math.cos(a) * r0, Math.sin(a) * r1, 0, Math.cos(a) * r1);
    col.push(1, 1, 1, fade * 0.15, 1, 1, 1, fade);
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

/** The vampire mark: a crimson crescent with two small fang points and a soft halo (drawn once). */
function markTexture(): CanvasTexture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const halo = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  halo.addColorStop(0, 'rgba(255,60,90,0.55)');
  halo.addColorStop(0.55, 'rgba(160,20,60,0.22)');
  halo.addColorStop(1, 'rgba(90,0,40,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, S, S);
  // crescent
  g.fillStyle = '#ff3a5c';
  g.beginPath();
  g.arc(64, 62, 34, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(78, 52, 30, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  // two fang marks
  g.fillStyle = '#fff2f4';
  for (const x of [56, 74]) {
    g.beginPath();
    g.moveTo(x - 6, 84);
    g.lineTo(x + 6, 84);
    g.lineTo(x, 104);
    g.closePath();
    g.fill();
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class NightFX {
  readonly group = new Group();
  private bats: Bat[] = [];
  private batMesh: InstancedMesh;
  private haloMesh: InstancedMesh;
  /** The swarm: what it does now, its owner and where it is centred. */
  private mode: 'off' | 'gather' | 'trail' = 'off';
  private owner: Side = 0;
  private cx = 0;
  private cz = 0;
  private slashes: Slash[] = [];
  private marks: Sprite[] = [];
  private markOn: [number, number] = [0, 0];
  private t = 0;

  constructor(parent: Group) {
    parent.add(this.group);
    const geo = batGeometry();
    this.batMesh = new InstancedMesh(geo, new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide }), BATS);
    this.haloMesh = new InstancedMesh(geo, new MeshBasicMaterial({ color: 0xff2a4a, side: DoubleSide, transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false }), BATS);
    for (const im of [this.batMesh, this.haloMesh]) {
      im.frustumCulled = false;
      im.count = 0;
      this.group.add(im);
    }
    for (let i = 0; i < BATS; i++) {
      this.bats.push({ on: false, t: 0, life: 1, a: 0, r: 1, y: 1, w: 6, ph: 0, x: 0, z: 0, py: 1, vx: 0, vy: 0, vz: 0, lag: 0, scatter: false });
      this.batMesh.setColorAt(i, _c.set(i % 3 === 0 ? 0x4a0d22 : 0x2a0716));
    }
    if (this.batMesh.instanceColor) this.batMesh.instanceColor.needsUpdate = true;
    const sg = slashGeometry();
    for (let i = 0; i < SLASHES; i++) {
      const mat = new MeshBasicMaterial({ color: 0xff3a5c, vertexColors: true, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
      const mesh = new Mesh(sg, mat);
      mesh.visible = false;
      mesh.renderOrder = 7;
      this.group.add(mesh);
      this.slashes.push({ mesh, mat, t: 0, life: 0.18 });
    }
    const tex = markTexture();
    for (let i = 0; i < 2; i++) {
      const sp = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0 }));
      sp.visible = false;
      sp.scale.setScalar(0.8);
      sp.renderOrder = 8;
      this.group.add(sp);
      this.marks.push(sp);
    }
  }

  // ---------------------------------------------------------------- swarm
  /** BAT BITE coil: the bats gather in a vortex around him. */
  gather(side: Side, x: number, z: number): void {
    this.owner = side;
    this.cx = x;
    this.cz = z;
    this.mode = 'gather';
    for (let i = 0; i < BATS; i++) {
      const b = this.bats[i];
      b.on = true;
      b.scatter = false;
      b.t = 0;
      b.life = 99;
      b.a = (i / BATS) * Math.PI * 2 + Math.random() * 0.4;
      b.r = 1.5 + Math.random() * 0.5;
      b.y = 0.5 + Math.random() * 1.7;
      b.w = (6 + Math.random() * 3) * (i % 2 ? 1 : -1);
      b.ph = Math.random() * 6.28;
      b.lag = 0.15 + (i / BATS) * 0.9;
    }
  }

  /** The lunge: the swarm streams behind him. */
  trail(): void {
    if (this.mode !== 'off') this.mode = 'trail';
  }

  /** The bats scatter outward and up, fading (after the bite, a block, a miss, an interrupt). */
  scatter(): void {
    for (const b of this.bats) if (b.on && !b.scatter) this.fly(b);
    this.mode = 'off';
  }

  /** A few bats burst out of a DASH swirl at (x, z). */
  dashBurst(x: number, z: number): void {
    let n = 0;
    for (const b of this.bats) {
      if (b.on || n >= 6) continue;
      b.on = true;
      b.x = x + (Math.random() - 0.5) * 0.5;
      b.z = z + (Math.random() - 0.5) * 0.5;
      b.py = 0.7 + Math.random() * 1.1;
      b.ph = Math.random() * 6.28;
      this.fly(b);
      n++;
    }
  }

  private fly(b: Bat): void {
    b.scatter = true;
    b.t = 0;
    b.life = 0.45 + Math.random() * 0.35;
    const a = Math.random() * Math.PI * 2;
    const sp = 3 + Math.random() * 4;
    b.vx = Math.cos(a) * sp;
    b.vz = Math.sin(a) * sp;
    b.vy = 1 + Math.random() * 2.5;
  }

  // --------------------------------------------------------------- slashes
  /** A cane strike's arc at (x, z) facing (dx, dz); `variant` 1 / 2 tilt it into a diagonal cut, 0 is a short thrust arc. */
  slash(x: number, z: number, dx: number, dz: number, variant: number, hit: boolean, color: number): void {
    const s = this.slashes.find((q) => q.t >= q.life) ?? this.slashes[0];
    s.t = 0;
    s.life = hit ? 0.2 : 0.16;
    s.mat.color.set(color);
    const m = s.mesh;
    m.visible = true;
    m.position.set(x, 1.15, z);
    m.rotation.set(0, Math.atan2(dx, dz), 0);
    const tilt = variant === 1 ? 0.42 : variant === 2 ? -0.42 : 0;
    m.rotateZ(tilt);
    const k = variant === 0 ? 0.62 : 0.85;
    m.scale.set(variant === 0 ? 0.55 : 1, 1, k);
  }

  // ------------------------------------------------------------------ marks
  /** The vampire mark over `side` (bleeding) or off. */
  setMark(side: Side, on: boolean): void {
    this.markOn[side] = on ? 1 : 0;
    if (on) this.marks[side].visible = true;
  }

  // ----------------------------------------------------------------- update
  /**
   * Per frame. `lucien`: the swarm owner's sim state (its action decides when the swarm is done),
   * `pos(side)`: where each fighter is drawn this frame.
   */
  update(dt: number, lucien: FighterSim | null, pos: (side: Side) => { x: number; z: number }): void {
    this.t += dt;
    // the swarm follows its owner; it scatters on its own once the coil / lunge is over
    if (this.mode !== 'off') {
      const p = pos(this.owner);
      this.cx = p.x;
      this.cz = p.z;
      const a = lucien?.action;
      const coiling = a?.kind === 'windup' && a.card === 'bat_bite';
      const lunging = a?.kind === 'bite' && a.stage === 'rush';
      if (lunging) this.mode = 'trail';
      if (!coiling && !lunging) this.scatter();
    }
    let n = 0;
    for (let i = 0; i < BATS; i++) {
      const b = this.bats[i];
      if (!b.on) continue;
      b.t += dt;
      let fade = 1;
      if (b.scatter) {
        b.x += b.vx * dt;
        b.z += b.vz * dt;
        b.py += b.vy * dt;
        b.vy += 1.5 * dt;
        fade = 1 - b.t / b.life;
        if (fade <= 0) {
          b.on = false;
          b.scatter = false;
          continue;
        }
      } else if (this.mode === 'gather') {
        b.a += b.w * dt;
        b.r = Math.max(0.75, b.r - dt * 2.2);
        b.x = this.cx + Math.cos(b.a) * b.r;
        b.z = this.cz + Math.sin(b.a) * b.r;
        b.py = b.y + Math.sin(this.t * 3 + b.ph) * 0.12;
      } else if (this.mode === 'trail') {
        // stream after him: each bat eases toward a point on a loose spiral around his path
        b.a += b.w * dt * 1.4;
        const tx = this.cx + Math.cos(b.a) * 0.55;
        const tz = this.cz + Math.sin(b.a) * 0.55;
        const k = 1 - Math.exp(-dt / Math.max(0.05, b.lag * 0.35));
        b.x += (tx - b.x) * k;
        b.z += (tz - b.z) * k;
        b.py += (b.y * 0.7 + 0.4 - b.py) * k;
      }
      const flap = 0.45 + 0.55 * Math.abs(Math.sin(this.t * 28 + b.ph));
      const sc = (b.scatter ? 0.6 + 0.4 * fade : Math.min(1, b.t / 0.12)) * 1.05;
      _o.position.set(b.x, b.py, b.z);
      const heading = b.scatter ? Math.atan2(b.vx, b.vz) : this.mode === 'gather' ? b.a + (b.w > 0 ? 0 : Math.PI) : b.a;
      _o.rotation.set(0.25, heading, Math.sin(this.t * 9 + b.ph) * 0.25);
      _o.scale.set(sc * flap, sc, sc);
      _o.updateMatrix();
      this.batMesh.setMatrixAt(n, _o.matrix);
      _o.scale.set(sc * flap * 1.25, sc * 1.2, sc * 1.25);
      _o.updateMatrix();
      this.haloMesh.setMatrixAt(n, _o.matrix);
      n++;
    }
    this.batMesh.count = n;
    this.haloMesh.count = n;
    if (n) {
      this.batMesh.instanceMatrix.needsUpdate = true;
      this.haloMesh.instanceMatrix.needsUpdate = true;
    }
    for (const s of this.slashes) {
      if (!s.mesh.visible) continue;
      s.t += dt;
      const k = s.t / s.life;
      if (k >= 1) {
        s.mesh.visible = false;
        continue;
      }
      s.mat.opacity = (1 - k) * 1.6;
      s.mesh.scale.multiplyScalar(1 + dt * 1.6);
    }
    for (let side = 0 as Side; side < 2; side = (side + 1) as Side) {
      const sp = this.marks[side];
      if (!sp.visible) continue;
      const mat = sp.material as SpriteMaterial;
      const want = this.markOn[side] ? 0.85 + Math.sin(this.t * 7) * 0.15 : 0;
      mat.opacity += (want - mat.opacity) * Math.min(1, dt * (this.markOn[side] ? 10 : 5));
      const p = pos(side);
      sp.position.set(p.x, 2.75 + Math.sin(this.t * 2.4) * 0.05, p.z);
      sp.scale.setScalar(0.95 + Math.sin(this.t * 7) * 0.05);
      if (!this.markOn[side] && mat.opacity < 0.02) sp.visible = false;
    }
  }

  /** Everything off (fight torn down). */
  reset(): void {
    this.mode = 'off';
    for (const b of this.bats) {
      b.on = false;
      b.scatter = false;
    }
    this.batMesh.count = 0;
    this.haloMesh.count = 0;
    for (const s of this.slashes) {
      s.mesh.visible = false;
      s.t = s.life;
    }
    for (let i = 0; i < 2; i++) {
      this.markOn[i] = 0;
      this.marks[i].visible = false;
      (this.marks[i].material as SpriteMaterial).opacity = 0;
    }
  }
}
